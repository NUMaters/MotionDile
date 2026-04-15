import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { MovePayload } from './types';
import {
  MODEL_URL, GROUND_Y, FLAT_WORLD_MODE,
  RUN_STRETCH_ENTER, RUN_STRETCH_EXIT,
  MOVE_ACCEL_SMOOTH, MOVE_DECEL_SMOOTH, TURN_INPUT_SMOOTH, RUN_BLEND_SMOOTH,
  IDLE_SWAY_SPEED, IDLE_BOB_AMOUNT, IDLE_PITCH_AMOUNT, IDLE_ROLL_AMOUNT,
  PLAYER_GROUND_CLEARANCE, PLAYER_HEIGHT_OFFSET,
  CAM_HEIGHT, CAM_DISTANCE, CAM_LOOK_AHEAD, CAM_LOOK_HEIGHT,
  JUMP_VELOCITY, JUMP_GRAVITY,
  JUMP_HEAD_PITCH_UP, JUMP_HEAD_PITCH_APEX, JUMP_HEAD_PITCH_FALL, JUMP_HEAD_PITCH_LAND,
  JUMP_HEAD_PITCH_SMOOTH,
  JUMP_ROOT_PITCH_PEAK, JUMP_ROOT_PITCH_LAND, JUMP_ROOT_PITCH_SMOOTH,
  JUMP_HEAD_LEAD_LOCAL_Y, JUMP_HEAD_LEAD_RISE_S, JUMP_HEAD_LEAD_END_S, JUMP_BODY_LIFT_RAMP_S,
  JUMP_ROOT_PITCH_LAUNCH, JUMP_ROOT_ROLL_MAX, JUMP_AIR_MOVE_DECEL_MULT,
  LOOK_RESET_SIZE_PX,
  LOOK_RESET_LEFT_INSET_PX,
} from './config';
import { getEl, clamp, smoothToward } from './utils';
import { renderer, scene, camera, sun, ground, grid, box, clock } from './scene';
import { initInput, getInputVector, joystick, keys, manualMouthOpen, consumeAttack, consumeJump } from './input';
import {
  handState, smoothNeckYaw, smoothNeckPitch,
  updateHandTracking, applyHeadTracking,
  loadHandControlModel, activateSensorsFromUserGesture, registerSensorRetryOnWindowTap,
} from './hand-tracking';
import { updateDeviceLook, getDeviceLookYawPitch, recenterDeviceLook } from './device-look';
import {
  sampleTerrainHeight, sampleFlatFloorY, sampleMaterial002SinkOffset,
  canMoveOnWorld, loadWorldMap, getFlatWorldY, setFlatWorldY, hasWorldColliders,
  clampToBoundary,
} from './world';
import {
  normalizeCharacterRoot, setupActions, setLocomotionWeights,
  loadBinaryWithXHR, gltfBasePath,
} from './character';
import {
  initMultiplayer, sendLocalMove, updateRemotePlayers, cleanup as cleanupNetwork,
  setLocalModel, setRemoteModelTemplate, localPlayerColor,
  setOnGameEnd, clearRemotePlayers,
} from './network';
import {
  showScreen, initTutorial, updateMatchmaking, initMatchmakingPip,
} from './screens';
import { getStoredPlayerName, saveStoredPlayerName } from './player-names';
import { IC } from './icons';
import { initLabelRenderer, renderLabels } from './name-labels';

// ─── DOM (loading UI) ───
const loadingEl = getEl<HTMLElement>('loading');
const loadBar = getEl<HTMLElement>('load-bar');
const loadText = getEl<HTMLElement>('load-text');

// ─── Character state ───
let model: THREE.Group | null = null;
let mixer: THREE.AnimationMixer | null = null;
const actions: Record<string, THREE.AnimationAction> = {};
let modelBaseY = 0;
let playerFootOffset = 0.06;
let headBone: THREE.Object3D | null = null;
let headBaseQuat: THREE.Quaternion | null = null;

// ─── Movement state ───
let smoothForwardInput = 0;
let smoothMoveSpeed = 0;
let smoothTurnInput = 0;
let smoothRunBlend = 0;
let smoothMouthOpenness = 0;
let stickRunLatched = false;
let currentMoveAnimation = 'Idle';

