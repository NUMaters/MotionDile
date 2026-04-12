/**
 * Walking_wani.glb から上顎/下顎分離済みの Wani_game.glb を生成する。
 *
 * ボーン構造の変更:
 *   head → jaw_upper  (上顎 — headend と同じ位置/回転)
 *   head → jaw_lower  (下顎 — headend と同じ位置/回転)
 *
 * 頂点の再割り当て (head → jaw_upper / jaw_lower):
 *   Y < MOUTH_Y  → jaw_lower
 *   MOUTH_Y ≤ Y < SKULL_Y → jaw_upper
 *   Y ≥ SKULL_Y → head（変更なし）
 *
 * 生成クリップ:
 *   Walk, Run, Idle,
 *   Walk_MouthOpen, Run_MouthOpen, Idle_MouthOpen,
 *   Attack, TailWag
 */
import { writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Accessor, NodeIO } from '@gltf-transform/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** `modeling/` ディレクトリ（本スクリプトは `modeling/scripts/` に配置） */
const modelingDir = join(__dirname, '..');
const srcPath = join(modelingDir, 'Walking_wani.glb');
const outPath = join(modelingDir, 'Wani_game.glb');

const MOUTH_Y = 0.00218;
const SKULL_Y = 0.00270;
const JAW_SPLIT_Z_MIN = 0.0042;
const JAW_SPLIT_Z_MAX = 0.0084;
const MOUTH_CUT_Z_MIN = 0.0042;

// ═══════════════════════════════════════════════════════
//  Quaternion helpers (glTF order x,y,z,w)
// ═══════════════════════════════════════════════════════

function quatFromAxisAngle(axis, rad) {
  const h = rad * 0.5, s = Math.sin(h);
  return new Float32Array([axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)]);
}

function quatMul(out, a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

function quatNorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
}

function quatInverse(out, q) {
  out[0] = -q[0]; out[1] = -q[1]; out[2] = -q[2]; out[3] = q[3];
  return out;
}

function slerpQuat(out, a, b, t) {
  let [x0, y0, z0, w0] = a;
  let [x1, y1, z1, w1] = b;
  let dot = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1;
  if (dot < 0) { x1 = -x1; y1 = -y1; z1 = -z1; w1 = -w1; dot = -dot; }
  if (dot > 0.9995) {
    out[0] = x0 + t * (x1 - x0); out[1] = y0 + t * (y1 - y0);
    out[2] = z0 + t * (z1 - z0); out[3] = w0 + t * (w1 - w0);
    quatNorm(out); return out;
  }
  const theta0 = Math.acos(Math.min(1, dot)), theta = theta0 * t;
  const sin0 = Math.sin(theta0);
  const s0 = Math.sin(theta0 - theta) / sin0, s1 = Math.sin(theta) / sin0;
  out[0] = s0 * x0 + s1 * x1; out[1] = s0 * y0 + s1 * y1;
  out[2] = s0 * z0 + s1 * z1; out[3] = s0 * w0 + s1 * w1;
  return out;
}

// ═══════════════════════════════════════════════════════
//  Sampler helpers
// ═══════════════════════════════════════════════════════

function sampleAtTime(sampler, path, t) {
  const input = sampler.getInput().getArray();
  const output = sampler.getOutput();
  const el = output.getElementSize();
  const count = input.length;
  const tmp = new Float32Array(el);
  if (count === 0 || t <= input[0]) { output.getElement(0, tmp); return Float32Array.from(tmp); }
  if (t >= input[count - 1]) { output.getElement(count - 1, tmp); return Float32Array.from(tmp); }
  let i = 0;
  for (let k = 0; k < count - 1; k++) { if (input[k] <= t && t <= input[k + 1]) { i = k; break; } }
  const t0 = input[i], t1 = input[i + 1], u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  const va = new Float32Array(el), vb = new Float32Array(el);
  output.getElement(i, va); output.getElement(i + 1, vb);
  if (path === 'rotation') { slerpQuat(tmp, va, vb, u); return Float32Array.from(tmp); }
  for (let c = 0; c < el; c++) tmp[c] = va[c] + u * (vb[c] - va[c]);
  return tmp;
}

// ═══════════════════════════════════════════════════════
//  Phase 1 — Jaw bone splitting
// ═══════════════════════════════════════════════════════

