/* ===========================================================================
 * attribution.js — MTG1-#1「采配の答え合わせパック」= 采配帰属（Decision Attribution）層
 * ---------------------------------------------------------------------------
 * 第1回面白さMTG 採用案 #1。リーグの自試合について、監督の各介入
 *（📹ビデオ対策 / 🧑‍🏫HT助言 / ⭐キープレイヤー / 🎯マークマン / 🗣鼓舞 /
 *  💬個別アドバイス / 🔁交代 / 🧭戦術変更）が「刺さった / 効かなかった / 判定不能」
 * かを、**確定した試合データの言い換えだけ**で答え合わせする。
 *
 * ★ 絶対不可侵: デュエル解決式・カウント・rng には一切触れない。本ファイルは
 *   ① getActionParam の係数読み取りを「記録」する（attributionRecord）
 *   ② チャンス境界で記録をグルーピングする（attributionOnChanceEnd）
 *   ③ 試合後に確定データを言い換えて判定する（attributionJudge / attributionJudgePanel）
 *   ④ 監督ビューアの表示ビートに合わせて一行トーストを出す（attributionOnBeat・最大3回）
 *   の4つだけ。係数の「内訳」は mentalParamFactor / fatigueParamFactor /
 *   managerParamFactor（すべて純関数・rng 不使用）を読み直して復元する＝挙動不変。
 *
 * ★ キルスイッチ: window.MTG1_ANSWER === false で記録・表示とも完全無効（既定は有効）。
 * ★ 公開ビルドは非同梱（build.js の LAB_ONLY_JS）＝ simulate.js 側は typeof ガードで no-op。
 * ★ 判定は外れも正直に「効かなかった」と言い切る（信頼設計・ui-designer 原則）。
 *   五分・サンプル不足は無理に断定せず「判定不能」に落とす。
 * ========================================================================= */

/* ── 有効判定・i18n ──────────────────────────────────────────────────── */
function _abEnabled() {
  return !(typeof window !== 'undefined' && window && window.MTG1_ANSWER === false);
}
function _abIsEn() { return (typeof window !== 'undefined' && window.LANG === 'en'); }
function _abT(ja, en) { return _abIsEn() ? en : ja; }

/* 攻め筋の表示名（league.js の THREAT_ACTIONS と同じ6本。他は原文のまま） */
var _AB_ACTION_EN = {
  'ドリブル突破': 'dribbling', 'クロス': 'crossing', 'ポストプレー': 'hold-up play',
  'ロングパス': 'long passing', 'ショートパス': 'short passing', '飛び出し': 'runs in behind'
};
function _abActionLabel(a) { return _abIsEn() ? (_AB_ACTION_EN[a] || a) : a; }

function _abName(p) { return p ? ((_abIsEn() && p.en_name) ? p.en_name : p.name) : '?'; }

/* ── 試合状態（1試合ぶんだけ保持。次の begin で捨てる） ─────────────────── */
var _abState = null;

/**
 * 試合開始（league.js の leagueKickoff から typeof ガードで呼ばれる）。
 * @param ctxGetter () => { mg: _mgMatchCtx, ht: _htState, ... } — league 側クロージャの
 *   「今の介入コンテキスト」を返す getter。HT助言で mg が後から生えるので参照でなく getter。
 */
function attributionBeginMatch(ctxGetter) {
  if (!_abEnabled()) { _abState = null; return; }
  var ctx = null;
  try { ctx = (typeof ctxGetter === 'function') ? ctxGetter() : null; } catch (e) { ctx = null; }
  var mg = ctx && ctx.mg;
  _abState = {
    active: true,
    ctxGetter: (typeof ctxGetter === 'function') ? ctxGetter : null,
    // 📹 試合前ビデオ対策のスナップショット（HT助言と区別するため begin 時点で確定）
    videoTargets: mg ? Object.keys(mg.counterActions || {}).map(function (k) { return k.replace(/^対/, ''); }) : [],
    videoBuff: mg ? (mg.buff || 0) : 0,
    team1: null, team2: null,          // 最初のチャンス境界で確定
    chances: [],                       // per-chance: {no, half, recs, scenes, lineup, t2lineup, tactics, t1score, t2score}
    _buf: [],                          // 現在チャンスの記録バッファ（両チーム。境界で自チーム分だけ残す）
    subs: [],                          // 自チームの交代（lineup 差分から検出）
    tacticChanges: [],                 // 自チームの戦術変更（スナップショット差分）
    endCtx: null,                      // 試合終了時の {mg, ht} スナップショット
    keyplayerPos: null, marked: -1,
    toastCount: 0, toastKeys: {}, toastChances: {}
  };
}

