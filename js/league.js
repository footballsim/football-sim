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

  /* ── 参加クラブ ＝ シミュレータ既存チームの「チーム力上位8」（テスト段階：架空でなく実チーム）
   * チーム力（先発11のパラメータ平均）で算出した上位。id は TEAM_DATA のキーをそのまま使う。 */
  var LEAGUE_TEAM_KEYS = [
    'england2026',     // イングランド 76.2
    'netherlands2026', // オランダ     74.7
    'spain2026',       // スペイン     74.2
    'france2026',      // フランス     73.1
    'argentina2026',   // アルゼンチン 73.1
    'italy2026',       // イタリア     72.7
    'brazil2026',      // ブラジル     72.4
    'belgium2026'      // ベルギー     72.4
  ];

  // クラブ識別情報（id/名前/色/エンブレム）を実 TEAM_DATA から生成。名前・色・国旗・選手はすべて実データ。
  var CLUB_DEFS = LEAGUE_TEAM_KEYS.map(function (key) {
    var td = (typeof TEAM_DATA !== 'undefined') ? TEAM_DATA[key] : null;
    return td
      ? { id: key, ja: td.name, en: td.en_name, color: td.team_color, crest: td.flag }
      : { id: key, ja: key, en: key, color: '#888888', crest: '⚽' };
  });

  function _clubData(id) { return (typeof TEAM_DATA !== 'undefined') ? TEAM_DATA[id] : null; }
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
      version: 2,   // v2: 参加クラブを実チーム(上位8)へ切替（旧v1=架空クラブのセーブは無効化）
      myClub: myClubId,
      rival: _computeRival(myClubId),   // 宿敵＝実力が最も近いクラブ（因縁の相手）
      clubs: ids,
      fixtures: _makeFixtures(ids),
      standings: standings,
      round: 0,
      lastPlayedDate: null,
      lastResult: null,   // { round, mine:{me,opp,ms,os,res,rival,posBefore,posAfter,mom,scorers}, others:[...] }
      finished: false
    };
    _save();
  }

  // 宿敵＝自クラブと総合力が最も近い他クラブ（決定論・因縁の相手）
  function _computeRival(myId) {
    var myStr = _clubStrength(myId), best = null, bestDiff = Infinity;
    CLUB_DEFS.forEach(function (d) {
      if (d.id === myId) return;
      var diff = Math.abs(_clubStrength(d.id) - myStr);
      if (diff < bestDiff) { bestDiff = diff; best = d.id; }
    });
    return best;
  }
  function _isRival(id) { return !!(_state && _state.rival && id === _state.rival); }

  // 全fixturesから a vs b の played カードを a視点で集計（宿敵通算成績）
  function _h2h(aId, bId) {
    var w = 0, d = 0, l = 0;
    _state.fixtures.forEach(function (round) {
      round.forEach(function (m) {
        if (!m.played) return;
        if (!((m.home === aId && m.away === bId) || (m.home === bId && m.away === aId))) return;
        var af = (m.home === aId) ? m.hs : m.as;
        var bf = (m.home === aId) ? m.as : m.hs;
        if (af > bf) w++; else if (af < bf) l++; else d++;
      });
    });
    return { w: w, d: d, l: l };
  }

  function _position(id) {
    var rows = _sortedStandings();
    for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return i + 1;
    return rows.length;
  }

  function _save() { try { localStorage.setItem(LS_KEY, JSON.stringify(_state)); } catch (e) { console.warn('[league] save failed', e); } }
  function _load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) { _state = null; return; }
      var s = JSON.parse(raw);
      if (!s || s.version !== 2 || !s.fixtures) { _state = null; return; }   // 旧版セーブは破棄
      _state = s;
      if (!_state.rival) { _state.rival = _computeRival(_state.myClub); _save(); }  // 旧セーブへ宿敵を補完
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

  // テストビルド(lab)でのみ有効な「1日1回」バイパス（背骨なので本番では出さない）
  function _testMode() { return typeof window !== 'undefined' && window.LEAGUE_TEST_MODE === true; }
  function _lockedToday() {
    if (_testMode() && _state && _state.testUnlock) return false;   // テスト：制限OFF
    return !!(_state && _state.lastPlayedDate === _todayStr());
  }

  /* ── 試合後レポート用: 自チームの得点者・アシスト・MOM を sim 結果から抽出 ───
   * 既存WCモードと同一方式（scene: result==='ゴール！！' / 得点=ofsPos / 助=crossPos）。
   * 自チーム＝ sc.offence === gameState.team1（league は team1 に自クラブをセット）。 */
  function _collectMyStats() {
    var empty = { scorers: [], mom: null };
    if (typeof chanceResults === 'undefined' || !chanceResults) return empty;
    if (typeof gameState === 'undefined' || !gameState || !gameState.team1) return empty;
    var t1 = gameState.team1, stats = {};
    chanceResults.forEach(function (res) {
      if (!res || !res.scenes) return;
      res.scenes.forEach(function (sc) {
        if (sc.offence !== t1) return;
        var isGoal = sc.result === 'ゴール！！';
        var credit = isGoal || sc.result === '成功' || sc.result === 'ファール';
        var lineup = sc.offence.lineup, players = sc.offence.players;
        if (!lineup || !players) return;
        var p = players[lineup[sc.ofsPos]];
        if (!p) return;
        if (!stats[p.name]) stats[p.name] = { goals: 0, assists: 0, duelWins: 0 };
        if (credit) stats[p.name].duelWins++;
        if (isGoal) {
          stats[p.name].goals++;
          if (sc.crossPos !== undefined && sc.crossPos !== sc.ofsPos) {
            var ap = players[lineup[sc.crossPos]];
            if (ap) { if (!stats[ap.name]) stats[ap.name] = { goals: 0, assists: 0, duelWins: 0 }; stats[ap.name].assists++; }
          }
        }
      });
    });
    var names = Object.keys(stats);
    var scorers = names.filter(function (n) { return stats[n].goals > 0; })
      .map(function (n) { return { name: n, goals: stats[n].goals, assists: stats[n].assists }; })
      .sort(function (a, b) { return (b.goals * 10 + b.assists) - (a.goals * 10 + a.assists); });
    var mom = null, best = -1;
    names.forEach(function (n) {
      var s = stats[n], sc = s.goals * 3 + s.assists * 2 + s.duelWins * 0.2;
      if (sc > best) { best = sc; mom = { name: n, goals: s.goals, assists: s.assists }; }
    });
    if (!mom) {  // 誰も記録なし（0-0等）→ キープレイヤー/先発GKを立てる
      var td = _clubData(_state.myClub);
      var kp = td.players[td.default_keyplayer] || td.players[0];
      if (kp) mom = { name: kp.name, goals: 0, assists: 0 };
    }
    return { scorers: scorers, mom: mom };
  }

  /* ── 実況テキストログ（試合後に見直す） ─────────────────────────────
   * 各チャンス res.textScenes（simulateChance が生成済み）を時刻付きで連結。 */
  function _buildMatchLog() {
    var out = [];
    if (typeof chanceResults === 'undefined' || !chanceResults) return out;
    chanceResults.forEach(function (res) {
      if (!res || !res.textScenes) return;
      res.textScenes.forEach(function (tx) {
        if (tx && String(tx).replace(/<[^>]*>/g, '').trim()) out.push({ t: res.time || '', x: tx });
      });
    });
    return out;
  }
  function _showMatchLog() {
    var lr = _state && _state.lastResult;
    if (!lr || !lr.log || !lr.log.length) return;
    _ensureStyle();
    var old = document.getElementById('lg-log-ov'); if (old) old.parentNode.removeChild(old);
    var myD = _clubDef(lr.mine.me), opD = _clubDef(lr.mine.opp);
    var rows = '', lastT = null;
    lr.log.forEach(function (l) {
      var tcell = (l.t !== lastT) ? l.t : ''; lastT = l.t;
      rows += '<div class="lg-logrow"><span class="lg-logtime">' + tcell + '</span><span class="lg-logtxt">' + l.x + '</span></div>';
    });
    var ov = document.createElement('div');
    ov.id = 'lg-log-ov'; ov.className = 'lg-logov';
    ov.innerHTML =
      '<div class="lg-loghead">' +
        '<div style="font-weight:800;font-size:14px">' + myD.crest + ' ' + _clubName(lr.mine.me) + ' <b>' + lr.mine.ms + ' - ' + lr.mine.os + '</b> ' + _clubName(lr.mine.opp) + ' ' + opD.crest + '</div>' +
        '<button class="lg-logclose" onclick="leagueCloseLog()">✕</button>' +
      '</div>' +
      '<div class="lg-logbody">' + rows + '</div>';
    (document.getElementById('screen-home') || document.body).appendChild(ov);
  }

  /* ── 試合後の"見出し・短評"（表示時に現在LANGで生成） ───────────────── */
  function _headlineText(lr) {
    var my = _clubName(lr.mine.me), op = _clubName(lr.mine.opp), diff = lr.mine.ms - lr.mine.os;
    var pre = lr.mine.rival ? _t('宿敵決戦｜', 'Derby｜') : '';
    var s;
    if (lr.mine.res === 'W') s = diff >= 3 ? _t(op + 'を粉砕！', op + ' crushed!') : (diff === 1 ? _t('競り勝ち', 'Edged it') : _t(op + '撃破', op + ' beaten'));
    else if (lr.mine.res === 'D') s = _t('痛み分け', 'Honours even');
    else s = diff <= -3 ? _t(op + 'に完敗', 'Hammered by ' + op) : (diff === -1 ? _t('惜敗', 'Fell just short') : _t(op + 'に敗戦', 'Beaten by ' + op));
    return pre + my + _t('、', ' — ') + s;
  }
  function _reviewText(lr) {
    var pa = lr.mine.posAfter, pb = lr.mine.posBefore, move = '';
    if (pb && pa) {
      if (pa < pb) move = _t('（' + pb + '位→' + pa + '位に浮上）', ' (up ' + pb + '→' + pa + ')');
      else if (pa > pb) move = _t('（' + pb + '位→' + pa + '位に後退）', ' (down ' + pb + '→' + pa + ')');
      else move = _t('（' + pa + '位キープ）', ' (' + pa + ' held)');
    }
    var base = _t('リーグ' + pa + '位', 'League #' + pa) + move;
    if (lr.mine.rival) { var h = _h2h(lr.mine.me, lr.mine.opp); base += _t('　宿敵通算 ' + h.w + '勝' + h.d + '分' + h.l + '敗', '　vs rival ' + h.w + '-' + h.d + '-' + h.l); }
    return base;
  }
  function _reportRowsHTML(lr) {
    var out = [];
    if (lr.mine.mom) {
      var m = lr.mine.mom;
      var stat = m.goals > 0 ? (m.goals + _t('ゴール', 'G') + (m.assists > 0 ? ' ' + m.assists + _t('アシスト', 'A') : '')) : _t('攻守に奮闘', 'all-round display');
      out.push('🌟 <b>MOM</b> ' + m.name + '（' + stat + '）');
    }
    if (lr.mine.scorers && lr.mine.scorers.length) {
      out.push('⚽ ' + lr.mine.scorers.map(function (s) { return s.name + (s.goals > 1 ? '×' + s.goals : ''); }).join('、'));
    }
    out.push(_reviewText(lr));
    return out.join('<br>');
  }

  /* ── 次回予告（クリフハンガー） ─────────────────────────────────────── */
  function _nextPreview() {
    if (!_state || _state.finished) return null;
    var fx = _myFixtureThisRound(); if (!fx) return null;
    var myId = _state.myClub, oppId = (fx.home === myId) ? fx.away : fx.home;
    var rounds = _state.fixtures.length, rd = _state.round, hook;
    if (_isRival(oppId)) hook = _t('🔥 宿敵' + _clubName(oppId) + 'と再戦', '🔥 Rematch vs rival ' + _clubName(oppId));
    else if (rd === rounds - 1) hook = _t('🏁 最終節・運命の一戦', '🏁 Final round — decisive');
    else {
      var rows = _sortedStandings(), myPts = _state.standings[myId].pts;
      if (rd >= Math.floor(rounds * 0.55) && _position(myId) <= 3 && (rows[0].pts - myPts) <= 3)
        hook = _t('👑 首位攻防', '👑 Title race');
      else hook = _t('第' + (rd + 1) + '節 vs ' + _clubName(oppId), 'Round ' + (rd + 1) + ' vs ' + _clubName(oppId));
    }
    return { oppId: oppId, hook: hook, iAmHome: (fx.home === myId) };
  }
  function _previewHTML() {
    var p = _nextPreview(); if (!p) return '';
    return '<div class="lg-card" style="padding:11px 13px;border-color:rgba(255,255,255,0.18)">' +
      '<div style="font-size:10px;color:rgba(255,255,255,0.5);font-weight:700;letter-spacing:1px">' + _t('▶ 次回予告', '▶ NEXT EPISODE') + '</div>' +
      '<div style="font-size:14px;font-weight:800;margin-top:4px">' + p.hook + '</div>' +
      '<div class="lg-mini" style="margin-top:2px">' + (p.iAmHome ? _t('ホーム', 'Home') : _t('アウェイ', 'Away')) + ' vs ' + _clubDef(p.oppId).crest + ' ' + _clubName(p.oppId) + '</div>' +
      '</div>';
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

    // 試合後レポート素材は結果適用の前に採取（chanceResults=この試合・順位は適用前）
    var report = _collectMyStats();
    var matchLog = _buildMatchLog();
    var posBefore = _position(myId);

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
      mine: {
        me: myId, opp: oppId, ms: myScore, os: oppScore, res: res, home: iAmHome,
        rival: _isRival(oppId), posBefore: posBefore, posAfter: _position(myId),
        mom: report.mom, scorers: report.scorers
      },
      others: others,
      log: matchLog   // 実況テキストログ（試合後に見直す用）
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
      '.lg-mini{font-size:11px;color:rgba(255,255,255,0.7);line-height:1.7}',
      '.lg-logov{position:fixed;inset:0;z-index:200;background:rgba(6,12,24,0.98);display:flex;flex-direction:column;color:#fff}',
      '.lg-loghead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.12);flex-shrink:0}',
      '.lg-logclose{background:rgba(255,255,255,0.14);border:none;color:#fff;width:34px;height:34px;border-radius:9px;font-size:15px;cursor:pointer;flex-shrink:0}',
      '.lg-logbody{flex:1;overflow-y:auto;padding:8px 14px 48px;max-width:520px;margin:0 auto;width:100%;box-sizing:border-box}',
      '.lg-logrow{display:flex;gap:10px;padding:7px 2px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:13px;line-height:1.55}',
      '.lg-logtime{flex-shrink:0;width:44px;color:rgba(255,255,255,0.4);font-size:11px;font-weight:700;text-align:right;padding-top:2px}',
      '.lg-logtxt{flex:1;color:#e8eefc}'
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
      // 見出し＋MOM＋得点者＋順位変動（試合後レポート）
      html += '<div style="text-align:center;font-weight:800;font-size:14px;margin:10px 4px 4px">' + _headlineText(lr) + '</div>' +
        '<div class="lg-mini" style="text-align:center;line-height:1.7">' + _reportRowsHTML(lr) + '</div>';
      if (lr.others && lr.others.length) {
        var ot = lr.others.map(function (o) {
          return _clubName(o.home) + ' <b>' + o.hs + '-' + o.as + '</b> ' + _clubName(o.away);
        }).join('<br>');
        html += '<div class="lg-mini" style="margin-top:8px;text-align:center;border-top:1px solid rgba(255,255,255,0.12);padding-top:8px">' +
          '<div style="font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:3px">' + _t('他会場', 'Other results') + '</div>' + ot + '</div>';
      }
      html += '</div>';
      html += _previewHTML();   // 次回予告
    }

    // 自クラブヘッダー
    var rivalId = _state.rival;
    var rivalLine = rivalId ? '<div class="lg-sub" style="margin-top:3px">' + _t('宿敵', 'Rival') + '：' +
      _clubDef(rivalId).crest + ' <span style="color:#e8776f;font-weight:700">' + _clubName(rivalId) + '</span></div>' : '';
    html += '<div class="lg-card"><div class="lg-club">' +
      '<div class="lg-crest" style="background:' + myDef.color + '33;border:1px solid ' + myDef.color + '">' + myDef.crest + '</div>' +
      '<div style="flex:1"><div class="lg-clubname">' + _clubName(myId) + '</div>' +
      '<div class="lg-sub">' + _t('現在', 'Position') + ' <b style="color:#fff">' + myPos + _t('位', '') + '</b>' +
      '　' + myRow.pts + _t('pt', ' pts') + '　' + myRow.w + _t('勝', 'W') + myRow.d + _t('分', 'D') + myRow.l + _t('敗', 'L') + '</div>' +
      rivalLine + '</div>' +
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
      var oppIsRival = _isRival(oppId);
      var rivalBadge = oppIsRival ? '<span class="lg-badge" style="background:#c0392b">' + _t('宿敵', 'RIVAL') + '</span>' : '';
      html += '<div class="lg-h">' + _t('第' + (_state.round + 1) + '節 / 14', 'Round ' + (_state.round + 1) + ' / 14') +
        '<span class="lg-badge">' + haBadge + '</span>' + rivalBadge + '</div>';
      html += '<div class="lg-hero" style="background:linear-gradient(135deg,' + myDef.color + '33,' + oppDef2.color + '33)' +
        (oppIsRival ? ';border:1px solid #c0392b99' : '') + '">' +
        (oppIsRival ? '<div style="text-align:center;color:#e8776f;font-weight:800;font-size:12px;margin-bottom:4px">🔥 ' + _t('宿敵対決', 'RIVALRY') + '　' + (function () { var h = _h2h(myId, oppId); return _t('通算 ' + h.w + '勝' + h.d + '分' + h.l + '敗', h.w + '-' + h.d + '-' + h.l); })() + '</div>' : '') +
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

    // 前回試合の実況テキストログ
    if (_state.lastResult && _state.lastResult.log && _state.lastResult.log.length) {
      html += '<button class="lg-btn sec" onclick="leagueShowLog()">📜 ' + _t('前回の試合ログ（実況）を見る', 'View match commentary log') + '</button>';
    }

    // ミニ順位表
    html += '<div class="lg-h">' + _t('順位表', 'Standings') + '</div>';
    html += _standingsTableHTML(rows, myId);

    // テスト用（lab限定）：1日1回制限のON/OFFトグル
    if (_testMode()) {
      var tOn = !!(_state && _state.testUnlock);
      var tl = tOn ? _t('🔓 テスト：1日1回制限 OFF（毎回プレイ可）', '🔓 TEST: daily limit OFF (replay anytime)')
                   : _t('🔒 テスト：1日1回制限 ON（タップで解除）', '🔒 TEST: daily limit ON (tap to disable)');
      html += '<button class="lg-btn sec" style="border:1px dashed rgba(255,255,255,0.35);font-size:12px;' +
        (tOn ? 'color:#ffd479' : '') + '" onclick="leagueToggleTestLock()">' + tl + '</button>';
    }

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
  // テスト用（lab限定）：1日1回制限のON/OFFトグル（毎回プレイ可にする）
  window.leagueToggleTestLock = function () { if (_state) { _state.testUnlock = !_state.testUnlock; _save(); _renderHub(false); } };
  // 実況テキストログの表示/閉じる
  window.leagueShowLog = function () { _showMatchLog(); };
  window.leagueCloseLog = function () { var ov = document.getElementById('lg-log-ov'); if (ov) ov.parentNode.removeChild(ov); };
})();
