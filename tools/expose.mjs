// モーションを当てた姿を描き出す道具。render.mjs は素の姿勢しか描けないので、
// 骨を動かした結果が見たいときはこちら。見ないまま数字をいじるのが事故の元。
//
//   node expose.mjs <本体glb> <out.png> [モーションglb|none|flame]
//
// 'none' は素の姿勢、'flame' は 怒りの業火 魔神火炎砲 の姿勢。flame のときは
// クリップではなく src/flame.js の表を読んで骨を回す。アプリと同じ表・同じ手順を
// 通すので、ここで見た姿がそのまま画面に出る。
//
// 視点はアプリと同じ「カメラから見た図」。カメラは原点から -Z を見ていて、
// 模型は -Z 側に置いてある。つまりカメラは模型の +Z 側にいる。
import fs from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as THREE from 'three';
import { FLAME_DIR, FLAME_TRUNK, FLAME_PALM, FLAME_FINGER, FLAME_HAND_AIM,
         flamePose, trunkAngle } from '../src/flame.js';

const bodyFile = process.argv[2] || 'models/exodia.glb';
const outFile  = process.argv[3] || 'pose.png';
const animFile = process.argv[4] || bodyFile;

function readGlb(file){
  const b = fs.readFileSync(file);
  let off = 12, j = null, bin = null;
  while (off < b.length){
    const l = b.readUInt32LE(off), t = b.readUInt32LE(off + 4);
    if (t === 0x4E4F534A) j = JSON.parse(b.slice(off + 8, off + 8 + l).toString('utf8'));
    else if (t === 0x004E4942) bin = b.slice(off + 8, off + 8 + l);
    off += 8 + l;
  }
  const acc = (idx) => {
    const a = j.accessors[idx], bv = j.bufferViews[a.bufferView];
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const nc = { SCALAR:1, VEC2:2, VEC3:3, VEC4:4, MAT4:16 }[a.type];
    const sz = { 5120:1, 5121:1, 5122:2, 5123:2, 5125:4, 5126:4 }[a.componentType];
    const stride = bv.byteStride || nc * sz;
    const out = [];
    for (let i = 0; i < a.count; i++){
      const o = base + i * stride, v = [];
      for (let k = 0; k < nc; k++){
        const p = o + k * sz;
        v.push(a.componentType === 5126 ? bin.readFloatLE(p)
             : a.componentType === 5123 ? bin.readUInt16LE(p)
             : a.componentType === 5125 ? bin.readUInt32LE(p) : bin.readUInt8(p));
      }
      out.push(nc === 1 ? v[0] : v);
    }
    return out;
  };
  return { j, bin, acc };
}

// --- 行列。列優先（glTF と同じ並び）。 ---
const mul = (a, b) => {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++){
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
};
const fromTRS = (t, q, s) => {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
};
const xform = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8]  * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9]  * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

function slerp(a, b, t){
  let d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
  let bb = b;
  if (d < 0){ bb = b.map(v => -v); d = -d; }
  if (d > 0.9995) return a.map((v, i) => v + (bb[i] - v) * t);
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((v, i) => v * wa + bb[i] * wb);
}

const POSE = animFile === 'flame';
const body = readGlb(bodyFile);
const anim = (animFile === 'none' || POSE) ? body : readGlb(animFile);

// --- 骨の動きを組む。名前で結ぶので、別ファイルの軌道でもそのまま乗る。 ---
// 'none' を渡すと素の姿勢（バインドポーズ）を描く。基準を知るため。
const clip = (animFile === 'none' || POSE) ? null : (anim.j.animations && anim.j.animations[0]);
const tracks = new Map();   // 骨の名前 -> { path -> {times, vals, n} }
let dur = 0;
if (clip){
  for (const ch of clip.channels){
    const s = clip.samplers[ch.sampler];
    const name = anim.j.nodes[ch.target.node].name;
    const times = anim.acc(s.input);
    const vals  = anim.acc(s.output);
    dur = Math.max(dur, times[times.length - 1]);
    if (!tracks.has(name)) tracks.set(name, {});
    tracks.get(name)[ch.target.path] = { times, vals, cubic: s.interpolation === 'CUBICSPLINE' };
  }
}

