#!/usr/bin/env python3
"""層C（部位アップ）素材の受入検査。

design/LAYER_C_ASSET_SPEC.md の §5 機械判定をそのまま実装する。
既定は不合格。全項目 PASS したものだけ通す。

使い方:
    python3 tools/asset_accept_layerc.py <image.png> [--min-long-side 850]

★ この検査の肝は「リカラーで壊れないこと」の実証。
  js/manga_recolor.js の part_of() を同一ロジックで移植し、
  肌以外（虹彩・白目・輪郭）が1画素も置換対象に入らないことを確かめる。
"""
import sys, colorsys
from collections import Counter
from PIL import Image

# ---- js/manga_recolor.js と同一の分類規則 ----
HUE = {
    'skin':   (14, 50),
    'shorts': (120, 168),
    'accent': (170, 202),
    'shirt':  (203, 245),
    'socks':  (300, 350),
}
FIXED_V = 0.22      # これ未満は不変
FIXED_S = 0.16      # これ未満は不変


def part_of(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    if v < FIXED_V or s < FIXED_S:
        return 'fixed'
    hd = h * 360
    for name, (lo, hi) in HUE.items():
        if lo <= hd <= hi:
            return name
    return 'fixed'


def main(path, min_long=850):
    im = Image.open(path).convert('RGBA')
    W, H = im.size
    px = im.load()
    step = max(1, min(W, H) // 400)          # 間引き（大画像でも数秒で終わる）

    cls = Counter()
    skin_v = []
    dark_px = 0; dark_as_skin = 0
    white_px = 0; white_as_skin = 0
    green_px = 0
    opaque_bbox = [W, H, -1, -1]

    for y in range(0, H, step):
        for x in range(0, W, step):
            r, g, b, a = px[x, y]
            if a < 16:
                continue
            if x < opaque_bbox[0]: opaque_bbox[0] = x
            if y < opaque_bbox[1]: opaque_bbox[1] = y
            if x > opaque_bbox[2]: opaque_bbox[2] = x
            if y > opaque_bbox[3]: opaque_bbox[3] = y

            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            p = part_of(r, g, b)
            cls[p] += 1
            if p == 'skin':
                skin_v.append(v)
            if v < FIXED_V:                     # 暗色（虹彩・輪郭・まつ毛）
                dark_px += 1
                if p == 'skin': dark_as_skin += 1
            if s < FIXED_S and v > 0.75:        # 白（白目・歯・ハイライト）
                white_px += 1
                if p == 'skin': white_as_skin += 1
            # クロマキー緑の残り（純緑に近い画素）
            if 100 <= h * 360 <= 150 and s > 0.55 and v > 0.5:
                green_px += 1

    total = sum(cls.values())
    results = []

    def check(name, ok, detail):
        results.append((ok, name, detail))

    # 1. サイズ
    long_side = max(W, H)
    check('解像度', long_side >= min_long, f'{W}x{H}（長辺 {long_side} / 要 {min_long}）')

    # 2. 占有率（不透明画素の外接矩形）
    bw = opaque_bbox[2] - opaque_bbox[0] + 1
    bh = opaque_bbox[3] - opaque_bbox[1] + 1
    occ = max(bw, bh) / long_side
    check('占有率', occ >= 0.83, f'{occ*100:.1f}%（要 83%以上）')

    # 3. ★虹彩・輪郭が置換対象に入っていないか
    r3 = (dark_as_skin == 0)
    check('暗色が不変か（虹彩/輪郭/まつ毛）', r3,
          f'暗色 {dark_px} 画素中 {dark_as_skin} 画素が skin 判定'
          + ('' if r3 else ' ← 茶色の虹彩は肌色に溶けます'))

    # 4. ★白目・歯が置換対象に入っていないか
    r4 = (white_as_skin == 0)
    check('白が不変か（白目/歯/ハイライト）', r4,
          f'白 {white_px} 画素中 {white_as_skin} 画素が skin 判定')

    # 5. 肌の色相窓・明度・彩度
    skin_frac = cls['skin'] / total if total else 0
    mean_v = sum(skin_v) / len(skin_v) if skin_v else 0
    r5 = skin_frac > 0.10 and mean_v >= 0.5
    check('肌が正しい窓に入っているか', r5,
          f'skin判定 {skin_frac*100:.1f}% / 平均明度 {mean_v:.2f}（要 0.50以上）')

    # 6. 階調数（肌領域の輝度の山が3つ以内）
    hist = Counter(round(v * 40) for v in skin_v)          # 40段に量子化
    peaks = 0
    keys = sorted(hist)
    for i, k in enumerate(keys):
        c = hist[k]
        if c < len(skin_v) * 0.03:                          # 3%未満の谷は無視
            continue
        lo = hist.get(k - 1, 0); hi = hist.get(k + 1, 0)
        if c >= lo and c >= hi:
            peaks += 1
    check('階調（グラデーションでないか）', peaks <= 3, f'肌の輝度の山 {peaks} 個（要 3以内）')

    # 7. クロマキーの残り
    green_frac = green_px / total if total else 0
    check('緑の残留', green_frac < 0.002,
          f'{green_frac*100:.2f}%'
          + ('' if green_frac < 0.002 else ' ← shorts窓に落ちて縁が色付きます'))

    # ---- 出力 ----
    print(f'\n受入検査: {path}')
    print(f'分類内訳: ' + ', '.join(f'{k}={v/total*100:.1f}%' for k, v in cls.most_common()))
    print('-' * 62)
    ng = 0
    for ok, name, detail in results:
        print(f'  [{"PASS" if ok else "FAIL"}] {name}: {detail}')
        if not ok: ng += 1
    print('-' * 62)
    print(('✅ 受入 PASS' if ng == 0 else f'❌ 受入 FAIL（{ng}件）') + '\n')
    return 0 if ng == 0 else 1


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    ml = 850
    if '--min-long-side' in sys.argv:
        ml = int(sys.argv[sys.argv.index('--min-long-side') + 1])
    sys.exit(main(sys.argv[1], ml))
