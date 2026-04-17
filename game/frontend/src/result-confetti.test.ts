/** @vitest-environment happy-dom */

import { describe, it, expect, beforeEach } from 'vitest';
import { clearResultConfetti, spawnResultConfetti } from './result-confetti';

describe('result-confetti', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="result-confetti-layer"></div>';
  });

  it('clearResultConfetti は例外なく子を空にする', () => {
    const layer = document.getElementById('result-confetti-layer')!;
    layer.appendChild(document.createElement('span'));
    clearResultConfetti();
    expect(layer.childElementCount).toBe(0);
  });

  it('spawnResultConfetti は勝利時だけピースを追加する', () => {
    spawnResultConfetti(true);
    const layer = document.getElementById('result-confetti-layer')!;
    expect(layer.querySelectorAll('.result-confetti-piece').length).toBeGreaterThan(0);
    clearResultConfetti();
    spawnResultConfetti(false);
    expect(layer.querySelectorAll('.result-confetti-piece').length).toBe(0);
  });
});
