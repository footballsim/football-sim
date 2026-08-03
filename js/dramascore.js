/* ===========================================================================
 * dramascore.js — MTG1-#2「ドラマスコア×演出ティア×可変テンポ」
 * ---------------------------------------------------------------------------
 * 第1回面白さMTG 採用案 #2（renderer-dev 提案A ＝ ドラマスコア×ティア に
 * ui-designer 提案C ＝ 可変テンポ＋hold-to-skim、reframer 提案C ＝ 1話に編集 を統合）。
 *
 * 確定済みのシーン列・スコア状態「だけ」からビートのドラマ度を決定論で採点し、
 *   Tier1 = 通常（ビート尺を 85〜90% に短縮しテンポを稼ぐ）
 *   Tier2 = 強調（band 内フラッシュ＋放射バースト＋観客フラッシュ＋パンチ）
 *   Tier3 = 見開き（タメ→爆発：暗転集中線→白閃光＋衝撃波リング→結果の打字）
 * を監督ビューアの表示ビートに重ねる。演出は #live-field-wrap（カットイン帯）内の
 * オーバーレイのみ＝新規アート無し・cutscene.js / エンジンは一切編集しない。
 *
 * ★ 絶対不可侵: デュエル解決式・カウント・rng には一切触れない。本ファイルは
 *   「表示済みビートを読む」だけ。rng 不使用＝同じ試合データなら常に同じティア列。
 * ★ キルスイッチ: window.MTG1_DRAMA === false で完全無効（既定は有効）。
 *   無効時は dramaOnBeat→0 / dramaBeatScale→1.0 / FX発火ゼロ / skim帯 非注入。
 * ★ 公開ビルドは非同梱（build.js の LAB_ONLY_JS）＝ manager-match.js 側は
 *   typeof ガードで no-op。
 *
 * API（manager-match.js から typeof ガードで呼ばれる）:
 *   dramaBeginMatch()                       — 1試合ぶんのティア消費・介入マーカーをリセット
 *   dramaNoteIntervention(chanceIdx)        — 采配適用の瞬間を記録（直後のビートを盛る）
 *   dramaOnBeat(chanceIdx, sceneIdx, fin)   — 表示ビートのティア判定＋FX。tier(0|1|2|3) を返す
 *   dramaBeatScale(scene)                   — 直近ビートの尺倍率（自動再生の setTimeout に乗算）
 *   dramaEnsureSkimUI()                     — hold-to-skim 帯を #mv-controls 内へ注入
 *   dramaScoreBeat(chanceIdx, sceneIdx)     — 採点だけ（純関数・テスト/デバッグ用）
 * ========================================================================= */

/* ── 有効判定・i18n ──────────────────────────────────────────────────── */
function _dsEnabled() {
  return !(typeof window !== 'undefined' && window && window.MTG1_DRAMA === false);
}
function _dsIsEn() { return (typeof window !== 'undefined' && window.LANG === 'en'); }
function _dsT(ja, en) { return _dsIsEn() ? en : ja; }

/* ── 調整定数（頻度目安: Tier3=1試合1〜3回 / Tier2=3〜6回。多発はインフレ＝死） ── */
var DRAMA_TIER2_MIN = 4.2;    // ドラマスコアがこれ以上で Tier2
var DRAMA_TIER3_MIN = 8.4;    // これ以上で Tier3
var DRAMA_TIER2_CAP = 6;      // 1試合の Tier2 上限（超過は Tier1 へ降格）
var DRAMA_TIER3_CAP = 3;      // 1試合の Tier3 上限（超過は Tier2 判定へ降格）
var DRAMA_SCALES = { 1: 0.87, 2: 1.15, 3: 1.7 };   // ビート尺倍率（1×/2×/3× 基準速度に乗算）
var DRAMA_SKIM_MS = 690;      // hold-to-skim のビート間隔 ≒ 1×(2400ms)/3.5

