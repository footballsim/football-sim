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
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { ROOT, JS_FILES } = require('./lib/load-engine.js');

/* ── ブラウザ API スタブ（localStorage だけは本物同然の実体を持たせる） ── */
const STUB = `
class URLSearchParams{constructor(s){}get(k){return null;}}
const _elStub={textContent:"",innerHTML:"",value:"",style:{},dataset:{},classList:{add:()=>{},remove:()=>{},toggle:()=>{},contains:()=>false},appendChild:()=>{},removeChild:()=>{},setAttribute:()=>{},getAttribute:()=>null,addEventListener:()=>{},querySelector:()=>null,querySelectorAll:()=>[],getContext:()=>null,focus:()=>{},remove:()=>{}};
const document={getElementById:()=>(_elStub),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>(Object.assign({},_elStub)),createElementNS:()=>(Object.assign({},_elStub)),body:{appendChild:()=>{},classList:{add:()=>{},remove:()=>{}}},documentElement:{style:{},classList:{add:()=>{},remove:()=>{}}},addEventListener:()=>{},head:{appendChild:()=>{}}};
const _lsData={};
const localStorage={getItem:(k)=>(k in _lsData? _lsData[k]:null),setItem:(k,v)=>{_lsData[k]=String(v);},removeItem:(k)=>{delete _lsData[k];},_dump:()=>_lsData};
const sessionStorage={getItem:()=>null,setItem:()=>{}};
const window={addEventListener:()=>{},location:{hash:"",search:""},matchMedia:()=>({matches:false,addEventListener:()=>{}}),navigator:{language:"ja"},localStorage:localStorage};
const navigator={language:"ja"};
const firebase={initializeApp:()=>{},firestore:()=>({collection:()=>({doc:()=>({get:()=>Promise.resolve({exists:false,data:()=>({})}),set:()=>Promise.resolve(),update:()=>Promise.resolve()})})})};
const gtag=()=>{};
const alert=()=>{};
const confirm=()=>true;
function showScreen(){}
function showWCStats(){}
function startManagerMatch(){}
`;

let code = STUB + '\n';
for (const f of JS_FILES) code += fs.readFileSync(path.join(ROOT, 'js', f), 'utf8') + '\n';
code += fs.readFileSync(path.join(ROOT, 'js', 'league.js'), 'utf8') + '\n';

const ctx = vm.createContext({
  Math, console, parseInt, parseFloat, isNaN, isFinite,
  setTimeout: (fn) => fn(), clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  Promise, JSON, Object, Array, String, Number, Boolean, Date, RegExp, Error, require, __dirname: ROOT,
});
vm.runInContext(code, ctx, { filename: 'league-concat.js' });

const api = vm.runInContext('({ L: window._leagueTestAPI, TEAM_DATA: TEAM_DATA, ls: localStorage })', ctx);
const L = api.L;
const TEAM_DATA = api.TEAM_DATA;
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
check('learnedTactics は初期2種', !!(s.manager && s.manager.learnedTactics.length === 2));
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
check('中身が既定だけのエントリは保存しない（セーブを疎に保つ）',
  !ns.squads[MY][keyOf(TEAM_DATA[MY].players[1])]);
check('新シーズンの seasonMeta は初期化される',
  ns.seasonMeta && ns.seasonMeta.actionsLog.length === 0 && ns.seasonMeta.pendingAction === null);

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
check('未習得の戦術が習得順に選ばれる', target === 'PRESS', String(target));
let unlocked = null, loops = 0;
while (!unlocked && loops < 20) {
  L.getState().round = loops;                 // 週を進めながら毎週「戦術勉強」
  L.setWeekSlot(0, 'tactic_study');
  const r = L.consumeWeek('D');
  unlocked = r && r.unlocked; loops++;
}
check('戦術勉強を続けると習得できる', unlocked === target, 'unlocked=' + unlocked + ' after ' + loops);
check('習得後 learnedTactics に入る', L.getState().manager.learnedTactics.indexOf(target) >= 0);
check('次は別の未習得戦術へ進む', L.nextUnlearnedTactic() === 'COUNTER', String(L.nextUnlearnedTactic()));
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

/* ── まとめ ─────────────────────────────────────────────────── */
console.log('\n' + (fail === 0 ? '✅ PASS' : '❌ FAIL') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
