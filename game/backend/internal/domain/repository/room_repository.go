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
}