/* ── 1試合ぶんの状態（表示のみ・rng 不使用） ───────────────────────────── */
var _dsState = {
  tier2Used: 0, tier3Used: 0,
  lastIntervention: -99,   // 直近の采配適用チャンス（±2チャンスのビートを盛る）
  rival: false,            // 宿敵戦か（リーグセーブから試合開始時に判定）
  last: null,              // { sc, tier, scale } 直近ビート（dramaBeatScale 用）
  lastImportant: false     // 直近ビートが「見逃してはいけない」ビートか（skim 自動減速用）
};
if (typeof window !== 'undefined') window._dramaFxCount = 0;   // FX発火回数（検証用カウンタ）

/* 宿敵戦か。リーグセーブ（fs_league_v1）の rival と相手クラブ（team2Data._srcKey）を照合。
 * league.js は閉包なので保存データを読むだけ＝リーグ非稼働/非リーグ試合は false。 */
function _dsRivalMatch() {
  try {
    if (typeof team2Data === 'undefined' || !team2Data || !team2Data._srcKey) return false;
    if (typeof localStorage === 'undefined') return false;
    var raw = localStorage.getItem('fs_league_v1');
    if (!raw) return false;
    var st = JSON.parse(raw);
    return !!(st && st.rival && st.rival === team2Data._srcKey);
  } catch (e) { return false; }
}

function dramaBeginMatch() {
  _dsState = { tier2Used: 0, tier3Used: 0, lastIntervention: -99, rival: false, last: null, lastImportant: false };
  if (typeof window !== 'undefined') window._dramaFxCount = 0;
  if (!_dsEnabled()) return;
  _dsState.rival = _dsRivalMatch();
}

function dramaNoteIntervention(chanceIdx) {
  if (typeof chanceIdx === 'number' && chanceIdx >= 0) _dsState.lastIntervention = chanceIdx;
}

/* ── ドラマスコア（決定論・純関数。入力＝確定済みシーン＋そのチャンスのスコア状態） ──
 * 加点要素: イベント種（goal/PK/red/セーブ…）× 残り時間（終盤ほど重い）× 点差（同点/1点差）
 *          ＋ keyplayer 関与 ＋ 介入直後 ＋ 宿敵戦。rng 不使用＝同データなら常に同スコア。 */
function _dsScoreScene(sc, res, chanceIdx, n) {
  if (!sc) return 0;
  var s = 0;
  var r = sc.result;

  // イベント種（結果の"事件性"）
  if (r === 'ゴール！！') s += 5;
  else if (r === 'GK防いだ！') s += 2.5;
  else if (r === '枠を外した！') s += 1.5;
  else if (r === 'ブロック') s += 1.2;
  else if (r === 'カウンター') s += 1;
  // セットプレー（PK は事件そのもの）
  if (sc.action === 'ペナルティキック' || sc.scenario === 'ペナルティキック') s += 4;
  else if (sc.action === 'フリーキック') s += 1.5;
  else if (sc.scenario === 'コーナーキック') s += 1;
  // 規律（discipline.js が scene に焼く card / injury。非同梱なら undefined＝0）
  if (sc.card === 'red') s += 4;
  else if (sc.card === 'yellow') s += 1.2;
  if (sc.injury) s += (sc.injurySeverity === 'severe' ? 2.5 : 1.5);
  // スキル発動（鼓舞など）がこのチャンスで起きていたら少し盛る（mental.js 非同梱なら 0）
  if (res && Array.isArray(res.mentalEvents) &&
      res.mentalEvents.some(function (e) { return e && e.type === 'skill_activate'; })) s += 1;

  if (s <= 0) return 0;   // 通常のパス/ドリブル勝敗は加点なし＝Tier1（テンポで流す）

  // 残り時間: 終盤ほど重い（ロスタイム≒prog 1.0 で ×1.8）
  var prog = (n > 0) ? Math.min(1, (chanceIdx + 1) / n) : 0;
  var timeMul = 1 + 0.8 * prog * prog;
  // 点差: このチャンス時点のスコア（同点/1点差＝ドラマ、点差が開くほど冷める）
  var d = Math.abs(((res && res.t1score) || 0) - ((res && res.t2score) || 0));
  var closeMul = (d === 0) ? 1.3 : (d === 1) ? 1.2 : (d === 2) ? 1.0 : 0.85;

  var score = s * timeMul * closeMul;

  // keyplayer 関与（自チームの攻撃で keyplayer が起点）— 監督ビューア中のみ判定可
  if (typeof gameState !== 'undefined' && gameState && gameState.team1 &&
      sc.offence === gameState.team1 && typeof gameState.team1.keyplayer === 'number' &&
      sc.ofsPos === gameState.team1.keyplayer) score += 1;
  // 介入直後（采配適用から2チャンス以内は「采配の帰結」に見える瞬間＝盛る）
  var dInt = chanceIdx - _dsState.lastIntervention;
  if (dInt >= 0 && dInt <= 2) score += 1;
  // 宿敵戦は全体をわずかに底上げ
  if (_dsState.rival) score *= 1.12;

  return score;
}

