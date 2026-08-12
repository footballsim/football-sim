#!/usr/bin/env python3
# 生成グリッド(3列×N行スプライトシート)の機械受入検査 + 目視用証拠モンタージュ生成
#
# 使い方:
#   python3 tools/proto/asset_accept.py <検査対象.png> [--ref <合格基準.png>] [--out <出力dir>]
#
# 検査項目:
#   [A] 行帯の高さ均一性（最下段圧縮の検出・±5%）
#   [B] 画像下端の白余白（>=20px）
#   [C] ★軸足の靴の高さ: ソックス下端→靴底の距離を身長比%で測り、基準アセットと比較
#       （2026-07-06の教訓: 全行が均一に切れていると行間比較では見えない。絶対基準が必須）
#   [D] キット分離色の色相クラスタ確認（skin/shorts/accent/shirt/socks）
#   証拠: 全セルの軸足ズーム(3x)モンタージュ + 基準アセットの軸足を並置 → 必ず目視すること
#
# 判定はヒント。最終合否は証拠モンタージュの等倍目視で行う（機械判定PASSでも信用しない）。
import sys, os, colorsys
from PIL import Image, ImageDraw

WHITE = 235
DARK = 80

def load(path):
    im = Image.open(path).convert('RGB')
    return im, im.load()

def detect_bands(im, px):
    W, H = im.size
    bands, inb, s = [], False, 0
    for y in range(H):
        allw = all(px[x, y][0] > WHITE and px[x, y][1] > WHITE and px[x, y][2] > WHITE
                   for x in range(0, W, 3))
        if not allw and not inb:
            s = y; inb = True
        elif allw and inb:
            bands.append((s, y - 1)); inb = False
    if inb:
        bands.append((s, H - 1))
    # 数px幅のノイズ帯（JPEG縁ノイズ等）は行として扱わない
    return [b for b in bands if b[1] - b[0] + 1 >= 30]

def sock_pixels(px, x0, x1, y0, y1):
    out = []
    for y in range(y0, y1 + 1):
        for x in range(x0, x1):
            r, g, b = px[x, y]
            mx, mn = max(r, g, b), min(r, g, b)
            if mx < 60 or mx - mn < 30:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if 285 <= h * 360 <= 355 and s > 0.3:
                out.append((x, y))
    return out

def standing_foot(px, W, x0, x1, y0, y1):
    """軸足=最も右のソックス塊。(sockbot, shoebot, sock_x範囲) を返す"""
    sock = sock_pixels(px, x0, x1, y0, y1)
    if not sock:
        return None
    xs = sorted(set(x for x, _ in sock))
    cl = [xs[-1]]
    for x in reversed(xs[:-1]):
        if cl[-1] - x <= 8:
            cl.append(x)
        else:
            break
    cxs = set(cl)
    sockbot = max(y for x, y in sock if x in cxs)
    low = sockbot
    for y in range(sockbot, y1 + 1):
        if any(0 <= x < W and max(px[x, y]) < DARK
               for x in range(min(cxs) - 40, max(cxs) + 40)):
            low = y
    return sockbot, low, (min(cxs), max(cxs))

def foot_ratio(im, px, band, x0, x1):
    y0, y1 = band
    sf = standing_foot(px, im.size[0], x0, x1, y0, y1)
    if sf is None:
        return None
    sockbot, shoebot, _ = sf
    figh = y1 - y0 + 1
    return (shoebot - sockbot), 100.0 * (shoebot - sockbot) / figh

