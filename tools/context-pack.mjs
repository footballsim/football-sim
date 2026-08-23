#!/usr/bin/env node
/** テーマ別に必要なファイルだけを、文字数上限付きで出力する。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const focus = (process.argv.find((x) => x.startsWith('--focus=')) || '--focus=general').slice(8);
const rawBudget = Number((process.argv.find((x) => x.startsWith('--budget=')) || '--budget=18000').slice(9));
const budget = Number.isFinite(rawBudget) && rawBudget > 1000 ? rawBudget : 18000;
const common = ['AGENTS.md', 'CODEX_HANDOFF.md', 'SCOPE.md', 'BACKLOG.md', 'DECISIONS.md'];
const focusFiles = { missions: ['js/missions.js', 'tools/manager-missions-test.js'], release: ['package.json', 'build.js', 'tools/deploy-guard.js'], ui: ['DESIGN_SYSTEM.md', 'css/league-ui.css'] };
const files = [...common, ...(focusFiles[focus] || [])];
let used = 0;
console.log(`# Football-sim context pack: ${focus}\n文字数上限: ${budget}`);
for (const name of files) {
  let content = '';
  try { content = fs.readFileSync(path.join(ROOT, name), 'utf8'); } catch { continue; }
  const remaining = budget - used;
  if (remaining <= 0) break;
  const clipped = content.slice(0, remaining);
  console.log(`\n--- ${name} ---\n${clipped}`);
  used += clipped.length;
  if (clipped.length < content.length) { console.log(`\n[${name} は上限到達のため省略]`); break; }
}