/* 採点だけ（テスト/デバッグ用・グローバル chanceResults を読む）。 */
function dramaScoreBeat(chanceIdx, sceneIdx) {
  if (!_dsEnabled()) return 0;
  if (typeof chanceResults === 'undefined' || !chanceResults) return 0;
  var res = chanceResults[chanceIdx];
  var sc = res && res.scenes && res.scenes[sceneIdx];
  if (!sc) return 0;
  var n = (typeof MATCH_CHANCES !== 'undefined') ? MATCH_CHANCES : 32;
  return _dsScoreScene(sc, res, chanceIdx, n);
}

/* スコア→ティア（キャップ適用前の素の判定） */
function _dsRawTier(score) {
  if (score >= DRAMA_TIER3_MIN) return 3;
  if (score >= DRAMA_TIER2_MIN) return 2;
  return 1;
}

/* ── ビート表示フック（manager-match.js の _mvStep から） ─────────────────
 * @param finalBeat  分割シュートの最終ビート（結果打）か。false の間は FX を撃たず
 *                   尺も通常（＝タメ）。省略時 true。
 * @returns 0=無効 / 1..3=ティア
 */
function dramaOnBeat(chanceIdx, sceneIdx, finalBeat) {
  if (!_dsEnabled()) { _dsState.last = null; _dsState.lastImportant = false; return 0; }
  if (typeof chanceResults === 'undefined' || !chanceResults) return 0;
  var res = chanceResults[chanceIdx];
  var sc = res && res.scenes && res.scenes[sceneIdx];
  if (!sc) { _dsState.last = null; _dsState.lastImportant = false; return 0; }

  var n = (typeof MATCH_CHANCES !== 'undefined') ? MATCH_CHANCES : 32;
  var score = _dsScoreScene(sc, res, chanceIdx, n);
  var tier = _dsRawTier(score);
  // 1試合キャップ（インフレ防止・Tier3→Tier2→Tier1 へ降格）
  if (tier === 3 && _dsState.tier3Used >= DRAMA_TIER3_CAP) tier = 2;
  if (tier === 2 && _dsState.tier2Used >= DRAMA_TIER2_CAP) tier = 1;

  // 「見逃してはいけない」ビート（hold-to-skim の自動減速条件）。
  //   分割シュートは最終前ビート（シュート/GKダイブ）でも減速＝結果を飛ばさせない。
  _dsState.lastImportant = (tier === 3) || (sc.result === 'ゴール！！') || !!sc.card || !!sc.injury ||
    (sc.action === 'ペナルティキック') || (sc.scenario === 'ペナルティキック');

  if (finalBeat === false) {
    // 分割中のタメビート: FX 無し・尺は通常（Tier1 短縮もしない＝間を保つ）
    _dsState.last = { sc: sc, tier: tier, scale: (tier >= 2) ? 1.0 : DRAMA_SCALES[1] };
    return tier;
  }

  _dsState.last = { sc: sc, tier: tier, scale: DRAMA_SCALES[tier] || 1.0 };

  // FX（結果打のビートのみ）。skim 走行中は Tier2 を撃たない（速すぎて汚れる）＝消費もしない。
  if (tier === 3) { _dsState.tier3Used++; _dsFxTier3(sc); }
  else if (tier === 2 && !_dsSkim.active) { _dsState.tier2Used++; _dsFxTier2(); }
  return tier;
}

