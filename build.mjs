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

const bundle = fs.readFileSync('app.js');
const hash = createHash('sha256').update(bundle).digest('hex').slice(0, 10);

fs.writeFileSync('build.json', JSON.stringify({ h: hash }));

console.log('app.js ' + (bundle.length/1048576).toFixed(2) + ' MB  hash=' + hash);
