#!/usr/bin/env python3
"""シュート基準グリッド(髭なし・12髪型)を1枚→12スプライトにスライス（2026-07-10）
素材: tools/proto/manga_shot_grid_none.png（= 2026-07-05納品「ChatGPT Image ...17_02_27」＝添付と一致）
slice_manga_grids.py のコア（背景フラッドフィル透過・行/列自動検出・デスペックル・軸足靴/ゴミ検査）を流用。
出力: tools/proto/manga_shot_sprites/<hstyle>.png ＋ contact sheet(白/黒)
髪型並び(行優先)は既存 HSTYLES と同一。
"""
import os
from PIL import Image
import slice_manga_grids as S

GRID = 'tools/proto/manga_shot_grid_none.png'
OUT = 'tools/proto/manga_shot_sprites'


def main():
    os.makedirs(OUT, exist_ok=True)
    im = Image.open(GRID).convert('RGBA')
    im = S.key_background(im)
    rows = S.alpha_bands(im, 0)
    assert len(rows) == 4, f'行数{len(rows)}!=4'
    sprites = {}
    report = []
    idx = 0
    W = im.size[0]
    px = im.load()
    for (y0, y1) in rows:
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
        assert len(cols) == 3, f'行({y0},{y1})の列数{len(cols)}!=3'
        for (x0, x1) in cols:
            cell = im.crop((x0, y0, x1 + 1, y1 + 1))
            fig = cell.crop(cell.getbbox())
            fig, removed = S.despeckle(fig)
            fig = fig.crop(fig.getbbox())
            name = S.HSTYLES[idx]
            fig.save(f'{OUT}/{name}.png')
            report.append((name, fig.size, S.foot_pct(fig), S.dirty_opaque(fig), removed))
            sprites[name] = fig
            idx += 1
    print('12体スライス完了')
    print('\n== 検査（軸足靴高%/基準6.0以上 ・ ゴミ画素<=100 ・ デスペックル除去数）==')
    bad = 0
    for name, size, fp, dirty, removed in report:
        flag = ''
        if fp is None or fp < 6.0 or dirty > 100:
            flag = '  <-- FAIL'; bad += 1
        print(f'{name:8s} {size[0]}x{size[1]}  foot={None if fp is None else round(fp,1)}%  dirt={dirty}px  despeckled={removed}px{flag}')
    print(f'\n合否: {"FAIL " + str(bad) + "体" if bad else "全12体PASS"}')
    cw = max(s.width for s in sprites.values()) + 8
    ch = max(s.height for s in sprites.values()) + 8
    for bgname, bgcol in [('dark', (30, 34, 48, 255)), ('white', (255, 255, 255, 255))]:
        sheet = Image.new('RGBA', (cw * 6 + 8, ch * 2 + 8), bgcol)
        for hi, hs in enumerate(S.HSTYLES):
            r, c = divmod(hi, 6)
            sheet.alpha_composite(sprites[hs], (8 + c * cw, 8 + r * ch))
        sheet.convert('RGB').save(f'{OUT}/_contact_sheet_{bgname}.png')
    print(f'contact sheets: {OUT}/_contact_sheet_dark.png / _white.png')


if __name__ == '__main__':
    main()
