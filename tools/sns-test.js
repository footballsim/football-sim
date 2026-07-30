/**
 * sns-test.js — RW-01 SNS風フィード（js/sns.js）の headless 検証。
 *
 * sns.js は「ctx を受け取って投稿配列を返す純関数」なので、league.js もブラウザも要らない。
 * 検証対象:
 *   ① 決定論（同じ ctx なら常に同じフィード＝seed 再現を壊さない）
 *   ② 状況に反応する（勝敗・宿敵・連勝連敗・順位・MOM・ハット・解任危機・番狂わせ・離脱）
 *   ③ 毒舌度のツマミが効く（SNARK 0 では辛口テンプレが出ない）
 *   ④ 日英とも文が出る／置換子({club}等)の消し残しが無い
 *   ⑤ 投稿数の上限を守る／欠けた ctx でも落ちない
 *
 * 実行: node tools/sns-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ctxSandbox = { console };
vm.createContext(ctxSandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'sns.js'), 'utf8'), ctxSandbox, { filename: 'sns.js' });
const SNS = ctxSandbox.SNS;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

/* ── ctx の雛形 ─────────────────────────────────────────────────────── */
function baseCtx(over) {
  const c = {
    lang: 'ja', snark: 1, season: 1, round: 5, totalRounds: 14,
    club: { id: 'my', name: 'マイクラブ' },
    opp: { id: 'op', name: 'オポネント' },
    result: { res: 'W', gf: 2, ga: 1, rival: false, posBefore: 4, posAfter: 3 },
    mom: { name: 'エース', goals: 1, assists: 1 },
    scorers: [{ name: 'エース', goals: 1 }, { name: 'ベテラン', goals: 1 }],
    streak: null, leader: { id: 'ld', name: 'リーダーFC' }, upset: false,
    manager: { trust: 55, popularity: 40, popularityUp: false },
    absences: [], goalText: '3位以内'
  };
  return Object.assign(c, over || {});
}
const kinds = f => f.map(p => p.kind);
const texts = f => f.map(p => p.text).join('\n');

/* ── ① 決定論 ───────────────────────────────────────────────────────── */
section('① 決定論（rng 不使用・同じ状況なら常に同じフィード）');
const c1 = baseCtx();
check('同じ ctx を2回渡すと完全に一致する',
  JSON.stringify(SNS.build(c1)) === JSON.stringify(SNS.build(baseCtx())));
check('節が変われば文面のバリエーションが変わりうる（同じ状況の連投を避ける）', (function () {
  const seen = new Set();
  for (let r = 1; r <= 14; r++) seen.add(SNS.build(baseCtx({ round: r }))[0].text);
  return seen.size >= 2;
})());
check('クラブが違えば別のフィードになる',
  SNS.build(baseCtx()).length > 0 &&
  JSON.stringify(SNS.build(baseCtx())) !== JSON.stringify(SNS.build(baseCtx({ club: { id: 'other', name: '別クラブ' } }))));

/* ── ② 状況に反応する ───────────────────────────────────────────────── */
section('② 状況への反応');
check('大勝は winBig / 僅差勝ちは winNarrow',
  kinds(SNS.build(baseCtx({ result: { res: 'W', gf: 4, ga: 0, posBefore: 4, posAfter: 3 } })))[0] === 'winBig' &&
  kinds(SNS.build(baseCtx({ result: { res: 'W', gf: 1, ga: 0, posBefore: 4, posAfter: 3 } })))[0] === 'winNarrow');
check('引き分けは drawGame', kinds(SNS.build(baseCtx({ result: { res: 'D', gf: 1, ga: 1, posBefore: 3, posAfter: 3 } })))[0] === 'drawGame');
check('大敗は lossBig / 惜敗は lossNarrow',
  kinds(SNS.build(baseCtx({ result: { res: 'L', gf: 0, ga: 4, posBefore: 3, posAfter: 5 } })))[0] === 'lossBig' &&
  kinds(SNS.build(baseCtx({ result: { res: 'L', gf: 1, ga: 2, posBefore: 3, posAfter: 5 } })))[0] === 'lossNarrow');
