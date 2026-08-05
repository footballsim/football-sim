/* ===========================================================================
 * rail.js — MTG1-#3「デイリーレール ＋ 朝刊/終幕 ＋ 緊張の在庫」
 * ---------------------------------------------------------------------------
 * 第1回面白さMTG 採用案 #3（ui-designer 提案A ＋ reframer 提案B ＋ gtm 提案A/C）。
 * 1日の体験を **朝刊 → （従来フロー：練習→試合）→ 終幕** の一本のレールに載せる。
 *
 *   ① 朝刊ビート  : 節の初回表示で1画面。左=前節の結果 / 中=順位の▲▼ / 右=宿敵と世間。
 *                  10秒で読み切れる密度に抑え、「進む」で従来のハブ（監督室）へ返す。
 *   ② 終幕ビート  : 試合後デッキ（今節の号）の最終カード。**次回予告＝緊張の在庫**＋
 *                  連続観戦ストリーク＋「また明日」。1画面1ビート＝煽り文は必ず1本だけ。
 *   ③ 緊張の在庫  : standings / fixtures / 確定スコア / clubTrust から**決定論**で導く
 *                  「次に賭かっているもの」のリスト。LLM も rng も使わない。
 *
 * ★ ハブは廃止しない。レールの外にある**参照レイヤー**として残り、朝刊の唯一の出口も
 *   終幕デッキの出口も監督室＝常に1タップで戻れる（レールは寄り道を塞がない）。
 * ★ キルスイッチ: window.MTG1_RAIL === false で完全 no-op（既定は有効）。
 * ★ league.js への変更はフックのみ。ゲーム進行・試合結果・セーブ版数には一切触れない。
 *   保存は既存オブジェクトへの**任意フィールド追加だけ**（無くても動く＝後方互換）:
 *     manager.rail    = { n, best, lastDay, freezeWeek, frozen }  … 実日付ストリーク（季を跨ぐ）
 *     seasonMeta.rail = { round }                                  … 朝刊を読んだ節（季ごと）
 * ★ 公開ビルドは非同梱（build.js の LAB_ONLY_JS）＝ league.js 側は typeof ガードで no-op。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ── チューニング（全て決定論・ここだけを触れば強さが変わる）───────────── */
  var T = {
    PAPER_FROM_ROUND: 1,   // 朝刊は「前節がある」節から出す（開幕節＝素材が無いので出さない）
    SACK_DANGER: 35,       // クラブ信頼がこれ未満＝解任ライン（league.js CONTRACT_TUNING と同値）
    SACK_WARN: 45,         // これ未満＝きな臭い
    TITLE_GAP: 6,          // 首位との勝点差がこれ以内なら優勝争い
    TITLE_FROM: 0.45,      // シーズンの何割を過ぎたら優勝争いを煽るか
    DROP_FROM: 0.35,       // 同・最下位争い（＝下位2クラブ）を煽り始める時期
    RIVAL_NEAR: 3,         // 宿敵戦のカウントダウンを始める距離（節）。遠い時は既定の「次節」に譲る
    STREAK_MIN: 3,         // 連勝/連敗を緊張として扱う最小本数
    STREAK_RECORD: 5,      // これ以上＝「記録」として言い添える
    FREEZE_DAYS: 7         // ストリークの自動フリーズ＝この日数に1回
  };

  /* ── i18n / 小物（host に依存しない＝単体でテストできる）───────────────── */
  function _isEn() { return !!(global && global.LANG === 'en'); }
  function _t(ja, en) { return _isEn() ? en : ja; }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /* 英語の序数（3rd/4th…）。日本語は「N位」。 */
  function _ord(n) {
    n = parseInt(n, 10);
    if (isNaN(n)) return '';
    var t = n % 100;
    if (t >= 11 && t <= 13) return n + 'th';
    return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  }
  function _todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  /* 'YYYY-MM-DD' → エポックからの日数（時刻とタイムゾーンを落として「日」だけで比べる）。 */
  function _dayNum(ds) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ds || ''));
    if (!m) return null;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  }

  /* ── host（league.js の内部アクセサ）───────────────────────────────────
   * league.js は _state を閉じ込めているので、必要な読み出し口だけを受け取る。
   * ★ 受け取るのは「読み」と「描画の後始末」だけ＝リーグ進行には触れない。
   * ★ 束ねは **遅延**（_bind）。rail.js は league.js より後に読まれるので、league.js 側は
   *   window._leagueRailHost に置くだけ＝読み込み順に依存しない（attach でも渡せる）。 */
  var H = null;
  var Rail = {};

  Rail.attach = function (host) { H = host || null; return Rail; };
  Rail.enabled = function () { return _on(); };

  function _on() { return !(global && global.MTG1_RAIL === false); }
  function _bind() {
    if (!H && global && global._leagueRailHost) H = global._leagueRailHost;
    return H;
  }
  function _st() { try { var h = _bind(); return (h && h.state) ? h.state() : null; } catch (e) { return null; } }
  function _live() { return !!(_on() && _bind() && _st()); }
  function _save() { try { if (H && H.save) H.save(); } catch (e) {} }

  /* セーブが無い/壊れている時に落ちないための非永続フォールバック。 */
  var _memo = {
    streak: { n: 0, best: 0, lastDay: null, freezeWeek: null, frozen: false },
    paper: { round: -1 }
  };

  /* 実日付ストリークは **manager** に置く＝シーズンを跨いでも消えない
   * （seasonMeta は _startNextSeason で作り直されるので置き場所として不適）。 */
  function _streakStore() {
    var s = _st(), m = s && s.manager;
    if (!m) return _memo.streak;
    if (!m.rail) m.rail = { n: 0, best: 0, lastDay: null, freezeWeek: null, frozen: false };
    return m.rail;
  }
  /* 朝刊の既読マークは **seasonMeta**（季が変わればリセットされてよい）。 */
  function _paperStore() {
    var s = _st(), sm = s && s.seasonMeta;
    if (!sm) return _memo.paper;
    if (!sm.rail) sm.rail = { round: -1 };
    return sm.rail;
  }

  /* =========================================================================
   * 1. ストリーク（連続観戦N日）— 罰でなく安心の設計
   * -------------------------------------------------------------------------
   * ・同じ日に何度開いても1回。翌日に開けば +1。
   * ・1日空けても **週1回の自動フリーズ**で記録を維持し、その旨を優しく伝える。
   * ・2日以上空いた／その週のフリーズを使い切っていた時だけ 1 に戻る。
   * ・端末の時計が巻き戻った時は何もしない（記録を後退させない）。
   * ★ 純関数（st を渡して更新する）＝ headless で境界を機械検証できる。
   * ======================================================================= */
  Rail.streakTouch = function (st, today) {
    st = st || {};
    var d = _dayNum(today);
    if (d == null) return st;
    var last = _dayNum(st.lastDay);
    if (last != null && d <= last) return st;   // 同日 or 時計の巻き戻し＝据え置き（frozen 表示も保つ）
    if (last == null) { st.n = 1; st.frozen = false; }
    else if (d - last === 1) { st.n = (st.n || 0) + 1; st.frozen = false; }
    else {
      var week = Math.floor(d / T.FREEZE_DAYS);
      if (d - last === 2 && st.freezeWeek !== week) {
        st.freezeWeek = week; st.n = (st.n || 0) + 1; st.frozen = true;   // 1日だけの空きはフリーズで繋ぐ
      } else {
        st.n = 1; st.frozen = false;
      }
    }
    st.lastDay = today;
    if ((st.n || 0) > (st.best || 0)) st.best = st.n;
    return st;
  };

  /** 当日1回の記録更新（朝刊・終幕の両方から呼ばれる。冪等）。 */
  Rail.touch = function (today) {
    if (!_live()) return null;
    var st = _streakStore();
    var before = st.lastDay;
    Rail.streakTouch(st, today || _todayStr());
    if (st.lastDay !== before) _save();
    return st;
  };
  Rail.streak = function () { return _live() ? _streakStore() : _memo.streak; };

  /* =========================================================================
   * 2. 緊張の在庫（Tension Inventory）
   * -------------------------------------------------------------------------
   * 「次に何が賭かっているか」を確定データだけから導き、**最大の1本だけ**を返す。
   * ★ 完全決定論（rng なし・LLM なし）＝同じ状況なら誰がいつ開いても同じ煽り文。
   * ★ 各ルールは w（重み）を返し、最大の w が採用される。同点はこの配列の並び順で決まる。
   * ★ 1画面1ビート＝出すのは 1 本。残りは「在庫」＝次の日以降の分として黙って積まれる。
   * ======================================================================= */
  var RULES = [
    /* ⓪ シーズンを走り切った（次節が無い）— 他の全てに優先する幕引き。 */
    function (c) {
      if (!c.finished) return null;
      return {
        id: 'season_end', w: 100, tone: 'gold',
        tag: _t('シーズン終了', 'Season over'),
        head: _t(c.rounds + '節、走り切った。', 'All ' + c.rounds + ' rounds, done.'),
        sub: _t('最終順位 ' + c.pos + '位・勝点 ' + c.pts + '。ここからが次の物語だ。',
          'Finished ' + _ord(c.pos) + ' on ' + c.pts + ' points. The next story starts here.')
      };
    },
    /* ① 解任ライン — 生存が最上位の緊張。 */
    function (c) {
      if (typeof c.trust !== 'number' || c.trust >= T.SACK_WARN) return null;
      var danger = c.trust < T.SACK_DANGER;
      return {
        id: 'sack', w: danger ? 96 : 74, tone: 'danger',
        tag: _t('解任ライン', 'On the brink'),
        head: danger ? _t('会長は、もう次の男を探している。', 'The board is already looking at other names.')
          : _t('会長室の空気が変わった。', 'The mood upstairs has changed.'),
        sub: _t('クラブの信頼 ' + Math.round(c.trust) + '。要求は「' + c.goalText + '」、現在は' + c.pos + '位。',
          'Club trust ' + Math.round(c.trust) + '. The brief: "' + c.goalText + '" — you sit ' + _ord(c.pos) + '.')
      };
    },
    /* ② 次節が宿敵戦。 */
    function (c) {
      if (!c.rival || c.rival.away !== 0) return null;
      var r = c.rival;
      return {
        id: 'rival_next', w: 90, tone: 'rival',
        tag: _t('宿敵', 'Derby'),
        head: _t('次は、' + r.name + '。', 'Next up: ' + r.name + '.'),
        sub: _t('通算 ' + r.w + '勝' + r.d + '分' + r.l + '敗。この一戦だけは落とせない。',
          'All-time ' + r.w + '-' + r.d + '-' + r.l + '. This is the one you cannot lose.')
      };
    },
    /* ③ 最終節。 */
    function (c) {
      if ((c.rounds - c.round) !== 1) return null;
      return {
        id: 'final_round', w: 86, tone: 'gold',
        tag: _t('最終節', 'Final round'),
        head: _t('最後の90分で、すべてが決まる。', 'Ninety minutes left to settle it all.'),
        sub: _t('現在' + c.pos + '位・勝点' + c.pts + '。クラブの要求は「' + c.goalText + '」。',
          _ord(c.pos) + ' on ' + c.pts + ' points. The brief: "' + c.goalText + '".')
      };
    },
    /* ④ 優勝争い（首位を追う／追われる）。 */
    function (c) {
      if (c.round < c.rounds * T.TITLE_FROM || c.pos > 3) return null;
      var lead = (c.pos === 1);
      var gap = lead ? (c.pts - c.secondPts) : (c.leaderPts - c.pts);
      if (!lead && gap > T.TITLE_GAP) return null;
      return {
        id: 'title', w: 80 - Math.min(Math.max(gap, 0), 8), tone: 'gold',
        tag: _t('優勝争い', 'Title race'),
        head: lead ? _t('首位。だが、背中は見られている。', 'Top of the pile — and they can all see your back.')
          : _t('首位まで、勝点' + gap + '。', 'Just ' + gap + ' points off the top.'),
        sub: lead
          ? _t('2位との差は勝点' + gap + '。残り' + (c.rounds - c.round) + '節。',
            gap + ' points clear of second, with ' + (c.rounds - c.round) + ' rounds to go.')
          : _t('首位は' + c.leaderName + '。残り' + (c.rounds - c.round) + '節で届く距離だ。',
            c.leaderName + ' lead the way — ' + (c.rounds - c.round) + ' rounds left to reel them in.')
      };
    },
    /* ⑤ 連勝／連敗（連敗の方が強い緊張）。STREAK_RECORD 以上は「記録」として言い添える。 */
    function (c) {
      var s = c.streak;
      if (!s || !s.res || s.res === 'D' || s.n < T.STREAK_MIN) return null;
      var loss = (s.res === 'L');
      var rec = (s.n >= T.STREAK_RECORD);
      return {
        id: loss ? 'streak_loss' : 'streak_win',
        w: Math.min(loss ? 64 + s.n * 2 : 58 + s.n * 2, loss ? 80 : 74),
        tone: loss ? 'danger' : 'good',
        tag: loss ? _t(s.n + '連敗', s.n + ' straight defeats') : _t(s.n + '連勝', s.n + '-game win run'),
        head: loss
          ? _t(s.n + '連敗。止められるのは、次の90分だけだ。',
            s.n + ' defeats in a row. Only the next 90 minutes can stop it.')
          : _t(s.n + '連勝。この波、どこまで乗れる。', s.n + ' wins on the spin — how far can this run go?'),
        sub: rec
          ? _t('クラブの記録に手が届く位置にいる。次の1試合が重い。',
            'A club record is within reach — which makes the next one heavy.')
          : _t('現在' + c.pos + '位・勝点' + c.pts + '。', _ord(c.pos) + ' on ' + c.pts + ' points.')
      };
    },
    /* ⑥ 最下位争い（8クラブなので下位2つ）。 */
    function (c) {
      if (c.round < c.rounds * T.DROP_FROM || c.pos < c.clubCount - 1) return null;
      return {
        id: 'drop', w: 70, tone: 'danger',
        tag: _t('最下位争い', 'Bottom of the table'),
        head: _t('下から数えた方が早い。', "It's quicker to count from the bottom now."),
        sub: _t('現在' + c.pos + '位。ひとつ上との差は勝点' + c.aheadGap + '。',
          _ord(c.pos) + ' — just ' + c.aheadGap + ' points from the club above.')
      };
    },
    /* ⑦ クラブの要求ラインまであと勝点N（＝目標が見えている／こぼれかけている）。
     *   ★ 勝点で並んでいる（gap=0）時は「勝点0」と言わない＝得失点差の勝負だと言い切る。 */
    function (c) {
      if (!c.goalTarget || c.pos <= c.goalTarget) return null;
      if (c.goalGap == null || c.goalGap > 6) return null;
      var even = (c.goalGap === 0);
      return {
        id: 'goal_gap', w: 58, tone: 'info',
        tag: _t('クラブの要求', 'The brief'),
        head: even
          ? _t('勝点では、もう並んでいる。', 'Level on points — and still short.')
          : _t('要求ラインまで、勝点' + c.goalGap + '。', c.goalGap + ' points from where the club wants you.'),
        sub: even
          ? _t('要求は「' + c.goalText + '」。あとは得失点差と、次の90分だ。',
            'The brief: "' + c.goalText + '". It comes down to goal difference — and the next 90 minutes.')
          : _t('要求は「' + c.goalText + '」、現在' + c.pos + '位。残り' + (c.rounds - c.round) + '節。',
            'The brief: "' + c.goalText + '". You are ' + _ord(c.pos) + ' with ' + (c.rounds - c.round) + ' rounds left.')
      };
    },
    /* ⑧ 宿敵戦まであとN節（カウントダウン）。★ 近づいた時だけ＝毎日言うと擦り切れる。 */
    function (c) {
      if (!c.rival || c.rival.away == null || c.rival.away < 1 || c.rival.away > T.RIVAL_NEAR) return null;
      var r = c.rival;
      return {
        id: 'rival_soon', w: Math.max(30, 44 - r.away * 2), tone: 'rival',
        tag: _t('宿敵まであと' + r.away + '節', r.away + ' to the derby'),
        head: _t(r.name + '戦まで、あと' + r.away + '節。', r.away + ' rounds until ' + r.name + '.'),
        sub: _t('通算 ' + r.w + '勝' + r.d + '分' + r.l + '敗。その日までに、形を作る。',
          'All-time ' + r.w + '-' + r.d + '-' + r.l + '. Time to build something before then.')
      };
    },
    /* ⑨ 既定＝次節の相手（在庫が空でも必ず1本は出す）。 */
    function (c) {
      if (!c.opp) return null;
      return {
        id: 'next', w: 10, tone: 'info',
        tag: _t('次節', 'Next round'),
        head: _t('次は' + c.opp.name + '。', 'Next: ' + c.opp.name + '.'),
        sub: _t('第' + (c.round + 1) + '節・' + (c.opp.home ? 'ホーム' : 'アウェイ') + '。現在' + c.pos + '位・勝点' + c.pts + '。',
          'Round ' + (c.round + 1) + (c.opp.home ? ' at home' : ' away') + '. ' + _ord(c.pos) + ' on ' + c.pts + ' points.')
      };
    }
  ];

  /** 緊張の在庫（純関数）。候補を全部作り、重みの大きい順に並べて返す。 */
  Rail.tensionList = function (ctx) {
    if (!ctx) return [];
    var out = [];
    for (var i = 0; i < RULES.length; i++) {
      var r = null;
      try { r = RULES[i](ctx); } catch (e) { r = null; }
      if (r) { r.order = i; out.push(r); }
    }
    out.sort(function (a, b) { return (b.w - a.w) || (a.order - b.order); });
    return out;
  };
  /** 最大の1本（1画面1ビート）。 */
  Rail.tensionFrom = function (ctx) { return Rail.tensionList(ctx)[0] || null; };

  /** 現在のリーグ状態から ctx を組む（読み出しのみ・状態は一切変えない）。 */
  Rail.tensionCtx = function () {
    var s = _st(); if (!s || !_bind()) return null;
    var rows = H.standings();
    var my = null, i = 0;
    for (i = 0; i < rows.length; i++) if (rows[i].id === s.myClub) { my = rows[i]; break; }
    if (!my) return null;
    var pos = i + 1;
    var rounds = (s.fixtures && s.fixtures.length) || 0;
    var goal = (s.manager && s.manager.seasonGoal) || null;
    var target = goal && goal.target;

    // 宿敵戦までの節数（今節を 0 とする）＋通算成績
    var rival = null;
    if (s.rival) {
      var away = null;
      for (var r = s.round; r < s.fixtures.length; r++) {
        var ms = s.fixtures[r], hit = false;
        for (var k = 0; k < ms.length; k++) {
          var m = ms[k];
          if ((m.home === s.myClub && m.away === s.rival) || (m.away === s.myClub && m.home === s.rival)) { hit = true; break; }
        }
        if (hit) { away = r - s.round; break; }
      }
      var hh = (H.h2h && H.h2h(s.myClub, s.rival)) || { w: 0, d: 0, l: 0 };
      rival = { id: s.rival, name: H.clubName(s.rival), away: away, w: hh.w, d: hh.d, l: hh.l };
    }

    // 次節の相手（節が残っていれば）
    var fx = (H.fixture && H.fixture()) || null;
    var opp = null;
    if (fx) {
      var oid = (fx.home === s.myClub) ? fx.away : fx.home;
      opp = { id: oid, name: H.clubName(oid), home: (fx.home === s.myClub) };
    }

    return {
      round: s.round, rounds: rounds, clubCount: rows.length,
      finished: !!s.finished || !fx,
      pos: pos, pts: my.pts, gd: my.gd,
      leaderPts: rows[0] ? rows[0].pts : my.pts,
      leaderName: rows[0] ? H.clubName(rows[0].id) : '',
      secondPts: rows[1] ? rows[1].pts : my.pts,
      aheadGap: (i > 0) ? (rows[i - 1].pts - my.pts) : 0,
      goalTarget: target,
      goalText: (H.goalText && H.goalText()) || '',
      goalGap: (target && rows[target - 1]) ? Math.max(0, rows[target - 1].pts - my.pts) : null,
      trust: (s.manager && typeof s.manager.clubTrust === 'number') ? s.manager.clubTrust : null,
      streak: (H.streak && H.streak()) || null,
      rival: rival, opp: opp
    };
  };

  /** 現在の最大の緊張（1本）。 */
  Rail.tension = function () { return _live() ? Rail.tensionFrom(Rail.tensionCtx()) : null; };

  /* =========================================================================
   * 3. 朝刊ビート（1画面・横3ゾーン）
   * -------------------------------------------------------------------------
   * 左＝前節に何が起きたか / 中＝いま何位か（構図の重心） / 右＝この先の因縁と世間。
   * 視線は「起きたこと → 現在地 → これから」と一往復して終わる＝10秒で読み切れる。
   * ★ 意匠はシーズン終了/順送りページの固定フレーム（.lg-se 一式）に相乗りする
   *   ＝新しい世界観を増やさない（デザインシステムの反復が"設計された印象"を作る）。
   * ======================================================================= */

  /* 左：前節の結果（自分の試合を見出し付きで大きく、他会場は静かに3行）。 */
  function _zoneResults() {
    var s = _st(), rd = s.round - 1;
    var ms = (s.fixtures[rd] || []).filter(function (m) { return m.played; });
    var lr = s.lastResult;
    var mine = null, others = [];
    ms.forEach(function (m) {
      if (m.home === s.myClub || m.away === s.myClub) mine = m; else others.push(m);
    });

    var lead = '', strip = '', mom = '';
    if (mine) {
      var iAmHome = (mine.home === s.myClub);
      var mf = iAmHome ? mine.hs : mine.as, ma = iAmHome ? mine.as : mine.hs;
      var res = mf > ma ? 'W' : (mf < ma ? 'L' : 'D');
      var oppId = iAmHome ? mine.away : mine.home;
      /* 見出しは league.js 側の既存生成器（結果から決定論で作られる）を借りる。
       * ★ lastResult.round は記録経路によって「消化した節」と「その次」の両方があり得るので
       *   節番号では突き合わせない。対戦相手とスコアが前節のカードと一致することで確かめる。 */
      var same = !!(lr && lr.mine && lr.mine.opp === oppId && lr.mine.ms === mf && lr.mine.os === ma);
      var head = (same && H.headline) ? H.headline(lr) : '';
      lead = head ? '<p class="lg-rail-lead">' + _esc(head) + '</p>' : '';
      if (same && lr.mine.mom && lr.mine.mom.name) {
        var mm = lr.mine.mom;
        var stat = mm.goals > 0
          ? mm.goals + _t('ゴール', 'G') + (mm.assists > 0 ? ' ' + mm.assists + _t('アシスト', 'A') : '')
          : _t('攻守に奮闘', 'all-round display');
        mom = '<div class="lg-rail-mom"><span class="k">★ MOM</span>' +
          '<b class="n">' + _esc(mm.name) + '</b><span class="v">' + _esc(stat) + '</span></div>';
      }
      /* ★ 1行に「自クラブ / スコア / 相手」を詰めると狭い列でクラブ名が必ず欠ける。
       *   新聞のスコアボードと同じ**2行**（クラブ＋得点）にして、名前を削らない。 */
      function scoreRow(id, g, win) {
        return '<div class="row' + (win ? ' w' : '') + '">' +
          '<i>' + H.clubDef(id).crest + '</i>' +
          '<b>' + _esc(H.clubName(id)) + '</b>' +
          '<s>' + g + '</s></div>';
      }
      strip = '<div class="lg-rail-mine res' + res + '">' +
        '<span class="lg-rail-stamp">' + res + '</span>' +
        '<div class="rows">' +
          scoreRow(s.myClub, mf, mf >= ma) +
          scoreRow(oppId, ma, ma >= mf) +
        '</div>' +
      '</div>';
    }

    var rows = others.map(function (m) {
      var hw = m.hs > m.as, aw = m.as > m.hs;
      return '<div class="lg-rail-fx">' +
        '<span class="c">' + H.clubDef(m.home).crest + '</span>' +
        '<span class="n' + (hw ? ' w' : '') + '">' + _esc(H.clubName(m.home)) + '</span>' +
        '<b class="s">' + m.hs + '-' + m.as + '</b>' +
        '<span class="n r' + (aw ? ' w' : '') + '">' + _esc(H.clubName(m.away)) + '</span>' +
        '<span class="c">' + H.clubDef(m.away).crest + '</span>' +
      '</div>';
    }).join('');

    return '<section class="lg-se-zone lg-rail-z">' +
      '<div class="lg-se-ztitle">' + _t('第' + (rd + 1) + '節 結果', 'Round ' + (rd + 1) + ' results') + '</div>' +
      lead + strip + mom +
      (rows ? '<div class="lg-se-ztitle sm">' + _t('他会場', 'Elsewhere') + '</div>' +
        '<div class="lg-rail-fxlist">' + rows + '</div>' : '') +
      _formHTML() +
    '</section>';
  }

  /* 直近5試合の流れ（確定した fixtures から導く・列の締めとしてゾーン下端に置く）。 */
  function _formHTML() {
    var s = _st(), out = [];
    for (var r = 0; r < s.fixtures.length; r++) {
      var ms = s.fixtures[r];
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (!m.played || (m.home !== s.myClub && m.away !== s.myClub)) continue;
        var f = (m.home === s.myClub) ? m.hs : m.as, a = (m.home === s.myClub) ? m.as : m.hs;
        out.push(f > a ? 'W' : (f < a ? 'L' : 'D'));
      }
    }
    if (!out.length) return '';
    var pills = out.slice(-5).map(function (r) {
      return '<span class="lg-rail-pill r' + r + '">' + r + '</span>';
    }).join('');
    return '<div class="lg-rail-form"><span class="k">' + _t('直近の流れ', 'Recent form') + '</span>' +
      '<span class="pills">' + pills + '</span></div>';
  }

  /* 中央：順位（大きな現在順位＝構図の重心 ＋ 全クラブの▲▼）。 */
  function _zoneTable() {
    var s = _st(), rows = H.standings(), moves = (H.rankMoves && H.rankMoves()) || {};
    var pos = 0, my = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].id === s.myClub) { pos = i + 1; my = rows[i]; }
    var mv = moves[s.myClub] || 0;
    var mvBig = mv > 0 ? '<span class="mv up">▲' + mv + '</span>'
      : (mv < 0 ? '<span class="mv dn">▼' + (-mv) + '</span>' : '<span class="mv fl">–</span>');

    var body = rows.map(function (r, k) {
      var m = moves[r.id] || 0;
      var a = m > 0 ? '<span class="up">▲</span>' : (m < 0 ? '<span class="dn">▼</span>' : '<span class="fl">–</span>');
      return '<tr class="' + (r.id === s.myClub ? 'me' : '') + '">' +
        '<td class="p">' + (k + 1) + '</td><td class="mv">' + a + '</td>' +
        '<td class="nm"><i>' + H.clubDef(r.id).crest + '</i>' + _esc(H.clubName(r.id)) + '</td>' +
        '<td class="pt">' + r.pts + '</td></tr>';
    }).join('');

    return '<section class="lg-se-zone lg-rail-z lg-rail-zmid">' +
      '<div class="lg-se-ztitle">' + _t('順位', 'Standings') + '</div>' +
      '<div class="lg-rail-pos">' +
        '<span class="k">' + _t('現在', 'Now') + '</span>' +
        '<b class="n">' + pos + '</b><span class="u">' + _t('位', '') + '</span>' + mvBig +
        '<span class="kv"><i>' + _t('勝点', 'Pts') + '</i><b>' + (my ? my.pts : 0) + '</b></span>' +
        '<span class="kv"><i>' + _t('得失', 'GD') + '</i><b>' + ((my && my.gd > 0) ? '+' : '') + (my ? my.gd : 0) + '</b></span>' +
      '</div>' +
      '<table class="lg-rail-tbl"><tbody>' + body + '</tbody></table>' +
    '</section>';
  }

  /* 右：宿敵ウォッチ（因縁のカウントダウン）＋ 世間の声（sns.js があれば1本）。 */
  function _zoneWorld() {
    var ctx = Rail.tensionCtx();
    var rv = ctx && ctx.rival;
    var rival = '';
    if (rv) {
      var when = (rv.away === 0) ? _t('次節', 'Next round')
        : (rv.away == null ? _t('今季なし', 'None left') : _t('あと' + rv.away + '節', 'in ' + rv.away));
      rival = '<div class="lg-rail-rival' + (rv.away === 0 ? ' hot' : '') + '">' +
        '<div class="lg-rail-rv-h">🔥 ' + _t('宿敵', 'Rival') + '</div>' +
        '<div class="lg-rail-rv-b"><span class="c">' + H.clubDef(rv.id).crest + '</span>' +
          '<span class="n">' + _esc(rv.name) + '</span></div>' +
        '<div class="lg-rail-rv-k">' +
          '<span><i>' + _t('通算', 'All-time') + '</i><b>' + rv.w + '-' + rv.d + '-' + rv.l + '</b></span>' +
          '<span><i>' + _t('次の対戦', 'Next meeting') + '</i><b>' + when + '</b></span>' +
        '</div></div>';
    }

    // 世間の声＝sns.js の1本。未搭載なら「編集後記」＝クラブの要求と現在地（必ず何か出る）。
    var voice = '';
    var feed = (H.snsFeed && H.snsFeed()) || [];
    if (feed.length) {
      var p = feed[0];
      voice = '<article class="lg-rail-voice">' +
        '<span class="av">' + _esc(p.icon || '💬') + '</span>' +
        '<div class="bd"><div class="mt"><b>' + _esc(p.name) + '</b><span>' + _esc(p.handle) + '</span></div>' +
          '<p class="tx">' + _esc(p.text) + '</p></div></article>';
    } else if (ctx) {
      voice = '<article class="lg-rail-voice note">' +
        '<span class="av">🗞</span>' +
        '<div class="bd"><div class="mt"><b>' + _t('編集後記', "Editor's note") + '</b></div>' +
          '<p class="tx">' + _esc(_t('クラブの要求は「' + ctx.goalText + '」。現在' + ctx.pos + '位、勝点' + ctx.pts + '。',
            'The brief: "' + ctx.goalText + '". Currently ' + _ord(ctx.pos) + ' on ' + ctx.pts + ' points.')) +
          '</p></div></article>';
    }

    // 列の締め＝本日の焦点（緊張の在庫の1本）。朝は「今日の一戦に何が賭かっているか」を指す。
    var tn = ctx ? Rail.tensionFrom(ctx) : null;
    var focus = tn
      ? '<div class="lg-rail-focus tone-' + tn.tone + '">' +
          '<span class="k">' + _t('本日の焦点', "Today's stakes") + '</span>' +
          '<b class="h">' + _esc(tn.head) + '</b>' +
        '</div>'
      : '';

    return '<section class="lg-se-zone lg-rail-z">' +
      '<div class="lg-se-ztitle">' + _t('因縁と世間', 'Rivalry & reaction') + '</div>' +
      rival +
      '<div class="lg-se-ztitle sm">' + _t('世間の声', 'The reaction') + '</div>' + voice +
      focus +
    '</section>';
  }

  function _paperHeadHTML() {
    var s = _st(), st = _streakStore();
    var day = (s.round || 0) + 1;
    var rounds = (s.fixtures && s.fixtures.length) || 14;
    return '<header class="lg-se-top">' +
      '<div class="lg-se-brand">' +
        '<span class="lg-se-emblem">📰</span>' +
        '<div class="lg-se-brandtx">' +
          '<h1 class="lg-se-h1">' + _t('朝刊', 'Morning Paper') + '</h1>' +
          '<span class="lg-se-hsub">' + _t('第' + day + '節の朝', 'Matchday ' + day) + ' · ' + day + ' / ' + rounds + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="lg-rail-chips">' +
        // 低フレーム高では hsub（第N節の朝）が畳まれるので、節はチップでも持たせる
        '<span class="lg-rail-chip rd"><b>' + _t('第' + day + '節', 'R' + day) + '</b>' +
          '<span class="of">/ ' + rounds + '</span></span>' +
        '<span class="lg-rail-chip"><i>🔥</i><b>' + (st.n || 1) + '</b>' + _t('日連続', '-day streak') + '</span>' +
      '</div>' +
    '</header>';
  }

  function _paperNavHTML() {
    var s = _st(), fx = (H.fixture && H.fixture()) || null;
    var note = '<span class="lg-rail-navnote"></span>';
    if (fx) {
      var oid = (fx.home === s.myClub) ? fx.away : fx.home;
      note = '<span class="lg-rail-navnote">' +
        '<i>' + _t('本日の一戦', "Today's match") + '</i>' +
        '<b>' + (fx.home === s.myClub ? '🏟 HOME' : '✈ AWAY') + ' vs ' +
          H.clubDef(oid).crest + ' ' + _esc(H.clubName(oid)) + '</b></span>';
    }
    return '<div class="lg-se-nav lg-rail-nav">' + note +
      '<button type="button" class="lg-se-nb next" onclick="railPaperNext()">' +
        _t('監督室へ ▶', 'To the office ▶') + '</button></div>';
  }

  function _renderPaper() {
    var b = (H.body && H.body()) || null;
    if (!b) return false;
    b.innerHTML = '<div class="lg-se lg-se-paged lg-rail">' +
      _paperHeadHTML() +
      '<div class="lg-se-page"><div class="lg-rail-main">' +
        _zoneResults() + _zoneTable() + _zoneWorld() +
      '</div></div>' +
      _paperNavHTML() +
    '</div>';
    if (H.hubMode) H.hubMode(false);
    if (H.frame) H.frame(true);
    if (H.after) H.after();
    return true;
  }

  /**
   * ハブ描画への割り込み（league.js の _renderHub から呼ばれる）。
   * true を返したら「この画面はレールが描いた」＝ハブは描かない。
   * ★ 起動時レジューム（軽量版）もここが担う:
   *   朝刊未読 → 朝刊 / 試合前・本日消化済み → 従来のハブ、へ自然に着地する。
   */
  Rail.intercept = function () {
    if (!_live()) return false;
    Rail.touch();
    var s = _st();
    if (s.finished) return false;                       // シーズン終了フローには割り込まない
    if (s.round < T.PAPER_FROM_ROUND) return false;     // 開幕節は前節が無い＝朝刊を出さない
    if (H.locked && H.locked()) return false;           // 本日消化済み＝朝刊は次の朝に
    var st = _paperStore();
    if (st.round === s.round) return false;             // この節の朝刊は読み終えている
    return _renderPaper();
  };

  /** 朝刊を読み終えて監督室（ハブ）へ。★ 既読にしてから戻す（戻り先で再入しない）。 */
  global.railPaperNext = function () {
    if (_live()) {
      _paperStore().round = _st().round;
      _save();
    }
    if (H && H.home) H.home();
  };

  /* =========================================================================
   * 4. 終幕ビート（試合後デッキの最終カード）
   * -------------------------------------------------------------------------
   * 次回予告＝緊張の在庫（1本）＋ 連続観戦ストリーク ＋「また明日」。
   * ★ 従来の「▶ 次回予告」カードを置き換える（2枚並べない＝1画面1ビート）。
   * ======================================================================= */
  function _finaleHTML() {
    var tn = Rail.tension();
    if (!tn) return '';
    var st = _streakStore();
    var ctx = Rail.tensionCtx();

    var next = '';
    if (ctx && ctx.opp) {
      next = '<div class="lg-rail-next">' +
        '<span class="ha">' + (ctx.opp.home ? '🏟 HOME' : '✈ AWAY') + '</span>' +
        '<span class="cr">' + H.clubDef(ctx.opp.id).crest + '</span>' +
        '<span class="nm">' + _esc(ctx.opp.name) + '</span>' +
        '<span class="rd">' + _t('第' + (ctx.round + 1) + '節', 'R' + (ctx.round + 1)) + '</span>' +
      '</div>';
    }
    var frozen = st.frozen
      ? '<div class="lg-rail-freeze">❄ ' + _t('1日空きましたが、記録はフリーズで守られています。',
        'You missed a day — a freeze kept the run alive.') + '</div>'
      : '';

    return '<div class="lg-card lg-rail-fin tone-' + tn.tone + '">' +
      '<div class="lgp-kicker">' + _t('▶ 次回予告', '▶ NEXT EPISODE') + '</div>' +
      '<span class="lg-rail-tag">' + _esc(tn.tag) + '</span>' +
      '<h2 class="lg-rail-hook">' + _esc(tn.head) + '</h2>' +
      '<p class="lg-rail-hsub">' + _esc(tn.sub) + '</p>' +
      next +
      '<div class="lg-rail-foot">' +
        '<div class="lg-rail-streak"><b>' + (st.n || 1) + '</b><i>' + _t('日連続', 'day streak') + '</i></div>' +
        '<div class="lg-rail-bye">' + _t('また明日。', 'See you tomorrow.') + '</div>' +
      '</div>' + frozen +
    '</div>';
  }

  /** 試合後デッキの最終カード（league.js の _postMatchPanels から）。null なら従来の次回予告。 */
  Rail.finalePanel = function () {
    if (!_live()) return null;
    Rail.touch();
    return {
      id: 'rail_finale', sfx: 'page',
      html: function () { return _finaleHTML(); }   // 表示の瞬間に組む（会見等の反映後の数値を読む）
    };
  };

  /** 「本日は消化済み — また明日」の置き換え（終幕トーン）。 */
  Rail.lockText = function () {
    if (!_live()) return null;
    var n = _streakStore().n || 1;
    return _t('今日の一戦は終わった。連続観戦 ' + n + '日 — また明日。',
      "Today's match is done. " + n + '-day streak — see you tomorrow.');
  };

  Rail.TUNING = T;
  global.Rail = Rail;
})(typeof window !== 'undefined' ? window : this);
