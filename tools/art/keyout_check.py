#!/usr/bin/env python3
"""keyout_check.py — keyout.js 出力の自動回帰ゲート（asset-qa 2026-07-16 推奨）。

受入検査(asset-qa)に出す前に必ず通す。検査観点は asset-qa の3回のFAILから抽出:
  [A] 元絵黒コアの透過喪失（図近傍）: 輪郭/トリム/バンドの欠け・破線化の検出
  [B] 閉鎖穴の正当性: 空/芝が透ける正当な窓(空色率>=0.4 or >400px)以外の穴は欠陥
  [C] 暖色クリームの透過喪失（図近傍）: 襟/袖口の生地欠けの検出
  [D] 背景色(空/芝)の不透明残留: フリンジ/ゴミの検出
  [E] 基準版との黒回帰: 前回合格版で不透明だった黒が新版で透過になっていないか

使い方:
  python3 tools/art/keyout_check.py <out_full.png> <src.png> <crop_x> <crop_y> [baseline_full.png]
  例: python3 tools/art/keyout_check.py /tmp/out_full.png tools/art/cutscenes/foul_ref_src.png 417 115 /tmp/prev_full.png
出力: 各観点の計測値とクラスタ位置。しきい値超過は "NG" を付けて exit 1。
"""
import sys
import numpy as np
from PIL import Image
from collections import deque

def clusters_of(mask, min_size=1, link=2):
    oh, ow = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    ys, xs = np.where(mask)
    pts = set(zip(ys.tolist(), xs.tolist()))
    out = []
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if seen[y0, x0]:
            continue
        q = deque([(y0, x0)]); seen[y0, x0] = True; c = []
        while q:
            y, x = q.popleft(); c.append((y, x))
            for dy in range(-link, link + 1):
                for dx in range(-link, link + 1):
                    ny, nx = y + dy, x + dx
                    if (ny, nx) in pts and 0 <= ny < oh and 0 <= nx < ow and not seen[ny, nx]:
                        seen[ny, nx] = True; q.append((ny, nx))
        if len(c) >= min_size:
            out.append(c)
    out.sort(key=len, reverse=True)
    return out

