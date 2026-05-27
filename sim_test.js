#!/usr/bin/env node
/**
 * sim_test.js
 * W杯モードMCシミュレーション検証スクリプト
 *
 * index.html から JS を抽出し、DOM スタブを設定した上で
 * runWCMonteCarlo() を複数回実行してWC全ルートの通過率を集計する。
 *
 * 使い方: node sim_test.js [試行数=5000]
 */

const fs = require('fs');
const vm = require('vm');

const N_TRIALS = parseInt(process.argv[2] || '5000');
const HTML_PATH = __dirname + '/index.html';

// --- 1. index.html から <script> ブロックを抽出 (line 2282〜10528) ---
const html = fs.readFileSync(HTML_PATH, 'utf8');
const lines = html.split('\n');

// 2282行目の <script> から 10528行目の </script> まで
const START_LINE = 2282; // 0-indexed: 2281
// </script> の行を動的に検索
const END_LINE = lines.findIndex((l, i) => i > START_LINE && l.trim() === '</script>');
const jsLines = lines.slice(START_LINE, END_LINE); // </script> を除く
const jsCode = jsLines.join('\n');

// --- 2. DOM スタブ（DOM APIを呼ぶ初期化コードをダミーに置き換え） ---
const stub = `
// ========= DOM / Firebase / i18n スタブ =========
class URLSearchParams { constructor(s){} get(k){ return null; } }
const document = {
  getElementById: () => ({ textContent:'', style:{}, value:'', classList:{ add:()=>{}, remove:()=>{} } }),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style:{}, appendChild:()=>{}, setAttribute:()=>{} }),
  body: { appendChild:()=>{} },
  addEventListener: ()=>{}
};
const window = { addEventListener:()=>{}, location:{hash:'', search:''} };
const navigator = { language: 'ja' };
const localStorage = { getItem:()=>null, setItem:()=>{} };
const firebase = { initializeApp:()=>{}, firestore:()=>({ collection:()=>({ doc:()=>({ get:()=>Promise.resolve({exists:false,data:()=>({})}) }) }) }) };
const gtag = ()=>{};

// i18n stub（シミュレーション内では未使用だが念の為）
function t(key){ return key; }

// showScreen など UI 関数のスタブ
function showScreen(){}
function showWCStats(){}

// --- スタブ終わり ---
`;

// --- 3. コード合成 ---
const fullCode = stub + '\n' + jsCode;

// --- 4. vm で実行 ---
console.log('index.html から JS を読み込み中...');
const ctx = vm.createContext({
  Math, console, parseInt, parseFloat, isNaN, isFinite,
  setTimeout: (fn) => fn(), // 即時実行（シミュ内のsetTimeoutを回避）
  clearTimeout: ()=>{},
  setInterval: ()=>0,
  clearInterval: ()=>{},
  Promise,
  JSON,
  Object, Array, String, Number, Boolean, Date, RegExp, Error,
  require,
  __dirname,
});

try {
  vm.runInContext(fullCode, ctx, { filename: 'index_extracted.js' });
} catch(e) {
  console.error('JS 実行エラー:', e.message);
  console.error(e.stack.split('\n').slice(0,10).join('\n'));
  process.exit(1);
}

// --- 5. runWCMonteCarlo を取得 ---
const runWCMonteCarlo = ctx.runWCMonteCarlo;
if (typeof runWCMonteCarlo !== 'function') {
  console.error('runWCMonteCarlo が見つかりません');
  process.exit(1);
}

// --- 6. キャリブレーション1回実行（試合ごとの勝率確認） ---
console.log(`\nキャリブレーション実行中（CAL=50）...`);
const calibStart = Date.now();
// _calibrateWCRates を vm context 内で呼ぶ
const rt = vm.runInContext('_calibrateWCRates()', ctx);
const calibMs = Date.now() - calibStart;
console.log(`キャリブレーション完了 (${calibMs}ms)\n`);

console.log('── キャリブレーション勝率 ──');
const matchups = [
  ['vs オランダ   (jp_nl)', rt.jp_nl],
  ['vs チュニジア (jp_tn)', rt.jp_tn],
  ['vs スウェーデン(jp_sw)', rt.jp_sw],
  ['vs モロッコ   (jp_mo)', rt.jp_mo],
  ['vs ブラジル   (jp_br)', rt.jp_br],
  ['vs メキシコ   (jp_mx)', rt.jp_mx],
  ['vs ノルウェー  (jp_no)', rt.jp_no],
  ['vs フランス   (jp_fr)', rt.jp_fr],
  ['vs イングランド(jp_en)', rt.jp_en],
  ['vs スペイン   (jp_sp)', rt.jp_sp],
  ['vs アルゼンチン(jp_ar)', rt.jp_ar],
];
for (const [label, r] of matchups) {
  const w = Math.round(r.w * 100), d = Math.round(r.d * 100), l = Math.round(r.l * 100);
  console.log(`  ${label}: 勝${w}% 分${d}% 負${l}%`);
}

