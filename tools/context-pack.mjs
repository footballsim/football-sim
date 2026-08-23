#!/usr/bin/env node
/** テーマ別に必要なセクションを優先し、文字数上限付きで出力する。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const focus = (process.argv.find((x) => x.startsWith('--focus=')) || '--focus=general').slice(8);
const rawBudget = Number((process.argv.find((x) => x.startsWith('--budget=')) || '--budget=12000').slice(9));
const budget = Number.isFinite(rawBudget) && rawBudget > 1000 ? rawBudget : 12000;
const focusFiles = {
  missions: ['js/missions.js', 'tools/manager-missions-test.js'],
  release: ['package.json', 'build.js', 'tools/deploy-guard.js'],
  ui: ['DESIGN_SYSTEM.md', 'css/league-ui.css']
};
const baseRules = {
  'AGENTS.md': [/^## 絶対ガードレール/, /^## 検証ゲート/, /^## チームの記憶/],
  'CODEX_HANDOFF.md': [/^## 0\./, /^## 2-/, /^## 3\./, /^## 6\./],
  'SCOPE.md': [/^# /, /^## /],
  'BACKLOG.md': [/^## 2026-08-14 現在地/, /^## 自走開発基盤/],
  'DECISIONS.md': [/^## /]
};
const files = ['AGENTS.md', 'CODEX_HANDOFF.md', 'SCOPE.md', 'BACKLOG.md', 'DECISIONS.md', ...(focusFiles[focus] || [])];
const always = /^(?:- \[[ ~]\]|- \*\*AUTO-|\*\*実装境界|\*\*未完了ゲート|\*\*決定|\*\*Go\/No-go)/;
let used = 0;

function read(name) { try { return fs.readFileSync(path.join(ROOT, name), 'utf8'); } catch { return ''; } }
function compact(name, content) {
  const wanted = baseRules[name] || [];
  const source = content.split('\n');
  const picked = [];
  let keep = false;
  let keepLevel = 0;
  for (const line of source) {
    const heading = line.match(/^(#{1,3}) /);
    if (heading) {
      const level = heading[1].length;
      if (keep && level <= keepLevel) keep = false;
      const match = wanted.find((re) => re.test(line));
      if (match) { keep = true; keepLevel = level; }
    }
    if (keep || always.test(line)) picked.push(line);
  }
  return picked.join('\n').replace(/\n{3,}/g, '\n\n');
}

console.log(`# Football-sim context pack: ${focus}\n文字数上限: ${budget}\n抽出方式: セクション優先（先頭切捨てではない）`);
for (const name of files) {
  const content = read(name);
  if (!content) continue;
  const remaining = budget - used;
  if (remaining <= 0) break;
  const selected = compact(name, content);
  const clipped = selected.slice(0, remaining);
  console.log(`\n--- ${name} ---\n${clipped}`);
  used += clipped.length;
  if (clipped.length < selected.length) { console.log(`\n[${name} は上限到達のため省略]`); break; }
}
