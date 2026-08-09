/**
 * manager-match.js — 監督ビューア（P2 / BACKLOG T-09・T-11・T-12）。
 *
 * 目的:
 *   「監督として試合を“読む”」観戦モード。試合を自動再生で流し、采配ポイント
 *   （ハーフタイム・ゴール・任意の一時停止）で采配（システム/戦術/キープレイヤー/
 *   要注意プレイヤー/交代/ポジション入替）を行う。
 *
 *   ★ 既存エンジン（simulateChance / デュエル式 / select*）には一切触れない。
 *     試合の進行は match.js の createMatch（チャンス逐次実行・遅延計算）が担い、
 *     描画は既存のシーン送りシーケンサ（simulate.js: nextChance UI）と
 *     cutscene.js の描画プリミティブをそのまま再利用する。
 *
 *   ★ 通常試合フロー（startGame の事前一括演算）には影響しない。
 *     simulate.js 側のフックは全て _managerMode ガード済みで、非・監督モードでは
 *     既存挙動とビット同一。
 *
 * 采配UI（T-11/T-12 ＋ 追加要望）:
 *   交代・戦術だけでなく「システム/キープレイヤー/要注意/ポジション入替」も行えるよう、
 *   プリマッチと同じ「設定画面」を監督モードから再利用する。設定画面の各セレクタは
 *   全て team1State を編集するので、采配を開く時に live チーム → team1State へ同期し、
 *   閉じる時に team1State → live チームへ適用する（lineup を変える前に過去 scene を凍結）。
 *
 * 介入が結果に効く仕組み（createMatch の遅延実行）:
 *   従来の後半交代（_recalcSecondHalf）は「残りチャンスを再シミュレート」＝RNG 再抽選＋
 *   チーム再構築（fatigue/chance_counter が消える）で非決定的だった。createMatch は
 *   未計算のチャンスを 1 つずつ計算するため、live チーム（=gameState.team1）の
 *   system/tactics/keyplayer/marked/lineup を差し替えるだけで「次チャンス以降」が新入力を
 *   読む。再抽選なし・走行中の選手状態を保持。
 *   ※ 簡易な交代/戦術は createMatch.applyDecision でも可能だが、本UIは設定画面を再利用して
 *      全采配を一括反映するため live チームを直接更新する（未シード観戦モードのため決定論
 *      ログ非依存）。
 *
 * ロード順: players.js → rng.js → simulate.js → events.js → match.js → cutscene.js →
 *           manager-match.js。
 */

