package compose

import (
	"context"

	"agent/internal/evidence"
	"agent/internal/llm"
	"agent/internal/policy"
)

type LLMComposer struct {
	client llm.Client
}

func NewLLMComposer(client llm.Client) *LLMComposer {
	return &LLMComposer{client: client}
}

func (c *LLMComposer) Compose(ctx context.Context, ev evidence.HintEvidence, hintPolicy policy.HintPolicy) (string, error) {
	input := buildPromptInput(ev, hintPolicy)
	return c.client.Generate(ctx, input)
}
