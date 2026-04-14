package main

import (
	"log"
	"net/http"

	"agent/internal/config"
	agenthttp "agent/internal/interface/http"
	"agent/internal/infrastructure/openai"
	"agent/internal/usecase"
)

func main() {
	cfg := config.Load()
	if cfg.OpenAIKey == "" {
		log.Fatal("OPENAI_API_KEY is required")
	}

	ai := openai.NewClient(cfg.OpenAIKey)
	uc := usecase.NewHintUsecase(ai)
	handler := agenthttp.NewHintHandler(uc)

	mux := http.NewServeMux()
	mux.HandleFunc("/hint", handler.ServeHTTP)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	addr := ":" + cfg.Port
	log.Printf("[agent] listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
