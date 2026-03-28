package indexing

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mimir/api/internal/config"
	"mimir/api/internal/infra/docling"
	"mimir/api/internal/infra/files"
	"mimir/api/internal/infra/tei"
	"mimir/api/internal/support"
)

type Service interface {
	ProcessNextDocumentJob(ctx context.Context) (bool, error)
	StartProjectReindex(ctx context.Context, projectID int64, targetConfigID int64) error
}

type service struct {
	db      *pgxpool.Pool
	storage files.Storage
	docling docling.Client
	tei     tei.Client
	cfg     config.Config
}

func NewService(db *pgxpool.Pool, storage files.Storage, doclingClient docling.Client, teiClient tei.Client, cfg config.Config) Service {
	return service{
		db:      db,
		storage: storage,
		docling: doclingClient,
		tei:     teiClient,
		cfg:     cfg,
	}
}

func (s service) ProcessNextDocumentJob(ctx context.Context) (bool, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin document job claim tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var job struct {
		ID                   int64
		ProjectID            int64
		DocumentID           int64
		ProjectIndexConfigID int64
	}

	err = tx.QueryRow(ctx, `
		WITH next_job AS (
			SELECT id
			FROM documents.document_processing_jobs
			WHERE status = 'queued'
			ORDER BY created_at, id
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE documents.document_processing_jobs AS j
		SET status = 'processing',
			started_at = CURRENT_TIMESTAMP,
			attempt_count = attempt_count + 1,
			error_message = NULL
		FROM next_job
		WHERE j.id = next_job.id
		RETURNING j.id, j.project_id, j.document_id, j.project_index_config_id
	`).Scan(&job.ID, &job.ProjectID, &job.DocumentID, &job.ProjectIndexConfigID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, fmt.Errorf("claim document processing job: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE documents.documents
		SET document_status_id = (SELECT id FROM documents.document_statuses WHERE name = 'processing')
		WHERE id = $1
	`, job.DocumentID); err != nil {
		return false, fmt.Errorf("mark document processing status: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO documents.document_history (
			document_id,
			operation_type_id,
			comment
		) VALUES (
			$1,
			(SELECT id FROM documents.document_operation_types WHERE name = 'processing_started'),
			'Document processing started.'
		)
	`, job.DocumentID); err != nil {
		return false, fmt.Errorf("insert processing history: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit document job claim tx: %w", err)
	}

	if err := s.processClaimedDocumentJob(ctx, job.DocumentID); err != nil {
		_, _ = s.db.Exec(ctx, `
			UPDATE documents.document_processing_jobs
			SET status = 'failed',
				completed_at = CURRENT_TIMESTAMP,
				error_message = $2
			WHERE id = $1
		`, job.ID, err.Error())
		_, _ = s.db.Exec(ctx, `
			UPDATE documents.documents
			SET document_status_id = (SELECT id FROM documents.document_statuses WHERE name = 'failed')
			WHERE id = $1
		`, job.DocumentID)
		_, _ = s.db.Exec(ctx, `
			INSERT INTO documents.document_history (
				document_id,
				operation_type_id,
				comment
			) VALUES (
				$1,
				(SELECT id FROM documents.document_operation_types WHERE name = 'failed'),
				$2
			)
		`, job.DocumentID, "Document processing failed: "+err.Error())
		return true, err
	}

	_, err = s.db.Exec(ctx, `
		UPDATE documents.document_processing_jobs
		SET status = 'completed',
			completed_at = CURRENT_TIMESTAMP,
			error_message = NULL
		WHERE id = $1
	`, job.ID)
	if err != nil {
		return true, fmt.Errorf("mark document job completed: %w", err)
	}

	return true, nil
}

func (s service) processClaimedDocumentJob(ctx context.Context, documentID int64) error {
	var document struct {
		ID                 int64
		FileAddress        string
		MIMEType           string
		Name               string
		EmbeddingModelID   int64
		EmbeddingDimension int32
		IndexVersion       int32
		ChunkSize          int32
		ChunkOverlap       int32
	}

	err := s.db.QueryRow(ctx, `
		SELECT
			id,
			file_address,
			mime_type,
			name,
			embedding_model_id,
			embedding_dimension,
			index_version,
			chunk_size,
			chunk_overlap
		FROM documents.documents
		WHERE id = $1
	`, documentID).Scan(
		&document.ID,
		&document.FileAddress,
		&document.MIMEType,
		&document.Name,
		&document.EmbeddingModelID,
		&document.EmbeddingDimension,
		&document.IndexVersion,
		&document.ChunkSize,
		&document.ChunkOverlap,
	)
	if err != nil {
		return fmt.Errorf("load document for processing: %w", err)
	}

	fileData, err := s.storage.ReadAll(document.FileAddress)
	if err != nil {
		return err
	}

	text, err := s.extractText(ctx, document.Name, document.MIMEType, fileData)
	if err != nil {
		return err
	}

	chunks := support.ChunkText(text, int(document.ChunkSize), int(document.ChunkOverlap))
	chunkTexts := make([]string, 0, len(chunks))
	for _, chunk := range chunks {
		chunkTexts = append(chunkTexts, chunk.Text)
	}

	embeddings, err := s.embedTexts(ctx, chunkTexts, int(document.EmbeddingDimension))
	if err != nil {
		return err
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin document finalize tx: %w", err)
	}
	defer tx.Rollback(ctx)

	totalTokens := 0
	for index, chunk := range chunks {
		totalTokens += chunk.TokenCount
		var chunkID int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO documents.document_chunks (
				document_id,
				chunk_order_id,
				chunk_text,
				char_start,
				char_end,
				char_count,
				token_count
			) VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING id
		`, documentID, chunk.OrderID, chunk.Text, chunk.CharStart, chunk.CharEnd, chunk.CharCount, chunk.TokenCount).Scan(&chunkID); err != nil {
			return fmt.Errorf("insert document chunk: %w", err)
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO embeddings.embeddings (
				chunk_id,
				model_id,
				version,
				embedding,
				dimensionality
			) VALUES ($1, $2, $3, $4::vector, $5)
		`, chunkID, document.EmbeddingModelID, document.IndexVersion, support.VectorLiteral(embeddings[index]), document.EmbeddingDimension); err != nil {
			return fmt.Errorf("insert chunk embedding: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE documents.documents
		SET
			document_status_id = (SELECT id FROM documents.document_statuses WHERE name = 'indexed'),
			total_chunks = $2,
			total_token_count = $3,
			language = $4
		WHERE id = $1
	`, documentID, len(chunks), totalTokens, guessLanguage(text)); err != nil {
		return fmt.Errorf("update indexed document state: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO documents.document_history (
			document_id,
			operation_type_id,
			comment
		) VALUES (
			$1,
			(SELECT id FROM documents.document_operation_types WHERE name = 'indexed'),
			'Document processing completed successfully.'
		)
	`, documentID); err != nil {
		return fmt.Errorf("insert indexed history: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit document finalize tx: %w", err)
	}

	return nil
}

func (s service) extractText(ctx context.Context, filename, mimeType string, data []byte) (string, error) {
	switch mimeType {
	case "text/plain", "text/markdown":
		return string(data), nil
	}

	text, err := s.docling.ConvertFile(ctx, filename, data, mimeType)
	if err == nil {
		return text, nil
	}
	if s.cfg.EnableLocalFallbacks && utf8.Valid(data) {
		return string(data), nil
	}
	return "", err
}

func (s service) embedTexts(ctx context.Context, texts []string, dimensions int) ([][]float32, error) {
	if len(texts) == 0 {
		return [][]float32{}, nil
	}

	embeddings, err := s.tei.Embed(ctx, texts, dimensions)
	if err == nil {
		return embeddings, nil
	}
	return nil, fmt.Errorf("embed document chunks with tei: %w", err)
}

func guessLanguage(text string) *string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil
	}

	asciiLetters := 0
	for _, r := range trimmed {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			asciiLetters++
		}
	}

	language := "unknown"
	if asciiLetters > len(trimmed)/3 {
		language = "en"
	}
	return &language
}

func (s service) StartProjectReindex(_ context.Context, _ int64, _ int64) error {
	return fmt.Errorf("project reindex start is not implemented yet")
}
