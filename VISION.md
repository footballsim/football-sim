# VISION — football-sim を「監督として読む、週刊連載のサッカー漫画」へ

最終更新: 2026-06-29

本書は football-sim を**新しいサッカーゲーム**へ拡張する製品ビジョン（なぜ・何を）。
方針は [GAME_PLAN.md](GAME_PLAN.md)、作業は [BACKLOG.md](BACKLOG.md)、自走規約は [AGENTS.md](AGENTS.md)、判断ログは [DECISIONS.md](DECISIONS.md)。
本書は GAME_PLAN.md（監督体験＋漫画マッチアップ）を**包含して一段拡張**する上位ビジョン。既存エンジン・IP・回帰ハーネスの制約は全て踏襲する。

---

## 0. 一言ビジョン
**「週刊連載のサッカー漫画を、自分が監督として“読む”ゲーム」**

`simulateChance()` は90分連続でなく **1対1デュエルの離散コマ**を吐く（js/simulate.js:2252）。1試合≈16チャンス≈16〜30コマ＝**漫画1話**。1シーズン＝連載。1日1試合＝毎日最新話が届く。エンジンの構造そのものが本企画の核。

## 1. コンセプト（3つの主語）
- **主人公＝監督（プレイヤー本人）**。采配＝「読んで・考えて・決める」レバー。操作スキル不要＝USPと同じ脳の使い方。
- **感情の錨＝主人公選手**（操作対象でなく“推し”）。新星→全盛→引退を追う縦糸。毎日来る最大の理由。
- **連載の駆動＝宿敵監督AI**。複数シーズンの因縁。

**設計原則：采配が選手ドラマを駆動する**（選手主人公の“熱”を監督の主体性のまま取り込む）
- **決定機の采配** … 主人公の決定機で「勝負させる／繋がせる」を選ぶ（介入点）。
- **マークを剥がすパズル** … `marked_player`（既存）で消された主人公を、布陣・キープレイヤー・戦術で解放。
- **キープレイヤー指名** … `keyplayer`（既存・選択重み×2.5）で「今日はこいつに賭ける」。
- **覚醒メーター** … 主人公の勢いを喝・交代で指揮（読み取り時の係数＝回帰セーフ）。

## 2. USP（4要素の交差点・誰も同時に持たない）
本物の確率エンジン（深さ）× 漫画演出（感情）× AIが書く生きた世界（鮮度）× 1日1話の連載（習慣）。
- vs FM＝数値管理でなく物語。vs FC/eFootball＝操作でなく観戦＋采配（スキル不要＝市場拡張）。
- 成長エンジン＝**シェア可能な名場面コマ**（`generateShareImage` 流用）。
- 一言: *The football manga that writes itself around your decisions — one chapter a day.*

## 3. コアループ＆リテンション
**毎日来る7フック**: 連載の続き（次回予告）／主人公の成長／順位・目標／寝てる間の世界更新（SNS・ニュース）／定刻キックオフ／やさしい連続記録／欠席は自動消化＝“読み逃し”FOMO（生活を壊さない）。
**デイリーループ（8〜15分）**: ホーム(前回あらすじ＋世界更新) → 試合前(布陣/戦術/一言) → KICKOFF(読む試合＋介入点2〜3) → 試合後(結果/MOM/AIレポート・SNS/順位) → 次回予告。
**メタ**: リーグ進行 → 移籍/育成 → 世代交代。**長期**: 連載アーク／名場面“単行本”／ソーシャル／LiveOps／「やめたら物語が止まる」。

## 4. MVP（検証仮説＝D7継続率「続きを読むために明日戻るか」）
1クラブ・1シーズンの縦切り。**IN**: 漫画試合ビューア＋介入点／試合前最小選択／試合後AI(レポート+SNS+次回予告)／リーグ順位(`tournament.js`流用)／主人公+宿敵+クリフハンガー／コンディション最小／永続化+1日1試合ロック／名場面シェア。**PWA(モバイルWeb)ファースト**。

