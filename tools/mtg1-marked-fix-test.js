/**
 * mtg1-marked-fix-test.js — 🎯マーク対象の自動選択バグ修正（js/league.js `_validMarkedPlayer`）の検証。
 *
 * ★ 何が壊れていたか
 *   team1State.marked_player は「**相手チームの players 配列の index**」なのに、出どころの
 *   TEAM_DATA[x].default_marked_player は **対戦相手を問わないチーム単位の既定値**として
 *   持たれていた。相手が変われば同じ index が相手の先発XIに居ないことが普通に起きる
 *   （例: england2026.default_marked_player=10 → belgium2026.players[10]=ルカクは非先発）。
 *   simulate.js の判定は `offence.lineup[ofsPos] === team1.marked_player` の一致を見るため、
 *   ベンチの選手を指していると **一度も効かない＝死んだ采配** になっていた。
 *
 * 検証項目:
 *   T1 リーグ8クラブの総当り56通りで、マーク対象が必ず相手の先発XI（GK除く）に居る
 *   T2 決定論（同じ入力を2回流して完全一致・rng 不使用）
 *   T3 相手の default_keyplayer が先発XIに居ればそれが選ばれる
 *   T4 GK（lineup 枠0）は絶対に選ばれない
 *   T5 異常入力（null / 空 / 範囲外 / 壊れた lineup）でも例外を投げず -1 か有効値を返す
 *   T6 既に有効な指名は書き換えない（＝ユーザーの意思を尊重）
 *
 * 使い方: node tools/mtg1-marked-fix-test.js
 */
'use strict';
const { makeLeagueContext } = require('./lib/league-context.js');

const _c = makeLeagueContext();
const L = _c.L;
const TEAM_DATA = _c.TEAM_DATA;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail !== undefined ? '  → ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

const CLUBS = ['england2026', 'netherlands2026', 'spain2026', 'france2026',
               'argentina2026', 'italy2026', 'brazil2026', 'belgium2026'];

/* 実際の試合で渡るのと同じ「オーバーレイ適用済み clone」を作る（＝先発XIの正本）。 */
function oppData(id) {
  L.setState(null);
  L.newSeason(id);
  return L.overlaySquad(id);
}
// 総当りで毎回 newSeason すると重いので1回だけ作って使い回す
const OPP = {};
CLUBS.forEach(function (id) { OPP[id] = oppData(id); });

/* GK（枠0）を除く先発の player index 集合 */
function fieldStarters(td) {
  const set = new Set();
  for (let i = 1; i < Math.min(11, td.default_lineup.length); i++) set.add(td.default_lineup[i]);
  return set;
}

/* ── T1: 8クラブ総当り56通りで必ず相手の先発XI内 ────────────────────────── */
section('T1 リーグ8クラブの総当り56通り（修正前は19通り＝34%が先発XI外だった）');
{
  let total = 0, brokenBefore = 0, brokenAfter = 0, samples = [];
  CLUBS.forEach(function (myId) {
    CLUBS.forEach(function (oId) {
      if (myId === oId) return;
      total++;
      const td = OPP[oId];
      const starters = fieldStarters(td);
      const raw = TEAM_DATA[myId].default_marked_player;   // 修正前に渡っていた値
      if (!(typeof raw === 'number' && raw >= 0 && starters.has(raw))) {
        brokenBefore++;
        if (samples.length < 3) {
          samples.push(myId + ' vs ' + oId + ': players[' + raw + ']=' +
            ((td.players[raw] && td.players[raw].name) || '?') + ' は非先発');
        }
      }
      const fixed = L.validMarkedPlayer(td, raw);
      if (!starters.has(fixed)) brokenAfter++;
    });
  });
  check('総当りは56通り', total === 56, String(total));
  check('修正前は19通り（34%）で先発XI外だった（バグの再現）', brokenBefore === 19,
    brokenBefore + ' 通り / 例: ' + samples.join(' | '));
  check('修正後は56通りすべてでマーク対象が相手の先発XI（GK除く）に居る',
    brokenAfter === 0, brokenAfter + ' 通りが依然として XI 外');
}

/* ── T2: 決定論 ──────────────────────────────────────────────────────── */
section('T2 決定論（rng 不使用・2回流して完全一致）');
{
  function runAll() {
    const out = [];
    CLUBS.forEach(function (myId) {
      CLUBS.forEach(function (oId) {
        if (myId === oId) return;
        out.push(L.validMarkedPlayer(OPP[oId], TEAM_DATA[myId].default_marked_player));
      });
    });
    return out;
  }
  const a = runAll(), b = runAll();
  check('同じ入力なら常に同じ答え（56通り一致）', JSON.stringify(a) === JSON.stringify(b));
  check('無効な指名(-1)からの選び直しも決定論',
    L.validMarkedPlayer(OPP.belgium2026, -1) === L.validMarkedPlayer(OPP.belgium2026, -1));
  check('同点は lineup の並び順で安定（先に出た枠が勝つ）', (function () {
    // 全員同じ能力＝スコア同点にして、必ず lineup[1] が選ばれることを見る
    const td = {
      players: [], default_lineup: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], default_keyplayer: -1
    };
    for (let i = 0; i < 16; i++) td.players.push({ name: 'P' + i, params: new Array(29).fill(50) });
    return L.validMarkedPlayer(td, -1) === 1;
  })());
}

