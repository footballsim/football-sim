/* ============================================================================
 * ctmatch.js — テクモ版キャプテン翼(FC/1988)の「試合パート」構造の再現試作
 *   2026-07-30 / ラボ限定・スタンドアロン（_ct_lab.html からのみ読む）
 *   ★ football-sim 本体からは一切参照しない。build.js にも入れない＝ゲームへの影響ゼロ。
 *
 * ■ なぜ作るか
 *   キャプテン翼FCは「**俯瞰の状況説明**」と「**カットインの決着**」を交代させることで、
 *   ドット絵の解像度でサッカーの迫力を出していた。これは football-sim で今日ずっと議論していた
 *   「層S(引き画)と層M(マンガ)の主従」と同じ問題で、向こうは38年前に解いている。
 *   ★ 学びたいのは絵ではなく**交代の設計**（何秒俯瞰を見せ、どの瞬間に寄るか）。
 *
 * ■ 再現の方針（IPの線引き）
 *   ○ システムの型（俯瞰↔カットイン／ガッツ＝行動値／シュートの多段ブロック／実況テロップ）
 *   ✕ ドット絵・音楽・キャラクター名は再現しない。絵は**全て手続き描画**（外部素材ゼロ）、
 *     選手名は架空。＝保護されやすい「具体的な表現」は持ち込まない。
 *
 * ■ 裏取りできた仕様（出典: Wikipedia / ピクシブ百科事典 / キユコブ）
 *   ・俯瞰視点のフィールド
 *   ・アクションではなく「リアルタイムシミュレーション」寄り
 *   ・選手ごとにコマンドを選び、**ガッツ（行動値）を消費**して行動する
 *   ・ガッツ不足時のメッセージ「くっ!! ガッツがたりない!!」
 *   ・**ドライブシュートはガッツ200消費＝1試合で4〜5回しか使えない**
 *   ・実況が画面に出る
 *   ⚠️ 下記のうち **GUTS_MAX=1000 / 各技の消費量 / ブロックの減衰率 / GK判定式** は
 *      一次資料に数字が無いため私の推定。ドライブシュート200×4〜5回から総量を逆算している。
 *      ユーザーの記憶と違ったら数字だけ差し替えればよいように、全部 CT_TUNE に出してある。
 * ==========================================================================*/
