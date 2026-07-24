# LAB_UI_DESIGN.md — 試合外パートの「ゲーム化」設計（UX-01〜06）

作成 2026-07-24 / 対象 **kantoku-lab のみ**（本番 football-sim.com は凍結・[CLAUDE.md] 参照）

---

## 0. なぜやるか（問題の定義）

現状の kantoku-lab は **「試合中は漫画、試合外は管理画面」** に割れている。

連載ループ（クラブ選択 → 今週の準備 → 週末の試合 → 試合後バナー → シーズン最終話 → バックナンバー）は
**情報設計としては完成している**。だが表現が「雑誌メタファーをテキストと配色で言っているだけ」で止まり、
実体は静的カード＋表＋`<select>` の一括再描画になっている。

機械的に確認した欠落:

| 観点 | 現状 |
|---|---|
| 画面遷移アニメ | **無**（`showScreen` は class 付替のみ / simulate.js） |
| 数値カウントアップ | **無**（スコアは `textContent` 直代入） |
| バーの伸長 | **無**（`_managerCardHTML` は `width:%` 固定・`transition` 無し） |
| 効果音 | **無**（`AudioContext` / `new Audio` がコード全域にゼロ） |
| パーティクル | **無** |
| 試合前の導入 | **無**（`playToday` が `startManagerMatch()` を直接叩く） |
| 試合後の間 | **無**（`_renderHub(true)` が全ブロックを一括表示） |
| 漫画演出 | 試合中のみ（`cutscene.js` は試合外から未参照） |
| デザイン系統 | **二分裂**（本体 `style.css`+`:root` ／ league は実行時注入CSS＋ハードコード色） |

**方針**: 試合外パートを「**監督マンガの“試合以外のコマ”**」として設計し直す。
プレイヤーは監督室に座り、**週刊誌をめくるように1日1話を読む**。
三本柱（監督主人公・1日1回・漫画風）を裏切らず、むしろ強化する。

---

## 1. スコープ（①〜⑤ → 設計ID）

| 要望 | ID | 内容 |
|---|---|---|
| ③⑤ | **UX-01** | 監督室シェル＋デザイントークン統一（`--lg-*` を `:root` へ・実行時注入CSSを廃止） |
| ② | **UX-02** | juice 基盤（合成SFX・カウントアップ・バー伸長・紙吹雪・画面遷移・シーケンサ） |
| ① | **UX-03** | プレマッチ導入（試合前の漫画コマ送り → KICK OFF） |
| ① | **UX-04** | ポストマッチ連載リビール（試合後を**1コマずつ**開く「今節の号」） |
| ③ | **UX-05** | 誌面化（BEST XI 見開き・バックナンバーの本棚＋ページめくり） |
| ④ | **UX-06** | 素のUIのゲーム化（`<select>` / `<table>` / `<details>` を置換） |
| 追加 | **PC-01** | **記者会見**（試合後・毎試合・選択に結果が伴う）→ §10 |
| 追加 | **BD-01** | **ボードとの交渉**（開幕・シーズンに1度）→ §11 |
| 追加 | **SC-01** | **偵察レポート**（相手の攻め筋 上位3をウェイトで・準備タブ）→ §12 |

---

## 2. 画像は「あとからCG」— プレースホルダ規約（★最重要）

**今すぐ動き、あとから PNG を置くだけで差し替わる**構造にする。実装は必ず `LabArt` 経由。

- 実アセットの置き場: **`img/lab/<key>.png`**（`build.js` が `img/` ごと dist-lab へ複製する）
- アセットが**無ければ手続き的プレースホルダ**（canvas 描画／CSSグラデ）を返す。**画像が無くても破綻しない**。
- ★ **未配置スロットには「ここに画像が入ります」＋スロット名＋推奨サイズを必ず描く**
  （`LabArt` の `_slotFrame`）。手続き描画だけだと *完成した絵* に見えてしまい、
  どこに CG が要るのか判別できない。実画像を置けば自動的に消える。
  - `label:'corner'` のスロット（UI が上に乗る下地系）は破線枠＋隅の小さな注記だけにする。
    中央に大きく出すと操作の邪魔になる。
  - 全部まとめて消したいときは `window.LABART_SHOW_SLOTS = false`。
  - 残りの未配置は `LabArt.missing()` で一覧できる（＝CG発注の残タスク）。
