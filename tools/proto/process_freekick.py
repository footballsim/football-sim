#!/usr/bin/env python3
"""フリーキック2枚の納品仕上げ（2026-07-17）
新FKアート（分離配色: 青シャツ/緑短パン/マゼンタ靴下/シアン襟）を MangaRecolor 入力形式へ。
  1. flood_bg   : 境界連結のオフホワイト背景 → 透過（閉鎖ポケットは残す）
  2. despeckle  : 本体外の小さな不透明ゴミ除去
  3. purge_hair_tint : 髪の青灰ツヤを脱彩度（リカラー窓落ち→誤着色の予防）
  4. defringe   : 白マットの半透明ハロー → 輪郭色
  5. trim + downscale(LANCZOS) : ~360px 高へ（既存 manga 系スプライトに整合）
  6. 再 defringe : ダウンスケールで生じた明ハローを再除去
出力: img/cutscenes/freekick{1,2}_01.png（RGBA・分離配色のまま＝実行時 MangaRecolor で着色）
     tools/art/cutscenes/freekick{1,2}_clean.png（大きめキーアウト版・原本保管）
検証: manga_recolor.js 実閾値で各パーツ分類→サンプルキット着色シム（白/暗背景）を _fk_sim_*.png へ
"""
import os
import numpy as np
from PIL import Image
import process_header_rise2 as P

DL = os.path.expanduser('~/Downloads')
JOBS = [
    ('freekick1', f'{DL}/ChatGPT Image 2026年7月16日 20_59_00.png'),
    ('freekick2', f'{DL}/soccer_pixel_head_nearest_b4.png'),
]
TARGET_H = 360   # 納品高（shot最終 ~370 に整合）

# MangaRecolor 実閾値（manga_recolor.js と一致）
HUE = {'skin': (14, 50), 'shorts': (120, 168), 'accent': (170, 202), 'shirt': (203, 245), 'socks': (300, 350)}
# サンプルキット（日本風: 青シャツ/紺短パン/青靴下/白襟）で着色シム
SAMPLE = {'shirt': (30, 64, 200), 'shorts': (20, 28, 70), 'socks': (30, 64, 200), 'accent': (235, 235, 240)}


def kit_sim(a, kit):
    """manga_recolor 窓で分類→kit色で輝度連続着色。合成確認用（透過は保持）。"""
    h, s, v = P.rgb2hsv_arr(a)
    op = a[..., 3] >= 40
    live = op & (v >= 0.22) & (s >= 0.16)
    out = a.copy()
    lum = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]) / 255.0
    for part, (h0, h1) in HUE.items():
        if part == 'skin':
            continue
        m = live & (h >= h0) & (h <= h1)
        c = kit[part]
        for ch in range(3):
            out[..., ch] = np.where(m, np.clip(c[ch] * np.clip(lum * 1.4, 0.35, 1.3), 0, 255).astype(np.uint8), out[..., ch])
    return out


def on_bg(a, bg):
    rgb = a[..., :3].astype(float)
    al = (a[..., 3:4].astype(float)) / 255.0
    comp = rgb * al + np.array(bg, float) * (1 - al)
    return Image.fromarray(comp.astype(np.uint8))


def process(name, src):
    a = np.array(Image.open(src).convert('RGBA'))
    a = P.flood_bg(a)
    a = P.despeckle(a, min_px=200)
    a, npurge = P.purge_hair_tint(a)
    a, nfr = P.defringe(a)
    # trim
    op = a[..., 3] > 8
    ys, xs = np.where(op)
    a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    clean = Image.fromarray(a)
    clean.save(f'tools/art/cutscenes/{name}_clean.png')
    # downscale to TARGET_H
    w, hh = clean.size
    tw = max(8, round(w * TARGET_H / hh))
    small = clean.resize((tw, TARGET_H), Image.LANCZOS)
    sa = np.array(small)
    sa, nfr2 = P.defringe(sa)
    out = Image.fromarray(sa)
    out.save(f'img/cutscenes/{name}_01.png')
    semi = int(((sa[..., 3] > 0) & (sa[..., 3] < 255)).sum())
    # evidence sims
    sim = kit_sim(sa, SAMPLE)
    on_bg(sim, (255, 255, 255)).save(f'tools/proto/_fk_sim_{name}_white.png')
    on_bg(sim, (28, 32, 46)).save(f'tools/proto/_fk_sim_{name}_dark.png')
    on_bg(sa, (28, 32, 46)).save(f'tools/proto/_fk_native_{name}_dark.png')
    print(f'{name}: clean={clean.size} out={out.size} purge={npurge}px defringe={nfr}+{nfr2}px semi={semi}px')


def main():
    os.makedirs('tools/art/cutscenes', exist_ok=True)
    for name, src in JOBS:
        process(name, src)
    print('done. evidence: tools/proto/_fk_sim_*_white.png / _fk_sim_*_dark.png / _fk_native_*_dark.png')


if __name__ == '__main__':
    main()
