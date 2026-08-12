#!/usr/bin/env python3
# 合格グリッド4枚(髭なし/フル/ゴーティー/口髭)を12髪型×4=48スプライトにスライス
# v2 (2026-07-06): 背景ノイズ対策
#   - 生成グリッドの背景は純白でない(胡麻塩ノイズ/オフホワイト245-250)ことが判明。
#   - 旧方式「全ch>236を透過」ではノイズ暗部(200-237)が不透明ゴミとして残った。
#   - 新方式: ①境界からのフラッドフィルで「明部低彩度」の連結背景を透過
#             ②セル毎に不透明成分の最大(=体)以外の微小成分を除去(デスペックル)
# 出力: tools/proto/manga_sprites/<beard>_<hstyle>.png ＋ contact sheet(白/黒 2種)
import os, colorsys
from collections import deque
from PIL import Image

HSTYLES = ['short', 'fade', 'skin', 'spike', 'curly', 'part',
           'bangs', 'afro', 'slick', 'wavy', 'mohawk', 'bowl']  # 行優先(r1c1→r4c3)
GRIDS = {
    'none': 'tools/proto/pt06_parts_base.png',
    'full': 'tools/proto/manga_beard_full_v3.png',
    'goatee': 'tools/proto/manga_beard_goatee_v4.png',
    'mustache': 'tools/proto/manga_beard_mustache_v1.png',
}
OUT = 'tools/proto/manga_sprites'

def bg_like(r, g, b):
    """背景候補: 明部・低彩度（ノイズ振幅200-255をカバー）"""
    mx, mn = max(r, g, b), min(r, g, b)
    return mx - mn < 40 and mx >= 200

