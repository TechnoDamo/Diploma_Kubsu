package indexing

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/sync/errgroup"

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
	logger  *slog.Logger
}

func NewService(
	db *pgxpool.Pool,
	storage files.Storage,
	doclingClient docling.Client,
	teiClient tei.Client,
	cfg config.Config,
	logger *slog.Logger,
) Service {
	return service{
		db:      db,
		storage: storage,
		docling: doclingClient,
		tei:     teiClient,
		cfg:     cfg,
		logger:  logger,
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

	if s.logger != nil {
		s.logger.Info(
			"document processing job claimed",
			"job_id", job.ID,
			"project_id", job.ProjectID,
			"document_id", job.DocumentID,
			"project_index_config_id", job.ProjectIndexConfigID,
		)
	}

	if err := s.processClaimedDocumentJob(ctx, job.DocumentID); err != nil {
		if s.logger != nil {
			s.logger.Error(
				"document processing job failed",
				"job_id", job.ID,
				"project_id", job.ProjectID,
				"document_id", job.DocumentID,
				"error", err,
			)
		}
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

	if s.logger != nil {
		s.logger.Info(
			"document processing job completed",
			"job_id", job.ID,
			"project_id", job.ProjectID,
			"document_id", job.DocumentID,
		)
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

	if s.logger != nil {
		s.logger.Info(
			"document processing started",
			"document_id", document.ID,
			"name", document.Name,
			"mime_type", document.MIMEType,
			"file_address", document.FileAddress,
			"embedding_model_id", document.EmbeddingModelID,
			"embedding_dimension", document.EmbeddingDimension,
			"index_version", document.IndexVersion,
			"chunk_size", document.ChunkSize,
			"chunk_overlap", document.ChunkOverlap,
		)
	}

	fileData, err := s.storage.ReadAll(document.FileAddress)
	if err != nil {
		return err
	}

	if s.logger != nil {
		s.logger.Info(
			"document file loaded",
			"document_id", document.ID,
			"file_size_bytes", len(fileData),
		)
	}

	extractionStartedAt := time.Now()
	if s.logger != nil {
		s.logger.Info(
			"document text extraction started",
			"document_id", document.ID,
			"name", document.Name,
			"mime_type", document.MIMEType,
		)
	}
	text, err := s.extractText(ctx, document.Name, document.MIMEType, fileData)
	if err != nil {
		return err
	}
	if s.logger != nil {
		s.logger.Info(
			"document text extraction completed",
			"document_id", document.ID,
			"duration_ms", time.Since(extractionStartedAt).Milliseconds(),
			"text_length_chars", len([]rune(text)),
		)
	}

	// Chunking happens before embedding so each stored vector maps to a durable
	// document_chunks row instead of to the full extracted document text.
	chunks := support.ChunkText(text, int(document.ChunkSize), int(document.ChunkOverlap))
	if s.logger != nil {
		s.logger.Info(
			"document chunking completed",
			"document_id", document.ID,
			"chunk_count", len(chunks),
		)
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin document finalize tx: %w", err)
	}
	defer tx.Rollback(ctx)

	totalTokens := 0
	for _, chunk := range chunks {
		totalTokens += chunk.TokenCount
	}

	batchSize := s.cfg.TEIEmbedBatchSize
	if batchSize <= 0 {
		batchSize = 64
	}
	maxConcurrentRequests := s.cfg.MaxEmbeddingConcurrentRequests
	if maxConcurrentRequests < 1 {
		maxConcurrentRequests = 1
	}

	// The worker snapshots all chunk rows inside a single transaction and then
	// allows a bounded number of TEI batch requests in flight. Embedding writes
	// stay transactional, so any batch failure still rolls the whole document back.
	batches := make([]documentChunkBatch, 0, (len(chunks)+batchSize-1)/batchSize)
	for start := 0; start < len(chunks); start += batchSize {
		end := start + batchSize
		if end > len(chunks) {
			end = len(chunks)
		}

		batch, err := s.insertChunkBatchRows(
			ctx,
			tx,
			documentID,
			chunks[start:end],
			start,
			end,
		)
		if err != nil {
			return err
		}
		batches = append(batches, batch)
	}

	if err := s.embedAndPersistChunkBatches(
		ctx,
		tx,
		document,
		len(chunks),
		batches,
		maxConcurrentRequests,
	); err != nil {
		return err
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

	if s.logger != nil {
		s.logger.Info(
			"document indexing committed",
			"document_id", document.ID,
			"chunk_count", len(chunks),
			"total_token_count", totalTokens,
		)
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

type documentChunkBatch struct {
	Start    int
	End      int
	ChunkIDs []int64
	Texts    []string
}

type chunkBatchEmbeddingResult struct {
	Batch      documentChunkBatch
	Embeddings [][]float32
	Err        error
}

func (s service) insertChunkBatchRows(
	ctx context.Context,
	tx pgx.Tx,
	documentID int64,
	chunks []support.Chunk,
	start int,
	end int,
) (documentChunkBatch, error) {
	if len(chunks) == 0 {
		return documentChunkBatch{Start: start, End: end}, nil
	}

	chunkIDs := make([]int64, 0, len(chunks))
	chunkTexts := make([]string, 0, len(chunks))
	for _, chunk := range chunks {
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
			return documentChunkBatch{}, fmt.Errorf("insert document chunk for batch %d-%d: %w", start, end, err)
		}

		chunkIDs = append(chunkIDs, chunkID)
		chunkTexts = append(chunkTexts, chunk.Text)
	}

	return documentChunkBatch{
		Start:    start,
		End:      end,
		ChunkIDs: chunkIDs,
		Texts:    chunkTexts,
	}, nil
}

func (s service) embedAndPersistChunkBatches(
	ctx context.Context,
	tx pgx.Tx,
	document struct {
		ID                 int64
		FileAddress        string
		MIMEType           string
		Name               string
		EmbeddingModelID   int64
		EmbeddingDimension int32
		IndexVersion       int32
		ChunkSize          int32
		ChunkOverlap       int32
	},
	totalChunks int,
	batches []documentChunkBatch,
	maxConcurrentRequests int,
) error {
	if len(batches) == 0 {
		return nil
	}

	embedCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	results := make(chan chunkBatchEmbeddingResult, len(batches))
	group, groupCtx := errgroup.WithContext(embedCtx)
	group.SetLimit(maxConcurrentRequests)

	for _, batch := range batches {
		batch := batch
		group.Go(func() error {
			startedAt := time.Now()
			if s.logger != nil {
				s.logger.Info(
					"tei embedding batch started",
					"document_id", document.ID,
					"batch_start", batch.Start,
					"batch_end", batch.End,
					"batch_size", len(batch.Texts),
					"total_chunks", totalChunks,
					"embedding_dimension", document.EmbeddingDimension,
				)
			}

			embeddings, err := s.tei.Embed(groupCtx, batch.Texts, int(document.EmbeddingDimension))
			if err != nil {
				if s.logger != nil {
					s.logger.Error(
						"tei embedding batch failed",
						"document_id", document.ID,
						"batch_start", batch.Start,
						"batch_end", batch.End,
						"batch_size", len(batch.Texts),
						"total_chunks", totalChunks,
						"embedding_dimension", document.EmbeddingDimension,
						"duration_ms", time.Since(startedAt).Milliseconds(),
						"status", "failed",
						"error", err,
					)
				}
				results <- chunkBatchEmbeddingResult{
					Batch: batch,
					Err:   fmt.Errorf("embed document chunks with tei batch %d-%d: %w", batch.Start, batch.End, err),
				}
				return nil
			}
			if len(embeddings) != len(batch.ChunkIDs) {
				err := fmt.Errorf(
					"embed document chunks with tei batch %d-%d: expected %d embeddings, got %d",
					batch.Start,
					batch.End,
					len(batch.ChunkIDs),
					len(embeddings),
				)
				if s.logger != nil {
					s.logger.Error(
						"tei embedding batch returned unexpected count",
						"document_id", document.ID,
						"batch_start", batch.Start,
						"batch_end", batch.End,
						"batch_size", len(batch.Texts),
						"total_chunks", totalChunks,
						"embedding_dimension", document.EmbeddingDimension,
						"duration_ms", time.Since(startedAt).Milliseconds(),
						"status", "failed",
						"expected_embeddings", len(batch.ChunkIDs),
						"actual_embeddings", len(embeddings),
					)
				}
				results <- chunkBatchEmbeddingResult{Batch: batch, Err: err}
				return nil
			}

			if s.logger != nil {
				s.logger.Info(
					"tei embedding batch completed",
					"document_id", document.ID,
					"batch_start", batch.Start,
					"batch_end", batch.End,
					"batch_size", len(batch.Texts),
					"total_chunks", totalChunks,
					"embedding_dimension", document.EmbeddingDimension,
					"duration_ms", time.Since(startedAt).Milliseconds(),
					"status", "completed",
				)
			}

			results <- chunkBatchEmbeddingResult{
				Batch:      batch,
				Embeddings: embeddings,
			}
			return nil
		})
	}

	go func() {
		_ = group.Wait()
		close(results)
	}()

	pendingByStart := make(map[int]chunkBatchEmbeddingResult, len(batches))
	nextExpectedStart := batches[0].Start
	var (
		firstErr error
		errMu    sync.Mutex
	)

	setFirstErr := func(err error) {
		if err == nil {
			return
		}
		errMu.Lock()
		defer errMu.Unlock()
		if firstErr == nil {
			firstErr = err
			cancel()
		}
	}

	for result := range results {
		if result.Err != nil {
			setFirstErr(result.Err)
		}
		pendingByStart[result.Batch.Start] = result

		for {
			pendingResult, ok := pendingByStart[nextExpectedStart]
			if !ok {
				break
			}
			delete(pendingByStart, nextExpectedStart)
			if pendingResult.Err != nil {
				nextExpectedStart = pendingResult.Batch.End
				continue
			}
			setFirstErr(s.insertEmbeddingBatchRows(
				ctx,
				tx,
				document.EmbeddingModelID,
				document.IndexVersion,
				document.EmbeddingDimension,
				pendingResult.Batch,
				pendingResult.Embeddings,
			))
			nextExpectedStart = pendingResult.Batch.End
		}
	}

	if err := group.Wait(); err != nil {
		setFirstErr(err)
	}

	if firstErr != nil {
		return firstErr
	}

	return nil
}

func (s service) insertEmbeddingBatchRows(
	ctx context.Context,
	tx pgx.Tx,
	embeddingModelID int64,
	indexVersion int32,
	embeddingDimension int32,
	batch documentChunkBatch,
	embeddings [][]float32,
) error {
	for index, embedding := range embeddings {
		if _, err := tx.Exec(ctx, `
			INSERT INTO embeddings.embeddings (
				chunk_id,
				model_id,
				version,
				embedding,
				dimensionality
			) VALUES ($1, $2, $3, $4::vector, $5)
		`, batch.ChunkIDs[index], embeddingModelID, indexVersion, support.VectorLiteral(embedding), embeddingDimension); err != nil {
			return fmt.Errorf("insert chunk embedding for batch %d-%d: %w", batch.Start, batch.End, err)
		}
	}

	return nil
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
