#!/usr/bin/env node
/**
 * mtg1-oshi-test.js — MTG1-#5「推し指名 ＋ 数値の言葉化」(js/oshi.js) の機械検証。
 *
 * 検証項目:
 *   T1 言葉化: 人気/信頼/評価点の5段階が**境界値ちょうど**で切り替わる。境界は実際の判定
 *      閾値（信頼35=解任ライン / 人気60・30=オファーの門戸）と一致していること。日英とも。
 *   T2 指名の保存と復元: manager.oshi に載る・セーブ→再ロードで戻る・セーブ版数(v4)は不変・
 *      クラブが変われば自動失効・解除できる。
 *   T3 カードの出し分け: 未指名 / 推しが出場していない試合 / ratings 欠落 では **null**。
 *   T4 出場した試合: カードが出て、評価点・G/A・デュエル・今季累計・アーカタイプが載る。
 *   T5 キルスイッチ: window.MTG1_OSHI === false で todayPanel/hubRow/wordOf が完全 no-op、
 *      かつ保存を書き換えない（＝league.js は従来の見た目のまま）。
 *   T6 後方互換: manager.oshi が無い旧セーブ・ratings を持たない旧 lastResult でも壊れない。
 *
 * 実行: node tools/mtg1-oshi-test.js
 * ※ league.js / oshi.js は <script> 前提。**window === vm のグローバル**にして連結ロードする
 *   （_league_dev.html と同じ読み込み順: エンジン → archetype → sns → league → oshi）。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { ROOT, JS_FILES } = require('./lib/load-engine.js');

const STUB = `
class URLSearchParams{constructor(s){}get(k){return null;}}
const _elStub={textContent:"",innerHTML:"",value:"",style:{},dataset:{},classList:{add:()=>{},remove:()=>{},toggle:()=>{},contains:()=>false},appendChild:()=>{},removeChild:()=>{},setAttribute:()=>{},getAttribute:()=>null,addEventListener:()=>{},querySelector:()=>null,querySelectorAll:()=>[],getContext:()=>null,focus:()=>{},remove:()=>{}};
const document={getElementById:()=>(_elStub),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>(Object.assign({},_elStub)),createElementNS:()=>(Object.assign({},_elStub)),body:{appendChild:()=>{},classList:{add:()=>{},remove:()=>{}}},documentElement:{style:{},classList:{add:()=>{},remove:()=>{}}},addEventListener:()=>{},head:{appendChild:()=>{}}};
const _lsData={};
const localStorage={getItem:(k)=>(k in _lsData? _lsData[k]:null),setItem:(k,v)=>{_lsData[k]=String(v);},removeItem:(k)=>{delete _lsData[k];}};
const sessionStorage={getItem:()=>null,setItem:()=>{}};
const navigator={language:"ja"};
const firebase={initializeApp:()=>{},firestore:()=>({collection:()=>({doc:()=>({get:()=>Promise.resolve({exists:false,data:()=>({})}),set:()=>Promise.resolve(),update:()=>Promise.resolve()})})})};
const gtag=()=>{};
const alert=()=>{};
const confirm=()=>true;
function showScreen(){}
function showWCStats(){}
function startManagerMatch(){}
`;

function makeCtx() {
  const sandbox = {
    Math, console, parseInt, parseFloat, isNaN, isFinite,
    setTimeout: (fn) => fn(), clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    Promise, JSON, Object, Array, String, Number, Boolean, Date, RegExp, Error
  };
  sandbox.window = sandbox;            // ★ ブラウザ同様 window === グローバル
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.location = { hash: '', search: '' };
  sandbox.matchMedia = () => ({ matches: false, addEventListener: () => {} });
  vm.createContext(sandbox);
  let code = STUB + '\n';
  for (const f of JS_FILES) code += fs.readFileSync(path.join(ROOT, 'js', f), 'utf8') + '\n';
  for (const f of ['archetype.js', 'sns.js', 'league.js', 'oshi.js']) {
    code += fs.readFileSync(path.join(ROOT, 'js', f), 'utf8') + '\n';
  }
  code += '\nwindow.localStorage = localStorage;\n';   // STUB の const を外から触れるように
  vm.runInContext(code, sandbox, { filename: 'oshi-concat.js' });
  return sandbox;
}

const W = makeCtx();
const L = W._leagueTestAPI;
const Oshi = W.Oshi;
const LS_KEY = 'fs_league_v1';
const MY = 'england2026';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail !== undefined ? '  → ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

/* =============================================================================
 * T1 数値の言葉化（純関数・境界値）
 * ========================================================================== */
section('T1 数値の言葉化（5段階・境界値・日英）');

const wid = (k, v) => { const w = Oshi.wordOf(k, v); return w ? w.id : null; };

