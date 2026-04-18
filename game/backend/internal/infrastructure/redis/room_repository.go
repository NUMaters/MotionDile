package redis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"waniar/game-backend/internal/domain/entity"
	"waniar/game-backend/internal/domain/repository"
)

const presenceTTL = 90 * time.Second
const roomBlobTTL = 24 * time.Hour

var _ repository.RoomRepository = (*RoomRepository)(nil)
var _ repository.RoomPresence = (*PresenceTracker)(nil)

// RoomRepository は部屋の正本を Redis に置く実装です（単一キー blob + WATCH による更新）。
type RoomRepository struct {
	rdb    *redis.Client
	prefix string
}

type roomBlob struct {
	Version int64                           `json:"version"`
	Players map[string]entity.PlayerState   `json:"players"`
	Game    entity.GameState                `json:"game"`
}

func NewRoomRepository(rdb *redis.Client, keyPrefix string) *RoomRepository {
	if keyPrefix == "" {
		keyPrefix = "waniar"
	}
	return &RoomRepository{rdb: rdb, prefix: keyPrefix}
}

func (r *RoomRepository) keyRoomBlob(roomID string) string {
	return fmt.Sprintf("%s:room:%s:blob", r.prefix, roomID)
}

func (r *RoomRepository) keyRoomsIndex() string {
	return r.prefix + ":rooms:index"
}

func (r *RoomRepository) keyRoomsLobby() string {
	return r.prefix + ":rooms:lobby"
}

func (r *RoomRepository) keyLandmarks(roomID string) string {
	return fmt.Sprintf("%s:room:%s:landmarks", r.prefix, roomID)
}

func (r *RoomRepository) keyPresence(roomID string) string {
	return fmt.Sprintf("%s:room:%s:presence", r.prefix, roomID)
}

func (r *RoomRepository) getBlob(ctx context.Context, roomID string) (roomBlob, error) {
	raw, err := r.rdb.Get(ctx, r.keyRoomBlob(roomID)).Bytes()
	if err == redis.Nil {
		return roomBlob{Players: make(map[string]entity.PlayerState), Game: entity.GameState{Phase: entity.PhaseWaiting}}, nil
	}
	if err != nil {
		return roomBlob{}, err
	}
	var b roomBlob
	if err := json.Unmarshal(raw, &b); err != nil {
		return roomBlob{}, err
	}
	if b.Players == nil {
		b.Players = make(map[string]entity.PlayerState)
	}
	return b, nil
}

func (r *RoomRepository) saveBlob(ctx context.Context, roomID string, b roomBlob) error {
	b.Version++
	raw, err := json.Marshal(b)
	if err != nil {
		return err
	}
	pipe := r.rdb.Pipeline()
	pipe.Set(ctx, r.keyRoomBlob(roomID), raw, roomBlobTTL)
	pipe.SAdd(ctx, r.keyRoomsIndex(), roomID)
	if entity.IsLobbyPhase(b.Game.Phase) {
		pipe.SAdd(ctx, r.keyRoomsLobby(), roomID)
	} else {
		pipe.SRem(ctx, r.keyRoomsLobby(), roomID)
	}
	_, err = pipe.Exec(ctx)
	return err
}

func (r *RoomRepository) mutBlob(ctx context.Context, roomID string, fn func(*roomBlob) error) error {
	const maxTry = 12
	key := r.keyRoomBlob(roomID)
	for i := 0; i < maxTry; i++ {
		err := r.rdb.Watch(ctx, func(tx *redis.Tx) error {
			b, err := r.getBlobTx(ctx, tx, roomID)
			if err != nil {
				return err
			}
			if err := fn(&b); err != nil {
				return err
			}
			b.Version++
			raw, err := json.Marshal(b)
			if err != nil {
				return err
			}
			_, err = tx.TxPipelined(ctx, func(p redis.Pipeliner) error {
				p.Set(ctx, key, raw, roomBlobTTL)
				p.SAdd(ctx, r.keyRoomsIndex(), roomID)
				if entity.IsLobbyPhase(b.Game.Phase) {
					p.SAdd(ctx, r.keyRoomsLobby(), roomID)
				} else {
					p.SRem(ctx, r.keyRoomsLobby(), roomID)
				}
				return nil
			})
			return err
		}, key)
		if err == nil {
			return nil
		}
		if errors.Is(err, repository.ErrSkipBlobWrite) {
			return nil
		}
		if errors.Is(err, redis.TxFailedErr) {
			continue
		}
		return err
	}
	return fmt.Errorf("room mutation conflict after retries: %s", roomID)
}

