// ルイーズ。エクゾディアと同じ WebXR の置き方。カードは使わない。
//
//   ・右手に剣、左手に盾。ボタンは盾・威嚇・剣の3つ。
//   ・盾は押しっぱなしで構え続ける。
//
// 置く仕組みは src/arstage.js（エルフの剣士と共有）。
//
// 【カードをやめて変わったこと】位置・向き・実寸をカードが決めてくれない。
// 指で置き、接地は現実の面に任せる。カードの面内の回転を測って打ち消す仕掛けも、
// 見失ったときに最後の姿勢で残す仕掛けも、置き場所が動かなくなったので要らない。
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createStage } from './arstage.js';

const $ = (id) => document.getElementById(id);
const acts = $('acts'), hud = $('hud'), tip = $('tip');

// ---------------------------------------------------------------- 不具合の表示
// 普段は何も出さない。壊れたときだけ、その理由を一行で出す。
const dbgEl = $('dbg');
const dbg = { frames:0, models:{}, err:'' };
dbgEl.addEventListener('click', () => { dbgEl.style.display = 'none'; });
function renderDbg(){
  const broken = Object.keys(dbg.models).filter(k => !/^(OK|取得中)$/.test(dbg.models[k]));
  const msg = dbg.err ? dbg.err
            : broken.length ? broken.map(k => k + ': ' + dbg.models[k]).join(' / ')
            : '';
  dbgEl.style.display = msg ? 'block' : 'none';
  if (msg) dbgEl.textContent = msg;
}

// ---------------------------------------------------------------- 寸法
// Meshy は書き出しをどれも同じ箱に正規化するので、3体とも高さ 1.9 で出てくる。
// 背丈と握り位置はこちらで組み直す。すべて「キャラの背丈＝1.9」基準。
const BODY_H = 1.9;
const AR_H   = 0.25;      // AR は実寸（メートル）。机の上の置物として。
// 頭の骨は、渡した値の正が「下向き」になる。骨ごとに素の姿勢の向きが違うので、
// 同じ軸に同じ符号を渡しても、見た目の動く方向は骨ごとに変わる。
const HEAD_UP = -0.30;    // 負で顔が上を向く。カメラは上から見下ろすので少し起こす。
const HEAD_Y = 1.45;      // エフェクトの高さ
const SWORD_LEN  = 1.58;
const SWORD_ROLL = Math.PI/2;   // 刀身の軸まわりのひねり。平たい面の向きを決める。
const SHIELD_LEN = 1.25;
const SWORD_GRIP = 0.20;      // 柄の中ほどを握る
const SHIELD_PUSH = 0.18;     // 盾を逃がすのではなく、守備で腕を前へ出して避ける
const LEAN_FIX = 0.060;       // モデル自体が3.4度うしろに傾いているのを起こす
const FOOT_SINK = -0.05;      // 足を面に少し埋める。ぴったり0だと浮いて見える。

