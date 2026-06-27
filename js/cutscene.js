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
  var list = [_LP_BG_SRC, _GK_BG_SRC, _GOAL_BG_SRC, _MISS_BG_SRC, _FOUL_REF_SRC, _ONETWO1_SRC, _ONETWO2_SRC, _ONETWO3_SRC];
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

  var paint = function () { _renderCutsceneCard(canvas, img, sc, res); };
  paint();
  if (!img.complete) img.onload = paint;
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

// 試合表示の「シュート3分割」用（simulate.js nextChance から段階別に呼ぶ）。
//   stepType: 'shot'=シューターの一撃 / 'gk'=GKダイブ（抜かれ/セーブ）/ 'result'=ゴール・枠外・セーブの結末。
//   エンジン無改変・プレゼンのみ。SCENE_ART無効/未対応は null（呼び出し側が従来SVGにフォールバック）。
function renderShootStep(sc, stepType) {
  var on = SCENE_ART_ENABLED && (typeof window === 'undefined' || window.SCENE_ART_ENABLED !== false);
  if (!on || typeof document === 'undefined' || !sc) return null;
  _preloadCutsceneBgs();   // 重い背景を先読み（枠外などで _lpBg フォールバックが固まるのを予防）
  if (stepType === 'fkdeliver') return _renderFkDeliveryScene(sc);   // セットプレー/オープンプレーのクロスの「蹴り出し」（クロスを上げる）
  if (stepType === 'spcontest') return renderSceneArt(sc);           // セットプレーの「競り合い」＝ヘディング/ボレー（既存）
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
  if (sc.action === 'フリーキック') return _renderFreekickScene(shotSc);   // FK=専用2フレーム（蹴る前→蹴った瞬間＋ボール弧）
  if (sc.action === 'ミドルシュート') return _renderMidShotScene(shotSc);
  if (sc.action === 'ボレーシュート') return _renderVolleyScene(shotSc);
  if (sc.action === 'ヘディングシュート') return _renderHeaderScene(shotSc);
  var entry = _pickCutscene('shot', sc.offence && sc.offence.team_color);
  if (entry && entry.file) return _renderShotScene(shotSc, entry);
  return null;
}

