#!/usr/bin/env node
/**
 * mtg1-dramascore-test.js — MTG1-#2「ドラマスコア×演出ティア×可変テンポ」(js/dramascore.js) の機械検証。
 *
 * 検証項目:
 *   T1 決定論: 同じ確定シーン列を何度採点しても、また別プロセス相当の新規コンテキストでも、
 *      スコア・ティア列が完全一致（rng 不使用の証明）。
 *   T2 ティア分布: 実試合データ（playMatch × 複数シード）で Tier3 が平均1〜3回/試合、
 *      Tier2 が平均3〜6回/試合の目安に収まり、キャップ（3/6）を超えないこと。
 *   T3 キルスイッチ: window.MTG1_DRAMA === false で dramaOnBeat→0・dramaBeatScale→1.0・
 *      FX 発火カウントがゼロ。
 *   T4 尺倍率: Tier1=85〜90%短縮 / Tier2・3=タメ（>1.0）/ 分割中の非最終ビートは 1.0。
 *   T5 rng不変: ドラマ採点を挟んでも次の seeded playMatch の結果が完全一致
 *      （表示層が rng を新規消費しない証明）。
 *
 * 使い方: node tools/mtg1-dramascore-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['players.js', 'rng.js', 'mental.js', 'discipline.js', 'simulate.js', 'events.js', 'match.js', 'dramascore.js'];

// ★ document.getElementById は null を返す＝FX は入口カウント（_dramaFxCount）だけ増えて no-op。
const STUB = `
class URLSearchParams{constructor(s){}get(k){return null;}}
const _elStub={textContent:"",innerHTML:"",value:"",style:{},dataset:{},classList:{add:()=>{},remove:()=>{},toggle:()=>{},contains:()=>false},appendChild:()=>{},removeChild:()=>{},setAttribute:()=>{},getAttribute:()=>null,addEventListener:()=>{},querySelector:()=>null,querySelectorAll:()=>[],getContext:()=>null,focus:()=>{},remove:()=>{}};
const document={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>(Object.assign({},_elStub)),createElementNS:()=>(Object.assign({},_elStub)),body:{appendChild:()=>{},classList:{add:()=>{},remove:()=>{}}},documentElement:{style:{},classList:{add:()=>{},remove:()=>{}}},addEventListener:()=>{},head:{appendChild:()=>{}}};
const localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const sessionStorage={getItem:()=>null,setItem:()=>{}};
const firebase={initializeApp:()=>{},firestore:()=>({collection:()=>({doc:()=>({get:()=>Promise.resolve({exists:false,data:()=>({})}),set:()=>Promise.resolve(),update:()=>Promise.resolve()})})})};
const gtag=()=>{};
const alert=()=>{};
const confirm=()=>true;
`;

// 同一スクリプトの let/const（chanceResults 等）へ後続から触る橋。
const BRIDGE = `
window.__mtg1 = {
  setChanceResults: function (v) { chanceResults = v; },
  playMatch: playMatch,
  TEAM_DATA: TEAM_DATA,
  N: MATCH_CHANCES,
  begin: dramaBeginMatch,
  note: dramaNoteIntervention,
  beat: dramaOnBeat,
  scale: dramaBeatScale,
  score: dramaScoreBeat,
  state: _dramaState
};
`;

function makeCtx() {
  const sandbox = {
    Math, console, parseInt, parseFloat, isNaN, isFinite,
    setTimeout: (fn) => fn(), clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    Promise, JSON, Object, Array, String, Number, Boolean, Date, RegExp, Error,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.location = { hash: '', search: '' };
  sandbox.matchMedia = () => ({ matches: false, addEventListener: () => {} });
  sandbox.navigator = { language: 'ja' };
  vm.createContext(sandbox);
  let code = STUB + '\n';
  for (const f of FILES) code += fs.readFileSync(path.join(ROOT, 'js', f), 'utf8') + '\n';
  code += BRIDGE;
  vm.runInContext(code, sandbox, { filename: 'mtg1-drama-concat.js' });
  return sandbox;
}

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (detail !== undefined ? ' — ' + detail : '')); }
}

function sig(r) {
  return JSON.stringify({
    score: r.result, n: r.n,
    ev: r.events.map(e => [e.type, e.minute, e.team, e.player && e.player.name])
  });
}

/* 1試合ぶんの確定 chanceResults を「表示ビート順」で採点し、ティア列と回数を返す。 */
function replay(api, crs) {
  api.setChanceResults(crs);
  api.begin();
  const tiers = [];
  for (let c = 0; c < crs.length; c++) {
    const scs = crs[c].scenes || [];
    for (let s = 0; s < scs.length; s++) tiers.push(api.beat(c, s, true));
  }
  const st = api.state();
  return { tiers, t2: st.tier2Used, t3: st.tier3Used };
}

