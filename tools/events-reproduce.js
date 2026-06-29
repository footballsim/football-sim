#!/usr/bin/env node
/**
 * events-reproduce.js — T-03 受け入れ①の検証スクリプト。
 *
 * 目的: matchToEvents（js/events.js の正規化アダプタ）が吐く Event[] の goal を
 *   team 別集計した値が、その試合の最終 t1score / t2score に一致することを、
 *   代表カードを N 試合ずつ回して機械確認する。Event 列が現行スコアを
 *   忠実に再現する＝seam がエンジン出力を欠落なく構造化している証明。
 *
 * 使い方:
 *   node tools/events-reproduce.js [N]    # 既定 N=300 / カード
 *
 * 注意: simulateChance 内部は呼ぶだけ・書き換えない。playMatch は
 *   regression-harness.js / simulateSilent と同一手順で chanceResults を作る。
 */
'use strict';
const { loadEngine } = require('./lib/load-engine');

// regression-harness.js と同じ代表カード。
const MATCHUPS = [
  ['japan2026vsNetherlands', 'netherlands2026'],
  ['japan2026vsNetherlands', 'brazil2026'],
  ['japan2026vsTunisia',     'tunisia2026'],
  ['brazil2026',             'argentina2026'],
  ['germany2026',            'usa2026'],
  ['spain2026',              'morocco2026'],
];

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

// 1 試合分の chanceResults を集める（simulateSilent / harness と同一手順）。
function playMatch(api, d1, d2) {
  const t1 = makeTeam(api, d1), t2 = makeTeam(api, d2);
  [t1, t2].forEach(t => {
    t.score = 0; t.chanceCounter = 0; t.shootCounter = 0; t.gkSaveCounter = 0;
    t.players.forEach(p => { p.chance_counter = 0; p.fatigue = 0; });
  });
  const gs = { team1: t1, team2: t2 };
  const n = 16 + (Math.random() < 0.5 ? 1 : 0);
  const chanceResults = [];
  for (let i = 0; i < n; i++) chanceResults.push(api.simulateChance(gs, i));
  return { chanceResults, t1, t2 };
}

function main() {
  const N = parseInt(process.argv[2] || '300', 10);
  const api = loadEngine();

  let matches = 0, mismatches = 0, totalGoals = 0;
  let goalEvents = 0, shotEvents = 0, saveEvents = 0, foulEvents = 0, duelEvents = 0;
  let kickoff = 0, htCount = 0, ftCount = 0, chanceEvents = 0;
  const examples = [];

  for (const [k1, k2] of MATCHUPS) {
    const d1 = api.TEAM_DATA[k1], d2 = api.TEAM_DATA[k2];
    if (!d1 || !d2) throw new Error(`未定義カード: ${k1} vs ${k2}`);
    for (let i = 0; i < N; i++) {
      const { chanceResults, t1, t2 } = playMatch(api, d1, d2);
      const events = api.matchToEvents(chanceResults, { home: t1, away: t2 });
      const tally = api.tallyGoals(events);

      matches++;
      totalGoals += t1.score + t2.score;
      const ok = tally.home === t1.score && tally.away === t2.score;
      if (!ok) {
        mismatches++;
        if (examples.length < 8) {
          examples.push(`${k1} vs ${k2}: score ${t1.score}-${t2.score} / events ${tally.home}-${tally.away}`);
        }
      }

      // 構造の健全性チェック（フレーム要素が正しく 1 度ずつ出ているか）。
      for (const e of events) {
        switch (e.t) {
          case api.EVENT_TYPES.GOAL:    goalEvents++; break;
          case api.EVENT_TYPES.SHOT:    shotEvents++; break;
          case api.EVENT_TYPES.SAVE:    saveEvents++; break;
          case api.EVENT_TYPES.FOUL:    foulEvents++; break;
          case api.EVENT_TYPES.DUEL:    duelEvents++; break;
          case api.EVENT_TYPES.KICKOFF: kickoff++;   break;
          case api.EVENT_TYPES.HT:      htCount++;   break;
          case api.EVENT_TYPES.FT:      ftCount++;   break;
          case api.EVENT_TYPES.CHANCE:  chanceEvents++; break;
        }
      }
    }
  }

  console.log(`\nEvent → スコア 再現テスト  (N=${N}/カード, 計 ${matches} 試合)`);
  console.log('='.repeat(64));
  console.log(`  goal 集計 == 最終スコア: ${matches - mismatches}/${matches} 一致`);
  console.log(`  不一致: ${mismatches}`);
  console.log(`  平均合計得点(参考): ${(totalGoals / matches).toFixed(3)}`);
  console.log('-'.repeat(64));
  console.log(`  イベント内訳: kickoff=${kickoff} HT=${htCount} FT=${ftCount} chance=${chanceEvents}`);
  console.log(`               goal=${goalEvents} shot=${shotEvents} save=${saveEvents} foul=${foulEvents} duel=${duelEvents}`);
  console.log(`  goal イベント総数 == 全試合の合計得点: ${goalEvents} vs ${totalGoals}  -> ${goalEvents === totalGoals ? 'OK' : 'MISMATCH'}`);
  // フレーム健全性: kickoff/FT は試合数ぶん、HT も（通常 16+ チャンスなので）試合数ぶん。
  console.log(`  kickoff==FT==matches: ${kickoff === matches && ftCount === matches ? 'OK' : 'CHECK'} (HT=${htCount})`);
  console.log('='.repeat(64));

  if (mismatches > 0 || goalEvents !== totalGoals) {
    console.log('\n❌ 再現に不一致あり:');
    for (const ex of examples) console.log('   - ' + ex);
    process.exit(1);
  }
  console.log('\n✅ Event 列の goal 集計が全試合で最終スコアと一致。');
}

main();