func (r *RoomRepository) getBlobTx(ctx context.Context, tx redis.Cmdable, roomID string) (roomBlob, error) {
	raw, err := tx.Get(ctx, r.keyRoomBlob(roomID)).Bytes()
	if err == redis.Nil {
		return roomBlob{Players: make(map[string]entity.PlayerState), Game: entity.GameState{Phase: entity.PhaseWaiting}}, nil
	}
	if err != nil {
		return roomBlob{}, err
	}
	var b roomBlob
	if err := json.Unmarshal(raw, &b); err != nil {
		return roomBlob{}, err
	}
	if b.Players == nil {
		b.Players = make(map[string]entity.PlayerState)
	}
	return b, nil
}

func snapshotFromBlob(roomID string, b *roomBlob) entity.RoomSnapshot {
	players := make([]entity.PlayerState, 0, len(b.Players))
	for _, p := range b.Players {
		players = append(players, p)
	}
	return entity.RoomSnapshot{
		RoomID:  roomID,
		Version: b.Version,
		Players: players,
	}
}

func pickUnusedColor(players map[string]entity.PlayerState) string {
	used := make(map[string]bool, len(players))
	for _, p := range players {
		used[p.Color] = true
	}
	return entity.PickUnusedColor(used, len(players))
}

func (r *RoomRepository) Join(ctx context.Context, roomID string, initial entity.PlayerState) (entity.RoomSnapshot, error) {
	var out entity.RoomSnapshot
	err := r.mutBlob(ctx, roomID, func(b *roomBlob) error {
		if existing, ok := b.Players[initial.PlayerID]; ok {
			initial.Color = existing.Color
			if strings.TrimSpace(initial.DisplayName) == "" {
				initial.DisplayName = existing.DisplayName
			}
			initial.X, initial.Y, initial.Z = existing.X, existing.Y, existing.Z
			initial.RotationY = existing.RotationY
			initial.NeckYaw = existing.NeckYaw
			initial.NeckPitch = existing.NeckPitch
		} else {
			initial.Color = pickUnusedColor(b.Players)
			if strings.TrimSpace(initial.DisplayName) == "" {
				initial.DisplayName = "プレイヤー"
			}
		}
		b.Players[initial.PlayerID] = initial
		out = snapshotFromBlob(roomID, b)
		return nil
	})
	return out, err
}

func (r *RoomRepository) UpsertState(ctx context.Context, roomID string, state entity.PlayerState) (entity.RoomSnapshot, error) {
	var out entity.RoomSnapshot
	err := r.mutBlob(ctx, roomID, func(b *roomBlob) error {
		if existing, ok := b.Players[state.PlayerID]; ok {
			state.Color = existing.Color
			state.DisplayName = existing.DisplayName
		}
		b.Players[state.PlayerID] = state
		out = snapshotFromBlob(roomID, b)
		return nil
	})
	return out, err
}

func (r *RoomRepository) RemovePlayer(ctx context.Context, roomID, playerID string) (entity.RoomSnapshot, error) {
	var out entity.RoomSnapshot
	err := r.mutBlob(ctx, roomID, func(b *roomBlob) error {
		delete(b.Players, playerID)
		out = snapshotFromBlob(roomID, b)
		return nil
	})
	return out, err
}

func (r *RoomRepository) GetSnapshot(ctx context.Context, roomID string) (entity.RoomSnapshot, error) {
	b, err := r.getBlob(ctx, roomID)
	if err != nil {
		return entity.RoomSnapshot{}, err
	}
	if len(b.Players) == 0 && b.Version == 0 && b.Game.Phase == "" {
		return entity.RoomSnapshot{RoomID: roomID, Version: 0, Players: nil}, nil
	}
	return snapshotFromBlob(roomID, &b), nil
}

func (r *RoomRepository) GetGameState(ctx context.Context, roomID string) (entity.GameState, error) {
	b, err := r.getBlob(ctx, roomID)
	if err != nil {
		return entity.GameState{}, err
	}
	gs := b.Game
	gs.PlayerCount = len(b.Players)
	return gs, nil
}

