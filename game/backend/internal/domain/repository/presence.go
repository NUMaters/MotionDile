package repository

import "context"

// RoomPresence は WebSocket 接続の「いまオンライン」を複数 backend で共有するための追跡です。
// インメモリ運用では未使用（ゲートウェイのローカル接続数を使います）。
type RoomPresence interface {
	Add(ctx context.Context, roomID, playerID string) error
	Remove(ctx context.Context, roomID, playerID string) error
	Touch(ctx context.Context, roomID, playerID string) error
	Count(ctx context.Context, roomID string) (int, error)
}
