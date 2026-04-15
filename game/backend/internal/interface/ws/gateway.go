package ws

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"waniar/game-backend/internal/domain/entity"
	"waniar/game-backend/internal/usecase"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 2048

	minPlayersToCountdown = 3
	maxPlayersToStart     = 10
	countdownDuration     = 20 * time.Second
	gameDuration          = 60 * time.Second
	hintInterval          = 15 * time.Second
	voteDuration          = 20 * time.Second
	resultDuration        = 10 * time.Second
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
	conn     *websocket.Conn
	send     chan []byte
	roomID   string
	playerID string
}

type roomGameCtx struct {
	cancel context.CancelFunc
}

type Gateway struct {
	upgrader websocket.Upgrader
	usecase  *usecase.RoomUsecase

	mu    sync.RWMutex
	rooms map[string]map[*Client]struct{}

	gameMu   sync.Mutex
	gameCtxs map[string]*roomGameCtx

	landmarksMu sync.RWMutex
	landmarks   map[string][]usecase.LandmarkInfo
}

func NewGateway(uc *usecase.RoomUsecase) *Gateway {
	return &Gateway{
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin:     buildCheckOrigin(),
		},
		usecase:   uc,
		rooms:     make(map[string]map[*Client]struct{}),
		gameCtxs:  make(map[string]*roomGameCtx),
		landmarks: make(map[string][]usecase.LandmarkInfo),
	}
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
		conn:     conn,
		send:     make(chan []byte, 32),
		roomID:   roomID,
		playerID: playerID,
	}
	g.register(client)

	gs, _ := g.usecase.GetGameState(context.Background(), roomID)
	gs.PlayerCount = g.roomClientCount(roomID)
	payload := g.buildGameStatePayload(roomID, gs)
	g.sendToClient(client, genericEnvelope{
		Type:    "game_state",
		Payload: payload,
	})

	go g.writePump(client)
	go g.checkGameTransition(roomID)
	g.readPump(client)
}

func (g *Gateway) readPump(client *Client) {
	defer func() {
		g.unregister(client)
		_, _ = g.usecase.Leave(context.Background(), client.roomID, client.playerID)
		_ = client.conn.Close()
		go g.checkGameTransition(client.roomID)
	}()

	client.conn.SetReadLimit(maxMessageSize)
	_ = client.conn.SetReadDeadline(time.Now().Add(pongWait))
	client.conn.SetPongHandler(func(string) error {
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
		case "landmarks":
			g.handleLandmarks(client, msg.Payload)
		}
	}
}

func (g *Gateway) handleMove(client *Client, raw json.RawMessage) {
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

func (g *Gateway) handleLandmarks(client *Client, raw json.RawMessage) {
	var lp landmarksPayload
	if err := json.Unmarshal(raw, &lp); err != nil {
		return
	}
	items := make([]usecase.LandmarkInfo, 0, len(lp.Landmarks))
	for _, l := range lp.Landmarks {
		items = append(items, usecase.LandmarkInfo{Type: l.Type, X: l.X, Z: l.Z})
	}
	g.landmarksMu.Lock()
	g.landmarks[client.roomID] = items
	g.landmarksMu.Unlock()
}

func (g *Gateway) getRoomLandmarks(roomID string) []usecase.LandmarkInfo {
	g.landmarksMu.RLock()
	defer g.landmarksMu.RUnlock()
	return g.landmarks[roomID]
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
	delete(roomClients, client)
	close(client.send)
	empty := len(roomClients) == 0
	if empty {
		delete(g.rooms, client.roomID)
	}
	g.mu.Unlock()

	if empty {
		g.landmarksMu.Lock()
		delete(g.landmarks, client.roomID)
		g.landmarksMu.Unlock()
	}
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
			"displayName": dn,
			"color":       p.Color,
		})
	}
	return map[string]interface{}{
		"phase":        gs.Phase,
		"playerCount":  gs.PlayerCount,
		"countdownEnd": gs.CountdownEnd,
		"gameEnd":      gs.GameEnd,
		"voteEnd":      gs.VoteEnd,
		"hintCount":    gs.HintCount,
		"players":      playerList,
	}
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

	count := g.roomClientCount(roomID)
	gs.PlayerCount = count

	switch gs.Phase {
	case entity.PhaseWaiting, "":
		if count >= maxPlayersToStart {
			g.startGame(roomID)
			return
		}
		if count >= minPlayersToCountdown {
			g.startCountdown(roomID)
			return
		}
		_ = g.usecase.SetGameState(context.Background(), roomID, gs)
		g.broadcastGameState(roomID, gs)
	case entity.PhaseCountdown:
		if count >= maxPlayersToStart {
			g.cancelGameTimer(roomID)
			g.startGame(roomID)
			return
		}
		if count < minPlayersToCountdown {
			g.cancelGameTimer(roomID)
			gs.Phase = entity.PhaseWaiting
			gs.CountdownEnd = 0
			_ = g.usecase.SetGameState(context.Background(), roomID, gs)
			g.broadcastGameState(roomID, gs)
			return
		}
		_ = g.usecase.SetGameState(context.Background(), roomID, gs)
		g.broadcastGameState(roomID, gs)
	}
}

