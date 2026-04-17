package usecase

import (
	"math"
	"testing"

	"waniar/game-backend/internal/domain/entity"
)

func TestInitialSpawnPosition_minDistanceBetweenTwo(t *testing.T) {
	others := []entity.PlayerState{
		{PlayerID: "a", X: 0.4, Z: 0.2},
	}
	x, _, z, _ := initialSpawnPosition(others, "b-new", 1.3, func() float64 { return 0.37 })
	d := math.Hypot(x-0.4, z-0.2)
	if d < 0.45 {
		t.Fatalf("too close to existing: dist=%v pos=(%v,%v)", d, x, z)
	}
}

func TestInitialSpawnPosition_deterministicRNG(t *testing.T) {
	i := 0
	seq := []float64{0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8}
	rf := func() float64 {
		v := seq[i%len(seq)]
		i++
		return v
	}
	x, y, z, ry := initialSpawnPosition(nil, "player-z", 1.3, rf)
	if y != 0 {
		t.Fatalf("y=%v", y)
	}
	if math.Abs(x) > 2 || math.Abs(z) > 2 {
		t.Fatalf("sanity: x=%v z=%v", x, z)
	}
	_ = ry
}