/* ── T1: 決定論（同一データ→同一スコア・同一ティア列） ──────────────────── */
console.log('T1 決定論（rng 不使用・同一データ→同一ティア列）');
{
  const seed = 20260803;
  const a = makeCtx();
  const r = a.__mtg1.playMatch(a.__mtg1.TEAM_DATA.japan2026vsNetherlands, a.__mtg1.TEAM_DATA.netherlands2026, null, seed);
  const crs = r.chanceResults;
  ok(Array.isArray(crs) && crs.length > 0, 'playMatch が chanceResults を返す（' + (crs && crs.length) + ' チャンス）');

  const p1 = replay(a.__mtg1, crs);
  const p2 = replay(a.__mtg1, crs);   // 同一コンテキストで再採点（begin でリセット）
  ok(JSON.stringify(p1.tiers) === JSON.stringify(p2.tiers), '同一コンテキストの再採点でティア列が完全一致');

  // 新規コンテキスト＝別プロセス相当。同シードの試合→同ティア列。
  const b = makeCtx();
  const rb = b.__mtg1.playMatch(b.__mtg1.TEAM_DATA.japan2026vsNetherlands, b.__mtg1.TEAM_DATA.netherlands2026, null, seed);
  ok(sig(r) === sig(rb), '同シードの playMatch が一致（前提の確認）');
  const p3 = replay(b.__mtg1, rb.chanceResults);
  ok(JSON.stringify(p1.tiers) === JSON.stringify(p3.tiers), '新規コンテキストでもティア列が完全一致（決定論）');

  // スコア関数の純関数性: 同ビートを2回採点して同値
  const s1 = a.__mtg1.score(0, 0), s2 = a.__mtg1.score(0, 0);
  ok(s1 === s2 && typeof s1 === 'number', 'dramaScoreBeat は純関数（同入力→同値 ' + s1 + '）');
}

/* ── T2: ティア分布（実試合データ・複数シード平均） ─────────────────────── */
console.log('T2 ティア分布（目安: Tier3=1〜3回/試合・Tier2=3〜6回/試合）');
{
  const api = makeCtx().__mtg1;
  const MATCH_PAIRS = [
    ['japan2026vsNetherlands', 'netherlands2026'],
    ['england2026', 'brazil2026'],
    ['spain2026', 'france2026'],
    ['germany2026', 'argentina2026'],
  ];
  let sum2 = 0, sum3 = 0, max2 = 0, max3 = 0, min3 = 99, games = 0;
  for (let seed = 1; seed <= 10; seed++) {
    for (const [k1, k2] of MATCH_PAIRS) {
      const r = api.playMatch(api.TEAM_DATA[k1], api.TEAM_DATA[k2], null, seed * 1000 + k1.length);
      const p = replay(api, r.chanceResults);
      sum2 += p.t2; sum3 += p.t3;
      max2 = Math.max(max2, p.t2); max3 = Math.max(max3, p.t3); min3 = Math.min(min3, p.t3);
      games++;
    }
  }
  const avg2 = sum2 / games, avg3 = sum3 / games;
  console.log('     実測: ' + games + '試合  Tier2 avg=' + avg2.toFixed(2) + ' max=' + max2 +
              '  Tier3 avg=' + avg3.toFixed(2) + ' max=' + max3 + ' min=' + min3);
  ok(avg3 >= 1 && avg3 <= 3, 'Tier3 平均が 1〜3回/試合（' + avg3.toFixed(2) + '）');
  ok(avg2 >= 3 && avg2 <= 6, 'Tier2 平均が 3〜6回/試合（' + avg2.toFixed(2) + '）');
  ok(max3 <= 3, 'Tier3 はキャップ3を超えない（max=' + max3 + '）');
  ok(max2 <= 6, 'Tier2 はキャップ6を超えない（max=' + max2 + '）');
}

