import * as THREE from 'three';
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const $ = (id) => document.getElementById(id);
const gate = $('gate'), note = $('note'), tapme = $('tapme');
const acts = $('acts'), scan = $('scan'), touch = $('touch'), occ = $('occ');

// ---------------------------------------------------------------- 状態表示
// どこで止まっているかを推測しない。タップで薄くできる。
const dbgEl = $('dbg');
const dbg = { started:false, frames:0, models:{}, err:'', hits:0 };
dbgEl.addEventListener('click', () => dbgEl.classList.toggle('hidden'));
function renderDbg(){
  const v = mindar && mindar.video;
  const m = Object.keys(dbg.models).map(k => '  ' + k + ': ' + dbg.models[k]).join('\n');
  dbgEl.textContent =
    'MindAR : ' + (dbg.started ? '起動' : '未起動') +
    '\n映像   : ' + (v && v.videoWidth ? v.videoWidth + 'x' + v.videoHeight : '無し') +
    '\n描画   : ' + dbg.frames + ' フレーム' +
    '\n検出   : ' + (found ? '発見' : '待機') + '  (通算 ' + dbg.hits + ' 回)' +
    '\nモデル :\n' + (m || '  読み込み中') +
    (dbg.err ? '\nエラー : ' + dbg.err : '');
}

// ---------------------------------------------------------------- AR
// カードが位置・向き・実寸のすべてを教えてくれる。ジャイロで水平を推測し、
// 画角を決め打ちし、手で配置していた妥協が、ここで全部要らなくなる。
const mindar = new MindARThree({
  container: $('ar'),
  imageTargetSrc: 'targets.mind',
  uiLoading: 'no', uiScanning: 'no', uiError: 'no',
  maxTrack: 1,
  warmupTolerance: 0,      // 1フレーム一致すれば即「発見」。既定の5は渋すぎる。
  missTolerance: 30,       // 見失っても粘る。多少ブレても消えない。
  filterMinCF: 0.0001,     // 小さいほど追従が滑らか
  filterBeta: 0.001
});
const { renderer, scene, camera } = mindar;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const anchor = mindar.addAnchor(0);

// アンカーはカード面が XY、+Z がカードの外向き。X を +90° 回すと
// キャラの Y-up がカードの法線に揃い、以降は素直な Y-up 空間で書ける。
// 単位はカードの横幅＝1（実物のルイーズは 59mm 幅）。
const stand = new THREE.Group();
stand.rotation.x = Math.PI/2;
anchor.group.add(stand);

const chara = new THREE.Group();      // 立ち位置と向きを持つ入れ物
stand.add(chara);
const BASE_SCALE = 1.15;              // カード幅の 1.15 倍を背丈にする
chara.scale.setScalar(BASE_SCALE);

// 影は実物のカードの上に落ちる。接地はこれで完全に成立する。
const cardShadow = new THREE.Mesh(new THREE.PlaneGeometry(8,8),
  new THREE.ShadowMaterial({opacity:0.34}));
cardShadow.rotation.x = -Math.PI/2;
cardShadow.receiveShadow = true;
stand.add(cardShadow);

stand.add(new THREE.HemisphereLight(0xcfd8ff, 0x4a3a5a, 1.0));
const key = new THREE.DirectionalLight(0xfff6e8, 1.5);
key.position.set(1.6, 3.0, 1.8);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 0.5; key.shadow.camera.far = 12;
key.shadow.camera.left = -2.5; key.shadow.camera.right = 2.5;
key.shadow.camera.top = 2.5; key.shadow.camera.bottom = -2.5;
key.shadow.bias = -0.002;
stand.add(key);
stand.add(key.target);
const rim = new THREE.DirectionalLight(0x9fb4ff, 0.55);
rim.position.set(-2, 1.5, -2);
stand.add(rim);

