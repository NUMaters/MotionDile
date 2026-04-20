# Motion Dile — ワニゲーム

ワニの 3D モデル調整・プレビューは **`modeling/`** に集約しています（ソース GLB、生成パイプライン、`viewer.html`）。ゲーム本体のビルドはリポジトリルートの Vite などを利用します。

## CMake（ネイティブ）

将来の C/C++ 連携や CI でのビルド検証用に、リポジトリルートに **CMake 3.20+** を置いています（**C11**）。`native/` に最小の静的ライブラリ `waniar_native` とチェック用実行ファイル `waniar_native_check` があります。`build/` は生成物用で `.gitignore` 済みです。CMake 未導入の環境では macOS なら `brew install cmake` を参照してください。

| コマンド | 内容 |
|---|---|
| `npm run cmake:configure` | `cmake -S . -B build`（`-DCMAKE_BUILD_TYPE=Release`） |
| `npm run cmake:build` | `cmake --build build` |
| `npm run cmake:all` | 上記を続けて実行 |

手動の例: `cmake -S . -B build && cmake --build build` → 実行ファイルのパスはジェネレータにより `build/native/waniar_native_check` または `build/waniar_native_check` など。`CMAKE_EXPORT_COMPILE_COMMANDS=ON` により `build/compile_commands.json` が出力され、clangd 等で参照できます。

## テスト

| コマンド | 内容 |
|---|---|
| `npm run test` | フロント（Vitest）。毎回 `node_modules/.vitest` と `coverage/` を削除してから `--coverage` で `game/frontend/src/**/*.test.ts` および `App.vue.test.ts` を実行（`world`・`character`・`hud`・`input`・`device-look`・`screens`・`vote-previews`・`network`（依存モック）・Vue の `App.vue` など。`window` が必要なモジュールは該当ファイルで **happy-dom** を指定） |
| `npm run test:watch` | 上記をウォッチモード |
| `npm run test:backend` | `go clean -C game/backend -cache -testcache` 後に `game/backend` で `go test ./... -coverprofile=coverage.out` を実行し、`go tool cover -func=coverage.out` で集計を表示 |
| `npm run test:all` | Vitest のあとバックエンド Go を続けて実行 |

`game-rules` のテストでは `config.ts` がブラウザ API（`window`）に依存するため、`GAME_RULES` を `vi.mock('./config')` で差し替えています。`player-names` / `ui-layout` は `localStorage` や `document` / `window` をテスト内でスタブしています。`icons`・`name-labels`・`App.vue`（`@vue/test-utils`）は DOM が必要なため **happy-dom** を使います。`network.ts` は依存を `vi.mock` してエントリのみ検証します。**WebGL 初期化の `scene.ts`・巨大な `bootstrapGame.ts`・MediaPipe の `hand-tracking.ts`・`main.ts` のエントリ**は実機／E2E 前提とし、単体テストの対象外です。バックエンドは `internal/config` の `WANIAR_*`、`internal/usecase`（`Join`・`ResolveLobbyRoom`・`Move`・`Leave`・`TallyVotes` 等）、`internal/infrastructure/memory`（`repository.RoomRepository` 実装のコンパイル時チェック含む）、`internal/interface/http`（Gin + `httptest`）、`internal/interface/ws`（`buildCheckOrigin` / `uniformCryptoIndex`）を Go で検証します。

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

待機画面（マッチメイキング）では **PiP 用アイコンボタン**を **行の右端**に置き（全画面・PiP 共通）、パネルを **画面上部・コンパス列とカメラ列のあいだ**に水平中央で表示する小さなカードに切り替えられます（`app.css` の `--pip-reserve-left` / `--pip-reserve-right` で左右の予約幅、狭い画面では幅が縮みます）。カード内は **左上に人数・右上に最大化ボタン**、その下に **色ドットと名前**（長い名前は **省略**）、**ホームに戻る**の順でコンパクトに並びます。PiP では **「3人以上で開始カウントダウン」**の案内は出しません（全画面では従来どおり）。背景を透過して **ワールド上の操作（移動・視点など）をしながら待機**できます（左下ジョイスティックと重ならない配置）。PiP オーバーレイは **`z-index: 22`**（コンパスより背面）。同ボタンで全画面の待機 UI に戻ります。

