#!/usr/bin/env node
/** 週次の外部脳レポート。読み取り専用で期限・次タスク・Go/No-goを統一する。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const json = process.argv.includes('--json');
const now = new Date();
const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
const iso = today.toISOString().slice(0, 10);
function git(...args) { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } }
function read(name) { try { return fs.readFileSync(path.join(ROOT, name), 'utf8'); } catch { return ''; } }
function dateValue(month, day) {
  const year = today.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.toISOString().slice(0, 10);
}

const open = [];
for (const line of read('BACKLOG.md').split('\n')) {
  const state = line.match(/^- \[([ ~])\] \*\*(.+?)\*\*/);
  if (!state) continue;
  const due = line.match(/期限=(\d{1,2})\/(\d{1,2})/);
  open.push({ state: state[1] === '~' ? '進行中' : '未着手', title: state[2], due: due ? dateValue(+due[1], +due[2]) : null, userOnly: /ユーザー専用/.test(line) });
}
const overdue = open.filter((x) => x.due && x.due < iso);
const next = [...open].sort((a, b) => (a.due || '9999-12-31').localeCompare(b.due || '9999-12-31')).slice(0, 3);
const commits = git('log', '--since=7 days ago', '--format=%h|%ad|%s', '--date=short').split('\n').filter(Boolean);
const trackedStatus = git('status', '--porcelain', '--untracked-files=no').split('\n').filter(Boolean);
const report = {
  generatedAt: new Date().toISOString(), today: iso, head: git('log', '-1', '--format=%h %s'), commitsLast7Days: commits,
  overdue, nextTasks: next,
  gates: { trackedWorktreeClean: trackedStatus.length === 0, overdueTask: overdue.length === 0, go: trackedStatus.length === 0 && overdue.length === 0, note: overdue.length ? '期限超過タスクあり。ユーザー専用タスクは自動実行せず、判断待ちとして報告する。' : '機械的な停止条件なし。通常開発を継続可能。' },
  verification: ['npm run release:source', 'npm run regression:full']
};
if (json) console.log(JSON.stringify(report, null, 2));
else {
  console.log('# Football-sim 週次外部脳レポート');
  console.log(`基準日: ${report.today} / HEAD: ${report.head}`);
  console.log(`\n## 判定: ${report.gates.go ? 'GO' : 'NO-GO'}\n${report.gates.note}`);
  console.log('\n## 直近7日間の完了コミット\n' + (commits.length ? commits.map((x) => `- ${x.replaceAll('|', ' / ')}`).join('\n') : '- なし'));
  console.log('\n## 期限超過\n' + (overdue.length ? overdue.map((x) => `- ${x.due} ${x.title}${x.userOnly ? '（ユーザー判断）' : ''}`).join('\n') : '- なし'));
  console.log('\n## 次週の最大3タスク\n' + (next.length ? next.map((x) => `- ${x.due || '期限未設定'} [${x.state}] ${x.title}${x.userOnly ? '（ユーザー判断）' : ''}`).join('\n') : '- なし'));
  console.log('\n## 検証入口\n' + report.verification.map((x) => `- ${x}`).join('\n'));
}
