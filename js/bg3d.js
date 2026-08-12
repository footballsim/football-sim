/* ══ BG3D-01 ローポリ3Dスタジアム背景（ラボ限定・2026-07-28）══════════════════════
 * 潜水艦ゲーム(DEEP SIX)の技法をそのまま採用:
 *   ①ローポリ（箱と板だけ・数十三角形）
 *   ②16色パレット固定。**グラデーション禁止**・階調はすべて4x4 Bayerディザで偽装する
 *   ③低解像度（480x216）で描画
 *   ④**ライティングを使わない**（MeshBasic）。陰影を計算するとパレット外の中間色が無数に生まれ、
 *     ディザの意味が消えて「ただの3D CG」の顔になる。あちらが16色に拘っていたのはこれが理由のはず。
 *
 * ★ 選手には使わない。変形・関節・表情があり picoCAD にはリギングが無い＝3D試作と同じ壁。
 *   使うのは**剛体で顔が無いもの**（ゴール/ネット/スタンド/ピッチ）＝潜水艦とまったく同条件。
 *
 * ★ ESM。three.js は importmap 経由。**このファイルは build.js の JS_FILES / LAB_ONLY_JS に入れない**
 *   ＝ビルド生成物には載らない。cutscene.js からは typeof ガードで window.CS_BG3D を呼ぶだけ。
 *   ラボ2ページ（_scene_lab.html / _bg3d_lab.html）が import して共有する（二重管理を避ける）。
 */
import * as THREE from 'three';

// 16色。増やすと一気に「普通の3D」の顔になるので、ここは増やさない。
export const PAL = [
  '#0b1220', '#1b2b45', '#2f4a6b', '#4a7ba7', '#8fc7ef', '#e8f4ff',
  '#123018', '#1e5a2a', '#2f8b3f', '#5fbf55', '#a8e06a',
  '#5a3a1e', '#a5702f', '#e0b45c', '#d9d2c2', '#c2453a'
];

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
/** 2色を市松（順序ディザ）で混ぜて中間色を偽装する。t が大きいほど cB の割合が増える。 */
function dither(x, cA, cB, t, gx, gy, w, h, cell) {
  for (let yy = 0; yy < h; yy += cell) {
    for (let xx = 0; xx < w; xx += cell) {
      x.fillStyle = (t > BAYER[(yy / cell) & 3][(xx / cell) & 3] / 16) ? cB : cA;
      x.fillRect(gx + xx, gy + yy, cell, cell);
    }
  }
}
function tex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;   // 拡大も縮小もNN＝ドットを保つ
  t.generateMipmaps = false;
  return t;
}

/* ── 芝 ────────────────────────────────────────────────────────────────
 * ★ 初版は帯の境目に2pxのディザを入れ、repeat も 10x14 と細かかった。遠景で縮小されると
 *   その高周波成分がジグザグ（シェブロン）に化けて「模様」として目立った（2026-07-28 実測）。
 *   芝は**低周波だけ**にする＝帯を太く・境目のディザは1px・repeatを粗く。 */
