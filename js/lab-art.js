/**
 * lab-art.js — 画像プレースホルダ解決（lab限定 / LAB_UI_DESIGN.md §2・§4.2）
 * ---------------------------------------------------------------------------
 * 「あとからCGを差し込む」ための唯一の入口。
 *
 *   - 実アセットは img/lab/<key>.png に置く（build が img/ ごと dist-lab へ複製）。
 *   - **無ければ手続き的プレースホルダを描く**ので、画像が1枚も無くても破綻しない。
 *   - 画像を差し替えたら LabArt.VER を上げる（★ build の自動 ?v= は index.html の
 *     タグにしか効かず、JS 内の画像URLには効かない — 既知の踏み抜き）。
 *
 * 依存なし。呼び出し側は必ず typeof LabArt !== 'undefined' でガードすること。
 */
(function () {
  'use strict';

  var LabArt = {};

  // ★ 画像を差し替えたらここを上げる（キャッシュバスト）
  LabArt.VER = '1';

  var DIR = 'img/lab/';

  /* CG発注リスト＝そのままスロット定義。desc は発注時の指示書になる。 */
  LabArt.SLOTS = {
    office_bg:     { w: 1280, h: 720,  desc: '監督室の背景（デスク越しの視点・ブラインド・戦術ボード）' },
    office_desk:   { w: 1280, h: 260,  desc: 'デスク面のテクスチャ（下部に帯として敷く）' },
    corkboard:     { w: 720,  h: 480,  desc: '掲示板（週の予定を貼る面）' },
    tunnel:        { w: 1280, h: 720,  desc: '入場トンネル（プレマッチ コマ1）' },
    stadium_night: { w: 1280, h: 720,  desc: 'スタジアム遠景・ナイター（プレマッチ コマ2）' },
    press_wall:    { w: 1280, h: 720,  desc: '記者会見のバックパネル（試合後の見出しコマ）' },
    paper_texture: { w: 1024, h: 1024, desc: '誌面の紙テクスチャ（tileable）' },
    shelf_wood:    { w: 1024, h: 256,  desc: '本棚の棚板（バックナンバー）' },
    stamp_win:     { w: 512,  h: 512,  desc: '勝利スタンプ（透過PNG）' },
    stamp_draw:    { w: 512,  h: 512,  desc: '引き分けスタンプ（透過PNG）' },
    stamp_loss:    { w: 512,  h: 512,  desc: '敗戦スタンプ（透過PNG）' }
  };

  var _img = {};      // key -> HTMLImageElement（読めたものだけ）
  var _tried = {};    // key -> true（試行済み）

  LabArt.url = function (key) { return DIR + key + '.png?v=' + LabArt.VER; };
  LabArt.has = function (key) { return !!_img[key]; };
  LabArt.image = function (key) { return _img[key] || null; };

  /** 指定キー（省略時は全部）を読み込む。404 は握りつぶして has()=false にする。 */
  LabArt.preload = function (keys) {
    var list = keys || Object.keys(LabArt.SLOTS);
    return Promise.all(list.map(function (k) {
      if (_tried[k]) return Promise.resolve();
      _tried[k] = true;
      return new Promise(function (res) {
        try {
          var im = new Image();
          im.onload = function () { _img[k] = im; res(); };
          im.onerror = function () { res(); };          // 未配置＝正常系
          im.src = LabArt.url(k);
        } catch (e) { res(); }
      });
    })).then(function () {});
  };

  /* ── 手続き的プレースホルダ（CSS 用の背景値）───────────────────────── */
  var _CSS_FALLBACK = {
    office_bg:     'linear-gradient(160deg,#0b1f3f 0%,#0a2a5e 52%,#0d1b3e 100%)',
    office_desk:   'linear-gradient(180deg,#4a3520 0%,#2b1d12 100%)',
    corkboard:     'linear-gradient(160deg,#7a5a35,#5d4227)',
    tunnel:        'radial-gradient(120% 90% at 50% 100%,#2a4f8a 0%,#0a1428 70%)',
    stadium_night: 'linear-gradient(180deg,#071a33 0%,#0d2f52 55%,#17612f 100%)',
    press_wall:    'linear-gradient(135deg,#101f3d 0%,#1b3157 100%)',
    paper_texture: 'linear-gradient(180deg,#f4efe2,#e8e0cd)',
    shelf_wood:    'linear-gradient(180deg,#6b4a2a,#3d2917)'
  };

  /** CSS の background に入れる値。実画像があればそれを、無ければ手続きグラデを返す。 */
  LabArt.bg = function (key, opts) {
    opts = opts || {};
    var fb = _CSS_FALLBACK[key] || 'linear-gradient(160deg,#0b1f3f,#0d1b3e)';
    if (!_img[key]) return fb;
    var size = opts.size || 'cover';
    var rep = opts.repeat || 'no-repeat';
    return 'url("' + LabArt.url(key) + '") center/' + size + ' ' + rep + ', ' + fb;
  };

  /* ── 手続き的プレースホルダ（canvas 描画）─────────────────────────── */
  function _grad(ctx, x, y, w, h, stops, vertical) {
    var g = vertical === false
      ? ctx.createLinearGradient(x, y, x + w, y)
      : ctx.createLinearGradient(x, y, x, y + h);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  }

  var _PAINT = {
    office_bg: function (ctx, x, y, w, h) {
      _grad(ctx, x, y, w, h, [[0, '#12305f'], [0.55, '#0c2247'], [1, '#0a1730']]);
      // ブラインドの縞（上半分）
      ctx.save(); ctx.globalAlpha = 0.10; ctx.fillStyle = '#cfe4ff';
      for (var by = y + h * 0.05; by < y + h * 0.46; by += Math.max(4, h * 0.045)) {
        ctx.fillRect(x, by, w, Math.max(1.5, h * 0.012));
      }
      ctx.restore();
      // 戦術ボード（右上の白い矩形）
      ctx.save(); ctx.globalAlpha = 0.09; ctx.fillStyle = '#eaf2ff';
      ctx.fillRect(x + w * 0.62, y + h * 0.10, w * 0.30, h * 0.30);
      ctx.restore();
      // 手前の暗い減光（情報を上に載せるため中央のコントラストを落とす）
      var vg = ctx.createRadialGradient(x + w / 2, y + h * 0.55, 0, x + w / 2, y + h * 0.55, Math.max(w, h) * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vg; ctx.fillRect(x, y, w, h);
    },
    office_desk: function (ctx, x, y, w, h) {
      _grad(ctx, x, y, w, h, [[0, '#4a3520'], [1, '#241a10']]);
      ctx.save(); ctx.globalAlpha = 0.16; ctx.strokeStyle = '#8a6438'; ctx.lineWidth = 1;
      for (var i = 0; i < 22; i++) {
        var yy = y + (h * (i + 0.5)) / 22;
        ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy + Math.sin(i) * 2); ctx.stroke();
      }
      ctx.restore();
    },
    corkboard: function (ctx, x, y, w, h) {
      _grad(ctx, x, y, w, h, [[0, '#7a5a35'], [1, '#5d4227']]);
      ctx.save(); ctx.globalAlpha = 0.16;
      for (var i = 0; i < 420; i++) {
        ctx.fillStyle = (i % 2) ? '#3a2a18' : '#a8834f';
        ctx.fillRect(x + Math.random() * w, y + Math.random() * h, 2, 2);
      }
      ctx.restore();
    },
    tunnel: function (ctx, x, y, w, h) {
      ctx.fillStyle = '#070d1a'; ctx.fillRect(x, y, w, h);
      // ★ 出口の光は「小さく・低く」。中央に文字が載るので明るい面を広げない。
      var g = ctx.createRadialGradient(x + w / 2, y + h * 0.78, Math.min(w, h) * 0.02,
        x + w / 2, y + h * 0.78, Math.max(w, h) * 0.48);
      g.addColorStop(0, '#b9d8f5'); g.addColorStop(0.18, '#2c5183'); g.addColorStop(1, '#050a14');
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      // トンネルの側壁
      ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#050a14';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w * 0.3, y + h * 0.5); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w * 0.7, y + h * 0.5); ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fill();
      ctx.restore();
    },
    // ★ 文字は画面中央に載る。地平線を下げ、発光を弱めて「中央を暗く保つ」。
    stadium_night: function (ctx, x, y, w, h) {
      var hz = y + h * 0.68;                        // 地平線（中央より下）
      _grad(ctx, x, y, w, h * 0.68, [[0, '#030c18'], [1, '#0a2440']]);
      _grad(ctx, x, hz, w, h * 0.32, [[0, '#14512780'], [1, '#0a2c15']]);
      // ピッチの縞（控えめ）
      ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = '#ffffff';
      for (var i = 0; i < 8; i += 2) ctx.fillRect(x + (w * i) / 8, hz, w / 8, h * 0.32);
      ctx.restore();
      // ナイター照明（弱め・中央を避けて外側へ）
      ctx.save(); ctx.globalAlpha = 0.09; ctx.fillStyle = '#fff6d0';
      [0.12, 0.88].forEach(function (fx) {
        ctx.beginPath();
        ctx.moveTo(x + w * fx, y + h * 0.06);
        ctx.lineTo(x + w * (fx - 0.14), hz);
        ctx.lineTo(x + w * (fx + 0.14), hz);
        ctx.closePath(); ctx.fill();
      });
      ctx.restore();
    },
    press_wall: function (ctx, x, y, w, h) {
      _grad(ctx, x, y, w, h, [[0, '#12233f'], [1, '#0a1730']]);
      ctx.save(); ctx.globalAlpha = 0.08; ctx.strokeStyle = '#cfe4ff'; ctx.lineWidth = 1;
      var step = Math.max(28, w / 14);
      for (var gx = x; gx < x + w; gx += step) { ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke(); }
      for (var gy = y; gy < y + h; gy += step) { ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke(); }
      ctx.restore();
    },
    paper_texture: function (ctx, x, y, w, h) {
      _grad(ctx, x, y, w, h, [[0, '#f6f1e4'], [1, '#e6ddc9']]);
      ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = '#6b5a3a';
      for (var i = 0; i < 900; i++) ctx.fillRect(x + Math.random() * w, y + Math.random() * h, 1, 1);
      ctx.restore();
    },
    shelf_wood: function (ctx, x, y, w, h) {
      _grad(ctx, x, y, w, h, [[0, '#7b5630'], [0.5, '#5a3d21'], [1, '#33220f']]);
      ctx.save(); ctx.globalAlpha = 0.18; ctx.strokeStyle = '#a3773f'; ctx.lineWidth = 1;
      for (var i = 0; i < 10; i++) {
        var yy = y + (h * (i + 0.5)) / 10;
        ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy + Math.cos(i * 1.7) * 2.5); ctx.stroke();
      }
      ctx.restore();
    }
  };

  function _stampPaint(color, label) {
    return function (ctx, x, y, w, h) {
      var cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) * 0.42;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(-0.18); ctx.translate(-cx, -cy);
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(3, r * 0.13);
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = '900 ' + Math.round(r * 0.62) + 'px "Bebas Neue", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, cy + r * 0.04);
      ctx.restore();
    };
  }
  _PAINT.stamp_win = _stampPaint('#2ecc71', 'WIN');
  _PAINT.stamp_draw = _stampPaint('#f1c40f', 'DRAW');
  _PAINT.stamp_loss = _stampPaint('#e74c3c', 'LOSS');

  /**
   * canvas へ描く。実画像があればそれを、無ければ手続きプレースホルダを描く。
   * @param {CanvasRenderingContext2D} ctx
   */
  LabArt.paint = function (ctx, key, x, y, w, h) {
    if (!ctx) return;
    x = x || 0; y = y || 0;
    try {
      var im = _img[key];
      if (im) { ctx.drawImage(im, x, y, w, h); return; }
      var fn = _PAINT[key];
      if (fn) { fn(ctx, x, y, w, h); return; }
      _grad(ctx, x, y, w, h, [[0, '#12305f'], [1, '#0a1730']]);
    } catch (e) {
      try { _grad(ctx, x, y, w, h, [[0, '#12305f'], [1, '#0a1730']]); } catch (e2) {}
    }
  };

  /**
   * canvas を「実際に描画されている箱のサイズ」に合わせて塗る。
   * ★ 挿入直後はレイアウトが未確定でサイズ 0 になることがあり、そのまま塗ると
   *   1x1 の空 canvas が残って背景が真っ黒になる（実際に踏んだ）。
   *   測れなかったら false を返し、fitLater() が次フレームで測り直す。
   * @returns {boolean} 塗れたか
   */
  LabArt.fit = function (cv, key) {
    if (!cv) return false;
    try {
      var r = cv.getBoundingClientRect();
      var w = Math.round(r.width) || cv.clientWidth || 0;
      var h = Math.round(r.height) || cv.clientHeight || 0;
      if (w < 2 || h < 2) return false;               // まだ測れない
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      var ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      LabArt.paint(ctx, key || cv.getAttribute('data-labart'), 0, 0, w, h);
      return true;
    } catch (e) { return false; }
  };

  /** fit を、レイアウトが決まるまで最大2フレーム待って再試行する版。 */
  LabArt.fitLater = function (cv, key) {
    if (LabArt.fit(cv, key)) return;
    requestAnimationFrame(function () {
      if (LabArt.fit(cv, key)) return;
      requestAnimationFrame(function () { LabArt.fit(cv, key); });
    });
  };

  /** 未配置スロットの一覧（CG発注の残タスク確認用・コンソールから叩く）。 */
  LabArt.missing = function () {
    return Object.keys(LabArt.SLOTS).filter(function (k) { return !_img[k]; });
  };

  window.LabArt = LabArt;
})();
