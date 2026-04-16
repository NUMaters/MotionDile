package ws

import (
	"net/http/httptest"
	"testing"

	"waniar/game-backend/internal/config"
	"waniar/game-backend/internal/infrastructure/memory"
	"waniar/game-backend/internal/usecase"
)

func TestGateway_CheckOrigin_EmptyEnvAllowsAny(t *testing.T) {
	t.Setenv("WS_ALLOWED_ORIGINS", "")
	g := NewGateway(usecase.NewRoomUsecase(memory.NewRoomRepository(), "", config.Rules{}), config.Rules{})
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Origin", "http://evil.example")
	if !g.upgrader.CheckOrigin(req) {
		t.Fatal("expected allow when env empty")
	}
}

func TestGateway_CheckOrigin_ListedOnly(t *testing.T) {
	t.Setenv("WS_ALLOWED_ORIGINS", "http://allowed.example, http://ok.example")
	g := NewGateway(usecase.NewRoomUsecase(memory.NewRoomRepository(), "", config.Rules{}), config.Rules{})

	okReq := httptest.NewRequest("GET", "/", nil)
	okReq.Header.Set("Origin", "http://ok.example")
	if !g.upgrader.CheckOrigin(okReq) {
		t.Fatal("expected allow for listed origin")
	}

	badReq := httptest.NewRequest("GET", "/", nil)
	badReq.Header.Set("Origin", "http://other.example")
	if g.upgrader.CheckOrigin(badReq) {
		t.Fatal("expected deny for non-listed origin")
	}
}
