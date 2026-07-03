/**
 * discipline.js — カード・退場・怪我層（Sprint 2 / BACKLOG「Sprint 2 — 怪我・退場」）。
 *
 * 因果の一本線:
 *   ファール確定（simulate.js の scene.result='ファール'・1箇所のみ）
 *     → 深刻度ロール（通常 / イエロー / 一発レッド。fairplay と frustration で増幅）
 *     → 2枚目イエロー=レッド → 退場（スロット除外＝数的不利）
 *     → 被ファール選手の負傷ロール（疲労で増幅）→ 強制交代 or 枠切れで10人続行。
 *
 * 最重要ガードレール（mental.js / MENTAL_DESIGN.md と同じ作法）:
 *   1. デュエル式 ofs²/(ofs²+dfs²)・チャンス数/カウントロジックには一切触れない。
 *      効果は (a) result-hook（ファール確定後の追加ロール・CK/PK v2.5.0 と同型）と
 *      (b) 選手選抜のスキップ（selectOffencePosition/selectDefencePosition/
 *          getTeamTotalParam/selectFKKicker/PKキッカーの「退場スロット除外」＝
 *          keyplayer×2.5 と同列の既存拡張点）のみ。
 *   2. ★ rng() は disciplineOnFoul 内でのみ・ファール1回につき必ず2回消費 ★
 *      （深刻度→負傷の順で固定。結果分岐に依存させない＝seed 自己再現を単純化）。
 *      Math.random は使わない。公開ビルド（discipline.js 非同梱）では simulate.js の
 *      typeof ガードが false ＝ rng を1回も消費しない＝公開版の rng 列は完全不変。
 *   3. 負傷交代/スロット除外の「適用」はチャンス末尾（disciplineOnChanceEnd）＝
 *      「次チャンス以降の入力だけを変える」原則。カード退場はマーカーのみ（lineup 不変）
 *      なので即時反映でも名前解決を壊さない。
 *   4. エンジンへは chance 結果への disciplineEvents「追記」と scene.card / scene.injury
 *      の追記のみ（既存フィールド不変）。
 *   5. キルスイッチ: window.DISCIPLINE_ENABLED === false で全効果を無効化（既定は有効）。
 *
 * ロード順: players.js → rng.js → mental.js → discipline.js → simulate.js
 *   （simulate.js は typeof disciplineXxx === 'function' ガード付きの薄いフックのみ。
 *    ES module ではなくグローバル <script> 運用。lab 限定＝build.js の LAB_ONLY_JS）。
 */

/* ── 1. チューニング定数（全数値をここに集約・調整可能） ────────────── */
const DISCIPLINE_TUNING = {
  // カード深刻度（ファール1回あたりの基準確率。増幅後 = base × amp）
  YELLOW_BASE:         0.26,   // イエロー基準（目安 0.8〜1.2枚/試合。ファール≈2.6回/試合。
                               //   初期案0.35は実測1.19枚＋2枚目レッド0.069で過剰→減）
  RED_BASE:            0.010,  // 一発レッド基準（目安 レッド計=一発+2枚目 0.03〜0.08枚/試合。
                               //   初期案0.02は実測計0.136で過剰→減）
  // 増幅（mentalFoulFactor と同じ流儀: 1 + coef×要因、上限付き）
  CARD_DIRTY_COEF:     0.6,    // ×(100 - fairplay)/100（ラフな選手ほどカードを引き込む）
  CARD_FRUST_COEF:     0.5,    // ×frustration（イライラ＝PSトラック連動。mental.js 不在時は0）
  CARD_AMP_CAP:        2.0,    // 増幅上限
  // 負傷（被ファール選手・ファール1回あたり）
  INJURY_BASE:         0.06,   // 基準確率
  INJURY_FATIGUE_COEF: 1.0,    // ×出場消耗度 prog（_pitchChances/MATCH_CHANCES・疲労層と同じ物差し）
  INJURY_PROG_CAP:     1.2,    // prog の上限（延長で効きすぎない・FATIGUE_TUNING.PROG_CAP と同値）
  INJURY_PROB_CAP:     0.5,    // 負傷確率の安全上限
  // 交代枠（W杯ルール5枚。負傷強制交代も同じ枠を消費）
  MAX_SUBS:            5,
};

/* ── 内部ヘルパー ──────────────────────────────────────────────── */

// キルスイッチ（MENTAL_ENABLED と同じ作法）。既定=有効。
function _disciplineEnabled() {
  return !(typeof window !== 'undefined' && window && window.DISCIPLINE_ENABLED === false);
}

