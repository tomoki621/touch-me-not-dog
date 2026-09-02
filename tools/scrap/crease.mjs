// 面と面が鋭く折れている所を探す。鋭い折れ目は影で黒い線に見える。
import fs from 'node:fs';
function L(f){const b=fs.readFileSync(f);let off=12,j=null,bo=0;
 while(off<b.length){const l=b.readUInt32LE(off),t=b.readUInt32LE(off+4);
  if(t===0x4E4F534A)j=JSON.parse(b.slice(off+8,off+8+l).toString('utf8'));
  else if(t===0x004E4942)bo=off+8; off+=8+l;}
 const pr=j.meshes[0].primitives[0];
 const a=j.accessors[pr.attributes.POSITION],v=j.bufferViews[a.bufferView];
 const o0=bo+(v.byteOffset||0)+(a.byteOffset||0),st=v.byteStride||12,P=[];
 for(let i=0;i<a.count;i++){const p=o0+i*st;P.push([b.readFloatLE(p),b.readFloatLE(p+4),b.readFloatLE(p+8)]);}
 const IA=j.accessors[pr.indices],IV=j.bufferViews[IA.bufferView];
 const isz=IA.componentType===5125?4:2,io=bo+(IV.byteOffset||0)+(IA.byteOffset||0),ist=IV.byteStride||isz;
 const I=[];for(let i=0;i<IA.count;i++)I.push(isz===4?b.readUInt32LE(io+i*ist):b.readUInt16LE(io+i*ist));
 return {P,I};}
const M=L(process.argv[2]);
const TH=parseFloat(process.argv[3]??'55');
const rep=new Map(),root=new Int32Array(M.P.length);
for(let i=0;i<M.P.length;i++){const k=M.P[i].map(v=>Math.round(v*20000)).join(',');
 if(!rep.has(k))rep.set(k,i);root[i]=rep.get(k);}
const fn=[],edge=new Map();
for(let t=0;t<M.I.length;t+=3){
 const a=M.P[M.I[t]],b2=M.P[M.I[t+1]],c=M.P[M.I[t+2]];
 const u=[b2[0]-a[0],b2[1]-a[1],b2[2]-a[2]],w=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
 let n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]];
 const L2=Math.hypot(n[0],n[1],n[2])||1; n=[n[0]/L2,n[1]/L2,n[2]/L2];
 const f=t/3; fn.push(n);
 const v=[root[M.I[t]],root[M.I[t+1]],root[M.I[t+2]]];
 for(let e=0;e<3;e++){const x=v[e],y=v[(e+1)%3];const k=x<y?x+'_'+y:y+'_'+x;
  if(!edge.has(k))edge.set(k,[]); edge.get(k).push(f);}}
const bad=[];
for(const [k,fs2] of edge){
 if(fs2.length!==2) continue;
 const A=fn[fs2[0]],B=fn[fs2[1]];
 const d=Math.acos(Math.max(-1,Math.min(1,A[0]*B[0]+A[1]*B[1]+A[2]*B[2])))*180/Math.PI;
 if(d<TH) continue;
 const i=Number(k.split('_')[0]);
 if(M.P[i][1]<1.40) continue;
 bad.push({p:M.P[i],d});}
bad.sort((a,b2)=>b2.d-a.d);
const cl=[];
for(const o of bad){const f=cl.find(c=>Math.hypot(c.p[0]-o.p[0],c.p[1]-o.p[1],c.p[2]-o.p[2])<0.09);
 if(f){f.n++;f.d=Math.max(f.d,o.d);continue;} cl.push({p:o.p,d:o.d,n:1});}
console.log(process.argv[2]+'  '+TH+'度以上の折れ: '+bad.length+'辺 → '+cl.length+'か所');
for(const c of cl.slice(0,14)) console.log('  x='+c.p[0].toFixed(3).padStart(6)+' y='+c.p[1].toFixed(3)+' z='+c.p[2].toFixed(3).padStart(6)+'  '+c.d.toFixed(0)+'度  '+c.n+'辺');
