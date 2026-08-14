# CODEX_HANDOFF — Codex を主開発者にするための引き継ぎ

作成: 2026-08-13 ／ 起点: **ユーザー方針「今後は Codex をメイン・Claude Code を補助にする」**

> **このファイルの位置づけ**: Codex は起動時に `AGENTS.md` を自動で読む。`AGENTS.md` は「守るべき規約」だけを短く保ち、
> **本書は「規約の外にあった暗黙知」＝これまで Claude Code 側のメモリ（`~/.claude/.../memory/`）にしか無かった知識をリポジトリへ移植したもの**。
> ★ **移植の理由**: そのメモリは Claude Code のセッションにしか自動ロードされない＝**Codex からは原理的に見えない**。
> 引き継ぎで最大の欠落はここだった（計画・スコープは既に repo にあり、欠けていたのは「地雷の場所」）。

---

## 0. 最初に読む順番（Codex 新セッションの起動手順）

1. `AGENTS.md` — 絶対ガードレール（違反＝ロールバック）
2. **本書（CODEX_HANDOFF.md）** — 地雷と実務則
3. `SCOPE.md`（機能スコープの正本）→ `ROADMAP.md`（日程）→ `BACKLOG.md`（作業）→ `DECISIONS.md`（判断の履歴）
4. `PARALLEL_SESSIONS.md` — **複数セッションを同時に走らせる場合のみ**（ファイル所有権・git 作法・デプロイ調停）
5. `CLAUDE.md` — 名前は Claude 由来だが**中身はプロジェクトの技術仕様**（ファイル構成・関数の在処・ビルド/インフラ）。Codex も読む。

**まず打つコマンド**（現状把握・破壊なし）:
```bash
cd ~/football-sim && git log --oneline -5 && git status --short | head -30 && git branch --show-current
```

---

## 1. 役割分担（2026-08-14 Steam日程に更新）

| | 担当 |
|---|---|
| **Codex（主）** | 実装全般・設計・リファクタ・レビュー。画像生成（`codex exec` で ChatGPT サブスク内・API 課金ゼロ）も担当 |
| **Claude Code（補助）** | ブラウザ実機検証（preview/ヘッドレス操作・スクショ）、回帰ハーネスの実行と数値判定、Obsidian 外部脳への蒸留、横断的な調査、デプロイ実行 |

Codex内の並行実行は **O / D / X-P / Q の最大4枠**。2026-08-14の包括委任により、正式スコープ内は実装・検証・独立レビュー・`game-main`統合・build/push・Basic認証中のkantoku-lab反映まで自走する。Steam提出/公開/発売、価格/契約/秘密、権利・AI申告の最終確定、baseline/save schema/内部ID/duel logic、スコープ/日程変更だけは人間承認後に限る。1タスク1worktreeで、同じworking treeを共有しない。詳細は [PARALLEL_SESSIONS.md](PARALLEL_SESSIONS.md)。

- **正本はリポジトリの `.md` 群**。会話やメモリに依存した引き継ぎはしない（今回の反省）。
- **Claude 側の独自資産**（残るもの）: `~/.claude/agents/` のサブエージェント9体（qa-regression / reviewer / asset-qa 等）、`/deploy` スキル、js 編集後 `node --check` の自動フック、`docs/`・`dist-lab` 手編集のブロックフック。
  ★ **フックは Claude Code のセッションにしか効かない**。その代替として**ツール非依存の npm ゲート**を用意した（2026-08-13）:
  ```bash
  npm run check        # js/*.js 全構文チェック（js 編集のたびに実行）
  npm run check:docs   # docs/ の追跡ファイルに差分が積もっていないか（手編集/ビルド副産物の検知）
  npm run regression   # 回帰ハーネス（エンジン/バランス変更は regression:full=1500）
  ```
  `npm run deploy:lab` は docs-guard → deploy-guard（プリフライト）を通ってから wrangler が走る。**wrangler の直叩き禁止**。
