package analysis

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mimir/api/internal/config"
	"mimir/api/internal/infra/llm"
	"mimir/api/internal/prompts"
)

var (
	ErrProjectNotFound      = errors.New("project not found")
	ErrProjectReindexing    = errors.New("project is reindexing")
	ErrBaseDocumentNotReady = errors.New("base document not ready")
	ErrJobNotFound          = errors.New("analysis job not found")
	ErrLLMUnavailable       = errors.New("llm dependency unavailable")
)

type Service interface {
	StartContradictionAnalysis(ctx context.Context, input StartContradictionAnalysisInput) (AcceptedJob, error)
	GetJob(ctx context.Context, projectID, jobID int64) (JobState, error)
	ProcessNextQueuedJob(ctx context.Context) (bool, error)
}

type service struct {
	db      *pgxpool.Pool
	llm     llm.Client
	prompts prompts.Bundle
	cfg     config.Config
}

type StartContradictionAnalysisInput struct {
	ProjectID         int64
	BaseDocumentID    int64
	TargetDocumentIDs []int64
}

type AcceptedJob struct {
	JobID          int64
	Status         string
	PollURL        string
	WarningMessage *string
}

type JobState struct {
	JobID          int64
	Status         string
	WarningMessage *string
	Results        []ContradictionResult
	ErrorMessage   *string
}

type ContradictionResult struct {
	TargetDocumentID   int64           `json:"target_document_id"`
	TargetDocumentName string          `json:"target_document_name"`
	Summary            string          `json:"summary"`
	Contradictions     []Contradiction `json:"contradictions"`
}

type Contradiction struct {
	BaseText         string  `json:"base_text"`
	TargetText       string  `json:"target_text"`
	Confidence       float64 `json:"confidence"`
	Explanation      string  `json:"explanation"`
	BaseChunkOrder   int     `json:"base_chunk_order"`
	TargetChunkOrder int     `json:"target_chunk_order"`
}

type scopedDocument struct {
	ID   int64
	Name string
}

type projectPromptContext struct {
	Description *string
	Context     string
}

func NewService(db *pgxpool.Pool, llmClient llm.Client, promptBundle prompts.Bundle, cfg config.Config) Service {
	return service{
		db:      db,
		llm:     llmClient,
		prompts: promptBundle,
		cfg:     cfg,
	}
}

