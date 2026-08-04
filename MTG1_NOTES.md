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

## 2026-08-04 ユーザー判断による変更

| コミット | 内容 |
|---|---|
| `[MTG1-8]` | **fix** マーク対象が相手先発にいない問題（リーグ）。56組中19組(34%)で死んだ采配だった |
| `[MTG1-9]` | **廃止** 「攻め筋への対策」一式（ビデオ学習・HTコーチ助言・managerParamFactor） |

### 廃止の理由（ユーザー判断 2026-08-04）
「ライトユーザーにはややこしいし、実際のサッカーでもそういった対策はあまりしない」。
加えて実測（`tools/mtg1-video-effect-probe.js`＝資料として保存・現在は動かない）で
**効果が観測限界以下**だった: 5%×戦術眼/100 ＝初期値+1%。4000試合で差 **0.00pt**、
戦術眼100でも +2.18pt に対し1試合のばらつきは **±14.9pt**（有意化に約180試合＝1シーズン14試合では不可能）。

### 残課題
- ⚠️ **シングル/W杯に同種のマークバグが残る**（simulate.js:3682付近・manager-match.js:165）。
  本番凍結中のため未修正。凍結解除時に `_validMarkedPlayer` 相当を simulate.js 側へ移すのが本筋。
- simulate.js:2410 のコメントが古い（「ビデオ学習の対策 buff」）＝共有ファイルなので未修整。
- css/league-ui.css に孤児クラス（`.lg-scout-chk` 等）。出力されないので実害なし。
- マーク自動差し替え時の通知（設定画面トースト）は未実装＝要否はユーザー判断。
