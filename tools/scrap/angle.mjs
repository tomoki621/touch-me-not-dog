// 好きな角度から描き出す。写真と同じ見え方を再現して比べるための道具。
// 使い方: node angle.mjs <glb> <out.png> <横回転度> <上下度> [yMin]
import fs from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
const [,, file, outPng, yawD, pitD, yMinS] = process.argv;
const yaw=(+yawD)*Math.PI/180, pit=(+pitD)*Math.PI/180, yMin=parseFloat(yMinS??'-9');
const b=fs.readFileSync(file);
let off=12,j=null,bin=null;
while(off<b.length){const l=b.readUInt32LE(off),t=b.readUInt32LE(off+4);
 if(t===0x4E4F534A) j=JSON.parse(b.slice(off+8,off+8+l).toString('utf8'));
 else if(t===0x004E4942) bin=b.slice(off+8,off+8+l); off+=8+l;}
const prim=j.meshes[0].primitives[0];
function acc(i){ const a=j.accessors[i], bv=j.bufferViews[a.bufferView];
 const base=(bv.byteOffset||0)+(a.byteOffset||0);
 const nc={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
 const sz={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[a.componentType];
 const stride=bv.byteStride||nc*sz; const o=[];
 for(let k=0;k<a.count;k++){const p0=base+k*stride,v=[];
  for(let c=0;c<nc;c++){const p=p0+c*sz;
   v.push(a.componentType===5126?bin.readFloatLE(p):a.componentType===5123?bin.readUInt16LE(p)
        :a.componentType===5125?bin.readUInt32LE(p):bin.readUInt8(p));}
  o.push(nc===1?v[0]:v);} return o; }
const P=acc(prim.attributes.POSITION), I=acc(prim.indices);
const UV=prim.attributes.TEXCOORD_0!==undefined?acc(prim.attributes.TEXCOORD_0):null;
// アプリ（three.js）は頂点の法線で陰影をつける。面の法線で描いていると、
// 法線が古いままでも気づけない。同じ条件にする。
const NRM=prim.attributes.NORMAL!==undefined?acc(prim.attributes.NORMAL):null;
let TEX=null;
if (UV && prim.material!==undefined){
  const m=j.materials[prim.material], ti=m.pbrMetallicRoughness&&m.pbrMetallicRoughness.baseColorTexture;
  if (ti){ const im=j.images[j.textures[ti.index].source], v=j.bufferViews[im.bufferView];
    const img=await loadImage(bin.slice(v.byteOffset||0,(v.byteOffset||0)+v.byteLength));
    const c2=createCanvas(img.width,img.height); c2.getContext('2d').drawImage(img,0,0);
    TEX={w:img.width,h:img.height,d:c2.getContext('2d').getImageData(0,0,img.width,img.height).data}; } }

const cy=Math.cos(yaw), sy=Math.sin(yaw), cp=Math.cos(pit), sp=Math.sin(pit);
const rot=(p)=>{ const x=p[0]*cy - p[2]*sy, z=p[0]*sy + p[2]*cy;
  return [x, p[1]*cp - z*sp, p[1]*sp + z*cp]; };
const Q=P.map(rot);
let lo=[9,9,9],hi=[-9,-9,-9];
for(let i=0;i<P.length;i++){ if(P[i][1]<yMin) continue;
  for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],Q[i][k]);hi[k]=Math.max(hi[k],Q[i][k]);} }
