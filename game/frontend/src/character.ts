import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  GROUND_Y, WANI_SCALE, CLIP_NAMES,
  TINT_SKIP_NAME, BODY_TINT_MAP_BLEND, BODY_TINT_SOLID_BLEND,
  BODY_EMISSIVE_MUL, BODY_EMISSIVE_INTENSITY,
} from './config';
import { clamp } from './utils';

export function normalizeCharacterRoot(root: THREE.Group): void {
  root.scale.setScalar(WANI_SCALE);
  root.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(root);
  const center = b.getCenter(new THREE.Vector3());
  root.position.sub(center);
  root.position.y = GROUND_Y - b.min.y;
}

export function setupActions(
  gltf: GLTF,
  mixerOut: { mixer: THREE.AnimationMixer },
  actionsOut: Record<string, THREE.AnimationAction>,
): void {
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.addEventListener('finished', (e: object) => {
    const ev = e as { action: THREE.AnimationAction };
    if (ev.action === actionsOut.Attack) ev.action.fadeOut(0.18);
  });
  for (const clip of gltf.animations) {
    const a = mixer.clipAction(clip);
    a.enabled = true;
    if (clip.name === 'Attack') {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    } else {
      a.setLoop(THREE.LoopRepeat, Infinity);
    }
    a.play();
    a.setEffectiveWeight(0);
    actionsOut[clip.name] = a;
  }
  for (const n of CLIP_NAMES) {
    if (!actionsOut[n]) console.warn('Missing clip:', n);
  }
  if (actionsOut.Idle) actionsOut.Idle.setEffectiveWeight(1);
  if (actionsOut.TailWag) actionsOut.TailWag.setEffectiveWeight(0);
  mixerOut.mixer = mixer;
}

export function setLocomotionWeights(
  speed: number,
  mouthAmount: number,
  runBlend: number,
  actions: Record<string, THREE.AnimationAction>,
): void {
  const move = clamp(speed, 0, 1);
  const run = clamp(runBlend, 0, 1);
  const runGate = clamp((move - 0.42) / 0.36, 0, 1);
  const runWeight = move * run * runGate;
  const walkWeight = clamp(move - runWeight, 0, 1);
  const idleWeight = clamp(1 - move, 0, 1);
  const sum = Math.max(0.0001, idleWeight + walkWeight + runWeight);
  const idle = idleWeight / sum;
  const walk = walkWeight / sum;
  const fast = runWeight / sum;
  const closed = 1 - mouthAmount;

  const w: Record<string, number> = {
    Idle: idle * closed,
    Walk: walk * closed,
    Run: fast * closed,
    Idle_MouthOpen: idle * mouthAmount,
    Walk_MouthOpen: walk * mouthAmount,
    Run_MouthOpen: fast * mouthAmount,
  };
  for (const [name, wt] of Object.entries(w)) {
    if (actions[name]) actions[name].setEffectiveWeight(wt);
  }
}

function isLikelyOralInterior(mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial): boolean {
  const c = mat.color;
  if (c.r > c.g + 0.04) return true;
  if (c.r > 0.35 && c.g < 0.28 && c.b < 0.35) return true;
  return false;
}

function applyTintToMaterial(
  src: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  tint: THREE.Color,
  white: THREE.Color,
): THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
  const clone = src.clone() as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
  if (src.map) {
    clone.color.copy(white).lerp(tint, BODY_TINT_MAP_BLEND);
  } else {
    clone.color.copy(src.color).lerp(tint, BODY_TINT_SOLID_BLEND);
  }
  clone.emissive.copy(tint).multiplyScalar(BODY_EMISSIVE_MUL);
  clone.emissiveIntensity = BODY_EMISSIVE_INTENSITY;
  return clone;
}

export function tintModel(root: THREE.Object3D, hexColor: string): void {
  if (!hexColor) return;
  const tint = new THREE.Color(hexColor);
  const white = new THREE.Color(0xffffff);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (TINT_SKIP_NAME.test(mesh.name)) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let i = 0; i < mats.length; i++) {
      const raw = mats[i];
      if (!raw || typeof raw !== 'object' || !('isMaterial' in raw)) continue;
      const src = raw as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
      if (!src.isMeshStandardMaterial) continue;
      if (TINT_SKIP_NAME.test(src.name)) continue;
      if (isLikelyOralInterior(src)) continue;
      const clone = applyTintToMaterial(src, tint, white);
      if (Array.isArray(mesh.material)) {
        mesh.material[i] = clone;
      } else {
        mesh.material = clone;
      }
    }
  });
}

export function loadBinaryWithXHR(
  url: string,
  onProgress: ((pct: number, loaded: number, total: number) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';

    const onAbort = () => {
      xhr.abort();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const pct = Math.min(100, Math.round((e.loaded / e.total) * 100));
        onProgress(pct, e.loaded, e.total);
      } else if (onProgress && e.loaded) {
        onProgress(0, e.loaded, 0);
      }
    };
    xhr.onload = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as ArrayBuffer);
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new Error('ネットワークエラー（XHR）'));
    };
    xhr.onabort = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    xhr.send();
  });
}

export function gltfBasePath(url: string): string {
  const i = url.lastIndexOf('/');
  return i >= 0 ? url.slice(0, i + 1) : '';
}
