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
// g=守備（ひざをつく）、m=頭上、w=ため、c=斬り抜き。どれも 0..1。
//
// 【なぜ「頭上」が要るか】素の構えは刃先が前下、ためは右肩の後ろ、斬り抜きは
// 左下。素とため（内積 -0.92）も、ためと斬り抜き（-0.94）も、ほぼ真裏を向いて
// いる。真裏どうしを直に混ぜると、補間したベクトルが原点を通る。長さが 0.2 まで
// 潰れて向きが定まらず、剣は 1 コマで裏返る。弧を描いていなかった。振っている
// のではなく、瞬間移動していた。これが「攻撃に違和感がある」の正体。
//
// 直し方は、真裏を直に結ばないこと。刃を立てた「頭上」を経由地に置く。実際の
// 太刀筋も、上げるときと下ろすときの二度そこを通る。だから経由地は一つでいい。
//
//   素 → 頭上 → ため（後ろへ引く）→ 頭上 → 斬り抜き → 素
//
// 【重ねる順】下の aim は、素からこの順に寄せていく。あとに当てたものほど強く、
// 重みが 1 なら前のを完全に上書きする。だから「頭上」を「ため」より先に当てる。
// そうすると、ため が立ち上がるあいだ 頭上 は 1 のまま土台として残り、ため が
// 落ちれば自然に 頭上 へ戻る。行きと帰りで同じ経由地を、一つの重みで通れる。
// 逆順にすると、ため が落ちた瞬間に素の姿勢へ引き戻され、腕が一度体の横へ
// 帰ってから振り直す形になる。
export function poseWeights(st){
  const u = 1 - st.swing;
  const on = st.swing > 0.001 ? 1 : 0;
  const seg  = (a, b) => Math.min(1, Math.max(0, (u - a) / (b - a)));
  const ease = (x) => Math.sin(x * Math.PI / 2);
  // 頭上：はじめに上げ、最後まで土台として残す。
  const pass = ease(seg(0.00, 0.16)) * (1 - ease(seg(0.62, 1.00)));
  // ため：頭上から後ろへ引き、打つ直前に戻す。山が一つ。
  const wind = ease(seg(0.16, 0.28)) * (1 - ease(seg(0.28, 0.40)));
  // 斬り抜き：打点まで速く、戻りはゆっくり。
  const chop = ease(seg(0.40, 0.56)) * (1 - ease(seg(0.56, 1.00)));
  // 両手持ちの効き。振っているあいだだけ左手を柄へ持っていく。守備は左手で
  // 刀身を支える別の形なので、そちらが立つぶんだけ譲る。
  return { g: st.guard, m: on * pass, w: on * wind, c: on * chop,
           two: on * pass * (1 - st.guard) };
}

// 打点を過ぎたか。手ごたえ（画面の揺れ）はここに合わせる。振り始めに揺らすと、
// 当たる前に手ごたえが来て、順番が逆に見える。
export const HIT_AT = 0.52;

// 体幹のひねり。頭は背骨の子なので、頭の骨で横回転を 0 にしても親のひねりは
// そのまま伝わる。合計を控えておいて、首と頭で同じだけ引く。
export const twistOf = (p) => ({
  s0: 0.11 * p.w + 0.02 * p.m - 0.10 * p.c,
  s1: 0.20 * p.w + 0.03 * p.m - 0.17 * p.c,
  s2: 0.15 * p.w + 0.02 * p.m - 0.13 * p.c,
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
                  pass: [-0.24,  0.52,  0.82],
                  chop: [ 0.34, -0.62,  0.71],
                  guard:[-0.14, -0.36,  0.92] },
  // 前腕。ためで肩ごしに折り畳み、斬り下ろしで伸ばしきる。ここが肘の見せ場。
  RightForeArm: { rest: [-0.26, -0.95,  0.16],
                  wind: [-0.05,  0.05, -1.00],
                  pass: [-0.06,  0.60,  0.80],
                  chop: [ 0.44, -0.68,  0.59],
                  guard:[ 0.48,  0.10,  0.87] },
  // 左腕。盾を持たないので、守備では刀身の先の方へ手を添えて受ける。
  // 斬るあいだの左腕はこの表では決まらない。柄を握りに行くので、剣の居場所から
  // 逆に解く（下の twoHand）。ここの ため／頭上／斬り抜き は、その逆解きが
  // 効きはじめる前と抜けたあとの受け皿。素に寄せてある。逆へ振る指定を残すと、
  // 掴みに行く手と引っぱり合って、肘が跳ねる。
  LeftArm:      { rest: [ 0.38, -0.90,  0.05],
                  wind: [ 0.40, -0.86,  0.20],
                  pass: [ 0.42, -0.85,  0.20],
                  chop: [ 0.42, -0.85,  0.20],
                  guard:[ 0.30, -0.40,  0.87] },
  LeftForeArm:  { rest: [ 0.26, -0.95,  0.14],
                  wind: [ 0.30, -0.91,  0.20],
                  pass: [ 0.32, -0.90,  0.20],
                  chop: [ 0.32, -0.90,  0.20],
                  guard:[ 0.16,  0.22,  0.96] },
};

