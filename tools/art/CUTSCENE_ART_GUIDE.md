# カットシーン・アート生成ガイド

football-sim のゴール/決定機で出す「参照級カットイン」を AI画像生成（ChatGPT / DALL·E / Midjourney 等）で作るための仕様書。
方針は [DECISIONS.md](../../DECISIONS.md)（方式C ハイブリッド）。**仕組み**（表示・HUD重ね・選択）は football-sim 側で実装するので、ここでは**素材の作り方**だけを定義する。

---

## 0. 役割分担（重要）

- あなた（生成担当）: 本ガイドのプロンプトで**汎用の名場面ピクセルアート**を生成 → 後処理 → `tools/art/cutscenes/` に置く → マニフェスト登録。
- 私（仕組み担当）: 名場面検出・カットシーン選択・**動的HUD重ね**（分・スコア・得点者名・チームカラー・GOAL!! 演出）・試合への統合。

→ **絵にはテキストもスコアも選手名も描かせない**。それらは実行時に上から重ねる。絵は「迫力ある汎用シーン」だけでよい。

---

## 1. IP規約（厳守）

本番 football-sim.com で配信するため、権利リスクを避ける:

- ❌ 実在選手の似顔・髪型・背番号で特定できる描写 → ✅ **匿名の汎用フェイス**
- ❌ 実クラブの徽章・実在ユニフォームのデザイン → ✅ **架空のソリッドキット**（単色＋せいぜい単純な襟/袖ライン）
- ❌ スポンサーロゴ・広告看板（NISSAN/UEFA 等）・読めるテキスト → ✅ ロゴ無し・看板は**抽象的なボケ**
- ❌ 既存ゲーム（FC/ウイイレ/キャプテン翼）のスクショやスプライト流用

プロンプトに必ず否定条件（§5 negative）を入れる。

---

## 2. 技術仕様

| 項目 | 値 |
|---|---|
| 構図比率 | **3:4 縦**（フルボディの躍動感を活かす。ゴール時は中央 takeover カードで表示） |
| 生成解像度 | 高解像度（1024px 級）で生成 |
| 後処理 | 最近傍で **横140px**（既定・標準）に縮小 → パレット量子化 **28色**（`gen.js`/`pixelate.js` が自動実行） |
| 背景 | フルブリード（透過不要）。フラッドライトのピッチ＋抽象的なボケ観客 |
| セーフゾーン | **上 18% / 下 20%** は HUD が乗る。重要な絵（顔・ボール）をそこに置かない＝**主役は中央**、上下に余白 |
| 形式 | PNG |

---

## 3. スタイル前置き（全プロンプト共通の接頭辞）

英語の方が生成精度が高い。以下を毎回先頭に付ける:

```
16-bit retro pixel art, SNES / PC-Engine sports-anime style, chunky visible pixels,
limited cel-shaded palette (~32 colors), bold dark outlines, dramatic dynamic action,
cinematic low camera angle, floodlit stadium at dusk, blurred abstract bokeh crowd,
rim light on the athlete, crisp pixel shading, no anti-aliasing,
```

---

## 4. すぐ試せるマスター・プロンプト（まずこれで品質確認）

```
16-bit retro pixel art, SNES / PC-Engine sports-anime style, chunky visible pixels,
limited cel-shaded palette, bold dark outlines, dramatic dynamic action, cinematic low
camera angle, floodlit stadium at dusk, blurred abstract bokeh crowd, rim light, crisp
pixel shading, no anti-aliasing — a male footballer performing a spectacular overhead
bicycle kick in mid-air, full body with dynamic foreshortening, the ball blasting off his
boot with motion lines, wearing a plain solid RED jersey and white shorts, generic
fictional kit with no logo and no number. Portrait 3:4, subject centered with empty
headroom at top and clear floor space at bottom for a UI bar. Anonymous generic face,
no real player likeness, no club crest, no brand or sponsor logo, no readable text, no
watermark, no extra limbs, no deformed hands, not photorealistic, no 3d render, no smooth
gradients.
```

これで参照に近ければOK。色・アクションを差し替えて量産する（§6）。

---

## 5. プロンプトの型

`[スタイル前置き §3] + [SUBJECT] + [KIT] + [FRAME] + [NEGATIVE]`