function _discClamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// 選手評価（manager-match.js の _mvRating と同式: 29param 平均）。
function _discRating(p) {
  if (!p || !p.params) return 0;
  let s = 0;
  for (let i = 0; i < p.params.length; i++) s += p.params[i];
  return s / p.params.length;
}

// ポジション名 → カテゴリ（manager-match.js の _mvPosCat と同式。'右SB' 等の接頭辞も拾う）。
function _discPosCat(role) {
  if (!role) return 'MF';
  if (role === 'GK') return 'GK';
  if (/CB|SB|SW/.test(role)) return 'DF';
  if (/WG|CF|FW/.test(role)) return 'FW';
  return 'MF';
}

// lineup スロットのカテゴリ（system_data のポジション名から）。
function _discSlotCat(team, pos) {
  const arr = (typeof system_data !== 'undefined' && system_data[team.system])
    ? system_data[team.system].positions : null;
  return _discPosCat(arr ? arr[pos] : '');
}

// 選手が守れるカテゴリ集合（positions 配列から）。
function _discPlayerCats(p) {
  const c = {};
  (p.positions || []).forEach(r => { c[_discPosCat(r)] = true; });
  return c;
}

// 対話モード（startGame/監督モード）の自チーム team1 か。
//   グローバル gameState（simulate.js/manager-match.js が設定）との参照一致で判定。
//   headless（harness/playMatch のローカル gs）では false ＝ UI 用グローバルを汚さない。
function _discIsInteractiveTeam1(team) {
  return typeof gameState !== 'undefined' && gameState && gameState.team1 === team;
}

// 既存交代インフラの消費済み枠（team1 の対話モードのみ subsCount/htSubsCount を合算）。
function _discExternalSubs(team) {
  if (!_discIsInteractiveTeam1(team)) return 0;
  let n = 0;
  if (typeof subsCount === 'number') n += subsCount;
  if (typeof htSubsCount === 'number') n += htSubsCount;
  return n;
}

// 退場/除外スロットのマーク（team._sentOffPos）＋退いた選手のマーク。
function _discMarkSlotOut(team, pos) {
  if (!team._sentOffPos) team._sentOffPos = {};
  team._sentOffPos[pos] = true;
}

/**
 * 負傷交代プラン（ベンチから同カテゴリ最高評価。manager-match.js の _mvBench 流儀を自前実装）。
 * @returns {{inIdx:number}|null} 交代枠なし/ベンチ候補なしなら null（=10人で続行）
 */
function _discPlanInjurySub(team, pos) {
  const T = DISCIPLINE_TUNING;
  if ((team._discSubsUsed || 0) + _discExternalSubs(team) >= T.MAX_SUBS) return null; // 枠切れ
  const cat = _discSlotCat(team, pos);
  const onPitch = {};
  for (let i = 0; i < 11 && i < team.lineup.length; i++) onPitch[team.lineup[i]] = true;
  const userSubbedOff = _discIsInteractiveTeam1(team) &&
    typeof _subbedOff !== 'undefined' && _subbedOff && typeof _subbedOff.has === 'function'
    ? _subbedOff : null;
  let best = -1, bestR = -Infinity;       // 同カテゴリ最高評価
  let bestAny = -1, bestAnyR = -Infinity; // カテゴリ不問フォールバック
  for (let i = 0; i < team.players.length; i++) {
    if (onPitch[i]) continue;
    const p = team.players[i];
    if (!p || p._injured || p._sentOff) continue;
    if (team._discOff && team._discOff[i]) continue;              // 既に退いた選手は再出場不可
    if (userSubbedOff && userSubbedOff.has(i)) continue;          // ユーザー交代で退いた選手も不可
    const cats = _discPlayerCats(p);
    if (cat === 'GK') { if (!cats.GK) continue; }                 // GK枠はGKのみ
    else if (cats.GK && !cats.DF && !cats.MF && !cats.FW) continue; // GK専任はフィールド枠に入れない
    const r = _discRating(p);
    if (cats[cat] && r > bestR) { bestR = r; best = i; }
    if (r > bestAnyR) { bestAnyR = r; bestAny = i; }
  }
  const inIdx = best >= 0 ? best : bestAny;
  return inIdx >= 0 ? { inIdx } : null;
}

/* ── 2. ランタイム API（simulate.js の薄いフックから呼ばれる） ────────── */