check('宿敵に勝つと rivalWin が載る',
  kinds(SNS.build(baseCtx({ result: { res: 'W', gf: 2, ga: 1, rival: true, posBefore: 4, posAfter: 3 } }))).indexOf('rivalWin') >= 0);
check('宿敵に負けると rivalLoss が載る',
  kinds(SNS.build(baseCtx({ result: { res: 'L', gf: 0, ga: 1, rival: true, posBefore: 3, posAfter: 4 } }))).indexOf('rivalLoss') >= 0);
check('ハットトリックは MOM より優先される', (function () {
  const k = kinds(SNS.build(baseCtx({ scorers: [{ name: 'エース', goals: 3 }] })));
  return k.indexOf('hattrick') >= 0 && k.indexOf('mom') < 0;
})());
check('無失点勝利は cleanSheet が載る',
  kinds(SNS.build(baseCtx({ result: { res: 'W', gf: 1, ga: 0, posBefore: 4, posAfter: 3 } }))).indexOf('cleanSheet') >= 0);
check('3連勝で winStreak / 3連敗で lossStreak',
  kinds(SNS.build(baseCtx({ streak: { kind: 'W', n: 3 } }))).indexOf('winStreak') >= 0 &&
  kinds(SNS.build(baseCtx({ result: { res: 'L', gf: 0, ga: 2, posBefore: 3, posAfter: 4 }, streak: { kind: 'L', n: 3 } }))).indexOf('lossStreak') >= 0);
check('2連勝では連勝ネタにならない（騒ぐのは3から）',
  kinds(SNS.build(baseCtx({ streak: { kind: 'W', n: 2 } }))).indexOf('winStreak') < 0);
check('首位浮上は climbTop',
  kinds(SNS.build(baseCtx({ result: { res: 'W', gf: 2, ga: 1, posBefore: 2, posAfter: 1 } }))).indexOf('climbTop') >= 0);
check('順位が下がると drop',
  kinds(SNS.build(baseCtx({ result: { res: 'L', gf: 0, ga: 1, posBefore: 3, posAfter: 6 } }))).indexOf('drop') >= 0);
check('信頼が低いと解任危機の記事が出る',
  kinds(SNS.build(baseCtx({ manager: { trust: 30, popularity: 20 } }))).indexOf('trustLow') >= 0);
check('信頼が高いと称賛の記事が出る',
  kinds(SNS.build(baseCtx({ manager: { trust: 80, popularity: 60 } }))).indexOf('trustHigh') >= 0);
check('首位が他会場で負けると番狂わせが載る',
  kinds(SNS.build(baseCtx({ upset: true }))).indexOf('upset') >= 0);
check('離脱者がいると absence が載る',
  kinds(SNS.build(baseCtx({ absences: [{ name: '主力', kind: 'injury' }] }))).indexOf('absence') >= 0);
check('終盤3節は seasonRunIn が載る',
  kinds(SNS.build(baseCtx({ round: 13, totalRounds: 14 }))).indexOf('seasonRunIn') >= 0);
check('開幕前（result なし）は目標の提示だけ', (function () {
  const f = SNS.build(baseCtx({ result: null, round: 0 }));
  return f.length > 0 && f[0].kind === 'seasonOpen' && f[0].text.indexOf('3位以内') >= 0;
})());

