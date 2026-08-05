/**
 * mtg1-archetype-test.js — MTG1 #4「選手アーカタイプ自動判定＋生え抜き」（js/archetype.js）の headless 検証。
 *
 * archetype.js は「TEAM_DATA から一度だけ算出したポジション群別リーグ統計 + params/positions」だけに
 * 依存する純関数群なので、tools/lib/load-engine.js で players.js を含む既存エンジンをロードし、
 * その同じ vm context に archetype.js を追加ロードして検証する
 *（vm context は複数回の runInContext 間で top-level let/const の束縛を共有するため、
 *   先にロードした players.js の TEAM_DATA / POWER..FAIR_PLAY 定数を archetype.js から参照できる）。
 *
 * 検証項目:
 *   ① 全 TEAM_DATA 選手が必ず1つのアーカタイプIDを持つ（null/未定義が無い）
 *   ② 決定論（同じ params/positions を渡せば常に同じ結果・エンジンを2回独立ロードしても一致）
 *   ③ 分布表の出力（1種が40%超えない・0%の種が無い）
 *   ④ キルスイッチ（window.MTG1_ARCH = false）で表示APIが無効化される
 *      （archetypeOf 自体は純関数として無効化されないことも合わせて確認）
 *
 * 実行: node tools/mtg1-archetype-test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { loadEngine } = require('./lib/load-engine.js');

const ARCHETYPE_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'archetype.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

/**
 * players.js を含む既存エンジンをロードし、同じ vm context に archetype.js を追加ロードして
 * API 一式を取り出す（tools/lib/load-engine.js は無改変で利用する）。
 */
function loadWithArchetype() {
  const eng = loadEngine();
  vm.runInContext(ARCHETYPE_SRC, eng.ctx, { filename: 'archetype.js' });
  const api = vm.runInContext(`({
    archetypeOf: archetypeOf,
    tenureBadge: tenureBadge,
    archetypeBadgeHTML: archetypeBadgeHTML,
    ARCHETYPE_RULES: ARCHETYPE_RULES,
    ARCHETYPE_BALANCER: ARCHETYPE_BALANCER,
    ARCHETYPE_FLAVOR: ARCHETYPE_FLAVOR,
    ARCH_THRESHOLD: ARCH_THRESHOLD,
    TENURE_THRESHOLDS: TENURE_THRESHOLDS,
  })`, eng.ctx);
  api.ctx = eng.ctx;
  api.TEAM_DATA = eng.TEAM_DATA;
  return api;
}

/** TEAM_DATA 全選手をフラットな配列にする（team key も残す）。 */
function allPlayers(TEAM_DATA) {
  const out = [];
  for (const key in TEAM_DATA) {
    const team = TEAM_DATA[key];
    if (!team || !Array.isArray(team.players)) continue;
    for (const p of team.players) {
      if (!p || !Array.isArray(p.params) || p.params.length < 29) continue;
      out.push({ teamKey: key, player: p });
    }
  }
  return out;
}

const eng1 = loadWithArchetype();
const players1 = allPlayers(eng1.TEAM_DATA);
console.log('TEAM_DATA 選手総数: ' + players1.length + '（' + Object.keys(eng1.TEAM_DATA).length + ' チーム）');

/* ── ルール表の一覧（id / ja / en） ─────────────────────────────────── */
section('ルール表（' + (function () {
  let n = 0; for (const g in eng1.ARCHETYPE_RULES) n += eng1.ARCHETYPE_RULES[g].length + 1; return n;
})() + ' 種: 群ごとに判定ルール4種＋フォールバック(バランサー)1種）');
for (const g of ['GK', 'DF', 'MF', 'FW']) {
  for (const rule of eng1.ARCHETYPE_RULES[g]) {
    const f = eng1.ARCHETYPE_FLAVOR[rule.id];
    console.log('  [' + g + '] ' + rule.id.padEnd(14) + ' ja=' + f.ja.badge + '  en=' + f.en.badge);
  }
  const bId = eng1.ARCHETYPE_BALANCER[g];
  const bf = eng1.ARCHETYPE_FLAVOR[bId];
  console.log('  [' + g + '] ' + bId.padEnd(14) + ' ja=' + bf.ja.badge + '  en=' + bf.en.badge + '  (fallback)');
}

