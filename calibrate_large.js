#!/usr/bin/env node
/**
 * calibrate_large.js
 * 大量試合で「真の勝率」を計測し、CAL=50 との分散比較を行う
 */
const fs = require('fs');
const vm = require('vm');

const HTML_PATH = __dirname + '/index.html';
const html = fs.readFileSync(HTML_PATH, 'utf8');
const lines = html.split('\n');
const START_LINE = 2282;
const END_LINE = lines.findIndex((l, i) => i > START_LINE && l.trim() === '</script>');
const jsCode = lines.slice(START_LINE, END_LINE).join('\n');

const stub = `
class URLSearchParams{constructor(s){}get(k){return null;}}
const document={getElementById:()=>({textContent:"",style:{},value:"",classList:{add:()=>{},remove:()=>{}}}),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild:()=>{},setAttribute:()=>{}}),body:{appendChild:()=>{}},addEventListener:()=>{}};
const window={addEventListener:()=>{},location:{hash:"",search:""}};
const navigator={language:"ja"};
const localStorage={getItem:()=>null,setItem:()=>{}};
const firebase={initializeApp:()=>{},firestore:()=>({collection:()=>({doc:()=>({get:()=>Promise.resolve({exists:false,data:()=>({})})})})})};
const gtag=()=>{};
function t(k){return k;}
function showScreen(){}
`;

const ctx = vm.createContext({
  Math, console, parseInt, parseFloat, isNaN, isFinite,
  setTimeout: (fn) => fn(), clearTimeout: () => {},
  setInterval: () => 0, clearInterval: () => {},
  Promise, JSON, Object, Array, String, Number, Boolean, Date, RegExp, Error,
  require, __dirname,
});
vm.runInContext(stub + '\n' + jsCode, ctx);

const td = vm.runInContext('TEAM_DATA', ctx);
const JP = td.japan2026vsNetherlands;

const simulateSilent = ctx.simulateSilent.bind(ctx);

const bigRun = (t1, t2, n) => {
  let w = 0, d = 0, l = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateSilent(t1, t2);
    if (r.t1score > r.t2score) w++;
    else if (r.t1score === r.t2score) d++;
    else l++;
  }
  return { w: w / n, d: d / n, l: l / n };
};

const N = 500;
console.log(`\n大量キャリブレーション (N=${N}試合/対戦)...\n`);

const jpMatchups = [
  ['jp_nl', 'vsオランダ      ', JP, td.netherlands2026],
  ['jp_tn', 'vsチュニジア    ', JP, td.tunisia2026],
  ['jp_sw', 'vsスウェーデン  ', JP, td.sweden2026],
  ['jp_mo', 'vsモロッコ      ', JP, td.morocco2026],
  ['jp_br', 'vsブラジル      ', JP, td.brazil2026],
  ['jp_mx', 'vsメキシコ      ', JP, td.mexico2026],
  ['jp_no', 'vsノルウェー    ', JP, td.norway2026],
  ['jp_fr', 'vsフランス      ', JP, td.france2026],
  ['jp_en', 'vsイングランド  ', JP, td.england2026],
  ['jp_sp', 'vsスペイン      ', JP, td.spain2026],
  ['jp_ar', 'vsアルゼンチン  ', JP, td.argentina2026],
];
const nonJpMatchups = [
  ['nl_tn', 'NLvsチュニジア  ', td.netherlands2026, td.tunisia2026],
  ['nl_sw', 'NLvsスウェーデン', td.netherlands2026, td.sweden2026],
  ['tn_sw', 'TNvsスウェーデン', td.tunisia2026,     td.sweden2026],
];

const results = {};
for (const [key, label, t1, t2] of [...jpMatchups, ...nonJpMatchups]) {
  const r = bigRun(t1, t2, N);
  results[key] = r;
  const w = (r.w * 100).toFixed(1).padStart(4);
  const d_ = (r.d * 100).toFixed(1).padStart(4);
  const l = (r.l * 100).toFixed(1).padStart(4);
  console.log(`  ${label}: 勝${w}% 分${d_}% 負${l}%`);
}

