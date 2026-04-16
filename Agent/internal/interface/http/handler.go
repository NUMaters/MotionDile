package http

import (
	"encoding/json"
	"log"
	"net/http"

	"agent/internal/contract"
	"agent/internal/domain"
	"agent/internal/usecase"
)

type HintHandler struct {
	uc *usecase.HintUsecase
}

func NewHintHandler(uc *usecase.HintUsecase) *HintHandler {
	return &HintHandler{uc: uc}
}

// ServeHTTP は POST /hint を処理する。
func (h *HintHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req domain.HintRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := contract.ValidateHintRequest(req); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}

	resp, err := h.uc.Generate(r.Context(), req)
	if err != nil {
		log.Printf("[agent] generate error: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("[agent] response encode error: %v", err)
	}
}
