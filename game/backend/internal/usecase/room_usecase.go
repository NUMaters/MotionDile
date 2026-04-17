package usecase

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"waniar/game-backend/internal/config"
	"waniar/game-backend/internal/domain/entity"
	"waniar/game-backend/internal/domain/repository"
)

var ErrInvalidInput = errors.New("invalid input")

// ErrGameInProgress は対戦・投票・結果表示中に、まだその部屋にいないプレイヤーが Join しようとしたとき
var ErrGameInProgress = errors.New("game in progress")

// ErrRoomFull はロビーで定員に達しており、新規参加できないとき
var ErrRoomFull = errors.New("room is full")

func isLobbyPhase(ph entity.GamePhase) bool {
	return ph == "" || ph == entity.PhaseWaiting || ph == entity.PhaseCountdown
}

type JoinInput struct {
	RoomID      string
	PlayerID    string
	DisplayName string
}

type MoveInput struct {
	RoomID        string
	PlayerID      string
	X             float64 `json:"x"`
	Y             float64 `json:"y"`
	Z             float64 `json:"z"`
	RotationY     float64 `json:"rotationY"`
	NeckYaw       float64 `json:"neckYaw"`
	NeckPitch     float64 `json:"neckPitch"`
	Animation     string  `json:"animation"`
	MouthOpenness float64 `json:"mouthOpenness"`
	IdleBob       float64 `json:"idleBob"`
	IdlePitch     float64 `json:"idlePitch"`
	IdleRoll      float64 `json:"idleRoll"`
}

type RoomUsecase struct {
	repo     repository.RoomRepository
	agentURL string
	hc       *http.Client
	rules    config.Rules
}

func NewRoomUsecase(repo repository.RoomRepository, agentURL string, rules config.Rules) *RoomUsecase {
	return &RoomUsecase{
		repo:     repo,
		agentURL: agentURL,
		hc:       &http.Client{Timeout: 6 * time.Second},
		rules:    rules,
	}
}

func (u *RoomUsecase) Join(ctx context.Context, in JoinInput) (entity.RoomSnapshot, error) {
	if strings.TrimSpace(in.RoomID) == "" || strings.TrimSpace(in.PlayerID) == "" {
		return entity.RoomSnapshot{}, ErrInvalidInput
	}
	existingSnap, err := u.repo.GetSnapshot(ctx, in.RoomID)
	if err != nil {
		return entity.RoomSnapshot{}, err
	}
	gs, err := u.repo.GetGameState(ctx, in.RoomID)
	if err != nil {
		return entity.RoomSnapshot{}, err
	}
	isReturning := false
	for _, p := range existingSnap.Players {
		if p.PlayerID == in.PlayerID {
			isReturning = true
			break
		}
	}
	if !isLobbyPhase(gs.Phase) && !isReturning {
		return entity.RoomSnapshot{}, ErrGameInProgress
	}
	if !isReturning && len(existingSnap.Players) >= u.rules.MaxPlayers {
		return entity.RoomSnapshot{}, ErrRoomFull
	}
	name := strings.TrimSpace(in.DisplayName)
	if len([]rune(name)) > 16 {
		name = string([]rune(name)[:16])
	}
	initial := entity.PlayerState{
		PlayerID:    in.PlayerID,
		DisplayName: name,
		Y:           0,
		NeckYaw:     0,
		NeckPitch:   0,
		Animation:   "Idle",
		UpdatedAt:   time.Now().UnixMilli(),
	}
	if isReturning {
		for _, p := range existingSnap.Players {
			if p.PlayerID == in.PlayerID {
				initial.X, initial.Y, initial.Z = p.X, p.Y, p.Z
				initial.RotationY = p.RotationY
				break
			}
		}
	} else {
		x, y, z, ry := InitialSpawnPosition(existingSnap.Players, in.PlayerID, u.rules.MapRadius)
		initial.X, initial.Y, initial.Z = x, y, z
		initial.RotationY = ry
	}
	return u.repo.Join(ctx, in.RoomID, initial)
}

