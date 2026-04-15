import * as THREE from 'three';
import {
  DEVICE_LOOK_MAX_YAW_RAD,
  DEVICE_LOOK_MAX_PITCH_RAD,
  DEVICE_LOOK_SMOOTH,
  DEVICE_LOOK_RECENTER_SMOOTH,
  DEVICE_LOOK_RECENTER_DURATION_S,
  DEVICE_LOOK_TILT_GAIN,
} from './config';
import { smoothToward } from './utils';

const eulerWork = new THREE.Euler(0, 0, 0, 'YXZ');
const zee = new THREE.Vector3(0, 0, 1);
const qScreen = new THREE.Quaternion();
const qFix = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const qCurrent = new THREE.Quaternion();
const qRef = new THREE.Quaternion();
const qDelta = new THREE.Quaternion();

let listening = false;
/** クォータニオン（alpha あり）か、iOS 相対向きの beta/gamma 差分か */
let lookMode: 'unset' | 'quat' | 'tilt' = 'unset';
let calibrated = false;
let refBeta = 0;
let refGamma = 0;
let targetYaw = 0;
let targetPitch = 0;
let smoothYaw = 0;
let smoothPitch = 0;

/** 視点リセット中はセンサー由来のターゲット更新を止め、正面（0）へ滑らかに寄せる */
let recenterSuppressSensor = false;
let recenterAnimRemaining = 0;

function screenOrientationDeg(): number {
  const o = window.screen?.orientation;
  if (o && typeof o.angle === 'number') return o.angle;
  return window.orientation as number ?? 0;
}

function resolveAlpha(ev: DeviceOrientationEvent): number | null {
  if (ev.alpha != null) return ev.alpha;
  if ('webkitCompassHeading' in ev) {
    const h = (ev as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
    if (typeof h === 'number' && !Number.isNaN(h)) return 360 - h;
  }
  return null;
}

/** Three.js 系のデバイス向き→ワールド用クォータニオン（alpha が取れる場合） */
function setQuaternionFromOrientation(
  q: THREE.Quaternion,
  alpha: number,
  beta: number,
  gamma: number,
): void {
  const a = THREE.MathUtils.degToRad(alpha);
  const b = THREE.MathUtils.degToRad(beta);
  const g = THREE.MathUtils.degToRad(gamma);
  const orient = THREE.MathUtils.degToRad(screenOrientationDeg());
  eulerWork.set(b, a, -g, 'YXZ');
  q.setFromEuler(eulerWork);
  q.multiply(qFix);
  q.multiply(qScreen.setFromAxisAngle(zee, -orient));
}

function resetCalibration(): void {
  calibrated = false;
  lookMode = 'unset';
  targetYaw = 0;
  targetPitch = 0;
  smoothYaw = 0;
  smoothPitch = 0;
  recenterSuppressSensor = false;
  recenterAnimRemaining = 0;
}

/** 滑らかリセット完了時: いまの向きを中立にするだけ（表示用スムージングは維持） */
function finalizeRecenterCalibration(): void {
  calibrated = false;
  lookMode = 'unset';
  targetYaw = 0;
  targetPitch = 0;
}

function onDeviceOrientation(ev: DeviceOrientationEvent): void {
  if (ev.beta == null || ev.gamma == null) return;
  if (recenterSuppressSensor) return;

  const alphaResolved = resolveAlpha(ev);

  if (lookMode === 'unset') {
    lookMode = alphaResolved != null ? 'quat' : 'tilt';
  }
  if (lookMode === 'quat' && alphaResolved == null) {
    return;
  }

  if (lookMode === 'quat' && alphaResolved != null) {
    setQuaternionFromOrientation(qCurrent, alphaResolved, ev.beta, ev.gamma);
    if (!calibrated) {
      qRef.copy(qCurrent);
      calibrated = true;
      targetYaw = 0;
      targetPitch = 0;
      smoothYaw = 0;
      smoothPitch = 0;
      return;
    }
    qDelta.copy(qRef).invert().multiply(qCurrent);
    eulerWork.setFromQuaternion(qDelta, 'YXZ');
    targetYaw = THREE.MathUtils.clamp(eulerWork.y, -DEVICE_LOOK_MAX_YAW_RAD, DEVICE_LOOK_MAX_YAW_RAD);
    targetPitch = THREE.MathUtils.clamp(eulerWork.x, -DEVICE_LOOK_MAX_PITCH_RAD, DEVICE_LOOK_MAX_PITCH_RAD);
    return;
  }

  /** iOS 相対向き: alpha が来ないので beta/gamma の初期差分で視点を動かす */
  lookMode = 'tilt';
  if (!calibrated) {
    refBeta = ev.beta;
    refGamma = ev.gamma;
    calibrated = true;
    targetYaw = 0;
    targetPitch = 0;
    smoothYaw = 0;
    smoothPitch = 0;
    return;
  }
  const gain = DEVICE_LOOK_TILT_GAIN;
  const dGamma = THREE.MathUtils.degToRad(ev.gamma - refGamma) * gain;
  const dBeta = THREE.MathUtils.degToRad(ev.beta - refBeta) * gain;
  targetYaw = THREE.MathUtils.clamp(-dGamma, -DEVICE_LOOK_MAX_YAW_RAD, DEVICE_LOOK_MAX_YAW_RAD);
  targetPitch = THREE.MathUtils.clamp(-dBeta, -DEVICE_LOOK_MAX_PITCH_RAD, DEVICE_LOOK_MAX_PITCH_RAD);
}

function onOrientationChange(): void {
  resetCalibration();
}

/** WebKit で devicemotion を一度も購読しないと deviceorientation が来ない事例への対策（処理は空でよい） */
function onDeviceMotionUnlock(_ev: DeviceMotionEvent): void {
  /* intentionally empty */
}

const ORIENT_LISTENER_OPTS: AddEventListenerOptions = { capture: true, passive: true };
const ORIENTATION_CHANGE_OPTS: AddEventListenerOptions = { capture: true };
const DEVICE_MOTION_OPTS: AddEventListenerOptions = { passive: true };

type PermissionResult = 'granted' | 'denied';

type DeviceMotionEventCtor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<PermissionResult>;
};
type DeviceOrientationEventCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<PermissionResult>;
};

