package evidence

import (
	"math"
	"strings"

	"agent/internal/domain"
)

type ProximityKind string

const (
	ProximityCenter ProximityKind = "center"
	ProximityMiddle ProximityKind = "middle"
	ProximityOuter  ProximityKind = "outer"
)

type VerticalBias string

const (
	VerticalBiasNone  VerticalBias = ""
	VerticalBiasNorth VerticalBias = "north"
	VerticalBiasSouth VerticalBias = "south"
)

type HorizontalBias string

const (
	HorizontalBiasNone HorizontalBias = ""
	HorizontalBiasEast HorizontalBias = "east"
	HorizontalBiasWest HorizontalBias = "west"
)

type MotionKind string

const (
	MotionRun     MotionKind = "run"
	MotionWalk    MotionKind = "walk"
	MotionAttack  MotionKind = "attack"
	MotionTailWag MotionKind = "tailwag"
	MotionIdle    MotionKind = "idle"
	MotionUnknown MotionKind = "unknown"
)

type FacingDirection string

const (
	FacingNorth     FacingDirection = "north"
	FacingNorthEast FacingDirection = "northeast"
	FacingEast      FacingDirection = "east"
	FacingSouthEast FacingDirection = "southeast"
	FacingSouth     FacingDirection = "south"
	FacingSouthWest FacingDirection = "southwest"
	FacingWest      FacingDirection = "west"
	FacingNorthWest FacingDirection = "northwest"
)

type LandmarkKind string

const (
	LandmarkNone LandmarkKind = "none"
	LandmarkRock LandmarkKind = "rock"
	LandmarkTree LandmarkKind = "tree"
)

type ZoneEvidence struct {
	Proximity  ProximityKind
	NorthSouth VerticalBias
	EastWest   HorizontalBias
}

type MotionEvidence struct {
	Kind                MotionKind
	UsesMouthAnimation  bool
	IsAirborneByAnimTag bool
}

type LandmarkEvidence struct {
	Kind     LandmarkKind
	Found    bool
	Distance float64
}

type EnvironmentEvidence struct {
	DistanceFromCenter float64
	NearWall           bool
	NearShore          bool
	NearCenter         bool
	NearbyLandmark     LandmarkEvidence
}

type PlayerEvidence struct {
	Source      domain.PlayerInfo
	Zone        ZoneEvidence
	Motion      MotionEvidence
	Facing      FacingDirection
	Environment EnvironmentEvidence
	MouthOpen   bool
}

type NeighborEvidence struct {
	Player   PlayerEvidence
	Distance float64
}

type HintEvidence struct {
	Request         domain.HintRequest
	Enemy           *PlayerEvidence
	Citizens        []PlayerEvidence
	NearestCitizen  *NeighborEvidence
	EnemyIsIsolated bool
}

func BuildHintEvidence(req domain.HintRequest) HintEvidence {
	result := HintEvidence{
		Request:  req,
		Citizens: make([]PlayerEvidence, 0, len(req.Players)),
	}

	for _, player := range req.Players {
		observed := observePlayer(player, req.MapRadius, req.Landmarks)
		if player.IsEnemy {
			result.Enemy = &observed
			continue
		}
		result.Citizens = append(result.Citizens, observed)
	}

	result.NearestCitizen = findNearestCitizen(result.Enemy, result.Citizens)
	result.EnemyIsIsolated = isIsolated(result.Enemy, result.Citizens)
	return result
}

func observePlayer(player domain.PlayerInfo, mapRadius float64, landmarks []domain.LandmarkInfo) PlayerEvidence {
	motion := deriveMotion(player.Animation)
	return PlayerEvidence{
		Source:      player,
		Zone:        deriveZone(player.X, player.Z, mapRadius),
		Motion:      motion,
		Facing:      deriveFacing(player.RotationY),
		Environment: deriveEnvironment(player.X, player.Z, mapRadius, landmarks),
		MouthOpen:   player.MouthOpenness > 0.4,
	}
}

func deriveZone(x, z, mapRadius float64) ZoneEvidence {
	distFromCenter := math.Sqrt(x*x + z*z)
	zone := ZoneEvidence{
		Proximity: determineProximity(distFromCenter, mapRadius),
	}

	threshold := 0.25
	if mapRadius > 0 {
		threshold = mapRadius * 0.2
	}

	switch {
	case z > threshold:
		zone.NorthSouth = VerticalBiasNorth
	case z < -threshold:
		zone.NorthSouth = VerticalBiasSouth
	}

	switch {
	case x > threshold:
		zone.EastWest = HorizontalBiasEast
	case x < -threshold:
		zone.EastWest = HorizontalBiasWest
	}

	return zone
}