function makePitch() {
  const t = tex(64, 64, (x, w) => {
    for (let i = 0; i < 2; i++) {                      // 帯をさらに太く＝遠景でのジグザグ化を抑える
      const a = i % 2 ? '#1e5a2a' : '#2f8b3f';
      const b = i % 2 ? '#2f8b3f' : '#1e5a2a';
      x.fillStyle = a; x.fillRect(0, i * 32, w, 32);
      dither(x, a, b, 0.4, 0, i * 32 + 31, w, 1, 1);   // 境目を1pxだけ溶かす
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 5);
  return t;
}

/* ── 観客 ──────────────────────────────────────────────────────────────
 * ★ 人は 2x3px の塊を「行」に並べる。1pxで撒くとTVの砂嵐にしか見えない（実測）。
 * ★ 通路（縦の空き）と上段の暗がりを入れる。均一に敷き詰めるとテクスチャの繰り返しが見えてしまう。 */
function makeCrowd() {
  const t = tex(128, 56, (x, w, h) => {
    x.fillStyle = '#0b1220'; x.fillRect(0, 0, w, h);
    let s = 7; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const aisles = [18, 55, 92];                      // 通路の位置（人を置かない縦帯）
    for (let row = 0; row < 16; row++) {
      const y = 2 + row * 3.3, off = (row & 1) ? 1 : 0;
      /* ★ 「上段ほど暗く」を r = rnd() * dim で実装したら、上段は r の上限が下がって
       *   **常に最暗色**になり、スタンドが単色の壁に潰れた（2026-07-28 実測）。
       *   色の分布は保ったまま、暗く落とすかどうかを別の抽選にする。 */
      const dim = 1 - row / 28;
      for (let cx = 0; cx < w; cx += 3) {
        if (aisles.some(a => Math.abs(cx - a) < 3)) continue;
        if (rnd() < 0.12) continue;                    // 空席
        let r = rnd();
        if (rnd() > dim) r *= 0.6;                     // 上段ほど暗い側へ寄る（分布は潰さない）
        /* ★★ 2026-07-29 全面的に暗い側へ寄せ直した。
         *   旧配分は約40%が PAL[3] 以上（うち13%が明るい水色・7%が白/赤）で、**観客が主役より
         *   大きな声で喋っていた**。背景に必要なのは「情報量」であって「明度」ではない
         *   （引き画 WIDE-01 で同じ失敗をして確立した原則）。
         *   ★ 密度・空席・通路・行構造は一切変えない＝賑わいは保ったまま声量だけ落とす。
         *   ★ 16色は増やさない（増やすと一気に「普通の3D」の顔になる）。分布だけを変える。 */
        x.fillStyle = r < 0.46 ? '#0b1220' : r < 0.74 ? '#1b2b45' : r < 0.90 ? '#2f4a6b'
          : r < 0.965 ? '#4a7ba7' : (rnd() < 0.55 ? '#8fc7ef' : '#c2453a');
        x.fillRect(cx + off, y | 0, 2, 3);
      }
    }
    /* 屋根の落とす影。★ 7px の一段だけだと「線」に見える。段階を付けて上ほど深く沈めると、
     *   同じドット群が「群衆」でなく「屋根の下のスタンド」として読める（構造を先に見せる）。 */
    dither(x, '#0b1220', '#1b2b45', 0.30, 0, 12, w, 5, 1);
    dither(x, '#0b1220', '#1b2b45', 0.62, 0, 6, w, 6, 1);
    x.fillStyle = '#0b1220'; x.fillRect(0, 0, w, 6);
  });
  t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1);
  return t;
}

/* ── 広告ボード ────────────────────────────────────────────────────────
 * ★ 初版はここを「高さ3・ほぼ黒の板」にしていて、観客とピッチの間に**分厚い黒い空洞**が出来て
 *   ゴールが宙に浮いて見えた（2026-07-28 実測）。実物どおり薄く（高さ1.1）、明るい面にする。 */
function makeBoard() {
  return tex(64, 16, (x, w, h) => {
    x.fillStyle = '#2f4a6b'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 16) {                  // 看板の区切り
      x.fillStyle = (i / 16) % 2 ? '#4a7ba7' : '#1b2b45';
      x.fillRect(i, 2, 15, h - 5);
    }
    dither(x, '#0b1220', '#1b2b45', 0.5, 0, h - 3, w, 3, 1);      // 接地の締め
  });
}