func (g *Gateway) cancelGameTimer(roomID string) {
	g.gameMu.Lock()
	defer g.gameMu.Unlock()
	if gc, ok := g.gameCtxs[roomID]; ok {
		gc.cancel()
		delete(g.gameCtxs, roomID)
	}
}

func (g *Gateway) startCountdown(roomID string) {
	g.gameMu.Lock()
	if _, ok := g.gameCtxs[roomID]; ok {
		g.gameMu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	g.gameCtxs[roomID] = &roomGameCtx{cancel: cancel}
	g.gameMu.Unlock()

	now := time.Now()
	gs := entity.GameState{
		Phase:        entity.PhaseCountdown,
		CountdownEnd: now.Add(countdownDuration).UnixMilli(),
		PlayerCount:  g.roomClientCount(roomID),
	}
	_ = g.usecase.SetGameState(context.Background(), roomID, gs)
	g.broadcastGameState(roomID, gs)

	go func() {
		select {
		case <-time.After(countdownDuration):
			g.gameMu.Lock()
			delete(g.gameCtxs, roomID)
			g.gameMu.Unlock()
			g.startGame(roomID)
		case <-ctx.Done():
		}
	}()
}

func (g *Gateway) startGame(roomID string) {
	g.mu.RLock()
	clients := g.rooms[roomID]
	roundIDs := make(map[string]struct{}, len(clients))
	for c := range clients {
		roundIDs[c.playerID] = struct{}{}
	}
	g.mu.RUnlock()

	roundPlayerIDs := make([]string, 0, len(roundIDs))
	for id := range roundIDs {
		roundPlayerIDs = append(roundPlayerIDs, id)
	}
	if len(roundPlayerIDs) == 0 {
		return
	}
	sort.Strings(roundPlayerIDs)
	idx, ok := uniformCryptoIndex(len(roundPlayerIDs))
	if !ok {
		idx = rand.Intn(len(roundPlayerIDs))
	}
	enemyID := roundPlayerIDs[idx]

	allyTheme, enemyTheme := usecase.PickThemes()

	now := time.Now()
	gs := entity.GameState{
		Phase:          entity.PhasePlaying,
		EnemyPlayerID:  enemyID,
		RoundPlayerIDs: roundPlayerIDs,
		AllyTheme:      allyTheme,
		EnemyTheme:     enemyTheme,
		GameEnd:        now.Add(gameDuration).UnixMilli(),
		PlayerCount:    g.roomClientCount(roomID),
		Votes:          make(map[string]string),
	}
	_ = g.usecase.SetGameState(context.Background(), roomID, gs)

	g.mu.RLock()
	clients = g.rooms[roomID]
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
		g.sendToClientRaw(client, genericEnvelope{Type: "game_start", Payload: payload})
	}
	g.mu.RUnlock()

	ctx, cancel := context.WithCancel(context.Background())
	g.gameMu.Lock()
	g.gameCtxs[roomID] = &roomGameCtx{cancel: cancel}
	g.gameMu.Unlock()

	go g.runGameTimers(ctx, roomID)
}

