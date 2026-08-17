'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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

Object.entries(protectedAssets).forEach(([rel, expected]) => {
  assert.strictEqual(sha256(rel), expected, `protected shot asset changed: ${rel}`);
});

const newFrames = [1, 2, 3, 4].map(n => `img/cutscenes/manga_shot_cinematic/frame_0${n}.png`);
newFrames.forEach(rel => {
  const png = fs.readFileSync(path.join(ROOT, rel));
  assert.strictEqual(png.subarray(1, 4).toString('ascii'), 'PNG', `${rel} is not PNG`);
  assert.strictEqual(png[25], 6, `${rel} must be RGBA PNG`); // IHDR color type
  assert(png.length > 20000, `${rel} is unexpectedly small`);
});

assert(cutscene.includes('var _CINEMATIC_SHOT_FRAMES = ['), 'new shot sequence is not registered');
newFrames.forEach(rel => assert(cutscene.includes(rel + '?v=1'), `missing runtime path: ${rel}`));
assert(/function _renderShotScene\(sc, entry\) \{\s*return \(_csShotVarHash\(sc\) & 1\) \? _renderCinematicShotScene\(sc\) : _renderAdoptedShotScene\(sc\);\s*\}/m.test(cutscene), 'shot variants must use deterministic rotation and preserve the adopted sequence');
assert(cutscene.includes("MangaRecolor.render('cinematic-shot-' + idx, img, cols)"), 'new shot must follow runtime kit recoloring');

console.log('cinematic shot: protected original + 4 RGBA frames + deterministic rotation PASS');
