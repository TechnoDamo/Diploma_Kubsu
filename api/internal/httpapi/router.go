package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"mimir/api/internal/app"
	"mimir/api/internal/httpapi/handlers"
)

func NewRouter(application *app.App) http.Handler {
	router := chi.NewRouter()
	handler := handlers.New(application)

	router.Use(middleware.RequestID)
	router.Use(middleware.RealIP)
	router.Use(jsonRecovererMiddleware(application))
	router.Use(requestLoggingMiddleware(application))

	router.Get("/healthz", handler.Health)

	router.Route("/api/v1", func(r chi.Router) {
		r.Route("/projects", func(r chi.Router) {
			r.Get("/", handler.ListProjects)
			r.Post("/", handler.CreateProject)

			r.Route("/{projectId}", func(r chi.Router) {
				r.Get("/", handler.GetProject)
				r.Delete("/", handler.DeleteProject)

				r.Route("/documents", func(r chi.Router) {
					r.Get("/", handler.ListDocuments)
					r.Post("/", handler.UploadDocument)

					r.Route("/{documentId}", func(r chi.Router) {
						r.Get("/", handler.GetDocument)
						r.Delete("/", handler.DeleteDocument)
						r.Get("/content", handler.GetDocumentContent)
						r.Get("/text", handler.GetDocumentText)
					})
				})

				r.Post("/rag/query", handler.QueryRAG)
				r.Post("/analysis/contradictions", handler.StartContradictionAnalysis)
				r.Get("/analysis/contradictions/{jobId}", handler.GetContradictionAnalysis)
			})
		})
	})

	return router
}
