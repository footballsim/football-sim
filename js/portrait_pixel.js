/* ============================================================================
 * portrait_pixel.js — PT-06 試作: NES/キャプテン翼調 ピクセルヘッド・レンダラ
 *   仮説検証: 「差し替え頭を体と同じドット絵画風で作れば貼り絵にならない」
 *   - identity は既存 Portrait.featuresFor(longName) を流用（決定論・乱数なし）
 *   - 描画は完全ピクセルネイティブ（tiny grid → nearest-neighbor 整数倍拡大）
 *   - 限定パレット / フラット塗り / 硬い黒縁 / 階段エッジ（絵画調グラデ厳禁）
 *   - Portrait.render(バスト) / composePose(絵画頭) には一切触れない（後方互換）
 *   公開: window.PixelHead = { render, composePose, HEAD }
 *   ES module化しない（通常scriptタグ・window直下）
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ---------- 頭グリッド（native セル座標系。1セル=拡大後の1ドット） ----------
     体(pt06_body_shot.png 833×1180)の黒縁太さ・階調に画風を寄せる。
     GW×GH のセルを整数倍(=SC)拡大 → 縁が体と同程度の階段になる。 */
  var GW = 24, GH = 28;          // 頭の native セル数
  var NECK = { x: 12, y: 25 };   // 首ソケット中心（セル座標。ボディ襟へ合わせる基準点。2セル分は襟へ潜らせる）
  var OUTLINE = '#161616';       // 硬い黒縁（体の縁色に合わせる）

  /* ---------- 限定パレット化: SKIN/HAIR(輝度連続) を 2〜3階調フラットに落とす ----------
     体は「ベタ肌＋1段影＋黒縁」「ベタ髪＋1段ハイライト＋黒縁」構成。これに揃える。 */
  function hexToRgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHex(r, g, b) {
    r = Math.max(0, Math.min(255, r | 0)); g = Math.max(0, Math.min(255, g | 0)); b = Math.max(0, Math.min(255, b | 0));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
  function shade(hex, f) { var c = hexToRgb(hex); return rgbToHex(c[0] * f, c[1] * f, c[2] * f); }
  function lighten(hex, f) { var c = hexToRgb(hex); return rgbToHex(c[0] + (255 - c[0]) * f, c[1] + (255 - c[1]) * f, c[2] + (255 - c[2]) * f); }

  // フォールバック定数（Portrait._meta 未ロード時。通常は _meta を参照）
  var SKIN_FALLBACK = ['#ffdcbb', '#f4c79b', '#e6ad7f', '#cf8f5d', '#a06a3f', '#6f492c'];
  var HAIR_FALLBACK = ['#20232a', '#3a2416', '#5a381f', '#7b4a26', '#a86a2f', '#d7ac54', '#e6cf86', '#98352a', '#b9b9c0', '#e7e2da'];

  function skinHex(i) { var M = global.Portrait && Portrait._meta && Portrait._meta.SKIN; return M ? M[i][0] : SKIN_FALLBACK[i]; }
  function hairHex(i) { var M = global.Portrait && Portrait._meta && Portrait._meta.HAIR; return M ? M[i][0] : HAIR_FALLBACK[i]; }

  /* ---------- 12 hstyle → 少数ピクセル髪型マスクへの写像 ----------
     Portrait HAIRSTYLE 並び:
     0 short 1 fade 2 skin 3 spike 4 curly 5 part 6 bangs 7 afro 8 slick 9 wavy 10 mohawk 11 bowl
     → 8種のシルエット系(silhouette groups)へ。 */
  var HAIR_GROUP = [
    'short',  // 0 short
    'short',  // 1 fade（短髪扱い・生え際やや高）
    'bald',   // 2 skin（スキンヘッド）
    'spike',  // 3 spike
    'afro',   // 4 curly（もっさり=アフロ寄せ）
    'part',   // 5 part（七三）
    'bowl',   // 6 bangs（前髪ぱっつん=マッシュ寄せ）
    'afro',   // 7 afro
    'slick',  // 8 slick（オールバック）
    'slick',  // 9 wavy（ウェーブ=なでつけ寄せ）
    'mohawk', // 10 mohawk
    'bowl'    // 11 bowl（マッシュ）
  ];

  /* ---------- 髪シルエット（セル矩形の集合。CT の頭くらいの情報量） ----------
     顔の丸(頭頂 y3〜あご y24, 幅 x5〜x18 くらい)を包む「毛の帯」を rect で定義。
     各 rect = [x, y, w, h]（セル）。fill=髪色ベタ、上端付近に 1 段ハイライト。 */
  var HAIR_MASK = {
    // 生え際が低め・こめかみまで下りる王道短髪
    short: { fill: [[5, 2, 14, 5], [4, 4, 2, 5], [18, 4, 2, 5]], hi: [[6, 2, 12, 1]] },
    // てっぺんだけツンツン（頂点を段状に）
    spike: { fill: [[5, 3, 14, 4], [6, 1, 2, 2], [10, 0, 2, 3], [14, 1, 2, 2], [16, 2, 2, 2], [8, 2, 2, 1]], hi: [[10, 1, 2, 1]] },
    // 丸く大きい毛量（アフロ/くるくる）
    afro: { fill: [[3, 1, 18, 7], [2, 3, 2, 5], [20, 3, 2, 5], [5, 0, 14, 2]], hi: [[5, 1, 4, 1], [15, 1, 3, 1]] },
    // 七三（左が高く盛り上がり分け目）
    part: { fill: [[5, 2, 14, 5], [4, 4, 2, 4], [18, 4, 2, 4], [6, 1, 6, 2]], hi: [[6, 2, 5, 1]], parting: [12, 2, 1, 4] },
    // オールバック（生え際高め・後方へ流す）
    slick: { fill: [[5, 3, 14, 4], [4, 5, 2, 3], [18, 5, 2, 3]], hi: [[6, 3, 12, 1]] },
    // モヒカン（中央の帯だけ）
    mohawk: { fill: [[10, 0, 4, 8], [9, 2, 6, 3]], hi: [[11, 0, 2, 2]] },
    // マッシュ/ぱっつん（前髪が眉上まで下り、サイドも下がる）
    bowl: { fill: [[4, 2, 16, 6], [4, 6, 3, 3], [17, 6, 3, 3]], hi: [[6, 2, 12, 1]], bangs: [[6, 7, 12, 1]] },
    // スキンヘッド（毛なし＝薄い影のみ）
    bald: { fill: [], hi: [], scalp: true }
  };

  /* ---------- ピクセル描画コア ---------- */
  function px(ctx, x, y, w, h, color, SC, ox, oy) {
    ctx.fillStyle = color;
    ctx.fillRect((ox + x) * SC, (oy + y) * SC, (w || 1) * SC, (h || 1) * SC);
  }

  /* 頭のセルマップを組み立て→描画。SC=セル拡大率, ox/oy=描画オフセット(セル) */
  function drawHead(ctx, f, SC, ox, oy) {
    ox = ox || 0; oy = oy || 0;
    var skin = skinHex(f.skin);
    var skinSh = shade(skin, 0.80);      // 1段影
    var skinHi = lighten(skin, 0.18);    // 1段ハイライト
    var hair = hairHex(f.hair);
    // 暗髪は控えめ(黒が銀に飛ぶのを防ぐ)・明髪はしっかり1段。
    var isDarkHair = (function () { var c = hexToRgb(hair); return (c[0] + c[1] + c[2]) < 200; })();
    var hairHi = isDarkHair ? lighten(hair, 0.16) : lighten(hair, 0.34);  // 髪の1段ハイライト
    var hairSh = isDarkHair ? shade(hair, 0.60) : shade(hair, 0.74);

    var grp = HAIR_GROUP[f.hstyle] || 'short';
    var mask = HAIR_MASK[grp];

    // --- 顔の輪郭（丸め四角）。黒縁→肌ベタ→影→ハイライト の順 ---
    // 顔の芯: x6..x17 (幅12) y5..y23。角を落として丸みを出す。
    var faceCells = [];
    function faceRow(x, y, w) { faceCells.push([x, y, w, 1]); }
    faceRow(7, 5, 10);           // 額
    faceRow(6, 6, 12);
    faceRow(6, 7, 12);
    faceRow(5, 8, 14);           // こめかみ最大幅
    faceRow(5, 9, 14);
    faceRow(5, 10, 14);
    faceRow(5, 11, 14);
    faceRow(5, 12, 14);
    faceRow(5, 13, 14);
    faceRow(6, 14, 12);
    faceRow(6, 15, 12);
    faceRow(6, 16, 12);          // 頬
    faceRow(7, 17, 10);
    faceRow(7, 18, 10);
    faceRow(8, 19, 8);           // あご
    faceRow(9, 20, 6);
    faceRow(10, 21, 4);

    // 黒縁: 顔セルを1回り太らせて先に敷く（体の太い黒縁に合わせる）
    faceCells.forEach(function (r) { px(ctx, r[0] - 1, r[1], r[2] + 2, 1, OUTLINE, SC, ox, oy); });
    px(ctx, 6, 4, 12, 1, OUTLINE, SC, ox, oy);   // 額上の縁
    px(ctx, 9, 22, 6, 1, OUTLINE, SC, ox, oy);   // あご下の縁

    // 肌ベタ
    faceCells.forEach(function (r) { px(ctx, r[0], r[1], r[2], 1, skin, SC, ox, oy); });
    // 影（右側と下あご）
    px(ctx, 15, 8, 3, 9, skinSh, SC, ox, oy);
    px(ctx, 9, 20, 6, 1, skinSh, SC, ox, oy);
    px(ctx, 8, 19, 8, 1, skinSh, SC, ox, oy);
    // ハイライト（左頬・額）
    px(ctx, 7, 6, 4, 2, skinHi, SC, ox, oy);
    px(ctx, 6, 9, 2, 4, skinHi, SC, ox, oy);

    // --- 耳（両サイド・skinヘッドやbaldでも出す） ---
    px(ctx, 4, 12, 1, 3, OUTLINE, SC, ox, oy); px(ctx, 5, 12, 1, 3, skin, SC, ox, oy);
    px(ctx, 18, 12, 1, 3, OUTLINE, SC, ox, oy); px(ctx, 18, 12, 1, 3, skinSh, SC, ox, oy);

    // --- 首（ソケットへ繋ぐスタブ。体の襟で隠れる想定） ---
    px(ctx, 9, 22, 6, 5, OUTLINE, SC, ox, oy);
    px(ctx, 10, 22, 4, 5, skinSh, SC, ox, oy);

    // --- 髪（黒縁→ベタ→ハイライト） ---
    if (mask.scalp) {
      // スキンヘッド: 頭頂に薄い影だけ（毛なし）＝つるつる
      px(ctx, 7, 4, 10, 1, skinSh, SC, ox, oy);
      px(ctx, 6, 5, 3, 2, skinSh, SC, ox, oy);
    } else {
      // 縁: 各髪rectを1周り太らせて黒を敷く（上と左右）
      mask.fill.forEach(function (r) {
        px(ctx, r[0] - 1, r[1] - 1, r[2] + 2, 1, OUTLINE, SC, ox, oy);   // 上縁
        px(ctx, r[0] - 1, r[1], 1, r[3], OUTLINE, SC, ox, oy);           // 左縁
        px(ctx, r[0] + r[2], r[1], 1, r[3], OUTLINE, SC, ox, oy);        // 右縁
      });
      mask.fill.forEach(function (r) { px(ctx, r[0], r[1], r[2], r[3], hair, SC, ox, oy); });
      // 影（右側の毛）
      mask.fill.forEach(function (r) { if (r[2] >= 4) px(ctx, r[0] + r[2] - 2, r[1], 2, r[3], hairSh, SC, ox, oy); });
      // ハイライト
      (mask.hi || []).forEach(function (r) { px(ctx, r[0], r[1], r[2], r[3], hairHi, SC, ox, oy); });
      // 分け目（七三）
      if (mask.parting) { px(ctx, mask.parting[0], mask.parting[1], mask.parting[2], mask.parting[3], OUTLINE, SC, ox, oy); }
      // 前髪（マッシュ）＝額に髪を1段下ろす
      if (mask.bangs) { mask.bangs.forEach(function (r) { px(ctx, r[0], r[1], r[2], r[3], hair, SC, ox, oy); }); }
    }

    // --- 目（暗ピクセル最小限。eyes種で開き方を変える） ---
    // 標準の目位置: 左 x8, 右 x14, y11。narrow/round/droopy で高さ・形を微調整。
    var ey = 11, eyeExpr = f.eyes;
    var eL = 8, eR = 14;
    function eye(x) {
      if (eyeExpr === 3) { // narrow 細目=1px線
        px(ctx, x, ey, 2, 1, OUTLINE, SC, ox, oy);
      } else if (eyeExpr === 2) { // round 丸目=2x2黒に白1
        px(ctx, x, ey, 2, 2, OUTLINE, SC, ox, oy);
        px(ctx, x, ey, 1, 1, '#f4f4f4', SC, ox, oy);
      } else if (eyeExpr === 1) { // droopy たれ目=下げて外側
        px(ctx, x, ey + 1, 2, 1, OUTLINE, SC, ox, oy);
      } else { // normal
        px(ctx, x, ey, 2, 1, OUTLINE, SC, ox, oy);
        px(ctx, x, ey + 1, 1, 1, OUTLINE, SC, ox, oy);
      }
    }
    eye(eL); eye(eR);
    // 眉（髪色の暗ピクセル）
    px(ctx, 8, ey - 1, 2, 1, isDarkHair ? hair : OUTLINE, SC, ox, oy);
    px(ctx, 14, ey - 1, 2, 1, isDarkHair ? hair : OUTLINE, SC, ox, oy);

    // --- 鼻（1px影） ---
    px(ctx, 11, 14, 1, 2, skinSh, SC, ox, oy);
    px(ctx, 12, 15, 1, 1, skinSh, SC, ox, oy);

    // --- 口（mouth種） ---
    if (f.mouth === 1) { // thick たらこ＝2段
      px(ctx, 10, 18, 4, 1, shade(skin, 0.62), SC, ox, oy);
      px(ctx, 10, 19, 4, 1, shade(skin, 0.72), SC, ox, oy);
    } else {
      px(ctx, 10, 18, 4, 1, shade(skin, 0.60), SC, ox, oy);
    }

    // --- 髭（beard種。顎に暗ピクセル） ---
    var bd = f.beard;
    var beardCol = isDarkHair ? hair : shade(hair, 0.7);
    if (bd === 1) { // stubble 無精髭＝顎に薄い点
      px(ctx, 9, 19, 6, 1, shade(skin, 0.66), SC, ox, oy);
      px(ctx, 10, 20, 4, 1, shade(skin, 0.66), SC, ox, oy);
    } else if (bd === 2) { // mustache 口髭
      px(ctx, 10, 17, 4, 1, beardCol, SC, ox, oy);
    } else if (bd === 3) { // goatee 顎髭
      px(ctx, 10, 19, 4, 2, beardCol, SC, ox, oy);
      px(ctx, 11, 21, 2, 1, beardCol, SC, ox, oy);
    } else if (bd === 4) { // full フルビアード
      px(ctx, 7, 16, 3, 5, beardCol, SC, ox, oy);
      px(ctx, 15, 16, 3, 5, beardCol, SC, ox, oy);
      px(ctx, 9, 19, 6, 3, beardCol, SC, ox, oy);
      px(ctx, 10, 17, 4, 1, beardCol, SC, ox, oy);
    }
  }

  /* ---------- 公開: 頭だけを canvas に描く（native GW×GH をSC倍で） ----------
     render(canvasEl, longName, opt)
       opt: { skin,hair,hstyle,eyes,mouth,beard } 部分上書き可 / { expr } 表情差分
       canvas は GW*SC × GH*SC を想定。SC は canvas 幅から自動算出。 */
  function featuresFor(longName, opt) {
    var base = (global.Portrait && Portrait.featuresFor) ? Portrait.featuresFor(longName)
      : { skin: 0, hair: 0, face: 0, hstyle: 0, eyes: 0, mouth: 0, beard: 0 };
    if (opt) for (var k in opt) if (Object.prototype.hasOwnProperty.call(opt, k) && k in base) base[k] = opt[k];
    // 表情差分（演出）: expr='joy' 目を閉じ口開き / 'grit' 食いしばり
    if (opt && opt.expr === 'joy') { base.eyes = 3; base.mouth = 1; base._joy = true; }
    if (opt && opt.expr === 'grit') { base.mouth = 0; base._grit = true; }
    return base;
  }

  function render(canvasEl, longName, opt) {
    if (!canvasEl || !canvasEl.getContext) return;
    var f = featuresFor(longName, opt);
    var ctx = canvasEl.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    var SC = Math.max(1, Math.round(canvasEl.width / GW));
    drawHead(ctx, f, SC, 0, 0);
    // 表情の追い足し（歓喜=口を開ける／食いしばり=横一文字強調）
    if (f._joy) { px(ctx, 10, 18, 4, 2, '#5a1e14', SC, 0, 0); px(ctx, 11, 18, 2, 1, '#c85a4a', SC, 0, 0); }
    if (f._grit) { px(ctx, 9, 18, 6, 1, '#3a2418', SC, 0, 0); }
  }

  /* ---------- 合成: ボディ画像に頭を載せる（composePose 相当・pixel専用の薄い関数） ----------
     疎結合方針: 既存 Portrait.composePose には相乗りせず、ピクセル頭専用の合成を新設。
     引数は既存 anchor 規約に合わせる（sx,sy=body native 首ソケット, headH=dest高, dScale, flip）。 */
  function composePose(destCtx, longName, bodyImg, anchor, opt) {
    if (!destCtx || !bodyImg) return null;
    anchor = anchor || {};
    var bw = anchor.bw || bodyImg.naturalWidth || bodyImg.width;
    var bh = anchor.bh || bodyImg.naturalHeight || bodyImg.height;
    var dScale = anchor.dScale || 1;
    var flip = !!anchor.flip;
    destCtx.imageSmoothingEnabled = false;

    // 1) ボディ描画（naturalWidth||width で未確定描画バグ回避）
    if (bodyImg.naturalWidth || bodyImg.width) destCtx.drawImage(bodyImg, 0, 0, bw * dScale, bh * dScale);

    // 2) 頭を native グリッドで別canvasに描く
    var headH = anchor.headH || 140;              // dest座標での頭高さ(px)
    var SC = Math.max(1, Math.round(headH / GH)); // 1セルの表示px（整数=硬いドット維持）
    var hc = document.createElement('canvas');
    hc.width = GW * SC; hc.height = GH * SC;
    var hctx = hc.getContext('2d');
    render(hc, longName, opt);

    // 3) NECK セルを body socket(sx,sy)*dScale へ合わせる
    var socketX = anchor.sx * dScale, socketY = anchor.sy * dScale;
    var neckPxX = NECK.x * SC, neckPxY = NECK.y * SC;
    var dx = socketX - neckPxX;   // 非flip時の頭左上
    var dy = socketY - neckPxY;

    destCtx.save();
    if (flip) { destCtx.translate(2 * socketX, 0); destCtx.scale(-1, 1); }
    destCtx.drawImage(hc, dx, dy);
    destCtx.restore();

    var rx = flip ? (2 * socketX - (dx + hc.width)) : dx;
    return { x: rx, y: dy, w: hc.width, h: hc.height, cell: SC };
  }

  global.PixelHead = {
    render: render,
    composePose: composePose,
    HEAD: { GW: GW, GH: GH, NECK: NECK, HAIR_GROUP: HAIR_GROUP }
  };
})(typeof window !== 'undefined' ? window : this);
