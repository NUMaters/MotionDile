package usecase

import (
	"fmt"
	"math"
	"strings"

	"agent/internal/domain"
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

func buildUserPrompt(req domain.HintRequest) string {
	var enemy *domain.PlayerInfo
	citizens := make([]domain.PlayerInfo, 0, len(req.Players))
	for i := range req.Players {
		if req.Players[i].IsEnemy {
			enemy = &req.Players[i]
		} else {
			citizens = append(citizens, req.Players[i])
		}
	}
	if enemy == nil {
		return "敵の情報がありません。「情報収集中…」と答えてください。"
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("ヒント番号: %d（%d番目のヒント） / ゲーム経過: %d秒 / ゲーム時間: %d秒\n",
		req.HintNumber, req.HintNumber, req.ElapsedSec, req.GameDuration))

	if req.HintNumber <= 1 {
		sb.WriteString("→ 序盤なので「曖昧」なヒントにしてください\n\n")
	} else if req.HintNumber == 2 {
		sb.WriteString("→ 中盤なので「やや具体的」なヒントにしてください\n\n")
	} else {
		sb.WriteString("→ 終盤なので「かなり具体的」なヒントにしてください\n\n")
	}

	sb.WriteString("【敵ワニの状態】\n")
	sb.WriteString(formatPlayerFull(enemy, req.MapRadius, req.Landmarks))
	sb.WriteString("\n")

	if len(citizens) > 0 {
		sb.WriteString("【市民プレイヤーの状態】\n")
		for i := range citizens {
			sb.WriteString(fmt.Sprintf("- %s: %s\n",
				citizens[i].DisplayName,
				formatBrief(&citizens[i], req.MapRadius, req.Landmarks),
			))
		}
		sb.WriteString("\n")
	}

	nearest := findNearestCitizen(enemy, citizens)
	if nearest != nil {
		dist := distance(enemy, nearest)
		sb.WriteString(fmt.Sprintf("敵に最も近い市民: %s（距離 %.2f）\n", nearest.DisplayName, dist))
	}

	isolated := isIsolated(enemy, citizens)
	if isolated {
		sb.WriteString("※敵ワニは他のプレイヤーから孤立しています\n")
	}

	sb.WriteString("\n1〜2文のヒントを1つだけ生成してください。敵の名前や色は出さないでください。")
	sb.WriteString(" 前置き・役割名・見出しは付けず、本文のみ1行で出力してください。")
	return sb.String()
}

func formatPlayerFull(p *domain.PlayerInfo, mapRadius float64, landmarks []domain.LandmarkInfo) string {
	zone := positionToZone(p.X, p.Z, mapRadius)
	movement := animationToLabel(p.Animation)
	location := locationContext(p.X, p.Z, mapRadius, p.Animation, landmarks)
	facing := facingDirection(p.RotationY)

	lines := fmt.Sprintf(
		"  位置: %s\n  行動: %s\n  向き: %s\n  場所の特徴: %s\n",
		zone, movement, facing, location,
	)

	if animationSuggestsAirborne(p.Animation) {
		lines += "  ※ジャンプ中（空中にいる可能性）\n"
	}
	if p.MouthOpenness > 0.4 {
		lines += "  ※口を開けている（威嚇的な状態）\n"
	}

	return lines
}

func formatBrief(p *domain.PlayerInfo, mapRadius float64, landmarks []domain.LandmarkInfo) string {
	zone := positionToZone(p.X, p.Z, mapRadius)
	movement := animationToLabel(p.Animation)
	extras := ""
	if animationSuggestsAirborne(p.Animation) {
		extras += " [ジャンプ]"
	}
	if p.MouthOpenness > 0.4 {
		extras += " [口開]"
	}
	near := nearestLandmark(p.X, p.Z, landmarks, 0.35)
	if near != "" {
		extras += " [" + near + "]"
	}
	return fmt.Sprintf("%s で %s%s", zone, movement, extras)
}

func positionToZone(x, z, mapRadius float64) string {
	distFromCenter := math.Sqrt(x*x + z*z)
	var proximity string
	if mapRadius > 0 {
		ratio := distFromCenter / mapRadius
		if ratio < 0.33 {
			proximity = "中央"
		} else if ratio < 0.66 {
			proximity = "中間"
		} else {
			proximity = "外周"
		}
	} else {
		if distFromCenter < 0.4 {
			proximity = "中央"
		} else if distFromCenter < 0.8 {
			proximity = "中間"
		} else {
			proximity = "外周"
		}
	}

	ns, ew := "", ""
	threshold := 0.25
	if mapRadius > 0 {
		threshold = mapRadius * 0.2
	}
	if z > threshold {
		ns = "北"
	} else if z < -threshold {
		ns = "南"
	}
	if x > threshold {
		ew = "東"
	} else if x < -threshold {
		ew = "西"
	}

	direction := ns + ew
	if direction == "" {
		return proximity + "エリア"
	}
	return proximity + "の" + direction + "寄り"
}

func animationToLabel(anim string) string {
	lower := strings.ToLower(anim)
	hasMouth := strings.Contains(lower, "mouthopen")

	switch {
	case strings.Contains(lower, "run"):
		if hasMouth {
			return "口を開けて走行中"
		}
		return "走行中"
	case strings.Contains(lower, "walk"):
		if hasMouth {
			return "口を開けて歩行中"
		}
		return "歩行中"
	case strings.Contains(lower, "attack"):
		return "攻撃動作中"
	case strings.Contains(lower, "tailwag"):
		return "尻尾を振っている"
	case strings.Contains(lower, "idle"):
		if hasMouth {
			return "口を開けて静止中"
		}
		return "静止中"
	default:
		return "不明な行動"
	}
}

func animationSuggestsAirborne(anim string) bool {
	a := strings.ToLower(anim)
	return strings.Contains(a, "jump")
}

func nearestLandmark(x, z float64, landmarks []domain.LandmarkInfo, threshold float64) string {
	bestDist := threshold
	bestType := ""
	for _, lm := range landmarks {
		dx := x - lm.X
		dz := z - lm.Z
		d := math.Sqrt(dx*dx + dz*dz)
		if d < bestDist {
			bestDist = d
			bestType = lm.Type
		}
	}
	switch bestType {
	case "rock":
		return "岩の近く"
	case "tree":
		return "木の近く"
	}
	return ""
}

func locationContext(x, z, mapRadius float64, animation string, landmarks []domain.LandmarkInfo) string {
	parts := []string{}

	distFromCenter := math.Sqrt(x*x + z*z)
	if mapRadius > 0 && distFromCenter > mapRadius*0.8 {
		parts = append(parts, "境界の壁付近")
	}

	if distFromCenter < 0.3 {
		parts = append(parts, "マップ中央の開けた場所")
	}

	if animationSuggestsAirborne(animation) {
		parts = append(parts, "空中（ジャンプ中の可能性）")
	}

	near := nearestLandmark(x, z, landmarks, 0.35)
	if near != "" {
		parts = append(parts, near)
	}

	if len(parts) == 0 {
		return "通常の地面付近"
	}
	return strings.Join(parts, "、")
}

func facingDirection(rotY float64) string {
	deg := math.Mod(rotY*180/math.Pi, 360)
	if deg < 0 {
		deg += 360
	}

	switch {
	case deg < 22.5 || deg >= 337.5:
		return "北向き"
	case deg < 67.5:
		return "北東向き"
	case deg < 112.5:
		return "東向き"
	case deg < 157.5:
		return "南東向き"
	case deg < 202.5:
		return "南向き"
	case deg < 247.5:
		return "南西向き"
	case deg < 292.5:
		return "西向き"
	default:
		return "北西向き"
	}
}

func distance(a, b *domain.PlayerInfo) float64 {
	dx := a.X - b.X
	dz := a.Z - b.Z
	return math.Sqrt(dx*dx + dz*dz)
}

func findNearestCitizen(enemy *domain.PlayerInfo, citizens []domain.PlayerInfo) *domain.PlayerInfo {
	if len(citizens) == 0 {
		return nil
	}
	var nearest *domain.PlayerInfo
	minDist := math.MaxFloat64
	for i := range citizens {
		d := distance(enemy, &citizens[i])
		if d < minDist {
			minDist = d
			nearest = &citizens[i]
		}
	}
	return nearest
}

func isIsolated(enemy *domain.PlayerInfo, citizens []domain.PlayerInfo) bool {
	if len(citizens) == 0 {
		return false
	}
	for i := range citizens {
		if distance(enemy, &citizens[i]) < 0.5 {
			return false
		}
	}
	return true
}
