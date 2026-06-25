# BACKLOG — 自走改善チームの作業リスト

唯一の信頼できる作業リスト。Orchestrator がここから次タスクを取る。
規約は [AGENTS.md](AGENTS.md)、方針は [GAME_PLAN.md](GAME_PLAN.md)。

状態: `[ ]` 未着手 / `[~]` 進行中 / `[x]` 完了（人間承認・merge 済み）

---

## Sprint 0 — 基盤（自走を安全にする土台）

- [x] **回帰ハーネス** — 代表カードを N 試合回し、勝敗分布・平均得点・シーン結果種別の発生率を集計＆基準比較。
  - `tools/lib/load-engine.js`（分割 js/ を headless ロード）
  - `tools/regression-harness.js`（baseline / check / report）
  - `tools/baseline.json`（基準スナップショット）
  - 確認済: 全体平均合計得点 ≈ 1.39、ファール率 3.2%・ゴール率 4.0%。check が許容差内で通過。
- [ ] **試合イベントログ** — エンジンが型付きイベント列（kickoff/chance/shot/goal/foul/card/injury/sub/HT/FT）を吐く seam を新設。
  - 描画・AI・統計が全てここを購読する構造にする。エンジンの判定ロジックは変えず、出力を構造化するだけ。
  - 受け入れ: 回帰ハーネス check が PASS（挙動不変）。イベント列から既存スコアが再現できる。
- [ ] **シード可能 RNG** — `Math.random` を差し替え可能な PRNG 経由に。未シード時は現挙動と同一にフォールバック。
  - 受け入れ: 同一シードで試合が完全再現。未シードで回帰ハーネス check が PASS。
  - 注: simulate.js 全域に及ぶため独立 PR・慎重に。

## Sprint 1 — パイロット（試合ビジュアル: ハイブリッド方式C）★自走ループの検証対象

方式C（[DECISIONS.md](DECISIONS.md) 2026-06-19）: 通常プレーは軽量な動的描画、ゴール/決定機は参照級の
プリレンダ・カットイン。アートは AI画像生成で調達（仕組みを私が作る）。プレゼン層のみ＝エンジン無改変なので
回帰ハーネスは緑のまま。IP: 汎用顔・架空キット・ロゴ無し。

### 1a 動的ベース・レンダラ（通常プレー）
- [~] procedural ピクセル描画プロト（[tools/proto/manga-prototype.html](tools/proto/manga-prototype.html)、v3 まで）。方針転換: 通常プレーも AI アクションアートで描く（下記）。
- [x] **ライブ per-scene 表示**（dev実装・検証済）: [js/cutscene.js](js/cutscene.js) `renderSceneArt` を [js/simulate.js](js/simulate.js) nextChance にフック（guard・トグル `SCENE_ART_ENABLED`）。action→moment 対応・攻撃側チーム色で kit 選択・未整備 action は SVG フォールバック・goal は takeover。回帰緑。現状アート= longpass のみ。
- [ ] レイアウト調整: portrait アートを横長 field パネルに contain＝左右に余白。試合画面の action 枠を縦長/別レイアウトにするか検討。
- [ ] アクション追加（dribble/shot…）でカバレッジ向上。

### 1b カットシーン・システム（名場面）✅ ゴール実装・検証済み（dev）
- [x] ゴール検出 → [js/cutscene.js](js/cutscene.js)。[js/simulate.js](js/simulate.js) nextChance ゴール時に guard 付き呼び出し（未ロード/無効は従来GOAL演出にフォールバック）。
- [x] マニフェスト選択（`_pickCutscene`: moment＋キット色バケツで選択）。
- [x] 動的HUD重ね（分・スコア・得点者名・チームカラー・GOAL!!）＋フェード/スケール出入り＋タップ/3秒で解除。
- [x] ライブ試合に takeover 差し込み。トグル `CUTSCENES_ENABLED` / `window.CUTSCENES_ENABLED`。出荷アセットは `img/cutscenes/`（build が docs/img へ複製）。
- [x] 検証: 実描画パスのスクショ／実アプリ起動でロード確認（no error）／回帰ハーネス緑（エンジン不変）。
- [ ] 他モーメント（save/red_card/injury）拡張は Sprint 2/3 と連動。本番反映（build/push）は人間ゲート待ち。

### 1c アート生成パイプライン（AI・自動スクリプト方式）
- [x] 生成ガイド（[tools/art/CUTSCENE_ART_GUIDE.md](tools/art/CUTSCENE_ART_GUIDE.md)）。
- [x] 生成スクリプト: [prompts.js](tools/art/prompts.js)（プロンプト組立）／[gen.js](tools/art/gen.js)（OpenAI gpt-image-1, モデル/品質切替）／[pixelate.js](tools/art/pixelate.js)（粗ドット化・sharp）。検証済み（buildPrompt・鍵未設定の安全終了・pixelate 出力）。
- [ ] ユーザー: `OPENAI_API_KEY` を env か `tools/art/.env`（gitignore済）に設定。
- [ ] `node tools/art/gen.js --moment <id> --kit <color> --out cutscenes/...`（課金。実行前に確認）→ 自動で粗ドット化。
- [x] キット色違い = **パレットスワップ**（[tools/art/recolor.js](tools/art/recolor.js)）。AI生成1枚(red)から red/blue/yellow/green/white/dark を安価生成。出荷 img/cutscenes/・cutscene.js/manifest 登録済。`_pickCutscene` が得点チーム色で自動選択。デモで青/赤/黄を確認。
- [~] アクション別ライブラリ拡充（AI生成1枚→recolor6色）: ✅ goal(bicycle) ✅ longpass ／ 次候補: shortpass・dribble・shot・cross・tackle・intercept・save。

### QA
- [ ] 回帰ハーネス check が緑（エンジン不変）＋ preview スクショで見栄え確認。

## Sprint 2 — 怪我・退場

- [ ] イエロー/レッドカード — `'ファール'` を `fairplay`(idx28)＋強度で段階化。2枚目イエロー=レッド。
- [ ] 退場処理 — `lineup` から除外し数的不利を反映（総合力が自然に下がる）。イベント発火。
- [ ] 怪我イベント — デュエル/ファウル時の低確率。`fatigue`(idx1)＋フィジカルで重み付け。強制交代 or 枠切れで続行。
- [ ] 既存交代インフラ（`_subbedOff`/`subsCount`）との連携。
- [ ] QA: カード率・怪我率が妥当域、得点率/勝敗分布が許容差内（baseline 更新は人間承認後）。
- [ ] 最小描画: カード/怪我アイコンの表示（Sprint 1 のレンダラに乗せる）。

## Sprint 3 — 相手監督AI

- [ ] `OpponentAI`: イベントログに反応して team2 の交代を実行。
- [ ] 戦術/システム変更（実在の4戦術・実装済システムのみ）。
- [ ] 監督プロファイル（積極/堅守/反応型）。

---

## アイデア置き場（未スケジュール）
- GK配球パラメータの実装（CLAUDE.md「検討メモ」参照）。
- W杯モードの汎用化（任意国の実2026グループで戦う）。
- 残り34チームのデータ追加（48チーム全実装）。
