package usecase

import (
	"context"
	"errors"
	"strings"
	"time"

	"waniar/game-backend/internal/domain/entity"
	"waniar/game-backend/internal/domain/repository"
)

var ErrInvalidInput = errors.New("invalid input")

type JoinInput struct {
	RoomID   string
	PlayerID string
}

type MoveInput struct {
	RoomID    string
	PlayerID  string
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	Z         float64 `json:"z"`
	RotationY float64 `json:"rotationY"`
	NeckYaw   float64 `json:"neckYaw"`
	NeckPitch float64 `json:"neckPitch"`
	Animation string  `json:"animation"`
}

type RoomUsecase struct {
	repo repository.RoomRepository
}

func NewRoomUsecase(repo repository.RoomRepository) *RoomUsecase {
	return &RoomUsecase{repo: repo}
}

func (u *RoomUsecase) Join(ctx context.Context, in JoinInput) (entity.RoomSnapshot, error) {
	if strings.TrimSpace(in.RoomID) == "" || strings.TrimSpace(in.PlayerID) == "" {
		return entity.RoomSnapshot{}, ErrInvalidInput
	}
	initial := entity.PlayerState{
		PlayerID:  in.PlayerID,
		X:         0,
		Y:         0,
		Z:         0,
		RotationY: 0,
		NeckYaw:   0,
		NeckPitch: 0,
		Animation: "Idle",
		UpdatedAt: time.Now().UnixMilli(),
	}
	return u.repo.Join(ctx, in.RoomID, initial)
}

func (u *RoomUsecase) Move(ctx context.Context, in MoveInput) (entity.RoomSnapshot, error) {
	if strings.TrimSpace(in.RoomID) == "" || strings.TrimSpace(in.PlayerID) == "" {
		return entity.RoomSnapshot{}, ErrInvalidInput
	}
	state := entity.PlayerState{
		PlayerID:  in.PlayerID,
		X:         in.X,
		Y:         in.Y,
		Z:         in.Z,
		RotationY: in.RotationY,
		NeckYaw:   in.NeckYaw,
		NeckPitch: in.NeckPitch,
		Animation: in.Animation,
		UpdatedAt: time.Now().UnixMilli(),
	}
	return u.repo.UpsertState(ctx, in.RoomID, state)
}

func (u *RoomUsecase) Leave(ctx context.Context, roomID, playerID string) (entity.RoomSnapshot, error) {
	if strings.TrimSpace(roomID) == "" || strings.TrimSpace(playerID) == "" {
		return entity.RoomSnapshot{}, ErrInvalidInput
	}
	return u.repo.RemovePlayer(ctx, roomID, playerID)
}

func (u *RoomUsecase) Snapshot(ctx context.Context, roomID string) (entity.RoomSnapshot, error) {
	if strings.TrimSpace(roomID) == "" {
		return entity.RoomSnapshot{}, ErrInvalidInput
	}
	return u.repo.GetSnapshot(ctx, roomID)
}
