/** @vitest-environment happy-dom */

import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('./config', () => ({
  JOYSTICK_RADIUS: 65,
  RUN_STRETCH_ENTER: 1.06,
  JOYSTICK_DOUBLE_TAP_MS: 380,
  JOYSTICK_TAP_MAX_DURATION_MS: 220,
  JOYSTICK_DOUBLE_TAP_MAX_DIST_PX: 52,
  TOUCH_TAP_MAX_MOVE_PX: 14,
  JOYSTICK_BASE_SIZE_PX: 134,
  JOYSTICK_BASE_INSET_PX: 31,
  JOYSTICK_THUMB_SIZE_PX: 90,
  JOYSTICK_RING_OUTER_PX: 166,
  JOYSTICK_RING_INSET_PX: 16,
  JOYSTICK_RING_BORDER_PX: 16,
}));

describe('input', () => {
  let input: typeof import('./input');

  beforeAll(async () => {
    document.body.innerHTML = `
      <div id="joystick-zone"></div>
      <div id="joystick-base"></div>
      <div id="joystick-thumb"></div>
      <div id="joystick-run-ring"></div>
    `;
    input = await import('./input');
  });

  it('getInputVector はジョイスティックとキー入力を正規化する', () => {
    input.joystick.dx = 0;
    input.joystick.dy = 0;
    input.keys['KeyW'] = true;
    input.keys['KeyD'] = true;
    const v = input.getInputVector();
    expect(v.len).toBeLessThanOrEqual(1.0001);
    expect(Math.hypot(v.ix, v.iz)).toBeGreaterThan(0.5);
    input.keys['KeyW'] = false;
    input.keys['KeyD'] = false;
  });

  it('consumeAttack は未設定なら false', () => {
    expect(input.consumeAttack()).toBe(false);
  });
});
