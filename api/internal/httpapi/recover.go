package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"runtime/debug"

	chimiddleware "github.com/go-chi/chi/v5/middleware"

	"mimir/api/internal/app"
)

type recovererErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type recovererErrorResponse struct {
	Error recovererErrorDetail `json:"error"`
}

func jsonRecovererMiddleware(application *app.App) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					requestID := chimiddleware.GetReqID(r.Context())
					application.Logger.Error(
						"http panic recovered",
						"request_id", requestID,
						"method", r.Method,
						"path", r.URL.Path,
						"panic", fmt.Sprintf("%v", rec),
						"stack", string(debug.Stack()),
					)

					w.Header().Set("Content-Type", "application/json")
					if requestID != "" {
						w.Header().Set("X-Request-ID", requestID)
					}
					w.WriteHeader(http.StatusInternalServerError)
					_ = json.NewEncoder(w).Encode(recovererErrorResponse{
						Error: recovererErrorDetail{
							Code:    "INTERNAL_SERVER_ERROR",
							Message: "Unexpected internal server error.",
						},
					})
				}
			}()

			next.ServeHTTP(w, r)
		})
	}
}
