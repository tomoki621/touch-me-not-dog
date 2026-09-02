// とげを消した所は、絵そのものが帽子より濃く塗られている。
// UV をなじませても濃い島の中を回るだけなので、絵の方を塗り替える。
//   1) 動いた頂点の三角形を UV 空間に塗って型紙を作る
//   2) すぐ外側の帽子の色を目標色にする
//   3) 型紙の中を目標色で塗り、境目はぼかす
import fs from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
const [,, orig, src, dst] = process.argv;

function read(f){ const b=fs.readFileSync(f); let off=12,j=null,bo=0,bl=0;
  while(off<b.length){const l=b.readUInt32LE(off),t=b.readUInt32LE(off+4);
    if(t===0x4E4F534A)j=JSON.parse(b.slice(off+8,off+8+l).toString('utf8'));
    else if(t===0x004E4942){bo=off+8;bl=l;} off+=8+l;}
  return {b,j,bo,bl}; }
const O=read(orig), M=read(src);
const pr=M.j.meshes[0].primitives[0];
const rd=(src2,ai,nc)=>{const a=src2.j.accessors[ai],v=src2.j.bufferViews[a.bufferView];
  const o0=src2.bo+(v.byteOffset||0)+(a.byteOffset||0),st=v.byteStride||nc*4,o=[];
  for(let i=0;i<a.count;i++){const p=o0+i*st,q=[];for(let k=0;k<nc;k++)q.push(src2.b.readFloatLE(p+k*4));o.push(q);}
  return o;};
const P=rd(M,pr.attributes.POSITION,3), UV=rd(M,pr.attributes.TEXCOORD_0,2);
const PO=rd(O,O.j.meshes[0].primitives[0].attributes.POSITION,3);
const IA=M.j.accessors[pr.indices],IV=M.j.bufferViews[IA.bufferView];
const isz=IA.componentType===5125?4:2,io=M.bo+(IV.byteOffset||0)+(IA.byteOffset||0),ist=IV.byteStride||isz;
const I=[];for(let i=0;i<IA.count;i++)I.push(isz===4?M.b.readUInt32LE(io+i*ist):M.b.readUInt16LE(io+i*ist));

const moved=new Uint8Array(P.length);
let nm=0;
for(let i=0;i<P.length;i++){
  if(Math.hypot(P[i][0]-PO[i][0],P[i][1]-PO[i][1],P[i][2]-PO[i][2])>1e-5){ moved[i]=1; nm++; } }
console.log('動いた頂点:', nm);

const m=M.j.materials[pr.material], ti=m.pbrMetallicRoughness.baseColorTexture;
const imgDef=M.j.images[M.j.textures[ti.index].source], bvv=M.j.bufferViews[imgDef.bufferView];
const png=M.b.slice(M.bo+(bvv.byteOffset||0), M.bo+(bvv.byteOffset||0)+bvv.byteLength);
const img=await loadImage(png);
const W=img.width,H=img.height;
const cv=createCanvas(W,H), g=cv.getContext('2d');
g.drawImage(img,0,0);
const id=g.getImageData(0,0,W,H), D=id.data;
console.log(`絵 ${W}x${H}`);

// 型紙
const mask=new Uint8Array(W*H);
const tri=(a,b2,c)=>{
  const x0=Math.max(0,Math.floor(Math.min(a[0],b2[0],c[0]))), x1=Math.min(W-1,Math.ceil(Math.max(a[0],b2[0],c[0])));
  const y0=Math.max(0,Math.floor(Math.min(a[1],b2[1],c[1]))), y1=Math.min(H-1,Math.ceil(Math.max(a[1],b2[1],c[1])));
  const den=(b2[1]-c[1])*(a[0]-c[0])+(c[0]-b2[0])*(a[1]-c[1]); if(Math.abs(den)<1e-9) return;
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
    const l1=((b2[1]-c[1])*(x-c[0])+(c[0]-b2[0])*(y-c[1]))/den;
    const l2=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;
    if(l1<-0.02||l2<-0.02||1-l1-l2<-0.02) continue;
    mask[x+y*W]=1; } };
const uvpx=(i)=>[UV[i][0]*W, UV[i][1]*H];
for(let t=0;t<I.length;t+=3){
  const k=moved[I[t]]+moved[I[t+1]]+moved[I[t+2]];
  if(k<2) continue;
  tri(uvpx(I[t]),uvpx(I[t+1]),uvpx(I[t+2])); }
