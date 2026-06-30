/**
 * match.js — 本番の試合エントリ「playMatch」（P1 / BACKLOG T-07）。
 *
 * 目的:
 *   これまで個別に整えた土台
 *     - シード可能 RNG（rng.js: seedRng/rng/clearSeed）
 *     - チーム構築（simulate.js: buildTeam）
 *     - 試合エンジン（simulate.js: simulateChance）
 *     - イベントログ seam（events.js: matchToEvents）
 *   を「対戦カード＋戦術＋シード → 1 試合まるごと実行 → 構造化結果」を返す
 *   単一の本番 API に束ねる。描画・AI・統計はこの 1 関数を入口にできる。
 *
 * 最重要のガードレール（behavior-preserving）:
 *   ★ playMatch は既存エンジン関数の「オーケストレーションのみ」★
 *   勝率核 ofs²/(ofs²+dfs²)・selectAction・select*Position・simulateChance の
 *   確率判定には一切触れない。playMatch がやるのは「入力を組み立て → 既存関数を
 *   既存と同じ手順で呼び → 出力を Event[] へ正規化して返す」だけ。
 *
 * 決定論の境界（★Codex 指摘対応）:
 *   試合の乱数消費は (1) チャンス数 n の決定 と (2) 各 simulateChance 内部、の 2 系統。
 *   startGame は T-05 で n を含め rng() へ置換済み（simulate.js:1954）なので、本来は seed に
 *   従属する。一方 narration.js の simulateSilent（バッチ sim）は今も n を Math.random() で
 *   決める（narration.js:903）＝seed 経路から外れる。playMatch は n を rng() で決めることで
 *   「本番の 1 試合経路」の決定論境界をここ 1 箇所に集約する。未シード時は rng()=Math.random
 *   なので現挙動と同一、seed 指定時は n も seed 系列に従い試合全体が 1 本の seed で完全再現できる。
 *
 *   ※ simulateSilent（バッチ sim）の決定論化は今回スコープ外（別タスク）。
 *      playMatch は「ゲーム本体の 1 試合経路」を担うエントリ。
 *
 * ロード順: players.js → rng.js → simulate.js → events.js → match.js（events.js の後）。
 *   ES module ではなくグローバル <script> 運用なので、ここで定義する関数は
 *   グローバルスコープに公開される。
 */

