/// <reference types="vite/client" />
import type { HandControlModel } from './types';

// ─── Vite / アプリのベース URL（アセット解決用） ─────────────────────────────
/** ルート相対の静的アセットを解決するためのベース URL（`import.meta.env.BASE_URL`） */
const appBaseUrl = new URL(import.meta.env.BASE_URL || '/', window.location.origin);

// ─── アセット URL ───────────────────────────────────────────────────────────
/** 手制御パラメータ JSON（学習済み hand-control）の取得先 */
export const HAND_MODEL_URL = new URL('models/hand-control-model.json', appBaseUrl).href;
/** プレイ用ワニ GLB（`public/modeling/` 経由で配信される想定） */
export const MODEL_URL = new URL('modeling/Wani_game.glb', appBaseUrl).href;

// ─── バックエンド API / WebSocket（Vite プロキシと対応） ─────────────────────
/** CloudFront が /api・/ws を game-backend ALB にプロキシする本番向けビルド（`npm run build:aws`） */
const cloudfrontProxy = import.meta.env.VITE_GAME_CLOUDFRONT_PROXY === 'true';

/** ゲーム同期 REST のベースパス（例: `/game-api/v1` → 8090 へプロキシ、本番プロキシ時は `/api/v1`） */
export const GAME_API_BASE = import.meta.env.VITE_GAME_API_BASE
  || (cloudfrontProxy ? '/api/v1' : '/game-api/v1');