check('人気 100 → 英雄扱い', wid('pop', 100) === 'hero');
check('人気 80（境界ちょうど）→ 英雄扱い', wid('pop', 80) === 'hero');
check('人気 79.9 → 追い風', wid('pop', 79.9) === 'tail');
check('人気 60（＝上位クラブから声がかかる帯）→ 追い風', wid('pop', 60) === 'tail');
check('人気 59 → 様子見', wid('pop', 59) === 'watch');
check('人気 30（＝オファーの門戸が狭まる帯）→ 様子見', wid('pop', 30) === 'watch');
check('人気 29 → 風当たりが強い', wid('pop', 29) === 'heat');
check('人気 15 → 風当たりが強い', wid('pop', 15) === 'heat');
check('人気 14 → 戦犯扱い', wid('pop', 14) === 'blame');
check('人気 0 → 戦犯扱い', wid('pop', 0) === 'blame');

check('信頼 100 → 全幅の信頼', wid('trust', 100) === 'full');
check('信頼 80 → 全幅の信頼', wid('trust', 80) === 'full');
check('信頼 60 → 満足', wid('trust', 60) === 'happy');
check('信頼 59 → 注視', wid('trust', 59) === 'watch');
check('信頼 45 → 注視', wid('trust', 45) === 'watch');
check('信頼 44 → 不満', wid('trust', 44) === 'unhappy');
check('信頼 35（＝解任ラインちょうど・まだ落ちていない）→ 不満', wid('trust', 35) === 'unhappy');
check('信頼 34.9（解任ライン割れ）→ 最後通牒', wid('trust', 34.9) === 'final');
check('信頼 0 → 最後通牒', wid('trust', 0) === 'final');
check('信頼の最下段の境界＝解任判定の実閾値と一致',
  W._leagueTestAPI.CONTRACT_TUNING
    ? W._leagueTestAPI.CONTRACT_TUNING.TRUST_SACK_THRESHOLD === 35 : true);

check('評価点 8.0 → 圧巻の出来', wid('rating', 8.0) === 'masterclass');
check('評価点 7.9 → 上々の出来', wid('rating', 7.9) === 'strong');
check('評価点 6.2 → 及第点', wid('rating', 6.2) === 'solid');
check('評価点 6.0（出場ベース点）→ 静かな90分', wid('rating', 6.0) === 'quiet');
check('評価点 4.0（最低点）→ 精彩を欠いた', wid('rating', 4.0) === 'off');

check('未知の kind は null', Oshi.wordOf('nope', 50) === null);
check('数値でなくても落ちない（0扱い）', !!Oshi.wordOf('pop', undefined));

W.LANG = 'en';
const enW = Oshi.wordOf('trust', 90);
W.LANG = 'ja';
const jaW = Oshi.wordOf('trust', 90);
check('英語表示で英文になる（i18n）', /[A-Za-z]/.test(enW.text) && enW.text !== jaW.text, enW.text);
check('日英とも全段階の語が空でない', ['pop', 'trust', 'rating'].every(k =>
  [100, 70, 50, 40, 20, 7, 0].every(v => {
    const w = Oshi.wordOf(k, v); return w && w.ja && w.en && w.tone;
  })));
check('言葉のHTMLにトーンが載る', /lg-word tone-(great|good|flat|warn|bad)/.test(Oshi.wordHTML('pop', 90)));

/* =============================================================================
 * T2 指名の保存と復元
 * ========================================================================== */
section('T2 指名の保存と復元（manager.oshi）');

function reset() { W.localStorage.removeItem(LS_KEY); L.setState(null); L.newSeason(MY); }
reset();

check('_leagueOshiHost が公開されている', !!W._leagueOshiHost && typeof W._leagueOshiHost.squad === 'function');
const squad = W._leagueOshiHost.squad();
check('自クラブのスカッドが引ける', !!(squad && squad.players && squad.players.length > 10));
const p0 = squad.players[0], p1 = squad.players[1];
const k0 = W._leagueOshiHost.key(p0), k1 = W._leagueOshiHost.key(p1);

check('初期状態は未指名', Oshi.get() === null);
check('未指名でも hubRow は「指名する」導線を返す', /oshiOpenPicker/.test(Oshi.hubRow()));
Oshi.set(k0);
check('指名すると get() が返る', !!Oshi.get() && Oshi.get().key === k0);
check('manager.oshi に載る（seasonMeta ではない＝季を跨いで残る側）',
  !!L.getState().manager.oshi && L.getState().manager.oshi.key === k0);
