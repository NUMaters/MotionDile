package http

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"agent/internal/contract"
	"agent/internal/domain"
)

// ThemeGenerator abstracts the theme generation usecase for testability.
type ThemeGenerator interface {
	Generate(ctx context.Context, req domain.ThemeRequest) (domain.ThemeResponse, error)
}

type ThemeHandler struct {
	uc ThemeGenerator
}

func NewThemeHandler(uc ThemeGenerator) *ThemeHandler {
	return &ThemeHandler{uc: uc}
}

// ServeHTTP は POST /themes を処理する。
func (h *ThemeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req domain.ThemeRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := contract.ValidateThemeRequest(req); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}

	resp, err := h.uc.Generate(r.Context(), req)
	if err != nil {
		log.Printf("[agent] theme generate error: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("[agent] theme response encode error: %v", err)
	}
}
