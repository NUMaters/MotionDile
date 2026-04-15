package usecase

import "math/rand"

var behaviorThemes = []string{
	"障害物（岩や木）の近くを移動しよう",
	"マップの外周を歩き回ろう",
	"中央エリアにいよう",
	"すばやく走って移動しよう",
	"ゆっくり歩いて移動しよう",
	"口を開けて行動しよう",
	"他のプレイヤーの近くにいよう",
	"他のプレイヤーから離れて動こう",
	"ジャンプを多めに使おう",
	"北側エリアにいよう",
	"南側エリアにいよう",
	"なるべく同じ方向を見続けよう",
	"壁際を移動しよう",
	"岩の上や近くにいよう",
}

// PickThemes は味方テーマと敵テーマをランダムに1つずつ選ぶ（重複なし）。
func PickThemes() (allyTheme, enemyTheme string) {
	n := len(behaviorThemes)
	if n < 2 {
		return "周囲を見ながら自由に動こう", "周囲を見ながら自由に動こう"
	}
	i := rand.Intn(n)
	j := rand.Intn(n - 1)
	if j >= i {
		j++
	}
	return behaviorThemes[i], behaviorThemes[j]
}