func (r *RoomRepository) SetGameState(ctx context.Context, roomID string, gs entity.GameState) error {
	return r.mutBlob(ctx, roomID, func(b *roomBlob) error {
		b.Game = gs
		return nil
	})
}

func voteExtendMajorityThreshold(n int) int {
	return entity.VoteExtendMajorityThreshold(n)
}

func playerIDInSlice(id string, list []string) bool {
	return entity.PlayerIDInSlice(id, list)
}

// PatchGameState は WATCH 付き blob 更新でゲーム状態を原子的に変更する。
func (r *RoomRepository) PatchGameState(ctx context.Context, roomID string, fn func(*entity.GameState) error) (entity.GameState, error) {
	var out entity.GameState
	err := r.mutBlob(ctx, roomID, func(b *roomBlob) error {
		if err := fn(&b.Game); err != nil {
			return err
		}
		out = b.Game
		out.PlayerCount = len(b.Players)
		return nil
	})
	return out, err
}

// ApplyVoteExtend は vote_extend を blob の原子的更新 1 回で適用する（RoundPlayerIds が空のとき人数は presence ZCARD）。
func (r *RoomRepository) ApplyVoteExtend(ctx context.Context, roomID, playerID string, extraMs int64, _ int) (repository.VoteExtendResult, error) {
	var res repository.VoteExtendResult
	err := r.mutBlob(ctx, roomID, func(b *roomBlob) error {
		g := &b.Game
		if g.Phase != entity.PhaseVoting {
			res = repository.VoteExtendResult{Silent: true}
			return repository.ErrSkipBlobWrite
		}
		if g.VoteExtendUsed {
			gs := *g
			gs.PlayerCount = len(b.Players)
			res = repository.VoteExtendResult{State: gs, MajorityApplied: false, Silent: false}
			return repository.ErrSkipBlobWrite
		}
		for _, id := range g.VoteExtendRequestPlayerIDs {
			if id == playerID {
				res = repository.VoteExtendResult{Silent: true}
				return repository.ErrSkipBlobWrite
			}
		}
		round := g.RoundPlayerIDs
		if len(round) > 0 && !playerIDInSlice(playerID, round) {
			res = repository.VoteExtendResult{Silent: true}
			return repository.ErrSkipBlobWrite
		}

		req := append([]string(nil), g.VoteExtendRequestPlayerIDs...)
		req = append(req, playerID)
		sort.Strings(req)
		g.VoteExtendRequestPlayerIDs = req

		n := len(round)
		if n == 0 {
			key := r.keyPresence(roomID)
			now := fmt.Sprintf("%d", time.Now().UnixMilli())
			_ = r.rdb.ZRemRangeByScore(ctx, key, "-inf", now)
			n64, err := r.rdb.ZCard(ctx, key).Result()
			if err != nil {
				return err
			}
			n = int(n64)
		}
		required := voteExtendMajorityThreshold(n)
		majorityApplied := false
		if len(g.VoteExtendRequestPlayerIDs) >= required {
			g.VoteExtendUsed = true
			g.VoteEnd += extraMs
			g.VoteExtendRequestPlayerIDs = nil
			majorityApplied = true
		}
		gs := *g
		gs.PlayerCount = len(b.Players)
		res = repository.VoteExtendResult{State: gs, MajorityApplied: majorityApplied, Silent: false}
		return nil
	})
	if err != nil {
		return repository.VoteExtendResult{}, err
	}
	return res, nil
}

func (r *RoomRepository) PickEnemy(ctx context.Context, roomID string) (string, error) {
	b, err := r.getBlob(ctx, roomID)
	if err != nil {
		return "", err
	}
	ids := make([]string, 0, len(b.Players))
	for id := range b.Players {
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return "", nil
	}
	return ids[rand.Intn(len(ids))], nil
}

func (r *RoomRepository) CastVote(ctx context.Context, roomID, voterID, votedForID string) (entity.GameState, error) {
	var gs entity.GameState
	err := r.mutBlob(ctx, roomID, func(b *roomBlob) error {
		if b.Game.Votes == nil {
			b.Game.Votes = make(map[string]string)
		}
		if _, exists := b.Game.Votes[voterID]; exists {
			return repository.ErrVoteAlreadyCast
		}
		b.Game.Votes[voterID] = votedForID
		gs = b.Game
		gs.PlayerCount = len(b.Players)
		return nil
	})
	return gs, err
}

