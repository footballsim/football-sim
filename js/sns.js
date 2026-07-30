/* =========================================================================
 * js/sns.js — RW-01 SNS風フィード（lab限定）
 * -------------------------------------------------------------------------
 * 「寝ている間に世界が動いている」を作る層（VISION 7フックの1つ）。
 * 試合結果・順位・個人記録・監督の立場に**世間が反応する**短文を生成する。
 *
 * 設計の約束:
 *   ① **完全決定論**（rng 不使用）。同じ状況なら誰がいつ開いても同じフィード＝
 *      seed 再現（T-06）を壊さない。バリエーションは「状況＋節」のハッシュで選ぶ。
 *   ② **純関数**。league.js が組み立てた ctx を受け取るだけで、ゲーム状態を読まない。
 *      → headless で丸ごとテストできる（tools/sns-test.js）。
 *   ③ **毒舌度は1つのツマミ**（SNARK 0=穏当 / 1=標準 / 2=辛口）。各テンプレは自分の
 *      tone を持ち、SNARK 以下のものだけが候補になる。⚠️ 既定値の確定は OP-02
 *      （表現ガイドライン・8月上旬にユーザーと決定）。それまでは 1（標準）で運用。
 *   ④ 日英とも**テンプレ**。LLM は使わない（オフライン・無料・即時）。
 *
 * 使い方:
 *   var feed = SNS.build(ctx);           // → [{persona, name, handle, icon, text, likes}]
 *   SNS.setSnark(2);                     // 毒舌度を変える（OP-02 確定後は既定値を差し替え）
 * ========================================================================= */
