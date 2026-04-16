package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"strings"
	"unicode/utf8"

	"agent/internal/domain"
	"agent/internal/llm"
)

type ThemeUsecase struct {
	llmClient llm.Client
}

type themeLLMResponse struct {
	AllyTheme  string `json:"allyTheme"`
	EnemyTheme string `json:"enemyTheme"`
}

func NewThemeUsecase(llmClient llm.Client) *ThemeUsecase {
	return &ThemeUsecase{llmClient: llmClient}
}

func (u *ThemeUsecase) Generate(ctx context.Context, req domain.ThemeRequest) (domain.ThemeResponse, error) {
	if u.llmClient == nil {
		return fallbackThemes(req.PlayerCount), nil
	}

	input := llm.PromptInput{
		System: themeSystemPrompt,
		User:   buildThemePrompt(req),
	}

	raw, err := u.llmClient.Generate(ctx, input)
	if err != nil {
		return fallbackThemes(req.PlayerCount), nil
	}

	resp, err := parseThemeResponse(raw)
	if err != nil {
		return fallbackThemes(req.PlayerCount), nil
	}

	if err := validateGeneratedThemes(req.PlayerCount, resp); err != nil {
		return fallbackThemes(req.PlayerCount), nil
	}

	return domain.ThemeResponse{
		AllyTheme:  strings.TrimSpace(resp.AllyTheme),
		EnemyTheme: strings.TrimSpace(resp.EnemyTheme),
	}, nil
}

const themeSystemPrompt = `あなたはマルチプレイのジェスチャー推理ゲーム「WaniAR」で使う行動テーマ設計AIです。

## ゲームの説明
プレイヤーはワニキャラクターを操作する。全員に「行動テーマ」が与えられ、
市民チームは同じテーマ、敵（1人）だけ別テーマで動く。
観察者は動きの違いから敵を見つける。テーマは「どう動くか」の指示。

## ワニができる動作（観察可能な行動の全リスト）
- 走る: 高速移動。移動量・軌跡が大きく目立つ
- 歩く: 低速移動。ゆっくり移動する
- 止まる（idle）: 静止状態。動きがほぼない
- 口を開ける: 手ジェスチャーで制御。他のプレイヤーから見える
- ジャンプ: 上方向に跳ぶ。特徴的な動き
- 尻尾を振る: 尻尾フリフリのアニメーション
- 攻撃: 短く鋭い攻撃モーション

## フィールドの構成
- 円形マップ（島）。外周に壁がある
- ゾーン: 中央・中間・外周の3層
- ランドマーク: 岩（複数）、木（複数）が配置されている
- 水際: マップ端（外周ゾーン）に水辺がある
- 開けた地帯: マップ中央付近は遮蔽物が少なく動きが目立つ

## 良いテーマペアの条件（必ず守ること）
1. 観察可能: 他のプレイヤーが見て違いに気づける差が出る
2. 実行可能: 上の動作リスト・フィールド要素のみを使う
3. 対称的な難易度: 市民も敵も難しすぎず見破られにくい
4. 差別化: 2つのテーマは行動・場所・パターンで明確に異なる
5. 短さ: 1テーマ32文字以内の日本語

## テーマの種類（カテゴリ）
- 移動スピード系: 走る/歩く/止まるの組み合わせ
- 口の動き系: 口を開ける行動を一方のテーマに組み込む
- ランドマーク系: 岩や木に近づく/近づかないで差を出す
- ゾーン系: 中央にいる/外周寄りにいるで差（少人数では使わない）
- ジャンプ系: ジャンプを組み込む/組み込まないで差を出す
- 密集・距離系: 他プレイヤーに近づく/距離を保つ
- 複合系: 移動＋口、ランドマーク＋ジャンプなど2要素の掛け合わせ

## テーマペアの具体例（参考）
例1: {"allyTheme":"歩きながら口を開けて動こう","enemyTheme":"走りながら口は閉じて動こう"}
例2: {"allyTheme":"岩の近くを意識して歩こう","enemyTheme":"木の近くを意識して歩こう"}
例3: {"allyTheme":"走りと止まりを交互に繰り返そう","enemyTheme":"ゆっくり歩き続けよう"}
例4: {"allyTheme":"ときどきジャンプしながら動こう","enemyTheme":"ジャンプせずに歩き回ろう"}
例5: {"allyTheme":"誰かの近くをキープして動こう","enemyTheme":"少し間を空けて動こう"}
例6: {"allyTheme":"尻尾を振りながら動こう","enemyTheme":"口を開けながら動こう"}

## 出力形式（厳守）
必ず日本語のJSONのみを返してください。
形式は {"allyTheme":"...", "enemyTheme":"..."} のみです。
余計な説明、コードブロック、役職名、理由文は一切禁止です。
二つのテーマは必ず異なる内容にしてください。`