function performJawSplit(doc, buf) {
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();

  const headIdx = joints.findIndex(j => j.getName() === 'head');
  const headendIdx = joints.findIndex(j => j.getName() === 'headend');
  const headNode = joints[headIdx];
  const headendNode = joints[headendIdx];

  const heTrans = headendNode.getTranslation();
  const heRot = headendNode.getRotation();
  const heScale = headendNode.getScale();
  console.log(`  headend bind TRS: T=[${heTrans.map(v => v.toFixed(4))}] R=[${heRot.map(v => v.toFixed(4))}]`);

  const jawUpper = doc.createNode('jaw_upper')
    .setTranslation(Array.from(heTrans))
    .setRotation(Array.from(heRot))
    .setScale(Array.from(heScale));
  const jawLower = doc.createNode('jaw_lower')
    .setTranslation(Array.from(heTrans))
    .setRotation(Array.from(heRot))
    .setScale(Array.from(heScale));

  headNode.addChild(jawUpper);
  headNode.addChild(jawLower);

  skin.addJoint(jawUpper);
  skin.addJoint(jawLower);

  const allJoints = skin.listJoints();
  const jawUpperIdx = allJoints.indexOf(jawUpper);
  const jawLowerIdx = allJoints.indexOf(jawLower);
  console.log(`  New joint indices: jaw_upper=${jawUpperIdx}, jaw_lower=${jawLowerIdx}`);

  const ibmAcc = skin.getInverseBindMatrices();
  const ibmArr = ibmAcc.getArray();
  const headendIBM = ibmArr.slice(headendIdx * 16, (headendIdx + 1) * 16);
  const newIBM = new Float32Array(ibmArr.length + 32);
  newIBM.set(ibmArr);
  newIBM.set(headendIBM, ibmArr.length);
  newIBM.set(headendIBM, ibmArr.length + 16);
  skin.setInverseBindMatrices(
    doc.createAccessor().setArray(newIBM).setType(Accessor.Type.MAT4).setBuffer(buf)
  );

  const mesh = root.listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  const posAcc = prim.getAttribute('POSITION');
  const jointsAcc = prim.getAttribute('JOINTS_0');
  const weightsAcc = prim.getAttribute('WEIGHTS_0');
  const vertexCount = posAcc.getCount();

  const origJA = jointsAcc.getArray();
  const jArr = new origJA.constructor(origJA);
  let upperN = 0, lowerN = 0, headKept = 0;

  for (let v = 0; v < vertexCount; v++) {
    for (let s = 0; s < 4; s++) {
      const idx = v * 4 + s;
      if (jArr[idx] !== headIdx) continue;
      const wt = new Float32Array(4);
      weightsAcc.getElement(v, wt);
      if (wt[s] < 0.001) continue;

      const pos = new Float32Array(3);
      posAcc.getElement(v, pos);
      const y = pos[1];
      const z = pos[2];
      if (z < JAW_SPLIT_Z_MIN || z > JAW_SPLIT_Z_MAX) {
        headKept++;
        continue;
      }

      if (y < MOUTH_Y) {
        jArr[idx] = jawLowerIdx;
        lowerN++;
      } else if (y < SKULL_Y) {
        jArr[idx] = jawUpperIdx;
        upperN++;
      } else {
        headKept++;
      }
    }
  }

  console.log(`  Reassigned: ${lowerN} → jaw_lower, ${upperN} → jaw_upper, ${headKept} kept on head`);

  prim.setAttribute('JOINTS_0',
    doc.createAccessor().setArray(jArr).setType(jointsAcc.getType()).setBuffer(buf)
  );

  // Remove triangles that span jaw_upper ↔ jaw_lower (they stretch across the gap)
  const idxAcc = prim.getIndices();
  const idxArr = idxAcc.getArray();
  const triCount = idxArr.length / 3;
  const wArr = weightsAcc.getArray();
  const newIdx = [];
  let removedTris = 0;

  for (let t = 0; t < triCount; t++) {
    const i0 = idxArr[t * 3], i1 = idxArr[t * 3 + 1], i2 = idxArr[t * 3 + 2];
    let hasUpper = false, hasLower = false;
    for (const vi of [i0, i1, i2]) {
      for (let s = 0; s < 4; s++) {
        if (wArr[vi * 4 + s] < 0.01) continue;
        const ji = jArr[vi * 4 + s];
        if (ji === jawUpperIdx) hasUpper = true;
        if (ji === jawLowerIdx) hasLower = true;
      }
    }
    const p0 = new Float32Array(3);
    const p1 = new Float32Array(3);
    const p2 = new Float32Array(3);
    posAcc.getElement(i0, p0);
    posAcc.getElement(i1, p1);
    posAcc.getElement(i2, p2);
    const cz = (p0[2] + p1[2] + p2[2]) / 3;
    const cy = (p0[1] + p1[1] + p2[1]) / 3;
    const inMouthBand = cz >= MOUTH_CUT_Z_MIN && Math.abs(cy - MOUTH_Y) <= 0.00055;

    if (hasUpper && hasLower && inMouthBand) {
      removedTris++;
    } else {
      newIdx.push(i0, i1, i2);
    }
  }

  console.log(`  Removed ${removedTris} spanning triangles from mouth seam`);
  const IdxCtor = idxArr.constructor;
  prim.setIndices(
    doc.createAccessor().setArray(new IdxCtor(newIdx)).setType(Accessor.Type.SCALAR).setBuffer(buf)
  );

  return {
    headIdx,
    jawUpper, jawLower, jawUpperIdx, jawLowerIdx,
    headendBindRot: Float32Array.from(heRot),
  };
}

