'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const cutscene = fs.readFileSync(path.join(ROOT, 'js/cutscene.js'), 'utf8');

const protectedAssets = {
  'img/cutscenes/manga_shot_adopted/frame_01_20260812_194453_alpha.png': '82ff1caeb1e0034106de3b56b02490617a6332a956ea6bbef337ace973595a33',
  'img/cutscenes/manga_shot_adopted/frame_02_20260812_195322_alpha.png': '34944d5244ccbfe4c59e3ae3b28122f7cf40c15fce8d5ea9a70d2a11ea4f5350',
  'img/cutscenes/manga_shot_adopted/frame_03_20260812_195726_alpha.png': '36d6135bcf664b6d7cd0d5d1ac780160b811ce9dbb537709fd829838d132800c',
  'img/cutscenes/manga_shot_adopted/frame_04_20260813_054443_alpha.png': '30acdee97cba137e202febdfaf93735d8dd36b67428a6f18c6ebe4bc89c92ef5'
};

function sha256(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
}

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
  const out = Buffer.alloc(width * height * 4);
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
      out[row + x] = (v + (filter === 1 ? left : filter === 2 ? up : filter === 3 ? ((left + up) >> 1) : filter === 4 ? paeth(left, up, ul) : 0)) & 255;
    }
  }
  return { width, height, data: out };
}

function assertCleanSprite(rel, png) {
  const { width, height, data } = decodeRgbaPng(png);
  const opaque = new Uint8Array(width * height);
  let count = 0;
  for (let i = 0; i < opaque.length; i++) {
    if (data[i * 4 + 3] > 32) { opaque[i] = 1; count++; }
  }
  assert(count > width * height * 0.12, `${rel} has too little visible subject`);
  for (let x = 0; x < width; x++) {
    assert(!opaque[x] && !opaque[(height - 1) * width + x], `${rel} touches top/bottom edge`);
  }
  for (let y = 0; y < height; y++) {
    assert(!opaque[y * width] && !opaque[y * width + width - 1], `${rel} touches left/right edge`);
  }
  const seen = new Uint8Array(opaque.length), queue = new Int32Array(opaque.length);
  const components = [];
  for (let start = 0; start < opaque.length; start++) {
    if (!opaque[start] || seen[start]) continue;
    let size = 0;
    let head = 0, tail = 0; queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const i = queue[head++], x = i % width; size++;
      const next = [x ? i - 1 : -1, x + 1 < width ? i + 1 : -1, i >= width ? i - width : -1, i + width < opaque.length ? i + width : -1];
      next.forEach(n => { if (n >= 0 && opaque[n] && !seen[n]) { seen[n] = 1; queue[tail++] = n; } });
    }
    components.push(size);
  }
  components.sort((a, b) => b - a);
  assert((components[1] || 0) < 40, `${rel} contains a detached opaque fragment (${components[1]} px)`);
}

Object.entries(protectedAssets).forEach(([rel, expected]) => {
  assert.strictEqual(sha256(rel), expected, `protected shot asset changed: ${rel}`);
});

const newFrames = [1, 2, 3, 4].map(n => `img/cutscenes/manga_shot_cinematic/frame_0${n}.png`);
newFrames.forEach(rel => {
  const png = fs.readFileSync(path.join(ROOT, rel));
  assert.strictEqual(png.subarray(1, 4).toString('ascii'), 'PNG', `${rel} is not PNG`);
  assert(png.length > 20000, `${rel} is unexpectedly small`);
  assertCleanSprite(rel, png);
});

assert(cutscene.includes('var _CINEMATIC_SHOT_FRAMES = ['), 'new shot sequence is not registered');
newFrames.forEach(rel => assert(cutscene.includes(rel + '?v=1'), `missing runtime path: ${rel}`));
assert(/function _renderShotScene\(sc, entry\) \{\s*return _renderAdoptedShotScene\(sc\);\s*\}/m.test(cutscene), 'production shot must use the user-adopted four-frame renderer');
assert(!/function renderShootStep[\s\S]*?function renderSceneArt/.exec(cutscene)[0].includes('_renderCinematicShotScene'), 'cinematic shot must not be reachable from production shoot step');
assert(cutscene.includes("MangaRecolor.render('cinematic-shot-' + idx, img, cols)"), 'new shot must follow runtime kit recoloring');

console.log('cinematic shot: adopted production assets + unadopted variant isolation PASS');
