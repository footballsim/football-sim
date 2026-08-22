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
  ['function _renderLongpassScene', 'function _renderLongpassResultScene'],
  ['function _renderLongpassResultScene', '// GKのキット色を選ぶ']
]) {
  assert.strictEqual(section(cutscene, start, end), section(baseCutscene, start, end), `${start} routing changed`);
}
assert.strictEqual(
  cutscene.match(/if \(sc\.action === 'クロス'\) return _renderCrossScene\(sc\);[^\n]*/)[0],
  baseCutscene.match(/if \(sc\.action === 'クロス'\) return _renderCrossScene\(sc\);[^\n]*/)[0],
  'production cross routing changed'
);
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

function alphaBounds(image, threshold = 32) {
  let left = image.width, top = image.height, right = -1, bottom = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] <= threshold) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  assert(right >= left && bottom >= top, 'alpha bounds are empty');
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}

const frames = Array.from({ length: 6 }, (_, i) => `img/cutscenes/manga_cross6/frame_${String(i + 1).padStart(2, '0')}.png`);
const crossFrameGitObjects = [
  '6426f5c44da7fbb1fcefacdba8376b0e18837d82',
  'bd3c88ec4ccf2f6be01250d455516e380b7b1268',
  '26e8f5a669da46a10b30cb963a55c58599d194aa',
  'de31f771e99ceed20f31f14e7351691abb3484f4',
  'c8ae48a53b875fd65dc2db01db772cd865cae390',
  'c5d8fd29d53ef5fbf7f47f2933b207d6d7110ec3'
];
frames.forEach((rel, i) => {
  const actual = execFileSync('git', ['rev-parse', `HEAD:${rel}`], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.strictEqual(actual, crossFrameGitObjects[i], `approved cross6 image changed: ${rel}`);
});
const decoded = new Map();
for (const rel of frames) {
  const image = decodeRgbaPng(fs.readFileSync(path.join(ROOT, rel)));
  decoded.set(rel, image); assertCleanFrame(rel, image);
}

// Compare visible (alpha-bounded) player height at its authored draw scale,
// not transparent source-canvas height. The 0.86 cross6 take should sit in the
// established heading/overhead visual band without modifying protected art.
const crossPlayerScale = 0.86, crossDrawHeight = 190 * crossPlayerScale;
const crossRuntimeScale = crossDrawHeight / 336;
const crossVisibleHeights = frames.map(rel => alphaBounds(decoded.get(rel)).height * crossRuntimeScale);
const protectedFigureScale = 0.83;
const headingRuntimeScale = (182 * protectedFigureScale) / 224;
const overheadRuntimeScale = (182 * protectedFigureScale) / 224;
const headingVisibleHeights = Array.from({ length: 6 }, (_, i) => {
  const rel = `img/cutscenes/manga_heading6/f${i + 1}.png`;
  return alphaBounds(decodeRgbaPng(fs.readFileSync(path.join(ROOT, rel)))).height * headingRuntimeScale;
});
const overheadVisibleHeights = Array.from({ length: 5 }, (_, i) => {
  const rel = `img/cutscenes/manga_overhead5/f${i + 1}.png`;
  return alphaBounds(decodeRgbaPng(fs.readFileSync(path.join(ROOT, rel)))).height * overheadRuntimeScale;
});
const protectedVisualBand = [
  Math.max(...headingVisibleHeights) * 0.95,
  Math.max(...overheadVisibleHeights) * 1.02
];
assert(crossVisibleHeights.every(height => height >= protectedVisualBand[0] && height <= protectedVisualBand[1]), 'scaled cross6 alpha height left the protected heading/overhead visual band');
assert(crossVisibleHeights.every(height => Math.abs(height - 155.62) < 0.02), 'cross6 visible alpha height is not the audited 0.86 take');

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
assert(lab.includes('<script src="js/cutscene.js?v=lab95"></script>'), 'Scene Lab must cache-bust the current cutscene runtime');
assert(!lab.includes('js/cutscene.js?v=lab94'), 'stale Scene Lab cutscene cache key remains');
assert(cutscene.includes('var frameDur = [95, 80, 80, 85, 100, 220];'), 'reference-paced six-frame timing missing');
assert(cutscene.includes('if (elapsed < totalMs) requestAnimationFrame(frame);'), 'one-shot stop contract missing');
assert(cutscene.includes('if (elapsed >= leaveMs)'), 'f6 ball departure missing');
assert(cutscene.includes('var rightBoot5 = [190, 304];'), 'f5 screen-right boot anchor missing');
assert(cutscene.includes('var hipSrc = [[125,170], [132,174], [158,176], [170,168], [96,176], [107,166]];'), 'six measured hip anchors missing');
assert(cutscene.includes('var tuning = { stageShiftX: -44 };'), 'cross6 left staging control changed');
assert(cutscene.includes('var playerVisualScale = 0.86;'), 'cross6 player visual scale changed');
assert(cutscene.includes('var ph = 190 * playerVisualScale, scale = ph / 336;'), 'cross6 player draw scale is not derived from the audited take');
assert(cutscene.includes('var ballRadius = 10;'), 'cross6 ball radius must match protected heading/overhead scenes');
assert(cutscene.includes('var CS_FIGURE_SCALE = 0.83;'), 'protected figure scale changed');
assert((cutscene.match(/Math\.round\(12 \* CS_FIGURE_SCALE\)/g) || []).length >= 2, 'protected heading/overhead ball-radius derivation changed');
assert.strictEqual(Math.round(12 * protectedFigureScale), 10, 'protected heading/overhead ball radius is no longer 10');
assert(cutscene.includes('var ballVelocityX = 1032, ballVelocityY = 380;'), 'cross6 natural-exit velocity changed');
assert(cutscene.includes('var hipScreenX = [182, 198, 218, 239, 253, 260].map(function (x) { return x + tuning.stageShiftX; });'), 'shifted forward-travel hip anchors missing');
assert(cutscene.includes('var currentHipX = fi < hipScreenX.length - 1'), 'continuous between-frame travel missing');
assert(cutscene.includes('var carryHipX = Math.min(currentHipX, hipScreenX[4]);'), 'pre-kick ball carry missing');
assert(!cutscene.includes('zoomEndScale: 0.94'), 'retired cross6 zoom endpoint remains');
assert(!cutscene.includes('ctx.translate(W / 2, H / 2); ctx.scale(sceneScale, sceneScale); ctx.translate(-W / 2, -H / 2);'), 'retired cross6 whole-scene zoom remains');
assert(cutscene.includes('var flipH = false;'), 'lab cross6 must keep the approved native screen-right pose');
assert(lab.includes('nativeのscreen-right固定'), 'lab must explain the fixed review direction');

// Execute the real Lab put/play/run/replay/detail functions. Gallery snapshots
// use an explicit host, so a user selection made while thumbnails are still
// rendering must keep both the visible stage and current scene independent.
assert(!lab.includes('_putTarget'), 'implicit global gallery target remains');
assert(lab.includes('function put(c,target)'), 'Lab put target parameter missing');
assert(lab.includes('function run(kind,retry,target)'), 'Lab run target parameter missing');
assert(lab.includes('run(t.e.k,0,host);'), 'gallery snapshot does not pass its host explicitly');
assert.strictEqual(
  (lab.match(/run\(kind,\(retry\|\|0\)\+1,target\)/g) || []).length,
  3,
  'shot2, longpass, and generic retries must preserve their target'
);
const labPutSource = section(lab, 'function put(c,target){', '/* ══ 一覧');
const labPlaySource = section(lab, 'function playScene(k,nm){', 'function buildGallery');
const labBuildSource = section(lab, 'function buildGallery(){', '// シューター絵');
const labRunSource = section(lab, 'function run(kind,retry,target){', "if(typeof Portrait!=='undefined'");
const labDetailSource = lab.match(/function setBgTone\(v\)\{[^\n]+\}/)[0];
const labRuns = [], labTimers = [];
const labTeam = {
  players: Array.from({ length: 11 }, (_, i) => ({ name: `P${i}`, en_name: `Player ${i}` })),
  lineup: Array.from({ length: 11 }, (_, i) => i)
};
function labHost(id) {
  let html = '';
  const host = {
    id, style: {}, children: [],
    appendChild(value) { this.children.push(value); },
    querySelector(selector) {
      if (selector === 'canvas') return this.children[0] || null;
      if (selector === 'canvas.ph') {
        if (!this.placeholder) {
          this.placeholder = {
            width: 0, height: 0,
            getContext() { return { drawImage() {} }; }
          };
        }
        return this.placeholder;
      }
      return null;
    }
  };
  Object.defineProperty(host, 'innerHTML', {
    get() { return html; },
    set(value) { html = value; if (value === '') host.children = []; }
  });
  return host;
}
const labStage = labHost('stage'), labSnapHost = labHost('snapHost');
const labGallery = labHost('gallery'), labPlayer = labHost('player');
const labGrid = labHost('galGrid'), labStatus = { textContent: '' };
const labPlayTitle = { textContent: '' };
let failNextSkill = false;
const labHarness = {
  atk: { value: 'attack' }, def: { value: 'defence' }, window: { scrollTo() {} },
  SCENE_CATALOG: [{ k: 'skill_captaincy', lay: 'C', nm: 'スキル発動' }],
  mk() { return labTeam; }, err() {},
  setTimeout(callback, delay) { labTimers.push({ callback, delay }); return labTimers.length; },
  document: {
    querySelectorAll() { return []; },
    createElement(tag) { return labHost(tag); },
    getElementById(id) {
      const nodes = {
        ok: { checked: true }, stage: labStage, gallery: labGallery,
        player: labPlayer, playTitle: labPlayTitle, galGrid: labGrid,
        snapHost: labSnapHost, galStatus: labStatus
      };
      assert(nodes[id], `unexpected Lab DOM id: ${id}`);
      return nodes[id];
    }
  },
  _renderCross6LabScene() {
    const canvas = { kind: 'cross6', serial: labRuns.length, width: 480, height: 270 };
    labRuns.push(canvas);
    return canvas;
  },
  _renderSkillActivateScene() {
    if (failNextSkill) { failNextSkill = false; return null; }
    const canvas = { kind: 'skill_captaincy', serial: labRuns.length, width: 480, height: 270 };
    labRuns.push(canvas);
    return canvas;
  }
};
vm.runInNewContext(
  `var cur='shotduel';${labPutSource}\n${labPlaySource}\n${labBuildSource}\n${labDetailSource}\n${labRunSource}\n` +
  'this.runLab=run;this.replayLab=replay;this.playSceneLab=playScene;' +
  'this.buildGalleryLab=buildGallery;this.setBgToneLab=setBgTone;',
  labHarness
);
labHarness.buildGalleryLab();
assert.strictEqual(labHarness.cur, 'shotduel', 'gallery snapshot replaced current before user selection');
assert.strictEqual(labSnapHost.children[0].kind, 'skill_captaincy', 'snapshot did not render into snapHost');
assert.strictEqual(labStage.children.length, 0, 'snapshot leaked into visible stage');
assert.strictEqual(labTimers.length, 1, 'real buildGallery did not schedule its snapshot callback');
assert.strictEqual(labTimers[0].delay, 850, 'real gallery snapshot delay changed');

labHarness.playSceneLab('cross6', 'クロス6コマ');
assert.strictEqual(labHarness.cur, 'cross6', 'user selection during gallery build did not become current');
assert.strictEqual(labStage.children[0].kind, 'cross6', 'user selection did not render into visible stage');
assert.strictEqual(labGallery.style.display, 'none', 'user selection did not hide gallery');
assert.strictEqual(labPlayer.style.display, '', 'user selection did not show player');
assert.strictEqual(labPlayTitle.textContent, 'クロス6コマ', 'user selection title changed');
const selectedCanvas = labStage.children[0];

labTimers.shift().callback(); // execute the real buildGallery timer body
assert.strictEqual(labSnapHost.children.length, 0, 'real gallery timer did not clear snapHost');
assert.strictEqual(labStatus.textContent, '1件', 'real gallery timer did not complete its queue');
assert.strictEqual(labHarness.cur, 'cross6', 'real gallery timer replaced current cross6');
assert.strictEqual(labStage.children[0], selectedCanvas, 'real gallery timer cleared visible cross6 canvas');
assert.strictEqual(labPlayTitle.textContent, 'クロス6コマ', 'real gallery timer changed visible title');

labHarness.replayLab();
assert.strictEqual(labHarness.cur, 'cross6', 'replay changed current scene');
assert.strictEqual(labStage.children[0].kind, 'cross6', 'replay did not return to visible cross6');
const replayCanvas = labStage.children[0];
labHarness.setBgToneLab('0');
assert.strictEqual(labHarness.cur, 'cross6', 'detail change changed current scene');
assert.strictEqual(labStage.children[0].kind, 'cross6', 'detail change did not redraw visible cross6');
assert.notStrictEqual(labStage.children[0], replayCanvas, 'detail change did not execute the real render/put path');

// A deferred gallery retry must retain snapHost even after the user has opened
// cross6; firing it may update the thumbnail host, never the visible player.
const detailedCanvas = labStage.children[0];
failNextSkill = true;
labHarness.runLab('skill_captaincy', 0, labSnapHost);
assert.strictEqual(labTimers.length, 1, 'generic null renderer did not schedule one retry');
assert.strictEqual(labTimers[0].delay, 400, 'generic retry delay changed');
assert.strictEqual(labHarness.cur, 'cross6', 'deferred snapshot attempt replaced current cross6');
labTimers.shift().callback();
assert.strictEqual(labSnapHost.children[0].kind, 'skill_captaincy', 'deferred retry lost its snapshot target');
assert.strictEqual(labStage.children[0], detailedCanvas, 'deferred retry replaced visible cross6');
assert.strictEqual(labHarness.cur, 'cross6', 'deferred retry replaced current cross6');

// Mutation check: the same oracle must reject a buildGallery callback that
// clears #stage instead of its off-screen host. This proves the real callback
// assertions above are sensitive to the original P1 regression.
const mutantBuildSource = labBuildSource.replace(
  "host.innerHTML='';        // ← DOMから外す＝各シーンのrAFが止まる",
  "document.getElementById('stage').innerHTML=''; // MUTANT: wrong cleanup target"
);
assert.notStrictEqual(mutantBuildSource, labBuildSource, 'gallery clear-target mutant was not created');
vm.runInNewContext(`${mutantBuildSource}\nthis.buildGalleryMutant=buildGallery;`, labHarness);
labTimers.length = 0;
labStage.innerHTML = '';
labSnapHost.innerHTML = '';
labHarness.buildGalleryMutant();
assert.strictEqual(labTimers.length, 1, 'mutant buildGallery did not schedule its callback');
labHarness.playSceneLab('cross6', 'クロス6コマ');
const mutantSelectedCanvas = labStage.children[0];
labTimers.shift().callback();
const mutantPreservedVisibleSelection =
  labStage.children[0] === mutantSelectedCanvas &&
  labHarness.cur === 'cross6' &&
  labPlayTitle.textContent === 'クロス6コマ';
assert.strictEqual(mutantPreservedVisibleSelection, false, 'test oracle accepted a stage-clearing gallery mutant');

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
const expectedHipScreenX = [138, 154, 174, 195, 209, 216];
const runtimeScale = (190 * 0.86) / 336;
function makeCrossHarness() {
  let now = 0;
  let currentScale = 1;
  const savedScales = [];
  const raf = [], rendered = [], drawCalls = [], ballCalls = [], scaleCalls = [];
  const backgroundCalls = [], effectCalls = [], clearCalls = [], fillCalls = [], messages = [];
  const images = new Map(frames.map(rel => [rel, {
    src: rel, complete: false, naturalWidth: 0, naturalHeight: 336
  }]));
  const canvas = {
    width: 0, height: 0, style: {}, dataset: {}, isConnected: true,
    getContext() { return ctx; }
  };
  let activeFillStyle = '';
  const ctx = {
    clearRect(x, y, w, h) { clearCalls.push({ now, x, y, w, h }); },
    fillRect(x, y, w, h) { fillCalls.push({ now, x, y, w, h, fillStyle: activeFillStyle }); },
    strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    save() { savedScales.push(currentScale); },
    restore() { currentScale = savedScales.pop(); },
    translate() {},
    scale(sx, sy) {
      assert(Math.abs(Math.abs(sx) - Math.abs(sy)) < 1e-9, 'cross6 scene zoom must remain uniform');
      currentScale *= Math.abs(sx);
      scaleCalls.push({ now, sx, sy, sceneScale: currentScale });
    },
    drawImage(image, dx, dy, dw, dh) {
      if (arguments.length >= 5 && image && image.src) drawCalls.push({ now, src: image.src, dx, dy, dw, dh, sceneScale: currentScale });
    },
    fillText(text) { messages.push(text); },
    set fillStyle(value) { activeFillStyle = value; }, set strokeStyle(_) {}, set lineWidth(_) {}, set font(_) {},
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
    _lpBg() { return {}; },
    _lpDrawBg(_ctx, _image, _fallback, width, height) { backgroundCalls.push({ now, width, height, sceneScale: currentScale }); },
    _lpBall(_ctx, bx, by, radius, rotation) { ballCalls.push({ now, bx, by, radius, rotation, sceneScale: currentScale }); },
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
  const originalStroke = ctx.stroke;
  ctx.stroke = function () {
    effectCalls.push({ now, sceneScale: currentScale });
    originalStroke();
  };
  return { canvas, images, messages, raf, rendered, drawCalls, ballCalls, scaleCalls, backgroundCalls, effectCalls, clearCalls, fillCalls, step };
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
assert(firstDrawByFrame.every(call => Math.abs(call.dh - 163.4) < 1e-9), 'real renderer player height is not 190px × 0.86');
assert(firstDrawByFrame.every(call => Math.abs(call.dh / 190 - 0.86) < 1e-9), 'real renderer changed more than the audited player-only scale');
const measuredHipX = firstDrawByFrame.map((call, i) => call.dx + hipSrcForRuntime[i][0] * runtimeScale);
assert.deepStrictEqual(measuredHipX, expectedHipScreenX, 'real renderer changed the authored travel anchors');
const allHipX = delayed.drawCalls.map(call => {
  const frameIndex = frames.indexOf(call.src);
  return call.dx + hipSrcForRuntime[frameIndex][0] * runtimeScale;
});
assert(Math.abs(allHipX[0] - 138) < 0.01 && Math.abs(allHipX.at(-1) - 216) < 0.01, 'real renderer shifted travel endpoints changed');
assert(allHipX.every((x, i) => i === 0 || x >= allHipX[i - 1]), 'real renderer must travel continuously screen-right');
assert(allHipX.every((x, i) => i === 0 || x - allHipX[i - 1] <= 2), 'real renderer has a visible between-frame position jump');
const ballStartNow = delayed.ballCalls[0].now;
const ballAt = elapsed => delayed.ballCalls.find(call => call.now - ballStartNow === elapsed);
const ball0 = ballAt(0), ball95 = ballAt(95), ball175 = ballAt(175), ball255 = ballAt(255);
const ball340 = ballAt(340), ball439 = ballAt(439), ball440 = ballAt(440), ball441 = ballAt(441);
const ball540 = ballAt(540), ball580 = ballAt(580), ball654 = ballAt(654), ball659 = ballAt(659), ball660 = ballAt(660);
for (const [elapsed, call] of [[0,ball0], [95,ball95], [175,ball175], [255,ball255], [340,ball340], [439,ball439], [440,ball440], [441,ball441], [540,ball540], [580,ball580], [654,ball654], [659,ball659], [660,ball660]]) {
  assert(call, `real renderer omitted the ball at ${elapsed}ms`);
  assert.strictEqual(call.radius, 10, 'real renderer ball radius differs from protected heading/overhead');
}
const carried = [ball0, ball95, ball175, ball255, ball340];
const carriedExpectedX = [193.71, 209.71, 229.71, 250.71, 264.71];
carried.forEach((call, i) => assert(Math.abs(call.bx - carriedExpectedX[i]) < 0.1, `ball carry changed at f${i + 1}`));
assert(carried.every((call, i) => i === 0 || call.bx > carried[i - 1].bx), 'ball must advance strictly from f1 through f5');
assert(carried.every((call, i) => i === 0 || call.rotation > carried[i - 1].rotation), 'ball rotation must track the pre-kick travel');
assert(Math.abs((ball340.bx - ball0.bx) - (209 - 138)) < 0.01, 'ball and player must cover the same f1-to-f5 distance');
for (const call of [ball340, ball439, ball440]) {
  assert(Math.abs(call.bx - 264.71) < 0.1 && Math.abs(call.by - 168.25) < 0.1, 'real renderer changed the scaled f5 contact');
}
assert(Math.abs(ball440.bx - ball439.bx) < 0.001 && Math.abs(ball440.by - ball439.by) < 0.001, 'f6 launch origin is discontinuous');
assert(ball441.bx > ball440.bx && ball441.by < ball440.by, 'real renderer did not launch the ball screen-right/up after f6 began');
assert(Math.abs((ball440.bx - ball440.radius) - 254.71) < 0.1, 'f5 ball edge does not touch the scaled boot contact');
assert(Math.abs(ball540.bx - 367.91) < 0.1 && Math.abs(ball540.by - 130.25) < 0.1, 'real renderer changed the relative cross6 launch trajectory');
assert(Math.abs(ball580.bx - 409.19) < 0.1 && Math.abs(ball580.by - 115.05) < 0.1, 'real renderer changed the post-kick trajectory');
assert(Math.abs(ball660.bx - 491.75) < 0.1 && Math.abs(ball660.by - 84.65) < 0.1, 'real renderer changed the final cross6 ball position');

// Radius 10 draws an outer rim at 1.14r. vx=1032 is the narrow safe band that
// leaves a visible sliver at 659ms, then moves the full rim beyond x=480 at
// 660ms. Calls at both times prove canvas clipping, not a sudden code removal.
const ballOuterRadius = 10 * 1.14;
const minimumSafeVx = (480 + ballOuterRadius - ball440.bx) / 0.220;
const maximumVisibleAt659Vx = (480 + ballOuterRadius - ball440.bx) / 0.219;
assert(1032 > minimumSafeVx && 1032 <= maximumVisibleAt659Vx, 'f6 horizontal velocity is outside the safe natural-exit band');
assert(ball659.bx - ballOuterRadius < 480, 'ball should retain a visible sliver at 659ms');
assert(ball660.bx - ballOuterRadius > 480, 'ball outer rim did not fully exit screen-right at 660ms');
assert(Math.abs((ball660.bx - ball659.bx) - 1.032) < 1e-9, 'ball did not travel continuously through its final clipped millisecond');

// GFX-09: there is no camera shrink at any point. Background, sprite, code
// ball and impact burst stay at native scale before and after the kick.
assert.strictEqual(delayed.scaleCalls.length, 0, 'cross6 renderer still applies a scene scale transform');
const allSceneLayers = delayed.backgroundCalls.concat(delayed.drawCalls, delayed.ballCalls, delayed.effectCalls);
assert(allSceneLayers.length > 0, 'real renderer did not record any scene layers');
assert(allSceneLayers.every(call => Math.abs(call.sceneScale - 1) < 1e-9), 'a cross6 layer rendered below native scale');
const layerScale441 = [
  delayed.backgroundCalls.find(call => call.now - ballStartNow === 441),
  delayed.drawCalls.find(call => call.now - ballStartNow === 441),
  ball441,
  delayed.effectCalls.find(call => call.now - ballStartNow === 441)
];
assert(layerScale441.every(Boolean), 'post-kick native-scale frame omitted a rendered layer');
assert(layerScale441.every(call => Math.abs(call.sceneScale - 1) < 1e-9), 'post-kick layers are not all native scale');

// Every playing frame draws the established background across the complete
// native canvas. With no camera shrink, no dark/transparent border can appear.
assert(delayed.backgroundCalls.every(call => call.width === 480 && call.height === 216), 'background does not cover the full native canvas');
for (const call of delayed.backgroundCalls) {
  const clear = delayed.clearCalls.find(item => item.now === call.now && item.x === 0 && item.y === 0 && item.w === 480 && item.h === 216);
  assert(clear, `playing frame at ${call.now - ballStartNow}ms did not clear the full canvas`);
  const darkMarginFill = delayed.fillCalls.find(item => item.now === call.now && item.fillStyle === '#081729');
  assert(!darkMarginFill, `playing frame at ${call.now - ballStartNow}ms retained the zoom margin fill`);
}

const finalPlayer = delayed.drawCalls.find(call => call.now - ballStartNow === 660);
assert(finalPlayer, 'final player frame missing');
const finalPlayerBounds = {
  left: finalPlayer.dx,
  right: finalPlayer.dx + finalPlayer.dw,
  top: finalPlayer.dy,
  bottom: finalPlayer.dy + finalPlayer.dh
};
assert(finalPlayerBounds.left >= 0 && finalPlayerBounds.right <= 480 && finalPlayerBounds.top >= 0 && finalPlayerBounds.bottom <= 216, 'scaled final player clips the native canvas');
assert.strictEqual(delayed.canvas.width, 480, 'cross6 canvas width changed');
assert.strictEqual(delayed.canvas.height, 216, 'cross6 canvas height changed');
assert(lab.includes('aspect-ratio:480/216'), 'Scene Lab stage aspect ratio changed');
for (const [vw, vh] of [[1920,1080], [844,390], [800,360], [667,375]]) {
  const viewportScale = vw / 480, stageHeight = 216 * viewportScale;
  assert(stageHeight <= vh + 0.01, `${vw}x${vh} cannot contain the Scene Lab stage`);
  assert(finalPlayerBounds.left * viewportScale >= 0 && finalPlayerBounds.right * viewportScale <= vw + 0.01, `${vw}x${vh} clips the final player horizontally`);
  assert(finalPlayerBounds.top * viewportScale >= 0 && finalPlayerBounds.bottom * viewportScale <= stageHeight + 0.01, `${vw}x${vh} clips the final player vertically`);
}

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
// strike, then a smaller f5→f6 follow-through step. GFX-11 shifts the whole
// staging 44px left without changing that authored cadence.
const hipSrc = [[125,170], [132,174], [158,176], [170,168], [96,176], [107,166]];
const hipScreenX = [138, 154, 174, 195, 209, 216], hipScreenY = 106, scale = (190 * 0.86) / 336;
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
const ballRadius = 10;
const ballRest = [bootContact[0] + ballRadius, bootContact[1]];
const ballCarryStart = ballRest[0] + hipScreenX[0] - hipScreenX[4];
assert(Math.abs(bootContact[0] - 254.71) < 0.1 && Math.abs(bootContact[1] - 168.25) < 0.1, 'f5 contact is not tied to the scaled right boot');
assert(Math.abs(ballRest[0] - 264.71) < 0.1 && Math.abs(ballRest[1] - 168.25) < 0.1, 'f5 ball does not rest one radius beyond the scaled boot');
assert(Math.abs(ballCarryStart - 193.71) < 0.1, 'f1 ball carry origin changed');
assert.strictEqual(ballRest[0] - ballCarryStart, hipScreenX[4] - hipScreenX[0], 'ball/player approach travel must match');

console.log('GFX-11 cross6 lab: left-shifted player/ball + natural screen-right exit PASS');
