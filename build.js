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

// ビルド版数（毎ビルド一意 → キャッシュ確実更新）。例: 20260617_1530
const now = new Date();
const pad = n => String(n).padStart(2, '0');
const BUILD_VER = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;

const JS_FILES = ['players.js', 'rng.js', 'simulate.js', 'events.js', 'match.js', 'cutscene.js', 'manager-match.js', 'narration.js', 'ui.js', 'tournament.js', 'japanwc.js'];

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
html = html.replace(/(js\/[a-z]+\.js|css\/style\.css)\?v=[0-9a-zA-Z_]*/g, `$1?v=${BUILD_VER}`);
fs.writeFileSync(path.join(DOCS, 'index.html'), html);

// カスタムドメイン維持
fs.writeFileSync(path.join(DOCS, 'CNAME'), 'football-sim.com\n');

console.log(`Done. asset version = ?v=${BUILD_VER}`);
console.log('NOTE: docs/ は難読化済み成果物。編集は root の js/ で行い、再度 npm run build すること。');