function renderSceneArt(sc, nextSc) {
  var on = SCENE_ART_ENABLED && (typeof window === 'undefined' || window.SCENE_ART_ENABLED !== false);
  if (!on || typeof document === 'undefined' || !sc) return null;
  _preloadCutsceneBgs();   // 重い背景を先読み（枠外などで _lpBg フォールバックが固まるのを予防）
  if (sc.result === 'ファール') return _renderFoulScene(sc);   // ファール=主審カット（全アクション共通・recolorなし・笛＆FOUL!）
  if (sc.action === 'ミドルシュート') return _renderMidShotScene(sc);   // 専用ミドル: 成功(抜け)=直進 / ブロック=右上deflect。ゴールでも goal-net でなくミドル演出。
  if (sc.result === 'ゴール！！') return _renderGoalScene(sc);   // 全ゴール=新ゴール演出（旧バイシクル廃止）
  if (sc.action === 'フリーキック') return _renderFreekickScene(sc);   // FK=専用2フレーム（枠外/セーブ等の非分割時もここ。ゴールは上で処理）
  // ヘディング競り合い（クロス/セットプレー段, result=成功/失敗）= 専用ヘディング演出。シュート段(scenario=シュート)は下の通常処理へ。
  if (sc.action === 'ヘディングシュート' && sc.scenario !== 'シュート') return _renderHeaderScene(sc);
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
  // シュート: 枠外=ニアポスト脇を外す演出、GK防いだ！=GKカット、ブロック=シューター演出。（ゴールは上で処理）
  if (moment === 'shot' && entry.file) {
    if (sc.result === '枠を外した！') return _renderMissScene(sc);
    if (sc.result === 'GK防いだ！') return _renderGkScene(sc, 'save');
    return _renderShotScene(sc, entry);
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
    ctx.fillStyle = 'rgba(8,8,16,.72)'; ctx.fillRect(8, H - 24, 150, 18);
    ctx.fillStyle = '#fff'; ctx.font = '800 12px sans-serif'; ctx.textAlign = 'left';
    var nm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
    ctx.fillText((sc.action || '') + (nm ? (' · ' + nm) : ''), 14, H - 11);
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
function _lpPent(ctx, cx, cy, rad, rot) { ctx.beginPath(); for (var i = 0; i < 5; i++) { var a = rot + i * 1.2566 - 1.5708, px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); ctx.fill(); }
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
  if (img && img.complete && img.naturalWidth) {
    var s = Math.max(W / img.naturalWidth, H / img.naturalHeight);   // cover
    var dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    ctx.drawImage(fallbackCanvas, 0, 0);
  }
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
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
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
  var ballWin = (opts && opts.straightFast) ? 0.11 : 0.22;     // ボレー: 速く（シュート相当）
  var flipH = _csAttackRight(sc);                              // ネイティブ=左攻め → team1(右)で反転
  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return; // 差し替えで外れたら停止
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);   // 1回だけ再生（ループしない）。p=1 でフォロースルーに静止
    ctx.clearRect(0, 0, W, H);
    if (!fail) {
      // ===== 成功: 通しの蹴り演出（構え→蹴り→前進） =====
      var z = 1.0 + Math.min(1, p / 0.7) * 0.10;                          // 寄りのズーム
      ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.translate(foot[0], foot[1]); ctx.scale(z, z); ctx.translate(-foot[0], -foot[1]);
      ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);
      var pl = (p < strikeP) ? A : B;                                     // 構え→蹴り
      if (pl.complete && pl.naturalWidth) { var pw = pl.naturalWidth * (ph / pl.naturalHeight); ctx.drawImage(pl, pcx - pw / 2, ground - ph, pw, ph); }
      if (p < strikeP) { _lpBall(ctx, foot[0], foot[1], 13, 0); }
      else if (p < strikeP + ballWin) { var u = (p - strikeP) / ballWin, bx = foot[0] + (goal[0] - foot[0]) * u, by = foot[1] + (goal[1] - foot[1]) * u; if (opts && opts.straightFast) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + 54, by); ctx.stroke(); ctx.lineCap = 'butt'; } _lpBall(ctx, bx, by, 13, u * (opts && opts.straightFast ? 34 : 16)); }
      var strike = (p > strikeP - 0.02 && p < strikeP + 0.08) ? 1 - Math.abs(p - strikeP) / 0.08 : 0;
      if (strike > 0) speedLines(foot[0], foot[1], strike * 0.6);
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
      else { var bx = footX + ballSpd * (p - kickP); if (bx < W + 22) _lpBall(ctx, bx, footY, 13, (p - kickP) * 73); } // 水平に右へ
      var flashF = (p > kickP - 0.02 && p < kickP + 0.08) ? 1 - Math.abs(p - kickP) / 0.08 : 0;
      if (flashF > 0) speedLines(footX, footY, flashF * 0.6);
      ctx.restore();
      if (flashF > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (flashF * 0.5) + ')'; ctx.fillRect(0, 0, W, H); } // カット衝撃フラッシュ
    }
    hud();
    // p=1 で停止（ループ解除）。ただし失敗で2人絵がまだロード中なら、ロード完了まで継続（差し替え漏れ防止）。
    if (p < 1 || (fail && failBase && !failBase.complete)) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return canvas;
}

// GKのキット色を選ぶ: 両チーム（攻撃/守備）と別色＋「GKらしい色」優先（黄/暗/白）。
// 緑は背景（芝）に埋もれるため除外。
var _GK_PREF = ['yellow', 'dark', 'white', 'skyblue', 'orange', 'blue', 'red'];
function _pickGkColor(atkColor, defColor) {
  var atk = _colorBucket(atkColor), def = _colorBucket(defColor);
  for (var i = 0; i < _GK_PREF.length; i++) { var k = _GK_PREF[i]; if (k !== atk && k !== def) return k; }
  return 'yellow';
}

