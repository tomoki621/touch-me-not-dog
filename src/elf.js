// エルフの剣士。エクゾディアと同じ WebXR の置き方。カードは使わない。
//
//   ・右手に剣、左手は空。盾を持たない。
//   ・守備は「ひざをついて剣を横に構える」。押している間ずっと。
//   ・威嚇は無い。ボタンは守備と斬るの2つ。
//
// 置く仕組みは src/arstage.js（ルイーズと共有）。姿勢は src/elfpose.js の表に
// だけ置いてあり、tools/elfpose.mjs が同じ表・同じ手順で描き出す。画面に出す前に
// 姿を確かめられるので、数字を見ないまま直さない。
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createStage } from './arstage.js';
import { poseWeights, applyPose, kneelDrop, HIT_AT } from './elfpose.js';

const $ = (id) => document.getElementById(id);
const acts = $('acts'), hud = $('hud'), tip = $('tip');
let xrOn = false;          // AR の中に居るか。案内の文がここで変わる。

// ---------------------------------------------------------------- 状態の表示
// 普段は何も出さない。壊れたとき、または AR に入れず貼り付け表示へ落ちたときに、
// その理由を一行で出す。落ちたことを黙っていると「置いても留まらない」の原因が
// 端末の側にあるのか作りの側にあるのか、誰にも分からなくなる。
// err（例外）と mode（貼り付け表示の断り）は分けて持つ。片方が出ているせいで
// もう片方が隠れると、直すべきものを見落とす。
const dbgEl = $('dbg');
const dbg = { frames:0, models:{}, err:'', mode:'', live:'' };
// ?dbg を付けて開くと、置き場所の実測を出し続ける。「置いたのについてくる」と
// いうとき、動いているのがキャラなのかカメラなのかは、両方の座標を並べないと
// 決められない。歩きながら見て、
//   ・「像」が変わらなければ、キャラは現実に留まっている（正常）
//   ・「差」が変わらなければ、キャラはカメラに付いてきている（不具合）
const LIVE = /(^|[?&])dbg(=|&|$)/.test(location.search);
const BR = '\n';   // #dbg は white-space:pre-wrap。行を分けて並べる。
dbgEl.addEventListener('click', () => { dbgEl.style.display = 'none'; });
function renderDbg(){
  const broken = Object.keys(dbg.models).filter(k => !/^(OK|取得中)$/.test(dbg.models[k]));
  const msg = [dbg.err,
               broken.length ? broken.map(k => k + ': ' + dbg.models[k]).join(' / ') : '',
               dbg.mode, dbg.live].filter(Boolean).join(BR);
  dbgEl.style.display = msg ? 'block' : 'none';
  if (msg) dbgEl.textContent = msg;
}

// ---------------------------------------------------------------- 寸法
// 値はすべて tools/elfpose.mjs で描き出して決めた。当てずっぽうは入っていない。
const BODY_H     = 1.9;     // 場面の中での背丈。剣も影もこれを基準にする。
const AR_H       = 0.25;    // AR は実寸（メートル）。机の上の置物として。
const HEAD_Y     = 1.55;    // 斬撃の輪を出す高さ
const SWORD_LEN  = 1.05;    // 背丈 1.9 に対する剣の全長。長すぎると槍に見える。
const SWORD_GRIP = 0.20;    // 柄のどこを握るか（剣の下からの割合）
const GRIP_Y     = 0.62;    // 手の骨から拳まで。前腕の長さに対する割合。
const FOOT_SINK  = -0.05;   // 足を面に少し埋める。ぴったり0だと浮いて見える。

