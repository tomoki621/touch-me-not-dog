import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FLAME_DIR, FLAME_TRUNK, FLAME_PALM, FLAME_FINGER, FLAME_HAND_AIM,
         FLAME_SHOT, flamePose, trunkAngle } from './flame.js';

const $ = (id) => document.getElementById(id);

const gate = $('gate'), note = $('note'), tapme = $('tapme');
const cam = $('cam'), hud = $('hud'), sub = $('sub'), cross = $('cross');
const flash = $('flash'), touch = $('touch'), call = $('call'), tip = $('tip');
const fireBtn = $('fire');

// ---------------------------------------------------------------- 場面
// マーカーを使わない。カードは実写に写っているだけで、位置合わせは指でやる。
// 画角を合わせる必要も、水平を推測する必要もない。真ん中に置いて、あとは手。
// antialias はモバイルでは高くつく。輪郭は煙と後光が隠すので外す。
const renderer = new THREE.WebGLRenderer({
  canvas: $('gl'), alpha: true, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
// three は 0.149。renderer.outputColorSpace と texture.colorSpace が入るのは 0.152 から。
// この版に書いても、ただの新しい属性が生えるだけで誰も読まない。既定の線形のまま
// 画面へ出るので、中間調が軒並み沈んで全体が暗く濁る。この版では encoding 側で指定する。
// （THREE.SRGBColorSpace という定数は 0.149 にもあるので、書いても気づけない。）
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

function resize(){
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// 足元を原点にした入れ物。指の操作はすべてこれを動かす。
const DIST = 4.2;         // カメラからの距離
const BODY_H = 1.6;       // 貼り付け表示のときの背丈。画面の高さの4割ほど。
const AR_H = 0.35;        // AR は実寸（メートル）。机のカードの上に立つ既定の大きさ。
const exodia = new THREE.Group();
// 先に向き、あとから傾き。順番が逆だと、回したあとの傾けが斜めに効く。
exodia.rotation.order = 'YXZ';
// 足元を画面のちょうど真ん中に置く。十字を合わせたところに立つ。
exodia.position.set(0, 0, -DIST);
scene.add(exodia);

const light = new THREE.DirectionalLight(0xfff0d0, 1.35);
light.position.set(1.2, 2.4, 1.8);
scene.add(light);
const rim = new THREE.DirectionalLight(0xffc861, 0.9);   // 金色を後ろから起こす
rim.position.set(-1.5, 1.2, -2.0);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2b1c06, 0.75));

// ---------------------------------------------------------------- 描いて作る絵
// 画像ファイルを増やさない。霧も魔法陣も canvas で描けば、読み込み待ちが無い。
function cv(n){ const c = document.createElement('canvas'); c.width = c.height = n; return c; }

// 霧のひと固まり。中心が濃く輪郭が溶けた塊を重ねて雲にする。
function puffTexture(){
  const c = cv(256), x = c.getContext('2d');
  for (let i = 0; i < 14; i++){
    const px = 128 + (Math.random() - 0.5) * 116;
    const py = 128 + (Math.random() - 0.5) * 116;
    const r  = 34 + Math.random() * 58;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0,   'rgba(255,255,255,0.34)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.11)');
    g.addColorStop(1,   'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
  }
  // 外周を落として四角い縁を消す
  const m = x.createRadialGradient(128, 128, 40, 128, 128, 128);
  m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
  x.globalCompositeOperation = 'destination-in';
  x.fillStyle = m; x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
}

// 魔法陣。二重の輪と目盛りと楔形。読める必要はなく、回れば神殿に見える。
function sealTexture(){
  const N = 512, c = cv(N), x = c.getContext('2d'), R = N / 2;
  x.translate(R, R);
  x.strokeStyle = '#ffd76a'; x.fillStyle = '#ffd76a';
  for (const r of [0.96, 0.88, 0.62, 0.55, 0.24]){
    x.lineWidth = 3; x.beginPath(); x.arc(0, 0, R * r, 0, 7); x.stroke();
  }
  // 外周の目盛り
  for (let i = 0; i < 72; i++){
    const lg = i % 6 === 0;
    x.save(); x.rotate(i / 72 * Math.PI * 2);
    x.lineWidth = lg ? 5 : 2;
    x.beginPath(); x.moveTo(0, -R * 0.88); x.lineTo(0, -R * (lg ? 0.72 : 0.80)); x.stroke();
    x.restore();
  }
  // 内側の楔形。等間隔に並べるだけで古い文字らしく見える。
  for (let i = 0; i < 24; i++){
    x.save(); x.rotate(i / 24 * Math.PI * 2);
    x.beginPath(); x.moveTo(-7, -R * 0.60); x.lineTo(7, -R * 0.60); x.lineTo(0, -R * 0.40);
    x.closePath(); x.fill();
    x.restore();
  }
  // 五芒星
  x.lineWidth = 4; x.beginPath();
  for (let i = 0; i <= 5; i++){
    const a = -Math.PI / 2 + i * 4 * Math.PI / 5;
    x[i ? 'lineTo' : 'moveTo'](Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55);
  }
  x.stroke();
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
}

// 足元の落ち影。中心が濃く、外へ溶ける。
// カードの上に落ちる黒がそのまま実写を暗くする（canvas は映像の上に重ねてある）ので、
// 合成の影ではなく本物の影として読める。これが無いと、位置が合っていても浮いて見える。
function blobTexture(){
  const c = cv(128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0,    'rgba(0,0,0,0.62)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.34)');
  g.addColorStop(1,    'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// 黄金の煙のひと塊。薄い塊を数多く重ね、輪郭をどこにも作らないのがこつ。
// 濃い一枚を貼ると必ず「板」に見える。薄いものを重ねて初めて煙になる。
function smokeTexture(){
  const c = cv(256), x = c.getContext('2d');
  for (let i = 0; i < 30; i++){
    const px = 128 + (Math.random() - 0.5) * 132;
    const py = 128 + (Math.random() - 0.5) * 132;
    const r  = 38 + Math.random() * 74;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0,    'rgba(255,255,255,0.15)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.065)');
    g.addColorStop(1,    'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
  }
  // 外周を落として四角い縁を消す。ここを怠ると板の角が見える。
  const m = x.createRadialGradient(128, 128, 26, 128, 128, 128);
  m.addColorStop(0,   'rgba(0,0,0,1)');
  m.addColorStop(0.7, 'rgba(0,0,0,0.55)');
  m.addColorStop(1,   'rgba(0,0,0,0)');
  x.globalCompositeOperation = 'destination-in';
  x.fillStyle = m; x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
}

// キラキラのひと粒。十字に伸びた光。丸い点だと埃に見える。
function sparkTexture(){
  const N = 64, c = cv(N), x = c.getContext('2d'), R = N / 2;
  x.translate(R, R);
  const core = x.createRadialGradient(0, 0, 0, 0, 0, R * 0.30);
  core.addColorStop(0, 'rgba(255,252,236,1)');
  core.addColorStop(1, 'rgba(255,214,120,0)');
  x.fillStyle = core; x.beginPath(); x.arc(0, 0, R * 0.30, 0, 7); x.fill();
  for (let i = 0; i < 4; i++){
    x.save(); x.rotate(i * Math.PI / 2);
    const g = x.createLinearGradient(0, 0, 0, -R);
    g.addColorStop(0, 'rgba(255,240,190,0.95)');
    g.addColorStop(1, 'rgba(255,200,90,0)');
    x.fillStyle = g;
    x.beginPath(); x.moveTo(-1.7, 0); x.lineTo(1.7, 0); x.lineTo(0, -R); x.closePath(); x.fill();
    x.restore();
  }
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
}

// 背後の後光。輪郭のまわりに滲む光で、金色が実写から浮き上がる。
function haloTexture(){
  const c = cv(256), x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 20, 128, 128, 128);
  g.addColorStop(0,    'rgba(255,226,150,0.55)');
  g.addColorStop(0.45, 'rgba(255,190,80,0.22)');
  g.addColorStop(1,    'rgba(255,170,50,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
}

// 光の柱の濃淡。根元が濃く、天へ向かって消える。
function shaftTexture(){
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0,    'rgba(255,236,180,0.85)');
  g.addColorStop(0.35, 'rgba(255,206,100,0.34)');
  g.addColorStop(1,    'rgba(255,190,80,0)');
  x.fillStyle = g; x.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
}

// 掌のあいだで固まる光の玉。中心は白く飛ばし、外は金へ落として輪郭を溶かす。
// 縁を残すと球ではなく円板に見えるので、外へ行くほど急に薄くする。
function orbTexture(){
  const c = cv(128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0,    'rgba(255,255,255,1)');
  g.addColorStop(0.20, 'rgba(255,248,220,0.92)');
  g.addColorStop(0.46, 'rgba(255,198,80,0.40)');
  g.addColorStop(1,    'rgba(255,150,30,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
}

// 光線の長さ方向の濃淡。手元がいちばん濃く、遠ざかるほど薄れて消える。
// のっぺりした濃淡だけだと太い棒に見えるので、縦の筋を何本か入れて走らせる。
// 円筒に巻くので横は繰り返し。継ぎ目は筋に紛れて見えない。
function beamTexture(){
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 256, 0, 0);   // 下端が手元
  g.addColorStop(0,    'rgba(255,255,255,0.95)');
  g.addColorStop(0.10, 'rgba(255,242,196,0.80)');
  g.addColorStop(0.50, 'rgba(255,204,96,0.42)');
  g.addColorStop(1,    'rgba(255,170,50,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 256);
  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 16; i++){
    const px = Math.random() * 64, w = 1 + Math.random() * 3;
    const s = x.createLinearGradient(0, 256, 0, 0);
    s.addColorStop(0,   'rgba(255,255,255,0.45)');
    s.addColorStop(0.25 + Math.random() * 0.45, 'rgba(255,232,168,0.15)');
    s.addColorStop(1,   'rgba(255,200,90,0)');
    x.fillStyle = s; x.fillRect(px, 0, w, 256);
  }
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const GOLD = 0xffc84a;
const addMat = (tex, op) => new THREE.MeshBasicMaterial({
  map: tex, color: GOLD, transparent: true, opacity: op,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
});

// 効果の寸法はすべて背丈 2.6 のときの値で書いてある。背丈を変えたら
// まとめて追従させる。個々の数字を都度直すと、必ずどれかを取りこぼす。
const fx = new THREE.Group();
fx.scale.setScalar(BODY_H / 2.6);
exodia.add(fx);

// ---------------------------------------------------------------- 魔法陣
const seal = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), addMat(sealTexture(), 0));
seal.rotation.x = -Math.PI / 2;
seal.position.y = 0.01;
fx.add(seal);

const seal2 = new THREE.Mesh(seal.geometry, seal.material.clone());   // 逆回りの二重
seal2.rotation.x = -Math.PI / 2;
seal2.position.y = 0.02;
seal2.scale.setScalar(0.62);
fx.add(seal2);

// ---------------------------------------------------------------- 霧
// 板をカメラに向け続けるだけ。立ち上りながら広がって薄れる。
// 加算合成なので、実写の暗いところでも白く光って見える。
const fogTex = puffTexture();
const puffGeo = new THREE.PlaneGeometry(1, 1);
const puffs = [];
for (let i = 0; i < 12; i++){
  const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({
    map: fogTex, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: i % 3 === 0 ? 0xffd489 : 0xdfe4ff   // 3枚に1枚は金。白一色だと湯気になる。
  }));
  fx.add(m);
  puffs.push({ m, a: Math.random() * 7, r0: 0.25 + Math.random() * 0.5,
               sp: 0.30 + Math.random() * 0.55, rise: 0.22 + Math.random() * 0.60,
               spin: (Math.random() - 0.5) * 1.1, ph: Math.random() });
}

