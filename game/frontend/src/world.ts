import * as THREE from 'three';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import {
  GROUND_Y, TERRAIN_MIN_NORMAL_Y, MAX_STEP_UP,
  MATERIAL_002_SINK_OFFSET, PLAYER_COLLISION_RADIUS,
  PLAYER_GROUND_CLEARANCE, PLAYER_HEIGHT_OFFSET,
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

export type Landmark = { type: 'rock' | 'tree'; x: number; z: number };
let extractedLandmarks: Landmark[] = [];
export function getWorldLandmarks(): Landmark[] { return extractedLandmarks; }

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
    /** 草地・地面クラスに加え、岩の上面も足場レイに含める（登攀用） */
    const walkable =
      isMaterial002 || isStone || /(grass|ground|plane|terrain|floor|land)/.test(names);
    mesh.userData.isMaterial002 = isMaterial002;
    mesh.userData.isStone = isStone;
    if (walkable) worldWalkables.push(mesh);
    if (!walkable || isStone) worldObstacles.push(mesh);
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

/**
 * 上からレイを飛ばし、**最初に見つかった**足場の高さ（草地・岩の上面など）を返す。
 * 以前は最も低い面を採っていたため、岩の下の地面が選ばれて乗れなかった。
 */
export function sampleFlatFloorY(x: number, z: number): number | null {
  if (!worldWalkables.length) return null;
  vTmpA.set(x, 18, z);
  terrainRay.set(vTmpA, vDown);
  terrainRay.near = 0;
  terrainRay.far = 40;
  const hits = terrainRay.intersectObjects(worldWalkables, false);
  for (const hit of hits) {
    const n = getHitWorldNormal(hit);
    if (!n || n.y < TERRAIN_MIN_NORMAL_Y) continue;
    return hit.point.y;
  }
  return null;
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

  let blocked = false;
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
          const n = getHitWorldNormal(hit);
          /** 岩の上面（足場）は横移動の壁として扱わない */
          if (n && n.y >= TERRAIN_MIN_NORMAL_Y) continue;
          if (aroundBody && hit.distance <= dist + PLAYER_COLLISION_RADIUS * 0.3) {
            blocked = true;
            break;
          }
          continue;
        }
        const n = getHitWorldNormal(hit);
        if (!n) continue;
        const isWallLike = Math.abs(n.y) < 0.6;
        if (isWallLike && aroundBody) {
          blocked = true;
          break;
        }
      }
      if (blocked) break;
    }
    if (blocked) break;
  }

  if (!blocked) return true;

  /** 横レイで側面に当たっても、移動先の足場が `MAX_STEP_UP` 以内なら段を登る */
  const yHere = sampleFlatFloorY(curPos.x, curPos.z);
  const yThere = sampleFlatFloorY(nextX, nextZ);
  if (yHere != null && yThere != null) {
    const rise = yThere - yHere;
    if (rise >= 0.012 && rise <= MAX_STEP_UP) return true;
  }
  return false;
}

function extractLandmarks(root: THREE.Group): Landmark[] {
  const groups = new Map<string, { type: 'rock' | 'tree'; positions: THREE.Vector3[] }>();
  root.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
    const names = mats.map(m => (m?.name || '').toLowerCase()).join(' ');
    let lmType: 'rock' | 'tree' | null = null;
    if (/stone/.test(names)) lmType = 'rock';
    else if (/bark|trunk|crown|leaf|leaves/.test(names)) lmType = 'tree';
    if (!lmType) return;
    mesh.updateMatrixWorld(true);
    const center = new THREE.Vector3();
    new THREE.Box3().setFromObject(mesh).getCenter(center);
    const key = `${lmType}_${Math.round(center.x * 20)}_${Math.round(center.z * 20)}`;
    if (!groups.has(key)) groups.set(key, { type: lmType, positions: [] });
    groups.get(key)!.positions.push(center);
  });

  const merged = new Map<string, Landmark>();
  for (const [, g] of groups) {
    const avg = new THREE.Vector3();
    for (const p of g.positions) avg.add(p);
    avg.divideScalar(g.positions.length);
    const clusterKey = `${g.type}_${Math.round(avg.x * 5)}_${Math.round(avg.z * 5)}`;
    if (!merged.has(clusterKey)) {
      merged.set(clusterKey, { type: g.type, x: +avg.x.toFixed(3), z: +avg.z.toFixed(3) });
    }
  }
  return Array.from(merged.values());
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

    extractedLandmarks = extractLandmarks(obj);
    console.log('World landmarks:', extractedLandmarks);
    console.log('World map loaded:', WORLD_MAP_OBJ_URL);
  } catch (e) {
    console.warn('World map load failed, fallback to default ground.', e);
  }
}

