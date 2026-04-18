package memory

import (
	"context"
	"math/rand"
	"sort"
	"strings"
	"sync"

	"waniar/game-backend/internal/domain/entity"
	"waniar/game-backend/internal/domain/repository"
)

// 互換のため re-export（テストが memory.ErrVoteAlreadyCast を参照している場合）
var ErrVoteAlreadyCast = repository.ErrVoteAlreadyCast

var _ repository.RoomRepository = (*RoomRepository)(nil)

type roomState struct {
	version    int64
	players    map[string]entity.PlayerState
	game       entity.GameState
	landmarks  []entity.Landmark
}

type RoomRepository struct {
	mu    sync.RWMutex
	rooms map[string]*roomState
}

func NewRoomRepository() *RoomRepository {
	return &RoomRepository{
		rooms: make(map[string]*roomState),
	}
}

func (r *RoomRepository) Join(_ context.Context, roomID string, initial entity.PlayerState) (entity.RoomSnapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	room := r.ensureRoom(roomID)

	if existing, ok := room.players[initial.PlayerID]; ok {
		initial.Color = existing.Color
		if strings.TrimSpace(initial.DisplayName) == "" {
			initial.DisplayName = existing.DisplayName
		}
		initial.X, initial.Y, initial.Z = existing.X, existing.Y, existing.Z
		initial.RotationY = existing.RotationY
		initial.NeckYaw = existing.NeckYaw
		initial.NeckPitch = existing.NeckPitch
	} else {
		initial.Color = pickUnusedColor(room)
		if strings.TrimSpace(initial.DisplayName) == "" {
			initial.DisplayName = "プレイヤー"
		}
	}

	room.players[initial.PlayerID] = initial
	room.version++
	return snapshotFromRoom(roomID, room), nil
}

func pickUnusedColor(room *roomState) string {
	used := make(map[string]bool, len(room.players))
	for _, p := range room.players {
		used[p.Color] = true
	}
	return entity.PickUnusedColor(used, len(room.players))
}

func (r *RoomRepository) UpsertState(_ context.Context, roomID string, state entity.PlayerState) (entity.RoomSnapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	room := r.ensureRoom(roomID)
	if existing, ok := room.players[state.PlayerID]; ok {
		state.Color = existing.Color
		state.DisplayName = existing.DisplayName
	}
	room.players[state.PlayerID] = state
	room.version++
	return snapshotFromRoom(roomID, room), nil
}

func (r *RoomRepository) RemovePlayer(_ context.Context, roomID, playerID string) (entity.RoomSnapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	room, ok := r.rooms[roomID]
	if !ok {
		return entity.RoomSnapshot{RoomID: roomID, Version: 0, Players: []entity.PlayerState{}}, nil
	}
	delete(room.players, playerID)
	room.version++
	return snapshotFromRoom(roomID, room), nil
}

func (r *RoomRepository) GetSnapshot(_ context.Context, roomID string) (entity.RoomSnapshot, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	room, ok := r.rooms[roomID]
	if !ok {
		return entity.RoomSnapshot{
			RoomID:  roomID,
			Version: 0,
			Players: []entity.PlayerState{},
		}, nil
	}
	return snapshotFromRoom(roomID, room), nil
}

func (r *RoomRepository) ensureRoom(roomID string) *roomState {
	if rm, ok := r.rooms[roomID]; ok {
		return rm
	}
	rm := &roomState{
		players: make(map[string]entity.PlayerState),
	}
	r.rooms[roomID] = rm
	return rm
}

func (r *RoomRepository) GetGameState(_ context.Context, roomID string) (entity.GameState, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	room, ok := r.rooms[roomID]
	if !ok {
		return entity.GameState{Phase: entity.PhaseWaiting}, nil
	}
	gs := room.game
	gs.PlayerCount = len(room.players)
	return gs, nil
}

func (r *RoomRepository) SetGameState(_ context.Context, roomID string, gs entity.GameState) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.ensureRoom(roomID)
	room.game = gs
	return nil
}

func (r *RoomRepository) PickEnemy(_ context.Context, roomID string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.ensureRoom(roomID)
	ids := make([]string, 0, len(room.players))
	for id := range room.players {
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return "", nil
	}
	return ids[rand.Intn(len(ids))], nil
}

