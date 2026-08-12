#!/usr/bin/env python3
"""GKダイビング単体の納品処理（2026-07-10）
素材: 2026-07-10納品「ChatGPT Image ...19_28_50」＝横っ飛びダイビング(青緑マゼンタ＋白グローブ・分離色)。
既存 gk_blue_01.png(220×127・右向きダイブ)と同じ座標系・bbox枠に載せ替え、レンダラ無改変で差し替え可能にする。
process_header_rise2 のコア(透過・髪パージ・de-fringe)を流用。白グローブは分離色でない白→MangaRecolorで'fixed'保持。
出力: tools/proto/manga_gk_dive.png ＋ 赤(GK色)リカラーシム
"""
import numpy as np
from PIL import Image
import process_header_rise2 as P

SRC = 'tools/proto/gk_dive_src.png'
REF = 'img/cutscenes/gk_blue_01.png'
OUT = 'tools/proto/manga_gk_dive.png'


def redkit_sim(a):
    HUE = {'skin': (14, 50), 'shorts': (120, 168), 'accent': (170, 202), 'shirt': (203, 245), 'socks': (300, 350)}
    KIT = {'shirt': (220, 30, 40), 'shorts': (120, 10, 15), 'socks': (220, 30, 40), 'accent': (245, 245, 245), 'skin': None}
    h, s, v = P.rgb2hsv_arr(a)
    op = a[..., 3] >= 40
    live = op & (v >= 0.22) & (s >= 0.16)
    out = a.copy()
    lum = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]) / 255.0
    for part, (h0, h1) in HUE.items():
        m = live & (h >= h0) & (h <= h1)
        kit = KIT[part]
        if kit:
            for c in range(3):
                out[..., c] = np.where(m, np.clip(kit[c] * np.clip(lum * 1.4, 0.35, 1.3), 0, 255).astype(np.uint8), out[..., c])
    return out


def main():
    ref = np.array(Image.open(REF).convert('RGBA'))
    RH, RW = ref.shape[0], ref.shape[1]
    rop = ref[..., 3] > 16
    rys, rxs = np.where(rop)
    rbx = (int(rxs.min()), int(rys.min()), int(rxs.max()), int(rys.max()))
    bw, bh = rbx[2] - rbx[0] + 1, rbx[3] - rbx[1] + 1
    print(f'既存gk枠: canvas {RW}x{RH} bbox {rbx} = {bw}x{bh}')

    a = np.array(Image.open(SRC).convert('RGBA'))
    a = P.flood_bg(a)
    a = P.despeckle(a)
    a, npurge = P.purge_hair_tint(a)
    op = a[..., 3] > 8
    ys, xs = np.where(op)
    a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    print(f'透過後bbox {a.shape[1]}x{a.shape[0]} purge={npurge}px')
    # 既存bbox枠にアスペクト維持フィット
    k = min(bw / a.shape[1], bh / a.shape[0])
    im = Image.fromarray(a).resize((max(1, round(a.shape[1] * k)), max(1, round(a.shape[0] * k))), Image.LANCZOS)
    a = np.array(im)
    a, nfr = P.defringe(a)
    print(f'fit scale={k:.3f} → {a.shape[1]}x{a.shape[0]} defringe={nfr}px')
    # 既存gk枠の中央へ配置
    canvas = np.zeros((RH, RW, 4), np.uint8)
    ox = rbx[0] + (bw - a.shape[1]) // 2
    oy = rbx[1] + (bh - a.shape[0]) // 2
    canvas[oy:oy + a.shape[0], ox:ox + a.shape[1]] = a
    Image.fromarray(canvas).save(OUT)
    # bbox確認
    cop = canvas[..., 3] > 8
    cys, cxs = np.where(cop)
    print(f'出力 {OUT}: bbox ({cxs.min()},{cys.min()})-({cxs.max()},{cys.max()}) / semi={int(((canvas[...,3]>0)&(canvas[...,3]<255)).sum())}px')
    # 赤(GK色)リカラーシム
    Image.fromarray(redkit_sim(canvas)).save(OUT.replace('.png', '_redkit.png'))
    # 白グローブ保持確認: 高明度低彩度(グローブ)の画素数
    h, s, vv = P.rgb2hsv_arr(canvas)
    glove = cop & (vv > 0.80) & (s < 0.18)
    print(f'白グローブ様画素(v>0.8,s<0.18)={int(glove.sum())}px（リカラーで不変=fixed保持されるべき）')


if __name__ == '__main__':
    main()