// ResolveLobbyRoom は部屋 ID の解決のみ行う。
// preferred が空のときは、待機中の部屋をいずれか一つ選び（なければ新規作成）。既定 URL（クエリなし）からの参加用。
// preferred が空でないときは常にその ID を返す（対戦・投票・結果中でも）。可否は Join が既存メンバーかどうかで判定する。
// リロード後も同じ部屋を preferred に渡せるようにし、別ロビーへ誘導されないようにする。
// excludeRoomID が空でないときは preferred が空の場合のみ、該当 ID の待機ルームはスキップする（ゲーム終了直後に別プールへ入るため）。
func (u *RoomUsecase) ResolveLobbyRoom(ctx context.Context, preferredRoomID, excludeRoomID string) (roomID string, redirected bool, reason string, err error) {
	preferredRoomID = strings.TrimSpace(preferredRoomID)
	excludeRoomID = strings.TrimSpace(excludeRoomID)

	allIDs, err := u.repo.ListRoomIDs(ctx)
	if err != nil {
		return "", false, "", err
	}

	if preferredRoomID == "" {
		for _, id := range allIDs {
			if excludeRoomID != "" && id == excludeRoomID {
				continue
			}
			g, e := u.repo.GetGameState(ctx, id)
			if e != nil {
				continue
			}
			if isLobbyPhase(g.Phase) {
				return id, true, "auto_existing", nil
			}
		}
		newID, err := u.allocNewLobbyRoomID(allIDs)
		if err != nil {
			return "", false, "", err
		}
		return newID, true, "auto_create", nil
	}

	if _, err := u.repo.GetGameState(ctx, preferredRoomID); err != nil {
		return "", false, "", err
	}
	return preferredRoomID, false, "", nil
}

func (u *RoomUsecase) allocNewLobbyRoomID(existing []string) (string, error) {
	taken := make(map[string]struct{}, len(existing))
	for _, id := range existing {
		taken[id] = struct{}{}
	}
	for range 48 {
		var b [4]byte
		if _, err := rand.Read(b[:]); err != nil {
			return "", err
		}
		id := "lobby-" + hex.EncodeToString(b[:])
		if _, ok := taken[id]; !ok {
			return id, nil
		}
	}
	return "", fmt.Errorf("could not allocate room id")
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

// DeleteRoom は部屋と参加者・ゲーム状態をメモリから削除する（試合終了後の解体用）。
func (u *RoomUsecase) DeleteRoom(ctx context.Context, roomID string) error {
	if strings.TrimSpace(roomID) == "" {
		return ErrInvalidInput
	}
	return u.repo.DeleteRoom(ctx, roomID)
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
	AllyTheme    string            `json:"allyTheme,omitempty"`
	EnemyTheme   string            `json:"enemyTheme,omitempty"`
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

	roundSet := roundPlayerIDSetFromGameState(gs)
	players := make([]agentPlayerInfo, 0, len(snapshot.Players))
	for _, p := range snapshot.Players {
		if roundSet != nil && !roundSet[p.PlayerID] {
			continue
		}
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
		elapsed := u.rules.GameDuration - remaining
		if elapsed < 0 {
			elapsed = 0
		}
		elapsedSec = int(elapsed.Seconds())
	}

	gameDurSec := int(u.rules.GameDuration / time.Second)
	if gameDurSec < 1 {
		gameDurSec = 1
	}

	reqBody := agentHintRequest{
		RoomID:       roomID,
		HintNumber:   hintNum,
		GameDuration: gameDurSec,
		ElapsedSec:   elapsedSec,
		MapRadius:    u.rules.MapRadius,
		AllyTheme:    gs.AllyTheme,
		EnemyTheme:   gs.EnemyTheme,
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

func roundPlayerIDSetFromGameState(gs entity.GameState) map[string]bool {
	if len(gs.RoundPlayerIDs) == 0 {
		return nil
	}
	m := make(map[string]bool, len(gs.RoundPlayerIDs))
	for _, id := range gs.RoundPlayerIDs {
		m[id] = true
	}
	return m
}

func (u *RoomUsecase) fallbackHint(hintNum int, snap entity.RoomSnapshot, gs entity.GameState) entity.HintInfo {
	roundSet := roundPlayerIDSetFromGameState(gs)
	for _, p := range snap.Players {
		if roundSet != nil && !roundSet[p.PlayerID] {
			continue
		}
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

	snap, err := u.repo.GetSnapshot(ctx, roomID)
	if err != nil {
		return entity.VoteResult{}, err
	}
	enemyColor := ""
	for _, p := range snap.Players {
		if p.PlayerID == gs.EnemyPlayerID {
			enemyColor = p.Color
			break
		}
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
		EnemyColor:    enemyColor,
		AllyTheme:     gs.AllyTheme,
		EnemyTheme:    gs.EnemyTheme,
		Votes:         gs.Votes,
		VoteCounts:    counts,
		CitizensWin:   accused == gs.EnemyPlayerID,
	}, nil
}