func buildThemePrompt(req domain.ThemeRequest) string {
	return fmt.Sprintf(`プレイヤー人数: %d人

設計方針:
%s

今回おすすめのテーマカテゴリ:
%s

必須条件:
- 市民側と敵側で必ず異なる2つのテーマを返す
- どちらも短い日本語の行動テーマにする（各32文字以内）
- その人数でバランスが崩れないようにする
- 片方だけ極端にわかりやすすぎるテーマにしない
- 「市民」「敵」「人狼」「少数派」「多数派」など役割を示す語は禁止
- 余計な説明は書かずJSONのみ返す

良いテーマの方向性:
- ワニができる動作（走る/歩く/口/ジャンプ/尻尾/攻撃）を直接参照する
- フィールド要素（岩・木・中央・外周・水際）を具体的に参照してもよい
- すぐに一人へ絞れすぎず、それでも行動差は出る内容
- ゲームに存在しない行動（泳ぐ・飛ぶ・隠れるなど）は禁止

避けたいテーマ:
- 少人数で「外周を回ろう」のように露骨すぎる広域位置テーマ
- 何をすればよいか曖昧すぎる抽象テーマ（「自由に動こう」「好きに動こう」など）
- 二つが似すぎて差が出ない組み合わせ`, req.PlayerCount, themeDesignBrief(req.PlayerCount), themeCategorySuggestion(req.PlayerCount))
}

func themeDesignBrief(playerCount int) string {
	switch {
	case playerCount <= 3:
		return "- 少人数なので露骨な外周・端・中央固定のテーマは避ける\n- 密集や向き、口の動きなど近距離で差が出るテーマを優先する\n- 二つのテーマは subtle に差が出る組み合わせにする"
	case playerCount <= 5:
		return "- 中人数なので位置と行動を適度に混ぜて差が出るようにする\n- 片方だけ単純すぎるテーマにしない\n- 密集系とやや分散系、あるいは向きと口の動きなどバランスを取る"
	default:
		return "- 多人数なので少し広い位置テーマや分散テーマも使ってよい\n- ただし一目で敵が確定するほど極端にしない\n- 群れを作るテーマと少し散るテーマのように、全体の見え方に差が出る組み合わせにする"
	}
}

func themeCategorySuggestion(playerCount int) string {
	switch {
	case playerCount <= 3:
		return "口の動き系・ジャンプ系・移動スピード系・ランドマーク系を優先\n（ゾーン系・外周系は少人数では露骨になるため禁止）"
	case playerCount <= 5:
		return "移動スピード系・口の動き系・ランドマーク系・複合系がバランスよい\nゾーン系は単独ではなく別要素と組み合わせる"
	default:
		return "ゾーン系・密集距離系・ランドマーク系・複合系など幅広く使える\n群れを作るテーマと散らばるテーマのように全体の見え方に差が出る組み合わせも可"
	}
}

func parseThemeResponse(raw string) (themeLLMResponse, error) {
	var parsed themeLLMResponse
	text := strings.TrimSpace(raw)
	if strings.HasPrefix(text, "```") {
		text = strings.TrimPrefix(text, "```json")
		text = strings.TrimPrefix(text, "```")
		text = strings.TrimSuffix(text, "```")
		text = strings.TrimSpace(text)
	}

	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start >= 0 && end > start {
		text = text[start : end+1]
	}

	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		return themeLLMResponse{}, err
	}
	return parsed, nil
}

var actionWords = []string{
	"走", "歩", "止まり", "静止", "口", "ジャンプ", "跳", "尻尾", "攻撃",
}

var locationWords = []string{
	"岩", "木", "中央", "外周", "水際", "壁際", "岸",
	"近く", "離れ", "散ら", "まとまり", "群れ",
}

func containsActionOrLocationWord(theme string) bool {
	for _, w := range actionWords {
		if strings.Contains(theme, w) {
			return true
		}
	}
	for _, w := range locationWords {
		if strings.Contains(theme, w) {
			return true
		}
	}
	return false
}

func validateGeneratedThemes(playerCount int, resp themeLLMResponse) error {
	ally := strings.TrimSpace(resp.AllyTheme)
	enemy := strings.TrimSpace(resp.EnemyTheme)

	if ally == "" || enemy == "" {
		return fmt.Errorf("themes must not be empty")
	}
	if normalizeTheme(ally) == normalizeTheme(enemy) {
		return fmt.Errorf("themes must differ")
	}
	if utf8.RuneCountInString(ally) > 32 || utf8.RuneCountInString(enemy) > 32 {
		return fmt.Errorf("themes are too long")
	}

	for _, banned := range []string{"市民", "敵", "人狼", "多数派", "少数派", "ally", "enemy"} {
		if strings.Contains(ally, banned) || strings.Contains(enemy, banned) {
			return fmt.Errorf("themes contain banned role word")
		}
	}

	if !containsActionOrLocationWord(ally) && !containsActionOrLocationWord(enemy) {
		return fmt.Errorf("themes are too abstract: no action or location words found")
	}

	if playerCount <= 3 {
		if isTooObviousForSmallParty(ally) || isTooObviousForSmallParty(enemy) {
			return fmt.Errorf("themes are too obvious for small party")
		}
	} else if playerCount <= 5 {
		if isTooObviousForMediumParty(ally) || isTooObviousForMediumParty(enemy) {
			return fmt.Errorf("themes are too obvious for medium party")
		}
	}

	return nil
}

