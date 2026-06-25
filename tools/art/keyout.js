#!/usr/bin/env node
'use strict';
/**
 * keyout.js — 背景が白でない生成画像（青空＋スタンド＋芝など）から主役を切り抜く。
 *   rmbg.js（白フラッドフィル）が効かないケース用。
 *   方式: エッジ起点の「領域成長」フラッドフィル。背景色（青/緑/白/灰）judisBg か、
 *   近傍と色が連続(<=tol)していれば背景として伸ばす（広告ボード/入口の暗部/グラデも追従）。
 *   ただし主役の強い前景色(黄シャツ/肌)は越えない＝ハードな色境界で停止。
 *   仕上げに「最大連結成分のみ残す」でスタンドの黒スリット等の取り残しを除去 → bbox トリミング保存。
 *   内部の白(バッジ)・黒(笛/時計/リストバンド)は輪郭に囲まれ外周非到達のため保持。
 *
 * 使い方: node tools/art/keyout.js <in> <out.png> [scaleDownToHeight] [tol=40]
 *   例: node tools/art/keyout.js /tmp/foul_ref_src.png img/cutscenes/foul_ref_t_01.png 380
 */
const sharp = require('sharp');

// 黒以外のあからさまな背景色（パスA）。青空/緑芝/白手すり/灰コンクリ/濃紺観客。
function isBg(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (b > 42 && b >= r + 12 && b >= g - 16) return true;  // 青〜濃紺〜暗ネイビー（空・観客・ボード暗部）。肌/髪は r>=b で除外
  if (g > r + 6 && g > b + 10 && r < 175) return true;   // 緑（芝・明暗問わず）。r<175 で黄シャツ(r≈g・r>190)を除外
  if (mn >= 190 && d <= 34) return true;                 // 白（雲・手すり・白観客）
  if (mx > 78 && mx < 232 && d <= 28) return true;       // 灰コンクリ/無彩色中間（暗い髪 mx<=78・暖色 d>28 は除外）
  if (b >= g && g >= r && b <= 64 && (b - r) >= 6) return true; // 寒色の暗部（暗い観客の影）。主審の黒=中立(b≈r)・髪=暖色 は除外
  return false;
}
// ほぼ無彩色の黒（スタンドの黒帯／主役の笛・時計・リストバンド）。髪(暖色 d=12)は除外。
function isBlack(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx <= 80 && (mx - mn) <= 8; }

async function main() {
  const inPath = process.argv[2], outPath = process.argv[3];
  const scaleH = process.argv[4] ? parseInt(process.argv[4], 10) : 0;
  const tol = process.argv[5] ? parseInt(process.argv[5], 10) : 40;
  if (!inPath || !outPath) { console.error('usage: keyout.js <in> <out.png> [scaleH] [tol]'); process.exit(1); }
  const { data, info } = await sharp(inPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels, N = W * H;
  const alpha = new Uint8Array(N); alpha.fill(255);
  // 主役の強い前景色（明るい黄シャツ・暖色の肌）。これに隣接する黒は主役の一部(襟/笛/時計/リストバンド)として保護。
  const isStrongFg = (r, g, b) => (r > 180 && g > 168 && b < 150 && r > b + 55) || (r > 170 && r >= g && (r - b) > 45 && g > b);
  const sf = new Uint8Array(N), blk = new Uint8Array(N);
  for (let p = 0; p < N; p++) { const i = p * C, r = data[i], g = data[i + 1], b = data[i + 2]; if (isStrongFg(r, g, b)) sf[p] = 1; if (isBlack(r, g, b)) blk[p] = 1; }
  // 黒を連結成分(8近傍)でラベリングし、成分のどこかが前景(黄/肌)に接していれば成分丸ごと保護。
  //   → 主役の襟/笛/時計/リストバンドは塊で残る。スタンド/観客の黒は前景非接触なので除去対象。
  const bcomp = new Int32Array(N).fill(-1); const bq = new Int32Array(N); const bprot = new Uint8Array(N); // bprot[root]=保護
  for (let s = 0; s < N; s++) {
    if (!blk[s] || bcomp[s] !== -1) continue;
    let head = 0, tail = 0; bq[tail++] = s; bcomp[s] = s; let touch = 0;
    while (head < tail) {
      const p = bq[head++], x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const np = ny * W + nx; if (sf[np]) touch = 1; if (blk[np] && bcomp[np] === -1) { bcomp[np] = s; bq[tail++] = np; }
      }
    }
    if (touch) bprot[s] = 1;
  }
  // 除去可能: 背景色 or（黒だが前景に接していない成分＝スタンド/観客の黒）。前景接触の黒(主役)は残す。
  const removable = (p) => { const i = p * C, r = data[i], g = data[i + 1], b = data[i + 2]; return isBg(r, g, b) || (blk[p] && !bprot[bcomp[p]]); };
  // エッジ起点 8近傍フラッドフィルで removable を透過化（黒を前景隣接で守るので、観客の塊も“黒の壁”が溶けて到達できる）
  { const seen = new Uint8Array(N), st = [];
    const seed = (x, y) => { const p = y * W + x; if (seen[p]) return; seen[p] = 1; if (removable(p)) { st.push(p); alpha[p] = 0; } };
    for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
    for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }
    while (st.length) {
      const p = st.pop(), x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const np = ny * W + nx; if (seen[np]) continue; seen[np] = 1; if (alpha[np] === 0) continue;
        if (removable(np)) { alpha[np] = 0; st.push(np); }
      }
    }
  }
  // 仕上げ: サイズ T 以上の連結成分を全て残す（最大=胴体, 次=ポインティングの手 等。観客の塊はフラッドで除去済み）。
  //   微小ノイズ(<T)を捨てる。手は手首の僅かな隙間で別成分になり得るが、サイズ閾で救済される。
  const T = parseInt(process.env.KEYOUT_T || '3000', 10);
  const comp = new Int32Array(N).fill(-1); const q = new Int32Array(N); const keepRoot = {};
  let nKept = 0, total = 0;
  for (let s = 0; s < N; s++) {
    if (alpha[s] === 0 || comp[s] !== -1) continue;
    let head = 0, tail = 0; q[tail++] = s; comp[s] = s; let size = 0;
    while (head < tail) {
      const p = q[head++]; size++; const x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const np = ny * W + nx; if (alpha[np] !== 0 && comp[np] === -1) { comp[np] = s; q[tail++] = np; }
      }
    }
    if (size >= T) { keepRoot[s] = 1; nKept++; total += size; }
  }
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let p = 0; p < N; p++) {
    const keep = alpha[p] !== 0 && keepRoot[comp[p]];
    data[p * C + 3] = keep ? 255 : 0;
    if (keep) { const x = p % W, y = (p / W) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) { console.error('nothing kept'); process.exit(1); }
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  console.log('kept', nKept, 'components', total, 'px; bbox', cw + 'x' + ch, 'at', minX + ',' + minY);
  let img = sharp(Buffer.from(data), { raw: { width: W, height: H, channels: C } }).extract({ left: minX, top: minY, width: cw, height: ch });
  if (scaleH && ch > scaleH) img = img.resize({ height: scaleH, kernel: 'nearest' });
  await img.png().toFile(outPath);
  console.log('wrote', outPath);
}
main();
