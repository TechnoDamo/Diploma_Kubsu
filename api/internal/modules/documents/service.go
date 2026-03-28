package documents

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mimir/api/internal/config"
	"mimir/api/internal/infra/files"
	"mimir/api/internal/support"
)

var (
	ErrProjectNotFound   = errors.New("project not found")
	ErrDocumentNotFound  = errors.New("document not found")
	ErrProjectReindexing = errors.New("project is reindexing")
	ErrDocumentBusy      = errors.New("document has active jobs")
	ErrDocumentNotReady  = errors.New("document is not ready")
	ErrInvalidPagination = errors.New("invalid pagination")
	ErrFileTooLarge      = errors.New("file exceeds max upload size")
	ErrUnsupportedMedia  = errors.New("unsupported media type")
	ErrMissingUploadFile = errors.New("missing upload file")
)

var supportedMIMETypes = map[string]struct{}{
	"application/pdf": {},
	"text/plain":      {},
	"text/markdown":   {},
	"text/html":       {},
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": {},
}

type Service interface {
	List(ctx context.Context, projectID int64, page, limit int) (ListResult, error)
	Create(ctx context.Context, input CreateDocumentInput) (Document, error)
	Get(ctx context.Context, projectID, documentID int64) (Document, error)
	Delete(ctx context.Context, projectID, documentID int64) error
	GetText(ctx context.Context, projectID, documentID int64) (DocumentText, error)
	GetContent(ctx context.Context, projectID, documentID int64) (DocumentContent, error)
}

type service struct {
	db      *pgxpool.Pool
	storage files.Storage
	cfg     config.Config
}

type Document struct {
	ID        int64
	ProjectID int64
	Name      string
	SizeBytes int64
	MIMEType  string
	Status    string
	CreatedAt time.Time
	UpdatedAt time.Time
	FilePath  string
}

type ListResult struct {
	Items []Document
	Total int64
	Page  int
	Limit int
}

type CreateDocumentInput struct {
	ProjectID   int64
	DisplayName string
	Filename    string
	MIMEType    string
	Content     io.Reader
}

type DocumentText struct {
	DocumentID int64
	Text       string
}

type DocumentContent struct {
	DocumentID int64
	Name       string
	MIMEType   string
	File       *os.File
}

func NewService(db *pgxpool.Pool, storage files.Storage, cfg config.Config) Service {
	return service{
		db:      db,
		storage: storage,
		cfg:     cfg,
	}
}

