/**
 * mental.js — 個性・メンタル・スキル層（PS-02〜04 / MENTAL_DESIGN.md 準拠）。
 *
 * 因果の一本線:
 *   性格（静的・名前ハッシュで決定論割当）
 *     → 試合中の心理状態の動き方（player.morale / player.frustration / team.morale）
 *     → 閾値/トリガーでスキル発動（mentalEvents 記録）
 *     → param 係数補正（getActionParam の f）＋ファール率補正（fp 乗算）。
 *
 * 最重要ガードレール（MENTAL_DESIGN.md 0章）:
 *   1. デュエル式 ofs²/(ofs²+dfs²)・チャンス数/カウントには一切触れない。
 *      効果は (a) getActionParam の係数 f（mentalParamFactor）と
 *      (b) ファール率 fp への乗算（mentalFoulFactor）の 2 箇所のみ。
 *   2. ★ Math.random / rng() を一切使わない ★（全て決定論）
 *      → rng の消費回数が変わらない＝seed 再現・イベント再現(T-03)を壊さない。
 *   3. 合成係数は [0.90, 1.10] に clamp（±10%以内）。
 *   4. エンジンへは chance 結果への mentalEvents「追記」のみ（既存フィールド不変）。
 *   5. キルスイッチ: window.MENTAL_ENABLED === false で全効果を無効化（既定は有効）。
 *
 * ロード順: players.js → rng.js → mental.js → simulate.js（simulate.js は
 *   typeof mentalXxx === 'function' ガード付きで呼ぶ薄いフックのみ）。
 *   ES module ではなくグローバル <script> 運用。
 */

/* ── 1. チューニング定数（MENTAL_DESIGN.md 1章・4章の全数値） ────────── */
const MENTAL_TUNING = {
  // 得点/失点（チーム morale は性格増幅なし・選手側のみ P 適用）
  GOAL_TEAM_MORALE:      +0.20,  // 得点チーム morale
  GOAL_SCORER_MORALE:    +0.40,  // 得点者本人 morale（×P）
  CONCEDE_TEAM_MORALE:   -0.25,  // 失点チーム morale
  CONCEDE_FRUSTRATION:   +0.10,  // 失点チームのピッチ上全員 frustration（×P）
  // デュエル
  DUEL_WIN_MORALE:       +0.10,  // 勝者 morale（×P）
  DUEL_LOSE_MORALE:      -0.10,  // 敗者 morale（×P）
  DUEL_LOSE_FRUSTRATION: +0.15,  // 敗者 frustration（×P）
  // ファール被害
  FOULED_FRUSTRATION:    +0.20,  // 倒された攻撃選手 frustration（×P）
  // 劣勢継続（2点差以上ビハインドのチーム・毎チャンス）
  LOSING_MARGIN:          2,
  LOSING_TEAM_MORALE:    -0.02,
  // 減衰（毎チャンス末尾・0 方向へ）
  DECAY_MORALE:           0.90,
  DECAY_FRUSTRATION:      0.85,
  // param 係数（4章(a): mf = 1 + 0.06×選手morale + 0.04×チームmorale → clamp）
  PARAM_PLAYER_COEF:      0.06,
  PARAM_TEAM_COEF:        0.04,
  PARAM_CLAMP_MIN:        0.90,
  PARAM_CLAMP_MAX:        1.10,
  // ファール率（4章(b): fp ×= 1 + 0.5×frustration、fp 上限 0.95）
  FOUL_FRUSTRATION_COEF:  0.5,
  FOUL_PROB_CAP:          0.95,
};

/* ── 2. 性格（受動・状態の動き方。MENTAL_DESIGN.md 2章） ─────────────
 * hash%10: 0-1=hot_headed(20%) / 2-3=streaky(20%) / 4-5=cool(20%) / 6-9=normal(40%)
 *   moraleGain       … morale 変化の増幅率 P
 *   frustrationGain  … frustration 蓄積の増幅率 P
 *   frustrationDecay … 減衰の上書き（null=既定 0.85。hot_headed は減衰量半分=×0.925 相当）
 */
