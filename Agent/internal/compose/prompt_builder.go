package compose

import (
	"fmt"
	"strings"

	"agent/internal/evidence"
	"agent/internal/llm"
	"agent/internal/material"
	"agent/internal/ops"
	"agent/internal/policy"
)

const systemPrompt = `あなたはARゲーム「WaniAR」の監視AIエージェントです。
プレイヤーたちの中に紛れた「敵ワニ」の手がかりとなるヒントを市民プレイヤーに提供します。

## ゲームの仕組み
- 市民チームと敵ワニにはそれぞれ異なる「行動ミッション（テーマ）」が割り当てられている
- 市民はミッションどおりに行動し、自分と違う動きをしているプレイヤーを見つけ出す
- 敵ワニは自分のミッションに従って行動するが、市民チームのミッションとは異なる行動になる

## マップ情報
- 円形のフィールド（島）で、外周にはバリアウォール（青い光る壁）がある
- マップ内には岩場（stone）がいくつかあり、岩の上に登ることも可能。岩陰に隠れるプレイヤーもいる
- マップ内には木（tree）が複数あり、木の陰に隠れることもできる
- 地面は草地と砂地。マップ中央付近は開けている
- マップの端に行くほど境界の壁が近い

## ルール
- 敵プレイヤーの名前や色を直接言ってはいけない
- テーマ名を直接言わない。テーマの内容を示唆するようなヒントにする
- 位置（方角・エリア）、行動（走る・歩く・ジャンプ・じっとしている）、周囲の特徴（岩の近く・壁際・中央の広場）を組み合わせてヒントにする
- 敵の行動が「市民テーマと違う」ことをほのめかす表現を使う
- ヒントは1〜2文、日本語50文字以内で簡潔に
- 15秒付近のヒントはかなり曖昧に、30秒付近ではやや具体的に、45秒以降はかなり具体的にする
- 口調は短く緊迫感のある日本語でよいが、出力はヒント本文だけとする
- 禁止: 「監視AI通報」「通報:」などのラベル、絵文字、個人特定に繋がる記述
- 毎回異なる表現を使い、同じパターンの繰り返しを避ける
- 「影」「気配」「違和感」などの抽象語だけで済ませず、観測できる行動や位置をそのまま短く言う
- 比喩やポエム調は避け、誰でも同じ意味に取れる明快な日本語にする`

func buildPromptInput(ev evidence.HintEvidence, hintPolicy policy.HintPolicy, summary ops.RecentHintSummary) llm.PromptInput {
	selected := material.SelectMaterials(ev, hintPolicy)
	directives := buildCandidateDirectives(selected, hintPolicy)
	return buildPromptInputWith(ev, hintPolicy, summary, selected, directives)
}

