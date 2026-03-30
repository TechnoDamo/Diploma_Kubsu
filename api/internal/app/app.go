package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5/pgxpool"

	"mimir/api/internal/config"
	"mimir/api/internal/infra/db"
	"mimir/api/internal/infra/docling"
	"mimir/api/internal/infra/files"
	"mimir/api/internal/infra/llm"
	"mimir/api/internal/infra/tei"
	"mimir/api/internal/logging"
	"mimir/api/internal/modules/analysis"
	"mimir/api/internal/modules/documents"
	"mimir/api/internal/modules/indexing"
	"mimir/api/internal/modules/projects"
	"mimir/api/internal/modules/rag"
	"mimir/api/internal/prompts"
)

type App struct {
	Config    config.Config
	Logger    *slog.Logger
	Validator *validator.Validate
	DB        *pgxpool.Pool
	Files     files.Storage
	Docling   docling.Client
	TEI       tei.Client
	LLM       llm.Client
	Prompts   prompts.Bundle

	Projects  projects.Service
	Documents documents.Service
	RAG       rag.Service
	Analysis  analysis.Service
	Indexing  indexing.Service
}

func New(ctx context.Context, cfg config.Config) (*App, error) {
	pool, err := db.NewPool(ctx, cfg.Postgres)
	if err != nil {
		return nil, fmt.Errorf("create postgres pool: %w", err)
	}

	storage := files.New(cfg.Files.RootDir)
	if err := storage.EnsureRootDir(); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ensure file storage root: %w", err)
	}

	promptBundle, err := prompts.Load(cfg.Prompts.Dir)
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("load prompt templates: %w", err)
	}

	llmClient, err := llm.NewClient(cfg.LLM)
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("build llm client: %w", err)
	}

	teiClient := tei.New(cfg.TEI.BaseURL, cfg.TEIHTTPTimeout)
	if cfg.DependencyStartupChecksEnabled {
		checkCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()

		if err := teiClient.CheckAvailability(checkCtx, int(cfg.ProjectIndexDefaults.EmbeddingDimension)); err != nil {
			pool.Close()
			return nil, fmt.Errorf("tei dependency startup check failed: %w", err)
		}
		if err := llmClient.CheckAvailability(checkCtx); err != nil {
			pool.Close()
			return nil, fmt.Errorf("llm dependency startup check failed: %w", err)
		}
	}

	return &App{
		Config:    cfg,
		Logger:    logging.New(cfg.LogLevel),
		Validator: validator.New(),
		DB:        pool,
		Files:     storage,
		Docling:   docling.New(cfg.Docling.BaseURL),
		TEI:       teiClient,
		LLM:       llmClient,
		Prompts:   promptBundle,
	}, nil
}

func NewWithModules(ctx context.Context, cfg config.Config) (*App, error) {
	application, err := New(ctx, cfg)
	if err != nil {
		return nil, err
	}

	application.Projects = projects.NewService(application.DB, cfg.ProjectIndexDefaults)
	application.Documents = documents.NewService(application.DB, application.Files, cfg)
	application.RAG = rag.NewService(application.DB, application.TEI, application.LLM, application.Prompts, cfg, application.Logger)
	application.Analysis = analysis.NewService(application.DB, application.LLM, application.Prompts, cfg, application.Logger)
	application.Indexing = indexing.NewService(application.DB, application.Files, application.Docling, application.TEI, cfg, application.Logger)

	return application, nil
}

func (a *App) Close() {
	if a == nil || a.DB == nil {
		return
	}

	a.DB.Close()
}
