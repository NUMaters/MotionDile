package ops

import (
	"strings"
	"sync"
	"time"
)

type HintRecord struct {
	RoomID      string
	Text        string
	Specificity string
	Focus       string
	UsedSignals []string
	GeneratedAt time.Time
}

type RecentHintSummary struct {
	RecentTexts   []string
	RecentFocuses []string
	RecentSignals []string
}

type HintHistoryStore interface {
	Append(record HintRecord)
	GetRecentSummary(roomID string, limit int) RecentHintSummary
}

type MemoryHintHistoryStore struct {
	mu      sync.RWMutex
	records map[string][]HintRecord
}

func NewMemoryHintHistoryStore() *MemoryHintHistoryStore {
	return &MemoryHintHistoryStore{
		records: make(map[string][]HintRecord),
	}
}

func (s *MemoryHintHistoryStore) Append(record HintRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()

	record.Text = strings.TrimSpace(record.Text)
	record.GeneratedAt = time.Now()
	s.records[record.RoomID] = append(s.records[record.RoomID], record)
}

func (s *MemoryHintHistoryStore) GetRecentSummary(roomID string, limit int) RecentHintSummary {
	s.mu.RLock()
	defer s.mu.RUnlock()

	records := s.records[roomID]
	if len(records) == 0 || limit <= 0 {
		return RecentHintSummary{}
	}

	start := len(records) - limit
	if start < 0 {
		start = 0
	}

	summary := RecentHintSummary{
		RecentTexts:   make([]string, 0, len(records)-start),
		RecentFocuses: make([]string, 0, len(records)-start),
	}
	signalSet := make(map[string]struct{})

	for i := len(records) - 1; i >= start; i-- {
		record := records[i]
		if record.Text != "" {
			summary.RecentTexts = append(summary.RecentTexts, record.Text)
		}
		if record.Focus != "" {
			summary.RecentFocuses = append(summary.RecentFocuses, record.Focus)
		}
		for _, signal := range record.UsedSignals {
			if signal == "" {
				continue
			}
			if _, exists := signalSet[signal]; exists {
				continue
			}
			signalSet[signal] = struct{}{}
			summary.RecentSignals = append(summary.RecentSignals, signal)
		}
	}

	return summary
}