/** ゲーム同期 WebSocket（本番プロキシ時は同一ホストの `/ws`） */
export const GAME_WS_BASE = import.meta.env.VITE_GAME_WS_BASE
  || (cloudfrontProxy
    ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game-ws`);

// ─── ルーム / セッション ───────────────────────────────────────────────────
/** URL クエリ `?room=`（任意・共有用）。未指定時は空で、参加時に API が待機中の部屋を検索または新規作成 */
export const roomIdFromUrl = new URLSearchParams(location.search).get('room') ?? '';

/** サーバ未割当時のラベル／投票プレビュー用（青系はワニ本体と区別しづらいためオレンジ系） */
export const FALLBACK_PLAYER_COLOR = '#FB8C00';

// ─── ゲームルール（既定値。WebSocket の `game_state.rules` で上書き） ─────────
function vitePositiveInt(key: string, fallback: number): number {
  const raw = import.meta.env[key] as string | undefined;
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

/** フロント表示・フォールバック用。バックエンドは `WANIAR_*` 環境変数（`game/backend/internal/config/rules.go`） */
export const GAME_RULES = {
  maxPlayers: vitePositiveInt('VITE_WANIAR_MAX_PLAYERS', 10),
  minPlayers: vitePositiveInt('VITE_WANIAR_MIN_PLAYERS', 3),
  gameDurationSec: vitePositiveInt('VITE_WANIAR_GAME_DURATION_SEC', 60),
  matchCountdownSec: vitePositiveInt('VITE_WANIAR_MATCH_COUNTDOWN_SEC', 20),
  voteDurationSec: vitePositiveInt('VITE_WANIAR_VOTE_DURATION_SEC', 20),
  hintIntervalSec: vitePositiveInt('VITE_WANIAR_HINT_INTERVAL_SEC', 15),
  resultDurationSec: vitePositiveInt('VITE_WANIAR_RESULT_DURATION_SEC', 10),
} as const;

// ─── ワールド座標・スケール ─────────────────────────────────────────────────
/** デフォルト地面プレーンおよび地形合わせの基準 Y */
export const GROUND_Y = 0;
/** ワニ GLB を読み込んだあとルートに掛ける統一スケール */
export const WANI_SCALE = 2;

// ─── 地形・衝突（レイキャスト・歩行判定） ───────────────────────────────────
/** 地面とみなす法線の最小 Y（これより立たない面は崖扱い） */
export const TERRAIN_MIN_NORMAL_Y = 0.45;
/** 1 ステップで登れるとみなす最大高さ差 */
export const MAX_STEP_UP = 0.22;
/** モデル足元と地面の見た目合わせ用オフセット（正で上） */
export const PLAYER_HEIGHT_OFFSET = 0.575;
/** 地面めり込み防止の微小クリアランス */
export const PLAYER_GROUND_CLEARANCE = 0.018;
/** 特定マテリアル（草地）上での沈み込み補正量 */
export const MATERIAL_002_SINK_OFFSET = 0.008;
/** キャラの水平方向コリジョンのおおよその半径（障害物レイ用） */
export const PLAYER_COLLISION_RADIUS = 0.045;
/** true のとき高さは `sampleFlatFloorY`（草地・岩の上面など）にスナップする */
export const FLAT_WORLD_MODE = true;

// ─── 移動境界（円形バリア） ─────────────────────────────────────────────────
/**
 * 移動可能エリアの円半径（ワールド原点からの XZ 距離、メートル相当のスケール）。
 * `null` のときは歩行可能メッシュのバウンディングから自動算出し、その後 `BOUNDARY_MARGIN` を引く。
 * 数値を指定したときはその半径を使う（`BOUNDARY_RADIUS_CLAMP_TO_TERRAIN` 参照）。
 */
export const BOUNDARY_RADIUS: number | null = 1.3;
/**
 * `BOUNDARY_RADIUS` 指定時に、地形から求めた最大半径より大きくしないか。
 * true: `min(指定半径, 地形ベースの半径)` で島の外に壁がはみ出さない。
 * false: 指定半径をそのまま使う（島より大きいと壁が空中に出る場合あり）。
 */
export const BOUNDARY_RADIUS_CLAMP_TO_TERRAIN = false;
/** 自動算出半径から内側に縮める余白（地面端と壁の隙間） */
export const BOUNDARY_MARGIN = 0.05;
/** 円筒バリアの高さ（見た目のシリンダー高さ） */
export const BOUNDARY_WALL_HEIGHT = 0.95;
/** 円筒・リングの円周分割数（多いほど滑らか） */
export const BOUNDARY_WALL_SEGMENTS = 96;
/** 境界に並べる縦ポールの本数。`0` でポールなし */
export const BOUNDARY_PILLAR_COUNT = 0;
/** 地面トーラス（ドーナツ状ライン）のチューブ半径。太いほどラインが目立つ */
export const BOUNDARY_GROUND_RING_TUBE = 0.1;

// ─── カメラ（三人称・頭付近フォロー） ───────────────────────────────────────
/** カメラのターゲットからの高さオフセット */
export const CAM_HEIGHT = 0.03;
/** キャラからカメラまでの後方オフセット */
export const CAM_DISTANCE = 0.09;
/** 注視点をキャラ前方へ伸ばす量（見通し） */
export const CAM_LOOK_AHEAD = 1.30;
/** 注視点の高さオフセット */
export const CAM_LOOK_HEIGHT = 0.14;
/** スマホのジャイロで視点を振るときの最大ヨー（ラジアン／片側） */
export const DEVICE_LOOK_MAX_YAW_RAD = 1.15;
/** スマホのジャイロで視点を振るときの最大ピッチ（ラジアン／片側） */
export const DEVICE_LOOK_MAX_PITCH_RAD = 0.72;
/** ジャイロ視点の追従（大きいほど素早く） */
export const DEVICE_LOOK_SMOOTH = 11;
/** 視点リセット中、正面へ戻すスムージング（通常より強め） */
export const DEVICE_LOOK_RECENTER_SMOOTH = 17;
/** 視点リセット時、センサーを無視してターゲット0へ寄せる時間（秒）。終了後に再キャリブレーション */
export const DEVICE_LOOK_RECENTER_DURATION_S = 0.2;
/**
 * iOS 相対向きで alpha が null のとき、`beta`/`gamma` の差分から視点へ変換するゲイン（度→ラジアン換算後に乗算）
 */
export const DEVICE_LOOK_TILT_GAIN = 1.35;

// ─── ネットワーク同期 ───────────────────────────────────────────────────────
/** 位置送信の最小間隔（ミリ秒）。負荷と滑らかさのバランス */
export const MOVE_SEND_INTERVAL = 66;

// ─── 手認識（MediaPipe） ────────────────────────────────────────────────────
/** 手ランドマーク検出の最大間隔（ミリ秒）。短いほど追従が速い */
export const HAND_DETECT_INTERVAL = 22;
/** 特徴量の指数移動平均係数（0〜1。大きいほど素早く追従、小さいほどジャッカ抑制） */
export const HAND_FEATURE_EMA_ALPHA = 0.38;
/** 首（手追従）の `smoothToward` 係数。大きいほど頭が手に追従しやすい */
export const HEAD_HAND_TRACK_SMOOTH = 12;

// ─── 移動・ジョイスティック（スマホ走行ヒステリシス含む） ─────────────────────
/** ジョイスティックを「走り」に入るまでの押し出し比（rawDist/R）のしきい値（入り） */
export const RUN_STRETCH_ENTER = 1.06;
/** 走りから抜けるしきい値（出）（チャタリング防止） */
export const RUN_STRETCH_EXIT = 1.01;
/** 前後入力の加速側スムージング係数（大きいほど素早く追従） */
export const MOVE_ACCEL_SMOOTH = 11;
/** 前後入力の減速側スムージング係数 */
export const MOVE_DECEL_SMOOTH = 7;
/** 旋回入力のスムージング係数 */
export const TURN_INPUT_SMOOTH = 10;
/** 走行ブレンド（ジョイスティック走り / Shift）のスムージング係数 */
export const RUN_BLEND_SMOOTH = 7;

// ─── ジャンプ（画面ダブルタップ / Space キー） ───────────────────────────────
/** 初速（ワールド単位／秒）。大きいほど高く跳ぶ */
export const JUMP_VELOCITY = 0.6;
/** 重力加速度（毎秒速度の減少量）。大きいほど滝のように早く落ちる（宙に浮いた感じを抑える） */
export const JUMP_GRAVITY = 2;
/** 画面ダブルタップでジャンプするとき、2回目までの最大間隔（ms） */
export const JOYSTICK_DOUBLE_TAP_MS = 380;
/** タップとみなす最大押下時間（ms）。これより長いとドラグ扱い */
export const JOYSTICK_TAP_MAX_DURATION_MS = 220;
/** タップとみなす最大スティックの押し出し比（ジョイスティックのみ。これより大きいとドラグ扱い） */
export const JOYSTICK_TAP_MAX_STRETCH = 0.28;
/** 2回目のタップがこの距離（px）以内なら同一ダブルタップとみなす */
export const JOYSTICK_DOUBLE_TAP_MAX_DIST_PX = 52;
/** 1本の指でタップとみなす最大移動量（px）。これを超えるとドラグ扱いでジャンプ用ダブルタップに使わない */
export const TOUCH_TAP_MAX_MOVE_PX = 14;
/** 離地直後〜上昇の首ピッチ（顔を少し上げる。大きすぎると不自然） */
export const JUMP_HEAD_PITCH_UP = -1.3;
/** 頂点付近の首ピッチ（ほぼニュートラル寄り） */
export const JUMP_HEAD_PITCH_APEX = -1.0;
/** 落下中の追加首ピッチ（わずかに前方） */
export const JUMP_HEAD_PITCH_FALL = -0.06;
/** 着地直後の首ピッチ */
export const JUMP_HEAD_PITCH_LAND = -0.045;
/** ジャンプ首ピッチのスムージング係数 */
export const JUMP_HEAD_PITCH_SMOOTH = 8;
/** 体（ルート）の前後ピッチ：弧の前半で軽く上向き */
export const JUMP_ROOT_PITCH_PEAK = 0.055;
/** 着地でわずかに前傾してから戻す */
export const JUMP_ROOT_PITCH_LAND = -0.032;
export const JUMP_ROOT_PITCH_SMOOTH = 10;
/** 頭ボーンのローカル Y に足すリード量の最大（m 相当。離地直後に頭が先に上がる） */
export const JUMP_HEAD_LEAD_LOCAL_Y = 0.055;
/** 頭リードがピークに達するまでの時間（秒） */
export const JUMP_HEAD_LEAD_RISE_S = 0.1;
/** 頭リードが収まるまでの時間（秒、離地から計測） */
export const JUMP_HEAD_LEAD_END_S = 0.32;
/** ルートの上下移動をこの秒数かけて 100% 効かせる（頭より体が遅れて上がる） */
export const JUMP_BODY_LIFT_RAMP_S = 0.08;
/** 離地〜上昇前半の追加ルートピッチ（移動は真上でも体を前傾させて斜めに見せる） */
export const JUMP_ROOT_PITCH_LAUNCH = 0.092;
/** ジャンプ中のルートロール振幅（弧の中盤で最大。真上軌道でも体を斜めに） */
export const JUMP_ROOT_ROLL_MAX = 0.058;
/** 空中で前後入力を離したときの減速に掛ける倍率（小さいほど慣性が残る。1 で地上と同じ） */
export const JUMP_AIR_MOVE_DECEL_MULT = 0.34;

// ─── アイドル時の体の揺れ（立ちアニメの付加） ───────────────────────────────
/** 揺れの位相進み速度のベース */
export const IDLE_SWAY_SPEED = 0.2;
/** 上下ボブの振幅（小さめ。値が大きいと浮き過ぎる） */
export const IDLE_BOB_AMOUNT = 0.00001;
/** アイドル時のピッチ（前後の傾き）振幅 */
export const IDLE_PITCH_AMOUNT = 0.03;
/** アイドル時のロール（左右の傾き）振幅 */
export const IDLE_ROLL_AMOUNT = 0.025;

// ─── UI ジョイスティック（DOM、ピクセル基準。寸法は `input.ts` が適用） ───────
/** ジョイスティックの論理半径（px）。`rawDist / この値` で走り判定。目安: `BASE/2 - THUMB_RADIUS` 以下でつまみがベース内に収まる */
export const JOYSTICK_RADIUS = 65;
/** ベース円の一辺（px） */
export const JOYSTICK_BASE_SIZE_PX = 134;
/** `#joystick-zone` の左下からベース円の左・下までの余白（px） */
export const JOYSTICK_BASE_INSET_PX = 31;
/** つまみ円の半径（px）。見た目の大きさはまずこれを変える */
export const JOYSTICK_THUMB_RADIUS_PX = 45;
/** つまみの一辺（px、`#joystick-thumb` は正方形＝直径） */
export const JOYSTICK_THUMB_SIZE_PX = JOYSTICK_THUMB_RADIUS_PX * 2;
/** 走り表示リングの外枠直径（px） */
export const JOYSTICK_RING_OUTER_PX = 166;
/** リングの左下オフセット（px） */
export const JOYSTICK_RING_INSET_PX = 16;
/** リングのボーダー太さ（px。内径 ≒ ベース径になるよう `RING_OUTER - 2*border ≈ BASE`） */
export const JOYSTICK_RING_BORDER_PX = 16;
/** 視点リセット（丸アイコン）の直径（px） */
export const LOOK_RESET_SIZE_PX = 48;
/** 左端の余白（px。セーフエリアとは max で併用。小さいほど画面端寄り） */
export const LOOK_RESET_LEFT_INSET_PX = 6;

// ─── アニメーションクリップ名（GLB 内のクリップと一致させる） ────────────────
export const CLIP_NAMES = [
  'Walk', 'Run', 'Idle',
  'Walk_MouthOpen', 'Run_MouthOpen', 'Idle_MouthOpen',
  'Attack', 'TailWag',
];

// ─── 手モデル未読み込み時のデフォルト（口・首のゲイン） ───────────────────────
/** v2: 口は指の開き比（~1.0 グー … ~1.85 パー）、首は掌の法線（左右・上下） */
export const DEFAULT_HAND_CONTROL_MODEL: HandControlModel = {
  version: 2,
  mouth: { closedCurl: 1.06, openCurl: 1.82, openThreshold: 0.42 },
  neck: {
    neutralTilt: 0,
    yawGain: 1.12,
    maxYaw: 0.72,
    neutralPitchAngle: 0,
    pitchGain: -1.45,
    maxPitch: 0.55,
  },
};

// ─── マルチプレイ用ボディ色付け（テクスチャ／ソリッドのブレンド） ─────────────
/** テクスチャありメッシュでプレイヤー色を乗せるときのアルベドブレンド強度（高いほど色がはっきり） */
export const BODY_TINT_MAP_BLEND = 0.93;
/** ソリッド色メッシュでのブレンド強度 */
export const BODY_TINT_SOLID_BLEND = 0.88;
/** 発光色にプレイヤー色を混ぜる倍率 */
export const BODY_EMISSIVE_MUL = 0.42;
/** 発光の強さ */
export const BODY_EMISSIVE_INTENSITY = 0.62;
/** 口内・目など、色を塗らないメッシュ名にマッチする正規表現 */
export const TINT_SKIP_NAME =
  /tongue|mouth|gum|teeth|tooth|lip|inner|oral|palate|saliva|口|舌|歯|歯茎|唇|目|eye|pupil|iris/i;