// ─── Idle sway state ───
let idleSwayPhase = 0;
let idleBobOffset = 0;
let idlePitchOffset = 0;
let idleRollOffset = 0;

// ─── Jump (FLAT 地形時。ジョイスティックダブルタップ / J) ───
let jumpInAir = false;
let jumpVerticalVelocity = 0;
let landingRecovery = 0;
let smoothJumpNeckPitch = 0;
let smoothJumpRootPitch = 0;
let smoothJumpRootRoll = 0;
/** 空中にいる時間（秒）。頭リードと体の上昇ランプ用 */
let jumpElapsed = 0;
/** 頭ボーンのローカル Y リード（アニメ後に加算） */
let smoothHeadLeadY = 0;

// ─── Init input ───
initInput();

const gameCanvas = document.getElementById('game-canvas')!;
initLabelRenderer(gameCanvas.parentElement!);

const lookResetBtn = getEl<HTMLButtonElement>('look-reset-btn');
function positionLookResetButton(): void {
  lookResetBtn.style.width = `${LOOK_RESET_SIZE_PX}px`;
  lookResetBtn.style.height = `${LOOK_RESET_SIZE_PX}px`;
  lookResetBtn.style.left = `max(${LOOK_RESET_LEFT_INSET_PX}px, env(safe-area-inset-left, 0px))`;
  lookResetBtn.style.top = '50%';
  lookResetBtn.style.transform = 'translateY(-50%)';
  lookResetBtn.style.bottom = 'auto';
}
positionLookResetButton();
window.addEventListener('resize', positionLookResetButton);
lookResetBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  recenterDeviceLook();
});

/** ゲーム終了時にキャラ位置・移動状態をリセットし初期位置に戻す */
function resetLocalPlayer(): void {
  if (!model) return;
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  smoothForwardInput = 0;
  smoothMoveSpeed = 0;
  smoothTurnInput = 0;
  smoothRunBlend = 0;
  smoothMouthOpenness = 0;
  stickRunLatched = false;
  currentMoveAnimation = 'Idle';
  idleSwayPhase = 0;
  idleBobOffset = 0;
  idlePitchOffset = 0;
  idleRollOffset = 0;
  jumpInAir = false;
  jumpVerticalVelocity = 0;
  landingRecovery = 0;
  smoothJumpNeckPitch = 0;
  smoothJumpRootPitch = 0;
  smoothJumpRootRoll = 0;
  jumpElapsed = 0;
  smoothHeadLeadY = 0;
  normalizeCharacterRoot(model);
  box.setFromObject(model);
  playerFootOffset = Math.max(0.03, model.position.y - box.min.y);
  modelBaseY = model.position.y;
  alignModelToFlatWorld(true);
  recenterDeviceLook();
}

// ─── Terrain helpers ───
function alignModelToFlatWorld(forceSnap = false) {
  if (!FLAT_WORLD_MODE || !model) return;
  let fwY = getFlatWorldY();
  if (fwY == null && hasWorldColliders()) {
    fwY = sampleFlatFloorY(model.position.x, model.position.z);
    if (fwY == null) fwY = GROUND_Y;
    setFlatWorldY(fwY);
  }
  if (fwY != null) {
    const sink = sampleMaterial002SinkOffset(model.position.x, model.position.z);
    modelBaseY = fwY + playerFootOffset + PLAYER_GROUND_CLEARANCE + PLAYER_HEIGHT_OFFSET - sink;
    if (forceSnap) model.position.y = modelBaseY;
  }
}

