#!/usr/bin/env python3
"""ヘディングrise 独立2体化（2026-07-10）
ChatGPT生成の単体2枚（atk=接地・跳ぶ直前 / def=宙に浮く）を
既存 header_rise_atk/def.png（395×480共通キャンバス・1枚絵分離版）と
同じ座標系・同じ体格に処理して差し替え候補を作る。

パイプライン（MANGA_SCENE_PROMPTS.md 2026-07-08/09 規約準拠）:
  1. 境界フラッドフィル透過（境界連結の背景様画素のみ→ブーツ白線等の閉鎖ポケットは保持）
  2. デスペックル（本体非連結の小成分除去）
  3. 髪ツヤ/刈り上げパージ: 暗コア(max<95)をMinFilter×2収縮→隣接 hue195-250&s<0.45&v<0.55 を
     シードに上58%限定フラッド→s=0.06へ脱彩度（'fixed'化・manga_recolor.js partOf窓と一致）
  4. シャツ青面積（hue203-245, s>=0.16, v>=0.22）の平方根比で旧対応体へ体格正規化（リサイズ1回・LANCZOS）
  5. de-fringe: 半透明(0<a<255)かつ明色(min>150)の縁画素RGB→(22,22,26)（alpha保持）
  6. 旧対応体の頭アンカー（暗髪画素の上部帯センロイド）へ位置合わせして395×480へ配置
"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
CUT = os.path.join(REPO, 'img', 'cutscenes')

CANVAS = (395, 480)


def rgb2hsv_arr(a):
    rgb = a[..., :3].astype(np.float64) / 255.0
    mx = rgb.max(-1); mn = rgb.min(-1); d = mx - mn
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    dd = np.where(d > 1e-9, d, 1)
    h = np.zeros_like(mx)
    h = np.where((mx == r) & (d > 1e-9), ((g - b) / dd) % 6, h)
    h = np.where((mx == g) & (d > 1e-9), (b - r) / dd + 2, h)
    h = np.where((mx == b) & (d > 1e-9), (r - g) / dd + 4, h)
    h *= 60
    s = np.where(mx > 0, d / np.maximum(mx, 1e-9), 0)
    return h, s, mx


def shirt_mask(a):
    h, s, v = rgb2hsv_arr(a)
    return (a[..., 3] > 40) & (h >= 203) & (h <= 245) & (s >= 0.16) & (v >= 0.22)


def flood_bg(a):
    """境界連結の背景様画素（低彩度・明るい）を透過。閉鎖ポケットは残す。"""
    h, s, v = rgb2hsv_arr(a)
    bgish = (s < 0.14) & (v > 0.78)
    H, W = bgish.shape
    seen = np.zeros((H, W), bool)
    dq = deque()
    for x in range(W):
        for y in (0, H - 1):
            if bgish[y, x] and not seen[y, x]: seen[y, x] = True; dq.append((y, x))
    for y in range(H):
        for x in (0, W - 1):
            if bgish[y, x] and not seen[y, x]: seen[y, x] = True; dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
            if 0 <= ny < H and 0 <= nx < W and bgish[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; dq.append((ny, nx))
    a = a.copy(); a[seen, 3] = 0
    return a


def despeckle(a, min_px=200):
    """本体（最大成分）に属さない小さな不透明成分を除去。"""
    op = a[..., 3] > 8
    H, W = op.shape
    lab = np.zeros((H, W), np.int32); cur = 0; sizes = {}
    for y in range(H):
        for x in range(W):
            if op[y, x] and lab[y, x] == 0:
                cur += 1; dq = deque([(y, x)]); lab[y, x] = cur; n = 0
                while dq:
                    cy, cx = dq.popleft(); n += 1
                    for ny, nx in ((cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1),(cy-1,cx-1),(cy-1,cx+1),(cy+1,cx-1),(cy+1,cx+1)):
                        if 0 <= ny < H and 0 <= nx < W and op[ny, nx] and lab[ny, nx] == 0:
                            lab[ny, nx] = cur; dq.append((ny, nx))
                sizes[cur] = n
    if not sizes: return a
    main = max(sizes, key=sizes.get)
    kill = np.isin(lab, [k for k, v in sizes.items() if k != main and v < min_px])
    a = a.copy(); a[kill, 3] = 0
    return a


def purge_hair_tint(a):
    """刈り上げ/髪ツヤの青灰をs=0.06へ脱彩度（リカラー窓落ち→チーム色誤着色の予防）。"""
    h, s, v = rgb2hsv_arr(a)
    op = a[..., 3] > 40
    rgbmax = a[..., :3].max(-1)
    dark = op & (rgbmax < 95)
    core = np.array(Image.fromarray((dark * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MinFilter(3))) > 0
    ys, xs = np.where(op)
    if len(ys) == 0: return a, 0
    top, bot = ys.min(), ys.max()
    ylim = top + int((bot - top) * 0.58)
    cand = op & (h >= 195) & (h <= 250) & (s < 0.45) & (v < 0.55)
    cand[ylim + 1:, :] = False
    H, W = cand.shape
    # コア隣接candをシードにフラッド
    seed = cand & (np.array(Image.fromarray((core * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 0)
    seen = np.zeros((H, W), bool)
    dq = deque(zip(*np.where(seed)))
    for y, x in dq: seen[y, x] = True
    dq = deque(dq)
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
            if 0 <= ny < H and 0 <= nx < W and cand[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; dq.append((ny, nx))
    n = int(seen.sum())
    if n:
        a = a.copy()
        vv = v[seen] * 255.0
        gray = np.clip(vv, 0, 255)
        # s=0.06: RGB を輝度ベースへほぼ収束（わずかに青みを残さない・partOf='fixed'化）
        a[seen, 0] = (gray * 0.94).astype(np.uint8)
        a[seen, 1] = (gray * 0.94).astype(np.uint8)
        a[seen, 2] = gray.astype(np.uint8)
    return a, n


def defringe(a):
    semi = (a[..., 3] > 0) & (a[..., 3] < 255)
    bright = a[..., :3].min(-1) > 150
    m = semi & bright
    a = a.copy()
    a[m, 0] = 22; a[m, 1] = 22; a[m, 2] = 26
    return a, int(m.sum())


def head_anchor(a):
    """暗髪（上部20%帯の暗画素）センロイド。"""
    op = a[..., 3] > 40
    rgbmax = a[..., :3].max(-1)
    ys, xs = np.where(op)
    top, bot = ys.min(), ys.max()
    band = top + max(1, int((bot - top) * 0.20))
    dark = op & (rgbmax < 95)
    dark[band + 1:, :] = False
    dys, dxs = np.where(dark)
    if len(dys) == 0:
        return (float((xs[ys <= band]).mean()), float(ys[ys <= band].mean()))
    return (float(dxs.mean()), float(dys.mean()))


def process(src_path, ref_path, out_path, evidence_prefix):
    ref = np.array(Image.open(ref_path).convert('RGBA'))
    src = np.array(Image.open(src_path).convert('RGBA'))
    log = {}
    a = flood_bg(src)
    a = despeckle(a)
    a, npurge = purge_hair_tint(a); log['purge_px'] = npurge
    # crop
    op = a[..., 3] > 8
    ys, xs = np.where(op)
    a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    # 体格正規化: シャツ青面積の平方根比
    sa_src = int(shirt_mask(a).sum()); sa_ref = int(shirt_mask(ref).sum())
    k = (sa_ref / sa_src) ** 0.5
    log['shirt_src'] = sa_src; log['shirt_ref'] = sa_ref; log['scale'] = round(k, 4)
    im = Image.fromarray(a)
    nw, nh = max(1, round(im.width * k)), max(1, round(im.height * k))
    im = im.resize((nw, nh), Image.LANCZOS)
    a = np.array(im)
    a, nfr = defringe(a); log['defringe_px'] = nfr
    # アンカー: 旧対応体の頭センロイドに新頭センロイドを合わせて395×480へ配置
    ax_ref, ay_ref = head_anchor(ref)
    ax_new, ay_new = head_anchor(a)
    W, H = CANVAS
    canvas = np.zeros((H, W, 4), np.uint8)
    ox = round(ax_ref - ax_new); oy = round(ay_ref - ay_new)
    log['offset'] = (ox, oy)
    sh, sw = a.shape[:2]
    x0, y0 = max(0, ox), max(0, oy)
    x1, y1 = min(W, ox + sw), min(H, oy + sh)
    clip = (sw * sh) - (x1 - x0) * (y1 - y0)
    log['clipped_px_area'] = clip
    canvas[y0:y1, x0:x1] = a[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
    Image.fromarray(canvas).save(out_path)
    log['out_bbox'] = tuple(int(t) for t in (np.where(canvas[..., 3] > 8)[1].min(), np.where(canvas[..., 3] > 8)[0].min(),
                                             np.where(canvas[..., 3] > 8)[1].max(), np.where(canvas[..., 3] > 8)[0].max()))
    return log


if __name__ == '__main__':
    jobs = [
        (os.path.join(HERE, 'hdr_rise2_atk_src.png'), os.path.join(CUT, 'header_rise_atk.png'),
         os.path.join(HERE, 'hdr_rise2_atk_norm.png'), 'atk'),
        (os.path.join(HERE, 'hdr_rise2_def_src.png'), os.path.join(CUT, 'header_rise_def.png'),
         os.path.join(HERE, 'hdr_rise2_def_norm.png'), 'def'),
    ]
    for src, ref, out, tag in jobs:
        log = process(src, ref, out, tag)
        print(tag, log)