- 差し替え時は **`?v=` を必ず bump**（`LabArt.VER` を上げる）。build の自動 `?v=` は index.html のタグにしか効かず、
  **JS内の画像URLには効かない**（既知の踏み抜き — [CLAUDE.md] / メモリ参照）。

### 用意してもらう画像スロット（CG発注リスト）

| key | 用途 | 推奨サイズ | 無い場合の代替 |
|---|---|---|---|
| `office_bg` | 監督室の背景（デスク越しの視点・ブラインド・戦術ボード） | 1280×720 | 紺グラデ＋ブラインド縞を canvas 描画 |
| `office_desk` | デスク面のテクスチャ（帯として下部に敷く） | 1280×260 | 木目風グラデ |
| `corkboard` | 掲示板（週の予定を貼る面） | 720×480 | コルク色ノイズ |
| `tunnel` | 入場トンネル（プレマッチ コマ1） | 1280×720 | 暗→明の放射グラデ |
| `stadium_night` | スタジアム遠景（プレマッチ コマ2） | 1280×720 | 夜空＋ピッチ縞 |
| `press_wall` | 記者会見のバックパネル（PC-01・**帯**） | **1280×400** | 濃紺＋ロゴ格子 |
| `boardroom` | ボードとの面談室（BD-01・**帯**） | **1280×400** | 長机＋椅子のシルエット |
| `paper_texture` | 誌面の紙テクスチャ（BEST XI 見開き・号の背景） | 1024×1024 tileable | 生成ノイズ |
| `shelf_wood` | 本棚の棚板（バックナンバー） | 1024×256 | 木目風グラデ |
| `stamp_win` / `stamp_draw` / `stamp_loss` | 結果スタンプ（透過PNG） | 512×512 | canvas で円＋文字を描画 |

> 発注時の注意: 帯（16:5）と全画面（16:9）と tileable が混在するので**上表のサイズをそのまま使う**。
> 監督室系は中央に情報を置くのでコントラストを落とし気味に。
>
> ★ **枠は実アセットと同じ形で描く**。CSS の箱の縦横比が宣言サイズとズレると、
> プレースホルダの枠が**橙色＋「枠の比が不一致」**で警告する（`_slotFrame`）。
> ズレたまま実画像を入れると切れる/歪むので、その場で気づけるようにしてある。
> `max-height` は `aspect-ratio` を上書きするので帯には付けないこと（実際に踏んだ）。
> 受入は既存ルール通り `asset-qa` を必ず通す（メモリ: 生成画像の受入検査官）。

---

## 3. モジュール分割（★並行実装のための契約）

新規ファイルは全て **lab 限定**。`build.js` の `LAB_ONLY_JS` と `labInject` の**両方**に追加が必要。

```
js/juice.js      (新) UX-02  juice 基盤          … 依存なし
js/lab-art.js    (新) §2     画像プレースホルダ解決 … 依存なし
js/lg-ui.js      (新) UX-01/05/06 試合外UI部品    … LabArt, Juice を任意依存(typeofガード)
js/matchday.js   (新) UX-03/04 試合前後の演出     … Juice, LabArt, LgUI を任意依存
css/league-ui.css(新) UX-01  トークン＋部品CSS
js/league.js     (改) 統合のみ                    … 上記を typeof ガードで呼ぶ
```

**ロード順**: `juice.js` → `lab-art.js` → `lg-ui.js` → `matchday.js` → `league.js`

