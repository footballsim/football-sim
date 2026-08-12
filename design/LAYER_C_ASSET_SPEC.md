# 層C（部位アップ）素材 発注仕様 — 2026-07-29

グラフィック4層設計の **層C＝部位アップ／主語＝感情** に使う素材の仕様。
数値はすべて 2026-07-29 に実物を計測して出したもので、推定値はない（末尾に根拠を再掲）。

- 参照する設計: `HANDOFF` 相当の4層構成（S引き画 / M中景 / C部位アップ / U UI画面）
- 使う側の実装: `js/cutscene.js` の `_renderShotMontageScene`（MONT-01・試作済み）
- 発注先の想定: Codex の画像生成（サブスク内・API代ゼロ）→ `asset-qa` で受入検査

---

## 0. なぜ新規に作る必要があるのか（既存資産では足りない）

試作で既存素材の流用可否を1件ずつ検証した結果：

| 使いたい部位 | 既存で賄えるか | 根拠 |
|---|---|---|
| ボール | **○ 不要** | `_lpBall` の手続き描画＝解像度の上限がない。いくらでも寄れる |
| GKのグローブ | **○ 当面不要** | 既存ダイブ絵の `_GK_DIVES[].gx/gy` アンカーでクロップして成立 |
| 蹴り足のスパイク | **△ 当面不要** | 既存シュート絵からクロップして成立。ただし足元座標は**実行時にアルファ走査で実測**が必須（`wavy` だけ 0.85、他11種は 0.48。ハードコードすると 11/12 か 1/12 が壊れる） |
| **顔まわり（目・口・眉）** | **✕ 原理的に不可** | 下記 |

**顔が不可な理由（実測）**

- ポートレートのパーツ実体（`img/portrait-parts/eyes_normal.png` 等）は **360×420**＝合成画布 720×840 の**半分**。
- 合成頭のベタ面は**水平12px幅（ランレングス p90）のブロック**。目の帯も頬の帯も同値＝2026-07-05 の「高精細を放棄し粗スタイルへ全面統一」の結果で、**局所的な粗さではなく画風そのもの**。
- 最終 480px 画布でブロックを 4px 以下に保つ上限は **倍率 0.34**。逆算するとクロップ幅 **504px 以上**が必要＝**頭がほぼ丸ごと**。つまり「目だけに寄る」と必ず破綻する。

→ **層M用に粗スタイルで統一した資産は、層Cにはそのまま使えない。** 4層設計の「層ごとに別の作り方を持つ」がここに具体化される。

---

## 1. 発注するもの（顔まわり 5点）

表情は**選手ごとに作らない**。層Cの主語は感情なので、**表情は共有素材1枚／肌色だけ実行時にリカラー**する。12髪型のような掛け算は発生しない。

| # | 素材名 | 構図 | 使う場面 |
|---|---|---|---|
| C-01 | `face_eyes_determined` | 両目＋眉。見開き、視線は画面外の一点 | シュート直前／FK直前の「決意」 |
| C-02 | `face_eyes_glare` | 両目＋眉。細める・眉根を寄せる | ファール／カード／デュエルの「敵意」 |
| C-03 | `face_teeth_grit` | 口元のみ。食いしばった歯 | 決定機を外す／失点の「悔しさ」 |
| C-04 | `face_mouth_shout` | 口元のみ。大きく開いて叫ぶ | ゴールの「歓喜」 |
| C-05 | `face_eyes_down` | 両目＋眉。伏せる・眉が下がる | 敗戦／退場／終盤の「落胆」 |

**★ 髪は描かない。** 目のアップに前髪を入れると髪色（選手ごとに10種）が写り込み、共有素材にできなくなる。**眉から上は画面外**か、入れても額のみ。

**★ 5点で足りるかは未検証。** まず5点作って MONT-01 に流し、コマの組み合わせが持つか確認してから追加を判断する。

---

## 2. 解像度（ここが今回いちばん重要）

### 必要量の導出

