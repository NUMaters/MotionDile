/// <reference types="vite/client" />
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

/** MediaPipe 正規化ランドマーク（型パッケージが無い場合の最小定義） */
type HandLm = { x: number; y: number; z: number };

type HandControlModel = {
  version: number;
  mouth: { closedCurl: number; openCurl: number; openThreshold: number };
  neck: {
    neutralTilt: number;
    yawGain: number;
    maxYaw: number;
    neutralPitchAngle: number;
    pitchGain: number;
    maxPitch: number;
  };
};

type HandLandmarkerVideoResult = {
  landmarks?: HandLm[][];
};

type NetPlayerState = {
  playerId: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  neckYaw: number;
  neckPitch: number;
  animation: string;
  color: string;
  idleBob?: number;
  idlePitch?: number;
  idleRoll?: number;
  updatedAt: number;
};

type RoomSnapshot = {
  roomId: string;
  version: number;
  players: NetPlayerState[];
};

type WsSnapshotEnvelope = {
  type: 'snapshot';
  payload: RoomSnapshot;
};

type RemotePlayer = {
  root: THREE.Group;
  targetPos: THREE.Vector3;
  targetYaw: number;
  targetNeckYaw: number;
  targetNeckPitch: number;
  targetIdleBob: number;
  targetIdlePitch: number;
  targetIdleRoll: number;
  smoothIdleBob: number;
  smoothIdlePitch: number;
  smoothIdleRoll: number;
  prevIdleBob: number;
  smoothNeckYaw: number;
  smoothNeckPitch: number;
  headBone: THREE.Object3D | null;
  headBaseQuat: THREE.Quaternion | null;
  desiredAnimation: string;
  actions: Record<string, THREE.AnimationAction>;
  mixer: THREE.AnimationMixer | null;
  isProxy: boolean;
  color: string;
};

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function getOrCreatePlayerId(): string {
  const key = 'waniar:player-id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const generated = `p-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, generated);
  return generated;
}

function updateHudText() {
  hudText.textContent = `${hudHandModel} | ${hudMultiplayer}`;
}

// ─── DOM ───
const canvas = getEl<HTMLCanvasElement>('game-canvas');
const loadingEl = getEl<HTMLElement>('loading');
const loadBar = getEl<HTMLElement>('load-bar');
const loadText = getEl<HTMLElement>('load-text');
const hudText = getEl<HTMLElement>('hud-text');
const camVideo = getEl<HTMLVideoElement>('cam-video');
const camPreview = getEl<HTMLElement>('cam-preview');
const camOverlay = getEl<HTMLCanvasElement>('cam-overlay');
const tapStartEl = getEl<HTMLElement>('tap-start');

// ─── Renderer ───
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ─── Scene ───
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7ec8e3);
scene.fog = new THREE.Fog(0x7ec8e3, 30, 80);

// ─── Camera ───
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 200);