// ---------------------------------------------------------------- 光の柱
const shaft = new THREE.Mesh(
  new THREE.CylinderGeometry(0.62, 1.05, 7.0, 28, 1, true),
  addMat(shaftTexture(), 0)
);
shaft.position.y = 3.5;
fx.add(shaft);

// ---------------------------------------------------------------- 衝撃波
const burst = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.78, 64), new THREE.MeshBasicMaterial({
  color: 0xffe9b0, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
}));
burst.rotation.x = -Math.PI / 2;
burst.position.y = 0.06;
fx.add(burst);

// ---------------------------------------------------------------- 落ち影
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), new THREE.MeshBasicMaterial({
  map: blobTexture(), transparent: true, opacity: 0, depthWrite: false
}));
blob.rotation.x = -Math.PI / 2;
blob.position.y = 0.005;
blob.renderOrder = -1;
fx.add(blob);

// ---------------------------------------------------------------- 黄金の風
// 出現したあとも消えない。ここが「いかにも神」を作る部分なので、召喚の演出とは
// 別に持ち、立っているあいだずっと回し続ける。寸法は背丈 2.6 のときの値。
const aura = new THREE.Group();
fx.add(aura);

// 体のまわりを巡って昇る黄金の煙。板をカメラに向け続けるだけだが、
// 大きさ・速さ・位相を不揃いにし、板ごとゆっくり回すと、渦を巻いて湧き立つ。
// 絵柄は3種類を使い回す。同じ模様が並ぶと、そこで作り物だと分かってしまう。
const smokeTexes = [smokeTexture(), smokeTexture(), smokeTexture()];
const smokeGeo = new THREE.PlaneGeometry(1, 1);
const smoke = [];
for (let i = 0; i < 14; i++){
  const m = new THREE.Mesh(smokeGeo, new THREE.MeshBasicMaterial({
    map: smokeTexes[i % 3], transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: i % 3 === 0 ? 0xffe9b4 : 0xffb63e,   // 薄い金と濃い金を混ぜて厚みを出す
  }));
  aura.add(m);
  smoke.push({ m, a: Math.random() * 7, r: 0.50 + Math.random() * 0.75,
               sp: 0.55 + Math.random() * 0.85, rise: 0.55 + Math.random() * 1.05,
               ph: Math.random(), sz: 0.80 + Math.random() * 0.80,
               roll: (Math.random() - 0.5) * 0.42, y0: Math.random() * 0.35 });
}

// 後光。体の中ほどに置いて常にカメラを向ける。
const halo = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.0), new THREE.MeshBasicMaterial({
  map: haloTexture(), transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
halo.position.y = 1.35;
halo.renderOrder = -2;      // 体より先に描く。後ろに回っていてほしい。
aura.add(halo);

// キラキラ。螺旋に沿って昇り、上で消えて下から湧き直す。
// 明滅の周期を粒ごとに変えると、粒の数より多く光っているように見える。
const sparkTex = sparkTexture();
const sparkGeo = new THREE.PlaneGeometry(0.20, 0.20);
const sparks = [];
for (let i = 0; i < 20; i++){
  const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({
    map: sparkTex, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
    color: i % 4 === 0 ? 0xfff4d2 : 0xffc85a,
  }));
  aura.add(m);
  sparks.push({ m, a: Math.random() * 7, r: 0.55 + Math.random() * 0.85,
                sp: 0.35 + Math.random() * 0.9, rise: 0.20 + Math.random() * 0.55,
                ph: Math.random(), tw: 2.2 + Math.random() * 4.5,
                sz: 0.6 + Math.random() * 1.1 });
}

// ------------------------------------------------------- 怒りの業火 魔神火炎砲
// 掌のあいだへ光を集め、突き出した右手から撃つ。部品はぜんぶ fx の中に置くので、
// 指で大きさや向きを変えても、体と一緒に付いて回る。
// 手の位置は毎回そのとき骨から測る。座標で置くと、姿勢を直すたびに置き直しになる。
const shot = new THREE.Group();
shot.visible = false;
fx.add(shot);

// 集まった光の玉。芯と、そのまわりの滲みの二枚重ね。芯だけだと点にしか見えず、
// 滲みだけだと熱が無い。
// 大きさは fx の物差し（背丈が 2.6）で決める。両手のあいだは 0.7 ほど。
// 板の絵は縁へ向けて溶けているので、見える玉は板の6割ほど。育ちきったところで
// ちょうど両の掌に触れる大きさになるよう、板は 1.2 で取る。
const orb = new THREE.Mesh(new THREE.PlaneGeometry(1.20, 1.20), new THREE.MeshBasicMaterial({
  map: orbTexture(), transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false }));
shot.add(orb);
const orbGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({
  map: haloTexture(), color: 0xfff0c0, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false }));
