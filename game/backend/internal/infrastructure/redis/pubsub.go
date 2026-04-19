package redis

import (
	"context"
	"fmt"
	"strings"

	"github.com/redis/go-redis/v9"
)

// RoomBus は部屋単位チャンネルへの Pub/Sub（全インスタンスが購読し、ローカル WS へ配信）。
type RoomBus struct {
	rdb    *redis.Client
	prefix string
}

func NewRoomBus(rdb *redis.Client, keyPrefix string) *RoomBus {
	if keyPrefix == "" {
		keyPrefix = "waniar"
	}
	return &RoomBus{rdb: rdb, prefix: keyPrefix}
}

func (b *RoomBus) channelName(roomID string) string {
	return fmt.Sprintf("%s:bus:room:%s", b.prefix, roomID)
}

// Publish は既に JSON 化された 1 メッセージをその部屋の購読者へ送る。
func (b *RoomBus) Publish(ctx context.Context, roomID string, payload []byte) error {
	return b.rdb.Publish(ctx, b.channelName(roomID), payload).Err()
}

// RoomFromChannel は PSUBSCRIBE のチャンネル名から roomID を取り出す。
func (b *RoomBus) RoomFromChannel(channel string) (string, bool) {
	suf := ":bus:room:"
	i := strings.Index(channel, suf)
	if i < 0 {
		return "", false
	}
	return channel[i+len(suf):], true
}

// Subscribe は ctx が終わるまで購読し、各メッセージで onMessage(roomID, payload) を呼ぶ。
func (b *RoomBus) Subscribe(ctx context.Context, pattern string, onMessage func(roomID string, payload []byte)) error {
	if pattern == "" {
		pattern = b.prefix + ":bus:room:*"
	}
	sub := b.rdb.PSubscribe(ctx, pattern)
	defer func() { _ = sub.Close() }()

	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg, ok := <-ch:
			if !ok {
				return nil
			}
			if msg == nil {
				continue
			}
			roomID, ok := b.RoomFromChannel(msg.Channel)
			if !ok || msg.Payload == "" {
				continue
			}
			onMessage(roomID, []byte(msg.Payload))
		}
	}
}
