package usecase

import (
	"math/rand"
	"testing"
)

func TestPickThemes_AllyAndEnemyDiffer(t *testing.T) {
	for seed := int64(0); seed < 100; seed++ {
		rand.Seed(seed)
		a, b := PickThemes()
		if a == b {
			t.Fatalf("seed %d: ally and enemy both %q", seed, a)
		}
	}
}
