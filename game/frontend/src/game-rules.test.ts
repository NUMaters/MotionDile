import { describe, it, expect, beforeEach, vi } from 'vitest';

/** `config.ts` は `window` を参照するため、単体テストでは GAME_RULES だけ差し替える */
vi.mock('./config', () => ({
  GAME_RULES: {
    maxPlayers: 10,
    minPlayers: 3,
    gameDurationSec: 60,
    matchCountdownSec: 20,
    voteDurationSec: 20,
    hintIntervalSec: 15,
    resultDurationSec: 10,
  },
}));

import { resetGameRulesFromConfig, applyServerGameRules, getGameRules } from './game-rules';

describe('game-rules', () => {
  beforeEach(() => {
    resetGameRulesFromConfig();
  });

  it('resetGameRulesFromConfig でビルド既定に戻る', () => {
    applyServerGameRules({ maxPlayers: 99 });
    expect(getGameRules().maxPlayers).toBe(99);
    resetGameRulesFromConfig();
    expect(getGameRules().maxPlayers).not.toBe(99);
  });

  it('applyServerGameRules は有限かつ 1 以上の数だけ反映', () => {
    applyServerGameRules({
      maxPlayers: 8,
      gameDurationSec: 45,
    });
    const r = getGameRules();
    expect(r.maxPlayers).toBe(8);
    expect(r.gameDurationSec).toBe(45);
  });

  it('不正な値は無視', () => {
    const beforeMax = getGameRules().maxPlayers;
    const beforeMin = getGameRules().minPlayers;
    applyServerGameRules({
      maxPlayers: NaN as unknown as number,
      minPlayers: 0,
      gameDurationSec: -1,
    });
    const r = getGameRules();
    expect(r.maxPlayers).toBe(beforeMax);
    expect(r.minPlayers).toBe(beforeMin);
  });

  it('undefined / 非オブジェクトは無視', () => {
    const before = { ...getGameRules() };
    applyServerGameRules(undefined);
    expect(getGameRules()).toEqual(before);
    applyServerGameRules(null as unknown as undefined);
    expect(getGameRules()).toEqual(before);
  });

  it('minPlayers > maxPlayers のとき max を min に合わせる', () => {
    applyServerGameRules({ minPlayers: 7, maxPlayers: 4 });
    const r = getGameRules();
    expect(r.minPlayers).toBe(7);
    expect(r.maxPlayers).toBe(7);
  });
});