/* ── ビート尺の係数（manager-match.js の自動再生 setTimeout に乗算） ────── */
function dramaBeatScale(scene) {
  if (!_dsEnabled()) return 1.0;
  var last = _dsState.last;
  if (last && scene && last.sc === scene) return last.scale;
  return 1.0;
}

/* ═════════════════════════ FX（表示のみ・帯内オーバーレイ） ═══════════════════
 * すべて #live-field-wrap の中に子要素として重ねる。次ビートの innerHTML='' で
 * 自動的に掃除される（rAF ループは isConnected を見て自止）。 */

function _dsBand() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('live-field-wrap');
}

/* 帯内オーバーレイの canvas（div で包む＝ #live-field-wrap > canvas の !important 規則を回避） */
function _dsOverlay(band, z) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;z-index:' + (z || 9) + ';pointer-events:none;overflow:hidden';
  var cv = document.createElement('canvas');
  var w = Math.max(1, band.clientWidth || 480), h = Math.max(1, band.clientHeight || 216);
  var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  wrap.appendChild(cv);
  band.appendChild(wrap);
  var ctx = cv.getContext('2d');
  if (!ctx) { wrap.remove(); return null; }
  ctx.scale(dpr, dpr);
  return { wrap: wrap, cv: cv, ctx: ctx, w: w, h: h };
}

/* パンチ（帯そのものを揺らす）。CSS keyframes を一度だけ注入。 */
function _dsEnsureStyle() {
  if (typeof document === 'undefined' || document.getElementById('drama-style')) return;
  var st = document.createElement('style');
  st.id = 'drama-style';
  st.textContent = [
    '@keyframes dramaPunch2{0%{transform:scale(1)}30%{transform:scale(1.035)}100%{transform:scale(1)}}',
    '@keyframes dramaPunch3{0%,100%{transform:translate(0,0)}10%{transform:translate(-5px,4px)}22%{transform:translate(5px,-4px)}',
    '34%{transform:translate(-4px,-3px)}46%{transform:translate(4px,3px)}62%{transform:translate(-2px,2px)}80%{transform:translate(2px,-1px)}}',
    '.drama-punch2{animation:dramaPunch2 .3s ease-out}',
    '.drama-punch3{animation:dramaPunch3 .42s cubic-bezier(.36,.07,.19,.97)}',
    /* hold-to-skim 帯（#mv-controls の flex 行に 100% 幅で割り込む） */
    '#mv-controls{flex-wrap:wrap}',
    '#drama-skim{flex:1 1 100%;order:-1;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:.5em;',
    'min-height:34px;margin-bottom:2px;padding:4px 10px;border-radius:10px;cursor:pointer;',
    'border:1px dashed rgba(159,224,255,.35);background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.01));',
    'color:#9fb9d9;font-size:11.5px;font-weight:700;letter-spacing:.03em;line-height:1.2;white-space:nowrap;',
    'user-select:none;-webkit-user-select:none;touch-action:none;transition:background .15s,color .15s,border-color .15s}',
    '#drama-skim.on{color:#eaf6ff;border-color:rgba(159,224,255,.8);border-style:solid;',
    'background:linear-gradient(180deg,rgba(47,111,208,.45),rgba(31,79,156,.35))}',
    '#drama-skim.slowed{color:#ffdf9e;border-color:rgba(243,156,18,.7);border-style:solid;',
    'background:linear-gradient(180deg,rgba(243,156,18,.22),rgba(243,156,18,.08))}'
  ].join('');
  document.head.appendChild(st);
}
function _dsPunch(band, cls, ms) {
  _dsEnsureStyle();
  band.classList.remove('drama-punch2', 'drama-punch3');
  void band.offsetWidth;   // reflow → アニメ再始動
  band.classList.add(cls);
  setTimeout(function () { band.classList.remove(cls); }, ms + 80);
}

