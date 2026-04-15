package usecase

import (
	"fmt"
	"strings"

	"agent/internal/evidence"
	"agent/internal/policy"
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

func buildUserPrompt(ev evidence.HintEvidence, hintPolicy policy.HintPolicy) string {
	if ev.Enemy == nil {
		return "敵の情報がありません。「情報収集中…」と答えてください。"
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("ヒント番号: %d（%d番目のヒント） / ゲーム経過: %d秒 / ゲーム時間: %d秒\n",
		ev.Request.HintNumber, ev.Request.HintNumber, ev.Request.ElapsedSec, ev.Request.GameDuration))
	sb.WriteString(fmt.Sprintf("→ 具体度: %s / 主軸: %s\n", formatSpecificity(hintPolicy.Specificity), formatFocus(hintPolicy.PrimaryFocus)))
	sb.WriteString(fmt.Sprintf("→ 使ってよい情報: %s\n", strings.Join(allowedSignalLabels(hintPolicy), "、")))
	sb.WriteString("→ 禁止: 名前、色、数値距離、個人特定につながる表現\n\n")

	sb.WriteString("【敵ワニの観測事実】\n")
	for _, line := range describeEnemyForPrompt(ev, hintPolicy) {
		sb.WriteString("- ")
		sb.WriteString(line)
		sb.WriteString("\n")
	}

	sb.WriteString("\n1〜2文のヒントを1つだけ生成してください。")
	sb.WriteString(" 主軸に沿って組み立て、使ってよい情報だけを採用してください。")
	sb.WriteString(" 前置き・役割名・見出しは付けず、本文のみ1行で出力してください。")
	return sb.String()
}

func describeEnemyForPrompt(ev evidence.HintEvidence, hintPolicy policy.HintPolicy) []string {
	lines := []string{}
	if ev.Enemy == nil {
		return lines
	}

	enemy := *ev.Enemy
	if hintPolicy.Signals.UseMotion {
		lines = append(lines, "行動: "+formatMotion(enemy.Motion, hintPolicy.Signals.UseMouth))
	}
	if hintPolicy.Signals.UseAirborne && enemy.Motion.IsAirborneByAnimTag {
		lines = append(lines, "補助特徴: ジャンプしている様子")
	}
	if hintPolicy.Signals.UseZone {
		lines = append(lines, "位置: "+formatZone(enemy.Zone, hintPolicy.Specificity))
	}

	environmentParts := []string{}
	if hintPolicy.Signals.UseNearWall && enemy.Environment.NearWall {
		environmentParts = append(environmentParts, "境界の壁際")
	}
	if hintPolicy.Signals.UseLandmark {
		near := formatNearbyLandmark(enemy.Environment.NearbyLandmark)
		if near != "" {
			environmentParts = append(environmentParts, near)
		}
	}
	if len(environmentParts) > 0 {
		lines = append(lines, "周辺: "+strings.Join(environmentParts, "、"))
	}

	if hintPolicy.Signals.UseFacing {
		lines = append(lines, "向き: "+formatFacing(enemy.Facing))
	}
	if hintPolicy.Signals.UseRelation {
		relation := formatRelation(ev)
		if relation != "" {
			lines = append(lines, "関係性: "+relation)
		}
	}

	return lines
}

func orderedHintParts(ev evidence.HintEvidence, hintPolicy policy.HintPolicy) []string {
	if ev.Enemy == nil {
		return nil
	}

	movement := ""
	if hintPolicy.Signals.UseMotion {
		movement = formatMotion(ev.Enemy.Motion, hintPolicy.Signals.UseMouth)
	}
	if hintPolicy.Signals.UseAirborne && ev.Enemy.Motion.IsAirborneByAnimTag {
		if movement != "" {
			movement += "、ジャンプ気味"
		} else {
			movement = "ジャンプ気味"
		}
	}

	locationParts := []string{}
	if hintPolicy.Signals.UseZone {
		locationParts = append(locationParts, formatZone(ev.Enemy.Zone, hintPolicy.Specificity))
	}
	if hintPolicy.Signals.UseNearWall && ev.Enemy.Environment.NearWall {
		locationParts = append(locationParts, "壁際")
	}
	if hintPolicy.Signals.UseLandmark {
		if near := formatNearbyLandmark(ev.Enemy.Environment.NearbyLandmark); near != "" {
			locationParts = append(locationParts, near)
		}
	}
	location := strings.Join(locationParts, "の")

	relation := ""
	if hintPolicy.Signals.UseRelation {
		relation = formatRelation(ev)
	}

	facing := ""
	if hintPolicy.Signals.UseFacing {
		facing = formatFacing(ev.Enemy.Facing)
	}

	switch hintPolicy.PrimaryFocus {
	case policy.FocusLocation:
		return compactHintParts(location, movement, relation, facing)
	case policy.FocusRelation:
		return compactHintParts(relation, movement, location, facing)
	default:
		return compactHintParts(movement, location, relation, facing)
	}
}

func compactHintParts(parts ...string) []string {
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if strings.TrimSpace(part) == "" {
			continue
		}
		result = append(result, part)
	}
	return result
}

