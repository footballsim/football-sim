/**
 * mtg1-frozen-clone-test.js — 「采配を挟むと試合スタッツが壊れる」バグの回帰テスト（2026-08-05）
 *
 * 実害（ユーザー報告のスクリーンショット）:
 *   イングランド 5-3 スペイン なのに シュート 0本 / チャンス 2 / 得点者8人が全員相手側 /
 *   攻撃パターン別ゴールも全部相手。
 *
 * 原因:
 *   試合中に交代・戦術変更を行うと manager-match.js の _mvFreezePastScenes が、
 *   過去シーンの参照するチームを「その時点の lineup を凍結したクローン」に差し替える
 *   （交代前のゴールが控え選手へ誤帰属するのを防ぐ正しい仕組み）。
 *   ところが集計側は `sc.offence === gameState.team1` と **同一性** で左右を判定していたため、
 *   凍結クローンのシーンが「どちらのチームでもない」に落ちて集計から消えていた。
 *   さらに得点者は `=== t1 ? scorers1 : scorers2` の三項式なので、
 *   **自チームのゴールが全部相手側に積まれる**。
 *
 * 修正: 左右判定を name ベース（_sameTeam）にする。クローンは name を保つ契約。
 *
 * 本テストは「凍結クローンを混ぜた chanceResults」を作って集計関数に食わせ、
 * 修正前なら必ず落ちる形で固定する。
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
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.location = { hash: '', search: '' };
  sandbox.matchMedia = () => ({ matches: false, addEventListener: () => {} });
  vm.createContext(sandbox);
  let code = STUB + '\n';
  for (const f of JS_FILES) code += fs.readFileSync(path.join(ROOT, 'js', f), 'utf8') + '\n';
  for (const f of ['sns.js', 'league.js']) {
    code += fs.readFileSync(path.join(ROOT, 'js', f), 'utf8') + '\n';
  }
  code += '\nwindow.localStorage = localStorage;\n';
  vm.runInContext(code, sandbox, { filename: 'frozen-concat.js' });
  return sandbox;
}

const W = makeCtx();
const L = W._leagueTestAPI;
/* top-level const（TEAM_DATA / system_data 等）は sandbox のプロパティにならないので式評価で取り出す
 * （tools/lib/load-engine.js の注意書きと同じ理由）。 */
const evalIn = (expr) => vm.runInContext(expr, W);
/* simulate.js の `let chanceResults` / `gameState` はレキシカル束縛なので sandbox へ代入しても
 * 集計関数からは見えない。context 内で代入する（vm は script 間で global lexical scope を保つ）。 */
function setMatch(chanceResults, gameState) {
  W.__cr = chanceResults; W.__gs = gameState;
  evalIn('chanceResults = window.__cr; gameState = window.__gs;');
}
const TEAM_DATA = evalIn('TEAM_DATA');
const system_data = evalIn('system_data');
const buildTeam = evalIn('buildTeam');

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra ? '  → ' + extra : '')); }
}

/* ── 素材づくり: 実チームを2つ組み、片方の「凍結クローン」を作る ────────────── */
function buildSide(key) {
  const d = TEAM_DATA[key];
  const sysIdx = system_data.findIndex(s => s.name === d.default_system);
  return buildTeam(d, {
    systemIdx: sysIdx >= 0 ? sysIdx : 0,
    tactics: d.default_tactics,
    keyplayer: d.default_keyplayer,
    marked_player: -1,
    lineup: d.default_lineup.slice(0, 11)
  });
}

/* manager-match.js の _mvFreezePastScenes と同型のクローン: 別オブジェクトだが name は同じ。 */
function freeze(team) {
  const c = Object.create(Object.getPrototypeOf(team));
  Object.assign(c, team);
  c.lineup = team.lineup.slice();
  return c;
}

const t1 = buildSide('england2026');   // 自チーム
const t2 = buildSide('belgium2026');   // 相手
const t1frozen = freeze(t1);

console.log('\n=== 凍結クローン混在時の集計（采配を挟んだ試合の再現）===\n');

console.log('T0 前提の確認');
ok(t1frozen !== t1, '凍結クローンは別オブジェクト（=== では一致しない）');
ok(t1frozen.name === t1.name, '凍結クローンは name を保つ（name 判定なら解決できる）');
ok(L.sameTeam(t1frozen, t1) === true, '_sameTeam はクローンを自チームと判定する');
ok(L.sameTeam(t1, t2) === false, '_sameTeam は別チームを取り違えない');
ok(L.sameTeam(null, t1) === false, 'null でも例外を出さず false');

/* シーンを手で組む。前半＝凍結クローン（采配より前）／後半＝生オブジェクト。
 * 自チームのゴールを前半に2点置く＝修正前は必ず相手側に積まれる。 */