// ---------------------------------------------------------------- モデル
// Meshy は書き出しをどれも同じ箱に正規化するので、3体とも高さ 1.9 で出てくる。
// 背丈と握り位置はこちらで組み直す。すべて「キャラの背丈＝1.9」基準。
const HEAD_Y = 1.45;                              // 描き文字とエフェクトの高さ
const HAND_R = new THREE.Vector3( 0.46, 0.86, 0.10);   // 剣を持つ手
const HAND_L = new THREE.Vector3(-0.46, 0.86, 0.10);   // 盾を持つ手
const SWORD_LEN  = 0.95;                          // キャラ背丈に対する剣の全長
const SHIELD_LEN = 0.62;                          // 同じく盾の高さ

const swordPivot  = new THREE.Group();            // 手のボーンが見つかればそちらへ移す
const shieldPivot = new THREE.Group();
swordPivot.position.copy(HAND_R);
shieldPivot.position.copy(HAND_L);
chara.add(swordPivot, shieldPivot);

// リグありモデルのボーン。見つかれば腕を直接振る。見つからなければ全身の演技で通す。
const bones = {};
const rest  = {};                                 // 素の姿勢。ここからの差分で動かす。
let rigged = false;

const loader = new GLTFLoader();
let loaded = 0;
const READY = 3;

// 高さを揃え、指定した基準点が原点に来るように寄せる。
// anchorY: 0=モデルの底, 1=モデルの天。剣は握りが下寄りなので少し上を掴む。
function fit(root, targetH, anchorY, spin){
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3(), center = new THREE.Vector3();
  box.getSize(size); box.getCenter(center);
  const k = targetH / (size.y || 1);
  root.scale.setScalar(k);
  root.position.set(-center.x*k, -(box.min.y + size.y*anchorY)*k, -center.z*k);
  if (spin) root.rotation.y = spin;
}

function load(url, onDone){
  const name = url.split('/').pop();
  dbg.models[name] = '取得中';
  renderDbg();
  loader.load(url, (g) => {
    g.scene.traverse(o => {
      if (o.isMesh){ o.castShadow = true; o.frustumCulled = false; }
    });
    try {
      onDone(g.scene);
      dbg.models[name] = 'OK';
    } catch(e){
      dbg.models[name] = '配置失敗 ' + (e.message || e);
    }
    loaded++; renderDbg();
  }, undefined, (err) => {
    dbg.models[name] = '失敗 ' + ((err && (err.message || err.type)) || '');
    loaded++; renderDbg();
  });
}

load('models/rouise.glb', (root) => {
  fit(root, 1.9, 0, 0);            // 足を原点に
  chara.add(root);

  // ボーンを名前で拾い、素の姿勢を控える。以降はここからの差分だけを回す。
  root.traverse(o => {
    if (o.isBone){
      bones[o.name] = o;
      rest[o.name] = o.quaternion.clone();
    }
  });
  rigged = !!(bones.RightArm && bones.LeftArm);
  console.log('[rig] ボーン ' + Object.keys(bones).length + '本, 使用可: ' + rigged);

  // 武器は手のボーンの子にする。これで腕の動きに完全に追従する。
  if (bones.RightHand){ bones.RightHand.add(swordPivot);  swordPivot.position.set(0,0,0); }
  if (bones.LeftHand){  bones.LeftHand.add(shieldPivot);  shieldPivot.position.set(0,0,0); }

  // ボーンは親のスケールを引き継ぐので、武器側で打ち消して実寸を決める
  const ws = new THREE.Vector3();
  if (bones.RightHand){ bones.RightHand.getWorldScale(ws); swordPivot.scale.setScalar(SWORD_LEN/ws.x); }
  if (bones.LeftHand){  bones.LeftHand.getWorldScale(ws);  shieldPivot.scale.setScalar(SHIELD_LEN/ws.x); }
});
load('models/sword.glb', (root) => {
  fit(root, 1.0, 0.22, 0);         // 握りのあたりを原点に。実寸は swordPivot 側で決める。
  swordPivot.add(root);
});
load('models/shield.glb', (root) => {
  fit(root, 1.0, 0.5, 0);          // 中心を原点に。実寸は shieldPivot 側で決める。
  root.rotation.y = Math.PI/2;     // 面を体の外へ向ける
  shieldPivot.add(root);
});