func (r *RoomRepository) CastVote(_ context.Context, roomID, voterID, votedForID string) (entity.GameState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.ensureRoom(roomID)
	if room.game.Votes == nil {
		room.game.Votes = make(map[string]string)
	}
	if _, exists := room.game.Votes[voterID]; exists {
		return entity.GameState{}, repository.ErrVoteAlreadyCast
	}
	room.game.Votes[voterID] = votedForID
	gs := room.game
	gs.PlayerCount = len(room.players)
	return gs, nil
}

func (r *RoomRepository) GetPlayerIDs(_ context.Context, roomID string) ([]string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	room, ok := r.rooms[roomID]
	if !ok {
		return nil, nil
	}
	ids := make([]string, 0, len(room.players))
	for id := range room.players {
		ids = append(ids, id)
	}
	return ids, nil
}

func (r *RoomRepository) ListRoomIDs(_ context.Context) ([]string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.rooms))
	for id := range r.rooms {
		out = append(out, id)
	}
	sort.Strings(out)
	return out, nil
}

func (r *RoomRepository) DeleteRoom(_ context.Context, roomID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.rooms, roomID)
	return nil
}

func (r *RoomRepository) SetLandmarks(_ context.Context, roomID string, landmarks []entity.Landmark) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.ensureRoom(roomID)
	room.landmarks = append([]entity.Landmark(nil), landmarks...)
	return nil
}

func (r *RoomRepository) GetLandmarks(_ context.Context, roomID string) ([]entity.Landmark, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	room, ok := r.rooms[roomID]
	if !ok || len(room.landmarks) == 0 {
		return nil, nil
	}
	out := append([]entity.Landmark(nil), room.landmarks...)
	return out, nil
}

func voteExtendMajorityThreshold(n int) int {
	return entity.VoteExtendMajorityThreshold(n)
}

func playerIDInSlice(id string, list []string) bool {
	return entity.PlayerIDInSlice(id, list)
}

func (r *RoomRepository) PatchGameState(_ context.Context, roomID string, fn func(*entity.GameState) error) (entity.GameState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.ensureRoom(roomID)
	if err := fn(&room.game); err != nil {
		return entity.GameState{}, err
	}
	room.version++
	gs := room.game
	gs.PlayerCount = len(room.players)
	return gs, nil
}

func (r *RoomRepository) ApplyVoteExtend(_ context.Context, roomID, playerID string, extraMs int64, livePeerCountWhenRoundEmpty int) (repository.VoteExtendResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	room := r.ensureRoom(roomID)
	g := &room.game
	if g.Phase != entity.PhaseVoting {
		return repository.VoteExtendResult{Silent: true}, nil
	}
	if g.VoteExtendUsed {
		gs := *g
		gs.PlayerCount = len(room.players)
		return repository.VoteExtendResult{State: gs, MajorityApplied: false, Silent: false}, nil
	}
	for _, id := range g.VoteExtendRequestPlayerIDs {
		if id == playerID {
			return repository.VoteExtendResult{Silent: true}, nil
		}
	}
	round := g.RoundPlayerIDs
	if len(round) > 0 && !playerIDInSlice(playerID, round) {
		return repository.VoteExtendResult{Silent: true}, nil
	}

	req := append([]string(nil), g.VoteExtendRequestPlayerIDs...)
	req = append(req, playerID)
	sort.Strings(req)
	g.VoteExtendRequestPlayerIDs = req

	n := len(round)
	if n == 0 {
		n = livePeerCountWhenRoundEmpty
	}
	required := voteExtendMajorityThreshold(n)
	majorityApplied := false
	if len(g.VoteExtendRequestPlayerIDs) >= required {
		g.VoteExtendUsed = true
		g.VoteEnd += extraMs
		g.VoteExtendRequestPlayerIDs = nil
		majorityApplied = true
	}
	room.version++
	gs := *g
	gs.PlayerCount = len(room.players)
	return repository.VoteExtendResult{State: gs, MajorityApplied: majorityApplied, Silent: false}, nil
}

func snapshotFromRoom(roomID string, room *roomState) entity.RoomSnapshot {
	players := make([]entity.PlayerState, 0, len(room.players))
	for _, p := range room.players {
		players = append(players, p)
	}
	return entity.RoomSnapshot{
		RoomID:  roomID,
		Version: room.version,
		Players: players,
	}
}
