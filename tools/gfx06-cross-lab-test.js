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

// GFX-07 repairs only extraction holes that read as dirt near f1/f3 mouths
// and on the f6 far arm. All other approved sprite pixels must stay identical.
const cleanupContract = {
  'img/cutscenes/manga_cross6/frame_01.png': {
    count: 20,
    boxes: [[172,51,173,55], [176,58,179,60], [185,58,185,58], [187,61,187,62], [184,62,184,62], [183,66,183,66]]
  },
  'img/cutscenes/manga_cross6/frame_03.png': {
    count: 7,
    boxes: [[207,60,207,61], [195,63,196,64], [195,67,196,67]]
  },
  'img/cutscenes/manga_cross6/frame_06.png': {
    count: 14,
    boxes: [[89,83,91,85], [104,85,106,86], [124,90,124,90], [125,91,125,91]]
  }
};
for (const [rel, contract] of Object.entries(cleanupContract)) {
  const before = decodeRgbaPng(execFileSync('git', ['show', `e2811fd:${rel}`], { cwd: ROOT }));
  const after = decoded.get(rel);
  assert.strictEqual(after.width, before.width, `${rel} width changed during cleanup`);
  assert.strictEqual(after.height, before.height, `${rel} height changed during cleanup`);
  const changed = [];
  for (let p = 0; p < after.width * after.height; p++) {
    const i = p * 4;
    if (after.data[i] === before.data[i] && after.data[i + 1] === before.data[i + 1] &&
        after.data[i + 2] === before.data[i + 2] && after.data[i + 3] === before.data[i + 3]) continue;
    const x = p % after.width, y = Math.floor(p / after.width);
    assert(contract.boxes.some(([x1,y1,x2,y2]) => x >= x1 && x <= x2 && y >= y1 && y <= y2), `${rel} changed outside dirt cleanup at ${x},${y}`);
    assert(before.data[i + 3] < 16 && after.data[i + 3] === 255, `${rel} cleanup must fill only transparent extraction holes`);
    assert(after.data[i] > 110 && after.data[i] > after.data[i + 1] * 1.25, `${rel} cleanup pixel is not skin-colored`);
    changed.push([x, y]);
  }
  assert.strictEqual(changed.length, contract.count, `${rel} dirt cleanup pixel count changed`);
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
assert(lab.includes('<script src="js/cutscene.js?v=lab89"></script>'), 'Scene Lab must cache-bust the cross6 runtime');
assert(!lab.includes('js/cutscene.js?v=lab88'), 'stale Scene Lab cutscene cache key remains');
assert(cutscene.includes('var frameDur = [95, 80, 80, 85, 100, 220];'), 'reference-paced six-frame timing missing');
assert(cutscene.includes('if (elapsed < totalMs) requestAnimationFrame(frame);'), 'one-shot stop contract missing');
assert(cutscene.includes('if (elapsed >= leaveMs)'), 'f6 ball departure missing');
assert(cutscene.includes('var rightBoot5 = [190, 304];'), 'f5 screen-right boot anchor missing');
assert(cutscene.includes('var hipSrc = [[125,170], [132,174], [158,176], [170,168], [96,176], [107,166]];'), 'six measured hip anchors missing');
assert(cutscene.includes('var hipScreenX = [182, 198, 218, 239, 253, 260], hipScreenY = 106;'), 'forward-travel hip anchors missing');
assert(cutscene.includes('var currentHipX = fi < hipScreenX.length - 1'), 'continuous between-frame travel missing');
assert(cutscene.includes('var flipH = false;'), 'lab cross6 must keep the approved native screen-right pose');
assert(lab.includes('nativeのscreen-right固定'), 'lab must explain the fixed review direction');

// Execute the real cross6 renderer with delayed Image objects. The animation
// clock must not begin until every pose is decoded, and a broken/never-loaded
// image must end in a visible, finite error state.
const crossRendererSource = section(
  cutscene,
  'function _renderCross6LabScene(sc) {',
  '// ============================================================\n// フリーキック'
);
assert(crossRendererSource.includes('if (started) return;'), 'cross6 detach stop missing');
const hipSrcForRuntime = [[125,170], [132,174], [158,176], [170,168], [96,176], [107,166]];
const expectedHipScreenX = [182, 198, 218, 239, 253, 260];
const runtimeScale = 190 / 336;
function makeCrossHarness() {
  let now = 0;
  const raf = [], rendered = [], drawCalls = [], ballCalls = [], messages = [];
  const images = new Map(frames.map(rel => [rel, {
    src: rel, complete: false, naturalWidth: 0, naturalHeight: 336
  }]));
  const canvas = {
    width: 0, height: 0, style: {}, dataset: {}, isConnected: true,
    getContext() { return ctx; }
  };
  const ctx = {
    clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    save() {}, restore() {}, translate() {}, scale() {},
    drawImage(image, dx, dy, dw, dh) {
      if (arguments.length >= 5 && image && image.src) drawCalls.push({ src: image.src, dx, dy, dw, dh });
    },
    fillText(text) { messages.push(text); },
    set fillStyle(_) {}, set strokeStyle(_) {}, set lineWidth(_) {}, set font(_) {},
    set textAlign(_) {}, set textBaseline(_) {}, set imageSmoothingEnabled(_) {}
  };
  const env = {
    performance: { now: () => now },
    requestAnimationFrame(cb) { raf.push(cb); },
    document: { createElement(tag) { assert.strictEqual(tag, 'canvas'); return canvas; } },
    MangaRecolor: {
      render(key, image) {
        rendered.push(image.src);
        return { src: image.src, width: image.naturalWidth, height: image.naturalHeight };
      }
    },
    _LP_BG_SRC: 'background.png',
    _loadCutsceneImg(src) {
      return images.get(src) || { src, complete: true, naturalWidth: 480, naturalHeight: 216 };
    },
    _lpBg() { return {}; }, _lpDrawBg() {},
    _lpBall(_ctx, bx, by, radius, rotation) { ballCalls.push({ now, bx, by, radius, rotation }); },
    _mangaFeat() { return { skin: '#bd7245' }; },
    _mangaColors() {
      return { shirt: '#111', shorts: '#222', socks: '#333', accent: '#444', skin: '#555' };
    },
    _csPixelate(sprite) { return sprite; },
    _csCenterSubject(value) { return value; }
  };
  vm.runInNewContext(`${expectedFrameArray}\n${crossRendererSource}\nthis.renderCross6 = _renderCross6LabScene;`, env);
  env.renderCross6({ offence: { players: [], lineup: [] }, ofsPos: 0 });
  function step(ms) {
    now += ms;
    assert(raf.length, 'animation unexpectedly stopped');
    raf.shift()();
  }
  return { canvas, images, messages, raf, rendered, drawCalls, ballCalls, step };
}

const delayed = makeCrossHarness();
delayed.step(0);
for (let i = 0; i < 5; i++) {
  const image = delayed.images.get(frames[i]);
  image.complete = true; image.naturalWidth = 220 + i;
  delayed.step(40);
}
assert.strictEqual(delayed.canvas.dataset.cross6State, 'loading', 'partial cold load must remain paused');
assert.deepStrictEqual(delayed.rendered, [], 'a pose rendered before all six images were ready');
const finalDelayedImage = delayed.images.get(frames[5]);
finalDelayedImage.complete = true; finalDelayedImage.naturalWidth = 225;
delayed.step(40);
assert.strictEqual(delayed.canvas.dataset.cross6State, 'playing', 'renderer did not start after all six images loaded');
let guard = 0;
while (delayed.raf.length && guard++ < 700) delayed.step(1);
assert(guard < 700, 'cross6 animation did not stop');
const renderedOrder = delayed.rendered.filter((rel, i, all) => i === 0 || rel !== all[i - 1]);
assert.deepStrictEqual(renderedOrder, frames, 'cold-loaded poses did not render f1 through f6 in order');
assert.strictEqual(delayed.canvas.dataset.cross6State, 'done', 'one-shot did not finish');
const firstDrawByFrame = frames.map(rel => delayed.drawCalls.find(call => call.src === rel));
assert(firstDrawByFrame.every(Boolean), 'real renderer did not draw every cross6 pose');
const measuredHipX = firstDrawByFrame.map((call, i) => call.dx + hipSrcForRuntime[i][0] * runtimeScale);
assert.deepStrictEqual(measuredHipX, expectedHipScreenX, 'real renderer changed the authored travel anchors');
const allHipX = delayed.drawCalls.map(call => {
  const frameIndex = frames.indexOf(call.src);
  return call.dx + hipSrcForRuntime[frameIndex][0] * runtimeScale;
});
assert(Math.abs(allHipX[0] - 182) < 0.01 && Math.abs(allHipX.at(-1) - 260) < 0.01, 'real renderer travel endpoints changed');
assert(allHipX.every((x, i) => i === 0 || x >= allHipX[i - 1]), 'real renderer must travel continuously screen-right');
assert(allHipX.every((x, i) => i === 0 || x - allHipX[i - 1] <= 2), 'real renderer has a visible between-frame position jump');
const ballStartNow = delayed.ballCalls[0].now;
const ballAt = elapsed => delayed.ballCalls.find(call => call.now - ballStartNow === elapsed);
const ball340 = ballAt(340), ball439 = ballAt(439), ball440 = ballAt(440), ball441 = ballAt(441), ball540 = ballAt(540);
for (const [elapsed, call] of [[340,ball340], [439,ball439], [440,ball440], [441,ball441], [540,ball540]]) {
  assert(call, `real renderer omitted the ball at ${elapsed}ms`);
}
for (const call of [ball340, ball439, ball440]) {
  assert(Math.abs(call.bx - 318.15) < 0.1 && Math.abs(call.by - 178.38) < 0.1, 'real renderer moved the ball before the f6 departure');
  assert.strictEqual(call.radius, 12, 'real renderer changed the authored ball radius');
}
assert(ball441.bx > ball440.bx && ball441.by < ball440.by, 'real renderer did not launch the ball screen-right/up after f6 began');
assert(Math.abs(ball540.bx - 400.15) < 0.1 && Math.abs(ball540.by - 140.38) < 0.1, 'real renderer changed the faster cross6 ball trajectory');

const broken = makeCrossHarness();
broken.step(0);
const brokenImage = broken.images.get(frames[2]);
brokenImage.complete = true; brokenImage.naturalWidth = 0;
broken.step(20);
assert.strictEqual(broken.canvas.dataset.cross6State, 'error', 'broken image must enter error state');
assert.strictEqual(broken.raf.length, 0, 'broken image must stop the animation loop');
assert(broken.messages.includes('CROSS 6 ASSET ERROR'), 'broken image placeholder is not explicit');

const timedOut = makeCrossHarness();
timedOut.step(0); timedOut.step(5001);
assert.strictEqual(timedOut.canvas.dataset.cross6State, 'error', 'never-loaded image must time out');
assert.strictEqual(timedOut.raf.length, 0, 'load timeout must stop the animation loop');

const detached = makeCrossHarness();
for (const image of detached.images.values()) {
  image.complete = true; image.naturalWidth = 224;
}
detached.step(0);
detached.canvas.isConnected = false;
detached.step(20);
assert.strictEqual(detached.raf.length, 0, 'detached cross6 canvas must stop the animation loop');

// The reference player travels roughly 12–15% of the video width. On the
// 480px lab canvas, use 78px of monotonic forward travel: strongest into the
// strike, then a smaller f5→f6 follow-through step.
const hipSrc = [[125,170], [132,174], [158,176], [170,168], [96,176], [107,166]];
const hipScreenX = [182, 198, 218, 239, 253, 260], hipScreenY = 106, scale = 190 / 336;
const hipDeltas = hipScreenX.slice(1).map((x, i) => x - hipScreenX[i]);
assert.deepStrictEqual(hipDeltas, [16, 20, 21, 14, 7], 'cross6 forward-travel cadence changed');
assert.strictEqual(hipScreenX.at(-1) - hipScreenX[0], 78, 'cross6 total forward travel changed');
assert(hipDeltas.every(dx => dx > 0 && dx <= 24), 'cross6 must advance monotonically without teleporting');
assert(hipDeltas[4] < hipDeltas[3], 'cross6 must decelerate after contact');
const rightBoot5 = [190, 304];
const bootContact = [
  hipScreenX[4] + (rightBoot5[0] - hipSrc[4][0]) * scale,
  hipScreenY + (rightBoot5[1] - hipSrc[4][1]) * scale
];
const ballRadius = 12;
const ballRest = [bootContact[0] + ballRadius, bootContact[1]];
assert(Math.abs(bootContact[0] - 306.15) < 0.1 && Math.abs(bootContact[1] - 178.38) < 0.1, 'f5 contact is not tied to the right boot');
assert(Math.abs(ballRest[0] - 318.15) < 0.1 && Math.abs(ballRest[1] - 178.38) < 0.1, 'f5 ball does not rest one radius beyond the boot');

console.log('GFX-07 cross6 lab: clean assets + continuous travel + spaced one-shot ball PASS');
