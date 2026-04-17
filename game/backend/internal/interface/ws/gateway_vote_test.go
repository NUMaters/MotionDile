package ws

import "testing"

func TestVoteMajorityThreshold(t *testing.T) {
	cases := []struct {
		n    int
		want int
	}{
		{0, 1},
		{1, 1},
		{2, 2},
		{3, 2},
		{4, 3},
		{5, 3},
		{10, 6},
	}
	for _, tc := range cases {
		if g := voteMajorityThreshold(tc.n); g != tc.want {
			t.Fatalf("voteMajorityThreshold(%d)=%d want %d", tc.n, g, tc.want)
		}
	}
}