// ============================================================
// シュート専用カットイン: シューター（1フレーム・攻撃チーム色）＋コードのボール。
//   セーブ(GK防いだ！)=シューター＋GK(左・自動コントラスト色)＋ボールが手元で弾かれる。
//   枠外/ブロック=現状の左へ抜ける簡易演出（後で専用画像に差し替え）。ゴール！！は takeover 側。
//   1回再生で静止（ループしない）。detach で停止。
// ============================================================
function _renderShotScene(sc, entry) {
  var W = 480, H = 216, ground = 190;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var shooter = _loadCutsceneImg(entry.file);
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
  var gkImg = isSave ? _loadCutsceneImg('img/cutscenes/gk_' + gkColor + '_01.png') : null;

  var ph = 178, pcx = 326, sprW = 133;                        // 右配置（ロングパス同様）。スプライトは元から左向き＝反転不要
  var sx0 = pcx - sprW / 2, sy0 = ground - ph;
  var foot = [sx0 + sprW * 0.42, sy0 + ph * 0.79];            // 軸足のすねの前＝ボール起点（赤枠位置・TUNE）
  var strikeP = 0.12, ballSpd = 2400, P = 1700;               // まっすぐ左へ・ロングパスより速い
  var flipH = _csAttackRight(sc);                             // ネイティブ=左攻め → team1(右)で反転

  function speedLines(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 14, y + Math.sin(an) * 14); ctx.lineTo(x + Math.cos(an) * 58, y + Math.sin(an) * 58); ctx.stroke(); } }
  function hud() {
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
    ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.translate(foot[0], foot[1]); ctx.scale(z, z); ctx.translate(-foot[0], -foot[1]);
    ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    if (shooter.complete && shooter.naturalWidth) { var pw = shooter.naturalWidth * (ph / shooter.naturalHeight); ctx.drawImage(shooter, pcx - pw / 2, ground - ph, pw, ph); }
    if (isSave) {
      // ===== セーブ: GK(左)＋ボールが手元で弾かれる =====
      var gkW = 210, gkH = gkW * 127 / 220, gkX = 8, gkY = 58;                 // GK配置（TUNE）
      if (gkImg && gkImg.complete && gkImg.naturalWidth) ctx.drawImage(gkImg, gkX, gkY, gkW, gkH);
      var hX = gkX + gkW * 0.84, hY = gkY + gkH * 0.13, savP = 0.46;           // GKの手元＝ボール到達点（TUNE）
      if (p < strikeP) { _lpBall(ctx, foot[0], foot[1], 11, 0); }              // かかとで待つ
      else if (p < savP) { var u = (p - strikeP) / (savP - strikeP); _lpBall(ctx, foot[0] + (hX - foot[0]) * u, foot[1] + (hY - foot[1]) * u, 11, (p - strikeP) * 70); }   // 手元へ飛ぶ
      else { var u2 = Math.min(1, (p - savP) / 0.34), ue = 1 - (1 - u2) * (1 - u2); _lpBall(ctx, hX - 72 * ue, hY - 34 * ue, 11, 14 + u2 * 18); }                          // 弾かれて左上へ
      var sv = (p > savP - 0.03 && p < savP + 0.10) ? 1 - Math.abs(p - savP) / 0.10 : 0;
      if (sv > 0) speedLines(hX, hY, sv * 0.7);                                // セーブ・インパクト
    } else {
      if (p < strikeP) { _lpBall(ctx, foot[0], foot[1], 11, 0); }             // かかとで待つ
      else { var bx = foot[0] - ballSpd * (p - strikeP); if (bx > -16) _lpBall(ctx, bx, foot[1], 11, (p - strikeP) * 80); } // まっすぐ左へ（高速）
    }
    var strikeF = (p > strikeP - 0.02 && p < strikeP + 0.08) ? 1 - Math.abs(p - strikeP) / 0.08 : 0;
    if (strikeF > 0) speedLines(foot[0], foot[1], strikeF * 0.6);    // 蹴り出しバースト
    ctx.restore();
    if (strikeF > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (strikeF * 0.45) + ')'; ctx.fillRect(0, 0, W, H); }
    hud();
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return canvas;
}

