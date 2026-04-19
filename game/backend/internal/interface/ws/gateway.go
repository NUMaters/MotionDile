package ws

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/json"
	"errors"
	"log"
	"math/big"
	"math/rand"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"waniar/game-backend/internal/config"
	"waniar/game-backend/internal/domain/entity"
	"waniar/game-backend/internal/domain/repository"
	"waniar/game-backend/internal/scheduler"
	"waniar/game-backend/internal/usecase"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 2048

	// waitingフェーズでheartbeat/moveが来ない場合にキックするまでの時間
	idleKickTimeout = 30 * time.Second
	// アイドルチェックの実行間隔
	idleCheckInterval = 10 * time.Second
)

type gatewayMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type movePayload struct {
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

type votePayload struct {
	VotedFor string `json:"votedFor"`
}

type landmarkItem struct {
	Type string  `json:"type"`
	X    float64 `json:"x"`
	Z    float64 `json:"z"`
}

type landmarksPayload struct {
	Landmarks []landmarkItem `json:"landmarks"`
}

type snapshotEnvelope struct {
	Type    string              `json:"type"`
	Payload entity.RoomSnapshot `json:"payload"`
}

type genericEnvelope struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type Client struct {
	conn         *websocket.Conn
	send         chan []byte
	roomID       string
	playerID     string
	closeOnce    sync.Once
	lastActivity int64 // UnixMilli of last meaningful client activity (heartbeat/move)
}

type roomGameCtx struct {
	cancel context.CancelFunc
}

// RoomPublisher は Redis Pub/Sub 等で他 backend インスタンスへ同じペイロードを届けるための抽象。
type RoomPublisher interface {
	Publish(ctx context.Context, roomID string, payload []byte) error
}

type Gateway struct {
	upgrader websocket.Upgrader
	usecase  *usecase.RoomUsecase
	rules    config.Rules

	mu    sync.RWMutex
	rooms map[string]map[*Client]struct{}

	gameMu   sync.Mutex
	gameCtxs map[string]*roomGameCtx

	// 分散モード（Redis）。未設定時は従来どおりローカルタイマー + ローカル配信のみ。
	bus      RoomPublisher
	presence repository.RoomPresence
	deadline *scheduler.DeadlineRunner

	stopIdleChecker chan struct{}
}

func NewGateway(uc *usecase.RoomUsecase, rules config.Rules) *Gateway {
	g := &Gateway{
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin:     buildCheckOrigin(),
		},
		usecase:         uc,
		rules:           rules,
		rooms:           make(map[string]map[*Client]struct{}),
		gameCtxs:        make(map[string]*roomGameCtx),
		stopIdleChecker: make(chan struct{}),
	}
	go g.runIdleChecker()
	return g
}

// StopIdleChecker はサーバ終了時にアイドルチェッカーgoroutineを停止する。
func (g *Gateway) StopIdleChecker() {
	select {
	case <-g.stopIdleChecker:
	default:
		close(g.stopIdleChecker)
	}
}

// runIdleChecker は待機フェーズのルームを定期的にスキャンし、
// 一定時間アクティビティのないクライアントを切断する。
func (g *Gateway) runIdleChecker() {
	ticker := time.NewTicker(idleCheckInterval)
	defer ticker.Stop()
	for {
		select {
		case <-g.stopIdleChecker:
			return
		case <-ticker.C:
			g.kickIdleWaitingClients()
		}
	}
}

func (g *Gateway) kickIdleWaitingClients() {
	now := time.Now().UnixMilli()
	threshold := now - idleKickTimeout.Milliseconds()

	g.mu.RLock()
	var toKick []*Client
	for roomID, clients := range g.rooms {
		gs, err := g.usecase.GetGameState(context.Background(), roomID)
		if err != nil {
			continue
		}
		if gs.Phase != entity.PhaseWaiting && gs.Phase != "" {
			continue
		}
		for c := range clients {
			lastAct := c.lastActivity
			if lastAct > 0 && lastAct < threshold {
				toKick = append(toKick, c)
			}
		}
	}
	g.mu.RUnlock()

	for _, c := range toKick {
		log.Printf("[ws] kicking idle player %s from room %s (waiting phase)", c.playerID, c.roomID)
		_ = c.conn.Close()
	}
}

// SetDistributed は Redis バス・接続プレゼンス・期限ランナーを接続する（複数インスタンス運用時）。
func (g *Gateway) SetDistributed(bus RoomPublisher, pres repository.RoomPresence, dl *scheduler.DeadlineRunner) {
	g.bus = bus
	g.presence = pres
	g.deadline = dl
}

func (g *Gateway) useDistributed() bool {
	return g.deadline != nil
}

