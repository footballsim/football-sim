/**
 * aging-neutrality.js — SN-08a 加齢モデルの母集団中立性チェック（設計書 §4.2）。
 *
 * 「若手の伸び総量 ≒ ベテランの衰え総量」を数値で確かめる。リーグ8クラブの全選手の
 * param 総和（growth 込み）がシーズンを跨いでほぼ一定（±数%）に収まれば合格。
 * 併せて年齢構成・セーブサイズ・最高/最低 param のドリフトも出す。
 *
 * 実行: node tools/aging-neutrality.js [seasons]
 */
'use strict';
const { makeLeagueContext } = require('./lib/league-context.js');
const SEASONS = parseInt(process.argv[2] || '10', 10);
const { L, TEAM_DATA, win, ls, LS_KEY } = makeLeagueContext();
const MY = 'england2026';

ls.removeItem(LS_KEY); L.setState(null);
win.leaguePickClub(MY);

function snapshot() {
  const st = L.getState();
  let sum = 0, n = 0, min = 999, max = -999, ageSum = 0, over33 = 0, under23 = 0;
  st.clubs.forEach(function (cid) {
    const td = L.overlaySquad(cid);
    td.players.forEach(function (p, i) {
      const src = TEAM_DATA[cid].players[i];
      const key = src.long_name || src.name;
      const age = L.playerAge(cid, key);
      ageSum += age; if (age >= 34) over33++; if (age <= 22) under23++;
      p.params.forEach(function (v) { sum += v; n++; if (v < min) min = v; if (v > max) max = v; });
    });
  });
  return { sum: Math.round(sum), n: n, avg: +(sum / n).toFixed(3), min: +min.toFixed(1), max: +max.toFixed(1),
           avgAge: +(ageSum / (n / 29)).toFixed(1), vets: over33, youth: under23,
           saveKB: +(JSON.stringify(st).length / 1024).toFixed(1) };
}

const rows = [];
rows.push(Object.assign({ season: 1 }, snapshot()));
for (let s = 0; s < SEASONS; s++) {
  win.leagueDebugSimSeason();
  L.startNextSeason();
  rows.push(Object.assign({ season: L.getState().season }, snapshot()));
}
const base = rows[0].avg;
console.log('season  avgParam   drift%   min   max  avgAge  34+  U23  save(KB)');
rows.forEach(function (r) {
  const d = ((r.avg - base) / base * 100).toFixed(2);
  console.log(String(r.season).padStart(5),
    String(r.avg).padStart(9), String(d).padStart(8), String(r.min).padStart(6),
    String(r.max).padStart(5), String(r.avgAge).padStart(7),
    String(r.vets).padStart(4), String(r.youth).padStart(4), String(r.saveKB).padStart(9));
});
/* 判定の物差し（設計書 §4.2 の「母集団中立」をSN-08aの現実に合わせて読み替える）:
 *   SN-08a は引退も regen も無い（案C）ので母集団は毎季そろって歳を取る＝厳密な中立は
 *   原理的に不可能。代わりに ①実プレイの射程（〜10季）で小さいこと ②発散せず頭打ちに
 *   なること の2点を見る。恒久的な定常化は SN-08b（引退＋regen）で行う。 */
function driftAt(season) {
  const r = rows.find(function (x) { return x.season === season; });
  return r ? (r.avg - base) / base * 100 : null;
}
const d10 = driftAt(10);
const last = rows[rows.length - 1];
const drift = (last.avg - base) / base * 100;
const tail = rows.length >= 3
  ? Math.abs(last.avg - rows[rows.length - 2].avg) / base * 100 : 99;
console.log('\n実プレイ射程（10季）のドリフト : ' + (d10 === null ? 'n/a' : d10.toFixed(2) + '%') +
  (d10 !== null ? (Math.abs(d10) <= 4 ? '  ✅ 許容（±4%以内）' : '  ⚠️ 大きい') : ''));
console.log('最終季(' + last.season + ')のドリフト      : ' + drift.toFixed(2) + '%（1季あたりの変化 ' +
  tail.toFixed(2) + '%）' + (tail <= 0.2 ? '  ✅ 頭打ち（発散していない）' : '  ⚠️ まだ下がり続けている'));
console.log('※ 全クラブが同じだけ落ちるので順位競争のバランスは保たれる。年齢構成の定常化は SN-08b。');
