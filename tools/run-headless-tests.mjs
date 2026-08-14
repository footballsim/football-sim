#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDir = dirname(realpathSync(fileURLToPath(import.meta.url)));
const repoRoot = realpathSync(resolve(toolsDir, '..'));
const manifestPath = join(toolsDir, 'headless-test-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function fail(message) {
  console.error(`\n❌ test:all manifest error: ${message}`);
  process.exit(2);
}

function repoPath(input, label = 'path') {
  if (typeof input !== 'string') fail(`${label}は文字列で指定してください`);
  const absolute = resolve(repoRoot, input);
  if (absolute !== repoRoot && !absolute.startsWith(repoRoot + sep)) {
    fail(`repository外のpathは実行できません: ${input}`);
  }
  if (!existsSync(absolute)) fail(`${label}が見つかりません: ${input}`);
  let canonical;
  try {
    canonical = realpathSync(absolute);
  } catch (error) {
    fail(`${label}の実体pathを解決できません: ${input} (${error.message})`);
  }
  if (canonical !== repoRoot && !canonical.startsWith(repoRoot + sep)) {
    fail(`${label}の実体がrepository外です: ${input}`);
  }
  return canonical;
}

function walkFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

if (manifest.schemaVersion !== 1) fail(`未対応schemaVersion: ${manifest.schemaVersion}`);
if (!Array.isArray(manifest.discovery?.roots) ||
    !Array.isArray(manifest.discovery?.suffixes) ||
    !Array.isArray(manifest.discovery?.excludePrefixes)) {
  fail('discovery.roots / discovery.suffixes / discovery.excludePrefixes が必要です');
}
if (!Array.isArray(manifest.includes)) fail('includes が必要です');

const tests = new Map();
for (const root of manifest.discovery.roots) {
  const absoluteRoot = repoPath(root, 'discovery root');
  if (!statSync(absoluteRoot).isDirectory()) fail(`discovery rootがdirectoryではありません: ${root}`);
  for (const file of walkFiles(absoluteRoot)) {
    const key = relative(repoRoot, file).split(sep).join('/');
    if (manifest.discovery.excludePrefixes.some((prefix) => key.startsWith(prefix))) continue;
    if (!manifest.discovery.suffixes.some((suffix) => key.endsWith(suffix))) continue;
    tests.set(key, { file: key, args: [], source: 'auto' });
  }
}

for (const item of manifest.includes) {
  if (!item || typeof item.file !== 'string' || !Array.isArray(item.args)) {
    fail('includesの各項目にはfileとargs配列が必要です');
  }
  const absolute = repoPath(item.file, '明示include');
  if (!statSync(absolute).isFile()) fail(`明示includeが見つかりません: ${item.file}`);
  tests.set(item.file, { file: item.file, args: item.args.map(String), source: 'manifest' });
}

const ordered = [...tests.values()].sort((a, b) => a.file.localeCompare(b.file, 'en'));
if (ordered.length === 0) fail('実行対象が0件です');

console.log(`\nHeadless test gate: ${ordered.length} programs`);
console.log(`  auto-discovered: ${ordered.filter((test) => test.source === 'auto').length}`);
console.log(`  explicit checks: ${ordered.filter((test) => test.source === 'manifest').length}`);
console.log('  excluded: regression:full / soak / benchmark / browser / build / asset generation');
console.log('  note: エンジン・バランス変更時の統計判定は npm run regression:full を別に実行');

const startedAt = Date.now();
for (const [index, test] of ordered.entries()) {
  console.log(`\n[${index + 1}/${ordered.length}] ${test.file}${test.args.length ? ` ${test.args.join(' ')}` : ''}`);
  const result = spawnSync(process.execPath, [repoPath(test.file, '実行対象'), ...test.args], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    timeout: manifest.timeoutMs
  });
  if (result.error) {
    console.error(`\n❌ ${test.file}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n❌ ${test.file}: exit ${result.status ?? 'signal'}`);
    process.exit(result.status || 1);
  }
}

console.log(`\n✅ test:all PASS (${ordered.length} programs, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
