package domain

// ゲームサーバーから受け取るプレイヤー情報
type PlayerInfo struct {
	PlayerID      string  `json:"playerId"`
	DisplayName   string  `json:"displayName"`
	X             float64 `json:"x"`
	Y             float64 `json:"y"`
	Z             float64 `json:"z"`
	RotationY     float64 `json:"rotationY"`
	Animation     string  `json:"animation"`
	MouthOpenness float64 `json:"mouthOpenness"`
	Color         string  `json:"color"`
	IsEnemy       bool    `json:"isEnemy"`
}

type LandmarkInfo struct {
	Type string  `json:"type"`
	X    float64 `json:"x"`
	Z    float64 `json:"z"`
}

// ゲームサーバーから受け取るヒント生成リクエスト
type HintRequest struct {
	RoomID       string         `json:"roomId"`
	HintNumber   int            `json:"hintNumber"`
	GameDuration int            `json:"gameDuration"`
	ElapsedSec   int            `json:"elapsedSec"`
	MapRadius    float64        `json:"mapRadius"`
	AllyTheme    string         `json:"allyTheme,omitempty"`
	EnemyTheme   string         `json:"enemyTheme,omitempty"`
	Players      []PlayerInfo   `json:"players"`
	Landmarks    []LandmarkInfo `json:"landmarks,omitempty"`
}

// Agent が返すレスポンス
type HintResponse struct {
	Text string `json:"text"`
}

// ThemeRequest はゲーム開始時のお題生成入力です。
type ThemeRequest struct {
	RoomID      string `json:"roomId"`
	PlayerCount int    `json:"playerCount"`
}

// ThemeResponse は市民側と敵側のお題を返します。
type ThemeResponse struct {
	AllyTheme  string `json:"allyTheme"`
	EnemyTheme string `json:"enemyTheme"`
}