// ═══════════════════════════════════════════════════════
//  Phase 2 — Animation builders
// ═══════════════════════════════════════════════════════

function addJawChannels(doc, buf, anim, jawUpper, jawLower, jawCfg) {
  for (const [node, data] of [[jawUpper, jawCfg.upper], [jawLower, jawCfg.lower]]) {
    const inAcc = doc.createAccessor()
      .setArray(new Float32Array(data.times))
      .setType(Accessor.Type.SCALAR).setBuffer(buf);
    const outAcc = doc.createAccessor()
      .setArray(new Float32Array(data.values))
      .setType(Accessor.Type.VEC4).setBuffer(buf);
    const samp = doc.createAnimationSampler()
      .setInput(inAcc).setOutput(outAcc).setInterpolation('LINEAR');
    anim.addSampler(samp);
    anim.addChannel(
      doc.createAnimationChannel().setTargetNode(node).setTargetPath('rotation').setSampler(samp)
    );
  }
}

function makeJawClosed(bindRot, duration) {
  const r = [...bindRot];
  return {
    upper: { times: [0, duration], values: [...r, ...r] },
    lower: { times: [0, duration], values: [...r, ...r] },
  };
}

function makeJawOpen(bindRot, qLower, qUpper, duration) {
  const closedR = [...bindRot];
  const openLower = new Float32Array(4);
  quatMul(openLower, bindRot, qLower); quatNorm(openLower);
  const openUpper = new Float32Array(4);
  quatMul(openUpper, bindRot, qUpper); quatNorm(openUpper);
  return {
    upper: { times: [0, duration], values: [...openUpper, ...openUpper] },
    lower: { times: [0, duration], values: [...openLower, ...openLower] },
  };
}

function makeJawAttack(bindRot, qWide, qLift, duration) {
  const closed = [...bindRot];
  const openLower = new Float32Array(4);
  quatMul(openLower, bindRot, qWide); quatNorm(openLower);
  const openUpper = new Float32Array(4);
  quatMul(openUpper, bindRot, qLift); quatNorm(openUpper);
  const times = [0, 0.08, 0.20, 0.40, duration];
  return {
    upper: { times, values: [...closed, ...openUpper, ...openUpper, ...closed, ...closed] },
    lower: { times, values: [...closed, ...openLower, ...openLower, ...closed, ...closed] },
  };
}

/** Clone or time-scale an animation, optionally amplify rotations */
function buildScaledAnimation(doc, buf, srcAnim, name, timeScale, ampFactor, restPoseMap) {
  const anim = doc.createAnimation(name);
  for (const ch of srcAnim.listChannels()) {
    const path = ch.getTargetPath();
    const node = ch.getTargetNode();
    const s = ch.getSampler();
    const inArr = new Float32Array(s.getInput().getArray());
    for (let i = 0; i < inArr.length; i++) inArr[i] *= timeScale;
    const inAcc = doc.createAccessor().setArray(inArr).setType(Accessor.Type.SCALAR).setBuffer(buf);

    const outSrc = s.getOutput();
    const el = outSrc.getElementSize();
    const count = inArr.length;
    const outArr = new Float32Array(count * el);
    const tmp = new Float32Array(el);

    if (ampFactor !== 1.0 && path === 'rotation' && restPoseMap) {
      const restQ = restPoseMap.get(node.getName() + ':rotation');
      const invRest = new Float32Array(4);
      const diff = new Float32Array(4), ampDiff = new Float32Array(4), result = new Float32Array(4);
      const identity = new Float32Array([0, 0, 0, 1]);
      if (restQ) quatInverse(invRest, restQ);
      for (let i = 0; i < count; i++) {
        outSrc.getElement(i, tmp);
        if (restQ) {
          quatMul(diff, invRest, tmp);
          slerpQuat(ampDiff, identity, diff, ampFactor);
          quatMul(result, restQ, ampDiff); quatNorm(result);
          outArr.set(result, i * el);
        } else {
          outArr.set(tmp, i * el);
        }
      }
    } else {
      for (let i = 0; i < count; i++) { outSrc.getElement(i, tmp); outArr.set(tmp, i * el); }
    }

    const outAcc = doc.createAccessor().setArray(outArr).setType(outSrc.getType()).setBuffer(buf);
    const samp = doc.createAnimationSampler().setInput(inAcc).setOutput(outAcc).setInterpolation(s.getInterpolation());
    anim.addSampler(samp);
    anim.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(samp));
  }
  return anim;
}

