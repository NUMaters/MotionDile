package usecase

import (
	"fmt"
	"strings"

	"agent/internal/evidence"
)

const systemPrompt = `あなたはARゲーム「WaniAR」の監視AIエージェントです。
プレイヤーたちの中に紛れた「敵ワニ」の手がかりとなるヒントを市民プレイヤーに提供します。

## マップ情報
- 円形のフィールド（島）で、外周にはバリアウォール（青い光る壁）がある
- マップ内には岩場（stone）がいくつかあり、岩の上に登ることも可能。岩陰に隠れるプレイヤーもいる
- マップ内には木（tree）が複数あり、木の陰に隠れることもできる
- 地面は草地と砂地。マップ中央付近は開けている
- マップの端に行くほど境界の壁が近い

## ルール
- 敵プレイヤーの名前や色を直接言ってはいけない
- 位置（方角・エリア）、行動（走る・歩く・ジャンプ・じっとしている）、周囲の特徴（岩の近く・壁際・中央の広場）を組み合わせてヒントにする
- ヒントは1〜2文、日本語50文字以内で簡潔に
- ゲーム序盤（hint1）はかなり曖昧に、中盤（hint2）でやや具体的に、終盤（hint3）はかなり具体的にする
- 口調は短く緊迫感のある日本語（監視カメラの独白のようなニュアンス）でよいが、**出力はヒント本文だけ**とする
- **禁止**: 冒頭の「監視AI通報:」「監視AI通報」「通報:」「【監視AI】」などの**ラベル・肩書・コロン付き見出し**は一切付けない（クライアントがそのまま表示するため）
- 絵文字は使わない
- 毎回異なる表現を使い、同じパターンの繰り返しを避ける

## ヒントに使える情報の例
- 方角（北東エリア、南西の端 etc）
- 行動（走り回っている、じっと立ち止まっている、ジャンプしている、歩き回っている）
- 口の状態（口を開けている=威嚇的）
- 場所の特徴（岩の近く・岩陰、木の近く・木の陰、壁際、マップ中央、開けた場所）
- 他プレイヤーとの距離感（孤立している、群れから離れている、誰かの近くにいる）
- 移動方向（北に向かっている、境界に向かって走っている）`

func buildUserPrompt(ev evidence.HintEvidence) string {
	if ev.Enemy == nil {
		return "敵の情報がありません。「情報収集中…」と答えてください。"
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("ヒント番号: %d（%d番目のヒント） / ゲーム経過: %d秒 / ゲーム時間: %d秒\n",
		ev.Request.HintNumber, ev.Request.HintNumber, ev.Request.ElapsedSec, ev.Request.GameDuration))

	if ev.Request.HintNumber <= 1 {
		sb.WriteString("→ 序盤なので「曖昧」なヒントにしてください\n\n")
	} else if ev.Request.HintNumber == 2 {
		sb.WriteString("→ 中盤なので「やや具体的」なヒントにしてください\n\n")
	} else {
		sb.WriteString("→ 終盤なので「かなり具体的」なヒントにしてください\n\n")
	}

	sb.WriteString("【敵ワニの状態】\n")
	sb.WriteString(formatPlayerFull(*ev.Enemy))
	sb.WriteString("\n")

	if len(ev.Citizens) > 0 {
		sb.WriteString("【市民プレイヤーの状態】\n")
		for i := range ev.Citizens {
			sb.WriteString(fmt.Sprintf("- %s: %s\n",
				ev.Citizens[i].Source.DisplayName,
				formatBrief(ev.Citizens[i]),
			))
		}
		sb.WriteString("\n")
	}

	if ev.NearestCitizen != nil {
		sb.WriteString(fmt.Sprintf("敵に最も近い市民: %s（距離 %.2f）\n",
			ev.NearestCitizen.Player.Source.DisplayName,
			ev.NearestCitizen.Distance,
		))
	}

	if ev.EnemyIsIsolated {
		sb.WriteString("※敵ワニは他のプレイヤーから孤立しています\n")
	}

	sb.WriteString("\n1〜2文のヒントを1つだけ生成してください。敵の名前や色は出さないでください。")
	sb.WriteString(" 前置き・役割名・見出しは付けず、本文のみ1行で出力してください。")
	return sb.String()
}

