#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * docs-guard — docs/ に差分が積もっていないかを機械判定する
 *
 * なぜ要るか（2026-08-13 Codex 主体制への引き継ぎで新設）:
 *   docs/ は難読化済みビルド成果物（本番 football-sim.com 向け・2026-07-03 から凍結中）。
 *   規約は「手編集禁止・再生成差分はコミットしない」だが、これまで機械的に止めていたのは
 *   Claude Code のフック＝**Codex や素の git 操作には効かない**。ツール非依存の門番として
 *   npm スクリプトに置く（`npm run check:docs` 単体／`npm run deploy:lab` の先頭で実行）。
 *
 * 判定:
 *   git 管理下の docs/ に変更（M/D/ステージ済み含む）がある → exit 1（`git restore docs/` を案内）
 *   未追跡ファイル（build が img/ から複製した画像等）は**対象外**＝本番 push 再開時にまとめてコミットする分。
 * ══════════════════════════════════════════════════════════════════════════ */
'use strict';
const { execSync } = require('child_process');

const out = execSync('git status --porcelain -- docs/', { encoding: 'utf8' });
const dirty = out.split('\n').filter(l => l.trim() && !l.startsWith('??'));

if (dirty.length === 0) {
  console.log('✅ docs/ はクリーン（追跡ファイルに差分なし）');
  process.exit(0);
}

console.error('\x1b[31m✋ docs/ の追跡ファイルに差分があります（' + dirty.length + '件）\x1b[0m');
console.error(dirty.slice(0, 10).join('\n') + (dirty.length > 10 ? `\n  …他 ${dirty.length - 10} 件` : ''));
console.error('');
console.error('docs/ は build 成果物で、本番(football-sim.com)は凍結中です。');
console.error('  ・手で編集した場合   → 変更は root の js/ / index.html / css/ に移してから:');
console.error('  ・build の副産物の場合 → そのまま:');
console.error('      git restore docs/');
process.exit(1);
