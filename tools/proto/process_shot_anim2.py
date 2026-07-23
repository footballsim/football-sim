#!/usr/bin/env python3
"""シュート2コマアニメ（振りかぶり→蹴り）の素材処理。

入力: ~/Downloads の ChatGPT 生成2枚（同一人物・分離色キット）
  ①振りかぶり = soccer_player_redrawn_clean.png（RGBA・透過済み）
  ②蹴り       = ChatGPT Image 2026年7月16日 19_34_47.png（RGB・白背景）

処理:
  1. ②を境界連結フラッドフィルで透過（内部の白＝目/靴マーク等は保護）
  2. 両方デフリンジ（透過に隣接する準白ピクセルを除去）
  3. bboxトリム→身長を測り、②基準で①をスケール整合
  4. MangaRecolor色相窓のカバレッジをレポート（受入基準の入力形式チェック）
出力: img/cutscenes/manga_shot_anim/windup.png / strike.png ＋検証用合成
"""
import os, sys
import numpy as np
from PIL import Image
from collections import deque

DL = os.path.expanduser('~/Downloads')
OUT = os.path.expanduser('~/football-sim/img/cutscenes/manga_shot_anim')
QA = os.path.expanduser('~/football-sim/tools/proto')
os.makedirs(OUT, exist_ok=True)

# 役割はユーザー指摘(2026-07-23)で確定: 腕広げ+足を後ろに引いた絵=振りかぶり／膝が前=振り抜き
SRC_WINDUP = os.path.join(DL, 'ChatGPT Image 2026年7月23日 13_54_17 (1).png')   # 整え版(2026-07-23)
SRC_STRIKE = os.path.join(DL, 'ChatGPT Image 2026年7月23日 13_54_17 (2).png')
FLIP = True   # 原画はネイティブ右向き→シーンのネイティブ左向きへ左右反転（ユーザー指摘）


def flood_keyout(im, tol=18):
    """境界に連結した準白だけ透過。内部の白（白目・靴の白）は残す。"""
    a = np.asarray(im.convert('RGB'), dtype=np.int16)
    h, w = a.shape[:2]
    white = (a > 255 - tol * 2).all(axis=2)
    seen = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if white[y, x] and not seen[y, x]:
                seen[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if white[y, x] and not seen[y, x]:
                seen[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and white[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))
    rgba = np.dstack([np.asarray(im.convert('RGB'), dtype=np.uint8),
                      np.where(seen, 0, 255).astype(np.uint8)])
    return Image.fromarray(rgba, 'RGBA')


def defringe(im, passes=2):
    """透過に隣接する準白・低彩度の明ピクセルを剥がす（白ハロー除去）"""
    a = np.asarray(im).copy()
    for _ in range(passes):
        al = a[:, :, 3] > 128
        rgb = a[:, :, :3].astype(np.int16)
        bright = rgb.min(axis=2) > 205
        lowsat = (rgb.max(axis=2) - rgb.min(axis=2)) < 26
        pad = np.pad(al, 1)
        near_tr = ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
        kill = al & bright & lowsat & near_tr
        a[:, :, 3][kill] = 0
        if not kill.any():
            break
    return Image.fromarray(a, 'RGBA')


def trim(im, pad=4):
    al = np.asarray(im)[:, :, 3] > 24
    ys, xs = np.nonzero(al)
    return im.crop((max(0, xs.min() - pad), max(0, ys.min() - pad),
                    min(im.width, xs.max() + 1 + pad), min(im.height, ys.max() + 1 + pad)))


def hue_report(im, name):
    """MangaRecolor色相窓のカバレッジ（透過画素除く）"""
    a = np.asarray(im.convert('RGBA')).astype(np.float32)
    al = a[:, :, 3] > 128
    r, g, b = a[:, :, 0] / 255, a[:, :, 1] / 255, a[:, :, 2] / 255
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    d = mx - mn
    hue = np.zeros_like(mx)
    m = (d > 1e-6) & (mx == r); hue[m] = (60 * ((g - b) / d) % 360)[m]
    m = (d > 1e-6) & (mx == g); hue[m] = (60 * ((b - r) / d) + 120)[m]
    m = (d > 1e-6) & (mx == b); hue[m] = (60 * ((r - g) / d) + 240)[m]
    sat = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    chroma = al & (sat > 0.25) & (mx > 0.18)
    wins = {'skin14-50': (14, 50), 'shorts120-168': (120, 168),
            'accent170-202': (170, 202), 'shirt203-245': (203, 245),
            'socks300-350': (300, 350)}
    tot = al.sum()
    print(f'--- {name}: 不透明 {tot}px / 有彩色 {chroma.sum()}px')
    covered = np.zeros_like(chroma)
    for k, (lo, hi) in wins.items():
        m = chroma & (hue >= lo) & (hue <= hi)
        covered |= m
        print(f'  {k:15s} {m.sum():7d}px ({m.sum()/tot*100:4.1f}%)')
    stray = chroma & ~covered
    print(f'  窓外の有彩色      {stray.sum():7d}px ({stray.sum()/tot*100:4.1f}%) ←髪茶色は想定内')
    return hue, stray, al


def main():
    # どちらも白背景が不透明のまま残っている→白平坦化してから両方キーアウト
    def load(p):
        im0 = Image.open(p).convert('RGBA')
        flat = Image.new('RGBA', im0.size, (255, 255, 255, 255))
        flat.alpha_composite(im0)
        im = flood_keyout(flat)
        if FLIP:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        return im
    windup = load(SRC_WINDUP)
    strike = load(SRC_STRIKE)
    windup = trim(defringe(windup))
    strike = trim(defringe(strike))
    print(f'trim後: windup {windup.size} / strike {strike.size}')

    # 身長整合: 頭頂→接地足の高さ。蹴り絵②を基準に①をスケール
    # （どちらも全身が bbox なので bbox 高さ比で合わせる）
    scale = strike.height / windup.height
    if abs(scale - 1) > 0.02:
        windup = windup.resize((round(windup.width * scale), strike.height), Image.LANCZOS)
        print(f'windup を {scale:.3f}x → {windup.size}')

    # ★実行時の激しい縮小(約10倍)で細部が潰れるのを防ぐため、アセット段階で下げておく。
    #   既存の manga_shot/*.png(縦388px)と同水準の縦420pxへ Lanczos で整える＝
    #   実行時 _csPixelate は 2.8倍程度の緩やかな縮小で済み精細に載る（2026-07-23 ユーザー指摘「潰れ」対策）。
    TARGET_H = 420
    def downsize(im):
        w = round(im.width * TARGET_H / im.height)
        return im.resize((w, TARGET_H), Image.LANCZOS)
    windup = downsize(windup)
    strike = downsize(strike)
    print(f'アセット縮小: windup {windup.size} / strike {strike.size}')

    hue_report(windup, 'windup')
    hue_report(strike, 'strike')

    windup.save(os.path.join(OUT, 'windup.png'))
    strike.save(os.path.join(OUT, 'strike.png'))

    # 検証用: 暗背景に2枚並置（白飛び・ハロー確認用）
    H = max(windup.height, strike.height) + 40
    W = windup.width + strike.width + 60
    sheet = Image.new('RGB', (W, H), (30, 34, 44))
    sheet.paste(windup, (20, H - windup.height - 20), windup)
    sheet.paste(strike, (windup.width + 40, H - strike.height - 20), strike)
    sheet.save(os.path.join(QA, '_qa_shot_anim2_darkbg.png'))
    print('saved:', OUT, '+ _qa_shot_anim2_darkbg.png')


if __name__ == '__main__':
    main()
