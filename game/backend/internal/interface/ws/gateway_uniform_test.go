package ws

import "testing"

func TestUniformCryptoIndexRange(t *testing.T) {
	for n := 1; n <= 32; n++ {
		for range 200 {
			idx, ok := uniformCryptoIndex(n)
			if !ok {
				t.Fatal("uniformCryptoIndex returned ok=false")
			}
			if idx < 0 || idx >= n {
				t.Fatalf("n=%d idx=%d out of range", n, idx)
			}
		}
	}
}

func TestUniformCryptoIndex_notAlwaysZero(t *testing.T) {
	const n = 8
	const trials = 4000
	hits := make([]int, n)
	for range trials {
		idx, ok := uniformCryptoIndex(n)
		if !ok || idx < 0 || idx >= n {
			t.Fatalf("bad idx ok=%v idx=%d", ok, idx)
		}
		hits[idx]++
	}
	// 常に 0 番だけが選ばれているような極端な偏りは拒否（期待値 trials/n）
	exp := float64(trials) / float64(n)
	for i, c := range hits {
		if float64(c) > exp*3.5 {
			t.Fatalf("index %d dominated: count=%d (expected ~%.0f)", i, c, exp)
		}
	}
	if hits[0] == trials {
		t.Fatal("idx always 0")
	}
}
