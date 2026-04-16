/** @vitest-environment happy-dom */

import { describe, it, expect, vi } from 'vitest';

vi.mock('./config', () => ({
  GAME_API_BASE: '/game-api/v1',
  GAME_WS_BASE: 'ws://localhost/game-ws',
  roomIdFromUrl: '',
  CLIP_NAMES: ['Idle'],
  MOVE_SEND_INTERVAL: 66,
}));

vi.mock('./game-rules', () => ({
  applyServerGameRules: vi.fn(),
  getGameRules: vi.fn(() => ({
    maxPlayers: 10,
    minPlayers: 3,
    gameDurationSec: 60,
    matchCountdownSec: 20,
    voteDurationSec: 20,
    hintIntervalSec: 15,
    resultDurationSec: 10,
  })),
  resetGameRulesFromConfig: vi.fn(),
}));

vi.mock('./scene', () => ({
  scene: {
    add: vi.fn(),
    remove: vi.fn(),
    traverse: vi.fn(),
  },
}));

vi.mock('./character', () => ({
  tintModel: vi.fn(),
  setLocomotionWeights: vi.fn(),
}));

vi.mock('./hud', () => ({
  setMultiplayerStatus: vi.fn(),
}));

vi.mock('./screens', () => ({
  showScreen: vi.fn(),
  getCurrentScreen: vi.fn(() => 'none'),
  updateMatchmaking: vi.fn(),
  updateMatchmakingPlayers: vi.fn(),
  startGameHud: vi.fn(),
  showHint: vi.fn(),
  startVoting: vi.fn(),
  showResults: vi.fn(),
  setVoteCallback: vi.fn(),
  getPlayerRole: vi.fn(() => ''),
}));

vi.mock('./name-labels', () => ({
  createNameLabel: vi.fn(() => ({
    position: { set: vi.fn() },
    center: { set: vi.fn() },
    element: document.createElement('div'),
  })),
  autoPositionLabel: vi.fn(),
  updateNameLabelText: vi.fn(),
  setNameLabelAccent: vi.fn(),
}));

vi.mock('./world', () => ({
  getWorldLandmarks: vi.fn(() => []),
}));

vi.mock('./player-names', () => ({
  setPlayerDisplayNamesFromSnapshot: vi.fn(),
  setPlayerDisplayName: vi.fn(),
  getJoinDisplayName: vi.fn(() => 'プレイヤー'),
  resolveDisplayName: vi.fn((id: string) => id.slice(0, 8)),
}));

import * as network from './network';

describe('network (軽量モック)', () => {
  it('getPlayerId は p- で始まる', () => {
    expect(network.getPlayerId()).toMatch(/^p-/);
  });

  it('getActiveRoomId は初期は空', () => {
    expect(network.getActiveRoomId()).toBe('');
  });

  it('getVotePreviewModel はテンプレ未設定なら null', () => {
    expect(network.getVotePreviewModel()).toBeNull();
  });

  it('localPlayerColor は初期空', () => {
    expect(network.localPlayerColor).toBe('');
  });
});
