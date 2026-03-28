package worker

import (
	"context"
	"time"

	"mimir/api/internal/app"
	"mimir/api/internal/config"
)

type Worker struct {
	app *app.App
	cfg config.WorkerConfig
}

func New(application *app.App) Worker {
	return Worker{
		app: application,
		cfg: application.Config.Worker,
	}
}

func (w Worker) Run(ctx context.Context) error {
	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()

	w.app.Logger.Info("worker started", "poll_interval", w.cfg.PollInterval, "batch_size", w.cfg.BatchSize)

	for {
		select {
		case <-ctx.Done():
			w.app.Logger.Info("worker stopped")
			return ctx.Err()
		case <-ticker.C:
			w.runDocumentProcessingPass(ctx)
			w.runAnalysisPass(ctx)
		}
	}
}

func (w Worker) runDocumentProcessingPass(ctx context.Context) {
	processed, err := w.app.Indexing.ProcessNextDocumentJob(ctx)
	if err != nil {
		w.app.Logger.Error("document processing pass failed", "error", err)
		return
	}
	if processed {
		w.app.Logger.Info("document processing job handled")
	}
}

func (w Worker) runAnalysisPass(ctx context.Context) {
	processed, err := w.app.Analysis.ProcessNextQueuedJob(ctx)
	if err != nil {
		w.app.Logger.Error("analysis processing pass failed", "error", err)
		return
	}
	if processed {
		w.app.Logger.Info("analysis job handled")
	}
}
