# Shortpass session handoff

更新日: 2026-08-31

## 現在地

- F2/F3は既存正典。F4/F5/F6改訂版はユーザーが採用判断済み。
- F6はYouTube `rnqIgNSQ-is` をChromeで実再生し、0:23.0付近の後続フレームを直接トレースしてから生成した。
- 以下は生成済み採用候補の保存済みコピー。2026-08-30に外周接続した低彩度明部だけを純白化した派生版を比較提示し、ユーザーが採用した。さらに既存F2/F3正典を上書きしない新規 `img/cutscenes/manga_shortpass5/` へ最終5スロットをbyte-for-byte格納した。2026-08-31に通常ショートパスへ本編配線し、採用4コマシュートとの一括QA・デプロイ工程へ移行した。

## 実体とSHA-256

| frame | path | SHA-256 |
|---|---|---|
| F4 | `design/shortpass-approval/candidates/f4-user-adopted.png` | `b68eb98e58d842ddb75f6f817ccfa81157e88fd3f455af5fe8955c496a25f47d` |
| F5 | `design/shortpass-approval/candidates/f5-user-adopted.png` | `5fa2ce7e068e9c387066f9dd2e0914bf8edc4dbfec4bce2eae68e3bf9d7b1618` |
| F6 | `design/shortpass-approval/candidates/f6-user-adopted.png` | `932d705f60c037de2706f54761524e842155fba9f2b47e576c1571b3dedd2fac` |

## 採用済み白マット派生版

元画像は不変のまま保持し、次の派生版を**ユーザー採用済み・未統合**として固定する。

| frame | path | SHA-256 |
|---|---|---|
| F4 | `design/shortpass-approval/candidates/normalized/f4-user-adopted-white.png` | `c1ba0378621e6fd4e70758d2cf07733af5a640248673935a29edef34b565dd75` |
| F5 | `design/shortpass-approval/candidates/normalized/f5-user-adopted-white.png` | `063c64a2ce76164eaa63398861174e3105aeb724a3d76ab6012eb540dc335f22` |
| F6 | `design/shortpass-approval/candidates/normalized/f6-user-adopted-white.png` | `0be00cec246f5a4e81c8a460d9251b4c83a9824e6b8ff1e44473e3e89988689d` |

- 採用比較: `design/shortpass-approval/candidates/normalized/f4-f6-matte-before-after.png`
- 比較SHA-256: `bc52b262d448af716a09da37272b4cdf4e2bc5712dc41afb253e0bc3a5ea826e`
- 処理契約: 外周に接続する `RGB各値 >= 220` かつ `chroma <= 20` の画素だけを純白化。3枚とも元と同寸法、外周100%純白、条件外変更0画素。
- 独立QA: PASS。人物輪郭、左右identity、配色、両スパイクに明白な侵食なし。

## canonical格納ステージ（Git追跡・production runtime反映工程）

| slot | source frame | path | SHA-256 |
|---|---|---|---|
| frame_01 | F2 | `img/cutscenes/manga_shortpass5/frame_01.png` | `f39b23a571b749fc5cc9d515ced804ebda9c1edf4dff936e32803604db0dabd4` |
| frame_02 | F3 | `img/cutscenes/manga_shortpass5/frame_02.png` | `2527df0f693ac5061d32a59ca0407db6c3454fa8c1a364f6415b9cffb5764dbc` |
| frame_03 | F4 | `img/cutscenes/manga_shortpass5/frame_03.png` | `c1ba0378621e6fd4e70758d2cf07733af5a640248673935a29edef34b565dd75` |
| frame_04 | F5 | `img/cutscenes/manga_shortpass5/frame_04.png` | `063c64a2ce76164eaa63398861174e3105aeb724a3d76ab6012eb540dc335f22` |
| frame_05 | F6・足首角度v5 | `img/cutscenes/manga_shortpass5/frame_05.png` | `d2956ada6041a9899e4f651de900bcf65449ce95f70697431744ae4a36fa1b51` |

- 全5点は各採用済みコピー元と `cmp` 一致。既存 `manga_shortpass6/frame_02.png` と `frame_03.png` は不変。
- F2/F3は採用済み白マットRGB派生版、F4/F5/F6も採用済み白マットRGB版。5点すべて外周純白。
- `img/cutscenes/manga_shortpass5/` はGit追跡対象として、本編通常ショートパスとScene Labの共通rendererへ接続する。

## Scene Labプレビュー