def main():
    out_path, src_path, cx, cy = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    base_path = sys.argv[5] if len(sys.argv) > 5 else None
    src = np.asarray(Image.open(src_path).convert('RGB'), dtype=np.int16)
    out = np.asarray(Image.open(out_path).convert('RGBA'))
    oh, ow = out.shape[:2]
    crop = src[cy:cy + oh, cx:cx + ow]
    alpha = out[:, :, 3] > 128
    R, G, B = crop[:, :, 0], crop[:, :, 1], crop[:, :, 2]
    ng = False

    near = alpha.copy()
    for _ in range(5):
        n = near.copy()
        n[1:, :] |= near[:-1, :]; n[:-1, :] |= near[1:, :]
        n[:, 1:] |= near[:, :-1]; n[:, :-1] |= near[:, 1:]
        near = n

    # [A] 元絵黒コアの透過喪失（図近傍）
    lum = crop.max(axis=2)
    black = lum < 80
    core = black.copy()
    core[1:, :] &= black[:-1, :]; core[:-1, :] &= black[1:, :]
    core[:, 1:] &= black[:, :-1]; core[:, :-1] &= black[:, 1:]
    lostA = core & ~alpha & near
    cl = clusters_of(lostA)
    big = [c for c in cl if len(c) >= 60]
    print(f"[A] black-core loss near figure: {int(lostA.sum())}px, clusters>=60px: {len(big)}")
    for c in big[:8]:
        xs = [p[1] for p in c]; ys = [p[0] for p in c]
        print(f"    cluster {len(c)}px bbox=({min(xs)},{min(ys)})-({max(xs)},{max(ys)})  ※図側かスタンド側かは目視確認")

    # [B] 閉鎖穴の正当性
    lbl = np.zeros((oh, ow), dtype=bool)
    holes_bad = 0
    print("[B] enclosed holes:")
    for y0 in range(oh):
        for x0 in range(ow):
            if alpha[y0, x0] or lbl[y0, x0]:
                continue
            q = deque([(y0, x0)]); lbl[y0, x0] = True; pts = []; border = False
            while q:
                y, x = q.popleft(); pts.append((y, x))
                if y == 0 or x == 0 or y == oh - 1 or x == ow - 1:
                    border = True
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < oh and 0 <= nx < ow and not alpha[ny, nx] and not lbl[ny, nx]:
                        lbl[ny, nx] = True; q.append((ny, nx))
            if border or len(pts) < 4:
                continue
            sky = sum(1 for y, x in pts if crop[y, x][2] > 60 and crop[y, x][2] >= crop[y, x][0] + 12)
            rate = sky / len(pts)
            legit = rate >= 0.4 or len(pts) > 400
            mark = 'ok(window)' if legit else 'NG(figure hole)'
            if not legit:
                holes_bad += 1; ng = True
            print(f"    {len(pts)}px at({pts[0][1]},{pts[0][0]}) sky={rate:.2f} {mark}")

    # [C] 暖色クリーム喪失（図近傍）
    cream = (R > 200) & (G > 185) & (B > 140) & (R >= B + 20)
    lostC = cream & ~alpha & near
    clc = [c for c in clusters_of(lostC) if len(c) >= 15]
    print(f"[C] cream loss near figure: {int(lostC.sum())}px, clusters>=15px: {len(clc)}")
    for c in clc[:6]:
        xs = [p[1] for p in c]; ys = [p[0] for p in c]
        print(f"    cluster {len(c)}px bbox=({min(xs)},{min(ys)})-({max(xs)},{max(ys)})")

    # [D] 背景色の不透明残留
    edge = ~alpha
    for _ in range(3):
        e2 = edge.copy()
        e2[1:, :] |= edge[:-1, :]; e2[:-1, :] |= edge[1:, :]
        e2[:, 1:] |= edge[:, :-1]; e2[:, :-1] |= edge[:, 1:]
        edge = e2
    fringe = alpha & edge   # 輪郭3px以内の不透明画素のみ対象(シャツ内部のオリーブ影を誤検知しない)
    skyop = fringe & (B > 100) & (B >= R + 30) & (B >= G + 10)
    grnop = fringe & (G > R + 20) & (G > B + 30) & (R < 150)
    print(f"[D] opaque residue: sky={int(skyop.sum())}px grass={int(grnop.sum())}px", "NG" if skyop.sum() > 40 or grnop.sum() > 40 else "ok")
    if skyop.sum() > 40 or grnop.sum() > 40:
        ng = True

    # [E] 基準版との黒回帰
    if base_path:
        bx = int(sys.argv[6]) if len(sys.argv) > 6 else cx
        by = int(sys.argv[7]) if len(sys.argv) > 7 else cy
        base = np.asarray(Image.open(base_path).convert('RGBA'))
        bh, bw = base.shape[:2]
        # 元画像座標系で共通域に整列して比較
        x0 = max(cx, bx); y0 = max(cy, by)
        x1 = min(cx + ow, bx + bw); y1 = min(cy + oh, by + bh)
        a_now = alpha[y0 - cy:y1 - cy, x0 - cx:x1 - cx]
        a_base = (base[:, :, 3] > 128)[y0 - by:y1 - by, x0 - bx:x1 - bx]
        blk_c = black[y0 - cy:y1 - cy, x0 - cx:x1 - cx]
        reg = blk_c & a_base & ~a_now
        clr = [c for c in clusters_of(reg) if len(c) >= 40]
        print(f"[E] black regression vs baseline: {int(reg.sum())}px, clusters>=40px: {len(clr)}")
        for c in clr[:8]:
            xs = [p[1] + (x0 - cx) for p in c]; ys = [p[0] + (y0 - cy) for p in c]
            print(f"    cluster {len(c)}px bbox=({min(xs)},{min(ys)})-({max(xs)},{max(ys)})")

    # [F] 浮遊成分: 本体から分離した小さな不透明成分(救済破線の浮き等)の検出（asset-qa 2026-07-16 肩トリム浮き指摘）
    comp_lbl = np.zeros((oh, ow), dtype=bool)
    comps = []
    for y0 in range(oh):
        for x0 in range(ow):
            if not alpha[y0, x0] or comp_lbl[y0, x0]:
                continue
            q = deque([(y0, x0)]); comp_lbl[y0, x0] = True; n = 0; fx, fy = x0, y0
            while q:
                y, x = q.popleft(); n += 1
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < oh and 0 <= nx < ow and alpha[ny, nx] and not comp_lbl[ny, nx]:
                            comp_lbl[ny, nx] = True; q.append((ny, nx))
            comps.append((n, fx, fy))
    comps.sort(reverse=True)
    floaters = [c for c in comps if c[0] < 3000]
    print(f"[F] opaque components: {len(comps)} (floaters<3000px: {len(floaters)})", "NG" if floaters else "ok")
    for n, fx, fy in floaters[:6]:
        print(f"    floater {n}px at({fx},{fy})")
    if floaters:
        ng = True

    print("GATE:", "FAIL" if ng else "PASS(機械観点のみ・等倍目視とasset-qaは別途)")
    sys.exit(1 if ng else 0)

main()
