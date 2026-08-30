'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const cutscene = fs.readFileSync(path.join(root, 'js/cutscene.js'), 'utf8');
const lab = fs.readFileSync(path.join(root, '_scene_lab.html'), 'utf8');
const expected = [
  ['frame_01.png', 'f39b23a571b749fc5cc9d515ced804ebda9c1edf4dff936e32803604db0dabd4'],
  ['frame_02.png', '2527df0f693ac5061d32a59ca0407db6c3454fa8c1a364f6415b9cffb5764dbc'],
  ['frame_03.png', 'c1ba0378621e6fd4e70758d2cf07733af5a640248673935a29edef34b565dd75'],
  ['frame_04.png', '063c64a2ce76164eaa63398861174e3105aeb724a3d76ab6012eb540dc335f22'],
  ['frame_05.png', 'd2956ada6041a9899e4f651de900bcf65449ce95f70697431744ae4a36fa1b51'],
  ['frame_05_angle_v5.png', 'd2956ada6041a9899e4f651de900bcf65449ce95f70697431744ae4a36fa1b51']
];

for (const [name, sha] of expected) {
  const bytes = fs.readFileSync(path.join(root, 'img/cutscenes/manga_shortpass5', name));
  assert.strictEqual(crypto.createHash('sha256').update(bytes).digest('hex'), sha, `${name} SHA changed`);
}

const rendererAt = cutscene.indexOf('function _renderShortpass5Scene(sc)');
assert(rendererAt > 0, 'shortpass5 production renderer missing');
const sceneArtStart = cutscene.indexOf('function renderSceneArt(sc, nextSc)');
const sceneArtEnd = cutscene.indexOf('\nfunction ', sceneArtStart + 20);
const sceneArt = cutscene.slice(sceneArtStart, sceneArtEnd);
assert(sceneArt.includes('return _renderShortpass5Scene(sc);'), 'approved shortpass5 is not wired to plain-pass production routing');
assert(sceneArt.includes('if (!isPlainPass) return _renderOnetwoScene(sc);'), 'one-two routing changed');
assert(sceneArt.includes("if (sc.result === '失敗' || sc.result === 'カウンター')"), 'failure/counter routing changed');
assert(!cutscene.includes("'design/shortpass-approval/candidates/frame05-ankle-left-v2.png'"), 'rejected axis-foot v2 remains wired to Lab');
assert(cutscene.includes("'img/cutscenes/manga_shortpass5/frame_05_angle_v5.png'"), 'approved angle-match frame05 is not wired to Lab');
assert(cutscene.includes('[181, 122, 954, 1260]'), 'approved angle-match frame05 bbox missing');
assert(cutscene.includes("var frameDur = [90, 90, 90, 90, 180];"), '2x review timing changed');
assert(cutscene.includes("var visualH = 144, subjectStartX = 210, subjectTravelX = 24, subjectBottom = 186;"), 'left staging, cross6-height bbox alignment, or rightward motion changed');
assert(cutscene.includes("var subjectCx = subjectStartX + subjectTravelX * (1 - Math.pow(1 - motionU, 2));"), 'rightward player motion missing');
assert(cutscene.includes("var ballX = 260 + (W + 18 - 260) * ballU;"), 'left-shifted ball origin changed');
assert(cutscene.includes("var ballY = 179 - Math.sin(ballU * Math.PI) * 4;"), 'cross6-height ball alignment changed');
assert(cutscene.includes("var contactMs = 270, ballFlightMs = 300;"), 'F5-contact ball timing changed');
assert(cutscene.includes("var totalMs = Math.max(frameTotalMs, contactMs + ballFlightMs);"), 'F6 flight hold missing');
assert(cutscene.includes("_lpBall(ctx, ballX, ballY, 9, ballU * 34);"), 'review ball scale changed');
assert(cutscene.includes("canvas.dataset.shortpass5State = 'done';"), 'one-shot completion missing');
assert(cutscene.includes("canvas.dataset.shortpass5Frame = String(fi + 1);"), 'frame-order diagnostic missing');
assert(cutscene.includes('hsv[0] >= 70 && hsv[0] < 120'), 'F2/F3 olive shorts normalization missing');
assert(cutscene.includes('Math.pow(su, 0.28)'), 'F2 shirt luminance normalization missing');
assert(cutscene.includes('Math.min(r, g, b) >= 150'), 'exterior gray-white fringe threshold changed');
assert(!cutscene.includes('kickSourceX'), 'unapproved right kicking-foot canvas candidate remains in Lab');
assert(cutscene.includes('MangaRecolor.render(key, _shortpass5RecolorBase(fi, im), cols)'), 'local shorts normalization not wired');
assert(cutscene.includes('_shortpass5ClearExteriorMatte(data);'), 'runtime exterior matte removal missing');
assert(cutscene.includes("var loaded = imgs.every(function (img) { return img.complete && img.naturalWidth; }) && bgImg.complete;"), 'background readiness missing');
assert(cutscene.includes("if (bgImg.naturalWidth) ctx.drawImage(bgImg, 0, 0, W, H);"), 'stadium background draw missing');
assert(cutscene.includes("canvas.dataset.shortpass5BallPhase = ballU ? (ballU < 1 ? 'moving' : 'exit') : 'contact';"), 'ball trajectory diagnostic missing');
assert(cutscene.includes('var mirror = !_csAttackRight(sc);'), 'team1/team2 attack-direction mirror missing');
assert(cutscene.includes('if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }'), 'player/ball mirror transform missing');
const recolor = fs.readFileSync(path.join(root, 'js/manga_recolor.js'), 'utf8');
assert(recolor.includes('shorts: [120, 168]'), 'global shorts hue window changed');
assert(cutscene.slice(rendererAt, cutscene.indexOf('// Scene Lab限定: クロス6コマ', rendererAt)).includes('_lpBall('), 'lab ball trajectory missing');
assert(lab.includes('data-k="shortpass5"'), 'shortpass5 lab button missing');
assert(lab.includes("{k:'shortpass5', lay:'M'"), 'shortpass5 gallery entry missing');
assert(lab.includes("kind==='shortpass5'"), 'shortpass5 lab runner missing');

