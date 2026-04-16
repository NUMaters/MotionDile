import { describe, it, expect, beforeEach } from 'vitest';
import {
  setPlayerDisplayName,
  resolveDisplayName,
  saveStoredPlayerName,
  getJoinDisplayName,
  resetDisplayNameCacheForTest,
} from './player-names';

describe('player-names', () => {
  beforeEach(() => {
    resetDisplayNameCacheForTest();
    const storage: Record<string, string> = {};
    globalThis.localStorage = {
      getItem: (k: string) => (k in storage ? storage[k] : null),
      setItem: (k: string, v: string) => {
        storage[k] = v;
      },
      removeItem: (k: string) => {
        delete storage[k];
      },
      clear: () => {
        Object.keys(storage).forEach((k) => delete storage[k]);
      },
      key: (i: number) => Object.keys(storage)[i] ?? null,
      get length() {
        return Object.keys(storage).length;
      },
    } as Storage;
  });

  it('setPlayerDisplayName は trim し resolveDisplayName で取得できる', () => {
    setPlayerDisplayName('id-abc', '  Taro  ');
    expect(resolveDisplayName('id-abc')).toBe('Taro');
  });

  it('名前が空なら playerId の先頭8文字', () => {
    setPlayerDisplayName('very-long-player-id-12345', '   ');
    expect(resolveDisplayName('very-long-player-id-12345')).toBe('very-lon');
  });

  it('getJoinDisplayName は保存名がなければ「プレイヤー」', () => {
    expect(getJoinDisplayName()).toBe('プレイヤー');
    saveStoredPlayerName('  なまえ  ');
    expect(getJoinDisplayName()).toBe('なまえ');
  });
});
