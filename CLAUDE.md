# Football Simulation Lab - プロジェクトルール

## 概要
サッカーシミュレーター（W杯モード・シングルマッチ対応）。
目標: 2026W杯48チーム全実装 + W杯モードの汎用化。

## ファイル構成（2026/06/02 分割済み）
```
football-sim/
├── index.html        # HTMLシェルのみ（727行）
├── js/
│   ├── players.js    # i18n・定数・PLAYER_EXTRA・system_data・TEAM_DATA（2048行）
│   ├── simulate.js   # STATE・画面管理・設定画面・ゲームエンジン・シーン描画（3665行）
│   ├── narration.js  # 10試合モード・WCモード・AI総括・画像生成（3242行）
│   └── ui.js         # Firebase・WC統計システム（319行）
└── css/
    └── style.css     # 全スタイル（1561行）
```

### ファイル別の主要な関数・変数
| 変数/関数 | 場所 |
|-----------|------|
| `PLAYER_EXTRA` | js/players.js |
| `TEAM_DATA` | js/players.js |
| `system_data`, `TACTICS_NAMES` | js/players.js |
| `i18n`, `t()`, `setLang()`, `applyLang()` | js/players.js |
| `scenario_data_ja/en` | js/players.js |
| `currentMatchKey`, `team1Data`, `team2Data` | js/simulate.js（STATE） |
| `showScreen()`, `buildPlayersTable()` | js/simulate.js |
| `startGame()`, `simulateChance()` | js/simulate.js |
| `buildTeam()`, `selectAction()` | js/simulate.js |
| `sceneToText()`, `renderSceneField()` | js/simulate.js |
| `renderFormation()`, `renderBench()` | js/simulate.js |
| `runMultiGame()`, `showResult()` | js/narration.js |
| `startWCMatch()`, `showWCR32()` など | js/narration.js |
| `generateSummary()`, `generateShareImage()` | js/narration.js |
| Firebase設定、`showWCStats()` | js/ui.js |

### ロード順・スコープ
- ロード順: `players.js` → `simulate.js` → `narration.js` → `ui.js`
- ES modulesではなく通常の `<script>` タグ → 全変数がグローバルスコープを共有
- 新チーム追加は **players.js** のみ編集すれば OK

## 絶対ルール
- **デュエルカウントロジックには触れない**（既知の未解決バグあり）
- 変更は該当箇所のdiffのみ提示。全文出力は求められた時だけ

## 技術スタック
- 純粋なHTML/CSS/JavaScript（フレームワークなし）
- Google Fonts（Noto Sans JP, Bebas Neue）
- Google Analytics（G-JEPGS2HPDE）
- Firebase Firestore（WC統計機能用）

## 変更時の注意
- diff提示の際は変更箇所と理由を簡潔に説明する
- 既存のCSS変数（--japan-blue, --japan-red等）を尊重する
- テキスト色は必ず明示的に指定すること。background変更時は必ずcolorも合わせて指定する
- 新しいscreenを追加する際は必ず暗い背景（`linear-gradient(160deg, #003087 0%, #0050cc 50%, #1a7a3a 100%)`）を設定する。白背景+白文字の組み合わせはNG

## インフラ情報
- **本番URL**: https://football-sim.com （GitHub Pages でホスト）
- **リポジトリ**: https://github.com/footballsim/football-sim
- **公開ディレクトリ**: `docs/` フォルダ（`docs/index.html` がトップページ）
  - ⚠️ `docs/` は現在も旧単一ファイル構成。本番反映時は `js/` `css/` も `docs/` にコピーが必要
- **VPS**: GMOクラウドVPSマイクロ / IP: 153.122.40.240 / CentOS 6.6
  - SSH: `ssh -oHostKeyAlgorithms=+ssh-rsa root@153.122.40.240`
  - http→https リダイレクト設定済み（Apache `/etc/httpd/conf/httpd.conf`）
  - VPSはリダイレクト専用。コンテンツはGitHub Pagesが配信

## 現在の実装状況（2026/06/03時点）

### シングルマッチ
- チーム1・チーム2を自由選択できる2ステップUI実装済み
- `SINGLE_TEAMS` 配列でチームリストを管理（`selectTeam1()` / `selectTeam2()` 関数）→ **js/simulate.js**
- 日本選択時は対戦相手別最適データを自動使用（下記oppMap参照）
- **日本のデフォルトスタメン = `japan2026vsNetherlands`（W杯モード第1戦と同一）**
  - スタメン: 鈴木彩/谷口/渡辺/伊藤洋/佐野海/遠藤航/堂安/中村敬/久保/鎌田/上田
  - フォーメーション: 3-4-2-1

