/**
 * league-save-v4-test.js — 統合セーブスキーマ v4（SN-01 / MG-02）の headless 検証。
 *
 * 検証対象（設計書 MANAGER_SEASON_DESIGN.md §2・§2.1・§2.2・§6.4）:
 *   ① v2/v3 → v4 の移行が「欠落フィールドの補完のみ」で、進行中のリーグを壊さない
 *   ② _overlaySquad が growth を base param へ焼き込み、TEAM_DATA 本体は不変のまま
 *   ③ 怪我/出場停止の選手が先発から外れる＋詰み防止（11人を必ず確保）
 *   ④ 試合後の持ち越し記録（怪我の重症度・レッド・イエロー累積・出場数）
 *   ⑤ 節送りで欠場カウンタが 1 ずつ減る（先に減らす→今節の怪我を書く の順序）
 *   ⑥ シーズン跨ぎ = 成長/信頼は引き継ぎ・当季の記録と欠場カウンタはリセット
 *
 * 実行: node tools/league-save-v4-test.js
 * ※ league.js は <script> 前提のブラウザモジュールなので、DOM/localStorage をスタブして
 *   エンジン一式と同じ vm context に連結ロードする（tools/lib/load-engine.js と同じ作法）。
 */
'use strict';
const vm = require('vm');
const { makeLeagueContext } = require('./lib/league-context.js');

/* ── コンテキストは tools/lib/league-context.js に集約（aging-neutrality.js と共用） ── */
const _c = makeLeagueContext();
const ctx = _c.ctx;
const api = { L: _c.L, ls: _c.ls };
const L = _c.L;
const TEAM_DATA = _c.TEAM_DATA;
const LS_KEY = 'fs_league_v1';
const MY = 'england2026';

/* ── 極小テストランナー ─────────────────────────────────────────── */
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }
function reset() { api.ls.removeItem(LS_KEY); L.setState(null); }
function keyOf(p) { return p.long_name || p.name; }

/* ── ① 移行: v3 セーブ → v4 ───────────────────────────────────── */
section('① v3 → v4 マイグレーション（進行中データを壊さない）');
reset();
L.newSeason(MY);                       // v4 の新規セーブを作り、v3 相当へ手で落とす
const v3 = JSON.parse(api.ls.getItem(LS_KEY));
v3.version = 3; delete v3.manager; delete v3.seasonMeta; delete v3.squads;
v3.round = 5; v3.standings[MY] = { p: 5, w: 4, d: 1, l: 0, gf: 12, ga: 3, pts: 13 };
api.ls.setItem(LS_KEY, JSON.stringify(v3));
L.setState(null);
L.load();
let s = L.getState();
check('version が 4 に上がる', s && s.version === L.SAVE_VERSION, 'version=' + (s && s.version));
check('manager が既定で生える', !!(s.manager && s.manager.params && s.manager.params.tactical === L.MANAGER_TUNING.START));
check('learnedTactics は空＝初期はバランス重視のみ（2026-07-22 ユーザー決定）',
  !!(s.manager && Array.isArray(s.manager.learnedTactics) && s.manager.learnedTactics.length === 0));
check('seasonMeta / squads が生える', !!(s.seasonMeta && s.squads));
check('進行中の round が保持される', s.round === 5, 'round=' + s.round);
check('順位表が保持される', s.standings[MY].pts === 13);
check('移行後に保存される', JSON.parse(api.ls.getItem(LS_KEY)).version === 4);

// 部分的に壊れた v4（manager だけ欠落）にも耐える
const broken = JSON.parse(api.ls.getItem(LS_KEY));
delete broken.manager;
api.ls.setItem(LS_KEY, JSON.stringify(broken));
L.setState(null); L.load();
check('v4 でも欠落フィールドを補完する', !!L.getState().manager);

// v1（架空クラブ時代）は破棄される
const old = JSON.parse(api.ls.getItem(LS_KEY)); old.version = 1;
api.ls.setItem(LS_KEY, JSON.stringify(old));
L.setState(null); L.load();
check('v1 セーブは破棄される', L.getState() === null);

/* ── ② オーバーレイ: growth 焼き込み・TEAM_DATA 不変 ───────────── */
section('② _overlaySquad（成長の焼き込み・TEAM_DATA 保護）');
reset(); L.newSeason(MY);
const basePlayer = TEAM_DATA[MY].players[0];
const baseKey = keyOf(basePlayer);
const baseParam11 = basePlayer.params[11];
L.squadEntry(MY, baseKey).growth = { 11: 5 };
let td = L.overlaySquad(MY);
check('growth delta が base param に乗る', td.players[0].params[11] === baseParam11 + 5,
  td.players[0].params[11] + ' vs ' + (baseParam11 + 5));
check('TEAM_DATA 本体は不変', TEAM_DATA[MY].players[0].params[11] === baseParam11);
check('params 配列が別実体（共有していない）', td.players[0].params !== TEAM_DATA[MY].players[0].params);

L.squadEntry(MY, baseKey).growth = { 11: 999 };
check('growth は 1..99 に clamp', L.overlaySquad(MY).players[0].params[11] === 99);
L.squadEntry(MY, baseKey).growth = {};

/* ── ③ 欠場者の除外と詰み防止 ─────────────────────────────────── */
section('③ 怪我/出場停止による先発除外＋詰み防止');
const lineup0 = TEAM_DATA[MY].default_lineup.slice(0, 11);
const outIdx = lineup0[3];
L.squadEntry(MY, keyOf(TEAM_DATA[MY].players[outIdx])).injuryOut = 2;
td = L.overlaySquad(MY);
check('怪我の選手が先発から外れる', td.default_lineup.slice(0, 11).indexOf(outIdx) < 0);
check('先発は 11 人のまま', td.default_lineup.slice(0, 11).length === 11);
check('先発に重複がない', new Set(td.default_lineup.slice(0, 11)).size === 11);

// 詰み防止: スカッドのほぼ全員を欠場させても 11 人揃う
const total = TEAM_DATA[MY].players.length;
for (let i = 0; i < total; i++) {
  const e = L.squadEntry(MY, keyOf(TEAM_DATA[MY].players[i]));
  e.injuryOut = (i % 2 === 0) ? 3 : 1;   // 軽い(1)/重い(3) を混在させる
}
td = L.overlaySquad(MY);
check('全員欠場でも先発 11 人を確保（詰み防止）', td.default_lineup.slice(0, 11).length === 11);
check('復帰は「残り節数が短い＝軽い」選手から', (function () {
  const on = td.default_lineup.slice(0, 11);
  return on.every(function (i) { return L.squadEntry(MY, keyOf(TEAM_DATA[MY].players[i])).injuryOut === 0; });
})());

/* ── ④ 試合後の持ち越し記録 ───────────────────────────────────── */
section('④ _recordTeamCarryover（discipline マーカー → 欠場節数）');
reset(); L.newSeason(MY);
const team = L.overlaySquad(MY);
team.lineup = TEAM_DATA[MY].default_lineup.slice(0, 11);
const pInjured = team.players[team.lineup[0]];
const pRed = team.players[team.lineup[1]];
const pYellow = team.players[team.lineup[2]];
const pScorer = team.players[team.lineup[3]];
pInjured._injured = true; pInjured._injurySeverity = 'severe';
pRed._sentOff = true;
pYellow._yellowCards = 1;
L.recordTeamCarryover(MY, team, (function () { const m = {}; m[pScorer.name] = { goals: 2, assists: 1 }; return m; })(), true);