ホーム画面は **タイトル〜遊び方〜名前〜参加ボタン**を `.home-stack` でまとめ、**画面内で縦横中央寄せ**しています。遊び方パネルは外寸 **幅100%（最大360px）×高さ280px**で固定し、文章が長いときは **本文エリアだけ**が縦スクロールします。ルール説明などのテキストは **枠内で中央寄せ**（`.tut-page-inner` の flex＋上下スペーサー疑似要素）です。`tutorialPagesHtml` の各ページを表示し、**枠をタップするたびに次のページへ**進みます（`screens.ts` の `initTutorial` / `#home-tut-inline`）。「ゲームのルール」ページでは、対戦開始後に **画面上部のゲームルール枠**（タイマー下の `#game-role-badge`）へ**行動テーマ（ミッション）**が与えられることも説明しています。**ゲーム参加**後の待機画面（`#screen-matchmaking`）には **ホームに戻る** ボタンがあり、接続を切ってホームに戻れます。

スマホのゲーム画面（`npm run dev` のトップ）では、左端寄り・**画面の縦方向ほぼ中央**の丸い**目**アイコンで、視点を滑らかに正面へ戻したうえで端末の傾き基準を取り直せます（`DEVICE_LOOK_RECENTER_*` / `LOOK_RESET_*`、`device-look.ts`）。**コンパス**（`#game-compass`）は**対戦中**と**マッチメイキング待機中**に左上に表示され、キャラの向きに合わせて針が回ります。**左右反転**ボタン（`#btn-ui-layout` / `ui-layout.ts`、**コンパス直下の円形アイコン**／ミラー時は右上コンパス列）でジョイスティック・視点リセット・カメラプレビュー・コンパス・切替ボタンを左右ミラー配置。カメラプレビュー上端はコンパス上端と揃える（`--cam-preview-top`、テキスト帯は廃止）。待機 **PiP** も同設定で**左右予約幅（コンパス列／カメラ列）が入れ替わる**。`localStorage` の `waniar:ui-layout-mirrored` で保持します。左ジョイスティックで**指を内側の円より外へ押し出す**（外側の暗いリング方向）と走行。`rawDist / R` が **1.06 超で入り・1.01 以下で戻り**のヒステリシス。専用の「走る」ボタンはありません。**画面のどこでも短く素早く2回タップ**（ドラグしない）でジャンプ（フラット地形モード時）。PC では `Space` でジャンプできます。PC では引き続き `Shift` で走行できます。ワールド地面は碁盤風（木目調プレーン + `GridHelper`、`divisions=42` で目を細かく）です。

### ハンドトラッキング（ゲーム参加でカメラ・モーション許可）

**ゲーム参加**ボタンの `click` と同じユーザージェスチャー内で、iOS 向けに **DeviceMotion / DeviceOrientation** の `requestPermission`（`device-look.ts` で同一ターンに `void` 呼び出しの直後に `deviceorientation` / `devicemotion` を購読）とカメラ・手認識の開始をまとめて行うため、**追加タップなしでモーション許可ダイアログが出ます**（カメラ許可とは別のシステムダイアログが出る場合があります）。カメラだけ失敗したときは HUD の案内どおり**画面をタップして再試行**できます。視点は `device-look.ts`（`alpha` なし時は `beta`/`gamma` と `DEVICE_LOOK_TILT_GAIN`）。

- **口の開閉**: MediaPipe のランドマークから、**中指の付け根〜先**と**親指先**の方向ベクトルのなす角を **閉じ／開き**にマッピングし、**口開き度に EMA**（`HAND_MOUTH_OUTPUT_SMOOTH`）をかけてジッタを抑える（`config.ts` の `HAND_MOUTH_ANGLE_*` で閾値調整）
- **首の向き（左右・上下）**: **手首→中指先**のベクトルから `asin` でヨー／ピッチを取得。校準待ち（`HAND_CALIBRATION_WAIT_MS`）のあと基準姿勢を記録し、差分にゲイン（`HAND_NECK_*`）を掛ける。軸角度には **EMA**（`HAND_AXIS_SMOOTH_ALPHA`）をかけてから差分計算し、首ボーンは `HEAD_HAND_TRACK_SMOOTH` で追従。**学習用 JSON／分類機は使用しない**
- カメラ起動後、画面右上にカメラプレビュー＋ランドマーク可視化（**CSS の左右反転は行わず**、映像とランドマークが一致するよう素のストリーム向きで表示）
- 正規化ランドマークを **`(x,y) → (1-x, 1-y)`** に写してから幾何計算（非ミラー映像でもジェスチャーとワニの向きが対応しやすい）
- スマートフォンは **外カメラ優先** で起動（失敗時は内カメラへフォールバック）
- 手が検出されていない間は **PC の `M` キー**で口の開閉を切り替え可能（スマホは手認識またはカメラ未起動時は口は閉じたまま）

ビューアは **`file://` で開かないでください**（GLB が読み込めません）。`npm run viewer` で `http://localhost:3000/viewer` を開きます。

