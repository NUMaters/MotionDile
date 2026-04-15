import * as THREE from 'three';
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { tintModel, setLocomotionWeights } from './character';
import { renderer as mainRenderer } from './scene';
import { WANI_SCALE } from './config';

const tmpV = new THREE.Vector3();
const tmpSphere = new THREE.Sphere();

/** PBR が環境光無しで真っ黒に近くなるのを防ぐ（プレビュー用） */
function boostPreviewMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const raw of mats) {
      if (!(raw instanceof THREE.MeshStandardMaterial)) continue;
      const m = raw;
      m.envMapIntensity = Math.max(m.envMapIntensity, 1);
      m.metalness = Math.min(m.metalness, 0.12);
      m.roughness = Math.max(0.35, m.roughness * 0.92);
    }
  });
}

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
  /** プレビュー専用: ACES は中間調が潰れやすいので Reinhard + 露出を上げる */
  mainRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  mainRenderer.toneMappingExposure = 1.35;
  mainRenderer.shadowMap.enabled = false;

  const pmremGenerator = new PMREMGenerator(mainRenderer);
  const roomEnv = new RoomEnvironment();
  const envRT = pmremGenerator.fromScene(roomEnv, 0.04);
  const envMap = envRT.texture;

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
      previewScene.background = new THREE.Color(0xa8d4ec);
      previewScene.environment = envMap;

      /** IBL + 補助ライト（投票カード用サムネは近接・明るめ） */
      previewScene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const hemi = new THREE.HemisphereLight(0xfff5e8, 0x8899bb, 0.85);
      previewScene.add(hemi);

      const key = new THREE.DirectionalLight(0xfff8f0, 1.65);
      key.position.set(1.4, 4.2, 2.0);
      previewScene.add(key);

      const fill = new THREE.DirectionalLight(0xe8f0ff, 1.1);
      fill.position.set(-1.8, 2.4, -1.4);
      previewScene.add(fill);

      const rim = new THREE.DirectionalLight(0xffeedd, 0.75);
      rim.position.set(-0.6, 1.0, 2.8);
      previewScene.add(rim);

      const bounce = new THREE.PointLight(0xd0d8f0, 0.65, 14, 1.2);
      bounce.position.set(0, 0.35, 1.0);
      previewScene.add(bounce);

      const pivot = new THREE.Group();
      const root = cloneSkinned(template) as THREE.Group;
      tintModel(root, color);
      boostPreviewMaterials(root);
      root.scale.setScalar(WANI_SCALE);

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
      for (let s = 0; s < 14; s++) {
        mixer.update(1 / 30);
      }

      root.updateMatrixWorld(true);
      const b0 = new THREE.Box3().setFromObject(root);
      const c0 = b0.getCenter(tmpV);
      root.position.set(-c0.x, -b0.min.y, -c0.z);
      pivot.add(root);
      pivot.rotation.y = 0.42;
      previewScene.add(pivot);
      pivot.updateMatrixWorld(true);

      const bWorld = new THREE.Box3().setFromObject(pivot);
      bWorld.getBoundingSphere(tmpSphere);
      const center = tmpSphere.center;
      const sphereRad = Math.max(tmpSphere.radius, 0.08);
      const size3 = bWorld.getSize(new THREE.Vector3());
      const maxDim = Math.max(size3.x, size3.y, size3.z, sphereRad * 2);

      const fov = 24;
      const vRad = (fov * Math.PI) / 180;
      /** 枠いっぱいに寄せる（以前は margin が大きくモデルが豆粒に見えていた） */
      const margin = 0.32;
      const fitRadius = Math.max(sphereRad, maxDim * 0.42);
      const dist = fitRadius / Math.tan(vRad / 2) * margin;

      /** 視線: やや上から・斜め前（ワニの正面が見える向き） */
      const eye = new THREE.Vector3(0.72, 0.38, 1).normalize();
      const camera = new THREE.PerspectiveCamera(fov, 1, 0.02, dist * 8);
      camera.position.copy(center).add(eye.multiplyScalar(dist));
      camera.up.set(0, 1, 0);
      camera.lookAt(center);

      bounce.position.copy(center).add(new THREE.Vector3(0.4, 0.5, 0.6));

      mainRenderer.setRenderTarget(renderTarget);
      mainRenderer.setClearColor(0xa8d4ec, 1);
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
      img.src = offCanvas.toDataURL('image/jpeg', 0.92);
      mount.appendChild(img);

      mixer.stopAllAction();
      disposeObject3D(root);
      previewScene.clear();
    }
  } finally {
    envRT.dispose();
    pmremGenerator.dispose();
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
