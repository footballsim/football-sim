#!/usr/bin/env node
/**
 * mtg1-attribution-test.js — MTG1-#1「采配の答え合わせパック」(js/attribution.js) の機械検証。
 *
 * ★ 2026-08-04: 「攻め筋に対策する」機能（📹ビデオ対策 / 🧑‍🏫HT助言）の廃止に伴い、
 *   その2行のジャッジと対策トーストの検証を削除。代わりに「対策フックが完全に消えたこと」
 *   （記録に manager 係数 g が載らない）と、マークマン行の判定を厚くして穴を埋めた。
 *
 * 検証項目:
 *   T1 rng不変: 同一シードの playMatch が「記録ON」と「記録OFF」で完全一致
 *      （attribution は rng を新規消費せず、判定にも一切影響しないことの証明）。
 *   T2 記録: リーグ相当のコンテキストで係数読み取り（mental/fatigue）が記録され、
 *      judge が動くこと。廃止した manager 対策係数はもう記録されないこと。
 *   T3 キルスイッチ: window.MTG1_ANSWER === false で記録・表示とも完全無効。
 *   T4 ジャッジ判定: 合成データで「刺さった / 効かなかった / 判定不能」が意図通り。
 *      交代・戦術変更の検出（チャンス境界の lineup/tactics 差分）も確認。
 *   T5 トースト: 決定的瞬間（キープレイヤーのゴール／鼓舞後のゴール）で発火・
 *      同一ビート/チャンスは重複なし・1試合最大3回・キルOFFで無効。
 *
 * 使い方: node tools/mtg1-attribution-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// ★ window を vm の global そのものにする（ブラウザ同様 window.X 代入＝グローバル関数になる）。
//   load-engine.js の stub は const window={} なので typeof 連携（managerParamFactor 等）が
//   headless では切れる。本テストは「seam が実際に繋がった状態」を検証したいので自前 stub を使う。
const FILES = ['players.js', 'rng.js', 'mental.js', 'discipline.js', 'simulate.js', 'events.js', 'match.js', 'attribution.js'];

const STUB = `
class URLSearchParams{constructor(s){}get(k){return null;}}
const _elStub={textContent:"",innerHTML:"",value:"",style:{},dataset:{},classList:{add:()=>{},remove:()=>{},toggle:()=>{},contains:()=>false},appendChild:()=>{},removeChild:()=>{},setAttribute:()=>{},getAttribute:()=>null,addEventListener:()=>{},querySelector:()=>null,querySelectorAll:()=>[],getContext:()=>null,focus:()=>{},remove:()=>{}};
const document={getElementById:()=>(_elStub),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>(Object.assign({},_elStub)),createElementNS:()=>(Object.assign({},_elStub)),body:{appendChild:()=>{},classList:{add:()=>{},remove:()=>{}}},documentElement:{style:{},classList:{add:()=>{},remove:()=>{}}},addEventListener:()=>{},head:{appendChild:()=>{}}};
const localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const sessionStorage={getItem:()=>null,setItem:()=>{}};
const firebase={initializeApp:()=>{},firestore:()=>({collection:()=>({doc:()=>({get:()=>Promise.resolve({exists:false,data:()=>({})}),set:()=>Promise.resolve(),update:()=>Promise.resolve()})})})};
const gtag=()=>{};
const alert=()=>{};
const confirm=()=>true;
`;

// 同一スクリプトの let/const（chanceResults 等）へ後続スクリプトから触るための橋。
const BRIDGE = `
window.__mtg1 = {
  setChanceResults: function (v) { chanceResults = v; },
  state: function () { return _abState; },
  begin: attributionBeginMatch,
  end: attributionEndMatch,
  rec: attributionRecord,
  chanceEnd: attributionOnChanceEnd,
  judge: attributionJudge,
  panel: attributionJudgePanel,
  beat: attributionOnBeat,
  playMatch: playMatch,
  TEAM_DATA: TEAM_DATA,
  HALF: HALF_CHANCES
};
`;

function makeCtx() {
  const sandbox = {
    Math, console, parseInt, parseFloat, isNaN, isFinite,
    setTimeout: (fn) => fn(), clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    Promise, JSON, Object, Array, String, Number, Boolean, Date, RegExp, Error,
  };
  sandbox.window = sandbox;               // ブラウザ同様 window === グローバル
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.location = { hash: '', search: '' };
  sandbox.matchMedia = () => ({ matches: false, addEventListener: () => {} });
  sandbox.navigator = { language: 'ja' };
  vm.createContext(sandbox);
  let code = STUB + '\n';
  for (const f of FILES) code += fs.readFileSync(path.join(ROOT, 'js', f), 'utf8') + '\n';
  code += BRIDGE;
  vm.runInContext(code, sandbox, { filename: 'mtg1-concat.js' });
  return sandbox;
}

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (detail !== undefined ? ' — ' + detail : '')); }
}

/* 試合の比較シグネチャ（seed-repro と同思想: イベント列＋スコアの完全一致） */
function sig(r) {
  return JSON.stringify({
    score: r.result, n: r.n,
    ev: r.events.map(e => [e.type, e.minute, e.team, e.player && e.player.name])
  });
}