func buildPromptInputWith(ev evidence.HintEvidence, hintPolicy policy.HintPolicy, summary ops.RecentHintSummary, selected material.SelectedMaterials, directives []candidateDirective) llm.PromptInput {
	if ev.Enemy == nil {
		return llm.PromptInput{
			System: systemPrompt,
			User:   "敵の情報がありません。「情報収集中…」と答えてください。",
		}
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("ヒント番号: %d（%d番目のヒント） / ゲーム経過: %d秒 / ゲーム時間: %d秒\n",
		ev.Request.HintNumber, ev.Request.HintNumber, ev.Request.ElapsedSec, ev.Request.GameDuration))
	sb.WriteString(fmt.Sprintf("→ 具体度: %s / 主軸: %s\n", formatSpecificity(hintPolicy.Specificity), formatFocus(hintPolicy.PrimaryFocus)))
	sb.WriteString("→ 具体度ルール: 15秒付近=小ヒント、30秒付近=中ヒント、45秒以降=強ヒント\n")
	sb.WriteString(fmt.Sprintf("→ 使ってよい情報: %s\n", strings.Join(allowedSignalLabels(hintPolicy), "、")))
	sb.WriteString(fmt.Sprintf("→ 今回使う材料: %s\n", strings.Join(selectedMaterialLabels(selected), "、")))
	sb.WriteString(fmt.Sprintf("→ 今回使える signal 名: %s\n", strings.Join(selectedSignalNames(selected, hintPolicy), ", ")))
	sb.WriteString(fmt.Sprintf("→ 手がかり数の上限: %d\n", hintPolicy.MaxClues))
	sb.WriteString("→ 禁止: 名前、色、数値距離、個人特定につながる表現\n\n")
	sb.WriteString("→ 書き方: 抽象語だけにせず、観測できる行動・位置・関係をそのまま短く言う\n\n")

	if len(summary.RecentTexts) > 0 {
		sb.WriteString("【直近ヒント履歴】\n")
		for _, text := range summary.RecentTexts {
			sb.WriteString("- ")
			sb.WriteString(text)
			sb.WriteString("\n")
		}
		sb.WriteString("- 直近と同じ表現や同じ切り口の繰り返しは避けてください\n\n")
	}

	if ev.Request.AllyTheme != "" || ev.Request.EnemyTheme != "" {
		sb.WriteString("【行動ミッション（テーマ）】\n")
		if ev.Request.AllyTheme != "" {
			sb.WriteString(fmt.Sprintf("- 市民チームのテーマ: 「%s」\n", ev.Request.AllyTheme))
		}
		if ev.Request.EnemyTheme != "" {
			sb.WriteString(fmt.Sprintf("- 敵ワニのテーマ: 「%s」\n", ev.Request.EnemyTheme))
		}
		sb.WriteString("- テーマ名はヒント本文に出さず、敵の行動が市民と噛み合っていないことを示唆してください\n\n")
	}

	sb.WriteString("【敵ワニの観測事実】\n")
	for _, line := range describeEnemyForPrompt(ev, hintPolicy, selected) {
		sb.WriteString("- ")
		sb.WriteString(line)
		sb.WriteString("\n")
	}

	sb.WriteString("\n【良い例】\n")
	sb.WriteString("- 口を開けたまま外周寄りで止まりがちだ\n")
	sb.WriteString("- 壁際で誰かから少し離れて動いている\n")
	sb.WriteString("- 中央付近で向きを変えずに静止しがちだ\n")
	sb.WriteString("【悪い例】\n")
	sb.WriteString("- 怪しい影がある\n")
	sb.WriteString("- 不穏な気配が漂う\n")
	sb.WriteString("- 違和感のある何かがいる\n")

	sb.WriteString("\n【候補ごとの役割】\n")
	for _, directive := range directives {
		sb.WriteString("- ")
		sb.WriteString(directive.Instruction)
		sb.WriteString("\n")
	}

	sb.WriteString("\n【出力形式】\n")
	sb.WriteString("JSONのみを返してください。Markdownのコードフェンスや説明文は不要です。\n")
	sb.WriteString(fmt.Sprintf("candidates は %d 件にしてください。\n", hintPolicy.CandidateCount))
	sb.WriteString("各 candidate は次の形です:\n")
	sb.WriteString(`{"text":"ヒント本文","used_signals":["motion","zone"]}` + "\n")
	sb.WriteString("text は 1〜2文、50文字以内、前置きなし、1行のみ。\n")
	sb.WriteString("text には少なくとも1つ、できれば2つの具体的な手がかり（行動/位置/関係）を入れてください。\n")
	sb.WriteString("used_signals は今回使える signal 名だけを 1 個以上入れ、手がかり数の上限を超えないでください。\n")
	sb.WriteString("候補同士は役割に従って主役の切り口を変えてください。3候補が同じ型にならないようにしてください。\n")
	sb.WriteString("主軸に沿って組み立て、使ってよい情報だけを採用してください。")

	return llm.PromptInput{
		System: systemPrompt,
		User:   sb.String(),
	}
}

func buildRepairPromptInput(base llm.PromptInput, raw string, issues []string) llm.PromptInput {
	var sb strings.Builder
	sb.WriteString(base.User)
	sb.WriteString("\n\n【前回出力】\n")
	sb.WriteString(raw)
	sb.WriteString("\n\n【修正指示】\n")
	sb.WriteString("前回出力はそのままでは使えません。次の問題を直して、同じ JSON 形式だけを再出力してください。\n")
	for _, issue := range issues {
		sb.WriteString("- ")
		sb.WriteString(issue)
		sb.WriteString("\n")
	}
	sb.WriteString("必ず JSON 本文のみを返してください。")

	return llm.PromptInput{
		System: base.System,
		User:   sb.String(),
	}
}
