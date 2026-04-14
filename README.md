# WaniAR — ワニゲーム

ワニの 3D モデル調整・プレビューは **`modeling/`** に集約しています（ソース GLB、生成パイプライン、`viewer.html`）。ゲーム本体のビルドはリポジトリルートの Vite などを利用します。

## アニメーションクリップ

`Wani_game.glb` には以下の 8 クリップが含まれています:

| クリップ名 | 説明 | 長さ |
|---|---|---|
| `Walk` | 通常歩行 | 1.0s |
| `Run` | 走行（タイムライン圧縮＋動作増幅） | 0.55s |
| `Idle` | 静止ポーズ | 2.0s |
| `Walk_MouthOpen` | 歩行＋口開き | 1.0s |
| `Run_MouthOpen` | 走行＋口開き | 0.55s |
| `Idle_MouthOpen` | 静止＋口開き | 2.0s |
| `Attack` | 噛みつき（頭突き出し＋口パクッ） | 0.6s |
| `TailWag` | 尻尾振りアイドル | 1.2s |

## 操作方法

| キー | 操作 |
|---|---|
| `W` `A` `S` `D` / 矢印キー | 移動 |
| `Shift` | ダッシュ（走行） |
| `Space` | ジャンプ（フラット地形モード時） |
| `M` | 口の開閉トグル |
| `T` | 尻尾振りトグル |
| `J` / `L` | 首を左右に向ける（制限付き） |
| `I` / `K` | 首を上下に向ける（制限付き） |
| `R` | 位置リセット |
| マウスドラッグ | カメラ回転 |
| スクロール | ズーム |

スマホのゲーム画面（`npm run dev` のトップ）では、左ジョイスティックで**指を内側の円より外へ押し出す**（外側の暗いリング方向）と走行。`rawDist / R` が **1.06 超で入り・1.01 以下で戻り**のヒステリシス。専用の「走る」ボタンはありません。**画面のどこでも短く素早く2回タップ**（ドラグしない）でジャンプ（フラット地形モード時）。PC では `Space` でジャンプできます。PC では引き続き `Shift` で走行できます。ワールド地面は碁盤風（木目調プレーン + `GridHelper`、`divisions=42` で目を細かく）です。

### ハンドトラッキング（常時起動）

モデル読み込み後に「タップして開始」を表示し、そのタップでブラウザのカメラ使用許可を求めます（iPhone Safari の仕様でユーザージェスチャー必須）。

- **口の開閉**: 手を開く（パー）→ 口が開く / 手を閉じる（グー）→ 口が閉じる（各指先のMCP関節からの伸び具合で判定）
- **首の向き**: 手を左右に傾けると首が傾いた方向へ曲がる（手首→中指MCP のベクトル傾き＝yaw）。手を前後に倒すと首が上下する（z 軸成分＝pitch）
- 画面右上にカメラプレビュー＋ランドマーク可視化を常時表示（**CSS の左右反転は行わず**、映像とランドマークが一致するよう素のストリーム向きで表示）
- 首・口の制御だけ、正規化ランドマークを **`(x,y) → (1-x, 1-y)`** に写してから特徴量を計算（非ミラー映像でもジェスチャーとワニの向きが対応しやすくなる。`medea-pipeline/collect.html` も同じ処理で学習データと整合）
- スマートフォンは **外カメラ優先** で起動（失敗時は内カメラへフォールバック）
- 手が検出されていない間は **PC の `M` キー**で口の開閉を切り替え可能（スマホは手認識またはカメラ未起動時は口は閉じたまま）

ビューアは **`file://` で開かないでください**（GLB が読み込めません）。`npm run viewer` で `http://localhost:3000/viewer` を開きます。

## 技術スタック

