import * as THREE from 'three';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { HandLandmarkerVideoResult } from './types';
import {
  HAND_DETECT_INTERVAL,
  HAND_MOUTH_OUTPUT_SMOOTH,
  HAND_AXIS_SMOOTH_ALPHA,
  HAND_MOUTH_ANGLE_CLOSED,
  HAND_MOUTH_ANGLE_OPEN,
  HAND_NECK_YAW_GAIN,
  HAND_NECK_PITCH_GAIN,
  HAND_NECK_YAW_LIMIT,
  HAND_NECK_PITCH_LIMIT,
  HAND_CALIBRATION_WAIT_MS,
  HEAD_HAND_TRACK_SMOOTH,
} from './config';
import { clamp, smoothToward, errorToText, getEl } from './utils';
import { setHandModelStatus } from './hud';
import { beginDeviceLookFromUserGesture } from './device-look';
import { composeNeckDeltaQuaternion } from './neck-sync';

/** HUD 左側の手トラッキング説明（学習 JSON は使わない） */
const HUD_HAND_LINE = '手: MediaPipe';

let handLandmarker: HandLandmarker | null = null;
let cameraActive = false;
let lastCameraErrorMessage = '';
let lastHandTime = 0;

export const handState = { mouthOpenness: 0, neckYaw: 0, neckPitch: 0, detected: false };

const _tmpVWrist = new THREE.Vector3();
const _tmpVMiddleBase = new THREE.Vector3();
const _tmpVMiddleTip = new THREE.Vector3();
const _tmpVThumbTip = new THREE.Vector3();
const _tmpVecToMiddle = new THREE.Vector3();
const _tmpVecToThumb = new THREE.Vector3();
const _tmpHandAxis = new THREE.Vector3();
export let smoothNeckYaw = 0;
export let smoothNeckPitch = 0;

const camVideo = getEl<HTMLVideoElement>('cam-video');
const camPreview = getEl<HTMLElement>('cam-preview');
const camOverlay = getEl<HTMLCanvasElement>('cam-overlay');

/** 検出スロットル中もフェーズ判定に使う直近のランドマーク有無 */
let lastProcessedHadLandmarks = false;
/** 手が映ったフレームでホールド開始時刻（検知後もガイドをしばらく表示） */
let handGuideHoldStartMs: number | null = null;

const HAND_GUIDE_HOLD_AFTER_DETECT_MS = 500;

function updateHandGuideOverlay(now: number, hasLandmarks: boolean): void {
  const el = document.getElementById('cam-hand-guide') as HTMLElement | null;
  if (!el) return;

  const ready =
    cameraActive && handLandmarker !== null && camVideo.readyState >= 2;
  if (!ready) {
    el.hidden = true;
    el.style.opacity = '0';
    handGuideHoldStartMs = null;
    return;
  }

  el.hidden = false;

  if (!hasLandmarks) {
    handGuideHoldStartMs = null;
    el.style.opacity = '1';
    return;
  }

  if (handGuideHoldStartMs === null) {
    handGuideHoldStartMs = now;
  }
  if (now - handGuideHoldStartMs < HAND_GUIDE_HOLD_AFTER_DETECT_MS) {
    el.style.opacity = '1';
  } else {
    el.style.opacity = '0';
  }
}

const qNeck = new THREE.Quaternion();

export { composeNeckDeltaQuaternion };

let baseHandYaw: number | null = null;
let baseHandPitch: number | null = null;
let firstDetectionTime: number | null = null;

/** 口開きの EMA 状態 */
let smoothMouthOpen = 0;
/** 首用: 正規化後ランドマークから得た軸角度の EMA（基準差分の前にかける） */
let emaAxisYaw: number | null = null;
let emaAxisPitch: number | null = null;

/**
 * Hand Landmarker の .task（公式は float16 のみ配信。float32/latest は 404 になる）
 * @see https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
 */
const HAND_LANDMARKER_MODEL_URLS = [
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
] as const;

/** 検出はやや緩め・トラッキングは高めにしてジッタと取り逃しのバランスを取る */
const MP_CONFIDENCE_PRESETS = [
  { minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.52, minTrackingConfidence: 0.72 },
  { minHandDetectionConfidence: 0.45, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.68 },
  {},
] as const;

