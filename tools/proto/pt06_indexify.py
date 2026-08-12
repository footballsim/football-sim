#!/usr/bin/env python3
# PT-06 色替え対応マスター化: 各素材を平坦インデックス化し、パレットスワップで色替え。
# numpy/scipy無し・純Python+PIL。共通ボディ1体に対して素材分類→領域分離→平坦ランプ量子化。
import colorsys, sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else 'img/cutscenes/shot_pt06feet_01.png'

im = Image.open(SRC).convert('RGBA')
W, H = im.size
px = im.load()

def hsv(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r/255.0, g/255.0, b/255.0)
    return h*360, s, v

# ---- 1. 一次分類（色＋領域） ----
# label: 0 transp / 1 skin / 2 redkit / 3 hair / 4 dark(outline+boots) / 5 other
lab = [[0]*W for _ in range(H)]
for y in range(H):
    for x in range(W):
        r, g, b, a = px[x, y]
        if a < 40:
            continue
        hh, s, v = hsv(r, g, b)
        if 16 <= hh <= 52 and s > 0.22 and v > 0.28:
            lab[y][x] = 1  # skin
        elif (hh >= 338 or hh <= 15) and s > 0.33 and v > 0.20:
            lab[y][x] = 2  # red kit
        elif v < 0.24:
            # 暗色: 頭部領域(上24%)なら髪・それ以外はoutline/boots
            lab[y][x] = 3 if y < H*0.24 else 4
        else:
            lab[y][x] = 5  # other(中間・AA境界など)

# ---- 2. 赤キットを連結成分に分割 → shirt/shorts/socks 判定 ----
comp = [[0]*W for _ in range(H)]
cid = 0
comps = {}
for y in range(H):
    for x in range(W):
        if lab[y][x] == 2 and comp[y][x] == 0:
            cid += 1
            stack = [(x, y)]
            comp[y][x] = cid
            pts = []
            while stack:
                cx, cy = stack.pop()
                pts.append((cx, cy))
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
                    nx, ny = cx+dx, cy+dy
                    if 0 <= nx < W and 0 <= ny < H and lab[ny][nx] == 2 and comp[ny][nx] == 0:
                        comp[ny][nx] = cid
                        stack.append((nx, ny))
            ys = [p[1] for p in pts]; xs = [p[0] for p in pts]
            comps[cid] = {'n': len(pts), 'cy': sum(ys)/len(pts), 'cx': sum(xs)/len(pts),
                          'ymin': min(ys), 'ymax': max(ys)}

# 大きい成分のみ採用（ノイズ除去）
big = {c: v for c, v in comps.items() if v['n'] > 150}
# shirt = 最上部の大成分 / shorts = その下の大成分 / socks = 残り（脚）
order = sorted(big.items(), key=lambda kv: kv[1]['cy'])
part_of = {}  # cid -> 'shirt'/'shorts'/'socks'
if order:
    # シャツ=最大かつ上、パンツ=胴直下、ソックス=下部
    # ヒューリスティック: cy でソート、上から shirt, shorts, socks...（socksは複数可）
    # 面積最大をshirt、次にy重心でshorts(中間)、下部をsocks
    by_size = sorted(big.items(), key=lambda kv: -kv[1]['n'])
    shirt_id = by_size[0][0]
    part_of[shirt_id] = 'shirt'
    rest = [c for c in big if c != shirt_id]
    # 残りを cy で: shirtのymaxより上寄りで最大 = shorts、下=socks
    shirt_ymax = big[shirt_id]['ymax']
    rest_sorted = sorted(rest, key=lambda c: big[c]['cy'])
    for c in rest_sorted:
        # パンツはシャツに近い(重なる)・ソックスは下方
        if big[c]['cy'] < shirt_ymax + (H*0.10):
            part_of[c] = 'shorts'
        else:
            part_of[c] = 'socks'
    # shorts が無ければ最上位restをshorts化
    if 'shorts' not in part_of.values() and rest_sorted:
        part_of[rest_sorted[0]] = 'shorts'

# ---- 3. 偽色マップ出力（検証用） ----
COL = {'skin':(255,0,255),'shirt':(0,190,255),'shorts':(255,225,0),'socks':(0,220,0),
       'hair':(255,140,0),'dark':(70,70,90),'other':(255,255,255),'redother':(200,0,0)}
vis = Image.new('RGB', (W, H), (18, 22, 34))
vp = vis.load()
for y in range(H):
    for x in range(W):
        l = lab[y][x]
        if l == 0: continue
        if l == 1: c = COL['skin']
        elif l == 2:
            p = part_of.get(comp[y][x])
            c = COL[p] if p else COL['redother']
        elif l == 3: c = COL['hair']
        elif l == 4: c = COL['dark']
        else: c = COL['other']
        vp[x, y] = c
vis.save('tools/proto/pt06_material_map.png')

# 統計
from collections import Counter
cnt = Counter()
for y in range(H):
    for x in range(W):
        l = lab[y][x]
        if l == 2:
            cnt[part_of.get(comp[y][x], 'redother')] += 1
        elif l == 1: cnt['skin'] += 1
        elif l == 3: cnt['hair'] += 1
        elif l == 4: cnt['dark'] += 1
        elif l == 5: cnt['other'] += 1
print('components(big):', {c: (int(big[c]['n']), part_of.get(c), round(big[c]['cy'])) for c in big})
print('pixel counts:', dict(cnt))
print('saved tools/proto/pt06_material_map.png')
