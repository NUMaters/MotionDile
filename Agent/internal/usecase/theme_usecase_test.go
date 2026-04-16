package usecase

import (
	"context"
	"strings"
	"testing"

	"agent/internal/domain"
	"agent/internal/llm"
)

type fakeThemeLLMClient struct {
	response string
	err      error
	lastIn   llm.PromptInput
}

func (f *fakeThemeLLMClient) Generate(_ context.Context, input llm.PromptInput) (string, error) {
	f.lastIn = input
	return f.response, f.err
}

func TestThemeUsecase_GenerateReturnsLLMThemes(t *testing.T) {
	client := &fakeThemeLLMClient{
		response: `{"allyTheme":"誰かの近くを保ちながら動こう","enemyTheme":"口の動きを少し混ぜながら動こう"}`,
	}
	uc := NewThemeUsecase(client)

	resp, err := uc.Generate(context.Background(), domain.ThemeRequest{
		RoomID:      "room-1",
		PlayerCount: 4,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.AllyTheme == "" || resp.EnemyTheme == "" {
		t.Fatal("expected both themes to be returned")
	}
	if resp.AllyTheme == resp.EnemyTheme {
		t.Fatal("expected different themes")
	}
}

func TestThemeUsecase_FallsBackWhenThemesAreInvalid(t *testing.T) {
	client := &fakeThemeLLMClient{
		response: `{"allyTheme":"外周を回ろう","enemyTheme":"外周を回ろう"}`,
	}
	uc := NewThemeUsecase(client)

	resp, err := uc.Generate(context.Background(), domain.ThemeRequest{
		RoomID:      "room-small",
		PlayerCount: 3,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.AllyTheme == "" || resp.EnemyTheme == "" {
		t.Fatal("expected fallback themes to be non-empty")
	}
	if resp.AllyTheme == resp.EnemyTheme {
		t.Fatalf("expected fallback themes to differ, got both: %q", resp.AllyTheme)
	}
}

func TestThemeUsecase_BuildsPlayerCountAwarePrompt(t *testing.T) {
	client := &fakeThemeLLMClient{
		response: `{"allyTheme":"二人以上のまとまりを意識して動こう","enemyTheme":"少し散らばる動きを意識しよう"}`,
	}
	uc := NewThemeUsecase(client)

	_, err := uc.Generate(context.Background(), domain.ThemeRequest{
		RoomID:      "room-large",
		PlayerCount: 6,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(client.lastIn.User, "多人数なので少し広い位置テーマや分散テーマも使ってよい") {
		t.Fatal("expected large-player prompt guidance to be included")
	}
	if !strings.Contains(client.lastIn.User, "市民側と敵側で必ず異なる2つのテーマ") {
		t.Fatal("expected core contract guidance to be included")
	}
}