// ─── Lights ───
const hemi = new THREE.HemisphereLight(0xffffff, 0x9a8f7a, 5);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff, 0.26);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff5e6, 1.1);
sun.position.set(8, 12, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 40;
sun.shadow.camera.left = -15;
sun.shadow.camera.right = 15;
sun.shadow.camera.top = 15;
sun.shadow.camera.bottom = -15;
scene.add(sun);

// ─── Ground（碁盤風グリッド・目は細かめ） ───
const GROUND_Y = 0;
const groundGeo = new THREE.PlaneGeometry(200, 200);
const groundMat = new THREE.MeshStandardMaterial({
  color: 0xe6d2b5,
  roughness: 0.88,
  metalness: 0.02,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = GROUND_Y;
ground.receiveShadow = true;
scene.add(ground);

// divisions=42 → 目の間隔を狭く（14 の約 3 倍の本数）
const grid = new THREE.GridHelper(200, 42, 0x1a1410, 0x1a1410);
grid.position.y = GROUND_Y + 0.001;
scene.add(grid);

// ─── State ───
let model: THREE.Group | null = null;
let mixer: THREE.AnimationMixer | null = null;
const actions: Record<string, THREE.AnimationAction> = {};
let modelBaseY = 0;
let playerFootOffset = 0.06;
let headBone: THREE.Object3D | null = null;
let headBaseQuat: THREE.Quaternion | null = null;

let manualMouthOpen = false;
let attackPending = false;
const appBaseUrl = new URL(import.meta.env.BASE_URL || '/', window.location.origin);
const HAND_MODEL_URL = new URL('models/hand-control-model.json', appBaseUrl).href;
const WORLD_MAP_OBJ_URL = new URL('./data/tex.obj', import.meta.url).href;
const WORLD_MAP_MTL_URL = new URL('./data/tex.mtl', import.meta.url).href;
const GAME_API_BASE = import.meta.env.VITE_GAME_API_BASE || '/game-api/v1';
const GAME_WS_BASE = import.meta.env.VITE_GAME_WS_BASE
  || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game-ws`;
const roomId = new URLSearchParams(location.search).get('room') || 'lobby';
const playerId = getOrCreatePlayerId();

let hudHandModel = '手モデル: 読み込み中';
let hudMultiplayer = `部屋: ${roomId} 接続準備中`;
let gameSocket: WebSocket | null = null;
let wsReconnectTimer: number | null = null;
const remotePlayers = new Map<string, RemotePlayer>();
let lastMoveSentAt = 0;
const MOVE_SEND_INTERVAL = 66;
let currentMoveAnimation = 'Idle';
let remoteModelTemplate: THREE.Group | null = null;
let remoteAnimationClips: THREE.AnimationClip[] = [];
let localPlayerColor = '';
let localModelTinted = false;
const worldColliders: THREE.Mesh[] = [];
const worldWalkables: THREE.Mesh[] = [];
const worldObstacles: THREE.Mesh[] = [];
const TERRAIN_MIN_NORMAL_Y = 0.45;
const MAX_STEP_UP = 0.22;
/** ワニのデフォルト高さオフセット（正で上、負で下） — ここを変えて微調整 */
const PLAYER_HEIGHT_OFFSET = 0.575;
const PLAYER_GROUND_CLEARANCE = 0.018;
const MATERIAL_002_SINK_OFFSET = 0.0022;
const PLAYER_COLLISION_RADIUS = 0.045;
const FLAT_WORLD_MODE = true;
let flatWorldY: number | null = null;

// ─── Hand Tracking State ───
let handLandmarker: HandLandmarker | null = null;
let cameraActive = false;
let lastCameraErrorMessage = '';
let smoothNeckYaw = 0;
let smoothNeckPitch = 0;
let lastHandTime = 0;
const HAND_DETECT_INTERVAL = 33; // ~30fps
const handState = { mouthOpenness: 0, neckYaw: 0, neckPitch: 0, detected: false };
let smoothMouthOpenness = 0;

const DEFAULT_HAND_CONTROL_MODEL: HandControlModel = {
  version: 1,
  mouth: {
    closedCurl: 0.35,
    openCurl: 0.8,
    openThreshold: 0.4,
  },
  neck: {
    neutralTilt: 0,
    yawGain: 1.0,
    maxYaw: 0.7,
    neutralPitchAngle: 0,
    pitchGain: -2.0,
    maxPitch: 0.5,
  },
};
let handControlModel: HandControlModel = structuredClone(DEFAULT_HAND_CONTROL_MODEL);

/**
 * 走り: 指をベース円の外へ押し出したとき（rawDist / R > 1）
 * rawStretch 1.0 = ちょうど縁、1.06 超で走行入り（ヒステリシス）
 */
const RUN_STRETCH_ENTER = 1.06;
const RUN_STRETCH_EXIT = 1.01;
let stickRunLatched = false;
const MOVE_ACCEL_SMOOTH = 11;
const MOVE_DECEL_SMOOTH = 7;
const TURN_INPUT_SMOOTH = 10;
const RUN_BLEND_SMOOTH = 7;
const IDLE_SWAY_SPEED = 0.2;
const IDLE_BOB_AMOUNT = 0.00001;
const IDLE_PITCH_AMOUNT = 0.03;
const IDLE_ROLL_AMOUNT = 0.025;
let smoothForwardInput = 0;
let smoothMoveSpeed = 0;
let smoothTurnInput = 0;
let smoothRunBlend = 0;
let idleSwayPhase = 0;
let idleBobOffset = 0;
let idlePitchOffset = 0;
let idleRollOffset = 0;

const box = new THREE.Box3();
const collisionRay = new THREE.Raycaster();
const terrainRay = new THREE.Raycaster();
const vTmpA = new THREE.Vector3();
const vTmpB = new THREE.Vector3();
const vDown = new THREE.Vector3(0, -1, 0);
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const qNeck = new THREE.Quaternion();
const clock = new THREE.Clock();

// Third-person camera params (head-close fixed follow camera)
const CAM_HEIGHT = 0.03;
const CAM_DISTANCE = 0.09;
const CAM_LOOK_AHEAD = 1.30;
const CAM_LOOK_HEIGHT = 0.14;

// ─── Joystick state ───
const joystick = {
  active: false,
  touchId: null as number | null,
  cx: 0,
  cy: 0,
  dx: 0,
  dy: 0,
  rawStretch: 0,
};
const JOYSTICK_RADIUS = 50;

const jZone = getEl<HTMLElement>('joystick-zone');
const jRunRing = document.getElementById('joystick-run-ring');
const jBase = getEl<HTMLElement>('joystick-base');
const jThumb = getEl<HTMLElement>('joystick-thumb');

function setJoystickThumbOffset(px: number, py: number) {
  jThumb.style.transform = `translate(${px}px, ${py}px)`;
}

// Fixed joystick center: center of the base element
function getJoystickCenter() {
  const rect = jBase.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function jStart(x: number, y: number, id: number) {
  joystick.active = true;
  joystick.touchId = id;
  const c = getJoystickCenter();
  joystick.cx = c.x;
  joystick.cy = c.y;
  joystick.dx = 0;
  joystick.dy = 0;
  jBase.classList.add('active');
  jMove(x, y);
}

function jMove(x: number, y: number) {
  const rawDx = x - joystick.cx;
  const rawDy = y - joystick.cy;
  const rawDist = Math.hypot(rawDx, rawDy);
  joystick.rawStretch = rawDist / JOYSTICK_RADIUS;

  let dx = rawDx;
  let dy = rawDy;
  if (rawDist > JOYSTICK_RADIUS) {
    dx = (rawDx / rawDist) * JOYSTICK_RADIUS;
    dy = (rawDy / rawDist) * JOYSTICK_RADIUS;
  }
  joystick.dx = dx / JOYSTICK_RADIUS;
  joystick.dy = dy / JOYSTICK_RADIUS;
  setJoystickThumbOffset(dx, dy);

  if (jRunRing) {
    jRunRing.classList.toggle('hot', joystick.rawStretch >= RUN_STRETCH_ENTER * 0.92);
  }
}

function jEnd() {
  joystick.active = false;
  joystick.touchId = null;
  joystick.dx = 0;
  joystick.dy = 0;
  joystick.rawStretch = 0;
  jBase.classList.remove('active');
  setJoystickThumbOffset(0, 0);
  if (jRunRing) jRunRing.classList.remove('hot');
}

jZone.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (joystick.active) return;
  const t = e.changedTouches[0];
  jStart(t.clientX, t.clientY, t.identifier);
}, { passive: false });

jZone.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joystick.touchId) jMove(t.clientX, t.clientY);
  }
}, { passive: false });

jZone.addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === joystick.touchId) jEnd();
  }
});
jZone.addEventListener('touchcancel', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === joystick.touchId) jEnd();
  }
});

// ─── Keyboard fallback (PC) ───
const keys: Record<string, boolean> = Object.create(null);
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyM') manualMouthOpen = !manualMouthOpen;
  if (e.code === 'Space') { e.preventDefault(); attackPending = true; }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

setJoystickThumbOffset(0, 0);

// ─── Hand Tracking (MediaPipe) — タップで起動（iOS Safari はユーザージェスチャー必須） ───
async function openCameraStreamPreferRear() {
  const tries = [
    { video: { facingMode: { exact: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } } },
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } } },
    { video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } } },
    { video: true },
  ];
  let lastErr = null;
  for (const c of tries) {
    try {
      // iPhone は外カメラ指定が失敗する場合があるため段階的にフォールバック
      return await navigator.mediaDevices.getUserMedia(c);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('camera open failed');
}

function errorToText(err: unknown) {
  if (!err) return 'unknown';
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && 'type' in err) return String(err.type);
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function initHandLandmarkerWithFallback() {
  const wasmRoots = [
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm',
    'https://unpkg.com/@mediapipe/tasks-vision@0.10.34/wasm',
  ];
  const delegates = ['GPU', 'CPU'] as const;
  let lastErr = null;

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

async function startCamera() {
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

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/**
 * 非ミラー表示の映像に対し、画面上の指の動きと首 yaw/pitch の体感を一致させる。
 * オーバーレイ描画は生ランドマークのまま（映像と点が一致）にし、制御だけここを通す。
 */
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
  return {
    version: 1,
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

async function loadHandControlModel() {
  try {
    const res = await fetch(HAND_MODEL_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const modelJson = await res.json();
    handControlModel = mergeHandModel(modelJson);
    hudHandModel = '手モデル: 学習済み';
    updateHudText();
    console.log('Loaded hand control model:', handControlModel);
  } catch (e: unknown) {
    handControlModel = structuredClone(DEFAULT_HAND_CONTROL_MODEL);
    hudHandModel = '手モデル: デフォルト';
    updateHudText();
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('Hand control model not found. Using default parameters.', msg);
  }
}

function showTapToStart() {
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

    // 失敗時は再試行できるように再表示
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

  // Draw landmarks on overlay
  ctx.fillStyle = '#00ff88';
  for (const p of lm) {
    ctx.beginPath();
    ctx.arc(p.x * camOverlay.width, p.y * camOverlay.height, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Draw connections (thumb-to-finger line for mouth feedback)
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
  // 微小なブレを打ち消して停止時の首ドリフトを防ぐ
  handState.neckYaw = Math.abs(yaw) < 0.035 ? 0 : yaw;
  handState.neckPitch = Math.abs(pitch) < 0.03 ? 0 : pitch;
}

function updateHandTracking(now: number) {
  if (!cameraActive || !handLandmarker || camVideo.readyState < 2) return;
  if (now - lastHandTime < HAND_DETECT_INTERVAL) return;
  lastHandTime = now;

  const results = handLandmarker.detectForVideo(camVideo, now);
  processHandResults(results);
}

function applyHeadTracking(dt: number) {
  if (!headBone || !headBaseQuat) return;
  const hasTracking = handState.detected && cameraActive;
  const targetYaw = hasTracking ? handState.neckYaw : 0;
  const targetPitch = hasTracking ? handState.neckPitch : 0;
  const speed = 9;
  smoothNeckYaw = smoothToward(smoothNeckYaw, targetYaw, dt, speed);
  smoothNeckPitch = smoothToward(smoothNeckPitch, targetPitch, dt, speed);
  euler.set(smoothNeckPitch, smoothNeckYaw, 0, 'YXZ');
  qNeck.setFromEuler(euler);
  headBone.quaternion.copy(headBaseQuat).multiply(qNeck);
}

// ─── Helpers ───
function smoothToward(current: number, target: number, dt: number, speed: number) {
  return current + (target - current) * (1 - Math.exp(-speed * dt));
}

function refreshWorldColliders(root: THREE.Group) {
  worldColliders.length = 0;
  worldWalkables.length = 0;
  worldObstacles.length = 0;
  root.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    worldColliders.push(mesh);
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
    const names = mats.map((m) => m?.name || '').join(' ').toLowerCase();
    const isMaterial002 = names.includes('материал.002');
    const isStone = names.includes('stone');
    const walkable = isMaterial002 || /(grass|ground|plane|terrain|floor|land)/.test(names);
    mesh.userData.isMaterial002 = isMaterial002;
    mesh.userData.isStone = isStone;
    if (walkable) worldWalkables.push(mesh);
    else worldObstacles.push(mesh);
  });
}

function getHitWorldNormal(hit: THREE.Intersection): THREE.Vector3 | null {
  if (!hit.face) return null;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
  return hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
}

function sampleTerrainHeight(x: number, z: number, yHint: number): number | null {
  if (!worldColliders.length) return null;
  vTmpA.set(x, yHint + 8, z);
  terrainRay.set(vTmpA, vDown);
  terrainRay.near = 0;
  terrainRay.far = 24;
  const hits = terrainRay.intersectObjects(worldColliders, false);
  for (const hit of hits) {
    // 木の上・枝の上を地面として拾わない
    if (hit.point.y > yHint + MAX_STEP_UP) continue;
    const n = getHitWorldNormal(hit);
    if (n && n.y >= TERRAIN_MIN_NORMAL_Y) return hit.point.y;
  }
  return null;
}

function sampleFlatFloorY(x: number, z: number): number | null {
  if (!worldWalkables.length) return null;
  vTmpA.set(x, 18, z);
  terrainRay.set(vTmpA, vDown);
  terrainRay.near = 0;
  terrainRay.far = 40;
  const hits = terrainRay.intersectObjects(worldWalkables, false);
  let floorY: number | null = null;
  for (const hit of hits) {
    const n = getHitWorldNormal(hit);
    if (!n || n.y < TERRAIN_MIN_NORMAL_Y) continue;
    // キャノピーや枝を避けるため、最下段の上向き面を採用する
    if (floorY == null || hit.point.y < floorY) floorY = hit.point.y;
  }
  return floorY;
}

function sampleMaterial002SinkOffset(x: number, z: number): number {
  if (!worldWalkables.length) return 0;
  vTmpA.set(x, 18, z);
  terrainRay.set(vTmpA, vDown);
  terrainRay.near = 0;
  terrainRay.far = 40;
  const hits = terrainRay.intersectObjects(worldWalkables, false);
  for (const hit of hits) {
    const n = getHitWorldNormal(hit);
    if (!n || n.y < TERRAIN_MIN_NORMAL_Y) continue;
    const mesh = hit.object as THREE.Mesh;
    if (mesh.userData.isMaterial002) return MATERIAL_002_SINK_OFFSET;
    return 0;
  }
  return 0;
}

function alignModelToFlatWorld(forceSnap = false) {
  if (!FLAT_WORLD_MODE || !model) return;
  if (flatWorldY == null && worldColliders.length) {
    flatWorldY = sampleFlatFloorY(model.position.x, model.position.z);
    if (flatWorldY == null) flatWorldY = GROUND_Y;
  }
  if (flatWorldY != null) {
    const sink = sampleMaterial002SinkOffset(model.position.x, model.position.z);
    modelBaseY = flatWorldY + playerFootOffset + PLAYER_GROUND_CLEARANCE + PLAYER_HEIGHT_OFFSET - sink;
    if (forceSnap) model.position.y = modelBaseY;
  }
}

function canMoveOnWorld(nextX: number, nextZ: number): boolean {
  if (!model || !worldObstacles.length) return true;
  const cur = model.position;
  vTmpA.set(nextX - cur.x, 0, nextZ - cur.z);
  const dist = vTmpA.length();
  if (dist < 1e-5) return true;
  vTmpA.multiplyScalar(1 / dist);
  const sideX = -vTmpA.z;
  const sideZ = vTmpA.x;
  const offsets = [0, PLAYER_COLLISION_RADIUS * 0.55, -PLAYER_COLLISION_RADIUS * 0.55];
  const heights = [0.04, playerFootOffset * 0.7];

  for (const h of heights) {
    for (const off of offsets) {
      vTmpB.set(cur.x + sideX * off, cur.y + h, cur.z + sideZ * off);
      collisionRay.set(vTmpB, vTmpA);
      collisionRay.near = 0.001;
      collisionRay.far = dist + PLAYER_COLLISION_RADIUS * 0.8;
      const hits = collisionRay.intersectObjects(worldObstacles, false);
      if (!hits.length) continue;
      for (const hit of hits) {
        const mesh = hit.object as THREE.Mesh;
        const aroundBody = hit.point.y > (cur.y - 0.08) && hit.point.y < (cur.y + playerFootOffset * 1.9);
        if (mesh.userData.isStone) {
          // 石は近距離でのめり込みだけを止める（遠めでの過剰ブロックを避ける）
          if (aroundBody && hit.distance <= dist + PLAYER_COLLISION_RADIUS * 0.3) return false;
          continue;
        }
        const n = getHitWorldNormal(hit);
        if (!n) continue;
        const isWallLike = Math.abs(n.y) < 0.6;
        if (isWallLike && aroundBody) return false;
      }
    }
  }
  return true;
}

// ─── Animation setup ───
const CLIP_NAMES = [
  'Walk', 'Run', 'Idle',
  'Walk_MouthOpen', 'Run_MouthOpen', 'Idle_MouthOpen',
  'Attack', 'TailWag',
];

function setupActions(gltf: GLTF) {
  mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.addEventListener('finished', (e: object) => {
    const ev = e as { action: THREE.AnimationAction };
    if (ev.action === actions.Attack) ev.action.fadeOut(0.18);
  });
  for (const clip of gltf.animations) {
    const a = mixer.clipAction(clip);
    a.enabled = true;
    if (clip.name === 'Attack') {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    } else {
      a.setLoop(THREE.LoopRepeat, Infinity);
    }
    a.play();
    a.setEffectiveWeight(0);
    actions[clip.name] = a;
  }
  for (const n of CLIP_NAMES) {
    if (!actions[n]) console.warn('Missing clip:', n);
  }
  if (actions.Idle) actions.Idle.setEffectiveWeight(1);
  if (actions.TailWag) actions.TailWag.setEffectiveWeight(0);
}

// ─── Locomotion ───
function setLocomotionWeights(speed: number, mouthAmount: number, runBlend: number) {
  const move = clamp(speed, 0, 1);
  const run = clamp(runBlend, 0, 1);
  const runGate = clamp((move - 0.42) / 0.36, 0, 1);
  const runWeight = move * run * runGate;
  const walkWeight = clamp(move - runWeight, 0, 1);
  const idleWeight = clamp(1 - move, 0, 1);
  const sum = Math.max(0.0001, idleWeight + walkWeight + runWeight);
  const idle = idleWeight / sum;
  const walk = walkWeight / sum;
  const fast = runWeight / sum;
  const closed = 1 - mouthAmount;

  const w = {
    Idle: idle * closed,
    Walk: walk * closed,
    Run: fast * closed,
    Idle_MouthOpen: idle * mouthAmount,
    Walk_MouthOpen: walk * mouthAmount,
    Run_MouthOpen: fast * mouthAmount,
  };
  for (const [name, wt] of Object.entries(w)) {
    if (actions[name]) actions[name].setEffectiveWeight(wt);
  }
}

// ─── Movement & character update ───
function getInputVector() {
  let ix = joystick.dx;
  let iz = joystick.dy;

  if (keys['KeyW'] || keys['ArrowUp']) iz -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) iz += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;

  const len = Math.sqrt(ix * ix + iz * iz);
  if (len > 1) { ix /= len; iz /= len; }
  return { ix, iz, len: Math.min(len, 1) };
}

function updateCharacter(dt: number) {
  if (!model || !mixer) return;

  const { ix, iz, len } = getInputVector();
  const inputSpeed = len;
  const targetForward = inputSpeed > 0.001 ? -iz : 0;
  const accelSpeed = Math.abs(targetForward) > Math.abs(smoothForwardInput) ? MOVE_ACCEL_SMOOTH : MOVE_DECEL_SMOOTH;
  smoothForwardInput = smoothToward(smoothForwardInput, targetForward, dt, accelSpeed);
  smoothMoveSpeed = smoothToward(smoothMoveSpeed, Math.abs(smoothForwardInput), dt, accelSpeed);
  smoothTurnInput = smoothToward(smoothTurnInput, ix, dt, TURN_INPUT_SMOOTH);
  const targetMouth = handState.detected ? handState.mouthOpenness : (manualMouthOpen ? 1 : 0);
  smoothMouthOpenness = smoothToward(smoothMouthOpenness, targetMouth, dt, 10);
  const stretch = joystick.active ? joystick.rawStretch : 0;
  if (stretch >= RUN_STRETCH_ENTER) stickRunLatched = true;
  else if (stretch <= RUN_STRETCH_EXIT) stickRunLatched = false;
  const stickRun = stickRunLatched;
  const runNow = (stickRun || keys['ShiftLeft'] || keys['ShiftRight']) && smoothMoveSpeed > 0.06;
  smoothRunBlend = smoothToward(smoothRunBlend, runNow ? 1 : 0, dt, RUN_BLEND_SMOOTH);
  if (smoothMoveSpeed > 0.56 && smoothRunBlend > 0.45) currentMoveAnimation = 'Run';
  else if (smoothMoveSpeed > 0.07) currentMoveAnimation = 'Walk';
  else currentMoveAnimation = 'Idle';
  if (smoothMouthOpenness > 0.5) currentMoveAnimation = `${currentMoveAnimation}_MouthOpen`;

  if (smoothMoveSpeed > 0.005) {
    const moveSpeed = 0.15 + (0.23 - 0.15) * smoothRunBlend;

    // Joystick up (-iz) = wani forward, ix = turn
    const turnRate = 3.5;
    model.rotation.y -= smoothTurnInput * turnRate * dt;

    const yaw = model.rotation.y;
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);

    const forward = smoothForwardInput;
    const nextX = model.position.x + fwdX * forward * moveSpeed * dt;
    const nextZ = model.position.z + fwdZ * forward * moveSpeed * dt;
    if (canMoveOnWorld(nextX, nextZ)) {
      model.position.x = nextX;
      model.position.z = nextZ;
    }
  }

  setLocomotionWeights(smoothMoveSpeed, smoothMouthOpenness, smoothRunBlend);

  if (attackPending && actions.Attack) {
    attackPending = false;
    actions.Attack.reset();
    actions.Attack.setEffectiveWeight(1);
    actions.Attack.fadeIn(0.06);
    actions.Attack.play();
  }

  mixer.update(dt);
  applyHeadTracking(dt);

  if (FLAT_WORLD_MODE) {
    // フラット地形モード: 高さは固定（木・岩を地面として拾って登らない）
    alignModelToFlatWorld(false);
    model.position.y = smoothToward(model.position.y, modelBaseY, dt, 18);
    box.setFromObject(model);
    const minAllowedY = GROUND_Y + PLAYER_GROUND_CLEARANCE;
    if (box.min.y < minAllowedY) {
      model.position.y += minAllowedY - box.min.y;
      modelBaseY = model.position.y;
    }
  } else {
    const terrainY = sampleTerrainHeight(model.position.x, model.position.z, model.position.y);
    if (terrainY != null) {
      const targetY = terrainY + playerFootOffset;
      if (model.position.y < targetY) model.position.y = targetY;
      else model.position.y = smoothToward(model.position.y, targetY, dt, 14);
    } else {
      // fallback: 既存の平面地面
      box.setFromObject(model);
      if (box.min.y < GROUND_Y) {
        model.position.y += GROUND_Y - box.min.y;
      } else {
        model.position.y = smoothToward(model.position.y, modelBaseY, dt, 6);
      }
    }
  }
  const idleWeight = clamp((0.12 - smoothMoveSpeed) / 0.12, 0, 1);
  idleSwayPhase += dt * (IDLE_SWAY_SPEED + idleWeight * 0.6);
  const targetBob = (Math.sin(idleSwayPhase * 2.0) * IDLE_BOB_AMOUNT
    + Math.sin(idleSwayPhase * 4.3) * (IDLE_BOB_AMOUNT * 0.32)) * idleWeight;
  const targetPitch = Math.sin(idleSwayPhase * 1.5) * IDLE_PITCH_AMOUNT * idleWeight;
  const targetRoll = Math.sin(idleSwayPhase * 1.2 + 0.8) * IDLE_ROLL_AMOUNT * idleWeight;
  idleBobOffset = smoothToward(idleBobOffset, targetBob, dt, 8);
  idlePitchOffset = smoothToward(idlePitchOffset, targetPitch, dt, 7);
  idleRollOffset = smoothToward(idleRollOffset, targetRoll, dt, 7);
  model.position.y += idleBobOffset;
  model.rotation.x = idlePitchOffset;
  model.rotation.z = idleRollOffset;
}

// ─── Third-person camera ───
function updateCamera() {
  if (!model) return;

  const yaw = model.rotation.y;
  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);
  const camAnchorY = model.position.y - idleBobOffset;

  // Fixed offset from wani to avoid apparent zoom when turning.
  const targetPos = new THREE.Vector3(
    model.position.x - fwdX * CAM_DISTANCE,
    camAnchorY + CAM_HEIGHT,
    model.position.z - fwdZ * CAM_DISTANCE
  );
  // Look-ahead in facing direction for third-person head-close view.
  const targetLook = new THREE.Vector3(
    model.position.x + fwdX * CAM_LOOK_AHEAD,
    camAnchorY + CAM_LOOK_HEIGHT,
    model.position.z + fwdZ * CAM_LOOK_AHEAD
  );
  camera.position.copy(targetPos);
  camera.lookAt(targetLook);

  sun.position.set(model.position.x + 8, 12, model.position.z + 6);
  sun.target.position.set(model.position.x, camAnchorY, model.position.z);
  sun.target.updateMatrixWorld();
}

function createRemoteProxyRoot(): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.08, 0.14, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x5aa9ff, roughness: 0.6, metalness: 0.05 })
  );
  body.castShadow = true;
  body.receiveShadow = true;
  body.position.y = 0.11;
  root.add(body);

  const direction = new THREE.Mesh(
    new THREE.ConeGeometry(0.05, 0.12, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.6, metalness: 0.05 })
  );
  direction.rotation.x = Math.PI / 2;
  direction.position.set(0, 0.11, 0.14);
  direction.castShadow = true;
  root.add(direction);
  return root;
}

function createRemoteModelRoot(): { root: THREE.Group; mixer: THREE.AnimationMixer; actions: Record<string, THREE.AnimationAction> } | null {
  if (!remoteModelTemplate) return null;
  const root = cloneSkinned(remoteModelTemplate) as THREE.Group;
  root.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  const mixer = new THREE.AnimationMixer(root);
  const actions: Record<string, THREE.AnimationAction> = {};
  for (const clip of remoteAnimationClips) {
    const action = mixer.clipAction(clip);
    action.enabled = true;
    action.play();
    action.setEffectiveWeight(0);
    actions[clip.name] = action;
  }
  if (actions.Idle) actions.Idle.setEffectiveWeight(1);
  if (actions.TailWag) actions.TailWag.setEffectiveWeight(0);

  return { root, mixer, actions };
}

function getRemoteHead(root: THREE.Group): { headBone: THREE.Object3D | null; headBaseQuat: THREE.Quaternion | null } {
  const head = root.getObjectByName('head') ?? null;
  return {
    headBone: head,
    headBaseQuat: head ? head.quaternion.clone() : null,
  };
}

function setRemoteAnimation(remote: RemotePlayer, name: string) {
  if (!remote.mixer) return;
  const wanted = remote.actions[name] ? name : (name.startsWith('Run') ? 'Run' : name.startsWith('Walk') ? 'Walk' : 'Idle');
  for (const n of CLIP_NAMES) {
    const a = remote.actions[n];
    if (!a) continue;
    const weight = n === wanted ? 1 : 0;
    a.setEffectiveWeight(weight);
  }
}

function makeRemotePlayer(player: NetPlayerState): RemotePlayer {
  const remoteModel = createRemoteModelRoot();
  const root = remoteModel?.root ?? createRemoteProxyRoot();
  const remoteHead = remoteModel ? getRemoteHead(root) : { headBone: null, headBaseQuat: null };

  if (player.color && remoteModel) tintModel(root, player.color);

  const ib = player.idleBob ?? 0;
  root.position.set(player.x, player.y + ib, player.z);
  root.rotation.y = player.rotationY;
  root.rotation.x = player.idlePitch ?? 0;
  root.rotation.z = player.idleRoll ?? 0;
  scene.add(root);

  const remote: RemotePlayer = {
    root,
    targetPos: new THREE.Vector3(player.x, player.y, player.z),
    targetYaw: player.rotationY,
    targetNeckYaw: player.neckYaw ?? 0,
    targetNeckPitch: player.neckPitch ?? 0,
    targetIdleBob: player.idleBob ?? 0,
    targetIdlePitch: player.idlePitch ?? 0,
    targetIdleRoll: player.idleRoll ?? 0,
    smoothIdleBob: player.idleBob ?? 0,
    smoothIdlePitch: player.idlePitch ?? 0,
    smoothIdleRoll: player.idleRoll ?? 0,
    prevIdleBob: ib,
    smoothNeckYaw: 0,
    smoothNeckPitch: 0,
    headBone: remoteHead.headBone,
    headBaseQuat: remoteHead.headBaseQuat,
    desiredAnimation: player.animation || 'Idle',
    actions: remoteModel?.actions ?? {},
    mixer: remoteModel?.mixer ?? null,
    isProxy: !remoteModel,
    color: player.color || '',
  };
  setRemoteAnimation(remote, remote.desiredAnimation);
  return remote;
}

function upgradeRemoteVisualIfReady(remote: RemotePlayer) {
  if (!remote.isProxy || !remoteModelTemplate) return;
  const remoteModel = createRemoteModelRoot();
  if (!remoteModel) return;

  scene.remove(remote.root);
  remote.root = remoteModel.root;
  remote.actions = remoteModel.actions;
  remote.mixer = remoteModel.mixer;
  remote.isProxy = false;
  if (remote.color) tintModel(remote.root, remote.color);
  const remoteHead = getRemoteHead(remote.root);
  remote.headBone = remoteHead.headBone;
  remote.headBaseQuat = remoteHead.headBaseQuat;
  remote.smoothNeckYaw = 0;
  remote.smoothNeckPitch = 0;
  remote.root.position.copy(remote.targetPos);
  remote.root.position.y += remote.smoothIdleBob;
  remote.prevIdleBob = remote.smoothIdleBob;
  remote.root.rotation.y = remote.targetYaw;
  remote.root.rotation.x = remote.smoothIdlePitch;
  remote.root.rotation.z = remote.smoothIdleRoll;
  scene.add(remote.root);
  setRemoteAnimation(remote, remote.desiredAnimation);
}

function refreshRemoteVisualsAfterModelLoaded() {
  for (const remote of remotePlayers.values()) {
    upgradeRemoteVisualIfReady(remote);
  }
}

/** ワニモデルのスケール — ここを変えてサイズ調整 */
const WANI_SCALE = 2;

function normalizeCharacterRoot(root: THREE.Group) {
  root.scale.setScalar(WANI_SCALE);
  root.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(root);
  const center = b.getCenter(new THREE.Vector3());
  root.position.sub(center);
  root.position.y = GROUND_Y - b.min.y;
}

const TINT_SKIP_NAME =
  /tongue|mouth|gum|teeth|tooth|lip|inner|oral|palate|saliva|口|舌|歯|歯茎|唇|目|eye|pupil|iris/i;

function isLikelyOralInterior(mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial): boolean {
  const c = mat.color;
  const r = c.r;
  const g = c.g;
  const b = c.b;
  if (r > g + 0.04) return true;
  if (r > 0.35 && g < 0.28 && b < 0.35) return true;
  return false;
}

/** テクスチャ付き体メッシュのアルベドをどれだけプレイヤー色へ寄せるか（大きいほど色の差がはっきり） */
const BODY_TINT_MAP_BLEND = 0.88;
const BODY_TINT_SOLID_BLEND = 0.78;
/** ライトに頼らず体色の差を付ける（口内除外メッシュのみ） */
const BODY_EMISSIVE_MUL = 0.35;
const BODY_EMISSIVE_INTENSITY = 0.55;

function applyTintToMaterial(
  src: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  tint: THREE.Color,
  white: THREE.Color
): THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
  const clone = src.clone() as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
  if (src.map) {
    clone.color.copy(white).lerp(tint, BODY_TINT_MAP_BLEND);
  } else {
    clone.color.copy(src.color).lerp(tint, BODY_TINT_SOLID_BLEND);
  }
  clone.emissive.copy(tint).multiplyScalar(BODY_EMISSIVE_MUL);
  clone.emissiveIntensity = BODY_EMISSIVE_INTENSITY;
  return clone;
}

function tintModel(root: THREE.Object3D, hexColor: string) {
  if (!hexColor) return;
  const tint = new THREE.Color(hexColor);
  const white = new THREE.Color(0xffffff);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (TINT_SKIP_NAME.test(mesh.name)) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let i = 0; i < mats.length; i++) {
      const raw = mats[i];
      if (!raw || typeof raw !== 'object' || !('isMaterial' in raw)) continue;
      const src = raw as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
      if (!src.isMeshStandardMaterial) continue;
      if (TINT_SKIP_NAME.test(src.name)) continue;
      if (isLikelyOralInterior(src)) continue;
      const clone = applyTintToMaterial(src, tint, white);
      if (Array.isArray(mesh.material)) {
        mesh.material[i] = clone;
      } else {
        mesh.material = clone;
      }
    }
  });
}

function disposeRemotePlayer(remote: RemotePlayer) {
  if (remote.mixer) remote.mixer.stopAllAction();
  scene.remove(remote.root);
}

function removeRemotePlayer(playerID: string) {
  const remote = remotePlayers.get(playerID);
  if (!remote) return;
  disposeRemotePlayer(remote);
  remotePlayers.delete(playerID);
}

function applyRoomSnapshot(snapshot: RoomSnapshot) {
  const aliveIDs = new Set<string>();

  for (const p of snapshot.players) {
    if (p.playerId === playerId) {
      if (p.color) {
        localPlayerColor = p.color;
        if (model && !localModelTinted) {
          tintModel(model, localPlayerColor);
          localModelTinted = true;
        }
      }
      continue;
    }
    aliveIDs.add(p.playerId);
    let remote = remotePlayers.get(p.playerId);
    if (!remote) {
      remote = makeRemotePlayer(p);
      remotePlayers.set(p.playerId, remote);
    } else {
      if (p.color && p.color !== remote.color) {
        remote.color = p.color;
        if (!remote.isProxy) tintModel(remote.root, remote.color);
      }
      upgradeRemoteVisualIfReady(remote);
    }
    remote.targetPos.set(p.x, p.y, p.z);
    remote.targetYaw = p.rotationY;
    remote.targetNeckYaw = p.neckYaw ?? 0;
    remote.targetNeckPitch = p.neckPitch ?? 0;
    remote.targetIdleBob = p.idleBob ?? 0;
    remote.targetIdlePitch = p.idlePitch ?? 0;
    remote.targetIdleRoll = p.idleRoll ?? 0;
    remote.desiredAnimation = p.animation || 'Idle';
    setRemoteAnimation(remote, remote.desiredAnimation);
  }

  for (const id of remotePlayers.keys()) {
    if (!aliveIDs.has(id)) removeRemotePlayer(id);
  }

  hudMultiplayer = `部屋: ${snapshot.roomId} 同期中 ${snapshot.players.length}人`;
  updateHudText();
}

async function joinRoom() {
  const res = await fetch(`${GAME_API_BASE}/rooms/${encodeURIComponent(roomId)}/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId }),
  });
  if (!res.ok) throw new Error(`join failed: HTTP ${res.status}`);
  const payload = await res.json() as { snapshot?: RoomSnapshot };
  if (payload.snapshot) {
    const me = payload.snapshot.players.find(p => p.playerId === playerId);
    console.log(`[joinRoom] myColor=${me?.color}, model=${!!model}, playerId=${playerId}`);
    if (me?.color) {
      localPlayerColor = me.color;
      if (model && !localModelTinted) {
        tintModel(model, localPlayerColor);
        localModelTinted = true;
      }
    }
    applyRoomSnapshot(payload.snapshot);
  }
}

