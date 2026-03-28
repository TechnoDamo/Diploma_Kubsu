package rag

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mimir/api/internal/config"
	"mimir/api/internal/infra/llm"
	"mimir/api/internal/infra/tei"
	"mimir/api/internal/prompts"
	"mimir/api/internal/support"
)

var (
	ErrProjectNotFound   = errors.New("project not found")
	ErrProjectReindexing = errors.New("project is reindexing")
	ErrTEIUnavailable    = errors.New("tei dependency unavailable")
	ErrLLMUnavailable    = errors.New("llm dependency unavailable")
)

type Service interface {
	Query(ctx context.Context, input QueryInput) (QueryResult, error)
}

type service struct {
	db      *pgxpool.Pool
	tei     tei.Client
	llm     llm.Client
	prompts prompts.Bundle
	cfg     config.Config
}

type QueryInput struct {
	ProjectID         int64
	Question          string
	TargetDocumentIDs []int64
}

type QueryResult struct {
	Answer         string
	WarningMessage *string
	Citations      []Citation
}

type Citation struct {
	DocumentID   int64
	DocumentName string
	Snippet      string
}

type projectPromptContext struct {
	Description *string
	Context     string
}

type projectRuntimeSettings struct {
	projectPromptContext
	QueryRewriteEnabled bool
	RetrievalTopK       int
	ContextTopN         int
	EmbeddingModelID    int64
	IndexVersion        int32
	EmbeddingDimension  int32
}

func NewService(db *pgxpool.Pool, teiClient tei.Client, llmClient llm.Client, promptBundle prompts.Bundle, cfg config.Config) Service {
	return service{
		db:      db,
		tei:     teiClient,
		llm:     llmClient,
		prompts: promptBundle,
		cfg:     cfg,
	}
}

func (s service) Query(ctx context.Context, input QueryInput) (QueryResult, error) {
	state, err := s.getProjectState(ctx, input.ProjectID)
	if err != nil {
		return QueryResult{}, err
	}
	if !state.exists {
		return QueryResult{}, ErrProjectNotFound
	}
	if state.reindexing {
		return QueryResult{}, ErrProjectReindexing
	}

	settings, err := s.loadProjectRuntimeSettings(ctx, input.ProjectID)
	if err != nil {
		return QueryResult{}, err
	}

	scope, warningMessage, err := s.resolveScope(ctx, input.ProjectID, input.TargetDocumentIDs)
	if err != nil {
		return QueryResult{}, err
	}
	if len(scope) == 0 {
		return QueryResult{
			Answer:         "No indexed documents are available for this project.",
			WarningMessage: warningMessage,
			Citations:      []Citation{},
		}, nil
	}

	effectiveQuestion := input.Question
	if settings.QueryRewriteEnabled {
		rewritten, err := s.rewriteQuestion(ctx, input.Question, settings.projectPromptContext)
		if err != nil {
			return QueryResult{}, err
		}
		if strings.TrimSpace(rewritten) != "" {
			effectiveQuestion = rewritten
		}
	}

	queryVector, err := s.embedText(ctx, effectiveQuestion, int(settings.EmbeddingDimension))
	if err != nil {
		return QueryResult{}, err
	}

	targetIDs := make([]int64, 0, len(scope))
	for _, item := range scope {
		targetIDs = append(targetIDs, item.ID)
	}

	rows, err := s.db.Query(ctx, `
		SELECT
			d.id,
			d.name,
			c.chunk_text
		FROM embeddings.embeddings AS e
		JOIN documents.document_chunks AS c
			ON c.id = e.chunk_id
		JOIN documents.documents AS d
			ON d.id = c.document_id
		WHERE d.project_id = $1
		  AND d.id = ANY($2::BIGINT[])
		  AND e.model_id = $3
		  AND e.version = $4
		ORDER BY e.embedding <=> $5::vector
		LIMIT $6
	`, input.ProjectID, targetIDs, settings.EmbeddingModelID, settings.IndexVersion, support.VectorLiteral(queryVector), settings.RetrievalTopK)
	if err != nil {
		return QueryResult{}, fmt.Errorf("query rag chunks: %w", err)
	}
	defer rows.Close()

	citations := make([]Citation, 0, settings.RetrievalTopK)
	contextParts := make([]string, 0, settings.ContextTopN)
	for rows.Next() {
		var citation Citation
		var chunkText string
		if err := rows.Scan(&citation.DocumentID, &citation.DocumentName, &chunkText); err != nil {
			return QueryResult{}, fmt.Errorf("scan rag chunk: %w", err)
		}
		citation.Snippet = support.ClipSnippet(chunkText, 4000)
		citations = append(citations, citation)
		if len(contextParts) < settings.ContextTopN {
			contextParts = append(contextParts, fmt.Sprintf("[%s] %s", citation.DocumentName, support.ClipSnippet(chunkText, 1200)))
		}
	}
	if err := rows.Err(); err != nil {
		return QueryResult{}, fmt.Errorf("iterate rag chunks: %w", err)
	}

	answer := s.buildFallbackAnswer(citations)
	if len(contextParts) > 0 {
		llmAnswer, err := s.answerWithLLM(ctx, input.Question, effectiveQuestion, settings.projectPromptContext, contextParts)
		if err != nil {
			return QueryResult{}, err
		}
		if strings.TrimSpace(llmAnswer) != "" {
			answer = llmAnswer
		}
	}

	return QueryResult{
		Answer:         answer,
		WarningMessage: warningMessage,
		Citations:      citations,
	}, nil
}

