// モデルの減量。
//
//   node tools/slim.mjs <元> <先> [テクスチャの上限=1024] [三角形の目標]
//
// 数センチの置物に法線・金属・遮蔽のマップは効かないので落とす。
// 発光テクスチャを外すなら強さも 0 にする。白 1.0 のまま残すと全体が真っ白に光る。
// 三角形の目標を渡すと、そこまで間引く（Meshy の小物は 100万三角形を超える）。
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, weld, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import Jimp from 'jimp';
import fs from 'node:fs';

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

const triCount = (root) => {
  let n = 0;
  for (const m of root.listMeshes())
    for (const p of m.listPrimitives()){
      const i = p.getIndices();
      n += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3;
    }
  return Math.round(n);
};

async function slim(src, dst, maxTex, targetTri){
  const io = new NodeIO();
  const doc = await io.read(src);
  const root = doc.getRoot();

  for (const m of root.listMaterials()){
    m.setNormalTexture(null);
    m.setMetallicRoughnessTexture(null);
    m.setOcclusionTexture(null);
    m.setEmissiveTexture(null);
    m.setEmissiveFactor([0, 0, 0]);
    m.setMetallicFactor(0.0);
    m.setRoughnessFactor(0.8);
  }

  // 間引きは接線が残っていると崩れる。マップを落とした後なので接線は要らない。
  if (targetTri){
    const before = triCount(root);
    for (const m of root.listMeshes())
      for (const p of m.listPrimitives())
        if (p.getAttribute('TANGENT')) p.setAttribute('TANGENT', null);
    // 縫い目で同じ位置の頂点が別番号になっている。溶接しないと隙間だらけに割れる。
    await doc.transform(weld());
    await doc.transform(simplify({
      simplifier: MeshoptSimplifier,
      ratio: Math.min(1, targetTri / before),
      error: 0.02,          // 形の許容ずれ。置物なので大きめに取ってよい。
      lockBorder: true,     // 開いた縁が引きつって穴になるのを防ぐ
    }));
    console.log('  三角形 ' + before + ' -> ' + triCount(root));
  }

  await doc.transform(prune(), dedup());

  for (const t of root.listTextures()){
    const img = await Jimp.read(Buffer.from(t.getImage()));
    const before = img.bitmap.width;
    if (Math.max(img.bitmap.width, img.bitmap.height) > maxTex) img.scaleToFit(maxTex, maxTex);
    const buf = await img.quality(86).getBufferAsync(Jimp.MIME_JPEG);
    t.setImage(new Uint8Array(buf)).setMimeType('image/jpeg');
    console.log('  絵 ' + before + ' -> ' + img.bitmap.width + '  ' + mb(buf.length));
  }

  await io.write(dst, doc);
  console.log('  -> ' + dst + '  ' + mb(fs.statSync(dst).size));
}

const a = process.argv.slice(2);
if (a.length < 2){ console.error('使い方: node tools/slim.mjs <元> <先> [上限=1024] [三角形の目標]'); process.exit(1); }
await slim(a[0], a[1], parseInt(a[2] || '1024', 10), a[3] ? parseInt(a[3], 10) : 0);