// ─── Character update ───
function updateCharacter(dt: number) {
  if (!model || !mixer) return;

  const { ix, iz, len } = getInputVector();
  const inputSpeed = len;
  const targetForward = inputSpeed > 0.001 ? -iz : 0;
  const decelAir =
    jumpInAir && Math.abs(targetForward) < Math.abs(smoothForwardInput) - 1e-6
      ? MOVE_DECEL_SMOOTH * JUMP_AIR_MOVE_DECEL_MULT
      : MOVE_DECEL_SMOOTH;
  const accelSpeed =
    Math.abs(targetForward) > Math.abs(smoothForwardInput) ? MOVE_ACCEL_SMOOTH : decelAir;
  smoothForwardInput = smoothToward(smoothForwardInput, targetForward, dt, accelSpeed);
  smoothMoveSpeed = smoothToward(smoothMoveSpeed, Math.abs(smoothForwardInput), dt, accelSpeed);
  smoothTurnInput = smoothToward(smoothTurnInput, ix, dt, TURN_INPUT_SMOOTH);
  const targetMouth = handState.detected ? handState.mouthOpenness : (manualMouthOpen ? 1 : 0);
  smoothMouthOpenness = smoothToward(smoothMouthOpenness, targetMouth, dt, 10);
  const stretch = joystick.active ? joystick.rawStretch : 0;
  if (stretch >= RUN_STRETCH_ENTER) stickRunLatched = true;
  else if (stretch <= RUN_STRETCH_EXIT) stickRunLatched = false;
  const runNow = (stickRunLatched || keys['ShiftLeft'] || keys['ShiftRight']) && smoothMoveSpeed > 0.06;
  smoothRunBlend = smoothToward(smoothRunBlend, runNow ? 1 : 0, dt, RUN_BLEND_SMOOTH);

  if (FLAT_WORLD_MODE && consumeJump() && !jumpInAir) {
    jumpVerticalVelocity = JUMP_VELOCITY;
    jumpInAir = true;
    landingRecovery = 0;
  }

  if (jumpInAir) {
    currentMoveAnimation = smoothMouthOpenness > 0.5 ? 'Idle_MouthOpen' : 'Jump';
  } else if (landingRecovery > 0.01) {
    currentMoveAnimation = smoothMouthOpenness > 0.5 ? 'Idle_MouthOpen' : 'Idle';
  } else if (smoothMoveSpeed > 0.56 && smoothRunBlend > 0.45) {
    currentMoveAnimation = 'Run';
  } else if (smoothMoveSpeed > 0.07) {
    currentMoveAnimation = 'Walk';
  } else {
    currentMoveAnimation = 'Idle';
  }
  if (!jumpInAir && smoothMouthOpenness > 0.5 && !currentMoveAnimation.includes('Mouth')) {
    currentMoveAnimation = `${currentMoveAnimation}_MouthOpen`;
  }

  if (smoothMoveSpeed > 0.005 || jumpInAir) {
    const turnRate = jumpInAir ? 3.2 : 3.5;
    model.rotation.y -= smoothTurnInput * turnRate * dt;
  }
  if (smoothMoveSpeed > 0.005) {
    const moveSpeed = 0.15 + (0.23 - 0.15) * smoothRunBlend;
    const yaw = model.rotation.y;
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    const forward = smoothForwardInput;
    const rawNextX = model.position.x + fwdX * forward * moveSpeed * dt;
    const rawNextZ = model.position.z + fwdZ * forward * moveSpeed * dt;
    const bounded = clampToBoundary(rawNextX, rawNextZ);
    if (canMoveOnWorld(model.position, bounded.x, bounded.z, playerFootOffset)) {
      model.position.x = bounded.x;
      model.position.z = bounded.z;
    }
  }

  let locoSpeed = smoothMoveSpeed;
  let locoRun = smoothRunBlend;
  if (jumpInAir) {
    if (smoothMoveSpeed > 0.07) {
      locoSpeed = smoothMoveSpeed * 0.88;
      locoRun = smoothRunBlend * 0.85;
    } else {
      locoSpeed = 0.5;
      locoRun = 0;
    }
  }
  setLocomotionWeights(locoSpeed, smoothMouthOpenness, locoRun, actions);

  if (consumeAttack() && actions.Attack) {
    actions.Attack.reset();
    actions.Attack.setEffectiveWeight(1);
    actions.Attack.fadeIn(0.06);
    actions.Attack.play();
  }

  mixer.update(dt);
  if (jumpInAir) jumpElapsed += dt;
  else jumpElapsed = 0;

  const headYAfterAnim = headBone ? headBone.position.y : 0;

  const apexH = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * Math.max(JUMP_GRAVITY, 0.01));
  let jumpNeckPitchTarget = 0;
  let jumpRootPitchTarget = 0;
  let jumpRootRollTarget = 0;
  if (jumpInAir && model) {
    const h = Math.max(0, model.position.y - modelBaseY);
    const u = clamp(apexH > 0.0001 ? h / apexH : 0, 0, 1);
    const riseBlend = Math.cos(u * Math.PI * 0.5);
    jumpNeckPitchTarget = JUMP_HEAD_PITCH_UP * riseBlend * (1 - u * 0.4) + JUMP_HEAD_PITCH_APEX * (1 - riseBlend);
    if (jumpVerticalVelocity < -0.25) {
      jumpNeckPitchTarget += JUMP_HEAD_PITCH_FALL * Math.min(1, (-jumpVerticalVelocity) / 3.2);
    }
    jumpRootPitchTarget = JUMP_ROOT_PITCH_PEAK * riseBlend * (1 - u * 0.5)
      + JUMP_ROOT_PITCH_LAUNCH * riseBlend * (1 - Math.min(1, u * 1.15));
    if (jumpVerticalVelocity < -0.4) {
      jumpRootPitchTarget += -0.02 * Math.min(1, (-jumpVerticalVelocity - 0.4) / 2);
    }
    jumpRootRollTarget = JUMP_ROOT_ROLL_MAX * Math.sin(Math.PI * u);
  } else if (landingRecovery > 0) {
    jumpNeckPitchTarget = JUMP_HEAD_PITCH_LAND * landingRecovery;
    jumpRootPitchTarget = JUMP_ROOT_PITCH_LAND * landingRecovery;
  }
  smoothJumpNeckPitch = smoothToward(smoothJumpNeckPitch, jumpNeckPitchTarget, dt, JUMP_HEAD_PITCH_SMOOTH);
  smoothJumpRootPitch = smoothToward(smoothJumpRootPitch, jumpRootPitchTarget, dt, JUMP_ROOT_PITCH_SMOOTH);
  smoothJumpRootRoll = smoothToward(smoothJumpRootRoll, jumpRootRollTarget, dt, JUMP_ROOT_PITCH_SMOOTH);
  applyHeadTracking(dt, headBone, headBaseQuat, smoothJumpNeckPitch);

  let headLeadTarget = 0;
  if (jumpInAir && jumpElapsed < JUMP_HEAD_LEAD_END_S) {
    if (jumpElapsed <= JUMP_HEAD_LEAD_RISE_S) {
      const t = jumpElapsed / Math.max(JUMP_HEAD_LEAD_RISE_S, 1e-4);
      headLeadTarget = JUMP_HEAD_LEAD_LOCAL_Y * Math.sin(t * Math.PI * 0.5);
    } else {
      const peak = JUMP_HEAD_LEAD_LOCAL_Y * Math.sin(Math.PI * 0.5);
      const span = Math.max(JUMP_HEAD_LEAD_END_S - JUMP_HEAD_LEAD_RISE_S, 1e-4);
      const t = (jumpElapsed - JUMP_HEAD_LEAD_RISE_S) / span;
      headLeadTarget = peak * (1 - t) * (1 - t);
    }
  }
  smoothHeadLeadY = smoothToward(smoothHeadLeadY, headLeadTarget, dt, 22);
  if (headBone) {
    headBone.position.y = headYAfterAnim + smoothHeadLeadY;
  }

  if (FLAT_WORLD_MODE) {
    alignModelToFlatWorld(false);
    if (jumpInAir) {
      jumpVerticalVelocity -= JUMP_GRAVITY * dt;
      const liftRamp = Math.min(1, jumpElapsed / Math.max(JUMP_BODY_LIFT_RAMP_S, 1e-4));
      model.position.y += jumpVerticalVelocity * dt * liftRamp;

      if (model.position.y <= modelBaseY) {
        model.position.y = modelBaseY;
        jumpVerticalVelocity = 0;
        jumpInAir = false;
        landingRecovery = 1;
        smoothHeadLeadY = 0;
      }
    } else {
      model.position.y = smoothToward(model.position.y, modelBaseY, dt, 18);
    }
    if (landingRecovery > 0) {
      landingRecovery = Math.max(0, landingRecovery - dt * 2.4);
    }
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
      box.setFromObject(model);
      if (box.min.y < GROUND_Y) {
        model.position.y += GROUND_Y - box.min.y;
      } else {
        model.position.y = smoothToward(model.position.y, modelBaseY, dt, 6);
      }
    }
  }

  const swayFactor = jumpInAir ? 0 : (landingRecovery > 0 ? 0.35 + landingRecovery * 0.65 : 1);
  const idleWeight = clamp((0.12 - smoothMoveSpeed) / 0.12, 0, 1) * swayFactor;
  idleSwayPhase += dt * (IDLE_SWAY_SPEED + idleWeight * 0.6);
  const targetBob = (Math.sin(idleSwayPhase * 2.0) * IDLE_BOB_AMOUNT
    + Math.sin(idleSwayPhase * 4.3) * (IDLE_BOB_AMOUNT * 0.32)) * idleWeight;
  const targetPitch = Math.sin(idleSwayPhase * 1.5) * IDLE_PITCH_AMOUNT * idleWeight;
  const targetRoll = Math.sin(idleSwayPhase * 1.2 + 0.8) * IDLE_ROLL_AMOUNT * idleWeight;
  idleBobOffset = smoothToward(idleBobOffset, targetBob, dt, 8);
  idlePitchOffset = smoothToward(idlePitchOffset, targetPitch, dt, 7);
  idleRollOffset = smoothToward(idleRollOffset, targetRoll, dt, 7);
  if (jumpInAir) {
    idlePitchOffset = smoothToward(idlePitchOffset, 0, dt, 14);
    idleRollOffset = smoothToward(idleRollOffset, 0, dt, 14);
  }
  model.position.y += idleBobOffset;
  model.rotation.x = idlePitchOffset + smoothJumpRootPitch;
  model.rotation.z = idleRollOffset + smoothJumpRootRoll;
}