## 技術スタック

- **Three.js v0.175** — 3D レンダリング・アニメーション（WebGL）。エディタ用の型は **@types/three**（three 本体の npm パッケージに `.d.ts` が同梱されない構成向け）。**入室時の初期位置**は **Go `room_usecase.Join`** が `WANIAR_MAP_RADIUS`（`MapRadius`）を円半径として **XZ をサーバ側で乱択**し、既存プレイヤーとの距離・`playerId` 由来の方位スロットで密集を避ける（`internal/usecase/initial_spawn.go`）。REST スナップショットが全員に共有されるため**リモート表示も同じ座標から開始**する。フロントは `getLastJoinMyPlayer()` の XZ・向きをローカルワニに適用し、**Y は地形にスナップ**（`alignModelToFlatWorld`）。サーバ情報が無い場合のみ `world.ts` の `pickRandomSpawnPosition` でクライアント乱択（障害物・境界は `isValidStandingSpawnXZ` 等）
- **@mediapipe/tasks-vision** — MediaPipe Hand Landmarker（ブラウザカメラ＋手認識で口開閉・首の向きを制御）
- **@gltf-transform/core v4.3** — glTF/GLB ファイルのプログラム的な加工・生成
- **glTF 2.0 (GLB)** — 3D モデルフォーマット（スキンメッシュ + ボーンアニメーション）
- **medea-pipeline** — 任意の補助ツール（収集 HTML 等）。ゲーム本体の手制御は **MediaPipe のみ**
- **Vue 3** — ゲーム UI シェル（単一ファイルコンポーネント `App.vue`）。マウント後に Three.js ゲーム本体（`bootstrapGame.ts`）を動的 import し、DOM（`#game-canvas` 等）は従来どおり ID 参照で操作
- **試合結果画面** — `#screen-results` は **全画面 `position: fixed; inset: 0`**（`relative` だとキャンバスと縦二分割になる端末がある）。上詰め（`justify-content: flex-start`）と余白の圧縮で縦スクロール量を抑え、`ホームに戻る` は `position: sticky` で下端付近に留めやすくする（`app.css`）。**`network.ts` の `handleGameState`** は対戦 HUD（`game-hud`）からの待機復帰だけ自動でホームへ戻し、**投票画面（`voting`）では戻さない**（投票終了直後の `game_state` が `vote_result` より先に届くと結果 UI が潰れるのを防ぐ）。得票行の敵は「敵」タグ＋名前のみ（`screens.ts` の `showResults`、重複ラベル「敵ワニ」は出さない）。**紙吹雪**は `result-confetti.ts` が **勝利時のみ** `#result-confetti-layer` に矩形ピースを生成し CSS で落下（敗北時は祝賀と矛盾するため出さない）。`prefers-reduced-motion: reduce` では非表示
- **TypeScript v5.8** — フロント（`game/frontend/src/*.ts` / `*.vue`）と `medea-pipeline` 配下スクリプトの型付け
- **tsx** — Node 上で TypeScript を直接実行（`medea-pipeline` の補助スクリプトや Go 連携の `npx tsx` 呼び出し向け）
- **Go + Gin** — `game/backend` の REST API（`POST /api/v1/rooms/resolve` で `preferredRoomId` が空なら**待機中の部屋を検索して割り当て、なければ新規作成**。`excludeRoomId` を付けると（自動検索時）その ID の待機ルームはスキップし、**試合終了・`room_closed` などの切断**のあとだけフロントが送り、**ホームに戻る**操作では送らず**同じ待機ロビーへ再参加**しやすくする。**`preferredRoomId` が空でないときは常にその部屋 ID を返す**（対戦・投票・結果中も別ロビーへ誘導しない）。新規参加可否は `POST /api/v1/rooms/:roomID/players` の `Join` が判定する。フロントは `resolve` 後の部屋 ID を **sessionStorage** に保持し、**リロード時の `beforeunload` では `DELETE` 退出を送らない**（`cleanup({ notifyServerLeave: false })`）ので、進行中マッチのメンバーがサーバに残り、再び「ゲーム参加」で同じ部屋へ復帰しやすい。**一度参加に成功すると `waniar:auto-rejoin-multiplayer` フラグを立て、モデル読み込み完了後に `maybeResumeMultiplayerAfterReload` が待機画面のまま `initMultiplayer` を自動実行**し、ボタン操作なしで同じ部屋へ再接続する（失敗時はホームへ戻す）。明示退出・試合終了の `cleanup()` では `DELETE` とストレージ削除。`POST /api/v1/rooms/:roomID/players` で参加、退出、スナップショット）
- **Redis（go-redis v9、任意）** — 環境変数 `GAME_REDIS_ADDR` を設定すると `game/backend` は **Redis** に部屋の正本を置き、**Pub/Sub**（`{prefix}:bus:room:{roomId}`）で WebSocket 配信を全インスタンスへ伝え、**ZSET** `{prefix}:timers:due` と `internal/scheduler` のワーカー（SETNX ロック）でカウントダウン・対戦終了・投票締め・結果表示後の解体を処理する。オンライン人数は **ZSET プレゼンス**で共有。`GAME_REDIS_KEY_PREFIX` でキー接頭辞を変更可能（既定 `waniar`）。未設定時は **インメモリ `RoomRepository`** とプロセス内タイマーのみ
- **WebSocket (gorilla/websocket)** — 部屋単位のリアルタイム位置同期（マルチプレイ表示）。`move` ペイロードに `neckYaw` / `neckPitch`（手トラッキング由来の首）と待機ゆらぎ `idleBob` / `idlePitch` / `idleRoll` を含める。リモート側の首姿勢はローカルと同じ **`Euler` 順 `ZXY`（`composeNeckDeltaQuaternion`）**で頭ボーンに適用する（`YXZ` で組むと首だけ大きく崩れるため統一が必要）。対戦中は `gateway.go` が `WANIAR_HINT_INTERVAL_SEC`（既定 **15 秒**）ごとに Agent ヒントを `hint` で配信（**ヒント生成は非同期**にし、対戦終了時刻と重なっても `vote_start` が遅延しないようにしている）。**待機（`waiting`）・カウントダウン（`countdown`）中は**、接続の増減のたびに `gateway.go` の `checkGameTransition` が `playerCount` を更新した **`game_state` をルーム全員へブロードキャスト**し、待機 UI の人数がリアルタイムで揃う。**WebSocket が閉じたとき**、`readPump` の後処理は **フェーズが待機（`waiting`）のときだけ** `Leave`（REST の部屋メンバー削除）を呼ぶ。カウントダウン以降（対戦・投票・結果）で通信が切れてもメンバーは残るため、**同じ `playerId` で「ゲーム参加」→ REST / WS 再接続**すれば復帰できる（明示退出・`DELETE /players/:id`・ホームに戻る等は従来どおりメンバー削除）。**再接続時**は `game_start` が再送されないため、`buildGameStatePayload` の `game_state` に **`enemyPlayerId` / `allyTheme` / `enemyTheme`** と **`players` 各要素の `playerId`** を含め、フロントの `handleGameState` が **`playing` で対戦 HUD**、**`voting` で投票画面**を復元する。**位置**は REST / WS の `snapshot` で自プレイヤーの `lastJoinMyPlayer` を更新し、`trySpawnLocalPlayerAfterJoin` が地形準備と **`multiplayerSessionActive` 確定**まで再試行。ページ離脱直前のローカル座標は **`waniar:last-mp-spawn`** に退避し、サーバ値が欠ける場合のフォールバックに使う。**敵ワニ抽選**は `startGame` で WebSocket 接続中のユニーク `playerId` を名前順に並べたうえで、**`crypto/rand.Int`（`[0,n)` の一様整数）**でインデックスを決め敵を選ぶ（従来の 8 バイト `% n` より偏りが出にくい）。**カウントダウン中に WS が切れると**直前までの人数より参加者が減り、その時点で接続しているプレイヤーだけから選ぶ（1 人だけなら常にその人が敵になる）
- **Agent Server (Go + OpenAI gpt-4o-mini / Bedrock)** — `Agent/` に独立したヒント生成マイクロサービス。ゲームサーバーからプレイヤー全員の座標・行動・経過時間を受け取り、OpenAI API（または Amazon Bedrock）でプロンプトエンジニアリングに基づいた自然言語ヒントを生成して返す。API障害時はルールベースのフォールバックヒントを返却。クリーンアーキテクチャで domain/usecase/infrastructure/interface の4層に責務分離。`OPENAI_API_KEY` 設定時は OpenAI を優先（既定: gpt-4o-mini）、未設定で `AWS_REGION` があれば Bedrock にフォールバック
- **表示名・投票UI** — 参加時に `displayName` を REST / WebSocket クエリで送信し、`PlayerState` に保存。**他プレイヤー**の頭上名のみ **CSS2DRenderer**（`name-labels.ts`、**自キャラには名前ラベルを付けない**）。スナップショット適用をリモート生成より先に行い、空名は `resolveDisplayName` で補完。ラベル層は **z-index** で WebGL キャンバスより手前（iOS で隠れないよう明示）。**プレイ中に後から入室したプレイヤー**は REST の部屋メンバーには載るが、`game_start` 時点の WebSocket 接続者だけを `GameState.roundPlayerIds` に記録し、**投票対象・投票者数・敵抽選・Agent ヒントの対象プレイヤー**はこのラウンド参加者に限定する（`gateway.go` / `room_usecase.go`）。**プレイヤー識別色**は `entity/player_state.go` の高彩度 `PlayerColors`（**青系はワニ本体と区別しづらいため含めない**）を割り当て、`character.ts` の `BODY_TINT_MAP_BLEND` / `BODY_TINT_SOLID_BLEND` と emissive でワニに乗せる（PBR に加え Lambert/Phong も対象。口内メッシュの色スキップはピンク系に限定し体表の誤判定を防ぐ）。`network.ts` の `applyLocalPlayerColorTint` で割当 hex が更新されたとき体へ再適用する。待機 UI のドット色と同じ hex を `name-labels.ts` の CSS2D ラベル枠（`applyPlayerLabelAccent`）にも用い、体色と表示を揃える。`vote_result` WebSocket には `entity.VoteResult` として `enemyColor`（`TallyVotes` がスナップショットから取得）を含め、**結果画面**でも投票カードと同じ `mountVotePreviews` で敵ワニのオフスクリーン画像を表示する（`screens.ts` の `showResults`）。投票カードは iOS 等での複数 WebGL コンテキスト不具合を避けるため、**単一の `WebGLRenderer` で各プレイヤー分を順にオフスクリーン描画し JPEG 化**（`vote-previews.ts`、体揺れは付けず静止サムネ）。プレビュー専用に **PMREMGenerator + RoomEnvironment** で `scene.environment` を生成し PBR を明るく表示、カメラは狭い FOV・近い距離で枠内を大きく取る。モデル未読込時は色＋絵文字フォールバック
- **行動テーマシステム** — ゲーム開始時に市民チームと敵ワニにそれぞれ異なる「行動ミッション（テーマ）」をランダム割り当て（`usecase/themes.go`）。例:「障害物の近くを移動する」「マップの外周を歩き回る」等。各プレイヤーには自分のテーマのみ表示され、陣営は直接通知されない。プレイヤーはテーマに沿って行動しつつ、**異なる動きをしている敵ワニ**を探す。テーマは `game_start` WebSocket メッセージで各クライアントに送信、`GameState` に `AllyTheme`/`EnemyTheme` として保存される
- **Agent ヒント** — プロンプト組み立て（`Agent/internal/usecase/prompt.go`）では、**市民テーマと敵テーマの両方**を受け取り、敵の行動がテーマと合わないことを示唆するヒントを生成。ワールド **Y は海面 0 基準ではない**ため「高所」判定に絶対 Y を使わず、**アニメ名に Jump が含まれるときのみ**空中・ジャンプ寄りの文脈を付与。フロントは `screens.ts` の `showHint` が Web Animations API で、**行動テーマバッジ直下**（`#agent-hint-danmaku`）へ**弾幕風の横スクロール**で表示（従来の画面中央ポップアップは廃止）
- **Vite v6.2** — 開発サーバー・ビルドツール（`@vitejs/plugin-vue` で `.vue` を処理し、`.ts` をトランスパイル）
- **dev-all ランナー** — `scripts/dev-all.mjs` が Node の `spawn` で game backend（air）・Agent（air）・Vite を同時起動（`concurrently` は環境によりハングするため不使用）。いずれか終了時に他プロセスへ `SIGTERM`
- **air** — Go バックエンドをホットリロード常駐で起動。`dev:all` の初回待ち時間を減らし、以後の再起動を高速化
- **serve** — 静的 HTTP サーバー（ビューア配信）
- **`game/frontend/src/config.ts`** — ゲーム定数の集約。**`GAME_RULES`**（プレイ時間・マッチ開始前カウントダウン・投票・ヒント間隔・結果待ち・最小／最大人数の既定。`VITE_WANIAR_*` で上書き）と **`game-rules.ts`**（`WebSocket` の `game_state.rules` でサーバ値に同期）を参照。バックエンドの対応環境変数は `WANIAR_*`（`game/backend/internal/config/rules.go`）。`FALLBACK_PLAYER_COLOR` はサーバ未割当時のラベル／投票プレビュー用アクセント（青系を避ける）。移動可能エリアの円半径は `BOUNDARY_RADIUS`（`null` で地形から自動算出）、`BOUNDARY_RADIUS_CLAMP_TO_TERRAIN` で地形より外に壁がはみ出さないよう上限をかけられる。タッチジョイスティックの見た目は `JOYSTICK_BASE_*` / `JOYSTICK_THUMB_RADIUS_PX` / `JOYSTICK_RING_*`（`input.ts` の `applyJoystickLayoutFromConfig`）。ジャイロ視点の上限・滑らかさは `DEVICE_LOOK_MAX_YAW_RAD` / `DEVICE_LOOK_MAX_PITCH_RAD` / `DEVICE_LOOK_SMOOTH`、iOS 相対向き用の感度は `DEVICE_LOOK_TILT_GAIN`。視点リセット時のイージングは `DEVICE_LOOK_RECENTER_SMOOTH` / `DEVICE_LOOK_RECENTER_DURATION_S`（`device-look.ts` でセンサーを一時無効化してから正面へ収束）。段差は `MAX_STEP_UP` / `TERRAIN_MIN_NORMAL_Y`（`world.ts` でマテリアル名に `stone` を含むメッシュを足場レイ＋側面コリジョンの両方に登録し、低い岩へは登れる）。手トラッキングは `HAND_MOUTH_OUTPUT_SMOOTH` / `HAND_AXIS_SMOOTH_ALPHA` / `HEAD_HAND_TRACK_SMOOTH` / `HAND_DETECT_INTERVAL`（`hand-tracking.ts`、MediaPipe Hand Landmarker 公式 **float16** `.task` と WASM／GPU・CPU フォールバック、複数段の **minHandDetectionConfidence / minHandPresenceConfidence / minTrackingConfidence** を試行。手が検出されていないフレームでは `public/hand-guide.png` を `#cam-hand-guide` でカメラプレビュー上に重ね、置き方のガイドとして表示する（CSS `mix-blend-mode: screen` と `filter` で黄緑トーン、検知後も約 0.5 秒は表示してから `opacity` でフェードアウト／手が離れるとフェードイン）

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