/* ── T1: rng不変（記録ON/OFFで同一シードの試合が完全一致） ─────────────── */
console.log('T1 rng不変（同一シード・記録ON vs OFF）');
{
  const seed = 20260803;
  const off = makeCtx();  // begin しない＝記録OFF（非リーグと同じ状態）
  const r1 = off.__mtg1.playMatch(off.__mtg1.TEAM_DATA.japan2026vsNetherlands, off.__mtg1.TEAM_DATA.netherlands2026, null, seed);

  const on = makeCtx();
  on.__mtg1.begin(function () { return { ht: null }; });
  const r2 = on.__mtg1.playMatch(on.__mtg1.TEAM_DATA.japan2026vsNetherlands, on.__mtg1.TEAM_DATA.netherlands2026, null, seed);

  ok(sig(r1) === sig(r2), '記録ONでもイベント列・スコアが完全一致（rng新規消費ゼロ）',
     sig(r1).slice(0, 80) + ' vs ' + sig(r2).slice(0, 80));
  const st = on.__mtg1.state();
  ok(st && st.chances.length === r2.n, '全チャンスがグルーピングされた', st && st.chances.length + ' != ' + r2.n);
  const totalRecs = st ? st.chances.reduce((s, c) => s + c.recs.length, 0) : 0;
  ok(totalRecs > 0, '係数読み取りが記録された（自チーム分 ' + totalRecs + ' 件）');
}

/* ── T2: 係数読み取りの記録（mental/fatigue のみ）＋対策フックの撤去確認 ───── */
console.log('T2 係数内訳の記録');
{
  const c = makeCtx();
  c.__mtg1.begin(function () { return { ht: null }; });
  c.__mtg1.playMatch(c.__mtg1.TEAM_DATA.japan2026vsNetherlands, c.__mtg1.TEAM_DATA.netherlands2026, null, 777);
  c.__mtg1.end();
  const st = c.__mtg1.state();
  let recs = 0, badShape = 0, hasG = 0;
  st.chances.forEach(ch => ch.recs.forEach(r => {
    recs++;
    if (typeof r.m !== 'number' || typeof r.fg !== 'number' || typeof r.f !== 'number') badShape++;
    if ('g' in r) hasG++;
  }));
  ok(recs > 0, '係数読み取りが記録された（' + recs + ' 件）');
  ok(badShape === 0, '各記録は f / mental / fatigue の内訳を持つ', badShape + ' 件が不正な形');
  // 廃止した「攻め筋対策」の係数（managerParamFactor）はもう読まない＝記録にも残らない
  ok(hasG === 0, '廃止した manager 対策係数(g)は記録されない', hasG + ' 件に g が残っている');
  ok(typeof c.managerParamFactor === 'undefined',
     'league 非同梱の headless では managerParamFactor は未定義（typeof ガードで no-op）');
  const j = c.__mtg1.judge();
  ok(!!j && j.items.some(it => it.kind === 'keyplayer'), '実試合データから keyplayer ジャッジが出る');
  const kitem = j && j.items.find(it => it.kind === 'keyplayer');
  ok(kitem && ['hit', 'miss', 'na'].indexOf(kitem.verdict) >= 0 && kitem.line.length > 0,
     'ジャッジは verdict＋事実の言い換え1行を持つ', kitem && (kitem.verdict + ' / ' + kitem.line));
  const html = c.__mtg1.panel();
  ok(typeof html === 'string' && html.indexOf('監督のジャッジ') >= 0 && html.indexOf('lg-card') >= 0,
     'ジャッジカードHTML（lg-card 形式）が生成される');
}

