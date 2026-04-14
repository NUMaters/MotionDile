package memory

import (
	"context"
	"sync"

	"waniar/game-backend/internal/domain/entity"
)

type roomState struct {
	version int64
	players map[string]entity.PlayerState
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
	} else {
		initial.Color = pickUnusedColor(room)
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
	for _, c := range entity.PlayerColors {
		if !used[c] {
			return c
		}
	}
	return entity.PlayerColors[len(room.players)%len(entity.PlayerColors)]
}

func (r *RoomRepository) UpsertState(_ context.Context, roomID string, state entity.PlayerState) (entity.RoomSnapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	room := r.ensureRoom(roomID)
	if existing, ok := room.players[state.PlayerID]; ok {
		state.Color = existing.Color
	}
	room.players[state.PlayerID] = state
	room.version++
	return snapshotFromRoom(roomID, room), nil
}

func (r *RoomRepository) RemovePlayer(_ context.Context, roomID, playerID string) (entity.RoomSnapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	room := r.ensureRoom(roomID)
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
