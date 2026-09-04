// GLB に入っているモーションを読み、骨がどちらへ回ると体のどこが動くのかを実測する。
//
//   node tools/animref.mjs <glb> [骨名...]
//
// 姿勢を手で書くとき、いちばん外すのが符号。「腿の X を正で回すと足は前か後ろか」は
// 骨ごとのローカル軸の取り方で決まり、注釈からは分からない。Meshy が付けてきた
// 走り・歩きのクリップには、その答えが実測として入っている。歩幅も、腕の振り幅も、
// 「この模型で人が自然に見える範囲」そのもの。当てずっぽうの代わりにここを見る。
//
// 出すもの：
//   ・クリップの一覧と長さ
//   ・骨ごとの、ローカル回転（XYZ オイラー）の最小・最大
//   ・その骨の子（足・手）の、腰から見たワールド位置が同時にどう動くか
//     → 回転の符号と、前後左右のどちらへ出るかが結びつく
import fs from 'node:fs';
import * as THREE from 'three';

const file = process.argv[2];
if (!file){ console.error('使い方: node tools/animref.mjs <glb> [骨名...]'); process.exit(1); }

function readGlb(f){
  const b = fs.readFileSync(f);
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
  return { j, acc };
}

const g = readGlb(file);
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
const root = new THREE.Object3D();
objs.forEach(o => { if (!o.parent) root.add(o); });
const byName = {};
objs.forEach(o => { byName[o.name] = o; });

const anims = g.j.animations || [];
console.log('== ' + file.split(/[\\/]/).pop());
anims.forEach((a, i) => {
  const last = Math.max(...a.channels.map(c => {
    const s = a.samplers[c.sampler];
    return g.j.accessors[s.input].max ? g.j.accessors[s.input].max[0] : 0;
  }));
  console.log('  anim[' + i + '] ' + (a.name || '') + '  ' + a.channels.length + 'ch  ' +
              last.toFixed(2) + 's');
});
if (!anims.length){ console.log('  モーション無し'); process.exit(0); }

// クリップを組む。回転だけ見る（位置は Hips のみ動く）。
const A = anims[0];
const tracks = [];
for (const ch of A.channels){
  const s = A.samplers[ch.sampler];
  const t = g.acc(s.input), v = g.acc(s.output);
  const node = objs[ch.target.node];
  if (!node) continue;
  tracks.push({ node, path: ch.target.path, t, v });
}
const T = Math.max(...tracks.map(k => k.t[k.t.length - 1]));

function sample(time){
  for (const k of tracks){
    let i = 0;
    while (i < k.t.length - 1 && k.t[i + 1] < time) i++;
    const j2 = Math.min(i + 1, k.t.length - 1);
    const span = Math.max(1e-6, k.t[j2] - k.t[i]);
    const a = Math.min(1, Math.max(0, (time - k.t[i]) / span));
    if (k.path === 'rotation'){
      const qa = new THREE.Quaternion().fromArray(k.v[i]);
      const qb = new THREE.Quaternion().fromArray(k.v[j2]);
      k.node.quaternion.copy(qa).slerp(qb, a);
    } else if (k.path === 'translation'){
      const pa = new THREE.Vector3().fromArray(k.v[i]);
      const pb = new THREE.Vector3().fromArray(k.v[j2]);
      k.node.position.copy(pa).lerp(pb, a);
    }
  }
  root.updateMatrixWorld(true);
}

// 見たい骨と、その動きが現れる先（子の骨）。
const PAIRS = process.argv.length > 3
  ? process.argv.slice(3).map(n => [n, null])
  : [['RightUpLeg', 'RightFoot'], ['LeftUpLeg', 'LeftFoot'],
     ['RightLeg', 'RightFoot'],   ['LeftLeg', 'LeftFoot'],
     ['Spine', 'Head'], ['Spine01', 'Head'], ['Spine02', 'Head'],
     ['RightArm', 'RightHand'], ['RightForeArm', 'RightHand'],
     ['LeftArm', 'LeftHand'],   ['LeftForeArm', 'LeftHand']];

const STEPS = 24;
const e = new THREE.Euler(), hips = new THREE.Vector3(), tip = new THREE.Vector3();
const f = (v) => (v >= 0 ? ' ' : '') + v.toFixed(2);

for (const [name, child] of PAIRS){
  const b = byName[name];
  if (!b){ console.log('  ' + name + ' 無し'); continue; }
  const c = child ? byName[child] : null;
  let exX = null, exN = null;   // X 回転が最大／最小のときの様子
  for (let s = 0; s < STEPS; s++){
    sample(T * s / (STEPS - 1));
    e.setFromQuaternion(b.quaternion, 'XYZ');
    const rec = { x: e.x, y: e.y, z: e.z, z2: 0 };
    if (c){
      byName.Hips.getWorldPosition(hips);
      c.getWorldPosition(tip);
      rec.z2 = tip.z - hips.z;         // 前後（+Z が正面）
      rec.y2 = tip.y - hips.y;
    }
    if (!exX || rec.x > exX.x) exX = rec;
    if (!exN || rec.x < exN.x) exN = rec;
  }
  const tail = c
    ? '   ' + child + 'の前後(z): X最大で' + f(exX.z2) + ' / X最小で' + f(exN.z2)
    : '';
  console.log('  ' + name.padEnd(13) +
    ' X ' + f(exN.x) + '..' + f(exX.x) +
    '  Y ' + f(Math.min(exN.y, exX.y)) + '..' + f(Math.max(exN.y, exX.y)) +
    '  Z ' + f(Math.min(exN.z, exX.z)) + '..' + f(Math.max(exN.z, exX.z)) + tail);
}
