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
  var list = [_LP_BG_SRC, _GK_BG_SRC, _GOAL_BG_SRC, _MISS_BG_SRC, _FOUL_REF_SRC, _POSTPLAY_FAIL_SRC, _POSTPLAY_FAIL_ATK_SRC, _POSTPLAY_FAIL_DEF_SRC, _POSTPLAY_HOLD_ATK_SRC, _POSTPLAY_HOLD_DEF_SRC, _ONETWO1_SRC, _ONETWO2_SRC, _ONETWO3_SRC];
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
// カットイン絵への焼き込み情報ラベル（左上=時刻 / 左下=アクション名 / 右下=選手名）の描画スイッチ。
//   試合画面リデザインで HUDの試合時計 と 下部の漫画ネーム枠 に情報を集約したため、
//   絵側のラベルは重複＋cover切り出しで欠けるので停止する。中央のGOAL!!/PENALTY!等の大演出は別系統(hud外)なので影響なし。
var CUTSCENE_BURN_LABELS = false; // ←将来 ui-designer がCSSオーバーレイで擬似SFX復活させる選択肢あり

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
  if (sc.action === 'ヘディングシュート') return _renderHeaderRiseDuelScene(shotSc) || _renderHeaderScene(shotSc);   // 対決割りRise優先・旧重ね絵フォールバック
  var entry = _pickCutscene('shot', sc.offence && sc.offence.team_color);   // ← PK もここ（シュート絵）
  if (entry && entry.file) return _renderShotScene(shotSc, entry);
  return null;
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
    return _renderHeaderRiseDuelScene(_ck) || _renderHeaderScene(_ck);   // 対決割りRise優先・旧重ね絵フォールバック
  }
  if (sc.result === 'ファール') return _renderFoulScene(sc);   // ファール=主審カット（全アクション共通・recolorなし・笛＆FOUL!）
  if (sc.action === 'ミドルシュート') return _renderMidShotScene(sc);   // 専用ミドル: 成功(抜け)=直進 / ブロック=右上deflect。ゴールでも goal-net でなくミドル演出。
  if (sc.result === 'ゴール！！') return _renderGoalScene(sc);   // 全ゴール=新ゴール演出（旧バイシクル廃止）
  if (sc.action === 'フリーキック') return _renderFreekickScene(sc);   // FK=専用2フレーム（枠外/セーブ等の非分割時もここ。ゴールは上で処理）
  // ヘディング競り合い（クロス/セットプレー段, result=成功/失敗）= 専用ヘディング演出。シュート段(scenario=シュート)は下の通常処理へ。
  if (sc.action === 'ヘディングシュート' && sc.scenario !== 'シュート') return _renderHeaderRiseDuelScene(sc) || _renderHeaderScene(sc);   // 対決割りRise優先・旧重ね絵フォールバック
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
    var ballOn = (bx !== null && bx > -30 && bx < W + 30);
    if (ballOn) _lpBall(ctx, bx, by, 12, p * 40);
    if (impact > 0) burst(bx, by, impact * 0.9);
    ctx.restore();
    if (impact > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (impact * 0.4) + ')'; ctx.fillRect(0, 0, W, H); }
    hud();
    if (p < 1) requestAnimationFrame(frame);
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
var _MANGA_GK_DIVE_SRC = 'img/cutscenes/manga_gk_dive.png';
// GKダイブ絵のアスペクト（高さ/幅）。旧絵=220×127→0.577。新絵(2026-07-15・茶wavy・より縦に伸びるダイブ)=440×368→0.836。
// 描画は gkW を基準に gkH = gkW * _GK_DIVE_HW で算出（従来ハードコード 127/220 を置換）。手元グローブは新絵でも約(0.86,0.12)＝従来アンカーとほぼ一致。
var _GK_DIVE_HW = 368 / 440;
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

