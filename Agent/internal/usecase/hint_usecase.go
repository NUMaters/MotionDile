package usecase

import (
	"context"
	"fmt"
	"log"
	"math"
	"strings"

	"agent/internal/domain"
	"agent/internal/infrastructure/openai"
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
	userPrompt := buildUserPrompt(req)

	text, err := u.ai.ChatCompletion(ctx, systemPrompt, userPrompt)
	if err != nil {
		log.Printf("[agent] OpenAI error, falling back: %v", err)
		return domain.HintResponse{Text: fallbackHint(req)}, nil
	}

	text = sanitize(text)
	if text == "" {
		return domain.HintResponse{Text: fallbackHint(req)}, nil
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
	"%sで%sを確認。警戒せよ",
	"%s付近で不審な動き。%s",
	"%sにて%s。注意されたし",
}

func fallbackHint(req domain.HintRequest) string {
	var enemy *domain.PlayerInfo
	for i := range req.Players {
		if req.Players[i].IsEnemy {
			enemy = &req.Players[i]
			break
		}
	}
	if enemy == nil {
		return "情報収集中…しばらくお待ちください"
	}

	zone := positionToZone(enemy.X, enemy.Z, req.MapRadius)
	movement := animationToLabel(enemy.Animation)

	extras := []string{}
	if enemy.Y > 0.15 {
		extras = append(extras, "高所から")
	}
	if enemy.MouthOpenness > 0.4 {
		extras = append(extras, "威嚇しつつ")
	}
	if req.MapRadius > 0 && math.Sqrt(enemy.X*enemy.X+enemy.Z*enemy.Z) > req.MapRadius*0.8 {
		extras = append(extras, "壁際で")
	}

	prefix := ""
	if len(extras) > 0 {
		prefix = strings.Join(extras, "") + " "
	}

	tpl := fallbackTemplates[req.HintNumber%len(fallbackTemplates)]
	return fmt.Sprintf(tpl, zone, prefix+movement)
}