// ---------------------------------------------------------------- 場面
const ar = createStage({
  gl: $('gl'), cam: $('cam'), touch: $('touch'), ov: $('ov'),
  gate: $('gate'), note: $('note'), tapme: $('tapme'), tip,
  bodyH: BODY_H, arH: AR_H,
  onReady: (isXR) => {
    hud.classList.add('on');
    // 描き始めるのはカメラ／XR が立ち上がってから。エクゾディアと同じ順。
    // 先に回し始めても three は XR へ繋ぎ直してくれるが、実績のある順に揃える。
    renderer.setAnimationLoop(tick);
    tip.innerHTML = isXR
      ? '床や机に輪を合わせて「置く」<br>2本指、またはボタンで大きさと向き'
      : '1本指で位置、2本指で大きさと向き<br>置いたら「置く」';
  },
  onPlaced: () => {
    acts.classList.add('on');
    tip.innerHTML = '盾・威嚇・剣で追い払う<br>大きさと向きは変えられる。動かすなら「置き直す」';
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
const swordPivot  = new THREE.Group();            // 手のボーンが見つかればそちらへ移す
const shieldPivot = new THREE.Group();
chara.add(swordPivot, shieldPivot);

// リグありモデルのボーン。見つかれば腕を直接振る。無ければ武器だけ回す。
const bones = {};
const rest  = {};                                 // 素の姿勢。ここからの差分で動かす。
let rigged = false, ready = false;

const loader = new GLTFLoader();

// スキン付きメッシュの頂点はバインド行列で既に骨の空間に載っている。そこへ
// メッシュ側のワールド行列を重ねて測ると桁が狂う（このモデルは Armature に
// 0.01 倍が掛かっていて、100分の1の箱が返っていた）。スキン付きは素の箱を使う。
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

// 高さを揃え、指定した基準点が原点に来るように寄せる。
// anchorY: 0=モデルの底, 1=モデルの天。剣は握りが下寄りなので少し上を掴む。
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

load('models/rouise.glb', (root) => {
  fit(root, BODY_H, 0);            // 足を原点に
  root.rotation.x = LEAN_FIX;      // 足元を軸に、傾きぶんだけ起こす
  chara.add(root);

  // ボーンを名前で拾い、素の姿勢を控える。以降はここからの差分だけを回す。
  root.traverse(o => {
    if (o.isBone){ bones[o.name] = o; rest[o.name] = o.quaternion.clone(); }
  });
  rigged = !!(bones.RightArm && bones.LeftArm);
  loadAnims(root);
  console.log('[rig] ボーン ' + Object.keys(bones).length + '本, 使用可: ' + rigged);

  // 武器は手のボーンの子にする。これで腕の動きに完全に追従する。
  if (bones.RightHand){ bones.RightHand.add(swordPivot);  swordPivot.position.set(0,0,0); }
  if (bones.LeftHand){  bones.LeftHand.add(shieldPivot);  shieldPivot.position.set(0,0,0); }

  // ボーンは親のスケールを引き継ぐので、武器側で打ち消して実寸を決める
  const ws = new THREE.Vector3();
  if (bones.RightHand){ bones.RightHand.getWorldScale(ws); swordPivot.scale.setScalar(SWORD_LEN/ws.x); }
  if (bones.LeftHand){  bones.LeftHand.getWorldScale(ws);  shieldPivot.scale.setScalar(SHIELD_LEN/ws.x); }

  // 手の骨のローカル座標。Armature の 0.01 倍のせいで尺度が約100倍になるので、
  // 実行時に変換せず、手元で算出した値をそのまま置く。
  // この系の向き： +X = キャラの左、+Y = 下、+Z = 後ろ（右手の骨で実測）。
  // 剣は拳の外接箱の中心へ。重心より少し下がった、握りの穴のあたり。
  if (bones.RightHand) swordPivot.position.set(2.73, 14.18, -0.30);
  // 盾は通常時の見え方が正しかったので、骨の原点のままにする。
  if (bones.LeftHand)  shieldPivot.position.set(0, 0, 0);
  ready = true;
});
load('models/sword.glb', (root) => {
  fit(root, 1.0, SWORD_GRIP);      // 柄を握る位置が原点。実寸は swordPivot 側で決める。
  swordPivot.add(root);
});
load('models/shield.glb', (root) => {
  fit(root, 1.0, 0.5);             // 中心を原点に。実寸は shieldPivot 側で決める。
  // 向きは体の空間で毎フレーム決めるので、ここでは回さない。
  // 面の法線側へ少しだけ逃がして、拳が盾の裏に来るようにする。
  root.position.z += SHIELD_PUSH;
  shieldPivot.add(root);
});

// ---------------------------------------------------------------- モーション
// models/anim/ に置いたクリップがあれば、骨を数式で回すのをやめてそちらを再生する。
// 無ければ今までどおり数式で動く。ファイルが増えたら勝手に切り替わる。
//
// Mixamo は骨名がこのリグと同じ規則なので、書き出したものがそのまま乗る。
// ただし軌道の名前に接頭辞が付き、位置の単位も揃わないことがあるため、
// 骨名だけを取り出して結び直し、回転の軌道だけを使う。移動は捨てる。
// 位置まで拾うとキャラが置いた場所から歩き出す。
const ANIM_FILES = { idle:'idle', attack:'attack', guard:'guard', roar:'roar' };
const actions = {};
let mixer = null, idleAction = null;

function retarget(clip, boneNames){
  clip.tracks = clip.tracks.filter(t => {
    const dot = t.name.lastIndexOf('.');
    if (dot < 0) return false;
    const prop = t.name.slice(dot + 1);
    if (prop !== 'quaternion') return false;          // 回転だけ使う
    const seg = t.name.slice(0, dot).split(/[|:/]/).pop();
    if (!boneNames.has(seg)) return false;
    t.name = seg + '.' + prop;
    return true;
  });
  return clip;
}

function loadAnims(root){
  const boneNames = new Set(Object.keys(bones));
  if (!boneNames.size) return;
  mixer = new THREE.AnimationMixer(root);

  mixer.addEventListener('finished', (ev) => {
    if (idleAction && ev.action !== idleAction && ev.action !== actions.guard){
      idleAction.reset().fadeIn(0.2).play();
      ev.action.fadeOut(0.2);
    }
  });

  Object.keys(ANIM_FILES).forEach(role => {
    const url = 'models/anim/' + ANIM_FILES[role] + '.glb';
    new GLTFLoader().load(url, (g) => {
      const clip = g.animations && g.animations[0];
      if (!clip) return;
      retarget(clip, boneNames);
      if (!clip.tracks.length){ console.warn('[anim] 骨が合いません:', role); return; }
      const a = mixer.clipAction(clip);
      actions[role] = a;
      if (role === 'idle'){
        idleAction = a;
        a.setLoop(THREE.LoopRepeat, Infinity).play();
      } else if (role === 'guard'){
        a.setLoop(THREE.LoopRepeat, Infinity);
        a.setEffectiveWeight(0);
        a.play();
      } else {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      console.log('[anim] 読み込み:', role, clip.tracks.length + '軌道');
    }, undefined, () => { /* 無ければ数式のまま */ });
  });
}

function playAction(role){
  const a = actions[role];
  if (!a) return false;
  a.reset();
  a.setEffectiveWeight(1);
  a.fadeIn(0.1).play();
  if (idleAction) idleAction.fadeOut(0.1);
  return true;
}

// ---------------------------------------------------------------- エフェクト
const slash = new THREE.Mesh(
  new THREE.TorusGeometry(0.62, 0.035, 6, 28, Math.PI*1.15),
  new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0}));
slash.visible = false;
stage.add(slash);

const shock = new THREE.Mesh(
  new THREE.TorusGeometry(0.5, 0.028, 6, 40),
  new THREE.MeshBasicMaterial({color:0xe8202a, transparent:true, opacity:0}));
shock.visible = false;
stage.add(shock);

// 置いた瞬間の輪
const spawnRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.5, 0.03, 8, 48),
  new THREE.MeshBasicMaterial({color:0x8fd0ff, transparent:true, opacity:0}));
