/* =============================================================================
 * league.js — P3 デイリーリーグ（架空クラブ・8クラブ14節）
 * -----------------------------------------------------------------------------
 * VISION P3「1クラブ1シーズンの縦切り／1日1試合＝毎日最新話／リーグ順位」の MVP。
 *
 * 設計方針（既存資産の最大流用・エンジン/データ無改変）:
 *   - クラブ = 実在 TEAM_DATA スカッドを clone し、識別情報（クラブ名/色/エンブレム）と
 *     選手名だけ架空へ差し替える（能力パラメータ・ポジション・default_* はそのまま流用）。
 *     → IP クリーン（実名なし）＋バランスは実データ準拠。名前ハッシュで決定論生成。
 *   - 試合（自チーム）= P2 監督ビューア startManagerMatch() をそのまま起動。
 *   - 同節の他会場（AIvsAI）= match.js playMatch() でヘッドレス消化（未シード）。
 *   - 永続化 = localStorage（キャリア JSON・インフラ追加ゼロ）。
 *   - 1日1試合ロック = 端末日付ベース（MVP はソフト。厳密化は後日 Firestore）。
 *
 * 依存グローバル（全て非モジュール共有スコープ）:
 *   TEAM_DATA, system_data, playMatch, startManagerMatch, showScreen,
 *   team1Data, team2Data, team1State, gameState, getTeamName, window.LANG
 * 公開: window.showLeague / leaguePickClub / leaguePlayToday / leagueShowTable /
 *       leagueShowHub / leagueBackToTitle / leagueConfirmNewSeason / leagueDebugUnlock
 * ========================================================================== */
