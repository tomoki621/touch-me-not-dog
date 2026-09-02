// 頭から突き出しているものを全部数える。上向きだけでなく横向きも拾うため、
// 高さではなく「頭の中心からの距離」の極大を探す。
import fs from 'node:fs';
const b=fs.readFileSync(process.argv[2]);
let off=12,j=null,binOff=0;
while(off<b.length){const l=b.readUInt32LE(off),t=b.readUInt32LE(off+4);
 if(t===0x4E4F534A) j=JSON.parse(b.slice(off+8,off+8+l).toString('utf8'));
 else if(t===0x004E4942) binOff=off+8; off+=8+l;}
const pr=j.meshes[0].primitives[0],A=j.accessors[pr.attributes.POSITION];
const V=j.bufferViews[A.bufferView],o0=binOff+(V.byteOffset||0)+(A.byteOffset||0),st=V.byteStride||12;
const P=[];for(let i=0;i<A.count;i++){const o=o0+i*st;
 P.push([b.readFloatLE(o),b.readFloatLE(o+4),b.readFloatLE(o+8)]);}
const H=P.filter(p=>p[1]>1.22);
const C=H.reduce((u,p)=>[u[0]+p[0]/H.length,u[1]+p[1]/H.length,u[2]+p[2]/H.length],[0,0,0]);
console.log('頭の中心', C.map(v=>v.toFixed(3)).join(', '), ' 頂点', H.length);
const R=(p)=>Math.hypot(p[0]-C[0],p[1]-C[1],p[2]-C[2]);
const NB=parseFloat(process.argv[3]??"0.13");
const tips=[];
for(const p of H){ let top=true;
  for(const q of H){ if(q===p) continue;
    if(Math.hypot(q[0]-p[0],q[1]-p[1],q[2]-p[2])<NB && R(q)>R(p)+1e-5){top=false;break;} }
  if(top) tips.push(p); }
const merged=[];
for(const t of tips.sort((u,v)=>R(v)-R(u))){
  if(merged.some(m=>Math.hypot(m[0]-t[0],m[1]-t[1],m[2]-t[2])<NB)) continue;
  merged.push(t); }
console.log('突き出し', merged.length,'か所');
for(const m of merged){
  const d=[(m[0]-C[0])/R(m),(m[1]-C[1])/R(m),(m[2]-C[2])/R(m)];
  console.log(`  x=${m[0].toFixed(3).padStart(6)} y=${m[1].toFixed(3)} z=${m[2].toFixed(3).padStart(6)}  中心から${R(m).toFixed(3)}  向き(${d.map(v=>v.toFixed(2)).join(', ')})`);
}