**鉄則**:
- 新モジュールは **`league.js` を編集しない**。統合（league.js の書き換え）は**オーケストレータのみ**が行う。
- 新モジュールは **`_state` 等 league の内部状態を直接触らない**。必ず引数で受ける。
- 全呼び出しは `typeof X !== 'undefined'` ガード。**未搭載でも no-op で崩れない**こと（公開版に漏れても無害）。
- キルスイッチ: `window.JUICE_ENABLED === false` で演出を全部切って即時表示にフォールバック。
- `prefers-reduced-motion: reduce` を尊重（動きは切る／音は鳴らさない）。

---

## 4. API 契約（この通りに実装する）

### 4.1 `window.Juice`（js/juice.js）

```js
Juice.ready()                       // boolean: 演出してよいか（JUICE_ENABLED && !reduced-motion）
Juice.sfx(name, opts)               // WebAudio で合成。音源ファイルは使わない
   // name: 'whistle'|'page'|'stamp'|'ping'|'fanfare'|'thud'|'tick'|'coin'|'crowd'|'lose'
   // 初回は user gesture 後に AudioContext を作る（自動再生ブロック回避）
   // window.SFX_ENABLED===false で無音。失敗しても例外を投げない
Juice.countUp(el, to, opts)         // opts:{from=0, dur=600, fmt(v), onDone}
Juice.growBar(el, pct, opts)        // el の width を 0→pct% へ。opts:{dur=700, delay=0}
Juice.confetti(host, opts)          // opts:{count=80, colors:[], dur=2200}。host 内に絶対配置 canvas
Juice.reveal(el, opts)              // opts:{dir='up', dur=380, delay=0} 単体の出現
Juice.stagger(els, opts)            // 複数を順に reveal（順位表の行など）
Juice.sequence(host, panels, opts)  // ★ 1コマずつ開くシーケンサ。Promise を返す
   // panels: [{ id, html, sfx, hold=0, onShow(el), skippable=true }]
   // opts: { auto=false, onDone, tapHint }   auto=false ならタップ/クリックで次へ
   // 既出パネルは消さずに積み上げる（＝誌面が下に伸びていく）
Juice.pageTurn(host, nextHTML, opts)// ページめくり遷移（バックナンバー用）
Juice.screenSwap(fn, opts)          // fn() で画面を差し替える前後にフェード
```

**SFX は合成する**（音源アセットを増やさない）。目安:
`whistle`=矩形波の短い上下 / `page`=ノイズバースト＋ハイパス / `stamp`=低域サイン＋短ノイズ /
`ping`=正弦の減衰 / `fanfare`=3音アルペジオ / `thud`=低域サイン減衰 / `coin`=2音上行。

### 4.2 `window.LabArt`（js/lab-art.js）

```js
LabArt.VER                          // '1' — 画像差し替え時にここを上げる（キャッシュバスト）
LabArt.SLOTS                        // §2 の表と同じ key→{w,h,desc} 定義
LabArt.url(key)                     // 'img/lab/office_bg.png?v=1'
LabArt.has(key)                     // 実アセットが読めたか（preload 後に確定）
LabArt.preload(keys)                // Promise<void>。404 は握りつぶして has()=false にする
LabArt.bg(key)                      // CSS の background 値。無ければ手続きグラデ文字列を返す
LabArt.paint(ctx, key, x,y,w,h)     // canvas へ描画。無ければ手続きプレースホルダを描く
```

### 4.3 `window.LgUI`（js/lg-ui.js）— 状態を持たない HTML ビルダ