(function (global) {
  'use strict';

  var SNS_TUNING = {
    SNARK: 1,          // 0=穏当 / 1=標準 / 2=辛口（★OP-02 で確定）
    MAX_POSTS: 6,      // 1節あたりの投稿数の上限（読み切れる量に抑える）
    TEASER: 2          // ハブに出す件数
  };

  /* ── 決定論ハッシュ（league.js の _hash32 と同型・独立に持つ＝依存を作らない） ── */
  function _hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  function _pick(arr, seed) { return arr[(_hash(seed) >>> 0) % arr.length]; }

  /* 英語の序数（1st/2nd/3rd/4th…）。「2th」のような崩れを防ぐ。日本語は「{pos}位」を使う。 */
  function _ord(n) {
    n = parseInt(n, 10);
    if (isNaN(n)) return '';
    var t = n % 100;
    if (t >= 11 && t <= 13) return n + 'th';
    return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  }

  /* ── 発信者（ペルソナ）─────────────────────────────────────────────
   * 同じ出来事でも「誰が言うか」で温度が変わる。tone は各テンプレ側が持つ。 */
  var PERSONAS = {
    reporter: { icon: '🗞', ja: 'サッカーダイジェスト', en: 'Football Digest', handle: '@fb_digest' },
    pundit:   { icon: '📺', ja: '解説・岩城',           en: 'Pundit — Iwaki',   handle: '@pundit_iwaki' },
    fan:      { icon: '🔵', ja: 'ゴール裏の住人',       en: 'Terrace Regular',  handle: '@terrace_12' },
    rivalfan: { icon: '🔴', ja: '敵地サポ',             en: 'Away End',         handle: '@away_end' },
    stats:    { icon: '🤖', ja: 'スタッツbot',          en: 'StatsBot',         handle: '@stats_bot' },
    legend:   { icon: '🎙', ja: 'OBの独り言',           en: 'Old Boy',          handle: '@old_boy_9' }
  };

  /* ── テンプレ ───────────────────────────────────────────────────────
   * 置換子: {club} {opp} {player} {n} {gf} {ga} {pos} {leader} {goal}
   * tone: 0=穏当 1=標準 2=辛口。SNARK 以下だけが候補。
   * w: 同じ状況で複数該当した時の優先度（大きいほど上に出る）。 */
  var T = {
    /* ① 大勝 */
    winBig: [
      { p: 'reporter', tone: 0, ja: '【速報】{club}が{opp}を{gf}-{ga}で撃破。付け入る隙のない完勝だった。', en: 'FT: {club} {gf}-{ga} {opp}. A complete performance.' },
      { p: 'fan', tone: 1, ja: '{gf}点て。今日は声が枯れた。もう一回見る。', en: '{gf} goals. Lost my voice. Watching it again right now.' },
      { p: 'pundit', tone: 0, ja: '{club}、狙いが最後まで揺れなかった。強いチームの勝ち方です。', en: '{club} never wavered from the plan. That is how good teams win.' },
      { p: 'legend', tone: 2, ja: '{opp}はよく最後まで11人でいたな。それだけは褒める。', en: 'Credit to {opp} for keeping eleven on the pitch. That is all the credit I have.' }
    ],
    winNarrow: [
      { p: 'reporter', tone: 0, ja: '{club}が{opp}を{gf}-{ga}。1点差の重い勝ち点3。', en: '{club} edge {opp} {gf}-{ga}. Three hard-earned points.' },
      { p: 'fan', tone: 1, ja: '心臓に悪い。でも勝ちは勝ち。寿命と引き換えの3ポイント。', en: 'That took years off me. Three points is three points.' },
      { p: 'pundit', tone: 1, ja: '内容は五分。ただ勝ち切れるチームは、こういう試合を落とさない。', en: 'Even game. But the sides that win things do not drop these.' }
    ],
    drawGame: [
      { p: 'reporter', tone: 0, ja: '{club}と{opp}は{gf}-{ga}のドロー。勝ち点を分け合った。', en: '{club} and {opp} share the spoils, {gf}-{ga}.' },
      { p: 'fan', tone: 1, ja: '勝ち点1。悪くない…と言い聞かせてる。', en: 'A point. Fine. I am telling myself it is fine.' },
      { p: 'pundit', tone: 1, ja: '決め切れなかった。この1点が終盤に効いてこなければいいが。', en: 'They could not finish it. That dropped point may bite in the run-in.' }
    ],
    lossNarrow: [
      { p: 'reporter', tone: 0, ja: '{club}は{opp}に{gf}-{ga}で惜敗。あと一歩が遠かった。', en: '{club} fall {gf}-{ga} to {opp}. So near, so far.' },
      { p: 'fan', tone: 1, ja: '内容は悪くなかった。悪くなかったんだって。', en: 'The performance was fine. It was FINE.' },
      { p: 'legend', tone: 2, ja: '「惜しい」を積み上げても順位表は1ミリも動かん。', en: 'You can stack up "unlucky" all season. The table will not care.' }
    ],
    lossBig: [
      { p: 'reporter', tone: 0, ja: '{club}は{opp}に{gf}-{ga}で完敗。修正が急務だ。', en: '{club} well beaten {gf}-{ga} by {opp}. Questions to answer.' },
      { p: 'fan', tone: 1, ja: '最後まで見た自分を褒めたい。', en: 'I stayed until the final whistle. That is my achievement today.' },
      { p: 'pundit', tone: 1, ja: '{ga}失点は事故ではない。構造の問題に見えました。', en: 'Conceding {ga} is not bad luck. That looked structural.' },
      { p: 'legend', tone: 2, ja: 'あれを見に行った客に金を返せとまでは言わん。言わんが。', en: 'I would not demand refunds for the away fans. I would not. But.' }
    ],
    /* ② 宿敵 */
    rivalWin: [
      { p: 'fan', tone: 1, ja: '宿敵に勝った。この1試合のために1年生きてる。', en: 'We beat THEM. This is what the whole year is for.' },
      { p: 'reporter', tone: 0, ja: 'ダービーは{club}に軍配。街の空気が変わる一戦となった。', en: 'The derby goes to {club} — a result that changes the mood of the city.' },
      { p: 'rivalfan', tone: 2, ja: '…今日は何も言うことがない。おめでとう。次は無い。', en: 'Nothing to say today. Congratulations. It will not happen again.' }
    ],
    rivalLoss: [
      { p: 'rivalfan', tone: 2, ja: '{club}さん、今年もごちそうさまでした。', en: 'Thanks for the points again, {club}. Same time next year?' },
      { p: 'fan', tone: 1, ja: 'ダービーだけは落としちゃいけなかった。ここだけは。', en: 'Any game but that one. Any game.' },
      { p: 'pundit', tone: 1, ja: 'ダービーの敗戦は勝ち点3以上の重さがある。立て直せるか。', en: 'A derby defeat costs more than three points. The response matters now.' }
    ],
    /* ③ 個人 */
    mom: [
      { p: 'stats', tone: 0, ja: '本日のMOM: {player}。この試合を決めたのはこの男だった。', en: 'MOTM: {player}. He decided this one.' },
      { p: 'reporter', tone: 0, ja: 'この日の主役は{player}。試合の流れを一人で引き寄せた。', en: 'The day belonged to {player}, who dragged the game his way.' },
      { p: 'legend', tone: 1, ja: '{player}か。ああいう選手が一人いるだけでチームは変わる。', en: '{player}. One player like that changes a whole side.' },
      { p: 'fan', tone: 1, ja: '{player}、うちの選手でいてくれてありがとう。', en: '{player}. Just glad he is ours.' },
      { p: 'pundit', tone: 0, ja: '{player}の落ち着きは年齢のそれではない。', en: 'The composure {player} showed does not match his age.' }
    ],
    hattrick: [
      { p: 'stats', tone: 0, ja: '{player} ハットトリック達成。1試合{n}ゴール。', en: '{player} hat-trick. {n} goals in one match.' },
      { p: 'fan', tone: 1, ja: '{player}にマッチボール渡してこい！', en: 'Someone get {player} that match ball!' },
      { p: 'reporter', tone: 0, ja: '{player}が{n}得点。記録にも記憶にも残る一夜となった。', en: '{player} scores {n}. A night for the record books.' }
    ],
    scorer: [
      { p: 'stats', tone: 0, ja: '得点: {player}。{club}の{n}点目。', en: 'Goal: {player} — {n} for {club}.' }
    ],
    cleanSheet: [
      { p: 'stats', tone: 0, ja: '{club}、今節も無失点。守備が仕事をしている。', en: '{club} keep another clean sheet. The back line is doing its job.' },
      { p: 'fan', tone: 1, ja: '無失点。後ろが締まってると安心して見ていられる。', en: 'Clean sheet. You can actually enjoy a game when the back line holds.' },
      { p: 'pundit', tone: 0, ja: '無失点は偶然では続かない。準備の成果でしょう。', en: 'Clean sheets do not repeat by accident. That is preparation.' }
    ],
    /* ④ 連勝・連敗 */
    winStreak: [
      { p: 'reporter', tone: 0, ja: '{club}が{n}連勝。勢いは本物か。', en: '{club} make it {n} wins in a row. Is this for real?' },
      { p: 'fan', tone: 1, ja: '{n}連勝。今のうちに言っておく、優勝するぞ。', en: '{n} straight. Saying it now: we are winning this league.' },
      { p: 'legend', tone: 2, ja: '{n}連勝で浮かれる時期は過ぎた。数えるのは最後だけでいい。', en: '{n} in a row and everyone is dizzy. Count at the end, not now.' }
    ],
    lossStreak: [
      { p: 'reporter', tone: 0, ja: '{club}は{n}連敗。流れを止められない。', en: '{club} have now lost {n} in a row. The bleeding will not stop.' },
      { p: 'fan', tone: 1, ja: '{n}連敗。まだ応援するけど、まだ、だからな。', en: '{n} defeats. I am still here. Still. For now.' },
      { p: 'legend', tone: 2, ja: '{n}連敗は運ではない。誰かが決断しないとこのまま沈む。', en: '{n} defeats is not luck. Somebody has to make a decision.' }
    ],
    /* ⑤ 順位 */
    climbTop: [
      { p: 'reporter', tone: 0, ja: '{club}が首位に浮上。景色が変わった。', en: '{club} go top. The view is different from up here.' },
      { p: 'fan', tone: 1, ja: '順位表の一番上にうちがある。スクショした。', en: 'We are top of the table. Screenshotted. Framed.' }
    ],
    climb: [
      { p: 'stats', tone: 0, ja: '{club} {pos}位に浮上（前節から上昇）。', en: '{club} climb to {posOrd}. Up from last week.' },
      { p: 'fan', tone: 1, ja: '{pos}位。上を見ていい位置に来た。', en: '{posOrd}. Close enough to look up now.' },
      { p: 'pundit', tone: 0, ja: '{club}が{pos}位。ここからは落とせる試合が減っていく。', en: '{club} up to {posOrd}. From here the margin for error shrinks.' }
    ],
    drop: [
      { p: 'stats', tone: 0, ja: '{club} {pos}位に後退。', en: '{club} slip to {posOrd}.' },
      { p: 'fan', tone: 1, ja: '{pos}位。まだ終わってない。まだ。', en: '{posOrd}. It is not over. It is not.' },
      { p: 'pundit', tone: 1, ja: '{pos}位。順位表は正直だ。今の実力がここに出ている。', en: '{posOrd}. The table is honest. That is where they are right now.' }
    ],
    /* ⑥ 監督の立場 */
    trustLow: [
      { p: 'reporter', tone: 1, ja: '{club}の監督人事に不穏な空気。クラブは静観の構えだが…。', en: 'Pressure building on the {club} manager. The board is silent — for now.' },
      { p: 'legend', tone: 2, ja: 'あの監督、次を落としたら春を待たずに終わりだろう。', en: 'One more like that and he will not see the spring.' }
    ],
    trustHigh: [
      { p: 'reporter', tone: 0, ja: '{club}の監督に称賛の声。クラブ内の信頼は厚い。', en: 'Praise for the {club} manager — the board is firmly behind him.' },
      { p: 'fan', tone: 1, ja: 'うちの監督、契約更新してくれ。今すぐ。', en: 'Give the gaffer a new contract. Today.' }
    ],
    popular: [
      { p: 'stats', tone: 0, ja: '{club}監督の注目度が上昇中。取材依頼が増えている。', en: 'Interest in the {club} manager is rising. The requests are piling up.' },
      { p: 'reporter', tone: 0, ja: '{club}の指揮官に取材が殺到。名前が売れ始めている。', en: 'Media queues forming for the {club} boss. The name is getting out.' },
      { p: 'fan', tone: 1, ja: 'うちの監督が特集されてる。有名になったな…連れて行かれないでくれ。', en: 'Our gaffer is on the front page. Please do not let anyone take him.' }
    ],
    /* ⑦ 不在（怪我・出場停止） */
    absence: [
      { p: 'reporter', tone: 0, ja: '{club}は{player}を欠く見込み。痛い離脱となる。', en: '{club} expected to be without {player}. A costly absence.' },
      { p: 'fan', tone: 1, ja: '{player}がいない。誰があの穴を埋めるんだ。', en: 'No {player}. Who is filling that hole?' }
    ],
    /* ⑧ 他会場・番狂わせ */
    upset: [
      { p: 'reporter', tone: 0, ja: '波乱。{leader}が敗れ、上位が混戦模様に。', en: 'Upset: {leader} beaten. The top of the table just opened up.' },
      { p: 'fan', tone: 1, ja: '{leader}が負けた。今夜は他会場の話で酒が飲める。', en: '{leader} lost. That is tonight sorted.' }
    ],
    /* ⑨ シーズンの節目 */
    seasonOpen: [
      { p: 'reporter', tone: 0, ja: '新シーズン開幕。{club}に課された目標は「{goal}」。', en: 'A new season begins. {club} have been set one target: {goal}.' },
      { p: 'pundit', tone: 1, ja: '{club}は開幕前の評価が難しい。最初の5試合で正体が見える。', en: '{club} are hard to call. The first five games will tell us who they are.' }
    ],
    seasonRunIn: [
      { p: 'reporter', tone: 0, ja: '残りわずか。{club}は{pos}位で終盤戦へ。', en: 'Into the run-in. {club} sit {posOrd} with little left to play for — or everything.' },
      { p: 'pundit', tone: 1, ja: 'ここからは勝ち点の重さが変わる。1試合が2試合ぶんの意味を持つ。', en: 'Points weigh more from here. Every game counts double now.' }
    ]
  };

  /* ── 組み立て ─────────────────────────────────────────────────────── */
  function _fill(tpl, ctx, vars) {
    var isEn = (ctx.lang === 'en');
    var s = isEn ? tpl.en : tpl.ja;
    var v = vars || {};
    return s.replace(/\{(\w+)\}/g, function (m, k) {
      return (v[k] !== undefined && v[k] !== null) ? String(v[k]) : '';
    });
  }

  /* 状況ごとの候補から1本選ぶ。seed に節や状況を混ぜるので、同じ状況なら常に同じ文。
   * used = すでにこのフィードで使った発信者。**同じアカウントの連投を避ける**（1人が
   * 3投稿を占めると「世間の反応」に見えない）。回避できない時だけ重複を許す。 */
  function _post(kind, ctx, vars, seedExtra, used) {
    var pool = T[kind];
    if (!pool || !pool.length) return null;
    var snark = (typeof ctx.snark === 'number') ? ctx.snark : SNS_TUNING.SNARK;
    var ok = pool.filter(function (t) { return t.tone <= snark; });
    if (!ok.length) ok = pool.filter(function (t) { return t.tone === 0; });
    if (!ok.length) return null;
    if (used) {
      var fresh = ok.filter(function (t) { return !used[t.p]; });
      if (fresh.length) ok = fresh;
    }
    var seed = kind + '|' + (ctx.club && ctx.club.id) + '|' + ctx.season + '|' + ctx.round + '|' + (seedExtra || '');
    var tpl = _pick(ok, seed);
    var per = PERSONAS[tpl.p] || PERSONAS.reporter;
    return {
      kind: kind,
      persona: tpl.p,
      icon: per.icon,
      name: (ctx.lang === 'en') ? per.en : per.ja,
      handle: per.handle,
      tone: tpl.tone,
      text: _fill(tpl, ctx, vars),
      // 「いいね」も決定論。数字そのものに意味はないが、SNS の見た目に効く。
      likes: 20 + (_hash(seed + '|likes') % 4800)
    };
  }

  /* ctx から今節ぶんのフィードを組む。戻り = 投稿の配列（重要な順）。 */
  function build(ctx) {
    if (!ctx) return [];
    var out = [], r = ctx.result, club = (ctx.club && ctx.club.name) || '';
    var used = {};   // 発信者の重複回避（同じアカウントで埋めない）
    function push(kind, vars, seedExtra) {
      var p = _post(kind, ctx, vars, seedExtra, used);
      if (p) { out.push(p); used[p.persona] = true; }
    }

    // ① 開幕前（まだ試合がない）＝目標の提示だけ
    if (!r) {
      push('seasonOpen', { club: club, goal: ctx.goalText || '' });
      if (ctx.absences && ctx.absences.length) {
        push('absence', { club: club, player: ctx.absences[0].name }, 'a0');
      }
      return out.slice(0, SNS_TUNING.MAX_POSTS);
    }

    var vars = {
      club: club, opp: (ctx.opp && ctx.opp.name) || '',
      gf: r.gf, ga: r.ga, pos: r.posAfter, posOrd: _ord(r.posAfter), goal: ctx.goalText || '',
      leader: (ctx.leader && ctx.leader.name) || ''
    };
    var diff = r.gf - r.ga;

    // ② 試合結果（必ず1本目）
    if (r.res === 'W') push(diff >= 3 ? 'winBig' : 'winNarrow', vars);
    else if (r.res === 'D') push('drawGame', vars);
    else push(diff <= -3 ? 'lossBig' : 'lossNarrow', vars);

    // ③ 宿敵
    if (r.rival && r.res === 'W') push('rivalWin', vars);
    else if (r.rival && r.res === 'L') push('rivalLoss', vars);

    // ④ 個人（ハットトリック > MOM の順に強い）
    var hat = (ctx.scorers || []).filter(function (s) { return (s.goals || 1) >= 3; })[0];
    if (hat) push('hattrick', { player: hat.name, n: hat.goals }, hat.key || hat.name);
    else if (ctx.mom && ctx.mom.name) push('mom', { player: ctx.mom.name }, ctx.mom.key || ctx.mom.name);
    if (r.res !== 'L' && r.ga === 0) push('cleanSheet', vars);

    // ⑤ 連勝・連敗（3以上で話題になる）
    if (ctx.streak && ctx.streak.n >= 3) {
      push(ctx.streak.kind === 'W' ? 'winStreak' : 'lossStreak', { club: club, n: ctx.streak.n }, 's' + ctx.streak.n);
    }

    // ⑥ 順位の動き
    if (r.posAfter === 1 && r.posBefore !== 1) push('climbTop', vars);
    else if (r.posAfter < r.posBefore) push('climb', vars);
    else if (r.posAfter > r.posBefore) push('drop', vars);

    // ⑦ 監督の立場
    if (ctx.manager) {
      if (ctx.manager.trust <= 35) push('trustLow', vars);
      else if (ctx.manager.trust >= 75) push('trustHigh', vars);
      if (ctx.manager.popularityUp) push('popular', vars);
    }

    // ⑧ 番狂わせ（首位が負けた）
    if (ctx.upset && ctx.leader) push('upset', vars, 'u');

    // ⑨ 離脱者
    if (ctx.absences && ctx.absences.length) {
      push('absence', { club: club, player: ctx.absences[0].name },
        'a' + (ctx.absences[0].key || ctx.absences[0].name));
    }

    // ⑩ 終盤戦
    if (ctx.round && ctx.totalRounds && ctx.round >= ctx.totalRounds - 3) push('seasonRunIn', vars);

    return out.slice(0, SNS_TUNING.MAX_POSTS);
  }

  global.SNS = {
    build: build,
    PERSONAS: PERSONAS,
    TEMPLATES: T,
    TUNING: SNS_TUNING,
    setSnark: function (v) { SNS_TUNING.SNARK = Math.max(0, Math.min(2, v | 0)); return SNS_TUNING.SNARK; },
    // テスト用: 全テンプレの置換子が ja/en で揃っているかを機械的に見る
    _templateKinds: function () { return Object.keys(T); }
  };

})(typeof window !== 'undefined' ? window : this);
