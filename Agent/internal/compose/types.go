package compose

import (
	"context"

	"agent/internal/evidence"
	"agent/internal/ops"
	"agent/internal/policy"
)

type Composer interface {
	Compose(ctx context.Context, ev evidence.HintEvidence, hintPolicy policy.HintPolicy, summary ops.RecentHintSummary) (string, error)
}
