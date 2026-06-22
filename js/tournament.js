// ============================================================
// W杯まるごとシミュレート（全104試合一括演算モード）
// 2026W杯の実際のグループ組み合わせ・決勝Tブラケットを使用
// （2025/12/05抽選、2026/03プレーオフ確定版）
// ============================================================

// 12グループ×4チーム（公式スロット順）
const WCSIM_GROUPS = {
  A: ['mexico2026', 'southafrica2026', 'korea2026', 'czech2026'],
  B: ['canada2026', 'bosnia2026', 'qatar2026', 'switzerland2026'],
  C: ['brazil2026', 'morocco2026', 'haiti2026', 'scotland2026'],
  D: ['usa2026', 'paraguay2026', 'australia2026', 'turkey2026'],
  E: ['germany2026', 'curacao2026', 'ivorycoast2026', 'ecuador2026'],
  F: ['netherlands2026', 'japan2026vsNetherlands', 'sweden2026', 'tunisia2026'],
  G: ['belgium2026', 'egypt2026', 'iran2026', 'newzealand2026'],
  H: ['spain2026', 'capeverde2026', 'saudiarabia2026', 'uruguay2026'],
  I: ['france2026', 'senegal2026', 'iraq2026', 'norway2026'],
  J: ['argentina2026', 'algeria2026', 'austria2026', 'jordan2026'],
  K: ['portugal2026', 'drcongo2026', 'uzbekistan2026', 'colombia2026'],
  L: ['england2026', 'croatia2026', 'ghana2026', 'panama2026'],
};

// ラウンド32（FIFA公式 Match 73〜88）
// t:'W'=グループ1位 / t:'R'=グループ2位 / t:'T'=3位通過（allowed=入り得るグループ）
const WCSIM_R32_DEFS = [
  { match: 73, home: {t:'R', g:'A'}, away: {t:'R', g:'B'} },
  { match: 74, home: {t:'W', g:'E'}, away: {t:'T', allowed:['A','B','C','D','F']} },
  { match: 75, home: {t:'W', g:'F'}, away: {t:'R', g:'C'} },
  { match: 76, home: {t:'W', g:'C'}, away: {t:'R', g:'F'} },
  { match: 77, home: {t:'W', g:'I'}, away: {t:'T', allowed:['C','D','F','G','H']} },
  { match: 78, home: {t:'R', g:'E'}, away: {t:'R', g:'I'} },
  { match: 79, home: {t:'W', g:'A'}, away: {t:'T', allowed:['C','E','F','H','I']} },
  { match: 80, home: {t:'W', g:'L'}, away: {t:'T', allowed:['E','H','I','J','K']} },
  { match: 81, home: {t:'W', g:'D'}, away: {t:'T', allowed:['B','E','F','I','J']} },
  { match: 82, home: {t:'W', g:'G'}, away: {t:'T', allowed:['A','E','H','I','J']} },
  { match: 83, home: {t:'R', g:'K'}, away: {t:'R', g:'L'} },
  { match: 84, home: {t:'W', g:'H'}, away: {t:'R', g:'J'} },
  { match: 85, home: {t:'W', g:'B'}, away: {t:'T', allowed:['E','F','G','I','J']} },
  { match: 86, home: {t:'W', g:'J'}, away: {t:'R', g:'H'} },
  { match: 87, home: {t:'W', g:'K'}, away: {t:'T', allowed:['D','E','I','J','L']} },
  { match: 88, home: {t:'R', g:'D'}, away: {t:'R', g:'G'} },
];

// R16以降: [マッチ番号, 出場チーム1の前マッチ番号, 出場チーム2の前マッチ番号]
const WCSIM_R16_DEFS = [[89,74,77],[90,73,75],[91,76,78],[92,79,80],[93,83,84],[94,81,82],[95,86,88],[96,85,87]];
const WCSIM_QF_DEFS  = [[97,89,90],[98,93,94],[99,91,92],[100,95,96]];
const WCSIM_SF_DEFS  = [[101,97,98],[102,99,100]];

// ------------------------------------------------------------
// 演算ロジック
// ------------------------------------------------------------

function wcsimTeamName(key) {
  const d = TEAM_DATA[key];
  return (window.LANG === 'en' && d.en_name) ? d.en_name : d.name;
}

// チーム力ブースト: 開催国は全試合+5%、過去優勝国は決勝Tのみ+8%（チーム力倍率のみ）
const WCSIM_HOSTS = ['mexico2026', 'canada2026', 'usa2026'];
const WCSIM_PAST_CHAMPIONS = ['brazil2026', 'germany2026', 'spain2026', 'uruguay2026', 'france2026', 'argentina2026', 'england2026'];
function wcsimStrengthMul(key, isKnockout) {
  let m = 1;
  if (WCSIM_HOSTS.includes(key)) m *= 1.05;
  if (isKnockout && WCSIM_PAST_CHAMPIONS.includes(key)) m *= 1.08;
  return m;
}
// ブースト倍率をグローバルにセットして simulateSilent を実行（simulateChance が参照）
function wcsimSilent(key1, key2, isKnockout, numChances) {
  window._wcsimMul1 = wcsimStrengthMul(key1, isKnockout);
  window._wcsimMul2 = wcsimStrengthMul(key2, isKnockout);
  const r = simulateSilent(TEAM_DATA[key1], TEAM_DATA[key2], numChances);
  window._wcsimMul1 = 1; window._wcsimMul2 = 1;
  return r;
}

// 勝点 → 得失差 → 総得点 → 乱数（比較器を安定させるため事前付与）
function wcsimSortStandings(rows) {
  rows.forEach(r => { r._rnd = Math.random(); });
  rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a._rnd - b._rnd);
}

// グループ1組（総当たり6試合）を演算
function wcsimPlayGroup(letter, keys) {
  const table = {};
  keys.forEach(k => { table[k] = {key: k, p:0, w:0, d:0, l:0, gf:0, ga:0, gd:0, pts:0}; });
  const order = [[0,1],[2,3],[0,2],[3,1],[3,0],[1,2]]; // 第1節〜第3節
  const matches = order.map(([i, j]) => {
    const r = wcsimSilent(keys[i], keys[j], false);
    wcsimStatsAbsorb(keys[i], keys[j], r, true);
    wcsimStatsMatchDone(keys[i], keys[j], r.t1score, r.t2score, false, null);
    const h = table[keys[i]], a = table[keys[j]];
    h.p++; a.p++;
    h.gf += r.t1score; h.ga += r.t2score;
    a.gf += r.t2score; a.ga += r.t1score;
    if (r.t1score > r.t2score)      { h.w++; h.pts += 3; a.l++; }
    else if (r.t1score < r.t2score) { a.w++; a.pts += 3; h.l++; }
    else                            { h.d++; a.d++; h.pts++; a.pts++; }
    return {home: keys[i], away: keys[j], hs: r.t1score, as: r.t2score};
  });
  const standings = keys.map(k => table[k]);
  standings.forEach(s => { s.gd = s.gf - s.ga; });
  wcsimSortStandings(standings);
  return {letter, standings, matches};
}

// ------------------------------------------------------------
// 大会スタッツ集計（選手・チーム・大会全体）
// ------------------------------------------------------------

let _wcsimStats = null;

function wcsimStatsInit() {
  _wcsimStats = {
    players: {},   // teamKey|選手名 → {team, name, enName, goals, assists, duels, duelWins}
    teams: {},     // teamKey → {key, matches, goals, conceded, shots, chances, saves, cleanSheets}
    totalMatches: 0, totalGoals: 0, etCount: 0, pkCount: 0,
    biggestWin: null, topScoringMatch: null
  };
}

function wcsimStatsTeam(teamKey) {
  if (!_wcsimStats.teams[teamKey]) {
    _wcsimStats.teams[teamKey] = {key: teamKey, matches:0, goals:0, conceded:0, shots:0, chances:0, saves:0, cleanSheets:0};
  }
  return _wcsimStats.teams[teamKey];
}

// simulateSilent 1回分（90分 or 延長）の結果を大会スタッツへ吸収
function wcsimStatsAbsorb(key1, key2, r, countMatch) {
  const absorbPlayers = (teamKey, stats) => {
    Object.entries(stats).forEach(([name, st]) => {
      const id = teamKey + '|' + name;
      if (!_wcsimStats.players[id]) {
        _wcsimStats.players[id] = {team: teamKey, name, enName: st.enName, goals:0, assists:0, duels:0, duelWins:0};
      }
      const p = _wcsimStats.players[id];
      p.goals += st.goals; p.assists += (st.assists || 0);
      p.duels += st.duels; p.duelWins += st.duelWins;
    });
  };
  absorbPlayers(key1, r.playerStats);
  absorbPlayers(key2, r.t2playerStats);
  const tm1 = wcsimStatsTeam(key1), tm2 = wcsimStatsTeam(key2);
  tm1.goals += r.t1score; tm1.conceded += r.t2score;
  tm2.goals += r.t2score; tm2.conceded += r.t1score;
  tm1.shots += r.totalStats.t1.shots; tm1.chances += r.totalStats.t1.chances;
  tm2.shots += r.totalStats.t2.shots; tm2.chances += r.totalStats.t2.chances;
  // totalStats.tX.gkSaves は「相手GKのセーブ数」なので入れ替えて帰属
  tm1.saves += r.totalStats.t2.gkSaves;
  tm2.saves += r.totalStats.t1.gkSaves;
  if (countMatch) { tm1.matches++; tm2.matches++; }
  _wcsimStats.totalGoals += r.t1score + r.t2score;
}

