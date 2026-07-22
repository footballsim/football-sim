# パーツ生成プロンプト集（コピペ用・全36枚）

使い方：
1. 生成ツールに **`parts/_guide.png` を参照/下敷き（img2img・ControlNet・キャンバス）** として渡す。
2. プロンプト＝**共通プレフィックス**＋各パーツの**SUBJECT行**（連結して使う）。
3. **肌・髪＝グレースケールのまま**（色は実行時に付く）。**目・口＝フルカラー**。
4. 出力は**透過PNG・720×840**。指定の**ファイル名**で保存 → Claude に渡す（透過/整列は私が後処理）。
5. どの順でも・一部だけでもOK（未提供の部位は手続き描画にフォールバック）。
- ネガティブ（対応ツールのみ）：`background, multiple heads, extra limbs, text, watermark, jpeg artifacts, blurry`

---

## 共通プレフィックス（毎回これを先頭に）
```
anime pixel-art portrait part for a football game, matching the reference character style: clean chunky pixels, bold dark outline, soft cel shading, two-tone highlights. HARD-EDGED pixel art with NO anti-aliasing (no soft, feathered or blurred edges — every edge is a crisp pixel step). Canvas 720x840, 6:7 portrait. Output on a SOLID FLAT green (#00FF00) background — NOT transparent and NOT a checkerboard (this protects white/light details like the eye-whites when the background is keyed out later; green is used because magenta clashes with lip/skin pinks). Use the attached guide image as the EXACT alignment reference — match its landmark lines, off-center face-centerline and proportions. 3/4 VIEW: the head is turned so the LEFT ear is visible and the RIGHT side shows the fuller far-cheek curve (face-centerline sits just left of the head's middle) — use the SAME angle for every part so they stack correctly. Neutral expression. Soft light from top-left. PLACEMENT MATTERS: the guide shows the ACTUAL face — draw the feature exactly where it belongs on that face, at the right size (it will NOT be repositioned later). Keep the correct 3/4 orientation and clean style. Draw ONLY the part described below; everything else must be the flat magenta background.
```

---

## A. 肌ベース `face_*`（5枚・グレースケール）
共通SUBJECT：
```
SUBJECT: a bare human HEAD skin base only, in 3/4 view matching the guide — forehead, cheeks, ONE visible ear on the LEFT, jaw, chin, a short neck stub down to the collar line, a subtle nose shadow just left of centre, faint cheek shading. The RIGHT side is the fuller far-cheek curve; the LEFT (near) side is narrower with the ear. NO eyes, NO eyebrows, NO mouth, NO hair. Fill the head silhouette solidly; outside stays transparent. GRAYSCALE only (white highlight -> mid gray -> dark shadow); color is added later, so put all depth into light and shadow.
```
+ 形状（1行差し替え）／保存名：
- `face_oval.png` → `Head shape: OVAL — smooth egg shape tapering to a soft rounded chin.`
- `face_round.png` → `Head shape: ROUND — full cheeks, short wide jaw, soft round chin.`
- `face_square.png` → `Head shape: SQUARE — wide angular jaw, strong straight jawline, broad chin.`
- `face_long.png` → `Head shape: LONG — narrow elongated face, longer chin, slimmer cheeks.`
- `face_diamond.png` → `Head shape: DIAMOND — wide cheekbones, narrow forehead and narrow pointed chin.`

---