func (s service) List(ctx context.Context, projectID int64, page, limit int) (ListResult, error) {
	if page < 1 || limit < 1 {
		return ListResult{}, ErrInvalidPagination
	}

	state, err := s.getProjectState(ctx, projectID)
	if err != nil {
		return ListResult{}, err
	}
	if !state.exists {
		return ListResult{}, ErrProjectNotFound
	}

	offset := (page - 1) * limit
	rows, err := s.db.Query(ctx, `
		SELECT
			d.id,
			d.project_id,
			d.name,
			d.file_size_bytes,
			d.mime_type,
			s.name AS status,
			d.created_at,
			d.updated_at,
			d.file_address
		FROM documents.documents AS d
		JOIN documents.document_statuses AS s
			ON s.id = d.document_status_id
		WHERE d.project_id = $1
		ORDER BY d.id DESC
		LIMIT $2 OFFSET $3
	`, projectID, limit, offset)
	if err != nil {
		return ListResult{}, fmt.Errorf("list documents: %w", err)
	}
	defer rows.Close()

	items := make([]Document, 0, limit)
	for rows.Next() {
		document, err := scanDocument(rows)
		if err != nil {
			return ListResult{}, err
		}
		items = append(items, document)
	}
	if err := rows.Err(); err != nil {
		return ListResult{}, fmt.Errorf("iterate document rows: %w", err)
	}

	var total int64
	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*)::BIGINT
		FROM documents.documents
		WHERE project_id = $1
	`, projectID).Scan(&total); err != nil {
		return ListResult{}, fmt.Errorf("count documents: %w", err)
	}

	return ListResult{
		Items: items,
		Total: total,
		Page:  page,
		Limit: limit,
	}, nil
}

func (s service) Create(ctx context.Context, input CreateDocumentInput) (Document, error) {
	if input.Content == nil {
		return Document{}, ErrMissingUploadFile
	}
	if _, ok := supportedMIMETypes[input.MIMEType]; !ok {
		return Document{}, ErrUnsupportedMedia
	}

	state, err := s.getProjectState(ctx, input.ProjectID)
	if err != nil {
		return Document{}, err
	}
	if !state.exists {
		return Document{}, ErrProjectNotFound
	}
	if state.reindexing {
		return Document{}, ErrProjectReindexing
	}

	savedFile, err := s.storage.Save(ctx, input.Filename, io.LimitReader(input.Content, s.cfg.HTTP.MaxUploadSizeBytes+1))
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return Document{}, err
		}
		return Document{}, err
	}
	if savedFile.SizeBytes > s.cfg.HTTP.MaxUploadSizeBytes {
		_ = s.storage.Delete(savedFile.RelativePath)
		return Document{}, ErrFileTooLarge
	}

	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" {
		displayName = input.Filename
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		_ = s.storage.Delete(savedFile.RelativePath)
		return Document{}, fmt.Errorf("begin create document tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var configSnapshot struct {
		ID                  int64
		IngestionPipelineID int64
		EmbeddingPipelineID int64
		EmbeddingModelID    int64
		EmbeddingDimension  int32
		Version             int32
		ParserName          string
		ParserVersion       sql.NullString
		ChunkingStrategy    string
		ChunkSize           int32
		ChunkOverlap        int32
		ChunkUnit           string
		TokenizerName       sql.NullString
	}
	err = tx.QueryRow(ctx, `
		SELECT
			id,
			ingestion_pipeline_id,
			embedding_pipeline_id,
			embedding_model_id,
			embedding_dimension,
			version,
			parser_name,
			parser_version,
			chunking_strategy,
			chunk_size,
			chunk_overlap,
			chunk_unit,
			tokenizer_name
		FROM documents.project_index_configs
		WHERE project_id = $1
		  AND status = 'active'
		ORDER BY version DESC
		LIMIT 1
	`, input.ProjectID).Scan(
		&configSnapshot.ID,
		&configSnapshot.IngestionPipelineID,
		&configSnapshot.EmbeddingPipelineID,
		&configSnapshot.EmbeddingModelID,
		&configSnapshot.EmbeddingDimension,
		&configSnapshot.Version,
		&configSnapshot.ParserName,
		&configSnapshot.ParserVersion,
		&configSnapshot.ChunkingStrategy,
		&configSnapshot.ChunkSize,
		&configSnapshot.ChunkOverlap,
		&configSnapshot.ChunkUnit,
		&configSnapshot.TokenizerName,
	)
	if err != nil {
		_ = s.storage.Delete(savedFile.RelativePath)
		return Document{}, fmt.Errorf("load active project index config: %w", err)
	}

	var document Document
	err = tx.QueryRow(ctx, `
		INSERT INTO documents.documents (
			project_id,
			project_index_config_id,
			document_status_id,
			ingestion_pipeline_id,
			embedding_pipeline_id,
			embedding_model_id,
			embedding_dimension,
			index_version,
			name,
			description,
			file_address,
			file_size_bytes,
			mime_type,
			checksum,
			language,
			parser_name,
			parser_version,
			chunking_strategy,
			chunk_size,
			chunk_overlap,
			chunk_unit,
			tokenizer_name,
			total_chunks,
			total_token_count
		)
		VALUES (
			$1,
			$2,
			(SELECT id FROM documents.document_statuses WHERE name = 'uploaded'),
			$3,
			$4,
			$5,
			$6,
			$7,
			$8,
			NULL,
			$9,
			$10,
			$11,
			$12,
			NULL,
			$13,
			$14,
			$15,
			$16,
			$17,
			$18,
			$19,
			0,
			0
		)
		RETURNING id, project_id, name, file_size_bytes, mime_type, created_at, updated_at, file_address
	`,
		input.ProjectID,
		configSnapshot.ID,
		configSnapshot.IngestionPipelineID,
		configSnapshot.EmbeddingPipelineID,
		configSnapshot.EmbeddingModelID,
		configSnapshot.EmbeddingDimension,
		configSnapshot.Version,
		displayName,
		savedFile.RelativePath,
		savedFile.SizeBytes,
		input.MIMEType,
		savedFile.Checksum,
		configSnapshot.ParserName,
		nullStringValue(configSnapshot.ParserVersion),
		configSnapshot.ChunkingStrategy,
		configSnapshot.ChunkSize,
		configSnapshot.ChunkOverlap,
		configSnapshot.ChunkUnit,
		nullStringValue(configSnapshot.TokenizerName),
	).Scan(
		&document.ID,
		&document.ProjectID,
		&document.Name,
		&document.SizeBytes,
		&document.MIMEType,
		&document.CreatedAt,
		&document.UpdatedAt,
		&document.FilePath,
	)
	if err != nil {
		_ = s.storage.Delete(savedFile.RelativePath)
		return Document{}, fmt.Errorf("insert document: %w", err)
	}
	document.Status = "uploaded"

	if _, err := tx.Exec(ctx, `
		INSERT INTO documents.document_processing_jobs (
			project_id,
			document_id,
			project_index_config_id,
			job_type,
			status
		) VALUES ($1, $2, $3, 'ingest', 'queued')
	`, input.ProjectID, document.ID, configSnapshot.ID); err != nil {
		_ = s.storage.Delete(savedFile.RelativePath)
		return Document{}, fmt.Errorf("enqueue document processing job: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO documents.document_history (
			document_id,
			operation_type_id,
			comment
		) VALUES (
			$1,
			(SELECT id FROM documents.document_operation_types WHERE name = 'uploaded'),
			$2
		)
	`, document.ID, "Document uploaded and queued for processing."); err != nil {
		_ = s.storage.Delete(savedFile.RelativePath)
		return Document{}, fmt.Errorf("insert upload history: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		_ = s.storage.Delete(savedFile.RelativePath)
		return Document{}, fmt.Errorf("commit create document tx: %w", err)
	}

	return document, nil
}

