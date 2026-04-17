package compose

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"agent/internal/evidence"
	"agent/internal/llm"
	"agent/internal/material"
	"agent/internal/ops"
	"agent/internal/policy"
)

const judgeSystemPrompt = `あなたはARゲーム「WaniAR」のヒント候補を最終評価する軽量Judgeです。
与えられた候補の中から、今の局面に最も適したヒントを1つだけ選んでください。

評価基準:
- その時点の具体度に合っている
- 個人特定につながらない
- 推理材料として有効
- 不必要に強すぎない
- 日本語として自然で短い

出力はJSONのみ:
{"selected_index":0,"reason":"短い理由"}`

type judgeDecision struct {
	SelectedIndex int    `json:"selected_index"`
	Reason        string `json:"reason"`
}

func (c *LLMComposer) judgeBestCandidate(ctx context.Context, ev evidence.HintEvidence, hintPolicy policy.HintPolicy, summary ops.RecentHintSummary, selected material.SelectedMaterials, candidates []hintCandidate) (hintCandidate, error) {
	if len(candidates) < 2 {
		return hintCandidate{}, fmt.Errorf("judge requires at least 2 candidates")
	}

	input := buildJudgePromptInput(ev, hintPolicy, summary, selected, candidates)
	raw, err := c.client.Generate(ctx, input)
	if err != nil {
		return hintCandidate{}, err
	}

	decision, err := parseJudgeDecision(raw)
	if err != nil {
		return hintCandidate{}, err
	}
	if decision.SelectedIndex < 0 || decision.SelectedIndex >= len(candidates) {
		return hintCandidate{}, fmt.Errorf("judge selected invalid index: %d", decision.SelectedIndex)
	}

	return candidates[decision.SelectedIndex], nil
}

func buildJudgePromptInput(ev evidence.HintEvidence, hintPolicy policy.HintPolicy, summary ops.RecentHintSummary, selected material.SelectedMaterials, candidates []hintCandidate) llm.PromptInput {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("ゲーム経過: %d秒 / 具体度: %s / 主軸: %s\n", ev.Request.ElapsedSec, formatSpecificity(hintPolicy.Specificity), formatFocus(hintPolicy.PrimaryFocus)))
	sb.WriteString(fmt.Sprintf("今回使う材料: %s\n", strings.Join(selectedMaterialLabels(selected), "、")))
	sb.WriteString("候補の中から最も適切なものを1つだけ選んでください。\n")
	sb.WriteString("同点なら、より自然で短く、推理材料として有効なものを選んでください。\n")
	sb.WriteString("禁止: 名前、色、数値距離、テーマ名の直接言及。\n")

	if len(summary.RecentTexts) > 0 {
		sb.WriteString("直近ヒント:\n")
		for _, text := range summary.RecentTexts {
			sb.WriteString("- ")
			sb.WriteString(text)
			sb.WriteString("\n")
		}
		sb.WriteString("直近と切り口が近すぎる候補は避けてください。\n")
	}

	sb.WriteString("\n候補一覧:\n")
	for i, candidate := range candidates {
		sb.WriteString(fmt.Sprintf("%d. text=%q signals=%s\n", i, candidate.Text, strings.Join(candidate.UsedSignals, ",")))
	}

	sb.WriteString("\nJSONのみを返してください。")

	return llm.PromptInput{
		System: judgeSystemPrompt,
		User:   sb.String(),
	}
}

func parseJudgeDecision(raw string) (judgeDecision, error) {
	clean := stripCodeFence(raw)
	var decision judgeDecision
	if err := json.Unmarshal([]byte(clean), &decision); err != nil {
		return judgeDecision{}, fmt.Errorf("parse judge decision: %w", err)
	}
	return decision, nil
}
