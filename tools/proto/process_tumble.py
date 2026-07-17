#!/usr/bin/env python3
"""転倒(foul_atk)スプライトの納品仕上げ（2026-07-17）
納品原画（開いた口＝白い歯/赤ベロ/黒い口奥）を MangaRecolor 入力形式へ。
処理は process_freekick.py と同一パイプライン＋「ベロの色相ガード」を追加:
  ベロの実測色相 330-345°はソックス窓(300-350)に入り、実行時にチームソックス色へ
  誤変換される（白ソックスチームで白ベロ化）。→ 口領域限定で hue を純赤5°へ回転し
  partOf='fixed'（不変）にする。ソックスは領域外なので影響なし。
出力: img/cutscenes/manga_foul_atk/wavy.png（現行と同スケール・置換）
検証: 白ソックスキットでの着色シム＝ベロが白化しないことを証拠画像で確認
"""
import os
import numpy as np
from PIL import Image
import colorsys
import process_header_rise2 as P

SRC = os.path.expanduser('~/Downloads/ChatGPT Image 2026年7月16日 18_23_01.png')
OUT = 'img/cutscenes/manga_foul_atk/wavy.png'
SP = '/private/tmp/claude-501/-Users-iwasakimitsuru/dedf9791-510a-4d65-b825-eee2aae84067/scratchpad'
TARGET_H = 380   # 現行 wavy.png (737x380) と同スケール

# 口領域（原画1254px座標・実測ベロ x959-978 y419-435 に余白）
MOUTH_BOX = (935, 395, 1005, 460)   # l, t, r, b


def fill_enclosed_bg(a, min_px=4000):
    """flood_bgが通過できない「閉じた穴」（腕胴間などから覗く背景）を透過する。
    背景様(低彩度・明)の不透明連結成分のうち min_px 以上を除去。
    歯・靴の白マーク(数百px規模)は閾値未満で保護される（asset-qa 2026-07-17 欠陥1対応）。"""
    from collections import deque
    h, s, v = P.rgb2hsv_arr(a)
    bgish = (s < 0.14) & (v > 0.78) & (a[..., 3] > 0)
    H, W = bgish.shape
    lab = np.zeros((H, W), bool)
    a = a.copy()
    removed = []
    for y0 in range(H):
        for x0 in range(W):
            if bgish[y0, x0] and not lab[y0, x0]:
                comp = []
                dq = deque([(y0, x0)]); lab[y0, x0] = True
                while dq:
                    cy, cx = dq.popleft(); comp.append((cy, cx))
                    for ny, nx in ((cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)):
                        if 0 <= ny < H and 0 <= nx < W and bgish[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = True; dq.append((ny, nx))
                if len(comp) >= min_px:
                    for cy, cx in comp:
                        a[cy, cx, 3] = 0
                    removed.append(len(comp))
    return a, removed


def tongue_guard(a, box, s_min=0.15):
    """口領域内のソックス窓色相(300-355)を純赤5°へ回転（S/V保持＝陰影維持）。
    s_min=0.15: partOfのlive閾値(s>=0.16)より低く取り、ベロ縁のAA画素も漏らさず退避
    （asset-qa 2026-07-17 欠陥2対応。旧s>0.3では縁5pxがsocks窓に残った）。"""
    l, t, r, b = box
    n = 0
    for y in range(max(0, t), min(a.shape[0], b)):
        for x in range(max(0, l), min(a.shape[1], r)):
            if a[y, x, 3] < 40:
                continue
            R, G, B = int(a[y, x, 0]), int(a[y, x, 1]), int(a[y, x, 2])
            hh, ss, vv = colorsys.rgb_to_hsv(R / 255, G / 255, B / 255)
            H = hh * 360
            if 300 <= H <= 355 and ss > s_min:
                r2, g2, b2 = colorsys.hsv_to_rgb(5 / 360, ss, vv)
                a[y, x, 0] = int(r2 * 255); a[y, x, 1] = int(g2 * 255); a[y, x, 2] = int(b2 * 255)
                n += 1
    return a, n


def find_tongue_box(a, pad=8):
    """ガード済みベロ(純赤hue<14・s>0.35)のbboxをpad拡張して返す（ダウンスケール後の再ガード用）。"""
    pts = []
    for y in range(a.shape[0]):
        for x in range(a.shape[1]):
            if a[y, x, 3] < 40:
                continue
            hh, ss, vv = colorsys.rgb_to_hsv(a[y, x, 0] / 255, a[y, x, 1] / 255, a[y, x, 2] / 255)
            if hh * 360 < 14 and ss > 0.35 and vv > 0.3 and a[y, x, 2] < 160:
                pts.append((x, y))
    if not pts:
        return None
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)


def kit_sim(a, kit):
    """manga_recolor 実閾値で分類→kit色着色（白ソックスでベロ白化しないかの検証用）。"""
    HUE = {'skin': (14, 50), 'shorts': (120, 168), 'accent': (170, 202), 'shirt': (203, 245), 'socks': (300, 350)}
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


def on_bg(arr, bg):
    rgb = arr[..., :3].astype(float)
    al = (arr[..., 3:4].astype(float)) / 255.0
    return Image.fromarray((rgb * al + np.array(bg, float) * (1 - al)).astype(np.uint8))


def main():
    a = np.array(Image.open(SRC).convert('RGBA'))
    a = P.flood_bg(a)
    a, holes = fill_enclosed_bg(a)    # ★閉じた穴（腕胴間の背景）を透過
    a = P.despeckle(a, min_px=200)
    a, npurge = P.purge_hair_tint(a)
    a, ngd = tongue_guard(a, MOUTH_BOX)   # ★口領域のベロをソックス窓から退避
    a, nfr = P.defringe(a)
    op = a[..., 3] > 8
    ys, xs = np.where(op)
    a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    clean = Image.fromarray(a)
    w, hh = clean.size
    tw = max(8, round(w * TARGET_H / hh))
    small = clean.resize((tw, TARGET_H), Image.LANCZOS)
    sa = np.array(small)
    sa, nfr2 = P.defringe(sa)
    # ★ダウンスケール再サンプリングで生じるベロ縁の中間色相を再ガード（縮小後座標で自己特定）
    tb = find_tongue_box(sa)
    ngd2 = 0
    if tb:
        sa, ngd2 = tongue_guard(sa, tb)
    Image.fromarray(sa).save(OUT)
    print(f'out={tw}x{TARGET_H} holes_removed={holes} purge={npurge}px tongue_guard={ngd}+{ngd2}px defringe={nfr}+{nfr2}px')

    # 証拠: 白ソックスキット（ブラジル風=黄シャツ/青短パン/白ソックス）でベロが白化しないか
    KIT = {'shirt': (242, 197, 0), 'shorts': (27, 58, 138), 'socks': (242, 244, 247), 'accent': (30, 140, 58)}
    sim = kit_sim(sa, KIT)
    on_bg(sim, (28, 32, 46)).save(f'{SP}/tumble_sim_whitesocks_dark.png')
    on_bg(sa, (28, 32, 46)).save(f'{SP}/tumble_native_dark.png')
    print('evidence: tumble_sim_whitesocks_dark.png / tumble_native_dark.png')


if __name__ == '__main__':
    main()
