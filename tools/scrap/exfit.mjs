import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read('models/exodia.glb');
const r = doc.getRoot();
const prim = r.listMeshes()[0].listPrimitives()[0];
const pos = prim.getAttribute('POSITION');
const lo=[1e9,1e9,1e9], hi=[-1e9,-1e9,-1e9], v=[0,0,0];
for (let i=0;i<pos.getCount();i++){ pos.getElement(i,v);
  for(let k=0;k<3;k++){ lo[k]=Math.min(lo[k],v[k]); hi[k]=Math.max(hi[k],v[k]); } }
console.log('素の頂点の箱（fit() が測っているもの）:');
console.log('  高さ =', (hi[1]-lo[1]).toFixed(3), ' 幅 =', (hi[0]-lo[0]).toFixed(3));
console.log('  min.y =', lo[1].toFixed(3), ' max.y =', hi[1].toFixed(3));

// 節点の階層に掛かっている倍率
const walk = (n, d, acc) => {
  const s = n.getScale();
  const a = acc * s[1];
  if (d < 3) console.log('  '.repeat(d+1) + n.getName() + '  scale=' + s.map(x=>x.toFixed(4)).join(',') + '  累積=' + a.toFixed(5));
  for (const c of n.listChildren()) walk(c, d+1, a);
};
console.log('節点の倍率:');
for (const s of r.listScenes()) for (const n of s.listChildren()) walk(n, 0, 1);

// スキンメッシュを持つ節点
for (const n of r.listNodes()) if (n.getMesh()) console.log('メッシュを持つ節点:', n.getName(), 'skin=', !!n.getSkin());