var CTMatch = (function () {
  'use strict';

  // 論理解像度＝NES相当（実画面はCSSで整数倍拡大＋image-rendering:pixelated）
  var W = 256, H = 224;
  var HUD_H = 24, MSG_H = 32;                 // 上=スコア/時間 / 下=実況テロップ＋ガッツ
  var FIELD_Y = HUD_H, FIELD_H = H - HUD_H - MSG_H;
  var PITCH_W = 640;                          // ピッチ全長（画面の2.5倍＝横スクロールする）

  /* ── 調整値（一次資料に数字が無いものはここに集約）───────────────── */
  var CT_TUNE = {
    GUTS_MAX: 1000,          // 推定（ドライブシュート200×4〜5回から逆算）
    COST: { dribble: 38, pass: 20, tackle: 40, shoot: 80, drive: 200, save: 60, block: 35 },
    LOW_GUTS: 60,            // これ未満で「ガッツがたりない!!」＝必殺技が出せない
    /* ★ 2026-07-30 初回実測で判明した3つの破綻を修正した後の値。
     *   ①1対1が0回だった（遭遇条件とシュート判定の閾値が重なり、必ずシュートに落ちていた）
     *   ②79分で0-0（3人ブロック×0.62でシュート力が1/4になりGKを絶対に越えられない）
     *   ③カットインが全フレームの61%（俯瞰1552 vs カットイン2448）＝試合が進まない */
    BLOCK_DECAY: 0.80,       // ブロック1人通過ごとにシュート力へ掛ける係数（旧0.62は減衰しすぎ）
    MAX_BLOCKERS: 2,         // 割り込めるDFの上限（旧3。CTも毎回3人は入らない）
    BLOCK_RANGE: 70,         // シュートラインからこの距離内のDFだけが割り込める
    PURSUE: 34,              // 最近傍DFが保持者を追う速さ(px/s)＝これが無いと遭遇が起きない
    MEET_DIST: 14,           // 遭遇成立の距離
    SHOOT_ZONE: 0.24,        // ゴールまでこの割合以内ならシュートを選ぶ（0.16では1試合2〜6本しか出なかった）
    TICK_MS: 16,
    FIELD_SEC: 3.4,          // 俯瞰を見せる目安（秒）。俯瞰:カットイン ≈ 6:4 を狙う
    CUTIN_MS: 900,           // 1対1カットインの尺（旧1500は長すぎた）
    SHOT_STAGE_MS: 340       // シュートの1段（ブロック1人ぶん）の尺
  };

  /* ── 架空チーム（キャラクターは再現しない）──────────────────────── */
  var TEAM_A = { name: 'アオバ', color: '#3b6cf0', dark: '#1b3a94', kit: '#e8eef8' };
  var TEAM_B = { name: 'クロガネ', color: '#d84a3a', dark: '#8f2418', kit: '#2b2b33' };
  var NAMES_A = ['カザマ', 'アサヒ', 'ミナト', 'ハヤト', 'ツキシマ', 'リク', 'ソウマ', 'イズミ', 'カイ', 'ノボル', 'タケル'];
  var NAMES_B = ['ゴウダ', 'クロキ', 'ハガネ', 'イブキ', 'ジン', 'ダイゴ', 'レン', 'マサ', 'ゲン', 'トウマ', 'シグレ'];
  // 必殺シュート（架空の技名）。cost=drive のものが「1試合4〜5回」の枠。
  var MOVES = [
    { name: 'ドライブシュート', cost: 'drive', pow: 210 },
    { name: 'かみそりシュート', cost: 'drive', pow: 195 },
    { name: 'ジャンプボレー', cost: 'shoot', pow: 130 },
    { name: 'ミドルシュート', cost: 'shoot', pow: 110 }
  ];

  function mkPlayer(i, team, name, isA) {
    var line = i === 0 ? 0 : i <= 4 ? 1 : i <= 7 ? 2 : 3;   // GK/DF/MF/FW
    return {
      i: i, name: name, team: team, isA: isA, gk: i === 0, line: line,
      guts: CT_TUNE.GUTS_MAX, gutsMax: CT_TUNE.GUTS_MAX,
      shoot: 70 + (line === 3 ? 45 : line === 2 ? 25 : 5) + (i % 5) * 4,
      tackle: 60 + (line === 1 ? 40 : line === 2 ? 22 : 4) + (i % 4) * 5,
      save: i === 0 ? 150 + (i % 3) * 10 : 0,
      x: 0, y: 0, ax: 0, ay: 0, step: 0
    };
  }

  function newState() {
    var A = NAMES_A.map(function (n, i) { return mkPlayer(i, TEAM_A, n, true); });
    var B = NAMES_B.map(function (n, i) { return mkPlayer(i, TEAM_B, n, false); });
    var st = {
      A: A, B: B, scoreA: 0, scoreB: 0,
      minute: 0, half: 1,
      ballX: PITCH_W * 0.5, ballY: FIELD_H * 0.5,
      holder: A[9], camX: 0,
      mode: 'field', modeT: 0,
      msg: 'キックオフ！',
      cut: null, log: [], over: false, cool: 0, dir: 1   // dir=1: Aが右へ攻める
    };
    layout(st);
    return st;
  }

  // 4-4-2 相当の初期配置（俯瞰なので x=ピッチ長手方向 / y=横幅方向）
  function layout(st) {
    function place(team, attackRight) {
      var baseX = attackRight ? 0.30 : 0.70;
      team.forEach(function (p) {
        var lx = [0.04, 0.22, 0.22, 0.22, 0.22, 0.45, 0.45, 0.45, 0.68, 0.68, 0.62][p.i];
        var ly = [0.50, 0.18, 0.40, 0.60, 0.82, 0.20, 0.42, 0.72, 0.30, 0.62, 0.46][p.i];
        var fx = attackRight ? lx : (1 - lx);
        p.x = fx * PITCH_W; p.y = ly * FIELD_H;
        p.ax = p.x; p.ay = p.y;
      });
      void baseX;
    }
    place(st.A, st.dir === 1);
    place(st.B, st.dir !== 1);
  }

  /* ── ロジック（自動進行・コマンド入力なし＝監督視点）────────────────
   *   ★ ユーザー指定: 試合中の入力は無し。CTの「選手ごとにコマンドを選ぶ」部分は
   *     AIが選ぶ形に置き換える。構造（遭遇→判定→カットイン）は変えない。 */
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  function opponents(st, p) { return p.isA ? st.B : st.A; }
  function mates(st, p) { return p.isA ? st.A : st.B; }
  function goalX(st, p) { return (p.isA === (st.dir === 1)) ? PITCH_W : 0; }

  // 最も近い相手（GK除く）
  function nearestFoe(st, p) {
    var best = null, bd = 1e9;
    opponents(st, p).forEach(function (o) {
      if (o.gk) return;
      var d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < bd) { bd = d; best = o; }
    });
    return { foe: best, dist: bd };
  }

  function spend(p, key) {
    var c = CT_TUNE.COST[key] || 0;
    if (p.guts < c) return false;
    p.guts -= c; return true;
  }

  function say(st, s) { st.msg = s; st.log.push('[' + st.minute + "'] " + s); if (st.log.length > 60) st.log.shift(); }

  function toCutin(st, kind, data) {
    st.mode = 'cutin'; st.modeT = 0;
    st.cut = Object.assign({ kind: kind, t: 0 }, data);
  }

  // 遭遇＝1対1。数値勝負（CTの「行動値を消費して判定」の型）
  function resolveDuel(st, atk, def) {
    var useDrive = false, move = null;
    var gx = goalX(st, atk);
    var toGoal = Math.abs(gx - atk.x);

    // シュートレンジならシュート、そうでなければドリブル突破かパス
    if (toGoal < PITCH_W * CT_TUNE.SHOOT_ZONE && atk.line >= 2) {
      move = pick(MOVES.filter(function (m) { return atk.guts >= CT_TUNE.COST[m.cost]; })) || null;
      if (!move) {                                    // ★ ガッツ切れ＝CTの名物メッセージ
        say(st, 'くっ!! ガッツがたりない!!');
        toCutin(st, 'noguts', { atk: atk });
        return;
      }
      useDrive = (move.cost === 'drive');
      spend(atk, move.cost);
      shootSequence(st, atk, move, useDrive);
      return;
    }

    // ドリブル突破 vs タックル
    if (!spend(atk, 'dribble')) { say(st, 'くっ!! ガッツがたりない!!'); toCutin(st, 'noguts', { atk: atk }); return; }
    spend(def, 'tackle');
    var atkV = atk.shoot * 0.5 + atk.tackle * 0.2 + (atk.guts / atk.gutsMax) * 60 + Math.random() * 40;
    var defV = def.tackle * 0.7 + (def.guts / def.gutsMax) * 55 + Math.random() * 40;
    var win = atkV >= defV;
    toCutin(st, 'duel', { atk: atk, def: def, atkV: Math.round(atkV), defV: Math.round(defV), win: win });
    say(st, win ? (atk.name + ' 抜いた！') : (def.name + ' タックル成功！'));
  }

  /* シュート＝多段ブロック。CTの「割り込むDFごとにシュート力が削られ、最後にGK」を再現。
   *   ★ ここがこのゲームの心臓部で、football-sim の「決着ビート」に直接効く構造。 */
  function shootSequence(st, atk, move, useDrive) {
    var pow = move.pow + atk.shoot * 0.5 + (atk.guts / atk.gutsMax) * 40;
    var gx = goalX(st, atk);
    /* ★ 割り込めるのは「シュートラインの近くにいるDF」だけ。
     *   旧実装はゴールに近い順に必ず3人取っていたので、毎回3段ブロックになり0-0になった。 */
    var foes = opponents(st, atk).filter(function (o) {
      if (o.gk) return false;
      var between = (gx > atk.x) ? (o.x > atk.x && o.x < gx) : (o.x < atk.x && o.x > gx);
      return between && Math.abs(o.y - atk.y) < CT_TUNE.BLOCK_RANGE;
    }).sort(function (a, b) { return Math.abs(a.x - atk.x) - Math.abs(b.x - atk.x); })
      .slice(0, CT_TUNE.MAX_BLOCKERS);
    var stages = [];
    foes.forEach(function (o) {
      if (pow <= 0) return;
      spend(o, 'block');
      var before = Math.round(pow);
      var resist = o.tackle * 0.55 + (o.guts / o.gutsMax) * 30 + Math.random() * 25;
      pow = pow * CT_TUNE.BLOCK_DECAY - resist * 0.25;
      stages.push({ by: o, before: before, after: Math.max(0, Math.round(pow)) });
    });
    var gk = opponents(st, atk).filter(function (o) { return o.gk; })[0];
    spend(gk, 'save');
    //   GKの壁を下げた（旧 save*0.6+45+rand40 ≈ 155 で、減衰後のシュート力が絶対に届かなかった）
    var gkV = gk.save * 0.58 + (gk.guts / gk.gutsMax) * 34 + Math.random() * 78;
    var goal = pow > gkV;
    stages.push({ by: gk, before: Math.max(0, Math.round(pow)), after: Math.round(gkV), isGk: true });
    if (goal) { if (atk.isA) st.scoreA++; else st.scoreB++; }
    toCutin(st, 'shot', { atk: atk, move: move, drive: useDrive, stages: stages, goal: goal, stage: 0 });
    say(st, atk.name + ' ' + move.name + '！！');
  }

  function afterCutin(st) {
    var c = st.cut;
    if (!c) { st.mode = 'field'; return; }
    if (c.kind === 'shot') {
      // ゴールでも枠外でも中央から再開（CTはゴール後にキックオフへ戻る）
      st.ballX = PITCH_W * 0.5; st.ballY = FIELD_H * 0.5;
      var side = c.goal ? (c.atk.isA ? st.B : st.A) : (c.atk.isA ? st.B : st.A);
      st.holder = side[9];
      layout(st);
      say(st, c.goal ? 'ゴール！！' : (c.stages[c.stages.length - 1].by.name + ' が防いだ！'));
    } else if (c.kind === 'duel') {
      /* ★ 2026-07-30 修正: 旧実装は勝者をその場で保持者にしていたので、
       *   **敗者がまだ14px以内にいて次フレームで即・再遭遇**した（1試合で1対1が30回超・
       *   ガッツが0になり「ガッツがたりない」が310回、俯瞰の時間が全体の2%になっていた）。
       *   決着したら必ず引き離す＋クールダウンを置く。 */
      var win = c.win ? c.atk : c.def, lose = c.win ? c.def : c.atk;
      var gx2 = goalX(st, win), d2 = gx2 > win.x ? 1 : -1;
      win.x = Math.max(6, Math.min(PITCH_W - 6, win.x + d2 * 34));
      lose.x = Math.max(6, Math.min(PITCH_W - 6, lose.x - d2 * 20));
      st.holder = win;
      /* 突破したら一定確率で前の味方へ渡す＝1人に行動が集中してガッツが枯れるのを防ぐ
       *   （CTも1人で運び切る作りではない）。 */
      if (c.win && Math.random() < 0.22) {
        var fwd = mates(st, win).filter(function (p) {
          return !p.gk && p !== win && (goalX(st, p) > p.x) === (d2 > 0) && Math.abs(p.x - win.x) < 150;
        });
        if (fwd.length) { var rec = pick(fwd); spend(win, 'pass'); st.holder = rec; }
      }
      st.ballX = st.holder.x; st.ballY = st.holder.y;
      st.cool = 1.1;
    } else if (c.kind === 'noguts') {
      var foe = nearestFoe(st, c.atk).foe;
      if (foe) {
        var gx3 = goalX(st, foe), d3 = gx3 > foe.x ? 1 : -1;
        foe.x = Math.max(6, Math.min(PITCH_W - 6, foe.x + d3 * 30));
        st.holder = foe; st.ballX = foe.x; st.ballY = foe.y;
      }
      st.cool = 1.1;
    }
    st.cut = null; st.mode = 'field'; st.modeT = 0;
  }

  function stepField(st, dt) {
    st.modeT += dt;
    var h = st.holder;
    if (!h) { st.holder = st.A[9]; return; }
    var gx = goalX(st, h);
    var dirx = gx > h.x ? 1 : -1;

    // 保持者は前進（＝俯瞰パートの「状況が進む」部分）
    var spd = 26 * (0.6 + 0.4 * (h.guts / h.gutsMax));
    h.x += dirx * spd * dt; h.y += Math.sin(st.modeT * 1.7 + h.i) * 6 * dt;
    h.x = Math.max(6, Math.min(PITCH_W - 6, h.x));
    h.y = Math.max(6, Math.min(FIELD_H - 6, h.y));
    st.ballX = h.x + dirx * 5; st.ballY = h.y + 3;
    h.step += dt * 8;

    // 他の選手は「ボールへ寄る」のでなくブロック単位で押し引き（形を保つ＝WIDE-01の教訓）
    var shiftA = (st.ballX / PITCH_W - 0.5) * 90, shiftB = shiftA;
    st.A.forEach(function (p) { if (p === h) return; p.x += ((p.ax + shiftA) - p.x) * Math.min(1, dt * 1.6); p.y += ((p.ay) - p.y) * Math.min(1, dt * 1.2); p.step += dt * 5; });
    st.B.forEach(function (p) { if (p === h) return; p.x += ((p.ax + shiftB) - p.x) * Math.min(1, dt * 1.6); p.y += ((p.ay) - p.y) * Math.min(1, dt * 1.2); p.step += dt * 5; });

    /* ★ 最近傍の守備だけは保持者を追う。これが無いと遭遇（1対1）が起きず、
     *   「シュートレンジに入って必ずシュート」しか発生しなかった（初回実測で1対1が0回）。
     *   ★ 追うのは1人だけ＝全員がボールに寄ると布陣の形が消える（WIDE-01の教訓と両立させる）。 */
    var chase = nearestFoe(st, h).foe;
    if (chase) {
      var cd = Math.hypot(h.x - chase.x, h.y - chase.y) || 1;
      chase.x += ((h.x - chase.x) / cd) * CT_TUNE.PURSUE * dt;
      chase.y += ((h.y - chase.y) / cd) * CT_TUNE.PURSUE * dt;
      chase.step += dt * 9;
    }

    // カメラ（保持者を追う・端でクランプ）
    var want = st.ballX - W * 0.5;
    st.camX += (Math.max(0, Math.min(PITCH_W - W, want)) - st.camX) * Math.min(1, dt * 3);

    /* ★ 遭遇のクールダウン。決着直後は少し走らせてから次の遭遇にする。 */
    if (st.cool > 0) { st.cool -= dt; return; }

    // 遭遇判定＝ここでカットインへ落ちる（俯瞰の尺 FIELD_SEC が目安）
    var nf = nearestFoe(st, h);
    var toGoal = Math.abs(gx - h.x);
    if ((nf.foe && nf.dist < CT_TUNE.MEET_DIST) || (toGoal < PITCH_W * CT_TUNE.SHOOT_ZONE) || st.modeT > CT_TUNE.FIELD_SEC) {
      var def = nf.foe || opponents(st, h)[1];
      resolveDuel(st, h, def);
    }
  }

  function stepCutin(st, dt) {
    st.modeT += dt;
    var c = st.cut; if (!c) { st.mode = 'field'; return; }
    c.t += dt;
    if (c.kind === 'shot') {
      // 1段ずつ「叩きつける」＝1画面1ビート。全段出し切ってから決着
      var per = CT_TUNE.SHOT_STAGE_MS / 1000;
      c.stage = Math.min(c.stages.length, Math.floor(c.t / per));
      if (c.t > per * (c.stages.length + 1.15)) afterCutin(st);
    } else if (c.t > CT_TUNE.CUTIN_MS / 1000) afterCutin(st);
  }

  function step(st, dt) {
    if (st.over) return;
    /* ★ 2026-07-30 修正: 時計は**カットイン中も進める**。
     *   旧実装は俯瞰パートでしか進めておらず、カットインが時間の98%を占めた結果
     *   20000フレーム回しても24分しか進まなかった。CTは「リアルタイムシミュレーション」なので
     *   決着を見せている間も試合時間は流れているのが正しい。
     *   レート0.55＝90分がおよそ実時間2分45秒（1試合を通しで見られる長さ）。 */
    st.minute += dt * 0.55;
    if (st.minute >= 90) { st.minute = 90; st.over = true; say(st, '試合終了！'); return; }
    if (st.half === 1 && st.minute >= 45) { st.half = 2; say(st, '後半開始'); }
    if (st.mode === 'field') stepField(st, dt); else stepCutin(st, dt);
  }

  /* ══════════════════════════════════════════════════════════════════
   * 描画 — 外部素材ゼロ。全部コードで描く（IP回避＋ChrisGPTの投稿と同じ考え方）
   * ════════════════════════════════════════════════════════════════ */
  function px(ctx, x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }

  function drawPitch(ctx, st) {
    var camX = st.camX | 0;
    px(ctx, 0, FIELD_Y, W, FIELD_H, '#2f8a3a');
    // 刈り目（縦縞）＝スクロールしていることが分かる手掛かり
    for (var s = 0; s < PITCH_W; s += 32) {
      var sx = s - camX;
      if (sx > -32 && sx < W) px(ctx, sx, FIELD_Y, 16, FIELD_H, '#358f40');
    }
    ctx.fillStyle = '#dfe8dd';
    // タッチライン
    px(ctx, 0, FIELD_Y + 2, W, 1, '#dfe8dd');
    px(ctx, 0, FIELD_Y + FIELD_H - 3, W, 1, '#dfe8dd');
    // センターライン＋サークル
    var cl = PITCH_W * 0.5 - camX;
    if (cl > -2 && cl < W) px(ctx, cl, FIELD_Y + 2, 1, FIELD_H - 5, '#dfe8dd');
    // ゴールとペナルティエリア（左右）
    [0, PITCH_W].forEach(function (gx) {
      var x = gx - camX;
      var inward = gx === 0 ? 1 : -1;
      if (x < -60 || x > W + 60) return;
      var pa = 46, ph = FIELD_H * 0.62, py = FIELD_Y + (FIELD_H - ph) / 2;
      px(ctx, x + (inward > 0 ? 0 : -pa), py, 1, ph, '#dfe8dd');
      px(ctx, x + (inward > 0 ? 0 : -pa), py, pa, 1, '#dfe8dd');
      px(ctx, x + (inward > 0 ? 0 : -pa), py + ph, pa, 1, '#dfe8dd');
      // ゴール枠
      var gh = FIELD_H * 0.26, gy = FIELD_Y + (FIELD_H - gh) / 2;
      px(ctx, x - (inward > 0 ? 4 : 0), gy, 4, gh, '#f2f2f2');
      px(ctx, x - (inward > 0 ? 4 : 0), gy, 4, 1, '#8c8c96');
    });
  }

  // 選手＝6×10pxのドット。頭/胴/脚の3パーツ＋2コマの走り（この寸法では線1本が1パーツ）
  function drawPlayer(ctx, st, p, isHolder) {
    var x = (p.x - st.camX) | 0, y = (FIELD_Y + p.y) | 0;
    if (x < -8 || x > W + 8) return;
    var t = p.team, sw = (Math.sin(p.step) > 0) ? 1 : -1;
    px(ctx, x - 3, y + 3, 6, 1, 'rgba(0,0,0,0.28)');          // 影（接地）
    px(ctx, x - 2, y - 9, 4, 3, '#e8b78a');                    // 頭
    px(ctx, x - 2, y - 10, 4, 1, p.gk ? '#26262e' : t.dark);   // 髪/キャップ
    px(ctx, x - 3, y - 6, 6, 5, p.gk ? t.kit : t.color);       // 胴
    px(ctx, x - 3, y - 1, 2, 4, '#f0f0f0');                    // 脚1
    px(ctx, x + 1, y - 1, 2, 4 - sw, '#f0f0f0');               // 脚2（走り2コマ）
    if (isHolder) {                                            // 保持者は白いリム＝視線誘導
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      ctx.strokeRect(x - 4.5, y - 11.5, 9, 15);
    }
  }

  function drawBall(ctx, st) {
    var x = (st.ballX - st.camX) | 0, y = (FIELD_Y + st.ballY) | 0;
    px(ctx, x - 1, y, 3, 3, '#ffffff');
    px(ctx, x, y + 1, 1, 1, '#20202a');
  }

  function drawHud(ctx, st) {
    px(ctx, 0, 0, W, HUD_H, '#101018');
    ctx.font = '8px "Courier New", monospace'; ctx.textBaseline = 'top';
    ctx.fillStyle = TEAM_A.color; ctx.fillText(TEAM_A.name, 6, 4);
    ctx.fillStyle = '#ffffff'; ctx.fillText(st.scoreA + ' - ' + st.scoreB, 100, 4);
    ctx.fillStyle = TEAM_B.color;
    var bw = ctx.measureText(TEAM_B.name).width; ctx.fillText(TEAM_B.name, W - 6 - bw, 4);
    ctx.fillStyle = '#f6d24a';
    ctx.fillText((st.minute | 0) + "' " + (st.half === 1 ? '前半' : '後半'), 100, 14);
  }

  function drawMsg(ctx, st) {
    var y = H - MSG_H;
    px(ctx, 0, y, W, MSG_H, '#101018');
    px(ctx, 4, y + 3, W - 8, 1, '#4a4a5a');
    ctx.font = '8px "Courier New", monospace'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff'; ctx.fillText(st.msg, 8, y + 8);
    // 保持者のガッツ（CTの行動値）
    var h = st.holder;
    if (h) {
      ctx.fillStyle = '#9fb0c8'; ctx.fillText(h.name, 8, y + 20);
      var bx = 60, bw2 = 120, r = Math.max(0, h.guts / h.gutsMax);
      px(ctx, bx, y + 21, bw2, 5, '#2a2a36');
      px(ctx, bx, y + 21, (bw2 * r) | 0, 5, r < 0.2 ? '#e0483a' : r < 0.5 ? '#f6d24a' : '#4ad06a');
      ctx.fillStyle = '#c8d2e0'; ctx.fillText('G ' + (h.guts | 0), bx + bw2 + 6, y + 20);
    }
  }

  /* ── カットイン（層M相当）──────────────────────────────────────
   * ★ 今日 football-sim で確立した規則をそのまま当てる:
   *   ・1画面1主語（主語だけ大きく、相手はシルエットへ落とす）
   *   ・決着コマを最大にする
   *   ・3つ以上に割らない
   *   ・未使用領域は黒のまま残す */
  function speedLines(ctx, cx, cy, alpha) {
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
    for (var i = 0; i < 28; i++) {
      var a = (i / 28) * Math.PI * 2 + 0.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26);
      ctx.lineTo(cx + Math.cos(a) * 200, cy + Math.sin(a) * 200);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* カットイン用の選手（主語はこれ1つ）。
   * ★ 2026-07-30 作り直し。初版は h=150 で 1ユニット9.4px＝胴が84px幅の巨大なベタになり、
   *   **人に見えなくなっていた**。[[art-one-shot-one-subject]] ③「誇張より実寸」を自分で破っていた。
   *   直したのは3点: ①縮尺を下げる ②パーツを増やして人型として読ませる（首・腕・靴）
   *   ③形に沿った暗いリムを付けて背景から分離する（バウンディングボックスで囲うと箱に見えるので
   *     パーツ集合を1pxオフセットで4方向に暗色描き→本色で上書き＝wideshot の rim4 と同じ発想）。 */
  function bigFigure(ctx, x, y, h, col, dark, pose) {
    var u = h / 22;                                  // 1ユニット（旧 h/16 から縮小＝パーツを細かく置ける）
    // パーツ表を作り、リム→本体の2パスで描く
    var parts = [];
    var P2 = function (dx, dy, w, hh, c) { parts.push([x + dx * u, y + dy * u, w * u, hh * u, c]); };
    P2(-2.6, -21, 5.2, 4.4, '#e8b78a');              // 顔
    P2(-2.8, -22.2, 5.6, 1.8, dark);                 // 髪
    P2(-1.6, -19.2, 1.3, 1.3, '#20202a');            // 目
    P2(0.5, -19.2, 1.3, 1.3, '#20202a');
    P2(-0.9, -16.6, 1.8, 1.4, '#e8b78a');            // 首
    if (pose === 'dive') {
      P2(-7, -13.5, 13, 4.6, col);                   // 胴（横一直線＝ダイブ）
      P2(5.5, -14.6, 3.6, 3.4, '#f6d24a');           // グローブ
      P2(-10.5, -12.2, 3.8, 2.6, col);               // 伸ばした腕
      P2(-13.5, -11.6, 3.2, 2.2, '#e8b78a');
      P2(4, -9.2, 5.5, 2.4, '#eef1f6');              // 脚
      P2(9, -8.8, 2.4, 2, '#2a2a34');                // 靴
    } else if (pose === 'kick') {
      P2(-3.4, -16, 6.8, 7.4, col);                  // 胴
      P2(-7.6, -14.6, 4.4, 2.4, col);                // 振り腕（後ろ）
      P2(3.4, -15.2, 4.0, 2.3, col);                 // 前腕
      P2(-2.6, -8.8, 2.6, 6.2, '#eef1f6');           // 軸脚
      P2(0.6, -8.6, 5.8, 2.7, '#eef1f6');            // 蹴り脚（前へ）
      P2(5.8, -9.0, 2.5, 2.2, '#2a2a34');            // 靴
      P2(-2.9, -2.9, 2.9, 2.1, '#2a2a34');
    } else {
      P2(-3.4, -16, 6.8, 7.4, col);                  // 胴
      P2(-6.4, -14.8, 3.0, 4.4, col);                // 腕
      P2(3.4, -14.8, 3.0, 4.4, col);
      P2(-2.8, -8.8, 2.5, 6.4, '#eef1f6');           // 脚
      P2(0.4, -8.8, 2.5, 6.4, '#eef1f6');
      P2(-3.0, -2.6, 2.9, 2.0, '#2a2a34');           // 靴
      P2(0.2, -2.6, 2.9, 2.0, '#2a2a34');
    }
    var o = Math.max(1, u * 0.5);
    [[-o, 0], [o, 0], [0, -o], [0, o]].forEach(function (d) {      // リム（形に沿う）
      parts.forEach(function (q) { px(ctx, q[0] + d[0], q[1] + d[1], q[2], q[3], '#0a0a12'); });
    });
    parts.forEach(function (q) { px(ctx, q[0], q[1], q[2], q[3], q[4]); });
  }

  function drawCutin(ctx, st) {
    var c = st.cut; if (!c) return;
    px(ctx, 0, 0, W, H, '#000000');                  // ★ 未使用領域は黒のまま
    var cy = H * 0.52;

    if (c.kind === 'noguts') {
      speedLines(ctx, W / 2, cy, 0.10);
      bigFigure(ctx, W * 0.5, cy + 46, 92, c.atk.team.color, c.atk.team.dark, 'stand');
      ctx.font = '14px "Courier New", monospace'; ctx.textBaseline = 'top';
      ctx.fillStyle = '#e0483a'; ctx.fillText('くっ!!', W * 0.5 - 22, 24);
      ctx.fillStyle = '#f6d24a'; ctx.fillText('ガッツがたりない!!', 40, 44);
      return;
    }

    if (c.kind === 'duel') {
      var p = Math.min(1, c.t / (CT_TUNE.CUTIN_MS / 1000));
      speedLines(ctx, W * 0.42, cy, 0.14 * (1 - p * 0.5));
      // 非主語＝守備は暗いシルエットで小さく（SUBDUE の考え方）
      bigFigure(ctx, W * 0.78, cy + 40, 62, c.def.team.dark, '#101018', 'stand');
      // 主語＝攻撃。大きく
      bigFigure(ctx, W * 0.34, cy + 48, 100, c.atk.team.color, c.atk.team.dark, 'stand');
      ctx.font = '10px "Courier New", monospace'; ctx.textBaseline = 'top';
      ctx.fillStyle = '#ffffff'; ctx.fillText(c.atk.name, 8, 30);
      ctx.fillStyle = '#f6d24a'; ctx.fillText(String(c.atkV), 8, 42);
      ctx.fillStyle = '#9fb0c8'; ctx.fillText(c.def.name, W - 70, 30);
      ctx.fillStyle = '#f6d24a'; ctx.fillText(String(c.defV), W - 70, 42);
      if (p > 0.55) {
        ctx.font = '14px "Courier New", monospace';
        ctx.fillStyle = c.win ? '#4ad06a' : '#e0483a';
        ctx.fillText(c.win ? 'ぬいた！' : 'とめた！', W * 0.5 - 30, H - 56);
      }
      return;
    }

    if (c.kind === 'shot') {
      var n = c.stage, last = c.stages.length;
      var atGoalBeat = (c.stage >= c.stages.length);
      /* ★ 1ショット1主語。決着の拍ではシューターを描かない＝主語をGK(またはゴール)へ渡す。
       *   初版は蹴りのシューターとダイブのGKが同じ画面に重なっていて主語が2つになっていた。 */
      speedLines(ctx, atGoalBeat ? W * 0.5 : W * 0.4, cy, 0.16);
      if (!atGoalBeat) bigFigure(ctx, W * 0.33, cy + 54, 112, c.atk.team.color, c.atk.team.dark, 'kick');
      ctx.font = (c.drive ? '15px' : '12px') + ' "Courier New", monospace'; ctx.textBaseline = 'top';
      ctx.fillStyle = c.drive ? '#f6d24a' : '#ffffff';
      if (!atGoalBeat) { px(ctx, 0, 26, W, 18, 'rgba(6,6,14,0.72)'); ctx.fillText(c.move.name + '！！', 8, 28); }
      // 巨大なボール（決着の主語＝ボールがどこにあるか）
      var bp = Math.min(1, c.t / 0.5);
      var bx2 = W * 0.52 + bp * W * 0.34, br = 8 + bp * 8;
      if (!atGoalBeat) {
        // 角を落として丸く見せる（ベタの正方形はボールに見えない）
        px(ctx, bx2 - br, cy - br * 0.62, br * 2, br * 1.24, '#ffffff');
        px(ctx, bx2 - br * 0.62, cy - br, br * 1.24, br * 2, '#ffffff');
        px(ctx, bx2 - br * 0.84, cy - br * 0.84, br * 1.68, br * 1.68, '#ffffff');
        px(ctx, bx2 - br * 0.34, cy - br * 0.34, br * 0.68, br * 0.68, '#20202a');
      }

      // 拍2〜: ブロックが1段ずつ割り込み、数値が削られる
      for (var i = 0; i < n && i < last; i++) {
        var sg = c.stages[i], yy = 40 + i * 22;
        ctx.font = '9px "Courier New", monospace';
        ctx.fillStyle = sg.isGk ? '#9fd0ff' : '#ffb0a0';
        ctx.fillText((sg.isGk ? 'GK ' : 'BLOCK ') + sg.by.name, W - 116, yy);
        ctx.fillStyle = '#f6d24a';
        ctx.fillText(sg.before + ' → ' + sg.after, W - 116, yy + 9);
      }
      // 決着（最大のコマ）
      if (n >= last) {
        var gkSg = c.stages[last - 1];
        px(ctx, 0, 0, W, H, c.goal ? 'rgba(80,220,120,0.10)' : 'rgba(20,20,40,0.55)');
        if (!c.goal) bigFigure(ctx, W * 0.46, H * 0.70, 104, gkSg.by.team.kit, '#101018', 'dive');
        ctx.font = '20px "Courier New", monospace'; ctx.textBaseline = 'top';
        ctx.fillStyle = c.goal ? '#f6d24a' : '#9fd0ff';
        var txt = c.goal ? 'ゴール！！' : 'セーブ！！';
        ctx.fillText(txt, W * 0.5 - ctx.measureText(txt).width / 2, H - 58);
      }
      return;
    }
  }

  function render(ctx, st) {
    ctx.imageSmoothingEnabled = false;
    if (st.mode === 'cutin') { drawCutin(ctx, st); drawHud(ctx, st); drawMsg(ctx, st); return; }
    drawPitch(ctx, st);
    var all = st.A.concat(st.B).sort(function (a, b) { return a.y - b.y; });   // 奥→手前
    all.forEach(function (p) { drawPlayer(ctx, st, p, p === st.holder); });
    drawBall(ctx, st);
    drawHud(ctx, st);
    drawMsg(ctx, st);
  }

  /* ── 公開API ─────────────────────────────────────────────────── */
  function mount(canvas, opts) {
    opts = opts || {};
    canvas.width = W; canvas.height = H;
    canvas.style.imageRendering = 'pixelated';
    var ctx = canvas.getContext('2d');
    var st = newState();
    var speed = opts.speed || 1;
    var running = true, last = null, raf = null;

    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (last === null) last = now;
      var dt = Math.min(0.05, (now - last) / 1000) * speed;
      last = now;
      if (running) step(st, dt);
      render(ctx, st);
    }
    raf = requestAnimationFrame(loop);

    return {
      state: function () { return st; },
      pause: function () { running = false; },
      resume: function () { running = true; last = null; },
      toggle: function () { running = !running; last = null; return running; },
      setSpeed: function (v) { speed = v; },
      restart: function () { st = newState(); },
      tick: function (dt) { step(st, dt); render(ctx, st); },   // テスト用（rAFに依存せず進められる）
      stop: function () { cancelAnimationFrame(raf); },
      DIM: { W: W, H: H }, TUNE: CT_TUNE
    };
  }

  return { mount: mount, TUNE: CT_TUNE, DIM: { W: W, H: H } };
})();