// 漫画コマ「演出」の一括スイッチ（2026-07-15 ユーザー指示で一旦停止）。
//   false: 紙白＋集中線背景・墨リム・対決割り・顔カットイン・ヘディング縦2コマを止め、従来のスタジアム/芝背景スタイルで描く。
//   ※スプライトの新旧はこのフラグと独立: シュート/GK/ロングパスは新素材（MangaRecolorリカラー）を従来演出の上に描く（2026-07-15 指示）。
//   ヘディングのみ旧スプライト（旧重ね競り合いシーンごと）。漫画演出の再開は true に戻すだけ。
var MANGA_COMIC_STYLE = false;

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
  var _shKey = 'shot|' + _feat.hstyle + '|' + _cols.shirt + _cols.shorts + _cols.socks + _cols.accent + _cols.skin;
  var shooter = _loadCutsceneImg('img/cutscenes/manga_shot/' + _feat.hstyle + '.png');

  // 左パネル: GKダイブ（_pickGkColor＝両チームと別色・ダイブ絵ビートと同キー＝リカラーキャッシュ共有）
  var accent = (sc.offence && sc.offence.team_color) || '#1f4fd6';
  var gkColor = _pickGkColor(accent, sc.defence && sc.defence.team_color);
  var gkP0 = sc.defence && sc.defence.players && sc.defence.players[sc.defence.lineup[0]];
  var _gkCols = _gkDiveColors(gkColor, _mangaFeat(gkP0 ? (gkP0.long_name || gkP0.name || '') : '').skin);
  var _gkKey = 'gkdive|' + gkColor + '|' + _gkCols.skin;
  var gkImg = _loadCutsceneImg(_MANGA_GK_DIVE_SRC);

  // ジオメトリ（native: 右=シューター/左=GK・ボール右→左）
  var ph = 172, pcx = W * 0.80, sprW = 133;
  var foot = [pcx - sprW / 2 + sprW * 0.42, ground - ph + ph * 0.79];   // 蹴り点（既存拍1と同式）
  var dTop = W * 0.40, dBot = W * 0.60;                                 // 対角割り線（上→下で右へ・急角度）
  var gkW = 264, gkH = gkW * _GK_DIVE_HW, gkX = -14, gkY = 52;            // GK大ゴマ（パネル高の7割級・はみ出しクロップ上等）
  var hX = gkX + gkW * 0.85, hY = gkY + gkH * 0.13;                     // GKの手元（既存 handsFx/Fy と同フラクション）
  var target = [hX + 30, hY + 6];                                       // ボール静止点＝手元の少し手前（結果非開示）
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
    ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.imageSmoothingEnabled = true;   // 高解像度マンガ絵＝スムージング縮小（falseだとNN間引きでジャギ・斑点 2026-07-15）

    // ── 左パネル: GK焦点のスピード線＋ネット＋GK大（微ズーム）──
    ctx.save(); leftClip();
    var zL = 1.0 + Math.min(1, p / 0.7) * 0.06;
    var gc = [gkX + gkW * 0.5, gkY + gkH * 0.55];
    ctx.translate(gc[0], gc[1]); ctx.scale(zL, zL); ctx.translate(-gc[0], -gc[1]);
    ctx.drawImage(_mangaShotBg(W, H, hX - 40, hY + 30), 0, 0);
    _csDrawNet(ctx, 4, 24, 116, 154, 0.16);
    var gkSpr = (gkImg.complete && gkImg.naturalWidth) ? MangaRecolor.render(_gkKey, gkImg, _gkCols) : null;
    if (gkSpr) { rim4(_csInkSil(gkSpr, _gkKey), gkX, gkY, gkW, gkH); ctx.drawImage(gkSpr, gkX, gkY, gkW, gkH); }
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
    ctx.restore();
    // スプライト未ロード中は尺を超えても少し待つ（初回404様の固まり防止・上限 P+3000ms）
    if (p < 1 || ((!shSpr || !gkSpr) && (now - T0) < P + 3000)) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return _csCenterSubject(canvas, 0.5, false);   // 両雄構図＝中央
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
function _renderShotScene(sc, entry) {
  // 構図ローテーション（lab）: 決定論ハッシュが奇数 → Var A=対角対決割り（_renderShotDuelScene）。偶数 → Var B=2拍（本体）。
  //   対象は result='成功'（分割'shot'ビート/PK蹴り＝結果非開示）のみ。ブロック等の結果付き描画は Var B 固定。
  //   MangaRecolor 未ロードの公開ビルドはこの分岐に入らず常に従来経路＝公開版不変。
  if (MANGA_COMIC_STYLE && typeof MangaRecolor !== 'undefined' && MangaRecolor.render && sc.result === '成功' && (_csShotVarHash(sc) & 1)) {
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
  var _shKey = _shFeat ? ('shot|' + _shFeat.hstyle + '|' + _shCols.shirt + _shCols.shorts + _shCols.socks + _shCols.accent + _shCols.skin) : null;
  var shooter = _shotManga ? _loadCutsceneImg('img/cutscenes/manga_shot/' + _shFeat.hstyle + '.png') : _loadCutsceneImg(entry.file);
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
  var _svGkKey = _svGkManga ? ('gkdive|' + gkColor + '|' + _svGkCols.skin) : null;
  var gkImg = isSave ? (_svGkManga ? _loadCutsceneImg(_MANGA_GK_DIVE_SRC) : _loadCutsceneImg('img/cutscenes/gk_' + gkColor + '_01.png')) : null;

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

  var ph = 178, pcx = 326, sprW = 133;                        // 右配置（ロングパス同様）。スプライトは元から左向き＝反転不要
  var sx0 = pcx - sprW / 2, sy0 = ground - ph;
  var foot = [sx0 + sprW * 0.42, sy0 + ph * 0.79];            // 軸足のすねの前＝ボール起点（赤枠位置・TUNE）
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
    ctx.save(); if (flipH) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.translate(foot[0], foot[1]); ctx.scale(z, z); ctx.translate(-foot[0], -foot[1]);
    ctx.imageSmoothingEnabled = SS > 1;   // マンガ絵=スムージング / ドット絵=NN維持（2026-07-15）
    if (_mangaBg) ctx.drawImage(_mangaShotBg(W, H, foot[0], foot[1] - 10), 0, 0);   // 拍1: 紙白＋放射スピード線＋網点
    else _lpDrawBg(ctx, bgImg, bgFallback, W, H);
    var _shSpr = (_shotManga && shooter.complete && shooter.naturalWidth) ? MangaRecolor.render(_shKey, shooter, _shCols) : ((shooter.complete && shooter.naturalWidth) ? shooter : null);
    if (_shSpr) {
      var pw = _shSpr.width * (ph / _shSpr.height);
      if (_shotManga && _shKey) _shSpr = _csPixelate(_shSpr, _shKey, pw, ph);   // レトロ画素化（高品質縮小→NN拡大）
      if (_mangaBg && _shKey) {   // 紙白に白キットが溶けないよう墨リム2px（シルエット4方向オフセット）
        var _sil = _csInkSil(_shSpr, _shKey), _o = 2;
        ctx.drawImage(_sil, pcx - pw / 2 - _o, ground - ph, pw, ph);
        ctx.drawImage(_sil, pcx - pw / 2 + _o, ground - ph, pw, ph);
        ctx.drawImage(_sil, pcx - pw / 2, ground - ph - _o, pw, ph);
        ctx.drawImage(_sil, pcx - pw / 2, ground - ph + _o, pw, ph);
      }
      ctx.drawImage(_shSpr, pcx - pw / 2, ground - ph, pw, ph);
    }
    if (isSave) {
      // ===== セーブ: GK(左)＋ボールが手元で弾かれる =====
      var gkW = _svGkManga ? 145 : 210, gkH = gkW * (_svGkManga ? _GK_DIVE_HW : (127 / 220)), gkX = 8, gkY = 58;   // GK配置（TUNE）。スプライト別にアスペクト＆幅を切替＝描画高≈121で従来と同じ距離感（2026-07-15）
      if (gkImg && gkImg.complete && gkImg.naturalWidth) { var _svs = _svGkManga ? MangaRecolor.render(_svGkKey, gkImg, _svGkCols) : gkImg; if (_svs && _svGkManga) _svs = _csPixelate(_svs, _svGkKey, gkW, gkH); if (_svs) ctx.drawImage(_svs, gkX, gkY, gkW, gkH); }
      var hX = gkX + gkW * 0.84, hY = gkY + gkH * 0.13, savP = 0.46;           // GKの手元＝ボール到達点（TUNE）
      if (p < strikeP) { _lpBall(ctx, foot[0], foot[1], 11, 0); }              // かかとで待つ
      else if (p < savP) { var u = (p - strikeP) / (savP - strikeP); _lpBall(ctx, foot[0] + (hX - foot[0]) * u, foot[1] + (hY - foot[1]) * u, 11, (p - strikeP) * 70); }   // 手元へ飛ぶ
      else { var u2 = Math.min(1, (p - savP) / 0.34), ue = 1 - (1 - u2) * (1 - u2); _lpBall(ctx, hX - 72 * ue, hY - 34 * ue, 11, 14 + u2 * 18); }                          // 弾かれて左上へ
      var sv = (p > savP - 0.03 && p < savP + 0.10) ? 1 - Math.abs(p - savP) / 0.10 : 0;
      if (sv > 0) speedLines(hX, hY, sv * 0.7);                                // セーブ・インパクト
    } else {
      if (p < strikeP) { _lpBall(ctx, foot[0], foot[1], 11, 0); }             // かかとで待つ
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
        if (bx > -16) _lpBall(ctx, bx, foot[1], 11, (p - strikeP) * 80);      // まっすぐ左へ（高速）
      }
    }
    if (strikeF > 0) speedLines(foot[0], foot[1], strikeF * 0.6, _mangaBg ? ('rgba(20,22,28,' + (strikeF * 0.55).toFixed(3) + ')') : null);   // 蹴り出しバースト（紙白では墨色）
    ctx.restore();
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
  // キッカーが kx=282（やや右・0.59）。mirror 込みで主役を可視窓中央へ。
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
  // 実験(2026-07-09): 成功時の守備も失敗時と同じスライダーポーズ(manga_tackle_slide)へ差し替えて試す。
  //   キー接頭辞も 'ts_' に統一（'tk_'のままだとMangaRecolorのベースキャッシュが旧追走ポーズを使い回す）。
  var defImg = defFeat ? _loadCutsceneImg('img/cutscenes/manga_tackle_slide/' + defFeat.hstyle + '.png') : null;
  var defColors = defFeat ? _mangaColors(sc.defence, defFeat.skin) : null;
  var defColorKey = defFeat ? ('ts_' + defFeat.hstyle + '|' + defColors.shirt + defColors.shorts + defColors.socks + defColors.accent + defColors.skin) : null;

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
  var bodyWDrib = 120, bodyWDef = 176;   // 実験: 成功守備もスライダー(横長)＝176（旧・成功追走は104）
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
    ctx.imageSmoothingEnabled = false; _lpDrawBg(ctx, bgImg, bgFallback, W, H);

    if (success) {
      // 成功（突破）: 起点=添付ラフの密着デュエル（守備が左肩後ろに深く重なる）を一拍見せる→ドリブラーが前へ抜け出す。
      var t = Math.max(0, (p - 0.08) / 0.92), u = t * t * (3 - 2 * t);   // ほぼ溜めなし→即バーストで抜け出し
      var heroX = heroX0 + dir * 110 * u;              // ドリブラー＝攻撃方向へ前進（守備を置き去り・移動量を長く 74→110）
      var defX = heroX0 + dir * 50;                     // 守備＝静止。中心がドリブラーを50px越える（更に深く＝守備は前方寄りに回り込み、大部分がドリブラーの陰に）
      var ballX = heroX + dir * 46;                     // ボールは前足の先
      var ballY = ground - 30;

      if (defImg) drawSprite(defImg, defColorKey, defColors, defX, ground, bodyWDef);   // 守備＝静止・先描き（ドリブラーの後ろに深く重なる）
      drawHero(heroX, ground);                          // 集中線（ピカッ）は不要のため削除（2026-07-09）
      if (ballX > -20 && ballX < W + 20) _lpBall(ctx, ballX, ballY, 12, p * 15 * dir);
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
      if (defImg) drawSprite(defImg, defColorKey, defColors, defX, ground, bodyWDef);   // スライダー＝奥z（先描き）
      drawHero(heroXf, ground);                                            // 攻撃者＝手前z（後描き・守備の手を背後に隠す）
      // 着地インパクトの集中線（控えめ・短く）＝守備の伸ばした足元(defX - dir*64)。
      var impF = (p > 0.10 && p < 0.24) ? 1 - Math.abs(p - 0.17) / 0.07 : 0;
      if (impF > 0) speedLines(defX - dir * 64, ground - 10, impF * 0.4, 34);
      // ボール: 前足(heroX0+dir*30)から着地とほぼ同時に -dir へ高速離脱→画面外(-dir側)で消える。
      var bStart = 0.14, ballX = (p < bStart) ? (heroX0 + dir * 30) : (heroX0 + dir * 30 - dir * 1600 * (p - bStart));
      if (ballX > -16 && ballX < W + 16) _lpBall(ctx, ballX, ground - 14, 11, (p < bStart) ? 0 : (-dir * (p - bStart) * 80));
    }
    hud();
    if (p < 1 || !img.complete || (defImg && !defImg.complete)) requestAnimationFrame(frame);   // 画像ロードが遅れても完了後に必ず両者を描き切る
  }
  requestAnimationFrame(frame);
  // 成功=概ね中央 / 失敗=静止構図のデュエル中心を画面中央に配置済（heroX0の後ろ寄せで調整）。screen座標で算出済＝flip無し扱い。
  return _csCenterSubject(canvas, 0.5, false);
}

