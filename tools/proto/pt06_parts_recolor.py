#!/usr/bin/env python3
# 4パーツ独立リカラー実証: 分離用ベース(shirt青/shorts緑/socks桃/accentシアン)から
# skin/shirt/shorts/socks/accent を色相マスクで分離し、各々独立に平坦ランプでスワップ。
import colorsys
from PIL import Image, ImageDraw

base_sheet = Image.open('tools/proto/pt06_parts_base.png').convert('RGBA')
W0, H0 = base_sheet.size
sp = base_sheet.load()
# white-key
for y in range(H0):
    for x in range(W0):
        r, g, b, a = sp[x, y]
        if r > 236 and g > 236 and b > 236:
            sp[x, y] = (r, g, b, 0)
# crop top-left figure
region = base_sheet.crop((6, 4, 372, 384))
fig = region.crop(region.getbbox())
fig.save('img/cutscenes/shot_pt06parts_01.png')
W, H = fig.size
base = fig.load()
print('cropped parts figure', (W, H))

def hsv(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r/255.0, g/255.0, b/255.0); return h*360, s, v
def hx(h):
    h = h.lstrip('#'); return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
def shade(c, f): return tuple(int(x*f) for x in c)
def light(c, f): return tuple(int(x+(255-x)*f) for x in c)
def lum(r, g, b): return 0.299*r+0.587*g+0.114*b

# パーツ判定（色相）
def part_of(r, g, b, a):
    if a < 40: return None
    h, s, v = hsv(r, g, b)
    if v < 0.22 or s < 0.16: return 'fixed'          # 髪/靴/輪郭（暗・低彩度）
    if 14 <= h <= 50: return 'skin'
    if 120 <= h <= 168: return 'shorts'
    if 170 <= h <= 202: return 'accent'
    if 203 <= h <= 245: return 'shirt'
    if 300 <= h <= 350: return 'socks'
    return 'fixed'

# 各パーツ輝度パーセンタイル
PARTS = ['skin', 'shirt', 'shorts', 'socks', 'accent']
lums = {k: [] for k in PARTS}
for y in range(H):
    for x in range(W):
        r, g, b, a = base[x, y]
        pt = part_of(r, g, b, a)
        if pt in lums: lums[pt].append(lum(r, g, b))
THR = {}
for k in PARTS:
    ls = sorted(lums[k]); n = len(ls)
    THR[k] = (ls[int(n*0.34)], ls[int(n*0.67)]) if n > 3 else (100, 170)

def ramp(c): return (shade(c, 0.58), c, light(c, 0.34))

def recolor(colors, skin_hex='#e6ad7f'):
    # colors: dict shirt/shorts/socks/accent hex
    rmp = {k: ramp(hx(colors[k])) for k in ['shirt', 'shorts', 'socks', 'accent']}
    rmp['skin'] = ramp(hx(skin_hex))
    out = fig.copy(); op = out.load()
    for y in range(H):
        for x in range(W):
            r, g, b, a = base[x, y]
            pt = part_of(r, g, b, a)
            if pt in rmp:
                L = lum(r, g, b); t = THR[pt]
                c = rmp[pt][0] if L < t[0] else (rmp[pt][1] if L < t[1] else rmp[pt][2])
                op[x, y] = (c[0], c[1], c[2], a)
    return out

# デモ用キット定義（shirt/shorts/socks/accent）
KITS = [
    ('日本風', {'shirt': '#1b3fa0', 'shorts': '#1b3fa0', 'socks': '#1b3fa0', 'accent': '#e8e8ee'}),
    ('赤白', {'shirt': '#c0392b', 'shorts': '#e8e8ee', 'socks': '#c0392b', 'accent': '#1a1a2a'}),
    ('緑黒', {'shirt': '#1f8f3a', 'shorts': '#12121a', 'socks': '#1f8f3a', 'accent': '#e0bd34'}),
    ('黄黒', {'shirt': '#e0bd34', 'shorts': '#12121a', 'socks': '#e0bd34', 'accent': '#12121a'}),
    ('白紺', {'shirt': '#e8e8ee', 'shorts': '#1a2450', 'socks': '#e8e8ee', 'accent': '#c0392b'}),
]
SKIN = ['#ffdcbb', '#f4c79b', '#e6ad7f', '#cf8f5d', '#a06a3f', '#6f492c']

pad, lab = 12, 18
CW, CH = W+pad, H+pad+lab
cols = max(len(KITS)+1, len(SKIN))
sheet = Image.new('RGBA', (CW*cols+pad, CH*2+pad), (20, 26, 40, 255))
d = ImageDraw.Draw(sheet)
# row1: 元 + キット5種
sheet.alpha_composite(fig, (pad, pad)); d.text((pad, pad+H+3), 'base(分離色)', fill=(200, 200, 210, 255))
for i, (nm, kit) in enumerate(KITS):
    img = recolor(kit); x = pad+(i+1)*CW; y = pad
    sheet.alpha_composite(img, (x, y)); d.text((x, y+H+3), nm, fill=(122, 220, 255, 255))
# row2: 肌6段（キット=赤白固定）
for i, s in enumerate(SKIN):
    img = recolor(KITS[1][1], skin_hex=s); x = pad+i*CW; y = pad+CH
    sheet.alpha_composite(img, (x, y)); d.text((x, y+H+3), 'skin '+str(i), fill=(255, 226, 122, 255))
sheet.convert('RGB').save('/Users/iwasakimitsuru/Desktop/pt06_parts_recolor.png')
# 単体保存: 赤白キット (プレビュー用)
recolor(KITS[1][1], skin_hex='#e6ad7f').save('img/cutscenes/shot_pt06parts_redwhite_01.png')
print('THR', {k: tuple(round(v) for v in THR[k]) for k in THR})
print('saved ~/Desktop/pt06_parts_recolor.png', sheet.size)
