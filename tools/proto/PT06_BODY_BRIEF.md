# PT-06 頭なしボディ＋背景 発注仕様書（ChatGPT画像生成用）

選手ごとの「顔」を後から差し替えるため、**頭を描かないダイナミックなシュートポーズの体**と**背景**を新規生成する。
生成した体の首の上に、football-sim の Portrait エンジンが作る**前向き3/4の合成頭**を載せる。

- 参考＝GIANT KILLING 表紙のような**躍動感・構図・脚の爆発力**。ただし**頭の角度だけは真似ない**（下記の制約が最優先）。
- 実測寸法の出典: `js/portrait.js`（`HEAD_ANCHOR`）／プレースホルダ実証 `tools/proto/pt06-compose.html`。

---

## 0. 成果物（2ファイル・別レイヤー）
1. **body.png** … 頭のない選手の体だけ。**背景は完全透明**。
2. **bg.png** … 背景（ゴール前／スタジアム）だけ。人物は描かない。
   - 合成はレンダラ側で `bg → body → 合成頭` の順に重ねる。だから**背景と体は必ず分けて書き出す**。

---

## 1. 最優先の制約 ― 頭の"向き"（これが崩れると顔がハマらない）
合成頭は **前向き3/4・首はほぼ垂直・顔はこちら（カメラ）を向く**（耳が左に見え右頬がふくらむ・約20°）。1種類のみ。だから体は：

- **顔＝カメラ方向**。うつむき・真横・完全な後ろ向きは**不可**（下や後ろを向くと合成頭が合わない）。
- **首は立てる**（大きく傾けない）。肩は3/4に振ってOK＝**体はダイナミック、首から上だけ正対気味**。
- 脚・腕・胴は**思い切り躍動させてよい**（振り抜く蹴り足、伸びる軸、ひねり）。「体は爆発、顔はゴール／カメラを見据える」英雄的構図が理想。
- 左右どちら向きの体でも可。逆向きが要る時はレンダラが**合成頭を左右反転(flip)**して合わせる。

---

## 2. 首ソケット（頭の差し込み口）＝ここが命
- **首から上は一切描かない**（顔・髪・耳・頭部いっさい無し）。首の付け根で**水平にスパッと切る**。
- **襟・首の付け根は描く**。襟は**首の切り口を囲み、少し上まで立ち上げる**（合成頭の首(下端)に襟が被さって"浮いた生首"に見えないようにするため）。※プレースホルダ実証では襟が無く頭が浮いて見えた＝ここが要点。
- 首の切り口は**ほぼ水平・幅は肩幅の 1/4 程度**（合成頭側の首くびれ幅に対応）。
- 構図上、**首の切り口の上に"頭が入る余白"を空ける**：頭は全身高の **約28〜33%** の高さになる。切り口の上にその分の空間を確保（＝首ソケットは画面の上から概ね 25〜35% あたりに来る絵作り）。
  - ※正確な座標合わせはレンダラ側で行う。**ChatGPTは「頭を描かず・襟付き・首まっすぐ・上に頭の余白」を守れば十分**。ピクセル精度は不要。

---

## 3. 画風（顔と体が馴染むように）
- football-sim のカットシーン＝**粗い・ざっくりした画風**（太めの輪郭線・フラットなセル塗り・少しラフ）。**精緻なペン画にしない**（体だけ精緻だと合成頭が浮く）。
- 陰影は面で。ギラつく写実ハイライトは避ける。
- 解像度は高めで書き出し（縮小前提）。縦長キャンバス推奨（例 **1024×1280 前後**、ダイナミックな脚が収まる余白を確保）。

---

## 4. キット・IP安全
- ユニフォームは**架空・無地ベース＋簡単な差し色**（実在クラブ/代表のロゴ・柄・配色を複製しない）。
- 実在選手・実在GK・GIANT KILLINGのキャラに**似せない**。あくまで汎用の一選手。
- 色はレンダラ側でチーム色に寄せられるよう、**明暗のはっきりした素直な塗り**が扱いやすい（グレー〜単色ベースでも可）。

---

## 5. そのまま貼れる ChatGPT 発注プロンプト（日本語）

```
サッカーゲーム用のキャラクター素材を作ってください。用途は「頭を後から差し替える」ため、
頭部は描かず、体だけを生成します。以下を厳守してください。

【ポーズ】ダイナミックにシュートを放つ全身。振り抜く蹴り足・伸びる軸足・ひねった胴で
躍動感を最大に。ただし顔と首は「カメラの方（正面やや3/4）を向き、首はまっすぐ立てる」。
うつむき・真横・後ろ向きは禁止。

【頭は描かない】首の付け根で水平にスパッと切り、そこから上（顔・髪・耳・頭）は一切描かない。
首の切り口を囲むように襟を描き、襟は首の切り口の少し上まで立ち上げる。
切り口の上に、頭がすっぽり入る余白（全身の約3割の高さ）を空けておく。

【画風】太めの輪郭線・フラットなセル塗りの、ややラフで力強い漫画/アニメ調。
精緻な写実ペン画にはしない。

【キット】無地ベース＋簡単な差し色の架空ユニフォーム。実在クラブ・代表・特定作品のロゴや
配色は使わない。汎用の一選手。

【書き出し】背景は完全に透明（体だけのPNG）。背景は別の画像として、
ゴール前/スタジアムを人物なしで別途1枚。
```

### 英語版（画像生成は英語の方が安定する場合あり）
```
Create a character asset for a soccer game. The HEAD will be swapped in later, so draw the BODY ONLY.
Pose: a dynamic full-body shot/strike — explosive kicking leg, stretched standing leg, twisting torso,
maximum energy. BUT the neck and (implied) face must point toward the camera (front / slight 3/4),
neck kept upright. No looking down, no pure profile, no back view.
Do NOT draw the head: cut cleanly and horizontally at the base of the neck; nothing above it
(no face, hair, ears, skull). Draw a collar wrapping the neck stump, rising slightly above the cut.
Leave empty space above the cut for a head (~30% of the full figure height).
Style: bold outlines, flat cel shading, slightly rough manga/anime look — NOT fine realistic linework.
Kit: plain fictional jersey with simple accent color; no real club/national/《any IP》 logos or colorways.
Export the body on a fully transparent background (PNG). Separately, provide one background image
(goal mouth / stadium) with NO figure.
```

---

## 6. 受領後の私たちの工程（参考）
1. 届いた body.png の**首ソケット中心を実測** → `composePose` のアンカー1行（sx, sy, headH, flip）を設定。
2. bg.png を土台に `bg → body → 合成頭` で重ねる（cutscene.js のポーズ表に1行追加＝設計原則②）。
3. 実選手数名で**スプライトサイズの識別性**と**首の継ぎ目**をpreview実証 → headH/sy を±で微調整。
4. まばたき・口パク・得点時の表情差分（eyes=round/mouth=thick 一時上書き）は後段の演出で追加可能。