- **Three.js v0.175** — 3D レンダリング・アニメーション（WebGL）。エディタ用の型は **@types/three**（three 本体の npm パッケージに `.d.ts` が同梱されない構成向け）
- **@mediapipe/tasks-vision** — MediaPipe Hand Landmarker（ブラウザカメラ＋手認識で口開閉・首の向きを制御）
- **@gltf-transform/core v4.3** — glTF/GLB ファイルのプログラム的な加工・生成
- **glTF 2.0 (GLB)** — 3D モデルフォーマット（スキンメッシュ + ボーンアニメーション）
- **medea-pipeline（独自）** — 手ジェスチャー学習データ収集・パラメータ学習・ゲーム反映
- **TypeScript v5.8** — ゲーム本体（`game/frontend/src/main.ts`）と学習スクリプト（`medea-pipeline/scripts/train-hand-control-model.ts`）の型付け
- **tsx** — Node 上で TypeScript 学習スクリプトを直接実行（`npm run pipeline:train` / Go バックエンドの `npx tsx` 呼び出し）
- **Go + Gin** — `game/backend` の REST API（ルーム参加/退出/スナップショット）
- **WebSocket (gorilla/websocket)** — 部屋単位のリアルタイム位置同期（マルチプレイ表示）。`move` ペイロードに待機ゆらぎ `idleBob` / `idlePitch` / `idleRoll` を含め、他クライアントでも呼吸表現を再現
- **Vite v6.2** — 開発サーバー・ビルドツール（`.ts` をそのままトランスパイル）
- **serve** — 静的 HTTP サーバー（ビューア配信）
- **`game/frontend/src/config.ts`** — ゲーム定数の集約。移動可能エリアの円半径は `BOUNDARY_RADIUS`（`null` で地形から自動算出）、`BOUNDARY_RADIUS_CLAMP_TO_TERRAIN` で地形より外に壁がはみ出さないよう上限をかけられる。タッチジョイスティックの見た目は `JOYSTICK_BASE_*` / つまみは `JOYSTICK_THUMB_RADIUS_PX`（一辺 `JOYSTICK_THUMB_SIZE_PX` は半径の2倍で算出） / `JOYSTICK_RING_*`（`input.ts` の `applyJoystickLayoutFromConfig` が反映）

### 3D モデルパイプライン

1. ソースモデル `Walking_wani.glb`（27 ジョイントのリグ付きメッシュ、1 歩行クリップ）
2. `modeling/scripts/build-wani-game-model.mjs` が `@gltf-transform/core` を使用し:
   - **上顎/下顎分離**: `head` ボーンの頂点をY座標 + 口先Z範囲（`0.0042 <= Z <= 0.0084`）で分割し `jaw_upper` / `jaw_lower` に再割り当て
   - Walk クリップのタイムライン圧縮と回転増幅で Run を生成
   - t=0 の静止ポーズから Idle 系クリップを生成
   - `jaw_lower` / `jaw_upper` ボーンの独立回転で口開きバリエーションを生成
   - 口腔の左右側壁と奥側キャップを `jaw_upper` / `jaw_lower` 別々に生成し、開口時の喉奥透けを防止
   - 尻尾ボーンチェーン（tail → tail3）への正弦波回転で TailWag を生成
   - 頭突き出し + 顎スナップの協調アニメーションで Attack を生成
3. 出力 `Wani_game.glb`（29 ジョイント、8 クリップ内蔵）

### 上顎/下顎分離の仕組み

ソースモデルは `head` ボーン1本で口全体を制御していたため、口の開閉が不自然でした。
ビルドスクリプトでメッシュ頂点のY座標を解析し、さらに口先のみを対象にするため `0.0042 <= Z <= 0.0084` の範囲条件を適用して3ゾーンに分割:

| Y座標範囲 | 割り当て先 | 頂点数 | 説明 |
|---|---|---|---|
| Y < 0.00218 | `jaw_lower` | ~15,000 | 下顎（歯・下アゴ） |
| 0.00218 ≤ Y < 0.00270 | `jaw_upper` | ~8,800 | 上顎（鼻先・上アゴ） |
| Y ≥ 0.00270 | `head` (変更なし) | ~23,300 | 頭蓋骨・目・後頭部 |

