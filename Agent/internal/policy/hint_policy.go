package policy

import "agent/internal/evidence"

type HintAction string

const (
	ActionGenerateHint       HintAction = "generate_hint"
	ActionInformationPending HintAction = "information_pending"
)

type HintSpecificity string

const (
	SpecificityLow    HintSpecificity = "low"
	SpecificityMedium HintSpecificity = "medium"
	SpecificityHigh   HintSpecificity = "high"
)

type HintFocus string

const (
	FocusMovement HintFocus = "movement"
	FocusLocation HintFocus = "location"
	FocusRelation HintFocus = "relation"
)

type ComposerKind string

const (
	ComposerLLM      ComposerKind = "llm"
	ComposerTemplate ComposerKind = "template"
)

type HintSignals struct {
	UseZone          bool
	UseMotion        bool
	UseMouth         bool
	UseAirborne      bool
	UseFacing        bool
	UseRelation      bool
	UseLandmark      bool
	UseNearWall      bool
	UseThemeMismatch bool
}

type HintPolicy struct {
	Action       HintAction
	Specificity  HintSpecificity
	PrimaryFocus HintFocus
	Signals      HintSignals
	Composer     ComposerKind
}

func BuildHintPolicy(ev evidence.HintEvidence) HintPolicy {
	p := HintPolicy{
		Action:       ActionGenerateHint,
		Specificity:  specificityFromElapsedSec(ev.Request.ElapsedSec),
		PrimaryFocus: FocusMovement,
		Composer:     ComposerLLM,
		Signals: HintSignals{
			UseZone:   true,
			UseMotion: true,
		},
	}

	if ev.Enemy == nil {
		p.Action = ActionInformationPending
		p.Composer = ComposerTemplate
		return p
	}

	p.Signals.UseMouth = ev.Enemy.MouthOpen

	if p.Specificity != SpecificityLow {
		p.Signals.UseAirborne = ev.Enemy.Motion.IsAirborneByAnimTag
		p.Signals.UseLandmark = ev.Enemy.Environment.NearbyLandmark.Found
		p.Signals.UseNearWall = ev.Enemy.Environment.NearWall
		p.Signals.UseFacing = shouldUseFacing(p.Specificity, ev)
		p.Signals.UseRelation = shouldUseRelation(p.Specificity, ev)
		p.Signals.UseThemeMismatch = shouldUseThemeMismatch(ev)
	}

	if p.Specificity == SpecificityHigh {
		p.PrimaryFocus = chooseHighSpecificityFocus(ev)
	}

	return p
}

func shouldUseThemeMismatch(ev evidence.HintEvidence) bool {
	return ev.Request.AllyTheme != "" && ev.Request.EnemyTheme != ""
}

func specificityFromElapsedSec(elapsedSec int) HintSpecificity {
	switch {
	case elapsedSec < 30:
		return SpecificityLow
	case elapsedSec < 45:
		return SpecificityMedium
	default:
		return SpecificityHigh
	}
}

func chooseHighSpecificityFocus(ev evidence.HintEvidence) HintFocus {
	if ev.Enemy == nil {
		return FocusMovement
	}
	if hasStrongLocationCue(*ev.Enemy) {
		return FocusLocation
	}
	return FocusMovement
}

func hasStrongLocationCue(enemy evidence.PlayerEvidence) bool {
	return enemy.Environment.NearWall ||
		enemy.Environment.NearbyLandmark.Found ||
		enemy.Zone.NorthSouth != evidence.VerticalBiasNone ||
		enemy.Zone.EastWest != evidence.HorizontalBiasNone
}

func shouldUseFacing(specificity HintSpecificity, ev evidence.HintEvidence) bool {
	if specificity == SpecificityLow || ev.Enemy == nil {
		return false
	}
	if ev.Enemy.Motion.Kind == evidence.MotionRun {
		return false
	}
	return ev.Enemy.Environment.NearWall ||
		ev.Enemy.Environment.NearbyLandmark.Found ||
		ev.EnemyIsIsolated
}

func shouldUseRelation(specificity HintSpecificity, ev evidence.HintEvidence) bool {
	if specificity == SpecificityLow {
		return false
	}
	if ev.EnemyIsIsolated {
		return true
	}
	if ev.NearestCitizen == nil {
		return false
	}

	switch specificity {
	case SpecificityMedium:
		return ev.NearestCitizen.Distance < 0.3
	case SpecificityHigh:
		return ev.NearestCitizen.Distance < 0.4
	default:
		return false
	}
}
