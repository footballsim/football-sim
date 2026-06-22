// ============================================================
// 日本代表・運命の分岐（予選通過順位別シミュレーター）
// グループF(日本)を 1位/2位/3位 で通過した3パターンごとに、
// 決勝トーナメントの「対戦相手の確率」と「各ラウンドの勝率（決勝まで）」を
// 高速な確率モデルでモンテカルロ演算し、1ボタンで一括提示する。
//
// 設計メモ:
// - 試合エンジン(simulateSilent)は ~0.7ms/試合 → 全104試合×数万回は非現実的。
//   そこで「チーム総合力(getTeamTotalParam)差 → 勝率」の確率モデルで近似し、
//   日本が絡む主要カードは実測値(ANCHOR)で上書きして精度を確保する。
// - ブラケット定義は tournament.js の WCSIM_* / wcsimAssignThirds / wcsimTeamName を再利用。
// - i18n は players.js の巨大 i18n を触らず、本ファイル内に閉じる(JWC_T)。
// ============================================================

const JWC_JP = 'japan2026vsNetherlands'; // グループF内の日本キー
const JWC_N  = 40000;                     // モンテカルロ試行回数

// 日本(japan2026vsNetherlandsデータ) vs 主要相手 の実測 W/D/L（simulateSilent N=4000）
const JWC_ANCHOR = {
  netherlands2026:{w:.245,d:.360,l:.395}, tunisia2026:{w:.474,d:.354,l:.172}, sweden2026:{w:.460,d:.335,l:.205},
  morocco2026:{w:.420,d:.379,l:.201}, brazil2026:{w:.260,d:.374,l:.366}, norway2026:{w:.391,d:.356,l:.253},
  mexico2026:{w:.469,d:.347,l:.184}, spain2026:{w:.231,d:.368,l:.401}, france2026:{w:.251,d:.346,l:.403},
  argentina2026:{w:.293,d:.363,l:.344}, england2026:{w:.246,d:.369,l:.385},
};

let _jwcRating = null;  // teamKey → 総合力（初回キャッシュ）
let _jwcRes = null;     // 直近のMC結果
let _jwcTab = 1;        // 表示中シナリオ（1/2/3）

function jwcEnsureRatings() {
  if (_jwcRating) return;
  _jwcRating = {};
  Object.keys(TEAM_DATA).forEach(k => {
    const d = TEAM_DATA[k];
    const sysIdx = system_data.findIndex(s => s.name === d.default_system);
    const state = {
      systemIdx: sysIdx >= 0 ? sysIdx : 0,
      tactics: d.default_tactics,
      keyplayer: d.default_keyplayer,
      marked_player: d.default_marked_player !== undefined ? d.default_marked_player : -1,
      lineup: [...d.default_lineup.slice(0, 11)]
    };
    _jwcRating[k] = getTeamTotalParam(buildTeam(d, state));
  });
}

// 2チームの 勝/分/負 確率
function jwcMatchProbs(a, b) {
  if (a === JWC_JP && JWC_ANCHOR[b]) return JWC_ANCHOR[b];
  if (b === JWC_JP && JWC_ANCHOR[a]) { const r = JWC_ANCHOR[a]; return {w:r.l, d:r.d, l:r.w}; }
  const diff = _jwcRating[a] - _jwcRating[b];
  let d = 0.345 - Math.max(0, Math.abs(diff) - 1000) * 0.00005;
  d = Math.max(0.18, Math.min(0.345, d));
  const pz = 1 / (1 + Math.exp(-0.0006 * diff)); // 引分を除いた勝率
  const w = (1 - d) * pz;
  return {w, d, l: 1 - d - w};
}
function jwcGroupRes(a, b) { const p = jwcMatchProbs(a, b); const r = Math.random(); return r < p.w ? 1 : (r < p.w + p.d ? 0 : -1); }
function jwcKoWinner(a, b) { const p = jwcMatchProbs(a, b); return Math.random() < (p.w + p.d * 0.5) ? a : b; }

// グループ1組（総当たり6試合）→ 順位ソート済み standings
const JWC_ORDER = [[0,1],[2,3],[0,2],[3,1],[3,0],[1,2]];
function jwcPlayGroup(keys) {
  const T = {};
  keys.forEach(k => { T[k] = {key:k, pts:0, gd:0, gf:0, rnd:Math.random()}; });
  JWC_ORDER.forEach(([i, j]) => {
    const res = jwcGroupRes(keys[i], keys[j]);
    if (res > 0)      { T[keys[i]].pts += 3; T[keys[i]].gd++; T[keys[j]].gd--; T[keys[i]].gf++; }
    else if (res < 0) { T[keys[j]].pts += 3; T[keys[j]].gd++; T[keys[i]].gd--; T[keys[j]].gf++; }
    else              { T[keys[i]].pts++; T[keys[j]].pts++; }
  });
  return keys.map(k => T[k]).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.rnd - b.rnd);
}

// 1大会を演算し、各KOマッチの対戦カードと勝者を返す
function jwcPlayTournament() {
  const standings = {};
  Object.keys(WCSIM_GROUPS).forEach(L => { standings[L] = jwcPlayGroup(WCSIM_GROUPS[L]); });

  const thirds = Object.keys(WCSIM_GROUPS).map(L => Object.assign({group: L}, standings[L][2]));
  thirds.forEach(t => t.rnd = Math.random());
  thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.rnd - b.rnd);
  const q = thirds.slice(0, 8);
  const qGroups = new Set(q.map(t => t.group));
  const asg = wcsimAssignThirds(q); // tournament.js のバックトラック割当を再利用

  const slot = (s, m) => s.t === 'W' ? standings[s.g][0].key : (s.t === 'R' ? standings[s.g][1].key : asg[m].key);
  const card = {}, win = {};
  WCSIM_R32_DEFS.forEach(d => {
    card[d.match] = [slot(d.home, d.match), slot(d.away, d.match)];
    win[d.match] = jwcKoWinner(card[d.match][0], card[d.match][1]);
  });
  [WCSIM_R16_DEFS, WCSIM_QF_DEFS, WCSIM_SF_DEFS].forEach(defs =>
    defs.forEach(([no, m1, m2]) => { card[no] = [win[m1], win[m2]]; win[no] = jwcKoWinner(win[m1], win[m2]); }));
  card[104] = [win[101], win[102]];
  win[104] = jwcKoWinner(win[101], win[102]);
  return {standings, qGroups, card, win, asg};
}

