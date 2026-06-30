# BACKLOG — 自走改善チームの作業リスト

唯一の信頼できる作業リスト。Orchestrator がここから次タスクを取る。
規約は [AGENTS.md](AGENTS.md)、方針は [GAME_PLAN.md](GAME_PLAN.md)。

状態: `[ ]` 未着手 / `[~]` 進行中 / `[x]` 完了（人間承認・merge 済み）

---

## ゲーム化ロードマップ P1〜P3（VISION.md 連動・2026-06-29 追加）

[VISION.md](VISION.md) の MVP 最短経路。各タスク末尾で QAゲート（`node --check` ＋ `regression-harness check 1500` ＋ preview 5174）。
既存 Sprint 0/1 を吸収: P1 は Sprint 0 の「イベントログ」「シードRNG」、P2 は Sprint 1 のカットシーン資産を土台にする。
担当: engine-dev / renderer-dev / qa-regression / reviewer ＋ Codex 独立レビュー（三重チェック）。

### P1 基盤（エンジン無改変の土台）
- [x] **T-01** イベント型定義（kickoff/chance/duel/shot/goal/save/foul/card/injury/sub/HT/FT）。→なし ✅ js/events.js `EVENT_TYPES`
- [x] **T-02** simulateChance 出力を Event 列へ正規化するアダプタ（購読層・エンジン無改変）。→T-01 ✅ js/events.js `matchToEvents`
- [x] **T-03** イベント列から現行スコア/ログを再現できる検証（回帰緑）。→T-02 ✅ tools/events-reproduce.js（1800/1800一致・回帰緑・三重チェック＋Codex発見P2修正済）
- [x] **T-04** 差し替え可能PRNG導入（未シード時は現挙動フォールバック）。→なし ✅ js/rng.js（mulberry32・未シード=Math.random素通し）
- [x] **T-05** simulate.js 全域の Math.random を PRNG 経由へ（独立PR・慎重に）。→T-04 ✅ 36箇所全置換・確率式byte不変（reviewerがbyte一致で実証）
- [x] **T-06** 同一シード完全再現＋回帰緑の確認。→T-05,T-03 ✅ 未シード回帰緑(挙動同一をビット実証)・seed再現6/6
  - ⚠️ Codex指摘[P2]: 本番の決定論境界は **T-07 playMatch** に集約（seed→rng()でn決定／seed-repro を playMatch 経由に差し替え）。`narration.js` simulateSilent 等の Math.random(5箇所)の決定論化は**別タスク（バッチsim・独立PR）**。
- [x] **T-07** playMatch(home,away,tactics,seed) ラッパー。→T-02,T-06 ✅ js/match.js（既存エンジンを束ねる本番試合API・判定不変・n決定をrng()に集約・marked_playerをstartGameと同じ非対称初期化に整合）。三重チェック＋Codex発見P2(home marked_player既定)修正済。
  - 🎉 **P1（基盤）完了**：イベントログ＋シードRNG＋playMatch が揃い、「エンジン無改変・未シード回帰緑・同一シード完全再現」の土台が完成。
  - 📌 残: `narration.js` simulateSilent（バッチsim）の決定論化は別タスク（独立PR）。in-match逐次実行＝T-08(P2)。

### P2 試合ビューア（漫画＋采配）
- [ ] **T-08** playMatch をチャンス逐次実行へ（介入点フック・デュエル式不変）。→T-07
- [ ] **T-09** 漫画コマ送りビューア（cutscene.js/renderSceneArt を Event 購読に接続・テンポ）。→T-02,T-08
- [ ] **T-10** ライブ実況接続（scenario_data テンプレを Event 列に同期）。→T-09
- [ ] **T-11** 介入点UI＝交代（既存sub機構流用）。→T-08
- [ ] **T-12** 介入点UI＝戦術変更（実在4戦術）＋喝（モチベ補正）。→T-08
- [ ] **T-13** 介入が次チャンス以降の入力に反映される検証。→T-11,T-12
- [ ] **T-14** 名場面カットインのテンポ統合＋回帰緑。→T-09
- [ ] **T-15** 采配ドラマ核: keyplayer指名＋marked_player解放パズル＋主人公の決定機采配。→T-08

### P3 デイリーループ＆永続化
- [ ] **T-16** 状態モデル（Manager/Club/Season/Match セーブ構造）。→T-07
- [ ] **T-17** 永続化層（Firestore継続 or D1）＋匿名ID。→T-16
- [ ] **T-18** 1日1試合ロック（サーバー時刻・デバイス跨ぎ）。→T-17
- [ ] **T-19** ホーム/今日の試合ハブ（暗背景・i18n）。→T-17
- [ ] **T-20** 試合前ミーティング画面（布陣/system/戦術＝既存UI流用）。→T-16
- [ ] **T-21** 試合結果＋順位表（tournament.js のリーグ集計流用）。→T-16
- [ ] **T-22** 次回予告（クリフハンガー・最小テンプレ→後でAI化）。→T-21
- [ ] **T-23** 名場面コマ自動生成＋シェア（generateShareImage流用）。→T-14
- [ ] **T-24** オンボーディング（読む/采配/1日1話 を伝える）。→T-19

**クリティカルパス**: T-01→T-02→(T-04→T-05→T-06)→T-07→T-08→T-09→T-16→T-17→T-18→T-19。
**並行可**: 実況(T-10)／介入UI(T-11,T-12)／采配ドラマ(T-15)／シェア(T-23)／オンボ(T-24)。Engine∥Renderer は別worktree。

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

## エンジン精度トラック（ゲーム化とは別軸・2026-06-30）
- [x] **通常チャンス数 16→32**（v2.3.0 `e570101`・デプロイ済）。得点1.39→2.78・シュート3.9→7.8 を実W杯水準へ。デュエル式/カウント不変・三重チェック緑。詳細 [DECISIONS.md](DECISIONS.md)。
- [x] **回帰ハーネスを「リアルさの物差し」に拡張**（シュート/枠内/決定率/得点分布の裾＋実W杯目安併記）。
- [ ] **7-1の本格再現（未決）**: ドイツ×キュラソーが平均2.16止まり。①キュラソーのデータが強すぎ(TotalParam20071≈USA) ②**チャンス配分式 `t1/(t1+t2)` が強弱差を圧縮**(独52%・実76%シェア)。案A=キュラソー弱体化(data-steward)／案B=配分式にコントラスト指数(全試合のバランスに影響・要検証)／案C=現状確定。**ユーザー判断待ち**。

## アイデア置き場（未スケジュール）
- GK配球パラメータの実装（CLAUDE.md「検討メモ」参照）。
- W杯モードの汎用化（任意国の実2026グループで戦う）。
- 残り34チームのデータ追加（48チーム全実装）。
