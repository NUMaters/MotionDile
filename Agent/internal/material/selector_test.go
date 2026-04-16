package material

import (
	"testing"

	"agent/internal/domain"
	"agent/internal/evidence"
	"agent/internal/ops"
	"agent/internal/policy"
)

func TestSelectMaterials_PrefersMovementLocationAndRelationBeforeThemeMismatch(t *testing.T) {
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
			{PlayerID: "citizen-1", X: 0.65, Z: 0.62, Animation: "Idle"},
		},
		Landmarks: []domain.LandmarkInfo{
			{Type: "rock", X: 0.95, Z: 0.68},
		},
	})

	hintPolicy := policy.BuildHintPolicy(ev, ops.RecentHintSummary{})
	selected := SelectMaterials(ev, hintPolicy)

	if selected.PrimaryClue != ClueMovement {
		t.Fatalf("expected movement primary clue, got %s", selected.PrimaryClue)
	}
	if len(selected.Clues) != 3 {
		t.Fatalf("expected 3 selected clues, got %d (%v)", len(selected.Clues), selected.Clues)
	}

	expected := []ClueKind{ClueMovement, ClueLocation, ClueRelation}
	for i, clue := range expected {
		if selected.Clues[i] != clue {
			t.Fatalf("expected clue %d to be %s, got %s", i, clue, selected.Clues[i])
		}
	}
}

func TestSelectMaterials_UsesRelationAsPrimaryWhenPolicyRequestsIt(t *testing.T) {
	ev := evidence.BuildHintEvidence(domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   3,
		GameDuration: 60,
		ElapsedSec:   50,
		MapRadius:    1.3,
		Players: []domain.PlayerInfo{
			{
				PlayerID:      "enemy",
				X:             0.1,
				Z:             0.1,
				RotationY:     0,
				Animation:     "Idle",
				MouthOpenness: 0.1,
				IsEnemy:       true,
			},
			{PlayerID: "citizen-1", X: 0.18, Z: 0.14, Animation: "Walk"},
		},
	})

	hintPolicy := policy.BuildHintPolicy(ev, ops.RecentHintSummary{})
	hintPolicy.PrimaryFocus = policy.FocusRelation
	hintPolicy.MaxClues = 2

	selected := SelectMaterials(ev, hintPolicy)

	if selected.PrimaryClue != ClueRelation {
		t.Fatalf("expected relation primary clue, got %s", selected.PrimaryClue)
	}
	if len(selected.Clues) != 2 {
		t.Fatalf("expected 2 selected clues, got %d", len(selected.Clues))
	}
	if selected.Clues[0] != ClueRelation {
		t.Fatalf("expected first clue to be relation, got %s", selected.Clues[0])
	}
}
