# AGENTS.md — 開発の規約

football-sim をゲーム化（[GAME_PLAN.md](GAME_PLAN.md)）するための契約書。
**作業前に必ずこのファイルと [CLAUDE.md](CLAUDE.md)（＝プロジェクトの技術仕様。名前は由来にすぎない）を読む。**

> **2026-08-14 正式日程**: 9/30 Steam Coming Soon公開・ウィッシュリスト受付、11/13機能凍結、12/10 Windows版発売（12/17予備日）。日付は [ROADMAP.md](ROADMAP.md) が正本。

> **2026-08-14 包括委任（ユーザー正式決定）**: 凍結済みスコープ内の通常開発は、タスク分解から独立QA、`game-main`統合、build、`game-main` push、Basic認証中の`kantoku-lab`反映までCodexへ包括委任する。都度の人間承認は不要。Steam提出・公開・発売、価格/支払い/契約/秘密情報、権利・AI申告の最終確定、baseline・save schema・内部ID・duel logic、スコープ/日程変更だけを例外ゲートとして停止する。詳細は [PARALLEL_SESSIONS.md](PARALLEL_SESSIONS.md)。
> gitの書込操作は原則`npm run delegated:*`経由とし、`.codex/rules/football-sim.rules`と`tools/delegated-git.mjs`の変更自体は例外ゲートとする。

## 🔀 プロジェクト分離（2026-08-13 ユーザー決定）— **シミュレーターとゲームは別プロジェクト**

| | ブランチ | 公開先 | 状態 |
|---|---|---|---|
| **シミュレーター**（旧本番） | `main` | football-sim.com（GitHub Pages＝main の `docs/`） | **凍結アーカイブ・更新予定なし** |
| **サッカーゲーム**（開発中・唯一のアクティブプロジェクト） | **`game-main`** | kantoku-lab.pages.dev（`dist-lab/` を wrangler で直接デプロイ） | **開発の本流＝ここで作業する** |

- ⚠️ **`main` に触らない・push しない**（push すると GitHub Pages が走り football-sim.com が変わりうる）。
- 開発は **`game-main`**（または `game-main` から切る枝）で行う。旧 `feat/lab-ui-gamefeel` は `game-main` に改名相当（同一コミット）。
- `docs/` に関する規則（手編集禁止・差分は破棄）はアーカイブ保護として**引き続き有効**（`npm run check:docs` が機械検知）。

## 🧭 体制（2026-08-13〜）— **Codex が主・Claude Code が補助**

- **Codex**: 実装・設計・レビュー・画像生成の主担当。
- **Claude Code**: ブラウザ実機検証／回帰ハーネスの数値判定／Obsidian 外部脳への蒸留／デプロイ実行。
- ⚠️ **Claude Code 側のフック（`docs/` 手編集ブロック・js 編集後の `node --check`）は Codex には効かない**。
  ガードレール 2 番などは**規律で守る**こと。

**読む順**: 本ファイル → **[CODEX_HANDOFF.md](CODEX_HANDOFF.md)（地雷と実務則・引き継ぎの本体）** →
[SCOPE.md](SCOPE.md)（機能の正本）→ [ROADMAP.md](ROADMAP.md) → [BACKLOG.md](BACKLOG.md) → [DECISIONS.md](DECISIONS.md)。
複数セッションを同時に走らせる時だけ [PARALLEL_SESSIONS.md](PARALLEL_SESSIONS.md)（所有権・git 作法・**デプロイ調停**）。

**反映先は kantoku-lab.pages.dev のみ**（football-sim.com は 2026-07-03 から凍結中）。

---

## 絶対ガードレール（違反＝即ロールバック）

1. **デュエルカウント・ロジックに触れない**（既知の未解決バグ。怪我/退場は result を「フック」する加算実装に限定し、デュエル解決自体は書き換えない）。
2. **`docs/` を手編集しない**。配信用の難読化成果物。変更は root の `js/` / `index.html` / `css/` を直して `npm run build` で再生成。
3. **戦術・システムは実在するものだけ使う**。戦術は `POSSESSION / PRESS / COUNTER / CATENACCIO` の4種。`TACTICS_PRESSING` は存在しない。
   - システムは `system_data`（22件・js/players.js）に**載っている形だけ**。勝手に増やさない。
   - **表示名は `SYSTEM_GROUPS` の8区分＋A/B/C…**（例: `4-4-2B`／`systemLabel()` で引く）。
     `system_data[].name`（`4-3-1-2` 等）は**内部名**＝`TEAM_DATA.default_system` の引き当てキー。
   - **`system_data` の並び順と name は変えない**。配列 index はリーグセーブ（`_state.lineups[].systemIdx`）の
     キーなので、並べ替え/改名は保存済みの布陣を静かに別フォーメーションへ化けさせる。
