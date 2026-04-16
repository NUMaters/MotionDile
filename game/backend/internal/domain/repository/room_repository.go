package repository

import (
	"context"

	"waniar/game-backend/internal/domain/entity"
)

type RoomRepository interface {
	Join(ctx context.Context, roomID string, initial entity.PlayerState) (entity.RoomSnapshot, error)
	UpsertState(ctx context.Context, roomID string, state entity.PlayerState) (entity.RoomSnapshot, error)
	RemovePlayer(ctx context.Context, roomID, playerID string) (entity.RoomSnapshot, error)
	GetSnapshot(ctx context.Context, roomID string) (entity.RoomSnapshot, error)
	GetGameState(ctx context.Context, roomID string) (entity.GameState, error)
	SetGameState(ctx context.Context, roomID string, gs entity.GameState) error
	PickEnemy(ctx context.Context, roomID string) (string, error)
	CastVote(ctx context.Context, roomID, voterID, votedForID string) (entity.GameState, error)
	GetPlayerIDs(ctx context.Context, roomID string) ([]string, error)
	ListRoomIDs(ctx context.Context) ([]string, error)
}
