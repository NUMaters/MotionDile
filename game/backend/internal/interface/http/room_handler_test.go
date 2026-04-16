package http

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"waniar/game-backend/internal/config"
	"waniar/game-backend/internal/infrastructure/memory"
	"waniar/game-backend/internal/usecase"
)

func newTestHandler(t *testing.T) *RoomHandler {
	t.Helper()
	repo := memory.NewRoomRepository()
	uc := usecase.NewRoomUsecase(repo, "", config.Rules{MaxPlayers: 10})
	return NewRoomHandler(uc)
}

func TestRoomHandler_Join_OK(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := newTestHandler(t)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "roomID", Value: "room-x"}}
	body := bytes.NewBufferString(`{"playerId":"p1","displayName":"Test"}`)
	c.Request = httptest.NewRequest(http.MethodPost, "/", body)
	c.Request.Header.Set("Content-Type", "application/json")

	h.Join(c)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
	var out struct {
		Ok       bool `json:"ok"`
		Snapshot struct {
			RoomID string `json:"roomId"`
		} `json:"snapshot"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if !out.Ok || out.Snapshot.RoomID != "room-x" {
		t.Fatalf("unexpected: %+v", out)
	}
}

func TestRoomHandler_Join_InvalidJSON(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := newTestHandler(t)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "roomID", Value: "r"}}
	c.Request = httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{`))
	c.Request.Header.Set("Content-Type", "application/json")
	h.Join(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400 got %d", w.Code)
	}
}

func TestRoomHandler_Snapshot_ErrInvalidInput(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := newTestHandler(t)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "roomID", Value: "  "}}
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	h.Snapshot(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400 got %d", w.Code)
	}
}

func TestRoomHandler_ResolveLobby_OK(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := newTestHandler(t)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{}`))
	c.Request.Header.Set("Content-Type", "application/json")
	h.ResolveLobby(c)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d %s", w.Code, w.Body.String())
	}
}

func TestRoomHandler_Leave_OK(t *testing.T) {
	gin.SetMode(gin.TestMode)
	repo := memory.NewRoomRepository()
	uc := usecase.NewRoomUsecase(repo, "", config.Rules{MaxPlayers: 10})
	h := NewRoomHandler(uc)
	ctx := context.Background()
	_, err := uc.Join(ctx, usecase.JoinInput{RoomID: "room-leave", PlayerID: "p1", DisplayName: "A"})
	if err != nil {
		t.Fatal(err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{
		{Key: "roomID", Value: "room-leave"},
		{Key: "playerID", Value: "p1"},
	}
	c.Request = httptest.NewRequest(http.MethodDelete, "/", nil)
	h.Leave(c)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d %s", w.Code, w.Body.String())
	}
}