const JWC_ROUNDS = [
  ['R32', () => WCSIM_R32_DEFS.map(d => d.match)],
  ['R16', () => WCSIM_R16_DEFS.map(x => x[0])],
  ['QF',  () => WCSIM_QF_DEFS.map(x => x[0])],
  ['SF',  () => WCSIM_SF_DEFS.map(x => x[0])],
  ['F',   () => [104]],
];

// 日本のグループ順位＆ノックアウト経路を抽出
function jwcJapanInfo(tour) {
  const F = tour.standings.F;
  const pos = F.findIndex(s => s.key === JWC_JP) + 1;
  const qualified = pos <= 2 || (pos === 3 && tour.qGroups.has('F'));
  const path = [];
  let entryMatch = null;
  for (const [rd, getMatches] of JWC_ROUNDS) {
    const m = getMatches().find(mm => tour.card[mm] && tour.card[mm].includes(JWC_JP));
    if (!m) break;
    if (rd === 'R32') entryMatch = m;
    const opp = tour.card[m][0] === JWC_JP ? tour.card[m][1] : tour.card[m][0];
    const advanced = tour.win[m] === JWC_JP;
    path.push({round: rd, opp, advanced});
    if (!advanced) break;
  }
  return {pos, qualified, path, entryMatch};
}

function jwcNewScen() {
  return {n:0, champ:0,
    reach:{R32:0,R16:0,QF:0,SF:0,F:0},
    adv:  {R32:0,R16:0,QF:0,SF:0,F:0},
    opp:  {R32:{},R16:{},QF:{},SF:{},F:{}},      // 各R 対戦相手の出現回数
    oppWin:{R32:{},R16:{},QF:{},SF:{},F:{}},     // 各R 対戦相手別の日本の勝利回数（単独勝率算出用）
    entry:{}};  // 日本の入口R32試合番号 → 回数
}

// モンテカルロ本体
function jwcRunMC(N) {
  jwcEnsureRatings();
  const SC = {1: jwcNewScen(), 2: jwcNewScen(), 3: jwcNewScen()};
  const rank = [0,0,0,0];
  let thirdQual = 0, thirdFail = 0;
  // 各ブラケット枠を最も多く占有したチーム集計（全シム共通・トーナメント表の全チーム表示用）
  const groupPos = {}; Object.keys(WCSIM_GROUPS).forEach(L => groupPos[L] = [{}, {}, {}]); // L→[1位,2位,3位]のチーム別回数
  const tslotCount = {}; // 3位枠 match → チーム別占有回数
  for (let i = 0; i < N; i++) {
    const tour = jwcPlayTournament();
    Object.keys(WCSIM_GROUPS).forEach(L => {
      const st = tour.standings[L];
      for (let p = 0; p < 3; p++) { const k = st[p].key; groupPos[L][p][k] = (groupPos[L][p][k] || 0) + 1; }
    });
    Object.keys(tour.asg).forEach(m => { const k = tour.asg[m].key; (tslotCount[m] = tslotCount[m] || {})[k] = (tslotCount[m][k] || 0) + 1; });
    const info = jwcJapanInfo(tour);
    rank[info.pos - 1]++;
    let scen = null;
    if (info.pos === 1) scen = SC[1];
    else if (info.pos === 2) scen = SC[2];
    else if (info.pos === 3) { if (info.qualified) { scen = SC[3]; thirdQual++; } else { thirdFail++; continue; } }
    else continue; // 4位 = GS敗退
    scen.n++;
    if (info.entryMatch != null) scen.entry[info.entryMatch] = (scen.entry[info.entryMatch] || 0) + 1;
    info.path.forEach(step => {
      scen.reach[step.round]++;
      if (step.advanced) scen.adv[step.round]++;
      scen.opp[step.round][step.opp] = (scen.opp[step.round][step.opp] || 0) + 1;
      if (step.advanced) scen.oppWin[step.round][step.opp] = (scen.oppWin[step.round][step.opp] || 0) + 1;
    });
    scen.champ = scen.adv.F;
  }
  return {N, rank, thirdQual, thirdFail, scenarios: SC, groupPos, tslotCount,
    overallChamp: SC[1].champ + SC[2].champ + SC[3].champ,
    overallFinal: SC[1].reach.F + SC[2].reach.F + SC[3].reach.F};
}

