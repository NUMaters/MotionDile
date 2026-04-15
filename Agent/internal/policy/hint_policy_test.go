package policy

import (
	"testing"

	"agent/internal/domain"
	"agent/internal/evidence"
)

func TestBuildHintPolicy_InformationPendingWhenEnemyMissing(t *testing.T) {
	ev := evidence.BuildHintEvidence(domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   1,
		GameDuration: 30,
		ElapsedSec:   15,
		MapRadius:    1.3,
		Players: []domain.PlayerInfo{
			{PlayerID: "citizen-1", Animation: "Idle"},
		},
	})

	p := BuildHintPolicy(ev)

	if p.Action != ActionInformationPending {
		t.Fatalf("expected information pending, got %s", p.Action)
	}
	if p.Composer != ComposerTemplate {
		t.Fatalf("expected template composer, got %s", p.Composer)
	}
}

func TestBuildHintPolicy_Hint1PrefersMovementAndSuppressesJumpAndFacing(t *testing.T) {
	ev := evidence.BuildHintEvidence(domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   1,
		GameDuration: 30,
		ElapsedSec:   15,
		MapRadius:    1.3,
		Players: []domain.PlayerInfo{
			{
				PlayerID:      "enemy",
				X:             0.95,
				Z:             0.7,
				RotationY:     0,
				Animation:     "Idle_MouthOpen_Jump",
				MouthOpenness: 0.8,
				IsEnemy:       true,
			},
			{PlayerID: "citizen-1", X: 0.6, Z: 0.4, Animation: "Idle"},
		},
		Landmarks: []domain.LandmarkInfo{
			{Type: "tree", X: 0.9, Z: 0.72},
		},
	})

	p := BuildHintPolicy(ev)

	if p.Specificity != SpecificityLow {
		t.Fatalf("expected low specificity, got %s", p.Specificity)
	}
	if p.PrimaryFocus != FocusMovement {
		t.Fatalf("expected movement focus, got %s", p.PrimaryFocus)
	}
	if !p.Signals.UseMotion || !p.Signals.UseZone || !p.Signals.UseMouth {
		t.Fatal("expected motion, zone, and mouth signals to be enabled")
	}
	if p.Signals.UseAirborne || p.Signals.UseFacing || p.Signals.UseRelation || p.Signals.UseLandmark || p.Signals.UseNearWall {
		t.Fatal("expected advanced signals to stay disabled on hint1")
	}
}

func TestBuildHintPolicy_Hint2AllowsJumpFacingAndLocationSupport(t *testing.T) {
	ev := evidence.BuildHintEvidence(domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   2,
		GameDuration: 30,
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

	p := BuildHintPolicy(ev)

	if p.Specificity != SpecificityMedium {
		t.Fatalf("expected medium specificity, got %s", p.Specificity)
	}
	if p.PrimaryFocus != FocusMovement {
		t.Fatalf("expected movement focus, got %s", p.PrimaryFocus)
	}
	if !p.Signals.UseAirborne || !p.Signals.UseFacing || !p.Signals.UseLandmark || !p.Signals.UseNearWall {
		t.Fatal("expected jump, facing, landmark, and near-wall signals to be enabled")
	}
	if !p.Signals.UseRelation {
		t.Fatal("expected relation signal to be enabled for close grouping on hint2")
	}
	if !p.Signals.UseThemeMismatch {
		t.Fatal("expected theme mismatch signal to be enabled when both themes are present")
	}
}

func TestBuildHintPolicy_Hint3CanShiftToLocationFocus(t *testing.T) {
	ev := evidence.BuildHintEvidence(domain.HintRequest{
		RoomID:       "room-1",
		HintNumber:   3,
		GameDuration: 30,
		ElapsedSec:   45,
		MapRadius:    1.3,
		Players: []domain.PlayerInfo{
			{
				PlayerID:      "enemy",
				X:             1.0,
				Z:             -0.8,
				RotationY:     3.14,
				Animation:     "Idle",
				MouthOpenness: 0.1,
				IsEnemy:       true,
			},
			{PlayerID: "citizen-1", X: -0.3, Z: -0.2, Animation: "Walk"},
		},
		Landmarks: []domain.LandmarkInfo{
			{Type: "tree", X: 1.02, Z: -0.75},
		},
	})

	p := BuildHintPolicy(ev)

	if p.Specificity != SpecificityHigh {
		t.Fatalf("expected high specificity, got %s", p.Specificity)
	}
	if p.PrimaryFocus != FocusLocation {
		t.Fatalf("expected location focus, got %s", p.PrimaryFocus)
	}
	if !p.Signals.UseLandmark || !p.Signals.UseNearWall {
		t.Fatal("expected location support signals to stay enabled on high specificity")
	}
	if !p.Signals.UseRelation {
		t.Fatal("expected relation to be enabled for isolated enemy on hint3")
	}
}