- **SUBJECT**（モーメント別、§6）
- **KIT**: `wearing a plain solid {COLOR} jersey and white shorts, generic fictional kit, no logo, no number`
- **FRAME**: `portrait 3:4, subject centered, empty headroom at top and clear space at bottom for a UI bar`
- **NEGATIVE**: `anonymous generic face, no real player likeness, no club crest, no brand or sponsor logo, no readable text, no watermark, no extra limbs, no deformed hands, not photorealistic, no 3d render, no smooth gradients`

---

## 6. モーメント別 SUBJECT 集（カットシーンの種類）

| id (moment_subtype) | SUBJECT（英語で差し込む） |
|---|---|
| `goal_bicycle` | a spectacular overhead bicycle kick in mid-air, ball blasting off the boot, motion lines |
| `goal_volley` | a full-stretch side volley, body horizontal, striking the ball hard |
| `goal_header` | a powerful leaping header, neck snapping forward, airborne above defenders |
| `goal_long_range` | a thunderous long-range strike, full follow-through, ball trailing motion lines |
| `goal_solo_run` | sprinting at speed with the ball, slotting it past a diving keeper silhouette |
| `goal_free_kick` | curling a free kick over a generic wall of blurred player silhouettes |
| `goal_penalty` | a calm side-foot penalty, keeper diving the wrong way |
| `goal_tap_in` | a sliding close-range finish, arms out, ball crossing the line |
| `save_dive` | a goalkeeper at full stretch, fingertips pushing the ball wide, body airborne |
| `tackle_slide` | a defender sliding in for a strong tackle, grass and turf spraying |
| `duel_aerial` | two footballers in different solid kit colors leaping together for a header |
| `red_card` | a generic referee holding a red card high, a player turning away in frustration |
| `injury_down` | a footballer down on the turf holding his leg, dramatic concern |
| `celebration_slide` | a knee-slide goal celebration, arms wide, crowd erupting behind |
| `chance_miss` | a striker with hands on his head after missing, anguish, ball rolling wide |

> まずは `goal_*` 系（特に bicycle / header / long_range / solo_run）を優先。1モーメント 2〜3枚ずつ生成してバリエーションを持たせる。

---

## 6.5 リアルなフォーム（実写真をポーズ見本に）

テキストだけだと蹴り足の振り抜き等が棒立ちになりがち。**実写真をポーズ見本として ChatGPT にアップ**し、img2img で描かせると生体力学が正確になる（longpass で実証＝フォーム大幅改善）。
- 写真は **ポーズ/フォームの参照のみ**。顔・キット色・所属は別物（匿名・赤・無地）に変える＝IP安全＋recolor も効く。
- プロンプト冒頭に付ける: `Use the attached photo ONLY as a pose/form reference. ...a DIFFERENT anonymous generic male footballer with the SAME realistic biomechanics... Do NOT copy the real person's face, likeness, or kit color.`
- 良い当たりが出るまで写真ありで2〜3回回すと早い。

## 7. キット色のバリエーション

カットシーンのキット色は固定なので、得点チームの色に近いものを実行時に選ぶ。主要 goal モーメントは以下の色で各1枚以上:

`RED / BLUE / WHITE / YELLOW / GREEN / DARK(navy or black)`

（厳密一致は不要。HUD のチームカラー帯で同定するので「近い系統」で十分。）

---

## 8. 後処理ワークフロー

1. 1024px 級で生成。
2. 最近傍補間で**横140px**（標準）へ縮小（`gen.js` 経由なら自動。手動なら Aseprite / Photoshop「ニアレストネイバー」）。
3. パレットを **28色**（標準）へ量子化（バンド感の統一）。
4. PNG 書き出し。上下のセーフゾーンに主役を被せていないか確認。

> `node tools/art/gen.js ...` で生成すると 2–3 は自動実行される。粗さを変えたい時は `--px 100 --colors 24` のように上書き。

---

## 9. 命名と配置

- ファイル名: `{moment}_{subtype}_{kit}_{NN}.png` 例 `goal_bicycle_red_01.png`
- 置き場所: `tools/art/cutscenes/`
- 置いたら [cutscenes.manifest.json](cutscenes.manifest.json) に1エントリ追加（または「登録して」と私に言えば反映する）。

生成した画像をこのチャットに貼ってくれれば、品質チェック＋マニフェスト登録＋HUD重ねのプレビューまで私が回します。