/** ネット: 白い格子（アルファ抜き）。低解像度で潰れないよう線は1px。 */
function makeNet() {
  const t = tex(32, 32, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = '#d9d2c2';
    for (let i = 0; i < w; i += 4) x.fillRect(i, 0, 1, h);
    for (let j = 0; j < h; j += 4) x.fillRect(0, j, w, 1);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(9, 5);
  return t;
}

/* ── 画面端を落とす（レンダ後の2D側）─────────────────────────────────────
 * ★ 明るさの山は画面に1つだけ作る＝中央の主役へ視線が戻る。WIDE-01 で確立した処方。
 * ★ アルファのグラデーションは使えない（16色の外に中間色が無数に生まれ、ディザの意味が消える）
 *   ので、**最暗色 PAL[0] を Bayer ディザの割合で置いていく**＝このファイルの流儀を守る。 */
function edgeFall(x, w, h) {
  const band = Math.round(w * 0.22), cell = 2;
  for (const side of [0, 1]) {
    for (let i = 0; i < band; i += cell) {
      const t = Math.pow(1 - i / band, 1.6) * 0.72;       // 端ほど深い
      const gx = side ? (w - cell - i) : i;
      for (let yy = 0; yy < h; yy += cell) {
        if (t <= BAYER[(yy / cell) & 3][(i / cell) & 3] / 16) continue;
        x.fillStyle = PAL[0];
        x.fillRect(gx, yy, cell, cell);
      }
    }
  }
}

const flat = (c, o) => new THREE.MeshBasicMaterial(Object.assign({ color: c }, o || {}));
const mapped = (m, o) => new THREE.MeshBasicMaterial(Object.assign({ map: m }, o || {}));

/** スタジアムを組む。1 unit = 1m（ゴールは実寸 7.32 x 2.44）。 */
export function buildStadium() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL[4]);

  // ピッチ
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(70, 90), mapped(makePitch()));
  pitch.rotation.x = -Math.PI / 2; scene.add(pitch);

  /* スタンド。★ ゴール(z=-7)との距離を詰める（初版は z=-18 で遠すぎ、間が空洞に見えた）。
   *   広告ボード → 観客 → 屋根 の順に積み、境目はディザ済みテクスチャ側で処理する。 */
  const ZS = -13.5;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(70, 1.1), mapped(makeBoard()));
  board.position.set(0, 0.55, ZS); scene.add(board);
  const crowd = new THREE.Mesh(new THREE.PlaneGeometry(70, 9.5), mapped(makeCrowd()));
  crowd.position.set(0, 5.8, ZS - 0.6); scene.add(crowd);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(70, 1.6), flat(PAL[0]));
  roof.position.set(0, 11.3, ZS - 0.9); scene.add(roof);

  // ゴール（実寸）＋ネット
  const goal = new THREE.Group(); scene.add(goal);
  const white = flat(PAL[5]);
  [-3.66, 3.66].forEach(x => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.44, 0.14), white);
    m.position.set(x, 1.22, 0); goal.add(m);
  });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(7.46, 0.14, 0.14), white);
  bar.position.set(0, 2.44, 0); goal.add(bar);
  const netMat = mapped(makeNet(), { transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(7.32, 2.5), netMat);
  back.position.set(0, 1.25, -1.9); goal.add(back);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(7.32, 1.9), netMat);
  top.position.set(0, 2.42, -0.95); top.rotation.x = -Math.PI / 2 + 0.26; goal.add(top);
  [-3.66, 3.66].forEach(x => {
    const sd = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.44), netMat);
    sd.position.set(x, 1.22, -0.95); sd.rotation.y = Math.PI / 2; goal.add(sd);
  });
  goal.position.set(0, 0, -7);

  // 白線（ゴールライン＋ゴールエリア）
  const line = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), flat(PAL[5]));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z); scene.add(m);
  };
  line(60, 0.12, 0, -7);                    // ゴールライン
  line(18.32, 0.12, 0, -1.5);               // ペナルティエリア前線
  line(0.12, 5.5, -9.16, -4.25); line(0.12, 5.5, 9.16, -4.25);

  return scene;
}

/* ── cutscene.js から呼ばれる入口 ─────────────────────────────────────────
 * cam は「2D側で ctx に掛かっていた変換」から復元した値（zoom / panX,panY / mirror）。
 * これを3Dカメラのドリーと横移動へ写す＝2D側の寄りがそのまま**本物の視差**になる。
 * ★ 画角(fov)は変えずカメラを前後させる。fovを動かすと歪みが変化して酔う。 */
export function install(opts) {
  opts = opts || {};
  const W = opts.width || 480, H = opts.height || 216;
  let renderer = null, scene = null, camera = null;
  const EYE = opts.eye || [0, 2.3, 10.5];
  const TGT = opts.target || [0, 1.5, -7];
  const PX2W = opts.px2w || 0.055;          // canvas px → world（見た目で合わせた係数）
  const DOLLY = opts.dolly || 24;           // zoom=2 でどれだけ寄るか

  function ensure() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    renderer.setPixelRatio(1); renderer.setSize(W, H, false);
    scene = buildStadium();
    camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 200);
  }

  const api = {
    draw(ctx, w, h, cam) {
      ensure();
      const z = (cam && cam.zoom) || 1;
      const lat = -((cam && cam.panX) || 0) * PX2W;
      camera.position.set(EYE[0] + lat, EYE[1], EYE[2] - (1 - 1 / z) * DOLLY);
      camera.lookAt(TGT[0] + lat * 0.35, TGT[1], TGT[2]);
      renderer.render(scene, camera);
      ctx.save();
      if (cam && cam.mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(renderer.domElement, 0, 0, w, h);
      edgeFall(ctx, w, h);
      ctx.restore();
    },
    get renderer() { ensure(); return renderer; },
    get scene() { ensure(); return scene; },
    get camera() { ensure(); return camera; }
  };
  if (typeof window !== 'undefined') window.CS_BG3D = api;
  return api;
}