func formatPlayerFull(player evidence.PlayerEvidence) string {
	lines := fmt.Sprintf(
		"  位置: %s\n  行動: %s\n  向き: %s\n  場所の特徴: %s\n",
		formatZone(player.Zone),
		formatMotion(player.Motion),
		formatFacing(player.Facing),
		formatLocation(player.Environment, player.Motion),
	)

	if player.Motion.IsAirborneByAnimTag {
		lines += "  ※ジャンプ中（空中にいる可能性）\n"
	}
	if player.MouthOpen {
		lines += "  ※口を開けている（威嚇的な状態）\n"
	}

	return lines
}

func formatBrief(player evidence.PlayerEvidence) string {
	extras := ""
	if player.Motion.IsAirborneByAnimTag {
		extras += " [ジャンプ]"
	}
	if player.MouthOpen {
		extras += " [口開]"
	}
	near := formatNearbyLandmark(player.Environment.NearbyLandmark)
	if near != "" {
		extras += " [" + near + "]"
	}
	return fmt.Sprintf("%s で %s%s", formatZone(player.Zone), formatMotion(player.Motion), extras)
}

func formatLocation(environment evidence.EnvironmentEvidence, motion evidence.MotionEvidence) string {
	parts := []string{}
	if environment.NearWall {
		parts = append(parts, "境界の壁付近")
	}
	if environment.NearCenter {
		parts = append(parts, "マップ中央の開けた場所")
	}
	if motion.IsAirborneByAnimTag {
		parts = append(parts, "空中（ジャンプ中の可能性）")
	}
	near := formatNearbyLandmark(environment.NearbyLandmark)
	if near != "" {
		parts = append(parts, near)
	}
	if len(parts) == 0 {
		return "通常の地面付近"
	}
	return strings.Join(parts, "、")
}

func formatZone(zone evidence.ZoneEvidence) string {
	proximity := formatProximity(zone.Proximity)
	direction := formatZoneDirection(zone)
	if direction == "" {
		return proximity + "エリア"
	}
	return proximity + "の" + direction + "寄り"
}

func formatProximity(proximity evidence.ProximityKind) string {
	switch proximity {
	case evidence.ProximityCenter:
		return "中央"
	case evidence.ProximityMiddle:
		return "中間"
	case evidence.ProximityOuter:
		return "外周"
	default:
		return "不明"
	}
}

func formatZoneDirection(zone evidence.ZoneEvidence) string {
	ns := ""
	switch zone.NorthSouth {
	case evidence.VerticalBiasNorth:
		ns = "北"
	case evidence.VerticalBiasSouth:
		ns = "南"
	}

	ew := ""
	switch zone.EastWest {
	case evidence.HorizontalBiasEast:
		ew = "東"
	case evidence.HorizontalBiasWest:
		ew = "西"
	}

	return ns + ew
}

func formatMotion(motion evidence.MotionEvidence) string {
	switch motion.Kind {
	case evidence.MotionRun:
		if motion.UsesMouthAnimation {
			return "口を開けて走行中"
		}
		return "走行中"
	case evidence.MotionWalk:
		if motion.UsesMouthAnimation {
			return "口を開けて歩行中"
		}
		return "歩行中"
	case evidence.MotionAttack:
		return "攻撃動作中"
	case evidence.MotionTailWag:
		return "尻尾を振っている"
	case evidence.MotionIdle:
		if motion.UsesMouthAnimation {
			return "口を開けて静止中"
		}
		return "静止中"
	default:
		return "不明な行動"
	}
}

func formatFacing(facing evidence.FacingDirection) string {
	switch facing {
	case evidence.FacingNorth:
		return "北向き"
	case evidence.FacingNorthEast:
		return "北東向き"
	case evidence.FacingEast:
		return "東向き"
	case evidence.FacingSouthEast:
		return "南東向き"
	case evidence.FacingSouth:
		return "南向き"
	case evidence.FacingSouthWest:
		return "南西向き"
	case evidence.FacingWest:
		return "西向き"
	case evidence.FacingNorthWest:
		return "北西向き"
	default:
		return "不明な向き"
	}
}

func formatNearbyLandmark(landmark evidence.LandmarkEvidence) string {
	if !landmark.Found {
		return ""
	}
	switch landmark.Kind {
	case evidence.LandmarkRock:
		return "岩の近く"
	case evidence.LandmarkTree:
		return "木の近く"
	default:
		return ""
	}
}
