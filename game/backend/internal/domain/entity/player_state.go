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

// 高彩度・色相を広く振った10色（青系はワニ本体と区別しづらいため含めない）
var PlayerColors = []string{
	"#E53935", // 赤
	"#43A047", // 緑
	"#F9A825", // アンバー黄（白飛びしにくい）
	"#8E24AA", // 紫
	"#FB8C00", // オレンジ
	"#C0CA33", // ライム
	"#EC407A", // ピンク
	"#6D4C41", // 茶
	"#AD1457", // マゼンタ
	"#558B2F", // オリーブ緑
}

type RoomSnapshot struct {
	RoomID  string        `json:"roomId"`
	Version int64         `json:"version"`
	Players []PlayerState `json:"players"`
}
