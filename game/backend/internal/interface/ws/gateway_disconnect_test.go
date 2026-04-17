package ws

import (
	"testing"

	"waniar/game-backend/internal/domain/entity"
)

func TestShouldRemovePlayerOnSocketClose(t *testing.T) {
	cases := []struct {
		phase entity.GamePhase
		want  bool
	}{
		{entity.PhaseWaiting, true},
		{"", true},
		{entity.PhaseCountdown, false},
		{entity.PhasePlaying, false},
		{entity.PhaseVoting, false},
		{entity.PhaseResults, false},
	}
	for _, tc := range cases {
		if got := shouldRemovePlayerOnSocketClose(tc.phase); got != tc.want {
			t.Fatalf("shouldRemovePlayerOnSocketClose(%q)=%v want %v", tc.phase, got, tc.want)
		}
	}
}