/**
 * ユーザージェスチャー（実ボタンの click 推奨）の**同期的な**ハンドラ内から呼ぶこと。
 *
 * iOS Safari では `requestPermission()` を **await せず void で叩いた直後**に
 * `deviceorientation` / `devicemotion` を購読するパターンが安定する。
 * Promise の `.then` のあとだけ `startDeviceLook` すると、環境によっては一度もイベントが来ない。
 *
 * また **DeviceMotionEvent.requestPermission** と **DeviceOrientationEvent.requestPermission** の両方を
 * 同じターンで呼び、続けて `startDeviceLook()` する（Motion 単体の報告も多い）。
 */
export function beginDeviceLookFromUserGesture(): void {
  if (typeof window.DeviceOrientationEvent === 'undefined') return;
  if (!window.isSecureContext) {
    console.warn('[device-look] 傾きセンサーは HTTPS（secure context）が必要です');
  }

  const DM = DeviceMotionEvent as DeviceMotionEventCtor;
  const DO = DeviceOrientationEvent as DeviceOrientationEventCtor;

  if (typeof DeviceMotionEvent !== 'undefined' && DM.requestPermission && typeof DM.requestPermission === 'function') {
    void DM.requestPermission().catch(() => {});
  }
  if (DO.requestPermission && typeof DO.requestPermission === 'function') {
    void DO.requestPermission().catch(() => {});
  }

  startDeviceLook();
}

/** @deprecated `beginDeviceLookFromUserGesture` を使う */
export function requestDeviceLookPermissionSync(): void {
  beginDeviceLookFromUserGesture();
}

/** 旧API互換（テスト用） */
export async function requestDeviceLookPermission(): Promise<boolean> {
  beginDeviceLookFromUserGesture();
  return true;
}

/** リスナー登録（許可後に1回だけ） */
export function startDeviceLook(): void {
  if (listening) return;
  if (typeof window.DeviceOrientationEvent === 'undefined') return;
  listening = true;
  resetCalibration();
  window.addEventListener('deviceorientation', onDeviceOrientation, ORIENT_LISTENER_OPTS);
  window.addEventListener('orientationchange', onOrientationChange, ORIENTATION_CHANGE_OPTS);
  window.addEventListener('devicemotion', onDeviceMotionUnlock, DEVICE_MOTION_OPTS);
}

export function updateDeviceLook(dt: number): void {
  if (!listening) return;

  if (recenterSuppressSensor) {
    targetYaw = 0;
    targetPitch = 0;
    recenterAnimRemaining -= dt;
    const rate = DEVICE_LOOK_RECENTER_SMOOTH;
    smoothYaw = smoothToward(smoothYaw, 0, dt, rate);
    smoothPitch = smoothToward(smoothPitch, 0, dt, rate);
    if (recenterAnimRemaining <= 0) {
      recenterAnimRemaining = 0;
      recenterSuppressSensor = false;
      finalizeRecenterCalibration();
    }
    return;
  }

  smoothYaw = smoothToward(smoothYaw, targetYaw, dt, DEVICE_LOOK_SMOOTH);
  smoothPitch = smoothToward(smoothPitch, targetPitch, dt, DEVICE_LOOK_SMOOTH);
}

/** キャラクター周りの追加ヨー・ピッチ（ラジアン） */
export function getDeviceLookYawPitch(): { yaw: number; pitch: number } {
  if (!listening) return { yaw: 0, pitch: 0 };
  return { yaw: smoothYaw, pitch: smoothPitch };
}

export function isDeviceLookListening(): boolean {
  return listening;
}

/**
 * いまの視点を滑らかに正面へ戻し、終了後にいまの端末向きを中立として再キャリブレーションする。
 */
export function recenterDeviceLook(): void {
  if (!listening) return;
  recenterSuppressSensor = true;
  recenterAnimRemaining = DEVICE_LOOK_RECENTER_DURATION_S;
  targetYaw = 0;
  targetPitch = 0;
}
