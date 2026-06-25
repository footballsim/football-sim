#!/usr/bin/env node
'use strict';
/**
 * slice-sheet.js — スプライトシート（マゼンタ背景に複数ポーズ）を個別フレームに切り出す。
 *   ① マゼンタ(#ff00ff)をchroma-keyで透過 ② 空白列でフィギュアを自動分割（等分割しないので
 *   ポーズ間隔がバラついてもOK）③ 各フレームを透過トリム＋最近傍で縮小（ドット化）して保存。
 *
 * 使い方: node tools/art/slice-sheet.js <sheet.png> <outPrefix> [height=120]
 *   出力: <outPrefix>_f1.png, _f2.png, ...（透過PNG・コマ送り再生用）
 */
const sharp = require('sharp');

async function sliceSheet(inPath, outPrefix, opts = {}) {
  const targetH = opts.height || 120;
  const { data, info } = await sharp(inPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // ① chroma-key: マゼンタ(高R・低G・高B)を透過
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 165 && g < 115 && b > 165) data[i + 3] = 0;
  }

  // ② 列ごとの非透過ピクセル数 → 空白列で区切ってフィギュアの run を検出
  const colCount = new Array(width).fill(0);
  for (let y = 0; y < height; y++) {
    const row = y * width * channels;
    for (let x = 0; x < width; x++) if (data[row + x * channels + 3] > 24) colCount[x]++;
  }
  let runs = [], start = -1;
  for (let x = 0; x < width; x++) {
    const filled = colCount[x] > 3;
    if (filled && start < 0) start = x;
    if (!filled && start >= 0) { runs.push([start, x - 1]); start = -1; }
  }
  if (start >= 0) runs.push([start, width - 1]);
  runs = runs.filter(r => (r[1] - r[0]) > width * 0.03);   // ノイズ除去
  if (!runs.length) throw new Error('フィギュアを検出できませんでした（chroma-key闾値かシート確認）');

  // ③ 各 run の bbox を手動算出 → 抽出 → 縮小（最近傍）。sharp.trim はバージョン差で不安定なので使わない。
  const out = [];
  for (let f = 0; f < runs.length; f++) {
    const [l, r] = runs[f];
    let minX = r, maxX = l, minY = height, maxY = 0;
    for (let y = 0; y < height; y++) {
      const row = y * width * channels;
      for (let x = l; x <= r; x++) {
        if (data[row + x * channels + 3] > 24) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) continue;
    const o = outPrefix + '_f' + (f + 1) + '.png';
    await sharp(data, { raw: { width, height, channels } })
      .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
      .resize({ height: targetH, kernel: 'nearest' })
      .png()
      .toFile(o);
    out.push(o);
  }
  return out;
}

if (require.main === module) {
  const a = process.argv;
  if (!a[2] || !a[3]) { console.error('usage: node tools/art/slice-sheet.js <sheet.png> <outPrefix> [height=120]'); process.exit(2); }
  sliceSheet(a[2], a[3], { height: a[4] ? +a[4] : 120 })
    .then(o => console.log('frames(' + o.length + '):', o.map(p => p.replace(/.*\//, '')).join(' ')))
    .catch(e => { console.error(e.message); process.exit(1); });
}
module.exports = { sliceSheet };