async function leaveRoom() {
  try {
    await fetch(`${GAME_API_BASE}/rooms/${encodeURIComponent(roomId)}/players/${encodeURIComponent(playerId)}`, {
      method: 'DELETE',
      keepalive: true,
    });
  } catch {
    // ページ離脱時の失敗は許容する
  }
}

function connectGameSocket() {
  if (gameSocket && (gameSocket.readyState === WebSocket.OPEN || gameSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const url = `${GAME_WS_BASE}?roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(playerId)}`;
  hudMultiplayer = `部屋: ${roomId} 接続中`;
  updateHudText();
  const ws = new WebSocket(url);
  gameSocket = ws;

  ws.addEventListener('open', () => {
    hudMultiplayer = `部屋: ${roomId} 接続済み`;
    updateHudText();
  });

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data) as WsSnapshotEnvelope;
      if (msg.type === 'snapshot' && msg.payload) {
        applyRoomSnapshot(msg.payload);
      }
    } catch (err) {
      console.warn('WS parse error:', err);
    }
  });

  ws.addEventListener('close', () => {
    gameSocket = null;
    hudMultiplayer = `部屋: ${roomId} 再接続待ち`;
    updateHudText();
    if (wsReconnectTimer != null) window.clearTimeout(wsReconnectTimer);
    wsReconnectTimer = window.setTimeout(() => {
      connectGameSocket();
    }, 1500);
  });

  ws.addEventListener('error', () => {
    ws.close();
  });
}

