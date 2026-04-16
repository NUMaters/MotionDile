package compose

import (
	"testing"

	"agent/internal/evidence"
	"agent/internal/policy"
)

func TestFormatZone_PrefersWaterEdgeWhenNearShore(t *testing.T) {
	text := formatZone(
		evidence.ZoneEvidence{
			Proximity:  evidence.ProximityMiddle,
			NorthSouth: evidence.VerticalBiasNorth,
			EastWest:   evidence.HorizontalBiasEast,
		},
		evidence.EnvironmentEvidence{
			NearShore: true,
		},
		policy.SpecificityMedium,
	)

	if text != "北東の水際" {
		t.Fatalf("expected shoreline-focused zone text, got %s", text)
	}
}

func TestFormatZone_UsesShorelineForLowSpecificity(t *testing.T) {
	text := formatZone(
		evidence.ZoneEvidence{
			Proximity: evidence.ProximityMiddle,
		},
		evidence.EnvironmentEvidence{
			NearShore: true,
		},
		policy.SpecificityLow,
	)

	if text != "水際付近" {
		t.Fatalf("expected low-specificity shoreline text, got %s", text)
	}
}
