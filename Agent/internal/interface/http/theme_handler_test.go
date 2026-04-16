package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestThemeHandler_RejectsUnknownFields(t *testing.T) {
	handler := NewThemeHandler(nil)

	req := httptest.NewRequest(http.MethodPost, "/themes", strings.NewReader(`{
		"roomId":"room-1",
		"playerCount":4,
		"unexpected":"value"
	}`))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rec.Code)
	}
}
