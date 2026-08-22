#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const cutscene = fs.readFileSync(path.join(root, 'js/cutscene.js'), 'utf8');
const lab = fs.readFileSync(path.join(root, '_scene_lab.html'), 'utf8');
const historical = execFileSync('git', ['show', '67263a2^:js/cutscene.js'], { cwd: root, encoding: 'utf8' });
let passed = 0;

function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} が見つかりません`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`${name} の終端が見つかりません`);
}

const shootStep = functionBody(cutscene, 'renderShootStep');
const sceneArt = functionBody(cutscene, 'renderSceneArt');
const shotEntry = functionBody(cutscene, '_renderShotScene');
const legacyBody = functionBody(cutscene, '_renderLegacyShotScene');
const historicalBody = functionBody(historical, '_renderShotScene');

ok(shootStep.includes("_pickCutscene('shot', sc.offence && sc.offence.team_color)"), 'shoot stepがshot manifestを選ぶ');
ok(shootStep.includes('if (entry && entry.file) return _renderShotScene(shotSc, entry);'), 'shoot stepがentry付き復元rendererを呼ぶ');
ok(!shootStep.includes('_renderAdoptedShotScene') && !shootStep.includes('_renderCinematicShotScene'), 'shoot stepから不採用画像へ到達しない');

ok(sceneArt.includes('var entry = _pickCutscene(moment, sc.offence && sc.offence.team_color);'), 'scene artがmoment entryを先に取得する');
ok(sceneArt.includes("if (moment === 'shot' && entry.file)"), '通常shotはentry存在時だけ描画する');
ok(sceneArt.includes("if (sc.result === '枠を外した！') return _renderMissScene(sc);"), '枠外分岐を維持する');
ok(sceneArt.includes("if (sc.result === 'GK防いだ！') return _renderGkScene(sc, 'save');"), 'GKセーブ分岐を維持する');
ok(sceneArt.includes('return _renderShotScene(sc, entry);'), '通常shotがentry付き復元rendererを呼ぶ');
ok(!sceneArt.includes('_renderAdoptedShotScene') && !sceneArt.includes('_renderCinematicShotScene'), 'scene artから不採用画像へ到達しない');

ok(shotEntry.trim() === 'return _renderLegacyShotScene(sc, entry);', '本編入口は67263a2直前のrendererだけへ委譲する');
ok(legacyBody.trimEnd() === historicalBody.trimEnd(), '復元renderer本体が67263a2直前と一致する');
ok(lab.includes("nm:'シュート（復元本編A・対決割り）'"), 'Labで現行variant Aを表示する');
ok(lab.includes("nm:'シュート（復元本編B・2拍）'"), 'Labで現行variant Bを表示する');
ok(lab.includes("nm:'不採用・4コマ案（比較用）'"), 'Labで4コマ案を不採用と表示する');
ok(lab.includes("nm:'未採用・追加4拍（比較用）'"), 'Labで追加4拍を未採用と表示する');
ok(lab.includes('c=_renderAdoptedShotScene(sc);   // 不採用4コマはラボの比較確認だけに隔離'), '不採用4コマはLab明示経路だけで描画する');
ok(lab.includes('c=_renderCinematicShotScene(sc);   // 未採用の追加4拍もラボ比較だけに隔離'), '未採用追加4拍はLab明示経路だけで描画する');
ok(lab.includes('c=_renderShotScene(sc,entry);   // 本編と同じ復元入口を通す'), '復元版Labが本編入口を通る');
ok(lab.includes('js/cutscene.js?v=lab95'), 'Lab cache keyを更新する');

console.log(`shot rollback test: ${passed}/${passed} PASS`);
