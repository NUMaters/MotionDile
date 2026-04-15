package evidence

import (
	"testing"

	"agent/internal/domain"
)

func TestBuildHintEvidence_CollectsExpectedFacts(t *testing.T) {
	req := domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   2,
		GameDuration: 30,
		ElapsedSec:   10,
		MapRadius:    1.3,
		Players: []domain.PlayerInfo{
			{
				PlayerID:      "enemy",
				DisplayName:   "Enemy",
				X:             0.95,
				Y:             0,
				Z:             0.7,
				RotationY:     0,
				Animation:     "Run_MouthOpen_Jump",
				MouthOpenness: 0.8,
				IsEnemy:       true,
			},
			{
				PlayerID:      "citizen-1",
				DisplayName:   "Citizen1",
				X:             0.8,
				Y:             0,
				Z:             0.6,
				RotationY:     0,
				Animation:     "Idle",
				MouthOpenness: 0.1,
			},
			{
				PlayerID:      "citizen-2",
				DisplayName:   "Citizen2",
				X:             -0.4,
				Y:             0,
				Z:             -0.4,
				RotationY:     0,
				Animation:     "Walk",
				MouthOpenness: 0.1,
			},
		},
		Landmarks: []domain.LandmarkInfo{
			{Type: "rock", X: 0.9, Z: 0.75},
		},
	}

	ev := BuildHintEvidence(req)

	if ev.Enemy == nil {
		t.Fatal("enemy evidence should not be nil")
	}
	if ev.Enemy.Zone.Proximity != ProximityOuter {
		t.Fatalf("expected outer proximity, got %s", ev.Enemy.Zone.Proximity)
	}
	if ev.Enemy.Zone.NorthSouth != VerticalBiasNorth {
		t.Fatalf("expected north bias, got %s", ev.Enemy.Zone.NorthSouth)
	}
	if ev.Enemy.Zone.EastWest != HorizontalBiasEast {
		t.Fatalf("expected east bias, got %s", ev.Enemy.Zone.EastWest)
	}
	if ev.Enemy.Motion.Kind != MotionRun {
		t.Fatalf("expected run motion, got %s", ev.Enemy.Motion.Kind)
	}
	if !ev.Enemy.Motion.UsesMouthAnimation {
		t.Fatal("expected mouth animation flag to be true")
	}
	if !ev.Enemy.Motion.IsAirborneByAnimTag {
		t.Fatal("expected airborne flag to be true")
	}
	if !ev.Enemy.Environment.NearWall {
		t.Fatal("expected near wall to be true")
	}
	if ev.Enemy.Environment.NearbyLandmark.Kind != LandmarkRock {
		t.Fatalf("expected nearby rock, got %s", ev.Enemy.Environment.NearbyLandmark.Kind)
	}
	if ev.NearestCitizen == nil {
		t.Fatal("expected nearest citizen evidence")
	}
	if ev.NearestCitizen.Player.Source.PlayerID != "citizen-1" {
		t.Fatalf("expected citizen-1 to be nearest, got %s", ev.NearestCitizen.Player.Source.PlayerID)
	}
	if ev.EnemyIsIsolated {
		t.Fatal("expected enemy not to be isolated")
	}
}
