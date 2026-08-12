#!/usr/bin/env python3
# 平坦インデックス化リカラーの実証: 肌6段 + キット5色 をパレットスワップで生成。
import colorsys
from PIL import Image, ImageDraw

im = Image.open('img/cutscenes/shot_pt06feet_01.png').convert('RGBA')
W, H = im.size
base = im.load()

def hsv(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r/255.0, g/255.0, b/255.0); return h*360, s, v
def hx(h):
    h = h.lstrip('#'); return (int(h[0:2],16), int(h[2:4],16), int(h[4:6],16))
def shade(c, f): return tuple(int(x*f) for x in c)
def light(c, f): return tuple(int(x+(255-x)*f) for x in c)
def lum(r, g, b): return 0.299*r+0.587*g+0.114*b

def is_skin(r, g, b, a):
    if a < 40: return False
    hh, s, v = hsv(r, g, b); return 16 <= hh <= 52 and s > 0.22 and v > 0.28
def is_kit(r, g, b, a):
    if a < 40: return False
    hh, s, v = hsv(r, g, b); return (hh >= 338 or hh <= 15) and s > 0.33 and v > 0.20

# 各素材の輝度33/66パーセンタイル
def thresholds(pred):
    ls = []
    for y in range(H):
        for x in range(W):
            r, g, b, a = base[x, y]
            if pred(r, g, b, a): ls.append(lum(r, g, b))
    ls.sort(); n = len(ls)
    return (ls[int(n*0.34)], ls[int(n*0.67)]) if n else (100, 170)

sk_t = thresholds(is_skin)
kt_t = thresholds(is_kit)

def ramp(basecol):
    return (shade(basecol, 0.60), basecol, light(basecol, 0.32))  # sh, mid, hi

def recolor(skin_hex, kit_hex):
    out = im.copy(); op = out.load()
    sk = ramp(hx(skin_hex)); kt = ramp(hx(kit_hex))
    for y in range(H):
        for x in range(W):
            r, g, b, a = base[x, y]
            if is_skin(r, g, b, a):
                L = lum(r, g, b); c = sk[0] if L < sk_t[0] else (sk[1] if L < sk_t[1] else sk[2])
                op[x, y] = (c[0], c[1], c[2], a)
            elif is_kit(r, g, b, a):
                L = lum(r, g, b); c = kt[0] if L < kt_t[0] else (kt[1] if L < kt_t[1] else kt[2])
                op[x, y] = (c[0], c[1], c[2], a)
    return out

SKIN = ['#ffdcbb', '#f4c79b', '#e6ad7f', '#cf8f5d', '#a06a3f', '#6f492c']
KIT = [('red', '#c0392b'), ('blue', '#2c5fd0'), ('green', '#2f8f3a'), ('white', '#e6e6ee'), ('yellow', '#e0bd34')]

# 段組み: 上段=肌6段(キット赤固定) / 下段=キット5色(肌は中間)
cell_w, cell_h, pad, lab = W, H, 12, 18
cols = max(len(SKIN), len(KIT))
CW, CH = cell_w+pad, cell_h+pad+lab
sheet = Image.new('RGBA', (CW*cols+pad, CH*2+pad), (20, 26, 40, 255))
d = ImageDraw.Draw(sheet)
for i, s in enumerate(SKIN):
    img = recolor(s, '#c0392b')
    x = pad+i*CW; y = pad
    sheet.alpha_composite(img, (x, y)); d.text((x, y+cell_h+3), 'skin '+str(i), fill=(255, 226, 122, 255))
for i, (nm, k) in enumerate(KIT):
    img = recolor('#e6ad7f', k)
    x = pad+i*CW; y = pad+CH
    sheet.alpha_composite(img, (x, y)); d.text((x, y+cell_h+3), 'kit '+nm, fill=(122, 220, 255, 255))
sheet.convert('RGB').save('/Users/iwasakimitsuru/Desktop/pt06_recolor_demo.png')
print('skin thresholds', tuple(round(v) for v in sk_t), 'kit thresholds', tuple(round(v) for v in kt_t))
print('saved ~/Desktop/pt06_recolor_demo.png', sheet.size)
