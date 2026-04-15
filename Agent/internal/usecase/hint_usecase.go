package usecase

import (
	"context"
	"fmt"
	"log"
	"strings"

	"agent/internal/domain"
	"agent/internal/evidence"
	"agent/internal/infrastructure/openai"
	"agent/internal/policy"
)

type HintUsecase struct {
	ai *openai.Client
}

func NewHintUsecase(ai *openai.Client) *HintUsecase {
	return &HintUsecase{ai: ai}
}

// Generate は HintRequest を受け取り、OpenAI でヒントを生成して返す。
// API 障害時はフォールバックで静的ヒントを返す。
func (u *HintUsecase) Generate(ctx context.Context, req domain.HintRequest) (domain.HintResponse, error) {
	hintEvidence := evidence.BuildHintEvidence(req)
	hintPolicy := policy.BuildHintPolicy(hintEvidence)

	if hintPolicy.Action == policy.ActionInformationPending {
		return domain.HintResponse{Text: fallbackHint(hintEvidence, hintPolicy)}, nil
	}

	userPrompt := buildUserPrompt(hintEvidence, hintPolicy)

	text, err := u.ai.ChatCompletion(ctx, systemPrompt, userPrompt)
	if err != nil {
		log.Printf("[agent] OpenAI error, falling back: %v", err)
		return domain.HintResponse{Text: fallbackHint(hintEvidence, hintPolicy)}, nil
	}

	text = sanitize(text)
	if text == "" {
		return domain.HintResponse{Text: fallbackHint(hintEvidence, hintPolicy)}, nil
	}

	return domain.HintResponse{Text: text}, nil
}

func sanitize(s string) string {
	s = strings.TrimSpace(s)
	s = strings.Trim(s, "\"「」")
	// モデルが付けがちな前置きを除去（クライアントは本文のみ表示）
	prefixes := []string{
		"監視AI通報:",
		"監視AI通報：",
		"監視AI通報 ",
		"【監視AI通報】",
		"【監視AI】",
		"監視AI:",
		"監視AI：",
		"通報:",
		"通報：",
		"Agent:",
		"Agent：",
	}
	for {
		trimmed := false
		for _, p := range prefixes {
			if strings.HasPrefix(s, p) {
				s = strings.TrimSpace(strings.TrimPrefix(s, p))
				trimmed = true
			}
		}
		if !trimmed {
			break
		}
	}
	return strings.TrimSpace(s)
}

var fallbackTemplates = []string{
	"%s。警戒せよ",
	"%s。注意されたし",
	"%s。動きを見逃すな",
}

func fallbackHint(ev evidence.HintEvidence, hintPolicy policy.HintPolicy) string {
	if ev.Enemy == nil || hintPolicy.Action == policy.ActionInformationPending {
		return "情報収集中…しばらくお待ちください"
	}

	parts := orderedHintParts(ev, hintPolicy)
	if len(parts) == 0 {
		return "不審な動きあり。警戒せよ"
	}

	tpl := fallbackTemplates[ev.Request.HintNumber%len(fallbackTemplates)]
	maxParts := 2
	if hintPolicy.Specificity == policy.SpecificityHigh {
		maxParts = 3
	}
	if len(parts) > maxParts {
		parts = parts[:maxParts]
	}
	return fmt.Sprintf(tpl, strings.Join(parts, "、"))
}
