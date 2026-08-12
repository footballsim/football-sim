#!/usr/bin/env python3
"""単体2×2バッチ(4髪型グリッド)→個別スプライト抽出（2026-07-08・カット！シーン量産用）。

背景: 「12髪型グリッド」は顔崩壊するため放棄→「承認済み単体を2×2×3バッチで12髪型展開」が確定レシピ
      (メモリ football-sim-pt06-ct-pixel-head 参照)。

分離方式=watershed(2026-07-08確定):
  スライディング等の横長ポーズは隣の体と接触する(指⇔ソックス等)。縦カットは
  「右の体のブーツが左の体のx域に食い込む」ため誤割当した。正解=
  ①不透明マスクを浸食(接触ネックは細いので先に切れる) ②浸食後のCC上位4=コア
  ③元マスク全画素を多源BFSで最寄りコアに割当(watershed)。

使い方:
  python3 tools/proto/extract_2x2_batch.py <grid.png> <tl,tr,bl,br> <outdir>
出力: <outdir>/<style>.png (キーイング+タイトクロップ済・未正規化)
受入: 基準単体の靴とのピクセル並置比較が必須(「靴が有るか」だけでは別物を見逃す・2026-07-08教訓)。
"""
import os, sys
from collections import deque
from PIL import Image, ImageFilter