func (s service) StartContradictionAnalysis(ctx context.Context, input StartContradictionAnalysisInput) (AcceptedJob, error) {
	state, err := s.getProjectState(ctx, input.ProjectID)
	if err != nil {
		return AcceptedJob{}, err
	}
	if !state.exists {
		return AcceptedJob{}, ErrProjectNotFound
	}
	if state.reindexing {
		return AcceptedJob{}, ErrProjectReindexing
	}

	var baseDocumentReady bool
	var projectIndexConfigID int64
	err = s.db.QueryRow(ctx, `
		SELECT
			(status.name = 'indexed') AS is_indexed,
			d.project_index_config_id
		FROM documents.documents AS d
		JOIN documents.document_statuses AS status
			ON status.id = d.document_status_id
		WHERE d.project_id = $1
		  AND d.id = $2
	`, input.ProjectID, input.BaseDocumentID).Scan(&baseDocumentReady, &projectIndexConfigID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AcceptedJob{}, ErrBaseDocumentNotReady
		}
		return AcceptedJob{}, fmt.Errorf("load base document readiness: %w", err)
	}
	if !baseDocumentReady {
		return AcceptedJob{}, ErrBaseDocumentNotReady
	}

	if err := s.llm.CheckAvailability(ctx); err != nil {
		return AcceptedJob{}, fmt.Errorf("%w: %v", ErrLLMUnavailable, err)
	}

	scope, warningMessage, err := s.resolveScope(ctx, input.ProjectID, input.BaseDocumentID, input.TargetDocumentIDs)
	if err != nil {
		return AcceptedJob{}, err
	}

	requestedTargets, err := json.Marshal(input.TargetDocumentIDs)
	if err != nil {
		return AcceptedJob{}, fmt.Errorf("marshal requested target document ids: %w", err)
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return AcceptedJob{}, fmt.Errorf("begin contradiction analysis tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var jobID int64
	err = tx.QueryRow(ctx, `
		INSERT INTO analysis.analysis_jobs (
			project_id,
			base_document_id,
			project_index_config_id,
			status,
			requested_target_document_ids,
			warning_message
		) VALUES ($1, $2, $3, 'queued', $4, $5)
		RETURNING id
	`, input.ProjectID, input.BaseDocumentID, projectIndexConfigID, requestedTargets, warningMessage).Scan(&jobID)
	if err != nil {
		return AcceptedJob{}, fmt.Errorf("insert contradiction analysis job: %w", err)
	}

	for _, target := range scope {
		if _, err := tx.Exec(ctx, `
			INSERT INTO analysis.analysis_job_targets (
				analysis_job_id,
				document_id
			) VALUES ($1, $2)
		`, jobID, target.ID); err != nil {
			return AcceptedJob{}, fmt.Errorf("insert contradiction analysis target: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return AcceptedJob{}, fmt.Errorf("commit contradiction analysis tx: %w", err)
	}

	return AcceptedJob{
		JobID:          jobID,
		Status:         "queued",
		PollURL:        strings.TrimRight(s.cfg.HTTP.PublicBaseURL, "/") + fmt.Sprintf("/api/v1/projects/%d/analysis/contradictions/%d", input.ProjectID, jobID),
		WarningMessage: warningMessage,
	}, nil
}

func (s service) GetJob(ctx context.Context, projectID, jobID int64) (JobState, error) {
	var (
		status        string
		warningRaw    sql.NullString
		resultPayload []byte
		errorRaw      sql.NullString
	)

	err := s.db.QueryRow(ctx, `
		SELECT status, warning_message, result_payload, error_message
		FROM analysis.analysis_jobs
		WHERE project_id = $1
		  AND id = $2
	`, projectID, jobID).Scan(&status, &warningRaw, &resultPayload, &errorRaw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return JobState{}, ErrJobNotFound
		}
		return JobState{}, fmt.Errorf("load contradiction analysis job: %w", err)
	}

	state := JobState{
		JobID:          jobID,
		Status:         status,
		WarningMessage: nullableStringPtr(warningRaw),
		ErrorMessage:   nullableStringPtr(errorRaw),
	}

	if status == "completed" && len(resultPayload) > 0 {
		if err := json.Unmarshal(resultPayload, &state.Results); err != nil {
			return JobState{}, fmt.Errorf("unmarshal contradiction analysis payload: %w", err)
		}
	}

	return state, nil
}

func (s service) ProcessNextQueuedJob(ctx context.Context) (bool, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin analysis claim tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var job struct {
		ID             int64
		ProjectID      int64
		BaseDocumentID int64
	}

	err = tx.QueryRow(ctx, `
		WITH next_job AS (
			SELECT id
			FROM analysis.analysis_jobs
			WHERE status = 'queued'
			ORDER BY created_at, id
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE analysis.analysis_jobs AS j
		SET status = 'processing',
			started_at = CURRENT_TIMESTAMP,
			error_message = NULL
		FROM next_job
		WHERE j.id = next_job.id
		RETURNING j.id, j.project_id, j.base_document_id
	`).Scan(&job.ID, &job.ProjectID, &job.BaseDocumentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("claim analysis job: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit analysis claim tx: %w", err)
	}

	results, processErr := s.processClaimedJob(ctx, job.ID, job.ProjectID, job.BaseDocumentID)
	if processErr != nil {
		_, _ = s.db.Exec(ctx, `
			UPDATE analysis.analysis_jobs
			SET status = 'failed',
				completed_at = CURRENT_TIMESTAMP,
				error_message = $2
			WHERE id = $1
		`, job.ID, processErr.Error())
		return true, processErr
	}

	payload, err := json.Marshal(results)
	if err != nil {
		return true, fmt.Errorf("marshal analysis results: %w", err)
	}

	if _, err := s.db.Exec(ctx, `
		UPDATE analysis.analysis_jobs
		SET status = 'completed',
			completed_at = CURRENT_TIMESTAMP,
			result_payload = $2,
			error_message = NULL
		WHERE id = $1
	`, job.ID, payload); err != nil {
		return true, fmt.Errorf("mark analysis job completed: %w", err)
	}

	return true, nil
}

func (s service) processClaimedJob(ctx context.Context, jobID, projectID, baseDocumentID int64) ([]ContradictionResult, error) {
	type targetDocument struct {
		ID   int64
		Name string
	}

	projectContext, err := s.loadProjectPromptContext(ctx, projectID)
	if err != nil {
		return nil, err
	}

	rows, err := s.db.Query(ctx, `
		SELECT t.document_id, d.name
		FROM analysis.analysis_job_targets AS t
		JOIN documents.documents AS d
			ON d.id = t.document_id
		WHERE t.analysis_job_id = $1
		ORDER BY t.document_id
	`, jobID)
	if err != nil {
		return nil, fmt.Errorf("load analysis targets: %w", err)
	}
	defer rows.Close()

	targets := make([]targetDocument, 0)
	for rows.Next() {
		var target targetDocument
		if err := rows.Scan(&target.ID, &target.Name); err != nil {
			return nil, fmt.Errorf("scan analysis target: %w", err)
		}
		targets = append(targets, target)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate analysis targets: %w", err)
	}

	maxPairs := s.cfg.ContradictionMaxPairsPerJob
	if maxPairs < 1 {
		maxPairs = 1
	}
	remainingPairs := maxPairs

	results := make([]ContradictionResult, 0, len(targets))
	for _, target := range targets {
		if remainingPairs <= 0 {
			break
		}

		pairs, err := s.findCandidatePairs(ctx, baseDocumentID, target.ID)
		if err != nil {
			return nil, err
		}
		if len(pairs) > remainingPairs {
			pairs = pairs[:remainingPairs]
		}

		contradictions := make([]Contradiction, 0)
		for _, pair := range pairs {
			item, ok, err := s.evaluatePair(ctx, projectContext, pair.baseText, pair.targetText, pair.baseOrder, pair.targetOrder)
			if err != nil {
				return nil, err
			}
			remainingPairs--
			if ok {
				contradictions = append(contradictions, item)
			}
			if remainingPairs <= 0 {
				break
			}
		}

		if len(contradictions) == 0 {
			continue
		}

		sort.Slice(contradictions, func(i, j int) bool {
			return contradictions[i].Confidence > contradictions[j].Confidence
		})

		summary, err := s.summarizeTargetContradictions(ctx, projectContext, target.Name, contradictions)
		if err != nil {
			return nil, err
		}
		summary = strings.TrimSpace(summary)
		if summary == "" {
			return nil, fmt.Errorf("llm contradiction summary returned empty text for target document %d", target.ID)
		}

		results = append(results, ContradictionResult{
			TargetDocumentID:   target.ID,
			TargetDocumentName: target.Name,
			Summary:            summary,
			Contradictions:     contradictions,
		})
	}

	return results, nil
}

type candidatePair struct {
	baseText    string
	targetText  string
	baseOrder   int
	targetOrder int
	distance    float64
}

func (s service) findCandidatePairs(ctx context.Context, baseDocumentID, targetDocumentID int64) ([]candidatePair, error) {
	topK := s.cfg.ContradictionTopKPerBaseChunk
	if topK < 1 {
		topK = 1
	}

	rows, err := s.db.Query(ctx, `
		SELECT
			bc.chunk_text,
			bc.chunk_order_id,
			candidate.target_text,
			candidate.target_order,
			candidate.distance
		FROM embeddings.embeddings AS be
		JOIN documents.document_chunks AS bc
			ON bc.id = be.chunk_id
		JOIN LATERAL (
			SELECT
				tc.chunk_text AS target_text,
				tc.chunk_order_id AS target_order,
				te.embedding <=> be.embedding AS distance
			FROM documents.document_chunks AS tc
			JOIN embeddings.embeddings AS te
				ON te.chunk_id = tc.id
			WHERE tc.document_id = $2
			  AND te.model_id = be.model_id
			  AND te.version = be.version
			ORDER BY te.embedding <=> be.embedding
			LIMIT $3
		) AS candidate
			ON TRUE
		WHERE bc.document_id = $1
		ORDER BY candidate.distance
	`, baseDocumentID, targetDocumentID, topK)
	if err != nil {
		return nil, fmt.Errorf("find contradiction candidate pairs: %w", err)
	}
	defer rows.Close()

	pairs := make([]candidatePair, 0)
	for rows.Next() {
		var pair candidatePair
		if err := rows.Scan(&pair.baseText, &pair.baseOrder, &pair.targetText, &pair.targetOrder, &pair.distance); err != nil {
			return nil, fmt.Errorf("scan contradiction candidate pair: %w", err)
		}
		if pair.distance > s.cfg.ContradictionMaxDistance {
			continue
		}
		pairs = append(pairs, pair)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate contradiction candidate pairs: %w", err)
	}

	sort.Slice(pairs, func(i, j int) bool {
		return pairs[i].distance < pairs[j].distance
	})

	return pairs, nil
}

func (s service) evaluatePair(ctx context.Context, projectContext projectPromptContext, baseText, targetText string, baseOrder, targetOrder int) (Contradiction, bool, error) {
	response, err := s.askLLM(ctx, projectContext, baseText, targetText)
	if err != nil {
		return Contradiction{}, false, fmt.Errorf("llm contradiction evaluation failed: %w", err)
	}

	if response.IsContradiction {
		return Contradiction{
			BaseText:         baseText,
			TargetText:       targetText,
			Confidence:       response.Confidence,
			Explanation:      response.Explanation,
			BaseChunkOrder:   baseOrder,
			TargetChunkOrder: targetOrder,
		}, true, nil
	}
	return Contradiction{}, false, nil
}

type llmJudgement struct {
	IsContradiction bool    `json:"is_contradiction"`
	Confidence      float64 `json:"confidence"`
	Explanation     string  `json:"explanation"`
}

func (s service) askLLM(ctx context.Context, projectContext projectPromptContext, baseText, targetText string) (llmJudgement, error) {
	userPrompt := strings.TrimSpace(
		s.composeProjectContextBlock(projectContext) +
			"\nBase statement:\n" + baseText +
			"\n\nCandidate target statement:\n" + targetText,
	)

	response, err := s.llm.Complete(ctx, llm.CompletionRequest{
		SystemPrompt: s.prompts.ContradictionDiscovery,
		UserPrompt:   userPrompt,
		JSONMode:     true,
	})
	if err != nil {
		return llmJudgement{}, fmt.Errorf("call llm for contradiction judgement: %w", err)
	}

	var judgement llmJudgement
	if err := json.Unmarshal([]byte(response.Text), &judgement); err != nil {
		return llmJudgement{}, fmt.Errorf("decode llm contradiction judgement: %w", err)
	}

	return judgement, nil
}

func (s service) summarizeTargetContradictions(ctx context.Context, projectContext projectPromptContext, targetDocumentName string, contradictions []Contradiction) (string, error) {
	if len(contradictions) == 0 {
		return "", nil
	}

	lines := make([]string, 0, len(contradictions))
	for _, item := range contradictions {
		lines = append(lines, fmt.Sprintf(
			"- Base chunk %d vs target chunk %d\n  Base: %s\n  Target: %s\n  Explanation: %s\n  Confidence: %.2f",
			item.BaseChunkOrder,
			item.TargetChunkOrder,
			item.BaseText,
			item.TargetText,
			item.Explanation,
			item.Confidence,
		))
	}

	userPrompt := strings.TrimSpace(
		s.composeProjectContextBlock(projectContext) +
			"\nTarget document name:\n" + targetDocumentName +
			"\n\nDetected contradiction findings:\n" + strings.Join(lines, "\n\n"),
	)

	response, err := s.llm.Complete(ctx, llm.CompletionRequest{
		SystemPrompt: s.prompts.ContradictionSummary,
		UserPrompt:   userPrompt,
	})
	if err != nil {
		return "", fmt.Errorf("call llm for contradiction summary: %w", err)
	}

	return strings.TrimSpace(response.Text), nil
}

func (s service) resolveScope(ctx context.Context, projectID, baseDocumentID int64, targetDocumentIDs []int64) ([]scopedDocument, *string, error) {
	queryArgs := []any{projectID, baseDocumentID}
	query := `
		SELECT d.id, d.name
		FROM documents.documents AS d
		JOIN documents.document_statuses AS s
			ON s.id = d.document_status_id
		WHERE d.project_id = $1
		  AND d.id <> $2
		  AND s.name = 'indexed'
	`
	if len(targetDocumentIDs) > 0 {
		query += ` AND d.id = ANY($3::BIGINT[])`
		queryArgs = append(queryArgs, targetDocumentIDs)
	}
	query += ` ORDER BY d.id`

	rows, err := s.db.Query(ctx, query, queryArgs...)
	if err != nil {
		return nil, nil, fmt.Errorf("load contradiction target scope: %w", err)
	}
	defer rows.Close()

	scope := make([]scopedDocument, 0)
	for rows.Next() {
		var item scopedDocument
		if err := rows.Scan(&item.ID, &item.Name); err != nil {
			return nil, nil, fmt.Errorf("scan contradiction target scope: %w", err)
		}
		scope = append(scope, item)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate contradiction target scope: %w", err)
	}

	if len(targetDocumentIDs) == 0 {
		return scope, nil, nil
	}

	ignoredNonIndexed := false
	rows, err = s.db.Query(ctx, `
		SELECT d.id, status.name
		FROM documents.documents AS d
		JOIN documents.document_statuses AS status
			ON status.id = d.document_status_id
		WHERE d.project_id = $1
		  AND d.id = ANY($2::BIGINT[])
	`, projectID, targetDocumentIDs)
	if err != nil {
		return nil, nil, fmt.Errorf("load requested contradiction target statuses: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			documentID int64
			status     string
		)
		if err := rows.Scan(&documentID, &status); err != nil {
			return nil, nil, fmt.Errorf("scan requested contradiction target status: %w", err)
		}
		if documentID == baseDocumentID {
			continue
		}
		if status != "indexed" {
			ignoredNonIndexed = true
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate requested contradiction target statuses: %w", err)
	}

	if ignoredNonIndexed {
		message := "Some requested target documents were ignored because they are not indexed yet."
		return scope, &message, nil
	}

	return scope, nil, nil
}

type projectState struct {
	exists     bool
	reindexing bool
}

func (s service) getProjectState(ctx context.Context, projectID int64) (projectState, error) {
	var exists bool
	if err := s.db.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM documents.projects WHERE id = $1)
	`, projectID).Scan(&exists); err != nil {
		return projectState{}, fmt.Errorf("check project existence: %w", err)
	}
	if !exists {
		return projectState{exists: false}, nil
	}

	var reindexing bool
	if err := s.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM documents.project_index_configs
			WHERE project_id = $1
			  AND status = 'reindexing'
		)
	`, projectID).Scan(&reindexing); err != nil {
		return projectState{}, fmt.Errorf("check project reindexing state: %w", err)
	}

	return projectState{exists: true, reindexing: reindexing}, nil
}

func (s service) loadProjectPromptContext(ctx context.Context, projectID int64) (projectPromptContext, error) {
	var descriptionRaw sql.NullString
	var contextValue string

	if err := s.db.QueryRow(ctx, `
		SELECT description, context
		FROM documents.projects
		WHERE id = $1
	`, projectID).Scan(&descriptionRaw, &contextValue); err != nil {
		return projectPromptContext{}, fmt.Errorf("load project prompt context: %w", err)
	}

	return projectPromptContext{
		Description: nullableStringPtr(descriptionRaw),
		Context:     contextValue,
	}, nil
}

func (s service) composeProjectContextBlock(projectContext projectPromptContext) string {
	parts := make([]string, 0, 2)
	if projectContext.Description != nil && strings.TrimSpace(*projectContext.Description) != "" {
		parts = append(parts, "Project description:\n"+strings.TrimSpace(*projectContext.Description))
	}
	if strings.TrimSpace(projectContext.Context) != "" {
		parts = append(parts, "Project context:\n"+strings.TrimSpace(projectContext.Context))
	}
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, "\n\n") + "\n\n"
}

func nullableStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	result := value.String
	return &result
}
