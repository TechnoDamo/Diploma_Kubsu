package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"mimir/api/internal/app"
	"mimir/api/internal/config"
	"mimir/api/internal/httpapi"
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

	server := &http.Server{
		Addr:         fmt.Sprintf("%s:%d", cfg.HTTP.Host, cfg.HTTP.Port),
		Handler:      httpapi.NewRouter(application),
		ReadTimeout:  cfg.HTTP.ReadTimeout,
		WriteTimeout: cfg.HTTP.WriteTimeout,
		IdleTimeout:  cfg.HTTP.IdleTimeout,
	}

	application.Logger.Info("api starting", "addr", server.Addr, "env", cfg.AppEnv)

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*cfg.HTTP.ReadTimeout)
		defer cancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			application.Logger.Error("api shutdown failed", "error", err)
		}
	}()

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		application.Logger.Error("api server failed", "error", err)
		os.Exit(1)
	}
}
