package usecase

import (
	"context"
	"errors"
	"strings"
	"testing"

	"waniar/game-backend/internal/config"
	"waniar/game-backend/internal/domain/entity"
	"waniar/game-backend/internal/infrastructure/memory"
)

func TestRoomUsecase_ResolveLobbyRoomGameInProgressRedirect(t *testing.T) {
	ctx := context.Background()
	repo := memory.NewRoomRepository()
	u := NewRoomUsecase(repo, "", config.Rules{MaxPlayers: 10})

	if _, err := u.Join(ctx, JoinInput{RoomID: "room-playing", PlayerID: "p1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := u.Join(ctx, JoinInput{RoomID: "room-waiting", PlayerID: "p2"}); err != nil {
		t.Fatal(err)
	}
	if err := u.SetGameState(ctx, "room-playing", entity.GameState{Phase: entity.PhasePlaying}); err != nil {
		t.Fatal(err)
	}

	id, redirected, reason, err := u.ResolveLobbyRoom(ctx, "room-playing", "")
	if err != nil {
		t.Fatal(err)
	}
	if !redirected || reason != "game_in_progress" {
		t.Fatalf("redirect/result mismatch: redirected=%v reason=%q", redirected, reason)
	}
	if id != "room-waiting" {
		t.Fatalf("got %q want room-waiting", id)
	}
}

func TestRoomUsecase_MoveAndSnapshot(t *testing.T) {
	ctx := context.Background()
	repo := memory.NewRoomRepository()
	u := NewRoomUsecase(repo, "", config.Rules{MaxPlayers: 10})
	roomID := "room-move"

	if _, err := u.Join(ctx, JoinInput{RoomID: roomID, PlayerID: "p1", DisplayName: "Alice"}); err != nil {
		t.Fatal(err)
	}

	_, err := u.Move(ctx, MoveInput{RoomID: roomID, PlayerID: "p1", X: 1.2, Z: -0.5, Animation: "Run"})
	if err != nil {
		t.Fatal(err)
	}
	snap, err := u.Snapshot(ctx, roomID)
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Players) != 1 {
		t.Fatalf("players=%d", len(snap.Players))
	}
	if snap.Players[0].X != 1.2 || snap.Players[0].Z != -0.5 || snap.Players[0].Animation != "Run" {
		t.Fatalf("move not reflected: %+v", snap.Players[0])
	}
}

func TestRoomUsecase_TallyVotes(t *testing.T) {
	ctx := context.Background()
	repo := memory.NewRoomRepository()
	u := NewRoomUsecase(repo, "", config.Rules{MaxPlayers: 10})
	roomID := "room-vote"

	if _, err := u.Join(ctx, JoinInput{RoomID: roomID, PlayerID: "enemy", DisplayName: "E"}); err != nil {
		t.Fatal(err)
	}
	if _, err := u.Join(ctx, JoinInput{RoomID: roomID, PlayerID: "ally1", DisplayName: "A1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := u.Join(ctx, JoinInput{RoomID: roomID, PlayerID: "ally2", DisplayName: "A2"}); err != nil {
		t.Fatal(err)
	}
	if err := u.SetGameState(ctx, roomID, entity.GameState{
		Phase:         entity.PhaseVoting,
		EnemyPlayerID: "enemy",
		AllyTheme:     "ally-theme",
		EnemyTheme:    "enemy-theme",
		Votes: map[string]string{
			"ally1": "enemy",
			"ally2": "enemy",
			"enemy": "ally1",
		},
	}); err != nil {
		t.Fatal(err)
	}

	result, err := u.TallyVotes(ctx, roomID)
	if err != nil {
		t.Fatal(err)
	}
	if result.EnemyPlayerID != "enemy" {
		t.Fatalf("enemy id mismatch: %q", result.EnemyPlayerID)
	}
	if result.EnemyColor == "" {
		t.Fatal("enemy color should be resolved")
	}
	if result.VoteCounts["enemy"] != 2 {
		t.Fatalf("vote count mismatch: %+v", result.VoteCounts)
	}
	if !result.CitizensWin {
		t.Fatal("citizens should win when enemy has max votes")
	}
}

func TestRoomUsecase_ResolveLobby_EmptyPreferred_AutoCreate(t *testing.T) {
	ctx := context.Background()
	u := NewRoomUsecase(memory.NewRoomRepository(), "", config.Rules{MaxPlayers: 10})
	id, redirected, reason, err := u.ResolveLobbyRoom(ctx, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if !redirected || reason != "auto_create" {
		t.Fatalf("want auto_create: redirected=%v reason=%q", redirected, reason)
	}
	if !strings.HasPrefix(id, "lobby-") {
		t.Fatalf("unexpected id %q", id)
	}
}

func TestRoomUsecase_Move_ErrInvalidInput(t *testing.T) {
	ctx := context.Background()
	u := NewRoomUsecase(memory.NewRoomRepository(), "", config.Rules{MaxPlayers: 10})
	_, err := u.Move(ctx, MoveInput{RoomID: "", PlayerID: "p"})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("got %v", err)
	}
}

func TestRoomUsecase_Snapshot_ErrInvalidInput(t *testing.T) {
	ctx := context.Background()
	u := NewRoomUsecase(memory.NewRoomRepository(), "", config.Rules{MaxPlayers: 10})
	_, err := u.Snapshot(ctx, "  ")
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("got %v", err)
	}
}

func TestRoomUsecase_Leave_ErrInvalidInput(t *testing.T) {
	ctx := context.Background()
	u := NewRoomUsecase(memory.NewRoomRepository(), "", config.Rules{MaxPlayers: 10})
	_, err := u.Leave(ctx, "", "p")
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("got %v", err)
	}
}