両方の顎ボーンは `headend` と同じ位置（顎のヒンジポイント）に配置され、
IBM（逆バインド行列）も `headend` と共有するため、口閉じ時の見た目は変わりません。

### アニメーション制御アーキテクチャ

- `AnimationMixer` で全 8 アクションを同時再生（各83チャンネル）
- 移動量に応じた Idle ↔ Walk ↔ Run の重みブレンド（`setEffectiveWeight`）
- 口開き: `jaw_lower` が下方回転、`jaw_upper` が微小上方回転（独立制御）
- 首制御: `head` ボーンのみへ回転を加算適用（左右±22°、上14°/下8°でクランプ。`chest` は前脚も含む親なので回転しない）
- Attack は `LoopOnce` のワンショット再生で他アクションの上に重畳
- ジャンプ（フラット地形）: 縦はジャンプ物理のみ。水平は地上と同じ移動式で空中でも適用し、入力を離したときの減速だけ `JUMP_AIR_MOVE_DECEL_MULT` で弱めて慣性を残す。アニメ後の `head` にローカル Y リード（`JUMP_HEAD_LEAD_*`）とルートの縦ランプ（`JUMP_BODY_LIFT_RAMP_S`）で頭先行。体の見た目は `JUMP_ROOT_PITCH_LAUNCH` と `JUMP_ROOT_ROLL_MAX`。首のピッチは `JUMP_HEAD_PITCH_*`
- 全遷移に指数的なスムージングを適用
- ビューアは実時間AABB監視で接地補正し、開口中の地面めり込みを自動回避

### ボーン構造（29ジョイント）

```
Hips
├── tail → tailstart → tail1 → tail2 → tail3
├── backleg → backleg0 → backleg1 → backleg2
├── R_backleg → R_backleg0 → R_backleg1 → R_backleg2
└── chest
    ├── head
    │   ├── headend (ヒンジポイント)
    │   ├── jaw_upper (上顎 — headend と同位置)
    │   ├── jaw_lower (下顎 — headend と同位置)
    │   ├── earend
    │   └── R_earend
    ├── frontleg → frontleg0 → frontleg1 → frontleg2
    └── R_frontleg → R_frontleg0 → R_frontleg1 → R_frontleg2
```

## セットアップ

```bash
npm install
npm run build:model   # Wani_game.glb を生成
npm run viewer        # http://localhost:3000/viewer でビューア起動
npm run dev           # Go backend(8080) + Vite frontend(5173~) を同時起動
npm run dev:game-backend  # マルチプレイ同期バックエンド（Gin + WebSocket, 8090）
npm run dev:all       # game backend(8090) + medea backend(8080) + Vite frontend(5173~) を同時起動
npm run down:all      # dev:all で起動した 5173/8080/8090 を一括停止
npm run pipeline:train:example  # サンプルデータから手モデル生成（public/models/hand-control-model.json）
```

### hand-control モデル学習（medea-pipeline）

1. `npm run dev` を起動  
2. `https://<PCのIP>:5173/medea-pipeline/collect.html` を開く  
3. 口開閉ラベルと、**向きラベリングスティック**で首傾き（yaw/pitch）サンプルを収集して `JSON出力（前回分に追加）` を実行（例: `medea-pipeline/data/hand-dataset.json`）  
4. JSON出力時に開発サーバーの `/api/pipeline/train` が自動実行され、`public/models/hand-control-model.json` を更新  
5. ゲーム読み込み時に自動反映されます（未配置時はデフォルトパラメータ）  
6. 既存の `hand-control-model.json` がある場合は、**前モデルへ追加学習（重み付きマージ）**されます

### マルチプレイ同期（game/backend）