var _DRIBBLE_SRC = 'img/cutscenes/dribble_01.png';
var _DRIBBLE_DEF_SRC = 'img/cutscenes/dribbledef_01.png';
function _renderDribbleScene(sc) {
  // lab限定：漫画スプライトが使えるなら漫画ドリブルへ（本番は MangaRecolor 未定義→従来描画）。
  if (_MANGA_DRIB_ENABLED && typeof MangaRecolor !== 'undefined' &&
      (typeof window === 'undefined' || window.MANGA_CUTSCENE_ENABLED !== false)) {
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

  var dribPh = 184, defPh = 168, P = success ? 1000 : 1800, zc = [240, 116];   // 成功は尺を半分に
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
  // 飛び出し=ランナー/タブローとも概ね中央（0.5）。既定 50% と同等だが明示。
  return _csCenterSubject(canvas, 0.5, false);
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
  var _gkKey = _gkManga ? ('gkdive|' + gkColor + '|' + _gkCols.skin) : null;
  var gkImg = _gkManga ? _loadCutsceneImg(_MANGA_GK_DIVE_SRC) : _loadCutsceneImg('img/cutscenes/gk_' + gkColor + '_01.png');
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
  var gkW = _gkManga ? 205 : 300, gkH = gkW * (_gkManga ? _GK_DIVE_HW : (127 / 220)), gkX0 = 8, gkX1 = 92, gkY = 36;   // 左→右へ移動。スプライト別にアスペクト＆幅を切替＝描画高≈171/173で従来と同じ距離感（近すぎ修正 2026-07-15）
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
    var drawGK = function () { if (!gkImg.complete || !gkImg.naturalWidth) return; var _s = _gkManga ? MangaRecolor.render(_gkKey, gkImg, _gkCols) : gkImg; if (_s && _gkManga) _s = _csPixelate(_s, _gkKey, gkW, gkH); if (_s) ctx.drawImage(_s, slide, gkY, gkW, gkH); };
    var drawBall = function () { if (onScreen) _lpBall(ctx, bx, by, 12, (p - ballStartP) * 120); };
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
// ファール専用カット: 主審(笛＋ポイント)を“いつもの背景”に重ねる。主審は中立色なので recolor しない。
//   攻撃方向で主審を左右反転（指す向き＝プレー再開方向）。笛フラッシュ＋FOUL!。元絵 tools/art/cutscenes/foul_ref_src.png。
// ============================================================
var _FOUL_REF_SRC = 'img/cutscenes/foul_ref_t_01.png';
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
  var bgImg = _loadCutsceneImg(_LP_BG_SRC), bgFallback = _lpBg();
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
