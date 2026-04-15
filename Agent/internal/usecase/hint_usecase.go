package usecase

import (
	"context"
	"log"
	"strings"

	"agent/internal/compose"
	"agent/internal/domain"
	"agent/internal/evidence"
	"agent/internal/policy"
)

type HintUsecase struct {
	llmComposer      compose.Composer
	templateComposer compose.Composer
}

func NewHintUsecase(llmComposer, templateComposer compose.Composer) *HintUsecase {
	return &HintUsecase{
		llmComposer:      llmComposer,
		templateComposer: templateComposer,
	}
}

// Generate は HintRequest を受け取り、OpenAI でヒントを生成して返す。
// API 障害時はフォールバックで静的ヒントを返す。
func (u *HintUsecase) Generate(ctx context.Context, req domain.HintRequest) (domain.HintResponse, error) {
	hintEvidence := evidence.BuildHintEvidence(req)
	hintPolicy := policy.BuildHintPolicy(hintEvidence)

	if hintPolicy.Action == policy.ActionInformationPending {
		return domain.HintResponse{Text: u.composeTemplate(ctx, hintEvidence, hintPolicy)}, nil
	}

	text, err := u.llmComposer.Compose(ctx, hintEvidence, hintPolicy)
	if err != nil {
		log.Printf("[agent] OpenAI error, falling back: %v", err)
		return domain.HintResponse{Text: u.composeTemplate(ctx, hintEvidence, hintPolicy)}, nil
	}

	text = sanitize(text)
	if text == "" {
		return domain.HintResponse{Text: u.composeTemplate(ctx, hintEvidence, hintPolicy)}, nil
	}

	return domain.HintResponse{Text: text}, nil
}

func (u *HintUsecase) composeTemplate(ctx context.Context, ev evidence.HintEvidence, hintPolicy policy.HintPolicy) string {
	text, err := u.templateComposer.Compose(ctx, ev, hintPolicy)
	if err != nil {
		log.Printf("[agent] template compose error: %v", err)
		return "情報収集中…しばらくお待ちください"
	}
	return sanitize(text)
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