func (g *Gateway) syncDeadlines(roomID string) {
	if g.deadline == nil {
		return
	}
	gs, err := g.usecase.GetGameState(context.Background(), roomID)
	if err != nil {
		return
	}
	_ = g.deadline.SyncRoom(context.Background(), roomID, gs, g.rules, time.Now())
}

func (g *Gateway) connectedCount(roomID string) int {
	if g.presence != nil {
		n, err := g.presence.Count(context.Background(), roomID)
		if err == nil {
			return n
		}
	}
	return g.roomClientCount(roomID)
}

// DeliverFromBus は Redis 購読側からローカル WS へ同じ JSON を流す。
func (g *Gateway) DeliverFromBus(roomID string, data []byte) {
	var env gatewayMessage
	if json.Unmarshal(data, &env) == nil && env.Type == "relay_game_start" {
		g.sendGameStartToLocalClients(roomID)
		return
	}
	g.deliverRawToRoom(roomID, data)
}

func (g *Gateway) deliverRawToRoom(roomID string, data []byte) {
	g.mu.RLock()
	roomClients := g.rooms[roomID]
	g.mu.RUnlock()
	for client := range roomClients {
		select {
		case client.send <- data:
		default:
			go g.unregister(client)
		}
	}
}

func (g *Gateway) maybePublishRelayGameStart(roomID string) {
	if g.bus == nil {
		return
	}
	data, err := json.Marshal(genericEnvelope{Type: "relay_game_start", Payload: map[string]string{"roomId": roomID}})
	if err != nil {
		return
	}
	_ = g.bus.Publish(context.Background(), roomID, data)
}

// sendGameStartToLocalClients は Redis 上の Playing 状態に合わせ、ローカル接続へだけ role 付き game_start を送る。
func (g *Gateway) sendGameStartToLocalClients(roomID string) {
	gs, err := g.usecase.GetGameState(context.Background(), roomID)
	if err != nil || gs.Phase != entity.PhasePlaying {
		return
	}
	enemyID := gs.EnemyPlayerID
	allyTheme, enemyTheme := gs.AllyTheme, gs.EnemyTheme

	g.mu.RLock()
	clients := g.rooms[roomID]
	for client := range clients {
		role := "citizen"
		theme := allyTheme
		if client.playerID == enemyID {
			role = "enemy"
			theme = enemyTheme
		}
		payload := map[string]interface{}{
			"phase":         gs.Phase,
			"gameEnd":       gs.GameEnd,
			"playerCount":   g.connectedCount(roomID),
			"role":          role,
			"enemyPlayerId": "",
			"theme":         theme,
		}
		g.sendToClient(client, genericEnvelope{Type: "game_start", Payload: payload})
	}
	g.mu.RUnlock()
}

// buildCheckOrigin は WS_ALLOWED_ORIGINS 環境変数でオリジン制限を構築する。
// 未設定・空・"*" の場合は全許可（開発用）。カンマ区切りで複数指定可。
func buildCheckOrigin() func(r *http.Request) bool {
	raw := strings.TrimSpace(os.Getenv("WS_ALLOWED_ORIGINS"))
	if raw == "" || raw == "*" {
		return func(_ *http.Request) bool { return true }
	}
	allowed := make(map[string]struct{})
	for _, o := range strings.Split(raw, ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			allowed[o] = struct{}{}
		}
	}
	return func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		_, ok := allowed[origin]
		return ok
	}
}

func (g *Gateway) Handle(c *gin.Context) {
	roomID := c.Query("roomId")
	playerID := c.Query("playerId")
	if roomID == "" || playerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": "roomId and playerId are required"})
		return
	}

	displayName := c.Query("displayName")
	_, err := g.usecase.Join(c.Request.Context(), usecase.JoinInput{
		RoomID:      roomID,
		PlayerID:    playerID,
		DisplayName: displayName,
	})
	if err != nil {
		code := http.StatusBadRequest
		errCode := "INVALID_INPUT"
		if errors.Is(err, usecase.ErrGameInProgress) {
			code = http.StatusConflict
			errCode = "GAME_IN_PROGRESS"
		}
		c.JSON(code, gin.H{"ok": false, "code": errCode, "message": err.Error()})
		return
	}

	conn, err := g.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[ws] upgrade failed: %v", err)
		return
	}

	client := &Client{
		conn:         conn,
		send:         make(chan []byte, 32),
		roomID:       roomID,
		playerID:     playerID,
		lastActivity: time.Now().UnixMilli(),
	}
	g.register(client)
	if g.presence != nil {
		_ = g.presence.Add(context.Background(), roomID, playerID)
	}

	gs, _ := g.usecase.GetGameState(context.Background(), roomID)
	gs.PlayerCount = g.connectedCount(roomID)
	payload := g.buildGameStatePayload(roomID, gs)
	g.sendToClient(client, genericEnvelope{
		Type:    "game_state",
		Payload: payload,
	})

	go g.writePump(client)
	go g.checkGameTransition(roomID)
	g.readPump(client)
}

