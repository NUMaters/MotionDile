package repository

import "errors"

// ErrVoteAlreadyCast は同一プレイヤーからの2回目以降の投票を拒否するときに返す。
var ErrVoteAlreadyCast = errors.New("vote already cast")

// ErrSkipBlobWrite は Redis mutBlob のコールバックが blob を更新しないときに返す（トランザクションをコミットしない）。
var ErrSkipBlobWrite = errors.New("skip blob write")