## B. 前髪 `hairfront_*`（12枚・グレースケール）
共通SUBJECT：
```
SUBJECT: FRONT hair only — covering the crown, forehead and temples, sitting on top of the head. The face area below the hairline stays TRANSPARENT. Show individual hair clumps, a glossy highlight band, and darker roots along the outline. NO face, NO ears. GRAYSCALE only (put all depth into light and shadow; color is added later).
```
+ 髪型（1行差し替え）／保存名：
- `hairfront_buzz.png` → `Style: very short BUZZ CUT — thin cap hugging the skull, low even hairline, minimal volume.`
- `hairfront_short.png` → `Style: neat SHORT crop — rounded cap, lightly textured top, tidy hairline.`
- `hairfront_spike.png` → `Style: SPIKY — sharp upward spikes across the crown, energetic tips.`
- `hairfront_curly.png` → `Style: CURLY — rounded bouncy curls, bumpy silhouette, medium volume.`
- `hairfront_part.png` → `Style: SIDE PART (7:3) — swept to one side with a clear parting line.`
- `hairfront_bangs.png` → `Style: straight BANGS — flat even fringe covering the forehead.`
- `hairfront_afro.png` → `Style: big AFRO — large rounded voluminous puff extending beyond head width.`
- `hairfront_slick.png` → `Style: SLICKED BACK — combed back off the forehead, higher hairline, smooth flat top.`
- `hairfront_wavy.png` → `Style: WAVY — soft flowing waves, medium length, gentle bumps, slight side sweep.`
- `hairfront_mohawk.png` → `Style: soft MOHAWK — tall center strip, very short sides.`
- `hairfront_bowl.png` → `Style: BOWL / mushroom cut — rounded even fringe all around, covering forehead and temples.`
- `hairfront_fade.png` → `Style: FADE — very short faded sides, slightly longer textured top, sharp side parting.`

---

## C. 後髪 `hairback_*`（4枚・グレースケール・該当スタイルのみ）
共通SUBJECT：
```
SUBJECT: BACK-of-head hair VOLUME only — the mass of hair seen behind and around the head silhouette (behind ears and temples), giving fullness. It sits BEHIND the face. Only the outer volume; the front fringe is a separate part. GRAYSCALE only.
```
+ スタイル（1行差し替え）／保存名：
- `hairback_curly.png` → `For CURLY style — bumpy rounded volume around back and sides.`
- `hairback_afro.png` → `For AFRO style — large rounded halo of volume extending well beyond the head.`
- `hairback_wavy.png` → `For WAVY style — soft flowing volume down the sides and back.`
- `hairback_bowl.png` → `For BOWL style — rounded even volume framing the back and sides.`

---

## D. 目＋眉 `eyes_*`（フルカラー）

> 🎯 **【2026-07-05確立・正式パイプライン】目バリエーションは「ベース顔をedit→抽出」で量産。眉は全種で固定。**
>   - **眉は変えない**（ユーザー指示）＝抽出時に **`eyes_normal.png` の眉領域(y<320)で上書き**するので、ChatGPTが眉に何をしても全種で眉は同一になる。
>   - **手順**: ①`base_face_for_batch.png`(正規の目+眉入り正準顔)をChatGPTにクリップボード添付 → ②「**目の形だけ**◯◯に、眉その他は1px不変」でedit生成（形の差はこの解像度でも読める＝reframerの"形は効かない"は誤り・ユーザー実証） → ③`batch_parts.make_eyes(src,'<id>')` で抽出（face-match整列→目footprint×目色フィルタで肌除外→眉上書き→小島除去）→ `eyes_<id>.png`。
>   - **実装済み(2026-07-05)**: normal/droopy(たれ目)/round(丸目)/narrow(細目)。lab EYES配列に追加済み。cost<26で良好。
>   - **⚠️実在人物の写真は添付不可**（ポリシー拒否）→スタイルは言葉で。虹彩色は別軸で後日（tint流用可）。

### 旧・共通SUBJECT（単体生成方式・参考）：
```
SUBJECT: a matched PAIR of anime eyes plus both eyebrows, FULL COLOR, in 3/4 view. Place them on the guide's two eye boxes: the near (LEFT) eye larger, the far (RIGHT) eye a bit smaller and compressed. Whites, a colored iris with a bright highlight, a bold dark upper lash line, and eyebrows above each eye. NOTHING else — no nose, no face — transparent elsewhere.
```
+ タイプ（1行差し替え）／保存名：
- `eyes_normal.png` → `Eye style: NORMAL — medium almond eyes, neutral straight eyebrows.`
- `eyes_sharp.png` → `Eye style: SHARP — narrower slanted-up keen eyes, angled eyebrows, intense look.`
- `eyes_round.png` → `Eye style: ROUND — large open round eyes, soft slightly-raised eyebrows, friendly.`
- `eyes_wide.png` → `Eye style: WIDE-SET — eyes spaced further apart, neutral eyebrows.`
- `eyes_narrow.png` → `Eye style: NARROW — thin calm half-open eyes, low relaxed eyebrows.`
- `eyes_thick.png` → `Eye style: THICK BROWS — medium eyes with bold thick strong eyebrows.`