check('重傷 → 3 節欠場', L.squadEntry(MY, keyOf(pInjured)).injuryOut === L.SEASON_TUNING.INJURY_OUT.severe);
check('退場 → 次節出場停止', L.squadEntry(MY, keyOf(pRed)).suspendOut === L.SEASON_TUNING.SUSPEND_RED);
check('イエロー1枚は累積のみ（停止なし）',
  L.squadEntry(MY, keyOf(pYellow)).yellowAccum === 1 && L.squadEntry(MY, keyOf(pYellow)).suspendOut === 0);
check('得点/アシストが記録される',
  L.squadEntry(MY, keyOf(pScorer)).goals === 2 && L.squadEntry(MY, keyOf(pScorer)).assists === 1);
check('出場した 11 人に apps が付く', (function () {
  return team.lineup.every(function (i) { return L.squadEntry(MY, keyOf(team.players[i])).apps === 1; });
})());
check('出場していない選手には apps が付かない',
  L.squadEntry(MY, keyOf(team.players[team.lineup[0]])).apps === 1 &&
  !(L.getState().squads[MY][keyOf(team.players[20])] || {}).apps);

// イエロー累積が閾値に達したら出場停止（3枚目で停止・カウンタは繰り越し分を残す）
for (let k = 0; k < 2; k++) {
  const t2 = L.overlaySquad(MY);
  t2.lineup = [team.lineup[2]];
  t2.players[team.lineup[2]]._yellowCards = 1;
  L.recordTeamCarryover(MY, t2, null, false);
}
check('イエロー累積 ' + L.SEASON_TUNING.YELLOW_ACCUM + ' 枚 → 出場停止',
  L.squadEntry(MY, keyOf(pYellow)).suspendOut === L.SEASON_TUNING.SUSPEND_ACCUM,
  'suspendOut=' + L.squadEntry(MY, keyOf(pYellow)).suspendOut);
check('累積カウンタは閾値ぶん差し引かれる', L.squadEntry(MY, keyOf(pYellow)).yellowAccum === 0);

/* ── ⑤ 節送りで欠場カウンタが減る ─────────────────────────────── */
section('⑤ _tickCarryover（節が明けたら 1 減る）');
const before = L.squadEntry(MY, keyOf(pInjured)).injuryOut;
L.tickCarryover();
check('怪我の残り節数が 1 減る', L.squadEntry(MY, keyOf(pInjured)).injuryOut === before - 1);
L.tickCarryover(); L.tickCarryover(); L.tickCarryover();
check('0 未満にはならない', L.squadEntry(MY, keyOf(pInjured)).injuryOut === 0);

/* ── ⑥ シーズン跨ぎの引き継ぎ ─────────────────────────────────── */
section('⑥ _carrySquads / _startNextSeason（成長は継続・当季の記録はリセット）');
reset(); L.newSeason(MY);
const e1 = L.squadEntry(MY, baseKey);
e1.growth = { 11: 3 }; e1.trust = 70; e1.age = 27;
e1.apps = 14; e1.goals = 9; e1.assists = 4; e1.injuryOut = 2; e1.suspendOut = 1; e1.yellowAccum = 2;
L.squadEntry(MY, keyOf(TEAM_DATA[MY].players[1]));   // 中身が既定のままのエントリ（捨てられるはず）
L.getState().manager.params.tactical = 44;
L.getState().manager.clubTrust = 61;
const st = L.getState();
st.round = st.fixtures.length; st.finished = true;    // シーズン終了状態にしてから周回
let threw = null;
try { L.startNextSeason(); } catch (e) { threw = e; }
check('_startNextSeason が例外を投げない（_carrySquads 未定義バグの回帰）', threw === null, threw && threw.message);
const ns = L.getState();
check('シーズン番号が進む', ns && ns.season === 2);
check('監督の成長は引き継がれる', ns.manager.params.tactical === 44 && ns.manager.clubTrust === 61);
check('過去シーズンが history に残る', Array.isArray(ns.history) && ns.history.length === 1);
const c1 = ns.squads[MY][baseKey];
check('選手の growth / trust / age は引き継がれる',
  !!c1 && c1.growth['11'] === 3 && c1.trust === 70 && c1.age === 27);
check('当季の記録（apps/goals/assists）はリセット',
  !!c1 && c1.apps === 0 && c1.goals === 0 && c1.assists === 0);
check('欠場カウンタもリセット',
  !!c1 && c1.injuryOut === 0 && c1.suspendOut === 0 && c1.yellowAccum === 0);
// ★ SN-08a 以降、周回後の squads には「加齢で growth が付いた選手」が並ぶ（＝空ではない）。
//   _carrySquads 自体が疎を保つことは、関数を直接呼んで確かめる。
check('中身が既定だけのエントリは保存しない（_carrySquads がセーブを疎に保つ）', (function () {
  const src = {};
  src[MY] = {};
  src[MY][baseKey] = { growth: { 11: 3 }, trust: 70, age: 27, apps: 14, goals: 9, assists: 4, injuryOut: 0, suspendOut: 0, yellowAccum: 0 };
  src[MY]['__default__'] = { growth: {}, trust: 50, age: null, apps: 9, goals: 0, assists: 0, injuryOut: 0, suspendOut: 0, yellowAccum: 0 };
  const carried = L.carrySquads(src);
  return !!carried[MY][baseKey] && !carried[MY]['__default__'];
})());
check('新シーズンの seasonMeta は初期化される',
  ns.seasonMeta && ns.seasonMeta.actionsLog.length === 0 && ns.seasonMeta.pendingAction === null);

/* ── ⑥b SN-08a 年齢・成長・soft衰え ─────────────────────────────── */
section('⑥b SN-08a 選手の年齢・成長・soft衰え（決定論・引退なし）');
reset(); L.newSeason(MY);
const G = L.GROWTH_TUNING, AT = L.AGE_TUNING;
const outfield = TEAM_DATA[MY].players.find(function (p) { return p.positions[0] !== 'GK'; });
const gkPlayer = TEAM_DATA[MY].players.find(function (p) { return p.positions[0] === 'GK'; });

check('年齢は選手キーから決定論で決まる（同じキーなら常に同じ）',
  L.baseAge('テスト太郎') === L.baseAge('テスト太郎'));
check('年齢は ' + AT.MIN + '〜' + AT.PEAK_MAX + ' に収まる', (function () {
  return TEAM_DATA[MY].players.every(function (p) {
    const a = L.baseAge(keyOf(p));
    return a >= AT.MIN && a <= AT.PEAK_MAX;
  });
})());
check('年齢はシーズンが進むと 1 ずつ上がる（保存せず季から導出）', (function () {
  const k = keyOf(outfield);
  const a1 = L.playerAge(MY, k);
  L.getState().season = 3;
  const a3 = L.playerAge(MY, k);
  L.getState().season = 1;
  return a3 === a1 + 2;
})());
check('年齢は CAP(' + AT.CAP + ') で止まる', (function () {
  L.getState().season = 60;
  const a = L.playerAge(MY, keyOf(outfield));
  L.getState().season = 1;
  return a === AT.CAP;
})());

check('若手（18歳）は伸びる／ベテラン（36歳）は衰える', (function () {
  const up = L.agingDelta(outfield, 18, 14, 14);
  const dn = L.agingDelta(outfield, 36, 14, 14);
  const upAll = Object.keys(up).every(function (i) { return up[i] > 0; });
  const dnAny = Object.keys(dn).some(function (i) { return dn[i] < 0; });
  return Object.keys(up).length > 0 && upAll && dnAny;
})());
check('ピーク年齢（' + G.PEAK + '歳）は変化しない', Object.keys(L.agingDelta(outfield, G.PEAK, 14, 14)).length === 0);
check('同じ入力なら常に同じ Δ（rng 不使用＝seed 再現を壊さない）',
  JSON.stringify(L.agingDelta(outfield, 20, 7, 14)) === JSON.stringify(L.agingDelta(outfield, 20, 7, 14)));
