/**
 * load-engine.js — ブラウザ用の分割 js/ を Node 上で headless ロードする共通ローダ。
 *
 * 背景: js/*.js は ES module ではなく <script> 前提のグローバル共有コード。
 *   ブラウザは players.js → simulate.js → narration.js の順で読み、全 top-level
 *   宣言（var/let/const/function）が「スクリプトスコープ」を共有する。Node でこれを
 *   再現するには 3 ファイルを連結し、DOM スタブを前置して 1 つの vm context で実行する。
 *
 * 旧 sim_test.js / calibrate_large.js は index.html から <script> を抽出していたが、
 * 2026/06/02 の js/ 分割以降は行番号がズレて動かない。本ローダがその後継。
 *
 * 注意: top-level の const/let（例: TEAM_DATA, system_data）は vm context のプロパティに
 *   ならない（レキシカルスコープに留まる）。そのため API は vm.runInContext で式評価して取り出す。
 *   function 宣言（simulateSilent 等）は context プロパティになるが、統一して式評価で取得する。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// ブラウザ API のスタブ。ロード時に走る初期化コードを無害化する（描画・Firebase・i18n 等）。
const DOM_STUB = `
class URLSearchParams{constructor(s){}get(k){return null;}}
const _elStub={textContent:"",innerHTML:"",value:"",style:{},dataset:{},classList:{add:()=>{},remove:()=>{},toggle:()=>{},contains:()=>false},appendChild:()=>{},removeChild:()=>{},setAttribute:()=>{},getAttribute:()=>null,addEventListener:()=>{},querySelector:()=>null,querySelectorAll:()=>[],getContext:()=>null,focus:()=>{},remove:()=>{}};
const document={getElementById:()=>(_elStub),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>(Object.assign({},_elStub)),createElementNS:()=>(Object.assign({},_elStub)),body:{appendChild:()=>{},classList:{add:()=>{},remove:()=>{}}},documentElement:{style:{},classList:{add:()=>{},remove:()=>{}}},addEventListener:()=>{},head:{appendChild:()=>{}}};
const window={addEventListener:()=>{},location:{hash:"",search:""},matchMedia:()=>({matches:false,addEventListener:()=>{}}),navigator:{language:"ja"}};
const navigator={language:"ja"};
const localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const sessionStorage={getItem:()=>null,setItem:()=>{}};
const firebase={initializeApp:()=>{},firestore:()=>({collection:()=>({doc:()=>({get:()=>Promise.resolve({exists:false,data:()=>({})}),set:()=>Promise.resolve(),update:()=>Promise.resolve()})})})};
const gtag=()=>{};
const alert=()=>{};
const confirm=()=>true;
function showScreen(){}
function showWCStats(){}
`;

// 連結対象（ブラウザのロード順）。ui.js は Firebase 専用なので headless では不要。
// rng.js = 差し替え可能 PRNG（未シード時 Math.random フォールバック・simulate.js より前）。
// mental.js = 個性・メンタル・スキル層（PS-02〜04・lab 限定。harness は lab 相当＝mental 有効で計測）。
// events.js = 試合結果→Event列の正規化アダプタ（購読層・エンジン無改変）。
// match.js  = playMatch（本番の試合エントリ。buildTeam/simulateChance/matchToEvents を束ねる・events.js の後）。
const JS_FILES = ['players.js', 'rng.js', 'mental.js', 'simulate.js', 'events.js', 'match.js', 'narration.js'];

/**
 * エンジンを Node の vm context にロードして主要 API を返す。
 * @returns {{ctx, TEAM_DATA, system_data, simulateSilent, simulateChance, buildTeam, getTeamTotalParam}}
 */
function loadEngine() {
  let code = DOM_STUB + '\n';
  for (const f of JS_FILES) {
    code += fs.readFileSync(path.join(ROOT, 'js', f), 'utf8') + '\n';
  }

  const ctx = vm.createContext({
    Math, console, parseInt, parseFloat, isNaN, isFinite,
    setTimeout: (fn) => fn(), clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    Promise, JSON, Object, Array, String, Number, Boolean, Date, RegExp, Error,
    require, __dirname: ROOT,
  });

  try {
    vm.runInContext(code, ctx, { filename: 'engine-concat.js' });
  } catch (e) {
    const err = new Error('エンジンのロードに失敗: ' + e.message);
    err.stack = e.stack;
    throw err;
  }

  // const/let も拾えるよう、式評価でまとめて取り出す（typeof ガードで欠損に強くする）。
  const api = vm.runInContext(`({
    TEAM_DATA:        typeof TEAM_DATA!=='undefined'        ? TEAM_DATA        : null,
    system_data:      typeof system_data!=='undefined'      ? system_data      : null,
    simulateSilent:   typeof simulateSilent!=='undefined'   ? simulateSilent   : null,
    simulateChance:   typeof simulateChance!=='undefined'   ? simulateChance   : null,
    buildTeam:        typeof buildTeam!=='undefined'        ? buildTeam        : null,
    getTeamTotalParam:typeof getTeamTotalParam!=='undefined'? getTeamTotalParam: null,
    matchToEvents:    typeof matchToEvents!=='undefined'    ? matchToEvents    : null,
    playMatch:        typeof playMatch!=='undefined'        ? playMatch        : null,
    createMatch:      typeof createMatch!=='undefined'      ? createMatch      : null,
    sceneToEvents:    typeof sceneToEvents!=='undefined'    ? sceneToEvents    : null,
    tallyGoals:       typeof tallyGoals!=='undefined'       ? tallyGoals       : null,
    EVENT_TYPES:      typeof EVENT_TYPES!=='undefined'       ? EVENT_TYPES      : null,
    rng:              typeof rng!=='undefined'              ? rng              : null,
    seedRng:          typeof seedRng!=='undefined'          ? seedRng          : null,
    clearSeed:        typeof clearSeed!=='undefined'        ? clearSeed        : null,
    isRngSeeded:      typeof isRngSeeded!=='undefined'       ? isRngSeeded      : null,
    MATCH_CHANCES:    typeof MATCH_CHANCES!=='undefined'     ? MATCH_CHANCES    : null,
    HALF_CHANCES:     typeof HALF_CHANCES!=='undefined'      ? HALF_CHANCES     : null,
    TACTICS_POSSESSION: typeof TACTICS_POSSESSION!=='undefined' ? TACTICS_POSSESSION : null,
    TACTICS_PRESS:      typeof TACTICS_PRESS!=='undefined'      ? TACTICS_PRESS      : null,
    TACTICS_COUNTER:    typeof TACTICS_COUNTER!=='undefined'    ? TACTICS_COUNTER    : null,
    TACTICS_CATENACCIO: typeof TACTICS_CATENACCIO!=='undefined' ? TACTICS_CATENACCIO : null
  })`, ctx);

  const missing = Object.entries(api).filter(([, v]) => v == null).map(([k]) => k);
  if (missing.length) {
    throw new Error('必要なグローバルが見つかりません: ' + missing.join(', '));
  }

  api.ctx = ctx;
  return api;
}

module.exports = { loadEngine, ROOT, JS_FILES };