func isTooObviousForSmallParty(theme string) bool {
	obviousWords := []string{
		"外周", "端", "中央固定", "水際", "壁際だけ",
		"外側", "端っこ", "一人だけ", "一人で動", "誰とも近づかない",
	}
	for _, word := range obviousWords {
		if strings.Contains(theme, word) {
			return true
		}
	}
	return false
}

func isTooObviousForMediumParty(theme string) bool {
	obviousWords := []string{"外周", "壁際だけ", "端だけ", "中央から動かない"}
	for _, word := range obviousWords {
		if strings.Contains(theme, word) {
			return true
		}
	}
	return false
}

func normalizeTheme(s string) string {
	replacer := strings.NewReplacer(" ", "", "　", "", "、", "", "。", "", "・", "")
	return strings.ToLower(replacer.Replace(strings.TrimSpace(s)))
}

// fallbackThemePair はフォールバック用のテーマペアです。
type fallbackThemePair struct {
	ally       string
	enemy      string
	minPlayers int // このペアが適切な最小プレイヤー数
}

var fallbackThemePool = []fallbackThemePair{
	// 移動スピード系（全人数）
	{ally: "歩きながら移動しよう", enemy: "走りながら移動しよう", minPlayers: 2},
	{ally: "走りと止まりを交互に繰り返そう", enemy: "ゆっくり歩き続けよう", minPlayers: 2},
	{ally: "ゆっくり歩いて動こう", enemy: "ときどき静止を混ぜながら動こう", minPlayers: 2},
	// 口の動き系（全人数）
	{ally: "口を開けながら動こう", enemy: "口を閉じたまま動こう", minPlayers: 2},
	{ally: "歩きながら口を開けて動こう", enemy: "走りながら口は閉じて動こう", minPlayers: 2},
	// ジャンプ系（全人数）
	{ally: "ときどきジャンプしながら動こう", enemy: "ジャンプせずに歩き回ろう", minPlayers: 2},
	{ally: "ジャンプを混ぜながら歩こう", enemy: "口を開けながら歩こう", minPlayers: 2},
	// 尻尾系（全人数）
	{ally: "尻尾を振りながら動こう", enemy: "口を開けながら動こう", minPlayers: 2},
	// ランドマーク系（全人数）
	{ally: "岩の近くを意識して動こう", enemy: "木の近くを意識して動こう", minPlayers: 2},
	{ally: "岩や木に近づきながら動こう", enemy: "ランドマークから離れて動こう", minPlayers: 2},
	// 密集・距離系（3人以上）
	{ally: "誰かの近くをキープして動こう", enemy: "少し間を空けて動こう", minPlayers: 3},
	{ally: "他のプレイヤーの近くを意識して動こう", enemy: "口の動きを少し混ぜながら動こう", minPlayers: 3},
	{ally: "誰かの近くを保ちながら動こう", enemy: "尻尾を振りながら動こう", minPlayers: 3},
	// ゾーン+行動複合（4人以上）
	{ally: "中央付近で歩き回ろう", enemy: "外周寄りで動こう", minPlayers: 4},
	{ally: "中央付近でジャンプを混ぜながら動こう", enemy: "外周寄りで歩き続けよう", minPlayers: 4},
	// 複合系（5人以上）
	{ally: "誰かの近くで口を開けながら動こう", enemy: "少し離れてジャンプを混ぜながら動こう", minPlayers: 5},
	{ally: "二人以上のまとまりを意識して動こう", enemy: "尻尾を振りながら少し散らばって動こう", minPlayers: 5},
	// 多人数用（6人以上）
	{ally: "群れを意識して走ろう", enemy: "岩の近くでゆっくり歩こう", minPlayers: 6},
}

func fallbackThemes(playerCount int) domain.ThemeResponse {
	eligible := make([]fallbackThemePair, 0, len(fallbackThemePool))
	for _, pair := range fallbackThemePool {
		if playerCount >= pair.minPlayers {
			eligible = append(eligible, pair)
		}
	}

	if len(eligible) == 0 {
		return domain.ThemeResponse{
			AllyTheme:  "歩きながら移動しよう",
			EnemyTheme: "走りながら移動しよう",
		}
	}

	chosen := eligible[rand.Intn(len(eligible))]
	return domain.ThemeResponse{
		AllyTheme:  chosen.ally,
		EnemyTheme: chosen.enemy,
	}
}
