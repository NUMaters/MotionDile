package http

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"waniar/game-backend/internal/usecase"
)

type RoomHandler struct {
	usecase *usecase.RoomUsecase
}

func NewRoomHandler(usecase *usecase.RoomUsecase) *RoomHandler {
	return &RoomHandler{usecase: usecase}
}

type joinRequest struct {
	PlayerID    string `json:"playerId"`
	DisplayName string `json:"displayName"`
}

func (h *RoomHandler) Join(c *gin.Context) {
	roomID := c.Param("roomID")
	var req joinRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": "invalid json"})
		return
	}

	snapshot, err := h.usecase.Join(c.Request.Context(), usecase.JoinInput{
		RoomID:      roomID,
		PlayerID:    req.PlayerID,
		DisplayName: req.DisplayName,
	})
	if err != nil {
		if errors.Is(err, usecase.ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "snapshot": snapshot})
}

func (h *RoomHandler) Snapshot(c *gin.Context) {
	roomID := c.Param("roomID")
	snapshot, err := h.usecase.Snapshot(c.Request.Context(), roomID)
	if err != nil {
		if errors.Is(err, usecase.ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "snapshot": snapshot})
}

func (h *RoomHandler) Leave(c *gin.Context) {
	roomID := c.Param("roomID")
	playerID := c.Param("playerID")
	snapshot, err := h.usecase.Leave(c.Request.Context(), roomID, playerID)
	if err != nil {
		if errors.Is(err, usecase.ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "snapshot": snapshot})
}
