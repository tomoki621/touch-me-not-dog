// 兜のとげを消す。
// 球や円錐を当てる方式は、平らな天井と横へ張り出す部分を同じ形で扱えず、
// 必ずどこかに裾が残った。周りの形を仮定しない「均す」方式にする。
//   1) とげの先端から面をたどって領域を取る（耳と残すとげは入れない）
//   2) 領域の縁は動かさない
//   3) 中を Taubin 平滑化で均す。出っ張りだけが消え、周りの丸みは残る
// 引数は消したいとげの先端「x,y,z」。
import fs from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
const src=process.argv[2], dst=process.argv[3];
const b=fs.readFileSync(src);
let off=12,j=null,binOff=0,binLen=0;
while(off<b.length){const l=b.readUInt32LE(off),t=b.readUInt32LE(off+4);
 if(t===0x4E4F534A) j=JSON.parse(b.slice(off+8,off+8+l).toString('utf8'));
 else if(t===0x004E4942){binOff=off+8;binLen=l;} off+=8+l;}
const out=Buffer.from(b);
const pr=j.meshes[0].primitives[0],A=j.accessors[pr.attributes.POSITION];
const V=j.bufferViews[A.bufferView],base=binOff+(V.byteOffset||0)+(A.byteOffset||0);
const st=V.byteStride||12,N=A.count;
const getP=(i)=>{const o=base+i*st;return [out.readFloatLE(o),out.readFloatLE(o+4),out.readFloatLE(o+8)];};
const setP=(i,v)=>{const o=base+i*st;out.writeFloatLE(v[0],o);out.writeFloatLE(v[1],o+4);out.writeFloatLE(v[2],o+8);};
const P=[];for(let i=0;i<N;i++)P.push(getP(i));
const uvA=pr.attributes.TEXCOORD_0;
let uvo=0,uvst=0,UV=null;
if(uvA!==undefined){ const UA=j.accessors[uvA],UB=j.bufferViews[UA.bufferView];
  uvo=binOff+(UB.byteOffset||0)+(UA.byteOffset||0); uvst=UB.byteStride||8;
  UV=[]; for(let i=0;i<N;i++) UV.push([out.readFloatLE(uvo+i*uvst), out.readFloatLE(uvo+i*uvst+4)]); }
const setUV=(i,v)=>{ if(!UV) return; out.writeFloatLE(v[0],uvo+i*uvst); out.writeFloatLE(v[1],uvo+i*uvst+4); };

const IA=j.accessors[pr.indices],IV=j.bufferViews[IA.bufferView];
const isz=IA.componentType===5125?4:2,io=binOff+(IV.byteOffset||0)+(IA.byteOffset||0),ist=IV.byteStride||isz;
const idx=new Array(IA.count);
for(let i=0;i<IA.count;i++) idx[i]= isz===4?out.readUInt32LE(io+i*ist):out.readUInt16LE(io+i*ist);
const rep=new Map(),root=new Int32Array(N);
for(let i=0;i<N;i++){const k=P[i].map(v=>Math.round(v*20000)).join(',');
 if(!rep.has(k))rep.set(k,i); root[i]=rep.get(k);}
const adj=new Map();
const link=(u,v)=>{if(!adj.has(u))adj.set(u,new Set());adj.get(u).add(v);};
for(let t=0;t<idx.length;t+=3){const a=root[idx[t]],c=root[idx[t+1]],d=root[idx[t+2]];
 link(a,c);link(c,a);link(c,d);link(d,c);link(d,a);link(a,d);}