/* ── ③ 毒舌度 ───────────────────────────────────────────────────────── */
section('③ 毒舌度のツマミ（OP-02 で既定値を確定する）');
check('SNARK=0 では tone2（辛口）の投稿が一切出ない', (function () {
  for (let r = 1; r <= 14; r++) {
    const cases = [
      baseCtx({ snark: 0, round: r, result: { res: 'L', gf: 0, ga: 4, posBefore: 3, posAfter: 6 } }),
      baseCtx({ snark: 0, round: r, result: { res: 'L', gf: 0, ga: 1, rival: true, posBefore: 3, posAfter: 4 } }),
      baseCtx({ snark: 0, round: r, streak: { kind: 'L', n: 4 }, result: { res: 'L', gf: 0, ga: 2, posBefore: 3, posAfter: 6 } }),
      baseCtx({ snark: 0, round: r, manager: { trust: 20, popularity: 10 } })
    ];
    for (const c of cases) if (SNS.build(c).some(p => p.tone > 0)) return false;
  }
  return true;
})());
check('SNARK=2 では辛口の投稿が実際に出る', (function () {
  for (let r = 1; r <= 14; r++) {
    const f = SNS.build(baseCtx({ snark: 2, round: r, result: { res: 'L', gf: 0, ga: 4, posBefore: 3, posAfter: 6 } }));
    if (f.some(p => p.tone === 2)) return true;
  }
  return false;
})());
check('SNARK=0 でも投稿が空にならない（穏当なテンプレへ落ちる）',
  SNS.build(baseCtx({ snark: 0, result: { res: 'L', gf: 0, ga: 4, posBefore: 3, posAfter: 6 } })).length > 0);

/* ── ④ 文面の健全性 ─────────────────────────────────────────────────── */
section('④ 文面（日英・置換子の消し残し・空文字）');
check('全テンプレに ja と en が両方ある', (function () {
  return SNS._templateKinds().every(function (k) {
    return SNS.TEMPLATES[k].every(function (t) {
      return typeof t.ja === 'string' && t.ja.length > 0 && typeof t.en === 'string' && t.en.length > 0;
    });
  });
})());
check('全テンプレの tone が 0..2 に収まる', SNS._templateKinds().every(function (k) {
  return SNS.TEMPLATES[k].every(function (t) { return t.tone >= 0 && t.tone <= 2; });
}));
check('全テンプレの発信者が PERSONAS に存在する', SNS._templateKinds().every(function (k) {
  return SNS.TEMPLATES[k].every(function (t) { return !!SNS.PERSONAS[t.p]; });
}));
check('置換子（{club}等）が本文に残らない（日英・全状況）', (function () {
  const variants = [
    {}, { result: { res: 'L', gf: 0, ga: 4, posBefore: 1, posAfter: 6 } },
    { result: { res: 'D', gf: 1, ga: 1, rival: true, posBefore: 3, posAfter: 3 } },
    { scorers: [{ name: 'エース', goals: 3 }] }, { streak: { kind: 'W', n: 5 } },
    { streak: { kind: 'L', n: 4 }, result: { res: 'L', gf: 0, ga: 2, posBefore: 2, posAfter: 5 } },
    { manager: { trust: 20, popularity: 10 } }, { manager: { trust: 90, popularity: 90, popularityUp: true } },
    { upset: true }, { absences: [{ name: '主力', kind: 'injury' }] },
    { result: null, round: 0 }, { round: 14, totalRounds: 14 },
    { result: { res: 'W', gf: 3, ga: 0, posBefore: 2, posAfter: 1 } }
  ];
  for (const lang of ['ja', 'en']) {
    for (const sn of [0, 1, 2]) {
      for (const v of variants) {
        for (let r = 1; r <= 14; r++) {
          const f = SNS.build(baseCtx(Object.assign({ lang: lang, snark: sn, round: r }, v)));
          for (const p of f) {
            if (/\{\w+\}/.test(p.text)) return false;
            if (!p.text.trim()) return false;
          }
        }
      }
    }
  }
  return true;
})());
check('英語の序数が崩れない（2th ではなく 2nd）', (function () {
  const bad = /\b(1th|2th|3th|21th|22th|23th)\b/;
  for (let pos = 1; pos <= 24; pos++) {
    for (let r = 1; r <= 14; r++) {
      for (const res of ['W', 'L']) {
        const f = SNS.build(baseCtx({ lang: 'en', round: r,
          result: { res: res, gf: res === 'W' ? 2 : 0, ga: res === 'W' ? 0 : 2, posBefore: res === 'W' ? pos + 1 : Math.max(1, pos - 1), posAfter: pos },
          round: r, totalRounds: 14 }));
        for (const p of f) if (bad.test(p.text)) return false;
      }
    }
  }
  return true;
})());
check('言語を切り替えても「同じ投稿の翻訳」になる（テンプレ抽選もいいね数も変わらない）', (function () {
  const over = { mom: { name: 'エース', key: 'ACE_ID', goals: 1, assists: 1 },
                 scorers: [{ name: 'エース', key: 'ACE_ID', goals: 1 }],
                 absences: [{ name: '主力', key: 'KEY_ID', kind: 'injury' }] };
  for (let r = 1; r <= 14; r++) {
    const ja = SNS.build(baseCtx(Object.assign({ lang: 'ja', round: r }, over)));
    const en = SNS.build(baseCtx(Object.assign({ lang: 'en', round: r },
      { mom: { name: 'Ace', key: 'ACE_ID', goals: 1, assists: 1 },
        scorers: [{ name: 'Ace', key: 'ACE_ID', goals: 1 }],
        absences: [{ name: 'Star', key: 'KEY_ID', kind: 'injury' }] })));
    if (ja.length !== en.length) return false;
    for (let i = 0; i < ja.length; i++) {
      if (ja[i].kind !== en[i].kind) return false;
      if (ja[i].persona !== en[i].persona) return false;
      if (ja[i].likes !== en[i].likes) return false;
    }
  }
  return true;
})());
check('英語モードでは英語の発信者名になる',
  SNS.build(baseCtx({ lang: 'en' }))[0].name === SNS.PERSONAS[SNS.build(baseCtx({ lang: 'en' }))[0].persona].en);