/** 試合終了（league.js の _onMatchFinish から。_endManagerMatchCtx より前に呼ぶこと）。 */
function attributionEndMatch() {
  var st = _abState;
  if (!st || !st.active) return;
  st.active = false;
  var ctx = null;
  try { ctx = st.ctxGetter ? st.ctxGetter() : null; } catch (e) { ctx = null; }
  st.endCtx = {
    mg: ctx && ctx.mg ? { counterActions: ctx.mg.counterActions || {}, buff: ctx.mg.buff || 0 } : null,
    ht: ctx && ctx.ht ? ctx.ht : null
  };
  if (st.team1) {
    st.keyplayerPos = (typeof st.team1.keyplayer === 'number') ? st.team1.keyplayer : null;
    st.marked = (typeof st.team1.marked_player === 'number') ? st.team1.marked_player : -1;
  }
}

/* ── ① 係数読み取りの記録（simulate.js getActionParam の seam） ──────────
 * 判定・確率・rng は一切変えない。係数の内訳は純関数を読み直して復元する。 */
function attributionRecord(team, pos, action, f) {
  var st = _abState;
  if (!st || !st.active || !_abEnabled()) return;
  var p = team.players[team.lineup[pos]];
  if (!p) return;
  st._buf.push({
    team: team, a: action, pos: pos, pi: team.lineup[pos], f: f,
    m: (typeof mentalParamFactor === 'function') ? mentalParamFactor(team, p) : 1,
    fg: (typeof fatigueParamFactor === 'function') ? fatigueParamFactor(team, p) : 1,
    g: (typeof managerParamFactor === 'function') ? managerParamFactor(team, p, action) : 1
  });
}

/* ── ② チャンス境界（simulate.js simulateChance 末尾の seam） ───────────── */
function attributionOnChanceEnd(chanceNo, scenes, team1, team2) {
  var st = _abState;
  if (!st || !st.active || !_abEnabled()) { if (st) st._buf = []; return; }
  if (!st.team1) { st.team1 = team1; st.team2 = team2; }
  if (team1 !== st.team1) { st._buf = []; return; }   // 別試合の混入は捨てる（保険）
  var half = (typeof HALF_CHANCES !== 'undefined') ? HALF_CHANCES : 16;
  // 自チーム分の記録だけ残す（team 参照は summary に持ち込まない）
  var recs = [];
  for (var i = 0; i < st._buf.length; i++) {
    var r = st._buf[i];
    if (r.team === team1) recs.push({ a: r.a, pos: r.pos, pi: r.pi, f: r.f, m: r.m, fg: r.fg, g: r.g });
  }
  st._buf = [];
  var prev = st.chances.length ? st.chances[st.chances.length - 1] : null;
  var lineup = team1.lineup.slice(0, 11);
  // 🔁 交代検出＝チャンス境界の lineup 差分（采配の適用は常に境界＝設計原則）
  if (prev) {
    for (var s = 0; s < 11; s++) {
      if (prev.lineup[s] !== lineup[s] && lineup[s] >= 0 && prev.lineup[s] >= 0) {
        st.subs.push({ no: chanceNo, pos: s, inIdx: lineup[s], outIdx: prev.lineup[s] });
      }
    }
    // 🧭 戦術変更検出
    if (prev.tactics !== team1.tactics) {
      st.tacticChanges.push({ no: chanceNo, from: prev.tactics, to: team1.tactics });
    }
  }
  st.chances.push({
    no: chanceNo, half2: chanceNo >= half, recs: recs, scenes: scenes,
    lineup: lineup, t2lineup: team2.lineup.slice(0, 11), tactics: team1.tactics,
    t1score: team1.score, t2score: team2.score
  });
}

