/** @vitest-environment happy-dom */

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import App from './App.vue';

describe('App.vue', () => {
  it('game-shell がマウントされる', () => {
    const w = mount(App, { attachTo: document.body });
    expect(w.find('.game-shell').exists()).toBe(true);
    w.unmount();
  });
});
