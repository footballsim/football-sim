#!/usr/bin/env node
/**
 * build.js — 配信用 docs/ を生成する
 *
 * - js/*.js を javascript-obfuscator で難読化して docs/js/ へ出力
 *     リポジトリの js/ は「可読のソース＝編集・デバッグ用」。docs/js/ は「難読化済み成果物」。
 *     ・players.js … データ主体（巨大な base64 画像を含む）→ 最小化のみ（stringArray無効＝画像を再エンコードして肥大化させない）
 *     ・その他（試合エンジン）→ 最小化＋軽い難読化（ローカル識別子のリネーム＋文字列の base64 配列化）
 * - index.html / css/ / img/ を docs/ へ複製。js・css の ?v= をビルド版数へ自動更新（キャッシュバスティング）
 * - docs/CNAME（カスタムドメイン）を維持
 *
 * 使い方: npm run build
 *
 * ⚠️ docs/ は成果物なので手で編集しない。必ず root の js/ を直して再ビルドすること。
 *    （renameGlobals:false は HTML の onclick や他ファイルから呼ばれるグローバル名を保持するため必須）
 */
const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT = __dirname;
const DOCS = path.join(ROOT, 'docs');
const LAB = path.join(ROOT, 'dist-lab');   // 非公開のデイリーリーグ配信先（Cloudflare Pages）

// ビルド版数（毎ビルド一意 → キャッシュ確実更新）。例: 20260617_1530
const now = new Date();
const pad = n => String(n).padStart(2, '0');
const BUILD_VER = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;

// 公開サイト（football-sim.com / docs）に載せる JS。★ league.js は含めない（未完成のリーグを一般公開しない）。
const JS_FILES = ['players.js', 'rng.js', 'simulate.js', 'events.js', 'match.js', 'cutscene.js', 'manager-match.js', 'narration.js', 'ui.js', 'tournament.js', 'japanwc.js'];
// 非公開の lab ビルドにだけ追加で載せる JS。
const LAB_ONLY_JS = ['league.js'];

// 試合エンジン系: 最小化＋軽難読化
const LOGIC_OPTS = {
  compact: true,
  simplify: true,
  renameGlobals: false,            // ★必須: HTML onclick / 他ファイルから参照されるグローバル名を保持
  identifierNamesGenerator: 'hexadecimal',
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  splitStrings: false,
  controlFlowFlattening: false,    // 軽量・低リスク優先（"軽難読化"）
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
};

// データ系（players.js）: 最小化のみ。stringArray を無効化して 4MB の base64 画像を二重エンコードしない
const DATA_OPTS = {
  compact: true,
  simplify: true,
  renameGlobals: false,
  identifierNamesGenerator: 'hexadecimal',
  stringArray: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
};

console.log(`Building docs/ (ver ${BUILD_VER}) ...`);
fs.mkdirSync(path.join(DOCS, 'js'), { recursive: true });

console.log('Obfuscating js/ ...');
for (const name of JS_FILES) {
  const code = fs.readFileSync(path.join(ROOT, 'js', name), 'utf8');
  const opts = name === 'players.js' ? DATA_OPTS : LOGIC_OPTS;
  const t0 = Date.now();
  const out = JavaScriptObfuscator.obfuscate(code, opts).getObfuscatedCode();
  fs.writeFileSync(path.join(DOCS, 'js', name), out);
  console.log(`  ${name}: ${(code.length / 1024).toFixed(0)}KB -> ${(out.length / 1024).toFixed(0)}KB (${Date.now() - t0}ms)`);
}

// css / img を複製
fs.cpSync(path.join(ROOT, 'css'), path.join(DOCS, 'css'), { recursive: true });
fs.cpSync(path.join(ROOT, 'img'), path.join(DOCS, 'img'), { recursive: true });

// index.html: アセット ?v= を更新して docs/ へ
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/(js\/[a-z-]+\.js|css\/style\.css)\?v=[0-9a-zA-Z_]*/g, `$1?v=${BUILD_VER}`);
fs.writeFileSync(path.join(DOCS, 'index.html'), html);

// カスタムドメイン維持
fs.writeFileSync(path.join(DOCS, 'CNAME'), 'football-sim.com\n');
// Jekyll 処理をスキップ（静的成果物をそのまま配信＝Liquid誤処理でのビルド失敗を防ぐ）
fs.writeFileSync(path.join(DOCS, '.nojekyll'), '');

console.log(`Done (public docs/). asset version = ?v=${BUILD_VER}`);

/* ===========================================================================
 * lab ビルド: dist-lab/ = 非公開のデイリーリーグ（Cloudflare Pages ＋ Access）
 *   - docs/ の難読化済みエンジン js を再利用し、league.js だけ追加で難読化。
 *   - lab の index.html は docs/index.html から派生（試合画面 DOM を共有＝ドリフト無し）。
 *     他モードのメニューを隠し、起動時に showLeague() でリーグへ直行するブートストラップを注入。
 *   - Access で鍵をかける前提だが、保険で robots.txt（全 Disallow）も置く。
 * ========================================================================= */
console.log('Building dist-lab/ (private daily league) ...');
fs.rmSync(LAB, { recursive: true, force: true });
fs.mkdirSync(path.join(LAB, 'js'), { recursive: true });

// 公開ビルドで生成済みの難読化 js を lab へコピー（同一成果物を再利用）
for (const name of JS_FILES) {
  fs.copyFileSync(path.join(DOCS, 'js', name), path.join(LAB, 'js', name));
}
// lab 限定 js（league.js）を難読化して追加
for (const name of LAB_ONLY_JS) {
  const code = fs.readFileSync(path.join(ROOT, 'js', name), 'utf8');
  const out = JavaScriptObfuscator.obfuscate(code, LOGIC_OPTS).getObfuscatedCode();
  fs.writeFileSync(path.join(LAB, 'js', name), out);
}
// css / img を複製
fs.cpSync(path.join(ROOT, 'css'), path.join(LAB, 'css'), { recursive: true });
fs.cpSync(path.join(ROOT, 'img'), path.join(LAB, 'img'), { recursive: true });

// lab の index.html = docs/index.html + league.js + ブートストラップ（CNAME は付けない）
let labHtml = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
const labInject =
  `<script src="js/league.js?v=${BUILD_VER}"></script>\n` +
  `<script>window.LEAGUE_TEST_MODE=true;(function(){function boot(){var tm=document.querySelector('.top-menu');if(tm)tm.style.display='none';` +
  `if(typeof showLeague==='function')showLeague();}` +
  `if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',boot);else boot();})();</script>\n`;
labHtml = labHtml.replace('</body>', labInject + '</body>');
// タイトルを lab 向けに（任意・SEO/共有時の表示）
labHtml = labHtml.replace(/<title>[^<]*<\/title>/, '<title>Daily League (private beta)</title>');
fs.writeFileSync(path.join(LAB, 'index.html'), labHtml);

// Basic 認証ゲート（advanced-mode _worker.js）。全リクエストのエントリになるため確実。
// 合い言葉は Pages シークレット env.LAB_PASS。合い言葉なしには 401 で中身を返さない。
fs.copyFileSync(path.join(ROOT, 'lab', '_worker.js'), path.join(LAB, '_worker.js'));

// クローラ抑止（保険）
fs.writeFileSync(path.join(LAB, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

console.log(`Done (lab dist-lab/). asset version = ?v=${BUILD_VER}`);
console.log('NOTE: docs/=公開(リーグ無し) / dist-lab/=非公開(リーグ) 。編集は root の js/ で行い、再度 npm run build すること。');
