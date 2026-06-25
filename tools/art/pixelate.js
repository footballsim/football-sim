'use strict';
/**
 * pixelate.js — 任意の画像を「粗いドット絵」へ後処理する。
 * 高解像度の生成画像 → 強い縮小（最近傍）＋ パレット量子化 → チャンキーなNES調に。
 * 表示側は image-rendering:pixelated で拡大する前提なので、ここでは小さく保存する。
 *
 * 使い方: node tools/art/pixelate.js <in> <out.png> [width=176] [colors=32]
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function pixelate(inPath, outPath, opts = {}) {
  const width = opts.width || 140;          // 横ピクセル数（小さいほど粗い・既定140=A基準）
  const colors = opts.colors || 28;         // パレット色数（既定28）
  const saturation = opts.saturation || 1.15;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp(inPath)
    .resize({ width, kernel: 'nearest', withoutEnlargement: false })
    .modulate({ saturation })
    .png({ palette: true, colors, dither: opts.dither != null ? opts.dither : 0 })
    .toFile(outPath);
  return outPath;
}

if (require.main === module) {
  const [, , inP, outP, w, c] = process.argv;
  if (!inP || !outP) {
    console.error('usage: node tools/art/pixelate.js <in> <out.png> [width=176] [colors=32]');
    process.exit(2);
  }
  pixelate(inP, outP, { width: w ? +w : undefined, colors: c ? +c : undefined })
    .then(p => console.log('pixelated →', p))
    .catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { pixelate };
