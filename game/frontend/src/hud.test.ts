/** @vitest-environment happy-dom */

import { describe, it, expect, beforeAll } from 'vitest';

describe('hud', () => {
  let hud: typeof import('./hud');

  beforeAll(async () => {
    hud = await import('./hud');
  });

  it('no-op API が例外なく呼べる', () => {
    expect(() => hud.setHandModelStatus('手: OK')).not.toThrow();
    expect(() => hud.setMultiplayerStatus('部屋: test')).not.toThrow();
    expect(() => hud.refreshHud()).not.toThrow();
  });
});