// 1試合確定時（延長込み最終スコア）の集計
function wcsimStatsMatchDone(key1, key2, hs, as, et, pk) {
  _wcsimStats.totalMatches++;
  if (et) _wcsimStats.etCount++;
  if (pk) _wcsimStats.pkCount++;
  if (as === 0) wcsimStatsTeam(key1).cleanSheets++;
  if (hs === 0) wcsimStatsTeam(key2).cleanSheets++;
  const diff = Math.abs(hs - as), tot = hs + as;
  if (diff > 0 && (!_wcsimStats.biggestWin || diff > _wcsimStats.biggestWin.diff)) {
    _wcsimStats.biggestWin = {home: key1, away: key2, hs, as, diff};
  }
  if (tot > 0 && (!_wcsimStats.topScoringMatch || tot > _wcsimStats.topScoringMatch.tot)) {
    _wcsimStats.topScoringMatch = {home: key1, away: key2, hs, as, tot};
  }
}

// PK戦（キッカーのシュート精度 vs GKセービングで成功率を算出）
function wcsimPenaltyShootout(t1data, t2data) {
  const gkSave = (d) => {
    const gk = d.players[d.default_lineup[0]];
    if (gk && gk.positions.includes('GK')) return gk.params[23];
    return Math.max(...d.players.map(p => p.positions.includes('GK') ? p.params[23] : 0));
  };
  const kickers = (d) => d.default_lineup.slice(1, 11)
    .map(idx => d.players[idx].params[11])
    .sort((a, b) => b - a).slice(0, 5);
  const prob = (shoot, gk) => Math.min(0.92, Math.max(0.55, 0.75 + (shoot - gk) * 0.004));
  const gk1 = gkSave(t1data), gk2 = gkSave(t2data);
  const k1 = kickers(t1data), k2 = kickers(t2data);
  let h = 0, a = 0;
  for (let i = 0; i < 5; i++) {
    if (Math.random() < prob(k1[i], gk2)) h++;
    if (Math.random() < prob(k2[i], gk1)) a++;
  }
  // サドンデス（5巡で打ち切り、なお同点ならコイントス）
  let round = 0;
  while (h === a && round < 5) {
    if (Math.random() < prob(k1[round % 5], gk2)) h++;
    if (Math.random() < prob(k2[round % 5], gk1)) a++;
    round++;
  }
  if (h === a) (Math.random() < 0.5) ? h++ : a++;
  return { h, a };
}

// ノックアウト1試合（90分 → 延長 → PK）
function wcsimKnockoutMatch(matchNo, homeKey, awayKey) {
  const r = wcsimSilent(homeKey, awayKey, true);
  wcsimStatsAbsorb(homeKey, awayKey, r, true);
  let hs = r.t1score, as = r.t2score, et = false, pk = null;
  if (hs === as) {
    et = true;
    // 延長前後半30分相当 = 6チャンスを同エンジンで演算（スタッツも吸収）
    const ex = wcsimSilent(homeKey, awayKey, true, 6);
    wcsimStatsAbsorb(homeKey, awayKey, ex, false);
    hs += ex.t1score; as += ex.t2score;
    if (hs === as) pk = wcsimPenaltyShootout(TEAM_DATA[homeKey], TEAM_DATA[awayKey]);
  }
  wcsimStatsMatchDone(homeKey, awayKey, hs, as, et, pk);
  const homeWin = pk ? pk.h > pk.a : hs > as;
  return { match: matchNo, home: homeKey, away: awayKey, hs, as, et, pk,
           winner: homeWin ? homeKey : awayKey, loser: homeWin ? awayKey : homeKey };
}

