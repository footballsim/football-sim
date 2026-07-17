# rejected/ — 受入検査FAILの生成物置き場（使用禁止）

合格品と混在させないための隔離フォルダ。ここのファイルはスライス・配線・リカラーに**使わない**。
再生成の参照や失敗分析のためだけに残している。判定は `tools/proto/asset_accept.py`＋asset-qaエージェント。

| ファイル | 却下理由 |
|---|---|
| manga_dribble12_base.png | 旧世代。最下段の脚NG（2026-07-06昼） |
| manga_dribble12_beard.png | 旧世代髭テスト。4行目膝下切断 |
| manga_dribble12_base_v2.png | **全12体の軸足が足首下11px(3.0%)の切れ端**（基準32px/8.6%）。対策文言入り再生成でも再発した回 |
| manga_dribble12_beard_full_v2.png | 同上（v2ベース由来） |
| manga_dribble12_beard_goatee_v2.png | 同上（v2ベース由来） |
| manga_beard_goatee_v3.png | 髭が全く描かれない「無変更コピー」が返った回（足は正常）。編集元として役目済み |
| manga_beard_stubble_v1.png | 全12体の軸足が10-11pxの切れ端に退行 |
| manga_beard_stubble_v2.png | 最下段が下端余白0pxで足切れ（靴高21px/5.7%） |
| manga_beard_stubble_v3.png | 最下段圧縮（行高284 vs 上段322-338）＋下端余白0px |

無精髭はChatGPT生成を断念し、色替えエンジンの顎・頬陰影で表現する（2026-07-06決定）。

## 合格品（tools/proto/直下）
- `pt06_parts_base.png` — 分離色ベース＝受入検査の合格基準アセット
- `manga_beard_full_v3.png` / `manga_beard_goatee_v4.png` / `manga_beard_mustache_v1.png` — 髭3種（機械+asset-qa PASS）

| poseA_grid_v1.png | 新ドリブル体グリッドv1。最下段の足が下端で切断（下端余白0.8%）。 |
| poseA_grid_v2.png / manga_sprites_v2/ | 新ドリブル体グリッドv2。行ごとにスケール縮小(肩幅上段157→下段137px/-13%)＋上段3体の後ろ足が右フレーム端で切断＋全12体の前足スタッドが下端0px。asset-qa FAIL(2026-07-07)。 |
| poseB_2x2_batch1.png | 新ドリブラー体バッチ1。4体ともスパイクが元データと別物（黒い塊に劣化・afro/curlyは前足の靴自体なし）。基準との絶対比較で不合格(2026-07-08ユーザー判定)。 |
| slider_2x2_batch1.png | スライディング守備バッチ1初回。左右の体が接触(指⇔ソックス)し、watershed分割でも左列2体の指先が斜め切断。「4体は互いに一切接触させない・広い白余白」を追加した再生成版(slider_2x2_batch1_v2)で置換(2026-07-08)。 |
| slide2_fade_norm.png / slide2_fade_raw.png | スライディング守備v2(1画像2体×6枚)のfade。**茶髪の丸刈り＝正典逸脱**(既存4シーンのfadeは全て黒髪+サイド刈上げ+トップ毛量。MangaRecolorは髪を塗り替えないため同一選手がシーン間で別人になる)。原因=髪型参照に渡したカラーのピクセルヘッド画像から髪色まで写した。再依頼は「黒髪・サイド刈上げ・トップ短い立ち毛」を明示(2026-07-09 asset-qa FAIL)。 |

## 2026-07-17 FK Cutscene Rejection

| freekick1_01_rejected_20260717.png | FK蹴る前シーン。RGB背景(透過なし)＋背景非純白率99.2%＋色数68,962(量子化不完全)＋ソックス検出失敗。要件: PNG/Palette/透過/純白背景/色数<256。再生成時は chroma-key或いはPNG透過 + 要機械検査PASS。 |
| freekick2_01_rejected_20260717.png | FK蹴ったシーン。RGB背景(透過なし)＋背景非純白率99.1%＋色数59,844(量子化不完全)＋ソックス検出失敗。同上。 |

## foul_atk_wavy_rejected_20260717.png (2026-07-17)
転倒(foul_atk)差し替え版・asset-qa FAIL。却下理由:
1. 腕胴間の閉じた隙間に背景抜き残し＝不透明純白1743px (bbox 549,193-617,253)。flood_bgが外周連結のみで閉鎖穴を通過できず
2. ベロ縁AA 5pxがsocks窓(300-350°)残存(s0.16-0.3が旧ガードのs>0.3条件から漏れ)
※2026-07-17 wavy.png 初回納品=腕胴間背景穴1743px+ベロ縁socks窓5pxでFAIL→同日 process_tumble.py 再処理(fill_enclosed_bg+ベロ再ガード)でPASS済

## foul_atk_wavy_teeth_clean_rejected_20260717.png (2026-07-17)
歯クリーンアップ版・asset-qa FAIL。却下理由:
- clean_teeth のフラッド除外が is_red/is_skin のみで「黒い口の輪郭線」が無防備＝通過対象だった。
  変更175pxのうち144pxが輪郭線(lum<80)→純白(246)化。y120-121は輪郭が0px＝完全断裂
- 歯の輝度統計(純白31→115)は改善したが、それは輪郭を消して得た数字。ゲーム実寸34%で
  口が「白い塊＋赤い点」にしか読めず、可読性は従来版より悪化（包帯/泡に見える）
- 教訓: 指標(白比率)の改善≠絵の改善。検証は口だけの切り抜きでなく「顔全体」で見ること
- フラッド漏れ(口外)は0px＝box制限の設計自体は有効

## foul_atk_wavy_mouth_rebuild_v1_rejected_20260717.png (2026-07-17)
3要素再構成 v1・asset-qa FAIL。却下理由:
- 口の造形自体は成功（輪郭断裂解消・3要素成立・実寸34%で開口が明確に読める）＝設計は正しい
- しかし find_tongue_box が画像全体の赤 min/max を取るため box が 387x158＝キャンバス22% に肥大
  （スパイク/腿の暗赤15pxを拾うため）。その中の lum>200 肌ハイライトが seed（ガード未適用）となり、
  塗り条件を lum<=200→lum>30 に変えたことで seed 自身が黒塗り対象化＝素肌に黒点10px
  （首x539,y126-128 / 前腕x492,y184 / 腿x257,y207 / 指x576,x583,x586）
- is_red のRGB判定が明るいオレンジ肌(255,197,116・実測hue35°)を「赤」と誤分類していたのも一因
- 教訓: 再生成時のゲートに「全画素diffのbboxが口box内に収まること」を入れる