// ─── Camera ───
const vCamOff = new THREE.Vector3();
const vLookOff = new THREE.Vector3();
const vWorldUp = new THREE.Vector3(0, 1, 0);
const qDevYaw = new THREE.Quaternion();
const qDevPitch = new THREE.Quaternion();
const vRight = new THREE.Vector3();

function updateCamera() {
  if (!model) return;

  const yaw = model.rotation.y;
  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);
  const camAnchorY = model.position.y - idleBobOffset;
  const { yaw: dYaw, pitch: dPitch } = getDeviceLookYawPitch();

  vCamOff.set(
    -fwdX * CAM_DISTANCE,
    camAnchorY + CAM_HEIGHT - model.position.y,
    -fwdZ * CAM_DISTANCE,
  );
  vLookOff.set(
    fwdX * CAM_LOOK_AHEAD,
    camAnchorY + CAM_LOOK_HEIGHT - model.position.y,
    fwdZ * CAM_LOOK_AHEAD,
  );

  if (dYaw !== 0 || dPitch !== 0) {
    qDevYaw.setFromAxisAngle(vWorldUp, dYaw);
    vCamOff.applyQuaternion(qDevYaw);
    vLookOff.applyQuaternion(qDevYaw);
    vRight.set(-fwdZ, 0, fwdX);
    if (vRight.lengthSq() > 1e-10) {
      vRight.normalize();
      qDevPitch.setFromAxisAngle(vRight, dPitch);
      vCamOff.applyQuaternion(qDevPitch);
      vLookOff.applyQuaternion(qDevPitch);
    }
  }

  camera.position.set(
    model.position.x + vCamOff.x,
    model.position.y + vCamOff.y,
    model.position.z + vCamOff.z,
  );
  camera.lookAt(
    model.position.x + vLookOff.x,
    model.position.y + vLookOff.y,
    model.position.z + vLookOff.z,
  );

  sun.position.set(model.position.x + 8, 12, model.position.z + 6);
  sun.target.position.set(model.position.x, camAnchorY, model.position.z);
  sun.target.updateMatrixWorld();
}

