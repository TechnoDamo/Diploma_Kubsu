package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"mimir/api/internal/app"
	"mimir/api/internal/config"
	"mimir/api/internal/worker"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		panic(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	application, err := app.NewWithModules(ctx, cfg)
	if err != nil {
		panic(err)
	}
	defer application.Close()

	backgroundWorker := worker.New(application)
	if err := backgroundWorker.Run(ctx); err != nil && err != context.Canceled {
		application.Logger.Error("worker failed", "error", err)
		os.Exit(1)
	}
}
