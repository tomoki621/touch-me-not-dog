// エルフの剣士の姿勢を描き出す道具。
//
//   node tools/elfpose.mjs <out.png> [g=守備] [w=ため] [c=斬り抜き] [m=頭上]
//   node tools/elfpose.mjs guard.png 1 0 0     ひざをついた守備
//   node tools/elfpose.mjs swing.png u0.56     斬りの、始めから 0.56 のところ
//
// 重みを直に渡すと、実際には起こらない組み合わせも描けてしまう。振りの途中を
// 見るときは u で渡すこと。src/elfpose.js の poseWeights をアプリと同じに呼ぶ
// ので、画面に出る一瞬をそのまま切り出せる。
//
// src/elfpose.js の applyPose をアプリと同じに呼ぶ。表も手順も共通なので、
// ここで見た姿がそのまま画面に出る。剣も同じ計算で置くので、握りの位置と
// 刀身の向きまで確かめられる。
//
// 出す図は「正面・真横・真上」。床は y=0 の線で引いてある。ひざが浮いているか
// 埋まっているかは、この線との差でしか分からない。
import fs from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as THREE from 'three';
import { applyPose, kneelDrop, poseWeights } from '../src/elfpose.js';

const out = process.argv[2] || 'pose.png';
// 'u0.56' の形なら、その時点の重みを poseWeights から取る。数字を並べたときは
// そのまま使う（守備のように、時間と関係なく決まるもの用）。
const uArg = /^u([0-9.]+)$/.exec(process.argv[3] || '');
const p = uArg
  ? poseWeights({ swing: 1 - parseFloat(uArg[1]), guard: +(process.argv[4] ?? 0) })
  : { g: +(process.argv[3] ?? 1), w: +(process.argv[4] ?? 0),
      c: +(process.argv[5] ?? 0), m: +(process.argv[6] ?? 0) };
// 'table' を渡すと、絵は描かずに「守備の重みごとの、沈める前の最下点」だけを並べる。
// src/elfpose.js の KNEEL_LOW に貼る表はこれで作る。
const TABLE = process.argv[2] === 'table';

// アプリと同じ寸法。ここがずれると見た目の判断が当てにならない。
const BODY_H     = 1.9;     // 背丈をこれに揃える
const SWORD_LEN  = 1.05;    // 刀身を含めた剣の全長。背丈 1.9 に対しての長さ。
const SWORD_GRIP = 0.20;    // 柄のどこを握るか（下からの割合）
const GRIP_Y     = 0.62;    // 手の骨から拳まで、前腕の長さに対する割合

// ---------------------------------------------------------------- GLB を読む
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
    const res = [];
    for (let i = 0; i < a.count; i++){
      const o = base + i * stride, v = [];
      for (let k = 0; k < nc; k++){
        const q = o + k * sz;
        v.push(a.componentType === 5126 ? bin.readFloatLE(q)
             : a.componentType === 5123 ? bin.readUInt16LE(q)
             : a.componentType === 5125 ? bin.readUInt32LE(q) : bin.readUInt8(q));
      }
      res.push(nc === 1 ? v[0] : v);
    }
    return res;
  };
  return { j, bin, acc };
}

async function texOf(g){
  const prim = g.j.meshes[0].primitives[0];
  const m = g.j.materials[prim.material];
  const ti = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture;
  if (!ti) return null;
  const im = g.j.images[g.j.textures[ti.index].source];
  const v = g.j.bufferViews[im.bufferView];
  const img = await loadImage(g.bin.slice(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength));
  const c = createCanvas(img.width, img.height);
  c.getContext('2d').drawImage(img, 0, 0);
  return { w: img.width, h: img.height,
           d: c.getContext('2d').getImageData(0, 0, img.width, img.height).data };
}

// ---------------------------------------------------------------- 骨を組む
// アプリは GLTFLoader が作った Object3D を触る。ここでも同じ形に組み直す。
function buildTree(g){
  const N = g.j.nodes;
  const objs = N.map((n) => {
    const o = new THREE.Object3D();
    o.name = n.name || '';
    if (n.matrix){ o.matrix.fromArray(n.matrix); o.matrix.decompose(o.position, o.quaternion, o.scale); }
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation)    o.quaternion.fromArray(n.rotation);
    if (n.scale)       o.scale.fromArray(n.scale);
    return o;
  });
  N.forEach((n, i) => (n.children || []).forEach(c => objs[i].add(objs[c])));
  const root = new THREE.Object3D();          // アプリの chara にあたる入れ物
  objs.forEach(o => { if (!o.parent) root.add(o); });
  const bones = {}, rest = {};
  objs.forEach(o => { bones[o.name] = o; rest[o.name] = o.quaternion.clone(); });
  return { objs, root, bones, rest };
}

