/* ===========================================================================
 * oshi.js — MTG1-#5「推し指名 ＋ 数値の言葉化」
 * ---------------------------------------------------------------------------
 * 第1回面白さMTG 採用案 #5。監督のリーグ体験に「**個人的な視点**」を1本通す。
 *
 *   ① 推し指名     : スカッドから1人だけ「推し」を指名する（いつでも変更可）。
 *                    監督カードに常設の1行として出て、指名モーダルから選び直せる。
 *   ② 推しの今日   : 試合後デッキ（今節の号）に1枚。**出場した試合だけ**出る。
 *                    確定データ（評価点/G/A/デュエル/成長）を archetype.js の
 *                    キャラクター性（バッジ＋スカウト一言）で言い換える。
 *   ③ 数値の言葉化 : 人気(popularity) と クラブ信頼(clubTrust) の**表示**を5段階の
 *                    テキスト主体に変える（内部値・式・判定は一切不変更）。
 *                    数字は消さず小さく併記＝「上がった/下がった」は今まで通り読める。
 *
 * ★ reframer 提案の核心: プレイヤーが読むのは「72」ではなく「英雄扱い」。
 *   ただし数字を消すと**動きの実感**（+1.2）が消えるので、言葉を主・数字を従にする。
 * ★ 5段階の境界は**実際の判定閾値**に合わせる（嘘をつかない言葉にする）:
 *     信頼 35 = CONTRACT_TUNING.TRUST_SACK_THRESHOLD（未達なら解任）
 *     人気 60 / 30 = 移籍オファーの門戸が変わる帯（_computeOffers）
 * ★ キルスイッチ: window.MTG1_OSHI === false で完全 no-op（既定は有効）。
 * ★ league.js への変更はフックのみ。ゲーム進行・試合結果・セーブ版数には触れない。
 *   保存は既存オブジェクトへの**任意フィールド追加だけ**（無くても動く＝後方互換）:
 *     manager.oshi = { clubId, key, since }   … 指名した推し（クラブが変われば自動で失効）
 * ★ 公開ビルドは非同梱（build.js の LAB_ONLY_JS）＝ league.js 側は typeof ガードで no-op。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ── 言葉化テーブル（境界＝実際の判定閾値。ここだけ触れば語感が変わる）──────── */
  var WORDS = {
    /* 人気＝世間の目。60/30 は移籍オファーの門戸が変わる実閾値。 */
    pop: [
      { min: 80, id: 'hero',    tone: 'great', ja: '英雄扱い',       en: 'A hero to the fans' },
      { min: 60, id: 'tail',    tone: 'good',  ja: '追い風',         en: 'The wind at your back' },
      { min: 30, id: 'watch',   tone: 'flat',  ja: '様子見',         en: 'Reserving judgement' },
      { min: 15, id: 'heat',    tone: 'warn',  ja: '風当たりが強い', en: 'Taking flak' },
      { min: -1, id: 'blame',   tone: 'bad',   ja: '戦犯扱い',       en: 'The scapegoat' }
    ],
    /* クラブ信頼＝会長の目。35 未満は（目標未達なら）解任ライン。 */
    trust: [
      { min: 80, id: 'full',    tone: 'great', ja: '全幅の信頼', en: 'Full backing' },
      { min: 60, id: 'happy',   tone: 'good',  ja: '満足',       en: 'Satisfied' },
      { min: 45, id: 'watch',   tone: 'flat',  ja: '注視',       en: 'Watching closely' },
      { min: 35, id: 'unhappy', tone: 'warn',  ja: '不満',       en: 'Unhappy' },
      { min: -1, id: 'final',   tone: 'bad',   ja: '最後通牒',   en: 'Final warning' }
    ],
    /* 試合評価点（BESTXI_TUNING: BASE 6.0 / MIN 4.0 / MAX 10.0）。 */
    rating: [
      { min: 8.0, id: 'masterclass', tone: 'great', ja: '圧巻の出来',   en: 'A masterclass' },
      { min: 7.0, id: 'strong',      tone: 'good',  ja: '上々の出来',   en: 'A strong shift' },
      { min: 6.2, id: 'solid',       tone: 'flat',  ja: '及第点',       en: 'Solid enough' },
      { min: 5.4, id: 'quiet',       tone: 'warn',  ja: '静かな90分',   en: 'A quiet 90' },
      { min: -1,  id: 'off',         tone: 'bad',   ja: '精彩を欠いた', en: 'Off the pace' }
    ]
  };

  /* ── i18n / 小物（host に依存しない＝単体でテストできる）───────────────── */
  function _isEn() { return !!(global && global.LANG === 'en'); }
  function _t(ja, en) { return _isEn() ? en : ja; }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : (d || 0); }
  /* 文字列 → 安定ハッシュ（決定論。スカウト一言の選択に使う＝同じ選手なら毎回同じ文）。 */
  function _hash(s) {
    var h = 2166136261, i;
    s = String(s || '');
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }

  /* ── host（league.js の内部アクセサ）───────────────────────────────────
   * league.js は _state を閉じ込めているので、必要な読み出し口だけを受け取る。
   * ★ 束ねは遅延（_bind）。oshi.js は league.js より後に読まれるので、league.js 側は
   *   window._leagueOshiHost に置くだけ＝読み込み順に依存しない。 */
  var H = null;
  var Oshi = {};

  Oshi.attach = function (host) { H = host || null; return Oshi; };
  Oshi.enabled = function () { return _on(); };

  function _on() { return !(global && global.MTG1_OSHI === false); }
  function _bind() {
    if (!H && global && global._leagueOshiHost) H = global._leagueOshiHost;
    return H;
  }
  function _st() { try { var h = _bind(); return (h && h.state) ? h.state() : null; } catch (e) { return null; } }
  function _live() { return !!(_on() && _bind() && _st()); }
  function _save() { try { if (H && H.save) H.save(); } catch (e) {} }

  /* =========================================================================
   * 1. 指名の保存（manager.oshi・任意フィールド・クラブが変われば失効）
   * ======================================================================= */
  /** 現在の推し（{key, name} / 未指名・別クラブ時代の指名は null）。 */
  Oshi.get = function () {
    if (!_live()) return null;
    var s = _st(), m = s && s.manager;
    var o = m && m.oshi;
    if (!o || !o.key) return null;
    if (o.clubId && s.myClub && o.clubId !== s.myClub) return null;   // 移籍したら推しは置いていく
    return { key: o.key, name: _display(o.key), since: o.since || null, clubId: o.clubId || s.myClub };
  };

  /** 指名する。key は _playerKey（内部ID・永久不変）。同じ選手を再指名しても冪等。 */
  Oshi.set = function (key) {
    if (!_live() || !key) return null;
    var s = _st();
    if (!s.manager) return null;
    s.manager.oshi = { clubId: s.myClub, key: String(key), since: _num(s.season, 1) };
    _save();
    return Oshi.get();
  };

  /** 指名を解除する（未指名状態＝従来動作へ戻る）。 */
  Oshi.clear = function () {
    if (!_live()) return false;
    var s = _st();
    if (s.manager && s.manager.oshi) { delete s.manager.oshi; _save(); }
    return true;
  };

  function _display(key) {
    try { if (H && H.displayName) return H.displayName(key) || key; } catch (e) {}
    return key;
  }

  /** 自クラブのスカッド（growth 反映済みの clone）。 */
  function _squad() {
    try { var td = (H && H.squad) ? H.squad() : null; return (td && td.players) ? td : null; } catch (e) { return null; }
  }
  function _keyOf(p) {
    try { return (H && H.key) ? H.key(p) : ((p && (p.long_name || p.name)) || ''); } catch (e) { return ''; }
  }

  /** 推しの選手オブジェクト（params 込み）を引く。見つからなければ null。 */
  function _oshiPlayer() {
    var o = Oshi.get(); if (!o) return null;
    var td = _squad(); if (!td) return null;
    for (var i = 0; i < td.players.length; i++) {
      if (_keyOf(td.players[i]) === o.key) return td.players[i];
    }
    return null;   // 移籍・引退などで居なくなった場合（カードは黙って出さない）
  }

  /* =========================================================================
   * 2. 数値の言葉化（表示層のみ・内部値には一切触らない）
   * ======================================================================= */
  /**
   * 5段階の言葉を返す。kind: 'pop' | 'trust' | 'rating'
   * @returns {null|{id, tone, text, ja, en, value}}  キルOFF/未知の kind なら null
   */
  Oshi.wordOf = function (kind, value) {
    if (!_on()) return null;
    var tbl = WORDS[kind]; if (!tbl) return null;
    var v = _num(value, 0);
    for (var i = 0; i < tbl.length; i++) {
      if (v >= tbl[i].min) {
        return {
          id: tbl[i].id, tone: tbl[i].tone, ja: tbl[i].ja, en: tbl[i].en,
          text: _t(tbl[i].ja, tbl[i].en), value: v
        };
      }
    }
    return null;
  };

  /** 言葉のピル（監督カードのメーター／試合後の世論ブロックから使う）。 */
  Oshi.wordHTML = function (kind, value) {
    var w = Oshi.wordOf(kind, value);
    if (!w) return '';
    return '<span class="lg-word tone-' + w.tone + '">' + _esc(w.text) + '</span>';
  };

  /* =========================================================================
   * 3. 監督カードの「推し」1行（未指名なら指名への導線）
   * ======================================================================= */
  /* ★ 1画面固定のハブに割り込むので**1行**に収める（監督ステータスの4本のバーから
   *   高さを奪わない）。情報は「誰か」だけ＝詳細は試合後カードで語る。 */
  Oshi.hubRow = function () {
    if (!_live()) return '';
    var p = _oshiPlayer();
    if (!p) {
      return '<button type="button" class="lg-oshi-row empty" onclick="oshiOpenPicker()">' +
        '<span class="ic">☆</span>' +
        '<span class="k">' + _t('推し', 'PLAYER') + '</span>' +
        '<b class="n">' + _t('推しを指名する', 'Pick a favourite') + '</b>' +
        '<span class="go">›</span></button>';
    }
    var a = _arch(p);
    return '<button type="button" class="lg-oshi-row" onclick="oshiOpenPicker()">' +
      '<canvas class="lg-oshi-face" width="44" height="44" data-portrait="' +
        _esc(p.long_name || p.name) + '"></canvas>' +
      '<span class="k">' + _t('推し', 'PLAYER') + '</span>' +
      '<b class="n">' + _esc(p.name) + '</b>' +
      (a ? '<span class="lg-oshi-badge ' + a.grp + '">' + _esc(a.label) + '</span>' : '') +
      '<span class="go">›</span></button>';
  };

  /* archetype.js（#4）— 非同梱/キルOFFなら黙って null（バッジもスカウト評も出さない）。 */
  function _arch(p) {
    if (typeof archetypeOf !== 'function' || !p || !p.params) return null;
    try {
      var a = archetypeOf(p.params, p.positions);
      if (!a) return null;
      return { id: a.id, label: _isEn() ? a.en : a.ja, grp: String(a.id).split('_')[0] };
    } catch (e) { return null; }
  }
  /** スカウトの一言（決定論で2本から1本を選ぶ＝同じ選手なら毎回同じ）。 */
  function _scout(archId, key) {
    if (typeof ARCHETYPE_FLAVOR === 'undefined' || !ARCHETYPE_FLAVOR) return '';
    var f = ARCHETYPE_FLAVOR[archId]; if (!f) return '';
    var loc = _isEn() ? f.en : f.ja;
    if (!loc || !loc.scout || !loc.scout.length) return '';
    return loc.scout[_hash(key + '|' + archId) % loc.scout.length];
  }

  /* =========================================================================
   * 4. 「推しの今日」カード（試合後デッキ・出場した試合だけ）
   * -------------------------------------------------------------------------
   * 入力は確定データのみ:
   *   lr.ratings[key]      … この試合の評価点 / ゴール / アシスト（_rateMatch 由来）
   *   lr.stats.duels1[]    … 自クラブのデュエル（表示名 → 勝/敗）
   *   lr.manager.trained[] … 今週の個別練習で伸びた選手（成長 delta）
   *   squads[club][key]    … シーズン累計（出場/得点/アシスト）
   * ======================================================================= */
  Oshi.todayPanel = function (lr) {
    if (!_live() || !lr || !lr.mine) return null;
    var o = Oshi.get(); if (!o) return null;
    if (!lr.ratings || !lr.ratings[o.key]) return null;   // 出場していない試合は**丸ごと出さない**
    return {
      id: 'oshi', sfx: 'ping',
      // html を関数にして「表示する瞬間」に組む＝会見や成長の結果が数字に乗る
      html: function () { return Oshi.todayHTML(lr); },
      onShow: function (el) { try { if (H && H.paint) H.paint(el); } catch (e) {} }
    };
  };

  Oshi.todayHTML = function (lr) {
    var o = Oshi.get(); if (!o) return '';
    var rt = (lr && lr.ratings && lr.ratings[o.key]) || null; if (!rt) return '';
    var p = _oshiPlayer();
    var a = p ? _arch(p) : null;
    var name = rt.name || o.name;
    var w = Oshi.wordOf('rating', rt.rating) || { tone: 'flat', text: '', id: 'solid' };

    /* ① 見出し＝「今日の推しはどうだったか」を1行で言い切る（数字はその下） */
    var line = _todayLine(lr, rt, name, w);

    /* ② 確定データのチップ（評価点／G／A／デュエル） */
    var chips = [];
    chips.push(_kv(_t('評価点', 'Rating'), _rating(rt.rating) +
      (w.text ? '<em class="wd">' + _esc(w.text) + '</em>' : ''), 'rate ' + w.tone));
    if (rt.goals > 0) chips.push(_kv(_t('ゴール', 'Goals'), String(rt.goals), 'g'));
    if (rt.assists > 0) chips.push(_kv(_t('アシスト', 'Assists'), String(rt.assists), 'a'));
    var du = _duel(lr, name);
    if (du) chips.push(_kv(_t('デュエル', 'Duels'), du.w + '<em>-</em>' + du.l, 'd'));

    /* ③ シーズン累計（この1試合を「積み上げ」として見せる） */
    var e = _entry(o.key);
    var season = e
      ? '<div class="lg-oshi-season">' +
          '<span class="k">' + _t('今季', 'Season') + '</span>' +
          '<span class="v"><b>' + _num(e.apps, 0) + '</b>' + _t('試合', ' apps') + '</span>' +
          '<span class="v"><b>' + _num(e.goals, 0) + '</b>' + _t('ゴール', ' G') + '</span>' +
          '<span class="v"><b>' + _num(e.assists, 0) + '</b>' + _t('アシスト', ' A') + '</span>' +
        '</div>'
      : '';

    /* ④ 成長（今週の個別練習でこの選手が伸びていれば） */
    var grow = _growth(lr, name);
    var growHTML = grow
      ? '<div class="lg-oshi-grow">🎯 ' +
          _t(_esc(grow.paramName || '') + ' が伸びた', _esc(grow.paramName || '') + ' improved') +
          ' <b>+' + _esc(grow.gain) + '</b></div>'
      : '';

    /* ⑤ スカウトの一言（archetype.js のフレーバー＝キャラクター性） */
    var scout = a ? _scout(a.id, o.key) : '';
    var scoutHTML = scout
      ? '<div class="lg-oshi-scout"><span class="q">“</span>' + _esc(scout) + '</div>' : '';

    return '<div class="lg-card lg-oshi-card tone-' + w.tone + '">' +
      '<div class="lgp-kicker">' + _t('推しの今日', 'YOUR PLAYER TODAY') + '</div>' +
      '<div class="lg-oshi-head">' +
        '<canvas class="lg-oshi-face lg" width="56" height="56" data-portrait="' +
          _esc((p && (p.long_name || p.name)) || name) + '"></canvas>' +
        '<div class="bd">' +
          '<b class="n">' + _esc(name) + '</b>' +
          (a ? '<span class="lg-oshi-badge ' + a.grp + '">' + _esc(a.label) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<p class="lg-oshi-line">' + line + '</p>' +
      '<div class="lg-oshi-chips">' + chips.join('') + '</div>' +
      season + growHTML + scoutHTML +
    '</div>';
  };

  /* 「今日の推し」を1行で言い切る。★ 数字を読ませる前に、まず言葉で結論を出す。 */
  function _todayLine(lr, rt, name, w) {
    var res = lr.mine.res;
    var nb = '<b>' + _esc(name) + '</b>';
    if (rt.goals >= 2) {
      return _t(nb + 'が' + rt.goals + '得点。今日の主役は、あなたの推しだった。',
        nb + ' scored ' + rt.goals + '. Today belonged to your player.');
    }
    if (rt.goals === 1 && res === 'W') {
      return _t(nb + 'のゴールが、勝点3の中にある。',
        nb + ' got on the scoresheet — and the three points followed.');
    }
    if (rt.goals === 1) {
      return _t('勝てなかった。それでも' + nb + 'はネットを揺らした。',
        'No win today, but ' + nb + ' still found the net.');
    }
    if (rt.assists >= 1) {
      return _t(nb + 'のパスから、得点が生まれた。', 'The goal came from ' + nb + '’s pass.');
    }
    if (w.id === 'masterclass') {
      return _t('得点はない。だが' + nb + 'は今日、別格だった。',
        'No goal — but ' + nb + ' was on another level today.');
    }
    if (w.id === 'off' || w.id === 'quiet') {
      return (res === 'W')
        ? _t('チームは勝った。' + nb + 'には物足りない90分だった。',
          'The team won. For ' + nb + ', it was a frustrating 90 minutes.')
        : _t(nb + 'にとっては、忘れたい90分だ。', 'A night ' + nb + ' will want to forget.');
    }
    return (res === 'W')
      ? _t(nb + 'は、勝った試合の中にきちんといた。', nb + ' played his part in the win.')
      : _t(nb + 'は、今日も90分を戦い抜いた。', nb + ' saw out the full 90 again.');
  }

  function _kv(k, v, cls) {
    return '<span class="lg-oshi-kv ' + (cls || '') + '"><i>' + _esc(k) + '</i><b>' + v + '</b></span>';
  }
  function _rating(v) { return (Math.round(_num(v, 6) * 10) / 10).toFixed(1); }

  /* デュエル（lr.stats.duels1 は自クラブ側・表示名で記録されている）。 */
  function _duel(lr, name) {
    var arr = lr && lr.stats && lr.stats.duels1;
    if (!arr || !arr.length) return null;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].name === name) return { w: _num(arr[i].w, 0), l: _num(arr[i].l, 0) };
    }
    return null;
  }
  /* 今週の個別練習でこの選手が伸びたか（lr.manager.trained は表示名で持つ）。 */
  function _growth(lr, name) {
    var tr = lr && lr.manager && lr.manager.trained;
    if (!tr || !tr.length) return null;
    for (var i = 0; i < tr.length; i++) {
      if (tr[i] && tr[i].name === name) return tr[i];
    }
    return null;
  }
  /* シーズン累計（squads[club][key]）。無ければ null＝累計行を出さない。 */
  function _entry(key) {
    try {
      var s = _st();
      if (!s || !H || !H.peek) return null;
      return H.peek(s.myClub, key);
    } catch (e) { return null; }
  }

  /* =========================================================================
   * 5. 指名モーダル（オーバーレイ・league.js の描画経路に割り込まない）
   * -------------------------------------------------------------------------
   * ★ ハブの DOM を差し替えず body に重ねる＝他の画面/演出と競合しない。
   * ======================================================================= */
  var OVL_ID = 'lg-oshi-ovl';

  Oshi.openPicker = function () {
    if (!_live()) return false;
    var doc = global.document; if (!doc || !doc.body) return false;
    Oshi.closePicker();
    var td = _squad(); if (!td) return false;
    var cur = Oshi.get();

    var cards = td.players.map(function (p) {
      var key = _keyOf(p);
      var a = _arch(p);
      var pos = (p.positions && p.positions[0]) || '';
      return '<button type="button" class="lg-oshi-pick' + (cur && cur.key === key ? ' on' : '') + '" ' +
        'data-key="' + _esc(key) + '">' +
        '<canvas class="lg-oshi-face" width="44" height="44" data-portrait="' +
          _esc(p.long_name || p.name) + '"></canvas>' +
        '<span class="bd">' +
          '<span class="top">' +
            '<span class="pos ' + _line(pos) + '">' + _esc(String(pos).replace(/[左右]/g, '')) + '</span>' +
            '<b class="n">' + _esc(p.name) + '</b>' +
          '</span>' +
          (a ? '<span class="lg-oshi-badge ' + a.grp + '">' + _esc(a.label) + '</span>' : '') +
        '</span>' +
        '<span class="ov">' + _overall(p) + '</span>' +
        '<span class="star">★</span>' +
      '</button>';
    }).join('');

    var el = doc.createElement('div');
    el.id = OVL_ID;
    el.className = 'lg-oshi-ovl';
    el.innerHTML =
      '<div class="lg-oshi-panel" role="dialog" aria-modal="true">' +
        '<div class="lg-oshi-h">' +
          '<div class="ttl"><span class="ic">★</span>' + _t('推しを指名する', 'Pick your player') + '</div>' +
          '<div class="sub">' + _t('1人だけ。試合のたびに、その選手の記事が届く。',
            'Just one. You’ll get his story after every match.') + '</div>' +
          '<button type="button" class="lg-oshi-x" aria-label="' + _t('閉じる', 'Close') + '">✕</button>' +
        '</div>' +
        '<div class="lg-oshi-list">' + cards + '</div>' +
        '<div class="lg-oshi-f">' +
          (cur ? '<button type="button" class="lg-oshi-clear">' + _t('指名を解除', 'Clear pick') + '</button>'
               : '<span class="lg-oshi-hint">' + _t('あとで変えられる', 'You can change this later') + '</span>') +
          '<button type="button" class="lg-oshi-done">' + _t('閉じる', 'Close') + '</button>' +
        '</div>' +
      '</div>';
    doc.body.appendChild(el);

    // 顔を塗る（portrait.js。host 経由＝oshi.js は描画実装を持たない）
    try { if (H && H.paint) H.paint(el); } catch (e) {}

    el.addEventListener('click', function (ev) {
      var btn = _closest(ev.target, 'lg-oshi-pick');
      if (btn) { Oshi.set(btn.getAttribute('data-key')); Oshi.closePicker(); _rerender(); return; }
      if (_closest(ev.target, 'lg-oshi-clear')) { Oshi.clear(); Oshi.closePicker(); _rerender(); return; }
      if (_closest(ev.target, 'lg-oshi-x') || _closest(ev.target, 'lg-oshi-done') || ev.target === el) {
        Oshi.closePicker();
      }
    });
    return true;
  };

  Oshi.closePicker = function () {
    var doc = global.document; if (!doc) return false;
    var el = doc.getElementById(OVL_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    return !!el;
  };

  function _closest(node, cls) {
    while (node && node.nodeType === 1) {
      if (node.classList && node.classList.contains(cls)) return node;
      node = node.parentNode;
    }
    return null;
  }
  function _rerender() { try { if (H && H.home) H.home(); } catch (e) {} }

  /* 総合値（params 平均）＝布陣カードの数値表示と同じ考え方の簡易版。 */
  function _overall(p) {
    if (!p || !p.params || !p.params.length) return 0;
    var t = 0;
    for (var i = 0; i < p.params.length; i++) t += p.params[i];
    return Math.round(t / p.params.length);
  }
  function _line(pos) {
    var b = String(pos || '').replace(/^[左右]/, '');
    if (b === 'GK') return 'gk';
    if (b === 'CB' || b === 'SB' || b === 'SW') return 'df';
    if (b === 'CF' || b === 'WG') return 'fw';
    return 'mf';
  }

  /* =========================================================================
   * 6. 公開（league.js が typeof で見る薄い関数名 ＋ onclick 用グローバル）
   * ======================================================================= */
  global.Oshi = Oshi;
  global.oshiTodayPanel = function (lr) { return Oshi.todayPanel(lr); };
  global.oshiHubRow = function () { return Oshi.hubRow(); };
  global.oshiWordHTML = function (kind, v) { return Oshi.wordHTML(kind, v); };
  global.oshiWordOf = function (kind, v) { return Oshi.wordOf(kind, v); };
  global.oshiOpenPicker = function () { return Oshi.openPicker(); };
  global.oshiClosePicker = function () { return Oshi.closePicker(); };

})(typeof window !== 'undefined' ? window : this);