---

## E. 口 `mouth_*`（5枚・フルカラー）
共通SUBJECT：
```
SUBJECT: a single closed MOUTH only, FULL COLOR (natural lip tone), centered on the guide's mouth line. Small and subtle, anime style. NOTHING else — transparent elsewhere.
```
+ 形（1行差し替え）／保存名：
- `mouth_flat.png` → `Mouth: straight neutral line.`
- `mouth_smile.png` → `Mouth: slight smile, corners turned up.`
- `mouth_frown.png` → `Mouth: slight downturned mouth.`
- `mouth_small.png` → `Mouth: small compact mouth.`
- `mouth_wide.png` → `Mouth: wider mouth.`

---

## F. 髭

> 🎯 **【2026-07-05・reframerの提案で決着】無精髭(stubble)は「髭パーツ」ではなく「色」＝顎ゾーンの陰影**。
>   - **そもそもの転換**: 無精髭の本質は「顎まわりの肌がうっすら青黒い」ことで、髭という別パーツが乗っているわけではない。→ グレースケール髭を塗るのをやめ、**肌リカラー段階で顎ゾーンを暗く**する。
>   - **実装(portrait-lab.html)**: `stubbleLayer()`＝**フルビアードの形を型紙**に、**色は黒固定**(rgb 34,36,42)で塗り、`draw()`で頭の上・目/口の下に `globalAlpha=0.68`で敷く＝黒の5時の影。
>   - **【2026-07-05・髪色連動は断念→黒固定に確定】**: 髪色連動＋明度クランプを試したが、白髪/金髪で「まだ透ける」問題が解消しきれず**ユーザー判断で髭色は黒固定**に。髪色に関わらず黒。
>   - **あごはみ出しクリップ**: 型紙(beard_full)は顎からはみ出す→**素の顔シルエット `head_skin.png` の"肌ピクセルのみ"(不透明かつ明るい=輪郭線と背景を除外)でクリップ**して、あご輪郭の外に出た髭を機械的に消す。顎の下カット(cutY=0.70)と併用。
>   - **顎の下カット**: 無精髭はフルビアードより狭い→型紙の縦範囲の下端30%(`cutY=ymin+(ymax-ymin)*0.70`)を落として顎の下に髭が回らないように(ユーザー指示)。
>   - **これで消えた問題**: 「薄くすると網目／濃くするとフルビアード」のジレンマが原理的に消滅(形を持たないから)。差分抽出も手続き生成も不要。stubble専用PNGは廃止(loadAllで読み込まない・型紙はbeard_full)。
>   - **教訓**: 「薄い/まばら」を極小ドットの"形"で出そうとするな。それが本当は"色(陰影)"なら、色として実装すれば解像度の制約を受けない。5回リロールした後、reframerが枠組みを割って1発。

### mustache/goatee/full（ChatGPT生成＋差分抽出・グレースケール3枚）
共通SUBJECT：
```
SUBJECT: FACIAL HAIR only, in 3/4 view matching the guide — sitting on the lower face (around the mouth, along the jaw and chin). Follow the guide's mouth line (y≈540) and jaw/chin landmarks. Keep the LIP area itself TRANSPARENT so the separate mouth part shows through; draw only the hair. Individual short hair texture with darker roots and a soft edge. NO face, NO skin fill, NO mouth, NO hair on top of the head — everything except the facial hair stays transparent. GRAYSCALE only (put all depth into light and shadow; color is added later to match the hair color).
```
+ 髭型（1行差し替え）／保存名：
- `beard_stubble.png` → `Style: light STUBBLE — sparse fine speckled short hairs over the chin, jaw and upper lip, faint and even, low coverage.`
- `beard_mustache.png` → `Style: MUSTACHE only — a neat band of hair on the upper lip above the mouth, nothing on the chin or jaw.`
- `beard_goatee.png` → `Style: GOATEE — a compact vertical patch under the lower lip down to the chin tip, plus a light mustache; cheeks and jaw stay bare.`
- `beard_full.png` → `Style: FULL BEARD — connected hair wrapping the chin, jawline and cheeks with a mustache, framing the mouth; medium density.`

