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
| スマホ: 端末を傾ける | 三人称視点をその方向へ（ジャイロ。`DEVICE_LOOK_*`） |
| スクロール | ズーム |

待機画面（マッチメイキング）では **「縮小表示」** で PiP 風にパネルを **左上の小さなカード**に切り替え、背景を透過して **ワールド上の操作（移動・視点など）をしながら待機**できます（左下ジョイスティックと重ならない配置）。拡大表示で全画面の待機 UI に戻ります。

ホーム画面は **タイトル〜遊び方〜名前〜参加ボタン**を `.home-stack` でまとめ、**画面内で縦横中央寄せ**しています。遊び方パネルは外寸 **幅100%（最大360px）×高さ280px**で固定し、文章が長いときは **本文エリアだけ**が縦スクロールします。ルール説明などのテキストは **枠内で中央寄せ**（`.tut-page-inner` の flex＋上下スペーサー疑似要素）です。`tutorialPagesHtml` の各ページを表示し、**枠をタップするたびに次のページへ**進みます（`screens.ts` の `initTutorial` / `#home-tut-inline`）。**ゲーム参加**後の待機画面（`#screen-matchmaking`）には **ホームに戻る** ボタンがあり、接続を切ってホームに戻れます。

スマホのゲーム画面（`npm run dev` のトップ）では、左端寄り・**画面の縦方向ほぼ中央**の丸い**目**アイコンで、視点を滑らかに正面へ戻したうえで端末の傾き基準を取り直せます（`DEVICE_LOOK_RECENTER_*` / `LOOK_RESET_*`、`device-look.ts`）。左ジョイスティックで**指を内側の円より外へ押し出す**（外側の暗いリング方向）と走行。`rawDist / R` が **1.06 超で入り・1.01 以下で戻り**のヒステリシス。専用の「走る」ボタンはありません。**画面のどこでも短く素早く2回タップ**（ドラグしない）でジャンプ（フラット地形モード時）。PC では `Space` でジャンプできます。PC では引き続き `Shift` で走行できます。ワールド地面は碁盤風（木目調プレーン + `GridHelper`、`divisions=42` で目を細かく）です。

### ハンドトラッキング（初回タップで起動）

モデル読み込み後、**画面のどこかの初回タップ**（ジョイスティック操作を含む）で、iOS 向けに **DeviceMotion / DeviceOrientation** の `requestPermission`（`device-look.ts` の同期ラッパー）とカメラ・手認識の開始をまとめて行います（ユーザージェスチャー必須。カメラ許可とは別のシステムダイアログが出る場合があります）。起動に失敗したときは HUD に案内が出るので、**もう一度画面をタップ**して再試行できます。視点は `device-look.ts`（`alpha` なし時は `beta`/`gamma` と `DEVICE_LOOK_TILT_GAIN`）。

