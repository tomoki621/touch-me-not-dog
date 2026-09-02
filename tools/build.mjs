// バンドルして、その中身のハッシュを build.json に書く。各ページはそれを読んで
// 参照に付ける。中身が変われば参照先が自動で変わるので、URL は常に同じで済む。
//
//   node tools/build.mjs        （リポジトリ直下から。道はすべてそこからの相対）
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const h = (b) => createHash("sha256").update(b).digest("hex").slice(0, 10);

// モデルの版番号。作り直しても古いのが配られる事故を防ぐため、中身から作って埋める。
const glbHash = h(Buffer.concat([
  'models/rouise.glb', 'models/sword.glb', 'models/shield.glb',
  'models/elf.glb', 'models/elfsword.glb',
  'models/exodia.glb',
].map((f) => fs.readFileSync(f))));

const esbuild = './node_modules/@esbuild/win32-x64/esbuild.exe';
const bundleOf = (src, out) => execFileSync(esbuild, [
  src, '--bundle', '--format=iife', '--target=es2018',
  '--outfile=' + out, '--minify',
  '--define:__GLBV__=' + JSON.stringify(JSON.stringify(glbHash)),
  '--alias:fs=./src/empty.js', '--alias:util=./src/empty.js',
  '--alias:path=./src/empty.js', '--alias:crypto=./src/empty.js'
], { stdio: 'inherit' });

// ページはそれぞれ別の URL。共通部分は持たない。読むモデルも学習データも違う。
const PAGES = [
  { name: 'ルイーズ',     src: 'src/app.js',    js: 'app.js',    css: 'app.css',    k: 'js',  kc: 'css' },
  { name: 'エルフの剣士', src: 'src/elf.js',    js: 'elf.js',    css: 'elf.css',    k: 'elf', kc: 'elfCss' },
  { name: 'エクゾディア', src: 'src/exodia.js', js: 'exodia.js', css: 'exodia.css', k: 'ex',  kc: 'exCss' },
];

for (const p of PAGES) bundleOf(p.src, p.js);

// CSS の波括弧が釣り合っているかを機械的に確かめる。一つ余るだけで以降の
// 指定が全部無効になり、起動画面が押せなくなる事故を起こした。
for (const p of PAGES){
  const buf = fs.readFileSync(p.css);
  let d = 0, bad = 0;
  for (const c of buf.toString()){
    if (c === "{") d++;
    else if (c === "}"){ d--; if (d < 0){ bad++; d = 0; } }
  }
  if (d !== 0 || bad !== 0){
    console.error(p.css + " の波括弧が不正: 過不足=" + d + " 余分な閉じ=" + bad);
    process.exit(1);
  }
}

const out = {};
for (const p of PAGES){
  const js = fs.readFileSync(p.js), css = fs.readFileSync(p.css);
  out[p.k] = h(js); out[p.kc] = h(css);
  console.log(p.name.padEnd(7) + ' ' + p.js.padEnd(10) +
              (js.length / 1048576).toFixed(2) + ' MB  hash=' + out[p.k]);
}
fs.writeFileSync("build.json", JSON.stringify(out));
console.log('モデル hash=' + glbHash);

// 学習データが揃っているかも見る。無いページは開いた瞬間に詰まるので、
// 「作るのを忘れた」をここで気づけるようにしておく。
for (const [page, mind] of [['index.html', 'targets.mind'], ['elf.html', 'elf.mind']]){
  if (!fs.existsSync(mind))
    console.warn('※ ' + mind + ' がまだ無い（' + page + '）。compile.html をブラウザで開いて作る。');
}
