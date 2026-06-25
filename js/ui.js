// =============================================
// W杯統計システム（Monte Carlo + Firebase）
// =============================================

// --- Firebase設定 ---
// Firebase Consoleでプロジェクト作成後、configをここに貼り付けてください
const WC_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBT4WBOZtwc_35lcxl4LTeX73EkQNtg5x4",
  authDomain: "football-simulator-4710f.firebaseapp.com",
  projectId: "football-simulator-4710f",
  storageBucket: "football-simulator-4710f.firebasestorage.app",
  messagingSenderId: "51109416821",
  appId: "1:51109416821:web:360842a4ee5081d2b38d3c"
};

let _wcFbDb = null;
function _getWCFbDb() {
  if (_wcFbDb) return _wcFbDb;
  if (!WC_FIREBASE_CONFIG.apiKey) return null;
  try {
    let app;
    try { app = firebase.app('wc-stats'); }
    catch(e) { app = firebase.initializeApp(WC_FIREBASE_CONFIG, 'wc-stats'); }
    _wcFbDb = firebase.firestore(app);
    return _wcFbDb;
  } catch(e) { console.warn('Firebase init error:', e); return null; }
}

function writeWCMatchResult(matchType, result, opponentName, resultType) {
  // デバッグモード（?debug=1）のテストプレイは集計を汚染しないよう書き込まない。
  // 例: ラウンドをジャンプして isWCFMode が残ったまま別の相手と対戦 → 「決勝 vs メキシコ」等の不整合データ防止。
  if (typeof DEBUG_MODE !== 'undefined' && DEBUG_MODE) return;
  const db = _getWCFbDb();
  if (!db) return;
  db.collection('wc_match_results').add({
    matchType, result, opponent: opponentName,
    resultType: resultType || 'regular', // 'regular' | 'et' | 'pk'
    ts: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(e => console.warn('Firebase write error:', e));
}

async function loadWCMatchResults() {
  const db = _getWCFbDb();
  if (!db) return null;
  try {
    const snap = await db.collection('wc_match_results').get();
    return snap.docs.map(d => d.data());
  } catch(e) { console.warn('Firebase read error:', e); return null; }
}

// --- Monte Carlo（固定勝率方式） ---
// simulateSilent 試合/対戦の平均値をハードコード。
// 毎回ランダム計測(CAL=50)だと分散が大きく1位/2位が逆転するため固定化。
// チームパラメータ変更時は calibrate_large.js で再計測してここを更新すること。

let _wcCalibCache = null; // 後方互換のため保持

function _calibrateWCRates() {
  return {
    // グループ 日本戦 (マレン採用後 N=2000)
    jp_nl: {w:0.244, d:0.370, l:0.386},
    jp_tn: {w:0.396, d:0.356, l:0.248},
    jp_sw: {w:0.481, d:0.335, l:0.184},
    // グループ 非日本戦
    nl_tn: {w:0.534, d:0.307, l:0.159},
    nl_sw: {w:0.600, d:0.298, l:0.102},
    tn_sw: {w:0.381, d:0.347, l:0.272},
    // ノックアウト（日本はjapan2026vsNetherlandsデータ使用）
    jp_mo: {w:0.451, d:0.335, l:0.214},
    jp_br: {w:0.298, d:0.360, l:0.342},
    jp_no: {w:0.414, d:0.346, l:0.240},
    jp_mx: {w:0.445, d:0.359, l:0.196},
    jp_sp: {w:0.246, d:0.359, l:0.395},
    jp_fr: {w:0.236, d:0.359, l:0.405},
    jp_ar: {w:0.283, d:0.359, l:0.358},
    jp_en: {w:0.246, d:0.350, l:0.404},
  };
}

function _mcSim(rates) {
  const r = Math.random();
  if (r < rates.w) return 1;
  if (r < rates.w + rates.d) return 0;
  return -1;
}

function _mcSimKO(rates) {
  const result = _mcSim(rates);
  if (result === 0) return Math.random() < 0.5 ? 1 : -1; // draw → PK
  return result;
}

// 新エンジン（運命の分岐, japanwc.js）に委譲。実ブラケットを全48チームで回し、
// 3位通過（各組3位の上位8）も反映する。これで「運命の分岐」と数字が一致する。
// 旧・固定勝率＋固定ブラケット方式は準々決勝以降を過小評価していた（対戦相手を最強シード固定にしていたため）。
function runWCMonteCarlo(N) {
  if (typeof jwcRunMC !== 'function') {  // 念のためのフォールバック（通常は到達しない）
    return {N, q1st:0,q2nd:0,q3rd:0,qFail:N, r32w:0,r16w:0,qfw:0,sfw:0,finw:0,
      vsNL:{w:0,d:0,l:0}, vsTN:{w:0,d:0,l:0}, vsSW:{w:0,d:0,l:0}};
  }
  const R2 = jwcRunMC(N);
  const S = R2.scenarios;
  const sum = f => f(S[1]) + f(S[2]) + f(S[3]);  // 全シナリオ（1/2/3位通過）の合算
  const A = (typeof JWC_ANCHOR !== 'undefined') ? JWC_ANCHOR : {};
  const grp = key => A[key] ? {w: Math.round(A[key].w * N), d: Math.round(A[key].d * N), l: Math.round(A[key].l * N)} : {w:0,d:0,l:0};
  return {
    N,
    vsNL: grp('netherlands2026'), vsTN: grp('tunisia2026'), vsSW: grp('sweden2026'),
    q1st: R2.rank[0], q2nd: R2.rank[1], q3rd: R2.thirdQual,
    qFail: N - R2.rank[0] - R2.rank[1] - R2.thirdQual,
    r32w: sum(s => s.reach.R16),  // 1回戦突破＝ベスト16到達
    r16w: sum(s => s.reach.QF),   // ベスト8到達
    qfw:  sum(s => s.reach.SF),   // ベスト4到達
    sfw:  sum(s => s.reach.F),    // 決勝進出
    finw: sum(s => s.champ)       // 優勝
  };
}

// --- 統計画面 ---
function showWCStats() {
  showScreen('worldcup-stats');
  switchStatsTab('mc');
  refreshMCStats();
}

function switchStatsTab(tab) {
  const isMC = tab === 'mc';
  const btnMC = document.getElementById('stats-tab-mc');
  const btnRe = document.getElementById('stats-tab-real');
  btnMC.style.background = isMC ? 'linear-gradient(135deg,#1a6bb5,#0d4a8a)' : 'transparent';
  btnMC.style.color = isMC ? '#fff' : 'rgba(255,255,255,0.45)';
  btnRe.style.background = !isMC ? 'linear-gradient(135deg,#1a7a3a,#0d5a2a)' : 'transparent';
  btnRe.style.color = !isMC ? '#fff' : 'rgba(255,255,255,0.45)';
  document.getElementById('stats-content-mc').style.display = isMC ? '' : 'none';
  document.getElementById('stats-content-real').style.display = !isMC ? '' : 'none';
  if (!isMC) loadRealStats();
}

function refreshMCStats() {
  const statusEl = document.getElementById('stats-mc-status');
  const resultEl = document.getElementById('stats-mc-result');
  statusEl.style.display = '';
  statusEl.textContent = t('wcStatsMCRunning1000');
  resultEl.style.display = 'none';
  setTimeout(() => {
    const R = runWCMonteCarlo(10000);
    const N = R.N;
    const pct = v => Math.round(v / N * 100);
    const bar = (v, color) => {
      const w = Math.max(0, Math.min(100, Math.round(v / N * 100)));
      return `<div style="height:5px;background:rgba(255,255,255,0.08);border-radius:3px;margin:3px 0 10px"><div style="height:100%;width:${w}%;background:${color||'linear-gradient(90deg,#1a6bb5,#27ae60)'};border-radius:3px;min-width:${v>0?2:0}px"></div></div>`;
    };
    const tri = r => `<span style="font-size:12px;font-weight:700;color:#4ade80">${pct(r.w)}%${t('wcStatsW')}</span>&nbsp;<span style="font-size:12px;color:#888">${pct(r.d)}%${t('wcStatsD')}</span>&nbsp;<span style="font-size:12px;color:#f87171">${pct(r.l)}%${t('wcStatsL')}</span>`;
    const qualified = R.q1st + R.q2nd + (R.q3rd || 0);
    const _koStages = t('wcStatsKOStages');
    const stages = [
      {lbl:_koStages[0], v:qualified,  color:'linear-gradient(90deg,#374151,#6b7280)'},
      {lbl:_koStages[1], v:R.r32w,     color:'linear-gradient(90deg,#1e3a5f,#2563eb)'},
      {lbl:_koStages[2], v:R.r16w,     color:'linear-gradient(90deg,#1a3a6b,#1a6bb5)'},
      {lbl:_koStages[3], v:R.qfw,      color:'linear-gradient(90deg,#0d4a8a,#0ea5e9)'},
      {lbl:_koStages[4], v:R.sfw,      color:'linear-gradient(90deg,#7c2d12,#ea580c)'},
      {lbl:_koStages[5], v:R.finw,     color:'linear-gradient(90deg,#78350f,#f59e0b)'}
    ];
    let html = `
    <div style="margin-bottom:20px">
      <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:10px;letter-spacing:1.5px;text-transform:uppercase">${t('wcStatsGLLabel')}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#fff;margin-bottom:2px"><span>${t('wcStatsGLNL')}</span>${tri(R.vsNL)}</div>${bar(R.vsNL.w)}
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#fff;margin-bottom:2px"><span>${t('wcStatsGLTN')}</span>${tri(R.vsTN)}</div>${bar(R.vsTN.w)}
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#fff;margin-bottom:2px"><span>${t('wcStatsGLSW')}</span>${tri(R.vsSW)}</div>${bar(R.vsSW.w)}
    </div>
    <div style="background:rgba(255,255,255,0.05);border-radius:12px;padding:14px;margin-bottom:20px">
      <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:12px;letter-spacing:1.5px;text-transform:uppercase">${t('wcStatsQualLabel')}</div>
      <div style="display:flex;gap:6px">
        <div style="flex:1;text-align:center;background:rgba(255,215,0,0.12);border-radius:8px;padding:9px 2px">
          <div style="font-size:20px;font-weight:900;color:#ffd700">${pct(R.q1st)}%</div>
          <div style="font-size:9.5px;color:rgba(255,255,255,0.5);margin-top:2px">${t('wcStatsQ1st')}</div>
        </div>
        <div style="flex:1;text-align:center;background:rgba(255,255,255,0.07);border-radius:8px;padding:9px 2px">
          <div style="font-size:20px;font-weight:900;color:#c0c0c0">${pct(R.q2nd)}%</div>
          <div style="font-size:9.5px;color:rgba(255,255,255,0.5);margin-top:2px">${t('wcStatsQ2nd')}</div>
        </div>
        <div style="flex:1;text-align:center;background:rgba(96,165,250,0.18);border-radius:8px;padding:9px 2px">
          <div style="font-size:20px;font-weight:900;color:#60a5fa">${pct(R.q3rd || 0)}%</div>
          <div style="font-size:9.5px;color:rgba(255,255,255,0.5);margin-top:2px">${window.LANG === 'en' ? '3rd' : '3位通過'}</div>
        </div>
        <div style="flex:1;text-align:center;background:rgba(74,222,128,0.16);border-radius:8px;padding:9px 2px">
          <div style="font-size:20px;font-weight:900;color:#4ade80">${pct(qualified)}%</div>
          <div style="font-size:9.5px;color:rgba(255,255,255,0.5);margin-top:2px">${t('wcStatsQRate')}</div>
        </div>
      </div>
      <div style="font-size:9.5px;color:rgba(255,255,255,0.4);text-align:center;margin-top:8px">${window.LANG === 'en' ? '* incl. best 8 third-placed teams (2026 format)' : '※ 各組3位の上位8チームの突破を含む（2026年方式）'}</div>
    </div>
    <div>
      <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:10px;letter-spacing:1.5px;text-transform:uppercase">${t('wcStatsKnockout')}</div>
      ${stages.map(s => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div style="width:40px;font-size:11px;color:rgba(255,255,255,0.5);font-weight:700;flex-shrink:0;text-align:right">${s.lbl}</div>
        <div style="flex:1;height:10px;background:rgba(255,255,255,0.07);border-radius:5px;overflow:hidden">
          <div style="height:100%;width:${Math.round(s.v/N*100)}%;background:${s.color};border-radius:5px;min-width:${s.v>0?2:0}px"></div>
        </div>
        <div style="width:38px;text-align:right;font-size:14px;font-weight:700;color:${s.lbl.includes('優勝')||s.lbl.includes('Champion')?'#ffd700':'#fff'}">${Math.round(s.v/N*100)}%</div>
      </div>`).join('')}
    </div>
    <div style="margin-top:14px;font-size:10px;color:rgba(255,255,255,0.2);text-align:center">${t('wcStatsMCFooter')}</div>`;
    resultEl.innerHTML = html;
    resultEl.style.display = '';
    statusEl.style.display = 'none';
  }, 60);
}

async function loadRealStats() {
  const statusEl = document.getElementById('stats-real-status');
  const resultEl = document.getElementById('stats-real-result');
  if (!WC_FIREBASE_CONFIG.apiKey) {
    statusEl.style.display = 'none';
    resultEl.innerHTML = `<div style="text-align:center;padding:28px 16px;background:rgba(255,255,255,0.04);border-radius:12px">
      <div style="font-size:32px;margin-bottom:12px">🔧</div>
      <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:10px">${t('wcStatsFirebaseTitle')}</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.45);line-height:1.8">${t('wcStatsFirebaseSub')}</div>
    </div>`;
    return;
  }
  statusEl.style.display = '';
  statusEl.textContent = t('wcStatsRealLoading');
  resultEl.innerHTML = '';
  const data = await loadWCMatchResults();
  if (!data) { statusEl.textContent = t('wcStatsRealFail'); return; }
  statusEl.style.display = 'none';
  if (data.length === 0) {
    resultEl.innerHTML = `<div style="text-align:center;padding:32px 16px;color:rgba(255,255,255,0.35);font-size:13px">${t('wcStatsRealEmpty')}</div>`;
    return;
  }
  const agg = {};
  data.forEach(d => {
    const key = (d.matchType||'?') + '|' + (d.opponent||'?');
    if (!agg[key]) agg[key] = {w:0,l:0,d:0,total:0,matchType:d.matchType,opponent:d.opponent,
      w_r:0,w_et:0,w_pk:0,l_r:0,l_et:0,l_pk:0};
    const a = agg[key];
    a.total++;
    const rt = d.resultType || 'regular';
    if(d.result==='win'){a.w++;if(rt==='et')a.w_et++;else if(rt==='pk')a.w_pk++;else a.w_r++;}
    else if(d.result==='loss'){a.l++;if(rt==='et')a.l_et++;else if(rt==='pk')a.l_pk++;else a.l_r++;}
    else a.d++;
  });
  const order = ['wc_group','wc_r32','wc_r16','wc_qf','wc_sf','wc_final'];
  // GL の固定並び順（英語名で管理）
  const GL_ORDER = ['Netherlands', 'Tunisia', 'Sweden'];
  const typeLabel = t('wcStatsTypeLabels');
  const _W = t('wcStatsW'), _D = t('wcStatsD'), _L = t('wcStatsL');
  const _90 = t('wcStats90'), _ET = t('wcStatsET'), _PK = t('wcStatsPK');
  // 英語チーム名 → 日本語チーム名の逆引きマップを TEAM_DATA から生成
  const _enToJa = {};
  Object.values(TEAM_DATA).forEach(team => { if (team.en_name) _enToJa[team.en_name] = team.name; });
  // 各ラウンドで起こり得ない相手（過去のデバッグ等で混入したゴミデータ）は表示から除外。
  // ※ 隠すだけで「全N試合」の母数（data.length）には手を加えない。
  const WC_VALID = {
    wc_group: ['netherlands2026','tunisia2026','sweden2026'],
    wc_r32:   ['morocco2026','brazil2026'],
    wc_r16:   ['mexico2026','norway2026'],
    wc_qf:    ['france2026','england2026'],
    wc_sf:    ['spain2026','argentina2026'],
    wc_final: ['argentina2026','france2026'],
  };
  const _validOpp = (mt, opp) => {
    const ks = WC_VALID[mt];
    if (!ks) return true; // 未知のmatchTypeは念のため残す
    return ks.some(k => { const td = TEAM_DATA[k]; return td && (opp === td.en_name || opp === td.name); });
  };
  const sorted = Object.values(agg).filter(a => _validOpp(a.matchType, a.opponent)).sort((a,b) => {
    const ai = order.indexOf(a.matchType), bi = order.indexOf(b.matchType);
    if (ai !== bi) return ai - bi;
    // GL内はオランダ→チュニジア→スウェーデンの固定順
    if (a.matchType === 'wc_group') {
      const ao = GL_ORDER.indexOf(a.opponent), bo = GL_ORDER.indexOf(b.opponent);
      return (ao === -1 ? 99 : ao) - (bo === -1 ? 99 : bo);
    }
    return 0;
  });
  const _totalLabel = window.LANG === 'en' ? data.length+' '+t('wcStatsMatches') : '全'+data.length+'試合のデータ';
  let html = `<div style="font-size:11px;color:rgba(255,255,255,0.7);text-align:right;margin-bottom:14px">${_totalLabel}</div>`;
  sorted.forEach(a => {
    const wr = Math.round(a.w/a.total*100);
    // 日本語モード時は英語名→日本語名に変換
    const _dispOpp = window.LANG === 'en' ? a.opponent : (_enToJa[a.opponent] || a.opponent);
    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <div style="width:36px;font-size:10px;color:#fff;font-weight:700;text-align:right;flex-shrink:0">${typeLabel[a.matchType]||''}</div>
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:13px;color:#fff">vs ${_dispOpp}</span>
          <span style="font-size:11px;color:rgba(255,255,255,0.7)">${a.total} ${t('wcStatsMatches')}</span>
        </div>
        <div style="height:7px;background:rgba(255,255,255,0.15);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${wr}%;background:linear-gradient(90deg,#1a6bb5,#27ae60);border-radius:4px"></div>
        </div>
        <div style="font-size:10px;color:#fff;margin-top:2px">${(()=>{let s=a.w+_W+' '+a.d+_D+' '+a.l+_L;if(a.matchType!=='wc_group'){let d='';if(a.w_r)d+=_90+a.w_r+_W;if(a.w_et)d+=(d?' ':'')+_ET+a.w_et+_W;if(a.w_pk)d+=(d?' ':'')+_PK+a.w_pk+_W;if(a.l_r)d+=(d?' ':'')+_90+a.l_r+_L;if(a.l_et)d+=(d?' ':'')+_ET+a.l_et+_L;if(a.l_pk)d+=(d?' ':'')+_PK+a.l_pk+_L;if(d)s+=' <span style="color:rgba(255,255,255,0.6)">('+d+')</span>';}return s;})()}</div>
      </div>
      <div style="width:42px;text-align:right;font-size:16px;font-weight:700;color:${wr>=50?'#4ade80':'#f87171'}">${wr}%</div>
    </div>`;
  });
  html += `<div style="margin-top:8px;font-size:10px;color:rgba(255,255,255,0.5);text-align:center">${t('wcStatsRealFooter')}</div>`;
  resultEl.innerHTML = html;
}