func (g *Gateway) runGameTimers(ctx context.Context, roomID string) {
	hintTicker := time.NewTicker(hintInterval)
	gameTimer := time.NewTimer(gameDuration)
	defer hintTicker.Stop()
	defer gameTimer.Stop()

	hintNum := 0
	for {
		select {
		case <-hintTicker.C:
			hintNum++
			log.Printf("[ws] generating hint #%d for room %s", hintNum, roomID)
			hint, err := g.usecase.GenerateHint(context.Background(), roomID, hintNum, g.getRoomLandmarks(roomID))
			if err != nil {
				log.Printf("[ws] hint generation error for room %s: %v", roomID, err)
			} else {
				log.Printf("[ws] broadcasting hint #%d to room %s (len=%d)", hintNum, roomID, len(hint.Text))
				g.broadcastToRoom(roomID, genericEnvelope{Type: "hint", Payload: hint})
			}
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
	now := time.Now()
	gs.Phase = entity.PhaseVoting
	gs.VoteEnd = now.Add(voteDuration).UnixMilli()
	gs.Votes = make(map[string]string)
	_ = g.usecase.SetGameState(context.Background(), roomID, gs)

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

	ctx, cancel := context.WithCancel(context.Background())
	g.gameMu.Lock()
	g.gameCtxs[roomID] = &roomGameCtx{cancel: cancel}
	g.gameMu.Unlock()

	go func() {
		select {
		case <-time.After(voteDuration):
			g.gameMu.Lock()
			delete(g.gameCtxs, roomID)
			g.gameMu.Unlock()
			g.finishVoting(roomID)
		case <-ctx.Done():
		}
	}()
}

func (g *Gateway) finishVoting(roomID string) {
	g.cancelGameTimer(roomID)

	result, err := g.usecase.TallyVotes(context.Background(), roomID)
	if err != nil {
		return
	}

	gs, _ := g.usecase.GetGameState(context.Background(), roomID)
	gs.Phase = entity.PhaseResults
	_ = g.usecase.SetGameState(context.Background(), roomID, gs)

	g.broadcastToRoom(roomID, genericEnvelope{
		Type:    "vote_result",
		Payload: result,
	})

	go func() {
		time.Sleep(resultDuration)
		g.resetGame(roomID)
	}()
}

func (g *Gateway) resetGame(roomID string) {
	gs := entity.GameState{
		Phase:       entity.PhaseWaiting,
		PlayerCount: g.roomClientCount(roomID),
	}
	_ = g.usecase.SetGameState(context.Background(), roomID, gs)
	g.broadcastGameState(roomID, gs)
}

func (g *Gateway) broadcastSnapshot(roomID string, snapshot entity.RoomSnapshot) {
	data, err := json.Marshal(snapshotEnvelope{Type: "snapshot", Payload: snapshot})
	if err != nil {
		return
	}
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

func (g *Gateway) broadcastToRoom(roomID string, envelope genericEnvelope) {
	data, err := json.Marshal(envelope)
	if err != nil {
		return
	}
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

func (g *Gateway) sendToClientRaw(client *Client, envelope genericEnvelope) {
	data, err := json.Marshal(envelope)
	if err != nil {
		return
	}
	select {
	case client.send <- data:
	default:
	}
}

// uniformCryptoIndex は [0, n) の一様な整数を crypto/rand で返す。失敗時は ok=false。
func uniformCryptoIndex(n int) (idx int, ok bool) {
	if n <= 0 {
		return 0, false
	}
	var b [8]byte
	if _, err := cryptorand.Read(b[:]); err != nil {
		return 0, false
	}
	u := binary.LittleEndian.Uint64(b[:])
	return int(u % uint64(n)), true
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