/* 放射バースト線（cutscene.js の burst と同系の1マス描き＝画風を合わせる） */
function _dsBurst(ctx, x, y, r0, r1, a) {
  ctx.strokeStyle = 'rgba(255,255,255,' + a + ')';
  ctx.lineWidth = 2.5;
  for (var i = 0; i < 14; i++) {
    var an = i / 14 * 6.28;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(an) * r0, y + Math.sin(an) * r0);
    ctx.lineTo(x + Math.cos(an) * r1, y + Math.sin(an) * r1);
    ctx.stroke();
  }
}
/* 観客フラッシュ（帯上部にランダム風の小さな白グロー。位置は決定論＝seed 無しの固定表） */
var _DS_FLASH_POS = [[0.14, 0.16], [0.82, 0.12], [0.36, 0.09], [0.64, 0.2], [0.9, 0.24], [0.08, 0.26]];
function _dsCrowdFlash(ctx, w, h, t, count) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (var i = 0; i < count && i < _DS_FLASH_POS.length; i++) {
    var ph = t * 3 - i * 0.55;                 // 順に光る
    if (ph < 0 || ph > 1) continue;
    var a = Math.sin(ph * Math.PI) * 0.85;
    var x = _DS_FLASH_POS[i][0] * w, y = _DS_FLASH_POS[i][1] * h;
    var g = ctx.createRadialGradient(x, y, 0, x, y, 14);
    g.addColorStop(0, 'rgba(255,255,255,' + a + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 14, y - 14, 28, 28);
  }
  ctx.restore();
}
/* 衝撃波リング（1マス1回描き＋暗縁＝ガードレール準拠） */
function _dsRing(ctx, x, y, r, a) {
  ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, 6.29);
  ctx.strokeStyle = 'rgba(10,8,20,' + (a * 0.8) + ')'; ctx.lineWidth = 5; ctx.stroke();   // 暗縁
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.29);
  ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 3; ctx.stroke();
}

/* ── Tier2: 強調（~650ms・フラッシュ＋バースト＋観客フラッシュ＋パンチ） ── */
function _dsFxTier2() {
  if (typeof window !== 'undefined') window._dramaFxCount++;
  var band = _dsBand();
  if (!band || typeof requestAnimationFrame === 'undefined') return;
  var ov = _dsOverlay(band, 9);
  if (!ov) return;
  _dsPunch(band, 'drama-punch2', 300);
  var DUR = 650, t0 = null;
  function frame(ts) {
    if (!ov.cv.isConnected) return;                    // 次ビートで掃除された
    if (t0 === null) t0 = ts;
    var t = Math.min(1, (ts - t0) / DUR);
    var ctx = ov.ctx, w = ov.w, h = ov.h;
    ctx.clearRect(0, 0, w, h);
    if (t < 0.28) {                                     // 白閃光
      ctx.fillStyle = 'rgba(255,255,255,' + (0.5 * (1 - t / 0.28)) + ')';
      ctx.fillRect(0, 0, w, h);
    }
    if (t < 0.6) _dsBurst(ctx, w / 2, h / 2, 18 + t * 60, 52 + t * 110, 0.8 * (1 - t / 0.6));
    _dsCrowdFlash(ctx, w, h, t, 4);
    if (t < 1) requestAnimationFrame(frame);
    else ov.wrap.remove();
  }
  requestAnimationFrame(frame);
}

/* Tier3 の結果打字ラベル（i18n・シーン内容から決定論） */
function _dsResultLabel(sc) {
  if (sc.card === 'red') return _dsT('退場！！', 'RED CARD!!');
  if (sc.result === 'ゴール！！') return _dsT('ゴール！！', 'GOAL!!');
  if (sc.result === 'GK防いだ！') return _dsT('セーブ！！', 'SAVED!!');
  if (sc.result === '枠を外した！') return _dsT('外した！！', 'OFF TARGET!!');
  if (sc.result === 'ブロック') return _dsT('ブロック！', 'BLOCKED!');
  if (sc.injury) return _dsT('負傷…', 'INJURY...');
  if (sc.action === 'ペナルティキック' || sc.scenario === 'ペナルティキック') return _dsT('ＰＫ！！', 'PENALTY!!');
  return _dsT('決定機！', 'BIG CHANCE!');
}

/* ── Tier3: 見開き（タメ→爆発 ~1900ms）──────────────────────────────────
 * 0..420ms   タメ: 暗幕＋集中線がにじり寄る（下の結果絵を隠す＝静止の間）
 * 420ms..    爆発: 白閃光→衝撃波リング＋バースト＋観客フラッシュ＋帯シェイク
 *            → 結果テキストを1文字ずつ打字（打ち終わりで小さく着地） */