spawnRing.rotation.x = -Math.PI/2;
spawnRing.visible = false;
stage.add(spawnRing);
let spawnT = 1;

// ---------------------------------------------------------------- 3つの動作
const st = { t:0, swing:0, roar:0, guard:0, guardTarget:0, shakeT:0 };
let guardHeld = false;    // 盾ボタンを押しているか
let poseDelay = 0;        // 押してから構えに入るまでの残り
const GUARD_IN = 0.5;

const doSword = () => { st.swing = 1; st.shakeT = 0.26; playAction('attack'); };
const doRoar  = () => { st.roar  = 1; st.shakeT = 0.26; playAction('roar'); };
const guardOn = () => { if (!guardHeld){ guardHeld = true; poseDelay = GUARD_IN; } };
const guardOff = () => { guardHeld = false; };
const flash = b => { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 130); };

$('aSword').addEventListener('click', doSword);
$('aRoar').addEventListener('click', doRoar);
const shieldBtn = $('aShield');       // 盾は押しっぱなしで構え続ける
shieldBtn.addEventListener('pointerdown', e => { e.preventDefault(); guardOn(); });
['pointerup','pointercancel','pointerleave'].forEach(ev => shieldBtn.addEventListener(ev, guardOff));

// 置く／置き直す
$('bPlace').addEventListener('click', () => {
  if (!ready) return;
  if (!ar.tryPlace()) return;
  spawnT = 0;                       // 置いた瞬間だけ輪を出す
});
$('bHome').addEventListener('click', () => { ar.home(); });

addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.key === '1'){ guardOn(); flash(shieldBtn); }
  if (e.key === '2'){ doRoar();  flash($('aRoar')); }
  if (e.key === '3'){ doSword(); flash($('aSword')); }
  if (e.key === ' ' || e.key === 'Enter') $('bPlace').click();
});
addEventListener('keyup', e => { if (e.key === '1') guardOff(); });

// ---------------------------------------------------------------- 骨を回す道具
const _v3 = new THREE.Vector3();
const _qh = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const _pA = new THREE.Vector3(), _pB = new THREE.Vector3();
const _dA = new THREE.Vector3(), _dB = new THREE.Vector3();
const _dC = new THREE.Vector3(), _dir = new THREE.Vector3();
const _upY = new THREE.Vector3(0, 1, 0);
// 咆哮で腕を外へ広げる向き
const _dRoarR  = new THREE.Vector3(-0.88,  0.36, -0.30);
const _dRoarRF = new THREE.Vector3(-0.92,  0.28, -0.26);
const _dRoarL  = new THREE.Vector3( 0.88,  0.36, -0.30);
const _dRoarLF = new THREE.Vector3( 0.92,  0.28, -0.26);
// 守備で剣を持つ側を引いて構える向き
const _dGuardR  = new THREE.Vector3(-0.72, -0.52,  0.46);
const _dGuardRF = new THREE.Vector3(-0.58, -0.16,  0.80);
const _dGuardSw = new THREE.Vector3( 0.92,  0.12,  0.37);   // 刃先を体の内側へ
const _qRoll = new THREE.Quaternion();
// 骨の節を、指定した向きへ向ける。chara 空間は +X=キャラの左、+Y=上、+Z=正面。
// 角度の符号を積み上げると取り違えるので、向きそのものをベクトルで書く。
const _dirW = new THREE.Vector3(), _q3 = new THREE.Quaternion(), _qp = new THREE.Quaternion();
function aimBone(name, childName, dir){
  const b = bones[name], c = bones[childName];
  if (!b || !c) return;
  b.getWorldPosition(_pA); c.getWorldPosition(_pB);
  _v3.subVectors(_pB, _pA);
  if (_v3.lengthSq() < 1e-9) return;
  _v3.normalize();
  _dirW.copy(dir).normalize().applyQuaternion(_qc);      // chara 空間 → ワールド
  _q3.setFromUnitVectors(_v3, _dirW);                    // ワールドでの補正
  b.parent.getWorldQuaternion(_qp);
  b.quaternion.premultiply(_qp.clone().invert().multiply(_q3).multiply(_qp));
}

const _q2 = new THREE.Quaternion(), _e2 = new THREE.Euler();

// ボーンを素の姿勢からの差分で回す。軸はモデル自身の向き（X=右 Y=上 Z=前）で
// 指定し、ボーンの親空間へ移してから掛ける。こうすると骨の命名規約や
// 各ボーンのローカル軸の取り方に左右されない。
const _axis = new THREE.Vector3(), _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion(), _cq = new THREE.Quaternion();
function boneSet(name, rots){
  const b = bones[name];
  if (!b) return;
  b.quaternion.copy(rest[name]);
  if (!rots) return;
  const _guard = rest[name];
  b.parent.getWorldQuaternion(_pq).invert();
  for (const r of rots){
    if (!r[3]) continue;
    _axis.set(r[0], r[1], r[2]).applyQuaternion(_cq).applyQuaternion(_pq);
    if (_axis.lengthSq() < 1e-12) continue;
    _axis.normalize();
    b.quaternion.premultiply(_q.setFromAxisAngle(_axis, r[3]));
  }
  // 非数が混ざるとスキンメッシュ全体が消えるので、その場で素の姿勢に戻す
  const q = b.quaternion;
  if (!(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w))){
    b.quaternion.copy(_guard);
  }
}

// ---------------------------------------------------------------- ループ
const clock = new THREE.Clock();
const _camW = new THREE.Vector3();

