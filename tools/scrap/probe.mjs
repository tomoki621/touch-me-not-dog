// 面のつながりをたどって、とげ本体だけを取り出す。
// 切る高さを少しずつ下げ、頂点数が急に跳ねたところが「兜に溶けた」高さ＝根元。
import fs from 'node:fs';
const b = fs.readFileSync(process.argv[2]);
let off=12, j=null, binOff=0;
while (off < b.length){ const l=b.readUInt32LE(off), t=b.readUInt32LE(off+4);
  if (t===0x4E4F534A) j=JSON.parse(b.slice(off+8,off+8+l).toString('utf8'));
  else if (t===0x004E4942) binOff=off+8; off += 8+l; }
const pr=j.meshes[0].primitives[0];
const rd=(acc)=>{ const A=j.accessors[acc], V=j.bufferViews[A.bufferView];
  const o=binOff+(V.byteOffset||0)+(A.byteOffset||0);
  const n=A.componentType===5125?4:A.componentType===5123?2:1;
  const st=V.byteStride||n; const out=new Array(A.count);
  for (let i=0;i<A.count;i++){ const p=o+i*st;
    out[i]= n===4?b.readUInt32LE(p): n===2?b.readUInt16LE(p): b.readUInt8(p); }
  return out; };
const A=j.accessors[pr.attributes.POSITION], V=j.bufferViews[A.bufferView];
const pbase=binOff+(V.byteOffset||0)+(A.byteOffset||0), pst=V.byteStride||12;
const P=[]; for (let i=0;i<A.count;i++){ const o=pbase+i*pst;
  P.push([b.readFloatLE(o), b.readFloatLE(o+4), b.readFloatLE(o+8)]); }
const idx = rd(pr.indices);

// 同じ位置の頂点は縫い目で別番号になっている。位置で束ねてからつなぐ。
const key=(p)=>p.map(v=>Math.round(v*20000)).join(',');
const rep=new Map(), root=new Int32Array(A.count);
for (let i=0;i<A.count;i++){ const k=key(P[i]);
  if (!rep.has(k)) rep.set(k,i); root[i]=rep.get(k); }
const adj=new Map();
const link=(u,v)=>{ if(!adj.has(u)) adj.set(u,new Set()); adj.get(u).add(v); };
for (let t=0;t<idx.length;t+=3){ const a=root[idx[t]],c=root[idx[t+1]],d=root[idx[t+2]];
  link(a,c);link(c,a);link(c,d);link(d,c);link(d,a);link(a,d); }

const ax=Number(process.argv[3]), az=Number(process.argv[4]);
let tip=-1, best=-1e9;
for (let i=0;i<A.count;i++){ if (Math.hypot(P[i][0]-ax,P[i][2]-az)<0.09 && P[i][1]>best){ best=P[i][1]; tip=root[i]; } }
console.log(`  先端 y=${best.toFixed(3)}`);
let prev=0;
for (let cut=best-0.02; cut>best-0.40; cut-=0.01){
  const seen=new Set([tip]), stack=[tip];
  while (stack.length){ const u=stack.pop();
    for (const v of (adj.get(u)||[])) if (!seen.has(v) && P[v][1] > cut){ seen.add(v); stack.push(v); } }
  const n=seen.size, jump = prev ? (n/prev) : 1;
  let maxr=0; for (const v of seen) maxr=Math.max(maxr, Math.hypot(P[v][0]-ax,P[v][2]-az));
  console.log(`  切る高さ ${cut.toFixed(2)}  頂点${String(n).padStart(5)}  半径${maxr.toFixed(3)}  ${jump>1.8?'← ここで兜に溶けた':''}`);
  if (jump>1.8 && prev>30) break;
  prev=n;
}
