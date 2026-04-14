package ws

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
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
	gameDuration          = 30 * time.Second
	hintInterval          = 10 * time.Second
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
}

func NewGateway(usecase *usecase.RoomUsecase) *Gateway {
	return &Gateway{
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(_ *http.Request) bool {
				return true
			},
		},
		usecase:  usecase,
		rooms:    make(map[string]map[*Client]struct{}),
		gameCtxs: make(map[string]*roomGameCtx),
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
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
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

	gs, err := g.usecase.CastVote(context.Background(), client.roomID, client.playerID, vp.VotedFor)
	if err != nil {
		return
	}

	g.broadcastToRoom(client.roomID, genericEnvelope{
		Type:    "game_state",
		Payload: gs,
	})

	playerIDs, _ := g.usecase.GetPlayerIDs(context.Background(), client.roomID)
	if len(gs.Votes) >= len(playerIDs) {
		go g.finishVoting(client.roomID)
	}
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
	defer g.mu.Unlock()
	roomClients, ok := g.rooms[client.roomID]
	if !ok {
		return
	}
	delete(roomClients, client)
	close(client.send)
	if len(roomClients) == 0 {
		delete(g.rooms, client.roomID)
	}
}

func (g *Gateway) roomClientCount(roomID string) int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return len(g.rooms[roomID])
}

func (g *Gateway) buildGameStatePayload(roomID string, gs entity.GameState) map[string]interface{} {
	snapshot, _ := g.usecase.Snapshot(context.Background(), roomID)
	playerList := make([]map[string]string, 0, len(snapshot.Players))
	for _, p := range snapshot.Players {
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
	enemyID, err := g.usecase.PickEnemy(context.Background(), roomID)
	if err != nil || enemyID == "" {
		return
	}

	now := time.Now()
	gs := entity.GameState{
		Phase:         entity.PhasePlaying,
		EnemyPlayerID: enemyID,
		GameEnd:       now.Add(gameDuration).UnixMilli(),
		PlayerCount:   g.roomClientCount(roomID),
		Votes:         make(map[string]string),
	}
	_ = g.usecase.SetGameState(context.Background(), roomID, gs)

	g.mu.RLock()
	clients := g.rooms[roomID]
	for client := range clients {
		role := "citizen"
		if client.playerID == enemyID {
			role = "enemy"
		}
		payload := map[string]interface{}{
			"phase":         gs.Phase,
			"gameEnd":       gs.GameEnd,
			"playerCount":   gs.PlayerCount,
			"role":          role,
			"enemyPlayerId": "",
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
			hint, err := g.usecase.GenerateHint(context.Background(), roomID, hintNum)
			if err == nil {
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
	players := make([]map[string]string, 0, len(snapshot.Players))
	for _, p := range snapshot.Players {
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
