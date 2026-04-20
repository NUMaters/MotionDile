package main

import (
	"context"
	"crypto/tls"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	"waniar/game-backend/internal/config"
	"waniar/game-backend/internal/domain/repository"
	"waniar/game-backend/internal/infrastructure/memory"
	redispkg "waniar/game-backend/internal/infrastructure/redis"
	httpif "waniar/game-backend/internal/interface/http"
	"waniar/game-backend/internal/interface/ws"
	"waniar/game-backend/internal/scheduler"
	"waniar/game-backend/internal/usecase"
)

func main() {
	redisAddr := strings.TrimSpace(os.Getenv("GAME_REDIS_ADDR"))
	redisPassword := strings.TrimSpace(os.Getenv("GAME_REDIS_PASSWORD"))
	redisTLS := strings.TrimSpace(os.Getenv("GAME_REDIS_TLS")) == "true"
	keyPrefix := getenv("GAME_REDIS_KEY_PREFIX", "waniar")

	var rdb *redis.Client
	var repo repository.RoomRepository = memory.NewRoomRepository()
	var bus *redispkg.RoomBus
	var pres *redispkg.PresenceTracker

	if redisAddr != "" {
		opts := &redis.Options{Addr: redisAddr}
		if redisPassword != "" {
			opts.Password = redisPassword
		}
		if redisTLS {
			opts.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
		}
		rdb = redis.NewClient(opts)
		if err := rdb.Ping(context.Background()).Err(); err != nil {
			log.Fatalf("[game-backend] redis ping %s: %v", redisAddr, err)
		}
		repo = redispkg.NewRoomRepository(rdb, keyPrefix)
		bus = redispkg.NewRoomBus(rdb, keyPrefix)
		pres = redispkg.NewPresenceTracker(rdb, keyPrefix)
		log.Printf("[game-backend] redis: %s (prefix=%s)", redisAddr, keyPrefix)
	} else {
		log.Printf("[game-backend] redis: disabled (in-memory room state). Set GAME_REDIS_ADDR for multi-instance.")
	}

	agentURL := getenv("AGENT_URL", "http://127.0.0.1:8091")
	gameRules := config.LoadRulesFromEnv()
	roomUsecase := usecase.NewRoomUsecase(repo, agentURL, gameRules)
	log.Printf("[game-backend] agent URL: %s", agentURL)
	log.Printf("[game-backend] game rules: play=%v countdown=%v hint=%v min=%d max=%d",
		gameRules.GameDuration, gameRules.MatchCountdown, gameRules.HintInterval, gameRules.MinPlayers, gameRules.MaxPlayers)
	roomHandler := httpif.NewRoomHandler(roomUsecase)
	wsGateway := ws.NewGateway(roomUsecase, gameRules)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if rdb != nil {
		dl := scheduler.NewDeadlineRunner(rdb, keyPrefix, wsGateway)
		wsGateway.SetDistributed(bus, pres, dl)
		go func() {
			if err := dl.Run(ctx); err != nil && err != context.Canceled {
				log.Printf("[game-backend] deadline runner: %v", err)
			}
		}()
		go func() {
			err := bus.Subscribe(ctx, "", func(roomID string, payload []byte) {
				wsGateway.DeliverFromBus(roomID, payload)
			})
			if err != nil && err != context.Canceled {
				log.Printf("[game-backend] redis subscribe: %v", err)
			}
		}()
	}

	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	r.Use(corsMiddleware())

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"ok":    true,
			"time":  time.Now().Format(time.RFC3339),
			"redis": redisAddr != "",
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
	raw := strings.TrimSpace(os.Getenv("CORS_ALLOWED_ORIGINS"))
	allowAll := raw == "" || raw == "*"
	var allowedOrigins map[string]struct{}
	if !allowAll {
		allowedOrigins = make(map[string]struct{})
		for _, o := range strings.Split(raw, ",") {
			o = strings.TrimSpace(o)
			if o != "" {
				allowedOrigins[o] = struct{}{}
			}
		}
	}

	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		if allowAll {
			c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		} else if _, ok := allowedOrigins[origin]; ok {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Vary", "Origin")
		}
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