// ------------------------------------------------------------
// i18n（本ファイル内に閉じる）
// ------------------------------------------------------------
const JWC_T = {
  ja: {
    menuLabel: '日本代表・運命の分岐', menuDesc: '予選1位・2位・3位、それぞれの未来を一括占う',
    title: '🔮 日本代表・運命の分岐', screenTitle: '🔮 運命の分岐',
    intro: 'グループFを <b>1位・2位・3位</b> で通過した3つの未来。それぞれ誰と当たり、どこまで勝ち上がれるのか——決勝トーナメントを4万回シミュレートして、対戦相手の確率と優勝までの勝率を一気に占う。',
    groupF: 'グループF', runBtn: '🎲 3つの運命を一括シミュレート', running: '🔮 4万回の未来を演算中…', rerun: '🔄 もう一度占う',
    secScenario: '予選の結末', scenP1: '1位通過', scenP2: '2位通過', scenP3: '3位通過', gsExit: 'グループ敗退',
    qualNote: '※ 突破率（決勝T進出）', secCompare: '優勝確率くらべ', champLabel: '優勝', finalLabel: '決勝進出',
    tabHint: '通過順位を選んで、その未来を詳しく見る', noData: 'このパターンは出現しませんでした',
    ladder: '勝ち上がりカーブ', reachR16:'ベスト16', reachQF:'ベスト8', reachSF:'ベスト4', reachF:'決勝', reachC:'優勝',
    oppByRound: 'ラウンド別 対戦相手の確率', roundWin: '勝率', reachRate: '到達率',
    likelyPath: '最有力ルート', vs: 'vs',
    bracketTitle: '優勝への道（トーナメント表）', orLabel: 'または', japanLabel: '日本代表', startHere: 'グループF', champReach: '世界一',
    fullBracketTitle: 'トーナメント表（日本の入る位置）', fullBracketNote: '予選順位で日本の入る枠が変わる。1位=金 / 2位=銀 / 3位=青（3位は入り得る5枠）', scrollHint: '← 横スクロールで全体を確認 →', jpShort: '日本', finalShort: '決勝', champShort: '優勝',
    bracketPredictSuffix: '時のトーナメント組み合わせ予想', bracketPredictNote: '各枠は<b>最有力チーム</b>。<b>緑▶＝その対戦の予想勝者</b>。',
    roundAdv: '突破率', hhShort: '勝',
    rdName: {R32:'ベスト32', R16:'ベスト16', QF:'準々決勝', SF:'準決勝', F:'決勝'},
    insightHead: '📌 読みどころ', share: '結果を画像で保存', backTitle: '🏠 タイトルへ',
    ofScenario: 'この未来の中で', condReach: '到達時',
    sumWin: '勝', sumDraw: '分', sumLoss: '敗',
  },
  en: {
    menuLabel: "Japan's Destiny Split", menuDesc: 'Win, 2nd or 3rd in the group — simulate all three futures',
    title: "🔮 Japan's Destiny Split", screenTitle: '🔮 Destiny Split',
    intro: 'Three futures from finishing <b>1st, 2nd or 3rd</b> in Group F. Who would Japan face, and how far could they go? We simulate the knockout bracket 40,000 times to chart opponent odds and the road to the title.',
    groupF: 'GROUP F', runBtn: '🎲 Simulate all three futures', running: '🔮 Simulating 40,000 futures…', rerun: '🔄 Run again',
    secScenario: 'How the group ends', scenP1: '1st place', scenP2: '2nd place', scenP3: '3rd (advance)', gsExit: 'Group exit',
    qualNote: '* advance = reach knockouts', secCompare: 'Title odds, side by side', champLabel: 'Champions', finalLabel: 'Reach final',
    tabHint: 'Pick a finishing position to explore that future', noData: 'This outcome did not occur',
    ladder: 'Advancement curve', reachR16:'Last 16', reachQF:'Last 8', reachSF:'Last 4', reachF:'Final', reachC:'Champions',
    oppByRound: 'Opponent odds by round', roundWin: 'win', reachRate: 'reach',
    likelyPath: 'Most likely path', vs: 'vs',
    bracketTitle: 'Road to the title (bracket)', orLabel: 'or', japanLabel: 'Japan', startHere: 'Group F', champReach: 'World champions',
    fullBracketTitle: 'Full bracket (where Japan lands)', fullBracketNote: 'Group finish decides Japan\'s slot. 1st=gold / 2nd=silver / 3rd=blue (any of 5 slots)', scrollHint: '← scroll to see the full bracket →', jpShort: 'JPN', finalShort: 'Final', champShort: 'Champ',
    bracketPredictSuffix: ' route — predicted matchups', bracketPredictNote: "Each slot = <b>likeliest team</b>. <b>Green ▶ = predicted winner</b>.",
    roundAdv: 'adv rate', hhShort: 'W',
    rdName: {R32:'Round of 32', R16:'Round of 16', QF:'Quarter-final', SF:'Semi-final', F:'Final'},
    insightHead: '📌 The story', share: 'Save result image', backTitle: '🏠 Title',
    ofScenario: 'within this future', condReach: 'if reached',
    sumWin: 'W', sumDraw: 'D', sumLoss: 'L',
  }
};
function jt(k) { const L = (window.LANG === 'en') ? 'en' : 'ja'; const v = JWC_T[L][k]; return v !== undefined ? v : (JWC_T.ja[k] !== undefined ? JWC_T.ja[k] : k); }
function jwcName(key) { return wcsimTeamName(key); }
function jwcFlag(key) { return TEAM_DATA[key] ? TEAM_DATA[key].flag : ''; }

// ------------------------------------------------------------
// 画面
// ------------------------------------------------------------
function showJWC() {
  showScreen('jwc');
  document.getElementById('jwc-title').textContent = jt('screenTitle');
  const intro = document.getElementById('jwc-intro');
  intro.innerHTML = jt('intro');
  const btn = document.getElementById('jwc-run-btn');
  btn.textContent = jt('runBtn');
  btn.disabled = false;
  btn.style.display = '';
  jwcRenderPreview();
  document.getElementById('screen-jwc').scrollTop = 0;
}

function jwcRenderPreview() {
  const keys = WCSIM_GROUPS.F;
  let html = `<div class="jwc-pre-card"><div class="jwc-pre-title">${jt('groupF')}</div><div class="jwc-pre-teams">`;
  keys.forEach(k => {
    const me = k === JWC_JP;
    html += `<div class="jwc-pre-team${me ? ' jwc-pre-me' : ''}">${jwcFlag(k)} ${jwcName(k)}</div>`;
  });
  html += `</div></div>`;
  document.getElementById('jwc-content').innerHTML = html;
}

const JWC_SCEN_META = {
  1: {key:'scenP1', color:'#ffd700', bg:'rgba(255,215,0,0.14)'},
  2: {key:'scenP2', color:'#c0c0c0', bg:'rgba(192,192,192,0.14)'},
  3: {key:'scenP3', color:'#60a5fa', bg:'rgba(96,165,250,0.16)'},
};
const _jwcPct = (a, b) => b ? Math.round(a / b * 100) : 0;
const _jwcPct1 = (a, b) => b ? (a / b * 100).toFixed(1) : '0.0';

function runJWC() {
  const top = document.getElementById('jwc-run-btn');
  const rerun = document.getElementById('jwc-rerun-btn');
  [top, rerun].forEach(b => { if (b) { b.disabled = true; b.textContent = jt('running'); } });
  // 演算は同期だが、ボタン表示を更新するため1フレーム遅延
  setTimeout(() => {
    _jwcRes = jwcRunMC(JWC_N);
    _jwcTab = 1;
    jwcRenderResults();
    if (top) top.style.display = 'none'; // 初回後は上のボタンを隠し、再演算は下部の「もう一度占う」から
  }, 30);
}

