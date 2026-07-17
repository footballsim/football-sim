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


def rebuild_mouth(a, tongue_box, pad=6):
    """口を「輪郭・赤いベロ・黒い口の中」の3要素へ再構成する（2026-07-17 ユーザー方針）。

    ゲーム描画は native380→130px＝34%縮小で口全体が約9.6×8.9px・歯は約4×2pxしか残らない。
    この解像度で歯を描き分けるのは不可能なので、歯（白）は捨てて「口が開いている」ことの提示に振る。
    → 口の中の「赤でも肌でもない」画素（＝歯とその中間調・分割線）をインク黒(0,0,0)で潰す。
    塗る色が黒なので、フラッドが口の輪郭線を巻き込んでも黒のまま＝輪郭は保たれる
    （白で塗った前版は輪郭を消して口が「白い塊」化し asset-qa FAIL。同じフラッドでも色で結果が反転する）。
    赤いベロと肌には侵入しないため、3要素はそのまま残る。"""
    from collections import deque
    l, t, r, b = tongue_box
    l -= pad; t -= pad; r += pad; b += pad
    l = max(0, l); t = max(0, t); r = min(a.shape[1], r); b = min(a.shape[0], b)

    def lum(p):
        return 0.299 * int(p[0]) + 0.587 * int(p[1]) + 0.114 * int(p[2])

    # ★分類は色相ベース（MangaRecolorのHUE窓と同一定義）。RGB差分ベースの旧判定は
    #   明るいオレンジ肌 rgb(255,197,116)（実測hue35°）を「赤＝ベロ」と誤分類し、
    #   is_skin=False にしてフラッドを素肌へ通してしまった（2026-07-17 asset-qa指摘）。
    def hsv(p):
        return colorsys.rgb_to_hsv(int(p[0]) / 255, int(p[1]) / 255, int(p[2]) / 255)

    def is_red(p):
        if p[3] < 40:
            return False
        hh, ss, vv = hsv(p)
        return hh * 360 < 14 and ss > 0.35 and vv > 0.3

    def is_skin(p):
        if p[3] < 40:
            return False
        hh, ss, vv = hsv(p)
        return 14 <= hh * 360 <= 50 and ss >= 0.16 and vv >= 0.22

    # ★seedにもガードを適用。旧実装は alpha と輝度だけで seed を決めており、肌ハイライト
    #   （lum>200）が片っ端から seed 化していた。塗り条件を lum>30 にした版でその seed 自身が
    #   黒塗り対象になり、素肌に黒点が出た。二重の防壁として box 限定＋seedガードを入れる。
    seed = [(x, y) for y in range(t, b) for x in range(l, r)
            if a[y, x, 3] > 40 and lum(a[y, x]) > 200
            and not is_skin(a[y, x]) and not is_red(a[y, x])]
    if not seed:
        return 0
    seen = set(seed); dq = deque(seed)
    while dq:
        x, y = dq.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not (l <= nx < r and t <= ny < b) or (nx, ny) in seen:
                continue
            p = a[ny, nx]
            if p[3] < 40 or is_red(p) or is_skin(p):
                continue
            seen.add((nx, ny)); dq.append((nx, ny))
    n = 0
    for x, y in seen:
        if lum(a[y, x]) > 30:          # 既に黒い画素はそのまま（＝輪郭を再塗装しない）
            a[y, x, 0] = a[y, x, 1] = a[y, x, 2] = 0   # 原画のインク色＝純黒
            n += 1
    return n


def find_tongue_box(a, pad=8):
    """ベロ(純赤hue<14・s>0.35)の **最大連結成分** のbboxをpad拡張して返す。

    ★全赤画素の min/max を取ってはいけない。スパイク/腿にも暗赤が15pxあり、box が
      387×158＝キャンバス22% に肥大して胴・腕・腿を巻き込む（2026-07-17 asset-qa指摘の
      素肌への黒点10pxの主因）。最大成分に限れば口周辺の約30×30に収まり、遠方への
      副作用が構造的に発生し得なくなる。"""
    from collections import deque
    pts = set()
    for y in range(a.shape[0]):
        for x in range(a.shape[1]):
            if a[y, x, 3] < 40:
                continue
            hh, ss, vv = colorsys.rgb_to_hsv(a[y, x, 0] / 255, a[y, x, 1] / 255, a[y, x, 2] / 255)
            if hh * 360 < 14 and ss > 0.35 and vv > 0.3 and a[y, x, 2] < 160:
                pts.add((x, y))
    if not pts:
        return None
    seen = set(); best = []
    for p0 in pts:
        if p0 in seen:
            continue
        comp = []; dq = deque([p0]); seen.add(p0)
        while dq:
            x, y = dq.popleft(); comp.append((x, y))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    q = (x + dx, y + dy)
                    if q in pts and q not in seen:
                        seen.add(q); dq.append(q)
        if len(comp) > len(best):
            best = comp
    xs = [p[0] for p in best]; ys = [p[1] for p in best]
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
    ngd2 = 0; nteeth = 0
    before = sa.copy()
    if tb:
        sa, ngd2 = tongue_guard(sa, tb)
        nteeth = rebuild_mouth(sa, tb)   # ★口を「輪郭・赤ベロ・黒い口の中」の3要素へ再構成
        # ★ゲート: 口の加工が口box外へ漏れていないか。v1は素肌に黒点10pxを落として
        #   asset-qa FAIL になった。diffのbboxを機械で見れば納品前に検出できたので必須化する。
        diff = np.argwhere(np.any(before[..., :3] != sa[..., :3], axis=-1))
        if len(diff):
            dy0, dx0 = diff.min(0); dy1, dx1 = diff.max(0)
            pad = 4
            ok = (dx0 >= tb[0] - pad and dy0 >= tb[1] - pad and dx1 <= tb[2] + pad and dy1 <= tb[3] + pad)
            print(f'  gate: tongue_box={tb} diff_bbox=(x{dx0}-{dx1}, y{dy0}-{dy1}) {len(diff)}px -> {"OK" if ok else "NG(口box外へ漏れ)"}')
            if not ok:
                raise SystemExit('GATE FAIL: 口の加工が口box外へ漏れています。中止しました。')
    Image.fromarray(sa).save(OUT)
    print(f'out={tw}x{TARGET_H} holes_removed={holes} purge={npurge}px tongue_guard={ngd}+{ngd2}px mouth_rebuilt={nteeth}px defringe={nfr}+{nfr2}px')

    # 証拠: 白ソックスキット（ブラジル風=黄シャツ/青短パン/白ソックス）でベロが白化しないか
    KIT = {'shirt': (242, 197, 0), 'shorts': (27, 58, 138), 'socks': (242, 244, 247), 'accent': (30, 140, 58)}
    sim = kit_sim(sa, KIT)
    on_bg(sim, (28, 32, 46)).save(f'{SP}/tumble_sim_whitesocks_dark.png')
    on_bg(sa, (28, 32, 46)).save(f'{SP}/tumble_native_dark.png')
    print('evidence: tumble_sim_whitesocks_dark.png / tumble_native_dark.png')


if __name__ == '__main__':
    main()