// ---------------------------------------------------------------- エフェクト
const slash = new THREE.Mesh(
  new THREE.TorusGeometry(0.62, 0.035, 6, 28, Math.PI*1.15),
  new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0}));
slash.visible = false;
stand.add(slash);

const shock = new THREE.Mesh(
  new THREE.TorusGeometry(0.5, 0.028, 6, 40),
  new THREE.MeshBasicMaterial({color:0xe8202a, transparent:true, opacity:0}));
shock.visible = false;
stand.add(shock);

// カードから出てくる瞬間の輪
const spawnRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.5, 0.03, 8, 48),
  new THREE.MeshBasicMaterial({color:0x8fd0ff, transparent:true, opacity:0}));
spawnRing.rotation.x = -Math.PI/2;
spawnRing.visible = false;
stand.add(spawnRing);

let found = false, spawnT = 0;
anchor.onTargetFound = () => {
  found = true; spawnT = 0; dbg.hits++;
  scan.classList.add('gone');
  acts.classList.add('on');
  loadHands();                    // 見つかってから読む。走査中の負荷を上げない。
};
anchor.onTargetLost = () => {
  found = false;
  scan.classList.remove('gone');
  acts.classList.remove('on');
};

// ---------------------------------------------------------------- 手の検出
// 用途は「どちらを向くか」と「遮蔽」だけ。技はボタンで出すので、
// 認識が落ちても撮影は破綻しない。
let handLM = null, handSeen = false, handLostT = 99, lastVT = -1;
const handPts = [];
for (let i=0; i<21; i++) handPts.push({x:0, y:0});
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

function loadHands(){
  if (handLM || loadHands.busy) return;
  loadHands.busy = true;
  import(MP).then(m =>
    m.FilesetResolver.forVisionTasks(MP + '/wasm').then(vision => {
      const opts = {
        baseOptions:{
          modelAssetPath:'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate:'GPU'
        },
        runningMode:'VIDEO', numHands:1
      };
      return m.HandLandmarker.createFromOptions(vision, opts).catch(() => {
        opts.baseOptions.delegate = 'CPU';
        return m.HandLandmarker.createFromOptions(vision, opts);
      });
    })
  ).then(lm => { handLM = lm; }).catch(() => {});
}

// MindAR は映像要素を自前で配置するので、cover を仮定せず実際の矩形から逆算する。
const videoRect = () => mindar.video ? mindar.video.getBoundingClientRect() : null;

function detectHand(){
  const v = mindar.video;
  if (!handLM || !v || v.readyState < 2 || v.currentTime === lastVT) return;
  lastVT = v.currentTime;
  const r = videoRect();
  if (!r || !r.width) return;
  try {
    const res = handLM.detectForVideo(v, performance.now());
    const lm = res && res.landmarks && res.landmarks[0];
    if (lm){
      for (let i=0; i<21 && i<lm.length; i++){
        handPts[i].x = r.left + lm[i].x * r.width;
        handPts[i].y = r.top  + lm[i].y * r.height;
      }
      handSeen = true; handLostT = 0;
    } else handSeen = false;
  } catch(e){}
}

// ---------------------------------------------------------------- 手による遮蔽
// キャラを手の後ろに回す。手の形にマスクを作り、そこだけ実写を 3D の上へ描き戻す。
// 合成色ではなく本物のピクセルなので、明るさも色も当然一致する。
const occCtx = occ.getContext('2d');
const maskCv = document.createElement('canvas');
const maskCtx = maskCv.getContext('2d');
const OCC_DPR = Math.min(devicePixelRatio, 1.5);
const CAN_BLUR = (typeof maskCtx.filter === 'string');
const PALM = [0,1,5,9,13,17];
const FINGERS = [[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]];

