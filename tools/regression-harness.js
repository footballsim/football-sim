#!/usr/bin/env node
/**
 * regression-harness.js — 試合エンジンの統計的回帰テスト（Sprint 0 の安全網）。
 *
 * 目的: エンジンに手を入れた時に「得点率・勝敗分布・イベント発生率」が静かに
 *   ドリフトしていないかを機械判定する。本番(football-sim.com)稼働中でも、
 *   エージェントの自動変更を安全に通すための QA ゲート。
 *
 * 仕組み: 代表的な複数カードを N 試合ずつ回し、勝分負・平均得点・シーン結果種別の
 *   発生率を集計する。simulateSilent と同じ手順で simulateChance を回し、生シーンを
 *   集めて結果種別（成功/失敗/カウンター/ゴール/ファール/セーブ/枠外/ブロック…）を数える。
 *   → 怪我/退場を追加した後は、この発生率テーブルにカード率・怪我率が増える形になる。
 *
 * 使い方:
 *   node tools/regression-harness.js baseline [N]   # 基準スナップショットを生成（tools/baseline.json）
 *   node tools/regression-harness.js check    [N]   # 基準と比較。許容差を超えたら exit 1
 *   node tools/regression-harness.js report   [N]   # 集計を表示するだけ（基準を更新しない）
 *
 * 注意: 確率的なので check は許容差で判定する。将来シード可能 RNG を入れれば
 *   完全再現での厳密比較も可能になる（BACKLOG: seeded-rng）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEngine } = require('./lib/load-engine');

const BASELINE_PATH = path.join(__dirname, 'baseline.json');

// 代表カード（強弱の広がりを持たせる）。キーは TEAM_DATA のキー。
const MATCHUPS = [
  ['japan2026vsNetherlands', 'netherlands2026'], // 拮抗（既定の主力カード）
  ['japan2026vsNetherlands', 'brazil2026'],      // 日本=格下
  ['japan2026vsTunisia',     'tunisia2026'],      // 日本=格上
  ['brazil2026',             'argentina2026'],    // 強豪同士
  ['germany2026',            'usa2026'],           // FC26 データ準拠ペア
  ['spain2026',              'morocco2026'],       // 中堅含む
];

// 許容差（check モードの合否判定）
const TOL = {
  wdlPct: 5.0,      // 勝/分/負 の各%（パーセンテージポイント）
  avgGoals: 0.20,   // 平均得点（チーム毎）
  totalGoals: 0.25, // 平均合計得点
  resultRate: 0.020 // シーン結果種別の発生率（割合、絶対差）
};

function makeTeam(api, data) {
  const sysIdx = api.system_data.findIndex(s => s.name === data.default_system);
  const state = {
    systemIdx: sysIdx >= 0 ? sysIdx : 0,
    tactics: data.default_tactics,
    keyplayer: data.default_keyplayer,
    marked_player: data.default_marked_player !== undefined ? data.default_marked_player : -1,
    lineup: [...data.default_lineup.slice(0, 11)]
  };
  return api.buildTeam(data, state);
}

// simulateSilent と同じ手順で 1 試合回し、スコアと生シーンを返す。
function playMatch(api, d1, d2, resultCounts) {
  const t1 = makeTeam(api, d1), t2 = makeTeam(api, d2);
  [t1, t2].forEach(t => {
    t.score = 0; t.chanceCounter = 0; t.shootCounter = 0; t.gkSaveCounter = 0;
    t.players.forEach(p => { p.chance_counter = 0; p.fatigue = 0; });
  });
  const gs = { team1: t1, team2: t2 };
  const n = 16 + (Math.random() < 0.5 ? 1 : 0); // simulateSilent と同一
  for (let i = 0; i < n; i++) {
    const res = api.simulateChance(gs, i);
    for (const sc of res.scenes) {
      resultCounts[sc.result] = (resultCounts[sc.result] || 0) + 1;
      resultCounts.__total++;
    }
  }
  return { t1score: t1.score, t2score: t2.score };
}

function runMatchup(api, k1, k2, N, resultCounts) {
  const d1 = api.TEAM_DATA[k1], d2 = api.TEAM_DATA[k2];
  if (!d1 || !d2) throw new Error(`TEAM_DATA に未定義のカード: ${k1} vs ${k2}`);
  let w = 0, d = 0, l = 0, g1 = 0, g2 = 0;
  for (let i = 0; i < N; i++) {
    const r = playMatch(api, d1, d2, resultCounts);
    g1 += r.t1score; g2 += r.t2score;
    if (r.t1score > r.t2score) w++;
    else if (r.t1score === r.t2score) d++;
    else l++;
  }
  return {
    matchup: `${k1} vs ${k2}`,
    n: N,
    winPct:  +(w / N * 100).toFixed(2),
    drawPct: +(d / N * 100).toFixed(2),
    lossPct: +(l / N * 100).toFixed(2),
    avgT1Goals: +(g1 / N).toFixed(3),
    avgT2Goals: +(g2 / N).toFixed(3),
    avgTotalGoals: +((g1 + g2) / N).toFixed(3),
  };
}

function run(N) {
  const api = loadEngine();
  const resultCounts = { __total: 0 };
  const t0 = Date.now();
  const matchups = MATCHUPS.map(([a, b]) => runMatchup(api, a, b, N, resultCounts));
  const ms = Date.now() - t0;

  // シーン結果種別の発生率（割合）
  const sceneResultRates = {};
  for (const k of Object.keys(resultCounts)) {
    if (k === '__total') continue;
    sceneResultRates[k] = +(resultCounts[k] / resultCounts.__total).toFixed(5);
  }
  const totalGoalsAll = matchups.reduce((s, m) => s + m.avgTotalGoals, 0) / matchups.length;

  return {
    generatedAt: new Date().toISOString(),
    nMatchesPerMatchup: N,
    elapsedMs: ms,
    totalScenes: resultCounts.__total,
    globalAvgTotalGoals: +totalGoalsAll.toFixed(3),
    sceneResultRates,
    matchups,
  };
}

function printReport(snap) {
  console.log(`\n試合エンジン回帰レポート  (N=${snap.nMatchesPerMatchup}/カード, ${snap.elapsedMs}ms)`);
  console.log('='.repeat(72));
  for (const m of snap.matchups) {
    console.log(`  ${m.matchup}`);
    console.log(`     勝${m.winPct}%  分${m.drawPct}%  負${m.lossPct}%  ` +
                `得点 ${m.avgT1Goals} - ${m.avgT2Goals}  (計 ${m.avgTotalGoals})`);
  }
  console.log('-'.repeat(72));
  console.log(`  全体 平均合計得点: ${snap.globalAvgTotalGoals}   総シーン数: ${snap.totalScenes}`);
  console.log('  シーン結果種別 発生率:');
  for (const [k, v] of Object.entries(snap.sceneResultRates).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${(v * 100).toFixed(2).padStart(6)}%  ${k}`);
  }
  console.log('='.repeat(72));
}

function compare(base, cur) {
  const issues = [];
  const baseByKey = Object.fromEntries(base.matchups.map(m => [m.matchup, m]));
  for (const m of cur.matchups) {
    const b = baseByKey[m.matchup];
    if (!b) { issues.push(`新規カード（基準なし）: ${m.matchup}`); continue; }
    const chk = (label, cv, bv, tol) => {
      if (Math.abs(cv - bv) > tol) issues.push(`${m.matchup} ${label}: ${bv} → ${cv} (許容±${tol})`);
    };
    chk('勝%', m.winPct, b.winPct, TOL.wdlPct);
    chk('分%', m.drawPct, b.drawPct, TOL.wdlPct);
    chk('負%', m.lossPct, b.lossPct, TOL.wdlPct);
    chk('平均T1得点', m.avgT1Goals, b.avgT1Goals, TOL.avgGoals);
    chk('平均T2得点', m.avgT2Goals, b.avgT2Goals, TOL.avgGoals);
    chk('平均合計得点', m.avgTotalGoals, b.avgTotalGoals, TOL.totalGoals);
  }
  // シーン結果種別の発生率（既知の種別のみ。新種別＝怪我/カード追加時は別途許容する）
  for (const [k, bv] of Object.entries(base.sceneResultRates)) {
    const cv = cur.sceneResultRates[k] || 0;
    if (Math.abs(cv - bv) > TOL.resultRate) {
      issues.push(`結果種別 "${k}" 発生率: ${(bv * 100).toFixed(2)}% → ${(cv * 100).toFixed(2)}% (許容±${(TOL.resultRate * 100).toFixed(1)}pt)`);
    }
  }
  return issues;
}

function main() {
  const mode = process.argv[2] || 'report';
  const N = parseInt(process.argv[3] || (mode === 'baseline' ? '2000' : '1500'), 10);

  if (mode === 'baseline') {
    const snap = run(N);
    printReport(snap);
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(snap, null, 2));
    console.log(`\n基準を書き出しました: ${path.relative(process.cwd(), BASELINE_PATH)}`);
    return;
  }

  if (mode === 'report') {
    printReport(run(N));
    return;
  }

  if (mode === 'check') {
    if (!fs.existsSync(BASELINE_PATH)) {
      console.error('基準がありません。先に `node tools/regression-harness.js baseline` を実行してください。');
      process.exit(2);
    }
    const base = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    const cur = run(N);
    printReport(cur);
    const issues = compare(base, cur);
    if (issues.length) {
      console.log('\n❌ 回帰検出（基準 ' + base.generatedAt + ' との差）:');
      for (const i of issues) console.log('   - ' + i);
      console.log('\n意図した変更なら baseline を更新してください（node tools/regression-harness.js baseline）。');
      process.exit(1);
    }
    console.log('\n✅ 回帰なし（許容差内）。基準 ' + base.generatedAt);
    return;
  }

  console.error(`不明なモード: ${mode}\n使い方: node tools/regression-harness.js [baseline|check|report] [N]`);
  process.exit(2);
}

main();