// ---------------------------------------------------------------- 場面
const ar = createStage({
  gl: $('gl'), cam: $('cam'), touch: $('touch'), ov: $('ov'),
  gate: $('gate'), note: $('note'), tapme: $('tapme'), tip,
  bodyH: BODY_H, arH: AR_H,
  onReady: (isXR, why) => {
    hud.classList.add('on');
    // 描き始めるのはカメラ／XR が立ち上がってから。エクゾディアと同じ順。
    // 先に回し始めても three は XR へ繋ぎ直してくれるが、実績のある順に揃える。
    renderer.setAnimationLoop(tick);
    xrOn = isXR;
    tip.innerHTML = isXR
      ? '床や机に輪を合わせて「置く」<br>2本指、またはボタンで大きさと向き'
      : '1本指で位置、2本指で大きさと向き<br>置いたら「置く」';
    // 貼り付け表示に落ちたことを黙っていない。この表示にはカメラの姿勢が無く、
    // 置いても現実の一点に留められない。動くのは不具合ではなく、そもそも
    // 留める手がかりが無い。理由まで出す。出さないと端末の問題か作りの問題か
    // 区別がつかない。
    if (!isXR) dbg.mode = '貼り付け表示です（' + (why || '理由不明') +
      '）。この表示にはカメラの姿勢が無いので、置いても現実の一点には留まりません。';
    renderDbg();
  },
  onPlaced: () => {
    acts.classList.add('on');
    tip.innerHTML = xrOn
      ? '守備・斬るで追い払う<br>大きさと向きは変えられる。動かすなら「置き直す」'
      : '守備・斬るで追い払う<br>貼り付け表示なので、画面の中の位置に留まります';
  },
});
const { renderer, scene, camera, stage } = ar;

// 足元を原点にしたキャラの入れ物。stage は現実の側に固定される親で、こちらは
// 演技で動かす側。役割を分けておくと、踏み込みが置き場所を汚さない。
const chara = new THREE.Group();
stage.add(chara);

// 足元の落ち影。方向光の影だけでは弱いので、接地点に濃い影を敷く。
// これが無いと、位置が合っていても浮いて見える。
function blobTexture(){
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64,64,0, 64,64,64);
  grd.addColorStop(0,    'rgba(0,0,0,0.92)');
  grd.addColorStop(0.26, 'rgba(0,0,0,0.62)');
  grd.addColorStop(0.60, 'rgba(0,0,0,0.22)');
  grd.addColorStop(1,    'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0,0,128,128);
  return new THREE.CanvasTexture(c);
}
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5),
  new THREE.MeshBasicMaterial({map:blobTexture(), transparent:true, depthWrite:false}));
blob.rotation.x = -Math.PI/2;
blob.renderOrder = -1;
stage.add(blob);

// 影を受けるだけの板。ShadowMaterial は影の落ちたところしか描かないので、
// 現実の机の上に影だけが乗る。カードが無くなっても接地はこれで作れる。
const ground = new THREE.Mesh(new THREE.PlaneGeometry(8,8),
  new THREE.ShadowMaterial({opacity:0.34}));
ground.rotation.x = -Math.PI/2;
ground.receiveShadow = true;
stage.add(ground);

stage.add(new THREE.HemisphereLight(0xcfd8ff, 0x4a3a5a, 1.0));
const key = new THREE.DirectionalLight(0xfff6e8, 1.5);
key.position.set(1.6, 3.0, 1.8);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 0.5; key.shadow.camera.far = 12;
key.shadow.camera.left = -2.5; key.shadow.camera.right = 2.5;
key.shadow.camera.top = 2.5; key.shadow.camera.bottom = -2.5;
key.shadow.bias = -0.002;
stage.add(key);
stage.add(key.target);
const rim = new THREE.DirectionalLight(0x9fb4ff, 0.55);
rim.position.set(-2, 1.5, -2);
stage.add(rim);

// ---------------------------------------------------------------- モデル
const swordPivot = new THREE.Group();     // 手の骨が見つかればその子へ移す
chara.add(swordPivot);

const bones = {};
const rest  = {};                         // 素の姿勢。ここからの差分で動かす。
let rigged = false, ready = false;

const loader = new GLTFLoader();

