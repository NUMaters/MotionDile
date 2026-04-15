import * as THREE from 'three';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { HandLm, HandControlModel, HandLandmarkerVideoResult } from './types';
import {
  HAND_MODEL_URL,
  HAND_DETECT_INTERVAL,
  HAND_FEATURE_EMA_ALPHA,
  HEAD_HAND_TRACK_SMOOTH,
  DEFAULT_HAND_CONTROL_MODEL,
} from './config';
import { clamp, smoothToward, errorToText, getEl } from './utils';
import { setHandModelStatus } from './hud';
import { beginDeviceLookFromUserGesture } from './device-look';

let handLandmarker: HandLandmarker | null = null;
let cameraActive = false;
let lastCameraErrorMessage = '';
let lastHandTime = 0;
let handControlModel: HandControlModel = structuredClone(DEFAULT_HAND_CONTROL_MODEL);
/** `loadHandControlModel` 確定後の HUD 左側（失敗→再試行→成功時に復元する） */
let savedHandModelHudLine = '手モデル: デフォルト';

export const handState = { mouthOpenness: 0, neckYaw: 0, neckPitch: 0, detected: false };
export let smoothNeckYaw = 0;
export let smoothNeckPitch = 0;

const camVideo = getEl<HTMLVideoElement>('cam-video');
const camPreview = getEl<HTMLElement>('cam-preview');
const camOverlay = getEl<HTMLCanvasElement>('cam-overlay');

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const qNeck = new THREE.Quaternion();

type HandFeatures = {
  avgCurl: number;
  tiltAngle: number;
  pitchAngle: number;
  fingerExtension: number;
};

let emaCurl = 0.5;
let emaTilt = 0;
let emaPitch = 0;
let emaExt = 1.35;
let hadHandPrevFrame = false;

let baseHandYaw: number | null = null;
let baseHandPitch: number | null = null;
let firstDetectionTime: number | null = null;

/**
 * Hand Landmarker の .task（公式は float16 のみ配信。float32/latest は 404 になる）
 * @see https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
 */
const HAND_LANDMARKER_MODEL_URLS = [
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
] as const;

async function openCameraStreamPreferRear(): Promise<MediaStream> {
  const tries = [
    {
      video: {
        facingMode: { exact: 'environment' as const },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    { video: { facingMode: { exact: 'environment' as const }, width: { ideal: 640 }, height: { ideal: 480 } } },
    { video: { facingMode: { ideal: 'environment' as const }, width: { ideal: 640 }, height: { ideal: 480 } } },
    { video: { facingMode: { ideal: 'user' as const }, width: { ideal: 640 }, height: { ideal: 480 } } },
    { video: true },
  ];
  let lastErr: unknown = null;
  for (const c of tries) {
    try {
      return await navigator.mediaDevices.getUserMedia(c);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('camera open failed');
}

async function initHandLandmarkerWithFallback(): Promise<HandLandmarker> {
  const wasmRoots = [
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm',
    'https://unpkg.com/@mediapipe/tasks-vision@0.10.34/wasm',
  ];
  const delegates = ['GPU', 'CPU'] as const;
  let lastErr: unknown = null;

  const baseOptionsVariants: {
    modelAssetPath: string;
    minHandDetectionConfidence?: number;
    minHandPresenceConfidence?: number;
    minTrackingConfidence?: number;
  }[] = [];
  for (const url of HAND_LANDMARKER_MODEL_URLS) {
    baseOptionsVariants.push({
      modelAssetPath: url,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.65,
    });
    baseOptionsVariants.push({ modelAssetPath: url });
  }

  for (const wasmRoot of wasmRoots) {
    let vision;
    try {
      vision = await FilesetResolver.forVisionTasks(wasmRoot);
    } catch (e) {
      lastErr = e;
      continue;
    }
    for (const delegate of delegates) {
      for (const bo of baseOptionsVariants) {
        try {
          const lm = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: bo.modelAssetPath,
              delegate,
            },
            numHands: 1,
            runningMode: 'VIDEO',
            ...(bo.minHandDetectionConfidence != null
              ? {
                  minHandDetectionConfidence: bo.minHandDetectionConfidence,
                  minHandPresenceConfidence: bo.minHandPresenceConfidence,
                  minTrackingConfidence: bo.minTrackingConfidence,
                }
              : {}),
          });
          console.log(
            `HandLandmarker OK: wasm=${wasmRoot}, delegate=${delegate}, model=${bo.modelAssetPath.split('/').slice(-4, -1).join('/')}`,
          );
          return lm;
        } catch (e) {
          lastErr = e;
        }
      }
    }
  }
  throw lastErr || new Error('failed to initialize HandLandmarker');
}

async function startCamera(): Promise<boolean> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.error('getUserMedia is not available in this context.');
    lastCameraErrorMessage = 'このページはカメラAPIを利用できません（HTTPSで開いてください）。';
    return false;
  }
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    lastCameraErrorMessage = 'iPhone は HTTPS 必須です。https://<PC-IP>:ポート で開いてください。';
    return false;
  }

  let stream;
  try {
    stream = await openCameraStreamPreferRear();
  } catch (camErr: unknown) {
    console.error('Camera access denied or unavailable:', camErr);
    const dom = camErr as Partial<DOMException> & { message?: string };
    const msg = dom.name === 'NotAllowedError'
      ? 'カメラ許可が拒否されています。Safari設定で許可してください。'
      : `カメラ起動失敗: ${dom.name || dom.message || 'unknown'}`;
    lastCameraErrorMessage = msg;
    return false;
  }

  camVideo.srcObject = stream;
  await camVideo.play();
  camVideo.style.transform = '';
  camOverlay.style.transform = '';
  camOverlay.width = camVideo.videoWidth || 320;
  camOverlay.height = camVideo.videoHeight || 240;
  camPreview.style.display = 'block';
  console.log('Camera started, initializing hand tracking…');

  try {
    handLandmarker = await initHandLandmarkerWithFallback();
    cameraActive = true;
    console.log('Hand tracking ready');
    return true;
  } catch (mpErr) {
    console.error('MediaPipe init error:', mpErr);
    lastCameraErrorMessage = `手認識モデル初期化失敗: ${errorToText(mpErr)}`;
    return false;
  }
}