const spawnStandPos = new THREE.Vector3();

/**
 * 指定 XZ で足元が足場にあり、体の周囲が障害物にめり込まないか（移動判定と同系統）。
 * `footOffset` はローカルキャラのバウンディングから求めた足元〜ルートのオフセット。
 */
export function isValidStandingSpawnXZ(x: number, z: number, footOffset: number): boolean {
  if (!worldWalkables.length) return false;
  const fwY = sampleFlatFloorY(x, z);
  if (fwY == null) return false;
  const { x: cx, z: cz } = clampToBoundary(x, z);
  if ((cx - x) ** 2 + (cz - z) ** 2 > 1e-5) return false;
  const br = getWorldBoundaryRadius();
  if (Number.isFinite(br) && Math.hypot(cx, cz) > br + 1e-4) return false;
  const sink = sampleMaterial002SinkOffset(cx, cz);
  const modelY = fwY + footOffset + PLAYER_GROUND_CLEARANCE + PLAYER_HEIGHT_OFFSET - sink;
  spawnStandPos.set(cx, modelY, cz);
  const step = PLAYER_COLLISION_RADIUS * 1.2;
  const dirs: [number, number][] = [
    [step, 0],
    [-step, 0],
    [0, step],
    [0, -step],
    [step * 0.707, step * 0.707],
    [step * 0.707, -step * 0.707],
    [-step * 0.707, step * 0.707],
    [-step * 0.707, -step * 0.707],
  ];
  for (const [dx, dz] of dirs) {
    if (!canMoveOnWorld(spawnStandPos, cx + dx, cz + dz, footOffset)) return false;
  }
  return true;
}

/** `scatterSeed`（例: playerId）から [0,1) の決定的な値 */
function hashStringTo01(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
  }
  return (h >>> 0) / 4294967296;
}

/** 近い座標は1点にまとめ、除外ゾーンの重複を減らす */
function dedupeAvoidPeers(pts: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  const eps = 0.07;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    if (out.some(q => Math.hypot(q.x - p.x, q.z - p.z) < eps)) continue;
    out.push(p);
  }
  return out;
}

/** 円周を何分割するか（playerId ハッシュで帯を割り当て、互いに離れた方位へ） */
const SPAWN_ANGLE_SLOTS = 16;
/** 中心付近へのスポーン集中を避ける内側半径 = maxR × この値 */
const SPAWN_INNER_RADIUS_FRACTION = 0.2;
/** 他プレイヤー足元との最低XZ距離（既定。狭いマップでは候補失敗が増えるので `opts` で下げ可能） */
const SPAWN_AVOID_PEER_DEFAULT = 0.5;

export type SpawnScatterOptions = {
  /** 他プレイヤー足元に近づけないときの XZ 参照点（スナップショット由来） */
  avoidNear?: Array<{ x: number; z: number }>;
  /** `avoidNear` との最小距離（既定は約 0.5） */
  avoidMinDist?: number;
  /**
   * この文字列から基準方位を決め、プレイヤー同士が同じ方向に固まりにくくする（例: `playerId`）。
   * 未指定時は従来どおり円盤一様に近い乱択。
   */
  scatterSeed?: string;
};