const WCSIM_THIRD_COLS = [79,85,81,74,82,77,87,80];
// 2026 W杯 公式「3位対応表」(Annex C / Wikipedia転記・全495行を allowed制約で機械検証済)
// キー=突破した8組をソート連結 / 値=試合[79,85,81,74,82,77,87,80]順に入る3位チームの組
const WCSIM_THIRD_TABLE = {
  "ABCDEFGH":"HGBCAFDE","ABCDEFGI":"CGBDAFEI","ABCDEFGJ":"CGBDAFEJ","ABCDEFGK":"CGBDAFEK","ABCDEFGL":"CGBDAFLE",
  "ABCDEFHI":"HEBCAFDI","ABCDEFHJ":"HJBCAFDE","ABCDEFHK":"HEBCAFDK","ABCDEFHL":"HFBCADLE","ABCDEFIJ":"CJBDAFEI",
  "ABCDEFIK":"CEBDAFIK","ABCDEFIL":"CEBDAFLI","ABCDEFJK":"CJBDAFEK","ABCDEFJL":"CJBDAFLE","ABCDEFKL":"CEBDAFLK",
  "ABCDEGHI":"HGBCADEI","ABCDEGHJ":"HGBCADEJ","ABCDEGHK":"HGBCADEK","ABCDEGHL":"HGBCADLE","ABCDEGIJ":"EGBCADIJ",
  "ABCDEGIK":"EGBCADIK","ABCDEGIL":"EGBCADLI","ABCDEGJK":"EGBCADJK","ABCDEGJL":"EGBCADLJ","ABCDEGKL":"EGBCADLK",
  "ABCDEHIJ":"HJBCADEI","ABCDEHIK":"HEBCADIK","ABCDEHIL":"HEBCADLI","ABCDEHJK":"HJBCADEK","ABCDEHJL":"HJBCADLE",
  "ABCDEHKL":"HEBCADLK","ABCDEIJK":"EJBCADIK","ABCDEIJL":"EJBCADLI","ABCDEIKL":"EIBCADLK","ABCDEJKL":"EJBCADLK",
  "ABCDFGHI":"HGBCAFDI","ABCDFGHJ":"HGBCAFDJ","ABCDFGHK":"HGBCAFDK","ABCDFGHL":"CGBDAFLH","ABCDFGIJ":"CGBDAFIJ",
  "ABCDFGIK":"CGBDAFIK","ABCDFGIL":"CGBDAFLI","ABCDFGJK":"CGBDAFJK","ABCDFGJL":"CGBDAFLJ","ABCDFGKL":"CGBDAFLK",
  "ABCDFHIJ":"HJBCAFDI","ABCDFHIK":"HFBCADIK","ABCDFHIL":"HFBCADLI","ABCDFHJK":"HJBCAFDK","ABCDFHJL":"CJBDAFLH",
  "ABCDFHKL":"HFBCADLK","ABCDFIJK":"CJBDAFIK","ABCDFIJL":"CJBDAFLI","ABCDFIKL":"CIBDAFLK","ABCDFJKL":"CJBDAFLK",
  "ABCDGHIJ":"HGBCADIJ","ABCDGHIK":"HGBCADIK","ABCDGHIL":"HGBCADLI","ABCDGHJK":"HGBCADJK","ABCDGHJL":"HGBCADLJ",
  "ABCDGHKL":"HGBCADLK","ABCDGIJK":"CJBDAGIK","ABCDGIJL":"CJBDAGLI","ABCDGIKL":"IGBCADLK","ABCDGJKL":"CJBDAGLK",
  "ABCDHIJK":"HJBCADIK","ABCDHIJL":"HJBCADLI","ABCDHIKL":"HIBCADLK","ABCDHJKL":"HJBCADLK","ABCDIJKL":"IJBCADLK",
  "ABCEFGHI":"HGBCAFEI","ABCEFGHJ":"HGBCAFEJ","ABCEFGHK":"HGBCAFEK","ABCEFGHL":"HGBCAFLE","ABCEFGIJ":"EGBCAFIJ",
  "ABCEFGIK":"EGBCAFIK","ABCEFGIL":"EGBCAFLI","ABCEFGJK":"EGBCAFJK","ABCEFGJL":"EGBCAFLJ","ABCEFGKL":"EGBCAFLK",
  "ABCEFHIJ":"HJBCAFEI","ABCEFHIK":"HEBCAFIK","ABCEFHIL":"HEBCAFLI","ABCEFHJK":"HJBCAFEK","ABCEFHJL":"HJBCAFLE",
  "ABCEFHKL":"HEBCAFLK","ABCEFIJK":"EJBCAFIK","ABCEFIJL":"EJBCAFLI","ABCEFIKL":"EIBCAFLK","ABCEFJKL":"EJBCAFLK",
  "ABCEGHIJ":"HJBCAGEI","ABCEGHIK":"EGBCAHIK","ABCEGHIL":"EGBCAHLI","ABCEGHJK":"HJBCAGEK","ABCEGHJL":"HJBCAGLE",
  "ABCEGHKL":"EGBCAHLK","ABCEGIJK":"EJBCAGIK","ABCEGIJL":"EJBCAGLI","ABCEGIKL":"EGBAICLK","ABCEGJKL":"EJBCAGLK",
  "ABCEHIJK":"EJBCAHIK","ABCEHIJL":"EJBCAHLI","ABCEHIKL":"EIBCAHLK","ABCEHJKL":"EJBCAHLK","ABCEIJKL":"EJBAICLK",
  "ABCFGHIJ":"HGBCAFIJ","ABCFGHIK":"HGBCAFIK","ABCFGHIL":"HGBCAFLI","ABCFGHJK":"HGBCAFJK","ABCFGHJL":"HGBCAFLJ",
  "ABCFGHKL":"HGBCAFLK","ABCFGIJK":"CJBFAGIK","ABCFGIJL":"CJBFAGLI","ABCFGIKL":"IGBCAFLK","ABCFGJKL":"CJBFAGLK",
  "ABCFHIJK":"HJBCAFIK","ABCFHIJL":"HJBCAFLI","ABCFHIKL":"HIBCAFLK","ABCFHJKL":"HJBCAFLK","ABCFIJKL":"IJBCAFLK",
  "ABCGHIJK":"HJBCAGIK","ABCGHIJL":"HJBCAGLI","ABCGHIKL":"IGBCAHLK","ABCGHJKL":"HJBCAGLK","ABCGIJKL":"IJBCAGLK",
  "ABCHIJKL":"IJBCAHLK","ABDEFGHI":"HGBDAFEI","ABDEFGHJ":"HGBDAFEJ","ABDEFGHK":"HGBDAFEK","ABDEFGHL":"HGBDAFLE",
  "ABDEFGIJ":"EGBDAFIJ","ABDEFGIK":"EGBDAFIK","ABDEFGIL":"EGBDAFLI","ABDEFGJK":"EGBDAFJK","ABDEFGJL":"EGBDAFLJ",
  "ABDEFGKL":"EGBDAFLK","ABDEFHIJ":"HJBDAFEI","ABDEFHIK":"HEBDAFIK","ABDEFHIL":"HEBDAFLI","ABDEFHJK":"HJBDAFEK",
  "ABDEFHJL":"HJBDAFLE","ABDEFHKL":"HEBDAFLK","ABDEFIJK":"EJBDAFIK","ABDEFIJL":"EJBDAFLI","ABDEFIKL":"EIBDAFLK",
  "ABDEFJKL":"EJBDAFLK","ABDEGHIJ":"HJBDAGEI","ABDEGHIK":"EGBDAHIK","ABDEGHIL":"EGBDAHLI","ABDEGHJK":"HJBDAGEK",
  "ABDEGHJL":"HJBDAGLE","ABDEGHKL":"EGBDAHLK","ABDEGIJK":"EJBDAGIK","ABDEGIJL":"EJBDAGLI","ABDEGIKL":"EGBAIDLK",
  "ABDEGJKL":"EJBDAGLK","ABDEHIJK":"EJBDAHIK","ABDEHIJL":"EJBDAHLI","ABDEHIKL":"EIBDAHLK","ABDEHJKL":"EJBDAHLK",
  "ABDEIJKL":"EJBAIDLK","ABDFGHIJ":"HGBDAFIJ","ABDFGHIK":"HGBDAFIK","ABDFGHIL":"HGBDAFLI","ABDFGHJK":"HGBDAFJK",
  "ABDFGHJL":"HGBDAFLJ","ABDFGHKL":"HGBDAFLK","ABDFGIJK":"FJBDAGIK","ABDFGIJL":"FJBDAGLI","ABDFGIKL":"IGBDAFLK",
  "ABDFGJKL":"FJBDAGLK","ABDFHIJK":"HJBDAFIK","ABDFHIJL":"HJBDAFLI","ABDFHIKL":"HIBDAFLK","ABDFHJKL":"HJBDAFLK",
  "ABDFIJKL":"IJBDAFLK","ABDGHIJK":"HJBDAGIK","ABDGHIJL":"HJBDAGLI","ABDGHIKL":"IGBDAHLK","ABDGHJKL":"HJBDAGLK",
  "ABDGIJKL":"IJBDAGLK","ABDHIJKL":"IJBDAHLK","ABEFGHIJ":"HJBFAGEI","ABEFGHIK":"EGBFAHIK","ABEFGHIL":"EGBFAHLI",
  "ABEFGHJK":"HJBFAGEK","ABEFGHJL":"HJBFAGLE","ABEFGHKL":"EGBFAHLK","ABEFGIJK":"EJBFAGIK","ABEFGIJL":"EJBFAGLI",
  "ABEFGIKL":"EGBAIFLK","ABEFGJKL":"EJBFAGLK","ABEFHIJK":"EJBFAHIK","ABEFHIJL":"EJBFAHLI","ABEFHIKL":"EIBFAHLK",
  "ABEFHJKL":"EJBFAHLK","ABEFIJKL":"EJBAIFLK","ABEGHIJK":"EJBAHGIK","ABEGHIJL":"EJBAHGLI","ABEGHIKL":"EGBAIHLK",
  "ABEGHJKL":"EJBAHGLK","ABEGIJKL":"EJBAIGLK","ABEHIJKL":"EJBAIHLK","ABFGHIJK":"HJBFAGIK","ABFGHIJL":"HJBFAGLI",
  "ABFGHIKL":"HGBAIFLK","ABFGHJKL":"HJBFAGLK","ABFGIJKL":"IJBFAGLK","ABFHIJKL":"HJBAIFLK","ABGHIJKL":"HJBAIGLK",
  "ACDEFGHI":"HGECAFDI","ACDEFGHJ":"HGJCAFDE","ACDEFGHK":"HGECAFDK","ACDEFGHL":"HGFCADLE","ACDEFGIJ":"CGJDAFEI",
  "ACDEFGIK":"CGEDAFIK","ACDEFGIL":"CGEDAFLI","ACDEFGJK":"CGJDAFEK","ACDEFGJL":"CGJDAFLE","ACDEFGKL":"CGEDAFLK",
  "ACDEFHIJ":"HJECAFDI","ACDEFHIK":"HEFCADIK","ACDEFHIL":"HEFCADLI","ACDEFHJK":"HJECAFDK","ACDEFHJL":"HJFCADLE",
  "ACDEFHKL":"HEFCADLK","ACDEFIJK":"CJEDAFIK","ACDEFIJL":"CJEDAFLI","ACDEFIKL":"CEIDAFLK","ACDEFJKL":"CJEDAFLK",
  "ACDEGHIJ":"HGJCADEI","ACDEGHIK":"HGECADIK","ACDEGHIL":"HGECADLI","ACDEGHJK":"HGJCADEK","ACDEGHJL":"HGJCADLE",
  "ACDEGHKL":"HGECADLK","ACDEGIJK":"EGJCADIK","ACDEGIJL":"EGJCADLI","ACDEGIKL":"EGICADLK","ACDEGJKL":"EGJCADLK",
  "ACDEHIJK":"HJECADIK","ACDEHIJL":"HJECADLI","ACDEHIKL":"HEICADLK","ACDEHJKL":"HJECADLK","ACDEIJKL":"EJICADLK",
  "ACDFGHIJ":"HGJCAFDI","ACDFGHIK":"HGFCADIK","ACDFGHIL":"HGFCADLI","ACDFGHJK":"HGJCAFDK","ACDFGHJL":"CGJDAFLH",
  "ACDFGHKL":"HGFCADLK","ACDFGIJK":"CGJDAFIK","ACDFGIJL":"CGJDAFLI","ACDFGIKL":"CGIDAFLK","ACDFGJKL":"CGJDAFLK",
  "ACDFHIJK":"HJFCADIK","ACDFHIJL":"HJFCADLI","ACDFHIKL":"HFICADLK","ACDFHJKL":"HJFCADLK","ACDFIJKL":"CJIDAFLK",
  "ACDGHIJK":"HGJCADIK","ACDGHIJL":"HGJCADLI","ACDGHIKL":"HGICADLK","ACDGHJKL":"HGJCADLK","ACDGIJKL":"IGJCADLK",
  "ACDHIJKL":"HJICADLK","ACEFGHIJ":"HGJCAFEI","ACEFGHIK":"HGECAFIK","ACEFGHIL":"HGECAFLI","ACEFGHJK":"HGJCAFEK",
  "ACEFGHJL":"HGJCAFLE","ACEFGHKL":"HGECAFLK","ACEFGIJK":"EGJCAFIK","ACEFGIJL":"EGJCAFLI","ACEFGIKL":"EGICAFLK",
  "ACEFGJKL":"EGJCAFLK","ACEFHIJK":"HJECAFIK","ACEFHIJL":"HJECAFLI","ACEFHIKL":"HEICAFLK","ACEFHJKL":"HJECAFLK",
  "ACEFIJKL":"EJICAFLK","ACEGHIJK":"EGJCAHIK","ACEGHIJL":"EGJCAHLI","ACEGHIKL":"EGICAHLK","ACEGHJKL":"EGJCAHLK",
  "ACEGIJKL":"EJICAGLK","ACEHIJKL":"EJICAHLK","ACFGHIJK":"HGJCAFIK","ACFGHIJL":"HGJCAFLI","ACFGHIKL":"HGICAFLK",
  "ACFGHJKL":"HGJCAFLK","ACFGIJKL":"IGJCAFLK","ACFHIJKL":"HJICAFLK","ACGHIJKL":"HJICAGLK","ADEFGHIJ":"HGJDAFEI",
  "ADEFGHIK":"HGEDAFIK","ADEFGHIL":"HGEDAFLI","ADEFGHJK":"HGJDAFEK","ADEFGHJL":"HGJDAFLE","ADEFGHKL":"HGEDAFLK",
  "ADEFGIJK":"EGJDAFIK","ADEFGIJL":"EGJDAFLI","ADEFGIKL":"EGIDAFLK","ADEFGJKL":"EGJDAFLK","ADEFHIJK":"HJEDAFIK",
  "ADEFHIJL":"HJEDAFLI","ADEFHIKL":"HEIDAFLK","ADEFHJKL":"HJEDAFLK","ADEFIJKL":"EJIDAFLK","ADEGHIJK":"EGJDAHIK",
  "ADEGHIJL":"EGJDAHLI","ADEGHIKL":"EGIDAHLK","ADEGHJKL":"EGJDAHLK","ADEGIJKL":"EJIDAGLK","ADEHIJKL":"EJIDAHLK",
  "ADFGHIJK":"HGJDAFIK","ADFGHIJL":"HGJDAFLI","ADFGHIKL":"HGIDAFLK","ADFGHJKL":"HGJDAFLK","ADFGIJKL":"IGJDAFLK",
  "ADFHIJKL":"HJIDAFLK","ADGHIJKL":"HJIDAGLK","AEFGHIJK":"EGJFAHIK","AEFGHIJL":"EGJFAHLI","AEFGHIKL":"EGIFAHLK",
  "AEFGHJKL":"EGJFAHLK","AEFGIJKL":"EJIFAGLK","AEFHIJKL":"EJIFAHLK","AEGHIJKL":"EJIAHGLK","AFGHIJKL":"HJIFAGLK",
  "BCDEFGHI":"CGBDHFEI","BCDEFGHJ":"HGBCJFDE","BCDEFGHK":"CGBDHFEK","BCDEFGHL":"CGBDHFLE","BCDEFGIJ":"CGBDJFEI",
  "BCDEFGIK":"CGBDEFIK","BCDEFGIL":"CGBDEFLI","BCDEFGJK":"CGBDJFEK","BCDEFGJL":"CGBDJFLE","BCDEFGKL":"CGBDEFLK",
  "BCDEFHIJ":"CJBDHFEI","BCDEFHIK":"CEBDHFIK","BCDEFHIL":"CEBDHFLI","BCDEFHJK":"CJBDHFEK","BCDEFHJL":"CJBDHFLE",
  "BCDEFHKL":"CEBDHFLK","BCDEFIJK":"CJBDEFIK","BCDEFIJL":"CJBDEFLI","BCDEFIKL":"CEBDIFLK","BCDEFJKL":"CJBDEFLK",
  "BCDEGHIJ":"HGBCJDEI","BCDEGHIK":"EGBCHDIK","BCDEGHIL":"EGBCHDLI","BCDEGHJK":"HGBCJDEK","BCDEGHJL":"HGBCJDLE",
  "BCDEGHKL":"EGBCHDLK","BCDEGIJK":"EGBCJDIK","BCDEGIJL":"EGBCJDLI","BCDEGIKL":"EGBCIDLK","BCDEGJKL":"EGBCJDLK",
  "BCDEHIJK":"EJBCHDIK","BCDEHIJL":"EJBCHDLI","BCDEHIKL":"EIBCHDLK","BCDEHJKL":"EJBCHDLK","BCDEIJKL":"EJBCIDLK",
  "BCDFGHIJ":"HGBCJFDI","BCDFGHIK":"CGBDHFIK","BCDFGHIL":"CGBDHFLI","BCDFGHJK":"HGBCJFDK","BCDFGHJL":"CGBDHFLJ",
  "BCDFGHKL":"CGBDHFLK","BCDFGIJK":"CGBDJFIK","BCDFGIJL":"CGBDJFLI","BCDFGIKL":"CGBDIFLK","BCDFGJKL":"CGBDJFLK",
  "BCDFHIJK":"CJBDHFIK","BCDFHIJL":"CJBDHFLI","BCDFHIKL":"CIBDHFLK","BCDFHJKL":"CJBDHFLK","BCDFIJKL":"CJBDIFLK",
  "BCDGHIJK":"HGBCJDIK","BCDGHIJL":"HGBCJDLI","BCDGHIKL":"HGBCIDLK","BCDGHJKL":"HGBCJDLK","BCDGIJKL":"IGBCJDLK",
  "BCDHIJKL":"HJBCIDLK","BCEFGHIJ":"HGBCJFEI","BCEFGHIK":"EGBCHFIK","BCEFGHIL":"EGBCHFLI","BCEFGHJK":"HGBCJFEK",
  "BCEFGHJL":"HGBCJFLE","BCEFGHKL":"EGBCHFLK","BCEFGIJK":"EGBCJFIK","BCEFGIJL":"EGBCJFLI","BCEFGIKL":"EGBCIFLK",
  "BCEFGJKL":"EGBCJFLK","BCEFHIJK":"EJBCHFIK","BCEFHIJL":"EJBCHFLI","BCEFHIKL":"EIBCHFLK","BCEFHJKL":"EJBCHFLK",
  "BCEFIJKL":"EJBCIFLK","BCEGHIJK":"EJBCHGIK","BCEGHIJL":"EJBCHGLI","BCEGHIKL":"EGBCIHLK","BCEGHJKL":"EJBCHGLK",
  "BCEGIJKL":"EJBCIGLK","BCEHIJKL":"EJBCIHLK","BCFGHIJK":"HGBCJFIK","BCFGHIJL":"HGBCJFLI","BCFGHIKL":"HGBCIFLK",
  "BCFGHJKL":"HGBCJFLK","BCFGIJKL":"IGBCJFLK","BCFHIJKL":"HJBCIFLK","BCGHIJKL":"HJBCIGLK","BDEFGHIJ":"HGBDJFEI",
  "BDEFGHIK":"EGBDHFIK","BDEFGHIL":"EGBDHFLI","BDEFGHJK":"HGBDJFEK","BDEFGHJL":"HGBDJFLE","BDEFGHKL":"EGBDHFLK",
  "BDEFGIJK":"EGBDJFIK","BDEFGIJL":"EGBDJFLI","BDEFGIKL":"EGBDIFLK","BDEFGJKL":"EGBDJFLK","BDEFHIJK":"EJBDHFIK",
  "BDEFHIJL":"EJBDHFLI","BDEFHIKL":"EIBDHFLK","BDEFHJKL":"EJBDHFLK","BDEFIJKL":"EJBDIFLK","BDEGHIJK":"EJBDHGIK",
  "BDEGHIJL":"EJBDHGLI","BDEGHIKL":"EGBDIHLK","BDEGHJKL":"EJBDHGLK","BDEGIJKL":"EJBDIGLK","BDEHIJKL":"EJBDIHLK",
  "BDFGHIJK":"HGBDJFIK","BDFGHIJL":"HGBDJFLI","BDFGHIKL":"HGBDIFLK","BDFGHJKL":"HGBDJFLK","BDFGIJKL":"IGBDJFLK",
  "BDFHIJKL":"HJBDIFLK","BDGHIJKL":"HJBDIGLK","BEFGHIJK":"EJBFHGIK","BEFGHIJL":"EJBFHGLI","BEFGHIKL":"EGBFIHLK",
  "BEFGHJKL":"EJBFHGLK","BEFGIJKL":"EJBFIGLK","BEFHIJKL":"EJBFIHLK","BEGHIJKL":"EJIBHGLK","BFGHIJKL":"HJBFIGLK",
  "CDEFGHIJ":"CGJDHFEI","CDEFGHIK":"CGEDHFIK","CDEFGHIL":"CGEDHFLI","CDEFGHJK":"CGJDHFEK","CDEFGHJL":"CGJDHFLE",
  "CDEFGHKL":"CGEDHFLK","CDEFGIJK":"CGEDJFIK","CDEFGIJL":"CGEDJFLI","CDEFGIKL":"CGEDIFLK","CDEFGJKL":"CGEDJFLK",
  "CDEFHIJK":"CJEDHFIK","CDEFHIJL":"CJEDHFLI","CDEFHIKL":"CEIDHFLK","CDEFHJKL":"CJEDHFLK","CDEFIJKL":"CJEDIFLK",
  "CDEGHIJK":"EGJCHDIK","CDEGHIJL":"EGJCHDLI","CDEGHIKL":"EGICHDLK","CDEGHJKL":"EGJCHDLK","CDEGIJKL":"EGICJDLK",
  "CDEHIJKL":"EJICHDLK","CDFGHIJK":"CGJDHFIK","CDFGHIJL":"CGJDHFLI","CDFGHIKL":"CGIDHFLK","CDFGHJKL":"CGJDHFLK",
  "CDFGIJKL":"CGIDJFLK","CDFHIJKL":"CJIDHFLK","CDGHIJKL":"HGICJDLK","CEFGHIJK":"EGJCHFIK","CEFGHIJL":"EGJCHFLI",
  "CEFGHIKL":"EGICHFLK","CEFGHJKL":"EGJCHFLK","CEFGIJKL":"EGICJFLK","CEFHIJKL":"EJICHFLK","CEGHIJKL":"EJICHGLK",
  "CFGHIJKL":"HGICJFLK","DEFGHIJK":"EGJDHFIK","DEFGHIJL":"EGJDHFLI","DEFGHIKL":"EGIDHFLK","DEFGHJKL":"EGJDHFLK",
  "DEFGIJKL":"EGIDJFLK","DEFHIJKL":"EJIDHFLK","DEGHIJKL":"EJIDHGLK","DFGHIJKL":"HGIDJFLK","EFGHIJKL":"EJIFHGLK"
};