/** Constant-pose animation from sample at t0 */
function buildConstantAnim(doc, buf, srcAnim, name, t0, duration) {
  const anim = doc.createAnimation(name);
  for (const ch of srcAnim.listChannels()) {
    const path = ch.getTargetPath();
    const node = ch.getTargetNode();
    const s = ch.getSampler();
    const value = sampleAtTime(s, path, t0);
    const el = value.length;
    const outArr = new Float32Array(el * 2);
    outArr.set(value, 0); outArr.set(value, el);
    const inAcc = doc.createAccessor().setArray(new Float32Array([0, duration])).setType(Accessor.Type.SCALAR).setBuffer(buf);
    const outAcc = doc.createAccessor().setArray(outArr).setType(s.getOutput().getType()).setBuffer(buf);
    const samp = doc.createAnimationSampler().setInput(inAcc).setOutput(outAcc).setInterpolation('LINEAR');
    anim.addSampler(samp);
    anim.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(samp));
  }
  return anim;
}

/** Attack: idle pose for all bones EXCEPT head gets a thrust */
function buildAttackBaseAnim(doc, buf, srcAnim, name, headName, duration) {
  const anim = doc.createAnimation(name);
  const attackTimes = new Float32Array([0, 0.08, 0.20, 0.40, duration]);
  const qThrust = quatFromAxisAngle([1, 0, 0], -0.25);

  for (const ch of srcAnim.listChannels()) {
    const path = ch.getTargetPath();
    const node = ch.getTargetNode();
    const s = ch.getSampler();
    const rest = sampleAtTime(s, path, 0);
    const el = rest.length;

    if (path === 'rotation' && node.getName() === headName) {
      const thrust = new Float32Array(4);
      quatMul(thrust, rest, qThrust); quatNorm(thrust);
      const values = new Float32Array(5 * el);
      values.set(rest, 0); values.set(thrust, el); values.set(thrust, 2 * el);
      values.set(rest, 3 * el); values.set(rest, 4 * el);
      const inAcc = doc.createAccessor().setArray(new Float32Array(attackTimes)).setType(Accessor.Type.SCALAR).setBuffer(buf);
      const outAcc = doc.createAccessor().setArray(values).setType(s.getOutput().getType()).setBuffer(buf);
      const samp = doc.createAnimationSampler().setInput(inAcc).setOutput(outAcc).setInterpolation('LINEAR');
      anim.addSampler(samp);
      anim.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(samp));
    } else {
      const values = new Float32Array(2 * el);
      values.set(rest, 0); values.set(rest, el);
      const inAcc = doc.createAccessor().setArray(new Float32Array([0, duration])).setType(Accessor.Type.SCALAR).setBuffer(buf);
      const outAcc = doc.createAccessor().setArray(values).setType(s.getOutput().getType()).setBuffer(buf);
      const samp = doc.createAnimationSampler().setInput(inAcc).setOutput(outAcc).setInterpolation('LINEAR');
      anim.addSampler(samp);
      anim.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(samp));
    }
  }
  return anim;
}

/** TailWag: idle pose with sinusoidal tail sway */
function buildTailWagAnim(doc, buf, srcAnim, name, tailBones, duration) {
  const anim = doc.createAnimation(name);
  const STEPS = 24;
  const times = new Float32Array(STEPS);
  for (let i = 0; i < STEPS; i++) times[i] = (i / (STEPS - 1)) * duration;

  for (const ch of srcAnim.listChannels()) {
    const path = ch.getTargetPath();
    const node = ch.getTargetNode();
    const s = ch.getSampler();
    const rest = sampleAtTime(s, path, 0);
    const el = rest.length;
    const tailIdx = tailBones.indexOf(node.getName());

    if (path === 'rotation' && tailIdx >= 0) {
      const amp = 0.25 + tailIdx * 0.12;
      const phase = tailIdx * 0.4;
      const values = new Float32Array(STEPS * el);
      const result = new Float32Array(4);
      for (let i = 0; i < STEPS; i++) {
        const angle = Math.sin((times[i] / duration) * Math.PI * 2 + phase) * amp;
        const q = quatFromAxisAngle([0, 0, 1], angle);
        quatMul(result, rest, q); quatNorm(result);
        values.set(result, i * el);
      }
      const inAcc = doc.createAccessor().setArray(new Float32Array(times)).setType(Accessor.Type.SCALAR).setBuffer(buf);
      const outAcc = doc.createAccessor().setArray(values).setType(s.getOutput().getType()).setBuffer(buf);
      const samp = doc.createAnimationSampler().setInput(inAcc).setOutput(outAcc).setInterpolation('LINEAR');
      anim.addSampler(samp);
      anim.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(samp));
    } else {
      const values = new Float32Array(2 * el);
      values.set(rest, 0); values.set(rest, el);
      const inAcc = doc.createAccessor().setArray(new Float32Array([0, duration])).setType(Accessor.Type.SCALAR).setBuffer(buf);
      const outAcc = doc.createAccessor().setArray(values).setType(s.getOutput().getType()).setBuffer(buf);
      const samp = doc.createAnimationSampler().setInput(inAcc).setOutput(outAcc).setInterpolation('LINEAR');
      anim.addSampler(samp);
      anim.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(samp));
    }
  }
  return anim;
}

