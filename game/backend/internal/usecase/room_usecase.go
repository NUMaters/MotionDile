package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"waniar/game-backend/internal/domain/entity"
	"waniar/game-backend/internal/domain/repository"
)

var ErrInvalidInput = errors.New("invalid input")

type JoinInput struct {
	RoomID      string
	PlayerID    string
	DisplayName string
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
	Animation     string  `json:"animation"`
	MouthOpenness float64 `json:"mouthOpenness"`
	IdleBob       float64 `json:"idleBob"`
	IdlePitch float64 `json:"idlePitch"`
	IdleRoll  float64 `json:"idleRoll"`
}

type RoomUsecase struct {
	repo     repository.RoomRepository
	agentURL string
	hc       *http.Client
}

func NewRoomUsecase(repo repository.RoomRepository, agentURL string) *RoomUsecase {
	return &RoomUsecase{
		repo:     repo,
		agentURL: agentURL,
		hc:       &http.Client{Timeout: 6 * time.Second},
	}
}

func (u *RoomUsecase) Join(ctx context.Context, in JoinInput) (entity.RoomSnapshot, error) {
	if strings.TrimSpace(in.RoomID) == "" || strings.TrimSpace(in.PlayerID) == "" {
		return entity.RoomSnapshot{}, ErrInvalidInput
	}
	name := strings.TrimSpace(in.DisplayName)
	if len([]rune(name)) > 16 {
		name = string([]rune(name)[:16])
	}
	initial := entity.PlayerState{
		PlayerID:    in.PlayerID,
		DisplayName: name,
		X:           0,
		Y:           0,
		Z:           0,
		RotationY:   0,
		NeckYaw:     0,
		NeckPitch:   0,
		Animation:   "Idle",
		UpdatedAt:   time.Now().UnixMilli(),
	}
	return u.repo.Join(ctx, in.RoomID, initial)
}

func (u *RoomUsecase) Move(ctx context.Context, in MoveInput) (entity.RoomSnapshot, error) {
	if strings.TrimSpace(in.RoomID) == "" || strings.TrimSpace(in.PlayerID) == "" {
		return entity.RoomSnapshot{}, ErrInvalidInput
	}
	state := entity.PlayerState{
		PlayerID:      in.PlayerID,
		X:             in.X,
		Y:             in.Y,
		Z:             in.Z,
		RotationY:     in.RotationY,
		NeckYaw:       in.NeckYaw,
		NeckPitch:     in.NeckPitch,
		Animation:     in.Animation,
		MouthOpenness: in.MouthOpenness,
		IdleBob:       in.IdleBob,
		IdlePitch:     in.IdlePitch,
		IdleRoll:      in.IdleRoll,
		UpdatedAt:     time.Now().UnixMilli(),
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

func (u *RoomUsecase) GetGameState(ctx context.Context, roomID string) (entity.GameState, error) {
	return u.repo.GetGameState(ctx, roomID)
}

func (u *RoomUsecase) SetGameState(ctx context.Context, roomID string, gs entity.GameState) error {
	return u.repo.SetGameState(ctx, roomID, gs)
}

func (u *RoomUsecase) PickEnemy(ctx context.Context, roomID string) (string, error) {
	return u.repo.PickEnemy(ctx, roomID)
}

func (u *RoomUsecase) CastVote(ctx context.Context, roomID, voterID, votedForID string) (entity.GameState, error) {
	return u.repo.CastVote(ctx, roomID, voterID, votedForID)
}

func (u *RoomUsecase) GetPlayerIDs(ctx context.Context, roomID string) ([]string, error) {
	return u.repo.GetPlayerIDs(ctx, roomID)
}

type agentPlayerInfo struct {
	PlayerID      string  `json:"playerId"`
	DisplayName   string  `json:"displayName"`
	X             float64 `json:"x"`
	Y             float64 `json:"y"`
	Z             float64 `json:"z"`
	RotationY     float64 `json:"rotationY"`
	Animation     string  `json:"animation"`
	MouthOpenness float64 `json:"mouthOpenness"`
	Color         string  `json:"color"`
	IsEnemy       bool    `json:"isEnemy"`
}

type LandmarkInfo struct {
	Type string  `json:"type"`
	X    float64 `json:"x"`
	Z    float64 `json:"z"`
}

type agentHintRequest struct {
	RoomID       string            `json:"roomId"`
	HintNumber   int               `json:"hintNumber"`
	GameDuration int               `json:"gameDuration"`
	ElapsedSec   int               `json:"elapsedSec"`
	MapRadius    float64           `json:"mapRadius"`
	Players      []agentPlayerInfo `json:"players"`
	Landmarks    []LandmarkInfo    `json:"landmarks,omitempty"`
}

type agentHintResponse struct {
	Text string `json:"text"`
}

func (u *RoomUsecase) GenerateHint(ctx context.Context, roomID string, hintNum int, landmarks []LandmarkInfo) (entity.HintInfo, error) {
	snapshot, err := u.repo.GetSnapshot(ctx, roomID)
	if err != nil {
		return entity.HintInfo{}, err
	}
	gs, err := u.repo.GetGameState(ctx, roomID)
	if err != nil {
		return entity.HintInfo{}, err
	}

	players := make([]agentPlayerInfo, 0, len(snapshot.Players))
	for _, p := range snapshot.Players {
		players = append(players, agentPlayerInfo{
			PlayerID:      p.PlayerID,
			DisplayName:   p.DisplayName,
			X:             p.X,
			Y:             p.Y,
			Z:             p.Z,
			RotationY:     p.RotationY,
			Animation:     p.Animation,
			MouthOpenness: p.MouthOpenness,
			Color:         p.Color,
			IsEnemy:       p.PlayerID == gs.EnemyPlayerID,
		})
	}

	elapsedSec := 0
	if gs.GameEnd > 0 {
		remaining := time.Until(time.UnixMilli(gs.GameEnd))
		if remaining < 0 {
			remaining = 0
		}
		elapsed := (30 * time.Second) - remaining
		elapsedSec = int(elapsed.Seconds())
	}

	reqBody := agentHintRequest{
		RoomID:       roomID,
		HintNumber:   hintNum,
		GameDuration: 30,
		ElapsedSec:   elapsedSec,
		MapRadius:    1.3,
		Players:      players,
		Landmarks:    landmarks,
	}

	hint, err := u.callAgentAPI(ctx, reqBody)
	if err != nil {
		log.Printf("[game] agent API error, using fallback: %v", err)
		return u.fallbackHint(hintNum, snapshot, gs), nil
	}

	return entity.HintInfo{Number: hintNum, Text: hint}, nil
}

func (u *RoomUsecase) callAgentAPI(ctx context.Context, req agentHintRequest) (string, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("marshal: %w", err)
	}

	url := u.agentURL + "/hint"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("new request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := u.hc.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("do: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("status %d: %s", resp.StatusCode, string(respBody))
	}

	var result agentHintResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("unmarshal: %w", err)
	}

	return result.Text, nil
}

