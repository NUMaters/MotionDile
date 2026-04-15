import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import * as THREE from 'three';
import { FALLBACK_PLAYER_COLOR } from './config';

let labelRenderer: CSS2DRenderer | null = null;

export function initLabelRenderer(container: HTMLElement): CSS2DRenderer {
  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  const el = labelRenderer.domElement;
  el.id = 'label-renderer';
  el.style.position = 'absolute';
  el.style.top = '0';
  el.style.left = '0';
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '58';
  el.style.overflow = 'visible';
  container.appendChild(el);

  window.addEventListener('resize', () => {
    labelRenderer?.setSize(window.innerWidth, window.innerHeight);
  });

  return labelRenderer;
}

export function renderLabels(scene: THREE.Scene, camera: THREE.Camera): void {
  labelRenderer?.render(scene, camera);
}

/**
 * ラベルを作成し、親 Object3D のローカル Y に配置する。
 * ワニモデルはスケール WANI_SCALE=2 で normalizeCharacterRoot 後の
 * ローカル座標系で高さ約 0.15（= ワールド 0.30）程度なので、
 * ローカル Y=0.20 ≈ ワールド 0.40 で頭上に来る。
 */
/** マッチング／サーバー `PlayerState.color` と同じ色で枠線を付ける */
export function applyPlayerLabelAccent(el: HTMLElement, color: string | undefined): void {
  const c = color && color.trim() !== '' ? color.trim() : FALLBACK_PLAYER_COLOR;
  el.style.border = `2px solid ${c}`;
  el.style.boxShadow = '0 3px 10px rgba(0,0,0,0.45)';
}

export function setNameLabelAccent(label: unknown, color: string | undefined): void {
  const obj = label as { element?: HTMLElement };
  if (!obj?.element) return;
  applyPlayerLabelAccent(obj.element, color);
}

export function createNameLabel(name: string, accentColor?: string): CSS2DObject {
  const div = document.createElement('div');
  div.className = 'player-name-label';
  div.textContent = name || '';
  div.style.opacity = name ? '1' : '0';
  applyPlayerLabelAccent(div, accentColor);
  const label = new CSS2DObject(div);
  label.position.set(0, 0.20, 0);
  label.center.set(0.5, 1);
  return label;
}

/**
 * モデルのバウンディングボックスからラベル高さを自動計算する。
 * ワールド空間のボックス最上部をローカル座標に変換し、少し上にオフセット。
 */
export function autoPositionLabel(label: CSS2DObject, modelRoot: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(modelRoot);
  const worldTop = box.max.y;
  const rootWorldY = modelRoot.getWorldPosition(new THREE.Vector3()).y;
  const scale = modelRoot.scale.y || 1;
  const localTopFromRoot = (worldTop - rootWorldY) / scale;
  label.position.set(0, localTopFromRoot + 0.005, 0);
}

export function updateNameLabelText(label: unknown, name: string, accentColor?: string): void {
  const obj = label as CSS2DObject;
  if (!obj?.element) return;
  const el = obj.element as HTMLDivElement;
  el.textContent = name || '';
  el.style.opacity = name ? '1' : '0';
  if (accentColor !== undefined) {
    applyPlayerLabelAccent(el, accentColor);
  }
}
