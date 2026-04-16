package usecase

import (
	"context"
	"log"
	"strings"

	"agent/internal/compose"
	"agent/internal/domain"
	"agent/internal/evidence"
	"agent/internal/ops"
	"agent/internal/policy"
)

type HintUsecase struct {
	llmComposer      compose.Composer
	templateComposer compose.Composer
	historyStore     ops.HintHistoryStore
}

func NewHintUsecase(llmComposer, templateComposer compose.Composer, historyStore ops.HintHistoryStore) *HintUsecase {
	return &HintUsecase{
		llmComposer:      llmComposer,
		templateComposer: templateComposer,
		historyStore:     historyStore,
	}
}

// Generate は HintRequest を受け取り、OpenAI でヒントを生成して返す。
// API 障害時はフォールバックで静的ヒントを返す。
func (u *HintUsecase) Generate(ctx context.Context, req domain.HintRequest) (domain.HintResponse, error) {
	hintEvidence := evidence.BuildHintEvidence(req)
	summary := u.historyStore.GetRecentSummary(req.RoomID, 2)
	hintPolicy := policy.BuildHintPolicy(hintEvidence, summary)

	if hintPolicy.Action == policy.ActionInformationPending {
		return domain.HintResponse{Text: u.composeTemplate(ctx, hintEvidence, hintPolicy, summary)}, nil
	}

	text, err := u.llmComposer.Compose(ctx, hintEvidence, hintPolicy, summary)
	if err != nil {
		log.Printf("[agent] OpenAI error, falling back: %v", err)
		return domain.HintResponse{Text: u.composeTemplate(ctx, hintEvidence, hintPolicy, summary)}, nil
	}

	text = sanitize(text)
	if text == "" {
		return domain.HintResponse{Text: u.composeTemplate(ctx, hintEvidence, hintPolicy, summary)}, nil
	}

	u.appendHistory(req.RoomID, text, hintPolicy)

	return domain.HintResponse{Text: text}, nil
}

func (u *HintUsecase) composeTemplate(ctx context.Context, ev evidence.HintEvidence, hintPolicy policy.HintPolicy, summary ops.RecentHintSummary) string {
	text, err := u.templateComposer.Compose(ctx, ev, hintPolicy, summary)
	if err != nil {
		log.Printf("[agent] template compose error: %v", err)
		return "情報収集中…しばらくお待ちください"
	}
	text = sanitize(text)
	u.appendHistory(ev.Request.RoomID, text, hintPolicy)
	return text
}

func (u *HintUsecase) appendHistory(roomID, text string, hintPolicy policy.HintPolicy) {
	if u.historyStore == nil || strings.TrimSpace(text) == "" {
		return
	}
	u.historyStore.Append(ops.HintRecord{
		RoomID:      roomID,
		Text:        text,
		Specificity: string(hintPolicy.Specificity),
		Focus:       string(hintPolicy.PrimaryFocus),
		UsedSignals: collectUsedSignals(hintPolicy),
	})
}

func collectUsedSignals(hintPolicy policy.HintPolicy) []string {
	signals := []string{}
	if hintPolicy.Signals.UseMotion {
		signals = append(signals, "motion")
	}
	if hintPolicy.Signals.UseZone {
		signals = append(signals, "zone")
	}
	if hintPolicy.Signals.UseMouth {
		signals = append(signals, "mouth")
	}
	if hintPolicy.Signals.UseAirborne {
		signals = append(signals, "airborne")
	}
	if hintPolicy.Signals.UseFacing {
		signals = append(signals, "facing")
	}
	if hintPolicy.Signals.UseRelation {
		signals = append(signals, "relation")
	}
	if hintPolicy.Signals.UseLandmark {
		signals = append(signals, "landmark")
	}
	if hintPolicy.Signals.UseNearWall {
		signals = append(signals, "near_wall")
	}
	if hintPolicy.Signals.UseThemeMismatch {
		signals = append(signals, "theme_mismatch")
	}
	return signals
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