/* ── 判定ヘルパ（確定シーンの言い換え） ─────────────────────────────────
 * result 値: 成功/失敗/カウンター/ゴール！！/GK防いだ！/枠を外した！/ブロック/ファール */
function _abOffWon(res) { return res === '成功' || res === 'ゴール！！'; }
function _abOffLost(res) {
  return res === '失敗' || res === 'カウンター' || res === 'GK防いだ！' ||
         res === '枠を外した！' || res === 'ブロック';
}
function _abEachScene(st, cb) {
  for (var c = 0; c < st.chances.length; c++) {
    var ch = st.chances[c], sc = ch.scenes || [];
    for (var i = 0; i < sc.length; i++) if (sc[i]) cb(sc[i], ch);
  }
}
/* 自チームのデュエル勝敗（攻守両方・ファール等は除外）を条件付きで集計 */
function _abMyDuels(st, cond) {
  var n = 0, w = 0;
  _abEachScene(st, function (sc, ch) {
    if (cond && !cond(sc, ch)) return;
    if (sc.offence === st.team1) {
      if (_abOffWon(sc.result)) { n++; w++; } else if (_abOffLost(sc.result)) { n++; }
    } else if (sc.defence === st.team1) {
      if (_abOffLost(sc.result)) { n++; w++; } else if (_abOffWon(sc.result)) { n++; }
    }
  });
  return { n: n, w: w, rate: n ? w / n : 0 };
}

/* 対策（攻め筋 target）の答え合わせ。halfOnly=true なら後半のみ（HT助言用） */
function _abCounterFacts(st, target, halfOnly) {
  var n = 0, stop = 0;
  _abEachScene(st, function (sc, ch) {
    if (halfOnly && !ch.half2) return;
    if (sc.offence !== st.team2 || sc.action !== target) return;
    if (_abOffLost(sc.result)) { n++; stop++; }
    else if (_abOffWon(sc.result)) { n++; }
  });
  // 係数が実際に乗った回数と平均%（記録＝getActionParam の読み取りから）
  var applied = 0, pctSum = 0;
  for (var c = 0; c < st.chances.length; c++) {
    var ch = st.chances[c];
    if (halfOnly && !ch.half2) continue;
    for (var i = 0; i < ch.recs.length; i++) {
      var r = ch.recs[i];
      if (r.a === '対' + target && r.g > 1) { applied++; pctSum += (r.g - 1); }
    }
  }
  return { n: n, stop: stop, applied: applied, avgPct: applied ? Math.round(pctSum / applied * 1000) / 10 : 0 };
}

function _abCounterVerdict(fx, label, srcJa, srcEn) {
  var coefJa = fx.applied ? '（対策係数+' + fx.avgPct + '%が' + fx.applied + '回働いた）' : '（係数の出番なし）';
  var coefEn = fx.applied ? ' (the +' + fx.avgPct + '% boost kicked in ' + fx.applied + ' times)' : ' (the boost never applied)';
  if (fx.n === 0) {
    return { verdict: 'na', line: _abT('相手は' + label + 'をほぼ使わなかった（0本）— 答え合わせ不能', 'They barely tried ' + label + ' (0 duels) — nothing to verify') };
  }
  var rate = fx.stop / fx.n;
  if (rate >= 0.6 && fx.n >= 2) {
    return { verdict: 'hit', line: _abT('相手の' + label + ' ' + fx.n + '本中' + fx.stop + '本を阻止' + coefJa, 'Stopped ' + fx.stop + ' of ' + fx.n + ' of their ' + label + coefEn) };
  }
  if (rate <= 0.4) {
    return { verdict: 'miss', line: _abT(label + 'を' + fx.n + '本中' + (fx.n - fx.stop) + '本通された — ' + srcJa + 'は効かなかった', 'Beaten on ' + (fx.n - fx.stop) + ' of ' + fx.n + ' ' + label + ' — the ' + srcEn + " didn't work") };
  }
  return { verdict: 'na', line: _abT(label + 'は' + fx.n + '本中' + fx.stop + '本阻止 — 五分。言い切れない', label + ': stopped ' + fx.stop + ' of ' + fx.n + ' — even. Too close to call') };
}

