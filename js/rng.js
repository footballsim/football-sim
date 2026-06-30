/**
 * rng.js — 差し替え可能な擬似乱数源（P1 / BACKLOG T-04〜T-06）。
 *
 * 目的:
 *   試合エンジン（simulate.js）の乱数の「出どころ」を一本化し、シード指定時に
 *   決定論的な系列を返せるようにする。これにより同一シードで試合（イベント列・
 *   スコア）を完全再現でき、サーバー検証・名場面の再生/共有の土台になる。
 *
 * 最重要の不変条件（behavior-preserving）:
 *   ★ 未シード時は Math.random() をそのまま呼ぶ ★
 *   未シードの rng() は `return Math.random()` と 1 ビットも変わらない。よって
 *   simulate.js の Math.random を rng() へ全置換しても、シードを設定しない限り
 *   現挙動と完全に同一（回帰ハーネスが PASS する根拠）。
 *
 * API（グローバル公開・既存の非 module 運用に合わせる）:
 *   rng()           … [0,1) の float を返す。未シード=Math.random、シード時=PRNG 系列。
 *   seedRng(seed)   … 32bit 整数シードで決定論モードに入る（系列を初期化）。
 *   clearSeed()     … 未シード（Math.random フォールバック）に戻す。
 *   isRngSeeded()   … 現在シード中かどうか（デバッグ/検証用）。
 *
 * ロード順: players.js → rng.js → simulate.js → events.js（simulate.js より前）。
 *   ES module ではなくグローバル <script> 運用なので、ここで定義する関数は
 *   グローバルスコープに公開される。
 *
 * PRNG: mulberry32。32bit シードから決定論的に [0,1) を生成する高速・高品質な
 *   単純 PRNG。状態は 32bit 1 ワードのみ＝再現と直列化が容易。
 */

(function (global) {
  'use strict';

  // 現在の PRNG ステート。null のときは未シード（Math.random フォールバック）。
  var _rngState = null;

  // mulberry32: 32bit ステートを 1 回進めて [0,1) を返す。
  // 参考実装に忠実。ステートは _rngState（32bit 符号なし）。
  function _mulberry32() {
    // 32bit 加算（>>> 0 で符号なしに丸める）
    _rngState = (_rngState + 0x6D2B79F5) >>> 0;
    var t = _rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * 乱数を 1 つ返す。
   * 未シード: Math.random() を素通し（現挙動と完全同一）。
   * シード中: mulberry32 の系列。
   * @returns {number} [0,1)
   */
  function rng() {
    if (_rngState === null) return Math.random();
    return _mulberry32();
  }

  /**
   * 決定論モードに入る。同一 seed なら以降の rng() 系列が完全に再現される。
   * @param {number} seed 整数シード（小数・負・>2^32 でも 32bit に丸める）
   */
  function seedRng(seed) {
    // 任意入力を 32bit 符号なし整数へ正規化。NaN/undefined は 0 扱い。
    var s = Number(seed);
    if (!isFinite(s)) s = 0;
    _rngState = (s >>> 0);
  }

  /** 未シード（Math.random フォールバック）に戻す。 */
  function clearSeed() {
    _rngState = null;
  }

  /** @returns {boolean} 現在シード中か。 */
  function isRngSeeded() {
    return _rngState !== null;
  }

  // グローバル公開（ブラウザ window / Node global / vm context のいずれでも）。
  global.rng = rng;
  global.seedRng = seedRng;
  global.clearSeed = clearSeed;
  global.isRngSeeded = isRngSeeded;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
