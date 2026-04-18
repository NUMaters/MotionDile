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
	DeleteRoom(ctx context.Context, roomID string) error
	SetLandmarks(ctx context.Context, roomID string, landmarks []entity.Landmark) error
	GetLandmarks(ctx context.Context, roomID string) ([]entity.Landmark, error)

	// PatchGameState はゲーム状態を 1 回の原子的更新で読み書きする（フェーズ遷移の競合を抑える）。
	PatchGameState(ctx context.Context, roomID string, fn func(*entity.GameState) error) (entity.GameState, error)

	// ApplyVoteExtend は vote_extend を 1 回の原子的更新で適用する。
	// livePeerCountWhenRoundEmpty は RoundPlayerIds が空のときの接続人数（メモリ実装用）。Redis 実装では presence ZCARD を使うため無視してよい。
	ApplyVoteExtend(ctx context.Context, roomID, playerID string, extraMs int64, livePeerCountWhenRoundEmpty int) (VoteExtendResult, error)
}