// 素の姿勢の箱。スキン付きの頂点はバインド行列で既に骨の空間に載っているので、
// メッシュ側のワールド行列は掛けない。掛けると桁が狂う。
function restBox(g){
  const P = g.acc(g.j.meshes[0].primitives[0].attributes.POSITION);
  const lo = [9e9, 9e9, 9e9], hi = [-9e9, -9e9, -9e9];
  for (const v of P) for (let k = 0; k < 3; k++){
    lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]);
  }
  return { lo, hi };
}

const body     = readGlb('models/elf.glb');
const sword    = readGlb('models/elfsword.glb');
const bodyTex  = await texOf(body);
const swordTex = await texOf(sword);

const { objs, root, bones, rest } = buildTree(body);

// アプリの fit(root, 1.9, 0) と同じ。高さを揃え、足を原点へ。
{
  const { lo, hi } = restBox(body);
  const k = BODY_H / (hi[1] - lo[1]);
  root.scale.setScalar(k);
  root.position.set(-(lo[0] + hi[0]) / 2 * k, -lo[1] * k, -(lo[2] + hi[2]) / 2 * k);
}
root.updateMatrixWorld(true);

// 剣を吊るす入れ物。アプリと同じく手の骨の子にして、実寸は親の尺度を打ち消して決める。
const swordPivot = new THREE.Object3D();
bones.RightHand.add(swordPivot);
{
  const ws = new THREE.Vector3();
  bones.RightHand.getWorldScale(ws);
  swordPivot.scale.setScalar(SWORD_LEN / ws.x);
  // 骨は手首にある。前腕から手へ伸びる向きへずらして、拳の中に柄が来るようにする。
  const fore = new THREE.Vector3(), hand = new THREE.Vector3();
  bones.RightForeArm.getWorldPosition(fore);
  bones.RightHand.getWorldPosition(hand);
  swordPivot.position.set(0, hand.distanceTo(fore) * GRIP_Y / (ws.y || 1), 0);
}

// ---------------------------------------------------------------- スキニング
const prim = body.j.meshes[0].primitives[0];
const POS  = body.acc(prim.attributes.POSITION);
const IDX  = body.acc(prim.indices);
const UV   = body.acc(prim.attributes.TEXCOORD_0);
const JO   = body.acc(prim.attributes.JOINTS_0);
const WE   = body.acc(prim.attributes.WEIGHTS_0);
const skin = body.j.skins[0];
const IBM  = body.acc(skin.inverseBindMatrices);

const _m = new THREE.Matrix4(), _ibm = new THREE.Matrix4();

// いまの骨の並びで頂点を世界へ移す。姿勢を変えるたびに呼び直す。
function skinned(){
  const sk = skin.joints.map((n, i) => {
    _ibm.fromArray(IBM[i]);
    return _m.copy(objs[n].matrixWorld).multiply(_ibm).elements.slice();
  });
  const out = new Array(POS.length);
  for (let i = 0; i < POS.length; i++){
    const q = POS[i], jo = JO[i], we = WE[i];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++){
      const w = we[k];
      if (!w) continue;
      const m = sk[jo[k]];
      x += w * (m[0]*q[0] + m[4]*q[1] + m[8] *q[2] + m[12]);
      y += w * (m[1]*q[0] + m[5]*q[1] + m[9] *q[2] + m[13]);
      z += w * (m[2]*q[0] + m[6]*q[1] + m[10]*q[2] + m[14]);
    }
    out[i] = [x, y, z];
  }
  return out;
}

// 'table' のときは絵を描かず、守備の重みごとの最下点だけを並べて終わる。
// ここで出た並びがそのまま src/elfpose.js の KNEEL_LOW になる。模型を差し替え
// たら必ず取り直す。骨の長さが変われば、腰の落ちる量も変わるため。
if (TABLE){
  const N = 8;                                  // 0.125 刻み。0..1 で 9 個。
  const row = [];
  for (let i = 0; i <= N; i++){
    const g = i / N;
    applyPose({ bones, rest, root, swordPivot }, { g, w: 0, m: 0, c: 0 });
    root.updateMatrixWorld(true);
    const low = skinned().reduce((m, v) => Math.min(m, v[1]), 9e9);
    row.push(low);
    console.log('  守備 ' + g.toFixed(3) + '  最下点 ' + low.toFixed(3));
  }
  console.log('const KNEEL_LOW = [' + row.map(v => v.toFixed(3)).join(', ') + '];');
  process.exit(0);
}