```js
LgUI.officeShell(inner, opts)              // UX-01 監督室フレームで包む
LgUI.sectionTitle(text, badge)             // 見出し（.lg-h の後継）
LgUI.statBar(label, value, max, opts)      // 伸びるバー。opts:{color, id} → Juice.growBar 対象に data 属性
LgUI.standings(rows, myId, opts)           // UX-06 ゲーム順位表（自クラブ強調・▲▼・行スタッガー用 data 属性）
LgUI.playerPicker(players, curKey, fnName, slotIdx)  // UX-06 <select> 置換。顔付きカードの横スクロール
   // 顔は <canvas data-portrait="<long_name>"> を置くだけにする（描画は league 側が Portrait.render を呼ぶ）
LgUI.resultStamp(res)                      // 'W'|'D'|'L' のスタンプ（LabArt.stamp_* / 無ければ描画）
LgUI.bestXISpread(xi, mode, t)             // UX-05 雑誌見開き。ピッチ図の上に配置＋顔canvas
   // mode:'weekly'(黄×黒 専門誌) | 'season'(紺×金 協会公式)
   // t:{titleJa,titleEn,subJa,subEn}
LgUI.shelf(issues, fnName)                 // UX-05 本棚。issues:[{season, champCrest, myPos, achieved}]
LgUI.issuePage(html)                       // 本棚から開いた1冊のページ体裁
```

**i18n**: `LgUI` は文言を持たない。**表示文字列は必ず呼び出し側（league.js）から受け取る**
（[AGENTS.md] 規約4「i18n は日英の両方」を新規モジュールで踏み外さないため）。

### 4.4 `window.Matchday`（js/matchday.js）

```js
Matchday.playPreMatch(ctx, done)    // UX-03。done() を必ず呼ぶ（スキップ時も）
   // ctx: { round, rounds, myDef, oppDef, myName, oppName, iAmHome, isRival, h2hText,
   //        threatText, weekSummary:[{icon,text}], goalText }
   // 3〜4コマ: ①トンネル/監督室 → ②相手と脅威（宿敵なら赤演出）→ ③今週の準備を反映した一言 → ④KICK OFF スタンプ
   // タップでスキップ可。window.PREMATCH_ENABLED===false で即 done()
Matchday.playPostMatch(panels, opts, done)   // UX-04
   // panels は league.js が組む（§4.5）。Juice.sequence で1コマずつ開く
   // opts: { res:'W'|'D'|'L', celebrate:boolean, closeLabel:string }
```

### 4.5 ポストマッチのパネル契約（league.js → Matchday）

`_renderHub(true)` の一括表示をやめ、league.js は**パネル配列**を組んで `Matchday.playPostMatch` に渡す。
中身の HTML 生成は **既存の league.js の関数をそのまま再利用**する（`_headlineText` / `_reportRowsHTML` /
`_managerGrowthHTML` / `_bestXIHTML` / `_previewHTML`）＝ロジック・文言の二重管理を作らない。

| # | id | 内容 | SFX | 効果 |
|---|---|---|---|---|
| 1 | `score` | スコア＋結果スタンプ | `whistle` | スコアを `countUp`・スタンプ着弾・勝利なら `confetti` |
| 2 | `headline` | 見出し（記者会見バック） | `stamp` | 見出しが叩きつけられる |
| 3 | `report` | MOM・得点者 | `ping` | 選手カードが出現 |
| 4 | `table` | 順位変動 | `tick` | 自クラブ行が移動・▲▼ |
| 5 | `growth` | 今週の成果／人気／信頼 | `coin` | バー伸長＋数値 countUp（習得時は `fanfare`） |
| 6 | `bestxi` | WEEKLY BEST XI 見開き | `page` | 誌面がめくれて出る |
| 7 | `preview` | 次回予告 | `page` | クリフハンガー |

**表示形式は「カードデッキ」**（`Juice.sequence` の `mode:'replace'`）。
ヘッダ / デッキ / ナビ の3段固定で、**1ビートが1画面を占有し、タップで入れ替わる**。
進行ドットと「5 / 8」で儀式の長さを示し、◀▶ で前後に移動できる。最後のカードで
▶ が「監督室へ戻る」に変わる。✕ でいつでも抜けられる。