// 絵の色で耳・顔（薄紫）と兜（青）を見分ける。耳は座標ではなく色で守る。
// 座標で切ると、その線の上にとげの裾が残ってしまう。
let isBlue=()=>true;
{
  const uvA=pr.attributes.TEXCOORD_0, mat=pr.material;
  if(uvA!==undefined && mat!==undefined){
    const UA=j.accessors[uvA],UB=j.bufferViews[UA.bufferView];
    const uo=binOff+(UB.byteOffset||0)+(UA.byteOffset||0), ust=UB.byteStride||8;
    const m=j.materials[mat], ti=m.pbrMetallicRoughness&&m.pbrMetallicRoughness.baseColorTexture;
    if(ti){
      const im=j.images[j.textures[ti.index].source], bvv=j.bufferViews[im.bufferView];
      const img=await loadImage(out.slice(binOff+(bvv.byteOffset||0), binOff+(bvv.byteOffset||0)+bvv.byteLength));
      const cv=createCanvas(img.width,img.height); cv.getContext('2d').drawImage(img,0,0);
      const D=cv.getContext('2d').getImageData(0,0,img.width,img.height).data;
      const yes=new Uint8Array(N), no=new Uint8Array(N);
      for(let i=0;i<N;i++){
        const o=uo+i*ust, u=out.readFloatLE(o), v=out.readFloatLE(o+4);
        let x=Math.round(u*img.width)%img.width; if(x<0)x+=img.width;
        let y=Math.round(v*img.height)%img.height; if(y<0)y+=img.height;
        const s0=(x+y*img.width)*4;
        if(D[s0+2] > D[s0]+45) yes[root[i]]=1; else no[root[i]]=1;
      }
      isBlue=(k)=>yes[k]===1 && no[k]===0;   // 縫い目で片方だけ青い所は触らない
      let n=0; for(let i=0;i<N;i++) if(yes[i]&&!no[i]) n++;
      console.log(`兜（青）と判定した頂点 ${n}`);
    }
  }
}

const ITER=parseInt(process.env.ITER||'40',10);
const KILL=process.argv.slice(4).map(s=>s.split(',').map(Number));
const KEEP=[[-0.001,1.682,0.060],[0.002,1.604,0.475]];  // 残す中央のとげ
const EARX=0.40;    // これより外は耳。触らない。色で守ると領域が細切れになり
                    // かえって耳際に段差が残ったので、座標で切る。
const RR=parseFloat(process.env.RR||'0.26');      // 先端からこの距離まで
const KEEPR=parseFloat(process.env.KEEPR||'0.15'); // 残すとげのまわりこの距離は触らない
const dist=(p,q)=>Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]);

let total=0; const moved=new Set();
for(const T of KILL){
  let tip=-1,bd=1e9;
  for(let i=0;i<N;i++){const d=dist(P[i],T); if(d<bd){bd=d;tip=root[i];}}
  const ok=(v)=>{
    const p=P[v];
    if(dist(p,T)>RR) return false;
    // 0.40 より内側は色を見ない（見ると青と薄紫の境目で領域が細切れになる）。
    // 外側は耳なので、青いところだけ触る。ここで一律に切ると、その線の上に
    // とげの裾が残って尖る。
    if(Math.abs(p[0])>EARX && !isBlue(v)) return false;
    for(const k of KEEP) if(dist(p,k)<KEEPR) return false;
    return true;
  };
  const region=new Set([tip]),stack=[tip];
  while(stack.length){const u=stack.pop();
    for(const v of (adj.get(u)||[])) if(!region.has(v)&&ok(v)){region.add(v);stack.push(v);}}
  if(region.size<20){ console.log(`  (${T}) 領域が取れない`); continue; }

  const rim=new Set();
  for(const v of region){ for(const u of (adj.get(v)||[])) if(!region.has(u)){ rim.add(v); break; } }
  const inner=[...region].filter(v=>!rim.has(v));
  if(inner.length<10){ console.log(`  (${T}) 中身が薄い`); continue; }

  // 素直な平滑化。とげ（細かい凹凸）は速く消え、全体のへこみはゆっくり進むので、
  // 回数を絞ればとげだけ取れる。回しすぎると領域全体がへこむ。
  const cur=new Map(); for(const v of region) cur.set(v,P[v].slice());
  const pass=(k)=>{
    const nx=new Map();
    for(const v of inner){
      let s=[0,0,0],n=0;
      for(const u of (adj.get(v)||[])){ const q=cur.get(u)||P[u]; s[0]+=q[0];s[1]+=q[1];s[2]+=q[2];n++; }
      if(!n){ nx.set(v,cur.get(v)); continue; }
      const c=cur.get(v);
      nx.set(v,[c[0]+k*(s[0]/n-c[0]), c[1]+k*(s[1]/n-c[1]), c[2]+k*(s[2]/n-c[2])]);
    }
    for(const [v,q] of nx) cur.set(v,q);
  };
  for(let it=0; it<ITER; it++) pass(0.55);

  let n=0,maxD=0;
  for(let i=0;i<N;i++){
    const q=cur.get(root[i]); if(!q||rim.has(root[i])) continue;
    maxD=Math.max(maxD,dist(P[i],q));
    setP(i,q); P[i]=q.slice();
    n++;
  }
  total+=n; for(const v of region) moved.add(v);
  console.log(`  とげ (${T.map(v=>v.toFixed(3)).join(', ')})  領域${region.size} 縁${rim.size}  均した頂点${n} 最大${maxD.toFixed(3)}`);
}

