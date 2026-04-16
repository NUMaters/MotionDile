package llm

import "context"

type PromptInput struct {
	System string
	User   string
}

type Client interface {
	Generate(ctx context.Context, input PromptInput) (string, error)
}