// 3位通過8チームをR32スロットへ割当（FIFA公式 Annex C「3位対応表」準拠）
function wcsimAssignThirds(qualified) {
  const key = qualified.map(q => q.group).sort().join('');
  const row = WCSIM_THIRD_TABLE[key];
  if (row) {
    const assignment = {}, byGroup = {};
    qualified.forEach(q => { byGroup[q.group] = q; });
    for (let i = 0; i < WCSIM_THIRD_COLS.length; i++) {
      const team = byGroup[row[i]];
      if (team) assignment[WCSIM_THIRD_COLS[i]] = team;
    }
    if (Object.keys(assignment).length === 8) return assignment;
  }
  return wcsimAssignThirdsFallback(qualified); // 理論上未到達（全495キー網羅済）
}

// フォールバック: 許容グループ制約をバックトラックで充足（旧実装・安全網）
function wcsimAssignThirdsFallback(qualified) {
  const slots = WCSIM_R32_DEFS.filter(d => d.away.t === 'T');
  const assignment = {};
  const used = new Set();
  function bt(i) {
    if (i === slots.length) return true;
    const slot = slots[i];
    for (const team of qualified) {
      if (used.has(team.group)) continue;
      if (!slot.away.allowed.includes(team.group)) continue;
      assignment[slot.match] = team; used.add(team.group);
      if (bt(i + 1)) return true;
      delete assignment[slot.match]; used.delete(team.group);
    }
    return false;
  }
  if (!bt(0)) {
    const remaining = qualified.filter(q => !used.has(q.group));
    slots.forEach(s => { if (!assignment[s.match]) assignment[s.match] = remaining.shift(); });
  }
  return assignment;
}