// 形が変わったので法線を張り直す。古いままだと平らな所がとげの頃の陰影で
// 描かれ、三角に見える。ずれは平均20度、最大94度あった。
{
  const nA=pr.attributes.NORMAL;
  if(nA!==undefined && moved.size){
    const NA=j.accessors[nA],NB=j.bufferViews[NA.bufferView];
    const no=binOff+(NB.byteOffset||0)+(NA.byteOffset||0), nst=NB.byteStride||12;
    const touched=new Set();
    for(const v of moved){ touched.add(v); for(const u of (adj.get(v)||[])) touched.add(u); }
    const acc=new Map();
    for(let t=0;t<idx.length;t+=3){
      const i0=idx[t],i1=idx[t+1],i2=idx[t+2];
      if(!touched.has(root[i0])&&!touched.has(root[i1])&&!touched.has(root[i2])) continue;
      const a=getP(i0),b2=getP(i1),c=getP(i2);
      const u=[b2[0]-a[0],b2[1]-a[1],b2[2]-a[2]],w=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
      const fn=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]];
      for(const i of [i0,i1,i2]){ const k=root[i];
        const s0=acc.get(k)||[0,0,0]; acc.set(k,[s0[0]+fn[0],s0[1]+fn[1],s0[2]+fn[2]]); }
    }
    let fixed=0;
    for(let i=0;i<N;i++){ const v=acc.get(root[i]); if(!v) continue;
      const L=Math.hypot(v[0],v[1],v[2]); if(L<1e-12) continue;
      out.writeFloatLE(v[0]/L,no+i*nst); out.writeFloatLE(v[1]/L,no+i*nst+4); out.writeFloatLE(v[2]/L,no+i*nst+8);
      fixed++; }
    console.log('法線を張り直した頂点:', fixed);
  }
}

let lo=[1e9,1e9,1e9],hi=[-1e9,-1e9,-1e9];
for(let i=0;i<N;i++){const p=getP(i);for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}}
A.min=lo;A.max=hi;
const nj=Buffer.from(JSON.stringify(j),'utf8');
const jp=Buffer.concat([nj,Buffer.alloc((4-(nj.length%4))%4,0x20)]);
const bin=out.slice(binOff,binOff+binLen);
const head=Buffer.alloc(12);head.write('glTF',0);head.writeUInt32LE(2,4);
head.writeUInt32LE(12+8+jp.length+8+bin.length,8);
const jh=Buffer.alloc(8);jh.writeUInt32LE(jp.length,0);jh.writeUInt32LE(0x4E4F534A,4);
const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004E4942,4);
fs.writeFileSync(dst,Buffer.concat([head,jh,jp,bh,bin]));
console.log('均した頂点 合計:',total,'→',dst);