def bg_like(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    return mx - mn < 40 and mx >= 200


def key_background(im):
    """境界フラッドフィルで連結背景のみ透過(slice_manga_grids.py v2と同方式)"""
    W, H = im.size
    px = im.load()
    seen = bytearray(W * H)
    q = deque()
    for x in range(W):
        for y in (0, H - 1):
            if bg_like(*px[x, y][:3]) and not seen[y * W + x]:
                q.append((x, y)); seen[y * W + x] = 1
    for y in range(H):
        for x in (0, W - 1):
            if bg_like(*px[x, y][:3]) and not seen[y * W + x]:
                q.append((x, y)); seen[y * W + x] = 1
    while q:
        x, y = q.popleft()
        px[x, y] = (255, 255, 255, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and not seen[ny * W + nx]:
                if bg_like(*px[nx, ny][:3]):
                    seen[ny * W + nx] = 1
                    q.append((nx, ny))
    return im


def strip_grid_lines(im):
    """描かれた仕切り線/枠線(全幅・全高スパンの暗色直線)を白に塗る。
    2026-07-08 batch2で発生: セル境界に黒枠が描かれ、フラッドフィルがセル内に入れず全融合した"""
    W, H = im.size
    px = im.load()
    def dark(p):
        return max(p[0], p[1], p[2]) < 130 and p[3] > 0
    line_cols = [x for x in range(W) if sum(1 for y in range(0, H, 2) if dark(px[x, y])) * 2 > H * 0.7]
    line_rows = [y for y in range(H) if sum(1 for x in range(0, W, 2) if dark(px[x, y])) * 2 > W * 0.7]
    n = 0
    for x in line_cols:
        for y in range(H):
            if dark(px[x, y]):
                px[x, y] = (255, 255, 255, 255); n += 1
    for y in line_rows:
        for x in range(W):
            if dark(px[x, y]):
                px[x, y] = (255, 255, 255, 255); n += 1
    if line_cols or line_rows:
        print(f'  仕切り線除去: 列{len(line_cols)}本 行{len(line_rows)}本 ({n}px)')
    return im


def _erode(mask, W, H):
    out = bytearray(W * H)
    for y in range(H):
        base = y * W
        for x in range(W):
            i = base + x
            if not mask[i]:
                continue
            if x == 0 or y == 0 or x == W - 1 or y == H - 1:
                continue
            if mask[i - 1] and mask[i + 1] and mask[i - W] and mask[i + W]:
                out[i] = 1
    return out


def _cc(mask, W, H, min_px):
    """バイトマスクの4近傍CC。大きい順に画素リスト"""
    seen = bytearray(W * H)
    comps = []
    for i0 in range(W * H):
        if not mask[i0] or seen[i0]:
            continue
        q = deque([i0])
        seen[i0] = 1
        cur = []
        while q:
            i = q.popleft()
            cur.append(i)
            x, y = i % W, i // W
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H:
                    j = ny * W + nx
                    if mask[j] and not seen[j]:
                        seen[j] = 1
                        q.append(j)
        if len(cur) >= min_px:
            comps.append(cur)
    comps.sort(key=len, reverse=True)
    return comps


def extract_figures(im, n=4, min_px=15000):
    """浸食でコアを分離→watershed割当で n 体を抽出"""
    W, H = im.size
    px = im.load()
    mask = bytearray(W * H)
    for y in range(H):
        for x in range(W):
            if px[x, y][3] > 0:
                mask[y * W + x] = 1
    a = im.split()[3].point(lambda v: 255 if v > 0 else 0).convert('L')
    cur = a
    cores = []
    for r in range(1, 41):
        cur = cur.filter(ImageFilter.MinFilter(3))
        if r % 2:
            continue
        er = bytearray(1 if v else 0 for v in cur.getdata())
        cores = _cc(er, W, H, min_px)
        if len(cores) >= n:
            print(f'  浸食r={r}で{len(cores)}コア分離 (サイズ={[len(c) for c in cores[:n]]})')
            break
    else:
        raise SystemExit(f'浸食40回でも{n}コアに分離できず(コア={len(cores)})')
    cores = cores[:n]
    # watershed: 多源BFSで全不透明画素を最寄りコアへ
    label = bytearray(W * H)  # 0=未割当, 1..n=コア
    q = deque()
    for ci, comp in enumerate(cores, start=1):
        for i in comp:
            label[i] = ci
            q.append(i)
    while q:
        i = q.popleft()
        x, y = i % W, i // W
        li = label[i]
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H:
                j = ny * W + nx
                if mask[j] and not label[j]:
                    label[j] = li
                    q.append(j)
    figs = []
    for ci in range(1, n + 1):
        pts = [(i % W, i // W) for i in range(W * H) if label[i] == ci]
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        cx = sum(xs) / len(pts); cy = sum(ys) / len(pts)
        figs.append((len(pts), (min(xs), min(ys), max(xs), max(ys)), (cx, cy), pts))
    return figs


def main():
    grid_path, names_csv, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
    names = names_csv.split(',')
    assert len(names) == 4, '髪型名はtl,tr,bl,brの4つ'
    os.makedirs(outdir, exist_ok=True)
    im = Image.open(os.path.expanduser(grid_path)).convert('RGBA')
    im = strip_grid_lines(im)
    im = key_background(im)
    figs = extract_figures(im, 4)
    # 重心の象限で tl/tr/bl/br を割当
    cx_mid = sum(f[2][0] for f in figs) / 4
    cy_mid = sum(f[2][1] for f in figs) / 4
    slots = {}
    for f in figs:
        cx, cy = f[2]
        key = ('t' if cy < cy_mid else 'b') + ('l' if cx < cx_mid else 'r')
        assert key not in slots, f'象限{key}が重複(斜め配置?)'
        slots[key] = f
    spx = im.load()
    for slot, name in zip(['tl', 'tr', 'bl', 'br'], names):
        npx, (minx, miny, maxx, maxy), cent, pix = slots[slot]
        fig = Image.new('RGBA', (maxx - minx + 1, maxy - miny + 1), (0, 0, 0, 0))
        fpx = fig.load()
        for x, y in pix:
            fpx[x - minx, y - miny] = spx[x, y]
        fig.save(f'{outdir}/{name}.png')
        print(f'{slot} -> {name}: {fig.size[0]}x{fig.size[1]} ({npx}px)')
    print('done:', outdir)


if __name__ == '__main__':
    main()