// 大会全体を一括演算
function wcsimRunTournament() {
  // 既存W杯モードのフラグを無効化（simulateChance内の補正分岐を確実に切る）
  isWorldCupMode = false; isWCR32Mode = false; isWCR16Mode = false;
  isWCQFMode = false; isWCSFMode = false; isWCFMode = false; wcPhase = '';

  wcsimStatsInit();
  const groups = {};
  Object.keys(WCSIM_GROUPS).forEach(letter => {
    groups[letter] = wcsimPlayGroup(letter, WCSIM_GROUPS[letter]);
  });

  // 3位ランキング → 上位8チームが通過
  const thirds = Object.values(groups).map(g => Object.assign({group: g.letter}, g.standings[2]));
  wcsimSortStandings(thirds);
  const qualifiedThirds = thirds.slice(0, 8);
  const thirdAssign = wcsimAssignThirds(qualifiedThirds);

  const winners = {}, losers = {};
  const record = (m) => { winners[m.match] = m.winner; losers[m.match] = m.loser; return m; };

  const resolveSlot = (slot, matchNo) => {
    if (slot.t === 'W') return groups[slot.g].standings[0].key;
    if (slot.t === 'R') return groups[slot.g].standings[1].key;
    return thirdAssign[matchNo].key;
  };

  const r32 = WCSIM_R32_DEFS.map(def =>
    record(wcsimKnockoutMatch(def.match, resolveSlot(def.home, def.match), resolveSlot(def.away, def.match))));
  const r16 = WCSIM_R16_DEFS.map(([no, m1, m2]) => record(wcsimKnockoutMatch(no, winners[m1], winners[m2])));
  const qf  = WCSIM_QF_DEFS.map(([no, m1, m2]) => record(wcsimKnockoutMatch(no, winners[m1], winners[m2])));
  const sf  = WCSIM_SF_DEFS.map(([no, m1, m2]) => record(wcsimKnockoutMatch(no, winners[m1], winners[m2])));
  const third = record(wcsimKnockoutMatch(103, losers[101], losers[102]));
  const final = record(wcsimKnockoutMatch(104, winners[101], winners[102]));

  const result = {
    groups, qualifiedThirds, r32, r16, qf, sf, third, final,
    champion: final.winner, runnerUp: final.loser, thirdPlace: third.winner
  };
  result.mvp = wcsimSelectMVP(result);
  // シェア機能・AI総括から参照するため最終結果を _wcsimStats に保持
  _wcsimStats.mvp = result.mvp;
  _wcsimStats.champion = result.champion;
  _wcsimStats.runnerUp = result.runnerUp;
  _wcsimStats.thirdPlace = result.thirdPlace;
  _wcsimStats.champPath = wcsimBuildChampPath(result.champion, groups, r32, r16, qf, sf, final);
  return result;
}

// 優勝国の大会経路（グループ成績＋ノックアウト各試合）を抽出
function wcsimBuildChampPath(champKey, groups, r32, r16, qf, sf, final) {
  const letter = Object.keys(WCSIM_GROUPS).find(L => WCSIM_GROUPS[L].includes(champKey));
  const grp = groups[letter];
  const row = grp.standings.find(s => s.key === champKey);
  const pos = grp.standings.indexOf(row) + 1;
  const groupMatches = grp.matches
    .filter(m => m.home === champKey || m.away === champKey)
    .map(m => champKey === m.home ? {opp: m.away, gf: m.hs, ga: m.as} : {opp: m.home, gf: m.as, ga: m.hs});
  const orient = (m, stage) => {
    const isHome = m.home === champKey;
    return {
      stage, opp: isHome ? m.away : m.home,
      gf: isHome ? m.hs : m.as, ga: isHome ? m.as : m.hs, et: m.et,
      pk: m.pk ? (isHome ? {f: m.pk.h, a: m.pk.a} : {f: m.pk.a, a: m.pk.h}) : null
    };
  };
  const koMatches = [];
  [['r32', r32], ['r16', r16], ['qf', qf], ['sf', sf], ['final', [final]]].forEach(([stage, arr]) => {
    const m = arr.find(x => x.home === champKey || x.away === champKey);
    if (m) koMatches.push(orient(m, stage));
  });
  return { groupLetter: letter, w: row.w, d: row.d, l: row.l, gf: row.gf, ga: row.ga, pts: row.pts, pos, groupMatches, koMatches };
}

// 大会MVP選定: 攻撃貢献（ゴール×4＋アシスト×3＋デュエル勝利×0.4）＋チーム成績ボーナスの総合スコア
// 優勝チーム所属がやや有利だが、圧倒的な得点王なら敗退チームからも選ばれ得るバランス
function wcsimSelectMVP(res) {
  const stageBonus = {};
  Object.values(WCSIM_GROUPS).forEach(keys => keys.forEach(k => { stageBonus[k] = 0; }));
  res.r32.forEach(m => { stageBonus[m.loser] = 1; });
  res.r16.forEach(m => { stageBonus[m.loser] = 2; });
  res.qf.forEach(m => { stageBonus[m.loser] = 3; });
  stageBonus[res.third.loser]  = 4;    // 4位
  stageBonus[res.third.winner] = 4.5;  // 3位
  stageBonus[res.runnerUp] = 5.5;
  stageBonus[res.champion] = 7;
  let best = null, bestScore = -1;
  Object.values(_wcsimStats.players).forEach(p => {
    const score = p.goals * 4 + p.assists * 3 + p.duelWins * 0.4 + (stageBonus[p.team] || 0);
    const tie = best && score === bestScore &&
      (p.goals > best.goals || (p.goals === best.goals && p.assists > best.assists));
    if (!best || score > bestScore || tie) { best = p; bestScore = score; }
  });
  return best;
}

// ------------------------------------------------------------
// 画面描画
// ------------------------------------------------------------

let _wcsimTimers = [];
function wcsimClearTimers() { _wcsimTimers.forEach(clearTimeout); _wcsimTimers = []; }

// タイトル画面 → モード入場
function showWCSim() {
  wcsimClearTimers();
  isWorldCupMode = false;
  showScreen('wcsim');
  document.getElementById('wcsim-title').textContent = t('wcsimTitle');
  document.getElementById('wcsim-intro').textContent = t('wcsimIntro');
  const btn = document.getElementById('wcsim-run-btn');
  btn.textContent = t('wcsimRunBtn');
  btn.disabled = false;
  wcsimRenderPreview();
  document.getElementById('screen-wcsim').scrollTop = 0;
}

// 実行前: 組み合わせプレビュー
function wcsimRenderPreview() {
  let html = `<div class="wcsim-section-title">${t('wcsimDrawHeader')}</div><div class="wcsim-groups-grid">`;
  Object.entries(WCSIM_GROUPS).forEach(([letter, keys]) => {
    html += `<div class="wcsim-group-card"><div class="wcsim-group-name">GROUP ${letter}</div>`;
    keys.forEach(k => {
      html += `<div class="wcsim-team-row"><span class="wcsim-team-label">${TEAM_DATA[k].flag} ${wcsimTeamName(k)}</span></div>`;
    });
    html += `</div>`;
  });
  html += `</div>`;
  document.getElementById('wcsim-content').innerHTML = html;
}

