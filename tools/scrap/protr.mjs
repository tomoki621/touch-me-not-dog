// 周りより出っ張っている頂点を洗い出す。
// 各頂点について、近所の頂点の「頭の中心からの距離」の中央値と比べる。
// 中央値より外に出ていれば出っ張り。向きに関係なく拾える。
import fs from 'node:fs';
const b=fs.readFileSync(process.argv[2]);
const NB=parseFloat(process.argv[3]??'0.13');
const TH=parseFloat(process.argv[4]??'0.020');
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
const R=(p)=>Math.hypot(p[0]-C[0],p[1]-C[1],p[2]-C[2]);
// 格子に入れて近所を速く引く
const G=new Map(), cell=NB;
const key=(p)=>[Math.floor(p[0]/cell),Math.floor(p[1]/cell),Math.floor(p[2]/cell)].join(',');
for(const p of H){ const k=key(p); if(!G.has(k))G.set(k,[]); G.get(k).push(p); }
const near=(p)=>{ const o=[]; const c=[Math.floor(p[0]/cell),Math.floor(p[1]/cell),Math.floor(p[2]/cell)];
 for(let a=-1;a<=1;a++)for(let b2=-1;b2<=1;b2++)for(let c2=-1;c2<=1;c2++){
  const g=G.get([c[0]+a,c[1]+b2,c[2]+c2].join(',')); if(!g) continue;
  for(const q of g) if(Math.hypot(q[0]-p[0],q[1]-p[1],q[2]-p[2])<NB) o.push(q); }
 return o; };
const outs=[];
for(const p of H){
  const nb=near(p); if(nb.length<8) continue;
  const rs=nb.map(R).sort((a,b2)=>a-b2);
  const med=rs[Math.floor(rs.length/2)];
  const d=R(p)-med;
  if(d>TH) outs.push({p,d});
}
outs.sort((a,b2)=>b2.d-a.d);
// 近いものはまとめる
const cl=[];
for(const o of outs){
  const f=cl.find(c=>Math.hypot(c.p[0]-o.p[0],c.p[1]-o.p[1],c.p[2]-o.p[2])<0.16);
  if(f){ f.n++; continue; }
  cl.push({p:o.p,d:o.d,n:1});
}
console.log(`頭の中心 ${C.map(v=>v.toFixed(3)).join(', ')}   出っ張り判定 ${outs.length}頂点 → ${cl.length}か所（しきい値 ${TH}）`);
for(const c of cl) console.log(`  x=${c.p[0].toFixed(3).padStart(6)} y=${c.p[1].toFixed(3)} z=${c.p[2].toFixed(3).padStart(6)}  周りより+${c.d.toFixed(3)}  ${c.n}頂点`);
