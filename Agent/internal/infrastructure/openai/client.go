package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"agent/internal/llm"
)

const apiURL = "https://api.openai.com/v1/chat/completions"

// Noop は API キー未設定時に使い、Generate が即エラーを返す。Usecase がテンプレート／ローカルフォールバックへ回す。
type Noop struct{}

func (Noop) Generate(ctx context.Context, input llm.PromptInput) (string, error) {
	return "", fmt.Errorf("openai disabled")
}

type Client struct {
	apiKey     string
	httpClient *http.Client
	model      string
}

func NewClient(apiKey string) *Client {
	return &Client{
		apiKey: apiKey,
		httpClient: &http.Client{
			Timeout: 8 * time.Second,
		},
		model: "gpt-4o-mini",
	}
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	MaxTokens   int           `json:"max_tokens"`
	Temperature float64       `json:"temperature"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// ChatCompletion は system + user メッセージを送り、アシスタントの返答を返す。
func (c *Client) Generate(ctx context.Context, input llm.PromptInput) (string, error) {
	body := chatRequest{
		Model: c.model,
		Messages: []chatMessage{
			{Role: "system", Content: input.System},
			{Role: "user", Content: input.User},
		},
		MaxTokens:   120,
		Temperature: 0.8,
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("http do: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read body: %w", err)
	}

	var result chatResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("unmarshal: %w", err)
	}

	if result.Error != nil {
		return "", fmt.Errorf("openai error: %s", result.Error.Message)
	}

	if len(result.Choices) == 0 {
		return "", fmt.Errorf("no choices returned")
	}

	return result.Choices[0].Message.Content, nil
}

// ChatCompletion は旧呼び出し経路との互換用。
func (c *Client) ChatCompletion(ctx context.Context, system, user string) (string, error) {
	return c.Generate(ctx, llm.PromptInput{System: system, User: user})
}
