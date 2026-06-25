#!/usr/bin/env node
'use strict';
/**
 * gen.js — OpenAI Images API (gpt-image-1) でカットシーン画像を生成し、粗ドット化して保存する。
 *
 * 鍵: 環境変数 OPENAI_API_KEY（または tools/art/.env の OPENAI_API_KEY=...）。
 *     ★このスクリプトは鍵を process.env / .env から読むだけ。リポジトリにコミットしない（.gitignore 済み）。
 *     ★実行すると OpenAI に課金される（あなたのキー）。
 *
 * 使い方:
 *   node tools/art/gen.js --moment goal_bicycle --kit blue --out cutscenes/goal_bicycle_blue_01.png
 *   node tools/art/gen.js --prompt "..." --out cutscenes/x.png --size 1024x1536
 * オプション: --raw（粗ドット化せず生成画像のまま）, --px 176, --colors 32, --size 1024x1536
 */
const fs = require('fs');
const path = require('path');
const { buildPrompt } = require('./prompts');
const { pixelate } = require('./pixelate');

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; }
function has(name) { return process.argv.includes('--' + name); }

function loadKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/^\s*OPENAI_API_KEY\s*=\s*(.+?)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

async function main() {
  const moment = arg('moment');
  const kit = arg('kit', 'red');
  const out = arg('out');
  const model = arg('model', 'gpt-image-1');           // gpt-image-1 | dall-e-3（アカウントの利用可否で切替）
  const isDalle = /dall-e/.test(model);
  const size = arg('size', isDalle ? '1024x1792' : '1024x1536');
  const quality = arg('quality', isDalle ? 'standard' : 'low'); // gpt: low|medium|high|auto / dalle: standard|hd（既定 low=安価）
  const prompt = arg('prompt') || (moment ? buildPrompt(moment, kit) : null);

  if (!prompt || !out) {
    console.error('usage: node tools/art/gen.js --moment <id> --kit <color> --out cutscenes/<file>.png [--size 1024x1536] [--prompt "..."] [--raw]');
    process.exit(2);
  }
  const key = loadKey();
  if (!key) {
    console.error('OPENAI_API_KEY が未設定です。env か tools/art/.env に設定してください（私は鍵の値を扱いません）。');
    process.exit(3);
  }

  console.log('model:', model, '| moment:', moment || '(custom)', '| kit:', kit, '| size:', size, '| quality:', quality);
  console.log('prompt:', prompt);

  const body = { model, prompt, size, n: 1, quality };
  if (isDalle) body.response_format = 'b64_json';
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('OpenAI API error', res.status, t.slice(0, 500));
    process.exit(1);
  }
  const data = await res.json();
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) { console.error('レスポンスに画像がありません'); process.exit(1); }

  const outAbs = path.isAbsolute(out) ? out : path.join(__dirname, out);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const rawPath = has('raw') ? outAbs : outAbs.replace(/\.png$/i, '.raw.png');
  fs.writeFileSync(rawPath, Buffer.from(b64, 'base64'));
  console.log('saved raw →', rawPath);

  if (!has('raw')) {
    await pixelate(rawPath, outAbs, { width: arg('px') ? +arg('px') : 140, colors: arg('colors') ? +arg('colors') : 28 });
    console.log('pixelated →', outAbs);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
