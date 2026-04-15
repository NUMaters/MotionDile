package compose

import (
	"fmt"
	"strings"

	"agent/internal/evidence"
	"agent/internal/llm"
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
- 毎回異なる表現を使い、同じパターンの繰り返しを避ける`

func buildPromptInput(ev evidence.HintEvidence, hintPolicy policy.HintPolicy) llm.PromptInput {
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
	sb.WriteString("→ 禁止: 名前、色、数値距離、個人特定につながる表現\n\n")

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
	for _, line := range describeEnemyForPrompt(ev, hintPolicy) {
		sb.WriteString("- ")
		sb.WriteString(line)
		sb.WriteString("\n")
	}

	sb.WriteString("\n1〜2文のヒントを1つだけ生成してください。")
	sb.WriteString(" 主軸に沿って組み立て、使ってよい情報だけを採用してください。")
	sb.WriteString(" 前置き・役割名・見出しは付けず、本文のみ1行で出力してください。")

	return llm.PromptInput{
		System: systemPrompt,
		User:   sb.String(),
	}
}