#### 対戦相手別Japan oppMap（selectTeam2内）
```
'england2026'     → japan2026vsEngland
'netherlands2026' → japan2026vsNetherlands
'tunisia2026'     → japan2026vsTunisia
'sweden2026'      → japan2026vsSweden
それ以外          → japan2026vsNetherlands（フォールバック）
```

### 実装済みTEAM_DATAキー一覧（js/players.js）
#### 日本系
- `japan2026` — 汎用日本データ（旧）
- `japan2026vsEngland` — 対イングランド最適（伊東・後藤スタメン）
- `japan2026vsNetherlands` — 対オランダ最適 / **シングルマッチ・W杯モードの共通ベース**
- `japan2026vsTunisia` — 対チュニジア最適
- `japan2026vsSweden` — 対スウェーデン最適

#### 実装済み対戦相手（14カ国）
| キー | 国 | 備考 |
|------|----|------|
| `england2026` | イングランド | |
| `scotland2026` | スコットランド | |
| `netherlands2026` | オランダ | |
| `tunisia2026` | チュニジア | |
| `sweden2026` | スウェーデン | |
| `morocco2026` | モロッコ | |
| `brazil2026` | ブラジル | |
| `mexico2026` | メキシコ | |
| `norway2026` | ノルウェー | |
| `argentina2026` | アルゼンチン | |
| `spain2026` | スペイン | |
| `france2026` | フランス | |
| `germany2026` | ドイツ | 2026W杯正式26名、FC26データ準拠 |
| `usa2026` | アメリカ | 2026W杯正式26名、FC26データ準拠 |

### 選手データ一覧（screen-players）
- `buildPlayersTable()` に渡す配列に全チームを列挙 → **js/simulate.js** を検索
- ドイツ・アメリカ含む全16チームデータが表示される
- 各選手の身長・体重・日英プロフィールは `PLAYER_EXTRA` オブジェクト → **js/players.js** の先頭付近

### 今後のTODO
1. **残り34チームのデータ追加**（2026W杯48チーム全実装が目標）
   - データ取得方法:
     - ロスター照合: **transfermarkt.co.uk**（正式選出スクワッドの確認に必須）
     - FC26スタッツ: **sofifa.com**（simプロファイルのChromeにClaude拡張機能を入れているのでアクセス可能）
       - チームURL例: `https://sofifa.com/team/1354/portugal/260035/`
       - 列の順: PAC/DIV｜SHO/HAN｜PAS/KIC｜DRI/REF｜DEF/SPD｜PHY/POS
       - GKはDIV/HAN/KIC/REF/SPD/POSの順で読み替える
       - ⚠️ **sofifa.com アクセス不可の場合**: `https://www.ea.com/games/ea-sports-fc/ratings` または各選手の FC26 個別ページ（Google検索「FC26 [選手名] ratings」）を参照してパラメータを取得する
     - ロスター補助: ussoccer.com / 各国協会公式 / ESPN等
   - **得意ポジション（`positions`配列）設定ルール**:
     - **Step 1 - Transfermarkt**: メイン＋サブポジションを取得し、以下の対応表でシミュレータコードに変換。配列の先頭はTMのメインポジション固定。
       | Transfermarkt | シミュレータ |
       |---------------|-------------|
       | Goalkeeper | GK |
       | Centre-Back | CB（方向なし） |
       | Right-Back | 右SB |
       | Left-Back | 左SB |
       | Right Wing-Back | 右SMF |
       | Left Wing-Back | 左SMF |
       | Defensive Midfield | DMF |
       | Central Midfield | CMF |
       | Attacking Midfield | OMF |
       | Right Midfield | 右SMF |
       | Left Midfield | 左SMF |
       | Second Striker | OMF |
       | Right Winger | 右WG |
       | Left Winger | 左WG |
       | Centre-Forward | CF |
     - **Step 2 - Sofifa**: 選手ページの「Preferred Positions」欄のレーティングを確認。**メインポジションのレーティング − 3 以内**のポジションをすべてシミュレータコードに変換して追加（閾値は今後変更の可能性あり）。
       - ⚠️ **Sofifa アクセス不可の場合**: Step 2 はスキップし、**TM のみの情報を採用**する。
     - **重複排除**: Step 1・2で重複したポジションは1つにまとめる。
     - **例（Son Heung-min）**: TM→左WG(メイン)/CF/OMF、Sofifa→84(CF)メイン、83の左右WG・左右SMF・OMF → `["左WG","CF","OMF","右WG","左SMF","右SMF"]`
   - 新チーム追加手順（**編集ファイルは js/players.js のみ**）:
     1. transfermarkt.co.ukで正式26名ロスターを確認
     2. sofifa.comでチームページを開き、全選手のFC26スタッツ（PAC/SHO/PAS/DRI/DEF/PHY）を取得
     3. sofifa.comのチームページでフォーメーション（`default_system`）を確認し `TEAM_DATA` に反映
        - フォーメーションはページ内の「戦術」セクションまたは先発配置から読み取る
     4. `TEAM_DATA` にエントリ追加（`germany2026`/`usa2026` を参考）→ **js/players.js**
     5. `buildPlayersTable()` の配列に追加 → **js/simulate.js**
     6. `SINGLE_TEAMS` に追加 → **js/simulate.js**
     7. `PLAYER_EXTRA` に全選手のプロフィール・身長・体重を追加 → **js/players.js**
        - **プロフィール文章の禁止事項（日英両方）**:
          - ❌ FIFA / ワールドカップ / W杯 / World Cup
          - ❌ チャンピオンズリーグ / Champions League
          - ❌ 特定のクラブ名（例: PSG, マンチェスター・シティ, バルセロナ, ベンフィカ等）
          - ✅ 代わりに選手の特徴・プレースタイル・代表での役割を中心に記述する