// スキン付きメッシュの頂点はバインド行列で既に骨の空間に載っている。そこへ
// メッシュ側のワールド行列を重ねて測ると桁が狂う（Armature に 0.01 倍が
// 掛かっていて、100分の1の箱が返る）。スキン付きは素の箱を使う。
const _b3 = new THREE.Box3();
function modelBox(root){
  const box = new THREE.Box3().makeEmpty();
  root.updateWorldMatrix(false, true);
  root.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    _b3.copy(o.geometry.boundingBox);
    if (!o.isSkinnedMesh) _b3.applyMatrix4(o.matrixWorld);
    box.union(_b3);
  });
  return box;
}

// anchorY: 0=モデルの底、1=モデルの天。剣は握りが下寄りなので少し上を掴む。
function fit(root, targetH, anchorY){
  const box = modelBox(root);
  const size = new THREE.Vector3(), center = new THREE.Vector3();
  box.getSize(size); box.getCenter(center);
  const k = (isFinite(size.y) && size.y > 1e-6) ? targetH / size.y : 1;
  root.scale.setScalar(k);
  root.position.set(-center.x*k, -(box.min.y + size.y*anchorY)*k, -center.z*k);
}

function load(url, onDone){
  const name = url.split('/').pop();
  dbg.models[name] = '取得中';
  renderDbg();
  // モデルも GitHub Pages に10分キャッシュされる。作り直しても届かないので版番号を付ける。
  loader.load(url + '?h=' + __GLBV__, (g) => {
    g.scene.traverse(o => {
      if (o.isMesh){ o.castShadow = true; o.frustumCulled = false; }
    });
    try { onDone(g.scene); dbg.models[name] = 'OK'; }
    catch(e){ dbg.models[name] = '配置失敗 ' + (e.message || e); }
    renderDbg();
  }, undefined, (err) => {
    dbg.models[name] = '失敗 ' + ((err && (err.message || err.type)) || '');
    renderDbg();
  });
}

load('models/elf.glb', (root) => {
  fit(root, BODY_H, 0);            // 足を原点に
  chara.add(root);

  root.traverse(o => {
    if (o.isBone){ bones[o.name] = o; rest[o.name] = o.quaternion.clone(); }
  });
  rigged = !!(bones.RightArm && bones.LeftArm && bones.RightHand);
  console.log('[rig] 骨 ' + Object.keys(bones).length + '本, 使用可: ' + rigged);

  // 剣は手の骨の子にする。これで腕の動きに完全に追従する。
  if (bones.RightHand){
    bones.RightHand.add(swordPivot);
    // 骨は親の尺度を引き継ぐので、剣側で打ち消して大きさを決める。
    //
    // 打ち消すのは「骨の鎖ぶん」だけ。getWorldScale には stage.scale まで
    // 入っていて、それも割ってしまうと、剣は場面の倍率に依らない一定の大きさに
    // なる。AR は実寸なので stage.scale は 0.13 ほど（25cm の置物）。読み込みが
    // AR の起動より後になると 1/0.13 ≒ 7.7 倍の剣が付き、以後は全体と一緒に
    // 縮むだけなので「武器だけ小さくならない」に見える。場面の倍率は戻す。
    const ws = new THREE.Vector3(), ss = new THREE.Vector3();
    bones.RightHand.getWorldScale(ws);
    stage.getWorldScale(ss);
    const boneS = (ws.x / (ss.x || 1)) || 1;
    swordPivot.scale.setScalar(SWORD_LEN / boneS);
    // 骨は拳ではなく手首にある。そのまま置くと手首に刺さって見えるので、
    // 前腕から手へ伸びる長さを測って、その割合だけ先へ送る。数字で決め打ちを
    // しないので、模型を差し替えても柄の位置がずれない。
    const fore = new THREE.Vector3(), hand = new THREE.Vector3();
    bones.RightForeArm.getWorldPosition(fore);
    bones.RightHand.getWorldPosition(hand);
    swordPivot.position.set(0, hand.distanceTo(fore) * GRIP_Y / (ws.y || 1), 0);
  }
  ready = true;
});
load('models/elfsword.glb', (root) => {
  fit(root, 1.0, SWORD_GRIP);      // 柄を握る位置が原点。実寸は swordPivot 側で決める。
  swordPivot.add(root);
});

