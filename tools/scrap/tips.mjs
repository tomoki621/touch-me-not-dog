// とげの先端を数える。周囲より高い頂点＝円錐の先。
import fs from 'node:fs';
const b = fs.readFileSync(process.argv[2]);
let off=12, j=null, binOff=0;
while (off < b.length){ const l=b.readUInt32LE(off), t=b.readUInt32LE(off+4);
  if (t===0x4E4F534A) j=JSON.parse(b.slice(off+8,off+8+l).toString('utf8'));
  else if (t===0x004E4942) binOff=off+8;
  off += 8+l; }
const prim=j.meshes[0].primitives[0], a=j.accessors[prim.attributes.POSITION];
const bv=j.bufferViews[a.bufferView], base=binOff+(bv.byteOffset||0)+(a.byteOffset||0);
const st=bv.byteStride||12;
const P=[];
for (let i=0;i<a.count;i++){ const o=base+i*st;
  P.push([b.readFloatLE(o), b.readFloatLE(o+4), b.readFloatLE(o+8)]); }
const cand = P.filter(p => p[1] > 1.35);
const R = 0.10;
const tips = [];
for (const p of cand){
  let top = true;
  for (const q of cand){ if (q===p) continue;
    if (Math.hypot(q[0]-p[0], q[2]-p[2]) < R && q[1] > p[1] + 1e-5){ top=false; break; } }
  if (top) tips.push(p);
}
// 近すぎる先端はまとめる
const merged=[];
for (const t of tips.sort((u,v)=>v[1]-u[1])){
  if (merged.some(m => Math.hypot(m[0]-t[0], m[2]-t[2]) < R)) continue;
  merged.push(t);
}
console.log(process.argv[2]);
for (const m of merged) console.log(`  x=${m[0].toFixed(3).padStart(6)}  y=${m[1].toFixed(3)}  z=${m[2].toFixed(3).padStart(6)}`);
