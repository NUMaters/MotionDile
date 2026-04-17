package compose

import (
	"context"
	"fmt"

	"agent/internal/evidence"
	"agent/internal/llm"
	"agent/internal/material"
	"agent/internal/ops"
	"agent/internal/policy"
)

type LLMComposer struct {
	client llm.Client
}

func NewLLMComposer(client llm.Client) *LLMComposer {
	return &LLMComposer{client: client}
}

func (c *LLMComposer) Compose(ctx context.Context, ev evidence.HintEvidence, hintPolicy policy.HintPolicy, summary ops.RecentHintSummary) (string, error) {
	selected := material.SelectMaterials(ev, hintPolicy)
	directives := buildCandidateDirectives(selected, hintPolicy)
	input := buildPromptInput(ev, hintPolicy, summary)

	text, issues, err := c.composeBestCandidate(ctx, input, ev, hintPolicy, summary, selected, directives)
	if err == nil {
		return text, nil
	}
	if !hintPolicy.RetryEnabled {
		return "", err
	}

	retryInput := buildRepairPromptInput(input, issues.raw, issues.list)
	text, _, retryErr := c.composeBestCandidate(ctx, retryInput, ev, hintPolicy, summary, selected, directives)
	if retryErr != nil {
		return "", fmt.Errorf("candidate generation failed: %w", retryErr)
	}
	return text, nil
}

type candidateFailure struct {
	raw  string
	list []string
}

func (c *LLMComposer) composeBestCandidate(ctx context.Context, input llm.PromptInput, ev evidence.HintEvidence, hintPolicy policy.HintPolicy, summary ops.RecentHintSummary, selected material.SelectedMaterials, directives []candidateDirective) (string, candidateFailure, error) {
	raw, err := c.client.Generate(ctx, input)
	if err != nil {
		return "", candidateFailure{}, err
	}

	candidates, err := parseCandidateResponse(raw)
	if err != nil {
		return "", candidateFailure{raw: raw, list: []string{err.Error()}}, err
	}

	scored := scoreCandidates(candidates, ev, hintPolicy, summary, selected, directives)
	best, err := bestValidCandidate(scored)
	if err != nil {
		return "", candidateFailure{raw: raw, list: summarizeCandidateIssues(scored)}, err
	}

	top := topValidCandidates(scored, 2)
	if len(top) >= 2 {
		judged, judgeErr := c.judgeBestCandidate(ctx, ev, hintPolicy, summary, selected, top)
		if judgeErr == nil {
			return judged.Text, candidateFailure{}, nil
		}
	}

	return best.Text, candidateFailure{}, nil
}