func determineProximity(distFromCenter, mapRadius float64) ProximityKind {
	if mapRadius > 0 {
		ratio := distFromCenter / mapRadius
		switch {
		case ratio < 0.33:
			return ProximityCenter
		case ratio < 0.66:
			return ProximityMiddle
		default:
			return ProximityOuter
		}
	}

	switch {
	case distFromCenter < 0.4:
		return ProximityCenter
	case distFromCenter < 0.8:
		return ProximityMiddle
	default:
		return ProximityOuter
	}
}

func deriveMotion(animation string) MotionEvidence {
	lower := strings.ToLower(animation)
	motion := MotionEvidence{
		UsesMouthAnimation:  strings.Contains(lower, "mouthopen"),
		IsAirborneByAnimTag: strings.Contains(lower, "jump"),
	}

	switch {
	case strings.Contains(lower, "run"):
		motion.Kind = MotionRun
	case strings.Contains(lower, "walk"):
		motion.Kind = MotionWalk
	case strings.Contains(lower, "attack"):
		motion.Kind = MotionAttack
	case strings.Contains(lower, "tailwag"):
		motion.Kind = MotionTailWag
	case strings.Contains(lower, "idle"):
		motion.Kind = MotionIdle
	default:
		motion.Kind = MotionUnknown
	}

	return motion
}

func deriveFacing(rotationY float64) FacingDirection {
	deg := math.Mod(rotationY*180/math.Pi, 360)
	if deg < 0 {
		deg += 360
	}

	switch {
	case deg < 22.5 || deg >= 337.5:
		return FacingNorth
	case deg < 67.5:
		return FacingNorthEast
	case deg < 112.5:
		return FacingEast
	case deg < 157.5:
		return FacingSouthEast
	case deg < 202.5:
		return FacingSouth
	case deg < 247.5:
		return FacingSouthWest
	case deg < 292.5:
		return FacingWest
	default:
		return FacingNorthWest
	}
}

func deriveEnvironment(x, z, mapRadius float64, landmarks []domain.LandmarkInfo) EnvironmentEvidence {
	distFromCenter := math.Sqrt(x*x + z*z)
	nearShore := false
	nearWall := false
	if mapRadius > 0 {
		ratio := distFromCenter / mapRadius
		nearShore = ratio >= 0.68
		nearWall = ratio >= 0.8
	}
	return EnvironmentEvidence{
		DistanceFromCenter: distFromCenter,
		NearWall:           nearWall,
		NearShore:          nearShore,
		NearCenter:         distFromCenter < 0.3,
		NearbyLandmark:     findNearbyLandmark(x, z, landmarks, 0.35),
	}
}

func findNearbyLandmark(x, z float64, landmarks []domain.LandmarkInfo, threshold float64) LandmarkEvidence {
	best := LandmarkEvidence{
		Kind:     LandmarkNone,
		Distance: threshold,
	}

	for _, landmark := range landmarks {
		dx := x - landmark.X
		dz := z - landmark.Z
		dist := math.Sqrt(dx*dx + dz*dz)
		if dist >= best.Distance {
			continue
		}

		best = LandmarkEvidence{
			Kind:     toLandmarkKind(landmark.Type),
			Found:    true,
			Distance: dist,
		}
	}

	if best.Kind == LandmarkNone {
		best.Found = false
	}

	return best
}

func toLandmarkKind(raw string) LandmarkKind {
	switch strings.ToLower(raw) {
	case "rock":
		return LandmarkRock
	case "tree":
		return LandmarkTree
	default:
		return LandmarkNone
	}
}

func distanceBetween(a, b domain.PlayerInfo) float64 {
	dx := a.X - b.X
	dz := a.Z - b.Z
	return math.Sqrt(dx*dx + dz*dz)
}

func findNearestCitizen(enemy *PlayerEvidence, citizens []PlayerEvidence) *NeighborEvidence {
	if enemy == nil || len(citizens) == 0 {
		return nil
	}

	minDist := math.MaxFloat64
	var nearest *NeighborEvidence
	for _, citizen := range citizens {
		dist := distanceBetween(enemy.Source, citizen.Source)
		if dist < minDist {
			minDist = dist
			nearest = &NeighborEvidence{
				Player:   citizen,
				Distance: dist,
			}
		}
	}

	return nearest
}

func isIsolated(enemy *PlayerEvidence, citizens []PlayerEvidence) bool {
	if enemy == nil || len(citizens) == 0 {
		return false
	}

	for _, citizen := range citizens {
		if distanceBetween(enemy.Source, citizen.Source) < 0.5 {
			return false
		}
	}

	return true
}
