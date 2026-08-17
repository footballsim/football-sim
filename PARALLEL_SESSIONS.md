# PARALLEL_SESSIONS — Steam発売までの複数エージェント契約

作成: 2026-07-30 ／ 最終更新: **2026-08-14**。着手前に必ず本書を読む。

> ## 2026-08-14 改定 — 4枠の包括委任開発（ユーザー正式決定）
>
> **正式スコープ内は実装→検証→独立レビュー→`game-main`統合→build/push→Basic認証中のkantoku-lab反映まで自走**する。都度の承認は求めず、例外ゲートだけ停止する。**試合パートの新規・差替え画像は、内部QA後にユーザーの目視採用を得てから統合する。**
>
> - 同時稼働は **Orchestrator 1＋Writer 2＋Independent QA/Reviewer 1** の最大4枠。
> - **同じworking treeを共有しない**。旧S/G/D共有運用は履歴扱い。各タスクは最新`game-main`の固定SHAから専用worktree＋`codex/`ブランチを作る。
> - `/Users/iwasakimitsuru/football-sim` は閲覧・Oによる統合専用。Writerの機能編集は禁止。Oは包括委任条件を満たしたタスクをここへ統合できる。
> - Writerは最大2体。共有ファイルのリースが重なるタスクは並行せず、Orchestratorが順序を付ける。
> - デプロイ調停 D-2〜D-9は継続。デプロイは `npm run deploy:lab` のみ、wrangler直叩き禁止。

## 現行ロール（最大4枠）

| 枠 | 役割 | 書込範囲 | 禁止 |
|---|---|---|---|
| **O** | Orchestrator / Release Integrator | ROADMAP/SCOPE/BACKLOG/DECISIONS/PARALLEL、統合時の競合解消 | 通常の機能コードを自分で実装しない |
| **D** | Gameplay Systems | league/save/engine/data/manager UI。従来D所有ファイル | art/img/cutscene/計画文書 |
| **X/P** | Experience & Art（〜9/30）→ Desktop Platform（10月〜） | 9月まで=黄金5画面、演出、img、Steam素材。10月から=desktop/steam/package周辺 | D所有のエンジン・セーブ。担当切替前の混在 |
| **Q** | Independent QA / Reviewer | 原則read-only。検査ツールは専用タスク時のみ | 実装をその場で直す、閾値を緩める、失敗テストを削る |

Reviewerは常駐5枠目にせず、Writerが終了して空いた枠へ**別コンテキスト**で起動する。Qのテスト判定とReviewerの設計レビューは別に記録する。

## 1タスク=1 worktree 契約

1. OがタスクID、起点`game-main` SHA、所有ファイル、受入条件、期限を固定する。
2. `/private/tmp/football-sim-<task-id>` と `codex/<task-id>-<slug>` を作り、1 ownerだけが書く。
3. Writerは実装後に対象テスト、`npm run check`、`npm run check:docs`を実行。エンジン/バランスは`npm run regression:full`。
4. Qが同じ固定コミットを独立検証し、Writerへ差し戻す。修正ループは最大3回。
5. Reviewerがdiff、ガードレール、日英、保存、画面、権利を独立確認する。
6. Oが証拠を監査し、下記の包括委任条件と例外ゲートを判定する。条件を満たせば**人間確認なしでgame-mainへ統合**する。ただし試合パート画像は、最終候補と実機プレビューをユーザーへ提示し、明示的な採用回答を得る。
7. cleanな統合worktreeでfull gateを通し、必要時build、`game-main` push、Basic認証中のkantoku-lab deployまで続行する。完了後に証拠を報告する。

### 共有ファイルのリース

`index.html`、`build.js`、`package.json`、`js/players.js`、`css/style.css`はOが1タスクにだけ期限付きで貸す。同時に2タスクが必要なら実装順を直列化する。担当外差分が見えたら即停止する。

## 自動停止条件

- `docs/`追跡差分、担当外差分、共有ファイルのリース衝突、起点SHAずれ、競合。
- duel count、`system_data`順/name、`long_name`/内部ID、save schemaを仕様外に変更。
- i18n片側、1画面1ビート違反、実名/実在ロゴ/透かし残留、AI・ライセンス台帳不明。
- `npm run check`または`check:docs`失敗。回帰は短いcheck再実行→1500でも赤なら停止。baselineは自動更新禁止。
- QA差し戻し3回、同じ阻害が2営業日超、見積り倍化、スコープ追加が必要。
- 9/6 Store Candidate freeze後の非blocker変更、9/14審査提出後の審査無関係変更、11/13以後の新機能。
- deploy-guard DANGER、別Writer稼働中、直前Productionが祖先でない、公開先/Steam App IDが不明。

