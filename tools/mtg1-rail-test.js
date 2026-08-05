#!/usr/bin/env node
/**
 * mtg1-rail-test.js — MTG1-#3「デイリーレール」(js/rail.js) の機械検証。
 *
 * 検証項目:
 *   T1 緊張の在庫: 合成ケース（解任ライン／宿敵距離／優勝争い／連勝連敗／最下位／要求ライン／
 *      最終節／シーズン終了）で採用される1本が意図通り。**同じ ctx なら常に同じ結果**（決定論）。
 *   T2 ストリーク: 連続/同日/フリーズ（週1回・1日空き）/2日空き＝途切れ/時計巻き戻し。
 *   T3 キルスイッチ: window.MTG1_RAIL === false で intercept/finalePanel/lockText が
 *      一切介在しない（＝league.js は従来の次回予告カードを出す）。
 *   T4 後方互換: manager.rail / seasonMeta.rail が無いセーブでも壊れない・
 *      セーブ版数(SAVE_VERSION)を上げない・進行データを壊さない。
 *   T5 実結線: league.js の _leagueRailHost 経由で実リーグ状態から ctx が組め、
 *      朝刊の割り込み条件（開幕節・既読・本日消化済み）が意図通りに効く。
 *
 * 実行: node tools/mtg1-rail-test.js
 * ※ league.js / rail.js は <script> 前提のブラウザモジュール。**window === vm のグローバル**
 *   にして連結ロードする（tools/lib/league-context.js は window が別オブジェクトなので
 *   league.js ⇔ rail.js の typeof 連携が切れる＝本テストは自前 context を使う）。
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
  sandbox.window = sandbox;          // ★ ブラウザ同様 window === グローバル（typeof 連携を生かす）
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.location = { hash: '', search: '' };
  sandbox.matchMedia = () => ({ matches: false, addEventListener: () => {} });
  vm.createContext(sandbox);
  let code = STUB + '\n';
  // ブラウザ（_league_dev.html / dist-lab）と同じ読み込み順: エンジン → sns → league → rail
  for (const f of JS_FILES) code += fs.readFileSync(path.join(ROOT, 'js', f), 'utf8') + '\n';
  for (const f of ['sns.js', 'league.js', 'rail.js']) {
    code += fs.readFileSync(path.join(ROOT, 'js', f), 'utf8') + '\n';
  }
  // STUB の localStorage は const（スクリプトのレキシカルスコープ）。テスト側から触れるよう橋を架ける。
  code += '\nwindow.localStorage = localStorage;\n';
  vm.runInContext(code, sandbox, { filename: 'rail-concat.js' });
  return sandbox;
}

const W = makeCtx();
const L = W._leagueTestAPI;
const Rail = W.Rail;
const LS_KEY = 'fs_league_v1';
const MY = 'england2026';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail !== undefined ? '  → ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

/* =============================================================================
 * T1 緊張の在庫（純関数・合成 ctx）
 * ========================================================================== */
section('T1 緊張の在庫（決定論・合成ケース）');

/** 「平時の中位クラブ」＝どのルールにも引っかからない土台。ここから1項目だけ動かす。 */
function baseCtx(over) {
  const c = {
    round: 5, rounds: 14, clubCount: 8, finished: false,
    pos: 4, pts: 8, gd: 0,
    leaderPts: 20, leaderName: 'リーダー', secondPts: 17, aheadGap: 3,
    goalTarget: 4, goalText: '4位以内', goalGap: 0,
    trust: 60,
    streak: { res: 'D', n: 1 },
    rival: { id: 'x', name: '宿敵FC', away: 5, w: 2, d: 1, l: 1 },
    opp: { id: 'y', name: '相手FC', home: true }
  };
  return Object.assign(c, over || {});
}

check('平時は既定（次節の相手）に落ちる', Rail.tensionFrom(baseCtx()).id === 'next',
  Rail.tensionFrom(baseCtx()).id);

// ── 決定論: 同じ ctx を何度評価しても同一（順序・重み・文言）
const a1 = Rail.tensionFrom(baseCtx({ trust: 30 }));
const a2 = Rail.tensionFrom(baseCtx({ trust: 30 }));
check('同じ ctx → 同じ1本（id/文言まで一致）',
  a1.id === a2.id && a1.head === a2.head && a1.sub === a2.sub && a1.w === a2.w);

