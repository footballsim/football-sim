#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let preloadCalls = 0;
let paintCalls = 0;
let preloadKeys = null;
const canvases = [{ id: 'boardroom' }, { id: 'press' }];
const root = {
  querySelectorAll(selector) {
    if (selector !== 'canvas[data-labart]') throw new Error('unexpected selector: ' + selector);
    return canvases;
  },
};

const context = {
  console,
  setTimeout,
  clearTimeout,
  document: {},
  LabArt: {
    fitLater(canvas) {
      if (!canvases.includes(canvas)) throw new Error('unexpected canvas');
      paintCalls += 1;
    },
    preload(keys) {
      preloadCalls += 1;
      preloadKeys = keys;
      return Promise.resolve();
    },
  },
  window: {
    addEventListener() {},
  },
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'js', 'lg-ui.js'), 'utf8'),
  context,
  { filename: 'js/lg-ui.js' },
);

async function main() {
  context.window.LgUI.paintArt(root);
  await Promise.resolve();
  if (preloadCalls !== 1) throw new Error('初回preloadは1回であるべき: ' + preloadCalls);
  if (JSON.stringify(preloadKeys) !== JSON.stringify(['boardroom', 'office_bg', 'stadium_night'])) {
    throw new Error('配置済み画像だけをpreloadするべき: ' + JSON.stringify(preloadKeys));
  }
  if (paintCalls !== 4) throw new Error('fallback＋load後の2回描画が必要: ' + paintCalls);

  context.window.LgUI.paintArt(root);
  await Promise.resolve();
  if (preloadCalls !== 1) throw new Error('再描画でpreloadを重複してはいけない: ' + preloadCalls);
  if (paintCalls !== 8) throw new Error('再描画でも現在値＋load済み画像を描く: ' + paintCalls);

  console.log('✅ LabArt preload/repaint 4/4 PASS');
}

main().catch((error) => {
  console.error('❌ LabArt preload/repaint FAIL:', error.message);
  process.exitCode = 1;
});
