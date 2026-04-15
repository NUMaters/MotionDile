package compose

import (
	"strings"

	"agent/internal/evidence"
	"agent/internal/policy"
)

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
	if hintPolicy.Signals.UseThemeMismatch {
		lines = append(lines, formatThemeMismatchHint(ev.Request.AllyTheme, ev.Request.EnemyTheme))
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

	themeMismatch := ""
	if hintPolicy.Signals.UseThemeMismatch {
		themeMismatch = "周囲と噛み合わない"
	}

	switch hintPolicy.PrimaryFocus {
	case policy.FocusLocation:
		return compactHintParts(location, movement, relation, themeMismatch, facing)
	case policy.FocusRelation:
		return compactHintParts(relation, movement, location, themeMismatch, facing)
	default:
		return compactHintParts(movement, location, relation, themeMismatch, facing)
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

func formatThemeMismatchHint(allyTheme, enemyTheme string) string {
	if allyTheme == "" || enemyTheme == "" {
		return ""
	}
	return "テーマ差分: 市民側の流れと噛み合わない行動として示唆する"
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
	if hintPolicy.Signals.UseThemeMismatch {
		labels = append(labels, "テーマとのズレ")
	}
	return labels
}
