package contract

import (
	"strings"

	"agent/internal/domain"
)

// ValidateThemeRequest は /themes の入力契約を検証します。
func ValidateThemeRequest(req domain.ThemeRequest) error {
	validationErr := &ValidationError{}

	if strings.TrimSpace(req.RoomID) == "" {
		validationErr.Add("roomId", "空にできません")
	}
	if req.PlayerCount < 2 {
		validationErr.Add("playerCount", "2以上である必要があります")
	}

	if !validationErr.HasIssues() {
		return nil
	}
	return validationErr
}
