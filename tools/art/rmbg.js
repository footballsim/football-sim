#!/usr/bin/env node
'use strict';
/**
 * rmbg.js — 画像の周囲から flood-fill して「背景色（既定: 近白）」を透過にする。
 *   生成AIが透過のつもりで白背景/薄いチェッカーを焼き込んでくるケースを救済する。
 *   内側の白（ソックスの白線・目・歯・スパイクのハイライト等）は輪郭に囲まれて
 *   外周から到達しないため保持される（=グローバルな白キーより安全）。
 *
 * 使い方: node tools/art/rmbg.js <in> <out.png> [thr=228] [tol=24]
 *   thr: 背景とみなす最小チャンネル値（これ以上に明るい）／ tol: max-min 許容（無彩色寄り）
 */
const sharp = require('sharp');

async function rmbg(inPath, outPath, opts = {}) {
  const thr = opts.thr != null ? opts.thr : 228;
  const tol = opts.tol != null ? opts.tol : 24;
  const { data, info } = await sharp(inPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels; // C=4
  const isBg = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mn >= thr && (mx - mn) <= tol;           // 明るく・ほぼ無彩色 = 背景
  };
  const seen = new Uint8Array(W * H);
  const stack = [];
  const pushIf = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = y * W + x;
    if (seen[p] || !isBg(p * C)) return;
    seen[p] = 1; stack.push(p);
  };
  for (let x = 0; x < W; x++) { pushIf(x, 0); pushIf(x, H - 1); }
  for (let y = 0; y < H; y++) { pushIf(0, y); pushIf(W - 1, y); }
  while (stack.length) {
    const p = stack.pop(), x = p % W, y = (p / W) | 0;
    pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
  }
  for (let p = 0; p < W * H; p++) if (seen[p]) data[p * C + 3] = 0;  // 背景を透過に
  await sharp(data, { raw: { width: W, height: H, channels: C } }).png().toFile(outPath);
  return outPath;
}

if (require.main === module) {
  const a = process.argv;
  if (!a[2] || !a[3]) { console.error('usage: node tools/art/rmbg.js <in> <out.png> [thr=228] [tol=24]'); process.exit(2); }
  rmbg(a[2], a[3], { thr: a[4] ? +a[4] : undefined, tol: a[5] ? +a[5] : undefined })
    .then(p => console.log('rmbg →', p)).catch(e => { console.error(e.message); process.exit(1); });
}
module.exports = { rmbg };
