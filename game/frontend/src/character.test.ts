/** @vitest-environment happy-dom */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { gltfBasePath, tintModel } from './character';

describe('character', () => {
  it('gltfBasePath は最後のスラッシュまでのディレクトリ', () => {
    expect(gltfBasePath('https://x.com/a/b/model.glb')).toBe('https://x.com/a/b/');
    expect(gltfBasePath('model.glb')).toBe('');
  });

  it('tintModel は色が空なら何もしない', () => {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, name: 'body' }),
    );
    mesh.name = 'body_mesh';
    g.add(mesh);
    tintModel(g, '');
    expect(mesh.material).toBeTruthy();
  });
});
