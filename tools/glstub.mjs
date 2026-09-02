// 画面の無いところで three を動かすための差し替え。WebGLRenderer だけ偽物にする。
// 本物を丸ごと再輸出したうえで同じ名前を後から定義すると、そちらが勝つ。
// 'three' という名前で読むと自分自身に戻ってしまうので、実体の場所を直に指す。
export * from '../node_modules/three/build/three.module.js';

export class WebGLRenderer {
  constructor(opt = {}){
    // 束ねた側の実体を外から掴めるようにしておく。ここを import で取りに行くと
    // three がもう一組読まれて、別物になる。
    globalThis.__gl = this;
    this.domElement = opt.canvas || {};
    this.outputEncoding = 0;
    this.shadowMap = { enabled: false };
    this.info = { render: {} };
    this.frames = 0;
    this.loop = null;
    this.xr = {
      enabled: false,
      setReferenceSpaceType(){},
      setFramebufferScaleFactor(){},
      setSession(){ return Promise.resolve(); },
      getReferenceSpace(){ return null; },
    };
  }
  setPixelRatio(){}
  setSize(){}
  setClearColor(){}
  getContext(){ return null; }
  // 実際に塗らない。ここで見たいのは絵ではなく、例外が出ないことなので。
  render(){ this.frames++; }
  setAnimationLoop(fn){ this.loop = fn; }
  dispose(){}
}
