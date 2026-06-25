'use strict';
/**
 * keybg.js — 白(near-white)背景を端からのフラッドフィルで透過化し、トリム＋（任意）リサイズ。
 *   端に繋がった白だけを抜くので、目・ハイライト等「図形内部の白」は保持される。
 *   usage: node tools/art/keybg.js <in.png> <out.png> [maxHeight=380]
 *   sharp は tools/art/node_modules にあるため、このスクリプトを tools/art 起点で require 解決させる。
 */
const path = require('path');
const sharp = require('sharp');

async function main() {
  const [, , inp, outp, maxHArg, holeArg, whiteArg] = process.argv;
  if (!inp || !outp) { console.error('usage: node keybg.js <in> <out> [maxH] [holeMin] [whiteMin]'); process.exit(1); }
  const maxH = parseInt(maxHArg || '380', 10);
  const whiteMin = parseInt(whiteArg || '235', 10);   // 近白とみなす最小チャンネル値。下げるほど縁のハロー(白ドット)を多く除去

  const { data, info } = await sharp(inp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const isBg = (idx) => data[idx] > whiteMin && data[idx + 1] > whiteMin && data[idx + 2] > whiteMin && data[idx + 3] > 20;

  const visited = new Uint8Array(W * H);
  const stack = [];
  function seed(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = y * W + x; if (visited[p]) return;
    if (isBg(p * 4)) { visited[p] = 1; stack.push(p); }
  }
  for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
  for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }
  while (stack.length) {
    const p = stack.pop(); const x = p % W, y = (p / W) | 0;
    data[p * 4 + 3] = 0;                       // 透過
    seed(x + 1, y); seed(x - 1, y); seed(x, y + 1); seed(x, y - 1);
  }

  // 2nd pass: 端に繋がらない「閉じた near-white ポケット」(頭の間・脚の間など)を除去。
  //   目・歯・ハイライト等の小領域は閾値未満なので保持される。連結成分のサイズで判定。
  const holeMin = parseInt(holeArg || '600', 10);
  const seen = new Uint8Array(W * H);
  const isWhite = (i) => data[i] > whiteMin && data[i + 1] > whiteMin && data[i + 2] > whiteMin && data[i + 3] > 20;
  let holesRemoved = 0, holePx = 0;
  const compSizes = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (seen[p0]) continue;
    seen[p0] = 1;
    if (!isWhite(p0 * 4)) continue;
    const st = [p0]; let qi = 0;
    while (qi < st.length) {
      const p = st[qi++]; const x = p % W, y = (p / W) | 0;
      if (x + 1 < W && !seen[p + 1]) { seen[p + 1] = 1; if (isWhite((p + 1) * 4)) st.push(p + 1); }
      if (x - 1 >= 0 && !seen[p - 1]) { seen[p - 1] = 1; if (isWhite((p - 1) * 4)) st.push(p - 1); }
      if (y + 1 < H && !seen[p + W]) { seen[p + W] = 1; if (isWhite((p + W) * 4)) st.push(p + W); }
      if (y - 1 >= 0 && !seen[p - W]) { seen[p - W] = 1; if (isWhite((p - W) * 4)) st.push(p - W); }
    }
    compSizes.push(st.length);
    if (st.length >= holeMin) { for (let k = 0; k < st.length; k++) data[st[k] * 4 + 3] = 0; holesRemoved++; holePx += st.length; }
  }
  compSizes.sort((a, b) => b - a);
  console.log('  enclosed white comps top sizes:', compSizes.slice(0, 10).join(',') || '(none)', '| removed', holesRemoved, 'pockets', holePx, 'px | threshold', holeMin);

  // 残った不透明部分の bbox でトリム
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const cw = x1 - x0 + 1, chh = y1 - y0 + 1;

  let img = sharp(Buffer.from(data), { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: y0, width: cw, height: chh });
  if (chh > maxH) img = img.resize({ height: maxH, kernel: 'nearest' });
  await img.png().toFile(outp);

  const removed = (visited.reduce((a, v) => a + v, 0) / (W * H) * 100).toFixed(1);
  console.log(`wrote ${path.basename(outp)}  src ${W}x${H}  trim ${cw}x${chh}  outH ${Math.min(chh, maxH)}  bg-removed ${removed}%`);
}
main().catch((e) => { console.error(e); process.exit(1); });
