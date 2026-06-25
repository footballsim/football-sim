#!/usr/bin/env node
'use strict';
/**
 * recolor.js — ドット絵カットシーンのユニフォーム色をパレットスワップで差し替える。
 *   1枚生成（赤）→ 各キット色へ安価に量産。彩度の高い赤領域(=ジャージ/ソックス)だけを対象にし、
 *   肌(オレンジ寄り)・空・芝(別色相)は保持する。NES のパレットスワップと同じ発想。
 *
 * 使い方: node tools/art/recolor.js <in> <out.png> <kit|hue>
 *   kit: blue | green | yellow | purple | dark | white、または 0-360 の色相数値
 */
const sharp = require('sharp');

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h, s, l = (mx + mn) / 2;
  if (mx === mn) { h = s = 0; }
  else {
    var d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    switch (mx) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}
function hue2rgb(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
function hsl2rgb(h, s, l) {
  h /= 360; var r, g, b;
  if (s === 0) { r = g = b = l; }
  else { var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3); }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

var KITS = {
  blue:    { hue: 222 },
  green:   { hue: 135 },
  yellow:  { hue: 48, sat: 0.95 },
  orange:  { hue: 26, sat: 0.95 },
  skyblue: { hue: 202, sat: 0.5, ladd: 0.18 }, // 水色: 明るめ・やや低彩度の空色
  purple:  { hue: 280 },
  dark:    { hue: 222, lmul: 0.5 },
  white:   { white: true }
};

async function recolor(inPath, outPath, kit) {
  var spec = (typeof kit === 'string' && KITS[kit]) ? KITS[kit] : { hue: parseFloat(kit) };
  var img = sharp(inPath).ensureAlpha();
  var buf = await img.raw().toBuffer({ resolveWithObject: true });
  var data = buf.data, info = buf.info, ch = info.channels;
  for (var i = 0; i < data.length; i += ch) {
    var hsl = rgb2hsl(data[i], data[i + 1], data[i + 2]);
    var h = hsl[0], s = hsl[1], l = hsl[2];
    // 対象: 彩度の高い赤（ジャージ/ソックス）。肌(オレンジ h>16)・暗すぎ/明るすぎは除外。
    if (s > 0.42 && l > 0.16 && l < 0.72 && (h < 16 || h > 344)) {
      var v;
      if (spec.white) v = hsl2rgb(0, 0, Math.min(0.92, l + 0.22));
      else {
        var nl = spec.lmul ? l * spec.lmul : l;
        if (spec.ladd) nl += spec.ladd;
        nl = Math.max(0, Math.min(0.95, nl));   // 明度はクランプ（白飛び/つぶれ防止）
        v = hsl2rgb(spec.hue, spec.sat || s, nl);
      }
      data[i] = v[0]; data[i + 1] = v[1]; data[i + 2] = v[2];
    }
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: ch } })
    .png({ palette: true, colors: 28 }).toFile(outPath);
  return outPath;
}

if (require.main === module) {
  var a = process.argv;
  if (!a[2] || !a[3] || !a[4]) { console.error('usage: node tools/art/recolor.js <in> <out.png> <kit|hue>'); process.exit(2); }
  recolor(a[2], a[3], a[4]).then(function (p) { console.log('recolored →', p); }).catch(function (e) { console.error(e.message); process.exit(1); });
}
module.exports = { recolor };