- MONT-01 のコマは最大 **178.1×216（論理px）**（4コマの外接矩形を実装と同じ式で再計算して確認）。
- 部位は**コマから見切れる**のが層Cの定義なので over-scale 最大 **1.30** → 描画サイズ **232×281（論理px）**。
- カットシーン画布は **SS=2**（内部2倍解像度） → **463×562（デバイスpx）**。
- 将来 SS=3 へ上げた場合 → **695×842（デバイスpx）**。

### 指定

> **画布 1024×1024 px。部位の実体（目なら両目＋眉の外接矩形）が長辺で 850px 以上＝画布の 83% 以上を占めること。**

- 850px あれば現行 SS=2（562px 必要）に対して **1.5× の余裕**、SS=3（842px 必要）でも**等倍を割らない**。
- 1024 は画像生成の素の出力サイズなので、無理な指定ではない。
- **上限は気にしなくてよい**。`_csPixelate`（`_CS_PIXEL_CELL=1` ＝ 論理1px=アート1px まで落とす）は**MONT-01 では通らない**ことをコード上で確認済み＝マンガコマ系はスムージング縮小するので、過剰解像度は無害。

---

## 3. 画風とリカラーの入力形式

層M（マンガスプライト）と**同じ画風**にする。層Cだけ滑らかだと、隣り合うコマで質感が割れる。

### 3.1 リカラー対応（`js/manga_recolor.js` の入力形式）

分離色ベースで描き、実行時に色相マスクで置換する。

| パーツ | 分離色 | 色相窓 |
|---|---|---|
| 肌 | — | **14–50** |
| shorts | `#1F9D3A` | 120–168 |
| accent | `#24C2D0` | 170–202 |
| shirt | `#2060D0` | 203–245 |
| socks | `#CC2F9A` | 300–350 |

顔まわりで実際に使うのは **肌** と、襟が写る場合の **shirt / accent** だけ。

### 3.2 ★不変色（`fixed`）の判定と、虹彩の落とし穴

判定式は `v < 0.22 || s < 0.16 → fixed`（明度0.22未満、または彩度0.16未満は**置換されない**）。

- **白目・歯・白いグローブ** → 彩度が低いので自動的に fixed。指定不要。
- **黒いスパイク・輪郭線・まつ毛** → 明度が低いので自動的に fixed。指定不要。
- ⚠️ **虹彩（茶色）は肌の色相窓 14–50 に落ちる。** 明るい肌の選手ほど、目が肌色に溶けて消える（既知の再発事例あり）。

> **虹彩は必ず 明度 v < 0.22 まで暗く塗る**（＝ほぼ黒）。ハイライトは白（低彩度＝fixed）で入れる。
> 青い虹彩は shirt 窓 203–245 と衝突するので**使わない**。目の色差は諦めて、形と眉で描き分ける。

### 3.3 その他

- ★ **顔まわり5点（C-01〜05）は透過不要＝フルブリードでよい。**（C-01 の試作で確定）
  コマは必ずクリップするので、絵が画面いっぱいなら透過は使わない。フリンジ事故も起きない。
  下のクロマキーの指定は**輪郭が立つ部位（グローブ・拳など）を追加発注するとき**に使う。
- （輪郭が要る部位の場合）**背景は純緑 `#00FF00` のベタ塗り**で生成し、**こちらで `remove_chroma_key.py` を掛けて透過にする**。
  - 画像生成側は透過PNGを直接出せない（`gpt-image-2` は `background=transparent` 非対応）。ベタのクロマキー→ローカル除去が正規手順。
  - ⚠️ **マゼンタを使わない。** 顔では**唇と明るい肌のピンクに衝突**して図を食う（過去に実害あり）。緑なら顔の中に同系色が無い。
  - 抜いたあとの緑フリンジは残さない。`shorts` の色相窓 120–168 に落ちるので、残ると**ショーツ色で塗られた縁**として現れる。
- コマの集中線・トーンは**描かない**。実装側（`_mangaShotBg`）が描く。
- 影は**ちょうど3階調（影／素／ハイライト）**。グラデーションを敷かない（リカラーは輝度の34/67パーセンタイルで3バンドに割るので、階調が多いと斑になる）。
  ★ **1階調（完全な平坦）も不可。** C-01 は肌が1階調で来て検査は通ったが、隣の層Mスプライトが3階調なので**質感が割れる**。「at most 3」ではなく「**exactly 3**」と指示すること。
