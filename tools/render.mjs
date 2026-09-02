// GLB を真横・正面・真上から描き出して PNG にする。形を目で確かめるための道具。
// 見えないまま形をいじるのが事故の元なので、確認の手段を用意する。
import fs from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const file = process.argv[2] || 'models/rouise.glb';
const out  = process.argv[3] || 'view.png';
const yMin = parseFloat(process.argv[4] ?? '-9');

const b = fs.readFileSync(file);
let off = 12, j = null, bin = null;
while (off < b.length){
  const l = b.readUInt32LE(off), t = b.readUInt32LE(off+4);
  if (t === 0x4E4F534A) j = JSON.parse(b.slice(off+8, off+8+l).toString('utf8'));
  else if (t === 0x004E4942) bin = b.slice(off+8, off+8+l);
  off += 8 + l;
}
const prim = j.meshes[0].primitives[0];
function acc(idx){
  const a = j.accessors[idx], bv = j.bufferViews[a.bufferView];
  const base = (bv.byteOffset||0) + (a.byteOffset||0);
  const nc = {SCALAR:1, VEC2:2, VEC3:3, VEC4:4}[a.type];
  const sz = {5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[a.componentType];
  const stride = bv.byteStride || nc*sz;
  const out = [];
  for (let i = 0; i < a.count; i++){
    const o = base + i*stride, v = [];
    for (let k = 0; k < nc; k++){
      const p = o + k*sz;
      v.push(a.componentType === 5126 ? bin.readFloatLE(p)
           : a.componentType === 5123 ? bin.readUInt16LE(p)
           : a.componentType === 5125 ? bin.readUInt32LE(p) : bin.readUInt8(p));
    }
    out.push(nc === 1 ? v[0] : v);
  }
  return out;
}
const P = acc(prim.attributes.POSITION);
const I = acc(prim.indices);
const UV = prim.attributes.TEXCOORD_0 !== undefined ? acc(prim.attributes.TEXCOORD_0) : null;

// 貼ってある絵も読む。色を見ないと「跡が帽子の色と違う」が判断できない。
let TEX = null;
if (UV && prim.material !== undefined){
  const m = j.materials[prim.material];
  const ti = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture;
  if (ti){
    const im = j.images[j.textures[ti.index].source];
    if (im.bufferView !== undefined){
      const v = j.bufferViews[im.bufferView];
      const png = bin.slice(v.byteOffset||0, (v.byteOffset||0)+v.byteLength);
      const img = await loadImage(png);
      const c2 = createCanvas(img.width, img.height);
      c2.getContext('2d').drawImage(img, 0, 0);
      TEX = { w: img.width, h: img.height,
              d: c2.getContext('2d').getImageData(0,0,img.width,img.height).data };
      console.log(`絵 ${img.width}x${img.height} を読み込んだ`);
    }
  }
}

const S = 620, PAD = 14;
const canvas = createCanvas(S*3, S);
const g = canvas.getContext('2d');
g.fillStyle = '#14121c'; g.fillRect(0, 0, S*3, S);

// 表示する範囲
let lo = [9,9,9], hi = [-9,-9,-9];
for (const p of P){ if (p[1] < yMin) continue;
  for (let k = 0; k < 3; k++){ lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); } }
const span = Math.max(hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2]) || 1;
const mid = [ (lo[0]+hi[0])/2, (lo[1]+hi[1])/2, (lo[2]+hi[2])/2 ];

const views = [
  { name: '正面 (キャラの右が左手側)', ax: 0, ay: 1, az: 2, sx: -1, sy: -1 },
  { name: '真横 (右から)',             ax: 2, ay: 1, az: 0, sx:  1, sy: -1 },
  { name: '真上',                      ax: 0, ay: 2, az: 1, sx: -1, sy:  1 },
];

