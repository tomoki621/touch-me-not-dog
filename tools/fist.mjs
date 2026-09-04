// 右手を握らせる。剣を持たせるのに、指が開いたままだと柄が通り抜けて見える。
//
//   node tools/fist.mjs <元> <先> [握り=1.0] [向き=1|-1] [詰め=0.90] [寄せ=0.70]
//                       [手=RightHand] [巻き=3.60]
//
// 両手持ちで振るので、左手も握らせる。手ごとに呼ぶこと。
//
// この模型の骨に指は無い（Hips から Head まで24本、手は RightHand で終わり）。
// なので姿勢では曲げられない。メッシュそのものを曲げて焼き込む。
//
// 曲げ方：手の骨の空間で測ると、+Y が手首から指先へ伸びている。拳の関節の線
// （指を横切る向き）を軸に、指を**巻く**。
//
// 【一度これを間違えた】前は「付け根を中心に、頂点ごとに角度を変えて回す」と
// 書いていた。回しても指先は付け根から指の全長ぶん離れたまま動くので、132度
// 回すと掌を通り越し、手首の下まで垂れる。指が逆へ折れて伸びたように見える
// のはこれ。長さを 0.6 に詰めて誤魔化していたが、詰めても外を回ることは変わ
// らない。本物の指は自分の上に畳まれ、指先は付け根の3割ほどの距離に戻る。
//
// いまは長さに沿って巻く。付け根からの道のり s をそのまま弧の長さとして、
// 半径 R=指の長さ/CURL の円に沿わせる。指先の角度は CURL（ラジアン）で、
// 巻けば巻くほど内へ入る。掌へ収まるので、詰めはほとんど要らない。
//
// 軸の向きは頂点から出す。指の広がりがいちばん大きい向き＝拳の関節の線。
// 決め打ちにすると、模型を差し替えたときに横向きに折れる。
//
// 【向き(1|-1)】主成分は符号を決めないので、掌の側へ巻くほうを渡す。この模型
// では **右手=1、左手=-1**。左右の骨の向きが鏡像なので、同じ符号だと片方が
// 甲側へ折れる（左手を 1 のまま出荷して、指が逆へ曲がっていた）。模型を替えた
// ら tools/tmp/hand.mjs で両方描いて、親指の側＝掌へ畳めている方を採る。
//
// 曲げるだけでは拳にならない。この模型の指は開いて広がっているので、巻くと
// 四本が扇のまま並んで進む。巻く前に指を寄せておく（関節の線の向きへ縮める）。
// 机の上の25cmの置物なので、指を一本ずつ見せる必要は無い。丸い塊に見えれば
// 「握っている」になる。
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';

const [src, dst, gripArg, dirArg, shortArg, tightArg, handArg] = process.argv.slice(2);
if (!src || !dst){ console.error('使い方: node tools/fist.mjs <元> <先> [握り] [向き] [詰め] [寄せ]'); process.exit(1); }
const GRIP  = parseFloat(gripArg  ?? '1.0');
const DIR   = parseFloat(dirArg   ?? '1');
const SHORT = parseFloat(shortArg ?? '0.90');   // 指の長さをこの割合まで詰める
const TIGHT = parseFloat(tightArg ?? '0.70');   // 指の広がりをこの割合まで寄せる
const CURL  = parseFloat(process.argv[9] ?? '3.60');  // 指先までに巻く総量（ラジアン）

const HAND    = handArg || 'RightHand';
const W_MIN   = 0.30;   // これ未満の重みは動かさない。手首で千切れるのを防ぐ。
const KNUCKLE = 0.42;   // 手の長さのどこから指か（手首=0、指先=1）

const io = new NodeIO();
const doc = await io.read(src);
const root = doc.getRoot();

const prim = root.listMeshes()[0].listPrimitives()[0];
const POS = prim.getAttribute('POSITION');
const NRM = prim.getAttribute('NORMAL');
const JO  = prim.getAttribute('JOINTS_0');
const WE  = prim.getAttribute('WEIGHTS_0');

const skin   = root.listSkins()[0];
const joints = skin.listJoints();
const ji = joints.findIndex((n) => n.getName() === HAND);
if (ji < 0){ console.error(HAND + ' が骨に無い'); process.exit(1); }

// メッシュの空間 ←→ 手の骨の空間
const ibmAcc = skin.getInverseBindMatrices();
const toBone = new THREE.Matrix4().fromArray(ibmAcc.getElement(ji, new Array(16)));
const toMesh = toBone.clone().invert();

// --- 手に乗っている頂点を拾い、骨の空間での重みつきの位置を控える
const jo = [0,0,0,0], we = [0,0,0,0], p = new THREE.Vector3(), n = new THREE.Vector3();
const hand = [];   // { i, w, v(骨の空間) }
let yLo = 9e9, yHi = -9e9;
for (let i = 0; i < POS.getCount(); i++){
  JO.getElement(i, jo); WE.getElement(i, we);
  let w = 0;
  for (let k = 0; k < 4; k++) if (jo[k] === ji) w += we[k];
  if (w < W_MIN) continue;
  p.fromArray(POS.getElement(i, [0,0,0])).applyMatrix4(toBone);
  hand.push({ i, w, v: p.clone() });
  yLo = Math.min(yLo, p.y); yHi = Math.max(yHi, p.y);
}
if (!hand.length){ console.error('手に乗った頂点が無い'); process.exit(1); }

