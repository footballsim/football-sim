#!/usr/bin/env python3
"""シュート2コマを「表示実寸」アセット化＋鼻の黒凝縮だけ決定論修正。

背景: 顔は画面上24pxしかなく、1159px原画の鼻の黒線が縮小で凝縮して黒い塊になる。
生成やり直しは部分編集が効かず顔ごと変わる(実証済み)ので、
①表示実寸(ph=148)へ先に高品質縮小 → ②その解像度で鼻の近黒ピクセルだけ濃肌色へ置換。
実行時は等倍描画=ここで確認した絵がそのまま出る。

  使い方: python3 tools/proto/shot_anim_displayres.py
  出力  : img/cutscenes/manga_shot_anim/{windup,strike}.png（表示実寸）
          tools/proto/_qa_shot_nose_fix.png（before/after 8x 証拠）
"""
import os, sys, importlib.util
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.expanduser('~/football-sim')
OUT = os.path.join(ROOT, 'img/cutscenes/manga_shot_anim')
PH = 148   # 表示の人物高 = round(178 * CS_FIGURE_SCALE=0.83)。スケール変更時はここを追従して再実行

# 源泉: 処理済み420px版(キーアウト・デフリンジ・反転済み)。DL原画は削除済みのため。
#   初回実行時に *_420.png としてバックアップし、以後はバックアップを源泉にする(再実行安全)。
def to_display(name):
    src420 = os.path.join(OUT, name + '_420.png')
    cur = os.path.join(OUT, name + '.png')
    if not os.path.exists(src420):
        im = Image.open(cur)
        if im.height < 300:
            sys.exit(f'{name}: 420px源泉が無く現行も表示実寸済み。sourceを用意して')
        im.save(src420)
    keyed = Image.open(src420).convert('RGBA')
    w = round(keyed.width * PH / keyed.height)
    return keyed.resize((w, PH), Image.LANCZOS)


def face_box(im):
    """顔領域=不透明bbox上部の肌色帯を含む矩形（ざっくり上部26%・左右は肌画素で絞る）"""
    a = np.asarray(im)
    al = a[:, :, 3] > 128
    ys, xs = np.nonzero(al)
    top, H = ys.min(), ys.max() - ys.min()
    y1 = int(top + H * 0.26)
    r, g, b = a[:, :, 0].astype(int), a[:, :, 1].astype(int), a[:, :, 2].astype(int)
    skin = al & (r > 150) & (g > 80) & (g < 190) & (b < 140) & (r > g) & (g > b)
    band = skin[top:y1]
    if not band.any():
        return None
    bys, bxs = np.nonzero(band)
    return (bxs.min(), top, bxs.max() + 1, y1)


def fix_nose(im, label):
    """顔box下半分の近黒クラスタ(鼻/口の凝縮)を、周囲の肌から作った濃肌色へ置換。
    目は上半分なので触れない。髪は顔boxの左右外＝対象外。"""
    a = np.asarray(im).copy()
    box = face_box(im)
    if not box:
        print(f'{label}: 顔領域が見つからない'); return im, []
    x0, y0, x1, y1 = box
    ymid = (y0 + y1) // 2
    r, g, b, al = a[:, :, 0].astype(int), a[:, :, 1].astype(int), a[:, :, 2].astype(int), a[:, :, 3] > 128
    mx = np.maximum(np.maximum(r, g), b)
    # 顔box内の肌平均→濃肌(鼻の陰の色)を作る
    skin = al & (r > 150) & (g > 80) & (g < 190) & (b < 140) & (r > g) & (g > b)
    sm = np.zeros_like(skin); sm[y0:y1, x0:x1] = True
    sp = skin & sm
    mr, mg, mb = r[sp].mean(), g[sp].mean(), b[sp].mean()
    dark_skin = (int(mr * 0.62), int(mg * 0.55), int(mb * 0.5))
    # 下半分の近黒＝鼻/口の凝縮
    tgt = np.zeros_like(skin)
    tgt[ymid:y1, x0:x1] = True
    hit = tgt & al & (mx < 85)
    n = int(hit.sum())
    a[:, :, 0][hit], a[:, :, 1][hit], a[:, :, 2][hit] = dark_skin
    print(f'{label}: 顔box{box} 置換{n}px → 濃肌{dark_skin}')
    return Image.fromarray(a), [box, n]


def zoom_face(im, box, k=8):
    x0, y0, x1, y1 = box
    pad = 3
    crop = im.crop((x0 - pad, y0 - pad, x1 + pad, y1 + pad + 4))
    bg = Image.new('RGBA', crop.size, (232, 232, 232, 255))
    bg.alpha_composite(crop)
    return bg.resize((crop.width * k, crop.height * k), Image.NEAREST).convert('RGB')


def main():
    panels = []
    for name in ['windup', 'strike']:
        disp = to_display(name)
        before_box = face_box(disp)
        before = zoom_face(disp, before_box) if before_box else None
        fixed, info = fix_nose(disp, name)
        after = zoom_face(fixed, info[0]) if info else None
        fixed.save(os.path.join(OUT, name + '.png'))
        print(f'saved {name}.png {fixed.size}')
        if before and after:
            panels.append((name, before, after))
    if panels:
        W = max(p[1].width + p[2].width + 60 for p in panels)
        H = sum(max(p[1].height, p[2].height) + 40 for p in panels)
        sheet = Image.new('RGB', (W + 20, H + 10), (245, 245, 245))
        d = ImageDraw.Draw(sheet)
        y = 10
        for name, bef, aft in panels:
            d.text((14, y), f'{name}  before(左) / after(右)  8x', fill=(0, 0, 0))
            sheet.paste(bef, (14, y + 16))
            sheet.paste(aft, (bef.width + 44, y + 16))
            y += max(bef.height, aft.height) + 40
        sheet.save(os.path.join(ROOT, 'tools/proto/_qa_shot_nose_fix.png'))
        print('saved _qa_shot_nose_fix.png')


if __name__ == '__main__':
    main()
