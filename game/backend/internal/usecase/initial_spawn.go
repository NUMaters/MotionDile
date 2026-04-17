package usecase

import (
	"math"
	"math/rand/v2"

	"waniar/game-backend/internal/domain/entity"
)

// InitialSpawnPosition は新規入室者用に、円形エリア内で他プレイと近付きすぎない XZ を乱択する。
// Y は 0（クライアントが地形にスナップ）。rotationY は [0,2π)。
// mapRadius はフロントの BOUNDARY / Agent 用 WANIAR_MAP_RADIUS と揃える想定。
func InitialSpawnPosition(others []entity.PlayerState, playerID string, mapRadius float64) (x, y, z, rotationY float64) {
	return initialSpawnPosition(others, playerID, mapRadius, rand.Float64)
}

func initialSpawnPosition(others []entity.PlayerState, playerID string, mapRadius float64, rf func() float64) (x, y, z, rotationY float64) {
	y = 0
	const (
		margin      = 0.1
		minPeerDist = 0.48
		innerFrac   = 0.2
		slots       = 16
	)
	maxR := mapRadius - margin
	if maxR < 0.12 {
		maxR = 0.12
	}
	rInner := maxR * innerFrac

	farEnough := func(px, pz float64) bool {
		for _, o := range others {
			dx := px - o.X
			dz := pz - o.Z
			if math.Hypot(dx, dz) < minPeerDist {
				return false
			}
		}
		return true
	}

	slot := int(hashPlayerID(playerID) % uint32(slots))
	span := 2 * math.Pi / float64(slots)

	for attempt := 0; attempt < 240; attempt++ {
		bump := (slot + attempt) % slots
		theta := (float64(bump) + rf()) * span
		u := rf()
		r := math.Sqrt(rInner*rInner + u*(maxR*maxR-rInner*rInner))
		x = math.Cos(theta) * r
		z = math.Sin(theta) * r
		if farEnough(x, z) {
			rotationY = rf() * 2 * math.Pi
			return x, y, z, rotationY
		}
	}
	for i := 0; i < slots*2; i++ {
		theta := float64(i%slots) * span
		x = math.Cos(theta) * maxR * 0.82
		z = math.Sin(theta) * maxR * 0.82
		if farEnough(x, z) {
			rotationY = rf() * 2 * math.Pi
			return x, y, z, rotationY
		}
	}
	x = 0.03 * float64(int(hashPlayerID(playerID)%7)-3)
	z = 0.03 * float64(int((hashPlayerID(playerID)>>8)%7) - 3)
	rotationY = rf() * 2 * math.Pi
	return x, y, z, rotationY
}

func hashPlayerID(s string) uint32 {
	var h uint32 = 5381
	for i := 0; i < len(s); i++ {
		h = ((h << 5) + h) + uint32(s[i])
	}
	return h
}
