// 画面なしでアプリを丸ごと走らせて、例外が出ないかを確かめる道具。
//
//   node tools/sim.mjs [exodia|elf|app]
//
// ブラウザが無いので、DOM と WebGLRenderer は偽物を差し込む（glstub.mjs）。
// three は本物のままなので、骨も行列も姿勢も実物が走る。
// WebXR は無いので、3ページとも貼り付け表示の側へ落ちる。そこを通す。
// 塗らないので絵は出ないが、「押したら止まる」たぐいの事故はここで全部出る。
// 実際、掌の位置を出す関数が消し忘れた変数を掴んでいて、技を押した最初の1フレームで
// 落ちていた。見た目の確認は expose.mjs、動くかどうかの確認はこちら。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';

const which = process.argv[2] || 'exodia';
if (!['exodia', 'elf', 'app'].includes(which)){
  console.error('exodia / elf / app のどれかを渡す'); process.exit(1);
}
const CHARA = which !== 'exodia';     // ルイーズ／エルフ（置いてから動かす作り）
const out = 'tools/tmp/sim.cjs';

// --- 時計。三の Clock は読み込み時に performance を掴むので、先に置き換える。
let NOW = 0;
globalThis.performance = { now: () => NOW };

// --- DOM。使うところだけ。無い属性を触ったらそこで気づけるよう、足しすぎない。
const els = new Map();
// 描き先は本物の canvas でないと文脈が取れない。ここだけは形だけでは足りない。
const CANVAS_IDS = new Set(['gl']);
const el = (id) => {
  if (els.has(id)) return els.get(id);
  if (CANVAS_IDS.has(id)){
    const c = createCanvas(8, 8);
    c.id = id; c.style = {}; c.dataset = {};
    c.classList = { s: new Set(), add(x){ this.s.add(x); }, remove(x){ this.s.delete(x); },
                    contains(x){ return this.s.has(x); } };
    c.h = {};
    c.addEventListener = function(t, f){ (this.h[t] = this.h[t] || []).push(f); };
    c.removeEventListener = () => {};
    c.setPointerCapture = () => {}; c.releasePointerCapture = () => {};
    c.fire = function(t, e){ for (const f of (this.h[t] || [])) f(e || {}); };
    els.set(id, c);
    return c;
  }
  const o = {
    id, textContent: '', innerHTML: '', disabled: false, value: '',
    style: {}, dataset: {}, srcObject: null,
    classList: { s: new Set(),
      add(c){ this.s.add(c); }, remove(c){ this.s.delete(c); },
      contains(c){ return this.s.has(c); }, toggle(c){ this.s.has(c) ? this.s.delete(c) : this.s.add(c); } },
    h: {},
    addEventListener(t, f){ (this.h[t] = this.h[t] || []).push(f); },
    removeEventListener(){}, setPointerCapture(){}, releasePointerCapture(){},
    appendChild(){}, remove(){ this.removed = true; }, play(){ return Promise.resolve(); },
    getContext(){ return null; },
    fire(t, e){ for (const f of (this.h[t] || [])) f(e || { preventDefault(){}, clientX: 0, clientY: 0, pointerId: 1 }); },
  };
  els.set(id, o);
  return o;
};

globalThis.document = {
  getElementById: el,
  createElement: (tag) => (tag === 'canvas' ? createCanvas(1, 1) : el('new:' + tag)),
  head: { appendChild(){} }, body: { appendChild(){}, classList: el('body').classList },
  addEventListener(){},
};
globalThis.window = globalThis;
globalThis.self = globalThis;
// 絵は URL 越しに読み込まれる。中身は要らないので、読めたことにして返す。
URL.createObjectURL = () => 'blob:sim';
URL.revokeObjectURL = () => {};
document.createElementNS = (ns, tag) => {
  if (tag !== 'img') return el('ns:' + tag);
  const im = { width: 2, height: 2,
    addEventListener(t, f){ this['on' + t] = f; }, removeEventListener(){} };
  Object.defineProperty(im, 'src', { get(){ return ''; },
    set(){ setTimeout(() => im.onload && im.onload(), 0); } });
  return im;
};
globalThis.innerWidth = 390;
globalThis.innerHeight = 844;
globalThis.devicePixelRatio = 2;
globalThis.addEventListener = () => {};
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
// navigator は node にもう居る（読み取り専用）。上書きではなく生やす。
Object.defineProperty(globalThis, 'navigator', { value: {
  // 三は端末を見分けるのに userAgent を読む。無いとそこで落ちる。
  userAgent: 'sim', xr: null,
  mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) },
}, configurable: true });

// --- 読み込み。三の FileLoader は Request を作るので、相対の道でも通るようにする。
class Req { constructor(u, o){ this.url = String(u); Object.assign(this, o || {}); } }
// 読み込みの進みを知らせるのに使われる。中身は要らないので形だけ。
globalThis.ProgressEvent = class { constructor(t, o){ this.type = t; Object.assign(this, o || {}); } };
globalThis.Request = Req;
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url;
  const path = url.split('?')[0].replace(/^\.?\//, '');
  if (!fs.existsSync(path)) return new Response('', { status: 404 });
  return new Response(fs.readFileSync(path));
};

// --- 束ねる。three だけ偽物に差し替える。
fs.mkdirSync('tools/tmp', { recursive: true });
execFileSync('./node_modules/@esbuild/win32-x64/esbuild.exe', [
  'src/' + which + '.js', '--bundle', '--format=cjs', '--outfile=' + out,
  '--target=es2020', '--alias:three=./tools/glstub.mjs',
  // 別名は名前の頭で効くので、読み込み器の道まで巻き込まれる。実体へ戻しておく。
  '--alias:three/examples/jsm/loaders/GLTFLoader.js=./node_modules/three/examples/jsm/loaders/GLTFLoader.js',
  '--define:__GLBV__=' + JSON.stringify(JSON.stringify('sim')),
  '--alias:fs=./src/empty.js', '--alias:util=./src/empty.js',
  '--alias:path=./src/empty.js', '--alias:crypto=./src/empty.js',
], { stdio: 'inherit' });

