/* ============================================================================
 * WIDE-01 : 層S「引き画」試作（ラボ限定・2026-07-29）
 *
 * 目的 ── デイヴ・ザ・ダイバーの海中引き画に相当する層を football-sim に作る。
 *   現行のカットシーンは全20+シーンが 480×216 のカンバスに選手を高さ130〜205px
 *   （画面高の60〜95%）で描いており、縮尺の軸が CS_FIGURE_SCALE の1本しか無い。
 *   ＝「引き」が存在しない。ここは意図的にその反対側の端を作る。
 *
 * 設計の芯 ──「1ショット1主語」。このショットの主語は【チームと戦況】であって
 *   個々の選手ではない。だから:
 *     ・選手は 7〜15px のシルエット。顔なし・キット4色のみ・走り2コマ。素材生成ゼロ。
 *     ・情報量は全部【環境】に置く（夜空/照明塔/光の傘/屋根/上段/下段/旗/LED看板/
 *       芝の刈り目/ゴールネット/手前の看板シルエット）＝奥行き10層。
 *
 * 投影 ── ピンホール。カメラは手前タッチラインの CAM_D[m] 後方・高さ CAM_H[m]。
 *     sx = W/2 + FOCAL*(X - camX)/(Z + CAM_D)
 *     sy = HORIZON + FOCAL*(CAM_H - h)/(Z + CAM_D)
 *   ★ sy が X に依存しない＝奥行き Z と高さ h が同じものは必ず「水平な帯」になる。
 *     観客席・タッチライン・トラックを帯で描けるのはこの性質のおかげ。
 *   ★ 直線は直線に写る（射影変換）ので、ピッチラインは端点2つの投影だけで引ける。
 *     曲線（センターサークル等）だけ点をサンプルして投影する。
 *   ★ カメラの camX を振ると近い物ほど大きく動く＝視差がタダで出る。
 *
 * 描画は 480×216 の実解像度に整数座標で置き、CSS で拡大（image-rendering:pixelated）。
 *   ＝ドット絵として拡大される。7/25 確定の「レトロ・ドット絵ハイブリッド」に乗せる。
 *
 * ラボ限定。build.js には載せない（_scene_lab.html からのみ読む）。
 * ========================================================================== */
