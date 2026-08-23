/* MTG2: 監督ミッションの決定論・1日1試合境界テスト。 */
'use strict';
const fs = require('fs');
const vm = require('vm');

let current = {
  round: 0,
  season: 1,
  manager: {},
  lastResult: null
};
const context = {
  console,
  Date,
  window: { LANG: 'ja' },
  document: { createElement() { return { id: '', className: '', innerHTML: '', remove() {} }; }, body: { appendChild() {} }, getElementById() { return null; } }
};
context.window._leagueMissionHost = {
  state: () => current,
  save: () => { context.saved = (context.saved || 0) + 1; },
  today: () => '2026-08-24'
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/missions.js', 'utf8'), context);
const M = context.window.ManagerMissions;
function check(label, ok) {
  if (!ok) throw new Error('FAIL: ' + label);
  console.log('PASS:', label);
}

const first = M.summary();
check('daily mission exists', first.daily && first.daily.mission.target === 1);
check('weekly mission exists', first.weekly && first.weekly.mission.target > 1);
check('career starts at zero', first.career.matches === 0);

current.lastResult = { round: 0, mine: { res: 'W', ms: 2, os: 0 } };
const after = M.summary();
check('one match increments career once', after.career.matches === 1);
check('win and clean sheet are counted', after.career.wins === 1 && after.career.clean === 1 && after.career.goals === 2);
check('re-reading same result is idempotent', M.summary().career.matches === 1);

M.onPrepare(0);
M.onPrepare(0);
const prepSummary = M.summary();
check('preparation is counted', prepSummary.career.prepare === 2);
if (prepSummary.weeklyDef.kind === 'prepare') check('weekly preparation deduplicates same matchday', prepSummary.weekly.prepareRounds.length === 1);
check('legacy save receives only optional missions field', !!current.manager.missions);
console.log('manager missions tests passed');