function scene(off, def, result, action, ofsPos) {
  return { offence: off, defence: def, result: result, action: action,
    ofsPos: ofsPos === undefined ? 10 : ofsPos, dfsPos: 5, area: 'FW中央' };
}
setMatch([
  { time: '前半 20分', scenes: [ scene(t1frozen, t2, 'ゴール！！', '中央からシュート', 10) ] },
  { time: '前半 35分', scenes: [ scene(t1frozen, t2, 'ゴール！！', 'ボレーシュート', 9) ] },
  { time: '前半 40分', scenes: [ scene(t2, t1frozen, 'ゴール！！', 'ヘディングシュート') ] },
  { time: '後半 60分', scenes: [ scene(t1, t2, 'ゴール！！', '中央からシュート', 8) ] },
  { time: '後半 70分', scenes: [ scene(t2, t1, '枠を外した！', 'ミドルシュート') ] },
  { time: '後半 80分', scenes: [ Object.assign(scene(t1, t2, '成功', 'ショートパス', 7), { area: 'MF中央' }) ] }
], { team1: t1, team2: t2 });

console.log('\nT1 試合スタッツ（_computeMatchStats）');
const s = L.computeMatchStats();
ok(!!s, 'スタッツが取れる');
ok(s.scorers1.length === 3, '自チームの得点者3人が自分側に入る（前半2＋後半1）',
  '実際=' + s.scorers1.length);
ok(s.scorers2.length === 1, '相手の得点者1人だけが相手側に入る', '実際=' + s.scorers2.length);
ok(s.t1.sh === 3, '自チームのシュートに前半分が含まれる（3本）', '実際=' + s.t1.sh);
ok(s.t2.sh === 2, '相手のシュートは2本', '実際=' + s.t2.sh);
ok(s.t1.sh >= s.scorers1.length, '★シュート数がゴール数を下回らない（報告された矛盾の再発防止）',
  'sh=' + s.t1.sh + ' / goals=' + s.scorers1.length);
/* チャンス＝シュート or FW帯のシーン。自3（うち前半2はクローン参照）／相手2。 */
ok(s.t1.ch === 3 && s.t2.ch === 2, 'チャンス数が前半分を取りこぼさない',
  't1=' + s.t1.ch + ' t2=' + s.t2.ch);
ok(s.t1.poss > 0 && s.t1.poss < 100, 'ポゼッションが片側0%に振り切れない', 't1=' + s.t1.poss + '%');
const mePat = s.patterns.filter(p => p.side === 'me').reduce((a, p) => a + p.count, 0);
ok(mePat === 3, '攻撃パターン別ゴールが自チーム側に3つ計上される', '実際=' + mePat);

console.log('\nT2 得点者・シーズン成績の採取（_collectMyStats）');
const rep = L.collectMyStats();
/* scorers は「選手ごとの集約」なので、3人が1点ずつ＝3行。 */
ok(rep.scorers.length === 3, '★自チームの得点者を1人も取りこぼさない（持ち越し成績の欠落防止）',
  '実際=' + rep.scorers.length);
ok(rep.scorers.reduce(function (a, x) { return a + x.goals; }, 0) === 3,
  '得点者の合計ゴールがスコアと一致する');
const goalSum = Object.keys(rep.stats).reduce((a, n) => a + rep.stats[n].goals, 0);
ok(goalSum === 3, 'シーズン成績に載るゴール数が3', '実際=' + goalSum);

console.log('\nT3 評価点（_rateMatch）— 凍結クローンでも自クラブへ帰属する');
const rr = L.rateMatch(t1, t2, W.__cr, 'england2026', 'belgium2026');
ok(!!rr['england2026'] && !!rr['belgium2026'], '両クラブの評価点が返る');
const mine = rr['england2026'] || {};
ok(Object.keys(mine).length > 0, '自クラブの評価点が空でない');

console.log('\nT4 採配なし（クローンが無い通常の試合）でも従来どおり');
setMatch([
  { time: '前半 10分', scenes: [ scene(t1, t2, 'ゴール！！', '中央からシュート') ] },
  { time: '後半 60分', scenes: [ scene(t2, t1, 'ゴール！！', 'ボレーシュート') ] }
], { team1: t1, team2: t2 });
const s2 = L.computeMatchStats();
ok(s2.scorers1.length === 1 && s2.scorers2.length === 1, '1-1が正しく左右に分かれる');
ok(s2.t1.sh === 1 && s2.t2.sh === 1, 'シュートも1本ずつ');

console.log('\n' + (fail === 0 ? '✅ PASS' : '❌ FAIL') + `  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
