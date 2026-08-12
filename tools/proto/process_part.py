#!/usr/bin/env python3
"""選手ポートレート・パーツ処理ツール（新セッションでも再利用）。
lab v2 = tools/proto/portrait-lab.html。パーツは tools/proto/parts/ に置く。

■ 確立ワークフロー
  1) ユーザーがAIツールで各部位を「実物の顔の上」に描く（顔=単体でも可）。
     背景=ベタ塗り（推奨=緑#00FF00。マゼンタ#FF00FFは唇/肌のピンクと衝突するので純色判定に注意）。
  2) このスクリプトで背景除去＋位置ごと抽出 → parts/*.png（720x840・NEAREST）。
  3) lab v2 のスライダー（共通変形T + パーツ個別調整PART_ADJ）でユーザーが微調整。
  4) 返ってきた PART_ADJ を bake() でPNGに焼き込み（以後デフォルトで揃う）。

■ 使い方（新セッションで）: 各関数を import / 貼り付けて呼ぶ。DL=~/Downloads, DST=parts/。
"""
import os, math
from collections import deque
from PIL import Image, ImageDraw

DST = os.path.expanduser('~/football-sim/tools/proto/parts')
DL  = os.path.expanduser('~/Downloads')
FW, FH = 720, 840

# ---- 背景キー判定（描いた背景色に合わせて選ぶ） ----
def is_magenta(p):        r,g,b=p; return r>110 and b>110 and g<(r+b)/2-45   # 通常（グレスケ/暗色部位向け）
def is_magenta_strict(p): r,g,b=p; return r>130 and b>130 and g<75           # 唇のピンクを残す（口）
def is_green(p):          r,g,b=p; return g>110 and g>r+40 and g>b+40         # 緑背景（推奨）

def key_bg(src_name, is_bg=is_magenta):
    """DLの画像を背景除去して 720x840 RGBA(NEAREST) を返す（位置保持・丸ごと）。"""
    im = Image.open(os.path.join(DL, src_name)).convert('RGB'); W,H = im.size
    out = Image.new('RGBA',(W,H))
    out.putdata([(0,0,0,0) if is_bg(p) else (p[0],p[1],p[2],255) for p in im.getdata()])
    return out.resize((FW,FH), Image.NEAREST)

# ---- 部位抽出 ----
def extract_face(src_name, out='face_oval.png', is_bg=is_magenta):
    key_bg(src_name, is_bg).save(os.path.join(DST,out)); print('face ->',out)

def extract_eyes(src_name, out='eyes_normal.png', is_bg=is_magenta):
    """顔+目 or 目単体 から目/眉だけ抽出。オレンジ虹彩で位置特定→ボックス内で肌の灰色帯を除外→de-fringe。"""
    fwe = key_bg(src_name, is_bg); P = fwe.load()
    def orange(r,g,b): return r>120 and r>g>b and b<115 and r-b>45
    sx=[]; sy=[]
    for y in range(FH):
        for x in range(FW):
            r,g,b,a=P[x,y]
            if a>30 and orange(r,g,b): sx.append(x); sy.append(y)
    if not sx: print('!! no orange iris found in',src_name); return
    l,r,t,b=min(sx),max(sx),min(sy),max(sy); bw=r-l; bh=b-t
    L=max(0,l-int(bw*0.30)); R=min(FW,r+int(bw*0.30)); T=max(0,t-int(bh*1.8)); B=min(FH,b+int(bh*0.6))
    out_img=Image.new('RGBA',(FW,FH)); O=out_img.load()
    for y in range(T,B):
        for x in range(L,R):
            r,g,bb,a=P[x,y]
            if a<30 or is_bg((r,g,bb)): continue
            mx=max(r,g,bb); mn=min(r,g,bb); avg=(r+g+bb)//3
            if not((mx-mn<28) and (145<avg<230)):   # 肌の灰色帯を除外
                O[x,y]=(r,g,bb,255)
    out_img = defringe(remove_thin_lines(out_img))   # 鼻筋の細縦線＆濃肌の白にじみを除去
    out_img.save(os.path.join(DST,out)); print('eyes ->',out,'bbox',out_img.getbbox())

def extract_simple(src_name, out, is_bg=is_magenta):
    """口/髪など単体パーツ：背景除去して丸ごと。口は is_bg=is_magenta_strict（唇ピンク保護）。"""
    key_bg(src_name, is_bg).save(os.path.join(DST,out)); print(out,'<-',src_name)