check('出場が多いほど伸びが大きい', (function () {
  const many = L.agingDelta(outfield, 20, 14, 14);
  const few = L.agingDelta(outfield, 20, 0, 14);
  return many[2] > few[2] && few[2] > 0;   // 控えでも PLAY_FLOOR ぶんは伸びる
})());
check('衰えは出場数に依存しない（ベンチのベテランも歳を取る）', (function () {
  const played = L.agingDelta(outfield, 35, 14, 14);
  const benched = L.agingDelta(outfield, 35, 0, 14);
  return JSON.stringify(played) === JSON.stringify(benched);
})());
check('衰えはスピード系(idx2)がポジショニング(idx26)より大きい', (function () {
  const d = L.agingDelta(outfield, 36, 14, 14);
  return d[2] < 0 && !d[26];   // 26 は重み0＝経験で維持
})());
check('GK はピークが遅い（' + G.PEAK_GK + '歳）', (function () {
  return Object.keys(L.agingDelta(gkPlayer, G.PEAK_GK, 14, 14)).length === 0 &&
         Object.keys(L.agingDelta(gkPlayer, 28, 14, 14)).length > 0;   // 28歳はまだ伸びる
})());
check('GK は GK 用 param（4/5/10/23/24/26）だけ動く', (function () {
  const d = L.agingDelta(gkPlayer, 22, 14, 14);
  return Object.keys(d).length > 0 && Object.keys(d).every(function (i) {
    return ['4', '5', '10', '23', '24', '26'].indexOf(i) >= 0;
  });
})());
check('フィールド選手の GK 専用枠（23/24=50固定）は動かさない', (function () {
  const d = L.agingDelta(outfield, 20, 14, 14);
  return !d[23] && !d[24];
})());

// 累積の頭打ち（際限ない劣化を防ぐ安全弁）
check('累積の伸びは +' + G.TOTAL_GROW + ' で頭打ち', (function () {
  reset(); L.newSeason(MY);
  const next = {}, prev = {};
  const k = keyOf(outfield);
  next[MY] = {}; next[MY][k] = { growth: { 2: G.TOTAL_GROW }, trust: 50, age: null, apps: 0, goals: 0, assists: 0, injuryOut: 0, suspendOut: 0, yellowAccum: 0 };
  prev[MY] = {}; prev[MY][k] = { apps: 14 };
  L.getState().season = 1;
  L.applySeasonAging(next, prev, 14, MY);
  return next[MY][k].growth[2] <= G.TOTAL_GROW;
})());
check('累積の衰えは -' + G.TOTAL_DECL + ' で頭打ち', (function () {
  reset(); L.newSeason(MY);
  const next = {}, prev = {};
  const k = keyOf(outfield);
  next[MY] = {}; next[MY][k] = { growth: { 2: -G.TOTAL_DECL }, trust: 50, age: null, apps: 0, goals: 0, assists: 0, injuryOut: 0, suspendOut: 0, yellowAccum: 0 };
  prev[MY] = {}; prev[MY][k] = { apps: 14 };
  L.getState().season = 40;   // 全員 CAP 年齢＝全力で衰える季
  L.applySeasonAging(next, prev, 14, MY);
  L.getState().season = 1;
  return next[MY][k].growth[2] >= -G.TOTAL_DECL;
})());

// 周回で実際に効くこと（_startNextSeason 経由）
reset(); L.newSeason(MY);
(function () {
  const st0 = L.getState();
  st0.round = st0.fixtures.length; st0.finished = true;
  L.startNextSeason();
})();
const aged = L.getState();
check('周回すると growth が積まれる（加齢が実際に効く）', (function () {
  const c = aged.squads[MY] || {};
  return Object.keys(c).some(function (pk) { return c[pk].growth && Object.keys(c[pk].growth).length; });
})());
check('加齢後も param は [1,99] に収まる', (function () {
  return aged.clubs.every(function (cid) {
    return L.overlaySquad(cid).players.every(function (p) {
      return p.params.every(function (v) { return v >= 1 && v <= 99; });
    });
  });
})());
check('加齢後も先発 11 人が組める（詰み防止）', (function () {
  return aged.clubs.every(function (cid) { return L.overlaySquad(cid).default_lineup.slice(0, 11).length === 11; });
})());
check('自クラブの成長/衰えサマリーが残る（成長リザルト演出 MG-08 の素材）', (function () {
  const a = aged.seasonMeta && aged.seasonMeta.aging;
  return !!a && Array.isArray(a.grew) && Array.isArray(a.declined) && (a.grew.length + a.declined.length) > 0 &&
         (a.grew.concat(a.declined)).every(function (r) { return typeof r.diff === 'number' && typeof r.overall === 'number'; });
})());
check('サマリーは上位8件までに絞られる（セーブ肥大化を防ぐ）', (function () {
  const a = aged.seasonMeta.aging;
  return a.grew.length <= 8 && a.declined.length <= 8;
})());

/* ── ⑦ MG-03b 週プラン（1節=1週間・月〜金を3コマ） ───────────────── */
section('⑦ MG-03b 今週の準備（3コマ配分）');
reset(); L.newSeason(MY);
const mgf = vm.runInContext('window.managerParamFactor', ctx);

check('初期状態では週プラン未設定', L.pendingWeek() === null);
check('対策 buff は未選択なら無効（係数 1.0）', (function () {
  L.beginMatchCtx(MY);
  return mgf({ name: TEAM_DATA[MY].name }, null, '対ドリブル突破') === 1.0;
})());

// ビデオ学習: 相手の得意な攻め筋を決定論で割り出す
const fx0 = L.getState().fixtures[0].find(m => m.home === MY || m.away === MY);
const opp0 = (fx0.home === MY) ? fx0.away : fx0.home;
const ranked = L.opponentThreats(opp0);
const threat = ranked[0];
check('攻め筋のランキングが決定論で決まる（同じ入力で同じ答え）',
  JSON.stringify(ranked) === JSON.stringify(L.opponentThreats(opp0)), ranked.join('>'));
check('ランキングは全6本を重複なく並べる', new Set(ranked).size === 6 && ranked.length === 6);
check('_opponentThreat は1位と一致', L.opponentThreat(opp0) === threat);

L.setWeekSlot(0, 'video_study');
let pa = L.pendingWeek();
check('コマ1にビデオ学習が入る（対象＝1位の武器）',
  !!pa && pa.slots[0].kind === 'video_study' && pa.slots[0].target === threat);
check('未設定のコマは null のまま', pa.slots[1] === null && pa.slots[2] === null);
check('コマ数は常に3', pa.slots.length === L.WEEK_SLOTS && L.WEEK_SLOTS === 3);
check('保存される', JSON.parse(api.ls.getItem(LS_KEY)).seasonMeta.pendingAction.slots[0].kind === 'video_study');

// 重ねがけ＝封じる武器が1本ずつ増える
L.setWeekSlot(1, 'video_study');
pa = L.pendingWeek();
check('ビデオ学習を重ねると2本目の武器を狙う', pa.slots[1].target === ranked[1], pa.slots[1].target);
check('1本目の対象は変わらない', pa.slots[0].target === ranked[0]);
L.beginMatchCtx(MY);
check('2本とも試合中に効く', mgf({ name: TEAM_DATA[MY].name }, null, '対' + ranked[0]) > 1 &&
  mgf({ name: TEAM_DATA[MY].name }, null, '対' + ranked[1]) > 1);
