package bedrock

import (
	"context"
	"encoding/json"
	"fmt"

	"agent/internal/llm"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
)

// Client は Amazon Bedrock の InvokeModel（Claude Messages 系）でチャット補完する。
// 低コスト向けに Claude 3 Haiku 等のモデル ID を想定。
type Client struct {
	br      *bedrockruntime.Client
	modelID string
}

func NewClient(ctx context.Context, region, modelID string) (*Client, error) {
	if region == "" || modelID == "" {
		return nil, fmt.Errorf("bedrock: region and modelID are required")
	}
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("bedrock: load aws config: %w", err)
	}
	return &Client{
		br:      bedrockruntime.NewFromConfig(cfg),
		modelID: modelID,
	}, nil
}

// claudeMessagesRequest は Anthropic Claude 3 系 on Bedrock のボディ形式。
type claudeMessagesRequest struct {
	AnthropicVersion string              `json:"anthropic_version"`
	MaxTokens        int                 `json:"max_tokens"`
	System           string              `json:"system,omitempty"`
	Messages         []claudeMessageItem `json:"messages"`
}

type claudeMessageItem struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type claudeMessagesResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
}

// Generate は llm.Client 実装。system + user を送り、生成テキストを返す。
func (c *Client) Generate(ctx context.Context, input llm.PromptInput) (string, error) {
	return c.ChatCompletion(ctx, input.System, input.User)
}

// ChatCompletion は system + user を送り、生成テキストを返す。
func (c *Client) ChatCompletion(ctx context.Context, system, user string) (string, error) {
	body := claudeMessagesRequest{
		AnthropicVersion: "bedrock-2023-05-31",
		MaxTokens:        120,
		System:           system,
		Messages: []claudeMessageItem{
			{Role: "user", Content: user},
		},
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return "", err
	}

	out, err := c.br.InvokeModel(ctx, &bedrockruntime.InvokeModelInput{
		ModelId:     aws.String(c.modelID),
		ContentType: aws.String("application/json"),
		Body:        payload,
	})
	if err != nil {
		return "", fmt.Errorf("bedrock InvokeModel: %w", err)
	}

	var resp claudeMessagesResponse
	if err := json.Unmarshal(out.Body, &resp); err != nil {
		return "", fmt.Errorf("bedrock decode response: %w", err)
	}
	for _, block := range resp.Content {
		if block.Type == "text" && block.Text != "" {
			return block.Text, nil
		}
	}
	return "", fmt.Errorf("bedrock: empty content")
}
