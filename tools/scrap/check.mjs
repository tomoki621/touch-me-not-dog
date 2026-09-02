// 動かした頂点について、法線が古いままか／絵の色が周りと違うかを測る。
import fs from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
function load(f){ const b=fs.readFileSync(f); let off=12,j=null,bo=0;
  while(off<b.length){const l=b.readUInt32LE(off),t=b.readUInt32LE(off+4);
    if(t===0x4E4F534A)j=JSON.parse(b.slice(off+8,off+8+l).toString('utf8'));
    else if(t===0x004E4942)bo=off+8; off+=8+l;}
  const pr=j.meshes[0].primitives[0];
  const rd=(ai,nc)=>{const a=j.accessors[ai],v=j.bufferViews[a.bufferView];
    const o0=bo+(v.byteOffset||0)+(a.byteOffset||0),st=v.byteStride||nc*4,o=[];
    for(let i=0;i<a.count;i++){const p=o0+i*st,q=[];for(let k=0;k<nc;k++)q.push(b.readFloatLE(p+k*4));o.push(q);}
    return o;};
  const P=rd(pr.attributes.POSITION,3);
  const NN=pr.attributes.NORMAL!==undefined?rd(pr.attributes.NORMAL,3):null;
  const UVv=pr.attributes.TEXCOORD_0!==undefined?rd(pr.attributes.TEXCOORD_0,2):null;
  const IA=j.accessors[pr.indices],IV=j.bufferViews[IA.bufferView];
  const isz=IA.componentType===5125?4:2,io=bo+(IV.byteOffset||0)+(IA.byteOffset||0),ist=IV.byteStride||isz;
  const I=[];for(let i=0;i<IA.count;i++)I.push(isz===4?b.readUInt32LE(io+i*ist):b.readUInt16LE(io+i*ist));
  return {j,b,bo,P,NN,UV:UVv,I,pr};
}
const O=load(process.argv[2]), M=load(process.argv[3]);
// 動いた頂点
const moved=[]; for(let i=0;i<O.P.length;i++){
  const d=Math.hypot(O.P[i][0]-M.P[i][0],O.P[i][1]-M.P[i][1],O.P[i][2]-M.P[i][2]);
  if(d>1e-5) moved.push(i); }
console.log('動いた頂点:', moved.length);

// 1) いまの形から法線を計算し直し、保存されている法線と比べる
const acc=new Map();
for(let t=0;t<M.I.length;t+=3){
  const a=M.P[M.I[t]],b2=M.P[M.I[t+1]],c=M.P[M.I[t+2]];
  const u=[b2[0]-a[0],b2[1]-a[1],b2[2]-a[2]],w=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
  const fn=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]];
  for(const i of [M.I[t],M.I[t+1],M.I[t+2]]){const s=acc.get(i)||[0,0,0];
    acc.set(i,[s[0]+fn[0],s[1]+fn[1],s[2]+fn[2]]);}
}
let sum=0,worst=0,cnt=0;
for(const i of moved){ const v=acc.get(i); if(!v) continue;
  const L=Math.hypot(...v); if(L<1e-12) continue;
  const n=M.NN[i], nl=Math.hypot(...n)||1;
  const dot=(v[0]/L*n[0]+v[1]/L*n[1]+v[2]/L*n[2])/nl;
  const deg=Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI;
  sum+=deg; worst=Math.max(worst,deg); cnt++; }
console.log(`法線のずれ: 平均 ${(sum/cnt).toFixed(1)}度  最大 ${worst.toFixed(1)}度`);

// 2) 動いた頂点の色と、その周りの動いていない兜の色を比べる
const m=M.j.materials[M.pr.material];
const ti=m.pbrMetallicRoughness.baseColorTexture;
const im=M.j.images[M.j.textures[ti.index].source], bvv=M.j.bufferViews[im.bufferView];
const img=await loadImage(M.b.slice(M.bo+(bvv.byteOffset||0), M.bo+(bvv.byteOffset||0)+bvv.byteLength));
const cv=createCanvas(img.width,img.height); cv.getContext('2d').drawImage(img,0,0);
const D=cv.getContext('2d').getImageData(0,0,img.width,img.height).data;
const col=(i)=>{const t=M.UV[i];
  let x=Math.round(t[0]*img.width)%img.width; if(x<0)x+=img.width;
  let y=Math.round(t[1]*img.height)%img.height; if(y<0)y+=img.height;
  const o=(x+y*img.width)*4; return [D[o],D[o+1],D[o+2]];};
const avg=(list)=>{const s=[0,0,0]; for(const i of list){const c=col(i);s[0]+=c[0]/list.length;s[1]+=c[1]/list.length;s[2]+=c[2]/list.length;} return s.map(v=>Math.round(v));};
const movedSet=new Set(moved);
const around=[]; for(let i=0;i<M.P.length;i++){
  if(movedSet.has(i)||M.P[i][1]<1.42) continue;
  for(const k of moved){ if(Math.hypot(M.P[i][0]-M.P[k][0],M.P[i][1]-M.P[k][1],M.P[i][2]-M.P[k][2])<0.06){ around.push(i); break; } } }
console.log('動いた所の色     ', avg(moved));
console.log('その周りの兜の色 ', avg(around), `(${around.length}頂点)`);
