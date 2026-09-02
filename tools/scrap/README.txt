一度きりの細工。もう呼ばれない。

ルイーズの兜のとげを削り、その跡の法線と絵を直すまでに使った道具が並んでいる。
どれも models/ の特定のモデルの、特定の場所を前提にしている。残してあるのは、
同じ種類の直しがまた要るときに、やり方を思い出すため。

  probe.mjs prof.mjs   形を測って、とげの根元がどこかを探す
  spikes.mjs despike.mjs dome.mjs crease.mjs   とげを削り、面を均す
  nrm.mjs bumps.mjs holes.mjs protr.mjs        削った跡の法線と穴を直す
  retex.mjs darkfix.mjs                        絵に描かれた輪郭線と影を消す
  check.mjs angle.mjs crop.mjs tips.mjs exfit.mjs   確かめるための細々したもの

どれもリポジトリ直下から `node tools/scrap/xxx.mjs` で走らせる前提。
