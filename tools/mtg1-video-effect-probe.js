/**
 * mtg1-video-effect-probe.js — 「ビデオ対策」の実効果を実測する探り針（計測専用・出荷物ではない）
 *
 * 目的: 監督のジャッジで「判定不能」が多発する原因が
 *   (a) 判定ロジックが鈍いのか
 *   (b) そもそも効果が1試合では検出できないほど小さいのか
 *   を切り分ける。エンジンは一切改変せず、managerParamFactor（league.js と同じ純関数の形）
 *   を headless の global として差し込み、対策の有無で「対<攻め筋>」の阻止率を比較する。
 *
 * ⚠️ 2026-08-04: この計測が根拠となり「攻め筋への対策」自体がユーザー判断で廃止された
 *   （効果 = 5%×戦術眼/100 ＝ 初期値+1%。実測4000試合で差 0.00pt、1試合のばらつき ±14.9pt）。
 *   機能は既に無いので**このスクリプトは動かない**。廃止判断の根拠を残すための資料として保存する。
 *
 * 使い方（歴史的記録）: node tools/mtg1-video-effect-probe.js [試合数]
 */
'use strict';
const { loadEngine } = require('./lib/load-engine');

const N = parseInt(process.argv[2], 10) || 3000;
const TARGET = 'ショートパス';                 // 対策する攻め筋（ジャッジ画面の実例に合わせる）
const DEF_ACTION = '対' + TARGET;              // 守備側アクション名（simulate.js の規約）
const CARD = ['england2026', 'belgium2026'];   // ジャッジ画面と同じカード

const api = loadEngine();

function makeTeam(data) {
  const sysIdx = api.system_data.findIndex(s => s.name === data.default_system);
  return api.buildTeam(data, {
    systemIdx: sysIdx >= 0 ? sysIdx : 0,
    tactics: data.default_tactics,
    keyplayer: data.default_keyplayer,
    marked_player: data.default_marked_player !== undefined ? data.default_marked_player : -1,
    lineup: [...data.default_lineup.slice(0, 11)]
  });
}

/* 対策の強さ（league.js の実装と同じ式）:
 *   buff = BUFF_MAX(0.05) × tactical / 100     →  tactical 20 なら +1%, 100 なら +5% */
function setBuff(myTeamName, buff) {
  api.ctx.managerParamFactor = (buff === 0) ? undefined : function (team, p, action) {
    if (!team || team.name !== myTeamName) return 1.0;
    if (action !== DEF_ACTION) return 1.0;
    return Math.max(0.95, Math.min(1.05, 1 + buff));
  };
}

/* 1試合まわして「対<攻め筋>」のデュエル数と阻止数を数える。
 * 阻止＝攻撃側が失敗した結果（成功以外）。regression-harness の playMatch と同じ手順。 */
function runMatch(d1, d2, acc) {
  const t1 = makeTeam(d1), t2 = makeTeam(d2);
  [t1, t2].forEach(t => {
    t.score = 0; t.chanceCounter = 0; t.shootCounter = 0; t.gkSaveCounter = 0;
    t.players.forEach(p => { p.chance_counter = 0; p.fatigue = 0; });
  });
  const gs = { team1: t1, team2: t2 };
  const n = api.MATCH_CHANCES + (Math.random() < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const res = api.simulateChance(gs, i);
    for (const sc of res.scenes) {
      // team2（相手）が TARGET を仕掛け、team1（自チーム）が守るシーンだけ数える
      if (sc.action !== TARGET) continue;
      if (sc.offence !== t2) continue;
      acc.duels++;
      if (sc.result !== '成功') acc.stops++;
    }
  }
}

function measure(label, buff) {
  const d1 = api.TEAM_DATA[CARD[0]], d2 = api.TEAM_DATA[CARD[1]];
  const t1name = d1.name;
  setBuff(t1name, buff);
  const acc = { duels: 0, stops: 0 };
  const perMatch = [];
  for (let i = 0; i < N; i++) {
    const before = { d: acc.duels, s: acc.stops };
    runMatch(d1, d2, acc);
    perMatch.push({ d: acc.duels - before.d, s: acc.stops - before.s });
  }
  const rate = acc.duels ? acc.stops / acc.duels : 0;
  return { label, buff, duels: acc.duels, stops: acc.stops, rate, perMatch,
    duelsPerMatch: acc.duels / N };
}

/* 「1試合で判定できるか」の目安: 阻止率の1試合あたり標準誤差 ≒ sqrt(p(1-p)/n) */
function detectability(base, buffed) {
  const p = base.rate;
  const n = base.duelsPerMatch;
  const se1 = Math.sqrt(p * (1 - p) / n);              // 1試合ぶんのばらつき
  const delta = buffed.rate - base.rate;               // 対策で動いた量
  const matchesNeeded = delta === 0 ? Infinity
    : Math.ceil(Math.pow(1.96 * Math.sqrt(p * (1 - p)) / delta, 2) / n);
  return { se1, delta, matchesNeeded };
}

console.log(`\n=== ビデオ対策「${TARGET}」の実効果 (${CARD[0]} vs ${CARD[1]} / ${N}試合) ===\n`);

const base = measure('対策なし', 0);
const t20  = measure('tactical 20（新米＝初期値）', 0.05 * 0.20);
const t50  = measure('tactical 50（中堅）', 0.05 * 0.50);
const t100 = measure('tactical 100（上限）', 0.05 * 1.00);

const rows = [base, t20, t50, t100];
console.log('条件                              buff    阻止率     1試合の対戦数');
for (const r of rows) {
  console.log(
    r.label.padEnd(30, ' ') +
    ('+' + (r.buff * 100).toFixed(1) + '%').padStart(7, ' ') +
    ('  ' + (r.rate * 100).toFixed(2) + '%').padStart(11, ' ') +
    ('  ' + r.duelsPerMatch.toFixed(1) + '本').padStart(13, ' ')
  );
}

console.log('\n--- 「1試合で効果が見えるか」---');
for (const r of [t20, t50, t100]) {
  const d = detectability(base, r);
  console.log(
    `${r.label}\n` +
    `   対策で動く量        : ${(d.delta * 100).toFixed(2)} ポイント\n` +
    `   1試合のばらつき(±1σ): ${(d.se1 * 100).toFixed(2)} ポイント  ← これより小さい変化は1試合では見えない\n` +
    `   有意に見えるのに必要 : 約 ${d.matchesNeeded === Infinity ? '∞' : d.matchesNeeded} 試合\n`
  );
}

// 1試合の阻止率が「対策なし」でどれだけ散るか（判定不能が出る理由の可視化）
const spread = base.perMatch.filter(m => m.d >= 5).map(m => m.s / m.d).sort((a, b) => a - b);
if (spread.length > 20) {
  const q = f => (spread[Math.floor(spread.length * f)] * 100).toFixed(0) + '%';
  console.log('--- 対策なしでも1試合の阻止率はここまで散る（対戦5本以上の試合）---');
  console.log(`   下位10% ${q(0.10)} / 中央 ${q(0.50)} / 上位10% ${q(0.90)}`);
  console.log(`   ＝ 判定しきい値（40%以下＝効かず / 60%以上＝刺さった）は、対策の有無と無関係に毎試合またぐ`);
}
console.log('');