function wcsimGroupCardHTML(g, qualifiedGroups) {
  let html = `<div class="wcsim-group-card"><div class="wcsim-group-name">GROUP ${g.letter}</div>`;
  g.standings.forEach((s, i) => {
    const qualified = i < 2 || (i === 2 && qualifiedGroups.has(g.letter));
    const cls = i < 2 ? 'wcsim-row-adv' : (qualified ? 'wcsim-row-third' : 'wcsim-row-out');
    html += `<div class="wcsim-team-row ${cls}">` +
      `<span class="wcsim-team-rank">${i + 1}</span>` +
      `<span class="wcsim-team-label">${TEAM_DATA[s.key].flag} ${wcsimTeamName(s.key)}</span>` +
      `<span class="wcsim-team-num">${s.gd > 0 ? '+' : ''}${s.gd}</span>` +
      `<span class="wcsim-team-pts">${s.pts}</span></div>`;
  });
  html += `<div class="wcsim-group-matches">`;
  g.matches.forEach(m => {
    html += `<span class="wcsim-mini-match" title="${wcsimTeamName(m.home)} ${m.hs}-${m.as} ${wcsimTeamName(m.away)}">` +
      `${TEAM_DATA[m.home].flag} ${m.hs}-${m.as} ${TEAM_DATA[m.away].flag}</span>`;
  });
  html += `</div></div>`;
  return html;
}

function wcsimKOMatchHTML(m) {
  const homeWin = m.winner === m.home;
  const note = m.pk ? `<span class="wcsim-ko-note">PK ${m.pk.h}-${m.pk.a}</span>`
             : (m.et ? `<span class="wcsim-ko-note">${t('wcsimAET')}</span>` : '');
  return `<div class="wcsim-ko-match">` +
    `<span class="wcsim-ko-team ${homeWin ? 'wcsim-ko-win' : ''}" style="text-align:right">${wcsimTeamName(m.home)} ${TEAM_DATA[m.home].flag}</span>` +
    `<span class="wcsim-ko-score">${m.hs} - ${m.as}${note}</span>` +
    `<span class="wcsim-ko-team ${!homeWin ? 'wcsim-ko-win' : ''}">${TEAM_DATA[m.away].flag} ${wcsimTeamName(m.away)}</span></div>`;
}

function wcsimKOSectionHTML(id, title, matches) {
  let html = `<div id="${id}" class="wcsim-section" style="display:none">` +
    `<div class="wcsim-section-title">${title}</div><div class="wcsim-ko-grid">`;
  matches.forEach(m => { html += wcsimKOMatchHTML(m); });
  html += `</div></div>`;
  return html;
}

function wcsimPodiumHTML(res) {
  return `<div id="wcsim-sec-podium" class="wcsim-section" style="display:none">` +
    `<div class="wcsim-podium">` +
    `<div class="wcsim-podium-trophy">🏆</div>` +
    `<div class="wcsim-podium-flag">${TEAM_DATA[res.champion].flag}</div>` +
    `<div class="wcsim-podium-label">${t('wcsimChampionLabel')}</div>` +
    `<div class="wcsim-podium-name">${wcsimTeamName(res.champion)}</div>` +
    `<div class="wcsim-podium-sub">` +
    `<span>🥈 ${t('wcsimRunnerUpLabel')}: ${TEAM_DATA[res.runnerUp].flag} ${wcsimTeamName(res.runnerUp)}</span>` +
    `<span>🥉 ${t('wcsimThirdPlaceLabel')}: ${TEAM_DATA[res.thirdPlace].flag} ${wcsimTeamName(res.thirdPlace)}</span>` +
    (res.mvp ? `<span>⭐ ${t('wcsimMVPLabel')}: ${wcsimPlayerLabel(res.mvp)}</span>` : '') +
    `</div>` +
    `<button class="start-btn" onclick="showWCSimStats()" style="color:#1a1a1a;background:rgba(255,255,255,0.85);margin-top:18px">${t('wcsimStatsBtn')}</button>` +
    `<div style="display:flex;gap:8px;margin-top:10px">` +
    `<button onclick="shareToX('wcsim')" style="flex:1;padding:11px 4px;border:none;border-radius:10px;background:#000;color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">𝕏 ${t('shareX')}</button>` +
    `<button onclick="shareToReddit('wcsim')" style="flex:1;padding:11px 4px;border:none;border-radius:10px;background:#ff4500;color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Reddit</button>` +
    `<button onclick="generateShareImage('wcsim')" style="flex:1;padding:11px 4px;border:none;border-radius:10px;background:linear-gradient(135deg,#1a3a6b,#0050cc);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">${t('shareImg')}</button>` +
    `</div>` +
    `</div>` +
    `<div class="wcsim-ai-card">` +
    `<button id="wcsim-summary-btn" class="wcsim-ai-btn" onclick="generateWcsimSummary()">${t('wcsimSummaryBtn')}</button>` +
    `<div id="wcsim-summary-content" class="wcsim-ai-content"></div>` +
    `</div>` +
    `</div>`;
}

// ワンクリック実行
function runWCSim() {
  wcsimClearTimers();
  const btn = document.getElementById('wcsim-run-btn');
  btn.disabled = true;
  btn.textContent = t('wcsimRunning');

  const res = wcsimRunTournament();
  const qualifiedGroups = new Set(res.qualifiedThirds.map(q => q.group));

  let html = `<div id="wcsim-sec-groups" class="wcsim-section" style="display:none">` +
    `<div class="wcsim-section-title">${t('wcsimGroupStage')}</div><div class="wcsim-groups-grid">`;
  Object.values(res.groups).forEach(g => { html += wcsimGroupCardHTML(g, qualifiedGroups); });
  html += `</div></div>`;

  html += wcsimKOSectionHTML('wcsim-sec-r32',   `⚔️ ${t('wcRound32')}`,      res.r32);
  html += wcsimKOSectionHTML('wcsim-sec-r16',   `⚔️ ${t('wcRound16')}`,      res.r16);
  html += wcsimKOSectionHTML('wcsim-sec-qf',    `🔥 ${t('wcQuarterFinal')}`, res.qf);
  html += wcsimKOSectionHTML('wcsim-sec-sf',    `🔥 ${t('wcSemiFinal')}`,    res.sf);
  html += wcsimKOSectionHTML('wcsim-sec-third', `🥉 ${t('wcsimThirdMatch')}`, [res.third]);
  html += wcsimKOSectionHTML('wcsim-sec-final', `🏆 ${t('wcFinal')}`,        [res.final]);
  html += wcsimPodiumHTML(res);

  document.getElementById('wcsim-content').innerHTML = html;

  // 段階表示演出（グループ → 各ラウンド → 優勝発表）
  const seq = ['wcsim-sec-groups', 'wcsim-sec-r32', 'wcsim-sec-r16', 'wcsim-sec-qf',
               'wcsim-sec-sf', 'wcsim-sec-third', 'wcsim-sec-final', 'wcsim-sec-podium'];
  const delays = [0, 1100, 2000, 2900, 3800, 4600, 5400, 6400];
  seq.forEach((id, i) => {
    _wcsimTimers.push(setTimeout(() => {
      const screen = document.getElementById('screen-wcsim');
      if (!screen.classList.contains('active')) return;
      const el = document.getElementById(id);
      if (!el) return;
      el.style.display = '';
      if (i === 0) { screen.scrollTop = 0; }
      else { el.scrollIntoView({behavior: 'smooth', block: i === seq.length - 1 ? 'center' : 'start'}); }
      if (i === seq.length - 1) {
        btn.disabled = false;
        btn.textContent = t('wcsimRerunBtn');
      }
    }, delays[i]));
  });
}

// ------------------------------------------------------------
// スタッツ詳細画面
// ------------------------------------------------------------

function wcsimPlayerLabel(p) {
  const nm = (window.LANG === 'en' && p.enName) ? p.enName : p.name;
  return `${TEAM_DATA[p.team].flag} ${nm}`;
}

// 汎用ランキングカード（rows は降順ソート済み、同値は同順位表示）
function wcsimRankingHTML(title, rows, valueFn, labelFn, subFn) {
  let html = `<div class="wcsim-stats-card"><div class="wcsim-stats-heading">${title}</div>`;
  if (rows.length === 0) html += `<div class="wcsim-stats-empty">-</div>`;
  let prevVal = null, rank = 0;
  rows.forEach((r, i) => {
    const v = valueFn(r);
    if (v !== prevVal) { rank = i + 1; prevVal = v; }
    html += `<div class="wcsim-stats-row${rank <= 3 ? ' wcsim-stats-top3' : ''}">` +
      `<span class="wcsim-stats-rank">${rank}</span>` +
      `<span class="wcsim-stats-name">${labelFn(r)}</span>` +
      (subFn ? `<span class="wcsim-stats-sub">${subFn(r)}</span>` : '') +
      `<span class="wcsim-stats-val">${v}</span></div>`;
  });
  html += `</div>`;
  return html;
}

function wcsimMatchLabel(m) {
  return `${TEAM_DATA[m.home].flag} ${m.hs}-${m.as} ${TEAM_DATA[m.away].flag}`;
}