/* ── T3: 相手の default_keyplayer が最優先 ───────────────────────────── */
section('T3 相手の最も危険な先発＝default_keyplayer を優先する');
{
  let kpHits = 0, kpEligible = 0;
  CLUBS.forEach(function (oId) {
    const td = OPP[oId];
    const kpPos = td.default_keyplayer;
    if (typeof kpPos !== 'number' || kpPos < 1 || kpPos >= 11) return;
    const kpIdx = td.default_lineup[kpPos];
    if (!fieldStarters(td).has(kpIdx)) return;
    kpEligible++;
    if (L.validMarkedPlayer(td, -1) === kpIdx) kpHits++;
  });
  check('キープレイヤーが先発XIに居るクラブが存在する', kpEligible > 0, String(kpEligible));
  check('その場合は必ずキープレイヤーが選ばれる', kpHits === kpEligible,
    kpHits + ' / ' + kpEligible);
  check('キープレイヤーが居ないクラブでは攻撃系paramで選ぶ（フォールバック）', (function () {
    const td = {
      default_lineup: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], default_keyplayer: -1,
      players: []
    };
    for (let i = 0; i < 12; i++) td.players.push({ name: 'P' + i, params: new Array(29).fill(50) });
    td.players[7].params[11] = 99;   // SHOOT_ACCURACY を突出させた枠7
    return L.validMarkedPlayer(td, -1) === 7;
  })());
}

/* ── T4: GK は選ばない ──────────────────────────────────────────────── */
section('T4 GK は対象外（既存UIと同じ規約）');
{
  let gkPicked = 0;
  CLUBS.forEach(function (myId) {
    CLUBS.forEach(function (oId) {
      if (myId === oId) return;
      const td = OPP[oId];
      const got = L.validMarkedPlayer(td, TEAM_DATA[myId].default_marked_player);
      if (got === td.default_lineup[0]) gkPicked++;
    });
  });
  check('56通りのどれでも GK は選ばれない', gkPicked === 0, gkPicked + ' 通りで GK');
  check('GK を名指しで指定しても選び直される', (function () {
    const td = OPP.brazil2026;
    const gk = td.default_lineup[0];
    const got = L.validMarkedPlayer(td, gk);
    return got !== gk && fieldStarters(td).has(got);
  })());
}

/* ── T5: 異常入力でも例外を投げない ─────────────────────────────────── */
section('T5 異常入力でも例外を投げない（-1 か有効値を返す）');
{
  const bad = [
    ['null', null, -1],
    ['undefined', undefined, -1],
    ['players 無し', { default_lineup: [0, 1, 2] }, -1],
    ['default_lineup 無し', { players: [{ name: 'A', params: [] }] }, -1],
    ['default_lineup が空配列', { players: [{ name: 'A', params: [] }], default_lineup: [] }, -1],
    ['lineup が範囲外だらけ', { players: [{ name: 'A', params: [] }], default_lineup: [0, 99, 98] }, -1],
    ['lineup に null が混じる', { players: [{ name: 'A', params: [] }, { name: 'B', params: [] }], default_lineup: [0, null, 1] }, 1]
  ];
  let threw = null, wrong = [];
  bad.forEach(function (row) {
    try {
      const got = L.validMarkedPlayer(row[1], 5);
      if (got !== row[2]) wrong.push(row[0] + ' → ' + got + '（期待 ' + row[2] + '）');
    } catch (e) { threw = row[0] + ': ' + e.message; }
  });
  check('壊れた相手データでも例外を投げない', threw === null, String(threw));
  check('返り値は -1 か有効な player index', wrong.length === 0, wrong.join(' | '));
  check('params を持たない選手が混じっても落ちない', (function () {
    const td = { players: [{ name: 'GK' }, { name: 'A' }, { name: 'B', params: new Array(29).fill(70) }],
                 default_lineup: [0, 1, 2], default_keyplayer: -1 };
    return L.validMarkedPlayer(td, -1) === 2;
  })());
}

/* ── T6: 既に有効な指名は尊重する ───────────────────────────────────── */
section('T6 既に有効な指名は書き換えない（ユーザーの意思を尊重）');
{
  const td = OPP.spain2026;
  const starters = Array.from(fieldStarters(td));
  let kept = 0;
  starters.forEach(function (idx) { if (L.validMarkedPlayer(td, idx) === idx) kept++; });
  check('先発XIの全員について指名がそのまま通る', kept === starters.length,
    kept + ' / ' + starters.length);
  check('先発XI外の指名だけが選び直される', (function () {
    // XI 外の index を1つ探す
    let out = -1;
    for (let i = 0; i < td.players.length; i++) if (!fieldStarters(td).has(i) && i !== td.default_lineup[0]) { out = i; break; }
    if (out < 0) return false;
    const got = L.validMarkedPlayer(td, out);
    return got !== out && fieldStarters(td).has(got);
  })());
}

console.log('');
console.log('結果: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);