function sizeOcc(){
  occ.width  = Math.round(innerWidth  * OCC_DPR);
  occ.height = Math.round(innerHeight * OCC_DPR);
  occ.style.width  = innerWidth + 'px';
  occ.style.height = innerHeight + 'px';
}
addEventListener('resize', sizeOcc);
sizeOcc();

function traceChain(ctx, idx){
  ctx.beginPath();
  idx.forEach((n,i) => {
    const p = handPts[n];
    if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
  });
}

function drawOcclusion(){
  occCtx.setTransform(1,0,0,1,0,0);
  occCtx.clearRect(0, 0, occ.width, occ.height);
  const v = mindar.video;
  if (!(handSeen && handLostT < 0.5) || !v || v.readyState < 2) return;
  const r = videoRect();
  if (!r || !r.width) return;

  let minX=1e9, minY=1e9, maxX=-1e9, maxY=-1e9;
  for (const p of handPts){
    if (p.x<minX) minX=p.x;  if (p.x>maxX) maxX=p.x;
    if (p.y<minY) minY=p.y;  if (p.y>maxY) maxY=p.y;
  }
  const palmW = Math.hypot(handPts[5].x-handPts[17].x, handPts[5].y-handPts[17].y);
  const thick = Math.max(palmW*0.34, 10);
  const pad = thick + 16;
  minX-=pad; minY-=pad; maxX+=pad; maxY+=pad;
  const bw = maxX-minX, bh = maxY-minY;
  if (bw <= 0 || bh <= 0) return;

  const mw = Math.max(8, Math.round(bw*OCC_DPR)), mh = Math.max(8, Math.round(bh*OCC_DPR));
  if (maskCv.width !== mw)  maskCv.width  = mw;
  if (maskCv.height !== mh) maskCv.height = mh;
  maskCtx.setTransform(1,0,0,1,0,0);
  maskCtx.clearRect(0,0,mw,mh);
  maskCtx.globalCompositeOperation = 'source-over';
  maskCtx.setTransform(OCC_DPR, 0, 0, OCC_DPR, -minX*OCC_DPR, -minY*OCC_DPR);

  // 輪郭はぼかす。21点からの近似なので、硬い境界だと粗が出る。
  if (CAN_BLUR) maskCtx.filter = `blur(${Math.max(2, thick*0.17).toFixed(1)}px)`;
  maskCtx.fillStyle = maskCtx.strokeStyle = '#fff';
  maskCtx.lineCap = maskCtx.lineJoin = 'round';

  traceChain(maskCtx, PALM);
  maskCtx.closePath();
  maskCtx.lineWidth = thick*1.3;
  maskCtx.fill();
  maskCtx.stroke();
  FINGERS.forEach((f, i) => {
    maskCtx.lineWidth = thick * (i === 0 ? 1.15 : 0.95);   // 親指だけ太い
    traceChain(maskCtx, f);
    maskCtx.stroke();
  });

  // マスクの内側にだけ実写を残す
  maskCtx.setTransform(1,0,0,1,0,0);
  if (CAN_BLUR) maskCtx.filter = 'none';
  maskCtx.globalCompositeOperation = 'source-in';
  maskCtx.drawImage(v,
    (minX-r.left)/r.width*v.videoWidth,  (minY-r.top)/r.height*v.videoHeight,
    bw/r.width*v.videoWidth,             bh/r.height*v.videoHeight,
    0, 0, mw, mh);
  maskCtx.globalCompositeOperation = 'source-over';

  occCtx.drawImage(maskCv, Math.round(minX*OCC_DPR), Math.round(minY*OCC_DPR), mw, mh);
}