// --- 拳の関節の線を出す。指のあたりの頂点を Y に垂直な面へ落とし、
//     いちばん広がっている向きを取る（2次元の主成分）。
const y0 = yLo + (yHi - yLo) * KNUCKLE;
let cx = 0, cz = 0, m = 0;
for (const h of hand) if (h.v.y > y0){ cx += h.v.x; cz += h.v.z; m++; }
cx /= m; cz /= m;
let sxx = 0, sxz = 0, szz = 0;
for (const h of hand) if (h.v.y > y0){
  const dx = h.v.x - cx, dz = h.v.z - cz;
  sxx += dx*dx; sxz += dx*dz; szz += dz*dz;
}
// 2x2 の固有ベクトル。大きい方の固有値に対応する向きが、指の広がる向き。
const tr = sxx + szz, det = sxx*szz - sxz*sxz;
const lam = tr/2 + Math.sqrt(Math.max(0, tr*tr/4 - det));
const axis = new THREE.Vector3(sxz, 0, lam - sxx);
if (axis.lengthSq() < 1e-9) axis.set(1, 0, 0);
axis.normalize().multiplyScalar(DIR);

// 回す中心は、指の付け根の真ん中。
const pivot = new THREE.Vector3(cx, y0, cz);

console.log('手の頂点 ' + hand.length + '  骨の空間で y ' + yLo.toFixed(1) + '..' + yHi.toFixed(1));
console.log('拳の関節の線 (' + axis.x.toFixed(2) + ',' + axis.y.toFixed(2) + ',' + axis.z.toFixed(2) +
            ')  付け根 y=' + y0.toFixed(1) + '  握り ' + GRIP + '  向き ' + DIR +
            '  詰め ' + SHORT + '  寄せ ' + TIGHT);

// --- 巻く
// 軸に垂直な面の中で、指の伸びる向き(+Y)と、巻いていく先(palm)を組にする。
// 軸まわりに +角度 で回すと +Y は palm へ倒れる。palm = axis × Y。
const Y = new THREE.Vector3(0, 1, 0);
const palm = new THREE.Vector3().crossVectors(axis, Y).normalize();
console.log('巻く先 (' + palm.x.toFixed(2) + ',' + palm.y.toFixed(2) + ',' + palm.z.toFixed(2) +
            ')  巻き ' + CURL);

const q = new THREE.Quaternion(), rel = new THREE.Vector3();
const nb = new THREE.Vector3(), rot = new THREE.Matrix4();
// 法線は骨の空間へ移すときに移動を含めてはいけない。回転だけを取り出す。
const rotToBone = new THREE.Matrix4().extractRotation(toBone);
const rotToMesh = new THREE.Matrix4().extractRotation(toMesh);
let moved = 0;
const tgt = new THREE.Vector3();
for (const h of hand){
  const t0 = (h.v.y - y0) / Math.max(1e-6, yHi - y0);
  if (t0 <= 0) continue;
  const e = h.w * GRIP;            // 重みぶんだけ効かせる。手首では 0 に近い。

  tgt.copy(h.v);
  // 1) 指を寄せる。関節の線の向きの広がりだけを縮める。付け根では縮めない。
  const along = tgt.clone().sub(pivot).dot(axis);
  tgt.addScaledVector(axis, -along * (1 - TIGHT) * t0 * e);
  // 2) 指を詰める。付け根からの長さを縮める。巻けば掌へ収まるので、ここは
  //    ほとんど効かせない。効かせすぎると指が短い塊になって拳に見えない。
  tgt.y -= (tgt.y - y0) * (1 - SHORT) * e;

  // 3) 巻く。付け根からの道のり s を弧の長さとして、半径 R の円に沿わせる。
  //    ここが「回す」との違い。回すと指先は付け根から全長ぶん離れた円を描いて
  //    掌の外へ出る。沿わせれば、長さのぶんだけ内へ入って掌へ収まる。
  const s = tgt.y - y0;                                    // 付け根からの道のり
  const u = tgt.clone().sub(pivot).dot(axis);              // 関節の線の向き（断面）
  const w = tgt.clone().sub(pivot).dot(palm);              // 掌の向き（断面）
  const ang = (CURL / Math.max(1e-6, (yHi - y0) * SHORT)) * s * e;   // s に比例
  if (Math.abs(ang) < 1e-4 && t0 < 1e-3) continue;
  const R = s / Math.max(1e-6, ang);                       // = 一定の曲がり具合
  const sn = Math.sin(ang), cs = Math.cos(ang);
  // 芯：付け根から弧に沿って ang だけ進んだところ。
  // 断面：芯といっしょに ang だけ倒れる。u（軸の向き）は巻いても変わらない。
  rel.copy(pivot)
     .addScaledVector(Y,    R * sn - w * sn)
     .addScaledVector(palm, R * (1 - cs) + w * cs)
     .addScaledVector(axis, u);
  p.copy(rel).applyMatrix4(toMesh);
  q.setFromAxisAngle(axis, ang);
  POS.setElement(h.i, [p.x, p.y, p.z]);
  if (NRM){
    n.fromArray(NRM.getElement(h.i, [0,0,0]))
     .applyMatrix4(rotToBone).applyQuaternion(q).applyMatrix4(rotToMesh).normalize();
    NRM.setElement(h.i, [n.x, n.y, n.z]);
  }
  moved++;
  void nb; void rot;
}
console.log('曲げた頂点 ' + moved);

await io.write(dst, doc);
console.log('-> ' + dst);