/* ── ③ 監督のジャッジ（構造化データ） ──────────────────────────────────
 * @returns null | { items: [{kind, icon, label, verdict:'hit'|'miss'|'na', line}] }
 */
function attributionJudge() {
  var st = _abState;
  if (!st || !_abEnabled() || !st.team1 || !st.chances.length) return null;
  var items = [];
  var i, fx, v;

  // 📹 試合前のビデオ対策（begin 時点のターゲットのみ＝HT助言と二重判定しない）
  for (i = 0; i < st.videoTargets.length; i++) {
    fx = _abCounterFacts(st, st.videoTargets[i], false);
    v = _abCounterVerdict(fx, _abActionLabel(st.videoTargets[i]), 'ビデオ対策', 'video prep');
    items.push({ kind: 'video', icon: '📹', label: _abT('ビデオ対策「' + _abActionLabel(st.videoTargets[i]) + '」', 'Video prep: ' + _abActionLabel(st.videoTargets[i])), verdict: v.verdict, line: v.line });
  }

  var ht = st.endCtx && st.endCtx.ht;

  // 🧑‍🏫 HTコーチ助言（後半のみで答え合わせ）
  if (ht && ht.advice && ht.advice.action) {
    fx = _abCounterFacts(st, ht.advice.action, true);
    v = _abCounterVerdict(fx, _abActionLabel(ht.advice.action), 'コーチの読み', "coach's read");
    items.push({ kind: 'advice', icon: '🧑‍🏫', label: _abT('HT助言「' + _abActionLabel(ht.advice.action) + 'を潰す」', "HT call: shut down " + _abActionLabel(ht.advice.action)), verdict: v.verdict, line: v.line });
  }

  // ⭐ キープレイヤー指名（攻撃の起点回数と勝率・得点）
  var kp = (typeof st.team1.keyplayer === 'number') ? st.team1.keyplayer : (st.keyplayerPos != null ? st.keyplayerPos : null);
  if (kp != null && kp >= 0) {
    var kpName = _abName(st.team1.players[st.chances[0].lineup[kp]]);
    var atk = 0, inv = 0, invW = 0, kpGoals = 0;
    _abEachScene(st, function (sc) {
      if (sc.offence !== st.team1) return;
      if (_abOffWon(sc.result) || _abOffLost(sc.result)) {
        atk++;
        if (sc.ofsPos === kp) { inv++; if (_abOffWon(sc.result)) invW++; if (sc.result === 'ゴール！！') kpGoals++; }
      }
    });
    if (kpGoals > 0) {
      v = { verdict: 'hit', line: _abT(kpName + 'が' + kpGoals + '得点。攻撃の絡み' + inv + '回（勝ち' + invW + '）', kpName + ' scored ' + kpGoals + '. Involved in ' + inv + ' attacks (' + invW + ' won)') };
    } else if (inv === 0 && atk >= 3) {
      v = { verdict: 'miss', line: _abT('攻撃' + atk + '回で一度も起点になれなかった — 指名は空回り', 'No involvement in ' + atk + ' attacks — the call never materialised') };
    } else if (inv >= 3 && invW / inv >= 0.55) {
      v = { verdict: 'hit', line: _abT('攻撃の絡み' + inv + '回中' + invW + '回勝利 — ボールが収まった', 'Won ' + invW + ' of ' + inv + ' attacking duels — the hub held up') };
    } else if (inv >= 2 && invW / inv <= 0.4) {
      v = { verdict: 'miss', line: _abT('絡んだ' + inv + '回のうち勝てたのは' + invW + '回 — 期待に届かず', 'Won only ' + invW + ' of ' + inv + ' duels — below the billing') };
    } else {
      v = { verdict: 'na', line: _abT('絡み' + inv + '回・勝ち' + invW + ' — サンプル不足で言い切れない', inv + ' involvements, ' + invW + ' won — not enough to judge') };
    }
    items.push({ kind: 'keyplayer', icon: '⭐', label: _abT('キープレイヤー ' + kpName, 'Key player ' + kpName), verdict: v.verdict, line: v.line });
  }

  // 🎯 マークマン（相手のその選手の攻撃を封じたか）
  if (st.marked >= 0 && st.team2 && st.team2.players[st.marked]) {
    var mkName = _abName(st.team2.players[st.marked]);
    var mn = 0, mw = 0, mg = 0;
    _abEachScene(st, function (sc, ch) {
      if (sc.offence !== st.team2) return;
      if (ch.t2lineup[sc.ofsPos] !== st.marked) return;
      if (_abOffWon(sc.result)) { mn++; mw++; if (sc.result === 'ゴール！！') mg++; }
      else if (_abOffLost(sc.result)) { mn++; }
    });
    if (mg > 0) v = { verdict: 'miss', line: _abT('マークをかいくぐられ' + mg + '失点 — 封じ切れなかった', 'He slipped the marking and scored ' + mg + " — it didn't hold") };
    else if (mn === 0) v = { verdict: 'na', line: _abT(mkName + 'にボールがほぼ入らなかった（0回）— 答え合わせ不能', mkName + ' hardly saw the ball (0 duels) — nothing to verify') };
    else if (mw / mn <= 0.4) v = { verdict: 'hit', line: _abT(mkName + 'の仕掛け' + mn + '回中' + (mn - mw) + '回を封じた', 'Shut down ' + (mn - mw) + ' of ' + mn + ' of ' + mkName + "'s attacks") };
    else if (mw / mn >= 0.6) v = { verdict: 'miss', line: _abT(mkName + 'に' + mn + '回中' + mw + '回やられた — マークは効かなかった', mkName + ' beat it ' + mw + ' of ' + mn + " times — the marking didn't work") };
    else v = { verdict: 'na', line: _abT(mkName + 'とは' + mn + '回中' + (mn - mw) + '回止めの五分 — 言い切れない', 'Even battle with ' + mkName + ' (' + (mn - mw) + '/' + mn + ' stopped) — too close to call') };
    items.push({ kind: 'marked', icon: '🎯', label: _abT('マークマン ' + mkName, 'Marked man ' + mkName), verdict: v.verdict, line: v.line });
  }

  // 🗣 鼓舞（選手とMTG）— 後半のデュエル勝率が実際に上がったかで答え合わせ
  if (ht && ht.rouse) {
    var d1 = _abMyDuels(st, function (sc, ch) { return !ch.half2; });
    var d2 = _abMyDuels(st, function (sc, ch) { return ch.half2; });
    var dd = Math.round((d2.rate - d1.rate) * 100);
    var reactJa = '（響いた' + (ht.rouse.up || 0) + '人・反発' + (ht.rouse.down || 0) + '人）';
    var reactEn = ' (' + (ht.rouse.up || 0) + ' fired up, ' + (ht.rouse.down || 0) + ' pushed back)';
    if (d1.n < 3 || d2.n < 3) v = { verdict: 'na', line: _abT('デュエル数が少なく効果を測れない' + reactJa, 'Too few duels to measure' + reactEn) };
    else if (dd >= 5) v = { verdict: 'hit', line: _abT('デュエル勝率が前半' + Math.round(d1.rate * 100) + '%→後半' + Math.round(d2.rate * 100) + '%' + reactJa, 'Duels won: ' + Math.round(d1.rate * 100) + '% → ' + Math.round(d2.rate * 100) + '% after the talk' + reactEn) };
    else if (dd <= -5) v = { verdict: 'miss', line: _abT('喝の後も勝率は' + Math.round(d1.rate * 100) + '%→' + Math.round(d2.rate * 100) + '%に低下 — 効かなかった' + reactJa, 'Duels won fell ' + Math.round(d1.rate * 100) + '% → ' + Math.round(d2.rate * 100) + "% — it didn't land" + reactEn) };
    else v = { verdict: 'na', line: _abT('後半の勝率は' + Math.round(d1.rate * 100) + '%→' + Math.round(d2.rate * 100) + '%でほぼ横ばい — 言い切れない', 'Duels won flat (' + Math.round(d1.rate * 100) + '% → ' + Math.round(d2.rate * 100) + '%) — too close to call') };
    items.push({ kind: 'rouse', icon: '🗣', label: _abT('選手とMTG（' + (ht.rouse.tone === 'scold' ? '喝' : '鼓舞') + '）', 'Team talk (' + (ht.rouse.tone === 'scold' ? 'hairdryer' : 'rally') + ')'), verdict: v.verdict, line: v.line });
  }

  // 💬 個別アドバイス（指名した1人の後半）
  if (ht && ht.advise) {
    var ap = ht.advise.pos;
    var an = ht.advise.name || '?';
    if (ht.advise.good === false) {
      v = { verdict: 'miss', line: _abT('声かけが逆効果（性格に合わなかった）', 'The word backfired — wrong read on his personality') };
    } else {
      var pd = _abMyDuels(st, function (sc, ch) {
        if (!ch.half2) return false;
        return (sc.offence === st.team1 && sc.ofsPos === ap) || (sc.defence === st.team1 && sc.dfsPos === ap);
      });
      if (pd.n === 0) v = { verdict: 'na', line: _abT('後半、本人のデュエルが無かった — 答え合わせ不能', 'No duels for him after the break — nothing to verify') };
      else if (pd.rate >= 0.55) v = { verdict: 'hit', line: _abT('後半のデュエル' + pd.n + '回中' + pd.w + '回勝利 — 声が届いた', 'Won ' + pd.w + ' of ' + pd.n + ' duels after the talk') };
      else if (pd.rate <= 0.4) v = { verdict: 'miss', line: _abT('後半は' + pd.n + '回中' + pd.w + '回どまり — 効かなかった', 'Only ' + pd.w + ' of ' + pd.n + " duels won — it didn't lift him") };
      else v = { verdict: 'na', line: _abT('後半' + pd.n + '回中' + pd.w + '回 — 五分。言い切れない', pd.w + ' of ' + pd.n + ' duels — too close to call') };
    }
    items.push({ kind: 'advise', icon: '💬', label: _abT('個別アドバイス ' + an, 'A word with ' + an), verdict: v.verdict, line: v.line });
  }

  // 🔁 交代（投入選手のその後）
  for (i = 0; i < st.subs.length; i++) {
    var sub = st.subs[i];
    var inP = st.team1.players[sub.inIdx];
    var sd = { n: 0, w: 0 }, sg = 0;
    _abEachScene(st, function (sc, ch) {
      if (ch.no < sub.no || ch.lineup[sub.pos] !== sub.inIdx) return;
      if (sc.offence === st.team1 && sc.ofsPos === sub.pos) {
        if (_abOffWon(sc.result)) { sd.n++; sd.w++; if (sc.result === 'ゴール！！') sg++; }
        else if (_abOffLost(sc.result)) { sd.n++; }
      } else if (sc.defence === st.team1 && sc.dfsPos === sub.pos) {
        if (_abOffLost(sc.result)) { sd.n++; sd.w++; } else if (_abOffWon(sc.result)) { sd.n++; }
      }
    });
    if (sg > 0) v = { verdict: 'hit', line: _abT('投入の' + _abName(inP) + 'が' + sg + '得点 — 采配的中', _abName(inP) + ' came on and scored ' + sg + ' — inspired change') };
    else if (sd.n === 0) v = { verdict: 'na', line: _abT(_abName(inP) + 'に出番が来なかった — 答え合わせ不能', _abName(inP) + ' saw no duels — nothing to verify') };
    else if (sd.n >= 2 && sd.w / sd.n >= 0.5) v = { verdict: 'hit', line: _abT(_abName(inP) + 'がデュエル' + sd.n + '回中' + sd.w + '回勝利 — 流れを持ち込んだ', _abName(inP) + ' won ' + sd.w + ' of ' + sd.n + ' duels — fresh legs told') };
    else if (sd.w / sd.n < 0.4) v = { verdict: 'miss', line: _abT(_abName(inP) + 'は' + sd.n + '回中' + sd.w + '回どまり — 交代は実らなかった', _abName(inP) + ' won only ' + sd.w + ' of ' + sd.n + " — the change didn't pay off") };
    else v = { verdict: 'na', line: _abT(_abName(inP) + 'は' + sd.n + '回中' + sd.w + '回 — 五分', _abName(inP) + ': ' + sd.w + ' of ' + sd.n + ' duels — too close to call') };
    items.push({ kind: 'sub', icon: '🔁', label: _abT('交代 → ' + _abName(inP), 'Sub: ' + _abName(inP) + ' on'), verdict: v.verdict, line: v.line });
  }

  // 🧭 戦術変更（変更前後の自チームのデュエル勝率）
  for (i = 0; i < st.tacticChanges.length; i++) {
    var tc = st.tacticChanges[i];
    var names = (typeof t === 'function') ? t('tacticsNames') : (typeof TACTICS_NAMES !== 'undefined' ? TACTICS_NAMES : null);
    var tn = (names && names[tc.to]) || ('#' + tc.to);
    var b = _abMyDuels(st, function (sc, ch) { return ch.no < tc.no; });
    var af = _abMyDuels(st, function (sc, ch) { return ch.no >= tc.no; });
    var td = Math.round((af.rate - b.rate) * 100);
    if (b.n < 3 || af.n < 3) v = { verdict: 'na', line: _abT('変更後のデュエル数が少なく測れない', 'Too few duels after the switch to measure') };
    else if (td >= 5) v = { verdict: 'hit', line: _abT('変更後、デュエル勝率' + Math.round(b.rate * 100) + '%→' + Math.round(af.rate * 100) + '%', 'Duels won ' + Math.round(b.rate * 100) + '% → ' + Math.round(af.rate * 100) + '% after the switch') };
    else if (td <= -5) v = { verdict: 'miss', line: _abT('変更後に勝率' + Math.round(b.rate * 100) + '%→' + Math.round(af.rate * 100) + '%へ低下 — 裏目', 'Duels won fell ' + Math.round(b.rate * 100) + '% → ' + Math.round(af.rate * 100) + '% — it backfired') };
    else v = { verdict: 'na', line: _abT('変更前後で勝率' + Math.round(b.rate * 100) + '%→' + Math.round(af.rate * 100) + '% — ほぼ横ばい', 'Duels won flat: ' + Math.round(b.rate * 100) + '% → ' + Math.round(af.rate * 100) + '%') };
    items.push({ kind: 'tactic', icon: '🧭', label: _abT('戦術変更 → ' + tn, 'Switch to ' + tn), verdict: v.verdict, line: v.line });
  }

  return items.length ? { items: items } : null;
}

