// 軸まわりの半径ごとの最高点。円錐が兜の丸みに戻る所を探す。
import fs from 'node:fs';
const b = fs.readFileSync(process.argv[2]);
let off=12, j=null, binOff=0;
while (off<b.length){ const l=b.readUInt32LE(off), t=b.readUInt32LE(off+4);
  if (t===0x4E4F534A) j=JSON.parse(b.slice(off+8,off+8+l).toString('utf8'));
  else if (t===0x004E4942) binOff=off+8; off+=8+l; }
const pr=j.meshes[0].primitives[0], A=j.accessors[pr.attributes.POSITION];
const V=j.bufferViews[A.bufferView], o0=binOff+(V.byteOffset||0)+(A.byteOffset||0), st=V.byteStride||12;
const P=[]; for (let i=0;i<A.count;i++){ const o=o0+i*st;
  P.push([b.readFloatLE(o), b.readFloatLE(o+4), b.readFloatLE(o+8)]); }
const ax=Number(process.argv[3]), az=Number(process.argv[4]);
for (let d=0; d<0.34; d+=0.02){
  const band=P.filter(p=>{ const h=Math.hypot(p[0]-ax,p[2]-az); return h>=d && h<d+0.02 && p[1]>1.20; });
  if (!band.length) continue;
  const mx=Math.max(...band.map(p=>p[1]));
  console.log(`  半径 ${d.toFixed(2)}-${(d+0.02).toFixed(2)}  最高y=${mx.toFixed(3)}  ${'#'.repeat(Math.round((mx-1.30)*160))}`);
}