func (u *RoomUsecase) fallbackHint(hintNum int, snap entity.RoomSnapshot, gs entity.GameState) entity.HintInfo {
	for _, p := range snap.Players {
		if p.PlayerID == gs.EnemyPlayerID {
			zone := fallbackZone(p.X, p.Z)
			movement := fallbackMovement(p.Animation)
			return entity.HintInfo{Number: hintNum, Text: fmt.Sprintf("%sで不審な%sを確認", zone, movement)}
		}
	}
	return entity.HintInfo{Number: hintNum, Text: "情報収集中…しばらくお待ちください"}
}

func fallbackZone(x, z float64) string {
	ns, ew := "", ""
	if z > 0.5 {
		ns = "北"
	} else if z < -0.5 {
		ns = "南"
	}
	if x > 0.5 {
		ew = "東"
	} else if x < -0.5 {
		ew = "西"
	}
	if ns == "" && ew == "" {
		return "中央エリア"
	}
	return ns + ew + "エリア"
}

func fallbackMovement(anim string) string {
	switch {
	case strings.Contains(anim, "Run"):
		return "走行"
	case strings.Contains(anim, "Walk"):
		return "歩行"
	default:
		return "動き"
	}
}

func (u *RoomUsecase) TallyVotes(ctx context.Context, roomID string) (entity.VoteResult, error) {
	gs, err := u.repo.GetGameState(ctx, roomID)
	if err != nil {
		return entity.VoteResult{}, err
	}

	counts := make(map[string]int)
	for _, votedFor := range gs.Votes {
		counts[votedFor]++
	}

	maxVotes := 0
	accused := ""
	for pid, c := range counts {
		if c > maxVotes {
			maxVotes = c
			accused = pid
		}
	}

	return entity.VoteResult{
		EnemyPlayerID: gs.EnemyPlayerID,
		Votes:         gs.Votes,
		VoteCounts:    counts,
		CitizensWin:   accused == gs.EnemyPlayerID,
	}, nil
}
