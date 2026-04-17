package entity

type GamePhase string

const (
	PhaseWaiting   GamePhase = "waiting"
	PhaseCountdown GamePhase = "countdown"
	PhasePlaying   GamePhase = "playing"
	PhaseVoting    GamePhase = "voting"
	PhaseResults   GamePhase = "results"
)

type GameState struct {
	Phase         GamePhase         `json:"phase"`
	EnemyPlayerID string            `json:"enemyPlayerId,omitempty"`
	// RoundPlayerIDs は game_start 時点で WebSocket 接続していたプレイヤー（このラウンドの参加者）
	RoundPlayerIDs []string `json:"roundPlayerIds,omitempty"`
	AllyTheme      string   `json:"allyTheme,omitempty"`
	EnemyTheme     string   `json:"enemyTheme,omitempty"`
	Votes          map[string]string `json:"votes,omitempty"`
	// VoteExtendUsed は投票時間の +10 秒延長が既に 1 回適用されたか
	VoteExtendUsed bool `json:"voteExtendUsed,omitempty"`
	// VoteExtendRequestPlayerIDs は延長に賛成ボタンを押したプレイヤー ID（重複なし）
	VoteExtendRequestPlayerIDs []string `json:"voteExtendRequestPlayerIds,omitempty"`
	CountdownEnd  int64             `json:"countdownEnd,omitempty"`
	GameEnd       int64             `json:"gameEnd,omitempty"`
	VoteEnd       int64             `json:"voteEnd,omitempty"`
	HintCount     int               `json:"hintCount"`
	PlayerCount   int               `json:"playerCount"`
}

type HintInfo struct {
	Number int    `json:"number"`
	Text   string `json:"text"`
}

type VoteResult struct {
	EnemyPlayerID string            `json:"enemyPlayerId"`
	EnemyColor    string            `json:"enemyColor,omitempty"`
	AllyTheme     string            `json:"allyTheme,omitempty"`
	EnemyTheme    string            `json:"enemyTheme,omitempty"`
	Votes         map[string]string `json:"votes"`
	VoteCounts    map[string]int    `json:"voteCounts"`
	CitizensWin   bool              `json:"citizensWin"`
}