/* ── T3: キルスイッチ（window.MTG1_ANSWER === false で完全無効） ─────────── */
console.log('T3 キルスイッチ');
{
  const c = makeCtx();
  c.MTG1_ANSWER = false;
  c.__mtg1.begin(function () { return { ht: null }; });
  ok(c.__mtg1.state() === null, 'キルOFF中は begin しても記録が始まらない');
  c.__mtg1.playMatch(c.__mtg1.TEAM_DATA.japan2026vsNetherlands, c.__mtg1.TEAM_DATA.netherlands2026, null, 42);
  ok(c.__mtg1.state() === null, 'キルOFF中は試合を回しても何も記録されない');
  ok(c.__mtg1.panel() === null, 'キルOFF中はジャッジカードも出ない');

  // 途中OFF: begin 後にスイッチを切ると以降の記録・表示が止まる
  const c2 = makeCtx();
  c2.__mtg1.begin(function () { return { ht: null }; });
  c2.MTG1_ANSWER = false;
  const t1 = { name: 'MY', players: [{ name: 'A' }], lineup: [0,0,0,0,0,0,0,0,0,0,0], score: 0, keyplayer: -1, marked_player: -1, tactics: 0 };
  c2.__mtg1.rec(t1, 0, 'ショートパス', 1.0);
  const st2 = c2.__mtg1.state();
  ok(st2 && st2._buf.length === 0, '途中でOFFにすると記録が止まる');
  ok(c2.__mtg1.panel() === null, '途中でOFFにすると表示も止まる');
}

