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
 *   環境変数: KEYOUT_ERASE="x0,y0,x1,y1[;...]"=元画像座標の手動消去矩形 / KEYOUT_DEBUG=1=黒成分の近接率ダンプ
 *   ★ foul_ref_t_01.png の正規再現手順（胴右の観客席付着の消去矩形込み・2026-07-16確定）:
 *     1) KEYOUT_ERASE="1005,692,1020,710" node tools/art/keyout.js tools/art/cutscenes/foul_ref_src.png img/cutscenes/foul_ref_t_01.png 460
 *     2) 同コマンドで縮小なしフル版も出し、自動回帰ゲートを通す（FAILなら受入検査に出さない）:
 *        python3 tools/art/keyout_check.py <full.png> tools/art/cutscenes/foul_ref_src.png <bbox_x> <bbox_y> [基準版full.png bx by]
 *        (bbox_x/y はツールが出力する "bbox WxH at X,Y" の X,Y)
 *     3) asset-qa エージェントで受入検査（等倍目視・PASS必須）
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
  let kept = new Uint8Array(N);
  for (let p = 0; p < N; p++) kept[p] = (alpha[p] !== 0 && keepRoot[comp[p]]) ? 1 : 0;
  // 復元パス: 誤って除去された「主役の黒」(輪郭線/リストバンド/時計等)を、黒の連結成分単位で丸ごと戻す。
  //   画素単位(近い縁だけ)の復元だと太い輪郭線の外側だけが欠けて破線状になる(2026-07-16の不具合)ため、必ず成分単位で扱う。
  //   判定: 除去済みの黒成分のうち「成分画素のうち NEAR_FRAC 以上が確定シルエットの近く(NEAR_R px以内)にある」ものを復元。
  //   - 主役の輪郭線はシルエットに全長で寄り添う。ただし線が太い(5〜8px)ため外側は近接圏外 → 実測の近接率は0.18〜0.36
  //   - スタンドの柵/観客の黒は主役から離れて伸びる → 実測0.00〜0.05。閾値はこの分離帯の中間に置く(KEYOUT_DEBUG=1で実測可)
  const NEAR_R = 3, NEAR_FRAC = parseFloat(process.env.KEYOUT_NEAR_FRAC || '0.12');
  {
    // kept を NEAR_R 回 1px 膨張させた near マスクを作る
    let near = Uint8Array.from(kept), tmp = new Uint8Array(N);
    for (let it = 0; it < NEAR_R; it++) {
      tmp.set(near);
      for (let p = 0; p < N; p++) {
        if (tmp[p]) continue; const x = p % W, y = (p / W) | 0;
        if ((x > 0 && tmp[p - 1]) || (x < W - 1 && tmp[p + 1]) || (y > 0 && tmp[p - W]) || (y < H - 1 && tmp[p + W])) near[p] = 1;
      }
    }
    // 除去済み黒成分ごとに近接率を集計(成分ラベルは bcomp を再利用)
    const csize = {}, cnear = {};
    for (let p = 0; p < N; p++) {
      if (!blk[p] || kept[p]) continue; const r = bcomp[p];
      csize[r] = (csize[r] || 0) + 1; if (near[p]) cnear[r] = (cnear[r] || 0) + 1;
    }
    if (process.env.KEYOUT_DEBUG) {
      const tops = Object.keys(csize).sort((a, b) => csize[b] - csize[a]).slice(0, 12);
      for (const r of tops) {
        const rr = +r, x = rr % W, y = (rr / W) | 0;
        console.log('  removed-black comp @' + x + ',' + y, 'size=' + csize[r], 'nearFrac=' + ((cnear[r] || 0) / csize[r]).toFixed(2));
      }
    }
    const restoreRoot = {};
    // 近接率クリア or「小さくてシルエットに接する黒」(指先/襟/袖の輪郭ダブ・トリム破線。太い破線は近接率が
    //   低く出るので接触1pxで拾う。柵/観客の大きな黒は size>1500 で弾き、輪郭に融合した席は KEYOUT_ERASE で対処)
    for (const r in csize) if ((cnear[r] || 0) / csize[r] >= NEAR_FRAC || (csize[r] <= 1500 && (cnear[r] || 0) >= 1)) restoreRoot[r] = 1;
    let nRes = 0;
    for (let p = 0; p < N; p++) if (blk[p] && !kept[p] && restoreRoot[bcomp[p]]) { kept[p] = 1; nRes++; }
    console.log('restored', Object.keys(restoreRoot).length, 'black components,', nRes, 'px');
  }
  // AA縁復元パス: シルエット輪郭のアンチエイリアス画素を3周ぶん戻し、輪郭の痩せ/破線を解消。
  //   対象は2種: ①暗部/暗い暖色(黒輪郭・髪・肌の縁) ②暖色ブライト(襟/袖口のクリーム・肌ハイライト。
  //   フラッドの白/灰ルールが食べた生地の縁。asset-qa 2026-07-16指摘)。②は観客のタン色を拾わないよう
  //   kept隣接2辺以上(=輪郭の凹部/線上)に限定。明るい背景色(空/芝/白/紺)は戻さない。
  {
    let nAA = 0;
    for (let it = 0; it < 3; it++) {
      const add = [];
      for (let p = 0; p < N; p++) {
        if (kept[p]) continue;
        const i = p * C, r = data[i], g = data[i + 1], b = data[i + 2], mx = Math.max(r, g, b);
        if (b > r + 10 || (g > r + 6 && g > b + 10)) continue;   // 寒色(観客席の紺)と緑(芝)は背景
        const darkish = mx <= 100 || (r >= b && mx <= 140);      // ①暗部 or 暗い暖色(髪/肌の縁)
        // ②クリーム(襟/袖口/肩章の淡生地)。観客のピーチ肌より明るく淡い帯域に限定し、平坦な縁でも成長できるよう隣接1辺でよい
        const warmBright = r >= 225 && g >= 210 && b >= 165 && (r - b) >= 18 && (r - b) <= 70;
        if (!darkish && !warmBright) continue;
        const x = p % W, y = (p / W) | 0;
        let nk = 0;
        if (x > 0 && kept[p - 1]) nk++;
        if (x < W - 1 && kept[p + 1]) nk++;
        if (y > 0 && kept[p - W]) nk++;
        if (y < H - 1 && kept[p + W]) nk++;
        if (nk >= 1) add.push(p);
      }
      for (const p of add) kept[p] = 1;
      nAA += add.length;
    }
    console.log('restored', nAA, 'AA edge px (dark+cream)');
  }
  // 黒成分救済・2周目: AA/クリーム復元で輪郭が伸びた後に再評価する。
  //   襟/肩のトリム破線は「食われたクリーム帯」の向こう側に孤立しており、1周目の近接判定(3px)に届かない。
  //   クリーム復元で橋が架かった後なら近接圏に入る(asset-qa 2026-07-16 襟トリム全滅指摘の恒久対策)。
  {
    let near2 = Uint8Array.from(kept), tmp2 = new Uint8Array(N);
    for (let it = 0; it < NEAR_R; it++) {
      tmp2.set(near2);
      for (let p = 0; p < N; p++) {
        if (tmp2[p]) continue; const x = p % W, y = (p / W) | 0;
        if ((x > 0 && tmp2[p - 1]) || (x < W - 1 && tmp2[p + 1]) || (y > 0 && tmp2[p - W]) || (y < H - 1 && tmp2[p + W])) near2[p] = 1;
      }
    }
    const cs2 = {}, cn2 = {};
    for (let p = 0; p < N; p++) {
      if (!blk[p] || kept[p]) continue; const r = bcomp[p];
      cs2[r] = (cs2[r] || 0) + 1; if (near2[p]) cn2[r] = (cn2[r] || 0) + 1;
    }
    const rr2 = {};
    for (const r in cs2) if (cs2[r] <= 1500 && (cn2[r] || 0) >= 1) rr2[r] = 1;
    let n2 = 0;
    for (let p = 0; p < N; p++) if (blk[p] && !kept[p] && rr2[bcomp[p]]) { kept[p] = 1; n2++; }
    if (n2) console.log('second-pass rescued', n2, 'black px');
  }
  // クラック充填: 上下または左右を主役画素に挟まれた幅1〜2pxの透過裂け目を埋める(トリム破線とクリーム帯の間の
  //   食い残し・救済破線の下の遷移行スリット等)。挟まれ条件なので面には成長しない。
  //   幅2の裂け目も「反対側2px以内にkept」で埋まる(asset-qa 2026-07-16 肩トリム浮き指摘対応)。
  //   背景色(空/芝/観客紺/無彩色の白=手すり・白観客)の裂け目は正当な隙間の細部なので埋めない。
  {
    let nCr = 0;
    for (let it = 0; it < 3; it++) {
      const add = [];
      for (let p = 0; p < N; p++) {
        if (kept[p]) continue;
        const x = p % W, y = (p / W) | 0;
        const i = p * C, r = data[i], g = data[i + 1], b = data[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if ((b > 60 && b >= r + 12) || (g > r + 6 && g > b + 10 && r < 175)) continue;   // 空/芝は残す
        if (b > r + 10) continue;                                                        // 観客紺は残す
        if (mn >= 190 && (mx - mn) <= 15) continue;                                      // 無彩色の白(手すり/白観客)は残す
        const up = (y > 0 && kept[p - W]) || (y > 1 && kept[p - 2 * W]);
        const dn = (y < H - 1 && kept[p + W]) || (y < H - 2 && kept[p + 2 * W]);
        const lf = (x > 0 && kept[p - 1]) || (x > 1 && kept[p - 2]);
        const rt = (x < W - 1 && kept[p + 1]) || (x < W - 2 && kept[p + 2]);
        if ((up && dn) || (lf && rt)) add.push(p);
      }
      for (const p of add) kept[p] = 1;
      nCr += add.length;
    }
    if (nCr) console.log('filled', nCr, 'crack px');
  }
  // 穴埋めパス: シルエット内部に閉じ込められた透過穴を埋める。黒の中のグレーハイライト(時計の文字盤等)が
  //   背景色ルール(灰)に誤爆して穴になるため。ただし「指の間や腋下から空/観客が見える正当な窓」は残す:
  //   大きい穴(>150px)と、中身が明らかに背景(青空/緑芝/白)優勢の穴は埋めない。
  {
    const tcomp = new Int32Array(N).fill(-1); const tq = new Int32Array(N);
    let nHole = 0, nHolePx = 0;
    for (let s = 0; s < N; s++) {
      if (kept[s] || tcomp[s] !== -1) continue;
      let head = 0, tail = 0; tq[tail++] = s; tcomp[s] = s; let border = false, bgish = 0;
      while (head < tail) {
        const p = tq[head++], x = p % W, y = (p / W) | 0;
        const i = p * C, r = data[i], g = data[i + 1], b = data[i + 2];
        if (b > 42 && b >= r + 12 && b >= g - 16) bgish++; else if (g > r + 6 && g > b + 10 && r < 175) bgish++;   // 白は数えない: 襟/袖口のクリームと区別不能。本物の窓(腋下等)は空/観客の青が必ず混ざる
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
        if (x > 0 && !kept[p - 1] && tcomp[p - 1] === -1) { tcomp[p - 1] = s; tq[tail++] = p - 1; }
        if (x < W - 1 && !kept[p + 1] && tcomp[p + 1] === -1) { tcomp[p + 1] = s; tq[tail++] = p + 1; }
        if (y > 0 && !kept[p - W] && tcomp[p - W] === -1) { tcomp[p - W] = s; tq[tail++] = p - W; }
        if (y < H - 1 && !kept[p + W] && tcomp[p + W] === -1) { tcomp[p + W] = s; tq[tail++] = p + W; }
      }
      const size = tail;
      if (!border && size <= 400 && bgish / size < 0.5) {
        for (let k = 0; k < tail; k++) kept[tq[k]] = 1;
        nHole++; nHolePx += size;
      }
    }
    console.log('filled', nHole, 'enclosed holes,', nHolePx, 'px');
  }
  // 手動消去矩形: KEYOUT_ERASE="x0,y0,x1,y1[;x0,y0,x1,y1...]" (元画像座標)。
  //   主役の輪郭黒と背景の黒(観客席等)が元絵で融合している箇所は、色でも成分でも幾何でも安全に分離できない
  //   (2026-07-16: 幾何の厚み制限は時計/肘の太い黒を誤爆して撤回)。最後は座標指定の職人の一手間で確実に落とす。
  if (process.env.KEYOUT_ERASE) {
    let nEr = 0;
    for (const rect of process.env.KEYOUT_ERASE.split(';')) {
      const [x0, y0, x1, y1] = rect.split(',').map(Number);
      for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++)
        for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++)
          if (kept[y * W + x]) { kept[y * W + x] = 0; nEr++; }
    }
    console.log('erased', nEr, 'px via KEYOUT_ERASE');
  }
  // 斑点掃除: 復元処理で生じた8px未満の孤立不透明成分を除去(最終アセットに浮遊ドットを残さない)
  {
    const scomp = new Int32Array(N).fill(-1); const sq = new Int32Array(N); let nSpeck = 0;
    for (let s2 = 0; s2 < N; s2++) {
      if (!kept[s2] || scomp[s2] !== -1) continue;
      let head = 0, tail = 0; sq[tail++] = s2; scomp[s2] = s2;
      while (head < tail) {
        const p = sq[head++], x = p % W, y = (p / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue; const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const np = ny * W + nx; if (kept[np] && scomp[np] === -1) { scomp[np] = s2; sq[tail++] = np; }
        }
      }
      if (tail < 8) { for (let k = 0; k < tail; k++) kept[sq[k]] = 0; nSpeck += tail; }
    }
    if (nSpeck) console.log('removed', nSpeck, 'speck px');
  }
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let p = 0; p < N; p++) {
    const keep = kept[p];
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
