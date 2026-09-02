import fs from 'node:fs';
function L(f){const b=fs.readFileSync(f);let off=12,j=null,bo=0;
 while(off<b.length){const l=b.readUInt32LE(off),t=b.readUInt32LE(off+4);
  if(t===0x4E4F534A)j=JSON.parse(b.slice(off+8,off+8+l).toString('utf8'));
  else if(t===0x004E4942)bo=off+8; off+=8+l;}
 const pr=j.meshes[0].primitives[0];
 const rd=(ai,nc)=>{const a=j.accessors[ai],v=j.bufferViews[a.bufferView];
  const o0=bo+(v.byteOffset||0)+(a.byteOffset||0),st=v.byteStride||nc*4,o=[];
  for(let i=0;i<a.count;i++){const p=o0+i*st,q=[];for(let k=0;k<nc;k++)q.push(b.readFloatLE(p+k*4));o.push(q);}return o;};
 const IA=j.accessors[pr.indices],IV=j.bufferViews[IA.bufferView];
 const isz=IA.componentType===5125?4:2,io=bo+(IV.byteOffset||0)+(IA.byteOffset||0),ist=IV.byteStride||isz;
 const I=[];for(let i=0;i<IA.count;i++)I.push(isz===4?b.readUInt32LE(io+i*ist):b.readUInt16LE(io+i*ist));
 return {P:rd(pr.attributes.POSITION,3),NN:rd(pr.attributes.NORMAL,3),I};}
const M=L(process.argv[2]);
const rep=new Map(),root=new Int32Array(M.P.length);
for(let i=0;i<M.P.length;i++){const k=M.P[i].map(v=>Math.round(v*20000)).join(',');
 if(!rep.has(k))rep.set(k,i);root[i]=rep.get(k);}
const acc=new Map();
for(let t=0;t<M.I.length;t+=3){
 const a=M.P[M.I[t]],b2=M.P[M.I[t+1]],c=M.P[M.I[t+2]];
 const u=[b2[0]-a[0],b2[1]-a[1],b2[2]-a[2]],w=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
 const fn=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]];
 for(const i of [M.I[t],M.I[t+1],M.I[t+2]]){const k=root[i];
  const s=acc.get(k)||[0,0,0];acc.set(k,[s[0]+fn[0],s[1]+fn[1],s[2]+fn[2]]);}}
const bad=[];
for(let i=0;i<M.P.length;i++){
 if(M.P[i][1]<1.30) continue;
 const v=acc.get(root[i]); if(!v) continue;
 const L2=Math.hypot(v[0],v[1],v[2]); if(L2<1e-12) continue;
 const n=M.NN[i],nl=Math.hypot(n[0],n[1],n[2])||1;
 const d=Math.acos(Math.max(-1,Math.min(1,(v[0]/L2*n[0]+v[1]/L2*n[1]+v[2]/L2*n[2])/nl)))*180/Math.PI;
 if(d>25) bad.push({p:M.P[i],d});}
bad.sort((a,b2)=>b2.d-a.d);
const cl=[];
for(const o of bad){const f=cl.find(c=>Math.hypot(c.p[0]-o.p[0],c.p[1]-o.p[1],c.p[2]-o.p[2])<0.10);
 if(f){f.n++;continue;} cl.push({p:o.p,d:o.d,n:1});}
console.log(process.argv[2]+'  ずれ25度超: '+bad.length+'頂点 → '+cl.length+'か所');
for(const c of cl.slice(0,8)) console.log('  x='+c.p[0].toFixed(3).padStart(6)+' y='+c.p[1].toFixed(3)+' z='+c.p[2].toFixed(3).padStart(6)+'  '+c.d.toFixed(0)+'度  '+c.n+'頂点');
