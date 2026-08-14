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

  /* 戦術 index → 保存用 id（players.js: TACTICS_POSSESSION=0 … TACTICS_FREE=4）。
   * ★ CATENACCIO / FREE は**古い名残の識別子**だが、players.js の定数名と揃っており、
   *   かつ**セーブに残るキー**なので改名しない（改名 = 既存セーブの習得戦術が失われる）。
   *   ユーザーに見える名前は常に t('tacticsNames') 側（守備重視 / バランス重視）を通す
   *   ＝ _tacticLabel が唯一の表示経路。ここのIDと表示名が違っていても正常。 */
  var TACTIC_IDS = ['POSSESSION', 'PRESS', 'COUNTER', 'CATENACCIO', 'FREE'];

  var MANAGER_TUNING = {
    START: 20,          // 全 param の初期値（新米監督・難易度は作らないので個体差なし）
    CAP: 100,
    TRUST_START: 50,    // クラブからの信頼度の初期値（SN-02 で運用）
    // 成長の base（設計書 §1.2）。実際の増分は gain = base × (1 - param/CAP) ＝ 上限付き逓減。
    GROWTH: {
      MATCH_ALL: 0.4,   // 試合を1つ指揮（結果不問）＝全 param 微増
      WIN: 1.0,         // 勝利 → tactical / motivator
      TACTIC: 1.0,      // 戦術勉強 → tactical（＋習得ゲージ）
      RECOVERY: 1.2,    // 回復日 → conditioning（設計 §1.2 の「休養」）
      TRAINING: 0.8,    // 個人練習 → analysis（選手を見る目）
      SPEECH: 1.5,      // 話術勉強 → motivator（MG-15・2026-07-23 名称確定）
      SCIENCE: 1.5      // スポーツ科学 → conditioning（同上）
    },
    // ★ MATCH_ALL（指揮しただけの微増）を効かせる param。
    //   popularity は入れない＝人気は「結果で上下する双方向 param」で、試合をこなすだけでは上がらない（MG-05）。
    MATCH_ALL_PARAMS: ['tactical', 'analysis', 'motivator', 'conditioning'],
    // 🎯 個人練習で選手の「武器」が伸びる量の base（gain = base×(1-v/99) の逓減）。
    //   目安: 95の選手 ≈ +0.1/週（ほぼ伸びない）／70の選手 ≈ +0.7/週。
    //   ⚠️ 成長は persistent＝マルチシーズンの能力インフレに直結するので SN-10 の KPI 計測対象。
    TRAIN_BASE: 2.5,
    /* ★ 2026-08-04 ユーザー判断で「攻め筋に対策する」機能（📹ビデオ学習 / HTコーチ助言）を廃止。
     *   同時に対策 buff の定数（BUFF_MAX）と成長源 GROWTH.VIDEO も撤去した。
     *   理由: 効果が 5%×戦術眼/100（初期値で +1%）＝4000試合の実測で有無の差 0.00pt と、
     *   プレイヤーには原理的に観測できなかった。かつ実サッカーの感覚とも食い違う。 */
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

  /* SN-04/SN-05 再契約・移籍オファー・解任（設計書 §3.2/§3.3・MG-15 の役割分担で確定）。
   * ★ 解任は clubTrust（信頼度）だけで判定＝人気は混ぜない（POP_GRACE 破棄済み）。
   * ★ オファーの門戸は popularity だけで決まる＝高いほど上位クラブから声がかかる。
   * ★ すべて決定論（戦力順位と人気しきい値のみ・rng 不使用）。
   * ⚠️ しきい値は暫定＝SN-10 の KPI（解任頻度・オファー分布）で判定する。 */
  var CONTRACT_TUNING = {
    TRUST_SACK_THRESHOLD: 35,   // 未達 かつ 信頼がこれ未満 → 解任
    OFFER_POP_HIGH: 60,         // 人気がこれ以上 → 上位クラブも候補に入る
    OFFER_POP_MID: 30,          // これ以上 → 中位クラブまで／未満 → 下位のみ（救済1件保証）
    OFFER_MAX: 3,               // 提示するオファーの最大数
    // ── SN-08c 年俸（2026-07-26 新設・シーズン前「オファー年俸」の土台）──
    //   単位は万円/年。クラブの戦力と監督の人気・信頼から決定論で決まる（rng 不使用）。
    //   ゲーム内の通貨であって実在クラブの実額ではない（クラブ自体が仮＝FN-01）。
    SALARY_BASE: 3000,
    SALARY_PER_STRENGTH: 220,   // クラブ戦力（上位11平均）1 あたり
    SALARY_PER_POP: 40,         // 監督の人気 1 あたり
    SALARY_PER_TRUST: 16,       // 現クラブ残留時のみ効く（積み上げた信頼が待遇に乗る）
    SALARY_STEP: 50,            // 提示額の刻み
    SALARY_MIN: 1200, SALARY_MAX: 15000
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
   * このキーは squads（成長 delta / 怪我・停止の残り週 / 出場・得点記録）の**保存キー**なので、
   * 値が動くと保存済みデータが**エラーも出さずに丸ごと迷子になる**（= 静かなデータ消失）。
   * ✅ 2026-07-30（FN-00・DECISIONS 2026-07-30）: 表示名インダイレクション層 js/names.js を導入。
   *   架空化しても内部ID（＝起動時の long_name）は据え置きなので、このキーは**永久に不変**。
   *   NAMES があれば「いま表示中の（架空）名 → 内部ID」へ逆引きしてから返す。
   *   NAMES 不在（公開ビルド）では従来どおり long_name||name＝挙動不変。 */
  function _playerKey(p) {
    if (!p) return '';
    if (typeof NAMES !== 'undefined' && NAMES && NAMES.playerId) return NAMES.playerId(p);
    return (p.long_name || p.name) || '';
  }

  /* 保存済みの選手キー（内部ID）→ 画面に出す表示名。架空化ONなら架空名になる。
   * ★ セーブやランキングに積まれた「キー」をそのまま表示すると実名が漏れる。 */
  function _keyDisplayName(key) {
    if (typeof NAMES !== 'undefined' && NAMES && NAMES.displayName) {
      return NAMES.displayName(key) || key;
    }
    return key;
  }

  /* 表示名（p.name）→ squads のキー（_playerKey = long_name||name）を引く。
   * ★ MOM や得点者は p.name で記録されるので、そのまま _squadEntry に渡すと
   *   別キーの幽霊エントリが生まれ、変更が誰にも当たらない（PC-01 実装時に踏んだ）。
   *   見つからなければ与えられた名前をそのまま返す（既にキー形式のケース）。 */
  function _squadKeyByName(clubId, name) {
    var td = _clubData(clubId);
    if (td && td.players) {
      for (var i = 0; i < td.players.length; i++) {
        var p = td.players[i];
        if (p.name === name || _playerKey(p) === name) return _playerKey(p);
      }
    }
    return name;
  }

  function _defaultManager(clubId, season) {
    var S = MANAGER_TUNING.START;
    return {
      name: null,
      age: null,                 // 年齢概念（案D）は SN-08 で使用。null=年齢なし運用でも動く
      params: { tactical: S, analysis: S, motivator: S, conditioning: S, popularity: S },
      // MG-04: 初期は「バランス重視」のみ（2026-07-22 ユーザー決定）。
      //   ★ バランス重視(FREE) は learnedTactics に入れない＝常時開放の扱い（_isTacticUnlocked）。
      //   つまり新米監督は無策のベースラインだけを持って始まり、4戦術は全て勉強で解放する。
      learnedTactics: [],
      tacticProgress: {},                              // 習得ゲージ 0-100（勉強した戦術から生える）
      // MG-06: MVP の分析／フィジカルコーチは標準スタッフ。mental/scout は将来の雇用枠。
      coaches: { analysis: 1, physical: 1, mental: 0, scout: 0 },  // 0=未雇用
      clubTrust: MANAGER_TUNING.TRUST_START,
      seasonGoal: null,          // SN-02 が開幕時に設定（{type:'table_pos',target:n}）
      tenure: { clubId: clubId || null, sinceSeason: season || 1 }
    };
  }

  /* MG-06 導入前の v4 セーブでは physical=0 が固定値だった（雇用UIも効果も未実装）。
   * プレイヤーの選択を上書きする値ではないため、標準スタッフ2名だけを欠落補完と同じ扱いで生やす。 */
  function _ensureCoreCoaches(manager) {
    if (!manager) return false;
    var changed = false;
    if (!manager.coaches) { manager.coaches = {}; changed = true; }
    ['analysis', 'physical'].forEach(function (kind) {
      if (!(manager.coaches[kind] > 0)) { manager.coaches[kind] = 1; changed = true; }
    });
    ['mental', 'scout'].forEach(function (kind) {
      if (typeof manager.coaches[kind] !== 'number') { manager.coaches[kind] = 0; changed = true; }
    });
    return changed;
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
      apps: 0, goals: 0, assists: 0,  // シーズン統計（RW-02・成長入力）
      minutes: 0                      // 総出場時間（分・SN-08b／自クラブの対話モード試合のみ加算）
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

  /* ── SN-08a 年齢モデル（2026-07-26 新設・シーズン終了「新人賞（23歳以下）」の土台）────
   * 本作の選手データは生年月日を持たない。年齢は「選手キーから決まる基準年齢 ＋ 経過シーズン」で
   * 決定論的に導く＝保存不要・どの端末でも同一・周回するたび必ず1つ増える。
   * ★ これはゲーム内の年齢であって実在選手の実年齢ではない（クラブ自体が仮＝FN-01 で差し替わる）。
   * ★ squads[].age に明示値があればそちらを優先＝将来の新人生成／移籍加入の入口を塞がない。 */
  var AGE_TUNING = { MIN: 18, PEAK_MAX: 33, CAP: 38, U23: 23 };
  function _hash32(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  function _baseAge(playerKey) {
    var h = _hash32('age|' + playerKey);
    // 三角分布（一様2つの平均）＝中央（26前後）が厚く両端が薄い、自然な年齢構成になる
    var a = (h % 1024) / 1024, b = ((h >>> 11) % 1024) / 1024;
    return AGE_TUNING.MIN + Math.round(((a + b) / 2) * (AGE_TUNING.PEAK_MAX - AGE_TUNING.MIN));
  }
  /* ── SN-08a 成長／soft衰えのチューニング（設計書 §4・案C＝引退なし）──────────
   * 完全決定論（rng 不使用）＝ seed 再現を壊さない。入力は「年齢」と「今季の出場数」だけ。
   * ★ 設計書 §4.1 からの意図的な差分（inflation を防ぐため）:
   *   ①伸びの正規化を (PEAK-age)/PEAK → (PEAK-age)/(PEAK-MIN) に変更＝18歳で係数1.0になる
   *     （原式だと 18歳でも 0.33 にしかならず、若手が伸びる実感が出ない）。
   *   ②**衰えには出場係数を掛けない**。原式のまま playFactor を掛けると「ベンチのベテランは
   *     永遠に衰えない」＝母集団の param 総和が上がり続ける（§4.2 の中立性が壊れる）。
   *     歳は出番に関係なく取る、が実サッカーにも合う。
   *   ③伸びにも下限 PLAY_FLOOR を置く＝出番の少ない若手も練習で少しは伸びる（MG-10 練習指示が
   *     入ったらこの下限を練習量に置き換える差し込み口）。
   * ★ 重みは「実サッカーで先に落ちるもの／歳でも落ちないもの」。スピード系から落ち、
   *   ポジショニング・メンタリティ（経験）は落ちない。伸びは技術・判断が大きい。 */
  var GROWTH_TUNING = {
    PEAK: 27,            // 全盛期。ここを境に伸び→衰えへ反転
    PEAK_GK: 30,         // GK は経験がものを言うので遅い（実サッカー準拠）
    GROW: 3.4,           // 18歳・フル出場時の伸び基準値（重み1.0の param に対する点数）
    DECL: 2.5,           // CAP(38)歳時の衰え基準値（同上）
    PLAY_FLOOR: 0.25,    // 出場ゼロでも伸びる下限（＝練習ぶん）
    MAX_STEP: 4,         // 1季1param あたりの変化上限（暴走防止）
    /* ★ 累積の上限／下限（1param あたり・base からの総変化）。
     * これが無いと**リーグが際限なく劣化する**: SN-08a は引退も新人 regen も無い（案C）ので
     * 母集団は毎季そろって1歳ずつ old になる。衰えが青天井だと 10季で平均 param -7% まで落ち、
     * 設計書 §4.2 の「母集団中立」が原理的に成立しない（中立は regen があって初めて成り立つ）。
     * 累積を挟めば衰えは頭打ちになり、リーグは「少し下がって平らになる」＝壊れない。
     * ⚠️ 恒久解＝ SN-08b（引退＋regen で年齢構成を定常化）。ここは v1.0 までの安全弁。 */
    TOTAL_GROW: 10,      // 1param あたり最大 +10（若手の伸びしろ）★選手ごとの素質で上下する
    TOTAL_DECL: 8,       // 1param あたり最大 -8（ベテランの落ち幅）★同上
    // 伸びの重み（若手）: 技術・判断が大きく、素の速さは伸びにくい
    GROW_W: {
      0: 1.0, 1: 1.0, 2: 0.7, 3: 0.7, 4: 0.8, 5: 0.9, 6: 0.8,
      7: 1.3, 8: 1.0, 9: 1.3, 10: 1.3, 11: 1.3, 12: 1.3, 13: 1.2, 14: 1.2, 15: 1.2, 16: 1.3,
      17: 1.2, 18: 1.2, 19: 1.2, 20: 1.2, 21: 1.2, 22: 1.0,
      23: 1.3, 24: 1.3, 25: 1.0, 26: 1.4, 27: 1.4, 28: 0.3
    },
    // 衰えの重み（ベテラン）: スピード系から落ちる。経験系（26/27）は落ちない
    DECL_W: {
      0: 0.8, 1: 1.5, 2: 2.0, 3: 1.9, 4: 1.2, 5: 1.4, 6: 1.6,
      7: 0.8, 8: 1.5, 9: 0.3, 10: 0.3, 11: 0.5, 12: 0.5, 13: 0.5, 14: 0.2, 15: 0.2, 16: 0.4,
      17: 0.6, 18: 0.6, 19: 0.7, 20: 0.6, 21: 0.5, 22: 1.3,
      23: 0.6, 24: 0.7, 25: 0.8, 26: 0, 27: 0, 28: 0
    }
  };
  // GK は 6 値だけが意味を持つ（他は 50 固定）。固定値を動かしても効果ゼロで表示だけ濁るので触らない。
  var GK_PARAM_IDX = { 4: 1, 5: 1, 10: 1, 23: 1, 24: 1, 26: 1 };
  // 逆にフィールド選手の セービング/ハイボール処理 は GK 専用の枠＝50 固定。こちらも動かさない。
  var GK_ONLY_IDX = { 23: 1, 24: 1 };
  function _isGK(p) { return !!(p && p.positions && p.positions[0] === 'GK'); }

  /* ===========================================================================
   * SN-08a 素質（Talent）— 選手ごとの成長のばらつき（2026-07-30 ユーザー要望）
   * ---------------------------------------------------------------------------
   * 「早熟だった／晩成だった」「あいつは30を超えても衰えない」という物語を作るための
   * **隠しパラメータ**。画面には一切出さない＝監督は「オフの変化」を何季も見て初めて
   * 「こいつは伸びる」と気づく（＝発見が面白さになる。将来スカウトコーチ MG-11 で覗ける）。
   *
   * ★ 保存しない: 年齢と同じく **選手キー（FN-00 の内部ID）のハッシュから決定論**で導く。
   *   セーブは1バイトも増えず、架空名に切り替えても同じ選手は同じ素質のまま。
   * ★ 3つのダイヤル:
   *   ①型（早熟/標準/晩成）… ピーク年齢のずれ＋伸びの速さ
   *   ②ポテンシャル      … どこまで伸びるか（1param あたりの累積上限）
   *   ③衰え耐性          … 落ちる速さと落ちきる深さ（小さいほど長持ち＝"30超えても衰えない"）
   * ★ 分布は三角分布（一様2つの平均）＝平均的な選手が厚く、突き抜けた才能は稀。
   *   平均が GROWTH_TUNING の既定値に一致するよう中心を置いている（母集団のインフレ防止）。 */
  var TALENT_TUNING = {
    // 型。w=出現比率。peakShift はピーク年齢のずれ、growMul は伸びの速さ、declMul は衰えの速さ。
    ARCHETYPES: [
      { id: 'early',  ja: '早熟', en: 'Early bloomer', w: 20, peakShift: -2, growMul: 1.40, declMul: 1.10 },
      { id: 'normal', ja: '標準', en: 'Normal',        w: 55, peakShift:  0, growMul: 1.00, declMul: 1.00 },
      { id: 'late',   ja: '晩成', en: 'Late bloomer',  w: 25, peakShift: +3, growMul: 0.70, declMul: 0.85 }
    ],
    POT_MIN: 3, POT_MAX: 17,       // ポテンシャル（累積上限）。平均10＝GROWTH_TUNING.TOTAL_GROW と一致
    RES_MIN: 0.55, RES_MAX: 1.45   // 衰え耐性。平均1.0＝素質なしと同じ。0.55＝衰えが半分以下
  };

  /* 特定選手の素質を手で固定したい時の口（mental.js の MENTAL_OVERRIDES と同じ作法）。
   * 例: TALENT_OVERRIDES['リオネル・メッシ'] = { arch:'late', pot:17, res:0.55 }
   * キーは **内部ID（＝起動時の long_name）**。空のままなら全員ハッシュ任せ。 */
  var TALENT_OVERRIDES = {};

  /* 三角分布の 0..1 を返す（中央が厚い）。salt でダイヤルごとに独立した系列にする。 */
  function _tri01(key, salt) {
    var h = _hash32(salt + '|' + key);
    var a = (h % 1024) / 1024, b = ((h >>> 11) % 1024) / 1024;
    return (a + b) / 2;
  }

  /* 選手の素質。playerKey（内部ID）だけで決まる＝完全決定論・保存不要。 */
  function _talentOf(p, gk) {
    var key = (typeof p === 'string') ? p : _playerKey(p);
    var T = TALENT_TUNING;
    var ov = TALENT_OVERRIDES[key] || null;

    // ①型: 出現比率つきの決定論抽選
    var arch = T.ARCHETYPES[1];
    if (ov && ov.arch) {
      for (var ai = 0; ai < T.ARCHETYPES.length; ai++) if (T.ARCHETYPES[ai].id === ov.arch) arch = T.ARCHETYPES[ai];
    } else {
      var total = 0, i;
      for (i = 0; i < T.ARCHETYPES.length; i++) total += T.ARCHETYPES[i].w;
      var roll = _hash32('talent/arch|' + key) % total, acc = 0;
      for (i = 0; i < T.ARCHETYPES.length; i++) {
        acc += T.ARCHETYPES[i].w;
        if (roll < acc) { arch = T.ARCHETYPES[i]; break; }
      }
    }
    // ②ポテンシャル ③衰え耐性
    var pot = (ov && typeof ov.pot === 'number') ? ov.pot
      : T.POT_MIN + _tri01(key, 'talent/pot') * (T.POT_MAX - T.POT_MIN);
    var res = (ov && typeof ov.res === 'number') ? ov.res
      : T.RES_MIN + _tri01(key, 'talent/res') * (T.RES_MAX - T.RES_MIN);

    var basePeak = gk ? GROWTH_TUNING.PEAK_GK : GROWTH_TUNING.PEAK;
    return {
      arch: arch.id, archJa: arch.ja, archEn: arch.en,
      peak: basePeak + arch.peakShift,
      growMul: arch.growMul,
      declMul: arch.declMul * res,                                   // 型 × 個体差
      pot: Math.round(pot * 10) / 10,                                // 伸びしろ（累積 +上限）
      // 落ちきる深さも耐性で変わる＝長持ちする選手は最終的な劣化も浅い
      floor: Math.round(GROWTH_TUNING.TOTAL_DECL * res * 10) / 10
    };
  }

  /* 1選手・1シーズンぶんの Δparam（疎オブジェクト）。rng 不使用＝同じ入力なら常に同じ結果。
   * ★ 素質（_talentOf）でピーク年齢と伸び/衰えの速さが選手ごとに変わる＝早熟・晩成が生まれる。 */
  function _agingDelta(p, age, apps, seasonMatches, talent) {
    var G = GROWTH_TUNING;
    var gk = _isGK(p);
    var tal = talent || _talentOf(p, gk);
    var peak = tal.peak;
    var out = {};
    if (age === peak) return out;
    var growing = age < peak;
    var mag;   // 基準変化量（正=伸び / 負=衰え）
    if (growing) {
      var span = Math.max(1, peak - AGE_TUNING.MIN);
      var play = G.PLAY_FLOOR + (1 - G.PLAY_FLOOR) * Math.min(1, (apps || 0) / Math.max(1, seasonMatches));
      mag = G.GROW * Math.max(0, (peak - age) / span) * play * tal.growMul;
    } else {
      var dspan = Math.max(1, AGE_TUNING.CAP - peak);
      // 出場係数は掛けない（上記②）。衰え耐性が低い選手＝30を超えても落ちにくい。
      mag = -G.DECL * Math.min(1, (age - peak) / dspan) * tal.declMul;
    }
    var W = growing ? G.GROW_W : G.DECL_W;
    var n = (p && p.params) ? p.params.length : 29;
    for (var i = 0; i < n; i++) {
      if (gk ? !GK_PARAM_IDX[i] : !!GK_ONLY_IDX[i]) continue;
      var w = (W[i] === undefined) ? 1 : W[i];
      if (!w) continue;
      var d = mag * w;
      if (d > G.MAX_STEP) d = G.MAX_STEP;
      if (d < -G.MAX_STEP) d = -G.MAX_STEP;
      d = Math.round(d * 100) / 100;                      // MG-13 と同じ小数精度で積む
      if (d) out[i] = d;
    }
    return out;
  }

  /* シーズン境界で1回だけ、全クラブ・全選手に成長/衰えを適用する（設計書 §4.1）。
   *   nextSquads … _carrySquads 済みの新シーズン squads（ここへ growth を積む）
   *   prevSquads … 終わったシーズンの squads（apps＝出場数の入力元）
   * 戻り = 自クラブぶんの変化サマリー（成長リザルト演出 MG-08/SN-03 が読む素材）。
   * ★ growth は「base param への persistent な加算」なので _overlaySquad が [1,99] に clamp する。
   * ★ squads に entry が無い＝一度も記録されていない選手にも適用する（控えも歳を取る）。 */

  /* growth 適用後の「総合」。物差しは _clubStrength と同じ **全 param の平均**＝
   * リーグ画面が既に使っている総合と揃う（simulate.js の calcStats は別スコープで見えない）。
   * ★ サマリーに出すのは param の総和ではなく総合の増減。総和は 27param ぶん積み上がって
   *   「+55.6」のような桁になり、プレイヤーには意味が読めない。 */
  function _overallWith(p, growth) {
    if (!p || !p.params) return 0;
    var s = 0;
    for (var i = 0; i < p.params.length; i++) {
      var v = p.params[i];
      var g = growth ? (growth[i] || growth[String(i)] || 0) : 0;
      s += Math.max(1, Math.min(99, v + g));
    }
    return s / p.params.length;
  }

  function _applySeasonAging(nextSquads, prevSquads, seasonMatches, myId) {
    var report = { grew: [], declined: [] };
    if (!nextSquads) return report;
    var ids = (_state && _state.clubs) ? _state.clubs : CLUB_DEFS.map(function (d) { return d.id; });
    for (var ci = 0; ci < ids.length; ci++) {
      var clubId = ids[ci];
      var td = _clubData(clubId);
      if (!td || !td.players) continue;
      var prevC = (prevSquads && prevSquads[clubId]) || {};
      for (var pi = 0; pi < td.players.length; pi++) {
        var p = td.players[pi];
        if (!p) continue;
        var pk = _playerKey(p);
        if (!pk) continue;
        var apps = (prevC[pk] && prevC[pk].apps) || 0;
        var age = _playerAge(clubId, pk);          // ★ 年齢は季から決定論で出る（保存しない）
        var tal = _talentOf(pk, _isGK(p));         // ★ 素質も同じく決定論（早熟/晩成・伸びしろ・耐性）
        var delta = _agingDelta(p, age, apps, seasonMatches, tal);
        var keys = Object.keys(delta);
        if (!keys.length) continue;
        if (!nextSquads[clubId]) nextSquads[clubId] = {};
        var e = nextSquads[clubId][pk] || (nextSquads[clubId][pk] = _defaultSquadEntry());
        if (!e.growth) e.growth = {};
        var ovBefore = (clubId === myId) ? _overallWith(p, e.growth) : 0;
        for (var ki = 0; ki < keys.length; ki++) {
          var idx = keys[ki];
          var before = e.growth[idx] || 0;
          // 累積の頭打ち。上限＝その選手のポテンシャル／下限＝耐性で決まる劣化の底（上の注記参照）
          var after = Math.max(-tal.floor, Math.min(tal.pot, before + delta[idx]));
          after = Math.round(after * 100) / 100;
          if (after) e.growth[idx] = after; else delete e.growth[idx];   // 0 は疎に戻す
        }
        if (clubId === myId) {
          // サマリーは「総合」の増減で出す（＝選手カードと同じ物差し・頭打ちぶんも自動で反映）
          var ovAfter = _overallWith(p, e.growth);
          var diff = Math.round((ovAfter - ovBefore) * 10) / 10;
          if (diff) {
            report[diff > 0 ? 'grew' : 'declined'].push({
              key: pk, name: _keyDisplayName(pk), age: age + 1,
              overall: Math.round(ovAfter), diff: diff
            });
          }
        }
      }
    }
    report.grew.sort(function (a, b) { return b.diff - a.diff; });
    report.declined.sort(function (a, b) { return a.diff - b.diff; });
    return report;
  }

  function _playerAge(clubId, playerKey) {
    var e = _peekSquadEntry(clubId, playerKey);
    if (e && typeof e.age === 'number') return e.age;
    var season = (_state && _state.season) ? _state.season : 1;
    return Math.min(AGE_TUNING.CAP, _baseAge(playerKey) + (season - 1));
  }

  /* ── SN-08b 出場時間（2026-07-26 新設・「選手別出場数（総出場時間）」の土台）──────
   * エンジンの時間単位は「チャンス」。simulate.js の stampSubTime が交代/退場の時点を
   * 選手へ刻むので、ここで 90 分へ写像して分に直す。刻みが無い＝フル出場（90分）。
   * ★ 記録するのは自クラブの対話モード試合だけ（相手/AI 同士は交代の刻みが取れないため）。 */
  function _matchMinutes(p, chances) {
    var total = (chances && chances.length) ? chances.length : 32;
    function mins(i) { return Math.max(0, Math.min(90, Math.round(90 * i / total))); }
    var on = (typeof p._onAtChance === 'number') ? mins(p._onAtChance) : 0;
    var off = (typeof p._offAtChance === 'number') ? mins(p._offAtChance) : 90;
    return Math.max(0, off - on);
  }

  /* ── オーバーレイ適用済みクラブデータ（§2.2） ─────────────────────────
   * ★ TEAM_DATA 本体は不変（single/WC モードと共有の不変ソース）。clone に対して
   *   ① growth を base param へ焼き込み（persistent な成長）
   *   ② injuryOut/suspendOut>0 の選手を先発から除外（詰み防止つき）
   * を適用して返す。1試合あたり数クラブ分の clone なのでコストは無視できる。 */
  function _overlaySquad(clubId, opts) {
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

    // ★ keepAbsent（ユーザーのチーム＝設定画面用）: 前節の布陣（＝クラブ既定の正しい配置）を
    //   そのまま維持し、欠場者もその位置に残す。設定画面でグレー表示＋キックオフ時に警告で止める。
    //   相手AI・他会場（監督がいない）は従来どおり自動除外＝合法布陣で戦わせる。
    //   ただし出場可能者が11人未満なら詰むので、その時だけ従来の補充ロジックに戻す。
    if (opts && opts.keepAbsent) {
      var raw = (src.default_lineup || []).slice();
      var availCount = 0;
      for (var ri = 0; ri < td.players.length; ri++) if (!unavailable[ri]) availCount++;
      td.default_lineup = (availCount >= 11) ? raw : _availableLineup(src, td, unavailable, clubId);
    } else {
      td.default_lineup = _availableLineup(src, td, unavailable, clubId);
    }
    return td;
  }

  /* 欠場者を除いた lineup を組む（AI・他会場用。ユーザーのチームは keepAbsent で不使用）。
   * ★ 欠場枠は「その枠のポジションに合う・出場可能な最良の選手」で埋める（適性→能力の順）。
   *   旧実装は default_lineup を順に詰めるだけで、穴をロスター先頭の出場可能者で埋めていた
   *   ＝守備的MF がCFに入る等、配置が崩れた（2026-07-24 ユーザー指摘）。位置を保ったまま
   *   適性重視で補充することで、相手AIの布陣が自然になる。
   * 詰み防止: それでも埋まらない（出場可能者が11人未満）なら欠場残り節数を0にして復帰。 */
  function _availableLineup(src, td, unavailable, clubId) {
    var base = (src.default_lineup || []).slice();
    var total = td.players.length;

    // フォーメーション各枠のポジション名（適性マッチ用）
    var posNames = null;
    if (typeof system_data !== 'undefined') {
      for (var si = 0; si < system_data.length; si++) {
        if (system_data[si].name === src.default_system) { posNames = system_data[si].positions; break; }
      }
    }
    function _strength(pl) {
      if (!pl || !pl.params || !pl.params.length) return 0;
      var s = 0; for (var k = 0; k < pl.params.length; k++) s += pl.params[k];
      return s / pl.params.length;
    }
    function _fits(pl, posName) {
      if (!pl || !pl.positions || !posName) return false;
      if (pl.positions.indexOf(posName) >= 0) return true;
      var b = (posName.charAt(0) === '左' || posName.charAt(0) === '右') ? posName.slice(1) : posName;
      return b !== posName && pl.positions.indexOf(b) >= 0;
    }
    function _bestFor(posName) {   // 適性(+1000)優先、次に能力平均の高い順
      var best = -1, bestScore = -1;
      for (var i = 0; i < total; i++) {
        if (used[i] || unavailable[i]) continue;
        var score = (_fits(td.players[i], posName) ? 1000 : 0) + _strength(td.players[i]);
        if (score > bestScore) { bestScore = score; best = i; }
      }
      return best;
    }

    var used = {};
    var lineup = base.slice(0, 11);   // 既定の11枠（位置を保つ）
    // ① 出場可能な既定スタメンは自分の枠にそのまま残す（欠場枠は null で穴あけ）
    for (var p = 0; p < 11; p++) {
      var idx = lineup[p];
      if (idx != null && !unavailable[idx]) used[idx] = true; else lineup[p] = null;
    }
    // ② 欠場枠を「その枠のポジションに合う・出場可能な最良の選手」で埋める
    for (var pos = 0; pos < 11; pos++) {
      if (lineup[pos] != null) continue;
      var repl = _bestFor(posNames ? posNames[pos] : null);
      if (repl >= 0) { lineup[pos] = repl; used[repl] = true; }
    }
    // ③ 詰み防止: まだ穴（＝出場可能者が11人未満）→ 欠場を軽い順に強制復帰して埋める
    var holes = 0; for (var h = 0; h < 11; h++) if (lineup[h] == null) holes++;
    if (holes > 0) {
      var outs = [];
      for (var i3 = 0; i3 < total; i3++) {
        if (!unavailable[i3] || used[i3]) continue;
        var e = _peekSquadEntry(clubId, _playerKey(td.players[i3]));
        outs.push({ idx: i3, rest: e ? ((e.injuryOut || 0) + (e.suspendOut || 0)) : 0, entry: e });
      }
      outs.sort(function (a, b2) { return a.rest - b2.rest; });   // 残りが短い＝軽い順に復帰
      var oi = 0;
      for (var pos2 = 0; pos2 < 11 && oi < outs.length; pos2++) {
        if (lineup[pos2] != null) continue;
        var pick = outs[oi++];
        if (pick.entry) { pick.entry.injuryOut = 0; pick.entry.suspendOut = 0; }
        lineup[pos2] = pick.idx; used[pick.idx] = true;
      }
    }
    // ④ ベンチ（12人目以降）＝残りの出場可能な選手を default_lineup 順に積む（欠場者は入れない）
    var out = lineup.slice();
    var size = Math.max(base.length, 11);
    for (var i4 = 0; i4 < base.length && out.length < size; i4++) {
      var b4 = base[i4]; if (b4 != null && !unavailable[b4] && !used[b4]) { used[b4] = true; out.push(b4); }
    }
    for (var i5 = 0; i5 < total && out.length < size; i5++) {
      if (!unavailable[i5] && !used[i5]) { used[i5] = true; out.push(i5); }
    }
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
      if (appeared[idx] || p._injured || p._sentOff) {
        e.apps++;
        // SN-08b 総出場時間。交代の刻みが取れるのは対話モードの自クラブだけ（useSubbedOff）。
        if (useSubbedOff) {
          var _chs = (typeof chanceResults !== 'undefined') ? chanceResults : null;
          e.minutes = (e.minutes || 0) + _matchMinutes(p, _chs);
        }
      }

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
   * 「今日は何をするか」の決断を1日1回。例:
   *   📖 戦術勉強   … 未習得戦術の習得ゲージを進める（100 で解放＝MG-04 が使う）
   * ★ 決定論のみ＝ rng を新規消費しない。
   * ★ 2026-08-04: 「攻め筋に対策する」系（📹ビデオ学習）は廃止。攻め筋は**偵察で知る情報**
   *   としてのみ残り、試合内の係数フックは持たない（＝エンジンへの介入は無し）。
   * ========================================================================= */

  // 攻め筋 → 参照する param（getActionParam の攻撃側の式に合わせる）。偵察で見せるのはこの6本。
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

  /* 戦術の表示名は **ゲーム本体の i18n をそのまま引く**（players.js の tacticsNames）。
   * ★ ここで独自の呼び名を持つと戦術選択画面と食い違う（実際に「フリー」vs「バランス重視」、
   *   「カテナチオ」vs「守備重視」でズレていた・2026-07-22 に発覚して修正）。
   *   表示名は1箇所に集約し、league 側は index を介して引くだけにする。 */
  function _tacticLabel(id) {
    var i = TACTIC_IDS.indexOf(id);
    if (i < 0) return id;
    var names = (typeof t === 'function') ? t('tacticsNames') : null;
    return (names && names[i]) || (typeof TACTICS_NAMES !== 'undefined' ? TACTICS_NAMES[i] : id);
  }

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

  /* MG-06 分析コーチ。試合エンジンの結果を読み取って表示文へ変換するだけで、
   * デュエル判定・カウント・能力値・rng には一切触れない。
   * analysis パラメータによる精度差は MG-15 の収益化判断待ちなので、MVP は固定品質。 */
  function _matchupConcern(completed, myTeam) {
    var scenes = completed && completed.scenes;
    if (!scenes || !myTeam) return null;
    var worst = null;
    for (var i = 0; i < scenes.length; i++) {
      var sc = scenes[i]; if (!sc) continue;
      var player = null, gap = 0, lost = false;
      if (sc.offence === myTeam) {
        lost = (sc.result === '失敗' || sc.result === 'カウンター');
        gap = Number(sc.dfsPoint) - Number(sc.ofsPoint);
        if (lost && sc.offence.players && sc.offence.lineup) player = sc.offence.players[sc.offence.lineup[sc.ofsPos]];
      } else if (sc.defence === myTeam) {
        lost = (sc.result === '成功');
        gap = Number(sc.ofsPoint) - Number(sc.dfsPoint);
        if (lost && sc.defence.players && sc.defence.lineup) player = sc.defence.players[sc.defence.lineup[sc.dfsPos]];
      }
      if (player && gap >= 5 && (!worst || gap > worst.gap)) worst = { player: player, gap: gap };
    }
    return worst;
  }

  function _analysisCoachCard(kind, subject, completed, myTeam) {
    var concern = _matchupConcern(completed, myTeam);
    var label = _t('分析コーチ｜LIVE', 'Analysis Coach | LIVE');
    if (concern) {
      var concernName = (typeof getPlayerName === 'function') ? getPlayerName(concern.player) : concern.player.name;
      return { icon: '🧑‍💻', label: label,
        body: _t('<b>' + _escHtml(concernName) + '</b> 選手がマッチアップで後手に回っています。次の采配停止点で役割を見直しましょう。',
          '<b>' + _escHtml(concernName) + '</b> is losing an unfavourable matchup. Reassess the role at the next coaching stop.') };
    }
    if (!subject) return null;
    var name = (typeof getPlayerName === 'function') ? getPlayerName(subject) : subject.name;
    if (kind === 'opponent_focus') {
      return { icon: '🧑‍💻', label: label,
        body: _t('相手は <b>' + _escHtml(name) + '</b> 選手を攻撃の起点にしています。',
          'The opponent is building through <b>' + _escHtml(name) + '</b>.') };
    }
    return { icon: '🧑‍💻', label: label,
      body: _t('<b>' + _escHtml(name) + '</b> 選手へのマークが厳しくなっています。',
        '<b>' + _escHtml(name) + '</b> is being marked tightly.') };
  }

  window.leagueAnalysisCoachCard = function (kind, subject, completed, myTeam) {
    if (!_leagueMatchActive || !_state || !_state.manager ||
        !_state.manager.coaches || !(_state.manager.coaches.analysis > 0)) return null;
    return _analysisCoachCard(kind, subject, completed, myTeam);
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
   *   autoFill  1,2,3...       … おまかせの残り枠を埋める順（小さいほど先・足りなければ巡回）
   *
   * ⚠️ 各コマの**効果の大きさ・種類はまだ検討中**（BACKLOG MG-13）。数値は MANAGER_TUNING に
   *   集約してあるので、チューニングはこの表と定数だけを触れば済む。 */
  var WEEK_ACTION_DEFS = [
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
      // MG-15（2026-07-23 名称確定）: 監督の自己研磨コマ＝「戦術勉強」の姉妹。人を動かす言葉を磨く。
      //   効果配線は motivator の成長のみ（喝=PS-06 が入った時に初めて意味を持つ＝1param 1効果）。
      kind: 'speech_study', icon: '🗣️', ja: '話術勉強', en: 'Speech study',
      grow: { param: 'motivator', base: 'SPEECH' },
      autoFill: 2,
      text: function () { return _t('選手を動かす言葉を磨く', 'Sharpen the words that move players'); }
    },
    {
      // MG-15（2026-07-23 名称確定）: フィジカル管理の自己研磨。回復・疲労・コンディションの科学。
      kind: 'sports_science', icon: '🧪', ja: 'スポーツ科学', en: 'Sports science',
      grow: { param: 'conditioning', base: 'SCIENCE' },
      autoFill: 3,
      text: function () { return _t('回復と疲労の科学を学ぶ', 'Study recovery and fatigue science'); }
    },
    {
      kind: 'individual_training', icon: '🎯', ja: '個人練習', en: 'Individual training',
      grow: { param: 'analysis', base: 'TRAINING' },
      autoFill: 1,
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

  /* 相手の攻め筋を「実際の強さ（能力値）」の高い順に、詳細つきで並べる。
   *   val  = その攻め筋を担う先発の平均能力（実際の“強さ”）
   *   rel  = リーグ平均比（参考。＋なら平均より得意）
   *   pct  = 表示バーの割合（0..1）。このチームの6つの中で min→max を 0..1 に伸ばす
   *          ＝「このチームがどの攻め筋にどれだけ寄っているか」が読める weight
   * ★ 以前は rel（リーグ平均比）順だった。だが強豪バランス型（例ブラジル）は全項目が
   *   平均以下で順位が無意味になり、アルゼンチンは能力81のショートパスより75のクロスが
   *   上位に来て直感と食い違った。実際に封じるべきは“実際に強い攻め筋”なので val 順にした。
   * ★ 偵察レポートの表示順はこの val 順（順位とバーが必ず一致）。 */
  function _opponentThreatsRanked(oppId) {
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
      scored.push({
        id: THREAT_ACTIONS[a2].id,
        val: mine[a2],
        rel: mean ? (mine[a2] - mean) / mean : 0,
        ord: a2
      });
    }
    // 実際の強さ（val）の高い順。同値は THREAT_ACTIONS の並び順で決着＝決定論（rng 不使用）
    scored.sort(function (x, y) { return (y.val - x.val) || (x.ord - y.ord); });
    // バー割合＝このチーム内で min→max を 0..1 に伸ばす（尖りを可視化）。最小でも少し見せる。
    var hi = scored[0] ? scored[0].val : 0;
    var lo = scored[scored.length - 1] ? scored[scored.length - 1].val : 0;
    var span = Math.max(1, hi - lo);
    scored.forEach(function (s) { s.pct = 0.14 + 0.86 * ((s.val - lo) / span); });
    return scored;
  }
  function _opponentThreats(oppId) {
    return _opponentThreatsRanked(oppId).map(function (s) { return s.id; });
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
    /* ★ 旧セーブ互換: 廃止された種類（例 2026-08-04 に消した 'video_study'）が残っていても
     *   壊れない。定義表に無い kind は **空きスロット扱い**にして捨てる（例外は出さない・
     *   セーブ版数は上げない＝欠落補完と同じ扱い）。 */
    for (var i = 0; i < pa.slots.length; i++) {
      var s = pa.slots[i];
      if (s && !_weekActionDef(s.kind)) pa.slots[i] = null;
    }
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
      if (e.injuryOut > 0) out.push({ name: td.players[i].name, key: _playerKey(td.players[i]), weeks: e.injuryOut, kind: 'injury' });
      else if (e.suspendOut > 0) out.push({ name: td.players[i].name, key: _playerKey(td.players[i]), weeks: e.suspendOut, kind: 'suspend' });
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

  /* 「おまかせ」＝ def の autoOnce を配列順に1コマずつ入れ、残りを autoFill 順で埋める。
   * 惰性プレイでも1日1回が成立するように（毎回3枠を悩ませない）。
   * ★ 新しいコマを増やす時は def に autoOnce / autoFill を書けばここへ自動で参加する。
   * ★ 2026-08-04: 埋め先だった 📹ビデオ学習 の廃止に伴い、埋め方を決定論の優先順に組み直した。
   *   ①必要なら回復日 → ②戦術勉強（autoOnce・配列順）→ 残りを autoFill の小さい順
   *   （🎯個人練習 → 🗣️話術勉強 → 🧪スポーツ科学）。枠が余れば同じ順を先頭から巡回する
   *   ＝**全枠が必ず埋まる**。rng は使わない（同じ状況なら常に同じ答え）。 */
  function _autoWeek() {
    if (!_state || _state.finished) return;
    var ctx = _weekCtx(); if (!ctx) return;
    var pa = _ensureWeek();
    var plan = [];
    WEEK_ACTION_DEFS.forEach(function (d) {
      if (plan.length >= WEEK_SLOTS) return;
      if (d.autoOnce && d.autoOnce(ctx)) plan.push(d.kind);
    });
    // 残り枠の埋め順（autoFill 昇順・同値は定義表の並び順で決着＝安定ソート相当の決定論）
    var fillers = WEEK_ACTION_DEFS
      .map(function (d, i) { return { d: d, i: i }; })
      .filter(function (x) { return typeof x.d.autoFill === 'number' && (!x.d.enabled || x.d.enabled(ctx)); })
      .sort(function (a, b) { return (a.d.autoFill - b.d.autoFill) || (a.i - b.i); })
      .map(function (x) { return x.d.kind; });
    for (var fi = 0; plan.length < WEEK_SLOTS && fillers.length; fi++) plan.push(fillers[fi % fillers.length]);
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
   * BX — ベストイレブン（2026-07-23 ユーザー指示）
   * ---------------------------------------------------------------------------
   * ①1節ごと: 全4試合の選手評価点から GK1/DF3/MF4/FW3（3-4-3型）を選出（サッカー専門誌風）。
   * ②シーズン終了時: 通年平均からリーグ協会がベストイレブンを発表（公式発表風）。
   * ★ 評価点は確定済みシーン列から決定論で算出（rng 不使用・エンジン不変）。
   * ★ 通年集計は seasonMeta.playerRatings に持つ（欠落補完の任意フィールド＝改定なし・季ごとにリセット）。
   * ========================================================================= */
  var BESTXI_TUNING = {
    BASE: 6.0,                 // 出場のベース点
    OFF_WIN: 0.25, OFF_LOSE: -0.15,   // デュエル勝ち/負け（攻撃側）
    DEF_WIN: 0.25, DEF_LOSE: -0.15,   // 同（守備側）
    GOAL: 1.2, ASSIST: 0.7,    // 得点/アシスト
    FOUL: -0.3, FOUL_WON: 0.1, // ファールを犯した/受けた
    GK_SAVE: 0.5, GK_CONCEDE: -0.4,   // GKセーブ/失点
    CLEAN_SHEET: 0.6,          // 無失点（GK と DF 全員）
    TEAM_WIN: 0.2,             // 勝利チーム全員
    MIN: 4.0, MAX: 10.0,
    SEASON_MIN_APPS: 7         // シーズン選出の最低出場数（14節の半分）
  };
  // ベストイレブンの配分（2026-07-24 ユーザー指定＝3-4-3型）。合計11。
  var BESTXI_FORMATION = { GK: 1, DF: 3, MF: 4, FW: 3 };

  // ポジション種別 → GK/DF/MF/FW（system_data の positions から左右を剥いだもの）
  function _posGroup(postype) {
    if (postype === 'GK') return 'GK';
    if (postype === 'CB' || postype === 'SB' || postype === 'SW') return 'DF';
    if (postype === 'DMF' || postype === 'CMF' || postype === 'OMF' || postype === 'SMF') return 'MF';
    return 'FW';   // CF / WG
  }

  /* 1試合ぶんの選手評価点（両チーム）。シーン列を読むだけ＝決定論。
   * 戻り値: { clubId: { playerKey: {name, group, rating, goals, assists} } } */
  function _rateMatch(t1, t2, crs, id1, id2) {
    var out = {};
    out[id1] = {}; out[id2] = {};
    var acc = {};   // "clubId|key" → {p, team, pos, delta, goals, assists}

    function _ent(clubId, team, pos) {
      var p = team.players[team.lineup[pos]];
      if (!p) return null;
      var k = clubId + '|' + _playerKey(p);
      if (!acc[k]) acc[k] = { clubId: clubId, name: p.name, key: _playerKey(p), pos: pos, team: team, delta: 0, goals: 0, assists: 0 };
      return acc[k];
    }
    function _idOf(team) { return _sameTeam(team, t1) ? id1 : id2; }

    // 先発11人は出場ベース点を必ず持つ（シーンに絡まなくても選出対象になる）
    [[t1, id1], [t2, id2]].forEach(function (ti) {
      for (var pos = 0; pos < 11; pos++) _ent(ti[1], ti[0], pos);
    });

    var B = BESTXI_TUNING;
    (crs || []).forEach(function (cr) {
      (cr.scenes || []).forEach(function (sc) {
        if (!sc || !sc.offence || !sc.defence) return;
        var off = _ent(_idOf(sc.offence), sc.offence, sc.ofsPos);
        var def = _ent(_idOf(sc.defence), sc.defence, sc.dfsPos);
        var gk = _ent(_idOf(sc.defence), sc.defence, 0);
        var r = sc.result;
        if (r === 'ゴール！！') {
          if (off) { off.delta += B.GOAL; off.goals++; }
          if (sc.crossPos !== undefined && sc.crossPos !== sc.ofsPos) {
            var ap = _ent(_idOf(sc.offence), sc.offence, sc.crossPos);
            if (ap) { ap.delta += B.ASSIST; ap.assists++; }
          }
          if (def && def !== gk) def.delta += B.DEF_LOSE;
          if (gk) gk.delta += B.GK_CONCEDE;
        } else if (r === 'GK防いだ！') {
          if (off) off.delta += B.OFF_WIN * 0.5;   // 枠内に飛ばした分の半分
          if (gk) gk.delta += B.GK_SAVE;
        } else if (r === '成功' || r === 'カウンター') {
          if (off) off.delta += B.OFF_WIN;
          if (def) def.delta += B.DEF_LOSE;
        } else if (r === '失敗' || r === 'ブロック') {
          if (off) off.delta += B.OFF_LOSE;
          if (def) def.delta += B.DEF_WIN;
        } else if (r === '枠を外した！') {
          if (off) off.delta += B.OFF_LOSE;
        } else if (r === 'ファール') {
          if (def) def.delta += B.FOUL;      // ファールを犯すのは守備側
          if (off) off.delta += B.FOUL_WON;
        }
      });
    });

    // チームボーナス（勝利・無失点）と最終評価点
    var s1 = t1.score, s2 = t2.score;
    for (var k in acc) {
      if (!Object.prototype.hasOwnProperty.call(acc, k)) continue;
      var e = acc[k];
      var mine = (e.clubId === id1) ? s1 : s2;
      var opp = (e.clubId === id1) ? s2 : s1;
      if (mine > opp) e.delta += BESTXI_TUNING.TEAM_WIN;
      var postype = e.team.getPositionType(e.pos);
      var group = _posGroup(postype);
      if (opp === 0 && (group === 'GK' || group === 'DF')) e.delta += BESTXI_TUNING.CLEAN_SHEET;
      var rating = Math.max(BESTXI_TUNING.MIN, Math.min(BESTXI_TUNING.MAX, BESTXI_TUNING.BASE + e.delta));
      out[e.clubId][e.key] = {
        name: e.name, group: group, postype: postype,
        rating: Math.round(rating * 10) / 10, goals: e.goals, assists: e.assists
      };
    }
    return out;
  }

  /* 評価点マップ（クラブ→選手→{group,rating,...}）から BESTXI_FORMATION（GK1/DF3/MF4/FW3）を選ぶ。
   * 同点は クラブの並び順→選手キー で決着＝決定論。 */
  function _pickBestXI(ratingsByClub) {
    var pool = [];
    var order = CLUB_DEFS.map(function (d) { return d.id; });
    order.forEach(function (cid) {
      var c = ratingsByClub[cid]; if (!c) return;
      Object.keys(c).sort().forEach(function (pk) {
        var e = c[pk];
        pool.push({ clubId: cid, key: pk, name: e.name, group: e.group, rating: e.rating, goals: e.goals || 0, assists: e.assists || 0 });
      });
    });
    pool.sort(function (a, b) { return b.rating - a.rating; });   // 安定ソート＝同点は投入順
    var need = BESTXI_FORMATION;   // GK1/DF3/MF4/FW3（2026-07-24 ユーザー指定・3-4-3型）
    var xi = { GK: [], DF: [], MF: [], FW: [] };
    pool.forEach(function (p) { if (xi[p.group].length < need[p.group]) xi[p.group].push(p); });
    return xi;
  }

  /* 通年集計（seasonMeta.playerRatings に加算）。欠落時は生やす＝セーブ改定なし。 */
  function _accumulateRatings(ratingsByClub) {
    var sm = _state && _state.seasonMeta; if (!sm) return;
    if (!sm.playerRatings) sm.playerRatings = {};
    for (var cid in ratingsByClub) {
      if (!Object.prototype.hasOwnProperty.call(ratingsByClub, cid)) continue;
      if (!sm.playerRatings[cid]) sm.playerRatings[cid] = {};
      var dst = sm.playerRatings[cid], src = ratingsByClub[cid];
      for (var pk in src) {
        if (!Object.prototype.hasOwnProperty.call(src, pk)) continue;
        var e = src[pk];
        if (!dst[pk]) dst[pk] = { name: e.name, group: e.group, sum: 0, n: 0, goals: 0, assists: 0 };
        dst[pk].sum += e.rating; dst[pk].n++;
        dst[pk].goals += e.goals; dst[pk].assists += e.assists;
        dst[pk].group = e.group;   // 最新のポジション種別を採用
      }
    }
  }

  /* シーズンのベストイレブン（通年平均・最低出場数つき）。リーグ協会の選出（SN-03 最終話が読む）。 */
  function _seasonBestXI() {
    var sm = _state && _state.seasonMeta;
    var pr = sm && sm.playerRatings; if (!pr) return null;
    var byClub = {};
    var minApps = BESTXI_TUNING.SEASON_MIN_APPS;
    for (var cid in pr) {
      if (!Object.prototype.hasOwnProperty.call(pr, cid)) continue;
      byClub[cid] = {};
      for (var pk in pr[cid]) {
        if (!Object.prototype.hasOwnProperty.call(pr[cid], pk)) continue;
        var e = pr[cid][pk];
        if (e.n < minApps) continue;   // 出場が少ない選手は協会選出の対象外
        byClub[cid][pk] = { name: e.name, group: e.group, rating: Math.round((e.sum / e.n) * 100) / 100, goals: e.goals, assists: e.assists };
      }
    }
    return _pickBestXI(byClub);
  }

  /* ===========================================================================
   * SN-04 / SN-05 — 再契約・移籍オファー・解任（設計書 §3.2/§3.3）
   * ---------------------------------------------------------------------------
   * シーズン終了後の「契約の分岐」。解任されてもゲームオーバーにしない＝必ず他クラブで続く。
   * ★ 解任 = (目標未達) AND (clubTrust < しきい値)。人気は判定に混ぜない（MG-15）。
   * ★ オファー = 人気で門戸が変わる（高→上位クラブ／低→下位のみ・救済1件保証）。
   * ★ 決定論のみ（戦力順位×人気しきい値）・rng 不使用。
   * ========================================================================= */

  /* 解任判定。シーズン終了時の清算結果（manager.lastSeasonResult）を読む。 */
  function _isSacked() {
    var m = _state && _state.manager;
    var lsr = m && m.lastSeasonResult;
    if (!lsr) return false;
    return !lsr.achieved && (m.clubTrust < CONTRACT_TUNING.TRUST_SACK_THRESHOLD);
  }

  /* 移籍オファーの生成（決定論）。
   * 全クラブを戦力順に並べ、人気の帯で「どの層から声がかかるか」を決める。
   *   人気60以上 → 上位クラブを含む全域から上から順に
   *   人気30以上 → 中位以下から
   *   人気30未満 → 下位のみ（それでも最低1件は保証＝詰み防止）
   * 自クラブは常に除外。 */
  function _computeOffers() {
    var m = _state && _state.manager; if (!m) return [];
    var pop = m.params.popularity;
    var C = CONTRACT_TUNING;
    var ranked = CLUB_DEFS
      .map(function (d, i) { return { id: d.id, s: _clubStrength(d.id), ord: i }; })
      .sort(function (a, b) { return (b.s - a.s) || (a.ord - b.ord); })
      .filter(function (c) { return c.id !== _state.myClub; });
    var n = ranked.length;
    var from;   // ranked の何番目から声がかかるか（0=最強クラブも候補）
    if (pop >= C.OFFER_POP_HIGH) from = 0;
    else if (pop >= C.OFFER_POP_MID) from = Math.floor(n / 3);
    else from = Math.floor(n * 2 / 3);
    var pool = ranked.slice(from);
    if (!pool.length) pool = [ranked[n - 1]];   // 救済＝最低1件（最下位クラブ）
    return pool.slice(0, C.OFFER_MAX).map(function (c, i) {
      return { clubId: c.id, strength: c.s, rank: from + i + 1, salary: _offerSalary(c.id, false) };
    });
  }

  /* SN-08c 提示年俸（万円/年）。クラブ戦力＋監督の人気（残留なら信頼も）から決定論で導く。
   * incumbent=true は現クラブ残留の提示＝積み上げた信頼が上乗せされる。 */
  function _offerSalary(clubId, incumbent) {
    var C = CONTRACT_TUNING;
    var m = (_state && _state.manager) || null;
    var pop = (m && m.params) ? m.params.popularity : 50;
    var trust = (m && typeof m.clubTrust === 'number') ? m.clubTrust : 50;
    var v = C.SALARY_BASE
      + (_clubStrength(clubId) - 60) * C.SALARY_PER_STRENGTH
      + (pop - 50) * C.SALARY_PER_POP
      + (incumbent ? (trust - 50) * C.SALARY_PER_TRUST : 0);
    v = Math.max(C.SALARY_MIN, Math.min(C.SALARY_MAX, v));
    return Math.round(v / C.SALARY_STEP) * C.SALARY_STEP;
  }

  /* 年俸の表示文字列（万円 → 「1億2,000万円」/ en は「¥120M」）。 */
  function _salaryText(man) {
    if (!man && man !== 0) return '—';
    if (_isEn()) return '¥' + (man / 100).toFixed(man % 100 ? 1 : 0) + 'M';
    var oku = Math.floor(man / 10000), rest = man % 10000;
    if (oku > 0) return oku + '億' + (rest ? rest.toLocaleString() + '万円' : '円');
    return man.toLocaleString() + '万円';
  }

  /* まだ就任していないクラブの「今季の目標」を先読みする（_ensureSeasonGoal と同じ式）。 */
  function _goalTargetFor(clubId) {
    return GOAL_TUNING.TARGET_FOR_RANK(_strengthRank(clubId), CLUB_DEFS.length);
  }
  function _goalTextFor(clubId) {
    var t = _goalTargetFor(clubId);
    return t <= 1 ? _t('優勝', 'Win the title') : _t(t + '位以内', 'Top ' + t + ' finish');
  }

  /* 契約の分岐（シーズン終了画面が読む）。 */
  function _contractBranch() {
    if (!_state || !_state.finished) return null;
    var sacked = _isSacked();
    return {
      sacked: sacked,
      offers: _computeOffers(),
      canRenew: !sacked    // 解任なら現クラブ残留は選べない
    };
  }

  /* オファー受諾＝クラブを移って次シーズンへ。
   * myClub 差し替え → 宿敵再計算・信頼リセット(50)・tenure 更新。周回インフラは再利用。 */
  function _acceptOffer(clubId) {
    if (!_state || !_state.finished) return;
    var valid = _computeOffers().some(function (o) { return o.clubId === clubId; });
    if (!valid) return;   // 提示していないクラブへは行けない（UI外からの呼び出し防護）
    var m = _state.manager;
    m.clubTrust = MANAGER_TUNING.TRUST_START;            // 新任クラブの信頼は初期値から
    m.tenure = { clubId: clubId, sinceSeason: (_state.season || 1) + 1 };
    _startNextSeason(clubId);
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
    // MG-12: 選手の信頼が練習の伸びに乗る（信頼50=等倍・0で0.7倍・100で1.3倍）。
    //   ★ これが記者会見（PC-01）で「選手をかばう」を選ぶ意味になる。
    //   エンジンには一切触らないので、試合バランスの回帰リスクは無い。
    var tr = (typeof e.trust === 'number') ? e.trust : MANAGER_TUNING.TRUST_START;
    var trustMul = 1 + (tr - MANAGER_TUNING.TRUST_START) / 100 * 0.6;
    gain *= Math.max(0.7, Math.min(1.3, trustMul));
    if (gain <= 0) return null;
    if (!e.growth) e.growth = {};
    e.growth[bestIdx] = Math.round(((e.growth[bestIdx] || 0) + gain) * 100) / 100;
    var pname = (typeof PARAM_NAMES !== 'undefined' && PARAM_NAMES[bestIdx]) || ('#' + bestIdx);
    return { name: p.name, param: bestIdx, paramName: pname, gain: Math.round(gain * 10) / 10,
             trust: Math.round(tr) };
  }

  /* ★ 2026-08-04: 監督の「試合内係数フック」（_mgMatchCtx / window.managerParamFactor）は
   *   攻め筋対策の廃止に伴って**まるごと撤去**した。リーグの監督采配がエンジンの係数へ
   *   介入する経路はもう無い（残るのは morale 系＝mentalParamFactor と、交代/戦術/指名という
   *   「入力」だけ）。simulate.js 側の `typeof managerParamFactor === 'function'` ガードは
   *   共有ファイルの既存行なので触らない＝定義が消えたことで自動的に no-op になる。 */

  /* ══ HT-01 ハーフタイムの監督アクション（2026-07-26 ユーザー指示）════════════════
   * 順番は固定：①選手を鼓舞 → ②選手個別にアドバイス。
   * 効果はすべて **既存の係数フックに相乗り**（新しい判定式もチャンス数の変更も作らない）：
   *   ① mentalParamFactor  … チーム morale を上げる（モチベーターに比例）
   *   ② mentalParamFactor  … 指名した1人の morale を上げ、苛立ちを消す（モチベーターに比例）
   * ★ 旧①「コーチの助言＝相手の攻め筋を後半だけ封じる」は 2026-08-04 に廃止（対策系の全廃）。
   * ★ リーグの試合中だけ（_leagueMatchActive）＝シングル/W杯のハーフタイムには出さない。
   * ★ rng は新規消費しない。前半の確定データ（chanceResults）を読むだけ。 */
  var HT_TUNING = {
    ROUSE_BASE: 0.10, ROUSE_GAIN: 0.25,         // チーム morale：0→+0.10 / 100→+0.35
    ADVISE_BASE: 0.30, ADVISE_GAIN: 0.40,       // 個人 morale：0→+0.30 / 100→+0.70
    FRUST_UNIT: 0.35                            // 声かけ1回で動く苛立ちの基準量（talk.frust に掛ける）
  };
  /* ── 画面構成（2026-07-27 ユーザー指示で全面変更）────────────────────────
   * 旧: 3つの采配を1画面に並べて全部そこで完結させていた（＝情報処理が同居して
   *     「文書」に見え、ゲームとしての迫力が出ない）。
   * 新: **1画面1ビートの順送り**。1つの画面では1つのことだけを聞き、タップで次へ送る。
   *     0 前半のスタッツ → 1 選手とMTG → 2 誰に声をかける → 3 その選手に何と言う → 4 後半へ
   * ★ 2026-08-04: 旧ステップ①「コーチの助言」を廃止し、番号を1つずつ前へ詰めた
   *   （ビート番号は連番＝間を飛ばさない。HT_LAST も自動で追従する）。
   * ★ 采配は元々すべて任意。順送りにしても「やらずに次へ」で飛ばせることを保つ。 */
  var HT_STEP = { RECAP: 0, TALK: 1, WHO: 2, WORD: 3, RESUME: 4 };
  var HT_LAST = HT_STEP.RESUME;

  var _htState = null;   // { rouse:null, advise:null, pick:null, step:0 }

  function _htReset() {
    _htState = { rouse: null, advise: null, pick: null, step: HT_STEP.RECAP };
  }

  function _mgrParam(key) {
    var m = _state && _state.manager;
    return (m && m.params && typeof m.params[key] === 'number') ? m.params[key] : 0;
  }

  /* ①選手を鼓舞。チーム全体の morale を上げる（モチベーターに比例）。 */
  /* PS-05 声かけの反応。性格ごとの talk 表（mental.js）を読んで効き方を変える。
   * tone: 'praise'（褒める）/ 'scold'（叱る）。
   * ★ 返り値は {morale, frust} の実数。倍率の出どころは mental.js に一本化する。 */
  function _talkResponse(p, tone, baseMorale) {
    var ps = (typeof mentalPersonality === 'function') ? mentalPersonality(p) : null;
    var t = (ps && ps.talk && ps.talk[tone]) ? ps.talk[tone] : { morale: 1.0, frust: 0 };
    return { morale: baseMorale * t.morale, frust: HT_TUNING.FRUST_UNIT * t.frust, ps: ps };
  }
  function _applyTalk(p, tone, baseMorale) {
    var r = _talkResponse(p, tone, baseMorale);
    p.morale = Math.max(-1, Math.min(1, (p.morale || 0) + r.morale));
    p.frustration = Math.max(0, Math.min(1, (p.frustration || 0) + r.frust));
    return r;
  }

  /* ①選手とMTG。褒める/叱るを選び、**先発11人それぞれが性格に応じて反応する**。
   * チーム全体の morale も動かす（響いた人数から算出＝別の乱数は引かない）。 */
  window.leagueHtRouse = function (tone) {
    if (!_leagueMatchActive || !_htState || _htState.rouse) return;
    if (tone !== 'praise' && tone !== 'scold') return;
    var t = gameState && gameState.team1; if (!t) return;
    var base = HT_TUNING.ROUSE_BASE + HT_TUNING.ROUSE_GAIN * (_mgrParam('motivator') / MANAGER_TUNING.CAP);
    var up = 0, down = 0, sum = 0;
    for (var i = 0; i < 11; i++) {
      var p = t.players[t.lineup[i]]; if (!p) continue;
      var r = _applyTalk(p, tone, base);
      sum += r.morale;
      if (r.morale > 0) up++; else if (r.morale < 0) down++;
    }
    // 全体の空気＝個々の反応の平均（響いた人が多いほどチーム morale が上がる）
    t.morale = Math.max(-1, Math.min(1, (t.morale || 0) + sum / 11));
    _htState.rouse = { tone: tone, up: up, down: down };
    _renderHtActions();
  };

  /* ②選手個別にアドバイス。指名した1人の morale を上げ、苛立ちを消す。 */
  /* ②個別アドバイス。まず選手を選び（leagueHtPick）、次に褒める/叱るを選ぶ。 */
  /* 選手を選んだ時点で「何と言う？」の画面へ送る＝選択そのものが画面遷移になる。 */
  window.leagueHtPick = function (pos) {
    if (!_leagueMatchActive || !_htState || _htState.advise) return;
    _htState.pick = pos;
    _htState.step = HT_STEP.WORD;
    _renderHtActions();
  };
  window.leagueHtAdvise = function (tone) {
    if (!_leagueMatchActive || !_htState || _htState.advise) return;
    if (_htState.pick == null) return;
    if (tone !== 'praise' && tone !== 'scold') return;
    var t = gameState && gameState.team1; if (!t) return;
    var pos = _htState.pick;
    var p = t.players[t.lineup[pos]]; if (!p) return;
    var base = HT_TUNING.ADVISE_BASE + HT_TUNING.ADVISE_GAIN * (_mgrParam('motivator') / MANAGER_TUNING.CAP);
    var r = _applyTalk(p, tone, base);
    _htState.advise = {
      name: (_isEn() && p.en_name) ? p.en_name : p.name, pos: pos, tone: tone,
      good: r.morale > 0, ps: r.ps ? ((_isEn() && r.ps.en_name) ? r.ps.en_name : r.ps.name) : ''
    };
    _renderHtActions();
  };

  /* ── 前半の基本スタッツ（両チーム対比）──────────────────────────────
   * 素材は _computeMatchStats()＝確定済みの chanceResults の集計。
   * ★ ポゼッションはボール保持時間ではなく **攻撃シーンの本数比**（本シムは保持時間を持たない）。
   * ★ ここに出すのは5項目だけ。パス成功率・走行距離のような持っていない数字は作らない。 */
  function _htStatRows() {
    var s = _computeMatchStats();
    if (!s) return null;
    function duelRate(map) {
      var w = 0, l = 0;
      for (var k in map) { if (!Object.prototype.hasOwnProperty.call(map, k)) continue; w += map[k].w || 0; l += map[k].l || 0; }
      return (w + l) ? Math.round(w / (w + l) * 100) : 0;
    }
    var at = s.t1.atk + s.t2.atk;
    var pos1 = at ? Math.round(s.t1.atk / at * 100) : 50;
    return [
      { ja: 'シュート数', en: 'Shots', v1: s.t1.sh, v2: s.t2.sh },
      { ja: '決定機', en: 'Big chances', v1: s.t1.ch, v2: s.t2.ch },
      { ja: 'ポゼッション', en: 'Possession', v1: pos1, v2: 100 - pos1, pct: true },
      { ja: 'デュエル勝率', en: 'Duels won', v1: duelRate(s.duels1), v2: duelRate(s.duels2), pct: true },
      { ja: 'GKセーブ', en: 'Saves', v1: s.t1.gk, v2: s.t2.gk }
    ];
  }

  function _htStatsHTML() {
    var rows = _htStatRows();
    if (!rows) return '';
    var body = rows.map(function (r) {
      var tot = (r.v1 + r.v2) || 1;
      var w1 = Math.round(r.v1 / tot * 100), w2 = 100 - w1;
      var u = r.pct ? '%' : '';
      return '<div class="lg-hts-row">' +
        '<span class="lg-hts-v me">' + r.v1 + u + '</span>' +
        '<span class="lg-hts-bar me"><i style="width:' + w1 + '%"></i></span>' +
        '<span class="lg-hts-k">' + _t(r.ja, r.en) + '</span>' +
        '<span class="lg-hts-bar opp"><i style="width:' + w2 + '%"></i></span>' +
        '<span class="lg-hts-v opp">' + r.v2 + u + '</span>' +
      '</div>';
    }).join('');
    var d1 = _clubDef(team1Data && team1Data._srcKey) , d2 = _clubDef(team2Data && team2Data._srcKey);
    return '<section class="lg-hts">' +
      '<div class="lg-hts-head">' +
        '<span class="me">' + ((d1 && d1.crest) || '') + ' ' + getTeamName(team1Data) + '</span>' +
        '<span class="opp">' + getTeamName(team2Data) + ' ' + ((d2 && d2.crest) || '') + '</span>' +
      '</div>' + body +
    '</section>';
  }

  /* ══ ハーフタイムの順送りページ ═══════════════════════════════════════════
   * 1画面＝1ビート。見出し・問い・選択肢・結果のどれか1組だけを大きく出す。
   * ★ 迫力は「余白と文字の大きさ」で出す。詰め込むと即座に文書に戻るので、
   *   このページ群には情報を足さないこと（足したくなったら次のページを作る）。 */

  function _htStepDefs() {
    return [
      { k: 'recap',  no: '',  ja: '前半のスタッツ',   en: 'First half' },
      { k: 'talk',   no: '1', ja: '選手とMTG',        en: 'Team talk' },
      { k: 'who',    no: '2', ja: '個別アドバイス',   en: 'A word with one' },
      { k: 'word',   no: '2', ja: '個別アドバイス',   en: 'A word with one' },
      { k: 'resume', no: '',  ja: '後半へ',           en: 'Second half' }
    ];
  }

  /* 上部のステップ表示（①②のどこに居るか）。resume/recap では出さない。 */
  function _htStepsHTML(step) {
    var defs = _htStepDefs();
    var marks = [
      { no: '1', on: step === HT_STEP.TALK,   done: !!(_htState && _htState.rouse) },
      { no: '2', on: step === HT_STEP.WHO || step === HT_STEP.WORD, done: !!(_htState && _htState.advise) }
    ];
    var html = marks.map(function (m) {
      return '<span class="lg-ht2-dot' + (m.on ? ' on' : '') + (m.done ? ' done' : '') + '">' + m.no + '</span>';
    }).join('<i class="lg-ht2-dash"></i>');
    var d = defs[step];
    return '<nav class="lg-ht2-steps">' + html +
      '<span class="lg-ht2-stepname">' + _t(d.ja, d.en) + '</span></nav>';
  }

  /* 大きな2択（褒める / 叱る）。ハーフタイムの選択肢はこの形に統一する。 */
  function _htToneChoicesHTML(fn) {
    return '<div class="lg-ht2-choices">' +
      '<button type="button" class="lg-ht2-choice praise" onclick="' + fn + '(\'praise\')">' +
        '<span class="ico">👏</span><span class="tx">' + _t('褒める', 'Praise') + '</span>' +
        '<span class="sub">' + _t('自信を与える', 'Lift them up') + '</span></button>' +
      '<button type="button" class="lg-ht2-choice scold" onclick="' + fn + '(\'scold\')">' +
        '<span class="ico">🗯</span><span class="tx">' + _t('叱る', 'Scold') + '</span>' +
        '<span class="sub">' + _t('相手を選ぶ劇薬', 'Cuts both ways') + '</span></button>' +
    '</div>';
  }

  function _htPlayerAt(pos) {
    var t = gameState && gameState.team1;
    return (t && t.players[t.lineup[pos]]) || null;
  }
  function _htName(p) { return p ? ((_isEn() && p.en_name) ? p.en_name : p.name) : ''; }

  /* ── 各ページの中身 ── */

  function _htPageRecap() {
    return '<div class="lg-ht2-page recap">' + (_htStatsHTML() || '') + '</div>';
  }

  function _htPageTalk() {
    var st = _htState;
    if (!st.rouse) {
      return '<div class="lg-ht2-page">' +
        '<p class="lg-ht2-ask">' + _t('ロッカールームが静まり返っている。何と言う？',
                                      'The dressing room has gone quiet. What do you say?') + '</p>' +
        _htToneChoicesHTML('leagueHtRouse') + '</div>';
    }
    var head = (st.rouse.tone === 'praise')
      ? _t('ロッカールームを称えた。', 'You praised the dressing room.')
      : _t('ロッカールームで叱咤した。', 'You laid into the dressing room.');
    return '<div class="lg-ht2-page">' +
      '<p class="lg-ht2-say">' + head + '</p>' +
      '<div class="lg-ht2-tally">' +
        '<div class="up"><b>' + st.rouse.up + '</b><span>' + _t('人が応えた', 'responded') + '</span></div>' +
        (st.rouse.down
          ? '<div class="down"><b>' + st.rouse.down + '</b><span>' + _t('人が反発', 'pushed back') + '</span></div>'
          : '') +
      '</div></div>';
  }

  function _htPageWho() {
    var t = gameState && gameState.team1;
    if (!t) return '<div class="lg-ht2-page"></div>';
    var teamKey = (team1Data && team1Data._srcKey) || '';
    var picks = '';
    for (var i = 0; i < 11; i++) {
      var p = _htPlayerAt(i); if (!p) continue;
      var ps = (typeof mentalPersonality === 'function') ? mentalPersonality(p) : null;
      var psName = ps ? ((_isEn() && ps.en_name) ? ps.en_name : ps.name) : '';
      var done = !!(_htState && _htState.advise);
      var sel = done && _htState.advise.pos === i;
      picks += '<button type="button" class="lg-ht-pick' + (sel ? ' on' : '') + (done ? ' off' : '') + '"' +
        (done ? '' : ' onclick="leagueHtPick(' + i + ')"') + '>' +
        '<canvas class="lg-ht-face" width="72" height="72" data-portrait="' + (p.long_name || p.name) + '"' +
          (teamKey ? ' data-team="' + teamKey + '"' : '') + '></canvas>' +
        '<span class="lg-ht-pn">' + _htName(p) + '</span>' +
        (psName ? '<span class="lg-ht-ps">' + psName + '</span>' : '') + '</button>';
    }
    var ask = (_htState && _htState.advise)
      ? _t('声をかけたのは ' + _htState.advise.name, 'You spoke to ' + _htState.advise.name)
      : _t('誰に声をかける？', 'Who do you pull aside?');
    return '<div class="lg-ht2-page who">' +
      '<p class="lg-ht2-ask sm">' + ask + '</p>' +
      '<div class="lg-ht-picks">' + picks + '</div></div>';
  }

  function _htPageWord() {
    var st = _htState;
    if (st.pick == null) {
      return '<div class="lg-ht2-page">' +
        '<p class="lg-ht2-ask">' + _t('先に声をかける選手を選ぶ。', 'Pick a player first.') + '</p></div>';
    }
    var p = _htPlayerAt(st.pick);
    var ps = (typeof mentalPersonality === 'function') ? mentalPersonality(p) : null;
    var psName = ps ? ((_isEn() && ps.en_name) ? ps.en_name : ps.name) : '';
    var teamKey = (team1Data && team1Data._srcKey) || '';
    var face = '<div class="lg-ht2-solo">' +
      '<canvas class="lg-ht2-soloface" width="72" height="72" data-portrait="' + (p ? (p.long_name || p.name) : '') + '"' +
        (teamKey ? ' data-team="' + teamKey + '"' : '') + '></canvas>' +
      '<div class="lg-ht2-solotx"><b>' + _htName(p) + '</b>' +
        (psName ? '<span>' + psName + '</span>' : '') + '</div></div>';

    if (!st.advise) {
      return '<div class="lg-ht2-page word">' + face +
        '<p class="lg-ht2-ask sm">' + _htName(p) + _t(' に何と言う？', ' — what do you say?') + '</p>' +
        _htToneChoicesHTML('leagueHtAdvise') + '</div>';
    }
    return '<div class="lg-ht2-page word">' + face +
      '<p class="lg-ht2-say' + (st.advise.good ? '' : ' bad') + '">' +
        (st.advise.good
          ? _t(st.advise.name + 'は顔を上げた。', st.advise.name + ' lifts his head.')
          : _t(st.advise.name + 'は納得していない。逆効果だ。', st.advise.name + ' is not having it — that backfired.')) +
      '</p>' +
      '<p class="lg-ht2-eff ' + (st.advise.good ? 'up' : 'down') + '">' +
        (st.advise.good ? '▲ ' + _t('気持ちが乗った', 'Morale up') : '▼ ' + _t('苛立ちが増した', 'Frustration up')) +
      '</p></div>';
  }

  function _htPageResume() {
    var st = _htState;
    function row(no, label, done, text) {
      return '<div class="lg-ht2-sum' + (done ? ' done' : '') + '">' +
        '<span class="no">' + no + '</span>' +
        '<span class="lb">' + label + '</span>' +
        '<span class="tx">' + (done ? text : _t('見送った', 'skipped')) + '</span></div>';
    }
    var r2 = st.rouse
      ? (st.rouse.tone === 'praise' ? _t('褒めた', 'praised') : _t('叱った', 'scolded')) +
        '（' + st.rouse.up + _t('人が反応', ' responded') + '）'
      : '';
    var r3 = st.advise ? st.advise.name + (st.advise.good ? _t('・好反応', ' — good') : _t('・逆効果', ' — backfired')) : '';
    return '<div class="lg-ht2-page resume">' +
      '<p class="lg-ht2-ask sm">' + _t('前半の采配', 'Your half-time calls') + '</p>' +
      row('1', _t('選手とMTG', 'Team talk'), !!st.rouse, r2) +
      row('2', _t('個別アドバイス', 'A word'), !!st.advise, r3) +
    '</div>';
  }

  function _htPageHTML(step) {
    switch (step) {
      case HT_STEP.RECAP:  return _htPageRecap();
      case HT_STEP.TALK:   return _htPageTalk();
      case HT_STEP.WHO:    return _htPageWho();
      case HT_STEP.WORD:   return _htPageWord();
      default:             return _htPageResume();
    }
  }

  /* 下部コマンドバー（戻る／次へ）。
   * ★ 采配は元々すべて任意なので「次へ」は常に押せる（＝やらずに飛ばせる）。
   * ★ 最終ページでは「次へ」を出さない＝出口は共有フッターの「試合再開」1つだけにする。 */
  function _htNavHTML(step) {
    var back = (step > HT_STEP.RECAP)
      ? '<button type="button" class="lg-ht2-nb back" onclick="leagueHtStep(' + (step - 1) + ')">' +
          _t('← 戻る', '← Back') + '</button>'
      : '<span class="lg-ht2-nb ghost"></span>';
    var next = (step < HT_LAST)
      ? '<button type="button" class="lg-ht2-nb next" onclick="leagueHtStep(' + (step + 1) + ')">' +
          _t('次へ ▶', 'Next ▶') + '</button>'
      : '<span class="lg-ht2-nb ghost"></span>';
    return '<div class="lg-ht2-nav">' + back + next + '</div>';
  }

  window.leagueHtStep = function (n) {
    if (!_htState) return;
    _htState.step = Math.max(HT_STEP.RECAP, Math.min(HT_LAST, n));
    _renderHtActions();
  };

  function _renderHtActions() {
    var host = document.getElementById('lg-ht-actions');
    if (!host) return;
    var step = (_htState && _htState.step) || HT_STEP.RECAP;
    var last = (step === HT_LAST);

    host.innerHTML = _htStepsHTML(step) + _htPageHTML(step) + _htNavHTML(step);
    _paintPortraitCanvases(host);   // ドット頭（portrait.js）を塗る

    /* 共有フッターの2ボタン（戦術・システム・選手交代／試合再開）は **最後のページだけ** 出す。
     * ★ 途中のページに出しておくと「今この画面で何を決めるのか」がぼやけて、
     *   1画面1ビートが崩れる（順送りの出口は1つだけにする）。
     * ★ フッターの display は CSS 側で !important 指定なので inline style では消せない。
     *   クラスで切り替える（css/league-ui.css の .lg-ht-hidefoot）。 */
    var m = document.getElementById('halftime-modal');
    if (m) { if (last) m.classList.remove('lg-ht-hidefoot'); else m.classList.add('lg-ht-hidefoot'); }
  }

  /* リーグのハーフタイムだけ、共有モーダルを全画面のレトロ面に切り替える。
   * ★ シングル/W杯へ持ち越さないよう、試合が終わる/準備を抜けるときに必ず外す。 */
  function _htDecorate(on) {
    var m = document.getElementById('halftime-modal'); if (!m) return;
    if (on) { m.classList.add('league-ht'); }
    else { m.classList.remove('league-ht'); m.classList.remove('lg-ht-hidefoot'); }
  }

  /* simulate.js の _showHalfTimeModal から typeof ガードで呼ばれる（公開版は league.js 非同梱＝no-op）。 */
  window.leagueOnHalfTime = function () {
    if (!_leagueMatchActive) { _htDecorate(false); return; }   // シングル/W杯のハーフタイムには出さない
    _htDecorate(true);
    var advice = document.getElementById('ht-duel-advice');
    if (!advice || !advice.parentNode) return;
    var host = document.getElementById('lg-ht-actions');
    if (!host) {
      host = document.createElement('div');
      host.id = 'lg-ht-actions';
      host.className = 'lg-ht-actions';
      advice.parentNode.insertBefore(host, advice);   // 采配はデュエル分析（リーグでは非表示）より前
    }
    // 再開ボタンの文言はリーグだけ「試合再開」に（共有 HTML は「後半キックオフ」）。
    var kick = document.getElementById('ht-btn-kickoff');
    if (kick) kick.textContent = '▶ ' + _t('試合再開', 'Resume');
    if (!_htState) _htReset();
    _renderHtActions();
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

  /* FN-00: セーブには「その時の表示名」が焼き付いている箇所がある（個人記録・ベスト11・
   * 通年評価点）。実名⇔架空名を切り替えると古いモードの名前が残るので、ロード時に
   * **内部ID（key）から表示名を貼り直す**。key を持たない旧セーブは name 自体が内部ID
   * だった時期のものなので、それを key とみなして解決する。 */
  function _refreshDisplayNames() {
    if (typeof NAMES === 'undefined' || !NAMES || !NAMES.displayName || !_state) return;
    function fixEntry(e) { if (e && (e.key || e.name)) e.name = _keyDisplayName(e.key || e.name); }
    function fixXI(xi) {
      if (!xi) return;
      ['GK', 'DF', 'MF', 'FW'].forEach(function (g) { (xi[g] || []).forEach(fixEntry); });
    }
    function fixTop(top) { if (top) ['scorer', 'assister', 'iron'].forEach(function (k) { fixEntry(top[k]); }); }
    var pr = _state.seasonMeta && _state.seasonMeta.playerRatings;
    if (pr) for (var cid in pr) {
      if (!Object.prototype.hasOwnProperty.call(pr, cid)) continue;
      for (var pk in pr[cid]) {
        if (!Object.prototype.hasOwnProperty.call(pr[cid], pk)) continue;
        if (pr[cid][pk]) pr[cid][pk].name = _keyDisplayName(pk);
      }
    }
    (_state.history || []).forEach(function (h) { if (h) { fixTop(h.top); fixXI(h.bestXI); } });
    if (_state.lastResult) fixXI(_state.lastResult.bestXI);
    // SN-08a「オフの変化」も表示名を焼き付けている（rows は key を持つので貼り直せる）
    var ag = _state.seasonMeta && _state.seasonMeta.aging;
    if (ag) { (ag.grew || []).forEach(fixEntry); (ag.declined || []).forEach(fixEntry); }
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
      var _coachesFilled = _ensureCoreCoaches(_state.manager);
      if (!_state.seasonMeta) _state.seasonMeta = _defaultSeasonMeta();
      if (!_state.squads) _state.squads = {};   // 空 = 全選手 base のまま（delta なし）
      _ensureSeasonGoal();   // SN-02: 目標未設定の既存セーブにも開幕目標を生やす
      _refreshDisplayNames();   // FN-00: セーブに焼き付いた表示名を「いまのモード」の名前へ貼り直す
      if (_prevVersion !== _state.version || !_hadV4 || _coachesFilled) _save();   // 移行が起きた時だけ一度保存
    } catch (e) { _state = null; }
  }

  // 完了したシーズンの要約（バックナンバー用・順位表スナップショット＋自クラブ成績＋宿敵通算）。
  /* ===========================================================================
   * SN-03 — シーズン終了フロー（設計書 §3.1 [CEREMONY/REVIEW]）
   * ---------------------------------------------------------------------------
   * 優勝＝セレモニー／非優勝＝振り返り。squads の当季記録（apps/goals/assists）から
   * 個人タイトルを集計し、総評はテンプレで生成（軽LLM化は後日＝まずテンプレで縦貫通）。
   * ★ すべて確定済みデータの読み出しのみ＝rng 不使用・エンジン不変。
   * ========================================================================= */

  /* _rateMatch の1クラブ分（key→{name,goals,assists,...}）を _recordTeamCarryover が読む
   * 「選手名 → 得点/アシスト」の形へ写す。得点者内訳を持たない経路（ヘッドレス消化）でも
   * 同じ確定データから内訳を復元できる。 */
  function _statsFromRatings(byKey) {
    if (!byKey) return null;
    var out = {};
    for (var k in byKey) {
      if (!Object.prototype.hasOwnProperty.call(byKey, k)) continue;
      var e = byKey[k];
      if (e && e.name) out[e.name] = { goals: e.goals || 0, assists: e.assists || 0 };
    }
    return out;
  }

  /* 自クラブの当季 個人記録トップ（得点王/アシスト王/皆勤）。squads は疎なので実在選手だけ拾う。 */
  function _seasonTopPlayers() {
    var myId = _state.myClub;
    var c = (_state.squads && _state.squads[myId]) || {};
    var top = { scorer: null, assister: null, iron: null };
    for (var pk in c) {
      if (!Object.prototype.hasOwnProperty.call(c, pk)) continue;
      var e = c[pk];
      // ★ pk は内部ID（実名）。画面に出すのは _keyDisplayName 経由＝架空化ONなら架空名（FN-00）
      if (e.goals > 0 && (!top.scorer || e.goals > top.scorer.n)) top.scorer = { name: _keyDisplayName(pk), key: pk, n: e.goals };
      if (e.assists > 0 && (!top.assister || e.assists > top.assister.n)) top.assister = { name: _keyDisplayName(pk), key: pk, n: e.assists };
      if (e.apps > 0 && (!top.iron || e.apps > top.iron.n)) top.iron = { name: _keyDisplayName(pk), key: pk, n: e.apps };
    }
    return top;
  }

  /* ── SN-03改3 リーグ全体の個人表彰（2026-07-26・スライド「②個人表彰」）─────────
   * 素材は seasonMeta.playerRatings＝全クラブ・全節ぶんの確定記録（_accumulateRatings）。
   *   得点王/アシスト王 … goals / assists の最大
   *   MVP              … 平均レーティング最大（協会ベストイレブンと同じ最低出場数を課す）
   *   新人賞           … 同上を U23（SN-08a の年齢モデル）に限定
   * ★ 確定データの読み出しのみ＝rng 不使用・エンジン不変。同値は clubId|key 順で決着＝決定論。 */
  /* リーグ全体の選手を1本の配列に均す（表彰・ランキングの共通素材）。
   * ★ クラブ順・選手キー順に舐めるので並びは決定論。 */
  function _leaguePlayerPool() {
    var sm = _state && _state.seasonMeta;
    var pr = sm && sm.playerRatings;
    var all = [];
    if (!pr) return all;
    var cids = Object.keys(pr).sort();
    for (var ci = 0; ci < cids.length; ci++) {
      var cid = cids[ci], keys = Object.keys(pr[cid]).sort();
      for (var ki = 0; ki < keys.length; ki++) {
        var pk = keys[ki], e = pr[cid][pk];
        all.push({
          clubId: cid, key: pk, name: e.name, n: e.n,
          goals: e.goals || 0, assists: e.assists || 0,
          avg: e.n ? (e.sum / e.n) : 0, age: _playerAge(cid, pk)
        });
      }
    }
    return all;
  }

  /* 表彰の種別ごとの定義（1位＝表彰カード／上位10名＝ランキングページ で同じ式を使う）。
   *   value  … 順位付けに使う値
   *   filter … 対象の絞り込み（MVP/新人賞は最低出場数、新人賞はさらに U23）
   *   fmt    … 表示する値の文字列 */
  var AWARD_DEFS = {
    scorer: {
      ja: '得点王', en: 'Top scorer', ico: '👑',
      value: function (p) { return p.goals; },
      filter: function (p) { return p.goals > 0; },
      fmt: function (p) { return _t(p.goals + '点', p.goals + ' G'); }
    },
    assister: {
      ja: 'アシスト王', en: 'Top assists', ico: '🎯',
      value: function (p) { return p.assists; },
      filter: function (p) { return p.assists > 0; },
      fmt: function (p) { return _t(p.assists + '回', p.assists + ' A'); }
    },
    mvp: {
      ja: 'MVP', en: 'MVP', ico: '🏅',
      value: function (p) { return p.avg; },
      filter: function (p) { return p.n >= BESTXI_TUNING.SEASON_MIN_APPS; },
      fmt: function (p) { return _t('平均 ', 'avg ') + p.avg.toFixed(2); }
    },
    rookie: {
      ja: '新人賞', en: 'Young Player', ico: '🌟',
      value: function (p) { return p.avg; },
      filter: function (p) { return p.n >= BESTXI_TUNING.SEASON_MIN_APPS && p.age <= AGE_TUNING.U23; },
      fmt: function (p) { return _t('平均 ', 'avg ') + p.avg.toFixed(2); }
    }
  };

  /* 種別ごとの上位 n 名。同値は 得点→アシスト→平均→キー の順で決着＝決定論。 */
  function _awardRanking(kind, n) {
    var d = AWARD_DEFS[kind]; if (!d) return [];
    var list = _leaguePlayerPool().filter(d.filter);
    list.sort(function (a, b) {
      var dv = d.value(b) - d.value(a); if (dv) return dv;
      if (b.goals !== a.goals) return b.goals - a.goals;
      if (b.assists !== a.assists) return b.assists - a.assists;
      if (b.avg !== a.avg) return b.avg - a.avg;
      return a.key < b.key ? -1 : 1;
    });
    return list.slice(0, n || 10);
  }

  function _leagueAwards() {
    var out = {};
    ['scorer', 'assister', 'mvp', 'rookie'].forEach(function (k) {
      var top = _awardRanking(k, 1);
      out[k] = top.length ? top[0] : null;
    });
    return out;
  }

  /* 自クラブの選手別 出場記録（スライド「④自チーム成績」）。出場数の多い順。
   * minutes は自クラブの対話モード試合でのみ積まれる（SN-08b）。 */
  function _myPlayerLog() {
    var myId = _state && _state.myClub;
    var c = (_state && _state.squads && _state.squads[myId]) || {};
    var rows = [];
    for (var pk in c) {
      if (!Object.prototype.hasOwnProperty.call(c, pk)) continue;
      var e = c[pk];
      if (!e || !e.apps) continue;
      rows.push({
        key: pk, name: _keyDisplayName(pk), apps: e.apps, minutes: e.minutes || 0,
        goals: e.goals || 0, assists: e.assists || 0, age: _playerAge(myId, pk)
      });
    }
    rows.sort(function (a, b) {
      return (b.apps - a.apps) || (b.minutes - a.minutes) || (a.name < b.name ? -1 : 1);
    });
    return rows;
  }

  /* シーズン総評（テンプレ）。順位・目標・宿敵・得点力から1〜2文を組む。 */
  function _seasonReviewText(sum) {
    var lines = [];
    var isChamp = sum.champion === sum.myClub;
    var achieved = sum.verdict ? sum.verdict.achieved : false;
    if (isChamp) {
      lines.push(_t('圧巻のシーズンだった。' + _clubName(sum.myClub) + 'がリーグの頂点に立った。',
        'A commanding season — ' + _clubName(sum.myClub) + ' stand at the top of the league.'));
    } else if (achieved) {
      lines.push(_t('クラブの要求に応えた堅実なシーズン。' + sum.myPos + '位でフィニッシュした。',
        'A solid season that met the club\'s demands, finishing ' + sum.myPos + '.'));
    } else {
      lines.push(_t('悔しさの残るシーズン。' + sum.myPos + '位はクラブの期待に届かなかった。',
        'A frustrating season — ' + sum.myPos + ' fell short of the club\'s expectations.'));
    }
    var h = sum.rivalH2H;
    if (h && (h.w + h.d + h.l) > 0) {
      if (h.w > h.l) lines.push(_t('宿敵' + _clubName(sum.rival) + 'との対決を制したことは大きな誇りだ。',
        'Winning the rivalry against ' + _clubName(sum.rival) + ' is a point of pride.'));
      else if (h.l > h.w) lines.push(_t('宿敵' + _clubName(sum.rival) + 'に屈した借りは、来季必ず返す。',
        'The debt owed to rivals ' + _clubName(sum.rival) + ' must be repaid next season.'));
    }
    var r = sum.myRecord;
    if (r && r.gf - r.ga >= 10) lines.push(_t('得点力はリーグを圧倒した（得失点+' + (r.gf - r.ga) + '）。',
      'The attack overwhelmed the league (GD +' + (r.gf - r.ga) + ').'));
    else if (r && r.ga - r.gf >= 10) lines.push(_t('守備の再建が来季最大の課題だ（得失点' + (r.gf - r.ga) + '）。',
      'Rebuilding the defence is the biggest task ahead (GD ' + (r.gf - r.ga) + ').'));
    return lines.join('');
  }

  function _seasonSummary() {
    var rows = _sortedStandings();
    var champ = rows[0];
    var myId = _state.myClub;
    var myRow = _state.standings[myId] || _emptyStanding();
    var m = _state.manager || {};
    return {
      season: _state.season || 1,
      myClub: myId,
      champion: champ ? champ.id : null,
      myPos: _position(myId),
      myRecord: { w: myRow.w, d: myRow.d, l: myRow.l, gf: myRow.gf, ga: myRow.ga, pts: myRow.pts },
      rival: _state.rival || null,
      rivalH2H: _state.rival ? _h2h(myId, _state.rival) : null,
      standings: rows.map(function (r) { return { id: r.id, pts: r.pts, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga }; }),
      // ── SN-03 追加（RW-02 バックナンバーがそのまま読む）──
      verdict: m.lastSeasonResult || null,            // SN-02 の達成判定
      goal: m.seasonGoal ? m.seasonGoal.target : null,
      top: _seasonTopPlayers(),                        // 得点王/アシスト王/皆勤
      bestXI: _seasonBestXI(),                         // 協会選出ベストイレブン（BX・RW-02 が読み返す）
      managerSnap: m.params ? {                        // 季末の監督スナップショット
        tactical: Math.round(m.params.tactical), analysis: Math.round(m.params.analysis),
        motivator: Math.round(m.params.motivator), conditioning: Math.round(m.params.conditioning),
        popularity: Math.round(m.params.popularity), clubTrust: Math.round(m.clubTrust || 0)
      } : null
    };
  }

  // 今シーズンをアーカイブして次シーズンを開始（記録は消さず引き継ぐ）。
  // newClubId 指定時＝移籍（SN-04）: myClub を差し替えて同じ周回インフラで続ける。
  function _startNextSeason(newClubId) {
    if (!_state) return;
    var hist = Array.isArray(_state.history) ? _state.history.slice() : [];
    hist.push(_seasonSummary());
    if (hist.length > 50) hist = hist.slice(hist.length - 50);   // 上限（localStorage肥大化防止）
    var my = newClubId || _state.myClub;
    var nextSeason = (_state.season || 1) + 1;
    var ids = CLUB_DEFS.map(function (d) { return d.id; });
    var standings = {};
    ids.forEach(function (id) { standings[id] = _emptyStanding(); });
    // ★ v4: 監督（成長・信頼・キャリア）と選手の持ち越し（growth/年齢/信頼）はシーズンを跨いで引き継ぐ。
    //   季ごとにリセットするのは「当季の記録」= apps/goals/assists と欠場カウンタ・行動ログのみ。
    var manager = _state.manager || _defaultManager(my, nextSeason);
    var squads = _carrySquads(_state.squads);
    // SN-08a: シーズン境界で1回だけ選手を加齢させる（若手は伸び・ベテランは衰える）。
    //   ★ 順序が意味を持つ: _carrySquads で当季記録を捨てる **前** の squads から apps を読む。
    //   ★ 年齢そのものは _playerAge が季から決定論で出すので保存しない（セーブを太らせない）。
    var _agingSeasonMatches = (_state.fixtures && _state.fixtures.length) || 14;
    var _aging = _applySeasonAging(squads, _state.squads, _agingSeasonMatches, my);
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
    // SN-08a: 自クラブの成長/衰えサマリー。上位8名だけ残す（セーブ肥大化を避ける・1画面に収まる量）。
    //   ★ 成長リザルトの「演出」は MG-08/SN-03 側（G 担当）。ここは素材の提供に徹する。
    _state.seasonMeta.aging = { grew: _aging.grew.slice(0, 8), declined: _aging.declined.slice(0, 8) };
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

  /* ══ SH-01 シーズンハブの集計（2026-07-26・ユーザー提供モック準拠）════════════════
   * ホーム画面が出す「順位変動 ▲▼／相手の攻撃・守備・調子／要注意選手／監督レベル」を
   * すべて確定済みデータから導く。★ rng 不使用・新しい保存項目も作らない。 */

  /* 指定節数ぶんだけ消化した時点の順位表を fixtures から組み直す（▲▼ の基準）。 */
  function _standingsAsOfRound(rounds) {
    var st = {};
    _state.clubs.forEach(function (id) { st[id] = _emptyStanding(); });
    for (var r = 0; r < rounds && r < _state.fixtures.length; r++) {
      var ms = _state.fixtures[r];
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i]; if (!m.played) continue;
        var H = st[m.home], A = st[m.away];
        H.p++; A.p++; H.gf += m.hs; H.ga += m.as; A.gf += m.as; A.ga += m.hs;
        if (m.hs > m.as) { H.w++; A.l++; H.pts += 3; }
        else if (m.hs < m.as) { A.w++; H.l++; A.pts += 3; }
        else { H.d++; A.d++; H.pts++; A.pts++; }
      }
    }
    var rows = _state.clubs.map(function (id) {
      var s = st[id];
      return { id: id, pts: s.pts, gd: s.gf - s.ga, gf: s.gf };
    });
    rows.sort(function (a, b) {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return _clubName(a.id) < _clubName(b.id) ? -1 : 1;
    });
    return rows;
  }

  /* 前節終了時との順位差（正=上昇）。開幕前後は全クラブ 0。 */
  function _rankMoves() {
    var out = {};
    _state.clubs.forEach(function (id) { out[id] = 0; });
    if (!_state.round || _state.round < 1) return out;
    var prev = _standingsAsOfRound(_state.round - 1);
    var now = _sortedStandings();
    var pi = {};
    prev.forEach(function (r, i) { pi[r.id] = i; });
    now.forEach(function (r, i) { out[r.id] = (pi[r.id] != null) ? (pi[r.id] - i) : 0; });
    return out;
  }

  // 攻撃/守備の指標に使う param（CLAUDE.md のパラメータ体系に対応）。
  var ATK_IDX = [11, 12, 13, 7, 9, 17];   // シュート精度/センス/技術・ドリブル精度・ショートパス・オフェンシブ
  var DEF_IDX = [18, 19, 20, 21, 22];     // パスカット・タックル・マンマーキング・カバーリング・チェイシング
  var GK_DEF_IDX = [23, 24, 26];          // セービング・ハイボール処理・ポジショニング

  /* クラブの攻撃力/守備力（先発11の平均）。スカウティング表示用の要約であって
   * 試合エンジンの計算には一切使わない（エンジンは選手個々の param を直接読む）。 */
  function _clubAtkDef(clubId) {
    var td = _overlaySquad(clubId);
    if (!td || !td.players || !td.default_lineup) return { atk: 0, def: 0 };
    var lu = td.default_lineup.slice(0, 11);
    var a = 0, an = 0, d = 0, dn = 0;
    for (var i = 0; i < lu.length; i++) {
      var p = td.players[lu[i]];
      if (!p || !p.params) continue;
      var idxs = (i === 0) ? GK_DEF_IDX : DEF_IDX;
      for (var k = 0; k < idxs.length; k++) { var dv = p.params[idxs[k]]; if (dv != null) { d += dv; dn++; } }
      if (i === 0) continue;   // GK は攻撃側の平均に混ぜない
      for (var j = 0; j < ATK_IDX.length; j++) { var av = p.params[ATK_IDX[j]]; if (av != null) { a += av; an++; } }
    }
    return { atk: an ? Math.round(a / an) : 0, def: dn ? Math.round(d / dn) : 0 };
  }

  /* クラブの調子＝直近3節の勝点で上向き/横ばい/下降を判定する。 */
  function _clubForm(clubId) {
    var out = [];
    for (var r = 0; r < _state.fixtures.length; r++) {
      var ms = _state.fixtures[r];
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (!m.played || (m.home !== clubId && m.away !== clubId)) continue;
        var mine = (m.home === clubId) ? m.hs : m.as;
        var opp = (m.home === clubId) ? m.as : m.hs;
        out.push(mine > opp ? 'W' : (mine < opp ? 'L' : 'D'));
      }
    }
    var last = out.slice(-3);
    if (!last.length) return { dir: 'flat', ja: '—', en: '—', results: [] };
    var pts = last.reduce(function (s, r) { return s + (r === 'W' ? 3 : (r === 'D' ? 1 : 0)); }, 0);
    if (pts >= 7) return { dir: 'up', ja: '上向き', en: 'Rising', results: last };
    if (pts <= 2) return { dir: 'down', ja: '下降', en: 'Falling', results: last };
    return { dir: 'flat', ja: '横ばい', en: 'Steady', results: last };
  }

  /* 要注意選手＝当季の最多得点者。まだ記録が無い開幕時は先発11の総合最高値で代用する。 */
  function _keyPlayer(clubId) {
    var td = _overlaySquad(clubId);
    if (!td || !td.players) return null;
    function posOf(name) {
      for (var i = 0; i < td.players.length; i++) {
        var p = td.players[i];
        if (p && (p.name === name || p.long_name === name)) {
          return (p.positions && p.positions[0]) ? p.positions[0] : '';
        }
      }
      return '';
    }
    var pr = _state.seasonMeta && _state.seasonMeta.playerRatings && _state.seasonMeta.playerRatings[clubId];
    var best = null;
    if (pr) {
      var keys = Object.keys(pr).sort();   // 同値は key 順で決着＝決定論
      for (var ki = 0; ki < keys.length; ki++) {
        var e = pr[keys[ki]];
        if (!e.goals) continue;
        if (!best || e.goals > best.goals) best = { name: e.name, goals: e.goals };
      }
    }
    if (best) return { name: best.name, pos: posOf(best.name), note: best.goals, kind: 'goals' };
    // 開幕時のフォールバック＝先発11で総合が最も高い選手
    var lu = (td.default_lineup || []).slice(0, 11), top = null;
    for (var li = 0; li < lu.length; li++) {
      var pl = td.players[lu[li]];
      if (!pl || !pl.params) continue;
      var s = 0; for (var pi2 = 0; pi2 < pl.params.length; pi2++) s += pl.params[pi2];
      var avg = s / pl.params.length;
      if (!top || avg > top.avg) top = { name: pl.name, avg: avg, pos: (pl.positions && pl.positions[0]) || '' };
    }
    return top ? { name: top.name, pos: top.pos, note: Math.round(top.avg), kind: 'rating' } : null;
  }

  /* 監督レベル＝4能力（人気を除く）の平均。整数部がレベル・小数部が次までの進捗。
   * ★ 新しい経験値は作らない＝既にある能力値の言い換えなので数値が二重管理にならない。 */
  function _managerLevel() {
    var m = _state.manager;
    if (!m || !m.params) return null;
    var keys = ['tactical', 'analysis', 'motivator', 'conditioning'];
    var sum = 0;
    for (var i = 0; i < keys.length; i++) sum += (m.params[keys[i]] || 0);
    var avg = sum / keys.length;
    var lv = Math.floor(avg);
    return { lv: lv, pct: (avg - lv) * 100, toNext: Math.round((lv + 1 - avg) * 10) / 10 };
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
  /* ── 采配を挟んだ試合の「左右判定」（2026-08-05 修正）────────────────────────
   * ⚠️ 同一性（===）で自チーム/相手を判定してはいけない。試合中に交代/戦術変更を行うと
   *   manager-match.js の _mvFreezePastScenes が、過去シーンの参照するチームを
   *   「その時点の lineup を凍結したクローン」へ差し替える（交代前のゴールが控えへ
   *   誤帰属するのを防ぐための正しい仕組み）。クローンは **name を保つ契約**なので、
   *   左右は name で判定する。=== のままだと采配より前の全シーンが「どちらでもない」に
   *   落ち、自チームのチャンス/シュート/得点者/持ち越し成績が丸ごと消える。
   *   （実害: シュート0本で5得点・得点者が全部相手側に並ぶ・シーズン成績の取りこぼし） */
  function _sameTeam(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    return !!(a.name && b.name && a.name === b.name);
  }

  function _collectMyStats() {
    var empty = { scorers: [], mom: null, stats: {} };   // stats = 選手名→{goals,assists,duelWins}（v4 持ち越し用）
    if (typeof chanceResults === 'undefined' || !chanceResults) return empty;
    if (typeof gameState === 'undefined' || !gameState || !gameState.team1) return empty;
    var t1 = gameState.team1, stats = {};
    chanceResults.forEach(function (res) {
      if (!res || !res.scenes) return;
      res.scenes.forEach(function (sc) {
        if (!_sameTeam(sc.offence, t1)) return;
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
      // このチャンス消化直後(=currentChanceIdx が i+1 の時点)に起きた交代/実況ノートを差し込む
      // （MTG1案1: note=演出系メッセージ⭐🗣⚡🧠。sub行と区別して tone で色分け表示する）
      subs.filter(function (s) { return s.chanceIdx === i + 1; }).forEach(function (s) { out.push({ t: s.time || (res && res.time) || '', x: s.text, sub: !s.note, note: !!s.note, tone: s.tone }); });
    });
    // 全チャンス後(終盤)の交代/実況ノートを末尾に
    subs.filter(function (s) { return s.chanceIdx > chanceResults.length; }).forEach(function (s) { out.push({ t: s.time, x: s.text, sub: !s.note, note: !!s.note, tone: s.tone }); });
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
      var rowCls = (l.sub ? ' sub' : '') + (l.note ? ' note-' + (l.tone === 'rival' ? 'rival' : 'mine') : '');
      rows += '<div class="lg-logrow' + rowCls + '"><span class="lg-logtime">' + tcell + '</span><span class="lg-logtxt">' + l.x + '</span></div>';
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
  /* ── RW-02 バックナンバー（過去シーズンの読み返し）───────────────────
   * 各シーズン＝「1冊のバックナンバー」。<details> で開くと当時の記録が全部読める:
   *   最終順位表／クラブの評価（達成/未達）／シーズン総評／表彰／協会ベストイレブン／監督の当時値。
   * ★ すべてアーカイブ（history）の確定データを描くだけ＝再計算しない（総評文のみ表示時に現在LANGで生成）。 */
  /* 1冊の「中身」。UX-05 の本棚（開いたページ）と、従来の <details> の両方から使う。 */
  function _historyIssueBodyHTML(h) {
    var inner = '';

    // 総評（表示時に現在LANGで生成＝アーカイブの確定データから）
    inner += '<div class="lg-mini" style="text-align:left;line-height:1.8;border-top:1px solid rgba(255,255,255,0.12);padding-top:7px">' +
      '<div style="font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:2px">' + _t('シーズン総評', 'Season review') + '</div>' +
      _seasonReviewText(h) + '</div>';

    // 宿敵の対戦成績
    if (h.rival && h.rivalH2H && (h.rivalH2H.w + h.rivalH2H.d + h.rivalH2H.l) > 0) {
      inner += '<div class="lg-mini" style="margin-top:5px;text-align:left">🔥 ' +
        _t('宿敵 ' + _clubName(h.rival) + ' 戦：', 'Rivalry vs ' + _clubName(h.rival) + ': ') +
        h.rivalH2H.w + _t('勝', 'W') + h.rivalH2H.d + _t('分', 'D') + h.rivalH2H.l + _t('敗', 'L') + '</div>';
    }

    // 表彰＋協会ベストイレブン（SN-03/BX のアーカイブ）
    inner += _seasonAwardsHTML(h.top);
    if (h.bestXI) {
      inner += _bestXIHTML(h.bestXI, 'season',
        'シーズンベストイレブン', 'Team of the Season',
        'リーグ協会 公式発表', 'OFFICIAL — LEAGUE ASSOCIATION');
    }

    // 最終順位表（アーカイブから再構成・自クラブをハイライト）
    if (h.standings && h.standings.length) {
      var rows = h.standings.map(function (r) {
        return { id: r.id, p: (r.w + r.d + r.l), w: r.w, d: r.d, l: r.l, gd: (r.gf - r.ga), pts: r.pts };
      });
      inner += '<div style="margin-top:7px"><div style="font-size:10px;color:rgba(255,255,255,0.5);text-align:center;margin-bottom:3px">' +
        _t('最終順位表', 'Final table') + '</div>' + _standingsTableHTML(rows, h.myClub) + '</div>';
    }

    // 当時の監督（季末スナップショット）
    if (h.managerSnap) {
      var ms2 = h.managerSnap;
      inner += '<div class="lg-mini" style="margin-top:6px;text-align:center;border-top:1px solid rgba(255,255,255,0.12);padding-top:6px">' +
        '<div style="font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:2px">' + _t('当時の監督', 'Manager back then') + '</div>' +
        _t('戦術眼', 'Tac') + ' <b>' + ms2.tactical + '</b>　' + _t('分析', 'Ana') + ' <b>' + ms2.analysis + '</b>　' +
        _t('モチベ', 'Mot') + ' <b>' + ms2.motivator + '</b>　' + _t('フィジ', 'Con') + ' <b>' + ms2.conditioning + '</b>　' +
        _t('人気', 'Pop') + ' <b>' + ms2.popularity + '</b>　' + _t('信頼', 'Trust') + ' <b>' + ms2.clubTrust + '</b></div>';
    }
    return inner;
  }

  function _historyIssueHTML(h, isLatest) {
    var champDef = h.champion ? _clubDef(h.champion) : null;
    var mine = h.myClub === h.champion;
    var mr = h.myRecord || { w: 0, d: 0, l: 0, pts: 0, gf: 0, ga: 0 };
    var myDef = _clubDef(h.myClub);

    // ── 表紙（summary 行）＝号数・優勝・自クラブの成績
    var verdictChip = '';
    if (h.verdict) {
      verdictChip = h.verdict.achieved
        ? '<span class="lg-badge" style="background:#1e7a43">' + _t('目標達成', 'Achieved') + '</span>'
        : '<span class="lg-badge" style="background:#8a2f2f">' + _t('目標未達', 'Missed') + '</span>';
    }
    var cover =
      '<summary style="cursor:pointer;list-style:none;padding:10px 8px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">' +
          '<b style="font-size:13px">📖 ' + _t('シーズン' + h.season, 'Season ' + h.season) + '</b>' +
          '<span style="font-size:12px">🏆 ' + (champDef ? champDef.crest + ' ' + _clubName(h.champion) : '—') +
            (mine ? ' <span style="color:#ffd24a;font-weight:800">' + _t('優勝', 'Champions') + '</span>' : '') + '</span>' +
        '</div>' +
        '<div class="lg-mini" style="text-align:left;margin-top:3px">' +
          (myDef ? myDef.crest + ' ' : '') + _clubName(h.myClub) + '　<b style="color:#fff">' + h.myPos + _t('位', '') + '</b>' +
          '　' + mr.pts + _t('pt', 'pts') + '　' + mr.w + _t('勝', 'W') + mr.d + _t('分', 'D') + mr.l + _t('敗', 'L') +
          '　' + verdictChip +
          '<span style="float:right;opacity:.5">' + _t('▼ 読む', '▼ read') + '</span>' +
        '</div>' +
      '</summary>';

    // ── 中身（開いたとき）＝本棚版と共通
    var inner = _historyIssueBodyHTML(h);

    return '<details' + (isLatest ? ' open' : '') + ' class="lg-card" style="margin:6px 0;padding:0 8px 8px">' +
      cover + '<div style="padding:0 2px 4px">' + inner + '</div></details>';
  }

  function _showHistory() {
    if (!_state || !_state.history || !_state.history.length) return;
    _ensureStyle();
    var old = document.getElementById('lg-hist-ov'); if (old) old.parentNode.removeChild(old);

    var head =
      '<div class="lg-loghead">' +
        '<div style="font-weight:800;font-size:14px">📚 ' + _t('バックナンバー', 'Back issues') +
          '<span class="lg-badge" style="margin-left:6px">' + _state.history.length + _t('冊', '') + '</span></div>' +
        '<button class="lg-logclose" onclick="leagueCloseHistory()">✕</button>' +
      '</div>';

    var shelfMode = _lgOn() && !!LgUI.shelf;
    var body;
    if (shelfMode) {
      // UX-05: <details> の折りたたみをやめ、背表紙が並ぶ「本棚」にする。
      var issues = _state.history.map(function (h) {
        var cd = h.champion ? _clubDef(h.champion) : null;
        var myD = _clubDef(h.myClub);
        return {
          label: _t('シーズン' + h.season, 'Season ' + h.season),
          sub: h.myPos + _t('位', ''),
          champCrest: cd ? cd.crest : '',
          color: myD ? myD.color : null,
          achieved: h.verdict ? !!h.verdict.achieved : null
        };
      });
      body = '<div class="lg-logbody">' + LgUI.shelf(issues, 'leagueOpenIssue') +
        '<div id="lg-issue-page"></div></div>';
    } else {
      var acc = '';
      for (var i = _state.history.length - 1; i >= 0; i--) {
        acc += _historyIssueHTML(_state.history[i], i === _state.history.length - 1);
      }
      body = '<div class="lg-logbody">' + acc + '</div>';
    }

    var ov = document.createElement('div');
    ov.id = 'lg-hist-ov'; ov.className = 'lg-logov';
    ov.innerHTML = head + body;
    (document.getElementById('screen-home') || document.body).appendChild(ov);
    _paintPortraitCanvases(ov);
    // 棚だけだと何も読めないので、最新号を最初から開いておく
    if (shelfMode) _openIssue(_state.history.length - 1);
  }

  /* UX-05: 棚から1冊を開く（ページめくり）。 */
  function _openIssue(i) {
    if (!_state || !_state.history || !_state.history[i]) return;
    var host = document.getElementById('lg-issue-page'); if (!host) return;
    var h = _state.history[i];
    var cd = h.champion ? _clubDef(h.champion) : null;
    var mine = (h.myClub === h.champion);
    var mr = h.myRecord || { w: 0, d: 0, l: 0, pts: 0 };

    var title = '📖 ' + _t('シーズン' + h.season, 'Season ' + h.season) +
      '　<span style="font-size:12px;font-weight:400">🏆 ' +
      (cd ? cd.crest + ' ' + _clubName(h.champion) : '—') +
      (mine ? ' <b style="color:#ffd24a">' + _t('優勝', 'Champions') + '</b>' : '') + '</span>';
    var lead = '<div class="lg-mini" style="text-align:left">' +
      (_clubDef(h.myClub) ? _clubDef(h.myClub).crest + ' ' : '') + _clubName(h.myClub) +
      '　<b style="color:#fff">' + h.myPos + _t('位', '') + '</b>　' + mr.pts + _t('pt', 'pts') +
      '　' + mr.w + _t('勝', 'W') + mr.d + _t('分', 'D') + mr.l + _t('敗', 'L') + '</div>';
    var html = LgUI.issuePage(lead + _historyIssueBodyHTML(h), { title: title });

    function painted() { _paintPortraitCanvases(host); }
    if (_juiceOn() && Juice.pageTurn) Juice.pageTurn(host, html).then(painted);
    else { host.innerHTML = html; painted(); }

    // 選択中の背表紙を立たせる
    var spines = document.querySelectorAll('#lg-hist-ov .lg-spine');
    Array.prototype.forEach.call(spines, function (s, n) {
      if (n === i) s.classList.add('sel'); else s.classList.remove('sel');
    });
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
  /* MOM・得点者＝レポートの「人」の部分。UX-04 でパネル③に切り出すため関数化した
   * （_reportRowsHTML＝従来の一括表示はこれを内包する＝文言を二重に持たない）。 */
  function _momScorersHTML(lr) {
    var out = [];
    if (lr.mine.mom) {
      var m = lr.mine.mom;
      var stat = m.goals > 0 ? (m.goals + _t('ゴール', 'G') + (m.assists > 0 ? ' ' + m.assists + _t('アシスト', 'A') : '')) : _t('攻守に奮闘', 'all-round display');
      out.push('🌟 <b>MOM</b> ' + m.name + '（' + stat + '）');
    }
    if (lr.mine.scorers && lr.mine.scorers.length) {
      out.push('⚽ ' + lr.mine.scorers.map(function (s) { return s.name + (s.goals > 1 ? '×' + s.goals : ''); }).join('、'));
    }
    return out.join('<br>');
  }
  function _reportRowsHTML(lr) {
    var ms = _momScorersHTML(lr);
    return (ms ? ms + '<br>' : '') + _reviewText(lr);
  }
  /* 他会場（同節の AIvsAI）。従来バナーとパネル④の両方から使う。 */
  function _otherResultsHTML(lr) {
    if (!lr.others || !lr.others.length) return '';
    var ot = lr.others.map(function (o) {
      return _clubName(o.home) + ' <b>' + o.hs + '-' + o.as + '</b> ' + _clubName(o.away);
    }).join('<br>');
    return '<div class="lg-mini" style="margin-top:8px;text-align:center;border-top:1px solid rgba(255,255,255,0.12);padding-top:8px">' +
      '<div style="font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:3px">' + _t('他会場', 'Other results') + '</div>' + ot + '</div>';
  }

  /* ── UX-02/04 演出レイヤへの seam ────────────────────────────────────
   * 新モジュール（juice.js / matchday.js / lg-ui.js / lab-art.js）は lab 限定。
   * すべて typeof ガード越しに呼び、未搭載なら従来の即時表示にフォールバックする。 */
  function _juiceOn() {
    return typeof Juice !== 'undefined' && typeof Juice.ready === 'function' && Juice.ready();
  }
  function _matchdayOn() {
    return typeof Matchday !== 'undefined' && window.JUICE_ENABLED !== false;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * BD-01 ボードとの交渉（開幕・シーズンに1度）
   * -----------------------------------------------------------------------
   * これまでシーズン目標はクラブから一方的に提示されるだけで、プレイヤーに
   * 交渉の余地が無かった。開幕でボードと約束を交わす → 毎節の記者会見で世論と
   * 向き合う → シーズン末に評価される、という「監督の1年」の入口にする。
   *   下げる = 達成は楽だが信頼と人気を先に失う
   *   宣言   = 信頼と人気を先に得るが、未達時の落差が大きくなる（既存の清算に乗る）
   * ═══════════════════════════════════════════════════════════════════════ */
  var BOARD_TUNING = {
    LOWER: { goal: +1, trust: -8, pop: -3 },   // 目標を1つ下げてもらう
    ACCEPT: { goal: 0, trust: 0, pop: 0 },
    RAISE: { goal: -1, trust: +8, pop: +4 }    // より高い目標を宣言する
  };

  /* 開幕節（round 0）でまだ面談していなければ true。 */
  function _boardTalkPending() {
    if (!_state || _state.finished) return false;
    if (_state.round !== 0) return false;
    var bt = _state.boardTalk;
    return !(bt && bt.season === (_state.season || 1));
  }

  // ★ 呼び出しは小文字('accept'/'lower'/'raise')、定義は大文字。必ずここで正規化する
  //   （黙って ACCEPT にフォールバックすると「下げた/宣言した」が無効化されて気づけない）。
  function _boardDef(kind) { return BOARD_TUNING[String(kind || '').toUpperCase()] || null; }

  function _applyBoardTalk(kind) {
    if (!_state || !_state.manager || !_boardTalkPending()) return;
    var d = _boardDef(kind);
    if (!d) { console.warn('[league] 未知のボード選択:', kind); return; }
    var g = _ensureSeasonGoal();
    var n = CLUB_DEFS.length;
    if (g && d.goal) g.target = Math.max(1, Math.min(n - 1, g.target + d.goal));
    var m = _state.manager;
    if (d.trust) {
      var base = (typeof m.clubTrust === 'number') ? m.clubTrust : MANAGER_TUNING.TRUST_START;
      m.clubTrust = Math.max(0, Math.min(100, base + d.trust));
    }
    if (d.pop) m.params.popularity = Math.max(0, Math.min(MANAGER_TUNING.CAP, (m.params.popularity || 0) + d.pop));
    _state.boardTalk = { season: (_state.season || 1), choice: kind, goal: g ? g.target : null };
    _save();
    _renderHub(false);
  }

  /* ── BD-01 の面談は「専用の1ページ」（ハブの手前）─────────────────────────
   * 以前はシーズンハブの中央パネルに畳んでいたが、順位表・監督ステータスと同じ面に
   * 並ぶと **その季の全部を決める分岐が「画面の一部」に見えて流し読みされる**。
   * しかも3択が縦スクロールに埋まって3つ目が見えない。約束を交わすのは独立した
   * ビートなので、1画面まるごとを与える（1画面1ビート）。 */
  function _boardGoalLabel(t) {
    var n = CLUB_DEFS.length;
    t = Math.max(1, Math.min(n - 1, t));
    return t <= 1 ? _t('優勝', 'the title') : _t(t + '位以内', 'top ' + t);
  }

  /* 3択カード。効果は「目標／信頼／人気」の3チップに固定＝カード間で縦位置が揃い、
   * 何を差し出して何を得るのかが横並びで比較できる（±0 も省略せず必ず出す）。 */
  function _boardOptHTML(kind, tone, say, note, target) {
    var d = _boardDef(kind); if (!d) return '';
    function chip(dir, k, v) {
      return '<span class="lg-bd-chip ' + dir + '"><i>' + k + '</i><b>' + v + '</b></span>';
    }
    function sign(v) { return v > 0 ? '+' + v : (v < 0 ? '' + v : '±0'); }
    function dir(v) { return v > 0 ? 'up' : (v < 0 ? 'dn' : 'flat'); }
    var eff =
      chip(d.goal > 0 ? 'dn' : (d.goal < 0 ? 'up' : 'flat'), _t('目標', 'Target'), _boardGoalLabel(target + d.goal)) +
      chip(dir(d.trust), _t('信頼', 'Trust'), sign(d.trust)) +
      chip(dir(d.pop), _t('人気', 'Pop'), sign(d.pop));
    return '<button type="button" class="lg-bd-opt ' + kind + '" onclick="leagueBoardTalk(\'' + kind + '\')">' +
      '<span class="lg-bd-tone">' + _t(tone[0], tone[1]) + '</span>' +
      '<span class="lg-bd-say">「' + _t(say[0], say[1]) + '」</span>' +
      '<span class="lg-bd-eff">' + eff + '</span>' +
      '<span class="lg-bd-note">' + _t(note[0], note[1]) + '</span>' +
    '</button>';
  }

  function _boardPageHTML() {
    var g = _ensureSeasonGoal(); if (!g) return '';
    // 並びは「下げる → 受ける → 宣言する」＝左から野心が上がる（横並びの3枚は勾配で読ませる）。
    var opts =
      _boardOptHTML('lower',
        ['守りに入る', 'PLAY IT SAFE'],
        ['正直、その目標は高すぎます', 'Honestly, that target is too high.'],
        ['達成は楽になるが、走り出す前に信頼と人気を失う。', 'Easier to hit — but you lose trust and support before a ball is kicked.'],
        g.target) +
      _boardOptHTML('accept',
        ['約束どおり', 'ACCEPT'],
        ['承知しました。その目標でやります', 'Understood. I accept that target.'],
        ['増減なし。提示された目標のまま1年を戦う。', 'Nothing moves. You take the season on their terms.'],
        g.target) +
      _boardOptHTML('raise',
        ['打って出る', 'RAISE THE BAR'],
        ['それでは物足りない。もっと上を狙います', "That's not enough. We'll aim higher."],
        ['いま支持を得られるが、未達なら落差はそのまま跳ね返る。', 'Support now — but if you fall short, the drop is yours to wear.'],
        g.target);

    return '<section class="lg-se-zone lg-se-wide lg-bd">' +
      '<div class="lg-bd-art"><canvas data-labart="boardroom"></canvas></div>' +
      '<div class="lg-bd-say-wrap">' +
        '<span class="lg-bd-who">' + _t('会長', 'Chairman') + '</span>' +
        '<p class="lg-bd-q">' +
          _t('「今季、我々はあなたに<b>' + _boardGoalLabel(g.target) + '</b>を期待している。異論はあるかね？」',
             '"This season we expect <b>' + _boardGoalLabel(g.target) + '</b> from you. Any objection?"') +
        '</p>' +
      '</div>' +
      '<div class="lg-bd-opts">' + opts + '</div>' +
    '</section>';
  }

  /* 面談ページ。枠は最終話／シーズン前と同じ固定フレームを流用する（新しい枠を作らない）。
   * ★ 出口は3択そのもの＝「戻る」「次へ」は置かない（決めるまでハブに入れない）。 */
  function _renderBoardTalk() {
    _ensureStyle();
    var myId = _state.myClub, def = _clubDef(myId);
    var head = '<header class="lg-se-top">' +
      '<div class="lg-se-brand">' +
        '<span class="lg-se-emblem">🏛</span>' +
        '<div class="lg-se-brandtx">' +
          '<h1 class="lg-se-h1">' + _t('ボードとの面談', 'Meeting the board') + '</h1>' +
          '<span class="lg-se-hsub">' + def.crest + ' ' + _clubName(myId) +
            ' · Season ' + (_state.season || 1) + ' · ' + _t('開幕前', 'Before kick-off') + '</span>' +
        '</div>' +
      '</div>' +
      '<nav class="lg-se-steps"><span class="lg-se-step on"><i>◆</i>' +
        _t('就任の約束', 'The promise') + '</span></nav>' +
    '</header>';
    var hint = '<span class="lg-se-nb mid">' +
      _t('※ この約束はシーズン末に評価される', 'This promise is judged at the end of the season') + '</span>';
    _finPaint2('lg-bd-page', head, _boardPageHTML(), _finNavHTML(null, null, '', '', hint));
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * PC-01 記者会見（試合後・毎試合・選択に結果が伴う）
   * -----------------------------------------------------------------------
   * これまで「人気」と「クラブの信頼」は結果の関数でしか動かず、プレイヤーが
   * 触れるレバーが無かった。会見は **新しい数値を1つも足さずに** 既存の3通貨
   * （人気／クラブの信頼／選手の信頼）を選択で動かせる唯一の場にする。
   * ★ 支配的な選択肢を作らない＝どれかが常に最適にならないよう配分する。
   * ═══════════════════════════════════════════════════════════════════════ */
  var PRESS_TUNING = { SQUAD_MIN: 0, SQUAD_MAX: 100, POP_MIN: 0, TRUST_MIN: 0, TRUST_MAX: 100 };

  /* 質問は「その試合で実際に起きたこと」から選ぶ（上から順に最初に当たったもの）。
   * choices: pop=人気 / trust=クラブの信頼 / squad=選手の信頼（momOnly なら MOM のみ） */
  var PRESS_QUESTIONS = [
    {
      id: 'sacked_rumor',
      when: function (lr, c) { return (c.streakL >= 2) || (c.trust < 35); },
      q: ['解任の噂が出ています。進退についてどうお考えですか？', 'There are rumours about your future. What do you say?'],
      choices: [
        { id: 'shield', ja: '選手たちは全力でやっている。責めるなら私を', en: 'The players give everything. Blame me, not them.', pop: 0, trust: 2, squad: 6 },
        { id: 'own', ja: 'この順位は私の責任です。立て直す道筋はあります', en: 'This table is on me. I have a way back.', pop: -1, trust: 4, squad: 0 },
        { id: 'defiant', ja: '私はどこにも行きません。次節を見ていてください', en: "I'm going nowhere. Watch the next match.", pop: 3, trust: -2, squad: 2 }
      ]
    },
    {
      id: 'rival_win',
      when: function (lr) { return lr.mine.rival && lr.mine.res === 'W'; },
      q: ['宿敵を破りました。今の率直な気持ちを聞かせてください', 'You beat your rivals. How does it feel?'],
      choices: [
        { id: 'shield', ja: '選手が全てやってくれた。私は見ていただけです', en: 'The players did it all. I just watched.', pop: 1, trust: 0, squad: 6 },
        { id: 'own', ja: 'まだ1勝です。浮かれるつもりはありません', en: "It's one win. We stay grounded.", pop: 0, trust: 4, squad: 0 },
        { id: 'defiant', ja: '力の差を見せられたと思います', en: 'I think we showed the gap in quality.', pop: 4, trust: -2, squad: 1 }
      ]
    },
    {
      id: 'rival_loss',
      when: function (lr) { return lr.mine.rival && lr.mine.res === 'L'; },
      q: ['宿敵に敗れました。何が足りなかったのでしょう？', 'Beaten by your rivals. What was missing?'],
      choices: [
        { id: 'own', ja: '私の準備不足です。選手に非はありません', en: 'I under-prepared them. The players are not at fault.', pop: -1, trust: 4, squad: 4 },
        { id: 'shield', ja: '選手は戦いました。結果だけを受け止めます', en: 'They fought. I accept the result.', pop: 0, trust: 1, squad: 6 },
        { id: 'defiant', ja: '次は必ず借りを返します', en: "We'll settle this next time.", pop: 3, trust: -1, squad: 2 }
      ]
    },
    {
      id: 'heavy_loss',
      when: function (lr) { return (lr.mine.ms - lr.mine.os) <= -3; },
      q: ['この大敗、責任は誰にあるとお考えですか？', 'A heavy defeat. Who is responsible?'],
      choices: [
        { id: 'own', ja: '全て私の責任です', en: 'It is entirely on me.', pop: -1, trust: 5, squad: 1 },
        { id: 'shield', ja: '選手を守ります。彼らは最後まで走りました', en: 'I protect my players. They ran to the end.', pop: 0, trust: -1, squad: 7 },
        { id: 'excuse', ja: '今日は運がなかった、それだけです', en: 'We were simply unlucky today.', pop: -3, trust: -3, squad: 3 }
      ]
    },
    {
      id: 'big_win',
      when: function (lr) { return (lr.mine.ms - lr.mine.os) >= 3; },
      q: ['大勝でした。勝因はどこにありましたか？', 'A big win. What was behind it?'],
      choices: [
        { id: 'shield', ja: '選手の質です。私は何もしていません', en: 'The quality of the players. I did nothing.', pop: 1, trust: 0, squad: 6 },
        { id: 'own', ja: '準備してきた通りに出せた、それだけです', en: 'We executed exactly what we prepared.', pop: 0, trust: 4, squad: 1 },
        { id: 'defiant', ja: 'この程度で満足はしません。まだ上を目指せます', en: "This isn't enough. We can go higher.", pop: 4, trust: -1, squad: -1 }
      ]
    },
    {
      id: 'mom_star',
      when: function (lr) { return !!(lr.mine.mom && lr.mine.mom.goals >= 2); },
      qFn: function () { return ['%s選手の活躍が目立ちました。評価を聞かせてください', 'What did you make of %s today?']; },
      choices: [
        { id: 'praise', ja: '彼は特別な選手です。誇りに思います', en: 'He is special. I am proud of him.', pop: 2, trust: 0, squad: 6 },
        { id: 'team', ja: 'チーム全体の成果です。彼一人の力ではない', en: "It's the whole team's work, not one man's.", pop: 0, trust: 3, squad: 2 },
        { id: 'harsh', ja: 'まだ物足りない。彼はもっとやれます', en: 'Not enough. He can do much more.', pop: 1, trust: 3, squad: -5, momOnly: true }
      ]
    },
    {
      id: 'off_track',
      when: function (lr, c) { return c.offTrack; },
      q: ['目標の達成は現実的だとお考えですか？', 'Is the target still realistic?'],
      choices: [
        { id: 'own', ja: '必ず届かせます。約束します', en: 'We will get there. I promise that.', pop: 1, trust: 4, squad: 1 },
        { id: 'shield', ja: '厳しいのは事実です。一戦ずつ積み上げます', en: "It's hard. We take it one match at a time.", pop: 0, trust: 1, squad: 5 },
        { id: 'blame_board', ja: 'そもそも目標設定が高すぎたのではないですか', en: 'Perhaps the target was set too high to begin with.', pop: 2, trust: -5, squad: 2 }
      ]
    },
    {
      id: 'normal_win',
      when: function (lr) { return lr.mine.res === 'W'; },
      q: ['今日の勝因はどこにありましたか？', 'What won you the match today?'],
      choices: [
        { id: 'shield', ja: '選手がよく走ってくれました', en: 'The players worked incredibly hard.', pop: 1, trust: 0, squad: 5 },
        { id: 'own', ja: '狙い通りの試合運びができました', en: 'The game plan worked as intended.', pop: 0, trust: 3, squad: 1 },
        { id: 'defiant', ja: '当然の結果です。まだ通過点にすぎません', en: 'As expected. This is only a step.', pop: 3, trust: -1, squad: 0 }
      ]
    },
    {
      id: 'normal_draw',
      when: function (lr) { return lr.mine.res === 'D'; },
      q: ['勝ち切れませんでした。どう受け止めていますか？', "You couldn't see it out. How do you view it?"],
      choices: [
        { id: 'own', ja: '仕留められなかったのは私の采配の問題です', en: 'Failing to kill it off is on my decisions.', pop: -1, trust: 4, squad: 2 },
        { id: 'shield', ja: '選手はよくやりました。勝点1を持ち帰ります', en: 'They did well. We take the point.', pop: 0, trust: 1, squad: 5 },
        { id: 'defiant', ja: '正直、勝てた試合を落としたと思っています', en: 'Honestly, we dropped two points today.', pop: 2, trust: 0, squad: -2 }
      ]
    },
    {
      id: 'normal_loss',
      when: function () { return true; },   // 最終フォールバック（必ずどれかに当たる）
      q: ['敗因をどう見ていますか？', 'How do you explain the defeat?'],
      choices: [
        { id: 'own', ja: '私の責任です。次までに修正します', en: 'On me. I will fix it before the next one.', pop: -1, trust: 4, squad: 1 },
        { id: 'shield', ja: '選手は戦いました。批判は私に向けてください', en: 'They fought. Aim the criticism at me.', pop: 0, trust: 0, squad: 6 },
        { id: 'defiant', ja: '内容は悪くない。続けていれば結果はついてきます', en: 'The performance was fine. Results will follow.', pop: 2, trust: -2, squad: 2 }
      ]
    }
  ];

  /* 会見の文脈（質問の選択に使う）。 */
  function _pressCtx() {
    var st = _currentStreak();
    var m = _state.manager || { params: {} };
    return {
      streakL: (st.res === 'L') ? st.n : 0,
      streakW: (st.res === 'W') ? st.n : 0,
      trust: Math.round((typeof m.clubTrust === 'number') ? m.clubTrust : MANAGER_TUNING.TRUST_START),
      offTrack: !_goalMet(_position(_state.myClub))
    };
  }

  function _pressQuestion(lr) {
    if (!lr || !lr.mine) return null;
    var c = _pressCtx();
    for (var i = 0; i < PRESS_QUESTIONS.length; i++) {
      var q = PRESS_QUESTIONS[i];
      try { if (q.when(lr, c)) return q; } catch (e) { /* 条件で落ちても会見自体は止めない */ }
    }
    return null;
  }

  function _pressQuestionText(q, lr) {
    var pair = q.qFn ? q.qFn(lr) : q.q;
    var txt = _t(pair[0], pair[1]);
    if (txt.indexOf('%s') >= 0) txt = txt.replace('%s', (lr.mine.mom && lr.mine.mom.name) || '');
    return txt;
  }

  /* 会見の結果を適用する。★ 表示用の lr.manager.popularity/trust の内訳にも
   * 「記者会見」を足すので、次のコマ（今週の成果）に因果がそのまま出る。 */
  function _applyPress(lr, ch) {
    if (!_state || !_state.manager || !ch) return null;
    // ★ 冪等: 同じ試合の会見は1度だけ効かせる（再生・再入で二重に加算しない）
    if (lr.press && lr.press.choiceId) return lr.press.effects;
    var m = _state.manager;
    var out = { pop: 0, trust: 0, squad: 0, momOnly: !!ch.momOnly, names: [] };

    if (ch.pop) {
      m.params.popularity = Math.max(PRESS_TUNING.POP_MIN,
        Math.min(MANAGER_TUNING.CAP, (m.params.popularity || 0) + ch.pop));
      out.pop = ch.pop;
      var P = lr.manager && lr.manager.popularity;
      if (P) {
        P.delta = Math.round((P.delta + ch.pop) * 10) / 10;
        P.value = m.params.popularity;
        // 既存の 'press' は置き換える（内訳に同じ行が並ぶのを防ぐ）
        P.parts = (P.parts || []).filter(function (x) { return x.k !== 'press'; })
          .concat([{ k: 'press', v: ch.pop }]);
      }
    }
    if (ch.trust) {
      var base = (typeof m.clubTrust === 'number') ? m.clubTrust : MANAGER_TUNING.TRUST_START;
      m.clubTrust = Math.max(PRESS_TUNING.TRUST_MIN, Math.min(PRESS_TUNING.TRUST_MAX, base + ch.trust));
      out.trust = ch.trust;
      var T = lr.manager && lr.manager.trust;
      if (T) {
        T.delta = Math.round((T.delta + ch.trust) * 10) / 10;
        T.value = m.clubTrust;
        T.parts = (T.parts || []).filter(function (x) { return x.k !== 'press'; })
          .concat([{ k: 'press', v: ch.trust }]);
      }
    }
    // ★ MG-12（選手の信頼）をここで初めて「効く数値」にする（→ 個人練習の伸びに乗る）
    if (ch.squad) {
      out.squad = ch.squad;
      var myId = lr.mine.me;
      function bump(key) {
        var e = _squadEntry(myId, key);
        e.trust = Math.max(PRESS_TUNING.SQUAD_MIN,
          Math.min(PRESS_TUNING.SQUAD_MAX, ((typeof e.trust === 'number') ? e.trust : MANAGER_TUNING.TRUST_START) + ch.squad));
      }
      if (ch.momOnly && lr.mine.mom) {
        // ★ MOM は表示名(p.name)で記録される。squads のキーは _playerKey(=long_name||name)
        //   なので、名前をそのまま渡すと別キーの幽霊エントリが増えて誰にも当たらない。
        bump(_squadKeyByName(myId, lr.mine.mom.name));
        out.names = [lr.mine.mom.name];
      } else {
        var td = _clubData(myId);
        if (td && td.players) td.players.forEach(function (p) { bump(_playerKey(p)); });
      }
    }

    lr.press = { qid: lr.press && lr.press.qid, choiceId: ch.id, effects: out };
    _save();
    return out;
  }

  function _pressHTML(q, lr) {
    var opts = q.choices.map(function (ch, idx) {
      return '<button type="button" class="lg-press-opt" data-press="' + idx + '">' +
        '<span class="lg-press-say">「' + _t(ch.ja, ch.en) + '」</span></button>';
    }).join('');
    return '<div class="lg-card lg-press">' +
      '<div class="lg-press-art"><canvas data-labart="press_wall"></canvas></div>' +
      '<div class="lg-press-fg">' +
        '<div class="lgp-kicker">' + _t('記者会見', 'PRESS CONFERENCE') + '</div>' +
        '<div class="lg-press-q"><span class="lg-press-mic">🎙</span>' +
          '<span class="lg-press-qt">' + _pressQuestionText(q, lr) + '</span></div>' +
        '<div class="lg-press-opts">' + opts + '</div>' +
      '</div></div>';
  }

  function _pressResultHTML(ch, eff) {
    function chip(label, v) {
      if (!v) return '';
      return '<span class="lg-press-eff ' + (v > 0 ? 'up' : 'down') + '">' + label + ' ' +
        (v > 0 ? '+' : '') + v + '</span>';
    }
    var who = (eff.momOnly && eff.names.length) ? eff.names[0] + _t('の信頼', ' trust')
                                                : _t('選手の信頼', 'Squad trust');
    return '<div class="lg-card lg-press answered">' +
      '<div class="lg-press-art"><canvas data-labart="press_wall"></canvas></div>' +
      '<div class="lg-press-fg">' +
        '<div class="lgp-kicker">' + _t('記者会見', 'PRESS CONFERENCE') + '</div>' +
        '<div class="lg-press-said">「' + _t(ch.ja, ch.en) + '」</div>' +
        '<div class="lg-press-effs">' +
          chip(_t('人気', 'Popularity'), eff.pop) +
          chip(_t('クラブの信頼', 'Club trust'), eff.trust) +
          chip(who, eff.squad) +
        '</div>' +
        '<button type="button" class="lg-btn sec lg-press-next">' + _t('続ける', 'Continue') + '</button>' +
      '</div></div>';
  }

  /* 会見コマの配線。答えるまで next() を呼ばない＝シーケンスは止まったまま。 */
  function _bindPress(el, q, lr, next) {
    var answered = false;
    el.addEventListener('click', function (e) {
      e.stopPropagation();   // ★ オーバーレイのタップ送りへ伝播させない
      var t = e.target;
      var opt = (t && t.closest) ? t.closest('.lg-press-opt') : null;
      if (opt && !answered) {
        answered = true;
        var ch = q.choices[parseInt(opt.getAttribute('data-press'), 10)];
        if (!ch) { next(); return; }
        var eff = _applyPress(lr, ch) || { pop: 0, trust: 0, squad: 0, momOnly: false, names: [] };
        el.innerHTML = _pressResultHTML(ch, eff);
        _paintPortraitCanvases(el);
        // フラッシュは「画像の帯」の中だけで焚く（本文の上で光らせない）
        if (_juiceOn() && Juice.flash) Juice.flash(el.querySelector('.lg-press-art') || el, { count: 4 });
        if (_juiceOn()) Juice.reveal(el.querySelector('.lg-press-said'), { dur: 320 });
        return;
      }
      if (answered && t && t.closest && t.closest('.lg-press-next')) next();
    });
  }

  /* ST-01: 試合詳細スタッツ（シングルマッチ後スタッツの転用・AI総括は入れない）。
   * chanceResults から集計＝narration.js の showResult と同じ算出。t1=自チーム / t2=相手
   * （監督ビューアは常に team1=自）。得点者・デュエル勝率・GKセーブ率・選手別関与・攻撃
   * パターン別ゴールまで採取して lastResult に保存＝カードデッキ／記録タブから再表示できる。 */
  function _computeMatchStats() {
    if (typeof chanceResults === 'undefined' || !chanceResults) return null;
    if (typeof gameState === 'undefined' || !gameState || !gameState.team1) return null;
    var t1 = gameState.team1, t2 = gameState.team2;
    var s = {
      t1: { ch: 0, sh: 0, gk: 0, atk: 0 }, t2: { ch: 0, sh: 0, gk: 0, atk: 0 },
      scorers1: [], scorers2: [],
      duels1: {}, duels2: {},   // name -> {w,l}
      gk1: { save: 0, goal: 0 }, gk2: { save: 0, goal: 0 },
      inv1: {}, inv2: {},       // name -> count（関与シーン数）
      patterns: {}              // 'me'|'opp'+'|'+action -> count
    };
    function _duelTgt(team) { return _sameTeam(team, t1) ? s.duels1 : _sameTeam(team, t2) ? s.duels2 : null; }
    chanceResults.forEach(function (res) {
      if (!res || !res.scenes) return;
      var c1 = false, c2 = false;
      res.scenes.forEach(function (sc) {
        if (_sameTeam(sc.offence, t1)) s.t1.atk++; else if (_sameTeam(sc.offence, t2)) s.t2.atk++;
        var isShoot = (sc.result === 'ゴール！！' || sc.result === 'GK防いだ！' || sc.result === '枠を外した！');
        var isNormal = (sc.result === '成功' || sc.result === '失敗' || sc.result === 'ファール');
        // 関与シーン数（攻撃側の起点選手）
        var op = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
        if (op) { var inv = _sameTeam(sc.offence, t1) ? s.inv1 : _sameTeam(sc.offence, t2) ? s.inv2 : null; if (inv) inv[op.name] = (inv[op.name] || 0) + 1; }
        if (!isShoot && !isNormal) return;
        if (isShoot || (sc.area && sc.area.substring(0, 2) === 'FW')) {
          if (_sameTeam(sc.offence, t1) && !c1) { s.t1.ch++; c1 = true; }
          if (_sameTeam(sc.offence, t2) && !c2) { s.t2.ch++; c2 = true; }
        }
        if (isShoot) {
          if (_sameTeam(sc.offence, t1)) s.t1.sh++; else if (_sameTeam(sc.offence, t2)) s.t2.sh++;
          // 得点者
          if (sc.result === 'ゴール！！' && op) {
            (_sameTeam(sc.offence, t1) ? s.scorers1 : s.scorers2).push({ time: res.time, name: op.name });
            var pat = sc.action || sc.scenario || '?';
            var pk = (_sameTeam(sc.offence, t1) ? 'me' : 'opp') + '|' + pat;
            s.patterns[pk] = (s.patterns[pk] || 0) + 1;
          }
          // GKセーブ率（守備側GK）
          var gkt = _sameTeam(sc.defence, t1) ? s.gk1 : _sameTeam(sc.defence, t2) ? s.gk2 : null;
          if (gkt) { if (sc.result === 'GK防いだ！') gkt.save++; else gkt.goal++; }
        }
        if (sc.result === 'GK防いだ！') { if (_sameTeam(sc.defence, t1)) s.t1.gk++; else if (_sameTeam(sc.defence, t2)) s.t2.gk++; }
        // デュエル（成功/ファール=攻撃勝ち / 失敗=守備勝ち）
        if (isNormal) {
          var win = (sc.result === '成功' || sc.result === 'ファール');
          var ofp = op, dfp = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[sc.dfsPos]];
          var ot = _duelTgt(sc.offence), dt = _duelTgt(sc.defence);
          if (ofp && ot) { if (!ot[ofp.name]) ot[ofp.name] = { w: 0, l: 0 }; win ? ot[ofp.name].w++ : ot[ofp.name].l++; }
          if (dfp && dt) { if (!dt[dfp.name]) dt[dfp.name] = { w: 0, l: 0 }; win ? dt[dfp.name].l++ : dt[dfp.name].w++; }
        }
      });
    });
    var tot = s.t1.atk + s.t2.atk || 1;
    s.t1.poss = Math.round(s.t1.atk / tot * 100);
    s.t2.poss = 100 - s.t1.poss;
    // 保存を軽くするため、デュエル/関与は配列化＋上位に絞る
    function _duelArr(o) {
      return Object.keys(o).map(function (n) { return { name: n, w: o[n].w, l: o[n].l }; })
        .sort(function (a, b) { return (b.w + b.l) - (a.w + a.l); });
    }
    function _invArr(o) {
      return Object.keys(o).map(function (n) { return { name: n, c: o[n] }; })
        .sort(function (a, b) { return b.c - a.c; }).slice(0, 5);
    }
    s.duels1 = _duelArr(s.duels1); s.duels2 = _duelArr(s.duels2);
    s.inv1 = _invArr(s.inv1); s.inv2 = _invArr(s.inv2);
    s.patterns = Object.keys(s.patterns).map(function (k) {
      var p = k.split('|'); return { side: p[0], action: p[1], count: s.patterns[k] };
    }).sort(function (a, b) { return b.count - a.count; });
    return s;
  }

  /* 試合スタッツのカード HTML（AI総括以外の全項目）。自チーム(左)＝t1 / 相手(右)＝t2。 */
  function _matchStatsHTML(lr) {
    var s = lr && lr.stats;
    if (!s) return '';
    var myDef = _clubDef(lr.mine.me), opDef = _clubDef(lr.mine.opp);
    var myCol = (myDef && myDef.color) || '#4a9eff', opCol = (opDef && opDef.color) || '#e8776f';
    var myName = _clubName(lr.mine.me), opName = _clubName(lr.mine.opp);

    function bar() {
      return '<div class="lg-stat-poss">' +
        '<span class="lg-stat-pv" style="color:' + myCol + '">' + s.t1.poss + '%</span>' +
        '<span class="lg-stat-bar">' +
          '<i style="width:' + s.t1.poss + '%;background:' + myCol + '"></i>' +
          '<i style="width:' + s.t2.poss + '%;background:' + opCol + '"></i></span>' +
        '<span class="lg-stat-pv" style="color:' + opCol + '">' + s.t2.poss + '%</span></div>';
    }
    function row(l, label, r) {
      return '<div class="lg-stat-row"><span class="lg-stat-n">' + l + '</span>' +
        '<span class="lg-stat-l">' + label + '</span>' +
        '<span class="lg-stat-n">' + r + '</span></div>';
    }
    function sub(t) { return '<div class="lg-stat-sub">' + t + '</div>'; }

    // 得点者
    var scorers = '';
    if ((s.scorers1 && s.scorers1.length) || (s.scorers2 && s.scorers2.length)) {
      var l1 = (s.scorers1 || []).map(function (g) { return '<div style="text-align:left;color:' + myCol + '">' + g.time + ' ' + g.name + '</div>'; }).join('');
      var l2 = (s.scorers2 || []).map(function (g) { return '<div style="text-align:right;color:' + opCol + '">' + g.name + ' ' + g.time + '</div>'; }).join('');
      scorers = sub('⚽ ' + _t('得点者', 'Goalscorers')) +
        '<div class="lg-stat-scorers"><div>' + l1 + '</div><div>' + l2 + '</div></div>';
    }

    // デュエル勝率（チームごと・上位）
    function duelTable(arr, col, name) {
      if (!arr || !arr.length) return '';
      var rows = arr.slice(0, 8).map(function (d) {
        var t = d.w + d.l, rate = t ? Math.round(d.w / t * 100) : 0;
        return '<div class="lg-duel-row"><span class="lg-duel-nm">' + d.name + '</span>' +
          '<span class="lg-duel-bar"><i style="width:' + rate + '%;background:' + col + '"></i></span>' +
          '<span class="lg-duel-rt">' + rate + '%</span>' +
          '<span class="lg-duel-wl">' + d.w + _t('勝', 'W') + d.l + _t('敗', 'L') + '</span></div>';
      }).join('');
      return '<div class="lg-duel-team" style="border-left:3px solid ' + col + '">' +
        '<div class="lg-duel-h">' + name + '</div>' + rows + '</div>';
    }
    var duels = '';
    if ((s.duels1 && s.duels1.length) || (s.duels2 && s.duels2.length)) {
      duels = sub('⚔ ' + _t('デュエル勝率', 'Duel win rate')) +
        duelTable(s.duels1, myCol, myName) + duelTable(s.duels2, opCol, opName);
    }

    // GKセーブ率
    function gkLine(g, col, name) {
      var t = g.save + g.goal; if (!t) return '';
      var rate = Math.round(g.save / t * 100);
      return '<div class="lg-duel-row"><span class="lg-duel-nm">' + name + '</span>' +
        '<span class="lg-duel-bar"><i style="width:' + rate + '%;background:' + col + '"></i></span>' +
        '<span class="lg-duel-rt">' + rate + '%</span>' +
        '<span class="lg-duel-wl">' + g.save + _t('セーブ', 'S') + '/' + t + '</span></div>';
    }
    var gkr = gkLine(s.gk1, myCol, myName) + gkLine(s.gk2, opCol, opName);
    if (gkr) gkr = sub('🧤 ' + _t('GKセーブ率', 'GK save rate')) + gkr;

    // 選手別関与シーン数（上位5）
    function invList(arr, col) {
      if (!arr || !arr.length) return '';
      var mx = arr[0].c || 1;
      return '<div class="lg-inv-col">' + arr.map(function (v, i) {
        var medal = ['🥇', '🥈', '🥉'][i] || '　';
        var pct = Math.round(v.c / mx * 100);
        return '<div class="lg-inv-row"><span class="lg-inv-nm">' + medal + ' ' + v.name + '</span>' +
          '<span class="lg-inv-c">' + v.c + '</span>' +
          '<span class="lg-inv-bar"><i style="width:' + pct + '%;background:' + col + '"></i></span></div>';
      }).join('') + '</div>';
    }
    var inv = '';
    if ((s.inv1 && s.inv1.length) || (s.inv2 && s.inv2.length)) {
      inv = sub('👟 ' + _t('選手別 関与シーン数', 'Involvement')) +
        '<div class="lg-inv-grid">' + invList(s.inv1, myCol) + invList(s.inv2, opCol) + '</div>';
    }

    // 攻撃パターン別ゴール
    var patt = '';
    if (s.patterns && s.patterns.length) {
      patt = sub('🎯 ' + _t('攻撃パターン別ゴール', 'Goals by pattern')) +
        s.patterns.map(function (p) {
          var col = (p.side === 'me') ? myCol : opCol, nm = (p.side === 'me') ? myName : opName;
          var label = (typeof getActionLabel === 'function') ? getActionLabel(p.action) : p.action;
          return '<div class="lg-patt-row"><span style="color:' + col + ';font-weight:700;min-width:5em">' + nm + '</span>' +
            '<span style="flex:1">' + label + '</span><span style="font-weight:800">⚽×' + p.count + '</span></div>';
        }).join('');
    }

    // 試合詳細（実況ログ）はデッキ(z400)より下(z200)になり隠れるため、ここには埋め込まず
    //   案内だけ出す。実況ログは監督室の「記録」タブ →「前回の試合ログ」で全文が読める。
    var logHint = (lr.log && lr.log.length)
      ? '<div class="lg-stat-loghint">📜 ' + _t('実況ログは監督室の「記録」タブで読めます', 'Full play-by-play is in the Records tab') + '</div>'
      : '';

    return '<div class="lg-card lg-stats">' +
      '<div class="lgp-kicker" style="text-align:center">' + _t('試合スタッツ', 'MATCH STATS') + '</div>' +
      '<div class="lg-stat-head">' +
        '<span style="color:' + myCol + '">' + (myDef ? myDef.crest : '') + ' ' + myName + '</span>' +
        '<span class="lg-stat-score">' + lr.mine.ms + ' - ' + lr.mine.os + '</span>' +
        '<span style="color:' + opCol + '">' + opName + ' ' + (opDef ? opDef.crest : '') + '</span>' +
      '</div>' +
      '<div class="lg-stat-plabel">' + _t('ポゼッション', 'Possession') + '</div>' + bar() +
      '<div class="lg-stat-grid">' +
        row(s.t1.ch, _t('チャンス', 'Chances'), s.t2.ch) +
        row(s.t1.sh, _t('シュート', 'Shots'), s.t2.sh) +
        row(s.t1.gk, _t('GKセーブ', 'GK Saves'), s.t2.gk) +
      '</div>' +
      scorers + gkr + duels + inv + patt + logHint +
      '</div>';
  }

  /* UX-04: 試合後を「今節の号」として1コマずつ開く。
   * 各パネルの HTML は既存ビルダをそのまま再利用＝文言・ロジックを二重管理しない。 */
  function _postMatchPanels(lr) {
    var myId = lr.mine.me, oppId = lr.mine.opp;
    var myDef = _clubDef(myId), oppDef = _clubDef(oppId);
    var col = _resultColor(lr.mine.res);
    var resTxt = lr.mine.res === 'W' ? _t('勝利！', 'WIN!') : lr.mine.res === 'L' ? _t('敗戦', 'LOSS') : _t('引き分け', 'DRAW');
    var panels = [];

    // ① スコア — カウントアップ＋結果スタンプ（勝てば紙吹雪）
    panels.push({
      id: 'score', sfx: 'whistle', hold: 260,
      html: '<div class="lg-hero lgp-score" style="background:linear-gradient(135deg,' + col + '33,rgba(0,0,0,0.25));border:1px solid ' + col + '66">' +
        '<div class="lg-resbadge lgp-stamp" style="text-align:center;color:' + col + '">' + resTxt + '</div>' +
        '<div class="lg-vs">' +
          '<div class="side"><div class="crest">' + myDef.crest + '</div><div class="nm">' + _clubName(myId) + '</div></div>' +
          '<div class="mid"><b data-lgc="' + lr.mine.ms + '">0</b> - <b data-lgc="' + lr.mine.os + '">0</b></div>' +
          '<div class="side"><div class="crest">' + oppDef.crest + '</div><div class="nm">' + _clubName(oppId) + '</div></div>' +
        '</div></div>',
      onShow: function (el, firstTime) {
        if (!_juiceOn()) return;
        Array.prototype.forEach.call(el.querySelectorAll('[data-lgc]'), function (n) {
          Juice.countUp(n, parseInt(n.getAttribute('data-lgc'), 10) || 0, { dur: 520 });
        });
        // 祝祭は初見のときだけ（戻って見返すたびに紙吹雪が出ると安っぽい）
        if (firstTime && lr.mine.res === 'W') Juice.confetti(el, { colors: [myDef.color, '#ffd24a', '#ffffff'] });
      }
    });

    // ② 見出し — 記者会見のバックパネルに叩きつける
    panels.push({
      id: 'headline', sfx: 'stamp',
      html: '<div class="lg-card lgp-headline">' +
        '<div class="lgp-kicker">' + _t('試合後', 'FULL TIME') + '</div>' +
        '<div class="lgp-h1">' + _headlineText(lr) + '</div></div>'
    });

    // ③ MOM・得点者（無い試合＝無得点でMOM未選出なら丸ごと省く）
    var ms = _momScorersHTML(lr);
    if (ms) {
      panels.push({
        id: 'report', sfx: 'ping',
        html: '<div class="lg-card"><div class="lgp-kicker">' + _t('この試合の主役', 'Standout') + '</div>' +
          '<div class="lg-mini" style="text-align:center;line-height:1.9;font-size:13px">' + ms + '</div></div>'
      });
    }

    // ST-01 試合スタッツ（シングルマッチ後スタッツの転用・AI総括なし）
    var statsHTML = _matchStatsHTML(lr);
    if (statsHTML) {
      panels.push({
        id: 'stats', sfx: 'tick',
        html: statsHTML,
        onShow: function (el, firstTime) {
          if (!firstTime || !_juiceOn()) return;
          // 数値をカウントアップ＋ポゼッションバーを伸ばす（手触り）
          Array.prototype.forEach.call(el.querySelectorAll('.lg-stat-n'), function (n) {
            var to = parseInt(n.textContent, 10); if (!isNaN(to)) Juice.countUp(n, to, { dur: 500 });
          });
        }
      });
    }

    // MTG1-#1 監督のジャッジ（采配の答え合わせ）— attribution.js 非同梱/キルOFF/介入なしは丸ごと省く
    if (typeof attributionJudgePanel === 'function') {
      var judgeHTML = attributionJudgePanel();
      if (judgeHTML) panels.push({ id: 'judge', sfx: 'stamp', html: judgeHTML });
    }

    // MTG1-#5 推しの今日 — oshi.js 非同梱/キルOFF/未指名/推しが出場していない試合は null
    if (typeof oshiTodayPanel === 'function') {
      var oshiPanel = oshiTodayPanel(lr);
      if (oshiPanel) panels.push(oshiPanel);
    }

    // ④ 順位変動＋他会場
    panels.push({
      id: 'table', sfx: 'tick',
      html: '<div class="lg-card"><div class="lgp-kicker">' + _t('順位', 'Table') + '</div>' +
        '<div class="lg-mini" style="text-align:center;margin-bottom:6px">' + _reviewText(lr) + '</div>' +
        _standingsTableHTML(_sortedStandings(), myId,
          { move: { id: myId, from: lr.mine.posBefore, to: lr.mine.posAfter } }) +
        _otherResultsHTML(lr) + '</div>',
      onShow: function (el) {
        if (!_juiceOn()) return;
        Juice.stagger(el.querySelectorAll('.lg-tbl-row, .lg-table tr'), { dur: 240, step: 38 });
      }
    });

    // ⑤ PC-01 記者会見（毎試合・答えるまで先へ進まない）
    //    ★ ここで人気/クラブ信頼/選手信頼が動き、次の「今週の成果」に即反映される。
    var pq = _pressQuestion(lr);
    if (pq) {
      panels.push({
        id: 'press', sfx: 'flash',
        html: function () { return _pressHTML(pq, lr); },
        onShow: function (el, firstTime) {
          _paintPortraitCanvases(el);
          if (firstTime && _juiceOn() && Juice.flash) {
            Juice.flash(el.querySelector('.lg-press-art') || el, { count: 3 });
          }
        },
        await: function (el, next) { _bindPress(el, pq, lr, next); }
      });
    }

    // ⑥ 今週の成果（成長・人気・信頼）— 戦術習得はファンファーレ
    //    ★ html を関数にして「表示する瞬間」に組む＝会見の結果が数字に乗る。
    if (_managerGrowthHTML(lr)) {
      panels.push({
        id: 'growth', sfx: (lr.manager && lr.manager.unlocked) ? 'fanfare' : 'coin',
        html: function () { return '<div class="lg-card">' + _managerGrowthHTML(lr) + '</div>'; }
      });
    }

    // ⑥ WEEKLY BEST XI（誌面の見開き）
    if (lr.bestXI) {
      panels.push({
        id: 'bestxi', sfx: 'page',
        html: _bestXIHTML(lr.bestXI, 'weekly', 'WEEKLY BEST XI', 'WEEKLY BEST XI',
          '第' + (lr.round + 1) + '節号', 'Round ' + (lr.round + 1) + ' issue'),
        onShow: function (el) { _paintPortraitCanvases(el); }
      });
    }

    // ⑦ 次回予告（クリフハンガー）
    //   MTG1-#3: レール有効時は「終幕ビート」（緊張の在庫＋ストリーク＋また明日）に差し替える。
    //   ★ 2枚並べない＝1画面1ビート。rail.js 未搭載/キルOFFなら従来の次回予告のまま。
    var railFin = (typeof Rail !== 'undefined' && Rail.finalePanel) ? Rail.finalePanel() : null;
    if (railFin) panels.push(railFin);
    else {
      var prev = _previewHTML();
      if (prev) panels.push({ id: 'preview', sfx: 'page', html: prev });
    }

    return panels;
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

  /* ══ MTG1: マーク対象の自動選択（2026-08-04 修正）═══════════════════════════
   * ★ バグ: team1State.marked_player は「**相手チームの players 配列の index**」なのに、
   *   出どころの TEAM_DATA[x].default_marked_player は **対戦相手を問わないチーム単位の既定値**
   *   として持たれている。相手が変われば同じ index が相手の先発XIに居ないことが普通に起きる
   *   （例 england2026.default_marked_player=10 → ベルギーの players[10]=ルカクは非先発）。
   *   リーグ8クラブの総当り56通りのうち19通り（34%）で「ピッチにいない選手をマークし続ける」
   *   死んだ采配になっていた（simulate.js の判定は offence.lineup[ofsPos] との一致を見るため、
   *   ベンチの選手を指していると係数が一度も乗らない）。
   * ★ 直し方: 実際の相手先発XI（_overlaySquad 適用後）に居ない指名は、**決定論で**選び直す。
   *     ① 相手の default_keyplayer が先発XIに居ればそれ（＝最も危険な先発）
   *     ② 居なければ攻撃系 param の合計が最大のフィールド先発（同点は lineup の並び順で安定）
   *   GK（lineup の 0 番）は既存UIと同じ規約で対象外。rng は一切使わない。
   * ⚠️ 同じ潜在バグは **シングルマッチ / W杯にも残っている**（js/simulate.js の
   *   `marked_player: data.default_marked_player` 初期化・selectTeam2/startGame 経路）。
   *   本番凍結中のため今回は触らず、修正はリーグ経路（この関数）に閉じる。 */
  var MARK_ATTACK_IDX = [
    DRIBBLE_ACCURACY, DRIBBLE_SPEED, SHORTPASS, LONGPASS,
    SHOOT_ACCURACY, SHOOT_MAKING, SHOOT_TECH, BALL_TECH, OFFENSIVE
  ];
  function _markAttackScore(p) {
    if (!p || !p.params) return -1;
    var s = 0;
    for (var i = 0; i < MARK_ATTACK_IDX.length; i++) {
      var v = p.params[MARK_ATTACK_IDX[i]];
      s += (typeof v === 'number') ? v : 0;
    }
    return s;
  }
  /* 相手の先発XI（GK除く）に居る player index だけを返す。異常な入力でも例外は投げず -1。 */
  function _validMarkedPlayer(oppData, want) {
    if (!oppData || !oppData.players || !Array.isArray(oppData.default_lineup)) return -1;
    var lineup = oppData.default_lineup.slice(0, 11);
    var field = {};   // GK（枠0）を除く先発の player index
    for (var i = 1; i < lineup.length; i++) {
      var idx = lineup[i];
      if (typeof idx === 'number' && idx >= 0 && idx < oppData.players.length) field[idx] = true;
    }
    if (typeof want === 'number' && want >= 0 && field[want]) return want;   // 既に有効ならそのまま

    // ① 相手のキープレイヤー（default_keyplayer は **lineup の枠番号**）が先発XIに居れば最優先
    var kp = oppData.default_keyplayer;
    if (typeof kp === 'number' && kp >= 1 && kp < lineup.length) {
      var kpIdx = lineup[kp];
      if (typeof kpIdx === 'number' && field[kpIdx]) return kpIdx;
    }
    // ② 攻撃系 param が最大のフィールド先発（同点は lineup の並び順で決着＝安定・決定論）
    var best = -1, bestScore = -1;
    for (var j = 1; j < lineup.length; j++) {
      var pi = lineup[j];
      if (typeof pi !== 'number' || !field[pi]) continue;
      var sc = _markAttackScore(oppData.players[pi]);
      if (sc > bestScore) { bestScore = sc; best = pi; }
    }
    return best;
  }

  /* ── 試合起動（自チーム = 監督ビューア） ─────────────────────────────── */
  // UX-03: 導入の再生中に再入すると、オーバーレイが重なり startManagerMatch も二重に走る。
  var _preMatchRunning = false;
  var _pendingMatch = null;   // MD-01: 設定画面〜キックオフの間の対戦カード保持
  function playToday() {
    if (!_state || _state.finished) return;
    if (_lockedToday()) return;
    /* ★ このフラグは「試合前カットシーンが画面に出ている」の意味しか持たない。
     *   演出側のコールバックが失われるとフラグだけが残り、以後キックオフが永久に
     *   弾かれる（リロードするまで復帰不能）。オーバーレイが実在するかで突き合わせ、
     *   古いフラグは捨てる＝立ったまま戻ってこない状態を作らない。 */
    if (_preMatchRunning && !document.querySelector('.lg-md-ov.lg-md-pre')) _preMatchRunning = false;
    if (_preMatchRunning) return;   // 連打・二重呼び出しを弾く
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
    // ★ 自チームは前節の布陣を維持（欠場者もその位置に残す＝グレー表示＋キックオフで警告）。
    //   相手(team2)は自動除外＝合法布陣で戦う。
    team1Data = _overlaySquad(myId, { keepAbsent: true });
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
      captain: (typeof team1Data.captain === 'number') ? team1Data.captain : -1,
      lineup: team1Data.default_lineup.slice(0, 11)
    };

    // MD-02: 前節に組んだ布陣を復元（入れ替えた布陣を次節も覚えておく）。
    //   保存は leagueKickoff（＝実際に試合を始めた布陣だけ記憶）。欠場者が混じっていても
    //   そのまま復元し、設定画面でグレー＋キックオフ警告に任せる（＝入れ替えを促す）。
    var saved = _state.lineups && _state.lineups[myId];
    if (saved) {
      if (typeof saved.systemIdx === 'number' && system_data[saved.systemIdx]) team1State.systemIdx = saved.systemIdx;
      if (typeof saved.keyplayer === 'number') team1State.keyplayer = saved.keyplayer;
      // キャプテンの指名も次節へ持ち越す（スタメン外なら読む側＝effectiveCaptainIdx が自動選出に落とす）
      if (typeof saved.captain === 'number') team1State.captain = saved.captain;
      if (typeof saved.tactics === 'number' && _isTacticUnlocked(saved.tactics)) team1State.tactics = saved.tactics;
      if (Array.isArray(saved.lineup) && saved.lineup.length === 11 &&
          saved.lineup.every(function (i) { return typeof i === 'number' && i >= 0 && i < team1Data.players.length; })) {
        team1State.lineup = saved.lineup.slice();
      }
      // 将来セーブが marked を持つようになっても、入口でこの後の検証を必ず通す（MD-02 は未保存）
      if (typeof saved.marked_player === 'number') team1State.marked_player = saved.marked_player;
    }

    /* ★ マーク対象は「この試合の相手の実際の先発XI」に対して検証し、居なければ選び直す。
     *   クラブ既定値（default_marked_player）もセーブ復元値も、必ずここを通す。 */
    team1State.marked_player = _validMarkedPlayer(team2Data, team1State.marked_player);

    _htReset();   // HT-01: ハーフタイムの采配は1試合につき1回ずつ

    // 試合終了フック（_mvFinish が拾う。1回で自動解除）
    window._leagueOnMatchFinish = function () { _onMatchFinish(myId, oppId, iAmHome, fx); };

    // MD-01: 即キックオフをやめ、まず**試合設定画面**（スタメン/戦術/システム）を出す。
    //   キックオフはこの画面から（leagueKickoff）。戻る＝leagueCancelPrep で監督室へ。
    //   設定画面は既存インフラ（initSettingScreen / screen-setting）を流用。
    //   ★ team1State は上で「習得済み戦術」に制約して組んだので、initSettingScreen 側では
    //     上書きしない（window._leagueInMatch を見て team1State リセットを飛ばす）。
    _pendingMatch = { myId: myId, oppId: oppId, iAmHome: iAmHome, fx: fx };
    /* ★ 前試合の交代状態を、布陣画面を描く前に必ず捨てる（2026-08-06 バグ修正）。
     *   交代カウンタ/_subbedOff/_htMode のリセットは startManagerMatch の中にあるが、
     *   リーグは「布陣画面 →（キックオフ）→ startManagerMatch」の順なので、この画面には
     *   前試合の残骸が乗ったまま来ていた（前節に退いた選手がベンチでグレー＝掴めない／
     *   _htMode が残ると試合前の入れ替えが交代扱いになり即グレー）。
     *   simulate.js 非同梱の環境では no-op（typeof ガード）＝公開版に波及しない。 */
    if (typeof resetSubStateForPrep === 'function') resetSubStateForPrep();
    window._leagueInMatch = true;
    _settingBackScreen = 'home';   // フォールバック（実際の戻るは settingBack→leagueCancelPrep）
    if (typeof initSettingScreen === 'function') initSettingScreen();
    _decorateSettingScreen(true);   // MD-04: モック準拠の3ゾーン＋下部コマンドバーへ
    if (typeof showScreen === 'function') showScreen('setting');
  }

  /* ══ MD-04 試合前の布陣設定画面（2026-07-26・Codexモック R_lineup_setting_retro 準拠）══
   * 共有画面（#screen-setting）なので **DOM は増やさず**、下部コマンドバーだけを注入し
   * レイアウトと仕上げは league-ui.css の `.league-prep` スコープで行う。
   * リーグを抜けるときは必ず外す＝シングル/W杯/ハーフタイム采配には一切波及させない。 */
  /* MD-04c（2026-08-05・ユーザー要望「試合前のUIを試合中の采配にも」）:
   *   mode で下部コマンドバーだけを差し替え、レイアウト/カード装飾は完全に共通にする。
   *     'prep'  … 試合前  ［← 戻る］［👥 自動編成］［⚽ キックオフ！］
   *     'match' … 試合中の采配  ［戦況］［交代枠］［▶ 試合へ戻る］
   *     'ht'    … ハーフタイムの采配  ［戦況］［交代枠］［↩ ハーフタイムへ］
   *   ★ 試合中に「自動編成」を出さないのは意図的。leagueAutoLineup は XI を丸ごと差し替える
   *     ＝ applyDrop の交代枠カウント（_htMode/htSubsCount/_subbedOff）を通らないため、
   *     交代0で11人入れ替えができてしまう（ルール破り）。枠を消費する自動編成が要るなら
   *     エンジン側の対応が必要なので、ここでは出さない。 */
  function _decorateSettingScreen(on, opts) {
    var s = document.getElementById('screen-setting'); if (!s) return;
    var mode = (opts && opts.mode) || 'prep';
    var bar = document.getElementById('lg-prep-cmd');
    if (!on) {
      s.classList.remove('league-prep');
      s.classList.remove('lgp-inmatch');
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      ['lgp-power', 'lgp-mode', 'lgp-bench-count', 'lgp-bench-more'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
      // MD-04b: カードに注入した子要素とクラスを剥がす。HT采配/シングルは同じ DOM を
      //   再利用するため、再描画を待たずにここで確実に素の姿へ戻す。
      Array.prototype.forEach.call(
        s.querySelectorAll('.lgp-top, .lgp-head, .lgp-bench-val'),
        function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
      Array.prototype.forEach.call(
        s.querySelectorAll('.lgp-card, .lgp-absent, .lgp-bench-card'),
        function (el) { el.classList.remove('lgp-card'); el.classList.remove('lgp-absent'); el.classList.remove('lgp-bench-card'); });
      Array.prototype.forEach.call(
        s.querySelectorAll('.bench-item-circle.lgp-chip'),
        function (el) { el.classList.remove('lgp-chip'); el.classList.remove('gk'); el.classList.remove('df'); el.classList.remove('mf'); el.classList.remove('fw'); });
      return;
    }
    s.classList.add('league-prep');
    if (mode === 'match' || mode === 'ht') s.classList.add('lgp-inmatch');
    else s.classList.remove('lgp-inmatch');
    if (!bar) {
      var host = s.querySelector('.setting-content'); if (!host) return;
      bar = document.createElement('div');
      bar.id = 'lg-prep-cmd';
      bar.className = 'lg-prep-cmd';
      host.appendChild(bar);
    }
    if (mode === 'match' || mode === 'ht') {
      // 試合中＝［戦況］［交代枠スロット］［主ボタン］。主ボタンは常に右下・44px以上。
      //   交代枠ラベル(#ht-subs-label)は manager-match.js / simulate.js が持つ既存ノードを
      //   このスロットへ引っ越して使う（DOM を増やさない・_updateHtSubsLabel がそのまま効く）。
      bar.innerHTML =
        '<div class="lg-prep-status">' + ((opts && opts.status) || '') + '</div>' +
        '<div class="lg-prep-subs"><span class="lg-prep-subs-ic">⇄</span>' +
          '<span class="lg-prep-subs-slot" id="lg-prep-subs"></span></div>' +
        (mode === 'ht'
          ? '<button type="button" class="lg-prep-nb kick" onclick="htCloseLineup()">' +
              '↩ ' + _t('ハーフタイムへ', 'Back to Half Time') + '</button>'
          : '<button type="button" class="lg-prep-nb kick" onclick="_mvCloseSetting()">' +
              '▶ ' + _t('試合へ戻る', 'Back to match') + '</button>');
    } else {
      bar.innerHTML =
        '<button type="button" class="lg-prep-nb back" onclick="settingBack()">' +
          _t('← 戻る', '← Back') + '</button>' +
        '<button type="button" class="lg-prep-nb auto" onclick="leagueAutoLineup()">' +
          '👥 ' + _t('自動編成', 'Auto pick') + '</button>' +
        '<button type="button" class="lg-prep-nb kick" onclick="startGame()">' +
          '⚽ ' + _t('キックオフ！', 'KICK OFF!') + '</button>';
    }

    // ── MD-04b（2026-07-27・R_lineup_setting_retro_v2 準拠）────────────────
    // スタメン総合力パネル（右カラム先頭）
    var grid = s.querySelector('.setting-btn-grid');
    if (grid && !document.getElementById('lgp-power')) {
      var pw = document.createElement('div');
      pw.id = 'lgp-power'; pw.className = 'lgp-power';
      pw.innerHTML =
        '<div class="lgp-power-label">' + _t('スタメン総合力', 'STARTING XI') + '</div>' +
        '<div class="lgp-power-num" id="lgp-power-num">-</div>' +
        '<div class="lgp-power-delta" id="lgp-power-delta"></div>';
      grid.insertBefore(pw, grid.firstChild);
    }
    _lgpPowerPrev = null;   // 開いた直後は差分を出さない（最初の入れ替えから）

    // 表示切替（数値→調子→士気）＝GK横・ピッチ右下の1行ボタン
    var fc = s.querySelector('.field-container');
    if (fc && !document.getElementById('lgp-mode')) {
      var mb = document.createElement('button');
      mb.type = 'button'; mb.id = 'lgp-mode'; mb.className = 'lgp-mode';
      mb.onclick = function () {
        _lgpMode = _lgpMode === 'v' ? 'c' : _lgpMode === 'c' ? 'm' : 'v';
        _lgpModeLabel();
        // 再描画＝カードの値スロットが全部入れ替わる（装飾はrenderのフックで再適用）
        if (typeof renderFormation === 'function') renderFormation();
        if (typeof renderBench === 'function') renderBench();
      };
      fc.appendChild(mb);
    }
    _lgpModeLabel();

    // 控え人数（applyLang が .bench-panel-label を書き換えても消えない独立ノード）
    var bl = s.querySelector('.bench-panel-label');
    if (bl && !document.getElementById('lgp-bench-count')) {
      var bc = document.createElement('span');
      bc.id = 'lgp-bench-count'; bc.className = 'lgp-bench-count';
      bl.parentNode.insertBefore(bc, bl.nextSibling);
    }

    // initSettingScreen は league-prep が付く前に描画を済ませている＝クラスが付いた今、
    // もう一度描いてカード装飾（lgPrepAfterRender）を効かせる。
    if (typeof renderFormation === 'function') renderFormation();
    if (typeof renderBench === 'function') renderBench();
  }

  /* ══ MD-04b 布陣設定のカード化（2026-07-27・Codexモック R_lineup_setting_retro_v2 準拠）══
   * 選手ドット→ミニカード（ポジションチップ＋総合値＋ドット頭＋名前）／控え＝カード棚／
   * スタメン総合力パネル／表示切替（数値/調子/士気）。
   * simulate.js の renderFormation / renderBench 末尾のフック lgPrepAfterRender から呼ばれる。
   * ★ .league-prep が付いている間だけ装飾＝シングル/W杯/ハーフタイム采配には一切出ない。
   * ★ 既存 DOM に子要素を「足す」だけ＝ドラッグ入替・選手詳細タップのリスナーを壊さない。 */
  var _lgpMode = 'v';        // 'v'=数値 / 'c'=調子 / 'm'=士気（セッション内のみ・保存しない）
  var _lgpPowerPrev = null;  // 総合力の前回値（×10整数）。差分表示とカウントアップに使う

  function _lgpOn() {
    var s = document.getElementById('screen-setting');
    return !!(s && s.classList.contains('league-prep'));
  }

  // ライン種別（チップの色分け用）: GK / DF / MF / FW
  function _lgpLine(posName) {
    var b = (posName && (posName.charAt(0) === '左' || posName.charAt(0) === '右')) ? posName.slice(1) : (posName || '');
    if (b === 'GK') return 'gk';
    if (b === 'CB' || b === 'SB' || b === 'SW') return 'df';
    if (b === 'CF' || b === 'WG') return 'fw';
    return 'mf';
  }

  // 実効総合値 = params平均。適正外はエンジン（getActionParam）と同じ -5% ＝「!」の意味が数字で読める
  function _lgpRating(p, posName) {
    if (!p || !p.params || !p.params.length) return 0;
    var t = 0; for (var i = 0; i < p.params.length; i++) t += p.params[i];
    var avg = t / p.params.length;
    if (posName && p.positions) {
      var b = (posName.charAt(0) === '左' || posName.charAt(0) === '右') ? posName.slice(1) : posName;
      if (p.positions.indexOf(posName) < 0 && p.positions.indexOf(b) < 0) avg *= 0.95;
    }
    return avg;
  }

  /* 調子/士気の3段（高/中/低）。
   * ★ 仮のデータ源＝決定論ハッシュ（選手×シーズン×節で毎週入れ替わる・保存不要）。
   *   試合結果への効果はまだ無い（表示の骨組み）。コンディション系／PS-13 永続士気が
   *   実装されたら、この関数の中身だけを実データ読みに差し替える。 */
  function _lgpTri(p, salt) {
    var season = (_state && _state.season) ? _state.season : 1;
    var round = (_state && _state.round) ? _state.round : 1;
    var r = _hash32(salt + '|' + _playerKey(p) + '|' + season + '|' + round) % 10;
    return (r < 2) ? '低' : (r < 8) ? '中' : '高';
  }

  function _lgpValHtml(p, posName) {
    if (_lgpMode === 'v') return '<span class="lgp-val">' + Math.round(_lgpRating(p, posName)) + '</span>';
    var k = _lgpTri(p, _lgpMode === 'c' ? 'cond' : 'mot');
    var cls = k === '高' ? 'hi' : k === '低' ? 'lo' : 'mid';
    var mark = k === '高' ? '▲' : k === '低' ? '▼' : '●';
    var label = (window.LANG === 'en')
      ? (k === '高' ? 'Hi' : k === '低' ? 'Lo' : 'Mid')
      : k;
    return '<span class="lgp-val lgp-tri ' + cls + '">' + mark + label + '</span>';
  }

  function _lgpModeLabel() {
    var mb = document.getElementById('lgp-mode'); if (!mb) return;
    var nm = _lgpMode === 'v' ? _t('数値', 'Rating') : _lgpMode === 'c' ? _t('調子', 'Form') : _t('士気', 'Morale');
    mb.innerHTML = nm + ' <span class="lgp-mode-ic">⟳</span>';
  }

  /* MD-04c: 試合中の采配画面（manager-match.js の _mvOpenSetting／simulate.js の htOpenLineup）
   * から同じ3ゾーンUIを使うための薄い公開口。呼ぶ側は typeof ガード＋body.league-mode 判定で。
   *   leagueDecorateSetting(true,  {mode:'match'|'ht', status:'<戦況HTML>'})
   *   leagueDecorateSetting(false)  ← 閉じるときは必ず（.league-prep を残さない） */
  window.leagueDecorateSetting = function (on, opts) { _decorateSettingScreen(on, opts); };

  window.lgPrepAfterRender = function (what) {
    if (!_lgpOn()) return;
    if (typeof team1Data === 'undefined' || !team1Data || !team1Data.players) return;
    if (typeof team1State === 'undefined' || !team1State || !team1State.lineup) return;
    if (what === 'formation') { _lgpDecorateFormation(); _lgpUpdatePower(); _lgpModeLabel(); }
    else if (what === 'bench') { _lgpDecorateBench(); }
  };

  function _lgpDecorateFormation() {
    var display = document.getElementById('formation-display'); if (!display) return;
    var sys = (typeof system_data !== 'undefined') ? system_data[team1State.systemIdx] : null;
    Array.prototype.forEach.call(display.querySelectorAll('.player-dot'), function (dot) {
      var pos = parseInt(dot.dataset.pos, 10);
      var p = team1Data.players[team1State.lineup[pos]];
      var wrap = dot.firstElementChild;                 // circleWrap（各種バッジの親）
      if (!wrap || !p) return;
      var posName = sys ? sys.positions[pos] : '';
      // 行の重なりは「下の行ほど手前」＝上の行の選手名が下のカードの裏に回る（読みやすさ優先）
      dot.style.zIndex = String(10 + Math.round(parseFloat(dot.style.top) || 0));
      wrap.classList.add('lgp-card');
      // 欠場者（怪我/出停）: 旧UIは丸をグレー化していたが丸は隠したので、カードごと沈める
      //   （🩹/🟥の週数バッジは renderFormation が既に付けている）
      if (typeof leaguePlayerAbsence === 'function' && leaguePlayerAbsence(team1State.lineup[pos])) {
        wrap.classList.add('lgp-absent');
      }
      var top = document.createElement('div');
      top.className = 'lgp-top';
      top.innerHTML = '<span class="lgp-chip ' + _lgpLine(posName) + '">' +
        (posName || '').replace(/[左右]/g, '').substring(0, 2) + '</span>' + _lgpValHtml(p, posName);
      var cv = document.createElement('canvas');
      cv.className = 'lgp-head';
      cv.width = 48; cv.height = 48;
      cv.setAttribute('data-portrait', p.long_name || p.name);
      wrap.insertBefore(top, wrap.firstChild);
      wrap.appendChild(cv);
    });
    _paintPortraitCanvases(display);
  }

  function _lgpDecorateBench() {
    var bench = document.getElementById('bench-list'); if (!bench) return;
    var count = 0;
    Array.prototype.forEach.call(bench.querySelectorAll('.bench-item'), function (item) {
      count++;
      var idx = parseInt(item.dataset.playerIdx, 10);
      var p = team1Data.players[idx]; if (!p) return;
      item.classList.add('lgp-bench-card');
      var cv = document.createElement('canvas');
      cv.className = 'lgp-head'; cv.width = 40; cv.height = 40;
      cv.setAttribute('data-portrait', p.long_name || p.name);
      item.insertBefore(cv, item.firstChild);
      var chip = item.querySelector('.bench-item-circle');   // 既存の丸をライン色チップとして再利用
      if (chip) { chip.classList.add('lgp-chip'); chip.classList.add(_lgpLine(p.positions && p.positions[0])); }
      var val = document.createElement('div');
      val.className = 'lgp-bench-val';
      val.innerHTML = _lgpValHtml(p, null);
      item.appendChild(val);
    });
    var cnt = document.getElementById('lgp-bench-count');
    if (cnt) cnt.textContent = count + _t('人', '');
    _paintPortraitCanvases(bench);
    _lgpBenchMore(bench);
  }

  /* 控え棚の「▼」（2026-08-06 バグ修正）。
   * これまで ▼ は .bench-panel::after の**擬似要素＝押せない飾り**で、しかも横スクロール用の
   * ‹› ボタンは league-mode で display:none。ユーザーには「▼を押しても効かない」に見えていた。
   * → 本物のボタンを1つだけ差し込み、simulate.js の scrollBench(1)（縦棚では縦送り・
   *   最下端まで来たら先頭へ巻き戻す）に繋ぐ。棚がスクロール不要なときは出さない。 */
  function _lgpBenchMore(bench) {
    var panel = bench.parentNode; if (!panel) return;
    var btn = document.getElementById('lgp-bench-more');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'lgp-bench-more';
      btn.className = 'lgp-bench-more';
      btn.innerHTML = '▼';
      btn.onclick = function () { if (typeof scrollBench === 'function') scrollBench(1); };
      panel.appendChild(btn);
    }
    btn.title = _t('控えを下へスクロール', 'Scroll bench');
    /* 出す/隠すの判定は「棚がはみ出しているか」。
     * ⚠️ 一度きりの測定では誤る（2026-08-06 実測）: 3ゾーンのレイアウトが確定する前に測ると
     *   clientHeight が実際より大きく、スクロールが必要なのに **ボタンを隠したまま**になった。
     *   ＝ユーザーから見れば「▼が無い／効かない」で元のバグと同じ。
     *   ResizeObserver で棚の寸法が変わるたびに測り直し、取りこぼしを無くす。 */
    var apply = function () {
      var more = bench.scrollHeight > bench.clientHeight + 4;
      btn.style.display = more ? 'block' : 'none';
    };
    apply();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
    /* ★ 遅れて伸びる分を拾うための再測定（これが無いと隠れたままになる）。
     *   ・renderBench は画面がまだ非表示（display:none）のうちに走ることがある＝寸法が測れない
     *   ・顔キャンバス等が後から確定して **中身(scrollHeight)だけ**が伸びる。棚自身の枠は
     *     変わらないので ResizeObserver は鳴らない＝時間差で測り直すしかない。 */
    [0, 150, 500].forEach(function (ms) { setTimeout(apply, ms); });
    // 画面回転・ウィンドウ幅の変化で棚の高さが変わったときの追従（枠の変化はこちらで拾う）
    if (typeof ResizeObserver === 'function' && !bench._lgpRO) {
      bench._lgpRO = new ResizeObserver(apply);
      bench._lgpRO.observe(bench);
    }
  }

  // スタメン総合力 = 11人の実効総合値の平均（小数1桁）。入れ替えのたびに juice でカウントアップ＋差分表示。
  function _lgpPowerNow() {
    var sys = (typeof system_data !== 'undefined') ? system_data[team1State.systemIdx] : null;
    var t = 0;
    for (var pos = 0; pos < 11; pos++) {
      t += _lgpRating(team1Data.players[team1State.lineup[pos]], sys ? sys.positions[pos] : null);
    }
    return Math.round(t / 11 * 10);   // ×10 の整数（Juice.countUp が整数刻みのため）
  }

  function _lgpUpdatePower() {
    var el = document.getElementById('lgp-power-num'); if (!el) return;
    var lb = document.querySelector('#lgp-power .lgp-power-label');
    if (lb) lb.textContent = _t('スタメン総合力', 'STARTING XI');   // 言語切替に追従（描画のたびに引き直す）
    var v10 = _lgpPowerNow();
    var fmt = function (v) { return (v / 10).toFixed(1); };
    var prev = _lgpPowerPrev;
    if (prev === null || prev === v10 || typeof Juice === 'undefined' || !Juice.countUp) {
      el.textContent = fmt(v10);
    } else {
      Juice.countUp(el, v10, { from: prev, dur: 500, fmt: fmt });
    }
    var dEl = document.getElementById('lgp-power-delta');
    if (dEl) {
      if (prev === null || prev === v10) { dEl.textContent = ''; dEl.className = 'lgp-power-delta'; }
      else {
        var d = (v10 - prev) / 10;
        dEl.textContent = (d > 0 ? '▲ +' : '▼ ') + d.toFixed(1);
        dEl.className = 'lgp-power-delta ' + (d > 0 ? 'up' : 'down');
      }
    }
    _lgpPowerPrev = v10;
  }

  /* ══ MD-04d 要注意プレイヤー選択の3ゾーン化（2026-08-08・ユーザー指示）════════
   * 「要注意プレイヤー選択画面も、自チームのスタメン変更画面と同じUIに」。
   * #screen-marked は simulate.js の openMarkedPlayerSelect が組む **共有画面**
   * （シングル/W杯と共用）なので、リーグ（body.league-mode）のときだけ
   *   ［左＝相手XIのカードリスト／中央＝相手ピッチ＝主役／右＝マーク状況・効果・相手の布陣］
   * ＋下部コマンドバーへ組み替える。骨格・トークン・カード作法は MD-04（試合前の布陣設定）
   * と完全に共通＝2画面を行き来しても同じ画面の続きに見える。
   *
   * ★ ロジックは1行も持たない。simulate.js が作った**ノードを移動し中身を描き直すだけ**なので、
   *   ノードに張られた onclick（marked_player の代入／GK除外／closeSubSelect）はそのまま残る。
   *   ＝「選ぶと何が起きるか」の正本は simulate.js のまま（表示層だけを差し替える）。
   * ★ league-mode でなければクラスを外して即 return ＝シングル/W杯は従来UIのまま。
   * ★ 試合中の采配（_mvOpenSetting → _htMode）から開いた場合も、ctx は simulate.js が
   *   _liveT2 から導出した値をそのまま渡してくる＝ライブ布陣の分岐はこちらで再実装しない。 */
  function _lgmPosLabel(name) {
    return String(name || '').replace(/[左右]/g, '').substring(0, 2);
  }

  window.leagueDecorateMarked = function (content, ctx) {
    var scr = document.getElementById('screen-marked');
    if (!scr || !content) return;
    var bail = function () {
      scr.classList.remove('league-marked');
      content.className = 'setting-content';   // 旧UIの素の姿へ確実に戻す
    };
    if (!(document.body && document.body.classList.contains('league-mode'))) { bail(); return; }
    var data = ctx && ctx.data;
    if (!data || !data.players) { bail(); return; }
    var sys = ctx.sys, lineup = ctx.lineup || [];
    scr.classList.add('league-marked');

    var all = function (sel) { return Array.prototype.slice.call(content.querySelectorAll(sel)); };
    var nameOf = function (p) { return (typeof getPlayerName === 'function') ? getPlayerName(p) : (p.name || ''); };

    var descNode = content.querySelector('.marked-desc');
    var descText = descNode ? descNode.textContent.replace(/^[\s🎯]+/, '') : '';
    var tapNode = content.querySelector('.marked-divider');
    var tapText = tapNode ? tapNode.textContent : _t('選手をタップ', 'Tap a player');
    var field = content.querySelector('.marked-field');
    var none = content.querySelector('.marked-none');
    var items = all('.marked-item');
    var dots = all('.marked-dot');

    var cur = (typeof team1State !== 'undefined' && team1State &&
               typeof team1State.marked_player === 'number') ? team1State.marked_player : -1;
    var curPos = -1;
    for (var i = 0; i < lineup.length; i++) { if (lineup[i] === cur) { curPos = i; break; } }

    // ── 中央ゾーン（主役）＝相手ピッチ ───────────────────────────
    var mid = document.createElement('div');
    mid.className = 'lgm-zone lgm-mid';
    mid.innerHTML =
      '<div class="lgm-zhead">' +
        '<span class="lgm-zttl">' + _escHtml((data.flag || '') + ' ' +
          ((typeof getTeamName === 'function') ? getTeamName(data) : (data.name || ''))) + '</span>' +
        '<span class="lgm-zhint">' + _escHtml(tapText) + '</span>' +
      '</div>';
    if (field) { field.style.marginBottom = '0'; mid.appendChild(field); }

    // 選手ドット → ミニカード（MD-04b と同じ: ポジションチップ＋総合値＋ドット頭＋名前）
    dots.forEach(function (dot) {
      var pos = parseInt(dot.dataset.pos, 10);
      var pi = parseInt(dot.dataset.playerIdx, 10);
      var p = data.players[pi]; if (!p) return;
      var isGK = dot.dataset.gk === '1';
      var posName = sys ? sys.positions[pos] : '';
      dot.style.opacity = '';                                  // GK の沈みはカード側（.is-gk）で表現
      dot.style.zIndex = String(10 + Math.round(parseFloat(dot.style.top) || 0));
      dot.innerHTML =
        '<div class="lgm-card' + (isGK ? ' is-gk' : '') + (pi === cur ? ' is-marked' : '') + '">' +
          '<div class="lgm-ctop">' +
            '<span class="lgm-chip ' + _lgpLine(posName) + '">' + _escHtml(_lgmPosLabel(posName)) + '</span>' +
            '<span class="lgm-val">' + Math.round(_lgpRating(p, posName)) + '</span>' +
          '</div>' +
          '<canvas class="lgm-head" width="48" height="48" data-portrait="' +
            _escHtml(p.long_name || p.name) + '"></canvas>' +
          (pi === cur ? '<span class="lgm-tgt">🎯</span>' : '') +
        '</div>' +
        '<div class="lgm-cname">' + _escHtml(nameOf(p)) + '</div>';
    });

    // ── 左ゾーン＝相手XIのカードリスト（控え棚と同じ行の作法）────────────
    var left = document.createElement('div');
    left.className = 'lgm-zone lgm-left';
    left.innerHTML =
      '<div class="lgm-zhead"><span class="lgm-zttl">' + _t('相手スタメン', 'OPPONENT XI') + '</span>' +
      '<span class="lgm-zcount">' + items.length + _t('人', '') + '</span></div>';
    var rows = document.createElement('div');
    rows.className = 'lgm-rows';
    items.forEach(function (item) {
      var pos = parseInt(item.dataset.pos, 10);
      var pi = parseInt(item.dataset.playerIdx, 10);
      var p = data.players[pi]; if (!p) return;
      var isGK = item.dataset.gk === '1';
      var posName = sys ? sys.positions[pos] : '';
      item.className = 'marked-item lgm-row' + (isGK ? ' is-gk' : '') + (pi === cur ? ' is-marked' : '');
      item.style.cssText = '';   // 旧UIのインライン opacity/pointer-events はクラス側で表現し直す
      item.innerHTML =
        '<canvas class="lgm-rhead" width="40" height="40" data-portrait="' +
          _escHtml(p.long_name || p.name) + '"></canvas>' +
        '<span class="lgm-chip ' + _lgpLine(posName) + '">' + _escHtml(_lgmPosLabel(posName)) + '</span>' +
        '<span class="lgm-rname">' + _escHtml(nameOf(p)) + '</span>' +
        (isGK
          ? '<span class="lgm-rna">' + _escHtml((typeof t === 'function') ? t('gkDisabled') : '') + '</span>'
          : '<span class="lgm-val">' + Math.round(_lgpRating(p, posName)) + '</span>') +
        (pi === cur ? '<span class="lgm-rtgt">🎯</span>' : '');
      rows.appendChild(item);
    });
    left.appendChild(rows);

    // ── 右ゾーン＝マーク状況（状態の読み）／効果／相手の布陣 ──────────────
    var curP = (cur >= 0 && data.players[cur]) ? data.players[cur] : null;
    var curPosName = (curPos >= 0 && sys) ? sys.positions[curPos] : '';
    var tacIdx = (typeof ctx.tactics === 'number') ? ctx.tactics : -1;
    var tacNames = (typeof t === 'function' && t('tacticsNames')) ? t('tacticsNames') : [];
    var tacIcon = ['🎯', '⚡', '🔄', '🛡️', '🎲'];
    var sysName = (typeof systemLabel === 'function') ? systemLabel(ctx.sysIdx) : '-';
    var unsetTxt = (typeof t === 'function') ? t('unset') : '-';
    var right = document.createElement('div');
    right.className = 'lgm-zone lgm-right';
    right.innerHTML =
      '<div class="lgm-cur' + (curP ? '' : ' is-none') + '">' +
        '<div class="lgm-lab">' + _t('マーク中', 'MARKED') + '</div>' +
        '<div class="lgm-cur-name">' + (curP ? '🎯 ' : '') + _escHtml(curP ? nameOf(curP) : unsetTxt) + '</div>' +
        '<div class="lgm-cur-sub">' + (curP
          ? '<span class="lgm-chip ' + _lgpLine(curPosName) + '">' + _escHtml(_lgmPosLabel(curPosName)) + '</span>' +
            '<span class="lgm-val">' + Math.round(_lgpRating(curP, curPosName)) + '</span>'
          : '<span class="lgm-dash">—</span>') +
        '</div>' +
      '</div>' +
      '<div class="lgm-panel lgm-eff">' +
        '<div class="lgm-lab">' + _t('効果', 'EFFECT') + '</div>' +
        '<div class="lgm-eff-num">-15<i>%</i></div>' +
        '<div class="lgm-eff-cap">' + _t('相手の攻撃パラメータ', 'ATTACK PARAMS') + '</div>' +
        '<p class="lgm-eff-txt">' + _escHtml(descText) +
          '<span class="lgm-eff-note">' + _t('※ GK は指定できません', '* Goalkeepers cannot be marked') + '</span></p>' +
      '</div>' +
      '<div class="lgm-panel lgm-opp">' +
        '<div class="lgm-lab">' + _t('相手の布陣', 'OPPONENT SETUP') + '</div>' +
        '<div class="lgm-kv"><span class="k">' + _t('システム', 'System') + '</span>' +
          '<span class="v">' + _escHtml(sysName) + '</span></div>' +
        '<div class="lgm-kv"><span class="k">' + _t('戦術', 'Tactics') + '</span>' +
          '<span class="v">' + _escHtml(((tacIcon[tacIdx] || '') + ' ' + (tacNames[tacIdx] || '-')).trim()) + '</span></div>' +
      '</div>';

    // ── 下部コマンドバー（MD-04c と同じ部品＝［戻る］［指定なし］［決定］）────
    var bar = document.createElement('div');
    bar.className = 'lg-prep-cmd lgm-cmd';
    var back = document.createElement('button');
    back.type = 'button'; back.className = 'lg-prep-nb back';
    back.textContent = _t('← 戻る', '← Back');
    back.onclick = function () { if (typeof closeSubSelect === 'function') closeSubSelect('marked'); };
    bar.appendChild(back);
    if (none) {
      // ★ 「指定なし」は元ノードを移設＝onclick（marked_player = -1）をそのまま使う
      none.className = 'marked-none lg-prep-nb auto' + (cur < 0 ? ' is-on' : '');
      none.setAttribute('role', 'button');
      none.innerHTML = '🚫 ' + _t('指定なし', 'No mark');
      bar.appendChild(none);
    }
    var ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'lg-prep-nb kick';
    ok.textContent = '🎯 ' + _t('決定', 'DONE');
    ok.onclick = function () { if (typeof closeSubSelect === 'function') closeSubSelect('marked'); };
    bar.appendChild(ok);

    // ── 組み替え（ここまでで作った器へ入れ替える。DOM順＝縦持ちの読み順）──
    content.innerHTML = '';
    content.className = 'setting-content lgm-wrap';
    content.appendChild(mid);
    content.appendChild(right);
    content.appendChild(left);
    content.appendChild(bar);
    _paintPortraitCanvases(content);
    /* 11行は狭い横持ちだと入り切らない＝下端フェードで「まだ下がある」を示す。
     * ★ 選択中の行へ自動スクロールはしない（先頭が切れて壊れて見えるだけで、
     *   現在の指名は右の「マーク中」とピッチの🎯で既に読めている）。 */
    _queueScrollHints();
  };

  /* ══ MD-04e キープレイヤー選択の3ゾーン化（2026-08-09・ユーザー指示）════════
   * 「キープレイヤー選択もお願いします」＝要注意プレイヤー（MD-04d）と対になる画面。
   * #screen-keyplayer は simulate.js の openKeyPlayerSelect が組む **共有画面**なので、
   * リーグ（body.league-mode）のときだけ
   *   ［左＝自チームXIのカードリスト／中央＝自チームのピッチ＝主役／右＝指名・効果・自分の布陣］
   * ＋下部コマンドバーへ組み替える。骨格・トークン・カード作法は MD-04／MD-04d と共通。
   *
   * ★ MD-04d との違い（＝仕様の違いをそのまま表示に落とす）:
   *   ① 対象は **自チームのスタメン11人**（相手ではない）＝ピッチはここで新規に組み立てる。
   *   ② **GK も指名できる**（グレーアウト・除外なしの11人フラット）。
   *   ③ 「指定なし」が存在しない（常に誰か1人）＝下部バーは［戻る］［決定］の2枠。
   *   ④ 効果は数値ではない＝ -15% のような効果数字は置かず ⭐ と説明文で伝える。
   * ★ ロジックは1行も持たない。ピッチのカードは対応する行ノードの onclick を**借りる**だけ
   *   （＝「選ぶと何が起きるか」の正本は simulate.js の team1State.keyplayer = pos のまま）。
   * ★ league-mode でなければクラスを外して即 return ＝シングル/W杯は従来UIのまま。
   * ★ 試合中の采配（_mvOpenSetting）から開いた場合も、team1State は live チームと同期済み
   *   ＝ctx はその値をそのまま受け取る（ライブ布陣の分岐はこちらで再実装しない）。 */
  var _LGK_FIELD_SVG =
    '<svg viewBox="0 0 100 145" preserveAspectRatio="none" aria-hidden="true">' +
      '<rect x="5" y="5" width="90" height="135" fill="none" stroke="white" stroke-width="0.8"/>' +
      '<line x1="5" y1="72.5" x2="95" y2="72.5" stroke="white" stroke-width="0.6"/>' +
      '<circle cx="50" cy="72.5" r="12" fill="none" stroke="white" stroke-width="0.6"/>' +
      '<circle cx="50" cy="72.5" r="0.8" fill="white"/>' +
      '<rect x="25" y="5" width="50" height="18" fill="none" stroke="white" stroke-width="0.6"/>' +
      '<rect x="35" y="5" width="30" height="9" fill="none" stroke="white" stroke-width="0.6"/>' +
      '<rect x="25" y="122" width="50" height="18" fill="none" stroke="white" stroke-width="0.6"/>' +
      '<rect x="35" y="127" width="30" height="13" fill="none" stroke="white" stroke-width="0.6"/>' +
    '</svg>';

  window.leagueDecorateKeyplayer = function (content, ctx) {
    var scr = document.getElementById('screen-keyplayer');
    if (!scr || !content) return;
    var bail = function () {
      scr.classList.remove('league-keyplayer');
      content.className = 'setting-content';   // 旧UIの素の姿へ確実に戻す
    };
    if (!(document.body && document.body.classList.contains('league-mode'))) { bail(); return; }
    var data = ctx && ctx.data;
    if (!data || !data.players) { bail(); return; }
    var sys = ctx.sys, lineup = ctx.lineup || [];
    if (!sys || lineup.length < 11) { bail(); return; }
    scr.classList.add('league-keyplayer');

    var nameOf = function (p) { return (typeof getPlayerName === 'function') ? getPlayerName(p) : (p.name || ''); };
    var descNode = content.querySelector('.keyp-desc');
    var descText = descNode ? descNode.textContent.replace(/^[\s⭐]+/, '') : '';
    var items = Array.prototype.slice.call(content.querySelectorAll('.keyp-item'));
    var keyPos = (typeof ctx.keyPos === 'number') ? ctx.keyPos : -1;

    // ── 中央ゾーン（主役）＝自チームのピッチ ─────────────────────────
    var mid = document.createElement('div');
    mid.className = 'lgk-zone lgk-mid';
    mid.innerHTML =
      '<div class="lgk-zhead">' +
        '<span class="lgk-zttl">' + _escHtml((data.flag || '') + ' ' +
          ((typeof getTeamName === 'function') ? getTeamName(data) : (data.name || ''))) + '</span>' +
        '<span class="lgk-zhint">' +
          _t('選手をタップして指名', 'Tap a player to appoint') + '</span>' +
      '</div>' +
      '<div class="lgk-field"><div class="lgk-turf">' + _LGK_FIELD_SVG + '<div class="lgk-dots"></div></div></div>';
    var dotsEl = mid.querySelector('.lgk-dots');

    // ── 左ゾーン＝自チームXIのカードリスト（控え棚と同じ行の作法）──────────
    var left = document.createElement('div');
    left.className = 'lgk-zone lgk-left';
    left.innerHTML =
      '<div class="lgk-zhead"><span class="lgk-zttl">' + _t('スタメン', 'STARTING XI') + '</span>' +
      '<span class="lgk-zcount">' + items.length + _t('人', '') + '</span></div>';
    var rows = document.createElement('div');
    rows.className = 'lgk-rows';

    items.forEach(function (item) {
      var pos = parseInt(item.dataset.pos, 10);
      var pi = parseInt(item.dataset.playerIdx, 10);
      var p = data.players[pi]; if (!p) return;
      var posName = sys.positions[pos] || '';
      var isKey = (pos === keyPos);
      var chip = '<span class="lgk-chip ' + _lgpLine(posName) + '">' +
        _escHtml(_lgmPosLabel(posName)) + '</span>';
      var val = '<span class="lgk-val">' + Math.round(_lgpRating(p, posName)) + '</span>';

      // ピッチのカード（行の onclick を借りる＝選択ロジックは simulate.js が正本）
      var dot = document.createElement('div');
      dot.className = 'lgk-dot';
      dot.style.left = sys.x[pos] + '%';
      dot.style.top = sys.y[pos] + '%';
      // 行の重なりは「下の行ほど手前」＝上の行の選手名が下のカードの裏に回る（布陣設定と同じ）
      dot.style.zIndex = String(10 + Math.round(sys.y[pos] || 0));
      dot.onclick = item.onclick;
      dot.innerHTML =
        '<div class="lgk-card' + (isKey ? ' is-key' : '') + '">' +
          '<div class="lgk-ctop">' + chip + val + '</div>' +
          '<canvas class="lgk-head" width="48" height="48" data-portrait="' +
            _escHtml(p.long_name || p.name) + '"></canvas>' +
          (isKey ? '<span class="lgk-star">⭐</span>' : '') +
        '</div>' +
        '<div class="lgk-cname">' + _escHtml(nameOf(p)) + '</div>';
      dotsEl.appendChild(dot);

      // 左の行（元ノードを再利用＝onclick はそのまま）
      item.className = 'keyp-item lgk-row' + (isKey ? ' is-key' : '');
      item.style.cssText = '';
      item.innerHTML =
        '<canvas class="lgk-rhead" width="40" height="40" data-portrait="' +
          _escHtml(p.long_name || p.name) + '"></canvas>' +
        chip +
        '<span class="lgk-rname">' + _escHtml(nameOf(p)) + '</span>' +
        val +
        (isKey ? '<span class="lgk-rstar">⭐</span>' : '');
      rows.appendChild(item);
    });
    left.appendChild(rows);

    // ── 右ゾーン＝いまの指名／効果／自チームの布陣 ─────────────────────
    var curP = (keyPos >= 0 && data.players[lineup[keyPos]]) ? data.players[lineup[keyPos]] : null;
    var curPosName = (keyPos >= 0) ? (sys.positions[keyPos] || '') : '';
    var tacIdx = (typeof ctx.tactics === 'number') ? ctx.tactics : -1;
    var tacNames = (typeof t === 'function' && t('tacticsNames')) ? t('tacticsNames') : [];
    var tacIcon = ['🎯', '⚡', '🔄', '🛡️', '🎲'];
    var sysName = (typeof systemLabel === 'function') ? systemLabel(ctx.sysIdx) : '-';
    var unsetTxt = (typeof t === 'function') ? t('unset') : '-';
    var right = document.createElement('div');
    right.className = 'lgk-zone lgk-right';
    right.innerHTML =
      '<div class="lgk-cur' + (curP ? '' : ' is-none') + '">' +
        '<div class="lgk-lab">' + _t('キープレイヤー', 'KEY PLAYER') + '</div>' +
        '<div class="lgk-cur-row">' +
          (curP ? '<canvas class="lgk-cur-head" width="56" height="56" data-portrait="' +
            _escHtml(curP.long_name || curP.name) + '"></canvas>' : '') +
          '<span class="lgk-cur-name">' + _escHtml(curP ? nameOf(curP) : unsetTxt) + '</span>' +
        '</div>' +
        '<div class="lgk-cur-sub">' + (curP
          ? '<span class="lgk-chip ' + _lgpLine(curPosName) + '">' + _escHtml(_lgmPosLabel(curPosName)) + '</span>' +
            '<span class="lgk-val">' + Math.round(_lgpRating(curP, curPosName)) + '</span>'
          : '<span class="lgk-dash">—</span>') +
        '</div>' +
      '</div>' +
      '<div class="lgk-panel lgk-eff">' +
        '<div class="lgk-lab">' + _t('効果', 'EFFECT') + '</div>' +
        '<div class="lgk-eff-mark">⭐</div>' +
        '<div class="lgk-eff-cap">' + _t('攻撃で優先される', 'PRIORITISED IN ATTACK') + '</div>' +
        '<p class="lgk-eff-txt">' + _escHtml(descText) + '</p>' +
      '</div>' +
      '<div class="lgk-panel lgk-own">' +
        '<div class="lgk-lab">' + _t('自チームの布陣', 'YOUR SETUP') + '</div>' +
        '<div class="lgk-kv"><span class="k">' + _t('システム', 'System') + '</span>' +
          '<span class="v">' + _escHtml(sysName) + '</span></div>' +
        '<div class="lgk-kv"><span class="k">' + _t('戦術', 'Tactics') + '</span>' +
          '<span class="v">' + _escHtml(((tacIcon[tacIdx] || '') + ' ' + (tacNames[tacIdx] || '-')).trim()) + '</span></div>' +
      '</div>';

    // ── 下部コマンドバー（MD-04c の共通部品＝［戻る］［決定］の2枠）───────
    //    「指定なし」が無い仕様なので2枠。主ボタンは右端・最大＝MD-04/MD-04d と同じ位置。
    var bar = document.createElement('div');
    bar.className = 'lg-prep-cmd lgk-cmd';
    var back = document.createElement('button');
    back.type = 'button'; back.className = 'lg-prep-nb back';
    back.textContent = _t('← 戻る', '← Back');
    back.onclick = function () { if (typeof closeSubSelect === 'function') closeSubSelect('keyplayer'); };
    bar.appendChild(back);
    var ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'lg-prep-nb kick';
    ok.textContent = '⭐ ' + _t('決定', 'DONE');
    ok.onclick = function () { if (typeof closeSubSelect === 'function') closeSubSelect('keyplayer'); };
    bar.appendChild(ok);

    // ── 組み替え（DOM順＝縦持ちの読み順: ピッチ → 指名/効果 → リスト → バー）──
    content.innerHTML = '';
    content.className = 'setting-content lgk-wrap';
    content.appendChild(mid);
    content.appendChild(right);
    content.appendChild(left);
    content.appendChild(bar);
    _paintPortraitCanvases(content);
    _queueScrollHints();   // 11行が入り切らない横持ちで下端フェード＝「まだ下がある」
  };

  /* MD-04 自動編成。いま選んでいるシステムの各枠に、出場可能な選手から
   * 「適性 → 能力平均」の順で最良を当てる。
   * ★ 評価式は欠場補充（_availableLineup）と同じ＝相手AIの布陣と判断基準が揃う。
   * ★ 触るのは布陣だけ。システム/戦術/キープレイヤーは監督の判断として残す。 */
  window.leagueAutoLineup = function () {
    if (!(typeof window !== 'undefined' && window._leagueInMatch)) return;
    if (typeof team1Data === 'undefined' || !team1Data || !team1Data.players) return;
    if (typeof team1State === 'undefined' || !team1State) return;
    var clubId = team1Data._srcKey || (_pendingMatch && _pendingMatch.myId);
    var players = team1Data.players;

    // 離脱者（怪我／出場停止）は起用しない
    var unavailable = {};
    for (var i = 0; i < players.length; i++) {
      var e = _peekSquadEntry(clubId, _playerKey(players[i]));
      if (e && ((e.injuryOut > 0) || (e.suspendOut > 0))) unavailable[i] = true;
    }
    var sys = (typeof system_data !== 'undefined') ? system_data[team1State.systemIdx] : null;
    var posNames = sys ? sys.positions : null;

    function strength(pl) {
      if (!pl || !pl.params || !pl.params.length) return 0;
      var t = 0; for (var k = 0; k < pl.params.length; k++) t += pl.params[k];
      return t / pl.params.length;
    }
    function fits(pl, posName) {
      if (!pl || !pl.positions || !posName) return false;
      if (pl.positions.indexOf(posName) >= 0) return true;
      var b = (posName.charAt(0) === '左' || posName.charAt(0) === '右') ? posName.slice(1) : posName;
      return b !== posName && pl.positions.indexOf(b) >= 0;
    }
    var used = {};
    function pick(posName, allowAbsent) {
      var best = -1, bestScore = -1;
      for (var j = 0; j < players.length; j++) {
        if (used[j]) continue;
        if (!allowAbsent && unavailable[j]) continue;
        var sc = (fits(players[j], posName) ? 1000 : 0) + strength(players[j]);
        if (sc > bestScore) { bestScore = sc; best = j; }
      }
      return best;
    }

    var lineup = [];
    for (var pos = 0; pos < 11; pos++) {
      var nm = posNames ? posNames[pos] : null;
      var idx = pick(nm, false);
      if (idx < 0) idx = pick(nm, true);   // 詰み防止（出場可能者が11人未満）
      if (idx < 0) return;                 // 11人揃わない＝何もしない
      lineup.push(idx); used[idx] = true;
    }
    team1State.lineup = lineup;
    if (typeof renderFormation === 'function') renderFormation();
    if (typeof renderBench === 'function') renderBench();
    if (typeof updateSettingBtnValues === 'function') updateSettingBtnValues();
  };

  /* MD-01: 設定画面の「キックオフ」から呼ばれる。ここで導入コマ→試合へ。
   * startGame(simulate.js) が window._leagueInMatch を見てこれに委譲する。 */
  window.leagueKickoff = function () {
    if (_preMatchRunning || !_pendingMatch) return;
    // ★ 欠場者が先発にいたらキックオフさせない（控えと入れ替えるまで試合を始めない）。
    var absent = [];
    if (typeof team1State !== 'undefined' && team1State && team1State.lineup && team1Data && team1Data.players) {
      for (var i = 0; i < 11; i++) {
        var idx = team1State.lineup[i];
        var p = team1Data.players[idx];
        if (!p) continue;
        var e = _peekSquadEntry(team1Data._srcKey || _pendingMatch.myId, _playerKey(p));
        if (e && ((e.injuryOut > 0) || (e.suspendOut > 0))) {
          absent.push(p.name + (e.injuryOut > 0 ? _t('（怪我）', ' (injured)') : _t('（出場停止）', ' (suspended)')));
        }
      }
    }
    if (absent.length) {
      alert(_t('出場できない選手が先発にいます：\n' + absent.join('、') + '\n\n控えと入れ替えてからキックオフしてください。',
               'These players cannot play but are in your XI:\n' + absent.join(', ') + '\n\nSwap them out before kickoff.'));
      return;   // 試合を始めない（設定画面に留まる）
    }
    var pm = _pendingMatch;
    _decorateSettingScreen(false);   // MD-04: ここから先はハーフタイム采配等で同じ画面を使うので装飾を外す
    // MD-02: 実際に試合を始めた布陣を記憶（次節に復元）。marked_player は相手依存なので保存しない。
    if (typeof team1State !== 'undefined' && team1State && team1State.lineup) {
      if (!_state.lineups) _state.lineups = {};
      _state.lineups[pm.myId] = {
        systemIdx: team1State.systemIdx, tactics: team1State.tactics,
        keyplayer: team1State.keyplayer, lineup: team1State.lineup.slice(0, 11),
        captain: (typeof team1State.captain === 'number') ? team1State.captain : -1
      };
      _save();
    }
    window._leagueInMatch = false;   // 設定画面を抜けた＝試合へコミット
    // UX-03: 漫画のコマ送りで「ため」を作ってから試合へ（未搭載/OFF なら即キックオフ）。
    // ★ コールバックは一度きりに保証する（スキップ連打・演出側の二重呼びで
    //   startManagerMatch が2回走ると試合状態が壊れる）。
    _preMatchRunning = true;
    var kicked = false;
    _playPreMatchThen(pm.myId, pm.oppId, pm.iAmHome, function () {
      if (kicked) return;
      kicked = true;
      _preMatchRunning = false;
      // MTG1-#1 采配の答え合わせ: この試合の係数記録を開始（attribution.js 非同梱/キルOFFは no-op）。
      //   getter 渡し＝HT の采配で _htState が後から動いても「今の介入」を読める。
      if (typeof attributionBeginMatch === 'function') {
        attributionBeginMatch(function () { return { ht: _htState }; });
      }
      startManagerMatch();
    });
  };

  /* MD-01: 設定画面の「戻る」＝試合をキャンセルして監督室へ。
   * 準備で仕込んだもの（戦術buff・終了フック・pending）を全て巻き戻す。
   * ★ 回復日の healing は冪等（_applyWeekRecovery が preApplied で管理）なので触らない。 */
  window.leagueCancelPrep = function () {
    _decorateSettingScreen(false);   // MD-04: 共有画面を元に戻す
    _htDecorate(false);
    window._leagueInMatch = false;
    _leagueMatchActive = false;
    window._leagueOnMatchFinish = null;
    _pendingMatch = null;
    // 布陣画面で触った交代状態を持ち出さない（次に開く画面＝シングル/W杯にも漏らさない）
    if (typeof resetSubStateForPrep === 'function') resetSubStateForPrep();
    if (typeof showScreen === 'function') showScreen('home');
  };

  /* UX-03 プレマッチ導入。Matchday は文言を持たないので、ここで全部組んで渡す。 */
  function _playPreMatchThen(myId, oppId, iAmHome, go) {
    if (!_matchdayOn() || typeof Matchday.playPreMatch !== 'function') { go(); return; }
    // ★ 週プランは試合後に消費されるので、まだ pending のうちに読む
    var pa = _pendingWeek();
    var weekSummary = ((pa && pa.slots) || []).filter(Boolean).map(function (s) {
      var d = _weekActionDef(s.kind);
      if (!d) return null;
      return { icon: d.icon, text: (d.summary ? d.summary(s) : _t(d.ja, d.en)) };
    }).filter(Boolean);

    var rival = _isRival(oppId), h2hText = '';
    if (rival) {
      var h = _h2h(myId, oppId);
      h2hText = _t('通算 ' + h.w + '勝' + h.d + '分' + h.l + '敗', h.w + '-' + h.d + '-' + h.l);
    }

    var ctx = {
      myDef: _clubDef(myId), oppDef: _clubDef(oppId),
      myName: _clubName(myId), oppName: _clubName(oppId),
      iAmHome: iAmHome, isRival: rival, h2hText: h2hText,
      threatText: _threatLabel(_opponentThreat(oppId)),
      weekSummary: weekSummary,
      goalText: _seasonGoalText(),
      labels: {
        round: _t('第' + (_state.round + 1) + '節 / ' + _state.fixtures.length,
                  'Round ' + (_state.round + 1) + ' / ' + _state.fixtures.length),
        home: _t('ホーム', 'HOME'), away: _t('アウェイ', 'AWAY'),
        rival: _t('宿敵対決', 'RIVALRY'),
        threat: _t('相手の攻め筋', 'Their threat'),
        prep: _t('今週の準備', "This week's prep"),
        goal: _t('クラブの要求', 'Club expects'),
        skip: _t('スキップ', 'SKIP'),
        tapHint: _t('タップで次へ', 'Tap to continue')
      }
    };
    try { Matchday.playPreMatch(ctx, go); }
    catch (e) { console.warn('[league] pre-match failed, kicking off directly', e); go(); }
  }

  function _onMatchFinish(myId, oppId, iAmHome, fx) {
    window._leagueOnMatchFinish = null;
    window._leagueInMatch = false;   // MD-01: 設定画面フラグの後始末（保険）
    _pendingMatch = null;
    // MTG1-#1: 記録を確定して閉じる（★ 他会場の AI 消化が始まる前に必ず閉じる＝別試合の混入防止）
    if (typeof attributionEndMatch === 'function') attributionEndMatch();
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

    // ── BX: 自試合の選手評価点（節のベストイレブン素材・chanceResults が生きているうちに採る）
    var roundRatings = {};
    try {
      if (gameState && gameState.team1 && typeof chanceResults !== 'undefined') {
        var rr0 = _rateMatch(gameState.team1, gameState.team2, chanceResults, myId, oppId);
        roundRatings[myId] = rr0[myId]; roundRatings[oppId] = rr0[oppId];
      }
    } catch (e) { console.warn('[league] rating failed', e); }

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
        // BX: 他会場の評価点も採る（節のベストイレブンは全4試合から選ぶ）
        var rrA = _rateMatch(r.home, r.away, r.chanceResults, m.home, m.away);
        roundRatings[m.home] = rrA[m.home]; roundRatings[m.away] = rrA[m.away];
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
    // BX: 節のベストイレブン確定＋通年集計へ加算
    _accumulateRatings(roundRatings);
    var roundXI = _pickBestXI(roundRatings);
    _state.lastResult = {
      bestXI: roundXI,   // 今節のベストイレブン（専門誌風カードが読む）
      manager: mg,   // 試合後バナーの成長表示用（MG-08 の演出はここを読む）
      // MTG1-#5: 自クラブの選手評価点（推しの1試合を語るための素材。読む側が無ければ誰も見ない）
      ratings: roundRatings[myId] || null,
      round: _state.round,
      mine: {
        me: myId, opp: oppId, ms: myScore, os: oppScore, res: res, home: iAmHome,
        rival: _isRival(oppId), posBefore: posBefore, posAfter: _position(myId),
        mom: report.mom, scorers: report.scorers
      },
      // ST-01: 試合詳細スタッツ（シングルマッチ後スタッツの転用）。chanceResults が生きて
      //   いるうちに採取して保存＝カードデッキ／記録タブから再表示できる。
      stats: _computeMatchStats(),
      others: others,
      log: matchLog   // 実況テキストログ（試合後に見直す用）
    };
    _state.round++;
    _state.lastPlayedDate = _todayStr();
    if (_state.round >= _state.fixtures.length) {
      _state.finished = true;
      _finReset();   // SN-03改3: シーズンが終わった瞬間は必ず①リーグ戦順位から見せる
      // SN-02 [SEASON_END]: 目標の達成判定と清算（信頼度・人気が大きく動く）。
      //   解任/オファーへの分岐は SN-05/SN-04 で、この結果（manager.lastSeasonResult）を読む。
      _state.lastResult.season = _settleSeason(_position(myId));
    }
    _save();

    // 監督ビューアの後片付け → リーグホームへ
    _htDecorate(false);   // HT-01: 共有のハーフタイムモーダルを元の見た目へ戻す
    if (typeof window._mvTeardown === 'function') { try { window._mvTeardown(); } catch (e) {} }
    showScreen('home');

    // MD-03: 試合が終わったら順送りの現在地（'match'）を必ず畳む。
    //   ★ ここで畳まないと、以降の _renderHub がキックオフ直前の「試合へ」を描き直してしまい、
    //     「監督室へ戻る」でホーム画面に戻れない（2026-07-26 ユーザー報告の再発防止）。
    _roundView = null;

    // UX-04: 試合後は「今節の号」を1コマずつ開く。
    //   ★ 先に監督室を描いておく＝号を閉じた瞬間に最新のハブが見えている状態にする。
    //   Matchday 未搭載／演出OFF／例外時は、従来どおりの一括バナー（_renderHub(true)）へ。
    var lr = _state.lastResult;
    if (lr && _matchdayOn() && typeof Matchday.playPostMatch === 'function') {
      try {
        _renderHub(false);
        Matchday.playPostMatch(_postMatchPanels(lr), {
          res: lr.mine.res,
          title: _t('デイリーリーグ', 'DAILY LEAGUE'),
          sub: _t('第' + (lr.round + 1) + '節 号', 'Round ' + (lr.round + 1) + ' issue'),
          closeLabel: _t('監督室へ戻る', 'Back to the office'),
          tapHint: _t('タップで次を読む', 'Tap to read on')
        }, function () { _renderHub(false); });
        return;
      } catch (e) { console.warn('[league] post-match sequence failed, using banner', e); }
    }
    _renderHub(true);
  }

  /* ── レンダリング ───────────────────────────────────────────────────── */
  /* UX-01: スタイルは css/league-ui.css（build が lab の <head> に挿す）へ移設済み。
   * ここでは「本当に読み込まれたか」をセンチネル（--lg-css）で確認するだけ。
   * 万一 CSS が届かない配信構成（root を直接 serve する等）では、最低限の
   * 非常用スタイルだけ注入して**文字が読めなくなる事故を防ぐ**。 */
  var _styleChecked = false;
  function _ensureStyle() {
    if (_styleChecked) return;
    _styleChecked = true;
    var ok = false;
    try {
      ok = getComputedStyle(document.documentElement).getPropertyValue('--lg-css').trim() === '1';
    } catch (e) { ok = false; }
    if (ok) return;
    console.warn('[league] css/league-ui.css が読み込まれていません。非常用スタイルで描画します。');
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

  /* ── UX-01/05/06 UI 部品への seam ────────────────────────────────────
   * LgUI は「文言もクラブ解決も持たない」純ビルダなので、league 側が解決関数を渡す。 */
  function _lgOn() { return typeof LgUI !== 'undefined'; }
  function _clubResolver() {
    return function (id) {
      var d = _clubDef(id);
      return { crest: d ? d.crest : '', color: d ? d.color : '#8899aa', name: _clubName(id) };
    };
  }
  /* 顔（portrait.js）と背景（lab-art.js）を、描画後の DOM に対してまとめて塗る。 */
  function _paintPortraitCanvases(root) {
    if (!root) return;
    if (_lgOn() && LgUI.paintPortraits) LgUI.paintPortraits(root);
    if (_lgOn() && LgUI.paintArt) LgUI.paintArt(root);
  }
  /* 伸びるバー1本。LgUI の有無にかかわらず .lg-stat-fill[data-pct] を出すので
   * _growBars() がそのまま効く（＝どちらの経路でもバーは伸びる）。 */
  function _statBarHTML(label, v, max, color, valText) {
    max = max || 100;
    if (_lgOn() && LgUI.statBar) return LgUI.statBar(label, v, max, { color: color, text: valText });
    var pct = Math.max(0, Math.min(100, (v / max) * 100));
    return '<div class="lg-stat"><div class="lg-stat-label">' + label + '</div>' +
      '<div class="lg-stat-track"><i class="lg-stat-fill" data-pct="' + pct.toFixed(1) + '" style="background:' +
        (color || 'linear-gradient(90deg,#4a9eff,#7ad0ff)') + '"></i></div>' +
      '<div class="lg-stat-val">' + (valText != null ? valText : Math.round(v)) + '</div></div>';
  }

  /* 監督ステータス等のバーを伸ばす（Juice 未搭載なら即時 width）。 */
  function _growBars(root) {
    if (!root) return;
    if (_lgOn() && LgUI.growBars) LgUI.growBars(root);
    else {
      var f = root.querySelectorAll('.lg-stat-fill[data-pct]');
      Array.prototype.forEach.call(f, function (el) { el.style.width = (el.getAttribute('data-pct') || 0) + '%'; });
    }
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
    _hubMode(false);             // 8枚並ぶのでこの画面はスクロールさせる
    _seasonEndMode(false);       // 最終話の固定フレーム化が残っていたら解く
    _paintPickPortraits(defs);   // data-club の顔（クラブカラー指定つき）
    _afterRender();              // 監督室の背景・その他の canvas・バー
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

  /* ── 偵察レポート（相手の攻め筋を上位3つ・ウェイトつきで見せる）──────────
   * ★ 2026-08-04: 「攻め筋に対策する」機能の廃止後も、**相手を知る情報**としてここは残す
   *   （スカウティングの表示であって采配ではない）。✓対策マークと「封じられる」文言は撤去し、
   *   中立な「相手の武器を読む」表現に直した。 */
  function _scoutHTML(oppId) {
    if (!oppId) return '';
    var ranked = _opponentThreatsRanked(oppId).slice(0, 3);
    if (!ranked.length) return '';
    var rows = ranked.map(function (r, i) {
      var pct = Math.round(r.pct * 100);
      var rank = ['①', '②', '③'][i] || '';
      return '<div class="lg-scout-row">' +
        '<span class="lg-scout-rank">' + rank + '</span>' +
        '<span class="lg-scout-name">' + _threatLabel(r.id) + '</span>' +
        '<span class="lg-scout-bar"><i style="width:' + pct + '%"></i></span>' +
        '<span class="lg-scout-val">' + Math.round(r.val) + '</span>' +
        '</div>';
    }).join('');
    var hint = _t('相手が最も強い攻め筋（数字は先発の平均能力）',
                  'Where they are strongest (average of their starters)');

    // 相手の欠場者（怪我/出場停止）＝相手も自動で欠場者を外して戦う、が見える化＝安心材料。
    var oppAbs = _absentees(oppId);
    var absLine = '';
    if (oppAbs.length) {
      var chips = oppAbs.map(function (a) {
        var ic = (a.kind === 'injury') ? '🩹' : '🟥';
        return '<span class="lg-scout-abs">' + ic + a.name + '</span>';
      }).join('');
      absLine = '<div class="lg-scout-absrow"><span class="lg-scout-abslabel">' +
        _t('相手の欠場', 'Opp. out') + '</span>' + chips + '</div>';
    }

    return '<div class="lg-h">' + _t('偵察レポート', 'Scouting') +
        '<span class="lg-badge">' + _t('相手の攻め筋', 'Their threats') + '</span></div>' +
      '<div class="lg-card lg-scout">' + rows + absLine +
        '<div class="lg-scout-hint">' + hint + '</div></div>';
  }

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

  /* UX-06: 育成対象は「ドロップダウンから選ぶ」のをやめ、顔つきカードを選ぶ体験にする。
   * LgUI 未搭載時は従来の <select> にフォールバック（機能は失わない）。 */
  function _traineeSelectHTML(idx, clubId, cur) {
    var td = _clubData(clubId); if (!td) return '';
    if (_lgOn() && LgUI.playerPicker) {
      // ★ 各カードに「監督への信頼」を出す（MG-12）。記者会見で動いた値がここに
      //   見えることで、「選手をかばう」の意味と練習効率の関係が読める。
      var list = td.players.map(function (p) {
        var k = _playerKey(p);
        var e = _peekSquadEntry(clubId, k);
        var tr = (e && typeof e.trust === 'number') ? e.trust : MANAGER_TUNING.TRUST_START;
        return { key: k, name: p.name, portrait: k, sub: '♥' + Math.round(tr) };
      });
      return '<div class="lg-slotsub">' +
        LgUI.playerPicker(list, cur, 'leagueSetTrainee', idx,
          { label: _t('育成する選手', 'Player to train') }) + '</div>';
    }
    var opts = td.players.map(function (p) {
      var k = _playerKey(p);
      return '<option value="' + k.replace(/"/g, '&quot;') + '"' + (k === cur ? ' selected' : '') + '>' + p.name + '</option>';
    }).join('');
    return '<div class="lg-slotsub"><select class="lg-select" onchange="leagueSetTrainee(' + idx + ', this.value)">' + opts + '</select></div>';
  }

  /* MG-06 フィジカルコーチ。永続化されているコンディション情報（負傷残り週）だけを読み、
   * 回復日へつながる一言にする。試合内 fatigue は週を跨がないため、ここで捏造しない。 */
  function _physicalCoachAdvice(clubId) {
    var list = _absentees(clubId);
    var injured = list.filter(function (a) { return a.kind === 'injury'; })
      .sort(function (a, b) { return b.weeks - a.weeks; });
    if (injured.length) {
      var a = injured[0];
      return { status: 'concern', name: _keyDisplayName(a.key || a.name), weeks: a.weeks,
        text: _t('<b>' + _escHtml(_keyDisplayName(a.key || a.name)) + '</b> 選手はコンディション不良です。回復日を入れると復帰が1週早まります。',
          '<b>' + _escHtml(_keyDisplayName(a.key || a.name)) + '</b> is not fully fit. A recovery day brings the return forward by one week.') };
    }
    return { status: 'ready', name: null, weeks: 0,
      text: _t('フィジカル面の懸念はありません。今週は強化メニューを優先できます。',
        'No fitness concerns this week. You can prioritise development work.') };
  }

  function _physicalCoachHTML(clubId) {
    var advice = _physicalCoachAdvice(clubId);
    var list = _absentees(clubId);
    var rows = list.map(function (a) {
      var ic = (a.kind === 'injury') ? '🩹' : '🟥';
      var lbl = (a.kind === 'injury')
        ? _t('あと' + a.weeks + '週', a.weeks + 'w left')
        : _t('出場停止 あと' + a.weeks + '週', 'Suspended ' + a.weeks + 'w');
      return '<div class="lg-absrow">' + ic + ' <b>' + _escHtml(_keyDisplayName(a.key || a.name)) + '</b>' +
        '<span style="margin-left:auto;color:' + (a.kind === 'injury' ? '#ffb37a' : '#ff8f8f') + '">' + lbl + '</span></div>';
    }).join('');
    return '<div class="lg-h">' + _t('フィジカルコーチ', 'Physical Coach') +
        '<span class="lg-badge">' + _t('コンディション', 'Fitness') + '</span></div>' +
      '<div class="lg-card lg-coachbrief ' + advice.status + '">' +
        '<div class="lg-coachbrief-main"><span>🧑‍⚕️</span><p>' + advice.text + '</p></div>' +
        (rows ? '<div class="lg-coachbrief-list">' + rows + '</div>' : '') + '</div>';
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
      if (p.k === 'press') return _t('記者会見での発言', 'What you said to the press');   // PC-01
      return '';
    }).filter(Boolean).join('・');
    var mood = flat ? _t('世論は静観', 'The public is unmoved')
      : (up ? _t('支持が高まっている', 'Support is rising') : _t('風当たりが強まっている', 'Pressure is building'));
    // MTG1-#5 数値の言葉化: いまの立ち位置を5段階の一語で主役にし、増減と実数はその下に添える。
    var word = (typeof oshiWordHTML === 'function') ? oshiWordHTML('pop', pop.value) : '';
    return '<div class="lg-mini" style="margin-top:6px;text-align:center;border-top:1px solid rgba(255,255,255,0.12);padding-top:8px">' +
      '<div style="font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:3px">' + _t('世論', 'Public opinion') + '</div>' +
      (word ? '<div class="lg-wordline">' + word + '</div>' : '') +
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
      if (p.k === 'press') return _t('記者会見での発言', 'What you said to the press');   // PC-01
      return '';
    }).filter(Boolean).join('・');
    // MTG1-#5 数値の言葉化: 会長の視線も一語で（境界＝解任判定の実閾値なので言葉が嘘をつかない）
    var word = (typeof oshiWordHTML === 'function') ? oshiWordHTML('trust', tr.value) : '';
    return '<div class="lg-mini" style="margin-top:4px;text-align:center">' +
      (word ? '<div class="lg-wordline sm">' + _t('会長', 'The board') + ' ' + word + '</div>' : '') +
      _t('クラブの信頼', 'Club trust') + ' <b style="color:' + col + '">' + sign + '</b>' +
      ' <span style="opacity:.6">（' + Math.round(tr.value) + '）</span>' +
      (why ? '　<span style="opacity:.65">' + why + '</span>' : '') + '</div>';
  }

  /* 個人タイトル（SN-03）。当季の squads 記録から得点王/アシスト王/皆勤を表彰する。 */
  function _seasonAwardsHTML(top) {
    if (!top || (!top.scorer && !top.assister && !top.iron)) return '';
    var rows = [];
    if (top.scorer) rows.push('👑 ' + _t('得点王', 'Top scorer') + '：<b>' + top.scorer.name + '</b>（' + top.scorer.n + _t('点', '') + '）');
    if (top.assister) rows.push('🎁 ' + _t('アシスト王', 'Top assists') + '：<b>' + top.assister.name + '</b>（' + top.assister.n + '）');
    if (top.iron) rows.push('🛡️ ' + _t('皆勤賞', 'Iron man') + '：<b>' + top.iron.name + '</b>（' + top.iron.n + _t('試合', ' apps') + '）');
    return '<div class="lg-mini" style="margin-top:7px;text-align:center;line-height:1.9;border-top:1px solid rgba(255,255,255,0.14);padding-top:7px">' +
      '<div style="font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:2px">' + _t('シーズン表彰', 'Season awards') + '</div>' +
      rows.join('<br>') + '</div>';
  }

  /* 最終話の個人タイトル（SN-03）＝メダルカードの showcase 版。
     _seasonAwardsHTML はバックナンバー用の圧縮版として温存し、こちらは総評セクションに載せる。 */
  function _finAwardsHTML(top) {
    if (!top || (!top.scorer && !top.assister && !top.iron)) return '';
    function card(medal, roleJa, roleEn, who, val) {
      return '<div class="lg-fin-award">' +
        '<span class="lg-fin-award-medal">' + medal + '</span>' +
        '<span class="lg-fin-award-role">' + _t(roleJa, roleEn) + '</span>' +
        '<span class="lg-fin-award-who">' + who + '</span>' +
        '<span class="lg-fin-award-val">' + val + '</span></div>';
    }
    var cards = [];
    if (top.scorer) cards.push(card('👑', '得点王', 'Top scorer', top.scorer.name, top.scorer.n + _t('点', ' G')));
    if (top.assister) cards.push(card('🎯', 'アシスト王', 'Top assists', top.assister.name, top.assister.n + _t('回', ' A')));
    if (top.iron) cards.push(card('🛡️', '皆勤賞', 'Ever-present', top.iron.name, top.iron.n + _t('試合', ' apps')));
    return '<div class="lg-fin-awards">' + cards.join('') + '</div>';   // 見出しは呼び出し側（最終話の中央ゾーン）が持つ
  }

  /* ── ベストイレブンの描画（BX）──────────────────────────────────
   * FW→MF→DF→GK の順に上から並べるピッチ風レイアウト（前線が上＝紙面の花形）。
   * mode 'weekly' = サッカー専門誌風（黄×黒のマストヘッド・見出しの勢い）
   * mode 'season' = リーグ協会の公式発表風（紺×金・格式） */
  function _bestXIHTML(xi, mode, titleJa, titleEn, subJa, subEn) {
    if (!xi || !xi.GK.length) return '';
    // UX-05: ピッチ図＋顔の「雑誌の見開き」へ（LgUI 未搭載なら従来のチップ列）。
    if (_lgOn() && LgUI.bestXISpread) {
      return LgUI.bestXISpread(xi, mode,
        { title: _t(titleJa, titleEn), sub: _t(subJa, subEn) },
        { club: _clubResolver() });
    }
    var weekly = (mode === 'weekly');
    var wrapStyle = weekly
      ? 'background:linear-gradient(170deg,#0d3b1e,#0a2a16 70%);border:2px solid #f5c518'
      : 'background:linear-gradient(170deg,#0b1a3a,#081128 70%);border:2px solid #c9a227';
    var headBand = weekly
      ? '<div style="background:#f5c518;color:#111;font-weight:900;font-size:13px;letter-spacing:2px;' +
        'padding:5px 10px;margin:-11px -13px 8px;border-radius:9px 9px 0 0;display:flex;justify-content:space-between;align-items:center">' +
        '<span>⚽ ' + _t(titleJa, titleEn) + '</span>' +
        '<span style="font-size:10px;font-weight:800;background:#111;color:#f5c518;padding:2px 7px;border-radius:3px">' + _t(subJa, subEn) + '</span></div>'
      : '<div style="text-align:center;margin:-3px 0 8px">' +
        '<div style="font-size:9px;letter-spacing:3px;color:#c9a227">' + _t(subJa, subEn) + '</div>' +
        '<div style="font-weight:900;font-size:15px;color:#f4e7c3;margin-top:2px">🏅 ' + _t(titleJa, titleEn) + '</div>' +
        '<div style="width:56px;height:2px;background:#c9a227;margin:5px auto 0"></div></div>';

    function _chip(p) {
      var def = _clubDef(p.clubId);
      var badge = weekly ? '#f5c518' : '#c9a227';
      var stat = (p.goals ? '⚽' + p.goals : '') + (p.assists ? ' 🅰' + p.assists : '');
      return '<div style="display:inline-flex;flex-direction:column;align-items:center;min-width:5.2em;max-width:7em;margin:2px 3px">' +
        '<div style="font-size:15px;line-height:1">' + (def ? def.crest : '') + '</div>' +
        '<div style="font-size:10px;font-weight:800;color:#fff;text-align:center;line-height:1.25;margin-top:2px;word-break:keep-all">' + p.name + '</div>' +
        '<div style="font-size:10px;font-weight:900;color:#111;background:' + badge + ';border-radius:3px;padding:0 5px;margin-top:2px">' + p.rating.toFixed(1) + '</div>' +
        (stat ? '<div style="font-size:9px;color:rgba(255,255,255,0.75);margin-top:1px">' + stat + '</div>' : '') +
        '</div>';
    }
    function _line(label, arr) {
      if (!arr.length) return '';
      return '<div style="display:flex;align-items:center;gap:6px;margin-top:5px">' +
        '<div style="flex:0 0 2em;font-size:9px;font-weight:800;letter-spacing:1px;color:rgba(255,255,255,0.45);text-align:center">' + label + '</div>' +
        '<div style="flex:1;text-align:center">' + arr.map(_chip).join('') + '</div></div>';
    }
    return '<div class="lg-card" style="margin-top:8px;' + wrapStyle + '">' + headBand +
      _line('FW', xi.FW) + _line('MF', xi.MF) + _line('DF', xi.DF) + _line('GK', xi.GK) +
      '</div>';
  }

  /* 契約の分岐（SN-04/SN-05）。解任＝現クラブ残留不可・オファーから必ず選ぶ（ゲームオーバーにしない）。
     ※ 最終話専用。体裁はトークン化した .lg-fin-* クラスで持つ（生値インライン廃止）。 */
  function _contractBranchHTML() {
    var br = _contractBranch();
    if (!br) return '';
    var html = '';

    if (br.sacked) {
      html += '<div class="lg-fin-sacked">' +
        '<span class="lg-fin-sacked-icon">📋</span>' +
        '<span class="lg-fin-sacked-ttl">' + _t('解任通告', 'Sacked') + '</span>' +
        '<span class="lg-fin-sacked-body">' +
          _t('目標未達と信頼の低下を受け、クラブはあなたとの契約を打ち切った。だが、あなたの挑戦はここで終わらない。',
             'The club has terminated your contract — but your story does not end here.') + '</span></div>';
    }

    // オファー一覧（解任時は必須の選択肢・残留可なら「移籍する」の選択肢）
    if (br.offers.length) {
      var offerRows = br.offers.map(function (o) {
        var def = _clubDef(o.clubId);
        return '<button type="button" class="lg-fin-offer" onclick="leagueAcceptOffer(\'' + o.clubId + '\')">' +
          '<span class="lg-fin-offer-crest">' + def.crest + '</span>' +
          '<span class="lg-fin-offer-body">' +
            '<span class="lg-fin-offer-name">' + _clubName(o.clubId) + '</span>' +
            '<span class="lg-fin-offer-str">' + _t('チーム力', 'Strength') + ' <b>' + o.strength + '</b></span></span>' +
          '<span class="lg-fin-offer-go">▶</span></button>';
      }).join('');
      html += '<div class="lg-fin-subh">' + _t('届いたオファー', 'Offers on the table') +
        '<span class="lg-badge">' + br.offers.length + '</span></div>' +
        '<div class="lg-fin-offers">' + offerRows + '</div>';
    }

    if (br.canRenew) {
      html += '<button class="lg-btn lg-fin-renew" onclick="leagueConfirmNewSeason()">' +
        _t('残留して次のシーズンへ', 'Stay and start next season') + '</button>';
    }
    return html;
  }

  /* シーズン終了の達成判定（SN-02）。最終話専用＝トークン化した .lg-fin-vd で組む。 */
  function _seasonVerdictHTML(sv) {
    if (!sv) return '';
    var ok = sv.achieved;
    var goalTxt = _t('要求 ' + (sv.goal <= 1 ? '優勝' : sv.goal + '位以内') + ' ／ 結果 ' + sv.finalPos + '位',
                     'Expected ' + (sv.goal <= 1 ? 'the title' : 'top ' + sv.goal) + ' · finished ' + sv.finalPos);
    function stat(labelJa, labelEn, delta) {
      var cls = delta > 0 ? ' up' : (delta < 0 ? ' down' : '');
      var sign = delta > 0 ? '+' : '';
      return '<div class="lg-fin-vd-stat' + cls + '">' +
        '<span class="lg-fin-vd-k">' + _t(labelJa, labelEn) + '</span>' +
        '<span class="lg-fin-vd-v">' + sign + delta + '</span></div>';
    }
    return '<div class="lg-fin-vd' + (ok ? ' ok' : ' ng') + '">' +
      '<div class="lg-fin-vd-head">' +
        '<span class="lg-fin-vd-icon">' + (ok ? '✔' : '✕') + '</span>' +
        '<span class="lg-fin-vd-txt">' +
          '<span class="lg-fin-vd-badge">' + (ok ? _t('目標達成', 'Target achieved') : _t('目標未達', 'Target missed')) + '</span>' +
          '<span class="lg-fin-vd-goal">' + goalTxt + '</span></span></div>' +
      '<div class="lg-fin-vd-stats">' +
        stat('クラブの信頼', 'Club trust', sv.trustDelta) +
        stat('人気', 'Popularity', sv.popDelta) +
      '</div></div>';
  }

  /* 監督ステータス（MG-03/MG-05 の可視化・数字が動いていることを読ませる最小表示） */
  function _managerCardHTML() {
    var m = _state.manager; if (!m || !m.params) return '';
    var defs = [
      ['tactical', '戦術眼', 'Tactics'], ['analysis', '分析力', 'Analysis'],
      ['motivator', 'モチベーター', 'Motivation'], ['conditioning', 'フィジカル管理', 'Conditioning'],
      ['popularity', '人気', 'Popularity']
    ];
    // UX-02: 固定 width をやめ、data-pct を持つバーにする（_growBars で伸びる）
    var rows = defs.map(function (d) {
      var v = Math.round(m.params[d[0]] || 0);
      return _statBarHTML(_t(d[1], d[2]), v, 100);
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
        _statBarHTML(_t('クラブの信頼', 'Club trust'), trust, 100, tcol,
          '<span style="color:' + tcol + '">' + trust + '</span>') +
        '</div>';
    }
    // ★ バランス重視(FREE) は常時使える基本形なので、習得済みリストの先頭に必ず並べる
    //   （learnedTactics には入れていないため、表示側で補う）
    var learned = [_tacticLabel('FREE')].concat((m.learnedTactics || []).map(_tacticLabel)).join('・');
    var lockedCount = TACTIC_IDS.filter(function (id) {
      return id !== 'FREE' && (m.learnedTactics || []).indexOf(id) < 0;
    }).length;
    // MG-05: 連勝/連敗は人気の駆動要因なのでここに出す（次節の人気の動きが読める）
    var st = _currentStreak(), stLine = '';
    if (st.n >= 2 && (st.res === 'W' || st.res === 'L')) {
      stLine = '<div class="lg-mini" style="margin-top:4px;color:' + (st.res === 'W' ? '#8fe3a4' : '#ff9a8f') + '">' +
        (st.res === 'W' ? '🔥 ' + _t(st.n + '連勝中', st.n + '-game win run') : '💧 ' + _t(st.n + '連敗中', st.n + '-game losing run')) + '</div>';
    }
    return '<div class="lg-h">' + _t('監督', 'Manager') + '</div>' +
      '<div class="lg-card" style="padding:9px 11px">' + rows + stLine + goalBlock +
      '<div class="lg-mini" style="margin-top:7px;border-top:1px solid rgba(255,255,255,0.1);padding-top:6px">' +
        _t('使える戦術', 'Tactics available') + '：' + learned +
        (lockedCount ? '<span style="opacity:.55">　🔒' + _t('未習得 ' + lockedCount, lockedCount + ' locked') + '</span>' : '') +
        '</div></div>';
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * UX-07 監督室ハブ（固定1画面・タブで入れ替える）
   * -----------------------------------------------------------------------
   * ★ 縦に積むのをやめた。試合後を積み上げ→カードデッキにしたのと同じ理由。
   *   以前は「今週の準備」が場所を取り、**肝心の VS とプレイボタンが画面外へ
   *   押し出されていた**（主役が見えない）。
   *   → 上に固定ステータスバー / 左に「次の試合」（常時・主役） / 右にタブ。
   * 骨格（.lg-cols / .lg-col-main / .lg-col-side）は style.css の横長2カラムを
   * 壊さないためそのまま使い、中身だけを差し替える。
   * ═══════════════════════════════════════════════════════════════════════ */
  /* 固定ステータスバー＝「自分が誰で、今どこにいるか」を常に1行で見せる。 */
  function _statusBarHTML(myId, myPos, myRow) {
    var d = _clubDef(myId);
    var rivalId = _state.rival;
    var rival = rivalId
      ? '<span class="lg-hb-rival">' + _t('宿敵', 'Rival') + ' ' + _clubDef(rivalId).crest + '</span>' : '';
    return '<div class="lg-hubbar">' +
      '<span class="lg-hb-crest" style="background:' + d.color + '33;border-color:' + d.color + '">' + d.crest + '</span>' +
      '<span class="lg-hb-name">' + _clubName(myId) + '</span>' +
      '<span class="lg-hb-season">S' + (_state.season || 1) + '</span>' +
      '<span class="lg-hb-sep"></span>' +
      '<span class="lg-hb-stat"><b>' + myPos + _t('位', '') + '</b></span>' +
      '<span class="lg-hb-stat">' + myRow.pts + _t('pt', 'pts') + '</span>' +
      '<span class="lg-hb-stat lg-hb-rec">' + myRow.w + _t('勝', 'W') + myRow.d + _t('分', 'D') + myRow.l + _t('敗', 'L') + '</span>' +
      rival + '</div>';
  }

  /* MD-03 ホーム画面の右カラム＝俯瞰の3ブロック（順位／監督ステータス／記録）。
   * 「次にやること」は左カラムの試合カードと「次へ」に集約されているので、ここは読むだけの面。 */
  function _homeSideHTML() {
    // ★ _managerCardHTML / _hubRecordHTML は自前の見出しを持つので二重に付けない。
    //   順位はタップで②順位（フル表示）へ＝ホームでは俯瞰だけ見せる。
    return '<div class="lg-h">' + _t('順位', 'Table') +
        '<button type="button" class="lg-h-more" onclick="leagueRoundView(\'table\')">' +
        _t('詳しく', 'Open') + ' ▸</button></div>' +
      '<div class="lg-tapwrap" role="button" tabindex="0" onclick="leagueRoundView(\'table\')">' +
        _standingsTableHTML(_sortedStandings(), _state.myClub) + '</div>' +
      _managerCardHTML() +
      '<div class="lg-h">' + _t('記録', 'Records') + '</div>' +
      _hubRecordHTML();
  }

  function _hubRecordHTML() {
    var h = '';
    if (_state.lastResult && _state.lastResult.log && _state.lastResult.log.length) {
      h += '<button class="lg-btn sec" onclick="leagueShowLog()">📜 ' + _t('前回の試合ログ（実況）', 'Match commentary log') + '</button>';
    }
    if (_state.lastResult && _matchdayOn()) {
      h += '<button class="lg-btn sec" onclick="leagueReplayPostMatch()">🗞 ' + _t('前回の「号」をもう一度読む', 'Re-read the last issue') + '</button>';
    } else if (_state.lastResult && _state.lastResult.mine) {
      // Matchday 演出が無い環境ではオーバーレイのレポートを開き直す（SH-01 の試合後レポート）。
      h += '<button class="lg-btn sec" onclick="leagueShowReport()">🗞 ' + _t('前回のレポートを見る', 'Re-open the last report') + '</button>';
    }
    if (_state.history && _state.history.length) {
      h += '<button class="lg-btn sec" onclick="leagueShowHistory()">📚 ' + _t('バックナンバー（' + _state.history.length + '冊）', 'Back issues (' + _state.history.length + ')') + '</button>';
    }
    if (_testMode()) {
      var tOn = !!(_state && _state.testUnlock);
      var tl = tOn ? _t('🔓 テスト：1日1回制限 OFF（毎回プレイ可）', '🔓 TEST: daily limit OFF (replay anytime)')
                   : _t('🔒 テスト：1日1回制限 ON（タップで解除）', '🔒 TEST: daily limit ON (tap to disable)');
      h += '<button class="lg-btn sec" style="border:1px dashed rgba(255,255,255,0.35);font-size:12px;' +
        (tOn ? 'color:#ffd479' : '') + '" onclick="leagueToggleTestLock()">' + tl + '</button>';
      if (!_state.finished) {
        h += '<button class="lg-btn sec" style="border:1px dashed rgba(255,255,255,0.35);font-size:12px" ' +
          'onclick="leagueDebugSimSeason()">⏩ ' + _t('テスト：シーズン終了まで飛ばす', 'TEST: skip to season end') + '</button>';
      }
    }
    h += '<button class="lg-btn sec" onclick="leagueBackToTitle()">' + _t('← タイトルへ戻る', '← Back to title') + '</button>';
    return h;
  }

  /* ── SN-03改2 最終話：3ゾーン＋下部コマンドバー（据置ゲーム級・スクロール廃止）──────
   * 2026-07-25 確定の「レトロ・ドット絵ハイブリッド」方向（Codex H2_season_end_retro）。
   * 固定フレームに ①シーズン総括 ②ベストイレブン＋個人タイトル ③クラブ評価 を横3ゾーンで並べ、
   * 下部に「契約選択」コマンドバー（残留／オファー／退任）を据える。ページ送りもスクロールもしない。
   * ドット頭は本作の実ポートレート（portrait.js）を bestXISpread 経由で描く（モックの写真は不使用）。 */

  /* 順位から総評グレードを導く（順位の要約＝データの捏造ではない）。優勝=S。 */
  function _seasonGrade(pos, total, sv) {
    if (pos <= 1) return 'S';
    var achieved = !!(sv && sv.achieved);
    var q = total ? pos / total : 1;
    if (achieved) return q <= 0.375 ? 'A' : 'B+';
    if (q <= 0.5) return 'B';
    if (q <= 0.75) return 'C';
    return 'D';
  }

  /* 最終話だけ #screen-home を固定フレーム化する（landscape 既定の overflow-y:auto を止める）。 */
  function _seasonEndMode(on) {
    var s = document.getElementById('screen-home'); if (!s) return;
    s.classList.toggle('season-end-mode', !!on);
  }

  /* 右ゾーン＝クラブ評価（目標結果＋信頼＋人気）。予算は本作に無いので出さない（数値を捏造しない）。 */
  function _finaleVerdictZone(sv) {
    var m = _state.manager || {};
    var pop = m.params ? Math.round(m.params.popularity) : 0;
    var trust = Math.round((typeof m.clubTrust === 'number') ? m.clubTrust : 0);
    var ok = !!(sv && sv.achieved);
    var goalTxt = sv ? _t((sv.goal <= 1 ? '優勝' : sv.goal + '位以内'),
                          (sv.goal <= 1 ? 'Win title' : 'Top ' + sv.goal)) : '—';
    function meter(icon, labelJa, labelEn, val, delta) {
      var cls = delta > 0 ? ' up' : (delta < 0 ? ' down' : '');
      var sign = delta > 0 ? '+' : '';
      var pct = Math.max(0, Math.min(100, val));
      return '<div class="lg-se-meter' + cls + '">' +
        '<div class="lg-se-meter-top">' +
          '<span class="lg-se-meter-k">' + icon + ' ' + _t(labelJa, labelEn) + '</span>' +
          '<span class="lg-se-meter-d">' + (delta === 0 ? '±0' : sign + delta) + '</span></div>' +
        '<div class="lg-se-bar"><i class="lg-stat-fill lg-se-fill" data-pct="' + pct.toFixed(1) + '"></i>' +
          '<span class="lg-se-meter-v">' + Math.round(val) + '<i>/100</i></span></div>' +
        '</div>';
    }
    return '<section class="lg-se-zone lg-se-vd">' +
      '<div class="lg-se-ztitle">' + _t('クラブ評価', 'Club verdict') + '</div>' +
      '<div class="lg-se-goal ' + (ok ? 'ok' : 'ng') + '">' +
        '<span class="lg-se-goal-k">' + _t('目標結果', 'Target') + '</span>' +
        '<span class="lg-se-goal-badge">' + (ok ? _t('達成', 'Met') + ' ✓' : _t('未達', 'Missed') + ' ✕') + '</span>' +
        '<span class="lg-se-goal-tx">' + goalTxt + '</span>' +
      '</div>' +
      meter('🤝', 'クラブの信頼', 'Trust', trust, sv ? sv.trustDelta : 0) +
      meter('📣', '人気', 'Popularity', pop, sv ? sv.popDelta : 0) +
    '</section>';
  }

  /* 下部コマンドバー＝契約選択（残留／オファー／退任）。解任時は残留不可・オファーが主導線。 */
  /* ── SN-03改3 ページ順送り（2026-07-26・ユーザー提供スライド「リーグ戦ページ遷移」準拠）──
   * シーズン終了 = ①リーグ戦順位 → ②個人表彰 → ③ベストイレブン → ④自チーム成績 → ⑤クラブ評価
   * シーズン前(2年目以降) = ①オファークラブリスト → ②オファークラブ詳細 → ③クラブ決定 → ④選手獲得・放出
   * どちらも「1画面1テーマ・次へで送る」。固定フレーム(.season-end-mode)と .lg-se-* は流用する。
   * ★ 画面遷移だけの層＝集計関数はすべて確定データの読み出し（rng 不使用・エンジン不変）。 */
  var FIN_PAGES = [
    { id: 'table',   ja: 'リーグ戦順位',   en: 'League table' },
    { id: 'honours', ja: '個人表彰',       en: 'Honours' },
    { id: 'bestxi',  ja: 'ベストイレブン', en: 'Team of the Season' },
    { id: 'mine',    ja: '自チーム成績',   en: 'Club record' },
    { id: 'verdict', ja: 'クラブ評価',     en: 'Club verdict' }
  ];
  var PRE_PAGES = [
    { id: 'offers', ja: 'オファー',       en: 'Offers' },
    { id: 'detail', ja: 'クラブ詳細',     en: 'Club detail' },
    { id: 'decide', ja: 'クラブ決定',     en: 'Decision' },
    { id: 'squad',  ja: '選手獲得・放出', en: 'Transfers' }
  ];
  var _finPage = 0;      // シーズン終了の何ページ目か（0..4）
  var _prePage = -1;     // -1 = シーズン終了フロー中／0.. = シーズン前フロー
  var _preTarget = null; // シーズン前で選んでいるクラブ {clubId, incumbent, salary}
  var _finRank = null;   // ②個人表彰から開いた上位10名ページ（null=表彰面）

  function _finReset() { _finPage = 0; _prePage = -1; _preTarget = null; _roundView = null; _finRank = null; }

  /* 共通ヘッダー（マストヘッド＋現在地のパンくず）。 */
  function _finHeadHTML(kind, idx, won) {
    var pages = (kind === 'pre') ? PRE_PAGES : FIN_PAGES;
    var chips = pages.map(function (p, i) {
      var cls = (i === idx) ? ' on' : (i < idx ? ' done' : '');
      return '<span class="lg-se-step' + cls + '"><i>' + (i + 1) + '</i>' + _t(p.ja, p.en) + '</span>';
    }).join('<span class="lg-se-arrow">›</span>');
    var seasonNo = _state.season || 1;
    var rounds = (_state.fixtures && _state.fixtures.length) || 14;
    var isPre = (kind === 'pre');
    // シーズン前は「これから戦う季」を出す。決定（_startNextSeason）前は season がまだ旧季なので +1。
    var upcoming = seasonNo + (_state.finished ? 1 : 0);
    var sub = isPre
      ? _t('Season ' + upcoming + ' へ向けて', 'Heading into Season ' + upcoming)
      : _t(rounds + '節終了', rounds + ' rounds played') + ' · Season ' + seasonNo;
    return '<header class="lg-se-top">' +
      '<div class="lg-se-brand">' +
        '<span class="lg-se-emblem">' + (isPre ? '📝' : (won ? '👑' : '🏁')) + '</span>' +
        '<div class="lg-se-brandtx">' +
          '<h1 class="lg-se-h1">' + (isPre ? _t('シーズン前', 'Pre-season') : _t('シーズン終了', 'Season Complete')) + '</h1>' +
          '<span class="lg-se-hsub">' + sub + '</span></div>' +
      '</div>' +
      '<nav class="lg-se-steps">' + chips + '</nav>' +
    '</header>';
  }

  /* 共通フッター＝下部コマンドバー。左=戻る／中=任意の副操作／右=次へ。 */
  function _finNavHTML(backJs, nextJs, nextJa, nextEn, midHTML) {
    var back = backJs
      ? '<button type="button" class="lg-se-nb back" onclick="' + backJs + '">' + _t('← 戻る', '← Back') + '</button>'
      : '<span class="lg-se-nb ghost"></span>';
    var next = nextJs
      ? '<button type="button" class="lg-se-nb next" onclick="' + nextJs + '">' + _t(nextJa, nextEn) + '</button>'
      : '<span class="lg-se-nb ghost"></span>';
    return '<div class="lg-se-nav">' + back + (midHTML || '<span class="lg-se-nb-mid"></span>') + next + '</div>';
  }

  /* ページ枠を組んで描く（全ページ共通の出口＝描画後処理を1か所に閉じる）。 */
  function _finPaint(kind, idx, won, sacked, bodyHTML, navHTML) {
    _finPaint2((won ? ' won' : '') + (sacked ? ' sacked' : ''),
      _finHeadHTML(kind, idx, won), bodyHTML, navHTML);
  }

  /* 同じ固定フレームを、独自ヘッダーのページ（BD-01 面談など）からも使うための下地。 */
  function _finPaint2(extraCls, headHTML, bodyHTML, navHTML) {
    _body().innerHTML = '<div class="lg-se lg-se-paged ' + (extraCls || '') + '">' +
      headHTML +
      '<div class="lg-se-page">' + bodyHTML + '</div>' +
      navHTML +
    '</div>';
    _hubMode(false);
    _seasonEndMode(true);
    _afterRender();
  }

  /* ── ①リーグ戦順位 ───────────────────────────────────────────── */
  function _finPageTable(ctx) {
    return '<section class="lg-se-zone lg-se-wide">' +
      '<div class="lg-se-ztitle">' + _t('リーグ戦 最終順位', 'Final standings') + '</div>' +
      '<div class="lg-se-tablewrap">' + _standingsTableHTML(ctx.rows, ctx.myId) + '</div>' +
    '</section>';
  }

  /* ── ②個人表彰（リーグ全体）─────────────────────────────────────
   * 各表彰カードはタップで「上位10名」のランキングページへ（戻るで表彰面に返る）。 */
  function _finPageHonours() {
    var a = _leagueAwards();
    function card(kind, p, note) {
      var d = AWARD_DEFS[kind];
      if (!p) {
        return '<div class="lg-se-award empty"><span class="lg-se-aw-ico">' + d.ico + '</span>' +
          '<span class="lg-se-aw-t">' + _t(d.ja, d.en) + '</span>' +
          '<span class="lg-se-aw-n">' + _t('該当なし', 'Not awarded') + '</span></div>';
      }
      var def = _clubDef(p.clubId);
      return '<button type="button" class="lg-se-award" onclick="leagueFinRank(\'' + kind + '\')">' +
        '<span class="lg-se-aw-ico">' + d.ico + '</span>' +
        '<span class="lg-se-aw-t">' + _t(d.ja, d.en) + '</span>' +
        '<span class="lg-se-aw-n">' + p.name + '</span>' +
        '<span class="lg-se-aw-c">' + (def ? def.crest + ' ' + _clubName(p.clubId) : '') + '</span>' +
        '<span class="lg-se-aw-v">' + d.fmt(p) + '</span>' +
        (note ? '<span class="lg-se-aw-s">' + note + '</span>' : '') +
        '<span class="lg-se-aw-more">' + _t('上位10名', 'Top 10') + ' ›</span>' +
      '</button>';
    }
    var cards =
      card('scorer', a.scorer) +
      card('assister', a.assister) +
      card('mvp', a.mvp) +
      card('rookie', a.rookie, a.rookie ? _t(a.rookie.age + '歳', 'age ' + a.rookie.age) : _t('23歳以下', 'U23'));
    return '<section class="lg-se-zone lg-se-wide">' +
      '<div class="lg-se-ztitle">' + _t('個人表彰', 'Individual honours') +
        '<span class="lg-badge">' + _t('リーグ協会 発表', 'OFFICIAL') + '</span></div>' +
      '<div class="lg-se-awardgrid">' + cards + '</div>' +
    '</section>';
  }

  /* ②-詳細: 表彰の上位10名。表彰カードから開き、戻るで表彰面へ返る。 */
  function _finPageRanking(kind) {
    var d = AWARD_DEFS[kind]; if (!d) return '';
    var rows = _awardRanking(kind, 10);
    var body = rows.map(function (p, i) {
      var def = _clubDef(p.clubId);
      return '<div class="lg-rk-row' + (p.clubId === _state.myClub ? ' me' : '') + (i === 0 ? ' top' : '') + '">' +
        '<span class="lg-rk-no">' + (i + 1) + '</span>' +
        '<canvas class="lg-rk-face" width="72" height="72" data-portrait="' + p.name + '" data-team="' + p.clubId + '"></canvas>' +
        '<span class="lg-rk-nm">' + p.name + '</span>' +
        '<span class="lg-rk-cl">' + ((def && def.crest) || '') + ' ' + _clubName(p.clubId) + '</span>' +
        '<span class="lg-rk-v">' + d.fmt(p) + '</span>' +
      '</div>';
    }).join('');
    return '<section class="lg-se-zone lg-se-wide">' +
      '<div class="lg-se-ztitle">' + d.ico + ' ' + _t(d.ja, d.en) +
        '<span class="lg-badge">' + _t('上位10名', 'Top 10') + '</span></div>' +
      (rows.length ? '<div class="lg-rk-list">' + body + '</div>'
                   : '<div class="lg-se-empty">' + _t('該当者がいません', 'No qualifiers') + '</div>') +
    '</section>';
  }

  /* ── ③ベストイレブン ─────────────────────────────────────────── */
  function _finPageBestXI() {
    var pitch = _bestXIHTML(_seasonBestXI(), 'season',
      'シーズンベストイレブン', 'Team of the Season', 'リーグ協会 公式発表', 'OFFICIAL');
    return '<section class="lg-se-zone lg-se-wide lg-se-team">' +
      '<div class="lg-se-ztitle">' + _t('ベストイレブン', 'Team of the Season') + '</div>' +
      '<div class="lg-se-pitch big">' +
        (pitch || '<div class="lg-se-empty">' + _t('選出データなし', 'No data') + '</div>') + '</div>' +
    '</section>';
  }

  /* ── ④自チーム成績（戦績と順位／チーム内得点王・アシスト王／選手別出場数）───── */
  function _finPageMine(ctx) {
    var rec = ctx.fin.myRecord || { w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
    var gd = rec.gf - rec.ga;
    function kv(k, v) { return '<div class="lg-se-kv"><span>' + k + '</span><b>' + v + '</b></div>'; }
    var recBox = '<div class="lg-se-recgrid c6">' +
      kv(_t('最終順位', 'Position'), ctx.fin.myPos + _t('位', '')) +
      kv(_t('勝分敗', 'W-D-L'), rec.w + '-' + rec.d + '-' + rec.l) +
      kv(_t('勝点', 'Points'), rec.pts) +
      kv(_t('得点', 'For'), rec.gf) +
      kv(_t('失点', 'Against'), rec.ga) +
      kv(_t('得失点', 'GD'), (gd > 0 ? '+' : '') + gd) +
    '</div>';

    var top = ctx.fin.top || {};
    function inner(ico, ja, en, o, unitJa, unitEn) {
      if (!o) return '';
      return '<div class="lg-se-inner"><span>' + ico + ' ' + _t(ja, en) + '</span>' +
        '<b>' + o.name + '</b><i>' + o.n + _t(unitJa, unitEn) + '</i></div>';
    }
    var innerBox = (top.scorer || top.assister)
      ? '<div class="lg-se-innerrow">' +
          inner('👑', 'チーム内得点王', 'Club top scorer', top.scorer, '点', ' G') +
          inner('🎯', 'チーム内アシスト王', 'Club top assists', top.assister, '回', ' A') +
        '</div>'
      : '';

    var log = _myPlayerLog();
    var rows = log.map(function (p) {
      return '<tr><td class="nm">' + p.name + '</td>' +
        '<td>' + (p.age || '—') + '</td>' +
        '<td>' + p.apps + '</td>' +
        '<td>' + (p.minutes ? p.minutes + "'" : '—') + '</td>' +
        '<td>' + (p.goals || '') + '</td>' +
        '<td>' + (p.assists || '') + '</td></tr>';
    }).join('');
    var table = log.length
      ? '<table class="lg-se-plog"><thead><tr>' +
          '<th class="nm">' + _t('選手', 'Player') + '</th>' +
          '<th>' + _t('齢', 'Age') + '</th>' +          // SN-08a: 加齢が見えるように
          '<th>' + _t('出場', 'Apps') + '</th>' +
          '<th>' + _t('時間', 'Mins') + '</th>' +
          '<th>' + _t('得点', 'G') + '</th>' +
          '<th>' + _t('アシスト', 'A') + '</th></tr></thead><tbody>' + rows + '</tbody></table>'
      : '<div class="lg-se-empty">' + _t('出場記録なし', 'No appearances') + '</div>';

    return '<section class="lg-se-zone lg-se-wide">' +
      '<div class="lg-se-ztitle">' + ctx.myDef.crest + ' ' + _clubName(ctx.myId) +
        '<span class="lg-badge">' + _t('自チーム成績', 'Club record') + '</span></div>' +
      recBox + innerBox +
      '<div class="lg-se-ztitle sub">' + _t('選手別 出場記録', 'Appearances') + '</div>' +
      '<div class="lg-se-plogwrap">' + table + '</div>' +
    '</section>';
  }

  /* ── ⑤クラブ評価（会長コメント／クラブの信頼／残留 or 解任）──────────────── */
  function _finPageVerdict(ctx) {
    var br = ctx.br;
    var notice = br && br.sacked
      ? '<div class="lg-se-notice ng"><span class="lg-se-notice-ico">📋</span>' +
          '<div><span class="lg-se-notice-t">' + _t('解任', 'Sacked') + '</span>' +
          '<p class="lg-se-notice-b">' + _t('目標未達と信頼の低下を受け、クラブはあなたとの契約を打ち切った。だが挑戦はここで終わらない。',
            'The club has terminated your contract — but your story does not end here.') + '</p></div></div>'
      : '<div class="lg-se-notice ok"><span class="lg-se-notice-ico">🤝</span>' +
          '<div><span class="lg-se-notice-t">' + _t('契約継続', 'Contract renewed') + '</span>' +
          '<p class="lg-se-notice-b">' + _t('クラブはあなたの続投を望んでいる。来季の去就は、シーズン前に決めればいい。',
            'The club wants you to stay. You can settle your future in pre-season.') + '</p></div></div>';
    var chair = '<div class="lg-se-chair">' +
      '<span class="lg-se-chair-av">🧑‍💼</span>' +
      '<div class="lg-se-chair-tx"><span class="lg-se-chair-lbl">' + _t('会長コメント', 'Chairman') + '</span>' +
        '<p class="lg-se-chair-body">' + _seasonReviewText(ctx.fin) + '</p></div></div>';
    return '<div class="lg-se-vdrow">' +
      '<section class="lg-se-zone lg-se-sum">' +
        '<div class="lg-se-ztitle">' + _t('シーズン総括', 'Season review') + '</div>' +
        notice + chair +
      '</section>' +
      _finaleVerdictZone(ctx.sv) +
    '</div>';
  }

  /* ── シーズン前①：オファークラブリスト（残留カード＋他クラブの誘い）────────── */
  function _prePageOffers(br) {
    var cards = [];
    if (br.canRenew) {
      var myId = _state.myClub, myDef = _clubDef(myId);
      cards.push('<button type="button" class="lg-pre-club stay" onclick="leaguePreSelect(\'' + myId + '\',1)">' +
        '<span class="lg-pre-crest">' + myDef.crest + '</span>' +
        '<span class="lg-pre-body"><span class="lg-pre-name">' + _clubName(myId) +
          '<em>' + _t('残留', 'Stay') + '</em></span>' +
          '<span class="lg-pre-meta">' + _t('チーム力', 'Strength') + ' <b>' + _clubStrength(myId) + '</b>' +
            ' · ' + _t('年俸', 'Wage') + ' <b>' + _salaryText(_offerSalary(myId, true)) + '</b></span></span>' +
        '<span class="lg-pre-go">▶</span></button>');
    }
    (br.offers || []).forEach(function (o) {
      var def = _clubDef(o.clubId);
      cards.push('<button type="button" class="lg-pre-club" onclick="leaguePreSelect(\'' + o.clubId + '\',0)">' +
        '<span class="lg-pre-crest">' + def.crest + '</span>' +
        '<span class="lg-pre-body"><span class="lg-pre-name">' + _clubName(o.clubId) + '</span>' +
          '<span class="lg-pre-meta">' + _t('チーム力', 'Strength') + ' <b>' + o.strength + '</b>' +
            ' · ' + _t('年俸', 'Wage') + ' <b>' + _salaryText(o.salary) + '</b></span></span>' +
        '<span class="lg-pre-go">▶</span></button>');
    });
    var body = cards.length
      ? '<div class="lg-pre-list">' + cards.join('') + '</div>'
      : '<div class="lg-se-empty">' + _t('どのクラブからも声がかからなかった。', 'No club came calling.') + '</div>';
    return '<section class="lg-se-zone lg-se-wide">' +
      '<div class="lg-se-ztitle">' + _t('オファークラブ', 'Clubs on the table') +
        '<span class="lg-badge">' + cards.length + '</span></div>' + body +
    '</section>';
  }

  /* ── シーズン前②：オファークラブ詳細（概要／昨季成績／今季の目標／年俸）──────── */
  function _prePageDetail() {
    var t = _preTarget; if (!t) return '';
    var id = t.clubId, def = _clubDef(id);
    var st = (_state.standings && _state.standings[id]) || _emptyStanding();
    var pos = _position(id);
    var gd = st.gf - st.ga;
    function kv(k, v) { return '<div class="lg-se-kv"><span>' + k + '</span><b>' + v + '</b></div>'; }
    return '<section class="lg-se-zone lg-se-wide">' +
      '<div class="lg-se-ztitle">' + def.crest + ' ' + _clubName(id) +
        (t.incumbent ? '<span class="lg-badge">' + _t('現クラブ', 'Current club') + '</span>' : '') + '</div>' +
      '<div class="lg-se-ztitle sub">' + _t('クラブ概要', 'Club profile') + '</div>' +
      '<div class="lg-se-recgrid c2">' +
        kv(_t('チーム力', 'Strength'), _clubStrength(id)) +
        kv(_t('戦力順位', 'Squad rank'), _strengthRank(id) + _t('位', '')) +
      '</div>' +
      '<div class="lg-se-ztitle sub">' + _t('昨シーズン成績', 'Last season') + '</div>' +
      '<div class="lg-se-recgrid c4">' +
        kv(_t('最終順位', 'Position'), pos + _t('位', '')) +
        kv(_t('勝分敗', 'W-D-L'), st.w + '-' + st.d + '-' + st.l) +
        kv(_t('勝点', 'Points'), st.pts) +
        kv(_t('得失点', 'GD'), (gd > 0 ? '+' : '') + gd) +
      '</div>' +
      '<div class="lg-pre-terms">' +
        '<div class="lg-pre-term"><span>' + _t('今季の目標', 'Season target') + '</span><b>' + _goalTextFor(id) + '</b></div>' +
        '<div class="lg-pre-term wage"><span>' + _t('オファー年俸', 'Wage offered') + '</span><b>' + _salaryText(t.salary) + '</b></div>' +
      '</div>' +
    '</section>';
  }

  /* ── シーズン前③：クラブ決定（最終確認）───────────────────────────── */
  function _prePageDecide() {
    var t = _preTarget; if (!t) return '';
    var def = _clubDef(t.clubId);
    return '<section class="lg-se-zone lg-se-wide lg-pre-decide">' +
      '<div class="lg-pre-bigcrest">' + def.crest + '</div>' +
      '<div class="lg-pre-bigname">' + _clubName(t.clubId) + '</div>' +
      '<p class="lg-pre-lead">' + (t.incumbent
        ? _t('このクラブで、もう1シーズン戦う。', 'One more season with this club.')
        : _t('新天地で、もう一度ゼロから積み上げる。', 'A new club — and a new start.')) + '</p>' +
      '<div class="lg-pre-terms">' +
        '<div class="lg-pre-term"><span>' + _t('今季の目標', 'Season target') + '</span><b>' + _goalTextFor(t.clubId) + '</b></div>' +
        '<div class="lg-pre-term wage"><span>' + _t('年俸', 'Wage') + '</span><b>' + _salaryText(t.salary) + '</b></div>' +
      '</div>' +
    '</section>';
  }

  /* ── シーズン前④：選手獲得・放出（スキップ可能・枠のみ）────────────────
   * ★ 移籍サブシステムは未実装（2026-07-26 ユーザー判断＝今回は遷移上の枠だけ確保）。
   *   ここで実際の獲得/放出を行えるようになるまでは「スキップ」で通過する。 */
  /* SN-08a: オフの間に選手がどう変わったかを1ブロックで見せる（伸びた／衰えた）。
   * ★ ここは「素材の提示」まで。カード演出・数字のカウントアップは MG-08/SN-03 側（演出担当）。 */
  // league.js には HTML エスケープが無く（名前は TEAM_DATA 由来＝信頼できる）そのまま埋めているが、
  // FN-01 で名前が生成物になるのでここだけは通しておく。lg-ui.js の _esc は別 IIFE で見えない。
  function _escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _agingBlockHTML() {
    var a = _state.seasonMeta && _state.seasonMeta.aging;
    if (!a || (!(a.grew || []).length && !(a.declined || []).length)) return '';
    function list(rows, cls, sign) {
      if (!rows || !rows.length) {
        return '<div class="lg-age-empty">' + _t('該当なし', 'None') + '</div>';
      }
      return rows.map(function (r) {
        return '<div class="lg-age-row ' + cls + '">' +
          '<span class="lg-age-nm">' + _escHtml(r.name) + '</span>' +
          '<span class="lg-age-yr">' + r.age + _t('歳', '') + '</span>' +
          '<span class="lg-age-ov">' + _t('総合', 'OVR') + ' ' + r.overall + '</span>' +
          '<span class="lg-age-d">' + sign + Math.abs(r.diff).toFixed(1) + '</span>' +
        '</div>';
      }).join('');
    }
    return '<div class="lg-age-wrap">' +
      '<div class="lg-age-col">' +
        '<div class="lg-age-h up"><span class="lg-age-ico">📈</span>' + _t('伸びた選手', 'Improved') + '</div>' +
        '<div class="lg-age-list">' + list(a.grew, 'up', '+') + '</div>' +
      '</div>' +
      '<div class="lg-age-col">' +
        '<div class="lg-age-h dn"><span class="lg-age-ico">📉</span>' + _t('衰えた選手', 'Declined') + '</div>' +
        '<div class="lg-age-list">' + list(a.declined, 'dn', '−') + '</div>' +
      '</div>' +
    '</div>';
  }

  function _prePageSquad() {
    var myId = _state.myClub, def = _clubDef(myId);
    var aging = _agingBlockHTML();
    // SN-08a を入れた時点でこのページのビートは「オフの間にスカッドがどう変わったか」。
    //   移籍（SN-06）はまだ空なので、その告知は下段の1行に落として主役を譲る（1画面1ビート）。
    return '<section class="lg-se-zone lg-se-wide lg-pre-squad' + (aging ? ' has-aging' : '') + '">' +
      '<div class="lg-se-ztitle">' + def.crest + ' ' + _clubName(myId) +
        '<span class="lg-badge">' + _t('オフの変化', 'Off-season') + '</span></div>' +
      aging +
      (aging
        ? '<div class="lg-pre-soonline">🔁 ' + _t('補強と放出はまだ準備中。今季はこのスカッドで戦う。',
            'The transfer market is not open yet — you go with this squad.') + '</div>'
        : '<div class="lg-pre-soon">' +
            '<span class="lg-pre-soon-ico">🔁</span>' +
            '<span class="lg-pre-soon-t">' + _t('選手獲得・放出', 'Transfers') + '</span>' +
            '<p class="lg-pre-soon-b">' + _t('補強と放出はまだ準備中。今季はこのスカッドで戦う。',
              'The transfer market is not open yet — you go with this squad.') + '</p>' +
          '</div>') +
    '</section>';
  }

  /* ── フローの入口（_renderHub から呼ばれる唯一の出口）──────────────────── */
  function _renderFinale() {
    _ensureStyle();
    if (_prePage >= 0) { _renderPreseason(); return; }

    var myId = _state.myClub, myDef = _clubDef(myId);
    var rows = _sortedStandings();
    var champ = rows[0], won = champ && champ.id === myId;
    var fin = _seasonSummary();
    var sv = (_state.lastResult && _state.lastResult.season) || fin.verdict;
    var br = _contractBranch();
    var ctx = { myId: myId, myDef: myDef, rows: rows, fin: fin, sv: sv, br: br, won: won };

    var idx = Math.max(0, Math.min(FIN_PAGES.length - 1, _finPage));
    var body, nav;
    var back = idx > 0 ? 'leagueFinPage(' + (idx - 1) + ')' : null;

    if (idx === 0)      { body = _finPageTable(ctx);   nav = _finNavHTML(back, 'leagueFinPage(1)', '次へ：個人表彰', 'Next: Honours'); }
    else if (idx === 1) {
      if (_finRank) {
        // 表彰カードから開いた上位10名。戻る＝表彰面へ（節の順送りは進めない）。
        body = _finPageRanking(_finRank);
        // 出口は1つだけ（左右に同じ「戻る」を並べない）。
        nav = _finNavHTML(null, 'leagueFinRank(0)', '← 個人表彰へ戻る', '← Back to honours');
      } else {
        body = _finPageHonours();
        nav = _finNavHTML(back, 'leagueFinPage(2)', '次へ：ベストイレブン', 'Next: Team of the Season');
      }
    }
    else if (idx === 2) { body = _finPageBestXI();     nav = _finNavHTML(back, 'leagueFinPage(3)', '次へ：自チーム成績', 'Next: Club record'); }
    else if (idx === 3) { body = _finPageMine(ctx);    nav = _finNavHTML(back, 'leagueFinPage(4)', '次へ：クラブ評価', 'Next: Club verdict'); }
    else {
      body = _finPageVerdict(ctx);
      var leave = '<button type="button" class="lg-se-nb mid" onclick="leagueSeasonLeave()">' +
        (br && br.sacked ? _t('退任してタイトルへ', 'Leave to title') : _t('退任する', 'Step down')) + '</button>';
      nav = _finNavHTML(back, 'leaguePreEnter()', '次へ：シーズン前', 'Next: Pre-season', leave);
    }
    _finPaint('fin', idx, won, br && br.sacked, body, nav);
  }

  /* シーズン前フロー（2年目以降）。①〜③は旧シーズンの状態を読むので必ず遷移の確定より前に描く。 */
  function _renderPreseason() {
    _ensureStyle();
    var idx = Math.max(0, Math.min(PRE_PAGES.length - 1, _prePage));
    var br = _state.finished ? _contractBranch() : null;
    var body, nav;

    if (idx === 0) {
      body = _prePageOffers(br || { canRenew: false, offers: [] });
      var leave = '<button type="button" class="lg-se-nb mid" onclick="leagueSeasonLeave()">' +
        _t('退任する', 'Step down') + '</button>';
      nav = _finNavHTML('leagueFinPage(4)', null, '', '', leave);
    } else if (idx === 1) {
      body = _prePageDetail();
      nav = _finNavHTML('leaguePrePage(0)', 'leaguePrePage(2)', 'このクラブに決める', 'Choose this club');
    } else if (idx === 2) {
      body = _prePageDecide();
      nav = _finNavHTML('leaguePrePage(1)', 'leaguePreCommit()', '決定して次へ', 'Confirm');
    } else {
      // 移籍サブシステムが入るまでは操作が無いので「スキップ＝開始」。導線は1本に絞る。
      body = _prePageSquad();
      nav = _finNavHTML(null, 'leaguePreFinish()', 'スキップしてシーズン開始', 'Skip — start the season');
    }
    _finPaint('pre', idx, false, br && br.sacked, body, nav);
  }

  /* ══ MD-03 シーズン中の画面構成（2026-07-26・スライド「シーズン中」準拠）══════════
   * ①ホーム画面（順位／次の試合／監督ステータス／次へボタン）が常に起点。
   *   ├ 「順位」を開く      → ②順位（見たら戻る）
   *   ├ 「次の試合」を開く  → ②次の試合（見たら戻る）
   *   └ 「次へ」を押す      → ②練習メニュー → ③試合へ  ← 試合に進むのはこの1本だけ
   * ★ 順位/次の試合は寄り道＝本線に割り込ませない（2026-07-26 ユーザー指摘で修正）。
   * 深掘りページの枠は最終話と同じ固定フレームを流用する。 */
  var MATCH_LINE = [
    { id: 'prep',  ja: '練習メニュー', en: 'Training' },
    { id: 'match', ja: '試合へ',       en: 'Matchday' }
  ];
  var SIDE_VIEWS = {
    table: { ja: '順位',     en: 'Table' },
    next:  { ja: '次の試合', en: 'Next match' },
    sns:   { ja: '世間の反応', en: 'The reaction' }   // RW-01
  };
  var _roundView = null;   // null = ホーム画面／'table'|'next'|'prep'|'match'

  /* 深掘りページのヘッダー。本線（練習→試合）は2ステップのパンくず、
   * 寄り道（順位／次の試合）は単票のラベルだけ＝本線の進み具合と混同させない。 */
  function _roundHeadHTML(view, oppId) {
    var chips;
    if (view === 'prep' || view === 'match') {
      chips = MATCH_LINE.map(function (p, i) {
        var cls = (p.id === view) ? ' on' : (view === 'match' && i === 0 ? ' done' : '');
        return '<span class="lg-se-step' + cls + '"><i>' + (i + 1) + '</i>' + _t(p.ja, p.en) + '</span>';
      }).join('<span class="lg-se-arrow">›</span>');
    } else {
      var v = SIDE_VIEWS[view] || { ja: '', en: '' };
      chips = '<span class="lg-se-step on"><i>◆</i>' + _t(v.ja, v.en) + '</span>';
    }
    var rounds = (_state.fixtures && _state.fixtures.length) || 14;
    var sub = _t('第' + (_state.round + 1) + '節 / ' + rounds, 'Round ' + (_state.round + 1) + ' / ' + rounds) +
      (oppId ? ' · vs ' + _clubName(oppId) : '');
    return '<header class="lg-se-top">' +
      '<div class="lg-se-brand">' +
        '<span class="lg-se-emblem">' + _clubDef(_state.myClub).crest + '</span>' +
        '<div class="lg-se-brandtx"><h1 class="lg-se-h1">' + _clubName(_state.myClub) + '</h1>' +
        '<span class="lg-se-hsub">' + sub + '</span></div>' +
      '</div>' +
      '<nav class="lg-se-steps">' + chips + '</nav>' +
    '</header>';
  }

  /* ポジション表記。英語表示では左右の漢字が読めないので既存の略称表（POS_ABBR）に寄せる。 */
  function _posLabel(pos) {
    if (!pos) return '';
    if (!_isEn()) return pos;
    return (typeof POS_ABBR !== 'undefined' && POS_ABBR[pos]) ? POS_ABBR[pos] : pos.replace(/[左右]/g, '');
  }

  /* ②次の試合：対戦チーム概要 ── 順位/勝点/戦力/直近の調子。 */
  function _oppProfileHTML(oppId) {
    var st = _state.standings[oppId] || _emptyStanding();
    var gd = st.gf - st.ga;
    function kv(k, v) { return '<div class="lg-se-kv"><span>' + k + '</span><b>' + v + '</b></div>'; }
    return '<div class="lg-se-ztitle sub">' + _t('対戦チーム概要', 'Opponent profile') + '</div>' +
      '<div class="lg-se-recgrid c6">' +
        kv(_t('順位', 'Pos'), _position(oppId) + _t('位', '')) +
        kv(_t('勝点', 'Pts'), st.pts) +
        kv(_t('勝分敗', 'W-D-L'), st.w + '-' + st.d + '-' + st.l) +
        kv(_t('得点', 'For'), st.gf) +
        kv(_t('失点', 'Against'), st.ga) +
        kv(_t('チーム力', 'Strength'), _clubStrength(oppId)) +
      '</div>';
  }

  /* ②次の試合：予想スタメン ── 実際に相手が組む XI（離脱者を外した後の布陣）をそのまま出す。
   * ★ 別の推定式を作らない＝キックオフで対峙する11人と必ず一致する。 */
  function _oppLineupHTML(oppId) {
    var td = _overlaySquad(oppId);
    if (!td || !td.players || !td.default_lineup) return '';
    var sysName = td.default_system || '';
    // system_data は配列＝name で引く（_overlaySquad の補充ロジックと同じ引き方に揃える）。
    var posNames = null;
    if (typeof system_data !== 'undefined') {
      for (var si = 0; si < system_data.length; si++) {
        if (system_data[si].name === sysName) { posNames = system_data[si].positions; break; }
      }
    }
    var cells = td.default_lineup.slice(0, 11).map(function (idx, i) {
      var p = td.players[idx];
      if (!p) return '';
      var pos = _posLabel((posNames && posNames[i]) ? posNames[i] : (i === 0 ? 'GK' : ''));
      return '<div class="lg-xi-cell">' +
        '<span class="lg-xi-pos">' + pos + '</span>' +
        '<span class="lg-xi-nm">' + (_isEn() ? (p.en_name || p.name) : p.name) + '</span></div>';
    }).join('');
    return '<div class="lg-se-ztitle sub">' + _t('予想スタメン', 'Predicted XI') +
        (sysName ? '<span class="lg-badge">' + sysName + '</span>' : '') + '</div>' +
      '<div class="lg-xi-grid">' + cells + '</div>';
  }

  /* ②次の試合：分析スタッフのコメント ── 攻め筋・順位差・直近の流れという確定データを一文にまとめる。
   * ★ 数値を作らない＝すべて既存の集計の言い換え。 */
  function _analystCommentHTML(oppId) {
    var lines = [];
    var ranked = _opponentThreatsRanked(oppId);
    if (ranked && ranked.length) {
      lines.push(_t('警戒すべきは' + _threatLabel(ranked[0].id) + '。ここを断てば形が崩れます。',
        'Their main route is ' + _threatLabel(ranked[0].id) + ' — shut it down and they lose shape.'));
    }
    var myPos = _position(_state.myClub), oppPos = _position(oppId);
    if (oppPos < myPos) {
      lines.push(_t('順位は向こうが上（' + oppPos + '位 vs ' + myPos + '位）。真正面からの殴り合いは分が悪い。',
        'They sit above us (' + oppPos + ' vs ' + myPos + ') — a straight shootout favours them.'));
    } else if (oppPos > myPos) {
      lines.push(_t('順位は我々が上（' + myPos + '位 vs ' + oppPos + '位）。取りこぼしだけは避けたい。',
        'We sit above them (' + myPos + ' vs ' + oppPos + ') — the danger is dropping points.'));
    }
    var abs = _absentees(oppId);
    if (abs.length) {
      lines.push(_t('相手は' + abs.length + '名を欠く。空いた枠は必ず穴になります。',
        'They are without ' + abs.length + ' — the replacements are where the gaps will be.'));
    }
    if (_isRival(oppId)) {
      var h = _h2h(_state.myClub, oppId);
      lines.push(_t('宿敵戦です。通算' + h.w + '勝' + h.d + '分' + h.l + '敗。',
        'This is the derby — ' + h.w + '-' + h.d + '-' + h.l + ' all-time.'));
    }
    if (!lines.length) return '';
    // 日本語は句点で繋がるので詰める／英語は文の切れ目に空白が要る。
    var text = lines.join(_isEn() ? ' ' : '');
    return '<div class="lg-se-ztitle sub">' + _t('分析スタッフ', 'Analyst') + '</div>' +
      '<div class="lg-analyst"><span class="lg-analyst-av">🧑‍💻</span>' +
        '<p class="lg-analyst-b">' + text + '</p></div>';
  }

  function _renderRoundView() {
    _ensureStyle();
    var myId = _state.myClub;
    var fx = _myFixtureThisRound();
    var oppId = fx ? ((fx.home === myId) ? fx.away : fx.home) : null;
    var view = _roundView;
    var body, nav;
    var home = 'leagueRoundHome()';

    if (view === 'table') {
      // 寄り道①：順位。ここから試合へは進めない＝見たらホームへ戻る。
      body = '<section class="lg-se-zone lg-se-wide">' +
        '<div class="lg-se-ztitle">' + _t('リーグ戦 順位', 'League table') + '</div>' +
        '<div class="lg-se-tablewrap">' + _standingsTableHTML(_sortedStandings(), myId) + '</div>' +
      '</section>';
      nav = _finNavHTML(home, home, 'ホームへ戻る', 'Back to home');
    } else if (view === 'sns') {
      // 寄り道③：世間の反応（RW-01）。読み物なので寄り道扱い＝ここから試合へは進めない。
      body = '<section class="lg-se-zone lg-se-wide lg-rd-scroll">' +
        '<div class="lg-se-ztitle">🗣 ' + _t('世間の反応', 'The reaction') +
          '<span class="lg-badge">' + _t('第' + (_state.round || 0) + '節', 'Round ' + (_state.round || 0)) + '</span></div>' +
        _snsFeedHTML() +
      '</section>';
      nav = _finNavHTML(home, home, 'ホームへ戻る', 'Back to home');
    } else if (view === 'next') {
      // 寄り道②：次の試合（対戦チーム概要／予想スタメン／分析スタッフコメント）。
      body = '<section class="lg-se-zone lg-se-wide lg-rd-scroll">' +
        '<div class="lg-se-ztitle">' + (oppId ? _clubDef(oppId).crest + ' ' + _clubName(oppId) : _t('次の試合', 'Next match')) + '</div>' +
        (oppId ? _oppProfileHTML(oppId) + _oppLineupHTML(oppId) + _analystCommentHTML(oppId) : '') +
      '</section>';
      nav = _finNavHTML(home, home, 'ホームへ戻る', 'Back to home');
    } else if (view === 'prep') {
      // 本線①：練習メニュー。★ 偵察レポートはここ＝週末の相手がどこで強いかを知る情報。
      // ★ 縦積みだと横持ちスマホで偵察レポートだけで1画面を使い切り、肝心の週3コマが
      //   画面外に落ちていた（可視48%）。横持ちは幅が余るので【左=偵察 / 右=3コマ】に割る。
      //   1カラムに戻す条件は CSS 側（.lg-rd-prepgrid の @media）に持たせ、DOMは常に同じ。
      body = '<section class="lg-se-zone lg-se-wide lg-rd-scroll">' +
        '<div class="lg-se-ztitle">' + _t('今週の練習メニュー', "This week's training") + '</div>' +
        '<div class="lg-rd-prepgrid">' +
          '<div class="lg-rd-prepcol">' + (oppId ? _scoutHTML(oppId) : '') + '</div>' +
          '<div class="lg-rd-prepcol">' + _actionPhaseHTML() + _physicalCoachHTML(myId) + '</div>' +
        '</div>' +
      '</section>';
      nav = _finNavHTML(home, 'leagueRoundView(\'match\')', '次へ：試合へ', 'Next: Matchday');
    } else {
      // 本線②：試合へ。
      body = _roundPageMatch(myId, oppId, fx);
      nav = _lockedToday()
        ? _finNavHTML('leagueRoundView(\'prep\')', null, '', '')
        : _finNavHTML('leagueRoundView(\'prep\')', 'leaguePlayToday()', '▶ キックオフ', '▶ Kick off');
    }

    _body().innerHTML = '<div class="lg-se lg-se-paged lg-rd">' +
      _roundHeadHTML(view, oppId) +
      '<div class="lg-se-page">' + body + '</div>' + nav +
    '</div>';
    _hubMode(false);
    _seasonEndMode(true);
    _afterRender();
  }

  /* ③試合へ ── 最後の確認面。ここまでの選択（布陣は設定画面）を確定してキックオフする。 */
  function _roundPageMatch(myId, oppId, fx) {
    if (!oppId) return '<div class="lg-se-empty">' + _t('今節の対戦がありません', 'No fixture this round') + '</div>';
    var myDef = _clubDef(myId), oppDef = _clubDef(oppId);
    var iAmHome = (fx.home === myId);
    var pa = _pendingWeek();
    var chosen = (pa && pa.slots) ? pa.slots.filter(Boolean).length : 0;
    var warn = (chosen < WEEK_SLOTS)
      ? '<div class="lg-rd-warn">⚠ ' + _t('今週の練習が' + (WEEK_SLOTS - chosen) + 'コマ空いています',
          (WEEK_SLOTS - chosen) + ' training slot(s) still empty') + '</div>' : '';
    // MTG1-#3: レール有効時はネガ文言を終幕トーン（ストリークをねぎらう言い方）へ差し替える
    var lockTx = (typeof Rail !== 'undefined' && Rail.lockText && Rail.lockText())
      || _t('本日は消化済み — また明日', 'Played today — come back tomorrow');
    var lock = _lockedToday() ? '<div class="lg-rd-warn">' + lockTx + '</div>' : '';
    return '<section class="lg-se-zone lg-se-wide lg-rd-kick">' +
      '<div class="lg-rd-vs">' +
        '<div class="lg-rd-side"><span class="lg-rd-crest">' + myDef.crest + '</span>' +
          '<span class="lg-rd-nm">' + _clubName(myId) + '</span>' +
          '<span class="lg-rd-ha">' + (iAmHome ? _t('ホーム', 'HOME') : _t('アウェイ', 'AWAY')) + '</span></div>' +
        '<span class="lg-rd-mid">VS</span>' +
        '<div class="lg-rd-side"><span class="lg-rd-crest">' + oppDef.crest + '</span>' +
          '<span class="lg-rd-nm">' + _clubName(oppId) + '</span>' +
          '<span class="lg-rd-ha">' + _position(oppId) + _t('位', '') + '</span></div>' +
      '</div>' +
      '<div class="lg-pre-terms">' +
        '<div class="lg-pre-term"><span>' + _t('クラブの要求', 'Club target') + '</span><b>' + _seasonGoalText() + '</b></div>' +
        '<div class="lg-pre-term wage"><span>' + _t('今週の準備', 'Prep done') + '</span><b>' + chosen + ' / ' + WEEK_SLOTS + '</b></div>' +
      '</div>' + warn + lock +
    '</section>';
  }

  /* ══ SH-01 シーズンハブ（2026-07-26・ユーザー提供モック準拠）════════════════════
   * 上段＝1本のステータスバー（クラブ／Day・節／戦績／信頼／人気／設定）
   * 下段＝横3パネル（現在順位／次の試合／監督ステータス）＋右下に大きなコマンドボタン
   * ★ 画像枠（クラブ徽章・監督の顔）は「空スロット」として寸法だけ確保する。
   *   絵が入るまでは既存のフラグ絵文字とブランク枠で埋める（2026-07-26 ユーザー了承）。
   * ★ 順位パネルと試合パネルはタップで寄り道（②順位／②次の試合）へ。
   *   試合へ進む本線は右下のコマンドボタン1本だけ＝MD-03 の導線を崩さない。 */

  function _shTopHTML(myId, myRow) {
    var d = _clubDef(myId), m = _state.manager || {};
    var trust = Math.round((typeof m.clubTrust === 'number') ? m.clubTrust : 0);
    var pop = (m.params) ? Math.round(m.params.popularity) : 0;
    var day = (_state.round || 0) + 1;
    // MTG1-#5 数値の言葉化: 読ませるのは「72」でなく「英雄扱い」。数字は消さず小さく併記する。
    function meter(ico, ja, en, v, cls, kind) {
      var w = (typeof oshiWordOf === 'function') ? oshiWordOf(kind, v) : null;
      return '<span class="lg-sh-meter ' + cls + (w ? ' worded tone-' + w.tone : '') + '">' +
        '<span class="lg-sh-meter-k">' + ico + ' ' + _t(ja, en) + '</span>' +
        '<b class="lg-sh-meter-v">' + (w ? w.text + '<em>' + v + '</em>' : v) + '</b>' +
        '<i class="lg-sh-meter-bar"><s class="lg-stat-fill" data-pct="' + Math.max(0, Math.min(100, v)) + '"></s></i></span>';
    }
    return '<header class="lg-sh-top">' +
      '<div class="lg-sh-brand"><span class="lg-sh-brand-ico">★</span>' + _t('シーズンハブ', 'SEASON HUB') + '</div>' +
      '<div class="lg-sh-bar">' +
        '<span class="lg-sh-crest lg-sh-slot">' + d.crest + '</span>' +
        '<span class="lg-sh-club">' + _clubName(myId) + '</span>' +
        '<i class="lg-sh-div"></i>' +
        '<span class="lg-sh-day">Day ' + day + ' <em>/</em> ' + _t('第' + day + '節', 'R' + day) + '</span>' +
        '<i class="lg-sh-div"></i>' +
        '<span class="lg-sh-rec">' + myRow.w + _t('勝', 'W') + ' ' + myRow.d + _t('分', 'D') + ' ' + myRow.l + _t('敗', 'L') + '</span>' +
        '<i class="lg-sh-div"></i>' +
        meter('🤝', '信頼', 'Trust', trust, 'trust', 'trust') +
        meter('📣', '人気', 'Popularity', pop, 'pop', 'pop') +
        '<button type="button" class="lg-sh-gear" onclick="leagueHubMenu(1)" ' +
          'aria-label="' + _t('メニュー', 'Menu') + '">⚙</button>' +
      '</div>' +
    '</header>';
  }

  /* 左：現在順位（大きな順位＋勝点/得失＋自分の周りだけのミニ表＋順位ページへの導線）。 */
  function _shRankPanel(myId, rows, myPos, myRow) {
    var moves = _rankMoves();
    var gd = myRow.gf - myRow.ga;
    var idx = myPos - 1;
    var start = Math.max(0, Math.min(idx - 2, rows.length - 4));
    var view = rows.slice(start, start + 4);
    var body = view.map(function (r, i) {
      var def = _clubDef(r.id), mv = moves[r.id] || 0;
      var arrow = mv > 0 ? '<span class="mv up">▲</span>' : (mv < 0 ? '<span class="mv dn">▼</span>' : '<span class="mv fl">–</span>');
      var g = (r.gd > 0 ? '+' : '') + r.gd;
      return '<tr class="' + (r.id === myId ? 'me' : '') + '">' +
        '<td class="p">' + (start + i + 1) + arrow + '</td>' +
        '<td class="nm"><span class="lg-sh-slot sm">' + def.crest + '</span>' + _clubName(r.id) + '</td>' +
        '<td class="pt">' + r.pts + '</td>' +
        '<td class="gd">' + g + '</td></tr>';
    }).join('');
    return '<section class="lg-sh-panel lg-sh-rank">' +
      '<div class="lg-sh-ph">' + _t('現在順位', 'Standing') + '</div>' +
      '<div class="lg-sh-bigpos" role="button" tabindex="0" onclick="leagueRoundView(\'table\')">' +
        '<span class="k">' + _t('現在', 'Now') + '</span>' +
        '<b class="n">' + myPos + '</b><span class="u">' + _t('位', '') + '</span>' +
        '<span class="cup">🏆</span>' +
      '</div>' +
      '<div class="lg-sh-kv2">' +
        '<div><span>' + _t('勝点', 'Pts') + '</span><b>' + myRow.pts + '</b></div>' +
        '<div><span>' + _t('得失', 'GD') + '</span><b>' + (gd > 0 ? '+' : '') + gd + '</b></div>' +
      '</div>' +
      '<table class="lg-sh-mini"><thead><tr>' +
        '<th class="p">' + _t('順位', '#') + '</th><th class="nm">' + _t('チーム', 'Team') + '</th>' +
        '<th class="pt">' + _t('勝点', 'Pts') + '</th><th class="gd">' + _t('得失', 'GD') + '</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table>' +
      _snsTeaserHTML() +
      '<button type="button" class="lg-sh-more" onclick="leagueRoundView(\'table\')">' +
        '📊 ' + _t('リーグ順位を確認', 'Full league table') + ' <span>›</span></button>' +
    '</section>';
  }

  /* ===========================================================================
   * RW-01 — SNS風フィード（世界の反応）
   * ---------------------------------------------------------------------------
   * 文面の生成は js/sns.js（純関数・決定論・lab限定）。ここは **ctx を組むだけ**。
   * ★ sns.js 未搭載でも typeof ガードで完全 no-op（公開ビルドの挙動は不変）。
   * ★ VISION の「寝ている間に世界が動いている」フック＝ハブに見出し2件、
   *   全文は寄り道ページ（順位／次の試合と同じ扱い＝本線に割り込ませない）。
   * ========================================================================= */
  function _snsCtx() {
    if (typeof SNS === 'undefined' || !SNS || !_state) return null;
    var myId = _state.myClub;
    var rows = _sortedStandings();
    var lr = _state.lastResult;
    var mine = lr && lr.mine;
    var m = _state.manager || {};
    var streak = _currentStreak();
    var leader = rows[0] ? { id: rows[0].id, name: _clubName(rows[0].id) } : null;

    // 番狂わせ＝首位が他会場で負けた（自分が倒した場合は結果側で語られるので除く）
    var upset = false;
    if (leader && lr && lr.others) {
      upset = lr.others.some(function (o) {
        return (o.home === leader.id && o.hs < o.as) || (o.away === leader.id && o.as < o.hs);
      });
    }
    /* 記録された選手名（＝記録時の言語の表示名）を **いまの言語** の表示名へ直す。
     * ★ そのまま出すと英語表示のときに日本語名が混ざる（MOM 等）。記録名 → squads のキー
     *   （内部ID）→ 現在の表示名、と2段で引き直す（FN-00 の解決器に載せる）。 */
    function pName(recorded) {
      if (!recorded) return '';
      var key = _squadKeyByName(myId, recorded);
      return _keyDisplayName(key) || recorded;
    }
    // key（内部ID）も渡す＝**言語非依存のシード**。無いと日/英でテンプレ抽選が割れる。
    function pKey(recorded) { return recorded ? _squadKeyByName(myId, recorded) : ''; }
    var abs = _absentees(myId).map(function (a) { return { name: pName(a.name), key: pKey(a.name), kind: a.kind }; });

    return {
      lang: _isEn() ? 'en' : 'ja',
      season: _state.season || 1,
      round: _state.round || 0,
      totalRounds: (_state.fixtures && _state.fixtures.length) || 14,
      club: { id: myId, name: _clubName(myId) },
      opp: mine ? { id: mine.opp, name: _clubName(mine.opp) } : null,
      result: mine ? {
        res: mine.res, gf: mine.ms, ga: mine.os, rival: !!mine.rival,
        posBefore: mine.posBefore, posAfter: mine.posAfter
      } : null,
      mom: (mine && mine.mom)
        ? { name: pName(mine.mom.name), key: pKey(mine.mom.name), goals: mine.mom.goals, assists: mine.mom.assists }
        : null,
      scorers: (mine && mine.scorers) ? mine.scorers.map(function (s) {
        return { name: pName(s.name), key: pKey(s.name), goals: s.goals };
      }) : [],
      streak: (streak && streak.res !== 'D') ? { kind: streak.res, n: streak.n } : null,
      leader: leader,
      upset: upset,
      manager: {
        trust: Math.round(m.clubTrust || 0),
        popularity: Math.round((m.params && m.params.popularity) || 0),
        popularityUp: !!(lr && lr.manager && lr.manager.popularity && lr.manager.popularity.delta > 0)
      },
      absences: abs,
      goalText: _seasonGoalText()
    };
  }

  function _snsFeed() {
    var ctx = _snsCtx();
    if (!ctx) return [];
    try { return SNS.build(ctx) || []; } catch (e) { console.warn('[league] sns build failed', e); return []; }
  }

  function _snsTeaserHTML() {
    var feed = _snsFeed();
    if (!feed.length) return '';
    var n = (typeof SNS !== 'undefined' && SNS.TUNING) ? SNS.TUNING.TEASER : 2;
    var items = feed.slice(0, n).map(function (p) {
      return '<div class="lg-sns-t-row"><span class="ic">' + p.icon + '</span>' +
        '<span class="tx">' + _escHtml(p.text) + '</span></div>';
    }).join('');
    return '<div class="lg-sns-teaser" role="button" tabindex="0" onclick="leagueRoundView(\'sns\')">' +
      '<div class="lg-sns-t-head">🗣 ' + _t('世間の反応', 'The reaction') +
        '<span class="lg-sns-t-more">' + _t('もっと見る', 'More') + ' ›</span></div>' +
      items +
    '</div>';
  }

  function _snsFeedHTML() {
    var feed = _snsFeed();
    if (!feed.length) {
      return '<div class="lg-se-empty">' + _t('まだ何も起きていない。', 'Nothing has happened yet.') + '</div>';
    }
    return '<div class="lg-sns-list">' + feed.map(function (p) {
      return '<article class="lg-sns-post tone' + p.tone + '">' +
        '<div class="lg-sns-av">' + p.icon + '</div>' +
        '<div class="lg-sns-body">' +
          '<div class="lg-sns-meta"><b>' + _escHtml(p.name) + '</b>' +
            '<span class="hd">' + _escHtml(p.handle) + '</span></div>' +
          '<div class="lg-sns-text">' + _escHtml(p.text) + '</div>' +
          '<div class="lg-sns-foot">♡ ' + p.likes.toLocaleString() + '</div>' +
        '</div>' +
      '</article>';
    }).join('') + '</div>';
  }

  /* 中央：次の試合（NEXT MATCH ＋ 対戦相手スカウティング）。
   * ★ 開幕のボード面談はここには出さない＝ハブの手前の専用ページ（_renderBoardTalk）。 */
  function _shMatchPanel(myId) {
    var fx = _myFixtureThisRound();
    if (!fx) {
      return '<section class="lg-sh-panel lg-sh-match">' +
        '<div class="lg-sh-ph">' + _t('次の試合', 'Next match') + '</div>' +
        '<div class="lg-se-empty">' + _t('今節の対戦がありません', 'No fixture this round') + '</div></section>';
    }
    var oppId = (fx.home === myId) ? fx.away : fx.home;
    var iAmHome = (fx.home === myId);
    var myDef = _clubDef(myId), oppDef = _clubDef(oppId);
    var ad = _clubAtkDef(oppId), form = _clubForm(oppId), key = _keyPlayer(oppId);
    var dirIco = form.dir === 'up' ? '⬆' : (form.dir === 'down' ? '⬇' : '➡');

    // sub＝値の上に置く小さな添え字（ポジション等）。値と同じ行に混ぜると折り返して読めなくなる。
    function tile(ja, en, val, cls, sub) {
      return '<div class="lg-sh-tile ' + (cls || '') + '">' +
        '<span class="k">' + _t(ja, en) + '</span>' +
        (sub ? '<span class="sub">' + sub + '</span>' : '') +
        '<b class="v">' + val + '</b></div>';
    }

    return '<section class="lg-sh-panel lg-sh-match">' +
      '<div class="lg-sh-ph">' + _t('次の試合', 'Next match') + '</div>' +
      '<div class="lg-sh-nm">NEXT MATCH</div>' +
      (_isRival(oppId) ? '<div class="lg-sh-rival">' + _t('宿敵', 'RIVAL') + '</div>' : '') +
      '<div class="lg-sh-vs" role="button" tabindex="0" onclick="leagueRoundView(\'next\')">' +
        '<div class="lg-sh-team"><span class="lg-sh-shield lg-sh-slot">' + myDef.crest + '</span>' +
          '<span class="nm">' + _clubName(myId) + '</span></div>' +
        '<div class="lg-sh-vsmid"><span class="x">VS</span>' +
          '<span class="lg-sh-when"><i>' + (iAmHome ? '🏟 HOME' : '✈ AWAY') + '</i>' +
          '<b>' + (_lockedToday() ? _t('明日', 'Tomorrow') : _t('今日', 'Today')) + '</b></span></div>' +
        '<div class="lg-sh-team"><span class="lg-sh-shield lg-sh-slot">' + oppDef.crest + '</span>' +
          '<span class="nm">' + _clubName(oppId) + '</span></div>' +
      '</div>' +
      '<div class="lg-sh-scouth">' + _t('対戦相手スカウティング', 'Opponent scouting') + '</div>' +
      '<div class="lg-sh-tiles" role="button" tabindex="0" onclick="leagueRoundView(\'next\')">' +
        tile('攻撃', 'Attack', ad.atk, 'atk') +
        tile('守備', 'Defence', ad.def, 'def') +
        tile('調子', 'Form', dirIco + ' ' + _t(form.ja, form.en), 'form ' + form.dir) +
        tile('要注意', 'Danger', key ? key.name : '—', 'warn', _posLabel(key && key.pos)) +
      '</div>' +
    '</section>';
  }

  /* 右：監督ステータス（顔スロット＋レベル＋能力4本）＋本線のコマンドボタン。 */
  function _shManagerPanel() {
    var m = _state.manager || {};
    var lv = _managerLevel();
    var defs = [
      ['tactical', '戦術眼', 'Tactics', 'c1'],
      ['analysis', '分析力', 'Analysis', 'c2'],
      ['motivator', 'モチベーター', 'Motivation', 'c3'],
      ['conditioning', 'フィジカル管理', 'Conditioning', 'c4']
    ];
    var stats = defs.map(function (d) {
      var v = Math.round((m.params && m.params[d[0]]) || 0);
      return '<div class="lg-sh-stat ' + d[3] + '">' +
        '<span class="k">' + _t(d[1], d[2]) + '</span>' +
        '<i class="bar"><s class="lg-stat-fill" data-pct="' + Math.max(0, Math.min(100, v)) + '"></s></i>' +
        '<b class="v">' + v + '</b></div>';
    }).join('');
    var lvBox = lv
      ? '<div class="lg-sh-lv">' +
          '<span class="k">' + _t('監督レベル', 'Manager level') + '</span>' +
          '<b class="lv">Lv.' + lv.lv + '</b>' +
          '<i class="bar"><s class="lg-stat-fill" data-pct="' + lv.pct.toFixed(1) + '"></s></i>' +
          '<span class="next">' + _t('次のレベルまで', 'To next level') + ' <b>' + lv.toNext + '</b></span>' +
        '</div>'
      : '';
    // ★ 画像枠。監督の顔絵はまだ無いのでブランクのまま寸法だけ確保する。
    var face = '<div class="lg-sh-face lg-sh-slot" aria-hidden="true"></div>';
    // 面談は手前のページで必ず済んでいる（ハブはその後にしか描かれない）＝常に本線のCTA。
    var cta = '<button type="button" class="lg-sh-cta" onclick="leagueRoundView(\'prep\')">' +
      '⚽ ' + _t('次へ：練習メニュー', 'Next: Training') + '</button>';
    // MTG1-#5: 推しの1行（oshi.js 非同梱/キルOFFなら空文字＝従来の見た目のまま）
    var oshiRow = (typeof oshiHubRow === 'function') ? oshiHubRow() : '';
    return '<section class="lg-sh-panel lg-sh-mgr">' +
      '<div class="lg-sh-ph">' + _t('監督ステータス', 'Manager') + '</div>' +
      '<div class="lg-sh-mgrtop">' + face + lvBox + '</div>' +
      '<div class="lg-sh-stats">' + stats + '</div>' +
      oshiRow +
      cta +
    '</section>';
  }

  /* ⚙ メニュー＝記録まわり（試合ログ／号の読み返し／バックナンバー／テスト／タイトルへ）。
   * ステータスバーに全部並べると読めなくなるので、ここへ畳む。 */
  function _shMenuOverlay() {
    return '<div class="lg-sh-ovl" id="lg-sh-ovl" hidden>' +
      '<div class="lg-sh-ovl-panel">' +
        '<div class="lg-sh-ovl-head"><span>' + _t('メニュー', 'Menu') + '</span>' +
          '<button type="button" class="lg-se-ovl-x" onclick="leagueHubMenu(0)">✕</button></div>' +
        '<div class="lg-sh-ovl-body">' + _hubRecordHTML() + '</div>' +
      '</div></div>';
  }

  /* 試合後レポートはハブを崩さないようオーバーレイで重ねる（Matchday 演出が使えない時の道）。 */
  function _shBannerOverlay(lr, myId, myDef) {
    var oppDef = _clubDef(lr.mine.opp);
    var resTxt = lr.mine.res === 'W' ? _t('勝利！', 'WIN!') : lr.mine.res === 'L' ? _t('敗戦', 'LOSS') : _t('引き分け', 'DRAW');
    var h = '<div class="lg-hero" style="background:linear-gradient(135deg,' + _resultColor(lr.mine.res) + '33,rgba(0,0,0,0.25));border:1px solid ' + _resultColor(lr.mine.res) + '66">' +
      '<div style="text-align:center;color:' + _resultColor(lr.mine.res) + '" class="lg-resbadge">' + resTxt + '</div>' +
      '<div class="lg-vs">' +
        '<div class="side"><div class="crest">' + myDef.crest + '</div><div class="nm">' + _clubName(myId) + '</div></div>' +
        '<div class="mid">' + lr.mine.ms + ' - ' + lr.mine.os + '</div>' +
        '<div class="side"><div class="crest">' + oppDef.crest + '</div><div class="nm">' + _clubName(lr.mine.opp) + '</div></div>' +
      '</div>' +
      '<div style="text-align:center;font-weight:800;font-size:14px;margin:10px 4px 4px">' + _headlineText(lr) + '</div>' +
      '<div class="lg-mini" style="text-align:center;line-height:1.7">' + _reportRowsHTML(lr) + '</div>' +
      _managerGrowthHTML(lr);
    if (lr.others && lr.others.length) {
      var ot = lr.others.map(function (o) {
        return _clubName(o.home) + ' <b>' + o.hs + '-' + o.as + '</b> ' + _clubName(o.away);
      }).join('<br>');
      h += '<div class="lg-mini" style="margin-top:8px;text-align:center;border-top:1px solid rgba(255,255,255,0.12);padding-top:8px">' +
        '<div style="font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:3px">' + _t('他会場', 'Other results') + '</div>' + ot + '</div>';
    }
    h += '</div>';
    if (lr.bestXI) {
      h += _bestXIHTML(lr.bestXI, 'weekly', 'WEEKLY BEST XI', 'WEEKLY BEST XI',
        '第' + (lr.round + 1) + '節号', 'Round ' + (lr.round + 1) + ' issue');
    }
    h += _previewHTML();
    return '<div class="lg-sh-ovl" id="lg-sh-report">' +
      '<div class="lg-sh-ovl-panel wide">' +
        '<div class="lg-sh-ovl-head"><span>' + _t('第' + (lr.round + 1) + '節 レポート', 'Round ' + (lr.round + 1) + ' report') + '</span>' +
          '<button type="button" class="lg-se-ovl-x" onclick="leagueCloseReport()">✕</button></div>' +
        '<div class="lg-sh-ovl-body">' + h + '</div>' +
        '<button type="button" class="lg-sh-ovl-ok" onclick="leagueCloseReport()">' +
          _t('シーズンハブへ戻る', 'Back to the hub') + '</button>' +
      '</div></div>';
  }

  function _renderHub(showBanner) {
    _ensureStyle();
    // SN-03改3: シーズン前フローの途中は、次シーズンを開始済み（finished=false）でもそちらを描く。
    if (_prePage >= 0) { _renderPreseason(); return; }
    // MD-03: シーズン中の順送りページ（ホーム画面から「次へ」で入る）。
    if (!_state.finished && _roundView && !_boardTalkPending()) { _renderRoundView(); return; }
    if (_state.finished) { _renderFinale(); return; }   // SN-03: 最終話は専用の固定フレーム
    _seasonEndMode(false);
    // MTG1-#3: デイリーレール。節の初回だけ「朝刊」を挟む（rail.js 未搭載/キルOFFなら false）
    if (typeof Rail !== 'undefined' && Rail.intercept && Rail.intercept()) return;
    // BD-01: 開幕の面談はハブの手前の独立ページ。決めるまでハブへ入れない。
    if (_boardTalkPending()) { _renderBoardTalk(); return; }

    var myId = _state.myClub;
    var myDef = _clubDef(myId);
    var rows = _sortedStandings();
    var myPos = rows.findIndex(function (r) { return r.id === myId; }) + 1;
    var myRow = rows[myPos - 1];

    var html = '<div class="lg-sh">' +
      _shTopHTML(myId, myRow) +
      '<div class="lg-sh-cols">' +
        _shRankPanel(myId, rows, myPos, myRow) +
        _shMatchPanel(myId) +
        _shManagerPanel() +
      '</div>' +
      _shMenuOverlay() +
      ((showBanner && _state.lastResult && _state.lastResult.mine) ? _shBannerOverlay(_state.lastResult, myId, myDef) : '') +
    '</div>';

    _body().innerHTML = html;
    _hubMode(false);
    _seasonEndMode(true);   // シーズンハブも1画面固定（最終話と同じ固定フレームを流用）
    _afterRender();
  }

  /* 描画後の共通仕上げ（UX-01/02/05/06）。
   *   ① 監督室の背景を敷く（冪等・DOM は包まないのでレイアウトに影響しない）
   *   ② 顔（portrait.js）と背景アート（lab-art.js）の canvas を塗る
   *   ③ 監督ステータス等のバーを 0 から伸ばす */
  /* UX-07: ハブのときだけ画面を固定する（クラブ選択は8枚並ぶのでスクロールさせる）。 */
  function _hubMode(on) {
    var s = document.getElementById('screen-home'); if (!s) return;
    if (on) s.classList.add('hub-mode'); else s.classList.remove('hub-mode');
  }

  /* ── MOBILE-01: 内側スクロール領域の「まだ下がある」表示 ─────────────────
   * 横持ちスマホでは内側スクロール面が単に「切れている」ようにしか見えず、続きに
   * 気づけない（分析スタッフ／出場記録／ボード面談の3択／BEST XI）。下端フェードを
   * CSS に持たせ、ここで実測して .is-scrollable を付け外しする。
   * ★ 収まっている面にフェードを出すと逆に「切れている」と誤読させるので必ず実測する。 */
  // ★ .lg-sh-boardwrap は BD-01 面談を専用ページへ分離した際に廃止（要素自体が無くなった）。
  var _SCROLLHINT_SEL = '.lg-rd-scroll, .lg-se-plogwrap, .lg-md-deck,' +
                        ' .bench-list, .lg-sh-panel, .lg-age-list, .lgm-rows, .lgk-rows';
                        // lg-age-list = SN-08a オフの変化 / lgm-rows = MD-04d 相手XI / lgk-rows = MD-04e 自チームXI
  var _hintQueued = false;

  function _markScrollHints() {
    _hintQueued = false;
    var list = document.querySelectorAll(_SCROLLHINT_SEL);
    // ★ 読み（レイアウト確定）と書き（class 変更）を分ける。混ぜると要素ごとに
    //   レイアウトが無効化され直す＝毎フレーム回るこの処理でレイアウトスラッシングになる。
    var i, need = [];
    for (i = 0; i < list.length; i++) {
      // 下端に 4px 以上残っている時だけ＝終端まで送ったらフェードは消える
      need.push((list[i].scrollHeight - list[i].clientHeight - list[i].scrollTop) > 4);
    }
    for (i = 0; i < list.length; i++) {
      if (need[i]) list[i].classList.add('is-scrollable');
      else list[i].classList.remove('is-scrollable');
    }
  }

  function _queueScrollHints() {
    if (_hintQueued) return;
    _hintQueued = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(_markScrollHints);
    else setTimeout(_markScrollHints, 16);
  }

  var _hintWired = false;
  function _wireScrollHints() {
    if (_hintWired) return;
    _hintWired = true;
    // scroll はバブルしないので capture で拾う
    document.addEventListener('scroll', _queueScrollHints, true);
    window.addEventListener('resize', _queueScrollHints);
    window.addEventListener('orientationchange', _queueScrollHints);
    // デッキ（matchday.js 側で描画）や控えリストなど league.js の描画経路を通らない面も
    // 拾えるように DOM 変化を監視する。rAF で1フレーム1回に畳むので実質ノーコスト。
    if (typeof MutationObserver === 'function') {
      new MutationObserver(_queueScrollHints)
        .observe(document.body, { childList: true, subtree: true });
    }
  }

  function _afterRender() {
    var body = _body(); if (!body) return;
    if (_lgOn() && LgUI.mountOffice) LgUI.mountOffice(document.getElementById('screen-home'));
    _paintPortraitCanvases(body);
    _growBars(body);
    _wireScrollHints();
    _queueScrollHints();
  }

  /* UX-06: 素の <table> をやめてゲームのリーグ表にする（LgUI 未搭載なら従来の表へ）。
   * opts.move = {id, from, to} を渡すと、そのクラブに ▲▼ の順位変動が出る。 */
  function _standingsTableHTML(rows, myId, opts) {
    if (_lgOn() && LgUI.standings) {
      return LgUI.standings(rows, myId, {
        club: _clubResolver(),
        move: opts && opts.move,
        labels: {
          club: _t('クラブ', 'Club'), p: _t('試', 'P'), w: _t('勝', 'W'), d: _t('分', 'D'),
          l: _t('敗', 'L'), gd: _t('得失', 'GD'), pts: _t('点', 'Pts')
        }
      });
    }
    return _standingsTableLegacyHTML(rows, myId);
  }

  function _standingsTableLegacyHTML(rows, myId) {
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

  /* 保険: リーグ稼働中（body.league-mode）は、共有DOMに残るW杯モードの隠しボタン
   * #wc-btn-next（onWCNextBtn→未装飾の#screen-settingへ直行）に画面を乗っ取らせない。
   * 人の指では押せないが、ヘッドレス操作がテキスト「次へ」でこの隠しボタンを踏み、
   * 練習メニュー/試合前確認を飛ばしたように見える事故が実在（2026-07-27 新規セーブ初日調査）。
   * league.js は narration.js より後に読まれる前提（dist-lab のスクリプト順）。 */
  if (typeof window.onWCNextBtn === 'function') {
    var _wcNextOrig = window.onWCNextBtn;
    window.onWCNextBtn = function () {
      if (document.body && document.body.classList.contains('league-mode')) return;
      return _wcNextOrig.apply(this, arguments);
    };
  }

  window.leaguePickClub = function (id) { _finReset(); _newSeason(id); _renderHub(false); };
  window.leaguePlayToday = function () { playToday(); };
  window.leagueShowHub = function () { _renderHub(false); };
  // SN-03改2: 最終話コマンドバー「オファーを見る」でオファー一覧オーバーレイを開閉。
  /* ── SN-03改3 シーズン終了／シーズン前の順送り操作（2026-07-26 スライド準拠）────── */
  /* SH-01 シーズンハブの ⚙ メニュー／試合後レポートの開閉。 */
  window.leagueHubMenu = function (show) {
    var o = document.getElementById('lg-sh-ovl'); if (!o) return;
    if (show) o.removeAttribute('hidden'); else o.setAttribute('hidden', '');
  };
  window.leagueShowReport = function () { leagueHubMenu(0); _renderHub(true); };
  window.leagueCloseReport = function () {
    var o = document.getElementById('lg-sh-report');
    if (o && o.parentNode) o.parentNode.removeChild(o);
  };

  /* MD-03 シーズン中の順送り。ホーム ⇄ 順位/次の試合/練習/試合へ。 */
  window.leagueRoundView = function (v) { _roundView = v; _renderRoundView(); };
  window.leagueRoundHome = function () { _roundView = null; _renderHub(false); };

  window.leagueFinPage = function (n) { _prePage = -1; _finRank = null; _finPage = n; _renderFinale(); };
  /* ②個人表彰 ⇄ 上位10名。kind に 0/null を渡すと表彰面へ戻る。 */
  window.leagueFinRank = function (kind) {
    _finRank = (kind && AWARD_DEFS[kind]) ? kind : null;
    _finPage = 1;
    _renderFinale();
  };
  window.leaguePreEnter = function () { _prePage = 0; _preTarget = null; _renderPreseason(); };
  window.leaguePrePage = function (n) { _prePage = n; _renderPreseason(); };
  window.leaguePreSelect = function (clubId, inc) {
    var incumbent = !!Number(inc);
    _preTarget = { clubId: clubId, incumbent: incumbent, salary: _offerSalary(clubId, incumbent) };
    _prePage = 1;
    _renderPreseason();
  };
  /* ③クラブ決定＝ここで初めて周回を確定する（残留 or 移籍）。確定後は新シーズンの状態で④を描く。 */
  window.leaguePreCommit = function () {
    var t = _preTarget; if (!t) return;
    if (t.incumbent) _startNextSeason();
    else _acceptOffer(t.clubId);   // ★ _state.finished が真のうちに呼ぶ（オファーの正当性検証がそれを見る）
    _preTarget = null;
    _finPage = 0;
    _prePage = 3;                  // ④選手獲得・放出（スキップ可能）
    _renderPreseason();
  };
  window.leaguePreFinish = function () { _finReset(); _renderHub(false); };

  window.leagueSeasonOffers = function (show) {
    var o = document.getElementById('lg-se-ovl'); if (!o) return;
    if (show) o.removeAttribute('hidden'); else o.setAttribute('hidden', '');
  };
  // SN-03改2: 最終話コマンドバー「退任／解任を受け入れる」＝クラブを去りタイトルへ。
  window.leagueSeasonLeave = function () {
    if (confirm(_t('クラブを去り、タイトル画面へ戻りますか？', 'Leave the club and return to the title screen?'))) {
      window.leagueBackToTitle();
    }
  };
  // 今週の準備（MG-03b）: kind='' でそのコマを空に戻す
  window.leagueSetWeekSlot = function (idx, kind) { _setWeekSlot(idx, kind); };
  window.leagueSetTrainee = function (idx, key) { _setTraineeTarget(idx, key); };
  window.leagueAutoWeek = function () { _autoWeek(); };
  /* MD-01 設定画面のベンチ用: 現在の自チーム team1Data(overlay clone)の idx 番選手が
   * 怪我/出場停止で離脱中か。{kind:'injury'|'suspend', weeks} または null。
   * リーグの試合準備中(window._leagueInMatch)のみ有効＝single/WC のベンチには効かない。
   * ★ これで設定画面のベンチが離脱者を「起用不可」にできる（以前は起用できてしまった）。 */
  window.leaguePlayerAbsence = function (idx) {
    // ★ 2026-07-26 修正: 以前は「試合前の準備中（_leagueInMatch）」だけを見ていたため、
    //   キックオフでフラグが落ちた後（ハーフタイム采配・試合中の交代画面）は離脱者が
    //   ベンチで通常表示になり、そのままピッチへ入れられてしまっていた。
    //   離脱は**その試合を通して**有効なので、リーグの試合中（_leagueMatchActive）も見る。
    var inLeague = (typeof window !== 'undefined' && window._leagueInMatch) || _leagueMatchActive;
    if (!inLeague) return null;
    if (typeof team1Data === 'undefined' || !team1Data || !team1Data._srcKey) return null;
    var p = team1Data.players && team1Data.players[idx];
    if (!p) return null;
    var e = _peekSquadEntry(team1Data._srcKey, _playerKey(p));
    if (!e) return null;
    if (e.injuryOut > 0) return { kind: 'injury', weeks: e.injuryOut };
    if (e.suspendOut > 0) return { kind: 'suspend', weeks: e.suspendOut };
    return null;
  };
  window.leagueBackToTitle = function () {
    // MD-01: リーグを離れるので試合準備フラグを必ず落とす（single/WC へ漏らさない）
    _finReset();   // SN-03改3: 順送りの現在地も畳む（次に入った時に1ページ目から）
    window._leagueInMatch = false;
    _leagueMatchActive = false;
    _pendingMatch = null;
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
  // SN-04: 移籍オファーの受諾（確認ダイアログ→クラブを移って次シーズンへ）
  window.leagueAcceptOffer = function (clubId) {
    if (confirm(_t(_clubName(clubId) + ' のオファーを受けますか？（今季を記録に残し、新天地で次のシーズンへ）',
                   'Accept the offer from ' + _clubName(clubId) + '?'))) {
      _acceptOffer(clubId);
      _renderHub(false);
    }
  };
  // 過去のシーズン（バックナンバー）を表示。
  window.leagueShowHistory = function () { _showHistory(); };
  // UX-05: 本棚の背表紙から1冊を開く
  window.leagueOpenIssue = function (i) { _openIssue(i); };
  // BD-01: ボードとの面談（accept / lower / raise）
  window.leagueBoardTalk = function (kind) { _applyBoardTalk(kind); };
  /* UX-04 演出チューニング用（lab限定）: 直近の結果で「今節の号」をもう一度再生する。
   * 試合を消化し直さずにテンポ・音・コマ割りを確認できる（_scene_lab と同じ発想）。 */
  window.leagueReplayPostMatch = function () {
    var lr = _state && _state.lastResult;
    if (!lr) { console.warn('[league] lastResult がありません（先に1試合消化してください）'); return; }
    if (!_matchdayOn() || typeof Matchday.playPostMatch !== 'function') { console.warn('[league] Matchday 未搭載'); return; }
    Matchday.playPostMatch(_postMatchPanels(lr), {
      res: lr.mine.res,
      title: _t('デイリーリーグ', 'DAILY LEAGUE'),
      sub: _t('第' + (lr.round + 1) + '節 号', 'Round ' + (lr.round + 1) + ' issue'),
      closeLabel: _t('監督室へ戻る', 'Back to the office'),
      tapHint: _t('タップで次を読む', 'Tap to read on')
    }, function () { _renderHub(false); });
  };
  window.leagueCloseHistory = function () { var ov = document.getElementById('lg-hist-ov'); if (ov) ov.parentNode.removeChild(ov); };
  // デバッグ: ?debug=1 時、当日ロックを解除して連続プレイ可
  window.leagueDebugUnlock = function () { if (_state) { _state.lastPlayedDate = null; _save(); _renderHub(false); } };
  // テスト用（lab限定）：1日1回制限のON/OFFトグル（毎回プレイ可にする）
  window.leagueToggleTestLock = function () { if (_state) { _state.testUnlock = !_state.testUnlock; _save(); _renderHub(false); } };
  // 【一時デバッグ・完了前に削除】全節を無音消化してシーズン終了へジャンプ（最終話の再設計イテレーション用）。
  /* 1節ぶんをまとめて消化する（自チームの試合も観戦せずに確定させる）。
   * ★ 順位表・評価点・出場/得点の持ち越しまで正規の手順で書く＝「試合だけ飛ばした」状態を作る。
   *   デバッグ台（端末プレビューのデモ操作）と leagueDebugSimSeason の共通部品。 */
  function _debugSimRound() {
    if (!_state || !_state.fixtures) return false;
    var ms = _state.fixtures[_state.round];
    if (!ms) return false;
    var roundRatings = {};
    var myId = _state.myClub;
    var posBefore = _position(myId);
    var mineFx = null, mineRes = null;
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i]; if (m.played) continue;
      try {
        var r = playMatch(_overlaySquad(m.home), _overlaySquad(m.away));
        m.played = true; m.hs = r.result.home; m.as = r.result.away;
        _applyResult(m.home, m.away, r.result.home, r.result.away);
        var rr = _rateMatch(r.home, r.away, r.chanceResults, m.home, m.away);
        roundRatings[m.home] = rr[m.home]; roundRatings[m.away] = rr[m.away];
        // 出場/得点/アシストの持ち越しも書く＝この導線で飛ばしても「④自チーム成績」が空にならない。
        //   ★ 総出場時間だけは交代の刻みが取れないので入らない（実際に指揮した試合でのみ積む）。
        _recordTeamCarryover(m.home, r.home, _statsFromRatings(rr[m.home]));
        _recordTeamCarryover(m.away, r.away, _statsFromRatings(rr[m.away]));
        if (m.home === myId || m.away === myId) { mineFx = m; mineRes = rr; }
      } catch (e) { console.warn('[league] debug sim match failed', e); }
    }
    _accumulateRatings(roundRatings);
    _state.round++;

    /* ★ 自チームの試合を「観戦せずに確定させた」時も、実際に指揮した後と同じ形の
     *   lastResult を残す。これが無いと試合後バナー・BEST XI・SNSフィード（RW-01）が
     *   「まだ試合をしていない」状態のままになり、検証台で新機能が見えない。
     *   ※ 出場時間・実況ログ・詳細スタッツは観戦しないと取れないので入らない。 */
    if (mineFx) {
      var oppId = (mineFx.home === myId) ? mineFx.away : mineFx.home;
      var iAmHome = (mineFx.home === myId);
      var myScore = iAmHome ? mineFx.hs : mineFx.as;
      var oppScore = iAmHome ? mineFx.as : mineFx.hs;
      var res = (myScore > oppScore) ? 'W' : (myScore < oppScore) ? 'L' : 'D';
      var byKey = (mineRes && mineRes[myId]) || {};
      var scorers = [], momRow = null;
      Object.keys(byKey).sort().forEach(function (pk) {
        var e = byKey[pk];
        if (e.goals) scorers.push({ name: _keyDisplayName(pk), goals: e.goals });
        if (!momRow || e.rating > momRow.rating) {
          momRow = { name: _keyDisplayName(pk), rating: e.rating, goals: e.goals || 0, assists: e.assists || 0 };
        }
      });
      var others = ms.filter(function (x) { return x !== mineFx; })
        .map(function (x) { return { home: x.home, away: x.away, hs: x.hs, as: x.as }; });
      _state.lastResult = {
        bestXI: _pickBestXI(roundRatings),
        ratings: (mineRes && mineRes[myId]) || null,   // MTG1-#5: 飛ばし観戦でも推しの記事は出す
        round: _state.round,
        mine: {
          me: myId, opp: oppId, ms: myScore, os: oppScore, res: res, home: iAmHome,
          rival: _isRival(oppId), posBefore: posBefore, posAfter: _position(myId),
          mom: momRow ? { name: momRow.name, goals: momRow.goals, assists: momRow.assists } : null,
          scorers: scorers
        },
        others: others
      };
    }
    return true;
  }

  /* デモ/検証用: 1節だけ進める。ハブに順位と結果が反映された状態で止まる。 */
  window.leagueDebugSimRound = function () {
    if (!_state || !_state.fixtures) { console.warn('[league] pick a club first'); return false; }
    if (_state.round >= _state.fixtures.length) return false;
    _debugSimRound();
    _state.lastPlayedDate = null;   // 1日1試合ロックを解いておく（検証台のため）
    if (_state.round >= _state.fixtures.length) {
      _state.finished = true; _finReset();
      _state.lastResult = _state.lastResult || {};
      _state.lastResult.season = _settleSeason(_position(_state.myClub));
    }
    _save(); _renderHub(false);
    return true;
  };

  window.leagueDebugSimSeason = function () {
    if (!_state || !_state.fixtures) { console.warn('[league] pick a club first'); return; }
    while (_state.round < _state.fixtures.length) _debugSimRound();
    _state.finished = true;
    _finReset();
    _state.lastResult = _state.lastResult || {};
    _state.lastResult.season = _settleSeason(_position(_state.myClub));
    _save(); _renderHub(false);
  };
  /* MTG1-#3 デイリーレール（js/rail.js）へ渡す読み出し口。★ 置くだけ＝rail.js が遅延で拾う
   * （rail.js は league.js より後に読まれるので、ここから直接呼ばない）。未搭載なら誰も見ない。 */
  window._leagueRailHost = {
    state: function () { return _state; }, save: _save,
    standings: _sortedStandings, rankMoves: _rankMoves, h2h: _h2h, streak: _currentStreak,
    clubName: _clubName, clubDef: _clubDef, fixture: _myFixtureThisRound, locked: _lockedToday,
    goalText: _seasonGoalText, snsFeed: _snsFeed, headline: _headlineText,
    body: _body, after: _afterRender, frame: _seasonEndMode, hubMode: _hubMode,
    home: function () { _renderHub(false); }
  };

  /* MTG1-#5 推し指名（js/oshi.js）へ渡す読み出し口。★ #3 と同じく置くだけ＝oshi.js が遅延で拾う。 */
  window._leagueOshiHost = {
    state: function () { return _state; }, save: _save,
    squad: function () { return _state ? _overlaySquad(_state.myClub) : null; },
    key: _playerKey, displayName: _keyDisplayName, peek: _peekSquadEntry,
    paint: _paintPortraitCanvases, home: function () { _renderHub(false); }
  };

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
    // SN-08a 年齢・成長・soft衰え
    playerAge: _playerAge,
    baseAge: _baseAge,
    agingDelta: _agingDelta,
    applySeasonAging: _applySeasonAging,
    talentOf: _talentOf,
    talentOverrides: TALENT_OVERRIDES,
    AGE_TUNING: AGE_TUNING,
    GROWTH_TUNING: GROWTH_TUNING,
    TALENT_TUNING: TALENT_TUNING,
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
    ensureCoreCoaches: _ensureCoreCoaches,
    physicalCoachAdvice: _physicalCoachAdvice,
    analysisCoachCard: _analysisCoachCard,
    opponentThreat: _opponentThreat,
    opponentThreats: _opponentThreats,
    opponentThreatsRanked: _opponentThreatsRanked,
    // MTG1: マーク対象の検証・自動選び直し（tools/mtg1-marked-fix-test.js）
    validMarkedPlayer: _validMarkedPlayer,
    nextUnlearnedTactic: _nextUnlearnedTactic,
    // MG-04 戦術習得制
    isTacticUnlocked: _isTacticUnlocked,
    tacticLabel: _tacticLabel,
    setLeagueMatchActive: function (v) { _leagueMatchActive = v; },
    TACTIC_IDS: TACTIC_IDS,
    // RW-02 バックナンバー
    historyIssueHTML: _historyIssueHTML,
    // 采配を挟んだ試合の左右判定（2026-08-05 修正の回帰テスト用）
    sameTeam: _sameTeam,
    computeMatchStats: _computeMatchStats,
    collectMyStats: _collectMyStats,
    // BX ベストイレブン
    rateMatch: _rateMatch,
    pickBestXI: _pickBestXI,
    accumulateRatings: _accumulateRatings,
    seasonBestXI: _seasonBestXI,
    posGroup: _posGroup,
    BESTXI_TUNING: BESTXI_TUNING,
    // SN-04/05 契約分岐
    isSacked: _isSacked,
    computeOffers: _computeOffers,
    contractBranch: _contractBranch,
    acceptOffer: _acceptOffer,
    CONTRACT_TUNING: CONTRACT_TUNING,
    // SN-03 シーズン終了フロー
    seasonSummary: _seasonSummary,
    seasonTopPlayers: _seasonTopPlayers,
    seasonReviewText: _seasonReviewText,
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
