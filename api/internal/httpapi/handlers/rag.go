package handlers

import (
	"errors"
	"net/http"
	"strings"

	"mimir/api/internal/modules/rag"
)

type ragQueryRequest struct {
	Question          string  `json:"question" validate:"required,max=10000"`
	TargetDocumentIDs []int64 `json:"target_document_ids"`
}

type citationResponse struct {
	DocumentID   int64  `json:"document_id"`
	DocumentName string `json:"document_name"`
	Snippet      string `json:"snippet"`
}

type ragQueryResponse struct {
	Answer         string             `json:"answer"`
	WarningMessage *string            `json:"warning_message,omitempty"`
	Citations      []citationResponse `json:"citations"`
}

func (h Handler) QueryRAG(w http.ResponseWriter, r *http.Request) {
	projectID, err := parsePathInt64(r, "projectId")
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Request is malformed.")
		return
	}

	var req ragQueryRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Request is malformed.")
		return
	}
	req.Question = strings.TrimSpace(req.Question)

	if err := h.app.Validator.Struct(req); err != nil {
		respondValidationError(w, []validationIssue{{Field: "question", Message: "must not be empty"}})
		return
	}

	result, err := h.app.RAG.Query(r.Context(), rag.QueryInput{
		ProjectID:         projectID,
		Question:          req.Question,
		TargetDocumentIDs: req.TargetDocumentIDs,
	})
	if err != nil {
		switch {
		case errors.Is(err, rag.ErrProjectNotFound):
			respondError(w, http.StatusNotFound, "PROJECT_NOT_FOUND", "Project does not exist.")
		case errors.Is(err, rag.ErrProjectReindexing):
			respondError(w, http.StatusConflict, "PROJECT_REINDEXING", "Project is temporarily unavailable because reindexing is in progress.")
		case errors.Is(err, rag.ErrTEIUnavailable):
			respondError(w, http.StatusServiceUnavailable, "EMBEDDING_DEPENDENCY_UNAVAILABLE", "Embedding service is unavailable.")
		case errors.Is(err, rag.ErrLLMUnavailable):
			respondError(w, http.StatusServiceUnavailable, "LLM_DEPENDENCY_UNAVAILABLE", "LLM service is unavailable.")
		default:
			respondError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Unexpected internal server error.")
		}
		return
	}

	citations := make([]citationResponse, 0, len(result.Citations))
	for _, citation := range result.Citations {
		citations = append(citations, citationResponse{
			DocumentID:   citation.DocumentID,
			DocumentName: citation.DocumentName,
			Snippet:      citation.Snippet,
		})
	}

	respondJSON(w, http.StatusOK, ragQueryResponse{
		Answer:         result.Answer,
		WarningMessage: result.WarningMessage,
		Citations:      citations,
	})
}
