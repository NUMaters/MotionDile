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