shot.add(orbGlow);

// 外から玉へ吸い込まれてくる光の粒。技が始まったことを、玉より先に伝える役。
const gatherTex = sparkTexture();
const gatherGeo = new THREE.PlaneGeometry(0.26, 0.26);
const gathers = [];
for (let i = 0; i < 16; i++){
  const m = new THREE.Mesh(gatherGeo, new THREE.MeshBasicMaterial({
    map: gatherTex, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
    color: i % 3 === 0 ? 0xfff6dc : 0xffc65a }));
  shot.add(m);
  gathers.push({ m, a: Math.random() * 7, ph: Math.random(),
                 sp: 0.55 + Math.random() * 0.8, r: 1.0 + Math.random() * 1.5,
                 y: (Math.random() - 0.5) * 1.2, spin: 2.0 + Math.random() * 2.5 });
}

// 光線。手元から正面へ。芯と、そのまわりの薄い衣の二重にする。
// 一本だけだと縁がはっきり出て「棒」になる。太い衣をかぶせると光の束に見える。
const BEAM_LEN = 16;
const beam = new THREE.Group();
shot.add(beam);
const beamTex = beamTexture();
// 手元は掌ほどの太さ、遠くへ行くほど末広がり。細いと光線ではなく糸に見える。
const beamGeo = new THREE.CylinderGeometry(1.15, 0.34, BEAM_LEN, 26, 1, true);
// 絵は芯と衣で使い回す。もう動かさないので、別々に持つ理由がない。
const beamMat = (op, col) => new THREE.MeshBasicMaterial({
  map: beamTex, color: col, transparent: true, opacity: op,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const beamCore = new THREE.Mesh(beamGeo, beamMat(0, 0xfff6e0));
// 素の円筒は +Y へ伸びている。正面（+Z）へ倒し、根元が手に来るよう半分ぶん送る。
beamCore.rotation.x = Math.PI / 2;
beamCore.position.z = BEAM_LEN / 2;
beam.add(beamCore);
const beamGlow = new THREE.Mesh(beamGeo, beamMat(0, 0xffb63c));
beamGlow.rotation.x = Math.PI / 2;
beamGlow.position.z = BEAM_LEN / 2;
beamGlow.scale.set(2.3, 1, 2.3);
beam.add(beamGlow);

// 光線を追い越していく輪。これが無いと、光線は伸びるだけで流れて見えない。
const waves = [];
for (let i = 0; i < 3; i++){
  const m = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.72, 40), new THREE.MeshBasicMaterial({
    color: 0xffeec0, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.add(m);
  waves.push({ m, ph: i / 3 });
}

// 手元の閃光。撃った瞬間だけ大きく開いて、あとは光線の根元を焼く。
const muzzle = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({
  map: orbTexture(), transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false }));
shot.add(muzzle);

// ---------------------------------------------------------------- 本体
// 出現はディゾルブでやる。高さのしきい値をゆっくり上げ、境目を金色に光らせる。
// パッと出さず、足元から順に輪郭が固まっていく。霧の中で像を結ぶ見え方になる。
// 隠すのに visible は使わない。しきい値を下限に置けば全部が捨てられて見えなくなり、
// そのぶん最初の1フレームでシェーダが焼かれる。召喚の瞬間に固まるのを防ぐ。
const body = new THREE.Group();
// 素の姿勢のまま、既にカメラの側（+Z）を向いている。回すと逆に背を向けるので触らない。
// expose.mjs で描き出して確かめた。ここは推測で足してはいけない。
exodia.add(body);
let bodyStarted = false;

const uReveal = { value: -99 };   // この高さまでが実体。世界座標。
const uEdge   = { value: 0.16 };  // 境目の幅
// 下の CUT_GLSL が高さに足す揺らぎの最大値。掃引の終点を決めるのに要るので、
// シェーダ側の数字を変えたらここも合わせる。ずれると頭が出ないまま終わる。
const SHADER_NOISE = 0.18;

const NOISE_GLSL = [
  'float exHash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }',
  'float exNoise(vec3 p){',
  '  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(mix(exHash(i), exHash(i + vec3(1,0,0)), f.x),',
  '                 mix(exHash(i + vec3(0,1,0)), exHash(i + vec3(1,1,0)), f.x), f.y),',
  '             mix(mix(exHash(i + vec3(0,0,1)), exHash(i + vec3(1,0,1)), f.x),',
  '                 mix(exHash(i + vec3(0,1,1)), exHash(i + vec3(1,1,1)), f.x), f.y), f.z);',
  '}'
].join('\n');

const CUT_GLSL = [
  '#include <dithering_fragment>',
  'float exN = exNoise(vExW * 11.0) * 0.18;',
  'float exH = vExW.y + exN;',
  'if (exH > uReveal) discard;',
  'float exE = smoothstep(uReveal - uEdge, uReveal, exH);',
  'gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.86, 0.45), exE * 0.9);',
  'gl_FragColor.rgb += vec3(1.4, 0.95, 0.35) * exE * exE;'
].join('\n');

function dissolvable(mat){
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uReveal = uReveal;
    sh.uniforms.uEdge = uEdge;
    // スキン後の頂点は模型の空間にある。世界へ移してから高さを測る。
    // 骨の空間のまま測ると、Armature に掛かった倍率のぶんだけ桁が狂う。
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vExW;')
      .replace('#include <skinning_vertex>',
               '#include <skinning_vertex>\nvExW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>',
               '#include <common>\nvarying vec3 vExW;\nuniform float uReveal;\nuniform float uEdge;\n' + NOISE_GLSL)
      .replace('#include <dithering_fragment>', CUT_GLSL);
  };
  mat.customProgramCacheKey = () => 'exodia-dissolve';
}

// Meshy が付けてきた3つのモーションは、どれも前かがみに屈んだ怪物の姿勢だった
// （攻撃に至っては最後は床に倒れ込む）。エクゾディアの立ち姿は素の姿勢そのもので、
// クリップは一つも使わない。代わりに骨を直接ゆらす。24本のリグが載っているので、
// 体ごと揺らすより、息と体重移動と視線で「生きている」を作るほうが安く自然になる。
let ready = false;
const bones = {}, rest = {};
const BONE_NAMES = ['Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'Head',
                    'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
                    'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'];

// 骨を素の姿勢からの差分で回す。軸は模型自身の向き（X=右 Y=上 Z=正面）で書き、
// 骨の親の空間へ移してから掛ける。こうすると骨ごとのローカル軸の取り方に左右されない。
const _ax = new THREE.Vector3(), _bq = new THREE.Quaternion();
const _mq = new THREE.Quaternion(), _ppq = new THREE.Quaternion();
// 技を出しているあいだだけ重みが入る。骨ごとの足し前は boneSet が自分で拾う。
let flameW = null;
function boneSet(name, rots){
  const b = bones[name];
  if (!b) return;
  b.quaternion.copy(rest[name]);
  b.parent.getWorldQuaternion(_ppq).invert();
  const add = (x, y, z, ang) => {
    if (!ang) return;
    _ax.set(x, y, z).applyQuaternion(_mq).applyQuaternion(_ppq);
    if (_ax.lengthSq() < 1e-12) return;
    b.quaternion.premultiply(_bq.setFromAxisAngle(_ax.normalize(), ang));
  };
  for (const r of rots) add(r[0], r[1], r[2], r[3]);
  // 技のぶんを同じ骨へ足す。息と技で boneSet を2回呼ぶと、あとから呼んだほうが
  // 素の姿勢から作り直してしまい、先に入れたほうが消える。足すのはここ一箇所。
  const ft = flameW && FLAME_TRUNK[name];
  if (ft) for (const c of ft) add(c[0], c[1], c[2], trunkAngle(c, flameW));
  // 非数が一つ混ざるとスキンメッシュが丸ごと消える。その場で素の姿勢へ戻す。
  const q = b.quaternion;
  if (!(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w)))
    b.quaternion.copy(rest[name]);
}

