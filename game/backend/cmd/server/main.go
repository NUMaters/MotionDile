package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"

	"waniar/game-backend/internal/config"
	"waniar/game-backend/internal/infrastructure/memory"
	httpif "waniar/game-backend/internal/interface/http"
	"waniar/game-backend/internal/interface/ws"
	"waniar/game-backend/internal/usecase"
)

func main() {
	repo := memory.NewRoomRepository()
	agentURL := getenv("AGENT_URL", "http://127.0.0.1:8091")
	gameRules := config.LoadRulesFromEnv()
	roomUsecase := usecase.NewRoomUsecase(repo, agentURL, gameRules)
	log.Printf("[game-backend] agent URL: %s", agentURL)
	log.Printf("[game-backend] game rules: play=%v countdown=%v hint=%v min=%d max=%d",
		gameRules.GameDuration, gameRules.MatchCountdown, gameRules.HintInterval, gameRules.MinPlayers, gameRules.MaxPlayers)
	roomHandler := httpif.NewRoomHandler(roomUsecase)
	wsGateway := ws.NewGateway(roomUsecase, gameRules)

	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	r.Use(corsMiddleware())

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"ok":   true,
			"time": time.Now().Format(time.RFC3339),
		})
	})

	v1 := r.Group("/api/v1")
	{
		v1.POST("/rooms/resolve", roomHandler.ResolveLobby)
		v1.POST("/rooms/:roomID/players", roomHandler.Join)
		v1.GET("/rooms/:roomID/snapshot", roomHandler.Snapshot)
		v1.DELETE("/rooms/:roomID/players/:playerID", roomHandler.Leave)
	}

	r.GET("/ws", wsGateway.Handle)

	addr := getenv("GAME_BACKEND_ADDR", "127.0.0.1:8090")
	log.Printf("[game-backend] listening on http://%s", addr)
	log.Fatal(r.Run(addr))
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
