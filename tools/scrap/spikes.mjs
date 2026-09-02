// 頭全体を強く均したものと引き算して、突き出している所を全部出す。
// 中央値との比較は太い膨らみに強く、細く尖ったとげに弱かった。
// 均した面からの「はみ出し」なら、細くても太くても向きが横でも拾える。
import fs from 'node:fs';
const b=fs.readFileSync(process.argv[2]);
const ITER=parseInt(process.argv[3]??'80',10);
const TH=parseFloat(process.argv[4]??'0.020');
let off=12,j=null,binOff=0;
while(off<b.length){const l=b.readUInt32LE(off),t=b.readUInt32LE(off+4);
 if(t===0x4E4F534A) j=JSON.parse(b.slice(off+8,off+8+l).toString('utf8'));
 else if(t===0x004E4942) binOff=off+8; off+=8+l;}
const pr=j.meshes[0].primitives[0],A=j.accessors[pr.attributes.POSITION];
const V=j.bufferViews[A.bufferView],o0=binOff+(V.byteOffset||0)+(A.byteOffset||0),st=V.byteStride||12;
const N=A.count,P=[];
for(let i=0;i<N;i++){const o=o0+i*st;P.push([b.readFloatLE(o),b.readFloatLE(o+4),b.readFloatLE(o+8)]);}
const IA=j.accessors[pr.indices],IV=j.bufferViews[IA.bufferView];
const isz=IA.componentType===5125?4:2,io=binOff+(IV.byteOffset||0)+(IA.byteOffset||0),ist=IV.byteStride||isz;
const idx=[];for(let i=0;i<IA.count;i++) idx.push(isz===4?b.readUInt32LE(io+i*ist):b.readUInt16LE(io+i*ist));
const rep=new Map(),root=new Int32Array(N);
for(let i=0;i<N;i++){const k=P[i].map(v=>Math.round(v*20000)).join(',');
 if(!rep.has(k))rep.set(k,i); root[i]=rep.get(k);}
const adj=new Map();
const link=(u,v)=>{if(!adj.has(u))adj.set(u,new Set());adj.get(u).add(v);};
for(let t=0;t<idx.length;t+=3){const a=root[idx[t]],c=root[idx[t+1]],d=root[idx[t+2]];
 link(a,c);link(c,a);link(c,d);link(d,c);link(d,a);link(a,d);}

const Y0=1.15;
const move=new Set();
for(let i=0;i<N;i++) if(P[i][1]>Y0) move.add(root[i]);
const cur=new Map(); for(const v of move) cur.set(v,P[v].slice());
for(let it=0;it<ITER;it++){
  const nx=new Map();
  for(const v of move){ let s=[0,0,0],n=0;
    for(const u of (adj.get(v)||[])){const q=cur.get(u)||P[u];s[0]+=q[0];s[1]+=q[1];s[2]+=q[2];n++;}
    const c=cur.get(v);
    nx.set(v, n?[c[0]+0.6*(s[0]/n-c[0]),c[1]+0.6*(s[1]/n-c[1]),c[2]+0.6*(s[2]/n-c[2])]:c); }
  for(const [v,q] of nx) cur.set(v,q);
}
const H=P.filter(p=>p[1]>1.22);
const C=H.reduce((u,p)=>[u[0]+p[0]/H.length,u[1]+p[1]/H.length,u[2]+p[2]/H.length],[0,0,0]);
const outs=[];
for(const v of move){
  const p=P[v],q=cur.get(v);
  const d=[p[0]-C[0],p[1]-C[1],p[2]-C[2]],L=Math.hypot(...d);
  const push=((p[0]-q[0])*d[0]+(p[1]-q[1])*d[1]+(p[2]-q[2])*d[2])/L;   // 外向きのはみ出し
  if(process.env.DENT ? (push < -TH) : (push > TH)) outs.push({p,push:Math.abs(push)});
}
outs.sort((a,b2)=>b2.push-a.push);
const cl=[];
for(const o of outs){
  const f=cl.find(c=>Math.hypot(c.p[0]-o.p[0],c.p[1]-o.p[1],c.p[2]-o.p[2])<0.14);
  if(f){f.n++;continue;}
  cl.push({p:o.p,push:o.push,n:1});
}
console.log(`均し${ITER}回、しきい値${TH}   はみ出し ${outs.length}頂点 → ${cl.length}か所`);
for(const c of cl) console.log(`  x=${c.p[0].toFixed(3).padStart(6)} y=${c.p[1].toFixed(3)} z=${c.p[2].toFixed(3).padStart(6)}  はみ出し+${c.push.toFixed(3)}  ${c.n}頂点`);
