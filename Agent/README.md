# Motion Dile Agent Server

ゲームサーバーからプレイヤー情報を受け取り、**Amazon Bedrock**（既定: Claude 3 Haiku 等の低コストモデル）または任意で **OpenAI** のチャット API で「敵ワニ」のヒントを生成する独立マイクロサービス。API 未使用時はルールベースのフォールバックのみ。

## アーキテクチャ

```
Agent/
├── cmd/server/main.go              # エントリポイント
├── internal/
│   ├── config/config.go            # .env 読み込み・設定管理
│   ├── contract/                   # リクエストバリデーション
│   ├── domain/types.go             # リクエスト/レスポンスの型定義
│   ├── infrastructure/bedrock/     # Amazon Bedrock InvokeModel（Claude Messages）
│   ├── infrastructure/openai/      # 任意: OpenAI Chat Completions（フォールバック用）
│   │   └── client.go
│   ├── interface/http/             # HTTP ハンドラ（インターフェース層）
│   │   ├── handler.go              # POST /hint
│   │   └── theme_handler.go        # POST /themes
│   ├── compose/                    # プロンプト・候補・テンプレ合成
│   ├── llm/                        # LLM クライアント抽象（PromptInput）
│   ├── ops/                        # ヒント履歴（部屋単位）
│   └── usecase/                    # ビジネスロジック（ユースケース層）
│       ├── hint_usecase.go         # ヒント生成（LLM + テンプレフォールバック）
│       └── theme_usecase.go        # 行動テーマ生成（POST /themes）
├── .env                            # 環境変数（AWS_REGION / BEDROCK_MODEL_ID 等）
├── go.mod
└── go.sum
```

### 責務分離

| レイヤー | 責務 |
|---------|------|
| **domain** | サーバー間で受け渡すデータ構造の定義 |
| **infrastructure/bedrock** | **Bedrock InvokeModel**（Claude 系 Messages API） |
| **infrastructure/openai** | 任意: OpenAI Chat Completions |
| **usecase** | プロンプト構築、ヒント生成ロジック、フォールバック |
| **interface/http** | HTTP エンドポイント、リクエストバリデーション |
| **config** | .env の読み込みと設定値管理 |

## 技術スタック

- **Go** (net/http)
- **Amazon Bedrock**（既定モデル: `anthropic.claude-3-haiku-20240307-v1:0`）— オンデマンド従量、**コスト重視**の設定
- 任意: **OpenAI API** (gpt-4o-mini) — `OPENAI_API_KEY` かつ Bedrock 未使用時
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
    │ compose（LLM / テンプレ）でヒント文を生成
    ▼
infrastructure/bedrock/client.go（優先）または openai/client.go
    │ ChatCompletion(system, user)
    ▼
Amazon Bedrock または OpenAI API
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

# Bedrock（ローカル検証）: AWS 認証情報 + リージョン。コンソールでモデルアクセスを有効化すること。
export AWS_REGION=ap-northeast-1
# 省略時は Claude 3 Haiku が既定（config.DefaultBedrockModel）

# ローカル開発（ホットリロード）— 推奨
air -c .air.toml

# 単発実行（Bedrock 無効で OpenAI のみ: BEDROCK_DISABLED=1 と OPENAI_API_KEY）
# go run ./cmd/server
```

ECS では Terraform が **`AWS_REGION`**・**`BEDROCK_MODEL_ID`** を渡し、タスクロールに **`bedrock:InvokeModel`** を付与する。

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

ヘルスチェック。JSON で `mode`（`bedrock` / `openai` / `fallback`）、`bedrockModel`、`bedrockConfigured` などを返す。

## プロンプト設計

- **序盤（hint 1〜2）:** 曖昧なヒント。エリア名やおおまかな行動のみ
- **終盤（hint 3〜）:** より具体的な位置や近くのプレイヤー情報を含む
- 敵プレイヤーの名前を直接言及しない（ゲームバランス維持）
- フォールバック: Bedrock / OpenAI 障害時や未設定時はルールベースで静的ヒントを生成

## 環境変数

| 変数 | 説明 | デフォルト |
|------|------|-----------|
| `AWS_REGION` | Bedrock を使うリージョン | 未設定なら Bedrock クライアントは作らない |
| `BEDROCK_MODEL_ID` | Bedrock のモデル ID | `AWS_REGION` のみある場合はコード既定で **Claude 3 Haiku** |
| `BEDROCK_DISABLED` | `1` / `true` で Bedrock を使わない | 空 |
| `OPENAI_API_KEY` | 任意: Bedrock が無い／無効時の OpenAI（gpt-4o-mini） | 空ならヒント・テーマはテンプレ／ローカル抽選中心（開発可） |
| `AGENT_PORT` | サーバーポート | `8091` |

## ゲームサーバーとの連携

ゲームサーバー側で `AGENT_URL` 環境変数を設定:

```bash
AGENT_URL=http://127.0.0.1:8091 air -c .air.toml
```
