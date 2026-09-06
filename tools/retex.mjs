// 配るモデルの絵だけを、原寸から貼り直す。形には触らない。
//
//   node tools/retex.mjs <配るglb> <原寸glb> <出力> [上限=2048]
//
// 減量したあとに形を手で細工した模型がある（エルフの本体は tools/fist.mjs で
// 拳をメッシュに焼き込んである）。そういうものを絵のために原寸から作り直すと、
// 細工がまるごと消えて握りが変わる。UV は間引きでも変わらないので、絵だけを
// 原寸から取り直して差し替える。
//
// 大きさが同じでも意味はある。JPEG は焼くたびに劣化するので、1024 に落とした
// ものを 2048 へ引き伸ばしても戻らない。元の絵から改めて縮める。
import { NodeIO } from '@gltf-transform/core';
import Jimp from 'jimp';
import fs from 'node:fs';

const [dist, orig, out, max = '2048'] = process.argv.slice(2);
if (!dist || !orig || !out){
  console.error('使い方: node tools/retex.mjs <配るglb> <原寸glb> <出力> [上限=2048]');
  process.exit(1);
}
const lim = parseInt(max, 10);
const io = new NodeIO();
const d = await io.read(dist), o = await io.read(orig);

// 貼り直すのは基本色だけ。法線・金属・遮蔽は減量の時点で外してある。
const base = (doc) => doc.getRoot().listMaterials()
  .map(m => m.getBaseColorTexture()).find(Boolean);
const dt = base(d), ot = base(o);
if (!dt || !ot){ console.error('基本色の絵が見つからない'); process.exit(1); }

const img = await Jimp.read(Buffer.from(ot.getImage()));
const before = img.bitmap.width;
if (Math.max(img.bitmap.width, img.bitmap.height) > lim) img.scaleToFit(lim, lim);
const buf = await img.quality(86).getBufferAsync(Jimp.MIME_JPEG);
const was = (await Jimp.read(Buffer.from(dt.getImage()))).bitmap.width;
dt.setImage(new Uint8Array(buf)).setMimeType('image/jpeg');
console.log('  絵 ' + was + ' -> ' + img.bitmap.width + '（原寸 ' + before + ' から取り直し）');

await io.write(out, d);
console.log('  -> ' + out + '  ' + (fs.statSync(out).size / 1048576).toFixed(2) + ' MB');