## インフラ構成

### 構成 A: Fly.io + Cloudflare Pages（無料〜格安構成 / 推奨）

```
ユーザー (ブラウザ)
  → Cloudflare DNS (motiondile.net)
    → Cloudflare Pages (Vue3 + Three.js SPA)
    → Fly.io nrt (Go: game-backend + agent)
       → OpenAI API (gpt-4o-mini, ヒント・テーマ生成)
```

| リソース | サービス | 用途 |
|---|---|---|
| フロントエンド | Cloudflare Pages | SPA 配信 + CDN + DDoS 保護 |
| DNS / SSL | Cloudflare | ドメイン管理・自動 HTTPS |
| バックエンド | Fly.io (shared-cpu-1x, 256MB) | game-backend + agent 統合コンテナ |
| Redis | Upstash | 状態共有・Pub/Sub |
| AI | OpenAI gpt-4o-mini | ヒント・テーマ生成 |

#### デプロイ手順（Fly.io + Cloudflare Pages）

```bash
# --- バックエンド (Fly.io) ---
# 1. Fly.io CLI インストール後、アプリ作成
fly launch --name motiondile --region nrt --no-deploy

# 2. シークレット設定
fly secrets set OPENAI_API_KEY=your-openai-api-key

# 3. デプロイ
fly deploy

# --- フロントエンド (Cloudflare Pages) ---
# 1. npm install && npm run build:model
# 2. Cloudflare Pages でプロジェクト作成
#    - ビルドコマンド: npm run build:fly
#    - 出力ディレクトリ: dist
#    - 環境変数:
#      VITE_GAME_API_BASE=https://motiondile.fly.dev/api/v1
#      VITE_GAME_WS_BASE=wss://motiondile.fly.dev/ws
# 3. カスタムドメイン設定 (motiondile.net)

# --- 手動デプロイ ---
npm run build:fly
npx wrangler pages deploy dist --project-name=motiondile
fly deploy
```

