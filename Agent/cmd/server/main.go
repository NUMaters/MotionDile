package main

import (
	"log"
	"net/http"

	"agent/internal/compose"
	"agent/internal/config"
	"agent/internal/infrastructure/openai"
	"agent/internal/llm"
	agenthttp "agent/internal/interface/http"
	"agent/internal/ops"
	"agent/internal/usecase"
)

func main() {
	cfg := config.Load()
	var ai llm.Client
	if cfg.OpenAIKey != "" {
		ai = openai.NewClient(cfg.OpenAIKey)
	} else {
		log.Print("[agent] OPENAI_API_KEY 未設定: ヒントはテンプレート、テーマはローカル抽選のみ（本番利用時はキーを設定してください）")
		ai = openai.Noop{}
	}
	llmComposer := compose.NewLLMComposer(ai)
	templateComposer := compose.NewTemplateComposer()
	historyStore := ops.NewMemoryHintHistoryStore()
	hintUsecase := usecase.NewHintUsecase(llmComposer, templateComposer, historyStore)
	themeUsecase := usecase.NewThemeUsecase(ai)
	hintHandler := agenthttp.NewHintHandler(hintUsecase)
	themeHandler := agenthttp.NewThemeHandler(themeUsecase)

	mux := http.NewServeMux()
	mux.HandleFunc("/hint", hintHandler.ServeHTTP)
	mux.HandleFunc("/themes", themeHandler.ServeHTTP)
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
