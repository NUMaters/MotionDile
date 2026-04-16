package usecase

import (
	"context"
	"errors"
	"testing"

	"waniar/game-backend/internal/config"
	"waniar/game-backend/internal/domain/entity"
	"waniar/game-backend/internal/infrastructure/memory"
)

func TestRoomUsecase_Join_ErrInvalidInput(t *testing.T) {
	ctx := context.Background()
	u := NewRoomUsecase(memory.NewRoomRepository(), "", config.Rules{MaxPlayers: 4})
	_, err := u.Join(ctx, JoinInput{RoomID: "  ", PlayerID: "p1"})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("RoomID blank: got %v", err)
	}
	_, err = u.Join(ctx, JoinInput{RoomID: "r1", PlayerID: "  "})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("PlayerID blank: got %v", err)
	}
}

func TestRoomUsecase_Join_ErrRoomFull(t *testing.T) {
	ctx := context.Background()
	repo := memory.NewRoomRepository()
	u := NewRoomUsecase(repo, "", config.Rules{MaxPlayers: 2})
	const room = "lobby-full"
	if _, err := u.Join(ctx, JoinInput{RoomID: room, PlayerID: "a", DisplayName: "A"}); err != nil {
		t.Fatal(err)
	}
	if _, err := u.Join(ctx, JoinInput{RoomID: room, PlayerID: "b", DisplayName: "B"}); err != nil {
		t.Fatal(err)
	}
	_, err := u.Join(ctx, JoinInput{RoomID: room, PlayerID: "c", DisplayName: "C"})
	if !errors.Is(err, ErrRoomFull) {
		t.Fatalf("got %v", err)
	}
}

func TestRoomUsecase_Join_ErrGameInProgress(t *testing.T) {
	ctx := context.Background()
	repo := memory.NewRoomRepository()
	u := NewRoomUsecase(repo, "", config.Rules{MaxPlayers: 10})
	const room = "lobby-gip"
	if _, err := u.Join(ctx, JoinInput{RoomID: room, PlayerID: "a", DisplayName: "A"}); err != nil {
		t.Fatal(err)
	}
	if err := u.SetGameState(ctx, room, entity.GameState{Phase: entity.PhasePlaying}); err != nil {
		t.Fatal(err)
	}
	_, err := u.Join(ctx, JoinInput{RoomID: room, PlayerID: "b", DisplayName: "B"})
	if !errors.Is(err, ErrGameInProgress) {
		t.Fatalf("got %v", err)
	}
}

func TestRoomUsecase_Join_ReturningPlayerDuringGame(t *testing.T) {
	ctx := context.Background()
	repo := memory.NewRoomRepository()
	u := NewRoomUsecase(repo, "", config.Rules{MaxPlayers: 10})
	const room = "lobby-ret"
	if _, err := u.Join(ctx, JoinInput{RoomID: room, PlayerID: "a", DisplayName: "Alpha"}); err != nil {
		t.Fatal(err)
	}
	if err := u.SetGameState(ctx, room, entity.GameState{Phase: entity.PhasePlaying}); err != nil {
		t.Fatal(err)
	}
	snap, err := u.Join(ctx, JoinInput{RoomID: room, PlayerID: "a", DisplayName: "Beta"})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range snap.Players {
		if p.PlayerID == "a" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("returning player not in snapshot")
	}
}

func TestRoomUsecase_Join_TruncatesDisplayNameRunes(t *testing.T) {
	ctx := context.Background()
	u := NewRoomUsecase(memory.NewRoomRepository(), "", config.Rules{MaxPlayers: 4})
	name := "あいうえおかきくけこさしすせそたち" // 17 runes
	if len([]rune(name)) != 17 {
		t.Fatal("test data must be 17 runes")
	}
	snap, err := u.Join(ctx, JoinInput{RoomID: "r-trunc", PlayerID: "p1", DisplayName: name})
	if err != nil {
		t.Fatal(err)
	}
	if len([]rune(snap.Players[0].DisplayName)) != 16 {
		t.Fatalf("display name %q: len %d runes", snap.Players[0].DisplayName, len([]rune(snap.Players[0].DisplayName)))
	}
}