/* ── ⑤ 上限と頑健性 ─────────────────────────────────────────────────── */
section('⑤ 件数の上限と、欠けた ctx への耐性');
check('全部入りでも MAX_POSTS(' + SNS.TUNING.MAX_POSTS + ') を超えない', (function () {
  const f = SNS.build(baseCtx({
    result: { res: 'W', gf: 5, ga: 0, rival: true, posBefore: 3, posAfter: 1 },
    scorers: [{ name: 'エース', goals: 3 }], streak: { kind: 'W', n: 6 },
    manager: { trust: 90, popularity: 90, popularityUp: true },
    upset: true, absences: [{ name: '主力', kind: 'injury' }], round: 14, totalRounds: 14
  }));
  return f.length <= SNS.TUNING.MAX_POSTS && f.length >= 4;
})());
check('ctx が null でも落ちない', Array.isArray(SNS.build(null)) && SNS.build(null).length === 0);
check('最低限の ctx（結果だけ）でも落ちない', (function () {
  const f = SNS.build({ lang: 'ja', season: 1, round: 1, club: { id: 'a', name: 'A' },
    result: { res: 'W', gf: 1, ga: 0, posBefore: 2, posAfter: 1 } });
  return Array.isArray(f) && f.length > 0;
})());
check('いいね数は決定論で、同じ投稿なら同じ数字',
  SNS.build(baseCtx())[0].likes === SNS.build(baseCtx())[0].likes);
check('同じ発信者がフィードを埋め尽くさない（世間の反応に見せる）', (function () {
  for (let r = 1; r <= 14; r++) {
    const f = SNS.build(baseCtx({
      round: r, result: { res: 'W', gf: 3, ga: 0, posBefore: 3, posAfter: 1 },
      manager: { trust: 55, popularity: 40, popularityUp: true }
    }));
    const count = {};
    f.forEach(p => { count[p.persona] = (count[p.persona] || 0) + 1; });
    // 4件以上のフィードで、1アカウントが半分超を占めていないこと
    if (f.length >= 4 && Object.keys(count).some(k => count[k] > Math.ceil(f.length / 2))) return false;
  }
  return true;
})());
check('setSnark が 0..2 に丸められる',
  SNS.setSnark(9) === 2 && SNS.setSnark(-3) === 0 && SNS.setSnark(1) === 1);

console.log('\n' + (fail === 0 ? '✅ PASS' : '❌ FAIL') + '  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
