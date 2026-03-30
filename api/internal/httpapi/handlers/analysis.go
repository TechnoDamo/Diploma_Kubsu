package handlers

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"
	"mimir/api/internal/modules/analysis"
)

type startContradictionAnalysisRequest struct {
	BaseDocumentID    int64   `json:"base_document_id" validate:"required"`
	TargetDocumentIDs []int64 `json:"target_document_ids"`
}

type acceptedAnalysisResponse struct {
	JobID          int64   `json:"job_id"`
	Status         string  `json:"status"`
	PollURL        string  `json:"poll_url"`
	WarningMessage *string `json:"warning_message,omitempty"`
}

type contradictionResponse struct {
	BaseText         string  `json:"base_text"`
	TargetText       string  `json:"target_text"`
	Confidence       float64 `json:"confidence"`
	Explanation      string  `json:"explanation"`
	BaseChunkOrder   int     `json:"base_chunk_order"`
	TargetChunkOrder int     `json:"target_chunk_order"`
}

type contradictionResultResponse struct {
	TargetDocumentID   int64                   `json:"target_document_id"`
	TargetDocumentName string                  `json:"target_document_name"`
	Summary            string                  `json:"summary"`
	Contradictions     []contradictionResponse `json:"contradictions"`
}

type analysisJobResponse struct {
	JobID          int64                         `json:"job_id"`
	Status         string                        `json:"status"`
	WarningMessage *string                       `json:"warning_message,omitempty"`
	Results        []contradictionResultResponse `json:"results,omitempty"`
	ErrorMessage   *string                       `json:"error_message,omitempty"`
}

func (h Handler) StartContradictionAnalysis(w http.ResponseWriter, r *http.Request) {
	projectID, err := parsePathInt64(r, "projectId")
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Request is malformed.")
		return
	}

	var req startContradictionAnalysisRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Request is malformed.")
		return
	}
	if err := h.app.Validator.Struct(req); err != nil {
		respondValidationError(w, []validationIssue{{Field: "base_document_id", Message: "must be provided"}})
		return
	}

	job, err := h.app.Analysis.StartContradictionAnalysis(r.Context(), analysis.StartContradictionAnalysisInput{
		ProjectID:         projectID,
		BaseDocumentID:    req.BaseDocumentID,
		TargetDocumentIDs: req.TargetDocumentIDs,
	})
	if err != nil {
		switch {
		case errors.Is(err, analysis.ErrProjectNotFound):
			respondError(w, http.StatusNotFound, "PROJECT_NOT_FOUND", "Project does not exist.")
		case errors.Is(err, analysis.ErrProjectReindexing):
			respondError(w, http.StatusConflict, "PROJECT_REINDEXING", "Project is temporarily unavailable because reindexing is in progress.")
		case errors.Is(err, analysis.ErrBaseDocumentNotReady):
			respondError(w, http.StatusConflict, "DOCUMENT_NOT_READY", "Base document is not indexed yet and cannot be used for contradiction analysis.")
		case errors.Is(err, analysis.ErrLLMUnavailable):
			respondError(w, http.StatusServiceUnavailable, "LLM_DEPENDENCY_UNAVAILABLE", "LLM service is unavailable.")
		default:
			h.logInternalError(r, "start contradiction analysis", err, "project_id", projectID, "base_document_id", req.BaseDocumentID, "target_document_count", len(req.TargetDocumentIDs))
			respondError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Unexpected internal server error.")
		}
		return
	}

	h.app.Logger.Info(
		"analysis job accepted via http",
		"request_id", middleware.GetReqID(r.Context()),
		"project_id", projectID,
		"job_id", job.JobID,
		"base_document_id", req.BaseDocumentID,
	)

	w.Header().Set("Location", job.PollURL)
	respondJSON(w, http.StatusAccepted, acceptedAnalysisResponse{
		JobID:          job.JobID,
		Status:         job.Status,
		PollURL:        job.PollURL,
		WarningMessage: job.WarningMessage,
	})
}

func (h Handler) GetContradictionAnalysis(w http.ResponseWriter, r *http.Request) {
	projectID, err := parsePathInt64(r, "projectId")
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Request is malformed.")
		return
	}
	jobID, err := parsePathInt64(r, "jobId")
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Request is malformed.")
		return
	}

	job, err := h.app.Analysis.GetJob(r.Context(), projectID, jobID)
	if err != nil {
		switch {
		case errors.Is(err, analysis.ErrJobNotFound):
			respondError(w, http.StatusNotFound, "ANALYSIS_JOB_NOT_FOUND", "Analysis job does not exist in this project.")
		default:
			h.logInternalError(r, "get contradiction analysis", err, "project_id", projectID, "job_id", jobID)
			respondError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Unexpected internal server error.")
		}
		return
	}

	results := make([]contradictionResultResponse, 0, len(job.Results))
	for _, result := range job.Results {
		contradictions := make([]contradictionResponse, 0, len(result.Contradictions))
		for _, item := range result.Contradictions {
			contradictions = append(contradictions, contradictionResponse{
				BaseText:         item.BaseText,
				TargetText:       item.TargetText,
				Confidence:       item.Confidence,
				Explanation:      item.Explanation,
				BaseChunkOrder:   item.BaseChunkOrder,
				TargetChunkOrder: item.TargetChunkOrder,
			})
		}
		results = append(results, contradictionResultResponse{
			TargetDocumentID:   result.TargetDocumentID,
			TargetDocumentName: result.TargetDocumentName,
			Summary:            result.Summary,
			Contradictions:     contradictions,
		})
	}

	respondJSON(w, http.StatusOK, analysisJobResponse{
		JobID:          job.JobID,
		Status:         job.Status,
		WarningMessage: job.WarningMessage,
		Results:        results,
		ErrorMessage:   job.ErrorMessage,
	})
}
