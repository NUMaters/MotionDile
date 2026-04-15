/** @vitest-environment happy-dom */

import { describe, it, expect, vi } from 'vitest';

vi.mock('./vote-previews', () => ({
  disposeVotePreviews: vi.fn(),
  mountVotePreviews: vi.fn(),
}));

vi.mock('./config', () => ({
  FLAT_WORLD_MODE: true,
  FALLBACK_PLAYER_COLOR: '#FB8C00',
}));

vi.mock('./game-rules', () => ({
  getGameRules: () => ({
    maxPlayers: 10,
    minPlayers: 3,
    gameDurationSec: 60,
    matchCountdownSec: 20,
    voteDurationSec: 20,
    hintIntervalSec: 15,
    resultDurationSec: 10,
  }),
}));

import { showScreen, getCurrentScreen } from './screens';

describe('screens', () => {
  it('showScreen で current が更新される', () => {
    showScreen('home');
    expect(getCurrentScreen()).toBe('home');
    showScreen('none');
    expect(getCurrentScreen()).toBe('none');
  });
});