/* ── T3: キルスイッチ（MTG1_DRAMA === false で完全無効） ─────────────────── */
console.log('T3 キルスイッチ');
{
  const c = makeCtx();
  const r = c.__mtg1.playMatch(c.__mtg1.TEAM_DATA.japan2026vsNetherlands, c.__mtg1.TEAM_DATA.netherlands2026, null, 42);
  c.MTG1_DRAMA = false;
  c.__mtg1.setChanceResults(r.chanceResults);
  c.__mtg1.begin();
  let nonZero = 0, badScale = 0;
  for (let ci = 0; ci < r.chanceResults.length; ci++) {
    const scs = r.chanceResults[ci].scenes || [];
    for (let si = 0; si < scs.length; si++) {
      if (c.__mtg1.beat(ci, si, true) !== 0) nonZero++;
      if (c.__mtg1.scale(scs[si]) !== 1.0) badScale++;
    }
  }
  ok(nonZero === 0, 'キルOFF中は全ビートで tier=0（' + nonZero + ' 件の漏れ）');
  ok(badScale === 0, 'キルOFF中は全ビートで倍率 1.0（' + badScale + ' 件の漏れ）');
  ok(c._dramaFxCount === 0, 'キルOFF中は FX 発火ゼロ（count=' + c._dramaFxCount + '）');
  ok(c.__mtg1.score(0, 0) === 0, 'キルOFF中は採点も 0');

  // ON では FX 入口カウントが実際に増える（headless では DOM 無しの入口 no-op）
  const on = makeCtx();
  const ron = on.__mtg1.playMatch(on.__mtg1.TEAM_DATA.japan2026vsNetherlands, on.__mtg1.TEAM_DATA.netherlands2026, null, 42);
  replay(on.__mtg1, ron.chanceResults);
  ok(on._dramaFxCount > 0, 'キルON では FX が発火する（count=' + on._dramaFxCount + '）');
}

/* ── T4: ビート尺倍率 ──────────────────────────────────────────────────── */
console.log('T4 ビート尺倍率（Tier1=85〜90% / Tier2・3=タメ / 分割中=等倍）');
{
  const c = makeCtx();
  const r = c.__mtg1.playMatch(c.__mtg1.TEAM_DATA.japan2026vsNetherlands, c.__mtg1.TEAM_DATA.brazil2026, null, 7);
  const crs = r.chanceResults;
  c.__mtg1.setChanceResults(crs);
  c.__mtg1.begin();
  let t1Scale = null, hiTier = null, hiScaleFinal = null, hiScaleMid = null;
  for (let ci = 0; ci < crs.length; ci++) {
    const scs = crs[ci].scenes || [];
    for (let si = 0; si < scs.length; si++) {
      const tier = c.__mtg1.beat(ci, si, true);
      const sc = c.__mtg1.scale(scs[si]);
      if (tier === 1 && t1Scale === null) t1Scale = sc;
      if (tier >= 2 && hiTier === null) {
        hiTier = tier; hiScaleFinal = sc;
        // 同じシーンを「非最終ビート」として採点し直す（分割シュートのタメ相当）
        c.__mtg1.beat(ci, si, false);
        hiScaleMid = c.__mtg1.scale(scs[si]);
      }
    }
  }
  ok(t1Scale !== null && t1Scale >= 0.85 && t1Scale <= 0.90, 'Tier1 は 85〜90%（' + t1Scale + '）');
  ok(hiTier !== null && hiScaleFinal > 1.0, 'Tier' + hiTier + ' の結果打は >1.0（' + hiScaleFinal + '）');
  ok(hiScaleMid === 1.0, '分割中の非最終ビートは等倍 1.0（' + hiScaleMid + '）');
}

/* ── T5: rng不変（採点を挟んでも次の seeded 試合が不変） ─────────────────── */
console.log('T5 rng不変（ドラマ採点は rng を新規消費しない）');
{
  const withDrama = makeCtx();
  const w1 = withDrama.__mtg1.playMatch(withDrama.__mtg1.TEAM_DATA.japan2026vsNetherlands, withDrama.__mtg1.TEAM_DATA.netherlands2026, null, 111);
  replay(withDrama.__mtg1, w1.chanceResults);   // ← 採点＋FX入口を全ビートで実行
  const w2 = withDrama.__mtg1.playMatch(withDrama.__mtg1.TEAM_DATA.england2026, withDrama.__mtg1.TEAM_DATA.brazil2026, null, 222);

  const noDrama = makeCtx();
  const n1 = noDrama.__mtg1.playMatch(noDrama.__mtg1.TEAM_DATA.japan2026vsNetherlands, noDrama.__mtg1.TEAM_DATA.netherlands2026, null, 111);
  const n2 = noDrama.__mtg1.playMatch(noDrama.__mtg1.TEAM_DATA.england2026, noDrama.__mtg1.TEAM_DATA.brazil2026, null, 222);

  ok(sig(w1) === sig(n1), '1試合目が一致（前提）');
  ok(sig(w2) === sig(n2), 'ドラマ採点を挟んでも次の seeded 試合が完全一致（rng 消費ゼロ）');
}

console.log('');
console.log('結果: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