// ---------------------------------------------------------------- エフェクト
const slash = new THREE.Mesh(
  new THREE.TorusGeometry(0.62, 0.035, 6, 28, Math.PI*1.15),
  new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0}));
slash.visible = false;
stage.add(slash);

// 置いた瞬間の輪
const spawnRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.5, 0.03, 8, 48),
  new THREE.MeshBasicMaterial({color:0x8fd0ff, transparent:true, opacity:0}));
spawnRing.rotation.x = -Math.PI/2;
spawnRing.visible = false;
stage.add(spawnRing);
let spawnT = 1;

// ---------------------------------------------------------------- 2つの動作
const st = { t:0, swing:0, guard:0, guardTarget:0, shakeT:0, hit:false };
let guardHeld = false;    // 守備ボタンを押しているか
let poseDelay = 0;        // 押してから構えに入るまでの残り
const GUARD_IN = 0.5;     // ひざをつく動作は大きい。盾を構えるより早く入る。

const doSword = () => { st.swing = 1; st.hit = false; };
const guardOn = () => { if (!guardHeld){ guardHeld = true; poseDelay = GUARD_IN; } };
const guardOff = () => { guardHeld = false; };
const flash = b => { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 130); };

$('aSword').addEventListener('click', doSword);
const guardBtn = $('aGuard');         // 守備は押しっぱなしで構え続ける
guardBtn.addEventListener('pointerdown', e => { e.preventDefault(); guardOn(); });
['pointerup','pointercancel','pointerleave'].forEach(ev => guardBtn.addEventListener(ev, guardOff));

// 置く／置き直す
$('bPlace').addEventListener('click', () => {
  if (!ready) return;
  if (!ar.tryPlace()) return;
  spawnT = 0;                       // 置いた瞬間だけ輪を出す
});
$('bHome').addEventListener('click', () => { ar.home(); });

addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.key === '1'){ guardOn(); flash(guardBtn); }
  if (e.key === '2'){ doSword(); flash($('aSword')); }
  if (e.key === ' ' || e.key === 'Enter') $('bPlace').click();
});
addEventListener('keyup', e => { if (e.key === '1') guardOff(); });

// ---------------------------------------------------------------- ループ
const clock = new THREE.Clock();
const _camW = new THREE.Vector3();
const _spW = new THREE.Vector3(), _cpW = new THREE.Vector3();

// いま何がどこに居るか。歩いて見比べるための数。
function liveLine(){
  stage.getWorldPosition(_spW);
  _cpW.setFromMatrixPosition(camera.matrixWorld);
  const f = (v) => v.toFixed(2);
  const xyz = (v) => f(v.x) + ' ' + f(v.y) + ' ' + f(v.z);
  return 'AR=' + (ar.isXR() ? '入' : '貼付') +
         ' 置=' + (ar.isPlaced() ? '済' : '未') + BR +
         '像   ' + xyz(_spW) + BR +
         'カメラ ' + xyz(_cpW) + BR +
         '差   ' + f(_spW.distanceTo(_cpW)) + '  ← 歩いて、変わらない方が原因';
}