check('3本目（未対策）には効かない', mgf({ name: TEAM_DATA[MY].name }, null, '対' + ranked[2]) === 1.0);
check('重ねても1本あたりの上限は変わらない（+5%以内）',
  mgf({ name: TEAM_DATA[MY].name }, null, '対' + ranked[0]) <= 1.05);
// 同じコマをもう一度押すと空に戻る
L.setWeekSlot(1, '');
check('同じアイコンを押し直すとコマが空になる', L.pendingWeek().slots[1] === null);
L.setWeekSlot(1, 'video_study');

L.beginMatchCtx(MY);
const myTeamStub = { name: TEAM_DATA[MY].name };
const oppTeamStub = { name: TEAM_DATA[opp0].name };
const fBuff = mgf(myTeamStub, null, '対' + threat);
check('対策した攻め筋を守る時だけ係数が上がる', fBuff > 1.0, 'f=' + fBuff);
check('係数は +5% 以内（[0.95,1.05] clamp）', fBuff <= 1.05);
check('初期 tactical=20 なら +1% 程度', Math.abs(fBuff - 1.01) < 0.0001, 'f=' + fBuff);
check('対策していない攻め筋には効かない', mgf(myTeamStub, null, '対' + ranked[2]) === 1.0);
check('攻撃側（"対"なし）には効かない', mgf(myTeamStub, null, threat) === 1.0);
check('相手チームには効かない', mgf(oppTeamStub, null, '対' + threat) === 1.0);
vm.runInContext('window.MANAGER_ENABLED = false', ctx);
check('キルスイッチ MANAGER_ENABLED=false で無効化', mgf(myTeamStub, null, '対' + threat) === 1.0);
vm.runInContext('delete window.MANAGER_ENABLED', ctx);
L.endMatchCtx();
check('試合が終われば係数は 1.0 に戻る', mgf(myTeamStub, null, '対' + threat) === 1.0);

// 成長: gain = base × (1 - param/CAP) の逓減
const before7 = JSON.parse(JSON.stringify(L.getState().manager.params));
let mg = L.consumeWeek('W');
const after7 = L.getState().manager.params;
check('勝利で戦術眼が伸びる（試合0.4＋勝利1.0＋ビデオ1.5×2 の逓減後）',
  after7.tactical > before7.tactical, before7.tactical + '→' + after7.tactical);
check('指揮しただけの param も微増する', after7.conditioning > before7.conditioning);
check('成長は逓減する（20 のとき base の 80%）',
  Math.abs((after7.conditioning - before7.conditioning) - 0.4 * 0.8) < 1e-9,
  '' + (after7.conditioning - before7.conditioning));
check('週プランは消費される', L.pendingWeek() === null);
check('コマの数だけ actionsLog に残る', L.getState().seasonMeta.actionsLog.length === 2,
  '' + L.getState().seasonMeta.actionsLog.length);
check('成長の内訳が lastResult 用に返る', !!(mg && mg.grown && mg.grown.tactical));

// 上限付き: CAP 付近では伸びない
L.getState().manager.params.tactical = 100;
const capped = L.consumeWeek('W');
check('CAP=100 では成長しない（上限）', L.getState().manager.params.tactical === 100);
check('CAP 超えの値は返さない', !capped.grown.tactical);

/* 🏥 回復日＝週の練習なので「試合の前」に効く */
section('⑧ 🏥 回復日（負傷者の復帰が1週早まる）');
L.getState().round = 0;
const injKey = keyOf(TEAM_DATA[MY].players[TEAM_DATA[MY].default_lineup[5]]);
L.squadEntry(MY, injKey).injuryOut = 2;
check('離脱者リストに週数付きで出る', (function () {
  const a = L.absentees(MY).find(x => x.name === TEAM_DATA[MY].players[TEAM_DATA[MY].default_lineup[5]].name);
  return !!a && a.weeks === 2 && a.kind === 'injury';
})());
L.setWeekSlot(0, 'recovery');
check('回復日を選んだだけでは、まだ効かない（試合前に適用）', L.squadEntry(MY, injKey).injuryOut === 2);
let healed = L.applyWeekRecovery(MY);
check('試合前に適用すると1週ぶん回復する', L.squadEntry(MY, injKey).injuryOut === 1 && healed === 1);
check('二重適用されない（中断して戻っても増えない）',
  L.applyWeekRecovery(MY) === 0 && L.squadEntry(MY, injKey).injuryOut === 1);
L.setWeekSlot(1, 'recovery');
L.applyWeekRecovery(MY);
check('回復日を重ねるとさらに1週進む（合計2週）', L.squadEntry(MY, injKey).injuryOut === 0);
// 出場停止は休んでも短くならない（現実準拠）
const susKey = keyOf(TEAM_DATA[MY].players[TEAM_DATA[MY].default_lineup[6]]);
L.squadEntry(MY, susKey).suspendOut = 1;
L.setWeekSlot(2, 'recovery');
L.applyWeekRecovery(MY);
check('出場停止は回復日で短縮されない', L.squadEntry(MY, susKey).suspendOut === 1);
check('回復日でも conditioning が伸びる', (function () {
  const b = L.getState().manager.params.conditioning;
  L.consumeWeek('D');
  return L.getState().manager.params.conditioning > b;
})());

/* 🎯 個人練習＝選手の武器を伸ばす（persistent 成長として squads.growth に積む） */
section('⑨ 🎯 個人練習（選手の武器が伸びる）');
L.getState().round = 1;
const starIdx = TEAM_DATA[MY].default_lineup[9];
const star = TEAM_DATA[MY].players[starIdx];
const starKey = keyOf(star);
const topIdx = star.params.indexOf(Math.max.apply(null, star.params));
L.setWeekSlot(0, 'individual_training');
check('個人練習には既定の対象選手が入る', !!L.pendingWeek().slots[0].target);
L.setTrainee(0, starKey);
check('対象選手を差し替えられる', L.pendingWeek().slots[0].target === starKey);
const trainRes = L.consumeWeek('D');
const g = L.squadEntry(MY, starKey).growth;
check('その選手の「武器」（最大param）が伸びる', (g[topIdx] || 0) > 0, JSON.stringify(g));
check('成長は逓減する（強い選手ほど伸びない）', (g[topIdx] || 0) < 1.0, '' + g[topIdx]);
check('伸びた内容が lastResult 用に返る', !!(trainRes.trained && trainRes.trained.length === 1));
check('オーバーレイに反映される（base param が上がる）',
  L.overlaySquad(MY).players[starIdx].params[topIdx] > star.params[topIdx]);

/* 「おまかせ」 */
section('⑩ 🎲 おまかせ（惰性プレイでも1日1回が成立する）');
L.getState().round = 2;
L.squadEntry(MY, injKey).injuryOut = 2;
L.autoWeek();
const autoSlots = L.pendingWeek().slots;
check('3コマとも埋まる', autoSlots.every(Boolean) && autoSlots.length === 3);
check('負傷者がいれば回復日が入る', autoSlots.some(s => s.kind === 'recovery'));
check('未習得の戦術があれば戦術勉強が入る', autoSlots.some(s => s.kind === 'tactic_study'));
check('残りは相手対策で埋まる', autoSlots.some(s => s.kind === 'video_study'));

