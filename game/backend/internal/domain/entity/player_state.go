package entity

type PlayerState struct {
	PlayerID  string  `json:"playerId"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	Z         float64 `json:"z"`
	RotationY float64 `json:"rotationY"`
	NeckYaw   float64 `json:"neckYaw"`
	NeckPitch float64 `json:"neckPitch"`
	Animation string  `json:"animation"`
	UpdatedAt int64   `json:"updatedAt"`
}

type RoomSnapshot struct {
	RoomID  string        `json:"roomId"`
	Version int64         `json:"version"`
	Players []PlayerState `json:"players"`
}