var WideShot = (function () {
  'use strict';

  // ── 投影パラメータ ────────────────────────────────────────────────
  var W = 480, H = 216;
  var PL = 105, PW = 68;              // ピッチ 105m × 68m
  var CAM_D = 60, CAM_H = 30;         // 手前タッチラインの60m後方・高さ30m
  var FOCAL = 285.7;
  var HORIZON = 53.1;                 // 無限遠の地面が写るy（＝地平線）

  // 上の値から決まる主要な水平線（設計時の確認用・コードは都度 projY で出す）
  //   手前タッチライン y=196 / 奥タッチライン y=120 / 下段 89〜114 / 上段 61〜85 / 屋根 50〜58

  function projY(Z, h) { return HORIZON + FOCAL * (CAM_H - (h || 0)) / (Z + CAM_D); }
  function projX(X, Z, camX) { return W / 2 + FOCAL * (X - (camX == null ? PL / 2 : camX)) / (Z + CAM_D); }
  function mPx(Z) { return FOCAL / (Z + CAM_D); }        // その奥行きでの「1mあたりpx」

  // ── 決定論PRNG（観客・ゆらぎ用。毎フレーム同じ配置になるように種で固定）──
  function lcg(seed) { var s = (seed | 0) || 1; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

  function shade(hex, f) {
    var h = String(hex || '#888').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    r = Math.max(0, Math.min(255, Math.round(r * f)));
    g = Math.max(0, Math.min(255, Math.round(g * f)));
    b = Math.max(0, Math.min(255, Math.round(b * f)));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // ── 背景（動かない部分）を1枚に焼く ───────────────────────────────
  //   夜空・照明塔・屋根・観客席・LED看板・トラック・芝・ライン・ゴール。
  //   毎フレーム描くと重いので、カメラのcamXごとにキャッシュせず「camX=中央」で焼き、
  //   視差はレイヤー別のオフセットで擬似的に出す…のではなく、
  //   ★ ここでは正しさを優先して camX をベイク時に固定し、カメラは動かさない構成にした。
  //     （寄り/パンを入れるなら焼き直しコストが要る＝層Sは静かな画で良いという判断）
  var _bgCache = null, _bgKey = '';

  function buildBg(o) {
    var key = [o.c1, o.c2, o.night ? 1 : 0].join('|');
    if (_bgCache && _bgKey === key) return _bgCache;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var x = cv.getContext('2d');
    var R = lcg(0x5EED);

    var yTouchNear = projY(0, 0);          // 196
    var yTouchFar = projY(PW, 0);          // 120
    var yTrackFar = projY(PW + 8, 0);      // トラック(ランオフ)の奥端
    var yLowFront = projY(76, 1), yLowBack = projY(92, 11);
    var yUpFront = projY(94, 13), yUpBack = projY(110, 25);
    var yRoofF = projY(108, 27), yRoofB = projY(118, 32);

    // ── 1. 夜空 ──────────────────────────────────────────────
    var sky = x.createLinearGradient(0, 0, 0, yRoofB + 6);
    sky.addColorStop(0, '#070b1c'); sky.addColorStop(0.55, '#0d1730'); sky.addColorStop(1, '#16203f');
    x.fillStyle = sky; x.fillRect(0, 0, W, Math.ceil(yRoofB) + 6);
    for (var i = 0; i < 90; i++) {                     // 星（ディザ粒）
      var sx = Math.round(R() * W), sy = Math.round(R() * (yRoofB - 4));
      x.fillStyle = 'rgba(200,215,255,' + (0.10 + R() * 0.28).toFixed(2) + ')';
      x.fillRect(sx, sy, 1, 1);
    }

    // ── 2. 照明塔（屋根より高く突き出す＝空に情報を置く）────────────
    var pylons = [-40, PL + 40];
    for (var p = 0; p < pylons.length; p++) {
      var pX = pylons[p], pZ = 115;
      var px = projX(pX, pZ), yBase = projY(pZ, 22), yTop = projY(pZ, 46);
      var wPx = 2;                                     // 支柱は細く（太いとテントに見える）
      x.fillStyle = '#050813';
      x.fillRect(Math.round(px - wPx / 2), Math.round(yTop), wPx, Math.round(yBase - yTop));
      // 灯体バンク
      var bw = 15, bh = 6;
      x.fillStyle = '#0a1020';
      x.fillRect(Math.round(px - bw / 2), Math.round(yTop - bh), bw, bh);
      for (var r = 0; r < 3; r++) for (var c = 0; c < 7; c++) {   // 個々のランプ
        x.fillStyle = R() > 0.15 ? 'rgba(255,246,214,0.92)' : 'rgba(255,246,214,0.45)';
        x.fillRect(Math.round(px - bw / 2) + 1 + c * 2, Math.round(yTop - bh) + 1 + r * 2, 1, 1);
      }
      // 灯体まわりの空気のにじみ（ハロー）だけ。地面へ落とす円錐は芝の段で描く。
      var halo = x.createRadialGradient(px, yTop - bh / 2, 1, px, yTop - bh / 2, 30);
      halo.addColorStop(0, 'rgba(255,248,220,0.20)'); halo.addColorStop(1, 'rgba(255,248,220,0)');
      x.fillStyle = halo; x.fillRect(px - 30, yTop - bh / 2 - 30, 60, 60);
    }

    // ── 3. 屋根（スタンドの上を切る暗い帯）──────────────────────
    x.fillStyle = '#04070f'; x.fillRect(0, Math.round(yRoofB) - 3, W, Math.ceil(yRoofF - yRoofB) + 4);
    x.fillStyle = 'rgba(150,180,240,0.16)'; x.fillRect(0, Math.round(yRoofF) - 1, W, 1);   // 屋根裏のリム光
    // 屋根の梁（縦のリズム＝ここでスタンドの「構造」を先に見せると観客ノイズが構造に見える）
    for (var rb = 0; rb < W; rb += 40) { x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(rb, Math.round(yRoofB) - 3, 3, Math.ceil(yRoofF - yRoofB) + 4); }

    // ── 4. 観客席（上段/下段の2ティア）────────────────────────
    //   ★ 情報量とコントラストは別物。ここは「密度は高く・明度差は低く」。
    //     観客をピッチと同じ強さで出すと主語が環境に移ってしまう（1ショット1主語の違反）。
    //     チームカラーは全体の 22% だけ。残りは暗い中立色に沈める。
    function tier(yA, yB, dens, dim) {
      x.fillStyle = shade('#0b1119', dim);
      x.fillRect(0, Math.round(yA), W, Math.ceil(yB - yA) + 1);
      var rows = Math.max(3, Math.round(yB - yA));
      for (var ry = 0; ry < rows; ry++) {
        var yy = Math.round(yA + ry);
        var t = ry / rows;                       // 0=奥(上) 1=手前(下)
        var sz = t > 0.62 ? 2 : 1;
        for (var xx = 0; xx < W; xx += sz) {
          if (R() > dens) continue;
          var u = R();
          // チームカラーは16%だけ。残りは暗い中立色（環境は密度で語らせ、明度では主張させない）
          var col = u < 0.08 ? o.c1 : u < 0.16 ? o.c2 : u < 0.28 ? '#8c96aa' : u < 0.48 ? '#333b47' : u < 0.70 ? '#212832' : u < 0.87 ? '#43392f' : '#171c24';
          // 画面端ほど暗く落とす＝視線が中央のピッチへ戻る
          var edge = 1 - Math.abs(xx / W - 0.5) * 0.7;
          x.fillStyle = shade(col, dim * edge * (0.36 + t * 0.30));
          x.fillRect(xx, yy, sz, 1);
        }
      }
      // 階段/通路（縦の暗い柱）＝ノイズが「群衆」でなく「スタンド」に見えるための骨
      for (var st = 20; st < W; st += 40) {
        x.fillStyle = 'rgba(2,4,9,0.62)';
        x.fillRect(st, Math.round(yA), 2, Math.ceil(yB - yA) + 1);
      }
    }
    tier(yUpBack, yUpFront, 0.34, 0.62);      // 上段（遠い＝暗い）
    tier(yLowBack, yLowFront, 0.40, 0.80);    // 下段
    // 屋根の落とす影（上段の上端を沈める）＝ティアの分離が明度で付く
    var rs = x.createLinearGradient(0, yUpBack, 0, yUpBack + 14);
    rs.addColorStop(0, 'rgba(0,0,0,0.72)'); rs.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = rs; x.fillRect(0, Math.round(yUpBack), W, 15);
    // ティアの間の通路（暗い水平帯）＝段差の説明
    x.fillStyle = '#04060c'; x.fillRect(0, Math.round(yUpFront), W, Math.max(2, Math.round(yLowBack - yUpFront)));

    // ── 5. ゴール裏の旗・横断幕（局所の彩り＝デイヴの提灯と桜にあたる）──
    //   数を絞って点在させる。ここだけが観客帯で彩度を持つ＝視線の留まり所になる。
    for (var b = 0; b < 9; b++) {
      var bx = Math.round(R() * W), bw2 = 9 + Math.round(R() * 13);
      var by = Math.round(yLowBack + R() * (yLowFront - yLowBack) * 0.7);
      var bc = R() < 0.5 ? o.c1 : o.c2;
      x.fillStyle = shade(bc, 0.58); x.fillRect(bx, by, bw2, 3);       // 細長い線でなく「布」の比率に
      x.fillStyle = 'rgba(235,242,255,0.26)'; x.fillRect(bx + 2, by + 1, Math.max(2, bw2 - 4), 1);
    }

    // ── 6. LED看板（奥タッチライン沿い）──────────────────────
    //   ★ 観客帯とのあいだに暗いギャップを入れる。ここが画面で一番明るい水平線になり、
    //     「スタンド／ピッチ」の境界を1本で説明する。
    var yAdT = projY(PW + 3, 1.6), yAdB = projY(PW + 3, 0);
    x.fillStyle = '#02040a'; x.fillRect(0, Math.round(yAdT) - 3, W, 3);
    var adH = Math.max(3, Math.round(yAdB - yAdT));
    x.fillStyle = '#0b1220'; x.fillRect(0, Math.round(yAdT), W, adH);
    for (var a = 0; a < W; a += 7) {
      var au = R();
      x.fillStyle = au < 0.30 ? shade(o.c1, 1.35) : au < 0.58 ? shade(o.c2, 1.35) : au < 0.80 ? '#f4dc95' : '#8fb6f0';
      x.fillRect(a, Math.round(yAdT) + 1, 6, Math.max(2, adH - 1));
    }
    x.fillStyle = 'rgba(255,255,255,0.34)'; x.fillRect(0, Math.round(yAdT), W, 1);
    // 看板の光が芝へ落ちる（境界を柔らかく繋ぐ）
    var spill = x.createLinearGradient(0, yAdB, 0, yAdB + 10);
    spill.addColorStop(0, 'rgba(200,220,255,0.14)'); spill.addColorStop(1, 'rgba(200,220,255,0)');
    x.fillStyle = spill; x.fillRect(0, Math.round(yAdB), W, 10);

    // ── 7. トラック / ランオフ ─────────────────────────────
    x.fillStyle = '#16222e'; x.fillRect(0, Math.round(yTrackFar), W, Math.ceil(yAdB - yTrackFar) + 1);

    // ── 8. 芝 ────────────────────────────────────────────
    //   刈り目＝X一定の帯なので、投影すると消失点へ収束する台形になる（＝奥行きの主役）。
    var grassA = '#2f7a34', grassB = '#286b2d';
    x.fillStyle = grassB;
    x.beginPath();
    x.moveTo(projX(-14, PW), yTouchFar); x.lineTo(projX(PL + 14, PW), yTouchFar);
    x.lineTo(projX(PL + 14, 0), yTouchNear); x.lineTo(projX(-14, 0), yTouchNear);
    x.closePath(); x.fill();
    // 刈り目（12本）
    for (var s = -1; s < 13; s++) {
      if (s % 2) continue;
      var X0 = s * (PL / 12), X1 = X0 + (PL / 12);
      x.fillStyle = grassA;
      x.beginPath();
      x.moveTo(projX(X0, PW), yTouchFar); x.lineTo(projX(X1, PW), yTouchFar);
      x.lineTo(projX(X1, 0), yTouchNear); x.lineTo(projX(X0, 0), yTouchNear);
      x.closePath(); x.fill();
    }
    // 奥ほど暗く（大気遠近）＋手前の照り
    var gg = x.createLinearGradient(0, yTouchFar, 0, yTouchNear);
    gg.addColorStop(0, 'rgba(10,20,35,0.42)'); gg.addColorStop(0.45, 'rgba(10,20,35,0.10)');
    gg.addColorStop(1, 'rgba(210,240,255,0.06)');
    x.fillStyle = gg; x.fillRect(0, Math.round(yTouchFar), W, Math.ceil(yTouchNear - yTouchFar) + 1);
    // 照明が芝に落とす光だまり（塔の位置に対応）。空に円錐を描くとテントに見えるので、
    // 光は「地面の明るさ」としてだけ表現する＝ナイターの説明がこれ1つで済む。
    x.save();
    x.beginPath();
    x.moveTo(projX(-14, PW), yTouchFar); x.lineTo(projX(PL + 14, PW), yTouchFar);
    x.lineTo(projX(PL + 14, 0), yTouchNear); x.lineTo(projX(-14, 0), yTouchNear);
    x.closePath(); x.clip();
    [-40, PL + 40].forEach(function (lx) {
      var cxp = projX(lx, PW * 0.5), cyp = projY(PW * 0.35);
      var pool = x.createRadialGradient(cxp, cyp, 4, cxp, cyp, 190);
      pool.addColorStop(0, 'rgba(255,250,225,0.13)');
      pool.addColorStop(0.55, 'rgba(255,250,225,0.05)');
      pool.addColorStop(1, 'rgba(255,250,225,0)');
      x.fillStyle = pool; x.fillRect(cxp - 190, cyp - 190, 380, 380);
    });
    // 芝も左右端を落とす（観客席と同じ処理＝画面の明るさの山を中央に1つだけ作る）
    var ge = x.createLinearGradient(0, 0, W, 0);
    ge.addColorStop(0, 'rgba(2,8,14,0.46)'); ge.addColorStop(0.30, 'rgba(2,8,14,0)');
    ge.addColorStop(0.70, 'rgba(2,8,14,0)'); ge.addColorStop(1, 'rgba(2,8,14,0.46)');
    x.fillStyle = ge; x.fillRect(0, Math.round(yTouchFar) - 2, W, Math.ceil(yTouchNear - yTouchFar) + 4);
    x.restore();

    // ── 9. ピッチライン ────────────────────────────────────
    x.strokeStyle = 'rgba(232,244,255,0.62)'; x.lineWidth = 1;
    function line(X0, Z0, X1, Z1) {
      x.beginPath();
      x.moveTo(projX(X0, Z0) + 0.5, projY(Z0) + 0.5);
      x.lineTo(projX(X1, Z1) + 0.5, projY(Z1) + 0.5);
      x.stroke();
    }
    line(0, 0, PL, 0); line(0, PW, PL, PW);                 // タッチライン
    line(0, 0, 0, PW); line(PL, 0, PL, PW);                 // ゴールライン
    line(PL / 2, 0, PL / 2, PW);                            // ハーフウェイ
    // ペナルティエリア（16.5m × 40.32m）とゴールエリア（5.5m × 18.32m）
    [[0, 1], [PL, -1]].forEach(function (g) {
      var gx = g[0], d = g[1];
      var zA = PW / 2 - 20.16, zB = PW / 2 + 20.16;
      line(gx, zA, gx + d * 16.5, zA); line(gx, zB, gx + d * 16.5, zB); line(gx + d * 16.5, zA, gx + d * 16.5, zB);
      var zC = PW / 2 - 9.16, zD = PW / 2 + 9.16;
      line(gx, zC, gx + d * 5.5, zC); line(gx, zD, gx + d * 5.5, zD); line(gx + d * 5.5, zC, gx + d * 5.5, zD);
      // PKスポット
      x.fillStyle = 'rgba(232,244,255,0.7)';
      x.fillRect(Math.round(projX(gx + d * 11, PW / 2)), Math.round(projY(PW / 2)), 1, 1);
    });
    // センターサークル（曲線＝サンプルして投影）
    x.beginPath();
    for (var k = 0; k <= 48; k++) {
      var an = k / 48 * Math.PI * 2;
      var cX = PL / 2 + Math.cos(an) * 9.15, cZ = PW / 2 + Math.sin(an) * 9.15;
      var pxk = projX(cX, cZ) + 0.5, pyk = projY(cZ) + 0.5;
      k ? x.lineTo(pxk, pyk) : x.moveTo(pxk, pyk);
    }
    x.closePath(); x.stroke();

    // ── 10. ゴール（ポスト＋ネット）─────────────────────────
    [0, PL].forEach(function (gx) {
      var zN = PW / 2 - 3.66, zF = PW / 2 + 3.66, gh = 2.44;
      var xN = projX(gx, zN), xF = projX(gx, zF);
      var yNb = projY(zN), yNt = projY(zN, gh), yFb = projY(zF), yFt = projY(zF, gh);
      // ネット面（薄い塗り＋メッシュ）
      x.fillStyle = 'rgba(226,238,255,0.13)';
      x.beginPath(); x.moveTo(xN, yNt); x.lineTo(xF, yFt); x.lineTo(xF, yFb); x.lineTo(xN, yNb); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(226,238,255,0.30)'; x.lineWidth = 1;
      for (var n = 1; n < 6; n++) {
        var tt = n / 6;
        var mx = xN + (xF - xN) * tt, myT = yNt + (yFt - yNt) * tt, myB = yNb + (yFb - yNb) * tt;
        x.beginPath(); x.moveTo(mx + 0.5, myT); x.lineTo(mx + 0.5, myB); x.stroke();
      }
      // ポスト＋クロスバー
      x.strokeStyle = '#f2f7ff'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(xN + 0.5, yNb); x.lineTo(xN + 0.5, yNt); x.stroke();
      x.beginPath(); x.moveTo(xF + 0.5, yFb); x.lineTo(xF + 0.5, yFt); x.stroke();
      x.beginPath(); x.moveTo(xN + 0.5, yNt + 0.5); x.lineTo(xF + 0.5, yFt + 0.5); x.stroke();
    });

    // ── 11. 手前レイヤー（カメラ至近の看板＝デイヴの手前カウンターにあたる）──
    //   ここだけスクリーン空間（カメラの60m後方に物理的な物は置けないため）。
    var fgTop = H - 17;
    x.fillStyle = '#04060d'; x.fillRect(0, fgTop, W, H - fgTop);
    x.fillStyle = '#0a1120'; x.fillRect(0, fgTop, W, 2);
    for (var f = 0; f < W; f += 34) {                 // 至近のLED（大きくボケた発光）
      x.fillStyle = (f / 34) % 2 ? 'rgba(120,160,235,0.13)' : 'rgba(240,215,140,0.13)';
      x.fillRect(f + 2, fgTop + 4, 30, 9);
    }
    // カメラマン/控えの頭と肩のシルエット（手前の遮蔽＝奥行きの決定打）
    //   ★ 矩形で下端まで伸ばすと「柱」に見える。頭＋なで肩の形にして数を絞る。
    [[62, 1.0], [246, 0.85], [404, 1.15]].forEach(function (g) {
      var hx = g[0], k = g[1];
      var hr = 7 * k, sw = 26 * k, top = fgTop - 9 * k;
      x.fillStyle = '#02040a';
      x.beginPath();                                   // 肩（左右へ落ちる曲線）
      x.moveTo(hx - sw, H);
      x.quadraticCurveTo(hx - sw * 0.55, top + hr * 1.5, hx - hr * 0.9, top + hr * 1.1);
      x.lineTo(hx + hr * 0.9, top + hr * 1.1);
      x.quadraticCurveTo(hx + sw * 0.55, top + hr * 1.5, hx + sw, H);
      x.closePath(); x.fill();
      x.beginPath(); x.ellipse(hx, top + hr * 0.5, hr, hr * 1.05, 0, 0, Math.PI * 2); x.fill();
    });

    _bgCache = cv; _bgKey = key;
    return cv;
  }

  // ── 選手（7〜15px のシルエット・顔なし・走り2コマ）───────────────
  //   ★ 素材ファイルを持たない。この縮尺では線1本が体の1パーツになるので、
  //     ドット絵として手続き的に描くのが一番正確で一番安い。
  //   ★ 輪郭はバウンディングボックスで囲ってはいけない（ドミノに見える）。
  //     パーツ集合を1px オフセットで4方向に暗色描き→本色で上書き＝形に沿ったリムになる。
  function drawPlayer(x, sx, sy, h, cols, legPhase, dir) {
    var bw = Math.max(3, Math.round(h * 0.36));      // 肩幅（人は思うより細い）
    var hx = Math.round(sx), fy = Math.round(sy);    // 足元
    var headR = Math.max(1, Math.round(h * 0.15));
    var torsoH = Math.max(2, Math.round(h * 0.32));
    var shortH = Math.max(1, Math.round(h * 0.13));
    var legH = Math.max(2, h - headR * 2 - torsoH - shortH);
    var legW = Math.max(1, Math.round(bw * 0.30));
    var spread = Math.round(Math.sin(legPhase) * Math.max(1, bw * 0.40));
    var yShort = fy - legH - shortH;
    var yTorso = yShort - torsoH;
    var yHead = yTorso - headR * 2;

    // 接地影（これが無いと選手が芝から浮く）
    x.fillStyle = 'rgba(4,12,8,0.34)';
    x.beginPath(); x.ellipse(hx, fy, Math.max(2, bw * 0.58), Math.max(1, h * 0.08), 0, 0, Math.PI * 2); x.fill();

    // パーツ集合を1関数に（リムと本描画で2回呼ぶ）
    function parts(ox, oy, mono) {
      var X = hx + ox, Y = oy;
      x.fillStyle = mono || cols.socks;
      x.fillRect(X - legW - spread, yShort + Y + shortH, legW, legH);
      x.fillRect(X + spread, yShort + Y + shortH, legW, legH);
      x.fillStyle = mono || cols.shorts;
      x.fillRect(X - Math.floor(bw / 2), yShort + Y, bw, shortH);
      x.fillStyle = mono || cols.shirt;
      x.fillRect(X - Math.floor(bw / 2), yTorso + Y, bw, torsoH);
      x.fillStyle = mono || cols.skin;
      x.fillRect(X - headR, yHead + Y, headR * 2, headR * 2);
    }
    // 形に沿ったリム（4方向）＝芝からも他選手からも分離する
    parts(-1, 0, 'rgba(5,12,9,0.9)'); parts(1, 0, 'rgba(5,12,9,0.9)');
    parts(0, -1, 'rgba(5,12,9,0.9)'); parts(0, 1, 'rgba(5,12,9,0.9)');
    parts(0, 0, null);
    // 髪（頭の上半分だけ暗く）
    x.fillStyle = 'rgba(22,16,12,0.78)';
    x.fillRect(hx - headR, yHead, headR * 2, Math.max(1, Math.round(headR * 0.9)));
    if (h >= 12) {   // 進行方向側のリム光（向きの唯一の手がかり・大きい個体だけ）
      x.fillStyle = 'rgba(255,255,255,0.32)';
      x.fillRect(hx + dir * Math.floor(bw / 2), yTorso, 1, Math.max(1, torsoH - 1));
    }
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // チーム全体をボール方向へ平行移動する量（形は保つ）
  function blockShift(pos, ball, k) {
    var cX = 0, cZ = 0;
    for (var i = 1; i < pos.length; i++) { cX += pos[i].X; cZ += pos[i].Z; }   // GKは重心から除く
    cX /= (pos.length - 1); cZ /= (pos.length - 1);
    return { dX: (ball.X - cX) * k, dZ: (ball.Z - cZ) * k };
  }

  // ── 布陣 → ピッチ座標 ────────────────────────────────────────
  //   system_data の x[](0..100=幅) y[](91=自ゴール, 16=敵陣) を m に写す。
  //   team1 は左→右に攻める。team2 は反転（Zも反転＝盤面を180°回す）。
  function layout(team, home) {
    var sys = (typeof system_data !== 'undefined') && system_data[team.system];
    if (!sys) sys = { x: [50, 87, 62, 37, 12, 50, 87, 12, 50, 70, 30], y: [91, 68, 68, 68, 68, 55, 42, 42, 32, 16, 16] };
    var out = [];
    for (var i = 0; i < 11; i++) {
      var nx = sys.x[i], ny = sys.y[i];
      out.push(home
        ? { X: (100 - ny) / 100 * PL, Z: nx / 100 * PW }
        : { X: ny / 100 * PL, Z: (100 - nx) / 100 * PW });
    }
    return out;
  }

  // ── 本体 ────────────────────────────────────────────────────
  //   opts: { team1, team2, ball:{X,Z}, fig:倍率, area:強調ON, dur:ms }
  function render(opts) {
    opts = opts || {};
    var t1 = opts.team1, t2 = opts.team2;
    var c1 = (t1 && t1.team_color) || '#1b5fd0';
    var c2 = (t2 && t2.team_color) || '#c8102e';
    // ★ 1.0＝物理的な実寸（4〜9px）。試作時に1.6倍まで誇張したが、実寸の方が明確に良い:
    //   小さいほど主語が「スタジアム」に移り、重なりが減って布陣も読める。誇張は不要だった。
    var figExag = opts.fig == null ? 1.0 : opts.fig;

    var bg = buildBg({ c1: c1, c2: c2 });

    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
    cv.dataset.wideshot = '1';        // 検証用の目印（マンガのカットシーンも480×216で見分けが付かないため）
    var x = cv.getContext('2d');

    var pos1 = layout(t1 || {}, true), pos2 = layout(t2 || {}, false);
    var cols1 = { shirt: c1, shorts: shade(c1, 0.55), socks: c1, accent: '#f2f7ff', skin: '#d8a878' };
    var cols2 = { shirt: c2, shorts: shade(c2, 0.55), socks: c2, accent: '#f2f7ff', skin: '#c98f64' };

    var ball = opts.ball || { X: PL * 0.62, Z: PW * 0.42 };

    // 個体差（同じ布陣でも並びが機械的に見えないように決定論オフセット）
    var Rj = lcg(0xC0FFEE), jit = [];
    for (var j = 0; j < 22; j++) jit.push({ dx: (Rj() - 0.5) * 5.5, dz: (Rj() - 0.5) * 5.5, ph: Rj() * 6.28, sp: 0.7 + Rj() * 0.8 });

    // ビネットは静的なので1枚に焼く（毎フレーム createRadialGradient すると効く）
    var vigC = document.createElement('canvas'); vigC.width = W; vigC.height = H;
    (function () {
      var vx = vigC.getContext('2d');
      var vg = vx.createRadialGradient(W / 2, H * 0.52, H * 0.30, W / 2, H * 0.52, H * 1.05);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.46)');
      vx.fillStyle = vg; vx.fillRect(0, 0, W, H);
    })();

    var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    // ★ 停止条件は `isConnected`。旧 DOMNodeRemovedFromDocument は現行Chromeでは発火せず、
    //   シーンが変わるたびに rAF ループが積み上がって止まらない（実バグ・2026-07-29修正）。
    //   これは環境の常時アニメなので「表示されている間は回す」で正しい。
    //   ※進行を伴う演出に isConnected を使ってはいけない（→ football-sim-cutscene 側の教訓）。
    var started = false, ungrace = 0;
    function frame() {
      if (cv.isConnected) started = true;
      // 外れたら即停止。まだ一度も挿入されていない間だけ猶予（呼び出し側は render 直後に
      // 同期で appendChild するので実質1フレームで足りる。30 は余裕分）。
      else if (started || ++ungrace > 30) return;
      requestAnimationFrame(frame);
      var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      var t = (now - T0) / 1000;

      x.clearRect(0, 0, W, H);
      x.imageSmoothingEnabled = false;
      x.drawImage(bg, 0, 0);

      // 観客のさざめき（帯を薄く明滅させるだけ＝「物を足すFX」ではない）
      var shim = 0.03 + 0.025 * Math.sin(t * 0.9);
      x.fillStyle = 'rgba(255,240,200,' + shim.toFixed(3) + ')';
      x.fillRect(0, Math.round(projY(110, 25)), W, Math.round(projY(76, 1) - projY(110, 25)));

      // エリア強調（戦術図が担っていた「どこで起きているか」を引き継ぐ・控えめ）
      if (opts.area !== false) {
        var ay = projY(ball.Z), ax = projX(ball.X, ball.Z), am = mPx(ball.Z);
        var pulse = 0.26 + 0.10 * Math.sin(t * 2.4);
        x.strokeStyle = 'rgba(255,235,140,' + pulse.toFixed(3) + ')';
        x.lineWidth = 1;
        x.beginPath(); x.ellipse(ax, ay, am * 13, am * 13 * 0.34, 0, 0, Math.PI * 2); x.stroke();
        var glow = x.createRadialGradient(ax, ay, 1, ax, ay, am * 15);
        glow.addColorStop(0, 'rgba(255,238,160,0.10)'); glow.addColorStop(1, 'rgba(255,238,160,0)');
        x.fillStyle = glow; x.fillRect(ax - am * 15, ay - am * 15, am * 30, am * 30);
      }

      // 選手。
      //   ★ ボールへの引力は「個体ごと」ではなく「ブロックごと」に掛ける。
      //     個体に掛けると全員がボールへ寄って布陣の形が潰れる＝この引き画の存在理由が消える。
      //     ブロック平行移動なら形はそのまま、チームが押し上げ/押し下げられている様子だけが出る。
      var sh1 = blockShift(pos1, ball, 0.15), sh2 = blockShift(pos2, ball, 0.15);
      var all = [];
      for (var i = 0; i < 11; i++) {
        all.push({ p: pos1[i], c: cols1, j: jit[i], d: 1, sh: sh1, gk: i === 0, gx: 2.5 });
        all.push({ p: pos2[i], c: cols2, j: jit[11 + i], d: -1, sh: sh2, gk: i === 0, gx: PL - 2.5 });
      }

      for (var n = 0; n < all.length; n++) {
        var e = all[n], jj = e.j;
        if (e.gk) {   // GKはブロックに乗らない。ゴールライン上でボールのZに合わせて動くだけ。
          e._X = e.gx;
          e._Z = PW / 2 + (ball.Z - PW / 2) * 0.42 + Math.sin(t * 0.5 + jj.ph) * 0.8;
        } else {
          e._X = clamp(e.p.X + e.sh.dX + jj.dx + Math.sin(t * 0.35 * jj.sp + jj.ph) * 1.5, 1, PL - 1);
          e._Z = clamp(e.p.Z + e.sh.dZ + jj.dz + Math.cos(t * 0.31 * jj.sp + jj.ph) * 1.3, 1, PW - 1);
        }
      }
      all.sort(function (a, b) { return b._Z - a._Z; });     // 奥から手前へ＝前後関係

      for (var n2 = 0; n2 < all.length; n2++) {
        var e2 = all[n2];
        var sx = projX(e2._X, e2._Z), sy = projY(e2._Z);
        var hpx = Math.max(4, Math.round(mPx(e2._Z) * 1.85 * figExag));
        if (sx < -20 || sx > W + 20) continue;
        drawPlayer(x, sx, sy, hpx, e2.c, t * 3.2 * e2.j.sp + e2.j.ph, e2.d);
      }

      // ボール（浮きは付けない＝層Sの主語はチーム。ボールは位置の指標）
      var bx = projX(ball.X, ball.Z), by = projY(ball.Z), bm = mPx(ball.Z);
      //   この縮尺だとボールは1〜2px。芝に埋もれるので暗いリムと薄いにじみで拾えるようにする。
      var br = Math.max(1, Math.round(bm * 0.20 * figExag));
      var bxi = Math.round(bx), byi = Math.round(by - br * 2);
      x.fillStyle = 'rgba(4,12,8,0.4)';
      x.beginPath(); x.ellipse(bx, by, br + 1.5, Math.max(1, br * 0.6), 0, 0, Math.PI * 2); x.fill();
      var bg2 = x.createRadialGradient(bxi, byi + br, 1, bxi, byi + br, br * 5);
      bg2.addColorStop(0, 'rgba(255,255,255,0.22)'); bg2.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = bg2; x.fillRect(bxi - br * 5, byi + br - br * 5, br * 10, br * 10);
      x.fillStyle = 'rgba(6,14,10,0.9)'; x.fillRect(bxi - br - 1, byi - 1, br * 2 + 2, br * 2 + 2);
      x.fillStyle = '#ffffff'; x.fillRect(bxi - br, byi, br * 2, br * 2);

      // 手前レイヤーを選手より後に重ねる（遮蔽＝奥行きの決定打）
      x.drawImage(bg, 0, H - 17, W, 17, 0, H - 17, W, 17);

      x.drawImage(vigC, 0, 0);                   // ビネット（焼き済み）
    }
    frame();
    return cv;
  }

  function clearCache() { _bgCache = null; _bgKey = ''; }

  // ── ゲーム本体からの入口（simulate.js が typeof ガードで呼ぶ・公開版は非同梱で no-op）──
  //   ★ 新しい画面は増やさない。**既にある「引きの枠」の中身を、戦術図から絵に差し替えるだけ**。
  //     具体的には「カットインアートが無いシーン」で従来 renderSceneField が大きく出ていた枠。
  //     ミニ枠（カットインの下に添える親指サイズ）は図のまま＝あの寸法で引き画は読めない。
  //   areaCoords は AREA_COORDS_H（simulate.js の const＝script scope）を呼び出し側から渡す。
  //   opts.area=false で「エリア強調リング」を消す（QUIET-01「間」のビートで使う＝効果ゼロにするため）。
  function forScene(sc, gs, areaCoords, opts) {
    if (!sc || !gs || !gs.team1 || !gs.team2 || !areaCoords) return null;
    var raw = areaCoords[sc.area] || { x: 50, y: 50 };
    // renderSceneField と同じ流儀で「team1 が右へ攻める盤面」に正規化する。
    //   エリア座標は攻撃チーム相対なので、team2 の攻撃時は x(攻撃方向)も y(左右)も反転＝180°回転。
    var flip = (sc.offence !== gs.team1);
    var nx = flip ? (100 - raw.x) : raw.x;
    var ny = flip ? (100 - raw.y) : raw.y;
    return render({
      team1: gs.team1, team2: gs.team2,
      ball: { X: nx / 100 * PL, Z: ny / 100 * PW },
      area: !(opts && opts.area === false)
    });
  }

  return {
    render: render, forScene: forScene, clearCache: clearCache,
    proj: { x: projX, y: projY, m: mPx }, DIM: { W: W, H: H, PL: PL, PW: PW }
  };
})();