## 5. MVPで削る
移籍/育成/複数シーズン/記者会見・面談のシステム化/課金インフラ/マルチプレイ/Steam・ネイティブ/48チーム全実装/高度な相手監督AI/怪我退場(or軽量版に留める)/**ライブ実況のLLM化（コスト爆発・テンプレ据置）**。

## 6. 画面一覧（★MVP）
ホーム★／試合前★／記者会見／試合ビューア★／結果★／レポート・SNS★／次回予告★／順位・日程★／スカッド★／選手詳細／監督プロフィール／名場面アーカイブ★／オンボ★／アカウント★／設定★／移籍／育成／面談／殿堂／ストア／フレンド。全画面 暗背景・日英i18n。

## 7. データ設計（既存29パラメータ・TEAM_DATA・system_data を壊さず拡張）
- **Player**: 既存(params29/positions/height) ＋ id/personalityId/age/potential/growth/form/morale/fatigue/condition/contract/seasonStats/story(isProtagonist…)
- **Manager(本人)**: clubId/reputation/styleProfile/career/currency/seasonGoals/decisionLog
- **Club**: 架空名/colors/badgeSeed/squad/tacticsPresets/league/rivals/finances/fanMood/honors
- **Tactics（実在のみ）**: system_data ＋ POSSESSION/PRESS/COUNTER/CATENACCIO ＋ keyplayer ＋ markedPlayer ＋ inMatchPlan。※3-5-2/4-3-3/TACTICS_PRESSING は戦術ではない
- **Match**: seed★/home・away/input/events[]/decisions[]/result/ratings/narrative
- **Event（キーストーン）**: kickoff|chance|duel|shot|goal|save|foul|card|injury|sub|tacticChange|HT|FT — 描画/AI/統計が全部購読
- **Season / Development / Ability(29次元＋form・condition は読み取り時合成) / Personality(traits/voice/relations) / News / SNS / MangaStaging(scene→panel)**

## 8. システム設計
### エンジン組み込み
原則: ①デュエル解決不可侵 ②エンジンはクライアント実行・サーバーは seed 再計算で検証 ③イベントログが唯一の真実。
前提工事(=Sprint0): イベントログseam＋シードRNG。ラッパー `playMatch(home,away,tactics,seed)`。唯一のエンジン隣接変更＝一括事前計算を**チャンス逐次実行**にし、介入点で入力(lineup/tactics)だけ差し替え（確率式 `ofs²/(ofs²+dfs²)` 不変＝回帰緑）。
### アーキテクチャ（推奨 Cloudflare）
フロント: 既存 vanilla JS 試合エンジン＋Canvas演出を流用（`players.js` 6.3MB は要分割）・PWA。バックエンド: Workers＋Durable Objects(1日1試合ロック/状態)。DB: D1(構造化)/KV(セッション・デイリーロック・順位)/R2(生成コマ・シェア画像)。AI: Claude API・**ライブはテンプレ／試合後だけLLM**・Haiku中心・バッチ+キャッシュ・**1試合あたりコスト上限を仕様化**。認証: 匿名ID→OAuth昇格。課金: Stripe/RevenueCat/Steam後・**非pay-to-win**。

## 9. ロードマップ（P1〜P10）
P1基盤(イベントログ/seedRNG/playMatch) ／ P2試合ビューア(逐次実行・漫画・介入点・采配ドラマ) ／ P3デイリーループ＆永続化 ／ P4 AIリビングワールドI ／ P5物語・キャラI ／ P6 MVPリリース＆計測 ／ P7監督UX深化 ／ P8メタ進行 ／ P9マネタイズ＆ソーシャル ／ P10スケール＆グローバル。**P1〜P6＝MVP（≈1.5〜2ヶ月目安）**。詳細タスクは [BACKLOG.md](BACKLOG.md)。

## 10. リスク
- **技術**: seedRNG全域改修(回帰で守る)／介入の逐次化でデュエルに触れる誘惑／AIコスト爆発／AI安全性・IP／静的→状態移行／モバイル資産肥大／決定論vs不正(seed再計算で検証)。
- **設計**: 1日1試合が薄い／演出テンポ／「操作したい」期待ズレ／AI均質化／初日が弱い。
- **運営**: ソロ依存／LiveOps供給／AI提供者ToS・コスト／課金反発／モデレーション／ストア審査。

## 11. 改善提案（世界ヒットへ）
連載=週刊ジャンプを商品の魂に／主人公選手システム／名場面コマを成長エンジンに／**AIコスト設計を仕様で先に固定**／実況・解説者をレギュラーキャラ化／宿敵を多シーズンの敵役／VOICEVOX音声(ai-monetize資産流用)／シーズン“単行本”の自動生成／倫理的リテンションをブランド化／定刻キックオフ／アクセシビリティを市場拡張と位置づけ／要明示=プレイヤーファンタジー・D7仮説・非pay-to-win設計。

---
本書は方向の母艦。実装は BACKLOG.md / AGENTS.md の人間ゲート運用に従う（main直コミット禁止・PR/証拠→人間承認→build→push）。
