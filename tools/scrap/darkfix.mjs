// とげを消した所に残る「描き込まれた黒い線」を消す。
// 形を平らにしても、絵に描かれた輪郭線や影はそのまま残る。平均の色では
// ほとんど動かないので測っても見えず、目では黒い傷として目立つ。
//   1) 動かした頂点の三角形だけを UV 空間に塗って型紙を作る（外は一切触らない）
//   2) 型紙の中の「兜の青」の中央値を出す
//   3) 型紙の中で、その青よりはっきり暗い画素だけを青に置き換える
// 使い方: node darkfix.mjs <元GLB> <今GLB> <出力GLB>
import fs from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const [, , orig, src, dst] = process.argv;
const DARK = parseFloat(process.env.DARK || '0.80');   // 中央値の何割より暗ければ塗るか

function read(f) {
  const b = fs.readFileSync(f);
  let off = 12, j = null, bo = 0, bl = 0;
  while (off < b.length) {
    const l = b.readUInt32LE(off), t = b.readUInt32LE(off + 4);
    if (t === 0x4E4F534A) j = JSON.parse(b.slice(off + 8, off + 8 + l).toString('utf8'));
    else if (t === 0x004E4942) { bo = off + 8; bl = l; }
    off += 8 + l;
  }
  return { b, j, bo, bl };
}
const O = read(orig), M = read(src);
const pr = M.j.meshes[0].primitives[0];
const rd = (S, ai, nc) => {
  const a = S.j.accessors[ai], v = S.j.bufferViews[a.bufferView];
  const o0 = S.bo + (v.byteOffset || 0) + (a.byteOffset || 0), st = v.byteStride || nc * 4, o = [];
  for (let i = 0; i < a.count; i++) {
    const p = o0 + i * st, q = [];
    for (let k = 0; k < nc; k++) q.push(S.b.readFloatLE(p + k * 4));
    o.push(q);
  }
  return o;
};
const P = rd(M, pr.attributes.POSITION, 3), UV = rd(M, pr.attributes.TEXCOORD_0, 2);
const PO = rd(O, O.j.meshes[0].primitives[0].attributes.POSITION, 3);
const IA = M.j.accessors[pr.indices], IV = M.j.bufferViews[IA.bufferView];
const isz = IA.componentType === 5125 ? 4 : 2;
const io = M.bo + (IV.byteOffset || 0) + (IA.byteOffset || 0), ist = IV.byteStride || isz;
const I = [];
for (let i = 0; i < IA.count; i++) I.push(isz === 4 ? M.b.readUInt32LE(io + i * ist) : M.b.readUInt16LE(io + i * ist));

const moved = new Uint8Array(P.length);
let nm = 0;
for (let i = 0; i < P.length; i++) {
  if (Math.hypot(P[i][0] - PO[i][0], P[i][1] - PO[i][1], P[i][2] - PO[i][2]) > 1e-5) { moved[i] = 1; nm++; }
}
console.log('動いた頂点: ' + nm);

const m = M.j.materials[pr.material], ti = m.pbrMetallicRoughness.baseColorTexture;
const imgDef = M.j.images[M.j.textures[ti.index].source], bvv = M.j.bufferViews[imgDef.bufferView];
const png = M.b.slice(M.bo + (bvv.byteOffset || 0), M.bo + (bvv.byteOffset || 0) + bvv.byteLength);
const img = await loadImage(png);
const W = img.width, H = img.height;
const cv = createCanvas(W, H), g = cv.getContext('2d');
g.drawImage(img, 0, 0);
const id = g.getImageData(0, 0, W, H), D = id.data;
console.log('絵 ' + W + 'x' + H);

// 型紙。動いた頂点だけでできた三角形に限る。外へはみ出させない。
const mask = new Uint8Array(W * H);
const uvpx = (i) => [UV[i][0] * W, UV[i][1] * H];
const tri = (a, b2, c) => {
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b2[0], c[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b2[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b2[1], c[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b2[1], c[1])));
  const den = (b2[1] - c[1]) * (a[0] - c[0]) + (c[0] - b2[0]) * (a[1] - c[1]);
  if (Math.abs(den) < 1e-9) return;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const l1 = ((b2[1] - c[1]) * (x - c[0]) + (c[0] - b2[0]) * (y - c[1])) / den;
    const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / den;
    if (l1 < 0 || l2 < 0 || 1 - l1 - l2 < 0) continue;
    mask[x + y * W] = 1;
  }
};
for (let t = 0; t < I.length; t += 3) {
  if (!moved[I[t]] || !moved[I[t + 1]] || !moved[I[t + 2]]) continue;   // 3頂点とも動いた面だけ
  tri(uvpx(I[t]), uvpx(I[t + 1]), uvpx(I[t + 2]));
}
let mc = 0; for (const v of mask) if (v) mc++;
console.log('型紙: ' + mc + ' ピクセル (' + (mc / (W * H) * 100).toFixed(1) + '%)');