function tick(time, frame){
  dbg.frames++;
  try { update(frame); }
  catch(e){
    if (!dbg.err) dbg.err = (e.message || e) + ' | ' + ((e.stack || '').split(/\n/)[1] || '').trim();
  }
  renderer.render(scene, camera);
  if (dbg.frames % 20 === 0) renderDbg();
}
function update(frame){
  const dt = Math.min(clock.getDelta(), 0.05);
  st.t += dt;
  ar.update(frame);

  if (guardHeld) poseDelay = Math.max(0, poseDelay - dt);
  st.guardTarget = (guardHeld && poseDelay <= 0) ? 1 : 0;

  st.swing  = Math.max(0, st.swing  - dt*2.0);
  st.roar   = Math.max(0, st.roar   - dt*0.75);   // 咆哮は長めに見せる
  st.shakeT = Math.max(0, st.shakeT - dt);
  st.guard += (st.guardTarget - st.guard) * (1 - Math.exp(-11*dt));

  const swingU = 1 - st.swing;
  const swingArc = Math.sin(swingU*Math.PI);
  // 咆哮は「開いて、保って、戻る」。山なりだと一瞬で終わって見える。
  const ru = 1 - st.roar;
  const roarU = st.roar <= 0 ? 0
              : ru < 0.22 ? Math.sin(ru/0.22 * Math.PI/2)
              : ru < 0.72 ? 1
              : Math.max(0, 1 - (ru-0.72)/0.28);

  // --- 置いた瞬間の輪
  if (spawnT < 1) spawnT = Math.min(1, spawnT + dt/0.7);
  spawnRing.visible = spawnT < 1;
  if (spawnRing.visible){
    spawnRing.scale.setScalar(0.4 + spawnT*2.2);
    spawnRing.material.opacity = (1-spawnT)*0.9;
  }
  const e = 1 - Math.pow(1 - spawnT, 3);

  const clipDriven = !!(actions.attack || actions.guard || actions.roar || idleAction);
  if (mixer){
    // 盾は押している間ずっとなので、重みで出し入れする
    if (actions.guard) actions.guard.setEffectiveWeight(st.guard);
    mixer.update(dt);
  }
  if (rigged && !clipDriven){
    // --- ボーンを直接回す。武器は手のボーンの子なので勝手に付いてくる。
    // 技どうしが同じ骨を取り合うので、骨ごとに角度を足し合わせてから一度だけ渡す。
    chara.getWorldQuaternion(_cq);
    const g = st.guard, r = roarU;
    const u = swingU;

    // 軽く斜めに払う。大振りの振りかぶりはやめ、小さくためてすっと抜く。
    const wind = u < 0.26 ? Math.sin(u/0.26 * Math.PI/2)
                          : Math.max(0, 1 - (u-0.26)/0.10);     // 解くのは一瞬
    const chop = u < 0.26 ? 0
               : u < 0.42 ? Math.sin((u-0.26)/0.16 * Math.PI/2) // 打点まで速く
                          : Math.max(0, 1 - (u-0.42)/0.58);     // 戻りはゆっくり
    const on = st.swing > 0.001 ? 1 : 0;
    const w = on*wind, c = on*chop;

    // 体幹のひねり。頭は背骨の子なので、頭の骨で横回転を 0 にしても
    // 親のひねりはそのまま伝わる。合計を控えておいて、首と頭で引く。
    // 薙ぎは体のひねりが要る。腕だけ振っても横へ流れて見えない。
    const tw0 = 0.08*w - 0.12*c;
    const tw1 = 0.15*w - 0.22*c;
    const tw2 = 0.12*w - 0.18*c;
    const twist = tw0 + tw1 + tw2;

    // 右腕は下でいったん素の姿勢に戻し、向きの指定で狙い直す。
    boneSet('RightArm', null);
    // 開くのは肩から。腕の骨だけを大きくひねると関節が外れて見える。
    boneSet('RightShoulder', [[0,0,1, -r*0.18], [0,1,0, r*0.12]]);   // 上げすぎると頭が埋まる
    boneSet('LeftShoulder',  [[0,0,1,  r*0.18], [0,1,0, -r*0.12], [1,0,0, -g*0.30]]);
    boneSet('RightForeArm', null);
    boneSet('LeftArm', null);
    boneSet('LeftForeArm', null);

    // 脚。腰を落とすので腿は前へ（負）、膝は後ろへ畳む（正）。
    boneSet('LeftUpLeg',  [[1,0,0, -g*0.55 + c*0.20]]);
    boneSet('RightUpLeg', [[1,0,0, -g*0.55 - c*0.15]]);
    boneSet('LeftLeg',    [[1,0,0,  g*1.10 - c*0.15]]);
    boneSet('RightLeg',   [[1,0,0,  g*1.10]]);

    // 体幹。守備は反り、咆哮も反り、打ち抜きは前へ入る。
    boneSet('Spine',   [[1,0,0, -g*0.28 + r*0.14], [0,1,0, tw0]]);
    boneSet('Spine01', [[0,1,0, tw1], [1,0,0, -g*0.16 - c*0.12]]);
    boneSet('Spine02', [[0,1,0, tw2], [1,0,0, r*0.30 - c*0.18 - g*0.08]]);

    // 武器の向きは、手の骨のローカル軸に預けない。あの軸がどう取られているかは
    // モデル側の都合で、預けると刀身が拳を横切って「刺さって」見える。
    // 体の空間で向きを決め、手の骨の回転を打ち消して実現する。位置は手に付いて回る。
    chara.updateMatrixWorld(true);   // 骨を回した直後なので、行列を作り直してから使う
    chara.getWorldQuaternion(_qc);

    // 腕は角度ではなく「どちらへ向けるか」で決める。成分は (キャラの左, 上, 正面)。
    // 右手はキャラの右側なので左成分が負になる。

    // 右腕。右へ深く引いてから、体の前を左へ薙ぎ払う。
    // 終点を正面に置くと突きに見えるので、左へ抜けきる向きにする。
    _dA.set(-0.40, -0.90,  0.06);           // 構え
    _dB.set(-0.74,  0.50, -0.44);           // ため：右へ深く、やや上後ろへ引く
    _dC.set( 0.58, -0.40,  0.71);           // 薙ぎ：正面を横切って左へ抜く
    _dir.copy(_dA).lerp(_dB, w).lerp(_dC, c);
    if (r > 0.01) _dir.lerp(_dRoarR, r);    // 咆哮では外へ広げる
    if (g > 0.01) _dir.lerp(_dGuardR, g);   // 守備では引いて構える
    aimBone('RightArm', 'RightForeArm', _dir);
    chara.updateMatrixWorld(true);

    // 前腕。ためで胸の前へ折り畳み、振り抜きで伸ばしきる。ここが肘の見せ場。
    _dA.set(-0.26, -0.95,  0.16);
    _dB.set(-0.56,  0.34, -0.76);           // 頭の右後ろへ畳む
    _dC.set( 0.63, -0.43,  0.65);           // 左へ振り抜きながら伸ばしきる
    _dir.copy(_dA).lerp(_dB, w).lerp(_dC, c);
    if (r > 0.01) _dir.lerp(_dRoarRF, r);
    if (g > 0.01) _dir.lerp(_dGuardRF, g);
    aimBone('RightForeArm', 'RightHand', _dir);
    chara.updateMatrixWorld(true);

    // 左腕。守備ではまっすぐ前へ伸ばす。肘を曲げると盾が顔へ寄ってめり込む。
    _dA.set( 0.38, -0.90,  0.05);           // 構え：下ろす
    _dB.set( 0.04,  0.02,  0.999);          // 守備：体の中心線上へまっすぐ前
    _dir.copy(_dA).lerp(_dB, g);
    if (r > 0.01) _dir.lerp(_dRoarL, r);
    aimBone('LeftArm', 'LeftForeArm', _dir);
    chara.updateMatrixWorld(true);

    // 前腕も同じ向きへ。上腕と揃えれば肘が伸びる。
    _dA.set( 0.26, -0.95,  0.14);
    _dB.set( 0.02,  0.04,  0.999);
    _dir.copy(_dA).lerp(_dB, g);
    if (r > 0.01) _dir.lerp(_dRoarLF, r);
    aimBone('LeftForeArm', 'LeftHand', _dir);
    chara.updateMatrixWorld(true);

    if (bones.RightHand){
      // 刀身（モデルの +Y）を向けたい方向へ。構えは刃先を正面、ためで右へ寝かせ、
      // 薙ぎで左へ抜く。
      _dA.set(-0.16,  0.10,  0.98);
      _dB.set(-0.80,  0.40, -0.45);
      _dC.set( 0.82, -0.20,  0.53);
      _dir.copy(_dA).lerp(_dB, w).lerp(_dC, c);
      if (g > 0.01) _dir.lerp(_dGuardSw, g);  // 守備では刃を横に寝かせて構える
      _dir.normalize();
      // 向けるだけだと軸まわりのひねりが定まらず、平たい面の向きが成り行きに
      // なる。明示的に回して横へ倒す。
      _q2.setFromUnitVectors(_upY, _dir);
      _qRoll.setFromAxisAngle(_upY, SWORD_ROLL);
      _q2.multiply(_qRoll);
      bones.RightHand.getWorldQuaternion(_qh).invert();
      swordPivot.quaternion.copy(_qh).multiply(_qc).multiply(_q2);
    }
    if (bones.LeftHand){
      // 盾の面はモデルの +Z。無回転で正面を向く。守備では正対させる。
      _e2.set(0.10 - g*0.10, 0, -0.30 + g*0.30, 'XYZ');
      _q2.setFromEuler(_e2);
      bones.LeftHand.getWorldQuaternion(_qh).invert();
      shieldPivot.quaternion.copy(_qh).multiply(_qc).multiply(_q2);
    }

    // 首と頭。正で下を向く。守備では首をすくめ、咆哮では天を仰ぐ。
    // 体幹のひねりを首と頭で打ち消し、攻撃中は顔を正面に保つ。
    boneSet('neck', [[1,0,0, g*0.18 - r*0.42], [0,1,0, -twist*0.35]]);
    boneSet('Head', [
      [1,0,0, HEAD_UP - r*0.95 + g*0.95 + c*0.20 - w*0.12],
      [0,1,0, -twist*0.65]   // 残りぶん。首と合わせてひねりが消える
    ]);
  } else if (!clipDriven){
    // --- リグが無いときは握りを支点に武器だけ回す
    swordPivot.rotation.z = -0.18 + Math.sin(st.t*1.7)*0.05 - swingArc*2.3;
    swordPivot.rotation.x = swingArc*0.55;
    shieldPivot.rotation.z =  0.15 + st.guard*0.55;
    shieldPivot.rotation.y = -st.guard*0.9;
  }

  // --- 体: 全身でも演技する
  const breathe = Math.sin(st.t*2.2)*0.012;
  const uu = 1 - st.swing;
  const cc = st.swing > 0.001 ? (uu < 0.35 ? 0 : uu < 0.55 ? Math.sin((uu-0.35)/0.20*Math.PI/2) : Math.max(0, 1-(uu-0.55)/0.45)) : 0;
  const ww = st.swing > 0.001 ? (uu < 0.35 ? Math.sin(uu/0.35*Math.PI/2) : Math.max(0, 1-(uu-0.35)/0.15)) : 0;
  // ためで軽く反り、振り下ろしで前へ体重を乗せる。逆にすると後退して見える。
  chara.rotation.x = ww*0.12 - cc*0.34 - roarU*0.14;
  chara.position.set(
    st.guard*-0.10,
    FOOT_SINK + Math.min(0, (1-e)*-0.12 - st.guard*0.24 - cc*0.13) + (Math.random()-0.5)*st.shakeT*0.03,
    // キャラの正面は +Z。踏み込みは正でないと後退して見える。
    -st.guard*0.10 + cc*0.26 - ww*0.07
  );
  blob.position.set(chara.position.x, 0.004, chara.position.z);
  blob.scale.setScalar(1.45);
  chara.scale.set(1-breathe*0.5, 1+breathe+roarU*0.05, 1-breathe*0.5);

  _camW.setFromMatrixPosition(camera.matrixWorld);
  stage.worldToLocal(_camW);

  slash.visible = st.swing > 0.02;
  if (slash.visible){
    slash.position.copy(chara.position);
    slash.position.y += HEAD_Y*0.8;
    slash.lookAt(_camW);
    slash.rotateZ(-0.6 + swingU*1.9);
    slash.scale.setScalar(0.9 + swingU*0.55);
    slash.material.opacity = swingArc*0.85;
  }

  shock.visible = st.roar > 0.02;
  if (shock.visible){
    shock.position.copy(chara.position);
    shock.position.y += HEAD_Y;
    shock.lookAt(_camW);
    shock.scale.setScalar(0.4 + (1-st.roar)*3.4);
    shock.material.opacity = Math.min(1, st.roar*1.6)*0.85;
  }
}