// ── 解任ライン
check('信頼35未満＝解任ライン（最優先級）', Rail.tensionFrom(baseCtx({ trust: 30 })).id === 'sack');
check('信頼45未満＝警告帯でも解任ラインを拾う', Rail.tensionFrom(baseCtx({ trust: 40 })).id === 'sack');
check('信頼45以上＝解任ラインは在庫に入らない',
  Rail.tensionList(baseCtx({ trust: 45 })).every(t => t.id !== 'sack'));
check('解任ラインの文面に信頼値と要求が出る',
  /30/.test(Rail.tensionFrom(baseCtx({ trust: 30 })).sub) &&
  /4位以内/.test(Rail.tensionFrom(baseCtx({ trust: 30 })).sub));

// ── 宿敵（距離）
check('宿敵戦が次節＝rival_next', Rail.tensionFrom(baseCtx({ rival: { id: 'x', name: '宿敵FC', away: 0, w: 2, d: 1, l: 1 } })).id === 'rival_next');
check('宿敵まで3節＝rival_soon', Rail.tensionFrom(baseCtx({ rival: { id: 'x', name: '宿敵FC', away: 3, w: 2, d: 1, l: 1 } })).id === 'rival_soon');
check('宿敵カウントダウンは近いほど強い',
  Rail.tensionFrom(baseCtx({ rival: { id: 'x', name: 'R', away: 1, w: 0, d: 0, l: 0 } })).w >
  Rail.tensionFrom(baseCtx({ rival: { id: 'x', name: 'R', away: 3, w: 0, d: 0, l: 0 } })).w);
check('宿敵戦が遠い（4節以上先）ときはカウントダウンを出さない＝毎日言わない',
  Rail.tensionList(baseCtx({ rival: { id: 'x', name: 'R', away: 4, w: 0, d: 0, l: 0 } }))
    .every(t => t.id !== 'rival_soon'));
check('宿敵戦が今季もう無い（away=null）＝カウントダウンを出さない',
  Rail.tensionList(baseCtx({ rival: { id: 'x', name: 'R', away: null, w: 0, d: 0, l: 0 } }))
    .every(t => t.id !== 'rival_soon' && t.id !== 'rival_next'));
check('通算対戦成績が宿敵の文面に出る',
  /2勝1分1敗/.test(Rail.tensionFrom(baseCtx({ rival: { id: 'x', name: '宿敵FC', away: 0, w: 2, d: 1, l: 1 } })).sub));

// ── 連勝／連敗
check('3連勝＝streak_win', Rail.tensionFrom(baseCtx({ streak: { res: 'W', n: 3 } })).id === 'streak_win');
check('3連敗＝streak_loss', Rail.tensionFrom(baseCtx({ streak: { res: 'L', n: 3 } })).id === 'streak_loss');
check('2連勝は在庫に入らない（最小3本）',
  Rail.tensionList(baseCtx({ streak: { res: 'W', n: 2 } })).every(t => t.id !== 'streak_win'));
check('同じ本数なら連敗＞連勝（緊張の重み）',
  Rail.tensionFrom(baseCtx({ streak: { res: 'L', n: 4 } })).w >
  Rail.tensionFrom(baseCtx({ streak: { res: 'W', n: 4 } })).w);
check('5連勝以上は「記録」に言及する',
  /記録/.test(Rail.tensionFrom(baseCtx({ streak: { res: 'W', n: 5 } })).sub));

// ── 優勝争い
check('終盤・3位以内・首位と6差以内＝優勝争い',
  Rail.tensionFrom(baseCtx({ round: 9, pos: 2, pts: 18, leaderPts: 21 })).id === 'title');
check('序盤は優勝争いを煽らない',
  Rail.tensionList(baseCtx({ round: 3, pos: 2, pts: 9, leaderPts: 10 })).every(t => t.id !== 'title'));
check('首位との差が大きいと優勝争いにしない',
  Rail.tensionList(baseCtx({ round: 9, pos: 3, pts: 10, leaderPts: 21 })).every(t => t.id !== 'title'));
check('自分が首位なら「追われる側」の文面',
  /首位/.test(Rail.tensionFrom(baseCtx({ round: 9, pos: 1, pts: 21, secondPts: 18 })).head));
check('首位との差が小さいほど強い',
  Rail.tensionFrom(baseCtx({ round: 9, pos: 2, pts: 20, leaderPts: 21 })).w >
  Rail.tensionFrom(baseCtx({ round: 9, pos: 2, pts: 16, leaderPts: 21 })).w);

// ── 最下位争い／要求ライン／最終節／シーズン終了
check('下位2クラブ＝最下位争い', Rail.tensionFrom(baseCtx({ round: 9, pos: 8, aheadGap: 2 })).id === 'drop');
check('要求ラインまで勝点N＝goal_gap',
  Rail.tensionFrom(baseCtx({ pos: 6, goalTarget: 4, goalGap: 3 })).id === 'goal_gap');