/**
 * 境界円内でランダムなスポーン XZ を選ぶ。地形・障害物・プレイエリア外を避ける。
 * `scatterSeed` で方向を分散、`avoidNear` で他プレイと重なりにくくする。
 * 失敗時は null（呼び出し側で原点フォールバック可）。
 */
export function pickRandomSpawnPosition(
  footOffset: number,
  opts?: SpawnScatterOptions,
): { x: number; z: number } | null {
  if (!worldWalkables.length) return null;
  const br = getWorldBoundaryRadius();
  const margin = PLAYER_COLLISION_RADIUS * 2.5 + BOUNDARY_MARGIN;
  if (!Number.isFinite(br) || br <= margin + 0.05) {
    return isValidStandingSpawnXZ(0, 0, footOffset) ? { x: 0, z: 0 } : null;
  }
  const maxR = Math.max(0.06, br - margin);
  const avoid = dedupeAvoidPeers((opts?.avoidNear ?? []).filter(
    p => Number.isFinite(p.x) && Number.isFinite(p.z),
  ));
  const avoidD = Math.max(0.24, opts?.avoidMinDist ?? SPAWN_AVOID_PEER_DEFAULT);
  const seed = opts?.scatterSeed?.trim() ?? '';
  /** 各プレイヤーに専用の方位スロット（隣スロットと 22.5° ずつずれる） */
  const angleSlot = seed
    ? Math.floor(hashStringTo01(seed) * SPAWN_ANGLE_SLOTS) % SPAWN_ANGLE_SLOTS
    : -1;
  const slotSpan = (Math.PI * 2) / SPAWN_ANGLE_SLOTS;
  const rInner = Math.min(maxR * SPAWN_INNER_RADIUS_FRACTION, maxR * 0.48);

  const farFromPeers = (x: number, z: number): boolean => {
    for (const p of avoid) {
      if (Math.hypot(x - p.x, z - p.z) < avoidD) return false;
    }
    return true;
  };

  const tryCandidate = (x: number, z: number): { x: number; z: number } | null => {
    if (!farFromPeers(x, z)) return null;
    return isValidStandingSpawnXZ(x, z, footOffset) ? { x, z } : null;
  };

  /** リング状領域（内半径 rInner〜maxR）を面積一様に乱択 */
  const sampleAnnulus = (): { x: number; z: number } => {
    const u = Math.random();
    const r = Math.sqrt(rInner * rInner + u * (maxR * maxR - rInner * rInner));
    let theta: number;
    if (angleSlot >= 0) {
      theta = (angleSlot + Math.random()) * slotSpan;
    } else {
      theta = Math.random() * Math.PI * 2;
    }
    return { x: Math.cos(theta) * r, z: Math.sin(theta) * r };
  };

  for (let attempt = 0; attempt < 120; attempt++) {
    const { x, z } = sampleAnnulus();
    const ok = tryCandidate(x, z);
    if (ok) return ok;
    /** スロット内で詰まったとき隣帯も試す */
    if (angleSlot >= 0 && attempt % 7 === 6) {
      const bump = (attempt / 7 | 0) % SPAWN_ANGLE_SLOTS;
      const theta = ((angleSlot + bump) % SPAWN_ANGLE_SLOTS + Math.random()) * slotSpan;
      const u = Math.random();
      const r = Math.sqrt(rInner * rInner + u * (maxR * maxR - rInner * rInner));
      const ok2 = tryCandidate(Math.cos(theta) * r, Math.sin(theta) * r);
      if (ok2) return ok2;
    }
  }

  const golden = Math.PI * (3 - Math.sqrt(5));
  const phase0 = angleSlot >= 0 ? angleSlot * slotSpan : 0;
  for (let i = 0; i < 72; i++) {
    const t = (i + 0.5) / 72;
    const r = Math.sqrt(rInner * rInner + t * (maxR * maxR - rInner * rInner));
    const ang = i * golden + phase0;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const ok = tryCandidate(x, z);
    if (ok) return ok;
  }
  if (isValidStandingSpawnXZ(0, 0, footOffset) && farFromPeers(0, 0)) return { x: 0, z: 0 };
  return null;
}