- 256色量子化は**不要**（層Mの受入基準どおり。旧 pt06 基準は適用しない）。
- ★ **画風はドット絵側に寄せて発注する。** C-01 は滑らかなベクター調の線画で来て、隣の層Mスプライト（ドット絵）と**別のゲームの絵に見えた**。
  実装側の `_csPixelate`（論理解像度へ高品質縮小→NN拡大）を通すと差は縮むが**閉じきらない**ので、生成プロンプト側で
  `hard-edged pixel art, visible square pixels, no anti-aliasing on the outlines` を指定して試す。
- ★ **納品後に長辺 900px へ縮小してから同梱する。** 生成は 1254×1254 / 1.6MB で来る。最終描画は最大 232×281 論理px なので過大。
  900px なら仕様の 850px を満たしつつ約半分になる。**縮小しないと読み込みが描画に間に合わない**（実際に C-01 で発生した）。

---

## 4. 生成ブリーフ（Codex へ渡す文面のたたき）

各素材ごとに、下の共通ブロック＋個別行で発注する。

```
Draw a single manga-style CLOSE-UP of a body part for a retro football game cutscene.

CANVAS
- 1024 x 1024. Background: FLAT PURE GREEN #00FF00, edge to edge, single solid color,
  no gradient, no shading, no vignette. (It is a chroma key and will be removed.)
  Do NOT use magenta. Do NOT put green anywhere on the subject itself.
- No panel border, no speed lines, no halftone, no text, no logo.
- The subject must FILL the frame: its bounding box occupies at least 83% of the long side.
  Cropping into the subject is expected and good.

STYLE
- 1990s Japanese sports-manga cel style. Bold black ink outlines, flat fills,
  AT MOST 3 tones per material (shadow / base / highlight). No gradients, no soft airbrush,
  no photographic texture, no lens blur.
- Front-lit, high contrast. This is one panel of a comic page.

COLOR RULES (a runtime recolor pass depends on these — follow exactly)
- SKIN: use a plain mid-tone skin color in hue 14-50 degrees, value >= 0.5, saturation >= 0.25.
  It will be replaced per player at runtime, so do not stylize or tint it.
- IRIS / PUPIL: paint them ALMOST BLACK (HSV value below 0.22). Do NOT use brown or blue.
  Add a white specular highlight instead to give the eye life.
- Whites of the eye, teeth: pure white / near-white (saturation below 0.16).
- Ink outlines, eyelashes, eyebrows: near-black.
- Do NOT draw hair. Crop above the eyebrows or leave the forehead bare.

SUBJECT
<個別行をここに>
```

個別行：

| # | SUBJECT 行 |
|---|---|
| C-01 | `A pair of eyes and eyebrows, wide open with fierce determination, gaze fixed off-frame to the left. Nose bridge partially visible at the bottom.` |
| C-02 | `A pair of eyes and eyebrows, narrowed into a hard glare, brows drawn together, a single crease between them.` |
| C-03 | `A mouth only, teeth clenched hard, lips pulled back, jaw muscles tight. Chin and part of the cheeks visible.` |
| C-04 | `A mouth only, opened wide in a roar of joy, upper teeth and tongue visible, cheeks lifted.` |
| C-05 | `A pair of eyes and eyebrows, cast downward in defeat, upper lids lowered, brows sloping down at the outer ends.` |

---

## 5. 受入検査（`asset-qa` へ渡す基準）

**既定は不合格。** 下記を全部満たしたものだけ通す。

### 機械判定
⚠️ **この5項目を実行するスクリプトはまだ書いていない。** 1枚目が上がってきた時点で `tools/asset_accept.py` に足す（既存の絶対比較の枠組みに乗せる）。目視だけで通さない。