check('要求ラインに届いていれば goal_gap は出ない',
  Rail.tensionList(baseCtx({ pos: 3, goalTarget: 4, goalGap: 0 })).every(t => t.id !== 'goal_gap'));
check('残り1節＝最終節', Rail.tensionFrom(baseCtx({ round: 13, rounds: 14 })).id === 'final_round');
check('シーズン終了は全てに優先', Rail.tensionFrom(baseCtx({ finished: true, trust: 10 })).id === 'season_end');

// ── 優先順位（合成: 複数の緊張が同時に立つ）
check('解任ライン > 宿敵戦（生存が最優先）',
  Rail.tensionFrom(baseCtx({ trust: 20, rival: { id: 'x', name: 'R', away: 0, w: 1, d: 1, l: 1 } })).id === 'sack');
check('宿敵戦 > 優勝争い（次の90分に賭かる方）',
  Rail.tensionFrom(baseCtx({ round: 9, pos: 2, pts: 18, leaderPts: 20, rival: { id: 'x', name: 'R', away: 0, w: 1, d: 1, l: 1 } })).id === 'rival_next');
check('優勝争い > 連勝（順位の物語が上）',
  Rail.tensionFrom(baseCtx({ round: 9, pos: 1, pts: 21, secondPts: 20, streak: { res: 'W', n: 4 } })).id === 'title');
check('在庫は重みの降順に並ぶ',
  (() => { const l = Rail.tensionList(baseCtx({ trust: 30, round: 13, streak: { res: 'L', n: 4 } }));
    return l.length >= 3 && l.every((t, i) => i === 0 || l[i - 1].w >= t.w); })());
check('在庫が空でも必ず1本は返る（既定）', !!Rail.tensionFrom(baseCtx({ rival: null })));
check('ctx が無ければ null', Rail.tensionFrom(null) === null);

// ── 日英（i18n）: 言語を変えると文言が変わり、どちらも空でない
W.LANG = 'en';
const en = Rail.tensionFrom(baseCtx({ trust: 30 }));
W.LANG = 'ja';
const ja = Rail.tensionFrom(baseCtx({ trust: 30 }));
check('英語表示で英文になる（i18n）', /[A-Za-z]/.test(en.head) && en.head !== ja.head, en.head);
check('日英とも tag/head/sub が空でない',
  !!(en.tag && en.head && en.sub && ja.tag && ja.head && ja.sub));

/* =============================================================================
 * T2 ストリーク（純関数）
 * ========================================================================== */
section('T2 ストリーク（進行 / 同日 / フリーズ / 途切れ）');

function st0() { return { n: 0, best: 0, lastDay: null, freezeWeek: null, frozen: false }; }

let s = Rail.streakTouch(st0(), '2026-08-04');
check('初回は 1 日', s.n === 1 && s.lastDay === '2026-08-04');
Rail.streakTouch(s, '2026-08-04');
check('同じ日に何度開いても増えない', s.n === 1);
Rail.streakTouch(s, '2026-08-05');
Rail.streakTouch(s, '2026-08-06');
check('翌日ごとに +1', s.n === 3, 'n=' + s.n);
check('best が更新される', s.best === 3);

// 1日空き → 週1回の自動フリーズで維持
Rail.streakTouch(s, '2026-08-08');   // 08-07 を飛ばした
check('1日空きはフリーズで維持（n が進む）', s.n === 4, 'n=' + s.n);
check('フリーズを使ったことが分かる', s.frozen === true);
check('フリーズ使用週が記録される', s.freezeWeek !== null);

Rail.streakTouch(s, '2026-08-09');
check('翌日に開くとフリーズ表示は消える', s.frozen === false && s.n === 5);

// 同じ週にもう一度1日空き → フリーズ在庫なし＝途切れる
//   ※ フリーズの「週」はエポック起点の7日バケット（木曜始まり）。08-13〜08-19 が同一バケット。
const sw = Rail.streakTouch(st0(), '2026-08-13');
Rail.streakTouch(sw, '2026-08-15');   // 1回目のフリーズ
check('（別記録）1日空き1回目はフリーズで維持', sw.n === 2 && sw.frozen === true);
Rail.streakTouch(sw, '2026-08-17');   // 同一週の2回目
check('同じ週の2回目の空きは途切れる（1に戻る）', sw.n === 1 && sw.frozen === false, 'n=' + sw.n);

