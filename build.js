#!/usr/bin/env node
/**
 * build.js
 * index.html のメインスクリプトを難読化して docs/index.html を生成する
 *
 * 使い方: npm run build
 */

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const SRC  = path.join(__dirname, 'index.html');
const DEST = path.join(__dirname, 'docs', 'index.html');

console.log('Building...');

const html = fs.readFileSync(SRC, 'utf8');

// メインスクリプトの開始・終了位置を特定（最後の <script> ブロック）
const lastOpen  = html.lastIndexOf('<script>');
const lastClose = html.lastIndexOf('</script>');

if (lastOpen === -1 || lastClose === -1 || lastClose < lastOpen) {
  console.error('Script tag not found');
  process.exit(1);
}

const before = html.substring(0, lastOpen + '<script>'.length);
const script = html.substring(lastOpen + '<script>'.length, lastClose);
const after  = html.substring(lastClose);

console.log(`Script size: ${(script.length / 1024).toFixed(1)} KB`);

// 難読化
const obfuscated = JavaScriptObfuscator.obfuscate(script, {
  compact: true,
  // 変数・関数名のリネーム
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,          // HTML の onclick から呼ばれるグローバル関数名は保持
  // 文字列の暗号化
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.8,
  // 制御フロー難読化（中程度：パフォーマンスとのバランス）
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.3,
  // デッドコード挿入はOFF（ファイルサイズ増大を防止）
  deadCodeInjection: false,
  // self-defending: devtools でのフォーマット防止
  selfDefending: true,
  // デバッグ保護
  debugProtection: false,        // trueにするとdevtoolsが重くなりすぎる
  disableConsoleOutput: false,
});

const output = before + obfuscated.getObfuscatedCode() + after;

fs.mkdirSync(path.join(__dirname, 'docs'), { recursive: true });
fs.writeFileSync(DEST, output);

const srcSize  = (html.length / 1024).toFixed(1);
const destSize = (output.length / 1024).toFixed(1);
console.log(`Done: ${srcSize} KB → ${destSize} KB`);
console.log(`Output: ${DEST}`);