// 戦術勉強: ゲージ → 解放
section('⑪ 📖 戦術勉強（ゲージ→解放）');
reset(); L.newSeason(MY);
L.getState().manager.params.tactical = 20;
const target = L.nextUnlearnedTactic();
check('未習得の戦術が習得順に選ばれる（最初はポゼッション）', target === 'POSSESSION', String(target));
let unlocked = null, loops = 0;
while (!unlocked && loops < 20) {
  L.getState().round = loops;                 // 週を進めながら毎週「戦術勉強」
  L.setWeekSlot(0, 'tactic_study');
  const r = L.consumeWeek('D');
  unlocked = r && r.unlocked; loops++;
}
check('戦術勉強を続けると習得できる', unlocked === target, 'unlocked=' + unlocked + ' after ' + loops);
check('習得後 learnedTactics に入る', L.getState().manager.learnedTactics.indexOf(target) >= 0);
check('次は別の未習得戦術へ進む', L.nextUnlearnedTactic() === 'PRESS', String(L.nextUnlearnedTactic()));
check('習得済みは進捗100で止まる', L.getState().manager.tacticProgress[target] === 100);

/* ── ⑫ コマの種類は「増える前提」 ─────────────────────────────────
 * 新しいコマは WEEK_ACTION_DEFS に1行足すだけで、選択・おまかせ・成長・消費・ログまで
 * 行き渡ること（＝_setWeekSlot / _autoWeek / _consumeWeek を触らずに済むこと）を実証する。 */
section('⑫ コマの種類を増やせる（登録テーブルに1行足すだけ）');
reset(); L.newSeason(MY);
const DEFS = L.WEEK_ACTION_DEFS;
const before12 = DEFS.length;
let customConsumed = 0;
DEFS.push({
  kind: 'press_conference', icon: '🎤', ja: '記者会見', en: 'Press conference',
  grow: { param: 'popularity', base: 'VIDEO' },
  target: function () { return 'home_fans'; },
  text: function () { return 'テスト用のコマ'; },
  summary: function () { return 'テスト'; },
  consume: function () { customConsumed++; }
});
L.setWeekSlot(0, 'press_conference');
let pw12 = L.pendingWeek();
check('新しい種類のコマを置ける', !!pw12 && pw12.slots[0].kind === 'press_conference');
check('def.target で既定の対象が入る', pw12.slots[0].target === 'home_fans');
const pop0 = L.getState().manager.params.popularity;
L.consumeWeek('D');
check('def.grow どおりに監督の param が伸びる', L.getState().manager.params.popularity > pop0);
check('def.consume が呼ばれる', customConsumed === 1);
check('actionsLog にも残る',
  L.getState().seasonMeta.actionsLog.some(a => a.action === 'press_conference'));

// enabled:false のコマは選べない（＝置いても無視される）
DEFS.push({ kind: 'locked_action', icon: '🔒', ja: 'ロック', en: 'Locked', enabled: function () { return false; } });
L.getState().round = 1;
L.setWeekSlot(0, 'locked_action');
check('enabled=false のコマは置けない', L.pendingWeek() === null || L.pendingWeek().slots[0] === null);

// おまかせも新しい種類を拾う（autoOnce を持つ def が配列順で1コマ入る）
DEFS.push({
  kind: 'scouting', icon: '🔍', ja: 'スカウト', en: 'Scouting',
  grow: { param: 'analysis', base: 'TACTIC' },
  autoOnce: function () { return true; },
  text: function () { return 'テスト用スカウト'; }
});
L.autoWeek();
check('おまかせが新しい autoOnce のコマを拾う',
  L.pendingWeek().slots.some(s => s && s.kind === 'scouting'));
check('おまかせは常に全コマ埋める', L.pendingWeek().slots.every(Boolean));

DEFS.length = before12;   // 後片付け（以降のテストに影響させない）
check('テーブルを戻せる（登録は配列操作だけ）', L.WEEK_ACTION_DEFS.length === before12);

/* ── ⑬ MG-05 人気（結果＋内容で双方向に動く唯一の param） ───────────── */
section('⑬ MG-05 人気システム');
reset(); L.newSeason(MY);
const P = L.POPULARITY_TUNING;
const pop = () => L.getState().manager.params.popularity;

check('人気は「指揮しただけ」では上がらない（MATCH_ALL 対象外）', (function () {
  const b = pop();
  L.consumeWeek('D');                    // 週プラン無しで試合をこなす
  return pop() === b;
})(), 'pop=' + pop());

// 勝敗の基本値（fixtures を触らず単体で式を検証）
L.getState().manager.params.popularity = 50;
let r = L.updatePopularity('W', 1, false);
check('勝利で上がる（勝利+得点差）', Math.abs(r.raw - (P.WIN + P.GD_COEF * 1)) < 1e-9, 'raw=' + r.raw);
L.getState().manager.params.popularity = 50;
r = L.updatePopularity('L', -3, false);
check('大敗はより大きく下がる（得点差が効く）',
  Math.abs(r.raw - (P.LOSS + P.GD_COEF * -3)) < 1e-9, 'raw=' + r.raw);
L.getState().manager.params.popularity = 50;
r = L.updatePopularity('D', 0, false);
check('引き分けは僅少マイナス（退屈ペナルティ）', Math.abs(r.raw - P.DRAW) < 1e-9, 'raw=' + r.raw);

// 宿敵
L.getState().manager.params.popularity = 50;
const rivalWin = L.updatePopularity('W', 1, true).raw;
L.getState().manager.params.popularity = 50;
const normalWin = L.updatePopularity('W', 1, false).raw;
check('宿敵に勝つと跳ねる', Math.abs((rivalWin - normalWin) - P.RIVAL_WIN) < 1e-9);
L.getState().manager.params.popularity = 50;
const rivalLoss = L.updatePopularity('L', -1, true).raw;
L.getState().manager.params.popularity = 50;
const normalLoss = L.updatePopularity('L', -1, false).raw;
check('宿敵に負けると余計に落ちる', Math.abs((rivalLoss - normalLoss) - P.RIVAL_LOSS) < 1e-9);

// clamp
L.getState().manager.params.popularity = 99;
L.updatePopularity('W', 5, true);
check('人気は100を超えない', pop() === 100, '' + pop());
L.getState().manager.params.popularity = 0.5;
L.updatePopularity('L', -5, true);
check('人気は0を下回らない', pop() === 0, '' + pop());

/* 連勝は fixtures の確定スコアから組み直す（新しい保存項目を作らない＝決定論） */
section('⑭ 連勝/連敗（fixtures から再構成）');
reset(); L.newSeason(MY);
function playRound(myGoals, oppGoals) {
  const st = L.getState();
  const ms = st.fixtures[st.round];
  const fx = ms.find(m => m.home === MY || m.away === MY);
  const home = (fx.home === MY);
  fx.played = true; fx.hs = home ? myGoals : oppGoals; fx.as = home ? oppGoals : myGoals;
  st.round++;
}
check('試合前は連勝なし', L.currentStreak().n === 0);
playRound(2, 0); playRound(1, 0);
check('2連勝を検出', L.currentStreak().res === 'W' && L.currentStreak().n === 2,
  JSON.stringify(L.currentStreak()));
check('結果列が古い順に並ぶ', JSON.stringify(L.myResultSeries()) === JSON.stringify(['W', 'W']));
L.getState().manager.params.popularity = 50;
const withStreak = L.updatePopularity('W', 1, false);
check('連勝ボーナスが乗る',
  withStreak.parts.some(p => p.k === 'streak' && p.v > 0), JSON.stringify(withStreak.parts));