(function () {
  'use strict';

  /* ── 再生の状態（このモジュール内のみ）────────────────────────────────
   * ★ 既定は「手動送り」（2026-07-27 ユーザー指示で自動再生から戻した）。
   *   1タップ＝1ビート。読む速さは人によって違うし、勝手に流れると
   *   「読んでいる途中で次に行った」になる＝試合を追えない。
   *   自動再生はオプションとして残し、選択は端末に憶えさせる。 */
  var _MV_AUTO_KEY = 'fs_mv_autoplay';
  var _mvAuto = false;        // 自動再生モードか（false=手動送り＝既定）
  var _mvPlaying = false;     // 自動再生のタイマーが動いているか
  var _mvTimer = null;        // setTimeout ハンドル
  var _mvStepDone = false;    // MTG1-#2: 直近の _mvStep が停止条件を踏まずに完了したか（hold-to-skim 用）

  function _mvLoadAutoPref() {
    try { _mvAuto = (localStorage.getItem(_MV_AUTO_KEY) === '1'); } catch (e) { _mvAuto = false; }
  }
  function _mvSaveAutoPref() {
    try { localStorage.setItem(_MV_AUTO_KEY, _mvAuto ? '1' : '0'); } catch (e) {}
  }

  /* 停止から復帰する時の共通口。自動なら再生を再開、手動なら「次へ」を押せる状態に戻すだけ。
   * ★ 復帰点はゴール後・交代カット後・采配後・後半キックオフ後と複数ある。ここを1本に
   *   まとめておかないと「手動なのに自動で走り出す」経路が必ず取り残される。 */
  function _mvResume() {
    if (!_managerMode) return;
    if (_mvAuto) { _mvPlay(); return; }
    _mvPlaying = false;
    _mvUpdateControlBar();
  }
  // 1ビートあたりの待ち(ms)。1× は最長アニメ（ワンツー 2200ms 等）を切らない尺にする。
  var _MV_SPEEDS = [2400, 1300, 700];  // 1x / 2x / 3x
  var _mvSpeedIdx = 0;        // 現在の速度段（0..2）
  var _mvUiLang = null;       // 注入 UI を生成した言語（切替時に静的ラベルを作り直す）
  var _mvLastKind = 'manual'; // 直近の采配ポイント種別（采配画面から戻る時に再表示）

  function _isEn() { return (typeof window !== 'undefined' && window.LANG === 'en'); }
  function _mvT(ja, en) { return _isEn() ? en : ja; }
  function _mvSpeed() { return _MV_SPEEDS[_mvSpeedIdx]; }

  /* 交代/入替の「過去スコア誤帰属」対策（Codex 指摘 P2-A）──────────────────
   * lineup を変えると、過去チャンスの scene（同じ home オブジェクトを sc.offence/defence と
   * して参照）が結果画面の `team.players[team.lineup[ofsPos]]` で別人に解決され、交代前の
   * ゴール/デュエルが控えへ誤帰属する。→ lineup を変える直前に、既計算済みの全 scene が
   * 参照する home オブジェクトを「その時点の lineup を凍結したシャローコピー」へ差し替える。
   * クローンは .name/.players/.team_color/メソッドを保持し lineup だけ凍結するので、結果画面の
   * team.name 判定・選手解決・色は正しいまま。過去 scene は描画済みで再描画されない。 */
  function _mvCloneTeamFrozen(team) {
    var c = {};
    for (var k in team) { if (Object.prototype.hasOwnProperty.call(team, k)) c[k] = team[k]; }
    c.lineup = team.lineup.slice();
    return c;
  }
  function _mvFreezePastScenes() {
    if (!gameState || !gameState.team1) return;
    var liveHome = gameState.team1;
    var frozen = null;   // 同一 era の全 scene で 1 つの凍結クローンを共有
    for (var ci = 0; ci < chanceResults.length; ci++) {
      var scs = chanceResults[ci] && chanceResults[ci].scenes;
      if (!scs) continue;
      for (var si = 0; si < scs.length; si++) {
        var sc = scs[si];
        if (sc.offence === liveHome) { if (!frozen) frozen = _mvCloneTeamFrozen(liveHome); sc.offence = frozen; }
        if (sc.defence === liveHome) { if (!frozen) frozen = _mvCloneTeamFrozen(liveHome); sc.defence = frozen; }
      }
    }
  }

  function _gameActive() {
    var el = document.getElementById('screen-game');
    return el && el.classList.contains('active');
  }

  // startGame と同じ手順で coachMarkTarget（相手がマークする team1 前線選手の lineup 位置）を決める。
  function _mvComputeCoachMarkTarget() {
    coachMarkTarget = -1;
    var t1 = gameState.team1;
    var frontTypes = ['CF', 'WG', 'OMF', 'SMF'];
    var cands = [];
    for (var pos = 1; pos < 11; pos++) {
      if (frontTypes.indexOf(t1.getPositionType(pos)) >= 0) {
        var p = t1.players[t1.lineup[pos]];
        var ex = (typeof getPlayerExtra === 'function') ? getPlayerExtra(p) : PLAYER_EXTRA[p.name];
        var of = (ex && ex.of)
          ? ex.of
          : (p.params[11] + p.params[12] + p.params[13] + p.params[17]) / 4;
        cands.push({ pos: pos, rating: of });
      }
    }
    cands.sort(function (a, b) { return b.rating - a.rating; });
    var top2 = cands.slice(0, 2);
    coachMarkTarget = top2.length > 0 ? top2[Math.floor(rng() * top2.length)].pos : 10;
  }

  // 現在の試合時間ラベル（交代ログ用）。
  function _mvTimeLabel() {
    var r = chanceResults[currentChanceIdx - 1] || chanceResults[currentChanceIdx];
    return (r && r.time) || '';
  }

  /* ──────────────────────────────────────────────────────────────────
   * エントリ: startManagerMatch — 監督ビューアで試合を開始する。
   * ────────────────────────────────────────────────────────────────── */
  function startManagerMatch() {
    if (typeof wcPhase !== 'undefined' && (wcPhase === 'et_first' || wcPhase === 'et_second')) return;
    if (typeof createMatch !== 'function') { alert('createMatch 未ロード'); return; }

    // ★ 選手詳細ページのデータ源キーを team1Data に整合させる（2026-07-04 バグ修正／2026-07-24 再修正）。
    //   リーグ(league.js)は team1Data を実チーム(例:オランダ)へ差し替えるが _team1DataKey を
    //   更新しないため、既定の 'japan2026vsNetherlands' のまま残り、フォーメーションで選手を
    //   タップすると日本人選手のプロフィールが出ていた（showPlayerDetail が TEAM_DATA[key] を引く）。
    //   ⚠️ 再発の原因: SN-01(セーブv4)以降、リーグは team1Data に _overlaySquad の「clone」を渡すため
    //   参照一致（TEAM_DATA[k] === team1Data）ではキーが見つからず既定に戻っていた。
    //   → clone が持つ _srcKey（実クラブキー）を最優先で使い、無ければ従来の参照一致で探す。
    if (typeof TEAM_DATA !== 'undefined' && typeof team1Data !== 'undefined' && typeof _team1DataKey !== 'undefined') {
      var _k1 = (team1Data && team1Data._srcKey && TEAM_DATA[team1Data._srcKey])
        ? team1Data._srcKey
        : Object.keys(TEAM_DATA).find(function (k) { return TEAM_DATA[k] === team1Data; });
      if (_k1) _team1DataKey = _k1;
    }

    // 相手（team2）状態を startGame と同様に構築（default_* から）。
    var t2sys = system_data.findIndex(function (s) { return s.name === team2Data.default_system; });
    team2State = {
      systemIdx: t2sys >= 0 ? t2sys : 0,
      tactics: team2Data.default_tactics,
      keyplayer: team2Data.default_keyplayer,
      marked_player: (team2Data.default_marked_player !== undefined) ? team2Data.default_marked_player : -1,
      lineup: team2Data.default_lineup.slice(0, 11)
    };

    // 表示系グローバルを startGame と同じくリセット。
    chanceResults = [];
    currentChanceIdx = 0;
    currentSceneIdx = 0;
    currentEventDiv = null;
    halfTimeShown = false;
    halfTimeScore = { t1: 0, t2: 0 };
    subsCount = 0; subsUsed = 0; htSubsCount = 0; _htMode = false;
    _mvOppSubCount = 0; _mvOppOff = {}; _mvOppIn = {}; _mvLateChecked = false;   // 相手監督AIの交代状態をリセット
    window._mvMatchSubs = [];   // 全交代（自/相手）のログ記録をリセット
    _mvSubCutQueue = [];   // 交代カットシーン待ち行列をリセット
    _mvSkillCutQueue = []; _mvSkillSeen = {};   // スキル発動カットイン待ち行列/既再生をリセット（PS-05）
    // MTG1-#2 ドラマスコア: ティア消費・介入マーカーを1試合ぶんリセット（非同梱/キルOFFは no-op）
    if (typeof dramaBeginMatch === 'function') dramaBeginMatch();
    _subbedOff = new Set();
    _pendingSubLog = [];
    _shootSubStep = 0;
    _pendingCoachCardEl = null;
    coachMarkTarget = -1;   // gameState 構築後に startGame 同様セット（コーチの指摘用）

    // createMatch コントローラ（home=team1 / away=team2）。未シード＝毎回フレッシュな試合。
    _mvCtrl = createMatch(team1Data, team2Data, { home: team1State, away: team2State });
    _managerMode = true;
    _mvGoalShown = false;
    _mvClearNote();   // 前の試合の保留行を持ち越さない
    _mvPlaying = false;
    _mvSpeedIdx = 0;
    _mvLastKind = 'manual';

    // 描画・采配の単一ソースを controller の team オブジェクトに束ねる。
    gameState = { team1: _mvCtrl.home, team2: _mvCtrl.away };

    // コーチの指摘（チャンス4の「相手のマークがキツい team1 選手」）用に coachMarkTarget を
    // startGame と同じ手順で決める。チャンス2の「相手キープレイヤー」指摘は team2.keyplayer を
    // 直接読むので別途不要。※未シードのため rng() 消費順は結果に影響しない。
    _mvComputeCoachMarkTarget();

    var n = _mvCtrl.getState().n;

    // HUD（startGame の UI 初期化と同じ）。
    document.getElementById('score-flag1').textContent = team1Data.flag;
    document.getElementById('score-flag2').textContent = team2Data.flag;
    document.getElementById('score-name1').textContent = getTeamName(team1Data);
    document.getElementById('score-name2').textContent = getTeamName(team2Data);
    document.getElementById('score1').textContent = '0';
    document.getElementById('score2').textContent = '0';
    document.getElementById('log-area').innerHTML = '';
    var _lfw = document.getElementById('live-field-wrap');
    if (_lfw) { _lfw.style.display = 'none'; _lfw.innerHTML = ''; }
    document.getElementById('chance-count').textContent = '0';
    document.getElementById('chance-total').textContent = n;

    _toggleNormalControls(false);   // 通常の次へ/一気に/交代ボタンは隠す
    showScreen('game');
    _mvEnsureUI();
    _mvShowControls(true);
    _mvUpdateControlBar();

    /* ★ キックオフ直後は「1ビート目を出して待つ」。既定は手動送りなので勝手に流さない。
     *   自動再生を選んでいる端末だけ、そのまま流れ続ける。 */
    _mvLoadAutoPref();
    if (_mvAuto) _mvPlay();
    else { _mvUpdateControlBar(); _mvStep(false); }
  }

  function _toggleNormalControls(show) {
    // 手動シーン送りの操作群。監督モードでは #mv-controls が采配/再生/結果を担うため全て隠す。
    // redesign 済み screen-game は tactics-btn（采配 ＝ openSecondHalfSub）を game-controls-row に
    // 持つので、これも隠さないと #mv-controls の采配ボタンと二重表示になる（Engine 配線）。
    ['next-btn', 'all-btn', 'sub-btn', 'tactics-btn'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = show ? '' : 'none';
    });
  }

  /* ── 自動再生ドライバ ──────────────────────────────────────────── */
  function _mvPlay() {
    if (!_managerMode) return;
    _mvPlaying = true;
    _mvUpdateControlBar();
    if (_mvTimer) { clearTimeout(_mvTimer); _mvTimer = null; }
    _mvTimer = setTimeout(_mvTick, 250);
  }
  function _mvPause() {
    _mvPlaying = false;
    if (_mvTimer) { clearTimeout(_mvTimer); _mvTimer = null; }
    _mvUpdateControlBar();
  }
  /* ⏯ ボタン＝自動再生の ON/OFF。手動送りが既定なので、これは「自動に切り替える」操作。 */
  function _mvTogglePlay() {
    if (!_managerMode) return;
    if (_mvAuto) { _mvAuto = false; _mvSaveAutoPref(); _mvPause(); return; }
    _mvAuto = true; _mvSaveAutoPref();
    _mvHideDecision(); _mvPlay();
  }
  /* ▶ 次へ＝1タップ1ビート（手動送り）。自動再生中は押せない。 */
  function _mvNext() {
    if (!_managerMode || _mvAuto) return;
    if (!_gameActive()) return;
    _mvHideDecision();
    if (_mvTimer) { clearTimeout(_mvTimer); _mvTimer = null; }
    _mvStep(false);
  }
  function _mvCycleSpeed() {
    _mvSpeedIdx = (_mvSpeedIdx + 1) % _MV_SPEEDS.length;
    _mvUpdateControlBar();
  }

  /* MTG1-#2 hold-to-skim の操作口（dramascore.js の帯押下ループから呼ばれる・表示のみ）。
   * 1ビート送って true。停止条件（HT/ゴール/負傷交代/終了/采配パネル/HTモーダル）を
   * 踏んだら false ＝ エンジン側の停止フローに委ね、skim 側はループを止める。 */
  function _mvSkimTick() {
    if (!_managerMode || !_gameActive()) return false;
    var dec = document.getElementById('mv-decision');
    if (dec && dec.style.display === 'flex') return false;
    var htm = document.getElementById('halftime-modal');
    if (htm && htm.style.display === 'flex') return false;
    if (_mvTimer) { clearTimeout(_mvTimer); _mvTimer = null; }   // 自動再生の予約と二重送りしない
    _mvStep(false);
    return _mvStepDone;
  }
  /* 押下終了の後始末。engineStopped=true はエンジン停止（ゴール余韻→カット→再開等）が
   * 進行中＝こちらから再開しない。それ以外は自動再生モードなら再開する。 */
  function _mvSkimEnd(engineStopped) {
    if (!_managerMode || engineStopped) return;
    if (_mvAuto) _mvResume();
  }

  // 再生ウォッチドッグ（P1凍結対策・2026-07-04）: 「再生中なのに何も進まない」を検出して
  // 回復可能な一時停止へ変換する。2026-07-04 に HT重複負傷の解決後で1度だけ発生した
  // 無言フリーズ（再現条件未特定）が再発しても、ユーザーは ▶ で再開でき、原因が
  // window._mvLastError / コンソールに残る。
  var _mvProgKey = '';
  /* ゴール演出が終わるまで伏せておく実況ノート（MTG1-#1 の⭐🗣）。1ビートに1本しか出ない。
   * ★ 出し直しはタイマーで持つ＝ゴールのビートは HT停止/交代カット など複数の分岐で
   *   早期 return しうるので、「どの分岐を通ったか」に依存させない。 */
  var _MV_GOAL_HOLD = 3300;   // ゴール演出＋余韻（自動再生の停止時間と同じ尺）
  var _mvNotePending = null;
  var _mvNoteTimer = null;
  function _mvHoldNote(msg) {
    _mvClearNote();
    _mvNotePending = msg;
    _mvNoteTimer = setTimeout(_mvFlushNote, _MV_GOAL_HOLD);
  }
  function _mvFlushNote() {
    _mvNoteTimer = null;
    var m = _mvNotePending; _mvNotePending = null;
    if (!m || !_managerMode) return;
    _mvLiveNote(m, 'mine');
  }
  function _mvClearNote() {
    if (_mvNoteTimer) { clearTimeout(_mvNoteTimer); _mvNoteTimer = null; }
    _mvNotePending = null;
  }
  var _mvStallCount = 0;
  var _MV_STALL_LIMIT = 10;   // 10ティック連続無進行で異常とみなす（HT/ゴール停止はタイマー停止なので誤検知しない）

  // 1ティック = 1ビート進める。HT/ゴール/終了で自動停止。
  function _mvTick() {
    _mvTimer = null;
    if (!_managerMode || !_mvPlaying) return;
    _mvStep(true);
  }

  /* 1ビート進めて、停止条件（HT/ゴール/負傷交代/終了）を判定する共通処理。
   * auto=true のときだけ末尾で次のティックを予約する＝手動送りは1回で必ず止まる。 */
  function _mvStep(auto) {
    if (!_managerMode) return;
    if (!_gameActive()) { _mvPause(); return; }   // 画面遷移時はタイマー停止

    if (_mvCtrl.isOver() && currentChanceIdx >= chanceResults.length) { _mvFinish(); return; }

    _mvGoalShown = false;
    _mvStepDone = false;   // MTG1-#2: このビートが停止条件を踏まずに完了したか（hold-to-skim 判定用）
    // MTG1-#1 采配の答え合わせ: いま表示するビート位置（chance/scene）を控える（トースト判定用・表示のみ）
    var _abC = (typeof currentChanceIdx !== 'undefined') ? currentChanceIdx : -1;
    var _abS = (typeof currentSceneIdx !== 'undefined') ? currentSceneIdx : 0;
    // MTG1-#2: コーチカードのビートはシーンを表示しない（nextChance 早期 return）＝ティア判定対象外
    var _dsCoach = (typeof _pendingCoachCardEl !== 'undefined') && !!_pendingCoachCardEl;
    try {
      nextChance();                     // 1ビート進める（内部で createMatch から遅延フェッチ）
    } catch (e) {
      // 例外でタイマーが死ぬと「⏸のまま永久停止」になる（2026-07-04 実観測の症状と同型）。
      // 一時停止に変換してエラーを可視化し、▶ で再試行できるようにする。
      window._mvLastError = { msg: e && e.message, stack: e && e.stack, at: 'nextChance' };
      if (typeof console !== 'undefined') console.error('[manager] nextChance failed:', e);
      _mvPause();
      _mvToast('⚠️ ' + _mvT('再生エラー：一時停止しました', 'Playback error — paused'));
      return;
    }
    // 無進行検出: チャンス/シーン/分割ステップのどれも動いていないティックが連続したら停止。
    var _pk = currentChanceIdx + ':' + currentSceneIdx + ':' + _shootSubStep + ':' + chanceResults.length;
    if (_pk === _mvProgKey) {
      if (++_mvStallCount >= _MV_STALL_LIMIT) {
        window._mvLastError = { msg: 'playback stalled (no progress ' + _MV_STALL_LIMIT + ' ticks)', at: _pk };
        if (typeof console !== 'undefined') console.error('[manager] playback stalled at', _pk);
        _mvStallCount = 0;
        _mvPause();
        _mvToast('⚠️ ' + _mvT('再生が進まないため一時停止しました', 'Playback stalled — paused'));
        return;
      }
    } else { _mvProgKey = _pk; _mvStallCount = 0; }
    _mvSyncHud();
    // MTG1-#1: 決定的に効いた瞬間の一行メッセージ（attribution.js 非同梱/キルOFFは no-op・1試合最大3回）
    //   MTG1案1(2026-08-05): 表示先をトースト→実況ノート（⭐🗣＝自チームに良い出来事＝tone 'mine'）。
    //   attributionOnBeat のシグネチャは不変＝sink 関数の差し替えのみ。
    //   ★ 出すタイミング（2026-08-10 修正）: 文面が「— ゴール！」と結果を含むので、
    //     ①分割シュートの途中ビート（まだ蹴っている最中）では判定させない＝_shootSubStep===0
    //       ＝シーンの結果打だけを見る。②結果打であっても、ゴール演出の前に出すと
    //       カットシーンが動く前にテキストで結果が割れる（実測・添付スクショ）。
    //     ゴールのビートは行を積まずに保留し、演出が終わってから出す（_mvFlushNote）。
    if (typeof attributionOnBeat === 'function' && _shootSubStep === 0) {
      attributionOnBeat(_abC, _abS, function (m) {
        if (_mvGoalShown) _mvHoldNote(m);          // ゴール演出の後まで伏せる
        else _mvLiveNote(m, 'mine');
      });
    }
    // MTG1-#2 ドラマスコア×ティア演出: いま表示したビートを採点し FX を帯内に重ねる（表示のみ・エンジン不変）。
    //   nextChance 後に _shootSubStep===0 ＝ このビートがシーンの結果打（分割シュートの最終ビート）。
    if (!_dsCoach && typeof dramaOnBeat === 'function') dramaOnBeat(_abC, _abS, _shootSubStep === 0);

    // ハーフタイム停止（前半ロスタイム完了＝currentChanceIdx===HALF_CHANCES の瞬間・1回のみ）。
    if (currentChanceIdx === HALF_CHANCES && !halfTimeShown && currentSceneIdx === 0 && _shootSubStep === 0) {
      halfTimeShown = true;
      var htRes = chanceResults[HALF_CHANCES - 1] || chanceResults[HALF_CHANCES - 2];
      if (htRes) halfTimeScore = { t1: htRes.t1score, t2: htRes.t2score };
      _mvOpponentDecide(true);   // 相手監督のハーフタイム采配（戦術＋交代）
      // ※ HTの交代カットは前半終了直後には出さず、待ち行列に積んだまま後半キックオフ時
      //    （_mvManagerHTKickoff）に表示＝「前半での交代」に見えないようにする。
      _mvPause();
      setTimeout(function () { if (_managerMode) _mvShowHT(); }, 350);
      return;
    }

    // 後半終盤（beat24≒後半25分）の単発チェック＝得点が無い展開でもリード守り/追撃を判断。
    if (typeof MATCH_CHANCES !== 'undefined' && currentChanceIdx >= Math.floor(MATCH_CHANCES * 0.75) && !_mvLateChecked) {
      _mvLateChecked = true;
      _mvOpponentDecide(false);
      if (_mvSubCutQueue.length) { _mvPause(); _mvPlaySubCutscenes(function () { _mvResume(); }); return; }
    }

    // ゴール停止（カットシーンの余韻＋交代カットを見せてから自動再生を続行）。
    //   ※ ゴール後の采配ポップアップは廃止（割り込み過多・采配はコントロールバー/HTで可能）。
    if (_mvGoalShown) {
      _mvOpponentDecide(false);   // 相手監督が失点/得点に反応（戦術＋交代）
      _mvCollectSkillEvents();    // このチャンスの skill_activate（鼓舞など）を収集（PS-05）
      _mvPause();
      setTimeout(function () {
        if (!_managerMode) return;
        // ※ MTG1-#1 の一行（⭐🗣）は _mvHoldNote のタイマーが同じ尺で出す（ここでは触らない）。
        // 失点シーンの“後”に発動カットイン＋トースト → 交代カット → 続行（時系列＝失点→発動）。
        _mvPlaySkillCutscenes(function () {
          if (!_managerMode) return;
          _mvPlaySubCutscenes(function () { _mvResume(); });
        });
      }, _MV_GOAL_HOLD);
      return;
    }

    if (_mvCtrl.isOver() && currentChanceIdx >= chanceResults.length) { _mvFinish(); return; }

    // 負傷交代（重症・自チーム・Sprint 2b）: チャンス境界（次チャンス未計算のタイミング）で
    // 停止し、交代画面を即時に開く。エンジンは采配待ちの間チャンスを計算しないので、
    // 負傷選手が次チャンスを踏むことはない。解決は _mvCloseSetting / _mvManagerHTKickoff。
    if (currentSceneIdx === 0 && _shootSubStep === 0 &&
        typeof disciplinePendingUserSub === 'function' && gameState && gameState.team1 &&
        disciplinePendingUserSub(gameState.team1)) {
      _mvPause();
      var _injReq = disciplinePendingUserSub(gameState.team1);
      var _injP = gameState.team1.players[_injReq.outIdx];
      _mvToast('🚑 ' + _mvT('負傷交代が必要', 'Injury — substitution needed') +
               (_injP ? '：' + _mvName(_injP) : ''));
      setTimeout(function () { if (_managerMode) _mvOpenSetting(); }, 900);
      return;
    }

    _mvStepDone = true;   // 停止条件を踏まずにビート完了（hold-to-skim は続行してよい）

    // ★ 手動送りはここで終わり。次のビートはユーザーの「次へ」を待つ。
    if (auto) {
      var _dsDelay = _mvSpeed();
      // MTG1-#2: ドラマティアに応じた可変テンポ。1×/2×/3× を「基準速度」としてティア倍率を乗算
      //   （Tier1=約0.87で流し、Tier2/3は溜める）。dramascore.js 非同梱/キルOFFは倍率1.0。
      if (typeof dramaBeatScale === 'function') {
        var _dsRes = chanceResults[_abC];
        _dsDelay = Math.round(_dsDelay * dramaBeatScale(_dsRes && _dsRes.scenes ? _dsRes.scenes[_abS] : null));
      }
      _mvTimer = setTimeout(_mvTick, _dsDelay);
    }
    else _mvUpdateControlBar();
  }

  function _mvSyncHud() {
    var cc = document.getElementById('chance-count');
    if (cc) cc.textContent = Math.min(currentChanceIdx, _mvCtrl.getState().n);
    _mvRenderMentalHud();
  }

  /* ── メンタル可視化 HUD（PS-05・描画のみ・エンジン不変）───────────────
   * 自チーム(team1)の chief morale アイコン と、ピッチ上のイライラ(frustration)選手数を
   *   小さなピルで常時表示。mental.js が付与する team.morale / player.frustration を読むだけ。
   * 非表示: window.MV_MENTAL_HUD===false（既定表示・mental非同梱でも 0 扱いで安全）。 */
  function _mvMoraleIcon(m) {
    if (m > 0.15) return '🔥';        // 高揚
    if (m < -0.15) return '💧';       // 意気消沈
    return '😐';
  }
  function _mvRenderMentalHud() {
    if (typeof window !== 'undefined' && window.MV_MENTAL_HUD === false) {
      var old = document.getElementById('mv-mental-hud'); if (old) old.style.display = 'none';
      return;
    }
    var host = document.getElementById('screen-game'); if (!host) return;
    var team = (typeof gameState !== 'undefined' && gameState) ? gameState.team1 : null;
    if (!team || !team.players || !team.lineup) return;
    var el = document.getElementById('mv-mental-hud');
    if (!el) {
      el = document.createElement('div'); el.id = 'mv-mental-hud';
      el.style.cssText = 'position:absolute;top:104px;left:8px;z-index:55;display:flex;gap:6px;align-items:center;' +
        'background:rgba(12,16,26,0.82);border:1px solid rgba(255,255,255,0.16);border-radius:16px;' +
        'padding:4px 10px;font-size:11px;font-weight:800;color:#eef3ff;pointer-events:none;' +
        'box-shadow:0 3px 10px rgba(0,0,0,0.35);white-space:nowrap;line-height:1.4';
      host.appendChild(el);
    }
    el.style.display = '';
    var m = team.morale || 0;
    var frust = 0;
    for (var pos = 0; pos < 11 && pos < team.lineup.length; pos++) {
      var p = team.players[team.lineup[pos]];
      if (p && (p.frustration || 0) > 0.4) frust++;
    }
    var col = (team.team_color) || '#8899aa';
    var chip = '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + col + ';margin-right:4px"></span>';
    var moraleCol = m > 0.15 ? '#51e08a' : m < -0.15 ? '#7fb2ff' : '#cdd6e6';
    var html = chip + '<span style="color:' + moraleCol + '">' + _mvMoraleIcon(m) + ' ' +
      _mvT('士気', 'Morale') + '</span>';
    if (frust > 0) {
      html += '<span style="color:#ff8f6b;margin-left:8px">😠 ' + frust + '</span>';
    }
    el.innerHTML = html;
  }

  // 結果まで一気に（残りチャンスを全計算して結果画面へ）。
  function _mvSkipToEnd() {
    _mvPause();
    _mvHideDecision();
    // 負傷交代（Sprint 2b）: スキップ中はユーザー采配を待てないので自動交代へフォールバック。
    //   保留中の要求も自動解決してから残りを計算する（負傷選手が残り試合を踏まないように）。
    if (typeof disciplineResolveUserSub === 'function' && gameState && gameState.team1) {
      disciplineResolveUserSub(gameState.team1, { auto: true });
    }
    if (typeof window !== 'undefined') window._mvSkipAutoInjury = true;
    while (!_mvCtrl.isOver()) { _mvCtrl.nextChance(); }
    if (typeof window !== 'undefined') window._mvSkipAutoInjury = false;
    var crs = _mvCtrl.result.chanceResults;
    chanceResults = crs.slice();
    currentChanceIdx = chanceResults.length;
    _mvFinish();
  }

  function _mvFinish() {
    _mvPause();
    _mvHideDecision();
    _mvShowControls(false);
    // 試合終了＝監督モード解除（リーグ経路だけでなく通常経路も）。true のまま残すと、
    // 次のプリマッチ設定画面が前試合の gameState（相手のライブ布陣）を誤参照する。
    _managerMode = false;
    // デイリーリーグ（league.js）が試合を起動していれば、専用の後処理へ委譲（WC結果画面は出さない）。
    if (typeof window !== 'undefined' && typeof window._leagueOnMatchFinish === 'function') {
      window._leagueOnMatchFinish();
      return;
    }
    if (typeof showResult === 'function') showResult();
  }

  /* ── 相手監督AI（アダプティブ采配）────────────────────────────────
   * 相手（team2 = away）がスコアと時間帯に応じて戦術を変更する。
   * 既存の createMatch.applyDecision（プレイヤーの采配と同じサンクション済みAPI）経由で、
   * デュエル解決式には一切触れない（tactics は既存パラメータ）。HT/得点時に評価。
   * ──────────────────────────────────────────────────────────────── */
  var _mvOpponentAI = true;
  var OPP_TACTIC_CHANCE = 0.25;   // 戦術変更の発動確率（条件成立時にこの確率で実行）
  function _mvTacName(idx) {
    if (typeof t === 'function') { var arr = t('tacticsNames'); if (arr && arr[idx]) return arr[idx]; }
    return (typeof TACTICS_NAMES !== 'undefined') ? TACTICS_NAMES[idx] : '';
  }
  function _mvOpponentReact() {
    if (!_mvOpponentAI || !_mvCtrl || !gameState || !gameState.team2) return;
    var diff = gameState.team2.score - gameState.team1.score;   // 相手(away)視点の点差
    var prog = (typeof MATCH_CHANCES !== 'undefined') ? currentChanceIdx / MATCH_CHANCES : 0;
    var cur = gameState.team2.tactics, target = null, label = '';
    if (diff <= -2) { target = TACTICS_PRESS; label = _mvT('前がかりに総攻撃', 'all-out attack'); }
    else if (diff === -1) { target = TACTICS_PRESS; label = _mvT('攻勢を強める', 'pushing forward'); }
    else if (diff >= 2) { target = TACTICS_COUNTER; label = _mvT('カウンターを狙う', 'counter-attacking'); }
    else if (diff === 1 && prog >= 0.8) { target = TACTICS_CATENACCIO; label = _mvT('守備を固める', 'locking it down'); }
    if (target == null || target === cur) return;
    if (Math.random() >= OPP_TACTIC_CHANCE) return;   // 発動確率（25%）
    if (_mvCtrl.applyDecision({ type: 'tactic', side: 'away', tactics: target })) {
      // MTG1案1: 演出系はトースト→実況ノート（相手の動き＝tone 'rival'）。
      _mvLiveNote('🧠 ' + _mvT('相手監督', 'Rival manager') + '：' + label + '（' + _mvTacName(target) + '）', 'rival');
    }
  }
  function _mvToast(msg) {
    var host = document.getElementById('screen-game'); if (!host) return;
    var el = document.getElementById('mv-toast');
    if (!el) {
      el = document.createElement('div'); el.id = 'mv-toast';
      el.style.cssText = 'position:absolute;top:70px;left:50%;transform:translateX(-50%);z-index:60;' +
        'background:rgba(15,20,32,0.92);border:1px solid rgba(232,119,111,0.6);color:#fff;' +
        'font-size:12px;font-weight:700;padding:8px 14px;border-radius:20px;max-width:90%;' +
        'box-shadow:0 4px 16px rgba(0,0,0,0.4);transition:opacity .35s;pointer-events:none;white-space:nowrap';
      host.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.style.opacity = '0'; }, 3200);
  }

  /* ── 実況ノート（MTG1 案1・2026-08-05）──────────────────────────────
   * 演出系メッセージ（⭐🗣⚡🧠🔁）はトースト（#mv-toast＝画像上部に被るピル）をやめ、
   * 下部LIVE実況フィードの「現在の実況行の下」に色付き補助行として出す。
   * アラート系（🚑負傷・⚠️エラー・🧪検証）は従来どおり _mvToast のまま。
   * tone: 'mine'＝自チームに良い出来事（金系）／'rival'＝相手の動き（赤系）。
   * ライフサイクル: 実況行と同じくフィードに「残す」（タイマー消去しない）。
   *   理由: フィードは下端追従スクロール＝次ビートで自然に上へ流れて主役を譲る。
   *   時限消去だと 2×/3× 再生で読み切れず、後からログを遡った時も行が虫食いになる。
   * 同一実況行の下に積めるのは最大2行（同時多発時は古い方から落とす）。
   * noLog=true は記録タブへの記帳を抑止（🔁相手交代＝既に _mvMatchSubs へ詳細文で記帳済み）。 */
  function _mvLiveNote(msg, tone, noLog) {
    var la = document.getElementById('log-area');
    var hosts = la ? la.getElementsByClassName('log-text') : null;
    var host = (hosts && hosts.length) ? hosts[hosts.length - 1] : null;
    if (!host) { _mvToast(msg); return; }   // フィード未生成（試合開始前）はトーストへフォールバック
    var notes = host.getElementsByClassName('mv-live-note');
    while (notes.length >= 2) host.removeChild(notes[0]);   // 最大2行（古い方から落とす）
    var rival = tone === 'rival';
    var line = document.createElement('div');
    line.className = 'mv-live-note';
    // 視認性: LIVEフィードのイベントカードは「明背景」（.log-event は白系）なので、
    // 濃色テキスト×淡色帯×左ボーダーで本文（暗色）と区別する（明背景に淡色文字は沈む＝実測済み）。
    line.style.cssText = 'margin:2px 0 8px;padding:3px 8px;border-radius:6px;font-size:12px;font-weight:800;line-height:1.5;' +
      'border-left:3px solid ' + (rival ? '#d84338' : '#e0a800') + ';' +
      'background:' + (rival ? 'rgba(224,90,80,0.13)' : 'rgba(255,193,7,0.16)') + ';' +
      'color:' + (rival ? '#b02a22' : '#8a6400');
    line.textContent = msg;
    host.appendChild(line);
    requestAnimationFrame(function () { la.scrollTop = la.scrollHeight; });   // 追加行まで見せる
    // 記録タブ（league.js _buildMatchLog）にも実況行として残す（交代記帳と同じ経路）。
    if (!noLog) {
      if (!window._mvMatchSubs) window._mvMatchSubs = [];
      // _buildMatchLog は chanceIdx===i+1 を「チャンスiの直後」に差し込む。チャンス途中の
      // ビート（currentChanceIdx がまだ当該チャンス C を指す）は +1 して C の本文の後に置く。
      var mid = (typeof currentSceneIdx !== 'undefined' && typeof _shootSubStep !== 'undefined' &&
                 (currentSceneIdx > 0 || _shootSubStep > 0));
      window._mvMatchSubs.push({
        chanceIdx: ((typeof currentChanceIdx !== 'undefined') ? currentChanceIdx : 0) + (mid ? 1 : 0),
        time: _mvTimeLabel(), text: msg, note: true, tone: rival ? 'rival' : 'mine'
      });
    }
  }

  /* ── 相手監督AI（選手交代）──────────────────────────────────────────
   * シチュエーション別ルール。既存 applyDecision(type:'sub') 経由（デュエル式不可侵）。
   * ⚠️ fatigue はエンジンの能力計算に未使用＝交代の実効果は「スロットの選手が別の
   *   params 選手に替わる」ことのみ。控えは通常先発より弱い → 能力差ガードで弱体化を防ぐ。
   * 調整可能な定数（しきい値）は下記。 */
  var OPP_MAX_SUBS = 3;              // 相手の交代人数上限
  var OPP_SUB_ATT_DOWNGRADE = 10;   // A 攻撃投入時の許容能力差（IN >= OUT - これ）
  var OPP_SUB_DEF_DOWNGRADE = 8;    // B 守備固め時
  var OPP_SUB_FRESH_DOWNGRADE = 6;  // C リフレッシュ時（ほぼ同格のみ）
  var OPP_FATIGUE_MIN = 6;          // C 発火に要する稼働量
  var _mvOppSubCount = 0;           // この試合で相手が使った交代人数
  var _mvOppOff = {};               // 相手が交代で退けた players index（再選出しない）
  var _mvOppIn = {};                // 相手が交代で投入した players index（＝再び交代でOUTしない）
  var _mvLateChecked = false;       // 後半終盤の単発チェック済みフラグ
  var _mvSubCutQueue = [];          // 交代カットシーン待ち行列 {out,in,teamColor,teamName,label}

  function _mvRating(p) { if (!p || !p.params) return 0; var s = 0; for (var i = 0; i < p.params.length; i++) s += p.params[i]; return s / p.params.length; }
  function _mvPosCat(role) {
    if (!role) return 'MF';
    if (role === 'GK') return 'GK';
    if (/CB|SB|SW/.test(role)) return 'DF';
    if (/WG|CF|FW/.test(role)) return 'FW';
    return 'MF';
  }
  function _mvSlotCat(team, pos) {
    var arr = (typeof system_data !== 'undefined' && system_data[team.system]) ? system_data[team.system].positions : null;
    return _mvPosCat(arr ? arr[pos] : '');
  }
  function _mvPlayerCats(p) { var c = {}; (p.positions || []).forEach(function (r) { c[_mvPosCat(r)] = true; }); return c; }
  function _mvBench(team) {
    var on = {}; team.lineup.forEach(function (idx) { on[idx] = true; });
    var res = [];
    for (var i = 0; i < team.players.length; i++) {
      if (on[i] || _mvOppOff[i]) continue;
      var bp = team.players[i];
      // 規律（Sprint 2）: 退場/負傷退出した選手は再投入不可（フラグは discipline.js 同梱時のみ付く）。
      if (bp && (bp._sentOff || bp._injured)) continue;
      if (team._discOff && team._discOff[i]) continue;
      res.push({ idx: i, p: bp, r: _mvRating(bp) });
    }
    return res;
  }
  function _mvName(p) { return (typeof getPlayerName === 'function') ? getPlayerName(p) : (p.name || ''); }

  // 相手(away)の選手交代を1件だけ評価・適用（A→B→C の優先）。atHT=ハーフタイム。
  function _mvOpponentSub(atHT) {
    if (!_mvOpponentAI || !_mvCtrl || !gameState || !gameState.team2) return false;
    if (_mvOppSubCount >= OPP_MAX_SUBS) return false;
    // 前半のプレー中は交代しない（現実的に稀）。交代はハーフタイム以降のみ。
    if (!atHT && typeof HALF_CHANCES !== 'undefined' && currentChanceIdx < HALF_CHANCES) return false;
    var team = gameState.team2;
    var diff = team.score - gameState.team1.score;                 // 相手(away)視点の点差
    var prog = (typeof MATCH_CHANCES !== 'undefined') ? currentChanceIdx / MATCH_CHANCES : 0;

    var slots = [];   // 出場中の非GKスロット
    for (var pos = 0; pos < team.lineup.length; pos++) {
      var cat = _mvSlotCat(team, pos); if (cat === 'GK') continue;
      // 規律（Sprint 2）: 退場/負傷除外スロットは交代で埋められない（AIのOUT候補から除外）。
      if (typeof disciplineIsOut === 'function' && disciplineIsOut(team, pos)) continue;
      var idx = team.lineup[pos], p = team.players[idx];
      if (!p) continue;
      if (_mvOppIn[idx]) continue;   // 交代で入った選手は再びOUTにしない（現実的に稀）
      slots.push({ pos: pos, idx: idx, p: p, r: _mvRating(p), cat: cat, fatigue: p.fatigue || 0 });
    }
    var bench = _mvBench(team);
    if (!slots.length || !bench.length) return false;
    // エース保護: 出場中の非GK最高評価選手は交代でOUTしない（現実の監督は主軸を残す）。
    //   同値は lineup 順で先。GK は元々交代対象外。
    var _aceIdx = -1, _aceR = -Infinity;
    for (var _si = 0; _si < slots.length; _si++) { if (slots[_si].r > _aceR) { _aceR = slots[_si].r; _aceIdx = slots[_si].idx; } }
    var outSlots = slots.filter(function (s) { return s.idx !== _aceIdx; });   // OUT候補＝エース以外
    if (!outSlots.length) return false;
    function bestBench(pred) { return bench.filter(pred).sort(function (a, b) { return b.r - a.r; })[0]; }
    // ★ 投入選手が「実際に守れるポジション」のスロットだけを OUT 候補にする（得意ポジション厳守）。
    //   これを守らないと FW を CB スロットへ入れる等の破綻が起きる（ユーザー指摘 2026-07-04）。
    //   catPref があればその順で優先（例: 攻撃投入は FW→MF の枠を空けたい）。守れる枠が無ければ null。
    function outSlotFor(inItem, catPref) {
      if (!inItem) return null;
      var cats = _mvPlayerCats(inItem.p);
      var elig = outSlots.filter(function (s) { return cats[s.cat]; });   // 投入選手が守れる枠のみ
      if (!elig.length) return null;
      if (catPref) {
        for (var ci = 0; ci < catPref.length; ci++) {
          var byCat = elig.filter(function (s) { return s.cat === catPref[ci]; });
          if (byCat.length) return byCat.sort(function (a, b) { return a.r - b.r; })[0];
        }
      }
      return elig.slice().sort(function (a, b) { return a.r - b.r; })[0];   // 最も評価の低い適格枠
    }

    var plan = null;

    // A. ビハインド → 攻撃投入（FW/攻撃的MFを投入。投入選手が守れる最弱枠と交代＝得意ポジ内）
    var behind = (diff <= -2 && (atHT || prog >= 0.55)) || (diff === -1 && (atHT || prog >= 0.65));
    if (behind) {
      var att = bestBench(function (b) { var c = _mvPlayerCats(b.p); return c['FW'] || c['MF']; });
      var outA = outSlotFor(att, ['FW', 'MF']);   // FW枠優先→無ければMF枠（DF枠には入れない）
      if (att && outA && att.r >= outA.r - OPP_SUB_ATT_DOWNGRADE) {
        plan = { out: outA, in: att, label: _mvT('攻撃の駒を投入', 'attacking change') };
      }
    }
    // B. リード → 守備固め（DF/守備的MFを投入。投入選手が守れる最弱枠と交代）
    if (!plan) {
      var lead = (diff >= 2 && prog >= 0.70) || (diff === 1 && prog >= 0.75);
      if (lead) {
        var def = bestBench(function (b) { var c = _mvPlayerCats(b.p); return c['DF'] || c['MF']; });
        var outB = outSlotFor(def, ['MF', 'DF']);   // MF枠優先→無ければDF枠（FW枠には入れない）
        if (def && outB && def.r >= outB.r - OPP_SUB_DEF_DOWNGRADE) {
          plan = { out: outB, in: def, label: _mvT('守備を厚くする', 'shoring up') };
        }
      }
    }
    // C. 均衡/リフレッシュ（最も稼働した選手を、そのポジを守れる控えで置換）
    if (!plan && (atHT || prog >= 0.60)) {
      var tired = outSlots.slice().sort(function (a, b) { return b.fatigue - a.fatigue; })[0];   // エース除く
      if (tired && tired.fatigue >= OPP_FATIGUE_MIN) {
        var same = bestBench(function (b) { return _mvPlayerCats(b.p)[tired.cat]; });   // 同カテゴリを守れる控え
        if (same && same.r >= tired.r - OPP_SUB_FRESH_DOWNGRADE) {
          plan = { out: tired, in: same, label: _mvT('新しい脚を投入', 'fresh legs') };
        }
      }
    }

    if (!plan) return false;
    if (!_mvCtrl.applyDecision({ type: 'sub', side: 'away', pos: plan.out.pos, 'in': plan.in.idx })) return false;
    _mvOppSubCount++;
    _mvOppOff[plan.out.idx] = true;
    _mvOppIn[plan.in.idx] = true;   // 投入した選手を記録＝以後の交代でOUT候補から除外
    // MTG1案1: 演出系はトースト→実況ノート。noLog=true（直下で _mvMatchSubs に詳細文を記帳済み）。
    _mvLiveNote('🔁 ' + _mvT('相手交代', 'Rival sub') + '：' + _mvName(plan.out.p) + ' → ' + _mvName(plan.in.p) + '（' + plan.label + '）', 'rival', true);
    if (window._mvMatchSubs) window._mvMatchSubs.push({
      chanceIdx: currentChanceIdx, time: _mvTimeLabel(),
      text: '🔁 ' + _mvT('交代', 'Sub') + '（' + getTeamName(team2Data) + '・' + plan.label + '）：' + _mvName(plan.out.p) + ' → ' + _mvName(plan.in.p)
    });
    _mvSubCutQueue.push({ out: _mvName(plan.out.p), in: _mvName(plan.in.p), teamColor: team2Data.team_color, teamName: getTeamName(team2Data), label: plan.label });
    return true;
  }

  // 自チーム交代（_pendingSubLog）をテキストログ用に記録（_insertSubLog の直前に呼ぶ）。
  function _mvRecordPlayerSubs(timeLabel) {
    if (typeof _pendingSubLog === 'undefined' || !_pendingSubLog || !_pendingSubLog.length) return;
    if (!window._mvMatchSubs) window._mvMatchSubs = [];
    _pendingSubLog.forEach(function (s) {
      var o = (_isEn() && s.outEn) ? s.outEn : s.out;
      var i = (_isEn() && s.inEn) ? s.inEn : s.in;
      window._mvMatchSubs.push({
        chanceIdx: currentChanceIdx, time: timeLabel,
        text: '🔁 ' + _mvT('交代', 'Sub') + '（' + getTeamName(team1Data) + '）：' + o + ' → ' + i
      });
      _mvSubCutQueue.push({ out: o, in: i, teamColor: team1Data.team_color, teamName: getTeamName(team1Data), label: '' });
    });
  }

  /* ── 交代カットシーン（画像なし・手続き描画。画像が来たら差し替え） ────────
   * 2026-07-04 ユーザー要望で「画面いっぱいのポップアップ」→「カットイン帯の中」に変更。
   *   #live-field-wrap（カットイン帯）の中に絶対配置で収める＝全画面を覆わない。
   *   背景は #mv-subcut-bg（画像スロット）。後日は bg.style.backgroundImage に PNG を差すだけ。 */
  function _mvRenderSubCutscene(batch) {
    var band = document.getElementById('live-field-wrap'); if (!band) return;
    band.style.display = '';   // カットイン帯を表示（枠内カットシーンの土台）
    var el = document.getElementById('mv-subcut');
    if (!el) {
      el = document.createElement('div'); el.id = 'mv-subcut';
      // ★ 全画面(inset:0 / #screen-game)ではなく、カットイン帯の中に収める。
      el.style.cssText = 'position:absolute;inset:0;z-index:6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;' +
        'opacity:0;transition:opacity .28s;pointer-events:none;padding:8px 10px;box-sizing:border-box;overflow:hidden';
      // 背景画像スロット（現状は手続きの暗幕。画像が来たら backgroundImage を差すだけ）。
      var bg = document.createElement('div'); bg.id = 'mv-subcut-bg';
      bg.style.cssText = 'position:absolute;inset:0;z-index:-1;background:radial-gradient(ellipse at center,rgba(10,20,42,0.93),rgba(3,7,15,0.97));background-size:cover;background-position:center';
      el.appendChild(bg);
      band.appendChild(el);
    }
    var head = '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:clamp(16px,4.6vw,22px);letter-spacing:2px;color:#cfe0ff;font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,.6)">🔁 ' + _mvT('選手交代', 'SUBSTITUTION') + '</div>';
    var cards = batch.map(function (s) {
      var col = s.teamColor || '#8899aa';
      return '<div style="background:rgba(0,0,0,0.34);border:1px solid ' + col + ';border-left:4px solid ' + col + ';border-radius:9px;padding:6px 16px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.4)">' +
        '<div style="font-size:10px;font-weight:700;color:' + col + ';margin-bottom:3px;letter-spacing:1px">' + (s.teamName || '') + (s.label ? ' ・ ' + s.label : '') + '</div>' +
        '<div style="font-size:clamp(13px,3.8vw,16px);font-weight:800;color:#ff6b6b">⬇ ' + s.out + '</div>' +
        '<div style="font-size:clamp(13px,3.8vw,16px);font-weight:800;color:#51e08a">⬆ ' + s.in + '</div>' +
        '</div>';
    }).join('');
    // bg は保持し、前面のコンテンツだけ差し替える。
    var content = document.getElementById('mv-subcut-content');
    if (!content) { content = document.createElement('div'); content.id = 'mv-subcut-content';
      content.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%'; el.appendChild(content); }
    content.innerHTML = head + cards;
    el.getBoundingClientRect();   // reflow → フェードイン
    el.style.opacity = '1';
  }
  function _mvHideSubCutscene() { var el = document.getElementById('mv-subcut'); if (el) el.style.opacity = '0'; }
  // 交代カットは「画像なしの仮版」のため当面ラボ限定（LEAGUE_TEST_MODE）。公開(football-sim.com)
  // では非表示＝交代自体/トースト/ログは出るがカットは出さない。実画像導入後にこのゲートを外す。
  function _mvSubCutEnabled() { return typeof window !== 'undefined' && window.LEAGUE_TEST_MODE === true; }
  // 待ち行列があれば ~2s 表示して done()。無ければ（or 公開では）即 done()。
  function _mvPlaySubCutscenes(done) {
    if (!_mvSubCutQueue.length || !_mvSubCutEnabled()) { _mvSubCutQueue = []; if (done) done(); return; }
    var batch = _mvSubCutQueue.slice(); _mvSubCutQueue = [];
    _mvRenderSubCutscene(batch);
    setTimeout(function () {
      _mvHideSubCutscene();
      setTimeout(function () { if (done) done(); }, 320);
    }, 2000);
  }

  /* ── スキル発動カットイン＋トースト（PS-05・鼓舞など）─────────────────
   * mental.js/simulate.js が res.mentalEvents に記録した skill_activate を購読し、
   *   失点シーン（ゴール余韻）の“後”に漫画的決めゴマ（_renderSkillActivateScene）と
   *   発動トーストを差し込む。エンジン不可侵＝表示のみ・rng 消費ゼロ。
   * キルスイッチ: window.SKILL_CUTIN_ENABLED===false（cutscene.js 側と同型）。 */
  var _mvSkillCutQueue = [];   // 発動カットイン待ち行列（events.js 正規化形 evt）
  var _mvSkillSeen = {};       // 再生済み skill_activate のキー（重複再生防止）
  function _mvSkillCutEnabled() {
    return typeof _skillCutinOn === 'function' ? _skillCutinOn()
      : (typeof window === 'undefined' || window.SKILL_CUTIN_ENABLED !== false);
  }
  // 現時点までに計算済みのチャンス結果から未再生の skill_activate を収集して待ち行列へ。
  //   raw mentalEvent {type,team:1|2,player,playerEn,skill} を events.js 正規化形へ写す。
  function _mvCollectSkillEvents() {
    if (typeof chanceResults === 'undefined' || !Array.isArray(chanceResults)) return;
    var upto = Math.min(currentChanceIdx, chanceResults.length - 1);
    for (var ci = 0; ci <= upto; ci++) {
      var r = chanceResults[ci];
      if (!r || !Array.isArray(r.mentalEvents)) continue;
      for (var i = 0; i < r.mentalEvents.length; i++) {
        var me = r.mentalEvents[i];
        if (!me || me.type !== 'skill_activate') continue;
        var key = ci + '|' + i + '|' + (me.skill || '') + '|' + (me.player || '');
        if (_mvSkillSeen[key]) continue;
        _mvSkillSeen[key] = true;
        _mvSkillCutQueue.push({
          team: me.team === 1 ? 'home' : me.team === 2 ? 'away' : null,
          player: me.player || null, playerEn: me.playerEn || null,
          skill: me.skill || null, detail: me.detail || null,
        });
      }
    }
  }
  // 発動カットインのラベル（トースト用・i18n・選手名置換）。
  function _mvSkillLabel(evt) {
    var en = _isEn();
    var pname = en ? (evt.playerEn || evt.player || '') : (evt.player || '');
    var def = (typeof SKILL_DEFS !== 'undefined' && SKILL_DEFS && SKILL_DEFS[evt.skill]) ? SKILL_DEFS[evt.skill] : null;
    var fb = (typeof _SKILL_LABEL_FALLBACK !== 'undefined' && _SKILL_LABEL_FALLBACK[evt.skill]) ? _SKILL_LABEL_FALLBACK[evt.skill] : null;
    var lbl = (def && def.label) || fb || { ja: String(evt.skill || ''), en: String(evt.skill || '') };
    return String(en ? lbl.en : lbl.ja).replace('{player}', pname).replace('｛選手｝', pname);
  }
  function _mvShowSkillCutin(evt) {
    var band = document.getElementById('live-field-wrap'); if (!band) return false;
    var c = (typeof _renderSkillActivateScene === 'function') ? _renderSkillActivateScene(evt) : null;
    if (!c) return false;
    band.style.display = '';
    var el = document.getElementById('mv-skillcut');
    if (!el) {
      el = document.createElement('div'); el.id = 'mv-skillcut';
      el.style.cssText = 'position:absolute;inset:0;z-index:7;display:flex;align-items:center;justify-content:center;' +
        'opacity:0;transition:opacity .28s;pointer-events:none;overflow:hidden;background:#070b13';
      band.appendChild(el);
    }
    el.innerHTML = '';
    c.style.width = '100%'; c.style.height = '100%';
    el.appendChild(c);
    el.getBoundingClientRect();   // reflow → フェードイン
    el.style.opacity = '1';
    // MTG1案1: 発動はトースト→実況ノート。鼓舞は相手選手でも発動する（実測: ベルギーのティーレマンス）
    // ので、evt.team で色を分ける（away＝相手の動き＝rival／それ以外＝mine）。
    _mvLiveNote('⚡ ' + _mvSkillLabel(evt), evt.team === 'away' ? 'rival' : 'mine');
    return true;
  }
  function _mvHideSkillCutin() { var el = document.getElementById('mv-skillcut'); if (el) el.style.opacity = '0'; }
  // 待ち行列を順に ~1.9s ずつ再生して done()。無効/空なら即 done()。
  function _mvPlaySkillCutscenes(done) {
    if (!_mvSkillCutEnabled() || !_mvSkillCutQueue.length) { _mvSkillCutQueue = []; if (done) done(); return; }
    var batch = _mvSkillCutQueue.slice(); _mvSkillCutQueue = [];
    (function step(i) {
      if (!_managerMode) { _mvHideSkillCutin(); return; }
      if (i >= batch.length) { _mvHideSkillCutin(); if (done) done(); return; }
      var shown = _mvShowSkillCutin(batch[i]);
      setTimeout(function () {
        _mvHideSkillCutin();
        setTimeout(function () { step(i + 1); }, shown ? 260 : 0);
      }, shown ? 1900 : 0);
    })(0);
  }

  // 相手監督の1停止点ぶんの判断（戦術＋交代）。
  function _mvOpponentDecide(atHT) { _mvOpponentReact(); _mvOpponentSub(!!atHT); }

  /* ── 采配ポイント（停止時パネル）──────────────────────────────────
   * kind: 'ht'（ハーフタイム）/ 'goal'（得点直後）/ 'manual'（任意停止）
   * ──────────────────────────────────────────────────────────────── */
  function _mvShowDecisionPoint(kind) {
    _mvEnsureUI();
    _mvLastKind = kind || 'manual';
    var panel = document.getElementById('mv-decision');
    if (!panel) return;
    var s = gameState ? { t1: gameState.team1.score, t2: gameState.team2.score } : { t1: 0, t2: 0 };

    var title, sub, contLabel;
    if (kind === 'ht') {
      title = _mvT('⏸ ハーフタイム', '⏸ Half Time');
      sub = _mvT('後半へ向けて采配を', 'Adjust before the second half');
      contLabel = _mvT('▶ 後半キックオフ', '▶ Kick off 2nd half');
    } else if (kind === 'goal') {
      title = _mvT('⚽ ゴール！', '⚽ GOAL!');
      sub = _mvT('流れが動いた。手を打つ？', 'Momentum shift — react?');
      contLabel = _mvT('▶ 続ける', '▶ Continue');
    } else {
      title = _mvT('⏸ 采配ポイント', '⏸ Decision Point');
      sub = _mvT('采配を調整', 'Adjust your plan');
      contLabel = _mvT('▶ 続ける', '▶ Continue');
    }

    var timeLabel = (chanceResults[currentChanceIdx - 1] && chanceResults[currentChanceIdx - 1].time) || '';
    document.getElementById('mv-dec-title').textContent = title;
    document.getElementById('mv-dec-sub').textContent = sub;
    document.getElementById('mv-dec-score').innerHTML =
      '<span style="opacity:.85">' + timeLabel + '</span>　' +
      team1Data.flag + ' ' + getTeamName(team1Data) + ' <b>' + s.t1 + ' - ' + s.t2 + '</b> ' +
      getTeamName(team2Data) + ' ' + team2Data.flag;
    document.getElementById('mv-dec-continue').textContent = contLabel;

    panel.style.display = 'flex';
  }
  function _mvHideDecision() {
    var panel = document.getElementById('mv-decision');
    if (panel) panel.style.display = 'none';
  }
  function _mvContinue() {
    _mvHideDecision();
    _mvResume();
  }

  /* ── ハーフタイム: 既存 HT モーダルを再利用（デュエル状況＋コーチ助言＋戦術）──
   * 戦術ボタン(_buildHtTactics)・設定画面(htOpenLineup)は team1State を編集する。
   * キックオフ（HTML: ht-btn-kickoff → closeHalfTimeModal → simulate.js の _managerMode 分岐で
   * _mvManagerHTKickoff に委譲）で team1State を live チームへ適用して後半再開。 */
  function _mvShowHT() {
    _mvLastKind = 'ht';
    // team1State を live team から同期（HT モーダルの戦術/設定編集の基点）。
    team1State = {
      systemIdx: gameState.team1.system,
      tactics: gameState.team1.tactics,
      keyplayer: gameState.team1.keyplayer,
      marked_player: gameState.team1.marked_player,
      captain: (typeof gameState.team1.captain === 'number') ? gameState.team1.captain : -1,
      lineup: gameState.team1.lineup.slice()
    };
    _mvShowControls(false);
    if (typeof _showHalfTimeModal === 'function') _showHalfTimeModal();
  }

  // 後半キックオフ（closeHalfTimeModal の _managerMode 分岐から呼ばれる）。
  function _mvManagerHTKickoff() {
    var modal = document.getElementById('halftime-modal');
    if (modal) modal.style.display = 'none';
    // team1State → live team（lineup を変える前に過去 scene を凍結）。
    _mvFreezePastScenes();
    var home = gameState.team1;
    home.system = team1State.systemIdx;
    home.tactics = team1State.tactics;
    home.keyplayer = team1State.keyplayer;
    home.marked_player = team1State.marked_player;
    home.lineup = team1State.lineup.slice();
    // キャプテン（2026-07-27）: 指名がスタメンから外れていたら自動選出に戻す。
    //   _captainIdx はキャッシュなので必ず落として次の参照で引き直させる。
    home.captain = effectiveCaptainIdx(team1State, home);
    home._captainIdx = undefined;
    subsCount += htSubsCount; htSubsCount = 0; _htMode = false;
    // 負傷交代の解決（Sprint 2b）: HT画面で交代済みなら続行、未交代なら10人で続行。
    if (typeof disciplineResolveUserSub === 'function' && gameState && gameState.team1) {
      var _rsHT = disciplineResolveUserSub(gameState.team1);
      if (_rsHT && _rsHT.resolved === 'excluded') {
        _mvToast('🚑 ' + _mvT('交代なし＝10人で続行', 'No sub — playing with 10'));
      }
    }
    // 交代ログ（_pendingSubLog → ログ・既存関数）。
    _mvRecordPlayerSubs(_mvT('ハーフタイム', 'Half Time'));   // テキストログ用に交代を記録
    if (typeof _insertSubLog === 'function') _insertSubLog(_mvT('ハーフタイム', 'Half Time'));
    // ★ _showHalfTimeModal が disabled にした next/all ボタンを再有効化する（Codex P2）。
    //   通常の closeHalfTimeModal はここで再有効化するが、監督分岐は早期 return で素通りするため、
    //   放置すると後続の通常試合で all-btn（結果を見る）が無効のまま残る。
    var _nb = document.getElementById('next-btn'); if (_nb) _nb.disabled = false;
    var _ab = document.getElementById('all-btn'); if (_ab) _ab.disabled = false;
    // MTG1-#2: 采配適用の瞬間を記録（直後のビートのドラマスコアを盛る・表示のみ）
    if (typeof dramaNoteIntervention === 'function') dramaNoteIntervention(currentChanceIdx);
    _toggleNormalControls(false);
    _mvShowControls(true);
    if (_mvSubCutQueue.length) _mvPlaySubCutscenes(function () { _mvResume(); });   // 自チーム交代のカット
    else _mvResume();
  }

  /* ── 采配（設定画面を再利用）─ T-11/T-12 ＋ システム/キープレイヤー/要注意/入替 ──
   * 設定画面の各セレクタ（openFormationSelect/openTacticsSelect/openKeyPlayerSelect/
   * openMarkedPlayerSelect）とドラッグ操作（renderFormation/renderBench/applyDrop）は
   * すべて team1State を編集する。采配を開く時に live チーム→team1State へ同期し、
   * 閉じる時に team1State→live チームへ適用する。 */
  function _mvOpenSetting() {
    // 采配パネル経由（HT/ゴール）なら _mvLastKind を維持し閉じた後そのパネルへ戻る。
    // ツールバーの「采配」から（采配パネル非表示時）は手動停止扱い＝古い停止種別を引き継がない
    //   （Codex P3: HT/ゴール後にツールバーで開くと閉じた後に誤って「ハーフタイム」等が出る問題）。
    var decEl = document.getElementById('mv-decision');
    var fromDecision = decEl && getComputedStyle(decEl).display === 'flex';
    if (!fromDecision) _mvLastKind = 'manual';

    _mvPause();
    _mvHideDecision();
    _mvShowControls(false);

    // live チーム → team1State へ同期（設定画面が現在の采配を反映するように）。
    team1State = {
      systemIdx: gameState.team1.system,
      tactics: gameState.team1.tactics,
      keyplayer: gameState.team1.keyplayer,
      marked_player: gameState.team1.marked_player,
      captain: (typeof gameState.team1.captain === 'number') ? gameState.team1.captain : -1,
      lineup: gameState.team1.lineup.slice()
    };

    _htMode = true;          // applyDrop に交代枠(最大5)管理＋再出場不可を効かせる
    htSubsCount = 0;

    renderFormation();
    renderBench();
    updateSettingBtnValues();
    applyLang();

    // キックオフ/多試合/監督ボタンを隠し、ヘッダーに「試合へ戻る」を差し込む（HT流用パターン）。
    document.getElementById('btn-kickoff-top').style.display = 'none';
    document.getElementById('btn-kickoff-bottom').closest('div').style.display = 'none';
    var bmgr = document.getElementById('btn-manager'); if (bmgr) bmgr.style.display = 'none';
    var bm = document.getElementById('btn-multi'); if (bm) bm.style.display = 'none';
    var bm100 = document.getElementById('btn-multi100'); if (bm100) bm100.style.display = 'none';

    /* MD-04c（2026-08-05）: リーグの試合中は**試合前と同じ3ゾーンUI**で采配する
     * （ユーザー要望「選手が選びづらい／試合前のUIをここにも」）。
     * 装飾できたときは主ボタン「▶ 試合へ戻る」を**下部コマンドバーに一本化**し、
     * ヘッダー（.league-prep では非表示）には同じボタンを挿さない＝重複ボタンを作らない。 */
    var _lgDeco = (typeof window.leagueDecorateSetting === 'function' &&
                   document.body && document.body.classList.contains('league-mode'));

    var header = document.querySelector('#screen-setting .screen-header');
    if (header) {
      var origBack = header.querySelector('.back-btn:not(#mv-setting-back)');
      if (origBack) origBack.style.display = 'none';
      if (!_lgDeco && !document.getElementById('mv-setting-back')) {
        var bb = document.createElement('button');
        bb.className = 'back-btn';
        bb.id = 'mv-setting-back';
        bb.textContent = _mvT('▶ 試合へ戻る', '▶ Back to match');
        bb.onclick = _mvCloseSetting;
        header.insertBefore(bb, header.firstChild);
      }
    }

    // 3ゾーン化（先に走らせて下部バーを用意する＝交代枠ラベルの引越し先になる）
    if (_lgDeco) window.leagueDecorateSetting(true, { mode: 'match', status: _mvSettingStatus() });

    // 交代枠ラベル（既存 _updateHtSubsLabel を流用）。装飾中は下部バーの枠内へ、
    // 非装飾（シングル/W杯）は従来どおり控えリストの上へ。
    var subLabel = document.getElementById('ht-subs-label');
    if (!subLabel) {
      subLabel = document.createElement('div');
      subLabel.id = 'ht-subs-label';
      subLabel.style.cssText = 'font-size:12px;color:#9fb0c9;text-align:center;padding:4px 0 8px';
    }
    var _subSlot = document.getElementById('lg-prep-subs');
    if (_subSlot) _subSlot.appendChild(subLabel);
    else if (!subLabel.parentNode) {
      var benchEl = document.getElementById('bench-list');
      if (benchEl && benchEl.parentNode) benchEl.parentNode.insertBefore(subLabel, benchEl);
    }
    if (typeof _updateHtSubsLabel === 'function') _updateHtSubsLabel();

    _mvSyncInjuryBanner();   // 負傷交代の要求があれば選手名バナーを出す（Sprint 2b）

    showScreen('setting');
  }

  /* MD-04c: 采配画面の下部バー左端に出す「戦況」（時間＋スコア）。
   * 采配中は試合が止まっているので開いた時点の静的スナップショットでよい。
   * ★ 3ゾーンUIはヘッダーを畳む＝この画面で唯一の「今の状況」表示になるので必須。 */
  function _mvSettingStatus() {
    var s1 = (gameState && gameState.team1) ? gameState.team1.score : 0;
    var s2 = (gameState && gameState.team2) ? gameState.team2.score : 0;
    var tm = _mvTimeLabel();
    return (tm ? '<span class="lgp-st-time">' + tm + '</span>' : '') +
      '<span class="lgp-st-score">' + (team1Data.flag || '') +
      '<b>' + s1 + '</b><i>-</i><b>' + s2 + '</b>' + (team2Data.flag || '') + '</span>';
  }

  // 負傷交代バナー（Sprint 2b・lab）: 重症負傷で交代画面が開いた時、対象選手を明示する。
  //   ピッチ上の🚑赤リングと合わせて「誰を交代するか」を確実に伝える。要求が無ければ隠す。
  function _mvSyncInjuryBanner() {
    /* ★ 2026-08-05: 挿入先は **ピッチ枠（.field-container）の手前**。
     *   以前は #formation-display（＝ピッチ枠の“中”）の前に入れていたため、バナーが
     *   芝の上に重なり、絶対配置の選手カードに食われて読めなかった。 */
    var host = document.querySelector('#screen-setting .field-container') ||
               document.querySelector('#screen-setting .formation-wrap') ||
               document.getElementById('formation-display');
    var banner = document.getElementById('mv-injury-banner');
    var req = (typeof disciplinePendingUserSub === 'function' && gameState && gameState.team1)
      ? disciplinePendingUserSub(gameState.team1) : null;
    if (!req) { if (banner) banner.style.display = 'none'; return; }
    var injP = gameState.team1.players[req.outIdx];
    var nm = injP ? _mvName(injP) : '?';
    if (!banner && host && host.parentNode) {
      banner = document.createElement('div');
      banner.id = 'mv-injury-banner';
      banner.style.cssText = 'margin:8px 10px;padding:10px 12px;border-radius:10px;' +
        'background:rgba(220,59,59,.16);border:1px solid rgba(255,90,90,.5);' +
        'color:#ffd7d7;font-size:13px;font-weight:700;text-align:center;line-height:1.5;';
      host.parentNode.insertBefore(banner, host);
    }
    if (banner) {
      banner.innerHTML = '🚑 ' + _mvT(
        '<b style="color:#fff">' + nm + '</b> が負傷しました。ピッチで赤く光る選手です。ベンチから交代してください（交代しない場合は10人で続行）。',
        '<b style="color:#fff">' + nm + '</b> is injured (pulsing red on the pitch). Sub from the bench, or continue with 10.');
      banner.style.display = 'block';
    }
  }

  function _mvCloseSetting() {
    _htMode = false;

    // ★ lineup を変える前に過去 scene を凍結（得点者の誤帰属防止）。
    _mvFreezePastScenes();

    // team1State → live チームへ適用（次チャンス以降に反映）。
    var home = gameState.team1;
    home.system = team1State.systemIdx;
    home.tactics = team1State.tactics;
    home.keyplayer = team1State.keyplayer;
    home.marked_player = team1State.marked_player;
    home.lineup = team1State.lineup.slice();
    // キャプテン（2026-07-27）: 指名がスタメンから外れていたら自動選出に戻す。
    //   _captainIdx はキャッシュなので必ず落として次の参照で引き直させる。
    home.captain = effectiveCaptainIdx(team1State, home);
    home._captainIdx = undefined;

    // 交代枠の消費を反映（表示用）。
    subsCount += htSubsCount;
    htSubsCount = 0;

    // 負傷交代の解決（Sprint 2b）: 交代画面でユーザーが交代済みなら続行、
    // 未交代（枠切れ/選択せず）なら退場と同じ除外＝10人で続行。
    if (typeof disciplineResolveUserSub === 'function' && gameState && gameState.team1) {
      var _rs = disciplineResolveUserSub(gameState.team1);
      if (_rs && _rs.resolved === 'excluded') {
        _mvToast('🚑 ' + _mvT('交代なし＝10人で続行', 'No sub — playing with 10'));
      }
    }

    // 交代ログをテキストログへ挿入（_pendingSubLog → ログ・既存関数）。
    _mvRecordPlayerSubs(_mvTimeLabel());   // テキストログ用に交代を記録
    if (typeof _insertSubLog === 'function') _insertSubLog(_mvTimeLabel());

    // 負傷バナーはこのパネル専用＝閉じたら必ず畳む（次に開く画面に古い文言を残さない）。
    var _ib = document.getElementById('mv-injury-banner'); if (_ib) _ib.style.display = 'none';

    // MD-04c: 3ゾーン装飾を必ず剥がす（共有DOM＝シングル/W杯/HTモーダルへ漏らさない）。
    //   非装飾で開いていた場合も no-op で安全なので無条件に呼ぶ。
    if (typeof window.leagueDecorateSetting === 'function') window.leagueDecorateSetting(false);

    // 設定画面のクロームを元に戻す。
    var header = document.querySelector('#screen-setting .screen-header');
    if (header) {
      var bb = document.getElementById('mv-setting-back');
      if (bb) header.removeChild(bb);
      var origBack = header.querySelector('.back-btn');
      if (origBack) origBack.style.display = '';
    }
    document.getElementById('btn-kickoff-top').style.display = '';
    document.getElementById('btn-kickoff-bottom').closest('div').style.display = '';
    var bmgr = document.getElementById('btn-manager'); if (bmgr) bmgr.style.display = '';
    var bm = document.getElementById('btn-multi'); if (bm) bm.style.display = '';
    var bm100 = document.getElementById('btn-multi100'); if (bm100) bm100.style.display = '';
    var sl = document.getElementById('ht-subs-label'); if (sl && sl.parentNode) sl.parentNode.removeChild(sl);

    // MTG1-#2: 采配適用の瞬間を記録（直後のビートのドラマスコアを盛る・表示のみ）
    if (typeof dramaNoteIntervention === 'function') dramaNoteIntervention(currentChanceIdx);

    // 試合画面へ戻り、そのまま自動再生を再開（采配ポイントの確認パネルは廃止＝余計な1クリック削減）。
    showScreen('game');
    _mvShowControls(true);
    if (_mvSubCutQueue.length) _mvPlaySubCutscenes(function () { _mvResume(); });   // 自チーム交代のカット → 続行
    else _mvResume();
  }

  /* ── トースト／ログ ────────────────────────────────────────────── */
  function _mvLog(text) {
    var logArea = document.getElementById('log-area');
    if (!logArea) return;
    var div = document.createElement('div');
    div.className = 'log-event';
    div.style.cssText = 'background:linear-gradient(135deg,#0a2a5c,#0d4a28);color:#fff;border-left:4px solid #f39c12;padding:8px 12px;border-radius:8px;margin:6px 0;font-size:13px;font-weight:700';
    div.textContent = text;
    logArea.appendChild(div);
    requestAnimationFrame(function () { logArea.scrollTop = logArea.scrollHeight; });
  }

  /* ── UI 注入（コントロールバー／采配パネル）──────────────────────── */
  function _mvShowControls(show) {
    var bar = document.getElementById('mv-controls');
    if (bar) bar.style.display = show ? 'flex' : 'none';
  }
  function _mvUpdateControlBar() {
    // ⏯＝自動再生トグル。ON の間は「次へ」と速度の役割が入れ替わる。
    var pp = document.getElementById('mv-pp');
    if (pp) {
      pp.textContent = _mvAuto ? '⏸' : '▶▶';
      pp.title = _mvAuto ? _mvT('自動再生を止める', 'Stop autoplay')
                         : _mvT('自動再生にする', 'Play automatically');
      pp.classList.toggle('on', !!_mvAuto);
    }
    // 「次へ」は手動送り専用。自動再生中は押せない（押せると二重送りになる）。
    var nx = document.getElementById('mv-next');
    if (nx) { nx.disabled = !!_mvAuto; nx.classList.toggle('off', !!_mvAuto); }
    // 速度は自動再生中しか意味を持たない。
    var sp = document.getElementById('mv-speed');
    if (sp) {
      sp.textContent = (_mvSpeedIdx + 1) + '×';
      sp.disabled = !_mvAuto; sp.classList.toggle('off', !_mvAuto);
    }
  }

  function _mvEnsureUI() {
    var host = document.getElementById('screen-game');
    if (!host) return;
    var curLang = _isEn() ? 'en' : 'ja';
    var existing = document.getElementById('mv-controls');
    if (existing) {
      if (_mvUiLang === curLang) return;
      // 言語が変わったので静的ラベルを作り直す。
      ['mv-controls', 'mv-decision'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
    }
    _mvUiLang = curLang;

    if (!document.getElementById('mv-style')) {
      var st = document.createElement('style');
      st.id = 'mv-style';
      st.textContent = [
        /* ── コントロールバー＝下端の"操作シェルフ"（作り込まれたモバイルゲームHUDと同質感）── */
        '#mv-controls{position:sticky;bottom:0;left:0;right:0;display:none;',
        'gap:clamp(7px,2.2vw,11px);align-items:stretch;justify-content:center;z-index:30;',
        'padding:clamp(9px,2.6vw,13px) clamp(11px,3.6vw,18px) calc(clamp(9px,2.6vw,13px) + env(safe-area-inset-bottom,0px));',
        'background:linear-gradient(0deg,#050a14 0%,rgba(6,11,22,.96) 62%,rgba(6,11,22,.72) 100%);',
        'border-top:1px solid rgba(255,255,255,.10);box-shadow:0 -10px 28px rgba(0,0,0,.5)}',
        /* 共通ボタン：ピル状・44px 以上・内側ハイライト＋下影で立体感 */
        '.mv-btn{appearance:none;-webkit-appearance:none;box-sizing:border-box;',
        'display:flex;align-items:center;justify-content:center;gap:.4em;',
        'border:1px solid rgba(255,255,255,.16);background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.03));',
        'color:#eaf1ff;font-family:inherit;font-weight:800;letter-spacing:.02em;',
        'border-radius:14px;padding:0 clamp(11px,3.4vw,16px);min-height:clamp(46px,12.6vw,52px);',
        'font-size:clamp(13px,3.6vw,15px);line-height:1;cursor:pointer;white-space:nowrap;',
        'box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 2px 6px rgba(0,0,0,.32);',
        'transition:transform .08s ease,filter .12s ease}',
        '.mv-btn:active{transform:translateY(1px) scale(.985);filter:brightness(.94)}',
        /* 「次へ」＝主役：緑グラデ＋発光、幅を持たせて構図の重心に（既定は手動送り） */
        '.mv-btn-main{flex:0 0 auto;min-width:clamp(88px,26vw,132px);',
        'font-size:clamp(15px,4.2vw,19px);color:#fff;letter-spacing:.5px;',
        'background:linear-gradient(180deg,#25a355,#178040);border-color:rgba(255,255,255,.28);',
        'box-shadow:inset 0 1px 0 rgba(255,255,255,.34),0 4px 14px rgba(23,128,64,.45)}',
        /* 自動再生トグル。ON の間だけ点灯させて「今は勝手に進む」を明示する */
        '.mv-btn-auto{flex:0 0 auto;min-width:clamp(46px,12vw,56px);color:#cfe0f5;',
        'font-size:clamp(14px,3.8vw,17px);',
        'background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));',
        'box-shadow:inset 0 2px 5px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.06)}',
        '.mv-btn-auto.on{color:#fff;background:linear-gradient(180deg,#2f6fd0,#1f4f9c);',
        'border-color:rgba(255,255,255,.30);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 3px 12px rgba(47,111,208,.45)}',
        /* 速度＝トグル感（内側に沈んだ地＋数字を明るく） */
        '.mv-btn-speed{flex:0 0 auto;min-width:clamp(44px,12vw,54px);color:#9fe0ff;',
        'font-size:clamp(15px,4.2vw,17px);font-weight:900;font-variant-numeric:tabular-nums;',
        'background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));',
        'box-shadow:inset 0 2px 5px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.06)}',
        /* 無効中（手動なら速度・自動なら次へ）は沈めて押せないことを示す */
        '.mv-btn.off{opacity:.34;filter:saturate(.4);cursor:default}',
        '.mv-btn.off:active{transform:none;filter:saturate(.4)}',
        /* 采配＝アクセント（琥珀） */
        '.mv-btn-int{flex:0 1 auto;color:#ffdf9e;',
        'background:linear-gradient(180deg,rgba(243,156,18,.24),rgba(243,156,18,.10));',
        'border-color:rgba(243,156,18,.55);',
        'box-shadow:inset 0 1px 0 rgba(255,224,150,.22),0 2px 8px rgba(243,156,18,.22)}',
        /* 結果＝控えめ（地に沈める） */
        '.mv-btn-ghost{flex:0 1 auto;color:#9fb0c9;border-color:rgba(255,255,255,.10);',
        'background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015));box-shadow:none}',
        '.mv-btn-ic{font-size:1.05em;opacity:.95}',
        /* ── 采配ポイント・モーダル（角丸パネル／上質な奥行き／タイポ階層）── */
        '#mv-decision{display:none;position:absolute;inset:0;z-index:40;flex-direction:column;',
        'align-items:center;justify-content:center;',
        'background:radial-gradient(120% 90% at 50% 40%,rgba(3,8,20,.78),rgba(2,6,16,.9));',
        '-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);',
        'padding:clamp(18px,5vw,26px);text-align:center;animation:mvDecIn .28s ease}',
        '@keyframes mvDecIn{from{opacity:0}to{opacity:1}}',
        '.mv-card{position:relative;box-sizing:border-box;width:min(92%,392px);',
        'padding:clamp(20px,5.6vw,28px) clamp(18px,5vw,24px) clamp(16px,4.4vw,22px);',
        'border-radius:clamp(18px,4.8vw,22px);',
        'background:linear-gradient(165deg,#0b2a54 0%,#0a2340 46%,#0b3324 100%);',
        'border:1px solid rgba(255,255,255,.14);',
        'box-shadow:0 24px 60px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.12);',
        'animation:mvCardIn .32s cubic-bezier(.2,.9,.3,1.1)}',
        '@keyframes mvCardIn{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}',
        /* カード上端のアクセントライン（額縁の"きらめき"） */
        '.mv-card::before{content:"";position:absolute;left:clamp(18px,5vw,24px);right:clamp(18px,5vw,24px);top:0;height:2px;',
        'background:linear-gradient(90deg,transparent,rgba(143,211,255,.7),rgba(255,223,158,.7),transparent);border-radius:2px}',
        '#mv-dec-title{font-size:clamp(21px,6vw,25px);font-weight:900;color:#fff;line-height:1.15;',
        'margin-bottom:clamp(4px,1.4vw,7px);letter-spacing:.01em;text-shadow:0 2px 10px rgba(0,0,0,.4)}',
        '#mv-dec-sub{font-size:clamp(12px,3.4vw,13.5px);color:#b9cdf0;margin-bottom:clamp(12px,3.4vw,16px);line-height:1.4}',
        /* スコアは"帯"に載せて情報を締める */
        '#mv-dec-score{display:inline-flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:.5em;',
        'font-size:clamp(13px,3.8vw,15px);color:#eaf1ff;line-height:1.4;',
        'margin:0 auto clamp(16px,4.4vw,20px);padding:clamp(8px,2.4vw,11px) clamp(12px,3.4vw,16px);',
        'background:rgba(3,8,18,.5);border:1px solid rgba(255,255,255,.10);border-radius:12px}',
        '#mv-dec-score b{font-size:1.24em;font-weight:900}',
        '.mv-dec-row{display:flex;gap:clamp(8px,2.6vw,11px);justify-content:center;align-items:stretch}',
        '.mv-dec-row .mv-btn-main{min-width:clamp(60px,18vw,74px)}'
      ].join('');
      document.head.appendChild(st);
    }

    // コントロールバー（▶/⏸・速度・采配・結果）。
    var bar = document.createElement('div');
    bar.id = 'mv-controls';
    bar.innerHTML =
      // ★ 主操作は「次へ」＝1タップ1ビートの手動送り（既定）。⏯ は自動再生の ON/OFF。
      '<button class="mv-btn mv-btn-main" id="mv-next" onclick="_mvNext()" aria-label="' + _mvT('次へ', 'Next') + '">' +
        _mvT('次へ ▶', 'Next ▶') + '</button>' +
      '<button class="mv-btn mv-btn-auto" id="mv-pp" onclick="_mvTogglePlay()" aria-label="' + _mvT('自動再生', 'Autoplay') + '">▶▶</button>' +
      '<button class="mv-btn mv-btn-speed" id="mv-speed" onclick="_mvCycleSpeed()" aria-label="' + _mvT('再生速度', 'Playback speed') + '">1×</button>' +
      '<button class="mv-btn mv-btn-int" onclick="_mvOpenSetting()"><span class="mv-btn-ic">📋</span>' + _mvT('采配', 'Plan') + '</button>' +
      // 規律テストトグル: discipline.js 同梱時（＝lab）のみ表示。カード/退場/怪我を多発させて検証。
      ((typeof disciplineToggleTest === 'function')
        ? '<button class="mv-btn mv-btn-ghost" id="mv-disctest" onclick="_mvToggleDiscTest()" title="' +
          _mvT('カード・怪我を多発（検証用）', 'Force cards/injuries (test)') + '">🧪</button>'
        : '') +
      '<button class="mv-btn mv-btn-ghost" onclick="_mvSkipToEnd()"><span class="mv-btn-ic">⏭</span>' + _mvT('結果', 'Result') + '</button>';
    host.appendChild(bar);
    _mvSyncDiscTestBtn();
    // MTG1-#2 hold-to-skim 帯（バー内の全幅行として注入。dramascore.js 非同梱/キルOFFは何も出ない）
    if (typeof dramaEnsureSkimUI === 'function') dramaEnsureSkimUI();

    // 采配パネル（采配する／続ける）。
    var dec = document.createElement('div');
    dec.id = 'mv-decision';
    dec.innerHTML =
      '<div class="mv-card">' +
      '<div id="mv-dec-title"></div>' +
      '<div id="mv-dec-sub"></div>' +
      '<div id="mv-dec-score"></div>' +
      '<div class="mv-dec-row">' +
      '<button class="mv-btn mv-btn-int" onclick="_mvOpenSetting()">📋 ' + _mvT('采配する', 'Make changes') + '</button>' +
      '<button class="mv-btn mv-btn-main" id="mv-dec-continue" onclick="_mvContinue()">▶</button>' +
      '</div></div>';
    host.appendChild(dec);
  }

  // 規律テストトグル（lab専用・🧪ボタン）: カード/退場/怪我を多発させ、1試合で全パターンを目視。
  //   次に開始する試合から効く（進行中の試合の確率は既に確定済みのため）。
  function _mvToggleDiscTest() {
    if (typeof disciplineToggleTest !== 'function') return;
    var on = disciplineToggleTest();
    _mvSyncDiscTestBtn();
    _mvToast(on
      ? '🧪 ' + _mvT('検証モードON：次の試合からカード・怪我が多発します', 'Test mode ON: cards/injuries frequent from next match')
      : '🧪 ' + _mvT('検証モードOFF（通常の発生率に戻ります）', 'Test mode OFF (normal rates)'));
  }
  function _mvSyncDiscTestBtn() {
    var b = document.getElementById('mv-disctest');
    if (!b || typeof disciplineTestOn !== 'function') return;
    var on = disciplineTestOn();
    b.style.background = on ? 'rgba(220,80,80,.28)' : '';
    b.style.borderColor = on ? 'rgba(255,120,120,.55)' : '';
    b.style.color = on ? '#ffd7d7' : '';
    b.title = on ? _mvT('検証モードON（タップで解除）', 'Test mode ON (tap to disable)')
                 : _mvT('カード・怪我を多発（検証用）', 'Force cards/injuries (test)');
  }

  // startGame からの復帰時の後始末（simulate.js が参照）。
  function _mvTeardownUI() {
    _mvPause();
    _mvHideDecision();
    _mvShowControls(false);
    _toggleNormalControls(true);
    // HT モーダル経由で disabled のまま抜けた場合に備え再有効化（Codex P2 の保険）。
    var _nb = document.getElementById('next-btn'); if (_nb) _nb.disabled = false;
    var _ab = document.getElementById('all-btn'); if (_ab) _ab.disabled = false;
    var _modal = document.getElementById('halftime-modal'); if (_modal) _modal.style.display = 'none';
  }

  // ── グローバル公開（HTML onclick / simulate.js から参照）──────────
  var g = (typeof window !== 'undefined') ? window : this;
  g.startManagerMatch = startManagerMatch;
  g._mvTogglePlay = _mvTogglePlay;
  g._mvNext = _mvNext;            // 手動送り（HTML onclick から呼ぶ）
  g._mvSkimTick = _mvSkimTick;    // MTG1-#2 hold-to-skim（dramascore.js から）
  g._mvSkimEnd = _mvSkimEnd;      // MTG1-#2 hold-to-skim 終了時の後始末
  g._mvCycleSpeed = _mvCycleSpeed;
  g._mvOpenSetting = _mvOpenSetting;
  g._mvCloseSetting = _mvCloseSetting;
  g._mvSkipToEnd = _mvSkipToEnd;
  g._mvContinue = _mvContinue;
  g._mvToggleDiscTest = _mvToggleDiscTest;
  g._mvManagerHTKickoff = _mvManagerHTKickoff;
  g._mvLiveNote = _mvLiveNote;    // MTG1案1: 実況ノート（他表示層・ラボ検証から呼べるように公開）
  g._mvTeardownUI = _mvTeardownUI;
  g._mvOpponentReact = _mvOpponentReact;   // デバッグ/検証用ハンドル
  g._mvOpponentSub = _mvOpponentSub;       // デバッグ/検証用ハンドル
  g._mvRenderSubCutscene = _mvRenderSubCutscene;   // デバッグ/検証用ハンドル
  g._mvPlaySubCutscenes = _mvPlaySubCutscenes;     // デバッグ/検証用ハンドル
  g._mvPlaySkillCutscenes = _mvPlaySkillCutscenes; // デバッグ/検証用ハンドル（PS-05）
  g._mvShowSkillCutin = _mvShowSkillCutin;         // デバッグ/検証用ハンドル（PS-05）
})();
