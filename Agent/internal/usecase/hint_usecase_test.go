package usecase

import (
	"context"
	"testing"

	"agent/internal/domain"
)

func TestHintUsecase_GenerateFallsBackWithoutOpenAIClient(t *testing.T) {
	uc := NewHintUsecase(nil)

	resp, err := uc.Generate(context.Background(), domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   1,
		GameDuration: 60,
		ElapsedSec:   20,
		MapRadius:    10,
		Players: []domain.PlayerInfo{
			{
				PlayerID:      "enemy-1",
				DisplayName:   "enemy",
				X:             1.2,
				Y:             0,
				Z:             -0.3,
				RotationY:     0,
				Animation:     "Run",
				MouthOpenness: 0.1,
				Color:         "#ff0000",
				IsEnemy:       true,
			},
		},
	})
	if err != nil {
		t.Fatalf("Generate returned error: %v", err)
	}
	if resp.Text == "" {
		t.Fatal("Generate returned empty fallback hint")
	}
}