function sendLocalMove(now: number) {
  if (!model || !gameSocket || gameSocket.readyState !== WebSocket.OPEN) return;
  if (now - lastMoveSentAt < MOVE_SEND_INTERVAL) return;
  lastMoveSentAt = now;
  gameSocket.send(JSON.stringify({
    type: 'move',
    payload: {
      x: model.position.x,
      y: model.position.y - idleBobOffset,
      z: model.position.z,
      rotationY: model.rotation.y,
      neckYaw: smoothNeckYaw,
      neckPitch: smoothNeckPitch,
      animation: currentMoveAnimation,
      idleBob: idleBobOffset,
      idlePitch: idlePitchOffset,
      idleRoll: idleRollOffset,
    },
  }));
}

function updateRemotePlayers(dt: number) {
  const lerpT = 1 - Math.exp(-8 * dt);
  for (const remote of remotePlayers.values()) {
    remote.root.position.y -= remote.prevIdleBob;
    remote.root.position.lerp(remote.targetPos, lerpT);
    remote.smoothIdleBob = smoothToward(remote.smoothIdleBob, remote.targetIdleBob, dt, 14);
    remote.smoothIdlePitch = smoothToward(remote.smoothIdlePitch, remote.targetIdlePitch, dt, 10);
    remote.smoothIdleRoll = smoothToward(remote.smoothIdleRoll, remote.targetIdleRoll, dt, 10);
    remote.root.position.y += remote.smoothIdleBob;
    remote.prevIdleBob = remote.smoothIdleBob;

    remote.root.rotation.y += (remote.targetYaw - remote.root.rotation.y) * lerpT;
    remote.root.rotation.x = remote.smoothIdlePitch;
    remote.root.rotation.z = remote.smoothIdleRoll;

    if (remote.headBone && remote.headBaseQuat) {
      remote.smoothNeckYaw = smoothToward(remote.smoothNeckYaw, remote.targetNeckYaw, dt, 10);
      remote.smoothNeckPitch = smoothToward(remote.smoothNeckPitch, remote.targetNeckPitch, dt, 10);
      const neckEuler = new THREE.Euler(remote.smoothNeckPitch, remote.smoothNeckYaw, 0, 'YXZ');
      const neckQuat = new THREE.Quaternion().setFromEuler(neckEuler);
      remote.headBone.quaternion.copy(remote.headBaseQuat).multiply(neckQuat);
    }

    remote.mixer?.update(dt);
  }
}

