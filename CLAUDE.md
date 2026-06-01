# Football Simulation Lab - プロジェクトルール

## 概要
単一HTMLファイルのサッカーシミュレーター。
ファイル: `index.html`（約7500行）
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
- 日本選択時は対戦相手別最適データ（`japan2026vsEngland`等）を自動使用

### 実装済みTEAM_DATAキー一覧
- 日本系: `japan2026`, `japan2026vsEngland`, `japan2026vsNetherlands`, `japan2026vsTunisia`, `japan2026vsSweden`
- 対戦相手: `england2026`, `scotland2026`, `netherlands2026`, `tunisia2026`, `sweden2026`, `morocco2026`, `brazil2026`, `mexico2026`, `norway2026`, `argentina2026`, `spain2026`, `france2026`
- 新規追加: `germany2026`（2026W杯正式26名、FC26データ準拠）

### 今後のTODO
1. **残り34チームのデータ追加**（2026W杯48チーム全実装が目標）
   - データ取得方法: EA Sports公式サイト（https://www.ea.com/en/games/ea-sports-fc/ratings/nations-ratings/）からWebFetchで取得
   - sofifa.comはアクセス禁止のため使用不可
2. **W杯モードの汎用化**
   - 現状: 日本のグループC（日本・オランダ・チュニジア・スウェーデン）にハードコード
   - 目標: 選択した国の実際の2026W杯グループで戦えるように
   - 2026W杯は12グループ×4チーム = 48チーム

### パラメータ体系（29個）
idx0:パワー, idx1:スタミナ, idx2:トップスピード, idx3:加速力, idx4:反応,
idx5:ジャンプ, idx6:敏捷性, idx7:ドリブル精度, idx8:ドリブル速度,
idx9:ショートパス精度, idx10:ロングパス精度, idx11:シュート精度,
idx12:シュートセンス, idx13:シュート技術, idx14:FK精度, idx15:カーブ,
idx16:ボール技術, idx17:オフェンシブ, idx18:パスカット, idx19:タックル,
idx20:マンマーキング, idx21:カバーリング, idx22:チェイシング, idx23:セービング,
idx24:ハイボール処理, idx25:ヘディング, idx26:ポジショニング,
idx27:メンタリティ, idx28:フェアプレー
- GK専用: idx4=REF, idx10=KIC, idx23=DIV, idx24=HAN, idx26=POS（他は50固定）
- FC26の PAC→idx2/3, SHO→idx11-13, PAS→idx9/10, DRI→idx7/8, DEF→idx18-22, PHY→idx0/1/5 にマッピング

## 検討メモ

### GK配球パラメータの実装（将来課題）
- **背景**: GKのSHORTPASS(idx9)・LONGPASS(idx10)は現在ゲームロジックに完全未使用
  - `selectOffencePosition()`でGK(pos=0)が明示除外されており、パスアクションに選ばれることはない（行4965「GKを除くフィールド選手からランダム選択」）
  - チーム平均パラメータのような間接計算もなし
  - 「パスが高いとチャンスが増える」という間接効果も存在しない（確認済み）
- **将来実装案**: GKをビルドアップの起点として組み込む
  - idx10(LONGPASS) → GKのゴールキック/フィード精度として使用
  - idx9(SHORTPASS) → GKのショートビルドアップ精度
  - SoFIFAの「GKキック」をLONGPASS(idx10)にマッピングするのが自然
  - エデルソン型（配球型GK）とそれ以外の差別化が可能
- **データ備考**: SoFIFAページから取得した「GKキック」値をLONGPASS(idx10)に格納しておけば実装時にすぐ使える
  - 鈴木彩艶: GKキック=71（2025/09/19版）