// shouldRemovePlayerOnSocketClose は待機ロビーのみ true。対戦・カウントダウン・投票・結果中に
// WebSocket が切れても REST の部屋メンバーは残し、同じ playerId で再参加できるようにする。
func shouldRemovePlayerOnSocketClose(phase entity.GamePhase) bool {
	return phase == entity.PhaseWaiting || phase == ""
}

func (g *Gateway) readPump(client *Client) {
	defer func() {
		if g.presence != nil {
			_ = g.presence.Remove(context.Background(), client.roomID, client.playerID)
		}
		g.unregister(client)
		gs, err := g.usecase.GetGameState(context.Background(), client.roomID)
		if err == nil && shouldRemovePlayerOnSocketClose(gs.Phase) {
			_, _ = g.usecase.Leave(context.Background(), client.roomID, client.playerID)
		}
		_ = client.conn.Close()
		go g.checkGameTransition(client.roomID)
	}()

	client.conn.SetReadLimit(maxMessageSize)
	_ = client.conn.SetReadDeadline(time.Now().Add(pongWait))
	client.conn.SetPongHandler(func(string) error {
		if g.presence != nil {
			_ = g.presence.Touch(context.Background(), client.roomID, client.playerID)
		}
		return client.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		var msg gatewayMessage
		if err := client.conn.ReadJSON(&msg); err != nil {
			return
		}

		switch msg.Type {
		case "move":
			g.handleMove(client, msg.Payload)
		case "vote":
			g.handleVote(client, msg.Payload)
		case "vote_extend":
			g.handleVoteExtend(client)
		case "heartbeat":
			client.lastActivity = time.Now().UnixMilli()
			if g.presence != nil {
				_ = g.presence.Touch(context.Background(), client.roomID, client.playerID)
			}
		case "landmarks":
			g.handleLandmarks(client, msg.Payload)
		}
	}
}

func (g *Gateway) handleMove(client *Client, raw json.RawMessage) {
	client.lastActivity = time.Now().UnixMilli()
	var mv movePayload
	if err := json.Unmarshal(raw, &mv); err != nil {
		return
	}

	snapshot, err := g.usecase.Move(context.Background(), usecase.MoveInput{
		RoomID:        client.roomID,
		PlayerID:      client.playerID,
		X:             mv.X,
		Y:             mv.Y,
		Z:             mv.Z,
		RotationY:     mv.RotationY,
		NeckYaw:       mv.NeckYaw,
		NeckPitch:     mv.NeckPitch,
		Animation:     mv.Animation,
		MouthOpenness: mv.MouthOpenness,
		IdleBob:       mv.IdleBob,
		IdlePitch:     mv.IdlePitch,
		IdleRoll:      mv.IdleRoll,
	})
	if err != nil {
		return
	}
	if g.presence != nil {
		_ = g.presence.Touch(context.Background(), client.roomID, client.playerID)
	}
	g.broadcastSnapshot(client.roomID, snapshot)
}

func (g *Gateway) handleVote(client *Client, raw json.RawMessage) {
	var vp votePayload
	if err := json.Unmarshal(raw, &vp); err != nil {
		return
	}

	gs, err := g.usecase.GetGameState(context.Background(), client.roomID)
	if err != nil || gs.Phase != entity.PhaseVoting {
		return
	}
	if len(gs.RoundPlayerIDs) > 0 {
		if !playerIDInList(client.playerID, gs.RoundPlayerIDs) {
			return
		}
		if !playerIDInList(vp.VotedFor, gs.RoundPlayerIDs) {
			return
		}
	}

	gs, err = g.usecase.CastVote(context.Background(), client.roomID, client.playerID, vp.VotedFor)
	if err != nil {
		return
	}

	g.broadcastToRoom(client.roomID, genericEnvelope{
		Type:    "game_state",
		Payload: gs,
	})

	quorum := g.voteQuorumTarget(gs, client.roomID)
	if quorum > 0 && len(gs.Votes) >= quorum {
		go g.finishVoting(client.roomID)
	}
}

const voteExtendExtraMs int64 = 10_000

// voteMajorityThreshold は過半数に必要な人数（⌊n/2⌋+1）。例: 5→3, 4→3, 3→2, 2→2, 1→1
func voteMajorityThreshold(n int) int {
	return entity.VoteExtendMajorityThreshold(n)
}

func (g *Gateway) handleVoteExtend(client *Client) {
	ctx := context.Background()
	live := g.connectedCount(client.roomID)
	ve, err := g.usecase.ApplyVoteExtend(ctx, client.roomID, client.playerID, voteExtendExtraMs, live)
	if err != nil {
		return
	}
	if ve.Silent {
		return
	}
	if ve.MajorityApplied {
		g.scheduleVotingEnd(client.roomID, ve.State.VoteEnd)
	}
	g.syncDeadlines(client.roomID)
	g.broadcastVoteExtendUpdate(client.roomID, ve.State, ve.MajorityApplied)
}

func (g *Gateway) broadcastVoteExtendUpdate(roomID string, gs entity.GameState, applied bool) {
	n := len(gs.RoundPlayerIDs)
	if n == 0 {
		n = g.connectedCount(roomID)
	}
	req := gs.VoteExtendRequestPlayerIDs
	if req == nil {
		req = []string{}
	}
	payload := map[string]interface{}{
		"voteEnd":          gs.VoteEnd,
		"voteExtendUsed":   gs.VoteExtendUsed,
		"requestPlayerIds": req,
		"requestCount":     len(req),
		"requiredCount":    voteMajorityThreshold(n),
		"roundPlayerCount": n,
		"applied":          applied,
	}
	g.broadcastToRoom(roomID, genericEnvelope{Type: "vote_extend_update", Payload: payload})
}

func (g *Gateway) scheduleVotingEnd(roomID string, voteEndUnixMs int64) {
	if g.deadline != nil {
		g.syncDeadlines(roomID)
		return
	}
	g.cancelGameTimer(roomID)
	rem := time.Until(time.UnixMilli(voteEndUnixMs))
	if rem < 0 {
		rem = 0
	}
	ctx, cancel := context.WithCancel(context.Background())
	g.gameMu.Lock()
	g.gameCtxs[roomID] = &roomGameCtx{cancel: cancel}
	g.gameMu.Unlock()

	go func() {
		select {
		case <-time.After(rem):
			g.gameMu.Lock()
			delete(g.gameCtxs, roomID)
			g.gameMu.Unlock()
			g.finishVoting(roomID)
		case <-ctx.Done():
		}
	}()
}

func (g *Gateway) handleLandmarks(client *Client, raw json.RawMessage) {
	var lp landmarksPayload
	if err := json.Unmarshal(raw, &lp); err != nil {
		return
	}
	items := make([]entity.Landmark, 0, len(lp.Landmarks))
	for _, l := range lp.Landmarks {
		items = append(items, entity.Landmark{Type: l.Type, X: l.X, Z: l.Z})
	}
	_ = g.usecase.SetLandmarks(context.Background(), client.roomID, items)
}

func (g *Gateway) getRoomLandmarks(roomID string) []entity.Landmark {
	lm, err := g.usecase.GetLandmarks(context.Background(), roomID)
	if err != nil || len(lm) == 0 {
		return nil
	}
	return lm
}

func (g *Gateway) writePump(client *Client) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = client.conn.Close()
	}()

	for {
		select {
		case message, ok := <-client.send:
			_ = client.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = client.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := client.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			_ = client.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := client.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (g *Gateway) register(client *Client) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if _, ok := g.rooms[client.roomID]; !ok {
		g.rooms[client.roomID] = make(map[*Client]struct{})
	}
	g.rooms[client.roomID][client] = struct{}{}
}

func (g *Gateway) unregister(client *Client) {
	g.mu.Lock()
	roomClients, ok := g.rooms[client.roomID]
	if !ok {
		g.mu.Unlock()
		return
	}
	if _, exists := roomClients[client]; !exists {
		g.mu.Unlock()
		return
	}
	delete(roomClients, client)
	client.closeOnce.Do(func() { close(client.send) })
	empty := len(roomClients) == 0
	if empty {
		delete(g.rooms, client.roomID)
	}
	g.mu.Unlock()
}

func (g *Gateway) roomClientCount(roomID string) int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return len(g.rooms[roomID])
}

