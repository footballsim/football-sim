# -*- coding: utf-8 -*-
"""CMUモーキャップ(関節ワールド座標) → pose-figure/sprite-studio の関節角(XYZオイラー・度)へ変換。

★ なぜ位置ではなく角度で移すか: CMUの被験者とうちの人形はプロポーションが違う。位置をそのまま
  当てると骨の長さが変わって破綻する。**各ボーンが向いている方向**だけを移せば体格差を吸収できる。
★ 各関節のローカル回転 = 「静止時の子オフセット方向」を「CMUでの実際の方向」へ最小回転で合わせる。
  親から順に解くので、親の回転が決まってから子を解く（前向き運動学と同じ順）。
★ ボーン軸まわりのねじれは落ちる（方向一致だけでは決まらない）。ひざ・ひじの曲がる向きは
  腿とすねの2本の方向が両方合うことで決まるので、実用上は問題にならない。
★ 最後に可動域でクランプ（膝の逆曲がりを二度と出さないため）。
"""
import json, math, sys, os
import numpy as np

# pose-figure / sprite-studio と同一の骨格（_3d_lab.html の JOINT_DEFS と同じ値）
JOINTS = [
    ('root', None, (0, 0.92, 0)), ('spine', 'root', (0, 0.13, 0)), ('chest', 'spine', (0, 0.13, 0)),
    ('neck', 'chest', (0, 0.22, 0)), ('head', 'neck', (0, 0.09, 0)),
    ('clavicleL', 'chest', (0.05, 0.17, 0)), ('shoulderL', 'clavicleL', (0.14, 0.02, 0)),
    ('elbowL', 'shoulderL', (0, -0.285, 0)), ('wristL', 'elbowL', (0, -0.245, 0)),
    ('clavicleR', 'chest', (-0.05, 0.17, 0)), ('shoulderR', 'clavicleR', (-0.14, 0.02, 0)),
    ('elbowR', 'shoulderR', (0, -0.285, 0)), ('wristR', 'elbowR', (0, -0.245, 0)),
    ('hipL', 'root', (0.095, -0.03, 0)), ('kneeL', 'hipL', (0, -0.42, 0)), ('ankleL', 'kneeL', (0, -0.40, 0)),
    ('hipR', 'root', (-0.095, -0.03, 0)), ('kneeR', 'hipR', (0, -0.42, 0)), ('ankleR', 'kneeR', (0, -0.40, 0)),
]
PARENT = {n: p for n, p, _ in JOINTS}
OFFSET = {n: np.array(o, float) for n, _, o in JOINTS}
CHILDREN = {}
for n, p, _ in JOINTS:
    CHILDREN.setdefault(p, []).append(n)

# 「この関節の向きは、CMUのどのボーン（始点→終点）で決まるか」
#   ★ JSONの各CMU関節の座標は**そのボーンの終点**。lclavicle=肩, lhumerus=ひじ, lradius=手首。
DRIVE = {
    'spine':     ('lowerback', 'upperback'), 'chest': ('upperback', 'thorax'),
    'neck':      ('lowerneck', 'upperneck'),
    'clavicleL': ('thorax', 'lclavicle'),    'shoulderL': ('lclavicle', 'lhumerus'),
    'elbowL':    ('lhumerus', 'lradius'),
    'clavicleR': ('thorax', 'rclavicle'),    'shoulderR': ('rclavicle', 'rhumerus'),
    'elbowR':    ('rhumerus', 'rradius'),
    'hipL':      ('lhipjoint', 'lfemur'),    'kneeL': ('lfemur', 'ltibia'), 'ankleL': ('ltibia', 'lfoot'),
    'hipR':      ('rhipjoint', 'rfemur'),    'kneeR': ('rfemur', 'rtibia'), 'ankleR': ('rtibia', 'rfoot'),
}
# 向きを決める子（ローカルの静止方向として使うオフセット）。足首は子が無いので仮想の足先を置く。
DRIVE_CHILD = {'spine': 'chest', 'chest': 'neck', 'neck': 'head',
               'clavicleL': 'shoulderL', 'shoulderL': 'elbowL', 'elbowL': 'wristL',
               'clavicleR': 'shoulderR', 'shoulderR': 'elbowR', 'elbowR': 'wristR',
               'hipL': 'kneeL', 'kneeL': 'ankleL', 'hipR': 'kneeR', 'kneeR': 'ankleR'}
VIRTUAL = {'ankleL': np.array([0, -0.03, 0.10]), 'ankleR': np.array([0, -0.03, 0.10])}

LIMITS = {'hip': (-115, 35), 'knee': (0, 150), 'ankle': (-35, 45),
          'shoulder': (-160, 70), 'elbow': (-150, 0)}

def unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else np.array([0.0, -1.0, 0.0])

def q_between(a, b):
    """a を b へ移す最小回転（クォータニオン xyzw）。"""
    a, b = unit(a), unit(b)
    d = float(np.dot(a, b))
    if d > 0.999999: return np.array([0, 0, 0, 1.0])
    if d < -0.999999:
        axis = np.cross(a, [1, 0, 0])
        if np.linalg.norm(axis) < 1e-6: axis = np.cross(a, [0, 0, 1])
        axis = unit(axis)
        return np.array([axis[0], axis[1], axis[2], 0.0])
    c = np.cross(a, b); s = math.sqrt((1 + d) * 2)
    return np.array([c[0] / s, c[1] / s, c[2] / s, s / 2])

