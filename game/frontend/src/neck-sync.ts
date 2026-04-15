import * as THREE from 'three';

const neckEuler = new THREE.Euler();

/**
 * 首のピッチ・ヨーから相対回転クォータニオン（ローカル表示・リモート表示で共通）。
 * Euler 順は `ZXY`（`pitch, 0, yaw`）。`YXZ` 等にすると他プレイヤー視点で首が大きく崩れる。
 */
export function composeNeckDeltaQuaternion(out: THREE.Quaternion, pitch: number, yaw: number): void {
  neckEuler.set(pitch, 0, yaw, 'ZXY');
  out.setFromEuler(neckEuler);
}
