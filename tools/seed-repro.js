#!/usr/bin/env node
/**
 * seed-repro.js — T-06/T-07 受け入れ②の検証スクリプト（シード完全再現・本番経路）。
 *
 * 目的:
 *   本番の試合エントリ playMatch(home, away, tactics, seed) を同一 (home,away,tactics,seed)
 *   で 2 回叩き、「イベント列（matchToEvents 出力）とスコアが完全一致」することを機械確認する。
 *   さらに別 seed では結果が変わることも確認する。これが
 *   「同一シードで試合を完全再現できる」（サーバー検証・名場面の再生/共有の土台）の証明になる。
 *
 * ★ T-07 での変更（Codex 指摘の解消）:
 *   旧版はこのスクリプトが自前ループ（独自の makeTeam＋手動リセット＋n=rng() の loop）で試合を
 *   回しており、本番の試合エントリを 1 つも叩いていなかった＝「テストは通るが、本番経路はテストで
 *   検証されていない」というギャップがあった。T-07 で本番経路 playMatch に n=rng() の決定論境界を
 *   集約し、本テストもその playMatch を叩く形へ差し替えた＝検証経路＝本番経路に一致させた。
 *   （補足: n を Math.random で決めて seed 経路から外れるのは simulateSilent=バッチ sim 側であり、
 *    startGame は T-05 で rng() に置換済み。simulateSilent の決定論化は別タスク。）
 *
 * 重要:
 *   完全再現にはエンジンの乱数が全て seedRng の系列から出る必要がある。
 *   simulate.js は Math.random を rng() へ全置換済み。チャンス数も playMatch 内で rng() から
 *   決まるため、試合全体が 1 本の seed に従う。
 *
 * 使い方:
 *   node tools/seed-repro.js [seed]   # 既定 seed=12345 / 全代表カード
 */
'use strict';
const { loadEngine } = require('./lib/load-engine');

const MATCHUPS = [
  ['japan2026vsNetherlands', 'netherlands2026'],
  ['japan2026vsNetherlands', 'brazil2026'],
  ['japan2026vsTunisia',     'tunisia2026'],
  ['brazil2026',             'argentina2026'],
  ['germany2026',            'usa2026'],
  ['spain2026',              'morocco2026'],
];

// 本番エントリ playMatch を叩いて 1 試合を回し、比較用の { score, n, sig } を返す。
// ★ 自前ループは廃止。チャンス数 n も seed 設定も playMatch 内に集約されている（本番経路）。
function playSeeded(api, d1, d2, seed) {
  const r = api.playMatch(d1, d2, null, seed); // tactics=null（default_* を使用）、seed 指定で決定論
  // 比較しやすいよう、イベントを安定キーへ落とす（型/分/チーム/結果/アクション/得点者）。
  const sig = r.events.map(e =>
    [e.t, e.chance, e.minute, e.team,
     e.result || '', e.action || '',
     e.scorer || '', e.shooter || '',
     e.homeScore !== undefined ? e.homeScore : '',
     e.awayScore !== undefined ? e.awayScore : ''].join('~')
  ).join('|');
  return { score: `${r.result.home}-${r.result.away}`, n: r.events.length, sig };
}

function main() {
  const seed = parseInt(process.argv[2] || '12345', 10);
  const api = loadEngine();
  if (typeof api.playMatch !== 'function') {
    console.error('❌ playMatch がエンジンに見つかりません。js/match.js のロード順（events.js の後）を確認してください。');
    process.exit(2);
  }
  if (typeof api.seedRng !== 'function' || typeof api.rng !== 'function' || typeof api.clearSeed !== 'function') {
    console.error('❌ rng API（seedRng/rng/clearSeed）がエンジンに見つかりません。rng.js のロード順を確認してください。');
    process.exit(2);
  }

  console.log(`\nシード再現テスト（本番 playMatch 経路）  (seed=${seed})`);
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
  console.log('\n✅ 同一シードで全カード完全再現／別シードで結果が変化（本番 playMatch 経路）。');
}

main();
