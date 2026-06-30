#!/usr/bin/env node
/**
 * seed-repro.js — T-06 受け入れ②の検証スクリプト（シード完全再現）。
 *
 * 目的:
 *   seedRng(seed) で決定論モードに入れた状態で同一試合を 2 回走らせ、
 *   「イベント列（matchToEvents 出力）とスコアが完全一致」することを機械確認する。
 *   さらに別 seed では結果が変わることも確認する。これが
 *   「同一シードで試合を完全再現できる」（サーバー検証・名場面の再生/共有の土台）
 *   の証明になる。
 *
 * 重要:
 *   完全再現にはエンジンの乱数が全て seedRng の系列から出る必要がある。
 *   simulate.js は Math.random を rng() へ全置換済み。本テストでは「チャンス数」
 *   （通常 16 or 17）も rng() から決めることで、試合全体を 1 本の seed に従わせる。
 *   既存ハーネス（events-reproduce / regression-harness）が n を Math.random で
 *   決めているのは「未シード＝従来挙動」の確認用途で、再現性検証とは別目的。
 *
 * 使い方:
 *   node tools/seed-repro.js [seed] [cards]   # 既定 seed=12345 / 全代表カード
 */
'use strict';
const vm = require('vm');
const { loadEngine } = require('./lib/load-engine');

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

// seed を設定してから 1 試合を回し、{ events, score } を返す。
// チャンス数も rng() から決める＝seed に完全従属させる（再現性のため）。
function playSeeded(api, d1, d2, seed) {
  api.seedRng(seed); // 決定論モードに入る（この時点から全 rng() が seed 系列）
  const t1 = makeTeam(api, d1), t2 = makeTeam(api, d2);
  [t1, t2].forEach(t => {
    t.score = 0; t.chanceCounter = 0; t.shootCounter = 0; t.gkSaveCounter = 0;
    t.players.forEach(p => { p.chance_counter = 0; p.fatigue = 0; });
  });
  const gs = { team1: t1, team2: t2 };
  const n = 16 + (api.rng() < 0.5 ? 1 : 0); // ★ rng() で決定（Math.random ではない）
  const chanceResults = [];
  for (let i = 0; i < n; i++) chanceResults.push(api.simulateChance(gs, i));
  const events = api.matchToEvents(chanceResults, { home: t1, away: t2 });
  api.clearSeed(); // 後始末（未シードに戻す）
  // 比較しやすいよう、イベントを安定キーへ落とす（型/分/チーム/結果/アクション/得点者）。
  const sig = events.map(e =>
    [e.t, e.chance, e.minute, e.team,
     e.result || '', e.action || '',
     e.scorer || '', e.shooter || '',
     e.homeScore !== undefined ? e.homeScore : '',
     e.awayScore !== undefined ? e.awayScore : ''].join('~')
  ).join('|');
  return { score: `${t1.score}-${t2.score}`, n: events.length, sig };
}

function main() {
  const seed = parseInt(process.argv[2] || '12345', 10);
  const api = loadEngine();
  if (typeof api.seedRng !== 'function' || typeof api.rng !== 'function' || typeof api.clearSeed !== 'function') {
    console.error('❌ rng API（seedRng/rng/clearSeed）がエンジンに見つかりません。rng.js のロード順を確認してください。');
    process.exit(2);
  }

  console.log(`\nシード再現テスト  (seed=${seed})`);
  console.log('='.repeat(72));

  let sameOk = 0, sameFail = 0, diffOk = 0, diffSame = 0;
  const fails = [];

  for (const [k1, k2] of MATCHUPS) {
    const d1 = api.TEAM_DATA[k1], d2 = api.TEAM_DATA[k2];
    if (!d1 || !d2) throw new Error(`未定義カード: ${k1} vs ${k2}`);

    // (A) 同一 seed を 2 回 → 完全一致するべき
    const r1 = playSeeded(api, d1, d2, seed);
    const r2 = playSeeded(api, d1, d2, seed);
    const identical = r1.score === r2.score && r1.sig === r2.sig && r1.n === r2.n;
    if (identical) sameOk++; else { sameFail++; fails.push(`${k1} vs ${k2}: 同一seed不一致 (${r1.score} vs ${r2.score})`); }

    // (B) 別 seed → 結果（署名）が変わるべき（まれに同一になり得るが、複数カードで担保）
    const r3 = playSeeded(api, d1, d2, seed + 1);
    const differs = r3.sig !== r1.sig || r3.score !== r1.score;
    if (differs) diffOk++; else diffSame++;

    const flag = identical ? 'OK' : 'FAIL';
    console.log(`  [${flag}] ${k1} vs ${k2}`);
    console.log(`        seed=${seed}   : ${r1.score}  (events ${r1.n})`);
    console.log(`        seed=${seed}#2 : ${r2.score}  (events ${r2.n})  一致=${identical}`);
    console.log(`        seed=${seed + 1} : ${r3.score}  (events ${r3.n})  別seedで相違=${differs}`);
  }

  console.log('-'.repeat(72));
  console.log(`  同一seed完全一致: ${sameOk}/${MATCHUPS.length}   不一致: ${sameFail}`);
  console.log(`  別seedで相違: ${diffOk}/${MATCHUPS.length}   (偶然一致: ${diffSame})`);
  console.log('='.repeat(72));

  if (sameFail > 0) {
    console.log('\n❌ 同一シードで再現できていないカードがあります:');
    for (const f of fails) console.log('   - ' + f);
    process.exit(1);
  }
  if (diffOk === 0) {
    console.log('\n⚠️ 全カードで別seedでも結果が変わりませんでした（seed が効いていない可能性）。');
    process.exit(1);
  }
  console.log('\n✅ 同一シードで全カード完全再現／別シードで結果が変化。');
}

main();
