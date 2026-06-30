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
    if (seed != null) seedRng(seed);

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

  // グローバル公開（ブラウザ window / Node global / vm context のいずれでも）。
  global.playMatch = playMatch;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

// Node（vm context / 連結ロード）でも参照できるよう、存在すれば module.exports にも載せる。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { playMatch: (typeof playMatch !== 'undefined' ? playMatch : undefined) };
}
