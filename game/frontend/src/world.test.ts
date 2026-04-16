/** @vitest-environment happy-dom */

import { describe, it, expect } from 'vitest';
import {
  clampToBoundary,
  getFlatWorldY,
  setFlatWorldY,
  getWorldLandmarks,
  hasWorldColliders,
  getWorldBoundaryRadius,
} from './world';

describe('world', () => {
  it('clampToBoundary は境界未設定ならそのまま', () => {
    const r = clampToBoundary(3, 4);
    expect(r.x).toBe(3);
    expect(r.z).toBe(4);
  });

  it('getFlatWorldY / setFlatWorldY', () => {
    setFlatWorldY(0.12);
    expect(getFlatWorldY()).toBe(0.12);
    setFlatWorldY(null);
    expect(getFlatWorldY()).toBeNull();
  });

  it('getWorldLandmarks は配列を返す', () => {
    expect(Array.isArray(getWorldLandmarks())).toBe(true);
  });

  it('hasWorldColliders は真偽', () => {
    expect(typeof hasWorldColliders()).toBe('boolean');
  });

  it('getWorldBoundaryRadius は有限または Infinity', () => {
    const r = getWorldBoundaryRadius();
    expect(r === Infinity || (typeof r === 'number' && r > 0)).toBe(true);
  });
});