/* ── ③' 試合後カード「監督のジャッジ」HTML（league の今節の号デッキに挿さる） ── */
function _abVerdictBadge(verdict) {
  if (verdict === 'hit') return '<span style="color:#51e08a;font-weight:800;white-space:nowrap">◎ ' + _abT('刺さった', 'IT WORKED') + '</span>';
  if (verdict === 'miss') return '<span style="color:#ff8f6b;font-weight:800;white-space:nowrap">✕ ' + _abT('効かなかった', "DIDN'T WORK") + '</span>';
  return '<span style="color:#9aa7bd;font-weight:800;white-space:nowrap">— ' + _abT('判定不能', 'NO VERDICT') + '</span>';
}
function attributionJudgePanel() {
  if (!_abEnabled()) return null;
  var j = attributionJudge();
  if (!j) return null;
  var rows = '';
  for (var i = 0; i < j.items.length; i++) {
    var it = j.items[i];
    rows += '<div style="padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.08)">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">' +
        '<span style="font-size:12px;font-weight:700">' + it.icon + ' ' + it.label + '</span>' +
        _abVerdictBadge(it.verdict) +
      '</div>' +
      '<div style="font-size:11px;color:rgba(255,255,255,0.72);margin-top:2px;line-height:1.5">' + it.line + '</div>' +
    '</div>';
  }
  return '<div class="lg-card lg-judge">' +
    '<div class="lgp-kicker">' + _abT('監督のジャッジ', "THE MANAGER'S VERDICT") + '</div>' +
    rows +
    '<div style="font-size:9px;color:rgba(255,255,255,0.4);margin-top:6px">' +
      _abT('※ 確定した試合データの言い換えだけで判定しています', '※ Verdicts restate confirmed match data only') + '</div>' +
  '</div>';
}

