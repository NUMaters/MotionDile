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
	Votes         map[string]string `json:"votes,omitempty"`
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
	Votes         map[string]string `json:"votes"`
	VoteCounts    map[string]int    `json:"voteCounts"`
	CitizensWin   bool              `json:"citizensWin"`
}