function jwcBar(pct, color, h) {
  return `<div style="height:${h||7}px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden">` +
    `<div style="height:100%;width:${Math.max(0, Math.min(100, pct))}%;background:${color};border-radius:4px;min-width:${pct>0?3:0}px"></div></div>`;
}

function jwcRenderResults() {
  const R = _jwcRes, N = R.N;
  const SC = R.scenarios;
  const p1 = R.rank[0], p2 = R.rank[1], p3q = R.thirdQual;
  const gsExit = R.rank[3] + R.thirdFail; // 4位 + 3位敗退

  let html = '';

  // --- 0) 総合の見出し（日本の優勝/決勝確率） ---
  html += `<div class="jwc-hero">` +
    `<div class="jwc-hero-row">` +
      `<div class="jwc-hero-item"><div class="jwc-hero-num" style="color:#ffd700">${_jwcPct1(R.overallChamp, N)}%</div><div class="jwc-hero-lbl">${jt('champLabel')}</div></div>` +
      `<div class="jwc-hero-item"><div class="jwc-hero-num" style="color:#7ec8f0">${_jwcPct1(R.overallFinal, N)}%</div><div class="jwc-hero-lbl">${jt('finalLabel')}</div></div>` +
      `<div class="jwc-hero-item"><div class="jwc-hero-num" style="color:#4ade80">${_jwcPct1(p1 + p2 + p3q, N)}%</div><div class="jwc-hero-lbl">${jt('qualNote').replace('※ ','').replace('* ','')}</div></div>` +
    `</div></div>`;

  // --- 1) 予選の結末（順位分布） ---
  const segs = [
    {lbl: jt('scenP1'), v: p1, c: '#ffd700'},
    {lbl: jt('scenP2'), v: p2, c: '#c0c0c0'},
    {lbl: jt('scenP3'), v: p3q, c: '#60a5fa'},
    {lbl: jt('gsExit'), v: gsExit, c: '#5b6472'},
  ];
  html += `<div class="jwc-section"><div class="jwc-sec-title">${jt('secScenario')}</div>`;
  html += `<div class="jwc-stack">`;
  segs.forEach(s => { const w = s.v / N * 100; if (w > 0.5) html += `<div class="jwc-stack-seg" style="width:${w}%;background:${s.c}" title="${s.lbl} ${w.toFixed(1)}%"></div>`; });
  html += `</div><div class="jwc-stack-legend">`;
  segs.forEach(s => { html += `<span class="jwc-leg"><span class="jwc-leg-dot" style="background:${s.c}"></span>${s.lbl} <b>${_jwcPct1(s.v, N)}%</b></span>`; });
  html += `</div></div>`;

  // --- 2) 優勝確率くらべ（3シナリオ横並び） ---
  html += `<div class="jwc-section"><div class="jwc-sec-title">${jt('secCompare')}</div><div class="jwc-compare">`;
  [1,2,3].forEach(s => {
    const sc = SC[s], m = JWC_SCEN_META[s];
    const champ = _jwcPct1(sc.champ, sc.n), fin = _jwcPct1(sc.reach.F, sc.n);
    html += `<div class="jwc-cmp-card" style="background:${m.bg};border-color:${m.color}">` +
      `<div class="jwc-cmp-head" style="color:${m.color}">${jt(m.key)}</div>` +
      `<div class="jwc-cmp-champ" style="color:${m.color}">${champ}<span class="jwc-cmp-unit">%</span></div>` +
      `<div class="jwc-cmp-sub">${jt('champLabel')}</div>` +
      `<div class="jwc-cmp-fin">${jt('finalLabel')} <b>${fin}%</b></div>` +
      `</div>`;
  });
  html += `</div>`;
  html += `<div class="jwc-insight"><div class="jwc-insight-head">${jt('insightHead')}</div><div class="jwc-insight-body">${jwcInsight(R)}</div></div>`;
  html += `</div>`;

  // --- 3) シナリオ別タブ（各通過順位の予想トーナメント＋相手＋勝率） ---
  html += `<div class="jwc-section"><div class="jwc-tab-hint">${jt('tabHint')}</div><div class="jwc-tabs">`;
  [1,2,3].forEach(s => {
    const m = JWC_SCEN_META[s];
    html += `<button class="jwc-tab" id="jwc-tab-${s}" onclick="jwcSwitchTab(${s})" data-color="${m.color}">${jt(m.key)}</button>`;
  });
  html += `</div><div id="jwc-detail"></div></div>`;

  // --- 4) シェア・もう一度 ---
  html += `<div class="jwc-section" style="text-align:center">` +
    `<button class="start-btn" id="jwc-rerun-btn" onclick="runJWC()" style="background:linear-gradient(135deg,#7b2cbf,#9d4edd);color:#fff;margin-bottom:10px">${jt('rerun')}</button>` +
    `<button class="start-btn" onclick="jwcShareImage()" style="background:linear-gradient(135deg,#1a3a6b,#0050cc);color:#fff;margin-bottom:10px">📷 ${jt('share')}</button>` +
    `<button class="start-btn" onclick="wcGoToTitle&&wcGoToTitle();showScreen('title')" style="background:rgba(255,255,255,0.15);color:#fff">${jt('backTitle')}</button>` +
    `</div>`;

  document.getElementById('jwc-content').innerHTML = html;
  jwcSwitchTab(_jwcTab);
}

function jwcSwitchTab(s) {
  _jwcTab = s;
  [1,2,3].forEach(x => {
    const el = document.getElementById('jwc-tab-' + x);
    if (!el) return;
    const m = JWC_SCEN_META[x];
    const on = x === s;
    el.style.background = on ? m.color : 'rgba(255,255,255,0.06)';
    el.style.color = on ? '#10131a' : 'rgba(255,255,255,0.6)';
    el.style.fontWeight = on ? '900' : '700';
  });
  document.getElementById('jwc-detail').innerHTML = jwcScenarioDetailHTML(s);
}

