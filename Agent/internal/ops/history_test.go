package ops

import "testing"

func TestMemoryHintHistoryStore_GetRecentSummary(t *testing.T) {
	store := NewMemoryHintHistoryStore()
	store.Append(HintRecord{
		RoomID:      "room-1",
		Text:        "外周で不審な動き",
		Focus:       "movement",
		UsedSignals: []string{"motion", "zone"},
	})
	store.Append(HintRecord{
		RoomID:      "room-1",
		Text:        "壁際で周囲と噛み合わない",
		Focus:       "location",
		UsedSignals: []string{"near_wall", "theme_mismatch"},
	})

	summary := store.GetRecentSummary("room-1", 2)

	if len(summary.RecentTexts) != 2 {
		t.Fatalf("expected 2 texts, got %d", len(summary.RecentTexts))
	}
	if summary.RecentTexts[0] != "壁際で周囲と噛み合わない" {
		t.Fatalf("expected newest text first, got %q", summary.RecentTexts[0])
	}
	if len(summary.RecentSignals) < 3 {
		t.Fatalf("expected deduplicated recent signals, got %v", summary.RecentSignals)
	}
}
