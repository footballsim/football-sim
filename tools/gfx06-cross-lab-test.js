'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'f88406a';
const cutscene = fs.readFileSync(path.join(ROOT, 'js/cutscene.js'), 'utf8');
const lab = fs.readFileSync(path.join(ROOT, '_scene_lab.html'), 'utf8');
const baseCutscene = execFileSync('git', ['show', `${BASE}:js/cutscene.js`], { cwd: ROOT, encoding: 'utf8' });

const protectedGitObjects = {
  'img/cutscenes/manga_heading6': '0eb83550c16bdc62124baa733a1ccf77ab92137a',
  'img/cutscenes/manga_headingdef4': 'ad7282a3e647ff74e752389ddd294e34e52a17e7',
  'img/cutscenes/manga_overhead5': '2e380ed8efebd83f1e3a283098c076bd9f92a159',
  'img/cutscenes/manga_shot_adopted': 'f7c39b66f8964fb847fa66424f2a839a24628e5e',
  'img/cutscenes/manga_shot_cinematic': '7a6601d555c4944b21e03238e560aef8badc7854',
  'img/cutscenes/longpass_bg_01.png': '9ff339ecc2e9cbbe4a42ba4708d3c7c653b22d05'
};
for (const [rel, expected] of Object.entries(protectedGitObjects)) {
  const actual = execFileSync('git', ['rev-parse', `HEAD:${rel}`], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.strictEqual(actual, expected, `protected object changed: ${rel}`);
}

function section(src, start, end) {
  const a = src.indexOf(start), b = src.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `section missing: ${start}`);
  return src.slice(a, b);
}
for (const [start, end] of [
  ['function renderShootStep', 'function renderSceneArt'],
  ['function renderSceneArt', '// ロングパス専用カットイン'],
  ['function _renderLongpassScene', 'function _renderLongpassResultScene'],
  ['function _renderLongpassResultScene', '// GKのキット色を選ぶ']
]) {
  assert.strictEqual(section(cutscene, start, end), section(baseCutscene, start, end), `${start} routing changed`);
}
assert.strictEqual(
  cutscene.match(/function _renderCrossScene\([^\n]+/)[0],
  baseCutscene.match(/function _renderCrossScene\([^\n]+/)[0],
  'production cross renderer changed'
);
assert.strictEqual((cutscene.match(/_renderCross6LabScene/g) || []).length, 1, 'cross6 must not enter production routing');

function decodeRgbaPng(png) {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.strictEqual(png[24], 8, 'PNG must use 8-bit channels');
  assert.strictEqual(png[25], 6, 'PNG must be RGBA');
  let off = 8, idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off), type = png.subarray(off + 4, off + 8).toString('ascii');
    if (type === 'IDAT') idat.push(png.subarray(off + 8, off + 8 + len));
    off += len + 12;
    if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * 4;
  const out = new Uint8ClampedArray(width * height * 4);
  function paeth(a, b, c) {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++], row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src++], left = x >= 4 ? out[row + x - 4] : 0;
      const up = y ? out[prev + x] : 0, ul = y && x >= 4 ? out[prev + x - 4] : 0;
      const add = filter === 1 ? left : filter === 2 ? up : filter === 3 ? ((left + up) >> 1) : filter === 4 ? paeth(left, up, ul) : 0;
      out[row + x] = (v + add) & 255;
    }
  }
  return { width, height, data: out };
}

function isYellowKey(r, g, b) {
  return r >= 120 && g >= 100 && b <= 105 && g / Math.max(1, r) >= 0.72 && g - b >= 55;
}
function isYellowFringe(r, g, b) {
  // Keep orange/brown skin AA; the keyed backdrop remains much closer to
  // equal red/green even after dark outline blending.
  return r >= 18 && g >= 15 && r >= g * 0.9 && g / Math.max(1, r) >= 0.78 &&
    g - b >= 10 && b / Math.max(1, r) <= 0.62;
}
function assertCleanFrame(rel, image) {
  const { width, height, data } = image;
  assert.strictEqual(height, 336, `${rel} must keep the normalized 336px height`);
  let visible = 0, yellow = 0, edgeSpill = 0;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4, a = data[i + 3];
    if (a > 32) visible++;
    if (a > 32 && isYellowKey(data[i], data[i + 1], data[i + 2])) yellow++;
    if (a > 32 && isYellowFringe(data[i], data[i + 1], data[i + 2])) {
      const x = p % width, y = Math.floor(p / width);
      const nearAlpha = (x && data[(p - 1) * 4 + 3] < 32) || (x + 1 < width && data[(p + 1) * 4 + 3] < 32) ||
        (y && data[(p - width) * 4 + 3] < 32) || (y + 1 < height && data[(p + width) * 4 + 3] < 32);
      if (nearAlpha) edgeSpill++;
    }
  }
  assert(visible > width * height * 0.12, `${rel} has too little subject`);
  assert.strictEqual(yellow, 0, `${rel} retains yellow key pixels`);
  assert(edgeSpill < 8, `${rel} retains yellow/olive edge spill (${edgeSpill}px)`);
  for (let x = 0; x < width; x++) {
    assert(data[x * 4 + 3] === 0, `${rel} touches top edge`);
    assert(data[((height - 1) * width + x) * 4 + 3] === 0, `${rel} touches bottom edge`);
  }
  for (let y = 0; y < height; y++) {
    assert(data[(y * width) * 4 + 3] === 0, `${rel} touches left edge`);
    assert(data[(y * width + width - 1) * 4 + 3] === 0, `${rel} touches right edge`);
  }
}

