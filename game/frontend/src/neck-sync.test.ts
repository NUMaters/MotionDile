import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { composeNeckDeltaQuaternion } from './neck-sync';

describe('composeNeckDeltaQuaternion', () => {
  const q = new THREE.Quaternion();

  it('pitch=0 yaw=0 は単位に近い', () => {
    composeNeckDeltaQuaternion(q, 0, 0);
    expect(q.x).toBeCloseTo(0);
    expect(q.y).toBeCloseTo(0);
    expect(q.z).toBeCloseTo(0);
    expect(q.w).toBeCloseTo(1);
  });

  it('正規化されたクォータニオン', () => {
    composeNeckDeltaQuaternion(q, 0.2, -0.35);
    const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
    expect(len).toBeCloseTo(1, 5);
  });
});
