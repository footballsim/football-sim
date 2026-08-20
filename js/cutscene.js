'use strict';
/**
 * cutscene.js — ゴール等の「カットシーン」takeover 表示（方式C: プリレンダ画像 + 動的HUD）。
 *
 * 方針: エンジン無改変・プレゼン層のみ。simulate.js の nextChance() ゴール時に
 *   showGoalCutscene(sc,res) を guard 付きで呼ぶ。未ロードでも simulate 側は従来演出にフォールバック。
 * ロード安全性: トップレベルで DOM/Image に触れない（回帰ハーネスが players/simulate/narration を
 *   vm ロードしても壊れないよう、実体は全て関数内＝実行時のみ）。
 * アセット: 出荷は img/cutscenes/（build が docs/img/ へ複製）。生成元は tools/art/。
 * 注意: build.js は renameGlobals:false なので showGoalCutscene 等のグローバル名は保持される。
 */

let CUTSCENES_ENABLED = true; // window.CUTSCENES_ENABLED===false で無効化（トグル）

// カタログ（tools/art/cutscenes.manifest.json と同期）。
// bicycle はパレットスワップで全キット色（_pickCutscene が得点チーム色に近い kit を選ぶ）。
var CUTSCENE_MANIFEST = [
  { moment: 'goal', subtype: 'bicycle', kit: 'red',    file: 'img/cutscenes/goal_bicycle_red_01.png' },
  { moment: 'goal', subtype: 'bicycle', kit: 'blue',   file: 'img/cutscenes/goal_bicycle_blue_01.png' },
  { moment: 'goal', subtype: 'bicycle', kit: 'yellow', file: 'img/cutscenes/goal_bicycle_yellow_01.png' },
  { moment: 'goal', subtype: 'bicycle', kit: 'green',  file: 'img/cutscenes/goal_bicycle_green_01.png' },
  { moment: 'goal', subtype: 'bicycle', kit: 'white',   file: 'img/cutscenes/goal_bicycle_white_01.png' },
  { moment: 'goal', subtype: 'bicycle', kit: 'dark',    file: 'img/cutscenes/goal_bicycle_dark_01.png' },
  { moment: 'goal', subtype: 'bicycle', kit: 'orange',  file: 'img/cutscenes/goal_bicycle_orange_01.png' },
  { moment: 'goal', subtype: 'bicycle', kit: 'skyblue', file: 'img/cutscenes/goal_bicycle_skyblue_01.png' },
  // ロングパス（通常プレー用・マッチアクション）。2フレーム（a=構え/windup, b=蹴り/kick）＋
  // コード描画のサッカーボールで横長カットインを動的合成（_renderLongpassScene）。生成元 tools/art/cutscenes/lpA,lpB.png。
  { moment: 'longpass', kit: 'red',    fileA: 'img/cutscenes/longpass_a_red_01.png',    fileB: 'img/cutscenes/longpass_b_red_01.png' },
  { moment: 'longpass', kit: 'blue',   fileA: 'img/cutscenes/longpass_a_blue_01.png',   fileB: 'img/cutscenes/longpass_b_blue_01.png' },
  { moment: 'longpass', kit: 'yellow', fileA: 'img/cutscenes/longpass_a_yellow_01.png', fileB: 'img/cutscenes/longpass_b_yellow_01.png' },
  { moment: 'longpass', kit: 'green',  fileA: 'img/cutscenes/longpass_a_green_01.png',  fileB: 'img/cutscenes/longpass_b_green_01.png' },
  { moment: 'longpass', kit: 'white',   fileA: 'img/cutscenes/longpass_a_white_01.png',   fileB: 'img/cutscenes/longpass_b_white_01.png' },
  { moment: 'longpass', kit: 'dark',    fileA: 'img/cutscenes/longpass_a_dark_01.png',    fileB: 'img/cutscenes/longpass_b_dark_01.png' },
  { moment: 'longpass', kit: 'orange',  fileA: 'img/cutscenes/longpass_a_orange_01.png',  fileB: 'img/cutscenes/longpass_b_orange_01.png' },
  { moment: 'longpass', kit: 'skyblue', fileA: 'img/cutscenes/longpass_a_skyblue_01.png', fileB: 'img/cutscenes/longpass_b_skyblue_01.png' },
  // シュート（地上ストライク）。単一フレームのシューター＋コードのボールで結果別演出（_renderShotScene）。生成元 tools/art/cutscenes/shoot.png。
  { moment: 'shot', kit: 'red',     file: 'img/cutscenes/shot_red_01.png' },
  { moment: 'shot', kit: 'blue',    file: 'img/cutscenes/shot_blue_01.png' },
  { moment: 'shot', kit: 'yellow',  file: 'img/cutscenes/shot_yellow_01.png' },
  { moment: 'shot', kit: 'green',   file: 'img/cutscenes/shot_green_01.png' },
  { moment: 'shot', kit: 'white',   file: 'img/cutscenes/shot_white_01.png' },
  { moment: 'shot', kit: 'dark',    file: 'img/cutscenes/shot_dark_01.png' },
  { moment: 'shot', kit: 'orange',  file: 'img/cutscenes/shot_orange_01.png' },
  { moment: 'shot', kit: 'skyblue', file: 'img/cutscenes/shot_skyblue_01.png' },
  // ショートパス（単一フレームのパサー＋コードのボールで短い横パス演出。_renderShortpassScene）。生成元 tools/art/cutscenes/shortpass.png。
  { moment: 'shortpass', kit: 'red',     file: 'img/cutscenes/shortpass_red_01.png' },
  { moment: 'shortpass', kit: 'blue',    file: 'img/cutscenes/shortpass_blue_01.png' },
  { moment: 'shortpass', kit: 'yellow',  file: 'img/cutscenes/shortpass_yellow_01.png' },
  { moment: 'shortpass', kit: 'green',   file: 'img/cutscenes/shortpass_green_01.png' },
  { moment: 'shortpass', kit: 'white',   file: 'img/cutscenes/shortpass_white_01.png' },
  { moment: 'shortpass', kit: 'dark',    file: 'img/cutscenes/shortpass_dark_01.png' },
  { moment: 'shortpass', kit: 'orange',  file: 'img/cutscenes/shortpass_orange_01.png' },
  { moment: 'shortpass', kit: 'skyblue', file: 'img/cutscenes/shortpass_skyblue_01.png' }
];

var _cutsceneCache = {};
function _loadCutsceneImg(src) {
  if (_cutsceneCache[src]) return _cutsceneCache[src];
  var img = new Image();
  img.src = src;
  _cutsceneCache[src] = img;
  return img;
}

var _bgsPreloaded = false;
// 試合の最初のシーン表示時に、重い背景画像(枠外missgoal 274KB/ゴールgoalnet/ファール/GK/共通)と、
// ショートパスで流用するアニメ調ポーズ(onetwo)をまとめて先読みする。
// 背景は未ロードだと _lpDrawBg が _lpBg() フォールバック(空・観客席ノイズ・芝)で固まる（特に枠外＝早期停止）。
// onetwo は最頻出のショートパスで実行時リカラーに使うので、初回の「選手が出ない」を防ぐ。
// 1試合1回・ブラウザのみ(Image存在時)。_*_SRC は var 巻き上げ済みで呼び出し時には代入済み。
function _preloadCutsceneBgs() {
  if (_bgsPreloaded || typeof Image === 'undefined') return;
  _bgsPreloaded = true;
  var list = [_LP_BG_SRC, _GK_BG_SRC, _GK_DIVE2_BG_SRC, _GOAL_BG_SRC, _MISS_BG_SRC, _FOUL_REF_SRC, _FOUL_BG_SRC, _POSTPLAY_FAIL_SRC, _POSTPLAY_FAIL_ATK_SRC, _POSTPLAY_FAIL_DEF_SRC, _POSTPLAY_HOLD_ATK_SRC, _POSTPLAY_HOLD_DEF_SRC, _ONETWO1_SRC, _ONETWO2_SRC, _ONETWO3_SRC];
  for (var i = 0; i < list.length; i++) { if (list[i]) _loadCutsceneImg(list[i]); }
}

// キット色(hex) → ざっくり色バケツ（近いアセットを選ぶため）
// 対応色: white/dark/yellow/orange/red/green/skyblue(水色)/blue
function _colorBucket(hex) {
  if (!hex || hex[0] !== '#') return null;
  var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 40) return max > 170 ? 'white' : 'dark';
  if (r > 175 && g > 150 && b < 120) return 'yellow';
  // オレンジ: 赤優勢だが緑が中程度（黄ほど高くない）・青が低い → 赤と黄の中間
  if (r > 180 && g >= 80 && g <= 175 && b < 110 && (r - g) > 40) return 'orange';
  if (r >= g && r >= b) return 'red';
  if (g >= r && g >= b) return 'green';
  // 水色: 青が最大だが緑も高く明るい（濃紺と区別）
  if (b >= r && b >= g && g > 140 && r > 70) return 'skyblue';
  return 'blue';
}

function _pickCutscene(moment, teamColor) {
  var pool = CUTSCENE_MANIFEST.filter(function (c) { return c.moment === moment; });
  if (!pool.length) return null;
  var want = _colorBucket(teamColor);
  var matched = pool.filter(function (c) { return c.kit === want || c.kit === 'any'; });
  var use = matched.length ? matched : pool;   // 色一致が無ければ全体から
  return use[Math.floor(Math.random() * use.length)];
}

function _csAbbr(team) {
  var n = (typeof getTeamName === 'function' ? getTeamName(team) : (team && team.name)) || '';
  return n.replace(/\s+/g, '').slice(0, 3).toUpperCase() || '???';
}
function _csRR(ctx, x, y, w, h, r, c) {
  ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.fill();
}

// プリレンダ画像 + 動的HUD（分・スコア・チームカラー・得点者・GOAL!!）を 360x480 に合成
function _renderCutsceneCard(canvas, img, sc, res) {
  var W = 360, H = 480, ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;
  if (img && img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, W, H);
  else { ctx.fillStyle = '#16243f'; ctx.fillRect(0, 0, W, H); }

  var gs = (typeof gameState !== 'undefined' && gameState) ? gameState : {};
  var t1 = gs.team1, t2 = gs.team2, scorerTeam = sc.offence;
  var accent = (scorerTeam && scorerTeam.team_color) || '#1f4fd6';
  var c1 = (t1 && t1.team_color) || '#1f4fd6', c2 = (t2 && t2.team_color) || '#cc6600';

  // 上部HUD
  var g = ctx.createLinearGradient(0, 0, 0, H * 0.2);
  g.addColorStop(0, 'rgba(6,6,14,.72)'); g.addColorStop(1, 'rgba(6,6,14,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.2);
  _csRR(ctx, 12, 12, 60, 24, 5, 'rgba(8,8,16,.8)');
  ctx.fillStyle = '#fff'; ctx.font = '800 15px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(String(res.time || ''), 42, 29);
  var px = W - 176, py = 12, pw = 164;
  _csRR(ctx, px, py, pw, 26, 6, 'rgba(8,8,16,.8)');
  ctx.fillStyle = c1; ctx.fillRect(px + 6, py + 6, 14, 14);
  ctx.fillStyle = c2; ctx.fillRect(px + pw - 20, py + 6, 14, 14);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = '800 13px sans-serif';
  ctx.fillText(_csAbbr(t1), px + 26, py + 18);
  ctx.textAlign = 'right'; ctx.fillText(_csAbbr(t2), px + pw - 26, py + 18);
  ctx.textAlign = 'center'; ctx.font = '900 15px "Arial Black",sans-serif';
  ctx.fillText(res.t1score + ' - ' + res.t2score, px + pw / 2, py + 18);

  // 下部HUD
  g = ctx.createLinearGradient(0, H * 0.78, 0, H);
  g.addColorStop(0, 'rgba(6,6,14,0)'); g.addColorStop(.35, 'rgba(6,6,14,.78)'); g.addColorStop(1, 'rgba(6,6,14,.92)');
  ctx.fillStyle = g; ctx.fillRect(0, H * 0.78, W, H * 0.22);
  ctx.fillStyle = accent; ctx.fillRect(0, H * 0.80, W, 4);
  var scorer = scorerTeam && scorerTeam.players && scorerTeam.players[scorerTeam.lineup[sc.ofsPos]];
  var scorerName = scorer ? (typeof getPlayerName === 'function' ? getPlayerName(scorer) : scorer.name) : '';
  ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 40px "Arial Black",sans-serif';
  ctx.lineWidth = 7; ctx.strokeStyle = '#0c0a14'; ctx.strokeText('GOAL!!', 18, H * 0.80 + 44);
  ctx.fillStyle = '#ffe14a'; ctx.fillText('GOAL!!', 18, H * 0.80 + 44);
  ctx.fillStyle = '#fff'; ctx.font = '800 18px sans-serif'; ctx.fillText(scorerName, 18, H - 28);
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '600 12px sans-serif';
  var teamNm = (typeof getTeamName === 'function' && scorerTeam) ? getTeamName(scorerTeam) : '';
  ctx.fillText(String(res.time || '') + (teamNm ? ('  ' + teamNm) : ''), 18, H - 12);
}

var _cutsceneActive = false;
// 戻り値: 表示したら true（呼び出し側は false の時だけ従来のGOAL演出にフォールバック）
function showGoalCutscene(sc, res) {
  var enabled = CUTSCENES_ENABLED && (typeof window === 'undefined' || window.CUTSCENES_ENABLED !== false);
  if (!enabled || _cutsceneActive || typeof document === 'undefined') return false;
  // 全ゴールはインライン _renderGoalScene（renderSceneArt）が担当 → 旧バイシクルtakeoverは出さない（true=旧フラッシュも抑止）
  if (SCENE_ART_ENABLED && (typeof window === 'undefined' || window.SCENE_ART_ENABLED !== false)) return true;
  var entry = _pickCutscene('goal', sc.offence && sc.offence.team_color);
  if (!entry) return false;
  _cutsceneActive = true;

  var img = _loadCutsceneImg(entry.file);
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.82);opacity:0;transition:opacity .2s;cursor:pointer';
  var canvas = document.createElement('canvas');
  canvas.width = 360; canvas.height = 480;
  canvas.style.cssText = 'width:auto;height:auto;max-width:88vw;max-height:82vh;image-rendering:pixelated;' +
    'border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.55);transform:scale(.92);transition:transform .22s';
  var hint = document.createElement('div');
  hint.textContent = (typeof window !== 'undefined' && window.LANG === 'en') ? 'tap to continue' : 'タップで続行';
  hint.style.cssText = 'position:absolute;left:0;right:0;bottom:14px;text-align:center;color:rgba(255,255,255,.7);font:600 12px sans-serif';
  overlay.appendChild(canvas); overlay.appendChild(hint);
  document.body.appendChild(overlay);

  // ── 共通FXレイヤー（_csFx 2026-07-28）: 完全静止カードへ rAF ループを重ねて「動く1枚絵」化 ──
  //   punch(表示直後260ms) → ring(中央上寄り=ボール想定位置) → rays スイープイン → 観客フラッシュ高密度。
  //   自チームゴール= grade('burst') / 失点= grade('drain')＋赤ビネット。FX_MS 終端でFXをフェードアウト
  //   （静止残骸を残さない）。close 後はループ即停止（closed は var 巻き上げで参照可）。
  var CW = 360, CH = 480;
  var fxAccent = (sc.offence && sc.offence.team_color) || '#ffd23a';
  var fxConcede = _csFxConcede(sc);
  var fxT0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var FX_MS = 2800;
  _csFx.grade(canvas, fxConcede ? 'drain' : 'burst');
  var fxCtx = canvas.getContext('2d');
  var paint = function () {
    var t = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - fxT0;
    fxCtx.clearRect(0, 0, CW, CH);
    fxCtx.save();
    _csFx.punch(fxCtx, CW, CH, t, { cy: CH * 0.42 });          // 表示瞬間のズームパンチ（260msのみ）
    _renderCutsceneCard(canvas, img, sc, res);                 // 静止カード本体（punch transform 下で描画）
    fxCtx.restore();
    var endK = t < FX_MS - 300 ? 1 : Math.max(0, (FX_MS - t) / 300);
    // ★ 光芒(rays)／衝撃波リング(ring)／観客フラッシュ(flashes)は不採用（2026-07-28 ユーザー判断）。
    //   残すのは「絵そのものの見え方を変える」層だけ＝パンチ（寄り）とグレード（彩度）と失点の赤ビネット。
    if (fxConcede) _csFx.vignette(fxCtx, CW, CH, Math.min(1, t / 380) * 0.5 * endK, '#d81830');
  };
  var fxLoop = function () {
    if (closed) return;
    paint();
    if ((((typeof performance !== 'undefined') ? performance.now() : Date.now()) - fxT0) < FX_MS) requestAnimationFrame(fxLoop);
  };
  requestAnimationFrame(fxLoop);
  if (!img.complete) img.onload = paint;                       // ループ終了後の遅延ロード保険
  requestAnimationFrame(function () { overlay.style.opacity = '1'; canvas.style.transform = 'scale(1)'; });

  var closed = false;
  var close = function () {
    if (closed) return; closed = true;
    overlay.style.opacity = '0';
    setTimeout(function () { overlay.remove(); _cutsceneActive = false; }, 220);
  };
  overlay.addEventListener('click', close);
  setTimeout(close, 3000);
  return true;
}

// ============================================================
// per-scene 表示: 通常プレーの各シーンに action 別アートを敷く。
//   ライブラリに該当アートが無ければ null を返す → 呼び出し側は従来 renderSceneField(SVG) にフォールバック。
//   エンジン無改変・プレゼンのみ。ロード時に DOM/Image へ触れない（回帰安全）。
// ============================================================
let SCENE_ART_ENABLED = true; // window.SCENE_ART_ENABLED===false で無効
// カットイン絵への焼き込み情報ラベル（左上=時刻 / 左下=アクション名 / 右下=選手名）の描画スイッチ。
//   試合画面リデザインで HUDの試合時計 と 下部の漫画ネーム枠 に情報を集約したため、
//   絵側のラベルは重複＋cover切り出しで欠けるので停止する。中央のGOAL!!/PENALTY!等の大演出は別系統(hud外)なので影響なし。
var CUTSCENE_BURN_LABELS = false; // ←将来 ui-designer がCSSオーバーレイで擬似SFX復活させる選択肢あり
// スキル発動カットイン（PS-05・鼓舞など漫画的決めゴマ）のキルスイッチ。
//   window.SKILL_CUTIN_ENABLED===false で無効化（CUTSCENES_ENABLED にも従属）。
let SKILL_CUTIN_ENABLED = true;
function _skillCutinOn() {
  if (!(CUTSCENES_ENABLED && (typeof window === 'undefined' || window.CUTSCENES_ENABLED !== false))) return false;
  return SKILL_CUTIN_ENABLED && (typeof window === 'undefined' || window.SKILL_CUTIN_ENABLED !== false);
}
// スキルラベルのフォールバック（mental.js 非同梱の _scene_lab 等でも文言を出せるように）。
var _SKILL_LABEL_FALLBACK = {
  captaincy: { ja: '｛選手｝がチームを鼓舞した！', en: '{player} rallies the team!' },
};

var _ACTION_MOMENT = {
  'ロングパス': 'longpass', 'ショートパス': 'shortpass',
  'ドリブル突破': 'dribble', '飛び出し': 'runin', 'クロス': 'cross', 'ポストプレー': 'postplay',
  'シュート': 'shot', '中央からシュート': 'shot', 'サイドからシュート': 'shot', 'ミドルシュート': 'shot'
  // ※ ヘディング/ボレーは専用ポーズ未制作のため未マップ（フィールドSVGにフォールバック）
};
function _sceneMoment(sc) { return (sc && _ACTION_MOMENT[sc.action]) || null; }

// 攻撃方向: team1=右攻め / team2(その他)=左攻め（renderSceneField と一致）。team1不明時は右をデフォルト。
// 各カットインは「攻撃が右を向く/左を向く」が一致するよう、ネイティブ向きに応じて水平反転する。
function _csAttackRight(sc) {
  var gs = (typeof gameState !== 'undefined' && gameState) ? gameState : null;
  if (!gs || !gs.team1) return true;
  return !!(sc && sc.offence === gs.team1);
}

// ── 没入UI（監督モード）カットイン主役の見切れ対策 ──────────────────────────
// live-field-wrap は 16:9 かつ監督モードでは 360×430 前後の縦長帯。canvas(480×216) を
// object-fit:cover で充填すると水平方向は中央~38%しか見えず（scale は高さ律速）、
// pcx≈326（右1/3）に主役を描くロングパス/シュート/ショートパスは、既定 object-position:50%
// では帯の左右端で主役が半分切れる。ポーズ別に「キャンバス内の主役の横中心（0..1）」を渡し、
// フリップ後の実効位置を object-position の X% にして主役を可視窓の中央へ寄せる。
//   subjFrac : pre-flip の主役横中心（0=左端 / 1=右端）。既定描画は 480px 座標系。
//   flipH    : そのシーンで ctx が水平反転しているか（反転すると主役は 1-subjFrac へ移る）。
// 縦(44%)は現状踏襲。中央ポーズ（デュエル等）は 0.5 → 50% で従来同等。
// contain 系（cs-fullframe: GOAL!!/PENALTY!）はこの対象外なので付けない。
function _csCenterSubject(canvas, subjFrac, flipH) {
  if (!canvas || canvas.className === 'cs-fullframe') return canvas;
  var f = flipH ? (1 - subjFrac) : subjFrac;
  // 端に寄せすぎて背景の空白側が見えないよう、可視窓の外へは出さない範囲に軽くクランプ。
  if (f < 0.16) f = 0.16; else if (f > 0.84) f = 0.84;
  canvas.style.objectPosition = Math.round(f * 100) + '% 44%';
  return canvas;
}

// 試合表示の「シュート3分割」用（simulate.js nextChance から段階別に呼ぶ）。
//   stepType: 'shot'=シューターの一撃 / 'gk'=GKダイブ（抜かれ/セーブ）/ 'result'=ゴール・枠外・セーブの結末。
//   エンジン無改変・プレゼンのみ。SCENE_ART無効/未対応は null（呼び出し側が従来SVGにフォールバック）。
function renderShootStep(sc, stepType) {
  var on = SCENE_ART_ENABLED && (typeof window === 'undefined' || window.SCENE_ART_ENABLED !== false);
  if (!on || typeof document === 'undefined' || !sc) return null;
  _preloadCutsceneBgs();   // 重い背景を先読み（枠外などで _lpBg フォールバックが固まるのを予防）
  if (stepType === 'foulcontact') return _renderPostplayScene(sc);   // ファールの接触＝ポストプレー失敗アート流用（守備が攻撃を倒す＝赤:攻撃/緑:守備でファールの加害被害と一致）
  if (stepType === 'foulref') return _renderFoulScene(sc);           // 主審の笛＋FOUL!
  if (stepType === 'pkref') return _renderFoulScene(sc, true);       // PK判定＝主審カット＋「PK！！」（赤ラベル）
  if (stepType === 'fkdeliver') return _renderFkDeliveryScene(sc);   // セットプレー/オープンプレーのクロスの「蹴り出し」（クロスを上げる）
  if (stepType === 'spcontest') return renderSceneArt(sc);           // セットプレーの「競り合い」＝ヘディング/ボレー（既存）
  if (stepType === 'lpkick') {                                       // ロングパス拍1＝蹴り出しのみ（結果非開示・resultを成功に中立化してボールは飛ぶだけ）
    var lpSc = {}; for (var lk in sc) { if (Object.prototype.hasOwnProperty.call(sc, lk)) lpSc[lk] = sc[lk]; }
    lpSc.result = '成功';
    var lpEntry = _pickCutscene('longpass', sc.offence && sc.offence.team_color);
    if (lpEntry && lpEntry.fileA) return _renderLongpassScene(lpSc, lpEntry);
    return null;
  }
  if (stepType === 'lpresult') return _renderLongpassResultScene(sc); // ロングパス拍2＝守備選手の反応（スルー/カット）
  if (stepType === 'result') {
    if (sc.result === '枠を外した！') return _renderMissScene(sc);
    if (sc.result === 'GK防いだ！') return _renderGkScene(sc, 'save');
    if (sc.result === 'ブロック') return _renderMidShotScene(sc);   // ブロック=ミドル流用（右上deflect）
    return _renderGoalScene(sc);                                    // ゴール！！（既定）
  }
  if (stepType === 'gk') {
    return _renderGkScene(sc, 'dive');   // 中間ビート=結果非開示のダイブ（ゴール/枠外/セーブ共通＝ドキドキ）
  }
  // 'shot' = シューターの一撃のみ（結果は出さない）。result を中立化して素の蹴り描画にする。
  var shotSc = {}; for (var k in sc) { if (Object.prototype.hasOwnProperty.call(sc, k)) shotSc[k] = sc[k]; }
  shotSc.result = '成功';
  // ★ PK の蹴りは FK 絵でなく「シュート」絵（shot_<kit>）を使う（ユーザー指定）。下の汎用 shot 経路へ落とす。
  if (sc.action === 'フリーキック') return _renderFreekickScene(shotSc);   // FK=専用2フレーム（蹴る前→蹴った瞬間＋ボール弧）
  if (sc.action === 'ミドルシュート') return _renderMidShotScene(shotSc);
  if (sc.action === 'ボレーシュート') return _renderVolleyScene(shotSc);
  if (sc.action === 'ヘディングシュート') return _renderHeadingAnimScene(shotSc) || _renderHeaderRiseDuelScene(shotSc) || _renderHeaderScene(shotSc);   // 6コマアニメ優先→対決割りRise→旧重ね絵
  return _renderShotScene(shotSc, null);   // 通常シュート/PKは採用4コマへ直結（旧shot素材に依存しない）
}

function renderSceneArt(sc, nextSc) {
  var on = SCENE_ART_ENABLED && (typeof window === 'undefined' || window.SCENE_ART_ENABLED !== false);
  if (!on || typeof document === 'undefined' || !sc) return null;
  _preloadCutsceneBgs();   // 重い背景を先読み（枠外などで _lpBg フォールバックが固まるのを予防）
  // コーナーキックは結果に関わらず「ヘディング競り合い」の絵に統一（ユーザー指定）。
  //   攻撃が競り勝つ(=失敗以外:ゴール/セーブ/枠外)＝成功(ヘディング！) / 守備がクリア(=失敗)＝競り負け。
  //   ゴール時は別途 showGoalCutscene の GOAL!! テイクオーバーが続く。
  if (sc.scenario === 'コーナーキック') {
    var _ck = {}; for (var _ckk in sc) { if (Object.prototype.hasOwnProperty.call(sc, _ckk)) _ck[_ckk] = sc[_ckk]; }
    _ck.result = (sc.result === '失敗') ? '失敗' : '成功';
    return _renderHeadingAnimScene(_ck) || _renderHeaderRiseDuelScene(_ck) || _renderHeaderScene(_ck);   // 6コマアニメ優先→対決割りRise→旧重ね絵
  }
  if (sc.result === 'ファール') return _renderFoulScene(sc);   // ファール=主審カット（全アクション共通・recolorなし・笛＆FOUL!）
  if (sc.action === 'ミドルシュート') return _renderMidShotScene(sc);   // 専用ミドル: 成功(抜け)=直進 / ブロック=右上deflect。ゴールでも goal-net でなくミドル演出。
  if (sc.result === 'ゴール！！') return _renderGoalScene(sc);   // 全ゴール=新ゴール演出（旧バイシクル廃止）
  if (sc.action === 'フリーキック') return _renderFreekickScene(sc);   // FK=専用2フレーム（枠外/セーブ等の非分割時もここ。ゴールは上で処理）
  // ヘディング競り合い（クロス/セットプレー段, result=成功/失敗）= 専用ヘディング演出。シュート段(scenario=シュート)は下の通常処理へ。
  if (sc.action === 'ヘディングシュート' && sc.scenario !== 'シュート') return _renderHeadingAnimScene(sc) || _renderHeaderRiseDuelScene(sc) || _renderHeaderScene(sc);   // 6コマアニメ優先→対決割りRise→旧重ね絵
  if (sc.action === 'ボレーシュート' && sc.scenario !== 'シュート') return _renderVolleyScene(sc);   // ボレー競り合い=ロングパス蹴りアニメ流用（ボール起点を膝高さへ）
  if (sc.action === 'クロス') return _renderCrossScene(sc);   // クロス=ミドル流用（成功=斜め上/失敗=反対方向）
  // ヘディング/ボレーの「シュート」段（クロス後の結果シーン。_ACTION_MOMENT 未登録なので個別に結果別描画）。
  //   セーブ=GKセーブ / 枠外=枠外（ゴールは上の result==='ゴール！！' で処理済み）。これが無いとSVG図に落ちる。
  if ((sc.action === 'ヘディングシュート' || sc.action === 'ボレーシュート') && sc.scenario === 'シュート') {
    if (sc.result === 'GK防いだ！') return _renderGkScene(sc, 'save');
    if (sc.result === '枠を外した！') return _renderMissScene(sc);
    return null;
  }
  var moment = _sceneMoment(sc);
  if (!moment) return null;
  if (moment === 'dribble') return _renderDribbleScene(sc);     // ドリブルは専用2スプライト（緑/赤を実行時recolor・manifest非依存）
  if (moment === 'runin') return _renderRunInScene(sc);         // 飛び出し: dribbleスプライト流用・manifest非依存
  if (moment === 'postplay') return _renderPostplayScene(sc);   // ポストプレー: 成功=ホールドアップ→反転(ドリブル流用) / 失敗=守備が弾く
  // 通常シュートは採用4コマへ直結。結果専用演出（枠外/GKセーブ）は従来どおり維持する。
  if (moment === 'shot') {
    if (sc.result === '枠を外した！') return _renderMissScene(sc);
    if (sc.result === 'GK防いだ！') return _renderGkScene(sc, 'save');
    return _renderShotScene(sc, null);
  }
  var entry = _pickCutscene(moment, sc.offence && sc.offence.team_color);
  if (!entry) return null;

  // ロングパスは2フレーム＋コードのボールで横長カットインを動的描画（攻撃側チーム色）。
  if (moment === 'longpass' && entry.fileA) return _renderLongpassScene(sc, entry);
  // ショートパスは単一フレームのパサー＋コードのボールで短い横パス。
  //   失敗/カウンター = 専用ポーズが無いので、ロングパス失敗と同じカット・タブロー演出を流用。
  if (moment === 'shortpass' && entry.file) {
    if (sc.result === '失敗' || sc.result === 'カウンター') {
      var _lpFail = _pickCutscene('longpass', sc.offence && sc.offence.team_color);
      if (_lpFail && _lpFail.fileA) return _renderLongpassScene(sc, _lpFail);
    }
    // ワンツーか通常ショートパスかを、エンジンの「同/別」テキスト判定(simulate.js sceneToText 2660-2668)と完全一致させる:
    //   ・次が クロス/シュート/セットプレー/ミドルシュート = 同/別を付けない＝「味方とのパス交換で突破」＝ワンツー
    //   ・次がパス/ドリブル系(下記_sfx) かつ 同一選手(ofsPos=) = 「同」＝ワンツー
    //   ・次がパス/ドリブル系 かつ 別選手(ofsPos≠) = 「別」＝【次の攻撃選手】へつなぐ＝通常ショートパス
    //   ・次シーン無し = 通常ショートパス
    var _noSfx = ['クロス', 'シュート', 'セットプレー', 'ミドルシュート'];   // この4つが次なら同/別を付けない（＝パス交換＝ワンツー）
    var isPlainPass = !nextSc || (_noSfx.indexOf(nextSc.scenario) === -1 && nextSc.ofsPos !== sc.ofsPos);   // 「別」のみ通常パス
    if (!isPlainPass) return _renderOnetwoScene(sc);   // ワンツー3カット連結（同 or パス交換）
    return _renderShortpassScene(sc, entry);            // 別選手への通常ショートパス／次シーン無し
  }
  var img = _loadCutsceneImg(entry.file);
  var W = 390, H = 195;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var draw = function () {
    var ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#15331f'); bg.addColorStop(1, '#0d1a2b');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (img.complete && img.naturalWidth) {                // contain（全体を見せる・上下クロップしない）
      var s = Math.min(W / img.naturalWidth, H / img.naturalHeight);
      var dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
    if (CUTSCENE_BURN_LABELS) {   // 焼き込みラベル停止（アクション名・チーム名はHUD・ネーム枠へ集約）
      ctx.fillStyle = 'rgba(8,8,16,.72)'; ctx.fillRect(8, H - 24, 150, 18);
      ctx.fillStyle = '#fff'; ctx.font = '800 12px sans-serif'; ctx.textAlign = 'left';
      var nm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
      ctx.fillText((sc.action || '') + (nm ? (' · ' + nm) : ''), 14, H - 11);
    }
  };
  draw();
  if (!img.complete) img.onload = draw;
  return canvas;
}

// ============================================================
// ロングパス専用カットイン（tools/proto/longpass-cutin-wide.html を実試合へ移植）。
//   横長スタジアム背景（静的・1回キャッシュ）＋ 2フレームのキックスプライト（a=構え→b=蹴り）＋
//   コード描画のサッカーボール（五角形パネル・モーションゴースト）。攻撃側チーム色をアクセントに。
//   canvas を返し live-field-wrap に差し込まれる。detach されたら rAF ループを止める（リーク防止）。
// ============================================================
var _lpBgCache = null;
function _lpBg() {                         // 横長背景（空・観客席・芝ストライプ）を一度だけ生成
  if (_lpBgCache) return _lpBgCache;
  var W = 480, H = 216;
  var bg = document.createElement('canvas'); bg.width = W; bg.height = H;
  var b = bg.getContext('2d');
  var s = 42; function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
  var g = b.createLinearGradient(0, 0, 0, 118); g.addColorStop(0, '#6a90e8'); g.addColorStop(1, '#7fa0ee'); b.fillStyle = g; b.fillRect(0, 0, W, 118);
  for (var i = 0; i < 26; i++) { var cx = rnd() * W, cy = 12 + rnd() * 70, cw = 14 + rnd() * 16; b.fillStyle = 'rgba(255,255,255,.85)'; b.beginPath(); b.ellipse(cx, cy, cw, cw * 0.4, 0, 0, 7); b.fill(); }
  b.fillStyle = '#3a3f6a'; b.fillRect(0, 84, W, 34);
  for (var j = 0; j < W * 34 / 7; j++) { var x = rnd() * W | 0, y = 84 + rnd() * 34 | 0; b.fillStyle = ['#cfd8ff', '#fff', '#e3a9c8', '#9fb0f0'][rnd() * 4 | 0]; b.fillRect(x, y, 2, 2); }
  b.fillStyle = '#5a5f86'; b.fillRect(0, 116, W, 4);
  var pg = b.createLinearGradient(0, 120, 0, H); pg.addColorStop(0, '#2f8f3a'); pg.addColorStop(1, '#256e2c'); b.fillStyle = pg; b.fillRect(0, 120, W, H - 120);
  b.fillStyle = '#2b8636'; for (var k = 0; k < W; k += 48) b.fillRect(k, 120, 24, H - 120);
  b.fillStyle = 'rgba(255,255,255,.45)'; b.fillRect(0, 128, W, 2);
  _lpBgCache = bg; return bg;
}
var _foulBgCache = null;
function _foulBg() {                        // ファール（主審ドアップ）専用の青空主体背景。地平線を大きく下げ、
  if (_foulBgCache) return _foulBgCache;    //   上半身の背後を青空にする。遠景に薄いスタンド帯＋足元の芝ストライプ。
  var W = 480, H = 216;
  var bg = document.createElement('canvas'); bg.width = W; bg.height = H;
  var b = bg.getContext('2d');
  var s = 91; function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
  var horizon = 172;
  // 青空グラデ（上ほど濃い抜けるような青→地平線付近で淡く）
  var g = b.createLinearGradient(0, 0, 0, horizon); g.addColorStop(0, '#3f74d8'); g.addColorStop(0.6, '#5f92e6'); g.addColorStop(1, '#bcd4f4'); b.fillStyle = g; b.fillRect(0, 0, W, horizon);
  // 太陽グロー（右上・主審が指す方向側）
  var sun = b.createRadialGradient(392, 44, 6, 392, 44, 96); sun.addColorStop(0, 'rgba(255,252,232,.85)'); sun.addColorStop(1, 'rgba(255,252,232,0)'); b.fillStyle = sun; b.fillRect(0, 0, W, horizon);
  // ふんわり雲（大小・2層で厚みを出す）
  for (var i = 0; i < 16; i++) {
    var cx = rnd() * W, cy = 16 + rnd() * 118, cw = 16 + rnd() * 26, ch = cw * (0.32 + rnd() * 0.14);
    b.fillStyle = 'rgba(255,255,255,' + (0.5 + rnd() * 0.4).toFixed(2) + ')';
    b.beginPath(); b.ellipse(cx, cy, cw, ch, 0, 0, 7); b.fill();
    b.fillStyle = 'rgba(255,255,255,.35)';
    b.beginPath(); b.ellipse(cx + cw * 0.5, cy + ch * 0.4, cw * 0.7, ch * 0.8, 0, 0, 7); b.fill();
  }
  // 遠景スタンド（地平線上の薄い帯・存在を示す程度）
  b.fillStyle = 'rgba(58,63,106,.55)'; b.fillRect(0, horizon - 10, W, 10);
  for (var j = 0; j < W * 10 / 10; j++) { var x = rnd() * W | 0, y = horizon - 10 + (rnd() * 10 | 0); b.fillStyle = ['rgba(207,216,255,.5)', 'rgba(255,255,255,.5)', 'rgba(159,176,240,.5)'][rnd() * 3 | 0]; b.fillRect(x, y, 2, 2); }
  b.fillStyle = 'rgba(90,95,134,.7)'; b.fillRect(0, horizon - 1, W, 2);
  // 芝（足元・ストライプ）
  var pg = b.createLinearGradient(0, horizon, 0, H); pg.addColorStop(0, '#349940'); pg.addColorStop(1, '#256e2c'); b.fillStyle = pg; b.fillRect(0, horizon, W, H - horizon);
  b.fillStyle = '#2b8636'; for (var k = 0; k < W; k += 48) b.fillRect(k, horizon, 24, H - horizon);
  b.fillStyle = 'rgba(255,255,255,.4)'; b.fillRect(0, horizon + 6, W, 2);
  _foulBgCache = bg; return bg;
}
function _lpPent(ctx, cx, cy, rad, rot) { ctx.beginPath(); for (var i = 0; i < 5; i++) { var a = rot + i * 1.2566 - 1.5708, px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); ctx.fill(); }
// カットシーンの人物・ボールの共通縮小率。スルーパス(2/3)に合わせ他シーンも順次適用（2026-07-23）。
// 各シーンで人物の描画高(ph相当)とボール半径に掛け、寄りの構図を「引き」に統一する。
var CS_FIGURE_SCALE = 0.83;   // 中間サイズ確認（2/3と等倍の中間・2026-07-23）

function _lpBall(ctx, x, y, r, spin) {     // 正しいサッカーボール（中央＋外周の五角形パネル）
  ctx.globalAlpha = 0.18; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + r * 1.4, y, r * 0.85, 0, 7); ctx.fill(); ctx.globalAlpha = 1; // モーションゴースト
  ctx.fillStyle = '#14101a'; ctx.beginPath(); ctx.arc(x, y, r * 1.14, 0, 7); ctx.fill();
  ctx.fillStyle = '#f6f6f6'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.beginPath(); ctx.arc(x + r * 0.3, y + r * 0.3, r * 0.85, 0, 7); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip();
  ctx.fillStyle = '#15151d'; ctx.strokeStyle = '#15151d'; ctx.lineWidth = Math.max(1.2, r * 0.11); ctx.lineJoin = 'round';
  _lpPent(ctx, x, y, r * 0.46, spin);
  for (var i = 0; i < 5; i++) {
    var a = spin + i * 1.2566 - 1.5708, ox = x + Math.cos(a) * r * 1.02, oy = y + Math.sin(a) * r * 1.02;
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.46, y + Math.sin(a) * r * 0.46); ctx.lineTo(ox, oy); ctx.stroke();
    _lpPent(ctx, ox, oy, r * 0.42, a + 0.628);
  }
  ctx.restore();
}
// 差し替え用スタジアム背景（選手・ボールなしの1枚絵）。存在すればこれを cover-fit で敷き、
// 無ければ（404）コード描画の _lpBg() にフォールバックする。チーム色非依存の共通背景。
var _LP_BG_SRC = 'img/cutscenes/longpass_bg_01.png';
function _lpDrawBg(ctx, img, fallbackCanvas, W, H) {
  /* BG3D-01（2026-07-28・実験）: ローポリ3Dスタジアム背景へ差し替える。
   * ★ three.js はラボページ側だけに置き（_scene_lab.html の module script が window.CS_BG3D を生やす）、
   *   ここは typeof ガードで呼ぶだけ＝本番(docs/)には一切載らない。既存の lab-only 方針と同じ作法。
   * ★ 呼び出し側（各シーン）は無改修。**いま ctx に掛かっているカメラ変換を読み取って** 3Dカメラへ渡す。
   *   こうすると 2D側の寄り/パン/ミラーがそのまま3Dのドリー/横移動になり、擬似パララックスが本物に変わる。
   *   ★ 3D側が動きを担うので、2Dの変換は一旦解除してから描く（二重に掛けない）。 */
  if (typeof window !== 'undefined' && window.CS_BG3D_ENABLED && window.CS_BG3D && window.CS_BG3D.draw && ctx.getTransform) {
    var m = ctx.getTransform();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    window.CS_BG3D.draw(ctx, W, H, { zoom: Math.abs(m.a) || 1, panX: m.e, panY: m.f, mirror: m.a < 0 });
    ctx.restore();
    return;
  }
  if (img && img.complete && img.naturalWidth) {
    var s = Math.max(W / img.naturalWidth, H / img.naturalHeight);   // cover
    var dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    ctx.drawImage(fallbackCanvas, 0, 0);
  }
  _bgTone(ctx, W, H);
}

/* ── BGトーン（BG-TONE-01・2026-07-29・lab限定 `window.CS_BG_TONE_ENABLED`）───────────
 * 背景の1枚絵は観客席が明るく高コントラストで、**主役より大きな声で喋っている**。
 * 同じ失敗を引き画(WIDE-01)と3D背景(BG3D-01)でもやって直したので、ここにも同じ処方を当てる。
 *   ★ 原則: 背景に要るのは「情報量」であって「明度」ではない。
 *     密度（賑わい）は一切減らさず、上部（観客帯）と左右端の**声量だけ**を下げる。
 *     結果、画面の明るさの山が中央の主役に1つだけ残る。
 * ★ **絵を作り直さない**のが要点。生成→受入検査(asset-qa)のループは実績として何日も掛かるので、
 *   描画時の後処理で解けるならそちらが速いし、全背景に一律で効く。
 * ★ 公開ビルドは既定OFF（フラグ未定義）＝本番凍結を守る。lab の index.html で true にする。 */
var _bgToneC = null, _bgToneKey = '';
function _bgTone(ctx, W, H) {
  if (typeof window === 'undefined' || !window.CS_BG_TONE_ENABLED) return;
  var top = Math.ceil(H * 0.74);          // 観客帯の下端の目安（芝には掛けない）
  /* ★ ここは各シーンの「寄りのズーム変換が掛かった ctx」の中で呼ばれる（例: ロングパスは z=1.10）。
   *   0..W,0..H ちょうどで塗ると寄った時に画面端が覆われず素の背景が細く残る。
   *   背景画像自体も cover ではみ出しているので、上下左右に余白 M を持たせて塗る。 */
  var M = Math.ceil(Math.max(W, H) * 0.25);

  /* ①彩度を落とす。★ この関数は「背景を描いた直後・選手を描く前」に呼ばれるので、
   *   composite を使っても前景には一切掛からない。観客の青の押しの強さが消え、
   *   芝の緑は下側なのでほぼ無傷で残る＝**主役と芝が色を持ち、観客だけが色を手放す**。 */
  ctx.save();
  ctx.globalCompositeOperation = 'saturation';
  var sg = ctx.createLinearGradient(0, -M, 0, top);
  sg.addColorStop(0, 'hsla(0,28%,50%,1)');
  sg.addColorStop(0.75, 'hsla(0,28%,50%,0.75)');
  sg.addColorStop(1, 'hsla(0,28%,50%,0)');
  ctx.fillStyle = sg; ctx.fillRect(-M, -M, W + M * 2, top + M);
  ctx.restore();

  // ②明度を落とす＋左右端を落とす（この2枚は静的なので焼いて使い回す）
  var key = W + 'x' + H;
  if (!_bgToneC || _bgToneKey !== key) {
    var c = document.createElement('canvas'); c.width = W + M * 2; c.height = H + M * 2;
    var x = c.getContext('2d');
    x.translate(M, M);                                   // 論理原点を (0,0) に合わせる
    var g = x.createLinearGradient(0, -M, 0, top);
    g.addColorStop(0, 'rgba(8,14,26,0.60)');
    g.addColorStop(0.55, 'rgba(8,14,26,0.40)');
    g.addColorStop(0.86, 'rgba(8,14,26,0.15)');
    g.addColorStop(1, 'rgba(8,14,26,0)');
    x.fillStyle = g; x.fillRect(-M, -M, W + M * 2, top + M);
    // 左右端は「背景画像の端」に合わせるので 0..W 基準のまま。外側は最も暗い値で埋める。
    var e = x.createLinearGradient(0, 0, W, 0);
    e.addColorStop(0, 'rgba(4,8,16,0.42)'); e.addColorStop(0.26, 'rgba(4,8,16,0)');
    e.addColorStop(0.74, 'rgba(4,8,16,0)'); e.addColorStop(1, 'rgba(4,8,16,0.42)');
    x.fillStyle = e; x.fillRect(0, -M, W, H + M * 2);
    x.fillStyle = 'rgba(4,8,16,0.42)';
    x.fillRect(-M, -M, M, H + M * 2); x.fillRect(W, -M, M, H + M * 2);
    _bgToneC = c; _bgToneKey = key;
  }
  ctx.drawImage(_bgToneC, -M, -M);
}

/* ── 非主語トーン（SUBDUE-01・2026-07-29）─────────────────────────────────
 * デイヴ・ザ・ダイバーのボス戦フレームを自分で並べて分かった規則の実装。
 * 巨体のタコは**ディテールほぼゼロの赤いベタの塊**で、精密なのは**目だけ**。
 * つまり1枚の絵の中で「主語に情報量を全振りし、それ以外はシルエットまで落とす」が起きている。
 *   ★ うちは対決割りでシューターもGKも**同じ描き込み量**で描いていた＝主語が2つ＝主語なし。
 *   ★ [[art-one-shot-one-subject]] ②「情報量とコントラストは別物」。ここで落とすのは
 *     彩度と明度＝**声量**だけで、線の本数（密度）は1本も減らさない。
 *   ★ _bgTone と同じく**絵を作り直さない**。生成→受入検査のループを回さずに済むのが利点。
 * スプライト1枚につき1回だけ焼いてキャッシュする（毎フレームの合成は重い）。
 */
var _subdueCache = {};
function _csSubdue(spr, key, opts) {
  if (!spr || !spr.width || typeof document === 'undefined') return spr;
  var o = opts || {};
  var sat = (o.sat == null) ? 0.42 : o.sat;      // 残す彩度（0=完全なグレー / 1=無加工）
  var dark = (o.dark == null) ? 0.34 : o.dark;   // かぶせる暗色の濃さ
  var ck = key + '|sub|' + sat + '|' + dark;
  if (_subdueCache[ck]) return _subdueCache[ck];
  var c = document.createElement('canvas');
  c.width = spr.width; c.height = spr.height;
  var x = c.getContext('2d');
  x.drawImage(spr, 0, 0);
  // ①彩度を落とす（saturation ブレンドで無彩色を重ねる＝色相と明度は保つ）
  x.globalCompositeOperation = 'saturation';
  x.fillStyle = 'hsla(0,0%,50%,' + (1 - sat).toFixed(3) + ')';
  x.fillRect(0, 0, c.width, c.height);
  // ②明度を落とす
  x.globalCompositeOperation = 'source-over';
  x.globalAlpha = dark; x.fillStyle = '#0a0d16';
  x.fillRect(0, 0, c.width, c.height);
  x.globalAlpha = 1;
  // ③①②は透明部分も塗ってしまうので、元のアルファで型抜きして輪郭を戻す
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(spr, 0, 0);
  _subdueCache[ck] = c;
  return c;
}

// 失敗（カット）タブロー用: 赤×緑の2人絵を、実行時に赤→守備色・緑→攻撃色へ色替え。
// recolor.js の KITS を実行時用に移植（_colorBucket と同じバケツ→同じパレットに揃える）。色ペアでキャッシュ。
var _LP_FAIL_SRC = 'img/cutscenes/longpass_fail.png';
var _LP_KIT_SPEC = {
  red:     { hue: 0 }, blue: { hue: 222 }, green: { hue: 135 },
  yellow:  { hue: 48, sat: 0.95 }, orange: { hue: 26, sat: 0.95 },
  skyblue: { hue: 202, sat: 0.5, ladd: 0.18 }, dark: { hue: 222, lmul: 0.5 }, white: { white: true }
};
function _lpRgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h, s, l = (mx + mn) / 2;
  if (mx === mn) { h = s = 0; }
  else { var d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    switch (mx) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; } h /= 6; }
  return [h * 360, s, l];
}
function _lpHue2rgb(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
function _lpHsl2rgb(h, s, l) {
  h /= 360; var r, g, b;
  if (s === 0) { r = g = b = l; }
  else { var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = _lpHue2rgb(p, q, h + 1 / 3); g = _lpHue2rgb(p, q, h); b = _lpHue2rgb(p, q, h - 1 / 3); }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
function _lpApplyKit(spec, h, s, l) {
  if (!spec) return null;
  if (spec.white) return _lpHsl2rgb(0, 0, Math.min(0.92, l + 0.22));
  var nl = spec.lmul ? l * spec.lmul : l; if (spec.ladd) nl += spec.ladd;
  nl = Math.max(0, Math.min(0.95, nl));
  return _lpHsl2rgb(spec.hue, spec.sat || s, nl);
}
var _lpFailCache = {};
function _lpFailSprite(base, atkColor, defColor) {
  if (!base || !base.complete || !base.naturalWidth) return null;     // 未ロードはスキップ（後フレームで再試行）
  var atkKit = _colorBucket(atkColor) || 'blue';   // 緑=パサー → 攻撃色
  var defKit = _colorBucket(defColor) || 'red';    // 赤=カット守備 → 守備色
  var key = atkKit + '|' + defKit;
  if (_lpFailCache[key]) return _lpFailCache[key];
  var w = base.naturalWidth, hgt = base.naturalHeight;
  var cv = document.createElement('canvas'); cv.width = w; cv.height = hgt;
  var c = cv.getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(base, 0, 0);
  var im; try { im = c.getImageData(0, 0, w, hgt); } catch (e) { return null; }   // same-origin前提・taint保険
  var d = im.data, atkSpec = _LP_KIT_SPEC[atkKit], defSpec = _LP_KIT_SPEC[defKit];
  for (var i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;                                       // 透過はスキップ
    var hsl = _lpRgb2hsl(d[i], d[i + 1], d[i + 2]), h = hsl[0], s = hsl[1], l = hsl[2];
    if (s > 0.4 && l > 0.15 && l < 0.78) {
      var v = null;
      if (h < 18 || h > 342) v = _lpApplyKit(defSpec, h, s, l);       // 赤キット → 守備色
      else if (h > 85 && h < 165) v = _lpApplyKit(atkSpec, h, s, l);  // 緑キット → 攻撃色（肌h~30は保持）
      if (v) { d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; }
    }
  }
  c.putImageData(im, 0, 0);
  _lpFailCache[key] = cv; return cv;
}

// 単一バンドrecolor（別スプライト用）: 緑 or 赤の領域だけをチーム色へ（肌・髪・スパイクは保持）。srcId+band+kit でキャッシュ。
var _csBandCache = {};
function _csRecolorBand(base, band, kitColor, srcId) {
  if (!base || !base.complete || !base.naturalWidth) return null;
  var kit = _colorBucket(kitColor) || 'blue';
  var key = (srcId || '') + '|' + band + '|' + kit;
  if (_csBandCache[key]) return _csBandCache[key];
  var w = base.naturalWidth, hgt = base.naturalHeight;
  var cv = document.createElement('canvas'); cv.width = w; cv.height = hgt;
  var c = cv.getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(base, 0, 0);
  var im; try { im = c.getImageData(0, 0, w, hgt); } catch (e) { return null; }
  var d = im.data, spec = _LP_KIT_SPEC[kit];
  for (var i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    var hsl = _lpRgb2hsl(d[i], d[i + 1], d[i + 2]), h = hsl[0], s = hsl[1], l = hsl[2];
    if (s > 0.4 && l > 0.15 && l < 0.78) {
      var inBand = (band === 'green') ? (h > 85 && h < 165) : (band === 'blue') ? (h > 195 && h < 255) : (h < 18 || h > 342);
      if (inBand) { var v = _lpApplyKit(spec, h, s, l); if (v) { d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; } }
    }
  }
  c.putImageData(im, 0, 0);
  _csBandCache[key] = cv; return cv;
}
// ボレーシュート: ロングパスの蹴りアニメをそのまま流用し、ボール起点だけ軸足の膝あたりへ上げる。
function _renderVolleyScene(sc) {
  var entry = _pickCutscene('longpass', sc.offence && sc.offence.team_color);
  if (!entry || !entry.fileA) return null;   // longpass スプライト（蹴り）を借用
  return _renderLongpassScene(sc, entry, { footX: 260, footY: 108, straightFast: true, enLabel: 'VOLLEY' });
}
function _renderLongpassScene(sc, entry, opts) {
  var W = 480, H = 216, ground = 190;
  var canvas = document.createElement('canvas');
  // マンガ絵経路のみ内部2倍＋スムージング（NN縮小ジャギ対策 2026-07-15）。従来ドット絵経路（公開ビルド）は等倍＋pixelated維持。
  var SS = 1;   // 等倍＋NNへ復帰（レトロ画素感 2026-07-15）。粗ドット化は _csPixelate 前段の高品質縮小が担う
  canvas.width = W * SS; canvas.height = H * SS;
  canvas.style.cssText = 'display:block;width:100%' + (SS > 1 ? '' : ';image-rendering:pixelated');
  var ctx = canvas.getContext('2d');
  if (SS > 1) ctx.scale(SS, SS);
  var A = _loadCutsceneImg(entry.fileA), B = _loadCutsceneImg(entry.fileB);
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var accent = (sc.offence && sc.offence.team_color) || '#1f4fd6';

  // HUD データ（このシーン中は不変なので一度だけ読む）
  var gs = (typeof gameState !== 'undefined' && gameState) ? gameState : {};
  var t1 = gs.team1, t2 = gs.team2;
  var c1 = (t1 && t1.team_color) || '#1f4fd6', c2 = (t2 && t2.team_color) || '#e36b1f';
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display'), s1 = dom('score1'), s2 = dom('score2');
  var passer = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var passerName = passer ? ((typeof getPlayerName === 'function') ? getPlayerName(passer) : passer.name) : '';
  var teamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var actLabel = en ? ((opts && opts.enLabel) || 'LONG PASS') : (sc.action || 'ロングパス');

  // 失敗（カット/インターセプト）演出: 赤×緑の2人タブローに差し替え。守備選手＝カットした側。
  var fail = (sc.result === '失敗' || sc.result === 'カウンター');
  var failBase = fail ? _loadCutsceneImg(_LP_FAIL_SRC) : null;
  var atkColor = accent;
  var defColor = (sc.defence && sc.defence.team_color) || '#e36b1f';
  var defender = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[sc.dfsPos]];
  var defenderName = defender ? ((typeof getPlayerName === 'function') ? getPlayerName(defender) : defender.name) : '';
  var defTeamNm = (typeof getTeamName === 'function' && sc.defence) ? getTeamName(sc.defence) : '';
  var cutLabel = en ? 'CUT!' : 'カット！';

  function speedLines(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 16, y + Math.sin(an) * 16); ctx.lineTo(x + Math.cos(an) * 70, y + Math.sin(an) * 70); ctx.stroke(); } }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;   // 焼き込みラベル停止（時刻/アクション名/選手名はHUD・ネーム枠へ集約）
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    // ミニスコア（色チップ＋略称＋スコア）はスコアボードへ集約のため非表示。時間(左上)とラベル/選手名は残す。
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = fail ? defColor : accent; ctx.fillRect(0, H - 30, W, 3);  // 失敗は守備チーム色
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    var lbl = fail ? cutLabel : actLabel;
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(lbl, 12, H - 9);
    ctx.fillStyle = fail ? '#ff5a3c' : '#ffe14a'; ctx.fillText(lbl, 12, H - 9);
    var nm2 = fail ? (defenderName ? ('✕ ' + defenderName + (defTeamNm ? (' · ' + defTeamNm) : '')) : '')
                   : (passerName ? (passerName + (teamNm ? (' · ' + teamNm) : '')) : '');
    if (nm2) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(nm2, W - 12, H - 10); }
  }

  var ph = 178, pcx = 326, foot = [(opts && opts.footX != null) ? opts.footX : 256, (opts && opts.footY != null) ? opts.footY : 178], goal = [-30, 50], strikeP = 0.10, P = 2000;
  if (opts && opts.straightFast) { goal = [-130, foot[1]]; }   // ボレー: 真っ直ぐ（水平・launch高さ）
  // 漫画ロングパス（lab・2026-07-15）: 成功かつ非ボレー時、単一スプライトを passer の髪型で読み、チームキット4色＋肌でリカラー。
  //   本番(MangaRecolor未ロード)や素材未達(_lpImg未読)は従来の焼き込みA/B（entry.fileA/B）へ自動フォールバック。
  var _lpManga = !fail && !(opts && opts.straightFast) && (typeof MangaRecolor !== 'undefined' && MangaRecolor.render);
  var _lpFeat = _lpManga ? _mangaFeat(passer ? (passer.long_name || passer.name || '') : '') : null;
  var _lpCols = _lpManga ? _mangaColors(sc.offence, _lpFeat.skin) : null;
  var _lpKey = _lpManga ? ('lp|' + _lpFeat.hstyle + '|' + _lpCols.shirt + _lpCols.shorts + _lpCols.socks + _lpCols.accent + _lpCols.skin) : null;
  var _lpImg = _lpManga ? _loadCutsceneImg('img/cutscenes/manga_longpass/' + _lpFeat.hstyle + '.png') : null;
  var _LP_FOOT_FX = 0.31, _LP_FOOT_FY = 0.93;   // 軸足ブーツ（下側・実測0.314/0.944）＝ボール射出点フラクション（2026-07-15 ユーザー指示で蹴り足0.12/0.61から軸足付近へ下げ）
  var _LP_FOOT_DX = -20, _LP_FOOT_DY = -20;     // 軸足に乗らないよう「蹴り出す向き(native -x)＋上」へ微調整＝flip込みで画面上は右上（logical px・2026-07-15）
  if (_lpManga) { strikeP = 0.02; }             // シュート同様に即発射（待ちフレームほぼ無し・2026-07-15）
  var ballWin = (opts && opts.straightFast) ? 0.11 : (_lpManga ? 0.10 : 0.22);   // マンガ経路=速く飛ぶ（シュート相当）/ 従来焼き込みA/Bは従来速度
  var flipH = _csAttackRight(sc);                              // ネイティブ=左攻め → team1(右)で反転
  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return; // 差し替えで外れたら停止
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);   // 1回だけ再生（ループしない）。p=1 でフォロースルーに静止
    ctx.clearRect(0, 0, W, H);
    var ballGone = false;   // ボールが画面外へ消えたら即終了（2026-07-16 ユーザー指定・尺の余りを詰める）
    if (!fail) {
      // ===== 成功: 通しの蹴り演出（構え→蹴り→前進） =====
      // 漫画スプライトが用意できていれば単一絵をリカラー描画（構え/蹴りの2フレームは使わない）。射出点fptは蹴り足ブーツへ。
      var mspr = null, mpw = 0, fpt = foot;
      if (_lpManga && _lpImg.complete && _lpImg.naturalWidth) {
        mspr = MangaRecolor.render(_lpKey, _lpImg, _lpCols);
        mpw = mspr.width * (ph / mspr.height);
        fpt = [pcx - mpw / 2 + mpw * _LP_FOOT_FX + _LP_FOOT_DX, (ground - ph) + ph * _LP_FOOT_FY + _LP_FOOT_DY];
        mspr = _csPixelate(mspr, _lpKey, mpw, ph);   // レトロ画素化（高品質縮小→NN拡大）
      }
      var z = 1.0 + Math.min(1, p / 0.7) * 0.10;                          // 寄りのズーム
      ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.translate(fpt[0], fpt[1]); ctx.scale(z, z); ctx.translate(-fpt[0], -fpt[1]);
      ctx.imageSmoothingEnabled = SS > 1 && !!mspr; _lpDrawBg(ctx, bgImg, bgFallback, W, H);   // マンガ絵=スムージング / ドット絵A/B=NN維持
      if (mspr) { ctx.drawImage(mspr, pcx - mpw / 2, ground - ph, mpw, ph); }   // 漫画: 単一リカラー絵
      else { var pl = (p < strikeP) ? A : B;                              // 従来: 構え→蹴りの焼き込みA/B
        if (pl.complete && pl.naturalWidth) { var pw = pl.naturalWidth * (ph / pl.naturalHeight); ctx.drawImage(pl, pcx - pw / 2, ground - ph, pw, ph); } }
      if (p < strikeP) { _lpBall(ctx, fpt[0], fpt[1], 13, 0); }
      else if (p < strikeP + ballWin) { var u = (p - strikeP) / ballWin, bx = fpt[0] + (goal[0] - fpt[0]) * u, by = fpt[1] + (goal[1] - fpt[1]) * u; if (opts && opts.straightFast) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + 54, by); ctx.stroke(); ctx.lineCap = 'butt'; } _lpBall(ctx, bx, by, 13, u * (opts && opts.straightFast ? 34 : 16)); }
      else { ballGone = true; }   // ボールが goal 到達点（画面外）まで飛びきった＝終了
      var strike = (p > strikeP - 0.02 && p < strikeP + 0.08) ? 1 - Math.abs(p - strikeP) / 0.08 : 0;
      if (strike > 0) speedLines(fpt[0], fpt[1], strike * 0.6);
      ctx.restore();
      if (strike > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (strike * 0.5) + ')'; ctx.fillRect(0, 0, W, H); } // 着弾フラッシュ
    } else {
      // ===== 失敗: カット・タブロー（赤×緑を守備色/攻撃色に色替え＋ボールが弾かれる） =====
      var sh = 188, sw = sh * (180 / 135), sx = (W - sw) / 2, sy = 204 - sh;  // 2人絵の配置
      var footX = sx + sw * 0.72, footY = sy + sh * 0.85;                     // スライディング選手の伸ばした右足の「つま先」＝起点
      var kickP = 0.10, ballSpd = 1424;                                       // 成功ロングパスと同じ速度（px / 単位p）
      var z2 = 1.0 + Math.min(1, p / 0.5) * 0.06;
      ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.translate(footX, footY); ctx.scale(z2, z2); ctx.translate(-footX, -footY);
      ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);
      var spr = _lpFailSprite(failBase, atkColor, defColor);
      if (spr) ctx.drawImage(spr, sx, sy, sw, sh);
      // ボール: 伸ばした足のブーツから、フィールドと水平に右へ（成功時と同速）。画面外で消える。
      if (p < kickP) { _lpBall(ctx, footX, footY, 13, 0); }                                            // ブーツで待つ
      else { var bx = footX + ballSpd * (p - kickP); if (bx < W + 22) _lpBall(ctx, bx, footY, 13, (p - kickP) * 73); else ballGone = true; } // 水平に右へ・画面外に出たら終了
      var flashF = (p > kickP - 0.02 && p < kickP + 0.08) ? 1 - Math.abs(p - kickP) / 0.08 : 0;
      if (flashF > 0) speedLines(footX, footY, flashF * 0.6);
      ctx.restore();
      if (flashF > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (flashF * 0.5) + ')'; ctx.fillRect(0, 0, W, H); } // カット衝撃フラッシュ
    }
    hud();
    // ボールが画面外へ消えたら即終了（静止）。ただし失敗で2人絵がまだロード中なら、ロード完了まで継続（差し替え漏れ防止）。
    if ((!ballGone && p < 1) || (fail && failBase && !failBase.complete)) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // 成功=蹴り手が pcx=326（右1/3・0.68）／失敗=2人タブローは中央（~0.5）。フリップ込みで主役を可視窓中央へ。
  return _csCenterSubject(canvas, fail ? 0.50 : (pcx / W), flipH);
}

// ロングパス拍2＝守備選手の反応（2026-07-16 ユーザー指定でロングパスを2シーン化）。
//   単一の守備選手スプライト（キット4色＋肌でリカラー、髪型は_mangaFeat準拠）を配置し、
//   ボールが画面右から水平に飛来する: 成功=守備の伸ばした手の高さを素通りしてそのまま画面外へ（無接触）。
//   失敗/カウンター=守備のブーツ付近で衝突→跳ね返る（インパクトのバースト＋フラッシュ）。
//   本番(MangaRecolor未ロード)はnull→呼び出し側のフォールバックへ。
var _MANGA_LONGPASS_DF_DIR = 'img/cutscenes/manga_longpass_df/';
function _renderLongpassResultScene(sc) {
  if (typeof MangaRecolor === 'undefined' || !MangaRecolor.render) return null;
  var W = 480, H = 216, ground = 196;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();

  var success = (sc.result === '成功');
  var defP = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[sc.dfsPos]];
  var defName = defP ? ((typeof getPlayerName === 'function') ? getPlayerName(defP) : defP.name) : '';
  var defTeamNm = (typeof getTeamName === 'function' && sc.defence) ? getTeamName(sc.defence) : '';
  var defFeat = _mangaFeat(defP ? (defP.long_name || defP.name || '') : '');
  var defCols = _mangaColors(sc.defence, defFeat.skin);
  var defKey = 'lpdf|' + defFeat.hstyle + '|' + defCols.shirt + defCols.shorts + defCols.socks + defCols.accent + defCols.skin;
  var defImg = _loadCutsceneImg(_MANGA_LONGPASS_DF_DIR + defFeat.hstyle + '.png');

  var accent = success ? ((sc.offence && sc.offence.team_color) || '#1f4fd6') : ((sc.defence && sc.defence.team_color) || '#e36b1f');
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = success ? (en ? 'THROUGH!' : 'スルー！') : (en ? 'CUT!' : 'カット！');
  var labelCol = success ? '#ffe14a' : '#ff5a3c';

  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display');

  var ph = 190, sx = W * 0.34, sy = ground - ph;         // 守備の描画枠
  var flipH = _csAttackRight(sc);                        // ネイティブ=左攻め→右へのボール。キック拍(_renderLongpassScene)と同じ規約
  var P = 1300;

  function burst(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12); ctx.lineTo(x + Math.cos(an) * 50, y + Math.sin(an) * 50); ctx.stroke(); } }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = labelCol; ctx.fillText(label, 12, H - 9);
    if (!success && defName) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('✕ ' + defName + (defTeamNm ? (' · ' + defTeamNm) : ''), W - 12, H - 10); }
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    _lpDrawBg(ctx, bgImg, bgFallback, W, H);

    var spr = (defImg.complete && defImg.naturalWidth) ? MangaRecolor.render(defKey, defImg, defCols) : null;
    var dw = spr ? spr.width * (ph / spr.height) : 0;
    var dx = sx;

    var launchP = 0.06, spd = 2300, bx = null, by = null, impact = 0;
    if (success) {
      by = sy + ph * 0.28;                               // 伸ばした手の高さ＝反応するが届かない
      if (p >= launchP) bx = W + 20 - spd * (p - launchP);
    } else {
      by = sy + ph * 0.85;                                // 足元の高さ
      var footX = dx + dw * 0.90;                         // ボール進入側（右寄り）のブーツ＝衝突点
      var hitDt = (W + 20 - footX) / spd;
      if (p >= launchP) {
        var dt = p - launchP;
        if (dt < hitDt) { bx = W + 20 - spd * dt; }
        else { var dd = dt - hitDt; bx = footX - spd * 0.6 * dd; by = by - spd * 0.5 * dd; }
        impact = (dt > hitDt - 0.02 && dt < hitDt + 0.10) ? 1 - Math.abs(dt - hitDt) / 0.10 : 0;
      }
    }
    if (spr) ctx.drawImage(spr, dx, sy, dw, ph);
    var ballOn = (bx !== null && bx > -30 && bx < W + 30 && by > -30 && by < H + 30);
    if (ballOn) _lpBall(ctx, bx, by, 12, p * 40);
    if (impact > 0) burst(bx, by, impact * 0.9);
    ctx.restore();
    if (impact > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (impact * 0.4) + ')'; ctx.fillRect(0, 0, W, H); }
    hud();
    // ボールが画面外へ消えたら即終了（静止・2026-07-16 ユーザー指定）。着弾直後(bx=null)はまだ終了させない。
    var ballGone = (bx !== null) && !ballOn && (p > launchP + 0.03);
    if (!ballGone && p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return _csCenterSubject(canvas, 0.5, false);
}

// GKのキット色を選ぶ: 両チーム（攻撃/守備）と別色＋「GKらしい色」優先（黄/暗/白）。
// 緑は背景（芝）に埋もれるため除外。
var _GK_PREF = ['yellow', 'dark', 'white', 'skyblue', 'orange', 'blue', 'red'];
function _pickGkColor(atkColor, defColor) {
  var atk = _colorBucket(atkColor), def = _colorBucket(defColor);
  for (var i = 0; i < _GK_PREF.length; i++) { var k = _GK_PREF[i]; if (k !== atk && k !== def) return k; }
  return 'yellow';
}
// 漫画GKダイビング（lab・2026-07-10）: 分離色スプライト1枚を _pickGkColor の色名→GKキット4色でリカラー。
//   白グローブは低彩度=MangaRecolor partOf 'fixed' で白のまま保持。本番(未ロード)は従来 gk_<color>_01.png。
var _MANGA_GK_DIVE_SRC = 'img/cutscenes/manga_gk_dive.png?v=5';   // v2=新ダイビング絵差し替え(2026-07-23)
// シューター用スプライトの読み込み先ディレクトリ。既定=manga_shot（本番挙動は不変）。
// 演出テストラボから window._LAB_SHOT_DIR に別ディレクトリ名を入れると差し替わり、新旧アートを比較できる。
function _shotSpriteDir() {
  var d = (typeof window !== 'undefined') && window._LAB_SHOT_DIR;
  return (typeof d === 'string' && /^[\w-]+$/.test(d)) ? d : 'manga_shot';
}
// GKダイブ絵のアスペクト（高さ/幅）。旧絵=220×127→0.577。新絵(2026-07-15・茶wavy・より縦に伸びるダイブ)=440×368→0.836。
// 描画は gkW を基準に gkH = gkW * _GK_DIVE_HW で算出（従来ハードコード 127/220 を置換）。手元グローブは新絵でも約(0.86,0.12)＝従来アンカーとほぼ一致。
var _GK_DIVE_HW = 334 / 440;   // 2026-07-23 新ダイビング絵（アスペクト保持440×334・reaching glove frac(0.857,0.130)≈アンカー0.84/0.13）
// GKダイブ絵のバリアント（2026-07-24 別ポーズ追加）。各絵はリカラー色窓共通・ポーズ別＝アスペクト/グローブアンカー/描画幅倍率が異なる。
//   hw=高さ/幅, gx/gy=reaching glove の絵内フラクション（ボール到達点アンカー）, ws=pose0基準の描画幅倍率。
//   シーン入場時に _pickGkDive() で1回だけ選択（frame内で毎回変えない＝アニメ中の絵ブレ防止）。表示層のみ＝エンジンrng不使用。
//   id=リカラー/ピクセル化キャッシュのキーに混ぜるポーズ識別子。**必ずポーズ別にすること**：
//   MangaRecolor と _csPixelate は spriteKey でベース画像ごとキャッシュするため、キーが同じだと
//   最初に描かれたポーズが焼き付き、以降どちらを抽選しても同じ絵が返る（2026-07-26 修正）。
var _GK_DIVES = [
  { id: 'p0', src: _MANGA_GK_DIVE_SRC, hw: _GK_DIVE_HW, gx: 0.85, gy: 0.13, ws: 1.00, rise: true, sc3Rev: false },          // pose0: 斜め上へ横っ飛び（reaching glove=右上・scene3は下→上の対角モーション）
  { id: 'p1', src: 'img/cutscenes/manga_gk_dive2.png?v=2', hw: 185 / 440, gx: 0.08, gy: 0.82, ws: 1.42, rise: false, sc3Rev: true, sc3: { x0: 195, x1: 160, y: 92 }, bg: 'img/cutscenes/gkdive2_bg_01.png' }  // pose1: 水平ダイブ（反転済・reaching glove=左下）。横長ゆえ幅1.42倍。scene3は縦移動なし＋専用配置（ゴールライン上・少し前＝左下）＋専用背景（ゴール裏フィールド）
];
/* ★ 2026-08-06 ユーザー判断: **pose1（水平ダイブ・ゴール裏背景）は不採用**。pose0 のみを使う。
 *   pose1 の定義・素材・専用配置(sc3)・専用背景はそのまま残してある＝復活は下の1行を戻すだけ。
 *   ラボの強制選択 window._LAB_GK_DIVE=1 では今も pose1 を確認できる（比較用）。 */
function _pickGkDive() {
  var o = (typeof window !== 'undefined') ? window._LAB_GK_DIVE : undefined;   // ラボ限定の強制選択
  if (o === 0 || o === 1) return _GK_DIVES[o];
  return _GK_DIVES[0];                                                          // 本番は pose0 固定（旧: Math.random()<0.5 で2種抽選）
}
var _GK_HEX = { yellow: '#f2c200', dark: '#2a2a33', white: '#e8e8ee', skyblue: '#3aa0e0', orange: '#e8641b', blue: '#1b5fd0', red: '#c8102e', green: '#1e8c3a' };
function _gkShade(hex, f) { var h = hex.replace('#', ''); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; var v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; return '#' + v.map(function (c) { var s = Math.round(c * f).toString(16); return s.length < 2 ? '0' + s : s; }).join(''); }
function _gkDiveColors(name, skin) { var main = _GK_HEX[name] || '#1b5fd0'; return { shirt: main, shorts: _gkShade(main, 0.42), socks: main, accent: '#eef0f5', skin: skin }; }

// ============================================================
// 漫画2拍演出（北極星カンプ 2026-07-12・lab限定）
//   拍1: シュート大ゴマの背景を芝/観客でなく「紙白＋放射スピード線＋ハーフトーン」へ（漫画文法）。
//   拍2: シュートアニメ終盤に守備側GKの顔カットイン帯が左下（攻撃方向反転時は右下）から斜めに食い込む。台詞なし。
//   ガード: 拍1=MangaRecolor / 拍2=Portrait が未ロードの公開ビルドでは一切発火しない＝従来演出のまま。
// ============================================================
var _MANGA_INK = '#14161c', _MANGA_PAPER = '#fbfaf5';

// 監督ビューアの再生速度に演出尺を追従させる（表示層のみ）。#mv-speed の「1×/2×/3×」表示を
// manager-match.js の _MV_SPEEDS と同値へ逆引きする。W杯モード等 #mv-speed が無い画面は null（従来尺）。
var _MV_BEAT_MS = { 1: 2400, 2: 1300, 3: 700 };
function _csBeatMs() {
  if (typeof document === 'undefined') return null;
  var el = document.getElementById('mv-speed');
  if (!el) return null;
  var m = /([123])/.exec(el.textContent || '');
  return m ? _MV_BEAT_MS[+m[1]] : null;
}

// 拍1背景: 紙白＋放射スピード線（太/細の2層・焦点から外向きに先細り）＋左下ハーフトーン網点。
//   決定論LCG＝毎回同じ絵。焦点(cx,cy)＝蹴り点。一度生成してキャッシュ（サイズ/焦点が同じ間は再利用）。
//   キャッシュは焦点別 dict（対決割り Var A が左右パネルで焦点違いの2枚を同フレームに使うため。1枚制だと毎フレーム再生成で重い）。
var _mangaShotBgCache = {}, _mangaShotBgOrder = [];
function _mangaShotBg(W, H, cx, cy) {
  var key = W + 'x' + H + '|' + Math.round(cx) + ',' + Math.round(cy);
  if (_mangaShotBgCache[key]) return _mangaShotBgCache[key];
  var c = document.createElement('canvas'); c.width = W; c.height = H;
  var b = c.getContext('2d');
  b.fillStyle = _MANGA_PAPER; b.fillRect(0, 0, W, H);
  var lc = document.createElement('canvas'); lc.width = W; lc.height = H;
  var l = lc.getContext('2d');
  var s = 7; function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
  var R = Math.sqrt(W * W + H * H);
  l.fillStyle = _MANGA_INK;
  function ray(a, hw, r0, al) {   // 中心へ先細りの三角スピード線
    l.globalAlpha = al;
    l.beginPath();
    l.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    l.lineTo(cx + Math.cos(a - hw) * R, cy + Math.sin(a - hw) * R);
    l.lineTo(cx + Math.cos(a + hw) * R, cy + Math.sin(a + hw) * R);
    l.closePath(); l.fill();
  }
  var i, N = 84;
  for (i = 0; i < N; i++) ray((i + rnd() * 0.9) * 6.2832 / N, 0.004 + rnd() * 0.011, 46 + rnd() * 44, 0.72 + rnd() * 0.28);
  var M = 150;
  for (i = 0; i < M; i++) ray((i + rnd()) * 6.2832 / M, 0.0012 + rnd() * 0.003, 74 + rnd() * 66, 0.45 + rnd() * 0.4);
  l.globalAlpha = 1;
  // 焦点付近をソフトに白抜き（主役の白場＝視線誘導。カンプの mask-image 相当）
  l.globalCompositeOperation = 'destination-out';
  var g = l.createRadialGradient(cx, cy, 0, cx, cy, 168);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.45, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  l.fillStyle = g; l.beginPath(); l.arc(cx, cy, 168, 0, 7); l.fill();
  b.drawImage(lc, 0, 0);
  // 左下ハーフトーン（中心から離れるほど薄い網点）
  var hx0 = W * 0.10, hy0 = H * 0.96, hr = Math.min(W, H) * 0.9;
  b.fillStyle = _MANGA_INK;
  for (var gy = 0; gy < H; gy += 5) {
    for (var gx = -3; gx < W; gx += 5) {
      var ddx = gx - hx0, ddy = gy - hy0, dist = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dist >= hr) continue;
      b.globalAlpha = 0.36 * (1 - dist / hr);
      b.beginPath(); b.arc(gx + ((gy / 5) & 1) * 2.5, gy, 1.05, 0, 7); b.fill();
    }
  }
  b.globalAlpha = 1;
  _mangaShotBgCache[key] = c; _mangaShotBgOrder.push(key);
  if (_mangaShotBgOrder.length > 8) delete _mangaShotBgCache[_mangaShotBgOrder.shift()];   // 焦点違いは数種のみ＝軽い上限
  return c;
}

// 主役スプライトの墨リム（紙白背景に白キットが溶けないよう2px縁取り用シルエット）。リカラー後canvas単位でキャッシュ。
var _csSilCache = {};
function _csInkSil(spr, key) {
  if (_csSilCache[key]) return _csSilCache[key];
  var c = document.createElement('canvas');
  c.width = spr.naturalWidth || spr.width; c.height = spr.naturalHeight || spr.height;
  var x = c.getContext('2d'); x.drawImage(spr, 0, 0);
  x.globalCompositeOperation = 'source-in'; x.fillStyle = _MANGA_INK; x.fillRect(0, 0, c.width, c.height);
  _csSilCache[key] = c; return c;
}

// 蹴り点のインパクト星（白抜き＋墨縁のギザ星・カンプの impact star）
function _csImpactStar(ctx, x, y, r) {
  ctx.beginPath();
  for (var i = 0; i < 18; i++) {
    var a = i * 0.349 - 0.42;
    var rr = (i & 1) ? r * 0.42 : r * (0.75 + ((i * 7) % 5) * 0.09);
    var px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = _MANGA_INK; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  ctx.fill(); ctx.stroke();
}

// 拍2: 顔カットイン帯（斜め上辺の墨枠＋紙面＋横集中線＋Portraitバスト・文字なし）を1枚に事前合成。
//   スライドは毎フレーム transform で行い、帯の中身は静的＝この canvas を描くだけ（軽量）。
function _buildShotCutinBand(bw, bh, bust) {
  bw = Math.ceil(bw); bh = Math.ceil(bh);
  var c = document.createElement('canvas'); c.width = bw; c.height = bh;
  var x = c.getContext('2d');
  x.beginPath(); x.moveTo(0, bh * 0.22); x.lineTo(bw, 0); x.lineTo(bw, bh); x.lineTo(0, bh); x.closePath();
  x.fillStyle = _MANGA_INK; x.fill();                                   // 墨枠
  x.beginPath(); x.moveTo(0, bh * 0.22 + 7); x.lineTo(bw - 6, 7); x.lineTo(bw - 6, bh); x.lineTo(0, bh); x.closePath();
  x.fillStyle = _MANGA_PAPER; x.fill();                                 // 内側の紙面
  x.save(); x.clip();
  // 横集中線（左右端で薄く・中央で濃く）
  var t = document.createElement('canvas'); t.width = bw; t.height = bh;
  var tx = t.getContext('2d'); tx.fillStyle = _MANGA_INK; tx.globalAlpha = 0.5;
  for (var y = 3; y < bh; y += 6) tx.fillRect(0, y, bw, 1.4);
  tx.globalAlpha = 1; tx.globalCompositeOperation = 'destination-in';
  var g = tx.createLinearGradient(0, 0, bw, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.3, 'rgba(0,0,0,1)'); g.addColorStop(0.7, 'rgba(0,0,0,1)'); g.addColorStop(0.97, 'rgba(0,0,0,0)');
  tx.fillStyle = g; tx.fillRect(0, 0, bw, bh);
  x.drawImage(t, 0, 0);
  // GKバスト（左寄せ・頭を大きく＝上下は帯からはみ出してクロップ。独立コマなので画風混在OK＝PT-06原則）
  var ih = bh * 1.5, iw = ih * (bust.width / bust.height);
  x.imageSmoothingEnabled = true;   // 絵画調ポートレートはスムージング有効の方が馴染む
  x.drawImage(bust, bw * 0.02, -0.22 * bh, iw, ih);
  x.restore();
  return c;
}

// ============================================================
// 漫画シュート構図バリエーション（2026-07-12・lab限定）
//   Var A=対角対決割り（右=シューター/左=GK大・ネイティブ）: _renderShotDuelScene
//   Var B=既存の2拍（大ゴマ→GK顔カットイン）: _renderShotScene 本体
//   選択は決定論ハッシュ（選手名＋試合時刻）。Math.random 不使用＝seed再現・回帰に不干渉。
// ============================================================
function _csShotVarHash(sc) {
  var a = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var d = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[sc.dfsPos]];
  var el = (typeof document !== 'undefined') && document.getElementById('game-time-display');
  var s = ((a && (a.long_name || a.name)) || '') + '|' + ((d && (d.long_name || d.name)) || '') + '|' + (el ? el.textContent : '');
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// ゴールネット簡易描画（薄墨の格子・軽いパース）。対決割りの左パネル奥＝GKの背後。
function _csDrawNet(ctx, x0, y0, w, h, alpha) {
  ctx.save();
  ctx.strokeStyle = 'rgba(20,22,28,' + alpha + ')'; ctx.lineWidth = 1;
  var cols = 7, rows = 6, i, t;
  for (i = 0; i <= cols; i++) {   // 縦糸（下辺を奥へ少しすぼめてパース感）
    t = i / cols;
    ctx.beginPath(); ctx.moveTo(x0 + w * t, y0); ctx.lineTo(x0 + w * (0.06 + t * 0.86), y0 + h); ctx.stroke();
  }
  for (i = 0; i <= rows; i++) {   // 横糸
    t = i / rows;
    ctx.beginPath(); ctx.moveTo(x0, y0 + h * t); ctx.lineTo(x0 + w, y0 + h * (t * 0.94)); ctx.stroke();
  }
  // 手前側のポスト（やや濃い縦線）
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20,22,28,' + Math.min(0.6, alpha * 2.4) + ')';
  ctx.beginPath(); ctx.moveTo(x0 + w, y0 - 6); ctx.lineTo(x0 + w, y0 + h + 6); ctx.stroke();
  ctx.restore();
}

// ボール軌道の脇を走る墨のジグザグ衝撃波（(x0,y0)→(x1,y1) の法線方向 off に平行・決定論LCG形状）。
function _csShockwave(ctx, x0, y0, x1, y1, off, amp, seed) {
  var dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy);
  if (len < 46) return;
  var nx = -dy / len, ny = dx / len;
  var s = seed; function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
  var n = Math.max(4, Math.floor(len / 34));
  ctx.beginPath();
  for (var i = 0; i <= n; i++) {
    var t = 0.12 + (i / n) * 0.82;   // 蹴り点・ボール直近は空ける
    var a = ((i & 1) ? 1 : -1) * amp * (0.5 + rnd() * 0.8);
    var px = x0 + dx * t + nx * (off + a), py = y0 + dy * t + ny * (off + a);
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.strokeStyle = _MANGA_INK; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
}

// レトロ画素化（2026-07-15 ユーザー指定: ドット絵らしい粗さへ）。高解像度マンガ絵スプライトを
//   「描画サイズ÷セル」へ一旦高品質縮小し、その小画像をNN拡大で描く＝クッキリした粗ドット。
//   _CS_PIXEL_CELL=1 でキャンバス論理1px=アート1px（従来ドット絵と同等の粗さ感）。上げるほど粗い（1.5, 2…）。
var _CS_PIXEL_CELL = 1;
var _csPixCache = {}, _csPixOrder = [];
function _csPixelate(spr, key, dw, dh) {
  if (!spr || !dw || !dh) return spr;
  var w = Math.max(8, Math.round(dw / _CS_PIXEL_CELL)), h = Math.max(8, Math.round(dh / _CS_PIXEL_CELL));
  var ck = key + '|' + w + 'x' + h;
  if (_csPixCache[ck]) return _csPixCache[ck];
  var c = document.createElement('canvas'); c.width = w; c.height = h;
  var x = c.getContext('2d'); x.imageSmoothingEnabled = true; if (x.imageSmoothingQuality) x.imageSmoothingQuality = 'high';
  x.drawImage(spr, 0, 0, w, h);
  _csPixCache[ck] = c; _csPixOrder.push(ck);
  if (_csPixOrder.length > 120) delete _csPixCache[_csPixOrder.shift()];
  return c;
}

// ============================================================
// _csFx — 静止画マンガを「動いて見せる」共通FXレイヤー（2026-07-28）
//   参考演出: レトロピクセルゲームの光芒/衝撃波リング/打字字幕＋カラーグレードの状態表現。
//   原則:
//     ・1画面1ビート＝FXはビートの強調のみ。情報は一切増やさない（fxTypeはビート間つなぎ専用API）。
//     ・重い生成はオフスクリーンへ1回だけ → 毎フレームは transform+alpha のみ（モバイル性能）。
//       毎フレームの getImageData / createPattern / 大canvas再生成は禁止。
//     ・ドット絵美学: FXもセル(3-4px)スナップの粗い矩形で描く（_csPixelate のレトロ画素感と整合）。
//     ・恒常的なカメラ移動は入れない（punch はインパクト後 200-300ms のみ＝静止カメラ設計を守る）。
//   ロード安全: トップレベルでは DOM/Image/document に触れない（回帰ハーネスの vm ロードでも壊れない）。
// ============================================================
var _csFx = (function () {
  var TAU = Math.PI * 2;
  function _now() { return (typeof performance !== 'undefined') ? performance.now() : Date.now(); }
  function _lcg(seed) { var s = (seed | 0) || 1; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

  // ── fxRays: ナイター光芒 ──
  //   画面上部から差す太い光の柱。ディザ（市松）付き縦グラデをオフスクリーンに一度だけ生成し、
  //   毎フレームは上端アンカーの rotate（ゆっくり sway）＋ globalAlpha ＋ 'lighter' 合成のみ。
  var _raysCache = {};
  function _makeRays(W, H, count, seed) {
    var key = W + 'x' + H + '|' + count + '|' + seed;
    if (_raysCache[key]) return _raysCache[key];
    var rnd = _lcg(seed), set = [], cell = 3;
    for (var i = 0; i < count; i++) {
      var bw = Math.round(30 + rnd() * 42);                    // 光柱の太さ（30-72px）
      var len = Math.ceil(H * (1.15 + rnd() * 0.35));          // 回転しても下端が見えない長さ
      var c = document.createElement('canvas'); c.width = bw; c.height = len;
      var x = c.getContext('2d');
      for (var gy = 0; gy < len; gy += cell) {
        var fade = Math.max(0, 1 - gy / len);                  // 上=濃 → 下=透明
        for (var gx = 0; gx < bw; gx += cell) {
          var edge = (Math.min(gx, bw - cell - gx) < cell * 2) ? 0.45 : 1;   // 柱の縁は薄く
          var lvl = fade * edge;
          var odd = ((gx / cell + gy / cell) & 1);             // 市松ディザ: 薄い所は片相のみ点灯
          if (odd ? lvl < 0.34 : lvl < 0.10) continue;
          x.fillStyle = 'rgba(255,247,210,' + (0.16 + 0.30 * lvl).toFixed(3) + ')';
          x.fillRect(gx, gy, cell, cell);
        }
      }
      set.push({ c: c, ax: (i + 0.5 + (rnd() - 0.5) * 0.6) / count,
        rot: 0.16 + (rnd() - 0.5) * 0.42, amp: 0.045 + rnd() * 0.05,
        spd: 0.00030 + rnd() * 0.00022, ph: rnd() * TAU, al: 0.55 + rnd() * 0.35 });
    }
    _raysCache[key] = set; return set;
  }
  function rays(ctx, W, H, tMs, master, opts) {
    if (!(master > 0)) return;
    var set = _makeRays(W, H, (opts && opts.count) || 4, (opts && opts.seed) || 5);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';                  // additive（光）
    for (var i = 0; i < set.length; i++) {
      var r = set[i];
      ctx.save();
      ctx.globalAlpha = Math.min(1, r.al * master);
      ctx.translate(W * r.ax, -6);
      ctx.rotate(r.rot + Math.sin(tMs * r.spd + r.ph) * r.amp);
      ctx.drawImage(r.c, -r.c.width / 2, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  // ── fxRing: 衝撃波リング ──
  //   指定座標から膨張する太いピクセルリング（白＋チーム色の2重・少しオフセット）＋飛散チャンク。
  //   t:0→1 で半径/alpha補間。セルスナップの矩形描きで低解像度でもクッキリ。
  function _ringPass(ctx, x, y, r, cell, thick, col, alpha) {
    if (r <= 0) return;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = col;
    // ★ 円周サンプルはセルスナップで同じマスに何度も落ちる。素朴に fillRect すると
    //   重なった回数だけ alpha が合成され、リングが「半透明のムラ」になる（2026-07-28 実測）。
    //   1マス1回だけ描いて濃度を揃える＝取りこぼし防止に2倍サンプル＋重複除去。
    var steps = Math.max(16, Math.ceil(TAU * r / cell) * 2);
    var seen = {};
    for (var i = 0; i < steps; i++) {
      var a = i / steps * TAU, ca = Math.cos(a), sa = Math.sin(a);
      for (var q = 0; q < thick; q++) {
        var rr = r - q * cell;
        var px = Math.round((x + ca * rr) / cell) * cell;
        var py = Math.round((y + sa * rr) / cell) * cell;
        var k = px + ',' + py;
        if (seen[k]) continue;
        seen[k] = 1;
        ctx.fillRect(px, py, cell, cell);
      }
    }
  }
  function ring(ctx, x, y, t, opts) {
    if (!(t > 0) || t >= 1) return;
    opts = opts || {};
    var cell = opts.cell || 4, rMax = opts.radius || 72;
    var col = opts.color || '#ffd23a';
    var e = 1 - (1 - t) * (1 - t);                             // easeOut膨張
    var r = cell * 2 + (rMax - cell * 2) * e;
    var al = 1 - t * t;
    // ★ 白リング単体はマンガの白背景で完全に消える（shotduel で実証）。外周に暗縁を1セル置き、
    //   白背景でも夜空でも同じ強さで読ませる＝マンガのインク線と同じ考え方。
    _ringPass(ctx, x, y, r + cell, cell, 1, opts.edge || '#14181f', al * 0.9);
    // 白コアは立ち上がりを不透明に寄せる（薄い輪＝「ペン書きの丸」に見えるのを避ける）。
    _ringPass(ctx, x, y, r, cell, 3, '#ffffff', Math.min(1, al * 1.35));
    _ringPass(ctx, x, y, Math.max(cell * 2, r - cell * 3), cell, 1, col, al * 0.95);   // チーム色（内側オフセット）
    var rnd = _lcg(opts.seed || 17);                           // 飛散する矩形チャンク（決定論）
    var n = (opts.chunks != null) ? opts.chunks : 7;
    ctx.globalAlpha = al;
    for (var i = 0; i < n; i++) {
      var a2 = rnd() * TAU, spd = 0.85 + rnd() * 0.55, sz = cell * (rnd() < 0.4 ? 2 : 1);
      var cr = rMax * 1.2 * e * spd;
      ctx.fillStyle = (i & 1) ? '#ffffff' : col;
      ctx.fillRect(Math.round((x + Math.cos(a2) * cr) / cell) * cell,
                   Math.round((y + Math.sin(a2) * cr) / cell) * cell, sz, sz);
    }
    ctx.globalAlpha = 1;
  }

  // ── fxGrade: カラーグレード（canvas要素の CSS filter＝GPU任せ・getImageData不使用）──
  //   'burst'=ゴール（彩度1.6→1.0へ減衰）/ 'drain'=失点（彩度0.25＋僅かに暗く→ゆっくり復帰）。
  //   多重起動は最後勝ち（_csFxGradeT0 印で古いループが自然停止）。終了時に filter を必ず外す。
  function grade(canvas, mode, opts) {
    if (!canvas || !canvas.style || typeof requestAnimationFrame === 'undefined') return;
    var T0 = _now();
    var dur = (opts && opts.dur) || (mode === 'drain' ? 2300 : 1100);
    canvas._csFxGradeT0 = T0;
    function step() {
      if (canvas._csFxGradeT0 !== T0) return;                  // 新しい grade に置き換わった
      var t = (_now() - T0) / dur;
      if (t >= 1) { canvas.style.filter = ''; return; }
      var f;
      if (mode === 'drain') {                                  // 落ち込み→維持→ゆっくり復帰
        var k = t < 0.16 ? t / 0.16 : (t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45);
        f = 'saturate(' + (1 - 0.75 * k).toFixed(3) + ') brightness(' + (1 - 0.13 * k).toFixed(3) + ') contrast(' + (1 + 0.06 * k).toFixed(3) + ')';
      } else {                                                 // burst: 高彩度スパイク→減衰
        var k2 = 1 - t;
        f = 'saturate(' + (1 + 0.6 * k2 * k2).toFixed(3) + ') brightness(' + (1 + 0.10 * k2 * k2).toFixed(3) + ')';
      }
      canvas.style.filter = f;
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ── 赤ビネット（drain随伴・radial-gradientを一度だけ生成してctxへ重ね描き）──
  var _vigCache = {};
  function _vig(W, H, color) {
    var key = W + 'x' + H + '|' + color;
    if (_vigCache[key]) return _vigCache[key];
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d');
    // 角まで色が届くよう外径は半対角以内に収める（0.72*maxだと角が55%止まり＝ほぼ見えなかった）。
    // drain の saturate(0.25) フィルタ越しでも赤が残るよう、既定色は高彩度寄り。
    var g = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.52);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.6, color + 'aa'); g.addColorStop(1, color);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    _vigCache[key] = c; return c;
  }
  function vignette(ctx, W, H, alpha, color) {
    if (!(alpha > 0)) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(_vig(W, H, color || '#d81830'), 0, 0);
    ctx.globalAlpha = 1;
  }

  // ── fxFlashes: 観客フラッシュ ──
  //   指定帯（観客席）にランダムな白ドット明滅。110msスロットの決定論LCG＝低コスト・再現可能。
  //   density=0 で無音（通常時）、ゴール時に高密度。
  function flashes(ctx, tMs, opts) {
    opts = opts || {};
    var density = opts.density || 0;
    if (density <= 0) return;
    var x0 = opts.x0 || 0, y0 = opts.y0 || 0;
    var x1 = (opts.x1 != null) ? opts.x1 : x0 + 100, y1 = (opts.y1 != null) ? opts.y1 : y0 + 40;
    var slot = Math.floor(tMs / 110);
    var ph = 1 - (tMs % 110) / 110;                            // スロット内で減衰＝チカッと明滅
    // ★ 観客席の帯はもともとランダムな点の集合＝同系の白ドットを足しても「元から居た点」に紛れる。
    //   通常合成では density を上げても写真では変化が読めなかった（2026-07-28 実測）。
    //   加算合成（lighter）＋にじみ1段で「暗い群衆の中で光った」に見せる＝数より1粒の強さ。
    var prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffffff';
    for (var i = 0; i < density; i++) {
      var rnd = _lcg(slot * 8191 + i * 131 + ((opts.seed || 0) * 7));
      var px = (x0 + rnd() * (x1 - x0)) | 0, py = (y0 + rnd() * (y1 - y0)) | 0;
      var st = rnd();                                          // 個体の強度
      var s = st > 0.6 ? 4 : 3;
      ctx.globalAlpha = (0.20 + st * 0.30) * ph;               // にじみ（広く弱く）
      ctx.fillRect(px - s, py - s, s * 3, s * 3);
      ctx.globalAlpha = (0.55 + st * 0.45) * ph;               // 芯（狭く強く）
      ctx.fillRect(px, py, s, s);
      if (st > 0.75) {                                         // 強い発光は小さな十字
        ctx.globalAlpha *= 0.55;
        ctx.fillRect(px - s, py, s, s); ctx.fillRect(px + s, py, s, s);
        ctx.fillRect(px, py - s, s, s); ctx.fillRect(px, py + s, s, s);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prevOp;
  }

  // ── fxType（描画コア）: ターミナル風モノスペース打字＋カーソル明滅。戻り値=打字完了か。──
  //   スタンドアロン canvas 版は下の _csFxType（公開API）。
  function typeText(ctx, W, H, text, tMs, opts) {
    opts = opts || {};
    var cps = opts.cps || 24;                                  // chars per second
    var n = Math.max(0, Math.min(text.length, Math.floor(tMs / 1000 * cps)));
    var fs = opts.size || 17;
    ctx.save();
    ctx.font = '700 ' + fs + 'px "Courier New",ui-monospace,monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    var y = (opts.y != null) ? opts.y : Math.round(H * 0.64);  // 中央やや下
    var fullW = ctx.measureText('> ' + text).width;
    var x = Math.round((W - fullW) / 2);
    ctx.fillStyle = 'rgba(8,10,16,.66)';                       // 読みやすさの薄墨背板
    ctx.fillRect(x - 10, y - Math.round(fs * 0.9), Math.ceil(fullW) + 20 + Math.round(fs * 0.6), Math.round(fs * 1.8));
    ctx.fillStyle = opts.color || '#cfeec6';                   // ターミナル淡緑
    var shown = '> ' + text.slice(0, n);
    ctx.fillText(shown, x, y);
    var done = n >= text.length;
    if (!done || (Math.floor(tMs / 300) & 1)) {                // 打字中=常時 / 完了後=明滅
      var cw = ctx.measureText(shown).width;
      ctx.fillRect(x + cw + 3, y - Math.round(fs * 0.5), Math.round(fs * 0.5), fs);
    }
    ctx.restore();
    return done;
  }

  // ── fxPunch: ズームパンチ＋シェイク ──
  //   合成済みフレーム全体へ ctx.translate/scale の減衰ズーム(1.06→1.0)＋2-3pxジッター。
  //   インパクト後 dur(既定260ms) のみ有効＝恒常カメラ移動なし。ctx.save() の後に呼び、描画後 restore()。
  function punch(ctx, W, H, tMs, opts) {
    var dur = (opts && opts.dur) || 260;
    if (!(tMs >= 0) || tMs >= dur) return false;
    var k = 1 - tMs / dur;
    var z = 1 + ((opts && opts.zoom) || 0.06) * k * k;
    var rnd = _lcg(((tMs / 16) | 0) + 7);                      // 16ms毎に変わる決定論ジッター
    var jx = (rnd() - 0.5) * 5 * k, jy = (rnd() - 0.5) * 4 * k;
    var cx = (opts && opts.cx != null) ? opts.cx : W / 2;
    var cy = (opts && opts.cy != null) ? opts.cy : H / 2;
    ctx.translate(cx, cy); ctx.scale(z, z); ctx.translate(-cx + jx, -cy + jy);
    return true;
  }

  return { rays: rays, ring: ring, grade: grade, vignette: vignette, flashes: flashes, typeText: typeText, punch: punch };
})();

/* ══ CAM-01 2.5Dカットアウト・カメラ（2026-07-28）══════════════════════════════
 * 狙い: 静止画のまま「動いている」と読ませる。3D化は画風が割れるので不採用（3D試作の結論）。
 *
 * ★ 前提となる発見: 既存カットシーンは既に【背景／守備／攻撃／ボール】を**別々に draw** している。
 *   つまり絵を切り分ける作業は不要で、各 draw を包む transform を足すだけでレイヤーが動く。
 *   既存の withScene() は「静止カメラ・ミラーのみ」だった＝ここが継ぎ目。
 *
 * ★ 参考にした語法（FPS/潜水艦の動画分析）:
 *   - 被写体でなく**カメラが動く**（プッシュイン／遅れて追うフォロー）
 *   - 奥ほど動かない＝**パララックス**で奥行きが出る（潜水艦の多層背景）
 *   - インパクトは**一瞬だけ**揺らす（恒常的なカメラ移動はしない＝酔う）
 *
 * ★ 1画面1ビートは崩さない: カメラは「今どこを見ればいいか」を示すだけで情報を足さない。
 * ★ HUD は screen 空間＝カメラの外で描く（文字が動くと一気に安っぽくなる）。
 */
var _csCam = (function () {
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }
  function smooth(t) { return t * t * (3 - 2 * t); }

  /* カメラ状態を作る。
   *   zoom  : 主役プレーンの倍率（1=素）
   *   fx,fy : 注視点（この点を中心に寄る）
   *   panX/Y: 主役プレーンの平行移動
   *   shake : {x,y} 一時的な揺れ（インパクト用）
   * ★ 背景は必ず zoom>=BG_MIN で描く。等倍のまま pan すると背景の端が見切れて黒帯が出る。 */
  var BG_MIN = 1.06;
  function mk(o) {
    o = o || {};
    return {
      zoom: (o.zoom != null) ? o.zoom : 1,
      fx: (o.fx != null) ? o.fx : 240, fy: (o.fy != null) ? o.fy : 108,
      panX: o.panX || 0, panY: o.panY || 0,
      shx: 0, shy: 0
    };
  }

  /* レイヤーに適用。depth: 0=無限遠(動かない) / 1=主役プレーン / >1=手前。
   *   奥のレイヤーほど zoom も pan も効きを弱める＝パララックス。 */
  function begin(ctx, cam, depth) {
    var d = (depth == null) ? 1 : depth;
    ctx.save();
    var ez = 1 + (cam.zoom - 1) * d;
    if (d < 0.6) ez = Math.max(ez, BG_MIN);            // 背景のオーバースキャン（端の見切れ防止）
    ctx.translate(cam.fx, cam.fy);
    ctx.scale(ez, ez);
    ctx.translate(-cam.fx, -cam.fy);
    ctx.translate((cam.panX + cam.shx) * d, (cam.panY + cam.shy) * d);
  }
  function end(ctx) { ctx.restore(); }

  /* 遅れて追うフォロー（FPSのカメラ語法）。被写体を100%追うと被写体が画面で静止して
   * 「動いていない」ように見える＝lag<1 で追い、被写体は画面内でも動かす。 */
  function follow(cam, subjX, centerX, lag) {
    cam.panX = -(subjX - centerX) * ((lag == null) ? 0.62 : lag);
  }

  /* インパクトの揺れ。dur(既定220ms)だけ・減衰。恒常的には動かさない。 */
  function shake(cam, elapsed, dur, amp) {
    var D = dur || 220, A = (amp == null) ? 3.2 : amp;
    if (!(elapsed >= 0) || elapsed > D) { cam.shx = cam.shy = 0; return; }
    var k = 1 - elapsed / D;
    cam.shx = Math.sin(elapsed * 0.85) * A * k;
    cam.shy = Math.cos(elapsed * 1.07) * A * k * 0.7;
  }

  /* カットアウトの二次モーション（人形芝居）。足元を軸に「傾き」と「潰し/伸び」を掛ける。
   * ★ 手足は描き直さない＝マンガ絵のまま。踏み込みの前傾と着地の潰しだけで生き物に見える。
   *   lean: ラジアン（進行方向へ倒す）/ squash: 1=素・<1で潰れ横に広がる */
  function puppet(ctx, pivotX, pivotY, lean, squash, draw) {
    var s = (squash == null) ? 1 : squash;
    ctx.save();
    ctx.translate(pivotX, pivotY);
    if (lean) ctx.rotate(lean);
    if (s !== 1) ctx.scale(1 + (1 - s) * 0.7, s);       // 体積保存っぽく: 縦に潰れたら横に広がる
    ctx.translate(-pivotX, -pivotY);
    draw();
    ctx.restore();
  }

  return { mk: mk, begin: begin, end: end, follow: follow, shake: shake, puppet: puppet,
           easeOut: easeOut, smooth: smooth, clamp01: clamp01 };
})();

// カメラの一括ON/OFF（ラボでのA/B比較用。既定=ON）
var CS_CAM_ENABLED = true;

// 失点（自チーム被弾）判定: 監督モード/リーグは gameState.team1=自チーム（manager-match.js）。
//   team2 の得点＝失点。gameState 不在（ラボ素振り等）は false＝中立扱い。表示層のみの判定。
function _csFxConcede(sc) {
  var gs = (typeof gameState !== 'undefined' && gameState) ? gameState : null;
  return !!(gs && gs.team1 && gs.team2 && sc && sc.offence === gs.team2);
}

// 公開API: 打字字幕カード（ビート間のつなぎ用）。中央やや下に1文字ずつ打字＋カーソル明滅。
//   例: _csFxType('COUNTER ATTACK') / _csFxType('GOAL CONFIRMED', { hold: 1500 })
//   暗背景＋走査線のスタンドアロン canvas を返す（他シーン同様 live-field-wrap へ差し込む想定）。
//   detach されたら rAF 停止（リーク防止・既存シーンと同パターン）。
function _csFxType(text, opts) {
  if (typeof document === 'undefined') return null;
  opts = opts || {};
  var W = opts.w || 480, H = opts.h || 216;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var hold = (opts.hold != null) ? opts.hold : 1200;
  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var doneAt = 0, started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var t = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - T0;
    ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, W, H);       // 暗背景（文字色は typeText 側で明示）
    ctx.fillStyle = 'rgba(120,150,190,.06)';
    for (var y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);   // 走査線
    var done = _csFx.typeText(ctx, W, H, String(text || ''), t, opts);
    if (done && !doneAt) doneAt = t;
    if (!doneAt || t < doneAt + hold) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return canvas;
}

// FX単体デモ（_scene_lab 専用）: rays/ring/grade-burst/grade-drain/flashes/type/punch をループ再生。
//   本番コードからは呼ばれない（ラボの確認台）。背景は _lpBg()（スタンド帯 y=84..118）。
function _csFxDemo(kind) {
  if (typeof document === 'undefined') return null;
  if (kind === 'type') return _csFxType('COUNTER ATTACK', { hold: 1600 });
  var W = 480, H = 216;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var bg = _lpBg();
  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false, lastCyc = -1, CYCLE = 2400;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var t = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - T0;
    var tc = t % CYCLE, cyc = Math.floor(t / CYCLE);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (kind === 'punch') _csFx.punch(ctx, W, H, tc);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bg, 0, 0);
    ctx.restore();
    if (kind === 'ring') _csFx.ring(ctx, W * 0.5, H * 0.52, tc / 620, { color: '#e03030', radius: 84, cell: 4, seed: 17 });
    else if (kind === 'rays') _csFx.rays(ctx, W, H, t, 0.9);
    else if (kind === 'flashes') _csFx.flashes(ctx, t, { x0: 0, y0: 82, x1: W, y1: 120, density: 12, seed: 4 });
    else if (kind === 'grade-burst' || kind === 'grade-drain') {
      if (cyc !== lastCyc) { lastCyc = cyc; _csFx.grade(canvas, kind === 'grade-drain' ? 'drain' : 'burst'); }
      if (kind === 'grade-drain') {                            // drain随伴の赤ビネット（グレードと同プロファイル）
        var td = tc / 2300, k = td >= 1 ? 0 : (td < 0.16 ? td / 0.16 : (td < 0.55 ? 1 : 1 - (td - 0.55) / 0.45));
        _csFx.vignette(ctx, W, H, 0.5 * k, '#d81830');
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return canvas;
}

// 漫画コマ「演出」の一括スイッチ（2026-07-15 ユーザー指示で一旦停止）。
//   false: 紙白＋集中線背景・墨リム・対決割り・顔カットイン・ヘディング縦2コマを止め、従来のスタジアム/芝背景スタイルで描く。
//   ※スプライトの新旧はこのフラグと独立: シュート/GK/ロングパスは新素材（MangaRecolorリカラー）を従来演出の上に描く（2026-07-15 指示）。
//   ヘディングのみ旧スプライト（旧重ね競り合いシーンごと）。漫画演出の再開は true に戻すだけ。
var MANGA_COMIC_STYLE = false;

/* ════════════════════════════════════════════════════════════════════════════
 * MONT-01 : 層C モンタージュ（試作 2026-07-29・lab限定）
 *
 * 4層設計の層C＝**主語は「感情」**。だからここは選手の全身ではなく **部位** を、
 * 画面から見切れるサイズ（120〜200%）で見せる。参考のデイヴ・ザ・ダイバーの上段が
 * まさにこれで、顔だけでなく**包丁・フライパン・手**という「部位」を並べている。
 *
 * ★ 既存の `_renderShotDuelScene`（対角2分割）が土台。違いは2点だけ:
 *     ①分割を2→4コマにする ②**同時に出さず1コマずつ足していく**
 *   ②が肝で、モンタージュは「1画面に4つの情報」ではなく **時間軸で1ビートずつ** 足している。
 *   だから [[game-one-screen-one-beat]] と矛盾しない（デイヴの実フレームでもコマは増えていく）。
 *
 * ★ **新規アセットを1枚も作らずに成立するか**を確かめるのがこの試作の目的。答えは「半分だけ」:
 *     ボール   ○ 手続き描画なので解像度の上限が無い（いくらでも寄れる）
 *     グローブ ○ GKダイブ絵の reaching glove（_GK_DIVES の gx/gy を流用）
 *     蹴り足   △ 座標は実行時に**アルファを走査して実測**する必要がある（下記）
 *     顔       ✕ **原理的に部位アップにできない**（下記）
 *
 * ★★ 実測 2026-07-29 ── Portrait の合成頭は拡大できない。
 *   パーツ実体（eyes_normal.png 等）は **360×420**＝合成画布 720×840 の半分で、
 *   合成頭のベタ面は **水平12px幅（p90）のブロック**（目も頬も同値＝2026-07-05 の
 *   「高精細を放棄し粗スタイルへ全面統一」の結果）。
 *   最終 480px 画布でブロックを4px以下に保つには倍率0.33倍以下＝**クロップ幅504px必要＝
 *   頭がほぼ丸ごと**。つまり「目だけ」に寄ると必ず破綻する。
 *   → **層C（部位アップ）には専用の高精細素材が要る**。層M用に粗スタイルで統一した資産は
 *     そのままでは使えない＝4層設計の「層ごとに別の作り方を持つ」がここでも裏取りされた。
 *   → 当面は顔コマを「頭部まるごと」に留める（_MONT_FACE_MAXZ）。
 * ══════════════════════════════════════════════════════════════════════════ */
// 顔コマの最大倍率。合成頭のブロック12px@720 を最終画布で4px以下に保つ上限（実測由来）。
var _MONT_FACE_MAXZ = 0.34;
var _MONT_SHEAR = 0.13;        // 割り線の傾き（下へ行くほど左へ寄る）
var _MONT_STEP = 200;          // コマが1枚増える間隔(ms)
var _MONT_SLAM = 130;          // 1枚が叩きつけられる時間(ms)

function _renderShotMontageScene(sc) {
  if (typeof document === 'undefined') return null;
  if (typeof MangaRecolor === 'undefined' || !MangaRecolor.render) return null;
  var W = 480, H = 216, SS = 2;
  var canvas = document.createElement('canvas');
  canvas.width = W * SS; canvas.height = H * SS;
  canvas.style.cssText = 'display:block;width:100%';
  var ctx = canvas.getContext('2d');
  ctx.scale(SS, SS);

  // ── 素材 ───────────────────────────────────────────────────────
  var shooterP = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var longName = shooterP ? (shooterP.long_name || shooterP.name || '') : '';
  var feat = _mangaFeat(longName);
  var cols = _mangaColors(sc.offence, feat.skin);
  var shDir = _shotSpriteDir();
  var shKey = 'shot|' + shDir + '|' + feat.hstyle + '|' + cols.shirt + cols.shorts + cols.socks + cols.accent + cols.skin;
  var shotImg = _loadCutsceneImg('img/cutscenes/' + shDir + '/' + feat.hstyle + '.png');

  var accent = (sc.offence && sc.offence.team_color) || '#1f4fd6';
  var gkColor = _pickGkColor(accent, sc.defence && sc.defence.team_color);
  var gkP = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[0]];
  var gkCols = _gkDiveColors(gkColor, _mangaFeat(gkP ? (gkP.long_name || gkP.name || '') : '').skin);
  var dive = _pickGkDive();
  var gkKey = 'gkdive|' + dive.id + '|' + gkColor + '|' + gkCols.skin;
  var gkImg = _loadCutsceneImg(dive.src);

  /* 目元＝Portrait の合成頭。★ 720×840 の高解像度なので、目元だけ切り出して
   *   120%まで拡大しても破綻しない＝**層Cに新規アセットが要らない最大の理由**。 */
  var headC = null;
  if (typeof Portrait !== 'undefined' && Portrait.renderHead) {
    try {
      headC = document.createElement('canvas'); headC.width = 720; headC.height = 840;
      Portrait.renderHead(headC, longName, {});
    } catch (e) { headC = null; }
  }
  var EYE = (typeof Portrait !== 'undefined' && Portrait.HEAD_ANCHOR) ? Portrait.HEAD_ANCHOR.EYE : { x: 446, y: 336 };

  /* 層C専用アート（C-01）。まだ1点しか無いのでフラグで出し分ける＝画風の比較用。
   *   ★ 顔まわりの部位アップは**フルブリード＝透過不要**（コマが必ずクリップするため）。
   *     クロマキーが要るのは輪郭が立つ部位（グローブ等）だけ。 */
  var faceC = (typeof window !== 'undefined' && window.CS_LAYERC_FACE)
    ? _loadCutsceneImg('img/cutscenes/layerc/face_eyes_determined.png?v=2') : null;

  /* ── 4ビートの連続（★ 2026-07-29 4分割コマ割りから転換・ユーザー確認済み）─────────────
   * 旧実装は 480×216 を4つの多角形に割っていた。これは2つの理由で誤りだった:
   *   ① **層Cを自ら否定していた**。4分割すると1コマ約135×108px。層Cの定義は選手の画面高
   *      120〜200%（見切れる寄り）なので、その寸法には物理的に入らない。
   *   ② **1画面1ビートに反していた**。「時間軸で1枚ずつ足すから矛盾しない」と弁護していたが、
   *      シーケンス終了時には4コマが同時に画面上にある。
   * ★ 参考漫画は1ページに3〜5コマ使うが、**漫画の1ページに対応するのは1画面ではなく1シーケンス**。
   *   ページは読者が数秒視線を送る面で、480×216は1.3秒で流れる帯。ページを画面へ写したのが誤りだった。
   *      漫画の1コマ → うちの1画面（フルフレーム）
   *      漫画の1ページ → うちの数ビートの連なり
   * ★ 決めた線: **3つ以上に割るのはナシ**。主コマ1つ＋食い込む小コマ1つ（=対決割り/カットイン帯）までは可。
   * 副作用として、フルフレームなら層C素材が本来の120〜200%で使える＝寄りの上限が広がる。 */
  var BEATS = [
    // beat順。最後の1枚が「決着の緊張」＝GKのグローブ。
    { key: 'eye' }, { key: 'boot' }, { key: 'ball' }, { key: 'glove' }
  ];
  BEATS.forEach(function (pn) {                      // 各ビートは画面まるごと（旧 pn.bx/bw 等をそのまま使えるようにする）
    pn.bx = 0; pn.by = 0; pn.bw = W; pn.bh = H; pn.cx = W / 2; pn.cy = H / 2;
  });

  /* スプライト内の「足元」を実行時に実測する。
   *   ★ ハードコードは不可。①髪型ごとに画布サイズが違う（wavy 291×388 / afro 268×379）
   *     ②`_renderShotDuelScene` の (0.42,0.79) は**ボールの射出点**であってスプライト内の足ではない
   *     （この取り違えで初回は空白をクロップした・2026-07-29）。最下段の不透明画素の重心を取る。 */
  var _footCache = {};
  function footFrac(spr, key) {
    if (_footCache[key]) return _footCache[key];
    var r = { x: 0.5, y: 0.95 };
    try {
      var c = document.createElement('canvas'); c.width = spr.width; c.height = spr.height;
      var x2 = c.getContext('2d'); x2.drawImage(spr, 0, 0);
      var d = x2.getImageData(0, 0, spr.width, spr.height).data, maxY = -1;
      for (var i = 3; i < d.length; i += 4) { if (d[i] > 16) { var py = ((i - 3) / 4 / spr.width) | 0; if (py > maxY) maxY = py; } }
      if (maxY > 0) {
        var sx = 0, sn = 0;
        for (var yy = Math.max(0, maxY - 20); yy <= maxY; yy++)
          for (var xx = 0; xx < spr.width; xx++)
            if (d[(yy * spr.width + xx) * 4 + 3] > 16) { sx += xx; sn++; }
        if (sn) r = { x: sx / sn / spr.width, y: (maxY - 10) / spr.height };
      }
    } catch (e) { /* taint等は既定値で続行 */ }
    _footCache[key] = r; return r;
  }

  /* 部位を切り出してコマに「はみ出させて」置く。
   *   fx,fy = 元画像内の注目点（フラクション） / frac = 切り出す幅の割合 / over = はみ出し量 */
  function drawPart(img, fx, fy, frac, pn, over) {
    if (!img || !img.width) return false;
    var iw = img.width, ih = img.height;
    var sw = iw * frac, sh = sw * (pn.bh / pn.bw);
    if (sh > ih) { sh = ih; sw = sh * (pn.bw / pn.bh); }
    var sx = Math.max(0, Math.min(iw - sw, iw * fx - sw / 2));
    var sy = Math.max(0, Math.min(ih - sh, ih * fy - sh / 2));
    var o = over || 1.14;                                  // ★ 1.0超＝コマから見切れる（層Cの定義）
    var dw = pn.bw * o, dh = pn.bh * o;
    ctx.drawImage(img, sx, sy, sw, sh, pn.cx - dw / 2, pn.cy - dh / 2, dw, dh);
    return true;
  }

  var flipH = _csAttackRight(sc);
  /* ★ フルフレーム化に伴い1ビートを長くする。旧は4分割コマが「増えていく」ので1枚200msで足りたが、
   *   画面まるごとの寄りは読ませる時間が要る（旧STEP下限120ms→260ms）。 */
  var P = _MONT_STEP * BEATS.length + 520;
  var beatMs = _csBeatMs();
  if (beatMs) P = Math.max(700, Math.min(P, beatMs - 200));
  var STEP = Math.max(260, (P - 260) / BEATS.length);

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var el = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - T0;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0c0a14'; ctx.fillRect(0, 0, W, H);      // 紙＝墨（未登場のコマはここが見える）
    ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.imageSmoothingEnabled = true;

    var shotSpr = (shotImg.complete && shotImg.naturalWidth) ? MangaRecolor.render(shKey, shotImg, cols) : null;
    var gkSpr = (gkImg.complete && gkImg.naturalWidth) ? MangaRecolor.render(gkKey, gkImg, gkCols) : null;

    /* ★ 4分割から4ビート連続へ。**いま見せるビート1つだけを画面まるごとに描く**（累積しない）。 */
    var idx = Math.min(BEATS.length - 1, Math.floor(el / STEP));
    {
      var pn = BEATS[idx], t = el - idx * STEP;
      var k = Math.min(1, t / _MONT_SLAM);
      var z = 1 + 0.22 * (1 - k) * (1 - k);                  // 叩きつけ（大きく入って収まる）

      ctx.save();
      ctx.translate(pn.cx, pn.cy); ctx.scale(z, z); ctx.translate(-pn.cx, -pn.cy);
      // 背景＝集中線（焦点は画面中心）。部位だけだと空間が読めない。
      ctx.drawImage(_mangaShotBg(W, H, pn.cx, pn.cy), 0, 0);

      /* 顔コマ。
       *   ① 層C専用アート（LAYER_C_ASSET_SPEC / C-01）があればそれを使う＝本来の「部位アップ」。
       *      フルブリードの絵なので切り出さずコマへ被せる。
       *   ② 無ければ Portrait の合成頭へフォールバック。ただし合成頭は12pxブロックなので
       *      部位アップにはできず、崩れない上限（_MONT_FACE_MAXZ）＝頭部まるごとに留める。 */
      if (pn.key === 'eye' && faceC && faceC.complete && faceC.naturalWidth) {
        /* ★ 生成アートはそのままだと滑らかな線画で、隣の層Mスプライト（ドット絵）と画風が割れる。
         *   層Mが通っているのと同じ _csPixelate（論理解像度へ高品質縮小→NN拡大）に通して
         *   同じドットの目に落とす。CS_LAYERC_PIXELATE=false で素の絵と比較できる。 */
        var doPix = (typeof window === 'undefined') || window.CS_LAYERC_PIXELATE !== false;
        var fw = pn.bw * 1.04, fh = pn.bh * 1.04;
        var fspr = doPix ? _csPixelate(faceC, 'lc_face_c01', fw, fh) : faceC;
        var prevSm = ctx.imageSmoothingEnabled;
        if (doPix) ctx.imageSmoothingEnabled = false;
        ctx.drawImage(fspr, pn.cx - fw / 2, pn.cy - fh / 2, fw, fh);
        ctx.imageSmoothingEnabled = prevSm;
      } else if (pn.key === 'eye' && headC) {
        var need = pn.bw * 1.06 / _MONT_FACE_MAXZ;                    // 必要なクロップ幅(px)
        drawPart(headC, EYE.x / 720, (EYE.y + 90) / 840, Math.min(1, need / 720), pn, 1.06);
      } else if (pn.key === 'boot' && shotSpr) {
        var ff = footFrac(shotSpr, shKey);
        drawPart(shotSpr, ff.x, ff.y, 0.34, pn, 1.18);
      }
      else if (pn.key === 'glove' && gkSpr) drawPart(gkSpr, dive.gx, dive.gy, 0.36, pn, 1.22);
      else if (pn.key === 'ball') {
        var br = Math.min(pn.bw, pn.bh) * 0.62;
        _lpBall(ctx, pn.cx, pn.cy, br, el * 0.006);
      }
      ctx.restore();

      // ビートが切り替わった瞬間の白フラッシュ（「刺さった」ことを一瞬だけ示す）。割り線の代替。
      if (k < 1) {
        ctx.fillStyle = 'rgba(255,255,255,' + (0.42 * (1 - k)).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
      }
    }
    // ★ 墨の割り線は廃止（コマを割らないため）。
    ctx.restore();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return canvas;
}

// Var A: 対角対決割り。canvas を対角の墨割り線で2分割し、右=シューター（蹴りの瞬間）/左=GKダイブ大ゴマ。
//   両パネルとも背景はスピード線（_mangaShotBg 流用・焦点は各パネルの主）。墨縁の白抜きボール軌道＋
//   ジグザグ衝撃波が割り線を跨いで右→左（ネイティブ）。ボールはGKの手元手前で静止＝結果非開示の緊張。
//   左パネル奥に薄墨ネット。台詞・文字なし。flipH でシーンごと鏡像（team1=右攻め→左シューター/右GK）。
//   MangaRecolor 必須（呼び出し側でガード）。カットイン帯は使わない（対決が両者を見せているため）。
function _renderShotDuelScene(sc) {
  var W = 480, H = 216, ground = 196;
  var canvas = document.createElement('canvas');
  var SS = 2;   // 内部解像度2倍（2026-07-15）: 高解像度マンガ絵をNN縮小→2倍表示すると輪郭ジャギ・網点斑点が出るため、2倍キャンバス＋スムージングで描く
  canvas.width = W * SS; canvas.height = H * SS;
  canvas.style.cssText = 'display:block;width:100%';
  var ctx = canvas.getContext('2d');
  ctx.scale(SS, SS);

  // 右パネル: シューター（既存拍1と同じ12髪型スプライト＋キット/肌リカラー）
  var shooterP0 = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var _feat = _mangaFeat(shooterP0 ? (shooterP0.long_name || shooterP0.name || '') : '');
  var _cols = _mangaColors(sc.offence, _feat.skin);
  var _shDir = _shotSpriteDir();
  var _shKey = 'shot|' + _shDir + '|' + _feat.hstyle + '|' + _cols.shirt + _cols.shorts + _cols.socks + _cols.accent + _cols.skin;
  var shooter = _loadCutsceneImg('img/cutscenes/' + _shDir + '/' + _feat.hstyle + '.png');

  // 左パネル: GKダイブ（_pickGkColor＝両チームと別色・ダイブ絵ビートと同キー＝リカラーキャッシュ共有）
  var accent = (sc.offence && sc.offence.team_color) || '#1f4fd6';
  var gkColor = _pickGkColor(accent, sc.defence && sc.defence.team_color);
  var gkP0 = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[0]];
  var _gkCols = _gkDiveColors(gkColor, _mangaFeat(gkP0 ? (gkP0.long_name || gkP0.name || '') : '').skin);
  var _dive = _pickGkDive();
  var _gkKey = 'gkdive|' + _dive.id + '|' + gkColor + '|' + _gkCols.skin;   // ポーズ別キー（共通キーだと先勝ちの絵が焼き付く）
  var gkImg = _loadCutsceneImg(_dive.src);

  /* ★ GK側のパターン2 ＝ 顔アップ（2026-07-29 ユーザー指定「GKは顔アップのパターンがあってもいい」）。
   *   参考漫画 IMG_5885 / IMG_5887 の顔コマは**面積10〜15%の細い縦ゴマ**で、しかも**減彩しない**
   *   ＝そのコマの中では顔が主語だから。ダイブ絵を縮めるパターン（既存）と2つ持つこと自体が
   *   縮尺のダイナミックレンジになる（[[art-one-shot-one-subject]] ④）。
   *   ★ 合成頭(Portrait)は12pxブロックで顔アップに使えない（2026-07-29 実測・予算4pxに対し10px）。
   *     よって**層C素材があるときだけ**発動し、無ければダイブ縮小パターンへ落ちる。
   *   ⚠️ 現状の層C素材は C-01（determined eyes）1点のみで、GK専用ではない＝仮置き。
   *     仕様書の C-02(glare) がGK向けなので、そちらが出来たら差し替える。 */
  var _lcFace = (typeof window !== 'undefined' && window.CS_LAYERC_FACE)
    ? _loadCutsceneImg('img/cutscenes/layerc/face_eyes_determined.png?v=2') : null;
  var _wantFace = (typeof window !== 'undefined' && window.CS_DUEL_GK_FACE !== undefined)
    ? !!window.CS_DUEL_GK_FACE                     // ラボ: 明示切替（比較用）
    : !!(_csShotVarHash(sc) & 2);                  // 既定: 決定論ローテ（ダイブ縮小と半々）
  var gkFace = _wantFace && !!_lcFace;

  /* ジオメトリ（native: 右=シューター/左=GK・ボール右→左）
   * ★ 2026-07-29 コマ面積の重み付け（ユーザー指定「シュートのコマは大きく／GKの顔は小さく」＋
   *   参考漫画6ページの実測）。
   *   旧: 割り線 W*0.40→0.60 ＝ 左右きっかり 51,840px² : 51,840px²（**面積比1.0倍**）で、
   *       しかも GK 幅264px > シューター幅133px ＝ **GKの方が2.0倍大きい**＝指定と正反対だった。
   *   新: シューター 72% : GK 28%（面積比2.6倍）。GKは幅150pxへ縮めて左パネルに収める。
   *   参考漫画の最大/最小コマ比は 4.2〜11倍なので、まだ控えめな側に置いている。 */
  var ph = 190, pcx = W * 0.72, sprW = 147;                             // シューター＝主語（旧172→190・幅も比例）
  var foot = [pcx - sprW / 2 + sprW * 0.42, ground - ph + ph * 0.79];   // 蹴り点（既存拍1と同式）
  //   顔アップ時は参考漫画の顔コマに合わせてさらに細く（22%）。ダイブ縮小時は28%。
  var dTop = W * (gkFace ? 0.13 : 0.18), dBot = W * (gkFace ? 0.31 : 0.38);
  function divAt(y) { return dTop + (dBot - dTop) * (y / H); }          // 割り線のx（yの関数）
  var gkW = 150 * _dive.ws, gkH = gkW * _dive.hw;                       // GK＝非主語の小ゴマ（旧264→150）
  var gkX = 64 - gkW / 2, gkY = 112 - gkH / 2;                          // 左パネル（28%）の中央に収める
  var hX = gkX + gkW * _dive.gx, hY = gkY + gkH * _dive.gy;                     // GKの手元（reaching glove アンカー・絵別）
  /* ボール静止点。ダイブ絵＝手元の少し手前（旧+30,+6 を縮尺 150/264 で換算）。
   *   顔アップ＝手が描かれないので、割り線の少し手前で止める＝「まだ分からない」を保つ。 */
  var target = gkFace ? [divAt(H * 0.52) + 16, H * 0.52] : [hX + 17, hY + 3];
  var P = 1700;                                                         // 既存尺システムに従う（1×=1700ms）
  var _beatMs = _csBeatMs();
  if (_beatMs) P = Math.max(520, Math.min(1700, _beatMs - 250));
  var launchP = 0.06, arriveP = 0.52;
  var flipH = _csAttackRight(sc);

  function leftClip() { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(dTop, 0); ctx.lineTo(dBot, H); ctx.lineTo(0, H); ctx.closePath(); ctx.clip(); }
  function rightClip() { ctx.beginPath(); ctx.moveTo(dTop, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(dBot, H); ctx.closePath(); ctx.clip(); }
  function rim4(sil, x, y, w, h) {
    var o = 2;
    ctx.drawImage(sil, x - o, y, w, h); ctx.drawImage(sil, x + o, y, w, h);
    ctx.drawImage(sil, x, y - o, w, h); ctx.drawImage(sil, x, y + o, w, h);
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    // ── 共通FXレイヤー: 蹴りインパクトのズームパンチ（launch後240msのみ・恒常カメラ移動なし）──
    //   焦点は蹴り点側（flip込みの画面座標: 右攻めflipH時は左右反転するので中央寄りに置く）。
    ctx.save();
    _csFx.punch(ctx, W, H, (now - T0) - launchP * P, { dur: 240, cx: W / 2, cy: H * 0.6 });
    ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.imageSmoothingEnabled = true;   // 高解像度マンガ絵＝スムージング縮小（falseだとNN間引きでジャギ・斑点 2026-07-15）

    // ── 左パネル: GK焦点のスピード線＋ネット＋GK大（微ズーム）──
    ctx.save(); leftClip();
    var zL = 1.0 + Math.min(1, p / 0.7) * 0.06;
    var gc = [gkX + gkW * 0.5, gkY + gkH * 0.55];
    ctx.translate(gc[0], gc[1]); ctx.scale(zL, zL); ctx.translate(-gc[0], -gc[1]);
    var gkSpr = (gkImg.complete && gkImg.naturalWidth) ? MangaRecolor.render(_gkKey, gkImg, _gkCols) : null;
    if (gkFace) {
      /* パターン2: 顔アップのコマ。
       *   ★ このコマの主語は顔なので **_csSubdue は掛けない**（参考漫画の顔コマも減彩していない）。
       *   ★ 背景はベタ（集中線もネットも描かない）＝情報量を顔だけに寄せる（層C仕様 §3）。
       *   ★ フルブリードでコマが必ずクリップするので透過は不要。
       *   ★ 生成アートは滑らかなので、層Mが通っているのと同じ _csPixelate に流して同じドットの目に落とす。 */
      ctx.fillStyle = '#0c0a14'; ctx.fillRect(-4, -4, dBot + 12, H + 8);
      if (_lcFace.complete && _lcFace.naturalWidth) {
        var doPixD = (typeof window === 'undefined') || window.CS_LAYERC_PIXELATE !== false;
        var fwD = dBot * 1.30, fhD = fwD * (_lcFace.naturalHeight / _lcFace.naturalWidth);
        if (fhD < H * 1.06) { fhD = H * 1.06; fwD = fhD * (_lcFace.naturalWidth / _lcFace.naturalHeight); }
        var fsprD = doPixD ? _csPixelate(_lcFace, 'lc_face_c01_duel', fwD, fhD) : _lcFace;
        var prevSmD = ctx.imageSmoothingEnabled;
        if (doPixD) ctx.imageSmoothingEnabled = false;
        ctx.drawImage(fsprD, dBot * 0.42 - fwD / 2, H * 0.5 - fhD / 2, fwD, fhD);
        ctx.imageSmoothingEnabled = prevSmD;
      }
    } else {
      /* パターン1: ダイブ絵の縮小。
       *   ★ SUBDUE-01: GKは非主語なので彩度と明度を落とす。輪郭のリム(rim4)は墨のまま残すので
       *     形は読めるが「声量」だけが下がる＝主語がシューター1つに定まる。 */
      ctx.drawImage(_mangaShotBg(W, H, hX - 22, hY + 17), 0, 0);
      _csDrawNet(ctx, 2, 30, 104, 132, 0.16);
      if (gkSpr) {
        rim4(_csInkSil(gkSpr, _gkKey), gkX, gkY, gkW, gkH);
        ctx.drawImage(_csSubdue(gkSpr, _gkKey), gkX, gkY, gkW, gkH);
      }
    }
    ctx.restore();

    // ── 右パネル: 蹴り点焦点のスピード線＋シューター ──
    ctx.save(); rightClip();
    ctx.drawImage(_mangaShotBg(W, H, foot[0], foot[1] - 10), 0, 0);
    var shSpr = (shooter.complete && shooter.naturalWidth) ? MangaRecolor.render(_shKey, shooter, _cols) : null;
    if (shSpr) {
      var pw = shSpr.width * (ph / shSpr.height);
      rim4(_csInkSil(shSpr, _shKey), pcx - pw / 2, ground - ph, pw, ph);
      ctx.drawImage(shSpr, pcx - pw / 2, ground - ph, pw, ph);
    }
    ctx.restore();

    // ── 対角割り線（白い溝＋墨線・コマの上）──
    ctx.strokeStyle = _MANGA_PAPER; ctx.lineWidth = 11;
    ctx.beginPath(); ctx.moveTo(dTop, -6); ctx.lineTo(dBot, H + 6); ctx.stroke();
    ctx.strokeStyle = _MANGA_INK; ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.moveTo(dTop, -6); ctx.lineTo(dBot, H + 6); ctx.stroke();

    // ── ボール軌道（割り線を跨いで右→左）＋衝撃波＋蹴り点インパクト星（全面レイヤー）──
    if (p >= launchP) {
      var u = Math.min(1, (p - launchP) / (arriveP - launchP));
      var bx = foot[0] + (target[0] - foot[0]) * u, by = foot[1] + (target[1] - foot[1]) * u;
      ctx.beginPath();
      ctx.moveTo(foot[0], foot[1] - 3); ctx.lineTo(bx + 12, by - 9); ctx.lineTo(bx + 12, by + 9); ctx.lineTo(foot[0], foot[1] + 3);
      ctx.closePath(); ctx.fillStyle = _MANGA_PAPER; ctx.fill();
      ctx.strokeStyle = _MANGA_INK; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
      _csShockwave(ctx, foot[0], foot[1], bx, by, -18, 8, 11);
      _csShockwave(ctx, foot[0], foot[1], bx, by, 20, 8, 23);
      _lpBall(ctx, bx, by, 12, u * 9);
    }
    _csImpactStar(ctx, foot[0], foot[1], 18 + (p < 0.1 ? (0.1 - p) * 60 : 0));
    // ── 共通FXレイヤー: 蹴り点から膨張する衝撃波リング（白＋攻撃色・既存の星/ジグザグと併用）──
    _csFx.ring(ctx, foot[0], foot[1], ((now - T0) - launchP * P) / 380, { color: accent, radius: 62, cell: 3, seed: 11, chunks: 6 });
    ctx.restore();
    ctx.restore();   // FX punch
    // スプライト未ロード中は尺を超えても少し待つ（初回404様の固まり防止・上限 P+3000ms）
    // 顔アップ時は層C素材のロードも待つ（未ロードのままだと墨ベタのコマが出る）
    var _needWait = !shSpr || (gkFace ? !(_lcFace.complete && _lcFace.naturalWidth) : !gkSpr);
    if (p < 1 || (_needWait && (now - T0) < P + 3000)) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // 旧は「両雄構図＝中央(0.5)」だったが、主語がシューター1つに定まったので主役へ寄せる。
  return _csCenterSubject(canvas, pcx / W, flipH);
}

// ヘディング競り合い＝対決割り（垂直分割・2026-07-15 ユーザー指定で従来の重ね1コマ(_renderHeaderScene)から刷新）。
//   左パネル=攻撃 / 右パネル=守備。縦長コマ2枚を中央に並べ、外側は紙白マージン（2026-07-15 参考画像準拠＝高さ強調・ほぼ全身）。
//   両者は左上から飛来するクロスを見上げて競り上がり、接触→成功=右下(ゴール方向)/失敗=左上(クリア)へ弾ける。
//   role別単一スプライトをMangaRecolorでキット4色＋肌にリカラー（髪はダーク=fixed維持）。MangaRecolor必須（呼び出し側でガード）。
var _MANGA_HDR_RISE_ATK_SRC = 'img/cutscenes/manga_header_rise_atk.png';   // 原向き（左上のクロスを見上げる・2026-07-15 向き修正=反転廃止）
var _MANGA_HDR_RISE_DEF_SRC = 'img/cutscenes/manga_header_rise_def.png';   // 原向き（左上を見上げる）
function _renderHeaderRiseDuelScene(sc) {
  if (!MANGA_COMIC_STYLE) return null;   // 漫画コマ停止中→呼び出し側の || で旧ヘディング（スタジアム背景）へフォールバック
  if (typeof MangaRecolor === 'undefined' || !MangaRecolor.render) return null;   // 本番=未ロード→従来SVGフォールバック
  var W = 480, H = 216, ground = 206, mid = W / 2;
  var canvas = document.createElement('canvas');
  var SS = 2;   // 内部解像度2倍＋スムージング（NN縮小ジャギ対策 2026-07-15）
  canvas.width = W * SS; canvas.height = H * SS;
  canvas.style.cssText = 'display:block;width:100%';
  var ctx = canvas.getContext('2d');
  ctx.scale(SS, SS);

  var atkImg = _loadCutsceneImg(_MANGA_HDR_RISE_ATK_SRC), defImg = _loadCutsceneImg(_MANGA_HDR_RISE_DEF_SRC);
  var atkP = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var defP = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[sc.dfsPos]];
  var atkName = atkP ? ((typeof getPlayerName === 'function') ? getPlayerName(atkP) : atkP.name) : '';
  var defName = defP ? ((typeof getPlayerName === 'function') ? getPlayerName(defP) : defP.name) : '';
  var atkTeamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var defTeamNm = (typeof getTeamName === 'function' && sc.defence) ? getTeamName(sc.defence) : '';
  var atkSkin = _mangaFeat(atkP ? (atkP.long_name || atkP.name || '') : '').skin;
  var defSkin = _mangaFeat(defP ? (defP.long_name || defP.name || '') : '').skin;
  var atkCols = _mangaColors(sc.offence, atkSkin), defCols = _mangaColors(sc.defence, defSkin);
  var atkKey = 'hdrduel_a|' + atkCols.shirt + atkCols.shorts + atkCols.socks + atkCols.accent + atkCols.skin;
  var defKey = 'hdrduel_d|' + defCols.shirt + defCols.shorts + defCols.socks + defCols.accent + defCols.skin;
  var success = (sc.result === '成功');
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = success ? (en ? 'HEADER!' : 'ヘディング！') : (en ? 'CLEARED!' : '競り負け！');
  var labelCol = success ? '#ffe14a' : '#ff5a3c';
  var accent = success ? ((sc.offence && sc.offence.team_color) || '#d23') : ((sc.defence && sc.defence.team_color) || '#2a2');

  var timeTxt = (function () { var el = (typeof document !== 'undefined') && document.getElementById('game-time-display'); return el ? el.textContent : ''; })();

  // ジオメトリ（縦長2パネル・2026-07-15 参考画像準拠）: 中央に縦長コマ2枚（各132×216）を並べ、外側は紙白マージン。
  //   ヘディングは高さのシーン＝ほぼ全身を見せる。両者とも原向き（左上のクロスを見上げる）。
  var panelW = 132;                                   // 縦長パネル幅（高さは H いっぱい）
  var pL = mid - panelW, pR = mid + panelW;           // パネル群の左端・右端
  var ph = 205;                                       // ほぼ全身（スプライト380→205 縮尺・足元は僅かに切れる程度）
  var ATK_HFX = 0.485, ATK_HFY = 0.120;               // ATKスプライトの頭中心フラクション（実測・原向き）
  var DEF_HFX = 0.571, DEF_HFY = 0.115;               // DEFスプライトの頭中心フラクション（実測）
  var atkHead = [mid - 44, 44];                       // 攻撃の頭＝中央シームのすぐ左・上寄り
  var defHead = [mid + 46, 44];                       // 守備の頭＝中央シームのすぐ右・上寄り
  var contactPt = [mid, 36];                          // ヘッド競り＝ボール接触点（両頭の間・上）
  var ballFrom = [mid - 210, -14];                    // クロス飛来元（左上）＝両者の視線の先
  var P = 1700; var _beatMs = _csBeatMs(); if (_beatMs) P = Math.max(520, Math.min(1700, _beatMs - 250));
  var contactP = 0.50;

  function rim4(sil, x, y, w, h) { var o = 2; ctx.drawImage(sil, x - o, y, w, h); ctx.drawImage(sil, x + o, y, w, h); ctx.drawImage(sil, x, y - o, w, h); ctx.drawImage(sil, x, y + o, w, h); }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = labelCol; ctx.fillText(label, 12, H - 9);
    var nm = success ? (atkName ? (atkName + (atkTeamNm ? (' · ' + atkTeamNm) : '')) : '') : (defName ? ('✕ ' + defName + (defTeamNm ? (' · ' + defTeamNm) : '')) : '');
    if (nm) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(nm, W - 12, H - 10); }
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;   // 高解像度マンガ絵＝スムージング縮小（NNジャギ対策 2026-07-15）

    var atkSpr = (atkImg.complete && atkImg.naturalWidth) ? MangaRecolor.render(atkKey, atkImg, atkCols) : null;
    var defSpr = (defImg.complete && defImg.naturalWidth) ? MangaRecolor.render(defKey, defImg, defCols) : null;
    var lift = 12 * (1 - Math.min(1, p / contactP));   // 接触までに競り上がる（少し下→apex）

    // ── 紙白マージン（縦長コマの外側）──
    ctx.fillStyle = _MANGA_PAPER; ctx.fillRect(0, 0, W, H);

    // ── 左パネル: 攻撃（縦長・全身・微ズーム）──
    ctx.save(); ctx.beginPath(); ctx.rect(pL, 0, panelW, H); ctx.clip();
    var zL = 1.0 + Math.min(1, p / 0.7) * 0.05;
    ctx.translate(contactPt[0], contactPt[1]); ctx.scale(zL, zL); ctx.translate(-contactPt[0], -contactPt[1]);
    ctx.drawImage(_mangaShotBg(W, H, contactPt[0] - 20, contactPt[1] + 6), 0, 0);
    if (atkSpr) { var aw = atkSpr.width * (ph / atkSpr.height); var ax = atkHead[0] - aw * ATK_HFX, ay = atkHead[1] - ph * ATK_HFY + lift;
      rim4(_csInkSil(atkSpr, atkKey), ax, ay, aw, ph); ctx.drawImage(atkSpr, ax, ay, aw, ph); }
    ctx.restore();

    // ── 右パネル: 守備（縦長・全身・微ズーム）──
    ctx.save(); ctx.beginPath(); ctx.rect(mid, 0, panelW, H); ctx.clip();
    var zR = 1.0 + Math.min(1, p / 0.7) * 0.05;
    ctx.translate(contactPt[0], contactPt[1]); ctx.scale(zR, zR); ctx.translate(-contactPt[0], -contactPt[1]);
    ctx.drawImage(_mangaShotBg(W, H, contactPt[0] + 20, contactPt[1] + 6), 0, 0);
    if (defSpr) { var dw = defSpr.width * (ph / defSpr.height); var dx = defHead[0] - dw * DEF_HFX, dy = defHead[1] - ph * DEF_HFY + lift;
      rim4(_csInkSil(defSpr, defKey), dx, dy, dw, ph); ctx.drawImage(defSpr, dx, dy, dw, ph); }
    ctx.restore();

    // ── コマ枠（外枠の墨＋中央の白溝シーム）──
    ctx.strokeStyle = _MANGA_INK; ctx.lineWidth = 4.5;
    ctx.strokeRect(pL + 2, 2, panelW * 2 - 4, H - 4);
    ctx.strokeStyle = _MANGA_PAPER; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(mid, 4); ctx.lineTo(mid, H - 4); ctx.stroke();
    ctx.strokeStyle = _MANGA_INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(mid, 2); ctx.lineTo(mid, H - 2); ctx.stroke();

    // ── ボール: 左上からのクロスが接触点へ飛来 → 接触で 成功=右下(ゴール方向) / 失敗=左上(クリア) ──
    if (p < contactP) {
      var it = p / contactP;
      var bx = ballFrom[0] + (contactPt[0] - ballFrom[0]) * it;
      var by = ballFrom[1] + (contactPt[1] - ballFrom[1]) * it - 24 * Math.sin(it * Math.PI);   // ふわっとした弧
      var vx = ballFrom[0] - contactPt[0], vy = ballFrom[1] - contactPt[1], vl = Math.sqrt(vx * vx + vy * vy) || 1;
      ctx.strokeStyle = 'rgba(20,22,28,0.35)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + vx / vl * 38, by + vy / vl * 38); ctx.stroke(); ctx.lineCap = 'butt';
      if (bx > -22 && bx < W + 22) _lpBall(ctx, bx, by, 11, it * 12);
    } else {
      var u = (p - contactP) / (1 - contactP); u = 1 - (1 - u) * (1 - u);
      var dir = success ? 1 : -1;                       // 成功=右下(ゴールへ叩きつけ) / 失敗=左上(クリアで戻す)
      var bx2 = contactPt[0] + dir * 320 * u;
      var by2 = success ? (contactPt[1] + 84 * u) : (contactPt[1] - 60 * u - 16 * Math.sin(u * Math.PI));
      if (bx2 > -22 && bx2 < W + 22 && by2 < H + 22) _lpBall(ctx, bx2, by2, 11, u * 24 * dir);
    }
    // 接触インパクト（中央上部の星＋フラッシュ）
    var contact = (p >= contactP - 0.02 && p < contactP + 0.12) ? 1 - Math.abs(p - contactP) / 0.12 : 0;
    if (contact > 0) { _csImpactStar(ctx, contactPt[0], contactPt[1], 20 * contact); ctx.fillStyle = 'rgba(255,255,255,' + (contact * 0.4) + ')'; ctx.fillRect(0, 0, W, H); }

    hud();
    if (p < 1 || ((!atkSpr || !defSpr) && (now - T0) < P + 3000)) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return _csCenterSubject(canvas, 0.5, false);
}

// ============================================================
// シュート専用カットイン: シューター（1フレーム・攻撃チーム色）＋コードのボール。
//   セーブ(GK防いだ！)=シューター＋GK(左・自動コントラスト色)＋ボールが手元で弾かれる。
//   枠外/ブロック=現状の左へ抜ける簡易演出（後で専用画像に差し替え）。ゴール！！は takeover 側。
//   1回再生で静止（ループしない）。detach で停止。
// ============================================================
// 採用シュート4コマ（2026-08-13・演出ラボ先行）
//   ユーザー指定のファイル名時刻順で1ビートとして再生する。
//   白地を除去した透明PNGを共通フィールド背景へ重ねる。
//   ★ 表示層のみ。実試合のシュート選択・結果・rng消費には接続しない。
// ============================================================
var _ADOPTED_SHOT_FRAMES = [
  { src: 'img/cutscenes/manga_shot_adopted/frame_01_20260812_194453_alpha.png?v=3', crop: [105, 179, 885, 1143], cx: 348 },
  { src: 'img/cutscenes/manga_shot_adopted/frame_02_20260812_195322_alpha.png?v=3', crop: [203, 86, 829, 1190], cx: 320 },
  { src: 'img/cutscenes/manga_shot_adopted/frame_03_20260812_195726_alpha.png?v=3', crop: [93, 113, 1009, 1156], cx: 330 },
  { src: 'img/cutscenes/manga_shot_adopted/frame_04_20260813_054443_alpha.png?v=3', crop: [44, 196, 844, 1301], cx: 342 }
];

function _renderAdoptedShotScene(sc) {
  if (typeof document === 'undefined') return null;
  var W = 480, H = 216, ground = 190, P = 560;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var imgs = _ADOPTED_SHOT_FRAMES.map(function (f) { return _loadCutsceneImg(f.src); });
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var flipH = _csAttackRight(sc);
  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;

  // 「2拍・顔カットイン」と同じ、蹴り点から放射する短い衝撃線。
  function drawKickBurst(x, y, a) {
    ctx.strokeStyle = 'rgba(255,255,255,' + (a * 0.72).toFixed(3) + ')';
    ctx.lineWidth = 2.5;
    for (var i = 0; i < 14; i++) {
      var an = i / 14 * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(an) * 14, y + Math.sin(an) * 14);
      ctx.lineTo(x + Math.cos(an) * 58, y + Math.sin(an) * 58);
      ctx.stroke();
    }
  }

  function drawFigure(idx, kick) {
    var f = _ADOPTED_SHOT_FRAMES[idx], img = imgs[idx];
    if (!img || !img.complete || !img.naturalWidth) return;
    // ヘディング6コマの透明余白を除いた人物高（約125〜150px）に近づける。
    // キック時は1.045倍になるため、基準160pxで最大約167px。
    var dh = 160, dw = dh * f.crop[2] / f.crop[3];
    var dx = f.cx - dw / 2, dy = ground - dh;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    var punch = kick ? 1.045 : 1;
    ctx.translate(f.cx, H * 0.56); ctx.scale(punch, punch); ctx.translate(-f.cx, -H * 0.56);
    ctx.drawImage(img, f.crop[0], f.crop[1], f.crop[2], f.crop[3], dx, dy, dw, dh);
    ctx.restore();
    return { x: dx, y: dy, w: dw, h: dh };
  }

  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);

    // 「2拍・顔カットイン」と同じ210msのインパクト揺れ。
    // 背景はdepth=0.34なので約1px、選手・ボールは主役面として最大3pxだけ動く。
    var cam = _csCam.mk({ fx: 284, fy: 168 });
    var camOn = (typeof CS_CAM_ENABLED === 'undefined') || CS_CAM_ENABLED;
    if (camOn) _csCam.shake(cam, (p - 0.20) * P, 210, 3.0);

    _csCam.begin(ctx, cam, camOn ? 0.34 : 1);
    ctx.imageSmoothingEnabled = false;
    _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    _csCam.end(ctx);

    var idx = p < 0.20 ? 0 : p < 0.40 ? 1 : p < 0.68 ? 2 : 3;
    ctx.save();
    if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    _csCam.begin(ctx, cam, camOn ? 1 : 1);
    var box = drawFigure(idx, idx === 2);

    // 2コマ目の蹴り足の足首を起点に、低い軌道で3コマ目へつなぐ。
    // 速度は「2拍・顔カットイン」の実速度（約1,400px/秒）へ合わせる。
    if ((idx === 1 || idx === 2) && box) {
      var u = Math.max(0, Math.min(1, (p - 0.20) / 0.39));
      var contactX = 284, contactY = 168;
      var bx = contactX - 310 * u, by = contactY - 18 * u;
      if (u < 0.94) {
        _lpBall(ctx, bx, by, 10, u * 34);
      }
      var impact = 1 - Math.min(1, Math.abs(u - 0.035) / 0.12);
      if (impact > 0) {
        drawKickBurst(contactX, contactY, impact);
      }
    }
    _csCam.end(ctx);
    ctx.restore();

    // 参照演出と同じく、蹴った瞬間だけ全画面を短く白く飛ばす。
    var flash = 1 - Math.min(1, Math.abs(p - 0.214) / 0.042);
    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (flash * 0.42).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return canvas;
}

// 追加シュート4拍（GFX-04）。既存の採用4コマは保護したまま、決定論的に交互表示する。
// 分離色ベースを MangaRecolor に通すため、攻撃側のキット色と選手の肌色へ追従する。
var _CINEMATIC_SHOT_FRAMES = [
  'img/cutscenes/manga_shot_cinematic/frame_01.png?v=1',
  'img/cutscenes/manga_shot_cinematic/frame_02.png?v=1',
  'img/cutscenes/manga_shot_cinematic/frame_03.png?v=1',
  'img/cutscenes/manga_shot_cinematic/frame_04.png?v=1'
];

function _renderCinematicShotScene(sc) {
  if (typeof document === 'undefined') return null;
  var W = 480, H = 216, ground = 192, P = 620;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var imgs = _CINEMATIC_SHOT_FRAMES.map(function (src) { return _loadCutsceneImg(src); });
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var shooterP = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var feat = _mangaFeat(shooterP ? (shooterP.long_name || shooterP.name || '') : '');
  var cols = _mangaColors(sc.offence, feat.skin);
  var recolor = typeof MangaRecolor !== 'undefined' && MangaRecolor.render;
  var nativeRight = true;
  var flipH = nativeRight !== _csAttackRight(sc);
  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;

  function drawFigure(idx, kick) {
    var img = imgs[idx];
    if (!img || !img.complete || !img.naturalWidth) return null;
    var spr = recolor ? MangaRecolor.render('cinematic-shot-' + idx, img, cols) : img;
    var dh = 166, dw = dh * ((spr.width || img.naturalWidth) / (spr.height || img.naturalHeight));
    var cx = 205, dx = cx - dw / 2, dy = ground - dh;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    var punch = kick ? 1.045 : 1;
    ctx.translate(cx, H * 0.57); ctx.scale(punch, punch); ctx.translate(-cx, -H * 0.57);
    ctx.drawImage(spr, dx, dy, dw, dh);
    ctx.restore();
    return { x: dx, y: dy, w: dw, h: dh };
  }

  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);

    var cam = _csCam.mk({ fx: 300, fy: 168 });
    var camOn = (typeof CS_CAM_ENABLED === 'undefined') || CS_CAM_ENABLED;
    if (camOn) _csCam.shake(cam, (p - 0.47) * P, 170, 2.7);
    _csCam.begin(ctx, cam, camOn ? 0.34 : 1);
    ctx.imageSmoothingEnabled = false;
    _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    _csCam.end(ctx);

    var idx = p < 0.22 ? 0 : p < 0.43 ? 1 : p < 0.68 ? 2 : 3;
    ctx.save();
    if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    _csCam.begin(ctx, cam, camOn ? 1 : 1);
    var box = drawFigure(idx, idx === 2);
    if (p >= 0.43 && box) {
      var u = Math.max(0, Math.min(1, (p - 0.43) / 0.32));
      var contactX = box.x + box.w * 0.97, contactY = box.y + box.h * 0.72;
      var bx = contactX + 330 * u, by = contactY - 20 * u;
      if (u < 0.94) _lpBall(ctx, bx, by, 10, u * 34);
    }
    _csCam.end(ctx);
    ctx.restore();

    var flash = 1 - Math.min(1, Math.abs(p - 0.47) / 0.045);
    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (flash * 0.38).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return canvas;
}

// ============================================================
// 通常シュートの本編入口。
//   保護対象の採用4コマと、追加したシネマチック4拍を決定論で交互表示する。
//   entry は既存呼び出し互換のため受け取る。
// ============================================================
function _renderShotScene(sc, entry) {
  var canRecolor = typeof MangaRecolor !== 'undefined' && MangaRecolor.render;
  return (canRecolor && (_csShotVarHash(sc) & 1)) ? _renderCinematicShotScene(sc) : _renderAdoptedShotScene(sc);
}

// 旧シュート演出（演出ラボでの比較確認専用・本編からは呼ばない）。
function _renderLegacyShotScene(sc, entry) {
  // 構図ローテーション（lab）: 決定論ハッシュが奇数 → Var A=対角対決割り（_renderShotDuelScene）。偶数 → Var B=2拍（本体）。
  //   対象は result='成功'（分割'shot'ビート/PK蹴り＝結果非開示）のみ。ブロック等の結果付き描画は Var B 固定。
  //   MangaRecolor 未ロードの公開ビルドはこの分岐に入らず常に従来経路＝公開版不変。
  var _labForce2 = (typeof window !== 'undefined') && window._LAB_FORCE_SHOT2;   // ラボ限定: 構図ローテを止めて必ず2拍本体を描く（本番は未定義＝従来どおり）
  if (!_labForce2 && MANGA_COMIC_STYLE && typeof MangaRecolor !== 'undefined' && MangaRecolor.render && sc.result === '成功' && (_csShotVarHash(sc) & 1)) {
    return _renderShotDuelScene(sc);
  }
  var W = 480, H = 216, ground = 190;
  var canvas = document.createElement('canvas');
  // マンガ絵経路のみ内部2倍＋スムージング（NN縮小ジャギ対策 2026-07-15）。従来ドット絵経路（公開ビルド）は等倍＋pixelated維持。
  var SS = 1;   // 等倍＋NNへ復帰（レトロ画素感 2026-07-15）。粗ドット化は _csPixelate 前段の高品質縮小が担う
  canvas.width = W * SS; canvas.height = H * SS;
  canvas.style.cssText = 'display:block;width:100%' + (SS > 1 ? '' : ';image-rendering:pixelated');
  var ctx = canvas.getContext('2d');
  if (SS > 1) ctx.scale(SS, SS);
  // 漫画方式（lab・MangaRecolor ロード時）: シューターを選手別の髪型スプライト＋キット4色/肌でリカラー。
  //   本番（未ロード）は従来のプリカラー shot_<kit> にフォールバック。シュート12髪型は 2026-07-10 受入（manga_shot/）。
  var shooterP0 = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var _shotManga = (typeof MangaRecolor !== 'undefined' && MangaRecolor.render);   // スプライトは新素材（従来演出の上に描く・2026-07-15）
  var _shFeat = _shotManga ? _mangaFeat(shooterP0 ? (shooterP0.long_name || shooterP0.name || '') : '') : null;
  var _shCols = _shotManga ? _mangaColors(sc.offence, _shFeat.skin) : null;
  var _shDir2 = _shotSpriteDir();
  var _shKey = _shFeat ? ('shot|' + _shDir2 + '|' + _shFeat.hstyle + '|' + _shCols.shirt + _shCols.shorts + _shCols.socks + _shCols.accent + _shCols.skin) : null;
  var shooter = _shotManga ? _loadCutsceneImg('img/cutscenes/' + _shDir2 + '/' + _shFeat.hstyle + '.png') : _loadCutsceneImg(entry.file);
  // ── 2コマアニメ（振りかぶり→蹴り・FKのfreekick1→2と同方式・2026-07-23検証中）──
  //   新素材ペア manga_shot_anim/{windup,strike}.png（1髪型のみ・A案=まず動作検証）。
  //   両方ロード済みの時だけ発動。未ロード/本番(MangaRecolor無し)は従来の1枚絵のまま。
  var _labAnim = (typeof window !== 'undefined') ? window._LAB_SHOT_ANIM : undefined;   // ラボ限定の強制（true=2コマ/false=静止絵・本番は未定義）
  var _an2 = _shotManga && ((_labAnim === true || _labAnim === false) ? _labAnim : (Math.random() < 0.5));   // 従来1枚絵と2コマアニメをランダム50/50（ユーザー指示2026-07-23・表示層のみ＝エンジンrng不使用）
  var _anWind = _an2 ? _loadCutsceneImg('img/cutscenes/manga_shot_anim/windup.png?v=5') : null;   // v4=アセット420px化(潰れ対策)・2026-07-23
  var _anStrike = _an2 ? _loadCutsceneImg('img/cutscenes/manga_shot_anim/strike.png?v=5') : null;
  var _anColsStr = _shCols ? (_shCols.shirt + _shCols.shorts + _shCols.socks + _shCols.accent + _shCols.skin) : '';
  var _anKeyW = _an2 ? ('shotanim_w|' + _anColsStr) : null;
  var _anKeyS = _an2 ? ('shotanim_s|' + _anColsStr) : null;
  var _AN_SW = 0.12;   // 振りかぶり→蹴りの切替点。クロス流用と同じ早テンポ（sw=0.12・ユーザー指示2026-07-23）
  var _anBallR = _an2 ? 9 : 7;   // 2コマアニメのボールは選手を元サイズに戻すぶん実比率に合わせ拡大（14→18px・2026-07-23）
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var accent = (sc.offence && sc.offence.team_color) || '#1f4fd6';

  // HUD データ（一度だけ）
  var gs = (typeof gameState !== 'undefined' && gameState) ? gameState : {};
  var t1 = gs.team1, t2 = gs.team2;
  var c1 = (t1 && t1.team_color) || '#1f4fd6', c2 = (t2 && t2.team_color) || '#e36b1f';
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display'), s1 = dom('score1'), s2 = dom('score2');
  var shooterP = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var shooterName = shooterP ? ((typeof getPlayerName === 'function') ? getPlayerName(shooterP) : shooterP.name) : '';
  var teamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');

  var res = sc.result;
  var isSave = (res === 'GK防いだ！'), isWide = (res === '枠を外した！'), isBlock = (res === 'ブロック');
  var outLabel = isWide ? (en ? 'OFF TARGET' : '枠外！') : isBlock ? (en ? 'BLOCKED!' : 'ブロック！') : isSave ? (en ? 'GK SAVE!' : 'ナイスセーブ！') : (en ? 'SHOT' : 'シュート');
  var outColor = isWide ? '#ffd24a' : '#ff5a3c';
  var gkColor = isSave ? _pickGkColor(accent, sc.defence && sc.defence.team_color) : null;   // GK色=両チームと別色
  var _svGkManga = isSave && (typeof MangaRecolor !== 'undefined' && MangaRecolor.render);   // GKスプライトは新素材（従来演出の上に描く・2026-07-15）
  var _svGkP = isSave && sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[0]];
  var _svGkCols = _svGkManga ? _gkDiveColors(gkColor, _mangaFeat(_svGkP ? (_svGkP.long_name || _svGkP.name || '') : '').skin) : null;
  var _svDive = _svGkManga ? _pickGkDive() : _GK_DIVES[0];   // マンガGK時のみランダム別ポーズ（従来スプライトはpose0のアンカーを使う）
  var _svGkKey = _svGkManga ? ('gkdive|' + _svDive.id + '|' + gkColor + '|' + _svGkCols.skin) : null;   // ポーズ別キー（共通キーだと先勝ちの絵が焼き付く）
  var gkImg = isSave ? (_svGkManga ? _loadCutsceneImg(_svDive.src) : _loadCutsceneImg('img/cutscenes/gk_' + gkColor + '_01.png')) : null;

  // ── 漫画2拍演出（lab・北極星カンプ）────────────────────────────────
  //   拍1: 背景を放射スピード線＋ハーフトーンへ（_shotManga と同条件＝MangaRecolor 未ロードの公開ビルドは従来背景）。
  //   拍2: 終盤に守備側GK（defence lineup[0]）の顔カットイン帯。Portrait 未ロードならカットインごとスキップ。
  var _mangaBg = _shotManga && MANGA_COMIC_STYLE;   // 漫画コマ停止中はスタジアム背景（_lpDrawBg）＋墨リムなし
  var _cutinOn = MANGA_COMIC_STYLE && _shotManga && !isSave && (typeof Portrait !== 'undefined') && Portrait && Portrait.render;
  var _cutinBust = null, _cutinBandC = null;
  if (_cutinOn) {
    var _ciGkP = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[0]];
    var _ciGkName = _ciGkP ? (_ciGkP.long_name || _ciGkP.name || '') : '';
    // GKキット色＝ダイブ絵（次ビート）と同じ _pickGkColor で選び、帯のジャージ色と連続させる
    var _ciGkHex = _GK_HEX[_pickGkColor(accent, sc.defence && sc.defence.team_color)] || '#f2c200';
    try {
      Portrait.preload().then(function () {
        var bc = document.createElement('canvas'); bc.width = 240; bc.height = 280;
        Portrait.render(bc, _ciGkName, { team: _ciGkHex });
        _cutinBust = bc;
      }).catch(function () { /* 顔素材が来ない場合はカットインなしで進行（rAF延長はP+2400msで打ち切り済み） */ });
    } catch (e) { _cutinOn = false; }
  }

  var ph = Math.round(178 * CS_FIGURE_SCALE), pcx = 326, sprW = Math.round(133 * CS_FIGURE_SCALE);   // 2/3縮小(2026-07-23)。右配置・ネイティブ左向き＝反転不要
  if (_an2) { ph = Math.round(178 * CS_FIGURE_SCALE); sprW = Math.round(133 * CS_FIGURE_SCALE); }    // 2コマアニメも既存シュート絵と同サイズへ戻す（小さすぎ・潰れ対策＝ボール側を拡大して比率を取る・2026-07-23）
  var sx0 = pcx - sprW / 2, sy0 = ground - ph;
  var foot = [sx0 + sprW * 0.42, sy0 + ph * 0.79];            // 軸足のすねの前＝ボール起点（赤枠位置・TUNE）
  if (_an2) {
    // 2コマアニメのボール起点＝振りかぶり絵の軸足の足首(画像内64.3%,89.6%を実測)から30px左（ユーザー指示2026-07-23）
    var _anPw = ph * (1045 / 1159);   // windup.png(整え版v3) のアスペクトで描画幅を先計算（ロード前でも確定値）
    foot = [pcx + _anPw * (0.621 - 0.5) + 30, ground - ph * (1 - 0.903)];   // 足首実測fx=0.621,fy=0.903(v3)。+30=表示上の30px左（flipH鏡像のため符号逆・2026-07-23実機確認）
  }
  var strikeP = 0, ballSpd = 2400, P = 1700;                  // 蹴った瞬間から即発射（待ちフレームなし・2026-07-10）・まっすぐ左へ
  // 監督ビューアの再生速度(1×/2×/3×)に追従: ビート尺-250ms 内にアニメ＋拍2が収まるよう短縮（1×は従来1700ms）。
  var _beatMs = _csBeatMs();
  if (_beatMs) P = Math.max(520, Math.min(1700, _beatMs - 250));
  var _CUT_START = 0.52, _CUT_DUR = 0.16;                     // 拍2: アニメ52%時点でスライド開始・16%で着地→終端まで保持
  var flipH = _csAttackRight(sc);                             // ネイティブ=左攻め → team1(右)で反転

  function speedLines(x, y, a, col) { ctx.strokeStyle = col || ('rgba(255,255,255,' + a + ')'); ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 14, y + Math.sin(an) * 14); ctx.lineTo(x + Math.cos(an) * 58, y + Math.sin(an) * 58); ctx.stroke(); } }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;   // 焼き込みラベル停止（時刻/アクション名/選手名はHUD・ネーム枠へ集約）
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    // ミニスコア（色チップ＋略称＋スコア）はスコアボードへ集約のため非表示。時間(左上)とラベル/選手名は残す。
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(outLabel, 12, H - 9); ctx.fillStyle = outColor; ctx.fillText(outLabel, 12, H - 9);
    if (shooterName) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(shooterName + (teamNm ? (' · ' + teamNm) : ''), W - 12, H - 10); }
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    var z = 1.0 + Math.min(1, p / 0.6) * 0.08;                       // 寄り
    var strikeF = (p > strikeP - 0.02 && p < strikeP + 0.08) ? 1 - Math.abs(p - strikeP) / 0.08 : 0;
    /* CAM-01: 既存の寄り(z)をカメラへ移し、背景だけ深度を下げてパララックスを作る（2026-07-28）。
     * ★ 紙白背景(_mangaBg)は深度1のまま。放射スピード線が蹴り点から出ている“主役と一体の絵”なので、
     *   ここを奥へ置くと線の中心が主役からズレて破綻する。パララックスするのは実写的なピッチ背景だけ。
     * ★ 蹴りの瞬間だけ揺らす（strikeP＝インパクト）。 */
    var cam = _csCam.mk({ fx: foot[0], fy: foot[1] });
    var camOn = (typeof CS_CAM_ENABLED === 'undefined') || CS_CAM_ENABLED;
    cam.zoom = z;
    if (camOn) {
      /* 拍に合わせた寄り。従来の z は p 依存のなだらかな寄りで、**一番効かせたい蹴りの瞬間に
       * 何も起きなかった**。振りかぶりは浅く抑え、インパクトで一段踏み込む。
       * ★ 踏み込んだ後は**引かない**（2026-07-28 ユーザー指示）。寄って戻すと勢いが打ち消され、
       *   決まった画がふわっと緩む。寄りは片道＝到達した画角のまま拍を終える。
       * ★ strikeP はこの下で毎フレーム再代入される（初回のみ1フレーム古い値＝自己補正されるので実害なし）。 */
      var sp = strikeP || 0;
      var wind = _csCam.smooth(_csCam.clamp01(sp > 0.02 ? p / sp : 1));
      var kick = _csCam.easeOut(_csCam.clamp01((p - sp) / 0.10));
      cam.zoom = 1 + 0.03 * wind + 0.09 * kick;
      _csCam.shake(cam, (p - sp) * P, 210, 3.0);
    }
    var BGD = (camOn && !_mangaBg) ? 0.34 : 1;
    function beginLayer(depth) {
      ctx.save();
      if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      _csCam.begin(ctx, cam, camOn ? depth : 1);
    }
    function endLayer() { _csCam.end(ctx); ctx.restore(); }

    beginLayer(BGD);
    ctx.imageSmoothingEnabled = SS > 1;   // マンガ絵=スムージング / ドット絵=NN維持（2026-07-15）
    if (_mangaBg) ctx.drawImage(_mangaShotBg(W, H, foot[0], foot[1] - 10), 0, 0);   // 拍1: 紙白＋放射スピード線＋網点
    else _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    endLayer();

    beginLayer(1);
    ctx.imageSmoothingEnabled = SS > 1;
    // 2コマアニメ発動判定（両フレームのロード完了時のみ）。p<切替点=振りかぶり／以降=蹴り
    var _useAnim = _an2 && _anWind && _anWind.complete && _anWind.naturalWidth && _anStrike && _anStrike.naturalWidth;
    strikeP = _useAnim ? _AN_SW : 0;   // アニメ時はボールも蹴りの瞬間まで足元で待つ
    var _frImg = _useAnim ? (p < _AN_SW ? _anWind : _anStrike) : shooter;
    var _frKey = _useAnim ? (p < _AN_SW ? _anKeyW : _anKeyS) : _shKey;
    var _shSpr = (_shotManga && _frImg.complete && _frImg.naturalWidth) ? MangaRecolor.render(_frKey, _frImg, _shCols) : ((_frImg.complete && _frImg.naturalWidth) ? _frImg : null);
    if (_shSpr) {
      var pw = _shSpr.width * (ph / _shSpr.height);
      if (_shotManga && _frKey) _shSpr = _csPixelate(_shSpr, _frKey, pw, ph);   // レトロ画素化（高品質縮小→NN拡大）
      if (_mangaBg && _frKey) {   // 紙白に白キットが溶けないよう墨リム2px（シルエット4方向オフセット）
        var _sil = _csInkSil(_shSpr, _frKey), _o = 2;
        ctx.drawImage(_sil, pcx - pw / 2 - _o, ground - ph, pw, ph);
        ctx.drawImage(_sil, pcx - pw / 2 + _o, ground - ph, pw, ph);
        ctx.drawImage(_sil, pcx - pw / 2, ground - ph - _o, pw, ph);
        ctx.drawImage(_sil, pcx - pw / 2, ground - ph + _o, pw, ph);
      }
      ctx.drawImage(_shSpr, pcx - pw / 2, ground - ph, pw, ph);
    }
    if (isSave) {
      // ===== セーブ: GK(左)＋ボールが手元で弾かれる =====
      var gkW = _svGkManga ? 145 * _svDive.ws : 210, gkH = gkW * (_svGkManga ? _svDive.hw : (127 / 220)), gkX = 8, gkY = 58;   // GK配置（TUNE）。スプライト別にアスペクト＆幅を切替＝描画高≈121で従来と同じ距離感（2026-07-15）
      if (gkImg && gkImg.complete && gkImg.naturalWidth) { var _svs = _svGkManga ? MangaRecolor.render(_svGkKey, gkImg, _svGkCols) : gkImg; if (_svs && _svGkManga) _svs = _csPixelate(_svs, _svGkKey, gkW, gkH); if (_svs) ctx.drawImage(_svs, gkX, gkY, gkW, gkH); }
      var hX = gkX + gkW * (_svGkManga ? _svDive.gx : 0.84), hY = gkY + gkH * (_svGkManga ? _svDive.gy : 0.13), savP = 0.46;           // GKの手元＝ボール到達点（reaching glove アンカー・絵別）
      if (p < strikeP) { _lpBall(ctx, foot[0], foot[1], 7, 0); }              // かかとで待つ
      else if (p < savP) { var u = (p - strikeP) / (savP - strikeP); _lpBall(ctx, foot[0] + (hX - foot[0]) * u, foot[1] + (hY - foot[1]) * u, 7, (p - strikeP) * 70); }   // 手元へ飛ぶ
      else { var u2 = Math.min(1, (p - savP) / 0.34), ue = 1 - (1 - u2) * (1 - u2); _lpBall(ctx, hX - 72 * ue, hY - 34 * ue, 7, 14 + u2 * 18); }                          // 弾かれて左上へ
      var sv = (p > savP - 0.03 && p < savP + 0.10) ? 1 - Math.abs(p - savP) / 0.10 : 0;
      if (sv > 0) speedLines(hX, hY, sv * 0.7);                                // セーブ・インパクト
    } else {
      if (p < strikeP) { _lpBall(ctx, foot[0], foot[1], _anBallR, 0); }             // かかとで待つ
      else {
        var bx = foot[0] - ballSpd * (p - strikeP);
        if (_mangaBg) {
          // 墨縁の白抜きボール軌道（先細り・残す＝カンプの trail）＋蹴り点のインパクト星
          var tx1 = Math.max(bx + 14, -2);
          if (tx1 < foot[0] - 8) {
            ctx.beginPath(); ctx.moveTo(foot[0], foot[1] - 3); ctx.lineTo(tx1, foot[1] - 9); ctx.lineTo(tx1, foot[1] + 9); ctx.lineTo(foot[0], foot[1] + 3); ctx.closePath();
            ctx.fillStyle = _MANGA_PAPER; ctx.fill();
            ctx.strokeStyle = _MANGA_INK; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
          }
          _csImpactStar(ctx, foot[0], foot[1], 20 + strikeF * 8);
        }
        if (bx > -16) _lpBall(ctx, bx, foot[1], _anBallR, (p - strikeP) * 80);      // まっすぐ左へ（高速）
      }
    }
    if (strikeF > 0) speedLines(foot[0], foot[1], strikeF * 0.6, _mangaBg ? ('rgba(20,22,28,' + (strikeF * 0.55).toFixed(3) + ')') : null);   // 蹴り出しバースト（紙白では墨色）
    endLayer();
    if (strikeF > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (strikeF * 0.45) + ')'; ctx.fillRect(0, 0, W, H); }
    // ── 拍2: 守備GK顔カットイン帯（アニメ終盤・下端から斜めスライドイン・台詞なし）──
    //   帯は常に「シューターと反対側」の下隅（flipH でシーンごと鏡像）。バスト未ロード中は描かず rAF を延長して待つ。
    if (_cutinOn && _cutinBust && p >= _CUT_START) {
      if (!_cutinBandC) _cutinBandC = _buildShotCutinBand(W * 0.44, H * 0.46, _cutinBust);
      var q = Math.min(1, (p - _CUT_START) / _CUT_DUR);
      var eB = 1 + 1.9 * Math.pow(q - 1, 3) + 0.9 * Math.pow(q - 1, 2);   // easeOutBack弱（軽いオーバーシュート）
      ctx.save();
      if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      ctx.translate(-(_cutinBandC.width + 40) * (1 - eB), _cutinBandC.height * 0.35 * (1 - eB));
      ctx.translate(0, H); ctx.rotate(-0.10 * (1 - eB)); ctx.translate(0, -H);
      ctx.shadowColor = 'rgba(10,12,17,.35)'; ctx.shadowOffsetX = 5; ctx.shadowOffsetY = -5; ctx.shadowBlur = 0;
      ctx.drawImage(_cutinBandC, 0, H - _cutinBandC.height);
      ctx.restore();
    }
    hud();
    if (p < 1 || (_cutinOn && !_cutinBandC && (now - T0) < P + 2400)) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // シューターが pcx=326（右1/3・0.68）。セーブでもシューターが主役なので同じく主役中央へ寄せる。
  return _csCenterSubject(canvas, pcx / W, flipH);
}

// ============================================================
// ショートパス: 単一フレームのパサー＋コードのボールで「近くの味方へ短い地上パス」。攻撃側チーム色・左攻めネイティブ。
//   1回再生で静止（パス到達でボールが止まる）。生成元 tools/art/cutscenes/shortpass.png。
// ============================================================
var _MANGA_SHORTPASS_SRC = 'img/cutscenes/manga_shortpass_01.png';   // 203×460・単体・走り・ネイティブ右向き（漫画分離キット＋fade黒髪・透明マージン6px）
function _renderShortpassScene(sc, entry) {
  var W = 480, H = 216, ground = 190;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var accent = (sc.offence && sc.offence.team_color) || '#1f4fd6';

  var gs = (typeof gameState !== 'undefined' && gameState) ? gameState : {};
  var t1 = gs.team1, t2 = gs.team2;
  var c1 = (t1 && t1.team_color) || '#1f4fd6', c2 = (t2 && t2.team_color) || '#e36b1f';
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display'), s1 = dom('score1'), s2 = dom('score2');
  var passer = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var passerName = passer ? ((typeof getPlayerName === 'function') ? getPlayerName(passer) : passer.name) : '';
  var teamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = en ? 'SHORT PASS' : 'ショートパス';

  // 1枚化（ユーザー要望「一旦すべてこの1枚にする」2026-07-10）:
  //   MangaRecolor が使える lab では新しい漫画スプライト manga_shortpass_01（ネイティブ右向き・走り）を
  //   チーム別リカラーして常用（3パターンとも同じ絵に）。本番(MangaRecolor 未ロード)は従来のプリカラー
  //   entry.file にフォールバック。foot=蹴り足のボール起点(絶対座標)・spriteFlip=pcx中心でスプライトを反転。
  //   ★向き: ボールは pre-flipH で左（攻撃方向）へ蹴り出す。パサーもその左を向くべき。
  //     表示向き = native XOR spriteFlip XOR flipH。新スプライトは native右 → spriteFlip:true で左を向く。
  //   ★将来3種へ戻す場合: 下の _poses3 を復活させ Math.random() 選択に戻せばよい（構造温存・完全可逆）。
  //     var _poses3 = [
  //       { img: _loadCutsceneImg(entry.file),   rc: null,  ph: 178, pcx: 318, foot: [300, 160], spriteFlip: true },   // 従来: native右
  //       { img: _loadCutsceneImg(_ONETWO2_SRC), rc: 'ot2', ph: 182, pcx: 318, foot: [300, 166], spriteFlip: true },   // onetwo2(走り): native右
  //       { img: _loadCutsceneImg(_ONETWO1_SRC), rc: 'ot1', ph: 182, pcx: 318, foot: [300, 166], spriteFlip: false }   // onetwo1(パサー): native左
  //     ];
  //     var _pose = _poses3[Math.floor(Math.random() * _poses3.length)];
  var _mangaOn = (typeof MangaRecolor !== 'undefined' && MangaRecolor.render &&
                  (typeof window === 'undefined' || window.MANGA_CUTSCENE_ENABLED !== false));
  var _pose;
  if (_mangaOn) {
    // dribble/header と同流儀: 選手肌＋チームキット4色で MangaRecolor.render（colorsig でキャッシュ）。
    var _sk = _mangaFeat(passer ? (passer.long_name || passer.name) : '').skin;
    var _cols = _mangaColors(sc.offence, _sk);
    var _csig = _cols.shirt + _cols.shorts + _cols.socks + _cols.accent + _cols.skin;
    _pose = { img: _loadCutsceneImg(_MANGA_SHORTPASS_SRC), manga: true, mkey: 'spass|' + _csig, cols: _cols,
              ph: 160, pcx: 318, foot: [300, 172], spriteFlip: true };   // native右→反転で左（攻撃方向）を向く。選手を少し小さく(182→160)＋ボール足元を追従(166→172)
  } else {
    _pose = { img: _loadCutsceneImg(entry.file), rc: null, ph: 178, pcx: 318, foot: [300, 160], spriteFlip: true };   // 本番フォールバック: 従来プリカラー
  }
  var ph = _pose.ph, pcx = _pose.pcx, foot = _pose.foot;
  var kickP = 0.12, ballSpd = 1300, P = 1500;                // 水平に蹴り出し・少し速め
  var flipH = _csAttackRight(sc);                            // ネイティブ=左攻め → team1(右)で反転

  function speedLines(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12); ctx.lineTo(x + Math.cos(an) * 48, y + Math.sin(an) * 48); ctx.stroke(); } }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;   // 焼き込みラベル停止（時刻/アクション名/選手名はHUD・ネーム枠へ集約）
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    // ミニスコア（色チップ＋略称＋スコア）はスコアボードへ集約のため非表示。時間(左上)とラベル/選手名は残す。
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = '#ffe14a'; ctx.fillText(label, 12, H - 9);
    if (passerName) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(passerName + (teamNm ? (' · ' + teamNm) : ''), W - 12, H - 10); }
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    var bx = foot[0] - ballSpd * Math.max(0, p - kickP);     // 蹴り足からフィールドと水平に（左へ）
    var onScreen = bx > -16;
    var ballGone = (p > kickP + 0.02) && !onScreen;          // 画面外に出た＝終了
    var z = 1.0 + Math.min(1, p / 0.7) * 0.08;
    ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.translate(foot[0], foot[1]); ctx.scale(z, z); ctx.translate(-foot[0], -foot[1]);
    ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    var sprImg;
    if (_pose.manga) {
      // ★未ロードでrenderすると空ベースがMangaRecolorのキャッシュを汚染する→ロード完了まで描かない（rAF継続）。
      sprImg = (_pose.img.complete && _pose.img.naturalWidth) ? (MangaRecolor.render(_pose.mkey, _pose.img, _pose.cols) || null) : null;
    } else {
      sprImg = _pose.rc ? (_recolorPostplay(_pose.img, accent, accent, _pose.rc) || _pose.img) : _pose.img;
    }
    var _snw = sprImg ? (sprImg.naturalWidth || sprImg.width) : 0, _snh = sprImg ? (sprImg.naturalHeight || sprImg.height) : 0;   // リカラー後はcanvas(naturalWidth無し)→width
    if (_snw) { var pw = _snw * (ph / _snh); ctx.save(); if (_pose.spriteFlip) { ctx.translate(pcx, 0); ctx.scale(-1, 1); ctx.translate(-pcx, 0); } ctx.drawImage(sprImg, pcx - pw / 2, ground - ph, pw, ph); ctx.restore(); }   // spriteFlip=pcx中心で反転しボール方向(左)へ向ける
    if (p < kickP) { _lpBall(ctx, foot[0], foot[1], 12, 0); }                                            // 蹴り足で待つ
    else if (onScreen) { _lpBall(ctx, bx, foot[1], 12, (p - kickP) * 80); }                              // 水平に蹴り出し→画面外で消える
    var strike = (p > kickP - 0.02 && p < kickP + 0.08) ? 1 - Math.abs(p - kickP) / 0.08 : 0;
    if (strike > 0) speedLines(foot[0], foot[1], strike * 0.6);
    ctx.restore();
    if (strike > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (strike * 0.45) + ')'; ctx.fillRect(0, 0, W, H); }
    hud();
    if (!ballGone && p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // パサーが pcx≈318（右1/3・0.66）。フリップ込みで主役を可視窓中央へ。
  return _csCenterSubject(canvas, pcx / W, flipH);
}

// ============================================================
// ワンツーパス（ショートパス成功）専用カットイン:
//   ①与える（A=パサー）→ ②壁役が返す（B）→ ③受け手が止める（A）の3カットを連結（ユーザー添付の3コマ準拠）。
//   選手は各カットで静止し、ボールだけが動く（①左へ蹴出し／②右へ返し／③左から足元へ寄り止まる）。
//   提供赤キットアート3枚を実行時に攻撃チーム色へリカラー。ネイティブ=左攻め（右→左）。team1（右攻め）は全体ミラー。
//   1回再生で静止。表示層のみ・エンジン非接触。
// ============================================================
var _ONETWO1_SRC = 'img/cutscenes/onetwo1_01.png';   // ①パサー（ファイルは右向き踏み込み）
var _ONETWO2_SRC = 'img/cutscenes/onetwo2_01.png';   // ②壁役・返し（ファイルは左向き）
var _ONETWO3_SRC = 'img/cutscenes/onetwo3_01.png';   // ③受け手（ファイルは右向きリーチ）
function _renderOnetwoScene(sc) {
  var W = 480, H = 216, ground = 190, zc = [240, 116];
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var img1 = _loadCutsceneImg(_ONETWO1_SRC), img2 = _loadCutsceneImg(_ONETWO2_SRC), img3 = _loadCutsceneImg(_ONETWO3_SRC);
  var atkColor = (sc.offence && sc.offence.team_color) || '#1f4fd6';

  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display');
  var passer = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var passerName = passer ? ((typeof getPlayerName === 'function') ? getPlayerName(passer) : passer.name) : '';
  var teamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = en ? 'ONE-TWO!' : 'ワンツー！';
  var accent = atkColor;

  var mirror = _csAttackRight(sc);   // ネイティブ=左攻め → team1（右攻め）で全体ミラー
  var c1 = 0.30, c2 = 0.58, P = 2200;   // 少しゆっくり（1.7→2.2秒）。③は受け止めの“溜め”を長めに

  function speedLines(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12); ctx.lineTo(x + Math.cos(an) * 50, y + Math.sin(an) * 50); ctx.stroke(); } }
  function drawSprF(img, cx, footY, h, flip) { if (!img) return; var nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height; if (!nw) return; var w = nw * (h / nh); ctx.save(); if (flip) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); } ctx.drawImage(img, cx - w / 2, footY - h, w, h); ctx.restore(); }
  // ★ CAM-01 は試したが不採用（2026-07-28 ユーザー判断「ワンツーは微妙」）＝静止カメラのまま。
  function withScene(draw) { ctx.save(); if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.imageSmoothingEnabled = false; draw(); ctx.restore(); }   // 静止カメラ（選手は動かさない）。ミラーのみ。
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;   // 焼き込みラベル停止（時刻/アクション名/選手名はHUD・ネーム枠へ集約）
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = '#ffe14a'; ctx.fillText(label, 12, H - 9);
    if (passerName) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(passerName + (teamNm ? (' · ' + teamNm) : ''), W - 12, H - 10); }
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    var spr1 = _recolorPostplay(img1, atkColor, atkColor, 'ot1') || img1;   // 赤キット→攻撃チーム色（肌・髪・スパイクは保持）
    var spr2 = _recolorPostplay(img2, atkColor, atkColor, 'ot2') || img2;
    var spr3 = _recolorPostplay(img3, atkColor, atkColor, 'ot3') || img3;

    var lp;
    if (p < c1) lp = p / c1;
    else if (p < c2) lp = (p - c1) / (c2 - c1);
    else lp = (p - c2) / (1 - c2);

    // ピッチ背景（静止カメラ）
    ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);

    if (p < c1) {
      // ① 与える: A は静止、ボールだけ左へ蹴り出す。onetwo1 はファイル本来の向き（右向き）のまま。
      var xA = 348, k = 0.15;
      withScene(function () {
        drawSprF(spr1, xA, ground, 172, false);
        var bx = (xA - 18) - 760 * Math.max(0, lp - k);
        if (bx > -16) _lpBall(ctx, bx, ground - 15, 12, (lp - k) * 60);
        if (lp > k - 0.04 && lp < k + 0.12) speedLines(xA - 18, ground - 15, (1 - Math.abs(lp - k) / 0.12) * 0.6);
      });
    } else if (p < c2) {
      // ② 返し: B は静止、ボールだけ右へワンタッチで返す。onetwo2 はファイル左向き → そのまま。
      var xB = 132, k2 = 0.15;
      withScene(function () {
        drawSprF(spr2, xB, ground, 172, false);
        var bx = (xB + 18) + 760 * Math.max(0, lp - k2);
        if (bx < W + 16) _lpBall(ctx, bx, ground - 15, 12, (lp - k2) * 60);
        if (lp > k2 - 0.04 && lp < k2 + 0.12) speedLines(xB + 18, ground - 15, (1 - Math.abs(lp - k2) / 0.12) * 0.7);
      });
    } else {
      // ③ 受け手: A は静止。左から来たボールが足元へ寄って止まる（ボールだけ動く）。onetwo3 はファイル本来の向き（右向き）のまま。
      var xR = 300, targetX = xR - 10, targetY = ground - 14;   // 停止位置をボール1個分(24px)足元へ寄せた（-34→-10）
      var u = Math.min(1, lp / 0.82), ue = 1 - (1 - u) * (1 - u);   // ease-out で足元へ減速し止まる
      var bx3 = -16 + (targetX + 16) * ue;
      withScene(function () {
        drawSprF(spr3, xR, ground, 172, false);
        _lpBall(ctx, bx3, targetY, 12, ue * 40);
        if (lp > 0.74 && lp < 0.92) speedLines(targetX, targetY, (1 - Math.abs(lp - 0.83) / 0.09) * 0.45);   // トラップの小バースト
      });
    }
    // カット間の白フラッシュ（テンポ）
    var flash = 0;
    if (Math.abs(p - c1) < 0.045) flash = Math.max(flash, 1 - Math.abs(p - c1) / 0.045);
    if (Math.abs(p - c2) < 0.045) flash = Math.max(flash, 1 - Math.abs(p - c2) / 0.045);
    if (flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (flash * 0.5) + ')'; ctx.fillRect(0, 0, W, H); }
    hud();
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // ワンツーは3カットで主役が左右に振れる（①giver xA=348 / ②wall xB=132 / ③receiver xR=300）。
  //   物語の主役＝give-and-go する A（①→③, 平均 ≈324）。可視窓(cover)の中央へ寄せて左右の見切れを防ぐ。
  //   mirror（team1=右攻めで全体反転）を flipH として渡す（②壁役は反対側に出るが、A中心で最も破綻が少ない）。
  return _csCenterSubject(canvas, 324 / W, mirror);
}

// ============================================================
// Scene Lab限定: クロス6コマ（GFX-06）。
//   採用済みキーポーズを一回だけ再生し、f5で足元のコードballへ接触、
//   f6でボールだけがクロス方向へ離れる。実試合のcross/longpass routingからは
//   呼ばず、_scene_lab.html が比較確認用に直接呼ぶ。
// ============================================================
var _LAB_CROSS6_FRAMES = [
  'img/cutscenes/manga_cross6/frame_01.png',
  'img/cutscenes/manga_cross6/frame_02.png',
  'img/cutscenes/manga_cross6/frame_03.png',
  'img/cutscenes/manga_cross6/frame_04.png',
  'img/cutscenes/manga_cross6/frame_05.png',
  'img/cutscenes/manga_cross6/frame_06.png'
];
function _renderCross6LabScene(sc) {
  if (typeof MangaRecolor === 'undefined' || !MangaRecolor.render) return null;
  var W = 480, H = 216, ground = 198;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var imgs = _LAB_CROSS6_FRAMES.map(function (src) { return _loadCutsceneImg(src); });
  var kicker = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var feat = _mangaFeat(kicker ? (kicker.long_name || kicker.name || '') : '');
  var cols = _mangaColors(sc.offence, feat.skin);
  var sig = cols.shirt + cols.shorts + cols.socks + cols.accent + cols.skin;

  // Lab review keeps the user-approved native screen-right pose. Directional
  // mirroring belongs to the later production-routing task, not this asset gate.
  var flipH = false;
  var frameDur = [95, 80, 80, 85, 100, 220];
  var leaveMs = frameDur[0] + frameDur[1] + frameDur[2] + frameDur[3] + frameDur[4];
  var totalMs = frameDur.reduce(function (sum, ms) { return sum + ms; }, 0);
  // Each trimmed frame has a different width. Pin the measured hip joint, then
  // reproduce the reference approach: advance strongly into contact and ease
  // the forward travel during the follow-through.
  var tuning = { stageShiftX: -28, zoomEndScale: 0.94, zoomDurationMs: 140 };
  var ph = 190, scale = ph / 336;
  var hipSrc = [[125,170], [132,174], [158,176], [170,168], [96,176], [107,166]];
  var hipScreenX = [182, 198, 218, 239, 253, 260].map(function (x) { return x + tuning.stageShiftX; });
  var hipScreenY = 106;
  var rightBoot5 = [190, 304];
  var bootContactX = hipScreenX[4] + (rightBoot5[0] - hipSrc[4][0]) * scale;
  var bootContactY = hipScreenY + (rightBoot5[1] - hipSrc[4][1]) * scale;
  var ballRadius = 12;
  // Keep the ball's left edge at the boot instead of overlapping its center.
  var ballRestX = bootContactX + ballRadius;
  var ballCarryOffsetX = ballRestX - hipScreenX[4];
  var ballCarryStartX = hipScreenX[0] + ballCarryOffsetX;
  var ballVelocityX = 780, ballVelocityY = 380;

  function burst(x, y, a) {
    ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5;
    for (var i = 0; i < 12; i++) {
      var an = i / 12 * 6.28;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 9, y + Math.sin(an) * 9);
      ctx.lineTo(x + Math.cos(an) * 37, y + Math.sin(an) * 37); ctx.stroke();
    }
  }

  var T0 = null, loadT0 = null, started = false;
  var loadTimeoutMs = 5000;

  function drawLoadState(message, isError) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#081729'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = isError ? '#ff6b6b' : '#56c7ff'; ctx.lineWidth = 2;
    ctx.strokeRect(22, 22, W - 44, H - 44);
    ctx.fillStyle = '#f5f7fb'; ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(message, W / 2, H / 2);
  }

  function frame() {
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (canvas.isConnected) {
      started = true;
      if (loadT0 === null) loadT0 = now;
    } else {
      if (started) return;
      requestAnimationFrame(frame); return;
    }

    var broken = imgs.some(function (img) { return img.complete && !img.naturalWidth; });
    var loaded = imgs.every(function (img) { return img.complete && img.naturalWidth; });
    if (broken || (!loaded && now - loadT0 >= loadTimeoutMs)) {
      canvas.dataset.cross6State = 'error';
      drawLoadState('CROSS 6 ASSET ERROR', true);
      return;
    }
    if (!loaded) {
      canvas.dataset.cross6State = 'loading';
      drawLoadState('LOADING CROSS 6...', false);
      requestAnimationFrame(frame); return;
    }
    if (T0 === null) {
      T0 = now;
      canvas.dataset.cross6State = 'playing';
    }
    var elapsed = Math.min(totalMs, now - T0);
    var fi = 0, acc = 0;
    for (var k = 0; k < frameDur.length; k++) {
      acc += frameDur[k];
      if (elapsed < acc) { fi = k; break; }
      fi = frameDur.length - 1;
    }
    var segmentStart = acc - frameDur[fi];
    var travelT = fi < hipScreenX.length - 1
      ? Math.max(0, Math.min(1, (elapsed - segmentStart) / frameDur[fi]))
      : 0;
    var currentHipX = fi < hipScreenX.length - 1
      ? hipScreenX[fi] + (hipScreenX[fi + 1] - hipScreenX[fi]) * travelT
      : hipScreenX[fi];

    var zoomT = Math.max(0, Math.min(1, (elapsed - leaveMs) / tuning.zoomDurationMs));
    var zoomEase = 1 - Math.pow(1 - zoomT, 3);
    var sceneScale = 1 - (1 - tuning.zoomEndScale) * zoomEase;

    ctx.clearRect(0, 0, W, H);
    // The zoom-out exposes a narrow frame; keep it on the established dark Lab base.
    ctx.fillStyle = '#081729'; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(sceneScale, sceneScale); ctx.translate(-W / 2, -H / 2);
    _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    ctx.save();
    if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    var im = imgs[fi], spr = null;
    if (im && im.complete && im.naturalWidth) {
      var key = 'lab-cross6|' + (fi + 1) + '|' + sig;
      spr = MangaRecolor.render(key, im, cols);
      if (spr) {
        var dw = spr.width * scale, dh = spr.height * scale;
        var pix = _csPixelate(spr, key, dw, ph);
        var dx = currentHipX - hipSrc[fi][0] * scale;
        var dy = hipScreenY - hipSrc[fi][1] * scale;
        ctx.drawImage(pix, dx, dy, dw, dh);
      }
    }

    // f1–f4: carry the ball by exactly the player's approach distance. At f5 it
    // reaches the shifted boot contact, then f6 launches from that same origin.
    var carryHipX = Math.min(currentHipX, hipScreenX[4]);
    var bx = carryHipX + ballCarryOffsetX, by = bootContactY;
    var rot = (bx - ballCarryStartX) / ballRadius;
    if (elapsed >= leaveMs) {
      var dt = (elapsed - leaveMs) / 1000;
      bx = ballRestX + ballVelocityX * dt; by -= ballVelocityY * dt;
      rot = (ballRestX - ballCarryStartX) / ballRadius + dt * 70;
    }
    if (bx < W + 24 && by > -24) _lpBall(ctx, bx, by, ballRadius, rot);
    var impact = Math.max(0, 1 - Math.abs(elapsed - (leaveMs - 55)) / 75);
    if (impact > 0) burst(bootContactX, bootContactY, impact * 0.75);
    ctx.restore();
    if (impact > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (impact * 0.32) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    if (elapsed < totalMs) requestAnimationFrame(frame);
    else canvas.dataset.cross6State = 'done';
  }
  requestAnimationFrame(frame);
  // Shifted rightBoot5 maps to roughly (278,178); the 12px-radius ball rests just beyond it.
  return _csCenterSubject(canvas, 0.50, false);
}

// ============================================================
// フリーキック（中央の直接FK・action='フリーキック'）専用カットイン:
//   ①蹴る前（freekick1）→ ②蹴った瞬間（freekick2）＋ボールが足元から弧を描いて上方（攻撃方向＝ゴール）へ伸びる の2フレーム。
//   提供赤キットアート2枚を実行時に攻撃チーム色へリカラー。ネイティブ=左攻め（ボールは左上へ）。team1は全体ミラー。
//   FKの「蹴り」=この場面。結果（ゴール/枠外/セーブ）はゴール分割時の後続ビート、枠外/セーブ(非分割)はテキストで提示。表示層のみ・エンジン非接触。
// ============================================================
var _FREEKICK1_SRC = 'img/cutscenes/freekick1_01.png';   // ①蹴る前（左向き・振りかぶり）
var _FREEKICK2_SRC = 'img/cutscenes/freekick2_01.png';   // ②蹴った瞬間（左向き・振り抜き）
function _renderFreekickScene(sc) {
  var W = 480, H = 216, ground = 190;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var img1 = _loadCutsceneImg(_FREEKICK1_SRC), img2 = _loadCutsceneImg(_FREEKICK2_SRC);
  var atkColor = (sc.offence && sc.offence.team_color) || '#1f4fd6';

  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display');
  var kicker = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var kickerName = kicker ? ((typeof getPlayerName === 'function') ? getPlayerName(kicker) : kicker.name) : '';
  var teamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  // オープンプレーのクロス(scenario==='クロス')に流用された蹴り出しビートは「クロス！」表示。
  //   セットプレー/中央の直接FK(scenario!=='クロス')は従来どおり「フリーキック！」。
  var label = (sc.scenario === 'クロス') ? (en ? 'CROSS!' : 'クロス！') : (en ? 'FREE KICK!' : 'フリーキック！');
  var accent = atkColor;

  var mirror = _csAttackRight(sc);   // ネイティブ=左攻め（ボールは左上＝ゴール方向）→ team1 で全体ミラー
  // クロス流用時は FK よりさらにテンポを早く＝振りかぶり(freekick1)を短くしてすぐ「蹴った後」(freekick2)へ移行。
  var sw = (sc.scenario === 'クロス') ? 0.12 : 0.28, P = 1800;   // freekick1(蹴る前)→freekick2(蹴った瞬間)の切替点
  // 新FKアート(freekick1=333×360 蹴る前/腕広げ・freekick2=200×360 蹴った瞬間/縦長)。両フレームで
  //   胴の重心x比率が違う(fk1 軸足≈native223=0.67 / fk2 軸足≈native101=0.505)ため、軸足(プラント)が
  //   画面同一点に来るよう別センターで描く（フレーム切替時のガタつき防止）。native360→scale≈0.506。
  var kh = 182;                      // キッカー身長
  var plantX = 300;                  // 軸足の画面x（両フレーム共通アンカー）
  var kx1 = 271, kx2 = 300;          // fk1/fk2 の描画中心x。軸足native(223/101)を plantX=300 に合わせた実測値
  var kx = plantX;                   // 被写体センタリング代表値（_csCenterSubject 用）
  // ボール起点＝蹴り足の接点。★シーン座標は「ネイティブ=左攻め」＝bx0を増やすとゴールから遠ざかる(＝ミラー表示の画面では左へ)。
  //   ラボ/実試合の既定は mirror=true(_csAttackRight は gameState 未設定で true)なので、画面の左右はシーン座標と反転する。
  var bx0 = 320, by0 = ground - 8;   // 2026-07-17 ユーザー指示で 280→310→320（画面上で計40px左＝ゴールから40px遠ざける）
  var vx = 2380, vy = 880;           // シュートと同等速度（≈1.4px/ms）・浅い左上へ直進（slope≈0.37）
  // 新FK素材=分離配色RGBA(shirt青/shorts緑/socksマゼンタ/accentシアン+肌)→MangaRecolorで4スロット別々に置換。
  //   旧_recolorPostplay(赤1色染め)は緑短パンを守備色に誤変換し青シャツを塗り残すため廃止（2026-07-17）。
  var _fkManga = (typeof MangaRecolor !== 'undefined' && MangaRecolor.render);
  var _fkFeat  = _fkManga ? _mangaFeat(kicker ? (kicker.long_name || kicker.name || '') : '') : null;
  var _fkCols  = _fkManga ? _mangaColors(sc.offence, _fkFeat.skin) : null;
  var _fkSig   = _fkCols ? (_fkCols.shirt + _fkCols.shorts + _fkCols.socks + _fkCols.accent + _fkCols.skin) : '';
  var _fk1Key  = _fkManga ? ('fk1|' + _fkSig) : null, _fk2Key = _fkManga ? ('fk2|' + _fkSig) : null;

  function speedLines(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12); ctx.lineTo(x + Math.cos(an) * 50, y + Math.sin(an) * 50); ctx.stroke(); } }
  function drawSprF(img, cx, footY, h, flip) { if (!img) return; var nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height; if (!nw) return; var w = nw * (h / nh); ctx.save(); if (flip) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); } ctx.drawImage(img, cx - w / 2, footY - h, w, h); ctx.restore(); }
  function withScene(draw) { ctx.save(); if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.imageSmoothingEnabled = false; draw(); ctx.restore(); }   // 静止カメラ・ミラーのみ
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;   // 焼き込みラベル停止（時刻/アクション名/選手名はHUD・ネーム枠へ集約）
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = '#ffe14a'; ctx.fillText(label, 12, H - 9);
    if (kickerName) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(kickerName + (teamNm ? (' · ' + teamNm) : ''), W - 12, H - 10); }
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    // 新FKアートは分離配色→MangaRecolorで{shirt/shorts/socks/accent}+肌を別々に置換→_csPixelateで仕上げ。
    //   MangaRecolor 未ロード(公開ビルド)はネイティブ素材をそのまま描画（旧_recolorPostplayは新ベースで色が壊れるため使わない）。
    var spr1 = (img1.complete && img1.naturalWidth) ? (_fkManga ? MangaRecolor.render(_fk1Key, img1, _fkCols) : img1) : null;
    if (spr1 && _fkManga) spr1 = _csPixelate(spr1, _fk1Key, spr1.width * (kh / spr1.height), kh);
    var spr2 = (img2.complete && img2.naturalWidth) ? (_fkManga ? MangaRecolor.render(_fk2Key, img2, _fkCols) : img2) : null;
    if (spr2 && _fkManga) spr2 = _csPixelate(spr2, _fk2Key, spr2.width * (kh / spr2.height), kh);
    ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);

    var contact = 0;
    if (p < sw) {
      // ① 蹴る前: 振りかぶり。ボールは足元で静止。
      withScene(function () {
        drawSprF(spr1, kx1, ground, kh, false);   // freekick1 は左向き＝ネイティブのまま。軸足を plantX へ合わせた kx1
        _lpBall(ctx, bx0, by0, 12, 0);
      });
    } else {
      // ② 蹴った瞬間: 振り抜き。ボールは右下の起点からシュート速度で浅く左上（ゴール方向）へ直進。
      var dt = p - sw;                                  // p単位の経過（ballSpd×dt＝シュートと同じ速度感）
      var bx = bx0 - vx * dt;
      var by = by0 - vy * dt;                           // 浅い角度で左上へ（直進・弧なし）
      contact = (dt < 0.06) ? (1 - dt / 0.06) : 0;
      withScene(function () {
        drawSprF(spr2, kx2, ground, kh, false);   // 軸足を plantX へ合わせた kx2
        if (bx > -20 && by > -20) _lpBall(ctx, bx, by, 12, dt * 120);
        if (contact > 0) speedLines(bx0, by0, contact * 0.8);
      });
    }
    if (contact > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (contact * 0.5) + ')'; ctx.fillRect(0, 0, W, H); }   // インパクトのフラッシュ
    hud();
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // キッカー軸足 plantX=300（0.625）。mirror 込みで主役を可視窓中央へ。
  return _csCenterSubject(canvas, kx / W, mirror);
}

// ============================================================
// 蹴り出し（クロスを上げる）: 中央の直接FKと同じ蹴りシーン（_renderFreekickScene）を流用する。
//   サイドFK（セットプレー）と オープンプレーのクロス（scenario==='クロス'）の両方で使う共通の「上げる」ビート。
//   ※ユーザー要望でロフトクロス専用絵を廃し、中央FKと同一の蹴り絵に統一。
//   キッカー＝crossPos（クロスを上げる選手）の名前で出すため ofsPos を差し替えて委譲。
//   この後ビートで _renderHeaderScene/_renderVolleyScene の競り合いへ繋がる（_shootSplit が セットプレー/クロス を2ビート化）。
// ============================================================
function _renderFkDeliveryScene(sc) {
  if (sc && sc.crossPos != null && sc.crossPos !== sc.ofsPos) {
    var fkSc = {}; for (var k in sc) { if (Object.prototype.hasOwnProperty.call(sc, k)) fkSc[k] = sc[k]; }
    fkSc.ofsPos = sc.crossPos;   // 蹴り出しのキッカー名＝クロス選手
    return _renderFreekickScene(fkSc);
  }
  return _renderFreekickScene(sc);
}

// ============================================================
// ドリブル突破: 緑ドリブラー(→攻撃色)＋赤守備(→守備色)を実行時recolor＋コードのボール。
//   成功=ドリブラー＋ボールが前進(ネイティブ右)／失敗=ドリブラー静止・守備がスライドしてボールが弾かれる。
//   ネイティブ=右攻め(スプライトは右向き) → team2(左)で水平反転。1回再生で静止。
// ============================================================
// ============================================================
// 漫画ドリブルカットイン（lab限定・2026-07-07 配線）
//   量産スプライト(img/cutscenes/manga/{beard}_{hair}.png・4髭×12髪=48)を
//   選手identity(Portrait.featuresFor 流用＝ポートレート頭と髪/髭/肌が一致)で選び、
//   MangaRecolor でチームキット{shirt,shorts,socks,accent}＋選手肌色へ実行時置換。
//   ソロヒーロー構図（漫画的な一コマ＝主役1体＋躍動背景＋ボール＋集中線）。
//   ★共有ファイルなので MangaRecolor 未ロードの本番では発火せず、従来の
//     _renderDribbleScene(緑/赤フラットスプライト)へフォールバックする。
// ============================================================
var _MANGA_DRIB_ENABLED = true;
// Portrait.HAIRSTYLE / BEARD / SKIN と同順（index一致が前提）。スプライト名の語彙。
var _MANGA_HSTYLE = ['short', 'fade', 'skin', 'spike', 'curly', 'part', 'bangs', 'afro', 'slick', 'wavy', 'mohawk', 'bowl'];
// カット！シーンのスプライトは10髪型で量産（1体1画像＝見切れ防止・2026-07-09）。bangs/bowlは未生成のため
// 近縁の生成済み髪型へエイリアス。%12の割当ハッシュ・他画面（Portrait頭）の12髪型はそのまま維持。
var _MANGA_HSTYLE_SPRITE_ALIAS = { bangs: 'short', bowl: 'skin' };
// 過渡期の単一髪型モード（2026-07-09）: 髪型バリエーション生成が律速なので、残りのカットシーン差し替えを
// 先行するため全シーン・全選手を1髪型に固定する。これで各シーン役ごと1枚だけ生成すればよい。
// 副次効果: dribble等の既存多髪型シーンも同じ髪型に寄り、シーン間の選手同一性が保たれる（別人化を防ぐ）。
// バリエーション解禁時は null にするだけで各選手が決定論の髪型へ復帰（追加作業ゼロ・完全可逆）。
// 2026-07-15: 新シュート正典（茶スパイク＋アンダーカット）を wavy スロットへ受入 → 統一髪型を wavy へ。
//   まず全シーンを wavy で揃え、以降 残り9髪型のシュート絵を順次差し替える方針（他セットの wavy.png は旧絵のまま＝要順次差し替え）。
var _MANGA_HAIR_UNIFORM = 'wavy';
var _MANGA_BEARD = ['none', 'stubble', 'mustache', 'goatee', 'full'];   // stubbleはスプライト未生成→noneで代替
var _MANGA_SKIN = ['#ffdcbb', '#f4c79b', '#e6ad7f', '#cf8f5d', '#a06a3f', '#6f492c'];
function _mangaFnv(str) { var h = 0x811c9dc5; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return h >>> 0; }
function _mangaFeat(longName) {
  var n = longName == null ? '' : String(longName);
  // 決定論割当：ポートレート頭と髪/髭/肌を揃えるため Portrait.featuresFor のindexを流用。未ロード時は同式で自前算出。
  var f = (typeof Portrait !== 'undefined' && Portrait.featuresFor) ? Portrait.featuresFor(n) : null;
  var hi = f ? f.hstyle : _mangaFnv('hstyle ' + n) % 12;
  var bi = f ? f.beard : _mangaFnv('beard ' + n) % 5;
  var si = f ? f.skin : _mangaFnv('skin ' + n) % 6;
  var beard = _MANGA_BEARD[bi] || 'none'; if (beard === 'stubble') beard = 'none';
  var hstyle = _MANGA_HSTYLE[hi] || 'short';
  if (_MANGA_HAIR_UNIFORM) hstyle = _MANGA_HAIR_UNIFORM;                    // 過渡期＝全選手1髪型に固定
  else hstyle = _MANGA_HSTYLE_SPRITE_ALIAS[hstyle] || hstyle;              // 10髪型スプライトへリマップ（bangs→short / bowl→skin）
  return { hstyle: hstyle, beard: beard, skin: _MANGA_SKIN[si] || '#e6ad7f' };
}
// カット！（ドリブル失敗）の攻撃側スプライト置き場。
//   専用「走り」ポーズ12髪型（ユーザー生成2×2グリッド×3・2026-07-08受入）。252×343・ネイティブ右向き。
var MANGA_DRIBBLE_FAIL_DIR = 'img/cutscenes/manga_dribble_fail/';
// ============================================================
// タックル5コマ（sprite-studio tackle_f・2026-08-05 納品／ドリブルシーンの守備側）:
//   f1=踏み込み f2=助走 f3〜f5=スライド（f5=決着ポーズ）。全コマ共通枠 251×230 で切り出し済み＝
//   コマ間の位置関係が保たれるので、後からアニメ再生へ拡張できる。ネイティブ=伸ばした足が左
//   （旧 manga_tackle_slide と同じ向き＝反転条件 !atkRight をそのまま流用できる）。
//   ★旧素材との差: 髪型12種の差し替えが無い単一ヘッド（heading6 と同じ新パイプライン方式）。
//   現状はドリブルシーンで **決着コマ(f5)を静止1枚として使用**（旧スライダーと同じ使い方）。
// ============================================================
var _TK6_DIR = 'img/cutscenes/manga_tackle6/';
var _TK6_LAST = 5;                 // 決着（スライド伸び切り）のコマ番号
var _TK6_BOXW = 251, _TK6_BOXH = 230;
var _TK6_FOOT = 225;               // 決着コマの接地y（枠内実測）。枠下端との差5pxを描画時に足元へ効かせる
var _TK6_DEFW = 175;               // 画面上の描画幅＝旧スライダーの実効幅(174.5px)と同等
var _TK6_FOOTADJ = (_TK6_BOXH - _TK6_FOOT) * (_TK6_DEFW / _TK6_BOXW);   // ≒3.5px
function _mangaColors(td, skin) {
  var kit = (typeof MangaRecolor !== 'undefined' && MangaRecolor.kitFor) ? MangaRecolor.kitFor(td) : { shirt: '#2060d0', shorts: '#1f9d3a', socks: '#cc2f9a', accent: '#24c2d0' };
  return { shirt: kit.shirt, shorts: kit.shorts, socks: kit.socks, accent: kit.accent, skin: skin };
}
function _renderMangaDribbleScene(sc) {
  if (typeof MangaRecolor === 'undefined' || !MangaRecolor.render) return null;   // 本番=未ロード→従来へ
  var dribP = sc && sc.offence && sc.offence.players && sc.offence.lineup && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  if (!dribP) return null;
  var longName = dribP.long_name || dribP.name || '';
  var feat = _mangaFeat(longName);
  var success = (sc.result === '成功');
  var spriteId = feat.hstyle;                                          // 髭なし単体方式（新ドリブル体・2026-07-07）。髪型12種＝1体ずつ生成→正規化
  // 攻撃側: 成功=ドリブル体 / 失敗=ボールを運ぶ走り（当面プレースホルダ＝同じドリブル体。MANGA_DRIBBLE_FAIL_DIR 参照）
  var img = _loadCutsceneImg((success ? 'img/cutscenes/manga_dribble/' : MANGA_DRIBBLE_FAIL_DIR) + spriteId + '.png');
  var colors = _mangaColors(sc.offence, feat.skin);
  var colorKey = (success ? 'db_' : 'dbf_') + spriteId + '|' + colors.shirt + colors.shorts + colors.socks + colors.accent + colors.skin;
  // 守備（デュエル相手）: identity/キットは守備選手・守備チームで独立リカラー。
  //   成功: manga_tackle/（旧ドリブルセット=追走ポーズ・ドリブラーの後ろ側から止めに来る。2026-07-08構図確定）
  //   失敗: manga_tackle_slide/（スライディングタックル 233×161・ネイティブ左向き。2026-07-08受入PASS）
  var defP = sc.defence && sc.defence.players && sc.defence.lineup && sc.defence.players[sc.defence.lineup[sc.dfsPos]];
  var defFeat = defP ? _mangaFeat(defP.long_name || defP.name || '') : null;
  // 2026-08-05: 守備スライダーを新タックル素材(manga_tackle6 の決着コマ)へ差し替え（成功/失敗とも共通）。
  //   旧 manga_tackle_slide（髪型12種）は不使用。キー接頭辞も 'tk6_' へ＝旧ベースキャッシュを引かない。
  var defImg = defFeat ? _loadCutsceneImg(_TK6_DIR + 'f' + _TK6_LAST + '.png?v=1') : null;
  var defColors = defFeat ? _mangaColors(sc.defence, defFeat.skin) : null;
  var defColorKey = defFeat ? ('tk6_' + _TK6_LAST + '|' + defColors.shirt + defColors.shorts + defColors.socks + defColors.accent + defColors.skin) : null;

  var W = 480, H = 216, ground = 196;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var atkRight = _csAttackRight(sc);           // 攻撃方向。true=右へ攻める
  var dir = atkRight ? 1 : -1;                 // ボール/前進の向き
  // flipSpr は攻守共通で成立する:
  //   攻撃体(manga_dribble)=ネイティブ右向き → 攻撃方向が左(dir=-1)のとき反転。
  //   スライダー(manga_tackle_slide)=ネイティブ左向き（伸ばした足が左）だが、攻撃者の前方から
  //   向かい合って滑り込む＝画面上は攻撃方向の逆を向く → 反転条件は攻撃体と同じ !atkRight。
  var flipSpr = !atkRight;

  var atkColor = (sc.offence && sc.offence.team_color) || colors.shirt;
  var defColor = (sc.defence && sc.defence.team_color) || '#e36b1f';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = success ? (en ? 'BREAK!' : 'ドリブル突破！') : (en ? 'TACKLED!' : 'カット！');
  var labelCol = success ? '#ffe14a' : '#ff5a3c';
  var accent = success ? atkColor : defColor;
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var dribName = (typeof getPlayerName === 'function') ? getPlayerName(dribP) : (dribP.name || '');
  var atkTeamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var defName = defP ? ((typeof getPlayerName === 'function') ? getPlayerName(defP) : (defP.name || '')) : '';
  var defTeamNm = (typeof getTeamName === 'function' && sc.defence) ? getTeamName(sc.defence) : '';

  // 体スケール: canvas縦横比が違うため描画幅で体格を個別調整。
  //   成功守備(追走・縦長250×453)=104 / 失敗守備(スライディング・横長233×161)=176（横長なので幅は大きめ＝体格は同等に見える。2026-07-09 守備を少し大きく＝攻撃者とのバランス調整）。
  var bodyWDrib = 120, bodyWDef = _TK6_DEFW;   // 守備=新タックル決着コマ。旧スライダー(176)と同じ実効幅になるよう _TK6_DEFW で指定
  var defFootY = ground + _TK6_FOOTADJ;        // 枠下端と接地線のズレ(5px)を補正＝足が地面から浮かない
  var heroX0 = success ? (W * 0.5 - dir * 46) : (W * 0.5 - dir * 47);   // 成功=両選手を中央寄せ(-6→-46・2026-07-09) / 失敗=静止構図のデュエル中心を画面中央に
  var P = success ? 460 : 820;   // 成功=460（ドリブラー移動速度）。失敗=820（スライドイン＋ボール離脱＋よろけ揺れが尺内に収まる長さ・成功側は不変）

  // 描画幅を指定して描く（高さはスプライトの縦横比から算出）。
  function drawSprite(imgRef, key, cols, cx, footY, targetW) {
    if (!imgRef || !imgRef.complete || !imgRef.naturalWidth) return;   // ★未ロードでrenderすると空ベースがキャッシュ汚染される→ロード完了まで描かない
    var spr = MangaRecolor.render(key, imgRef, cols);
    if (!spr) return;
    var nw = spr.width, nh = spr.height, hgt = targetW * (nh / nw);
    ctx.save();
    if (flipSpr) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spr, cx - targetW / 2, footY - hgt, targetW, hgt);
    ctx.restore();
  }
  function drawHero(cx, footY) { drawSprite(img, colorKey, colors, cx, footY, bodyWDrib); }
  /* CAM-01: カットアウトの二次モーション付きヒーロー。lean=進行方向への前傾／squash=踏み込みの潰し。
   *   ★ 足元(cx, footY)を軸にする＝地面から足が浮かない。 */
  function drawHeroP(cx, footY, lean, squash) {
    _csCam.puppet(ctx, cx, footY, lean, squash, function () { drawHero(cx, footY); });
  }
  function speedLines(x, y, a, spread) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12); ctx.lineTo(x + Math.cos(an) * (spread || 52), y + Math.sin(an) * (spread || 52)); ctx.stroke(); } }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    var timeTxt = dom('game-time-display'); if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = labelCol; ctx.fillText(label, 12, H - 9);
    // 成功=突破したドリブラー名 / 失敗=止めた守備選手名（✕付き・従来ドリブルシーンの流儀）
    var nm = success ? (dribName ? (dribName + (atkTeamNm ? (' · ' + atkTeamNm) : '')) : '')
                     : (defName ? ('✕ ' + defName + (defTeamNm ? (' · ' + defTeamNm) : '')) : '');
    if (nm) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(nm, W - 12, H - 10); }
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);

    /* CAM-01: レイヤー深度つきカメラ。背景=0.34（ほぼ止まる）／守備=0.9／攻撃=1.0／ボール=1.06。
     *   ★ カメラは主役を lag=0.62 で追う＝画面内でも主役は動き続ける（100%追うと止まって見える）。 */
    var cam = _csCam.mk({ fx: W * 0.5, fy: ground - 52 });
    var camOn = (typeof CS_CAM_ENABLED === 'undefined') || CS_CAM_ENABLED;
    var DBG = camOn ? 0.34 : 1, DDEF = camOn ? 0.90 : 1, DBALL = camOn ? 1.06 : 1;

    if (success) {
      // 成功（突破）: 起点=添付ラフの密着デュエル（守備が左肩後ろに深く重なる）を一拍見せる→ドリブラーが前へ抜け出す。
      var t = Math.max(0, (p - 0.08) / 0.92), u = t * t * (3 - 2 * t);   // ほぼ溜めなし→即バーストで抜け出し
      var heroX = heroX0 + dir * 110 * u;              // ドリブラー＝攻撃方向へ前進（守備を置き去り・移動量を長く 74→110）
      var defX = heroX0 + dir * 50;                     // 守備＝静止。中心がドリブラーを50px越える（更に深く＝守備は前方寄りに回り込み、大部分がドリブラーの陰に）
      var ballX = heroX + dir * 46;                     // ボールは前足の先
      var ballY = ground - 30;

      if (camOn) {
        // 抜け出しに合わせて寄る＝「今ここを見ろ」。寄りは控えめ（1.00→1.12）＝低解像度で潰さない。
        cam.zoom = 1 + 0.12 * _csCam.smooth(_csCam.clamp01((p - 0.05) / 0.55));
        _csCam.follow(cam, heroX, heroX0 + dir * 34, 0.62);
        _csCam.shake(cam, (p - 0.08) * P, 200, 2.4);    // バースト開始の一瞬だけ
      }

      _csCam.begin(ctx, cam, DBG);
      ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);
      _csCam.end(ctx);

      if (defImg) { _csCam.begin(ctx, cam, DDEF); drawSprite(defImg, defColorKey, defColors, defX, defFootY, bodyWDef); _csCam.end(ctx); }  // 守備＝静止・先描き（ドリブラーの後ろに深く重なる）
      _csCam.begin(ctx, cam, 1);
      // 二次モーション: バーストで進行方向へ前傾し、抜け切って減速するにつれ起き上がる。
      //   踏み込みの一瞬だけ潰す（squash）＝重心の乗りが出る。手足は描き直していない。
      var burst = _csCam.clamp01((p - 0.06) / 0.30), settle = _csCam.clamp01((p - 0.45) / 0.55);
      var lean = camOn ? dir * (0.085 * burst * (1 - settle * 0.75)) : 0;
      var squash = camOn ? 1 - 0.05 * Math.sin(_csCam.clamp01((p - 0.06) / 0.22) * Math.PI) : 1;
      drawHeroP(heroX, ground, lean, squash);           // 集中線（ピカッ）は不要のため削除（2026-07-09）
      _csCam.end(ctx);
      if (ballX > -20 && ballX < W + 20) { _csCam.begin(ctx, cam, DBALL); _lpBall(ctx, ballX, ballY, 12, p * 15 * dir); _csCam.end(ctx); }
    } else {
      // 失敗（カット！）: 従来の静止構図を「最終静止状態」とし、そこへ至る短いシーケンス（2026-07-09 ユーザー要望）。
      //   静止構図: 守備スライダー=heroX0+dir*64（奥z・先描き）/ 攻撃者=heroX0（手前z・後描き）。
      //   （守備を攻撃者側へ30px寄せ・z反転で守備の手が攻撃者の背後になるよう調整。2026-07-09微調整）
      //   座標は全て攻撃方向 dir 基準（dir=±1どちらでも「前方から守備が滑り込む・ボールは前方へ弾かれ消える」が成立）。
      var defXf = heroX0 + dir * 64;
      // ① 守備スライドイン: 開始 defXf+dir*38（攻撃者から見て少し前方）→ defXf。最初の18%で ease-out 着地＝かなり速く。
      var slT = Math.min(1, p / 0.18), slU = 1 - (1 - slT) * (1 - slT);
      var defX = defXf + dir * 38 * (1 - slU);
      // ② 攻撃者のよろけ: 着地(p>0.22)後から減衰sin（±2px・1周期＝左右1回）→ p=1で0＝静止構図へ収束。
      var wq = Math.max(0, Math.min(1, (p - 0.22) / 0.78));
      var heroXf = heroX0 + 2 * (1 - wq) * Math.sin(wq * Math.PI * 2);     // π*2 = 2π ＝ 1周期（左右1回だけ揺れる）

      if (camOn) {
        // 潰された側の絵＝寄って止める。スライド着地(p≒0.18)の一瞬だけ強く揺らす。
        cam.zoom = 1 + 0.10 * _csCam.smooth(_csCam.clamp01(p / 0.35));
        cam.panX = -dir * 10 * _csCam.smooth(_csCam.clamp01(p / 0.35));
        _csCam.shake(cam, (p - 0.16) * P, 260, 4.0);
      }
      _csCam.begin(ctx, cam, DBG);
      ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);
      _csCam.end(ctx);

      if (defImg) { _csCam.begin(ctx, cam, DDEF); drawSprite(defImg, defColorKey, defColors, defX, defFootY, bodyWDef); _csCam.end(ctx); }   // スライダー＝奥z（先描き）
      _csCam.begin(ctx, cam, 1);
      // 二次モーション: 止められた側は進行方向と逆へ仰け反る（つんのめり）→ 収束して静止構図へ。
      var kick = _csCam.clamp01((p - 0.16) / 0.16) * (1 - _csCam.clamp01((p - 0.32) / 0.5));
      drawHeroP(heroXf, ground, camOn ? -dir * 0.075 * kick : 0, camOn ? 1 - 0.035 * kick : 1);   // 攻撃者＝手前z（後描き・守備の手を背後に隠す）
      _csCam.end(ctx);
      // 着地インパクトの集中線（控えめ・短く）＝守備の伸ばした足元(defX - dir*64)。
      var impF = (p > 0.10 && p < 0.24) ? 1 - Math.abs(p - 0.17) / 0.07 : 0;
      if (impF > 0) { _csCam.begin(ctx, cam, 1); speedLines(defX - dir * 64, ground - 10, impF * 0.4, 34); _csCam.end(ctx); }
      // ボール: 前足(heroX0+dir*30)から着地とほぼ同時に -dir へ高速離脱→画面外(-dir側)で消える。
      var bStart = 0.14, ballX = (p < bStart) ? (heroX0 + dir * 30) : (heroX0 + dir * 30 - dir * 1600 * (p - bStart));
      if (ballX > -16 && ballX < W + 16) { _csCam.begin(ctx, cam, DBALL); _lpBall(ctx, ballX, ground - 14, 11, (p < bStart) ? 0 : (-dir * (p - bStart) * 80)); _csCam.end(ctx); }
    }
    hud();
    if (p < 1 || !img.complete || (defImg && !defImg.complete)) requestAnimationFrame(frame);   // 画像ロードが遅れても完了後に必ず両者を描き切る
  }
  requestAnimationFrame(frame);
  // 成功=概ね中央 / 失敗=静止構図のデュエル中心を画面中央に配置済（heroX0の後ろ寄せで調整）。screen座標で算出済＝flip無し扱い。
  return _csCenterSubject(canvas, 0.5, false);
}

// ============================================================
// ドリブル「新シーン」= 2コマ走り（テスト実装 2026-07-27・ユーザー提供アート）
//   2拍構成: 拍1=溜め(_D2_HOLD・1コマ目が主役) → 拍2=決着(_D2_CUT・短く抜き去る) → 2コマ目で固定。
//   ループはしない（2026-07-27 指示）。
//   素材: img/cutscenes/manga_dribble2/f1..f2.png（191×179・接地線y=173・ネイティブ右向き）。
//   従来の成功ドリブル（静止1枚の manga_dribble）を、走りループするドリブラーへ差し替える。
//   構図・尺・守備（スライダー）・HUD は _renderMangaDribbleScene の成功側をそのまま踏襲＝
//   「主役のアートとアニメだけ」を入れ替えた比較になるようにしてある。
//   失敗（カット！）は当アートに該当ポーズが無いので null を返し、従来シーンへフォールバックする。
//
//   素材の正規化（sprite-studio tools/frames_norm.py --scale 0.20）:
//     2コマは前傾角が違うため slice_anim の胴長(縦)正規化だと深い前傾のコマが15%拡大されて破綻する。
//     面積(0.6%差)・頭→腰(5.6%差)・立位換算がいずれも一致＝素材は既に同スケールだったので、
//     コマ毎の正規化はやめて共通倍率で縮小し、生成された通りの相対サイズを保っている。
//     倍率0.20は run6（既存の走り）と体の面積・立位換算が揃う値。
// ============================================================
var DRIBBLE2_ENABLED = true;                            // window.DRIBBLE2_ENABLED===false で従来ドリブルへ
var _D2_DIR = 'img/cutscenes/manga_dribble2/';
var _D2_W = 191, _D2_H = 179, _D2_FOOT = 173;           // 素材の画布と接地線
var _D2_BODY = 191;                                     // 立位換算の全身高（run6の_R6_BODY=195と同基準＝画面上で同じ体格になる）
// 2拍の尺。1コマ目＝「溜め」を主役に置き、2コマ目＝「決着」は短く抜く（2026-07-27 指示）。
//   溜めを主役にするとは配分だけでなく振り付けの話で、溜め拍では前進をほぼ止め（守備の滑り込みが動きを担う）、
//   決着拍で移動量の大半を一息に使う。同じ700msでも「長く見せる」のは溜め側。
var _D2_HOLD = 460;                                     // 拍1: 溜め（1コマ目）
var _D2_CUT = 240;                                      // 拍2: 決着（2コマ目）＝短い
// 走りの集中線（決着拍のみ）。主役の後方へ水平に流す。
function _d2Speed(ctx, x, y, a, dir) {
  if (a <= 0.02) return;
  ctx.strokeStyle = 'rgba(255,255,255,' + a + ')';
  ctx.lineWidth = 2;
  for (var i = 0; i < 5; i++) {                        // 帯は胴の高さに収める（芝まで垂らすと走りでなく地面の線に見える）
    var yy = y + i * 20;
    ctx.beginPath(); ctx.moveTo(x - dir * 12, yy); ctx.lineTo(x - dir * (54 + (i % 2) * 16), yy); ctx.stroke();
  }
}
var _D2_PH = 182;                                       // 画面上の全身高（run6のrunPhと同値）
function _renderDribble2Scene(sc) {
  if (typeof MangaRecolor === 'undefined' || !MangaRecolor.render) return null;
  if (sc.result !== '成功') return null;                 // 失敗＝該当ポーズ無し→従来シーンへ
  var dribP = sc && sc.offence && sc.offence.players && sc.offence.lineup && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  if (!dribP) return null;
  var feat = _mangaFeat(dribP.long_name || dribP.name || '');
  var colors = _mangaColors(sc.offence, feat.skin);
  var imgs = [1, 2].map(function (i) { return _loadCutsceneImg(_D2_DIR + 'f' + i + '.png?v=1'); });   // 画像差し替え時は?vを上げる

  // 守備（置き去りにされるスライダー）＝従来の成功ドリブルと同一。
  var defP = sc.defence && sc.defence.players && sc.defence.lineup && sc.defence.players[sc.defence.lineup[sc.dfsPos]];
  var defFeat = defP ? _mangaFeat(defP.long_name || defP.name || '') : null;
  var defImg = defFeat ? _loadCutsceneImg(_TK6_DIR + 'f' + _TK6_LAST + '.png?v=1') : null;   // 2026-08-05 新タックル決着コマへ差し替え
  var defColors = defFeat ? _mangaColors(sc.defence, defFeat.skin) : null;
  var defColorKey = defFeat ? ('tk6_' + _TK6_LAST + '|' + defColors.shirt + defColors.shorts + defColors.socks + defColors.accent + defColors.skin) : null;

  var W = 480, H = 216, ground = 196;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var atkRight = _csAttackRight(sc);
  var dir = atkRight ? 1 : -1;
  var flipSpr = !atkRight;                               // 攻撃体=ネイティブ右向き / スライダーも反転条件は同じ（従来ドリブル準拠）

  var atkColor = (sc.offence && sc.offence.team_color) || colors.shirt;
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = en ? 'BREAK!' : 'ドリブル突破！';
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var dribName = (typeof getPlayerName === 'function') ? getPlayerName(dribP) : (dribP.name || '');
  var atkTeamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';

  // 守備は「奥で滑って置き去りにされた側」＝接地線を上げ＋小さく描いて奥行きで分ける。
  //   従来（静止1枚のドリブラー）の 176/同一接地線のままだと、走り込む新アートの横に広いストライドと
  //   守備のスライドが同じ面で重なり続け、主役もボールも埋まる（実測: 尺の中盤ほぼ全部が重なり）。
  // 守備=新タックル決着コマ。旧スライダー(148)と同じ実効幅になる値＋枠下端と接地線のズレ補正。
  var bodyWDef = 147, defGroundUp = 18 - (_TK6_BOXH - _TK6_FOOT) * (147 / _TK6_BOXW);
  // 起点は従来の成功ドリブルと同一。尺は2拍の合計（溜め460 + 決着240 = 700ms）。
  var heroX0 = W * 0.5 - dir * 46, P = _D2_HOLD + _D2_CUT;

  function drawDef(cx, footY) {
    if (!defImg || !defImg.complete || !defImg.naturalWidth) return;
    var spr = MangaRecolor.render(defColorKey, defImg, defColors);
    if (!spr) return;
    var hgt = bodyWDef * (spr.height / spr.width);
    ctx.save();
    if (flipSpr) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spr, cx - bodyWDef / 2, footY - hgt, bodyWDef, hgt);
    ctx.restore();
  }
  // 走りループ本体。run6 と同じ「MangaRecolor → _csPixelate（論理解像度へ高品質縮小）→ NN描画」。
  function drawHero(cx, footY, fi) {
    var im = imgs[fi];
    if (!im || !im.complete || !im.naturalWidth) return false;
    var key = 'drb2|' + fi + '|' + colors.shirt + colors.shorts + colors.socks + colors.accent + colors.skin;
    var s = (_D2_PH * CS_FIGURE_SCALE) / _D2_BODY;
    var dw = _D2_W * s, dh = _D2_H * s;
    var spr = _csPixelate(MangaRecolor.render(key, im, colors), key, dw, dh);
    if (!spr) return false;
    ctx.save();
    if (flipSpr) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spr, cx - dw / 2, footY - _D2_FOOT * s, dw, dh);
    ctx.restore();
    return true;
  }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    var timeTxt = dom('game-time-display'); if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = atkColor; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = '#ffe14a'; ctx.fillText(label, 12, H - 9);
    if (dribName) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(dribName + (atkTeamNm ? (' · ' + atkTeamNm) : ''), W - 12, H - 10); }
  }

  // 計時の起点は「画面に出た最初のフレーム」。render 呼び出し時点で開始すると、
  //   canvas の挿入や初回リカラー（MangaRecolor+_csPixelate）にかかった時間が
  //   溜め拍の持ち時間から差し引かれ、実際に見える時間が _D2_HOLD より短くなる。
  var T0 = null;
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (T0 === null) {
      if (!canvas.isConnected) { requestAnimationFrame(frame); return; }   // 未挿入＝まだ誰も見ていないので計時を始めない
      T0 = now;
    }
    var el = now - T0, p = Math.min(1, el / P);
    ctx.clearRect(0, 0, W, H);

    // 溜めなしのイーズアウト＝抜き去りを尺の序盤で終わらせ、残りは「単独で走り抜ける」画にする。
    //   従来の smoothstep だと交差が尺のちょうど中盤に来て、重なった状態の時間が最も長くなっていた。
    // ── 2拍構成（2026-07-27 指示）: 1コマ目＝「溜め」の主役 / 2コマ目＝短い「決着」 ──
    //   拍1(溜め): 前進をほぼ止め、守備が滑り込んでくる。緊張だけを積む拍。
    //   拍2(決着): 溜めた分を一気に解放して抜き去る。短く速く、集中線で殴る。
    var hold = el < _D2_HOLD;
    var q = hold ? (el / _D2_HOLD) : Math.min(1, (el - _D2_HOLD) / _D2_CUT);
    var fi = hold ? 0 : 1;
    // 前進量: 溜めでは 12% までしか進まず（＝ほぼ密着のまま）、決着で残り 88% を一息に使う。
    var u = hold ? (0.12 * q * q) : (0.12 + 0.88 * (1 - Math.pow(1 - q, 2.4)));
    var heroX = heroX0 + dir * 124 * u;
    // 守備: 溜めの前半で前方から滑り込んで来て、45%で止まる（＝足を出し切って committed）。
    //   静止させたままだと溜めの拍が「ただ止まっている絵」になるので、ここで動きを担わせる。
    var defXf = heroX0 + dir * 50;
    var slide = hold ? Math.min(1, q / 0.45) : 1;
    var defX = defXf + dir * 30 * (1 - slide) * (1 - slide);   // ease-out で 30px 前方から定位置へ
    // ボール: 溜めでは足元に置いたまま（34px）、決着でぐっと前へ押し出す（→56px）。
    var ballX = heroX + dir * (hold ? 34 : (34 + 22 * q));
    var ballY = ground - 30;

    /* CAM-01: 2拍構成にカメラを合わせる（2026-07-28）。
     *   拍1「溜め」= ゆっくり寄るだけ（緊張を積む・揺らさない）
     *   拍2「決着」= もう一段寄る＋遅れて追う＋抜き際の一瞬だけ揺らす
     * ★ 拍の意味はカメラが担い、絵（2コマ）は触らない＝ユーザー確定の振り付けを崩さない。 */
    var cam = _csCam.mk({ fx: W * 0.5, fy: ground - 58 });
    var camOn = (typeof CS_CAM_ENABLED === 'undefined') || CS_CAM_ENABLED;
    var DBG = camOn ? 0.34 : 1, DDEF = camOn ? 0.90 : 1, DBALL = camOn ? 1.06 : 1;
    if (camOn) {
      cam.zoom = hold ? (1 + 0.07 * _csCam.smooth(q))            // 溜め: 1.00→1.07 でじりじり寄る
                      : (1.07 + 0.06 * _csCam.easeOut(q));       // 決着: 1.07→1.13 で踏み込む
      _csCam.follow(cam, heroX, heroX0 + dir * 40, 0.58);
      if (!hold) _csCam.shake(cam, el - _D2_HOLD, 190, 2.8);     // 抜き際だけ
    }

    _csCam.begin(ctx, cam, DBG);
    ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    _csCam.end(ctx);

    _csCam.begin(ctx, cam, DDEF);
    drawDef(defX, ground - defGroundUp);                 // 守備＝奥（接地線を上げる）＋先描き
    _csCam.end(ctx);
    _csCam.begin(ctx, cam, 1);
    // 決着の集中線＝抜いた瞬間に一番強く、拍の終わりへ消える。溜め側には出さない（拍の差を音量差で作る）。
    //   主役より先に描く＝体の背後を流れる。後描きにすると線が体の上を横切って傷のように見える。
    if (!hold) _d2Speed(ctx, heroX - dir * 30, ground - 128, (1 - q) * 0.8, dir);
    // 二次モーション: 決着で進行方向へ前傾＋踏み込みの潰し。溜め側は無変形＝拍の差を姿勢でも出す。
    var d2lean = (camOn && !hold) ? dir * 0.075 * (1 - Math.pow(q, 1.6)) : 0;
    var d2sq = (camOn && !hold) ? 1 - 0.045 * Math.sin(Math.min(1, q / 0.35) * Math.PI) : 1;
    var drawn;
    _csCam.puppet(ctx, heroX, ground, d2lean, d2sq, function () { drawn = drawHero(heroX, ground, fi); });
    _csCam.end(ctx);
    if (ballX > -20 && ballX < W + 20) { _csCam.begin(ctx, cam, DBALL); _lpBall(ctx, ballX, ballY, 12, p * 15 * dir); _csCam.end(ctx); }
    hud();
    // ループしない: 尺 P の終わりで停止し、2コマ目の絵を残したまま静止する。
    //   画像ロードが遅れた場合だけは、完了後に最終フレームを描き切るために回し続ける（他シーンと同流儀）。
    if (p < 1 || !imgs[0].complete || !imgs[1].complete) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return _csCenterSubject(canvas, 0.5, false);
}

var _DRIBBLE_SRC = 'img/cutscenes/dribble_01.png';
var _DRIBBLE_DEF_SRC = 'img/cutscenes/dribbledef_01.png';
function _renderDribbleScene(sc) {
  // lab限定：漫画スプライトが使えるなら漫画ドリブルへ（本番は MangaRecolor 未定義→従来描画）。
  if (_MANGA_DRIB_ENABLED && typeof MangaRecolor !== 'undefined' &&
      (typeof window === 'undefined' || window.MANGA_CUTSCENE_ENABLED !== false)) {
    // 新2コマ走りドリブル（テスト実装）。成功時のみ担当し、失敗/未ロードは従来シーンへ落ちる。
    if (DRIBBLE2_ENABLED && (typeof window === 'undefined' || window.DRIBBLE2_ENABLED !== false)) {
      var _d2 = _renderDribble2Scene(sc);
      if (_d2) return _d2;
    }
    var _mg = _renderMangaDribbleScene(sc);
    if (_mg) return _mg;
  }
  var W = 480, H = 216, ground = 190;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var dribImg = _loadCutsceneImg(_DRIBBLE_SRC), defImg = _loadCutsceneImg(_DRIBBLE_DEF_SRC);
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var atkColor = (sc.offence && sc.offence.team_color) || '#1f4fd6';
  var defColor = (sc.defence && sc.defence.team_color) || '#e36b1f';
  var success = (sc.result === '成功');

  var gs = (typeof gameState !== 'undefined' && gameState) ? gameState : {};
  var t1 = gs.team1, t2 = gs.team2;
  var c1 = (t1 && t1.team_color) || '#1f4fd6', c2 = (t2 && t2.team_color) || '#e36b1f';
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display'), s1 = dom('score1'), s2 = dom('score2');
  var dribP = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var dribName = dribP ? ((typeof getPlayerName === 'function') ? getPlayerName(dribP) : dribP.name) : '';
  var defP = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[sc.dfsPos]];
  var defName = defP ? ((typeof getPlayerName === 'function') ? getPlayerName(defP) : defP.name) : '';
  var atkTeamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var defTeamNm = (typeof getTeamName === 'function' && sc.defence) ? getTeamName(sc.defence) : '';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = success ? (en ? 'BREAK!' : 'ドリブル突破！') : (en ? 'TACKLED!' : 'カット！');
  var labelCol = success ? '#ffe14a' : '#ff5a3c';
  var accent = success ? atkColor : defColor;

  var dribPh = Math.round(184 * CS_FIGURE_SCALE), defPh = Math.round(168 * CS_FIGURE_SCALE), P = success ? 1000 : 1800, zc = [240, 116];   // 2/3縮小(2026-07-23)・成功は尺半分
  var flipH = !_csAttackRight(sc);                                  // ネイティブ=右攻め → team2(左)で反転

  function speedLines(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12); ctx.lineTo(x + Math.cos(an) * 52, y + Math.sin(an) * 52); ctx.stroke(); } }
  function drawSpr(img, cx, footY, hgt) { if (!img) return; var nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height; if (!nw) return; var w = nw * (hgt / nh); ctx.drawImage(img, cx - w / 2, footY - hgt, w, hgt); }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;   // 焼き込みラベル停止（時刻/アクション名/選手名はHUD・ネーム枠へ集約）
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    // ミニスコア（色チップ＋略称＋スコア）はスコアボードへ集約のため非表示。時間(左上)とラベル/選手名は残す。
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = labelCol; ctx.fillText(label, 12, H - 9);
    var nm = success ? (dribName ? (dribName + (atkTeamNm ? (' · ' + atkTeamNm) : '')) : '') : (defName ? ('✕ ' + defName + (defTeamNm ? (' · ' + defTeamNm) : '')) : '');
    if (nm) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(nm, W - 12, H - 10); }
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    var dribSpr = _csRecolorBand(dribImg, 'green', atkColor, 'drb');   // 緑→攻撃色（ロード後memo）
    var defSpr = _csRecolorBand(defImg, 'red', defColor, 'drbdef');    // 赤→守備色
    ctx.clearRect(0, 0, W, H);
    var z = 1.0 + Math.min(1, p / 0.6) * 0.05;
    var dribX, defX, ballX, ballY, contact = 0;
    if (success) {
      var u = 1 - (1 - Math.min(1, p / 0.85)) * (1 - Math.min(1, p / 0.85));   // ease-out（p0.85で到達）
      dribX = 196 + 150 * u;                           // 添付位置から右へ前進（守備を抜く）
      defX = 265;                                       // 守備は後方
      ballX = dribX + 34; ballY = ground - 17;          // ボールはドリブラーの少し前（2/3縮小に合わせ間隔・高さ詰め）
    } else {
      dribX = 196;                                      // ドリブラー静止（攻撃成功時と同じ位置）
      defX = 265;                                       // 守備は攻撃成功時と同じ位置
      var bootX = defX - 34, bootY = ground - 16, kp = 0.10;   // 守備の足のスパイク＝ボール起点（2/3縮小に合わせ）
      ballX = bootX - 1450 * Math.max(0, p - kp); ballY = bootY;   // スパイクから並行に左へ弾き返す
      contact = (p > kp - 0.02 && p < kp + 0.10) ? 1 - Math.abs(p - kp) / 0.10 : 0;
    }
    ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.translate(zc[0], zc[1]); ctx.scale(z, z); ctx.translate(-zc[0], -zc[1]);
    ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    drawSpr(defSpr, defX, ground, defPh); drawSpr(dribSpr, dribX, ground, dribPh);   // 守備は常にドリブラーの後ろ（先に描画）
    if (ballY < H + 20 && ballX > -20 && ballX < W + 20) _lpBall(ctx, ballX, ballY, 8, p * 15);   // ボールも2/3(r=8)
    if (contact > 0) speedLines(ballX, ballY, contact * 0.8);
    ctx.restore();
    if (contact > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (contact * 0.4) + ')'; ctx.fillRect(0, 0, W, H); }
    hud();
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // ドリブルは守備(defX=265)とドリブラー(196→346成功)のデュエル。デュエル中心 ≈265 を可視窓中央へ。
  //   flipH（=!_csAttackRight, 描画側と同じ）を渡してフリップ後の実効位置で寄せる。
  return _csCenterSubject(canvas, 265 / W, flipH);
}

// ============================================================
// ポストプレー専用カットイン:
//   成功 = ①ホールドアップ絵(postplay_t_01: 青=攻撃/白=守備, 足元でボールキープ)を見せ、
//          ②ドリブルスプライト流用で反転して前へ抜け出す（＝反転しかわす）。
//   失敗 = 守備がボールを弾く絵(postplay_fail_t_01)＋ボールが弾かれて流れる＋インパクト。
//   青(攻撃キット)は実行時に攻撃チーム色へリカラー（白守備はそのまま）。表示層のみ・エンジン非接触。
// ============================================================
// ポストプレー専用リカラー: 赤=攻撃選手→攻撃チーム色 / 緑=守備選手→守備チーム色。
//   _headerRecolor と同方式だが、提供アートの濃い影(l≈0.1)も拾えるよう明度下限を 0.08 に広げる。
var _ppRecolorCache = {};
function _recolorPostplay(base, atkColor, defColor, srcId) {
  if (!base || !base.complete || !base.naturalWidth) return null;
  var atkKit = _colorBucket(atkColor) || 'red';
  var defKit = _colorBucket(defColor) || 'green';
  var key = (srcId || '') + '|' + atkKit + '|' + defKit;
  if (_ppRecolorCache[key]) return _ppRecolorCache[key];
  var w = base.naturalWidth, hgt = base.naturalHeight;
  var cv = document.createElement('canvas'); cv.width = w; cv.height = hgt;
  var c = cv.getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(base, 0, 0);
  var im; try { im = c.getImageData(0, 0, w, hgt); } catch (e) { return null; }
  var d = im.data, atkSpec = _LP_KIT_SPEC[atkKit], defSpec = _LP_KIT_SPEC[defKit];
  for (var i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    var hsl = _lpRgb2hsl(d[i], d[i + 1], d[i + 2]), h = hsl[0], s = hsl[1], l = hsl[2];
    if (s > 0.4 && l > 0.08 && l < 0.82) {            // 濃い影(l~0.1)〜明るめまで。肌(橙h~30)・輪郭(低彩度/極暗)は除外。
      var v = null;
      if (h < 20 || h > 340) v = _lpApplyKit(atkSpec, h, s, l);       // 赤 → 攻撃チーム色
      else if (h > 80 && h < 170) v = _lpApplyKit(defSpec, h, s, l);  // 緑 → 守備チーム色
      if (v) { d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; }
    }
  }
  c.putImageData(im, 0, 0);
  _ppRecolorCache[key] = cv; return cv;
}
var _POSTPLAY_SRC = 'img/cutscenes/postplay_t_01.png?v=pp6';
var _POSTPLAY_FAIL_SRC = 'img/cutscenes/postplay_fail_t_01.png?v=pp5';   // 本番フォールバック用（赤緑タブロー）
// 失敗＝新マンガ方式（2体を各自独立配置）。攻撃(倒れ・横長)・守備(立ち・縦長)を別々の単体PNGで持ち、
//   MangaRecolor で各チームのキット4色＋選手肌へ独立リカラー→各自の cx/footY へ「共通スケール k」で描く
//   （ドリブル攻撃＋スライダー守備と同じ単体スプライト方式）。両アセットはシャツ青面積42000に正規化済み＝
//   同体格なので必ず同一 k で描く（別 target 幅だと横長の倒れ選手が縮むためNG）。
//   MangaRecolor 未ロード(本番)は _POSTPLAY_FAIL_SRC の従来タブロー1枚へフォールバック（旧アセット温存）。
// ※将来 _MANGA_HAIR_UNIFORM=null 解禁時は各役12髪型へ展開予定（postplay_fail_atk/<hstyle>.png へ差し替え）。今は単体fade1枚。
var _POSTPLAY_FAIL_ATK_SRC = 'img/cutscenes/postplay_fail_atk.png';   // 攻撃選手（倒れ込み・横長 1039×490）
var _POSTPLAY_FAIL_DEF_SRC = 'img/cutscenes/postplay_fail_def.png';   // 守備選手（立ち圧力・縦長 626×764）
// 成功＝ホールドアップ前半も新マンガ方式（2体を各自独立配置）。攻撃(前でシールド・536×994)・守備(後ろから前傾プレス・694×784)を
//   別々の単体PNGで持ち、MangaRecolor で各チームのキット4色＋選手肌へ独立リカラー→各自の cx/footY へ「共通スケール k」で描く
//   （失敗枝と同じ単体スプライト方式）。両アセットはシャツ青面積42000に正規化済み＝同体格なので必ず同一 k で描く。
//   ※密着ポーズを別々生成した初回版のため位置は要微調整（preview で詰める前提）。MangaRecolor 未ロード(本番)は従来タブロー
//   (_POSTPLAY_SRC) の赤緑1枚へフォールバック（旧アセット温存）。将来 _MANGA_HAIR_UNIFORM=null 解禁で各役12髪型へ展開予定。
var _POSTPLAY_HOLD_ATK_SRC = 'img/cutscenes/postplay_holdup_atk.png?v=pp3'; // 攻撃選手（前でシールド・腕を前に組む）※2026-07-10 攻守入替
var _POSTPLAY_HOLD_DEF_SRC = 'img/cutscenes/postplay_holdup_def.png?v=pp3'; // 守備選手（後ろから前傾・広いスタンス）
function _renderPostplayScene(sc) {
  var W = 480, H = 216, ground = 190;   // 他シーン（ドリブル等）と同じ接地ライン
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var atkColor = (sc.offence && sc.offence.team_color) || '#1f4fd6';
  var defColor = (sc.defence && sc.defence.team_color) || '#e36b1f';
  var success = (sc.result === '成功');
  var foulContact = (sc.result === 'ファール');   // ファール接触ビート: 失敗アート(else枝)を流用しラベル/色/名前のみ差し替え

  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display');
  var atkP = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var atkName = atkP ? ((typeof getPlayerName === 'function') ? getPlayerName(atkP) : atkP.name) : '';
  var defP = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[sc.dfsPos]];
  var defName = defP ? ((typeof getPlayerName === 'function') ? getPlayerName(defP) : defP.name) : '';
  var atkTeamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var defTeamNm = (typeof getTeamName === 'function' && sc.defence) ? getTeamName(sc.defence) : '';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = foulContact ? (en ? 'BROUGHT DOWN!' : '倒された！') : success ? (en ? 'HOLD-UP!' : 'ポストプレー！') : (en ? 'DISPOSSESSED!' : '奪われた！');
  var labelCol = foulContact ? '#ffcf33' : success ? '#ffe14a' : '#ff5a3c';
  var accent = foulContact ? '#ffcf33' : success ? atkColor : defColor;

  var postImg = _loadCutsceneImg(_POSTPLAY_SRC);
  var failImg = _loadCutsceneImg(_POSTPLAY_FAIL_SRC);
  // 失敗（奪われた／倒された）＝新マンガ方式（2体分離＋MangaRecolor）。lab のみ。本番(未ロード)はタブローへフォールバック。
  var _mangaPP = (typeof MangaRecolor !== 'undefined' && MangaRecolor.render &&
                  (typeof window === 'undefined' || window.MANGA_CUTSCENE_ENABLED !== false));
  var failAtkImg, failDefImg, ppfAtkCols, ppfDefCols, ppfAtkKey, ppfDefKey;
  var holdAtkImg, holdDefImg, pphAtkKey, pphDefKey;   // 成功前半ホールドアップの2体（攻撃=前・守備=後）
  var drbMangaImg, ppDrbKey;   // 成功後半＝抜け出しランナー（漫画ドリブラー・ドリブル成功と同一アセット）
  if (_mangaPP) {
    var _aFeat = _mangaFeat(atkP ? (atkP.long_name || atkP.name || '') : '');   // 攻撃 identity（髪型/肌）
    var _aSkin = _aFeat.skin;   // 攻撃肌
    var _dSkin = _mangaFeat(defP ? (defP.long_name || defP.name || '') : '').skin;   // 守備肌
    ppfAtkCols = _mangaColors(sc.offence, _aSkin);   // 攻撃キット4色＋肌
    ppfDefCols = _mangaColors(sc.defence, _dSkin);   // 守備キット4色＋肌
    var _aSig = ppfAtkCols.shirt + ppfAtkCols.shorts + ppfAtkCols.socks + ppfAtkCols.accent + ppfAtkCols.skin;
    var _dSig = ppfDefCols.shirt + ppfDefCols.shorts + ppfDefCols.socks + ppfDefCols.accent + ppfDefCols.skin;
    ppfAtkKey = 'ppf_atk|' + _aSig;   // ★攻守で別spriteKey必須＝MangaRecolorベースキャッシュの衝突回避
    ppfDefKey = 'ppf_def|' + _dSig;
    failAtkImg = _loadCutsceneImg(_POSTPLAY_FAIL_ATK_SRC);
    failDefImg = _loadCutsceneImg(_POSTPLAY_FAIL_DEF_SRC);
    // ホールドアップ(成功前半)も別ベース＝別spriteKey（pph_）。キット色/肌は失敗枝と同じ ppfAtkCols/ppfDefCols を流用。
    pphAtkKey = 'pph_atk|' + _aSig;
    pphDefKey = 'pph_def|' + _dSig;
    holdAtkImg = _loadCutsceneImg(_POSTPLAY_HOLD_ATK_SRC);
    holdDefImg = _loadCutsceneImg(_POSTPLAY_HOLD_DEF_SRC);
    // 後半＝抜け出しランナーはドリブル成功と同一の漫画ドリブラー（manga_dribble/<hstyle>.png・250×338・ネイティブ右向き）。
    //   spriteKeyは 'pp_drb_' 接頭辞で衝突回避。キット色/肌は攻撃選手（ppfAtkCols）を流用。過渡期は fade 固定。
    var _drbSpriteId = _aFeat.hstyle;
    drbMangaImg = _loadCutsceneImg('img/cutscenes/manga_dribble/' + _drbSpriteId + '.png');
    ppDrbKey = 'pp_drb_' + _drbSpriteId + '|' + _aSig;
  }
  var dribImg = _loadCutsceneImg(_DRIBBLE_SRC);   // 反転突破は「抜け出し」と同じランナー単独を流用（守備なし）
  var P = success ? 2000 : 1700, zc = [240, 116];
  var flipH = !_csAttackRight(sc);

  function speedLines(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12); ctx.lineTo(x + Math.cos(an) * 52, y + Math.sin(an) * 52); ctx.stroke(); } }
  function drawSpr(img, cx, footY, hgt) { if (!img) return; var nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height; if (!nw) return; var w = nw * (hgt / nh); ctx.drawImage(img, cx - w / 2, footY - hgt, w, hgt); }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;   // 焼き込みラベル停止（時刻/アクション名/選手名はHUD・ネーム枠へ集約）
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = labelCol; ctx.fillText(label, 12, H - 9);
    var nm = success ? (atkName ? (atkName + (atkTeamNm ? (' · ' + atkTeamNm) : '')) : '') : (defName ? ('✕ ' + defName + (defTeamNm ? (' · ' + defTeamNm) : '')) : '');
    if (nm) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(nm, W - 12, H - 10); }
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    var z = 1.0 + Math.min(1, p / 0.6) * 0.05;
    var contact = 0;
    // 背景（ピッチ＝左右対称）はフリップ非依存・ズームのみ。図はフェーズ別フリップで描く。
    ctx.save(); ctx.translate(zc[0], zc[1]); ctx.scale(z, z); ctx.translate(-zc[0], -zc[1]);
    ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    ctx.restore();
    function withFlip(fl, draw) { ctx.save(); ctx.imageSmoothingEnabled = false; if (fl) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.translate(zc[0], zc[1]); ctx.scale(z, z); ctx.translate(-zc[0], -zc[1]); draw(); ctx.restore(); }
    if (success) {
      var pSwap = 0.5;
      if (p < pSwap) {
        withFlip(!flipH, function () {                                                   // 絵はネイティブ向きが逆＝!flipHで攻撃方向に合わせる
          if (_mangaPP) {
            // 攻撃(前でシールド)＋守備(後ろから前傾)を別チーム色にリカラーし、各自独立の cx/footY へ「共通スケール k」で描く。
            //   両アセットはシャツ青面積42000に正規化済み＝同体格→同一 k（0.185・失敗枝と同じ）で体格が揃う。
            //   描画順=守備(後・先描き)→攻撃(前・後描き)で攻撃を前面。★未ロードでrenderすると空ベースが
            //   MangaRecolorのキャッシュを汚染する→ロード完了(complete&&naturalWidth)まで描かない（rAF継続）。
            var PPH_K = 0.185;                                                        // 共通スケール（失敗枝と同一）
            var haSpr = (holdAtkImg.complete && holdAtkImg.naturalWidth) ? MangaRecolor.render(pphAtkKey, holdAtkImg, ppfAtkCols) : null;
            var hdSpr = (holdDefImg.complete && holdDefImg.naturalWidth) ? MangaRecolor.render(pphDefKey, holdDefImg, ppfDefCols) : null;
            if (hdSpr) { var hdh = (hdSpr.naturalHeight || hdSpr.height) * PPH_K; drawSpr(hdSpr, 210, ground, hdh); }   // 守備(後)：接地・先描き（2026-07-10 画面右へ30px＝withFlip反転のためcx 240→210）
            if (haSpr) { var hah = (haSpr.naturalHeight || haSpr.height) * PPH_K; drawSpr(haSpr, 252, ground, hah); }   // 攻撃(前)：前・接地・後描き
            _lpBall(ctx, 252 - 28, ground - 14, 11, 0);                               // ボールは攻撃選手の足元へ
          } else {
            var ppSpr = _recolorPostplay(postImg, atkColor, defColor, 'pp') || postImg;  // 本番フォールバック: 赤→攻撃色・緑→守備色（2人タブロー）
            drawSpr(ppSpr, 244, ground, 168);                                         // 少し小さく（190→168）
            _lpBall(ctx, 224, ground - 14, 11, 0);                                    // 足元のボール
          }
        });
      } else {
        var u = (p - pSwap) / (1 - pSwap), ue = 1 - (1 - u) * (1 - u);
        // ランナー単独（「抜け出し」成功と同じ）。向きは他のドリブル/飛び出しと同じ攻撃方向（flipH）。
        //   manga_dribble はネイティブ右向き＝withFlip(flipH)内で無反転なら attack-right(flipH=false)でそのまま右へ走り
        //   attack-left(flipH=true)でwithFlipが反転＝二重反転にならず攻撃方向へ正しく走る（drawSpr内で追加反転しない）。
        withFlip(flipH, function () {
          var dribX = 196 + 150 * ue;
          if (_mangaPP) {
            // 漫画ドリブラー（ドリブル成功と同一アセット・攻撃キット色）。未ロード中は描かずrAF継続。
            var drbSpr = (drbMangaImg.complete && drbMangaImg.naturalWidth) ? MangaRecolor.render(ppDrbKey, drbMangaImg, ppfAtkCols) : null;
            if (drbSpr) drawSpr(drbSpr, dribX, ground, 176);                          // 前半ホールドアップ攻撃(~184px)と体格を揃える高さ
          } else {
            var dribSpr = _csRecolorBand(dribImg, 'green', atkColor, 'drb') || dribImg; // 本番フォールバック: 旧ランナー（緑→攻撃色）
            drawSpr(dribSpr, dribX, ground, 172);                                     // ランナー（少し小さく）
          }
          _lpBall(ctx, dribX + 48, ground - 24, 11, u * 15);                          // ボールは前方
        });
      }
    } else {
      withFlip(!flipH, function () {                                                  // 絵はネイティブ向きが逆＝!flipHで攻撃方向に合わせる
        if (_mangaPP) {
          // 攻撃(倒れ)＋守備(立ち)を別チーム色にリカラーし、各自独立の cx/footY へ「共通スケール k」で描く。
          //   両アセットはシャツ青面積42000に正規化済み＝同体格→同一 k で体格が揃う（別 target 幅はNG）。
          //   描画順=攻撃(倒れ・先描き)→守備(立ち・後描き)で守備をやや前面。★未ロードでrenderすると空ベースが
          //   MangaRecolorのキャッシュを汚染する→ロード完了(complete&&naturalWidth)まで描かない（rAF継続）。
          var PPF_K = 0.185;                                                          // 共通スケール：立ち守備の全高が画面 ~140px
          var aSpr = (failAtkImg.complete && failAtkImg.naturalWidth) ? MangaRecolor.render(ppfAtkKey, failAtkImg, ppfAtkCols) : null;
          var dSpr = (failDefImg.complete && failDefImg.naturalWidth) ? MangaRecolor.render(ppfDefKey, failDefImg, ppfDefCols) : null;
          if (aSpr) { var ah = (aSpr.naturalHeight || aSpr.height) * PPF_K; drawSpr(aSpr, 300, ground + 8, ah); }   // 攻撃(倒れ)：手前・右下・接地・先描き
          if (dSpr) { var dh = (dSpr.naturalHeight || dSpr.height) * PPF_K; drawSpr(dSpr, 210, ground, dh); }       // 守備(立ち)：やや後ろ・左・後描き
        } else {
          var fSpr = _recolorPostplay(failImg, atkColor, defColor, 'ppfail') || failImg;    // 本番フォールバック: 赤→攻撃色・緑→守備色タブロー
          drawSpr(fSpr, 240, ground + 2, 150);                                       // タイト画像：足元を接地ラインへ
        }
      });
      var kp = 0.12, bootX = _mangaPP ? 228 : 244, bootY = ground - 8;               // 2体分離：守備(cx210)と攻撃(cx300)の間・守備足元付近が弾かれ起点
      var ballX = bootX + 1450 * Math.max(0, p - kp), ballY = bootY;                  // 弾かれて流れる
      contact = (p > kp - 0.02 && p < kp + 0.10) ? 1 - Math.abs(p - kp) / 0.10 : 0;
      withFlip(!flipH, function () {                                                  // 図と同じ反転でボールも描く
        if (ballX > -20 && ballX < W + 20) _lpBall(ctx, ballX, ballY, 12, p * 15);
        if (contact > 0) speedLines(bootX, bootY, contact * 0.8);
      });
    }
    if (contact > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (contact * 0.4) + ')'; ctx.fillRect(0, 0, W, H); }
    hud();
    // 画像ロードが遅れても完了後に描き切る（未ロードで止まらせない）
    if (p < 1 || (_mangaPP && !success && (!failAtkImg.complete || !failDefImg.complete))
              || (_mangaPP && success && (!holdAtkImg.complete || !holdDefImg.complete || !drbMangaImg.complete))) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // ポストプレーは前半のホールドアップ・タブロー(244, !flipH で描画)が主。タブロー中心を可視窓中央へ。
  //   タブローは withFlip(!flipH) なので、ヘルパーには flipH=!flipH を渡してフリップ後実効位置を合わせる。
  return _csCenterSubject(canvas, 244 / W, !flipH);
}

// ============================================================
// 飛び出し（Run In Behind）専用カットイン: 裏のスペースへ出たスルーパスへ走り込む演出。
//   成功=ランナー単独を描き、ボールを前方へ転がして「守備を振り切り単独で追いつく」振り付け
//     （守備は描かない・dribble と差別化・新規アート不要）。
//     ★ 2026-07-27 ユーザー指示で **2拍構成** へ（ドリブル演出と同じ作法）:
//       拍1「溜め」= 選手は1コマで静止し、動くのはスルーパスのボールだけ。
//       拍2「決着」= コマを差し替えて一息に追いつき、そのまま静止する。走りループは回さない。
//   失敗（守備成功）=ロングパス失敗と同じカット・タブロー（longpass_fail: スライディングで止める守備＋
//     止められる攻撃）を流用し攻撃/守備色へ色替え＋「読まれた！」HUD。1回再生で静止・detach で停止。
// ============================================================
function _renderRunInScene(sc) {
  var W = 480, H = 216, ground = 190;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var runImg = _loadCutsceneImg(_DRIBBLE_SRC);                     // 成功時のランナー（緑→攻撃色）。失敗はタブロー(_LP_FAIL_SRC)を使う
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var atkColor = (sc.offence && sc.offence.team_color) || '#1f4fd6';
  var defColor = (sc.defence && sc.defence.team_color) || '#e36b1f';
  var success = (sc.result === '成功');

  var gs = (typeof gameState !== 'undefined' && gameState) ? gameState : {};
  var t1 = gs.team1, t2 = gs.team2;
  var c1 = (t1 && t1.team_color) || '#1f4fd6', c2 = (t2 && t2.team_color) || '#e36b1f';
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display'), s1 = dom('score1'), s2 = dom('score2');
  var runP = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var runName = runP ? ((typeof getPlayerName === 'function') ? getPlayerName(runP) : runP.name) : '';
  var defP = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[sc.dfsPos]];
  var defName = defP ? ((typeof getPlayerName === 'function') ? getPlayerName(defP) : defP.name) : '';
  var atkTeamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var defTeamNm = (typeof getTeamName === 'function' && sc.defence) ? getTeamName(sc.defence) : '';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = success ? (en ? 'IN BEHIND!' : '抜け出した！') : (en ? 'TRACKED!' : '読まれた！');
  var labelCol = success ? '#ffe14a' : '#ff5a3c';
  var accent = success ? atkColor : defColor;

  // ── 成功=2拍構成（2026-07-27 ユーザー指示・ドリブル演出と同じ作法）─────────────
  //   旧: 6コマの走りループを尺いっぱい回し続け、しかも表示中はずっと回していた（＝「ずっと走った状態」）。
  //   新: 拍1「溜め」＝**選手は1コマで静止**し、スルーパスだけがウラのスペースへ転がる。
  //       拍2「決着」＝コマを差し替えて一息に追いつく。最後は**2コマ目のまま静止**（ループしない）。
  //   尺の合計は従来と同じ 750ms（2026-07-23 ユーザー指定）。配分はドリブル2拍（460:240）と同比。
  var _RI_HOLD = 490, _RI_CUT = 260;
  var runPh = 182, P = success ? (_RI_HOLD + _RI_CUT) : 1700, zc = [230, 150];
  // 走りアート（sprite-studio 2026-07-22）: MangaRecolor到達時のみ使う。
  //   素材: img/cutscenes/manga_run6/f1..f6.png（172x223・接地線y=217・ネイティブ左向き）。
  //   使うのは2枚だけ = f6（溜め＝ひざを上げてコンパクトに構える）→ f4（決着＝最大ストライドで抜け出す）。
  //   未ロード/本番(MangaRecolor無し)は従来の _DRIBBLE_SRC 静止画へ自動フォールバック。
  var _r6Manga = success && (typeof MangaRecolor !== 'undefined') && MangaRecolor.render;
  var _r6Cols = _r6Manga ? _mangaColors(sc.offence, _mangaFeat(runP ? (runP.long_name || runP.name || '') : '').skin) : null;
  var _RI_FI_HOLD = 6, _RI_FI_CUT = 4;   // 使用コマ番号（キャッシュキーにも使う＝絵が違えばキーも違う）
  var _riHoldImg = _r6Manga ? _loadCutsceneImg('img/cutscenes/manga_run6/f' + _RI_FI_HOLD + '.png?v=2') : null;   // 画像差し替え時は?vを上げる
  var _riCutImg  = _r6Manga ? _loadCutsceneImg('img/cutscenes/manga_run6/f' + _RI_FI_CUT  + '.png?v=2') : null;
  var _R6_W = 172, _R6_H = 223, _R6_FOOT = 217, _R6_BODY = 195;
  var flipH = !_csAttackRight(sc);                                 // 成功スプライト: ネイティブ=右攻め → team2(左)で反転
  var flipFail = _csAttackRight(sc);                               // 失敗タブロー: longpass_fail と同じ向き(ネイティブ=左攻め)
  var failBase = success ? null : _loadCutsceneImg(_LP_FAIL_SRC);  // 失敗=カット・タブロー（赤×緑の2人絵）
  function eo(x) { return 1 - (1 - x) * (1 - x); }                 // ease-out quad

  function drawSpr(img, cx, footY, hgt) { if (!img) return; var nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height; if (!nw) return; var w = nw * (hgt / nh); ctx.drawImage(img, cx - w / 2, footY - hgt, w, hgt); }
  function burst(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 14, y + Math.sin(an) * 14); ctx.lineTo(x + Math.cos(an) * 56, y + Math.sin(an) * 56); ctx.stroke(); } }
  function trail(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2; for (var i = 0; i < 5; i++) { var yy = y + i * 17; ctx.beginPath(); ctx.moveTo(x - 14, yy); ctx.lineTo(x - 58, yy); ctx.stroke(); } }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;   // 焼き込みラベル停止（時刻/アクション名/選手名はHUD・ネーム枠へ集約）
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    // ミニスコア（色チップ＋略称＋スコア）はスコアボードへ集約のため非表示。時間(左上)とラベル/選手名は残す。
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = labelCol; ctx.fillText(label, 12, H - 9);
    var nm = success ? (runName ? (runName + (atkTeamNm ? (' · ' + atkTeamNm) : '')) : '') : (defName ? ('✕ ' + defName + (defTeamNm ? (' · ' + defTeamNm) : '')) : '');
    if (nm) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(nm, W - 12, H - 10); }
  }

  // 計時の起点は「画面に出た最初のフレーム」（ドリブル演出と同じ理由）。
  //   生成時点で始めると、canvas の挿入や初回リカラーに食われた分だけ**溜め拍が短く見える**。
  var T0 = null;
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (T0 === null) {
      if (!canvas.isConnected) { requestAnimationFrame(frame); return; }   // まだ誰も見ていない＝計時を始めない
      T0 = now;
    }
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    if (success) {
      // ===== 成功: 守備を振り切り、ランナー単独で前方のスルーパスへ走り込む（守備は描かない）=====
      var runSpr = _csRecolorBand(runImg, 'green', atkColor, 'drb');     // 緑→攻撃色（dribble と同一キャッシュ）
      var z = 1.0 + Math.min(1, p / 0.6) * 0.04;
      // 2拍（ドリブル演出と同作法）。拍1=溜め: 選手は静止し、動くのはボールだけ。拍2=決着: 一息に追いつく。
      var el = now - T0;
      var hold = el < _RI_HOLD;
      var q = hold ? (el / _RI_HOLD) : Math.min(1, (el - _RI_HOLD) / _RI_CUT);
      var sprint = hold ? 0 : (1 - q);                       // 速度線は決着拍だけ（抜けた瞬間が最大→消える）
      // 前進量: 溜めでは 12% しか動かない（＝構えたまま）。決着で残り 88% を一気に使う。
      var u = hold ? (0.12 * q * q) : (0.12 + 0.88 * (1 - Math.pow(1 - q, 2.4)));
      var runX = 90 + 150 * u;                               // 前進して画面中央(240)で終わる・2026-07-23
      var ballX = -24 + 340 * eo(p);                         // 左から速く転がり込み、止まらず走者の先を転がる途中で尺終了・2026-07-23
      /* CAM-01（2026-07-28）: 2拍にカメラを合わせる。拍1「溜め」は浅く寄るだけ、拍2「決着」で踏み込む。
       *   ★ 追いかけ（follow）は入れない。この演出は**走者が画面中央へ入ってくる**ことで決着を見せる
       *     振り付けなので、カメラが追うとその移動が打ち消される。寄りと揺れだけを足す。
       *   ★ 寄りは片道（戻さない）。背景は深度0.34でほぼ止まる＝走者だけが前に出る。 */
      var camOn = (typeof CS_CAM_ENABLED === 'undefined') || CS_CAM_ENABLED;
      var cam = _csCam.mk({ fx: zc[0], fy: zc[1] });
      cam.zoom = camOn ? (hold ? (1 + 0.05 * _csCam.smooth(q)) : (1.05 + 0.07 * _csCam.easeOut(q))) : z;
      if (camOn && !hold) _csCam.shake(cam, el - _RI_HOLD, 190, 2.8);   // 抜け出しの一瞬だけ
      var beginLayer = function (d) {
        ctx.save();
        if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); }
        _csCam.begin(ctx, cam, camOn ? d : 1);
      };
      var endLayer = function () { _csCam.end(ctx); ctx.restore(); };

      beginLayer(camOn ? 0.34 : 1);
      ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);
      endLayer();

      beginLayer(1);
      ctx.imageSmoothingEnabled = false;
      // 二次モーション: 決着拍だけ進行方向へ前傾＋踏み込みの潰し（溜め拍は無変形＝拍の差を姿勢でも出す）。
      var riLean = (camOn && !hold) ? 0.070 * (1 - Math.pow(q, 1.6)) : 0;
      var riSq = (camOn && !hold) ? 1 - 0.040 * Math.sin(Math.min(1, q / 0.35) * Math.PI) : 1;
      var _r6Drawn = false;
      if (_r6Manga) {
        // ★ コマ送りではなく「拍ごとに1枚を静止」。同じ拍の間は同じ絵のまま動かさない。
        var _fi = hold ? _RI_FI_HOLD : _RI_FI_CUT;
        var _im6 = hold ? _riHoldImg : _riCutImg;
        if (_im6 && _im6.complete && _im6.naturalWidth) {
          var _k6 = 'run6|' + _fi + '|' + _r6Cols.shirt + _r6Cols.shorts + _r6Cols.socks + _r6Cols.accent + _r6Cols.skin;
          var _s6 = (runPh * CS_FIGURE_SCALE) / _R6_BODY;    // 等身縮小＝共通定数（2026-07-23）
          var _dw = _R6_W * _s6, _dh = _R6_H * _s6;
          var _spr6 = _csPixelate(MangaRecolor.render(_k6, _im6, _r6Cols), _k6, _dw, _dh);
          _csCam.puppet(ctx, runX, ground, riLean, riSq, function () {
            ctx.save(); ctx.translate(runX, 0); ctx.scale(-1, 1);   // ネイティブ左向き → 右向きへ反転
            ctx.drawImage(_spr6, -_dw / 2, ground - _R6_FOOT * _s6, _dw, _dh);
            ctx.restore();
          });
          _r6Drawn = true;
        }
      }
      if (!_r6Drawn) _csCam.puppet(ctx, runX, ground, riLean, riSq, function () { drawSpr(runSpr, runX, ground, runPh); });   // ランナーのみ（守備は消す）
      if (sprint > 0.05) trail(runX - 26, ground - 96, sprint * 0.5);               // ランナー後方の水平疾走線
      if (ballX > -20 && ballX < W + 20) { var _br = Math.round(12 * CS_FIGURE_SCALE); _lpBall(ctx, ballX, ground - _br, _br, p * 26); }   // ボールも共通定数で縮小
      endLayer();
    } else {
      // ===== 失敗（守備成功）: longpass_fail のカット・タブロー流用（スライディング守備＋止められる攻撃）=====
      var failSpr = _lpFailSprite(failBase, atkColor, defColor);        // 赤→守備色 / 緑→攻撃色
      var sh = 190, sw = sh * (180 / 135), sx = (W - sw) / 2, sy = 202 - sh;
      var footX = sx + sw * 0.72, footY = sy + sh * 0.85;              // スライディングの伸ばした足のつま先＝ボール起点
      var kickP = 0.12, ballSpd = 1320, z2 = 1.0 + Math.min(1, p / 0.5) * 0.06;
      ctx.save(); if (flipFail) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.translate(footX, footY); ctx.scale(z2, z2); ctx.translate(-footX, -footY);
      ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);
      if (failSpr) ctx.drawImage(failSpr, sx, sy, sw, sh);
      if (p < kickP) { _lpBall(ctx, footX, footY, 13, 0); }                                       // つま先で待つ
      else { var bx = footX + ballSpd * (p - kickP); if (bx < W + 22) _lpBall(ctx, bx, footY, 13, (p - kickP) * 70); }   // 足元から水平に弾き出される
      var flashF = (p > kickP - 0.02 && p < kickP + 0.08) ? 1 - Math.abs(p - kickP) / 0.08 : 0;
      if (flashF > 0) burst(footX, footY, flashF * 0.7);
      ctx.restore();
      if (flashF > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (flashF * 0.5) + ')'; ctx.fillRect(0, 0, W, H); }
    }
    hud();
    // ループしない: 尺 P の終わりで停止し、決着コマの絵を残したまま静止する（ドリブル演出と同流儀）。
    //   旧実装の `_r6Manga && canvas.isConnected` は「表示中はずっと回す」＝走りっぱなしの原因だったので外す。
    //   画像ロードが遅れた時だけ、最終フレームを描き切るために回し続ける。
    var _riLoading = _r6Manga && (!_riHoldImg.complete || !_riCutImg.complete);
    if (p < 1 || (!success && failBase && !failBase.complete) || _riLoading) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // 飛び出し=ランナー/タブローとも概ね中央（0.5）。既定 50% と同等だが明示。
  return _csCenterSubject(canvas, 0.5, false);
}

// ============================================================
// ヘディング6コマ（sprite-studio 2026-07-31・キーポーズ式量産ルートの初号機）:
//   ★2026-08-05 本編に配線＝ヘディング競り合いの既定演出。旧「対決割り(縦2分割)」
//   _renderHeaderRiseDuelScene / _renderHeaderScene はフォールバックに降格
//   （MangaRecolor が無い公開版 docs/ では従来どおり旧演出が出る）。
//   素材 img/cutscenes/manga_heading6/f1..f6.png（198x256・全コマ腰=(109,136)・ネイティブ=左へ叩きつける）。
//   踏切→上昇→反り→タメ→スナップ→余韻 を**一回再生**（ループしない）。コマ間隔は非等間隔＝
//   タメ(f4)を長く・スナップ(f5)を一瞬に（CT4定石「タメ2拍→ドン」）。
//   クロスのボールがスナップの瞬間に頭へ届き、叩きつけられて飛ぶ（成功=ゴール方向へ低く/失敗=枠の上へ）。
//   素材は run6 より人物が約15%大きい(asset-qa 2026-07-31)ため立位換算 _HD6_BODY=224 で正規化して
//   画面上の体格を run6/dribble と揃える。MangaRecolor 必須＝無ければ null（呼び出し側でフォールバック）。
// ============================================================
function _renderHeadingAnimScene(sc) {
  if (typeof MangaRecolor === 'undefined' || !MangaRecolor.render) return null;
  var W = 480, H = 216, ground = 190;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var atkColor = (sc.offence && sc.offence.team_color) || '#1f4fd6';
  var success = (sc.result === '成功');
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display');
  var hdP = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var hdName = hdP ? ((typeof getPlayerName === 'function') ? getPlayerName(hdP) : hdP.name) : '';
  var atkTeamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var defP = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[sc.dfsPos]];
  var defName = defP ? ((typeof getPlayerName === 'function') ? getPlayerName(defP) : defP.name) : '';
  var defTeamNm = (typeof getTeamName === 'function' && sc.defence) ? getTeamName(sc.defence) : '';
  var defColor = (sc.defence && sc.defence.team_color) || '#e36b1f';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  // 競り合い化(2026-07-31): 失敗=守備のヘディングクリア成功。「枠の上」演出は廃止
  var label = success ? (en ? 'HEADER!' : 'ヘディング！') : (en ? 'CLEARED!' : 'クリア！');
  var labelCol = success ? '#ffe14a' : '#ff5a3c';

  // 素材の実測定数（tools/slice_anim.py の出力と asset-qa 報告より）
  var _HD6_W = 198, _HD6_H = 256, _HD6_HIPX = 109, _HD6_HIPY = 136, _HD6_BODY = 224;
  var _HD6_HEAD = [[135, 31], [139, 32], [115, 26], [95, 20], [82, 53], [83, 53]];   // 各コマの頭(髪)重心
  var _HD6_DUR = [160, 120, 160, 220, 110, 300];             // タメ(f4)長め・スナップ(f5)一瞬
  var _HD6_SNAP = 660;                                       // f5開始=インパクト時刻(=160+120+160+220)
  var imgs = [];
  for (var _i = 1; _i <= 6; _i++) imgs.push(_loadCutsceneImg('img/cutscenes/manga_heading6/f' + _i + '.png?v=1'));
  var cols = _mangaColors(sc.offence, _mangaFeat(hdP ? (hdP.long_name || hdP.name || '') : '').skin);
  // 守備側（クリア・manga_headingdef4・2026-07-31）: 同じ競り合いに**垂直ジャンプ**で参加（横移動しない）。
  //   素材189x252・全コマ腰=(71,128)・f1接地=腰+116px・f3(クリア)の頭=(130,46)実測。
  //   タイムラインは攻撃と同期＝f3(クリア)がインパクト時刻660msちょうどに出る。
  var _HDF_W = 189, _HDF_H = 252, _HDF_HIPX = 71, _HDF_HIPY = 128, _HDF_BODY = 224;
  var _HDF_HEAD3 = [130, 46];
  var _HDF_DUR = [440, 220, 110, 1];
  var dimgs = [];
  for (var _j = 1; _j <= 4; _j++) dimgs.push(_loadCutsceneImg('img/cutscenes/manga_headingdef4/f' + _j + '.png?v=1'));
  var dcols = _mangaColors(sc.defence, _mangaFeat(defP ? (defP.long_name || defP.name || '') : '').skin);

  var flipH = _csAttackRight(sc);                            // ネイティブ=左攻め → 右攻めなら鏡像
  var s = (182 * CS_FIGURE_SCALE) / _HD6_BODY;               // runPh=182 と同基準＝run6/dribble と同体格
  var hipY0 = ground - 100 * s;                              // f1で足が接地する腰高（f1足元=腰+100px実測）
  var P = 1500;                                              // 尺: アニメ1070ms＋ボールの行方＋静止
  function eo(x) { return 1 - (1 - x) * (1 - x); }
  function burst(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12); ctx.lineTo(x + Math.cos(an) * 48, y + Math.sin(an) * 48); ctx.stroke(); } }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = success ? atkColor : defColor; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = labelCol; ctx.fillText(label, 12, H - 9);
    var nm = success ? (hdName ? (hdName + (atkTeamNm ? (' · ' + atkTeamNm) : '')) : '')
                     : (defName ? ('✕ ' + defName + (defTeamNm ? (' · ' + defTeamNm) : '')) : '');
    if (nm) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(nm, W - 12, H - 10); }
  }

  var T0 = null, started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (T0 === null) { if (!canvas.isConnected) { requestAnimationFrame(frame); return; } T0 = now; }
    var el = now - T0, p = Math.min(1, el / P);
    ctx.clearRect(0, 0, W, H);

    // コマ選択（非等間隔・最後は f6 のまま静止）
    var fi = 0, acc = 0;
    for (var k = 0; k < 6; k++) { acc += _HD6_DUR[k]; if (el < acc) { fi = k; break; } fi = 5; }
    // 前方ドリフト: 助走の勢いでボールへ向かって少し進みながら跳ぶ（2026-07-31 ユーザー指示）。
    //   ネイティブの前方=左。インパクトまでにほぼ使い切り、余韻ではわずかに流れるだけにする。
    //   守備成功時は攻撃がわずかに届かない（ドリフトと跳びを浅くして「競り負け」を見せる）。
    var px = 282 - (success ? 46 : 30) * Math.pow(Math.min(1, el / 900), 0.85);
    // ジャンプ弧: スナップ時刻で頂点になる滑らかな上下（コマ差し替えのポップを消す連続量）
    var rise = (success ? 34 : 26) * s * Math.sin(Math.PI * Math.min(el, 1000) / 1200);
    var hipY = hipY0 - rise;
    var hd = _HD6_HEAD[fi];
    var hx = px + (hd[0] - _HD6_HIPX) * s, hy = hipY + (hd[1] - _HD6_HIPY) * s;   // 頭の画面座標

    // 守備側: 垂直ジャンプ（xは固定）。攻撃成功時はわずかに届かない跳びに落とす。
    var dfi = 0, dacc = 0;
    for (var k2 = 0; k2 < 4; k2++) { dacc += _HDF_DUR[k2]; if (el < dacc) { dfi = k2; break; } dfi = 3; }
    var ds = (182 * CS_FIGURE_SCALE) / _HDF_BODY;
    var dpx = success ? 206 : 196;
    var dHipY0 = ground - 116 * ds;
    var drise = (success ? 26 : 36) * ds * Math.sin(Math.PI * Math.min(el, 1000) / 1200);
    var dHipY = dHipY0 - drise;
    var dhx = dpx + (_HDF_HEAD3[0] - _HDF_HIPX) * ds, dhy = dHipY + (_HDF_HEAD3[1] - _HDF_HIPY) * ds;

    // ボール: 前方（左上）から浮いて届き、インパクト(660ms)で**勝った側の頭**に当たる。
    //   攻撃成功=攻撃の頭→前方へ叩きつけ / 守備成功=守備の頭→高く蹴り返す(クリア)。
    var cxT = success ? hx : dhx, cyT = success ? hy : dhy;
    var br = Math.round(12 * CS_FIGURE_SCALE), bx, by, hit = el >= _HD6_SNAP;
    if (!hit) { var q = Math.max(0, el) / _HD6_SNAP; bx = -26 + (cxT - (-26)) * q; by = 14 + (cyT - 14) * (0.35 * q + 0.65 * q * q) - 24 * Math.sin(q * Math.PI); }
    else { var q2 = Math.min(1, (el - _HD6_SNAP) / 300); if (success) { bx = hx - 470 * eo(q2); by = hy + (ground - 26 - hy) * eo(q2); } else { bx = dhx + 360 * q2; by = dhy - 55 * q2; } }
    // クリアの弾道: 攻撃の叩きつけ(左)と**反対の右**へ強く・やや上へ弾き返す(2026-07-31ユーザー指示)。
    // 接点が画面上端に近い(y≈34)ため「高く」は数十msで見切れる→平たい弾道で220ms可視を確保

    var camOn = (typeof CS_CAM_ENABLED === 'undefined') || CS_CAM_ENABLED;
    var cam = _csCam.mk({ fx: 240, fy: 118 });
    cam.zoom = 1;                                            // ズームなし（インパクトで大きくなる効果は不要=2026-07-31 ユーザー指示）
    if (camOn && hit) _csCam.shake(cam, el - _HD6_SNAP, 180, 3.0);   // インパクトの一瞬の揺れだけ残す
    var beginLayer = function (d) { ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); } _csCam.begin(ctx, cam, camOn ? d : 1); };
    var endLayer = function () { _csCam.end(ctx); ctx.restore(); };

    // 背景: ヘディング競り合い(_renderHeaderScene)と同じ「cover拡大＋42px下げ」＝ピッチ線を画面最下端へ
    //   落として空中の高さを出す（選手の描画位置は動かさない・2026-07-10の競り合いと同手法・カメラ非適用）。
    //   ＋左→右へ少しパン（2026-07-31 ユーザー指示）＝選手の前方ドリフトと同じイージングで背景を逆方向へ
    //   流し「カメラが選手を追っている」動きを出す。cover拡大の左右余白(約93px)の範囲内。
    ctx.save();
    if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.imageSmoothingEnabled = false;
    if (bgImg.complete && bgImg.naturalWidth) { var _bb = 42, _bs = Math.max(W / bgImg.naturalWidth, (H + 2 * _bb) / bgImg.naturalHeight), _bdw = bgImg.naturalWidth * _bs, _bdh = bgImg.naturalHeight * _bs; var _pan = 24 * Math.pow(Math.min(1, el / 900), 0.85); ctx.drawImage(bgImg, (W - _bdw) / 2 + _pan, (H - _bdh) / 2 + _bb, _bdw, _bdh); } else { ctx.drawImage(bgFallback, 0, 0); }
    ctx.restore();

    beginLayer(1);
    ctx.imageSmoothingEnabled = false;
    // 勝った側を後描き（前面）にする: 攻撃成功=攻撃が手前 / 守備成功=守備が手前（2026-07-31ユーザー指定）
    var drawAtk = function () {
      var im = imgs[fi];
      if (!im || !im.complete || !im.naturalWidth) return;
      var key = 'hd6|' + (fi + 1) + '|' + cols.shirt + cols.shorts + cols.socks + cols.accent + cols.skin;
      var dw = _HD6_W * s, dh = _HD6_H * s;
      var spr = _csPixelate(MangaRecolor.render(key, im, cols), key, dw, dh);
      ctx.drawImage(spr, px - _HD6_HIPX * s, hipY - _HD6_HIPY * s, dw, dh);
    };
    var drawDef = function () {
      var dim = dimgs[dfi];
      if (!dim || !dim.complete || !dim.naturalWidth) return;
      var dkey = 'hdf4|' + (dfi + 1) + '|' + dcols.shirt + dcols.shorts + dcols.socks + dcols.accent + dcols.skin;
      var ddw = _HDF_W * ds, ddh = _HDF_H * ds;
      var dspr = _csPixelate(MangaRecolor.render(dkey, dim, dcols), dkey, ddw, ddh);
      ctx.drawImage(dspr, dpx - _HDF_HIPX * ds, dHipY - _HDF_HIPY * ds, ddw, ddh);
    };
    if (success) { drawDef(); drawAtk(); } else { drawAtk(); drawDef(); }
    if (bx > -26 && bx < W + 30) _lpBall(ctx, bx, by, br, el * 0.03);
    if (hit) { var fl = Math.max(0, 1 - (el - _HD6_SNAP) / 170); if (fl > 0) burst(cxT - 6 * s, cyT, fl * 0.8); }
    endLayer();
    if (hit) { var fw = Math.max(0, 1 - (el - _HD6_SNAP) / 140); if (fw > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (fw * 0.45) + ')'; ctx.fillRect(0, 0, W, H); } }
    hud();
    var loading = imgs.some(function (g) { return !g.complete; }) || dimgs.some(function (g) { return !g.complete; });
    if (p < 1 || loading) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return _csCenterSubject(canvas, 0.5, false);
}

// ============================================================
// オーバーヘッドキック5コマ（sprite-studio 2026-07-31・キーポーズ式量産の2本目）:
//   素材 img/cutscenes/manga_overhead5/f1..f5.png（244x268・全コマ腰=(119,147)・ネイティブ=左へ蹴り込む）。
//   踏切→上昇後傾→ハサミ→タメ→頭上へ振り抜き の一回再生（ループしない・6コマ目の余韻は不採用=2026-07-31ユーザー判断）。
//   ボールは**最初から空中に浮いて待っている**（クロス入射でなく浮き球を捉える＝2026-07-31ユーザー指示）。
//   背景はヘディングと同じ「cover拡大＋下げ」だが、開始は浅め(22px)→跳躍に合わせて42pxへ**下へスライド**
//   （=カメラが選手と一緒に上がる感じ・2026-07-31ユーザー指示）。ズームはなし。MangaRecolor必須。
// ============================================================
function _renderOverheadScene(sc) {
  if (typeof MangaRecolor === 'undefined' || !MangaRecolor.render) return null;
  var W = 480, H = 216, ground = 214;   // 全体をさらに下へ(2026-07-31ユーザー指示)・接点の上端見切れ対策と両立
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var atkColor = (sc.offence && sc.offence.team_color) || '#1f4fd6';
  var success = (sc.result === '成功');
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display');
  var ohP = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var ohName = ohP ? ((typeof getPlayerName === 'function') ? getPlayerName(ohP) : ohP.name) : '';
  var atkTeamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = success ? (en ? 'BICYCLE!' : 'オーバーヘッド！') : (en ? 'OVER!' : '枠の上！');
  var labelCol = success ? '#ffe14a' : '#ff5a3c';

  // 素材の実測定数（slice_anim.py 出力: 画布244x268・腰(119,147)・f1接地=腰+114px・f5ブーツ接点(130,14)）
  var _OH5_W = 244, _OH5_H = 268, _OH5_HIPX = 119, _OH5_HIPY = 147, _OH5_BODY = 224;
  var _OH5_DUR = [160, 130, 150, 130, 1];                    // 最終コマはそのまま静止
  var _OH5_STRIKE = 570;                                     // f5開始=インパクト(=160+130+150+130)
  var _OH5_BOOT = [130, 14];                                 // f5の蹴り足ブーツ=ボール接点(素材座標)
  var imgs = [];
  for (var _i = 1; _i <= 5; _i++) imgs.push(_loadCutsceneImg('img/cutscenes/manga_overhead5/f' + _i + '.png?v=1'));
  var cols = _mangaColors(sc.offence, _mangaFeat(ohP ? (ohP.long_name || ohP.name || '') : '').skin);

  var flipH = _csAttackRight(sc);                            // ネイティブ=左攻め → 右攻めなら鏡像
  var s = (182 * CS_FIGURE_SCALE) / _OH5_BODY;               // run6/heading と同体格
  var px = 258;
  var hipY0 = ground - 114 * s;                              // f1で足が接地する腰高
  var P = 1500;
  function eo(x) { return 1 - (1 - x) * (1 - x); }
  function burst(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12); ctx.lineTo(x + Math.cos(an) * 48, y + Math.sin(an) * 48); ctx.stroke(); } }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = atkColor; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = labelCol; ctx.fillText(label, 12, H - 9);
    var nm = ohName ? (ohName + (atkTeamNm ? (' · ' + atkTeamNm) : '')) : '';
    if (nm) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(nm, W - 12, H - 10); }
  }

  var T0 = null, started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (T0 === null) { if (!canvas.isConnected) { requestAnimationFrame(frame); return; } T0 = now; }
    var el = now - T0, p = Math.min(1, el / P);
    ctx.clearRect(0, 0, W, H);

    var fi = 0, acc = 0;
    for (var k = 0; k < 5; k++) { acc += _OH5_DUR[k]; if (el < acc) { fi = k; break; } fi = 4; }
    // 跳躍弧: ストライクで頂点。以降は保持（余韻カットなので落下は描かない）
    var rise = 34 * s * Math.sin(Math.PI * Math.min(el, 900) / 1400);
    var hipY = hipY0 - rise;

    // ボール: 下からゆっくり浮き上がって接点へ（選手と一緒に上がる＝浮遊感・2026-07-31ユーザー指示）
    //   → ストライクで**左から右へ画面と平行**に飛ぶ（成功=水平・失敗=枠の上へ抜ける）
    var riseAtStrike = 34 * s * Math.sin(Math.PI * Math.min(_OH5_STRIKE, 900) / 1400);
    var cxs = px + (_OH5_BOOT[0] - _OH5_HIPX) * s;                       // 接点(ストライク時)
    var cys = (hipY0 - riseAtStrike) + (_OH5_BOOT[1] - _OH5_HIPY) * s;
    var br = Math.round(12 * CS_FIGURE_SCALE), bx, by, hit = el >= _OH5_STRIKE;
    if (!hit) { var qf = _csCam.smooth(Math.min(1, el / _OH5_STRIKE)); bx = cxs; by = cys + 34 * (1 - qf) + 2.5 * Math.sin(el / 170); }
    else { var q2 = Math.min(1, (el - _OH5_STRIKE) / 300); bx = cxs + 470 * eo(q2); by = success ? cys : (cys - 120 * eo(q2)); }

    var camOn = (typeof CS_CAM_ENABLED === 'undefined') || CS_CAM_ENABLED;
    var cam = _csCam.mk({ fx: 240, fy: 112 });
    cam.zoom = 1;                                            // ズームなし（ヘディングと同じ方針）
    if (camOn && hit) _csCam.shake(cam, el - _OH5_STRIKE, 180, 3.0);
    var beginLayer = function (d) { ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); } _csCam.begin(ctx, cam, camOn ? d : 1); };
    var endLayer = function () { _csCam.end(ctx); ctx.restore(); };

    // 背景: cover拡大＋下げはヘディングと同じ流儀。開始22px→跳躍に合わせて42pxへ下へスライド
    //   （終端はヘディングシーンと同じ高さ＝ピッチ線が画面最下端）。カメラ非適用。
    ctx.save();
    if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.imageSmoothingEnabled = false;
    if (bgImg.complete && bgImg.naturalWidth) { var _bb = 42, _bs = Math.max(W / bgImg.naturalWidth, (H + 2 * _bb) / bgImg.naturalHeight), _bdw = bgImg.naturalWidth * _bs, _bdh = bgImg.naturalHeight * _bs; var _sh = 22 + 20 * _csCam.smooth(Math.min(1, el / 600)); ctx.drawImage(bgImg, (W - _bdw) / 2, (H - _bdh) / 2 + _sh, _bdw, _bdh); } else { ctx.drawImage(bgFallback, 0, 0); }
    ctx.restore();

    beginLayer(1);
    ctx.imageSmoothingEnabled = false;
    var im = imgs[fi];
    if (im && im.complete && im.naturalWidth) {
      var key = 'oh5|' + (fi + 1) + '|' + cols.shirt + cols.shorts + cols.socks + cols.accent + cols.skin;
      var dw = _OH5_W * s, dh = _OH5_H * s;
      var spr = _csPixelate(MangaRecolor.render(key, im, cols), key, dw, dh);
      ctx.drawImage(spr, px - _OH5_HIPX * s, hipY - _OH5_HIPY * s, dw, dh);
    }
    if (bx > -26 && bx < W + 30) _lpBall(ctx, bx, by, br, hit ? el * 0.05 : el * 0.008);
    if (hit) { var fl = Math.max(0, 1 - (el - _OH5_STRIKE) / 170); if (fl > 0) burst(cxs, cys, fl * 0.8); }
    endLayer();
    if (hit) { var fw = Math.max(0, 1 - (el - _OH5_STRIKE) / 140); if (fw > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (fw * 0.45) + ')'; ctx.fillRect(0, 0, W, H); } }
    hud();
    var loading = imgs.some(function (g) { return !g.complete; });
    if (p < 1 || loading) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return _csCenterSubject(canvas, 0.5, false);
}

// ============================================================
// GK専用カットイン（シュートとは別カット）: 専用の緑ピッチ背景＋ダイブするGK（左→右へ少しスライド）＋
//   右上から来るボール。mode='save'=手元で弾く / 'beat'=指先を抜ける（後でゴール/枠外へ）。GK色は自動コントラスト。
//   1回再生で静止（ループしない）。detach で停止。
// ============================================================
var _GK_BG_SRC = 'img/cutscenes/gkbg_01.png';
var _GK_DIVE2_BG_SRC = 'img/cutscenes/gkdive2_bg_01.png';   // pose1（水平ダイブ）専用のゴール裏フィールド背景（2026-07-24）
function _renderGkScene(sc, mode) {
  var W = 480, H = 216;
  var canvas = document.createElement('canvas');
  // マンガ絵経路のみ内部2倍＋スムージング（NN縮小ジャギ対策 2026-07-15）。従来ドット絵経路（公開ビルド）は等倍＋pixelated維持。
  var SS = 1;   // 等倍＋NNへ復帰（レトロ画素感 2026-07-15）。粗ドット化は _csPixelate 前段の高品質縮小が担う
  canvas.width = W * SS; canvas.height = H * SS;
  canvas.style.cssText = 'display:block;width:100%' + (SS > 1 ? '' : ';image-rendering:pixelated');
  var ctx = canvas.getContext('2d');
  if (SS > 1) ctx.scale(SS, SS);
  var bgImg = _loadCutsceneImg(_GK_BG_SRC), bgFallback = _lpBg();
  var atkColor = (sc.offence && sc.offence.team_color) || '#1f4fd6';
  var defColor = (sc.defence && sc.defence.team_color);
  var gkColor = _pickGkColor(atkColor, defColor);
  var gkP0 = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[0]];
  var _gkManga = (typeof MangaRecolor !== 'undefined' && MangaRecolor.render);   // GKスプライトは新素材（従来演出の上に描く・2026-07-15）
  var _gkCols = _gkManga ? _gkDiveColors(gkColor, _mangaFeat(gkP0 ? (gkP0.long_name || gkP0.name || '') : '').skin) : null;
  var _dive = _gkManga ? _pickGkDive() : _GK_DIVES[0];   // マンガGK時のみランダム別ポーズ
  var _gkKey = _gkManga ? ('gkdive|' + _dive.id + '|' + gkColor + '|' + _gkCols.skin) : null;   // ポーズ別キー（共通キーだと先勝ちの絵が焼き付く）
  var gkImg = _gkManga ? _loadCutsceneImg(_dive.src) : _loadCutsceneImg('img/cutscenes/gk_' + gkColor + '_01.png');
  if (_gkManga && _dive.bg) bgImg = _loadCutsceneImg(_dive.bg);   // pose1は専用背景（ゴール裏フィールド）に差し替え
  var accent = defColor || '#e36b1f';                          // GK=守備側 → 守備色をアクセントに

  var gs = (typeof gameState !== 'undefined' && gameState) ? gameState : {};
  var t1 = gs.team1, t2 = gs.team2;
  var c1 = (t1 && t1.team_color) || '#1f4fd6', c2 = (t2 && t2.team_color) || '#e36b1f';
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display'), s1 = dom('score1'), s2 = dom('score2');
  var gkP = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[0]];   // GK=守備のpos0
  var gkName = gkP ? ((typeof getPlayerName === 'function') ? getPlayerName(gkP) : gkP.name) : '';
  var defTeamNm = (typeof getTeamName === 'function' && sc.defence) ? getTeamName(sc.defence) : '';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var save = (mode === 'save');
  var dive = (mode === 'dive');   // 結果非開示の「跳んだ！」サスペンス（ゴール/枠外/セーブ共通＝まだ分からない）
  var label = save ? (en ? 'GK SAVE!' : 'ナイスセーブ！') : dive ? (en ? 'DIVE—!' : 'ダイブ——！') : (en ? 'BEATEN' : '抜かれた…');
  var labelCol = (save || dive) ? '#ffe14a' : '#ff5a3c';

  function speedLines(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 14, y + Math.sin(an) * 14); ctx.lineTo(x + Math.cos(an) * 60, y + Math.sin(an) * 60); ctx.stroke(); } }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;   // 焼き込みラベル停止（時刻/アクション名/選手名はHUD・ネーム枠へ集約）
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    // ミニスコア（色チップ＋略称＋スコア）はスコアボードへ集約のため非表示。時間(左上)とラベル/選手名は残す。
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = labelCol; ctx.fillText(label, 12, H - 9);
    if (gkName) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(gkName + (defTeamNm ? (' · ' + defTeamNm) : ''), W - 12, H - 10); }
  }

  // ジオメトリ（2枚目の配置参考・TUNE）: GKは大きめ・中央やや左、左→右へスライドしながらダイブ
  var gkW = (_gkManga ? 205 * _dive.ws : 300) * CS_FIGURE_SCALE, gkH = gkW * (_gkManga ? _dive.hw : (127 / 220)), gkX0 = 8, gkX1 = 92;   // 2/3縮小(2026-07-23)   // 左→右へ移動。スプライト別にアスペクト＆幅を切替＝描画高≈171/173で従来と同じ距離感（近すぎ修正 2026-07-15）
  /* ★ 2026-07-30 決着コマを最大にする（ユーザー指定4項目の4つめ）。
   *   実測で判明した問題: この関数は拍2(dive=結果非開示の溜め)と拍3(save/抜かれ=決着)を
   *   **mode だけ変えて同じ経路で描いていた**ので、決着の主語サイズ129px・尺1300ms・ボール16pxが
   *   溜めと**1ドット/1msも違わなかった**。しかも拍1のシューター(148px=68.5%)より小さかった＝指定と逆。
   *   参考漫画の決着はページの70〜80%を占める最大のコマなので、拍3だけを持ち上げる。
   *   面積は全ビートがフルフレームで使えないため、レバーは「寄り・尺・ボール」の3つ（[[art-one-shot-one-subject]] ③）。
   *   ★ 拍2は据え置き＝拍2→拍3に落差が生まれることが狙い。 */
  var isResult = !dive;                                        // save / 抜かれた ＝ 決着ビート
  var _resZoom = 1;
  if (isResult) {
    _resZoom = Math.min(1.55, (H * 0.87) / gkH);               // 目標=画面高87%。上限1.55は横長pose1の幅暴走を抑えるため
    gkW *= _resZoom; gkH *= _resZoom;
  }
  if (_dive.sc3Rev) { gkX0 = 92; gkX1 = 8; }   // pose1: スライド方向を反転（反転絵に追従＝画面上の移動をpose0と逆向きに・2026-07-24 ユーザー要望）
  var gkY0 = _dive.rise ? 64 : 39, gkY1 = _dive.rise ? 14 : 39;   // rise=true: 下→上の対角（pose0）。rise=false: 縦移動なしの水平（pose1）。中点≈39で従来相当
  if (_dive.sc3) { var _s3 = (typeof window !== 'undefined' && window._LAB_SC3) || _dive.sc3; gkX0 = _s3.x0; gkX1 = _s3.x1; gkY0 = gkY1 = _s3.y; }   // pose1: ゴールライン上・少し前の配置を明示（unflipped座標・2026-07-24 ユーザー要望。_LAB_SC3=ラボ限定の実行時上書き）
  var handsFx = _gkManga ? _dive.gx : 0.85, handsFy = _gkManga ? _dive.gy : 0.13;                          // GKの手元（reaching glove アンカー・絵別）
  /* 決着で絵を1.45〜1.55倍にすると手元(=主語・ボールの通過点)が画面外へ出る絵がある
   *   （pose1は handsFy=0.82 で hY=221 > H=216 になり、ボールとの接触が画面外で起きてしまう）。
   *   脚が見切れるのは層Cの定義どおり構わないが、**手元だけは画面内に残す**のでyをクランプする。 */
  if (isResult) {
    var _fixY = function (y) {
      var h = y + gkH * handsFy;
      if (h > H - 30) y -= (h - (H - 30));
      if (y + gkH * handsFy < 30) y += (30 - (y + gkH * handsFy));
      return Math.round(y);
    };
    gkY0 = _fixY(gkY0); gkY1 = _fixY(gkY1);
  }
  //   尺: 決着 1300→1900ms（ゴール2200・枠外1700と整合。旧1300は全ビート中で最短だった）
  var ballSpd = 2400, ballStartP = 0.20, slope = 0.16, P = isResult ? 1900 : 1300;   // ボールは右→左・シュートシーンと同速（同じpx/ms）。拍2は従来どおり短く速いダイブ（2026-07-23 ユーザー要望）
  var zc = [240, 116];                                         // ズーム中心（固定でジッター防止）
  var flipH = _csAttackRight(sc);                              // ネイティブ=左攻め(右→左シュート) → team1(右)で反転

  /* ── GK-MOTION-01（2026-08-06）: ポーズを変えずに「動き」を出す層 ─────────────
   *   問題: GKは1枚絵を gkX0→gkX1 / gkY0→gkY1 へ**平行移動しているだけ**だった。
   *     剛体のまま滑るので「絵が動いている」であって「跳んでいる」に見えない。
   *   方針: 動きは**被写体の身体から出す**。光芒・リングのような「絵に物を足すFX」は使わない
   *     （2026-07-29 にユーザーがゴール/失点から不採用にした方向＝ここでも踏襲）。
   *   道具は2つとも既存:
   *     ① _csCam.puppet = CAM-01の人形芝居。**手足は描き直さず**軸まわりの傾き(lean)と
   *        伸縮(stretch)だけ掛ける。ダイブ軸に沿って伸びるので「伸び上がって跳ぶ」が出る。
   *     ② 残像 = 同じスプライトを数十ms前の位置へ薄く重ねる。recolor済みキャッシュを
   *        使い回すので追加コストはほぼゼロ。
   *   ★ マンガGK（_gkManga=lab限定）のときだけ有効＝公開ビルド docs/ の挙動は不変。
   *   キルスイッチ: window.GK_MOTION_ENABLED === false で完全OFF（ラボのA/B用）。 */
  var _gkMotion = _gkManga && ((typeof window === 'undefined') || window.GK_MOTION_ENABLED !== false);
  var _mvDirX = (gkX1 >= gkX0) ? 1 : -1;                       // 画面内の進行方向（flip前のローカル座標）
  function _gkMpAt(pp) { var m = Math.min(1, Math.max(0, pp) / 0.55); return 1 - (1 - m) * (1 - m); }   // frame内の mp と同式
  function _gkPosAt(pp) { var m = _gkMpAt(pp); return { x: gkX0 + (gkX1 - gkX0) * m, y: gkY0 + (gkY1 - gkY0) * m }; }
  /* 効き具合。ラボから window.GK_LEAN / GK_STRETCH / GK_GHOST で実行時に上書きできる（本番は未定義＝既定値）。 */
  function _gkTune(k, dflt) { var v = (typeof window !== 'undefined') ? window[k] : undefined; return (typeof v === 'number') ? v : dflt; }
  var GK_LEAN = _gkTune('GK_LEAN', 0.085);        // 最大の傾き(rad)。0.085≈4.9°＝ポーズは変えず輪郭だけ動く量
  var GK_STRETCH = _gkTune('GK_STRETCH', 0.055);  // ダイブ軸方向の伸び（縦の潰し率）
  /* ★ 残像は拍2（dive=結果非開示の跳躍）だけ。拍3（ナイスセーブ／抜かれた＝決着）には出さない。
   *   決着は「効果を全部剥がした大きなコマ」が正解（QUIET-01・3作品共通の文法）で、
   *   そこに残像を足すと逆走する。決着では傾きの収束だけが残る。 */
  var GK_GHOST = dive ? _gkTune('GK_GHOST', 0.20) : 0;

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    var z = 1.0 + Math.min(1, p / 0.6) * 0.06;
    var mp = Math.min(1, p / 0.55); mp = 1 - (1 - mp) * (1 - mp);   // 移動progress: 前半で一気に跳ぶイーズアウト＝ダイブが素早く見える（接触p≈0.52時点でほぼ到達）
    var slide = gkX0 + (gkX1 - gkX0) * mp;                    // 左→右へ移動（ボールが画面外に出るまで）
    var gkY = gkY0 + (gkY1 - gkY0) * mp;                      // 下→上へ移動＝対角ダイブ（ボール手元hYも追従）
    /* 人形芝居のパラメータ（GK-MOTION-01）。★ 手元アンカーより先に出す＝下で同じ変換を掛けるため。
     *   接触時刻ちょうどが lean 最大なので、素の hX/hY のままだとボールが**回した手から最大9pxずれる**。 */
    var _burst = _csCam.clamp01(p / 0.30), _settle = _csCam.clamp01((p - 0.55) / 0.45);
    var _lean = _gkMotion ? (_mvDirX * GK_LEAN * _burst * (1 - _settle * 0.8)) : 0;
    var _stretch = _gkMotion ? (1 - GK_STRETCH * Math.sin(_csCam.clamp01(p / 0.5) * Math.PI)) : 1;
    var hX = slide + gkW * handsFx, hY = gkY + gkH * handsFy;  // GKの手元（ボール通過点）
    if (_gkMotion && (_lean || _stretch !== 1)) {
      // puppet と同じ変換（軸=絵の中心 → scale → rotate）を手元アンカーにも掛ける＝ボールが必ず手に付く
      var _pvx = slide + gkW * 0.5, _pvy = gkY + gkH * 0.5;
      var _sx = 1 + (1 - _stretch) * 0.7, _sy = _stretch;
      var _dx = (hX - _pvx) * _sx, _dy = (hY - _pvy) * _sy;
      var _cs = Math.cos(_lean), _sn = Math.sin(_lean);
      hX = _pvx + _dx * _cs - _dy * _sn;
      hY = _pvy + _dx * _sn + _dy * _cs;
    }
    var contactP = ballStartP + (W - hX) / ballSpd;           // bx==hX（手元到達）になる p
    // ボール位置と画面内判定
    var bx = null, by = null, onScreen = false;
    if (p >= ballStartP) {
      if (dive) {
        bx = W - ballSpd * (p - ballStartP);                  // 右→左へ飛来
        if (sc.result === 'GK防いだ！') {                      // セーブ: 手元で静止（届くか！？）
          if (bx < hX) bx = hX;
          by = hY;
        } else {                                              // 抜かれ（ゴール/枠外）: 手をすり抜けて“まっすぐ”飛び、止まらずそのまま画面外（ゴール方向）へ消える
          by = hY;                                            // GKの手の高さを水平に直進（まっすぐ＝弧を描かない）。bxはクランプせず流す＝端まで行って消える
        }
        onScreen = (bx > -16);
      } else {
        bx = W - ballSpd * (p - ballStartP);                  // 右端→左へ（シュートと同速）
        by = (save && bx < hX) ? hY - (hX - bx) * 0.55 : hY + slope * (hX - bx);   // セーブ=手元で左上へ弾く / それ以外=直進
        onScreen = (bx > -16 && by > -16 && by < H + 16);
      }
    }
    var ballGone = !dive && (p > ballStartP + 0.03) && !onScreen;   // dive はボールを手元で凍結＝終了させない
    var drawGKAt = function (x, y, alpha) {
      if (!gkImg.complete || !gkImg.naturalWidth) return;
      var _s = _gkManga ? MangaRecolor.render(_gkKey, gkImg, _gkCols) : gkImg;
      if (_s && _gkManga) _s = _csPixelate(_s, _gkKey, gkW, gkH);
      if (!_s) return;
      if (alpha != null) { ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(_s, x, y, gkW, gkH); ctx.restore(); }
      else ctx.drawImage(_s, x, y, gkW, gkH);
    };
    var drawGK = function () {
      if (!_gkMotion) { drawGKAt(slide, gkY); return; }
      // ① 残像: 跳び出しの速い区間だけ、数十ms前の位置に薄く重ねる（接触以降は出さない＝決着を濁さない）
      //    ★ 立ち上がりでフェードインさせる＝p<0.055 では2枚とも開始位置に重なるので、
      //      いきなり最大濃度だと「二重写しのバグ」に見える。
      var _gv = Math.min(p / 0.09, 1 - _csCam.clamp01((p - 0.08) / 0.34));
      if (GK_GHOST > 0 && _gv > 0.02) {
        var _g2 = _gkPosAt(p - 0.105), _g1 = _gkPosAt(p - 0.055);
        drawGKAt(_g2.x, _g2.y, GK_GHOST * 0.5 * _gv);
        drawGKAt(_g1.x, _g1.y, GK_GHOST * _gv);
      }
      // ② 人形芝居: 踏切で進行方向へ倒し、飛翔中はダイブ軸に沿って伸び、決着へ向けて収束する
      //    （_lean / _stretch は手元アンカーと共有するため frame 冒頭で算出済み）
      _csCam.puppet(ctx, slide + gkW * 0.5, gkY + gkH * 0.5, _lean, _stretch, function () { drawGKAt(slide, gkY); });
    };
    /* ボールも絵と同じ倍率で拡大する（決着はr≈12）。★ 固定の大きな値にしないのが要点＝
     *   GKだけ1.45倍でボールが据え置きだと縮尺が壊れる。参考漫画の決着は「ボールがどこにあるか」で
     *   結果を語っているので、主語と同じ縮尺で大きくなるのが正しい。 */
    var drawBall = function () { if (onScreen) _lpBall(ctx, bx, by, Math.round(8 * _resZoom), (p - ballStartP) * 120); };
    ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.translate(zc[0], zc[1]); ctx.scale(z, z); ctx.translate(-zc[0], -zc[1]);
    ctx.imageSmoothingEnabled = SS > 1; _lpDrawBg(ctx, bgImg, bgFallback, W, H);   // マンガ絵=スムージング / ドット絵=NN維持（2026-07-15）
    if (save || dive) { drawGK(); drawBall(); } else { drawBall(); drawGK(); }   // 抜けはボールをGKの背後（先に描画）に
    var handsContact = save || (dive && sc.result === 'GK防いだ！');   // 手元で実際にボールに触れる時だけインパクト（抜かれ＝すり抜けは発光なし）
    var ct = (handsContact && p > contactP - 0.02 && p < contactP + 0.09) ? 1 - Math.abs(p - contactP) / 0.09 : 0;
    if (ct > 0) speedLines(hX, hY, ct * 0.7);                  // セーブ・インパクト
    ctx.restore();
    if (ct > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (ct * 0.4) + ')'; ctx.fillRect(0, 0, W, H); }
    hud();
    if (!ballGone && p < 1) requestAnimationFrame(frame);     // ボールが消えたらGK停止＝アニメ終了（静止）
  }
  requestAnimationFrame(frame);
  // GK は gkX 8→92・幅300＝中心 ~0.42（やや左）。flipH 込みで主役(GK)を可視窓中央へ。
  return _csCenterSubject(canvas, (gkX0 + gkW / 2 + (gkX1 - gkX0) / 2) / W, flipH);
}

// ============================================================
// ゴール専用カットイン（得点）: 差し替え画像 goalnet_01.png（ネットに刺さったボール）を土台に、
//   着弾インパクト（白フラッシュ＋画像の揺れ＝ネット揺れ＋ズームパンチ）＋紙吹雪＋"ゴール！！"＋得点者名を重ねる。
//   ボールは画像内にあるのでコード描画は不要＝全チーム共通の1枚（色はHUD/紙吹雪で）。1回再生で静止。
//   ※ シュートからの得点は renderSceneArt がこれをインライン表示し、showGoalCutscene 側の takeover は抑止する。
// ============================================================
var _GOAL_BG_SRC = 'img/cutscenes/goalnet_01.png';
/* ════════════════════════════════════════════════════════════════════════════
 * QUIET-01 : 「間（ま）」のビート（2026-07-29・lab限定）
 *
 * 3作品（GIANT KILLING / キャプテン翼 / 蒼く染めろ）に共通していた文法:
 *   **決着の直後に、効果を全部剥がした大きなコマが来る。**
 *   蒼く染めろ IMG_5889 が決定的だった＝ページの75%を占める大コマに、
 *   集中線ゼロ・描き文字ゼロ・セリフゼロ。ネットのテクスチャと人物だけ。
 *   → **静けさが最大のコマ。効果を足すのではなく、全部剥がして決着を見せている。**
 *
 * 現行の football-sim はクライマックスに FX を乗せて**そこで終わっている**。
 * その後ろにこの1拍を足す。★新規アセットは要らない（既存の goalnet_01 と WIDE-01 で足りる）。
 *
 * ここで守ること（＝この演出の全て）:
 *   ・集中線を描かない ・描き文字を描かない ・_csFx を一切呼ばない
 *   ・焼き込みラベルを出さない ・カメラを動かさない（寄りも揺れも無し）
 * 唯一入れるのは、直前の着弾フラッシュから**明るさが落ち着いてくる**フェードだけ。
 * ★ 完全静止はゲームでは「固まった」に見えるので、1px以下のごく僅かな呼吸だけ残す。
 * ══════════════════════════════════════════════════════════════════════════ */
var QUIET_BEAT_MS = 1250;                 // 尺。ここは長めでよい（間が主役なので）
function _renderQuietBeatScene(sc, kind) {
  if (typeof document === 'undefined') return null;
  var W = 480, H = 216;

  /* 外した / 失点 → **空いたピッチの引き画**（ジャイキリ流の「間」）。
   *   WIDE-01 をそのまま使う。★ area:false でエリア強調リングを消す＝完全に静かな画にする。 */
  if ((kind === 'miss' || kind === 'concede') &&
      typeof WideShot !== 'undefined' && WideShot.forScene &&
      typeof gameState !== 'undefined' && gameState) {
    var wide = null;
    try {
      wide = WideShot.forScene(sc, gameState,
        (typeof AREA_COORDS_H !== 'undefined') ? AREA_COORDS_H : null,
        { area: false });          // ★ エリア強調リングを消す＝効果ゼロにする
    } catch (e) { wide = null; }
    if (wide) return wide;
  }

  // ゴール → ネットに収まったボールの静止画。ラベルもFXも乗せない。
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var src = (kind === 'goal') ? _GOAL_BG_SRC
          : (kind === 'miss') ? 'img/cutscenes/missgoal_01.png'
          : _LP_BG_SRC;
  var img = _loadCutsceneImg(src), fallback = _lpBg();
  var flipH = _csAttackRight(sc);

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    requestAnimationFrame(frame);
    var el = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - T0;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.imageSmoothingEnabled = false;
    // ★ ごく僅かな呼吸だけ（±0.5px）。寄りではない＝カメラは動かさない。
    ctx.translate(0, Math.sin(el / 900) * 0.5);
    if (img && img.complete && img.naturalWidth) {
      var s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      var dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      ctx.drawImage(fallback, 0, 0);
    }
    ctx.restore();

    // 直前の着弾フラッシュから明るさが落ち着いてくる（これだけが唯一の「効果」）
    if (el < 260) {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.45 * (1 - el / 260)).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    // ★ HUD・ラベル・集中線・描き文字・_csFx は一切描かない。ここが演出の本体。
  }
  frame();
  return canvas;
}

function _renderGoalScene(sc) {
  var W = 480, H = 216;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  // 画面いっぱいの中央大ラベル「GOAL!!」を焼くので cover だと左右が欠ける → contain へ上書き（cs-fullframe）。
  canvas.className = 'cs-fullframe';
  var ctx = canvas.getContext('2d');
  var bgImg = _loadCutsceneImg(_GOAL_BG_SRC), bgFallback = _lpBg();   // 差し替えゴール画像（ネットに刺さったボール）
  var accent = (sc.offence && sc.offence.team_color) || '#1f4fd6';   // 得点＝攻撃側色

  var gs = (typeof gameState !== 'undefined' && gameState) ? gameState : {};
  var t1 = gs.team1, t2 = gs.team2;
  var c1 = (t1 && t1.team_color) || '#1f4fd6', c2 = (t2 && t2.team_color) || '#e36b1f';
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display'), s1 = dom('score1'), s2 = dom('score2');
  var scorerP = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var scorerName = scorerP ? ((typeof getPlayerName === 'function') ? getPlayerName(scorerP) : scorerP.name) : '';
  var teamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var P = 2200;
  var flipH = _csAttackRight(sc);                     // ネイティブ=左攻め(ゴール左) → team1(右)で反転（他シーンと統一）
  // ── 共通FXレイヤー（_csFx 2026-07-28）──
  //   自チームゴール= grade('burst')（彩度スパイク→減衰）/ 失点= grade('drain')＋赤ビネット。
  //   着弾リング＋光芒スイープ＋観客フラッシュ（失点時は光芒/フラッシュを抑制＝喜ばない画面）。
  var fxConcede = _csFxConcede(sc);
  _csFx.grade(canvas, fxConcede ? 'drain' : 'burst');

  function easeOutBack(t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function bigGoal(p) {                                // 画面中央に大きく "GOAL!!"（ポップイン→静止）
    var gp = Math.min(1, p / 0.24), ts = 0.5 + 0.5 * easeOutBack(gp);
    ctx.save(); ctx.translate(W / 2, H / 2 - 2); ctx.scale(ts, ts);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 62px "Arial Black",sans-serif'; ctx.lineJoin = 'round';
    ctx.lineWidth = 11; ctx.strokeStyle = '#0c0a14'; ctx.strokeText('GOAL!!', 0, 0);
    var tg = ctx.createLinearGradient(0, -30, 0, 32); tg.addColorStop(0, '#fff7c8'); tg.addColorStop(0.5, '#ffd23a'); tg.addColorStop(1, '#ff9d1b');
    ctx.fillStyle = tg; ctx.fillText('GOAL!!', 0, 0);
    ctx.restore();
  }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;   // 焼き込みラベル停止（時刻/アクション名/選手名はHUD・ネーム枠へ集約）
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    // ミニスコア（色チップ＋略称＋スコア）はスコアボードへ集約のため非表示。時間(左上)とラベル/選手名は残す。
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    if (scorerName) { ctx.textAlign = 'right'; ctx.font = '800 13px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(scorerName + (teamNm ? (' · ' + teamNm) : ''), W - 12, H - 9); }
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    var imp = Math.max(0, 1 - p / 0.20);               // 着弾インパクト（開始が最大→p=0.20で消える）
    var shake = Math.sin(p * 90) * 6 * imp;            // 画像をブルッと揺らす＝ネット揺れ
    var z = 1.05 + imp * 0.06;                         // 着弾でズーム→落ち着く（常時>1で揺れの隙間を隠す）
    var fl = imp * 0.9;                                // 白フラッシュ
    ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
    ctx.translate(shake, shake * 0.5);
    ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    ctx.restore();
    if (fl > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (fl * 0.4) + ')'; ctx.fillRect(0, 0, W, H); }
    // ── 共通FXレイヤー ──
    //   ★ 着弾リング／光芒／観客フラッシュは不採用（2026-07-28 ユーザー判断）。絵に物を足す方向のFXは載せない。
    //     残すのは彩度グレード（burst/drain）と失点の赤ビネット＝**絵そのものの見え方**を変える層だけ。
    //   punch相当のズーム/シェイクは既存の z/shake が担当（重複させない）。
    var endK = p < 0.86 ? 1 : Math.max(0, (1 - p) / 0.14);
    if (fxConcede) _csFx.vignette(ctx, W, H, Math.min(1, p / 0.15) * 0.5 * (p < 0.7 ? 1 : Math.max(0, (1 - p) / 0.3)), '#d81830');   // grade('drain')の復帰カーブに同期して晴れる
    hud();
    bigGoal(p);                                          // 画面中央の大「GOAL!!」（ポップ）
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return canvas;
}

// ============================================================
// 枠外（オフターゲット）専用カット: 差し替え画像 missgoal_01.png（空ゴール）を土台に、
//   ボールがゴールマウスの前を左→右に高速で横切る（＝枠外）＋"枠外！"。ボールが画面外に出たら静止。
// ============================================================
var _MISS_BG_SRC = 'img/cutscenes/missgoal_01.png';
function _renderMissScene(sc) {
  var W = 480, H = 216;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var bgImg = _loadCutsceneImg(_MISS_BG_SRC), bgFallback = _lpBg();   // 差し替え空ゴール画像
  var accent = (sc.offence && sc.offence.team_color) || '#1f4fd6';

  var gs = (typeof gameState !== 'undefined' && gameState) ? gameState : {};
  var t1 = gs.team1, t2 = gs.team2;
  var c1 = (t1 && t1.team_color) || '#1f4fd6', c2 = (t2 && t2.team_color) || '#e36b1f';
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display'), s1 = dom('score1'), s2 = dom('score2');
  var shooterP = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var shooterName = shooterP ? ((typeof getPlayerName === 'function') ? getPlayerName(shooterP) : shooterP.name) : '';
  var teamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = en ? 'OFF TARGET' : '枠外！';

  // ボールはゴールマウスの前を左→右に横切る（TUNE）
  /* ★ 2026-07-30 決着コマを最大に（4項目の4つめ）。枠外は人物を描かず**ボールが唯一の主語**なのに
   *   直径26px＝画面高の12%しかなかった。参考漫画の決着はボールが画面を大きく占めて結果を語るので、
   *   直径56px＝**25.9%**へ。ここは主語そのものなので拡大の根拠が最も強い。 */
  var bY = 120, bR = 28, startX = -30, endX = W + 30;
  var ballSpd = 2400, P = 1700;                       // シュートと同速（2400px / 1700ms）
  // 枠外だけネイティブのボールが左→右で、他のシュート系(GKダイブ/シュート=右→左)と逆だった。
  // flipHを反転して「ゴールの向き＋ボール軌道」をまとめて反転し、シュート方向と一致させる。
  var flipH = !_csAttackRight(sc);

  function trail(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 46, y); ctx.stroke(); ctx.lineCap = 'butt'; }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;   // 焼き込みラベル停止（時刻/アクション名/選手名はHUD・ネーム枠へ集約）
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    // ミニスコア（色チップ＋略称＋スコア）はスコアボードへ集約のため非表示。時間(左上)とラベル/選手名は残す。
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = '#ffd24a'; ctx.fillText(label, 12, H - 9);
    if (shooterName) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(shooterName + (teamNm ? (' · ' + teamNm) : ''), W - 12, H - 10); }
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    var bx = startX + ballSpd * p;                       // 左→右（シュートと同速）
    var cross = (bx - startX) / (endX - startX);         // 横断の進捗 0..1
    var by = bY - Math.sin(Math.min(1, cross) * Math.PI) * 7; // ごく浅いアーチ
    var onScreen = (bx > -28 && bx < W + 28);
    var ballGone = (p > 0.02) && bx >= W + 28;           // 右端を抜けたら終了＝静止
    ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    if (onScreen) { trail(bx, by, 0.55); _lpBall(ctx, bx, by, bR, cross * 30); }   // ボールはマウスの前（ネットの手前）
    ctx.restore();
    hud();
    // 背景(missgoal 274KB)が未ロードのうちは、ボール横断後(=静止)でも再描画を続け、ロード完了フレームで実画像へ差し替える。
    //   未ロードのまま rAF を止めると _lpBg() フォールバック(空・観客席ノイズ・芝)で固まるため（546/1242行と同じ保険）。
    var _bgLoading = !!(bgImg && !bgImg.complete);
    if ((!ballGone && p < 1) || _bgLoading) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return canvas;
}

// ============================================================
// ヘディングシュート（競り合い）専用カット: AI生成の空中ヘディング2人絵を赤→攻撃色 / 緑→守備色に
//   実行時recolor（※既存タブローと逆マップ）。2フレーム＝ frame A(rise:跳び上がり) → frame B(clash:接触)。
//   接触の瞬間にボールを頭から「成功＝攻撃方向／失敗＝逆方向」へ弾き出す＋インパクト。
//   スプライトは対称なので向きはボール方向で表現（team2=左攻めは ballDir を反転）。
// ============================================================
var _HEADER_SRC = 'img/cutscenes/header_clash_t_01.png?v=h2';      // frame B: 競り合い（接触）
var _HEADER_RISE_SRC = 'img/cutscenes/header_rise_t_01.png?v=h2';  // frame A: 跳び上がり（接触前）
var _headerCache = {};
function _headerRecolor(base, atkColor, defColor, srcId) {
  if (!base || !base.complete || !base.naturalWidth) return null;
  var atkKit = _colorBucket(atkColor) || 'red';    // 赤キット → 攻撃色
  var defKit = _colorBucket(defColor) || 'green';  // 緑キット → 守備色
  var key = (srcId || '') + '|' + atkKit + '|' + defKit;
  if (_headerCache[key]) return _headerCache[key];
  var w = base.naturalWidth, hgt = base.naturalHeight;
  var cv = document.createElement('canvas'); cv.width = w; cv.height = hgt;
  var c = cv.getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(base, 0, 0);
  var im; try { im = c.getImageData(0, 0, w, hgt); } catch (e) { return null; }
  var d = im.data, atkSpec = _LP_KIT_SPEC[atkKit], defSpec = _LP_KIT_SPEC[defKit];
  for (var i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    var hsl = _lpRgb2hsl(d[i], d[i + 1], d[i + 2]), h = hsl[0], s = hsl[1], l = hsl[2];
    if (s > 0.4 && l > 0.15 && l < 0.78) {
      var v = null;
      if (h < 18 || h > 342) v = _lpApplyKit(atkSpec, h, s, l);       // 赤 → 攻撃色
      else if (h > 85 && h < 165) v = _lpApplyKit(defSpec, h, s, l);  // 緑 → 守備色
      if (v) { d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; }
    }
  }
  c.putImageData(im, 0, 0);
  _headerCache[key] = cv; return cv;
}
// ヘディング競り合い（新マンガ方式）: 攻撃/守備の跳躍体を別PNG(同一395×480座標系)で持ち、
//   MangaRecolor で各チームのキット4色＋選手肌へ独立リカラー→同じ矩形に重ねて競り合い構図を復元。
//   描画順=守備(先)→攻撃(後)で攻撃を前面（競り勝つ絵）。clashは当面 rise 流用（下の _HEADER_CLASH_* を
//   専用アートへ差し替えれば frame B が切り替わる）。MangaRecolor 未ロード(本番)は null→従来SVGへ。
//   rise は 2026-07-10 に「1枚絵の機械分離」→「独立生成の単体2枚」へ差し替え（旧版の腕欠損解消・
//   処理系 tools/proto/process_header_rise2.py・座標系/体格は旧版に正規化済み）。
var _HEADER_RISE_ATK_SRC = 'img/cutscenes/header_rise_atk.png?v=2';
var _HEADER_RISE_DEF_SRC = 'img/cutscenes/header_rise_def.png?v=2';
// clash（接触）専用アート（2026-07-09 差し替え済み・rise と同じ2体分離＋MangaRecolor方式）。
var _HEADER_CLASH_ATK_SRC = 'img/cutscenes/header_clash_atk.png';
var _HEADER_CLASH_DEF_SRC = 'img/cutscenes/header_clash_def.png';
function _renderHeaderScene(sc) {
  if (typeof MangaRecolor === 'undefined' || !MangaRecolor.render) return null;   // 本番=未ロード→従来SVGフォールバック
  var W = 480, H = 216, ground = 206;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;   // 等倍＋NNへ復帰（レトロ画素感 2026-07-15）。粗ドット化は _csPixelate が担う
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var riseAtkImg = _loadCutsceneImg(_HEADER_RISE_ATK_SRC), riseDefImg = _loadCutsceneImg(_HEADER_RISE_DEF_SRC);
  var clashAtkImg = _loadCutsceneImg(_HEADER_CLASH_ATK_SRC), clashDefImg = _loadCutsceneImg(_HEADER_CLASH_DEF_SRC);
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var atkColor = (sc.offence && sc.offence.team_color) || '#d23';
  var defColor = (sc.defence && sc.defence.team_color) || '#2a2';
  var success = (sc.result === '成功');

  var gs = (typeof gameState !== 'undefined' && gameState) ? gameState : {};
  var t1 = gs.team1, t2 = gs.team2;
  var c1 = (t1 && t1.team_color) || '#1f4fd6', c2 = (t2 && t2.team_color) || '#e36b1f';
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display'), s1 = dom('score1'), s2 = dom('score2');
  var atkP = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var atkName = atkP ? ((typeof getPlayerName === 'function') ? getPlayerName(atkP) : atkP.name) : '';
  var defP = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[sc.dfsPos]];
  var defName = defP ? ((typeof getPlayerName === 'function') ? getPlayerName(defP) : defP.name) : '';
  var atkTeamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var defTeamNm = (typeof getTeamName === 'function' && sc.defence) ? getTeamName(sc.defence) : '';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = success ? (en ? 'HEADER!' : 'ヘディング！') : (en ? 'CLEARED!' : '競り負け！');
  var labelCol = success ? '#ffe14a' : '#ff5a3c';
  var accent = success ? atkColor : defColor;

  // 選手別リカラー色（キット4色＋肌）。肌は選手ごと・髪はヘディングでは頭が焼き込みのため未使用。
  var atkSkin = _mangaFeat(atkP ? (atkP.long_name || atkP.name || '') : '').skin;
  var defSkin = _mangaFeat(defP ? (defP.long_name || defP.name || '') : '').skin;
  var atkColors = _mangaColors(sc.offence, atkSkin), defColors = _mangaColors(sc.defence, defSkin);
  // 色シグネチャ（キャッシュキー用）。rise/clashで別スプライトキーにする必要あり
  //   ＝同キーだとMangaRecolorのベースキャッシュがrise画素を使い回しclashが出ない（2026-07-09バグ修正）。
  var atkSig = atkColors.shirt + atkColors.shorts + atkColors.socks + atkColors.accent + atkColors.skin;
  var defSig = defColors.shirt + defColors.shorts + defColors.socks + defColors.accent + defColors.skin;
  function _hdrRender(imgRef, key, cols) { if (!imgRef || !imgRef.complete || !imgRef.naturalWidth) return null; return MangaRecolor.render(key, imgRef, cols); }

  var ballDir = success ? 1 : -1;   // pre-flip(ネイティブ=右攻め): 成功=右 / 失敗=左。左攻めは frame の flip で全反転
  var P = 1700;

  function ballTrail(x, y, dir, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2; for (var i = 0; i < 4; i++) { var yy = y - 9 + i * 6; ctx.beginPath(); ctx.moveTo(x - dir * 10, yy); ctx.lineTo(x - dir * 46, yy); ctx.stroke(); } }
  function burst(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 13, y + Math.sin(an) * 13); ctx.lineTo(x + Math.cos(an) * 52, y + Math.sin(an) * 52); ctx.stroke(); } }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;   // 焼き込みラベル停止（時刻/アクション名/選手名はHUD・ネーム枠へ集約）
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    // ミニスコア（色チップ＋略称＋スコア）はスコアボードへ集約のため非表示。時間(左上)とラベル/選手名は残す。
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = labelCol; ctx.fillText(label, 12, H - 9);
    var nm = success ? (atkName ? (atkName + (atkTeamNm ? (' · ' + atkTeamNm) : '')) : '') : (defName ? ('✕ ' + defName + (defTeamNm ? (' · ' + defTeamNm) : '')) : '');
    if (nm) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(nm, W - 12, H - 10); }
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  var riseEnd = 0.42;    // ここまで rise(跳び上がり)、以降 clash(接触)＋ボール
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;   // NN描画（レトロ画素感 2026-07-15・スプライトは _csPixelate 済み）
    // 背景を下げてピッチ線を下方へ＝跳んでいる選手を相対的に高く見せる（上に隙間が出ないよう拡大して cover・新規アート不要）
    //   _bb を大きくするほど芝生ラインが下がり、選手が地面から浮いて見える（選手の描画位置は不変・2026-07-10 ユーザー指示で背景側で調整）。
    if (bgImg.complete && bgImg.naturalWidth) { var _bb = 42, _bs = Math.max(W / bgImg.naturalWidth, (H + 2 * _bb) / bgImg.naturalHeight), _bdw = bgImg.naturalWidth * _bs, _bdh = bgImg.naturalHeight * _bs; ctx.drawImage(bgImg, (W - _bdw) / 2, (H - _bdh) / 2 + _bb, _bdw, _bdh); } else { ctx.drawImage(bgFallback, 0, 0); }

    var flip = !_csAttackRight(sc);   // ネイティブ=右攻め。左攻め(team2)はシーン全体(選手＋ボール＋入射)を左右反転
    ctx.save();
    if (flip) { ctx.translate(W, 0); ctx.scale(-1, 1); }

    var sh = 168, inRise = p < riseEnd;
    // frame A=rise / frame B=clash（当面 rise 流用）。守備(先)→攻撃(後)を同一矩形に重ねて競り合いを復元。
    var atkSpr = _hdrRender(inRise ? riseAtkImg : clashAtkImg, 'hdr_atk_' + (inRise ? 'r|' : 'c|') + atkSig, atkColors);
    var defSpr = _hdrRender(inRise ? riseDefImg : clashDefImg, 'hdr_def_' + (inRise ? 'r|' : 'c|') + defSig, defColors);
    var refSpr = atkSpr || defSpr;
    var headX = W / 2, headY = 40;
    if (refSpr) {
      var sw = refSpr.width * (sh / refSpr.height), sx = (W - sw) / 2;
      var lift = inRise ? 30 * (1 - p / riseEnd) : 0;     // rise: 下→apex へ跳び上がる / clash: apex
      var sy = ground - sh + lift;                        // 選手の描画位置は動かさない。浮き（地面から上）は背景の下げ幅 _bb で表現（2026-07-10 ユーザー指示）
      var _pxA = atkSpr ? _csPixelate(atkSpr, 'hdr_atk_' + (inRise ? 'r|' : 'c|') + atkSig, sw, sh) : null;   // レトロ画素化
      var _pxD = defSpr ? _csPixelate(defSpr, 'hdr_def_' + (inRise ? 'r|' : 'c|') + defSig, sw, sh) : null;
      if (_pxD) ctx.drawImage(_pxD, sx, sy, sw, sh);      // 守備＝先描き（背面）
      if (_pxA) ctx.drawImage(_pxA, sx, sy, sw, sh);      // 攻撃＝後描き（前面・競り勝つ絵）
      headX = sx + sw * 0.47; headY = sy + sh * 0.07;     // 頭の接触点（2体の頭の間・やや上）
    }
    // 入射: ヘディング前、ボールが軌道に沿って頭へ飛来（ネイティブ=右上から＝赤線。左攻めは flip で左上）。接触(riseEnd)で頭へ到達。
    if (p < riseEnd) {
      var it = p / riseEnd;
      var ix0 = W / 2 + W * 0.60, iy0 = -22;              // 右上の入射点
      var ibx = ix0 + (headX - ix0) * it, iby = iy0 + (headY - iy0) * it - 18 * Math.sin(it * Math.PI);   // ふわっとした弧
      var vx = ix0 - headX, vy = iy0 - headY, vl = Math.sqrt(vx * vx + vy * vy) || 1;                      // 進行方向と逆の尾
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ibx, iby); ctx.lineTo(ibx + vx / vl * 42, iby + vy / vl * 42); ctx.stroke(); ctx.lineCap = 'butt';
      if (ibx > -22 && ibx < W + 22) _lpBall(ctx, ibx, iby, 10, it * -12);
    }
    // ボールは接触(riseEnd)で頭から弾き出される（pre-flip: 成功=右 / 失敗=左）。
    var contact = (p >= riseEnd && p < riseEnd + 0.13) ? 1 - (p - riseEnd) / 0.13 : 0;
    if (p >= riseEnd) {
      var u = Math.min(1, (p - riseEnd) / (1 - riseEnd));
      u = 1 - (1 - u) * (1 - u);   // ease-out
      var bx = headX + ballDir * 360 * u;
      var by = headY - 6 - 16 * Math.sin(u * 0.9);        // ほぼ水平に頭の高さを横切る
      if (bx > -22 && bx < W + 22) { ballTrail(bx, by, ballDir, 0.5); _lpBall(ctx, bx, by, 11, u * 22 * ballDir); }
    }
    if (contact > 0) burst(headX, headY, contact * 0.85);
    ctx.restore();
    if (contact > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (contact * 0.4) + ')'; ctx.fillRect(0, 0, W, H); }
    hud();
    if (p < 1 || !riseAtkImg.complete || !riseDefImg.complete) requestAnimationFrame(frame);   // 画像ロードが遅れても完了後に描き切る
  }
  requestAnimationFrame(frame);
  return canvas;
}

// ============================================================
// ミドルシュート専用カット: シューター(赤→攻撃色)＋ブロックに来る守備(緑→守備色)の2人絵を recolor。
//   成功(ブロック以外=抜けた)=ボールが左→右へ直進。失敗(ブロック)=守備に当たって右上へ deflect＋インパクト。
//   攻撃方向でシーン全体を左右反転（ネイティブ=右攻め=添付の構図）。
// ============================================================
var _MIDSHOT_SRC = 'img/cutscenes/midshot_t_01.png?v=h3';
function _renderCrossScene(sc) { return _renderMidShotScene(sc, { cross: true }); }   // クロス: ミドル流用・成功=斜め上/失敗=反対方向
function _renderMidShotScene(sc, opts) {
  var W = 480, H = 216, ground = 210;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var midImg = _loadCutsceneImg(_MIDSHOT_SRC);
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var atkColor = (sc.offence && sc.offence.team_color) || '#d23';
  var defColor = (sc.defence && sc.defence.team_color) || '#2a2';
  var cross = !!(opts && opts.cross);   // クロス流用: 成功=斜め上 / 失敗=守備で反対方向
  var blocked = cross ? (sc.result !== '成功') : (sc.result === 'ブロック');

  var gs = (typeof gameState !== 'undefined' && gameState) ? gameState : {};
  var t1 = gs.team1, t2 = gs.team2;
  var c1 = (t1 && t1.team_color) || '#1f4fd6', c2 = (t2 && t2.team_color) || '#e36b1f';
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display'), s1 = dom('score1'), s2 = dom('score2');
  var atkP = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var atkName = atkP ? ((typeof getPlayerName === 'function') ? getPlayerName(atkP) : atkP.name) : '';
  var defP = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[sc.dfsPos]];
  var defName = defP ? ((typeof getPlayerName === 'function') ? getPlayerName(defP) : defP.name) : '';
  var atkTeamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var defTeamNm = (typeof getTeamName === 'function' && sc.defence) ? getTeamName(sc.defence) : '';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = cross ? (blocked ? (en ? 'BLOCKED!' : 'カット！') : (en ? 'CROSS!' : 'クロス！')) : (blocked ? (en ? 'BLOCKED!' : 'ブロック！') : (en ? 'LONG SHOT!' : 'ミドルシュート！'));
  var labelCol = blocked ? '#ff5a3c' : '#ffe14a';
  var accent = blocked ? defColor : atkColor;
  var flip = !_csAttackRight(sc);
  var P = 1400;

  function burst(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12); ctx.lineTo(x + Math.cos(an) * 50, y + Math.sin(an) * 50); ctx.stroke(); } }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;   // 焼き込みラベル停止（時刻/アクション名/選手名はHUD・ネーム枠へ集約）
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    // ミニスコア（色チップ＋略称＋スコア）はスコアボードへ集約のため非表示。時間(左上)とラベル/選手名は残す。
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = labelCol; ctx.fillText(label, 12, H - 9);
    var nm = blocked ? (defName ? ('✕ ' + defName + (defTeamNm ? (' · ' + defTeamNm) : '')) : '') : (atkName ? (atkName + (atkTeamNm ? (' · ' + atkTeamNm) : '')) : '');
    if (nm) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(nm, W - 12, H - 10); }
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (flip) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    var spr = _headerRecolor(midImg, atkColor, defColor, 'midshot');
    var sh = 192, sx = 86, sy = ground - sh, sw = 0;
    var footX = W * 0.30, footY = ground - 30, blockX = W * 0.50;
    if (spr) {
      sw = spr.width * (sh / spr.height);
      footX = sx + sw * 0.28; footY = sy + sh * 0.84;    // シューターの足元＝ボール発射点
      blockX = sx + sw * 0.55;                            // 守備の位置（ブロック点）
    }
    // ロングパス風に少し近づくズーム（背景ごとシーン全体）。アクション中央を中心に 1.0→1.10。
    var z = 1.0 + Math.min(1, p / 0.6) * 0.10;
    var zcx = (footX + blockX) / 2, zcy = footY - 30;
    ctx.translate(zcx, zcy); ctx.scale(z, z); ctx.translate(-zcx, -zcy);
    _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    // ボール: シュート速度（速い・一定）。守備の「背後」を通すため sprite より先に描く。
    var launchP = 0.10, spd = 2000;                       // px / 単位p（≈シュート速度）
    var bx = null, by = null, impact = 0, vdx = 1, vdy = 0;
    var strike = (p > launchP - 0.05 && p < launchP + 0.07) ? 1 - Math.abs(p - launchP) / 0.07 : 0;
    if (p >= launchP) {
      var dt = p - launchP;
      if (!blocked) {
        bx = footX + spd * dt; by = cross ? (footY - spd * 0.55 * dt) : footY;   // クロス成功=斜め上 / ミドル=水平
        vdx = 1; vdy = cross ? -0.55 : 0;
      } else {
        var hitDt = (blockX - footX) / spd;
        if (dt < hitDt) { bx = footX + spd * dt; by = footY; vdx = 1; vdy = 0; }
        else {
          var dd = dt - hitDt;
          if (cross) { bx = blockX - spd * 0.7 * dd; by = footY - spd * 0.45 * dd; vdx = -0.7; vdy = -0.45; }   // クロス失敗=守備に当たり反対方向(戻る)
          else { bx = blockX + spd * 0.78 * dd; by = footY - spd * 0.6 * dd; vdx = 0.78; vdy = -0.6; }            // ミドル=右上へ deflect
        }
        impact = (dt > hitDt - 0.015 && dt < hitDt + 0.06) ? 1 - Math.abs(dt - hitDt) / 0.06 : 0;
      }
    }
    var ballOn = (bx !== null && bx > -30 && bx < W + 30 && by > -30 && by < H + 30);
    if (ballOn) {
      var vn = Math.sqrt(vdx * vdx + vdy * vdy) || 1, ux = vdx / vn, uy = vdy / vn;
      for (var gi = 1; gi <= 6; gi++) { ctx.globalAlpha = 0.32 * (1 - gi / 7); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bx - ux * gi * 12, by - uy * gi * 12, Math.max(2, 11 - gi * 1.1), 0, 7); ctx.fill(); }   // コメット残像
      ctx.globalAlpha = 1;
      _lpBall(ctx, bx, by, 11, p * 44);
    }
    if (spr) ctx.drawImage(spr, sx, sy, sw, sh);          // sprite を手前に（ボールは背後）
    if (strike > 0) burst(footX, footY, strike * 0.95);   // 発射の疾走線（ロングパス風）
    if (impact > 0) burst(blockX, footY - 6, impact * 0.95);
    ctx.restore();
    if (strike > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (strike * 0.4) + ')'; ctx.fillRect(0, 0, W, H); }   // 発射フラッシュ
    if (impact > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (impact * 0.4) + ')'; ctx.fillRect(0, 0, W, H); }
    hud();
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // シューターは sx=86＋幅≈192＝中心 ~0.4（やや左）。flip 込みで主役を可視窓中央へ。
  return _csCenterSubject(canvas, 0.4, flip);
}

// ============================================================
// ファール3ビート化（テスト実装・2026-07-16 ユーザー指定「1画像1選手」方針）:
//   ①削り（守備単独・manga_tackle_slide流用）→②転倒（攻撃単独・manga_foul_atk新規）→③判定（主審・既存）。
//   まだ本編（_shootSplit）には未配線＝テスト環境（_scene_lab.html）での確認用。
// ============================================================
var _MANGA_FOUL_ATK_DIR = 'img/cutscenes/manga_foul_atk/';
// ★アセット差し替え時は必ず版数を上げる（同一URLのまま中身だけ変えるとブラウザが旧画像を掴み続ける）。
//   build の ?v 自動更新は index.html のJS/CSSタグのみが対象で、JS内で組み立てる画像URLには効かない。
//   f2 = 2026-07-17 口を納品原画どおり（白い歯/赤ベロ/黒い口奥）へ差し替え。
//   f4 = 2026-07-17 口を「輪郭・赤ベロ・黒い口の中」の3要素へ再構成（ユーザー方針）。
//        ゲーム描画は native380→130px＝34%縮小で口全体が約9.6×8.9px・歯は約4×2px＝描き分け不能。
//        歯を捨てて「口が開いている」ことの提示に振ったほうが実寸で明確に読める。
var _MANGA_FOUL_ATK_V = '?v=f12';

// ①削り: 守備選手単独のスライディングチャレンジ（manga_tackle_slide/<hstyle>.png流用・新規アセット不要）。
function _renderFoulTackleScene(sc) {
  if (typeof MangaRecolor === 'undefined' || !MangaRecolor.render) return null;
  var W = 480, H = 216, ground = 196;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();

  var defP = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[sc.dfsPos]];
  var defName = defP ? ((typeof getPlayerName === 'function') ? getPlayerName(defP) : defP.name) : '';
  var defTeamNm = (typeof getTeamName === 'function' && sc.defence) ? getTeamName(sc.defence) : '';
  var defFeat = _mangaFeat(defP ? (defP.long_name || defP.name || '') : '');
  var defCols = _mangaColors(sc.defence, defFeat.skin);
  var defKey = 'ftk|' + defFeat.hstyle + '|' + defCols.shirt + defCols.shorts + defCols.socks + defCols.accent + defCols.skin;
  var defImg = _loadCutsceneImg('img/cutscenes/manga_tackle_slide/' + defFeat.hstyle + '.png');

  var accent = (sc.defence && sc.defence.team_color) || '#e36b1f';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = en ? 'CHALLENGE!' : 'チャレンジ！';
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display');

  var ph = 160, sx = W * 0.32, sy = ground - ph;
  var flipH = _csAttackRight(sc);   // 守備は攻撃の逆を向いて迎え撃つ＝キック拍と同じ規約を流用
  var P = 1100;

  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = '#ffcf33'; ctx.fillText(label, 12, H - 9);
    if (defName) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(defName + (defTeamNm ? (' · ' + defTeamNm) : ''), W - 12, H - 10); }
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    var spr = (defImg.complete && defImg.naturalWidth) ? MangaRecolor.render(defKey, defImg, defCols) : null;
    if (spr) { var dw = spr.width * (ph / spr.height); ctx.drawImage(spr, sx, sy, dw, ph); }
    ctx.restore();
    hud();
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return _csCenterSubject(canvas, 0.5, false);
}

// ②転倒: 攻撃選手単独のダウン（新規スプライト manga_foul_atk/<hstyle>.png・2026-07-16受入）。
function _renderFoulDownScene(sc) {
  if (typeof MangaRecolor === 'undefined' || !MangaRecolor.render) return null;
  var W = 480, H = 216, ground = 196;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();

  var atkP = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var atkName = atkP ? ((typeof getPlayerName === 'function') ? getPlayerName(atkP) : atkP.name) : '';
  var atkTeamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var atkFeat = _mangaFeat(atkP ? (atkP.long_name || atkP.name || '') : '');
  var atkCols = _mangaColors(sc.offence, atkFeat.skin);
  var atkKey = 'fdn|' + atkFeat.hstyle + '|' + atkCols.shirt + atkCols.shorts + atkCols.socks + atkCols.accent + atkCols.skin;
  var atkImg = _loadCutsceneImg(_MANGA_FOUL_ATK_DIR + atkFeat.hstyle + '.png' + _MANGA_FOUL_ATK_V);

  var accent = '#ffcf33';   // 警告色（守備の反則＝ファール共通）
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = en ? 'BROUGHT DOWN!' : '倒された！';
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display');

  var ph = 130, sx = W * 0.06, sy = ground - ph;   // ロングパス相当のスケール感へ縮小（2026-07-16・寝そべりポーズは横長のため高さ基準では画面占有率が上がりやすい）。頭部は素材の右寄り(frac 0.81)＝起点を左寄りへ下げて顔の見切れを解消
  var P = 1300;
  // スライド演出（2026-07-16 ユーザー指定）: 削られた勢いのまま左→右へ滑って止まる（ease-out）。
  //   攻撃方向で向きを変えると滑走感が破綻するため、この単独リアクションは常に画面基準（左→右固定）。
  var slideP = 0.30, slideDist = 74;
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function burst(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 10, y + Math.sin(an) * 10); ctx.lineTo(x + Math.cos(an) * 42, y + Math.sin(an) * 42); ctx.stroke(); } }
  // 土煙: スライド中、進行方向の後方（左）へ土色パフを連続発生→上へ舞いつつ薄れる。派手め（2026-07-16 好評につき増量）。
  function dustPuffs(px, py, slideT) {
    ctx.save();
    for (var i = 0; i < 14; i++) {
      var f = slideT - i * 0.035;
      if (f < 0 || f > 1) continue;
      var dx = -(i * 8 + f * 42), dy = -f * 22 - (i % 4) * 4;
      var r = 6 + f * 11;
      // 外側=薄い土煙の広がり、内側=白っぽいコア（コントラストで視認性UP）
      ctx.globalAlpha = (1 - f) * 0.7;
      ctx.fillStyle = '#d9c79a';
      ctx.beginPath(); ctx.arc(px + dx, py + dy, r, 0, 6.29); ctx.fill();
      ctx.globalAlpha = (1 - f) * 0.55;
      ctx.fillStyle = '#f2e8cf';
      ctx.beginPath(); ctx.arc(px + dx, py + dy, r * 0.55, 0, 6.29); ctx.fill();
    }
    ctx.restore();
  }
  // 残像トレイル: スライド中のみ、少し過去の位置を薄く重ねて速度感を出す。
  function ghostTrail(spr, dw, slideT) {
    if (slideT >= 1 || slideT <= 0) return;
    ctx.save();
    for (var g = 1; g <= 3; g++) {
      var gt = slideT - g * 0.09; if (gt < 0) continue;
      var gx = sx + slideDist * easeOutCubic(gt);
      ctx.globalAlpha = 0.20 * (1 - g / 4) * (1 - slideT);
      ctx.drawImage(spr, gx, sy, dw, ph);
    }
    ctx.restore();
  }

  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = accent; ctx.fillText(label, 12, H - 9);
    if (atkName) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(atkName + (atkTeamNm ? (' · ' + atkTeamNm) : ''), W - 12, H - 10); }
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    var spr = (atkImg.complete && atkImg.naturalWidth) ? MangaRecolor.render(atkKey, atkImg, atkCols) : null;
    var slideT = Math.min(1, p / slideP);
    var curSx = sx + slideDist * easeOutCubic(slideT);
    var contactX = curSx + (spr ? (spr.width * (ph / spr.height)) * 0.42 : sx * 0.42), contactY = sy + ph * 0.80;
    if (spr) {
      var dw = spr.width * (ph / spr.height);
      ghostTrail(spr, dw, slideT);           // 残像（スプライトの下描き）
      ctx.drawImage(spr, curSx, sy, dw, ph);
    }
    dustPuffs(contactX, contactY, slideT);   // 土煙（スプライトの上描き＝地面から舞い上がる手前感）
    var impact = (p > slideP - 0.02 && p < slideP + 0.14) ? 1 - Math.abs(p - slideP) / 0.14 : 0;
    if (impact > 0) burst(contactX, contactY, impact * 0.85);   // 着地インパクト
    if (impact > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (impact * 0.35) + ')'; ctx.fillRect(0, 0, W, H); }
    hud();
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return _csCenterSubject(canvas, 0.5, false);
}

// ============================================================
// ファール専用カット: 主審(笛＋ポイント)を“いつもの背景”に重ねる。主審は中立色なので recolor しない。
//   攻撃方向で主審を左右反転（指す向き＝プレー再開方向）。笛フラッシュ＋FOUL!。元絵 tools/art/cutscenes/foul_ref_src.png。
// ============================================================
var _FOUL_REF_SRC = 'img/cutscenes/foul_ref_t_01.png?v=7';   // v7img: 肩トリム浮き解消(クラック充填gap2化)・回帰ゲート[A-F]全PASS
var _FOUL_BG_SRC = 'img/cutscenes/foul_crowd_bg_01.png?v=1';  // ドアップ主審用の背景=デフォーカスした観客席(被写界深度でシャープな主審を際立たせる・longpass_bg_01をガウスぼかし)
function _renderFoulScene(sc, isPK) {
  var W = 480, H = 216, ground = 214;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  // PK判定は画面いっぱいの中央大ラベル「PENALTY!」を焼くので、wrap の object-fit:cover だと
  //   左右が切れて P…Y! が欠ける。cs-fullframe で contain へ上書き（全文表示・上下は暗マット）。
  //   ※通常のファール絵（isPKなし）はラベル小＝cover のままで良いのでクラスは付けない。
  if (isPK) canvas.className = 'cs-fullframe';
  var ctx = canvas.getContext('2d');
  var refImg = _loadCutsceneImg(_FOUL_REF_SRC);
  var foulBgImg = _loadCutsceneImg(_FOUL_BG_SRC);      // 主審ドアップ専用のデフォーカス観客席背景（PNG）
  var foulBgFallback = _lpBg();                        // 404時は手続き描画の通常スタジアム（観客席）へフォールバック
  var accent = isPK ? '#ff3b3b' : '#ffcf33';   // PK=赤 / ファール=イエロー（警告色）

  var gs = (typeof gameState !== 'undefined' && gameState) ? gameState : {};
  var t1 = gs.team1, t2 = gs.team2;
  var c1 = (t1 && t1.team_color) || '#1f4fd6', c2 = (t2 && t2.team_color) || '#e36b1f';
  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display'), s1 = dom('score1'), s2 = dom('score2');
  // ファールは守備側の反則 → FK は攻撃側。倒された側=攻撃選手を表示。
  var atkP = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var atkName = atkP ? ((typeof getPlayerName === 'function') ? getPlayerName(atkP) : atkP.name) : '';
  var atkTeamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = isPK ? 'PENALTY!' : (en ? 'FOUL!' : 'ファール！');   // PK は日英とも「PENALTY!」表記（ユーザー指定）
  var flip = !_csAttackRight(sc);   // ネイティブ=右を指す。左攻めは反転して左を指す（再開方向）
  var P = 1500;

  function burst(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12); ctx.lineTo(x + Math.cos(an) * 44, y + Math.sin(an) * 44); ctx.stroke(); } }
  function hud() {
    if (!CUTSCENE_BURN_LABELS) return;   // 焼き込みラベル停止（時刻/アクション名/選手名はHUD・ネーム枠へ集約）
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    // ミニスコア（色チップ＋略称＋スコア）はスコアボードへ集約のため非表示。時間(左上)とラベル/選手名は残す。
    var bgd = ctx.createLinearGradient(0, H - 40, 0, H); bgd.addColorStop(0, 'rgba(6,6,14,0)'); bgd.addColorStop(1, 'rgba(6,6,14,.9)'); ctx.fillStyle = bgd; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = accent; ctx.fillRect(0, H - 30, W, 3);
    if (!isPK) {   // PK は中央に大きく描く（hud の小ラベルは出さない）
      ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.font = '900 22px "Arial Black",sans-serif';
      ctx.lineWidth = 5; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 12, H - 9); ctx.fillStyle = accent; ctx.fillText(label, 12, H - 9);
    }
    if (atkName) { ctx.textAlign = 'right'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(atkName + (atkTeamNm ? (' · ' + atkTeamNm) : ''), W - 12, H - 10); }
  }

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H); ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (flip) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    _lpDrawBg(ctx, foulBgImg, foulBgFallback, W, H);
    var pop = Math.min(1, p / 0.16), z = 0.92 + 0.08 * pop;   // 主審がポップイン
    var sh = 198 * z, whX = W * 0.30, whY = H * 0.34;
    if (refImg.complete && refImg.naturalWidth) {
      var sw = refImg.naturalWidth * (sh / refImg.naturalHeight);
      var sx = W * 0.40 - sw / 2, sy = ground - sh + 14;   // +14px 下げ: 腿の切れ目を枠外へ逃がし「浮き」を解消（2026-07-17 ユーザー指摘）
      ctx.drawImage(refImg, sx, sy, sw, sh);
      whX = sx + sw * 0.30; whY = sy + sh * 0.27;             // 笛の位置（口元）
    }
    var wf = (p < 0.24) ? 1 - p / 0.24 : 0;                   // 笛フラッシュ（開始時）
    if (wf > 0) burst(whX, whY, wf * 0.9);
    ctx.restore();
    if (wf > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (wf * 0.32) + ')'; ctx.fillRect(0, 0, W, H); }
    hud();
    // PK判定は「PK！！」を画面いっぱいに大きく（GOAL!! と同様の迫力）。スラムイン＋暗幕で強調。
    if (isPK) {
      var dim = 0.34 * Math.min(1, p / 0.18);
      ctx.fillStyle = 'rgba(6,6,14,' + dim + ')'; ctx.fillRect(0, 0, W, H);
      var fs = 92;
      ctx.font = '900 ' + fs + 'px "Arial Black",sans-serif';
      while (ctx.measureText(label).width > W * 0.9 && fs > 32) { fs -= 4; ctx.font = '900 ' + fs + 'px "Arial Black",sans-serif'; }
      var bp = Math.min(1, p / 0.12), bz = 1.35 - 0.35 * bp;   // 大きく入って定位置へ
      ctx.save();
      ctx.translate(W / 2, H * 0.45); ctx.scale(bz, bz);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = fs * 0.16; ctx.strokeStyle = '#0c0a14'; ctx.strokeText(label, 0, 0);
      ctx.fillStyle = accent; ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // 主審は W*0.40（0.40）中心。flip 込みで主役を可視窓中央へ（PK=cs-fullframe はヘルパー側でスキップ）。
  return _csCenterSubject(canvas, 0.4, flip);
}

// ============================================================
//  スキル発動カットイン（PS-05・漫画的決めゴマ）
//   evt = events.js の SKILL_ACTIVATE Event 形 {team:'home'|'away', player, playerEn, skill, detail}
//   手続き描画のみ（新規アセット無し）。中央にネームプレート＋i18nラベル、morale上昇モチーフ
//   （立ち上る光の柱・上向き矢印・白い集中線）、チーム色アクセント。フェード/スケール出入り ~1750ms。
//   mental.js 非同梱でも動くよう SKILL_DEFS が無ければ _SKILL_LABEL_FALLBACK を使う。
//   無効時/未対応evtは null（呼び出し側フォールバック）。
// ============================================================
function _renderSkillActivateScene(evt) {
  if (typeof document === 'undefined') return null;
  if (!_skillCutinOn()) return null;
  if (!evt || !evt.skill) return null;

  var W = 480, H = 216;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.className = 'cs-fullframe';   // 中央大ラベルを contain で全文表示（cover 切れ回避）
  canvas.style.cssText = 'display:block;width:100%';
  var ctx = canvas.getContext('2d');

  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  // チーム色（gameState 経由）。home=team1 / away=team2。
  var gs = (typeof gameState !== 'undefined' && gameState) ? gameState : {};
  var team = evt.team === 'home' ? gs.team1 : evt.team === 'away' ? gs.team2 : null;
  var col = (team && team.team_color) || '#f2c14e';
  var teamNm = team ? ((typeof getTeamName === 'function') ? getTeamName(team) : (team.name || '')) : '';
  var pname = en ? (evt.playerEn || evt.player || '') : (evt.player || '');

  // ラベル（SKILL_DEFS 優先・無ければフォールバック）。｛選手｝/{player} を選手名へ置換。
  var def = (typeof SKILL_DEFS !== 'undefined' && SKILL_DEFS && SKILL_DEFS[evt.skill]) ? SKILL_DEFS[evt.skill] : null;
  var lbl = (def && def.label) || _SKILL_LABEL_FALLBACK[evt.skill] || { ja: String(evt.skill), en: String(evt.skill) };
  var text = String(en ? lbl.en : lbl.ja).replace('{player}', pname).replace('｛選手｝', pname);
  var kicker = en ? 'SKILL ACTIVATED' : 'スキル発動';
  var moraleTag = en ? 'MORALE ▲' : '士気 ▲';

  // 色ユーティリティ（team色を暗く/明るく合成）。
  function _hex(c) { var m = /^#?([0-9a-f]{6})$/i.exec(c || ''); if (!m) return [242, 193, 78]; var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  var rgb = _hex(col);
  function rgba(mul, a) { return 'rgba(' + Math.round(rgb[0] * mul) + ',' + Math.round(rgb[1] * mul) + ',' + Math.round(rgb[2] * mul) + ',' + a + ')'; }

  var P = 1750;
  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;

  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;   // 差し替えで外れたら停止
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    var appear = Math.min(1, p / 0.12);
    var out = p > 0.86 ? (p - 0.86) / 0.14 : 0;
    var alpha = appear * (1 - out);

    ctx.clearRect(0, 0, W, H);

    // 背景: 暗いラジアル（team色に寄せる）＋ビネット。
    var bg = ctx.createRadialGradient(W / 2, H * 0.46, 20, W / 2, H * 0.46, W * 0.72);
    bg.addColorStop(0, rgba(0.34, 0.96 * alpha));
    bg.addColorStop(0.55, rgba(0.14, 0.98 * alpha));
    bg.addColorStop(1, 'rgba(4,7,14,' + (0.99 * alpha) + ')');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // 白い集中線（漫画・回転しながら中央へ収束）。
    var rot = p * 0.7;
    ctx.save();
    ctx.translate(W / 2, H * 0.46);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.20 * alpha) + ')';
    for (var i = 0; i < 26; i++) {
      var an = i / 26 * 6.283 + rot;
      ctx.lineWidth = (i % 2 ? 1.2 : 2.6);
      ctx.beginPath();
      ctx.moveTo(Math.cos(an) * 96, Math.sin(an) * 96);
      ctx.lineTo(Math.cos(an) * 360, Math.sin(an) * 360);
      ctx.stroke();
    }
    ctx.restore();

    // 立ち上る光の柱（team色・下から上へ流れる）。
    var cols = 7;
    for (var c = 0; c < cols; c++) {
      var cx = (c + 0.5) / cols * W;
      var ph = ((p * 1.6 + c * 0.37) % 1);         // 各柱の位相
      var top = H - ph * H * 1.15;                   // 上へ抜ける
      var lg = ctx.createLinearGradient(0, H, 0, top);
      lg.addColorStop(0, rgba(1.25, 0.0));
      lg.addColorStop(0.6, rgba(1.25, 0.16 * alpha));
      lg.addColorStop(1, rgba(1.5, 0.0));
      ctx.fillStyle = lg;
      var bw = 14 + (c % 3) * 4;
      ctx.fillRect(cx - bw / 2, top, bw, H - top);
    }

    // 上向き矢印（team色・鼓舞＝士気上昇のモチーフ）。左右に配置。
    function upArrow(ax, scale, a) {
      ctx.save();
      ctx.translate(ax, H * 0.52);
      ctx.scale(scale, scale);
      ctx.fillStyle = rgba(1.35, a);
      ctx.beginPath();
      ctx.moveTo(0, -22); ctx.lineTo(15, -2); ctx.lineTo(6, -2);
      ctx.lineTo(6, 20); ctx.lineTo(-6, 20); ctx.lineTo(-6, -2);
      ctx.lineTo(-15, -2); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    var arrBob = Math.sin(p * 9) * 4;
    upArrow(58, 1.0 + 0.06 * Math.sin(p * 8), 0.85 * alpha);
    upArrow(W - 58, 1.0 + 0.06 * Math.cos(p * 8), 0.85 * alpha);
    // 中央の小さな上昇矢印の群れ（浮上）はkickerと重なるので左右のみ。arrBob は柱と矢印のわずかな揺れに使用。
    if (arrBob) { /* no-op: 揺れ演出用（将来拡張） */ }

    // 開始フラッシュ（決めゴマのインパクト）。
    var flash = p < 0.14 ? (1 - p / 0.14) : 0;
    if (flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (flash * 0.5) + ')'; ctx.fillRect(0, 0, W, H); }

    // ---- テキスト塊（スケールイン）----
    var pop = Math.min(1, p / 0.16);
    var bz = 1.28 - 0.28 * pop;   // 大きく入って定位置へ
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, H * 0.46);
    ctx.scale(bz, bz);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';

    // kicker（⚡ SKILL）＋ morale タグ。
    ctx.font = '900 15px "Arial Black",sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = '#06070e';
    ctx.strokeText('⚡ ' + kicker, 0, -58);
    ctx.fillStyle = rgba(1.55, 1); ctx.fillText('⚡ ' + kicker, 0, -58);

    // メインラベル（自動縮小で全文フィット）。
    var fs = 40;
    ctx.font = '900 ' + fs + 'px "Arial Black",sans-serif';
    while (ctx.measureText(text).width > W * 0.86 && fs > 16) { fs -= 2; ctx.font = '900 ' + fs + 'px "Arial Black",sans-serif'; }
    ctx.lineWidth = fs * 0.17; ctx.strokeStyle = '#06070e'; ctx.strokeText(text, 0, -14);
    ctx.fillStyle = '#ffffff'; ctx.fillText(text, 0, -14);

    // morale タグ（team色の帯風テキスト）。
    ctx.font = '900 16px "Arial Black",sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = '#06070e';
    ctx.strokeText(moraleTag, 0, 24);
    ctx.fillStyle = rgba(1.5, 1); ctx.fillText(moraleTag, 0, 24);

    // ネームプレート（team色チップ＋選手名 · チーム名）。
    var nmText = (pname ? pname : '') + (teamNm ? '  ' + teamNm : '');
    ctx.font = '800 14px sans-serif';
    var nmW = ctx.measureText(nmText).width;
    var plW = nmW + 34, plX = -plW / 2, plY = 44, plH = 24;
    ctx.fillStyle = 'rgba(6,8,16,0.72)';
    _csRoundRect(ctx, plX, plY, plW, plH, 7); ctx.fill();
    ctx.fillStyle = rgba(1.4, 1);   // 左のチーム色チップ
    ctx.fillRect(plX + 8, plY + 7, 10, 10);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#eef3ff'; ctx.fillText(nmText, plX + 24, plY + plH / 2 + 1);
    ctx.restore();

    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return canvas;   // cs-fullframe: contain 表示。_csCenterSubject は通さない（全画面決めゴマ）。
}

// 角丸矩形ヘルパー（既存に無ければ最小実装）。
function _csRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
