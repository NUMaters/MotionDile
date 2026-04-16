package compose

import (
	"testing"

	"agent/internal/domain"
	"agent/internal/evidence"
	"agent/internal/material"
	"agent/internal/ops"
	"agent/internal/policy"
)

func TestScoreCandidates_PrefersConcreteHintOverVagueHint(t *testing.T) {
	ev := evidence.BuildHintEvidence(domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   2,
		GameDuration: 60,
		ElapsedSec:   30,
		MapRadius:    1.3,
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
	})

	hintPolicy := policy.BuildHintPolicy(ev, ops.RecentHintSummary{})
	selected := material.SelectMaterials(ev, hintPolicy)

	candidates := []hintCandidate{
		{
			Text:        "怪しい気配がある",
			UsedSignals: []string{"motion"},
		},
		{
			Text:        "口を開けたまま外周寄りで止まりがちだ",
			UsedSignals: []string{"motion", "mouth", "zone"},
		},
	}

	directives := buildCandidateDirectives(selected, hintPolicy)
	scored := scoreCandidates(candidates, ev, hintPolicy, ops.RecentHintSummary{}, selected, directives)
	if len(scored) != 2 {
		t.Fatalf("expected 2 scored candidates, got %d", len(scored))
	}
	if scored[0].Candidate.Text != "口を開けたまま外周寄りで止まりがちだ" {
		t.Fatalf("expected concrete hint to rank first, got %s", scored[0].Candidate.Text)
	}
}
