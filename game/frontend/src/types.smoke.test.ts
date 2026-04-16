import { describe, it, expect } from 'vitest';
import type { MovePayload, NetPlayerState } from './types';

describe('types (型スモーク)', () => {
  it('MovePayload 形のオブジェクトを組み立てられる', () => {
    const m: MovePayload = {
      x: 0,
      y: 0,
      z: 0,
      rotationY: 0,
      neckYaw: 0,
      neckPitch: 0,
      animation: 'Idle',
      mouthOpenness: 0,
      idleBob: 0,
      idlePitch: 0,
      idleRoll: 0,
    };
    expect(m.animation).toBe('Idle');
  });

  it('NetPlayerState に必須フィールド', () => {
    const p: NetPlayerState = {
      playerId: 'p1',
      x: 0,
      y: 0,
      z: 0,
      rotationY: 0,
      neckYaw: 0,
      neckPitch: 0,
      animation: 'Idle',
      mouthOpenness: 0,
      color: '#fff',
      updatedAt: 1,
    };
    expect(p.playerId).toBe('p1');
  });
});
