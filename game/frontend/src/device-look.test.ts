/** @vitest-environment happy-dom */

import { describe, it, expect } from 'vitest';
import {
  getDeviceLookYawPitch,
  isDeviceLookListening,
  updateDeviceLook,
} from './device-look';

describe('device-look', () => {
  it('未リッスン時はヨー・ピッチ 0', () => {
    expect(isDeviceLookListening()).toBe(false);
    expect(getDeviceLookYawPitch()).toEqual({ yaw: 0, pitch: 0 });
    updateDeviceLook(0.016);
    expect(getDeviceLookYawPitch()).toEqual({ yaw: 0, pitch: 0 });
  });
});