def key_background(im):
    """境界からフラッドフィルして連結した背景だけ透過(体内部のハイライトは保護)"""
    W, H = im.size
    px = im.load()
    seen = bytearray(W * H)
    q = deque()
    for x in range(W):
        for y in (0, H - 1):
            if bg_like(*px[x, y][:3]):
                q.append((x, y)); seen[y * W + x] = 1
    for y in range(H):
        for x in (0, W - 1):
            if bg_like(*px[x, y][:3]) and not seen[y * W + x]:
                q.append((x, y)); seen[y * W + x] = 1
    while q:
        x, y = q.popleft()
        r, g, b, a = px[x, y]
        px[x, y] = (255, 255, 255, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and not seen[ny * W + nx]:
                if bg_like(*px[nx, ny][:3]):
                    seen[ny * W + nx] = 1
                    q.append((nx, ny))
    return im

def despeckle(fig):
    """不透明成分の最大(体)以外の微小成分を透過に落とす"""
    W, H = fig.size
    px = fig.load()
    label = [0] * (W * H)
    comps = []  # (size, pixels)
    cur = 0
    for y0 in range(H):
        for x0 in range(W):
            i0 = y0 * W + x0
            if label[i0] or px[x0, y0][3] == 0:
                continue
            cur += 1
            pix = []
            q = deque([(x0, y0)])
            label[i0] = cur
            while q:
                x, y = q.popleft()
                pix.append((x, y))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W and 0 <= ny < H:
                        j = ny * W + nx
                        if not label[j] and px[nx, ny][3] > 0:
                            label[j] = cur
                            q.append((nx, ny))
            comps.append(pix)
    if not comps:
        return fig
    comps.sort(key=len, reverse=True)
    main = len(comps[0])
    removed = 0
    for pix in comps[1:]:
        if len(pix) < max(60, main * 0.005):
            for x, y in pix:
                px[x, y] = (255, 255, 255, 0)
            removed += len(pix)
    return fig, removed

def is_white_rgb(p):
    return p[0] > 236 and p[1] > 236 and p[2] > 236

def bands_of(rgb, rpx, W, H):
    def blank_row(i):
        return all(rpx[x, i][3] == 0 if False else True for x in ())
    # 行帯: 透過画像のアルファで判定
    return None

def alpha_bands(im, axis, x0=0, x1=None, min_h=30):
    W, H = im.size
    px = im.load()
    x1 = x1 if x1 is not None else (W if axis == 0 else H)
    n = H if axis == 0 else W
    def blank(i):
        if axis == 0:
            return all(px[x, i][3] == 0 for x in range(0, W, 2))
        return all(px[i, y][3] == 0 for y in range(x0, x1, 2))
    bands, inb, s = [], False, 0
    for i in range(n):
        if not blank(i) and not inb:
            s = i; inb = True
        elif blank(i) and inb:
            bands.append((s, i - 1)); inb = False
    if inb:
        bands.append((s, n - 1))
    return [b for b in bands if b[1] - b[0] + 1 >= min_h]

def foot_pct(fig):
    W, H = fig.size; px = fig.load()
    sock = []
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a < 40:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            if mx < 60 or mx - mn < 30:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if 285 <= h * 360 <= 355 and s > 0.3:
                sock.append((x, y))
    if not sock:
        return None
    xs = sorted(set(x for x, _ in sock))
    cl = [xs[-1]]
    for x in reversed(xs[:-1]):
        if cl[-1] - x <= 8:
            cl.append(x)
        else:
            break
    cxs = set(cl)
    sockbot = max(y for x, y in sock if x in cxs)
    low = sockbot
    for y in range(sockbot, H):
        if any(0 <= x < W and px[x, y][3] >= 40 and max(px[x, y][:3]) < 80
               for x in range(min(cxs) - 40, max(cxs) + 40)):
            low = y
    return 100.0 * (low - sockbot) / H

def dirty_opaque(fig):
    """スプライト内の不透明・明部低彩度(ゴミ)画素数"""
    W, H = fig.size; px = fig.load()
    n = 0
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a > 0 and max(r, g, b) >= 200 and max(r, g, b) - min(r, g, b) < 40 and min(r, g, b) >= 180:
                n += 1
    return n

def main():
    os.makedirs(OUT, exist_ok=True)
    sprites = {}
    report = []
    for beard, path in GRIDS.items():
        im = Image.open(path).convert('RGBA')
        im = key_background(im)
        rows = alpha_bands(im, 0)
        assert len(rows) == 4, f'{beard}: 行数{len(rows)}!=4'
        idx = 0
        for (y0, y1) in rows:
            # 列帯はこの行の範囲のアルファで判定
            W = im.size[0]
            px = im.load()
            def blank_col(x):
                return all(px[x, y][3] == 0 for y in range(y0, y1 + 1, 2))
            cols, inb, s = [], False, 0
            for x in range(W):
                if not blank_col(x) and not inb:
                    s = x; inb = True
                elif blank_col(x) and inb:
                    cols.append((s, x - 1)); inb = False
            if inb:
                cols.append((s, W - 1))
            cols = [c for c in cols if c[1] - c[0] + 1 >= 60]
            assert len(cols) == 3, f'{beard}: 行({y0},{y1})の列数{len(cols)}!=3'
            for (x0, x1) in cols:
                cell = im.crop((x0, y0, x1 + 1, y1 + 1))
                fig = cell.crop(cell.getbbox())
                fig, removed = despeckle(fig)
                fig = fig.crop(fig.getbbox())
                name = f'{beard}_{HSTYLES[idx]}'
                fig.save(f'{OUT}/{name}.png')
                report.append((name, fig.size, foot_pct(fig), dirty_opaque(fig), removed))
                sprites[name] = fig
                idx += 1
        print(f'{beard}: 12体スライス完了')
    print('\n== 全数検査（軸足靴高%/基準8.6% ・ ゴミ画素 ・ デスペックル除去数）==')
    bad = 0
    for name, size, fp, dirty, removed in report:
        flag = ''
        if fp is None or fp < 6.0 or dirty > 100:
            flag = '  <-- FAIL'; bad += 1
        print(f'{name:20s} {size[0]}x{size[1]}  foot={None if fp is None else round(fp,1)}%  dirt={dirty}px  despeckled={removed}px{flag}')
    print(f'\n合否: {"FAIL " + str(bad) + "体" if bad else "全48体PASS"}')
    cw = max(s.width for s in sprites.values()) + 8
    ch = max(s.height for s in sprites.values()) + 8
    for bgname, bgcol in [('dark', (30, 34, 48, 255)), ('white', (255, 255, 255, 255))]:
        sheet = Image.new('RGBA', (cw * 12 + 8, ch * 4 + 8), bgcol)
        for bi, beard in enumerate(GRIDS):
            for hi, hs in enumerate(HSTYLES):
                sheet.alpha_composite(sprites[f'{beard}_{hs}'], (8 + hi * cw, 8 + bi * ch))
        sheet.convert('RGB').save(f'{OUT}/_contact_sheet_{bgname}.png')
    print(f'contact sheets: {OUT}/_contact_sheet_dark.png / _contact_sheet_white.png')

if __name__ == '__main__':
    main()