- **Codex 側の自動発火**: `~/.codex/skills/football-sim/SKILL.md` — football-sim の話題で自動ロードされ、読む順・ガードレール要約・上記ゲートを Codex に強制する。恒久ルールを追加したら repo（本書/AGENTS.md）と**このスキルの両方**を更新する。
- **Codex 側の実行許可**: `.codex/rules/football-sim.rules` — プロジェクトがtrustedな場合、引数を固定検証する`npm run delegated:*`だけを都度確認なしで許可する。直接git書込はprompt、`git add ./-A`、reset/clean、force push、`main` push、`npx`/`npm exec`/wrangler直叩きは機械的に禁止する。gateway本体は`tools/delegated-git.mjs`で、その変更自体は例外ゲート。OpenAI Docsの仕様上、新規rulesはCodex再起動後に確実に読み込まれる。

---

## 2. いま触ると壊れるもの（★ = 実害が出た事故）

### 2-1. データ構造（静かに壊れる＝エラーが出ない）
- ★ **`system_data`（js/players.js・22件）の並び順と `name` を変えない**。配列 index が**リーグセーブ `_state.lineups[].systemIdx` のキー**＝並べ替え/改名で**保存済みの布陣が別フォーメーションに化ける**。見せ方を変えたい時は `SYSTEM_GROUPS` / `systemLabel()`（表示層）だけを触る。
- ★ **セーブ v4 の `squads[クラブ][選手名]`＝選手名が主キー**。成長/怪我/出場を保持しているので、**選手名やクラブを実データごと差し替えると保存データが全損**（エラーは出ない）。→ 対策が `FN-00 表示名インダイレクション層`（`long_name` を内部IDに据え置き、表示名だけマッピング）。**架空化(FN-01/02)より先に FN-00 を入れる**という順序はこの理由。
- ★ **リーグの `team1Data`/`team2Data` は overlay の clone**。`TEAM_DATA[k] === team1Data` の**参照一致でキーを逆引きすると静かに壊れ、選手詳細が日本選手に落ちる**（3回再発）。**`_srcKey` から「読む瞬間に導出」**する（`getTeam1DataKey()`）。
- ★ **同型の原則＝「状態を書くタイミングで正すな、読む瞬間に導出せよ」**。キャプテン指名も同じ（`effectiveCaptainIdx` / `autoCaptainIdx()` に集約）。入口が増えるたびに同期処理を足す設計は必ず再発する。
- `match.js` の `_buildSide` は state を組み直す。**新しい state フィールドを足したら `_buildSide` も通す**（キャプテン指名が createMatch 経路で静かに落ちていた）。

### 2-2. 進行・描画
- ★ **rAF に「ゲームの進行」を載せない**。`requestAnimationFrame` は**タブ/ペインが非表示だと発火しない**＝カットシーン中に画面を消すだけで復帰不能になる（スマホの着信で普通に起きる）。演出の都合に進行を相乗りさせない。
- 同じ理由で **ブラウザペインが前面に無いと canvas 検証のスクショが白紙になる**。検証時は `document.hidden` を確認し、必要なら `performance.now` と `requestAnimationFrame` を差し替えて**手でコマを進めるステッパー**を注入する。
- **DOM 停止条件に `DOMNodeRemovedFromDocument` を使わない**（現行 Chrome で発火しない＝rAF ループが積み上がる）。`isConnected` を使う。
- **リカラー/ピクセル化のキャッシュキーは「絵が違えば必ず違う」ことを担保**（ポーズIDを含め忘れて GK ダイブの新旧ポーズが混ざった）。
- **画像を同一URLで差し替えたら js 内 `src` の `?v=` を手で上げる**。build の自動 `?v=` は `index.html` の JS/CSS タグにしか効かず**画像URLには効かない**。検証は `_cutsceneCache[src].naturalWidth`（目視不可）。
- `drawSprF` はリカラー後の canvas を受けるので、早期 return 判定は **`naturalWidth || width`**（`naturalWidth` だけだと描画されない）。

