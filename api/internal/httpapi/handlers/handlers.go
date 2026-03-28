package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"mimir/api/internal/app"
)

type Handler struct {
	app *app.App
}

func New(application *app.App) Handler {
	return Handler{app: application}
}

func respondJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errorResponse struct {
	Error errorDetail `json:"error"`
}

type validationIssue struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

type validationErrorResponse struct {
	Error  errorDetail       `json:"error"`
	Issues []validationIssue `json:"issues"`
}

func respondError(w http.ResponseWriter, status int, code, message string) {
	respondJSON(w, status, errorResponse{
		Error: errorDetail{
			Code:    code,
			Message: message,
		},
	})
}

func respondValidationError(w http.ResponseWriter, issues []validationIssue) {
	respondJSON(w, http.StatusUnprocessableEntity, validationErrorResponse{
		Error: errorDetail{
			Code:    "VALIDATION_ERROR",
			Message: "Request failed business validation.",
		},
		Issues: issues,
	})
}

func respondNotImplemented(w http.ResponseWriter, endpoint string) {
	respondError(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", endpoint+" is scaffolded but not implemented yet.")
}

func decodeJSON(r *http.Request, dst any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(dst); err != nil {
		return err
	}

	var extra any
	if err := decoder.Decode(&extra); err != nil {
		if errors.Is(err, io.EOF) {
			return nil
		}
		return errors.New("request body must contain a single JSON object")
	}

	return nil
}

func parsePathInt64(r *http.Request, name string) (int64, error) {
	raw := chi.URLParam(r, name)
	if raw == "" {
		return 0, fmt.Errorf("missing path parameter %q", name)
	}

	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 1 {
		return 0, fmt.Errorf("invalid %s", name)
	}

	return value, nil
}

func parsePagination(r *http.Request) (page int, limit int, err error) {
	page = 1
	limit = 20

	if raw := r.URL.Query().Get("page"); raw != "" {
		page, err = strconv.Atoi(raw)
		if err != nil || page < 1 {
			return 0, 0, errors.New("page must be a positive integer")
		}
	}

	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 100 {
			return 0, 0, errors.New("limit must be between 1 and 100")
		}
	}

	return page, limit, nil
}

func (h Handler) logInternalError(r *http.Request, operation string, err error, keyvals ...any) {
	attrs := []any{
		"request_id", middleware.GetReqID(r.Context()),
		"method", r.Method,
		"path", r.URL.Path,
		"operation", operation,
		"error", err,
	}
	attrs = append(attrs, keyvals...)
	h.app.Logger.Error("http handler failed", attrs...)
}