/* ── ① 全員が必ず1種 ───────────────────────────────────────────────── */
section('① 全選手が必ず1つのアーカタイプを持つ');
(function () {
  let allValid = true, missingFlavor = 0, missingId = 0;
  const validIds = new Set();
  for (const g in eng1.ARCHETYPE_RULES) {
    for (const r of eng1.ARCHETYPE_RULES[g]) validIds.add(r.id);
    validIds.add(eng1.ARCHETYPE_BALANCER[g]);
  }
  for (const { player } of players1) {
    const a = eng1.archetypeOf(player.params, player.positions);
    if (!a || !a.id || !validIds.has(a.id)) { allValid = false; missingId++; }
    if (!a || typeof a.ja !== 'string' || !a.ja || typeof a.en !== 'string' || !a.en) missingFlavor++;
  }
  check('全選手が ARCHETYPE_RULES/BALANCER のいずれかの有効な id を持つ', allValid, missingId + '件が無効');
  check('全選手が ja/en 両方の非空文字ラベルを持つ', missingFlavor === 0, missingFlavor + '件が欠落');
})();
check('positions が空/未定義でも必ず1種を返す（MF群のバランサーへフォールバック）', (function () {
  const a1 = eng1.archetypeOf(new Array(29).fill(60), []);
  const a2 = eng1.archetypeOf(new Array(29).fill(60), undefined);
  return a1 && a1.id === 'mf_balancer' && a2 && a2.id === 'mf_balancer';
})());
check('params が短い/欠損でも例外にならない', (function () {
  try {
    eng1.archetypeOf([1, 2, 3], ['CF']);
    eng1.archetypeOf(null, ['GK']);
    eng1.archetypeOf(undefined, undefined);
    return true;
  } catch (e) { return false; }
})());

/* ── ② 決定論 ─────────────────────────────────────────────────────── */
section('② 決定論（同じ入力は常に同じ結果 / エンジン再ロードでも一致）');
check('同じ params/positions を2回渡すと完全一致（全選手）', (function () {
  for (const { player } of players1) {
    const a = eng1.archetypeOf(player.params, player.positions);
    const b = eng1.archetypeOf(player.params.slice(), player.positions.slice());
    if (a.id !== b.id || a.ja !== b.ja || a.en !== b.en) return false;
  }
  return true;
})());

const eng2 = loadWithArchetype();   // 独立した2回目のロード（統計キャッシュも作り直し）
const players2 = allPlayers(eng2.TEAM_DATA);
check('2回独立ロードしても選手数が一致する（TEAM_DATA自体の差異なし）', players1.length === players2.length);
check('2回独立ロードしても全選手の判定結果が完全一致する', (function () {
  if (players1.length !== players2.length) return false;
  for (let i = 0; i < players1.length; i++) {
    const a = eng1.archetypeOf(players1[i].player.params, players1[i].player.positions);
    const b = eng2.archetypeOf(players2[i].player.params, players2[i].player.positions);
    if (a.id !== b.id) return false;
  }
  return true;
})());
check('Math.random を上書きしても結果は変わらない（rng不使用の確認）', (function () {
  const before = eng1.archetypeOf(players1[0].player.params, players1[0].player.positions);
  const origRandom = eng1.ctx.Math.random;
  eng1.ctx.Math.random = () => { throw new Error('Math.random が呼ばれた'); };
  let after, threw = false;
  try { after = eng1.archetypeOf(players1[0].player.params, players1[0].player.positions); }
  catch (e) { threw = true; }
  eng1.ctx.Math.random = origRandom;
  return !threw && before.id === after.id;
})());

