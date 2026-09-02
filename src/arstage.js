// 現実の中にキャラを置くための土台。ルイーズとエルフの剣士が共有する。
//
// エクゾディアが先に作った道をそのまま踏んでいる：
//   WebXR が使えるなら immersive-ar + ヒットテストで、床や机の上に置く。
//   置いたあとカメラが動いても、キャラはその場に居る。歩いて回り込める。
//   使えない端末（iPhone の Safari など）では、カメラ映像に貼り付ける方へ落とす。
//
// エクゾディア（src/exodia.js）は自前の同じ仕組みを抱えたままにしてある。
// あちらは効果と絡んで組んであり、動いているものを触る利が無い。ここを直したら
// あちらも見る、とだけ決めておく。
//
// 【カードをやめたので失ったもの】位置・向き・実寸をカードが決めてくれない。
// 指で置く。接地は現実の面に任せる。それと、手の検出が使えない（WebXR の
// パススルー映像はページから触れないので、MediaPipe に渡すフレームが無い）。
import * as THREE from 'three';

// 貼り付け表示のときの、カメラからキャラまでの距離。
const DIST = 4.2;
const PINCH_MIN = 10;     // これ未満は指がくっついているとみなす（px）
const R_MAX = 1.14;       // 1フレームで許す倍率の変化。跳ねを根元で止める。
const POS_MAX = 2.2;      // 貼り付け表示のとき、画面の外へ飛ばさない

const _camP = new THREE.Vector3();

