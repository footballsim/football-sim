#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'league-ui.css'), 'utf8');
const league = fs.readFileSync(path.join(__dirname, '..', 'js', 'league.js'), 'utf8');
const narrow = '#screen-home.season-end-mode:has(> #league-body > .lg-se) .lg-office-backdrop';
const broad = '#screen-home.season-end-mode .lg-office-backdrop';

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

assert(css.includes(narrow + ' { display: none; }'), '全面ページに限定した背景非表示selectorが必要');
assert(!css.includes(broad + ' { display: none; }'), '通常ハブまで隠す広すぎるselectorを残してはいけない');
assert(/var html = '<div class="lg-sh">'[\s\S]*?_seasonEndMode\(true\)/.test(league),
  '通常ハブは.lg-shのまま固定フレームを使う前提が必要');
assert(/_body\(\)\.innerHTML = '<div class="lg-se lg-se-paged/.test(league),
  'シーズン終了系の全面ページは#league-body直下の.lg-seである必要');

console.log('✅ office backdrop visibility 4/4 PASS');