applyPose({ bones, rest, root, swordPivot }, p);
root.updateMatrixWorld(true);

const V = skinned();

// 剣も同じ行列で世界へ。アプリの fit(root, 1.0, SWORD_GRIP) と同じに寄せる。
const sPrim = sword.j.meshes[0].primitives[0];
const sPOS  = sword.acc(sPrim.attributes.POSITION);
const sIDX  = sword.acc(sPrim.indices);
const sUV   = sword.acc(sPrim.attributes.TEXCOORD_0);
const SV = (() => {
  const { lo, hi } = restBox(sword);
  const k = 1.0 / (hi[1] - lo[1]);
  const M = new THREE.Matrix4().copy(swordPivot.matrixWorld)
    .multiply(new THREE.Matrix4().makeTranslation(
      -(lo[0] + hi[0]) / 2 * k, -(lo[1] + (hi[1] - lo[1]) * SWORD_GRIP) * k, -(lo[2] + hi[2]) / 2 * k))
    .multiply(new THREE.Matrix4().makeScale(k, k, k));
  const v3 = new THREE.Vector3();
  return sPOS.map(q => { v3.set(q[0], q[1], q[2]).applyMatrix4(M); return [v3.x, v3.y, v3.z]; });
})();

// ---------------------------------------------------------------- 沈み込み
// ひざをつくと腰は自分では下がらない（骨を回すと足が動くだけ）。アプリは体ごと
// KNEEL_DROP × 守備の重み だけ沈める。ここでも同じに沈めないと、描き出した絵と
// 画面に出る絵が食い違う。数字は src/elf.js と揃えてある。
const FOOT_SINK = -0.05;
const drop = FOOT_SINK - kneelDrop(p.g);
for (const v of V)  v[1] += drop;
for (const v of SV) v[1] += drop;

// ---------------------------------------------------------------- 数で出す
const lowest = V.reduce((m, v) => Math.min(m, v[1]), 9e9);
const at = (n) => { const v = new THREE.Vector3(); bones[n].getWorldPosition(v); return v; };
console.log('重み  守備 ' + p.g.toFixed(2) + '  頭上 ' + (p.m || 0).toFixed(2) +
            '  ため ' + p.w.toFixed(2) + '  斬り抜き ' + p.c.toFixed(2));
console.log('沈み込み ' + drop.toFixed(3) + '  体の最下点 y=' + lowest.toFixed(3) + '   0 に近いほど、床にちょうど乗っている');
for (const n of ['Hips','RightLeg','RightFoot','LeftLeg','LeftFoot','RightHand','LeftHand','Head']){
  const v = at(n);
  console.log('  ' + n.padEnd(11) + '(' + v.x.toFixed(2) + ',' + v.y.toFixed(2) + ',' + v.z.toFixed(2) + ')');
}
{
  const lo = SV.reduce((m, v) => [Math.min(m[0],v[0]), Math.min(m[1],v[1]), Math.min(m[2],v[2])], [9,9,9]);
  const hi = SV.reduce((m, v) => [Math.max(m[0],v[0]), Math.max(m[1],v[1]), Math.max(m[2],v[2])], [-9,-9,-9]);
  console.log('  剣の箱     x' + lo[0].toFixed(2) + '..' + hi[0].toFixed(2) +
              '  y' + lo[1].toFixed(2) + '..' + hi[1].toFixed(2) +
              '  z' + lo[2].toFixed(2) + '..' + hi[2].toFixed(2));
}

// ---------------------------------------------------------------- 描く
const S = 660, PAD = 18;
const canvas = createCanvas(S * 3, S);
const g2 = canvas.getContext('2d');

const all = V.concat(SV);
const lo = [9e9, 9e9, 9e9], hi = [-9e9, -9e9, -9e9];
for (const v of all) for (let k = 0; k < 3; k++){
  lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]);
}
lo[1] = Math.min(lo[1], 0);   // 床を必ず入れる
const span = Math.max(hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2]) || 1;
const mid = [(lo[0]+hi[0])/2, (lo[1]+hi[1])/2, (lo[2]+hi[2])/2];

const views = [
  // カメラは +Z 側にいて -Z を見る。アプリと同じ「見る人から見た図」。
  // キャラの左（+X）は画面の右に出る。ここを取り違えると左右が逆に見える。
  { name: '正面 (見る人から。キャラの左が画面の右)', ax:0, ay:1, az:2, sx: 1, sy:-1 },
  { name: '真横 (キャラの右から。正面が画面の右)',   ax:2, ay:1, az:0, sx: 1, sy:-1 },
  { name: '真上 (正面が画面の下)',                  ax:0, ay:2, az:1, sx: 1, sy: 1 },
];

