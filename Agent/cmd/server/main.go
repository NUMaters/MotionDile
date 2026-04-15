package main

import (
	"log"
	"net/http"

	"agent/internal/compose"
	"agent/internal/config"
	"agent/internal/infrastructure/openai"
	agenthttp "agent/internal/interface/http"
	"agent/internal/usecase"
)

func main() {
	cfg := config.Load()
	if cfg.OpenAIKey == "" {
		log.Fatal("OPENAI_API_KEY is required")
	}

	ai := openai.NewClient(cfg.OpenAIKey)
	llmComposer := compose.NewLLMComposer(ai)
	templateComposer := compose.NewTemplateComposer()
	uc := usecase.NewHintUsecase(llmComposer, templateComposer)
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