# ---- 後処理 ----
def remove_thin_lines(img):
    """連結成分で「幅<=6 かつ 高さ>=18」の細い縦線（鼻筋等の抽出ノイズ）を除去。※目/眉は幅が広いので残る。
       注意: 線が本体と接して1成分化する場合は列分布で個別に消す（下記 clear_cols）。"""
    W,H=img.size; px=img.load(); seen=[[False]*W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            if px[x,y][3]>0 and not seen[y][x]:
                q=deque([(x,y)]); seen[y][x]=True; comp=[]; minx=maxx=x; miny=maxy=y
                while q:
                    cx,cy=q.popleft(); comp.append((cx,cy)); minx=min(minx,cx);maxx=max(maxx,cx);miny=min(miny,cy);maxy=max(maxy,cy)
                    for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
                        nx,ny=cx+dx,cy+dy
                        if 0<=nx<W and 0<=ny<H and px[nx,ny][3]>0 and not seen[ny][nx]:
                            seen[ny][nx]=True; q.append((nx,ny))
                if (maxx-minx+1)<=6 and (maxy-miny+1)>=18:
                    for cx,cy in comp: px[cx,cy]=(0,0,0,0)
    return img

def clear_cols(img, x0, x1):
    """x0<=x<x1 の列を透明化（本体と接した縦線を列分布で特定して消す時用）。"""
    W,H=img.size; px=img.load()
    for y in range(H):
        for x in range(x0,min(x1,W)):
            if px[x,y][3]>0: px[x,y]=(0,0,0,0)
    return img

def defringe(img, thr=172, passes=2):
    """縁の明るい画素（白にじみ）を除去。白目など"内側"の明画素は透明隣接しないので残る。濃肌で白フチが目立つ対策。"""
    W,H=img.size; px=img.load()
    def tp(x,y): return not(0<=x<W and 0<=y<H) or px[x,y][3]<20
    for _ in range(passes):
        clr=[(x,y) for y in range(H) for x in range(W)
             if px[x,y][3]>=20 and min(px[x,y][:3])>thr and (tp(x-1,y) or tp(x+1,y) or tp(x,y-1) or tp(x,y+1))]
        for x,y in clr: px[x,y]=(0,0,0,0)
    return img

def deepen_lip(name='mouth_flat.png', lip=(128,66,78)):
    """口の唇影（ピンク部分）を深いローズに濃くする。濃肌で唇が消える対策。暗い口線(avg<80)は保持。"""
    p=os.path.join(DST,name); im=Image.open(p).convert('RGBA'); px=im.load(); W,H=im.size
    for y in range(H):
        for x in range(W):
            r,g,b,a=px[x,y]
            if a>=20 and (r+g+b)//3>=80 and r>g and b>g: px[x,y]=(lip[0],lip[1],lip[2],a)
    im.save(p); print('lip deepened in',name)

def bake(name, dx=0, dy=0, s=1.0):
    """lab v2 の PART_ADJ をPNGに焼き込む。 new = old*s + (dx,dy)。以後デフォルト(0,0,1)で揃う。"""
    p=os.path.join(DST,name); im=Image.open(p).convert('RGBA')
    if s!=1.0: im=im.resize((int(FW*s),int(FH*s)), Image.NEAREST)
    cv=Image.new('RGBA',(FW,FH),(0,0,0,0)); cv.paste(im,(int(dx),int(dy)),im); cv.save(p)
    print('baked',name,'dx',dx,'dy',dy,'s',s,'bbox',cv.getbbox())

# ---- リカラーはlab側(portrait-lab.html tinted())で: 平均輝度を目標色へスケール newL=L*tl/meanL ----

if __name__ == '__main__':
    print('functions: extract_face / extract_eyes / extract_simple / defringe / remove_thin_lines / clear_cols / deepen_lip / bake')
    print('例) extract_face("face_oval.png"); extract_eyes("face_with_eyes.png"); extract_simple("mouth_flat.png","mouth_flat.png",is_magenta_strict); deepen_lip(); extract_simple("hairfront_short.png","hairfront_short.png")')
    print('髭) extract_simple("beard_full.png","beard_full.png",is_green)  # 髭はグレスケ単体パーツ＝髪と同経路(緑背景推奨)。唇中央は透過のまま描いてもらう。合成は口の上・前髪の下・髪色リカラー。')
