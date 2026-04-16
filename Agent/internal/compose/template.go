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

const informationPendingText = "情報収集中…しばらく待ってください"

var fallbackTemplates = []string{
	"%s。警戒して見てくれ",
	"%s。そこを見てほしい",
	"%s。動きをよく見てくれ",
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
		return "不審な動きあり。警戒して見てくれ", nil
	}

	tpl := selectFallbackTemplate(ev.Request.HintNumber)
	maxParts := 2
	if hintPolicy.Specificity == policy.SpecificityHigh {
		maxParts = 3
	}
	if len(parts) > maxParts {
		parts = parts[:maxParts]
	}
	text := fmt.Sprintf(tpl, strings.Join(parts, "、"))
	if repeatedRecentText(text, summary) {
		text = fmt.Sprintf("%s。別の動きにも注目してくれ", parts[0])
	}
	return text, nil
}

func selectFallbackTemplate(hintNumber int) string {
	if len(fallbackTemplates) == 0 {
		return "%s"
	}
	if hintNumber <= 0 {
		return fallbackTemplates[0]
	}
	return fallbackTemplates[(hintNumber-1)%len(fallbackTemplates)]
}

func repeatedRecentText(text string, summary ops.RecentHintSummary) bool {
	for _, recent := range summary.RecentTexts {
		if recent == text {
			return true
		}
	}
	return false
}