(function () {
  'use strict';

  var LS_KEY = 'fs_league_v1';
  var CLUBS_COUNT = 8;

  function _isEn() { return (typeof window !== 'undefined' && window.LANG === 'en'); }
  function _t(ja, en) { return _isEn() ? en : ja; }

  /* ── 架空クラブの識別情報（source = 流用元 TEAM_DATA キー） ─────────────── */
  var CLUB_DEFS = [
    { id: 'guren',   ja: '紅蓮ユナイテッド', en: 'Crimson United',   color: '#c0392b', crest: '🔥', source: 'brazil2026' },
    { id: 'soukai',  ja: '蒼海フットボール', en: 'Azure FC',         color: '#1f6fb2', crest: '🌊', source: 'france2026' },
    { id: 'kurogane',ja: '黒鉄シティ',       en: 'Ironclad City',    color: '#34495e', crest: '⚙️', source: 'spain2026' },
    { id: 'kinjishi',ja: '金獅子SC',         en: 'Golden Lions SC',  color: '#d4a017', crest: '🦁', source: 'england2026' },
    { id: 'suiran',  ja: '翠嵐アスレチック', en: 'Verdant Athletic', color: '#1e8449', crest: '🌿', source: 'netherlands2026' },
    { id: 'ginrou',  ja: '銀狼ローヴァーズ', en: 'Silver Wolves',    color: '#7f8c8d', crest: '🐺', source: 'usa2026' },
    { id: 'shiden',  ja: '紫電クラブ',       en: 'Violet Club',      color: '#8e44ad', crest: '⚡', source: 'morocco2026' },
    { id: 'touka',   ja: '橙火FC',           en: 'Amber FC',         color: '#e67e22', crest: '🔶', source: 'norway2026' }
  ];

  /* ── 架空選手名の決定論生成（音節合成・JA/EN 整合） ───────────────────── */
  var SYL1 = [['ラ','Ra'],['ロ','Ro'],['レ','Re'],['ヴァ','Va'],['ヴェ','Ve'],['ヴォ','Vo'],['ガ','Ga'],['ゴ','Go'],
              ['ザ','Za'],['ゾ','Zo'],['ダ','Da'],['ド','Do'],['バ','Ba'],['ボ','Bo'],['ブ','Bu'],['カ','Ka'],
              ['コ','Ko'],['サ','Sa'],['ソ','So'],['タ','Ta'],['ト','To'],['ナ','Na'],['ノ','No'],['ハ','Ha'],
              ['ホ','Ho'],['マ','Ma'],['モ','Mo'],['パ','Pa'],['ポ','Po'],['フェ','Fe'],['グ','Gu'],['ク','Ku']];
  var SYL2 = [['ル','ru'],['ン','n'],['ス','s'],['ノ','no'],['レ','re'],['リ','ri'],['ロ','ro'],['ラ','ra'],
              ['ド','do'],['ト','to'],['ニ','ni'],['ミ','mi'],['ゴ','go'],['ザ','za'],['ヴィ','vi'],['ッチ','cci'],
              ['スキ','ski'],['ノフ','nov'],['マン','man'],['ソン','son'],['ベル','ber'],['ダル','dal']];

  function _makeName(clubIdx, playerIdx, used) {
    // 決定論ハッシュ → 音節。前後の音節を別系列で回し、隣接選手が韻を踏まないようにする。
    var baseA = playerIdx * 5 + clubIdx * 11 + 3;
    var baseB = playerIdx * 3 + clubIdx * 7 + 1;
    for (var tries = 0; tries < SYL1.length * SYL2.length; tries++) {
      var av = baseA + tries;
      var a = av % SYL1.length;
      var b = (baseB + Math.floor(av / SYL1.length)) % SYL2.length;
      var ja = SYL1[a][0] + SYL2[b][0];
      if (!used[ja]) {
        used[ja] = true;
        var en = SYL1[a][1] + SYL2[b][1];
        return { ja: ja, en: en.charAt(0).toUpperCase() + en.slice(1) };
      }
    }
    return { ja: '選手' + playerIdx, en: 'Player' + playerIdx };
  }

  /* ── クラブ実体（TEAM_DATA 互換）を生成 ──────────────────────────────── */
  var _clubs = null; // { id: teamData } — teamData は TEAM_DATA と同形

  function _deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  function _buildClubs() {
    if (_clubs) return _clubs;
    _clubs = {};
    for (var c = 0; c < CLUB_DEFS.length; c++) {
      var def = CLUB_DEFS[c];
      var src = (typeof TEAM_DATA !== 'undefined') ? TEAM_DATA[def.source] : null;
      if (!src) { console.warn('[league] source squad not found:', def.source); continue; }
      var td = _deepClone(src);
      td.name = def.ja;
      td.en_name = def.en;
      td.team_color = def.color;
      td.flag = def.crest;
      td.club_id = def.id;
      // 選手名を架空へ（params/positions は流用）
      var used = {};
      for (var i = 0; i < td.players.length; i++) {
        var nm = _makeName(c, i, used);
        td.players[i].name = nm.ja;
        td.players[i].en_name = nm.en;
        td.players[i].long_name = nm.ja;
      }
      _clubs[def.id] = td;
    }
    return _clubs;
  }

  function _clubData(id) { return _buildClubs()[id]; }
  function _clubDef(id) { for (var i = 0; i < CLUB_DEFS.length; i++) if (CLUB_DEFS[i].id === id) return CLUB_DEFS[i]; return null; }
  function _clubName(id) { var td = _clubData(id); return td ? (_isEn() ? td.en_name : td.name) : id; }

  /* ── 総当たり（ダブルラウンドロビン）日程 = サークル法 ─────────────────── */
  function _makeFixtures(clubIds) {
    var ids = clubIds.slice();
    var n = ids.length;                 // 8
    var rounds = [];
    var arr = ids.slice();
    // 第1レグ n-1 節
    for (var r = 0; r < n - 1; r++) {
      var matches = [];
      for (var i = 0; i < n / 2; i++) {
        var home = arr[i], away = arr[n - 1 - i];
        // 見栄えのためホーム/アウェイを節ごとに軽く入替
        if (r % 2 === 1 && i !== 0) { var tmp = home; home = away; away = tmp; }
        matches.push({ home: home, away: away, played: false, hs: 0, as: 0 });
      }
      rounds.push(matches);
      // 回転（先頭固定）
      var fixed = arr[0];
      var rest = arr.slice(1);
      rest.unshift(rest.pop());
      arr = [fixed].concat(rest);
    }
    // 第2レグ = ホーム/アウェイ反転
    var leg1 = rounds.slice();
    for (var r2 = 0; r2 < leg1.length; r2++) {
      var mm = leg1[r2].map(function (m) { return { home: m.away, away: m.home, played: false, hs: 0, as: 0 }; });
      rounds.push(mm);
    }
    return rounds; // 14 節 × 4 試合
  }

  /* ── 状態モデル ─────────────────────────────────────────────────────── */
  var _state = null;

  function _todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function _emptyStanding() { return { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }; }

  function _newSeason(myClubId) {
    var ids = CLUB_DEFS.map(function (d) { return d.id; });
    var standings = {};
    ids.forEach(function (id) { standings[id] = _emptyStanding(); });
    _state = {
      version: 1,
      myClub: myClubId,
      clubs: ids,
      fixtures: _makeFixtures(ids),
      standings: standings,
      round: 0,
      lastPlayedDate: null,
      lastResult: null,   // { round, mine:{me,opp,ms,os,res}, others:[{home,away,hs,as}] }
      finished: false
    };
    _save();
  }

  function _save() { try { localStorage.setItem(LS_KEY, JSON.stringify(_state)); } catch (e) { console.warn('[league] save failed', e); } }
  function _load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) { _state = null; return; }
      var s = JSON.parse(raw);
      if (!s || s.version !== 1 || !s.fixtures) { _state = null; return; }
      _state = s;
    } catch (e) { _state = null; }
  }

  function _applyResult(homeId, awayId, hs, as) {
    var H = _state.standings[homeId], A = _state.standings[awayId];
    H.p++; A.p++; H.gf += hs; H.ga += as; A.gf += as; A.ga += hs;
    if (hs > as) { H.w++; A.l++; H.pts += 3; }
    else if (hs < as) { A.w++; H.l++; A.pts += 3; }
    else { H.d++; A.d++; H.pts++; A.pts++; }
  }

  function _sortedStandings() {
    var rows = _state.clubs.map(function (id) {
      var s = _state.standings[id];
      return { id: id, p: s.p, w: s.w, d: s.d, l: s.l, gf: s.gf, ga: s.ga, gd: s.gf - s.ga, pts: s.pts };
    });
    rows.sort(function (a, b) {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return _clubName(a.id) < _clubName(b.id) ? -1 : 1;
    });
    return rows;
  }

  function _myFixtureThisRound() {
    if (!_state || _state.round >= _state.fixtures.length) return null;
    var ms = _state.fixtures[_state.round];
    for (var i = 0; i < ms.length; i++) {
      if (ms[i].home === _state.myClub || ms[i].away === _state.myClub) return ms[i];
    }
    return null;
  }

  function _lockedToday() {
    return !!(_state && _state.lastPlayedDate === _todayStr());
  }

  /* ── 試合起動（自チーム = 監督ビューア） ─────────────────────────────── */
  function playToday() {
    if (!_state || _state.finished) return;
    if (_lockedToday()) return;
    if (typeof startManagerMatch !== 'function') { alert('startManagerMatch 未ロード'); return; }
    var fx = _myFixtureThisRound();
    if (!fx) return;

    var myId = _state.myClub;
    var oppId = (fx.home === myId) ? fx.away : fx.home;
    var iAmHome = (fx.home === myId);

    // 監督ビューアは常に team1 = 自チーム（左）として表示。ホーム/アウェイは順位表記録側で扱う。
    team1Data = _clubData(myId);
    team2Data = _clubData(oppId);

    // team1State は startManagerMatch の呼び出し側責務（team2State は内部生成）
    var s1 = system_data.findIndex(function (s) { return s.name === team1Data.default_system; });
    team1State = {
      systemIdx: s1 >= 0 ? s1 : 0,
      tactics: team1Data.default_tactics,
      keyplayer: team1Data.default_keyplayer,
      marked_player: (team1Data.default_marked_player !== undefined) ? team1Data.default_marked_player : -1,
      lineup: team1Data.default_lineup.slice(0, 11)
    };

    // 試合終了フック（_mvFinish が拾う。1回で自動解除）
    window._leagueOnMatchFinish = function () { _onMatchFinish(myId, oppId, iAmHome, fx); };

    startManagerMatch();
  }

  function _onMatchFinish(myId, oppId, iAmHome, fx) {
    window._leagueOnMatchFinish = null;
    // 自チーム = team1（gameState.team1）。得点は team.score。
    var myScore = (gameState && gameState.team1) ? gameState.team1.score : 0;
    var oppScore = (gameState && gameState.team2) ? gameState.team2.score : 0;

    // 順位表はホーム/アウェイの実カードで記録
    var hs = iAmHome ? myScore : oppScore;
    var as = iAmHome ? oppScore : myScore;
    fx.played = true; fx.hs = hs; fx.as = as;
    _applyResult(fx.home, fx.away, hs, as);

    // 同節の他会場（AIvsAI）をヘッドレス消化
    var others = [];
    var ms = _state.fixtures[_state.round];
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (m === fx || m.played) continue;
      var res = { home: 0, away: 0 };
      try {
        var r = playMatch(_clubData(m.home), _clubData(m.away));
        res = r.result;
      } catch (e) { console.warn('[league] AI match failed', e); }
      m.played = true; m.hs = res.home; m.as = res.away;
      _applyResult(m.home, m.away, res.home, res.away);
      others.push({ home: m.home, away: m.away, hs: res.home, as: res.away });
    }

    var res = (myScore > oppScore) ? 'W' : (myScore < oppScore) ? 'L' : 'D';
    _state.lastResult = {
      round: _state.round,
      mine: { me: myId, opp: oppId, ms: myScore, os: oppScore, res: res, home: iAmHome },
      others: others
    };
    _state.round++;
    _state.lastPlayedDate = _todayStr();
    if (_state.round >= _state.fixtures.length) _state.finished = true;
    _save();

    // 監督ビューアの後片付け → リーグホームへ（試合後バナー付き）
    if (typeof window._mvTeardown === 'function') { try { window._mvTeardown(); } catch (e) {} }
    showScreen('home');
    _renderHub(true);
  }

  /* ── レンダリング ───────────────────────────────────────────────────── */
  function _ensureStyle() {
    if (document.getElementById('league-style')) return;
    var st = document.createElement('style');
    st.id = 'league-style';
    st.textContent = [
      '#screen-home{background:linear-gradient(160deg,#0b1f3f 0%,#0a2a5e 52%,#0d1b3e 100%);align-items:center;justify-content:flex-start;overflow-y:auto;color:#fff}',
      '.lg-wrap{width:100%;max-width:440px;margin:0 auto;padding:12px 14px 40px;box-sizing:border-box}',
      '.lg-h{font-family:"Bebas Neue",sans-serif;letter-spacing:1px;font-size:15px;color:#cde0ff;margin:18px 2px 8px;font-weight:700}',
      '.lg-card{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:14px;margin-bottom:12px;box-shadow:0 4px 18px rgba(0,0,0,0.25)}',
      '.lg-club{display:flex;align-items:center;gap:12px}',
      '.lg-crest{width:44px;height:44px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0}',
      '.lg-clubname{font-size:17px;font-weight:800;line-height:1.15}',
      '.lg-sub{font-size:11px;color:rgba(255,255,255,0.6);margin-top:2px}',
      '.lg-hero{border-radius:14px;padding:16px 14px;margin-bottom:12px;position:relative;overflow:hidden}',
      '.lg-vs{display:flex;align-items:center;justify-content:center;gap:10px;margin:8px 0}',
      '.lg-vs .side{flex:1;text-align:center}',
      '.lg-vs .crest{font-size:30px}',
      '.lg-vs .nm{font-size:12px;font-weight:700;margin-top:3px;line-height:1.2}',
      '.lg-vs .mid{font-family:"Bebas Neue";font-size:22px;opacity:.85;padding:0 4px}',
      '.lg-badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(255,255,255,0.18);margin-left:6px;vertical-align:middle}',
      '.lg-btn{display:block;width:100%;box-sizing:border-box;padding:14px;border:none;border-radius:12px;font-family:inherit;font-size:15px;font-weight:800;cursor:pointer;margin-top:6px;color:#fff;background:linear-gradient(135deg,#e8433b,#c0392b);box-shadow:0 4px 14px rgba(192,57,43,0.4)}',
      '.lg-btn:disabled{background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.45);box-shadow:none;cursor:default}',
      '.lg-btn.sec{background:rgba(255,255,255,0.1);box-shadow:none;font-size:14px}',
      '.lg-table{width:100%;border-collapse:collapse;font-size:12px}',
      '.lg-table th{color:rgba(255,255,255,0.55);font-weight:700;font-size:10px;padding:5px 3px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.15)}',
      '.lg-table td{padding:7px 3px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.07)}',
      '.lg-table td.nm{text-align:left;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}',
      '.lg-table tr.me{background:rgba(255,255,255,0.11)}',
      '.lg-table td.pts{font-weight:800}',
      '.lg-pos{display:inline-block;width:18px;color:rgba(255,255,255,0.5);font-weight:700}',
      '.lg-dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:middle}',
      '.lg-pick{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
      '.lg-pick .pc{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:12px;cursor:pointer;text-align:center;transition:transform .1s}',
      '.lg-pick .pc:active{transform:scale(0.97)}',
      '.lg-pick .pc .cr{font-size:28px}',
      '.lg-pick .pc .pn{font-size:13px;font-weight:800;margin-top:4px}',
      '.lg-pick .pc .pr{font-size:10px;color:rgba(255,255,255,0.55);margin-top:2px}',
      '.lg-resbadge{font-family:"Bebas Neue";font-size:30px;font-weight:700;letter-spacing:1px}',
      '.lg-mini{font-size:11px;color:rgba(255,255,255,0.7);line-height:1.7}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function _clubStrength(id) {
    // squad 上位11の総合平均（クラブ選択の目安表示用）
    var td = _clubData(id);
    var vals = td.players.map(function (p) {
      var s = 0; for (var i = 0; i < p.params.length; i++) s += p.params[i];
      return s / p.params.length;
    }).sort(function (a, b) { return b - a; }).slice(0, 11);
    var avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    return Math.round(avg);
  }

  function _body() {
    var el = document.getElementById('league-body');
    return el;
  }

  function _renderPick() {
    _ensureStyle();
    var defs = CLUB_DEFS.slice();
    var cards = defs.map(function (d) {
      var str = _clubStrength(d.id);
      var stars = '★'.repeat(Math.max(1, Math.min(5, Math.round((str - 66) / 3))));
      return '<div class="pc" onclick="leaguePickClub(\'' + d.id + '\')">' +
        '<div class="cr" style="filter:drop-shadow(0 0 6px ' + d.color + ')">' + d.crest + '</div>' +
        '<div class="pn">' + (_isEn() ? d.en : d.ja) + '</div>' +
        '<div class="pr" style="color:' + d.color + '">' + stars + '</div>' +
        '<div class="pr">' + _t('総合', 'OVR') + ' ' + str + '</div>' +
        '</div>';
    }).join('');
    _body().innerHTML =
      '<div class="lg-wrap">' +
        '<div class="lg-card" style="text-align:center">' +
          '<div style="font-size:20px;font-weight:800">' + _t('デイリーリーグ', 'Daily League') + '</div>' +
          '<div class="lg-sub" style="margin-top:6px;font-size:12px">' +
            _t('8クラブ・ホーム&アウェイ14節。1日1試合、監督として1シーズンを戦う。',
               '8 clubs, home & away, 14 rounds. One match a day — manage a full season.') +
          '</div>' +
        '</div>' +
        '<div class="lg-h">' + _t('▼ 指揮するクラブを選ぶ', '▼ Pick your club') + '</div>' +
        '<div class="lg-pick">' + cards + '</div>' +
      '</div>';
  }

  function _resultColor(res) { return res === 'W' ? '#2ecc71' : res === 'L' ? '#e74c3c' : '#f1c40f'; }

  function _renderHub(showBanner) {
    _ensureStyle();
    var myId = _state.myClub;
    var myDef = _clubDef(myId);
    var rows = _sortedStandings();
    var myPos = rows.findIndex(function (r) { return r.id === myId; }) + 1;
    var myRow = rows[myPos - 1];

    var html = '<div class="lg-wrap">';

    // 試合後バナー
    if (showBanner && _state.lastResult) {
      var lr = _state.lastResult;
      var oppDef = _clubDef(lr.mine.opp);
      var resTxt = lr.mine.res === 'W' ? _t('勝利！', 'WIN!') : lr.mine.res === 'L' ? _t('敗戦', 'LOSS') : _t('引き分け', 'DRAW');
      html += '<div class="lg-hero" style="background:linear-gradient(135deg,' + _resultColor(lr.mine.res) + '33,rgba(0,0,0,0.25));border:1px solid ' + _resultColor(lr.mine.res) + '66">' +
        '<div style="text-align:center;color:' + _resultColor(lr.mine.res) + '" class="lg-resbadge">' + resTxt + '</div>' +
        '<div class="lg-vs">' +
          '<div class="side"><div class="crest">' + myDef.crest + '</div><div class="nm">' + _clubName(myId) + '</div></div>' +
          '<div class="mid">' + lr.mine.ms + ' - ' + lr.mine.os + '</div>' +
          '<div class="side"><div class="crest">' + oppDef.crest + '</div><div class="nm">' + _clubName(lr.mine.opp) + '</div></div>' +
        '</div>';
      if (lr.others && lr.others.length) {
        var ot = lr.others.map(function (o) {
          return _clubName(o.home) + ' <b>' + o.hs + '-' + o.as + '</b> ' + _clubName(o.away);
        }).join('<br>');
        html += '<div class="lg-mini" style="margin-top:8px;text-align:center;border-top:1px solid rgba(255,255,255,0.12);padding-top:8px">' +
          '<div style="font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:3px">' + _t('他会場', 'Other results') + '</div>' + ot + '</div>';
      }
      html += '</div>';
    }

    // 自クラブヘッダー
    html += '<div class="lg-card"><div class="lg-club">' +
      '<div class="lg-crest" style="background:' + myDef.color + '33;border:1px solid ' + myDef.color + '">' + myDef.crest + '</div>' +
      '<div style="flex:1"><div class="lg-clubname">' + _clubName(myId) + '</div>' +
      '<div class="lg-sub">' + _t('現在', 'Position') + ' <b style="color:#fff">' + myPos + _t('位', '') + '</b>' +
      '　' + myRow.pts + _t('pt', ' pts') + '　' + myRow.w + _t('勝', 'W') + myRow.d + _t('分', 'D') + myRow.l + _t('敗', 'L') + '</div></div>' +
      '</div></div>';

    // 本日の試合 or シーズン終了
    if (_state.finished) {
      var champ = rows[0];
      var champDef = _clubDef(champ.id);
      var won = champ.id === myId;
      html += '<div class="lg-hero" style="background:linear-gradient(135deg,#d4a01755,rgba(0,0,0,0.3));border:1px solid #d4a017;text-align:center">' +
        '<div style="font-size:34px">🏆</div>' +
        '<div style="font-size:16px;font-weight:800;margin-top:4px">' + _t('シーズン終了', 'Season Complete') + '</div>' +
        '<div style="margin-top:6px;font-size:14px">' + _t('優勝', 'Champions') + '：' + champDef.crest + ' <b>' + _clubName(champ.id) + '</b></div>' +
        (won ? '<div style="color:#2ecc71;font-weight:800;margin-top:6px">' + _t('あなたのクラブが頂点に！', 'Your club took the title!') + '</div>' : '') +
        '</div>' +
        '<button class="lg-btn" onclick="leagueConfirmNewSeason()">' + _t('新シーズンを始める', 'Start a new season') + '</button>';
    } else {
      var fx = _myFixtureThisRound();
      var oppId = (fx.home === myId) ? fx.away : fx.home;
      var oppDef2 = _clubDef(oppId);
      var iAmHome = (fx.home === myId);
      var haBadge = iAmHome ? _t('HOME', 'HOME') : _t('AWAY', 'AWAY');
      html += '<div class="lg-h">' + _t('第' + (_state.round + 1) + '節 / 14', 'Round ' + (_state.round + 1) + ' / 14') +
        '<span class="lg-badge">' + haBadge + '</span></div>';
      html += '<div class="lg-hero" style="background:linear-gradient(135deg,' + myDef.color + '33,' + oppDef2.color + '33)">' +
        '<div class="lg-vs">' +
          '<div class="side"><div class="crest">' + myDef.crest + '</div><div class="nm">' + _clubName(myId) + '</div></div>' +
          '<div class="mid">VS</div>' +
          '<div class="side"><div class="crest">' + oppDef2.crest + '</div><div class="nm">' + _clubName(oppId) + '</div></div>' +
        '</div></div>';
      if (_lockedToday()) {
        html += '<button class="lg-btn" disabled>' + _t('本日は消化済み — また明日', 'Played today — come back tomorrow') + '</button>';
        html += '<div class="lg-mini" style="text-align:center;margin-top:6px">' + _t('1日1試合。物語は毎日ひとつずつ進む。', 'One match a day. The story advances daily.') + '</div>';
      } else {
        html += '<button class="lg-btn" onclick="leaguePlayToday()">▶ ' + _t('今日の試合を戦う（監督モード）', "Play today's match (Manager mode)") + '</button>';
      }
    }

    // ミニ順位表
    html += '<div class="lg-h">' + _t('順位表', 'Standings') + '</div>';
    html += _standingsTableHTML(rows, myId);

    html += '<button class="lg-btn sec" onclick="leagueBackToTitle()">' + _t('← タイトルへ戻る', '← Back to title') + '</button>';
    html += '</div>';
    _body().innerHTML = html;
  }

  function _standingsTableHTML(rows, myId) {
    var head = '<tr><th></th><th class="nm" style="text-align:left">' + _t('クラブ', 'Club') + '</th>' +
      '<th>' + _t('試', 'P') + '</th><th>' + _t('勝', 'W') + '</th><th>' + _t('分', 'D') + '</th><th>' + _t('敗', 'L') + '</th>' +
      '<th>' + _t('得失', 'GD') + '</th><th>' + _t('点', 'Pts') + '</th></tr>';
    var body = rows.map(function (r, i) {
      var def = _clubDef(r.id);
      var gd = (r.gd > 0 ? '+' : '') + r.gd;
      return '<tr class="' + (r.id === myId ? 'me' : '') + '">' +
        '<td><span class="lg-pos">' + (i + 1) + '</span></td>' +
        '<td class="nm"><span class="lg-dot" style="background:' + def.color + '"></span>' + def.crest + ' ' + _clubName(r.id) + '</td>' +
        '<td>' + r.p + '</td><td>' + r.w + '</td><td>' + r.d + '</td><td>' + r.l + '</td>' +
        '<td>' + gd + '</td><td class="pts">' + r.pts + '</td></tr>';
    }).join('');
    return '<div class="lg-card" style="padding:8px 10px"><table class="lg-table">' + head + body + '</table></div>';
  }

  /* ── 公開エントリ ───────────────────────────────────────────────────── */
  // #screen-home / #league-body を DOM に自己注入（公開 index.html を汚さず、
  // lab ビルドは league.js を読み込むだけでハブ画面が使えるようにする）。
  function _ensureHomeScreen() {
    if (document.getElementById('screen-home')) return;
    var scr = document.createElement('div');
    scr.id = 'screen-home';
    scr.className = 'screen';
    var body = document.createElement('div');
    body.id = 'league-body';
    body.style.width = '100%';
    scr.appendChild(body);
    document.body.appendChild(scr);
  }

  function showLeague() {
    _ensureHomeScreen();
    _load();
    if (typeof showScreen === 'function') showScreen('home');
    if (!_state) _renderPick();
    else _renderHub(false);
  }

  window.showLeague = showLeague;
  window.leaguePickClub = function (id) { _newSeason(id); _renderHub(false); };
  window.leaguePlayToday = function () { playToday(); };
  window.leagueShowHub = function () { _renderHub(false); };
  window.leagueBackToTitle = function () { if (typeof showScreen === 'function') showScreen('title'); };
  window.leagueConfirmNewSeason = function () {
    if (confirm(_t('現在のシーズン記録は消えます。新シーズンを始めますか？', 'Your current season will be erased. Start a new season?'))) {
      var my = _state ? _state.myClub : null;
      _state = null; _save(); localStorage.removeItem(LS_KEY);
      _renderPick();
    }
  };
  // デバッグ: ?debug=1 時、当日ロックを解除して連続プレイ可
  window.leagueDebugUnlock = function () { if (_state) { _state.lastPlayedDate = null; _save(); _renderHub(false); } };
})();