> ※ 髭は「なし」(`none`)が最多。合成側は `none` を含む名前ハッシュ割当で**大多数をヒゲなしに寄せる**ので、この4枚だけ作れば十分。

> ✅ **粗スタイル版4枚とも完成（2026-07-05）**。手順は§Iのedit方式の髭版＝「ハゲ頭のまま、この顔に髭だけを描き足す」プロンプト（base=`parts/_base_coarse_full.png`をクリップボード添付）→ `batch_parts.make_beard(src,'<id>')`。
> ⚠️ **stubble（無精髭）だけは `make_beard(src,'stubble',warm=True)`**＝髭の中間トーンが肌色と混ざり通常の彩度ゲート(diff>60×低彩度)で歯抜けになるため。warmモード=輪郭リング8px＋口周り除外の上で暖色でもdiff>90を捕捉しグレー化保存（リカラー互換）。mustache/goatee/fullは既定のままでOK。
> ✅ **stubbleのデザイン確定（2026-07-05ユーザー指定・メッシ風）**: バラ点の散布は不可（汚れに見える）。**「サッカー選手に多い、短く整ったフルビアード風。口髭+顎髭+フェイスラインが面としてつながり口を囲む。長さ短く均一。点の散布禁止・単色ベタ禁止・2〜3トーンのグレーで質感」**で依頼する。連結した髭なのでリカラー(平均輝度→髪色)でも自然、間引き不要。
> ⚠️ ChatGPTに**実在選手の写真を参考添付するとコンテンツポリシーで拒否される**→スタイルは言葉で記述する。
> ⚠️ **stubbleの標準処理は3段: `make_beard(src,'stubble',warm=True)` → `snap_beard_grid('stubble')`**。
>   - **snap_beard_grid**=ピクセル単位の差分抽出はエッジに欠けピクセルが残りギザギザに見える→10px格子へ量子化(被覆率40%でブロック塗り・小連結成分は島として除去)して画風と揃える。
>   - **耳ゾーン除外(make_beard内蔵)**=ドナー画像のface-match costが高い(顔ズレ)と、warm捕捉が**ベース顔の左耳位置(x<FW*0.42/y<FH*0.57)の肌色差分を髭として誤検出**する→そこを抽出から除外。髭本体は口y>540なので無影響。**cost>65が出たら顔ズレのサイン=耳・輪郭の誤検出を疑い、必要なら生成し直す**（前回良品3種はcost33-56）。

---

## I. 【最終確定・2026-07-05】edit方式×差分抽出（デザイン最良＝ユーザー承認・手調整ゼロ）

**結論はこれ。** ChatGPTに「顔に髪を描き足すedit」をさせ、私が**ベース顔との差分**で髪だけを取り出す。
- editは顔・輪郭をほぼ完全保存（実測1.002）→ **角度・位置・デザインが構造的に一致＝位置微調整が不要**
- 抽出はネイティブ解像度のまま差分マスク→箱型平均で720x840へ（点描の質感が残る）
- 顎の髭状ノイズ（editの輪郭1-2pxズレ由来）は「輪郭リング8px×目線より下」除外で自動排除
- 処理は `batch_parts.diff_extract_hair('~/Desktop/ChatGPT Image ....png','<id>')` の1呼び出し

生成プロンプト（editモード・`base_face_for_batch.png`を添付）:
```
この画像を編集してください。絶対条件: 顔・輪郭・目・眉・口・耳・首・緑背景(#00FF00)は1ピクセルも変えず、
頭の輪郭シルエットも維持したまま、この頭の上に髪だけを描き足す。
髪型は〔ここだけ差し替え〕。
髪はグレースケール（白〜黒の明暗のみ、色は後工程で付ける）。
画風は元画像と同じアニメ調ピクセルアート（ハードエッジ・アンチエイリアスなし）。
出力は元と同じキャンバス・同じ構図の1枚。
```
※§H（髪パーツ単体方式）は正面向きに描かれがちでアングルが合わない→不採用。記録として下に残す。