function sample(tr, t, dflt){
  if (!tr) return dflt;
  const { times, vals, cubic } = tr;
  let i = 0;
  while (i < times.length - 1 && times[i + 1] < t) i++;
  const j2 = Math.min(i + 1, times.length - 1);
  const span = times[j2] - times[i];
  const u = span > 1e-9 ? (t - times[i]) / span : 0;
  const get = (k) => cubic ? vals[k * 3 + 1] : vals[k];   // CUBICSPLINE は中央の値だけ使う
  const a = get(i), b = get(j2);
  if (a.length === 4) return slerp(a, b, u);
  return a.map((v, k) => v + (b[k] - v) * u);
}

// --- 技の姿勢。アプリ（src/exodia.js）と同じ表を、同じ順番で当てる ---
// 骨を three の物として組み直してから回す。行列を手で書くと、アプリと同じ結果に
// なっているかを確かめられない。ここは「同じことをしている」ことが値打ちなので、
// 遅くても同じ道具を使う。
const ARM_CHAIN = [['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'],
                   ['LeftArm',  'LeftForeArm'],  ['LeftForeArm',  'LeftHand']];

function buildTree(){
  const N = body.j.nodes;
  const objs = N.map((n) => {
    const o = new THREE.Object3D();
    o.name = n.name || '';
    if (n.matrix){
      o.matrix.fromArray(n.matrix);
      o.matrix.decompose(o.position, o.quaternion, o.scale);
    }
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  N.forEach((n, i) => (n.children || []).forEach(c => objs[i].add(objs[c])));
  // アプリの body に当たる入れ物。向きの基準はここ（＝無回転）。
  const world = new THREE.Object3D();
  objs.forEach(o => { if (!o.parent) world.add(o); });
  world.updateMatrixWorld(true);
  const bones = {}, rest = {};
  objs.forEach((o) => { bones[o.name] = o; rest[o.name] = o.quaternion.clone(); });
  return { objs, world, bones, rest };
}

const _ax = new THREE.Vector3(), _bq = new THREE.Quaternion(), _ppq = new THREE.Quaternion();
const _pA = new THREE.Vector3(), _pB = new THREE.Vector3(), _bd = new THREE.Vector3();
const _aq = new THREE.Quaternion(), _apq = new THREE.Quaternion();
const _keep = new THREE.Quaternion(), _goal = new THREE.Quaternion();
const _aim = new THREE.Vector3(), _hold = new THREE.Vector3(), _fire = new THREE.Vector3();

function poseGlobals(t){
  const { objs, world, bones, rest } = buildTree();
  const w = flamePose(t);
  // 腕の素の向きを測る。ここを数字で書かないから、模型を差し替えても崩れない。
  const armRest = {};
  for (const [n, ch] of ARM_CHAIN){
    bones[n].getWorldPosition(_pA); bones[ch].getWorldPosition(_pB);
    armRest[n] = new THREE.Vector3().subVectors(_pB, _pA).normalize();
  }
  // 体幹。息づかいは入れない。技のぶんだけを見たいので。
  for (const name in FLAME_TRUNK){
    const b = bones[name];
    if (!b) continue;
    b.quaternion.copy(rest[name]);
    b.parent.getWorldQuaternion(_ppq).invert();
    for (const c of FLAME_TRUNK[name]){
      const ang = trunkAngle(c, w);
      if (!ang) continue;
      _ax.set(c[0], c[1], c[2]).applyQuaternion(_ppq);
      b.quaternion.premultiply(_bq.setFromAxisAngle(_ax.normalize(), ang));
    }
  }
  world.updateMatrixWorld(true);
  // 腕。骨を一本回すたびに行列を作り直す。
  for (const [n, ch] of ARM_CHAIN){
    const d = FLAME_DIR[n], b = bones[n], c = bones[ch];
    if (!d || w.aim <= 0.001) continue;
    _aim.copy(armRest[n]).lerp(_hold.fromArray(d.hold), w.hold).lerp(_fire.fromArray(d.fire), w.fire);
    world.updateMatrixWorld(true);
    b.getWorldPosition(_pA); c.getWorldPosition(_pB);
    _bd.subVectors(_pB, _pA).normalize();
    _aq.setFromUnitVectors(_bd, _aim.normalize());
    b.parent.getWorldQuaternion(_apq);
    _keep.copy(b.quaternion);
    b.quaternion.premultiply(_goal.copy(_apq).invert().multiply(_aq).multiply(_apq));
    _goal.copy(b.quaternion);
    b.quaternion.copy(_keep).slerp(_goal, w.aim);
  }
  // 手の向き。アプリと同じで、掌と指の両方から姿勢を決めきる。
  const k = w.hold + w.fire;
  if (k >= 0.01){
    world.updateMatrixWorld(true);
    const u = new THREE.Vector3(), v = new THREE.Vector3(), w3 = new THREE.Vector3();
    const mL = new THREE.Matrix4(), mW = new THREE.Matrix4();
    const basis = (m, p, f) => {
      u.copy(p).normalize();
      v.copy(f).addScaledVector(u, -f.dot(u));
      if (v.lengthSq() < 1e-6) return false;
      v.normalize(); w3.crossVectors(u, v); m.makeBasis(u, v, w3);
      return true;
    };
    const _p0 = new THREE.Vector3(), _f0 = new THREE.Vector3();
    for (const n of ['RightHand', 'LeftHand']){
      const a2 = FLAME_HAND_AIM[n], hb = bones[n];
      _aim.fromArray(a2.hold.palm).multiplyScalar(w.hold / k)
          .addScaledVector(_fire.fromArray(a2.fire.palm), w.fire / k).normalize();
      _hold.fromArray(a2.hold.finger).multiplyScalar(w.hold / k)
           .addScaledVector(_fire.fromArray(a2.fire.finger), w.fire / k).normalize();
      if (!basis(mL, _p0.fromArray(FLAME_PALM[n]), _f0.fromArray(FLAME_FINGER[n]))) continue;
      const qL = new THREE.Quaternion().setFromRotationMatrix(mL).invert();
      if (!basis(mW, _aim, _hold)) continue;
      const qW = new THREE.Quaternion().setFromRotationMatrix(mW).multiply(qL);
      hb.parent.getWorldQuaternion(_apq).invert();
      _keep.copy(hb.quaternion);
      _goal.copy(_apq).multiply(qW);
      hb.quaternion.copy(_keep).slerp(_goal, w.aim * Math.min(1, k));
    }
  }

  world.updateMatrixWorld(true);
  // 掌がどこへ行ったかを数で出す。胸（Spine）から見た左右・上下・前後で、
  // 「胸の前」に来ているかは絵より数のほうが早い。単位はメートル。
  const c = new THREE.Vector3(), h = new THREE.Vector3();
  bones.Spine.getWorldPosition(c);
  const say = (n) => { bones[n].getWorldPosition(h); h.sub(c);
    return n + '(' + h.x.toFixed(2) + ',' + h.y.toFixed(2) + ',' + h.z.toFixed(2) + ')'; };
  // 掌と指がどちらを向いているかも出す。上を向いた掌や横向きの指に、ここで気づける。
  const dir = (tbl, tag) => (n) => { const q = new THREE.Vector3().fromArray(tbl[n])
      .applyQuaternion(bones[n].getWorldQuaternion(new THREE.Quaternion()));
    return tag + n[0] + '(' + q.x.toFixed(2) + ',' + q.y.toFixed(2) + ',' + q.z.toFixed(2) + ')'; };
  const palm = dir(FLAME_PALM, '掌'), finger = dir(FLAME_FINGER, '指');
  // 光の出どころ（掌の真ん中）。アプリはここから玉と光線を出すので、骨の位置より
  // こちらが効く。0.35 は前腕の長さに対する手首から掌の中ほどまで（アプリと同じ）。
  const pp = (n, fo) => { const o = new THREE.Vector3(), e2 = new THREE.Vector3();
    bones[n].getWorldPosition(o); bones[fo].getWorldPosition(e2);
    const fv = new THREE.Vector3().fromArray(FLAME_FINGER[n])
      .applyQuaternion(bones[n].getWorldQuaternion(new THREE.Quaternion())).normalize();
    return o.addScaledVector(fv, o.distanceTo(e2) * 0.35); };
  const pR = pp('RightHand', 'RightForeArm'), pL = pp('LeftHand', 'LeftForeArm');
  const ball = pR.clone().lerp(pL, 0.5).sub(c);
  console.log('   玉の中心（胸から）(' + ball.x.toFixed(2) + ',' + ball.y.toFixed(2) + ',' +
              ball.z.toFixed(2) + ')  掌のあいだ ' + pR.distanceTo(pL).toFixed(2));
  console.log('t=' + t.toFixed(2) + '  溜め' + w.hold.toFixed(2) + ' 発射' + w.fire.toFixed(2) +
              ' 球' + w.orbR.toFixed(2) + '  ' + say('RightHand') + ' ' + say('LeftHand') +
              '  ' + palm('RightHand') + finger('RightHand') +
              ' ' + palm('LeftHand') + finger('LeftHand'));
  return objs.map(o => o.matrixWorld.elements.slice());
}

// --- 節点の世界行列 ---
function globals(t){
  if (POSE) return poseGlobals(t);
  const N = body.j.nodes;
  const parent = new Array(N.length).fill(-1);
  N.forEach((n, i) => (n.children || []).forEach(c => { parent[c] = i; }));
  const G = new Array(N.length);
  const local = (i) => {
    const n = N[i];
    if (n.matrix && !tracks.has(n.name)) return n.matrix;
    const tr = tracks.get(n.name);
    return fromTRS(
      sample(tr && tr.translation, t, n.translation || [0, 0, 0]),
      sample(tr && tr.rotation,    t, n.rotation    || [0, 0, 0, 1]),
      sample(tr && tr.scale,       t, n.scale       || [1, 1, 1]));
  };
  const walk = (i) => {
    if (G[i]) return G[i];
    const p = parent[i];
    return (G[i] = p < 0 ? local(i) : mul(walk(p), local(i)));
  };
  for (let i = 0; i < N.length; i++) walk(i);
  return G;
}

// --- スキニング ---
const prim = body.j.meshes[0].primitives[0];
const POS = body.acc(prim.attributes.POSITION);
const IDX = body.acc(prim.indices);
const UV  = prim.attributes.TEXCOORD_0 !== undefined ? body.acc(prim.attributes.TEXCOORD_0) : null;
const JO  = body.acc(prim.attributes.JOINTS_0);
const WE  = body.acc(prim.attributes.WEIGHTS_0);
const skin = body.j.skins[0];
const IBM = body.acc(skin.inverseBindMatrices);

function posed(t){
  const G = globals(t);
  const sk = skin.joints.map((n, i) => mul(G[n], IBM[i]));
  return POS.map((p, vi) => {
    const jj = JO[vi], ww = WE[vi];
    const o = [0, 0, 0];
    for (let k = 0; k < 4; k++){
      if (!ww[k]) continue;
      const q = xform(sk[jj[k]], p);
      o[0] += q[0] * ww[k]; o[1] += q[1] * ww[k]; o[2] += q[2] * ww[k];
    }
    return o;
  });
}

// --- 絵 ---
let TEX = null;
if (UV && prim.material !== undefined){
  const m = body.j.materials[prim.material];
  const ti = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture;
  if (ti){
    const im = body.j.images[body.j.textures[ti.index].source];
    const v = body.j.bufferViews[im.bufferView];
    const img = await loadImage(body.bin.slice(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength));
    const c2 = createCanvas(img.width, img.height);
    c2.getContext('2d').drawImage(img, 0, 0);
    TEX = { w: img.width, h: img.height,
            d: c2.getContext('2d').getImageData(0, 0, img.width, img.height).data };
  }
}

const S = 520, PAD = 16;
// カメラから見た図（模型の +Z 側から）と、真横。向きと立ち姿の両方を一度に見る。
const VIEWS = [
  { name: 'カメラから見た図', ax: 0, ay: 1, az: 2, sx: 1, sy: -1 },
  { name: '真横（右から）',   ax: 2, ay: 1, az: 0, sx: 1, sy: -1 },
];
// 掌がどちらを向いているかは、正面と真横だけでは読めない。技のときは上からも見る。
if (POSE) VIEWS.push({ name: '真上から', ax: 0, ay: 2, az: 1, sx: 1, sy: 1 });
// 技は「構え・球が育った・突き出し・撃っている」の4枚。ここが読めれば姿勢は足りる。
const TIMES = POSE ? [0.90, 2.30, 2.72, 3.20] : clip ? [0, dur / 3, dur * 2 / 3] : [0];

const canvas = createCanvas(S * TIMES.length, S * VIEWS.length);
const g = canvas.getContext('2d');

// 全時刻・全視点で同じ枠を使う。枠が動くと、動いたのが体なのか枠なのか分からない。
const frames = TIMES.map(t => posed(t));
let lo = [9e9, 9e9, 9e9], hi = [-9e9, -9e9, -9e9];
for (const F of frames) for (const p of F) for (let k = 0; k < 3; k++){
  lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]);
}
const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
const mid = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2);