type projectState struct {
	exists     bool
	reindexing bool
}

type scopedDocument struct {
	ID   int64
	Name string
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

func (s service) loadProjectRuntimeSettings(ctx context.Context, projectID int64) (projectRuntimeSettings, error) {
	var (
		descriptionRaw         sql.NullString
		contextRaw             string
		queryRewriteEnabledRaw sql.NullBool
		retrievalTopKRaw       sql.NullInt32
		contextTopNRaw         sql.NullInt32
		settings               projectRuntimeSettings
	)

	err := s.db.QueryRow(ctx, `
		SELECT
			p.description,
			p.context,
			p.query_rewrite_enabled,
			p.retrieval_top_k,
			p.context_top_n,
			pic.embedding_model_id,
			pic.version,
			pic.embedding_dimension
		FROM documents.projects AS p
		JOIN documents.project_index_configs AS pic
			ON pic.project_id = p.id
		WHERE p.id = $1
		  AND pic.status = 'active'
		ORDER BY pic.version DESC
		LIMIT 1
	`, projectID).Scan(
		&descriptionRaw,
		&contextRaw,
		&queryRewriteEnabledRaw,
		&retrievalTopKRaw,
		&contextTopNRaw,
		&settings.EmbeddingModelID,
		&settings.IndexVersion,
		&settings.EmbeddingDimension,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return projectRuntimeSettings{}, fmt.Errorf("active index config not found for project %d", projectID)
		}
		return projectRuntimeSettings{}, fmt.Errorf("load project rag runtime settings: %w", err)
	}

	settings.Description = nullableStringPtr(descriptionRaw)
	settings.Context = contextRaw
	settings.QueryRewriteEnabled = resolveBool(queryRewriteEnabledRaw, s.cfg.QueryRewriteDefaultEnabled)
	settings.RetrievalTopK = resolvePositiveInt(retrievalTopKRaw, s.cfg.RAGRetrievalTopK)
	settings.ContextTopN = resolvePositiveInt(contextTopNRaw, s.cfg.RAGContextTopN)
	if settings.ContextTopN > settings.RetrievalTopK {
		settings.ContextTopN = settings.RetrievalTopK
	}
	if settings.ContextTopN < 1 {
		settings.ContextTopN = 1
	}
	if settings.EmbeddingDimension < 1 {
		settings.EmbeddingDimension = s.cfg.ProjectIndexDefaults.EmbeddingDimension
	}

	return settings, nil
}