// ============================================================
// ショートパス: 単一フレームのパサー＋コードのボールで「近くの味方へ短い地上パス」。攻撃側チーム色・左攻めネイティブ。
//   1回再生で静止（パス到達でボールが止まる）。生成元 tools/art/cutscenes/shortpass.png。
// ============================================================
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

  // 最頻出のショートパスにバリエーション: 3パターンからランダムに1ポーズ（ユーザー要望）。
  //   pose0 = 従来のプリカラー小スプライト(entry.file) / pose1 = onetwo2(走り) / pose2 = onetwo1(パサー) を実行時リカラー。
  //   ※ onetwo3 は「ボールをトラップ＝③受け手」なのでパス演出に不適 → パサーの onetwo1 を使う。
  //   foot=蹴り足のボール起点(絶対座標)・spriteFlip=pcx中心でスプライトを反転。
  //   向きは3ポーズとも「攻撃方向=ボールの進む向き」を向く（flipHで team1/team2 両対応）。
  //   ★重要: 各スプライトのネイティブ向きが異なるので spriteFlip は個別設定。
  //     表示向き = native XOR spriteFlip XOR flipH。ボールは pre-flipH で左へ進む＝攻撃方向。
  //     よって「pre-flipH で左を向く」= native XOR spriteFlip === 左 になるよう spriteFlip を決める。
  //     pose0=native右→true／onetwo2=native右→true／onetwo1=native左→false。
  //     （pose0 は元々 true。v2.2.17 で誤って false にしていたのを復帰）
  var _poses = [
    { img: _loadCutsceneImg(entry.file),   rc: null,  ph: 178, pcx: 318, foot: [300, 160], spriteFlip: true },   // 従来スプライト: native右→反転
    { img: _loadCutsceneImg(_ONETWO2_SRC), rc: 'ot2', ph: 182, pcx: 318, foot: [300, 166], spriteFlip: true },   // onetwo2(走り): native右→反転
    { img: _loadCutsceneImg(_ONETWO1_SRC), rc: 'ot1', ph: 182, pcx: 318, foot: [300, 166], spriteFlip: false }   // onetwo1(パサー): native左→反転無し
  ];
  var _pose = _poses[Math.floor(Math.random() * _poses.length)];
  var ph = _pose.ph, pcx = _pose.pcx, foot = _pose.foot;
  var kickP = 0.12, ballSpd = 1300, P = 1500;                // 水平に蹴り出し・少し速め
  var flipH = _csAttackRight(sc);                            // ネイティブ=左攻め → team1(右)で反転

  function speedLines(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12); ctx.lineTo(x + Math.cos(an) * 48, y + Math.sin(an) * 48); ctx.stroke(); } }
  function hud() {
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
    var sprImg = _pose.rc ? (_recolorPostplay(_pose.img, accent, accent, _pose.rc) || _pose.img) : _pose.img;
    var _snw = sprImg.naturalWidth || sprImg.width, _snh = sprImg.naturalHeight || sprImg.height;   // リカラー後はcanvas(naturalWidth無し)→width
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
  return canvas;
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
  function withScene(draw) { ctx.save(); if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.imageSmoothingEnabled = false; draw(); ctx.restore(); }   // 静止カメラ（選手は動かさない）。ミラーのみ。
  function hud() {
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
  return canvas;
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
  var kx = 282, kh = 182;            // キッカー中心x・身長
  var bx0 = 348, by0 = ground - 10;  // ボール起点＝右下（添付の赤丸位置）。軸足側へボール1個分(24px)寄せ済(372→348)
  var vx = 2380, vy = 880;           // シュートと同等速度（≈1.4px/ms）・浅い左上へ直進（slope≈0.37）

  function speedLines(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12); ctx.lineTo(x + Math.cos(an) * 50, y + Math.sin(an) * 50); ctx.stroke(); } }
  function drawSprF(img, cx, footY, h, flip) { if (!img) return; var nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height; if (!nw) return; var w = nw * (h / nh); ctx.save(); if (flip) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); } ctx.drawImage(img, cx - w / 2, footY - h, w, h); ctx.restore(); }
  function withScene(draw) { ctx.save(); if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.imageSmoothingEnabled = false; draw(); ctx.restore(); }   // 静止カメラ・ミラーのみ
  function hud() {
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
    var spr1 = _recolorPostplay(img1, atkColor, atkColor, 'fk1') || img1;   // 赤キット→攻撃チーム色
    var spr2 = _recolorPostplay(img2, atkColor, atkColor, 'fk2') || img2;
    ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);

    var contact = 0;
    if (p < sw) {
      // ① 蹴る前: 振りかぶり。ボールは足元で静止。
      withScene(function () {
        drawSprF(spr1, kx, ground, kh, false);   // freekick1 は左向き＝ネイティブのまま
        _lpBall(ctx, bx0, by0, 12, 0);
      });
    } else {
      // ② 蹴った瞬間: 振り抜き。ボールは右下の起点からシュート速度で浅く左上（ゴール方向）へ直進。
      var dt = p - sw;                                  // p単位の経過（ballSpd×dt＝シュートと同じ速度感）
      var bx = bx0 - vx * dt;
      var by = by0 - vy * dt;                           // 浅い角度で左上へ（直進・弧なし）
      contact = (dt < 0.06) ? (1 - dt / 0.06) : 0;
      withScene(function () {
        drawSprF(spr2, kx, ground, kh, false);
        if (bx > -20 && by > -20) _lpBall(ctx, bx, by, 12, dt * 120);
        if (contact > 0) speedLines(bx0, by0, contact * 0.8);
      });
    }
    if (contact > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (contact * 0.5) + ')'; ctx.fillRect(0, 0, W, H); }   // インパクトのフラッシュ
    hud();
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return canvas;
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
var _DRIBBLE_SRC = 'img/cutscenes/dribble_01.png';
var _DRIBBLE_DEF_SRC = 'img/cutscenes/dribbledef_01.png';
function _renderDribbleScene(sc) {
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

  var dribPh = 184, defPh = 168, P = success ? 1000 : 1800, zc = [240, 116];   // 成功は尺を半分に
  var flipH = !_csAttackRight(sc);                                  // ネイティブ=右攻め → team2(左)で反転

  function speedLines(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12); ctx.lineTo(x + Math.cos(an) * 52, y + Math.sin(an) * 52); ctx.stroke(); } }
  function drawSpr(img, cx, footY, hgt) { if (!img) return; var nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height; if (!nw) return; var w = nw * (hgt / nh); ctx.drawImage(img, cx - w / 2, footY - hgt, w, hgt); }
  function hud() {
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
      ballX = dribX + 50; ballY = ground - 26;          // ボールはドリブラーの少し前・スパイク高さ（上げ）
    } else {
      dribX = 196;                                      // ドリブラー静止（攻撃成功時と同じ位置）
      defX = 265;                                       // 守備は攻撃成功時と同じ位置
      var bootX = defX - 50, bootY = ground - 24, kp = 0.10;   // 守備の伸ばした足のスパイク＝ボール起点（pixel計測: frac 0.10/0.83・TUNE）
      ballX = bootX - 1450 * Math.max(0, p - kp); ballY = bootY;   // スパイクから並行に左へ弾き返す
      contact = (p > kp - 0.02 && p < kp + 0.10) ? 1 - Math.abs(p - kp) / 0.10 : 0;
    }
    ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.translate(zc[0], zc[1]); ctx.scale(z, z); ctx.translate(-zc[0], -zc[1]);
    ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    drawSpr(defSpr, defX, ground, defPh); drawSpr(dribSpr, dribX, ground, dribPh);   // 守備は常にドリブラーの後ろ（先に描画）
    if (ballY < H + 20 && ballX > -20 && ballX < W + 20) _lpBall(ctx, ballX, ballY, 12, p * 15);   // 回転は緩め（さらに半分）
    if (contact > 0) speedLines(ballX, ballY, contact * 0.8);
    ctx.restore();
    if (contact > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (contact * 0.4) + ')'; ctx.fillRect(0, 0, W, H); }
    hud();
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return canvas;
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
var _POSTPLAY_SRC = 'img/cutscenes/postplay_t_01.png?v=pp5';
var _POSTPLAY_FAIL_SRC = 'img/cutscenes/postplay_fail_t_01.png?v=pp5';
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

  function dom(id) { var el = (typeof document !== 'undefined') && document.getElementById(id); return el ? el.textContent : ''; }
  var timeTxt = dom('game-time-display');
  var atkP = sc.offence && sc.offence.players && sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  var atkName = atkP ? ((typeof getPlayerName === 'function') ? getPlayerName(atkP) : atkP.name) : '';
  var defP = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[sc.dfsPos]];
  var defName = defP ? ((typeof getPlayerName === 'function') ? getPlayerName(defP) : defP.name) : '';
  var atkTeamNm = (typeof getTeamName === 'function' && sc.offence) ? getTeamName(sc.offence) : '';
  var defTeamNm = (typeof getTeamName === 'function' && sc.defence) ? getTeamName(sc.defence) : '';
  var en = (typeof window !== 'undefined' && window.LANG === 'en');
  var label = success ? (en ? 'HOLD-UP!' : 'ポストプレー！') : (en ? 'DISPOSSESSED!' : '奪われた！');
  var labelCol = success ? '#ffe14a' : '#ff5a3c';
  var accent = success ? atkColor : defColor;

  var postImg = _loadCutsceneImg(_POSTPLAY_SRC);
  var failImg = _loadCutsceneImg(_POSTPLAY_FAIL_SRC);
  var dribImg = _loadCutsceneImg(_DRIBBLE_SRC);   // 反転突破は「抜け出し」と同じランナー単独を流用（守備なし）
  var P = success ? 2000 : 1700, zc = [240, 116];
  var flipH = !_csAttackRight(sc);

  function speedLines(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12); ctx.lineTo(x + Math.cos(an) * 52, y + Math.sin(an) * 52); ctx.stroke(); } }
  function drawSpr(img, cx, footY, hgt) { if (!img) return; var nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height; if (!nw) return; var w = nw * (hgt / nh); ctx.drawImage(img, cx - w / 2, footY - hgt, w, hgt); }
  function hud() {
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
        withFlip(!flipH, function () {                                                   // タブロー絵はネイティブ向きが逆＝!flipHで攻撃方向に合わせる
          var ppSpr = _recolorPostplay(postImg, atkColor, defColor, 'pp') || postImg;    // 赤→攻撃色・緑→守備色（ホールドアップ・2人タブロー）
          drawSpr(ppSpr, 244, ground, 168);                                          // 少し小さく（190→168）
          _lpBall(ctx, 224, ground - 14, 11, 0);                                     // 足元のボール
        });
      } else {
        var u = (p - pSwap) / (1 - pSwap), ue = 1 - (1 - u) * (1 - u);
        // ランナー単独（「抜け出し」成功と同じ）。向きは他のドリブル/飛び出しと同じ攻撃方向（flipH）。
        withFlip(flipH, function () {
          var dribSpr = _csRecolorBand(dribImg, 'green', atkColor, 'drb') || dribImg; // 緑→攻撃色（ランナー単独）
          var dribX = 196 + 150 * ue;
          drawSpr(dribSpr, dribX, ground, 172);                                       // ランナー（少し小さく）
          _lpBall(ctx, dribX + 48, ground - 24, 11, u * 15);                          // ボールは前方
        });
      }
    } else {
      withFlip(!flipH, function () {                                                  // タブロー絵はネイティブ向きが逆＝!flipHで攻撃方向に合わせる
        var fSpr = _recolorPostplay(failImg, atkColor, defColor, 'ppfail') || failImg;    // 赤→攻撃色・緑→守備色
        drawSpr(fSpr, 240, ground + 2, 150);                                         // タイト画像：足元を接地ラインへ
      });
      var kp = 0.12, bootX = 244, bootY = ground - 8;
      var ballX = bootX + 1450 * Math.max(0, p - kp), ballY = bootY;                  // 弾かれて流れる
      contact = (p > kp - 0.02 && p < kp + 0.10) ? 1 - Math.abs(p - kp) / 0.10 : 0;
      withFlip(!flipH, function () {                                                  // 図と同じ反転でボールも描く
        if (ballX > -20 && ballX < W + 20) _lpBall(ctx, ballX, ballY, 12, p * 15);
        if (contact > 0) speedLines(bootX, bootY, contact * 0.8);
      });
    }
    if (contact > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (contact * 0.4) + ')'; ctx.fillRect(0, 0, W, H); }
    hud();
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return canvas;
}

