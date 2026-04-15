package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHintHandler_RejectsUnknownFields(t *testing.T) {
	handler := NewHintHandler(nil)

	req := httptest.NewRequest(http.MethodPost, "/hint", strings.NewReader(`{
		"roomId":"room-1",
		"hintNumber":1,
		"gameDuration":30,
		"elapsedSec":10,
		"mapRadius":1.3,
		"players":[{"playerId":"p1","x":0,"y":0,"z":0,"rotationY":0,"animation":"Idle","mouthOpenness":0.1,"isEnemy":true}],
		"unexpected":"value"
	}`))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rec.Code)
	}
}
