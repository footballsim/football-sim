/**
 * FN-01 本番用架空クラブ／選手表示名の契約テスト。
 * 内部ID・能力・システムを変えず、公開用メタデータだけを往復できることを保証する。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const LEAGUE_IDS = [
  'england2026', 'netherlands2026', 'spain2026', 'france2026',
  'argentina2026', 'italy2026', 'brazil2026', 'belgium2026'
];
const FORBIDDEN = [
  'fifa', 'world cup', 'ワールドカップ', 'w杯',
  'champions league', 'チャンピオンズリーグ'
];

function boot() {
  const storage = new Map();
  const context = {
    console, Math, Date, JSON, Object, Array, String, Number, Boolean,
    RegExp, Error, URLSearchParams, parseInt, parseFloat, isNaN, isFinite,
    setTimeout: function () { return 0; }, clearTimeout: function () {},
    localStorage: {
      getItem: function (key) { return storage.has(key) ? storage.get(key) : null; },
      setItem: function (key, value) { storage.set(key, String(value)); },
      removeItem: function (key) { storage.delete(key); }
    },
    location: { search: '', reload: function () {} },
    navigator: { language: 'ja' },
    document: {
      getElementById: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {}
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  const source = [
    fs.readFileSync(path.join(ROOT, 'js', 'players.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'js', 'names.js'), 'utf8'),
    'globalThis.__fn01 = { TEAM_DATA, NAMES };'
  ].join('\n');
  vm.runInContext(source, context, { filename: 'fn01-concat.js' });
  return { context, api: context.__fn01 };
}

let passed = 0;
function check(label, condition, detail) {
  if (!condition) throw new Error(label + (detail ? ' -> ' + detail : ''));
  passed++;
  console.log('  ✅ ' + label);
}
function snapshot(api) {
  const out = {};
  LEAGUE_IDS.forEach(function (id) {
    const td = api.TEAM_DATA[id];
    out[id] = {
      name: td.name,
      en_name: td.en_name,
      team_color: td.team_color,
      flag: td.flag,
      default_system: td.default_system,
      players: td.players.map(function (p) {
        return {
          long_name: p.long_name,
          name: p.name,
          en_name: p.en_name,
          params: JSON.stringify(p.params)
        };
      })
    };
  });
  return out;
}

console.log('FN-01: production fictional clubs and locale-aware player names');
const run = boot();
const api = run.api;
const before = snapshot(api);
const realTokens = new Set();
LEAGUE_IDS.forEach(function (id) {
  const row = before[id];
  [row.name, row.en_name].forEach(function (v) { if (v) realTokens.add(String(v).toLowerCase()); });
  row.players.forEach(function (p) {
    [p.long_name, p.name, p.en_name].forEach(function (v) { if (v) realTokens.add(String(v).toLowerCase()); });
  });
});

api.NAMES.setFiction(true, { persist: false, reload: false });
const fictionOne = snapshot(api);
const clubJa = [], clubEn = [], colors = [], crests = [];
const fullJa = [], fullEn = [];
const seenPlayerIds = new Set();
let leaked = [];

LEAGUE_IDS.forEach(function (id) {
  const td = api.TEAM_DATA[id];
  const original = before[id];
  const playerClub = api.NAMES._tables().PLAYER_CLUB;
  clubJa.push(td.name); clubEn.push(td.en_name); colors.push(td.team_color); crests.push(td.flag);
  check(id + ' のクラブ名が日英とも架空化', td.name !== original.name && td.en_name !== original.en_name);
  check(id + ' の色が架空化', td.team_color !== original.team_color && /^#[0-9A-F]{6}$/i.test(td.team_color));
  check(id + ' のcrestが国旗でない', td.flag !== original.flag && !/[\u{1F1E6}-\u{1F1FF}]/u.test(td.flag));
  let idsStable = true;
  let paramsStable = true;
  let shortNamesChanged = true;
  let localeAssigned = true;
  td.players.forEach(function (p, index) {
    const prev = original.players[index];
    idsStable = idsStable && p.long_name === prev.long_name;
    paramsStable = paramsStable && JSON.stringify(p.params) === prev.params;
    shortNamesChanged = shortNamesChanged && p.name !== prev.name && p.en_name !== prev.en_name;
    localeAssigned = localeAssigned && playerClub[p.long_name] === id;
    run.context.LANG = 'ja';
    const ja = api.NAMES.displayName(p.long_name, { full: true });
    run.context.LANG = 'en';
    const en = api.NAMES.displayName(p.long_name, { full: true });
    if (!seenPlayerIds.has(p.long_name)) {
      seenPlayerIds.add(p.long_name);
      fullJa.push(ja); fullEn.push(en);
    }
    [p.name, p.en_name, ja, en].forEach(function (value) {
      const normalized = String(value || '').toLowerCase();
      if (realTokens.has(normalized)) leaked.push(value);
      FORBIDDEN.forEach(function (word) {
        if (normalized.indexOf(word) >= 0) leaked.push(value);
      });
    });
  });
  check(id + ' の全long_name不変', idsStable);
  check(id + ' の全params不変', paramsStable);
  check(id + ' の全短縮名が架空化', shortNamesChanged);
  check(id + ' の全選手が該当地域プールへ割当', localeAssigned);
  check(id + ' default_system不変', td.default_system === original.default_system);
});

check('8クラブの日本語名が一意', new Set(clubJa).size === LEAGUE_IDS.length);
check('8クラブの英語名が一意', new Set(clubEn).size === LEAGUE_IDS.length);
check('8クラブの色が一意', new Set(colors).size === LEAGUE_IDS.length);
check('8クラブのcrestが一意', new Set(crests).size === LEAGUE_IDS.length);
function duplicates(values) {
  const seen = new Set();
  const dup = new Set();
  values.forEach(function (value) { if (seen.has(value)) dup.add(value); else seen.add(value); });
  return Array.from(dup);
}
check('全リーグ選手の日本語フルネームが一意', new Set(fullJa).size === fullJa.length, duplicates(fullJa).slice(0, 5).join(', '));
check('全リーグ選手の英語フルネームが一意', new Set(fullEn).size === fullEn.length, duplicates(fullEn).slice(0, 5).join(', '));
check('実名・禁止語の再利用なし', leaked.length === 0, leaked.slice(0, 5).join(', '));
const publicText = clubJa.concat(clubEn, fullJa, fullEn).join('\n');
check('auditTextでも実名トークン残留なし', api.NAMES.auditText(publicText).length === 0, api.NAMES.auditText(publicText).slice(0, 5).join(', '));

api.NAMES.setFiction(false, { persist: false, reload: false });
const afterOff = snapshot(api);
let restoreDetail = '';
LEAGUE_IDS.some(function (id) {
  if (JSON.stringify(afterOff[id]) === JSON.stringify(before[id])) return false;
  const topFields = ['name', 'en_name', 'team_color', 'flag', 'default_system'];
  for (let i = 0; i < topFields.length; i++) {
    const field = topFields[i];
    if (afterOff[id][field] !== before[id][field]) {
      restoreDetail = id + '.' + field + ': ' + before[id][field] + ' -> ' + afterOff[id][field];
      return true;
    }
  }
  for (let i = 0; i < before[id].players.length; i++) {
    if (JSON.stringify(afterOff[id].players[i]) !== JSON.stringify(before[id].players[i])) {
      restoreDetail = id + '.players[' + i + ']: before=' + JSON.stringify(before[id].players[i]) + ' after=' + JSON.stringify(afterOff[id].players[i]);
      return true;
    }
  }
  return true;
});
check('OFFでクラブ・選手表示メタデータが完全復帰', JSON.stringify(afterOff) === JSON.stringify(before), restoreDetail);
api.NAMES.setFiction(true, { persist: false, reload: false });
check('再ONでも同じ架空名・色・crestになる', JSON.stringify(snapshot(api)) === JSON.stringify(fictionOne));
const englandMeta = snapshot(api).england2026;
api.NAMES.registerNames({ clubs: { england2026: { name: 'テストクラブ', en_name: 'Test Club' } } });
check('部分registerNamesでも架空色を保持', api.TEAM_DATA.england2026.team_color === englandMeta.team_color);
check('部分registerNamesでも抽象crestを保持', api.TEAM_DATA.england2026.flag === englandMeta.flag);

console.log('\n✅ FN-01 ' + passed + '/' + passed + ' PASS');