const MENTAL_PERSONALITIES = {
  hot_headed: { id: 'hot_headed', name: '怒りやすい',       en_name: 'Hot-headed', moraleGain: 1.0, frustrationGain: 2.0, frustrationDecay: 0.925 },
  streaky:    { id: 'streaky',    name: '調子に乗りやすい', en_name: 'Streaky',    moraleGain: 2.0, frustrationGain: 1.0, frustrationDecay: null },
  cool:       { id: 'cool',       name: '冷静',             en_name: 'Cool',       moraleGain: 0.5, frustrationGain: 0.5, frustrationDecay: null },
  normal:     { id: 'normal',     name: 'ふつう',           en_name: 'Normal',     moraleGain: 1.0, frustrationGain: 1.0, frustrationDecay: null },
};

/**
 * 明示上書き（data-steward が主力/キャプテンのみ随時整備。初期は空）。
 *   選手名 → { personality?: 'hot_headed'|'streaky'|'cool'|'normal', skills?: ['captaincy', ...] }
 */
const MENTAL_OVERRIDES = {};

/* ── 3. スキル（能動・trigger→effect 定義形式。MENTAL_DESIGN.md 3章） ── */
const SKILL_DEFS = {
  captaincy: {
    name: 'キャプテンシー', en_name: 'Captaincy',
    trigger: 'team_concede',        // 自チーム失点時
    condition: 'on_pitch',          // 発動者がピッチ上
    effect: { type: 'team_morale_add', amount: +0.45 },  // 失点の-0.25を打ち消し+0.20へ
    maxPerMatch: 2,                 // 発動回数上限（前半/後半で1回ずつ相当）
    label: { ja: '｛選手｝がチームを鼓舞した！', en: '{player} rallies the team!' },
  },
};

/* ── 内部ヘルパー ──────────────────────────────────────────────── */

// キルスイッチ（SCENE_ART_ENABLED と同じ作法）。既定=有効。
function _mentalEnabled() {
  return !(typeof window !== 'undefined' && window && window.MENTAL_ENABLED === false);
}

// FNV-1a 32bit（決定論・rng 不使用）。種は name + '|' + (en_name||'')。
function mentalHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 性格の決定論割当（player オブジェクトに遅延キャッシュ。players.js のデータ本体は不変）。
 * 優先順: MENTAL_OVERRIDES > 名前ハッシュ。
 * @returns {object} MENTAL_PERSONALITIES のエントリ
 */
function mentalPersonality(p) {
  if (!p || !p.name) return MENTAL_PERSONALITIES.normal;
  if (p._mentalPersonality && MENTAL_PERSONALITIES[p._mentalPersonality]) {
    return MENTAL_PERSONALITIES[p._mentalPersonality];
  }
  let id = null;
  const ov = MENTAL_OVERRIDES[p.name];
  if (ov && ov.personality && MENTAL_PERSONALITIES[ov.personality]) id = ov.personality;
  if (!id) {
    const r = mentalHash(p.name + '|' + (p.en_name || '')) % 10;
    id = (r <= 1) ? 'hot_headed' : (r <= 3) ? 'streaky' : (r <= 5) ? 'cool' : 'normal';
  }
  p._mentalPersonality = id;   // 遅延キャッシュ（buildTeam のクローンごと）
  return MENTAL_PERSONALITIES[id];
}

function _mclamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// 選手 morale 加算（性格増幅 P 込み・[-1,1] clamp）。
function _mentalAddMorale(p, base) {
  if (!p) return;
  p.morale = _mclamp((p.morale || 0) + base * mentalPersonality(p).moraleGain, -1, 1);
}
// 選手 frustration 加算（性格増幅 P 込み・[0,1] clamp）。
function _mentalAddFrustration(p, base) {
  if (!p) return;
  p.frustration = _mclamp((p.frustration || 0) + base * mentalPersonality(p).frustrationGain, 0, 1);
}
// チーム morale 加算（チームレベルは性格増幅なし・[-1,1] clamp）。
function _mentalAddTeamMorale(t, base) {
  if (!t) return;
  t.morale = _mclamp((t.morale || 0) + base, -1, 1);
}

/**
 * キャプテン決定（players 配列 index を返す・決定論）。
 *   TEAM_DATA.captain（buildTeam が team.captain へ転写・任意）があればその選手。
 *   無ければスタメン中フィールドプレイヤー（GK除く lineup 1-10）で
 *   params[27]（メンタリティ=MENTALITY）最大（同値は lineup 順で先）。
 */