func (g *Gateway) buildGameStatePayload(roomID string, gs entity.GameState) map[string]interface{} {
	snapshot, _ := g.usecase.Snapshot(context.Background(), roomID)
	roundSet := roundPlayerIDSet(gs.RoundPlayerIDs)
	filterRound := len(gs.RoundPlayerIDs) > 0 && (gs.Phase == entity.PhasePlaying || gs.Phase == entity.PhaseVoting)
	playerList := make([]map[string]string, 0, len(snapshot.Players))
	for _, p := range snapshot.Players {
		if filterRound && !roundSet[p.PlayerID] {
			continue
		}
		dn := p.DisplayName
		if dn == "" {
			dn = "プレイヤー"
		}
		playerList = append(playerList, map[string]string{
			"playerId":    p.PlayerID,
			"displayName": dn,
			"color":       p.Color,
		})
	}
	r := g.rules
	payload := map[string]interface{}{
		"phase":        gs.Phase,
		"playerCount":  gs.PlayerCount,
		"countdownEnd": gs.CountdownEnd,
		"gameEnd":      gs.GameEnd,
		"voteEnd":      gs.VoteEnd,
		"hintCount":    gs.HintCount,
		"players":      playerList,
		"rules": map[string]interface{}{
			"maxPlayers":        r.MaxPlayers,
			"minPlayers":        r.MinPlayers,
			"gameDurationSec":   int(r.GameDuration / time.Second),
			"matchCountdownSec": int(r.MatchCountdown / time.Second),
			"voteDurationSec":   int(r.VoteDuration / time.Second),
			"hintIntervalSec":   int(r.HintInterval / time.Second),
			"resultDurationSec": int(r.ResultDuration / time.Second),
		},
	}
	// 再接続クライアントが game_start を受け取れなくても UI を復元できるよう付与
	if gs.EnemyPlayerID != "" {
		payload["enemyPlayerId"] = gs.EnemyPlayerID
	}
	if gs.AllyTheme != "" {
		payload["allyTheme"] = gs.AllyTheme
	}
	if gs.EnemyTheme != "" {
		payload["enemyTheme"] = gs.EnemyTheme
	}
	if gs.Phase == entity.PhaseVoting {
		n := len(gs.RoundPlayerIDs)
		if n == 0 {
			n = g.connectedCount(roomID)
		}
		ids := gs.VoteExtendRequestPlayerIDs
		if ids == nil {
			ids = []string{}
		}
		payload["voteExtendUsed"] = gs.VoteExtendUsed
		payload["voteExtendRequestPlayerIds"] = ids
		payload["voteExtendRequiredCount"] = voteMajorityThreshold(n)
		votes := gs.Votes
		if votes == nil {
			votes = map[string]string{}
		}
		payload["votes"] = votes
	}
	return payload
}