(function (global) {
  'use strict';

  // 通常試合のチャンス数: 前半 HALF_CHANCES + 後半 HALF_CHANCES + ロスタイム最大 1（startGame と同一の式）。
  // simulate.js のエンジン定数 MATCH_CHANCES に追従させる（startGame/simulateSilent/harness と同一本数を保証）。
  // ★ rng() で決める＝seed に完全従属させる（本番経路の決定論境界をここに集約）。
  var BASE_CHANCES = MATCH_CHANCES;

  /**
   * data（TEAM_DATA 形式）＋ override から buildTeam 用の state を組み、チームを構築する。
   * tactics 入力レイヤー: 監督の介入（システム/戦術/lineup/keyplayer/marked）を
   * 「次試合への入力」として受ける最小実装。未指定なら data の default_* を使う。
   *
   * ★ marked_player の既定は home/away で「非対称」（startGame の初期化を忠実に再現）:
   *   - home（自チーム team1）: -1（startGame は simulate.js:1114 で -1 固定。ユーザーが
   *     明示選択した時だけ設定）。
   *   - away（相手 team2）: data.default_marked_player（startGame は simulate.js:1888 で
   *     team2Data.default_marked_player を使う）。
   *   simulateChance は `defence===team1 && team1.marked_player>=0` の時だけ ofsPoint*=0.85 を
   *   適用するため（simulate.js:2304）、home に default_marked_player を入れると既定の
   *   playMatch がホーム守備を不当に強化し、実プレー(startGame)と結果がズレる。それを防ぐ。
   *   override.marked_player を明示した場合はそれを尊重（home/away 共通）。
   *
   * @param {object} data       TEAM_DATA のエントリ（buildTeam が受ける形）
   * @param {object} [override] { system|systemIdx, tactics, lineup, keyplayer, marked_player }
   * @param {boolean} isHome    home 側（= team1）か。marked_player の既定の非対称に使う。
   * @returns {object} buildTeam が返すチームオブジェクト
   */
  function _buildSide(data, override, isHome) {
    override = override || {};

    // システム index: 明示 systemIdx > system名(文字列) > data.default_system > 0。
    var sysIdx;
    if (typeof override.systemIdx === 'number') {
      sysIdx = override.systemIdx;
    } else {
      var sysName = override.system || data.default_system;
      sysIdx = system_data.findIndex(function (s) { return s.name === sysName; });
      if (sysIdx < 0) sysIdx = 0;
    }

    var lineup = (Array.isArray(override.lineup) ? override.lineup : data.default_lineup).slice(0, 11);

    // marked_player 既定の非対称（上記コメント参照）: home=-1 / away=default_marked_player。
    var markedDefault = isHome
      ? -1
      : (data.default_marked_player !== undefined ? data.default_marked_player : -1);

    var state = {
      systemIdx: sysIdx,
      tactics: (override.tactics !== undefined) ? override.tactics : data.default_tactics,
      keyplayer: (override.keyplayer !== undefined) ? override.keyplayer : data.default_keyplayer,
      marked_player: (override.marked_player !== undefined) ? override.marked_player : markedDefault,
      lineup: lineup
    };

    return buildTeam(data, state);
  }

  // 試合開始前のチーム状態を 0 リセット（startGame / simulateSilent / 各 harness と同一手順）。
  function _resetTeam(t) {
    t.score = 0;
    t.chanceCounter = 0;
    t.shootCounter = 0;
    t.gkSaveCounter = 0;
    for (var i = 0; i < t.players.length; i++) {
      t.players[i].chance_counter = 0;
      t.players[i].fatigue = 0;
    }
  }

  /**
   * playMatch — 対戦カード＋戦術＋シード → 1 試合まるごと → 構造化結果。
   *
   * 流れ: seed → (n は rng で決定) → buildTeam ×2 → simulateChance ×n → matchToEvents → clearSeed。
   *
   * @param {object} home    home チームデータ（= gs.team1 の素データ。buildTeam が受ける形）
   * @param {object} away    away チームデータ（= gs.team2 の素データ）
   * @param {object} [tactics] 戦術/システム/lineup 入力レイヤー。下記いずれの形でも可:
   *   - { home:{...}, away:{...} }      … home/away 別の override
   *   - { ... }                         … home/away 共通の override
   *   省略時は各 data の default_* を使う（現挙動と同一の既定）。
   * @param {number|null} [seed] 32bit 整数シード。null/省略なら未シード（= 現挙動）。
   * @returns {{seed:(number|null), n:number, events:Array, result:{home:number,away:number}, chanceResults:Array, home:object, away:object}}
   */
  function playMatch(home, away, tactics, seed) {
    if (seed === undefined) seed = null;

    // home/away 別 override を取り出す。{home,away} 形でなければ全体を共通 override とみなす。
    var hOv = null, aOv = null;
    if (tactics) {
      if (tactics.home || tactics.away) { hOv = tactics.home || null; aOv = tactics.away || null; }
      else { hOv = tactics; aOv = tactics; }
    }

    // ① シード設定（指定時のみ決定論モードへ。未指定なら rng()=Math.random のまま＝現挙動）。
    //    ★ seeded で開始する時、既に別の seeded 試合（生きた createMatch 等）があれば弾く。
    //      playMatch は finally で clearSeed するため、放置すると先の seeded controller の系列を
    //      上書き＋clear してサイレントに壊す。契約「seeded 試合は同時に 1 つ」を共有して防ぐ。
    //      （未シード playMatch は seedRng/clearSeed を一切触らないので従来どおり併存可。）
    if (seed != null) {
      if (isRngSeeded()) {
        throw new Error('playMatch: 既に別の seeded 試合が進行中です（seeded 試合は同時に 1 つ）。' +
          '先の試合（createMatch 等）を完了/ dispose してから呼んでください。');
      }
      seedRng(seed);
    }

    try {
      // ② チーム構築 ＋ 状態リセット（marked_player 既定は home/away 非対称＝startGame 準拠）。
      var t1 = _buildSide(home, hOv, true);   // home = team1（自チーム）: marked 既定 -1
      var t2 = _buildSide(away, aOv, false);  // away = team2（相手）: marked 既定 default_marked_player
      _resetTeam(t1);
      _resetTeam(t2);
      var gs = { team1: t1, team2: t2 };

      // ③ チャンス数 n を rng() で決定（★決定論境界をここに集約）。
      //    startGame / simulateSilent と同じ式（16 + ロスタイム最大1）。Math.random は使わない。
      var n = BASE_CHANCES + (rng() < 0.5 ? 1 : 0);

      // ④ simulateChance をループ（エンジン本体は無改変・呼ぶだけ）。
      var chanceResults = [];
      for (var i = 0; i < n; i++) {
        chanceResults.push(simulateChance(gs, i));
      }

      // ⑤ Event[] へ正規化（events.js の seam）。home=team1 / away=team2。
      var events = matchToEvents(chanceResults, { home: t1, away: t2 });

      return {
        seed: seed,
        n: n,
        events: events,
        result: { home: t1.score, away: t2.score },
        chanceResults: chanceResults,
        home: t1,
        away: t2
      };
    } finally {
      // ⑥ 後始末: 必ず未シードへ戻す（指定時のみ seed したので、毎回戻して状態を残さない）。
      if (seed != null) clearSeed();
    }
  }

  /* ──────────────────────────────────────────────────────────────────────
   * createMatch — 監督の采配介入点の土台（P2 / BACKLOG T-08）。
   *
   * playMatch（一括計算）に対する「チャンス単位で進められる対話型ドライバ」。
   * 監督の介入（交代・戦術変更）を「以降のチャンスの入力（lineup/tactics）」として
   * 受け、次チャンス以降の simulateChance がその新入力を読む。
   *
   * ★ 最重要のガードレール（playMatch と全く同じ behavior-preserving 原則）:
   *   simulateChance / デュエル式 ofs²/(ofs²+dfs²) / select* / カウントには一切触れない。
   *   介入は gs.team の lineup / tactics を「書き換えるだけ」。simulateChance は毎回
   *   team.lineup / team.tactics をフレッシュに読む（getActionParam/getTeamTotalParam/
   *   select*Position 経由）ので、間のチャンスで in-place に差し替えれば次チャンスへ効く。
   *   buildTeam による作り直しはしない＝走行中の player.chance_counter/fatigue を保つ。
   *
   * ★ 決定論の境界（playMatch と同一に集約）:
   *   試合の乱数消費は (1) チャンス数 n の決定 と (2) 各 simulateChance 内部、の 2 系統。
   *   playMatch は「team 構築 → n=rng() → simulateChance×n」の順で rng() を消費する。
   *   createMatch も全く同じ順序で消費する（構築直後に n を 1 回 rng() で確定 → 以降は
   *   nextChance() のたびに simulateChance を 1 つずつ）。よって「介入なし」なら rng() の
   *   消費系列が playMatch と 1 ビットも変わらず、events / result が完全一致する。
   *   介入は lineup/tactics を差し替えるだけで rng() を消費しないため、同一 seed＋同一介入列
   *   なら試合は完全再現される。
   *
   *   ※ seed 指定時は試合が終わる（または dispose）まで rng は seeded のまま。チャンスを
   *     遅延実行するため、playMatch のように 1 関数内で seed→clearSeed を閉じられない。
   *     完了時／dispose 時に clearSeed() して状態を残さない（未シード時は no-op）。
   *
   * API:
   *   var m = createMatch(home, away, tactics, seed);
   *   m.nextChance()            … 次のチャンスを 1 つ計算し、そのチャンスで生じた Event[]（delta）を返す。
   *                               末尾まで来ていたら null。最後の 1 つを計算し終えると自動で clearSeed。
   *   m.applyDecision(decision) … 次チャンス以降の入力（lineup/tactics）を変える（下記）。
   *   m.getState()              … { idx, n, over, score, decisions } のスナップショット。
   *   m.isOver()                … 全チャンス計算済みか。
   *   m.result                  … 完了後は { seed, n, events(=playMatch 互換の全 Event[]), result, chanceResults, home, away }。
   *                               未完了時は events/chanceResults は現時点までの部分列。
   *   m.events                  … 現時点までの全 Event[]（完了時は playMatch.events と完全一致）。
   *   m.dispose()               … 途中終了時の後始末（seed 指定時は clearSeed）。
   *
   * applyDecision(decision) の形（介入の種類＝入力変更のみ・エンジン不変）:
   *   - 交代 sub:    { type:'sub', side:'home'|'away', pos:<lineup位置 1..10>, in:<控えの players index> }
   *                  既存の交代セマンティクス（_subbedOff 相当＝退いた選手の再出場不可）に倣い、
   *                  lineup[pos] を控え in に差し替える。pos=0（GK）も可だが通常は 1..10。
   *   - 戦術 tactic: { type:'tactic', side:'home'|'away', tactics:<TACTICS_POSSESSION|PRESS|COUNTER|CATENACCIO> }
   *                  team.tactics を実在 4 種のいずれかに変更する。
   *   ⚠️ 「喝」/モチベ補正/覚醒は今回スコープ外（morale を sim の param 計算に効かせる別タスク）。
   *
   * @param {object} home    home チームデータ（buildTeam が受ける形）
   * @param {object} away    away チームデータ
   * @param {object} [tactics] playMatch と同一の戦術/システム/lineup 入力レイヤー（{home,away} or 共通）
   * @param {number|null} [seed] 32bit 整数シード。null/省略なら未シード（= 現挙動）。
   * @returns {object} 対話型マッチコントローラ
   */
  function createMatch(home, away, tactics, seed) {
    if (seed === undefined) seed = null;

    // home/away 別 override を取り出す（playMatch と同一ロジック）。
    var hOv = null, aOv = null;
    if (tactics) {
      if (tactics.home || tactics.away) { hOv = tactics.home || null; aOv = tactics.away || null; }
      else { hOv = tactics; aOv = tactics; }
    }

    // ① シード設定（指定時のみ決定論モードへ。未指定なら rng()=Math.random のまま＝現挙動）。
    //    ★ playMatch と違い、ここから clearSeed まで seeded を保持する（遅延実行のため）。
    //    ★ seeded 状態は global RNG 1 本の共有資源（rng.js）。createMatch は完了/dispose まで
    //      seeded を握り続けるため、その間に別の seeded 試合（別 createMatch / seeded playMatch）が
    //      走ると同じ global RNG を上書き/clear し、先の controller の再現保証をサイレントに壊す。
    //      契約「seeded 試合は同時に 1 つ」を明示し、二重起動は明確なエラーで弾く。
    //      （未シード同士は従来どおり併存可。並行 seeded sim が要るなら将来コンテキストスワップを検討）。
    if (seed != null) {
      if (isRngSeeded()) {
        throw new Error('createMatch: 既に別の seeded 試合が進行中です（seeded 試合は同時に 1 つ）。' +
          '先の試合を最後まで進めるか dispose() してから開始してください。');
      }
      seedRng(seed);
    }

    // ② チーム構築 ＋ 状態リセット（playMatch と完全に同じ手順・順序）。
    var t1 = _buildSide(home, hOv, true);   // home = team1: marked 既定 -1
    var t2 = _buildSide(away, aOv, false);  // away = team2: marked 既定 default_marked_player
    _resetTeam(t1);
    _resetTeam(t2);
    var gs = { team1: t1, team2: t2 };

    // ③ チャンス数 n を rng() で決定（★決定論境界の集約点。playMatch と同じ順序・同じ式）。
    var n = BASE_CHANCES + (rng() < 0.5 ? 1 : 0);

    // 介入で退いた選手（side 別）。再出場不可の保証に使う（既存 _subbedOff セマンティクス）。
    var subbedOff = { home: {}, away: {} };
    // 適用済み介入の履歴（再現性の検証・UI 表示用）。{ atChance, ...decision }。
    var decisions = [];

    var idx = 0;             // 次に計算するチャンス index（0..n）。
    var chanceResults = [];  // これまでに計算したチャンス結果。
    var seeded = (seed != null);
    var seedCleared = false;

    function _sideTeam(side) {
      if (side === 'home') return t1;
      if (side === 'away') return t2;
      return null;
    }

    function _maybeClearSeed() {
      // 完了 or dispose で 1 度だけ clearSeed（未シード時は no-op）。
      if (seeded && !seedCleared) { clearSeed(); seedCleared = true; }
    }

    function isOver() { return idx >= n; }

    /**
     * 次チャンス以降の入力（lineup/tactics）を変える。エンジンには触れない。
     * 適用は「呼んだ時点の gs.team」を in-place に書き換える＝以降の nextChance() に効く。
     * @returns {boolean} 適用できたか（不正な介入は false で無視）。
     */
    function applyDecision(decision) {
      if (!decision || typeof decision !== 'object') return false;
      var side = decision.side;
      var team = _sideTeam(side);
      if (!team) return false;

      if (decision.type === 'sub') {
        var pos = decision.pos;
        var inIdx = decision['in'];
        // lineup 位置・控え index の妥当性チェック（不正なら無視＝決定論を壊さない）。
        if (typeof pos !== 'number' || pos < 0 || pos >= team.lineup.length) return false;
        if (typeof inIdx !== 'number' || inIdx < 0 || inIdx >= team.players.length) return false;
        var outIdx = team.lineup[pos];
        if (inIdx === outIdx) return false;                 // 同一選手の指名は無効
        if (subbedOff[side][inIdx]) return false;           // 一度退いた選手は再出場不可
        if (team.lineup.indexOf(inIdx) >= 0) return false;  // 既に出場中の選手は不可
        // 退く選手を「再出場不可」に記録 → lineup を差し替え（既存 applyDrop と同セマンティクス）。
        subbedOff[side][outIdx] = true;
        team.lineup[pos] = inIdx;
        decisions.push({ atChance: idx, type: 'sub', side: side, pos: pos, out: outIdx, 'in': inIdx });
        return true;
      }

      if (decision.type === 'tactic') {
        var tac = decision.tactics;
        // 実在 4 種のみ許可（POSSESSION/PRESS/COUNTER/CATENACCIO）。
        if (tac !== TACTICS_POSSESSION && tac !== TACTICS_PRESS &&
            tac !== TACTICS_COUNTER && tac !== TACTICS_CATENACCIO) return false;
        if (team.tactics === tac) return false;             // 変化なしは無効（履歴を汚さない）
        team.tactics = tac;
        decisions.push({ atChance: idx, type: 'tactic', side: side, tactics: tac });
        return true;
      }

      return false;
    }

    /**
     * 次のチャンスを 1 つ計算し、そのチャンスで生じた Event[]（delta）を返す。
     * 末尾まで来ていたら null。最後の 1 つを計算し終えると自動で clearSeed。
     */
    function nextChance() {
      if (idx >= n) { _maybeClearSeed(); return null; }
      var res = simulateChance(gs, idx);   // ★ エンジン本体は無改変・呼ぶだけ
      chanceResults.push(res);
      // このチャンス単体の Event[]（chance 区切り＋各 scene）。kickoff/HT/FT フレームは付けない。
      var minute = parseMinute(res.time);
      var delta = [{
        t: EVENT_TYPES.CHANCE, chance: idx, minute: minute, team: null,
        timeLabel: res.time, sceneCount: Array.isArray(res.scenes) ? res.scenes.length : 0
      }];
      if (Array.isArray(res.scenes)) {
        for (var s = 0; s < res.scenes.length; s++) {
          var evs = sceneToEvents(res.scenes[s], { chance: idx, minute: minute, home: t1, away: t2 });
          for (var e = 0; e < evs.length; e++) delta.push(evs[e]);
        }
      }
      idx++;
      if (idx >= n) _maybeClearSeed();     // 完了したら seed を戻す
      return delta;
    }

    function getState() {
      return {
        idx: idx, n: n, over: isOver(),
        score: { home: t1.score, away: t2.score },
        decisions: decisions.slice()
      };
    }

    function dispose() { _maybeClearSeed(); }

    // 現時点までの Event[] を作る。
    //   完了（idx>=n）: matchToEvents をそのまま＝kickoff＋全 chance/scene＋（過ぎていれば）HT＋FT。
    //                   → playMatch.events と完全一致。
    //   進行中（idx<n）: 「正しい途中経過ログ」にする。matchToEvents は常に末尾 FT（試合終了）を
    //                   付けるため、進行中に読むと“早すぎる FT”が混入し UI/統計が試合終了と誤認する。
    //                   そこで進行中は末尾の FT を 1 件だけ落とす。HT は前半終了を過ぎた正当な
    //                   過去イベントなので matchToEvents の判定どおり残す（未到達なら元々出ない）。
    //   ※ matchToEvents の出力で FT は必ず末尾の 1 件（matchToEvents は最後にのみ push）。
    function _eventsSnapshot() {
      var evs = matchToEvents(chanceResults, { home: t1, away: t2 });
      if (!isOver() && evs.length && evs[evs.length - 1].t === EVENT_TYPES.FT) {
        evs = evs.slice(0, evs.length - 1); // 進行中は“早すぎる FT”を抑制
      }
      return evs;
    }

    // result / events は「現時点まで」を返す getter（完了時は playMatch と完全一致）。
    var controller = {
      nextChance: nextChance,
      applyDecision: applyDecision,
      getState: getState,
      isOver: isOver,
      dispose: dispose,
      home: t1,
      away: t2
    };
    Object.defineProperty(controller, 'events', {
      // ★ 進行中は FT 抑制／完了時は playMatch.events と完全一致（_eventsSnapshot）。
      get: function () { return _eventsSnapshot(); }
    });
    Object.defineProperty(controller, 'result', {
      get: function () {
        return {
          seed: seed, n: n,
          events: _eventsSnapshot(),  // 進行中は途中 FT を含まない（完了時は playMatch と一致）
          result: { home: t1.score, away: t2.score },
          chanceResults: chanceResults.slice(),
          home: t1, away: t2
        };
      }
    });
    return controller;
  }

  // グローバル公開（ブラウザ window / Node global / vm context のいずれでも）。
  global.playMatch = playMatch;
  global.createMatch = createMatch;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

// Node（vm context / 連結ロード）でも参照できるよう、存在すれば module.exports にも載せる。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    playMatch: (typeof playMatch !== 'undefined' ? playMatch : undefined),
    createMatch: (typeof createMatch !== 'undefined' ? createMatch : undefined)
  };
}