- **口の開閉**: 手の**開き具合**を口の開きに対応（`hand-control-model.json` の **`version`** により計算式が異なる。**v2（推奨・デフォルト）**: 各指の「手首〜指先 / 手首〜MCP」の平均比でパー／グーを判別。**v1（学習済みの従来 JSON）**: 指先〜MCP 距離のカール指標を維持）
- **首の向き（左右・上下）**: **v2** では**掌の法線**（中指先方向と手の横幅から）でヨー・ピッチを安定取得。**v1** では手首〜中指 MCP の傾き。いずれも特徴量に **EMA**（`HAND_FEATURE_EMA_ALPHA`）をかけ、首ボーンは `HEAD_HAND_TRACK_SMOOTH` で追従
- カメラ起動後、画面右上にカメラプレビュー＋ランドマーク可視化（**CSS の左右反転は行わず**、映像とランドマークが一致するよう素のストリーム向きで表示）
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
- **WebSocket (gorilla/websocket)** — 部屋単位のリアルタイム位置同期（マルチプレイ表示）。`move` ペイロードに待機ゆらぎ `idleBob` / `idlePitch` / `idleRoll` を含め、他クライアントでも呼吸表現を再現。**待機（`waiting`）・カウントダウン（`countdown`）中は**、接続の増減のたびに `gateway.go` の `checkGameTransition` が `playerCount` を更新した **`game_state` をルーム全員へブロードキャスト**し、待機 UI の人数がリアルタイムで揃う
- **Agent Server (Go + OpenAI gpt-4o-mini)** — `agent/` に独立したヒント生成マイクロサービス。ゲームサーバーからプレイヤー全員の座標・行動・経過時間を受け取り、OpenAI API でプロンプトエンジニアリングに基づいた自然言語ヒントを生成して返す。API障害時はルールベースのフォールバックヒントを返却。クリーンアーキテクチャで domain/usecase/infrastructure/interface の4層に責務分離
- **表示名・投票UI** — 参加時に `displayName` を REST / WebSocket クエリで送信し、`PlayerState` に保存。頭上名は **CSS2DRenderer**（`name-labels.ts`）。スナップショット適用をリモート生成より先に行い、空名は `resolveDisplayName` で補完。ラベル層は **z-index** で WebGL キャンバスより手前（iOS で隠れないよう明示）。投票カードは iOS 等での複数 WebGL コンテキスト不具合を避けるため、**単一の `WebGLRenderer` で各プレイヤー分を順にオフスクリーン描画し JPEG 化**（`vote-previews.ts`）。プレビュー専用に **PMREMGenerator + RoomEnvironment** で `scene.environment` を生成し PBR を明るく表示、カメラは狭い FOV・近い距離で枠内を大きく取る。モデル未読込時は色＋絵文字フォールバック
- **Agent ヒント** — プロンプト組み立て（`Agent/internal/usecase/prompt.go`）では、ワールド **Y は海面 0 基準ではない**ため「高所」判定に絶対 Y を使わず、**アニメ名に Jump が含まれるときのみ**空中・ジャンプ寄りの文脈を付与
- **Vite v6.2** — 開発サーバー・ビルドツール（`.ts` をそのままトランスパイル）
- **serve** — 静的 HTTP サーバー（ビューア配信）
- **`game/frontend/src/config.ts`** — ゲーム定数の集約。移動可能エリアの円半径は `BOUNDARY_RADIUS`（`null` で地形から自動算出）、`BOUNDARY_RADIUS_CLAMP_TO_TERRAIN` で地形より外に壁がはみ出さないよう上限をかけられる。タッチジョイスティックの見た目は `JOYSTICK_BASE_*` / `JOYSTICK_THUMB_RADIUS_PX` / `JOYSTICK_RING_*`（`input.ts` の `applyJoystickLayoutFromConfig`）。ジャイロ視点の上限・滑らかさは `DEVICE_LOOK_MAX_YAW_RAD` / `DEVICE_LOOK_MAX_PITCH_RAD` / `DEVICE_LOOK_SMOOTH`、iOS 相対向き用の感度は `DEVICE_LOOK_TILT_GAIN`。視点リセット時のイージングは `DEVICE_LOOK_RECENTER_SMOOTH` / `DEVICE_LOOK_RECENTER_DURATION_S`（`device-look.ts` でセンサーを一時無効化してから正面へ収束）。段差は `MAX_STEP_UP` / `TERRAIN_MIN_NORMAL_Y`（`world.ts` でマテリアル名に `stone` を含むメッシュを足場レイ＋側面コリジョンの両方に登録し、低い岩へは登れる）。手トラッキングは `HAND_FEATURE_EMA_ALPHA` / `HEAD_HAND_TRACK_SMOOTH` / `HAND_DETECT_INTERVAL`（`hand-tracking.ts`、MediaPipe Hand Landmarker 公式 **float16** `.task` と WASM／GPU・CPU フォールバック、検出しきい値は任意）

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
npm run dev:all       # game backend(8090) + agent(8091) + medea backend(8080) + Vite frontend(5173~) を同時起動（macOS / Windows 共通）
npm run down:all      # dev:all で使う 5173/8080/8090/8091 を一括停止（`scripts/down-all.mjs` + kill-port。macOS / Windows 共通）
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
│   │       ├── device-look.ts   ← スマホジャイロで三人称カメラ視点
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
├── agent/                     ← AIヒント生成マイクロサービス（Go + OpenAI）
│   ├── cmd/server/main.go     ← エントリポイント
│   ├── internal/
│   │   ├── config/            ← .env 読み込み・設定管理
│   │   ├── domain/            ← リクエスト/レスポンス型定義
│   │   ├── infrastructure/openai/ ← OpenAI APIクライアント
│   │   ├── interface/http/    ← HTTPハンドラ (POST /hint)
│   │   └── usecase/           ← プロンプト構築・ヒント生成ロジック
│   └── .env                   ← OPENAI_API_KEY
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