func (s service) resolveScope(ctx context.Context, projectID int64, targetDocumentIDs []int64) ([]scopedDocument, *string, error) {
	if len(targetDocumentIDs) == 0 {
		rows, err := s.db.Query(ctx, `
			SELECT d.id, d.name
			FROM documents.documents AS d
			JOIN documents.document_statuses AS s
				ON s.id = d.document_status_id
			WHERE d.project_id = $1
			  AND s.name = 'indexed'
			ORDER BY d.id
		`, projectID)
		if err != nil {
			return nil, nil, fmt.Errorf("load indexed project documents: %w", err)
		}
		defer rows.Close()

		scope := make([]scopedDocument, 0)
		for rows.Next() {
			var item scopedDocument
			if err := rows.Scan(&item.ID, &item.Name); err != nil {
				return nil, nil, fmt.Errorf("scan project document: %w", err)
			}
			scope = append(scope, item)
		}
		if err := rows.Err(); err != nil {
			return nil, nil, fmt.Errorf("iterate project documents: %w", err)
		}
		return scope, nil, nil
	}

	rows, err := s.db.Query(ctx, `
		SELECT
			d.id,
			d.name,
			status.name AS document_status
		FROM documents.documents AS d
		JOIN documents.document_statuses AS status
			ON status.id = d.document_status_id
		WHERE d.project_id = $1
		  AND d.id = ANY($2::BIGINT[])
		ORDER BY d.id
	`, projectID, targetDocumentIDs)
	if err != nil {
		return nil, nil, fmt.Errorf("resolve target document scope: %w", err)
	}
	defer rows.Close()

	scope := make([]scopedDocument, 0)
	ignoredNonIndexed := false
	for rows.Next() {
		var item scopedDocument
		var status string
		if err := rows.Scan(&item.ID, &item.Name, &status); err != nil {
			return nil, nil, fmt.Errorf("scan target document scope: %w", err)
		}
		if status == "indexed" {
			scope = append(scope, item)
			continue
		}
		ignoredNonIndexed = true
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate target document scope: %w", err)
	}

	if ignoredNonIndexed {
		message := "Some requested target documents were ignored because they are not indexed yet."
		return scope, &message, nil
	}

	return scope, nil, nil
}

func (s service) rewriteQuestion(ctx context.Context, question string, projectContext projectPromptContext) (string, error) {
	response, err := s.llm.Complete(ctx, llm.CompletionRequest{
		SystemPrompt: s.prompts.RAGRequest,
		UserPrompt: strings.TrimSpace(
			s.composeProjectContextBlock(projectContext) +
				"\nOriginal user question:\n" + question,
		),
	})
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrLLMUnavailable, err)
	}
	return strings.TrimSpace(response.Text), nil
}

func (s service) embedText(ctx context.Context, text string, dimension int) ([]float32, error) {
	vectors, err := s.tei.Embed(ctx, []string{text}, dimension)
	if err == nil && len(vectors) > 0 {
		return vectors[0], nil
	}
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrTEIUnavailable, err)
	}
	return nil, fmt.Errorf("%w: tei returned no embeddings", ErrTEIUnavailable)
}

func (s service) answerWithLLM(ctx context.Context, originalQuestion, rewrittenQuestion string, projectContext projectPromptContext, contextParts []string) (string, error) {
	if len(contextParts) == 0 {
		return "", nil
	}

	userPrompt := strings.TrimSpace(
		s.composeProjectContextBlock(projectContext) +
			"\nOriginal user question:\n" + originalQuestion +
			"\n\nRetrieval query used:\n" + rewrittenQuestion +
			"\n\nRetrieved context snippets:\n" + strings.Join(contextParts, "\n\n"),
	)

	response, err := s.llm.Complete(ctx, llm.CompletionRequest{
		SystemPrompt: s.prompts.RAGResponse,
		UserPrompt:   userPrompt,
	})
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrLLMUnavailable, err)
	}
	return strings.TrimSpace(response.Text), nil
}

func (s service) buildFallbackAnswer(citations []Citation) string {
	if len(citations) == 0 {
		return "I could not find relevant indexed content to answer this question."
	}

	parts := make([]string, 0, len(citations))
	for _, citation := range citations {
		parts = append(parts, fmt.Sprintf("%s: %s", citation.DocumentName, citation.Snippet))
	}

	return strings.Join(parts, "\n\n")
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

func resolveBool(value sql.NullBool, fallback bool) bool {
	if !value.Valid {
		return fallback
	}
	return value.Bool
}

func resolvePositiveInt(value sql.NullInt32, fallback int) int {
	if value.Valid && value.Int32 > 0 {
		return int(value.Int32)
	}
	if fallback > 0 {
		return fallback
	}
	return 1
}

func nullableStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	result := value.String
	return &result
}