/* ── ④ 試合中トースト（manager-match.js の表示ビートから。1試合最大3回） ────
 * 「決定的に効いた瞬間」だけ一行で知らせる。表示のみ＝エンジン・判定不変。 */
var _AB_TOAST_MAX = 3;
function attributionOnBeat(chanceIdx, sceneIdx, toastFn) {
  var st = _abState;
  if (!st || !st.active || !_abEnabled() || typeof toastFn !== 'function') return;
  if (st.toastCount >= _AB_TOAST_MAX || !st.team1) return;
  if (typeof chanceResults === 'undefined' || !chanceResults) return;
  var res = chanceResults[chanceIdx];
  var sc = res && res.scenes && res.scenes[sceneIdx];
  if (!sc) return;
  var key = chanceIdx + ':' + sceneIdx;
  if (st.toastKeys[key] || st.toastChances[chanceIdx]) return;   // 同一ビート/同一チャンスで1回まで
  st.toastKeys[key] = true;

  var ctx = null;
  try { ctx = st.ctxGetter ? st.ctxGetter() : null; } catch (e) { ctx = null; }
  var half = (typeof HALF_CHANCES !== 'undefined') ? HALF_CHANCES : 16;
  var msg = null;

  // A) 対策した攻め筋のデュエルを断った
  if (ctx && ctx.mg && ctx.mg.counterActions && ctx.mg.counterActions['対' + sc.action] &&
      sc.offence === st.team2 && _abOffLost(sc.result)) {
    msg = '📹 ' + _abT('対策が刺さった — ' + _abActionLabel(sc.action) + 'を断った',
                       'Homework pays off — stopped their ' + _abActionLabel(sc.action));
  }
  // B) キープレイヤーのゴール
  else if (sc.result === 'ゴール！！' && sc.offence === st.team1 &&
           typeof st.team1.keyplayer === 'number' && sc.ofsPos === st.team1.keyplayer) {
    msg = '⭐ ' + _abT('キープレイヤー起用が的中 — ' + _abName(st.team1.players[st.team1.lineup[sc.ofsPos]]) + 'がゴール！',
                       'Key player call pays off — ' + _abName(st.team1.players[st.team1.lineup[sc.ofsPos]]) + ' scores!');
  }
  // C) 鼓舞（HTのMTG）後の自チームのゴール
  else if (sc.result === 'ゴール！！' && sc.offence === st.team1 &&
           chanceIdx >= half && ctx && ctx.ht && ctx.ht.rouse) {
    msg = '🗣 ' + _abT('ハーフタイムの声が効いた — ゴール！', 'The half-time talk lands — goal!');
  }

  if (msg) {
    st.toastChances[chanceIdx] = true;
    st.toastCount++;
    toastFn(msg);
  }
}
