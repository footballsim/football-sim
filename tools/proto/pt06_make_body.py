#!/usr/bin/env python3
"""PT-06: プレースホルダ「頭なしボディ」PNGを生成。
実アート受け入れ仕様の“形”を先に固定するためのダミー。
- キャンバス: 720 x 1200 (頭込み全身を想定した縦長。頭は別合成)
- 首ソケット中心 (NECK_SX, NECK_SY): ボディが頭を受ける点。ここに頭の neck socket を合わせる
- 首スタブは NECK_SY から上へ少しだけ描く(頭の首と重なって隠れる想定)
- 向き: 前向き3/4頭(顔=視者右向き)に合わせ、体はやや右肩を引く前向き。flip無しで整合
出力: tools/proto/pt06_body_placeholder.png
"""
from PIL import Image, ImageDraw

W, H = 720, 1200
# ---- アンカー宣言（このボディ1ポーズ分。実アートでもこの規約に合わせてもらう）----
NECK_SX = 360     # 首ソケット中心 x
NECK_SY = 300     # 首ソケット中心 y（頭の neck socket をここへ）
JERSEY = (0x20, 0x50, 0xcc, 255)   # 仮キット(ソリッド・実クラブ徽章なし)
SHADE  = (0x18, 0x3d, 0x9c, 255)
SKIN   = (0xe0, 0xb0, 0x88, 255)   # 首スタブ肌(頭に隠れる前提のプレースホルダ)

img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 首スタブ（NECK_SYから上下に少し。頭側の首と重なる）
neck_w = 96
d.rectangle([NECK_SX-neck_w//2, NECK_SY-40, NECK_SX+neck_w//2, NECK_SY+70], fill=SKIN)

# 肩〜胴（台形のジャージ）。前向き3/4に合わせ右肩(視者左)をわずかに前へ
sh_y = NECK_SY + 55
sh_half_top = 210
sh_half_bot = 250
torso_bot = 760
d.polygon([
    (NECK_SX - sh_half_top, sh_y),
    (NECK_SX + sh_half_top, sh_y),
    (NECK_SX + sh_half_bot, torso_bot),
    (NECK_SX - sh_half_bot, torso_bot),
], fill=JERSEY)
# 襟(首ソケットを囲む)
d.arc([NECK_SX-70, sh_y-40, NECK_SX+70, sh_y+40], start=0, end=180, fill=SHADE, width=14)
# 袖の陰
d.polygon([(NECK_SX-sh_half_top, sh_y),(NECK_SX-sh_half_top-40, sh_y+120),
           (NECK_SX-sh_half_bot+30, torso_bot),(NECK_SX-sh_half_bot, torso_bot)], fill=SHADE)
d.polygon([(NECK_SX+sh_half_top, sh_y),(NECK_SX+sh_half_top+40, sh_y+120),
           (NECK_SX+sh_half_bot-30, torso_bot),(NECK_SX+sh_half_bot, torso_bot)], fill=SHADE)

# 脚（ショーツ+すね）
short_y = torso_bot
d.rectangle([NECK_SX-200, short_y, NECK_SX-20, short_y+150], fill=(0xf0,0xf0,0xf0,255))
d.rectangle([NECK_SX+20, short_y, NECK_SX+200, short_y+150], fill=(0xf0,0xf0,0xf0,255))
leg_y = short_y+150
d.rectangle([NECK_SX-180, leg_y, NECK_SX-60, leg_y+250], fill=SKIN)
d.rectangle([NECK_SX+60, leg_y, NECK_SX+180, leg_y+250], fill=SKIN)
# ソックス+シューズ
d.rectangle([NECK_SX-180, leg_y+250, NECK_SX-60, leg_y+330], fill=JERSEY)
d.rectangle([NECK_SX+60, leg_y+250, NECK_SX+180, leg_y+330], fill=JERSEY)
d.ellipse([NECK_SX-190, leg_y+320, NECK_SX-40, leg_y+380], fill=(0x22,0x22,0x22,255))
d.ellipse([NECK_SX+40, leg_y+320, NECK_SX+190, leg_y+380], fill=(0x22,0x22,0x22,255))

# 首ソケットマーカー(検証用の十字。合成時は頭で隠れる)
d.line([NECK_SX-12, NECK_SY, NECK_SX+12, NECK_SY], fill=(255,0,0,255), width=3)
d.line([NECK_SX, NECK_SY-12, NECK_SX, NECK_SY+12], fill=(255,0,0,255), width=3)

img.save("tools/proto/pt06_body_placeholder.png")
print("saved tools/proto/pt06_body_placeholder.png  size", img.size,
      "neck_socket", (NECK_SX, NECK_SY))
