import * as THREE from 'three';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import {
  GROUND_Y, TERRAIN_MIN_NORMAL_Y, MAX_STEP_UP,
  MATERIAL_002_SINK_OFFSET, PLAYER_COLLISION_RADIUS,
  FLAT_WORLD_MODE,
  BOUNDARY_WALL_HEIGHT, BOUNDARY_WALL_SEGMENTS,
  BOUNDARY_MARGIN, BOUNDARY_PILLAR_COUNT, BOUNDARY_GROUND_RING_TUBE,
  BOUNDARY_RADIUS, BOUNDARY_RADIUS_CLAMP_TO_TERRAIN,
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

let worldBoundaryRadius = Infinity;

export function getFlatWorldY(): number | null { return flatWorldY; }
export function setFlatWorldY(y: number | null): void { flatWorldY = y; }
export function hasWorldColliders(): boolean { return worldColliders.length > 0; }
export function getWorldBoundaryRadius(): number { return worldBoundaryRadius; }

export function clampToBoundary(x: number, z: number): { x: number; z: number } {
  if (worldBoundaryRadius === Infinity) return { x, z };
  const dist = Math.sqrt(x * x + z * z);
  if (dist <= worldBoundaryRadius) return { x, z };
  const scale = worldBoundaryRadius / dist;
  return { x: x * scale, z: z * scale };
}

function computeGroundRadius(): number {
  if (!worldWalkables.length) return 1.5;
  const b = new THREE.Box3();
  for (const mesh of worldWalkables) b.expandByObject(mesh);
  const size = b.getSize(new THREE.Vector3());
  return Math.min(size.x, size.z) / 2;
}

function createBoundaryWall(targetScene: THREE.Scene, radius: number): void {
  const h = BOUNDARY_WALL_HEIGHT;
  const seg = BOUNDARY_WALL_SEGMENTS;
  const tube = BOUNDARY_GROUND_RING_TUBE;

  // 照明に依存しない明るいバリア（MeshBasic）
  const wallGeo = new THREE.CylinderGeometry(radius, radius, h, seg, 1, true);
  const wallMat = new THREE.MeshBasicMaterial({
    color: 0x33c8ff,
    transparent: true,
    opacity: 0.52,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.y = GROUND_Y + h / 2;
  wall.renderOrder = 2;
  targetScene.add(wall);

  // 内側を少し明るく見せる薄いシェル（エッジが分かりやすい）
  const innerR = Math.max(radius - 0.04, radius * 0.985);
  const innerGeo = new THREE.CylinderGeometry(innerR, innerR, h * 0.98, seg, 1, true);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.14,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  inner.position.y = GROUND_Y + h / 2;
  inner.renderOrder = 3;
  targetScene.add(inner);

  // 地面の太いドーナツ状リング（最も目立つ境界線）
  const groundTorus = new THREE.TorusGeometry(radius, tube, 12, seg);
  const groundTorusMat = new THREE.MeshBasicMaterial({
    color: 0xffee55,
    transparent: true,
    opacity: 0.92,
    depthWrite: true,
  });
  const groundRing = new THREE.Mesh(groundTorus, groundTorusMat);
  groundRing.rotation.x = Math.PI / 2;
  groundRing.position.y = GROUND_Y + tube + 0.002;
  groundRing.renderOrder = 2;
  targetScene.add(groundRing);

  const ringW = 0.045;
  const ringGeo = new THREE.RingGeometry(radius - ringW, radius + ringW, seg);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00e8ff,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = GROUND_Y + 0.006;
  ring.renderOrder = 2;
  targetScene.add(ring);

  const topRing = new THREE.Mesh(ringGeo.clone(), ringMat.clone());
  topRing.rotation.x = -Math.PI / 2;
  topRing.position.y = GROUND_Y + h;
  topRing.renderOrder = 2;
  targetScene.add(topRing);

  const pillarCount = BOUNDARY_PILLAR_COUNT;
  const pillarH = h + 0.12;
  const pillarR = 0.024;
  const pillarGeo = new THREE.CylinderGeometry(pillarR, pillarR, pillarH, 8);
  const pillarMat = new THREE.MeshBasicMaterial({
    color: 0xfff8a8,
    transparent: true,
    opacity: 0.95,
    depthWrite: true,
  });
  for (let i = 0; i < pillarCount; i++) {
    const angle = (i / pillarCount) * Math.PI * 2;
    const px = Math.cos(angle) * radius;
    const pz = Math.sin(angle) * radius;
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(px, GROUND_Y + pillarH / 2, pz);
    pillar.renderOrder = 2;
    targetScene.add(pillar);
  }
}

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

    const autoRadius = Math.max(0.05, computeGroundRadius() - BOUNDARY_MARGIN);
    if (BOUNDARY_RADIUS != null && BOUNDARY_RADIUS > 0) {
      worldBoundaryRadius = BOUNDARY_RADIUS_CLAMP_TO_TERRAIN
        ? Math.min(BOUNDARY_RADIUS, autoRadius)
        : Math.max(0.05, BOUNDARY_RADIUS);
    } else {
      worldBoundaryRadius = autoRadius;
    }
    if (worldBoundaryRadius > 0.1) {
      createBoundaryWall(targetScene, worldBoundaryRadius);
      console.log('Boundary wall created, radius:', worldBoundaryRadius, {
        auto: autoRadius,
        configured: BOUNDARY_RADIUS,
        clampToTerrain: BOUNDARY_RADIUS_CLAMP_TO_TERRAIN,
      });
    }

    console.log('World map loaded:', WORLD_MAP_OBJ_URL);
  } catch (e) {
    console.warn('World map load failed, fallback to default ground.', e);
  }
}
