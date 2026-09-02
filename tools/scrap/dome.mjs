// 兜の天井を丸ごと均す。
// とげ1本ずつを狭い範囲で均すと、範囲の境目に必ず取り残しが出る。
// 天井を1つの範囲にすれば内側に境目が無くなるので、残らない。
// 均すと全体が少し縮むので、縮んだぶんを外向きに戻してへこみを打ち消す。
// 使い方: node dome.mjs <in> <out>   環境変数 ITER / YMIN / KEEPR / KEEP
import fs from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const src = process.argv[2], dst = process.argv[3];
const ITER  = parseInt(process.env.ITER || '400', 10);
const YMIN  = parseFloat(process.env.YMIN || '1.46');
const KEEPR = parseFloat(process.env.KEEPR || '0.11');

const b = fs.readFileSync(src);
let off = 12, j = null, binOff = 0, binLen = 0;
while (off < b.length) {
  const l = b.readUInt32LE(off), t = b.readUInt32LE(off + 4);
  if (t === 0x4E4F534A) j = JSON.parse(b.slice(off + 8, off + 8 + l).toString('utf8'));
  else if (t === 0x004E4942) { binOff = off + 8; binLen = l; }
  off += 8 + l;
}
const out = Buffer.from(b);
const pr = j.meshes[0].primitives[0], A = j.accessors[pr.attributes.POSITION];
const V = j.bufferViews[A.bufferView], base = binOff + (V.byteOffset || 0) + (A.byteOffset || 0);
const st = V.byteStride || 12, N = A.count;
const getP = (i) => { const o = base + i * st; return [out.readFloatLE(o), out.readFloatLE(o + 4), out.readFloatLE(o + 8)]; };
const setP = (i, v) => { const o = base + i * st; out.writeFloatLE(v[0], o); out.writeFloatLE(v[1], o + 4); out.writeFloatLE(v[2], o + 8); };
const P = []; for (let i = 0; i < N; i++) P.push(getP(i));

const IA = j.accessors[pr.indices], IV = j.bufferViews[IA.bufferView];
const isz = IA.componentType === 5125 ? 4 : 2;
const io = binOff + (IV.byteOffset || 0) + (IA.byteOffset || 0), ist = IV.byteStride || isz;
const idx = new Array(IA.count);
for (let i = 0; i < IA.count; i++) idx[i] = isz === 4 ? out.readUInt32LE(io + i * ist) : out.readUInt16LE(io + i * ist);

const rep = new Map(), root = new Int32Array(N);
for (let i = 0; i < N; i++) {
  const k = P[i].map(v => Math.round(v * 20000)).join(',');
  if (!rep.has(k)) rep.set(k, i);
  root[i] = rep.get(k);
}
const adj = new Map();
const link = (u, v) => { if (!adj.has(u)) adj.set(u, new Set()); adj.get(u).add(v); };
for (let t = 0; t < idx.length; t += 3) {
  const a = root[idx[t]], c = root[idx[t + 1]], d = root[idx[t + 2]];
  link(a, c); link(c, a); link(c, d); link(d, c); link(d, a); link(a, d);
}

// 兜（青）だけを対象にする。耳と顔は薄紫なので触らない。
let isBlue = () => true;
{
  const uvA = pr.attributes.TEXCOORD_0, mat = pr.material;
  if (uvA !== undefined && mat !== undefined) {
    const UA = j.accessors[uvA], UB = j.bufferViews[UA.bufferView];
    const uo = binOff + (UB.byteOffset || 0) + (UA.byteOffset || 0), ust = UB.byteStride || 8;
    const m = j.materials[mat], ti = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture;
    if (ti) {
      const im = j.images[j.textures[ti.index].source], bvv = j.bufferViews[im.bufferView];
      const img = await loadImage(out.slice(binOff + (bvv.byteOffset || 0), binOff + (bvv.byteOffset || 0) + bvv.byteLength));
      const cv = createCanvas(img.width, img.height);
      cv.getContext('2d').drawImage(img, 0, 0);
      const D = cv.getContext('2d').getImageData(0, 0, img.width, img.height).data;
      const yes = new Uint8Array(N), no = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        const o = uo + i * ust, u = out.readFloatLE(o), v = out.readFloatLE(o + 4);
        let x = Math.round(u * img.width) % img.width; if (x < 0) x += img.width;
        let y = Math.round(v * img.height) % img.height; if (y < 0) y += img.height;
        const s0 = (x + y * img.width) * 4;
        if (D[s0 + 2] > D[s0] + 45) yes[root[i]] = 1; else no[root[i]] = 1;
      }
      isBlue = (k) => yes[k] === 1 && no[k] === 0;
    }
  }
}

const H = P.filter(p => p[1] > 1.22);
const C = H.reduce((u, p) => [u[0] + p[0] / H.length, u[1] + p[1] / H.length, u[2] + p[2] / H.length], [0, 0, 0]);
const KEEP = JSON.parse(process.env.KEEP || '[[-0.011,1.671,0.068],[0.008,1.595,0.470]]');
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

const region = new Set();
for (let i = 0; i < N; i++) {
  const k = root[i], p = P[k];
  if (p[1] < YMIN) continue;
  if (!isBlue(k)) continue;
  let near = false;
  for (const t of KEEP) if (dist(p, t) < KEEPR) { near = true; break; }
  if (near) continue;
  region.add(k);
}
const rim = new Set();
for (const v of region) { for (const u of (adj.get(v) || [])) if (!region.has(u)) { rim.add(v); break; } }
const inner = [...region].filter(v => !rim.has(v));
console.log('天井の範囲 ' + region.size + '頂点（縁 ' + rim.size + ' / 中 ' + inner.length + '）');
if (inner.length < 50) { console.error('範囲が取れない'); process.exit(1); }

