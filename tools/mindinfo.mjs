// カードの学習データ（.mind）の中身を見る。
//
//   node tools/mindinfo.mjs elf.mind
//
// 追跡が効くかどうかは、ほぼ「特徴点がいくつ取れたか」で決まる。compile.html は
// 成功としか言わないので、少ないまま気づかず実機へ持って行くと、かざしても
// 何も出ないという形で初めて分かる。それを机の上で見るための道具。
//
// 中身は msgpack。必要な型（マップ・配列・文字列・整数・小数・真偽）だけ読む。
import fs from 'node:fs';

const buf = fs.readFileSync(process.argv[2] || 'targets.mind');
let o = 0;

function read(){
  const b = buf[o++];
  // 固定長のもの
  if (b <= 0x7f) return b;                                  // 正の固定整数
  if (b >= 0xe0) return b - 256;                            // 負の固定整数
  if (b >= 0x80 && b <= 0x8f) return map(b & 0x0f);          // 固定マップ
  if (b >= 0x90 && b <= 0x9f) return arr(b & 0x0f);          // 固定配列
  if (b >= 0xa0 && b <= 0xbf) return str(b & 0x1f);          // 固定文字列
  switch (b){
    case 0xc0: return null;
    case 0xc2: return false;
    case 0xc3: return true;
    case 0xc4: return bin(buf.readUInt8(o), (o += 1));
    case 0xc5: return bin(buf.readUInt16BE(o), (o += 2));
    case 0xc6: return bin(buf.readUInt32BE(o), (o += 4));
    case 0xca: { const v = buf.readFloatBE(o);  o += 4; return v; }
    case 0xcb: { const v = buf.readDoubleBE(o); o += 8; return v; }
    case 0xcc: return buf.readUInt8(o++);
    case 0xcd: { const v = buf.readUInt16BE(o); o += 2; return v; }
    case 0xce: { const v = buf.readUInt32BE(o); o += 4; return v; }
    case 0xcf: { const v = Number(buf.readBigUInt64BE(o)); o += 8; return v; }
    case 0xd0: return buf.readInt8(o++);
    case 0xd1: { const v = buf.readInt16BE(o); o += 2; return v; }
    case 0xd2: { const v = buf.readInt32BE(o); o += 4; return v; }
    case 0xd3: { const v = Number(buf.readBigInt64BE(o)); o += 8; return v; }
    case 0xd9: { const n = buf.readUInt8(o);  o += 1; return str(n); }
    case 0xda: { const n = buf.readUInt16BE(o); o += 2; return str(n); }
    case 0xdb: { const n = buf.readUInt32BE(o); o += 4; return str(n); }
    case 0xdc: { const n = buf.readUInt16BE(o); o += 2; return arr(n); }
    case 0xdd: { const n = buf.readUInt32BE(o); o += 4; return arr(n); }
    case 0xde: { const n = buf.readUInt16BE(o); o += 2; return map(n); }
    case 0xdf: { const n = buf.readUInt32BE(o); o += 4; return map(n); }
  }
  throw new Error('読めない型 0x' + b.toString(16) + ' （位置 ' + (o - 1) + '）');
}
const str = (n) => { const s = buf.toString('utf8', o, o + n); o += n; return s; };
const bin = (n) => { const s = buf.subarray(o, o + n); o += n; return s; };
const arr = (n) => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = read(); return a; };
const map = (n) => { const m = {}; for (let i = 0; i < n; i++){ const k = read(); m[k] = read(); } return m; };

const data = read();
const list = data.dataList || [];
console.log(process.argv[2] + '  ' + (buf.length / 1024).toFixed(0) + ' KB  版 ' + data.v);
console.log('カード ' + list.length + '枚');

list.forEach((t, i) => {
  // targetImage は一番大きい段の原寸。matchingData は照合用、trackingData は追跡用。
  const img = t.targetImage || {};
  const match = t.matchingData || [];
  const track = t.trackingData || [];
  const mp = match.reduce((s, m) => s + ((m.maximaPoints || []).length + (m.minimaPoints || []).length), 0);
  const tp = track.reduce((s, m) => s + ((m.points || []).length), 0);
  console.log('  [' + i + '] ' + (img.width || '?') + 'x' + (img.height || '?') +
              '  照合の段 ' + match.length + ' 合計 ' + mp + '点' +
              '  追跡の段 ' + track.length + ' 合計 ' + tp + '点');
  // 段ごとの内訳。上の段（小さく写ったとき）に点が無いと、遠いカードを拾えない。
  match.forEach((m, k) => {
    const n = (m.maximaPoints || []).length + (m.minimaPoints || []).length;
    console.log('      照合 段' + k + '  ' + String(m.width).padStart(4) + 'x' +
                String(m.height).padStart(4) + '  ' + String(n).padStart(4) + '点' +
                (n < 20 ? '  ← 少ない' : ''));
  });
  if (mp < 150) console.log('  ※ 合計が少ない。模様の薄いカードは追跡が不安定になる。');
});
