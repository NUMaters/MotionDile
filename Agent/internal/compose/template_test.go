package compose

import (
	"context"
	"strings"
	"testing"

	"agent/internal/domain"
	"agent/internal/evidence"
	"agent/internal/ops"
	"agent/internal/policy"
)

func TestTemplateComposer_RespectsInformationPending(t *testing.T) {
	ev := evidence.BuildHintEvidence(domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   1,
		GameDuration: 60,
		ElapsedSec:   2,
		MapRadius:    1.3,
		Players: []domain.PlayerInfo{
			{PlayerID: "citizen-1", Animation: "Idle"},
		},
	})

	text, err := NewTemplateComposer().Compose(context.Background(), ev, policy.BuildHintPolicy(ev, ops.RecentHintSummary{}), ops.RecentHintSummary{})
	if err != nil {
		t.Fatalf("compose returned error: %v", err)
	}
	if text != informationPendingText {
		t.Fatalf("unexpected fallback text: %s", text)
	}
}

func TestTemplateComposer_UsesThemeMismatchWhenAvailable(t *testing.T) {
	ev := evidence.BuildHintEvidence(domain.HintRequest{
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
				X:             0.92,
				Z:             0.65,
				RotationY:     1.57,
				Animation:     "Idle_MouthOpen_Jump",
				MouthOpenness: 0.8,
				IsEnemy:       true,
			},
			{PlayerID: "citizen-1", X: 0.72, Z: 0.62, Animation: "Idle"},
		},
		Landmarks: []domain.LandmarkInfo{
			{Type: "rock", X: 0.95, Z: 0.67},
		},
	})

	text, err := NewTemplateComposer().Compose(context.Background(), ev, policy.BuildHintPolicy(ev, ops.RecentHintSummary{}), ops.RecentHintSummary{})
	if err != nil {
		t.Fatalf("compose returned error: %v", err)
	}
	if !strings.Contains(text, "周囲と噛み合わない") {
		t.Fatalf("template hint should include theme mismatch cue: %s", text)
	}
}
