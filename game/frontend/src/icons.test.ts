/** @vitest-environment happy-dom */

import { describe, it, expect } from 'vitest';
import { IC } from './icons';

describe('icons IC', () => {
  it('SVG 文字列を返す', () => {
    const html = IC.gamepad();
    expect(html).toContain('<svg');
    expect(html).toContain('width="20"');
    expect(html).toContain('height="20"');
  });

  it('サイズ指定が width/height に反映される', () => {
    const html = IC.check(32);
    expect(html).toContain('width="32"');
    expect(html).toContain('height="32"');
  });
});