function tick(time, frame){
  dbg.frames++;
  try { update(frame); }
  catch(e){
    if (!dbg.err) dbg.err = (e.message || e) + ' | ' + ((e.stack || '').split(/\n/)[1] || '').trim();
  }
  renderer.render(scene, camera);
  if (dbg.frames % 20 === 0){
    if (LIVE) dbg.live = liveLine();
    renderDbg();
  }
}
function update(frame){
  const dt = Math.min(clock.getDelta(), 0.05);
  st.t += dt;
  // AR の面倒は AR の中で閉じる。ここで投げさせると、以降の演技と効果が
  // まとめて飛んで、キャラが固まる。置き場所が一回分ずれるだけで済ませる。
  try { ar.update(frame); }
  catch(e){ dbg.err = 'AR: ' + (e.message || e); }

  if (guardHeld) poseDelay = Math.max(0, poseDelay - dt);
  st.guardTarget = (guardHeld && poseDelay <= 0) ? 1 : 0;

  st.swing  = Math.max(0, st.swing  - dt*1.5);
  st.shakeT = Math.max(0, st.shakeT - dt);
  // 手ごたえは、剣が打点を通り過ぎたその一回だけ。
  if (st.swing > 0.001 && !st.hit && (1 - st.swing) >= HIT_AT){ st.hit = true; st.shakeT = 0.22; }
  st.guard += (st.guardTarget - st.guard) * (1 - Math.exp(-11*dt));

  const swingU = 1 - st.swing;
  const swingArc = Math.sin(swingU*Math.PI);

  // --- 置いた瞬間の輪
  if (spawnT < 1) spawnT = Math.min(1, spawnT + dt/0.7);
  spawnRing.visible = spawnT < 1;
  if (spawnRing.visible){
    spawnRing.scale.setScalar(0.4 + spawnT*2.2);
    spawnRing.material.opacity = (1-spawnT)*0.9;
  }
  const e = 1 - Math.pow(1 - spawnT, 3);

  // --- 骨。表も手順も src/elfpose.js にある。
  const p = poseWeights(st);
  if (rigged) applyPose({ bones, rest, root: chara, swordPivot }, p);
  else {
    swordPivot.rotation.z = -0.18 + Math.sin(st.t*1.7)*0.05 - swingArc*2.3;
    swordPivot.rotation.x = swingArc*0.55;
  }

  // --- 体。腕だけ動くと軽く見えるので、踏み込みとためを全身にも乗せる。
  const breathe = Math.sin(st.t*2.2)*0.012;
  // 節目は src/elfpose.js の poseWeights と同じ。ため 0.28、打点 0.56。
  // ここだけ別の刻みにすると、腰と剣が別々に動いて、振っている感じが消える。
  const uu = 1 - st.swing;
  const cc = st.swing > 0.001 ? (uu < 0.40 ? 0 : uu < 0.56 ? Math.sin((uu-0.40)/0.16*Math.PI/2) : Math.max(0, 1-(uu-0.56)/0.44)) : 0;
  const ww = st.swing > 0.001 ? (uu < 0.28 ? Math.sin(uu/0.28*Math.PI/2) : Math.max(0, 1-(uu-0.28)/0.12)) : 0;
  // ためで軽く反り、斬り下ろしで前へ体重を乗せる。逆にすると後退して見える。
  // 腕の振りだけでは「払った」に見えるので、体重の移りをここで大きく取る。
  chara.rotation.x = ww*0.16 - cc*0.46;
  // ひざをつくと腰が落ちる。骨を回しただけでは腰は下がらないので、体ごと沈める。
  // 沈めないと、宙に浮いたまま脚を折った形になる。
  chara.position.set(
    0,
    FOOT_SINK - kneelDrop(st.guard)
      + Math.min(0, (1-e)*-0.12 - cc*0.20) + (Math.random()-0.5)*st.shakeT*0.03,
    // キャラの正面は +Z。踏み込みは正でないと後退して見える。
    // ひざ立ちは前足が前へ出るので、その分だけ体を後ろへ引いて中心を保つ。
    -st.guard*0.16 + cc*0.38 - ww*0.12
  );
  chara.scale.set(1-breathe*0.5, 1+breathe, 1-breathe*0.5);

  blob.position.set(chara.position.x, 0.004, chara.position.z);
  blob.scale.setScalar(1.45 + st.guard*0.25);   // ひざ立ちは接地が広い

  slash.visible = st.swing > 0.02;
  if (slash.visible){
    slash.position.copy(chara.position);
    slash.position.y += HEAD_Y*0.8;
    _camW.setFromMatrixPosition(camera.matrixWorld);
    stage.worldToLocal(_camW);
    slash.lookAt(_camW);
    slash.rotateZ(-0.6 + swingU*1.9);
    slash.scale.setScalar(0.9 + swingU*0.55);
    slash.material.opacity = swingArc*0.85;
  }
}
