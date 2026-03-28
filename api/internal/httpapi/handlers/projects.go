package handlers

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-playground/validator/v10"

	"mimir/api/internal/modules/projects"
)

type createProjectRequest struct {
	Name        string  `json:"name" validate:"required,max=200"`
	Description *string `json:"description" validate:"omitempty,max=2000"`
}

type projectResponse struct {
	ID            int64   `json:"id"`
	Name          string  `json:"name"`
	Description   *string `json:"description,omitempty"`
	DocumentCount int64   `json:"document_count"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

type projectListResponse struct {
	Items []projectResponse `json:"items"`
	Total int64             `json:"total"`
	Page  int               `json:"page"`
	Limit int               `json:"limit"`
}

func (h Handler) ListProjects(w http.ResponseWriter, r *http.Request) {
	page, limit, err := parsePagination(r)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	result, err := h.app.Projects.List(r.Context(), page, limit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Unexpected internal server error.")
		return
	}

	items := make([]projectResponse, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, mapProjectResponse(item))
	}

	respondJSON(w, http.StatusOK, projectListResponse{
		Items: items,
		Total: result.Total,
		Page:  result.Page,
		Limit: result.Limit,
	})
}

func (h Handler) CreateProject(w http.ResponseWriter, r *http.Request) {
	var req createProjectRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Request is malformed.")
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Description != nil {
		trimmed := strings.TrimSpace(*req.Description)
		req.Description = &trimmed
	}

	if err := h.app.Validator.Struct(req); err != nil {
		respondValidationError(w, buildProjectValidationIssues(err))
		return
	}

	project, err := h.app.Projects.Create(r.Context(), projects.CreateProjectInput{
		Name:        req.Name,
		Description: req.Description,
		Context:     "",
	})
	if err != nil {
		switch {
		case errors.Is(err, projects.ErrProjectAlreadyExists):
			respondError(w, http.StatusConflict, "PROJECT_ALREADY_EXISTS", "Project with the same name already exists.")
		default:
			respondError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Unexpected internal server error.")
		}
		return
	}

	respondJSON(w, http.StatusCreated, mapProjectResponse(project))
}

func (h Handler) GetProject(w http.ResponseWriter, r *http.Request) {
	projectID, err := parsePathInt64(r, "projectId")
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Request is malformed.")
		return
	}

	project, err := h.app.Projects.Get(r.Context(), projectID)
	if err != nil {
		switch {
		case errors.Is(err, projects.ErrProjectNotFound):
			respondError(w, http.StatusNotFound, "PROJECT_NOT_FOUND", "Project does not exist.")
		default:
			respondError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Unexpected internal server error.")
		}
		return
	}

	respondJSON(w, http.StatusOK, mapProjectResponse(project))
}

func (h Handler) DeleteProject(w http.ResponseWriter, r *http.Request) {
	projectID, err := parsePathInt64(r, "projectId")
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Request is malformed.")
		return
	}

	err = h.app.Projects.Delete(r.Context(), projectID)
	if err != nil {
		switch {
		case errors.Is(err, projects.ErrProjectNotFound):
			respondError(w, http.StatusNotFound, "PROJECT_NOT_FOUND", "Project does not exist.")
		case errors.Is(err, projects.ErrProjectBusy):
			respondError(w, http.StatusConflict, "PROJECT_HAS_ACTIVE_JOBS", "Project cannot be deleted while active jobs are running.")
		default:
			respondError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Unexpected internal server error.")
		}
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func mapProjectResponse(project projects.Project) projectResponse {
	return projectResponse{
		ID:            project.ID,
		Name:          project.Name,
		Description:   project.Description,
		DocumentCount: project.DocumentCount,
		CreatedAt:     project.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:     project.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func buildProjectValidationIssues(err error) []validationIssue {
	var validationErrors validator.ValidationErrors
	if !errors.As(err, &validationErrors) {
		return []validationIssue{{Field: "request", Message: "request validation failed"}}
	}

	issues := make([]validationIssue, 0, len(validationErrors))
	for _, validationErr := range validationErrors {
		switch validationErr.Field() {
		case "Name":
			switch validationErr.Tag() {
			case "required":
				issues = append(issues, validationIssue{Field: "name", Message: "must not be empty"})
			case "max":
				issues = append(issues, validationIssue{Field: "name", Message: "must be 200 characters or fewer"})
			}
		case "Description":
			if validationErr.Tag() == "max" {
				issues = append(issues, validationIssue{Field: "description", Message: "must be 2000 characters or fewer"})
			}
		}
	}

	if len(issues) == 0 {
		return []validationIssue{{Field: "request", Message: "request validation failed"}}
	}

	return issues
}
