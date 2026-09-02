// 掌の面の法線を、骨の空間で測る道具。src/flame.js の FLAME_PALM はこれの出力。
// 手の骨に重みが乗った頂点はほぼ一枚の板（指を広げた手のひら）なので、
// 分散がいちばん小さい向き＝掌の法線。
import fs from 'node:fs';
import * as THREE from 'three';
const b = fs.readFileSync('models/exodia.glb');
let off=12,j=null,bo=0;
while(off<b.length){const l=b.readUInt32LE(off),t=b.readUInt32LE(off+4);
 if(t===0x4E4F534A)j=JSON.parse(b.slice(off+8,off+8+l).toString('utf8'));
 else if(t===0x004E4942)bo=off+8; off+=8+l;}
const acc=(idx)=>{const a=j.accessors[idx],v=j.bufferViews[a.bufferView];
 const nc={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type];
 const sz={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[a.componentType];
 const st=v.byteStride||nc*sz, base=bo+(v.byteOffset||0)+(a.byteOffset||0), out=[];
 for(let i=0;i<a.count;i++){const o=base+i*st,q=[];
  for(let k=0;k<nc;k++){const p=o+k*sz;
   q.push(a.componentType===5126?b.readFloatLE(p):a.componentType===5123?b.readUInt16LE(p):
          a.componentType===5125?b.readUInt32LE(p):b.readUInt8(p));}
  out.push(nc===1?q[0]:q);} return out;};
const N=j.nodes;
const objs=N.map(n=>{const o=new THREE.Object3D();o.name=n.name||'';
 if(n.translation)o.position.fromArray(n.translation);
 if(n.rotation)o.quaternion.fromArray(n.rotation);
 if(n.scale)o.scale.fromArray(n.scale);return o;});
N.forEach((n,i)=>(n.children||[]).forEach(c=>objs[i].add(objs[c])));
const world=new THREE.Object3D(); objs.forEach(o=>{if(!o.parent)world.add(o);});
world.updateMatrixWorld(true);
const prim=j.meshes[0].primitives[0];
const POS=acc(prim.attributes.POSITION), JO=acc(prim.attributes.JOINTS_0), WE=acc(prim.attributes.WEIGHTS_0);
const skin=j.skins[0], IBM=acc(skin.inverseBindMatrices);
const mats=skin.joints.map((n,i)=>new THREE.Matrix4().multiplyMatrices(objs[n].matrixWorld,new THREE.Matrix4().fromArray(IBM[i])));
const jointOf=(name)=>skin.joints.findIndex(n=>N[n].name===name);
const v=new THREE.Vector3(), tmp=new THREE.Vector3();
for (const hand of ['RightHand','LeftHand']){
  const ji=jointOf(hand);
  const pts=[];
  for(let i=0;i<POS.length;i++){
    let w=0; for(let k=0;k<4;k++) if(JO[i][k]===ji) w+=WE[i][k];
    if(w<0.6) continue;
    tmp.set(0,0,0);
    for(let k=0;k<4;k++){const ww=WE[i][k]; if(!ww)continue;
      v.fromArray(POS[i]).applyMatrix4(mats[JO[i][k]]); tmp.addScaledVector(v,ww);}
    pts.push(tmp.clone());
  }
  const c=new THREE.Vector3(); pts.forEach(p=>c.add(p)); c.multiplyScalar(1/pts.length);
  // 共分散
  let cxx=0,cxy=0,cxz=0,cyy=0,cyz=0,czz=0;
  for(const p of pts){const x=p.x-c.x,y=p.y-c.y,z=p.z-c.z;
    cxx+=x*x;cxy+=x*y;cxz+=x*z;cyy+=y*y;cyz+=y*z;czz+=z*z;}
  const n1=pts.length; cxx/=n1;cxy/=n1;cxz/=n1;cyy/=n1;cyz/=n1;czz/=n1;
  const tr=cxx+cyy+czz;
  // (tr*I - C) の最大固有ベクトル ＝ C の最小固有ベクトル
  let e=new THREE.Vector3(0.3,0.6,0.74).normalize();
  for(let it=0;it<200;it++){
    const x=e.x,y=e.y,z=e.z;
    e.set(tr*x-(cxx*x+cxy*y+cxz*z), tr*y-(cxy*x+cyy*y+cyz*z), tr*z-(cxz*x+cyz*y+czz*z)).normalize();
  }
  // 前（+Z）を向く側を掌とする。素の姿勢では掌はおおむね前を向いている。
  if (e.z<0) e.negate();
  const bone=objs.find(o=>o.name===hand);
  const q=new THREE.Quaternion(); bone.getWorldQuaternion(q);
  const inv=q.clone().invert();
  const local=e.clone().applyQuaternion(inv).normalize();
  // 指の向き。手首から手の重心へ。手は指のぶんだけ一方向に伸びているので、
  // これがそのまま「指がどちらを向いているか」になる。
  const wrist=new THREE.Vector3(); bone.getWorldPosition(wrist);
  const fw=c.clone().sub(wrist).normalize();
  const fl=fw.clone().applyQuaternion(inv).normalize();
  const f=(v)=>'('+v.x.toFixed(3)+','+v.y.toFixed(3)+','+v.z.toFixed(3)+')';
  console.log(hand, '頂点', pts.length);
  console.log('   掌の法線  世界', f(e), ' 骨の空間', f(local));
  console.log('   指の向き  世界', f(fw), ' 骨の空間', f(fl));
}