// ============================================================
// 飛び出し（Run In Behind）専用カットイン: 裏のスペースへ出たスルーパスへ走り込む演出。
//   成功=dribble の走るスプライト（攻撃=緑→攻撃色）でランナー単独を描き、ボールを前方へ転がして
//     「守備を振り切り単独で追いつく」振り付け（守備は描かない・dribble と差別化・新規アート不要）。
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

  var runPh = 182, P = success ? 1500 : 1700, zc = [230, 150];
  var flipH = !_csAttackRight(sc);                                 // 成功スプライト: ネイティブ=右攻め → team2(左)で反転
  var flipFail = _csAttackRight(sc);                               // 失敗タブロー: longpass_fail と同じ向き(ネイティブ=左攻め)
  var failBase = success ? null : _loadCutsceneImg(_LP_FAIL_SRC);  // 失敗=カット・タブロー（赤×緑の2人絵）
  function eo(x) { return 1 - (1 - x) * (1 - x); }                 // ease-out quad

  function drawSpr(img, cx, footY, hgt) { if (!img) return; var nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height; if (!nw) return; var w = nw * (hgt / nh); ctx.drawImage(img, cx - w / 2, footY - hgt, w, hgt); }
  function burst(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 14, y + Math.sin(an) * 14); ctx.lineTo(x + Math.cos(an) * 56, y + Math.sin(an) * 56); ctx.stroke(); } }
  function trail(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2; for (var i = 0; i < 5; i++) { var yy = y + i * 17; ctx.beginPath(); ctx.moveTo(x - 14, yy); ctx.lineTo(x - 58, yy); ctx.stroke(); } }
  function hud() {
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

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    if (success) {
      // ===== 成功: 守備を振り切り、ランナー単独で前方のスルーパスへ走り込む（守備は描かない）=====
      var runSpr = _csRecolorBand(runImg, 'green', atkColor, 'drb');     // 緑→攻撃色（dribble と同一キャッシュ）
      var z = 1.0 + Math.min(1, p / 0.6) * 0.04;
      var sprint = Math.min(1, p / 0.5) * (1 - Math.max(0, (p - 0.8) / 0.2));   // 疾走中だけ速度線（p0.8→1で消える）
      var u = eo(p);
      var runX = 150 + 210 * u;                              // 単独で前進
      var ballX = 372 + 46 * eo(Math.min(1, p / 0.9));       // スルーパスが前方へ転がる（減速）= 追いつく先
      ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.translate(zc[0], zc[1]); ctx.scale(z, z); ctx.translate(-zc[0], -zc[1]);
      ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);
      drawSpr(runSpr, runX, ground, runPh);                                        // ランナーのみ（守備は消す）
      if (sprint > 0.05) trail(runX - 26, ground - 96, sprint * 0.5);               // ランナー後方の水平疾走線
      if (ballX > -20 && ballX < W + 20) _lpBall(ctx, ballX, ground - 11, 12, p * 16);
      ctx.restore();
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
    if (p < 1 || (!success && failBase && !failBase.complete)) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return canvas;
}