// ─── Model loading ───
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
  showScreen('home');
}

function showLoadError(msg: string) {
  loadSettled = true;
  window.clearTimeout(loadSlowTimer);
  loadText.textContent = msg;
  loadBar.style.width = '100%';
  loadBar.style.background = '#f44';
}

const loader = new GLTFLoader();

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

  const template = cloneSkinned(model) as THREE.Group;
  setRemoteModelTemplate(template, gltf.animations);

  console.log(`[applyLoadedGltf] localPlayerColor=${localPlayerColor}`);
  setLocalModel(model);

  const mixerRef = { mixer: null as THREE.AnimationMixer | null };
  setupActions(gltf, mixerRef as { mixer: THREE.AnimationMixer }, actions);
  mixer = mixerRef.mixer;
  headBone = model.getObjectByName('head') ?? null;
  headBaseQuat = headBone ? headBone.quaternion.clone() : null;

  const initYaw = model.rotation.y;
  const initFwdX = Math.sin(initYaw);
  const initFwdZ = Math.cos(initYaw);
  camera.position.set(
    model.position.x - initFwdX * CAM_DISTANCE,
    model.position.y + CAM_HEIGHT,
    model.position.z - initFwdZ * CAM_DISTANCE,
  );
  camera.lookAt(
    model.position.x + initFwdX * CAM_LOOK_AHEAD,
    model.position.y + CAM_LOOK_HEIGHT,
    model.position.z + initFwdZ * CAM_LOOK_AHEAD,
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
        ctrl.signal,
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
        `glTF ではありません。\n先頭: ${head.slice(0, 100).replace(/\s+/g, ' ')}\n${MODEL_URL}`,
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
        `${downloadTimeoutMs / 1000}秒でタイムアウトしました。\n${MODEL_URL}\n\n同じWi‑Fiか、PCで npm run dev が動いているか確認してください。`,
      );
    } else {
      showLoadError(`読み込み失敗: ${err.message || String(e)}\n${MODEL_URL}`);
    }
    console.error(e);
  }
}

