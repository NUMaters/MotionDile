package entity

type PlayerState struct {
	PlayerID    string  `json:"playerId"`
	DisplayName string  `json:"displayName"`
	X           float64 `json:"x"`
	Y         float64 `json:"y"`
	Z         float64 `json:"z"`
	RotationY float64 `json:"rotationY"`
	NeckYaw   float64 `json:"neckYaw"`
	NeckPitch float64 `json:"neckPitch"`
	Animation     string  `json:"animation"`
	MouthOpenness float64 `json:"mouthOpenness"`
	Color         string  `json:"color"`
	IdleBob   float64 `json:"idleBob"`
	IdlePitch float64 `json:"idlePitch"`
	IdleRoll  float64 `json:"idleRoll"`
	UpdatedAt int64   `json:"updatedAt"`
}

var PlayerColors = []string{
	"#ff9060", // オレンジ
	"#60a0ff", // 青
	"#e070e0", // 紫
	"#fff040", // 黄
	"#ff6070", // 赤
	"#50e0e0", // シアン
	"#ffa0b0", // ピンク
	"#a080ff", // インディゴ
	"#e0a050", // ブラウン
	"#80ff80", // ライトグリーン
}

type RoomSnapshot struct {
	RoomID  string        `json:"roomId"`
	Version int64         `json:"version"`
	Players []PlayerState `json:"players"`
}