### 構成 B: AWS（Terraform / フル機能構成）

```
                    ┌──────────────────────────────┐
                    │     CloudFront (HTTPS)       │
                    │  d7mgz9p4n1pcy.cloudfront.net│
                    └──┬────────────────────┬──────┘
                       │ /api/* /ws* /healthz│ 静的アセット
                       ▼                    ▼
              ┌─────────────┐     ┌──────────────┐
              │  ALB (HTTP) │     │  S3 (OAC)    │
              │  :80        │     │  frontend    │
              └──┬──────────┘     └──────────────┘
                 │
       ┌─────────┴──────────┐
       ▼                    ▼
┌────────────┐    ┌────────────┐
│ECS Fargate │    │ECS Fargate │
│game-backend│───▶│  agent     │
│:8090       │    │:8091       │
│CPU 512     │    │CPU 256     │
│MEM 1024    │    │MEM 512     │
└────────────┘    └────────────┘
       │               │
       ▼               ▼
  ElastiCache     Amazon Bedrock
   (Redis)       (Claude 3 Haiku)
```

| リソース | サービス | 用途 |
|---|---|---|
| ネットワーク | VPC + Public/Private Subnets + VPC Endpoints | タスク・ALB の配置 |
| コンテナ基盤 | ECS Fargate | game-backend / agent の実行 |
| コンテナレジストリ | ECR | Docker イメージ管理 |
| ロードバランサ | ALB x2 | game-backend (public) / agent (internal) |
| 静的配信 | S3 + CloudFront + WAF | フロントエンド SPA + API/WS プロキシ |
| AI | Amazon Bedrock (Claude 3.5 Haiku) | ゲーム内ヒント生成 |
| Redis | ElastiCache (cache.t3.micro) | 状態共有・Pub/Sub |
| DNS | Route 53 | ドメイン管理 |
| 監視 | CloudWatch + SNS | ダッシュボード・アラーム |
| IaC | Terraform >= 1.5.0 | インフラのコード管理 |