def main():
    argv = sys.argv[1:]
    if not argv:
        print(__doc__ or 'usage: asset_accept.py <grid.png> [--ref <ref.png>] [--out dir]')
        sys.exit(2)
    target = argv[0]
    ref = None
    outdir = os.path.dirname(os.path.abspath(target))
    if '--ref' in argv:
        ref = argv[argv.index('--ref') + 1]
    if '--out' in argv:
        outdir = argv[argv.index('--out') + 1]

    im, px = load(target)
    W, H = im.size
    bands = detect_bands(im, px)
    name = os.path.splitext(os.path.basename(target))[0]
    fails, warns = [], []
    print(f'== asset_accept: {target}  size={W}x{H}  rows={len(bands)}')

    # [A] 行帯均一性
    hs = [b[1] - b[0] + 1 for b in bands]
    print(f'[A] 行高: {hs}')
    if hs and (max(hs) - min(hs)) / max(hs) > 0.05:
        fails.append(f'[A] 行高ばらつき>5%: {hs}（最下段圧縮の疑い）')

    # [B] 下端余白
    margin = H - 1 - bands[-1][1] if bands else 0
    print(f'[B] 下端余白: {margin}px')
    # 閾値8px: 合格基準アセット(pt06_parts_base)自身が12px。実際の下端切れ事例は0px。
    if margin < 8:
        fails.append(f'[B] 下端余白{margin}px<8px（足切れの疑い）')

    # [C] 軸足の靴の高さ（基準比較）
    ref_pct = None
    if ref:
        rim, rpx = load(ref)
        rbands = detect_bands(rim, rpx)
        rr = foot_ratio(rim, rpx, rbands[0], 0, rim.size[0] // 3 if len(rbands) > 1 else rim.size[0])
        if rr:
            ref_pct = rr[1]
            print(f'[C] 基準({os.path.basename(ref)}): 靴高={rr[0]}px ({ref_pct:.1f}%)')
    cells = []
    for ri, band in enumerate(bands):
        for ci in range(3):
            x0, x1 = ci * W // 3, (ci + 1) * W // 3
            r = foot_ratio(im, px, band, x0, x1)
            cells.append((ri, ci, r))
            if r is None:
                fails.append(f'[C] r{ri+1}c{ci+1}: ソックス検出不能')
                continue
            pxh, pct = r
            ok = ''
            if ref_pct is not None and pct < ref_pct * 0.7:
                fails.append(f'[C] r{ri+1}c{ci+1}: 軸足の靴高{pxh}px({pct:.1f}%) < 基準{ref_pct:.1f}%の70%')
                ok = '  <-- FAIL'
            elif pct < 5.5:
                # 基準なしでも: 靴は身長比5.5%以上ないと「足首下の切れ端」
                fails.append(f'[C] r{ri+1}c{ci+1}: 軸足の靴高{pxh}px({pct:.1f}%) < 絶対下限5.5%')
                ok = '  <-- FAIL'
            print(f'[C] r{ri+1}c{ci+1}: 靴高={pxh}px ({pct:.1f}%){ok}')

    # [D] 分離色の色相クラスタ: 分離窓外の有彩色画素が2%超ならFAIL
    WINDOWS = {'skin': (14, 50), 'shorts': (120, 168), 'accent': (170, 202),
               'shirt': (203, 245), 'socks': (300, 350)}
    n_in, n_out = 0, 0
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            r, g, b = px[x, y]
            mx, mn = max(r, g, b), min(r, g, b)
            if mx > 236 and mn > 236:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if v < 0.22 or s < 0.16:
                continue  # 髪/靴/輪郭/髭は固定扱い
            hd = h * 360
            if any(a <= hd <= b2 for a, b2 in WINDOWS.values()):
                n_in += 1
            else:
                n_out += 1
    pct_out = 100.0 * n_out / max(1, n_in + n_out)
    print(f'[D] 分離窓外の有彩色画素: {pct_out:.2f}% (基準アセット実測≒0.65%)')
    if pct_out > 2.0:
        fails.append(f'[D] 分離窓外{pct_out:.2f}%>2%（リカラー分離が崩れている疑い）')

    # [E] 背景清浄度: 背景(低彩度・明部)のうち純白(>=254)でない画素の割合
    #    2026-07-06事故: 基準アセット自体の背景が胡麻塩ノイズ・髭3枚は全面オフホワイト(245-250)で、
    #    「白>236」前提の全検査が素通しした。再エンコードで可視ノイズ化する。
    n_bg = n_dirty = 0
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            r, g, b = px[x, y]
            mx, mn = max(r, g, b), min(r, g, b)
            if mx - mn < 30 and mx >= 225:   # 背景とみなす明部低彩度
                n_bg += 1
                if mn < 254:
                    n_dirty += 1
    pct_dirty = 100.0 * n_dirty / max(1, n_bg)
    print(f'[E] 背景の非純白率: {pct_dirty:.1f}%（背景画素={n_bg}）')
    if pct_dirty > 5.0:
        fails.append(f'[E] 背景の非純白率{pct_dirty:.1f}%>5%（背景ノイズ/オフホワイト。クリーニング必須）')
    # 証拠: 薄ノイズ二値マップ
    bmap = Image.new('L', (W, H), 255)
    bp = bmap.load()
    for y in range(H):
        for x in range(W):
            r, g, b = px[x, y]
            if max(r, g, b) - min(r, g, b) < 30 and 225 <= min(r, g, b) < 254:
                bp[x, y] = 0
    bmap.resize((W // 3, H // 3)).save(os.path.join(outdir, name + '_bgnoise_map.png'))

    # 証拠モンタージュ: 各セルの軸足ズーム3x + 基準
    zoom = 3
    tile_w, tile_h = 130, 110
    cols = len(bands)
    mont = Image.new('RGB', (tile_w * zoom * cols + 20, tile_h * zoom * 3 + 60 + (tile_h * zoom if ref else 0)), (255, 255, 255))
    d = ImageDraw.Draw(mont)
    for ri, band in enumerate(bands):
        y0, y1 = band
        for ci in range(3):
            x0, x1 = ci * W // 3, (ci + 1) * W // 3
            sf = standing_foot(px, W, x0, x1, y0, y1)
            cx = (sf[2][0] + sf[2][1]) // 2 if sf else (x0 + x1) // 2
            crop = im.crop((max(x0, cx - tile_w // 2), y1 - tile_h + 10, max(x0, cx - tile_w // 2) + tile_w, y1 + 10))
            crop = crop.resize((tile_w * zoom, tile_h * zoom), Image.NEAREST)
            mont.paste(crop, (10 + ri * tile_w * zoom, 30 + ci * tile_h * zoom))
            d.text((10 + ri * tile_w * zoom, 10 + ci * tile_h * zoom * 0), f'r{ri+1}', fill=(0, 0, 0))
    if ref:
        rim, rpx = load(ref)
        rbands = detect_bands(rim, rpx)
        y0, y1 = rbands[0]
        rx1 = rim.size[0] // 3 if len(rbands) > 1 else rim.size[0]
        sf = standing_foot(rpx, rim.size[0], 0, rx1, y0, y1)
        cx = (sf[2][0] + sf[2][1]) // 2 if sf else rx1 // 2
        crop = rim.crop((max(0, cx - tile_w // 2), y1 - tile_h + 10, max(0, cx - tile_w // 2) + tile_w, y1 + 10))
        crop = crop.resize((tile_w * zoom, tile_h * zoom), Image.NEAREST)
        ry = 40 + tile_h * zoom * 3
        mont.paste(crop, (10, ry))
        d.text((10 + tile_w * zoom, ry + 20), '<-- REFERENCE standing foot (accepted asset). Every cell above must have an equivalent shoe.', fill=(200, 0, 0))
    ev = os.path.join(outdir, name + '_accept_evidence.png')
    mont.save(ev)

    print('---')
    for f in fails:
        print('FAIL:', f)
    print(f'機械判定: {"FAIL" if fails else "PASS(ヒント)"}  証拠: {ev}')
    print('※機械判定がPASSでも、証拠モンタージュを等倍で目視するまで合格にしないこと')
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