const frames = Array.from({ length: 6 }, (_, i) => `img/cutscenes/manga_cross6/frame_${String(i + 1).padStart(2, '0')}.png`);
const decoded = new Map();
for (const rel of frames) {
  const image = decodeRgbaPng(fs.readFileSync(path.join(ROOT, rel)));
  decoded.set(rel, image); assertCleanFrame(rel, image);
}
const expectedFrameArray = `var _LAB_CROSS6_FRAMES = [\n${frames.map(rel => `  '${rel}'`).join(',\n')}\n];`;
assert(cutscene.includes(expectedFrameArray), 'cross6 runtime paths/order changed');

// Execute the real MangaRecolor implementation for all 6 poses and 3 distinct kits.
const sandbox = { Uint8ClampedArray };
sandbox.ImageData = class ImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/manga_recolor.js'), 'utf8'), sandbox);
const recolor = sandbox.MangaRecolor;
const kits = [
  { shirt: '#f4d125', shorts: '#17458f', socks: '#f3f3e9', accent: '#218447', skin: '#bd7245' },
  { shirt: '#ec6d19', shorts: '#172f5f', socks: '#ec6d19', accent: '#f4f4ee', skin: '#e4a06d' },
  { shirt: '#183c85', shorts: '#f2f2ed', socks: '#d62839', accent: '#d4b24f', skin: '#8d563c' }
];
for (const rel of frames) {
  const image = decoded.get(rel);
  const base = new sandbox.ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  for (const colors of kits) {
    const out = recolor.recolorImageData(base, colors, recolor.computeThresholds(base));
    let masked = 0, changed = 0;
    for (let i = 0; i < base.data.length; i += 4) {
      const part = recolor.partOf(base.data[i], base.data[i + 1], base.data[i + 2], base.data[i + 3]);
      if (!part || part === 'fixed') continue;
      masked++;
      if (base.data[i] !== out.data[i] || base.data[i + 1] !== out.data[i + 1] || base.data[i + 2] !== out.data[i + 2]) changed++;
    }
    assert(masked > 900, `${rel} lacks recolorable pixels`);
    assert(changed / masked > 0.97, `${rel} leaves separation colors behind`);
  }
}

assert(lab.includes('data-k="cross6"'), 'independent cross6 lab button missing');
assert(lab.includes("{k:'cross6', lay:'M'"), 'cross6 gallery catalog entry missing');
assert(lab.includes("kind==='cross6'"), 'cross6 lab runner missing');
assert(cutscene.includes('var frameDur = [150, 120, 130, 150, 180, 320];'), 'six-frame one-shot timing missing');
assert(cutscene.includes('if (elapsed < totalMs || loading) requestAnimationFrame(frame);'), 'one-shot stop contract missing');
assert(cutscene.includes('if (canvas.isConnected) started = true; else if (started) return;'), 'detach stop missing');
assert(cutscene.includes('if (elapsed >= leaveMs)'), 'f6 ball departure missing');
assert(cutscene.includes('var rightBoot5 = [190, 304];'), 'f5 screen-right boot anchor missing');
assert(cutscene.includes('var hipSrc = [[125,170], [132,174], [158,176], [170,168], [96,176], [107,166]];'), 'six measured hip anchors missing');
assert(cutscene.includes('var hipScreenX = [220, 226, 232, 238, 244, 250], hipScreenY = 106;'), 'hip drift anchors missing');
assert(cutscene.includes('var flipH = false;'), 'lab cross6 must keep the approved native screen-right pose');
assert(lab.includes('nativeのscreen-right固定'), 'lab must explain the fixed review direction');

// Hip anchors move only 6px/frame; trim-width changes cannot make f4→f5→f6 jump.
const hipSrc = [[125,170], [132,174], [158,176], [170,168], [96,176], [107,166]];
const hipScreenX = [220, 226, 232, 238, 244, 250], hipScreenY = 106, scale = 190 / 336;
for (let i = 1; i < hipScreenX.length; i++) assert.strictEqual(hipScreenX[i] - hipScreenX[i - 1], 6, `hip drift f${i}→f${i + 1}`);
const rightBoot5 = [190, 304];
const contact = [
  hipScreenX[4] + (rightBoot5[0] - hipSrc[4][0]) * scale,
  hipScreenY + (rightBoot5[1] - hipSrc[4][1]) * scale
];
assert(Math.abs(contact[0] - 297.15) < 0.1 && Math.abs(contact[1] - 178.38) < 0.1, 'f5 ball contact is not tied to the right boot');

console.log('GFX-06 cross6 lab: assets + anchors + one-shot ball + 3-kit recolor + protected routing PASS');