// ---------------------------------------------------------------- 3つの動作
// リグが無いので腕は動かない。剣と盾は握りを支点に回し、体は全身で演技する。
// 握り位置から生えたまま角度だけ変わるので、分離して浮くことはない。
const st = { t:0, swing:0, roar:0, guard:0, guardTarget:0, shakeT:0 };
let charaYaw = 0, autoYaw = 0;

const WORD_SWORD  = ['ガッ！','シャキン','スパッ','だめ'];
const WORD_ROAR   = ['グルルル','ギィッ','ウー…','いかく'];
const WORD_SHIELD = ['ガードッ','させない','ムッ','ふせぐ'];
const pick = a => a[(Math.random()*a.length)|0];
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const _proj = new THREE.Vector3();
function popWord(text, colorVar){
  _proj.set(0, HEAD_Y, 0).applyMatrix4(chara.matrixWorld);
  _proj.project(camera);
  const x = (_proj.x*0.5+0.5)*innerWidth, y = (-_proj.y*0.5+0.5)*innerHeight;
  const d = document.createElement('div');
  d.className = 'pop';
  d.textContent = text;
  d.style.color = cssVar(colorVar);
  d.style.left = THREE.MathUtils.clamp(x, 70, innerWidth-70) + 'px';
  d.style.top  = THREE.MathUtils.clamp(y - 70, 50, innerHeight-90) + 'px';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 720);
}

const doSword = () => { st.swing = 1; st.shakeT = 0.18; popWord(pick(WORD_SWORD), '--accent'); };
const doRoar  = () => { st.roar  = 1; st.shakeT = 0.26; popWord(pick(WORD_ROAR),  '--hot'); };
const guardOn = () => { st.guardTarget = 1; if (st.guard < 0.2) popWord(pick(WORD_SHIELD), '--accent'); };
const guardOff = () => { st.guardTarget = 0; };
const flash = b => { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 130); };

$('aSword').addEventListener('click', doSword);
$('aRoar').addEventListener('click', doRoar);
const shieldBtn = $('aShield');       // 盾は押しっぱなしで構え続ける
shieldBtn.addEventListener('pointerdown', e => { e.preventDefault(); guardOn(); });
['pointerup','pointercancel','pointerleave'].forEach(ev => shieldBtn.addEventListener(ev, guardOff));

addEventListener('keydown', e => {
  if (!found || e.repeat) return;
  if (e.key === '1'){ guardOn(); flash(shieldBtn); }
  if (e.key === '2'){ doRoar();  flash($('aRoar')); }
  if (e.key === '3'){ doSword(); flash($('aSword')); }
});
addEventListener('keyup', e => { if (e.key === '1') guardOff(); });

// ---------------------------------------------------------------- 大きさと向き
// 位置と接地はカードが決めるので、残る調整はこの2つだけ。ボタンは増やさない。
const pointers = new Map();
let pinchDist0 = 0, pinchScale0 = BASE_SCALE, twistPrev = 0;
const twoP = () => [...pointers.values()];
const pinchDistance = () => { const p = twoP(); return p.length<2 ? 0 : Math.hypot(p[0].x-p[1].x, p[0].y-p[1].y); };
const pinchAngle    = () => { const p = twoP(); return p.length<2 ? 0 : Math.atan2(p[1].y-p[0].y, p[1].x-p[0].x); };

touch.addEventListener('pointerdown', e => {
  touch.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if (pointers.size === 2){
    pinchDist0 = pinchDistance();
    pinchScale0 = chara.scale.x;
    twistPrev = pinchAngle();
  }
});
touch.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if (pointers.size < 2 || !pinchDist0) return;
  chara.scale.setScalar(THREE.MathUtils.clamp(pinchScale0 * (pinchDistance()/pinchDist0), 0.3, 4));
  const a = pinchAngle();
  let dA = a - twistPrev;                          // -PI..PI に畳んでから積む
  while (dA >  Math.PI) dA -= Math.PI*2;
  while (dA < -Math.PI) dA += Math.PI*2;
  charaYaw -= dA;
  twistPrev = a;
});
const endPointer = e => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist0 = 0;
};
touch.addEventListener('pointerup', endPointer);
touch.addEventListener('pointercancel', endPointer);