const { createRequire } = await import('node:module');
// createRequire は「この道具の場所」を基準にする。束ねた先はリポジトリ直下からの
// 相対で書いてあるので、絶対の道に直してから読む。tools/ へ移したときここで詰まった。
const { pathToFileURL, fileURLToPath } = await import('node:url');
const require2 = createRequire(pathToFileURL(process.cwd() + '/'));

let died = null;
process.on('uncaughtException', (e) => { died = e; });
process.on('unhandledRejection',(e)=>{ console.error('未処理:',e&&e.stack||e); });

// 読み込みの最中に落ちたら、そこで言う。ここを黙って通すと、以降の「押す」が
// 何も起きないまま終わり、成功したのか何もしなかったのか区別がつかなくなる。
try {
  require2(fileURLToPath(pathToFileURL(process.cwd() + '/' + out)));
} catch (e) {
  console.error('【読み込み】で落ちた:\n' + (e && e.stack || e));
  process.exit(1);
}

// --- 走らせる。押す・待つ・押す。人がやることを順にやる。
const gate = el('gate');
const step = async (sec, label) => {
  const n = Math.round(sec * 60);
  for (let i = 0; i < n; i++){
    NOW += 1000 / 60;
    const fn = renderer && renderer.loop;
    if (!fn) { await tick0(); continue; }
    try { fn(NOW, null); } catch (e) { fail(label, e); }
    if (died) fail(label, died);
    await tick0();
  }
};
const tick0 = () => new Promise((r) => setImmediate(r));
const fail = (label, e) => {
  console.error('【' + label + '】で落ちた:\n' + (e && e.stack || e));
  process.exit(1);
};

// 偽物の renderer は setAnimationLoop を控えているだけ。実体は束ねた側が
// globalThis へ置いてくれる。
let renderer = globalThis.__gl;

gate.fire('click');
await new Promise((r) => setTimeout(r, 50));   // カメラの約束が解けるのを待つ
renderer = globalThis.__gl;
if (!renderer || !renderer.loop) fail('起動', new Error('描画のループが始まらなかった'));

await step(1.5, '起動直後');

if (CHARA){
  // --- ルイーズ／エルフ。置いてから動かす作り。押す順を人と同じにする。
  // WebXR は無いので貼り付け表示。置く判定はいつでも通る側を走る。
  const models = which === 'elf' ? ['models/elf.glb', 'models/elfsword.glb']
                                 : ['models/rouise.glb', 'models/sword.glb', 'models/shield.glb'];
  const dbgText = () => el('dbg').textContent || '';

  await step(2.5, '模型の読み込み');
  if (/失敗|配置失敗/.test(dbgText()))
    fail('読み込み', new Error('模型を読み込めていない: ' + dbgText()));
  console.log('  模型: ' + models.join(', '));

  const place = el('bPlace'), home = el('bHome');
  const sword = el('aSword');
  const guard = el(which === 'elf' ? 'aGuard' : 'aShield');

  // 置く前に押しても壊れないこと。ボタンは隠してあるが、鍵や連打では届く。
  sword.fire('click');
  await step(1, '置く前に斬る');

  place.fire('click');
  await step(2, '置いた');
  if (!el('acts').classList.contains('on'))
    fail('置く', new Error('置いたのに動作のボタンが出ない'));

  sword.fire('click');
  await step(2, '斬る');

  guard.fire('pointerdown', { preventDefault(){} });
  await step(3, '守備（押している間）');
  guard.fire('pointerup');
  await step(2, '守備を解く');

  // 守備の途中で斬る。押しっぱなしと単発が同じ骨を取り合うので、ここが危ない。
  guard.fire('pointerdown', { preventDefault(){} });
  await step(1, '守備に入る途中');
  sword.fire('click');
  await step(2, '守備しながら斬る');
  guard.fire('pointerup');
  await step(2, '解いて戻る');

  if (which === 'app'){
    el('aRoar').fire('click');
    await step(3, '威嚇');
  } else if (el('aRoar').h && Object.keys(el('aRoar').h).length){
    // エルフに威嚇は無い。取り違えて残っていないかを、繋がっていないことで確かめる。
    fail('作り', new Error('威嚇のボタンが残っている'));
  }

  // 置き直してもう一度。姿勢を抱えたまま作り直す道を通す。
  home.fire('click');
  await step(1, '置き直す');
  place.fire('click');
  sword.fire('click');
  await step(3, '置き直して斬る');
} else {
  // --- エクゾディア。召喚してから技、途中で封印しなおして、もう一度。
  const call = el('call'), fire = el('fire');
  if (call.disabled) fail('読み込み',
    new Error('模型を読み込めていない: ' + (el('note').textContent || '（訳は出ていない）')));

  call.fire('click');
  await step(8, '召喚');
  if (fire.disabled) fail('召喚', new Error('立ったのに技が押せない'));

  fire.fire('click');
  await step(6, '技');
  if (fire.disabled) fail('技', new Error('技が終わったのにボタンが戻らない'));

  fire.fire('click');
  await step(2, '技（2回目の途中）');
  el('bReset').fire('click');
  await step(2, '技の途中で封印しなおす');

  call.fire('click');
  await step(8, '2度目の召喚');
  fire.fire('click');
  await step(6, '2度目の技');
}

console.log('通った。' + renderer.frames + '枚ぶん回して、例外は出なかった。');
