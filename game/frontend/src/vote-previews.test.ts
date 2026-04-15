/** @vitest-environment happy-dom */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./scene', () => ({
  renderer: {
    getSize: vi.fn(() => ({ x: 800, y: 600 })),
    getPixelRatio: vi.fn(() => 1),
    getClearColor: vi.fn(),
    getClearAlpha: vi.fn(() => 1),
    toneMapping: 0,
    toneMappingExposure: 1,
    shadowMap: { enabled: true },
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    setClearColor: vi.fn(),
    clear: vi.fn(),
    setRenderTarget: vi.fn(),
    render: vi.fn(),
    readRenderTargetPixels: vi.fn(),
  },
}));

vi.mock('./config', () => ({
  WANI_SCALE: 2,
  FALLBACK_PLAYER_COLOR: '#FB8C00',
}));

vi.mock('./character', () => ({
  tintModel: vi.fn(),
  setLocomotionWeights: vi.fn(),
}));

import { disposeVotePreviews } from './vote-previews';

describe('vote-previews', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('disposeVotePreviews がマウントを空にする', () => {
    const m = document.createElement('div');
    m.className = 'vote-preview-mount';
    m.appendChild(document.createElement('span'));
    document.body.appendChild(m);
    disposeVotePreviews();
    expect(m.childNodes.length).toBe(0);
  });
});