const matteStart = cutscene.indexOf('function _shortpass5ClearExteriorMatte(imgData)');
const matteEnd = cutscene.indexOf('function _shortpass5Hsv(r, g, b)', matteStart);
const matteEnv = {};
vm.runInNewContext(`${cutscene.slice(matteStart, matteEnd)}\nthis.clearMatte = _shortpass5ClearExteriorMatte;`, matteEnv);
const mw = 60, mh = 60, mattePixels = new Uint8ClampedArray(mw * mh * 4);
function paintPixel(x, y, rgb) {
  const i = (y * mw + x) * 4;
  mattePixels[i] = rgb[0]; mattePixels[i + 1] = rgb[1]; mattePixels[i + 2] = rgb[2]; mattePixels[i + 3] = 255;
}
for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) paintPixel(x, y, [90, 70, 55]);
for (let x = 0; x < mw; x++) { paintPixel(x, 0, [200, 200, 200]); paintPixel(x, mh - 1, [200, 200, 200]); }
for (let y = 0; y < mh; y++) { paintPixel(0, y, [200, 200, 200]); paintPixel(mw - 1, y, [200, 200, 200]); }
for (let y = 10; y < 42; y++) for (let x = 10; x < 42; x++) paintPixel(x, y, [255, 255, 255]);
for (let x = 5; x < 15; x++) paintPixel(x, 0, [160, 160, 160]);
for (let y = 50; y < 55; y++) for (let x = 50; x < 55; x++) paintPixel(x, y, [255, 255, 255]);
matteEnv.clearMatte({ data: mattePixels, width: mw, height: mh });
assert.strictEqual(mattePixels[(0 * mw + 20) * 4 + 3], 0, 'gray-white exterior fringe remained opaque');
assert.strictEqual(mattePixels[(0 * mw + 10) * 4 + 3], 0, 'dark gray-white exterior fringe remained opaque');
assert.strictEqual(mattePixels[(20 * mw + 20) * 4 + 3], 0, 'large enclosed leg-gap matte remained opaque');
assert.strictEqual(mattePixels[(52 * mw + 52) * 4 + 3], 255, 'small white character highlight was erased');

