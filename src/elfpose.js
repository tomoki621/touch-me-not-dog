// エルフの剣士の姿勢の表。
//
// アプリ（src/elf.js）と、描き出して確かめる道具（tools/elfpose.mjs）が、
// この同じ表を同じ順番で当てる。ここだけを直せば両方が同じだけ動くので、
// 「画面で見たものと描き出したものが違う」が起きない。
//
// 【向きの決まり】
//   ・体幹の軸は模型自身の向き（X=右 Y=上 Z=前）。X まわりは正が前傾・下向き。
//   ・腕と刀身は角度ではなく「どちらへ向けるか」で書く。骨ごとのローカル軸の
//     取り方に振り回されないため。成分は (キャラの左, 上, 正面)。
//     右手はキャラの右側にあるので、第1成分は負のことが多い。

// ---------------------------------------------------------------- 重み
// g=守備（ひざをつく）、w=ため、c=斬り抜き。三つとも 0..1。
export function poseWeights(st){
  const u = 1 - st.swing;
  const on = st.swing > 0.001 ? 1 : 0;
  // ためは短く、解くのは一瞬。振りかぶりで見せるのではなく、すっと抜く。
  const wind = u < 0.26 ? Math.sin(u / 0.26 * Math.PI / 2)
                        : Math.max(0, 1 - (u - 0.26) / 0.10);
  const chop = u < 0.26 ? 0
             : u < 0.42 ? Math.sin((u - 0.26) / 0.16 * Math.PI / 2)   // 打点まで速く
                        : Math.max(0, 1 - (u - 0.42) / 0.58);         // 戻りはゆっくり
  return { g: st.guard, w: on * wind, c: on * chop };
}

// 体幹のひねり。頭は背骨の子なので、頭の骨で横回転を 0 にしても親のひねりは
// そのまま伝わる。合計を控えておいて、首と頭で同じだけ引く。
export const twistOf = (p) => ({
  s0: 0.11 * p.w - 0.15 * p.c,
  s1: 0.20 * p.w - 0.26 * p.c,
  s2: 0.15 * p.w - 0.20 * p.c,
});

// ---------------------------------------------------------------- 体幹と脚
// [軸x, 軸y, 軸z, 係数の表]。係数の表は重みの名前から係数へ。足し合わせて一度に渡す。
// 'tw0'..'tw2' はひねり、'k' は定数（重み 1 と見なす）。
//
// 【ひざをついた守備】右のひざを地に、左のひざを立てる。腰は腿の長さぶん落ちる。
// 骨を回しても腰は下がらないので、体ごと沈める量が別に要る。それは下の kneelDrop()。
export const TRUNK = {
  // 右脚：腿はほぼ真下のまま、ひざを深く畳んで脛を後ろへ倒し、甲を地につける。
  // 斬り抜きでは後ろ足になる。腰を送るぶん、後ろへ蹴り伸ばす。
  RightUpLeg: [[1, 0, 0, { g:  0.12, c: -0.22 }]],
  RightLeg:   [[1, 0, 0, { g:  1.88, c:  0.18 }]],
  RightFoot:  [[1, 0, 0, { g:  0.78 }]],
  // 左脚：腿を前へ倒してひざを立て、脛を垂直に戻して足の裏を地につける。
  // 少し外へ開くと、体の前に剣を通す隙間ができる。
  // 斬り抜きでは前足。踏み込んでひざを曲げる。ここが折れないと、腕だけ振って
  // 体は棒立ちに見える。
  LeftUpLeg:  [[1, 0, 0, { g: -1.42, c:  0.36 }], [0, 0, 1, { g: 0.20 }]],
  LeftLeg:    [[1, 0, 0, { g:  1.38, c:  0.22 }]],
  LeftFoot:   [[1, 0, 0, { g:  0.06, c: -0.20 }]],

  // 胴。X まわりは正で前へ屈み、負で反る（描き出して確かめた）。守備は剣の陰へ
  // 深く屈み、打ち抜きも前へ入る。ただし屈めすぎるとひざ立ちの形が潰れて、
  // うずくまって見える。腰から順に少しずつ折るのが、いちばん潰れない。
  Spine:   [[1, 0, 0, { g:  0.30, c:  0.20, w: -0.10 }],  [0, 1, 0, { tw0: 1 }]],
  Spine01: [[1, 0, 0, { g:  0.20, c:  0.22, w: -0.08 }],  [0, 1, 0, { tw1: 1 }]],
  Spine02: [[1, 0, 0, { g:  0.12, c:  0.26, w: -0.06 }],  [0, 1, 0, { tw2: 1 }]],

  // 肩。開くのは肩から。腕の骨だけを大きくひねると関節が外れて見える。
  // 守備では両肩をすぼめる。首をうずめる形になり、頭を下げたのが効いてくる。
  RightShoulder: [[0, 0, 1, { g: -0.24, w: -0.24, c: 0.16 }], [1, 0, 0, { c: 0.22 }]],
  LeftShoulder:  [[0, 0, 1, { g:  0.24 }], [1, 0, 0, { g: -0.22, c: -0.20 }]],

  // 首と頭。ひねりはここで打ち消す。
  // k:-0.30 はカメラが上から見下ろすぶんの持ち上げ。素の姿勢だと顔が隠れる。
  // 守備は正が下向き。剣の陰にあごを引いて、額から受ける形にする。上目づかいで
  // 相手を見る形にはしない。見上げると首が伸びて、守っているように見えない。
  neck: [[1, 0, 0, { g:  0.15 }], [0, 1, 0, { twist: -0.35 }]],
  Head: [[1, 0, 0, { k: -0.30, g:  0.24, c: 0.20, w: -0.12 }], [0, 1, 0, { twist: -0.65 }]],
};

