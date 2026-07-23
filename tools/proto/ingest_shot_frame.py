#!/usr/bin/env python3
"""シュート2コマの1枚を取り込む（キーアウト→デフリンジ→トリム→反転→420px）。

  使い方: python3 tools/proto/ingest_shot_frame.py <入力png> <windup|strike>
出力: img/cutscenes/manga_shot_anim/<slot>.png（420px）＋<slot>_420.png バックアップ
      tools/proto/_qa_shot_<slot>_ingest.png（顔8x＋色相窓レポート）
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw
import importlib.util

ROOT = os.path.expanduser('~/football-sim')
OUT = os.path.join(ROOT, 'img/cutscenes/manga_shot_anim')
spec = importlib.util.spec_from_file_location('psa2', os.path.join(ROOT, 'tools/proto/process_shot_anim2.py'))
psa2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(psa2)

TARGET_H = 420


def main():
    src, slot = sys.argv[1], sys.argv[2]
    assert slot in ('windup', 'strike')
    im = Image.open(src).convert('RGBA')
    flat = Image.new('RGBA', im.size, (255, 255, 255, 255)); flat.alpha_composite(im)
    keyed = psa2.trim(psa2.defringe(psa2.flood_keyout(flat)))
    keyed = keyed.transpose(Image.FLIP_LEFT_RIGHT)   # 原画=右向き → シーンのネイティブ左向き
    w = round(keyed.width * TARGET_H / keyed.height)
    asset = keyed.resize((w, TARGET_H), Image.LANCZOS)
    asset.save(os.path.join(OUT, slot + '.png'))
    asset.save(os.path.join(OUT, slot + '_420.png'))
    print(f'{slot}: {src} → {asset.size} 保存')
    psa2.hue_report(asset, slot)

    # 顔8x（表示実寸148px相当へ落として観察）＝鼻の潰れ確認
    disp = asset.resize((round(asset.width * 148 / asset.height), 148), Image.LANCZOS)
    a = np.asarray(disp); al = a[:, :, 3] > 128
    ys, xs = np.nonzero(al); top, H = ys.min(), ys.max() - ys.min()
    y1 = int(top + H * 0.26); band = al[top:y1]; bys, bxs = np.nonzero(band)
    head = disp.crop((bxs.min() - 3, top - 3, bxs.max() + 5, y1 + 5))
    bg = Image.new('RGBA', head.size, (232, 232, 232, 255)); bg.alpha_composite(head)
    big = bg.resize((head.width * 9, head.height * 9), Image.NEAREST).convert('RGB')
    big.save(os.path.join(ROOT, f'tools/proto/_qa_shot_{slot}_ingest.png'))
    print(f'saved _qa_shot_{slot}_ingest.png（表示実寸の顔9x）')


if __name__ == '__main__':
    main()