async function initMultiplayer() {
  try {
    await joinRoom();
    connectGameSocket();
  } catch (err) {
    hudMultiplayer = `部屋: ${roomId} 参加失敗`;
    updateHudText();
    console.error(err);
  }
}

// ─── Resize ───
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── Load model ───
const MODEL_URL = new URL('modeling/Wani_game.glb', appBaseUrl).href;

let loadSettled = false;
const loadSlowTimer = window.setTimeout(() => {
  if (!loadSettled) {
    loadText.textContent = '読み込みに時間がかかっています…（約20MB）Wi‑Fi を確認するか、PC で npm run dev を起動したままにしてください。';
  }
}, 12000);

function hideLoading() {
  loadSettled = true;
  window.clearTimeout(loadSlowTimer);
  loadingEl.classList.add('hidden');
  setTimeout(() => { loadingEl.style.display = 'none'; }, 500);
  showTapToStart();
}

function showLoadError(msg: string) {
  loadSettled = true;
  window.clearTimeout(loadSlowTimer);
  loadText.textContent = msg;
  loadBar.style.width = '100%';
  loadBar.style.background = '#f44';
}

const loader = new GLTFLoader();
const mtlLoader = new MTLLoader();
const objLoader = new OBJLoader();

function normalizeWorldMap(object: THREE.Group) {
  const b0 = new THREE.Box3().setFromObject(object);
  const size = b0.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const targetSpan = 3;
  if (maxDim > 0.001) {
    object.scale.setScalar(targetSpan / maxDim);
  }

  const b1 = new THREE.Box3().setFromObject(object);
  const center = b1.getCenter(new THREE.Vector3());
  object.position.sub(center);
  const b2 = new THREE.Box3().setFromObject(object);
  object.position.y += GROUND_Y - b2.min.y;
}