// 骨の「子へ伸びる向き」を、狙った向きへ倒す。角度で書くと骨ごとのローカル軸の
// 取り方に振り回されるが、向きで書けば模型の姿だけで決まる。
// 重み w で、いま入っている姿勢（息づかい）との間を混ぜる。0 なら手を出さない。
const _pA = new THREE.Vector3(), _pB = new THREE.Vector3(), _bd = new THREE.Vector3();
const _dirW = new THREE.Vector3(), _aq = new THREE.Quaternion();
const _apq = new THREE.Quaternion(), _keep = new THREE.Quaternion(), _goal = new THREE.Quaternion();
function aimBone(name, childName, dir, w){
  const b = bones[name], c = bones[childName];
  if (!b || !c || w <= 0.001) return;
  b.getWorldPosition(_pA); c.getWorldPosition(_pB);
  _bd.subVectors(_pB, _pA);
  if (_bd.lengthSq() < 1e-9) return;
  _bd.normalize();
  _dirW.copy(dir).normalize().applyQuaternion(_mq);        // 模型の向き → ワールド
  _aq.setFromUnitVectors(_bd, _dirW);                      // ワールドでの補正
  b.parent.getWorldQuaternion(_apq);
  _keep.copy(b.quaternion);                                // 息づかいのぶんを控える
  b.quaternion.premultiply(_goal.copy(_apq).invert().multiply(_aq).multiply(_apq));
  // 狙いへ一足飛びに移らない。重みが 0 から立ち上がる瞬間に、腕が跳ねる。
  _goal.copy(b.quaternion);
  b.quaternion.copy(_keep).slerp(_goal, w);
}

// 生きている感じ。周期は互いに割り切れない値にしてあるので、同じ姿には戻らない。
// 振れ幅は小さく保つ。大きくすると「動いている」ではなく「ずれている」に見える。
function breathe(e){
  body.getWorldQuaternion(_mq);          // 骨ごとに取り直す必要はない
  const s = (p, ph) => Math.sin(e * p + (ph || 0));
  boneSet('Spine02', [[1, 0, 0, s(0.86) * 0.030]]);            // 腰から上をゆっくり送る
  boneSet('Spine01', [[1, 0, 0, s(1.05) * 0.075],              // 息で胸が起きて戻る
                      [0, 0, 1, s(0.34, 0.9) * 0.030]]);
  boneSet('Spine',   [[1, 0, 0, s(1.05, 0.6) * 0.050]]);
  boneSet('Hips',    [[0, 0, 1, s(0.34) * 0.050],              // 体重をゆっくり左右へ送る
                      [0, 1, 0, s(0.23) * 0.080]]);
  boneSet('LeftShoulder',  [[1, 0, 0, s(1.05, 0.3) * 0.045]]); // 肩も息に乗せる
  boneSet('RightShoulder', [[1, 0, 0, s(1.05, 0.3) * 0.045]]);
  boneSet('LeftArm',      [[0, 0, 1,  s(0.47) * 0.120],        // 鎖の重みで腕が上下する
                           [0, 1, 0,  s(0.31, 0.8) * 0.060]]);
  boneSet('RightArm',     [[0, 0, 1, -s(0.47, 1.7) * 0.120],
                           [0, 1, 0, -s(0.31, 2.4) * 0.060]]);
  boneSet('LeftForeArm',  [[1, 0, 0, s(0.61, 0.4) * 0.080]]);
  boneSet('RightForeArm', [[1, 0, 0, s(0.61, 2.1) * 0.080]]);
  boneSet('Head', [[0, 1, 0, s(0.19) * 0.22 + s(0.07, 1.1) * 0.13],   // ゆっくり見回す
                   [1, 0, 0, s(0.29, 0.5) * 0.090]]);
  boneSet('neck', [[0, 1, 0, s(0.19, 0.3) * 0.100],
                   [1, 0, 0, s(1.05, 0.4) * 0.035]]);
}

// ------------------------------------------------------- 怒りの業火 魔神火炎砲
// 腕は角度ではなく向きで作る。素の向きは模型から測っておき、そこから溜め・発射へ
// 補間する。測らずに素の向きも数字で書くと、模型を差し替えた日に腕だけ捻れる。
const ARM_CHAIN = [['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'],
                   ['LeftArm',  'LeftForeArm'],  ['LeftForeArm',  'LeftHand']];
const armRest = {};
const _hold = new THREE.Vector3(), _fire = new THREE.Vector3(), _aim = new THREE.Vector3();

function measureArms(){
  body.updateMatrixWorld(true);
  body.getWorldQuaternion(_mq).invert();      // ワールド → 模型の向き
  for (const [n, ch] of ARM_CHAIN){
    const b = bones[n], c = bones[ch];
    if (!b || !c) continue;
    b.getWorldPosition(_pA); c.getWorldPosition(_pB);
    armRest[n] = new THREE.Vector3().subVectors(_pB, _pA).applyQuaternion(_mq).normalize();
  }
}

// 手の向き。腕を向けただけでは、手がどちらを向くかは最短回転の成り行きで決まり、
// 前へ伸ばした腕の掌はたいてい上を向く。「放つ方向へ掌を向け、指は上へ」は技の
// 見た目そのものなので、ここは向きで明示して決める。手首は曲がるが、腕を前へ
// 伸ばしたまま掌を前へ向けるには曲げるしかない（掌底の構え）。
// 掌と指は測った値（FLAME_PALM / FLAME_FINGER、測り直しは node tools/palm.mjs）。
// 手の骨のローカル軸がどう取られているかは当てにしない。
// 掌だけ合わせると軸まわりが決まらず、掌は前でも指が横を向く。両方渡して決めきる。
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _w3 = new THREE.Vector3();
const _mL = new THREE.Matrix4(), _mW = new THREE.Matrix4();
const _qL = new THREE.Quaternion(), _qW = new THREE.Quaternion();
function setHand(name, palm, finger, k){
  const b = bones[name];
  if (!b || k <= 0.001) return;
  // 骨の空間での基準。測った掌と指から直交する3軸を組む。
  _u.fromArray(FLAME_PALM[name]).normalize();
  _v.fromArray(FLAME_FINGER[name]);
  _v.addScaledVector(_u, -_v.dot(_u));
  if (_v.lengthSq() < 1e-6) return;
  _v.normalize(); _w3.crossVectors(_u, _v);
  _mL.makeBasis(_u, _v, _w3);
  // 向けたい先で、同じ組み方の3軸を作る。指は掌に直交させてから使う。
  _u.copy(palm).applyQuaternion(_mq).normalize();
  _v.copy(finger).applyQuaternion(_mq);
  _v.addScaledVector(_u, -_v.dot(_u));
  if (_v.lengthSq() < 1e-6) return;
  _v.normalize(); _w3.crossVectors(_u, _v);
  _mW.makeBasis(_u, _v, _w3);
  // 骨の空間 → 向けたい先。これが手のワールドでの姿勢になる。
  _qL.setFromRotationMatrix(_mL).invert();
  _qW.setFromRotationMatrix(_mW).multiply(_qL);
  b.parent.getWorldQuaternion(_apq).invert();
  _keep.copy(b.quaternion);
  _goal.copy(_apq).multiply(_qW);
  b.quaternion.copy(_keep).slerp(_goal, k);
}

