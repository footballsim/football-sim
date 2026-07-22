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

  /* ── 参加クラブ ＝ シミュレータ既存チームの「チーム力上位8」
   * ⚠️ **これは仮のチーム**（2026-07-22 ユーザー補足）。本番は**オリジナルクラブ**に差し替わる（FN-01）。
   *   ★ 差し替えは原則 **この配列と TEAM_DATA 側のエントリを入れ替えるだけ**で済むように作ってある:
   *     クラブ名/色/エンブレムは CLUB_DEFS 経由、宿敵(_computeRival)・戦力順位(_strengthRank)・
   *     シーズン目標(SN-02)・相手の得意な攻め筋(_opponentThreats) は**すべてデータから算出**しており、
   *     実チーム名を参照しているコードは他に無い（この配列が唯一の実クラブ依存点）。
   *   ⚠️ ただし squads の保存キー（_playerKey＝選手名）は差し替えで迷子になる。下の注記を参照。
   *   ⚠️ バランス調整（MG-13/MG-14/SN-02 の係数）は**このチーム群の戦力差が狭い**ことに注意
   *     （代表チーム 8 つで 72.4〜76.2 に密集）。オリジナルクラブは戦力差が広がる可能性が高く、
   *     「弱小でも目標を楽に達成できる」等の判断はクラブ確定後に取り直す（BACKLOG MG-14/SN-10）。
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
    TRUST_START: 50,    // クラブからの信頼度の初期値（SN-02 で運用）
    // 成長の base（設計書 §1.2）。実際の増分は gain = base × (1 - param/CAP) ＝ 上限付き逓減。
    GROWTH: {
      MATCH_ALL: 0.4,   // 試合を1つ指揮（結果不問）＝全 param 微増
      WIN: 1.0,         // 勝利 → tactical / motivator
      VIDEO: 1.5,       // ビデオ学習 → tactical
      TACTIC: 1.0,      // 戦術勉強 → tactical（＋習得ゲージ）
      RECOVERY: 1.2,    // 回復日 → conditioning（設計 §1.2 の「休養」）
      TRAINING: 0.8     // 個人練習 → analysis（選手を見る目）
    },
    // ★ MATCH_ALL（指揮しただけの微増）を効かせる param。
    //   popularity は入れない＝人気は「結果で上下する双方向 param」で、試合をこなすだけでは上がらない（MG-05）。
    MATCH_ALL_PARAMS: ['tactical', 'analysis', 'motivator', 'conditioning'],
    // 🎯 個人練習で選手の「武器」が伸びる量の base（gain = base×(1-v/99) の逓減）。
    //   目安: 95の選手 ≈ +0.1/週（ほぼ伸びない）／70の選手 ≈ +0.7/週。
    //   ⚠️ 成長は persistent＝マルチシーズンの能力インフレに直結するので SN-10 の KPI 計測対象。
    TRAIN_BASE: 2.5,
    // ビデオ学習の対策 buff（§6.1）。tactical に比例し、上限 +5%。
    //   mental の [0.90,1.10] と乗算されるため、監督分は単独 ±5% から始める。
    BUFF_MAX: 0.05,
    TACTIC_GAIN: 25     // 戦術勉強1回あたりの習得ゲージ（tactical で ±・100 で解放）
  };

  /* MG-05 人気の双方向変動（設計書 §1.3）。結果（勝敗）＋内容（得点差・宿敵・連勝）の両面。
   * ★ 人気は**メタ層専用**＝試合内の param 係数には一切触れない（勝率を人気で操作しない）。
   *   実効果は解任圧力(SN-05)と移籍オファー(SN-04)で state 遷移として配線する。
   * ⚠️ 係数はまだ検討の余地あり（BACKLOG MG-13 と同じ扱い・SN-10 で KPI 判定）。 */
  var POPULARITY_TUNING = {
    WIN: 2.0,
    LOSS: -2.0,
    DRAW: -0.2,        // 引き分け＝「退屈」の僅少ペナルティ
    GD_COEF: 0.5,      // 得点差1につき（大勝で加点・大敗で減点）
    RIVAL_WIN: 3.0,    // 宿敵に勝つと跳ねる
    RIVAL_LOSS: -2.0,  // 宿敵に負けると余計に落ちる
    STREAK_COEF: 0.5,  // 連勝/連敗の継続ボーナス（今節を含む連続数 - 1 に掛ける）
    STREAK_CAP: 5      // 連勝ボーナスの頭打ち
  };

  /* SN-02 シーズン目標＋クラブ信頼度（設計書 §3.1/§3.2）。
   * ★ 目標はクラブの「戦力の格」から決定論で決める（rng 不使用）。強いクラブほど要求が厳しい。
   * ★ clubTrust は解任判定（SN-05）の材料。ここでは「上下させて見せる」までを実装する。
   * ⚠️ 係数は暫定（MG-13/MG-14 と同じ扱い＝判定は SN-10）。 */
  var GOAL_TUNING = {
    // 戦力順位 r（1=最強）→ 要求順位。最強クラブは優勝、以下は「自分の格より1つ上」を求められる。
    TARGET_FOR_RANK: function (r, n) { return Math.max(1, Math.min(n - 1, r - 1)); },
    TRUST_WIN: 2.0,        // 勝利
    TRUST_LOSS: -2.0,      // 敗戦
    TRUST_DRAW: -0.3,      // 引き分け（僅少マイナス）
    TRUST_ON_TRACK: 1.0,   // 目標圏内で節を終えている
    TRUST_OFF_TRACK: -0.6, // 目標圏外（1順位ごと・下回るほど押し下げ）
    TRUST_OFF_CAP: -3.0,   // 圏外ペナルティの下限
    SEASON_ACHIEVED: 15,   // season 終了時: 達成
    SEASON_MISSED: -15,    // 同: 未達
    SEASON_POP_ACHIEVED: 6,   // 達成時の人気ボーナス
    SEASON_POP_MISSED: -6     // 未達時の人気ペナルティ
  };

  var SEASON_TUNING = {
    // 怪我の欠場節数（discipline.js の severity マーカーを読む・§6.4）
    INJURY_OUT: { minor: 1, severe: 3 },
    SUSPEND_RED: 1,        // レッド＝次節出場停止
    YELLOW_ACCUM: 3,       // イエロー累積の閾値
    SUSPEND_ACCUM: 1,      // 累積到達時の出場停止節数
    MIN_AVAILABLE: 11      // 詰み防止＝先発 11 人を確保できなければ欠場を強制解除（§3.3）
  };

  /* 選手識別キー（PT/PS と同じ決定論キー＝long_name 優先）。
   * ⚠️ **オリジナルクラブ化の時に必ず見直すこと**（2026-07-22 ユーザー補足）:
   *   いまリーグに入っている実チームは**あくまで仮**で、本番はオリジナルクラブに差し替わる（FN-01）。
   *   このキーは squads（成長 delta / 怪我・停止の残り週 / 出場・得点記録）の**保存キー**なので、
   *   選手名が変わると保存済みデータが**エラーも出さずに丸ごと迷子になる**（= 静かなデータ消失）。
   *   → クラブ差し替えは β 公開前に済ませ、その時点でセーブを切り替える（BACKLOG FN-01 参照）。
   *   → 名前だけを架空化する方式を採るなら、long_name は「内部ID」として据え置き、表示名だけ差し替える。 */
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

  /* ===========================================================================
   * MG-03 — 行動フェーズ MVP（試合前に1アクション・設計書 §1.2/§6.1）
   * ---------------------------------------------------------------------------
   * 「今日は何をするか」の決断を1日1回。初期アクション2種:
   *   📹 ビデオ学習 … 次戦の相手が最も得意な攻め筋を割り出し、その1本に対策 buff（試合内）
   *   📖 戦術勉強   … 未習得戦術の習得ゲージを進める（100 で解放＝MG-04 が使う）
   * ★ 効果は getActionParam の係数 seam に「1本だけ」相乗り（§6.1）。デュエル式・チャンス数は不可侵。
   * ★ 決定論のみ（相手の得意筋は params から算出）＝ rng を新規消費しない。
   * ========================================================================= */

  // 攻め筋 → 参照する param（getActionParam の攻撃側の式に合わせる）。対策の対象＝この6本。
  var THREAT_ACTIONS = [
    { id: 'ドリブル突破', en: 'Dribbling',      idx: [ACCELERATION, AGILITY, DRIBBLE_ACCURACY, DRIBBLE_SPEED] },
    { id: 'クロス',       en: 'Crossing',       idx: [LONGPASS, CURVE] },
    { id: 'ポストプレー', en: 'Hold-up play',   idx: [POWER, RESPONSE, BALL_TECH] },
    { id: 'ロングパス',   en: 'Long passing',   idx: [LONGPASS] },
    { id: 'ショートパス', en: 'Short passing',  idx: [SHORTPASS] },
    { id: '飛び出し',     en: 'Runs in behind', idx: [ACCELERATION, RESPONSE, AGILITY, POSITIONING, OFFENSIVE] }
  ];
  function _threatDef(id) { for (var i = 0; i < THREAT_ACTIONS.length; i++) if (THREAT_ACTIONS[i].id === id) return THREAT_ACTIONS[i]; return null; }
  function _threatLabel(id) { var d = _threatDef(id); return d ? _t(d.id, d.en) : id; }

  var TACTIC_LABELS = {
    POSSESSION: ['ポゼッション', 'Possession'], PRESS: ['プレッシング', 'Pressing'],
    COUNTER: ['カウンター', 'Counter'], CATENACCIO: ['カテナチオ', 'Catenaccio'], FREE: ['フリー', 'Free']
  };
  function _tacticLabel(id) { var l = TACTIC_LABELS[id]; return l ? _t(l[0], l[1]) : id; }

  /* クラブの攻め筋プロファイル（先発11人＝GK除く10人の平均）。攻め筋ごとの素の強さ。 */
  function _threatProfile(clubId) {
    var td = _overlaySquad(clubId);
    var prof = THREAT_ACTIONS.map(function () { return 0; });
    if (!td || !td.players) return prof;
    var lineup = (td.default_lineup || []).slice(1, 11);   // 0=GK は攻め筋の対象外
    for (var a = 0; a < THREAT_ACTIONS.length; a++) {
      var def = THREAT_ACTIONS[a], sum = 0, n = 0;
      for (var i = 0; i < lineup.length; i++) {
        var p = td.players[lineup[i]];
        if (!p || !p.params) continue;
        var v = 0;
        for (var k = 0; k < def.idx.length; k++) v += p.params[def.idx[k]];
        sum += v / def.idx.length; n++;
      }
      prof[a] = n ? (sum / n) : 0;
    }
    return prof;
  }

  /* 相手が最も得意な攻め筋を決定論で割り出す。
   * ★ 素の平均値どうしを比べてはいけない: 攻め筋ごとに参照 param 数も水準も違うため、
   *   単一 param のショートパス/ロングパスが常に勝ってしまう（実装当初の欠陥）。
   *   → 「リーグ平均に対してどれだけ突出しているか」の相対値で比べる＝そのチームらしさが出る。
   * ★ 成長オーバーレイ適用後のデータで見る＝「今の相手」を見る。rng 不使用＝決定論。 */
  function _opponentThreat(oppId) { return _opponentThreats(oppId)[0] || THREAT_ACTIONS[0].id; }

  /* ===========================================================================
   * MG-04 — 戦術習得制（リーグモード限定）
   * ---------------------------------------------------------------------------
   * 采配で選べる戦術を「習得済み」だけに絞る。初期2種＋バランス重視、残りは戦術勉強で解放。
   * ★ **バランス重視(FREE) は常時開放**。多くのクラブの default_tactics であり、
   *   「何もしない状態」＝ベースラインなので、これを塞ぐと試合が始められない。
   * ★ リーグの試合中だけ効かせる（_leagueMatchActive）。シングル/W杯は全戦術そのまま。
   * ★ 公開版は league.js 非同梱＝simulate.js 側は typeof ガードで完全 no-op。
   * ========================================================================= */
  var _leagueMatchActive = false;

  function _isTacticUnlocked(idx) {
    var id = TACTIC_IDS[idx];
    if (!id || id === 'FREE') return true;              // バランス重視は常に選べる
    var m = _state && _state.manager;
    if (!m || !m.learnedTactics) return true;
    return m.learnedTactics.indexOf(id) >= 0;
  }

  /* simulate.js の戦術UIが呼ぶ唯一の窓口。
   * 戻り値 null = 制限なし（＝リーグ外／league.js 非同梱と同じ扱い）。 */
  window.leagueTacticInfo = function (idx) {
    if (!_leagueMatchActive || !_state || !_state.manager) return null;
    if (_isTacticUnlocked(idx)) return { locked: false };
    var id = TACTIC_IDS[idx];
    var prog = Math.round((_state.manager.tacticProgress && _state.manager.tacticProgress[id]) || 0);
    return {
      locked: true, id: id, progress: prog,
      hint: _t('未習得（' + prog + '%）— 週の準備で「戦術勉強」を選ぶと習得できる',
               'Not learned (' + prog + '%) — pick "Tactic study" in your week to unlock')
    };
  };

  // 未習得の戦術（習得順＝TACTIC_IDS の並び。FREE は習得対象外）
  function _nextUnlearnedTactic() {
    var m = _state && _state.manager; if (!m) return null;
    var learned = m.learnedTactics || [];
    for (var i = 0; i < TACTIC_IDS.length; i++) {
      var id = TACTIC_IDS[i];
      if (id === 'FREE') continue;
      if (learned.indexOf(id) < 0) return id;
    }
    return null;
  }

  /* 成長式（§1.2）: gain = base × (1 - param/CAP)。0 に近いほど伸び、CAP 付近で頭打ち。 */
  function _grow(params, key, base) {
    if (!params || typeof params[key] !== 'number') return 0;
    var cur = params[key];
    var gain = base * (1 - cur / MANAGER_TUNING.CAP);
    if (gain < 0) gain = 0;
    params[key] = Math.max(0, Math.min(MANAGER_TUNING.CAP, cur + gain));
    return params[key] - cur;
  }

  /* ===========================================================================
   * MG-03b — 「1週間」を単位にする（2026-07-22 ユーザー提案）
   * ---------------------------------------------------------------------------
   * ★ 1節 = 1週間・試合は週末。現実のプロサッカーと同じ「週末に向けて1週間をどう使うか」を
   *   ゲームの区切りにする。副産物として既存の数字が現実的に読める:
   *     怪我「3節欠場」→「3週間離脱」／出場停止「次節」→「翌週」。
   * ★ 複雑にしない: 月〜金を **3コマ** に圧縮し、そこへ何を置くかだけを決める。
   *   同じものを重ねてよい＝重点配分そのものが監督の手腕（1画面・数タップで完結）。
   * ========================================================================= */
  var WEEK_SLOTS = 3;

  /* ★ コマの種類は増える前提（2026-07-22 ユーザー指示）。追加は**この表に1行足すだけ**で、
   *   UI（アイコン列・説明文・ピッカー）／おまかせ／成長／消費 まで自動で行き渡るようにする。
   *   ＝新しいコマのために _setWeekSlot / _autoWeek / _consumeWeek / UI を触らない。
   *
   * 1行の書き方:
   *   kind      保存に使う識別子（セーブに残るので後から変えない）
   *   icon/ja/en   表示
   *   grow      {param, base}  … 監督のどの param が MANAGER_TUNING.GROWTH.<base> ぶん伸びるか
   *   target    fn(ctx, nth)   … 対象の既定値。nth = 同じ種類が何コマ目か（0始まり）
   *   keepTarget true          … ユーザーが選んだ対象を再計算で上書きしない（ピッカー系）
   *   picker    'player'       … コマの下に対象選択UIを出す
   *   enabled   fn()           … false なら選べない（例: 全戦術習得済み）
   *   text      fn(slot, ctx)  … コマ行の説明文
   *   summary   fn(slot)       … 試合後「今週の成果」の1行表示
   *   preMatch  fn(ctx, n)     … 試合の前に効く処理（n=そのコマ数。回復日など）
   *   consume   fn(slot, out)  … 週の終わりの処理（ゲージ加算・選手成長など）
   *   autoOnce  fn(ctx)        … おまかせで「1コマだけ」入れるか（優先度は配列順）
   *   autoFill  true           … おまかせの残り枠を埋める種類
   *
   * ⚠️ 各コマの**効果の大きさ・種類はまだ検討中**（BACKLOG MG-13）。数値は MANAGER_TUNING に
   *   集約してあるので、チューニングはこの表と定数だけを触れば済む。 */
  var WEEK_ACTION_DEFS = [
    {
      kind: 'video_study', icon: '📹', ja: 'ビデオ学習', en: 'Video study',
      grow: { param: 'tactical', base: 'VIDEO' },
      autoFill: true,
      // 重ねがけ＝「1本目・2本目…」と封じる武器が増える（nth で対象が決まる）
      target: function (ctx, nth) { var r = _opponentThreats(ctx.oppId); return r[nth] || r[r.length - 1]; },
      text: function (slot) {
        return _t('「' + _threatLabel(slot.target) + '」を封じる', 'Shut down "' + _threatLabel(slot.target) + '"');
      },
      summary: function (slot) { return _threatLabel(slot.target); }
    },
    {
      kind: 'recovery', icon: '🏥', ja: '回復日', en: 'Recovery day',
      grow: { param: 'conditioning', base: 'RECOVERY' },
      autoOnce: function (ctx) {
        return _absentees(ctx.myId).some(function (a) { return a.kind === 'injury'; });
      },
      text: function () { return _t('負傷者の復帰が1週早まる', 'Injured players return a week sooner'); },
      // ★ 週の練習 → 週末の試合、という時間順。先発を組む前に効かせる（_applyWeekRecovery が呼ぶ）
      preMatch: function (ctx, n) { return _healSquad(ctx.myId, n); }
    },
    {
      kind: 'tactic_study', icon: '📖', ja: '戦術勉強', en: 'Tactic study',
      grow: { param: 'tactical', base: 'TACTIC' },
      enabled: function () { return !!_nextUnlearnedTactic(); },
      autoOnce: function () { return !!_nextUnlearnedTactic(); },
      target: function () { return _nextUnlearnedTactic(); },
      text: function (slot) {
        var prog = Math.round((_state.manager.tacticProgress && _state.manager.tacticProgress[slot.target]) || 0);
        return _t(_tacticLabel(slot.target) + '（' + prog + '%）', _tacticLabel(slot.target) + ' (' + prog + '%)');
      },
      summary: function (slot) { return _tacticLabel(slot.target); },
      consume: function (slot, out) { _advanceTactic(slot.target, out); }
    },
    {
      kind: 'individual_training', icon: '🎯', ja: '個人練習', en: 'Individual training',
      grow: { param: 'analysis', base: 'TRAINING' },
      picker: 'player', keepTarget: true,
      target: function (ctx) { return _defaultTrainee(ctx.myId); },
      text: function (slot, ctx) {
        var b = _bestParamOf(ctx.myId, slot.target);
        if (!b) return _t('選手を鍛える', 'Train a player');
        return _t('武器「' + b.name + '」を伸ばす（+' + b.gain + '）',
                  'Sharpen their best attribute (+' + b.gain + ')');
      },
      consume: function (slot, out) {
        var t = _trainPlayer(_state.myClub, slot.target);
        if (t) out.trained.push(t);
      }
    }
  ];
  function _weekActionDef(kind) {
    for (var i = 0; i < WEEK_ACTION_DEFS.length; i++) if (WEEK_ACTION_DEFS[i].kind === kind) return WEEK_ACTION_DEFS[i];
    return null;
  }
  function _weekActionLabel(kind) { var d = _weekActionDef(kind); return d ? (d.icon + ' ' + _t(d.ja, d.en)) : ''; }

  /* 相手の攻め筋を「リーグ平均比」の高い順に並べる（_opponentThreat の一般形）。
   * ビデオ学習を重ねると 1本目・2本目・3本目 と封じる武器が増える＝重ねがけの意味。 */
  function _opponentThreats(oppId) {
    var mine = _threatProfile(oppId);
    var ids = CLUB_DEFS.map(function (d) { return d.id; });
    var sums = THREAT_ACTIONS.map(function () { return 0; });
    for (var c = 0; c < ids.length; c++) {
      var prof = _threatProfile(ids[c]);
      for (var a = 0; a < sums.length; a++) sums[a] += prof[a];
    }
    var scored = [];
    for (var a2 = 0; a2 < THREAT_ACTIONS.length; a2++) {
      var mean = sums[a2] / (ids.length || 1);
      scored.push({ id: THREAT_ACTIONS[a2].id, rel: mean ? (mine[a2] - mean) / mean : -Infinity, ord: a2 });
    }
    // 同値は THREAT_ACTIONS の並び順で決着＝決定論（rng 不使用）
    scored.sort(function (x, y) { return (y.rel - x.rel) || (x.ord - y.ord); });
    return scored.map(function (s) { return s.id; });
  }

  /* 今週の準備（無ければ null）。★ 旧形式 {round,kind,target} のセーブも読める（形の正規化のみ）。 */
  function _pendingWeek() {
    var sm = _state && _state.seasonMeta;
    var pa = sm && sm.pendingAction;
    if (!pa || pa.round !== _state.round) return null;
    if (!pa.slots) {   // 旧 1アクション形式 → 3コマ形式へ（セーブ版数は据え置き＝欠落補完と同じ扱い）
      pa.slots = [{ kind: pa.kind, target: pa.target || null }];
      delete pa.kind; delete pa.target;
    }
    while (pa.slots.length < WEEK_SLOTS) pa.slots.push(null);
    if (pa.slots.length > WEEK_SLOTS) pa.slots.length = WEEK_SLOTS;
    return pa;
  }

  function _ensureWeek() {
    var pa = _pendingWeek();
    if (pa) return pa;
    pa = { round: _state.round, slots: [null, null, null], recoveryApplied: 0 };
    _state.seasonMeta.pendingAction = pa;
    return pa;
  }

  // 自クラブの離脱者（怪我＝週数／出場停止＝週数）。UI と「おまかせ」が読む。
  function _absentees(clubId) {
    var td = _clubData(clubId), out = [];
    if (!td) return out;
    for (var i = 0; i < td.players.length; i++) {
      var e = _peekSquadEntry(clubId, _playerKey(td.players[i]));
      if (!e) continue;
      if (e.injuryOut > 0) out.push({ name: td.players[i].name, weeks: e.injuryOut, kind: 'injury' });
      else if (e.suspendOut > 0) out.push({ name: td.players[i].name, weeks: e.suspendOut, kind: 'suspend' });
    }
    return out;
  }

  /* 週プランの文脈（自クラブ/対戦相手）。def の各 fn に渡す唯一の引数。 */
  function _weekCtx() {
    var fx = _myFixtureThisRound(); if (!fx) return null;
    var myId = _state.myClub;
    return { myId: myId, oppId: (fx.home === myId) ? fx.away : fx.home, fx: fx };
  }

  /* 全コマの対象を並び順で再計算する（同じ種類の「何コマ目か」= nth を def に渡す）。
   * ★ 種類ごとの分岐を持たない＝コマの種類が増えてもこの関数は変わらない。
   *   keepTarget の def（ユーザーが選ぶピッカー系）は既に対象があれば上書きしない。 */
  function _retargetSlots(pa, ctx) {
    var nth = {};
    for (var i = 0; i < pa.slots.length; i++) {
      var s = pa.slots[i]; if (!s) continue;
      var def = _weekActionDef(s.kind); if (!def) continue;
      var k = nth[s.kind] = (nth[s.kind] === undefined ? 0 : nth[s.kind] + 1);
      if (!def.target) continue;
      if (def.keepTarget && s.target) continue;
      s.target = def.target(ctx, k);
    }
  }

  /* コマに置くものを決める（試合前なら何度でも変更可）。kind='' でそのコマを空に戻す。 */
  function _setWeekSlot(idx, kind) {
    if (!_state || _state.finished) return;
    if (idx < 0 || idx >= WEEK_SLOTS) return;
    var ctx = _weekCtx(); if (!ctx) return;
    var pa = _ensureWeek();

    if (!kind) pa.slots[idx] = null;
    else {
      var def = _weekActionDef(kind); if (!def) return;
      if (def.enabled && !def.enabled(ctx)) return;   // 例: 全戦術習得済みの「戦術勉強」
      pa.slots[idx] = { kind: kind, target: null };
    }
    _retargetSlots(pa, ctx);
    _save();
    _renderHub(false);
  }

  // 個人練習の既定対象＝キープレイヤー（未設定なら先発の先頭）
  function _defaultTrainee(clubId) {
    var td = _clubData(clubId); if (!td) return null;
    var idx = (typeof td.default_keyplayer === 'number') ? td.default_lineup[td.default_keyplayer] : null;
    var p = (idx != null) ? td.players[idx] : td.players[td.default_lineup[0]];
    return p ? _playerKey(p) : null;
  }

  // ピッカー系のコマ（picker:'player'）の対象差し替え
  function _setTraineeTarget(idx, playerKey) {
    var pa = _pendingWeek(); if (!pa) return;
    var s = pa.slots[idx];
    var def = s && _weekActionDef(s.kind);
    if (!def || !def.picker) return;
    s.target = playerKey;
    _save();
    _renderHub(false);
  }

  /* 「おまかせ」＝ def の autoOnce を配列順に1コマずつ入れ、残りを autoFill で埋める。
   * 惰性プレイでも1日1回が成立するように（毎回3枠を悩ませない）。
   * ★ 新しいコマを増やす時は def に autoOnce を書けばここへ自動で参加する。 */
  function _autoWeek() {
    if (!_state || _state.finished) return;
    var ctx = _weekCtx(); if (!ctx) return;
    var pa = _ensureWeek();
    var plan = [];
    WEEK_ACTION_DEFS.forEach(function (d) {
      if (plan.length >= WEEK_SLOTS) return;
      if (d.autoOnce && d.autoOnce(ctx)) plan.push(d.kind);
    });
    var filler = WEEK_ACTION_DEFS.filter(function (d) { return d.autoFill; })[0];
    while (plan.length < WEEK_SLOTS && filler) plan.push(filler.kind);
    plan.length = Math.min(plan.length, WEEK_SLOTS);
    pa.slots = plan.map(function (k) { return { kind: k, target: null }; });
    while (pa.slots.length < WEEK_SLOTS) pa.slots.push(null);
    _retargetSlots(pa, ctx);
    _save();
    _renderHub(false);
  }

  /* 試合の前に効くコマ（def.preMatch）をまとめて適用する。
   * ★ 「週の練習 → 週末の試合」の時間順。先発を組む前に呼ぶこと（playToday が担保）。
   * ★ preApplied で二重適用を防ぐ（試合を中断して戻った時など）。 */
  function _applyWeekRecovery(myId) {
    var pa = _pendingWeek(); if (!pa) return 0;
    var ctx = { myId: myId };
    if (!pa.preApplied) pa.preApplied = {};
    // 旧フィールド（回復日だけだった頃）からの引き継ぎ
    if (pa.recoveryApplied && pa.preApplied.recovery === undefined) pa.preApplied.recovery = pa.recoveryApplied;
    var total = 0;
    WEEK_ACTION_DEFS.forEach(function (d) {
      if (!d.preMatch) return;
      var want = pa.slots.filter(function (s) { return s && s.kind === d.kind; }).length;
      var n = want - (pa.preApplied[d.kind] || 0);
      if (n <= 0) return;
      total += (d.preMatch(ctx, n) || 0);
      pa.preApplied[d.kind] = want;
    });
    pa.recoveryApplied = pa.preApplied.recovery || 0;   // 後方互換（テスト/旧セーブ）
    _save();
    return total;
  }

  // 🏥 1コマ＝チーム全体の負傷回復が1週進む。出場停止は休んでも短くならない（現実準拠）。
  function _healSquad(clubId, weeks) {
    var td = _clubData(clubId); if (!td) return 0;
    var healed = 0;
    for (var i = 0; i < td.players.length; i++) {
      var e = _peekSquadEntry(clubId, _playerKey(td.players[i]));
      if (!e || !(e.injuryOut > 0)) continue;
      var before = e.injuryOut;
      e.injuryOut = Math.max(0, e.injuryOut - weeks);
      healed += (before - e.injuryOut);
    }
    return healed;
  }

  // 📖 習得ゲージを進める（速度は戦術眼に比例：20 で約 1.0 倍・100 で 1.4 倍）
  function _advanceTactic(tid, out) {
    var m = _state.manager;
    if (!tid || m.learnedTactics.indexOf(tid) >= 0) return;
    if (!m.tacticProgress) m.tacticProgress = {};
    var speed = 1 + (m.params.tactical / MANAGER_TUNING.CAP) * 0.5 - 0.1;
    var next = (m.tacticProgress[tid] || 0) + MANAGER_TUNING.TACTIC_GAIN * speed;
    if (next >= 100) { m.tacticProgress[tid] = 100; m.learnedTactics.push(tid); out.unlocked = tid; }
    else m.tacticProgress[tid] = next;
  }

  /* ===========================================================================
   * SN-02 — シーズン目標＋クラブからの信頼度（設計書 §3.1・§3.2）
   * ---------------------------------------------------------------------------
   * 開幕時にクラブが「今季これを達成しろ」と要求し、季中は信頼度が上下する。
   * ★ 目標は戦力の格から決定論で決める（強いクラブほど要求が厳しい）＝rng 不使用。
   * ★ clubTrust は解任判定（SN-05）の材料。ここでは「動いて見える」ところまで。
   * ========================================================================= */

  // 戦力順位（1=最強）。同値は CLUB_DEFS の並び順で決着＝決定論。
  function _strengthRank(clubId) {
    var arr = CLUB_DEFS.map(function (d, i) { return { id: d.id, s: _clubStrength(d.id), ord: i }; });
    arr.sort(function (a, b) { return (b.s - a.s) || (a.ord - b.ord); });
    for (var i = 0; i < arr.length; i++) if (arr[i].id === clubId) return i + 1;
    return arr.length;
  }

  /* 開幕時の目標を決める。既にあれば触らない（季中に要求が変わらない）。 */
  function _ensureSeasonGoal() {
    var m = _state && _state.manager; if (!m) return null;
    if (m.seasonGoal && m.seasonGoal.target) return m.seasonGoal;
    var n = CLUB_DEFS.length;
    var r = _strengthRank(_state.myClub);
    m.seasonGoal = { type: 'table_pos', target: GOAL_TUNING.TARGET_FOR_RANK(r, n), rank: r };
    return m.seasonGoal;
  }

  function _seasonGoalText() {
    var g = _state && _state.manager && _state.manager.seasonGoal;
    if (!g) return '';
    if (g.target <= 1) return _t('優勝', 'Win the title');
    return _t(g.target + '位以内', 'Top ' + g.target + ' finish');
  }

  // 現在（または最終）順位が目標を満たしているか
  function _goalMet(pos) {
    var g = _state && _state.manager && _state.manager.seasonGoal;
    return !!(g && pos && pos <= g.target);
  }

  /* 節ごとの信頼度更新。結果＋「目標圏内にいるか」の2本立て。 */
  function _updateClubTrust(res, pos) {
    var m = _state && _state.manager; if (!m) return null;
    var G = GOAL_TUNING, g = _ensureSeasonGoal();
    var parts = [], d = 0;

    if (res === 'W') { d += G.TRUST_WIN; parts.push({ k: 'win', v: G.TRUST_WIN }); }
    else if (res === 'L') { d += G.TRUST_LOSS; parts.push({ k: 'loss', v: G.TRUST_LOSS }); }
    else { d += G.TRUST_DRAW; parts.push({ k: 'draw', v: G.TRUST_DRAW }); }

    if (pos && g) {
      if (pos <= g.target) { d += G.TRUST_ON_TRACK; parts.push({ k: 'on_track', v: G.TRUST_ON_TRACK }); }
      else {
        var off = Math.max(G.TRUST_OFF_CAP, G.TRUST_OFF_TRACK * (pos - g.target));
        d += off; parts.push({ k: 'off_track', v: off, gap: pos - g.target });
      }
    }

    var before = (typeof m.clubTrust === 'number') ? m.clubTrust : MANAGER_TUNING.TRUST_START;
    m.clubTrust = Math.max(0, Math.min(100, before + d));
    return { delta: Math.round((m.clubTrust - before) * 10) / 10, parts: parts, value: m.clubTrust, onTrack: _goalMet(pos) };
  }

  /* シーズン終了時の清算＝達成/未達で信頼度と人気が大きく動く（[SEASON_END]）。
   * ★ 解任・オファーへの分岐は SN-05/SN-04。ここは判定と清算まで。 */
  function _settleSeason(finalPos) {
    var m = _state && _state.manager; if (!m) return null;
    var G = GOAL_TUNING, g = _ensureSeasonGoal();
    var achieved = _goalMet(finalPos);
    var tBefore = m.clubTrust, pBefore = m.params.popularity;
    m.clubTrust = Math.max(0, Math.min(100, tBefore + (achieved ? G.SEASON_ACHIEVED : G.SEASON_MISSED)));
    m.params.popularity = Math.max(0, Math.min(MANAGER_TUNING.CAP,
      pBefore + (achieved ? G.SEASON_POP_ACHIEVED : G.SEASON_POP_MISSED)));
    var out = {
      achieved: achieved, goal: g && g.target, finalPos: finalPos,
      trustDelta: Math.round((m.clubTrust - tBefore) * 10) / 10,
      popDelta: Math.round((m.params.popularity - pBefore) * 10) / 10,
      trust: m.clubTrust
    };
    m.lastSeasonResult = out;   // 次季の解任/オファー判定（SN-04/05）が読む
    return out;
  }

  /* ===========================================================================
   * MG-05 — 人気システム（設計書 §1.3）
   * ---------------------------------------------------------------------------
   * 唯一の双方向 param。試合結果（勝敗）と内容（得点差・宿敵・連勝）で上下する。
   * ★ 決定論: 連勝数は fixtures の確定済みスコアから毎回組み直す（新しい保存項目を作らない）。
   * ★ rng 不使用。★ 試合内の param 係数には触れない（メタ層専用）。
   * ========================================================================= */

  /* 自クラブの結果列（古い順の 'W'|'D'|'L'）を fixtures から再構成する。 */
  function _myResultSeries() {
    var my = _state.myClub, out = [];
    for (var r = 0; r < _state.fixtures.length; r++) {
      var ms = _state.fixtures[r];
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (!m.played || (m.home !== my && m.away !== my)) continue;
        var mine = (m.home === my) ? m.hs : m.as;
        var opp = (m.home === my) ? m.as : m.hs;
        out.push(mine > opp ? 'W' : (mine < opp ? 'L' : 'D'));
      }
    }
    return out;
  }

  /* 直近の連続（{res:'W'|'L', n:回数}）。引き分けで途切れる。 */
  function _currentStreak() {
    var s = _myResultSeries();
    if (!s.length) return { res: null, n: 0 };
    var last = s[s.length - 1];
    if (last === 'D') return { res: 'D', n: 1 };
    var n = 0;
    for (var i = s.length - 1; i >= 0 && s[i] === last; i--) n++;
    return { res: last, n: n };
  }

  /* 今節ぶんの人気の増減を計算して反映する。★ 順位表適用後（＝fixtures に今節が入った後）に呼ぶ。 */
  function _updatePopularity(res, gd, isRival) {
    var m = _state && _state.manager; if (!m || !m.params) return null;
    var P = POPULARITY_TUNING;
    var parts = [];
    var d = 0;

    if (res === 'W') { d += P.WIN; parts.push({ k: 'win', v: P.WIN }); }
    else if (res === 'L') { d += P.LOSS; parts.push({ k: 'loss', v: P.LOSS }); }
    else { d += P.DRAW; parts.push({ k: 'draw', v: P.DRAW }); }

    if (gd) { var g = P.GD_COEF * gd; d += g; parts.push({ k: 'gd', v: g }); }

    if (isRival && res !== 'D') {
      var rv = (res === 'W') ? P.RIVAL_WIN : P.RIVAL_LOSS;
      d += rv; parts.push({ k: 'rival', v: rv });
    }

    var st = _currentStreak();
    if ((st.res === 'W' || st.res === 'L') && st.n >= 2) {
      var n = Math.min(st.n, P.STREAK_CAP) - 1;
      var sv = P.STREAK_COEF * n * (st.res === 'W' ? 1 : -1);
      d += sv; parts.push({ k: 'streak', v: sv, n: st.n });
    }

    var before = m.params.popularity;
    m.params.popularity = Math.max(0, Math.min(MANAGER_TUNING.CAP, before + d));
    return { delta: Math.round((m.params.popularity - before) * 10) / 10, raw: d, parts: parts, streak: st, value: m.params.popularity };
  }

  /* 週の終わり（＝試合終了）にコマを消費して監督/選手を伸ばす（§1.2）。
   * ★ 種類ごとの分岐を持たない＝def.grow と def.consume を回すだけ。
   * ★ rng 不使用（確定した試合結果と選択済みの週プランを読むだけ）。 */
  function _consumeWeek(res) {
    var m = _state && _state.manager; if (!m || !m.params) return null;
    var G = MANAGER_TUNING.GROWTH;
    var out = { grown: {}, week: null, unlocked: null, trained: [] };
    function _add(k, base) { var d = _grow(m.params, k, base); if (d > 0) out.grown[k] = (out.grown[k] || 0) + d; }

    // 試合を1つ指揮（結果不問）＝一方向 param が微増 ／ 勝利 → 戦術眼・モチベーター
    //   ★ popularity は含めない＝人気は結果で上下する（MG-05 の _updatePopularity が唯一の駆動源）
    MANAGER_TUNING.MATCH_ALL_PARAMS.forEach(function (k) { _add(k, G.MATCH_ALL); });
    if (res === 'W') { _add('tactical', G.WIN); _add('motivator', G.WIN); }

    var pa = _pendingWeek();
    out.week = pa;
    if (pa) {
      for (var i = 0; i < pa.slots.length; i++) {
        var s = pa.slots[i]; if (!s) continue;
        var def = _weekActionDef(s.kind); if (!def) continue;
        if (def.grow) _add(def.grow.param, G[def.grow.base] || 0);
        if (def.consume) def.consume(s, out);
        _state.seasonMeta.actionsLog.push({ round: pa.round, action: s.kind, target: s.target });
      }
      _state.seasonMeta.pendingAction = null;
    }
    return out;
  }

  /* 選手の「武器」＝現在値（base + 成長 delta）が最大の param。今週伸びる量も一緒に返す。 */
  function _bestParamOf(clubId, playerKey) {
    if (!playerKey) return null;
    var td = _clubData(clubId); if (!td) return null;
    var p = null;
    for (var i = 0; i < td.players.length; i++) if (_playerKey(td.players[i]) === playerKey) { p = td.players[i]; break; }
    if (!p) return null;
    var e = _peekSquadEntry(clubId, playerKey);
    var bestIdx = -1, bestVal = -1;
    for (var k = 0; k < p.params.length; k++) {
      var v = p.params[k] + ((e && e.growth && e.growth[k]) || 0);
      if (v > bestVal) { bestVal = v; bestIdx = k; }
    }
    if (bestIdx < 0) return null;
    var nm = (typeof PARAM_NAMES !== 'undefined' && PARAM_NAMES[bestIdx]) || ('#' + bestIdx);
    return { idx: bestIdx, val: bestVal, name: nm,
             gain: Math.round(MANAGER_TUNING.TRAIN_BASE * (1 - bestVal / 99) * 10) / 10 };
  }

  /* 🎯 個人練習＝選んだ選手の「武器」（最大 param）を伸ばす。
   * ★ 監督と同じ逓減式＝スターは伸びにくく若手は伸びやすい（能力インフレの抑制・§4.2）。
   * ★ persistent な成長なので squads[].growth（base param の書き換え側）に積む。 */
  function _trainPlayer(clubId, playerKey) {
    if (!playerKey) return null;
    var td = _clubData(clubId); if (!td) return null;
    var p = null;
    for (var i = 0; i < td.players.length; i++) if (_playerKey(td.players[i]) === playerKey) { p = td.players[i]; break; }
    if (!p) return null;
    var e = _squadEntry(clubId, playerKey);
    // 現在値＝base + 既存の成長 delta。最大の param（＝その選手の武器）を対象にする。
    var bestIdx = -1, bestVal = -1;
    for (var k = 0; k < p.params.length; k++) {
      var v = p.params[k] + ((e.growth && e.growth[k]) || 0);
      if (v > bestVal) { bestVal = v; bestIdx = k; }
    }
    if (bestIdx < 0) return null;
    var gain = MANAGER_TUNING.TRAIN_BASE * (1 - bestVal / 99);
    if (gain <= 0) return null;
    if (!e.growth) e.growth = {};
    e.growth[bestIdx] = Math.round(((e.growth[bestIdx] || 0) + gain) * 100) / 100;
    var pname = (typeof PARAM_NAMES !== 'undefined' && PARAM_NAMES[bestIdx]) || ('#' + bestIdx);
    return { name: p.name, param: bestIdx, paramName: pname, gain: Math.round(gain * 10) / 10 };
  }

  /* ── 試合内効果（§6.1）: getActionParam の係数チェーンに足す唯一のフック ──────
   * ★ 返すのは「1つに合成済みの係数」。フックは1本だけ・clamp は返す側で行う。
   * ★ league の試合中だけ有効（_mgMatchCtx が立っている時のみ）＝シングル/W杯は完全 no-op。
   * ★ 公開 docs は league.js 非同梱＝typeof ガードで no-op（公開挙動不変）。 */
  var _mgMatchCtx = null;

  function _beginManagerMatchCtx(myId) {
    var m = _state && _state.manager;
    var pa = _pendingWeek();
    _mgMatchCtx = null;
    if (!m || !pa) return;
    var targets = {};
    var any = false;
    for (var i = 0; i < pa.slots.length; i++) {
      var s = pa.slots[i];
      if (s && s.kind === 'video_study' && s.target) { targets['対' + s.target] = true; any = true; }
    }
    if (!any) return;
    var td = _clubData(myId);
    _mgMatchCtx = {
      myTeamName: td ? td.name : null,
      counterActions: targets,
      // 対策の効き＝戦術眼に比例（0→0% / 100→+5%）。設計 §6.1 の [0.95,1.05] 内に収まる。
      //   ★ 重ねがけは「封じる武器の本数」が増えるだけ＝1本あたりの上限は動かさない。
      buff: MANAGER_TUNING.BUFF_MAX * (m.params.tactical / MANAGER_TUNING.CAP)
    };
  }
  function _endManagerMatchCtx() { _mgMatchCtx = null; }

  window.managerParamFactor = function (team, p, action) {
    if (typeof window !== 'undefined' && window.MANAGER_ENABLED === false) return 1.0;   // キルスイッチ
    var c = _mgMatchCtx;
    if (!c || !team || team.name !== c.myTeamName) return 1.0;
    if (!c.counterActions[action]) return 1.0;             // 対策した攻め筋を守る時だけ効く
    var f = 1 + c.buff;
    return Math.max(0.95, Math.min(1.05, f));              // clamp は返す側で（§6.1）
  };

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
    _ensureSeasonGoal();   // SN-02: 開幕時にクラブが目標を提示する
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
      _ensureSeasonGoal();   // SN-02: 目標未設定の既存セーブにも開幕目標を生やす
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
    // SN-02: 目標は季ごとに出し直す（戦力が変われば要求も変わる）。信頼度は在任が続く限り引き継ぐ。
    manager.seasonGoal = null;
    _ensureSeasonGoal();
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

    // MG-03b: 🏥 回復日は「週の練習 → 週末の試合」の時間順で、**先発を組む前に**効かせる
    //   （＝間に合った選手はこの試合に復帰できる）。★ _overlaySquad より必ず前に呼ぶ。
    _applyWeekRecovery(myId);

    // 監督ビューアは常に team1 = 自チーム（左）として表示。ホーム/アウェイは順位表記録側で扱う。
    // ★ v4: TEAM_DATA そのものではなく「持ち越しオーバーレイ適用済み clone」を渡す（§2.2）。
    //   成長 delta を base param へ焼き込み、怪我/出場停止の選手を先発から外す（詰み防止つき）。
    //   TEAM_DATA 本体は single/WC と共有の不変ソースなので絶対に書き換えない。
    team1Data = _overlaySquad(myId);
    team2Data = _overlaySquad(oppId);

    // MG-04: リーグでは未習得の戦術は使えない。ここから先の采配UIに制限をかける
    _leagueMatchActive = true;
    // クラブの既定戦術が未習得なら、習得済み（無ければバランス重視）へ落として開始する
    var startTactics = team1Data.default_tactics;
    if (!_isTacticUnlocked(startTactics)) {
      var learnedIdx = TACTIC_IDS.indexOf('FREE');
      for (var ti = 0; ti < TACTIC_IDS.length; ti++) if (_isTacticUnlocked(ti) && TACTIC_IDS[ti] !== 'FREE') { learnedIdx = ti; break; }
      startTactics = learnedIdx;
    }

    // team1State は startManagerMatch の呼び出し側責務（team2State は内部生成）
    var s1 = system_data.findIndex(function (s) { return s.name === team1Data.default_system; });
    team1State = {
      systemIdx: s1 >= 0 ? s1 : 0,
      tactics: startTactics,
      keyplayer: team1Data.default_keyplayer,
      marked_player: (team1Data.default_marked_player !== undefined) ? team1Data.default_marked_player : -1,
      lineup: team1Data.default_lineup.slice(0, 11)
    };

    // MG-03b: 📹 ビデオ学習で対策した攻め筋を、この試合の間だけ係数として効かせる
    _beginManagerMatchCtx(myId);

    // 試合終了フック（_mvFinish が拾う。1回で自動解除）
    window._leagueOnMatchFinish = function () { _onMatchFinish(myId, oppId, iAmHome, fx); };

    startManagerMatch();
  }

  function _onMatchFinish(myId, oppId, iAmHome, fx) {
    window._leagueOnMatchFinish = null;
    _endManagerMatchCtx();   // MG-03: 対策 buff はこの1試合限り（他会場の AI 消化前に必ず解除）
    _leagueMatchActive = false;   // MG-04: 戦術の制限もリーグの試合中だけ（シングル/W杯に漏らさない）
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
    var mg = _consumeWeek(res);   // MG-03b: 今週の3コマを消費して監督/選手を伸ばす（成長は persistent）
    // MG-05: 人気は結果と内容で上下（★ fixtures に今節が入った後＝連勝数が今節を含む位置で呼ぶ）
    mg.popularity = _updatePopularity(res, myScore - oppScore, _isRival(oppId));
    // SN-02: クラブからの信頼度は「結果」＋「目標圏内にいるか」で上下（順位確定後に呼ぶ）
    mg.trust = _updateClubTrust(res, _position(myId));
    _state.lastResult = {
      manager: mg,   // 試合後バナーの成長表示用（MG-08 の演出はここを読む）
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
    if (_state.round >= _state.fixtures.length) {
      _state.finished = true;
      // SN-02 [SEASON_END]: 目標の達成判定と清算（信頼度・人気が大きく動く）。
      //   解任/オファーへの分岐は SN-05/SN-04 で、この結果（manager.lastSeasonResult）を読む。
      _state.lastResult.season = _settleSeason(_position(myId));
    }
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
      /* 今週の準備（MG-03b・週プラン3コマ）。固定pxを避け em/% ベースで組む。 */
      '.lg-slotrow{display:flex;align-items:center;gap:0.5em;padding:0.35em 0;border-bottom:1px solid rgba(255,255,255,0.07)}',
      '.lg-slotno{flex:0 0 1.3em;text-align:center;font-size:0.72em;font-weight:800;color:rgba(255,255,255,0.4)}',
      /* ★ 種類が増えても崩れないよう折り返す（flex-wrap） */
      '.lg-slotchips{display:flex;flex-wrap:wrap;gap:0.25em;flex:0 1 auto;max-width:60%}',
      '.lg-slotchip{width:2.1em;height:2.1em;border-radius:0.55em;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.06);color:#fff;font-size:0.95em;line-height:1;cursor:pointer;padding:0;transition:transform .1s,background .1s}',
      '.lg-slotchip.on{background:linear-gradient(135deg,#3f7fd6,#5aa6ef);border-color:rgba(150,210,255,0.7);box-shadow:0 2px 8px rgba(60,130,220,0.45)}',
      '.lg-slotchip:disabled{opacity:0.28;cursor:default}',
      '.lg-slotchip:active:not(:disabled){transform:scale(0.92)}',
      '.lg-slottext{flex:1;min-width:0;font-size:0.72em;color:rgba(255,255,255,0.78);line-height:1.35;overflow:hidden;text-overflow:ellipsis}',
      '.lg-slotsub{padding:0 0 0.4em 1.8em}',
      '.lg-select{width:100%;box-sizing:border-box;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.18);border-radius:0.5em;padding:0.4em 0.6em;font-family:inherit;font-size:0.78em}',
      '.lg-slotfoot{display:flex;align-items:center;gap:0.7em;margin-top:0.5em}',
      '.lg-btn-inline{display:inline-block;width:auto;margin-top:0;padding:0.5em 0.9em;font-size:0.8em}',
      '.lg-absrow{display:flex;align-items:center;gap:0.4em;font-size:0.75em;padding:0.2em 0;color:rgba(255,255,255,0.85)}',
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

  /* ── 今週の準備（MG-03b・週プラン）───────────────────────────────────
   * 月〜金を3コマに圧縮し、各コマに何を置くかを決める。同じものを重ねてよい＝重点配分。
   * 効果の主語は常にユーザー＝コーチ助言(MG-06)と違い、これは監督自身の決断。 */
  function _actionPhaseHTML() {
    var m = _state.manager; if (!m) return '';
    var ctx = _weekCtx(); if (!ctx) return '';
    var pa = _pendingWeek();
    var slots = pa ? pa.slots : [null, null, null];

    var head = '<div class="lg-h">' + _t('今週の準備', "This week's prep") +
      '<span class="lg-badge">' + _t('月〜金 / ' + WEEK_SLOTS + 'コマ', 'Mon–Fri / ' + WEEK_SLOTS + ' slots') + '</span></div>';

    var rows = '';
    for (var i = 0; i < WEEK_SLOTS; i++) {
      var s = slots[i];
      // ★ アイコン列は WEEK_ACTION_DEFS をそのまま並べる＝種類が増えても勝手に増える（列は折り返す）
      var chips = WEEK_ACTION_DEFS.map(function (d) {
        var on = !!(s && s.kind === d.kind);
        var dis = !on && d.enabled && !d.enabled(ctx);
        return '<button class="lg-slotchip' + (on ? ' on' : '') + '"' + (dis ? ' disabled' : '') +
          ' title="' + _t(d.ja, d.en) + '" onclick="leagueSetWeekSlot(' + i + ',\'' + (on ? '' : d.kind) + '\')">' +
          d.icon + '</button>';
      }).join('');
      rows += '<div class="lg-slotrow"><span class="lg-slotno">' + (i + 1) + '</span>' +
        '<span class="lg-slotchips">' + chips + '</span>' +
        '<span class="lg-slottext">' + _weekSlotText(s, ctx) + '</span></div>';
      // 対象を選ぶコマ（picker）は、このコマの直下にピッカーを出す
      var sdef = s && _weekActionDef(s.kind);
      if (sdef && sdef.picker === 'player') rows += _traineeSelectHTML(i, ctx.myId, s.target);
    }

    var chosen = slots.filter(Boolean).length;
    var foot = '<div class="lg-slotfoot">' +
      '<button class="lg-btn sec lg-btn-inline" onclick="leagueAutoWeek()">🎲 ' + _t('おまかせ', 'Auto-fill') + '</button>' +
      '<span class="lg-mini">' + _t(chosen + ' / ' + WEEK_SLOTS + ' コマ', chosen + ' / ' + WEEK_SLOTS + ' slots') + '</span></div>';

    return head + '<div class="lg-card">' + rows + foot +
      '<div class="lg-mini" style="margin-top:6px;color:rgba(255,255,255,0.45)">' +
      _t('※ 週末の試合が終わると消費されます（キックオフ前なら組み替え自由）',
         '* Consumed after the weekend match (rearrange freely before kickoff)') + '</div>' +
      '</div>';
    // ★ 離脱者は右カラム（選手情報ゾーン）に置く＝左カラムの主導線「週末の試合へ」を押し下げない
  }

  function _weekSlotText(s, ctx) {
    if (!s) return '<span style="color:rgba(255,255,255,0.35)">' + _t('未設定', 'empty') + '</span>';
    var def = _weekActionDef(s.kind);
    return (def && def.text) ? def.text(s, ctx) : (def ? _t(def.ja, def.en) : '');
  }

  function _traineeSelectHTML(idx, clubId, cur) {
    var td = _clubData(clubId); if (!td) return '';
    var opts = td.players.map(function (p) {
      var k = _playerKey(p);
      return '<option value="' + k.replace(/"/g, '&quot;') + '"' + (k === cur ? ' selected' : '') + '>' + p.name + '</option>';
    }).join('');
    return '<div class="lg-slotsub"><select class="lg-select" onchange="leagueSetTrainee(' + idx + ', this.value)">' + opts + '</select></div>';
  }

  /* 離脱者（怪我＝残り週数／出場停止＝残り週数）。回復日の意味を読ませるために必ず出す。
   * 置き場所は右カラム（＝3ゾーン設計の「選手情報」側）。 */
  function _absenteeHTML(clubId) {
    var list = _absentees(clubId);
    if (!list.length) return '';
    var rows = list.map(function (a) {
      var ic = (a.kind === 'injury') ? '🩹' : '🟥';
      var lbl = (a.kind === 'injury')
        ? _t('あと' + a.weeks + '週', a.weeks + 'w left')
        : _t('出場停止 あと' + a.weeks + '週', 'Suspended ' + a.weeks + 'w');
      return '<div class="lg-absrow">' + ic + ' <b>' + a.name + '</b>' +
        '<span style="margin-left:auto;color:' + (a.kind === 'injury' ? '#ffb37a' : '#ff8f8f') + '">' + lbl + '</span></div>';
    }).join('');
    return '<div class="lg-h">' + _t('離脱者', 'Unavailable') + '</div>' +
      '<div class="lg-card" style="padding:8px 11px">' + rows + '</div>';
  }

  /* 試合後の成長表示（MG-03。派手な演出は MG-08 で・ここは「動いた事実」を見せる最小形） */
  function _managerGrowthHTML(lr) {
    var mg = lr && lr.manager; if (!mg) return '';
    var labels = { tactical: ['戦術眼', 'Tactics'], analysis: ['分析力', 'Analysis'], motivator: ['モチベーター', 'Motivation'], conditioning: ['フィジカル管理', 'Conditioning'], popularity: ['人気', 'Popularity'] };
    var parts = [];
    for (var k in mg.grown) {
      if (!Object.prototype.hasOwnProperty.call(mg.grown, k)) continue;
      var d = mg.grown[k]; if (!(d >= 0.05)) continue;   // 表示上の下限（微増は丸めて出さない）
      var l = labels[k] || [k, k];
      parts.push(_t(l[0], l[1]) + ' <b style="color:#7ad0ff">+' + (Math.round(d * 10) / 10) + '</b>');
    }
    var trained = (mg.trained || []);
    if (!parts.length && !mg.unlocked && !trained.length && !mg.popularity && !mg.trust) return '';
    // 今週どう使ったか（3コマの内訳を1行に）
    var weekLine = '';
    if (mg.week && mg.week.slots) {
      var used = mg.week.slots.filter(Boolean).map(function (s) {
        var d = _weekActionDef(s.kind); if (!d) return '';
        return d.icon + (d.summary ? d.summary(s) : _t(d.ja, d.en));
      }).filter(Boolean);
      if (used.length) weekLine = '<div style="margin-bottom:3px">' + used.join('　') + '</div>';
    }
    var trainLine = trained.length
      ? '<div style="margin-top:5px;color:#8fe3a4">🎯 ' +
        trained.map(function (t) { return t.name + '（' + (t.paramName || '') + '）+' + t.gain; }).join('　') + '</div>' : '';
    var unlockLine = mg.unlocked
      ? '<div style="margin-top:5px;color:#ffd479;font-weight:800">🎓 ' +
        _t(_tacticLabel(mg.unlocked) + ' を習得した！', 'Learned ' + _tacticLabel(mg.unlocked) + '!') + '</div>' : '';
    var popLine = _popularityLineHTML(mg.popularity) + _trustLineHTML(mg.trust);
    return '<div class="lg-mini" style="margin-top:8px;text-align:center;border-top:1px solid rgba(255,255,255,0.12);padding-top:8px">' +
      '<div style="font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:3px">' + _t('今週の成果', "This week's gains") + '</div>' +
      weekLine + parts.join('　') + trainLine + unlockLine + '</div>' + popLine;
  }

  /* 世論＝人気の増減（MG-05）。新聞の短評風に「なぜ動いたか」を1行で見せる。
   * ★ 数字だけ動かさない＝内訳（結果/得点差/宿敵/連勝）を必ず言葉にする。 */
  function _popularityLineHTML(pop) {
    if (!pop) return '';
    var up = pop.delta > 0, flat = Math.abs(pop.delta) < 0.05;
    var col = flat ? 'rgba(255,255,255,0.6)' : (up ? '#8fe3a4' : '#ff9a8f');
    var sign = (pop.delta > 0 ? '+' : '') + pop.delta;
    var why = pop.parts.map(function (p) {
      if (p.k === 'win') return _t('勝利', 'Win');
      if (p.k === 'loss') return _t('敗戦', 'Loss');
      if (p.k === 'draw') return _t('引き分け', 'Draw');
      if (p.k === 'gd') return (p.v > 0 ? _t('快勝の内容', 'Convincing') : _t('大敗の内容', 'Heavy defeat'));
      if (p.k === 'rival') return (p.v > 0 ? _t('宿敵撃破', 'Derby win') : _t('宿敵に屈す', 'Derby loss'));
      if (p.k === 'streak') return (p.v > 0 ? _t(p.n + '連勝', p.n + '-game win run') : _t(p.n + '連敗', p.n + '-game losing run'));
      return '';
    }).filter(Boolean).join('・');
    var mood = flat ? _t('世論は静観', 'The public is unmoved')
      : (up ? _t('支持が高まっている', 'Support is rising') : _t('風当たりが強まっている', 'Pressure is building'));
    return '<div class="lg-mini" style="margin-top:6px;text-align:center;border-top:1px solid rgba(255,255,255,0.12);padding-top:8px">' +
      '<div style="font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:3px">' + _t('世論', 'Public opinion') + '</div>' +
      '<div>' + _t('人気', 'Popularity') + ' <b style="color:' + col + '">' + sign + '</b>' +
      ' <span style="opacity:.6">（' + Math.round(pop.value) + '）</span>　' + mood + '</div>' +
      (why ? '<div style="opacity:.65;margin-top:2px">' + why + '</div>' : '') + '</div>';
  }

  /* クラブからの信頼（SN-02）。「目標圏内かどうか」がそのまま次季の椅子に効く、を毎節見せる。 */
  function _trustLineHTML(tr) {
    if (!tr) return '';
    var up = tr.delta > 0, flat = Math.abs(tr.delta) < 0.05;
    var col = flat ? 'rgba(255,255,255,0.6)' : (up ? '#8fe3a4' : '#ff9a8f');
    var sign = (tr.delta > 0 ? '+' : '') + tr.delta;
    var why = tr.parts.map(function (p) {
      if (p.k === 'on_track') return _t('目標圏内', 'On track');
      if (p.k === 'off_track') return _t('目標に' + p.gap + 'つ足りない', p.gap + ' places off target');
      return '';
    }).filter(Boolean).join('・');
    return '<div class="lg-mini" style="margin-top:4px;text-align:center">' +
      _t('クラブの信頼', 'Club trust') + ' <b style="color:' + col + '">' + sign + '</b>' +
      ' <span style="opacity:.6">（' + Math.round(tr.value) + '）</span>' +
      (why ? '　<span style="opacity:.65">' + why + '</span>' : '') + '</div>';
  }

  /* シーズン終了の達成判定（SN-02）。優勝セレモニー/振り返りの本番演出は SN-03。 */
  function _seasonVerdictHTML(sv) {
    if (!sv) return '';
    var ok = sv.achieved;
    var col = ok ? '#8fe3a4' : '#ff9a8f';
    return '<div class="lg-card" style="margin-top:8px;border-color:' + col + '66;background:rgba(0,0,0,0.2);text-align:center">' +
      '<div style="font-size:10px;color:rgba(255,255,255,0.5);letter-spacing:1px">' + _t('クラブの評価', 'Club verdict') + '</div>' +
      '<div style="font-weight:800;font-size:15px;margin-top:3px;color:' + col + '">' +
        (ok ? _t('目標達成', 'Target achieved') : _t('目標未達', 'Target missed')) + '</div>' +
      '<div class="lg-mini" style="margin-top:3px">' +
        _t('要求 ' + (sv.goal <= 1 ? '優勝' : sv.goal + '位以内') + ' ／ 結果 ' + sv.finalPos + '位',
           'Expected ' + (sv.goal <= 1 ? 'the title' : 'top ' + sv.goal) + ' / finished ' + sv.finalPos) + '</div>' +
      '<div class="lg-mini" style="margin-top:4px">' +
        _t('クラブの信頼', 'Club trust') + ' <b style="color:' + col + '">' + (sv.trustDelta > 0 ? '+' : '') + sv.trustDelta + '</b>' +
        '　' + _t('人気', 'Popularity') + ' <b style="color:' + col + '">' + (sv.popDelta > 0 ? '+' : '') + sv.popDelta + '</b></div>' +
      '</div>';
  }

  /* 監督ステータス（MG-03/MG-05 の可視化・数字が動いていることを読ませる最小表示） */
  function _managerCardHTML() {
    var m = _state.manager; if (!m || !m.params) return '';
    var defs = [
      ['tactical', '戦術眼', 'Tactics'], ['analysis', '分析力', 'Analysis'],
      ['motivator', 'モチベーター', 'Motivation'], ['conditioning', 'フィジカル管理', 'Conditioning'],
      ['popularity', '人気', 'Popularity']
    ];
    var rows = defs.map(function (d) {
      var v = Math.round(m.params[d[0]] || 0);
      return '<div style="display:flex;align-items:center;gap:6px;margin-top:4px">' +
        '<div style="flex:0 0 40%;font-size:11px;color:rgba(255,255,255,0.7)">' + _t(d[1], d[2]) + '</div>' +
        '<div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,0.12);overflow:hidden">' +
          '<div style="width:' + Math.max(0, Math.min(100, v)) + '%;height:100%;background:linear-gradient(90deg,#4a9eff,#7ad0ff)"></div></div>' +
        '<div style="flex:0 0 2.2em;text-align:right;font-size:11px;font-weight:700">' + v + '</div></div>';
    }).join('');
    // SN-02: クラブからの要求と信頼度（解任の材料＝MG の param とは別枠で見せる）
    var goalBlock = '';
    var g = _ensureSeasonGoal();
    if (g) {
      var pos = _position(_state.myClub);
      var met = _goalMet(pos);
      var trust = Math.round((typeof m.clubTrust === 'number') ? m.clubTrust : MANAGER_TUNING.TRUST_START);
      var tcol = trust >= 60 ? '#8fe3a4' : (trust >= 35 ? '#ffd479' : '#ff9a8f');
      goalBlock = '<div class="lg-mini" style="margin-top:7px;border-top:1px solid rgba(255,255,255,0.1);padding-top:6px">' +
        '<div>' + _t('クラブの要求', 'Club expects') + '：<b style="color:#fff">' + _seasonGoalText() + '</b>' +
        '　<span style="color:' + (met ? '#8fe3a4' : '#ff9a8f') + '">' +
          (met ? _t('達成圏内', 'on track') : _t('未達ライン', 'off track')) + '</span></div>' +
        '<div style="display:flex;align-items:center;gap:6px;margin-top:4px">' +
          '<div style="flex:0 0 40%">' + _t('クラブの信頼', 'Club trust') + '</div>' +
          '<div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,0.12);overflow:hidden">' +
            '<div style="width:' + trust + '%;height:100%;background:' + tcol + '"></div></div>' +
          '<div style="flex:0 0 2.2em;text-align:right;font-weight:700;color:' + tcol + '">' + trust + '</div>' +
        '</div></div>';
    }
    var learned = (m.learnedTactics || []).map(_tacticLabel).join('・');
    // MG-05: 連勝/連敗は人気の駆動要因なのでここに出す（次節の人気の動きが読める）
    var st = _currentStreak(), stLine = '';
    if (st.n >= 2 && (st.res === 'W' || st.res === 'L')) {
      stLine = '<div class="lg-mini" style="margin-top:4px;color:' + (st.res === 'W' ? '#8fe3a4' : '#ff9a8f') + '">' +
        (st.res === 'W' ? '🔥 ' + _t(st.n + '連勝中', st.n + '-game win run') : '💧 ' + _t(st.n + '連敗中', st.n + '-game losing run')) + '</div>';
    }
    return '<div class="lg-h">' + _t('監督', 'Manager') + '</div>' +
      '<div class="lg-card" style="padding:9px 11px">' + rows + stLine + goalBlock +
      '<div class="lg-mini" style="margin-top:7px;border-top:1px solid rgba(255,255,255,0.1);padding-top:6px">' +
        _t('習得戦術', 'Tactics learned') + '：' + learned + '</div></div>';
  }

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
      html += _managerGrowthHTML(lr);   // MG-03: 監督の成長／戦術解放（MG-08 で演出化する土台）
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

    // 行動フェーズ（MG-03）＝試合の前に「今日は何をするか」を1つ決める
    if (!_state.finished) html += _actionPhaseHTML();

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
        // SN-02: クラブの評価（達成/未達）。ここが SN-05 の解任判定の入口になる。
        _seasonVerdictHTML(_state.lastResult && _state.lastResult.season) +
        '<button class="lg-btn" onclick="leagueConfirmNewSeason()">' + _t('次のシーズンへ（今季を記録に残す）', 'Next season (this one is saved)') + '</button>';
    } else {
      var fx = _myFixtureThisRound();
      var oppId = (fx.home === myId) ? fx.away : fx.home;
      var oppDef2 = _clubDef(oppId);
      var iAmHome = (fx.home === myId);
      var haBadge = iAmHome ? _t('HOME', 'HOME') : _t('AWAY', 'AWAY');
      var oppIsRival = _isRival(oppId);
      var rivalBadge = oppIsRival ? '<span class="lg-badge" style="background:#c0392b">' + _t('宿敵', 'RIVAL') + '</span>' : '';
      // 1節 = 1週間・試合は週末（MG-03b）。週表記にすると怪我「あと3週」等と単位が揃う。
      html += '<div class="lg-h">' + _t('第' + (_state.round + 1) + '節 / 14　<span style="opacity:.55;font-weight:400">週末の一戦</span>',
        'Round ' + (_state.round + 1) + ' / 14　<span style="opacity:.55;font-weight:400">Matchday</span>') +
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
        html += '<div class="lg-mini" style="text-align:center;margin-top:6px">' + _t('1日1試合＝1週間。物語は毎日ひとつずつ進む。', 'One match a day — one week per day. The story advances daily.') + '</div>';
      } else {
        html += '<button class="lg-btn" onclick="leaguePlayToday()">▶ ' + _t('週末の試合へ（監督モード）', 'To the weekend match (Manager mode)') + '</button>';
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

    // 離脱者（怪我/出場停止の残り週数）＝回復日コマの意味がここで読める
    if (!_state.finished) html += _absenteeHTML(myId);

    // 監督ステータス（MG-03: 成長が見えないと「1param 1効果」が読めない）
    html += _managerCardHTML();

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
  // 今週の準備（MG-03b）: kind='' でそのコマを空に戻す
  window.leagueSetWeekSlot = function (idx, kind) { _setWeekSlot(idx, kind); };
  window.leagueSetTrainee = function (idx, key) { _setTraineeTarget(idx, key); };
  window.leagueAutoWeek = function () { _autoWeek(); };
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
    // MG-03b 週プラン（今週の準備）
    setWeekSlot: _setWeekSlot,
    setTrainee: _setTraineeTarget,
    autoWeek: _autoWeek,
    consumeWeek: _consumeWeek,
    pendingWeek: _pendingWeek,
    applyWeekRecovery: _applyWeekRecovery,
    absentees: _absentees,
    opponentThreat: _opponentThreat,
    opponentThreats: _opponentThreats,
    beginMatchCtx: _beginManagerMatchCtx,
    endMatchCtx: _endManagerMatchCtx,
    nextUnlearnedTactic: _nextUnlearnedTactic,
    // MG-04 戦術習得制
    isTacticUnlocked: _isTacticUnlocked,
    setLeagueMatchActive: function (v) { _leagueMatchActive = v; },
    TACTIC_IDS: TACTIC_IDS,
    // SN-02 シーズン目標/信頼度
    ensureSeasonGoal: _ensureSeasonGoal,
    seasonGoalText: _seasonGoalText,
    goalMet: _goalMet,
    updateClubTrust: _updateClubTrust,
    settleSeason: _settleSeason,
    strengthRank: _strengthRank,
    GOAL_TUNING: GOAL_TUNING,
    // MG-05 人気
    updatePopularity: _updatePopularity,
    currentStreak: _currentStreak,
    myResultSeries: _myResultSeries,
    POPULARITY_TUNING: POPULARITY_TUNING,
    WEEK_SLOTS: WEEK_SLOTS,
    WEEK_ACTION_DEFS: WEEK_ACTION_DEFS,   // ★ ここに1行足すだけでコマが増えることの検証に使う
    SAVE_VERSION: SAVE_VERSION,
    SEASON_TUNING: SEASON_TUNING,
    MANAGER_TUNING: MANAGER_TUNING
  };
  // 実況テキストログの表示/閉じる
  window.leagueShowLog = function () { _showMatchLog(); };
  window.leagueCloseLog = function () { var ov = document.getElementById('lg-log-ov'); if (ov) ov.parentNode.removeChild(ov); };
})();
