import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isUIMirrored, setUIMirrored } from './ui-layout';

const STORAGE_KEY = 'waniar:ui-layout-mirrored';

function mockLocalStorage(): Record<string, string> {
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
  return storage;
}

describe('ui-layout', () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  it('isUIMirrored は localStorage が 1 のとき true', () => {
    localStorage.setItem(STORAGE_KEY, '1');
    expect(isUIMirrored()).toBe(true);
    localStorage.setItem(STORAGE_KEY, '0');
    expect(isUIMirrored()).toBe(false);
  });

  it('setUIMirrored が shell クラスと uilayoutchange を発火する', () => {
    const toggle = vi.fn();
    const shell = { classList: { toggle } };
    const dispatchEvent = vi.fn(() => true);
    globalThis.document = {
      querySelector: (sel: string) => (sel === '.game-shell' ? shell : null),
      getElementById: vi.fn(() => null),
    } as unknown as Document;
    globalThis.window = { dispatchEvent } as unknown as Window & typeof globalThis;

    setUIMirrored(true);
    expect(toggle).toHaveBeenCalledWith('game-shell--ui-mirrored', true);
    expect(dispatchEvent).toHaveBeenCalled();
    const ev = dispatchEvent.mock.calls[0][0] as CustomEvent;
    expect(ev.type).toBe('uilayoutchange');
  });
});