async function loadWorldMap() {
  try {
    const mtl = await mtlLoader.loadAsync(WORLD_MAP_MTL_URL);
    mtl.preload();
    objLoader.setMaterials(mtl);
    const obj = await objLoader.loadAsync(WORLD_MAP_OBJ_URL);
    obj.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      const mats = Array.isArray(material) ? material : (material ? [material] : []);
      for (const m of mats) {
        m.side = THREE.FrontSide;
        // tex.mtl の色味を優先する（追加の色補正は行わない）
        m.needsUpdate = true;
      }
    });

    normalizeWorldMap(obj);
    scene.add(obj);
    refreshWorldColliders(obj);
    if (FLAT_WORLD_MODE) {
      // 地面材質（Grass/Plane 等）だけで床Yを決定し、木の根元や岩底面を除外
      const y = sampleFlatFloorY(0, 0);
      if (y != null) {
        obj.position.y += GROUND_Y - y;
        refreshWorldColliders(obj);
        flatWorldY = GROUND_Y;
      }
    }
    // 森林OBJに地面ポリゴンが無いので、既存 ground は残して下地に使う
    ground.visible = true;
    grid.visible = false;
    if (model && !FLAT_WORLD_MODE) {
      const y = sampleTerrainHeight(model.position.x, model.position.z, model.position.y);
      if (y != null) model.position.y = y + playerFootOffset;
    }
    alignModelToFlatWorld(true);
    console.log('World map loaded:', WORLD_MAP_OBJ_URL);
  } catch (e) {
    console.warn('World map load failed, fallback to default ground.', e);
  }
}