// グループステージの期待突破率をこの勝率で計算（10000試合シミュ）
console.log('\n\n── この勝率で10000回グループステージシミュ ──');

const NGRP = 10000;
let q1st = 0, q2nd = 0, qFail = 0;
const mcSim = (r) => {
  const v = Math.random();
  if (v < r.w) return 1;
  if (v < r.w + r.d) return 0;
  return -1;
};
for (let i = 0; i < NGRP; i++) {
  const pts = [0, 0, 0, 0];
  const rec = (a, b, res) => {
    if (res > 0) pts[a] += 3; else if (res === 0) { pts[a]++; pts[b]++; } else pts[b] += 3;
    return res;
  };
  rec(0, 1, mcSim(results.jp_nl));
  rec(0, 2, mcSim(results.jp_tn));
  rec(0, 3, mcSim(results.jp_sw));
  rec(1, 2, mcSim(results.nl_tn));
  rec(1, 3, mcSim(results.nl_sw));
  rec(2, 3, mcSim(results.tn_sw));
  let rank = 1;
  for (let j = 1; j < 4; j++) {
    if (pts[j] > pts[0] || (pts[j] === pts[0] && Math.random() < 0.5)) rank++;
  }
  if (rank > 2) qFail++;
  else if (rank === 1) q1st++;
  else q2nd++;
}
console.log(`  1位通過: ${(q1st/NGRP*100).toFixed(1)}%`);
console.log(`  2位通過: ${(q2nd/NGRP*100).toFixed(1)}%`);
console.log(`  突破計 : ${((q1st+q2nd)/NGRP*100).toFixed(1)}%`);
console.log(`  (脱落  : ${(qFail/NGRP*100).toFixed(1)}%)`);

// CAL=50の分散シミュレーション（100回繰り返してブレ幅を確認）
console.log('\n── CAL=50 vs CAL=200 の分散比較（各20回の1位通過率） ──');

for (const CAL of [50, 200]) {
  const q1rates = [];
  for (let trial = 0; trial < 20; trial++) {
    const run = (t1, t2) => {
      let w=0,d=0,l=0;
      for(let k=0;k<CAL;k++){
        const r=simulateSilent(t1,t2);
        if(r.t1score>r.t2score)w++;
        else if(r.t1score===r.t2score)d++;
        else l++;
      }
      return {w:w/CAL,d:d/CAL,l:l/CAL};
    };
    const rt = {
      jp_nl: run(JP, td.netherlands2026),
      jp_tn: run(JP, td.tunisia2026),
      jp_sw: run(JP, td.sweden2026),
      nl_tn: run(td.netherlands2026, td.tunisia2026),
      nl_sw: run(td.netherlands2026, td.sweden2026),
      tn_sw: run(td.tunisia2026, td.sweden2026),
    };
    let _q1=0, total=1000;
    for(let i=0;i<total;i++){
      const pts=[0,0,0,0];
      const rec2=(a,b,res)=>{if(res>0)pts[a]+=3;else if(res===0){pts[a]++;pts[b]++;}else pts[b]+=3;};
      rec2(0,1,mcSim(rt.jp_nl));rec2(0,2,mcSim(rt.jp_tn));rec2(0,3,mcSim(rt.jp_sw));
      rec2(1,2,mcSim(rt.nl_tn));rec2(1,3,mcSim(rt.nl_sw));rec2(2,3,mcSim(rt.tn_sw));
      let rank=1;
      for(let j=1;j<4;j++) if(pts[j]>pts[0]||(pts[j]===pts[0]&&Math.random()<0.5)) rank++;
      if(rank===1) _q1++;
    }
    q1rates.push((_q1/total*100).toFixed(1));
  }
  const min = Math.min(...q1rates.map(Number)).toFixed(1);
  const max = Math.max(...q1rates.map(Number)).toFixed(1);
  const avg = (q1rates.reduce((a,b)=>a+Number(b),0)/q1rates.length).toFixed(1);
  console.log(`  CAL=${CAL}: 1位通過率の範囲 ${min}%〜${max}% (平均${avg}%)  [${q1rates.join(', ')}]`);
}