1. `npm run dev:game-backend` を起動（`127.0.0.1:8090`）
2. 別ターミナルで `npm run dev` を起動（Vite は `/game-api` と `/game-ws` を game backend へプロキシ）
3. 複数端末で `https://<PC-IP>:5173/?room=lobby` を開く
4. 同じ `room` クエリの端末同士で、移動と向きがリアルタイム同期されます
5. 他プレイヤーは読み込み完了後に **ワニ実モデル** で表示されます（読み込み前は一時的に簡易マーカー）

### スマホでゲームが「ずっと読み込み中」になる場合

1. **`npm run build:model`** で `modeling/Wani_game.glb` を生成してから **`npm run dev`** を起動する。  
2. 起動時に **`sync-wani-glb-public`** が `public/modeling/Wani_game.glb` へ同期し、Vite 標準の静的配信で `/modeling/Wani_game.glb` が返ります（ミドルウェア順に依存しません）。  
3. ゲーム側は **`fetch` + `parseAsync`** で取得・検証するため、HTML が返った場合や glTF でない場合は画面にエラーが出ます。  
4. 約 20MB のため Wi‑Fi 推奨。PC のファイアウォールで **5173** を許可してください。  
5. `public/modeling/Wani_game.glb` は **`.gitignore`** 対象（ローカル同期ファイル）。本番 `npm run build` では `public` と `dist/modeling/` の両方に GLB が含まれます。
6. iPhone でカメラを使う場合は **HTTPS 必須**。`http://` では許可ダイアログが出ません。`https://<PCのIP>:5173/` を開き、証明書警告は一度許可してください。

## ファイル構成

```
WaniAR/
├── game/
│   ├── frontend/
│   │   └── src/
│   │       ├── main.ts          ← ゲームループ・起動オーケストレーター
│   │       ├── types.ts         ← 共有型定義
│   │       ├── config.ts        ← 定数・設定値
│   │       ├── utils.ts         ← 汎用ユーティリティ関数
│   │       ├── hud.ts           ← HUD テキスト管理
│   │       ├── scene.ts         ← Three.js シーン・カメラ・ライト初期化
│   │       ├── input.ts         ← キーボード・ジョイスティック・画面ダブルタップ（ジャンプ）
│   │       ├── hand-tracking.ts ← MediaPipe 手認識・カメラ・首制御
│   │       ├── world.ts         ← ワールドマップ読み込み・地形・衝突判定
│   │       ├── character.ts     ← キャラクター読み込み・アニメーション・色替え
│   │       ├── network.ts       ← WebSocket・REST・マルチプレイ同期
│   │       └── data/source/Лес.obj  ← ワールドマップ（OBJ）
│   └── backend/               ← ゲーム同期バックエンド（Go + Gin + WebSocket）
│       ├── cmd/server/main.go
│       ├── internal/...
│       └── README.md
├── modeling/                 ← モデル調整・ビューアをすべてここに集約
│   ├── README.md             ← modeling 用の短いガイド
│   ├── Walking_wani.glb      ← ソースモデル（歩行アニメーション付き）
│   ├── Wani_game.glb         ← ゲーム用モデル（8クリップ、自動生成）
│   ├── Wani_game.meta.json
│   ├── viewer.html           ← Three.js ビューア（CDN の Three.js、`Wani_game.glb` を相対パスで読込）
│   ├── scripts/
│   │   └── build-wani-game-model.mjs  ← モデル生成パイプライン
│   └── Meshy_AI_…_fbx/       ← 参考用 FBX + テクスチャ
├── medea-pipeline/            ← 右手操作学習パイプライン
│   ├── collect.html           ← 学習データ収集UI
│   ├── backend/
│   │   ├── go.mod
│   │   └── cmd/server/main.go ← 学習データ保存 + 学習実行 API（Go）
│   ├── data/                  ← 収集データ（JSON）
│   ├── models/                ← 学習済みモデル（ミラー）
│   └── scripts/train-hand-control-model.ts
├── index.html                ← Vite エントリ（`/game/frontend/src/main.ts` を読み込み）
├── public/models/             ← ゲームが読み込む hand-control-model.json
├── vite.config.js
├── package.json
└── README.md
```
