package scheduler

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"waniar/game-backend/internal/config"
	"waniar/game-backend/internal/domain/entity"
)

const sep = "\x1e"

// Callbacks は期限到来時にゲートウェイ側の遷移を実行する。
type Callbacks interface {
	OnCountdownEnd(ctx context.Context, roomID string)
	OnGameEnd(ctx context.Context, roomID string)
	OnVoteEnd(ctx context.Context, roomID string)
	OnResultEnd(ctx context.Context, roomID string)
	OnHintTick(ctx context.Context, roomID string, seq int)
}

// DeadlineRunner は Redis ZSET + 分散ロックで期限処理を 1 回だけ実行する。
type DeadlineRunner struct {
	rdb       *redis.Client
	prefix    string
	cb        Callbacks
	keyDue    string
	lockTTL   time.Duration
	tickEvery time.Duration
}

func NewDeadlineRunner(rdb *redis.Client, keyPrefix string, cb Callbacks) *DeadlineRunner {
	if keyPrefix == "" {
		keyPrefix = "waniar"
	}
	return &DeadlineRunner{
		rdb:       rdb,
		prefix:    keyPrefix,
		cb:        cb,
		keyDue:    keyPrefix + ":timers:due",
		lockTTL:   12 * time.Second,
		tickEvery: 200 * time.Millisecond,
	}
}

func memCD(roomID string) string  { return roomID + sep + "cd" }
func memGE(roomID string) string { return roomID + sep + "ge" }
func memVE(roomID string) string { return roomID + sep + "ve" }
func memRE(roomID string) string { return roomID + sep + "re" }
func memHI(roomID string, n int) string {
	return fmt.Sprintf("%s%s%s%s%d", roomID, sep, "hi", sep, n)
}

func lockKey(prefix, member string) string {
	return fmt.Sprintf("%s:timers:lock:%x", prefix, member)
}

// SyncRoom は当該部屋に紐づく期限エントリを差し替える（フェーズ変更時に呼ぶ）。
func (d *DeadlineRunner) SyncRoom(ctx context.Context, roomID string, gs entity.GameState, rules config.Rules, now time.Time) error {
	members, err := d.rdb.ZRange(ctx, d.keyDue, 0, -1).Result()
	if err != nil {
		return err
	}
	pipe := d.rdb.Pipeline()
	for _, m := range members {
		if strings.HasPrefix(m, roomID+sep) {
			pipe.ZRem(ctx, d.keyDue, m)
		}
	}
	_, _ = pipe.Exec(ctx)

	pipe2 := d.rdb.Pipeline()
	add := func(member string, atMs int64) {
		if atMs <= 0 {
			return
		}
		pipe2.ZAdd(ctx, d.keyDue, redis.Z{Score: float64(atMs), Member: member})
	}

	switch gs.Phase {
	case entity.PhaseCountdown:
		add(memCD(roomID), gs.CountdownEnd)
	case entity.PhasePlaying:
		add(memGE(roomID), gs.GameEnd)
		next := now.Add(rules.HintInterval).UnixMilli()
		if gs.GameEnd > 0 && next >= gs.GameEnd {
			next = gs.GameEnd - 1
		}
		if gs.GameEnd > 0 && next > 0 && next < gs.GameEnd {
			add(memHI(roomID, 1), next)
		}
	case entity.PhaseVoting:
		add(memVE(roomID), gs.VoteEnd)
	case entity.PhaseResults:
		add(memRE(roomID), gs.ResultEnd)
	default:
	}
	_, err = pipe2.Exec(ctx)
	return err
}

// Run はブロックして期限ワーカーを回す（プロセスごとに 1 本）。
func (d *DeadlineRunner) Run(ctx context.Context) error {
	t := time.NewTicker(d.tickEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
			d.tick(ctx)
		}
	}
}

func (d *DeadlineRunner) tick(ctx context.Context) {
	now := time.Now().UnixMilli()
	members, err := d.rdb.ZRangeByScore(ctx, d.keyDue, &redis.ZRangeBy{
		Min: "-inf", Max: strconv.FormatInt(now, 10), Offset: 0, Count: 48,
	}).Result()
	if err != nil || len(members) == 0 {
		return
	}
	for _, m := range members {
		lk := lockKey(d.prefix, m)
		ok, err := d.rdb.SetNX(ctx, lk, "1", d.lockTTL).Result()
		if err != nil || !ok {
			continue
		}
		removed, err := d.rdb.ZRem(ctx, d.keyDue, m).Result()
		if err != nil || removed == 0 {
			_, _ = d.rdb.Del(ctx, lk).Result()
			continue
		}
		d.dispatch(ctx, m)
		_, _ = d.rdb.Del(ctx, lk).Result()
	}
}

func (d *DeadlineRunner) dispatch(ctx context.Context, member string) {
	parts := strings.Split(member, sep)
	if len(parts) < 2 {
		return
	}
	roomID := parts[0]
	kind := parts[1]
	switch kind {
	case "cd":
		d.cb.OnCountdownEnd(ctx, roomID)
	case "ge":
		d.cb.OnGameEnd(ctx, roomID)
	case "ve":
		d.cb.OnVoteEnd(ctx, roomID)
	case "re":
		d.cb.OnResultEnd(ctx, roomID)
	case "hi":
		if len(parts) < 3 {
			return
		}
		n, err := strconv.Atoi(parts[2])
		if err != nil {
			return
		}
		d.cb.OnHintTick(ctx, roomID, n)
	default:
	}
}

// ClearRoom は部屋解体時に ZSET 上の当該部屋の期限エントリを削除する。
func (d *DeadlineRunner) ClearRoom(ctx context.Context, roomID string) error {
	members, err := d.rdb.ZRange(ctx, d.keyDue, 0, -1).Result()
	if err != nil {
		return err
	}
	pipe := d.rdb.Pipeline()
	for _, m := range members {
		if strings.HasPrefix(m, roomID+sep) {
			pipe.ZRem(ctx, d.keyDue, m)
		}
	}
	_, err = pipe.Exec(ctx)
	return err
}

// ScheduleNextHint はヒント送信後、まだ対戦中なら次のヒント期限を登録する。
func (d *DeadlineRunner) ScheduleNextHint(ctx context.Context, roomID string, nextSeq int, atMs int64, gameEndMs int64) error {
	if atMs <= 0 || nextSeq <= 0 {
		return nil
	}
	if gameEndMs > 0 && atMs >= gameEndMs {
		return nil
	}
	return d.rdb.ZAdd(ctx, d.keyDue, redis.Z{Score: float64(atMs), Member: memHI(roomID, nextSeq)}).Err()
}