// 日本目線の縦型トーナメント表（下＝グループF起点 → 上＝優勝）
function jwcBracketHTML(sc, s) {
  const m = JWC_SCEN_META[s];
  let html = `<div class="jwc-d-block"><div class="jwc-d-title">🏆 ${jt('bracketTitle')} <span class="jwc-d-note">(${jt('ofScenario')})</span></div>`;
  html += `<div class="jwc-bracket">`;
  // 頂点: 優勝
  html += `<div class="jwc-bk-champ"><span class="jwc-bk-crown">👑</span>` +
    `<span class="jwc-bk-champ-txt">${jt('champReach')}</span>` +
    `<span class="jwc-bk-champ-pct">${_jwcPct1(sc.champ, sc.n)}%</span></div>`;
  html += `<div class="jwc-bk-arrow">▲</div>`;
  // 決勝 → R32（上から下へ）
  ['F','SF','QF','R16','R32'].forEach(rd => {
    const reach = sc.reach[rd];
    const reachPct = _jwcPct(reach, sc.n);
    const advPct = reach ? _jwcPct(sc.adv[rd], reach) : 0;
    const entries = reach ? Object.entries(sc.opp[rd]).sort((a, b) => b[1] - a[1]) : [];
    const o1 = entries[0], o2 = entries[1];
    let oppHtml;
    if (o1) {
      oppHtml = `<div class="jwc-bk-o1">${jwcFlag(o1[0])} <span class="jwc-bk-o1-nm">${jwcName(o1[0])}</span> <b>${_jwcPct(o1[1], reach)}%</b></div>`;
      if (o2 && _jwcPct(o2[1], reach) >= 8) oppHtml += `<div class="jwc-bk-o2">${jt('orLabel')} ${jwcFlag(o2[0])} ${jwcName(o2[0])} ${_jwcPct(o2[1], reach)}%</div>`;
    } else oppHtml = `<div class="jwc-bk-o1" style="opacity:.45">—</div>`;
    const dim = reachPct < 25 ? ' jwc-bk-dim' : '';
    html += `<div class="jwc-bk-rung${dim}" style="border-left-color:${m.color}">` +
      `<div class="jwc-bk-rd"><div class="jwc-bk-rd-nm">${jt('rdName')[rd]}</div><div class="jwc-bk-reach">${jt('reachRate')} ${reachPct}%</div></div>` +
      `<div class="jwc-bk-mid">${oppHtml}</div>` +
      `<div class="jwc-bk-win" style="color:${advPct >= 50 ? '#4ade80' : '#f87171'}">${advPct}<small>%</small><div class="jwc-bk-win-lbl">${jt('roundWin')}</div></div>` +
      `</div>`;
    html += `<div class="jwc-bk-arrow">▲</div>`;
  });
  // 起点: 日本（グループF）
  html += `<div class="jwc-bk-start"><span class="jwc-bk-jp">${jwcFlag(JWC_JP)} ${jt('japanLabel')}</span>` +
    `<span class="jwc-bk-scen" style="background:${m.color}">${jt(m.key)}</span></div>`;
  html += `</div></div>`;
  return html;
}

function jwcScenarioDetailHTML(s) {
  const sc = _jwcRes.scenarios[s], m = JWC_SCEN_META[s];
  if (!sc.n) return `<div class="jwc-empty">${jt('noData')}</div>`;

  // ラウンド別 対戦相手の確率（上）
  let html = `<div class="jwc-d-block"><div class="jwc-d-title">⚔️ ${jt('oppByRound')}</div>`;
  ['R32','R16','QF','SF','F'].forEach(rd => {
    const reach = sc.reach[rd]; if (!reach) return;
    const o = sc.opp[rd];
    const entries = Object.entries(o).sort((a, b) => b[1] - a[1]);
    const limit = rd === 'R32' ? 8 : 5;
    const top = entries.slice(0, limit);
    const winPct = _jwcPct(sc.adv[rd], reach);
    html += `<div class="jwc-round">` +
      `<div class="jwc-round-head">` +
        `<span class="jwc-round-name">${jt('rdName')[rd]}</span>` +
        `<span class="jwc-round-meta"><span class="jwc-round-reach">${jt('reachRate')} ${_jwcPct(reach, sc.n)}%</span>` +
        `<span class="jwc-round-win" style="color:${winPct >= 50 ? '#4ade80' : '#f87171'}">${jt('roundAdv')} ${winPct}%</span></span>` +
      `</div><div class="jwc-opp-list">`;
    top.forEach(([k, v]) => {
      const pct = _jwcPct(v, reach);
      const hh = _jwcPct((sc.oppWin[rd] || {})[k] || 0, v); // その相手単独に対する勝率
      html += `<div class="jwc-opp"><span class="jwc-opp-name">${jwcFlag(k)} ${jwcName(k)}</span>` +
        `<span class="jwc-opp-bar">${jwcBar(pct, m.color, 6)}</span>` +
        `<span class="jwc-opp-pct">${pct}%</span>` +
        `<span class="jwc-opp-hh">${jt('hhShort')}${hh}%</span></div>`;
    });
    html += `</div></div>`;
  });
  html += `</div>`;

  // トーナメント予想（下）
  html += `<div class="jwc-d-block"><div class="jwc-d-title">🗺️ ${jt(m.key)}${jt('bracketPredictSuffix')}</div>` +
    `<div class="jwc-fb-note">${jt('bracketPredictNote')}</div>` +
    `<div class="jwc-fb-scroll">${jwcFullBracketSVG(window.LANG === 'en', s, sc)}</div>` +
    `<div class="jwc-fb-hint">${jt('scrollHint')}</div></div>`;

  return html;
}

// ------------------------------------------------------------
// 全体トーナメント表（公式ブラケット構造をSVGで再現・日本の入る枠をハイライト）
// ------------------------------------------------------------
// R32スロット定義 → ラベル文字列（"E組1位" / "3位(A/B/C/D/F)"）
function jwcSlotLabel(slot, isEn) {
  if (slot.t === 'W') return isEn ? slot.g + ' 1st' : slot.g + '組1位';
  if (slot.t === 'R') return isEn ? slot.g + ' 2nd' : slot.g + '組2位';
  return isEn ? '3rd (' + slot.allowed.join('/') + ')' : '3位(' + slot.allowed.join('/') + ')';
}
// スロットが日本の入り得る枠か（1=F組1位 / 2=F組2位 / 3=3位でFを含む枠）→ シナリオ番号 or 0
function jwcSlotJP(slot) {
  if (slot.t === 'W' && slot.g === 'F') return 1;
  if (slot.t === 'R' && slot.g === 'F') return 2;
  if (slot.t === 'T' && slot.allowed.includes('F')) return 3;
  return 0;
}

