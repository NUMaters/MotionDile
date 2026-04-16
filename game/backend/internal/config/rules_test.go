package config

import (
	"testing"
	"time"
)

func clearWaniarEnv(t *testing.T) {
	t.Helper()
	keys := []string{
		"WANIAR_GAME_DURATION_SEC",
		"WANIAR_MATCH_COUNTDOWN_SEC",
		"WANIAR_VOTE_DURATION_SEC",
		"WANIAR_RESULT_DURATION_SEC",
		"WANIAR_HINT_INTERVAL_SEC",
		"WANIAR_MIN_PLAYERS",
		"WANIAR_MAX_PLAYERS",
		"WANIAR_MAP_RADIUS",
	}
	for _, k := range keys {
		t.Setenv(k, "")
	}
}

func TestLoadRulesFromEnv_Defaults(t *testing.T) {
	clearWaniarEnv(t)
	r := LoadRulesFromEnv()
	if r.GameDuration != 60*time.Second {
		t.Fatalf("GameDuration: got %v want 60s", r.GameDuration)
	}
	if r.MatchCountdown != 20*time.Second {
		t.Fatalf("MatchCountdown: got %v want 20s", r.MatchCountdown)
	}
	if r.MinPlayers != 3 || r.MaxPlayers != 10 {
		t.Fatalf("players: min=%d max=%d want 3 10", r.MinPlayers, r.MaxPlayers)
	}
	if r.MapRadius != 1.3 {
		t.Fatalf("MapRadius: got %v", r.MapRadius)
	}
}

func TestLoadRulesFromEnv_CustomValues(t *testing.T) {
	clearWaniarEnv(t)
	t.Setenv("WANIAR_GAME_DURATION_SEC", "90")
	t.Setenv("WANIAR_HINT_INTERVAL_SEC", "12")
	t.Setenv("WANIAR_MAP_RADIUS", "2.5")
	r := LoadRulesFromEnv()
	if r.GameDuration != 90*time.Second {
		t.Fatalf("GameDuration: got %v", r.GameDuration)
	}
	if r.HintInterval != 12*time.Second {
		t.Fatalf("HintInterval: got %v", r.HintInterval)
	}
	if r.MapRadius != 2.5 {
		t.Fatalf("MapRadius: got %v", r.MapRadius)
	}
}

func TestLoadRulesFromEnv_InvalidFallsBack(t *testing.T) {
	clearWaniarEnv(t)
	t.Setenv("WANIAR_GAME_DURATION_SEC", "not-a-number")
	r := LoadRulesFromEnv()
	if r.GameDuration != 60*time.Second {
		t.Fatalf("GameDuration: got %v want default 60s", r.GameDuration)
	}
}

func TestLoadRulesFromEnv_MinMaxCorrected(t *testing.T) {
	clearWaniarEnv(t)
	t.Setenv("WANIAR_MIN_PLAYERS", "8")
	t.Setenv("WANIAR_MAX_PLAYERS", "3")
	r := LoadRulesFromEnv()
	if r.MinPlayers != 8 {
		t.Fatalf("MinPlayers: got %d", r.MinPlayers)
	}
	if r.MaxPlayers != 8 {
		t.Fatalf("MaxPlayers should be raised to MinPlayers: got %d want 8", r.MaxPlayers)
	}
}