function _mentalCaptainIdx(team) {
  if (!team) return -1;
  if (typeof team._captainIdx === 'number') return team._captainIdx;
  let idx = -1;
  if (typeof team.captain === 'number' && team.captain >= 0 && team.captain < team.players.length) {
    idx = team.captain;
  } else {
    let best = -Infinity;
    for (let pos = 1; pos < 11; pos++) {
      const pi = team.lineup[pos];
      const p = team.players[pi];
      if (!p || !p.params) continue;
      const v = p.params[typeof MENTALITY !== 'undefined' ? MENTALITY : 27]; // メンタリティ（players.js の MENTALITY 定数）
      if (v > best) { best = v; idx = pi; }   // 同値は lineup 順で先＝ > のみ
    }
  }
  team._captainIdx = idx;
  return idx;
}

// スキル保持者（players index の配列）: キャプテン（captaincy 固有）＋ MENTAL_OVERRIDES.skills。
function _mentalSkillHolders(team, skillId) {
  const holders = [];
  if (skillId === 'captaincy') {
    const cap = _mentalCaptainIdx(team);
    if (cap >= 0) holders.push(cap);
  }
  for (let i = 0; i < team.players.length; i++) {
    const ov = MENTAL_OVERRIDES[team.players[i].name];
    if (ov && Array.isArray(ov.skills) && ov.skills.indexOf(skillId) >= 0 && holders.indexOf(i) < 0) {
      holders.push(i);
    }
  }
  return holders;
}

/* ── 4. ランタイム API（simulate.js の薄いフックから呼ばれる） ────────── */

/**
 * 心理状態リセット（既存 fatigue/chance_counter リセット地点に相乗り）。
 * キャプテンもここで確定（＝スタメン基準・決定論）。キルスイッチ無効時も状態はクリアする。
 */
function mentalResetTeam(t) {
  if (!t || !t.players) return;
  t.morale = 0;
  t._skillUses = {};
  t._captainIdx = undefined;
  for (let i = 0; i < t.players.length; i++) {
    t.players[i].morale = 0;
    t.players[i].frustration = 0;
  }
  _mentalCaptainIdx(t);   // スタメン時点でキャプテン確定
}

/**
 * デュエル解決後フック（判定そのものは不変・結果を読むだけ）。
 * @param {object} offPlayer 攻撃選手
 * @param {object} dfsPlayer 守備選手
 * @param {boolean} won      攻撃側が勝ったか（result === '成功'）
 */
function mentalOnDuel(offPlayer, dfsPlayer, won) {
  if (!_mentalEnabled()) return;
  const T = MENTAL_TUNING;
  const winner = won ? offPlayer : dfsPlayer;
  const loser  = won ? dfsPlayer : offPlayer;
  _mentalAddMorale(winner, T.DUEL_WIN_MORALE);
  _mentalAddMorale(loser,  T.DUEL_LOSE_MORALE);
  _mentalAddFrustration(loser, T.DUEL_LOSE_FRUSTRATION);
}

/**
 * 得点確定フック。心理状態を更新し、スキル（trigger='team_concede'）の発動判定を行う。
 * @param {object} scoringTeam   得点チーム（team オブジェクト）
 * @param {object} concedingTeam 失点チーム（team オブジェクト）
 * @param {object} scorer        得点者（player オブジェクト）
 * @param {number} [concedingTeamNo] 失点チームが team1 なら 1、team2 なら 2（イベント記録用）
 * @returns {Array|null} 発動した mentalEvents 記録（無ければ null）
 */
