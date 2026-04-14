import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { tintModel, setLocomotionWeights } from './character';
import { renderer as mainRenderer } from './scene';
import { WANI_SCALE } from './config';

function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      (mat as THREE.Material)?.dispose?.();
    }
  });
}

/**
 * iOS Safari では複数 WebGL コンテキストが同時に生存すると
 * 描画されないことがあるため、メインの renderer を一時借用して
 * オフスクリーンレンダリングし、JPEG を img に焼き付けて表示する。
 */
export function mountVotePreviews(
  mounts: HTMLElement[],
  colors: string[],
  template: THREE.Group,
  clips: THREE.AnimationClip[],
): void {
  disposeVotePreviews();
  if (!mounts.length || !clips.length) return;

  const size = 256;

  const savedSize = mainRenderer.getSize(new THREE.Vector2());
  const savedPixelRatio = mainRenderer.getPixelRatio();
  const savedClearColor = mainRenderer.getClearColor(new THREE.Color());
  const savedClearAlpha = mainRenderer.getClearAlpha();
  const savedToneMapping = mainRenderer.toneMapping;
  const savedExposure = mainRenderer.toneMappingExposure;
  const savedShadow = mainRenderer.shadowMap.enabled;

  const renderTarget = new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });

  mainRenderer.setPixelRatio(1);
  mainRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  mainRenderer.toneMappingExposure = 1.08;
  mainRenderer.shadowMap.enabled = false;

  const readBuf = new Uint8Array(size * size * 4);
  const offCanvas = document.createElement('canvas');
  offCanvas.width = size;
  offCanvas.height = size;
  const ctx2d = offCanvas.getContext('2d')!;

  try {
    for (let i = 0; i < mounts.length; i++) {
      const mount = mounts[i];
      const color = colors[i] || '#58a6ff';
      mount.replaceChildren();

      const previewScene = new THREE.Scene();
      previewScene.background = new THREE.Color(0x8ecae6);
      previewScene.add(new THREE.AmbientLight(0xffffff, 0.62));
      const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.85);
      previewScene.add(hemi);
      const dir = new THREE.DirectionalLight(0xfff5e6, 1.15);
      dir.position.set(2.2, 4.5, 2.8);
      previewScene.add(dir);
      const fill = new THREE.DirectionalLight(0xb8d4ff, 0.35);
      fill.position.set(-1.5, 1.2, -1);
      previewScene.add(fill);

      const root = cloneSkinned(template) as THREE.Group;
      tintModel(root, color);
      root.scale.setScalar(WANI_SCALE);
      root.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(root);
      const center = b.getCenter(new THREE.Vector3());
      root.position.sub(center);
      root.position.y = -b.min.y + center.y;
      root.rotation.y = 0.42;
      previewScene.add(root);

      const mixer = new THREE.AnimationMixer(root);
      const actions: Record<string, THREE.AnimationAction> = {};
      for (const clip of clips) {
        const a = mixer.clipAction(clip);
        a.enabled = true;
        a.play();
        a.setEffectiveWeight(0);
        actions[clip.name] = a;
      }
      if (actions.TailWag) actions.TailWag.setEffectiveWeight(0);
      setLocomotionWeights(0, 0, 0, actions);
      for (let s = 0; s < 8; s++) {
        mixer.update(1 / 30);
      }
      root.updateMatrixWorld(true);

      const bFinal = new THREE.Box3().setFromObject(root);
      const cFinal = bFinal.getCenter(new THREE.Vector3());
      const bSize = bFinal.getSize(new THREE.Vector3());
      const maxDim = Math.max(bSize.x, bSize.y, bSize.z);
      const fov = 38;
      const dist = (maxDim / 2) / Math.tan((fov / 2) * Math.PI / 180) * 1.2;

      const camera = new THREE.PerspectiveCamera(fov, 1, 0.01, dist * 4);
      camera.position.set(cFinal.x + dist * 0.12, cFinal.y + maxDim * 0.08, cFinal.z + dist);
      camera.lookAt(cFinal);

      mainRenderer.setRenderTarget(renderTarget);
      mainRenderer.setClearColor(0x8ecae6, 1);
      mainRenderer.clear();
      mainRenderer.render(previewScene, camera);

      mainRenderer.readRenderTargetPixels(renderTarget, 0, 0, size, size, readBuf);

      const imgData = ctx2d.createImageData(size, size);
      for (let row = 0; row < size; row++) {
        const srcOff = (size - 1 - row) * size * 4;
        const dstOff = row * size * 4;
        imgData.data.set(readBuf.subarray(srcOff, srcOff + size * 4), dstOff);
      }
      ctx2d.putImageData(imgData, 0, 0);

      const img = document.createElement('img');
      img.className = 'vote-preview-img';
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      img.loading = 'eager';
      img.src = offCanvas.toDataURL('image/jpeg', 0.9);
      mount.appendChild(img);

      mixer.stopAllAction();
      disposeObject3D(root);
      previewScene.clear();
    }
  } finally {
    renderTarget.dispose();
    mainRenderer.setRenderTarget(null);
    mainRenderer.setPixelRatio(savedPixelRatio);
    mainRenderer.setSize(savedSize.x, savedSize.y, false);
    mainRenderer.setClearColor(savedClearColor, savedClearAlpha);
    mainRenderer.toneMapping = savedToneMapping;
    mainRenderer.toneMappingExposure = savedExposure;
    mainRenderer.shadowMap.enabled = savedShadow;
  }
}

export function disposeVotePreviews(): void {
  for (const el of document.querySelectorAll('.vote-preview-mount')) {
    el.replaceChildren();
  }
}