// 縁からの距離。縁ではなにもせず、奥ほど強くかける。
const hop = new Map(); const q = [];
for (const v of rim) { hop.set(v, 0); q.push(v); }
for (let h = 0; h < q.length; h++) {
  const u = q[h];
  for (const v of (adj.get(u) || [])) if (region.has(v) && !hop.has(v)) { hop.set(v, hop.get(u) + 1); q.push(v); }
}
let hmax = 0; for (const v of hop.values()) hmax = Math.max(hmax, v);
console.log('縁からの深さ 最大 ' + hmax);

const orig = new Map(); for (const v of region) orig.set(v, P[v].slice());
const cur = new Map(); for (const v of region) cur.set(v, P[v].slice());
for (let it = 0; it < ITER; it++) {
  const nx = new Map();
  for (const v of inner) {
    let s = [0, 0, 0], n = 0;
    for (const u of (adj.get(v) || [])) { const p = cur.get(u) || P[u]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; n++; }
    const c = cur.get(v);
    nx.set(v, n ? [c[0] + 0.6 * (s[0] / n - c[0]), c[1] + 0.6 * (s[1] / n - c[1]), c[2] + 0.6 * (s[2] / n - c[2])] : c);
  }
  for (const [v, p] of nx) cur.set(v, p);
}

// 均すと縮む。縮んだぶんを外向きに戻して、へこまないようにする。
let drSum = 0, drN = 0;
for (const v of inner) {
  const a = orig.get(v), c = cur.get(v);
  const ra = Math.hypot(a[0] - C[0], a[1] - C[1], a[2] - C[2]);
  const rc = Math.hypot(c[0] - C[0], c[1] - C[1], c[2] - C[2]);
  drSum += ra - rc; drN++;
}
const dr = drSum / drN;
console.log('縮んだ量（平均） ' + dr.toFixed(4) + ' → 同じだけ外へ戻す');

let n = 0, maxD = 0;
for (let i = 0; i < N; i++) {
  const k = root[i], c = cur.get(k);
  if (!c || rim.has(k)) continue;
  // 縁を止めて内側だけ動かすと、そこで面が鋭く折れて黒い線に見える。
  // 動かす量そのものを縁から数列かけて 0 へ落とし、なだらかにつなぐ。
  const t = Math.min(1, hop.get(k) / 5), w = t * t * (3 - 2 * t);
  const d = [c[0] - C[0], c[1] - C[1], c[2] - C[2]], L = Math.hypot(d[0], d[1], d[2]) || 1;
  const sm = [c[0] + d[0] / L * dr, c[1] + d[1] / L * dr, c[2] + d[2] / L * dr];
  const a0 = orig.get(k);
  const p = [a0[0] + (sm[0] - a0[0]) * w, a0[1] + (sm[1] - a0[1]) * w, a0[2] + (sm[2] - a0[2]) * w];
  maxD = Math.max(maxD, dist(P[i], p));
  setP(i, p); P[i] = p; n++;
}
console.log('動かした頂点 ' + n + ' 最大 ' + maxD.toFixed(3));

// 形が変わったので法線を張り直す
{
  const nA = pr.attributes.NORMAL;
  if (nA !== undefined) {
    const NA = j.accessors[nA], NB = j.bufferViews[NA.bufferView];
    const no = binOff + (NB.byteOffset || 0) + (NA.byteOffset || 0), nst = NB.byteStride || 12;
    const touched = new Set();
    for (const v of region) { touched.add(v); for (const u of (adj.get(v) || [])) touched.add(u); }
    const acc = new Map();
    for (let t = 0; t < idx.length; t += 3) {
      const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
      if (!touched.has(root[i0]) && !touched.has(root[i1]) && !touched.has(root[i2])) continue;
      const a = getP(i0), b2 = getP(i1), c = getP(i2);
      const u = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const fn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      for (const i of [i0, i1, i2]) {
        const kk = root[i];
        const s0 = acc.get(kk) || [0, 0, 0];
        acc.set(kk, [s0[0] + fn[0], s0[1] + fn[1], s0[2] + fn[2]]);
      }
    }
    let fx = 0;
    for (let i = 0; i < N; i++) {
      const v = acc.get(root[i]); if (!v) continue;
      const L = Math.hypot(v[0], v[1], v[2]); if (L < 1e-12) continue;
      out.writeFloatLE(v[0] / L, no + i * nst);
      out.writeFloatLE(v[1] / L, no + i * nst + 4);
      out.writeFloatLE(v[2] / L, no + i * nst + 8);
      fx++;
    }
    console.log('法線を張り直した頂点 ' + fx);
  }
}

let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
for (let i = 0; i < N; i++) {
  const p = getP(i);
  for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
}
A.min = lo; A.max = hi;
const nj = Buffer.from(JSON.stringify(j), 'utf8');
const jp = Buffer.concat([nj, Buffer.alloc((4 - (nj.length % 4)) % 4, 0x20)]);
const bin = out.slice(binOff, binOff + binLen);
const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4);
head.writeUInt32LE(12 + 8 + jp.length + 8 + bin.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(jp.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004E4942, 4);
fs.writeFileSync(dst, Buffer.concat([head, jh, jp, bh, bin]));
console.log('書き出し: ' + dst);