playRound(0, 0);
check('引き分けで連勝が途切れる', L.currentStreak().res === 'D' && L.currentStreak().n === 1);
playRound(0, 2); playRound(0, 1); playRound(0, 3);
check('3連敗を検出', L.currentStreak().res === 'L' && L.currentStreak().n === 3);
L.getState().manager.params.popularity = 50;
const losing = L.updatePopularity('L', -1, false);
check('連敗はマイナス方向に効く', losing.parts.some(p => p.k === 'streak' && p.v < 0));
check('連勝ボーナスは頭打ちする（STREAK_CAP）', (function () {
  for (let i = 0; i < 8; i++) playRound(1, 0);
  const st = L.currentStreak();
  L.getState().manager.params.popularity = 50;
  const big = L.updatePopularity('W', 0, false).parts.find(p => p.k === 'streak');
  return st.n > P.STREAK_CAP && Math.abs(big.v - P.STREAK_COEF * (P.STREAK_CAP - 1)) < 1e-9;
})());

/* ── ⑮ SN-02 シーズン目標＋クラブ信頼度 ───────────────────────── */
section('⑮ SN-02 シーズン目標＋クラブからの信頼度');
reset(); L.newSeason(MY);
const G2 = L.GOAL_TUNING;
const goal = L.getState().manager.seasonGoal;
check('開幕時に目標が提示される', !!(goal && goal.type === 'table_pos' && goal.target >= 1), JSON.stringify(goal));
check('目標は戦力の格から決まる（決定論）', goal.rank === L.strengthRank(MY) && goal.target === G2.TARGET_FOR_RANK(goal.rank, 8));
check('最強クラブには「優勝」が要求される', (function () {
  const strongest = ['england2026','netherlands2026','spain2026','france2026','argentina2026','italy2026','brazil2026','belgium2026']
    .find(id => L.strengthRank(id) === 1);
  reset(); L.newSeason(strongest);
  const g = L.getState().manager.seasonGoal;
  return g.target === 1;
})());
check('季中に要求は変わらない', (function () {
  reset(); L.newSeason(MY);
  const t0 = L.getState().manager.seasonGoal.target;
  L.getState().round = 7;
  return L.ensureSeasonGoal().target === t0;
})());

// 信頼度: 結果＋目標圏内かどうか
reset(); L.newSeason(MY);
L.getState().manager.seasonGoal = { type: 'table_pos', target: 3, rank: 4 };
L.getState().manager.clubTrust = 50;
let tr = L.updateClubTrust('W', 2);
check('勝利かつ目標圏内で信頼が上がる', tr.delta > 0 && tr.parts.some(p => p.k === 'on_track'), JSON.stringify(tr.parts));
L.getState().manager.clubTrust = 50;
tr = L.updateClubTrust('L', 8);
check('敗戦かつ圏外で大きく下がる', tr.delta < 0 && tr.parts.some(p => p.k === 'off_track'), JSON.stringify(tr.parts));
check('圏外ペナルティには下限がある（TRUST_OFF_CAP）',
  tr.parts.find(p => p.k === 'off_track').v === G2.TRUST_OFF_CAP);
L.getState().manager.clubTrust = 99;
L.updateClubTrust('W', 1);
check('信頼度は100を超えない', L.getState().manager.clubTrust === 100);
L.getState().manager.clubTrust = 1;
L.updateClubTrust('L', 8);
check('信頼度は0を下回らない', L.getState().manager.clubTrust === 0);

// シーズン終了の清算
L.getState().manager.clubTrust = 50;
L.getState().manager.params.popularity = 50;
let sv = L.settleSeason(2);            // 目標3位以内 → 2位＝達成
check('達成なら信頼と人気が大きく上がる',
  sv.achieved && sv.trustDelta === G2.SEASON_ACHIEVED && sv.popDelta === G2.SEASON_POP_ACHIEVED, JSON.stringify(sv));
L.getState().manager.clubTrust = 50;
L.getState().manager.params.popularity = 50;
sv = L.settleSeason(6);                // 未達
check('未達なら大きく下がる',
  !sv.achieved && sv.trustDelta === G2.SEASON_MISSED && sv.popDelta === G2.SEASON_POP_MISSED);
check('判定結果は manager に残る（SN-04/05 が読む）',
  L.getState().manager.lastSeasonResult && L.getState().manager.lastSeasonResult.achieved === false);

// 次シーズンで目標は出し直し・信頼は引き継ぐ
reset(); L.newSeason(MY);
L.getState().manager.clubTrust = 71;
const st15 = L.getState(); st15.round = st15.fixtures.length; st15.finished = true;
L.startNextSeason();
check('次シーズンでも目標が提示される', !!L.getState().manager.seasonGoal.target);
check('クラブの信頼は在任が続く限り引き継ぐ', L.getState().manager.clubTrust === 71);

/* ── ⑯ MG-04 戦術習得制 ───────────────────────────────────────── */
section('⑯ MG-04 戦術習得制（リーグ限定・未習得は選べない）');
reset(); L.newSeason(MY);
const TID = L.TACTIC_IDS;
const iOf = id => TID.indexOf(id);
const info = vm.runInContext('window.leagueTacticInfo', ctx);

check('リーグの試合外では制限なし（null を返す）', info(iOf('PRESS')) === null);
L.setLeagueMatchActive(true);
check('★ 初期はポゼッションもロック（バランス重視のみ）', !L.isTacticUnlocked(iOf('POSSESSION')));
check('★ 初期は守備重視もロック', !L.isTacticUnlocked(iOf('CATENACCIO')));
check('★ バランス重視(FREE)は常時開放（多くのクラブの既定戦術＝塞ぐと試合が始まらない）',
  L.isTacticUnlocked(iOf('FREE')));
check('未習得のプレッシングはロック', !L.isTacticUnlocked(iOf('PRESS')));
check('未習得のカウンターはロック', !L.isTacticUnlocked(iOf('COUNTER')));
const li = info(iOf('PRESS'));
check('ロック情報に進捗とヒントが載る', !!(li && li.locked && typeof li.progress === 'number' && li.hint));

// 戦術勉強で解放 → 選べるようになる
L.setWeekSlot(0, 'tactic_study');
let unlocked16 = null, guard = 0;
while (!unlocked16 && guard < 20) {
  L.getState().round = guard;
  L.setWeekSlot(0, 'tactic_study');
  const rr = L.consumeWeek('D');
  unlocked16 = rr && rr.unlocked; guard++;
}
check('戦術勉強で解放される', unlocked16 === 'POSSESSION', String(unlocked16));
check('解放後は選べる', L.isTacticUnlocked(iOf('POSSESSION')));
check('解放後は leagueTacticInfo が locked:false を返す', info(iOf('POSSESSION')).locked === false);
check('まだ未習得のカウンターはロックのまま', !L.isTacticUnlocked(iOf('COUNTER')));
L.setLeagueMatchActive(false);
check('試合が終われば制限は消える（シングル/W杯に漏らさない）', info(iOf('COUNTER')) === null);

// 表示名はゲーム本体の i18n を引く（独自の呼び名を持つと戦術選択画面と食い違う）
const tacticNames = vm.runInContext("(typeof t==='function') ? t('tacticsNames') : TACTICS_NAMES", ctx);
check('戦術の表示名がゲーム本体と一致する（FREE=バランス重視）',
  L.tacticLabel('FREE') === tacticNames[iOf('FREE')], L.tacticLabel('FREE') + ' vs ' + tacticNames[iOf('FREE')]);
check('戦術の表示名がゲーム本体と一致する（CATENACCIO=守備重視）',
  L.tacticLabel('CATENACCIO') === tacticNames[iOf('CATENACCIO')], L.tacticLabel('CATENACCIO'));
check('全戦術で表示名が一致する',
  TID.every((id, i) => L.tacticLabel(id) === tacticNames[i]));

