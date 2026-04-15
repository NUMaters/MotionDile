package usecase

import (
	"strings"
	"testing"

	"agent/internal/domain"
	"agent/internal/evidence"
	"agent/internal/policy"
)

func TestBuildUserPrompt_UsesPolicyAndOmitsIdentifiers(t *testing.T) {
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
	prompt := buildUserPrompt(ev, hintPolicy)

	forbiddenFragments := []string{
		"Enemy",
		"CitizenOne",
		"red",
		"blue",
		"最も近い",
		"0.25",
	}
	for _, fragment := range forbiddenFragments {
		if strings.Contains(prompt, fragment) {
			t.Fatalf("prompt should omit forbidden fragment %q: %s", fragment, prompt)
		}
	}

	requiredFragments := []string{
		"主軸: 行動",
		"使ってよい情報",
		"口の開き",
		"ジャンプ",
		"向き",
		"行動ミッション（テーマ）",
	}
	for _, fragment := range requiredFragments {
		if !strings.Contains(prompt, fragment) {
			t.Fatalf("prompt should contain %q: %s", fragment, prompt)
		}
	}
}

func TestFallbackHint_RespectsInformationPending(t *testing.T) {
	ev := evidence.BuildHintEvidence(domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   1,
		GameDuration: 30,
		ElapsedSec:   2,
		MapRadius:    1.3,
		Players: []domain.PlayerInfo{
			{PlayerID: "citizen-1", Animation: "Idle"},
		},
	})

	text := fallbackHint(ev, policy.BuildHintPolicy(ev))
	if text != "情報収集中…しばらくお待ちください" {
		t.Fatalf("unexpected fallback text: %s", text)
	}
}
