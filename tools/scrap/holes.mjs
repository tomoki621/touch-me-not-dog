// 縁になっている辺（三角形1枚しか使っていない辺）を数える。増えていたら穴。
import fs from 'node:fs';
function load(f){ const b=fs.readFileSync(f); let off=12,j=null,binOff=0;
  while(off<b.length){ const l=b.readUInt32LE(off),t=b.readUInt32LE(off+4);
    if(t===0x4E4F534A) j=JSON.parse(b.slice(off+8,off+8+l).toString('utf8'));
    else if(t===0x004E4942) binOff=off+8; off+=8+l; }
  const pr=j.meshes[0].primitives[0], A=j.accessors[pr.attributes.POSITION];
  const V=j.bufferViews[A.bufferView], o0=binOff+(V.byteOffset||0)+(A.byteOffset||0), st=V.byteStride||12;
  const P=[]; for(let i=0;i<A.count;i++){const o=o0+i*st;
    P.push([b.readFloatLE(o),b.readFloatLE(o+4),b.readFloatLE(o+8)]);}
  const IA=j.accessors[pr.indices], IV=j.bufferViews[IA.bufferView];
  const isz=IA.componentType===5125?4:2, io=binOff+(IV.byteOffset||0)+(IA.byteOffset||0), ist=IV.byteStride||isz;
  const idx=[]; for(let i=0;i<IA.count;i++) idx.push(isz===4?b.readUInt32LE(io+i*ist):b.readUInt16LE(io+i*ist));
  return {P,idx};
}
function report(f){ const {P,idx}=load(f);
  const rep=new Map(), root=new Int32Array(P.length);
  for(let i=0;i<P.length;i++){ const k=P[i].map(v=>Math.round(v*20000)).join(',');
    if(!rep.has(k)) rep.set(k,i); root[i]=rep.get(k); }
  const cnt=new Map(), deg=[];
  for(let t=0;t<idx.length;t+=3){ const v=[root[idx[t]],root[idx[t+1]],root[idx[t+2]]];
    if(v[0]===v[1]||v[1]===v[2]||v[0]===v[2]){ deg.push(t); continue; }
    for(let e=0;e<3;e++){ const a=v[e],c=v[(e+1)%3];
      const k=a<c?a+'_'+c:c+'_'+a; cnt.set(k,(cnt.get(k)||0)+1); } }
  let border=0; for(const n of cnt.values()) if(n===1) border++;
  console.log(`${f}  縁の辺=${border}  面積ゼロの三角形=${deg.length}  三角形=${idx.length/3}`);
}
report(process.argv[2]); report(process.argv[3]);
