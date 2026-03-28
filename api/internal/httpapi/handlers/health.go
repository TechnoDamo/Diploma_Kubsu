package handlers

import "net/http"

func (h Handler) Health(w http.ResponseWriter, _ *http.Request) {
	respondJSON(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"service":     "mimir-api",
		"environment": h.app.Config.AppEnv,
	})
}
