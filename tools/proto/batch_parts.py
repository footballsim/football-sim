#!/usr/bin/env python3
"""バッチ顔パーツ抽出（グリッド生成→自動整列→自動抽出）。2026-07-04確立・髪型8種で実証済。
入力: AIが1枚に生成した 3×3 グリッド（同一キャラ・3/4向き・緑背景・セル1=素の顔(ハゲ)）。
      生成プロンプトは PART_PROMPTS.md 参照。参照画像 = base_face_for_batch.png（素のベース顔）。

パイプライン（各段の理由はコメント）:
 1) 等分割+緑キー
 2) 整列: スケール=セル1の頭蓋最大幅→正準face_ovalの最大幅（※虹彩間隔は生成キャラの
    プロポーション差で頭が合わないのでスケールに使わない）。平行移動=頭蓋中心x/頭頂y、
    セル間ドリフトは虹彩クラスタ中点の差分で補正（画素重心は目の大小でバイアス→クラスタ中点）。
 2.5) **輪郭ワープ（根本対策・2026-07-05確立）**: スケール+平行移動では「頭の形の違い」は吸収できない
    （ドナー頭蓋は上部が細い等→髪が届かない地肌帯/はみ出しが場所ごとに逆向きに出る＝対症療法はモグラ叩き）。
    顔重心から720方位の半径プロファイル Rc(θ)=正準頭 / Rd(θ)=ドナー頭(整列済セル1) を計測し、
    各セルを方向別に半径比で放射伸縮（輪郭内 ρ'=ρ·Rd/Rc、輪郭外は頭皮からの厚み保存 ρ'=Rd+(ρ-Rc)）。
    → ドナー頭皮上の髪が構造的に正準頭皮へ一致。比は[0.75,1.4]クランプ・±3binで平滑化。
 3) 髪抽出: 低彩度(灰) かつ 白すぎない 画素 → 1px opening（細鎖除去）→
    「セル自身のシルエット頭頂30%バンドに触れる連結成分」だけ採用（眉/鼻筋/ハイライトは頭頂に繋がらない）
 4) hairfront/hairback 分割: **頭蓋ゾーン(y<Y_SKULL=500)は内外を問わず全てfront**（backに置くと顔の輪郭線が
    髪の上に描かれ「分断シーム」が出る＝2026-07-04ユーザー指摘で確定）。y>=500のみ シルエット内=front/外=back。
    顎下窓(x250-480,y>585)の迷い込みは捨てる
 5) ギャップ埋め: 髪と顔エッジの隙間（ドナー輪郭差）を、顔エッジ8px以内の空隙へ髪色を反復成長で充填→back
 6) 仕上げ: 右側(x>450)の細い水平ラン(<14px)除去 / 右頬ゾーンの小成分・低密度鎖除去（ドナー輪郭の名残）
 7) 輪郭ズレ対策 polish()（2026-07-04ユーザー指摘で確立）:
    a) ギャップリング完全充填＝「空画素で顔5px以内」を髪色で接触するまで反復充填（白スジ=隙間の根絶）
    b) タイト髪型(TIGHT)のみ うなじのはみ出し(y>540で顔から16px超)を刈る
    c) 顔に並走する細ラン(右側x>430・y>=190・幅<12・全画素が顔12px以内)＝ドナー頭の二重輪郭を除去
既知の教訓: 正準顔自体の陰影(右頬の破線)を抽出ノイズと誤認しない — 素の顔を単体描画して切り分ける。
生成側の対策: グリッド生成プロンプトに「全セルで頭の輪郭シルエットを参照と完全同一に保つ・髪はその上に足すだけ」
を明記する（ドナー輪郭差が減るほど polish の仕事が減る）。PART_PROMPTS.md §G 参照。
使い方: python3 batch_parts.py <grid.png>   STYLES のマッピングを生成内容に合わせて編集。
"""
import os, sys, colorsys
from collections import deque
from PIL import Image, ImageDraw

DST=os.path.expanduser('~/football-sim/tools/proto/parts'); FW,FH=720,840; GRID=3; INSET=8
STYLES={1:'base',2:'buzz',3:'spike',4:'slick',5:'part',6:'bangs',7:'curly',8:'wavy',9:'mohawk'}

def is_green(p): r,g,b=p; return g>110 and g>r+40 and g>b+40
def is_orange(r,g,b): return r>120 and r>g>b and b<115 and r-b>45

def key_green(im):
    im=im.convert('RGB'); W,H=im.size; out=Image.new('RGBA',(W,H))
    out.putdata([(0,0,0,0) if is_green(p) else (p[0],p[1],p[2],255) for p in im.getdata()])
    return out

def iris_centers(img):
    """オレンジ虹彩を左右クラスタに分け、両中心の中点を返す（画素重心は目サイズ差でバイアスするため不可）。"""
    W,H=img.size; px=img.load(); pts=[]
    for y in range(H):
        for x in range(W):
            r,g,b,a=px[x,y]
            if a>30 and is_orange(r,g,b): pts.append((x,y))
    if len(pts)<20: return None
    xs=sorted(p[0] for p in pts); split=(xs[0]+xs[-1])/2
    L=[p for p in pts if p[0]<=split]; R=[p for p in pts if p[0]>split]
    if len(L)<8 or len(R)<8: return None
    c=lambda g:(sum(p[0] for p in g)/len(g),sum(p[1] for p in g)/len(g))
    (lx,ly),(rx,ry)=c(L),c(R)
    return ((lx+rx)/2,(ly+ry)/2)

def skull_info(img):
    """(シルエット最大行幅, その行の中心x, 頭頂y)"""
    W,H=img.size; px=img.load(); best=(0,0); top=None
    for y in range(H):
        l=r=None
        for x in range(W):
            if px[x,y][3]>30:
                if l is None: l=x
                r=x
        if l is not None:
            if top is None: top=y
            if r-l+1>best[0]: best=(r-l+1,(l+r)/2)
    return best[0],best[1],top