views.forEach((v, vi) => {
  const ox = vi * S;
  const zb = new Float32Array(S * S).fill(-9e9);
  const px = (q) => [
    S/2 + v.sx * (q[v.ax] - mid[v.ax]) / span * (S - PAD*2),
    S/2 + v.sy * (q[v.ay] - mid[v.ay]) / span * (S - PAD*2)
  ];
  const img = g2.createImageData(S, S);
  const d = img.data;
  for (let i = 0; i < S*S; i++){ d[i*4] = 20; d[i*4+1] = 18; d[i*4+2] = 28; d[i*4+3] = 255; }

  const draw = (P2, I2, U2, TEX) => {
    for (let t = 0; t < I2.length; t += 3){
      const a = P2[I2[t]], b = P2[I2[t+1]], c = P2[I2[t+2]];
      const ta = U2 && U2[I2[t]], tb = U2 && U2[I2[t+1]], tc = U2 && U2[I2[t+2]];
      const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2];
      const wx = c[0]-a[0], wy = c[1]-a[1], wz = c[2]-a[2];
      let nx = uy*wz - uz*wy, ny = uz*wx - ux*wz, nz = ux*wy - uy*wx;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const lit = Math.max(0.18, Math.abs(nx*0.4 + ny*0.75 + nz*0.53));
      const A = px(a), B = px(b), C = px(c);
      const za = a[v.az]*v.sx, zbv = b[v.az]*v.sx, zc = c[v.az]*v.sx;
      const minX = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
      const maxX = Math.min(S-1, Math.ceil(Math.max(A[0], B[0], C[0])));
      const minY = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
      const maxY = Math.min(S-1, Math.ceil(Math.max(A[1], B[1], C[1])));
      const den = (B[1]-C[1])*(A[0]-C[0]) + (C[0]-B[0])*(A[1]-C[1]);
      if (Math.abs(den) < 1e-9) continue;
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++){
        const l1 = ((B[1]-C[1])*(x-C[0]) + (C[0]-B[0])*(y-C[1])) / den;
        const l2 = ((C[1]-A[1])*(x-C[0]) + (A[0]-C[0])*(y-C[1])) / den;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const z = l1*za + l2*zbv + l3*zc, k2 = x + y*S;
        if (z <= zb[k2]) continue;
        zb[k2] = z;
        const q = k2 * 4;
        if (TEX && ta){
          const uu = l1*ta[0] + l2*tb[0] + l3*tc[0];
          const vv = l1*ta[1] + l2*tb[1] + l3*tc[1];
          let tx = Math.round(uu * TEX.w) % TEX.w; if (tx < 0) tx += TEX.w;
          let ty = Math.round(vv * TEX.h) % TEX.h; if (ty < 0) ty += TEX.h;
          const s0 = (tx + ty*TEX.w) * 4, sh = 0.45 + lit*0.75;
          d[q]   = Math.min(255, TEX.d[s0]   * sh);
          d[q+1] = Math.min(255, TEX.d[s0+1] * sh);
          d[q+2] = Math.min(255, TEX.d[s0+2] * sh);
        } else {
          d[q]   = Math.min(255, 210*lit + 30);
          d[q+1] = Math.min(255, 200*lit + 26);
          d[q+2] = Math.min(255, 245*lit + 34);
        }
      }
    }
  };
  draw(V, IDX, UV, bodyTex);
  draw(SV, sIDX, sUV, swordTex);
  g2.putImageData(img, ox, 0);

  // 床の線。ひざが浮いているかはこれとの差でしか分からない。
  if (v.ay === 1){
    const fy = px([0, 0, 0])[1];
    g2.strokeStyle = '#ff9a3c'; g2.lineWidth = 1.5;
    g2.beginPath(); g2.moveTo(ox, fy); g2.lineTo(ox + S, fy); g2.stroke();
    g2.fillStyle = '#ff9a3c'; g2.font = '13px sans-serif';
    g2.fillText('床 y=0', ox + S - 64, fy - 6);
  }
  g2.fillStyle = '#fff'; g2.font = 'bold 19px sans-serif';
  g2.fillText(v.name, ox + 14, 28);
  g2.strokeStyle = '#ffffff33'; g2.lineWidth = 1;
  g2.strokeRect(ox + 0.5, 0.5, S - 1, S - 1);
});

fs.writeFileSync(out, canvas.toBuffer('image/png'));
console.log('描き出しました: ' + out);