/** GLTFLoader が外部バッファを解決するときのベース（相対 URI 用） */
function gltfBasePath(url: string) {
  const i = url.lastIndexOf('/');
  return i >= 0 ? url.slice(0, i + 1) : '';
}

/**
 * iOS Safari では fetch + ReadableStream が完了しないことがあるため、
 * XHR + arraybuffer を優先する。
 */
function loadBinaryWithXHR(
  url: string,
  onProgress: ((pct: number, loaded: number, total: number) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';

    const onAbort = () => {
      xhr.abort();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const pct = Math.min(100, Math.round((e.loaded / e.total) * 100));
        onProgress(pct, e.loaded, e.total);
      } else if (onProgress && e.loaded) {
        onProgress(0, e.loaded, 0);
      }
    };
    xhr.onload = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as ArrayBuffer);
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new Error('ネットワークエラー（XHR）'));
    };
    xhr.onabort = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    xhr.send();
  });
}

async function applyLoadedGltf(gltf: GLTF) {
  model = gltf.scene;
  model.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  scene.add(model);

  normalizeCharacterRoot(model);
  box.setFromObject(model);
  playerFootOffset = Math.max(0.03, model.position.y - box.min.y);
  modelBaseY = model.position.y;
  alignModelToFlatWorld(true);
  remoteModelTemplate = cloneSkinned(model) as THREE.Group;
  remoteAnimationClips = gltf.animations;
  console.log(`[applyLoadedGltf] localPlayerColor=${localPlayerColor}`);
  if (localPlayerColor && !localModelTinted) {
    tintModel(model, localPlayerColor);
    localModelTinted = true;
  }
  refreshRemoteVisualsAfterModelLoaded();

  setupActions(gltf);
  headBone = model.getObjectByName('head') ?? null;
  headBaseQuat = headBone ? headBone.quaternion.clone() : null;

  const initYaw = model.rotation.y;
  const initFwdX = Math.sin(initYaw);
  const initFwdZ = Math.cos(initYaw);
  camera.position.set(
    model.position.x - initFwdX * CAM_DISTANCE,
    model.position.y + CAM_HEIGHT,
    model.position.z - initFwdZ * CAM_DISTANCE
  );
  camera.lookAt(
    model.position.x + initFwdX * CAM_LOOK_AHEAD,
    model.position.y + CAM_LOOK_HEIGHT,
    model.position.z + initFwdZ * CAM_LOOK_AHEAD
  );

  hideLoading();
}

