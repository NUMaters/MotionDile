import * as THREE from 'three';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { HandLm, HandControlModel, HandLandmarkerVideoResult } from './types';
import {
  HAND_MODEL_URL, HAND_DETECT_INTERVAL, DEFAULT_HAND_CONTROL_MODEL,
} from './config';
import { clamp, smoothToward, errorToText, getEl } from './utils';
import { setHandModelStatus } from './hud';

let handLandmarker: HandLandmarker | null = null;
let cameraActive = false;
let lastCameraErrorMessage = '';
let lastHandTime = 0;
let handControlModel: HandControlModel = structuredClone(DEFAULT_HAND_CONTROL_MODEL);

export const handState = { mouthOpenness: 0, neckYaw: 0, neckPitch: 0, detected: false };
export let smoothNeckYaw = 0;
export let smoothNeckPitch = 0;

const camVideo = getEl<HTMLVideoElement>('cam-video');
const camPreview = getEl<HTMLElement>('cam-preview');
const camOverlay = getEl<HTMLCanvasElement>('cam-overlay');
const tapStartEl = getEl<HTMLElement>('tap-start');

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const qNeck = new THREE.Quaternion();

async function openCameraStreamPreferRear(): Promise<MediaStream> {
  const tries = [
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

  for (const wasmRoot of wasmRoots) {
    let vision;
    try {
      vision = await FilesetResolver.forVisionTasks(wasmRoot);
    } catch (e) {
      lastErr = e;
      continue;
    }
    for (const delegate of delegates) {
      try {
        const lm = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
            delegate,
          },
          numHands: 1,
          runningMode: 'VIDEO',
        });
        console.log(`HandLandmarker initialized: wasm=${wasmRoot}, delegate=${delegate}`);
        return lm;
      } catch (e) {
        lastErr = e;
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

function extractHandFeatures(lm: HandLm[]) {
  const wrist = lm[0];
  const midMCP = lm[9];
  const handSize = Math.hypot(wrist.x - midMCP.x, wrist.y - midMCP.y, wrist.z - midMCP.z);
  const fingerPairs = [[8, 5], [12, 9], [16, 13], [20, 17]];
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

  return { avgCurl, tiltAngle, pitchAngle };
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
    setHandModelStatus('手モデル: 学習済み');
    console.log('Loaded hand control model:', handControlModel);
  } catch (e: unknown) {
    handControlModel = structuredClone(DEFAULT_HAND_CONTROL_MODEL);
    setHandModelStatus('手モデル: デフォルト');
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('Hand control model not found. Using default parameters.', msg);
  }
}

export function showTapToStart(): void {
  const guideEl = tapStartEl.querySelector('span');
  const isLikelyInsecure = !window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
  if (guideEl && isLikelyInsecure) {
    guideEl.textContent = 'iPhoneはHTTPS接続が必要です（httpではカメラ不可）';
  }
  tapStartEl.classList.add('show');

  async function onStartGesture(e: Event) {
    e.preventDefault();
    tapStartEl.removeEventListener('touchstart', onStartGesture);
    tapStartEl.removeEventListener('click', onStartGesture);
    tapStartEl.classList.remove('show');
    tapStartEl.style.display = 'none';

    const ok = await startCamera();
    if (ok) return;

    if (guideEl) {
      guideEl.textContent = isLikelyInsecure
        ? 'iPhoneはHTTPS接続が必要です（https://<PC-IP>:5173 で開いてください）'
        : (lastCameraErrorMessage || 'カメラが起動できません。再タップで再試行します。');
    }
    tapStartEl.style.display = 'flex';
    tapStartEl.classList.add('show');
    tapStartEl.addEventListener('touchstart', onStartGesture, { passive: false });
    tapStartEl.addEventListener('click', onStartGesture);
  }

  tapStartEl.addEventListener('touchstart', onStartGesture, { passive: false });
  tapStartEl.addEventListener('click', onStartGesture);
}

function processHandResults(results: HandLandmarkerVideoResult) {
  const ctx = camOverlay.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, camOverlay.width, camOverlay.height);

  if (!results.landmarks || results.landmarks.length === 0) {
    handState.detected = false;
    return;
  }
  handState.detected = true;
  const lm = results.landmarks[0];

  ctx.fillStyle = '#00ff88';
  for (const p of lm) {
    ctx.beginPath();
    ctx.arc(p.x * camOverlay.width, p.y * camOverlay.height, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,255,136,.4)';
  ctx.lineWidth = 2;
  const connections = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
  for (const [a, b] of connections) {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * camOverlay.width, lm[a].y * camOverlay.height);
    ctx.lineTo(lm[b].x * camOverlay.width, lm[b].y * camOverlay.height);
    ctx.stroke();
  }

  const f = extractHandFeatures(landmarksForHandControl(lm));
  const m = handControlModel;
  const mouthRange = Math.max(0.05, m.mouth.openCurl - m.mouth.closedCurl);
  handState.mouthOpenness = clamp((f.avgCurl - m.mouth.closedCurl) / mouthRange, 0, 1);
  const yaw = clamp((f.tiltAngle - m.neck.neutralTilt) * m.neck.yawGain, -m.neck.maxYaw, m.neck.maxYaw);
  const pitch = clamp((f.pitchAngle - m.neck.neutralPitchAngle) * m.neck.pitchGain, -m.neck.maxPitch, m.neck.maxPitch);
  handState.neckYaw = Math.abs(yaw) < 0.035 ? 0 : yaw;
  handState.neckPitch = Math.abs(pitch) < 0.03 ? 0 : pitch;
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
  const speed = 9;
  smoothNeckYaw = smoothToward(smoothNeckYaw, targetYaw, dt, speed);
  smoothNeckPitch = smoothToward(smoothNeckPitch, targetPitch, dt, speed);
  euler.set(smoothNeckPitch, smoothNeckYaw, 0, 'YXZ');
  qNeck.setFromEuler(euler);
  headBone.quaternion.copy(headBaseQuat).multiply(qNeck);
}
