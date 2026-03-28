package handlers

import (
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"mimir/api/internal/modules/documents"
)

type documentResponse struct {
	ID        int64  `json:"id"`
	ProjectID int64  `json:"project_id"`
	Name      string `json:"name"`
	SizeBytes int64  `json:"size_bytes"`
	MIMEType  string `json:"mime_type"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type documentListResponse struct {
	Items []documentResponse `json:"items"`
	Total int64              `json:"total"`
	Page  int                `json:"page"`
	Limit int                `json:"limit"`
}

type documentTextResponse struct {
	DocumentID int64  `json:"document_id"`
	Text       string `json:"text"`
}

func (h Handler) ListDocuments(w http.ResponseWriter, r *http.Request) {
	projectID, err := parsePathInt64(r, "projectId")
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Request is malformed.")
		return
	}

	page, limit, err := parsePagination(r)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	result, err := h.app.Documents.List(r.Context(), projectID, page, limit)
	if err != nil {
		switch {
		case errors.Is(err, documents.ErrProjectNotFound):
			respondError(w, http.StatusNotFound, "PROJECT_NOT_FOUND", "Project does not exist.")
		default:
			respondError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Unexpected internal server error.")
		}
		return
	}

	items := make([]documentResponse, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, mapDocumentResponse(item))
	}

	respondJSON(w, http.StatusOK, documentListResponse{
		Items: items,
		Total: result.Total,
		Page:  result.Page,
		Limit: result.Limit,
	})
}

func (h Handler) UploadDocument(w http.ResponseWriter, r *http.Request) {
	projectID, err := parsePathInt64(r, "projectId")
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Request is malformed.")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, h.app.Config.HTTP.MaxUploadSizeBytes+1024)
	if err := r.ParseMultipartForm(h.app.Config.HTTP.MaxUploadSizeBytes + 1024); err != nil {
		respondError(w, http.StatusRequestEntityTooLarge, "FILE_TOO_LARGE", "Uploaded file exceeds the maximum allowed size.")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Request is malformed.")
		return
	}
	defer file.Close()

	displayName := strings.TrimSpace(r.FormValue("display_name"))
	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = detectMimeType(header.Filename)
	}

	document, err := h.app.Documents.Create(r.Context(), documents.CreateDocumentInput{
		ProjectID:   projectID,
		DisplayName: displayName,
		Filename:    header.Filename,
		MIMEType:    mimeType,
		Content:     file,
	})
	if err != nil {
		switch {
		case errors.Is(err, documents.ErrProjectNotFound):
			respondError(w, http.StatusNotFound, "PROJECT_NOT_FOUND", "Project does not exist.")
		case errors.Is(err, documents.ErrProjectReindexing):
			respondError(w, http.StatusConflict, "PROJECT_REINDEXING", "Project is temporarily unavailable because reindexing is in progress.")
		case errors.Is(err, documents.ErrUnsupportedMedia):
			respondError(w, http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "Uploaded file type is not supported.")
		case errors.Is(err, documents.ErrFileTooLarge):
			respondError(w, http.StatusRequestEntityTooLarge, "FILE_TOO_LARGE", "Uploaded file exceeds the maximum allowed size.")
		case errors.Is(err, documents.ErrMissingUploadFile):
			respondValidationError(w, []validationIssue{{Field: "file", Message: "must be provided"}})
		default:
			respondError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Unexpected internal server error.")
		}
		return
	}

	respondJSON(w, http.StatusCreated, mapDocumentResponse(document))
}

func (h Handler) GetDocument(w http.ResponseWriter, r *http.Request) {
	projectID, documentID, ok := parseProjectAndDocumentIDs(w, r)
	if !ok {
		return
	}

	document, err := h.app.Documents.Get(r.Context(), projectID, documentID)
	if err != nil {
		switch {
		case errors.Is(err, documents.ErrDocumentNotFound):
			respondError(w, http.StatusNotFound, "DOCUMENT_NOT_FOUND", "Document does not exist in this project.")
		default:
			respondError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Unexpected internal server error.")
		}
		return
	}

	respondJSON(w, http.StatusOK, mapDocumentResponse(document))
}

func (h Handler) DeleteDocument(w http.ResponseWriter, r *http.Request) {
	projectID, documentID, ok := parseProjectAndDocumentIDs(w, r)
	if !ok {
		return
	}

	err := h.app.Documents.Delete(r.Context(), projectID, documentID)
	if err != nil {
		switch {
		case errors.Is(err, documents.ErrDocumentNotFound):
			respondError(w, http.StatusNotFound, "DOCUMENT_NOT_FOUND", "Document does not exist in this project.")
		case errors.Is(err, documents.ErrDocumentBusy):
			respondError(w, http.StatusConflict, "DOCUMENT_HAS_ACTIVE_JOBS", "Document cannot be deleted while active jobs are running.")
		case errors.Is(err, documents.ErrProjectReindexing):
			respondError(w, http.StatusConflict, "PROJECT_REINDEXING", "Project is temporarily unavailable because reindexing is in progress.")
		default:
			respondError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Unexpected internal server error.")
		}
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h Handler) GetDocumentText(w http.ResponseWriter, r *http.Request) {
	projectID, documentID, ok := parseProjectAndDocumentIDs(w, r)
	if !ok {
		return
	}

	text, err := h.app.Documents.GetText(r.Context(), projectID, documentID)
	if err != nil {
		switch {
		case errors.Is(err, documents.ErrDocumentNotFound):
			respondError(w, http.StatusNotFound, "DOCUMENT_NOT_FOUND", "Document does not exist in this project.")
		case errors.Is(err, documents.ErrDocumentNotReady):
			respondError(w, http.StatusConflict, "DOCUMENT_NOT_READY", "Document text is not available yet because processing is not finished.")
		default:
			respondError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Unexpected internal server error.")
		}
		return
	}

	respondJSON(w, http.StatusOK, documentTextResponse{
		DocumentID: text.DocumentID,
		Text:       text.Text,
	})
}

func (h Handler) GetDocumentContent(w http.ResponseWriter, r *http.Request) {
	projectID, documentID, ok := parseProjectAndDocumentIDs(w, r)
	if !ok {
		return
	}

	content, err := h.app.Documents.GetContent(r.Context(), projectID, documentID)
	if err != nil {
		switch {
		case errors.Is(err, documents.ErrDocumentNotFound):
			respondError(w, http.StatusNotFound, "DOCUMENT_NOT_FOUND", "Document does not exist in this project.")
		default:
			respondError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Unexpected internal server error.")
		}
		return
	}
	defer content.File.Close()

	w.Header().Set("Content-Type", content.MIMEType)
	w.Header().Set("Content-Disposition", "inline; filename=\""+content.Name+"\"")
	if _, err := io.Copy(w, content.File); err != nil {
		h.app.Logger.Error("stream document content failed", "error", err, "document_id", content.DocumentID)
	}
}

func parseProjectAndDocumentIDs(w http.ResponseWriter, r *http.Request) (int64, int64, bool) {
	projectID, err := parsePathInt64(r, "projectId")
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Request is malformed.")
		return 0, 0, false
	}
	documentID, err := parsePathInt64(r, "documentId")
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Request is malformed.")
		return 0, 0, false
	}
	return projectID, documentID, true
}

func mapDocumentResponse(document documents.Document) documentResponse {
	return documentResponse{
		ID:        document.ID,
		ProjectID: document.ProjectID,
		Name:      document.Name,
		SizeBytes: document.SizeBytes,
		MIMEType:  document.MIMEType,
		Status:    document.Status,
		CreatedAt: document.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: document.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func detectMimeType(filename string) string {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".pdf":
		return "application/pdf"
	case ".md":
		return "text/markdown"
	case ".doc":
		return "application/msword"
	case ".docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	default:
		return "text/plain"
	}
}
