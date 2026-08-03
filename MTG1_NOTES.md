# MTG1 実装ノート — 第1回面白さMTG採用分（2026-08-03）

議事録: [MEETINGS/2026-08-03_01.md](MEETINGS/2026-08-03_01.md)（※共有ツリー側。worktreeには未含）
実装場所: **隔離worktree `~/football-sim-mtg1`・ブランチ `meeting-01-impl`**（分岐点 ad2aa5f）

## 戻し方（3段階）

| レベル | 操作 | 効果 |
|---|---|---|
| 即時OFF | ブラウザで `window.MTG1_XXX = false`（下表）/ 恒久は該当jsの先頭フラグ | 実行時に機能単位で無効化 |
| 項目単位 | `git revert <該当コミット>`（コミットは `[MTG1-#N]` プレフィックスで項目単位） | コードごと除去 |
| 全部なし | `git worktree remove ../football-sim-mtg1 --force` ＋ `git branch -D meeting-01-impl` | 実装全体を痕跡なく破棄（共有ツリーは元から無風） |

## キルスイッチ一覧

| 項目 | フラグ | 新規ファイル |
|---|---|---|
| #1 采配の答え合わせ | `MTG1_ANSWER` | js/attribution.js |
| #2 ドラマスコア/テンポ | `MTG1_DRAMA` | js/dramascore.js |
| #3 デイリーレール | `MTG1_RAIL` | js/rail.js |
| #4 アーカタイプ/生え抜き | `MTG1_ARCH` | js/archetype.js |
| #5 推し指名/言葉化 | `MTG1_OSHI` | js/oshi.js |

## 設計原則（全項目共通）
- **新規ファイル主体＋共有ファイルへは typeof ガードの最小フックのみ**（cutscene.js はGセッションの未コミットWIPが+1578行あるため**直接編集禁止**＝グローバルAPI呼び出しで済ませる）
- 全て lab 限定（build.js の LAB_ONLY_JS 登録済み）。本番 docs/ は挙動不変
- デュエル解決式・カウント不可侵。rng新規消費ゼロ。バランス変更なし（#1は記録と言い換えのみ）
- 検証: node --check ＋ regression-harness（エンジン隣接は check 1500）＋ 項目別 headless テスト（tools/mtg1-*.js）

## 共有ツリーへの統合時に必要な作業（マージ担当への申し送り）
1. `_league_dev.html` は未追跡ファイルのため本ブランチに含まれない。**共有ツリー側の _league_dev.html に以下のタグを追記**（league.js の直後）:
   ```html
   <script src="js/attribution.js"></script>
   <script src="js/archetype.js"></script>
   <script src="js/dramascore.js"></script>
   <script src="js/rail.js"></script>
   <script src="js/oshi.js"></script>
   ```
2. build.js の LAB_ONLY_JS 追記はコミット済み（共有ツリー側の未コミット変更+7行と小さな競合の可能性→手動マージ）
3. simulate.js のフックは最大数行（共有ツリーのG未コミット+11行と独立のはず→要確認）
4. SCOPE/BACKLOG への正式登録は S セッションが実施（本worktreeでは計画文書を編集しない）

## 未実装・別枠
- #5 のうち SCOPE トレード（★C管理機能の格下げ・MG-13/14/15凍結・主人公選手の正式昇格）は**計画変更＝ユーザー+Sセッション専管**。ここでは実装のみ
- engine-B（モメンタム資源戦）= Sprint 3 と統合設計で再上程
- engine-C（終盤の賭け指示）= 4戦術ルール境界のユーザー承認待ち

## 動作確認ページ（2026-08-04 追加）

**遊ぶなら `_lab.html`**（`index.html` から生成＝本番と同じ全DOM＋lab用js＋MTG1の5本）。
- `_lab_base.html` = MTG1の5本だけ抜いた比較用（「MTG1のせいか」を切り分ける時に使う）
- 起動: worktree で `python3 -m http.server 5621` → http://localhost:5621/_lab.html

### ⚠ `_league_dev.html` では試合に入れない（MTG1とは無関係の既存事象）
`_league_dev.html` は「最終話再設計」用の最小シェルで、**`#screen-setting` を含む試合系DOMを持たない**（`.screen` は `screen-home` のみ）。
そのため キックオフ → `playToday()` → `initSettingScreen()` が
`Cannot set properties of null (setting 'textContent')`（simulate.js:1142）で沈黙のまま停止する。
**MTG1のキルスイッチを全部OFFにしても・5本を読み込まなくても同じ**＝ハーネス側の元からの制約。
検証は `_lab.html` で行うこと。
