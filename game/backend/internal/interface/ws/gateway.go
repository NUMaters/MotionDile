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
)

type gatewayMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type movePayload struct {
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	Z         float64 `json:"z"`
	RotationY float64 `json:"rotationY"`
	NeckYaw   float64 `json:"neckYaw"`
	NeckPitch float64 `json:"neckPitch"`
	Animation string  `json:"animation"`
}

type snapshotEnvelope struct {
	Type    string              `json:"type"`
	Payload entity.RoomSnapshot `json:"payload"`
}

type Client struct {
	conn     *websocket.Conn
	send     chan []byte
	roomID   string
	playerID string
}

type Gateway struct {
	upgrader websocket.Upgrader
	usecase  *usecase.RoomUsecase

	mu    sync.RWMutex
	rooms map[string]map[*Client]struct{}
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
		usecase: usecase,
		rooms:   make(map[string]map[*Client]struct{}),
	}
}

func (g *Gateway) Handle(c *gin.Context) {
	roomID := c.Query("roomId")
	playerID := c.Query("playerId")
	if roomID == "" || playerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": "roomId and playerId are required"})
		return
	}

	_, err := g.usecase.Join(c.Request.Context(), usecase.JoinInput{
		RoomID:   roomID,
		PlayerID: playerID,
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
	go g.writePump(client)
	g.readPump(client)
}

func (g *Gateway) readPump(client *Client) {
	defer func() {
		g.unregister(client)
		_, _ = g.usecase.Leave(context.Background(), client.roomID, client.playerID)
		_ = client.conn.Close()
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
		if msg.Type != "move" {
			continue
		}

		var mv movePayload
		if err := json.Unmarshal(msg.Payload, &mv); err != nil {
			continue
		}

		snapshot, err := g.usecase.Move(context.Background(), usecase.MoveInput{
			RoomID:    client.roomID,
			PlayerID:  client.playerID,
			X:         mv.X,
			Y:         mv.Y,
			Z:         mv.Z,
			RotationY: mv.RotationY,
			NeckYaw:   mv.NeckYaw,
			NeckPitch: mv.NeckPitch,
			Animation: mv.Animation,
		})
		if err != nil {
			continue
		}
		g.broadcastSnapshot(client.roomID, snapshot)
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

func (g *Gateway) broadcastSnapshot(roomID string, snapshot entity.RoomSnapshot) {
	data, err := json.Marshal(snapshotEnvelope{
		Type:    "snapshot",
		Payload: snapshot,
	})
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
			// 遅いクライアントは切断して全体の遅延波及を防ぐ
			go g.unregister(client)
		}
	}
}