// ============================================================
// GK専用カットイン（シュートとは別カット）: 専用の緑ピッチ背景＋ダイブするGK（左→右へ少しスライド）＋
//   右上から来るボール。mode='save'=手元で弾く / 'beat'=指先を抜ける（後でゴール/枠外へ）。GK色は自動コントラスト。
//   1回再生で静止（ループしない）。detach で停止。
// ============================================================
var _GK_BG_SRC = 'img/cutscenes/gkbg_01.png';
function _renderGkScene(sc, mode) {
  var W = 480, H = 216;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var bgImg = _loadCutsceneImg(_GK_BG_SRC), bgFallback = _lpBg();
  var atkColor = (sc.offence && sc.offence.team_color) || '#1f4fd6';
  var defColor = (sc.defence && sc.defence.team_color);
  var gkColor = _pickGkColor(atkColor, defColor);
  var gkImg = _loadCutsceneImg('img/cutscenes/gk_' + gkColor + '_01.png');
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
  var gkW = 300, gkH = gkW * 127 / 220, gkX0 = 8, gkX1 = 92, gkY = 36;   // 左→右へシーン終了まで移動
  var handsFx = 0.85, handsFy = 0.13;                          // GKの手元（スプライト内フラクション・TUNE）
  var ballSpd = 2400, ballStartP = 0.42, slope = 0.16, P = 1700;   // ボールは右→左・シュートシーンと同速（同じpx/ms）
  var zc = [240, 116];                                         // ズーム中心（固定でジッター防止）
  var flipH = _csAttackRight(sc);                              // ネイティブ=左攻め(右→左シュート) → team1(右)で反転

  var T0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  var started = false;
  function frame() {
    if (canvas.isConnected) started = true; else if (started) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var p = Math.min(1, (now - T0) / P);
    ctx.clearRect(0, 0, W, H);
    var z = 1.0 + Math.min(1, p / 0.6) * 0.06;
    var slide = gkX0 + (gkX1 - gkX0) * Math.min(1, p);        // 左→右へ移動（ボールが画面外に出るまで）
    var hX = slide + gkW * handsFx, hY = gkY + gkH * handsFy;  // GKの手元（ボール通過点）
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
    var drawGK = function () { if (gkImg.complete && gkImg.naturalWidth) ctx.drawImage(gkImg, slide, gkY, gkW, gkH); };
    var drawBall = function () { if (onScreen) _lpBall(ctx, bx, by, 12, (p - ballStartP) * 120); };
    ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.translate(zc[0], zc[1]); ctx.scale(z, z); ctx.translate(-zc[0], -zc[1]);
    ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);
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
  return canvas;
}