/* ── T4: ジャッジ判定（合成データで意図通りの verdict） ─────────────────── */
console.log('T4 ジャッジ判定（合成シナリオ）');
function mkTeam(name, n) {
  const players = [];
  for (let i = 0; i < (n || 16); i++) players.push({ name: name + i });
  return { name: name, players: players, lineup: [0,1,2,3,4,5,6,7,8,9,10], score: 0,
           keyplayer: 9, marked_player: -1, tactics: 0 };
}
function duel(off, def, action, result, ofsPos, dfsPos) {
  return { offence: off, defence: def, action: action, result: result,
           ofsPos: ofsPos == null ? 5 : ofsPos, dfsPos: dfsPos == null ? 3 : dfsPos };
}
{
  // ① 刺さった: キープレイヤー(ofsPos9)がゴール ＋ 鼓舞後に後半のデュエル勝率が上昇
  const c = makeCtx();
  const t1 = mkTeam('MY'), t2 = mkTeam('OPP');
  const ht = { rouse: { tone: 'praise', up: 7, down: 1 }, advise: null };
  c.__mtg1.begin(function () { return { ht: ht }; });
  // 前半: 相手の突破を止める＋自分のデュエルは負け越し（勝率33%）
  c.__mtg1.chanceEnd(0, [
    duel(t2, t1, 'ドリブル突破', '失敗'), duel(t2, t1, 'ドリブル突破', '失敗'),
    duel(t1, t2, 'ショートパス', '失敗'), duel(t1, t2, 'ポストプレー', '失敗'), duel(t1, t2, 'クロス', '成功')
  ], t1, t2);
  c.__mtg1.chanceEnd(1, [
    duel(t2, t1, 'ドリブル突破', '失敗'), duel(t2, t1, 'ドリブル突破', '成功'), duel(t2, t1, 'ドリブル突破', '失敗')
  ], t1, t2);
  // 後半(no>=16): 自分のデュエル勝ち越し（勝率75%）＋キープレイヤーのゴール
  c.__mtg1.chanceEnd(16, [
    duel(t1, t2, 'ショートパス', '成功'), duel(t1, t2, 'ドリブル突破', '成功'), duel(t1, t2, 'クロス', '失敗')
  ], t1, t2);
  c.__mtg1.chanceEnd(17, [ duel(t1, t2, '飛び出し', '成功', 9), duel(t1, t2, '中央からシュート', 'ゴール！！', 9) ], t1, t2);
  c.__mtg1.end();
  const j = c.__mtg1.judge();
  const by = {}; j.items.forEach(it => { by[it.kind] = it; });
  ok(!by.video && !by.advice, '廃止した📹ビデオ対策 / 🧑‍🏫HT助言の行は出ない',
     JSON.stringify(j.items.map(i => i.kind)));
  ok(by.keyplayer && by.keyplayer.verdict === 'hit', 'キープレイヤー: ゴール → 刺さった', by.keyplayer && by.keyplayer.verdict);
  ok(by.rouse && by.rouse.verdict === 'hit', '鼓舞: 後半勝率 33%→75% → 刺さった', by.rouse && by.rouse.verdict);
  const html = c.__mtg1.panel();
  ok(html.indexOf('刺さった') >= 0, 'カードに verdict バッジが載る');

  // ② 効かなかった: 指名したマークマン（相手 players[5]）に 4回中3回やられる（正直に言い切る）
  const cm = makeCtx();
  const m1 = mkTeam('MY'), m2 = mkTeam('OPP');
  m1.marked_player = 5;   // ★ 相手の players 配列の index（lineup=[0..10] なので枠5に居る＝有効）
  cm.__mtg1.begin(function () { return { ht: null }; });
  cm.__mtg1.chanceEnd(0, [
    duel(m2, m1, 'ドリブル突破', '成功', 5), duel(m2, m1, 'ドリブル突破', '成功', 5),
    duel(m2, m1, 'ドリブル突破', '成功', 5), duel(m2, m1, 'ドリブル突破', '失敗', 5)
  ], m1, m2);
  cm.__mtg1.end();
  const jm = cm.__mtg1.judge();
  const vm_ = jm.items.find(it => it.kind === 'marked');
  ok(vm_ && vm_.verdict === 'miss', 'マークマン: 4回中3回やられた → 効かなかった（正直）', vm_ && vm_.verdict);
  ok(vm_ && vm_.line.indexOf('効かなかった') >= 0, '「効かなかった」と言い切る文言');

  // ③ 判定不能: 指名したマークマンにボールが入らなかった
  const cn = makeCtx();
  const n1 = mkTeam('MY'), n2 = mkTeam('OPP');
  n1.marked_player = 5;
  cn.__mtg1.begin(function () { return { ht: null }; });
  cn.__mtg1.chanceEnd(0, [ duel(n2, n1, 'ショートパス', '成功', 6) ], n1, n2);
  cn.__mtg1.end();
  const jn = cn.__mtg1.judge();
  const vn = jn.items.find(it => it.kind === 'marked');
  ok(vn && vn.verdict === 'na', 'マークマン: ボールが入らず(0回) → 判定不能', vn && vn.verdict);

  // ④ 交代・戦術変更の検出（チャンス境界の lineup/tactics 差分）＋投入選手のゴール → 刺さった
  const cs = makeCtx();
  const s1 = mkTeam('MY'), s2 = mkTeam('OPP');
  cs.__mtg1.begin(function () { return { ht: null }; });
  cs.__mtg1.chanceEnd(0, [ duel(s1, s2, 'ショートパス', '成功') ], s1, s2);
  s1.lineup[4] = 12;      // 交代: pos4 に控え12を投入
  s1.tactics = 2;         // 戦術変更
  cs.__mtg1.chanceEnd(1, [ duel(s1, s2, '中央からシュート', 'ゴール！！', 4) ], s1, s2);
  cs.__mtg1.end();
  const js_ = cs.__mtg1.judge();
  const sub = js_.items.find(it => it.kind === 'sub');
  const tac = js_.items.find(it => it.kind === 'tactic');
  ok(sub && sub.verdict === 'hit' && sub.label.indexOf('MY12') >= 0, '交代検出＋投入選手のゴール → 刺さった', sub && (sub.verdict + '/' + sub.label));
  ok(!!tac, '戦術変更が検出されジャッジ対象になる', JSON.stringify(js_.items.map(i => i.kind)));

  // ⑤ 介入ゼロの試合はカード自体を出さない
  const cz = makeCtx();
  const z1 = mkTeam('MY'), z2 = mkTeam('OPP');
  z1.keyplayer = -1;      // 指名なし
  cz.__mtg1.begin(function () { return { ht: null }; });
  cz.__mtg1.chanceEnd(0, [ duel(z1, z2, 'ショートパス', '成功') ], z1, z2);
  cz.__mtg1.end();
  ok(cz.__mtg1.panel() === null, '介入なし → ジャッジカードなし（空カードを出さない）');
}

