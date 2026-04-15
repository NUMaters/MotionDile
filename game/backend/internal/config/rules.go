package config

import (
	"os"
	"strconv"
	"time"
)

// Rules はゲームの時間・人数・マップ半径（Agent ヒント用）をまとめた設定です。
// 環境変数が未設定または不正なときはデフォルトを使います。
type Rules struct {
	GameDuration   time.Duration // 対戦プレイ時間
	MatchCountdown time.Duration // 待機→対戦開始までのカウントダウン（マッチ開始前）
	VoteDuration   time.Duration
	ResultDuration time.Duration
	HintInterval   time.Duration
	MinPlayers     int
	MaxPlayers     int
	MapRadius      float64
}

// LoadRulesFromEnv はゲームルールを環境変数から読み込みます。
//
//	WANIAR_GAME_DURATION_SEC      対戦の秒数（既定 60）
//	WANIAR_MATCH_COUNTDOWN_SEC    マッチ開始前カウントダウンの秒数（既定 20）
//	WANIAR_VOTE_DURATION_SEC        投票フェーズの秒数（既定 20）
//	WANIAR_RESULT_DURATION_SEC      結果表示後にロビーへ戻るまでの秒数（既定 10）
//	WANIAR_HINT_INTERVAL_SEC        ヒント配信の間隔（秒、既定 15）
//	WANIAR_MIN_PLAYERS              カウントダウン開始に必要な最低人数（既定 3）
//	WANIAR_MAX_PLAYERS              1 ルームの最大人数・満員で開始（既定 10）
//	WANIAR_MAP_RADIUS               Agent ヒント用のマップ半径（既定 1.3）
func LoadRulesFromEnv() Rules {
	r := Rules{
		GameDuration:   durationSec("WANIAR_GAME_DURATION_SEC", 60),
		MatchCountdown: durationSec("WANIAR_MATCH_COUNTDOWN_SEC", 20),
		VoteDuration:   durationSec("WANIAR_VOTE_DURATION_SEC", 20),
		ResultDuration: durationSec("WANIAR_RESULT_DURATION_SEC", 10),
		HintInterval:   durationSec("WANIAR_HINT_INTERVAL_SEC", 15),
		MinPlayers:     intEnv("WANIAR_MIN_PLAYERS", 3),
		MaxPlayers:     intEnv("WANIAR_MAX_PLAYERS", 10),
		MapRadius:      floatEnv("WANIAR_MAP_RADIUS", 1.3),
	}
	if r.MinPlayers < 1 {
		r.MinPlayers = 1
	}
	if r.MaxPlayers < r.MinPlayers {
		r.MaxPlayers = r.MinPlayers
	}
	return r
}

func durationSec(key string, defSec float64) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return time.Duration(defSec * float64(time.Second))
	}
	sec, err := strconv.ParseFloat(v, 64)
	if err != nil || sec <= 0 {
		return time.Duration(defSec * float64(time.Second))
	}
	return time.Duration(sec * float64(time.Second))
}

func intEnv(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return def
	}
	return n
}

func floatEnv(key string, def float64) float64 {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil || f <= 0 {
		return def
	}
	return f
}