> ⚠️ **当初は「誌面が下に伸びる」積み上げ式だった。作り直した（2026-07-24）。**
> 実プレイの指摘：「下にどんどん追加されるUIが非常に気になる。ゲームっぽさがない」。
> 原因は**試合外まで「漫画・連載」の枠を持ち込んだこと**。積み上げると結果が長い
> スクロール＝**文書**として読める。**漫画のコマ割りは試合画面の役目であって、
> 試合外がそれに縛られる必要はない**（ユーザー明言）。
> 教訓: 試合外のビートは「1画面1ビートで入れ替える」。積まない。

祝祭（紙吹雪・会見のフラッシュ）は `onShow(el, firstTime)` の `firstTime` でのみ発火する
（戻って見返すたびに出ると安っぽい）。
**フォールバック**: `Matchday` 未搭載／`JUICE_ENABLED===false` の時は**従来どおり `_renderHub(true)` で一括表示**。

---

## 5. デザイントークン（css/league-ui.css・UX-01）

実行時注入の巨大文字列（`_ensureStyle`）を廃止し、**実ファイル**へ移す。
`build.js` の `?v=` 正規表現を `css/[a-z-]+\.css` に広げ、`index.html` に `<link>` を追加する。

```css
:root{
  /* 面 */
  --lg-bg-0:#0b1f3f; --lg-bg-1:#0a2a5e; --lg-bg-2:#0d1b3e;
  --lg-surface:rgba(255,255,255,.06); --lg-surface-2:rgba(255,255,255,.10);
  --lg-line:rgba(255,255,255,.12);
  /* 文字 */
  --lg-text:#fff; --lg-text-dim:rgba(255,255,255,.70); --lg-text-mute:rgba(255,255,255,.45);
  /* 意味色 */
  --lg-win:#2ecc71; --lg-draw:#f1c40f; --lg-loss:#e74c3c;
  --lg-accent:#e8433b; --lg-info:#7ad0ff; --lg-gold:#f5c518; --lg-gold-2:#c9a227;
  /* 形 */
  --lg-r-s:8px; --lg-r-m:12px; --lg-r-l:16px;
  --lg-pad-s:8px; --lg-pad-m:12px; --lg-pad-l:16px;
  --lg-shadow:0 4px 18px rgba(0,0,0,.25);
  /* 動き */
  --lg-t-fast:.14s; --lg-t-mid:.32s; --lg-t-slow:.6s;
  --lg-ease:cubic-bezier(.22,.61,.36,1);
}
```

**規約**:
- **ハードコード16進色を新規に書かない**。既存 `.lg-*` のハードコード色もトークン参照へ置換する。
- クラブカラー（`CLUB_DEFS[].color`）のような**データ由来の色だけ**インライン可。
- `[AGENTS.md] 5`（新 screen は暗背景必須・背景変更時は color も明示）を守る。
- `@media (prefers-reduced-motion: reduce)` で transition/animation を全停止。
- 既存の `body.league-mode` 横長2カラム（`css/style.css:174-230`）は**壊さない**。新CSSはそこと共存する。

---

## 6. 監督室シェル（UX-01）の画面構成

```
┌─ 監督室（#screen-home） ─────────────────────────┐
│  [壁] 掲示板: 今週の準備（3コマ）   [壁] 順位ボード │
│  [デスク] 次節のカード（VS）→ 週末の試合へ          │
│  [デスク] 監督の手帳（ステータス・信頼・目標）       │
│  [本棚] バックナンバー / 前回の試合ログ             │
└────────────────────────────────────────────────┘
```

- 既存の**縦1カラム／横長2カラムのDOM構造（`.lg-cols`/`.lg-col-main`/`.lg-col-side`）は維持**する。
  監督室化は「そのグリッドの上に背景・フレーム・質感を敷く」形で実現する＝**レイアウト崩壊のリスクを取らない**。
- 背景は `LabArt.bg('office_bg')`、下部に `office_desk` の帯。情報カードは半透明で上に浮かせる。

