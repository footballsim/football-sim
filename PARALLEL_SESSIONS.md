# PARALLEL_SESSIONS — 3セッション並行運用の契約

作成: 2026-07-30 ／ **同じワーキングツリーを複数セッションで共有するため、担当範囲を破ると commit 混入・上書き事故が起きる**。着手前に必ず本書を読む。

> ## ⚠️ 2026-08-13 改定 — 現在は単独運用（Codex 主・Claude Code 補助）
>
> 3セッション並行（S/G/D）は **2026-08-13 の体制転換で休止**。現在は1セッションずつの逐次運用。
> - **本書の S/G/D 役割分担・ファイル所有権・ハンク単位ステージは「並行運用を再開した時」のみ適用**。
> - **デプロイ調停ルールは D-2〜D-8 が引き続き有効**（`--branch` 明示・プリフライト・事後確認・ローカル優先）。
>   プリフライト D-4 は `npm run deploy:lab` が **`tools/deploy-guard.js` で機械実行**する（fail-safe＝判定不能なら止まる）。
> - **D-1（統合ブランチ `integ/lab` 経由）は単独運用では適用しない**＝作業ブランチから deploy-guard を通して出してよい。
>   `integ/lab` はこの改定時点で**未作成**。並行運用を再開する場合は、再開時に作成してから D-1 を復活させること。

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
  npx wrangler pages deploy dist-lab --project-name=kantoku-lab --branch=main   # integ/lab をチェックアウトした状態で
  ```
  ⚠️ **省略すると現在のブランチ名で Preview に入り「出したつもりで本番に反映されない」**。しかも **Preview URL は Cloudflare Access のサインインが要るので検証にも使えない**（＝逃げ場ではなく行き止まり）。
- **D-3 日常の確認は Cloudflare でなく**ローカル**で行う**（常設プレビュー `http://localhost:5175`／lab は `dist-lab` をローカル配信）。**Cloudflare へ出すのは節目だけ**＝衝突の"機会"そのものを減らす。
- **D-4 本番デプロイ前にプリフライト（機械判定・省略禁止）**＝「直前の本番が自分のHEADの祖先か」を確認する。祖先でなければ**相手の成果が乗っていない**＝出した瞬間に消える。
  ```bash
  npx wrangler pages deployment list --project-name=kantoku-lab | head -5   # 直前Productionのcommit shaを見る
  git merge-base --is-ancestor <直前Productionのsha> HEAD && echo "SAFE" || echo "DANGER=統合してから出す"
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