#### デプロイ手順（AWS）

```bash
cd infra/terraform/environments/dev

# 1. terraform.tfvars を作成（terraform.tfvars.example を参考）
cp terraform.tfvars.example terraform.tfvars
# → game_backend_image / agent_image に ECR リポジトリ URL を設定

# 2. 初期化 & ECR リポジトリのみ先に作成
terraform init
terraform apply -target=module.ecr_game -target=module.ecr_agent

# 3. Docker イメージを ECR へ push
aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com
cd ../../..
docker build --platform linux/amd64 -t <ECR_URL>/waniar-game-backend:latest game/backend/
docker push <ECR_URL>/waniar-game-backend:latest
docker build --platform linux/amd64 -t <ECR_URL>/waniar-agent:latest Agent/
docker push <ECR_URL>/waniar-agent:latest

# 4. 全リソースをデプロイ
cd infra/terraform/environments/dev
terraform apply

# 5. Agent ALB DNS を terraform output で取得し、terraform.tfvars の game_agent_url に設定して再 apply
terraform apply

# 6. フロントエンドを S3 にデプロイ
cd ../../../..
VITE_GAME_CLOUDFRONT_PROXY=true npm run build
aws s3 sync dist/ s3://$(cd infra/terraform/environments/dev && terraform output -raw frontend_s3_bucket_id)/ --delete
aws cloudfront create-invalidation --distribution-id $(cd infra/terraform/environments/dev && terraform output -raw frontend_cloudfront_distribution_id) --paths "/*"
```