// 腕を技の向きへ。骨を一本回すたびに行列を作り直す。前腕の向きは上腕を回した
// あとの位置から測るので、ここを省くと肘から先が一拍遅れる。
const NONE = [];
function aimArms(w, e){
  // 手はここでしか触らない。毎フレーム素の姿勢へ戻してから掛ける。戻さずに
  // 積むと、数秒で手首が捻じ切れる。
  boneSet('RightHand', NONE); boneSet('LeftHand', NONE);
  if (!w || w.aim <= 0.001) return;
  body.getWorldQuaternion(_mq);
  // 腕をこちらで作っているあいだ、息づかいは効かなくなる。2秒以上ぴたりと止まった
  // 腕は人形に戻るので、ここで動かす。溜めは息と同じ遅さでゆっくり。細かく震わせると
  // 力んでいるようには見えず、ただ手ぶれた絵になる。速い揺れは撃っている間だけ。
  const slow = 0.026 * w.hold, fast = 0.030 * w.beam;
  for (let i = 0; i < ARM_CHAIN.length; i++){
    const [n, ch] = ARM_CHAIN[i];
    const d = FLAME_DIR[n], r = armRest[n];
    if (!d || !r) continue;
    _aim.copy(r).lerp(_hold.fromArray(d.hold), w.hold).lerp(_fire.fromArray(d.fire), w.fire);
    if (slow > 0.0001){
      _aim.x += Math.sin(e * 0.92 + i * 1.7) * slow;
      _aim.y += Math.sin(e * 1.23 + i * 2.9) * slow;
      _aim.z += Math.sin(e * 0.71 + i * 0.8) * slow * 0.6;
    }
    if (fast > 0.0001){
      _aim.x += Math.sin(e * 23.7 + i * 1.3) * fast;
      _aim.y += Math.sin(e * 19.1 + i * 2.2) * fast;
    }
    body.updateMatrixWorld(true);
    aimBone(n, ch, _aim, w.aim);
  }
  // 手は腕を決めきってから。前腕が動けば手の付け根ごと動く。
  const k = w.hold + w.fire;
  if (k < 0.01) return;
  body.updateMatrixWorld(true);
  for (const n of ['RightHand', 'LeftHand']){
    const a = FLAME_HAND_AIM[n];
    _aim.fromArray(a.hold.palm).multiplyScalar(w.hold / k)
        .addScaledVector(_fire.fromArray(a.fire.palm), w.fire / k);
    _hold.fromArray(a.hold.finger).multiplyScalar(w.hold / k)
         .addScaledVector(_fire.fromArray(a.fire.finger), w.fire / k);
    if (_aim.lengthSq() < 1e-6 || _hold.lengthSq() < 1e-6) continue;
    setHand(n, _aim.normalize(), _hold.normalize(), w.aim * Math.min(1, k));
  }
}

// Meshy はどの書き出しも同じ箱に正規化する。背丈はこちらで決め直す。
// スキン付きの頂点はバインド行列で既に骨の空間に載っているので、そこへメッシュの
// ワールド行列を重ねると桁が狂う。スキン付きは素の箱で測る。
function fit(root, targetH){
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox.clone();
    if (!o.isSkinnedMesh) b.applyMatrix4(o.matrixWorld);
    box.union(b);
  });
  if (box.isEmpty()) return;
  const size = new THREE.Vector3(), ctr = new THREE.Vector3();
  box.getSize(size); box.getCenter(ctr);
  const s = targetH / (size.y || 1);
  root.scale.setScalar(s);
  root.position.set(-ctr.x * s, -box.min.y * s, -ctr.z * s);
}

const loader = new GLTFLoader();
const V = typeof __GLBV__ === 'string' ? ('?h=' + __GLBV__) : '';

loader.load('models/exodia.glb' + V, (g) => {
  const root = g.scene;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;          // スキンの箱は当てにならない。消える事故を防ぐ。
    dissolvable(o.material);
  });
  root.traverse((o) => {
    if (o.isBone && BONE_NAMES.indexOf(o.name) >= 0){
      bones[o.name] = o;
      rest[o.name] = o.quaternion.clone();
    }
  });
  fit(root, BODY_H);
  body.add(root);
  measureArms();
  ready = true;
  call.disabled = false;
  call.textContent = '召　喚';
}, null, (e) => {
  note.textContent = 'エクゾディアを読み込めませんでした（' + ((e && e.message) || e) + '）。';
  call.textContent = '読み込めません';
});

// ---------------------------------------------------------------- 召喚
// パッと出さない。予兆・霧・光柱・像を結ぶ・解放、の5段でおよそ6秒かける。
// 段どうしを重ねて、切り替わる継ぎ目を見せない。数字は召喚開始からの秒。
const T_SEAL  = [0.0, 5.4];
const T_FOG   = [0.5, 6.4];
const T_SHAFT = [1.4, 5.0];
const T_BODY  = [2.3, 4.6];   // ここでディゾルブが 0 から 1 へ
const T_OPEN  = 4.35;         // 衝撃波とフラッシュ

const _pq = new THREE.Quaternion(), _billboard = new THREE.Quaternion();
let phase = 'sealed';   // sealed → summoning → standing
let sT = 0, flashV = 0;
const ease = (t) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const span = ([a, b], t) => (t - a) / (b - a);

// 輪のところへ本体を移す。ここを通った時点で、座標は現実の側に固定される。
// 以後カメラがどれだけ動いても exodia.position は変わらない。それが「その場に居る」。
function place(){
  exodia.position.setFromMatrixPosition(reticle.matrix);
  // 立った瞬間はこちらを向いていてほしい。面の傾きではなく、見ている向きで決める。
  camera.getWorldPosition(_camP);
  exodia.rotation.set(0, Math.atan2(_camP.x - exodia.position.x,
                                    _camP.z - exodia.position.z), 0);
  reticle.visible = false;
  placed = true;
}

function summon(){
  if (!ready || phase === 'summoning') return;
  // 面を選べていないうちは召喚させない。宙に立たせると、その一回で台無しになる。
  if (xr && !placed){
    if (!hitOK){ tip.textContent = '床やカードに輪が乗るまで、少し動かしてください'; return; }
    place();
    tip.textContent = '2本指で大きさと向き　置き直すには「置き直す」';
  }
  reset();
  phase = 'summoning';
  call.disabled = true;
}

function stand(){
  phase = 'standing';
  auraGain = 1;
  cross.classList.add('dim');   // 追従先は残しつつ、写真の邪魔にならない濃さへ
  uReveal.value = 99;          // 以降は切らない
  call.disabled = false;
  call.textContent = 'もう一度';
  sub.classList.add('on');
  $('tune').classList.add('on');
  fireBtn.classList.add('on');
  fireBtn.disabled = false;
  tip.innerHTML = '「エグゾード・フレイム」で技を放つ<br>2本指、またはボタンで大きさと向き';
}

// 封印しなおす。次の召喚の下ごしらえも兼ねるので、召喚の頭からも呼ぶ。
function reset(){
  phase = 'sealed';
  cross.classList.remove('dim');
  sT = 0; flashV = 0;
  bodyStarted = false;
  auraGain = 0;
  uReveal.value = -99;
  sub.classList.remove('on');
  $('tune').classList.remove('on');
  fireBtn.classList.remove('on');
  fireBtn.disabled = true;
  flameT = -1; flameW = null;
  hideShot();
  call.disabled = false;
  call.textContent = '召　喚';
  for (const p of puffs) p.m.material.opacity = 0;
  seal.material.opacity = seal2.material.opacity = 0;
  shaft.material.opacity = 0;
  burst.material.opacity = 0;
  blob.material.opacity = 0;
  flash.style.opacity = 0;
}