## H. 【不採用・記録】髪パーツ単体・固定キャンバス方式（ChatGPT本人の助言で試行）

ChatGPTに相談した結果「顔に描き足す依頼は不向き。**最初からパーツとして依頼せよ**」。buzzで実証＝**位置合わせ処理ゼロでほぼ完璧に頭に載り、粗ドットで縮小に耐えるシャープ品質**。抽出は緑キー抜きのみ（ワープ/クリーンアップ不要）。

手順: ChatGPTに `base_face_for_batch.png` を添付し、下のテンプレの髪型指定だけ差し替えて送る（**共通テンプレ・髪型名だけ変更**が安定の鍵）。DLは ~/Desktop に落ちる。

```
添付画像は位置合わせ用の参照です。720x840キャンバスで、髪パーツのみを描いてください。
顔、輪郭、目、眉、口、耳、首、肌は描かない。髪以外はすべて#00FF00のベタ塗り背景。
髪は、参照画像の頭部にゲーム内で合成したとき正確に合う位置・サイズで配置。
頭の外側シルエットからはみ出さない。耳・眉・目・顔にはかぶせない。
髪も顔と同じ3/4ビューで描く（正面向きにしない）。生え際のアーチの中心は、頭の中央ではなく
顔の中心線（右寄り）に合わせる。左（手前）側はこめかみ・もみあげへ回り込み、右（奥）側は輪郭の際で終わる。
髪型：〔ここだけ差し替え〕。
髪色はグレースケールのみ。使用色は5色以内。
アンチエイリアス、ぼかし、半透明、フェザー、細かい点描は禁止。
720x840だが、実質72x84グリッド相当で描く。1ドットは10x10px程度の大きなブロックとして表現する。
縮小しても潰れないよう、毛束と陰影は大きく単純化する。出力は1枚のみ。
```

処理側: `key_green → 720x840リサイズ → parts/hairfront_<id>.png`（それだけ）。位置ズレ時のみlabスライダー。

---

## G. バッチ・グリッド生成（2026-07-04確立＝髪型8種で実証したが品質上限あり→§H推奨）

単パーツをプロンプトだけで生成すると位置が合わない。**フル顔の3×3グリッドを1枚生成→`batch_parts.py`で自動整列・自動抽出**が最効率。
1. 参照画像=**`base_face_for_batch.png`**（素のハゲ顔・緑背景。正準パーツから書き出し済）を添付。
2. 下のプロンプトの Cells 2-9 を対象パーツに差し替えて生成（**セル1=素の顔のまま**は必須＝整列アンカー）。
3. `python3 batch_parts.py ~/Downloads/<grid>.png`（STYLESマッピングを編集）→ コンタクトシートで一括確認。

```
Create ONE image: a 3x3 grid of 9 equal cells with thin black separator lines.
Every cell shows the SAME character head as the attached reference — IDENTICAL face, eyes, mouth,
3/4 angle (left ear visible), same head size and same position inside each cell,
flat green (#00FF00) background. Anime pixel-art style matching the reference, hard-edged pixels, no text.
IMPORTANT: keep the EXACT SAME head outline / silhouette as the reference in every cell —
hair (or the varied part) is ADDED ON TOP of this exact head; do not change the head shape, size or angle.
Cell 1 (top-left): the reference head EXACTLY as attached — bald, unchanged.
Cells 2-9: <対象パーツのバリエーションを1行ずつ>
All hair in GRAYSCALE only (depth via light and shadow; color is added later).
```

- **輪郭ズレ対策**: 上記の silhouette 固定条項＋処理側 `polish()`（隙間充填/うなじ刈り/二重輪郭除去）の二段構え。
- 目/口/髭のバッチも同じ型でOK（変化部分が小さいほど抽出は簡単）。