/* ── ③ 分布表 ─────────────────────────────────────────────────────── */
section('③ 分布表（1種が40%超えない・0%の種が無い）');
const counts = {};
const validIds = [];
for (const g of ['GK', 'DF', 'MF', 'FW']) {
  for (const r of eng1.ARCHETYPE_RULES[g]) validIds.push(r.id);
  validIds.push(eng1.ARCHETYPE_BALANCER[g]);
}
for (const id of validIds) counts[id] = 0;
for (const { player } of players1) {
  const a = eng1.archetypeOf(player.params, player.positions);
  counts[a.id] = (counts[a.id] || 0) + 1;
}
const total = players1.length;
const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
for (const [id, c] of rows) {
  const pct = (c / total * 100);
  console.log('  ' + id.padEnd(16) + String(c).padStart(5) + '  ' + pct.toFixed(1) + '%');
}
check('全' + validIds.length + '種が1件以上存在する（0%の種が無い）',
  rows.every(([, c]) => c > 0), rows.filter(([, c]) => c === 0).map(([id]) => id).join(','));
check('1種の占有率が40%を超えない',
  rows.every(([, c]) => c / total <= 0.40), rows.filter(([, c]) => c / total > 0.40).map(([id]) => id).join(','));

/* ── ④ キルスイッチ ───────────────────────────────────────────────── */
section('④ キルスイッチ（window.MTG1_ARCH = false）');
const samplePlayer = players1[0].player;
check('既定（未設定）ではバッジHTMLが出力される', eng1.archetypeBadgeHTML(samplePlayer).length > 0);
check('既定（未設定）では在籍5年でクラブの顔バッジが出る',
  !!eng1.tenureBadge({ clubTenureSeasons: 5, joinedAsYouth: false }) &&
  eng1.tenureBadge({ clubTenureSeasons: 5, joinedAsYouth: false }).id === 'club_face');
check('既定（未設定）では在籍7年・ユース出身で生え抜きの象徴バッジが出る',
  !!eng1.tenureBadge({ clubTenureSeasons: 7, joinedAsYouth: true }) &&
  eng1.tenureBadge({ clubTenureSeasons: 7, joinedAsYouth: true }).id === 'homegrown_legend');
check('在籍4年ではまだバッジが出ない（閾値5年未満）',
  eng1.tenureBadge({ clubTenureSeasons: 4, joinedAsYouth: true }) === null);

vm.runInContext('window.MTG1_ARCH = false;', eng1.ctx);
check('MTG1_ARCH=false でバッジHTMLが空文字になる', eng1.archetypeBadgeHTML(samplePlayer) === '');
check('MTG1_ARCH=false では在籍5年でもクラブの顔バッジが出ない（null）',
  eng1.tenureBadge({ clubTenureSeasons: 5, joinedAsYouth: false }) === null);
check('MTG1_ARCH=false でも archetypeOf 自体は純関数として動き続ける（無効化されない）', (function () {
  const a = eng1.archetypeOf(samplePlayer.params, samplePlayer.positions);
  return !!a && !!a.id && !!a.ja && !!a.en;
})());
check('MTG1_ARCH=false でも archetypeOf の結果は switch ON時と同一（判定ロジック自体は不変）', (function () {
  const a = eng1.archetypeOf(samplePlayer.params, samplePlayer.positions);
  vm.runInContext('window.MTG1_ARCH = undefined;', eng1.ctx);
  const b = eng1.archetypeOf(samplePlayer.params, samplePlayer.positions);
  return a.id === b.id;
})());
check('MTG1_ARCH を戻すとバッジHTMLが再び出力される（スイッチの復帰）',
  eng1.archetypeBadgeHTML(samplePlayer).length > 0);

console.log('\n' + (fail === 0 ? '✅ PASS' : '❌ FAIL') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