// ---------------------------------------------------------------- 刀身
// 刀身は模型の +Y。守備は真横に寝かせて体の前を渡す。これが「剣を横にして守る」形。
export const SWORD = {
  rest:  [-0.18, -0.52,  0.83],   // 構え：刃先を前下へ。真横に構えると突きの途中に見える。
  wind:  [-0.10,  0.72, -0.68],   // ため：右肩ごしに後ろへ立てて振りかぶる
  pass:  [ 0.06,  0.72,  0.69],   // 打点：頭の上を通す。ためと抜きの真ん中。
  chop:  [ 0.40, -0.74,  0.54],   // 斬り下ろし：刃先が正面の左下へ抜けていく
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
const _qTwo = new THREE.Quaternion(), _qKeep2 = new THREE.Quaternion();
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

// 骨の節を、指定した向き（ワールド）へ向ける。
function aimBoneW(bones, name, childName, dirW){
  const b = bones[name], c = bones[childName];
  if (!b || !c) return;
  b.getWorldPosition(_pA); c.getWorldPosition(_pB);
  _v3.subVectors(_pB, _pA);
  if (_v3.lengthSq() < 1e-9) return;
  _v3.normalize();
  if (!Number.isFinite(dirW.x + dirW.y + dirW.z)) return;
  _q3.setFromUnitVectors(_v3, dirW);
  b.parent.getWorldQuaternion(_qp);
  _qKeep2.copy(b.quaternion);
  b.quaternion.premultiply(_qp.clone().invert().multiply(_q3).multiply(_qp));
  // 非数が一つ混ざるとスキンメッシュ全体が消える。逆解きは毎フレーム割り算と
  // acos を通るので、ここで止める。boneSet と同じ用心。
  const q = b.quaternion;
  if (!(Number.isFinite(q.x) && Number.isFinite(q.y) &&
        Number.isFinite(q.z) && Number.isFinite(q.w))) b.quaternion.copy(_qKeep2);
}

// 骨の節を、指定した向きへ向ける。角度の符号を積み上げると取り違えるので、
// 向きそのものをベクトルで書く。こちらはキャラ空間で受ける。
function aimBone(bones, name, childName, dir, charaQ){
  _dirW.copy(dir).normalize().applyQuaternion(charaQ);   // キャラ空間 → ワールド
  aimBoneW(bones, name, childName, _dirW);
}

// 表から向きを作る。素 → 頭上 → ため → 斬り抜き → 守備 の順に寄せていく。
// この順でなければならない理由は poseWeights の注記にある。
function aim(tbl, p, out){
  out.fromArray(tbl.rest);
  if (p.m > 0.001 && tbl.pass) out.lerp(_lerp.fromArray(tbl.pass),  p.m);
  if (p.w > 0.001)             out.lerp(_lerp.fromArray(tbl.wind),  p.w);
  if (p.c > 0.001)             out.lerp(_lerp.fromArray(tbl.chop),  p.c);
  if (p.g > 0.001)             out.lerp(_lerp.fromArray(tbl.guard), p.g);
  return out.normalize();
}

const ARM_CHAIN = [['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'],
                   ['LeftArm',  'LeftForeArm'],  ['LeftForeArm',  'LeftHand']];

// ---------------------------------------------------------------- 両手持ち
// 斬るあいだは左手も柄を握る。
//
// 左手の居場所を向きの表で書くことはできない。剣は頭の上を通る大きな弧を描く
// ので、節目で合わせても、あいだで必ず柄から外れる。剣の居場所は右手が決めて
// いるのだから、左腕はそこから逆に解く。肩→肘→手 の二節を、目標へ届く形に
// 畳むだけ（二辺と対辺から角度を出す。余弦定理）。
//
// 肩も少しだけ目標へ向ける。肩を止めたままだと、剣を頭上へ振り上げたとき、
// 腕の長さが足りずに手が柄から離れる。
const TWO_GAP      = 0.42;   // 両手の間隔。前腕の長さに対する割合。
const TWO_SHOULDER = 0.55;   // 肩を目標へ向ける割合
// 肘の向く先（キャラ空間。成分は 左, 上, 正面）。下・外・少し後ろ。
const TWO_POLE     = [0.55, -0.75, -0.35];

const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _J = new THREE.Vector3();
const _hw = new THREE.Vector3(), _d2 = new THREE.Vector3(), _n2 = new THREE.Vector3();
const _pole = new THREE.Vector3(), _up2 = new THREE.Vector3();
const _bladeW = new THREE.Vector3(), _qKeep = new THREE.Quaternion();

// bladeW = 刀身のワールド向き。handQ = 手をどう向けるか（右手と同じ）。
function twoHand(ctx, p, charaQ, handQ){
  const { bones, root, swordPivot } = ctx;
  const A = bones.LeftArm, B = bones.LeftForeArm, H = bones.LeftHand;
  if (!A || !B || !H || !swordPivot) return;
  const t = Math.min(1, p.two);

  // 節の長さ。骨の長さは変わらないので、いまの姿勢から測ってよい。
  A.getWorldPosition(_S); B.getWorldPosition(_J); H.getWorldPosition(_hw);
  const L1 = _S.distanceTo(_J), L2 = _J.distanceTo(_hw);
  if (L1 < 1e-6 || L2 < 1e-6) return;

  // 目標は柄の、右手より少し下（柄頭寄り）。同じ点だと手が重なる。
  //
  // 基準は剣の握り点ではなく「右手の骨」。骨は手首にあり、拳は そこから刃の
  // 向きへ少し先にある。左右で同じずれを持つので、手首どうしの間隔がそのまま
  // 拳どうしの間隔になる。握り点から測ると、そのずれを二重に数えてしまい、
  // 左手が右手に重なる。
  bones.RightHand.getWorldPosition(_T);
  _T.addScaledVector(_bladeW, -L2 * TWO_GAP);
  // 効き具合。0 なら今の手の位置そのもの＝何もしないのと同じ。
  _T.lerpVectors(_hw, _T, t);

  // 肩を少し送る
  if (bones.LeftShoulder){
    _d2.subVectors(_T, _S);
    if (_d2.lengthSq() > 1e-9){
      _d2.normalize();
      _qKeep.copy(bones.LeftShoulder.quaternion);
      aimBoneW(bones, 'LeftShoulder', 'LeftArm', _d2);
      bones.LeftShoulder.quaternion.slerp(_qKeep, 1 - TWO_SHOULDER * t);
      root.updateMatrixWorld(true);
    }
  }

  // 二節を畳む
  A.getWorldPosition(_S);
  _d2.subVectors(_T, _S);
  let dist = _d2.length();
  if (dist < 1e-6) return;
  _d2.divideScalar(dist);
  // 届かない／近すぎるときは、届く範囲へ丸める。伸ばしきり／畳みきりになる。
  dist = Math.min((L1 + L2) * 0.999, Math.max(Math.abs(L1 - L2) + 1e-4, dist));
  // 肩のところの角度。余弦定理。
  const cosS = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
  const ang = Math.acos(Math.min(1, Math.max(-1, cosS)));
  // 目標の向きから、肘の向く先へ ang だけ倒す。軸は d×pole。この軸まわりに
  // 正へ回すと d は pole の側へ寄る（微分が pole の d に垂直な成分になる）。
  _pole.fromArray(TWO_POLE).applyQuaternion(charaQ);
  _n2.crossVectors(_d2, _pole);
  if (_n2.lengthSq() < 1e-8) _n2.set(0, 1, 0); else _n2.normalize();
  _up2.copy(_d2).applyAxisAngle(_n2, ang);
  aimBoneW(bones, 'LeftArm', 'LeftForeArm', _up2);
  root.updateMatrixWorld(true);

  // 前腕は目標そのものへ
  B.getWorldPosition(_J);
  _d2.subVectors(_T, _J);
  if (_d2.lengthSq() > 1e-9){
    _d2.normalize();
    aimBoneW(bones, 'LeftForeArm', 'LeftHand', _d2);
    root.updateMatrixWorld(true);
  }

  // 左手も刃に沿わせる。右手と同じ向きにすると、両手が同じように柄を包む。
  _qKeep.copy(H.quaternion);
  H.parent.getWorldQuaternion(_qh).invert();
  H.quaternion.copy(_qh).multiply(handQ);
  H.quaternion.slerp(_qKeep, 1 - t);
  root.updateMatrixWorld(true);
}

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

  // 刀身。向きは体の空間で決める（骨のローカル軸の取り方に振り回されないため）。
  // ただし決めた向きは剣ではなく「手の骨」に渡す。手の骨の +Y は手首から拳へ
  // 伸びているので、そこを刀身へ向ければ、手首と前腕と刀身が一直線に近く並ぶ。
  //
  // 前は剣だけを向け、手の回転を打ち消していた。剣は正しい向きに出るが、手は
  // 素の向きのまま取り残される。開いた手なら誤魔化せたが、拳を握らせた以上、
  // 拳の向きと刃の向きが食い違えば、剣が拳を貫いて見える。手ごと向ける。
  if (swordPivot && bones.RightHand){
    aim(SWORD, p, _dir);
    // 向けるだけだと軸まわりのひねりが定まらず、拳と刃の面の向きが成り行きになる。
    _q2.setFromUnitVectors(_upY, _dir);
    _qRoll.setFromAxisAngle(_upY, SWORD_ROLL);
    _q2.multiply(_qRoll);
    bones.RightHand.parent.getWorldQuaternion(_qh).invert();
    bones.RightHand.quaternion.copy(_qh).multiply(charaQ).multiply(_q2);
    // 剣は手に預けきる。握りの位置は swordPivot.position が持っている。
    swordPivot.quaternion.identity();
    root.updateMatrixWorld(true);

    // 左手を柄へ。剣を置いたあとでないと、掴む先が決まっていない。
    if (p.two > 0.001){
      _bladeW.copy(_dir).normalize().applyQuaternion(charaQ);
      _qTwo.copy(charaQ).multiply(_q2);
      twoHand(ctx, p, charaQ, _qTwo);
    }
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