func formatZone(zone evidence.ZoneEvidence, specificity policy.HintSpecificity) string {
	proximity := formatProximity(zone.Proximity)
	if specificity == policy.SpecificityLow {
		return proximity + "付近"
	}

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

func formatMotion(motion evidence.MotionEvidence, useMouth bool) string {
	switch motion.Kind {
	case evidence.MotionRun:
		if useMouth && motion.UsesMouthAnimation {
			return "口を開けて走行中"
		}
		return "走行中"
	case evidence.MotionWalk:
		if useMouth && motion.UsesMouthAnimation {
			return "口を開けて歩行中"
		}
		return "歩行中"
	case evidence.MotionAttack:
		return "攻撃動作中"
	case evidence.MotionTailWag:
		return "尻尾を振っている"
	case evidence.MotionIdle:
		if useMouth && motion.UsesMouthAnimation {
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

func formatRelation(ev evidence.HintEvidence) string {
	if ev.EnemyIsIsolated {
		return "他プレイヤーから少し孤立している"
	}
	if ev.NearestCitizen == nil {
		return ""
	}
	switch {
	case ev.NearestCitizen.Distance < 0.25:
		return "誰かのすぐ近くにいる"
	case ev.NearestCitizen.Distance < 0.4:
		return "誰かの近くにいる"
	default:
		return ""
	}
}

func formatSpecificity(specificity policy.HintSpecificity) string {
	switch specificity {
	case policy.SpecificityLow:
		return "低い（曖昧）"
	case policy.SpecificityMedium:
		return "中くらい"
	case policy.SpecificityHigh:
		return "高い（ただし特定禁止）"
	default:
		return "不明"
	}
}

func formatFocus(focus policy.HintFocus) string {
	switch focus {
	case policy.FocusMovement:
		return "行動"
	case policy.FocusLocation:
		return "位置"
	case policy.FocusRelation:
		return "関係性"
	default:
		return "不明"
	}
}

func allowedSignalLabels(hintPolicy policy.HintPolicy) []string {
	labels := []string{}
	if hintPolicy.Signals.UseMotion {
		labels = append(labels, "行動")
	}
	if hintPolicy.Signals.UseMouth {
		labels = append(labels, "口の開き")
	}
	if hintPolicy.Signals.UseAirborne {
		labels = append(labels, "ジャンプ")
	}
	if hintPolicy.Signals.UseZone {
		if hintPolicy.Specificity == policy.SpecificityLow {
			labels = append(labels, "粗い位置")
		} else {
			labels = append(labels, "位置")
		}
	}
	if hintPolicy.Signals.UseNearWall {
		labels = append(labels, "壁際")
	}
	if hintPolicy.Signals.UseLandmark {
		labels = append(labels, "ランドマーク近接")
	}
	if hintPolicy.Signals.UseFacing {
		labels = append(labels, "向き")
	}
	if hintPolicy.Signals.UseRelation {
		labels = append(labels, "関係性")
	}
	return labels
}