// ---------------------------------------------------------------- 起動
function boot(){
  if (gate.dataset.busy) return;
  gate.dataset.busy = '1';
  tapme.textContent = 'カメラを起動しています…';
  // 学習データが無いと MindAR は不親切なエラーで落ちるので、先に確かめる
  fetch('targets.mind', {method:'HEAD'}).then(r => {
    if (!r.ok) throw new Error('NO_TARGET');
    return mindar.start();
  }).then(() => {
    dbg.started = true; renderDbg();
    gate.classList.add('gone');
    setTimeout(() => { gate.style.display = 'none'; }, 520);
    renderer.setAnimationLoop(tick);
  }).catch(err => {
    dbg.err = (err && err.message) || String(err); renderDbg();
    tapme.style.display = 'none';
    note.textContent = (err && err.message === 'NO_TARGET')
      ? 'カードの学習データ（targets.mind）がまだ置かれていません。compile.html で作って、このフォルダに入れてください。'
      : 'はじめられませんでした（' + ((err && err.message) || err) + '）。カメラを許可してから開き直してください。';
    gate.dataset.busy = '';
  });
}
gate.addEventListener('click', boot);

// ---------------------------------------------------------------- ループ
const clock = new THREE.Clock();
const _camLocal = new THREE.Vector3(), _handW = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

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
  b.parent.getWorldQuaternion(_pq).invert();
  for (const r of rots){
    if (!r[3]) continue;
    _axis.set(r[0], r[1], r[2]).applyQuaternion(_cq).applyQuaternion(_pq).normalize();
    b.quaternion.premultiply(_q.setFromAxisAngle(_axis, r[3]));
  }
}

