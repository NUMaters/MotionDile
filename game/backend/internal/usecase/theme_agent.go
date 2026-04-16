package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type agentThemeRequest struct {
	RoomID      string `json:"roomId"`
	PlayerCount int    `json:"playerCount"`
}

type agentThemeResponse struct {
	AllyTheme  string `json:"allyTheme"`
	EnemyTheme string `json:"enemyTheme"`
}

func (u *RoomUsecase) GenerateThemes(ctx context.Context, roomID string, playerCount int) (allyTheme, enemyTheme string, err error) {
	reqBody := agentThemeRequest{
		RoomID:      roomID,
		PlayerCount: playerCount,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", "", fmt.Errorf("marshal: %w", err)
	}

	url := strings.TrimRight(u.agentURL, "/") + "/themes"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", "", fmt.Errorf("new request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := u.hc.Do(httpReq)
	if err != nil {
		return "", "", fmt.Errorf("do: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", fmt.Errorf("read: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("status %d: %s", resp.StatusCode, string(respBody))
	}

	var result agentThemeResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", "", fmt.Errorf("unmarshal: %w", err)
	}

	if strings.TrimSpace(result.AllyTheme) == "" || strings.TrimSpace(result.EnemyTheme) == "" {
		return "", "", fmt.Errorf("theme response is empty")
	}

	return strings.TrimSpace(result.AllyTheme), strings.TrimSpace(result.EnemyTheme), nil
}
