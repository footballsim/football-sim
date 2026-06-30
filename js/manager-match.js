/**
 * manager-match.js — 監督ビューア（P2 / BACKLOG T-09・T-11・T-12）。
 *
 * 目的:
 *   「監督として試合を“読む”」観戦モード。試合を自動再生で流し、采配ポイント
 *   （ハーフタイム・ゴール・任意の一時停止）で交代／戦術変更を行う。
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
 * 介入が結果に効く仕組み（createMatch の遅延実行）:
 *   従来の後半交代（_recalcSecondHalf）は「残りチャンスを再シミュレート」＝RNG 再抽選＋
 *   チーム再構築（fatigue/chance_counter が消える）で非決定的だった。createMatch は
 *   未計算のチャンスを 1 つずつ計算するため、applyDecision で lineup/tactics を差し替えるだけで
 *   「次チャンス以降」が新入力を読む。再抽選なし・走行中の選手状態を保持・seed 再現可能。
 *
 * ロード順: players.js → rng.js → simulate.js → events.js → match.js → cutscene.js →
 *           manager-match.js（simulate.js のグローバル _managerMode/_mvCtrl/_mvGoalShown と
 *           createMatch / nextChance / showResult / getPlayerName / showScreen 等を参照）。
 */

(function () {
  'use strict';

  // ── 自動再生の状態（このモジュール内のみ）────────────────────────────
  var _mvPlaying = false;     // 自動再生中か
  var _mvTimer = null;        // setTimeout ハンドル
  var _MV_SPEEDS = [1300, 750, 420];  // 1x / 2x / 3x（1ビートあたり ms）
  var _mvSpeedIdx = 0;        // 現在の速度段（0..2）
  var _mvSubsMade = 0;        // 行った交代人数（W杯ルール: 最大5）
  var _MV_MAX_SUBS = 5;
  var _mvSubbedOff = null;    // UI用: 退いた選手 index（再出場不可・controller と二重管理しない表示鏡）
  var _mvSelOut = null;       // 交代ピッカーで選択中の OUT（lineup 位置）

  function _isEn() { return (typeof window !== 'undefined' && window.LANG === 'en'); }
  function _mvT(ja, en) { return _isEn() ? en : ja; }

  function _mvSpeed() { return _MV_SPEEDS[_mvSpeedIdx]; }
  function _gameActive() {
    var el = document.getElementById('screen-game');
    return el && el.classList.contains('active');
  }

  /* ──────────────────────────────────────────────────────────────────
   * エントリ: startManagerMatch — 監督ビューアで試合を開始する。
   *   startGame の表示系リセットを踏襲しつつ、事前一括演算の代わりに
   *   createMatch コントローラを生成して遅延実行に切り替える。
   * ────────────────────────────────────────────────────────────────── */
  function startManagerMatch() {
    // 延長戦フェーズからは起動しない（通常試合専用）。
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
    coachMarkTarget = -1;   // 監督モードはコーチカード非使用（engine 非参照）

    // createMatch コントローラ（home=team1 / away=team2）。未シード＝毎回フレッシュな試合。
    //   tactics 入力レイヤーは {home:team1State, away:team2State}（systemIdx/tactics/lineup/…）。
    _mvCtrl = createMatch(team1Data, team2Data, { home: team1State, away: team2State });
    _managerMode = true;
    _mvGoalShown = false;
    _mvPlaying = false;
    _mvSpeedIdx = 0;
    _mvSubsMade = 0;
    _mvSubbedOff = new Set();
    _mvSelOut = null;

    // 描画・介入の単一ソースを controller の team オブジェクトに束ねる。
    //   renderSceneField / sceneToText / cutscene は sc.offence(=_mvCtrl.home) を読み、
    //   applyDecision は同じ team の lineup/tactics を in-place 更新するため整合する。
    gameState = { team1: _mvCtrl.home, team2: _mvCtrl.away };

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

    // 通常の操作ボタン（次のシーン/一気に/交代）は監督モードでは隠す。
    _toggleNormalControls(false);
    showScreen('game');
    _mvEnsureUI();
    _mvShowControls(true);
    _mvUpdateControlBar();

    // キックオフ後すぐ自動再生を開始。
    _mvPlay();
  }

  // 通常モードの操作ボタンの表示/非表示。
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
    _mvTimer = setTimeout(_mvTick, 250);   // 開始は軽くタメてから
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
    // 画面遷移したら自動停止（タイマー暴走防止）。
    if (!_gameActive()) { _mvPause(); return; }

    // 全チャンス表示済み＆コントローラ終了 → 結果へ。
    if (_mvCtrl.isOver() && currentChanceIdx >= chanceResults.length) { _mvFinish(); return; }

    _mvGoalShown = false;
    nextChance();                       // 1ビート進める（内部で createMatch から遅延フェッチ）
    _mvSyncHud();

    // ハーフタイム停止（前半ロスタイム完了＝currentChanceIdx===HALF_CHANCES に到達した瞬間・1回のみ）。
    if (currentChanceIdx === HALF_CHANCES && !halfTimeShown && currentSceneIdx === 0 && _shootSubStep === 0) {
      halfTimeShown = true;
      var htRes = chanceResults[HALF_CHANCES - 1] || chanceResults[HALF_CHANCES - 2];
      if (htRes) halfTimeScore = { t1: htRes.t1score, t2: htRes.t2score };
      _mvPause();
      setTimeout(function () { if (_managerMode) _mvShowDecisionPoint('ht'); }, 350);
      return;
    }

    // ゴール停止（カットシーンの余韻を見せてから采配パネル）。
    if (_mvGoalShown) {
      _mvPause();
      setTimeout(function () { if (_managerMode) _mvShowDecisionPoint('goal'); }, 3300);
      return;
    }

    // 終了判定（このビートで末尾に達した）。
    if (_mvCtrl.isOver() && currentChanceIdx >= chanceResults.length) { _mvFinish(); return; }

    _mvTimer = setTimeout(_mvTick, _mvSpeed());
  }

  function _mvSyncHud() {
    // スコアは nextChance が更新するが、念のためチャンスカウントを同期。
    var cc = document.getElementById('chance-count');
    if (cc) cc.textContent = Math.min(currentChanceIdx, _mvCtrl.getState().n);
  }

  // 結果まで一気に（残りチャンスを全計算して結果画面へ）。
  function _mvSkipToEnd() {
    _mvPause();
    _mvHideDecision();
    while (!_mvCtrl.isOver()) {
      _mvCtrl.nextChance();
    }
    // controller の全 chanceResults を取り込む（表示はスキップ）。
    var crs = _mvCtrl.result.chanceResults;
    chanceResults = crs.slice();
    currentChanceIdx = chanceResults.length;
    _mvFinish();
  }

  function _mvFinish() {
    _mvPause();
    _mvHideDecision();
    _mvShowControls(false);
    // 結果画面へ（既存 narration.js: showResult が gameState/chanceResults を読む）。
    if (typeof showResult === 'function') showResult();
  }

  /* ── 采配ポイント（停止時パネル）──────────────────────────────────
   * kind: 'ht'（ハーフタイム）/ 'goal'（得点直後）/ 'manual'（任意停止）
   * ──────────────────────────────────────────────────────────────── */
  function _mvShowDecisionPoint(kind) {
    _mvEnsureUI();
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
      sub = _mvT('交代・戦術を調整', 'Make a substitution or change tactics');
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

    _mvShowPicker(false);
    panel.style.display = 'flex';
  }

  function _mvHideDecision() {
    var panel = document.getElementById('mv-decision');
    if (panel) panel.style.display = 'none';
  }

  /* ── 交代ピッカー（T-11）────────────────────────────────────────── */
  function _mvOpenSub() {
    _mvPause();
    _mvSelOut = null;
    _mvRenderSubPicker();
    _mvShowPicker(true);
  }

  function _mvRenderSubPicker() {
    var body = document.getElementById('mv-picker-body');
    var team = gameState.team1;
    var html = '';
    html += '<div class="mv-pick-head">' + _mvT('交代', 'Substitution') +
      ' <span style="font-size:11px;opacity:.7">(' + _mvT('残り', 'left ') +
      (_MV_MAX_SUBS - _mvSubsMade) + _mvT('人', '') + ')</span></div>';

    if (_mvSubsMade >= _MV_MAX_SUBS) {
      html += '<div class="mv-note">' + _mvT('交代枠を使い切りました（最大5人）', 'No substitutions left (max 5)') + '</div>';
      body.innerHTML = html;
      return;
    }

    // OUT: 現在のスタメン（GK=0 を除く 1..10）。
    html += '<div class="mv-sec-label">' + _mvT('① 退く選手', '① Player OUT') + '</div>';
    html += '<div class="mv-pick-grid">';
    for (var pos = 1; pos < team.lineup.length; pos++) {
      var p = team.players[team.lineup[pos]];
      if (!p) continue;
      var sel = (_mvSelOut === pos) ? ' mv-sel' : '';
      html += '<button class="mv-chip' + sel + '" onclick="_mvPickOut(' + pos + ')">' +
        '<span class="mv-chip-pos">' + team.getPositionName(pos) + '</span>' +
        '<span class="mv-chip-name">' + getPlayerName(p) + '</span></button>';
    }
    html += '</div>';

    // IN: ベンチ（lineup 外・再出場不可を除く）。OUT 未選択時はグレー表示。
    html += '<div class="mv-sec-label">' + _mvT('② 入る選手', '② Player IN') + '</div>';
    html += '<div class="mv-pick-grid">';
    var inLineup = {};
    for (var i = 0; i < team.lineup.length; i++) inLineup[team.lineup[i]] = true;
    var any = false;
    for (var idx = 0; idx < team.players.length; idx++) {
      if (inLineup[idx]) continue;
      if (_mvSubbedOff.has(idx)) continue;
      any = true;
      var bp = team.players[idx];
      var disabled = (_mvSelOut === null) ? ' mv-dis' : '';
      html += '<button class="mv-chip' + disabled + '" onclick="_mvPickIn(' + idx + ')">' +
        '<span class="mv-chip-pos">' + (bp.positions && bp.positions[0] ? bp.positions[0] : '') + '</span>' +
        '<span class="mv-chip-name">' + getPlayerName(bp) + '</span></button>';
    }
    if (!any) html += '<div class="mv-note">' + _mvT('交代可能な控えがいません', 'No available substitutes') + '</div>';
    html += '</div>';

    body.innerHTML = html;
  }

  function _mvPickOut(pos) {
    if (_mvSubsMade >= _MV_MAX_SUBS) return;
    _mvSelOut = pos;
    _mvRenderSubPicker();
  }

  function _mvPickIn(inIdx) {
    if (_mvSelOut === null) return;   // 先に OUT を選ぶ
    var pos = _mvSelOut;
    var team = gameState.team1;
    var outIdx = team.lineup[pos];
    // createMatch コントローラへ介入（lineup を in-place 差し替え＝次チャンス以降に反映）。
    var ok = _mvCtrl.applyDecision({ type: 'sub', side: 'home', pos: pos, 'in': inIdx });
    if (!ok) { _mvToast(_mvT('その交代はできません', 'Substitution not allowed')); return; }
    _mvSubbedOff.add(outIdx);
    _mvSubsMade++;
    _mvSelOut = null;
    var inName = getPlayerName(team.players[inIdx]);
    var outName = getPlayerName(team.players[outIdx]);
    _mvToast('🔄 ' + outName + ' → ' + inName);
    _mvLog('🔄 ' + _mvT('交代', 'Sub') + ': ' + outName + ' → ' + inName);
    _mvRenderSubPicker();
  }

  /* ── 戦術ピッカー（T-12）────────────────────────────────────────── */
  function _mvOpenTactic() {
    _mvPause();
    _mvRenderTacticPicker();
    _mvShowPicker(true);
  }

  function _mvRenderTacticPicker() {
    var body = document.getElementById('mv-picker-body');
    var cur = gameState.team1.tactics;
    var curName = TACTICS_NAMES[cur] || '-';
    var html = '<div class="mv-pick-head">' + _mvT('戦術変更', 'Change Tactics') +
      ' <span style="font-size:11px;opacity:.7">(' + _mvT('現在: ', 'now: ') + curName + ')</span></div>';
    html += '<div class="mv-pick-grid">';
    // 実在4戦術のみ（POSSESSION/PRESS/COUNTER/CATENACCIO = index 0..3）。applyDecision もこの4種だけ許可。
    for (var i = 0; i < 4; i++) {
      var sel = (cur === i) ? ' mv-sel' : '';
      html += '<button class="mv-chip mv-chip-wide' + sel + '" onclick="_mvPickTactic(' + i + ')">' +
        TACTICS_NAMES[i] + (cur === i ? ' ✓' : '') + '</button>';
    }
    html += '</div>';
    html += '<div class="mv-note">' + _mvT('次のチャンスから反映されます', 'Applies from the next chance') + '</div>';
    body.innerHTML = html;
  }

  function _mvPickTactic(i) {
    if (gameState.team1.tactics === i) return;
    var ok = _mvCtrl.applyDecision({ type: 'tactic', side: 'home', tactics: i });
    if (!ok) { _mvToast(_mvT('戦術を変更できません', 'Cannot change tactics')); return; }
    _mvToast('📋 ' + _mvT('戦術', 'Tactics') + ': ' + TACTICS_NAMES[i]);
    _mvLog('📋 ' + _mvT('戦術変更', 'Tactics') + ': ' + TACTICS_NAMES[i]);
    _mvRenderTacticPicker();
  }

  /* ── ログ＆トースト ────────────────────────────────────────────── */
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

  function _mvToast(text) {
    _mvEnsureUI();
    var t = document.getElementById('mv-toast');
    if (!t) return;
    t.textContent = text;
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(function () {
      t.style.opacity = '0';
      t.style.transform = 'translateX(-50%) translateY(8px)';
    }, 1600);
  }

  /* ── UI 注入（コントロールバー／采配パネル／ピッカー／トースト）──── */
  function _mvShowControls(show) {
    var bar = document.getElementById('mv-controls');
    if (bar) bar.style.display = show ? 'flex' : 'none';
  }
  function _mvShowPicker(show) {
    var pk = document.getElementById('mv-picker');
    if (pk) pk.style.display = show ? 'flex' : 'none';
  }

  function _mvUpdateControlBar() {
    var pp = document.getElementById('mv-pp');
    if (pp) pp.textContent = _mvPlaying ? '⏸' : '▶';
    var sp = document.getElementById('mv-speed');
    if (sp) sp.textContent = (_mvSpeedIdx + 1) + '×';
  }

  function _mvEnsureUI() {
    if (document.getElementById('mv-controls')) return;
    var host = document.getElementById('screen-game');
    if (!host) return;

    // スタイル（ダーク基調・既存ゲーム画面に重ねる）。
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
        '.mv-dec-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}',
        '#mv-picker{display:none;position:absolute;inset:0;z-index:50;align-items:flex-end;justify-content:center;background:rgba(2,10,26,.6)}',
        '.mv-sheet{background:linear-gradient(160deg,#06122c,#0a2a1c);border:1px solid rgba(255,255,255,.16);border-top-left-radius:18px;',
        'border-top-right-radius:18px;width:100%;max-width:460px;max-height:80%;overflow-y:auto;padding:16px 16px 22px}',
        '.mv-pick-head{font-size:17px;font-weight:900;color:#fff;margin-bottom:10px}',
        '.mv-sec-label{font-size:12px;font-weight:800;color:#9fd0ff;margin:12px 0 6px}',
        '.mv-pick-grid{display:flex;flex-wrap:wrap;gap:8px}',
        '.mv-chip{display:flex;flex-direction:column;align-items:flex-start;gap:2px;border:1px solid rgba(255,255,255,.22);',
        'background:rgba(255,255,255,.06);color:#fff;border-radius:10px;padding:8px 10px;font-family:inherit;cursor:pointer;min-width:88px}',
        '.mv-chip-wide{min-width:120px;flex-direction:row;justify-content:center;font-weight:800;padding:12px}',
        '.mv-chip-pos{font-size:10px;color:#9fd0ff;font-weight:700}',
        '.mv-chip-name{font-size:13px;font-weight:800}',
        '.mv-chip.mv-sel{border-color:#f39c12;background:rgba(243,156,18,.22)}',
        '.mv-chip.mv-dis{opacity:.45}',
        '.mv-note{font-size:12px;color:#cdd8ee;opacity:.85;margin-top:10px}',
        '.mv-sheet-foot{display:flex;gap:10px;margin-top:18px}',
        '#mv-toast{position:absolute;left:50%;bottom:84px;transform:translateX(-50%) translateY(8px);z-index:60;',
        'background:rgba(2,12,30,.95);color:#fff;border:1px solid rgba(243,156,18,.6);border-radius:999px;padding:9px 16px;',
        'font-size:13px;font-weight:800;opacity:0;transition:opacity .25s,transform .25s;pointer-events:none;max-width:90%}'
      ].join('');
      document.head.appendChild(st);
    }

    // コントロールバー。
    var bar = document.createElement('div');
    bar.id = 'mv-controls';
    bar.innerHTML =
      '<button class="mv-btn mv-btn-main" id="mv-pp" onclick="_mvTogglePlay()">⏸</button>' +
      '<button class="mv-btn" id="mv-speed" onclick="_mvCycleSpeed()">1×</button>' +
      '<button class="mv-btn mv-btn-int" onclick="_mvOpenSub()">🔄 ' + _mvT('交代', 'Sub') + '</button>' +
      '<button class="mv-btn mv-btn-int" onclick="_mvOpenTactic()">📋 ' + _mvT('戦術', 'Tactics') + '</button>' +
      '<button class="mv-btn" onclick="_mvSkipToEnd()">⏭ ' + _mvT('結果', 'Result') + '</button>';
    host.appendChild(bar);

    // 采配パネル。
    var dec = document.createElement('div');
    dec.id = 'mv-decision';
    dec.innerHTML =
      '<div class="mv-card">' +
      '<div id="mv-dec-title"></div>' +
      '<div id="mv-dec-sub"></div>' +
      '<div id="mv-dec-score"></div>' +
      '<div class="mv-dec-row">' +
      '<button class="mv-btn mv-btn-int" onclick="_mvOpenSub()">🔄 ' + _mvT('交代', 'Sub') + '</button>' +
      '<button class="mv-btn mv-btn-int" onclick="_mvOpenTactic()">📋 ' + _mvT('戦術変更', 'Tactics') + '</button>' +
      '<button class="mv-btn mv-btn-main" id="mv-dec-continue" onclick="_mvContinue()">▶</button>' +
      '</div></div>';
    host.appendChild(dec);

    // ピッカー（ボトムシート）。
    var pk = document.createElement('div');
    pk.id = 'mv-picker';
    pk.innerHTML =
      '<div class="mv-sheet">' +
      '<div id="mv-picker-body"></div>' +
      '<div class="mv-sheet-foot">' +
      '<button class="mv-btn mv-btn-main" style="flex:1" onclick="_mvClosePicker()">' + _mvT('完了', 'Done') + '</button>' +
      '</div></div>';
    host.appendChild(pk);

    // トースト。
    var toast = document.createElement('div');
    toast.id = 'mv-toast';
    host.appendChild(toast);
  }

  // ピッカーを閉じる（采配パネル表示中ならそこへ戻り、なければ再生再開）。
  function _mvClosePicker() {
    _mvShowPicker(false);
    var dec = document.getElementById('mv-decision');
    if (dec && dec.style.display === 'flex') return;   // 采配パネルに戻る
    // バーから直接開いた場合は、ユーザーの「再生」操作を待つ（自動再開はしない）。
    _mvUpdateControlBar();
  }

  // 采配パネルの「続ける」。
  function _mvContinue() {
    _mvHideDecision();
    _mvPlay();
  }

  // startGame からの復帰時の後始末（simulate.js が参照）。
  function _mvTeardownUI() {
    _mvPause();
    _mvHideDecision();
    _mvShowPicker(false);
    _mvShowControls(false);
    _toggleNormalControls(true);
  }

  // ── グローバル公開（HTML onclick / simulate.js から参照）──────────
  var g = (typeof window !== 'undefined') ? window : this;
  g.startManagerMatch = startManagerMatch;
  g._mvTogglePlay = _mvTogglePlay;
  g._mvCycleSpeed = _mvCycleSpeed;
  g._mvOpenSub = _mvOpenSub;
  g._mvOpenTactic = _mvOpenTactic;
  g._mvSkipToEnd = _mvSkipToEnd;
  g._mvPickOut = _mvPickOut;
  g._mvPickIn = _mvPickIn;
  g._mvPickTactic = _mvPickTactic;
  g._mvClosePicker = _mvClosePicker;
  g._mvContinue = _mvContinue;
  g._mvTeardownUI = _mvTeardownUI;
})();
