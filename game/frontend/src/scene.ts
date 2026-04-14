import * as THREE from 'three';
import { GROUND_Y } from './config';

export const renderer = (() => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) throw new Error('Missing element #game-canvas');
  const r = new THREE.WebGLRenderer({ canvas, antialias: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r.setSize(window.innerWidth, window.innerHeight);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  return r;
})();

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7ec8e3);
scene.fog = new THREE.Fog(0x7ec8e3, 30, 80);

export const camera = new THREE.PerspectiveCamera(
  50, window.innerWidth / window.innerHeight, 0.05, 200,
);

const hemi = new THREE.HemisphereLight(0xffffff, 0x9a8f7a, 5);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff, 0.26);
scene.add(ambient);

export const sun = new THREE.DirectionalLight(0xfff5e6, 1.1);
sun.position.set(8, 12, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 40;
sun.shadow.camera.left = -15;
sun.shadow.camera.right = 15;
sun.shadow.camera.top = 15;
sun.shadow.camera.bottom = -15;
scene.add(sun);

const groundGeo = new THREE.PlaneGeometry(200, 200);
const groundMat = new THREE.MeshStandardMaterial({ color: 0xe6d2b5, roughness: 0.88, metalness: 0.02 });
export const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = GROUND_Y;
ground.receiveShadow = true;
scene.add(ground);

export const grid = new THREE.GridHelper(200, 42, 0x1a1410, 0x1a1410);
grid.position.y = GROUND_Y + 0.001;
scene.add(grid);

export const box = new THREE.Box3();
export const clock = new THREE.Clock();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
