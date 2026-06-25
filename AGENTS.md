# AGENTS.md — 自走改善チームの規約

football-sim をゲーム化（[GAME_PLAN.md](GAME_PLAN.md)）するための複数エージェント運用の契約書。
**各エージェントは作業前に必ずこのファイルと [CLAUDE.md](CLAUDE.md) を読む。**
本番 football-sim.com は稼働中。自律はPRまで。main へのマージと本番反映は人間が承認する。

---

## 絶対ガードレール（違反＝即ロールバック）

1. **デュエルカウント・ロジックに触れない**（既知の未解決バグ。怪我/退場は result を「フック」する加算実装に限定し、デュエル解決自体は書き換えない）。
2. **`docs/` を手編集しない**。配信用の難読化成果物。変更は root の `js/` / `index.html` / `css/` を直して `npm run build` で再生成。
3. **戦術・システムは実在するものだけ使う**。戦術は `POSSESSION / PRESS / COUNTER / CATENACCIO` の4種。`3-5-2` / `4-3-3` / `TACTICS_PRESSING` は存在しない。
4. **i18n は日英の両方**を必ず更新（`i18n` / `t()`、js/players.js）。片方だけ追加しない。
5. **新 screen は暗背景必須**（`linear-gradient(160deg,#003087,#0050cc,#1a7a3a)`）。白背景＋白文字は禁止。背景変更時は color も必ず明示。
6. **選手プロフィール禁止語**（日英）: FIFA / ワールドカップ / W杯 / World Cup / チャンピオンズリーグ / Champions League / 特定クラブ名。
7. **`?v=` は build が自動更新**。手で触らない。
8. **main に直接コミットしない**。機能ごとに worktree＋ブランチ。統合は人間ゲート経由のみ。

---

## ロール（チーム編成）

| ロール | 責務 | Claude Code 上の実体 |
|---|---|---|
| 監督 / Orchestrator | バックログ管理・タスク分解・順序付け・ゲート執行。**コードは書かない** | `/loop`（自己ペース）or `/schedule` の定期ティック |
| Engine | エンジン側ロジック（怪我/退場・相手AI・イベントログ） | `Agent` + `feature-dev:code-architect`、`isolation: worktree` |
| Renderer | 漫画マッチアップ・レンダラ＋アセット | `Agent`、別 worktree、`run_in_background` で並行 |
| QA | 回帰ハーネス＋ preview(5174) で客観合否 | `Agent`（下記コマンド） |
| Reviewer | 本ファイル＋CLAUDE.md 準拠チェック | `Agent` + `feature-dev:code-reviewer` |

---

## スプリント・ループ（1機能=1周）

1. **Plan** — Orchestrator が [BACKLOG.md](BACKLOG.md) から次タスクを取る。
2. **Branch** — `git worktree` で機能ごとに隔離（Engine ∥ Renderer は別 worktree で並行）。
3. **Implement** — 担当エージェントが root の `js/` のみ編集。
4. **Validate** — QA が下記ゲートを実行。失敗なら Implement に差し戻し（自動反復、上限3回で人間へエスカレーション）。
5. **Review** — Reviewer が本ファイル＋CLAUDE.md 準拠を確認。
6. **人間ゲート** — PR要約＋証拠（回帰差分・preview スクショ）を提示。**承認されるまで build/push しない**。
7. **Ship** — 承認後に `npm run build` → preview(5174) で実起動確認 → commit & push。
8. **Log** — [DECISIONS.md](DECISIONS.md) に判断と理由を追記し、BACKLOG を更新。次スプリントへ。

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
