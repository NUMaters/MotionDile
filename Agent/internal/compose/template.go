package compose

import (
	"context"
	"fmt"
	"strings"

	"agent/internal/evidence"
	"agent/internal/material"
	"agent/internal/ops"
	"agent/internal/policy"
)

const informationPendingText = "情報収集中…しばらくお待ちください"

var fallbackTemplates = []string{
	"%s。警戒せよ",
	"%s。注意されたし",
	"%s。動きを見逃すな",
}

type TemplateComposer struct{}

func NewTemplateComposer() *TemplateComposer {
	return &TemplateComposer{}
}

func (c *TemplateComposer) Compose(_ context.Context, ev evidence.HintEvidence, hintPolicy policy.HintPolicy, summary ops.RecentHintSummary) (string, error) {
	if ev.Enemy == nil || hintPolicy.Action == policy.ActionInformationPending {
		return informationPendingText, nil
	}

	selected := material.SelectMaterials(ev, hintPolicy)
	parts := orderedHintParts(ev, hintPolicy, selected)
	if len(parts) == 0 {
		return "不審な動きあり。警戒せよ", nil
	}

	tpl := fallbackTemplates[ev.Request.HintNumber%len(fallbackTemplates)]
	maxParts := 2
	if hintPolicy.Specificity == policy.SpecificityHigh {
		maxParts = 3
	}
	if hintPolicy.Signals.UseThemeMismatch {
		parts = keepPriorityPart(parts, "周囲と噛み合わない", maxParts)
	}
	if len(parts) > maxParts {
		parts = parts[:maxParts]
	}
	text := fmt.Sprintf(tpl, strings.Join(parts, "、"))
	if repeatedRecentText(text, summary) {
		text = fmt.Sprintf("%s、別の違和感にも注視せよ", parts[0])
	}
	return text, nil
}

func keepPriorityPart(parts []string, priority string, maxParts int) []string {
	filtered := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == priority {
			continue
		}
		filtered = append(filtered, part)
	}

	if maxParts <= 0 {
		return filtered
	}
	if len(filtered) >= maxParts {
		return append(filtered[:maxParts-1], priority)
	}
	return append(filtered, priority)
}

func repeatedRecentText(text string, summary ops.RecentHintSummary) bool {
	for _, recent := range summary.RecentTexts {
		if recent == text {
			return true
		}
	}
	return false
}