function advance(dt){
  if (phase === 'sealed') return;
  if (phase === 'summoning') sT += dt;
  const t = sT;

  // 魔法陣。滲み出て、回りながら、最後に押し広げられて消える。
  {
    const k = span(T_SEAL, t);
    const o = k < 0 ? 0 : k < 0.18 ? ease(k / 0.18) : k < 0.85 ? 1 : 1 - ease((k - 0.85) / 0.15);
    seal.material.opacity  = Math.max(0, o) * 0.85;
    seal2.material.opacity = Math.max(0, o) * 0.60;
    seal.rotation.z  += dt * 0.30;
    seal2.rotation.z -= dt * 0.52;
    const g = 1 + Math.max(0, o) * 0.04 * Math.sin(t * 3.1);
    seal.scale.setScalar(g);
    seal2.scale.setScalar(0.62 * g);
  }

  // 霧。中心から湧いて、立ち上りながら外へ逃げて薄れる。
  {
    const k = span(T_FOG, t);
    const gain = k < 0 ? 0 : k < 0.22 ? ease(k / 0.22) : k < 0.72 ? 1 : 1 - ease((k - 0.72) / 0.28);
    for (const p of puffs){
      const u = (k * 0.85 + p.ph) % 1;             // それぞれ別の位相で回す
      const life = u < 0.12 ? u / 0.12 : 1 - (u - 0.12) / 0.88;
      const r = p.r0 + p.sp * u * 2.1;
      p.m.position.set(Math.cos(p.a + p.spin * t) * r,
                       0.05 + p.rise * u * 3.0,
                       Math.sin(p.a + p.spin * t) * r);
      p.m.scale.setScalar(0.9 + u * 2.4);
      p.m.material.opacity = Math.max(0, gain * life) * 0.5;
      p.m.quaternion.copy(_billboard);             // 常にカメラを向く
    }
  }

  // 光の柱。根元から天へ。太さを脈動させて生きているように見せる。
  {
    const k = span(T_SHAFT, t);
    const o = k < 0 ? 0 : k < 0.25 ? ease(k / 0.25) : k < 0.70 ? 1 : 1 - ease((k - 0.70) / 0.30);
    shaft.material.opacity = Math.max(0, o) * 0.55;
    const w = 1 + 0.07 * Math.sin(t * 5.2) + 0.04 * Math.sin(t * 11.3);
    shaft.scale.set(w, 1, w);
    shaft.rotation.y += dt * 0.25;
  }

  // 本体。足元から順に実体になる。境目が金色に光りながら上へ抜けていく。
  {
    const k = span(T_BODY, t);
    if (k >= 0 && phase === 'summoning'){
      bodyStarted = true;
      const y0 = exodia.position.y, h = BODY_H * exodia.scale.y, y1 = y0 + h;
      uEdge.value = h * 0.10;
      // 揺らぎは高さに足されるので、背丈ぶん掃いただけでは頭が残る。残ったまま
      // stand() が全部出すため、最後に一気に出たように見えていた。その分を足す。
      uReveal.value = y0 - uEdge.value
                    + ease(Math.min(k, 1)) * (h + uEdge.value * 2.4 + SHADER_NOISE);
      const grow = ease(Math.min(k, 1));
      blob.material.opacity = grow * 0.9;      // 足が出た分だけ影も濃くなる
      auraGain = grow;                          // 実体になるのと同じ速さで風をまとう
    }
  }

  // 解放。輪が走り、画面が一度だけ白く飛ぶ。
  {
    const k = t - T_OPEN;
    if (k >= 0 && k < 1.5){
      const u = k / 1.5;
      burst.material.opacity = (1 - u) * 0.9;
      burst.scale.setScalar(1 + u * 7.0);
      if (k < 0.10) flashV = Math.max(flashV, 0.62);
    } else {
      burst.material.opacity = 0;
    }
  }

  flashV *= Math.pow(0.012, dt);
  flash.style.opacity = flashV < 0.004 ? 0 : flashV;

  if (phase === 'summoning' && t > T_FOG[1]) stand();
}

// 黄金の風。立っているあいだ回し続ける。召喚の途中から巻き始めて、
// 像が結ばれるころには全開になっている。
let auraGain = 0;
function updateAura(dt, e){
  // 煙。生き死には sin で作る。両端がちょうど 0 になるので、湧く瞬間も
  // 消える瞬間も切れ目が出ない。
  for (const p of smoke){
    const u = (e * 0.085 * p.sp + p.ph) % 1;
    const ang = p.a + e * p.sp * 0.38;
    const r = p.r * (0.80 + u * 0.75);
    p.m.position.set(Math.cos(ang) * r, p.y0 + p.rise * u * 2.5, Math.sin(ang) * r);
    p.m.quaternion.copy(_billboard);
    p.m.rotateZ(p.roll * e);                       // 板ごと回して渦を巻かせる
    p.m.scale.setScalar(p.sz * (0.65 + u * 0.85)); // 昇るほど広がって薄れる
    p.m.material.opacity = auraGain * Math.sin(u * Math.PI) * 0.34;
  }

  halo.quaternion.copy(_billboard);
  halo.material.opacity = auraGain * (0.55 + Math.sin(e * 1.3) * 0.08);

  for (const p of sparks){
    const u = (e * 0.16 * p.sp + p.ph) % 1;          // 下から湧いて上で消える
    const life = u < 0.10 ? u / 0.10 : 1 - (u - 0.10) / 0.90;
    const ang = p.a + e * p.sp * 0.7;
    const r = p.r * (0.75 + u * 0.5);
    p.m.position.set(Math.cos(ang) * r, 0.10 + p.rise * u * 4.6, Math.sin(ang) * r);
    p.m.quaternion.copy(_billboard);
    const tw = 0.45 + 0.55 * Math.sin(e * p.tw + p.ph * 9);   // 粒ごとに違う周期で明滅
    p.m.scale.setScalar(p.sz * (0.7 + tw * 0.6));
    p.m.material.opacity = auraGain * Math.max(0, life) * tw;
  }
}

// ------------------------------------------------------- 怒りの業火 魔神火炎砲
// 立っているあいだだけ撃てる。時間は技の頭からの秒で、-1 は出していない印。
let flameT = -1;
const _pL = new THREE.Vector3(), _pR = new THREE.Vector3(), _orbP = new THREE.Vector3();
const _upY = new THREE.Vector3(0, 1, 0);   // 円筒の芯。衣を回す軸に使う。

function flame(){
  if (!ready || phase !== 'standing' || flameT >= 0) return;
  flameT = 0;
  fireBtn.disabled = true;
}

// 姿勢の重みを先に決める。骨を回すより前に呼ばないと、boneSet が拾えない。
function flameStep(dt){
  if (flameT < 0){ flameW = null; return null; }
  const prev = flameT;
  flameT += dt;
  // 撃ち出す一点だけ画面を白く飛ばす。召喚の解放と同じ仕掛けを使い回す。
  if (prev < FLAME_SHOT && flameT >= FLAME_SHOT) flashV = Math.max(flashV, 0.45);
  const w = flamePose(flameT);
  if (w.done){
    flameT = -1; flameW = null;
    fireBtn.disabled = false;
    hideShot();
    return null;
  }
  flameW = w;
  return w;
}

function hideShot(){
  shot.visible = false;
  orb.material.opacity = orbGlow.material.opacity = 0;
  beamCore.material.opacity = beamGlow.material.opacity = 0;
  muzzle.material.opacity = 0;
  for (const p of gathers) p.m.material.opacity = 0;
  for (const v of waves) v.m.material.opacity = 0;
}

// 光の出どころは、手首の骨ではなく掌の真ん中。この模型の手は前腕ほどの長さがあるので、
// 骨の位置からそのまま出すと、掌ではなく手首の手前から光が出る。指の向きへ送って直す。
// 長さは前腕から測る。数字で持つと、大きさを変えたときだけずれる。
const PALM_OUT = 0.35;
const _pF = new THREE.Vector3(), _hq = new THREE.Quaternion();
function palmPoint(hand, fore, out){
  const b = bones[hand], f = bones[fore];
  b.getWorldPosition(out);
  if (!f) return;
  f.getWorldPosition(_pA);
  _pF.fromArray(FLAME_FINGER[hand]).applyQuaternion(b.getWorldQuaternion(_hq)).normalize();
  out.addScaledVector(_pF, out.distanceTo(_pA) * PALM_OUT);
}