### 2-3. UI / レイアウト
- **1画面1ビート**（AGENTS.md 9番）＝最上位の設計原則。「入らないからフォント/余白を詰める」を始めたら**画面を分ける合図**。
- **横持ちスマホは幅が余り高さが足りない**（AGENTS.md 10番）。列を畳む条件は**幅だけ**。中央寄せは `safe center`。検証は `lab/device-preview.html`（**iframe 必須**＝メディアクエリは実ウィンドウを見るので、画面内に小枠を描くだけでは発火しない）。
- 共有画面（`#screen-setting` / `#halftime-modal`）をリーグ限定に作り替える時は**DOM を増やさずクラス（`.league-prep` / `.league-ht`）でスコープし、離脱時に必ず外す**。インライン style の要素には `!important` が要る。absolute 化したら親の `grid-template-rows` も直す。

### 2-4. 検証
- ★ **回帰ハーネスは未シード＝同じコードでも実行ごとに振れる**。**単発の赤はノイズ**。赤が出たらまず再実行、揺れるなら `check 1500` で判定。エンジン/バランス変更は最初から 1500。
- 旧 `sim_test.js` / `calibrate_large.js` は 2026/06/02 の js 分割以降**動かない**。**正は `tools/regression-harness.js check`**。
- ★ **絵の良し悪しを目視で判断しない**。明度・彩度・ブロック幅は測れる（単発フレームは不可＝数フレーム平均。衝撃フラッシュを拾って逆の結論を出した実績あり）。
- ★ **生成画像の受入は二重チェック**＝機械比較（`asset_accept.py` 等）に加えて**別系モデルの独立レビュー**。asset-qa が PASS したのに Codex レビューが FAIL で、**実検証では Codex が正しかった**（手の変形・顔ブレが実在）。
- **「指摘された欠陥だけの検出器」を積み上げない**（新種を毎回見逃す）。チェックリスト外のオープンエンドな異常探索を必ず1観点入れる。

---

## 3. ビルド・デプロイ（ここが一番事故る）

```bash
npm run build          # root の js/ index.html css/ img/ → docs/ を生成（難読化・?v= 自動更新）
npm run deploy:lab     # deploy-guard → wrangler pages deploy dist-lab --project-name=kantoku-lab --branch=main
```

- **本番 football-sim.com は凍結中**（2026-07-03 ユーザー指示）。実装の反映先は **kantoku-lab.pages.dev のみ**。
  - 新規 js は `build.js` の `LAB_ONLY_JS` へ追加／共有 js のフックは `typeof` ガードで no-op ／**build 後の `docs/` 差分は破棄**。
- ★ **Cloudflare Pages の本番エイリアスは1本＝デプロイは「マージ」でなく「置き換え」**。別ブランチから出すと**相手の成果が丸ごと消える**（git は衝突しないので既存の作法では防げない・2026-08-05〜06 に3往復の実害）。
  - `dist-lab/` は gitignore ＝**誰かのローカルの状態がそのまま本番になる**。相手のコードは**マージして再ビルドしない限り成果物に入らない**。
  - `--branch` を省略すると**現在の git ブランチ名で Preview 行き**＝出したつもりで反映されない。しかも **Preview URL は Cloudflare Access のサインインが要るので検証にも使えない**（行き止まり）。
  - **プリフライト（省略禁止）**:
    ```bash
    npx wrangler pages deployment list --project-name=kantoku-lab | head -5
    git merge-base --is-ancestor <直前Productionのsha> HEAD && echo SAFE || echo DANGER
    ```
  - 事後確認は**自分の機能＋相手の機能の両方**（no-cache ヘッダ必須）。自分の機能だけ見て「出た」と判断しない。
- **日常の確認は Cloudflare でなくローカル**: 常設プレビュー **http://localhost:5175**（launchd 常駐・演出ラボは `/_scene_lab.html`）。docs 配信の確認は port 5174。

---

## 4. リポジトリ状態（2026-08-13 棚卸し済み）

