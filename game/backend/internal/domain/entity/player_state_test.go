package entity

import "testing"

func TestPlayerColors_LengthAndUnique(t *testing.T) {
	if len(PlayerColors) != 10 {
		t.Fatalf("len(PlayerColors) = %d, want 10", len(PlayerColors))
	}
	seen := make(map[string]struct{}, len(PlayerColors))
	for _, c := range PlayerColors {
		if _, ok := seen[c]; ok {
			t.Fatalf("duplicate color %q", c)
		}
		seen[c] = struct{}{}
	}
}