/* ── ⑰ MG-15 監督の自己研磨コマ（話術勉強／スポーツ科学） ───────────── */
section('⑰ MG-15 話術勉強・スポーツ科学（2026-07-23 名称確定）');
reset(); L.newSeason(MY);
check('話術勉強のコマが登録されている', L.WEEK_ACTION_DEFS.some(d => d.kind === 'speech_study'));
check('スポーツ科学のコマが登録されている', L.WEEK_ACTION_DEFS.some(d => d.kind === 'sports_science'));
L.setWeekSlot(0, 'speech_study');
L.setWeekSlot(1, 'sports_science');
const mot0 = L.getState().manager.params.motivator;
const con0 = L.getState().manager.params.conditioning;
L.consumeWeek('D');
check('話術勉強でモチベーターが伸びる（指揮0.4+話術1.5の逓減後）',
  L.getState().manager.params.motivator > mot0 + 1.0,
  mot0 + '→' + L.getState().manager.params.motivator);
check('スポーツ科学でフィジカル管理が伸びる',
  L.getState().manager.params.conditioning > con0 + 1.0,
  con0 + '→' + L.getState().manager.params.conditioning);
check('actionsLog に両方残る', (function () {
  const log = L.getState().seasonMeta.actionsLog;
  return log.some(a => a.action === 'speech_study') && log.some(a => a.action === 'sports_science');
})());

/* ── ⑱ SN-03 シーズン終了フロー（総評・表彰・アーカイブ拡張） ─────────── */
section('⑱ SN-03 シーズン終了フロー');
reset(); L.newSeason(MY);
// 当季記録を作る（得点王/アシスト王/皆勤の候補）
const pA = keyOf(TEAM_DATA[MY].players[TEAM_DATA[MY].default_lineup[3]]);
const pB = keyOf(TEAM_DATA[MY].players[TEAM_DATA[MY].default_lineup[4]]);
Object.assign(L.squadEntry(MY, pA), { goals: 9, assists: 2, apps: 12 });
Object.assign(L.squadEntry(MY, pB), { goals: 3, assists: 7, apps: 14 });
const top18 = L.seasonTopPlayers();
check('得点王が正しく選ばれる', top18.scorer && top18.scorer.name === pA && top18.scorer.n === 9);
check('アシスト王が正しく選ばれる', top18.assister && top18.assister.name === pB && top18.assister.n === 7);
check('皆勤賞が正しく選ばれる', top18.iron && top18.iron.name === pB && top18.iron.n === 14);

// 総評テンプレ: 達成/未達・宿敵・得失点で文が変わる
L.getState().manager.seasonGoal = { type: 'table_pos', target: 3, rank: 4 };
L.settleSeason(2);
let sum18 = L.seasonSummary();
check('総評に達成の文脈が入る', L.seasonReviewText(sum18).indexOf('堅実') >= 0 || sum18.champion === MY,
  L.seasonReviewText(sum18));
L.settleSeason(7);
sum18 = L.seasonSummary();
check('未達なら悔しさの文脈になる', L.seasonReviewText(sum18).indexOf('悔し') >= 0, L.seasonReviewText(sum18));

// アーカイブ拡張（RW-02 がそのまま読む形）
check('summary に verdict/goal/top/managerSnap が載る',
  !!(sum18.verdict && typeof sum18.goal === 'number' && sum18.top && sum18.managerSnap));
const st18 = L.getState(); st18.round = st18.fixtures.length; st18.finished = true;
L.startNextSeason();
const arch = L.getState().history[0];
check('history のアーカイブにも新フィールドが残る',
  !!(arch && arch.top && arch.managerSnap && arch.verdict !== undefined));
check('アーカイブの得点王が保存される', arch.top.scorer && arch.top.scorer.name === pA);

/* ── ⑲ SN-04/SN-05 再契約・移籍オファー・解任 ───────────────────── */
section('⑲ SN-04/SN-05 契約の分岐（解任＝信頼のみ・オファー＝人気のみ）');
reset(); L.newSeason(MY);
const C19 = L.CONTRACT_TUNING;
function finishSeason(achieved, trust, pop) {
  const st = L.getState();
  st.round = st.fixtures.length; st.finished = true;
  st.manager.clubTrust = trust;
  st.manager.params.popularity = pop;
  st.manager.lastSeasonResult = { achieved: achieved, goal: 3, finalPos: achieved ? 2 : 7 };
}

// 解任判定＝信頼のみ（MG-15: 人気は混ぜない）
finishSeason(false, 20, 90);
check('未達×低信頼 → 解任（人気90でも救えない＝人気は判定に混ぜない）', L.isSacked());
finishSeason(false, 50, 5);
check('未達でも信頼が高ければ残留（人気5でも解任されない）', !L.isSacked());
finishSeason(true, 10, 50);
check('達成なら低信頼でも解任されない', !L.isSacked());

// オファー＝人気で門戸が変わる（決定論）
finishSeason(true, 50, 90);
const offersHigh = L.computeOffers();
finishSeason(true, 50, 45);
const offersMid = L.computeOffers();
finishSeason(true, 50, 5);
const offersLow = L.computeOffers();
check('オファーは最大' + C19.OFFER_MAX + '件', offersHigh.length <= C19.OFFER_MAX && offersHigh.length > 0);
check('自クラブはオファーに含まれない',
  [offersHigh, offersMid, offersLow].every(os => os.every(o => o.clubId !== MY)));
check('人気が高いほど強いクラブから声がかかる',
  offersHigh[0].strength >= offersMid[0].strength && offersMid[0].strength >= offersLow[0].strength,
  offersHigh[0].strength + ' / ' + offersMid[0].strength + ' / ' + offersLow[0].strength);
check('人気最低でも最低1件は残る（詰み防止）', offersLow.length >= 1);
check('同じ入力なら同じオファー（決定論）',
  JSON.stringify(L.computeOffers()) === JSON.stringify(L.computeOffers()));

// 分岐: 解任なら残留不可
finishSeason(false, 20, 50);
let br19 = L.contractBranch();
check('解任時は残留を選べない（canRenew=false）', br19.sacked && !br19.canRenew);
check('解任でもオファーは必ずある（ゲームオーバーにしない）', br19.offers.length >= 1);
finishSeason(true, 80, 50);
br19 = L.contractBranch();
check('残留可のときは canRenew=true', !br19.sacked && br19.canRenew);

// オファー受諾＝クラブ移籍
finishSeason(false, 20, 50);
const dest = L.computeOffers()[0].clubId;
const seasonBefore = L.getState().season;
L.getState().manager.params.tactical = 66;
L.acceptOffer(dest);
const ns19 = L.getState();
check('受諾でクラブが替わる', ns19.myClub === dest, ns19.myClub);
check('シーズンが進む', ns19.season === seasonBefore + 1);
check('新任クラブの信頼は初期値にリセット', ns19.manager.clubTrust === L.MANAGER_TUNING.TRUST_START);
check('tenure が新クラブ×次シーズンに更新', ns19.manager.tenure.clubId === dest && ns19.manager.tenure.sinceSeason === ns19.season);
check('監督の成長は移籍しても引き継ぐ', ns19.manager.params.tactical === 66);
check('宿敵が新クラブ基準で再計算される', ns19.rival !== null && ns19.rival !== dest);
check('新クラブにも開幕目標が提示される', !!ns19.manager.seasonGoal.target);

