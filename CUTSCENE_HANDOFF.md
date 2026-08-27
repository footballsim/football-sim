# CUTSCENE_HANDOFF — 試合演出の再開台帳

最終更新: 2026-08-27
対象: 試合パートの新規・差替え画像、Scene Lab、本編への演出接続。

> **再開時の最優先正本**: 試合演出を生成・修正・配線・比較する前に必ず本書を読む。
> `DECISIONS.md` は経緯、`BACKLOG.md` は計画だが、**各シーンの現在の採否・次に許される作業は本書が正本**とする。
> 不明な状態、採否が書かれていない候補、または本書にない過去の画像は、採用候補として再利用しない。先にユーザーへ確認する。

## 共通の制作・採用ルール

- 試合画像は、ユーザーの明示的な目視採用があるまで `game-main` への統合、build、push、deployをしない。Scene Labの比較用に置くだけでも「採用」にはならない。
- 実写参照を使う場合は、**連続した元動画のフレーム上に直接**、頭・肩・肘・手首・骨盤・膝・足首・つま先・ボールを重ねて記録する。支点脚は緑、蹴り脚はマゼンタで識別する。推測した棒人間や別ポーズへの抽象化を先に作らない。
- 生成前に、動画URL・確定タイムコード・6コマの骨格オーバーレイをユーザーへ提示する。ユーザーがポーズを確認してから、画風変換／画像生成へ進む。
- 体型は [design/PLAYER_BODY_CANON.md](design/PLAYER_BODY_CANON.md) の5.6頭身カノンを必ず使う。頭だけ／身体だけを変形して調整しない。
- セッションをまたいで再開する時は、外部脳 `~/Documents/2nd-Brain/football-sim.md` の対象シーンを検索し、経緯と失敗理由を本書・承認台帳へ接続する。採否・数値契約・禁止入力は本書とリポジトリ台帳を優先し、外部脳が古い場合はそのまま正本扱いしない。

## シーン別の現在地

| シーン | 現在の状態 | 正本・禁止事項 | 次に許される作業 |
|---|---|---|---|
| クロス（左足・6コマ） | **採用済み・Lab/本番候補の動作を反映済み** | 左足=蹴り足、右足=軸足、最終コマは左足がscreen-right、右足がdown-left。奥の左腕は肘を曲げて後方。人物・ボールは左から右へ78px移動、接触後にボールが加速し660msで右端へ退出。縮小カメラ効果は不採用。ユーザー採用済みの6枚以外へ戻さない。 | 新たな変更は別のユーザー目視ゲートから。 |
| 通常シュート | **採用済み・復元済み** | 通常試合は `67263a2^` 時点の旧2拍＋決定論的な対決／GK顔ルートを使用する。`manga_shot_adopted` と `manga_shot_cinematic` は比較専用で、通常経路へ戻すことを禁止する。 | 新規シュートを作る場合のみ、独立した新シーンとして開始する。 |
| ロングパス GFX-05 | **不採用・凍結** | `codex/gfx-05-longpass-cinematic`（`60fbeaf`、`fd6e1b1`）の画像・ポーズ・配線を再利用しない。品質NGとしてユーザーが却下済み。 | 新規の実写参照から完全に作り直す場合だけ、別シーンとして開始する。 |
| ショートパス（5コマ） | **ユーザー決定でF1を削除。F2〜F6の5コマ構成。F2/F3採用済み。F4は面トレースv18承認済みだが、画像候補は未採用。F5/F6は未生成。Phase 1 authority固定済み、Phase 2A抽出はIndependent QA PASS** | 動画は [rnqIgNSQ-is](https://www.youtube.com/watch?v=rnqIgNSQ-is)。制作中の元番号と時刻はF2=18.0、F3=19.0、F4=20.0、F5=21.0、F6=22.2秒。F2/F3正典はSHA固定。F4のsemantic/review/overlay/exact-controlはtracked authority-packとして固定するが、生成候補のF4本体とは別物であり採用扱いにしない。Phase 2Aは採用F2/F3の素材マスクと画素実測だけを扱い、解剖学的左右やCT4D最終画質を認定しない。 | 次に許されるのは、Phase 2Aの実測値を使って採用F2/F3仕上げを再現する決定論シェーダーの較正実装と、その再現検証だけ。`calibration_status=not-calibrated`、候補ゲートlockを維持する。画像生成、F4候補、F5/F6、採用済みF4本体の格納・昇格、本編統合、build、push、deployは禁止。 |

## ショートパス再開チェックリスト（次回の最初の作業）

1. `design/SHORTPASS_APPROVAL.json` と外部脳のショートパス項目を読み、F1=17.0秒はシーンから削除済み、アクティブな5コマはF2/F3/F4/F5/F6=18.0/19.0/20.0/21.0/22.2秒であることを確認する。脚・腕・統合トレースの承認は維持し、**区間選定やトレース承認をやり直さない。**
2. `python3 tools/art/shortpass_approval_gate.py --mode build-composite` で承認済みの脚・腕・統合版のSHA-256を検証する。不一致なら生成せず停止する。
3. Phase 2Aでは画像生成・候補入力・候補metrics判定を実行しない。`cutscene_production_gate.py`はPhase 1 authority-packを検証し、`cutscene_style_calibration.py`は採用F2/F3の実画素から素材マスクと画風測定値だけを抽出する。Phase 2A抽出はIndependent QA PASS済みだが、候補認定はシェーダー較正完了までロックする。
4. `python3 tools/art/cutscene_style_calibration.py verify` でF2/F3の入力SHA、190px nearest正規化、全preview/maskのbyte一致、寸法、mode、非空、排他、silhouette unionを検証する。`extract`は兄弟stagingの完全検証後にだけatomic swapし、既存正本をrollback可能なbackupで保護する。入力・出力のsymlinkは拒否する。不一致ならシェーダー較正へ進まない。`calibration.json`の`calibration_status=not-calibrated`、`independent_review=passed`、`candidate_gate=locked`を維持する。
5. 旧 `shortpass_approval_gate.py --mode generation` 経路は失効済みで、較正解除までは実行禁止。F2/F3の再現準備はCT4Dのgeometry-only工程として扱い、最終画質を再現できるとは主張しない。
6. F3は `img/cutscenes/manga_shortpass6/frame_03.png` をユーザー採用済み正典として使う。白目過多で却下された直前v3や他候補へ戻さない。
7. F1は2026-08-26のユーザー決定でシーンから削除済み。F2はユーザー採用済み正典として固定。F4は衣服面トレースv18まで承認済みだが、画像候補は未採用。v12はユーザー却下、v4〜v13は再利用禁止、v14は構造のみ、v15は失敗方式、v16/v17は内部編集ベース、v18は独立QA FAIL、v19は内部却下。F4のユーザー判断前にF5/F6を生成しない。
8. 制作中は承認トレースとの対応を失わないようF2〜F6の元番号を維持する。全5枚採用後の最終統合時だけ `F2→frame_01`, `F3→frame_02`, `F4→frame_03`, `F5→frame_04`, `F6→frame_05` に写像する。

## 参照

- 採否と反映証拠: [DECISIONS.md](DECISIONS.md) の 2026-08-22〜18
- 実装タスクの履歴: [BACKLOG.md](BACKLOG.md) の GFX-05〜07
- 体型の数値契約: [design/PLAYER_BODY_CANON.md](design/PLAYER_BODY_CANON.md)
