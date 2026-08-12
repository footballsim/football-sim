#!/usr/bin/env python3
"""シュート12体スプライトの納品仕上げ（2026-07-10）
slice_shot_grid.py で切り出した tools/proto/manga_shot_sprites/<hstyle>.png に対し:
  1. purge_hair_tint : 髪の青灰ツヤ/刈り上げをリカラー窓から外す（脱彩度・チーム色誤着色の予防）
  2. defringe        : 白マットの半透明ハローを輪郭色へ（暗背景コマでのハロー露見防止）
  3. 体格正規化       : 12体のシャツ青面積の中央値へ平方根比でスケール（1回リサイズ・LANCZOS）
出力: tools/proto/manga_shot_final/<hstyle>.png ＋ contact sheet(白/黒) ＋ 赤キットリカラーシム
"""
import os, statistics
import numpy as np
from PIL import Image
import process_header_rise2 as P

SRC = 'tools/proto/manga_shot_sprites'
OUT = 'tools/proto/manga_shot_final'
HSTYLES = ['short', 'fade', 'skin', 'spike', 'curly', 'part',
           'bangs', 'afro', 'slick', 'wavy', 'mohawk', 'bowl']


def redkit_sim(a):
    """manga_recolor.js 実閾値で全窓分類→鮮烈赤キットでリカラー。髪帯(上位15%)の着色画素数を返す。"""
    HUE = {'skin': (14, 50), 'shorts': (120, 168), 'accent': (170, 202), 'shirt': (203, 245), 'socks': (300, 350)}
    KIT = {'shirt': (220, 30, 40), 'shorts': (245, 245, 245), 'socks': (220, 30, 40), 'accent': (255, 210, 0), 'skin': None}
    h, s, v = P.rgb2hsv_arr(a)
    op = a[..., 3] >= 40
    live = op & (v >= 0.22) & (s >= 0.16)
    out = a.copy()
    ys, xs = np.where(op); top, bot = ys.min(), ys.max()
    hairband = top + int((bot - top) * 0.15)
    contam = 0
    lum = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]) / 255.0
    for part, (h0, h1) in HUE.items():
        m = live & (h >= h0) & (h <= h1)
        kit = KIT[part]
        if kit:
            for c in range(3):
                out[..., c] = np.where(m, np.clip(kit[c] * np.clip(lum * 1.4, 0.35, 1.3), 0, 255).astype(np.uint8), out[..., c])
        if part in ('shirt', 'accent'):
            hm = m.copy(); hm[hairband + 1:, :] = False
            contam += int(hm.sum())
    return out, contam


def main():
    os.makedirs(OUT, exist_ok=True)
    # 1st pass: purge + defringe, and measure shirt area
    stage = {}
    areas = {}
    for hs in HSTYLES:
        a = np.array(Image.open(f'{SRC}/{hs}.png').convert('RGBA'))
        a, npurge = P.purge_hair_tint(a)
        a, nfr = P.defringe(a)
        stage[hs] = a
        areas[hs] = int(P.shirt_mask(a).sum())
        print(f'{hs:8s} purge={npurge}px defringe={nfr}px shirt={areas[hs]}px')
    med = statistics.median(areas.values())
    print(f'\nシャツ面積 中央値={med:.0f}px（同一グリッド由来で±1.7%＝体格は揃っている）')
    # 2nd pass: リサイズせず保存（体格正規化は省く＝元スライスの2値アルファを全12体で統一。
    #   微小リサイズ(±5%)は LANCZOS で縁にAAを生み、scale=1.0のskin/bangsだけ2値のまま残って
    #   12体内でアルファ経路が不整合になる＝asset-qa FAIL の原因だった。2026-07-10）
    sprites = {}
    report = []
    for hs in HSTYLES:
        a2 = stage[hs].copy()
        op = a2[..., 3] > 8; ys, xs = np.where(op)
        a2 = a2[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        Image.fromarray(a2).save(f'{OUT}/{hs}.png')
        sprites[hs] = a2
        sim, contam = redkit_sim(a2)
        Image.fromarray(sim).save(f'{OUT}/_redkit_{hs}.png')
        semi = int(((a2[..., 3] > 0) & (a2[..., 3] < 255)).sum())
        report.append((hs, a2.shape[1], a2.shape[0], semi, contam))
    print('\n== 納品スプライト（半透明px＝全0で2値統一 / 赤キット髪帯着色px）==')
    for hs, w, hgt, semi, contam in report:
        flag = '  <-- 半透明混入' if semi > 0 else ''
        print(f'{hs:8s} {w}x{hgt} semi={semi}px haircontam={contam}px{flag}')
    # contact sheets
    cw = max(s.shape[1] for s in sprites.values()) + 8
    ch = max(s.shape[0] for s in sprites.values()) + 8
    for bgname, bgcol in [('dark', (30, 34, 48, 255)), ('white', (255, 255, 255, 255))]:
        sheet = Image.new('RGBA', (cw * 6 + 8, ch * 2 + 8), bgcol)
        for hi, hs in enumerate(HSTYLES):
            r, c = divmod(hi, 6)
            sp = Image.fromarray(sprites[hs])
            sheet.alpha_composite(sp, (8 + c * cw, 8 + r * ch))
        sheet.convert('RGB').save(f'{OUT}/_contact_sheet_{bgname}.png')
    print(f'\ncontact: {OUT}/_contact_sheet_dark.png / _white.png')


if __name__ == '__main__':
    main()