/**
 * 規律状態リセット（mentalResetTeam と同じ地点に相乗り。buildTeam 直後の防御的初期化）。
 */
function disciplineResetTeam(t) {
  if (!t || !t.players) return;
  t._sentOffPos = {};
  t._discOff = {};
  t._discSubsUsed = 0;
  t._discPending = [];
  for (let i = 0; i < t.players.length; i++) {
    const p = t.players[i];
    p._yellowCards = 0;
    p._sentOff = false;
    p._injured = false;
  }
}

/**
 * 退場/負傷除外スロットか（selectOffencePosition/selectDefencePosition/
 * getTeamTotalParam/selectFKKicker/PKキッカー選抜のスキップ判定に使う。超軽量）。
 */
function disciplineIsOut(team, pos) {
  return !!(team && team._sentOffPos && team._sentOffPos[pos]);
}

/**
 * ファール確定直後フック（simulate.js の scene.result='ファール' 直後・1箇所のみ）。
 * カード深刻度ロール → 2枚目イエロー=レッド → 退場マーク、続いて被ファール選手の負傷ロール。
 * ★ rng() を必ず2回消費（深刻度→負傷の順・結果分岐に依存しない）。
 *
 * @param {object} ctx { offence, defence, ofsPos, dfsPos, ofsPlayer, dfsPlayer, scene, offenceNo }
 * @returns {Array|null} disciplineEvents 記録（無ければ null）
 */
function disciplineOnFoul(ctx) {
  if (!_disciplineEnabled()) return null;
  if (!ctx || !ctx.offence || !ctx.defence || !ctx.dfsPlayer || !ctx.ofsPlayer) return null;
  const T = DISCIPLINE_TUNING;
  const events = [];
  // rng 消費はここで固定（2回）。以降は決定論。
  const cardRoll = rng();
  const injuryRoll = rng();

  const defenceNo = ctx.offenceNo === 1 ? 2 : 1;
  const dfsP = ctx.dfsPlayer;
  const isGK = ctx.dfsPos === 0;

  /* (1) カード深刻度: 通常 / イエロー / 一発レッド */
  const fpIdx = (typeof FAIR_PLAY !== 'undefined') ? FAIR_PLAY : 28;
  const dirty = _discClamp((100 - (dfsP.params ? dfsP.params[fpIdx] : 50)) / 100, 0, 1);
  const amp = Math.min(1 + T.CARD_DIRTY_COEF * dirty + T.CARD_FRUST_COEF * (dfsP.frustration || 0),
                       T.CARD_AMP_CAP);
  const pRed = T.RED_BASE * amp;
  const pYellow = T.YELLOW_BASE * amp;
  let card = null;
  if (cardRoll < pRed) card = 'red';
  else if (cardRoll < pRed + pYellow) card = 'yellow';
  // GK 例外（MVP）: 一発レッドはイエローに降格。2枚目になるイエローも出さない
  //   （GKスロット0の除外はシュート解決 lineup[0] 前提を壊すため退場させない）。
  if (isGK && card === 'red') card = 'yellow';
  if (isGK && card === 'yellow' && (dfsP._yellowCards || 0) >= 1) card = null;

  if (card) {
    let cardType = card;                 // 'yellow' | 'red' | 'second_yellow'
    let sentOff = (card === 'red');
    if (card === 'yellow') {
      dfsP._yellowCards = (dfsP._yellowCards || 0) + 1;
      if (dfsP._yellowCards >= 2) { cardType = 'second_yellow'; sentOff = true; } // 2枚目=レッド
    }
    if (sentOff) {
      // 退場: スロット除外マーカーのみ（lineup は不変＝過去シーンの名前解決を壊さない）。
      //   選抜除外(b)＋総合力除外(c)で数的不利、交代で埋められない(d)は _discOff で保証。
      _discMarkSlotOut(ctx.defence, ctx.dfsPos);
      dfsP._sentOff = true;
      if (!ctx.defence._discOff) ctx.defence._discOff = {};
      ctx.defence._discOff[ctx.defence.lineup[ctx.dfsPos]] = true;
    }
    // scene への追記（後日 renderer がカットイン/アイコンを読む。red は 2枚目でも 'red' 表示）
    if (ctx.scene) ctx.scene.card = sentOff ? 'red' : 'yellow';
    events.push({
      type: 'card',
      card: cardType,
      team: defenceNo,                   // カード対象＝当該ファールの守備側
      player: dfsP.name || null,
      playerEn: dfsP.en_name || dfsP.name || null,
      pos: ctx.dfsPos,
      sentOff: sentOff,
    });
  }

  /* (2) 負傷: 被ファール選手（攻撃側）。疲労（出場消耗度）で増幅 */
  const ofsP = ctx.ofsPlayer;
  const mc = (typeof MATCH_CHANCES !== 'undefined') ? MATCH_CHANCES : 32;
  const prog = Math.min((ofsP._pitchChances || 0) / mc, T.INJURY_PROG_CAP);
  const pInj = Math.min(T.INJURY_BASE * (1 + T.INJURY_FATIGUE_COEF * prog), T.INJURY_PROB_CAP);
  if (injuryRoll < pInj) {
    ofsP._injured = true;                // 持ち越しマーカー（SN-01・リーグが読む）
    if (ctx.scene) ctx.scene.injury = true;
    // 強制交代プランはここで確定（同一チャンス内でベンチは変わらない）、
    // 適用はチャンス末尾（disciplineOnChanceEnd）＝次チャンス以降の入力だけを変える。
    const outIdx = ctx.offence.lineup[ctx.ofsPos];
    const plan = (ctx.ofsPos === 0) ? null : _discPlanInjurySub(ctx.offence, ctx.ofsPos);
    if (!ctx.offence._discPending) ctx.offence._discPending = [];
    ctx.offence._discPending.push({
      pos: ctx.ofsPos, outIdx: outIdx, inIdx: plan ? plan.inIdx : null,
    });
    const inP = plan ? ctx.offence.players[plan.inIdx] : null;
    events.push({
      type: 'injury',
      team: ctx.offenceNo,               // 負傷は攻撃側（倒された選手）
      player: ofsP.name || null,
      playerEn: ofsP.en_name || ofsP.name || null,
      pos: ctx.ofsPos,
      subIn: inP ? (inP.name || null) : null,       // null = 枠切れ/ベンチ無し→10人続行
      subInEn: inP ? (inP.en_name || inP.name || null) : null,
    });
  }

  return events.length ? events : null;
}