function mentalOnGoal(scoringTeam, concedingTeam, scorer, concedingTeamNo) {
  if (!_mentalEnabled()) return null;
  const T = MENTAL_TUNING;
  _mentalAddTeamMorale(scoringTeam, T.GOAL_TEAM_MORALE);
  _mentalAddMorale(scorer, T.GOAL_SCORER_MORALE);
  _mentalAddTeamMorale(concedingTeam, T.CONCEDE_TEAM_MORALE);
  // 失点チームのピッチ上全員（GK 含む lineup 0-10）に frustration
  if (concedingTeam && concedingTeam.lineup && concedingTeam.players) {
    for (let pos = 0; pos < 11; pos++) {
      _mentalAddFrustration(concedingTeam.players[concedingTeam.lineup[pos]], T.CONCEDE_FRUSTRATION);
    }
  }
  // スキル発動判定（trigger='team_concede'。1 トリガーにつき 1 発動）
  if (!concedingTeam || !concedingTeam.lineup) return null;
  const events = [];
  if (!concedingTeam._skillUses) concedingTeam._skillUses = {};
  for (const skillId in SKILL_DEFS) {
    const def = SKILL_DEFS[skillId];
    if (def.trigger !== 'team_concede') continue;
    if ((concedingTeam._skillUses[skillId] || 0) >= def.maxPerMatch) continue;
    const holders = _mentalSkillHolders(concedingTeam, skillId);
    for (let h = 0; h < holders.length; h++) {
      const idx = holders[h];
      // condition: 'on_pitch' ＝ 現 lineup に載っていること
      if (def.condition === 'on_pitch' && concedingTeam.lineup.indexOf(idx) < 0) continue;
      concedingTeam._skillUses[skillId] = (concedingTeam._skillUses[skillId] || 0) + 1;
      if (def.effect && def.effect.type === 'team_morale_add') {
        _mentalAddTeamMorale(concedingTeam, def.effect.amount);
      }
      const p = concedingTeam.players[idx];
      events.push({
        type: 'skill_activate',
        team: concedingTeamNo === 1 ? 1 : 2,
        player: p ? p.name : null,
        playerEn: p ? (p.en_name || p.name) : null,
        skill: skillId,
      });
      break;   // 1 トリガーにつき同スキル 1 発動
    }
  }
  return events.length ? events : null;
}

/**
 * ファール被害フック（倒された攻撃選手の frustration 蓄積）。
 */
function mentalOnFoul(fouledPlayer) {
  if (!_mentalEnabled()) return;
  _mentalAddFrustration(fouledPlayer, MENTAL_TUNING.FOULED_FRUSTRATION);
}

/**
 * チャンス末尾フック: 劣勢継続ペナルティ → 減衰（morale ×0.90 / frustration ×0.85・0 方向へ）。
 */
function mentalOnChanceEnd(team1, team2) {
  if (!_mentalEnabled()) return;
  const T = MENTAL_TUNING;
  // 劣勢継続（2点差以上ビハインドのチーム morale -0.02/チャンス）
  if (team1 && team2) {
    const diff = (team1.score || 0) - (team2.score || 0);
    if (diff >= T.LOSING_MARGIN) _mentalAddTeamMorale(team2, T.LOSING_TEAM_MORALE);
    else if (-diff >= T.LOSING_MARGIN) _mentalAddTeamMorale(team1, T.LOSING_TEAM_MORALE);
  }
  // 減衰（全対象）
  const teams = [team1, team2];
  for (let ti = 0; ti < 2; ti++) {
    const t = teams[ti];
    if (!t || !t.players) continue;
    if (t.morale) t.morale *= T.DECAY_MORALE;
    for (let i = 0; i < t.players.length; i++) {
      const p = t.players[i];
      if (p.morale) p.morale *= T.DECAY_MORALE;
      if (p.frustration) {
        const ovDecay = mentalPersonality(p).frustrationDecay;
        p.frustration *= (ovDecay != null ? ovDecay : T.DECAY_FRUSTRATION);
      }
    }
  }
}

/**
 * param 係数（getActionParam の f へ乗算・4章(a)）。
 *   mf = 1 + 0.06×選手morale + 0.04×チームmorale → [0.90, 1.10] clamp。
 * @returns {number} 係数（無効時は 1.0）
 */
function mentalParamFactor(team, player) {
  if (!_mentalEnabled()) return 1.0;
  const T = MENTAL_TUNING;
  const pm = (player && player.morale) || 0;
  const tm = (team && team.morale) || 0;
  return _mclamp(1 + T.PARAM_PLAYER_COEF * pm + T.PARAM_TEAM_COEF * tm,
                 T.PARAM_CLAMP_MIN, T.PARAM_CLAMP_MAX);
}