2. **W杯モードの汎用化**
   - 現状: 日本のグループC（日本・オランダ・チュニジア・スウェーデン）にハードコード
   - 目標: 選択した国の実際の2026W杯グループで戦えるように
   - 2026W杯は12グループ×4チーム = 48チーム

3. **本番（docs/）への反映**
   - `docs/` フォルダはまだ旧単一ファイル構成のまま
   - 反映時は `index.html`, `js/`, `css/` を `docs/` 以下にコピーが必要

### パラメータ体系（29個）
```
idx0:パワー, idx1:スタミナ, idx2:トップスピード, idx3:加速力, idx4:反応,
idx5:ジャンプ, idx6:敏捷性, idx7:ドリブル精度, idx8:ドリブル速度,
idx9:ショートパス精度, idx10:ロングパス精度, idx11:シュート精度,
idx12:シュートセンス, idx13:シュート技術, idx14:FK精度, idx15:カーブ,
idx16:ボール技術, idx17:オフェンシブ, idx18:パスカット, idx19:タックル,
idx20:マンマーキング, idx21:カバーリング, idx22:チェイシング, idx23:セービング,
idx24:ハイボール処理, idx25:ヘディング, idx26:ポジショニング,
idx27:メンタリティ, idx28:フェアプレー
```
- GK専用: idx4=REF, idx5=SPD, idx10=KIC, idx23=DIV, idx24=HAN, idx26=POS（他は50固定）
- FC26の PAC→idx2/3, SHO→idx11-13, PAS→idx9/10, DRI→idx7/8, DEF→idx18-22, PHY→idx0/1/5 にマッピング
- GKはDIV/HAN/KIC/REF/SPD/POSの6値のみ意味を持つ

#### FC26→パラメータ変換の目安（フィールド選手）
| FC26 | → | idx | 備考 |
|------|---|-----|------|
| PAC sprint | → | idx2 | トップスピード |
| PAC accel | → | idx3 | 加速力 |
| PAC/DRI avg | → | idx4 | 反応 |
| PHY jumping | → | idx5 | ジャンプ |
| DRI agility | → | idx6 | 敏捷性 |
| DRI ball_ctrl | → | idx7 | ドリブル精度 |
| (PAC+DRI)/2 | → | idx8 | ドリブル速度 |
| PAS short | → | idx9 | ショートパス精度 |
| PAS long | → | idx10 | ロングパス精度 |
| SHO finishing | → | idx11 | シュート精度 |
| SHO positioning | → | idx12 | シュートセンス |
| SHO shot_power | → | idx13 | シュート技術 |
| PHY strength | → | idx0 | パワー |
| PHY stamina | → | idx1 | スタミナ |
| DEF intercept | → | idx18 | パスカット |
| DEF standing | → | idx19 | タックル |
| DEF (各値) | → | idx20-22 | マンマーキング/カバーリング/チェイシング |
| PHY heading | → | idx25 | ヘディング |

## 検討メモ

### GK配球パラメータの実装（将来課題）
- **背景**: GKのSHORTPASS(idx9)・LONGPASS(idx10)は現在ゲームロジックに完全未使用
  - `selectOffencePosition()`でGK(pos=0)が明示除外されており、パスアクションに選ばれることはない
  - チーム平均パラメータのような間接計算もなし
- **将来実装案**: GKをビルドアップの起点として組み込む
  - idx10(LONGPASS) → GKのゴールキック/フィード精度として使用
  - idx9(SHORTPASS) → GKのショートビルドアップ精度
  - エデルソン型（配球型GK）とそれ以外の差別化が可能
- **データ備考**: 鈴木彩艶のGKキック=71（FC26）