async function loadModel() {
  const downloadTimeoutMs = 300000;
  const parseTimeoutMs = 120000;
  const ctrl = new AbortController();
  const tid = window.setTimeout(() => ctrl.abort(), downloadTimeoutMs);

  let arrayBuffer: ArrayBuffer | undefined;

  try {
    loadText.textContent = '接続中…';
    loadBar.style.width = '5%';

    try {
      arrayBuffer = await loadBinaryWithXHR(
        MODEL_URL,
        (pct, loaded, total) => {
          loadBar.style.width = `${Math.max(5, pct)}%`;
          if (total > 0) {
            loadText.textContent = `読み込み中… ${pct}% (${(loaded / (1024 * 1024)).toFixed(1)} MB)`;
          } else {
            loadText.textContent = `読み込み中… ${(loaded / (1024 * 1024)).toFixed(1)} MB`;
          }
        },
        ctrl.signal
      );
    } catch (xhrErr: unknown) {
      window.clearTimeout(tid);
      if ((xhrErr as { name?: string })?.name === 'AbortError') throw xhrErr;
      loadText.textContent = 'XHR失敗、fetch で再試行…';
      const ctrl2 = new AbortController();
      const tid2 = window.setTimeout(() => ctrl2.abort(), downloadTimeoutMs);
      try {
        const res = await fetch(MODEL_URL, { signal: ctrl2.signal, cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('text/html')) {
          showLoadError(`HTML が返りました（URL誤り）。\n${MODEL_URL}`);
          return;
        }
        arrayBuffer = await res.arrayBuffer();
        loadBar.style.width = '100%';
      } finally {
        window.clearTimeout(tid2);
      }
    }

    window.clearTimeout(tid);

    if (!arrayBuffer || arrayBuffer.byteLength < 12) {
      showLoadError('データが短すぎます。npm run build:model と npm run dev の再起動を試してください。');
      return;
    }

    const magic = new DataView(arrayBuffer, 0, 4).getUint32(0, true);
    if (magic !== 0x46546c67) {
      const head = new TextDecoder().decode(new Uint8Array(arrayBuffer, 0, Math.min(200, arrayBuffer.byteLength)));
      showLoadError(
        `glTF ではありません。\n先頭: ${head.slice(0, 100).replace(/\s+/g, ' ')}\n${MODEL_URL}`
      );
      return;
    }

    loadBar.style.width = '100%';
    loadText.textContent = '解析中…（10〜40秒かかることがあります）';

    const basePath = gltfBasePath(MODEL_URL);
    let parseTick = 0;
    const parseUi = window.setInterval(() => {
      parseTick += 1;
      loadText.textContent = `解析中${'.'.repeat((parseTick % 3) + 1)}（大きなモデルは時間がかかります）`;
    }, 500);

    const parsePromise = loader.parseAsync(arrayBuffer, basePath);
    const timeoutPromise = new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error('解析がタイムアウトしました（端末のメモリ不足の可能性）')), parseTimeoutMs);
    });

    let gltf: GLTF;
    try {
      gltf = await Promise.race([parsePromise, timeoutPromise]) as GLTF;
    } finally {
      window.clearInterval(parseUi);
    }

    try {
      await applyLoadedGltf(gltf);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showLoadError(`初期化エラー: ${msg}`);
      console.error(e);
    }
  } catch (e: unknown) {
    window.clearTimeout(tid);
    const err = e as { name?: string; message?: string };
    if (err.name === 'AbortError') {
      showLoadError(
        `${downloadTimeoutMs / 1000}秒でタイムアウトしました。\n${MODEL_URL}\n\n同じWi‑Fiか、PCで npm run dev が動いているか確認してください。`
      );
    } else {
      showLoadError(`読み込み失敗: ${err.message || String(e)}\n${MODEL_URL}`);
    }
    console.error(e);
  }
}

updateHudText();
void initMultiplayer();
void loadWorldMap();
void loadHandControlModel();
void loadModel();

window.addEventListener('beforeunload', () => {
  if (wsReconnectTimer != null) window.clearTimeout(wsReconnectTimer);
  if (gameSocket) gameSocket.close();
  void leaveRoom();
});

// ─── Main loop ───
function loop(timestamp: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  const now = timestamp || performance.now();
  updateHandTracking(now);
  updateCharacter(dt);
  sendLocalMove(now);
  updateRemotePlayers(dt);
  updateCamera();
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);
