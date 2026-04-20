package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"agent/internal/compose"
	"agent/internal/config"
	"agent/internal/infrastructure/bedrock"
	"agent/internal/infrastructure/openai"
	agenthttp "agent/internal/interface/http"
	"agent/internal/llm"
	"agent/internal/ops"
	"agent/internal/usecase"
)

func main() {
	cfg := config.Load()
	bedrockModel := cfg.BedrockModelID
	if cfg.AWSRegion != "" && bedrockModel == "" {
		bedrockModel = config.DefaultBedrockModel
	}

	ctx := context.Background()
	var ai llm.Client
	llmMode := "fallback"
	llmModelName := ""

	// OpenAI を優先（OPENAI_API_KEY が設定されていれば）
	if cfg.OpenAIAPIKey != "" {
		oc, err := openai.NewClient(cfg.OpenAIAPIKey, cfg.OpenAIModel)
		if err != nil {
			log.Printf("[agent] OpenAI client init failed: %v", err)
		} else {
			ai = oc
			llmMode = "openai"
			llmModelName = cfg.OpenAIModel
			log.Printf("[agent] using OpenAI model %s", cfg.OpenAIModel)
		}
	}

	// OpenAI が未設定なら Bedrock にフォールバック
	if ai == nil && cfg.AWSRegion != "" && bedrockModel != "" {
		bc, err := bedrock.NewClient(ctx, cfg.AWSRegion, bedrockModel)
		if err != nil {
			log.Printf("[agent] Bedrock client init failed: %v", err)
		} else {
			ai = bc
			llmMode = "bedrock"
			llmModelName = bedrockModel
			log.Printf("[agent] using Bedrock model %s (region=%s)", bedrockModel, cfg.AWSRegion)
		}
	}

	if ai == nil {
		ai = noopClient{}
		llmMode = "fallback"
		log.Printf("[agent] no LLM backend; hints/themes use templates or local fallback (set OPENAI_API_KEY or AWS_REGION + IAM for Bedrock)")
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
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    true,
			"mode":  llmMode,
			"model": llmModelName,
		})
	})

	addr := ":" + cfg.Port
	log.Printf("[agent] listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

type noopClient struct{}

func (noopClient) Generate(ctx context.Context, input llm.PromptInput) (string, error) {
	return "", context.DeadlineExceeded
}
