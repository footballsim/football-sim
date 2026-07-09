/* manga_recolor.js — 漫画カットシーン用スプライトの実行時リカラー
 *
 * 分離色ベース(shirt青#2060D0 / shorts緑#1F9D3A / socksマゼンタ#CC2F9A /
 * accentシアン#24C2D0 / 肌 / 黒スパイク・黒髪・輪郭)から、
 * チーム別キット{shirt,shorts,socks,accent}＋選手別肌色を色相マスクで置換する。
 *
 * 移植元: tools/proto/pt06_parts_recolor.py（実証済み）。
 * アルゴリズム:
 *   1) 色相でパーツ分類（part_of）。暗色・低彩度は 'fixed'（髪/靴/輪郭＝不変）。
 *   2) パーツ毎に輝度の34/67パーセンタイルで3バンド分割（THR）。ベース依存＝スプライト毎に一度だけ算出しキャッシュ。
 *   3) ターゲット色の3段ランプ(影0.58 / 素 / ハイライト+0.34)へ、元画素の輝度バンドで置換。
 * 斑点対策: THRの上下バンド幅が狭すぎる(<10)と3値化がまだらになるため最小幅ガードで広げる。
 *
 * ブラウザ(canvas ImageData)専用。共有スコープに MangaRecolor を1つ公開。
 */
