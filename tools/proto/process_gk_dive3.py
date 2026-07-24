#!/usr/bin/env python3
"""GKダイビング 別パターン追加（2026-07-24・横っ飛びダイブ）。

素材: _incoming の新ダイビング（青シャツ・緑ショーツ・マゼンタ靴下・白グローブ、
      頭が右・脚が左の水平ダイブ。伸ばした手（reaching glove）は右下）。
既存 manga_gk_dive.png と同じ色窓（recolor互換）に載せ、幅440へアスペクト保持リサイズ。
process_gk_dive2 のコア（透過・髪パージ・de-fringe）を流用。白グローブは 'fixed' 保持。

出力: img/cutscenes/manga_gk_dive2.png
      tools/proto/_qa_gk_dive3_{redkit,glove}.png（受入検査用）
実測: figure aspect と reaching-glove フラクションを print（レンダラのアンカー設定に使う）。
"""
import os
import numpy as np
from PIL import Image
import process_header_rise2 as P

ROOT = os.path.expanduser('~/football-sim')
SRC = os.path.join(ROOT, 'tools/proto/gk_dive3_src.png')
OUT = os.path.join(ROOT, 'img/cutscenes/manga_gk_dive2.png')
CANVAS_W = 440


def main():
    a = np.array(Image.open(SRC).convert('RGBA'))
    a = P.flood_bg(a)
    a, npurge = P.purge_hair_tint(a)
    op = a[..., 3] > 8
    ys, xs = np.where(op)
    a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    fh, fw = a.shape[:2]
    print(f'透過後 figure bbox {fw}x{fh}  aspect(h/w)={fh/fw:.4f}  purge={npurge}px')

    out_w = CANVAS_W
    out_h = round(out_w * fh / fw)
    im = Image.fromarray(a).resize((out_w, out_h), Image.LANCZOS)
    a = np.array(im)
    a = a[:, ::-1, :]   # 左右反転（2026-07-24 ユーザー指示: 向きを pose0 の規約に合わせる。reaching glove は右下→左下へ）
    a = np.ascontiguousarray(a)
    a, nfr = P.defringe(a)
    Image.fromarray(a).save(OUT)
    print(f'defringe={nfr}px → 保存 {OUT} ({out_w}x{out_h})  ★_GK_DIVE2_HW = {out_h}/{out_w} = {out_h/out_w:.4f}')

    # 白グローブ検出（reaching glove アンカー算出用）
    rgb = a[..., :3].astype(float) / 255
    mx = rgb.max(2); mn = rgb.min(2)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    cop = a[..., 3] > 8
    glove = cop & (mx > 0.80) & (s < 0.18)
    # 連結成分でグローブ塊を分離し、各塊の重心を出す
    from collections import deque
    seen = np.zeros(glove.shape, bool)
    blobs = []
    H, Wd = glove.shape
    for yy in range(H):
        for xx in range(Wd):
            if glove[yy, xx] and not seen[yy, xx]:
                q = deque([(yy, xx)]); seen[yy, xx] = True; pts = []
                while q:
                    y, x = q.popleft(); pts.append((y, x))
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < H and 0 <= nx < Wd and glove[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True; q.append((ny, nx))
                if len(pts) > 60:
                    ys2 = [p[0] for p in pts]; xs2 = [p[1] for p in pts]
                    blobs.append((len(pts), sum(xs2) / len(pts), sum(ys2) / len(pts)))
    blobs.sort(reverse=True)
    print('白グローブ塊（大きい順・frac）:')
    for n, cx, cy in blobs[:4]:
        print(f'  {n:5d}px  frac({cx/out_w:.3f}, {cy/out_h:.3f})')

    # 赤リカラーシム（recolor互換の確認）
    HUE = {'skin': (14, 50), 'shorts': (120, 168), 'accent': (170, 202), 'shirt': (203, 245), 'socks': (300, 350)}
    KIT = {'shirt': (220, 30, 40), 'shorts': (120, 10, 15), 'socks': (220, 30, 40), 'accent': (245, 245, 245), 'skin': None}
    h, sv, v = P.rgb2hsv_arr(a)
    live = cop & (v >= 0.22) & (sv >= 0.16)
    out = a.copy()
    lum = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]) / 255.0
    for part, (h0, h1) in HUE.items():
        m = live & (h >= h0) & (h <= h1); kit = KIT[part]
        if kit:
            for c in range(3):
                out[..., c] = np.where(m, np.clip(kit[c] * np.clip(lum * 1.4, 0.35, 1.3), 0, 255).astype(np.uint8), out[..., c])
    Image.fromarray(out).save(os.path.join(ROOT, 'tools/proto/_qa_gk_dive3_redkit.png'))
    print('リカラーシム保存 → tools/proto/_qa_gk_dive3_redkit.png')


if __name__ == '__main__':
    main()