// ─── Bootstrap ───
initTutorial();
initMatchmakingPip();

// Lucide アイコンを動的に挿入（HTML上の placeholder span）
const matchIcon = document.getElementById('match-icon');
if (matchIcon) matchIcon.innerHTML = IC.users(48);
const votingIcon = document.getElementById('voting-icon');
if (votingIcon) votingIcon.innerHTML = IC.vote(24);

const playerNameInput = getEl<HTMLInputElement>('player-name-input');
const btnJoin = getEl<HTMLButtonElement>('btn-join');
playerNameInput.value = getStoredPlayerName();

function syncJoinBtn(): void {
  btnJoin.disabled = !playerNameInput.value.trim();
}
syncJoinBtn();
playerNameInput.addEventListener('input', syncJoinBtn);

btnJoin.addEventListener('click', () => {
  if (!playerNameInput.value.trim()) return;
  saveStoredPlayerName(playerNameInput.value);
  showScreen('matchmaking');
  updateMatchmaking(1, null);
  /** この click がそのまま iOS のモーション／カメラ許可ダイアログに繋がる */
  activateSensorsFromUserGesture({
    onCameraFail: registerSensorRetryOnWindowTap,
  });
  void initMultiplayer();
});

setOnGameEnd(resetLocalPlayer);

getEl<HTMLElement>('btn-back-home').addEventListener('click', () => {
  void cleanupNetwork();
  resetLocalPlayer();
  showScreen('home');
});

getEl<HTMLElement>('btn-matchmaking-home').addEventListener('click', () => {
  void cleanupNetwork();
  resetLocalPlayer();
  showScreen('home');
});

void loadWorldMap(scene, ground, grid);
void loadHandControlModel();
void loadModel();

window.addEventListener('beforeunload', () => {
  cleanupNetwork();
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearRemotePlayers();
  });
}

// ─── Game loop ───
function loop(timestamp: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  const now = timestamp || performance.now();
  updateHandTracking(now);
  updateCharacter(dt);
  updateDeviceLook(dt);

  if (model) {
    const payload: MovePayload = {
      x: model.position.x,
      y: model.position.y - idleBobOffset,
      z: model.position.z,
      rotationY: model.rotation.y,
      neckYaw: smoothNeckYaw,
      neckPitch: smoothNeckPitch,
      animation: currentMoveAnimation,
      mouthOpenness: smoothMouthOpenness,
      idleBob: idleBobOffset,
      idlePitch: idlePitchOffset,
      idleRoll: idleRollOffset,
    };
    sendLocalMove(now, payload);
  }

  updateRemotePlayers(dt);
  updateCamera();
  renderer.render(scene, camera);
  renderLabels(scene, camera);
}
requestAnimationFrame(loop);