def place(img,s,off):
    sc=img.resize((max(1,int(img.size[0]*s)),max(1,int(img.size[1]*s))),Image.NEAREST)
    cv=Image.new('RGBA',(FW,FH),(0,0,0,0)); cv.paste(sc,(int(round(off[0])),int(round(off[1]))),sc)
    return cv

NB=720   # 半径プロファイルの方位分割数

def radius_profile(img, cx, cy):
    """重心(cx,cy)から各方位binの最大半径（頭の輪郭距離）。ゼロbinは近傍補間・±3bin平滑化。"""
    import math
    W,H=img.size; px=img.load(); R=[0.0]*NB
    for y in range(H):
        for x in range(W):
            if px[x,y][3]>30:
                dx,dy=x-cx,y-cy; rho=math.hypot(dx,dy)
                b=int(((math.atan2(dy,dx)+math.pi)/(2*math.pi))*NB)%NB
                if rho>R[b]: R[b]=rho
    for b in range(NB):                                   # 空binを近傍から補間
        if R[b]==0:
            for d in range(1,NB):
                if R[(b+d)%NB]>0: R[b]=R[(b+d)%NB]; break
    sm=[0.0]*NB                                            # 円環±8bin移動平均（狭いと生え際が角度方向に裂けて波打つ）
    for b in range(NB):
        s=n=0
        for d in range(-8,9): s+=R[(b+d)%NB]; n+=1
        sm[b]=s/n
    return sm

def warp_to_canon(cell, Rd, Rc, cx, cy):
    """方向別半径比のポーラーワープでドナー頭輪郭→正準頭輪郭へ（逆写像・NEAREST）。
    比率場も±6binで平滑化＝隣接方位の伸縮差による生え際の裂け/波打ちを防ぐ（2026-07-05・8点指摘で強化）。"""
    import math
    raw=[max(0.75,min(1.4,(Rd[b]/Rc[b]) if Rc[b]>1 else 1.0)) for b in range(NB)]
    ratio=[0.0]*NB
    for b in range(NB):
        s=n=0
        for d in range(-6,7): s+=raw[(b+d)%NB]; n+=1
        ratio[b]=s/n
    out=Image.new('RGBA',(FW,FH),(0,0,0,0)); op=out.load(); src=cell.load()
    for y in range(FH):
        for x in range(FW):
            dx,dy=x-cx,y-cy; rho=math.hypot(dx,dy)
            if rho<1:
                op[x,y]=src[x,y]; continue
            b=int(((math.atan2(dy,dx)+math.pi)/(2*math.pi))*NB)%NB
            rc=Rc[b]
            if rc<=1: continue
            rt=ratio[b]
            r2 = rho*rt if rho<=rc else rc*rt+(rho-rc)
            sx=int(round(cx+dx/rho*r2)); sy=int(round(cy+dy/rho*r2))
            if 0<=sx<FW and 0<=sy<FH: op[x,y]=src[sx,sy]
    return out

