# game/backend

Gin で実装したゲーム同期バックエンドです。  
REST API は部屋/プレイヤー管理、WebSocket は部屋内の移動同期を担当します。

## アーキテクチャ（Clean Architecture）

- `internal/domain/entity`: ドメインモデル（`PlayerState`, `RoomSnapshot`）
- `internal/domain/repository`: リポジトリ境界（インターフェース）
- `internal/usecase`: ビジネスルール（Join/Move/Leave/Snapshot）
- `internal/infrastructure/memory`: インメモリ実装（スレッドセーフ）
- `internal/interface/http`: REST ハンドラ（入出力変換）
- `internal/interface/ws`: WebSocket ゲートウェイ（接続管理/配信）
- `cmd/server`: エントリポイントとルーティング

## REST API

- `GET /healthz` — ヘルスチェック
- `POST /api/v1/rooms/resolve` — 待機中の部屋を検索・割り当て（なければ新規作成）
  - body: `{ "preferredRoomId": "", "excludeRoomId": "" }`
- `POST /api/v1/rooms/:roomID/players` — 部屋に参加
  - body: `{ "playerId": "p1", "displayName": "Alice" }`
- `GET /api/v1/rooms/:roomID/snapshot` — 部屋のスナップショット取得
- `DELETE /api/v1/rooms/:roomID/players/:playerID` — 退出

## 敵ワニ（敵陣営）の抽選

- ラウンド開始時（`startGame`）、当該部屋の WebSocket 接続者から **重複のない `playerId` 一覧**を作り、その中から **1 人を敵**に選ぶ。
- 抽選インデックスは **`crypto/rand`**（失敗時のみ `math/rand` にフォールバック）。参加者 ID は **`sort.Strings` でソートした順**に並べたうえでインデックス指定するため、マップ走査順に依存しない。
- **同一ブラウザで複数タブを開いた場合**は `localStorage` の `playerId` が共有されるため、論理プレイヤーは 1 人扱いになり、敵候補も 1 人だけになる（常にそのプレイヤーが敵になる）。複数人でランダム性を確認する場合は **端末・ブラウザプロファイルを分ける**。

## WebSocket

- `GET /ws?roomId=<room>&playerId=<player>`
- 受信（client -> server）:
  - `{"type":"move","payload":{"x":0,"y":0,"z":0,"rotationY":0,"neckYaw":0,"neckPitch":0,"animation":"Idle","idleBob":0,"idlePitch":0,"idleRoll":0}}`
  - `idleBob` / `idlePitch` / `idleRoll` は待機時の呼吸・ゆらぎ（他プレイヤー表示用）。`y` は揺らぎを除いた足元基準。
- 送信（server -> client, 同じ room へブロードキャスト）:
  - `{"type":"snapshot","payload":{"roomId":"r1","version":12,"players":[...]}}`
  - `vote_result` — 投票集計結果。`allyTheme` / `enemyTheme` にラウンドの市民・敵ミッション（結果画面で公開）、`citizensWin`、`enemyPlayerId`、`voteCounts` 等を含む
  - `room_closed` — 結果表示時間（`WANIAR_RESULT_DURATION_SEC`）経過後、当該試合の部屋をサーバが削除し接続を閉じる直前に送る（`reason: game_finished`）。クライアントは未切断ならクリーンアップ用
  - `game_state` — `rules` に `maxPlayers` / `minPlayers` / 各種 `_Sec`（プレイ時間・マッチ前カウントダウン等）を含み、クライアントの表示と整合させられる

## リアルタイム効率化で意識した点

- プレイヤーごとに送信専用バッファチャネルを用意して、読み書きを goroutine 分離
- `ping/pong` + read/write deadline で死活監視
- 遅いクライアントは切断し、全体遅延の波及を防止
- スナップショットは room 単位で 1 回だけ JSON 化して配信

## 起動

```bash
cd game/backend
go mod tidy
air -c .air.toml
```

デフォルトは `127.0.0.1:8090`。`GAME_BACKEND_ADDR` で変更できます。

## 複数インスタンス（Redis）

`GAME_REDIS_ADDR` を設定すると、部屋状態は **Redis** が正本になり、**Pub/Sub** で各プロセスの WebSocket へ同じイベントを届け、**`internal/scheduler`** が Redis ZSET（`{prefix}:timers:due`）と分散ロックでカウントダウン・対戦終了・投票締め・結果後の解体を処理します。接続人数は **プレゼンス ZSET**（期限付き）で共有し、ラウンド参加者はオンラインの `playerId` から決まります。**`vote_extend`** は `ApplyVoteExtend` で blob を **1 回の WATCH トランザクション**にまとめ、人数は Round 外なら同一トランザクション内で **presence ZCARD** を参照します。待機中の **`game_state` 人数更新**は `PatchGameState` で原子的に `PlayerCount` だけ更新します。未設定時は従来どおり **インメモリ** + ローカル goroutine タイマーです。

キー例（プレフィックス既定 `waniar`、`GAME_REDIS_KEY_PREFIX` で変更可）:

- `waniar:room:{roomId}:blob` — プレイヤー JSON + `GameState` + version
- `waniar:rooms:index` / `waniar:rooms:lobby` — 部屋一覧・ロビー候補
- `waniar:room:{roomId}:presence` — WebSocket オンライン（ZSET、スコアは失効時刻 ms。**TTL 約 90s**。サーバの WebSocket **Ping に対する Pong** 受信時・クライアントが送る **`heartbeat` メッセージ**・`move` ごとに `ZADD` で更新）
- `waniar:timers:due` — 期限処理用 ZSET
- `waniar:bus:room:{roomId}` — Pub/Sub チャンネル（購読は `PSUBSCRIBE waniar:bus:room:*`）

## 環境変数

| 変数 | 説明 | デフォルト |
|------|------|-----------|
| `GAME_BACKEND_ADDR` | リッスンアドレス | `127.0.0.1:8090` |
| `GAME_REDIS_ADDR` | Redis アドレス（例 `127.0.0.1:6379`）。**未設定でインメモリ** | 空 |
| `GAME_REDIS_KEY_PREFIX` | Redis キー接頭辞 | `waniar` |
| `AGENT_URL` | Agent サーバーの URL | `http://127.0.0.1:8091` |
| `WS_ALLOWED_ORIGINS` | WebSocket 許可オリジン（カンマ区切り。空 or `*` で全許可） | `*`（開発用） |
| `WANIAR_GAME_DURATION_SEC` | 対戦プレイ時間（秒） | `60` |
| `WANIAR_MATCH_COUNTDOWN_SEC` | マッチ開始前カウントダウン（秒・待機から対戦へ） | `20` |
| `WANIAR_VOTE_DURATION_SEC` | 投票フェーズの長さ（秒） | `20` |
| `WANIAR_RESULT_DURATION_SEC` | 結果表示後にロビーへ戻るまでの待ち（秒） | `10` |
| `WANIAR_HINT_INTERVAL_SEC` | Agent ヒント配信の間隔（秒） | `15` |
| `WANIAR_MIN_PLAYERS` | カウントダウン開始に必要な最低接続人数 | `3` |
| `WANIAR_MAX_PLAYERS` | 満員扱いでマッチ開始する人数・REST Join の定員 | `10` |
| `WANIAR_MAP_RADIUS` | Agent ヒント API に渡すマップ半径 | `1.3` |

ゲームルールは `internal/config/rules.go` の `LoadRulesFromEnv` で読み込み、`game_state` の `rules` フィールドでクライアントへも配信されます。
