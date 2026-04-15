# Agent Implementation Memo

## Overview
今回の `Agent` は、ヒント生成処理を責務ごとに分離したパイプライン構成へ整理した。

全体の流れ:

`contract -> evidence -> policy -> composer -> response`

backend は引き続き
- ゲーム進行
- タイマー
- ヒント発火タイミング
- 投票

を担当し、Agent はヒント生成専用として動く。

## Current Policy

### Hint Strength
- `ElapsedSec < 30` -> 小ヒント
- `30 <= ElapsedSec < 45` -> 中ヒント
- `45 <= ElapsedSec` -> 強ヒント

backend の現行仕様は 60 秒ゲーム、15 秒ごとのヒントなので、実運用は以下。
- 15 秒付近で小ヒント
- 30 秒付近で中ヒント
- 45 秒付近で強ヒント

### hint1
- 主軸: `movement`
- 使う: `MotionKind`, `MouthOpen`
- 補助で使う: 粗い位置だけ
- 使わない: `Jump`, 強い `relation`, 詳しすぎる位置
- 目的: 最初は動きの違和感を感じさせる

### hint2
- 主軸: `movement`
- 補助: `location`, `facing`
- 使う: `MotionKind`, `MouthOpen`, `Jump`, `Facing`, `Zone`, `NearWall`, `NearbyLandmark`
- `relation` は中程度で使う
- `theme mismatch` を使い始める
- 目的: 行動に位置特徴を足して絞り込みやすくする

### hint3+
- 主軸: `location` または `movement`
- 補助: `relation`, `facing`
- 使う: 行動 + 位置 + 向き + 関係性
- `theme mismatch` を維持
- 禁止: 名前、色、数値距離、個人特定に近い情報
- 目的: 推理材料を十分にするが、即バレは防ぐ

## 1. Contract

### Role
`/hint` に入る入力が安全に使えるか検証する。

### Implemented
- `HintRequest` の妥当性検証を追加
- `roomId`, `hintNumber`, `gameDuration`, `elapsedSec`, `mapRadius`, `players`, `mouthOpenness` を検証
- `enemy` が複数いないか確認
- HTTP handler で `DisallowUnknownFields()` を使い、未知の JSON field を拒否

### Goal
- 壊れた入力を後段へ流さない
- usecase 以降を「検証済み入力」前提で実装できるようにする

## 2. Evidence

### Role
backend から来た生データを、ヒント判断に使える事実へ変換する。

### Implemented
- `BuildHintEvidence(req)` を追加

### Extracted Facts
- `ZoneEvidence`
- `MotionEvidence`
- `FacingDirection`
- `EnvironmentEvidence`
- `NearestCitizen`
- `EnemyIsIsolated`

### Main Facts
- 外周 / 中間 / 中央
- 北寄り / 南寄り / 東寄り / 西寄り
- `run / walk / idle / attack / tailwag`
- mouth open
- jump
- near wall
- nearby landmark
- nearest citizen
- isolated

### Goal
- 「事実」と「表現」を分離する
- policy が evidence を見て判断できるようにする

## 3. Policy

### Role
`HintEvidence` を見て、どんなヒントにするか決める。

### Implemented
- `HintPolicy`
- `BuildHintPolicy(ev)`

### Main Fields
- `Action`
- `Specificity`
- `PrimaryFocus`
- `Signals`
- `Composer`

### Signals
- `UseZone`
- `UseMotion`
- `UseMouth`
- `UseAirborne`
- `UseFacing`
- `UseRelation`
- `UseLandmark`
- `UseNearWall`
- `UseThemeMismatch`

### Current Rules
- 強さは `HintNumber` ではなく `ElapsedSec` ベース
- 初期主軸は `movement`
- 高具体度で位置特徴が強いと `location` に寄せる
- `facing` は強い特徴がある時だけ使う
- `relation` は序盤では使わない
- `allyTheme` と `enemyTheme` が両方あると `theme mismatch` を使える

### Goal
- LLM 任せにせず、ヒント強度と利用可能情報を制御する

## 4. Composer

### Role
policy が許可した情報だけを使って最終ヒント文を作る。

### Implemented
Composer を 2 種類に分離した。

#### Template Composer
- deterministic に短いヒント文を組み立てる
- fallback として使う
- LLM 障害時でも必ず動く

#### LLM Composer
- prompt を組み立てて LLM に渡す
- 自然な日本語ヒントを生成する

### Refactoring
旧 `prompt.go` の役割は分解して Composer 側へ移した。
- `prompt_builder`
- `format`
- `llm composer`

### Goal
- 表現生成を専用責務として切り出す
- template / llm を差し替え可能にする

## 5. Theme Mismatch

### Role
市民テーマと敵テーマのズレをヒント素材として使うための signal。

### Implemented
- `HintRequest` に `allyTheme`, `enemyTheme` を追加
- policy に `UseThemeMismatch` を追加
- prompt に「市民側の流れと噛み合わない行動」を示唆する材料を追加
- template fallback でも `周囲と噛み合わない` を残すようにした

### Note
現時点ではテーマ整合性を厳密解析しているわけではない。  
まずは「テーマ差分をヒントに使う足場」を作った段階。

## 6. LLM Abstraction

### Role
将来 OpenAI から AWS Bedrock へ差し替えやすくする。

### Implemented
- `internal/llm/client.go` を追加
- `llm.Client` interface を定義
- `PromptInput { System, User }` を定義
- OpenAI client を `llm.Client` 実装に変更

### Effect
- usecase や composer が OpenAI 固有実装に依存しなくなった
- 将来 Bedrock client を追加しやすい

## 7. Usecase

### Before
- OpenAI 呼び出し
- prompt 構築
- fallback

を自分で持っていた。

### Now
- `evidence.BuildHintEvidence`
- `policy.BuildHintPolicy`
- `llmComposer.Compose`
- 失敗時 `templateComposer.Compose`

のみを行うオーケストレーション層になった。

## 8. Startup Wiring

現在の組み立て:
- OpenAI client
- LLM Composer
- Template Composer
- HintUsecase
- HTTP Handler

これにより
- provider
- composer
- usecase

の境界が明確になった。

## 9. Tests

### Covered
- contract test
- evidence test
- policy test
- compose/template test
- compose/llm test
- http handler test

### Command
```bash
go test -count=1 ./...
```

現時点では通過している。

## 10. Final Summary

今回の実装で、`Agent` は
- OpenAI 直結の単一ヒント生成処理

から

- `contract -> evidence -> policy -> composer`

で動く責務分離パイプラインへ移行した。

さらに、
- template / llm の分離
- `llm.Client` interface の導入

により、将来的な AWS Bedrock 移行を見据えた構成になった。

## Short Version
- `contract`: `/hint` 入力検証を追加
- `evidence`: プレイヤー状態を構造化
- `policy`: 秒数ベースで小/中/強ヒントと使用 signal を決定
- `composer`: template と llm に分離
- `theme mismatch`: テーマ差分を示唆する signal を追加
- `llm.Client`: provider 非依存 interface を追加
- `openai.Client`: `llm.Client` 実装へ変更
- `usecase`: orchestrator に縮小
- `go test -count=1 ./...` 通過
