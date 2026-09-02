// GLB の中身を一覧する。骨・モーション・メッシュ・テクスチャ・箱。
import fs from 'node:fs';
const f = process.argv[2];
const b = fs.readFileSync(f);
let off = 12, j = null, binOff = 0, binLen = 0;
while (off < b.length){ const l=b.readUInt32LE(off), t=b.readUInt32LE(off+4);
  if (t===0x4E4F534A) j=JSON.parse(b.slice(off+8,off+8+l).toString('utf8'));
  else if (t===0x004E4942){ binOff=off+8; binLen=l; } off += 8+l; }
const mb = n => (n/1048576).toFixed(2)+' MB';
console.log('== ' + f + '  ' + mb(b.length) + ' (bin ' + mb(binLen) + ')');
console.log('nodes: ' + (j.nodes||[]).length + '  meshes: ' + (j.meshes||[]).length +
  '  skins: ' + (j.skins||[]).length + '  materials: ' + (j.materials||[]).length +
  '  textures: ' + (j.textures||[]).length + '  animations: ' + (j.animations||[]).length);
let tri = 0;
for (const m of j.meshes||[]) for (const p of m.primitives)
  tri += (p.indices!==undefined ? j.accessors[p.indices].count : j.accessors[p.attributes.POSITION].count)/3;
console.log('三角形: ' + Math.round(tri));
for (const [i,im] of (j.images||[]).entries()){
  const v = im.bufferView!==undefined ? j.bufferViews[im.bufferView] : null;
  console.log('  image['+i+'] ' + (im.mimeType||'?') + ' ' + (v? mb(v.byteLength):'(uri)') + ' ' + (im.name||''));
}
for (const [i,m] of (j.materials||[]).entries()){
  const p = m.pbrMetallicRoughness||{};
  console.log('  mat['+i+'] ' + (m.name||'') +
    '  base=' + (p.baseColorTexture? 'tex'+p.baseColorTexture.index : JSON.stringify(p.baseColorFactor||[])) +
    (m.normalTexture?' +normal':'') + (p.metallicRoughnessTexture?' +mr':'') +
    (m.emissiveTexture?' +emissive':'') + (m.occlusionTexture?' +ao':''));
}
for (const [i,a] of (j.animations||[]).entries()){
  let maxT = 0;
  for (const s of a.samplers){ const acc=j.accessors[s.input]; if (acc.max) maxT=Math.max(maxT, acc.max[0]); }
  console.log('  anim['+i+'] ' + (a.name||'') + '  ' + a.channels.length + 'ch  ' + maxT.toFixed(2) + 's');
}
// 箱（素の姿勢、ワールド行列なし）
for (const [i,m] of (j.meshes||[]).entries()){
  for (const p of m.primitives){
    const acc = j.accessors[p.attributes.POSITION];
    console.log('  mesh['+i+'] ' + (m.name||'') + '  頂点' + acc.count +
      '  min=' + (acc.min||[]).map(v=>v.toFixed(3)) + '  max=' + (acc.max||[]).map(v=>v.toFixed(3)) +
      '  attrs=' + Object.keys(p.attributes).join(','));
  }
}
if (process.argv[3] === 'bones'){
  const nodes = j.nodes||[];
  const parent = new Array(nodes.length).fill(-1);
  nodes.forEach((n,i)=> (n.children||[]).forEach(c=> parent[c]=i));
  const skin = (j.skins||[])[0];
  const jointSet = new Set(skin? skin.joints : []);
  const walk = (i, d) => {
    const n = nodes[i];
    console.log('  '.repeat(d) + (jointSet.has(i)?'*':' ') + (n.name||('node'+i)) +
      (n.mesh!==undefined? '  [mesh '+n.mesh+']':'') +
      (n.translation? '  t='+n.translation.map(v=>v.toFixed(3)):'') +
      (n.scale? '  s='+n.scale.map(v=>v.toFixed(3)):''));
    for (const c of n.children||[]) walk(c, d+1);
  };
  console.log('-- 階層 (* = 骨)');
  for (let i=0;i<nodes.length;i++) if (parent[i] === -1) walk(i, 0);
}
