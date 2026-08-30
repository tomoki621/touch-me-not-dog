// バンドルして、その中身のハッシュを index.html の参照に埋める。
// 中身が変われば参照先が自動で変わるので、URL は常に同じで済む。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const esbuild = './node_modules/@esbuild/win32-x64/esbuild.exe';
execFileSync(esbuild, [
  'src/app.js', '--bundle', '--format=iife', '--target=es2018',
  '--outfile=app.js', '--minify',
  '--alias:fs=./src/empty.js', '--alias:util=./src/empty.js',
  '--alias:path=./src/empty.js', '--alias:crypto=./src/empty.js'
], { stdio: 'inherit' });

const bundle = fs.readFileSync("app.js");
const css = fs.readFileSync("app.css");
const h = (b) => createHash("sha256").update(b).digest("hex").slice(0, 10);
const hash = h(bundle), cssHash = h(css);

// CSS の波括弧が釣り合っているかを機械的に確かめる。一つ余るだけで以降の
// 指定が全部無効になり、起動画面が押せなくなる事故を起こした。
{
  let d = 0, bad = 0;
  for (const c of css.toString()) { if (c === "{") d++; else if (c === "}") { d--; if (d < 0) { bad++; d = 0; } } }
  if (d !== 0 || bad !== 0) { console.error("CSS の波括弧が不正: 過不足=" + d + " 余分な閉じ=" + bad); process.exit(1); }
}

fs.writeFileSync("build.json", JSON.stringify({ js: hash, css: cssHash }));

console.log('app.js ' + (bundle.length/1048576).toFixed(2) + ' MB  hash=' + hash);