/**
 * ファール率係数（fp へ乗算・4章(b)）。イライラした守備選手はファールしやすい。
 * 上限 cap は呼び出し側で fp = min(fp×factor, MENTAL_TUNING.FOUL_PROB_CAP)。
 * @returns {number} 係数（無効時は 1.0）
 */
function mentalFoulFactor(dfsPlayer) {
  if (!_mentalEnabled()) return 1.0;
  return 1 + MENTAL_TUNING.FOUL_FRUSTRATION_COEF * ((dfsPlayer && dfsPlayer.frustration) || 0);
}

/* ── 5. lab限定デバッグ表示（DBG-01・公開ビルドには mental.js ごと非同梱） ──
 * ユーザー（ゲームデザイナー）がメンタル変動の影響を試合画面で目視するための数値バンド。
 *   ①両チームの現在総合力（先発11人×29param合計×現在メンタル係数）
 *   ②マッチアップの投入値（例: ポストプレー vs 対ポストプレー）＝変動込みの現在値
 *   ③②の試合開始時相当値（現在値/メンタル係数）との比較
 * simulate.js 側は typeof ガード付きの薄い seam のみ（判定/カウント/rng 不変）。
 * 非表示フラグ: window.MENTAL_DEBUG_BAND = false（既定は表示）。
 */

/**
 * チーム現在総合力（simulate.js の simulateChance 末尾から typeof ガードで呼ばれる）。
 * @returns {{cur:number, base:number}} cur=現在メンタル係数込み / base=開始時（係数なし）。整数丸め。
 */
function mentalTeamDebugTotal(team) {
  const out = { cur: 0, base: 0 };
  if (!team || !team.players || !team.lineup) return out;
  for (let pos = 0; pos < 11; pos++) {
    const p = team.players[team.lineup[pos]];
    if (!p || !p.params) continue;
    let s = 0;
    for (let i = 0; i < p.params.length; i++) s += p.params[i];
    out.base += s;
    out.cur += s * mentalParamFactor(team, p);
  }
  out.cur = Math.round(out.cur);
  out.base = Math.round(out.base);
  return out;
}

// HTMLエスケープ（選手名/チーム名を innerHTML に入れるため）
function _mdbgEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// 差分表示（現在値 vs 開始値）。±0.05 未満は「±0」グレー、増=緑▲/減=赤▼。
function _mdbgDelta(cur, base, digits) {
  const d = cur - base;
  if (Math.abs(d) < 0.05) return '<span style="color:#9ca3af">±0</span>';
  const col = d > 0 ? '#4ade80' : '#f87171';
  return '<span style="color:' + col + '">' + (d > 0 ? '▲' : '▼') + Math.abs(d).toFixed(digits) + '</span>';
}

// チームカラーの小チップ（名前自体は可読色のまま）
function _mdbgChip(color) {
  return '<span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:' +
    _mdbgEsc(color || '#9ca3af') + ';margin-right:3px;vertical-align:baseline"></span>';
}

/**
 * デバッグバンド描画（simulate.js の nextChance から typeof ガードで呼ばれる）。
 * カットシーン（#live-field-wrap / #mini-field-wrap）と実況（#log-area）の間に
 * バンド div を1個挿入し、シーンごとに更新する。
 * @param {object} sc  現在シーン（scene オブジェクト・sc.dbg があれば行2を出す）
 * @param {object} res 現在チャンス結果（res.dbgTotals があれば行1を出す）
 */