// 係数の表を、いまの重みから角度に直す。
export function trunkAngle(coef, p, tw){
  let a = 0;
  for (const key in coef){
    const v = coef[key];
    a += v * (key === 'k'     ? 1
            : key === 'twist' ? (tw.s0 + tw.s1 + tw.s2)
            : key === 'tw0'   ? tw.s0
            : key === 'tw1'   ? tw.s1
            : key === 'tw2'   ? tw.s2
            : (p[key] || 0));
  }
  return a;
}

// ---------------------------------------------------------------- 腕
// 素の向きから、ため→薙ぎ、あるいは守備へ、順に混ぜていく。
export const DIR = {
  // 右腕。右肩の上へ振りかぶってから、相手の左肩口へ斜めに斬り下ろす。真横へ
  // 薙ぐと払っただけに見えるので、終点は自分の左の腰より下まで落とす。
  RightArm:     { rest: [-0.40, -0.90,  0.06],
                  wind: [-0.66,  0.58, -0.48],
                  chop: [ 0.44, -0.66,  0.61],
                  guard:[-0.14, -0.36,  0.92] },
  // 前腕。ためで肩ごしに折り畳み、斬り下ろしで伸ばしきる。ここが肘の見せ場。
  RightForeArm: { rest: [-0.26, -0.95,  0.16],
                  wind: [-0.22,  0.30, -0.93],
                  chop: [ 0.58, -0.62,  0.53],
                  guard:[ 0.48,  0.10,  0.87] },
  // 左腕。盾を持たないので、守備では刀身の先の方へ手を添えて受ける。
  // 斬るときは反対へ振る。腕を体に付けたままだと、上半身だけが回って見える。
  LeftArm:      { rest: [ 0.38, -0.90,  0.05],
                  wind: [ 0.40, -0.83,  0.39],
                  chop: [ 0.44, -0.80, -0.41],
                  guard:[ 0.30, -0.40,  0.87] },
  LeftForeArm:  { rest: [ 0.26, -0.95,  0.14],
                  wind: [ 0.30, -0.87,  0.39],
                  chop: [ 0.34, -0.86, -0.38],
                  guard:[ 0.16,  0.22,  0.96] },
};

// ---------------------------------------------------------------- 刀身
// 刀身は模型の +Y。守備は真横に寝かせて体の前を渡す。これが「剣を横にして守る」形。
export const SWORD = {
  rest:  [-0.18, -0.52,  0.83],   // 構え：刃先を前下へ。真横に構えると突きの途中に見える。
  wind:  [-0.20,  0.62, -0.76],   // ため：右肩ごしに後ろへ倒して振りかぶる
  chop:  [ 0.60, -0.72,  0.35],   // 斬り下ろし：刃先が左下へ抜けていく
  guard: [ 0.93, -0.09,  0.35],   // 守備：真横。体の前を斜めに渡して受ける。
};

// 刀身の軸まわりのひねり。平たい面の向きを決める。守備では面を正面へ向けて受ける。
export const SWORD_ROLL = Math.PI / 2;

// ---------------------------------------------------------------- 当てる
// ここから下は「表をどう骨に当てるか」。アプリと道具が同じ関数を呼ぶので、
// 表が同じでも当て方がずれる、という食い違いが起きない。
import * as THREE from 'three';

const _axis = new THREE.Vector3(), _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _dir = new THREE.Vector3(), _dirW = new THREE.Vector3(), _q3 = new THREE.Quaternion();
const _pA = new THREE.Vector3(), _pB = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q2 = new THREE.Quaternion(), _qRoll = new THREE.Quaternion(), _qh = new THREE.Quaternion();
const _upY = new THREE.Vector3(0, 1, 0);
const _lerp = new THREE.Vector3();

// 骨を素の姿勢からの差分で回す。軸は模型自身の向き（X=右 Y=上 Z=前）で指定し、
// 骨の親空間へ移してから掛ける。骨の命名規約やローカル軸の取り方に左右されない。
function boneSet(bones, rest, name, chans, p, tw, charaQ){
  const b = bones[name];
  if (!b) return;
  const safe = rest[name];
  b.quaternion.copy(safe);
  if (!chans) return;
  b.parent.getWorldQuaternion(_pq).invert();
  for (const c of chans){
    const ang = trunkAngle(c[3], p, tw);
    if (!ang) continue;
    _axis.set(c[0], c[1], c[2]).applyQuaternion(charaQ).applyQuaternion(_pq);
    if (_axis.lengthSq() < 1e-12) continue;
    _axis.normalize();
    b.quaternion.premultiply(_q.setFromAxisAngle(_axis, ang));
  }
  // 非数が混ざるとスキンメッシュ全体が消えるので、その場で素の姿勢に戻す
  const q = b.quaternion;
  if (!(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w)))
    b.quaternion.copy(safe);
}

