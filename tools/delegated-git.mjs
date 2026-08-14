#!/usr/bin/env node

import { existsSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDir = dirname(realpathSync(fileURLToPath(import.meta.url)));
const repoRoot = realpathSync(resolve(toolsDir, '..'));
const [operation, ...args] = process.argv.slice(2);

function fail(message) {
  console.error(`❌ delegated-git: ${message}`);
  process.exit(2);
}

function git(gitArgs, options = {}) {
  const result = spawnSync('git', gitArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (options.allowFailure) return result;
  if (result.error) fail(`gitを起動できません: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
  return options.capture ? result.stdout : '';
}

function branchName() {
  return git(['branch', '--show-current'], { capture: true }).trim();
}

function requireTrackedClean() {
  const status = git(['status', '--porcelain', '--untracked-files=no'], { capture: true });
  if (status.trim()) fail('追跡ファイルに未コミット差分があります');
}

function ensureInsideRepo(input, label) {
  if (!input || input.startsWith('-') || input === '.' || input === '..') {
    fail(`${label}は明示ファイルpathで指定してください: ${input || '(empty)'}`);
  }
  const absolute = resolve(repoRoot, input);
  if (absolute !== repoRoot && !absolute.startsWith(repoRoot + sep)) {
    fail(`${label}がrepository外です: ${input}`);
  }
  return { absolute, relativePath: relative(repoRoot, absolute).split(sep).join('/') };
}

function rejectProtectedPath(relativePath) {
  const normalized = relativePath.replace(/^\.\//, '');
  if (normalized === 'docs' || normalized.startsWith('docs/')) {
    fail(`docs/はstage禁止です: ${normalized}`);
  }
  if (normalized === 'dist-lab' || normalized.startsWith('dist-lab/')) {
    fail(`dist-lab/はstage禁止です: ${normalized}`);
  }
  if (/(^|\/)(\.env(?:\..*)?|\.dev\.vars(?:\..*)?|.*\.(?:pem|key|p12)|.*secret.*)$/i.test(normalized)) {
    fail(`秘密情報の可能性があるpathはstage禁止です: ${normalized}`);
  }
}

function stageFiles(files) {
  if (files.length === 0) fail('stage対象ファイルが必要です');
  const safe = files.map((input) => {
    const { absolute, relativePath } = ensureInsideRepo(input, 'stage対象');
    rejectProtectedPath(relativePath);
    if (existsSync(absolute)) {
      const canonical = realpathSync(absolute);
      if (canonical !== repoRoot && !canonical.startsWith(repoRoot + sep)) {
        fail(`stage対象の実体がrepository外です: ${input}`);
      }
      if (!statSync(absolute).isFile()) fail(`directoryの一括stageは禁止です: ${input}`);
    } else {
      const tracked = git(['ls-files', '--error-unmatch', '--', relativePath], {
        capture: true,
        allowFailure: true,
      });
      if (tracked.status !== 0) fail(`存在せず追跡済みでもないpathです: ${input}`);
    }
    return relativePath;
  });
  git(['add', '--', ...safe]);
}

function commitTask(commitArgs) {
  if (commitArgs.length !== 1 || !commitArgs[0].trim() || commitArgs[0].includes('\n')) {
    fail('commit messageを改行なしの1引数で指定してください');
  }
  const stagedRaw = git(['diff', '--cached', '--name-only', '-z'], { capture: true });
  const staged = stagedRaw.split('\0').filter(Boolean);
  if (staged.length === 0) fail('staged差分がありません');
  for (const file of staged) rejectProtectedPath(file);
  const check = git(['diff', '--cached', '--check'], { allowFailure: true });
  if (check.status !== 0) fail('git diff --cached --checkが失敗しました');
  git(['commit', '-m', commitArgs[0]]);
}

function mergeTask(mergeArgs) {
  if (mergeArgs.length !== 1) fail('統合対象のcodex/ブランチを1つ指定してください');
  const target = mergeArgs[0];
  if (!/^codex\/[a-z0-9][a-z0-9._\/-]*$/.test(target) || target.includes('..') || target.includes('//')) {
    fail(`codex/ task branch以外は統合できません: ${target}`);
  }
  if (branchName() !== 'game-main') fail('delegated mergeはgame-mainでのみ実行できます');
  requireTrackedClean();
  const exists = git(['show-ref', '--verify', '--quiet', `refs/heads/${target}`], { allowFailure: true });
  if (exists.status !== 0) fail(`local branchが見つかりません: ${target}`);
  git(['merge', '--no-edit', '--no-stat', target]);
}

function pushGameMain(pushArgs) {
  if (pushArgs.length !== 0) fail('delegated pushは追加引数を受け付けません');
  if (branchName() !== 'game-main') fail('delegated pushはgame-mainでのみ実行できます');
  requireTrackedClean();
  const remoteUrl = git(['remote', 'get-url', 'origin'], { capture: true }).trim();
  if (!/^(?:git@github\.com:|https:\/\/github\.com\/)footballsim\/football-sim(?:\.git)?$/.test(remoteUrl)) {
    fail(`許可されていないoriginです: ${remoteUrl}`);
  }
  const remoteRef = git(['show-ref', '--verify', '--quiet', 'refs/remotes/origin/game-main'], {
    allowFailure: true,
  });
  if (remoteRef.status !== 0) fail('origin/game-mainが見つかりません');
  const ff = git(['merge-base', '--is-ancestor', 'origin/game-main', 'HEAD'], { allowFailure: true });
  if (ff.status !== 0) fail('origin/game-mainからfast-forwardできないためpushを停止します');
  git(['push', 'origin', 'HEAD:refs/heads/game-main']);
}

function createWorktree(worktreeArgs) {
  if (worktreeArgs.length !== 2) fail('task-idとslugを指定してください');
  const [taskIdRaw, slug] = worktreeArgs;
  const taskId = taskIdRaw.toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(taskId) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    fail('task-id/slugは小文字英数字と単一ハイフンだけを使用してください');
  }
  if (branchName() !== 'game-main') fail('worktree作成はgame-mainからのみ実行できます');
  requireTrackedClean();
  const worktreePath = `/private/tmp/football-sim-${taskId}`;
  const taskBranch = `codex/${taskId}-${slug}`;
  if (existsSync(worktreePath)) fail(`worktree pathが既に存在します: ${worktreePath}`);
  const branchExists = git(['show-ref', '--verify', '--quiet', `refs/heads/${taskBranch}`], {
    allowFailure: true,
  });
  if (branchExists.status === 0) fail(`branchが既に存在します: ${taskBranch}`);
  git(['worktree', 'add', '-b', taskBranch, worktreePath, 'game-main']);
}

function restoreDocs(restoreArgs) {
  if (restoreArgs.length !== 0) fail('restore-docsは追加引数を受け付けません');
  const current = branchName();
  if (current !== 'integ/lab' && current !== 'game-main' && !current.startsWith('codex/')) {
    fail(`許可されていないbranchです: ${current}`);
  }
  git(['restore', '--source=HEAD', '--worktree', '--', 'docs/']);
}

switch (operation) {
  case 'worktree': createWorktree(args); break;
  case 'stage': stageFiles(args); break;
  case 'commit': commitTask(args); break;
  case 'merge': mergeTask(args); break;
  case 'push': pushGameMain(args); break;
  case 'restore-docs': restoreDocs(args); break;
  default: fail(`未知のoperationです: ${operation || '(empty)'}`);
}
