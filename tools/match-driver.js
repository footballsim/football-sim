#!/usr/bin/env node
/**
 * match-driver.js — T-08 受け入れ検証（対話型ドライバ createMatch）。
 *
 * 検証する受け入れ条件:
 *   ②無介入＝playMatch一致: createMatch を最後まで回し（介入なし）、playMatch と
 *     events / result が完全一致（逐次版＝一括版の同値性）。
 *   ③介入が効く＋再現:
 *     - あるチャンスで sub または tactic を applyDecision → 以降の events が無介入時と変わる。
 *     - 同一 seed＋同一介入列で 2 回実行 → 完全一致（決定論）。
 *
 * 使い方:
 *   node tools/match-driver.js [seed]   # 既定 seed=12345 / 全代表カード
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

// Event[] を安定キー文字列へ落とす（seed-repro.js と同じ流儀の署名）。
function sig(events) {
  return events.map(e =>
    [e.t, e.chance, e.minute, e.team,
     e.result || '', e.action || '',
     e.scorer || '', e.shooter || '',
     e.homeScore !== undefined ? e.homeScore : '',
     e.awayScore !== undefined ? e.awayScore : ''].join('~')
  ).join('|');
}

// createMatch を最後まで（介入は decisionsByChance で適用）回し、{score, sig, events} を返す。
//   decisionsByChance: { <atChance>: [decision, ...] }。各チャンスを計算する「直前」に適用。
function driveToEnd(api, d1, d2, seed, decisionsByChance) {
  const m = api.createMatch(d1, d2, null, seed);
  decisionsByChance = decisionsByChance || {};
  let guard = 0;
  while (!m.isOver()) {
    const st = m.getState();
    const decs = decisionsByChance[st.idx];
    if (decs) for (const d of decs) {
      const ok = m.applyDecision(d);
      if (!ok) throw new Error(`applyDecision 失敗 @chance ${st.idx}: ${JSON.stringify(d)}`);
    }
    m.nextChance();
    if (++guard > 1000) throw new Error('nextChance ループが終了しません');
  }
  const r = m.result;
  return { score: `${r.result.home}-${r.result.away}`, sig: sig(r.events), n: r.events.length, decisions: m.getState().decisions };
}

// playMatch（一括）の {score, sig}。
function playOnce(api, d1, d2, seed) {
  const r = api.playMatch(d1, d2, null, seed);
  return { score: `${r.result.home}-${r.result.away}`, sig: sig(r.events), n: r.events.length };
}

// 控え（lineup に居ない最初の players index）を探す。交代の in に使う。
function firstBenchIdx(team) {
  const inLineup = new Set(team.lineup.slice(0, 11));
  for (let i = 0; i < team.players.length; i++) if (!inLineup.has(i)) return i;
  return -1;
}

function main() {
  const seed = parseInt(process.argv[2] || '12345', 10);
  const api = loadEngine();
  for (const fn of ['createMatch', 'playMatch', 'seedRng', 'rng', 'clearSeed']) {
    if (typeof api[fn] !== 'function') {
      console.error(`❌ ${fn} がエンジンに見つかりません。js/match.js / rng.js のロード順を確認してください。`);
      process.exit(2);
    }
  }

  console.log(`\n対話型ドライバ検証 createMatch  (seed=${seed})`);
  console.log('='.repeat(72));

  let eqOk = 0, eqFail = 0;        // ② 無介入＝playMatch一致
  let intvDiff = 0, intvSame = 0;  // ③ 介入で変わる
  let reproOk = 0, reproFail = 0;  // ③ 同一seed同一介入列で再現
  let ftOk = 0, ftFail = 0;        // [P2-a] 進行中 FT 0件・完了時 FT 1件
  const fails = [];

  const FT = api.EVENT_TYPES.FT, HT = api.EVENT_TYPES.HT;
  const countT = (evs, type) => evs.reduce((a, e) => a + (e.t === type ? 1 : 0), 0);

  for (const [k1, k2] of MATCHUPS) {
    const d1 = api.TEAM_DATA[k1], d2 = api.TEAM_DATA[k2];
    if (!d1 || !d2) throw new Error(`未定義カード: ${k1} vs ${k2}`);

    // ② 無介入: createMatch（逐次）== playMatch（一括）。
    const seq = driveToEnd(api, d1, d2, seed, null);
    const bulk = playOnce(api, d1, d2, seed);
    const same = seq.score === bulk.score && seq.sig === bulk.sig && seq.n === bulk.n;
    if (same) eqOk++; else { eqFail++; fails.push(`${k1} vs ${k2}: 無介入で playMatch と不一致 (seq ${seq.score} / bulk ${bulk.score})`); }

    // [P2-a] 進行中に events を読むと“早すぎる FT”が出ないこと。
    //   ・各チャンス後（idx<n の間）: FT 0件（前半終了後は HT が出てもよい）。
    //   ・完了後: FT ちょうど 1件 かつ playMatch.events と完全一致。
    const mp = api.createMatch(d1, d2, null, seed);
    let midFtMax = 0, midHtSeenWhileFtZero = true;
    while (!mp.isOver()) {
      mp.nextChance();
      if (mp.isOver()) break;                 // 完了直前のチャンス後は下の完了チェックで見る
      const ev = mp.events;                    // ★ 進行中の getter 読み取り
      midFtMax = Math.max(midFtMax, countT(ev, FT));
    }
    const endEv = mp.events;                    // 完了後
    const endFt = countT(endEv, FT);
    const endSig = sig(endEv);
    const ftPass = midFtMax === 0 && endFt === 1 && endSig === bulk.sig;
    if (ftPass) ftOk++; else { ftFail++; fails.push(`${k1} vs ${k2}: FT検査 NG (進行中FT最大=${midFtMax} 完了時FT=${endFt} playMatch一致=${endSig === bulk.sig})`); }

    // ③ 介入列を組む: 後半頭(chance=HALF_CHANCES)で home の戦術を CATENACCIO へ変更
    //    ＋ あるチャンスで home の控えへ 1 枚交代（lineup pos=10 を控えに）。
    //    （控え index は team から動的に取得＝データ非依存）。
    const probe = api.createMatch(d1, d2, null, seed);
    const benchIdx = firstBenchIdx(probe.home);
    probe.dispose();
    const half = api.HALF_CHANCES;
    const decisionsByChance = {};
    decisionsByChance[half] = [{ type: 'tactic', side: 'home', tactics: api.TACTICS_CATENACCIO }];
    if (benchIdx >= 0) {
      (decisionsByChance[half + 1] = decisionsByChance[half + 1] || [])
        .push({ type: 'sub', side: 'home', pos: 10, in: benchIdx });
    }

    const intv1 = driveToEnd(api, d1, d2, seed, decisionsByChance);
    // 介入で無介入時と署名が変わるべき（戦術 CATENACCIO は得点機会を大きく変える）。
    const changed = intv1.sig !== bulk.sig || intv1.score !== bulk.score;
    if (changed) intvDiff++; else intvSame++;

    // 同一 seed＋同一介入列で 2 回目 → 完全一致するべき。
    const intv2 = driveToEnd(api, d1, d2, seed, decisionsByChance);
    const repro = intv1.score === intv2.score && intv1.sig === intv2.sig && intv1.n === intv2.n;
    if (repro) reproOk++; else { reproFail++; fails.push(`${k1} vs ${k2}: 同一seed同一介入列で再現せず (${intv1.score} vs ${intv2.score})`); }

    console.log(`  [${same && ftPass ? 'OK' : 'FAIL'}] ${k1} vs ${k2}`);
    console.log(`        無介入  : seq=${seq.score} (events ${seq.n})  bulk=${bulk.score} (events ${bulk.n})  一致=${same}`);
    console.log(`        FT検査  : 進行中FT最大=${midFtMax}  完了時FT=${endFt}  完了時=playMatch=${endSig === bulk.sig}`);
    console.log(`        介入適用: ${intv1.score} (events ${intv1.n})  介入数=${intv1.decisions.length}  無介入から変化=${changed}`);
    console.log(`        介入再現: ${intv2.score} (events ${intv2.n})  同一seed同一介入列で一致=${repro}`);
  }

  // ── [P2-b] seeded 同時 1 本ガードの検証 ──────────────────────────
  //   生きた seeded controller がある間に別の seeded 開始（createMatch/playMatch）→ throw。
  //   完了/dispose 後は再開可能。未シード同士は従来どおり併存可。
  let guardPass = true;
  const guardFails = [];
  const dG1 = api.TEAM_DATA['brazil2026'], dG2 = api.TEAM_DATA['argentina2026'];
  const throws = (fn) => { try { fn(); return false; } catch (e) { return /seeded 試合は同時に 1 つ/.test(e.message); } };

  // (1) seeded controller を 1 つ起動（途中まで進める＝生きている）。
  const live = api.createMatch(dG1, dG2, null, 4242);
  live.nextChance();
  // (2) その間に別 seeded createMatch → throw すべき。
  const c1 = throws(() => api.createMatch(dG1, dG2, null, 99));
  // (3) その間に別 seeded playMatch → throw すべき。
  const c2 = throws(() => api.playMatch(dG1, dG2, null, 99));
  // (4) 未シード createMatch / playMatch は throw しない（併存可）。
  const c3 = !throws(() => { const m = api.createMatch(dG1, dG2, null, null); m.dispose(); });
  const c4 = !throws(() => api.playMatch(dG1, dG2, null, null));
  if (!c1 || !c2 || !c3 || !c4) { guardPass = false; guardFails.push(`生存中ガード NG (別seed createMatch弾く=${c1} 別seed playMatch弾く=${c2} 未シードcreateMatch併存=${c3} 未シードplayMatch併存=${c4})`); }
  // (5) 生きた controller を完了させる → seed が戻る。
  while (!live.isOver()) live.nextChance();
  const seededFreed = !api.isRngSeeded();
  // (6) 完了後は seeded で再開できる。
  const c5 = !throws(() => { const m = api.createMatch(dG1, dG2, null, 7); m.dispose(); });
  const c6 = !throws(() => api.playMatch(dG1, dG2, null, 7));
  if (!seededFreed || !c5 || !c6) { guardPass = false; guardFails.push(`完了後の再開 NG (完了でseed解放=${seededFreed} 再createMatch=${c5} 再playMatch=${c6})`); }
  // (7) dispose でも seed が解放されること。
  const live2 = api.createMatch(dG1, dG2, null, 555);
  live2.nextChance();
  live2.dispose();
  const disposedFreed = !api.isRngSeeded();
  const c7 = !throws(() => { const m = api.createMatch(dG1, dG2, null, 8); m.dispose(); });
  if (!disposedFreed || !c7) { guardPass = false; guardFails.push(`dispose 後の再開 NG (disposeでseed解放=${disposedFreed} 再createMatch=${c7})`); }

  console.log('-'.repeat(72));
  console.log(`  ②無介入=playMatch一致 : ${eqOk}/${MATCHUPS.length}   不一致: ${eqFail}`);
  console.log(`  ③介入で変化           : ${intvDiff}/${MATCHUPS.length}   (偶然同一: ${intvSame})`);
  console.log(`  ③同一seed同一介入列再現: ${reproOk}/${MATCHUPS.length}   再現せず: ${reproFail}`);
  console.log(`  [P2-a] FT検査          : ${ftOk}/${MATCHUPS.length}   NG: ${ftFail}（進行中FT 0件・完了時FT 1件・完了=playMatch）`);
  console.log(`  [P2-b] seeded同時1本ガード: ${guardPass ? 'OK' : 'NG'}（生存中の別seed起動を throw／完了・dispose後は再開可／未シード併存可）`);
  console.log('='.repeat(72));

  if (eqFail > 0 || reproFail > 0 || intvDiff === 0 || ftFail > 0 || !guardPass) {
    console.log('\n❌ 受け入れ未達:');
    if (intvDiff === 0) console.log('   - 全カードで介入が結果を変えませんでした（介入が効いていない可能性）。');
    for (const f of fails) console.log('   - ' + f);
    for (const f of guardFails) console.log('   - ' + f);
    process.exit(1);
  }
  console.log('\n✅ 無介入=playMatch完全一致／介入が以降のチャンスに反映／同一seed同一介入列で完全再現／' +
              '進行中に早すぎるFTなし・完了時FT1件・playMatch一致／seeded同時1本ガード健全。');
}

main();
