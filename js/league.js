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

  /* ===========================================================================
   * SN-01 / MG-02 — 統合セーブスキーマ v4（設計書 MANAGER_SEASON_DESIGN.md §2）
   * ---------------------------------------------------------------------------
   * ★ セーブ改定は 1 回だけ（v3→v4）。年齢/選手成長/信頼度/怪我・出場停止の持ち越し/
   *   シーズン引き継ぎ/アーカイブ/監督キャリアを「全部入り」でスキーマ化する。
   *   以後の継ぎ足し改定は β ユーザーのセーブを壊すため禁止。
   * ★ 追加フィールドは全て任意＝欠落時はデフォルト補完（既存 v2/v3 セーブを壊さない）。
   * ★ rng を新規消費しない（決定論のみ）＝ seed 完全再現（T-06）を壊さない。
   * ========================================================================= */
  var SAVE_VERSION = 4;

  // 戦術 index → 保存用 id（players.js: TACTICS_POSSESSION=0 … TACTICS_FREE=4）
  var TACTIC_IDS = ['POSSESSION', 'PRESS', 'COUNTER', 'CATENACCIO', 'FREE'];

  var MANAGER_TUNING = {
    START: 20,          // 全 param の初期値（新米監督・難易度は作らないので個体差なし）
    CAP: 100,
    TRUST_START: 50     // クラブからの信頼度の初期値（SN-02 で運用）
  };

  var SEASON_TUNING = {
    // 怪我の欠場節数（discipline.js の severity マーカーを読む・§6.4）
    INJURY_OUT: { minor: 1, severe: 3 },
    SUSPEND_RED: 1,        // レッド＝次節出場停止
    YELLOW_ACCUM: 3,       // イエロー累積の閾値
    SUSPEND_ACCUM: 1,      // 累積到達時の出場停止節数
    MIN_AVAILABLE: 11      // 詰み防止＝先発 11 人を確保できなければ欠場を強制解除（§3.3）
  };

  // 選手識別キー（PT/PS と同じ決定論キー＝long_name 優先）
  function _playerKey(p) { return (p && (p.long_name || p.name)) || ''; }

  function _defaultManager(clubId, season) {
    var S = MANAGER_TUNING.START;
    return {
      name: null,
      age: null,                 // 年齢概念（案D）は SN-08 で使用。null=年齢なし運用でも動く
      params: { tactical: S, analysis: S, motivator: S, conditioning: S, popularity: S },
      learnedTactics: ['POSSESSION', 'CATENACCIO'],   // MG-04: 初期2種（解放は戦術勉強で）
      tacticProgress: { PRESS: 0, COUNTER: 0 },        // 習得ゲージ 0-100
      coaches: { analysis: 1, physical: 0, mental: 0, scout: 0 },  // 0=未雇用
      clubTrust: MANAGER_TUNING.TRUST_START,
      seasonGoal: null,          // SN-02 が開幕時に設定（{type:'table_pos',target:n}）
      tenure: { clubId: clubId || null, sinceSeason: season || 1 }
    };
  }

  function _defaultSeasonMeta() { return { actionsLog: [], pendingAction: null }; }

  // 選手の持ち越しデータ（クラブ×選手の delta オーバーレイ）。
  // ★ lazy 生成: 初回アクセス時にだけ作る＝800選手を展開せず localStorage 肥大化を避ける。
  function _defaultSquadEntry() {
    return {
      age: null,       // SN-08（年齢モデル）で使用。null=未設定
      growth: {},      // param idx → 累積 delta（疎・0 は持たない）
      trust: MANAGER_TUNING.TRUST_START,  // 監督との信頼度（MG-12）
      injuryOut: 0,    // 怪我による欠場残り節数
      suspendOut: 0,   // 出場停止の残り節数
      yellowAccum: 0,  // イエロー累積（SEASON_TUNING.YELLOW_ACCUM で停止）
      apps: 0, goals: 0, assists: 0   // シーズン統計（RW-02・成長入力）
    };
  }

  // squads[clubId][playerKey] を lazy 生成して返す（読み書き共通の唯一の入口）。
  function _squadEntry(clubId, playerKey) {
    if (!_state) return _defaultSquadEntry();
    if (!_state.squads) _state.squads = {};
    if (!_state.squads[clubId]) _state.squads[clubId] = {};
    var c = _state.squads[clubId];
    if (!c[playerKey]) c[playerKey] = _defaultSquadEntry();
    return c[playerKey];
  }

  // 既存エントリを「生成せずに」覗く（overlay の高速パス＝疎なままにしておく）。
  function _peekSquadEntry(clubId, playerKey) {
    var c = _state && _state.squads && _state.squads[clubId];
    return (c && c[playerKey]) || null;
  }

  /* ── オーバーレイ適用済みクラブデータ（§2.2） ─────────────────────────
   * ★ TEAM_DATA 本体は不変（single/WC モードと共有の不変ソース）。clone に対して
   *   ① growth を base param へ焼き込み（persistent な成長）
   *   ② injuryOut/suspendOut>0 の選手を先発から除外（詰み防止つき）
   * を適用して返す。1試合あたり数クラブ分の clone なのでコストは無視できる。 */
  function _overlaySquad(clubId) {
    var src = _clubData(clubId);
    if (!src) return src;
    var td = {};
    for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) td[k] = src[k];
    td._srcKey = clubId;   // clone でも TEAM_DATA キーを辿れるようにする（manager-match.js の選手詳細用）

    var unavailable = {};   // players index → true
    td.players = src.players.map(function (p, idx) {
      var np = {};
      for (var k2 in p) if (Object.prototype.hasOwnProperty.call(p, k2)) np[k2] = p[k2];
      np.params = p.params.slice();
      var ov = _peekSquadEntry(clubId, _playerKey(p));
      if (ov) {
        if (ov.growth) {
          for (var gi in ov.growth) {
            var i = parseInt(gi, 10);
            if (isNaN(i) || i < 0 || i >= np.params.length) continue;
            np.params[i] = Math.max(1, Math.min(99, np.params[i] + ov.growth[gi]));
          }
        }
        if ((ov.injuryOut > 0) || (ov.suspendOut > 0)) unavailable[idx] = true;
      }
      return np;
    });

    td.default_lineup = _availableLineup(src, td, unavailable, clubId);
    return td;
  }

  /* 欠場者を除いた lineup を組む。先発 11 人の穴は「ベンチ→未登録選手」の順で埋める。
   * 詰み防止（§3.3）: それでも 11 人に満たないなら欠場残り節数を 0 に clamp して解除する。 */
  function _availableLineup(src, td, unavailable, clubId) {
    var base = (src.default_lineup || []).slice();
    var total = td.players.length;
    var used = {}, out = [];

    function _push(i) { if (i == null || used[i]) return false; used[i] = true; out.push(i); return true; }

    // ① 既存 lineup の順序を尊重して、出場可能な選手だけ拾う
    for (var b = 0; b < base.length; b++) if (!unavailable[base[b]]) _push(base[b]);
    // ② 11 人に足りなければ、未登録の出場可能な選手で補充（GK 以外の並びは engine が解決）
    for (var i2 = 0; i2 < total && out.length < 11; i2++) if (!unavailable[i2]) _push(i2);

    // ③ 詰み防止: 出場可能者が 11 人未満 → 欠場を軽い順に強制解除して復帰させる
    if (out.length < SEASON_TUNING.MIN_AVAILABLE) {
      var outs = [];
      for (var i3 = 0; i3 < total; i3++) {
        if (!unavailable[i3]) continue;
        var e = _peekSquadEntry(clubId, _playerKey(td.players[i3]));
        outs.push({ idx: i3, rest: e ? ((e.injuryOut || 0) + (e.suspendOut || 0)) : 0, entry: e });
      }
      outs.sort(function (a, b2) { return a.rest - b2.rest; });   // 残りが短い＝軽い順に復帰
      for (var o = 0; o < outs.length && out.length < SEASON_TUNING.MIN_AVAILABLE; o++) {
        if (outs[o].entry) { outs[o].entry.injuryOut = 0; outs[o].entry.suspendOut = 0; }
        _push(outs[o].idx);
      }
    }

    // ④ ベンチ（12人目以降）＝元 lineup の残りを順序どおりに積む（欠場者は入れない）。
    //    ベンチ枠の大きさは元データと同じ（=base.length）に保つ＝交代枠の挙動を変えない。
    var size = Math.max(base.length, 11);
    for (var i4 = 0; i4 < base.length && out.length < size; i4++) if (!unavailable[base[i4]]) _push(base[i4]);
    for (var i5 = 0; i5 < total && out.length < size; i5++) if (!unavailable[i5]) _push(i5);
    return out;
  }

  /* ── シーズン跨ぎの持ち越し（§2・SN-07 の土台） ───────────────────────
   * 引き継ぐ = age / growth（成長は persistent）/ trust（監督との信頼）。
   * リセット = 当季の記録（apps/goals/assists）と欠場カウンタ（injuryOut/suspendOut/yellowAccum）。
   * 何も持たないエントリは捨てて localStorage を疎に保つ（history 50件上限と同じ配慮）。 */
  function _carrySquads(prev) {
    var out = {};
    if (!prev) return out;
    for (var clubId in prev) {
      if (!Object.prototype.hasOwnProperty.call(prev, clubId)) continue;
      var src = prev[clubId], dst = {};
      for (var pk in src) {
        if (!Object.prototype.hasOwnProperty.call(src, pk)) continue;
        var e = src[pk] || {};
        var growth = {}, hasGrowth = false;
        if (e.growth) for (var gi in e.growth) {
          if (!Object.prototype.hasOwnProperty.call(e.growth, gi)) continue;
          if (e.growth[gi]) { growth[gi] = e.growth[gi]; hasGrowth = true; }
        }
        var trust = (typeof e.trust === 'number') ? e.trust : MANAGER_TUNING.TRUST_START;
        var age = (typeof e.age === 'number') ? e.age : null;
        // 引き継ぐ中身が何もない（成長なし・信頼が既定・年齢なし）なら保存しない
        if (!hasGrowth && age === null && trust === MANAGER_TUNING.TRUST_START) continue;
        var ne = _defaultSquadEntry();
        ne.growth = growth; ne.trust = trust; ne.age = age;
        dst[pk] = ne;
      }
      if (Object.keys(dst).length) out[clubId] = dst;
    }
    return out;
  }

  /* ── 節が明けるたびに欠場カウンタを 1 減らす（§6.4） ─────────────────
   * ★ 順序が意味を持つ: 「先に減らす → その試合で出た怪我/退場を書く」。
   *   こうすると今節で負傷した選手は必ず次節を欠場し、前節から引きずっていた選手は復帰する。 */
  function _tickCarryover() {
    if (!_state || !_state.squads) return;
    for (var clubId in _state.squads) {
      if (!Object.prototype.hasOwnProperty.call(_state.squads, clubId)) continue;
      var c = _state.squads[clubId];
      for (var pk in c) {
        if (!Object.prototype.hasOwnProperty.call(c, pk)) continue;
        var e = c[pk];
        if (e.injuryOut > 0) e.injuryOut--;
        if (e.suspendOut > 0) e.suspendOut--;
      }
    }
  }

  /* ── 試合終了時に discipline.js のマーカーを読んで持ち越しへ書く（§6.4） ──
   * team = 試合で使われたチームオブジェクト（_overlaySquad 由来の clone）。
   *   apps  … 出場した選手（終了時の先発11 ＋ 交代で退いた選手 ＋ カード/怪我で退場した選手）
   *   goals/assists … 呼び出し側が名前キーの集計を渡した時だけ記録（＝自クラブのみ・RW-02）
   *   injuryOut/suspendOut/yellowAccum … _injured/_injurySeverity/_sentOff/_yellowCards から算出
   * ★ rng を新規消費しない（既に確定した試合結果を読むだけ）。 */
  function _recordTeamCarryover(clubId, team, statsByName, useSubbedOff) {
    if (!_state || !clubId || !team || !team.players) return;
    var players = team.players;
    var appeared = {};
    var lu = team.lineup || [];
    for (var i = 0; i < lu.length && i < 11; i++) if (lu[i] != null) appeared[lu[i]] = true;
    // 交代で退いた選手（simulate.js の共有 Set）。★ これは対話モードの team1 専用なので、
    //   相手チームや AIvsAI に流用すると別チームの index を誤って出場扱いにする。
    if (useSubbedOff && typeof _subbedOff !== 'undefined' && _subbedOff && typeof _subbedOff.forEach === 'function') {
      _subbedOff.forEach(function (idx) { appeared[idx] = true; });
    }

    for (var idx = 0; idx < players.length; idx++) {
      var p = players[idx];
      if (!p) continue;
      var touched = !!appeared[idx] || !!p._injured || !!p._sentOff || (p._yellowCards > 0);
      if (!touched) continue;
      var e = _squadEntry(clubId, _playerKey(p));
      if (appeared[idx] || p._injured || p._sentOff) e.apps++;

      if (statsByName) {
        var st = statsByName[p.name];
        if (st) { e.goals += (st.goals || 0); e.assists += (st.assists || 0); }
      }

      // 怪我 → 重症度に応じた欠場節数（すでに欠場中なら長い方を採用）
      if (p._injured) {
        var n = SEASON_TUNING.INJURY_OUT[p._injurySeverity] || SEASON_TUNING.INJURY_OUT.minor;
        if (n > e.injuryOut) e.injuryOut = n;
      }
      // 退場（レッド/2枚目イエロー）→ 次節出場停止。累積カウンタはリセット。
      if (p._sentOff) {
        if (SEASON_TUNING.SUSPEND_RED > e.suspendOut) e.suspendOut = SEASON_TUNING.SUSPEND_RED;
        e.yellowAccum = 0;
      } else if (p._yellowCards > 0) {
        e.yellowAccum += p._yellowCards;
        if (e.yellowAccum >= SEASON_TUNING.YELLOW_ACCUM) {
          e.yellowAccum -= SEASON_TUNING.YELLOW_ACCUM;
          if (SEASON_TUNING.SUSPEND_ACCUM > e.suspendOut) e.suspendOut = SEASON_TUNING.SUSPEND_ACCUM;
        }
      }
    }
  }

  function _newSeason(myClubId) {
    var ids = CLUB_DEFS.map(function (d) { return d.id; });
    var standings = {};
    ids.forEach(function (id) { standings[id] = _emptyStanding(); });
    _state = {
      version: SAVE_VERSION,   // v4: 監督/シーズンメタ/選手持ち越しを統合。v3=周回+history・v2=実チーム8・v1=架空クラブ
      season: 1,
      history: [],
      myClub: myClubId,
      rival: _computeRival(myClubId),   // 宿敵＝実力が最も近いクラブ（因縁の相手）
      clubs: ids,
      fixtures: _makeFixtures(ids),
      standings: standings,
      round: 0,
      lastPlayedDate: null,
      lastResult: null,   // { round, mine:{me,opp,ms,os,res,rival,posBefore,posAfter,mom,scorers}, others:[...] }
      finished: false,
      manager: _defaultManager(myClubId, 1),   // MG-02
      seasonMeta: _defaultSeasonMeta(),        // 行動フェーズ（MG-03）
      squads: {}                               // 選手持ち越し（lazy 生成・SN-01）
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
      if (!s || !s.fixtures || !(s.version >= 2 && s.version <= SAVE_VERSION)) { _state = null; return; }   // 旧版(v1架空クラブ)/未来版は破棄
      var _prevVersion = s.version;
      var _hadV4 = !!(s.manager && s.seasonMeta && s.squads);
      _state = s;   // ※ 以降 s と _state は同一オブジェクト。移行判定は上の控えを使う
      if (!_state.rival) { _state.rival = _computeRival(_state.myClub); }  // 旧セーブへ宿敵を補完
      // v2→v3 移行: シーズン周回＆過去シーズンのアーカイブ枠を追加（既存の進行は保持）。
      if (_state.version === 2) {
        _state.version = 3;
        if (typeof _state.season !== 'number') _state.season = 1;
        if (!Array.isArray(_state.history)) _state.history = [];
      }
      // v3→v4 移行（SN-01/MG-02）: 監督・シーズンメタ・選手持ち越しの枠を補完するだけ。
      //   進行中のリーグはそのまま継続する（欠落フィールドの補完のみ・破壊的変更なし）。
      if (_state.version < SAVE_VERSION) {
        _state.version = SAVE_VERSION;
      }
      if (typeof _state.season !== 'number') _state.season = 1;
      if (!Array.isArray(_state.history)) _state.history = [];
      // ↓ v4 フィールドは版数に関係なく毎回「欠落なら補完」（部分的に壊れたセーブにも耐える）
      if (!_state.manager) _state.manager = _defaultManager(_state.myClub, _state.season);
      if (!_state.seasonMeta) _state.seasonMeta = _defaultSeasonMeta();
      if (!_state.squads) _state.squads = {};   // 空 = 全選手 base のまま（delta なし）
      if (_prevVersion !== _state.version || !_hadV4) _save();   // 移行が起きた時だけ一度保存
    } catch (e) { _state = null; }
  }

  // 完了したシーズンの要約（バックナンバー用・順位表スナップショット＋自クラブ成績＋宿敵通算）。
  function _seasonSummary() {
    var rows = _sortedStandings();
    var champ = rows[0];
    var myId = _state.myClub;
    var myRow = _state.standings[myId] || _emptyStanding();
    return {
      season: _state.season || 1,
      myClub: myId,
      champion: champ ? champ.id : null,
      myPos: _position(myId),
      myRecord: { w: myRow.w, d: myRow.d, l: myRow.l, gf: myRow.gf, ga: myRow.ga, pts: myRow.pts },
      rival: _state.rival || null,
      rivalH2H: _state.rival ? _h2h(myId, _state.rival) : null,
      standings: rows.map(function (r) { return { id: r.id, pts: r.pts, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga }; })
    };
  }

  // 今シーズンをアーカイブして、同じクラブで次シーズンを開始（記録は消さず引き継ぐ）。
  function _startNextSeason() {
    if (!_state) return;
    var hist = Array.isArray(_state.history) ? _state.history.slice() : [];
    hist.push(_seasonSummary());
    if (hist.length > 50) hist = hist.slice(hist.length - 50);   // 上限（localStorage肥大化防止）
    var my = _state.myClub;
    var nextSeason = (_state.season || 1) + 1;
    var ids = CLUB_DEFS.map(function (d) { return d.id; });
    var standings = {};
    ids.forEach(function (id) { standings[id] = _emptyStanding(); });
    // ★ v4: 監督（成長・信頼・キャリア）と選手の持ち越し（growth/年齢/信頼）はシーズンを跨いで引き継ぐ。
    //   季ごとにリセットするのは「当季の記録」= apps/goals/assists と欠場カウンタ・行動ログのみ。
    var manager = _state.manager || _defaultManager(my, nextSeason);
    var squads = _carrySquads(_state.squads);
    _state = {
      version: SAVE_VERSION,
      season: nextSeason,
      history: hist,
      myClub: my,
      rival: _computeRival(my),
      clubs: ids,
      fixtures: _makeFixtures(ids),
      standings: standings,
      round: 0,
      lastPlayedDate: null,
      lastResult: null,
      finished: false,
      manager: manager,
      seasonMeta: _defaultSeasonMeta(),
      squads: squads
    };
    _save();
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
    var empty = { scorers: [], mom: null, stats: {} };   // stats = 選手名→{goals,assists,duelWins}（v4 持ち越し用）
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
    return { scorers: scorers, mom: mom, stats: stats };
  }

  /* ── 実況テキストログ（試合後に見直す） ─────────────────────────────
   * 各チャンス res.textScenes（simulateChance が生成済み）を時刻付きで連結。 */
  function _buildMatchLog() {
    var out = [];
    if (typeof chanceResults === 'undefined' || !chanceResults) return out;
    var subs = (typeof window !== 'undefined' && window._mvMatchSubs) ? window._mvMatchSubs.slice() : [];
    chanceResults.forEach(function (res, i) {
      if (res && res.textScenes) res.textScenes.forEach(function (tx) {
        if (tx && String(tx).replace(/<[^>]*>/g, '').trim()) out.push({ t: res.time || '', x: tx });
      });
      // このチャンス消化直後(=currentChanceIdx が i+1 の時点)に起きた交代を差し込む
      subs.filter(function (s) { return s.chanceIdx === i + 1; }).forEach(function (s) { out.push({ t: s.time || (res && res.time) || '', x: s.text, sub: true }); });
    });
    // 全チャンス後(終盤)の交代を末尾に
    subs.filter(function (s) { return s.chanceIdx > chanceResults.length; }).forEach(function (s) { out.push({ t: s.time, x: s.text, sub: true }); });
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
      rows += '<div class="lg-logrow' + (l.sub ? ' sub' : '') + '"><span class="lg-logtime">' + tcell + '</span><span class="lg-logtxt">' + l.x + '</span></div>';
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

  // 過去のシーズン（バックナンバー）オーバーレイ。新しい順に、優勝・自クラブ順位/成績・宿敵通算を表示。
  function _showHistory() {
    if (!_state || !_state.history || !_state.history.length) return;
    _ensureStyle();
    var old = document.getElementById('lg-hist-ov'); if (old) old.parentNode.removeChild(old);
    var body = '';
    for (var i = _state.history.length - 1; i >= 0; i--) {
      var h = _state.history[i];
      var champDef = h.champion ? _clubDef(h.champion) : null;
      var mine = h.myClub === h.champion;
      var mr = h.myRecord || { w: 0, d: 0, l: 0, pts: 0 };
      var rivalTxt = (h.rival && h.rivalH2H)
        ? _t('宿敵' + _clubName(h.rival) + '戦 ', 'vs rival ' + _clubName(h.rival) + ' ') +
          h.rivalH2H.w + _t('勝', 'W') + h.rivalH2H.d + _t('分', 'D') + h.rivalH2H.l + _t('敗', 'L')
        : '';
      body +=
        '<div class="lg-logrow" style="flex-direction:column;align-items:stretch;gap:4px;padding:10px 4px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center">' +
            '<b style="font-size:13px">' + _t('シーズン' + h.season, 'Season ' + h.season) + '</b>' +
            '<span style="font-size:12px">🏆 ' + (champDef ? champDef.crest + ' ' + _clubName(h.champion) : '—') +
              (mine ? ' <span style="color:#2ecc71;font-weight:800">' + _t('優勝', 'Champions') + '</span>' : '') + '</span>' +
          '</div>' +
          '<div class="lg-mini" style="text-align:left">' +
            _t('自クラブ ', 'Your club ') + '<b style="color:#fff">' + h.myPos + _t('位', '') + '</b>' +
            '　' + mr.pts + _t('pt', 'pts') + '　' + mr.w + _t('勝', 'W') + mr.d + _t('分', 'D') + mr.l + _t('敗', 'L') +
            (rivalTxt ? '　🔥' + rivalTxt : '') +
          '</div>' +
        '</div>';
    }
    var ov = document.createElement('div');
    ov.id = 'lg-hist-ov'; ov.className = 'lg-logov';
    ov.innerHTML =
      '<div class="lg-loghead">' +
        '<div style="font-weight:800;font-size:14px">📚 ' + _t('過去のシーズン', 'Past seasons') + '</div>' +
        '<button class="lg-logclose" onclick="leagueCloseHistory()">✕</button>' +
      '</div>' +
      '<div class="lg-logbody">' + body + '</div>';
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
    // ★ v4: TEAM_DATA そのものではなく「持ち越しオーバーレイ適用済み clone」を渡す（§2.2）。
    //   成長 delta を base param へ焼き込み、怪我/出場停止の選手を先発から外す（詰み防止つき）。
    //   TEAM_DATA 本体は single/WC と共有の不変ソースなので絶対に書き換えない。
    team1Data = _overlaySquad(myId);
    team2Data = _overlaySquad(oppId);

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

    // ── v4 持ち越し（§6.4）: 先に前節分のカウンタを減らし、その後に今節の怪我/退場を書く
    _tickCarryover();
    _recordTeamCarryover(myId, gameState && gameState.team1, report.stats, true);
    _recordTeamCarryover(oppId, gameState && gameState.team2, null);

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
        var r = playMatch(_overlaySquad(m.home), _overlaySquad(m.away));
        res = r.result;
        // AI 同士の試合も怪我/出場停止を持ち越す（得点者内訳は自クラブのみ記録＝RW-02）
        _recordTeamCarryover(m.home, r.home, null);
        _recordTeamCarryover(m.away, r.away, null);
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
      '.lg-pick .pc{position:relative;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:10px 12px 12px;cursor:pointer;text-align:center;transition:transform .1s}',
      '.lg-pick .pc:active{transform:scale(0.97)}',
      '.lg-pick .pc .pc-face{display:block;width:100%;max-width:116px;margin:2px auto 0;aspect-ratio:6/7;border-radius:10px;background:radial-gradient(120% 90% at 50% 15%,rgba(255,255,255,0.16),rgba(0,0,0,0.22))}',
      '.lg-pick .pc .cr{position:absolute;top:7px;right:9px;font-size:19px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.55))}',
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
      '.lg-logtxt{flex:1;color:#e8eefc}',
      '.lg-logrow.sub{background:rgba(46,204,113,0.10);border-left:3px solid #2ecc71;border-radius:4px;padding-left:8px}',
      '.lg-logrow.sub .lg-logtxt{color:#8ef0b0;font-weight:700}'
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
        '<canvas class="pc-face" width="232" height="270" data-club="' + d.id + '"></canvas>' +
        '<div class="cr" style="filter:drop-shadow(0 0 6px ' + d.color + ')">' + d.crest + '</div>' +
        '<div class="pn">' + (_isEn() ? d.en : d.ja) + '</div>' +
        '<div class="pr" style="color:' + d.color + '">' + stars + '</div>' +
        '<div class="pr">' + _t('総合', 'OVR') + ' ' + str + '</div>' +
        '</div>';
    }).join('');
    _body().innerHTML =
      '<div class="lg-wrap lg-pick-wrap">' +
        '<div class="lg-card lg-pick-intro" style="text-align:center">' +
          '<div style="font-size:20px;font-weight:800">' + _t('デイリーリーグ', 'Daily League') + '</div>' +
          '<div class="lg-sub" style="margin-top:6px;font-size:12px">' +
            _t('8クラブ・ホーム&アウェイ14節。1日1試合、監督として1シーズンを戦う。',
               '8 clubs, home & away, 14 rounds. One match a day — manage a full season.') +
          '</div>' +
        '</div>' +
        '<div class="lg-h">' + _t('▼ 指揮するクラブを選ぶ', '▼ Pick your club') + '</div>' +
        '<div class="lg-pick">' + cards + '</div>' +
      '</div>';
    _paintPickPortraits(defs);
  }

  // PT-05: 各クラブ選択カードにキープレイヤーの大ポートレートを描く（lab限定・portrait.js）。
  // portrait.js は LAB_ONLY のため typeof ガード（万一の非搭載でも no-op で崩さない）。
  function _paintPickPortraits(defs) {
    if (typeof Portrait === 'undefined') return;
    Portrait.preload().then(function () {
      defs.forEach(function (d) {
        var cv = _body() && _body().querySelector('canvas.pc-face[data-club="' + d.id + '"]');
        if (!cv) return;
        var td = _clubData(d.id);
        var kp = td && td.players && (td.players[td.default_keyplayer] || td.players[0]);
        if (!kp) return;
        Portrait.render(cv, kp.long_name || kp.name, { team: d.color });
      });
    });
  }

  function _resultColor(res) { return res === 'W' ? '#2ecc71' : res === 'L' ? '#e74c3c' : '#f1c40f'; }

  function _renderHub(showBanner) {
    _ensureStyle();
    var myId = _state.myClub;
    var myDef = _clubDef(myId);
    var rows = _sortedStandings();
    var myPos = rows.findIndex(function (r) { return r.id === myId; }) + 1;
    var myRow = rows[myPos - 1];

    // 横長では左(自クラブ/本日の試合)＋右(順位表)の2カラム。縦(portrait)では
    // .lg-col が素の block になり従来どおり1カラムで積み上がる（フォールバック維持）。
    var html = '<div class="lg-wrap"><div class="lg-cols"><div class="lg-col lg-col-main">';

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
      '<div style="flex:1"><div class="lg-clubname">' + _clubName(myId) +
      ' <span class="lg-badge" style="background:rgba(255,255,255,.14);font-weight:700">' + _t('シーズン' + (_state.season || 1), 'Season ' + (_state.season || 1)) + '</span></div>' +
      '<div class="lg-sub">' + _t('現在', 'Position') + ' <b style="color:#fff">' + myPos + _t('位', '') + '</b>' +
      '　' + myRow.pts + _t('pt', ' pts') + '　' + myRow.w + _t('勝', 'W') + myRow.d + _t('分', 'D') + myRow.l + _t('敗', 'L') + '</div>' +
      rivalLine + '</div>' +
      '</div></div>';

    // 本日の試合 or シーズン終了（横長では左カラムの中央でVSが構図の重心になるよう
    // .lg-match-block を flex:1 で伸ばして上下中央寄せ＝下端のデッドスペースを解消）
    html += '<div class="lg-match-block">';
    if (_state.finished) {
      var champ = rows[0];
      var champDef = _clubDef(champ.id);
      var won = champ.id === myId;
      html += '<div class="lg-hero" style="background:linear-gradient(135deg,#d4a01755,rgba(0,0,0,0.3));border:1px solid #d4a017;text-align:center">' +
        '<div style="font-size:34px">🏆</div>' +
        '<div style="font-size:16px;font-weight:800;margin-top:4px">' + _t('シーズン' + (_state.season || 1) + ' 終了', 'Season ' + (_state.season || 1) + ' Complete') + '</div>' +
        '<div style="margin-top:6px;font-size:14px">' + _t('優勝', 'Champions') + '：' + champDef.crest + ' <b>' + _clubName(champ.id) + '</b></div>' +
        (won ? '<div style="color:#2ecc71;font-weight:800;margin-top:6px">' + _t('あなたのクラブが頂点に！', 'Your club took the title!') + '</div>' : '') +
        '</div>' +
        '<button class="lg-btn" onclick="leagueConfirmNewSeason()">' + _t('次のシーズンへ（今季を記録に残す）', 'Next season (this one is saved)') + '</button>';
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
    html += '</div>';   // /lg-match-block

    // 前回試合の実況テキストログ
    if (_state.lastResult && _state.lastResult.log && _state.lastResult.log.length) {
      html += '<button class="lg-btn sec" onclick="leagueShowLog()">📜 ' + _t('前回の試合ログ（実況）を見る', 'View match commentary log') + '</button>';
    }
    // 過去のシーズン（バックナンバー）— 1シーズンでも終えていれば表示。
    if (_state.history && _state.history.length) {
      html += '<button class="lg-btn sec" onclick="leagueShowHistory()">📚 ' + _t('過去のシーズン（' + _state.history.length + '）', 'Past seasons (' + _state.history.length + ')') + '</button>';
    }

    // ── ここまでが左カラム。順位表以降は右カラム（横長時）───────────────
    html += '</div><div class="lg-col lg-col-side">';

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
    html += '</div></div></div>';   // /lg-col-side /lg-cols /lg-wrap
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
    // 横長(landscape)レイアウト & PCの横長スマホ枠を league だけに限定するスコープ用フラグ。
    // （W杯/公開の縦画面へは波及させない — style.css 側の全ルールが body.league-mode 配下）
    if (document.body) document.body.classList.add('league-mode');
    _load();
    if (typeof showScreen === 'function') showScreen('home');
    if (!_state) _renderPick();
    else _renderHub(false);
  }

  window.showLeague = showLeague;
  window.leaguePickClub = function (id) { _newSeason(id); _renderHub(false); };
  window.leaguePlayToday = function () { playToday(); };
  window.leagueShowHub = function () { _renderHub(false); };
  window.leagueBackToTitle = function () {
    if (document.body) document.body.classList.remove('league-mode');
    if (typeof showScreen === 'function') showScreen('title');
  };
  window.leagueConfirmNewSeason = function () {
    // 今シーズンを「過去のシーズン」に記録として残し、同じクラブで次シーズンへ（連載＝記録は消さない）。
    if (confirm(_t('今シーズンを記録に残して、次のシーズンを始めますか？', 'Archive this season and start the next one?'))) {
      _startNextSeason();
      _renderHub(false);
    }
  };
  // 過去のシーズン（バックナンバー）を表示。
  window.leagueShowHistory = function () { _showHistory(); };
  window.leagueCloseHistory = function () { var ov = document.getElementById('lg-hist-ov'); if (ov) ov.parentNode.removeChild(ov); };
  // デバッグ: ?debug=1 時、当日ロックを解除して連続プレイ可
  window.leagueDebugUnlock = function () { if (_state) { _state.lastPlayedDate = null; _save(); _renderHub(false); } };
  // テスト用（lab限定）：1日1回制限のON/OFFトグル（毎回プレイ可にする）
  window.leagueToggleTestLock = function () { if (_state) { _state.testUnlock = !_state.testUnlock; _save(); _renderHub(false); } };
  /* 検証用 seam（lab限定・UI からは使わない）。
   * v4 スキーマ層（移行/オーバーレイ/持ち越し）を headless で機械検証するための入口。
   * → tools/league-save-v4-test.js。挙動には一切影響しない（読み書きは既存関数のみ）。 */
  window._leagueTestAPI = {
    load: _load, save: _save,
    getState: function () { return _state; },
    setState: function (s) { _state = s; },
    newSeason: _newSeason,
    startNextSeason: _startNextSeason,
    overlaySquad: _overlaySquad,
    squadEntry: _squadEntry,
    tickCarryover: _tickCarryover,
    recordTeamCarryover: _recordTeamCarryover,
    carrySquads: _carrySquads,
    SAVE_VERSION: SAVE_VERSION,
    SEASON_TUNING: SEASON_TUNING,
    MANAGER_TUNING: MANAGER_TUNING
  };
  // 実況テキストログの表示/閉じる
  window.leagueShowLog = function () { _showMatchLog(); };
  window.leagueCloseLog = function () { var ov = document.getElementById('lg-log-ov'); if (ov) ov.parentNode.removeChild(ov); };
})();