## 包括委任で自動実行する操作

- ROADMAP/SCOPE/BACKLOGに既に含まれるタスクの分解、worktree/branch、実装、テスト、独立QA/Review、最大3回の修正。
- QA/Reviewが緑で、担当外差分・競合・停止条件がない変更の`game-main`統合、明示ファイルstage、commit、`game-main` push。
- cleanな`integ/lab`、直前ProductionがHEAD祖先、他Writer停止、full gate緑、deploy-guard SAFEを全て満たす場合のbuildと`npm run deploy:lab`。デプロイ後はBasic認証401と代表機能をno-cacheで確認する。
- BACKLOG/DECISIONSへのコミット・QA・反映証拠の記録。ユーザーへの報告は事後でよい。
- `main`/football-sim.com、force push、baseline更新、秘密値の読出し/出力、wrangler直叩きは包括委任に含めない。

## 人間専用の例外ゲート

- スコープ・期限・対象OS・価格・ストア記載・機能カット。
- baseline、セーブschema/内部ID、duel logic例外、権利判断、AI申告の確定。
- Steam Direct支払い・本人/税務/銀行情報、Steamworks権限、審査提出、Coming Soon公開、SteamPipe set-live、発売。
- 試合パートの新規・差替え画像の採否。生成・仮配線・内部QA/Reviewまでは自走するが、採用回答前の`game-main`統合、build/push/deploy、次シーン着手は禁止。

通常開発の都度承認は廃止する。試合パート画像だけは各シーン単位で確認し、それ以外の例外ゲートは可能な限り **金曜=候補版/公開判断** にまとめ、緊急のP0と締切ゲートだけ随時確認する。

## Oが発行するタスクカード

Writerを起動する前に、Oは次を埋める。空欄のカードでは作業を始めない。

```text
Task ID / objective:
Base game-main SHA:
Owner role / worktree / branch:
Owned files:
Leased shared files (期限):
Acceptance criteria:
Required tests / browser sizes / languages:
Forbidden or untouched areas:
Deadline / freeze relevance:
Exception gate after QA (該当しなければnone):
```

最初の自走順は `AUTO-02（統合テスト入口）→ FN-01/02 → STORE-01`。MG-06とPUB-01は統合・反映済み。

---

## 旧S/G/D共有運用（2026-07-30〜2026-08-13・履歴）

## セッションの役割（3本）

| # | セッション | 役割 | ドキュメント編集権 |
|---|---|---|---|
| **S** | **スケジュール**（専任） | 進捗チェック・計画改定・スコープ判定。**コードは書かない** | ROADMAP / SCOPE / DECISIONS / PARALLEL_SESSIONS **=Sのみ** |
| **G** | **グラフィック開発** | 絵・演出・見た目（4層 S/M/C/U の実装とアート配線） | BACKLOG の**自分のタスクIDの行だけ** |
| **D** | **ゲーム化開発** | ロジック・データ・UI機能（監督キャリア/シーズン/メンタル/音/公開準備） | BACKLOG の**自分のタスクIDの行だけ** |

**方針の正本**: 機能スコープ=[SCOPE.md](SCOPE.md)／日程=[ROADMAP.md](ROADMAP.md)／判断=[DECISIONS.md](DECISIONS.md)／作業=[BACKLOG.md](BACKLOG.md)。
**G/D は計画を書き換えない**。スコープ変更が必要になったら**実装せず S に報告**（勝手にv1.0スコープを増やさない＝凍結ルール）。

---

## ファイル所有権（★=単独所有／⚠=共有・要注意）

### G（グラフィック）が所有
- ★ `js/cutscene.js`（M層=漫画カットシーン）・`js/wideshot.js`（S層=引き画）・`js/manga_recolor.js`（リカラー）
- ★ `js/portrait.js` `js/portrait_pixel.js`（C層=顔）・`js/lab-art.js` `js/juice.js`（演出）・`js/bg3d.js`（退役）
- ★ `img/` 全体・`tools/proto/` `tools/art/`（アート後処理・検査）
- ★ `css/lab-skin.css`（**新規作成=Gの初回セットアップ**。レトロ/ドット絵スキン層を**最後に読み込んで上書き**する専用ファイル。これで D の `league-ui.css` と衝突しない）
- 外部: `~/sprite-studio/`（量産パイプライン）

### D（ゲーム化）が所有
- ★ `js/league.js`（リーグ・セーブv4・監督キャリア）・`js/mental.js`・`js/discipline.js`
- ★ `js/match.js` `js/manager-match.js` `js/events.js` `js/rng.js` `js/simulate.js`（エンジン）
- ★ `js/players.js`（データ）・`js/lg-ui.js` `js/matchday.js`（UI構造/挙動）
- ★ `css/league-ui.css` `css/style.css`
- ★ `tools/regression-harness.js` `tools/baseline.json`・`tools/lib/`