async function openCameraStreamPreferRear(): Promise<MediaStream> {
  const tries = [
    {
      video: {
        facingMode: { exact: 'environment' as const },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    },
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
    for (const preset of MP_CONFIDENCE_PRESETS) {
      baseOptionsVariants.push({
        modelAssetPath: url,
        ...preset,
      });
    }
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
    lastProcessedHadLandmarks = false;
    handGuideHoldStartMs = null;
    updateHandGuideOverlay(performance.now(), false);
    console.log('Hand tracking ready');
    return true;
  } catch (mpErr) {
    console.error('MediaPipe init error:', mpErr);
    lastCameraErrorMessage = `手認識モデル初期化失敗: ${errorToText(mpErr)}`;
    return false;
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
      setHandModelStatus(HUD_HAND_LINE);
      return;
    }
    const hint = lastCameraErrorMessage || 'カメラを開始できません';
    setHandModelStatus(`${HUD_HAND_LINE} — ${hint}（画面をタップして再試行）`);
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

function resetHandTrackingState(): void {
  baseHandYaw = null;
  baseHandPitch = null;
  firstDetectionTime = null;
  emaAxisYaw = null;
  emaAxisPitch = null;
  smoothMouthOpen = 0;
}

function processHandResults(results: HandLandmarkerVideoResult) {
  const ctx = camOverlay.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, camOverlay.width, camOverlay.height);

  if (!results.landmarks || results.landmarks.length === 0) {
    handState.detected = false;
    handState.mouthOpenness = 0;
    resetHandTrackingState();
    return;
  }
  handState.detected = true;
  const rawLm = results.landmarks[0];

  const lm = rawLm.map(p => ({ x: 1 - p.x, y: 1 - p.y, z: p.z }));

  const vWrist = _tmpVWrist.set(lm[0].x, lm[0].y, lm[0].z);
  const vMiddleBase = _tmpVMiddleBase.set(lm[9].x, lm[9].y, lm[9].z);
  const vMiddleTip = _tmpVMiddleTip.set(lm[12].x, lm[12].y, lm[12].z);
  const vThumbTip = _tmpVThumbTip.set(lm[4].x, lm[4].y, lm[4].z);

  const vecToMiddle = _tmpVecToMiddle.subVectors(vMiddleTip, vMiddleBase).normalize();
  const vecToThumb = _tmpVecToThumb.subVectors(vThumbTip, vMiddleBase).normalize();
  const mouthAngle = vecToMiddle.angleTo(vecToThumb);

  const lo = HAND_MOUTH_ANGLE_CLOSED;
  const hi = HAND_MOUTH_ANGLE_OPEN;
  const opennessRaw = (mouthAngle - lo) / (hi - lo);
  const openness = clamp(opennessRaw, 0, 1);
  smoothMouthOpen += (openness - smoothMouthOpen) * HAND_MOUTH_OUTPUT_SMOOTH;
  handState.mouthOpenness = smoothMouthOpen;

  const handAxis = _tmpHandAxis.subVectors(vMiddleTip, vWrist).normalize();
  let currentYaw = Math.asin(clamp(handAxis.x, -1, 1));
  let currentPitch = Math.asin(clamp(handAxis.y, -1, 1));

  const ax = HAND_AXIS_SMOOTH_ALPHA;
  if (emaAxisYaw === null || emaAxisPitch === null) {
    emaAxisYaw = currentYaw;
    emaAxisPitch = currentPitch;
  } else {
    emaAxisYaw += (currentYaw - emaAxisYaw) * ax;
    emaAxisPitch += (currentPitch - emaAxisPitch) * ax;
    currentYaw = emaAxisYaw;
    currentPitch = emaAxisPitch;
  }

  if (firstDetectionTime === null) {
    firstDetectionTime = performance.now();
  }

  if (baseHandYaw === null || baseHandPitch === null) {
    const elapsed = performance.now() - firstDetectionTime;

    if (elapsed < HAND_CALIBRATION_WAIT_MS) {
      handState.neckYaw = 0;
      handState.neckPitch = 0;

      if (ctx) {
        ctx.fillStyle = '#ffff00';
        for (const p of rawLm) {
          ctx.beginPath(); ctx.arc(p.x * camOverlay.width, p.y * camOverlay.height, 3, 0, Math.PI * 2); ctx.fill();
        }
      }
      return;
    }

    baseHandYaw = currentYaw;
    baseHandPitch = currentPitch;
  }

  const rawYaw = (currentYaw - baseHandYaw) * HAND_NECK_YAW_GAIN;
  const rawPitch = -(currentPitch - baseHandPitch) * HAND_NECK_PITCH_GAIN;

  handState.neckYaw = clamp(rawYaw, -HAND_NECK_YAW_LIMIT, HAND_NECK_YAW_LIMIT);
  handState.neckPitch = clamp(rawPitch, -HAND_NECK_PITCH_LIMIT, HAND_NECK_PITCH_LIMIT);

  if (ctx) {
    ctx.fillStyle = '#00ff88';
    for (const p of rawLm) {
      ctx.beginPath(); ctx.arc(p.x * camOverlay.width, p.y * camOverlay.height, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
}

export function updateHandTracking(now: number): void {
  if (!cameraActive || !handLandmarker || camVideo.readyState < 2) {
    updateHandGuideOverlay(now, false);
    return;
  }
  if (now - lastHandTime < HAND_DETECT_INTERVAL) {
    updateHandGuideOverlay(now, lastProcessedHadLandmarks);
    return;
  }
  lastHandTime = now;

  const results = handLandmarker.detectForVideo(camVideo, now);
  processHandResults(results);
  const hasLm = !!(results.landmarks && results.landmarks.length > 0);
  lastProcessedHadLandmarks = hasLm;
  updateHandGuideOverlay(now, hasLm);
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
  composeNeckDeltaQuaternion(qNeck, smoothNeckPitch, smoothNeckYaw);
  headBone.quaternion.copy(headBaseQuat).multiply(qNeck);
}
