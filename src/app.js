import * as THREE from 'three';
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const $ = (id) => document.getElementById(id);
const gate = $('gate'), note = $('note'), tapme = $('tapme');
const acts = $('acts'), touch = $('touch'), occ = $('occ');

// ---------------------------------------------------------------- 不具合の表示
// 普段は何も出さない。壊れたときだけ、その理由を一行で出す。
const dbgEl = $('dbg');
const dbg = { started:false, frames:0, models:{}, err:'', hits:0 };
dbgEl.addEventListener('click', () => { dbgEl.style.display = 'none'; });
function renderDbg(){
  const broken = Object.keys(dbg.models).filter(k => !/^(OK|取得中)$/.test(dbg.models[k]));
  const msg = dbg.err ? dbg.err
            : broken.length ? broken.map(k => k + ': ' + dbg.models[k]).join(' / ')
            : '';
  dbgEl.style.display = msg ? 'block' : 'none';
  if (msg) dbgEl.textContent = msg;
}

// ---------------------------------------------------------------- カメラの解像度
// MindAR は解像度を指定せずにカメラを開くため、端末が低い既定値（480x640）を
// 返してくることがある。カードの模様から特徴点を拾って照合する方式では、
// 解像度と鮮明さがそのまま追跡の安定性と再検出の可否に直結する。要求を上書きする。
const _gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
// 小さく写ったカードを拾えるかどうかは、ほぼ解像度で決まる。取れるだけ取りに行く。
navigator.mediaDevices.getUserMedia = (c) => _gum({
  audio: false,
  video: Object.assign({ facingMode: 'environment' },
                       (c && typeof c.video === 'object') ? c.video : null,
                       { width: {ideal: 3840}, height: {ideal: 2160},
                         frameRate: {ideal: 30},
                         advanced: [{width: 3840}, {width: 2560}, {width: 1920}, {width: 1280}] })
}).then(st => {
  const t = st.getVideoTracks()[0];
  if (!t) return st;
  const s0 = t.getSettings();
  console.log('[camera]', JSON.stringify(s0));
  // 低い解像度で開かれたら、後から上げられないか試す
  if ((s0.width || 0) < 1280 && t.applyConstraints){
    return t.applyConstraints({ width: {ideal: 1920}, height: {ideal: 1080} })
      .then(() => { console.log('[camera] 再要求後', JSON.stringify(t.getSettings())); return st; })
      .catch(() => st);
  }
  return st;
});

// ---------------------------------------------------------------- AR
// カードが位置・向き・実寸のすべてを教えてくれる。ジャイロで水平を推測し、
// 画角を決め打ちし、手で配置していた妥協が、ここで全部要らなくなる。
const mindar = new MindARThree({
  container: $('ar'),
  imageTargetSrc: 'targets.mind',
  uiLoading: 'no', uiScanning: 'no', uiError: 'no',
  maxTrack: 1,
  warmupTolerance: 1,      // 既定の5は渋い。0にすると再検出しなくなるので1にする。
  missTolerance: 30,       // 粘りすぎると崩れた姿勢を抱え続ける。
  filterMinCF: 0.0008,     // 小さいほど滑らかだが遅れる。暴れるので少し戻す。
  filterBeta: 0.005
});
const { renderer, scene, camera } = mindar;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const anchor = mindar.addAnchor(0);

// アンカーはカード面が XY、+Z がカードの外向き。X を +90° 回すと
// キャラの Y-up がカードの法線に揃い、以降は素直な Y-up 空間で書ける。
// 単位はカードの横幅＝1（実物のルイーズは 59mm 幅）。
let everFound = false, lostT = 0, restarting = false;
let cardAngle = 0;        // カードの面内の傾き
let snapIdx = 0;          // それを90度単位に丸めた段
let baseSnap = null;      // 最初に見つけたときの段。ここを基準に打ち消す。
let angleInit = false;    // 一度でも実測値を入れたか

// カードが見えている間は姿勢を写して追従し、見失ったら最後の姿勢のまま残す。
// アンカーの子にすると見失った瞬間に消えるので、場面へ直接置いて行列だけ写す。
const world = new THREE.Group();
scene.add(world);

const stand = new THREE.Group();
stand.rotation.x = Math.PI/2;
world.add(stand);

// カードの中心よりわずかに奥（印刷面の上辺側）へ寄せる。手前に余白ができて、
// 手を伸ばす動きが入る余地が生まれる。stand 空間の -Z がカードの奥にあたる。
const FACE_YAW = Math.PI;   // カードの下辺側（読む人がいる側）を正面として構える
const STAND_Z = 0.72;   // アンカーのYは画像座標系で下向き。奥は +Z 側になる。

