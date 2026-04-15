package contract

import (
	"testing"

	"agent/internal/domain"
)

func TestValidateHintRequest_AllowsValidRequest(t *testing.T) {
	req := domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   1,
		GameDuration: 30,
		ElapsedSec:   10,
		MapRadius:    1.3,
		Players: []domain.PlayerInfo{
			{
				PlayerID:      "enemy-1",
				DisplayName:   "Enemy",
				X:             0.1,
				Y:             0,
				Z:             -0.2,
				RotationY:     1.57,
				Animation:     "Run",
				MouthOpenness: 0.4,
				IsEnemy:       true,
			},
			{
				PlayerID:      "citizen-1",
				DisplayName:   "Citizen",
				X:             -0.3,
				Y:             0,
				Z:             0.5,
				RotationY:     0,
				Animation:     "Walk",
				MouthOpenness: 0.1,
				IsEnemy:       false,
			},
		},
	}

	if err := ValidateHintRequest(req); err != nil {
		t.Fatalf("expected request to be valid, got error: %v", err)
	}
}

func TestValidateHintRequest_ReturnsAllDetectedIssues(t *testing.T) {
	req := domain.HintRequest{
		RoomID:       "   ",
		HintNumber:   0,
		GameDuration: 0,
		ElapsedSec:   99,
		MapRadius:    -1,
		Players: []domain.PlayerInfo{
			{
				PlayerID:      "",
				MouthOpenness: 1.5,
				IsEnemy:       true,
			},
			{
				PlayerID:      "enemy-2",
				MouthOpenness: -0.1,
				IsEnemy:       true,
			},
		},
	}

	err := ValidateHintRequest(req)
	if err == nil {
		t.Fatal("expected validation error, got nil")
	}

	validationErr, ok := err.(*ValidationError)
	if !ok {
		t.Fatalf("expected ValidationError, got %T", err)
	}

	if len(validationErr.Issues) < 5 {
		t.Fatalf("expected multiple validation issues, got %d", len(validationErr.Issues))
	}
}