4. **i18n は日英の両方**を必ず更新（`i18n` / `t()`、js/players.js）。片方だけ追加しない。
5. **新 screen は暗背景必須**（`linear-gradient(160deg,#003087,#0050cc,#1a7a3a)`）。白背景＋白文字は禁止。背景変更時は color も必ず明示。
6. **選手プロフィール禁止語**（日英）: FIFA / ワールドカップ / W杯 / World Cup / チャンピオンズリーグ / Champions League / 特定クラブ名。
7. **`?v=` は build が自動更新**。手で触らない。
8. **main に直接コミットしない**。機能ごとに worktree＋ブランチ。独立QAとReviewerが緑なら、例外ゲートに該当しない限りOが包括委任で`game-main`へ統合できる。
9. **1画面1ビート**（2026-07-27 ユーザー指示・プロジェクト全般）。**1つの画面の中で複数の情報処理を
   完結させない**。1画面には「問い」か「結果」のどちらか一方だけを大きく置き、タップで次の画面へ送る。
   - 詰め込むと画面が「文書」になり、**ゲームとしての迫力が死ぬ**（同種の指摘は 07-24 にも出た＝再発案件）。
   - 情報を足したくなったら **既存ページに追記せず「次のページを作る」**。
   - 出口は1画面につき1つ（順送りの途中に別の脱出ボタンを置かない）。
   - 「入らないからフォントや余白を詰める」を始めたら、それは**画面を分ける合図**。
10. **横持ちスマホは幅が余り高さが足りない**（kantoku-lab の主対象＝844×390 / 800×360 / 667×375）。
   - 列を畳む条件は **幅（max-width）だけ**。高さ条件で列を畳むと縦に伸びて逆効果。
   - 高さ制約のある面に `overflow: hidden` を使わない（下端が到達不能になる）。
   - grid/flex の中央寄せは **`safe center`**（素の `center` は溢れた先頭がスクロール範囲外に出る）。
   - 確認は `dist-lab/device-preview.html`（PCから端末切替＋キャッシュ無視リロード）。

---

## ロール（4枠の半自律チーム）

| 枠 | 責務 |
|---|---|
| **O / Orchestrator** | バックログ、依存順、ファイルリース、期限、統合、自律Ship、例外ゲート。**通常の機能コードは書かない** |
| **D / Gameplay Systems** | エンジン、リーグ、セーブ、データ、監督機能。専用worktreeで実装 |
| **X/P / Experience→Platform** | 9月までは黄金5画面・演出・画像・Steam素材、10月以降はWindows/Electron製品化 |
| **Q / Independent QA** | 原則read-onlyで回帰、保存、ブラウザ、権利、成果物を独立判定。修正は担当Writerへ差し戻す |

同時に書くエージェントは最大2体。ReviewerはWriter終了後に空いた枠へ別コンテキストで起動する。所有権、停止条件、人間専用操作は [PARALLEL_SESSIONS.md](PARALLEL_SESSIONS.md) が正本。

---

## スプリント・ループ（1機能=1周）

1. **Plan** — Orchestrator が [BACKLOG.md](BACKLOG.md) から次タスクを取る。
2. **Branch** — 最新`game-main`の固定SHAから、1タスク1ownerの `git worktree`＋`codex/`ブランチを作る。メインworktreeを共有編集しない。
3. **Implement** — 担当エージェントが root の `js/` のみ編集。
4. **Validate** — QA が下記ゲートを実行。失敗なら Implement に差し戻し（自動反復、上限3回で人間へエスカレーション）。
5. **Review** — Reviewer が本ファイル＋CLAUDE.md 準拠を確認。
6. **Standing Delegation Gate** — Oがスコープ内・停止条件なし・QA/Review緑・担当外差分なしを確認する。条件を満たせば人間確認を挟まず`game-main`へ統合する。
7. **Ship** — cleanな統合worktreeでfull gate → 必要時build → `game-main` push → Basic認証中の`kantoku-lab`へ正規経路で反映する。例外ゲート該当時だけ停止する。
8. **Log** — [DECISIONS.md](DECISIONS.md) にコミット・QA・反映証拠を追記し、BACKLOGを更新してから次スプリントへ進む。

---

## 検証ゲート（QA が必ず通すコマンド）

```bash
# 1. 構文
node --check js/players.js && node --check js/simulate.js && node --check js/narration.js

# 2. 統計的回帰（エンジンのバランス・イベント率がドリフトしていないか）
node tools/regression-harness.js check 1500
#   ✅ 回帰なし で通過 / ❌ 回帰検出 なら exit 1
#   意図したバランス変更時のみ baseline を更新: node tools/regression-harness.js baseline 2000

# 3. ブラウザ実起動（docs/ 配信を再現）— 変更がブラウザで観測できる場合のみ
#   preview football-sim-docs (port 5174) で起動確認
```

- 怪我/退場・新イベントを足したら、回帰ハーネスの「シーン結果種別 発生率」に新種別（カード率・怪我率）が増える。
  QA はその発生率が妥当域にあること＋既存の得点率/勝敗分布が許容差内に留まることを確認する（[tools/regression-harness.js](tools/regression-harness.js)）。
- バランスを意図的に変えた場合は PR にその旨を明記し、人間承認の上で baseline を更新する。

---

## チームの記憶

- [BACKLOG.md](BACKLOG.md) — スプリントとタスク（信頼できる唯一の作業リスト）。
- [DECISIONS.md](DECISIONS.md) — 採用した設計判断と理由（コンテキストが切れても引き継げる）。
- [GAME_PLAN.md](GAME_PLAN.md) — 方針の母艦。