function tick(){
  const dt = Math.min(clock.getDelta(), 0.05);
  st.t += dt;
  dbg.frames++;
  if (dbg.frames % 20 === 0) renderDbg();

  if (found && spawnT < 1) spawnT = Math.min(1, spawnT + dt/0.7);

  st.swing  = Math.max(0, st.swing  - dt*2.6);
  st.roar   = Math.max(0, st.roar   - dt*1.5);
  st.shakeT = Math.max(0, st.shakeT - dt);
  st.guard += (st.guardTarget - st.guard) * (1 - Math.exp(-11*dt));

  detectHand();
  handLostT += dt;

  const swingU = 1 - st.swing;
  const swingArc = Math.sin(swingU*Math.PI);
  const roarU = Math.sin(Math.min(1, (1-st.roar)*1.4) * Math.PI);

  // --- カードから出てくる
  const e = 1 - Math.pow(1 - spawnT, 3);
  chara.visible = spawnT > 0.02;
  spawnRing.visible = spawnT > 0 && spawnT < 1;
  if (spawnRing.visible){
    spawnRing.scale.setScalar(0.4 + spawnT*2.2);
    spawnRing.material.opacity = (1-spawnT)*0.9;
  }

  // --- 手のほうを向く。手が無ければカメラのほうを向く。
  let targetYaw;
  if (handSeen && handLostT < 0.5){
    ndc.x = (handPts[8].x/innerWidth)*2 - 1;
    ndc.y = -(handPts[8].y/innerHeight)*2 + 1;
    raycaster.setFromCamera(ndc, camera);
    _handW.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, 3);
    stand.worldToLocal(_handW);
    targetYaw = Math.atan2(_handW.x, _handW.z);
  } else {
    _camLocal.setFromMatrixPosition(camera.matrixWorld);
    stand.worldToLocal(_camLocal);
    targetYaw = Math.atan2(_camLocal.x, _camLocal.z);
  }
  let dY = targetYaw - autoYaw;
  while (dY >  Math.PI) dY -= Math.PI*2;
  while (dY < -Math.PI) dY += Math.PI*2;
  autoYaw += dY * (1 - Math.exp(-5*dt));
  chara.rotation.y = autoYaw + charaYaw;

  if (rigged){
    // --- ボーンを直接回す。武器は手のボーンの子なので勝手に付いてくる。
    chara.getWorldQuaternion(_cq);
    const u = swingU;
    const wind = u < 0.30 ? u/0.30 : 1 - (u-0.30)/0.70;          // 振りかぶり
    const chop = u < 0.30 ? 0 : Math.sin((u-0.30)/0.70*Math.PI); // 斬り下ろし
    const on = st.swing > 0.001 ? 1 : 0;
    boneSet('RightArm',     [[1,0,0, on*(-1.40*wind + 2.40*chop)]]);
    boneSet('RightForeArm', [[1,0,0, on*(-0.70*wind + 1.30*chop)]]);
    boneSet('LeftArm',      [[1,0,0, st.guard*1.15], [0,1,0, -st.guard*0.55]]);
    boneSet('LeftForeArm',  [[1,0,0, st.guard*0.95]]);
    boneSet('Head',         [[1,0,0, -roarU*0.45]]);
    boneSet('Spine02',      [[1,0,0, -roarU*0.15 + swingArc*0.12]]);
  } else {
    // --- リグが無いときは握りを支点に武器だけ回す
    swordPivot.rotation.z = -0.18 + Math.sin(st.t*1.7)*0.05 - swingArc*2.3;
    swordPivot.rotation.x = swingArc*0.55;
    shieldPivot.rotation.z =  0.15 + st.guard*0.55;
    shieldPivot.rotation.y = -st.guard*0.9;
    shieldPivot.position.set(
      HAND_L.x - st.guard*0.10,
      HAND_L.y + st.guard*0.34,
      HAND_L.z + st.guard*0.22
    );
  }

  // --- 体: 腕が動かないぶん、全身で演技する
  const breathe = Math.sin(st.t*2.2)*0.012;
  chara.rotation.x = -swingArc*0.20 - roarU*0.12;
  // 構えると盾側の肩を前に出して半身になる。腕が上がらないぶんをこれで補う。
  chara.rotation.z = st.guard*0.10;
  chara.position.set(
    st.guard*-0.10,
    (1-e)*-0.45 + swingArc*0.07 + roarU*0.05 + (Math.random()-0.5)*st.shakeT*0.03,
    st.guard*0.08 + swingArc*0.10
  );
  const grow = chara.scale.x;
  chara.scale.set(grow*(1-breathe*0.5), grow*(1+breathe+roarU*0.05), grow*(1-breathe*0.5));

  slash.visible = st.swing > 0.02;
  if (slash.visible){
    slash.position.copy(chara.position);
    slash.position.y += HEAD_Y*grow*0.8;
    _handW.setFromMatrixPosition(camera.matrixWorld);
    stand.worldToLocal(_handW);
    slash.lookAt(_handW);
    slash.rotateZ(-0.6 + swingU*1.9);
    slash.scale.setScalar(grow * (0.9 + swingU*0.55));
    slash.material.opacity = swingArc*0.85;
  }

  shock.visible = st.roar > 0.02;
  if (shock.visible){
    shock.position.copy(chara.position);
    shock.position.y += HEAD_Y*grow;
    _handW.setFromMatrixPosition(camera.matrixWorld);
    stand.worldToLocal(_handW);
    shock.lookAt(_handW);
    shock.scale.setScalar(grow * (0.5 + (1-st.roar)*2.6));
    shock.material.opacity = st.roar*0.7;
  }

  renderer.render(scene, camera);
  drawOcclusion();          // 3D を描いたあとに手を被せる
}
