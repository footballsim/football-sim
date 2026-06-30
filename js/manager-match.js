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

  // ── 自動再生の状態（このモジュール内のみ）────────────────────────────
  var _mvPlaying = false;     // 自動再生中か
  var _mvTimer = null;        // setTimeout ハンドル
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
        var of = (PLAYER_EXTRA[p.name] && PLAYER_EXTRA[p.name].of)
          ? PLAYER_EXTRA[p.name].of
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
    _subbedOff = new Set();
    _pendingSubLog = [];
    _shootSubStep = 0;
    _pendingCoachCardEl = null;
    coachMarkTarget = -1;   // gameState 構築後に startGame 同様セット（コーチの指摘用）

    // createMatch コントローラ（home=team1 / away=team2）。未シード＝毎回フレッシュな試合。
    _mvCtrl = createMatch(team1Data, team2Data, { home: team1State, away: team2State });
    _managerMode = true;
    _mvGoalShown = false;
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

    _mvPlay();   // キックオフ後すぐ自動再生
  }

  function _toggleNormalControls(show) {
    ['next-btn', 'all-btn', 'sub-btn'].forEach(function (id) {
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
  function _mvTogglePlay() {
    if (_mvPlaying) { _mvPause(); }
    else { _mvHideDecision(); _mvPlay(); }
  }
  function _mvCycleSpeed() {
    _mvSpeedIdx = (_mvSpeedIdx + 1) % _MV_SPEEDS.length;
    _mvUpdateControlBar();
  }

  // 1ティック = 1ビート進める。HT/ゴール/終了で自動停止。
  function _mvTick() {
    _mvTimer = null;
    if (!_managerMode || !_mvPlaying) return;
    if (!_gameActive()) { _mvPause(); return; }   // 画面遷移時はタイマー停止

    if (_mvCtrl.isOver() && currentChanceIdx >= chanceResults.length) { _mvFinish(); return; }

    _mvGoalShown = false;
    nextChance();                       // 1ビート進める（内部で createMatch から遅延フェッチ）
    _mvSyncHud();

    // ハーフタイム停止（前半ロスタイム完了＝currentChanceIdx===HALF_CHANCES の瞬間・1回のみ）。
    if (currentChanceIdx === HALF_CHANCES && !halfTimeShown && currentSceneIdx === 0 && _shootSubStep === 0) {
      halfTimeShown = true;
      var htRes = chanceResults[HALF_CHANCES - 1] || chanceResults[HALF_CHANCES - 2];
      if (htRes) halfTimeScore = { t1: htRes.t1score, t2: htRes.t2score };
      _mvPause();
      setTimeout(function () { if (_managerMode) _mvShowHT(); }, 350);
      return;
    }

    // ゴール停止（カットシーンの余韻を見せてから采配パネル）。
    if (_mvGoalShown) {
      _mvPause();
      setTimeout(function () { if (_managerMode) _mvShowDecisionPoint('goal'); }, 3300);
      return;
    }

    if (_mvCtrl.isOver() && currentChanceIdx >= chanceResults.length) { _mvFinish(); return; }

    _mvTimer = setTimeout(_mvTick, _mvSpeed());
  }

  function _mvSyncHud() {
    var cc = document.getElementById('chance-count');
    if (cc) cc.textContent = Math.min(currentChanceIdx, _mvCtrl.getState().n);
  }

  // 結果まで一気に（残りチャンスを全計算して結果画面へ）。
  function _mvSkipToEnd() {
    _mvPause();
    _mvHideDecision();
    while (!_mvCtrl.isOver()) { _mvCtrl.nextChance(); }
    var crs = _mvCtrl.result.chanceResults;
    chanceResults = crs.slice();
    currentChanceIdx = chanceResults.length;
    _mvFinish();
  }

  function _mvFinish() {
    _mvPause();
    _mvHideDecision();
    _mvShowControls(false);
    if (typeof showResult === 'function') showResult();
  }

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
    _mvPlay();
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
    subsCount += htSubsCount; htSubsCount = 0; _htMode = false;
    // 交代ログ（_pendingSubLog → ログ・既存関数）。
    if (typeof _insertSubLog === 'function') _insertSubLog(_mvT('ハーフタイム', 'Half Time'));
    _toggleNormalControls(false);
    _mvShowControls(true);
    _mvPlay();
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

    var header = document.querySelector('#screen-setting .screen-header');
    if (header) {
      var origBack = header.querySelector('.back-btn:not(#mv-setting-back)');
      if (origBack) origBack.style.display = 'none';
      if (!document.getElementById('mv-setting-back')) {
        var bb = document.createElement('button');
        bb.className = 'back-btn';
        bb.id = 'mv-setting-back';
        bb.textContent = _mvT('▶ 試合へ戻る', '▶ Back to match');
        bb.onclick = _mvCloseSetting;
        header.insertBefore(bb, header.firstChild);
      }
    }
    // 交代枠ラベル（既存 _updateHtSubsLabel を流用）。
    if (!document.getElementById('ht-subs-label')) {
      var subLabel = document.createElement('div');
      subLabel.id = 'ht-subs-label';
      subLabel.style.cssText = 'font-size:12px;color:#888;text-align:center;padding:4px 0 8px';
      var benchEl = document.getElementById('bench-list');
      if (benchEl && benchEl.parentNode) benchEl.parentNode.insertBefore(subLabel, benchEl);
    }
    if (typeof _updateHtSubsLabel === 'function') _updateHtSubsLabel();

    showScreen('setting');
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

    // 交代枠の消費を反映（表示用）。
    subsCount += htSubsCount;
    htSubsCount = 0;

    // 交代ログをテキストログへ挿入（_pendingSubLog → ログ・既存関数）。
    if (typeof _insertSubLog === 'function') _insertSubLog(_mvTimeLabel());

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

    // 試合画面へ戻り、采配ポイントパネルを再表示（続ける/後半キックオフ待ち）。
    showScreen('game');
    _mvShowControls(true);
    _mvShowDecisionPoint(_mvLastKind || 'manual');
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
    var pp = document.getElementById('mv-pp');
    if (pp) pp.textContent = _mvPlaying ? '⏸' : '▶';
    var sp = document.getElementById('mv-speed');
    if (sp) sp.textContent = (_mvSpeedIdx + 1) + '×';
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
        '#mv-controls{position:sticky;bottom:0;left:0;right:0;display:none;gap:8px;align-items:center;justify-content:center;',
        'padding:10px 8px;background:linear-gradient(0deg,rgba(2,12,30,.96),rgba(2,12,30,.82));border-top:1px solid rgba(255,255,255,.12);z-index:30}',
        '.mv-btn{appearance:none;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;',
        'font-family:inherit;font-weight:800;border-radius:10px;padding:10px 12px;font-size:14px;cursor:pointer;min-width:46px}',
        '.mv-btn:active{transform:scale(.96)}',
        '.mv-btn-main{background:#1a7a3a;border-color:#1a7a3a;min-width:54px;font-size:16px}',
        '.mv-btn-int{background:rgba(243,156,18,.16);border-color:rgba(243,156,18,.6)}',
        '#mv-decision{display:none;position:absolute;inset:0;z-index:40;flex-direction:column;align-items:center;justify-content:center;',
        'background:rgba(2,10,26,.82);backdrop-filter:blur(3px);padding:20px;text-align:center}',
        '.mv-card{background:linear-gradient(160deg,#03245e,#0a3a22);border:1px solid rgba(255,255,255,.18);border-radius:18px;',
        'padding:22px 20px;max-width:380px;width:92%;box-shadow:0 18px 50px rgba(0,0,0,.5)}',
        '#mv-dec-title{font-size:22px;font-weight:900;color:#fff;margin-bottom:6px}',
        '#mv-dec-sub{font-size:13px;color:#cfe0ff;margin-bottom:12px}',
        '#mv-dec-score{font-size:15px;color:#fff;margin-bottom:18px;line-height:1.5}',
        '.mv-dec-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}'
      ].join('');
      document.head.appendChild(st);
    }

    // コントロールバー（▶/⏸・速度・采配・結果）。
    var bar = document.createElement('div');
    bar.id = 'mv-controls';
    bar.innerHTML =
      '<button class="mv-btn mv-btn-main" id="mv-pp" onclick="_mvTogglePlay()">⏸</button>' +
      '<button class="mv-btn" id="mv-speed" onclick="_mvCycleSpeed()">1×</button>' +
      '<button class="mv-btn mv-btn-int" onclick="_mvOpenSetting()">📋 ' + _mvT('采配', 'Plan') + '</button>' +
      '<button class="mv-btn" onclick="_mvSkipToEnd()">⏭ ' + _mvT('結果', 'Result') + '</button>';
    host.appendChild(bar);

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

  // startGame からの復帰時の後始末（simulate.js が参照）。
  function _mvTeardownUI() {
    _mvPause();
    _mvHideDecision();
    _mvShowControls(false);
    _toggleNormalControls(true);
  }

  // ── グローバル公開（HTML onclick / simulate.js から参照）──────────
  var g = (typeof window !== 'undefined') ? window : this;
  g.startManagerMatch = startManagerMatch;
  g._mvTogglePlay = _mvTogglePlay;
  g._mvCycleSpeed = _mvCycleSpeed;
  g._mvOpenSetting = _mvOpenSetting;
  g._mvCloseSetting = _mvCloseSetting;
  g._mvSkipToEnd = _mvSkipToEnd;
  g._mvContinue = _mvContinue;
  g._mvManagerHTKickoff = _mvManagerHTKickoff;
  g._mvTeardownUI = _mvTeardownUI;
})();
