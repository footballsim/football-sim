# Football Simulation Lab - プロジェクトルール

## 概要
単一HTMLファイルのサッカーシミュレーター。
ファイル: `index.html`（約8500行）
目標: W杯シミュレーターとして完成させる

## 絶対ルール
- **単一HTMLファイルで完結**させること（外部JSファイル等に分割しない）
- **デュエルカウントロジックには触れない**（既知の未解決バグあり）
- 変更は該当箇所のdiffのみ提示。全文出力は求められた時だけ

## 技術スタック
- 純粋なHTML/CSS/JavaScript（フレームワークなし）
- Google Fonts（Noto Sans JP, Bebas Neue）
- Google Analytics（G-CY06KBG4N8）

## 変更時の注意
- diff提示の際は変更箇所と理由を簡潔に説明する
- 既存のCSS変数（--japan-blue, --japan-red等）を尊重する
- テキスト色は必ず明示的に指定すること。background変更時は必ずcolorも合わせて指定する
- 新しいscreenを追加する際は必ず暗い背景（`linear-gradient(160deg, #003087 0%, #0050cc 50%, #1a7a3a 100%)`）を設定する。白背景+白文字の組み合わせはNG

## インフラ情報
- **本番URL**: https://football-sim.com （GitHub Pages でホスト）
- **リポジトリ**: https://github.com/footballsim/football-sim
- **公開ディレクトリ**: `docs/` フォルダ（`docs/index.html` がトップページ）
- **VPS**: GMOクラウドVPSマイクロ / IP: 153.122.40.240 / CentOS 6.6
  - SSH: `ssh -oHostKeyAlgorithms=+ssh-rsa root@153.122.40.240`
  - http→https リダイレクト設定済み（Apache `/etc/httpd/conf/httpd.conf`）
  - VPSはリダイレクト専用。コンテンツはGitHub Pagesが配信

## 現在の実装状況（2026/06/01時点）

### シングルマッチ
- チーム1・チーム2を自由選択できる2ステップUI実装済み
- `SINGLE_TEAMS` 配列でチームリストを管理（`selectTeam1()` / `selectTeam2()` 関数）
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

### 実装済みTEAM_DATAキー一覧
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
- `buildPlayersTable()` に渡す配列に全チームを列挙（index.html 約4880行付近）
- ドイツ・アメリカ含む全16チームデータが表示される
- 各選手の身長・体重・日英プロフィールは `PLAYER_EXTRA` オブジェクト（約2798行）に定義
  - ドイツ26名 ✅、アメリカ26名 ✅ 追加済み

### 今後のTODO
1. **残り34チームのデータ追加**（2026W杯48チーム全実装が目標）
   - データ取得方法:
     - ロスター: ussoccer.com / 各国サッカー協会公式 / ESPN等
     - スタッツ: EA Sports公式（`https://www.ea.com/en/games/ea-sports-fc/ratings/player-ratings/<name>/<id>`）
     - sofifa.comはアクセス禁止のため使用不可
   - 新チーム追加手順:
     1. `TEAM_DATA` にエントリ追加（`germany2026`/`usa2026` を参考）
     2. `buildPlayersTable()` の配列に追加
     3. `SINGLE_TEAMS` に追加
     4. `PLAYER_EXTRA` に全選手のプロフィール・身長・体重を追加

2. **W杯モードの汎用化**
   - 現状: 日本のグループC（日本・オランダ・チュニジア・スウェーデン）にハードコード
   - 目標: 選択した国の実際の2026W杯グループで戦えるように
   - 2026W杯は12グループ×4チーム = 48チーム

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
