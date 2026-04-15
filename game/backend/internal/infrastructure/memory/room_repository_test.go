package memory

import (
	"context"
	"math/rand"
	"sort"
	"testing"

	"waniar/game-backend/internal/domain/entity"
)

func findPlayer(players []entity.PlayerState, id string) (entity.PlayerState, bool) {
	for _, p := range players {
		if p.PlayerID == id {
			return p, true
		}
	}
	return entity.PlayerState{}, false
}

func TestRoomRepository_JoinAssignsColorAndDefaultName(t *testing.T) {
	ctx := context.Background()
	r := NewRoomRepository()
	roomID := "r-join"

	snap1, err := r.Join(ctx, roomID, entity.PlayerState{PlayerID: "p1", DisplayName: " "})
	if err != nil {
		t.Fatal(err)
	}
	snap2, err := r.Join(ctx, roomID, entity.PlayerState{PlayerID: "p2", DisplayName: "Bob"})
	if err != nil {
		t.Fatal(err)
	}
	p1, ok := findPlayer(snap1.Players, "p1")
	if !ok {
		t.Fatal("p1 not found")
	}
	p2, ok := findPlayer(snap2.Players, "p2")
	if !ok {
		t.Fatal("p2 not found")
	}
	if p1.DisplayName != "プレイヤー" {
		t.Fatalf("default name: got %q", p1.DisplayName)
	}
	if p1.Color == "" || p2.Color == "" {
		t.Fatal("color should not be empty")
	}
	if p1.Color == p2.Color {
		t.Fatalf("colors must differ: %q", p1.Color)
	}
}

func TestRoomRepository_RejoinAndUpsertPreserveIdentityFields(t *testing.T) {
	ctx := context.Background()
	r := NewRoomRepository()
	roomID := "r-rejoin"

	s1, err := r.Join(ctx, roomID, entity.PlayerState{PlayerID: "p1", DisplayName: "Alice"})
	if err != nil {
		t.Fatal(err)
	}
	orig, ok := findPlayer(s1.Players, "p1")
	if !ok {
		t.Fatal("p1 missing")
	}

	s2, err := r.Join(ctx, roomID, entity.PlayerState{PlayerID: "p1", DisplayName: " "})
	if err != nil {
		t.Fatal(err)
	}
	rejoined, ok := findPlayer(s2.Players, "p1")
	if !ok {
		t.Fatal("p1 missing after rejoin")
	}
	if rejoined.DisplayName != "Alice" {
		t.Fatalf("display name changed: %q", rejoined.DisplayName)
	}
	if rejoined.Color != orig.Color {
		t.Fatalf("color changed: %q != %q", rejoined.Color, orig.Color)
	}

	s3, err := r.UpsertState(ctx, roomID, entity.PlayerState{PlayerID: "p1", X: 9, DisplayName: "XXX", Color: "#000"})
	if err != nil {
		t.Fatal(err)
	}
	up, ok := findPlayer(s3.Players, "p1")
	if !ok {
		t.Fatal("p1 missing after upsert")
	}
	if up.DisplayName != "Alice" {
		t.Fatalf("display name should be preserved: %q", up.DisplayName)
	}
	if up.Color != orig.Color {
		t.Fatalf("color should be preserved: %q != %q", up.Color, orig.Color)
	}
	if up.X != 9 {
		t.Fatalf("state value should update, got X=%v", up.X)
	}
}

func TestRoomRepository_GameStateVoteAndListRoomIDs(t *testing.T) {
	ctx := context.Background()
	r := NewRoomRepository()
	_, _ = r.Join(ctx, "room-b", entity.PlayerState{PlayerID: "p1"})
	_, _ = r.Join(ctx, "room-a", entity.PlayerState{PlayerID: "p2"})

	if err := r.SetGameState(ctx, "room-b", entity.GameState{Phase: entity.PhasePlaying}); err != nil {
		t.Fatal(err)
	}
	gs, err := r.CastVote(ctx, "room-b", "p1", "p1")
	if err != nil {
		t.Fatal(err)
	}
	if gs.PlayerCount != 1 {
		t.Fatalf("PlayerCount got %d want 1", gs.PlayerCount)
	}
	if gs.Votes["p1"] != "p1" {
		t.Fatalf("vote not recorded: %+v", gs.Votes)
	}

	ids, err := r.ListRoomIDs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 2 || ids[0] != "room-a" || ids[1] != "room-b" {
		t.Fatalf("room ids must be sorted, got %#v", ids)
	}
}

func TestRoomRepository_GetSnapshot_EmptyRoom(t *testing.T) {
	ctx := context.Background()
	r := NewRoomRepository()
	snap, err := r.GetSnapshot(ctx, "no-such-room")
	if err != nil {
		t.Fatal(err)
	}
	if snap.Version != 0 || snap.RoomID != "no-such-room" || len(snap.Players) != 0 {
		t.Fatalf("unexpected snapshot: %+v", snap)
	}
}

func TestRoomRepository_RemovePlayer(t *testing.T) {
	ctx := context.Background()
	r := NewRoomRepository()
	const room = "r-remove"
	if _, err := r.Join(ctx, room, entity.PlayerState{PlayerID: "a"}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Join(ctx, room, entity.PlayerState{PlayerID: "b"}); err != nil {
		t.Fatal(err)
	}
	snap, err := r.RemovePlayer(ctx, room, "a")
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Players) != 1 {
		t.Fatalf("players=%d", len(snap.Players))
	}
}

func TestRoomRepository_GetGameState_PlayerCount(t *testing.T) {
	ctx := context.Background()
	r := NewRoomRepository()
	const room = "r-gs"
	if _, err := r.Join(ctx, room, entity.PlayerState{PlayerID: "p1"}); err != nil {
		t.Fatal(err)
	}
	gs, err := r.GetGameState(ctx, room)
	if err != nil {
		t.Fatal(err)
	}
	if gs.PlayerCount != 1 {
		t.Fatalf("PlayerCount=%d", gs.PlayerCount)
	}
}

func TestRoomRepository_PickEnemyAndGetPlayerIDs(t *testing.T) {
	ctx := context.Background()
	r := NewRoomRepository()
	const room = "r-pick"
	if _, err := r.Join(ctx, room, entity.PlayerState{PlayerID: "x"}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Join(ctx, room, entity.PlayerState{PlayerID: "y"}); err != nil {
		t.Fatal(err)
	}
	rand.Seed(123)
	enemy, err := r.PickEnemy(ctx, room)
	if err != nil {
		t.Fatal(err)
	}
	if enemy != "x" && enemy != "y" {
		t.Fatalf("unexpected enemy %q", enemy)
	}
	ids, err := r.GetPlayerIDs(ctx, room)
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(ids)
	if len(ids) != 2 || ids[0] != "x" || ids[1] != "y" {
		t.Fatalf("ids=%v", ids)
	}
}