// ============================================================
// ゴール専用カットイン（得点）: 差し替え画像 goalnet_01.png（ネットに刺さったボール）を土台に、
//   着弾インパクト（白フラッシュ＋画像の揺れ＝ネット揺れ＋ズームパンチ）＋紙吹雪＋"ゴール！！"＋得点者名を重ねる。
//   ボールは画像内にあるのでコード描画は不要＝全チーム共通の1枚（色はHUD/紙吹雪で）。1回再生で静止。
//   ※ シュートからの得点は renderSceneArt がこれをインライン表示し、showGoalCutscene 側の takeover は抑止する。
// ============================================================
var _GOAL_BG_SRC = 'img/cutscenes/goalnet_01.png';
function _renderGoalScene(sc) {
  var W = 480, H = 216;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
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
  var bY = 120, bR = 13, startX = -30, endX = W + 30;
  var ballSpd = 2400, P = 1700;                       // シュートと同速（2400px / 1700ms）
  // 枠外だけネイティブのボールが左→右で、他のシュート系(GKダイブ/シュート=右→左)と逆だった。
  // flipHを反転して「ゴールの向き＋ボール軌道」をまとめて反転し、シュート方向と一致させる。
  var flipH = !_csAttackRight(sc);

  function trail(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 46, y); ctx.stroke(); ctx.lineCap = 'butt'; }
  function hud() {
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
function _renderHeaderScene(sc) {
  var W = 480, H = 216, ground = 206;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var clashImg = _loadCutsceneImg(_HEADER_SRC), riseImg = _loadCutsceneImg(_HEADER_RISE_SRC);
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

  var ballDir = success ? 1 : -1;   // pre-flip(ネイティブ=右攻め): 成功=右 / 失敗=左。左攻めは frame の flip で全反転
  var P = 1700;

  function ballTrail(x, y, dir, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2; for (var i = 0; i < 4; i++) { var yy = y - 9 + i * 6; ctx.beginPath(); ctx.moveTo(x - dir * 10, yy); ctx.lineTo(x - dir * 46, yy); ctx.stroke(); } }
  function burst(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 13, y + Math.sin(an) * 13); ctx.lineTo(x + Math.cos(an) * 52, y + Math.sin(an) * 52); ctx.stroke(); } }
  function hud() {
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
    ctx.imageSmoothingEnabled = false;
    // 背景を下げてピッチ線を下方へ＝跳んでいる選手を相対的に高く見せる（上に隙間が出ないよう拡大して cover・新規アート不要）
    if (bgImg.complete && bgImg.naturalWidth) { var _bb = 28, _bs = Math.max(W / bgImg.naturalWidth, (H + 2 * _bb) / bgImg.naturalHeight), _bdw = bgImg.naturalWidth * _bs, _bdh = bgImg.naturalHeight * _bs; ctx.drawImage(bgImg, (W - _bdw) / 2, (H - _bdh) / 2 + _bb, _bdw, _bdh); } else { ctx.drawImage(bgFallback, 0, 0); }

    var flip = !_csAttackRight(sc);   // ネイティブ=右攻め。左攻め(team2)はシーン全体(選手＋ボール＋入射)を左右反転
    ctx.save();
    if (flip) { ctx.translate(W, 0); ctx.scale(-1, 1); }

    var sh = 168, inRise = p < riseEnd;
    // frame A=rise(跳び上がり) → frame B=clash(接触)。未ロード時は他方へフォールバック。
    var spr = inRise ? _headerRecolor(riseImg, atkColor, defColor, 'rise')
                     : _headerRecolor(clashImg, atkColor, defColor, 'clash');
    if (!spr) spr = _headerRecolor(clashImg, atkColor, defColor, 'clash') || _headerRecolor(riseImg, atkColor, defColor, 'rise');
    var headX = W / 2, headY = 40;
    if (spr) {
      var sw = spr.width * (sh / spr.height), sx = (W - sw) / 2;
      var lift = inRise ? 30 * (1 - p / riseEnd) : 0;     // rise: 下→apex へ跳び上がる / clash: apex
      var sy = ground - sh + lift;
      ctx.drawImage(spr, sx, sy, sw, sh);
      headX = sx + sw * 0.46; headY = sy + sh * 0.085;    // 頭の接触点（やや攻撃側=赤寄り）
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
    if (p < 1) requestAnimationFrame(frame);
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
  return canvas;
}

// ============================================================
// ファール専用カット: 主審(笛＋ポイント)を“いつもの背景”に重ねる。主審は中立色なので recolor しない。
//   攻撃方向で主審を左右反転（指す向き＝プレー再開方向）。笛フラッシュ＋FOUL!。元絵 tools/art/cutscenes/foul_ref_src.png。
// ============================================================
var _FOUL_REF_SRC = 'img/cutscenes/foul_ref_t_01.png';
function _renderFoulScene(sc) {
  var W = 480, H = 216, ground = 214;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated';
  var ctx = canvas.getContext('2d');
  var refImg = _loadCutsceneImg(_FOUL_REF_SRC);
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
  var accent = '#ffcf33';   // 警告色（イエロー）

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
  var label = en ? 'FOUL!' : 'ファール！';
  var flip = !_csAttackRight(sc);   // ネイティブ=右を指す。左攻めは反転して左を指す（再開方向）
  var P = 1500;

  function burst(x, y, a) { ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = 2.5; for (var i = 0; i < 14; i++) { var an = i / 14 * 6.28; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * 12, y + Math.sin(an) * 12); ctx.lineTo(x + Math.cos(an) * 44, y + Math.sin(an) * 44); ctx.stroke(); } }
  function hud() {
    var g = ctx.createLinearGradient(0, 0, 0, 46); g.addColorStop(0, 'rgba(6,6,14,.66)'); g.addColorStop(1, 'rgba(6,6,14,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 46);
    if (timeTxt) { ctx.fillStyle = '#fff'; ctx.font = '800 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(timeTxt, 12, 24); }
    // ミニスコア（色チップ＋略称＋スコア）はスコアボードへ集約のため非表示。時間(左上)とラベル/選手名は残す。
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
    ctx.clearRect(0, 0, W, H); ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (flip) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    var pop = Math.min(1, p / 0.16), z = 0.92 + 0.08 * pop;   // 主審がポップイン
    var sh = 198 * z, whX = W * 0.30, whY = H * 0.34;
    if (refImg.complete && refImg.naturalWidth) {
      var sw = refImg.naturalWidth * (sh / refImg.naturalHeight);
      var sx = W * 0.40 - sw / 2, sy = ground - sh;
      ctx.drawImage(refImg, sx, sy, sw, sh);
      whX = sx + sw * 0.30; whY = sy + sh * 0.27;             // 笛の位置（口元）
    }
    var wf = (p < 0.24) ? 1 - p / 0.24 : 0;                   // 笛フラッシュ（開始時）
    if (wf > 0) burst(whX, whY, wf * 0.9);
    ctx.restore();
    if (wf > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (wf * 0.32) + ')'; ctx.fillRect(0, 0, W, H); }
    hud();
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return canvas;
}