check('指名したクラブIDも一緒に記録される', L.getState().manager.oshi.clubId === MY);
check('hubRow に推しの名前が出る', Oshi.hubRow().indexOf(p0.name) >= 0);
Oshi.set(k1);
check('指名し直せる（1人だけ）', Oshi.get().key === k1 && L.getState().manager.oshi.key === k1);
Oshi.set(k1);
check('同じ選手の再指名は冪等', Oshi.get().key === k1);

L.save(); L.setState(null); L.load();
check('セーブ→再ロードで指名が戻る', Oshi.get() && Oshi.get().key === k1);
check('セーブ版数は上がらない（v4 のまま）', L.getState().version === L.SAVE_VERSION);

// 別クラブへ移った時（解任・移籍）は推しを置いていく
const keep = JSON.parse(W.localStorage.getItem(LS_KEY));
L.getState().myClub = 'france2026';
check('クラブが変われば指名は自動失効（別クラブの選手を推さない）', Oshi.get() === null);
check('失効中は hubRow が「指名する」に戻る', /oshiOpenPicker/.test(Oshi.hubRow()));
L.getState().myClub = MY;
check('元のクラブに戻れば指名も戻る', Oshi.get() && Oshi.get().key === k1);

Oshi.clear();
check('解除できる', Oshi.get() === null && L.getState().manager.oshi === undefined);
Oshi.set(k0);

/* =============================================================================
 * T3 / T4 「推しの今日」カードの出し分け
 * ========================================================================== */
section('T3/T4 推しの今日カード（出場した試合だけ）');

/** 実データと同じ形の lastResult を組む（_rateMatch / _computeMatchStats 由来の形）。 */
function lrWith(ratings, opt) {
  opt = opt || {};
  return {
    round: 3,
    mine: { me: MY, opp: 'france2026', ms: opt.ms != null ? opt.ms : 2, os: opt.os != null ? opt.os : 1,
      res: opt.res || 'W', home: true, mom: null, scorers: [] },
    ratings: ratings,
    stats: { duels1: opt.duels || [{ name: p0.name, w: 5, l: 2 }] },
    manager: { trained: opt.trained || [] }
  };
}
const rtFull = {};
rtFull[k0] = { name: p0.name, group: 'FW', rating: 8.4, goals: 2, assists: 1 };

check('未指名ならカードを出さない', (() => {
  Oshi.clear();
  const r = Oshi.todayPanel(lrWith(rtFull));
  Oshi.set(k0);
  return r === null;
})());
check('推しが出場していない試合はカードを出さない', Oshi.todayPanel(lrWith({})) === null);
check('ratings が無い（旧形式の lastResult）ならカードを出さない',
  Oshi.todayPanel({ round: 1, mine: { me: MY, opp: 'x', ms: 0, os: 0, res: 'D' } }) === null);
check('lr そのものが無くても落ちない', Oshi.todayPanel(null) === null);

const panel = Oshi.todayPanel(lrWith(rtFull));
check('出場した試合はカードが出る', !!panel && panel.id === 'oshi');
check('html は関数（表示の瞬間に組む＝会見や成長が数字に乗る）', typeof panel.html === 'function');

const html = panel.html();
check('推しの名前が載る', html.indexOf(p0.name) >= 0);
check('評価点が載る', /8\.4/.test(html));
check('評価点の言葉（圧巻の出来）が併記される', /圧巻の出来/.test(html));
check('ゴール数が載る', /ゴール/.test(html) && />2</.test(html));
check('アシストが載る', /アシスト/.test(html));
check('デュエルの勝敗が載る', /デュエル/.test(html) && /5<em>-<\/em>2/.test(html));
check('シーズン累計がまだ無い選手では累計行を出さない（0並びを見せない）', !/今季/.test(html));
// 実プレイでは _recordTeamCarryover が出場のたびに apps/goals/assists を積む。その状態を再現する。
L.getState().squads = L.getState().squads || {};
L.getState().squads[MY] = L.getState().squads[MY] || {};
L.getState().squads[MY][k0] = { apps: 4, goals: 3, assists: 2, trust: 50, growth: {}, injuryOut: 0, suspendOut: 0 };
const html2 = Oshi.todayPanel(lrWith(rtFull)).html();
check('今季累計の行が出る（出場4・3G・2A）',
  /今季/.test(html2) && />4</.test(html2) && />3</.test(html2) && />2</.test(html2));
check('アーカタイプのバッジが載る（archetype.js 連携）', /lg-oshi-badge/.test(html));
check('スカウトの一言が載る', /lg-oshi-scout/.test(html));
check('トーンがカードに載る', /lg-oshi-card tone-great/.test(html));
check('2得点なら見出しが「今日の主役」', /今日の主役/.test(html));

check('同じ入力なら何度組んでも同じHTML（スカウト一言まで決定論）',
  Oshi.todayPanel(lrWith(rtFull)).html() === html2);