const chara = new THREE.Group();      // 立ち位置と向きを持つ入れ物
stand.add(chara);
const BASE_SCALE = 1.15;
let baseScale = BASE_SCALE;   // 呼吸で毎フレーム掛けると累積するので基準を別に持つ              // カード幅の 1.15 倍を背丈にする
chara.scale.setScalar(BASE_SCALE);

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
stand.add(blob);

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
// 頭の骨は、渡した値の正が「下向き」になる。骨ごとに素の姿勢の向きが違うので、
// 同じ軸に同じ符号を渡しても、見た目の動く方向は骨ごとに変わる。腕と揃わない。
const HEAD_UP = -0.30;    // 正で顔が上を向く（headfront の骨の位置から実測）   // カメラは上から見下ろすので、頭を少し上向きに
const HEAD_Y = 1.45;                              // 描き文字とエフェクトの高さ
const HAND_R = new THREE.Vector3( 0.46, 0.86, 0.10);   // 剣を持つ手
const HAND_L = new THREE.Vector3(-0.46, 0.86, 0.10);   // 盾を持つ手
const SWORD_LEN  = 1.58;   // 1.5倍
const SWORD_ROLL = Math.PI/2;   // 刀身の軸まわりのひねり。平たい面の向きを決める。      // 断面を測ると 10-30% が柄、30-50% が鍔、以降が刀身。
const SHIELD_LEN = 1.25;
const SWORD_GRIP = 0.20;      // 柄の中ほどを握る
const SHIELD_PUSH = 0.18;   // 盾を逃がすのではなく、守備で腕を前へ出して避ける
const GRIP_OUT  = 0.085;   // 手首から拳へずらす量。骨は手首にあるので、そのままだと刺さる。
const SHIELD_OUT = 0.055;   // 盾を面の側へ逃がす量。守備で顔がめり込むので深めに。     // 盾を手から外へ逃がす量。拳が面から出ないように。
const LEAN_FIX = 0.060;       // モデル自体が3.4度うしろに傾いているのを起こす
const FOOT_SINK = -0.05;      // 足を面に少し埋める。ぴったり0だと浮いて見える。

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
// スキン付きメッシュの頂点はバインド行列で既に骨の空間に載っている。
// そこへメッシュ側のワールド行列を重ねて測ると桁が狂う（このモデルは
// Armature に 0.01 倍が掛かっていて、100分の1の箱が返っていた）。
// スキン付きは素の箱、それ以外はワールド行列を掛けた箱を使う。
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
function fit(root, targetH, anchorY, spin){
  const box = modelBox(root);
  const size = new THREE.Vector3(), center = new THREE.Vector3();
  box.getSize(size); box.getCenter(center);
  const k = (isFinite(size.y) && size.y > 1e-6) ? targetH / size.y : 1;
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
  root.rotation.x = LEAN_FIX;      // 足元を軸に、傾きぶんだけ起こす
  chara.add(root);

  // ボーンを名前で拾い、素の姿勢を控える。以降はここからの差分だけを回す。
  root.traverse(o => {
    if (o.isBone){
      bones[o.name] = o;
      rest[o.name] = o.quaternion.clone();
    }
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
});
load('models/sword.glb', (root) => {
  fit(root, 1.0, SWORD_GRIP, 0);   // 柄を握る位置が原点。実寸は swordPivot 側で決める。
  swordPivot.add(root);
});
load('models/shield.glb', (root) => {
  fit(root, 1.0, 0.5, 0);          // 中心を原点に。実寸は shieldPivot 側で決める。
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
// 位置まで拾うとキャラがカードの外へ歩き出す。
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
  found = true; dbg.hits++;
  if (!everFound) spawnT = 0;     // 出てくる演出は最初の一度だけ
  acts.classList.add('on');
  loadHands();                    // 見つかってから読む。走査中の負荷を上げない。
};
anchor.onTargetLost = () => {
  found = false;
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
const st = { t:0, swing:0, roar:0, guard:0, guardTarget:0, shakeT:0, autoCd:0 };
const FACE_TRIM = 0;   // 正面の微調整（ラジアン）。ずれが残ればここだけ動かす。
let guardHeld = false;    // 盾ボタンを押しているか
let poseDelay = 0;        // 押してから構えに入るまでの残り
let freezeT = 0;          // 離してからも留まる残り
const GUARD_IN = 1.2;     // 固定してから構えるまでの間
const GUARD_OUT = 1.2;    // 構えを解いてから追従に戻るまでの間

const doSword = () => { st.swing = 1; st.shakeT = 0.18; playAction('attack'); };
const doRoar  = () => { st.roar  = 1; st.shakeT = 0.26; playAction('roar'); };
const guardOn = () => { if (!guardHeld){ guardHeld = true; poseDelay = GUARD_IN; } };
const guardOff = () => { if (guardHeld){ guardHeld = false; freezeT = GUARD_OUT; } };
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
let pinchDist0 = 0, pinchScale0 = BASE_SCALE;
const twoP = () => [...pointers.values()];
const pinchDistance = () => { const p = twoP(); return p.length<2 ? 0 : Math.hypot(p[0].x-p[1].x, p[0].y-p[1].y); };

touch.addEventListener('pointerdown', e => {
  touch.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if (pointers.size === 2){
    pinchDist0 = pinchDistance();
    pinchScale0 = baseScale;
  }
});
touch.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if (pointers.size < 2 || !pinchDist0) return;
  // 大きさだけ。向きはカードが決めるので、手で回す操作は置かない。
  // 画面全体が受け付けるため、持ち方次第で意図せず回ってしまっていた。
  baseScale = THREE.MathUtils.clamp(pinchScale0 * (pinchDistance()/pinchDist0), 0.3, 4);
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
    // 実際に開かれた解像度を数秒だけ知らせる。遠くのカードを拾えるかはここで決まる。
    setTimeout(() => {
      const v = mindar.video;
      if (!v || !v.videoWidth) return;
      const w = v.videoWidth, h = v.videoHeight;
      dbgEl.style.display = 'block';
      dbgEl.textContent = 'カメラ ' + w + 'x' + h +
        (w < 1280 ? '（低い。遠いカードは拾いにくい）' : '');
      setTimeout(() => { dbgEl.style.display = 'none'; }, 6000);
    }, 1200);
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
const _v3 = new THREE.Vector3(), _cardUp = new THREE.Vector3();
const _qh = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const _qh2 = new THREE.Quaternion(), _ws = new THREE.Vector3();
const _pA = new THREE.Vector3(), _pB = new THREE.Vector3();
const _dA = new THREE.Vector3(), _dB = new THREE.Vector3();
const _dC = new THREE.Vector3(), _dir = new THREE.Vector3();
const _upY = new THREE.Vector3(0, 1, 0);
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

function gripShift(handName, foreName, pivot, dist){
  const hb = bones[handName], fb = bones[foreName];
  if (!hb || !fb) return;
  hb.getWorldPosition(_pA); fb.getWorldPosition(_pB);
  _v3.subVectors(_pA, _pB);
  if (_v3.lengthSq() < 1e-9) return;
  _v3.normalize().multiplyScalar(dist);
  hb.getWorldQuaternion(_qh2).invert();
  _v3.applyQuaternion(_qh2);
  hb.getWorldScale(_ws);
  pivot.position.set(_v3.x/(_ws.x||1), _v3.y/(_ws.y||1), _v3.z/(_ws.z||1));
}
const _q2 = new THREE.Quaternion(), _e2 = new THREE.Euler();
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

function tick(){
  dbg.frames++;
  try { update(); }
  catch(e){
    if (!dbg.err) dbg.err = (e.message || e) + ' | ' + ((e.stack || '').split(/\n/)[1] || '').trim();
  }
  renderer.render(scene, camera);
  drawOcclusion();
  if (dbg.frames % 20 === 0) renderDbg();
}

function update(){
  const dt = Math.min(clock.getDelta(), 0.05);
  st.t += dt;

  // 盾ボタン。押したら即その場に固定し、少し置いてから構える。
  // 離したら構えを解き、そのままもう少し留まってから追従に戻る。
  if (guardHeld) poseDelay = Math.max(0, poseDelay - dt);
  else           freezeT  = Math.max(0, freezeT  - dt);
  const frozen = guardHeld || freezeT > 0;

  if (found){
    everFound = true;
    anchor.group.updateWorldMatrix(true, false);
    const m = anchor.group.matrixWorld.elements;
    let ok = true;
    for (let i = 0; i < 16; i++) if (!Number.isFinite(m[i])) ok = false;
    // 追跡が崩れると、縦横の伸縮が不揃いな行列が返る。そのまま使うと
    // キャラが潰れて床に貼りついたようになる。歪んだフレームは捨てる。
    if (ok){
      const sx = Math.hypot(m[0], m[1], m[2]);
      const sy = Math.hypot(m[4], m[5], m[6]);
      const sz = Math.hypot(m[8], m[9], m[10]);
      const lo = Math.min(sx, sy, sz), hi = Math.max(sx, sy, sz);
      if (lo < 1e-4 || hi / lo > 1.25) ok = false;
    }
    // 防御中はカードの姿勢を写さない。カードを回そうが動かそうが、
    // 押した瞬間の場所に踏みとどまって構え続ける。
    if (ok && !frozen) anchor.group.matrixWorld.decompose(world.position, world.quaternion, world.scale);

    // カードの面内の回転だけを測る。カードを回す操作は攻守の切り替えであって、
    // キャラを動かす操作ではない。回した分をあとで打ち消して、その場に留める。
    _cardUp.set(0,1,0).transformDirection(anchor.group.matrixWorld);
    _cardUp.transformDirection(camera.matrixWorldInverse);
    const a = Math.atan2(_cardUp.x, _cardUp.y);
    if (Number.isFinite(a)){
      if (!angleInit){
        // 初回は均さずそのまま入れる。0 から近づけている途中の値を基準に
        // してしまうと、実際は縦置きなのに「2段ずれている」と誤認して
        // 180度回してしまう。位置は手前へ、向きは背面へ飛ぶ。
        cardAngle = a;
        angleInit = true;
      } else {
        let d = a - cardAngle;
        while (d >  Math.PI) d -= Math.PI*2;
        while (d < -Math.PI) d += Math.PI*2;
        cardAngle += d * (1 - Math.exp(-8*dt));    // 手ぶれを均す
      }
      // 90度単位に丸める。中心付近でだけ段を切り替えて、斜めでもガタつかせない。
      const q = cardAngle / (Math.PI/2);
      const nearest = Math.round(q);
      if (Math.abs(q - nearest) < 0.35) snapIdx = ((nearest % 4) + 4) % 4;
      // 最初に見つけた向きを基準にする。絶対値で取ると画像座標系の都合で
      // 縦置きでも180度ずれるので、必ず相対で測る。
      if (baseSnap === null) baseSnap = snapIdx;
    }
  }

  // 面内の回転を打ち消す。stand.rotation は X→Y→Z の順なので Y が法線まわり。
  // ここも固定中は触らない。位置だけ止めても、この回転が生きていると
  // カードを回した分だけキャラが回ってしまう。
  if (baseSnap !== null && !frozen){
    const rel = (((snapIdx - baseSnap) % 4) + 4) % 4;
    let ds = -rel * (Math.PI/2) - stand.rotation.y;
    while (ds >  Math.PI) ds -= Math.PI*2;
    while (ds < -Math.PI) ds += Math.PI*2;
    if (Number.isFinite(ds)) stand.rotation.y += ds * (1 - Math.exp(-10*dt));
  }

  world.visible = everFound;

  // 盾はボタンだけで決める。カードの傾きから守備表示を読む仕組みは、
  // 傾きの推定が揺れて姿勢が落ち着かなかったので外した。
  st.guardTarget = (guardHeld && poseDelay <= 0) ? 1 : 0;

  // 手が近づいたら自動で斬る
  st.autoCd = Math.max(0, st.autoCd - dt);
  if (everFound && handSeen && handLostT < 0.4 && st.autoCd <= 0){
    _v3.set(0, HEAD_Y*0.55, 0).applyMatrix4(chara.matrixWorld).project(camera);
    const cx = (_v3.x*0.5 + 0.5)*innerWidth, cy = (-_v3.y*0.5 + 0.5)*innerHeight;
    const reach = Math.min(innerWidth, innerHeight)*0.32;
    if (Math.hypot(handPts[8].x - cx, handPts[8].y - cy) < reach){
      doSword();
      st.autoCd = 1.1;
    }
  }
  if (everFound && spawnT < 1) spawnT = Math.min(1, spawnT + dt/0.7);

  st.swing  = Math.max(0, st.swing  - dt*2.0);
  st.roar   = Math.max(0, st.roar   - dt*0.75);   // 咆哮は長めに見せる
  st.shakeT = Math.max(0, st.shakeT - dt);
  st.guard += (st.guardTarget - st.guard) * (1 - Math.exp(-11*dt));

  detectHand();
  handLostT += dt;

  const swingU = 1 - st.swing;
  const swingArc = Math.sin(swingU*Math.PI);
    // 咆哮は「開いて、保って、戻る」。山なりだと一瞬で終わって見える。
  const ru = 1 - st.roar;
  const roarU = st.roar <= 0 ? 0
              : ru < 0.22 ? Math.sin(ru/0.22 * Math.PI/2)
              : ru < 0.72 ? 1
              : Math.max(0, 1 - (ru-0.72)/0.28);

  // --- カードから出てくる
  const e = 1 - Math.pow(1 - spawnT, 3);
  chara.visible = true;   // 表示の可否はアンカー（カード追従）に任せる
  spawnRing.visible = spawnT > 0 && spawnT < 1;
  if (spawnRing.visible){
    spawnRing.scale.setScalar(0.4 + spawnT*2.2);
    spawnRing.material.opacity = (1-spawnT)*0.9;
  }

  // --- 向きはカードに対して固定する。カメラや手を追わせると、立ち位置や
  // 撮る角度によって毎回ちがう方を向いてしまう。カードの下辺側（印刷を読む人が
  // いる側）を正面として構えさせ、ひねりの手動調整ぶんだけを足す。
  if (!Number.isFinite(baseScale) || baseScale <= 0) baseScale = BASE_SCALE;
  chara.rotation.y = FACE_YAW + FACE_TRIM;

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
    const wind = u < 0.22 ? Math.sin(u/0.22 * Math.PI/2)
                          : Math.max(0, 1 - (u-0.22)/0.12);
    const chop = u < 0.22 ? 0
               : u < 0.48 ? Math.sin((u-0.22)/0.26 * Math.PI/2)
                          : Math.max(0, 1 - (u-0.48)/0.52);
    const on = st.swing > 0.001 ? 1 : 0;
    const w = on*wind, c = on*chop;

    // 【向きの決まり】X軸まわりは正が前傾・下向き。腕は正で後ろへ上がる。
    // ここを取り違えて全部反対に入れていたので、以下は意図を明記しておく。

    // 右腕。ためで肩の上へ担ぎ（後ろ＝正）、打ち抜きで前へ振り下ろす（前＝負）。
    // 右腕は下でいったん素の姿勢に戻し、向きの指定で狙い直す。
    boneSet('RightArm', null);
    // 開くのは肩から。腕の骨だけを大きくひねると関節が外れて見える。
    boneSet('RightShoulder', [[0,0,1, -r*0.18], [0,1,0, r*0.12]]);   // 上げすぎると頭が埋まる
    boneSet('LeftShoulder',  [[0,0,1,  r*0.18], [0,1,0, -r*0.12], [1,0,0, -g*0.30]]);
    boneSet('RightForeArm', null);

    // 左腕。守備では前へ出す（前＝負）。上へ上げるのではない。
    boneSet('LeftArm', [
      [1,0,0, -g*1.85 + r*0.25],   // 守備は腕を深く前へ。盾を逃がすより確実。
      [0,1,0, -g*1.35 - r*0.18],   // 負で体の正面へ寄る。守備では腹の前まで持ってくる。
      [0,0,1,  g*0.15 + r*0.72]
    ]);
    boneSet('LeftForeArm', [
      [1,0,0, -g*1.45],
      [0,1,0, -g*0.80],
      [0,0,1, -r*0.18]
    ]);

    // 脚。腰を落とすので腿は前へ（負）、膝は後ろへ畳む（正）。
    boneSet('LeftUpLeg',  [[1,0,0, -g*0.55 + c*0.20]]);
    boneSet('RightUpLeg', [[1,0,0, -g*0.55 - c*0.15]]);
    boneSet('LeftLeg',    [[1,0,0,  g*1.10 - c*0.15]]);
    boneSet('RightLeg',   [[1,0,0,  g*1.10]]);

    // 体幹。守備は前へ屈み（負）、咆哮は反る（正）、打ち抜きは前へ入る（負）。
    boneSet('Spine',   [[1,0,0, -g*0.28 + r*0.14], [0,1,0, 0.18*w - 0.24*c]]);
    boneSet('Spine01', [[0,1,0, 0.40*w - 0.55*c], [1,0,0, -g*0.16 - c*0.12]]);
    boneSet('Spine02', [[0,1,0, 0.30*w - 0.42*c], [1,0,0, r*0.30 - c*0.18 - g*0.08]]);

    // 武器の向きは、手の骨のローカル軸に預けない。あの軸がどう取られているかは
    // モデル側の都合で、預けると刀身が拳を横切って「刺さって」見える。
    // 体の空間で向きを決め、手の骨の回転を打ち消して実現する。位置は手に付いて回る。
    chara.updateMatrixWorld(true);   // 骨を回した直後なので、行列を作り直してから使う
    chara.getWorldQuaternion(_qc);

    // 手のボーンは拳ではなく手首にある。そのまま武器を置くと手首に刺さって見える。
    // 前腕から手へ伸びる向きへ少しずらし、拳の中に柄が来るようにする。
    // 向きは骨の位置から出るので、当てずっぽうにならない。
    // 右腕と剣は「向き」で決める。構え → ため（後ろ）→ 振り抜き（前下）。
    // 成分は (キャラの左, 上, 正面)。右手なので左成分は負、つまりキャラの右側。
    _dA.set(-0.42, -0.88,  0.08);            // 構え：下ろす
    _dB.set(-0.58,  0.42, -0.70);            // ため：後ろ上へ担ぐ
    _dC.set(-0.10, -0.42,  0.90);            // 振り抜き：前下へ払う
    _dir.copy(_dA).lerp(_dB, w).lerp(_dC, c);
    aimBone('RightArm', 'RightForeArm', _dir);
    chara.updateMatrixWorld(true);

    _dA.set(-0.28, -0.94,  0.18);
    _dB.set(-0.38,  0.58, -0.72);
    _dC.set( 0.05, -0.58,  0.82);
    _dir.copy(_dA).lerp(_dB, w).lerp(_dC, c);
    aimBone('RightForeArm', 'RightHand', _dir);
    chara.updateMatrixWorld(true);

    if (bones.RightHand){
      // 刀身はモデルの +Y。正で前へ倒れる。立て気味に構え、後ろへ担ぎ、前へ斬る。
      // 立てて構える。ためで後ろへ担ぎ、打ち抜きで前へ振り下ろす。
      // 刀身（モデルの +Y）を向けたい方向へ。構えは斜め上、ためで後ろ、振りで前下。
      // 構えは刃先を正面へ。上を向いていたものを前へ倒した形。
      _dA.set(-0.16,  0.10,  0.98);
      _dB.set(-0.55,  0.55, -0.63);
      _dC.set( 0.22, -0.36,  0.91);
      _dir.copy(_dA).lerp(_dB, w).lerp(_dC, c).normalize();
      // 刀身をこの向きへ。ただしこれだけだと軸まわりのひねりが定まらず、
      // 平たい面がどちらを向くかは成り行きになる。明示的に回して横へ倒す。
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

    // 首と頭。正で上を向く。守備では首をすくめ、咆哮では天を仰ぎ、
    // 斬るときは打点を見下ろす。
    boneSet('neck', [[1,0,0, g*0.18 - r*0.42]]);
    boneSet('Head', [
      [1,0,0, HEAD_UP - r*0.95 + g*0.95 + c*0.20 - w*0.12],   // 咆哮で天を仰ぎ、守備で深くうつむく
      [0,1,0, 0.22*w - 0.30*c]
    ]);
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
  // 踏み込みとためを全身にも乗せる。腕だけ動くと軽く見える。
  const uu = 1 - st.swing;
  const cc = st.swing > 0.001 ? (uu < 0.35 ? 0 : uu < 0.55 ? Math.sin((uu-0.35)/0.20*Math.PI/2) : Math.max(0, 1-(uu-0.55)/0.45)) : 0;
  const ww = st.swing > 0.001 ? (uu < 0.35 ? Math.sin(uu/0.35*Math.PI/2) : Math.max(0, 1-(uu-0.35)/0.15)) : 0;
  chara.rotation.x = -ww*0.10 + cc*0.26 - roarU*0.14;
  // 構えると盾側の肩を前に出して半身になる。腕が上がらないぶんをこれで補う。
  chara.rotation.z = 0;   // 守備でも半身にせず、正面で盾を構える
  chara.position.set(
    st.guard*-0.10,
    FOOT_SINK + Math.min(0, (1-e)*-0.12 - st.guard*0.24 - cc*0.05) + (Math.random()-0.5)*st.shakeT*0.02,   // 足を床より上げない
    STAND_Z + st.guard*0.10 + cc*0.16 - ww*0.05
  );
  const grow = baseScale;
  blob.position.set(chara.position.x, 0.004, chara.position.z);
  blob.scale.setScalar(grow * 1.45);
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
    shock.scale.setScalar(grow * (0.4 + (1-st.roar)*3.4));
    shock.material.opacity = Math.min(1, st.roar*1.6)*0.85;
  }

}
