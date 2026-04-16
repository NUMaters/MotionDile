package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"agent/internal/config"
	"agent/internal/infrastructure/bedrock"
	"agent/internal/infrastructure/openai"
	agenthttp "agent/internal/interface/http"
	"agent/internal/usecase"
)

func main() {
	cfg := config.Load()
	bedrockModel := cfg.BedrockModelID
	if cfg.AWSRegion != "" && bedrockModel == "" {
		bedrockModel = config.DefaultBedrockModel
	}
	bedrockDisabled := os.Getenv("BEDROCK_DISABLED") == "1" || os.Getenv("BEDROCK_DISABLED") == "true"

	ctx := context.Background()
	var completer usecase.ChatCompleter
	llmMode := "fallback"

	if cfg.AWSRegion != "" && bedrockModel != "" && !bedrockDisabled {
		bc, err := bedrock.NewClient(ctx, cfg.AWSRegion, bedrockModel)
		if err != nil {
			log.Printf("[agent] Bedrock client init failed: %v", err)
		} else {
			completer = bc
			llmMode = "bedrock"
			log.Printf("[agent] using Bedrock model %s (region=%s)", bedrockModel, cfg.AWSRegion)
		}
	}
	if completer == nil && cfg.OpenAIKey != "" {
		completer = openai.NewClient(cfg.OpenAIKey)
		llmMode = "openai"
		log.Printf("[agent] using OpenAI Chat Completions (gpt-4o-mini)")
	}
	if completer == nil {
		log.Printf("[agent] no LLM backend; fallback-only mode (set AWS_REGION + IAM for Bedrock, or OPENAI_API_KEY)")
	}

	uc := usecase.NewHintUsecase(completer)
	handler := agenthttp.NewHintHandler(uc)

	mux := http.NewServeMux()
	mux.HandleFunc("/hint", handler.ServeHTTP)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":                true,
			"mode":              llmMode,
			"bedrockModel":      bedrockModel,
			"bedrockConfigured": llmMode == "bedrock",
			"openaiConfigured":  cfg.OpenAIKey != "",
			"awsRegion":         cfg.AWSRegion,
		})
	})

	addr := ":" + cfg.Port
	log.Printf("[agent] listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