func (s service) Get(ctx context.Context, projectID, documentID int64) (Document, error) {
	document, err := s.loadDocument(ctx, projectID, documentID)
	if err != nil {
		return Document{}, err
	}
	return document, nil
}

func (s service) Delete(ctx context.Context, projectID, documentID int64) error {
	state, err := s.getProjectState(ctx, projectID)
	if err != nil {
		return err
	}
	if !state.exists {
		return ErrDocumentNotFound
	}
	if state.reindexing {
		return ErrProjectReindexing
	}

	document, err := s.loadDocument(ctx, projectID, documentID)
	if err != nil {
		return err
	}

	var activeDocumentJobs int64
	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*)::BIGINT
		FROM documents.document_processing_jobs
		WHERE document_id = $1
		  AND status IN ('queued', 'processing')
	`, documentID).Scan(&activeDocumentJobs); err != nil {
		return fmt.Errorf("count active document jobs: %w", err)
	}

	var activeAnalysisJobs int64
	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(DISTINCT j.id)::BIGINT
		FROM analysis.analysis_jobs AS j
		LEFT JOIN analysis.analysis_job_targets AS t
			ON t.analysis_job_id = j.id
		WHERE j.status IN ('queued', 'processing')
		  AND (j.base_document_id = $1 OR t.document_id = $1)
	`, documentID).Scan(&activeAnalysisJobs); err != nil {
		return fmt.Errorf("count active analysis jobs: %w", err)
	}

	if activeDocumentJobs > 0 || activeAnalysisJobs > 0 {
		return ErrDocumentBusy
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin delete document tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		DELETE FROM analysis.analysis_job_targets AS t
		USING analysis.analysis_jobs AS j
		WHERE t.analysis_job_id = j.id
		  AND t.document_id = $1
		  AND j.status IN ('completed', 'failed')
	`, documentID); err != nil {
		return fmt.Errorf("delete completed analysis target references: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM analysis.analysis_jobs
		WHERE base_document_id = $1
		  AND status IN ('completed', 'failed')
	`, documentID); err != nil {
		return fmt.Errorf("delete completed analysis jobs: %w", err)
	}

	commandTag, err := tx.Exec(ctx, `
		DELETE FROM documents.documents
		WHERE project_id = $1
		  AND id = $2
	`, projectID, documentID)
	if err != nil {
		return fmt.Errorf("delete document: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return ErrDocumentNotFound
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit delete document tx: %w", err)
	}

	if err := s.storage.Delete(document.FilePath); err != nil {
		return nil
	}

	return nil
}