func (g *Gateway) broadcastGameState(roomID string, gs entity.GameState) {
	payload := g.buildGameStatePayload(roomID, gs)
	g.broadcastToRoom(roomID, genericEnvelope{Type: "game_state", Payload: payload})
}

func (g *Gateway) checkGameTransition(roomID string) {
	gs, err := g.usecase.GetGameState(context.Background(), roomID)
	if err != nil {
		return
	}

	count := g.connectedCount(roomID)
	ctx := context.Background()

	switch gs.Phase {
	case entity.PhaseWaiting, "":
		if count >= g.rules.MaxPlayers {
			g.startGame(roomID)
			return
		}
		if count >= g.rules.MinPlayers {
			g.startCountdown(roomID)
			return
		}
		gs2, err := g.usecase.PatchGameState(ctx, roomID, func(st *entity.GameState) error {
			st.PlayerCount = count
			return nil
		})
		if err != nil {
			return
		}
		g.broadcastGameState(roomID, gs2)
	case entity.PhaseCountdown:
		if count >= g.rules.MaxPlayers {
			g.cancelGameTimer(roomID)
			g.startGame(roomID)
			return
		}
		if count < g.rules.MinPlayers {
			g.cancelGameTimer(roomID)
			gs2, err := g.usecase.PatchGameState(ctx, roomID, func(st *entity.GameState) error {
				st.Phase = entity.PhaseWaiting
				st.CountdownEnd = 0
				st.PlayerCount = count
				return nil
			})
			if err != nil {
				return
			}
			g.broadcastGameState(roomID, gs2)
			g.syncDeadlines(roomID)
			return
		}
		gs2, err := g.usecase.PatchGameState(ctx, roomID, func(st *entity.GameState) error {
			st.PlayerCount = count
			return nil
		})
		if err != nil {
			return
		}
		g.broadcastGameState(roomID, gs2)
	}
}

func (g *Gateway) cancelGameTimer(roomID string) {
	if g.deadline != nil {
		return
	}
	g.gameMu.Lock()
	defer g.gameMu.Unlock()
	if gc, ok := g.gameCtxs[roomID]; ok {
		gc.cancel()
		delete(g.gameCtxs, roomID)
	}
}

