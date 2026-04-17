package policy

import (
	"agent/internal/evidence"
	"agent/internal/ops"
)

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

type SignalName string

const (
	SignalMotion        SignalName = "motion"
	SignalMouth         SignalName = "mouth"
	SignalAirborne      SignalName = "airborne"
	SignalZone          SignalName = "zone"
	SignalNearWall      SignalName = "near_wall"
	SignalLandmark      SignalName = "landmark"
	SignalFacing        SignalName = "facing"
	SignalRelation      SignalName = "relation"
	SignalThemeMismatch SignalName = "theme_mismatch"

	SignalNameDirect      SignalName = "name"
	SignalColor           SignalName = "color"
	SignalNumericDistance SignalName = "numeric_distance"
	SignalThemeName       SignalName = "theme_name"
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
	Action                   HintAction
	Specificity              HintSpecificity
	PrimaryFocus             HintFocus
	Signals                  HintSignals
	Composer                 ComposerKind
	AllowedSignals           []SignalName
	ForbiddenSignals         []SignalName
	MaxClues                 int
	CandidateCount           int
	RequireThemeMismatchHint bool
	RetryEnabled             bool
}

func BuildHintPolicy(ev evidence.HintEvidence, summary ops.RecentHintSummary) HintPolicy {
	p := HintPolicy{
		Action:         ActionGenerateHint,
		Specificity:    specificityFromElapsedSec(ev.Request.ElapsedSec),
		PrimaryFocus:   FocusMovement,
		Composer:       ComposerLLM,
		MaxClues:       2,
		CandidateCount: 3,
		RetryEnabled:   true,
		Signals: HintSignals{
			UseZone:   true,
			UseMotion: true,
		},
	}

	if ev.Enemy == nil {
		p.Action = ActionInformationPending
		p.Composer = ComposerTemplate
		p.RetryEnabled = false
		p.ForbiddenSignals = defaultForbiddenSignals()
		return p
	}

	p.Signals.UseMouth = ev.Enemy.MouthOpen

	if p.Specificity != SpecificityLow {
		p.Signals.UseAirborne = ev.Enemy.Motion.IsAirborneByAnimTag
		p.Signals.UseLandmark = ev.Enemy.Environment.NearbyLandmark.Found
		p.Signals.UseNearWall = ev.Enemy.Environment.NearWall
		p.Signals.UseFacing = shouldUseFacing(p.Specificity, ev)
		p.Signals.UseRelation = shouldUseRelation(p.Specificity, ev)
		p.Signals.UseThemeMismatch = shouldUseThemeMismatch(p.Specificity, ev, summary)
	}

	switch p.Specificity {
	case SpecificityMedium:
		p.MaxClues = 3
	case SpecificityHigh:
		p.MaxClues = 3
	}

	if p.Specificity == SpecificityHigh {
		p.PrimaryFocus = chooseHighSpecificityFocus(ev, summary)
	}

	p.AllowedSignals = buildAllowedSignals(p.Signals)
	p.ForbiddenSignals = defaultForbiddenSignals()
	p.RequireThemeMismatchHint = shouldRequireThemeMismatchHint(p, summary)

	return p
}

func buildAllowedSignals(signals HintSignals) []SignalName {
	allowed := make([]SignalName, 0, 9)
	appendIf := func(enabled bool, signal SignalName) {
		if enabled {
			allowed = append(allowed, signal)
		}
	}

	appendIf(signals.UseMotion, SignalMotion)
	appendIf(signals.UseMouth, SignalMouth)
	appendIf(signals.UseAirborne, SignalAirborne)
	appendIf(signals.UseZone, SignalZone)
	appendIf(signals.UseNearWall, SignalNearWall)
	appendIf(signals.UseLandmark, SignalLandmark)
	appendIf(signals.UseFacing, SignalFacing)
	appendIf(signals.UseRelation, SignalRelation)
	appendIf(signals.UseThemeMismatch, SignalThemeMismatch)
	return allowed
}

func defaultForbiddenSignals() []SignalName {
	return []SignalName{
		SignalNameDirect,
		SignalColor,
		SignalNumericDistance,
		SignalThemeName,
	}
}

func shouldUseThemeMismatch(specificity HintSpecificity, ev evidence.HintEvidence, summary ops.RecentHintSummary) bool {
	if ev.Request.AllyTheme == "" || ev.Request.EnemyTheme == "" {
		return false
	}
	if specificity == SpecificityLow {
		return false
	}
	if hasRecentSignal(summary, string(SignalThemeMismatch)) {
		return false
	}
	return true
}

func shouldRequireThemeMismatchHint(p HintPolicy, summary ops.RecentHintSummary) bool {
	if !p.Signals.UseThemeMismatch {
		return false
	}
	if p.Specificity != SpecificityHigh {
		return false
	}
	if hasRecentSignal(summary, string(SignalThemeMismatch)) {
		return false
	}
	return true
}

func hasRecentSignal(summary ops.RecentHintSummary, target string) bool {
	for _, signal := range summary.RecentSignals {
		if signal == target {
			return true
		}
	}
	return false
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

func chooseHighSpecificityFocus(ev evidence.HintEvidence, summary ops.RecentHintSummary) HintFocus {
	if ev.Enemy == nil {
		return FocusMovement
	}
	if len(summary.RecentFocuses) > 0 && summary.RecentFocuses[0] == string(FocusLocation) {
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
