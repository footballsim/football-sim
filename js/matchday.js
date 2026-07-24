/**
 * matchday.js — 試合前の導入と試合後の連載リビール（lab限定 / LAB_UI_DESIGN.md §4.4）
 * ---------------------------------------------------------------------------
 * UX-03 playPreMatch : 「週末の試合へ」→ 即キックオフをやめ、漫画のコマ送りで“ため”を作る。
 * UX-04 playPostMatch: 試合後の一括表示をやめ、「今節の号」を1コマずつ開かせる。
 *
 * 設計上の約束:
 *   - **done() は必ず1回だけ呼ぶ**（スキップ・エラー・タイムアウトのいずれでも）。
 *     ここで詰まると試合に入れない／監督室へ戻れないので最優先の不変条件。
 *   - 文言は自前で持たない。すべて ctx / panels / opts 経由で受け取る（i18n は呼び出し側）。
 *   - Juice / LabArt / LgUI は任意依存（typeof ガード）。未搭載でも成立する。
 */
(function () {
  'use strict';

  var Matchday = {};

  function _juice() { return (typeof Juice !== 'undefined') ? Juice : null; }
  function _ready() { var j = _juice(); return !!(j && j.ready && j.ready()); }
  function _sfx(n) { var j = _juice(); if (j && j.sfx) j.sfx(n); }

  /** done を1回に固定するラッパ。 */
  function _once(fn) {
    var called = false;
    return function () {
      if (called) return;
      called = true;
      try { if (typeof fn === 'function') fn(); } catch (e) { console.warn('[matchday] done failed', e); }
    };
  }

  function _mkOverlay(cls) {
    // 二重起動の保険：同種のオーバーレイが残っていたら必ず捨ててから作る
    // （連打や再入で 2 枚重なると、下の 1 枚が永久に残って操作不能になる）
    var stale = document.querySelectorAll('.lg-md-ov.' + (cls || 'lg-md-ov'));
    Array.prototype.forEach.call(stale, function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    var ov = document.createElement('div');
    ov.className = 'lg-md-ov ' + (cls || '');
    document.body.appendChild(ov);
    return ov;
  }
  function _kill(ov) { try { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); } catch (e) {} }

  /* =========================================================================
   * UX-03 プレマッチ導入
   * ctx: { round, rounds, myDef, oppDef, myName, oppName, iAmHome, isRival,
   *        h2hText, threatText, weekSummary:[{icon,text}], goalText,
   *        labels:{ round, home, away, rival, threat, prep, goal, kickoff, skip, tapHint } }
   * ========================================================================= */
  Matchday.playPreMatch = function (ctx, done) {
    var finish = _once(done);
    ctx = ctx || {};
    var L = ctx.labels || {};

    // キルスイッチ／演出OFF：何もせず即キックオフ
    if (window.PREMATCH_ENABLED === false || !_ready()) { finish(); return; }

    var ov, timer = null, killed = false;
    try {
      ov = _mkOverlay('lg-md-pre');
      var myD = ctx.myDef || {}, opD = ctx.oppDef || {};
      var rival = !!ctx.isRival;

      var prep = (ctx.weekSummary || []).map(function (s) {
        return '<span class="lg-md-chip">' + (s.icon || '') + ' ' + (s.text || '') + '</span>';
      }).join('');

      // ── コマの定義（HTML＋背景アート）
      var cuts = [
        { art: 'tunnel', sfx: 'crowd', html:
            '<div class="lg-md-kicker">' + (L.round || '') + '</div>' +
            '<div class="lg-md-big">' + (ctx.iAmHome ? (L.home || 'HOME') : (L.away || 'AWAY')) + '</div>' +
            '<div class="lg-md-sub">' + (myD.crest || '') + ' ' + (ctx.myName || '') + '</div>' },
        { art: 'stadium_night', sfx: rival ? 'thud' : 'tick', cls: rival ? 'rival' : '', html:
            (rival ? '<div class="lg-md-rival">🔥 ' + (L.rival || '') + (ctx.h2hText ? '　' + ctx.h2hText : '') + '</div>' : '') +
            '<div class="lg-md-clash">' +
              '<span class="side"><b style="color:' + (myD.color || '#fff') + '">' + (myD.crest || '') + '</b><i>' + (ctx.myName || '') + '</i></span>' +
              '<span class="mid">VS</span>' +
              '<span class="side"><b style="color:' + (opD.color || '#fff') + '">' + (opD.crest || '') + '</b><i>' + (ctx.oppName || '') + '</i></span>' +
            '</div>' +
            (ctx.threatText ? '<div class="lg-md-sub">' + (L.threat || '') + '：<b>' + ctx.threatText + '</b></div>' : '') },
        { art: 'office_bg', sfx: 'page', html:
            '<div class="lg-md-kicker">' + (L.prep || '') + '</div>' +
            '<div class="lg-md-chips">' + (prep || '<span class="lg-md-chip dim">—</span>') + '</div>' +
            (ctx.goalText ? '<div class="lg-md-sub">' + (L.goal || '') + '：<b>' + ctx.goalText + '</b></div>' : '') },
        { art: 'stadium_night', sfx: 'whistle', cls: 'kickoff', html:
            '<div class="lg-md-kickoff">KICK OFF</div>' }
      ];

      ov.innerHTML =
        '<canvas class="lg-md-art" data-labart="tunnel"></canvas>' +
        '<div class="lg-md-stage"></div>' +
        '<button type="button" class="lg-md-skip">' + (L.skip || 'SKIP') + ' ▶▶</button>' +
        '<div class="lg-md-hint">' + (L.tapHint || '') + '</div>';

      var stage = ov.querySelector('.lg-md-stage');
      var art = ov.querySelector('.lg-md-art');
      var idx = 0;

      function paintArt(key) {
        if (!art || typeof LabArt === 'undefined') return;
        art.setAttribute('data-labart', key);
        // ★ 自前でサイズを測らない。挿入直後はレイアウト未確定で 0 になり、
        //   1x1 の空 canvas が焼き付いて背景が真っ黒になる（実際に踏んだ）。
        LabArt.fitLater(art, key);
      }

      function close() {
        if (killed) return;
        killed = true;
        if (timer) clearTimeout(timer);
        var j = _juice();
        // ★ 画面の入れ替えは暗転のピークで行う（フェード後だと元画面が一瞬見えてしまう）
        if (j && j.screenSwap) j.screenSwap(function () { _kill(ov); finish(); });
        else { _kill(ov); finish(); }
      }

      function step() {
        if (killed) return;
        if (idx >= cuts.length) { close(); return; }
        var c = cuts[idx++];
        paintArt(c.art);
        stage.className = 'lg-md-stage ' + (c.cls || '');
        stage.innerHTML = '<div class="lg-md-cut">' + c.html + '</div>';
        var cut = stage.firstChild;
        var j = _juice();
        if (j && j.reveal) j.reveal(cut, { dur: 360 });
        if (c.sfx) _sfx(c.sfx);
        if (timer) clearTimeout(timer);
        // 自動送り（タップでも進める）。最後のコマは短く切ってキックオフへ。
        // window.PREMATCH_CUT_MS で1コマの尺を調整できる（テンポ調整・検証用）。
        var cutMs = (typeof window.PREMATCH_CUT_MS === 'number') ? window.PREMATCH_CUT_MS : 1750;
        timer = setTimeout(step, (idx >= cuts.length) ? Math.min(640, cutMs) : cutMs);
      }

      ov.addEventListener('click', function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('lg-md-skip')) { close(); return; }
        if (timer) clearTimeout(timer);
        step();
      });

      // ★ 安全網: 何が起きても必ず試合へ進む（尺を延ばしたときも切れないよう連動）
      var cutMsN = (typeof window.PREMATCH_CUT_MS === 'number') ? window.PREMATCH_CUT_MS : 1750;
      setTimeout(function () { close(); }, Math.max(14000, cuts.length * cutMsN + 6000));

      step();
    } catch (e) {
      console.warn('[matchday] pre-match failed, going straight to kickoff', e);
      _kill(ov);
      finish();
    }
  };

  /* =========================================================================
   * UX-04 ポストマッチ「今節の号」
   * panels: [{id, html, sfx, hold, onShow(el)}]（league.js が組む）
   * opts:   { res, celebrate, title, sub, closeLabel, tapHint }
   * ========================================================================= */
  Matchday.playPostMatch = function (panels, opts, done) {
    var finish = _once(done);
    opts = opts || {};
    panels = (panels || []).filter(Boolean);

    if (!panels.length) { finish(); return; }

    var ov;
    try {
      ov = _mkOverlay('lg-md-post');
      // ★ 積み上げ式（下に伸びる誌面）をやめ、**1ビート=1画面のカードデッキ**にする。
      //   ヘッダ / デッキ / ナビ の3段固定で、本文はスクロールで伸びない。
      var dots = '';
      for (var d = 0; d < panels.length; d++) dots += '<i class="lg-md-dot"></i>';
      ov.innerHTML =
        '<div class="lg-md-paper" aria-hidden="true"><canvas data-labart="paper_texture"></canvas></div>' +
        '<div class="lg-md-head">' +
          '<button type="button" class="lg-md-quit" aria-label="close">✕</button>' +
          '<div class="lg-md-mast">' + (opts.title || '') + '</div>' +
          (opts.sub ? '<div class="lg-md-issue">' + opts.sub + '</div>' : '') +
          '<div class="lg-md-dots">' + dots + '</div>' +
        '</div>' +
        '<div class="lg-md-deck"></div>' +
        '<div class="lg-md-nav">' +
          '<button type="button" class="lg-md-prev" aria-label="prev">◀</button>' +
          '<div class="lg-md-step"></div>' +
          '<button type="button" class="lg-md-next">' + (opts.tapHint || '▶') + '</button>' +
        '</div>';

      if (typeof LgUI !== 'undefined' && LgUI.paintArt) LgUI.paintArt(ov);

      var deck = ov.querySelector('.lg-md-deck');
      var dotEls = ov.querySelectorAll('.lg-md-dot');
      var stepEl = ov.querySelector('.lg-md-step');
      var prevB = ov.querySelector('.lg-md-prev');
      var nextB = ov.querySelector('.lg-md-next');
      var quitB = ov.querySelector('.lg-md-quit');

      function close() {
        var j2 = _juice();
        // ★ 監督室への復帰は暗転のピークで（カードが消えてから背後が見える、を避ける）
        if (j2 && j2.screenSwap) j2.screenSwap(function () { _kill(ov); finish(); });
        else { _kill(ov); finish(); }
      }

      var seqOpts = {
        mode: 'replace',
        tapTarget: deck,
        onIndex: function (idx, total) {
          Array.prototype.forEach.call(dotEls, function (n, k) {
            if (k === idx) n.className = 'lg-md-dot on';
            else if (k < idx) n.className = 'lg-md-dot past';
            else n.className = 'lg-md-dot';
          });
          if (stepEl) stepEl.textContent = (idx + 1) + ' / ' + total;
          if (prevB) prevB.disabled = (idx === 0);
          // 最後のカードでは「▶」を「監督室へ戻る」に変える＝出口が迷子にならない
          if (nextB) nextB.textContent = (idx === total - 1)
            ? (opts.closeLabel || 'CLOSE') : (opts.tapHint || '▶');
          if (nextB) nextB.className = 'lg-md-next' + (idx === total - 1 ? ' final' : '');
        },
        onDone: close
      };

      var j = _juice();
      if (j && j.sequence) {
        j.sequence(deck, panels, seqOpts);
        // ナビのボタンはデッキのタップ送りに伝播させない（二重送りを防ぐ）
        if (prevB) prevB.addEventListener('click', function (e) { e.stopPropagation(); if (seqOpts.controls) seqOpts.controls.prev(); });
        if (nextB) nextB.addEventListener('click', function (e) { e.stopPropagation(); if (seqOpts.controls) seqOpts.controls.next(); });
      } else {
        // Juice 未搭載: 全部そのまま積んで出口を出す（内容は必ず全部見える）
        panels.forEach(function (p) {
          var el = document.createElement('div');
          el.className = 'lgj-panel' + (p.id ? ' lgj-' + p.id : '');
          el.innerHTML = (typeof p.html === 'function') ? (p.html() || '') : (p.html || '');
          deck.appendChild(el);
          try { if (p.onShow) p.onShow(el, true); } catch (e) {}
        });
        if (stepEl) stepEl.textContent = panels.length + ' / ' + panels.length;
        if (nextB) { nextB.textContent = opts.closeLabel || 'CLOSE'; nextB.className = 'lg-md-next final'; nextB.addEventListener('click', close); }
      }
      if (quitB) quitB.addEventListener('click', function (e) { e.stopPropagation(); close(); });
    } catch (e) {
      console.warn('[matchday] post-match failed, falling back', e);
      _kill(ov);
      finish();
    }
  };

  window.Matchday = Matchday;
})();
