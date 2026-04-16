package material

import (
	"agent/internal/evidence"
	"agent/internal/policy"
)

type ClueKind string

const (
	ClueMovement      ClueKind = "movement"
	ClueLocation      ClueKind = "location"
	ClueFacing        ClueKind = "facing"
	ClueRelation      ClueKind = "relation"
	ClueThemeMismatch ClueKind = "theme_mismatch"
)

type SelectedMaterials struct {
	PrimaryFocus policy.HintFocus
	PrimaryClue  ClueKind
	Clues        []ClueKind
}

func (s SelectedMaterials) Contains(kind ClueKind) bool {
	for _, clue := range s.Clues {
		if clue == kind {
			return true
		}
	}
	return false
}

func SelectMaterials(ev evidence.HintEvidence, hintPolicy policy.HintPolicy) SelectedMaterials {
	selected := SelectedMaterials{
		PrimaryFocus: hintPolicy.PrimaryFocus,
		PrimaryClue:  clueFromFocus(hintPolicy.PrimaryFocus),
	}

	maxClues := hintPolicy.MaxClues
	if maxClues <= 0 {
		maxClues = 3
	}

	for _, clue := range prioritizedClues(hintPolicy.PrimaryFocus) {
		if !clueAvailable(clue, ev, hintPolicy) || selected.Contains(clue) {
			continue
		}
		selected.Clues = append(selected.Clues, clue)
		if len(selected.Clues) >= maxClues {
			break
		}
	}

	if len(selected.Clues) > 0 {
		selected.PrimaryClue = selected.Clues[0]
	}

	return selected
}

func prioritizedClues(focus policy.HintFocus) []ClueKind {
	switch focus {
	case policy.FocusLocation:
		return []ClueKind{ClueLocation, ClueMovement, ClueRelation, ClueFacing, ClueThemeMismatch}
	case policy.FocusRelation:
		return []ClueKind{ClueRelation, ClueMovement, ClueLocation, ClueFacing, ClueThemeMismatch}
	default:
		return []ClueKind{ClueMovement, ClueLocation, ClueRelation, ClueFacing, ClueThemeMismatch}
	}
}

func clueAvailable(clue ClueKind, ev evidence.HintEvidence, hintPolicy policy.HintPolicy) bool {
	if ev.Enemy == nil {
		return false
	}

	switch clue {
	case ClueMovement:
		return hasAllowedSignal(hintPolicy, policy.SignalMotion)
	case ClueLocation:
		return hasAllowedSignal(hintPolicy, policy.SignalZone) ||
			hasAllowedSignal(hintPolicy, policy.SignalNearWall) ||
			hasAllowedSignal(hintPolicy, policy.SignalLandmark)
	case ClueFacing:
		return hasAllowedSignal(hintPolicy, policy.SignalFacing)
	case ClueRelation:
		if !hasAllowedSignal(hintPolicy, policy.SignalRelation) {
			return false
		}
		return ev.EnemyIsIsolated || ev.NearestCitizen != nil
	case ClueThemeMismatch:
		return hasAllowedSignal(hintPolicy, policy.SignalThemeMismatch)
	default:
		return false
	}
}

func hasAllowedSignal(hintPolicy policy.HintPolicy, target policy.SignalName) bool {
	for _, signal := range hintPolicy.AllowedSignals {
		if signal == target {
			return true
		}
	}
	return false
}

func clueFromFocus(focus policy.HintFocus) ClueKind {
	switch focus {
	case policy.FocusLocation:
		return ClueLocation
	case policy.FocusRelation:
		return ClueRelation
	default:
		return ClueMovement
	}
}
