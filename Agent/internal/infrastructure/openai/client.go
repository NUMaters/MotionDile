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

type Client struct {
	apiKey  string
	model   string
	httpCli *http.Client
}

func NewClient(apiKey, model string) (*Client, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("openai: API key is required")
	}
	if model == "" {
		model = "gpt-4o-mini"
	}
	return &Client{
		apiKey:  apiKey,
		model:   model,
		httpCli: &http.Client{Timeout: 15 * time.Second},
	}, nil
}

type chatRequest struct {
	Model     string        `json:"model"`
	Messages  []chatMessage `json:"messages"`
	MaxTokens int           `json:"max_tokens"`
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

func (c *Client) Generate(ctx context.Context, input llm.PromptInput) (string, error) {
	messages := make([]chatMessage, 0, 2)
	if input.System != "" {
		messages = append(messages, chatMessage{Role: "system", Content: input.System})
	}
	messages = append(messages, chatMessage{Role: "user", Content: input.User})

	req := chatRequest{
		Model:     c.model,
		Messages:  messages,
		MaxTokens: 256,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("openai: marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.openai.com/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("openai: new request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpCli.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("openai: request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("openai: read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("openai: HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var chatResp chatResponse
	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		return "", fmt.Errorf("openai: decode: %w", err)
	}

	if chatResp.Error != nil {
		return "", fmt.Errorf("openai: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		return "", fmt.Errorf("openai: no choices returned")
	}

	text := chatResp.Choices[0].Message.Content
	if text == "" {
		return "", fmt.Errorf("openai: empty content")
	}

	return text, nil
}