(function (global) {
  'use strict';

  // ---- 分離色の色相窓（pt06_parts_base 準拠）----
  var HUE = {
    skin:   [14, 50],
    shorts: [120, 168],
    accent: [170, 202],
    shirt:  [203, 245],
    socks:  [300, 350]
  };
  var PARTS = ['skin', 'shirt', 'shorts', 'socks', 'accent'];

  function hx(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];   // #888 等の3桁hexを6桁へ（NaN→茶色化け防止）
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function lum(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }
  function shade(c, f) { return [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)]; }
  function light(c, f) { return [Math.round(c[0] + (255 - c[0]) * f), Math.round(c[1] + (255 - c[1]) * f), Math.round(c[2] + (255 - c[2]) * f)]; }
  function ramp(c) { return [shade(c, 0.58), c, light(c, 0.34)]; }

  // RGB→HSV（h:0-360, s/v:0-1）。colorsys.rgb_to_hsv と一致させる。
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    var h = 0;
    if (d !== 0) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    var s = mx === 0 ? 0 : d / mx;
    return [h, s, mx];
  }

  // 画素のパーツ判定。'fixed'=不変(髪/靴/輪郭)、null=透過。
  function partOf(r, g, b, a) {
    if (a < 40) return null;
    var hsv = rgb2hsv(r, g, b), h = hsv[0], s = hsv[1], v = hsv[2];
    if (v < 0.22 || s < 0.16) return 'fixed';
    if (h >= HUE.skin[0] && h <= HUE.skin[1]) return 'skin';
    if (h >= HUE.shorts[0] && h <= HUE.shorts[1]) return 'shorts';
    if (h >= HUE.accent[0] && h <= HUE.accent[1]) return 'accent';
    if (h >= HUE.shirt[0] && h <= HUE.shirt[1]) return 'shirt';
    if (h >= HUE.socks[0] && h <= HUE.socks[1]) return 'socks';
    return 'fixed';
  }

  /* ベースImageDataからパーツ毎の輝度レンジ[lo,hi]を算出（スプライト依存・要キャッシュ）。
   * ★連続階調方式(2026-07-07)。ベースは生成AIの滑らかグラデ(輝度12段以上)なので、
   *   旧・3階調ハード量子化はグラデを分断してバンド模様(汚れ)を生んだ。
   *   → p8〜p92 を正規化レンジにして、ターゲット色の暗〜明を連続補間する。
   */
  function computeThresholds(imgData) {
    var d = imgData.data, n = d.length, i;
    var lums = {}; PARTS.forEach(function (k) { lums[k] = []; });
    for (i = 0; i < n; i += 4) {
      var pt = partOf(d[i], d[i + 1], d[i + 2], d[i + 3]);
      if (lums[pt]) lums[pt].push(lum(d[i], d[i + 1], d[i + 2]));
    }
    var THR = {};
    PARTS.forEach(function (k) {
      var ls = lums[k].sort(function (a, b) { return a - b; }), m = ls.length;
      if (m > 8) {
        var lo = ls[Math.floor(m * 0.08)], hi = ls[Math.floor(m * 0.92)];
        if (hi - lo < 12) { var mid = (hi + lo) / 2; lo = mid - 6; hi = mid + 6; }
        THR[k] = [lo, hi];
      } else {
        THR[k] = [90, 180];
      }
    });
    return THR;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  /* baseImgData を colors で着色した新しい ImageData を返す。
   * colors: {shirt,shorts,socks,accent,skin} いずれも "#rrggbb"。
   * 各パーツ画素の輝度を[lo,hi]で正規化し、暗版(shade .52)〜明版(light .42)を連続補間。
   * ＝ベースの滑らかな陰影(布のシワ)をそのまま保ったまま色だけ差し替え→バンド無し。
   */
  function recolorImageData(baseImgData, colors, THR) {
    if (!THR) THR = computeThresholds(baseImgData);
    var ramps = {};
    ['shirt', 'shorts', 'socks', 'accent', 'skin'].forEach(function (k) {
      if (colors[k]) { var c = hx(colors[k]); ramps[k] = [shade(c, 0.52), c, light(c, 0.42)]; }
    });
    var src = baseImgData.data, n = src.length;
    var out = new Uint8ClampedArray(src); // 透過・fixed画素はそのまま引き継ぐ
    for (var i = 0; i < n; i += 4) {
      var pt = partOf(src[i], src[i + 1], src[i + 2], src[i + 3]);
      var rm = ramps[pt];
      if (!rm) continue;
      var t = THR[pt], L = lum(src[i], src[i + 1], src[i + 2]);
      var u = (L - t[0]) / (t[1] - t[0]); if (u < 0) u = 0; else if (u > 1) u = 1;
      // 0→暗版, 0.5→素, 1→明版 の連続補間（区分線形）
      var lo, hi, f;
      if (u < 0.5) { lo = rm[0]; hi = rm[1]; f = u * 2; } else { lo = rm[1]; hi = rm[2]; f = (u - 0.5) * 2; }
      out[i] = lerp(lo[0], hi[0], f);
      out[i + 1] = lerp(lo[1], hi[1], f);
      out[i + 2] = lerp(lo[2], hi[2], f);
    }
    return new ImageData(out, baseImgData.width, baseImgData.height);
  }

  // ---- 高レベルAPI: <img>/canvas を受けてキャッシュ付きで着色canvasを返す ----
  var _thrCache = {};   // spriteKey -> THR
  var _baseCache = {};  // spriteKey -> {imgData,w,h}
  var _outCache = {};   // spriteKey|colorKey -> canvas
  var _outOrder = [];
  var OUT_CAP = 240;

  function _toImageData(source) {
    var w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var ctx = c.getContext('2d'); ctx.drawImage(source, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  }

  function colorKey(colors) {
    return ['shirt', 'shorts', 'socks', 'accent', 'skin'].map(function (k) { return colors[k] || '-'; }).join('|');
  }

  /* render(spriteKey, source, colors) -> HTMLCanvasElement（着色済み）
   *  spriteKey: 一意な文字列（例 'full_short'）。THR/ベースのキャッシュキー。
   *  source: 読み込み済みの HTMLImageElement か HTMLCanvasElement（分離色ベース）。
   *  colors: {shirt,shorts,socks,accent,skin}
   */
  function render(spriteKey, source, colors) {
    var ck = spriteKey + '#' + colorKey(colors);
    if (_outCache[ck]) return _outCache[ck];
    if (!_baseCache[spriteKey]) {
      _baseCache[spriteKey] = _toImageData(source);
      _thrCache[spriteKey] = computeThresholds(_baseCache[spriteKey]);
    }
    var base = _baseCache[spriteKey];
    var img = recolorImageData(base, colors, _thrCache[spriteKey]);
    var c = document.createElement('canvas'); c.width = base.width; c.height = base.height;
    c.getContext('2d').putImageData(img, 0, 0);
    _outCache[ck] = c; _outOrder.push(ck);
    if (_outOrder.length > OUT_CAP) { delete _outCache[_outOrder.shift()]; }
    return c;
  }

  function clearCache() { _thrCache = {}; _baseCache = {}; _outCache = {}; _outOrder = []; }

  /* kitFor(td): TEAM_DATA エントリから {shirt,shorts,socks,accent} を得る。
   * td.kit があればそれを、無ければ team_color 1色から機械導出（明シャツ→暗パンツ/暗シャツ→白パンツ）。
   * リーグ8チームは authoring 済み・それ以外はこの導出でフォールバック。*/
  function kitFor(td) {
    if (td && td.kit) return td.kit;
    var base = (td && td.team_color) || '#7a7a86';
    var c = hx(base), L = lum(c[0], c[1], c[2]);
    var lightN = '#e8e8ee', darkN = '#17203a';
    return { shirt: base, shorts: L > 140 ? darkN : lightN, socks: base, accent: L > 140 ? darkN : lightN };
  }

  global.MangaRecolor = {
    HUE: HUE, PARTS: PARTS,
    partOf: partOf,
    computeThresholds: computeThresholds,
    recolorImageData: recolorImageData,
    render: render,
    kitFor: kitFor,
    clearCache: clearCache
  };
})(typeof window !== 'undefined' ? window : this);