### Terraform Outputs

| Output | 説明 |
|---|---|
| `frontend_cloudfront_url` | フロントエンド URL (https://xxx.cloudfront.net) |
| `game_backend_alb_dns` | Game Backend ALB DNS |
| `agent_alb_dns` | Agent ALB DNS |
| `frontend_s3_bucket_id` | フロント用 S3 バケット名 |
| `frontend_cloudfront_distribution_id` | キャッシュ無効化用 CloudFront ID |

## セットアップ

```bash
npm install
npm run build:model   # Wani_game.glb を生成
npm run viewer        # http://localhost:3000/viewer でビューア起動
npm run dev           # Vite のみ（5173）。**このだけだと** `127.0.0.1:8090` の game backend が無く `/game-api` プロキシが ECONNREFUSED になる → `dev:game-backend` か `dev:all` を別途起動
npm run dev:game-backend  # マルチプレイ同期バックエンド（Gin + WebSocket, 8090, air でホットリロード）
npm run dev:agent     # ヒント生成 Agent（8091, air でホットリロード）
npm run dev:all       # game backend(8090) + agent(8091) + Vite frontend(5173~) を同時起動（macOS / Windows 共通）。Go バックエンドは air で常駐し、初回ビルド後は差分だけ素早く再起動。LLM ヒント・テーマを使う場合は **`Agent/.env` に `OPENAI_API_KEY`** を書く（または `AWS_REGION` + `BEDROCK_MODEL_ID` で Bedrock を使用）
npm run down:all      # dev:all で使う 5173/8090/8091 を一括停止（`scripts/down-all.mjs` + kill-port。macOS / Windows 共通）
```

`air` が未インストールなら `go install github.com/air-verse/air@latest` を一度実行してください。npm スクリプトは `PATH` と `go env GOPATH` / `GOBIN` の両方を見て `air` を探します。

### マルチプレイ同期（game/backend）

1. `npm run dev:game-backend` を起動（`127.0.0.1:8090`）
2. 別ターミナルで `npm run dev` を起動（Vite は `/game-api` と `/game-ws` を game backend へプロキシ）
3. 複数端末で `https://<PC-IP>:5173/` を開き「ゲーム参加」する（待機中の部屋があればそこへ、なければ新規ルーム。ゲーム終了後に再度参加すると部屋はリセットされ、再度検索から始まる）。同じ待機ルームに集まった端末同士で移動と向きがリアルタイム同期。任意で `?room=部屋ID` を付けるとその部屋を優先（共有用）
4. 他プレイヤーは読み込み完了後に **ワニ実モデル** で表示されます（読み込み前は一時的に簡易マーカー）
5. **投票フェーズ**では「**時間延長**」ボタンがあり、**ラウンド参加者**（`roundPlayerIds`）の **過半数** が押すと **1 回だけ** 投票終了時刻が **10 秒** 延びる（WebSocket `vote_extend` / `vote_extend_update`。延長後はサーバが投票用タイマーを差し替え。適用時はカウントダウン横に **+10** が一瞬ポップ表示される）。**投票は1人1回のみ**で確定後は選び直し不可（`memory.ErrVoteAlreadyCast`・`screens.ts` の UI ロック、`game_state.votes` で同期）

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
├── CMakeLists.txt          ← CMake ルート（`native/` サブディレクトリ）
├── native/                 ← C11 スタブ（静的 lib + `waniar_native_check`）
├── game/
│   ├── frontend/
│   │   └── src/
│   │       ├── main.ts          ← Vue アプリのマウント（エントリ）
│   │       ├── App.vue          ← 画面 DOM（ローディング・各スクリーン・ジョイスティック等）
│   │       ├── styles/app.css   ← ゲーム UI のグローバルスタイル
│   │       ├── bootstrapGame.ts ← Three.js ゲームループ・起動オーケストレーター
│   │       ├── types.ts         ← 共有型定義
│   │       ├── config.ts        ← 定数・設定値
│   │       ├── utils.ts         ← 汎用ユーティリティ関数
│   │       ├── hud.ts           ← 手モデル／部屋状態の互換更新（画面上部のステータス行・コンパスは非表示）
│   │       ├── scene.ts         ← Three.js シーン・カメラ・ライト初期化
│   │       ├── input.ts         ← キーボード・ジョイスティック・画面ダブルタップ（ジャンプ）
│   │       ├── hand-tracking.ts ← MediaPipe 手認識・カメラ・首制御
│   │       ├── neck-sync.ts     ← 首ピッチ/ヨーから相対クォータニオン（`ZXY`、ネット同期と共通）
│   │       ├── device-look.ts   ← スマホジャイロで三人称カメラ視点
│   │       ├── world.ts         ← ワールドマップ読み込み・地形・衝突判定
│   │       ├── character.ts     ← キャラクター読み込み・アニメーション・色替え
│   │       ├── network.ts       ← WebSocket・REST・マルチプレイ同期
│   │       └── data/tex.obj, tex.mtl  ← ワールドマップ（OBJ+MTL、`world.ts` が読み込み）
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
├── Agent/                     ← AIヒント生成マイクロサービス（Go + OpenAI / Bedrock）
│   ├── cmd/server/main.go     ← エントリポイント
│   ├── internal/
│   │   ├── config/            ← .env 読み込み・設定管理
│   │   ├── domain/            ← リクエスト/レスポンス型定義
│   │   ├── infrastructure/openai/  ← OpenAI API クライアント
│   │   ├── infrastructure/bedrock/ ← Amazon Bedrock クライアント（AWS構成用）
│   │   ├── interface/http/    ← HTTPハンドラ (POST /hint, POST /themes)
│   │   └── usecase/           ← プロンプト構築・ヒント生成ロジック
│   └── .env.example           ← OPENAI_API_KEY
├── deploy/                    ← Fly.io デプロイ用
│   ├── Dockerfile             ← game-backend + agent 統合コンテナ
│   └── start.sh               ← 両プロセス起動スクリプト
├── fly.toml                   ← Fly.io 設定
├── medea-pipeline/            ← 任意の補助ツール（収集 UI 等。ゲームの手制御は MediaPipe のみ）
│   ├── collect.html
│   ├── backend/
│   │   ├── go.mod
│   │   └── cmd/server/main.go
│   ├── data/
│   ├── models/
│   └── scripts/
├── index.html                ← Vite エントリ（`#app` に Vue をマウント → `main.ts`）
├── public/models/             ← 互換用（空でも可）
├── vite.config.js
├── package.json
└── README.md
```