- **開発の本流 = `game-main`**（2026-08-13 新設・旧 `feat/lab-ui-gamefeel` と同一コミット）。
  **プロジェクト分離（同日ユーザー決定）**: シミュレーター（football-sim.com＝`main`＋`docs/`）は**凍結アーカイブ・更新予定なし**。
  アクティブなのはサッカーゲーム（kantoku-lab）のみで、**作業は常に `game-main` 系で行う**。
  ⚠️ **`main` に push しない**（GitHub Pages が走り football-sim.com が変わりうる。ローカル `main` には未 push のコミットが数個あるが、これも凍結のまま放置が正）。
- 2026-08-13 に棚卸しを実施:
  - `docs/` の再ビルド差分は破棄（規約どおり）。
  - 計画・契約ドキュメント（`PARALLEL_SESSIONS.md` `DESIGN_SYSTEM.md` `MEETINGS/` `design/*.md` 等）を追跡化してコミット。
  - 未追跡だったソース（`js/bg3d.js` `js/ctmatch.js` `js/portrait_pixel.js`・ラボ/検証用 HTML・`mocap/`）をコミット。
  - `.gitignore` に作業中間物を追加（`_incoming/`・`design/codex-mockups/`〈68MB のモック画像〉・`tools/proto/` の QA 証跡類・`.DS_Store`）。
    ★ **ignore された画像はローカルにしか無い**＝`design/codex-mockups/` と `tools/proto/` の承認済みベース素材は消さないこと（正典アセットは `img/` に tracked で存在する）。
  - **`integ/lab` 問題は「ブランチを作る」でなく「ルール側を直す」で解消**: 単独運用中は D-1 不適用（PARALLEL_SESSIONS.md 冒頭の 2026-08-13 改定を参照）。プリフライトは `npm run deploy:lab` の deploy-guard が機械実行する。
- **`docs/` 配下の未追跡ファイル（build が img/ から複製した画像等）は意図的に untracked のまま**＝本番 push を再開する時に build 成果物としてまとめてコミットする。**ignore しない**こと（ignore すると再開時のコミットから漏れる）。

---

## 5. 未完了スレッド（BACKLOG より粒度の粗い「今の関心」）

- **8/7 のグラフィック方向性確定**（4層 S/M/C/U）— ROADMAP のアート納品①（8/8〜8/20）の前提。
- **D トラックの配管**: `FN-00`（最優先）・`MG-06` コーチ陣・`SN-08a` soft加齢・怪我/停止の持ち越し本体・`SD-01` 効果音・`RW-01` SNSフィード。
- **層C（顔アップ）用の高精細素材の発注仕様**＝既存のマンガ素材は粗スタイルで統一済みのため**流用不可**（実測で確定）。
- **sprite-studio のキーポーズ式アニメ量産**（`~/sprite-studio/`）— クロス6コマは手の変形・顔ブレで**未達のまま**。
- マイルストーン（2026-08-14正式改定）: **9/30 Steam Coming Soon公開／11/13機能凍結／11/30製品ビルド審査提出／12/10 Windows発売（12/17予備日）**。

---

## 5-2. Codex セッション起動用プロンプト（コピペ用）

```
football-sim の開発セッションです。~/football-sim で作業します。
AGENTS.md → CODEX_HANDOFF.md → SCOPE.md → BACKLOG.md の順に読んでから着手してください。
反映先は kantoku-lab のみ（football-sim.com は凍結中）。docs/ は build 成果物なので手編集しません。
まず `git log --oneline -5` と `git status --short` で現状を把握し、今日やることを提案してください。
```

---

## 6. 外部の関連リソース

- **外部脳（Obsidian）**: `~/Documents/2nd-Brain/football-sim.md` — 日付ごとの「現在地」と意思決定の物語。**repo の .md より文脈が厚い**ので、経緯を知りたい時はここ。
- **量産パイプライン**: `~/sprite-studio/`（キーポーズ→補間→一括生成→検査）。
- **画像生成**: `codex exec` で ChatGPT サブスク内・API 課金ゼロ。出力は `~/.codex/generated_images/`。
- **macOS の制約**: `~/Downloads` はシェルから読めない（`Operation not permitted`）。ファイル受け渡しは **`~/football-sim/_incoming/`** へ。