### ⚠ 共有ファイル（**追記のみ・1行単位・コミット前に必ず差分確認**）
- ⚠ `index.html` — script/link タグの追加は**末尾の該当ブロックへ1行追記のみ**。既存行を並べ替えない
- ⚠ `build.js` — `LAB_ONLY_JS` 配列への**要素追加のみ**（現在: mental/discipline/portrait/manga_recolor/juice/lab-art/lg-ui/matchday/wideshot/league）
- ⚠ `BACKLOG.md` — **自分のタスクIDの行だけ**編集（他人の行・トラック見出しに触らない）
- ⚠ `CLAUDE.md` `AGENTS.md` — 原則 S。実装で判明した恒久ルールは追記可（1ブロック）

---

## タスクID の担当（BACKLOG準拠）

**G（グラフィック）**
- グラフィック4層の実装（S引き画／M中景／C顔アップ／U見た目）＋**8/7 方向性確定の試作・比較提示**
- アート納品①②③の**配線**（8/8〜9/20・ROADMAP アート表）
- `PT-05` `PT-06` `PT-07`（ポートレート本番配線）
- 演出タスク: `PS-05` の残り演出・`RE-01` の**演出部分**（下記スプリット参照）・`SN-03`/`MG-08` のセレモニー/成長リザルト演出

**D（ゲーム化）**
- **8月上旬の配管**: `FN-00`（表示名インダイレクション・最優先）・`MG-06`（コーチ陣）・`SN-08a`（soft加齢）・Sprint2 の**怪我/停止の持ち越し本体**・`SD-01`（効果音）・`RW-01`（SNSフィード）
- `MG-07`〜`MG-12` ／ `SN-06` `SN-07` `SN-09` `SN-08b` `SN-10` ／ `RW-03` `RW-04` ／ `PS-06` `PS-07` `PS-09` `PS-10` `PS-11` ／ `SD-02` ／ `OP-01` `OP-02` `OP-03`
- **9月中旬（〜9/20 必須）**: `FN-01` `FN-02`（架空化）
- 常設: **試合バランス調整**（実在データで回帰・baseline更新はユーザー承認）

**スプリット案件（順序が決まっているもの）**
- `RE-01` ポスト直撃: **D がエンジン（result-hook・確率・KPI）→ 完了後に G が演出（2〜3ビート）**
- 新機能全般: **D がロジック＋最小UI → G が見た目を磨く**（同時編集を避ける）

---

## git の作法（事故防止・過去に実害あり）

1. **着手前**: `git log --oneline -5` `git status` で**他セッションの未コミット変更を把握**してから編集を始める。
2. **コミット前**: 再度 `git status` → **自分の担当ファイルだけをステージ**。共有ファイルに他人の変更が混じっていたら**ハンク単位で自分の分だけ**入れる（`git diff` → 分割 → `git apply --cached`。`git add -i` は使えない）。
3. **他人の変更を絶対にコミットしない**（過去に別セッションの修正ごと push した事故あり）。
4. `js/` 編集後は `node --check`（フックが自動実行）。エンジン/バランス変更は `tools/regression-harness.js check 1500`。
5. **lab限定の定型**: 新規jsは `build.js` の `LAB_ONLY_JS` へ追加＋共有jsのフックは `typeof` ガードで no-op ＋ **build後の `docs/` 差分は破棄**（本番=football-sim.com は凍結中）。
6. **デプロイ**: `/deploy` スキルを使う。**他セッション稼働中は直前の再ビルドを避け**、検証済み成果物の mtime を確認して出す。

---

## 🚨 デプロイ調停ルール（2026-08-06 制定・**3往復の衝突を受けて**）

### なぜ起きるのか（気をつけるでは直らない理由）
1. **Cloudflare Pages の本番エイリアスは1本＝デプロイは「マージ」ではなく「置き換え」**。別ブランチから出すと**相手の機能が丸ごと消える**（gitは衝突しない＝成果物だけが上書きされるので、既存のハンク単位ルールでは防げない）。
2. **`dist-lab/` は gitignore＝成果物はローカルにしか無い**。つまり**「誰かのローカルの状態」がそのまま本番になる**。相手のコードは**マージして再ビルドしない限り成果物に入らない**。
3. ⚠️ **`--branch` を省略すると、出力先が「今いる git ブランチ名」で暗黙に決まる**（main なら本番／それ以外は Preview）。**同じコマンドが状況次第で本番を壊す**＝これが再発の温床。

### ルール（守るのでなく、外れたら止まる形にする）

