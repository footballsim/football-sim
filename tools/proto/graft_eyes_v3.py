#!/usr/bin/env python3
"""転倒スプライトへ「良い目」を線だけ移植する（2026-07-17・process_tumble.py の後に実行）。

donor = 8b81035 版（ユーザーが「とてもいい状態」と指定した眉+目）。
17日原画の目は線が細く短く34%縮小で点に潰れる。矩形コピー移植は髪を巻き込み
継ぎ目ブロックを作って失敗（f11）。本スクリプトは:
 1) BOX内の暗インク成分のうち「上辺に触れない」もの＝眉と目だけを抽出（髪は上辺接触で除外）
 2) 現行の線をAA込み(2px膨張)で肌中央値へ消去
 3) donorの線+1px AAを「眉の重心合わせ」のオフセットで移植（肌は運ばない）
検証: 34%シムで眉+目が donor と同じ2本線になること。"""
import numpy as np, colorsys
from PIL import Image
from collections import deque

OUT = 'img/cutscenes/manga_foul_atk/wavy.png'
DONOR = 'tools/proto/_fk_backup_20260717/foul_atk_wavy_8b81035.png'
BOX = (555, 70, 625, 112)

def lum(p): return 0.299*p[0]+0.587*p[1]+0.114*p[2]

def strokes(a, box, th=80):
    x0,y0,x1,y1 = box
    pts = {(x,y) for y in range(y0,y1) for x in range(x0,x1) if a[y,x,3]>40 and lum(a[y,x])<th}
    seen=set(); comps=[]
    for p0 in pts:
        if p0 in seen: continue
        c=[]; dq=deque([p0]); seen.add(p0)
        while dq:
            x,y=dq.popleft(); c.append((x,y))
            for dx in(-1,0,1):
                for dy in(-1,0,1):
                    q=(x+dx,y+dy)
                    if q in pts and q not in seen: seen.add(q); dq.append(q)
        comps.append(c)
    return [c for c in comps if len(c)>=6 and min(p[1] for p in c) > y0+1]

def main():
    donor = np.array(Image.open(DONOR).convert('RGBA')).astype(int)
    base = np.array(Image.open(OUT).convert('RGBA')).astype(int)
    ds, bs = strokes(donor,BOX), strokes(base,BOX)
    if not ds or not bs:
        raise SystemExit('GATE FAIL: 線が見つからない donor=%d base=%d' % (len(ds),len(bs)))
    def cen(cs):
        big=max(cs,key=len); return (sum(p[0] for p in big)/len(big), sum(p[1] for p in big)/len(big))
    dc,bc = cen(ds), cen(bs)
    off = (round(bc[0]-dc[0]), round(bc[1]-dc[1]))
    if abs(off[0])>8 or abs(off[1])>8:
        raise SystemExit('GATE FAIL: 眉オフセットが異常 %s' % (off,))
    out = base.copy()
    skin = np.median(np.array([base[y,x][:3] for y in range(BOX[1],BOX[3]) for x in range(BOX[0],BOX[2])
        if base[y,x,3]>40 and lum(base[y,x])>150 and base[y,x,0]>180]),axis=0).astype(int)
    er=set()
    for c in bs:
        for x,y in c:
            for dx in range(-2,3):
                for dy in range(-2,3):
                    er.add((x+dx,y+dy))
    n_er=0
    for x,y in er:
        if not(BOX[0]<=x<BOX[2] and BOX[1]<=y<BOX[3]): continue
        p=out[y,x]
        if p[3]<40 or lum(p)>=150: continue
        h,s,v = colorsys.rgb_to_hsv(p[0]/255,p[1]/255,p[2]/255)
        if v<0.35 and s<0.5: continue
        out[y,x,0],out[y,x,1],out[y,x,2]=skin; n_er+=1
    n_p=0
    for c in ds:
        halo=set()
        for x,y in c:
            for dx in(-1,0,1):
                for dy in(-1,0,1):
                    halo.add((x+dx,y+dy))
        for x,y in halo:
            if donor[y,x,3]<40 or lum(donor[y,x])>=140: continue
            nx,ny=x+off[0],y+off[1]
            if out[ny,nx,3]>40: out[ny,nx]=donor[y,x]; n_p+=1
    Image.fromarray(out.astype(np.uint8)).save(OUT)
    print('graft_eyes_v3: erase=%dpx paste=%dpx off=%s' % (n_er,n_p,off))

if __name__ == '__main__':
    main()
