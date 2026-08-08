#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * deploy-guard — kantoku-lab へ出す前に「相手の成果を消さないか」を機械判定する
 *
 * なぜ要るか（2026-08-05〜06 に3往復の事故）:
 *   `wrangler pages deploy dist-lab` は**ディレクトリ丸ごとのスナップショット**を公開する。
 *   ファイル単位のマージではないので、**自分のブランチに入っていないものは消える**。
 *   しかも消えても手元のビルドは通り回帰も緑なので、デプロイ側の検証では絶対に気づけない。
 *   （気づけたのは「出したはずの版と違う ?v= が返ってきた」偶然だけだった）
 *
 * 判定はこれだけ:
 *   直前 Production の Source コミット が 自分の HEAD の祖先か？
 *     祖先     → 自分は相手を含んでいる  → 出してよい（exit 0）
 *     祖先でない → 相手の成果を消す        → 止める（exit 1・先に merge しろと出す）
 *
 * 使い方:
 *   node tools/deploy-guard.js              # 判定だけ
 *   npm run deploy:lab                      # 判定 → 通ったら wrangler で本番へ
 *   node tools/deploy-guard.js --project=xx # 別プロジェクトを見る
 *
 * ★ fail-safe: 判定できない時（wrangler が失敗した／Source が手元に無いコミット）は
 *   「安全」ではなく **止める**。分からないまま出すのが一番危ない。
 *   どうしても出したい時だけ ALLOW_UNSAFE_DEPLOY=1 を付ける（理由を残すこと）。
 * ══════════════════════════════════════════════════════════════════════════ */
'use strict';
const { execSync, spawnSync } = require('child_process');

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const hit = args.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const PROJECT = argOf('project', 'kantoku-lab');
const NPM_CACHE = process.env.DEPLOY_GUARD_NPM_CACHE || '';

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m' };
const say = (s) => process.stdout.write(s + '\n');
const die = (msg) => {
  say('');
  say(C.r + '✋ デプロイを中止しました' + C.x);
  say(msg);
  say('');
  say(C.d + '  どうしても出す場合のみ: ALLOW_UNSAFE_DEPLOY=1 npm run deploy:lab' + C.x);
  process.exit(1);
};

function git(cmd) {
  return execSync('git ' + cmd, { encoding: 'utf8' }).trim();
}

/* 直前の Production デプロイの Source コミットを取る。
 *   wrangler の出力は罫線テーブル。'│' 区切りで Environment 列と Source 列を読む。 */
function latestProductionSource() {
  const env = Object.assign({}, process.env);
  if (NPM_CACHE) env.npm_config_cache = NPM_CACHE;
  const r = spawnSync('npx', ['--yes', 'wrangler@4', 'pages', 'deployment', 'list', '--project-name=' + PROJECT],
    { encoding: 'utf8', env, timeout: 180000 });
  if (r.status !== 0) return { err: (r.stderr || r.stdout || 'wrangler failed').trim().split('\n').slice(-3).join('\n') };
  for (const line of (r.stdout || '').split('\n')) {
    if (!line.includes('│')) continue;
    const col = line.split('│').map(s => s.trim());
    // [ '', Id, Environment, Branch, Source, Deployment, Status, Build, '' ]
    if (col[2] !== 'Production') continue;
    const src = col[4];
    if (src && /^[0-9a-f]{7,40}$/.test(src)) return { src, branch: col[3], id: col[1], when: col[6] };
  }
  return { err: 'Production の行を読めませんでした（wrangler の出力形式が変わった可能性）' };
}

const HEAD = git('rev-parse HEAD');
const HEAD_SHORT = HEAD.slice(0, 7);
const BRANCH = git('rev-parse --abbrev-ref HEAD');

say(C.d + `プロジェクト ${PROJECT} / 手元 ${BRANCH} @ ${HEAD_SHORT}` + C.x);

if (process.env.ALLOW_UNSAFE_DEPLOY === '1') {
  say(C.y + '⚠️  ALLOW_UNSAFE_DEPLOY=1 が指定されています。判定をスキップします。' + C.x);
  process.exit(0);
}

const prod = latestProductionSource();
if (prod.err) die('  直前 Production を取得できませんでした:\n  ' + C.d + prod.err + C.x);

say(C.d + `直前 Production: ${prod.src} (branch=${prod.branch}, ${prod.when})` + C.x);

// Source コミットが手元に無い＝別のリポジトリ/未取得のブランチから出されている
try { git('cat-file -e ' + prod.src + '^{commit}'); }
catch (e) {
  die(`  直前 Production の Source ${C.y}${prod.src}${C.x} が手元のリポジトリに存在しません。\n` +
      '  別ツリーから出された可能性があります。取り込んでから再実行してください。');
}

const isAncestor = spawnSync('git', ['merge-base', '--is-ancestor', prod.src, HEAD]).status === 0;

if (!isAncestor) {
  const missing = git(`log --oneline ${HEAD}..${prod.src}`).split('\n').filter(Boolean);
  die(`  直前 Production (${C.y}${prod.src}${C.x}) は手元の HEAD の祖先ではありません。\n` +
      `  このまま出すと、下の ${missing.length} コミット分が本番から消えます:\n` +
      missing.map(l => '    ' + C.y + l + C.x).join('\n') + '\n\n' +
      `  先に取り込んでください:\n    ${C.g}git merge ${prod.src}${C.x}`);
}

say(C.g + `✅ 直前 Production は HEAD の祖先です＝何も消しません。` + C.x);

// おまけ: dist-lab が今のソースより古いと「検証した版と違うものを出す」事故になる
try {
  const stale = execSync(
    "find js css img index.html build.js -type f -newer dist-lab/index.html 2>/dev/null | head -5",
    { encoding: 'utf8' }).trim();
  if (stale) {
    say(C.y + '⚠️  dist-lab がソースより古いようです（npm run build を忘れていませんか）:' + C.x);
    stale.split('\n').forEach(f => say(C.d + '    ' + f + C.x));
  }
} catch (e) { /* dist-lab 未生成なら無視 */ }
process.exit(0);
