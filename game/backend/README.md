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

- `GET /healthz`
- `POST /api/v1/rooms/:roomID/players`
  - body: `{ "playerId": "p1" }`
- `GET /api/v1/rooms/:roomID/snapshot`
- `DELETE /api/v1/rooms/:roomID/players/:playerID`

## WebSocket

- `GET /ws?roomId=<room>&playerId=<player>`
- 受信（client -> server）:
  - `{"type":"move","payload":{"x":0,"y":0,"z":0,"rotationY":0,"neckYaw":0,"neckPitch":0,"animation":"Idle","idleBob":0,"idlePitch":0,"idleRoll":0}}`
  - `idleBob` / `idlePitch` / `idleRoll` は待機時の呼吸・ゆらぎ（他プレイヤー表示用）。`y` は揺らぎを除いた足元基準。
- 送信（server -> client, 同じ room へブロードキャスト）:
  - `{"type":"snapshot","payload":{"roomId":"r1","version":12,"players":[...]}}`

## リアルタイム効率化で意識した点

- プレイヤーごとに送信専用バッファチャネルを用意して、読み書きを goroutine 分離
- `ping/pong` + read/write deadline で死活監視
- 遅いクライアントは切断し、全体遅延の波及を防止
- スナップショットは room 単位で 1 回だけ JSON 化して配信

## 起動

```bash
cd game/backend
go mod tidy
go run ./cmd/server
```

デフォルトは `127.0.0.1:8090`。`GAME_BACKEND_ADDR` で変更できます。