function wcsimRenderStats() {
  const s = _wcsimStats;
  const players = Object.values(s.players);
  const teams = Object.values(s.teams);

  // 選手ランキング（上位10、同値タイブレークは第2指標）
  const topScorers = players.filter(p => p.goals > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || b.duelWins - a.duelWins).slice(0, 10);
  const topAssists = players.filter(p => p.assists > 0)
    .sort((a, b) => b.assists - a.assists || b.goals - a.goals || b.duelWins - a.duelWins).slice(0, 10);
  const topGA = players.filter(p => p.goals + p.assists > 0)
    .sort((a, b) => (b.goals + b.assists) - (a.goals + a.assists) || b.goals - a.goals).slice(0, 10);
  const topDuels = players.filter(p => p.duelWins > 0)
    .sort((a, b) => b.duelWins - a.duelWins || b.duels - a.duels).slice(0, 10);

  // GK（チームのセーブ数・クリーンシートをGKに帰属。先発GK固定運用のため）
  const gks = teams.map(tm => {
    const d = TEAM_DATA[tm.key];
    const gk = d.players[d.default_lineup[0]];
    return {team: tm.key, name: gk.name, enName: gk.en_name, saves: tm.saves, cs: tm.cleanSheets, matches: tm.matches};
  }).filter(g => g.saves > 0)
    .sort((a, b) => b.saves - a.saves || b.cs - a.cs).slice(0, 10);

  // チームランキング
  const teamLabelFn = (tm) => `${TEAM_DATA[tm.key].flag} ${wcsimTeamName(tm.key)}`;
  const teamGoals = [...teams].sort((a, b) => b.goals - a.goals || a.conceded - b.conceded).slice(0, 5);
  const teamCS = [...teams].filter(tm => tm.cleanSheets > 0)
    .sort((a, b) => b.cleanSheets - a.cleanSheets || a.conceded - b.conceded).slice(0, 5);
  const teamShots = [...teams].sort((a, b) => b.shots - a.shots).slice(0, 5);

  // 大会MVP
  let html = '';
  if (s.mvp) {
    html += `<div class="wcsim-mvp-card">` +
      `<div class="wcsim-mvp-label">⭐ ${t('wcsimMVPLabel')} ⭐</div>` +
      `<div class="wcsim-mvp-name">${wcsimPlayerLabel(s.mvp)}</div>` +
      `<div class="wcsim-mvp-team">${wcsimTeamName(s.mvp.team)}</div>` +
      `<div class="wcsim-mvp-stats">⚽ ${s.mvp.goals} ${t('wcsimUnitGoals')}　🎯 ${s.mvp.assists} ${t('wcsimUnitAssists')}　⚔️ ${s.mvp.duelWins} ${t('wcsimUnitDuelWins')}</div>` +
      `</div>`;
  }

  // 大会サマリー
  const avg = s.totalMatches ? (s.totalGoals / s.totalMatches).toFixed(2) : '0';
  html += `<div class="wcsim-stats-card" style="margin-bottom:10px">` +
    `<div class="wcsim-stats-heading">${t('wcsimStatsOverview')}</div>` +
    `<div class="wcsim-overview-grid">` +
    `<div class="wcsim-overview-item"><div class="wcsim-overview-num">${s.totalGoals}</div><div class="wcsim-overview-label">${t('wcsimStatsTotalGoals')}</div></div>` +
    `<div class="wcsim-overview-item"><div class="wcsim-overview-num">${avg}</div><div class="wcsim-overview-label">${t('wcsimStatsAvgGoals')}</div></div>` +
    `<div class="wcsim-overview-item"><div class="wcsim-overview-num">${s.etCount}</div><div class="wcsim-overview-label">${t('wcsimStatsET')}</div></div>` +
    `<div class="wcsim-overview-item"><div class="wcsim-overview-num">${s.pkCount}</div><div class="wcsim-overview-label">${t('wcsimStatsPK')}</div></div>` +
    `</div>`;
  if (s.topScoringMatch) {
    html += `<div class="wcsim-overview-note">${t('wcsimStatsTopMatch')}: ${wcsimMatchLabel(s.topScoringMatch)}</div>`;
  }
  if (s.biggestWin) {
    html += `<div class="wcsim-overview-note">${t('wcsimStatsBiggestWin')}: ${wcsimMatchLabel(s.biggestWin)}</div>`;
  }
  html += `</div>`;

  html += `<div class="wcsim-stats-grid">`;
  html += wcsimRankingHTML(t('wcsimStatsGoalsRank'), topScorers,
    p => p.goals, wcsimPlayerLabel, p => p.assists ? `A${p.assists}` : '');
  html += wcsimRankingHTML(t('wcsimStatsAssistsRank'), topAssists,
    p => p.assists, wcsimPlayerLabel, p => p.goals ? `G${p.goals}` : '');
  html += wcsimRankingHTML(t('wcsimStatsGARank'), topGA,
    p => p.goals + p.assists, wcsimPlayerLabel, p => `G${p.goals} A${p.assists}`);
  html += wcsimRankingHTML(t('wcsimStatsDuelsRank'), topDuels,
    p => p.duelWins, wcsimPlayerLabel, p => p.duels ? `${Math.round(p.duelWins / p.duels * 100)}%` : '');
  html += wcsimRankingHTML(t('wcsimStatsGKRank'), gks,
    g => g.saves, wcsimPlayerLabel, g => `${t('wcsimStatsCSShort')}${g.cs}`);
  html += wcsimRankingHTML(t('wcsimStatsTeamGoals'), teamGoals,
    tm => tm.goals, teamLabelFn, tm => `${tm.matches}${t('wcsimStatsMatchUnit')}`);
  html += wcsimRankingHTML(t('wcsimStatsTeamCS'), teamCS,
    tm => tm.cleanSheets, teamLabelFn, tm => `${tm.matches}${t('wcsimStatsMatchUnit')}`);
  html += wcsimRankingHTML(t('wcsimStatsTeamShots'), teamShots,
    tm => tm.shots, teamLabelFn, tm => `${tm.matches}${t('wcsimStatsMatchUnit')}`);
  html += `</div>`;

  document.getElementById('wcsim-stats-content').innerHTML = html;
}

function showWCSimStats() {
  if (!_wcsimStats) return;
  showScreen('wcsim-stats');
  document.getElementById('wcsim-stats-title').textContent = t('wcsimStatsTitle');
  wcsimRenderStats();
  window.scrollTo(0, 0);
}

// スタッツ画面 → 結果画面へ戻る（ポディウム位置を維持）
function wcsimStatsBack() {
  showScreen('wcsim');
  const podium = document.getElementById('wcsim-sec-podium');
  if (podium) podium.scrollIntoView({block: 'center'});
}

// ------------------------------------------------------------
// シェア画像（優勝カード, 1080x1080）— generateShareImage('wcsim') から呼ばれる
// ------------------------------------------------------------
function drawWcsimShareCanvas(ctx, d, isEn, S) {
  function tc(txt, x, y, font, color, maxW) {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'center';
    if (maxW) ctx.fillText(txt, x, y, maxW); else ctx.fillText(txt, x, y);
  }
  const cx = S / 2;

  // ゴールド背景（ポディウムと同系）
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, '#7b5c00'); g.addColorStop(0.55, '#c9960c'); g.addColorStop(1, '#ffd700');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);

  // 装飾の光輪
  ctx.beginPath(); ctx.arc(cx, 300, 360, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
  tc(isEn ? '2026 WORLD CUP — FULL SIMULATION' : '2026 W杯 まるごとシミュレート',
     cx, 110, '800 33px Arial', '#fff8e1', S - 120);
  ctx.restore();

  tc('🏆', cx, 270, '150px Arial', '#ffffff');
  tc(d.champFlag, cx, 445, '150px Arial', '#ffffff');

  tc(isEn ? 'CHAMPIONS' : '優 勝', cx, 512, '700 36px Arial', 'rgba(40,28,0,0.78)');
  tc(d.champName, cx, 600, '900 88px Arial', '#241a00', S - 120);

  tc('🥈 ' + (isEn ? 'Runner-up: ' : '準優勝: ') + d.ruFlag + ' ' + d.ruName,
     cx, 700, '700 40px Arial', '#3a2c00', S - 120);
  tc('🥉 ' + (isEn ? 'Third: ' : '3位: ') + d.thFlag + ' ' + d.thName,
     cx, 762, '700 40px Arial', '#3a2c00', S - 120);

  if (d.hasMvp) {
    tc('⭐ ' + (isEn ? 'MVP: ' : '大会MVP: ') + d.mvpFlag + ' ' + d.mvpName + '  (' + d.mvpG + 'G ' + d.mvpA + 'A)',
       cx, 856, '700 38px Arial', '#3a2c00', S - 120);
  }

  // フッター
  ctx.beginPath(); ctx.moveTo(140, 960); ctx.lineTo(S - 140, 960);
  ctx.strokeStyle = 'rgba(40,28,0,0.25)'; ctx.lineWidth = 2; ctx.stroke();
  tc('⚽ Football Sim', cx, 1012, '700 32px Arial', 'rgba(40,28,0,0.7)');
  tc('football-sim.com', cx, 1052, '400 24px Arial', 'rgba(40,28,0,0.5)');
}