function landmarksForHandControl(lm: HandLm[]): HandLm[] {
  return lm.map((p) => ({ x: 1 - p.x, y: 1 - p.y, z: p.z }));
}

function vSub(a: HandLm, b: HandLm): { x: number; y: number; z: number } {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vLen(v: { x: number; y: number; z: number }): number {
  return Math.hypot(v.x, v.y, v.z);
}

function vCross(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** v1 学習済み JSON 互換: 手首〜中指 MCP の傾き + 指先〜MCP 距離のカール */
function extractLegacyHandFeatures(lm: HandLm[]): HandFeatures {
  const wrist = lm[0];
  const midMCP = lm[9];
  const handSize = Math.hypot(wrist.x - midMCP.x, wrist.y - midMCP.y, wrist.z - midMCP.z);
  const fingerPairs: [number, number][] = [[8, 5], [12, 9], [16, 13], [20, 17]];
  let curlSum = 0;
  for (const [tip, mcp] of fingerPairs) {
    curlSum += Math.hypot(lm[tip].x - lm[mcp].x, lm[tip].y - lm[mcp].y, lm[tip].z - lm[mcp].z);
  }
  const avgCurl = handSize > 0.01 ? (curlSum / 4) / handSize : 0;

  const handDx = midMCP.x - wrist.x;
  const handDy = midMCP.y - wrist.y;
  const handDz = midMCP.z - wrist.z;
  const tiltAngle = Math.atan2(handDx, -handDy);
  const pitchAngle = Math.atan2(handDz, Math.hypot(handDx, handDy));

  const tips = [8, 12, 16, 20] as const;
  const mcps = [5, 9, 13, 17] as const;
  let extAcc = 0;
  for (let i = 0; i < 4; i++) {
    const dTip = vLen(vSub(lm[tips[i]], wrist));
    const dMcp = vLen(vSub(lm[mcps[i]], wrist));
    extAcc += dTip / Math.max(dMcp, 0.02);
  }
  const fingerExtension = extAcc / 4;

  return { avgCurl, tiltAngle, pitchAngle, fingerExtension };
}

/**
 * v2: 掌の法線（中指先方向 × 人差し指〜小指 MCP）で首の左右・前後を安定して取る。
 * 口は指の開き比（手首〜各指先 / 手首〜各 MCP）でパー／グーを判別。
 */
function extractPalmHandFeatures(lm: HandLm[]): HandFeatures {
  const wrist = lm[0];
  const toMidTip = vSub(lm[12], wrist);
  const across = vSub(lm[17], lm[5]);
  let n = vCross(toMidTip, across);
  const nl = vLen(n);
  if (nl < 1e-7) return extractLegacyHandFeatures(lm);

  n = { x: n.x / nl, y: n.y / nl, z: n.z / nl };
  if (n.z < 0) {
    n = { x: -n.x, y: -n.y, z: -n.z };
  }

  const tiltAngle = Math.atan2(n.x, -n.y);
  const pitchAngle = Math.asin(clamp(n.z, -1, 1));

  const tips = [8, 12, 16, 20] as const;
  const mcps = [5, 9, 13, 17] as const;
  let extAcc = 0;
  for (let i = 0; i < 4; i++) {
    const dTip = vLen(vSub(lm[tips[i]], wrist));
    const dMcp = vLen(vSub(lm[mcps[i]], wrist));
    extAcc += dTip / Math.max(dMcp, 0.02);
  }
  const fingerExtension = extAcc / 4;

  const fingerPairs: [number, number][] = [[8, 5], [12, 9], [16, 13], [20, 17]];
  let curlSum = 0;
  const midMCP = lm[9];
  const handSize = Math.hypot(wrist.x - midMCP.x, wrist.y - midMCP.y, wrist.z - midMCP.z);
  for (const [tip, mcp] of fingerPairs) {
    curlSum += Math.hypot(lm[tip].x - lm[mcp].x, lm[tip].y - lm[mcp].y, lm[tip].z - lm[mcp].z);
  }
  const avgCurl = handSize > 0.01 ? (curlSum / 4) / handSize : 0;

  return { avgCurl, tiltAngle, pitchAngle, fingerExtension };
}

function extractHandFeaturesForModel(lm: HandLm[], version: number): HandFeatures {
  return version >= 2 ? extractPalmHandFeatures(lm) : extractLegacyHandFeatures(lm);
}

function applyFeatureEma(f: HandFeatures): HandFeatures {
  const a = HAND_FEATURE_EMA_ALPHA;
  if (!hadHandPrevFrame) {
    emaCurl = f.avgCurl;
    emaTilt = f.tiltAngle;
    emaPitch = f.pitchAngle;
    emaExt = f.fingerExtension;
    hadHandPrevFrame = true;
    return { ...f };
  }
  emaCurl += (f.avgCurl - emaCurl) * a;
  emaTilt += (f.tiltAngle - emaTilt) * a;
  emaPitch += (f.pitchAngle - emaPitch) * a;
  emaExt += (f.fingerExtension - emaExt) * a;
  return {
    avgCurl: emaCurl,
    tiltAngle: emaTilt,
    pitchAngle: emaPitch,
    fingerExtension: emaExt,
  };
}

function mouthOpennessFromFeatures(f: HandFeatures, m: HandControlModel): number {
  if (m.version < 2) {
    const mouthRange = Math.max(0.05, m.mouth.openCurl - m.mouth.closedCurl);
    return clamp((f.avgCurl - m.mouth.closedCurl) / mouthRange, 0, 1);
  }
  const lo = m.mouth.closedCurl;
  const hi = m.mouth.openCurl;
  return clamp((f.fingerExtension - lo) / Math.max(0.06, hi - lo), 0, 1);
}

function mergeHandModel(raw: unknown): HandControlModel {
  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_HAND_CONTROL_MODEL);
  const o = raw as Record<string, unknown>;
  const mouth = (o.mouth && typeof o.mouth === 'object' ? o.mouth : {}) as Record<string, unknown>;
  const neck = (o.neck && typeof o.neck === 'object' ? o.neck : {}) as Record<string, unknown>;
  const version = typeof o.version === 'number' ? o.version : 1;
  return {
    version,
    mouth: {
      closedCurl: Number(mouth.closedCurl ?? DEFAULT_HAND_CONTROL_MODEL.mouth.closedCurl),
      openCurl: Number(mouth.openCurl ?? DEFAULT_HAND_CONTROL_MODEL.mouth.openCurl),
      openThreshold: Number(mouth.openThreshold ?? DEFAULT_HAND_CONTROL_MODEL.mouth.openThreshold),
    },
    neck: {
      neutralTilt: Number(neck.neutralTilt ?? DEFAULT_HAND_CONTROL_MODEL.neck.neutralTilt),
      yawGain: Number(neck.yawGain ?? DEFAULT_HAND_CONTROL_MODEL.neck.yawGain),
      maxYaw: Number(neck.maxYaw ?? DEFAULT_HAND_CONTROL_MODEL.neck.maxYaw),
      neutralPitchAngle: Number(neck.neutralPitchAngle ?? DEFAULT_HAND_CONTROL_MODEL.neck.neutralPitchAngle),
      pitchGain: Number(neck.pitchGain ?? DEFAULT_HAND_CONTROL_MODEL.neck.pitchGain),
      maxPitch: Number(neck.maxPitch ?? DEFAULT_HAND_CONTROL_MODEL.neck.maxPitch),
    },
  };
}

export async function loadHandControlModel(): Promise<void> {
  try {
    const res = await fetch(HAND_MODEL_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const modelJson: unknown = await res.json();
    handControlModel = mergeHandModel(modelJson);
    savedHandModelHudLine = '手モデル: 学習済み';
    setHandModelStatus(savedHandModelHudLine);
    console.log('Loaded hand control model:', handControlModel);
  } catch (e: unknown) {
    handControlModel = structuredClone(DEFAULT_HAND_CONTROL_MODEL);
    savedHandModelHudLine = '手モデル: デフォルト';
    setHandModelStatus(savedHandModelHudLine);
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('Hand control model not found. Using default parameters.', msg);
  }
}

/**
 * 全画面オーバーレイは出さず、**画面の初回タップ**（`window` capture）で
 * モーション許可（同期）→ 視点リスナー → カメラ起動をまとめて行う（iOS のユーザージェスチャ要件用）。
 */
const firstTapOpts: AddEventListenerOptions = { capture: true, passive: true };
/** iOS では pointer 系より touchstart の方がユーザージェスチャーとして安定する端末がある */
const firstTouchOpts: AddEventListenerOptions = { capture: true, passive: true };

export type ActivateSensorsOptions = {
  /** カメラ起動失敗時（再タップ用に窓へリスナーを戻すときなど） */
  onCameraFail?: () => void;
};

/**
 * 傾きセンサー＋カメラ。`ゲーム参加` の click など、ユーザージェスチャーの同期的なハンドラ内から呼ぶ。
 */
export function activateSensorsFromUserGesture(options?: ActivateSensorsOptions): void {
  beginDeviceLookFromUserGesture();

  void startCamera().then((ok) => {
    if (ok) {
      setHandModelStatus(savedHandModelHudLine);
      return;
    }
    const hint = lastCameraErrorMessage || 'カメラを開始できません';
    setHandModelStatus(`${savedHandModelHudLine} — ${hint}（画面をタップして再試行）`);
    options?.onCameraFail?.();
  });
}

/**
 * カメラ起動に失敗したあと、画面のどこかをタップしたら再度センサー＋カメラを試す。
 */
export function registerSensorRetryOnWindowTap(): void {
  function bind(): void {
    window.addEventListener('pointerdown', onRetry, firstTapOpts);
    window.addEventListener('touchstart', onRetry, firstTouchOpts);
  }

  function onRetry(): void {
    window.removeEventListener('pointerdown', onRetry, firstTapOpts);
    window.removeEventListener('touchstart', onRetry, firstTouchOpts);

    activateSensorsFromUserGesture({
      onCameraFail: bind,
    });
  }

  bind();
}

function processHandResults(results: HandLandmarkerVideoResult) {
  const ctx = camOverlay.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, camOverlay.width, camOverlay.height);

  // 手が画面から消えたら、すべてリセット（タイマーも！）
  if (!results.landmarks || results.landmarks.length === 0) {
    handState.detected = false;
    hadHandPrevFrame = false;
    baseHandYaw = null;
    baseHandPitch = null;
    firstDetectionTime = null; // ★リセット
    return;
  }
  handState.detected = true;
  const rawLm = results.landmarks[0];

  // (1-x, 1-y) に変換
  const lm = rawLm.map(p => ({ x: 1 - p.x, y: 1 - p.y, z: p.z }));

  // 1. 各ポイントの定義
  const vWrist      = new THREE.Vector3(lm[0].x, lm[0].y, lm[0].z);
  const vMiddleBase = new THREE.Vector3(lm[9].x, lm[9].y, lm[9].z);
  const vMiddleTip  = new THREE.Vector3(lm[12].x, lm[12].y, lm[12].z);
  const vThumbTip   = new THREE.Vector3(lm[4].x, lm[4].y, lm[4].z);

  // ★ 2. 口の開閉（待機中も口だけは動かせるように、先に計算します）
  const vecToMiddle = new THREE.Vector3().subVectors(vMiddleTip, vMiddleBase).normalize();
  const vecToThumb = new THREE.Vector3().subVectors(vThumbTip, vMiddleBase).normalize();
  const mouthAngle = vecToMiddle.angleTo(vecToThumb);

  const MOUTH_CLOSE_ANGLE = 0.3;
  const MOUTH_OPEN_ANGLE = 0.8;
  const openness = (mouthAngle - MOUTH_CLOSE_ANGLE) / (MOUTH_OPEN_ANGLE - MOUTH_CLOSE_ANGLE);
  handState.mouthOpenness = Math.max(0, Math.min(1, openness));

  // 3. 首の向きの計算
  //const handAxis = new THREE.Vector3().subVectors(vMiddleBase, vWrist).normalize();
  // 手首から「中指の先端（鼻先）」へのベクトルを完全な基準軸とする！
  const handAxis = new THREE.Vector3().subVectors(vMiddleTip, vWrist).normalize();
  const currentYaw = Math.asin(handAxis.x);
  const currentPitch = Math.asin(handAxis.y);

  // =======================================================
  // 🐊 1秒遅延（ディレイ）オートセンタリング
  // =======================================================
  if (firstDetectionTime === null) {
    // 手が映った最初のフレームの時間を記録 (ミリ秒)
    firstDetectionTime = performance.now(); 
  }

  if (baseHandYaw === null || baseHandPitch === null) {
    const elapsed = performance.now() - firstDetectionTime;
    
    if (elapsed < 1000) { // ★ 1000ミリ秒（1秒）未満なら
      // 首の動きを「正面」でロックして待機
      handState.neckYaw = 0;
      handState.neckPitch = 0;
      
      // デバッグ描画（準備中は黄色で表示）
      if (ctx) {
        ctx.fillStyle = '#ffff00'; // Yellow
        for (const p of rawLm) {
          ctx.beginPath(); ctx.arc(p.x * camOverlay.width, p.y * camOverlay.height, 3, 0, Math.PI * 2); ctx.fill();
        }
      }
      return; // 首の計算はスキップしてここで終了
      
    } else {
      // ★ 1秒経過した瞬間に、その時の角度を「正面」として記憶！
      baseHandYaw = currentYaw;
      baseHandPitch = currentPitch;
    }
  }

  // 4. 基準からのズレを計算して動かす
  const YAW_GAIN = 1.8;
  const PITCH_GAIN = 1.8;

  // ※ もし先ほどのテストで左右が逆だった場合は、 (currentYaw - baseHandYaw) の先頭にマイナス - をつけてください！
  const rawYaw = (currentYaw - baseHandYaw) * YAW_GAIN;
  const rawPitch = -(currentPitch - baseHandPitch) * PITCH_GAIN;

  // 5. クランプしてステートに反映
  const YAW_LIMIT = 0.8;
  const PITCH_LIMIT = 0.5;

  handState.neckYaw = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, rawYaw));
  handState.neckPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, rawPitch));

  // デバッグ描画（準備完了後は緑色で表示）
  if (ctx) {
    ctx.fillStyle = '#00ff88'; // Green
    for (const p of rawLm) {
      ctx.beginPath(); ctx.arc(p.x * camOverlay.width, p.y * camOverlay.height, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
}

export function updateHandTracking(now: number): void {
  if (!cameraActive || !handLandmarker || camVideo.readyState < 2) return;
  if (now - lastHandTime < HAND_DETECT_INTERVAL) return;
  lastHandTime = now;

  const results = handLandmarker.detectForVideo(camVideo, now);
  processHandResults(results);
}

export function applyHeadTracking(
  dt: number,
  headBone: THREE.Object3D | null,
  headBaseQuat: THREE.Quaternion | null,
  /** ジャンプなどで加える首のピッチ（ラジアン）。手の pitch に加算 */
  additiveNeckPitch = 0,
): void {
  if (!headBone || !headBaseQuat) return;
  const hasTracking = handState.detected && cameraActive;
  const targetYaw = hasTracking ? handState.neckYaw : 0;
  const targetPitch = (hasTracking ? handState.neckPitch : 0) + additiveNeckPitch;
  smoothNeckYaw = smoothToward(smoothNeckYaw, targetYaw, dt, HEAD_HAND_TRACK_SMOOTH);
  smoothNeckPitch = smoothToward(smoothNeckPitch, targetPitch, dt, HEAD_HAND_TRACK_SMOOTH);
  euler.set(smoothNeckPitch, 0, smoothNeckYaw, 'ZXY');
  qNeck.setFromEuler(euler);
  headBone.quaternion.copy(headBaseQuat).multiply(qNeck);
}
