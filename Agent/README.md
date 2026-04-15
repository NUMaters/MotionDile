# WaniAR Agent Server

ゲームサーバーからプレイヤー情報を受け取り、OpenAI API を使って「敵ワニ」のヒントを生成する独立マイクロサービス。

## アーキテクチャ

```
Agent/
├── cmd/server/main.go              # エントリポイント
├── internal/
│   ├── config/config.go            # .env 読み込み・設定管理
│   ├── contract/                   # リクエストバリデーション
│   ├── domain/types.go             # リクエスト/レスポンスの型定義
│   ├── infrastructure/openai/      # OpenAI API クライアント（インフラ層）
│   │   └── client.go
│   ├── interface/http/             # HTTP ハンドラ（インターフェース層）
│   │   └── handler.go
│   └── usecase/                    # ビジネスロジック（ユースケース層）
│       ├── hint_usecase.go         # ヒント生成のメインロジック
│       └── prompt.go              # プロンプトエンジニアリング
├── .env                            # 環境変数（OPENAI_API_KEY）
├── go.mod
└── go.sum
```

### 責務分離

| レイヤー | 責務 |
|---------|------|
| **domain** | サーバー間で受け渡すデータ構造の定義 |
| **infrastructure/openai** | OpenAI Chat Completions API との通信 |
| **usecase** | プロンプト構築、ヒント生成ロジック、フォールバック |
| **interface/http** | HTTP エンドポイント、リクエストバリデーション |
| **config** | .env の読み込みと設定値管理 |

## 技術スタック

- **Go** (net/http)
- **OpenAI API** (gpt-4o-mini) — 高速・低コストなヒント生成
- クリーンアーキテクチャ（ドメイン駆動設計）

## データフロー

```
ゲームサーバー (gateway.go)
    │ POST /hint
    │ { roomId, hintNumber, gameDuration, elapsedSec, players[] }
    ▼
Agent Server (handler.go)
    │
    ▼
usecase/hint_usecase.go
    │ buildUserPrompt() でプレイヤー情報を整形
    ▼
infrastructure/openai/client.go
    │ ChatCompletion(system, user)
    ▼
OpenAI API (gpt-4o-mini)
    │
    ▼
Agent Server → { "text": "通報: 北エリアで不審な走行を確認…" }
    │
    ▼
ゲームサーバー → WebSocket broadcast → 全クライアント
```

## セットアップ

```bash
cd Agent

# .env に OpenAI API キーを設定
echo "OPENAI_API_KEY=sk-your-key-here" > .env

# 起動
go run ./cmd/server
```

## API

### POST /hint

ゲームサーバーから呼ばれるヒント生成エンドポイント。

**リクエスト:**
```json
{
  "roomId": "room-1",
  "hintNumber": 1,
  "gameDuration": 30,
  "elapsedSec": 10,
  "players": [
    {
      "playerId": "p1",
      "displayName": "Alice",
      "x": 2.5, "y": 0, "z": -4.0,
      "rotationY": 90,
      "animation": "Run",
      "color": "#ff6b6b",
      "isEnemy": false
    },
    {
      "playerId": "p2",
      "displayName": "Bob",
      "x": -1.0, "y": 0, "z": 3.5,
      "rotationY": 180,
      "animation": "Walk",
      "color": "#4ecdc4",
      "isEnemy": true
    }
  ]
}
```

**レスポンス:**
```json
{
  "text": "北エリアで不審な歩行者を確認。警戒レベルを上げよ"
}
```

### GET /health

ヘルスチェック。`ok` を返す。

## プロンプト設計

- **序盤（hint 1〜2）:** 曖昧なヒント。エリア名やおおまかな行動のみ
- **終盤（hint 3〜）:** より具体的な位置や近くのプレイヤー情報を含む
- 敵プレイヤーの名前を直接言及しない（ゲームバランス維持）
- フォールバック: OpenAI API 障害時はルールベースで静的ヒントを生成

## 環境変数

| 変数 | 説明 | デフォルト |
|------|------|-----------|
| `OPENAI_API_KEY` | OpenAI API キー | (必須) |
| `AGENT_PORT` | サーバーポート | `8091` |

## ゲームサーバーとの連携

ゲームサーバー側で `AGENT_URL` 環境変数を設定:

```bash
AGENT_URL=http://127.0.0.1:8091 go run ./cmd/server/main.go
```
