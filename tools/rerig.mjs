// 骨の名前を、このアプリが使う規則（Meshy の二足歩行リグ）へ揃える。
//
//   node tools/rerig.mjs <元> <先> [--keep-anim]
//
// アプリの姿勢は骨の名前で骨を拾う（`RightArm` `LeftHand` `Spine02` …）。
// Meshy から出したルイーズ・エルフ・エクゾディアは同じ規則で揃っていたが、
// Tripo から出した模型は `L_Upperarm` `Waist` `Hip` の規則で、そのままでは
// 一本も拾えない。アプリ側に別名の表を持たせると、模型を足すたびに表が増えて
// 姿勢の本体から遠くなるので、配るモデルを作る時点で名前のほうを揃える。
//
// 【左右は名前ではなく位置で確かめた】ボーンの t= は親の空間なので、符号だけ
// 見ると左右が逆に見える（Tripo は L_ が t.x 負）。親の回転まで畳んだ世界座標で
// 測ると L_ 側は +X に居て、キャラが +Z を向く以上そこは左。つまり Tripo の
// L_/R_ はそのまま Left/Right でよい。t= の符号で判断しないこと。
//
// モーションは既定で捨てる。Tripo が付けてくるのは歩き・踊り・手振りで、
// アプリの役（idle・attack・guard・roar）には一つも当たらない。要るときは
// models/anim/ へ置けばアプリが勝手に拾う。
import { NodeIO } from '@gltf-transform/core';
import fs from 'node:fs';

// 中心の骨。Meshy は下から Hips → Spine02 → Spine01 → Spine の順で、
// 肩と首がぶら下がるのは一番上の Spine。Tripo は下から Waist → Spine01 →
// Spine02 なので、番号の向きが逆になる。位置で対応させる。
const CENTER = {
  Hip: 'Hips',
  Waist: 'Spine02',
  Spine01: 'Spine01',
  Spine02: 'Spine',       // 肩と首が付く一番上
  NeckTwist01: 'neck',
  NeckTwist02: 'neck2',
  Head: 'Head',
};
// 左右の骨。語幹だけ言い換え、後ろに付く Twist01 などはそのまま残す。
const STEM = {
  Clavicle: 'Shoulder',
  Upperarm: 'Arm',
  Forearm: 'ForeArm',
  Hand: 'Hand',
  Thigh: 'UpLeg',
  Calf: 'Leg',
  Foot: 'Foot',
  ToeBase: 'ToeBase',
};
const stems = Object.keys(STEM).sort((a, b) => b.length - a.length);

function rename(name){
  if (CENTER[name]) return CENTER[name];
  const m = /^([LR])_(.+)$/.exec(name);
  if (!m) return null;
  const side = m[1] === 'L' ? 'Left' : 'Right';
  const s = stems.find(k => m[2].startsWith(k));
  if (!s) return null;
  return side + STEM[s] + m[2].slice(s.length);
}

const [src, dst, ...opt] = process.argv.slice(2);
if (!src || !dst){ console.error('使い方: node tools/rerig.mjs <元> <先> [--keep-anim]'); process.exit(1); }

const io = new NodeIO();
const doc = await io.read(src);
const root = doc.getRoot();

// 名前は元の一覧から一度に決める。順に書き換えると、Spine02 → Spine の途中で
// Waist → Spine02 が重なって取り違える。
const nodes = root.listNodes();
const next = nodes.map(n => rename(n.getName()));
let n = 0;
nodes.forEach((node, i) => {
  if (!next[i] || next[i] === node.getName()) return;
  console.log('  ' + node.getName().padEnd(20) + '-> ' + next[i]);
  node.setName(next[i]);
  n++;
});
console.log('  骨の名前 ' + n + '本を書き換えた');

if (!opt.includes('--keep-anim')){
  for (const a of root.listAnimations()){ console.log('  モーションを捨てる: ' + a.getName()); a.dispose(); }
}

await io.write(dst, doc);
console.log('  -> ' + dst + '  ' + (fs.statSync(dst).size / 1048576).toFixed(2) + ' MB');
