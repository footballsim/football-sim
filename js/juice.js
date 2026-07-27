/**
 * juice.js — UX-02「手触り」基盤（lab限定 / LAB_UI_DESIGN.md §4.1）
 * ---------------------------------------------------------------------------
 * 試合外パートに効果音・カウントアップ・バー伸長・紙吹雪・画面遷移・
 * 「1コマずつ開く」シーケンサを与える。依存なし（単体で完結）。
 *
 * 設計上の約束:
 *   - 音源ファイルも画像も追加しない。SFX は WebAudio で合成する。
 *   - window.JUICE_ENABLED===false / prefers-reduced-motion で全演出を切り、
 *     「即時に最終状態」へフォールバックする（機能は絶対に失われない）。
 *   - AudioContext はユーザー操作後に遅延生成（自動再生ブロック回避）。
 *   - 例外を外へ投げない。音が鳴らない環境でも UI は必ず進む。
 */
(function () {
  'use strict';

  var Juice = {};

  /* ── 可否判定 ────────────────────────────────────────────────────────── */
  function _reduced() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }
  Juice.reduced = _reduced;
  // 演出してよいか。false のときは各APIが「即座に最終状態」を適用する。
  Juice.ready = function () { return window.JUICE_ENABLED !== false && !_reduced(); };

  /* ── SFX（WebAudio 合成）─────────────────────────────────────────────
   * 音源アセットを増やさないため、すべてオシレータ＋ノイズで作る。 */
  var _ac = null, _master = null;

  function _ctx() {
    if (window.SFX_ENABLED === false) return null;
    if (_ac) {
      if (_ac.state === 'suspended') { try { _ac.resume(); } catch (e) {} }
      return _ac;
    }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      _ac = new AC();
      _master = _ac.createGain();
      _master.gain.value = 0.32;          // 全体音量（控えめ＝UI音として邪魔しない）
      _master.connect(_ac.destination);
    } catch (e) { _ac = null; _master = null; }
    return _ac;
  }

  // 減衰エンベロープ。dest へ繋いだ GainNode を返す。
  function _env(ac, gain, dur, delay, attack) {
    var g = ac.createGain();
    var t = ac.currentTime + (delay || 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + (attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(_master);
    return g;
  }

  // 単音。f1 を与えると f0→f1 へスイープする。
  function _osc(ac, type, f0, f1, dur, gain, delay) {
    var t = ac.currentTime + (delay || 0);
    var o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    o.connect(_env(ac, gain, dur, delay));
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  // ノイズバースト（紙・打撃・歓声の素）。cut>0 でハイパス、cut<0 でローパス。
  function _noise(ac, dur, gain, cut, delay) {
    var n = Math.max(1, Math.floor(ac.sampleRate * dur));
    var buf = ac.createBuffer(1, n, ac.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = ac.createBufferSource(); src.buffer = buf;
    var f = ac.createBiquadFilter();
    f.type = cut >= 0 ? 'highpass' : 'lowpass';
    f.frequency.value = Math.abs(cut) || 900;
    src.connect(f);
    f.connect(_env(ac, gain, dur, delay));
    src.start(ac.currentTime + (delay || 0));
  }

  var _SFX = {
    whistle: function (ac) {                    // 主審のホイッスル（2吹き）
      _osc(ac, 'square', 2050, 2250, 0.16, 0.20, 0);
      _osc(ac, 'square', 2600, 2400, 0.16, 0.10, 0);
      _osc(ac, 'square', 2050, 2250, 0.20, 0.20, 0.21);
      _osc(ac, 'square', 2600, 2400, 0.20, 0.10, 0.21);
    },
    page: function (ac) { _noise(ac, 0.20, 0.16, 1400, 0); _noise(ac, 0.12, 0.08, 2600, 0.07); },
    stamp: function (ac) { _osc(ac, 'sine', 150, 55, 0.16, 0.42, 0); _noise(ac, 0.06, 0.22, -1800, 0); },
    ping: function (ac) { _osc(ac, 'sine', 880, 880, 0.26, 0.20, 0); _osc(ac, 'sine', 1760, 1760, 0.18, 0.07, 0); },
    fanfare: function (ac) {                    // 習得・達成の3音アルペジオ
      _osc(ac, 'triangle', 523.25, 523.25, 0.16, 0.22, 0.00);
      _osc(ac, 'triangle', 659.25, 659.25, 0.16, 0.22, 0.11);
      _osc(ac, 'triangle', 783.99, 783.99, 0.42, 0.26, 0.22);
      _osc(ac, 'triangle', 1046.5, 1046.5, 0.42, 0.12, 0.22);
    },
    thud: function (ac) { _osc(ac, 'sine', 95, 42, 0.28, 0.40, 0); },
    tick: function (ac) { _osc(ac, 'square', 1250, 1250, 0.035, 0.10, 0); },
    coin: function (ac) { _osc(ac, 'square', 988, 988, 0.07, 0.14, 0); _osc(ac, 'square', 1319, 1319, 0.16, 0.14, 0.07); },
    crowd: function (ac) { _noise(ac, 1.1, 0.10, -900, 0); },
    lose: function (ac) { _osc(ac, 'sawtooth', 320, 130, 0.5, 0.16, 0); },
    // カメラのシャッター（記者会見のフラッシュ）
    flash: function (ac) { _noise(ac, 0.035, 0.30, 3200, 0); _noise(ac, 0.09, 0.14, 1800, 0.04); }
  };

  /**
   * 効果音を鳴らす。失敗しても絶対に例外を投げない。
   * @param {string} name whistle|page|stamp|ping|fanfare|thud|tick|coin|crowd|lose
   */
  Juice.sfx = function (name) {
    try {
      if (window.SFX_ENABLED === false) return;
      var fn = _SFX[name]; if (!fn) return;
      var ac = _ctx(); if (!ac || !_master) return;
      fn(ac);
    } catch (e) { /* 音は「あれば嬉しい」もの。鳴らなくても進行を止めない */ }
  };

  /* ── 数値カウントアップ ──────────────────────────────────────────────── */
  Juice.countUp = function (el, to, opts) {
    opts = opts || {};
    if (!el) return;
    var fmt = opts.fmt || function (v) { return String(v); };
    var from = (opts.from != null) ? opts.from : 0;
    if (!Juice.ready()) { el.textContent = fmt(to); if (opts.onDone) opts.onDone(); return; }
    var dur = opts.dur || 600, t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);                 // easeOutCubic
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(step);
      else if (opts.onDone) opts.onDone();
    }
    requestAnimationFrame(step);
  };

  /* ── バーの伸長（監督ステータス等）───────────────────────────────────── */
  Juice.growBar = function (el, pct, opts) {
    opts = opts || {};
    if (!el) return;
    pct = Math.max(0, Math.min(100, pct));
    if (!Juice.ready()) { el.style.width = pct + '%'; return; }
    el.style.width = '0%';
    el.style.transition = 'width ' + ((opts.dur || 700) / 1000) + 's cubic-bezier(.22,.61,.36,1)' +
      (opts.delay ? ' ' + (opts.delay / 1000) + 's' : '');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.style.width = pct + '%'; });
    });
  };

  /* ── 紙吹雪 ─────────────────────────────────────────────────────────── */
  Juice.confetti = function (host, opts) {
    opts = opts || {};
    if (!host || !Juice.ready()) return;
    try {
      var w = host.clientWidth || 320, h = host.clientHeight || 200;
      if (w < 8 || h < 8) return;
      var cv = document.createElement('canvas');
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = w * dpr; cv.height = h * dpr;
      cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5';
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.appendChild(cv);
      var ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);

      var colors = opts.colors || ['#ffd24a', '#ffffff', '#7ad0ff', '#2ecc71'];
      var n = opts.count || 80, dur = opts.dur || 2200, ps = [];
      for (var i = 0; i < n; i++) {
        ps.push({
          x: w * (0.15 + 0.7 * Math.random()), y: h * (0.35 + 0.2 * Math.random()),
          vx: (Math.random() - 0.5) * 5.2, vy: -(2.2 + Math.random() * 4.6),
          s: 3 + Math.random() * 4, r: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.32, c: colors[(Math.random() * colors.length) | 0]
        });
      }
      var t0 = null;
      function frame(ts) {
        if (t0 === null) t0 = ts;
        var el = ts - t0;
        if (el > dur) { if (cv.parentNode) cv.parentNode.removeChild(cv); return; }
        ctx.clearRect(0, 0, w, h);
        ctx.globalAlpha = Math.max(0, 1 - el / dur);
        for (var j = 0; j < ps.length; j++) {
          var p = ps[j];
          p.vy += 0.13; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx *= 0.995;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
          ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 1.7);
          ctx.restore();
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    } catch (e) { /* 演出の失敗で画面を壊さない */ }
  };

  /* ── カメラのフラッシュ（記者会見）──────────────────────────────────── */
  Juice.flash = function (host, opts) {
    opts = opts || {};
    if (!host || !Juice.ready()) return;
    try {
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      var n = opts.count || 3;
      for (var k = 0; k < n; k++) {
        (function (idx) {
          setTimeout(function () {
            var f = document.createElement('div');
            f.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:6;' +
              'background:radial-gradient(60% 50% at ' + (18 + Math.random() * 64) + '% ' +
              (14 + Math.random() * 30) + '%,rgba(255,255,255,.92),rgba(255,255,255,0) 70%);' +
              'opacity:0;transition:opacity .07s ease-out';
            host.appendChild(f);
            requestAnimationFrame(function () {
              f.style.opacity = '1';
              setTimeout(function () {
                f.style.transition = 'opacity .22s ease-in';
                f.style.opacity = '0';
                setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 240);
              }, 45);
            });
            Juice.sfx('flash');
          }, idx * 130 + Math.random() * 70);
        })(k);
      }
    } catch (e) { /* 演出の失敗で画面を壊さない */ }
  };

  /* ── 出現（単体 / 連続）──────────────────────────────────────────────── */
  Juice.reveal = function (el, opts) {
    opts = opts || {};
    if (!el) return;
    if (!Juice.ready()) { el.style.opacity = '1'; el.style.transform = 'none'; return; }
    var dur = opts.dur || 380, dy = (opts.dir === 'down') ? -14 : 14;
    el.style.opacity = '0';
    el.style.transform = 'translateY(' + dy + 'px)';
    el.style.transition = 'opacity ' + (dur / 1000) + 's ease, transform ' + (dur / 1000) + 's cubic-bezier(.22,.61,.36,1)';
    if (opts.delay) el.style.transitionDelay = (opts.delay / 1000) + 's';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    });
  };

  Juice.stagger = function (els, opts) {
    opts = opts || {};
    Array.prototype.forEach.call(els || [], function (el, i) {
      Juice.reveal(el, { dur: opts.dur || 300, delay: (opts.step || 45) * i, dir: opts.dir });
    });
  };

  /* ── シーケンサ ────────────────────────────────────────────────────────
   * 2つのモードがある。
   *
   *   mode:'replace'（既定で使うべき／カードデッキ）
   *     1ビートが1画面を占有し、タップで**入れ替わる**。前後移動できる。
   *     ★ 積み上げ式（下に伸びる）は「文書」に見えてゲームらしくない、という
   *       実プレイのフィードバックで既定を replace に寄せた（2026-07-24）。
   *
   *   mode:'stack'（旧・誌面が下に伸びる）
   *     互換のために残す。演出OFF時は全パネルを即座に積んで完了する。
   *
   * @param {HTMLElement} host  描画先
   * @param {Array} panels [{id, html|fn, sfx, onShow(el,firstTime), await(el,next)}]
   * @param {Object} opts {mode, tapTarget, onIndex(i,total,firstTime), onDone}
   * @returns {Promise<void>}
   */
  Juice.sequence = function (host, panels, opts) {
    opts = opts || {};
    panels = (panels || []).filter(Boolean);
    var replace = (opts.mode === 'replace');

    return new Promise(function (resolve) {
      if (!host || !panels.length) { if (opts.onDone) opts.onDone(); resolve(); return; }
      var i = -1, finished = false, blocked = false, busy = false;
      var seen = {}, answered = {};

      // replace モードは「1枚だけ載る舞台」を作り、その中身を差し替える
      var stage = host;
      if (replace) {
        stage = document.createElement('div');
        stage.className = 'lgj-stage';
        host.appendChild(stage);
      }

      function build(p) {
        var el = document.createElement('div');
        el.className = 'lgj-panel' + (p.id ? ' lgj-' + p.id : '');
        // html は文字列でも関数でもよい。関数なら「表示する瞬間」に評価するので、
        // 直前のコマ（記者会見など）の結果を反映した内容を出せる。
        el.innerHTML = (typeof p.html === 'function') ? (p.html() || '') : (p.html || '');
        return el;
      }

      function finish() {
        if (finished) return;
        finished = true;
        detach();
        if (opts.onDone) { try { opts.onDone(); } catch (e) {} }
        resolve();
      }

      function present(idx, dir) {
        var p = panels[idx];
        var el = build(p);
        var firstTime = !seen[idx];
        seen[idx] = true;

        if (replace) {
          var old = stage.firstChild;
          stage.appendChild(el);
          if (Juice.ready()) {
            var dx = (dir < 0 ? -28 : 28);
            el.style.opacity = '0';
            el.style.transform = 'translateX(' + dx + 'px)';
            el.style.transition = 'opacity .24s ease, transform .3s cubic-bezier(.22,.61,.36,1)';
            requestAnimationFrame(function () {
              requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'translateX(0)'; });
            });
            if (old) {
              old.style.transition = 'opacity .16s ease, transform .2s ease-in';
              old.style.opacity = '0';
              old.style.transform = 'translateX(' + (-dx) + 'px)';
              setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 190);
            }
          } else if (old && old.parentNode) {
            old.parentNode.removeChild(old);
          }
        } else {
          host.appendChild(el);
          Juice.reveal(el);
          try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
        }

        // 効果音と祝祭は「初めて見たとき」だけ（戻って再表示で紙吹雪が再発しない）
        if (p.sfx && firstTime) Juice.sfx(p.sfx);
        try { if (p.onShow) p.onShow(el, firstTime); } catch (e) { console.warn('[juice] onShow failed', e); }
        if (opts.onIndex) { try { opts.onIndex(idx, panels.length, firstTime); } catch (e) {} }
        return el;
      }

      function goTo(idx, dir) {
        if (finished || busy || blocked) return;
        if (idx < 0) return;
        if (idx >= panels.length) { finish(); return; }
        busy = true;
        i = idx;
        var el = present(idx, dir || 1);
        var p = panels[idx];

        // ★ 入力待ちのコマ（記者会見など）＝答えるまで前後に動かさない。
        //   一度答えたコマに戻ってきたときは、もうブロックしない。
        if (typeof p.await === 'function' && !answered[idx]) {
          blocked = true;
          var resumed = false;
          try {
            p.await(el, function () {
              if (resumed || finished) return;
              resumed = true; answered[idx] = true; blocked = false;
              goTo(i + 1, 1);
            });
          } catch (e) { blocked = false; console.warn('[juice] await failed', e); }
        }
        setTimeout(function () { busy = false; }, 240);   // 連打で飛ばされない最小間隔
      }

      function advance() { goTo(i + 1, 1); }
      function back() { goTo(i - 1, -1); }

      // stack モードで演出OFF: 全部そのまま積んで終わり（内容は必ず全部見える）
      if (!replace && !Juice.ready()) {
        for (var k = 0; k < panels.length; k++) {
          var el0 = build(panels[k]);
          host.appendChild(el0);
          try { if (panels[k].onShow) panels[k].onShow(el0, true); } catch (e) {}
        }
        finish();
        return;
      }

      function onKey(e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); advance(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      }
      var tapOn = opts.tapTarget || host;
      function detach() {
        tapOn.removeEventListener('click', advance);
        document.removeEventListener('keydown', onKey);
      }
      tapOn.addEventListener('click', advance);
      document.addEventListener('keydown', onKey);

      // 外から前後させるための操作口（ナビのボタン用）
      opts.controls = { next: advance, prev: back, close: finish,
                        index: function () { return i; }, total: panels.length };

      goTo(0, 1);
    });
  };

  /* ── ページめくり（バックナンバー用）──────────────────────────────────── */
  Juice.pageTurn = function (host, nextHTML, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (!host) { resolve(); return; }
      if (!Juice.ready()) { host.innerHTML = nextHTML; resolve(); return; }
      Juice.sfx('page');
      host.style.transformOrigin = 'left center';
      host.style.transition = 'transform .24s ease-in, opacity .24s ease-in';
      host.style.transform = 'perspective(1200px) rotateY(-16deg)';
      host.style.opacity = '0';
      setTimeout(function () {
        host.innerHTML = nextHTML;
        host.style.transition = 'none';
        host.style.transform = 'perspective(1200px) rotateY(14deg)';
        requestAnimationFrame(function () {
          host.style.transition = 'transform .3s cubic-bezier(.22,.61,.36,1), opacity .3s ease-out';
          host.style.transform = 'perspective(1200px) rotateY(0deg)';
          host.style.opacity = '1';
          setTimeout(function () { host.style.transition = ''; host.style.transform = ''; resolve(); }, 320);
        });
      }, 250);
    });
  };

  /* ── 画面差し替えのフェード ──────────────────────────────────────────── */
  /* 画面の入れ替えを暗転のピークで行う。
   * ★ fn は「演出のついで」ではなく **進行そのもの**（次の画面へ進む処理）が渡ってくる。
   *   requestAnimationFrame はタブが非表示だと発火しないので、rAF に載せたままだと
   *   「バックグラウンドにした瞬間コールバックが永久に来ない＝進行が止まる」が起きる。
   *   実害: 試合前カットシーン中に画面を離れるとキックオフできなくなる（リロードするまで復帰不能）。
   *   → fn は一度きり保証＋タイマーの保険を必ず持たせ、演出が動かなくても進行だけは通す。 */
  Juice.screenSwap = function (fn, opts) {
    opts = opts || {};
    var ran = false;
    function runFn() {
      if (ran) return;
      ran = true;
      try { if (fn) fn(); } catch (e) { console.warn('[juice] screenSwap fn failed', e); }
    }
    if (!Juice.ready()) { runFn(); return Promise.resolve(); }
    var host = opts.host || document.body;
    return new Promise(function (resolve) {
      var done = false;
      function finish(ov) {
        if (done) return;
        done = true;
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        resolve();
      }
      var ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:#050b18;opacity:0;' +
        'pointer-events:none;transition:opacity .16s ease';
      host.appendChild(ov);
      // 保険：rAF が来なくても必ず進行させる（暗転の見栄えは捨てても進行は捨てない）
      var guard = setTimeout(function () { runFn(); finish(ov); }, 900);
      requestAnimationFrame(function () {
        ov.style.opacity = '1';
        setTimeout(function () {
          runFn();
          ov.style.opacity = '0';
          setTimeout(function () { clearTimeout(guard); finish(ov); }, 180);
        }, 170);
      });
    });
  };

  window.Juice = Juice;
})();