// 型紙の中の「兜の青」の中央値
const rs = [], gs = [], bs = [], lum = [];
for (let i = 0; i < W * H; i++) {
  if (!mask[i]) continue;
  const o = i * 4;
  if (!(D[o + 2] > D[o] + 45)) continue;
  rs.push(D[o]); gs.push(D[o + 1]); bs.push(D[o + 2]);
  lum.push(0.2126 * D[o] + 0.7152 * D[o + 1] + 0.0722 * D[o + 2]);
}
if (rs.length < 50) { console.error('型紙の中に兜の青が足りない'); process.exit(1); }
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const T = [med(rs), med(gs), med(bs)];
const TL = med(lum);
console.log('型紙の中の兜の青: [' + T.join(', ') + ']  明るさ中央値 ' + TL.toFixed(1));

// はっきり暗い画素だけを置き換える
const hit = new Uint8Array(W * H);
let nh = 0;
for (let i = 0; i < W * H; i++) {
  if (!mask[i]) continue;
  const o = i * 4;
  const l = 0.2126 * D[o] + 0.7152 * D[o + 1] + 0.0722 * D[o + 2];
  if (l >= TL * DARK) continue;
  hit[i] = 1; nh++;
}
console.log('暗いと判定: ' + nh + ' ピクセル (型紙の ' + (nh / mc * 100).toFixed(1) + '%)');
for (let i = 0; i < W * H; i++) {
  if (!hit[i]) continue;
  const o = i * 4;
  D[o] = T[0]; D[o + 1] = T[1]; D[o + 2] = T[2];
}
// 置き換えた所とその隣だけを軽くならす（型紙の外へは出さない）
for (let pass = 0; pass < 2; pass++) {
  const cp = Uint8ClampedArray.from(D);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = x + y * W;
    if (!mask[i]) continue;
    let any = false;
    for (let dy = -1; dy <= 1 && !any; dy++) for (let dx = -1; dx <= 1; dx++) if (hit[(x + dx) + (y + dy) * W]) { any = true; break; }
    if (!any) continue;
    for (let k = 0; k < 3; k++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const q = (x + dx) + (y + dy) * W;
        if (!mask[q]) continue;
        s += cp[q * 4 + k]; n++;
      }
      if (n) D[i * 4 + k] = s / n;
    }
  }
}
g.putImageData(id, 0, 0);

const mime = imgDef.mimeType || 'image/png';
const outImg = mime === 'image/jpeg' ? cv.toBuffer('image/jpeg', { quality: 92 }) : cv.toBuffer('image/png');
console.log('絵を書き出し ' + mime + ' ' + (outImg.length / 1024).toFixed(0) + ' KB (元 ' + (png.length / 1024).toFixed(0) + ' KB)');

// BIN を作り直す（古い絵を残さない）
const pad = (n) => (4 - (n % 4)) % 4;
const j2 = JSON.parse(JSON.stringify(M.j));
const imgIdx = M.j.textures[ti.index].source;
const parts = []; let cur = 0;
j2.bufferViews.forEach((v, k) => {
  const isImg = j2.images[imgIdx].bufferView === k;
  const bytes = isImg ? outImg : M.b.slice(M.bo + (v.byteOffset || 0), M.bo + (v.byteOffset || 0) + v.byteLength);
  const p = pad(cur);
  if (p) { parts.push(Buffer.alloc(p)); cur += p; }
  v.byteOffset = cur; v.byteLength = bytes.length;
  parts.push(bytes); cur += bytes.length;
});
const tail = pad(cur); if (tail) parts.push(Buffer.alloc(tail));
const newBin = Buffer.concat(parts);
j2.buffers[0].byteLength = newBin.length;
const nj = Buffer.from(JSON.stringify(j2), 'utf8');
const jp = Buffer.concat([nj, Buffer.alloc(pad(nj.length), 0x20)]);
const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4);
head.writeUInt32LE(12 + 8 + jp.length + 8 + newBin.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(jp.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(newBin.length, 0); bh.writeUInt32LE(0x004E4942, 4);
fs.writeFileSync(dst, Buffer.concat([head, jh, jp, bh, newBin]));
console.log('書き出し: ' + dst);