def q_mul(p, q):
    x1,y1,z1,w1 = p; x2,y2,z2,w2 = q
    return np.array([w1*x2+x1*w2+y1*z2-z1*y2, w1*y2-x1*z2+y1*w2+z1*x2,
                     w1*z2+x1*y2-y1*x2+z1*w2, w1*w2-x1*x2-y1*y2-z1*z2])

def q_mat(q):
    x,y,z,w = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                     [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                     [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])

def q_from_mat(m):
    t = m[0,0]+m[1,1]+m[2,2]
    if t > 0:
        s = math.sqrt(t+1)*2
        return np.array([(m[2,1]-m[1,2])/s, (m[0,2]-m[2,0])/s, (m[1,0]-m[0,1])/s, 0.25*s])
    i = int(np.argmax([m[0,0], m[1,1], m[2,2]]))
    if i == 0:
        s = math.sqrt(1+m[0,0]-m[1,1]-m[2,2])*2
        return np.array([0.25*s, (m[0,1]+m[1,0])/s, (m[0,2]+m[2,0])/s, (m[2,1]-m[1,2])/s])
    if i == 1:
        s = math.sqrt(1+m[1,1]-m[0,0]-m[2,2])*2
        return np.array([(m[0,1]+m[1,0])/s, 0.25*s, (m[1,2]+m[2,1])/s, (m[0,2]-m[2,0])/s])
    s = math.sqrt(1+m[2,2]-m[0,0]-m[1,1])*2
    return np.array([(m[0,2]+m[2,0])/s, (m[1,2]+m[2,1])/s, 0.25*s, (m[1,0]-m[0,1])/s])

def euler_xyz(q):
    """three.js の Euler('XYZ') と同じ抽出（度）。"""
    m = q_mat(q)
    y = math.asin(max(-1, min(1, m[0,2])))
    if abs(m[0,2]) < 0.99999:
        x = math.atan2(-m[1,2], m[2,2]); z = math.atan2(-m[0,1], m[0,0])
    else:
        x = math.atan2(m[2,1], m[1,1]); z = 0.0
    return [math.degrees(x), math.degrees(y), math.degrees(z)]

def clamp_rot(name, e):
    base = name.rstrip('LR') if name[-1] in 'LR' else name
    lim = LIMITS.get(base)
    if lim: e[0] = max(lim[0], min(lim[1], e[0]))
    return [round(v, 2) for v in e]

def retarget_frame(names, F):
    P = {n: np.array(F[i], float) for i, n in enumerate(names)}
    # 骨盤の姿勢: 上=root→lowerback / 左=右腰→左腰。うちの人形は +X=左, +Y=上, +Z=前。
    up = unit(P['lowerback'] - P['root'])
    left = P['lhipjoint'] - P['rhipjoint']
    left = unit(left - np.dot(left, up) * up)
    fwd = np.cross(left, up)

    # ★ 全体の向き（ヨー）を先に取り除いて常に +Z を向かせる。
    #   モーキャップは被験者が任意の方向を向いて走っているので、そのまま入れると人形が横や後ろを向く。
    #   sprite-studio は**カメラ固定**で撮る運用なので、向きが毎ポーズ変わると絵柄が揃わない。
    #   前傾・体側の傾きは残し、水平回転だけ相殺する。
    yaw = math.atan2(fwd[0], fwd[2])
    c, s = math.cos(-yaw), math.sin(-yaw)
    Ry = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    P = {k: Ry @ v for k, v in P.items()}
    up = Ry @ up; left = Ry @ left; fwd = Ry @ fwd
    Wroot = q_from_mat(np.column_stack([left, up, fwd]))
    W = {'root': Wroot}
    rot = {'root': clamp_rot('root', euler_xyz(Wroot))}
    for name, parent, _ in JOINTS:
        if name == 'root': continue
        drv = DRIVE.get(name)
        if not drv:
            rot[name] = [0, 0, 0]; W[name] = W[parent]; continue
        a, b = drv
        d_world = unit(P[b] - P[a])
        rest = VIRTUAL.get(name)
        if rest is None: rest = OFFSET[DRIVE_CHILD[name]]
        t = q_mat(W[parent]).T @ d_world          # 親のローカル空間へ落とす
        q = q_between(unit(rest), t)
        W[name] = q_mul(W[parent], q)
        rot[name] = clamp_rot(name, euler_xyz(q))
    for n in ('head', 'wristL', 'wristR'):
        rot.setdefault(n, [0, 0, 0])
    return rot

def main(src, outdir, label, frames_sel):
    d = json.load(open(src))
    names = d['names']
    os.makedirs(outdir, exist_ok=True)
    made = []
    for k, fi in enumerate(frames_sel):
        rot = retarget_frame(names, d['frames'][fi])
        # ★ 顔まわりの形式は sprite-studio の既存ポーズに合わせる（型が違うと buildHand で落ちる）。
        #   gaze=[x,y] / mouth=MOUTHS の文字列 / hands=[左,右] の文字列2つ。
        pose = {'name': '%s_%02d' % (label, k + 1),
                'pose': {'rot': rot, 'gaze': [0.5, 0.5], 'mouth': '閉じた口', 'hands': ['グー', 'グー']},
                'source': {'db': 'CMU Graphics Lab Motion Capture Database', 'file': os.path.basename(src), 'frame': fi}}
        p = os.path.join(outdir, '%s_%02d.json' % (label, k + 1))
        json.dump(pose, open(p, 'w'), ensure_ascii=False, indent=1)
        made.append(p)
    print('wrote %d poses -> %s' % (len(made), outdir))
    return made

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3], [int(v) for v in sys.argv[4].split(',')])