// ═══════════════════════════════════════════════════════
//  Phase 3 — Mouth interior geometry
// ═══════════════════════════════════════════════════════

function createMouthInterior(doc, buf, skin, armatureNode, jawUpperIdx, jawLowerIdx) {
  const cavityMat = doc.createMaterial('mouth_cavity')
    .setBaseColorFactor([0.12, 0.02, 0.02, 1.0])
    .setRoughnessFactor(0.95)
    .setMetallicFactor(0.0)
    .setDoubleSided(true);

  const tongueMat = doc.createMaterial('tongue')
    .setBaseColorFactor([0.80, 0.28, 0.25, 1.0])
    .setRoughnessFactor(0.70)
    .setMetallicFactor(0.0)
    .setDoubleSided(true);

  const gumMat = doc.createMaterial('gum')
    .setBaseColorFactor([0.70, 0.30, 0.28, 1.0])
    .setRoughnessFactor(0.75)
    .setMetallicFactor(0.0)
    .setDoubleSided(true);

  // Cross-sections from back (hinge) to front (snout tip)
  // Half-widths at ~75% of actual mesh width to stay inside the jaw
  // Actual mesh half-widths: z=.002→.00223, .003→.00216, .004→.00231,
  //   .005→.00214, .006→.00157, .007→.00117, .008→.00107
  const sections = [
    // Start cavity around cheek seam (near red-line request) to shorten mouth root.
    { z: 0.0042, hw: 0.00168 },
    { z: 0.0049, hw: 0.00156 },
    { z: 0.0056, hw: 0.00134 },
    { z: 0.0063, hw: 0.00108 },
    { z: 0.0070, hw: 0.00090 },
    { z: 0.0076, hw: 0.00080 },
    { z: 0.0080, hw: 0.00076 },
  ];
  const palateY = 0.00215;
  const floorY = 0.00175;
  const N = sections.length;

  function mkAcc(arr, type) {
    return doc.createAccessor().setArray(arr).setType(type).setBuffer(buf);
  }
  function buildPrimitive(pos, norm, jts, wts, idx, mat) {
    const p = doc.createPrimitive()
      .setAttribute('POSITION', mkAcc(new Float32Array(pos), Accessor.Type.VEC3))
      .setAttribute('NORMAL', mkAcc(new Float32Array(norm), Accessor.Type.VEC3))
      .setAttribute('JOINTS_0', mkAcc(new Uint8Array(jts), Accessor.Type.VEC4))
      .setAttribute('WEIGHTS_0', mkAcc(new Float32Array(wts), Accessor.Type.VEC4))
      .setIndices(mkAcc(new Uint16Array(idx), Accessor.Type.SCALAR))
      .setMaterial(mat);
    return p;
  }
  function pushVert(pos, norm, jts, wts, x, y, z, nx, ny, nz, jointIdx) {
    pos.push(x, y, z);
    norm.push(nx, ny, nz);
    jts.push(jointIdx, 0, 0, 0);
    wts.push(1, 0, 0, 0);
  }

  // ── Cavity surfaces (NO upper/lower bridge polygons) ──
  // Any polygon that mixes jaw_upper + jaw_lower will stretch like a curtain when opening.
  // Build upper palate and lower mouth floor as separate strips.
  const cUpperP = [], cUpperN = [], cUpperJ = [], cUpperW = [], cUpperI = [];
  const cLowerP = [], cLowerN = [], cLowerJ = [], cLowerW = [], cLowerI = [];

  for (let i = 0; i < N; i++) {
    const { z, hw } = sections[i];
    const inner = hw * 0.78;
    // Upper palate strip (faces downward)
    pushVert(cUpperP, cUpperN, cUpperJ, cUpperW, -inner, palateY, z, 0, -1, 0, jawUpperIdx);
    pushVert(cUpperP, cUpperN, cUpperJ, cUpperW, inner, palateY, z, 0, -1, 0, jawUpperIdx);
    // Lower floor strip (faces upward)
    pushVert(cLowerP, cLowerN, cLowerJ, cLowerW, -inner, floorY, z, 0, 1, 0, jawLowerIdx);
    pushVert(cLowerP, cLowerN, cLowerJ, cLowerW, inner, floorY, z, 0, 1, 0, jawLowerIdx);
  }
  for (let i = 0; i < N - 1; i++) {
    const b = i * 2, n = (i + 1) * 2;
    cUpperI.push(b, b + 1, n, b + 1, n + 1, n);
    cLowerI.push(b, n, b + 1, b + 1, n, n + 1);
  }

  // ── Tongue (pink surface on lower jaw) ──
  const tP = [], tN = [], tJ = [], tW = [], tI = [];
  const tongueY = floorY + 0.00008;

  for (let i = 0; i < N; i++) {
    const { z, hw } = sections[i];
    const tw = hw * 0.65;
    pushVert(tP, tN, tJ, tW, -tw, tongueY, z, 0, 1, 0, jawLowerIdx);
    pushVert(tP, tN, tJ, tW, tw, tongueY, z, 0, 1, 0, jawLowerIdx);
  }
  for (let i = 0; i < N - 1; i++) {
    const b = i * 2, n = (i + 1) * 2;
    tI.push(b, n, b + 1, b + 1, n, n + 1);
  }

  // ── Gum strips (inside edge of jaw, pinkish) ──
  // Upper gum: a thin strip along the top edge of the cavity
  const gP = [], gN = [], gJ = [], gW = [], gI = [];
  const gumWidth = 0.00018;

  for (let i = 0; i < N; i++) {
    const { z, hw } = sections[i];
    // Upper gum left
    pushVert(gP, gN, gJ, gW, -hw, palateY, z, 0, -1, 0, jawUpperIdx);
    pushVert(gP, gN, gJ, gW, -hw + gumWidth, palateY - 0.00008, z, 0, -1, 0, jawUpperIdx);
    // Upper gum right
    pushVert(gP, gN, gJ, gW, hw, palateY, z, 0, -1, 0, jawUpperIdx);
    pushVert(gP, gN, gJ, gW, hw - gumWidth, palateY - 0.00008, z, 0, -1, 0, jawUpperIdx);
    // Lower gum left
    pushVert(gP, gN, gJ, gW, -hw, floorY, z, 0, 1, 0, jawLowerIdx);
    pushVert(gP, gN, gJ, gW, -hw + gumWidth, floorY + 0.00008, z, 0, 1, 0, jawLowerIdx);
    // Lower gum right
    pushVert(gP, gN, gJ, gW, hw, floorY, z, 0, 1, 0, jawLowerIdx);
    pushVert(gP, gN, gJ, gW, hw - gumWidth, floorY + 0.00008, z, 0, 1, 0, jawLowerIdx);
  }
  for (let i = 0; i < N - 1; i++) {
    const b = i * 8, n = (i + 1) * 8;
    // Upper left gum
    gI.push(b, n, b + 1, b + 1, n, n + 1);
    // Upper right gum
    gI.push(b + 2, b + 3, n + 2, b + 3, n + 3, n + 2);
    // Lower left gum
    gI.push(b + 4, b + 5, n + 4, b + 5, n + 5, n + 4);
    // Lower right gum
    gI.push(b + 6, n + 6, b + 7, b + 7, n + 6, n + 7);
  }

  // ── Side/back occlusion (split by jaw, no cross-joint polygons) ──
  const sP = [], sN = [], sJ = [], sW = [], sI = [];
  const sideDepth = 0.00018;
  for (let i = 0; i < N; i++) {
    const { z, hw } = sections[i];
    // Upper left side wall strip
    pushVert(sP, sN, sJ, sW, -hw, palateY, z, -1, 0, 0, jawUpperIdx);
    pushVert(sP, sN, sJ, sW, -hw, palateY - sideDepth, z, -1, 0, 0, jawUpperIdx);
    // Upper right side wall strip
    pushVert(sP, sN, sJ, sW, hw, palateY, z, 1, 0, 0, jawUpperIdx);
    pushVert(sP, sN, sJ, sW, hw, palateY - sideDepth, z, 1, 0, 0, jawUpperIdx);
    // Lower left side wall strip
    pushVert(sP, sN, sJ, sW, -hw, floorY + sideDepth, z, -1, 0, 0, jawLowerIdx);
    pushVert(sP, sN, sJ, sW, -hw, floorY, z, -1, 0, 0, jawLowerIdx);
    // Lower right side wall strip
    pushVert(sP, sN, sJ, sW, hw, floorY + sideDepth, z, 1, 0, 0, jawLowerIdx);
    pushVert(sP, sN, sJ, sW, hw, floorY, z, 1, 0, 0, jawLowerIdx);
  }
  for (let i = 0; i < N - 1; i++) {
    const b = i * 8, n = (i + 1) * 8;
    // Upper left
    sI.push(b, b + 1, n, b + 1, n + 1, n);
    // Upper right
    sI.push(b + 2, n + 2, b + 3, b + 3, n + 2, n + 3);
    // Lower left
    sI.push(b + 4, n + 4, b + 5, b + 5, n + 4, n + 5);
    // Lower right
    sI.push(b + 6, b + 7, n + 6, b + 7, n + 7, n + 6);
  }
  // Back wall: two overlapping full-height rectangles at the rear section.
  // Each independently covers the full mouth height so that when the jaws
  // separate, neither leaves a gap in the centre.
  const bz  = sections[0].z;              // flush with rear section
  const bHw = sections[0].hw * 0.92;     // stay inside the outer mesh
  const yTop    = palateY + 0.00025;     // small margin above palate
  const yBottom = floorY  - 0.00025;     // small margin below floor

  // Upper back wall (jaw_upper) — full height
  const bv = sP.length / 3;
  pushVert(sP, sN, sJ, sW, -bHw, yTop,    bz, 0, 0, 1, jawUpperIdx);
  pushVert(sP, sN, sJ, sW,  bHw, yTop,    bz, 0, 0, 1, jawUpperIdx);
  pushVert(sP, sN, sJ, sW, -bHw, yBottom, bz, 0, 0, 1, jawUpperIdx);
  pushVert(sP, sN, sJ, sW,  bHw, yBottom, bz, 0, 0, 1, jawUpperIdx);
  sI.push(bv, bv+2, bv+1, bv+1, bv+2, bv+3);

  // Lower back wall (jaw_lower) — full height (overlaps upper wall when closed)
  const bv2 = sP.length / 3;
  pushVert(sP, sN, sJ, sW, -bHw, yTop,    bz, 0, 0, 1, jawLowerIdx);
  pushVert(sP, sN, sJ, sW,  bHw, yTop,    bz, 0, 0, 1, jawLowerIdx);
  pushVert(sP, sN, sJ, sW, -bHw, yBottom, bz, 0, 0, 1, jawLowerIdx);
  pushVert(sP, sN, sJ, sW,  bHw, yBottom, bz, 0, 0, 1, jawLowerIdx);
  sI.push(bv2, bv2+2, bv2+1, bv2+1, bv2+2, bv2+3);

  const mesh = doc.createMesh('mouth_interior')
    .addPrimitive(buildPrimitive(cUpperP, cUpperN, cUpperJ, cUpperW, cUpperI, cavityMat))
    .addPrimitive(buildPrimitive(cLowerP, cLowerN, cLowerJ, cLowerW, cLowerI, cavityMat))
    .addPrimitive(buildPrimitive(tP, tN, tJ, tW, tI, tongueMat))
    .addPrimitive(buildPrimitive(gP, gN, gJ, gW, gI, gumMat))
    .addPrimitive(buildPrimitive(sP, sN, sJ, sW, sI, cavityMat));

  const mouthNode = doc.createNode('mouth_interior')
    .setMesh(mesh)
    .setSkin(skin);

  armatureNode.addChild(mouthNode);

  const cavityTris = (cUpperI.length + cLowerI.length + sI.length) / 3;
  const totalTris = cavityTris + tI.length / 3 + gI.length / 3;
  console.log(`  Mouth interior: ${totalTris} triangles (cavity=${cavityTris}, tongue=${tI.length / 3}, gums=${gI.length / 3})`);
}

