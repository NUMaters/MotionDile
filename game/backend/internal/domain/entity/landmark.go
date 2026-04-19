package entity

// Landmark はヒント API 用のマップ上ランドマーク（クライアントから送信）。
type Landmark struct {
	Type string  `json:"type"`
	X    float64 `json:"x"`
	Z    float64 `json:"z"`
}
