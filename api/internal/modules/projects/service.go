package projects

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"mimir/api/internal/config"
)

var (
	ErrProjectNotFound      = errors.New("project not found")
	ErrProjectAlreadyExists = errors.New("project already exists")
	ErrProjectBusy          = errors.New("project has active jobs")
	ErrInvalidPagination    = errors.New("invalid pagination")
)

type Service interface {
	List(ctx context.Context, page, limit int) (ListResult, error)
	Create(ctx context.Context, input CreateProjectInput) (Project, error)
	Get(ctx context.Context, projectID int64) (Project, error)
	Delete(ctx context.Context, projectID int64) error
}

type service struct {
	db       *pgxpool.Pool
	defaults config.ProjectIndexDefaultsConfig
}

type Project struct {
	ID            int64
	Name          string
	Description   *string
	DocumentCount int64
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type ListResult struct {
	Items []Project
	Total int64
	Page  int
	Limit int
}

type CreateProjectInput struct {
	Name        string
	Description *string
	Context     string
}

func NewService(db *pgxpool.Pool, defaults config.ProjectIndexDefaultsConfig) Service {
	return service{
		db:       db,
		defaults: defaults,
	}
}

func (s service) List(ctx context.Context, page, limit int) (ListResult, error) {
	if page < 1 || limit < 1 {
		return ListResult{}, ErrInvalidPagination
	}

	offset := (page - 1) * limit
	rows, err := s.db.Query(ctx, `
		SELECT
			p.id,
			p.name,
			p.description,
			p.created_at,
			p.updated_at,
			COUNT(d.id)::BIGINT AS document_count
		FROM documents.projects AS p
		LEFT JOIN documents.documents AS d
			ON d.project_id = p.id
		GROUP BY p.id
		ORDER BY p.id DESC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return ListResult{}, fmt.Errorf("list projects: %w", err)
	}
	defer rows.Close()

	items := make([]Project, 0, limit)
	for rows.Next() {
		project, err := scanProject(rows)
		if err != nil {
			return ListResult{}, err
		}
		items = append(items, project)
	}
	if err := rows.Err(); err != nil {
		return ListResult{}, fmt.Errorf("iterate project rows: %w", err)
	}

	var total int64
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*)::BIGINT FROM documents.projects`).Scan(&total); err != nil {
		return ListResult{}, fmt.Errorf("count projects: %w", err)
	}

	return ListResult{
		Items: items,
		Total: total,
		Page:  page,
		Limit: limit,
	}, nil
}

func (s service) Create(ctx context.Context, input CreateProjectInput) (Project, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Project{}, fmt.Errorf("begin project create tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var project Project
	var description sql.NullString
	err = tx.QueryRow(ctx, `
		INSERT INTO documents.projects (
			name,
			description,
			context
		) VALUES ($1, $2, $3)
		RETURNING id, name, description, created_at, updated_at
	`, input.Name, nullableString(input.Description), input.Context).Scan(
		&project.ID,
		&project.Name,
		&description,
		&project.CreatedAt,
		&project.UpdatedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return Project{}, ErrProjectAlreadyExists
		}
		return Project{}, fmt.Errorf("insert project: %w", err)
	}

	var embeddingModelID int64
	err = tx.QueryRow(ctx, `
		SELECT id
		FROM embeddings.embedding_models
		WHERE name = $1
	`, s.defaults.EmbeddingModelName).Scan(&embeddingModelID)
	if err != nil {
		return Project{}, fmt.Errorf("resolve default embedding model %q: %w", s.defaults.EmbeddingModelName, err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO documents.project_index_configs (
			project_id,
			ingestion_pipeline_id,
			embedding_pipeline_id,
			embedding_model_id,
			embedding_dimension,
			parser_name,
			parser_version,
			chunking_strategy,
			chunk_size,
			chunk_overlap,
			chunk_unit,
			tokenizer_name,
			status,
			version
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', 1
		)
	`,
		project.ID,
		s.defaults.IngestionPipelineID,
		s.defaults.EmbeddingPipelineID,
		embeddingModelID,
		s.defaults.EmbeddingDimension,
		s.defaults.ParserName,
		nullableStringValue(s.defaults.ParserVersion),
		s.defaults.ChunkingStrategy,
		s.defaults.ChunkSize,
		s.defaults.ChunkOverlap,
		s.defaults.ChunkUnit,
		nullableStringValue(s.defaults.TokenizerName),
	)
	if err != nil {
		return Project{}, fmt.Errorf("insert default project index config: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Project{}, fmt.Errorf("commit project create tx: %w", err)
	}

	project.DocumentCount = 0
	project.Description = nullableStringPtr(description)
	return project, nil
}

func (s service) Get(ctx context.Context, projectID int64) (Project, error) {
	row := s.db.QueryRow(ctx, `
		SELECT
			p.id,
			p.name,
			p.description,
			p.created_at,
			p.updated_at,
			COUNT(d.id)::BIGINT AS document_count
		FROM documents.projects AS p
		LEFT JOIN documents.documents AS d
			ON d.project_id = p.id
		WHERE p.id = $1
		GROUP BY p.id
	`, projectID)

	project, err := scanProject(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Project{}, ErrProjectNotFound
		}
		return Project{}, err
	}

	return project, nil
}

func (s service) Delete(ctx context.Context, projectID int64) error {
	var activeDocumentJobs int64
	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*)::BIGINT
		FROM documents.document_processing_jobs
		WHERE project_id = $1
		  AND status IN ('queued', 'processing')
	`, projectID).Scan(&activeDocumentJobs); err != nil {
		return fmt.Errorf("count active document jobs: %w", err)
	}

	var activeAnalysisJobs int64
	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*)::BIGINT
		FROM analysis.analysis_jobs
		WHERE project_id = $1
		  AND status IN ('queued', 'processing')
	`, projectID).Scan(&activeAnalysisJobs); err != nil {
		return fmt.Errorf("count active analysis jobs: %w", err)
	}

	var reindexingConfigs int64
	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*)::BIGINT
		FROM documents.project_index_configs
		WHERE project_id = $1
		  AND status = 'reindexing'
	`, projectID).Scan(&reindexingConfigs); err != nil {
		return fmt.Errorf("count reindexing configs: %w", err)
	}

	if activeDocumentJobs > 0 || activeAnalysisJobs > 0 || reindexingConfigs > 0 {
		return ErrProjectBusy
	}

	commandTag, err := s.db.Exec(ctx, `
		DELETE FROM documents.projects
		WHERE id = $1
	`, projectID)
	if err != nil {
		return fmt.Errorf("delete project: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return ErrProjectNotFound
	}

	return nil
}

type projectScanner interface {
	Scan(dest ...any) error
}

func scanProject(scanner projectScanner) (Project, error) {
	var project Project
	var description sql.NullString
	if err := scanner.Scan(
		&project.ID,
		&project.Name,
		&description,
		&project.CreatedAt,
		&project.UpdatedAt,
		&project.DocumentCount,
	); err != nil {
		return Project{}, fmt.Errorf("scan project: %w", err)
	}

	project.Description = nullableStringPtr(description)
	return project, nil
}

func nullableString(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	return *value
}

func nullableStringValue(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullableStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	result := value.String
	return &result
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