const span=Math.max(hi[0]-lo[0],hi[1]-lo[1])||1;
const mid=[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2];
const S=760,PAD=18;
const cv=createCanvas(S,S), g=cv.getContext('2d');
const img=g.createImageData(S,S), d=img.data;
for(let i=0;i<S*S;i++){d[i*4]=20;d[i*4+1]=18;d[i*4+2]=28;d[i*4+3]=255;}
const zb=new Float32Array(S*S).fill(-1e9);
const hitP=new Array(S*S).fill(null);   // 画面の点から 3D 位置を引くため
const px=(q)=>[S/2+(q[0]-mid[0])/span*(S-PAD*2), S/2-(q[1]-mid[1])/span*(S-PAD*2)];
for(let t=0;t<I.length;t+=3){
  const ia=I[t],ib=I[t+1],ic=I[t+2];
  if(P[ia][1]<yMin&&P[ib][1]<yMin&&P[ic][1]<yMin) continue;
  const a=Q[ia],b2=Q[ib],c=Q[ic];
  const ux=b2[0]-a[0],uy=b2[1]-a[1],uz=b2[2]-a[2],wx=c[0]-a[0],wy=c[1]-a[1],wz=c[2]-a[2];
  let nx=uy*wz-uz*wy,ny=uz*wx-ux*wz,nz=ux*wy-uy*wx;
  const nl=Math.hypot(nx,ny,nz)||1; nx/=nl;ny/=nl;nz/=nl;
  const lit=Math.max(0.20,Math.abs(nx*0.35+ny*0.55+nz*0.76));
  const A=px(a),B=px(b2),C=px(c);
  const den=(B[1]-C[1])*(A[0]-C[0])+(C[0]-B[0])*(A[1]-C[1]);
  if(Math.abs(den)<1e-9) continue;
  const x0=Math.max(0,Math.floor(Math.min(A[0],B[0],C[0]))), x1=Math.min(S-1,Math.ceil(Math.max(A[0],B[0],C[0])));
  const y0=Math.max(0,Math.floor(Math.min(A[1],B[1],C[1]))), y1=Math.min(S-1,Math.ceil(Math.max(A[1],B[1],C[1])));
  const ta=UV&&UV[ia],tb=UV&&UV[ib],tc=UV&&UV[ic];
  const na=NRM&&NRM[ia],nb=NRM&&NRM[ib],nc2=NRM&&NRM[ic];
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
    const l1=((B[1]-C[1])*(x-C[0])+(C[0]-B[0])*(y-C[1]))/den;
    const l2=((C[1]-A[1])*(x-C[0])+(A[0]-C[0])*(y-C[1]))/den;
    const l3=1-l1-l2; if(l1<0||l2<0||l3<0) continue;
    const z=l1*a[2]+l2*b2[2]+l3*c[2], k=x+y*S;
    if(z<=zb[k]) continue; zb[k]=z; const q=k*4;
    hitP[k]=[l1*P[ia][0]+l2*P[ib][0]+l3*P[ic][0],
             l1*P[ia][1]+l2*P[ib][1]+l3*P[ic][1],
             l1*P[ia][2]+l2*P[ib][2]+l3*P[ic][2]];
    let sh0=lit;
    if(na){ // 頂点の法線を混ぜて、視点の向きへ回してから当てる
      let vx=l1*na[0]+l2*nb[0]+l3*nc2[0], vy=l1*na[1]+l2*nb[1]+l3*nc2[1], vz=l1*na[2]+l2*nb[2]+l3*nc2[2];
      const rx=vx*cy-vz*sy, rz0=vx*sy+vz*cy;
      const ry=vy*cp-rz0*sp, rz=vy*sp+rz0*cp;
      const L2=Math.hypot(rx,ry,rz)||1;
      sh0=Math.max(0.20, Math.abs((rx*0.35+ry*0.55+rz*0.76)/L2));
    }
    if(TEX&&ta){ const uu=l1*ta[0]+l2*tb[0]+l3*tc[0], vv=l1*ta[1]+l2*tb[1]+l3*tc[1];
      let tx=Math.round(uu*TEX.w)%TEX.w; if(tx<0)tx+=TEX.w;
      let ty=Math.round(vv*TEX.h)%TEX.h; if(ty<0)ty+=TEX.h;
      const s0=(tx+ty*TEX.w)*4, sh=process.env.FLAT?1:(0.45+sh0*0.8);
      d[q]=Math.min(255,TEX.d[s0]*sh); d[q+1]=Math.min(255,TEX.d[s0+1]*sh); d[q+2]=Math.min(255,TEX.d[s0+2]*sh);
    } else { d[q]=Math.min(255,210*sh0+30); d[q+1]=Math.min(255,200*sh0+26); d[q+2]=Math.min(255,245*sh0+34); }
  }
}
g.putImageData(img,0,0);
// 印を付ける（環境変数 MARKS="x,y,z;x,y,z;..." ）。どの突起か言い当てるため。
if(process.env.MARKS){
  const ms=process.env.MARKS.split(';').map(t=>t.split(',').map(Number));
  g.font='bold 18px sans-serif'; g.lineWidth=2.5;
  ms.forEach((m,i)=>{ const q=px(rot(m));
    g.strokeStyle='#ff3b30'; g.beginPath(); g.arc(q[0],q[1],13,0,Math.PI*2); g.stroke();
    g.fillStyle='#ff3b30'; g.fillText(String(i+1), q[0]+16, q[1]-8); });
}
if(process.env.PICK){
  for(const t of process.env.PICK.split(';')){
    const [x,y]=t.split(',').map(Number);
    const h=hitP[Math.round(x)+Math.round(y)*S];
    console.log(`  画面(${x},${y}) → ` + (h?`x=${h[0].toFixed(3)} y=${h[1].toFixed(3)} z=${h[2].toFixed(3)}`:'なにもない'));
  }
}
fs.writeFileSync(outPng, cv.toBuffer('image/png'));
console.log('描き出しました:', outPng);
