// カードの学習データ（.mind）を作る……はずだったもの。
//
// 【今は通らない】mind-ar の特徴点抽出は WebGL の独自カーネル（BinomialFilter）を
// 使うので、node の cpu バックエンドでは「Kernel not registered」で落ちる。
// 学習は compile.html をブラウザで開いて作る。こちらは、tfjs 側に WebGL の
// backend を差せるようになったときのために残してある。
//
import { createCanvas, loadImage, Image, ImageData } from '@napi-rs/canvas';
import fs from 'fs';

// mind-ar の compiler はブラウザ前提なので、必要な DOM だけ生やして通す
global.Image = Image;
global.ImageData = ImageData;
global.HTMLImageElement = Image;
global.HTMLCanvasElement = createCanvas(1,1).constructor;
global.document = {
  createElement: (t) => t === 'canvas' ? createCanvas(1,1) : {},
  createElementNS: () => ({}),
};
global.window = global;

// 使い方: node tools/mkmind.mjs <カードの画像> <出す .mind>
//   node tools/mkmind.mjs 素材/カード/ルイーズ.jpg      targets.mind
//   node tools/mkmind.mjs 素材/カード/エルフの剣士.png  elf.mind
// ページごとに .mind を分けてある。片方を作り直しても、もう片方に響かない。
const src = process.argv[2] || '素材/カード/ルイーズ.jpg';
const dst = process.argv[3] || 'targets.mind';

const { Compiler } = await import('mind-ar/dist/mindar-image.prod.js');
const img = await loadImage(src);
console.log('画像:', src, img.width + 'x' + img.height);

const compiler = new Compiler();
await compiler.compileImageTargets([img], (p) => {
  if (Math.round(p) % 10 === 0) process.stdout.write(' ' + Math.round(p) + '%');
});
const buf = await compiler.exportData();
fs.writeFileSync(dst, Buffer.from(buf));
console.log('\n' + dst + ' を書き出しました:', (buf.byteLength/1024).toFixed(0) + ' KB');