// 2日以上空いたら常に途切れる
const s2 = Rail.streakTouch(st0(), '2026-09-01');
Rail.streakTouch(s2, '2026-09-05');
check('3日以上の空きはフリーズでも救わない', s2.n === 1);

// 時計の巻き戻しで記録を減らさない
const s3 = Rail.streakTouch(st0(), '2026-09-10');
Rail.streakTouch(s3, '2026-09-11');
const before = s3.n;
Rail.streakTouch(s3, '2026-09-08');
check('端末時計が巻き戻っても後退しない', s3.n === before && s3.lastDay === '2026-09-11');

// 週境界（フリーズは7日バケットで1回だけ）
const s4 = Rail.streakTouch(st0(), '2026-08-10');
Rail.streakTouch(s4, '2026-08-12');   // week A のフリーズ
const weekA = s4.freezeWeek;
Rail.streakTouch(s4, '2026-08-13');
Rail.streakTouch(s4, '2026-08-14');
Rail.streakTouch(s4, '2026-08-15');
Rail.streakTouch(s4, '2026-08-16');
Rail.streakTouch(s4, '2026-08-17');
Rail.streakTouch(s4, '2026-08-19');   // 次の週の空き
check('週が変わればフリーズは復活する', s4.frozen === true && s4.freezeWeek !== weekA, 'n=' + s4.n);

check('不正な日付では何も壊さない', (() => {
  const x = Rail.streakTouch(st0(), 'not-a-date');
  return x.n === 0 && x.lastDay === null;
})());

/* =============================================================================
 * T5 実結線（league.js ⇔ rail.js）
 *   ※ T3/T4 の前に実状態を作る。
 * ========================================================================== */
section('T5 実リーグ状態との結線（朝刊の割り込み条件）');

function reset() { W.localStorage.removeItem(LS_KEY); L.setState(null); L.newSeason(MY); }

/** 指定節まで、全カードを決定論のスコア（0-0）で消化する。エンジンは呼ばない。 */
function simRounds(n) {
  const st = L.getState();
  for (let r = 0; r < n; r++) {
    st.fixtures[r].forEach(m => { m.played = true; m.hs = 1; m.as = 0; });
    st.fixtures[r].forEach(m => {
      const H = st.standings[m.home], A = st.standings[m.away];
      H.p++; A.p++; H.gf += m.hs; H.ga += m.as; A.gf += m.as; A.ga += m.hs;
      if (m.hs > m.as) { H.w++; A.l++; H.pts += 3; } else if (m.hs < m.as) { A.w++; H.l++; A.pts += 3; }
      else { H.d++; A.d++; H.pts++; A.pts++; }
    });
    st.round++;
  }
  L.save();
}

reset();
check('_leagueRailHost が公開されている', !!W._leagueRailHost && typeof W._leagueRailHost.state === 'function');
check('rail が実状態から ctx を組める', (() => {
  const c = Rail.tensionCtx();
  return !!c && c.rounds === 14 && c.clubCount === 8 && typeof c.pos === 'number' && !!c.opp;
})());
check('実状態でも必ず1本の緊張が出る', !!Rail.tension());
check('開幕節（round=0）は朝刊を出さない', Rail.intercept() === false);

simRounds(3);
check('第4節の朝は朝刊を出す（未読）', Rail.intercept() === true);
check('朝刊は seasonMeta.rail に既読節を書かない（読むまでは）',
  L.getState().seasonMeta.rail.round === -1);
W.railPaperNext();
check('「監督室へ」で既読になる', L.getState().seasonMeta.rail.round === 3);
check('既読なら二度と割り込まない（同じ節）', Rail.intercept() === false);

// 本日消化済み＝朝刊は翌朝まで出さない
L.getState().seasonMeta.rail.round = -1;
const today = new Date();
L.getState().lastPlayedDate = today.getFullYear() + '-' + ('0' + (today.getMonth() + 1)).slice(-2) + '-' + ('0' + today.getDate()).slice(-2);
check('本日消化済みなら朝刊は出さない（翌朝に回す）', Rail.intercept() === false);
L.getState().lastPlayedDate = null;
check('日付が変われば次の節の朝刊が出る', Rail.intercept() === true);
W.railPaperNext();

// シーズン終了フローには割り込まない
L.getState().seasonMeta.rail.round = -1;
L.getState().finished = true;
check('シーズン終了中は割り込まない', Rail.intercept() === false);
L.getState().finished = false;

