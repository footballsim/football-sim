/**
 * lg-ui.js — 試合外の UI 部品（lab限定 / LAB_UI_DESIGN.md §4.3・UX-01/05/06）
 * ---------------------------------------------------------------------------
 * 状態を持たない純粋な HTML 文字列ビルダ＋描画ヘルパ。
 *
 * 設計上の約束:
 *   - **文言を自前で持たない**。表示文字列はすべて呼び出し側（league.js）から
 *     受け取る（AGENTS.md 規約4「i18n は日英の両方」を新規モジュールで踏み外さない）。
 *   - クラブの解決も持たない。opts.club(id) -> {crest,color,name} を受け取る。
 *   - LabArt / Portrait / Juice は任意依存（typeof ガード）。未搭載でも成立する。
 *
 * ★ 設計書からの意図的な逸脱:
 *   officeShell(inner) は「content を包む」設計だったが、既存の横長2カラム
 *   （style.css の body.league-mode .lg-cols）を壊すリスクがあるため、
 *   **DOM を包まず背景レイヤだけを敷く** mountOffice(host) に変更した。
 */
(function () {
  'use strict';

  var LgUI = {};

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  LgUI.esc = _esc;

  /* onclick="f('...')" の中に埋める文字列。
   * ★ アポストロフィを &#39; にすると HTML デコード後に JS 文字列が割れる
   *   （例: N'Golo → f(0,'N'Golo') で構文エラー）。JS 側を \' でエスケープし、
   *   属性値としては " < > & だけを実体参照にする。 */
  function _jsAttr(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  LgUI.jsAttr = _jsAttr;

  function _clubOf(opts, id) {
    var f = opts && opts.club;
    var c = (typeof f === 'function') ? f(id) : null;
    return c || { crest: '', color: '#8899aa', name: id };
  }

  /* ── UX-01 監督室の背景レイヤ ──────────────────────────────────────────
   * host（#screen-home）の一番下に背景＋デスクの帯を敷く。冪等。
   * 実画像（img/lab/office_bg.png 等）が無ければ LabArt が手続き描画する。 */
  LgUI.mountOffice = function (host) {
    if (!host) return;
    if (host.querySelector(':scope > .lg-office-backdrop')) return;
    var bd = document.createElement('div');
    bd.className = 'lg-office-backdrop';
    bd.setAttribute('aria-hidden', 'true');
    bd.innerHTML =
      '<canvas class="lg-office-art" data-labart="office_bg"></canvas>' +
      '<canvas class="lg-office-deskart" data-labart="office_desk"></canvas>' +
      '<div class="lg-office-vignette"></div>';
    host.insertBefore(bd, host.firstChild);
    LgUI.paintArt(bd);
  };

  /** [data-labart] の canvas を LabArt で塗る。実画像が無くても必ず絵になる。
   * サイズ測定と再試行は LabArt.fitLater に任せる（挿入直後の 0px を踏まないため）。 */
  var _artPreload = null;
  LgUI.paintArt = function (root) {
    if (!root || typeof LabArt === 'undefined' || !LabArt.fitLater) return;
    function paint() {
      var list = root.querySelectorAll('canvas[data-labart]');
      Array.prototype.forEach.call(list, function (cv) { LabArt.fitLater(cv); });
    }
    paint();
    if (!_artPreload && LabArt.preload) _artPreload = LabArt.preload(['boardroom', 'office_bg']);
    if (_artPreload) _artPreload.then(paint);
  };

  /* 画面サイズが変わったら背景アートを測り直して塗り直す（横持ち⇄縦持ち対策）。 */
  var _rzT = null;
  window.addEventListener('resize', function () {
    if (_rzT) clearTimeout(_rzT);
    _rzT = setTimeout(function () { LgUI.paintArt(document); }, 180);
  });

  /* ── 見出し ─────────────────────────────────────────────────────────── */
  LgUI.sectionTitle = function (text, badge) {
    return '<div class="lg-h">' + text + (badge ? '<span class="lg-badge">' + badge + '</span>' : '') + '</div>';
  };

  /* ── UX-02 連携: 伸びるバー ───────────────────────────────────────────
   * data-pct を持つ .lg-stat-fill を返す。実際の伸長は呼び出し側が
   * Juice.growBar() で行う（LgUI は動かさない＝状態を持たない原則）。 */
  LgUI.statBar = function (label, value, max, opts) {
    opts = opts || {};
    max = max || 100;
    var pct = Math.max(0, Math.min(100, (value / max) * 100));
    var col = opts.color || 'linear-gradient(90deg,#4a9eff,#7ad0ff)';
    return '<div class="lg-stat">' +
      '<div class="lg-stat-label">' + label + '</div>' +
      '<div class="lg-stat-track"><i class="lg-stat-fill" data-pct="' + pct.toFixed(1) + '" ' +
        'style="background:' + col + '"></i></div>' +
      '<div class="lg-stat-val"' + (opts.valColor ? ' style="color:' + opts.valColor + '"' : '') + '>' +
        (opts.text != null ? opts.text : Math.round(value)) + '</div>' +
      '</div>';
  };

  /** statBar 群をまとめて伸ばす（Juice があれば animate・無ければ即時）。 */
  LgUI.growBars = function (root, opts) {
    if (!root) return;
    opts = opts || {};
    var fills = root.querySelectorAll('.lg-stat-fill[data-pct]');
    Array.prototype.forEach.call(fills, function (el, i) {
      var pct = parseFloat(el.getAttribute('data-pct')) || 0;
      if (typeof Juice !== 'undefined' && Juice.growBar) {
        Juice.growBar(el, pct, { dur: opts.dur || 700, delay: (opts.step != null ? opts.step : 70) * i });
      } else {
        el.style.width = pct + '%';
      }
    });
  };

  /* ── UX-06 ゲーム順位表 ────────────────────────────────────────────────
   * 素の <table> をやめ、行＝カードのリーグ表にする。
   * rows: [{id,p,w,d,l,gd,pts}] / opts: {club(id), labels:{club,p,w,d,l,gd,pts},
   *        move:{id,from,to}, promo:n, releg:n} */
  LgUI.standings = function (rows, myId, opts) {
    opts = opts || {};
    var L = opts.labels || {};
    var head = '<div class="lg-tbl-head">' +
      '<span class="c-pos"></span>' +
      '<span class="c-nm">' + (L.club || '') + '</span>' +
      '<span class="c-n">' + (L.p || 'P') + '</span>' +
      '<span class="c-n">' + (L.w || 'W') + '</span>' +
      '<span class="c-n">' + (L.d || 'D') + '</span>' +
      '<span class="c-n">' + (L.l || 'L') + '</span>' +
      '<span class="c-n">' + (L.gd || 'GD') + '</span>' +
      '<span class="c-pts">' + (L.pts || 'Pts') + '</span></div>';

    var mv = opts.move;
    var body = (rows || []).map(function (r, i) {
      var c = _clubOf(opts, r.id);
      var me = (r.id === myId);
      var gd = (r.gd > 0 ? '+' : '') + r.gd;
      // 順位変動の▲▼（自クラブのみ・試合直後のパネルで意味を持つ）
      var move = '';
      if (mv && mv.id === r.id && mv.from && mv.to && mv.from !== mv.to) {
        var up = mv.to < mv.from;
        move = '<span class="lg-tbl-move ' + (up ? 'up' : 'down') + '">' +
          (up ? '▲' : '▼') + Math.abs(mv.from - mv.to) + '</span>';
      }
      var zone = (opts.promo && i < opts.promo) ? ' promo' : ((opts.releg && i >= (rows.length - opts.releg)) ? ' releg' : '');
      return '<div class="lg-tbl-row' + (me ? ' me' : '') + zone + '">' +
        '<span class="c-pos">' + (i + 1) + '</span>' +
        '<span class="c-nm"><i class="lg-dot" style="background:' + c.color + '"></i>' +
          '<span class="lg-tbl-crest">' + c.crest + '</span>' +
          '<span class="lg-tbl-name">' + c.name + '</span>' + move + '</span>' +
        '<span class="c-n">' + r.p + '</span>' +
        '<span class="c-n">' + r.w + '</span>' +
        '<span class="c-n">' + r.d + '</span>' +
        '<span class="c-n">' + r.l + '</span>' +
        '<span class="c-n">' + gd + '</span>' +
        '<span class="c-pts">' + r.pts + '</span></div>';
    }).join('');

    return '<div class="lg-tbl">' + head + body + '</div>';
  };

  /* ── UX-06 選手ピッカー（<select> の置換）────────────────────────────
   * players: [{key, name, portrait}]  fnName: 'leagueSetTrainee' 等
   * 顔は <canvas data-portrait="..."> を置くだけ（描画は呼び出し側）。 */
  LgUI.playerPicker = function (players, curKey, fnName, slotIdx, opts) {
    opts = opts || {};
    var cards = (players || []).map(function (p) {
      var on = (p.key === curKey);
      var k = _jsAttr(p.key);
      return '<button type="button" class="lg-pk-card' + (on ? ' on' : '') + '" ' +
        'onclick="' + fnName + '(' + slotIdx + ',\'' + k + '\')" title="' + _esc(p.name) + '">' +
        '<canvas class="lg-pk-face" width="112" height="130" data-portrait="' + _esc(p.portrait || p.name) + '"></canvas>' +
        '<span class="lg-pk-name">' + _esc(p.name) + '</span>' +
        (p.sub ? '<span class="lg-pk-sub">' + _esc(p.sub) + '</span>' : '') +
        '</button>';
    }).join('');
    return '<div class="lg-pk"' + (opts.label ? ' aria-label="' + _esc(opts.label) + '"' : '') + '>' +
      '<div class="lg-pk-strip">' + cards + '</div></div>';
  };

  /* ── 結果スタンプ（W/D/L）────────────────────────────────────────────── */
  LgUI.resultStamp = function (res) {
    var key = res === 'W' ? 'stamp_win' : (res === 'L' ? 'stamp_loss' : 'stamp_draw');
    return '<canvas class="lg-stampart" width="220" height="220" data-labart="' + key + '"></canvas>';
  };

  /* ── UX-05 BEST XI 見開き ──────────────────────────────────────────────
   * ピッチ図の上に FW→MF→DF→GK を並べる「雑誌の紙面」。
   * xi: {GK:[],DF:[],MF:[],FW:[]}  各要素 {name, clubId, rating, goals, assists, portrait}
   * mode: 'weekly'(黄×黒 専門誌) | 'season'(紺×金 協会公式)
   * t: {title, sub}   opts: {club(id), faces:true} */
  LgUI.bestXISpread = function (xi, mode, t, opts) {
    if (!xi || !xi.GK || !xi.GK.length) return '';
    opts = opts || {}; t = t || {};
    var weekly = (mode === 'weekly');
    var faces = opts.faces !== false;

    var head = weekly
      ? '<div class="lg-sp-head weekly"><span class="lg-sp-title">⚽ ' + (t.title || '') + '</span>' +
        '<span class="lg-sp-sub">' + (t.sub || '') + '</span></div>'
      : '<div class="lg-sp-head season"><div class="lg-sp-sub">' + (t.sub || '') + '</div>' +
        '<div class="lg-sp-title">🏅 ' + (t.title || '') + '</div><i class="lg-sp-rule"></i></div>';

    function card(p) {
      var c = _clubOf(opts, p.clubId);
      var stat = (p.goals ? '⚽' + p.goals : '') + (p.assists ? ' 🅰' + p.assists : '');
      return '<div class="lg-sp-card">' +
        (faces ? '<canvas class="lg-sp-face" width="96" height="112" data-portrait="' + _esc(p.portrait || p.key || p.name) + '"></canvas>' : '') +
        '<span class="lg-sp-crest" style="color:' + c.color + '">' + c.crest + '</span>' +
        '<span class="lg-sp-name">' + _esc(p.name) + '</span>' +
        '<span class="lg-sp-rate">' + (typeof p.rating === 'number' ? p.rating.toFixed(1) : p.rating) + '</span>' +
        (stat ? '<span class="lg-sp-stat">' + stat + '</span>' : '') +
        '</div>';
    }
    function line(label, arr) {
      if (!arr || !arr.length) return '';
      return '<div class="lg-sp-line"><span class="lg-sp-lbl">' + label + '</span>' +
        '<div class="lg-sp-row">' + arr.map(card).join('') + '</div></div>';
    }

    return '<div class="lg-sp ' + (weekly ? 'weekly' : 'season') + '">' + head +
      '<div class="lg-sp-pitch">' +
        line('FW', xi.FW) + line('MF', xi.MF) + line('DF', xi.DF) + line('GK', xi.GK) +
      '</div></div>';
  };

  /* ── UX-05 本棚（バックナンバー）──────────────────────────────────────
   * <details> をやめ、背表紙が並ぶ棚にする。タップで1冊開く（ページめくり）。
   * issues: [{label, sub, champCrest, color, achieved}]  fnName: 'leagueOpenIssue' */
  LgUI.shelf = function (issues, fnName, opts) {
    opts = opts || {};
    var spines = (issues || []).map(function (h, i) {
      var col = h.color || '#3f6fae';
      var badge = (h.achieved === true) ? ' ok' : (h.achieved === false ? ' ng' : '');
      return '<button type="button" class="lg-spine' + badge + '" style="--spine:' + col + '" ' +
        'onclick="' + fnName + '(' + i + ')" title="' + _esc(h.label) + '">' +
        '<span class="lg-spine-label">' + _esc(h.label) + '</span>' +
        '<span class="lg-spine-crest">' + (h.champCrest || '') + '</span>' +
        (h.sub ? '<span class="lg-spine-sub">' + _esc(h.sub) + '</span>' : '') +
        '</button>';
    }).join('');
    return '<div class="lg-shelf">' +
      '<div class="lg-shelf-books">' + spines + '</div>' +
      '<canvas class="lg-shelf-plank" data-labart="shelf_wood"></canvas>' +
      '</div>';
  };

  /** 棚から開いた「1冊」のページ体裁（紙テクスチャの上に載せる）。 */
  LgUI.issuePage = function (html, opts) {
    opts = opts || {};
    return '<div class="lg-issue">' +
      (opts.title ? '<div class="lg-issue-head">' + opts.title + '</div>' : '') +
      '<div class="lg-issue-body">' + html + '</div></div>';
  };

  /* ── 顔の描画（Portrait 依存・任意）──────────────────────────────────── */
  LgUI.paintPortraits = function (root, opts) {
    if (!root || typeof Portrait === 'undefined') return;
    opts = opts || {};
    var list = root.querySelectorAll('canvas[data-portrait]');
    if (!list.length) return;
    Portrait.preload().then(function () {
      Array.prototype.forEach.call(list, function (cv) {
        try {
          Portrait.render(cv, cv.getAttribute('data-portrait'), { team: opts.team || cv.getAttribute('data-team') || undefined });
        } catch (e) { /* 顔が出なくても紙面は成立する */ }
      });
    }).catch(function () {});
  };

  window.LgUI = LgUI;
})();
