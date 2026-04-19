package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"agent/internal/compose"
	"agent/internal/config"
	"agent/internal/infrastructure/bedrock"
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

	if cfg.AWSRegion != "" && bedrockModel != "" {
		bc, err := bedrock.NewClient(ctx, cfg.AWSRegion, bedrockModel)
		if err != nil {
			log.Printf("[agent] Bedrock client init failed: %v", err)
		} else {
			ai = bc
			llmMode = "bedrock"
			log.Printf("[agent] using Bedrock model %s (region=%s)", bedrockModel, cfg.AWSRegion)
		}
	}
	if ai == nil {
		ai = noopClient{}
		llmMode = "fallback"
		log.Printf("[agent] no LLM backend; hints/themes use templates or local fallback (set AWS_REGION + IAM for Bedrock)")
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
			"ok":                true,
			"mode":              llmMode,
			"bedrockModel":      bedrockModel,
			"bedrockConfigured": llmMode == "bedrock",
			"awsRegion":         cfg.AWSRegion,
		})
	})

	addr := ":" + cfg.Port
	log.Printf("[agent] listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

// noopClient は LLM 未設定時のフォールバック。Usecase がテンプレートフォールバックへ回す。
type noopClient struct{}

func (noopClient) Generate(ctx context.Context, input llm.PromptInput) (string, error) {
	return "", context.DeadlineExceeded
}
