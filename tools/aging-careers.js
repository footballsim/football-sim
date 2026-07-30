/**
 * aging-careers.js — SN-08a「素質」の効き目を選手のキャリア曲線で見る。
 *
 * 早熟／晩成／衰え耐性が実際に「別の物語」を生んでいるかを、総合の推移で確かめる。
 * 隠しパラメータなのでゲーム画面には出ないが、チューニングと受入確認にはこれが要る。
 *
 * 実行: node tools/aging-careers.js [seasons] [clubKey]
 */
'use strict';
const { makeLeagueContext } = require('./lib/league-context.js');
const SEASONS = parseInt(process.argv[2] || '14', 10);
const MY = process.argv[3] || 'england2026';
const { L, TEAM_DATA, ls, LS_KEY, win } = makeLeagueContext();

ls.removeItem(LS_KEY); L.setState(null);
win.leaguePickClub(MY);

const roster = TEAM_DATA[MY].players.map(function (p, i) {
  const key = p.long_name || p.name;
  return { i: i, key: key, name: p.name, gk: p.positions[0] === 'GK', t: L.talentOf(key, p.positions[0] === 'GK') };
});

/* 季ごとに「全員フル出場」で回して総合の推移を採る（素質の差だけを見たいので出場は固定） */
const track = {};
roster.forEach(function (r) { track[r.key] = []; });
const ages = {};
for (let s = 1; s <= SEASONS; s++) {
  L.getState().season = s;
  const td = L.overlaySquad(MY);
  roster.forEach(function (r) {
    const p = td.players[r.i];
    let sum = 0; for (let k = 0; k < p.params.length; k++) sum += p.params[k];
    track[r.key].push(sum / p.params.length);
    if (s === 1) ages[r.key] = L.playerAge(MY, r.key);
  });
  // 次季へ（全員フル出場したことにして growth を積む）
  const prev = {}; prev[MY] = {};
  roster.forEach(function (r) { prev[MY][r.key] = { apps: 14 }; });
  const next = L.getState().squads;
  L.applySeasonAging(next, prev, 14, null);
}

function fmt(n, w) { return String(n).padStart(w); }
function arrow(a, b) { const d = b - a; return (d >= 0 ? '+' : '') + d.toFixed(1); }

/* 面白い例を選ぶ: ピークまでの伸びが大きい順／衰えが小さいベテラン順 */
const withGain = roster.map(function (r) {
  const t = track[r.key];
  return { r: r, first: t[0], peakVal: Math.max.apply(null, t), last: t[t.length - 1],
           gain: Math.max.apply(null, t) - t[0], drop: Math.max.apply(null, t) - t[t.length - 1] };
});

console.log('=== ' + TEAM_DATA[MY].name + ' / ' + SEASONS + '季 全員フル出場を仮定 ===\n');
console.log('■ 最も伸びた5人（若手の当たり）');
console.log('  選手           型   初期齢 伸びしろ 耐性   S1 →  ピーク  → S' + SEASONS);
withGain.slice().sort(function (a, b) { return b.gain - a.gain; }).slice(0, 5).forEach(function (x) {
  console.log('  ' + x.r.name.padEnd(13) + ' ' + x.r.t.archJa + ' ' + fmt(ages[x.r.key], 4) + '歳 ' +
    fmt(x.r.t.pot.toFixed(1), 7) + ' ' + fmt((x.r.t.floor / L.GROWTH_TUNING.TOTAL_DECL).toFixed(2), 5) + '  ' +
    fmt(x.first.toFixed(1), 5) + ' → ' + fmt(x.peakVal.toFixed(1), 5) + ' (' + arrow(x.first, x.peakVal) + ') → ' + fmt(x.last.toFixed(1), 5));
});

console.log('\n■ 歳を取っても落ちない5人（30歳以上・下げ幅が小さい順）');
const vets = withGain.filter(function (x) { return ages[x.r.key] >= 29; })
  .sort(function (a, b) { return a.drop - b.drop; }).slice(0, 5);
vets.forEach(function (x) {
  console.log('  ' + x.r.name.padEnd(13) + ' ' + x.r.t.archJa + ' ' + fmt(ages[x.r.key], 4) + '歳 ' +
    fmt(x.r.t.pot.toFixed(1), 7) + ' ' + fmt((x.r.t.floor / L.GROWTH_TUNING.TOTAL_DECL).toFixed(2), 5) + '  ' +
    fmt(x.first.toFixed(1), 5) + ' → S' + SEASONS + ' ' + fmt(x.last.toFixed(1), 5) + ' (' + arrow(x.first, x.last) + ')');
});

console.log('\n■ 型ごとのキャリア曲線（総合の推移・同じ初期年齢帯で比較）');
['early', 'normal', 'late'].forEach(function (id) {
  const cand = roster.filter(function (r) { return r.t.arch === id && !r.gk && ages[r.key] >= 20 && ages[r.key] <= 23; })[0];
  if (!cand) return;
  const t = track[cand.key].map(function (v) { return v.toFixed(1); });
  console.log('  ' + cand.t.archJa + ' ' + cand.name.padEnd(11) + '(' + ages[cand.key] + '歳〜): ' + t.join(' '));
});
