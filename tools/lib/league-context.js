/**
 * league-context.js — league.js（lab限定・<script>前提）を Node で動かす共通コンテキスト。
 *
 * tools/lib/load-engine.js の DOM スタブ作法を league.js まで広げたもの。
 * localStorage だけは本物同然の実体を持たせる（セーブの読み書きを検証するため）。
 * 利用側: const { L, TEAM_DATA, ls, ctx } = require('./lib/league-context.js').makeLeagueContext();
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { ROOT, JS_FILES } = require('./load-engine.js');

const STUB = `
class URLSearchParams{constructor(s){}get(k){return null;}}
const _elStub={textContent:"",innerHTML:"",value:"",style:{},dataset:{},classList:{add:()=>{},remove:()=>{},toggle:()=>{},contains:()=>false},appendChild:()=>{},removeChild:()=>{},setAttribute:()=>{},getAttribute:()=>null,addEventListener:()=>{},querySelector:()=>null,querySelectorAll:()=>[],getContext:()=>null,focus:()=>{},remove:()=>{}};
const document={getElementById:()=>(_elStub),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>(Object.assign({},_elStub)),createElementNS:()=>(Object.assign({},_elStub)),body:{appendChild:()=>{},classList:{add:()=>{},remove:()=>{}}},documentElement:{style:{},classList:{add:()=>{},remove:()=>{}}},addEventListener:()=>{},head:{appendChild:()=>{}}};
const _lsData={};
const localStorage={getItem:(k)=>(k in _lsData? _lsData[k]:null),setItem:(k,v)=>{_lsData[k]=String(v);},removeItem:(k)=>{delete _lsData[k];},_dump:()=>_lsData};
const sessionStorage={getItem:()=>null,setItem:()=>{}};
const window={addEventListener:()=>{},location:{hash:"",search:""},matchMedia:()=>({matches:false,addEventListener:()=>{}}),navigator:{language:"ja"},localStorage:localStorage};
const navigator={language:"ja"};
const firebase={initializeApp:()=>{},firestore:()=>({collection:()=>({doc:()=>({get:()=>Promise.resolve({exists:false,data:()=>({})}),set:()=>Promise.resolve(),update:()=>Promise.resolve()})})})};
const gtag=()=>{};
const alert=()=>{};
const confirm=()=>true;
function showScreen(){}
function showWCStats(){}
function startManagerMatch(){}
`;

function makeLeagueContext() {
  let code = STUB + '\n';
  for (const f of JS_FILES) code += fs.readFileSync(path.join(ROOT, 'js', f), 'utf8') + '\n';
  code += fs.readFileSync(path.join(ROOT, 'js', 'league.js'), 'utf8') + '\n';

  const ctx = vm.createContext({
    Math, console, parseInt, parseFloat, isNaN, isFinite,
    setTimeout: (fn) => fn(), clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    Promise, JSON, Object, Array, String, Number, Boolean, Date, RegExp, Error, require, __dirname: ROOT,
  });
  vm.runInContext(code, ctx, { filename: 'league-concat.js' });

  const api = vm.runInContext('({ L: window._leagueTestAPI, TEAM_DATA: TEAM_DATA, ls: localStorage, win: window })', ctx);
  return { ctx: ctx, L: api.L, TEAM_DATA: api.TEAM_DATA, ls: api.ls, win: api.win, LS_KEY: 'fs_league_v1' };
}

module.exports = { makeLeagueContext };