// opt:
//   gl, cam, touch      canvas / video / 指の受け皿の要素
//   ov                  dom-overlay に渡す入れ物
//   gate, note, tapme, tip   起動画面と案内の要素
//   bodyH               貼り付け表示のときの背丈（ワールド単位）
//   arH                 AR のときの背丈（メートル）。実寸なのでここが効く。
//   onReady             カメラ／XR が立ち上がったとき
//   onPlaced            面の上に置いたとき
export function createStage(opt){
  const $ = (id) => document.getElementById(id);
  const { gate, note, tapme, tip } = opt;

  // antialias はモバイルでは高くつく。輪郭は影と背景が隠すので外す。
  const renderer = new THREE.WebGLRenderer({
    canvas: opt.gl, alpha: true, antialias: false, powerPreference: 'high-performance' });
  // 画素の刻み。1.5 で頭打ちにしていたが、いまの端末はたいてい 3 なので、
  // 実写のカメラ映像の隣に半分の解像度で描くことになり、3D だけがぼやけて見えた。
  // 場面は2万三角形と光ひとつで、塗る画素を倍にしても足りる。
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  // three は 0.149。outputColorSpace / texture.colorSpace が入るのは 0.152 から。
  // この版に書いても新しい属性が生えるだけで誰も読まない。線形のまま画面へ行き、
  // 中間調が軒並み沈む。この版では encoding 側で指定するのが正しい。
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

  function resize(){
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  // 足元を原点にした入れ物。指の操作はすべてこれを動かす。
  const stage = new THREE.Group();
  stage.rotation.order = 'YXZ';   // 先に向き、あとから傾き。逆だと傾けが斜めに効く。
  stage.position.set(0, 0, -DIST);
  scene.add(stage);

  // ---------------------------------------------------------------- 置く目印
  // ヒットテストが返す姿勢は面の法線が +Y。輪はそのままだと立ってしまうので、
  // 姿勢は入れ物に持たせ、中で寝かせる。姿勢をそのまま行列で流し込める。
  const reticle = new THREE.Group();
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
  {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x8fd0ff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.055, 0.075, 48), mat);
    ring.rotation.x = -Math.PI / 2;
    reticle.add(ring);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 20), mat);
    dot.rotation.x = -Math.PI / 2;
    reticle.add(dot);
  }

  // ---------------------------------------------------------------- 状態
  let xr = null, hitSource = null, placed = false, hitOK = false;
  // 基準の倍率。AR は実寸なので、ここが背丈をメートルへ読み替える係数になる。
  let base = 1;
  // 倍率の幅。AR は実寸なので、机の置物から見上げる大きさまで要る。
  let sLo = 0.35, sHi = 1.8;
  const clampS = (v) => Math.min(base * sHi, Math.max(base * sLo, v));
  const clampP = (v) => Math.min(POS_MAX, Math.max(-POS_MAX, v));

  // ---------------------------------------------------------------- 指
  // AR では大きさと向きだけ。置き場所は現実の面が決めるので、指では動かさない。
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

  const touch = opt.touch;
  touch.addEventListener('pointerdown', (e) => {
    touch.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1){ dragX = e.clientX; dragY = e.clientY; }
    else if (pts.size === 2){ dPrev = dist2(); aPrev = ang2(); cyPrev = cen2(); twoOn = true; }
  });

  touch.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1){
      // 置いたら、そこから動かさない。AR では置き場所を現実の面が持っているし、
      // 貼り付け表示でも「決めた場所に居る」ことにする。指で動かせるのは
      // 決める前だけ。動かしたくなったら「置き直す」で決め直す。
      if (xr || placed) return;
      const k = perPx();
      stage.position.x = clampP(stage.position.x + (e.clientX - dragX) * k);
      stage.position.y = clampP(stage.position.y - (e.clientY - dragY) * k);
      dragX = e.clientX; dragY = e.clientY;
    } else if (pts.size === 2 && twoOn){
      const d = dist2(), a = ang2(), cy = cen2();
      // 大きさ。1フレームぶんの比だけを掛ける。比に上限を置いてあるので、
      // 指がくっついた瞬間があっても一足飛びに拡大しない。
      if (d > PINCH_MIN && dPrev > PINCH_MIN){
        const r = Math.min(R_MAX, Math.max(1 / R_MAX, d / dPrev));
        stage.scale.setScalar(clampS(stage.scale.x * r));
      }
      // 向き。atan2 は ±π をまたぐと符号が反転する。差を畳んでから積まないと
      // その瞬間に一周ぶん飛ぶ。
      let da = a - aPrev;
      while (da >  Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      stage.rotation.y += da;
      // 面の傾きは AR が教えてくれる。手で倒すのは貼り付け表示のときだけ。
      if (!xr) stage.rotation.x =
        Math.min(0.9, Math.max(-0.9, stage.rotation.x + (cy - cyPrev) * 0.006));
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
  // WebXR の dom-overlay では2本目の指が届かない端末があるので、大きさと向きは
  // ボタンからも変えられるようにしておく。指が使えなくても詰まない。
  function hold(id, step){
    const b = $(id);
    if (!b) return;
    let t = 0;
    const start = (e) => { e.preventDefault(); step(); clearInterval(t); t = setInterval(step, 60); };
    const stop = () => clearInterval(t);
    b.addEventListener('pointerdown', start);
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, stop);
  }
  hold('tSmall', () => stage.scale.setScalar(clampS(stage.scale.x * 0.97)));
  hold('tBig',   () => stage.scale.setScalar(clampS(stage.scale.x * 1.03)));
  hold('tCcw',   () => { stage.rotation.y += 0.05; });
  hold('tCw',    () => { stage.rotation.y -= 0.05; });

  // ---------------------------------------------------------------- 置く／戻す
  // 輪のところへ本体を移す。ここを通った時点で、座標は現実の側に固定される。
  // 以後カメラがどれだけ動いても stage.position は変わらない。それが「その場に居る」。
  function place(){
    stage.position.setFromMatrixPosition(reticle.matrix);
    // 置いた瞬間はこちらを向いていてほしい。面の傾きではなく、見ている向きで決める。
    camera.getWorldPosition(_camP);
    stage.rotation.set(0, Math.atan2(_camP.x - stage.position.x,
                                     _camP.z - stage.position.z), 0);
    reticle.visible = false;
    placed = true;
    if (opt.onPlaced) opt.onPlaced();
  }

  // 置き直す。AR では面を選ぶところからやり直し、貼り付け表示では真ん中へ戻す。
  function home(){
    placed = false;
    stage.scale.setScalar(base);
    stage.rotation.set(0, 0, 0);
    if (!xr) stage.position.set(0, 0, -DIST);
  }

  // 面を選べていないうちは置かせない。宙に立たせると、その一回で台無しになる。
  // 貼り付け表示には面が無いので、いつでも通す。ただし「置いた」の合図は
  // 両方で出す。ここを AR だけにすると、貼り付け表示で案内が変わらないまま残る。
  function tryPlace(){
    if (placed) return true;
    if (!xr){ placed = true; if (opt.onPlaced) opt.onPlaced(); return true; }
    if (!hitOK){ if (tip) tip.textContent = '床や机に輪が乗るまで、少し動かしてください'; return false; }
    place();
    return true;
  }

  // ---------------------------------------------------------------- 起動
  function begin(){
    gate.classList.add('gone');
    setTimeout(() => { gate.style.display = 'none'; }, 520);
    if (opt.onReady) opt.onReady(!!xr);
  }

  function fail(err, why){
    tapme.style.display = 'none';
    note.textContent = why + '（' + ((err && err.message) || err) + '）';
    gate.dataset.busy = '';
  }

  // 現実の中に置く方。床や机を検出してそこへ立たせる。
  function startXR(){
    tapme.textContent = 'AR を起動しています…';
    navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test', 'local'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: opt.ov },
    }).then((session) => {
      xr = session;
      document.body.classList.add('xr');
      renderer.xr.enabled = true;
      // three 0.149 の既定は 'local-floor'。setSession() の中でこれを要求するので、
      // 対応していない端末はそこで落ちる（落ちるのは自分で書いた行ではない）。
      // 床の高さは要らない。置く場所はヒットテストが教えてくれる。
      renderer.xr.setReferenceSpaceType('local');
      // 3D の層は等倍で焼く。0.8 に落として軽くしていたが、パススルーの実写は
      // 等倍のままなので、キャラだけが甘くなって浮いて見えた。軽さより、
      // 実写と同じ細かさで乗っていることを取る。
      renderer.xr.setFramebufferScaleFactor(1.0);
      // AR は実寸。背丈 1.9 のまま置くと 1.9m の巨人になる。机に置く物として
      // 既定はここで決め、あとは指で。
      base = opt.arH / opt.bodyH;
      sLo = 0.25; sHi = 4.0;      // 実寸で 6cm ほどから 1m ほどまで
      stage.scale.setScalar(base);
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
    const s = xr;
    xr = null; hitSource = null;
    document.body.classList.remove('xr');
    renderer.xr.enabled = false;
    base = 1;
    stage.scale.setScalar(1);
    Promise.resolve(s && s.end()).catch(() => {}).then(() => {
      if (tip) tip.textContent = 'この端末では AR を使えないので、画面に重ねて表示します';
      startFlat();
    });
  }

  // 貼り付け表示。WebXR が無い端末でも撮れるようにしておく。
  // こちらは映像要素があるので、手の検出も使える。
  function startFlat(){
    tapme.textContent = 'カメラを起動しています…';
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' },
               width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    }).then((s) => {
      opt.cam.srcObject = s;
      return opt.cam.play();
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

  // 毎フレーム、描く前に呼ぶ。置く場所を探すのはここ。
  // 置いたあとは探さない。探し続けると、輪と一緒に本体まで動かしたくなる。
  function update(frame){
    if (!frame || !hitSource || placed) return;
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

  return {
    renderer, scene, camera, stage, reticle,
    update, place, home, tryPlace, boot,
    isXR: () => !!xr,
    isPlaced: () => placed,
    video: () => (xr ? null : opt.cam),
  };
}
