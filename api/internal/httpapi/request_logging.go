package httpapi

import (
	"net/http"
	"time"

	chimiddleware "github.com/go-chi/chi/v5/middleware"

	"mimir/api/internal/app"
)

type loggingResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *loggingResponseWriter) WriteHeader(statusCode int) {
	w.statusCode = statusCode
	w.ResponseWriter.WriteHeader(statusCode)
}

func requestLoggingMiddleware(application *app.App) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requestID := chimiddleware.GetReqID(r.Context())
			if requestID != "" {
				w.Header().Set("X-Request-ID", requestID)
			}

			startedAt := time.Now()
			application.Logger.Info(
				"http request started",
				"request_id", requestID,
				"method", r.Method,
				"path", r.URL.Path,
				"query", r.URL.RawQuery,
				"remote_addr", r.RemoteAddr,
				"request_body", r.Body,
			)

			writer := &loggingResponseWriter{
				ResponseWriter: w,
				statusCode:     http.StatusOK,
			}

			next.ServeHTTP(writer, r)

			application.Logger.Info(
				"http request completed",
				"request_id", requestID,
				"method", r.Method,
				"path", r.URL.Path,
				"status_code", writer.statusCode,
				"duration_ms", time.Since(startedAt).Milliseconds(),
				"response_body", r.Response,
			)
		})
	}
}