func (r *RoomRepository) GetPlayerIDs(ctx context.Context, roomID string) ([]string, error) {
	b, err := r.getBlob(ctx, roomID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(b.Players))
	for id := range b.Players {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids, nil
}

func (r *RoomRepository) ListRoomIDs(ctx context.Context) ([]string, error) {
	ids, err := r.rdb.SMembers(ctx, r.keyRoomsIndex()).Result()
	if err != nil {
		return nil, err
	}
	sort.Strings(ids)
	return ids, nil
}

func (r *RoomRepository) DeleteRoom(ctx context.Context, roomID string) error {
	pipe := r.rdb.Pipeline()
	pipe.Del(ctx, r.keyRoomBlob(roomID))
	pipe.Del(ctx, r.keyLandmarks(roomID))
	pipe.Del(ctx, r.keyPresence(roomID))
	pipe.SRem(ctx, r.keyRoomsIndex(), roomID)
	pipe.SRem(ctx, r.keyRoomsLobby(), roomID)
	_, err := pipe.Exec(ctx)
	return err
}

func (r *RoomRepository) SetLandmarks(ctx context.Context, roomID string, landmarks []entity.Landmark) error {
	raw, err := json.Marshal(landmarks)
	if err != nil {
		return err
	}
	return r.rdb.Set(ctx, r.keyLandmarks(roomID), raw, roomBlobTTL).Err()
}

func (r *RoomRepository) GetLandmarks(ctx context.Context, roomID string) ([]entity.Landmark, error) {
	raw, err := r.rdb.Get(ctx, r.keyLandmarks(roomID)).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []entity.Landmark
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// PresenceTracker は WebSocket オンライン人数を Redis ZSET で共有する。
type PresenceTracker struct {
	rdb    *redis.Client
	prefix string
}

func NewPresenceTracker(rdb *redis.Client, keyPrefix string) *PresenceTracker {
	if keyPrefix == "" {
		keyPrefix = "waniar"
	}
	return &PresenceTracker{rdb: rdb, prefix: keyPrefix}
}

func (p *PresenceTracker) keyPresence(roomID string) string {
	return fmt.Sprintf("%s:room:%s:presence", p.prefix, roomID)
}

func (p *PresenceTracker) presenceScore() int64 {
	return time.Now().Add(presenceTTL).UnixMilli()
}

func (p *PresenceTracker) Add(ctx context.Context, roomID, playerID string) error {
	return p.Touch(ctx, roomID, playerID)
}

func (p *PresenceTracker) Remove(ctx context.Context, roomID, playerID string) error {
	return p.rdb.ZRem(ctx, p.keyPresence(roomID), playerID).Err()
}

func (p *PresenceTracker) Touch(ctx context.Context, roomID, playerID string) error {
	return p.rdb.ZAdd(ctx, p.keyPresence(roomID), redis.Z{Score: float64(p.presenceScore()), Member: playerID}).Err()
}

func (p *PresenceTracker) Count(ctx context.Context, roomID string) (int, error) {
	key := p.keyPresence(roomID)
	now := fmt.Sprintf("%d", time.Now().UnixMilli())
	pipe := p.rdb.Pipeline()
	pipe.ZRemRangeByScore(ctx, key, "-inf", now)
	card := pipe.ZCard(ctx, key)
	_, err := pipe.Exec(ctx)
	if err != nil {
		return 0, err
	}
	return int(card.Val()), nil
}

// ActivePlayerIDs は期限切れメンバーを掃除したうえで、現在オンラインの playerId 一覧を返す。
func (p *PresenceTracker) ActivePlayerIDs(ctx context.Context, roomID string) ([]string, error) {
	key := p.keyPresence(roomID)
	now := fmt.Sprintf("%d", time.Now().UnixMilli())
	pipe := p.rdb.Pipeline()
	pipe.ZRemRangeByScore(ctx, key, "-inf", now)
	zr := pipe.ZRange(ctx, key, 0, -1)
	_, err := pipe.Exec(ctx)
	if err != nil {
		return nil, err
	}
	return zr.Val(), nil
}
