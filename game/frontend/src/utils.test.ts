import { describe, it, expect } from 'vitest';
import { clamp, smoothToward, errorToText } from './utils';

describe('clamp', () => {
  it('範囲内はそのまま', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it('下限でクリップ', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
  });
  it('上限でクリップ', () => {
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe('smoothToward', () => {
  it('目標へ指数移動（dt=0 で現状維持に近い）', () => {
    const a = smoothToward(0, 10, 0, 10);
    expect(a).toBe(0);
  });
  it('目標に近づく', () => {
    const a = smoothToward(0, 10, 0.1, 10);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(10);
  });
  it('すでに一致ならそのまま', () => {
    expect(smoothToward(5, 5, 0.1, 10)).toBe(5);
  });
});

describe('errorToText', () => {
  it('Error を message に', () => {
    expect(errorToText(new Error('x'))).toBe('x');
  });
  it('文字列はそのまま', () => {
    expect(errorToText('oops')).toBe('oops');
  });
  it('nullish は unknown', () => {
    expect(errorToText(null)).toBe('unknown');
    expect(errorToText(undefined)).toBe('unknown');
  });
});