views.forEach((v, vi) => {
  const ox = vi*S;
  const zb = new Float32Array(S*S).fill(-1e9);
  const px = (p) => [
    ox + S/2 + v.sx*(p[v.ax]-mid[v.ax])/span*(S-PAD*2),
    S/2 + v.sy*(p[v.ay]-mid[v.ay])/span*(S-PAD*2)
  ];
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let i = 0; i < S*S; i++){ d[i*4] = 20; d[i*4+1] = 18; d[i*4+2] = 28; d[i*4+3] = 255; }

  for (let t = 0; t < I.length; t += 3){
    const a = P[I[t]], b2 = P[I[t+1]], c = P[I[t+2]];
    const ta = UV && UV[I[t]], tb = UV && UV[I[t+1]], tc = UV && UV[I[t+2]];
    if (a[1] < yMin && b2[1] < yMin && c[1] < yMin) continue;
    // 面の法線で簡単に陰影をつける
    const ux = b2[0]-a[0], uy = b2[1]-a[1], uz = b2[2]-a[2];
    const wx = c[0]-a[0], wy = c[1]-a[1], wz = c[2]-a[2];
    let nx = uy*wz-uz*wy, ny = uz*wx-ux*wz, nz = ux*wy-uy*wx;
    const nl = Math.hypot(nx,ny,nz) || 1; nx/=nl; ny/=nl; nz/=nl;
    const lit = Math.max(0.18, Math.abs(nx*0.4 + ny*0.75 + nz*0.53));
    const A = px(a), B = px(b2), C = px(c);
    const za = a[v.az]*v.sx, zbv = b2[v.az]*v.sx, zc = c[v.az]*v.sx;
    const minX = Math.max(ox, Math.floor(Math.min(A[0],B[0],C[0])));
    const maxX = Math.min(ox+S-1, Math.ceil(Math.max(A[0],B[0],C[0])));
    const minY = Math.max(0, Math.floor(Math.min(A[1],B[1],C[1])));
    const maxY = Math.min(S-1, Math.ceil(Math.max(A[1],B[1],C[1])));
    const den = (B[1]-C[1])*(A[0]-C[0]) + (C[0]-B[0])*(A[1]-C[1]);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++){
      for (let x = minX; x <= maxX; x++){
        const l1 = ((B[1]-C[1])*(x-C[0]) + (C[0]-B[0])*(y-C[1]))/den;
        const l2 = ((C[1]-A[1])*(x-C[0]) + (A[0]-C[0])*(y-C[1]))/den;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const z = l1*za + l2*zbv + l3*zc;
        const k = (x-ox) + y*S;
        if (z <= zb[k]) continue;
        zb[k] = z;
        const q = k*4;
        if (TEX && ta){
          const uu = l1*ta[0] + l2*tb[0] + l3*tc[0];
          const vv = l1*ta[1] + l2*tb[1] + l3*tc[1];
          let tx = Math.round(uu*TEX.w) % TEX.w; if (tx<0) tx += TEX.w;
          let ty = Math.round(vv*TEX.h) % TEX.h; if (ty<0) ty += TEX.h;
          const s0 = (tx + ty*TEX.w)*4;
          const sh = 0.45 + lit*0.75;
          d[q]   = Math.min(255, TEX.d[s0]*sh);
          d[q+1] = Math.min(255, TEX.d[s0+1]*sh);
          d[q+2] = Math.min(255, TEX.d[s0+2]*sh);
        } else {
        d[q]   = Math.min(255, 210*lit + 30);
        d[q+1] = Math.min(255, 200*lit + 26);
        d[q+2] = Math.min(255, 245*lit + 34);
        }
      }
    }
  }
  g.putImageData(img, ox, 0);
  g.fillStyle = '#ffffff'; g.font = 'bold 20px sans-serif';
  g.fillText(v.name, ox + 14, 30);
  g.strokeStyle = '#ffffff33'; g.strokeRect(ox+0.5, 0.5, S-1, S-1);
});

fs.writeFileSync(out, canvas.toBuffer('image/png'));
console.log('描き出しました:', out, canvas.width + 'x' + canvas.height);