---

## 7. 実装の順序と担当

| 担当 | 成果物 | 備考 |
|---|---|---|
| **renderer-dev** | `js/juice.js` / `js/lab-art.js` / `js/matchday.js` | Canvas・演出・音。league.js は読むだけ |
| **ui-designer** | `css/league-ui.css` / `js/lg-ui.js` | HTML/CSS部品・トークン。league.js は読むだけ |
| **オーケストレータ** | `js/league.js` 統合 / `build.js` / `index.html` | 状態を持つファイルは1人が触る |
| **qa-regression** | ゲート | `node --check` 全新ファイル＋回帰＋lab 実起動(5178) |
| **asset-qa** | CG受入 | 画像が届いた後 |

---

## 8. 受入基準（DoD）

1. `node --check` が全新規ファイルで通る。
2. `node tools/regression-harness.js check 1500` が **回帰なし**（エンジン不変＝当然だが証拠を残す）。
3. `npm run build` → `dist-lab`(5178) で実起動し、以下がブラウザで観測できる:
   - 「週末の試合へ」→ **導入コマが出てから**キックオフ（スキップも効く）
   - 試合終了 → **1コマずつ**開く（スコアがカウントアップ・スタンプ・勝利で紙吹雪）
   - 監督バーが**伸びる**（即時 width ではない）
   - 順位表の自クラブ行が強調され、▲▼が出る
   - 育成対象が `<select>` **ではない**（顔付きカードのピッカー）
   - バックナンバーが `<details>` **ではない**（本棚→ページめくり）
   - 効果音が鳴る（`SFX_ENABLED=false` で止まる）
4. `window.JUICE_ENABLED=false` で**従来の即時表示に完全フォールバック**し、機能が失われない。
5. 画像を1枚も置いていない状態で**破綻しない**（全て手続きプレースホルダで描画される）。
6. 日英どちらでも表示が壊れない（i18n 規約4）。
7. 縦持ち／横持ちの両方でレイアウトが崩れない。

---

## 9. やらないこと（今回のスコープ外）

> ⚠️ 当初ここに「記者会見・ボードとの交渉などの新規ゲームシステムは器だけ先に作る」と
> 書いていたが**撤回した**（2026-07-24 ユーザー指摘）。器だけ作るのは、今回直したはずの
> 失敗（情報設計はあるのに中身が無い）を別の形で繰り返すだけだった。→ §10 / §11 で実装済み。

残る除外は**ハードなガードレール**だけ（設計判断ではない）:

- 試合中（`cutscene.js` / `manager-match.js`）の演出変更 — **触らない**。
- エンジン（`simulate.js` の判定・デュエル）— **触らない**（[AGENTS.md] 絶対ガードレール1）。
- 本番 `docs/` への反映 — lab のみ（ユーザー指示による本番凍結）。

---

## 10. PC-01 記者会見（試合後・毎試合）

**なぜ入れるか**: 「人気」と「クラブの信頼」は結果の関数でしか動かず、**プレイヤーが触れる
レバーが無かった**。会見は新しい数値を1つも足さずに、既存の3通貨を選択で動かせる唯一の場。

- **置き場所**: 「今節の号」の ④順位 の後・⑤今週の成果 の前。
  答える → 次のコマで数字が動く＝**原因と結果が隣り合う**。
- **質問は状況から選ぶ**（`PRESS_QUESTIONS` を上から評価し最初に当たったもの）:
  解任の噂／宿敵に勝・敗／大敗／大勝／MOMの評価／目標圏外／通常の勝・分・敗。
- **選択肢は3つで綱引き**（人気 / クラブの信頼 / 選手の信頼）。
  **支配的な選択肢を作らない**＝どれかが常に最適にならないよう配分する。
