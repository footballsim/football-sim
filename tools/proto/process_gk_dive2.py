#!/usr/bin/env python3
"""GKダイビング差し替え（2026-07-23・鼻/顔修正版の新納品）。

素材: _incoming の新ダイビング（青緑マゼンタ＋白グローブ・分離色・右上へ横っ飛び）。
既存 manga_gk_dive.png(440×368・図が枠いっぱい) と同じ座標系へ載せ替え、
レンダラ(_GK_DIVE_HW/gkW/glove anchor)を極力無改変で差し替える。
process_header_rise2 のコア(透過・髪パージ・de-fringe)を流用。白グローブは分離色でない白→MangaRecolorで'fixed'保持。

出力: img/cutscenes/manga_gk_dive.png（バックアップ manga_gk_dive_prev.png）
      tools/proto/_qa_gk_dive2_{redkit,glove}.png
"""
import os, shutil
import numpy as np
from PIL import Image
import process_header_rise2 as P

ROOT = os.path.expanduser('~/football-sim')
SRC = os.path.join(ROOT, 'tools/proto/gk_dive_src.png')
OUT = os.path.join(ROOT, 'img/cutscenes/manga_gk_dive.png')
PREV = os.path.join(ROOT, 'img/cutscenes/manga_gk_dive_prev.png')
CANVAS_W, CANVAS_H = 440, 368   # 既存と同じ＝_GK_DIVE_HW=368/440 を保つ


def _clear_paint(a, region):
    """ユーザー手塗りピンク #F01050 を透過にする（隙間マスク）＋ピンクAAフリンジ除去。
    region=(x0,y0,x1,y1) に限定＝靴下マゼンタ(下部)への漏れを防ぐ。"""
    x0, y0, x1, y1 = region
    R = a[..., 0].astype(int); G = a[..., 1].astype(int); B = a[..., 2].astype(int)
    reg = np.zeros(a.shape[:2], bool); reg[y0:y1, x0:x1] = True
    # 芯: ピンク塗り（B/R比で靴下と分離）
    core = reg & (R > 150) & (G < 90) & (B < R * 0.55) & (R - G > 100) & (B > 20)
    a[core, 3] = 0
    n0 = int(core.sum())
    # フリンジ: 透過に隣接する“ピンク寄り”AA（塗りと白/肌の中間色）を数回剥がす
    nf = 0
    for _ in range(4):
        al = a[..., 3] > 128
        R = a[..., 0].astype(int); G = a[..., 1].astype(int); B = a[..., 2].astype(int)
        pinkish = reg & al & (R - G > 45) & (B < R * 0.72) & (R > 120) & (G < 150)
        pad = np.pad(al, 1)
        near_tr = ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
        kill = pinkish & near_tr
        if not kill.any():
            break
        a[kill, 3] = 0; nf += int(kill.sum())
    print(f'  手塗り透過: core {n0}px + fringe {nf}px (region {region})')
    return a


def _clear_pocket(a, seed, thr=232, satmax=999):
    """seed(x,y)を含む「近白/灰かつ不透明」連結成分を透過にする（黒縁で囲まれた閉ポケット除去）。
    satmax=彩度上限（白/灰の背景のみ拾い、色付き図＝青襟/肌/髪を除外）。"""
    from collections import deque
    op = a[..., 3] > 16
    rgb = a[..., :3].astype(int)
    sat = rgb.max(2) - rgb.min(2)
    near = op & (rgb.min(2) > thr) & (sat < satmax)
    sx, sy = seed
    if not near[sy, sx]:
        # seed近傍で near な点を探す
        found = False
        for r in range(1, 8):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    ny, nx = sy + dy, sx + dx
                    if 0 <= ny < near.shape[0] and 0 <= nx < near.shape[1] and near[ny, nx]:
                        sy, sx = ny, nx; found = True; break
                if found: break
            if found: break
        if not found:
            print('  ⚠ pocket seed に near白が無い→スキップ'); return a
    H, W = near.shape
    seen = np.zeros((H, W), bool)
    q = deque([(sy, sx)]); seen[sy, sx] = True; n = 0
    while q:
        y, x = q.popleft(); a[y, x, 3] = 0; n += 1
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx < W and near[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))
    print(f'  pocket 透過: {n}px (seed {seed})')
    return a


def main():
    if os.path.exists(OUT) and not os.path.exists(PREV):
        shutil.copyfile(OUT, PREV)   # 初回のみ旧版バックアップ
    a = np.array(Image.open(SRC).convert('RGBA'))
    # 頭と左手(拳)の間の隙間を、ユーザーが手塗りピンク #F01050(≈240,16,80)で明示（2026-07-23）。
    #   グローブ白と背景白が同色で自動分離不可だったため、ユーザーが隙間だけを塗ってマスク化した。
    #   B/R比で靴下マゼンタ(204,47,154 B/R=.75)と分離（塗りB/R=.33）。塗り域に限定して靴下漏れを防ぐ。
    a = _clear_paint(a, region=(870, 200, 1075, 295))
    a = P.flood_bg(a)
    a, npurge = P.purge_hair_tint(a)
    op = a[..., 3] > 8
    ys, xs = np.where(op)
    a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    fh, fw = a.shape[:2]
    print(f'透過後 figure bbox {fw}x{fh}  aspect(w/h)={fw/fh:.3f}  purge={npurge}px（既存canvas {CANVAS_W/CANVAS_H:.3f}）')

    # アスペクトを保って幅440へ（潰さない）。高さは図の実アスペクトから導出＝_GK_DIVE_HWを追従。
    out_w = CANVAS_W
    out_h = round(out_w * fh / fw)
    im = Image.fromarray(a).resize((out_w, out_h), Image.LANCZOS)
    a = np.array(im)
    globals()['CANVAS_H'] = out_h
    print(f'★_GK_DIVE_HW を {out_h}/{out_w} = {out_h/out_w:.4f} に更新すること（現行 368/440=0.836）')
    a, nfr = P.defringe(a)
    Image.fromarray(a).save(OUT)
    print(f'defringe={nfr}px → 保存 {OUT} ({CANVAS_W}x{CANVAS_H})')

    # 白グローブ重心（ボール受けアンカー確認用）
    rgb = a[..., :3].astype(float) / 255
    mx = rgb.max(2); mn = rgb.min(2)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    cop = a[..., 3] > 8
    glove = cop & (mx > 0.80) & (s < 0.18)
    gy, gx = np.where(glove)
    if len(gx):
        # 最も右上のグローブ塊＝reaching hand
        reach = glove & (np.arange(CANVAS_W)[None, :] > CANVAS_W * 0.6) & (np.arange(CANVAS_H)[:, None] < CANVAS_H * 0.5)
        ry, rx = np.where(reach)
        print(f'白グローブ全体重心 frac({gx.mean()/CANVAS_W:.3f},{gy.mean()/CANVAS_H:.3f})  reaching重心 frac({(rx.mean()/CANVAS_W) if len(rx) else -1:.3f},{(ry.mean()/CANVAS_H) if len(ry) else -1:.3f})')

    # 赤(GK色)リカラーシム＋グローブ保持確認
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
    Image.fromarray(out).save(os.path.join(ROOT, 'tools/proto/_qa_gk_dive2_redkit.png'))
    fixed = cop & (v < 0.22) | (cop & (sv < 0.16))
    print(f'fixed(髪/靴/白グローブ)={int(fixed.sum())}px  白グローブ様={int(glove.sum())}px（リカラーで不変であるべき）')


if __name__ == '__main__':
    main()
