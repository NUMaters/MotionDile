/** @vitest-environment happy-dom */

import { describe, it, expect, beforeAll } from 'vitest';

describe('hud', () => {
  let hud: typeof import('./hud');

  beforeAll(async () => {
    document.body.innerHTML = '<div id="hud-text"></div>';
    hud = await import('./hud');
  });

  it('ステータスを合成して #hud-text に反映', () => {
    hud.setHandModelStatus('手: OK');
    hud.setMultiplayerStatus('部屋: test');
    expect(document.getElementById('hud-text')?.textContent).toContain('手: OK');
    expect(document.getElementById('hud-text')?.textContent).toContain('部屋: test');
    hud.refreshHud();
  });
});