VIEWS.forEach((v, vi) => frames.forEach((P, ti) => {
  const ox = ti * S, oy = vi * S;
  const zb = new Float32Array(S * S).fill(-1e9);
  const px = (p) => [
    S / 2 + v.sx * (p[v.ax] - mid[v.ax]) / span * (S - PAD * 2),
    S / 2 + v.sy * (p[v.ay] - mid[v.ay]) / span * (S - PAD * 2),
  ];
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let i = 0; i < S * S; i++){ d[i*4] = 20; d[i*4+1] = 18; d[i*4+2] = 28; d[i*4+3] = 255; }
  // 足元の高さに線を引く。浮きや埋まりが一目で分かる。
  const gy = Math.round(px([mid[0], lo[1], mid[2]])[1]);
  if (gy >= 0 && gy < S) for (let x = 0; x < S; x++){
    const q = (x + gy * S) * 4; d[q] = 90; d[q+1] = 80; d[q+2] = 60;
  }

  for (let t = 0; t < IDX.length; t += 3){
    const a = P[IDX[t]], b2 = P[IDX[t+1]], c = P[IDX[t+2]];
    const ta = UV && UV[IDX[t]], tb = UV && UV[IDX[t+1]], tc = UV && UV[IDX[t+2]];
    const ux = b2[0]-a[0], uy = b2[1]-a[1], uz = b2[2]-a[2];
    const wx = c[0]-a[0],  wy = c[1]-a[1],  wz = c[2]-a[2];
    let nx = uy*wz - uz*wy, ny = uz*wx - ux*wz, nz = ux*wy - uy*wx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx/=nl; ny/=nl; nz/=nl;
    const lit = Math.max(0.20, Math.abs(nx*0.4 + ny*0.72 + nz*0.56));
    const A = px(a), B = px(b2), C = px(c);
    const za = a[v.az]*v.sx, zbv = b2[v.az]*v.sx, zc = c[v.az]*v.sx;
    const minX = Math.max(0, Math.floor(Math.min(A[0],B[0],C[0])));
    const maxX = Math.min(S-1, Math.ceil(Math.max(A[0],B[0],C[0])));
    const minY = Math.max(0, Math.floor(Math.min(A[1],B[1],C[1])));
    const maxY = Math.min(S-1, Math.ceil(Math.max(A[1],B[1],C[1])));
    const den = (B[1]-C[1])*(A[0]-C[0]) + (C[0]-B[0])*(A[1]-C[1]);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++){
      const l1 = ((B[1]-C[1])*(x-C[0]) + (C[0]-B[0])*(y-C[1]))/den;
      const l2 = ((C[1]-A[1])*(x-C[0]) + (A[0]-C[0])*(y-C[1]))/den;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const z = l1*za + l2*zbv + l3*zc;
      const k = x + y*S;
      if (z <= zb[k]) continue;
      zb[k] = z;
      const q = k*4;
      if (TEX && ta){
        const uu = l1*ta[0] + l2*tb[0] + l3*tc[0];
        const vv = l1*ta[1] + l2*tb[1] + l3*tc[1];
        let tx = Math.round(uu*TEX.w) % TEX.w; if (tx < 0) tx += TEX.w;
        let ty = Math.round(vv*TEX.h) % TEX.h; if (ty < 0) ty += TEX.h;
        const s0 = (tx + ty*TEX.w)*4, sh = 0.45 + lit*0.8;
        d[q]   = Math.min(255, TEX.d[s0]   * sh);
        d[q+1] = Math.min(255, TEX.d[s0+1] * sh);
        d[q+2] = Math.min(255, TEX.d[s0+2] * sh);
      } else {
        d[q] = Math.min(255, 210*lit+30); d[q+1] = Math.min(255, 200*lit+26); d[q+2] = Math.min(255, 245*lit+34);
      }
    }
  }
  g.putImageData(img, ox, oy);
  g.fillStyle = '#fff'; g.font = 'bold 17px sans-serif';
  g.fillText(v.name + '  t=' + TIMES[ti].toFixed(2) + 's', ox + 12, oy + 26);
  g.strokeStyle = '#ffffff30'; g.strokeRect(ox + 0.5, oy + 0.5, S - 1, S - 1);
}));

fs.writeFileSync(outFile, canvas.toBuffer('image/png'));
console.log(outFile + ' を書いた  clip=' + (clip ? clip.name : 'なし') +
            
            '  長さ=' + dur.toFixed(2) + 's  高さ=' + (hi[1] - lo[1]).toFixed(3));
