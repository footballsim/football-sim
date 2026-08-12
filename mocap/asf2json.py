import re, json, math, sys
import numpy as np

def rotm(ax, ay, az, order='XYZ'):
    """order='XYZ' は X→Y→Z の順に適用＝合成は Rz@Ry@Rx。"""
    a, b, c = map(math.radians, (ax, ay, az))
    Rx = np.array([[1,0,0],[0,math.cos(a),-math.sin(a)],[0,math.sin(a),math.cos(a)]])
    Ry = np.array([[math.cos(b),0,math.sin(b)],[0,1,0],[-math.sin(b),0,math.cos(b)]])
    Rz = np.array([[math.cos(c),-math.sin(c),0],[math.sin(c),math.cos(c),0],[0,0,1]])
    M = np.eye(3)
    for ch in order:                       # 先に書かれた軸から順に適用
        M = {'X':Rx,'Y':Ry,'Z':Rz}[ch] @ M
    return M

def parse_asf(path):
    txt = open(path).read()
    bones = {'root': {'dir': np.zeros(3), 'len': 0.0, 'C': np.eye(3), 'Cinv': np.eye(3), 'dof': ['rx','ry','rz']}}
    body = txt.split(':bonedata')[1].split(':hierarchy')[0]
    for blk in re.findall(r'begin(.*?)end', body, re.S):
        name = re.search(r'name\s+(\S+)', blk).group(1)
        d = [float(v) for v in re.search(r'direction\s+([-\d.eE\s]+)', blk).group(1).split()[:3]]
        ln = float(re.search(r'length\s+([-\d.eE]+)', blk).group(1))
        am = re.search(r'axis\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)\s+(\w+)', blk)
        C = rotm(float(am.group(1)), float(am.group(2)), float(am.group(3)), am.group(4))
        dm = re.search(r'dof\s+([a-z\s]+)', blk)
        dof = dm.group(1).split() if dm else []
        bones[name] = {'dir': np.array(d), 'len': ln, 'C': C, 'Cinv': np.linalg.inv(C), 'dof': dof}
    parent = {}
    hier = txt.split(':hierarchy')[1]
    for line in re.search(r'begin(.*?)end', hier, re.S).group(1).strip().splitlines():
        w = line.split()
        for ch in w[1:]:
            parent[ch] = w[0]
    return bones, parent

def parse_amc(path):
    frames, cur = [], None
    for line in open(path):
        line = line.strip()
        if not line or line.startswith('#') or line.startswith(':'): continue
        if re.fullmatch(r'\d+', line):
            cur = {}; frames.append(cur); continue
        w = line.split()
        if cur is not None: cur[w[0]] = [float(v) for v in w[1:]]
    return frames

def convert(asf, amc, out, step=4, maxf=400):
    bones, parent = parse_asf(asf)
    frames = parse_amc(amc)[::step][:maxf]
    names = ['root'] + [n for n in bones if n != 'root']
    idx = {n: i for i, n in enumerate(names)}
    par = [-1] + [idx[parent.get(n, 'root')] for n in names[1:]]
    SCALE = (1.0/0.45) * 2.54/100.0        # CMU単位 → メートル
    out_frames = []
    for fr in frames:
        G, P = {}, {}
        rv = fr.get('root', [0,0,0,0,0,0])
        G['root'] = rotm(rv[3], rv[4], rv[5])
        P['root'] = np.array(rv[0:3]) * SCALE
        for n in names[1:]:
            b = bones[n]; p = parent.get(n, 'root')
            vals = fr.get(n, [])
            rx = ry = rz = 0.0
            for k, dn in enumerate(b['dof']):
                if k < len(vals):
                    if dn == 'rx': rx = vals[k]
                    elif dn == 'ry': ry = vals[k]
                    elif dn == 'rz': rz = vals[k]
            L = b['C'] @ rotm(rx, ry, rz) @ b['Cinv']
            G[n] = G[p] @ L
            P[n] = P[p] + G[n] @ (b['dir'] * b['len'] * SCALE)
        out_frames.append([[round(float(P[n][i]), 4) for i in range(3)] for n in names])
    # 足元を y=0 に、根を原点へ寄せる
    ys = [p[1] for f in out_frames for p in f]
    miny = min(ys)
    for f in out_frames:
        for p in f: p[1] = round(p[1] - miny, 4)
    json.dump({'names': names, 'parents': par, 'fps': 120.0/step, 'frames': out_frames},
              open(out, 'w'), separators=(',', ':'))
    print(out, 'joints=%d frames=%d' % (len(names), len(out_frames)))

convert('09.asf', '09_01.amc', 'mocap_run.json', step=4)
convert('10.asf', '10_06.amc', 'mocap_kick.json', step=4)
