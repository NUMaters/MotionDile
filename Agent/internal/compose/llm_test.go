package compose

import (
	"context"
	"strings"
	"testing"

	"agent/internal/domain"
	"agent/internal/evidence"
	"agent/internal/llm"
	"agent/internal/policy"
)

type fakeLLMClient struct {
	input  llm.PromptInput
	output string
	err    error
}

func (f *fakeLLMClient) Generate(_ context.Context, input llm.PromptInput) (string, error) {
	f.input = input
	return f.output, f.err
}

func TestLLMComposer_BuildsPromptAndOmitsIdentifiers(t *testing.T) {
	req := domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   2,
		GameDuration: 60,
		ElapsedSec:   30,
		MapRadius:    1.3,
		AllyTheme:    "みんなで円を描く",
		EnemyTheme:   "端で待ち伏せする",
		Players: []domain.PlayerInfo{
			{
				PlayerID:      "enemy",
				DisplayName:   "Enemy",
				Color:         "red",
				X:             0.92,
				Z:             0.65,
				RotationY:     1.57,
				Animation:     "Idle_MouthOpen_Jump",
				MouthOpenness: 0.8,
				IsEnemy:       true,
			},
			{
				PlayerID:    "citizen-1",
				DisplayName: "CitizenOne",
				Color:       "blue",
				X:           0.72,
				Z:           0.62,
				Animation:   "Idle",
			},
		},
		Landmarks: []domain.LandmarkInfo{
			{Type: "rock", X: 0.95, Z: 0.67},
		},
	}

	ev := evidence.BuildHintEvidence(req)
	hintPolicy := policy.BuildHintPolicy(ev)
	client := &fakeLLMClient{output: "dummy"}
	composer := NewLLMComposer(client)

	if _, err := composer.Compose(context.Background(), ev, hintPolicy); err != nil {
		t.Fatalf("compose returned error: %v", err)
	}

	forbiddenFragments := []string{
		"Enemy",
		"CitizenOne",
		"red",
		"blue",
		"最も近い",
		"0.25",
	}
	for _, fragment := range forbiddenFragments {
		if strings.Contains(client.input.User, fragment) {
			t.Fatalf("prompt should omit forbidden fragment %q: %s", fragment, client.input.User)
		}
	}

	requiredFragments := []string{
		"主軸: 行動",
		"使ってよい情報",
		"口の開き",
		"ジャンプ",
		"向き",
		"行動ミッション（テーマ）",
		"テーマとのズレ",
		"市民側の流れと噛み合わない",
	}
	for _, fragment := range requiredFragments {
		if !strings.Contains(client.input.User, fragment) {
			t.Fatalf("prompt should contain %q: %s", fragment, client.input.User)
		}
	}
}
