// エグゾディアの減量。
// Meshy の出力は 83MB あるが、メッシュは 19,091 三角形しかない。
// 中身はほぼ 8192x8192 の PNG テクスチャ 1枚（77.7MB）なので、そこだけ落とせば済む。
// 16個すべてが同じメッシュ・同じ骨・モーション違いなので、本体は 1つだけ作り、
// 残りはメッシュとテクスチャを捨てて軌道だけ残す。
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';
import Jimp from 'jimp';
import fs from 'node:fs';

const SRC = 'エグゾディア/Meshy_AI_Ancient_Chain_Golem_biped_Animation_';
const io = new NodeIO();

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

// 本体。テクスチャを縮めて JPEG にする。法線・金属は数センチの置物には効かない。
async function body(name, dst, maxTex){
  const doc = await io.read(SRC + name + '_withSkin.glb');
  const root = doc.getRoot();
  for (const m of root.listMaterials()){
    m.setNormalTexture(null);
    m.setMetallicRoughnessTexture(null);
    m.setOcclusionTexture(null);
    m.setEmissiveTexture(null);
    m.setEmissiveFactor([0, 0, 0]);
    m.setMetallicFactor(0.0);
    m.setRoughnessFactor(0.75);
  }
  await doc.transform(prune(), dedup());
  for (const t of root.listTextures()){
    const img = await Jimp.read(Buffer.from(t.getImage()));
    const before = img.bitmap.width;
    if (Math.max(img.bitmap.width, img.bitmap.height) > maxTex) img.scaleToFit(maxTex, maxTex);
    const buf = await img.quality(88).getBufferAsync(Jimp.MIME_JPEG);
    t.setImage(new Uint8Array(buf)).setMimeType('image/jpeg');
    console.log('  tex ' + before + ' -> ' + img.bitmap.width + '  ' + mb(buf.length));
  }
  await io.write(dst, doc);
  console.log('  ' + dst + '  ' + mb(fs.statSync(dst).size));
}

// 軌道だけ。メッシュ・材質・テクスチャ・スキンを捨てると、骨の動きだけが残る。
// 骨は軌道から参照されているので prune では落ちない。
async function anim(name, dst){
  const doc = await io.read(SRC + name + '_withSkin.glb');
  const root = doc.getRoot();
  for (const n of root.listNodes()) n.setMesh(null);
  for (const s of root.listSkins()) s.dispose();
  for (const m of root.listMeshes()) m.dispose();
  for (const m of root.listMaterials()) m.dispose();
  for (const t of root.listTextures()) t.dispose();
  // 位置の軌道は捨てる。拾うと原点から歩き出して、画面の真ん中から外れる。
  for (const a of root.listAnimations())
    for (const c of a.listChannels())
      if (c.getTargetPath() === 'translation') c.dispose();
  await doc.transform(prune(), dedup());
  await io.write(dst, doc);
  console.log('  ' + dst + '  ' + (fs.statSync(dst).size / 1024).toFixed(0) + ' KB');
}

fs.mkdirSync('models/exanim', { recursive: true });
console.log('本体:');
await body('Idle_10', 'models/exodia.glb', 2048);
console.log('モーション:');
await anim('mage_soell_cast_3', 'models/exanim/summon.glb');
await anim('Kung_Fu_Punch',     'models/exanim/punch.glb');
await anim('Idle_10',           'models/exanim/idle.glb');