- **答えるまで先へ進めない**（`Juice.sequence` の `panel.await`）。
- ★ **MG-12（選手の信頼）をここで初めて「効く数値」にした** — `_trainPlayer` の伸びに
  乗る（信頼50=等倍 / 0で0.7倍 / 100で1.3倍）。育成ピッカーのカードに `♥値` を表示するので、
  「選手をかばう」の意味が目で見える。**エンジンには触らないので試合バランスの回帰はゼロ**。
- 冪等: 同じ試合の会見は1度だけ効く（再生・再入で二重加算しない）。

## 11. BD-01 ボードとの交渉（開幕・シーズンに1度）

シーズン目標は一方的に提示されるだけだった。開幕で**約束を交わす**ことを1年の入口にする。

| 選択 | 目標 | 信頼 | 人気 |
|---|---|---|---|
| 承知しました | 変更なし | ±0 | ±0 |
| 高すぎます（下げてもらう） | +1（楽になる） | **-8** | -3 |
| 物足りない（宣言する） | -1（厳しくなる） | **+8** | +4 |

- 面談を終えるまで**キックオフできない**（「まずボードと話す」で試合ボタンをロック）。
- 未達時の落差は既存の `_settleSeason` に乗るので、新しい清算ロジックは足していない。
- ★ 呼び出しは小文字・定義は大文字なので `_boardDef()` で必ず正規化する
  （黙って ACCEPT にフォールバックすると「下げた/宣言した」が無効化されて気づけない — 実際に踏んだ）。

## 12. SC-01 偵察レポート（相手の攻め筋・準備の判断材料）

**なぜ**: 攻め筋は「試合時」でなく**準備段階で読み、それを元にコマを選ぶ**もの。試合カード
から準備タブへ移した。上位3つを**ウェイト（バー）＋能力値**で見せ、📹ビデオ学習で封じた
攻め筋には ✓ が付く（read → choose の閉ループ）。

**ランキングを val（実際の強さ）順に変更**（旧：リーグ平均比 rel 順）。理由は実データ:
- アルゼンチンは能力81のショートパスより75のクロスが rel 上位に来て直感と食い違った
- ブラジル等の強豪バランス型は全項目が平均以下になり rel 順が無意味だった

→ `_opponentThreatsRanked()` が val 降順で返し、バーは各チーム内の min→max を 0..1 に
伸ばして「どの攻め筋に寄っているか」を可視化する。表示順とビデオ学習の対策順は val 順で
統一（順位とバーが必ず一致）。エンジンには触れないので回帰リスクなし。

## 13. MD-01 試合前の設定画面（スタメン/戦術/システム）

**なぜ**: 「週末の試合へ」で即キックオフだったが、監督なら**試合前にスタメン・戦術・
システムを決める**のが自然。既存の設定画面インフラ（`initSettingScreen`/`screen-setting`）を
流用して間に挟んだ。

**フロー**: 週末の試合へ → **設定画面** → キックオフ → 導入コマ(UX-03) → 試合。

- `playToday()` は team1State を組んだあと `startManagerMatch()` を直接叩かず、
  `window._leagueInMatch=true` にして設定画面を出す。
- キックオフは `startGame()`(simulate) が `window._leagueInMatch` を見て `leagueKickoff()`
  に委譲＝導入コマ→試合。戻るは `settingBack()`→`leagueCancelPrep()` で監督室へ。
- 戦術ロック（MG-04）は既存の `leagueTacticInfo` フックで設定画面でも効く
  （開幕は「バランス重視」のみ選択可）。複数試合ボタン(📊10/100)はリーグでは非表示。
- `initSettingScreen` はリーグ時 team1State を上書きしない（習得済み戦術の制約を保つ）。
- キャンセルは巻き戻す（戦術buff `_endManagerMatchCtx`・終了フック・pending・フラグ）。
  試合は消費しない（round 据え置き）。回復日 healing は冪等なので触らない。
- 公開版は `window._leagueInMatch` が undefined＝全ガード falsy で従来どおり（無影響）。
