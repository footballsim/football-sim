#!/usr/bin/env node
/** 外部脳へ渡すための短く決定論的なプロジェクト現況スナップショット。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const asJson = process.argv.includes('--json');
function git(...args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return ''; }
}
function read(name) {
  try { return fs.readFileSync(path.join(ROOT, name), 'utf8'); } catch { return ''; }
}
function selected(name, re, limit) {
  return read(name).split('\n').filter((line) => re.test(line)).slice(0, limit);
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  project: 'football-sim / kantoku-lab',
  branch: git('branch', '--show-current'),
  head: git('log', '-1', '--format=%h %s'),
  status: git('status', '--short').split('\n').filter(Boolean).slice(0, 12),
  openBacklog: selected('BACKLOG.md', /^- \[ \]|^- \[~\]/, 12),
  recentDecisions: selected('DECISIONS.md', /^## |^- \*\*決定|^- \*\*実装|^- \*\*運用/, 18),
  nextRead: ['AGENTS.md', 'CODEX_HANDOFF.md', 'SCOPE.md', 'BACKLOG.md', 'DECISIONS.md'],
  commands: { sourceGate: 'npm run release:source', regression: 'npm run regression:full', deploy: 'npm run deploy:lab' }
};

if (asJson) {
  console.log(JSON.stringify(snapshot, null, 2));
} else {
  console.log('# Football-sim 外部脳スナップショット');
  console.log(`生成: ${snapshot.generatedAt}`);
  console.log(`ブランチ: ${snapshot.branch || '(取得不可)'}`);
  console.log(`HEAD: ${snapshot.head || '(取得不可)'}`);
  console.log('\n## 未完了バックログ（最大12件）\n' + (snapshot.openBacklog.join('\n') || 'なし'));
  console.log('\n## 最近の意思決定\n' + (snapshot.recentDecisions.join('\n') || 'DECISIONS.mdを確認'));
  console.log('\n## 次回の最小読込\n' + snapshot.nextRead.map((x) => `- ${x}`).join('\n'));
  console.log('\n## 検証入口\n- ' + Object.values(snapshot.commands).join('\n- '));
}