// 防護: 提示していないクラブへは行けない（人気5＝下位のみ提示の状態で、提示外のクラブを狙う）
finishSeason(true, 80, 5);
const offered19 = L.computeOffers().map(o => o.clubId);
const notOffered = ['england2026','netherlands2026','spain2026','france2026','argentina2026','italy2026','brazil2026','belgium2026']
  .find(id => id !== L.getState().myClub && offered19.indexOf(id) < 0);
const clubBefore = L.getState().myClub;
L.acceptOffer(notOffered);
check('オファー外のクラブは受諾できない（防護）', L.getState().myClub === clubBefore,
  'tried ' + notOffered + ' offers=' + offered19.join(','));

/* ── ⑳ BX ベストイレブン（節ごと＋シーズン） ───────────────────── */
section('⑳ BX ベストイレブン');
reset(); L.newSeason(MY);
const OPP = 'brazil2026';
const pm = vm.runInContext('playMatch', ctx);
const m20 = pm(vm.runInContext("TEAM_DATA['" + MY + "']", ctx), vm.runInContext("TEAM_DATA['" + OPP + "']", ctx));
const rr20 = L.rateMatch(m20.home, m20.away, m20.chanceResults, MY, OPP);
check('両チーム先発11人が評価される',
  Object.keys(rr20[MY]).length === 11 && Object.keys(rr20[OPP]).length === 11,
  Object.keys(rr20[MY]).length + '/' + Object.keys(rr20[OPP]).length);
check('評価点は4.0〜10.0に収まる', (function () {
  return [MY, OPP].every(c => Object.values(rr20[c]).every(e => e.rating >= 4 && e.rating <= 10));
})());
check('GK/DF/MF/FW の区分が付く', (function () {
  const gs = new Set(Object.values(rr20[MY]).map(e => e.group));
  return gs.has('GK') && gs.has('DF') && (gs.has('MF') || gs.has('FW'));
})());
check('得点者は同ポジション帯の平均より高い', (function () {
  const all = [...Object.values(rr20[MY]), ...Object.values(rr20[OPP])];
  const scorers = all.filter(e => e.goals > 0);
  if (!scorers.length) return true;   // 0-0 なら判定不能=パス
  const rest = all.filter(e => e.goals === 0 && e.group === scorers[0].group);
  const avg = rest.reduce((a, e) => a + e.rating, 0) / (rest.length || 1);
  return scorers[0].rating > avg;
})());
check('同じ試合データなら同じ評価（決定論）',
  JSON.stringify(L.rateMatch(m20.home, m20.away, m20.chanceResults, MY, OPP)) === JSON.stringify(rr20));

const xi20 = L.pickBestXI(rr20);
check('ベストイレブンは GK1/DF3/MF4/FW3（3-4-3型）', (function () {
  return xi20.GK.length === 1 && xi20.DF.length <= 3 && xi20.MF.length <= 4 && xi20.FW.length <= 3 &&
    (xi20.GK.length + xi20.DF.length + xi20.MF.length + xi20.FW.length) <= 11;
})(), JSON.stringify({ gk: xi20.GK.length, df: xi20.DF.length, mf: xi20.MF.length, fw: xi20.FW.length }));
check('各枠は評価点の降順', (function () {
  return ['DF', 'MF'].every(g => xi20[g].every((p, i, a) => i === 0 || a[i - 1].rating >= p.rating));
})());

// 通年集計 → シーズンベストイレブン（最低出場数のゲート）
for (let i = 0; i < L.BESTXI_TUNING.SEASON_MIN_APPS; i++) L.accumulateRatings(rr20);
const pr20 = L.getState().seasonMeta.playerRatings;
check('通年集計が seasonMeta に貯まる', !!(pr20 && pr20[MY] && Object.keys(pr20[MY]).length === 11));
check('出場数がカウントされる', Object.values(pr20[MY])[0].n === L.BESTXI_TUNING.SEASON_MIN_APPS);
const sxi20 = L.seasonBestXI();
check('シーズンベストイレブンが選出される', !!(sxi20 && sxi20.GK.length === 1));
check('出場数が足りない選手は協会選出の対象外', (function () {
  // 1回だけ出た架空エントリを混ぜても選ばれない
  L.getState().seasonMeta.playerRatings[MY]['幽霊選手'] = { name: '幽霊選手', group: 'FW', sum: 10, n: 1, goals: 9, assists: 0 };
  const s = L.seasonBestXI();
  return s.FW.every(p => p.name !== '幽霊選手');
})());
// シーズン跨ぎで通年集計はリセットされる（seasonMeta ごと初期化）
const st20 = L.getState(); st20.round = st20.fixtures.length; st20.finished = true;
L.startNextSeason();
check('次シーズンで通年集計はリセット', !L.getState().seasonMeta.playerRatings);

/* ── ㉑ RW-02 バックナンバー（アーカイブの読み返し） ───────────────── */
section('㉑ RW-02 バックナンバー');
reset(); L.newSeason(MY);
// 1シーズンぶんの素材（評価点・当季記録・判定）を作ってアーカイブへ
const m21 = pm(vm.runInContext("TEAM_DATA['" + MY + "']", ctx), vm.runInContext("TEAM_DATA['brazil2026']", ctx));
const rr21 = L.rateMatch(m21.home, m21.away, m21.chanceResults, MY, 'brazil2026');
for (let i = 0; i < L.BESTXI_TUNING.SEASON_MIN_APPS; i++) L.accumulateRatings(rr21);
Object.assign(L.squadEntry(MY, keyOf(TEAM_DATA[MY].players[TEAM_DATA[MY].default_lineup[3]])), { goals: 8, assists: 3, apps: 13 });
L.getState().manager.seasonGoal = { type: 'table_pos', target: 3, rank: 4 };
L.settleSeason(2);
const st21 = L.getState(); st21.round = st21.fixtures.length; st21.finished = true;
L.startNextSeason();
const h21 = L.getState().history[0];
check('アーカイブに協会ベストイレブンが保存される', !!(h21.bestXI && h21.bestXI.GK.length === 1));
check('アーカイブに表彰/判定/監督スナップが揃う', !!(h21.top && h21.verdict && h21.managerSnap));
// バックナンバー1冊ぶんの描画（文字列として検証）
const issue = L.historyIssueHTML(h21, true);
check('表紙に号数と優勝クラブが載る', issue.indexOf('シーズン1') >= 0 && issue.indexOf('🏆') >= 0);
check('達成/未達チップが載る', issue.indexOf('目標達成') >= 0 || issue.indexOf('目標未達') >= 0);
check('総評がアーカイブから再生成される', issue.indexOf('シーズン総評') >= 0);
check('協会ベストイレブンが載る', issue.indexOf('シーズンベストイレブン') >= 0);
check('最終順位表が載る', issue.indexOf('最終順位表') >= 0);
check('当時の監督スナップが載る', issue.indexOf('当時の監督') >= 0);
check('得点王が載る', issue.indexOf('得点王') >= 0);
// 旧アーカイブ（SN-03 以前＝bestXI等なし）でも壊れず描ける
const legacy = { season: 9, myClub: MY, champion: 'brazil2026', myPos: 4,
  myRecord: { w: 5, d: 4, l: 5, gf: 20, ga: 18, pts: 19 }, rival: null, rivalH2H: null,
  standings: h21.standings };
let issueOk = true, legacyHTML = '';
try { legacyHTML = L.historyIssueHTML(legacy, false); } catch (e) { issueOk = false; }
check('旧形式のアーカイブでも壊れない（欠落フィールド耐性）', issueOk && legacyHTML.indexOf('シーズン9') >= 0);

/* ── まとめ ─────────────────────────────────────────────────── */
console.log('\n' + (fail === 0 ? '✅ PASS' : '❌ FAIL') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
