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
    _mvOppSubCount = 0; _mvOppOff = {}; _mvOppIn = {}; _mvLateChecked = false;   // 相手監督AIの交代状態をリセット
    window._mvMatchSubs = [];   // 全交代（自/相手）のログ記録をリセット
    _mvSubCutQueue = [];   // 交代カットシーン待ち行列をリセット
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
      if (_mvSubCutQueue.length) { _mvPause(); _mvPlaySubCutscenes(function () { if (_managerMode) _mvPlay(); }); return; }
    }

    // ゴール停止（カットシーンの余韻＋交代カットを見せてから自動再生を続行）。
    //   ※ ゴール後の采配ポップアップは廃止（割り込み過多・采配はコントロールバー/HTで可能）。
    if (_mvGoalShown) {
      _mvOpponentDecide(false);   // 相手監督が失点/得点に反応（戦術＋交代）
      _mvPause();
      setTimeout(function () {
        if (!_managerMode) return;
        _mvPlaySubCutscenes(function () { if (_managerMode) _mvPlay(); });   // 交代あれば先にカット → 続行
      }, 3300);
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
      _mvToast('🧠 ' + _mvT('相手監督', 'Rival manager') + '：' + label + '（' + _mvTacName(target) + '）');
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
      res.push({ idx: i, p: team.players[i], r: _mvRating(team.players[i]) });
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
      var idx = team.lineup[pos], p = team.players[idx];
      if (!p) continue;
      if (_mvOppIn[idx]) continue;   // 交代で入った選手は再びOUTにしない（現実的に稀）
      slots.push({ pos: pos, idx: idx, p: p, r: _mvRating(p), cat: cat, fatigue: p.fatigue || 0 });
    }
    var bench = _mvBench(team);
    if (!slots.length || !bench.length) return false;
    function lowestOf(cat) { return slots.filter(function (s) { return s.cat === cat; }).sort(function (a, b) { return a.r - b.r; })[0]; }
    function bestBench(pred) { return bench.filter(pred).sort(function (a, b) { return b.r - a.r; })[0]; }

    var plan = null;

    // A. ビハインド → 攻撃投入
    var behind = (diff <= -2 && (atHT || prog >= 0.55)) || (diff === -1 && (atHT || prog >= 0.65));
    if (behind) {
      var att = bestBench(function (b) { return _mvPlayerCats(b.p)['FW']; });
      var out = (diff <= -2 && prog >= 0.75) ? lowestOf('DF') : lowestOf('FW');
      if (!out) out = slots.slice().sort(function (a, b) { return a.r - b.r; })[0];  // fallback: 最弱
      if (att && out && att.r >= out.r - OPP_SUB_ATT_DOWNGRADE) {
        plan = { out: out, in: att, label: _mvT('攻撃の駒を投入', 'attacking change') };
      }
    }
    // B. リード → 守備固め
    if (!plan) {
      var lead = (diff >= 2 && prog >= 0.70) || (diff === 1 && prog >= 0.75);
      if (lead) {
        var def = bestBench(function (b) { var c = _mvPlayerCats(b.p); return c['DF'] || c['MF']; });
        var outFw = lowestOf('FW');
        if (def && outFw && def.r >= outFw.r - OPP_SUB_DEF_DOWNGRADE) {
          plan = { out: outFw, in: def, label: _mvT('守備を厚くする', 'shoring up') };
        }
      }
    }
    // C. 均衡/リフレッシュ（最も稼働した選手を同ポジで）
    if (!plan && (atHT || prog >= 0.60)) {
      var tired = slots.slice().sort(function (a, b) { return b.fatigue - a.fatigue; })[0];
      if (tired && tired.fatigue >= OPP_FATIGUE_MIN) {
        var same = bestBench(function (b) { return _mvPlayerCats(b.p)[tired.cat]; });
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
    _mvToast('🔁 ' + _mvT('相手交代', 'Rival sub') + '：' + _mvName(plan.out.p) + ' → ' + _mvName(plan.in.p) + '（' + plan.label + '）');
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
   * 交代が適用された停止点で全画面オーバーレイを ~2s 表示 → done() で続行。
   * 素材PNGは未使用（SUB_CUTSCENE_PLAN.md）。届いたら背景画像＋名前オーバーレイへ拡張。 */
  function _mvRenderSubCutscene(batch) {
    var host = document.getElementById('screen-game'); if (!host) return;
    var el = document.getElementById('mv-subcut');
    if (!el) {
      el = document.createElement('div'); el.id = 'mv-subcut';
      el.style.cssText = 'position:absolute;inset:0;z-index:66;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;' +
        'background:radial-gradient(ellipse at center,rgba(10,20,42,0.94),rgba(3,7,15,0.98));opacity:0;transition:opacity .3s;pointer-events:none;padding:24px;box-sizing:border-box';
      host.appendChild(el);
    }
    var head = '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:clamp(22px,7vw,30px);letter-spacing:3px;color:#cfe0ff;font-weight:700">🔁 ' + _mvT('選手交代', 'SUBSTITUTION') + '</div>';
    var cards = batch.map(function (s) {
      var col = s.teamColor || '#8899aa';
      return '<div style="background:rgba(255,255,255,0.06);border:1px solid ' + col + ';border-left:5px solid ' + col + ';border-radius:12px;padding:14px 22px;min-width:min(280px,86vw);text-align:center;box-shadow:0 6px 22px rgba(0,0,0,0.4)">' +
        '<div style="font-size:12px;font-weight:700;color:' + col + ';margin-bottom:9px;letter-spacing:1px">' + (s.teamName || '') + (s.label ? ' ・ ' + s.label : '') + '</div>' +
        '<div style="font-size:clamp(15px,4.6vw,18px);font-weight:800;color:#ff6b6b;margin:3px 0">⬇ ' + s.out + '</div>' +
        '<div style="font-size:clamp(15px,4.6vw,18px);font-weight:800;color:#51e08a;margin:3px 0">⬆ ' + s.in + '</div>' +
        '</div>';
    }).join('');
    el.innerHTML = head + cards;
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
    _mvRecordPlayerSubs(_mvT('ハーフタイム', 'Half Time'));   // テキストログ用に交代を記録
    if (typeof _insertSubLog === 'function') _insertSubLog(_mvT('ハーフタイム', 'Half Time'));
    // ★ _showHalfTimeModal が disabled にした next/all ボタンを再有効化する（Codex P2）。
    //   通常の closeHalfTimeModal はここで再有効化するが、監督分岐は早期 return で素通りするため、
    //   放置すると後続の通常試合で all-btn（結果を見る）が無効のまま残る。
    var _nb = document.getElementById('next-btn'); if (_nb) _nb.disabled = false;
    var _ab = document.getElementById('all-btn'); if (_ab) _ab.disabled = false;
    _toggleNormalControls(false);
    _mvShowControls(true);
    if (_mvSubCutQueue.length) _mvPlaySubCutscenes(function () { if (_managerMode) _mvPlay(); });   // 自チーム交代のカット
    else _mvPlay();
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
    _mvRecordPlayerSubs(_mvTimeLabel());   // テキストログ用に交代を記録
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

    // 試合画面へ戻り、そのまま自動再生を再開（采配ポイントの確認パネルは廃止＝余計な1クリック削減）。
    showScreen('game');
    _mvShowControls(true);
    if (_mvSubCutQueue.length) _mvPlaySubCutscenes(function () { if (_managerMode) _mvPlay(); });   // 自チーム交代のカット → 続行
    else _mvPlay();
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
        /* ▶/⏸ ＝主役：緑グラデ＋発光、幅を持たせて構図の重心に */
        '.mv-btn-main{flex:0 0 auto;min-width:clamp(66px,20vw,88px);',
        'font-size:clamp(18px,5.2vw,22px);color:#fff;',
        'background:linear-gradient(180deg,#25a355,#178040);border-color:rgba(255,255,255,.28);',
        'box-shadow:inset 0 1px 0 rgba(255,255,255,.34),0 4px 14px rgba(23,128,64,.45)}',
        /* 速度＝トグル感（内側に沈んだ地＋数字を明るく） */
        '.mv-btn-speed{flex:0 0 auto;min-width:clamp(48px,13vw,58px);color:#9fe0ff;',
        'font-size:clamp(15px,4.2vw,17px);font-weight:900;font-variant-numeric:tabular-nums;',
        'background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));',
        'box-shadow:inset 0 2px 5px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.06)}',
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
      '<button class="mv-btn mv-btn-main" id="mv-pp" onclick="_mvTogglePlay()" aria-label="' + _mvT('再生／一時停止', 'Play / Pause') + '">⏸</button>' +
      '<button class="mv-btn mv-btn-speed" id="mv-speed" onclick="_mvCycleSpeed()" aria-label="' + _mvT('再生速度', 'Playback speed') + '">1×</button>' +
      '<button class="mv-btn mv-btn-int" onclick="_mvOpenSetting()"><span class="mv-btn-ic">📋</span>' + _mvT('采配', 'Plan') + '</button>' +
      '<button class="mv-btn mv-btn-ghost" onclick="_mvSkipToEnd()"><span class="mv-btn-ic">⏭</span>' + _mvT('結果', 'Result') + '</button>';
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
    // HT モーダル経由で disabled のまま抜けた場合に備え再有効化（Codex P2 の保険）。
    var _nb = document.getElementById('next-btn'); if (_nb) _nb.disabled = false;
    var _ab = document.getElementById('all-btn'); if (_ab) _ab.disabled = false;
    var _modal = document.getElementById('halftime-modal'); if (_modal) _modal.style.display = 'none';
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
  g._mvOpponentReact = _mvOpponentReact;   // デバッグ/検証用ハンドル
  g._mvOpponentSub = _mvOpponentSub;       // デバッグ/検証用ハンドル
  g._mvRenderSubCutscene = _mvRenderSubCutscene;   // デバッグ/検証用ハンドル
  g._mvPlaySubCutscenes = _mvPlaySubCutscenes;     // デバッグ/検証用ハンドル
})();