// ------------------------------------------------------------
// AI大会総括（ルールベース・ローカル生成）
// ※ 共有AI Workerは単一試合/日本代表W杯向けプロンプト固定のため、
//   グローバル大会の総括は _wcsimStats から自前生成する
// ------------------------------------------------------------
function generateWcsimSummary() {
  var btn = document.getElementById('wcsim-summary-btn');
  var el  = document.getElementById('wcsim-summary-content');
  if (!btn || !el || !_wcsimStats) return;
  var isEn = window.LANG === 'en';
  btn.disabled = true; btn.textContent = t('generatingLabel'); btn.style.opacity = '0.6';
  el.innerHTML = '<span style="color:rgba(255,255,255,0.5);font-size:12px">✨ ' + (isEn ? 'Generating...' : '生成中...') + '</span>';

  var s = _wcsimStats;
  var tn = function(k){ return wcsimTeamName(k); };
  var champ = tn(s.champion), ru = tn(s.runnerUp), third = tn(s.thirdPlace);
  var path = s.champPath || {};
  var ko = path.koMatches || [];
  var koLabelJa = {r32:'ベスト32', r16:'ベスト16', qf:'準々決勝', sf:'準決勝', final:'決勝'};
  var koLabelEn = {r32:'Round of 32', r16:'Round of 16', qf:'quarter-final', sf:'semi-final', final:'final'};

  // KO各試合のスコア表記
  var fmtKo = function(m){
    var base = m.gf + '-' + m.ga;
    if (m.pk) return base + (isEn ? ' (pens ' + m.pk.f + '-' + m.pk.a + ')' : '（PK ' + m.pk.f + '-' + m.pk.a + '）');
    if (m.et) return base + (isEn ? ' (AET)' : '（延長）');
    return base;
  };
  var finalM = ko.find(function(m){ return m.stage === 'final'; });
  var roadM  = ko.filter(function(m){ return m.stage !== 'final'; });
  var koDrama = roadM.filter(function(m){ return m.pk || m.et; }).length;

  // 得点王
  var scList = Object.values(s.players).filter(function(p){ return p.goals > 0; })
    .sort(function(a,b){ return b.goals - a.goals || b.assists - a.assists; });
  var topSc = scList[0];
  var topScName = topSc ? ((isEn && topSc.enName) ? topSc.enName : topSc.name) : '';
  // 優勝国の主力（ゴール×2＋アシスト＋デュエル勝利で評価）
  var champStar = Object.values(s.players).filter(function(p){ return p.team === s.champion; })
    .sort(function(a,b){ return (b.goals*2+b.assists) - (a.goals*2+a.assists) || b.duelWins - a.duelWins; })[0];
  var champStarName = champStar ? ((isEn && champStar.enName) ? champStar.enName : champStar.name) : '';
  // MVP
  var mvpName = s.mvp ? ((isEn && s.mvp.enName) ? s.mvp.enName : s.mvp.name) : '';

  var avg = s.totalMatches ? (s.totalGoals / s.totalMatches).toFixed(2) : '0';
  var dramaJa = s.pkCount >= 7 ? '大荒れの' : s.pkCount >= 4 ? '接戦の' : '順当な';
  var dramaEn = s.pkCount >= 7 ? 'a dramatic, shootout-filled' : s.pkCount >= 4 ? 'a tightly-contested' : 'a relatively straightforward';
  var goalJa  = avg >= 1.6 ? '攻撃的な' : avg <= 1.2 ? '締まった' : 'バランスの取れた';
  var goalEn  = avg >= 1.6 ? 'high-scoring' : avg <= 1.2 ? 'defensively tight' : 'balanced';
  var biggest = s.biggestWin ? (tn(s.biggestWin.home) + ' ' + s.biggestWin.hs + '-' + s.biggestWin.as + ' ' + tn(s.biggestWin.away)) : '-';
  var topMatch = s.topScoringMatch ? (tn(s.topScoringMatch.home) + ' ' + s.topScoringMatch.hs + '-' + s.topScoringMatch.as + ' ' + tn(s.topScoringMatch.away)) : '-';

  var lines = [];
  if (isEn) {
    // 1. 優勝（決勝結果）
    var finalTxt = finalM ? (' beating ' + ru + ' ' + fmtKo(finalM) + ' in the final') : (' beating ' + ru + ' in the final');
    lines.push('🏆 ' + champ + ' are the champions of the 2026 World Cup simulation,' + finalTxt + ' to lift the trophy.');
    // 2. グループステージ
    if (path.groupLetter) {
      var gm = (path.groupMatches||[]).map(function(m){ return tn(m.opp) + ' ' + m.gf + '-' + m.ga; }).join(', ');
      lines.push('In Group ' + path.groupLetter + ' they finished ' + ordinalEn(path.pos) + ' with ' + path.w + 'W-' + path.d + 'D-' + path.l + 'L (' + path.gf + ' for, ' + path.ga + ' against)' + (gm ? ': ' + gm + '.' : '.'));
    }
    // 3. ノックアウトの道のり
    if (roadM.length) {
      var road = roadM.map(function(m){ return koLabelEn[m.stage] + ' ' + tn(m.opp) + ' ' + fmtKo(m); }).join(', ');
      lines.push('On the road to the final they saw off ' + road + (koDrama ? ', surviving ' + koDrama + ' knockout tie' + (koDrama>1?'s':'') + ' that went the distance.' : ', winning every tie in regulation.'));
    }
    // 4. 目立った選手
    var starLine = '';
    if (champStar) starLine = champStarName + ' led ' + champ + ' (' + champStar.goals + 'G/' + champStar.assists + 'A). ';
    starLine += 'The Golden Boot went to ' + topScName + ' (' + tn(topSc.team) + ', ' + topSc.goals + ' goals), and ' + mvpName + (s.mvp ? ' (' + tn(s.mvp.team) + ')' : '') + ' was named Tournament MVP. ' + third + ' finished third.';
    lines.push(starLine);
    // 5. 大会全体
    lines.push('Overall it was ' + dramaEn + ', ' + goalEn + ' tournament — ' + s.totalGoals + ' goals across ' + s.totalMatches + ' matches (avg ' + avg + '), ' + s.etCount + ' going to extra time and ' + s.pkCount + ' to penalties. Biggest win: ' + biggest + '. Highest-scoring match: ' + topMatch + '.');
  } else {
    // 1. 優勝（決勝結果）
    var finalTxtJa = finalM ? ('決勝で' + ru + 'を' + fmtKo(finalM) + 'で下し') : ('決勝で' + ru + 'を下し');
    lines.push('🏆 ' + champ + 'が2026W杯シミュレートを制覇！ ' + finalTxtJa + '、世界の頂点に立った。');
    // 2. グループステージ
    if (path.groupLetter) {
      var gmJa = (path.groupMatches||[]).map(function(m){ return tn(m.opp) + 'に' + m.gf + '-' + m.ga; }).join('、');
      lines.push('グループ' + path.groupLetter + 'は' + path.w + '勝' + path.d + '分' + path.l + '敗（' + path.gf + '得点' + path.ga + '失点）で' + path.pos + '位通過' + (gmJa ? '。' + gmJa + 'という結果だった。' : '。'));
    }
    // 3. ノックアウトの道のり
    if (roadM.length) {
      var roadJa = roadM.map(function(m){ return koLabelJa[m.stage] + 'で' + tn(m.opp) + 'を' + fmtKo(m); }).join('、');
      lines.push('決勝トーナメントでは' + roadJa + 'で撃破' + (koDrama ? ('、うち' + koDrama + '試合は延長・PKの死闘を制して') : '、すべて90分で勝ち切って') + '勝ち上がった。');
    }
    // 4. 目立った選手
    var starLineJa = '';
    if (champStar) starLineJa = champ + 'の攻撃を牽引したのは' + champStarName + '（' + champStar.goals + 'ゴール' + champStar.assists + 'アシスト）。';
    starLineJa += '得点王は' + topScName + '（' + tn(topSc.team) + '・' + topSc.goals + 'ゴール）、大会MVPは' + mvpName + (s.mvp ? '（' + tn(s.mvp.team) + '）' : '') + 'が獲得。3位は' + third + 'だった。';
    lines.push(starLineJa);
    // 5. 大会全体
    lines.push('大会全体では全' + s.totalMatches + '試合で' + s.totalGoals + 'ゴール、1試合平均' + avg + 'の' + goalJa + '大会。' + s.etCount + '試合が延長戦、' + s.pkCount + '試合がPK戦にもつれる' + dramaJa + 'トーナメントとなった。最大スコア差は' + biggest + '、最多得点試合は' + topMatch + '。');
  }
  var text = lines.join('\n\n');

  setTimeout(function() {
    el.innerHTML = '<div style="line-height:1.95;font-size:13px;color:rgba(255,255,255,0.92);text-align:left">'
      + text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '</div>';
    btn.textContent = isEn ? '✅ Generated' : '✅ 生成済み';
    btn.style.opacity = '0.6';
  }, 450);
}

// 英語序数（1st, 2nd, 3rd, 4th）
function ordinalEn(n) {
  var s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}
