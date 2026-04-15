package contract

import (
	"fmt"
	"math"
	"strings"

	"agent/internal/domain"
)

// ValidationIssue は、どの入力項目に問題があるかを表します。
// field と message を分けておくと、ログ出力や将来の API 拡張で再利用しやすくなります。
type ValidationIssue struct {
	Field   string
	Message string
}

func (i ValidationIssue) String() string {
	if i.Field == "" {
		return i.Message
	}
	return fmt.Sprintf("%s: %s", i.Field, i.Message)
}

// ValidationError は複数の入力不備をまとめて返すためのエラーです。
// 1 回のリクエストで見つかった問題をすべて返した方が、修正とデバッグがしやすくなります。
type ValidationError struct {
	Issues []ValidationIssue
}

func (e *ValidationError) Error() string {
	parts := make([]string, 0, len(e.Issues))
	for _, issue := range e.Issues {
		parts = append(parts, issue.String())
	}
	return strings.Join(parts, "; ")
}

func (e *ValidationError) HasIssues() bool {
	return len(e.Issues) > 0
}

func (e *ValidationError) Add(field, message string) {
	e.Issues = append(e.Issues, ValidationIssue{
		Field:   field,
		Message: message,
	})
}

// ValidateHintRequest は /hint の入力契約を検証します。
//
// contract 層では「ヒントをどう作るか」は扱わず、
// Agent がこの入力を安全に処理してよいかだけを判断します。
func ValidateHintRequest(req domain.HintRequest) error {
	validationErr := &ValidationError{}

	validateRequestMeta(req, validationErr)
	validatePlayers(req.Players, validationErr)
	validateLandmarks(req.Landmarks, validationErr)

	if !validationErr.HasIssues() {
		return nil
	}
	return validationErr
}

func validateRequestMeta(req domain.HintRequest, issues *ValidationError) {
	if strings.TrimSpace(req.RoomID) == "" {
		issues.Add("roomId", "空にできません")
	}
	if req.HintNumber < 1 {
		issues.Add("hintNumber", "1以上である必要があります")
	}
	if req.GameDuration <= 0 {
		issues.Add("gameDuration", "0より大きい必要があります")
	}
	if req.ElapsedSec < 0 {
		issues.Add("elapsedSec", "0以上である必要があります")
	}
	if req.GameDuration > 0 && req.ElapsedSec > req.GameDuration {
		issues.Add("elapsedSec", "gameDuration を超えてはいけません")
	}
	if !isFinite(req.MapRadius) {
		issues.Add("mapRadius", "有限の数値である必要があります")
	}
	if req.MapRadius < 0 {
		issues.Add("mapRadius", "0以上である必要があります")
	}
}

func validatePlayers(players []domain.PlayerInfo, issues *ValidationError) {
	if len(players) == 0 {
		issues.Add("players", "1件以上必要です")
		return
	}

	enemyCount := 0
	for i, player := range players {
		fieldPrefix := fmt.Sprintf("players[%d]", i)

		if strings.TrimSpace(player.PlayerID) == "" {
			issues.Add(fieldPrefix+".playerId", "空にできません")
		}

		validateFiniteCoordinate(fieldPrefix+".x", player.X, issues)
		validateFiniteCoordinate(fieldPrefix+".y", player.Y, issues)
		validateFiniteCoordinate(fieldPrefix+".z", player.Z, issues)
		validateFiniteCoordinate(fieldPrefix+".rotationY", player.RotationY, issues)
		validateFiniteCoordinate(fieldPrefix+".mouthOpenness", player.MouthOpenness, issues)

		if player.MouthOpenness < 0 || player.MouthOpenness > 1 {
			issues.Add(fieldPrefix+".mouthOpenness", "0以上1以下である必要があります")
		}

		if player.IsEnemy {
			enemyCount++
		}
	}

	if enemyCount > 1 {
		issues.Add("players", "敵プレイヤーは最大1人までです")
	}
}

func validateLandmarks(landmarks []domain.LandmarkInfo, issues *ValidationError) {
	for i, landmark := range landmarks {
		fieldPrefix := fmt.Sprintf("landmarks[%d]", i)
		validateFiniteCoordinate(fieldPrefix+".x", landmark.X, issues)
		validateFiniteCoordinate(fieldPrefix+".z", landmark.Z, issues)
	}
}

func validateFiniteCoordinate(field string, value float64, issues *ValidationError) {
	if !isFinite(value) {
		issues.Add(field, "有限の数値である必要があります")
	}
}

func isFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}
