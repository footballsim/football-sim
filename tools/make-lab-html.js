#!/usr/bin/env node
/**
 * make-lab-html.js — ローカル検証台 `_lab.html` を index.html から生成する
 *
 * なぜ必要か: `_lab.html` は本番と同じ全DOM（#screen-setting 等）を持つ検証用ページ。
 *   `_league_dev.html` は最終話再設計用の最小シェルで試合に入れないため、動作確認はこちらで行う。
 *
 * ★ キャッシュバスティング必須（2026-08-06 に踏んだ罠）:
 *   script/link に ?v= が無いと、js を直した後にブラウザが**古い js を掴んだまま**になり、
 *   「修正したのに直っていない」と誤診する。実際に scrollBench の修正が反映されず、
 *   直っている実装を「まだ壊れている」と読み違えた。生成のたびに一意な版数を振る。
 *
 * 使い方: node tools/make-lab-html.js   → _lab.html と _lab_base.html を再生成
 *   _lab_base.html = MTG1 の5本を抜いた比較用（「MTG1のせいか」の切り分けに使う）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const V = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

// dist-lab と同じ読み込み順（build.js の labInject に合わせる）
const LAB_JS = ['names', 'sns', 'mental', 'discipline', 'portrait', 'manga_recolor',
  'juice', 'lab-art', 'lg-ui', 'matchday', 'wideshot', 'league'];
const MTG1_JS = ['attribution', 'archetype', 'dramascore', 'rail', 'oshi'];

function build(withMtg1) {
  let h = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  // 既存タグの ?v= を今回の版数へ（index.html 側は ?v= 無しのこともあるので両対応）
  h = h.replace(/(js\/[a-z0-9_-]+\.js|css\/[a-z0-9_-]+\.css)(\?v=[0-9a-zA-Z_]*)?/g, `$1?v=${V}`);

  const list = withMtg1 ? LAB_JS.concat(MTG1_JS) : LAB_JS;
  const inject = list.map((n) => `<script src="js/${n}.js?v=${V}"></script>`).join('\n') +
    '\n<script>window.LEAGUE_TEST_MODE=true;(function(){function boot(){' +
    'var tm=document.querySelector(".top-menu");if(tm)tm.style.display="none";' +
    'if(typeof showLeague==="function")showLeague();}' +
    'if(document.readyState==="loading")window.addEventListener("DOMContentLoaded",boot);else boot();})();</script>\n';

  h = h.replace('</body>', inject + '</body>');
  h = h.replace('</head>', `<link rel="stylesheet" href="css/league-ui.css?v=${V}">\n</head>`);
  return h;
}

fs.writeFileSync(path.join(ROOT, '_lab.html'), build(true));
fs.writeFileSync(path.join(ROOT, '_lab_base.html'), build(false));
console.log(`_lab.html / _lab_base.html を生成しました（?v=${V}）`);