// ストリークは manager（季を跨ぐ側）に載る
Rail.touch('2026-08-04');
check('ストリークは manager.rail に載る（季を跨いで残る場所）',
  !!L.getState().manager.rail && L.getState().manager.rail.n >= 1);
check('朝刊の既読は seasonMeta.rail に載る（季ごとにリセットされる側）',
  typeof L.getState().seasonMeta.rail.round === 'number');
check('終幕カードが返る（html は関数＝表示時に組む）', (() => {
  const p = Rail.finalePanel();
  return !!p && p.id === 'rail_finale' && typeof p.html === 'function';
})());
check('終幕カードの中身に次回予告・ストリーク・また明日が揃う', (() => {
  const h = Rail.finalePanel().html();
  return /次回予告/.test(h) && /日連続/.test(h) && /また明日/.test(h) && /lg-rail-hook/.test(h);
})());
check('ロック文言が終幕トーンに置き換わる', /また明日/.test(Rail.lockText() || ''));

/* =============================================================================
 * T3 キルスイッチ
 * ========================================================================== */
section('T3 キルスイッチ（window.MTG1_RAIL === false）');

W.MTG1_RAIL = false;
L.getState().seasonMeta.rail.round = -1;   // 未読に戻しても出ないこと
check('intercept が一切割り込まない', Rail.intercept() === false);
check('finalePanel が null（＝league.js は従来の次回予告を出す）', Rail.finalePanel() === null);
check('lockText が null（＝従来の文言のまま）', Rail.lockText() === null);
check('tension も出ない', Rail.tension() === null);
check('enabled() が false', Rail.enabled() === false);
const railBefore = JSON.stringify(L.getState().manager.rail);
Rail.touch('2026-12-25');
check('キルOFF中はストリークも書き換えない', JSON.stringify(L.getState().manager.rail) === railBefore);
W.MTG1_RAIL = true;
check('戻せば再び有効', Rail.enabled() === true && Rail.intercept() === true);
W.railPaperNext();

/* =============================================================================
 * T4 セーブ後方互換
 * ========================================================================== */
section('T4 セーブ後方互換（任意フィールドが無くても壊れない）');

// rail フィールドを持たないセーブ（＝この機能より前のセーブ）を読ませる
const raw = JSON.parse(W.localStorage.getItem(LS_KEY));
delete raw.manager.rail;
delete raw.seasonMeta.rail;
raw.round = 6;
W.localStorage.setItem(LS_KEY, JSON.stringify(raw));
L.setState(null); L.load();
check('rail フィールドが無いセーブを読み込める', !!L.getState());
check('進行データ（round）が保持される', L.getState().round === 6);
check('セーブ版数は上がらない（v4 のまま）', L.getState().version === L.SAVE_VERSION);
check('ロード直後は rail フィールドを生やさない（league.js は関知しない）',
  L.getState().manager.rail === undefined && L.getState().seasonMeta.rail === undefined);
check('rail 無しでも ctx が組める', !!Rail.tensionCtx());
check('rail 無しでも緊張が出る', !!Rail.tension());
check('緊張の導出は保存に触らない（読み出し専用）', L.getState().manager.rail === undefined);
check('触った時に初めて rail が生える（遅延生成）', (() => {
  Rail.touch('2026-08-04');
  const r = L.getState().manager.rail;
  return !!r && r.n === 1;
})());
check('rail 無しでも終幕カードが組める', typeof Rail.finalePanel().html() === 'string');
check('朝刊の既読フィールドも遅延生成される', (() => {
  Rail.intercept();
  return typeof L.getState().seasonMeta.rail.round === 'number';
})());

// seasonMeta / manager ごと欠落した壊れたセーブでも落ちない
const broken = JSON.parse(W.localStorage.getItem(LS_KEY));
delete broken.seasonMeta;
W.localStorage.setItem(LS_KEY, JSON.stringify(broken));
L.setState(null); L.load();
check('seasonMeta 欠落セーブは league.js が補完し、rail も動く',
  !!L.getState().seasonMeta && Rail.intercept() !== undefined);

// 状態が無い（クラブ未選択）ときに呼ばれても no-op
L.setState(null);
check('セーブが無い時 intercept は false', Rail.intercept() === false);
check('セーブが無い時 finalePanel は null', Rail.finalePanel() === null);
check('セーブが無い時 tensionCtx は null', Rail.tensionCtx() === null);
check('セーブが無い時 streak は既定値を返す（例外を出さない）', Rail.streak().n >= 0);

/* ── 結果 ─────────────────────────────────────────────────────── */
console.log('\n' + (fail === 0 ? '✅ PASS' : '❌ FAIL') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