function _dsFxTier3(sc) {
  if (typeof window !== 'undefined') window._dramaFxCount++;
  var band = _dsBand();
  if (!band || typeof requestAnimationFrame === 'undefined') return;
  var ov = _dsOverlay(band, 10);
  if (!ov) return;
  var TAME = 420, DUR = 1900, label = _dsResultLabel(sc);
  var t0 = null, punched = false;
  function frame(ts) {
    if (!ov.cv.isConnected) return;
    if (t0 === null) t0 = ts;
    var el = ts - t0;
    var ctx = ov.ctx, w = ov.w, h = ov.h, cx = w / 2, cy = h / 2;
    ctx.clearRect(0, 0, w, h);

    if (el < TAME) {
      /* ── タメ: 暗幕＋集中線（外周→中心へにじり寄る） ── */
      var p = el / TAME;
      ctx.fillStyle = 'rgba(4,7,15,' + (0.55 + 0.25 * p) + ')';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.25 + 0.35 * p) + ')';
      ctx.lineWidth = 1.6;
      var rOut = Math.max(w, h) * 0.75, rIn = rOut * (0.62 - 0.3 * p);
      for (var i = 0; i < 26; i++) {
        var an = i / 26 * 6.28 + 0.12;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(an) * rOut, cy + Math.sin(an) * rOut);
        ctx.lineTo(cx + Math.cos(an) * rIn, cy + Math.sin(an) * rIn);
        ctx.stroke();
      }
    } else {
      /* ── 爆発 ── */
      var q = (el - TAME) / (DUR - TAME);   // 0..1
      if (!punched) { punched = true; _dsPunch(band, 'drama-punch3', 420); }
      if (q < 0.12) {                        // 白閃光
        ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * (1 - q / 0.12)) + ')';
        ctx.fillRect(0, 0, w, h);
      }
      if (q < 0.5) {                         // 衝撃波リング（二重）＋バースト
        var rr = q / 0.5;
        _dsRing(ctx, cx, cy, 14 + rr * w * 0.46, 0.9 * (1 - rr));
        if (rr > 0.25) _dsRing(ctx, cx, cy, 8 + (rr - 0.25) * w * 0.4, 0.7 * (1 - rr));
        _dsBurst(ctx, cx, cy, 20 + rr * 70, 60 + rr * 130, 0.85 * (1 - rr));
      }
      _dsCrowdFlash(ctx, w, h, q, 6);
      /* 結果の打字（1文字ずつ・打ち終わりで着地バウンス） */
      var chars = Math.min(label.length, Math.floor(q / 0.06) + 1);
      var txt = label.slice(0, chars);
      var done = chars >= label.length;
      var pop = done ? (1 + 0.12 * Math.max(0, 1 - (q - label.length * 0.06) / 0.1)) : 1.06;
      var fs = Math.min(h * 0.3, w * 0.16) * pop;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.font = '900 ' + fs + 'px "Arial Black","Hiragino Sans",sans-serif';
      ctx.lineWidth = fs * 0.16; ctx.strokeStyle = '#0c0a14';
      ctx.strokeText(txt, cx, cy);
      ctx.fillStyle = '#ffe14a';
      ctx.fillText(txt, cx, cy);
      ctx.restore();
    }
    if (el < DUR) requestAnimationFrame(frame);
    else ov.wrap.remove();
  }
  requestAnimationFrame(frame);
}

/* ═════════════════════ hold-to-skim（押している間だけ約3.5×） ═══════════════
 * manager-match.js が公開する操作口だけを使う:
 *   _mvSkimTick() → 1ビート送る。停止条件（HT/ゴール/負傷/終了/采配パネル）を
 *                   踏んだら false（＝エンジン側の停止フローに委ねて skim を止める）
 *   _mvSkimEnd(stopped) → 押下終了の後始末（自動再生なら再開）
 * 重要ビート（goal/card/injury/采配点/Tier3）で自動的に通常速へ戻る＝見逃さない保証。
 * 完全スキップは作らない（SCOPE 決定事項）。 */