/* ── T5: トースト（発火・重複なし・最大3回・キルOFF無効） ────────────────── */
console.log('T5 トースト');
{
  const c = makeCtx();
  const t1 = mkTeam('MY'), t2 = mkTeam('OPP');
  c.__mtg1.begin(function () { return { ht: { rouse: { tone: 'praise', up: 6, down: 0 } } }; });
  c.__mtg1.chanceEnd(0, [ duel(t1, t2, 'ショートパス', '成功') ], t1, t2);   // team1 確定用

  const toasts = [];
  const toastFn = (m) => toasts.push(m);
  const crs = [];
  // chance0: 廃止した対策トーストの素材（何も出ないこと）/ chance1: キープレイヤーのゴール
  // chance17-19: 鼓舞後（後半＝16以降）のゴール
  crs[0] = { scenes: [ duel(t2, t1, 'ドリブル突破', '失敗') ] };
  crs[1] = { scenes: [ duel(t1, t2, '中央からシュート', 'ゴール！！', 9) ] };
  crs[17] = { scenes: [ duel(t1, t2, '中央からシュート', 'ゴール！！', 5) ] };
  crs[18] = { scenes: [ duel(t1, t2, '中央からシュート', 'ゴール！！', 5) ] };
  crs[19] = { scenes: [ duel(t1, t2, '中央からシュート', 'ゴール！！', 5) ] };
  c.__mtg1.setChanceResults(crs);

  c.__mtg1.beat(0, 0, toastFn);
  ok(toasts.length === 0, '廃止した「📹対策が刺さった」トーストはもう出ない', JSON.stringify(toasts));
  c.__mtg1.beat(1, 0, toastFn);
  ok(toasts.length === 1 && toasts[0].indexOf('⭐') === 0, 'キープレイヤーのゴールでトースト', toasts[0]);
  c.__mtg1.beat(1, 0, toastFn);
  ok(toasts.length === 1, '同一ビートの再表示（分割ビート）では重複しない');
  c.__mtg1.beat(17, 0, toastFn);
  ok(toasts.length === 2 && toasts[1].indexOf('🗣') === 0, '鼓舞後の後半ゴールでトースト', toasts[1]);
  c.__mtg1.beat(18, 0, toastFn);
  ok(toasts.length === 3, '別チャンスなら次のトーストが出る', toasts.length + ' 回');
  c.__mtg1.beat(19, 0, toastFn);
  ok(toasts.length === 3, '1試合最大3回で打ち止め（1画面1ビート）', toasts.length + ' 回');

  // キルOFF
  const ck = makeCtx();
  const k1 = mkTeam('MY'), k2 = mkTeam('OPP');
  ck.__mtg1.begin(function () { return { ht: null }; });
  ck.__mtg1.chanceEnd(0, [ duel(k1, k2, 'ショートパス', '成功') ], k1, k2);
  ck.MTG1_ANSWER = false;
  const kt = [];
  ck.__mtg1.setChanceResults([{ scenes: [ duel(k1, k2, '中央からシュート', 'ゴール！！', 9) ] }]);
  ck.__mtg1.beat(0, 0, (m) => kt.push(m));
  ok(kt.length === 0, 'キルOFF中はトーストも出ない');
}

console.log('');
console.log('結果: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