// --- 7. 本番シミュレーション ---
console.log(`\n── MC シミュレーション ${N_TRIALS.toLocaleString()} 回実行中 ──`);
const simStart = Date.now();
const R = runWCMonteCarlo(N_TRIALS);
const simMs = Date.now() - simStart;
const N = R.N;

// --- 8. 結果表示 ---
const pct  = v => (v / N * 100).toFixed(1).padStart(5) + '%';
const pct2 = (v, base) => base > 0 ? (v / base * 100).toFixed(1).padStart(5) + '%' : '   N/A';

console.log(`完了 (${simMs}ms)\n`);
console.log('═══════════════════════════════════════════');
console.log('  WC シミュレーション確率 (N =', N_TRIALS.toLocaleString(), ')');
console.log('═══════════════════════════════════════════');

const qualified = R.q1st + R.q2nd;

console.log('\n【グループリーグ】');
const gl = [
  ['vsオランダ',     R.vsNL],
  ['vsチュニジア',   R.vsTN],
  ['vsスウェーデン', R.vsSW],
];
for (const [lbl, r] of gl) {
  console.log(`  ${lbl.padEnd(10)}: 勝${pct(r.w)} 分${pct(r.d)} 負${pct(r.l)}`);
}

console.log('\n【突破率】');
console.log(`  1位通過   : ${pct(R.q1st)}`);
console.log(`  2位通過   : ${pct(R.q2nd)}`);
console.log(`  突破合計  : ${pct(qualified)}`);
console.log(`  (脱落     : ${pct(R.qFail)})`);

console.log('\n【ラウンド32 (R32)】');
console.log(`  R32進出   : ${pct(qualified)} (＝突破合計)`);
console.log(`  R32突破計 : ${pct(R.r32w)}`);
console.log(`    vsモロッコ (1位ルート): 突破${pct2(R.r32Morocco.w, R.r32Morocco.w+R.r32Morocco.l)}`);
console.log(`    vsブラジル (2位ルート): 突破${pct2(R.r32Brazil.w,  R.r32Brazil.w +R.r32Brazil.l )}`);

console.log('\n【ラウンド16 (R16)】');
console.log(`  R16進出   : ${pct(R.r32w)}`);
console.log(`  R16突破計 : ${pct(R.r16w)}`);
console.log(`    vsメキシコ  (1位ルート): 突破${pct2(R.r16Mexico.w, R.r16Mexico.w+R.r16Mexico.l)}`);
console.log(`    vsノルウェー(2位ルート): 突破${pct2(R.r16Norway.w,  R.r16Norway.w +R.r16Norway.l )}`);

console.log('\n【準々決勝 (QF)】');
console.log(`  QF進出    : ${pct(R.r16w)}`);
console.log(`  QF突破計  : ${pct(R.qfw)}`);
console.log(`    vsフランス    (1位ルート): 突破${pct2(R.qfFrance.w,  R.qfFrance.w +R.qfFrance.l )}`);
console.log(`    vsイングランド(2位ルート): 突破${pct2(R.qfEngland.w, R.qfEngland.w+R.qfEngland.l)}`);

console.log('\n【準決勝 (SF)】');
console.log(`  SF進出    : ${pct(R.qfw)}`);
console.log(`  SF突破計  : ${pct(R.sfw)}`);
console.log(`    vsスペイン    (1位ルート): 突破${pct2(R.sfSpain.w,     R.sfSpain.w    +R.sfSpain.l    )}`);
console.log(`    vsアルゼンチン(2位ルート): 突破${pct2(R.sfArgentina.w, R.sfArgentina.w+R.sfArgentina.l)}`);

console.log('\n【決勝 (F)】');
console.log(`  F進出     : ${pct(R.sfw)}`);
console.log(`  優勝       : ${pct(R.finw)}`);
console.log(`    vsアルゼンチン(1位ルート): 突破${pct2(R.finArgentina.w, R.finArgentina.w+R.finArgentina.l)}`);
console.log(`    vsフランス    (2位ルート): 突破${pct2(R.finFrance.w,     R.finFrance.w   +R.finFrance.l   )}`);

console.log('\n═══════════════════════════════════════════');

// --- 9. 各ステージ別ルート分布 ---
const r32_total = R.r32Morocco.w + R.r32Morocco.l + R.r32Brazil.w + R.r32Brazil.l;
console.log('\n【ルート分布 (R32進出者の内訳)】');
if (r32_total > 0) {
  console.log(`  1位ルート(vsモロッコ): ${((R.r32Morocco.w+R.r32Morocco.l)/r32_total*100).toFixed(1)}%`);
  console.log(`  2位ルート(vsブラジル): ${((R.r32Brazil.w +R.r32Brazil.l )/r32_total*100).toFixed(1)}%`);
}

console.log('\n完了。');