func (s service) GetText(ctx context.Context, projectID, documentID int64) (DocumentText, error) {
	document, err := s.loadDocument(ctx, projectID, documentID)
	if err != nil {
		return DocumentText{}, err
	}
	if document.Status != "indexed" {
		return DocumentText{}, ErrDocumentNotReady
	}

	rows, err := s.db.Query(ctx, `
		SELECT chunk_text, char_start, char_end
		FROM documents.document_chunks
		WHERE document_id = $1
		ORDER BY chunk_order_id
	`, documentID)
	if err != nil {
		return DocumentText{}, fmt.Errorf("load document chunks: %w", err)
	}
	defer rows.Close()

	type chunk struct {
		text      string
		charStart int
		charEnd   int
	}

	chunks := make([]chunk, 0)
	maxEnd := 0
	for rows.Next() {
		var current chunk
		if err := rows.Scan(&current.text, &current.charStart, &current.charEnd); err != nil {
			return DocumentText{}, fmt.Errorf("scan document chunk: %w", err)
		}
		chunks = append(chunks, current)
		if current.charEnd > maxEnd {
			maxEnd = current.charEnd
		}
	}
	if err := rows.Err(); err != nil {
		return DocumentText{}, fmt.Errorf("iterate document chunks: %w", err)
	}

	if len(chunks) == 0 {
		return DocumentText{DocumentID: documentID, Text: ""}, nil
	}

	supportChunks := make([]support.Chunk, 0, len(chunks))
	for _, chunk := range chunks {
		supportChunks = append(supportChunks, support.Chunk{
			Text:      chunk.text,
			CharStart: chunk.charStart,
			CharEnd:   chunk.charEnd,
			CharCount: chunk.charEnd - chunk.charStart,
		})
	}

	return DocumentText{
		DocumentID: documentID,
		Text:       strings.TrimRight(support.ReconstructText(supportChunks), "\x00"),
	}, nil
}

func (s service) GetContent(ctx context.Context, projectID, documentID int64) (DocumentContent, error) {
	document, err := s.loadDocument(ctx, projectID, documentID)
	if err != nil {
		return DocumentContent{}, err
	}

	file, err := s.storage.Open(document.FilePath)
	if err != nil {
		return DocumentContent{}, err
	}

	return DocumentContent{
		DocumentID: document.ID,
		Name:       document.Name,
		MIMEType:   document.MIMEType,
		File:       file,
	}, nil
}

type projectState struct {
	exists     bool
	reindexing bool
}

func (s service) getProjectState(ctx context.Context, projectID int64) (projectState, error) {
	var exists bool
	if err := s.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM documents.projects WHERE id = $1
		)
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
		return projectState{}, fmt.Errorf("check project reindex status: %w", err)
	}

	return projectState{
		exists:     true,
		reindexing: reindexing,
	}, nil
}

func (s service) loadDocument(ctx context.Context, projectID, documentID int64) (Document, error) {
	row := s.db.QueryRow(ctx, `
		SELECT
			d.id,
			d.project_id,
			d.name,
			d.file_size_bytes,
			d.mime_type,
			s.name AS status,
			d.created_at,
			d.updated_at,
			d.file_address
		FROM documents.documents AS d
		JOIN documents.document_statuses AS s
			ON s.id = d.document_status_id
		WHERE d.project_id = $1
		  AND d.id = $2
	`, projectID, documentID)

	document, err := scanDocument(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Document{}, ErrDocumentNotFound
		}
		return Document{}, err
	}

	return document, nil
}

type documentScanner interface {
	Scan(dest ...any) error
}

func scanDocument(scanner documentScanner) (Document, error) {
	var document Document
	if err := scanner.Scan(
		&document.ID,
		&document.ProjectID,
		&document.Name,
		&document.SizeBytes,
		&document.MIMEType,
		&document.Status,
		&document.CreatedAt,
		&document.UpdatedAt,
		&document.FilePath,
	); err != nil {
		return Document{}, fmt.Errorf("scan document: %w", err)
	}

	return document, nil
}

func nullStringValue(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}