const sectionEnd = cutscene.indexOf('// Scene Lab限定: クロス6コマ', rendererAt);
const rendererSource = cutscene.slice(cutscene.lastIndexOf('var _LAB_SHORTPASS5_FRAMES', rendererAt), sectionEnd);
let now = 0;
const raf = [];
const ctx = {
  fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '', imageSmoothingEnabled: false,
  fillRect() {}, strokeRect() {}, fillText() {}, drawImage() {}, save() {}, restore() {}, translate() {}, scale() {}
};
const canvas = { width: 0, height: 0, style: {}, dataset: {}, isConnected: true, getContext: () => ctx };
const imageSizes = [[1442, 1870], [1474, 1682], [1114, 1412], [1103, 1426], [1103, 1426]];
let imageIndex = 0;
const ballCalls = [];
const env = {
  MangaRecolor: { render: (key, image) => image },
  document: { createElement: () => canvas },
  performance: { now: () => now },
  requestAnimationFrame: fn => raf.push(fn),
  _LP_BG_SRC: 'img/cutscenes/longpass_bg_01.png',
  _loadCutsceneImg: src => {
    if (src === 'img/cutscenes/longpass_bg_01.png') return { complete: true, naturalWidth: 320, naturalHeight: 144, width: 320, height: 144 };
    const size = imageSizes[imageIndex++];
    return { complete: true, naturalWidth: size[0], naturalHeight: size[1], width: size[0], height: size[1] };
  },
  _lpBg: () => ({ width: 480, height: 216 }),
  _lpBall: (ctxArg, x, y, radius, spin) => ballCalls.push({ x, y, radius, spin }),
  _mangaFeat: () => ({ skin: '#b98764' }),
  _mangaColors: () => ({ shirt: '#d84b5d', shorts: '#253047', socks: '#d84b5d', accent: '#f2c94c', skin: '#b98764' }),
  _csAttackRight: () => true,
  _csCenterSubject: c => c
};
vm.runInNewContext(`${rendererSource}\nthis.render = _renderShortpass5Scene;`, env);
const rendered = env.render({ offence: { players: [{ name: 'P' }], lineup: [0] }, ofsPos: 0 });
function tick(ms) {
  now = ms;
  assert(raf.length, `missing rAF at ${ms}ms`);
  raf.shift()();
  return [rendered.dataset.shortpass5Frame, rendered.dataset.shortpass5State];
}
assert.deepStrictEqual(tick(0), ['1', 'playing']);
assert.strictEqual(rendered.dataset.shortpass5SubjectX, '210.0');
assert.strictEqual(rendered.dataset.shortpass5BallPhase, 'contact');
assert.strictEqual(ballCalls.at(-1).radius, 9);
assert.deepStrictEqual(tick(89), ['1', 'playing']);
assert.deepStrictEqual(tick(90), ['2', 'playing']);
assert.deepStrictEqual(tick(180), ['3', 'playing']);
assert.strictEqual(rendered.dataset.shortpass5BallPhase, 'contact');
assert.deepStrictEqual(tick(270), ['4', 'playing']);
assert.strictEqual(rendered.dataset.shortpass5BallPhase, 'contact');
assert.deepStrictEqual(tick(360), ['5', 'playing']);
assert.strictEqual(rendered.dataset.shortpass5SubjectX, '231.3');
assert.strictEqual(rendered.dataset.shortpass5BallPhase, 'moving');
assert.deepStrictEqual(tick(390), ['5', 'playing']);
assert.strictEqual(rendered.dataset.shortpass5BallPhase, 'moving');
assert.deepStrictEqual(tick(540), ['5', 'playing']);
assert.strictEqual(rendered.dataset.shortpass5SubjectX, '234.0');
assert.strictEqual(rendered.dataset.shortpass5BallPhase, 'moving');
assert.deepStrictEqual(tick(570), ['5', 'done']);
assert.strictEqual(rendered.dataset.shortpass5BallPhase, 'exit');
assert.strictEqual(rendered.dataset.shortpass5BallX, '498.0');
assert.strictEqual(raf.length, 0, 'one-shot renderer kept scheduling after done');

console.log('shortpass5 production/Lab asset lock and routing PASS');