// scen(1/2/3) と そのシナリオ集計 sc を渡すと、日本の最有力ルートに
// 「対戦確率の高い相手＋勝率」を埋め込んだ予想ブラケットを返す。
function jwcFullBracketSVG(isEn, scen, sc) {
  // 決勝(104)を根に、各試合の子（前ラウンド2試合）を辿って木を構築
  const childMap = {104: [101, 102]};
  WCSIM_SF_DEFS.forEach(d => childMap[d[0]] = [d[1], d[2]]);
  WCSIM_QF_DEFS.forEach(d => childMap[d[0]] = [d[1], d[2]]);
  WCSIM_R16_DEFS.forEach(d => childMap[d[0]] = [d[1], d[2]]);
  const parentOf = {}; Object.keys(childMap).forEach(p => childMap[p].forEach(c => parentOf[c] = +p));
  const r32def = {}; WCSIM_R32_DEFS.forEach(d => r32def[d.match] = d);
  const colOf = no => no <= 88 ? 0 : (no <= 96 ? 1 : (no <= 100 ? 2 : (no <= 102 ? 3 : 4)));

  const pitch = 56, boxW = 168, boxH = 46, top = 54;
  const colX = [8, 226, 400, 568, 730], intW = 128, finW = 150;
  const colWidth = c => c === 0 ? boxW : (c === 4 ? finW : intW);

  const nodes = {}; let leaf = 0;
  (function layout(no) {
    const ch = childMap[no];
    if (!ch) { const n = {no, y: top + leaf * pitch + boxH / 2, col: 0}; leaf++; nodes[no] = n; return n; }
    const a = layout(ch[0]), b = layout(ch[1]);
    const n = {no, y: (a.y + b.y) / 2, col: colOf(no), ch: [a, b]}; nodes[no] = n; return n;
  })(104);

  const H = top + 16 * pitch + 8, W = colX[4] + finW + 10;
  const color = {1: '#ffd700', 2: '#c0c0c0', 3: '#60a5fa'}[scen];

  // --- 日本のルートと対戦相手・勝率を算出 ---
  const entry = scen === 1 ? 75 : scen === 2 ? 76
    : (Object.keys(sc.entry).length ? +Object.entries(sc.entry).sort((a, b) => b[1] - a[1])[0][0] : 74);
  const p1 = parentOf[entry], p2 = parentOf[p1], p3 = parentOf[p2], p4 = parentOf[p3]; // p4=104
  const jpNodeRound = {[p1]: 'R16', [p2]: 'QF', [p3]: 'SF', [p4]: 'F'};
  const pathChild = new Set([entry, p1, p2, p3]); // 日本が勝ち上がる辺
  const ed = r32def[entry], jpHome = jwcSlotJP(ed.home) === scen;
  const jpName = isEn ? 'JPN' : '日本';
  const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  // 各スロットを最も多く占有したチーム（全チーム表示用）。日本のスロットは '__JP__'
  const JP = JWC_JP, gp = _jwcRes.groupPos || {}, ts = _jwcRes.tslotCount || {};
  const modalTeam = (counts, ...excl) => { let best = null, bc = -1; for (const k in (counts || {})) { if (excl.indexOf(k) >= 0) continue; if (counts[k] > bc) { bc = counts[k]; best = k; } } return best; };
  // 全R32枠の表示チームを一意に解決（1位→2位→3位の順で最頻チームを割当し、全枠で重複しないようにする）
  const slotResolved = {}, used = new Set();
  WCSIM_R32_DEFS.forEach(d => [['home', d.home], ['away', d.away]].forEach(([side, slot]) => {
    if ((slot.t === 'W' && slot.g === 'F' && scen === 1) || (slot.t === 'R' && slot.g === 'F' && scen === 2) || (slot.t === 'T' && scen === 3 && d.match === entry)) slotResolved[d.match + side] = '__JP__';
  }));
  [['W', (d, s) => gp[s.g] && gp[s.g][0]], ['R', (d, s) => gp[s.g] && gp[s.g][1]], ['T', (d) => ts[d.match]]].forEach(([t, cf]) => {
    WCSIM_R32_DEFS.forEach(d => [['home', d.home], ['away', d.away]].forEach(([side, slot]) => {
      const key = d.match + side;
      if (slotResolved[key] !== undefined || slot.t !== t) return;
      const tk = modalTeam(cf(d, slot), JP, ...used);
      if (tk) used.add(tk);
      slotResolved[key] = tk || null;
    }));
  });
  const slotTeam = (matchNo, side) => slotResolved[matchNo + side];
  // 内部ノード(R16以降)の予想勝者: 日本ルートは日本、それ以外はレーティング上位が勝ち上がる（連結した予想ブラケット）
  const _winCache = {};
  const _higher = (a, b) => !a ? b : !b ? a : ((_jwcRating[a] || 0) >= (_jwcRating[b] || 0) ? a : b);
  const nodeWinner = no => {
    if (_winCache[no] !== undefined) return _winCache[no];
    const n = nodes[no];
    let w;
    if (no === entry || jpNodeRound[no] !== undefined) w = '__JP__';
    else if (n.col === 0) w = _higher(slotResolved[no + 'home'], slotResolved[no + 'away']);
    else w = _higher(nodeWinner(n.ch[0].no), nodeWinner(n.ch[1].no));
    _winCache[no] = w;
    return w;
  };

  let lines = '', boxes = '', labels = '';

  // 接続線（日本ルートは色付き）
  Object.values(nodes).forEach(n => {
    if (!n.ch) return;
    const nx = colX[n.col];
    n.ch.forEach(c => {
      const cx = colX[c.col] + colWidth(c.col), midX = (cx + nx) / 2;
      const on = pathChild.has(c.no) && parentOf[c.no] === n.no;
      lines += `<polyline points="${cx},${c.y} ${midX},${c.y} ${midX},${n.y} ${nx},${n.y}" fill="none" stroke="${on ? color : 'rgba(255,255,255,0.22)'}" stroke-width="${on ? 2.6 : 1.3}"/>`;
    });
  });

  // ラウンド見出し
  const heads = isEn ? ['R32', 'R16', 'QF', 'SF', 'FINAL'] : ['ベスト32', 'ベスト16', '準々決勝', '準決勝', '決勝'];
  heads.forEach((h, i) => { labels += `<text x="${colX[i] + colWidth(i) / 2}" y="32" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-size="13" font-weight="700">${h}</text>`; });

  // 内部ノード（日本=色付き＋勝率 / 相手フィーダー=相手＋確率 / その他=空枠 / 決勝=トロフィー）
  Object.values(nodes).forEach(n => {
    if (n.col === 0) return;
    const x = colX[n.col], w = colWidth(n.col), y = n.y, isJp = jpNodeRound[n.no];
    if (n.col === 4) {
      boxes += `<rect x="${x}" y="${y - 28}" width="${w}" height="56" rx="10" fill="${isJp ? 'rgba(255,215,0,0.18)' : 'rgba(255,215,0,0.08)'}" stroke="#ffd700" stroke-width="2"/>`;
      labels += `<text x="${x + w / 2}" y="${isJp ? y - 4 : y - 1}" text-anchor="middle" font-size="22">🏆</text>`;
      labels += `<text x="${x + w / 2}" y="${y + 20}" text-anchor="middle" fill="#ffd700" font-size="${isJp ? 13 : 12}" font-weight="800">${isJp ? '🇯🇵 ' + jpName : (isEn ? 'CHAMPION' : '優勝')}</text>`;
      return;
    }
    if (isJp) {
      boxes += `<rect x="${x}" y="${y - 15}" width="${w}" height="30" rx="6" fill="${color}"/>`;
      labels += `<text x="${x + 8}" y="${y + 4}" fill="#10131a" font-size="12" font-weight="800">🇯🇵 ${jpName}</text>`;
    } else {
      const wt = nodeWinner(n.no);
      boxes += `<rect x="${x}" y="${y - 14}" width="${w}" height="28" rx="6" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>`;
      if (wt && wt !== '__JP__') labels += `<text x="${x + 7}" y="${y + 4}" fill="rgba(255,255,255,0.82)" font-size="10.5">${jwcFlag(wt)} ${clip(jwcName(wt), 8)}</text>`;
    }
  });

  // R32枠
  WCSIM_R32_DEFS.forEach(d => {
    const n = nodes[d.match], x = colX[0], y = n.y;
    boxes += `<rect x="${x}" y="${y - boxH / 2}" width="${boxW}" height="${boxH}" rx="7" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.13)" stroke-width="1"/>`;
    if (d.match === entry) {
      // 日本 vs 最有力R32相手 ＋ 勝率
      boxes += `<line x1="${x}" y1="${y}" x2="${x + boxW}" y2="${y}" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>`;
      const jpY = jpHome ? y - boxH / 2 : y, opY = jpHome ? y : y - boxH / 2;
      const oppK = slotTeam(entry, jpHome ? 'away' : 'home');
      boxes += `<rect x="${x + 1.5}" y="${jpY + 1.5}" width="${boxW - 3}" height="${boxH / 2 - 3}" rx="5" fill="${color}"/>`;
      labels += `<text x="${x + 8}" y="${jpY + boxH / 4 + 4}" fill="#10131a" font-size="12" font-weight="800">🇯🇵 ${jpName}</text>`;
      if (oppK && oppK !== '__JP__') {
        boxes += `<rect x="${x + 1.5}" y="${opY + 1.5}" width="${boxW - 3}" height="${boxH / 2 - 3}" rx="5" fill="rgba(255,255,255,0.12)"/>`;
        labels += `<text x="${x + 8}" y="${opY + boxH / 4 + 4}" fill="#fff" font-size="11" font-weight="700">${jwcFlag(oppK)} ${clip(jwcName(oppK), 11)}</text>`;
      }
    } else {
      // 日本と無関係の枠も最頻チームで全表示。予想勝者を明るく＋緑▶、敗者は減光
      boxes += `<line x1="${x}" y1="${y}" x2="${x + boxW}" y2="${y}" stroke="rgba(255,255,255,0.13)" stroke-width="1"/>`;
      const winner = nodeWinner(d.match);
      [['home', d.home, y - boxH / 4 + 4], ['away', d.away, y + boxH / 4 + 4]].forEach(([side, slot, ty]) => {
        const tk = slotTeam(d.match, side);
        const isWin = !!tk && tk === winner;
        const txt = tk === '__JP__' ? ('🇯🇵 ' + jpName) : (tk ? jwcFlag(tk) + ' ' + clip(jwcName(tk), 9) : jwcSlotLabel(slot, isEn));
        labels += `<text x="${x + 8}" y="${ty}" fill="${isWin ? '#fff' : 'rgba(255,255,255,0.36)'}" font-size="10.5"${isWin ? ' font-weight="700"' : ''}>${txt}</text>`;
        if (isWin) labels += `<text x="${x + boxW - 9}" y="${ty}" fill="#4ade80" font-size="10" font-weight="700">▶</text>`;
      });
    }
  });

  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-family="'Noto Sans JP',sans-serif">${lines}${boxes}${labels}</svg>`;
}

// データ駆動の読みどころ生成
function jwcInsight(R) {
  const SC = R.scenarios, isEn = window.LANG === 'en';
  const champs = [SC[1].champ / SC[1].n, SC[2].champ / SC[2].n, SC[3].champ / SC[3].n].map(x => x * 100);
  const best = champs.indexOf(Math.max(...champs)) + 1;
  const spread = Math.max(...champs) - Math.min(...champs);
  const sName = {1: jt('scenP1'), 2: jt('scenP2'), 3: jt('scenP3')};
  if (isEn) {
    let t1 = `Finishing <b>${sName[best]}</b> gives the highest title odds (${champs[best-1].toFixed(1)}%), but the three routes differ by only <b>${spread.toFixed(1)}pt</b> — your group position barely changes Japan's ceiling.`;
    let t2 = ` The reason: Group C sits right next door. Finish 1st and your likeliest Round of 32 foe is <b>Morocco</b>; finish 2nd and it's <b>Brazil</b>. Sneak through 3rd and you dodge them — but most likely run into a strong <b>France</b> instead.`;
    return t1 + t2;
  }
  let t1 = `優勝確率が最も高いのは<b>${sName[best]}</b>（${champs[best-1].toFixed(1)}%）。だが3ルートの差はわずか<b>${spread.toFixed(1)}ポイント</b>——通過順位は日本の天井をほとんど変えない。`;
  let t2 = `理由は隣のグループC。1位通過なら最有力相手は<b>モロッコ</b>、2位なら<b>ブラジル</b>。3位通過だと彼らを回避できるが、強豪<b>フランス</b>と当たる可能性が一番高い。`;
  return t1 + t2;
}