def hair_mask_topo(cell):
    W,H=cell.size; px=cell.load()
    ys=[y for y in range(H) for x in range(0,W,3) if px[x,y][3]>30]
    if not ys: return Image.new('RGBA',(W,H)),0
    top=min(ys); bot=max(ys); band=top+int((bot-top)*0.30)
    cand=[[False]*W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            r,g,b,a=px[x,y]
            if a<=30: continue
            if min(r,g,b)>=195 or (r+g+b)//3>218: continue          # 白フチ除去
            if (max(r,g,b)-min(r,g,b))<=36 and (r-b)<=28: cand[y][x]=True  # 灰=髪（暖色肌を除外）
    core=[[False]*W for _ in range(H)]                                # opening r=1
    for y in range(1,H-1):
        for x in range(1,W-1):
            if cand[y][x] and cand[y-1][x] and cand[y+1][x] and cand[y][x-1] and cand[y][x+1]: core[y][x]=True
    opened=[[False]*W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            if cand[y][x]:
                hit=False
                for dy in(-1,0,1):
                    for dx in(-1,0,1):
                        ny,nx=y+dy,x+dx
                        if 0<=ny<H and 0<=nx<W and core[ny][nx]: hit=True; break
                    if hit: break
                opened[y][x]=hit
    cand=opened
    seen=[[False]*W for _ in range(H)]
    out=Image.new('RGBA',(W,H),(0,0,0,0)); op=out.load(); total=0
    for y in range(H):
        for x in range(W):
            if cand[y][x] and not seen[y][x]:
                q=deque([(x,y)]); seen[y][x]=True; comp=[(x,y)]; touch=False
                while q:
                    cx,cy=q.popleft()
                    if cy<=band: touch=True
                    for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
                        nx,ny=cx+dx,cy+dy
                        if 0<=nx<W and 0<=ny<H and cand[ny][nx] and not seen[ny][nx]:
                            seen[ny][nx]=True; q.append((nx,ny)); comp.append((nx,ny))
                if touch and len(comp)>=80:
                    for cx,cy in comp: op[cx,cy]=px[cx,cy][:3]+(255,)
                    total+=len(comp)
    return out,total

def split_and_clean(hair,face,sid):
    fa=face.load(); hp=hair.load()
    front=Image.new('RGBA',(FW,FH),(0,0,0,0)); back=Image.new('RGBA',(FW,FH),(0,0,0,0))
    fp=front.load(); bp=back.load(); nb=0
    for y in range(FH):
        for x in range(FW):
            p=hp[x,y]
            if p[3]==0: continue
            if 250<x<480 and y>585: continue                          # 顎下の迷い込み
            if fa[x,y][3]>40: fp[x,y]=p
            else: bp[x,y]=p; nb+=1
    # gap-fill: 顔エッジ8px以内の空隙へ髪から反復成長
    prox=[[False]*FW for _ in range(FH)]
    frontier=[(x,y) for y in range(FH) for x in range(FW) if fa[x,y][3]>40]
    for x,y in frontier: prox[y][x]=True
    for it in range(8):
        nxt=[]
        for x,y in frontier:
            for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
                nx,ny=x+dx,y+dy
                if 0<=nx<FW and 0<=ny<FH and not prox[ny][nx]: prox[ny][nx]=True; nxt.append((nx,ny))
        frontier=nxt
    occ=[[fp[x,y][3]>0 or bp[x,y][3]>0 for x in range(FW)] for y in range(FH)]
    for it in range(12):
        adds=[]
        for y in range(Y_SKULL):   # 充填は頭蓋ゾーンのみ（首まで埋めるとリム→それを消す削除が髪を削る悪循環＝2026-07-05撤去）
            for x in range(FW):
                if occ[y][x] or not prox[y][x] or fa[x,y][3]>40: continue
                col=None
                for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
                    nx,ny=x+dx,y+dy
                    if 0<=nx<FW and 0<=ny<FH and occ[ny][nx]:
                        src=bp[nx,ny] if bp[nx,ny][3]>0 else fp[nx,ny]
                        if src[3]>0: col=src[:3]; break
                if col and not(250<x<480 and y>585): adds.append((x,y,col))
        if not adds: break
        for x,y,col in adds: bp[x,y]=col+(255,); occ[y][x]=True
    # 右側細ラン除去（ドナー輪郭の名残・back）
    for y in range(300,FH):
        x=450
        while x<FW:
            if bp[x,y][3]>0 and fa[x,y][3]<=40:
                x0=x
                while x<FW and bp[x,y][3]>0 and fa[x,y][3]<=40: x+=1
                if (x-x0)<14:
                    for xx in range(x0,x): bp[xx,y]=(0,0,0,0); nb-=1
            else: x+=1
    # 右頬ゾーンの小成分除去（front）
    X0,X1,Y0,Y1=400,660,300,730
    seen=[[False]*(X1-X0) for _ in range(Y1-Y0)]
    for y in range(Y0,Y1):
        for x in range(X0,X1):
            if fp[x,y][3]>0 and not seen[y-Y0][x-X0]:
                q=deque([(x,y)]); seen[y-Y0][x-X0]=True; comp=[(x,y)]
                while q:
                    cx,cy=q.popleft()
                    for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
                        nx,ny=cx+dx,cy+dy
                        if X0<=nx<X1 and Y0<=ny<Y1 and fp[nx,ny][3]>0 and not seen[ny-Y0][nx-X0]:
                            seen[ny-Y0][nx-X0]=True; q.append((nx,ny)); comp.append((nx,ny))
                if len(comp)<120:
                    for cx,cy in comp: fp[cx,cy]=(0,0,0,0)
    # 頭蓋ゾーン(y<Y_SKULL)のbackをfrontへ統合（顔輪郭線による分断シーム防止）
    nb2=0
    for y in range(FH):
        for x in range(FW):
            if bp[x,y][3]>0:
                if y<Y_SKULL:
                    if fp[x,y][3]==0: fp[x,y]=bp[x,y]
                    bp[x,y]=(0,0,0,0)
                else: nb2+=1
    front.save(f'{DST}/hairfront_{sid}.png')
    hb=f'{DST}/hairback_{sid}.png'
    if nb2>=800: back.save(hb)
    elif os.path.exists(hb): os.remove(hb)
    return nb2

def tint(img,hexcol):
    h=hexcol.lstrip('#'); tr,tg,tb=int(h[0:2],16),int(h[2:4],16),int(h[4:6],16)
    th,tl_,ts=colorsys.rgb_to_hls(tr/255,tg/255,tb/255); px=img.load();W,H=img.size
    s=0;n=0
    for y in range(H):
        for x in range(W):
            r,g,b,a=px[x,y]
            if a>=8: s+=colorsys.rgb_to_hls(r/255,g/255,b/255)[1];n+=1
    sc=tl_/max(0.06,(s/n) if n else .5); out=Image.new('RGBA',(W,H));o=out.load()
    for y in range(H):
        for x in range(W):
            r,g,b,a=px[x,y]
            if a<8:o[x,y]=(0,0,0,0)
            else:
                l=min(1,max(0,colorsys.rgb_to_hls(r/255,g/255,b/255)[1]*sc)); rr,gg,bb=colorsys.hls_to_rgb(th,l,ts); o[x,y]=(int(rr*255),int(gg*255),int(bb*255),a)
    return out

def run(src):
    grid=Image.open(os.path.expanduser(src)).convert('RGB'); GW,GH=grid.size
    cw,ch=GW//GRID,GH//GRID
    eyes=Image.open(DST+'/eyes_normal.png').convert('RGBA')
    face=Image.open(DST+'/face_oval.png').convert('RGBA')
    cW,cCx,cTop=skull_info(face)
    raw={}
    for i in range(1,GRID*GRID+1):
        r,c=divmod(i-1,GRID)
        cell=key_green(grid.crop((c*cw+INSET,r*ch+INSET,(c+1)*cw-INSET,(r+1)*ch-INSET)))
        mid=iris_centers(cell)
        if not mid: print(f'cell{i}: NO IRIS — skip'); continue
        raw[i]=(cell,mid)
    if 1 not in raw: print('!! base cell missing'); return
    bW,bCx,bTop=skull_info(raw[1][0]); s=cW/max(1,bW); base_mid=raw[1][1]
    off_base=(cCx-bCx*s, cTop-bTop*s)
    print(f'scale={s:.3f} off_base=({off_base[0]:.0f},{off_base[1]:.0f})')
    # 輪郭ワープの準備: 正準頭とドナー頭(整列済セル1)の半径プロファイル
    fpts=[(x,y) for y in range(FH) for x in range(FW) if face.load()[x,y][3]>40]
    fcx=sum(p[0] for p in fpts)/len(fpts); fcy=sum(p[1] for p in fpts)/len(fpts)
    base_al=place(raw[1][0],s,off_base)
    Rc=radius_profile(face,fcx,fcy); Rd=radius_profile(base_al,fcx,fcy)
    print('contour warp ready (Rc/Rd sampled at',NB,'bins)')
    made=[]
    for i,(cell,mid) in raw.items():
        sid=STYLES.get(i)
        if not sid or sid=='base': continue
        off=(off_base[0]+(base_mid[0]-mid[0])*s, off_base[1]+(base_mid[1]-mid[1])*s)
        al=place(cell,s,off)
        al=warp_to_canon(al,Rd,Rc,fcx,fcy)   # ← 根本対策: ドナー頭輪郭→正準頭輪郭
        hm,n=hair_mask_topo(al)
        nb=split_and_clean(hm,face,sid)
        print(f'{sid}: hair_px={n} back_px={nb}')
        made.append(sid)
    # contact sheet
    mouth=Image.open(DST+'/mouth_flat.png').convert('RGBA'); tf=tint(face,'#e6ad7f')
    cols=4; rows=(len(made)+cols-1)//cols; TS=300; th=TS*840//720
    sheet=Image.new('RGB',(cols*TS,rows*th+26),(28,32,48)); d=ImageDraw.Draw(sheet)
    for k,sid in enumerate(made):
        cv=Image.new('RGBA',(FW,FH),(255,255,255,255))
        hb=f'{DST}/hairback_{sid}.png'
        if os.path.exists(hb): cv.alpha_composite(tint(Image.open(hb).convert('RGBA'),'#3a2416'))
        cv.alpha_composite(tf); cv.alpha_composite(eyes); cv.alpha_composite(mouth)
        cv.alpha_composite(tint(Image.open(f'{DST}/hairfront_{sid}.png').convert('RGBA'),'#3a2416'))
        r,c=divmod(k,cols)
        sheet.paste(cv.convert('RGB').resize((TS,th),Image.NEAREST),(c*TS,r*th+26))
        d.text((c*TS+6,r*th+8),sid,fill=(140,220,255))
    sheet.save('/tmp/batch_sheet.png'); print('sheet -> /tmp/batch_sheet.png')

TIGHT={'buzz','slick','part','spike','mohawk','bangs'}   # 首元を完全に刈る髪型（ボリューム系curly/wavy/afro/bowlは別扱い）
Y_SKULL=500   # 頭蓋ゾーン/顎・首ゾーンの境界。充填は頭蓋のみ・首は削除が正しい（2026-07-04確定）

def polish(sids):
    """輪郭ズレ対策の仕上げパス（run()後に必ず呼ぶ。単体でも既存PNGに適用可）。
    ⚠️ゾーンで方針が真逆: 頭蓋ゾーン(y<Y_SKULL)=隙間を髪で「充填」／顎・首ゾーン(y>=)=輪郭沿いの髪を「削除」。
    首まで充填すると髪色の縁取りリムが出て逆に不自然（batch1で実証済の失敗→修正）。"""
    import math
    face=Image.open(DST+'/face_oval.png').convert('RGBA'); fa=face.load()
    def within_face(x,y,r):
        for dy in range(-r,r+1):
            for dx in range(-r,r+1):
                nx,ny=x+dx,y+dy
                if 0<=nx<FW and 0<=ny<FH and fa[nx,ny][3]>40: return True
        return False
    pts=[(x,y) for y in range(FH) for x in range(FW) if fa[x,y][3]>40]
    cx=sum(p[0] for p in pts)/len(pts); cy=sum(p[1] for p in pts)/len(pts)
    def tr(x,y): return not(0<=x<FW and 0<=y<FH) or fa[x,y][3]<=40
    edge=[(x,y) for x,y in pts if tr(x-1,y) or tr(x+1,y) or tr(x,y-1) or tr(x,y+1)]
    for sid in sids:
        hbp=f'{DST}/hairback_{sid}.png'
        fr=Image.open(f'{DST}/hairfront_{sid}.png').convert('RGBA'); fp=fr.load()
        bk=Image.open(hbp).convert('RGBA') if os.path.exists(hbp) else Image.new('RGBA',(FW,FH),(0,0,0,0))
        bp=bk.load()
        # 1) 顔に並走する細ライン(ドナー二重輪郭)除去 — 右(x>430,y>=190)/左(x<300,y>=250・上に髪が続く縦流れは保持)
        for (XA,XB,YS,keepup) in [(430,FW,190,False),(0,300,250,True)]:
            for y in range(YS,FH):
                x=XA
                while x<XB:
                    if bp[x,y][3]>0 and fa[x,y][3]<=40:
                        x0=x
                        while x<XB and bp[x,y][3]>0 and fa[x,y][3]<=40: x+=1
                        if (x-x0)<12 and all(within_face(xx,y,12) for xx in range(x0,x)):
                            if not (keepup and any(bp[xx,max(0,y-3)][3]>0 for xx in range(x0,x))):
                                for xx in range(x0,x): bp[xx,y]=(0,0,0,0)
                    else: x+=1
        # 2) 頭蓋ゾーンのみレイ充填: 顔エッジから外向きに16px走査し髪に当たれば間を充填
        ishair=lambda x,y: fp[x,y][3]>0 or bp[x,y][3]>0
        for ex,ey in edge:
            if ey>=Y_SKULL: continue
            dx,dy=ex-cx,ey-cy; n=math.hypot(dx,dy)
            if n==0: continue
            dx,dy=dx/n,dy/n; path=[]; hit=None
            for t in range(1,17):
                qx,qy=int(round(ex+dx*t)),int(round(ey+dy*t))
                if not(0<=qx<FW and 0<=qy<FH): break
                if fa[qx,qy][3]>40: continue
                if ishair(qx,qy): hit=(qx,qy); break
                path.append((qx,qy))
            if hit and path:
                col=bp[hit[0],hit[1]][:3] if bp[hit[0],hit[1]][3]>0 else fp[hit[0],hit[1]][:3]
                for qx,qy in path:
                    if bp[qx,qy][3]==0 and fp[qx,qy][3]==0: bp[qx,qy]=col+(255,)
        # 3) 顎・首ゾーン: TIGHTのうなじ遠方はみ出し(顔16px超・y>=540)のみ刈る。
        #    ⚠️「輪郭沿い(hugging)の削除」は撤去（2026-07-05）: ワープ後は本物の髪(耳裏〜襟足)を削って白隙間を作る側だった。
        if sid in TIGHT:
            for y in range(540,FH):
                for x in range(FW):
                    if bp[x,y][3]>0 and fa[x,y][3]<=40 and not within_face(x,y,16): bp[x,y]=(0,0,0,0)
        # 4) 頭蓋ゾーンのback(レイ充填で足した分含む)をfrontへ統合（分断シーム防止）
        for y in range(Y_SKULL):
            for x in range(FW):
                if bp[x,y][3]>0:
                    if fp[x,y][3]==0: fp[x,y]=bp[x,y]
                    bp[x,y]=(0,0,0,0)
        # 5) 頬ゴースト除去（2026-07-05確立: 参照顔の頬陰影をAIが全セルに複製→灰色なので髪として混入）
        #    a)孤立黒鎖=顔内部(輪郭8px超)の暗画素で近傍5pxに本物の髪灰(lum>=80)が8個未満 → ドナー輪郭線の残骸
        #    b)内部孤立成分=完全に顔内部・60px未満の斑点。※フリンジ/髪本体は灰色を伴う高密度なので無傷
        inner=[[fa[x,y][3]>40 for x in range(FW)] for y in range(FH)]
        for it in range(8):
            nx2=[row[:] for row in inner]
            for y in range(FH):
                for x in range(FW):
                    if inner[y][x]:
                        for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
                            ax,ay=x+dx,y+dy
                            if not(0<=ax<FW and 0<=ay<FH) or not inner[ay][ax]: nx2[y][x]=False; break
            inner=nx2
        for y in range(360,720):
            for x in range(400,680):
                if not inner[y][x]: continue
                r,g,b,a=fp[x,y]
                if a==0 or (r+g+b)//3>=80: continue
                grayn=0
                for dy in range(-5,6):
                    for dx in range(-5,6):
                        ax,ay=x+dx,y+dy
                        if 0<=ax<FW and 0<=ay<FH:
                            rr,gg,bb,aa=fp[ax,ay]
                            if aa>0 and (rr+gg+bb)//3>=80: grayn+=1
                if grayn<8: fp[x,y]=(0,0,0,0)
        seen=[[False]*FW for _ in range(FH)]
        for y in range(360,760):
            for x in range(380,700):
                if fp[x,y][3]>0 and not seen[y][x]:
                    q=deque([(x,y)]); seen[y][x]=True; comp=[(x,y)]; allin=True
                    while q:
                        cx2,cy2=q.popleft()
                        if not inner[cy2][cx2]: allin=False
                        for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
                            ax,ay=cx2+dx,cy2+dy
                            if 0<=ax<FW and 0<=ay<FH and fp[ax,ay][3]>0 and not seen[ay][ax]:
                                seen[ay][ax]=True; q.append((ax,ay)); comp.append((ax,ay))
                    if allin and len(comp)<60:
                        for cx2,cy2 in comp: fp[cx2,cy2]=(0,0,0,0)
        fr.save(f'{DST}/hairfront_{sid}.png')
        if bk.getbbox(): bk.save(hbp)
        elif os.path.exists(hbp): os.remove(hbp)
        print(f'polish {sid}: done')

if __name__=='__main__':
    run(sys.argv[1] if len(sys.argv)>1 else '~/Downloads/face.png')
    polish([s for s in STYLES.values() if s!='base'])

def fit_hair_part(src_png, sid):
    """§H方式（髪パーツ単体・固定キャンバス）の取り込み: 緑キー→720x840→サイド+頭頂カバレッジ最適化→保存。
    2026-07-05確立。使い方: fit_hair_part('~/Desktop/ChatGPT Image ....png','buzz')"""
    im=Image.open(os.path.expanduser(src_png)).convert('RGB')
    part=key_green(im).resize((FW,FH),Image.NEAREST)
    face=Image.open(DST+'/face_oval.png').convert('RGBA'); fa=face.load()
    hp=part.load()
    fedge={}; hedge={}
    for y in range(50,340):
        fl=fr=None
        for x in range(FW):
            if fa[x,y][3]>40:
                if fl is None: fl=x
                fr=x
        if fl is not None: fedge[y]=(fl,fr)
    for y in range(20,520):
        hl=hr=None
        for x in range(FW):
            if hp[x,y][3]>0:
                if hl is None: hl=x
                hr=x
        if hl is not None: hedge[y]=(hl,hr)
    if not hedge: print('!! empty part'); return
    htop=min(hedge); ftop=min(fedge)
    def cost(s,dx,dy):
        c=0;n=0
        for y in range(90,300,10):
            hy=int(round((y-dy)/s))
            if hy not in hedge or y not in fedge: continue
            hl,hr=hedge[hy]; fl,fr=fedge[y]
            c+=abs(hl*s+dx-fl-4)+abs(fr-(hr*s+dx)-4); n+=1
        if n<10: return 1e9
        return c/n + 2.0*abs(htop*s+dy-(ftop+6))
    best=None
    for si in range(-6,7):
        s=1.0+si*0.01
        for dx in range(-25,30):
            for dy in range(-70,15):
                v=cost(s,dx,dy)
                if best is None or v<best[0]: best=(v,s,dx,dy)
    _,s,dx,dy=best
    print(f'{sid}: fit cost={best[0]:.1f} s={s:.2f} dx={dx} dy={dy}')
    sc=part.resize((int(FW*s),int(FH*s)),Image.NEAREST) if s!=1.0 else part
    cv=Image.new('RGBA',(FW,FH),(0,0,0,0)); cv.paste(sc,(int(dx),int(dy)),sc)
    cv.save(f'{DST}/hairfront_{sid}.png')
    hb=f'{DST}/hairback_{sid}.png'
    if os.path.exists(hb): os.remove(hb)
    print('saved', f'hairfront_{sid}.png', cv.getbbox())

def diff_extract_hair(src_png, sid, ycut_ratio=0.42, thr=90):
    """【最終確定レシピ 2026-07-05】edit方式(顔に描き足し)の出力から差分で髪を抽出。
    editは顔をほぼ完全保存(輪郭一致~1.002)するため「出力-ベース顔=髪」が成立。
    角度/位置/デザインは構造的に一致＝ユーザーの微調整不要。
    手順: ①ベースを頭蓋幅で出力空間へ整列 ②画素差分(閾値thr) ③頭頂バンド連結成分のみ
    ④輪郭リング近傍(8px)かつ目線(ycut)より下の差分は除外(editの輪郭1-2pxズレ由来の髭状帯対策)
    ⑤ネイティブ解像度のままマスク→箱型平均で720x840へ縮小(coverage>0.45)＝点描が潰れない。"""
    from collections import deque
    out=Image.open(os.path.expanduser(src_png)).convert('RGB'); W,H=out.size
    base=Image.open(os.path.expanduser('~/Downloads/base_face_for_batch.png')).convert('RGB')
    ok=key_green(out); bk=key_green(base)
    oW,oCx,oTop=skull_info(ok); bW,bCx,bTop=skull_info(bk)
    s=oW/bW
    bigbase=base.resize((int(720*s),int(840*s)),Image.NEAREST)
    off=(int(round(oCx-bCx*s)), int(round(oTop-bTop*s)))
    canvas=Image.new('RGB',(W,H),(0,255,0)); canvas.paste(bigbase,off)
    cb=canvas.load(); op=out.load()
    def isg(p): r,g,b=p; return g>110 and g>r+40 and g>b+40
    facem=[[not isg(cb[x,y]) for x in range(W)] for y in range(H)]
    ring=[[False]*W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            if facem[y][x]:
                for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
                    nx,ny=x+dx,y+dy
                    if not(0<=nx<W and 0<=ny<H) or not facem[ny][nx]: ring[y][x]=True; break
    for it in range(8):
        nxt=[row[:] for row in ring]
        for y in range(1,H-1):
            for x in range(1,W-1):
                if ring[y][x]: nxt[y-1][x]=nxt[y+1][x]=nxt[y][x-1]=nxt[y][x+1]=True
        ring=nxt
    YCUT=int(H*ycut_ratio)
    mask=[[False]*W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            p=op[x,y]
            if isg(p): continue
            br,bg,bb=cb[x,y]
            if abs(p[0]-br)+abs(p[1]-bg)+abs(p[2]-bb)<=thr: continue
            if y>YCUT and ring[y][x]: continue
            mask[y][x]=True
    band=oTop+int((H*0.55-oTop)*0.35)
    seen=[[False]*W for _ in range(H)]; keep=[[False]*W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            if mask[y][x] and not seen[y][x]:
                q=deque([(x,y)]); seen[y][x]=True; comp=[(x,y)]; touch=False
                while q:
                    cx,cy=q.popleft()
                    if cy<=band: touch=True
                    for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
                        nx,ny=cx+dx,cy+dy
                        if 0<=nx<W and 0<=ny<H and mask[ny][nx] and not seen[ny][nx]:
                            seen[ny][nx]=True; q.append((nx,ny)); comp.append((nx,ny))
                if touch and len(comp)>=200:
                    for cx,cy in comp: keep[cy][cx]=True
    part=Image.new('RGBA',(FW,FH),(0,0,0,0)); pp=part.load()
    sx=W/FW; sy=H/FH
    for Y in range(FH):
        y0=int(Y*sy); y1=max(y0+1,int((Y+1)*sy))
        for X in range(FW):
            x0=int(X*sx); x1=max(x0+1,int((X+1)*sx))
            tot=cnt=rs=gs=bs=0
            for y in range(y0,y1):
                row=keep[y]
                for x in range(x0,x1):
                    tot+=1
                    if row[x]:
                        cnt+=1; r,g,b=op[x,y]; rs+=r; gs+=g; bs+=b
            if tot and cnt/tot>0.45:
                pp[X,Y]=(rs//cnt,gs//cnt,bs//cnt,255)
    part.save(f'{DST}/hairfront_{sid}.png')
    hb=f'{DST}/hairback_{sid}.png'
    if os.path.exists(hb): os.remove(hb)
    print(f'{sid}: diff-extracted, bbox', part.getbbox())


def iris_centers2(img):
    """オレンジ虹彩の左右中心 [(lx,ly),(rx,ry)]。連結成分の最大2塊=虹彩（鼻のオレンジハイライト等の小塊を除外）。"""
    from collections import deque
    W,H=img.size; px=img.load()
    m=[[False]*W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            r,g,b,a=px[x,y]
            if a>30 and is_orange(r,g,b): m[y][x]=True
    seen=[[False]*W for _ in range(H)]; comps=[]
    for y in range(H):
        for x in range(W):
            if m[y][x] and not seen[y][x]:
                q=deque([(x,y)]); seen[y][x]=True; comp=[(x,y)]
                while q:
                    cx,cy=q.popleft()
                    for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
                        nx,ny=cx+dx,cy+dy
                        if 0<=nx<W and 0<=ny<H and m[ny][nx] and not seen[ny][nx]:
                            seen[ny][nx]=True; q.append((nx,ny)); comp.append((nx,ny))
                comps.append(comp)
    comps.sort(key=len, reverse=True)
    if len(comps)<2 or len(comps[1])<12: return None
    a,b=comps[0],comps[1]
    c=lambda g:(sum(p[0] for p in g)/len(g),sum(p[1] for p in g)/len(g))
    ca,cb=c(a),c(b)
    return [ca,cb] if ca[0]<cb[0] else [cb,ca]

def make_head(src_png, sid):
    """【頭部一体方式 2026-07-05】editフル頭出力から head_<sid>.png を生成。
    緑キー→頭蓋幅で正準整列→灰色×頭頂連結で髪抽出→face_oval(顔なしベース)に合成=髪の生えた頭1パーツ。
    目/口は含まない(別レイヤーが上に乗る)。二重リカラー(dualTinted)で肌/髪を別色化。"""
    out=Image.open(os.path.expanduser(src_png)).convert('RGB')
    cell=key_green(out)
    face=Image.open(DST+'/face_oval.png').convert('RGBA')
    # 整列=顔領域の画素マッチング（2026-07-05最終）: editは顔を保存する→ベース顔と一致する(s,dx,dy)を探索。
    # 特徴点検出(虹彩等)は粗スタイルの肌オレンジで誤検出するため全廃。照合域=髪に隠れない顔中央部。
    base=Image.open(os.path.expanduser('~/Downloads/base_face_for_batch.png')).convert('RGB')
    bpx=base.load(); cpx=cell.load(); W,H=cell.size
    def isg3(r,g,b): return g>110 and g>r+40 and g>b+40
    def cost(s,dx,dy):
        c=0;n=0
        for py in range(300,620,6):
            for px_ in range(300,640,6):
                br,bg,bb=bpx[px_,py]
                if isg3(br,bg,bb): continue
                sx=int((px_-dx)/s); sy=int((py-dy)/s)
                if not(0<=sx<W and 0<=sy<H): return 1e18
                p=cpx[sx,sy]
                if p[3]<8: c+=200; n+=1; continue
                c+=abs(p[0]-br)+abs(p[1]-bg)+abs(p[2]-bb); n+=1
        return c/max(1,n)
    s0=FW/W
    best=None
    for si in (0.94,0.97,1.0,1.03,1.06):
        s=s0*si
        for dx in range(-30,31,6):
            for dy in range(-30,31,6):
                v=cost(s,dx,dy)
                if best is None or v<best[0]: best=(v,s,dx,dy)
    _,s,dx,dy=best
    for ds in (-0.02,-0.01,0,0.01,0.02):           # 微細化
        for ddx in range(-4,5,2):
            for ddy in range(-4,5,2):
                v=cost(s0*(s/s0+ds),dx+ddx,dy+ddy)
                if v<best[0]: best=(v,s0*(s/s0+ds),dx+ddx,dy+ddy)
    _,s,dx,dy=best
    print(f'{sid}: face-match s={s:.4f} dx={dx} dy={dy} cost={best[0]:.1f}')
    al=place(cell,s,(dx,dy))
    hm,n=hair_mask_topo(al)
    head=face.copy(); head.alpha_composite(hm)
    head.save(f'{DST}/head_{sid}.png')
    print(f'head_{sid}: hair_px={n} saved')

def make_beard(src_png, bid='full', warm=False):
    """粗スタイル髭パーツ: editフルビアード出力から差分抽出（face-match整列→ベースと違う低彩度画素・下顔のみ）。
    warm=True: 無精髭など肌に混ざる淡い点描用。輪郭リング8px＋口周りを除外した上で、
    暖色でもdiff>90なら捕捉しグレー化して保存（リカラー互換）。"""
    out=Image.open(os.path.expanduser(src_png)).convert('RGB')
    cell=key_green(out)
    base=Image.open(os.path.expanduser('~/Downloads/base_face_for_batch.png')).convert('RGB')
    bpx=base.load(); cpx=cell.load(); W,H=cell.size
    def isg3(r,g,b): return g>110 and g>r+40 and g>b+40
    def cost(s,dx,dy):
        c=0;n=0
        for py in range(300,620,6):
            for px_ in range(300,640,6):
                br,bg,bb=bpx[px_,py]
                if isg3(br,bg,bb): continue
                sx=int((px_-dx)/s); sy=int((py-dy)/s)
                if not(0<=sx<W and 0<=sy<H): return 1e18
                p=cpx[sx,sy]
                if p[3]<8: c+=200; n+=1; continue
                c+=abs(p[0]-br)+abs(p[1]-bg)+abs(p[2]-bb); n+=1
        return c/max(1,n)
    s0=FW/W; best=None
    for si in (0.94,0.97,1.0,1.03,1.06):
        s=s0*si
        for dx in range(-30,31,6):
            for dy in range(-30,31,6):
                v=cost(s,dx,dy)
                if best is None or v<best[0]: best=(v,s,dx,dy)
    _,s,dx,dy=best
    for ds in (-0.02,-0.01,0,0.01,0.02):
        for ddx in range(-4,5,2):
            for ddy in range(-4,5,2):
                v=cost(s0*(s/s0+ds),dx+ddx,dy+ddy)
                if v<best[0]: best=(v,s0*(s/s0+ds),dx+ddx,dy+ddy)
    _,s,dx,dy=best
    print(f'beard: face-match s={s:.4f} dx={dx} dy={dy} cost={best[0]:.1f}')
    al=place(cell,s,(dx,dy))
    ap=al.load(); bp2=base.load()
    ring=mouth=None
    if warm:
        from PIL import ImageFilter
        gm=Image.new('L',(FW,FH),0); gp=gm.load()
        dm=Image.new('L',(FW,FH),0); dp=dm.load()
        for y in range(FH):
            for x in range(FW):
                br,bg,bb=bp2[x,y]
                if isg3(br,bg,bb): gp[x,y]=255
                elif y>int(FH*0.50) and br+bg+bb<240: dp[x,y]=255
        ring=gm.filter(ImageFilter.MaxFilter(17)).load()   # 輪郭リング=緑から8px以内
        mouth=dm.filter(ImageFilter.MaxFilter(9)).load()   # 口・鼻孔など暗部から4px以内
        earx=int(FW*0.42); eary=int(FH*0.57)               # 左耳ゾーン(x<305/y<478)＝顔ズレ時にwarmが耳の肌色差分を誤検出→除外(髭本体は口y>540なので無影響)
    part=Image.new('RGBA',(FW,FH),(0,0,0,0)); pp=part.load(); n=0
    for y in range(int(FH*0.42),FH):
        for x in range(FW):
            r,g,b,a=ap[x,y]
            if a<30: continue
            br,bg,bb=bp2[x,y]
            d=abs(r-br)+abs(g-bg)+abs(b-bb)
            if d<=60: continue
            lowsat=(max(r,g,b)-min(r,g,b))<=36 and (r-b)<=28
            if not warm:
                if lowsat: pp[x,y]=(r,g,b,255); n+=1
                continue
            if ring[x,y] or mouth[x,y]: continue
            if x<earx and y<eary: continue   # 左耳ゾーン除外
            if lowsat or d>90:
                L=int(0.299*r+0.587*g+0.114*b)
                pp[x,y]=(L,L,L,255); n+=1
    part.save(f'{DST}/beard_{bid}.png')
    print(f'beard_{bid}: px={n} saved')

def snap_beard_grid(bid, G=10, cov=0.40):
    """髭パーツを粗アートの10px格子へスナップ: セル被覆率>=covで採用しブロック塗り・孤立セル除去。
    ピクセル単位の差分抽出はエッジに欠けピクセルが残りギザギザに見える→ブロック単位に量子化して画風と揃える。"""
    p=Image.open(f'{DST}/beard_{bid}.png').convert('RGBA'); px=p.load(); W,H=p.size
    gw,gh=W//G,H//G
    keep={}
    for gy in range(gh):
        for gx in range(gw):
            cols=[]
            for y in range(gy*G,gy*G+G):
                for x in range(gx*G,gx*G+G):
                    if px[x,y][3]>0: cols.append(px[x,y])
            if len(cols)>=cov*G*G:
                cols.sort(key=lambda c:c[0]+c[1]+c[2])
                keep[(gx,gy)]=cols[len(cols)//2]   # 中央輝度の色=セル代表色（市松の明暗を保持）
    # 小さな連結成分（浮き島）を除去=本体だけ残す
    seen=set(); comps=[]
    for k in keep:
        if k in seen: continue
        st=[k]; comp=[]
        while st:
            c=st.pop()
            if c in seen: continue
            seen.add(c); comp.append(c)
            for dx in(-1,0,1):
                for dy in(-1,0,1):
                    n=(c[0]+dx,c[1]+dy)
                    if n in keep and n not in seen: st.append(n)
        comps.append(comp)
    big=max(len(c) for c in comps) if comps else 0
    keep={k:keep[k] for comp in comps if len(comp)>=max(6,big*0.1) for k in comp}
    out=Image.new('RGBA',(W,H),(0,0,0,0)); op=out.load()
    for (gx,gy),c in keep.items():
        for y in range(gy*G,gy*G+G):
            for x in range(gx*G,gx*G+G):
                op[x,y]=(c[0],c[1],c[2],255)
    out.save(f'{DST}/beard_{bid}.png')
    print(f'beard_{bid}: grid-snap cells={len(keep)}')

def make_eyes(src_png, eid, brow_split=320):
    """目バリエーション: ChatGPT edit出力(目の形だけ変えた顔)から目領域を抽出し eyes_<eid>.png を作る。
    眉は eyes_normal.png で上書き＝全バリエーション共通固定。face-match整列→目footprint×目色フィルタ→小島除去。"""
    from PIL import ImageFilter
    from collections import deque
    res=Image.open(os.path.expanduser(src_png)).convert('RGB'); cell=key_green(res); W,H=cell.size
    base=Image.open(os.path.expanduser('~/Downloads/base_face_for_batch.png')).convert('RGB')
    bpx=base.load(); cpx=cell.load()
    def isg(r,g,b): return g>110 and g>r+40 and g>b+40
    def cost(s,dx,dy):
        c=nn=0
        for py in range(300,640,7):
            for px_ in range(280,660,7):
                if 300<py<410 and 320<px_<600: continue   # 変化部(目)を避けて整列
                br,bg,bb=bpx[px_,py]
                if isg(br,bg,bb): continue
                sx=int((px_-dx)/s); sy=int((py-dy)/s)
                if not(0<=sx<W and 0<=sy<H): return 1e18
                p=cpx[sx,sy]
                if p[3]<8: c+=200; nn+=1; continue
                c+=abs(p[0]-br)+abs(p[1]-bg)+abs(p[2]-bb); nn+=1
        return c/max(1,nn)
    s0=FW/W; best=None
    for si in (0.94,0.97,1.0,1.03,1.06):
        s=s0*si
        for dx in range(-30,31,6):
            for dy in range(-30,31,6):
                v=cost(s,dx,dy)
                if best is None or v<best[0]: best=(v,s,dx,dy)
    _,s,dx,dy=best
    for ds in (-0.02,-0.01,0,0.01,0.02):
        for ddx in range(-4,5,2):
            for ddy in range(-4,5,2):
                v=cost(s0*(s/s0+ds),dx+ddx,dy+ddy)
                if v<best[0]: best=(v,s0*(s/s0+ds),dx+ddx,dy+ddy)
    _,s,dx,dy=best
    print(f'eyes {eid}: face-match s={s:.4f} dx={dx} dy={dy} cost={best[0]:.1f}')
    al=place(cell,s,(dx,dy)); ap=al.load()
    en=Image.open(f'{DST}/eyes_normal.png').convert('RGBA'); enp=en.load()
    mask=en.split()[3].filter(ImageFilter.MaxFilter(13)).load()
    def eyecol(r,g,b):
        if r+g+b<250: return True                     # 黒(まぶた/瞳/眉)
        if r>180 and g>180 and b>165: return True     # 白目
        if r>140 and (r-b)>105 and b<105: return True # 虹彩(橙/琥珀)
        return False
    out=Image.new('RGBA',(FW,FH),(0,0,0,0)); op=out.load()
    for y in range(FH):
        for x in range(FW):
            if y<brow_split:
                if enp[x,y][3]>8: op[x,y]=enp[x,y]     # 眉=元のまま固定
            elif mask[x,y]>40:
                r,g,b,a=ap[x,y]
                if a>40 and eyecol(r,g,b): op[x,y]=(r,g,b,255)
    seen=[[False]*FW for _ in range(FH)]
    def oa(x,y): return 0<=x<FW and 0<=y<FH and op[x,y][3]>0
    for y in range(FH):
        for x in range(FW):
            if oa(x,y) and not seen[y][x]:
                q=deque([(x,y)]); seen[y][x]=True; comp=[]
                while q:
                    cx,cy=q.popleft(); comp.append((cx,cy))
                    for ax in(-1,0,1):
                        for ay in(-1,0,1):
                            nx,ny=cx+ax,cy+ay
                            if oa(nx,ny) and not seen[ny][nx]: seen[ny][nx]=True; q.append((nx,ny))
                if len(comp)<25:
                    for cx,cy in comp: op[cx,cy]=(0,0,0,0)
    out.save(f'{DST}/eyes_{eid}.png')
    print(f'eyes_{eid}.png saved')
