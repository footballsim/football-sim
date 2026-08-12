#!/usr/bin/env python3
"""縦2体ペア画像→個別スプライト抽出（2026-07-09・スライディング守備12髪型v2用）。

extract_2x2_batch.py のwatershed機構を流用し、n=2・スロットt/bで割当てる。
使い方: python3 tools/proto/extract_1x2_pair.py <pair.png> <top,bottom> <outdir>
"""
import os, sys
from PIL import Image
from extract_2x2_batch import strip_grid_lines, key_background, extract_figures


def main():
    pair_path, names_csv, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
    names = names_csv.split(',')
    assert len(names) == 2, '髪型名はtop,bottomの2つ'
    os.makedirs(outdir, exist_ok=True)
    im = Image.open(os.path.expanduser(pair_path)).convert('RGBA')
    im = strip_grid_lines(im)
    im = key_background(im)
    figs = extract_figures(im, 2)
    figs.sort(key=lambda f: f[2][1])  # 重心yで上下割当
    spx = im.load()
    for name, f in zip(names, figs):
        npx, (minx, miny, maxx, maxy), cent, pix = f
        fig = Image.new('RGBA', (maxx - minx + 1, maxy - miny + 1), (0, 0, 0, 0))
        fpx = fig.load()
        for x, y in pix:
            fpx[x - minx, y - miny] = spx[x, y]
        fig.save(f'{outdir}/{name}.png')
        print(f'{name}: {fig.size[0]}x{fig.size[1]} ({npx}px)')
    print('done:', outdir)


if __name__ == '__main__':
    main()