func (g *Gateway) startCountdown(roomID string) {
	if g.deadline != nil {
		gs0, _ := g.usecase.GetGameState(context.Background(), roomID)
		if gs0.Phase == entity.PhaseCountdown && gs0.CountdownEnd > time.Now().UnixMilli() {
			return
		}
		now := time.Now()
		cd := g.rules.MatchCountdown
		gs := entity.GameState{
			Phase:        entity.PhaseCountdown,
			CountdownEnd: now.Add(cd).UnixMilli(),
			PlayerCount:  g.connectedCount(roomID),
		}
		if err := g.usecase.SetGameState(context.Background(), roomID, gs); err != nil {
		log.Printf("[ws] SetGameState error (room=%s): %v", roomID, err)
	}
		g.broadcastGameState(roomID, gs)
		g.syncDeadlines(roomID)
		return
	}

	g.gameMu.Lock()
	if _, ok := g.gameCtxs[roomID]; ok {
		g.gameMu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	g.gameCtxs[roomID] = &roomGameCtx{cancel: cancel}
	g.gameMu.Unlock()

	now := time.Now()
	cd := g.rules.MatchCountdown
	gs := entity.GameState{
		Phase:        entity.PhaseCountdown,
		CountdownEnd: now.Add(cd).UnixMilli(),
		PlayerCount:  g.connectedCount(roomID),
	}
	if err := g.usecase.SetGameState(context.Background(), roomID, gs); err != nil {
		log.Printf("[ws] SetGameState error (room=%s): %v", roomID, err)
	}
	g.broadcastGameState(roomID, gs)

	go func() {
		select {
		case <-time.After(cd):
			g.gameMu.Lock()
			delete(g.gameCtxs, roomID)
			g.gameMu.Unlock()
			g.startGame(roomID)
		case <-ctx.Done():
		}
	}()
}

func (g *Gateway) startGame(roomID string) {
	var roundPlayerIDs []string
	if g.presence != nil {
		type active interface {
			ActivePlayerIDs(context.Context, string) ([]string, error)
		}
		pa, ok := g.presence.(active)
		if !ok {
			return
		}
		var err error
		roundPlayerIDs, err = pa.ActivePlayerIDs(context.Background(), roomID)
		if err != nil || len(roundPlayerIDs) == 0 {
			return
		}
	} else {
		g.mu.RLock()
		clients := g.rooms[roomID]
		roundIDs := make(map[string]struct{}, len(clients))
		for c := range clients {
			roundIDs[c.playerID] = struct{}{}
		}
		g.mu.RUnlock()
		for id := range roundIDs {
			roundPlayerIDs = append(roundPlayerIDs, id)
		}
		if len(roundPlayerIDs) == 0 {
			return
		}
	}
	sort.Strings(roundPlayerIDs)
	idx, ok := uniformCryptoIndex(len(roundPlayerIDs))
	if !ok {
		idx = rand.Intn(len(roundPlayerIDs))
	}
	enemyID := roundPlayerIDs[idx]

	allyTheme, enemyTheme, err := g.usecase.GenerateThemes(context.Background(), roomID, len(roundPlayerIDs))
	if err != nil {
		log.Printf("[ws] theme generation error for room %s: %v", roomID, err)
		return
	}

	now := time.Now()
	gd := g.rules.GameDuration
	gs := entity.GameState{
		Phase:          entity.PhasePlaying,
		EnemyPlayerID:  enemyID,
		RoundPlayerIDs: roundPlayerIDs,
		AllyTheme:      allyTheme,
		EnemyTheme:     enemyTheme,
		GameEnd:        now.Add(gd).UnixMilli(),
		PlayerCount:    g.connectedCount(roomID),
		Votes:          make(map[string]string),
	}
	if err := g.usecase.SetGameState(context.Background(), roomID, gs); err != nil {
		log.Printf("[ws] SetGameState error (room=%s): %v", roomID, err)
	}

	if g.deadline != nil {
		g.sendGameStartToLocalClients(roomID)
		g.maybePublishRelayGameStart(roomID)
		g.syncDeadlines(roomID)
		return
	}

	g.mu.RLock()
	clients := g.rooms[roomID]
	for client := range clients {
		role := "citizen"
		theme := allyTheme
		if client.playerID == enemyID {
			role = "enemy"
			theme = enemyTheme
		}
		payload := map[string]interface{}{
			"phase":         gs.Phase,
			"gameEnd":       gs.GameEnd,
			"playerCount":   gs.PlayerCount,
			"role":          role,
			"enemyPlayerId": "",
			"theme":         theme,
		}
		g.sendToClient(client, genericEnvelope{Type: "game_start", Payload: payload})
	}
	g.mu.RUnlock()

	ctx, cancel := context.WithCancel(context.Background())
	g.gameMu.Lock()
	g.gameCtxs[roomID] = &roomGameCtx{cancel: cancel}
	g.gameMu.Unlock()

	go g.runGameTimers(ctx, roomID)
}

func (g *Gateway) runGameTimers(ctx context.Context, roomID string) {
	hintTicker := time.NewTicker(g.rules.HintInterval)
	gameTimer := time.NewTimer(g.rules.GameDuration)
	defer hintTicker.Stop()
	defer gameTimer.Stop()

	hintNum := 0
	for {
		select {
		case <-hintTicker.C:
			// GenerateHint は Agent 呼び出しで数秒かかることがある。同期で待つと gameTimer と同時発火時に
			// 対戦終了→投票開始（vote_start）が遅延するため、ヒントだけ別ゴルーチンへ逃がす。
			hintNum++
			n := hintNum
			go func() {
				log.Printf("[ws] generating hint #%d for room %s", n, roomID)
				hint, err := g.usecase.GenerateHint(context.Background(), roomID, n, g.getRoomLandmarks(roomID))
				if err != nil {
					log.Printf("[ws] hint generation error for room %s: %v", roomID, err)
					return
				}
				gs, err := g.usecase.GetGameState(context.Background(), roomID)
				if err != nil || gs.Phase != entity.PhasePlaying {
					return
				}
				log.Printf("[ws] broadcasting hint #%d to room %s (len=%d)", n, roomID, len(hint.Text))
				g.broadcastToRoom(roomID, genericEnvelope{Type: "hint", Payload: hint})
			}()
		case <-gameTimer.C:
			g.gameMu.Lock()
			delete(g.gameCtxs, roomID)
			g.gameMu.Unlock()
			g.startVoting(roomID)
			return
		case <-ctx.Done():
			return
		}
	}
}

func (g *Gateway) startVoting(roomID string) {
	gs, _ := g.usecase.GetGameState(context.Background(), roomID)
	if gs.Phase != entity.PhasePlaying {
		return
	}
	now := time.Now()
	vd := g.rules.VoteDuration
	gs.Phase = entity.PhaseVoting
	gs.VoteEnd = now.Add(vd).UnixMilli()
	gs.Votes = make(map[string]string)
	gs.VoteExtendUsed = false
	gs.VoteExtendRequestPlayerIDs = nil
	if err := g.usecase.SetGameState(context.Background(), roomID, gs); err != nil {
		log.Printf("[ws] SetGameState error (room=%s): %v", roomID, err)
	}

	snapshot, _ := g.usecase.Snapshot(context.Background(), roomID)
	roundSet := roundPlayerIDSet(gs.RoundPlayerIDs)
	players := make([]map[string]string, 0, len(snapshot.Players))
	for _, p := range snapshot.Players {
		if len(gs.RoundPlayerIDs) > 0 && !roundSet[p.PlayerID] {
			continue
		}
		dn := p.DisplayName
		if dn == "" {
			dn = "プレイヤー"
		}
		players = append(players, map[string]string{
			"playerId":    p.PlayerID,
			"color":       p.Color,
			"displayName": dn,
		})
	}

	g.broadcastToRoom(roomID, genericEnvelope{
		Type: "vote_start",
		Payload: map[string]interface{}{
			"phase":   gs.Phase,
			"voteEnd": gs.VoteEnd,
			"players": players,
		},
	})

	g.scheduleVotingEnd(roomID, gs.VoteEnd)
}

func (g *Gateway) finishVoting(roomID string) {
	g.cancelGameTimer(roomID)

	result, err := g.usecase.TallyVotes(context.Background(), roomID)
	if err != nil {
		return
	}

	gs, _ := g.usecase.GetGameState(context.Background(), roomID)
	if gs.Phase != entity.PhaseVoting {
		return
	}
	now := time.Now()
	gs.Phase = entity.PhaseResults
	gs.ResultEnd = now.Add(g.rules.ResultDuration).UnixMilli()
	if err := g.usecase.SetGameState(context.Background(), roomID, gs); err != nil {
		log.Printf("[ws] SetGameState error (room=%s): %v", roomID, err)
	}
	g.syncDeadlines(roomID)

	g.broadcastToRoom(roomID, genericEnvelope{
		Type:    "vote_result",
		Payload: result,
	})

	if g.deadline != nil {
		return
	}
	go func() {
		time.Sleep(g.rules.ResultDuration)
		g.dissolveRoomAfterGame(roomID)
	}()
}

// dissolveRoomAfterGame は試合終了（結果表示時間経過後）に部屋を削除し、接続中のクライアントを切断する。
func (g *Gateway) dissolveRoomAfterGame(roomID string) {
	g.cancelGameTimer(roomID)

	g.mu.RLock()
	clients := g.rooms[roomID]
	list := make([]*Client, 0, len(clients))
	for c := range clients {
		list = append(list, c)
	}
	g.mu.RUnlock()

	if len(list) > 0 {
		g.broadcastToRoom(roomID, genericEnvelope{
			Type:    "room_closed",
			Payload: map[string]string{"reason": "game_finished"},
		})
	}

	if g.deadline != nil {
		_ = g.deadline.ClearRoom(context.Background(), roomID)
	}
	if err := g.usecase.DeleteRoom(context.Background(), roomID); err != nil {
		log.Printf("[ws] DeleteRoom %s: %v", roomID, err)
	}

	for _, c := range list {
		_ = c.conn.Close()
	}
}

func (g *Gateway) broadcastSnapshot(roomID string, snapshot entity.RoomSnapshot) {
	data, err := json.Marshal(snapshotEnvelope{Type: "snapshot", Payload: snapshot})
	if err != nil {
		return
	}
	if g.bus != nil {
		_ = g.bus.Publish(context.Background(), roomID, data)
		return
	}
	g.deliverRawToRoom(roomID, data)
}

func (g *Gateway) broadcastToRoom(roomID string, envelope genericEnvelope) {
	data, err := json.Marshal(envelope)
	if err != nil {
		return
	}
	if g.bus != nil {
		_ = g.bus.Publish(context.Background(), roomID, data)
		return
	}
	g.deliverRawToRoom(roomID, data)
}

func (g *Gateway) sendToClient(client *Client, envelope genericEnvelope) {
	data, err := json.Marshal(envelope)
	if err != nil {
		return
	}
	select {
	case client.send <- data:
	default:
	}
}

// --- scheduler.Callbacks（Redis 期限ワーカー）

func (g *Gateway) OnCountdownEnd(ctx context.Context, roomID string) {
	gs, err := g.usecase.GetGameState(ctx, roomID)
	if err != nil || gs.Phase != entity.PhaseCountdown {
		return
	}
	g.startGame(roomID)
}

func (g *Gateway) OnGameEnd(ctx context.Context, roomID string) {
	gs, err := g.usecase.GetGameState(ctx, roomID)
	if err != nil || gs.Phase != entity.PhasePlaying {
		return
	}
	g.startVoting(roomID)
}

func (g *Gateway) OnVoteEnd(ctx context.Context, roomID string) {
	gs, err := g.usecase.GetGameState(ctx, roomID)
	if err != nil || gs.Phase != entity.PhaseVoting {
		return
	}
	g.finishVoting(roomID)
}

func (g *Gateway) OnResultEnd(ctx context.Context, roomID string) {
	gs, err := g.usecase.GetGameState(ctx, roomID)
	if err != nil || gs.Phase != entity.PhaseResults {
		return
	}
	g.dissolveRoomAfterGame(roomID)
}

func (g *Gateway) OnHintTick(ctx context.Context, roomID string, seq int) {
	gs, err := g.usecase.GetGameState(ctx, roomID)
	if err != nil || gs.Phase != entity.PhasePlaying {
		return
	}
	log.Printf("[ws] generating hint #%d for room %s (distributed)", seq, roomID)
	hint, err := g.usecase.GenerateHint(ctx, roomID, seq, g.getRoomLandmarks(roomID))
	if err != nil {
		log.Printf("[ws] hint generation error for room %s: %v", roomID, err)
		return
	}
	gs2, err := g.usecase.GetGameState(ctx, roomID)
	if err != nil || gs2.Phase != entity.PhasePlaying {
		return
	}
	g.broadcastToRoom(roomID, genericEnvelope{Type: "hint", Payload: hint})

	if g.deadline == nil {
		return
	}
	nextAt := time.Now().Add(g.rules.HintInterval).UnixMilli()
	_ = g.deadline.ScheduleNextHint(ctx, roomID, seq+1, nextAt, gs2.GameEnd)
}

// uniformCryptoIndex は [0, n) の一様な整数を crypto/rand.Int で返す（単純な % より偏りがない）。
// 失敗時は ok=false。
func uniformCryptoIndex(n int) (idx int, ok bool) {
	if n <= 0 {
		return 0, false
	}
	v, err := cryptorand.Int(cryptorand.Reader, big.NewInt(int64(n)))
	if err != nil {
		return 0, false
	}
	return int(v.Int64()), true
}

func roundPlayerIDSet(ids []string) map[string]bool {
	m := make(map[string]bool, len(ids))
	for _, id := range ids {
		m[id] = true
	}
	return m
}

func playerIDInList(id string, list []string) bool {
	for _, x := range list {
		if x == id {
			return true
		}
	}
	return false
}

// voteQuorumTarget は投票成立に必要な票数（ラウンド参加者数。RoundPlayerIds 未設定時は従来どおり REST 上の全員）
func (g *Gateway) voteQuorumTarget(gs entity.GameState, roomID string) int {
	if len(gs.RoundPlayerIDs) > 0 {
		return len(gs.RoundPlayerIDs)
	}
	ids, _ := g.usecase.GetPlayerIDs(context.Background(), roomID)
	return len(ids)
}