1. **透過** — 四隅16×16のアルファが全て 0。
2. **占有率** — 不透明画素の外接矩形が、長辺で画布の **83% 以上**。
3. **虹彩** — 瞳の領域に `v < 0.22` 以外の画素が無い（肌窓 14–50 に落ちる画素が瞳内にあれば **不合格**）。
4. **階調** — 肌領域の輝度ヒストグラムの山が **3つ以内**（グラデーションが入っていないこと）。
5. **リカラー実走** — `MangaRecolor.render()` に肌6段を通し、**肌以外の領域が1画素も変化しない**こと（＝白目・歯・虹彩・輪郭が巻き込まれない）。

### 目視（等倍＋実配置）
6. **MONT-01 に実際に流し込んだ状態**で見る。単体で綺麗でもコマに嵌めると破綻することがある。
7. 隣のコマ（層Mのマンガスプライト）と**線の太さ・階調数が揃っている**か。層Cだけ滑らかだと質感が割れる。
8. **チェックリスト外のオープンエンドな異常探索を必ず1観点**入れる（後追い検出器だけの検査は新種を毎回見逃す）。淡い異常は二値化増幅してから見る。

---

## 6. この仕様の根拠（2026-07-29 実測）

| 測ったもの | 値 | 効いている箇所 |
|---|---|---|
| 合成頭のベタ面（水平ラン p90） | **12px @720** | §0 顔が流用不可・§2 必要解像度 |
| ポートレートのパーツ実体サイズ | **360×420**（合成画布の半分） | §0 |
| MONT-01 のコマ最大サイズ | **178.1×216 論理px** | §2 |
| over-scale（見切れ量） | 最大 **1.30** | §2 |
| カットシーン画布の内部倍率 | **SS=2** | §2 |
| `_CS_PIXEL_CELL` | **1**（論理1px=アート1px） | §2 上限が無いこと |
| `fixed` 判定式 | **v<0.22 または s<0.16** | §3.2 |
| 肌の色相窓 | **14–50** | §3.2 虹彩の衝突 |
| シュート絵の足元位置 | `wavy` 0.85 / 他11種 0.48 | §0 実行時実測が必要な理由 |

---

## 6.5 C-01 の試作結果（2026-07-29）

**成果物**: `img/cutscenes/layerc/face_eyes_determined.png`（900×900・Codex の built-in `image_gen`・サブスク内）
**検査**: `tools/asset_accept_layerc.py` で**機械判定7項目すべて PASS**。

| 分かったこと | 詳細 |
|---|---|
| ★ 虹彩の指定が効いた | **暗色 32,064 画素中 skin 判定は 0 画素**。「ほぼ黒で塗れ」の1行で、既知の「目が肌色に溶ける」問題が起きなかった |
| ★ 画風が層Mと割れる | 生成物は滑らかなベクター調。隣のGKコマ（ドット絵）と並べると**別のゲームに見える**。`_csPixelate` を通すと寄るが閉じきらない → §3 に発注側の対策を追記 |
| ★ 肌が1階調で来た | 検査は通る（≤3）が平坦すぎる。**exactly 3** と指示すべき → §3 に反映 |
| ★ 透過は不要だった | 生成側は緑背景の指示を無視して顔をフルブリードで描いた。コマがクリップするのでこれで正しい → §3 に反映 |
| ★ ファイルが重い | 1254×1254 / 1.6MB。**読み込みが描画に間に合わず**フォールバックが出た。900pxへ縮小して解消 |

**未検証**: 実装側の `_csPixelate` 経路は同一ロードのA/Bスクリーンショットで差を確認したが、
関数呼び出しの計測（ラッパ注入）では捕捉できなかった。**計測手段が信頼できていない**ので、
次に触るときは経路の確認方法から作り直すこと。

---

## 7. 未決 / 次

- **5点で足りるか**は流してから判断する（追加候補：汗、握った拳、芝を削るスパイクの裏、GKのグローブ専用版）。
- **顔の画風不一致**：MONT-01 の顔コマは現状ポートレート合成頭を使っており、隣のマンガスプライトと画風が割れている。C-01〜05 が入ればこの問題は消える想定だが、入れてから確認する。
- **SS を 3 へ上げるか**は未判断。上げるなら本仕様の 850px がそのまま効く（等倍を割らない）。