// 得点なし・低評価のときの言い回し（負けを慰めない・事実を書く）
const rtBad = {}; rtBad[k0] = { name: p0.name, group: 'FW', rating: 5.0, goals: 0, assists: 0 };
const badHTML = Oshi.todayPanel(lrWith(rtBad, { res: 'L', ms: 0, os: 2 })).html();
check('低評価は「精彩を欠いた」', /精彩を欠いた/.test(badHTML));
check('低評価の見出しは慰めない', /忘れたい90分/.test(badHTML));
check('ゴール0ならゴールのチップを出さない', badHTML.indexOf('>0<') < 0 || !/ゴール/.test(badHTML));
check('低評価のトーンが載る', /lg-oshi-card tone-bad/.test(badHTML));

// 個別練習で伸びた週
const grown = Oshi.todayPanel(lrWith(rtFull, { trained: [{ name: p0.name, paramName: 'シュート精度', gain: 2 }] })).html();
check('今週の個別練習で伸びていれば成長行が出る', /シュート精度/.test(grown) && /\+2/.test(grown));
check('他人の成長は載らない', !/lg-oshi-grow/.test(
  Oshi.todayPanel(lrWith(rtFull, { trained: [{ name: p1.name, paramName: 'タックル', gain: 2 }] })).html()));

// 英語
W.LANG = 'en';
const enHTML = Oshi.todayPanel(lrWith(rtFull)).html();
W.LANG = 'ja';
check('英語でもカードが成立する（i18n）',
  /YOUR PLAYER TODAY/.test(enHTML) && /Rating/.test(enHTML) && !/評価点/.test(enHTML));

/* =============================================================================
 * T5 キルスイッチ
 * ========================================================================== */
section('T5 キルスイッチ（window.MTG1_OSHI === false）');

const before = JSON.stringify(L.getState().manager.oshi);
W.MTG1_OSHI = false;
check('todayPanel が null（＝デッキに1枚も足さない）', Oshi.todayPanel(lrWith(rtFull)) === null);
check('hubRow が空文字（＝監督カードは従来の見た目）', Oshi.hubRow() === '');
check('wordOf が null（＝league.js は従来の数字表示に戻る）', Oshi.wordOf('pop', 90) === null);
check('wordHTML も空文字', Oshi.wordHTML('trust', 90) === '');
check('get() も null', Oshi.get() === null);
check('enabled() が false', Oshi.enabled() === false);
Oshi.set(k1); Oshi.clear();
check('キルOFF中は保存を書き換えない', JSON.stringify(L.getState().manager.oshi) === before);
check('モーダルも開かない', Oshi.openPicker() === false);
W.MTG1_OSHI = true;
check('戻せば再び有効', Oshi.enabled() === true && !!Oshi.get());

/* =============================================================================
 * T6 後方互換
 * ========================================================================== */
section('T6 後方互換（oshi フィールドが無い旧セーブ）');

W.localStorage.setItem(LS_KEY, JSON.stringify(keep));
L.setState(null); L.load();
delete L.getState().manager.oshi;
L.save(); L.setState(null); L.load();
check('manager.oshi が無いセーブを読み込める', !!L.getState());
check('oshi 無しでも進行データは無傷', L.getState().myClub === MY && typeof L.getState().round === 'number');
check('oshi 無しなら未指名として扱う', Oshi.get() === null);
check('oshi 無しでも hubRow が落ちない', typeof Oshi.hubRow() === 'string');
check('oshi 無しでもカードは出さない', Oshi.todayPanel(lrWith(rtFull)) === null);
check('読むだけでは manager.oshi を生やさない（保存を汚さない）',
  L.getState().manager.oshi === undefined);

// 居なくなった選手を推していた場合（移籍・引退）
Oshi.set('この選手はもういない');
check('スカッドに居ない推しならカードを出さない', Oshi.todayPanel(lrWith(rtFull)) === null);
check('スカッドに居ない推しでも hubRow は落ちない（指名導線に戻る）',
  /oshiOpenPicker/.test(Oshi.hubRow()));

// 状態が無い（クラブ未選択）
L.setState(null);
check('セーブが無い時 get は null', Oshi.get() === null);
check('セーブが無い時 hubRow は空文字', Oshi.hubRow() === '');
check('セーブが無い時 todayPanel は null', Oshi.todayPanel(lrWith(rtFull)) === null);
check('セーブが無い時でも wordOf は使える（純関数・表示層）', !!Oshi.wordOf('pop', 50));

/* ── 結果 ─────────────────────────────────────────────────────── */
console.log('\n' + (fail === 0 ? '✅ PASS' : '❌ FAIL') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