// 光の置き場所は毎回そのとき掌から測る。姿勢を直したら光も勝手に付いてくる。
function flameDraw(w, e, dt){
  if (!w || !bones.LeftHand || !bones.RightHand) return;
  shot.visible = true;
  exodia.updateMatrixWorld(true);      // 骨を回した直後。行列を作り直してから測る。
  palmPoint('LeftHand',  'LeftForeArm',  _pL);
  palmPoint('RightHand', 'RightForeArm', _pR);

  // 玉は両の掌のあいだ。撃つ間際には右手のほうへ寄っていく。
  _orbP.copy(_pL).lerp(_pR, 0.5 + 0.42 * w.fire);
  fx.worldToLocal(_orbP);
  const beat = 1 + Math.sin(e * 19) * 0.06 + Math.sin(e * 7.3) * 0.04;
  orb.position.copy(_orbP);
  orb.quaternion.copy(_billboard);
  orb.rotateZ(e * 1.7);                // 芯は回す。止まっていると絵に見える。
  orb.scale.setScalar(w.orbR * beat);
  orb.material.opacity = w.orb;
  orb.visible = orbGlow.visible = w.orb > 0.002;
  orbGlow.position.copy(_orbP);
  orbGlow.quaternion.copy(_billboard);
  orbGlow.scale.setScalar(w.orbR * (1.05 + 0.10 * Math.sin(e * 5.1)));
  orbGlow.material.opacity = w.orb * 0.8;

  // 集まる粒。外から玉へ吸い込まれ、着いたところで消える。
  for (const p of gathers){
    const u = (e * 0.55 * p.sp + p.ph) % 1;
    const ang = p.a + u * p.spin;
    const r = (1 - u) * p.r;
    p.m.position.set(_orbP.x + Math.cos(ang) * r,
                     _orbP.y + p.y * (1 - u),
                     _orbP.z + Math.sin(ang) * r);
    p.m.quaternion.copy(_billboard);
    p.m.scale.setScalar(0.65 + u * 0.85);
    p.m.material.opacity = w.gather *
      (u < 0.15 ? u / 0.15 : u > 0.92 ? (1 - u) / 0.08 : 1);
  }

  // 光線。根元は右の掌。向きは体の正面なので、fx の中では +Z のまま置ける。
  _orbP.copy(_pR);
  fx.worldToLocal(_orbP);
  beam.position.copy(_orbP);
  beam.position.z += 0.18;             // 掌のすぐ先から出す
  const bo = w.beam * (0.90 + Math.sin(e * 31) * 0.10);
  const th = 0.55 + w.beam * 0.45 + Math.sin(e * 23) * 0.05 * w.beam;
  beamCore.material.opacity = bo * 0.95;
  beamGlow.material.opacity = bo * 0.50;
  beam.visible = w.beam > 0.002;
  beamCore.scale.set(th, 1, th);
  beamGlow.scale.set(th * 2.3, 1, th * 2.3);
  // 濃淡は動かさない。絵ごと流すと、手元がいちばん濃いという形まで一緒に流れて、
  // 根元が暗い瞬間ができる。衣のほうを軸まわりに回して、走っているように見せる。
  beamGlow.rotateOnAxis(_upY, dt * 2.4);
  for (const v of waves){
    const u = (e * 0.9 + v.ph) % 1;
    v.m.position.z = u * BEAM_LEN;
    const g = 0.6 + u * 4.4;
    v.m.scale.set(g, g, 1);
    v.m.material.opacity = w.beam * (1 - u) * 0.5;
  }

  muzzle.position.copy(_orbP);
  muzzle.quaternion.copy(_billboard);
  muzzle.scale.setScalar(0.55 + w.muzzle * 1.5);
  muzzle.material.opacity = w.muzzle;
  muzzle.visible = w.muzzle > 0.002;
}

// ---------------------------------------------------------------- 置く場所の目印
// WebXR のヒットテストが返す姿勢は、面の法線が +Y。輪はそのままだと立ってしまうので、
// 姿勢は入れ物に持たせ、中で寝かせる。こうすると姿勢をそのまま行列で流し込める。
const reticle = new THREE.Group();
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);
{
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffd267, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.055, 0.075, 48), mat);
  ring.rotation.x = -Math.PI / 2;
  reticle.add(ring);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 20), mat);
  dot.rotation.x = -Math.PI / 2;
  reticle.add(dot);
}

// ---------------------------------------------------------------- 指
// AR では大きさと向きだけ。置き場所は現実の面が決めるので、指では動かさない。
const PINCH_MIN = 10;        // これ未満は指がくっついているとみなす（px）
const R_MAX = 1.14;          // 1フレームで許す倍率の変化。跳ねを根元で止める。
const POS_MAX = 2.2;         // 貼り付け表示のとき、画面の外へ飛ばさない
// 基準の倍率。AR は実寸なので、ここが背丈をメートルへ読み替える係数になる。
let base = 1;
// 倍率の幅。AR は実寸なので、カードの上の置物から見上げる大きさまで要る。
// 貼り付け表示は画面に収まる範囲でよいので狭くてよい。
let sLo = 0.35, sHi = 1.8;
const clampS = (v) => Math.min(base * sHi, Math.max(base * sLo, v));
const clampP = (v) => Math.min(POS_MAX, Math.max(-POS_MAX, v));

const pts = new Map();
// 開始時点からの差ではなく、1フレームごとの差で積む。開始時の値で割らないので
// 指が近いところから始めても跳ねず、ひねりが ±π をまたいでも飛ばない。
let dragX = 0, dragY = 0, dPrev = 0, aPrev = 0, cyPrev = 0, twoOn = false;
const two = () => [...pts.values()];
const dist2 = () => { const p = two(); return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); };
const ang2  = () => { const p = two(); return Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x); };
const cen2  = () => { const p = two(); return (p[0].y + p[1].y) / 2; };
// 画面の1pxが、この距離で何ワールド単位になるか。貼り付け表示のときだけ使う。
const perPx = () => 2 * DIST * Math.tan(camera.fov * Math.PI / 360) / innerHeight;

touch.addEventListener('pointerdown', (e) => {
  touch.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 1){ dragX = e.clientX; dragY = e.clientY; }
  else if (pts.size === 2){
    dPrev = dist2(); aPrev = ang2(); cyPrev = cen2();
    twoOn = true;
  }
});

touch.addEventListener('pointermove', (e) => {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 1){
    // AR では置き場所を現実の面が持っている。指でずらすと「その場に居る」という
    // 前提が崩れるので受け付けない。貼り付け表示のときだけ動かせる。
    if (xr) return;
    const k = perPx();
    exodia.position.x = clampP(exodia.position.x + (e.clientX - dragX) * k);
    exodia.position.y = clampP(exodia.position.y - (e.clientY - dragY) * k);
    dragX = e.clientX; dragY = e.clientY;
  } else if (pts.size === 2 && twoOn){
    const d = dist2(), a = ang2(), cy = cen2();
    // 大きさ。1フレームぶんの比だけを掛ける。比に上限を置いてあるので、
    // 指がくっついた瞬間があっても一足飛びに拡大しない。
    if (d > PINCH_MIN && dPrev > PINCH_MIN){
      const r = Math.min(R_MAX, Math.max(1 / R_MAX, d / dPrev));
      exodia.scale.setScalar(clampS(exodia.scale.x * r));
    }
    // 向き。atan2 は ±π をまたぐと符号が反転する。差を畳んでから積まないと
    // その瞬間に一周ぶん飛ぶ。
    let da = a - aPrev;
    while (da >  Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    exodia.rotation.y += da;
    // 面の傾きは AR が教えてくれる。手で倒すのは貼り付け表示のときだけ。
    if (!xr) exodia.rotation.x =
      Math.min(0.9, Math.max(-0.9, exodia.rotation.x + (cy - cyPrev) * 0.006));
    dPrev = d; aPrev = a; cyPrev = cy;
  }
});

const drop = (e) => {
  pts.delete(e.pointerId);
  // 2本から1本になったら、残った指を掴み直す。ここを飛ばすと像が飛ぶ。
  if (pts.size === 1){ const p = two()[0]; dragX = p.x; dragY = p.y; }
  twoOn = false;
};
touch.addEventListener('pointerup', drop);
touch.addEventListener('pointercancel', drop);

