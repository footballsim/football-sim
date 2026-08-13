/**
 * FN-00 表示名インダイレクション層の headless 検証。
 *
 * 保証する契約:
 *   - long_name（v4 セーブの選手キー）は実名/架空名の切替中も不変
 *   - 短縮名とフルネームは日本語/英語の両方で表示名層を通る
 *   - OFF に戻すと表示用フィールドだけが実名へ復帰する
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const storage = new Map();
const context = {
  console,
  Math,
  Date,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Error,
  URLSearchParams,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  setTimeout: function () { return 0; },
  clearTimeout: function () {},
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
  'globalThis.__fn00 = { TEAM_DATA, getPlayerName, getPlayerDisplayName, getTeamName, NAMES };'
].join('\n');
vm.runInContext(source, context, { filename: 'fn00-concat.js' });

const api = context.__fn00;
const team = api.TEAM_DATA.japan2026vsNetherlands;
const player = team.players[0];
const allPlayers = [];
Object.keys(api.TEAM_DATA).forEach(function (teamKey) {
  (api.TEAM_DATA[teamKey].players || []).forEach(function (p) {
    allPlayers.push({ player: p, id: p.long_name || p.name });
  });
});
const real = {
  teamJa: team.name,
  teamEn: team.en_name,
  shortJa: player.name,
  shortEn: player.en_name,
  id: player.long_name
};

let passed = 0;
function check(label, condition, detail) {
  if (!condition) {
    throw new Error(label + (detail ? ' -> ' + detail : ''));
  }
  passed++;
  console.log('  ✅ ' + label);
}

console.log('FN-00: internal ID and bilingual display names');
check('初期値は実名モード', api.NAMES.isFiction() === false);
check('初期の選手キーは long_name', api.NAMES.playerId(player) === real.id);

api.NAMES.setFiction(true, { persist: false, reload: false });
const fiction = api.NAMES.display(real.id);
check('架空名モードに切り替わる', api.NAMES.isFiction() === true);
check('long_name は切替後も不変', player.long_name === real.id, player.long_name);
check('全選手の long_name が切替後も不変', allPlayers.every(function (row) {
  return row.player.long_name === row.id;
}));
check('全選手の内部IDを切替後も逆引きできる', allPlayers.every(function (row) {
  return api.NAMES.playerId(row.player) === row.id;
}));
check('選手キーは切替後も不変', api.NAMES.playerId(player) === real.id);
check('日本語短縮名はマッピング経由', (context.LANG = 'ja', api.getPlayerName(player)) === fiction.name);
check('日本語フルネームはマッピング経由', api.getPlayerDisplayName(player) === fiction.long_name);
check('英語短縮名はマッピング経由', (context.LANG = 'en', api.getPlayerName(player)) === fiction.en_name);
check('英語フルネームはマッピング経由', api.getPlayerDisplayName(player) === fiction.en_long_name);
check('英語クラブ名もマッピング経由', api.getTeamName(team) === api.NAMES._tables().FICT.clubs.japan2026vsNetherlands.en_name);

api.NAMES.setFiction(false, { persist: false, reload: false });
check('OFF 後も long_name は不変', player.long_name === real.id);
check('OFF 後の日本語短縮名が復帰', (context.LANG = 'ja', api.getPlayerName(player)) === real.shortJa);
check('OFF 後の英語短縮名が復帰', (context.LANG = 'en', api.getPlayerName(player)) === real.shortEn);
check('OFF 後の日本語クラブ名が復帰', (context.LANG = 'ja', api.getTeamName(team)) === real.teamJa);
check('OFF 後の英語クラブ名が復帰', (context.LANG = 'en', api.getTeamName(team)) === real.teamEn);

console.log('\n✅ FN-00 ' + passed + '/' + passed + ' PASS');