var _dsSkim = { active: false, timer: null, engineStopped: false };

function _dsSkimLabelIdle(el) {
  el.className = '';
  el.textContent = '≫ ' + _dsT('押している間 早送り（重要シーンで自動減速）', 'Hold to skim — auto-slows for key moments');
}
function _dsSkimStart(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  if (!_dsEnabled() || _dsSkim.active) return;
  if (typeof _mvSkimTick !== 'function') return;
  _dsSkim.active = true;
  _dsSkim.engineStopped = false;
  var el = (typeof document !== 'undefined') ? document.getElementById('drama-skim') : null;
  if (el) { el.className = 'on'; el.textContent = '≫≫ ' + _dsT('早送り中…', 'Skimming…'); }
  _dsSkimLoop();
}
function _dsSkimLoop() {
  if (!_dsSkim.active) return;
  var okTick = false;
  try { okTick = (_mvSkimTick() === true); } catch (e) { okTick = false; }
  var el = (typeof document !== 'undefined') ? document.getElementById('drama-skim') : null;
  if (!okTick || _dsState.lastImportant) {
    // エンジン停止（HT/ゴール等）or 重要ビート → 通常速へ（押しっぱなしでも進めない）
    if (!okTick) _dsSkim.engineStopped = true;
    _dsSkim.active = false;
    if (_dsSkim.timer) { clearTimeout(_dsSkim.timer); _dsSkim.timer = null; }
    if (el) {
      el.className = 'slowed';
      el.textContent = '⏸ ' + _dsT('重要シーン — 通常速に戻しました', 'Key moment — back to normal speed');
    }
    return;
  }
  _dsSkim.timer = setTimeout(_dsSkimLoop, DRAMA_SKIM_MS);
}
function _dsSkimEnd() {
  _dsSkim.active = false;
  if (_dsSkim.timer) { clearTimeout(_dsSkim.timer); _dsSkim.timer = null; }
  var el = (typeof document !== 'undefined') ? document.getElementById('drama-skim') : null;
  if (el) _dsSkimLabelIdle(el);
  // エンジン停止（HT/ゴール等）で止まっていた場合はエンジン側のフロー
  // （ゴール余韻→カット→再開等）が続くので触らない＝二重再開しない。
  if (typeof _mvSkimEnd === 'function') _mvSkimEnd(_dsSkim.engineStopped);
  _dsSkim.engineStopped = false;
}

/* skim 帯を #mv-controls の行内へ注入（manager-match.js の _mvEnsureUI 末尾から）。
 * キルOFF時は注入しない。言語切替時は _mvEnsureUI がバーごと作り直す→再注入される。 */
function dramaEnsureSkimUI() {
  if (!_dsEnabled() || typeof document === 'undefined') return;
  var bar = document.getElementById('mv-controls');
  if (!bar || document.getElementById('drama-skim')) return;
  _dsEnsureStyle();
  var el = document.createElement('div');
  el.id = 'drama-skim';
  _dsSkimLabelIdle(el);
  // タッチ/マウス両対応（Pointer Events）。押している間だけ・離せば即終了。
  el.addEventListener('pointerdown', _dsSkimStart);
  el.addEventListener('pointerup', _dsSkimEnd);
  el.addEventListener('pointercancel', _dsSkimEnd);
  el.addEventListener('pointerleave', function () { if (_dsSkim.active) _dsSkimEnd(); });
  el.addEventListener('contextmenu', function (e) { e.preventDefault(); });   // 長押しメニュー抑止
  bar.insertBefore(el, bar.firstChild);
}

/* ── デバッグ/テスト用ハンドル ────────────────────────────────────────── */
function _dramaState() { return _dsState; }
if (typeof window !== 'undefined') {
  window.dramaBeginMatch = dramaBeginMatch;
  window.dramaNoteIntervention = dramaNoteIntervention;
  window.dramaOnBeat = dramaOnBeat;
  window.dramaBeatScale = dramaBeatScale;
  window.dramaScoreBeat = dramaScoreBeat;
  window.dramaEnsureSkimUI = dramaEnsureSkimUI;
  window._dramaState = _dramaState;
}