// 押しているあいだ効き続ける。1回ずつのタップで合わせるのは骨が折れる。
function hold(id, step){
  const b = $(id);
  let t = 0;
  const go = () => step();
  const start = (e) => {
    e.preventDefault();
    go();
    clearInterval(t);
    t = setInterval(go, 60);
  };
  const stop = () => clearInterval(t);
  b.addEventListener('pointerdown', start);
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, stop);
}
hold('tSmall', () => exodia.scale.setScalar(clampS(exodia.scale.x * 0.97)));
hold('tBig',   () => exodia.scale.setScalar(clampS(exodia.scale.x * 1.03)));
hold('tCcw',   () => { exodia.rotation.y += 0.05; });
hold('tCw',    () => { exodia.rotation.y -= 0.05; });

call.addEventListener('click', summon);
fireBtn.addEventListener('click', flame);
$('bReset').addEventListener('click', () => reset());
addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') summon();
  if (e.key === 'f' || e.key === 'F') flame();
  if (e.key === '0') reset();
});

// 置き直す。AR では面を選ぶところからやり直し、貼り付け表示では真ん中へ戻す。
$('bHome').addEventListener('click', () => { home(); reset(); });

function home(){
  placed = false;
  exodia.scale.setScalar(base);
  exodia.rotation.set(0, 0, 0);
  if (!xr) exodia.position.set(0, 0, -DIST);
}

// ---------------------------------------------------------------- 起動
// WebXR が使えるなら現実の中に置く。使えない端末では今までどおり画面に貼る。
let xr = null, hitSource = null, placed = false, hitOK = false;

function begin(){
  gate.classList.add('gone');
  setTimeout(() => { gate.style.display = 'none'; }, 520);
  hud.classList.add('on');
  if (!ready){ call.disabled = true; call.textContent = '読み込み中…'; }
  renderer.setAnimationLoop(tick);
}

function fail(err, why){
  tapme.style.display = 'none';
  note.textContent = why + '（' + ((err && err.message) || err) + '）';
  gate.dataset.busy = '';
}

// 現実の中に置く方。床や机を検出してそこへ立たせる。以後カメラが動いても
// エクゾディアは動かない。歩いて回り込める。
function startXR(){
  tapme.textContent = 'AR を起動しています…';
  navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test', 'local'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: $('ov') },
  }).then((session) => {
    xr = session;
    document.body.classList.add('xr');
    renderer.xr.enabled = true;
    // three 0.149 の既定は 'local-floor'。setSession() の中でこれを要求するので、
    // 対応していない端末はそこで落ちる（落ちるのは自分で書いた行ではない）。
    // 床の高さは要らない。置く場所はヒットテストが教えてくれる。
    renderer.xr.setReferenceSpaceType('local');
    // 3D の層を少し小さく焼く。実写側の粗さに対して等倍で描く意味は薄く、
    // 塗る画素が減るぶんそのまま軽くなる。
    renderer.xr.setFramebufferScaleFactor(0.8);
    // AR は実寸。背丈 1.6 のまま置くと 1.6m の巨人になる。机の上に置く物として
    // 既定はひざ下ほどにし、あとは指で決めてもらう。
    base = AR_H / BODY_H;
    sLo = 0.15; sHi = 3.0;      // 実寸で 5cm ほどから 1m ほどまで
    exodia.scale.setScalar(base);
    session.addEventListener('end', () => {
      xr = null; hitSource = null; placed = false;
      document.body.classList.remove('xr');
      renderer.xr.enabled = false;
    });
    return renderer.xr.setSession(session).then(() => session.requestReferenceSpace('viewer'));
  }).then((viewer) => xr.requestHitTestSource({ space: viewer }))
    .then((src) => { hitSource = src; begin(); })
    .catch(xrFailed);
}

// AR の用意に失敗したときは、必ずセッションを閉じてから貼り付け表示へ落ちる。
// 閉じ忘れると、何も描かれない真っ黒な全画面に取り残される。
function xrFailed(err){
  const why = (err && err.message) || String(err);
  const s = xr;
  xr = null; hitSource = null;
  document.body.classList.remove('xr');
  renderer.xr.enabled = false;
  base = 1;
  exodia.scale.setScalar(1);
  Promise.resolve(s && s.end()).catch(() => {}).then(() => {
    tip.textContent = 'この端末では AR を使えないので、画面に重ねて表示します';
    startFlat();
  });
}

// 貼り付け表示。WebXR が無い端末でも今までどおり使えるようにしておく。
function startFlat(){
  tapme.textContent = 'カメラを起動しています…';
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' },
             width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  }).then((s) => {
    cam.srcObject = s;
    return cam.play();
  }).then(begin)
    .catch((err) => fail(err, 'はじめられませんでした。カメラを許可してから開き直してください'));
}

function boot(){
  if (gate.dataset.busy) return;
  gate.dataset.busy = '1';
  tapme.textContent = '確かめています…';
  const ask = navigator.xr && navigator.xr.isSessionSupported
    ? navigator.xr.isSessionSupported('immersive-ar').catch(() => false)
    : Promise.resolve(false);
  ask.then((ok) => (ok ? startXR() : startFlat()));
}
gate.addEventListener('click', boot);

// ---------------------------------------------------------------- 重さの調整
// 加算合成の板は、枚数ではなく「画面を何回塗るか」で効く。端末ごとの限界が
// 読めないので、実測して自分で間引く。止まった豪華さより、動く控えめさを取る。
let fpsT = 0, fpsN = 0, quality = 1;

function applyQuality(){
  const ns = Math.round(smoke.length  * quality);
  const nk = Math.round(sparks.length * quality);
  smoke.forEach((p, i)  => { p.m.visible = i < ns; });
  sparks.forEach((p, i) => { p.m.visible = i < nk; });
  puffs.forEach((p, i)  => { p.m.visible = i < Math.round(puffs.length * quality); });
  gathers.forEach((p, i) => { p.m.visible = i < Math.round(gathers.length * quality); });
  waves.forEach((v, i)   => { v.m.visible = i < Math.round(waves.length * quality); });
  halo.visible = quality > 0.5;
}

function watchFps(dt){
  fpsT += dt; fpsN++;
  if (fpsT < 1.5) return;
  const fps = fpsN / fpsT;
  fpsT = 0; fpsN = 0;
  const before = quality;
  if (fps < 40) quality = Math.max(0.25, quality - 0.25);
  else if (fps > 54) quality = Math.min(1, quality + 0.15);
  if (quality !== before) applyQuality();
}

// ---------------------------------------------------------------- ループ
const clock = new THREE.Clock();
const _camQ = new THREE.Quaternion(), _camP = new THREE.Vector3();

function tick(time, frame){
  const dt = Math.min(clock.getDelta(), 0.05);
  watchFps(dt);

  // 置く場所を探す。カメラの正面から現実の面へ光線を落とし、当たったところに輪を出す。
  // 置いたあとは探さない。探し続けると、輪と一緒に本体まで動かしたくなる。
  if (frame && hitSource && !placed){
    const space = renderer.xr.getReferenceSpace();
    const hits = space ? frame.getHitTestResults(hitSource) : [];
    const pose = hits.length ? hits[0].getPose(space) : null;
    if (pose){
      reticle.matrix.fromArray(pose.transform.matrix);
      reticle.visible = true;
      hitOK = true;
    } else {
      reticle.visible = false;
      hitOK = false;
    }
  }

  // 親は指で回され傾けられる。その分を打ち消さないと、板が一緒に倒れる。
  fx.getWorldQuaternion(_pq).invert();
  _billboard.copy(_pq).multiply(camera.getWorldQuaternion(_camQ));
  advance(dt);
  // 骨は出現中からゆらしておく。像を結んだ瞬間に動き出すと、そこで作り物に見える。
  if (ready){
    const e = clock.elapsedTime;
    const w = flameStep(dt);
    breathe(e);
    aimArms(w, e);
    updateAura(dt, e);
    flameDraw(w, e, dt);
    body.position.y = Math.sin(e * 1.05) * 0.014 * BODY_H;   // 息に合わせて全体も沈んで伸びる
    // 撃った反動。後ろへ押され、撃っているあいだは細かく震える。
    body.position.z = w ? -w.kick * 0.05 * BODY_H : 0;
    body.position.x = w ? Math.sin(e * 57) * 0.005 * BODY_H * w.beam : 0;
  }
  renderer.render(scene, camera);
}