/**
 * チャンス末尾フック（simulate.js の textScenes 生成後・rng 消費ゼロ）。
 * 保留中の負傷交代を適用する: lineup 差し替え＋交代枠1消費。枠/ベンチ無しはスロット除外。
 * team1（対話モード）は既存インフラ（subsCount/_subbedOff）も同時更新＝ユーザー枠と整合。
 */
function disciplineOnChanceEnd(team1, team2) {
  const teams = [team1, team2];
  for (let ti = 0; ti < 2; ti++) {
    const t = teams[ti];
    if (!t || !t._discPending || !t._discPending.length) continue;
    for (let k = 0; k < t._discPending.length; k++) {
      const pd = t._discPending[k];
      if (!t._discOff) t._discOff = {};
      t._discOff[pd.outIdx] = true;                        // 退いた選手は再出場不可
      if (pd.inIdx != null && t.lineup[pd.pos] === pd.outIdx) {
        t.lineup[pd.pos] = pd.inIdx;                       // 強制交代（次チャンスから有効）
        // 枠消費の「真実の源」は1つだけ（Codex P2-1: 二重カウント防止）。
        //   cap 判定（_discPlanInjurySub）は _discSubsUsed + _discExternalSubs(=subsCount系) の
        //   合算なので、同一交代を両方に足すと1回の強制交代が2枠に見える。
        //   対話モード team1 → 既存インフラ subsCount のみ加算（ユーザー交代と同じ枠を1消費）。
        //   それ以外（headless / team2）→ チーム内カウント _discSubsUsed のみ加算。
        if (_discIsInteractiveTeam1(t) && typeof subsCount === 'number') {
          subsCount++;
          if (typeof _subbedOff !== 'undefined' && _subbedOff && typeof _subbedOff.add === 'function') {
            _subbedOff.add(pd.outIdx);                     // 退いた選手は再出場不可（既存セマンティクス）
          }
        } else {
          t._discSubsUsed = (t._discSubsUsed || 0) + 1;
        }
      } else if (pd.pos !== 0) {
        _discMarkSlotOut(t, pd.pos);                       // 枠切れ→退場と同じスロット除外（10人）
      }
    }
    t._discPending = [];
  }
}

// Node（vm context / 連結ロード）でも参照できるよう、存在すれば module.exports にも載せる。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DISCIPLINE_TUNING,
    disciplineResetTeam, disciplineIsOut, disciplineOnFoul, disciplineOnChanceEnd,
  };
}