- **D-1 本番に出せるのは統合ブランチ `integ/lab` からのみ。** G/D は**自分のブランチから本番へ出さない**。`integ/lab` は**恒久ブランチ**（毎回 `integ/xxx` を作らない）。
- **D-2 本番へ出すなら `--branch=main` を必ず明示。**
  ```bash
  npm run deploy:lab   # integ/labをチェックアウト。内部で--branch=mainを固定
  ```
  `npx`/`npm exec`/wranglerバイナリの直叩きは禁止。正規scriptが`--branch=main`、docs-guard、deploy-guardを固定する。
- **D-3 日常の確認は Cloudflare でなく**ローカル**で行う**（常設プレビュー `http://localhost:5175`／lab は `dist-lab` をローカル配信）。**Cloudflare へ出すのは節目だけ**＝衝突の"機会"そのものを減らす。
- **D-4 本番デプロイ前にプリフライト（機械判定・省略禁止）**＝「直前の本番が自分のHEADの祖先か」を確認する。祖先でなければ**相手の成果が乗っていない**＝出した瞬間に消える。
  ```bash
  npm run deploy:guard   # 直前Production SHA取得とancestor判定を一括実行
  ```
  **DANGER なら即中止**し、D-5 へ。
- **D-5 統合の作法**: `integ/lab` に **G/D 双方の最新をマージ** → **必ず `npm run build`**（再ビルドしないと相手のコードが `dist-lab/` に入らない）→ 回帰 → デプロイ。**`build.js` の `LAB_ONLY_JS` が競合したら両側採用が正**（実績あり）。
- **D-6 事後確認は「自分の機能＋相手の機能」の両方**（no-cache ヘッダ必須）。★**自分の機能だけ見て「出た」と判断しない**＝これが3往復の直接原因。相手の代表機能を1つ必ず触る。
  ```bash
  curl -s -H 'Cache-Control: no-cache' -o /dev/null -w "%{http_code}\n" https://kantoku-lab.pages.dev/   # 401=ゲート正常
  ```
- **D-7 本番デプロイは宣言してから**: 開始時と完了時にユーザーへ一言（＝人間が実質のロック）。**相手セッションが稼働中と分かっている間は本番に出さない**。
- **D-8 デプロイ直前の再ビルド禁止（別セッション稼働中）**: 検証済み成果物の mtime を確認して出す（既存ルール・継続）。
- **D-9 分岐したら「両方向」を揃えて閉じる**: G/D のブランチが分かれたら、`integ/lab` へ統合したうえで**両ブランチを fast-forward で同一コミットに揃える**。★**片方だけ取り込んでも意味がない**（もう一方が自分の古いブランチからビルドすればまた消える）。2026-08-06 は `3ef93f3` に揃えて収束。

> **迷ったらローカルで確認。Cloudflare の本番は `integ/lab` から、プリフライトを通してから。Preview は行き止まり（Accessサインインが要る）。**

## セッション起動用プロンプト（コピペ用）

### G — グラフィック開発
```
football-sim のグラフィック開発セッションです。PARALLEL_SESSIONS.md を読んで担当範囲とgit作法を守ってください。
私の担当は「絵・演出・見た目（4層 S/M/C/U）とアート配線」。ロジック/データ/UI構造(league.js・lg-ui.js・css/league-ui.css 等)はDセッションの担当なので触りません。
計画(ROADMAP/SCOPE/DECISIONS)は書き換えず、スコープ変更が必要なら実装せず報告してください。
まず ROADMAP.md のアート納品表と DECISIONS.md 2026-07-29(グラフィック4層) を読み、8/7のグラフィック方向性確定に向けて何を用意すべきか提案してください。
```

### D — ゲーム化開発
```
football-sim のゲーム化開発セッションです。PARALLEL_SESSIONS.md を読んで担当範囲とgit作法を守ってください。
私の担当は「ロジック・データ・UI機能」。絵/演出/img/cutscene.js/wideshot.js/portrait系はGセッションの担当なので触りません。
計画(ROADMAP/SCOPE/DECISIONS)は書き換えず、スコープ変更が必要なら実装せず報告してください。
まず BACKLOG.md の FN-00・MG-06・SN-08a・Sprint2の怪我持ち越し・SD-01・RW-01 を確認し、FN-00(表示名インダイレクション層)から着手してください。DECISIONS.md 2026-07-30 に方針があります。
```

### S — スケジュール（この運用の親）
```
football-sim のスケジュール確認セッションです。コードは書かず、gitログを一次情報に進捗を計画と突き合わせて報告してください。
```

## 引き継ぎ（週次）
G/D は節目で**完了タスクID＋コミットハッシュ**を S に報告（S が BACKLOG 完了マークと ROADMAP を更新）。S は週次で遅延判定・調整弁の発動可否を出す。