// ═══════════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════════

async function main() {
  console.log('Reading', srcPath);
  const io = new NodeIO();
  const doc = await io.read(srcPath);
  const root = doc.getRoot();
  const buf = root.listBuffers()[0] ?? doc.createBuffer();

  // ── Phase 1: Jaw split ──
  console.log('Phase 1: Splitting jaw...');
  const { jawUpper, jawLower, headendBindRot } = performJawSplit(doc, buf);

  // ── Phase 1b: Mouth interior geometry ──
  console.log('Phase 1b: Creating mouth interior...');
  const skin = root.listSkins()[0];
  const allJoints = skin.listJoints();
  const jawUpperJointIdx = allJoints.indexOf(jawUpper);
  const jawLowerJointIdx = allJoints.indexOf(jawLower);
  const armatureNode = root.listScenes()[0].listChildren().find(n => n.getName() === 'Armature');
  createMouthInterior(doc, buf, skin, armatureNode, jawUpperJointIdx, jawLowerJointIdx);

  // ── Phase 2: Build animations ──
  console.log('Phase 2: Building animations...');
  const anims = root.listAnimations();
  if (!anims.length) throw new Error('Walking_wani.glb にアニメーションがありません');
  const walkSrc = anims[0];

  const headName = 'head';
  const tailBones = ['tail', 'tailstart', 'tail1', 'tail2', 'tail3'];

  const qMouthLower = quatFromAxisAngle([1, 0, 0], 0.18);
  const qMouthUpper = quatFromAxisAngle([1, 0, 0], -0.03);
  const qAttackLower = quatFromAxisAngle([1, 0, 0], 0.34);
  const qAttackUpper = quatFromAxisAngle([1, 0, 0], -0.06);

  const restPoseMap = new Map();
  for (const ch of walkSrc.listChannels()) {
    if (ch.getTargetPath() === 'rotation') {
      restPoseMap.set(ch.getTargetNode().getName() + ':rotation',
        sampleAtTime(ch.getSampler(), 'rotation', 0));
    }
  }

  // Build ALL base animations first (before adding any jaw channels,
  // so clones don't accidentally duplicate jaw channels)
  console.log('  Walk...');
  const walkAnim = buildScaledAnimation(doc, buf, walkSrc, 'Walk', 1.0, 1.0, null);
  walkSrc.dispose();

  console.log('  Run...');
  const runAnim = buildScaledAnimation(doc, buf, walkAnim, 'Run', 0.55, 1.35, restPoseMap);

  console.log('  Idle...');
  const idleAnim = buildConstantAnim(doc, buf, walkAnim, 'Idle', 0, 2.0);

  console.log('  Walk_MouthOpen...');
  const walkMouthAnim = buildScaledAnimation(doc, buf, walkAnim, 'Walk_MouthOpen', 1.0, 1.0, null);

  console.log('  Run_MouthOpen...');
  const runMouthAnim = buildScaledAnimation(doc, buf, walkAnim, 'Run_MouthOpen', 0.55, 1.35, restPoseMap);

  console.log('  Idle_MouthOpen...');
  const idleMouthAnim = buildConstantAnim(doc, buf, walkAnim, 'Idle_MouthOpen', 0, 2.0);

  console.log('  Attack...');
  const attackAnim = buildAttackBaseAnim(doc, buf, walkAnim, 'Attack', headName, 0.6);

  console.log('  TailWag...');
  const tailWagAnim = buildTailWagAnim(doc, buf, walkAnim, 'TailWag', tailBones, 1.2);

  // Now add jaw channels to each (no duplicates)
  console.log('  Adding jaw channels...');
  addJawChannels(doc, buf, walkAnim, jawUpper, jawLower, makeJawClosed(headendBindRot, 1.0));
  addJawChannels(doc, buf, runAnim, jawUpper, jawLower, makeJawClosed(headendBindRot, 0.55));
  addJawChannels(doc, buf, idleAnim, jawUpper, jawLower, makeJawClosed(headendBindRot, 2.0));
  addJawChannels(doc, buf, walkMouthAnim, jawUpper, jawLower,
    makeJawOpen(headendBindRot, qMouthLower, qMouthUpper, 1.0));
  addJawChannels(doc, buf, runMouthAnim, jawUpper, jawLower,
    makeJawOpen(headendBindRot, qMouthLower, qMouthUpper, 0.55));
  addJawChannels(doc, buf, idleMouthAnim, jawUpper, jawLower,
    makeJawOpen(headendBindRot, qMouthLower, qMouthUpper, 2.0));
  addJawChannels(doc, buf, attackAnim, jawUpper, jawLower,
    makeJawAttack(headendBindRot, qAttackLower, qAttackUpper, 0.6));
  addJawChannels(doc, buf, tailWagAnim, jawUpper, jawLower, makeJawClosed(headendBindRot, 1.2));

  // ── Write ──
  console.log('Writing', outPath);
  await io.write(outPath, doc);

  const clipNames = root.listAnimations().map(a => a.getName());
  await writeFile(
    join(modelingDir, 'Wani_game.meta.json'),
    JSON.stringify({
      source: 'Walking_wani.glb',
      clips: clipNames,
      bones: {
        head: headName, jaw_upper: 'jaw_upper', jaw_lower: 'jaw_lower',
        tail: tailBones,
      },
      jawSplit: {
        mouthLineY: MOUTH_Y,
        skullLineY: SKULL_Y,
        snoutRegionZMin: JAW_SPLIT_Z_MIN,
        snoutRegionZMax: JAW_SPLIT_Z_MAX,
      },
    }, null, 2),
    'utf8'
  );
  console.log('Done! Clips:', clipNames.join(', '));
}

main().catch(e => { console.error(e); process.exit(1); });