let mc=0; for(const v of mask) if(v) mc++;
console.log('塗る範囲:', mc, 'ピクセル');

// 目標色は「3次元で隣にある兜」の色にする。UV 上の隣は別の部位のことが
// あり、そこから色を広げても濃いままだった。
const col=(i)=>{ let x=Math.round(UV[i][0]*W)%W; if(x<0)x+=W;
  let y=Math.round(UV[i][1]*H)%H; if(y<0)y+=H;
  const o=(x+y*W)*4; return [D[o],D[o+1],D[o+2]]; };
const mv=[]; for(let i=0;i<P.length;i++) if(moved[i]) mv.push(i);
const T=[0,0,0]; let na=0;
for(let i=0;i<P.length;i++){
  if(moved[i]||P[i][1]<1.40) continue;
  const c=col(i); if(!(c[2]>c[0]+45)) continue;          // 兜（青）だけ
  for(const k of mv){
    if(Math.hypot(P[i][0]-P[k][0],P[i][1]-P[k][1],P[i][2]-P[k][2])<0.06){
      T[0]+=c[0];T[1]+=c[1];T[2]+=c[2];na++; break; } }
}
if(na<20){ console.error('目標色を決められない'); process.exit(1); }
for(let k=0;k<3;k++) T[k]=Math.round(T[k]/na);
console.log('目標色:', T, `(隣接する兜 ${na}頂点から)`);

for(let i=0;i<W*H;i++){ if(!mask[i]) continue; const o=i*4;
  D[o]=T[0]; D[o+1]=T[1]; D[o+2]=T[2]; }

// 境目をならす
const grow=(src2,r)=>{ const o=new Uint8Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){ if(!src2[x+y*W]) continue;
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      const nx=x+dx,ny=y+dy; if(nx<0||ny<0||nx>=W||ny>=H) continue; o[nx+ny*W]=1; } }
  return o; };
const band=grow(mask,3);
for(let pass=0;pass<4;pass++){
  const cp=Uint8ClampedArray.from(D);
  for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){ const i=x+y*W; if(!band[i]) continue;
    for(let k=0;k<3;k++){ let s0=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) s0+=cp[((x+dx)+(y+dy)*W)*4+k];
      D[i*4+k]=s0/9; } }
}
g.putImageData(id,0,0);
const mime=imgDef.mimeType||'image/png';
const outPng = mime==='image/jpeg' ? cv.toBuffer('image/jpeg',{quality:92}) : cv.toBuffer('image/png');
console.log(`絵を書き出し ${mime} ${(outPng.length/1024).toFixed(0)} KB (元 ${(png.length/1024).toFixed(0)} KB)`);

// BIN を作り直す。末尾に足すだけだと古い絵が residue として残り、
// ファイルがその分だけ太る。
const pad=(n)=>(4-(n%4))%4;
const j2=JSON.parse(JSON.stringify(M.j));
const imgIdx=M.j.textures[ti.index].source;
const parts=[]; let cur2=0;
j2.bufferViews.forEach((v,k)=>{
  const isImg = j2.images[imgIdx].bufferView===k;
  const bytes = isImg ? outPng
    : M.b.slice(M.bo+(v.byteOffset||0), M.bo+(v.byteOffset||0)+v.byteLength);
  const p=pad(cur2);
  if(p) { parts.push(Buffer.alloc(p)); cur2+=p; }
  v.byteOffset=cur2; v.byteLength=bytes.length;
  parts.push(bytes); cur2+=bytes.length;
});
const tail=pad(cur2); if(tail) parts.push(Buffer.alloc(tail));
const newBin=Buffer.concat(parts);
j2.buffers[0].byteLength=newBin.length;
const nj=Buffer.from(JSON.stringify(j2),'utf8');
const jp=Buffer.concat([nj,Buffer.alloc(pad(nj.length),0x20)]);
const head=Buffer.alloc(12);head.write('glTF',0);head.writeUInt32LE(2,4);
head.writeUInt32LE(12+8+jp.length+8+newBin.length,8);
const jh=Buffer.alloc(8);jh.writeUInt32LE(jp.length,0);jh.writeUInt32LE(0x4E4F534A,4);
const bh=Buffer.alloc(8);bh.writeUInt32LE(newBin.length,0);bh.writeUInt32LE(0x004E4942,4);
fs.writeFileSync(dst,Buffer.concat([head,jh,jp,bh,newBin]));
console.log('書き出し:',dst);