// 骨の節を、指定した向きへ向ける。角度の符号を積み上げると取り違えるので、
// 向きそのものをベクトルで書く。
function aimBone(bones, name, childName, dir, charaQ){
  const b = bones[name], c = bones[childName];
  if (!b || !c) return;
  b.getWorldPosition(_pA); c.getWorldPosition(_pB);
  _v3.subVectors(_pB, _pA);
  if (_v3.lengthSq() < 1e-9) return;
  _v3.normalize();
  _dirW.copy(dir).normalize().applyQuaternion(charaQ);   // キャラ空間 → ワールド
  _q3.setFromUnitVectors(_v3, _dirW);
  b.parent.getWorldQuaternion(_qp);
  b.quaternion.premultiply(_qp.clone().invert().multiply(_q3).multiply(_qp));
}

// 表から向きを作る。素→ため→薙ぎ→守備の順に混ぜる。
function aim(tbl, p, out){
  out.fromArray(tbl.rest);
  if (p.w > 0.001) out.lerp(_lerp.fromArray(tbl.wind),  p.w);
  if (p.c > 0.001) out.lerp(_lerp.fromArray(tbl.chop),  p.c);
  if (p.g > 0.001) out.lerp(_lerp.fromArray(tbl.guard), p.g);
  return out.normalize();
}

const ARM_CHAIN = [['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'],
                   ['LeftArm',  'LeftForeArm'],  ['LeftForeArm',  'LeftHand']];

// ctx = { bones, rest, root, swordPivot }
//   root       骨を回したあとに行列を作り直す入れ物（アプリでは chara）
//   swordPivot 手の骨の子。刀身の向きをここで決める。
export function applyPose(ctx, p){
  const { bones, rest, root, swordPivot } = ctx;
  const tw = twistOf(p);
  const charaQ = new THREE.Quaternion();
  root.getWorldQuaternion(charaQ);

  // 体幹と脚。腕は下で向きから決めるので、ここでは素の姿勢に戻すだけ。
  for (const name in TRUNK) boneSet(bones, rest, name, TRUNK[name], p, tw, charaQ);
  for (const [n, ch] of ARM_CHAIN){ boneSet(bones, rest, n, null, p, tw, charaQ); void ch; }
  root.updateMatrixWorld(true);

  // 腕。骨を一本向けるたびに行列を作り直す。まとめてやると親の回転が反映されない。
  for (const [n, ch] of ARM_CHAIN){
    if (!DIR[n]) continue;
    aimBone(bones, n, ch, aim(DIR[n], p, _dir), charaQ);
    root.updateMatrixWorld(true);
  }

  // 刀身。手の骨のローカル軸には預けない。あの軸の取り方は模型側の都合で、
  // 預けると刀身が拳を横切って「刺さって」見える。体の空間で向きを決め、
  // 手の骨の回転を打ち消して実現する。位置は手に付いて回る。
  if (swordPivot && bones.RightHand){
    aim(SWORD, p, _dir);
    // 向けるだけだと軸まわりのひねりが定まらず、平たい面の向きが成り行きになる。
    _q2.setFromUnitVectors(_upY, _dir);
    _qRoll.setFromAxisAngle(_upY, SWORD_ROLL);
    _q2.multiply(_qRoll);
    bones.RightHand.getWorldQuaternion(_qh).invert();
    swordPivot.quaternion.copy(_qh).multiply(charaQ).multiply(_q2);
    root.updateMatrixWorld(true);
  }
}

// ひざをついたぶん、体をどれだけ沈めるか。
//
// 骨を回しても腰は下がらない（足が動くだけ）ので、体ごと沈めるしかない。その量は
// 守備の重みに対して直線ではないし、単調ですらない。重み 0.1〜0.3 のあたりでは、
// 前へ振り出した左足が先に床を割る（腰はまだ落ちていないのに脚だけ伸びるため）。
//
// なので式で近似せず、実測をそのまま表にして引く。値は
//   node tools/elfpose.mjs table
// が出す「沈める前の、skin を通した体の最下点」。0.125 刻み。
// アプリ（src/elf.js）と描き出し（tools/elfpose.mjs）が同じ表を引くので、
// 画面と絵が食い違わない。
const KNEEL_LOW = [0.000, -0.043, -0.045, 0.004, 0.104, 0.177, 0.246, 0.321, 0.400];

export function kneelDrop(g){
  const x = Math.min(1, Math.max(0, g)) * (KNEEL_LOW.length - 1);
  const i = Math.min(KNEEL_LOW.length - 2, Math.floor(x));
  return KNEEL_LOW[i] + (KNEEL_LOW[i + 1] - KNEEL_LOW[i]) * (x - i);
}
