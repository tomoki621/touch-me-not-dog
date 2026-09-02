// 右手を握らせる。剣を持たせるのに、指が開いたままだと柄が通り抜けて見える。
//
//   node tools/fist.mjs <元> <先> [握り=1.0] [向き=1|-1] [詰め=0.60] [寄せ=0.70]
//
// この模型の骨に指は無い（Hips から Head まで24本、手は RightHand で終わり）。
// なので姿勢では曲げられない。メッシュそのものを曲げて焼き込む。減らす前の
// 原寸に当てること。2万三角形に落としたあとだと、指が数頂点しか無くて潰れる。
//
// 曲げ方：手の骨の空間で測ると、+Y が手首から指先へ伸びている。指の付け根から
// 先へ向かって、拳の関節の線（指を横切る向き）を軸に、少しずつ回していく。
// 回す量は付け根から先へ二乗で増やす。等分に回すと指が真円に丸まって、
// 指輪のような形になる。
//
// 軸の向きは頂点から出す。指の広がりがいちばん大きい向き＝拳の関節の線。
// 決め打ちにすると、模型を差し替えたときに横向きに折れる。
//
// 曲げるだけでは拳にならない。この模型の指は開いて広がっているので、回すと
// 四本が扇のまま弧を描いて、鉤爪になる。曲げる前に二つ潰しておく：
//   ・指を寄せる（関節の線の向きへ縮める）。扇が閉じる。
//   ・指を詰める（付け根から先への長さを縮める）。短くしないと、握っても
//     手のひらを一周して外へ出てしまう。
// 机の上の25cmの置物なので、指を一本ずつ見せる必要は無い。丸い塊に見えれば
// 「握っている」になる。
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';

const [src, dst, gripArg, dirArg, shortArg, tightArg] = process.argv.slice(2);
if (!src || !dst){ console.error('使い方: node tools/fist.mjs <元> <先> [握り] [向き] [詰め] [寄せ]'); process.exit(1); }
const GRIP  = parseFloat(gripArg  ?? '1.0');
const DIR   = parseFloat(dirArg   ?? '1');
const SHORT = parseFloat(shortArg ?? '0.60');   // 指の長さをこの割合まで詰める
const TIGHT = parseFloat(tightArg ?? '0.70');   // 指の広がりをこの割合まで寄せる

const HAND    = 'RightHand';
const W_MIN   = 0.30;   // これ未満の重みは動かさない。手首で千切れるのを防ぐ。
const KNUCKLE = 0.42;   // 手の長さのどこから指か（手首=0、指先=1）
const CURL    = 2.30;   // 指先までに回す総量（ラジアン）。握り=1 のときの値。

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

// --- 曲げる
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
  // 2) 指を詰める。付け根からの長さを縮める。
  tgt.y -= (tgt.y - y0) * (1 - SHORT) * e;

  // 3) 曲げる。詰めたあとの位置で測り直す。付け根から先へ二乗で増やす。
  const t = (tgt.y - y0) / Math.max(1e-6, (yHi - y0) * SHORT);
  const ang = CURL * t * t * e;
  if (Math.abs(ang) < 1e-4 && t0 < 1e-3) continue;
  q.setFromAxisAngle(axis, ang);
  rel.copy(tgt).sub(pivot).applyQuaternion(q).add(pivot);
  p.copy(rel).applyMatrix4(toMesh);
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
