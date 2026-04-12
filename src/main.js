import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// ─── DOM ───
const canvas = document.getElementById('game-canvas');
const loadingEl = document.getElementById('loading');
const loadBar = document.getElementById('load-bar');
const loadText = document.getElementById('load-text');
const hudText = document.getElementById('hud-text');
const camVideo = document.getElementById('cam-video');
const camPreview = document.getElementById('cam-preview');
const camOverlay = document.getElementById('cam-overlay');
const tapStartEl = document.getElementById('tap-start');

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
const hemi = new THREE.HemisphereLight(0x87ceeb, 0x556b2f, 0.7);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff5e6, 1.2);
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
let model = null;
let mixer = null;
const actions = {};
let modelBaseY = 0;
let headBone = null;

let mouthOpen = false;
let attackPending = false;
const appBaseUrl = new URL(import.meta.env.BASE_URL || '/', window.location.origin);
const HAND_MODEL_URL = new URL('models/hand-control-model.json', appBaseUrl).href;

// ─── Hand Tracking State ───
let handLandmarker = null;
let cameraActive = false;
let lastCameraErrorMessage = '';
let smoothNeckYaw = 0;
let smoothNeckPitch = 0;
let lastHandTime = 0;
const HAND_DETECT_INTERVAL = 66; // ~15fps
const handState = { mouthOpenness: 0, neckYaw: 0, neckPitch: 0, detected: false };
const DEFAULT_HAND_CONTROL_MODEL = {
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
let handControlModel = structuredClone(DEFAULT_HAND_CONTROL_MODEL);
let handModelLoaded = false;

/**
 * 走り: 指をベース円の外へ押し出したとき（rawDist / R > 1）
 * rawStretch 1.0 = ちょうど縁、1.06 超で走行入り（ヒステリシス）
 */
const RUN_STRETCH_ENTER = 1.06;
const RUN_STRETCH_EXIT = 1.01;
let stickRunLatched = false;

const box = new THREE.Box3();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const qNeck = new THREE.Quaternion();
const clock = new THREE.Clock();

// Third-person camera params (head-close fixed follow camera)
const CAM_HEIGHT = 0.02;
const CAM_DISTANCE = 0.07;
const CAM_LOOK_AHEAD = 1.50;
const CAM_LOOK_HEIGHT = 0.22;

// ─── Joystick state ───
const joystick = { active: false, touchId: null, cx: 0, cy: 0, dx: 0, dy: 0, rawStretch: 0 };
const JOYSTICK_RADIUS = 50;

const jZone = document.getElementById('joystick-zone');
const jRunRing = document.getElementById('joystick-run-ring');
const jBase = document.getElementById('joystick-base');
const jThumb = document.getElementById('joystick-thumb');

function setJoystickThumbOffset(px, py) {
  jThumb.style.transform = `translate(${px}px, ${py}px)`;
}

// Fixed joystick center: center of the base element
function getJoystickCenter() {
  const rect = jBase.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function jStart(x, y, id) {
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

function jMove(x, y) {
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
const keys = Object.create(null);
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyM') mouthOpen = !mouthOpen;
  if (e.code === 'Space') { e.preventDefault(); attackPending = true; }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

// ─── Buttons ───
const btnAttack = document.getElementById('btn-attack');
const btnMouth = document.getElementById('btn-mouth');

btnAttack.addEventListener('touchstart', (e) => { e.preventDefault(); attackPending = true; }, { passive: false });
btnMouth.addEventListener('touchstart', (e) => {
  e.preventDefault();
  mouthOpen = !mouthOpen;
  btnMouth.classList.toggle('active', mouthOpen);
}, { passive: false });
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

function errorToText(err) {
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
  const delegates = ['GPU', 'CPU'];
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
  } catch (camErr) {
    console.error('Camera access denied or unavailable:', camErr);
    const msg = camErr?.name === 'NotAllowedError'
      ? 'カメラ許可が拒否されています。Safari設定で許可してください。'
      : `カメラ起動失敗: ${camErr?.name || camErr?.message || 'unknown'}`;
    lastCameraErrorMessage = msg;
    return false;
  }

  camVideo.srcObject = stream;
  await camVideo.play();
  // プレビューは常に左右反転して表示する
  camVideo.style.transform = 'scaleX(-1)';
  camOverlay.style.transform = 'scaleX(-1)';
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

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function extractHandFeatures(lm) {
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

function mergeHandModel(raw) {
  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_HAND_CONTROL_MODEL);
  return {
    version: 1,
    mouth: {
      closedCurl: Number(raw?.mouth?.closedCurl ?? DEFAULT_HAND_CONTROL_MODEL.mouth.closedCurl),
      openCurl: Number(raw?.mouth?.openCurl ?? DEFAULT_HAND_CONTROL_MODEL.mouth.openCurl),
      openThreshold: Number(raw?.mouth?.openThreshold ?? DEFAULT_HAND_CONTROL_MODEL.mouth.openThreshold),
    },
    neck: {
      neutralTilt: Number(raw?.neck?.neutralTilt ?? DEFAULT_HAND_CONTROL_MODEL.neck.neutralTilt),
      yawGain: Number(raw?.neck?.yawGain ?? DEFAULT_HAND_CONTROL_MODEL.neck.yawGain),
      maxYaw: Number(raw?.neck?.maxYaw ?? DEFAULT_HAND_CONTROL_MODEL.neck.maxYaw),
      neutralPitchAngle: Number(raw?.neck?.neutralPitchAngle ?? DEFAULT_HAND_CONTROL_MODEL.neck.neutralPitchAngle),
      pitchGain: Number(raw?.neck?.pitchGain ?? DEFAULT_HAND_CONTROL_MODEL.neck.pitchGain),
      maxPitch: Number(raw?.neck?.maxPitch ?? DEFAULT_HAND_CONTROL_MODEL.neck.maxPitch),
    },
  };
}

async function loadHandControlModel() {
  try {
    const res = await fetch(HAND_MODEL_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const modelJson = await res.json();
    handControlModel = mergeHandModel(modelJson);
    handModelLoaded = true;
    hudText.textContent = '手モデル: 学習済み';
    console.log('Loaded hand control model:', handControlModel);
  } catch (e) {
    handControlModel = structuredClone(DEFAULT_HAND_CONTROL_MODEL);
    handModelLoaded = false;
    hudText.textContent = '手モデル: デフォルト';
    console.warn('Hand control model not found. Using default parameters.', e?.message || e);
  }
}

function showTapToStart() {
  const guideEl = tapStartEl.querySelector('span');
  const isLikelyInsecure = !window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
  if (guideEl && isLikelyInsecure) {
    guideEl.textContent = 'iPhoneはHTTPS接続が必要です（httpではカメラ不可）';
  }
  tapStartEl.classList.add('show');

  async function onStartGesture(e) {
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

function processHandResults(results) {
  const ctx = camOverlay.getContext('2d');
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
  const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  for (const [a, b] of connections) {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * camOverlay.width, lm[a].y * camOverlay.height);
    ctx.lineTo(lm[b].x * camOverlay.width, lm[b].y * camOverlay.height);
    ctx.stroke();
  }

  const f = extractHandFeatures(lm);
  const m = handControlModel;
  const mouthRange = Math.max(0.05, m.mouth.openCurl - m.mouth.closedCurl);
  handState.mouthOpenness = clamp((f.avgCurl - m.mouth.closedCurl) / mouthRange, 0, 1);
  const yaw = clamp((f.tiltAngle - m.neck.neutralTilt) * m.neck.yawGain, -m.neck.maxYaw, m.neck.maxYaw);
  const pitch = clamp((f.pitchAngle - m.neck.neutralPitchAngle) * m.neck.pitchGain, -m.neck.maxPitch, m.neck.maxPitch);
  // 微小なブレを打ち消して停止時の首ドリフトを防ぐ
  handState.neckYaw = Math.abs(yaw) < 0.035 ? 0 : yaw;
  handState.neckPitch = Math.abs(pitch) < 0.03 ? 0 : pitch;
}

function updateHandTracking(now) {
  if (!cameraActive || !handLandmarker || camVideo.readyState < 2) return;
  if (now - lastHandTime < HAND_DETECT_INTERVAL) return;
  lastHandTime = now;

  const results = handLandmarker.detectForVideo(camVideo, now);
  processHandResults(results);

  if (handState.detected) {
    mouthOpen = handState.mouthOpenness > handControlModel.mouth.openThreshold;
  }
}

function applyHeadTracking(dt) {
  if (!headBone) return;
  const hasTracking = handState.detected && cameraActive;
  const targetYaw = hasTracking ? handState.neckYaw : 0;
  const targetPitch = hasTracking ? handState.neckPitch : 0;
  const speed = 5;
  smoothNeckYaw = smoothToward(smoothNeckYaw, targetYaw, dt, speed);
  smoothNeckPitch = smoothToward(smoothNeckPitch, targetPitch, dt, speed);
  euler.set(smoothNeckPitch, smoothNeckYaw, 0, 'YXZ');
  qNeck.setFromEuler(euler);
  const baseHeadQuat = headBone.quaternion.clone();
  headBone.quaternion.copy(baseHeadQuat).multiply(qNeck);
}

// ─── Helpers ───
function smoothToward(current, target, dt, speed) {
  return current + (target - current) * (1 - Math.exp(-speed * dt));
}

// ─── Animation setup ───
const CLIP_NAMES = [
  'Walk', 'Run', 'Idle',
  'Walk_MouthOpen', 'Run_MouthOpen', 'Idle_MouthOpen',
  'Attack', 'TailWag',
];

function setupActions(gltf) {
  mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.addEventListener('finished', (e) => {
    if (e.action === actions.Attack) e.action.fadeOut(0.18);
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
function setLocomotionWeights(speed, mouth, run) {
  const fast = run && speed > 0.02;
  const walk = !fast && speed > 0.01;
  const idle = !walk && !fast;

  const w = {
    Idle: idle && !mouth ? 1 : 0,
    Walk: walk && !mouth ? 1 : 0,
    Run: fast && !mouth ? 1 : 0,
    Idle_MouthOpen: idle && mouth ? 1 : 0,
    Walk_MouthOpen: walk && mouth ? 1 : 0,
    Run_MouthOpen: fast && mouth ? 1 : 0,
  };
  for (const [name, wt] of Object.entries(w)) {
    if (actions[name]) actions[name].setEffectiveWeight(wt);
  }
}

// ─── Movement & character update ───
const vDir = new THREE.Vector3();

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

function updateCharacter(dt) {
  if (!model || !mixer) return;

  const { ix, iz, len } = getInputVector();
  const speed = len;
  const stretch = joystick.active ? joystick.rawStretch : 0;
  if (stretch >= RUN_STRETCH_ENTER) stickRunLatched = true;
  else if (stretch <= RUN_STRETCH_EXIT) stickRunLatched = false;
  const stickRun = stickRunLatched;
  const runNow = stickRun || keys['ShiftLeft'] || keys['ShiftRight'];

  if (speed > 0.05) {
    const moveSpeed = runNow ? 0.1 : 0.06

    // Joystick up (-iz) = wani forward, ix = turn
    const turnRate = 3.5;
    model.rotation.y -= ix * turnRate * dt;

    const yaw = model.rotation.y;
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);

    const forward = -iz;
    model.position.x += fwdX * forward * moveSpeed * dt;
    model.position.z += fwdZ * forward * moveSpeed * dt;
  }

  setLocomotionWeights(speed, mouthOpen, runNow);

  if (attackPending && actions.Attack) {
    attackPending = false;
    actions.Attack.reset();
    actions.Attack.setEffectiveWeight(1);
    actions.Attack.fadeIn(0.06);
    actions.Attack.play();
  }

  mixer.update(dt);
  applyHeadTracking(dt);

  // Ground collision
  box.setFromObject(model);
  if (box.min.y < GROUND_Y) {
    model.position.y += GROUND_Y - box.min.y;
  } else {
    model.position.y = smoothToward(model.position.y, modelBaseY, dt, 6);
  }
}

// ─── Third-person camera ───
function updateCamera() {
  if (!model) return;

  const yaw = model.rotation.y;
  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);

  // Fixed offset from wani to avoid apparent zoom when turning.
  const targetPos = new THREE.Vector3(
    model.position.x - fwdX * CAM_DISTANCE,
    model.position.y + CAM_HEIGHT,
    model.position.z - fwdZ * CAM_DISTANCE
  );
  // Look-ahead in facing direction for third-person head-close view.
  const targetLook = new THREE.Vector3(
    model.position.x + fwdX * CAM_LOOK_AHEAD,
    model.position.y + CAM_LOOK_HEIGHT,
    model.position.z + fwdZ * CAM_LOOK_AHEAD
  );
  camera.position.copy(targetPos);
  camera.lookAt(targetLook);

  sun.position.set(model.position.x + 8, 12, model.position.z + 6);
  sun.target.position.copy(model.position);
  sun.target.updateMatrixWorld();
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

function showLoadError(msg) {
  loadSettled = true;
  window.clearTimeout(loadSlowTimer);
  loadText.textContent = msg;
  loadBar.style.width = '100%';
  loadBar.style.background = '#f44';
}

const loader = new GLTFLoader();

/** GLTFLoader が外部バッファを解決するときのベース（相対 URI 用） */
function gltfBasePath(url) {
  const i = url.lastIndexOf('/');
  return i >= 0 ? url.slice(0, i + 1) : '';
}

/**
 * iOS Safari では fetch + ReadableStream が完了しないことがあるため、
 * XHR + arraybuffer を優先する。
 */
function loadBinaryWithXHR(url, onProgress, signal) {
  return new Promise((resolve, reject) => {
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
        resolve(xhr.response);
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

async function applyLoadedGltf(gltf) {
  model = gltf.scene;
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  scene.add(model);

  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  model.position.y = GROUND_Y - box.min.y;
  modelBaseY = model.position.y;

  setupActions(gltf);
  headBone = model.getObjectByName('head');

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

  let arrayBuffer;

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
    } catch (xhrErr) {
      window.clearTimeout(tid);
      if (xhrErr?.name === 'AbortError') throw xhrErr;
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

    let gltf;
    try {
      gltf = await Promise.race([parsePromise, timeoutPromise]);
    } finally {
      window.clearInterval(parseUi);
    }

    try {
      await applyLoadedGltf(gltf);
    } catch (e) {
      showLoadError(`初期化エラー: ${e?.message || e}`);
      console.error(e);
    }
  } catch (e) {
    window.clearTimeout(tid);
    if (e?.name === 'AbortError') {
      showLoadError(
        `${downloadTimeoutMs / 1000}秒でタイムアウトしました。\n${MODEL_URL}\n\n同じWi‑Fiか、PCで npm run dev が動いているか確認してください。`
      );
    } else {
      showLoadError(`読み込み失敗: ${e?.message || e}\n${MODEL_URL}`);
    }
    console.error(e);
  }
}

loadHandControlModel();
loadModel();

// ─── Main loop ───
function loop(timestamp) {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  const now = timestamp || performance.now();
  updateHandTracking(now);
  updateCharacter(dt);
  updateCamera();
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);
