package contract

import (
	"testing"

	"agent/internal/domain"
)

func TestValidateThemeRequest_AllowsValidRequest(t *testing.T) {
	req := domain.ThemeRequest{
		RoomID:      "room-1",
		PlayerCount: 4,
	}

	if err := ValidateThemeRequest(req); err != nil {
		t.Fatalf("expected request to be valid, got error: %v", err)
	}
}

func TestValidateThemeRequest_ReturnsIssues(t *testing.T) {
	req := domain.ThemeRequest{
		RoomID:      "   ",
		PlayerCount: 1,
	}

	err := ValidateThemeRequest(req)
	if err == nil {
		t.Fatal("expected validation error, got nil")
	}

	validationErr, ok := err.(*ValidationError)
	if !ok {
		t.Fatalf("expected ValidationError, got %T", err)
	}

	if len(validationErr.Issues) != 2 {
		t.Fatalf("expected 2 validation issues, got %d", len(validationErr.Issues))
	}
}