- `_renderShortpass5Scene` を本編通常ショートパスとScene Labで共用する。ワンツー、失敗、カウンターは既存経路を維持する。
- F2→F6を直接切替し、実測bboxで見かけ身長と接地だけを統一。推測補間、ボール、攻撃方向ミラーは未実装。
- 初回独立レビューではF2/F3の近白外周が純白canvas上の矩形として見えてFAIL。採用済み白マット版への差替え後、矩形境界解消・全5枚外周純白・人物非侵食を再確認して解消済み。
- F2/F3の決定論的白マット候補は独立画像QA PASS後にユーザーが採用し、候補領域へ保存して `manga_shortpass5/frame_01.png` / `frame_02.png` へ反映済み。既存 `manga_shortpass6` 正典は不変。
- F2候補SHA: `f39b23a571b749fc5cc9d515ced804ebda9c1edf4dff936e32803604db0dabd4`
- F3候補SHA: `2527df0f693ac5061d32a59ca0407db6c3454fa8c1a364f6415b9cffb5764dbc`
- 比較SHA: `15b27c96c010217700050a27ceda091dc236ffc80ce2217f371206a892bd9898`
- 固定時計テスト: `F2→F3→F4→F5→F6→done` PASS。
- ブラウザ実機: 白背景の矩形境界なし、一回再生後 `frame=5 / state=done`。独立Reviewerは画像・実装・実機動作をPASS。
- 現在のゲート: 画像・動き・テンポはユーザー採用済み。本番runtimeへ配線し、2026-08-31に採用4コマシュートと一括でkantoku-lab Production SHA `9b92483`へ反映済み。
- 2026-08-30足identity訂正: 画面左側は**左軸足**、画面右側が**右蹴り足**。`frame05-ankle-left-v2.png` は軸足を誤って反転したため不採用・再利用禁止。先行 `frame05-ankle-right-v1.png` も右蹴り足が左向きにならず白目を欠落させたため不採用。両候補をLabから撤去し、元の採用済み `manga_shortpass5/frame_05.png`（SHA `0be00cec...`）へ復帰した。次候補では画面右側の右蹴り足だけを編集し、左軸足を不変にする。
- ImageGenで右蹴り足の左向きを再試行した候補も向きが変わらず失敗したため、生成方式を停止。現在のLab候補は元の採用frame_05を入力に、viewer-rightの右蹴り足ブーツ領域だけをcanvasで水平反転・左へ再配置する決定論的処理。viewer-leftの左軸足、白目、顔、全身は原画のまま。ユーザー目視採用前のLab限定で、本編未統合。
- そのcanvas候補は向き自体は合ったがデザインNG。ユーザー指示によりLabから撤去し、元frame_05へ復帰。以後、足首候補はLab配線前にF5（4コマ目）とF6候補（5コマ目）を横並び比較画像で提示し、採用後にのみLabへ入れる。
- 2026-08-31、添付デザインを基準に右蹴り足スパイクの角度を右下へ合わせた `candidates/frame05-ankle-angle-match-v5.png` をユーザーが明示承認。`manga_shortpass5/frame_05.png` へbyte-for-byte差し替え、Labは同一内容の固有URL `frame_05_angle_v5.png` へ配線した。実測bboxは `[181,122,954,1260]`。画面左の左軸足、白目、全身配置は維持。本番runtimeは未配線。
- 外周灰白マット除去の閾値拡張、F2シャツ明度分布補正、選手とボールの18px左寄せ、24px右移動、接触後のボール飛行を採用rendererに固定した。

- 比較シート: `design/shortpass-approval/f2-f6-final-comparison.png`
- 直接トレース: `design/shortpass-approval/trace-f07-23s-direct.png`
- Chrome元フレーム: `design/shortpass-approval/source-f07-23s-chrome.png`

## 再開ルール

1. `AGENTS.md` → `CODEX_HANDOFF.md` → `CLAUDE.md` → `CUTSCENE_HANDOFF.md` → `design/PLAYER_BODY_CANON.md` → 外部脳を読む。次シーン開始時は外部脳の **「次シーン量産の必読プレイブック（2026-08-31・ショートパス完成時の反省）」** を必読とする。
2. このファイルの元候補3枚、採用済み白マット派生版3枚、比較シート、直接トレースを実体確認し、SHAを再計算する。
3. repo台帳がF4 trace-only/F5/F6禁止、またはcanonical未格納の旧状態なら、本ファイルおよび実体と矛盾することを報告する。`manga_shortpass5` 以外へ再配置しない。
4. 白背景、右向き、刈上げ、約5.6頭身、左右の脚・腕、インサイドキックの足首角度を維持する。