function mentalRenderDebugBand(sc, res) {
  if (typeof document === 'undefined' || !sc || !res) return;
  const logArea = document.getElementById('log-area');
  if (!logArea || !logArea.parentNode) return;
  let band = document.getElementById('mental-debug-band');
  // 非表示フラグ（将来ここを既定 false にすれば一括で消せる）
  if (typeof window !== 'undefined' && window && window.MENTAL_DEBUG_BAND === false) {
    if (band) band.style.display = 'none';
    return;
  }
  if (!band) {
    band = document.createElement('div');
    band.id = 'mental-debug-band';
  }
  // 共通スタイル。1行=1情報（label / チームA / vs / チームB）で改行し、行内は折り返さない。
  const baseCss =
    'box-sizing:border-box;padding:8px 14px;background:rgba(0,0,0,0.78);' +
    'border:1px solid rgba(255,255,255,0.18);border-radius:8px;' +
    'color:#e5e7eb;line-height:1.65;text-align:left;' +
    'font-variant-numeric:tabular-nums;pointer-events:none;white-space:nowrap;z-index:60;';
  // PC（広い画面）＝ゲームカラム横の空きスペースへ固定ドッキング（親の overflow:hidden の外）。
  // スマホ幅＝従来どおりカットシーン直下・実況の直前に in-flow 挿入。
  const vw = (document.documentElement && document.documentElement.clientWidth) || window.innerWidth || 0;
  const wide = vw >= 700;
  if (wide) {
    if (band.parentNode !== document.body) document.body.appendChild(band);
    band.style.cssText = baseCss +
      'position:fixed;right:16px;top:90px;width:auto;max-width:44vw;font-size:13px;';
  } else {
    if (band.parentNode !== logArea.parentNode) logArea.parentNode.insertBefore(band, logArea);
    band.style.cssText = baseCss +
      'margin:0 0 6px;width:100%;font-size:11px;overflow-x:hidden;';
  }
  band.style.display = '';

  const blocks = [];
  const vsLine = '<span style="color:#6b7280">vs</span>';

  // ブロック1: 両チーム現在総合力（シーン毎スナップショット優先・無ければチャンス末尾値）
  const gs = (typeof gameState !== 'undefined' && gameState) ? gameState : null;
  const totals = sc.dbgTotals || res.dbgTotals;
  if (totals && gs && gs.team1 && gs.team2) {
    const nameOf = t => (typeof getTeamName === 'function' ? getTeamName(t) : t.name);
    const side = (t, tot) =>
      _mdbgChip(t.team_color) + '<b>' + _mdbgEsc(nameOf(t)) + '</b> ' +
      tot.cur.toLocaleString('en-US') +
      ' <span style="color:#9ca3af">(開始' + tot.base.toLocaleString('en-US') + '</span> ' +
      _mdbgDelta(tot.cur, tot.base, 0) + '<span style="color:#9ca3af">)</span>';
    blocks.push([
      '<span style="color:#9ca3af">総合力</span>',
      side(gs.team1, totals.t1),
      vsLine,
      side(gs.team2, totals.t2),
    ].join('<br>'));
  }

  // ブロック2: マッチアップ投入値（dbg があるシーンのみ。開始値=メンタル係数を除した値）
  if (sc.dbg && sc.offence && sc.defence) {
    const d = sc.dbg;
    const op = sc.offence.players[sc.offence.lineup[sc.ofsPos]];
    const dp = sc.defence.players[sc.defence.lineup[sc.dfsPos]];
    const side = (chipColor, pName, actName, val, base) =>
      _mdbgChip(chipColor) + _mdbgEsc(pName) + ' <span style="color:#93c5fd">' + _mdbgEsc(actName) + '</span> ' +
      '<b>' + val.toFixed(1) + '</b>' +
      ' <span style="color:#9ca3af">(開始' + base.toFixed(1) + '</span> ' +
      _mdbgDelta(val, base, 1) + '<span style="color:#9ca3af">)</span>';
    blocks.push([
      '<span style="color:#9ca3af">⚔</span>',
      side(sc.offence.team_color, op ? op.name : '?', d.action, d.ofsVal, d.ofsBase),
      vsLine,
      side(sc.defence.team_color, dp ? dp.name : '?', d.defAction, d.dfsVal, d.dfsBase),
    ].join('<br>'));
  }

  if (!blocks.length) { band.style.display = 'none'; return; }
  band.innerHTML = blocks.join('<br><br>');   // ブロック間は空行
}

// Node（vm context / 連結ロード）でも参照できるよう、存在すれば module.exports にも載せる。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MENTAL_TUNING, MENTAL_PERSONALITIES, MENTAL_OVERRIDES, SKILL_DEFS,
    mentalHash, mentalPersonality, mentalResetTeam,
    mentalOnDuel, mentalOnGoal, mentalOnFoul, mentalOnChanceEnd,
    mentalParamFactor, mentalFoulFactor,
    mentalTeamDebugTotal, mentalRenderDebugBand,
  };
}
