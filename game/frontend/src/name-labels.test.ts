/** @vitest-environment happy-dom */

import { describe, it, expect, vi } from 'vitest';

vi.mock('./config', () => ({
  FALLBACK_PLAYER_COLOR: '#FB8C00',
}));

import { applyPlayerLabelAccent, updateNameLabelText } from './name-labels';

describe('name-labels', () => {
  it('applyPlayerLabelAccent は空色ならフォールバック色を使う', () => {
    const el = document.createElement('div');
    applyPlayerLabelAccent(el, '   ');
    expect(el.style.border).toContain('#FB8C00');
    expect(el.style.boxShadow).toContain('rgba');
  });

  it('updateNameLabelText は文字と表示状態を更新する', () => {
    const el = document.createElement('div');
    const label = { element: el };

    updateNameLabelText(label, 'Alice', '#E53935');
    expect(el.textContent).toBe('Alice');
    expect(el.style.opacity).toBe('1');
    expect(el.style.border).toContain('#E53935');

    updateNameLabelText(label, '');
    expect(el.style.opacity).toBe('0');
  });
});
