import * as THREE from 'three';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import {
  GROUND_Y, TERRAIN_MIN_NORMAL_Y, MAX_STEP_UP,
  MATERIAL_002_SINK_OFFSET, PLAYER_COLLISION_RADIUS,
  FLAT_WORLD_MODE,
} from './config';

const WORLD_MAP_OBJ_URL = new URL('./data/tex.obj', import.meta.url).href;
const WORLD_MAP_MTL_URL = new URL('./data/tex.mtl', import.meta.url).href;

const worldColliders: THREE.Mesh[] = [];
const worldWalkables: THREE.Mesh[] = [];
const worldObstacles: THREE.Mesh[] = [];
let flatWorldY: number | null = null;

const terrainRay = new THREE.Raycaster();
const collisionRay = new THREE.Raycaster();
const vTmpA = new THREE.Vector3();
const vTmpB = new THREE.Vector3();
const vDown = new THREE.Vector3(0, -1, 0);

export function getFlatWorldY(): number | null { return flatWorldY; }
export function setFlatWorldY(y: number | null): void { flatWorldY = y; }
export function hasWorldColliders(): boolean { return worldColliders.length > 0; }

function refreshWorldColliders(root: THREE.Group) {
  worldColliders.length = 0;
  worldWalkables.length = 0;
  worldObstacles.length = 0;
  root.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    worldColliders.push(mesh);
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
    const names = mats.map((m) => m?.name || '').join(' ').toLowerCase();
    const isMaterial002 = names.includes('материал.002');
    const isStone = names.includes('stone');
    const walkable = isMaterial002 || /(grass|ground|plane|terrain|floor|land)/.test(names);
    mesh.userData.isMaterial002 = isMaterial002;
    mesh.userData.isStone = isStone;
    if (walkable) worldWalkables.push(mesh);
    else worldObstacles.push(mesh);
  });
}

function getHitWorldNormal(hit: THREE.Intersection): THREE.Vector3 | null {
  if (!hit.face) return null;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
  return hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
}

export function sampleTerrainHeight(x: number, z: number, yHint: number): number | null {
  if (!worldColliders.length) return null;
  vTmpA.set(x, yHint + 8, z);
  terrainRay.set(vTmpA, vDown);
  terrainRay.near = 0;
  terrainRay.far = 24;
  const hits = terrainRay.intersectObjects(worldColliders, false);
  for (const hit of hits) {
    if (hit.point.y > yHint + MAX_STEP_UP) continue;
    const n = getHitWorldNormal(hit);
    if (n && n.y >= TERRAIN_MIN_NORMAL_Y) return hit.point.y;
  }
  return null;
}

export function sampleFlatFloorY(x: number, z: number): number | null {
  if (!worldWalkables.length) return null;
  vTmpA.set(x, 18, z);
  terrainRay.set(vTmpA, vDown);
  terrainRay.near = 0;
  terrainRay.far = 40;
  const hits = terrainRay.intersectObjects(worldWalkables, false);
  let floorY: number | null = null;
  for (const hit of hits) {
    const n = getHitWorldNormal(hit);
    if (!n || n.y < TERRAIN_MIN_NORMAL_Y) continue;
    if (floorY == null || hit.point.y < floorY) floorY = hit.point.y;
  }
  return floorY;
}

export function sampleMaterial002SinkOffset(x: number, z: number): number {
  if (!worldWalkables.length) return 0;
  vTmpA.set(x, 18, z);
  terrainRay.set(vTmpA, vDown);
  terrainRay.near = 0;
  terrainRay.far = 40;
  const hits = terrainRay.intersectObjects(worldWalkables, false);
  for (const hit of hits) {
    const n = getHitWorldNormal(hit);
    if (!n || n.y < TERRAIN_MIN_NORMAL_Y) continue;
    const mesh = hit.object as THREE.Mesh;
    if (mesh.userData.isMaterial002) return MATERIAL_002_SINK_OFFSET;
    return 0;
  }
  return 0;
}

export function canMoveOnWorld(
  curPos: THREE.Vector3,
  nextX: number,
  nextZ: number,
  playerFootOffset: number,
): boolean {
  if (!worldObstacles.length) return true;
  vTmpA.set(nextX - curPos.x, 0, nextZ - curPos.z);
  const dist = vTmpA.length();
  if (dist < 1e-5) return true;
  vTmpA.multiplyScalar(1 / dist);
  const sideX = -vTmpA.z;
  const sideZ = vTmpA.x;
  const offsets = [0, PLAYER_COLLISION_RADIUS * 0.55, -PLAYER_COLLISION_RADIUS * 0.55];
  const heights = [0.04, playerFootOffset * 0.7];

  for (const h of heights) {
    for (const off of offsets) {
      vTmpB.set(curPos.x + sideX * off, curPos.y + h, curPos.z + sideZ * off);
      collisionRay.set(vTmpB, vTmpA);
      collisionRay.near = 0.001;
      collisionRay.far = dist + PLAYER_COLLISION_RADIUS * 0.8;
      const hits = collisionRay.intersectObjects(worldObstacles, false);
      if (!hits.length) continue;
      for (const hit of hits) {
        const mesh = hit.object as THREE.Mesh;
        const aroundBody = hit.point.y > (curPos.y - 0.08) && hit.point.y < (curPos.y + playerFootOffset * 1.9);
        if (mesh.userData.isStone) {
          if (aroundBody && hit.distance <= dist + PLAYER_COLLISION_RADIUS * 0.3) return false;
          continue;
        }
        const n = getHitWorldNormal(hit);
        if (!n) continue;
        const isWallLike = Math.abs(n.y) < 0.6;
        if (isWallLike && aroundBody) return false;
      }
    }
  }
  return true;
}

function normalizeWorldMap(object: THREE.Group) {
  const b0 = new THREE.Box3().setFromObject(object);
  const size = b0.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const targetSpan = 3;
  if (maxDim > 0.001) {
    object.scale.setScalar(targetSpan / maxDim);
  }

  const b1 = new THREE.Box3().setFromObject(object);
  const center = b1.getCenter(new THREE.Vector3());
  object.position.sub(center);
  const b2 = new THREE.Box3().setFromObject(object);
  object.position.y += GROUND_Y - b2.min.y;
}

export async function loadWorldMap(
  targetScene: THREE.Scene,
  ground: THREE.Mesh,
  grid: THREE.GridHelper,
): Promise<void> {
  try {
    const mtlLoader = new MTLLoader();
    const objLoader = new OBJLoader();
    const mtl = await mtlLoader.loadAsync(WORLD_MAP_MTL_URL);
    mtl.preload();
    objLoader.setMaterials(mtl);
    const obj = await objLoader.loadAsync(WORLD_MAP_OBJ_URL);
    obj.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      const mats = Array.isArray(material) ? material : (material ? [material] : []);
      for (const m of mats) {
        m.side = THREE.FrontSide;
        m.needsUpdate = true;
      }
    });

    normalizeWorldMap(obj);
    targetScene.add(obj);
    refreshWorldColliders(obj);
    if (FLAT_WORLD_MODE) {
      const y = sampleFlatFloorY(0, 0);
      if (y != null) {
        obj.position.y += GROUND_Y - y;
        refreshWorldColliders(obj);
        flatWorldY = GROUND_Y;
      }
    }
    ground.visible = true;
    grid.visible = false;
    console.log('World map loaded:', WORLD_MAP_OBJ_URL);
  } catch (e) {
    console.warn('World map load failed, fallback to default ground.', e);
  }
}
