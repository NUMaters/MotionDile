package repository

import "waniar/game-backend/internal/domain/entity"

// VoteExtendResult は ApplyVoteExtend の結果。
// Silent が true のときは gateway はブロードキャストしない（重複・非対象・フェーズ不一致など）。
type VoteExtendResult struct {
	State           entity.GameState
	MajorityApplied bool
	Silent          bool
}