// ------------------------------------------------------------
// シェア画像（1080×1080）
// ------------------------------------------------------------
function jwcShareImage() {
  if (!_jwcRes) return;
  const isEn = window.LANG === 'en';
  const S = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  jwcDrawShareCanvas(ctx, _jwcRes, isEn, S);

  canvas.toBlob(function(blob) {
    const file = new File([blob], 'japan-destiny.png', {type: 'image/png'});
    const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
    const text = isEn ? "🇯🇵 Japan's World Cup destiny — simulated" : '🇯🇵 日本代表・運命の分岐をシミュレート';
    if (isMobile && navigator.canShare && navigator.canShare({files: [file]})) {
      navigator.share({files: [file], title: 'Football Sim', text: text + '\nhttps://football-sim.com/'})
        .catch(err => { if (err.name !== 'AbortError') _jwcDownload(canvas); });
    } else { _jwcDownload(canvas); }
  }, 'image/png');
}
function _jwcDownload(canvas) {
  const link = document.createElement('a');
  link.download = 'japan-destiny.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function jwcDrawShareCanvas(ctx, R, isEn, S) {
  const cx = S / 2;
  const tc = (txt, x, y, font, color, maxW) => { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'center'; if (maxW) ctx.fillText(txt, x, y, maxW); else ctx.fillText(txt, x, y); };

  // 背景（紺グラデ）
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, '#06183f'); g.addColorStop(0.55, '#0a275f'); g.addColorStop(1, '#0d1b3e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);

  tc('🇯🇵', cx, 150, '90px Arial', '#fff');
  tc(isEn ? "JAPAN'S DESTINY SPLIT" : '日本代表・運命の分岐', cx, 230, '900 56px Arial', '#fff', S - 100);
  tc(isEn ? '2026 World Cup — Group F qualification routes' : '2026 W杯 グループF 通過順位別シミュレーション', cx, 282, '500 26px Arial', '#7ec8f0', S - 120);

  const SC = R.scenarios, N = R.N;
  const meta = [
    {s:1, lbl: isEn ? '1ST' : '1位通過', c:'#ffd700'},
    {s:2, lbl: isEn ? '2ND' : '2位通過', c:'#c0c0c0'},
    {s:3, lbl: isEn ? '3RD' : '3位通過', c:'#60a5fa'},
  ];
  const colW = 300, gap = 24, totalW = colW * 3 + gap * 2;
  const x0 = (S - totalW) / 2;
  meta.forEach((mt, i) => {
    const x = x0 + i * (colW + gap);
    const y = 360, h = 470;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    _jwcRoundRect(ctx, x, y, colW, h, 22); ctx.fill();
    ctx.strokeStyle = mt.c; ctx.lineWidth = 3; _jwcRoundRect(ctx, x, y, colW, h, 22); ctx.stroke();
    const ccx = x + colW / 2, sc = SC[mt.s];
    tc(mt.lbl, ccx, y + 64, '800 38px Arial', mt.c);
    tc((sc.n / N * 100).toFixed(0) + '%', ccx, y + 116, '700 30px Arial', 'rgba(255,255,255,0.55)');
    tc(isEn ? 'finish prob.' : 'この通過率', ccx, y + 150, '400 22px Arial', 'rgba(255,255,255,0.4)');
    // 優勝率
    tc((sc.champ / sc.n * 100).toFixed(1), ccx, y + 270, '900 96px Arial', mt.c);
    tc('%', ccx, y + 320, '700 36px Arial', mt.c);
    tc(isEn ? 'TITLE ODDS' : '優勝確率', ccx, y + 360, '700 26px Arial', 'rgba(255,255,255,0.7)');
    // 決勝進出
    tc((isEn ? 'Final ' : '決勝進出 ') + (sc.reach.F / sc.n * 100).toFixed(1) + '%', ccx, y + 424, '600 26px Arial', '#7ec8f0');
  });

  tc(isEn ? `Japan to win it all: ${(R.overallChamp / N * 100).toFixed(1)}%  ·  reach final: ${(R.overallFinal / N * 100).toFixed(1)}%`
          : `日本の優勝確率 ${(R.overallChamp / N * 100).toFixed(1)}%  ／  決勝進出 ${(R.overallFinal / N * 100).toFixed(1)}%`,
     cx, 902, '700 30px Arial', '#fff', S - 100);

  ctx.beginPath(); ctx.moveTo(140, 960); ctx.lineTo(S - 140, 960);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 2; ctx.stroke();
  tc('⚽ Football Sim', cx, 1010, '700 32px Arial', 'rgba(255,255,255,0.85)');
  tc('football-sim.com', cx, 1050, '400 24px Arial', 'rgba(255,255,255,0.5)');
}
function _jwcRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ------------------------------------------------------------
// タイトル画面カードの言語切替（players.js の i18n を触らず applyLang をラップ）
// ------------------------------------------------------------
function jwcApplyCardLang() {
  const lbl = document.getElementById('top-lbl-jwc');
  const desc = document.getElementById('top-desc-jwc');
  if (lbl) lbl.textContent = jt('menuLabel');
  if (desc) desc.textContent = jt('menuDesc');
}
if (typeof applyLang === 'function' && !applyLang._jwcWrapped) {
  const _origApplyLang = applyLang;
  applyLang = function () { _origApplyLang.apply(this, arguments); jwcApplyCardLang(); };
  applyLang._jwcWrapped = true;
}
