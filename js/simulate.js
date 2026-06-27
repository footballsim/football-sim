// ============================================================
// STATE
// ============================================================

let currentMatchKey = null;
let team1Data = null, team2Data = null;
let isWorldCupMode = false;
let wcMatchIndex = 0; // 日本の試合済み数 (0〜3)
let wcR32Opponent = null;
let isWCR32Mode = false;
let wcPhase = '';
let wcR16Opponent = null;
let isWCR16Mode = false;
let wcQFOpponent = null;
let isWCQFMode = false;
let wcSFOpponent = null;
let isWCSFMode = false;
let wcFOpponent = null;
let isWCFMode = false;
let wcETScore = {t1: 0, t2: 0};
let wcMatchLog = [];
let _wcSkipToEnd = false;
let _wcETSubPending = false;
let wcCumulativeStats = {chances1:0,shots1:0,saves1:0,chances2:0,shots2:0,saves2:0};
let wcForceDrawPK = false;
let pkState = null;
let wcStandings = {
  '日本':        {flag:'🇯🇵', p:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0},
  'オランダ':    {flag:'🇳🇱', p:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0},
  'チュニジア':  {flag:'🇹🇳', p:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0},
  'スウェーデン':{flag:'🇸🇪', p:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0}
};
let wcMatchScores  = []; // 日本戦スコア履歴
let wcAutoScores   = []; // 自動演算スコア履歴
let wcPlayerStats  = {}; // 日本選手累積スタッツ {name:{goals,duels,duelWins}}
let wcOppPlayerStats = {}; // 対戦相手選手累積スタッツ（日本戦3試合分）{name:{goals,duels,duelWins,teamName,teamFlag}}
let wcTotalStats   = {chances:0, shots:0, gkSaves:0, oppChances:0, oppShots:0, oppGkSaves:0}; // 3試合合計スタッツ
let wcGoalScorers  = []; // 全得点者 [{time, name, matchNum}]
let wcAreaAtk      = {}; // エリア別攻撃勝率（累積）
let wcAreaDef      = {}; // エリア別守備勝率（累積）
let wcKnockoutResults = []; // KOラウンド試合結果 [{stage,oppFlag,oppName,s1,s2,won,decidedBy,pkS1,pkS2}]
let wcGroupRank    = 0;  // グループステージ順位 (1-4)
let team1State = {}, team2State = {};
let gameState = null;
let chanceResults = [];
let coachMarkTarget = -1; // 相手がマークする日本選手のポジション（lineup index 0-10）
let _duelScenesCache = [];
let _duelPlayerCache = {};
let currentChanceIdx = 0;
let editingPosition = null;
let _playerDetailOrigin = 'title';
let _settingBackScreen = 'title';
let _team1DataKey = 'japan2026vsNetherlands';
let halfTimeShown = false;
let halfTimeScore = { t1: 0, t2: 0 };
// W杯交代管理：5人・3回（ハーフタイムは回数消費なし）
let subsCount = 0;   // 交代人数（最大5）
let subsUsed = 0;    // 交代回数（最大3、ハーフタイムはカウントしない）
let htSubsCount = 0; // ハーフタイム中の交代人数（closeHalfTimeModal時にsubsCountへ加算）
let _htMode = false; // ハーフタイム選手変更中フラグ
let _subbedOff = new Set(); // 一度交代で退いた選手のインデックス（再出場不可）
let _pendingSubLog = []; // 交代ログ一時保留 [{out, outEn, in, inEn}]

// ============================================================
// SCREEN MANAGEMENT
// ============================================================

function buildPlayersTable(containerId, teams) {
  var PARAM_LABELS_JA = ['パワー','スタミナ','トップスピード','加速力','反応','ジャンプ','敏捷性',
    'ドリブル精度','ドリブル速度','ショートパス精度','ロングパス精度',
    'シュート精度','シュートセンス','シュート技術',
    'FK精度','カーブ','ボール技術','オフェンシブ',
    'パスカット','タックル','マンマーキング','カバーリング','チェイシング','セービング',
    'ハイボール処理','ヘディング','ポジショニング','メンタリティ','フェアプレー'];
  var PARAM_LABELS_EN = ['Power','Stamina','Top Speed','Acceleration','Reaction','Jump','Agility',
    'Dribble Acc.','Dribble Spd.','Short Pass','Long Pass',
    'Shot Acc.','Shot Sense','Shot Tech.',
    'FK Acc.','Curve','Ball Tech.','Offensive',
    'Intercept','Tackle','Man Mark','Covering','Chasing','Saving',
    'High Ball','Heading','Positioning','Mentality','Fair Play'];
  var PARAM_LABELS = window.LANG === 'en' ? PARAM_LABELS_EN : PARAM_LABELS_JA;

  // ポジション大区分マップ
  var POS_LARGE = {
    'GK':'GK',
    'CB':'DF','右CB':'DF','左CB':'DF','SB':'DF','右SB':'DF','左SB':'DF','SW':'DF',
    'DMF':'MF','右DMF':'MF','左DMF':'MF','CMF':'MF','右CMF':'MF','左CMF':'MF',
    'SMF':'MF','右SMF':'MF','左SMF':'MF','OMF':'MF',
    'WG':'FW','右WG':'FW','左WG':'FW','CF':'FW','FW':'FW','右FW':'FW','左FW':'FW'
  };
  var POS_ORDER = {'GK':0,'DF':1,'MF':2,'FW':3};
  // 国籍順
  var NATION_ORDER = {'日本':0,'イングランド':1,'スコットランド':2,'ベルギー':3};

  function pColor(v) {
    return v >= 85 ? '#B8001F' : v >= 80 ? '#003087' : v >= 70 ? '#2d7a3a' : '#aaa';
  }

  function calcStats(prm, pos) {
    function avg(idxs){var s=0,c=0;for(var i=0;i<idxs.length;i++){if(idxs[i]<prm.length){s+=prm[idxs[i]];c++;}}return c?Math.round(s/c):0;}
    var isGK = pos && pos.includes('GK');
    return [
      avg([7,8,9,10,11,13,17]),
      isGK ? avg([23,24]) : avg([18,19,20,21,22]),
      avg([13,14,15,16]),
      avg([0,1,5,25]),
      avg([2,3,4,6]),
      avg([26,27])
    ];
  }

  // 全選手フラット化（日本選手は重複排除）
  var allPlayers = [];
  var seenNames = {};
  for(var t=0; t<teams.length; t++) {
    var data = teams[t].data, key = teams[t].key;
    for(var i=0; i<data.players.length; i++) {
      var p = data.players[i];
      // 同じ選手名は1回だけ（日本代表の重複対策）
      if(seenNames[p.name]) continue;
      seenNames[p.name] = true;
      var posLg = POS_LARGE[p.positions[0]] || 'MF';
      var sv = calcStats(p.params, p.positions);
      var overall = Math.round((sv[0]+sv[1]+sv[2]+sv[3]+sv[4]+sv[5])/6);
      allPlayers.push({
        name:p.name, en_name:p.en_name, long_name:p.long_name, positions:p.positions,
        posLarge:posLg, params:p.params, sv:sv, overall:overall,
        flag:data.flag, nation:data.name, nationEn:data.en_name, teamKey:key, playerIdx:i,
        teamData:data
      });
    }
  }

  var sortKey = '_nation';
  var sortDir = 1;
  var filterNation = '';
  var filterPos = '';
  var filterContinent = '';

  // 国籍→大陸（サッカー連盟基準: オーストラリアはAFC）
  var NATION_CONTINENT = {
    '日本':'asia','韓国':'asia','イラン':'asia','サウジアラビア':'asia','カタール':'asia',
    'ヨルダン':'asia','ウズベキスタン':'asia','イラク':'asia','オーストラリア':'asia',
    'イングランド':'eur','スコットランド':'eur','スウェーデン':'eur','オランダ':'eur','ノルウェー':'eur',
    'スペイン':'eur','フランス':'eur','ドイツ':'eur','ポルトガル':'eur','クロアチア':'eur',
    'ベルギー':'eur','スイス':'eur','イタリア':'eur','デンマーク':'eur','オーストリア':'eur',
    'トルコ':'eur','セルビア':'eur','ポーランド':'eur','ウクライナ':'eur','チェコ':'eur',
    'ルーマニア':'eur','ボスニア・ヘルツェゴビナ':'eur',
    'ブラジル':'sam','アルゼンチン':'sam','コロンビア':'sam','ウルグアイ':'sam','エクアドル':'sam',
    'ベネズエラ':'sam','パラグアイ':'sam',
    'メキシコ':'nca','アメリカ':'nca','カナダ':'nca','パナマ':'nca','ハイチ':'nca','キュラソー':'nca',
    'チュニジア':'afr','モロッコ':'afr','セネガル':'afr','ナイジェリア':'afr','コートジボワール':'afr',
    'エジプト':'afr','カメルーン':'afr','ガーナ':'afr','アルジェリア':'afr','南アフリカ':'afr',
    'カーボベルデ':'afr','コンゴ民主共和国':'afr',
    'ニュージーランド':'oce'
  };
  var CONTINENTS = [
    {key:'asia', ja:'アジア', en:'Asia'},
    {key:'eur',  ja:'欧州',   en:'Europe'},
    {key:'sam',  ja:'南米',   en:'South America'},
    {key:'nca',  ja:'北中米', en:'N/C America'},
    {key:'afr',  ja:'アフリカ', en:'Africa'},
    {key:'oce',  ja:'オセアニア', en:'Oceania'}
  ];

  function getVal(pl, key) {
    if(key==='_nation') {
      var no = NATION_ORDER[pl.nation];
      return no !== undefined ? no : 99;
    }
    if(key==='nation')   return pl.nation;
    if(key==='pos')      return POS_ORDER[pl.posLarge] !== undefined ? POS_ORDER[pl.posLarge] : 9;
    if(key==='overall')  return pl.overall;
    if(key==='s0') return pl.sv[0]; if(key==='s1') return pl.sv[1];
    if(key==='s2') return pl.sv[2]; if(key==='s3') return pl.sv[3];
    if(key==='s4') return pl.sv[4]; if(key==='s5') return pl.sv[5];
    if(key.charAt(0)==='p') return pl.params[parseInt(key.substring(1))] || 0;
    return 0;
  }

  function render() {
    var el = document.getElementById(containerId);
    var _isEn = window.LANG === 'en';
    var PARAM_LABELS = _isEn ? PARAM_LABELS_EN : PARAM_LABELS_JA;

    // フィルター対象の選手
    var filtered = [];
    for(var i=0;i<allPlayers.length;i++) {
      var pl = allPlayers[i];
      if(filterNation && pl.nation !== filterNation) continue;
      if(!filterNation && filterContinent && NATION_CONTINENT[pl.nation] !== filterContinent) continue;
      if(filterPos && pl.posLarge !== filterPos) continue;
      filtered.push(pl);
    }

    // ソート
    var sorted = filtered.slice();
    sorted.sort(function(a,b){
      var av = getVal(a,sortKey), bv = getVal(b,sortKey);
      if(sortKey==='_nation') return av - bv; // 国籍はデフォルト順固定
      return sortDir * (typeof av==='string' ? av.localeCompare(bv,'ja') : bv-av);
    });

    // ユニーク国籍・ポジション・国旗
    var nations = [], posLarges = [], nationFlags = {}, nationEnMap = {};
    for(var i=0;i<allPlayers.length;i++) {
      if(nations.indexOf(allPlayers[i].nation)<0) nations.push(allPlayers[i].nation);
      if(posLarges.indexOf(allPlayers[i].posLarge)<0) posLarges.push(allPlayers[i].posLarge);
      if(!nationFlags[allPlayers[i].nation]) nationFlags[allPlayers[i].nation] = allPlayers[i].flag;
      if(!nationEnMap[allPlayers[i].nation]) nationEnMap[allPlayers[i].nation] = allPlayers[i].nationEn;
    }
    posLarges.sort(function(a,b){return (POS_ORDER[a]||9)-(POS_ORDER[b]||9);});

    // フィルターUI
    var fBtnStyle = 'padding:5px 12px;border-radius:16px;border:1px solid #ccc;background:white;font-size:12px;cursor:pointer;margin:2px;font-family:inherit';
    var fBtnActiveStyle = 'padding:5px 12px;border-radius:16px;border:1px solid #003087;background:#003087;color:white;font-size:12px;cursor:pointer;margin:2px;font-family:inherit';

    function nLabelOf(n) {
      return _isEn ? (nationEnMap[n] || n) : n;
    }

    // 1行目: 大陸タブ
    var filterHtml = '<div style="padding:10px 12px 4px;display:flex;flex-wrap:wrap;gap:2px;align-items:center">';
    filterHtml += '<span style="font-size:11px;color:#888;margin-right:4px">'+(_isEn?'Nation':'国籍')+'</span>';
    filterHtml += '<button style="'+(filterContinent===''&&filterNation===''?fBtnActiveStyle:fBtnStyle)+'" data-fc="">'+(_isEn?'All':'全て')+'</button>';
    for(var ci2=0;ci2<CONTINENTS.length;ci2++) {
      var ct=CONTINENTS[ci2];
      filterHtml += '<button style="'+(filterContinent===ct.key?fBtnActiveStyle:fBtnStyle)+'" data-fc="'+ct.key+'">'+(_isEn?ct.en:ct.ja)+'</button>';
    }
    filterHtml += '</div>';

    // 2行目: 選択中の大陸の国ボタン（大陸選択時のみ表示）
    if(filterContinent) {
      filterHtml += '<div style="padding:4px 12px;display:flex;flex-wrap:wrap;gap:2px;align-items:center;background:#f4f6fa">';
      filterHtml += '<button style="'+(filterNation===''?fBtnActiveStyle:fBtnStyle)+'" data-fn="">'+(_isEn?'All':'全て')+'</button>';
      for(var ni=0;ni<nations.length;ni++) {
        var n=nations[ni];
        if(NATION_CONTINENT[n] !== filterContinent) continue;
        filterHtml += '<button style="'+(filterNation===n?fBtnActiveStyle:fBtnStyle)+'" data-fn="'+n+'">'+(nationFlags[n]||'')+' '+nLabelOf(n)+'</button>';
      }
      filterHtml += '</div>';
    }

    // 3行目: ポジション + 件数
    filterHtml += '<div style="padding:4px 12px 10px;display:flex;flex-wrap:wrap;gap:2px;align-items:center;border-bottom:1px solid #eee">';
    filterHtml += '<span style="font-size:11px;color:#888;margin:0 4px 0 0">'+(_isEn?'Position':'ポジション')+'</span>';
    filterHtml += '<button style="'+(filterPos===''?fBtnActiveStyle:fBtnStyle)+'" data-fp="">'+(_isEn?'All':'全て')+'</button>';
    for(var pi=0;pi<posLarges.length;pi++) {
      var pg=posLarges[pi];
      filterHtml += '<button style="'+(filterPos===pg?fBtnActiveStyle:fBtnStyle)+'" data-fp="'+pg+'">'+pg+'</button>';
    }
    filterHtml += '<span style="font-size:11px;color:#555;margin-left:auto">'+sorted.length+(_isEn?' players':' 名表示')+'</span>';
    filterHtml += '</div>';

    // テーブルヘッダー
    var thS = 'background:#003087;color:white;padding:5px 4px;font-size:10px;font-weight:700;white-space:nowrap;text-align:center;cursor:pointer;user-select:none;border-right:1px solid rgba(255,255,255,0.15)';
    var STAT_LABELS = _isEn
      ? ['Attack','Defense','Technique','Power','Speed','Mental']
      : ['攻撃力総合','守備力総合','テクニック総合','パワー総合','スピード総合','メンタル総合'];
    var COLS = [
      {label:_isEn?'Player':'選手名',k:'name',w:'72px',sticky:true},
      {label:_isEn?'Nation':'国籍',k:'nation',w:'60px'},
      {label:_isEn?'Pos':'ポジション',k:'pos',w:'72px'},
      {label:_isEn?'OVR':'総合',k:'overall',w:'40px',sep:true},
    ];
    for(var si=0;si<6;si++) COLS.push({label:STAT_LABELS[si],k:'s'+si,w:'44px'});
    for(var pi2=0;pi2<PARAM_LABELS.length;pi2++) { if(pi2===12||pi2===28) continue; COLS.push({label:PARAM_LABELS[pi2],k:'p'+pi2,w:'52px'}); }

    var thead = '<tr>';
    for(var ci=0;ci<COLS.length;ci++) {
      var col=COLS[ci];
      var isActive = col.k===sortKey;
      var arrow = isActive ? (sortDir===-1?' ▼':' ▲') : '';
      var bg = isActive ? 'background:#1a5cb8' : 'background:#003087';
      var sep = col.sep ? 'border-left:2px solid rgba(255,255,255,0.4);' : '';
      thead += '<th data-key="'+col.k+'" style="min-width:'+col.w+';'+sep+thS.replace('background:#003087',bg)+'">'+col.label+arrow+'</th>';
    }
    thead += '</tr>';

    // 行
    var tbody = '';
    for(var ri=0;ri<sorted.length;ri++) {
      var pl=sorted[ri];
      var bgRow = ri%2===0 ? 'white' : '#f8f9fc';
      var plDispName = (_isEn && pl.en_name) ? pl.en_name : pl.name;
      var td = '<td style="padding:4px 8px;font-size:12px;font-weight:700;cursor:pointer;text-decoration:underline;color:#1a3a6b;white-space:nowrap;border-bottom:1px solid #eee;position:sticky;left:0;background:'+bgRow+';z-index:1" onclick="showPlayerDetail(\''+pl.teamKey+'\','+pl.playerIdx+')">'+plDispName+'</td>';
      var plNation = _isEn ? (pl.nationEn || pl.nation) : pl.nation;
      td += '<td style="padding:4px 6px;font-size:11px;text-align:center;border-bottom:1px solid #eee;white-space:nowrap;background:'+bgRow+'">'+pl.flag+' '+plNation+'</td>';
      td += '<td style="padding:4px 6px;font-size:10px;text-align:center;border-bottom:1px solid #eee;white-space:nowrap;background:'+bgRow+'">';
      td += '<span style="font-size:10px;font-weight:700;background:#003087;color:white;padding:2px 6px;border-radius:3px">'+pl.posLarge+'</span>';
      td += '</td>';
      td += '<td style="padding:4px 6px;text-align:center;font-size:14px;font-weight:900;color:#003087;border-bottom:1px solid #eee;border-left:2px solid #ccc;border-right:1px solid #ddd;background:'+bgRow+'"><span class="overall-live" id="overall-'+pl.teamKey+'-'+pl.playerIdx+'">'+pl.overall+'</span></td>';
      for(var si2=0;si2<6;si2++) {
        td += '<td style="padding:4px 6px;text-align:center;font-size:12px;font-weight:700;color:'+pColor(pl.sv[si2])+';border-bottom:1px solid #eee;background:'+bgRow+'">'+pl.sv[si2]+'</td>';
      }
      for(var pi3=0;pi3<pl.params.length;pi3++) {
        if(pi3===12||pi3===28) continue;
        td += '<td data-param-cell data-val="'+pl.params[pi3]+'" data-team-key="'+pl.teamKey+'" data-player-idx="'+pl.playerIdx+'" data-param-idx="'+pi3+'" style="padding:4px 6px;text-align:center;font-size:12px;font-weight:700;border-bottom:1px solid #eee;background:'+bgRow+'"><span style="color:'+pColor(pl.params[pi3])+';font-weight:600">'+pl.params[pi3]+'</span></td>';
      }
      tbody += '<tr>'+td+'</tr>';
    }

    el.innerHTML = filterHtml + '<div class="table-wrap"><table class="sheet-table" style="width:auto"><thead>'+thead+'</thead><tbody>'+tbody+'</tbody></table></div>';

    // フィルターボタンイベント
    var fcs = el.querySelectorAll('[data-fc]');
    for(var fci=0;fci<fcs.length;fci++) {
      (function(btn){
        btn.addEventListener('click', function(){
          filterContinent = btn.getAttribute('data-fc');
          filterNation = '';
          sortKey = '_nation'; sortDir = 1;
          render();
        });
      })(fcs[fci]);
    }
    var fns = el.querySelectorAll('[data-fn]');
    for(var fi=0;fi<fns.length;fi++) {
      (function(btn){
        btn.addEventListener('click', function(){
          filterNation = btn.getAttribute('data-fn');
          sortKey = '_nation'; sortDir = 1;
          render();
        });
      })(fns[fi]);
    }
    var fps = el.querySelectorAll('[data-fp]');
    for(var fi2=0;fi2<fps.length;fi2++) {
      (function(btn){
        btn.addEventListener('click', function(){
          filterPos = btn.getAttribute('data-fp');
          render();
        });
      })(fps[fi2]);
    }

    // ソートイベント
    var ths = el.querySelectorAll('th[data-key]');
    for(var ti=0;ti<ths.length;ti++) {
      (function(th){
        th.addEventListener('click', function(){
          var k = th.getAttribute('data-key');
          if(k==='_nation') return;
          if(sortKey===k) { sortDir*=-1; } else { sortKey=k; sortDir=-1; }
          render();
        });
      })(ths[ti]);
    }
  }

  render();
}

function _applyTournamentI18n() {
  const ids = {
    'wc-r32-back-btn': t('wcBack'), 'wc-r32-title': '🏆 ' + t('wcRound32'), 'wc-r32-start-btn': t('wcStartMatch'),
    'wc-r16-start-btn': t('wcKickoff'), 'wc-r16-again-btn': t('wcPlayAgain'), 'wc-r16-title-btn': t('wcToTitle'),
    'wc-r16-win-title': t('wcAdvancedQF'), 'wc-r16-win-congrats': t('wcCongrats'), 'wc-r16-win-again-btn': t('wcPlayAgain'), 'wc-r16-win-title-btn': t('wcToTitle'),
    'wc-qf-start-btn': t('wcKickoff'), 'wc-qf-again-btn': t('wcPlayAgain'), 'wc-qf-title-btn': t('wcToTitle'),
    'wc-qf-win-title': t('wcAdvancedSF'), 'wc-qf-win-congrats': t('wcCongrats'), 'wc-qf-win-again-btn': t('wcPlayAgain'), 'wc-qf-win-title-btn': t('wcToTitle'),
    'wc-sf-start-btn': t('wcKickoff'), 'wc-sf-again-btn': t('wcPlayAgain'), 'wc-sf-title-btn': t('wcToTitle'),
    'wc-sf-win-title': t('wcAdvancedF'), 'wc-sf-win-congrats': t('wcCongrats'), 'wc-sf-win-again-btn': t('wcPlayAgain'), 'wc-sf-win-title-btn': t('wcToTitle'),
    'wc-f-start-btn': t('wcKickoff'), 'wc-f-again-btn': t('wcPlayAgain'), 'wc-f-title-btn': t('wcToTitle'),
    'wc-champion-title': t('wcChampion'), 'wc-champion-sub': t('wcChampionSub'), 'wc-champion-again-btn': t('wcPlayAgain'), 'wc-champion-title-btn': t('wcToTitle'),
    'wc-eliminated-title': t('wcEliminated2'), 'wc-eliminated-again-btn': t('wcPlayAgain'), 'wc-eliminated-title-btn': t('wcToTitle'),
  };
  Object.entries(ids).forEach(([id, text]) => { const el = document.getElementById(id); if (el) el.textContent = text; });
}
let _wcEliminatedStage = null;

// KOラウンド試合結果を記録し、得点者をwcPlayerStats/wcGoalScorersに蓄積する
function _recordKOResult(stageKey, decidedBy, pkS1, pkS2) {
  var s1, s2;
  if (decidedBy === 'et' || decidedBy === 'pk') {
    s1 = wcETScore.t1; s2 = wcETScore.t2;
  } else {
    s1 = parseInt(document.getElementById('result-score1').textContent) || 0;
    s2 = parseInt(document.getElementById('result-score2').textContent) || 0;
  }
  var won = decidedBy === 'pk' ? (pkS1 > pkS2) : (s1 > s2);
  var logSrc = (decidedBy === 'et' || decidedBy === 'pk')
    ? wcMatchLog.concat(chanceResults) : chanceResults;
  var koMatchNum = wcMatchScores.length + wcKnockoutResults.length + 1;
  logSrc.forEach(function(res) {
    if (!res || !res.scenes) return;
    res.scenes.forEach(function(sc) {
      var isGoal  = sc.result === 'ゴール！！';
      var isNorm  = sc.result === '成功' || sc.result === '失敗' || sc.result === 'ファール';
      var isShoot = isGoal || sc.result === 'GK防いだ！' || sc.result === '枠を外した！';
      if (!isNorm && !isShoot) return;
      var lineup = sc.offence && sc.offence.lineup;
      var players = sc.offence && sc.offence.players;
      if (!lineup || !players) return;
      var p = players[lineup[sc.ofsPos]];
      if (!p) return;
      var forJapan = sc.offence === gameState.team1;
      if (forJapan) {
        if (!wcPlayerStats[p.name]) wcPlayerStats[p.name] = {goals:0, assists:0, duels:0, duelWins:0, enName: p.en_name};
        wcPlayerStats[p.name].duels++;
        if (isGoal || sc.result === '成功' || sc.result === 'ファール') wcPlayerStats[p.name].duelWins++;
        if (isGoal) {
          wcPlayerStats[p.name].goals++;
          wcGoalScorers.push({time: res.time, name: p.name, matchNum: koMatchNum});
          // アシスト集計（クロス・セットプレー）
          if (sc.crossPos !== undefined && sc.crossPos !== sc.ofsPos) {
            var ap = sc.offence.players[sc.offence.lineup[sc.crossPos]];
            if (ap) {
              if (!wcPlayerStats[ap.name]) wcPlayerStats[ap.name] = {goals:0, assists:0, duels:0, duelWins:0, enName: ap.en_name};
              wcPlayerStats[ap.name].assists++;
            }
          }
        }
      } else {
        var tFlag = team2Data ? team2Data.flag : '';
        var tName = team2Data ? team2Data.name : '';
        if (!wcOppPlayerStats[p.name]) wcOppPlayerStats[p.name] = {goals:0, duels:0, duelWins:0, enName: p.en_name, teamName: tName, teamFlag: tFlag};
        wcOppPlayerStats[p.name].duels++;
        if (isGoal || sc.result === '成功' || sc.result === 'ファール') wcOppPlayerStats[p.name].duelWins++;
        if (isGoal) wcOppPlayerStats[p.name].goals++;
      }
    });
  });
  wcKnockoutResults.push({
    stage: stageKey,
    oppFlag: team2Data ? team2Data.flag : '',
    oppName: team2Data ? team2Data.name : '',
    s1: s1, s2: s2, won: won,
    decidedBy: decidedBy,
    pkS1: pkS1 != null ? pkS1 : null,
    pkS2: pkS2 != null ? pkS2 : null
  });
}

// W杯結果画面の表示名を言語に応じて解決（英語モードはen_nameへ）
var _wcEnMapsCache = null;
function _wcEnMaps() {
  if (_wcEnMapsCache) return _wcEnMapsCache;
  var tm = {}, pm = {};
  for (var k in TEAM_DATA) { var td = TEAM_DATA[k]; if (!td) continue;
    if (td.name && td.en_name) tm[td.name] = td.en_name;
    if (td.players) td.players.forEach(function(p){ if (p && p.name && p.en_name && !pm[p.name]) pm[p.name] = p.en_name; });
  }
  _wcEnMapsCache = { team: tm, player: pm }; return _wcEnMapsCache;
}
function wcTeamDisp(jp) { return (window.LANG === "en" && _wcEnMaps().team[jp]) ? _wcEnMaps().team[jp] : jp; }
function wcPlayerDisp(jp) { return (window.LANG === "en" && _wcEnMaps().player[jp]) ? _wcEnMaps().player[jp] : jp; }

function showWCEliminated(stageKey) {
  _wcEliminatedStage = stageKey;
  const msgKeys = {wc_r32:'wcEliminatedMsgR32', wc_r16:'wcEliminatedMsgR16', wc_qf:'wcEliminatedMsgQF', wc_sf:'wcEliminatedMsgSF', wc_final:'wcEliminatedMsgFin'};
  const msgEl = document.getElementById('wc-eliminated-msg');
  if (msgEl) msgEl.textContent = t(msgKeys[stageKey] || 'wcEliminatedMsg');

  let html = '';

  // ① 試合結果一覧（グループ + KO）
  html += `<div style="background:rgba(0,0,0,0.35);border-radius:10px;overflow:hidden;margin-bottom:12px">
    <div style="padding:8px 12px;font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1px;border-bottom:1px solid rgba(255,255,255,0.08)">${t('wcElimTournamentResults')}</div>`;
  wcMatchScores.forEach(function(m) {
    const res = m.s1 > m.s2 ? t('winLabel') : m.s1 < m.s2 ? t('loseLabel') : t('drawLabel');
    const col = m.s1 > m.s2 ? '#4ade80' : m.s1 < m.s2 ? '#f87171' : '#fbbf24';
    html += `<div style="padding:8px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.07)">
      <span style="font-size:11px;color:rgba(255,255,255,0.4);min-width:36px">${t('wcMatchLabel')}${m.matchNum}${t('wcMatchSuffix')}</span>
      <span style="font-size:13px;color:#fff;flex:1;text-align:center">🇯🇵${t('wcElimJapan')} <b>${m.s1}–${m.s2}</b> ${m.t2flag}${wcTeamDisp(m.t2name)}</span>
      <span style="font-size:12px;font-weight:700;color:${col};min-width:14px;text-align:right">${res}</span>
    </div>`;
  });
  const koLabels = {wc_r32:t('wcRound32'), wc_r16:t('wcRound16'), wc_qf:t('wcQuarterFinal'), wc_sf:t('wcSemiFinal'), wc_final:t('wcFinal')};
  wcKnockoutResults.forEach(function(r) {
    const res = r.won ? t('winLabel') : t('loseLabel');
    const col = r.won ? '#4ade80' : '#f87171';
    let sc = `<b>${r.s1}–${r.s2}</b>`;
    if (r.decidedBy === 'pk') sc += ` <span style="font-size:10px;color:rgba(255,255,255,0.4)">(PK ${r.pkS1}–${r.pkS2})</span>`;
    else if (r.decidedBy === 'et') sc += ` <span style="font-size:10px;color:rgba(255,255,255,0.4)">(${t('wcElimET')})</span>`;
    html += `<div style="padding:8px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.07)">
      <span style="font-size:11px;color:rgba(255,255,255,0.4);min-width:36px">${koLabels[r.stage]||r.stage}</span>
      <span style="font-size:13px;color:#fff;flex:1;text-align:center">🇯🇵${t('wcElimJapan')} ${sc} ${r.oppFlag}${wcTeamDisp(r.oppName)}</span>
      <span style="font-size:12px;font-weight:700;color:${col};min-width:14px;text-align:right">${res}</span>
    </div>`;
  });
  html += `</div>`;

  // ② 大会通算スタッツ
  const totalGF = wcMatchScores.reduce((s,m)=>s+m.s1,0) + wcKnockoutResults.reduce((s,r)=>s+r.s1,0);
  const totalGA = wcMatchScores.reduce((s,m)=>s+m.s2,0) + wcKnockoutResults.reduce((s,r)=>s+r.s2,0);
  const totalW  = wcMatchScores.filter(m=>m.s1>m.s2).length + wcKnockoutResults.filter(r=>r.won).length;
  const totalD  = wcMatchScores.filter(m=>m.s1===m.s2).length;
  const totalL  = (wcMatchScores.length + wcKnockoutResults.length) - totalW - totalD;
  html += `<div style="background:rgba(0,0,0,0.35);border-radius:10px;padding:12px 16px;margin-bottom:12px">
    <div style="font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1px;margin-bottom:10px">${t('wcElimTournamentStats')}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center;margin-bottom:8px">
      <div><div style="font-size:20px;font-weight:700;color:#4ade80">${totalW}</div><div style="font-size:10px;color:rgba(255,255,255,0.45)">${t('wcStatsW')}</div></div>
      <div><div style="font-size:20px;font-weight:700;color:#fbbf24">${totalD}</div><div style="font-size:10px;color:rgba(255,255,255,0.45)">${t('wcStatsD')}</div></div>
      <div><div style="font-size:20px;font-weight:700;color:#f87171">${totalL}</div><div style="font-size:10px;color:rgba(255,255,255,0.45)">${t('wcStatsL')}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:center">
      <div style="background:rgba(74,222,128,0.1);border-radius:8px;padding:8px 4px"><div style="font-size:22px;font-weight:700;color:#4ade80">${totalGF}</div><div style="font-size:10px;color:rgba(255,255,255,0.45)">${t('wcElimTotalGF')}</div></div>
      <div style="background:rgba(248,113,113,0.1);border-radius:8px;padding:8px 4px"><div style="font-size:22px;font-weight:700;color:#f87171">${totalGA}</div><div style="font-size:10px;color:rgba(255,255,255,0.45)">${t('wcElimTotalGA')}</div></div>
    </div>
  </div>`;

  // ③ 日本の得点者一覧
  // 得点・アシストを wcPlayerStats から集計（全大会分）
  const scorerList = Object.entries(wcPlayerStats)
    .filter(function(kv){ return kv[1].goals > 0 || kv[1].assists > 0; })
    .map(function(kv){ return {name: kv[0], goals: kv[1].goals||0, assists: kv[1].assists||0}; })
    .sort(function(a,b){ return (b.goals*10+b.assists) - (a.goals*10+a.assists); });
  if (scorerList.length > 0) {
    html += `<div style="background:rgba(0,0,0,0.35);border-radius:10px;overflow:hidden;margin-bottom:12px">
      <div style="padding:8px 12px;font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1px;border-bottom:1px solid rgba(255,255,255,0.08)">${t('wcElimScorers')}</div>`;
    scorerList.slice(0, 10).forEach(function(g) {
      html += `<div style="padding:7px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.06)">
        <span style="color:#fff;font-size:13px">🇯🇵 ${wcPlayerDisp(g.name)}</span>
        <span style="font-size:13px;font-weight:700;display:flex;gap:8px">
          <span style="color:#ffd700;min-width:28px;text-align:right">${g.goals}G</span>
          <span style="color:rgba(255,255,255,0.5);min-width:28px;text-align:right">${g.assists}A</span>
        </span>
      </div>`;
    });
    html += `</div>`;
  }

  // ④ 日本MVP（デュエル勝利数を含むスコア）
  const mvpEntries = Object.entries(wcPlayerStats).filter(function(kv){return kv[1].goals>0||kv[1].assists>0||kv[1].duelWins>0;});
  if (mvpEntries.length > 0) {
    const best = mvpEntries.sort(function(a,b){return (b[1].goals*3+b[1].assists*2+b[1].duelWins)-(a[1].goals*3+a[1].assists*2+a[1].duelWins);})[0];
    const mvpName = best[0], mvpSt = best[1];
    const mvpStats = [
      mvpSt.goals > 0 ? mvpSt.goals + t('wcElimGoalLabel') : '',
      mvpSt.assists > 0 ? mvpSt.assists + t('wcElimAssistLabel') : '',
      t('wcElimDuelWinLabel') + mvpSt.duelWins + t('wcElimDuelWinSuffix') + (mvpSt.duels > 0 ? (window.LANG==='en'?' (':'（') + Math.round(mvpSt.duelWins/mvpSt.duels*100) + (window.LANG==='en'?'%)':'%）') : ''),
    ].filter(Boolean).join(t('wcElimDuelWinSep'));
    html += `<div style="background:rgba(184,134,11,0.3);border:1px solid rgba(255,215,0,0.35);border-radius:10px;padding:14px;margin-bottom:12px;text-align:center">
      <div style="font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1px;margin-bottom:6px">${t('wcElimMVP')}</div>
      <div style="font-size:22px;font-weight:700;color:#ffd700">${wcPlayerDisp(mvpName)}</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.65);margin-top:4px">${mvpStats}</div>
    </div>`;
  }

  // ⑤ AI総括
  html += `<div style="background:rgba(0,0,0,0.35);border-radius:10px;overflow:hidden;margin-bottom:8px">
    <div style="padding:8px 12px;font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between">
      <span>${t('wcElimAiTitle')}</span>
      <button id="wc-elim-summary-btn" onclick="generateWCEliminatedSummary()" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.1);color:#fff;cursor:pointer;font-family:inherit;font-weight:700">${t('wcElimAiBtn')}</button>
    </div>
    <div id="wc-elim-summary-content" style="padding:12px;font-size:13px;line-height:1.9;color:rgba(255,255,255,0.85)">
      <span style="color:rgba(255,255,255,0.35);font-size:12px">${t('wcElimAiPlaceholder')}</span>
    </div>
  </div>`;

  const contentEl = document.getElementById('wc-eliminated-content');
  if (contentEl) contentEl.innerHTML = html;
  showScreen('worldcup-eliminated');
}

function showWCChampion() {
  let html = '';

  // ① 試合結果一覧（グループ + KO全試合）
  const koLabels = {wc_r32:t('wcRound32'), wc_r16:t('wcRound16'), wc_qf:t('wcQuarterFinal'), wc_sf:t('wcSemiFinal'), wc_final:t('wcFinal')};
  html += `<div style="background:rgba(0,0,0,0.2);border-radius:10px;overflow:hidden;margin-bottom:12px">
    <div style="padding:8px 12px;font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:1px;border-bottom:1px solid rgba(255,255,255,0.15)">${t('wcElimTournamentResults')}</div>`;
  wcMatchScores.forEach(function(m) {
    const col = m.s1 > m.s2 ? '#4ade80' : m.s1 < m.s2 ? '#f87171' : '#fbbf24';
    const res = m.s1 > m.s2 ? t('winLabel') : m.s1 < m.s2 ? t('loseLabel') : t('drawLabel');
    html += `<div style="padding:8px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.1)">
      <span style="font-size:11px;color:rgba(255,255,255,0.6);min-width:36px">${t('wcMatchLabel')}${m.matchNum}${t('wcMatchSuffix')}</span>
      <span style="font-size:13px;color:#fff;flex:1;text-align:center">🇯🇵${t('wcElimJapan')} <b>${m.s1}–${m.s2}</b> ${m.t2flag}${wcTeamDisp(m.t2name)}</span>
      <span style="font-size:12px;font-weight:700;color:${col};min-width:14px;text-align:right">${res}</span>
    </div>`;
  });
  wcKnockoutResults.forEach(function(r) {
    const col = r.won ? '#4ade80' : '#f87171';
    const res = r.won ? t('winLabel') : t('loseLabel');
    let sc = `<b>${r.s1}–${r.s2}</b>`;
    if (r.decidedBy === 'pk') sc += ` <span style="font-size:10px;color:rgba(255,255,255,0.5)">(PK ${r.pkS1}–${r.pkS2})</span>`;
    else if (r.decidedBy === 'et') sc += ` <span style="font-size:10px;color:rgba(255,255,255,0.5)">(${t('wcElimET')})</span>`;
    html += `<div style="padding:8px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.1)">
      <span style="font-size:11px;color:rgba(255,255,255,0.6);min-width:36px">${koLabels[r.stage]||r.stage}</span>
      <span style="font-size:13px;color:#fff;flex:1;text-align:center">🇯🇵${t('wcElimJapan')} ${sc} ${r.oppFlag}${wcTeamDisp(r.oppName)}</span>
      <span style="font-size:12px;font-weight:700;color:${col};min-width:14px;text-align:right">${res}</span>
    </div>`;
  });
  html += `</div>`;

  // ② 大会通算スタッツ
  const totalGF = wcMatchScores.reduce((s,m)=>s+m.s1,0) + wcKnockoutResults.reduce((s,r)=>s+r.s1,0);
  const totalGA = wcMatchScores.reduce((s,m)=>s+m.s2,0) + wcKnockoutResults.reduce((s,r)=>s+r.s2,0);
  const totalW  = wcMatchScores.filter(m=>m.s1>m.s2).length + wcKnockoutResults.filter(r=>r.won).length;
  const totalD  = wcMatchScores.filter(m=>m.s1===m.s2).length;
  const totalL  = (wcMatchScores.length + wcKnockoutResults.length) - totalW - totalD;
  html += `<div style="background:rgba(0,0,0,0.2);border-radius:10px;padding:12px 16px;margin-bottom:12px">
    <div style="font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:1px;margin-bottom:10px">${t('wcElimTournamentStats')}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center;margin-bottom:8px">
      <div><div style="font-size:20px;font-weight:700;color:#4ade80">${totalW}</div><div style="font-size:10px;color:rgba(255,255,255,0.6)">${t('wcStatsW')}</div></div>
      <div><div style="font-size:20px;font-weight:700;color:#fbbf24">${totalD}</div><div style="font-size:10px;color:rgba(255,255,255,0.6)">${t('wcStatsD')}</div></div>
      <div><div style="font-size:20px;font-weight:700;color:#f87171">${totalL}</div><div style="font-size:10px;color:rgba(255,255,255,0.6)">${t('wcStatsL')}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:center">
      <div style="background:rgba(74,222,128,0.15);border-radius:8px;padding:8px 4px"><div style="font-size:22px;font-weight:700;color:#4ade80">${totalGF}</div><div style="font-size:10px;color:rgba(255,255,255,0.6)">${t('wcElimTotalGF')}</div></div>
      <div style="background:rgba(248,113,113,0.15);border-radius:8px;padding:8px 4px"><div style="font-size:22px;font-weight:700;color:#f87171">${totalGA}</div><div style="font-size:10px;color:rgba(255,255,255,0.6)">${t('wcElimTotalGA')}</div></div>
    </div>
  </div>`;

  // ③ 得点・アシスト（日本）
  const scorerList = Object.entries(wcPlayerStats)
    .filter(function(kv){ return kv[1].goals > 0 || kv[1].assists > 0; })
    .map(function(kv){ return {name: kv[0], goals: kv[1].goals||0, assists: kv[1].assists||0}; })
    .sort(function(a,b){ return (b.goals*10+b.assists) - (a.goals*10+a.assists); });
  if (scorerList.length > 0) {
    html += `<div style="background:rgba(0,0,0,0.2);border-radius:10px;overflow:hidden;margin-bottom:12px">
      <div style="padding:8px 12px;font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:1px;border-bottom:1px solid rgba(255,255,255,0.15)">${t('wcElimScorers')}</div>`;
    scorerList.slice(0, 10).forEach(function(g) {
      html += `<div style="padding:7px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1)">
        <span style="color:#fff;font-size:13px">🇯🇵 ${wcPlayerDisp(g.name)}</span>
        <span style="font-size:13px;font-weight:700;display:flex;gap:8px">
          <span style="color:#ffd700;min-width:28px;text-align:right">${g.goals}G</span>
          <span style="color:rgba(255,255,255,0.6);min-width:28px;text-align:right">${g.assists}A</span>
        </span>
      </div>`;
    });
    html += `</div>`;
  }

  // ④ 日本MVP
  const mvpEntries = Object.entries(wcPlayerStats).filter(function(kv){return kv[1].goals>0||kv[1].assists>0||kv[1].duelWins>0;});
  if (mvpEntries.length > 0) {
    const best = mvpEntries.sort(function(a,b){return (b[1].goals*3+b[1].assists*2+b[1].duelWins)-(a[1].goals*3+a[1].assists*2+a[1].duelWins);})[0];
    const mvpName = best[0], mvpSt = best[1];
    const mvpStats = [
      mvpSt.goals > 0 ? mvpSt.goals + t('wcElimGoalLabel') : '',
      mvpSt.assists > 0 ? mvpSt.assists + t('wcElimAssistLabel') : '',
      t('wcElimDuelWinLabel') + mvpSt.duelWins + t('wcElimDuelWinSuffix') + (mvpSt.duels > 0 ? (window.LANG==='en'?' (':'（') + Math.round(mvpSt.duelWins/mvpSt.duels*100) + (window.LANG==='en'?'%)':'%）') : ''),
    ].filter(Boolean).join(t('wcElimDuelWinSep'));
    html += `<div style="background:rgba(255,215,0,0.2);border:1px solid rgba(255,215,0,0.5);border-radius:10px;padding:14px;margin-bottom:12px;text-align:center">
      <div style="font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:1px;margin-bottom:6px">${t('wcElimMVP')}</div>
      <div style="font-size:22px;font-weight:700;color:#ffd700">${wcPlayerDisp(mvpName)}</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:4px">${mvpStats}</div>
    </div>`;
  }

  // ⑤ AI総括
  html += `<div style="background:rgba(0,0,0,0.2);border-radius:10px;overflow:hidden;margin-bottom:8px">
    <div style="padding:8px 12px;font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:1px;border-bottom:1px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:space-between">
      <span>${t('wcElimAiTitle')}</span>
      <button id="wc-champion-summary-btn" onclick="generateWCChampionSummary()" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.4);background:rgba(255,255,255,0.15);color:#fff;cursor:pointer;font-family:inherit;font-weight:700">${t('wcElimAiBtn')}</button>
    </div>
    <div id="wc-champion-summary-content" style="padding:12px;font-size:13px;line-height:1.9;color:rgba(255,255,255,0.9)">
      <span style="color:rgba(255,255,255,0.5);font-size:12px">${t('wcElimAiPlaceholder')}</span>
    </div>
  </div>`;

  const contentEl = document.getElementById('wc-champion-content');
  if (contentEl) contentEl.innerHTML = html;
  showScreen('worldcup-champion');
}

function generateWCEliminatedSummary() {
  var btn = document.getElementById('wc-elim-summary-btn');
  var el  = document.getElementById('wc-elim-summary-content');
  if (!btn || !el) return;
  btn.disabled = true; btn.textContent = t('wcElimAiGenerating'); btn.style.opacity = '0.6';
  el.innerHTML = '<span style="color:rgba(255,255,255,0.4);font-size:12px">'+t('wcElimAiGenerating')+'</span>';

  var matchLines = [];
  wcMatchScores.forEach(function(m) {
    matchLines.push('GL第'+m.matchNum+'戦 日本'+m.s1+'-'+m.s2+m.t2name);
  });
  var koL = {wc_r32:'ベスト32',wc_r16:'ベスト16',wc_qf:'準々決勝',wc_sf:'準決勝',wc_final:'決勝'};
  wcKnockoutResults.forEach(function(r) {
    var dec = r.decidedBy==='pk' ? '(PK '+r.pkS1+'-'+r.pkS2+')' : r.decidedBy==='et' ? '(延長)' : '';
    matchLines.push((koL[r.stage]||r.stage)+' 日本'+r.s1+'-'+r.s2+r.oppName+dec+(r.won?' 勝利':' 敗退'));
  });
  var stNm = {wc_r32:'ラウンド32',wc_r16:'ラウンド16',wc_qf:'準々決勝',wc_sf:'準決勝',wc_final:'決勝'};
  var elimSt = stNm[_wcEliminatedStage] || _wcEliminatedStage;
  var totalGF = wcMatchScores.reduce(function(s,m){return s+m.s1;},0)+wcKnockoutResults.reduce(function(s,r){return s+r.s1;},0);
  var totalGA = wcMatchScores.reduce(function(s,m){return s+m.s2;},0)+wcKnockoutResults.reduce(function(s,r){return s+r.s2;},0);
  var scorerLines = [];
  wcGoalScorers.forEach(function(g) { scorerLines.push('🇯🇵'+g.name+'('+g.time+')'); });
  var mvpText = '-';
  var mvpE = Object.entries(wcPlayerStats).filter(function(kv){return kv[1].goals>0||kv[1].duelWins>0;});
  if (mvpE.length>0) {
    var best = mvpE.sort(function(a,b){return (b[1].goals*3+b[1].assists*2+b[1].duelWins)-(a[1].goals*3+a[1].assists*2+a[1].duelWins);})[0];
    mvpText = best[0]+'('+best[1].goals+'ゴール/'+best[1].assists+'アシスト/デュエル勝利'+best[1].duelWins+'回)';
  }
  var grpRank = wcGroupRank > 0 ? wcGroupRank+'位' : '?位';
  // GLスコアのみ
  var glScoresText = wcMatchScores.map(function(m){ return '日本'+m.s1+'-'+m.s2+m.t2name; }).join(' / ');
  // KOスコアのみ
  var koL2 = {wc_r32:'ベスト32',wc_r16:'ベスト16',wc_qf:'準々決勝',wc_sf:'準決勝',wc_final:'決勝'};
  var koScoresText = wcKnockoutResults.map(function(r){
    var dec = r.decidedBy==='pk'?'(PK '+r.pkS1+'-'+r.pkS2+')':r.decidedBy==='et'?'(延長)':'';
    return (koL2[r.stage]||r.stage)+' 日本'+r.s1+'-'+r.s2+r.oppName+dec+(r.won?' ✓':' ✗');
  }).join(' / ');
  // 大会ルート（どこまで進んだか）
  var tournamentPath = wcKnockoutResults.map(function(r){
    return (koL2[r.stage]||r.stage)+(r.won?'勝利':'敗退');
  }).join('→');
  var matchData = {
    isWorldCup: true, isEliminated: true,
    // Worker が使うフィールド名に合わせる
    standings: 'グループ'+grpRank+'突破 → トーナメント: '+tournamentPath,
    japanResult: 'グループ'+grpRank+'→'+elimSt+'敗退',
    japanScores: glScoresText,
    autoScores: koScoresText,
    eliminatedAt: elimSt,
    allScorers: scorerLines.join(', ')||'なし', mvp: mvpText,
    team1:'日本', team2:'W杯2026', score1:totalGF, score2:totalGA,
    goals:scorerLines.join(', ')||'なし', mvp1:mvpText, mvp2:'-', topPattern:'',
  };
  var WORKER_URL = 'https://footballsimulator.m-iwasaki18.workers.dev';
  fetch(WORKER_URL, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({matchData: matchData, lang: window.LANG}),
  }).then(function(res) {
    if (res.status===429) {
      el.innerHTML='<span style="color:#e67e00;font-size:12px;line-height:1.7">'+t('wcRateLimitMsg')+'</span>';
      btn.textContent=t('wcRateLimit429'); btn.disabled=true; btn.style.opacity='0.6'; return;
    }
    if (!res.ok) return res.text().then(function(b){throw new Error('HTTP '+res.status+': '+b);});
    var reader=res.body.getReader(), decoder=new TextDecoder(), buffer='', fullText='';
    el.innerHTML='<div style="line-height:1.9;font-size:13px;color:rgba(255,255,255,0.85)"></div>';
    var textEl=el.querySelector('div');
    function read(){
      reader.read().then(function(chunk){
        if(chunk.done){btn.textContent=t('wcElimAiDone');btn.disabled=true;btn.style.opacity='0.6';return;}
        buffer+=decoder.decode(chunk.value,{stream:true});
        var lines=buffer.split('\n');buffer=lines.pop();
        lines.forEach(function(line){
          if(!line.startsWith('data: '))return;
          var data=line.slice(6).trim();if(data==='[DONE]')return;
          try{var json=JSON.parse(data);if(json.type==='content_block_delta'&&json.delta&&json.delta.text){fullText+=json.delta.text;textEl.innerHTML=fullText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');}}catch(e){}
        });read();
      }).catch(function(err){el.innerHTML='<span style="color:#ff6b6b;font-size:11px">'+err.message+'</span>';btn.textContent=t('wcElimAiRetry');btn.disabled=false;btn.style.opacity='1';});
    }
    read();
  }).catch(function(err){
    el.innerHTML='<span style="color:#ff6b6b;font-size:11px">'+err.message+'</span>';
    btn.textContent=t('wcElimAiRetry');btn.disabled=false;btn.style.opacity='1';
  });
}

function generateWCChampionSummary() {
  var btn = document.getElementById('wc-champion-summary-btn');
  var el  = document.getElementById('wc-champion-summary-content');
  if (!btn || !el) return;
  btn.disabled = true; btn.textContent = t('wcElimAiGenerating'); btn.style.opacity = '0.6';
  el.innerHTML = '<span style="color:rgba(255,255,255,0.4);font-size:12px">'+t('wcElimAiGenerating')+'</span>';

  var koL = {wc_r32:'ベスト32',wc_r16:'ベスト16',wc_qf:'準々決勝',wc_sf:'準決勝',wc_final:'決勝'};
  var totalGF = wcMatchScores.reduce(function(s,m){return s+m.s1;},0)+wcKnockoutResults.reduce(function(s,r){return s+r.s1;},0);
  var totalGA = wcMatchScores.reduce(function(s,m){return s+m.s2;},0)+wcKnockoutResults.reduce(function(s,r){return s+r.s2;},0);
  var scorerLines = [];
  wcGoalScorers.forEach(function(g) { scorerLines.push('🇯🇵'+g.name+'('+g.time+')'); });
  var mvpText = '-';
  var mvpE = Object.entries(wcPlayerStats).filter(function(kv){return kv[1].goals>0||kv[1].duelWins>0;});
  if (mvpE.length>0) {
    var best = mvpE.sort(function(a,b){return (b[1].goals*3+b[1].assists*2+b[1].duelWins)-(a[1].goals*3+a[1].assists*2+a[1].duelWins);})[0];
    mvpText = best[0]+'('+best[1].goals+'ゴール/'+best[1].assists+'アシスト/デュエル勝利'+best[1].duelWins+'回)';
  }
  var grpRank = wcGroupRank > 0 ? wcGroupRank+'位' : '?位';
  var glScoresText = wcMatchScores.map(function(m){ return '日本'+m.s1+'-'+m.s2+m.t2name; }).join(' / ');
  var koScoresText = wcKnockoutResults.map(function(r){
    var dec = r.decidedBy==='pk'?'(PK '+r.pkS1+'-'+r.pkS2+')':r.decidedBy==='et'?'(延長)':'';
    return (koL[r.stage]||r.stage)+' 日本'+r.s1+'-'+r.s2+r.oppName+dec+' ✓';
  }).join(' / ');
  var tournamentPath = 'グループ'+grpRank+'突破 → '+wcKnockoutResults.map(function(r){
    return (koL[r.stage]||r.stage)+'勝利';
  }).join('→')+' → 優勝';
  var matchData = {
    isWorldCup: true, isEliminated: true,
    standings: tournamentPath,
    japanResult: 'グループ'+grpRank+'突破→優勝',
    japanScores: glScoresText,
    autoScores: koScoresText,
    allScorers: scorerLines.join(', ')||'なし', mvp: mvpText,
    team1:'日本', team2:'W杯2026', score1:totalGF, score2:totalGA,
  };
  var WORKER_URL = 'https://footballsimulator.m-iwasaki18.workers.dev';
  fetch(WORKER_URL, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({matchData: matchData, lang: window.LANG}),
  }).then(function(res) {
    if (res.status===429) {
      el.innerHTML='<span style="color:#e67e00;font-size:12px;line-height:1.7">'+t('wcRateLimitMsg')+'</span>';
      btn.textContent=t('wcRateLimit429'); btn.disabled=true; btn.style.opacity='0.6'; return;
    }
    if (!res.ok) return res.text().then(function(b){throw new Error('HTTP '+res.status+': '+b);});
    var reader=res.body.getReader(), decoder=new TextDecoder(), buffer='', fullText='';
    el.innerHTML='<div style="line-height:1.9;font-size:13px;color:rgba(255,255,255,0.9)"></div>';
    var textEl=el.querySelector('div');
    function read(){
      reader.read().then(function(chunk){
        if(chunk.done){btn.textContent=t('wcElimAiDone');btn.disabled=true;btn.style.opacity='0.6';return;}
        buffer+=decoder.decode(chunk.value,{stream:true});
        var lines=buffer.split('\n');buffer=lines.pop();
        lines.forEach(function(line){
          if(!line.startsWith('data: '))return;
          var data=line.slice(6).trim();if(data==='[DONE]')return;
          try{var json=JSON.parse(data);if(json.type==='content_block_delta'&&json.delta&&json.delta.text){fullText+=json.delta.text;textEl.innerHTML=fullText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');}}catch(e){}
        });read();
      }).catch(function(err){el.innerHTML='<span style="color:#ff6b6b;font-size:11px">'+err.message+'</span>';btn.textContent=t('wcElimAiRetry');btn.disabled=false;btn.style.opacity='1';});
    }
    read();
  }).catch(function(err){
    el.innerHTML='<span style="color:#ff6b6b;font-size:11px">'+err.message+'</span>';
    btn.textContent=t('wcElimAiRetry');btn.disabled=false;btn.style.opacity='1';
  });
}

function showScreen(name) {
  if (name === 'title') isWorldCupMode = false;
  if (name === 'title' || name === 'setting') _resetSummary();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  _applyTournamentI18n();
  if (name === 'single' || name === 'single2') applyLang();
  // シングルマッチ チーム1選択リストを初回表示時に構築
  if (name === 'single') buildTeam1List();

  // 選手データ画面は初回表示時にJSで動的生成
  if (name === 'players' && !document.getElementById('players2018-body').dataset.built) {
    buildPlayersTable('players2018-body', [
      {data: TEAM_DATA.japan2026vsNetherlands, key: 'japan2026vsNetherlands'},
      {data: TEAM_DATA.japan2026vsEngland,     key: 'japan2026vsEngland'},
      {data: TEAM_DATA.japan2026vsTunisia,     key: 'japan2026vsTunisia'},
      {data: TEAM_DATA.japan2026vsSweden,      key: 'japan2026vsSweden'},
      {data: TEAM_DATA.england2026,            key: 'england2026'},
      {data: TEAM_DATA.scotland2026,           key: 'scotland2026'},
      {data: TEAM_DATA.tunisia2026,            key: 'tunisia2026'},
      {data: TEAM_DATA.sweden2026,             key: 'sweden2026'},
      {data: TEAM_DATA.netherlands2026,        key: 'netherlands2026'},
      {data: TEAM_DATA.morocco2026,            key: 'morocco2026'},
      {data: TEAM_DATA.brazil2026,             key: 'brazil2026'},
      {data: TEAM_DATA.mexico2026,             key: 'mexico2026'},
      {data: TEAM_DATA.norway2026,             key: 'norway2026'},
      {data: TEAM_DATA.argentina2026,          key: 'argentina2026'},
      {data: TEAM_DATA.spain2026,              key: 'spain2026'},
      {data: TEAM_DATA.france2026,             key: 'france2026'},
      {data: TEAM_DATA.germany2026,            key: 'germany2026'},
      {data: TEAM_DATA.usa2026,               key: 'usa2026'},
      {data: TEAM_DATA.portugal2026,          key: 'portugal2026'},
      {data: TEAM_DATA.korea2026,             key: 'korea2026'},
      {data: TEAM_DATA.croatia2026,           key: 'croatia2026'},
      {data: TEAM_DATA.belgium2026,           key: 'belgium2026'},
      {data: TEAM_DATA.colombia2026,          key: 'colombia2026'},
      {data: TEAM_DATA.uruguay2026,           key: 'uruguay2026'},
      {data: TEAM_DATA.switzerland2026,       key: 'switzerland2026'},
      {data: TEAM_DATA.italy2026,             key: 'italy2026'},
      {data: TEAM_DATA.denmark2026,           key: 'denmark2026'},
      {data: TEAM_DATA.austria2026,           key: 'austria2026'},
      {data: TEAM_DATA.canada2026,            key: 'canada2026'},
      {data: TEAM_DATA.senegal2026,           key: 'senegal2026'},
      {data: TEAM_DATA.ecuador2026,           key: 'ecuador2026'},
      {data: TEAM_DATA.australia2026,         key: 'australia2026'},
      {data: TEAM_DATA.turkey2026,            key: 'turkey2026'},
      {data: TEAM_DATA.serbia2026,            key: 'serbia2026'},
      {data: TEAM_DATA.poland2026,            key: 'poland2026'},
      {data: TEAM_DATA.ukraine2026,           key: 'ukraine2026'},
      {data: TEAM_DATA.czech2026,             key: 'czech2026'},
      {data: TEAM_DATA.nigeria2026,           key: 'nigeria2026'},
      {data: TEAM_DATA.ivorycoast2026,        key: 'ivorycoast2026'},
      {data: TEAM_DATA.egypt2026,             key: 'egypt2026'},
      {data: TEAM_DATA.cameroon2026,          key: 'cameroon2026'},
      {data: TEAM_DATA.iran2026,              key: 'iran2026'},
      {data: TEAM_DATA.saudiarabia2026,       key: 'saudiarabia2026'},
      {data: TEAM_DATA.ghana2026,             key: 'ghana2026'},
      {data: TEAM_DATA.romania2026,           key: 'romania2026'},
      {data: TEAM_DATA.venezuela2026,         key: 'venezuela2026'},
      {data: TEAM_DATA.paraguay2026,          key: 'paraguay2026'},
      {data: TEAM_DATA.algeria2026,           key: 'algeria2026'},
      {data: TEAM_DATA.bosnia2026,            key: 'bosnia2026'},
      {data: TEAM_DATA.southafrica2026,       key: 'southafrica2026'},
      {data: TEAM_DATA.capeverde2026,         key: 'capeverde2026'},
      {data: TEAM_DATA.drcongo2026,           key: 'drcongo2026'},
      {data: TEAM_DATA.panama2026,            key: 'panama2026'},
      {data: TEAM_DATA.newzealand2026,        key: 'newzealand2026'},
      {data: TEAM_DATA.qatar2026,             key: 'qatar2026'},
      {data: TEAM_DATA.jordan2026,            key: 'jordan2026'},
      {data: TEAM_DATA.uzbekistan2026,        key: 'uzbekistan2026'},
      {data: TEAM_DATA.iraq2026,              key: 'iraq2026'},
      {data: TEAM_DATA.haiti2026,             key: 'haiti2026'},
      {data: TEAM_DATA.curacao2026,           key: 'curacao2026'},
    ]);
    document.getElementById('players2018-body').dataset.built = '1';
  }
  if (name === 'worldcup-champion') {
    const champImg = document.getElementById('champion-img');
    if (champImg) champImg.src = IMG_CHAMPION;
  }
}

// シングルマッチ用チームリスト
const SINGLE_TEAMS = [
  {key:'japan2026vsNetherlands', label:'日本', flag:'🇯🇵'},
  {key:'england2026',        label:'イングランド', flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿'},
  {key:'scotland2026',       label:'スコットランド', flag:'🏴󠁧󠁢󠁳󠁣󠁴󠁿'},
  {key:'netherlands2026',    label:'オランダ', flag:'🇳🇱'},
  {key:'tunisia2026',        label:'チュニジア', flag:'🇹🇳'},
  {key:'sweden2026',         label:'スウェーデン', flag:'🇸🇪'},
  {key:'morocco2026',        label:'モロッコ', flag:'🇲🇦'},
  {key:'brazil2026',         label:'ブラジル', flag:'🇧🇷'},
  {key:'mexico2026',         label:'メキシコ', flag:'🇲🇽'},
  {key:'norway2026',         label:'ノルウェー', flag:'🇳🇴'},
  {key:'argentina2026',      label:'アルゼンチン', flag:'🇦🇷'},
  {key:'spain2026',          label:'スペイン', flag:'🇪🇸'},
  {key:'france2026',         label:'フランス', flag:'🇫🇷'},
  {key:'germany2026',        label:'ドイツ', flag:'🇩🇪'},
  {key:'usa2026',            label:'アメリカ', flag:'🇺🇸'},
  {key:'portugal2026',       label:'ポルトガル', flag:'🇵🇹'},
  {key:'korea2026',          label:'韓国', flag:'🇰🇷'},
  {key:'croatia2026',        label:'クロアチア', flag:'🇭🇷'},
  {key:'belgium2026',        label:'ベルギー', flag:'🇧🇪'},
  {key:'colombia2026',       label:'コロンビア', flag:'🇨🇴'},
  {key:'uruguay2026',        label:'ウルグアイ', flag:'🇺🇾'},
  {key:'switzerland2026',    label:'スイス', flag:'🇨🇭'},
  {key:'italy2026',          label:'イタリア', flag:'🇮🇹'},
  {key:'denmark2026',        label:'デンマーク', flag:'🇩🇰'},
  {key:'serbia2026',         label:'セルビア', flag:'🇷🇸'},
  {key:'poland2026',         label:'ポーランド', flag:'🇵🇱'},
  {key:'ukraine2026',        label:'ウクライナ', flag:'🇺🇦'},
  {key:'romania2026',        label:'ルーマニア', flag:'🇷🇴'},
  {key:'austria2026',        label:'オーストリア', flag:'🇦🇹'},
  {key:'canada2026',         label:'カナダ', flag:'🇨🇦'},
  {key:'senegal2026',        label:'セネガル', flag:'🇸🇳'},
  {key:'ecuador2026',        label:'エクアドル', flag:'🇪🇨'},
  {key:'australia2026',      label:'オーストラリア', flag:'🇦🇺'},
  {key:'turkey2026',         label:'トルコ', flag:'🇹🇷'},
  {key:'czech2026',          label:'チェコ', flag:'🇨🇿'},
  {key:'ivorycoast2026',     label:'コートジボワール', flag:'🇨🇮'},
  {key:'egypt2026',          label:'エジプト', flag:'🇪🇬'},
  {key:'iran2026',           label:'イラン', flag:'🇮🇷'},
  {key:'saudiarabia2026',    label:'サウジアラビア', flag:'🇸🇦'},
  {key:'ghana2026',          label:'ガーナ', flag:'🇬🇭'},
  {key:'nigeria2026',        label:'ナイジェリア', flag:'🇳🇬'},
  {key:'cameroon2026',       label:'カメルーン', flag:'🇨🇲'},
  {key:'venezuela2026',      label:'ベネズエラ', flag:'🇻🇪'},
  {key:'paraguay2026',       label:'パラグアイ', flag:'🇵🇾'},
  {key:'algeria2026',        label:'アルジェリア', flag:'🇩🇿'},
  {key:'bosnia2026',         label:'ボスニア・ヘルツェゴビナ', flag:'🇧🇦'},
  {key:'southafrica2026',    label:'南アフリカ', flag:'🇿🇦'},
  {key:'capeverde2026',      label:'カーボベルデ', flag:'🇨🇻'},
  {key:'drcongo2026',        label:'コンゴ民主共和国', flag:'🇨🇩'},
  {key:'panama2026',         label:'パナマ', flag:'🇵🇦'},
  {key:'newzealand2026',     label:'ニュージーランド', flag:'🇳🇿'},
  {key:'qatar2026',          label:'カタール', flag:'🇶🇦'},
  {key:'jordan2026',         label:'ヨルダン', flag:'🇯🇴'},
  {key:'uzbekistan2026',     label:'ウズベキスタン', flag:'🇺🇿'},
  {key:'iraq2026',           label:'イラク', flag:'🇮🇶'},
  {key:'haiti2026',          label:'ハイチ', flag:'🇭🇹'},
  {key:'curacao2026',        label:'キュラソー', flag:'🇨🇼'},
];

let _singleTeam1Key = null;

// 現在言語に応じたチーム表示名を返す
function teamLabel(t) {
  return (window.LANG === 'en' && TEAM_DATA[t.key] && TEAM_DATA[t.key].en_name)
    ? TEAM_DATA[t.key].en_name : t.label;
}

// SINGLE_TEAMS を実際のW杯グループ(A〜L)順にまとめる。
// WCSIM_GROUPS(tournament.js)に含まれない国＝W杯非出場(イタリア等)は自動的に除外される。
function groupedSingleTeams() {
  const byKey = {};
  SINGLE_TEAMS.forEach(t => { byKey[t.key] = t; });
  return Object.entries(WCSIM_GROUPS).map(([letter, keys]) => ({
    letter,
    teams: keys.map(k => byKey[k]).filter(Boolean),
  }));
}

// グループ見出し付きのチーム選択HTMLを生成（excludeKey は一覧から除外）
function renderTeamGroups(handler, excludeKey) {
  const groupWord = (window.LANG === 'en') ? 'Group' : 'グループ';
  return groupedSingleTeams().map(g => {
    const items = g.teams
      .filter(t => t.key !== excludeKey)
      .map(t =>
        `<div class="team-select-item" onclick="${handler}('${t.key}')">
          <span class="tsi-flag">${t.flag}</span>
          <span class="tsi-name">${teamLabel(t)}</span>
        </div>`
      ).join('');
    if (!items) return '';
    return `<div class="team-group">
        <div class="team-group-header"><span class="tg-label">${groupWord}</span><span class="tg-badge">${g.letter}</span></div>
        <div class="team-group-items">${items}</div>
      </div>`;
  }).join('');
}

// チーム1選択リストを構築（言語切替時に再構築）
function buildTeam1List() {
  const list = document.getElementById('team1-select-list');
  if (!list || list.dataset.built === (window.LANG || 'ja')) return;
  list.innerHTML = renderTeamGroups('selectTeam1', null);
  list.dataset.built = window.LANG || 'ja';
}

// チーム1決定 → チーム2選択画面へ
function selectTeam1(key) {
  _singleTeam1Key = key;
  const t1 = SINGLE_TEAMS.find(t => t.key === key);
  document.getElementById('single2-team1-display').textContent = t1.flag + ' ' + teamLabel(t1);

  const list = document.getElementById('team2-select-list');
  list.innerHTML = renderTeamGroups('selectTeam2', key);
  showScreen('single2');
}

// チーム2決定 → 試合設定へ
function selectTeam2(key) {
  const t1key = _singleTeam1Key;
  // 日本が team1 の場合は対戦相手別最適データを優先使用
  if (t1key === 'japan2026vsNetherlands') {
    const oppMap = {
      'netherlands2026': 'japan2026vsNetherlands',
      'tunisia2026':     'japan2026vsTunisia',
      'sweden2026':      'japan2026vsSweden',
    };
    _team1DataKey = oppMap[key] || 'japan2026vsNetherlands';
    team1Data = TEAM_DATA[_team1DataKey];
  } else {
    _team1DataKey = t1key;
    team1Data = TEAM_DATA[t1key];
  }
  team2Data = TEAM_DATA[key];
  currentMatchKey = t1key + '_vs_' + key;
  _settingBackScreen = 'single2';
  initSettingScreen();
  showScreen('setting');
}

function selectMatch(key) {
  currentMatchKey = key;
  _settingBackScreen = 'single';

  if (key === '2026vsチュニジア') {
    team1Data = TEAM_DATA.japan2026vsTunisia;
    team2Data = TEAM_DATA.tunisia2026;
  } else if (key === '2026vsスウェーデン') {
    team1Data = TEAM_DATA.japan2026vsSweden;
    team2Data = TEAM_DATA.sweden2026;
  } else if (key === '2026vsオランダ') {
    team1Data = TEAM_DATA.japan2026vsNetherlands;
    team2Data = TEAM_DATA.netherlands2026;
  } else if (key === '2026r32vsモロッコ') {
    team1Data = TEAM_DATA.japan2026vsNetherlands;
    team2Data = TEAM_DATA.morocco2026;
  } else if (key === '2026r32vsブラジル') {
    team1Data = TEAM_DATA.japan2026vsNetherlands;
    team2Data = TEAM_DATA.brazil2026;
  } else if (key === '2026r16vsメキシコ') {
    team1Data = TEAM_DATA.japan2026vsNetherlands;
    team2Data = TEAM_DATA.mexico2026;
  } else if (key === '2026r16vsノルウェー') {
    team1Data = TEAM_DATA.japan2026vsNetherlands;
    team2Data = TEAM_DATA.norway2026;
  } else if (key === '2026qfvsスペイン') {
    team1Data = TEAM_DATA.japan2026vsNetherlands;
    team2Data = TEAM_DATA.spain2026;
  } else if (key === '2026qfvsフランス') {
    team1Data = TEAM_DATA.japan2026vsNetherlands;
    team2Data = TEAM_DATA.france2026;
  } else if (key === '2026sfvsアルゼンチン') {
    team1Data = TEAM_DATA.japan2026vsNetherlands;
    team2Data = TEAM_DATA.argentina2026;
  } else if (key === '2026sfvsイングランド') {
    team1Data = TEAM_DATA.japan2026vsNetherlands;
    team2Data = TEAM_DATA.england2026;
  } else if (key === '2026qfvsイングランド') {
    team1Data = TEAM_DATA.japan2026vsNetherlands;
    team2Data = TEAM_DATA.england2026;
  } else if (key === '2026sfvsスペイン') {
    team1Data = TEAM_DATA.japan2026vsNetherlands;
    team2Data = TEAM_DATA.spain2026;
  } else if (key === '2026fvsフランス') {
    team1Data = TEAM_DATA.japan2026vsNetherlands;
    team2Data = TEAM_DATA.france2026;
  } else if (key === '2026fvsアルゼンチン') {
    team1Data = TEAM_DATA.japan2026vsNetherlands;
    team2Data = TEAM_DATA.argentina2026;
  } else if (key === '2026fvsスペイン') {
    team1Data = TEAM_DATA.japan2026vsNetherlands;
    team2Data = TEAM_DATA.spain2026;
  } else if (key === '2026vsイングランド') {
    team1Data = TEAM_DATA.japan2026vsNetherlands;
    team2Data = TEAM_DATA.england2026;
  } else {
    team1Data = TEAM_DATA.japan2026vsNetherlands;
    team2Data = TEAM_DATA.england2026;
  }
  _team1DataKey = Object.keys(TEAM_DATA).find(k => TEAM_DATA[k] === team1Data) || 'japan2026vsNetherlands';
  initSettingScreen();
  showScreen('setting');
}

// ============================================================
// SETTING SCREEN
// ============================================================

function initSettingScreen() {
  // Title
  document.getElementById('setting-title-text').textContent =
    `${getTeamName(team1Data)} vs ${getTeamName(team2Data)}`;

  // Init state（W杯モード第2戦以降は前試合の設定を引き継ぐ）
  if (!(isWorldCupMode && wcMatchIndex > 0)) {
    team1State = {
      systemIdx: system_data.findIndex(s => s.name === team1Data.default_system),
      tactics: team1Data.default_tactics,
      keyplayer: team1Data.default_keyplayer,
      marked_player: -1,
      lineup: [...team1Data.default_lineup.slice(0, 11)]
    };
    if (team1State.systemIdx < 0) team1State.systemIdx = 0;
  }

  // フィールド・ベンチ描画
  renderFormation();
  renderBench();
  // ボタン値更新
  updateSettingBtnValues();
  // 言語ラベル更新
  applyLang();

  // W杯モード時は多試合ボタンを非表示
  const multiVisible = !isWorldCupMode;
  document.getElementById('btn-multi').style.display    = multiVisible ? '' : 'none';
  document.getElementById('btn-multi100').style.display = multiVisible ? '' : 'none';
}

function updateSettingBtnValues() {
  document.getElementById('setting-system-value').textContent =
    system_data[team1State.systemIdx].name;
  document.getElementById('setting-tactics-value').textContent =
    t('tacticsNames')[team1State.tactics] || TACTICS_NAMES[team1State.tactics];
  const kp = team1Data.players[team1State.lineup[team1State.keyplayer]];
  document.getElementById('setting-keyplayer-value').textContent =
    kp ? getPlayerName(kp) : '-';
  const mpPlayer = team1State.marked_player >= 0
    ? team2Data.players[team1State.marked_player] : null;
  const mp = mpPlayer ? getPlayerName(mpPlayer) : t('unset');
  document.getElementById('setting-marked-value').textContent = mp;
}

// ポジション略称マッピング
const POS_ABBR = {
  'GK':'GK','SW':'SW',
  '右SB':'SB','左SB':'SB',
  '右CB':'CB','左CB':'CB',
  'DMF':'DH','右DMF':'DH','左DMF':'DH',
  'CMF':'CH','右CMF':'CH','左CMF':'CH',
  'OMF':'OH','右OMF':'OH','左OMF':'OH',
  'SMF':'SH','右SMF':'SH','左SMF':'SH',
  'WG':'WG','右WG':'WG','左WG':'WG',
  'FW':'CF','右FW':'CF','左FW':'CF',
};

function openFormationSelect() {
  renderFormationGrid();
  showScreen('formation');
}

function closeFormationSelect() {
  updateSettingBtnValues();
  renderFormation();
  renderBench();
  showScreen('setting');
}

// 戦術選択
const TACTICS_DESC_JA = [
  'ボールを保持し試合の主導権を握る。攻撃に回る機会が増えるが、ボールを奪われた際にカウンターを受ける確率が高くなる。',
  '相手陣内で積極的にボールを奪いショートカウンターを狙う。前線および中盤エリアでのカウンター率が上がる。ただし攻撃に回る機会がやや減る。',
  '自陣に引いて守備を固めカウンターを狙う。MF・DFプレイヤーの守備能力が強化され、中盤および最終ラインエリアでのカウンター率が上がる。ただし攻撃に回る機会が減る。',
  '失点を防ぐことを最優先とした戦術。フィールドプレイヤーの守備能力が大幅に強化される一方、攻撃機会も大幅に減少する。',
  '攻守のバランスを保ち、状況に応じて柔軟に対応する戦術。特定のパラメータ補正はなし。',
];
const TACTICS_DESC_EN = [
  'Maintain possession and control the game. More attacking opportunities, but higher risk of conceding counter-attacks when dispossessed.',
  'Press aggressively in the opponent\'s half to win the ball and launch quick counters. Higher counter rate in advanced areas, but slightly fewer attacking chances.',
  'Sit deep, defend solidly, and hit on the break. Defensive players are strengthened with higher counter rate in midfield and defensive areas, but fewer attacking chances.',
  'Prioritise defence above all else. Defensive ability is significantly boosted, but attacking opportunities are heavily reduced.',
  'A balanced approach with no specific parameter boosts. Adapts flexibly to any situation.',
];
function getTacticsDesc(i) {
  return window.LANG === 'en' ? TACTICS_DESC_EN[i] : TACTICS_DESC_JA[i];
}
const TACTICS_ICON = ['🔄','⚡','↩️','🛡️','🆓'];

function openTacticsSelect() {
  const content = document.getElementById('tactics-select-content');
  content.innerHTML = '';
  TACTICS_NAMES.forEach((name, i) => {
    const opt = document.createElement('div');
    opt.className = 'tactics-option' + (i === team1State.tactics ? ' selected' : '');
    opt.innerHTML = `
      <div class="tactics-option-icon">${TACTICS_ICON[i]}</div>
      <div class="tactics-option-text">
        <div class="tactics-option-name">${t('tacticsNames')[i]||name}</div>
        <div class="tactics-option-desc">${getTacticsDesc(i)}</div>
      </div>
      ${i === team1State.tactics ? '<span style="color:var(--japan-blue);font-size:20px">✓</span>' : ''}
    `;
    opt.onclick = () => {
      team1State.tactics = i;
      closeSubSelect('tactics');
    };
    content.appendChild(opt);
  });
  showScreen('tactics');
}

// キープレイヤー選択
function openKeyPlayerSelect() {
  const content = document.getElementById('keyplayer-select-content');
  content.innerHTML = '';
  const sys = system_data[team1State.systemIdx];
  const desc = document.createElement('div');
  desc.style.cssText = 'font-size:12px;color:var(--text-dim);margin-bottom:14px;padding:10px;background:rgba(0,48,135,0.05);border-radius:8px';
  desc.textContent = '⭐ ' + t('keypHint').replace('⭐ ','');
  content.appendChild(desc);
  for (let pos = 0; pos < 11; pos++) {
    const playerIdx = team1State.lineup[pos];
    const p = team1Data.players[playerIdx];
    const item = document.createElement('div');
    item.className = 'player-select-item' + (pos === team1State.keyplayer ? ' current' : '');
    item.innerHTML = `
      <div style="background:${team1Data.team_color};color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0">${sys.positions[pos].replace(/[左右]/g,'').substring(0,2)}</div>
      <div class="psi-name">${getPlayerName(p)}<span style="font-size:11px;color:var(--text-dim);margin-left:6px">${sys.positions[pos]}</span></div>
      ${pos === team1State.keyplayer ? '<span style="color:var(--japan-blue);font-size:18px;margin-left:auto">⭐</span>' : ''}
    `;
    item.onclick = () => {
      team1State.keyplayer = pos;
      closeSubSelect('keyplayer');
    };
    content.appendChild(item);
  }
  showScreen('keyplayer');
}

// 要注意プレイヤー選択
function openMarkedPlayerSelect() {
  const content = document.getElementById('marked-select-content');
  content.innerHTML = '';

  const t2sys = system_data.findIndex(s => s.name === team2Data.default_system);
  const sys2 = system_data[t2sys >= 0 ? t2sys : 0];
  const lineup2 = team2Data.default_lineup.slice(0, 11);

  // 説明文
  const desc = document.createElement('div');
  desc.style.cssText = 'font-size:12px;color:var(--text-dim);margin-bottom:12px;padding:10px;background:rgba(188,0,45,0.05);border-radius:8px';
  desc.textContent = `🎯 ${getTeamName(team2Data)}${t('markedHint')}`;
  content.appendChild(desc);

  // フォーメーション表示
  const fmLabel = document.createElement('div');
  fmLabel.style.cssText = 'font-size:11px;font-weight:700;color:var(--text-dim);margin-bottom:4px;text-align:center';
  fmLabel.textContent = `${team2Data.flag} ${team2Data.name}  ${sys2.name}`;
  content.appendChild(fmLabel);

  // 戦術表示
  const tacticsLabel = document.createElement('div');
  const tacticsName = (window.LANG === 'en' ? ['Possession','Press','Counter','Defensive','Balanced'] : ['ポゼッション','プレス','カウンター','守備重視','バランス重視'])[team2Data.default_tactics] || '-';
  const tacticsEmoji = ['🎯','⚡','🔄','🛡️','🎲'][team2Data.default_tactics] || '';
  tacticsLabel.style.cssText = 'font-size:11px;font-weight:700;color:var(--gold);margin-bottom:10px;text-align:center;padding:3px 10px;background:rgba(212,175,55,0.1);border-radius:8px;display:inline-block;width:fit-content;margin-left:auto;margin-right:auto';
  tacticsLabel.textContent = `${tacticsEmoji} ${window.LANG === 'en' ? 'Tactics' : '戦術'}: ${tacticsName}`;
  const tacticsWrap = document.createElement('div');
  tacticsWrap.style.cssText = 'text-align:center;margin-bottom:10px';
  tacticsWrap.appendChild(tacticsLabel);
  content.appendChild(tacticsWrap);

  const fieldWrap = document.createElement('div');
  fieldWrap.style.cssText = 'position:relative;margin-bottom:16px;border-radius:10px;overflow:hidden;';
  fieldWrap.innerHTML = `
    <div style="position:relative;background:linear-gradient(180deg,var(--green-field) 0%,var(--green-light) 50%,var(--green-field) 100%);border-radius:10px;border:2px solid rgba(255,255,255,0.15)">
      <svg viewBox="0 0 100 145" style="width:100%;opacity:0.2;pointer-events:none" preserveAspectRatio="none">
        <rect x="5" y="5" width="90" height="135" fill="none" stroke="white" stroke-width="0.8"/>
        <line x1="5" y1="72.5" x2="95" y2="72.5" stroke="white" stroke-width="0.6"/>
        <circle cx="50" cy="72.5" r="12" fill="none" stroke="white" stroke-width="0.6"/>
        <circle cx="50" cy="72.5" r="0.8" fill="white"/>
        <rect x="25" y="5" width="50" height="18" fill="none" stroke="white" stroke-width="0.6"/>
        <rect x="35" y="5" width="30" height="9" fill="none" stroke="white" stroke-width="0.6"/>
        <rect x="25" y="122" width="50" height="18" fill="none" stroke="white" stroke-width="0.6"/>
        <rect x="35" y="127" width="30" height="13" fill="none" stroke="white" stroke-width="0.6"/>
      </svg>
      <div id="marked-formation-display" style="position:absolute;inset:0"></div>
    </div>`;
  content.appendChild(fieldWrap);

  // ドットを配置
  const display = fieldWrap.querySelector('#marked-formation-display');
  lineup2.forEach((playerIdx, pos) => {
    const p = team2Data.players[playerIdx];
    const isGK = p.positions.includes('GK');
    const dot = document.createElement('div');
    dot.style.cssText = `position:absolute;transform:translate(-50%,-50%);left:${sys2.x[pos]}%;top:${sys2.y[pos]}%;display:flex;flex-direction:column;align-items:center;cursor:${isGK ? 'not-allowed' : 'pointer'};opacity:${isGK ? '0.4' : '1'}`;
    const isMarked = team1State.marked_player === playerIdx;
    dot.innerHTML = `
      <div style="width:36px;height:36px;border-radius:50%;background:${isGK ? '#555' : team2Data.team_color};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:white;border:2px solid ${isMarked ? '#ff0' : 'rgba(255,255,255,0.6)'};box-shadow:0 2px 8px rgba(0,0,0,0.5)">${sys2.positions[pos].replace(/[左右]/g,'').substring(0,2)}</div>
      <div style="font-size:8px;font-weight:700;color:white;text-shadow:0 1px 3px rgba(0,0,0,0.9);margin-top:2px;white-space:nowrap;-webkit-text-size-adjust:none">${getPlayerName(p)}</div>
    `;
    dot.onclick = () => {
      if (isGK) return;
      team1State.marked_player = playerIdx;
      closeSubSelect('marked');
    };
    display.appendChild(dot);
  });

  // 区切り
  const divider = document.createElement('div');
  divider.style.cssText = 'font-size:11px;font-weight:700;color:var(--text-dim);margin-bottom:8px';
  divider.textContent = t('markedTap');
  content.appendChild(divider);

  // 未設定オプション
  const none = document.createElement('div');
  none.className = 'player-select-item' + (team1State.marked_player < 0 ? ' current' : '');
  none.innerHTML = `<div class="psi-name" style="color:var(--text-dim)">${t('unset')}</div>${team1State.marked_player < 0 ? '<span style="color:var(--japan-red);font-size:18px;margin-left:auto">🎯</span>' : ''}`;
  none.onclick = () => {
    team1State.marked_player = -1;
    closeSubSelect('marked');
  };
  content.appendChild(none);

  lineup2.forEach((playerIdx, pos) => {
    const p = team2Data.players[playerIdx];
    const isGKitem = p.positions.includes('GK');
    const item = document.createElement('div');
    item.className = 'player-select-item' + (team1State.marked_player === playerIdx ? ' current' : '');
    item.style.cssText = isGKitem ? 'opacity:0.4;pointer-events:none' : '';
    item.innerHTML = `
      <div style="background:${isGKitem ? '#555' : team2Data.team_color};color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0">${sys2.positions[pos].replace(/[左右]/g,'').substring(0,2)}</div>
      <div class="psi-name">${getPlayerName(p)}${isGKitem ? `<span style="font-size:10px;color:#888;margin-left:6px">${t('gkDisabled')}</span>` : ''}</div>
      ${team1State.marked_player === playerIdx ? '<span style="color:var(--japan-red);font-size:18px;margin-left:auto">🎯</span>' : ''}
    `;
    item.onclick = () => {
      if (isGKitem) return;
      team1State.marked_player = playerIdx;
      closeSubSelect('marked');
    };
    content.appendChild(item);
  });
  showScreen('marked');
}

function closeSubSelect(type) {
  updateSettingBtnValues();
  showScreen('setting');
}

function renderFormationGrid(onSelectCallback) {
  const grid = document.getElementById('formation-grid');
  grid.innerHTML = '';

  system_data.forEach((sys, idx) => {
    const card = document.createElement('div');
    card.className = 'formation-card' + (idx === team1State.systemIdx ? ' selected' : '');
    card.onclick = () => {
      team1State.systemIdx = idx;
      if (onSelectCallback) onSelectCallback();
      else closeFormationSelect();
    };

    // ミニフィールド
    const field = document.createElement('div');
    field.className = 'formation-card-field';

    // フィールドライン（SVG）
    field.innerHTML = `<svg class="formation-card-field-lines" viewBox="0 0 100 140" preserveAspectRatio="none" style="opacity:0.2">
      <rect x="5" y="3" width="90" height="134" fill="none" stroke="white" stroke-width="1.5"/>
      <line x1="5" y1="70" x2="95" y2="70" stroke="white" stroke-width="1"/>
      <rect x="28" y="3" width="44" height="16" fill="none" stroke="white" stroke-width="1"/>
      <rect x="28" y="121" width="44" height="16" fill="none" stroke="white" stroke-width="1"/>
    </svg>`;

    // ポジション円
    sys.positions.forEach((posName, pos) => {
      const x = sys.x[pos];
      const y = sys.y[pos];
      const abbr = POS_ABBR[posName] || posName.replace(/[左右]/g,'').substring(0,2);
      const dot = document.createElement('div');
      dot.className = 'fcard-dot';
      dot.style.left = x + '%';
      dot.style.top = y + '%';
      dot.textContent = abbr;
      field.appendChild(dot);
    });

    const name = document.createElement('div');
    name.className = 'formation-card-name';
    name.textContent = sys.name;

    card.appendChild(field);
    card.appendChild(name);
    grid.appendChild(card);
  });
}

function onSystemChange() {
  team1State.systemIdx = parseInt(document.getElementById('system-select').value);
  renderFormation();
  renderBench();
}

function renderOpponentLineup() {
  const container = document.getElementById('opponent-lineup-list');
  const t2sys = system_data.findIndex(s => s.name === team2Data.default_system);
  const sys = system_data[t2sys >= 0 ? t2sys : 0];
  const lineup = team2Data.default_lineup.slice(0, 11);

  document.getElementById('opponent-label').textContent =
    `${team2Data.flag} ${team2Data.name} スターティングメンバー（${sys.name}）`;

  container.innerHTML = '';
  lineup.forEach((playerIdx, pos) => {
    const p = team2Data.players[playerIdx];
    const row = document.createElement('div');
    row.className = 'lineup-row';
    row.innerHTML = `
      <div class="lineup-num" style="color:${team2Data.team_color};font-weight:700;width:28px;text-align:right;font-size:12px">${pos + 1}</div>
      <div style="width:36px;height:36px;border-radius:50%;background:${team2Data.team_color};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:white;flex-shrink:0">${sys.positions[pos].replace(/[左右]/g,'').substring(0,2)}</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700;color:var(--text)">${getPlayerName(p)}</div>

      </div>
      <div style="font-size:11px;color:var(--text-dim)">${sys.positions[pos]}</div>
    `;
    container.appendChild(row);
  });
}

function renderTactics() {
  const grid = document.getElementById('tactics-grid');
  grid.innerHTML = TACTICS_NAMES.map((t, i) =>
    `<button class="tactic-btn ${i === team1State.tactics ? 'active' : ''}" onclick="setTactics(${i})">${t}</button>`
  ).join('');
}

function setTactics(i) {
  team1State.tactics = i;
  renderTactics();
}

function renderKeyplayer() {
  updateSettingBtnValues();
}

function openKeyPlayerModal() {
  const list = document.getElementById('keyplayer-select-list');
  list.innerHTML = '';
  const sys = system_data[team1State.systemIdx];
  for (let pos = 0; pos < 11; pos++) {
    const playerIdx = team1State.lineup[pos];
    const p = team1Data.players[playerIdx];
    const item = document.createElement('div');
    item.className = 'player-select-item' + (pos === team1State.keyplayer ? ' current' : '');
    item.innerHTML = `<div class="psi-num">${pos}</div><div class="psi-name">${getPlayerName(p)}</div><div class="psi-pos">${sys.positions[pos]}</div>`;
    item.onclick = () => { team1State.keyplayer = pos; renderKeyplayer(); closeModal('modal-keyplayer'); };
    list.appendChild(item);
  }
  document.getElementById('modal-keyplayer').classList.add('open');
}

// 案②: 適正外バッジタップ時のトースト
let _oopToastTimer = null;
function showOopToast(msg) {
  const el = document.getElementById('oop-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (_oopToastTimer) clearTimeout(_oopToastTimer);
  _oopToastTimer = setTimeout(() => { el.classList.remove('show'); }, 2500);
}

function renderFormation() {
  const display = document.getElementById('formation-display');
  const sys = system_data[team1State.systemIdx];
  display.innerHTML = '';

  for (let pos = 0; pos < 11; pos++) {
    const x = sys.x[pos];
    const y = sys.y[pos];
    const playerIdx = team1State.lineup[pos];
    const player = team1Data.players[playerIdx];

    const dot = document.createElement('div');
    dot.className = 'player-dot' + (pos === team1State.keyplayer ? ' keyplayer' : '');
    dot.style.left = x + '%';
    dot.style.top = y + '%';
    dot.dataset.pos = pos;
    dot.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

    // タップで選手詳細ページへ
    dot.onclick = () => { if (!dragState.dragging) showPlayerDetail(getTeam1DataKey(), playerIdx); };

    const circle = document.createElement('div');
    circle.className = 'player-circle';
    circle.style.background = team1Data.team_color;
    circle.textContent = sys.positions[pos].replace(/[左右]/g, '').substring(0, 2);

    // 適正外ポジション判定（getActionParamのペナルティ条件と同一）
    // ① フォーメーションの要求ポジション名（例: "右SMF"）が得意ポジションに含まれない
    // ② かつ 左右を除いたベース（例: "SMF"）も含まれない → 適正外
    const _fieldPos = sys.positions[pos];
    const _posType = (_fieldPos[0] === '左' || _fieldPos[0] === '右') ? _fieldPos.slice(1) : _fieldPos;
    const _isOutOfPos = player && !player.positions.includes(_fieldPos) && !player.positions.includes(_posType);

    const circleWrap = document.createElement('div');
    circleWrap.style.cssText = 'position:relative;display:inline-flex;';
    circleWrap.appendChild(circle);
    if (_isOutOfPos) {
      const badge = document.createElement('div');
      badge.className = 'pos-badge';
      badge.textContent = '!';
      badge.onclick = (e) => {
        e.stopPropagation();
        const pname = player ? getPlayerName(player) : '?';
        const preferred = player ? player.positions.join(' / ') : '';
        showOopToast(window.LANG === 'en'
          ? `${pname} | ${_fieldPos}: off-position (prefers: ${preferred}) −5% all stats`
          : `${pname}｜${_fieldPos} は非得意ポジション（得意: ${preferred}）全能力5%ダウン`);
      };
      circleWrap.appendChild(badge);
    }

    // タッチ（モバイル）
    dot.addEventListener('touchstart', e => {
      e.stopPropagation();
      const t = e.touches[0];
      const cr = circle.getBoundingClientRect();
      if (t.clientX < cr.left || t.clientX > cr.right ||
          t.clientY < cr.top  || t.clientY > cr.bottom) return;
      dragState.dragging = false;
      dragState.sourceType = 'starter';
      dragState.sourcePos = pos;
      dragState.sourcePlayerIdx = playerIdx;
      dragState.ghostShown = false;
      dragState.activeDot = dot;
      dot.classList.add('dragging');
      dragState.longPressTimer = setTimeout(() => {
        if (!dragState.dragging) showPlayerDetail(getTeam1DataKey(), playerIdx);
      }, 500);
    }, { passive: false });

    dot.addEventListener('touchmove', e => {
      e.preventDefault();
      clearTimeout(dragState.longPressTimer);
      dragState.dragging = true;
      const t = e.touches[0];
      if (!dragState.ghostShown) {
        showGhost(player ? getPlayerName(player) : '?', t.clientX, t.clientY);
        dragState.ghostShown = true;
      }
      moveGhost(t.clientX, t.clientY);
      highlightDropTarget(t.clientX, t.clientY);
    }, { passive: false });

    dot.addEventListener('touchend', e => {
      e.preventDefault();
      clearTimeout(dragState.longPressTimer);
      const t = e.changedTouches[0];
      applyDrop(t.clientX, t.clientY);
      dot.classList.remove('dragging');
      hideGhost();
      clearHighlight();
      setTimeout(() => { dragState.dragging = false; }, 50);
    }, { passive: false });

    // マウス（PC）
    dot.addEventListener('mousedown', e => {
      e.preventDefault();
      dragState.dragging = false;
      dragState.sourceType = 'starter';
      dragState.sourcePos = pos;
      dragState.sourcePlayerIdx = playerIdx;
      dragState.ghostShown = false;
      dragState.activeDot = dot;
      dot.classList.add('dragging');
    });

    const nameTag = document.createElement('div');
    nameTag.className = 'player-name-tag';
    nameTag.textContent = player ? getPlayerName(player) : '?';
    nameTag.style.cssText = '-webkit-text-size-adjust:none;text-size-adjust:none;font-size:9px;font-weight:700;';

    dot.appendChild(circleWrap);
    dot.appendChild(nameTag);
    display.appendChild(dot);
  }
}

// team1DataのTEAM_DATAキーを返す
function getTeam1DataKey() {
  return _team1DataKey;
}

// D&D 状態管理
const dragState = { dragging: false, sourceType: null, sourcePos: null, sourcePlayerIdx: null };

function scrollBench(dir) {
  var bench = document.getElementById('bench-list');
  var itemW = 68; // bench-item幅+gap
  bench.scrollBy({ left: dir * itemW * 3, behavior: 'smooth' });
}

function renderBench() {
  const bench = document.getElementById('bench-list');
  bench.innerHTML = '';
  const inLineup = new Set(team1State.lineup.slice(0, 11));

  team1Data.players.forEach((p, idx) => {
    if (inLineup.has(idx)) return;

    const isSubbedOff = _subbedOff.has(idx);

    const item = document.createElement('div');
    item.className = 'bench-item';
    item.dataset.playerIdx = idx;
    if (isSubbedOff) {
      item.style.opacity = '0.35';
      item.style.cursor = 'default';
      item.title = '出場済み（再出場不可）';
    }

    const circle = document.createElement('div');
    circle.className = 'bench-item-circle';
    circle.style.background = isSubbedOff ? '#bbb' : '#888';
    circle.textContent = POS_ABBR[p.positions[0]] || p.positions[0].replace(/[左右]/g,'').substring(0,2);

    const name = document.createElement('div');
    name.className = 'bench-item-name';
    name.textContent = getPlayerName(p);

    const posLabel = document.createElement('div');
    posLabel.className = 'bench-item-pos';
    posLabel.textContent = POS_ABBR[p.positions[0]] || p.positions[0].replace(/[左右]/g,'').substring(0,2);

    item.appendChild(circle);
    item.appendChild(name);
    item.appendChild(posLabel);

    // タップ・長押しで選手詳細ページへ
    item.onclick = () => { if (!dragState.dragging) showPlayerDetail(getTeam1DataKey(), idx); };

    item.addEventListener('touchstart', e => {
      if (_subbedOff.has(idx)) return; // 再出場不可
      e.preventDefault();
      dragState.dragging = false;
      dragState.sourceType = 'bench';
      dragState.sourcePos = null;
      dragState.sourcePlayerIdx = idx;
      dragState.ghostShown = false;
      dragState.activeDot = item;
      item.classList.add('dragging');
      dragState.longPressTimer = setTimeout(() => {
        if (!dragState.dragging) showPlayerDetail(getTeam1DataKey(), idx);
      }, 500);
    }, { passive: false });

    item.addEventListener('touchmove', e => {
      e.preventDefault();
      clearTimeout(dragState.longPressTimer);
      dragState.dragging = true;
      const t = e.touches[0];
      if (!dragState.ghostShown) {
        showGhost(p.name, t.clientX, t.clientY);
        dragState.ghostShown = true;
      }
      moveGhost(t.clientX, t.clientY);
      highlightDropTarget(t.clientX, t.clientY);
    }, { passive: false });

    item.addEventListener('touchend', e => {
      e.preventDefault();
      clearTimeout(dragState.longPressTimer);
      const t = e.changedTouches[0];
      applyDrop(t.clientX, t.clientY);
      item.classList.remove('dragging');
      hideGhost();
      clearHighlight();
      setTimeout(() => { dragState.dragging = false; }, 50);
    }, { passive: false });

    item.addEventListener('mousedown', e => {
      e.preventDefault();
      dragState.dragging = false;
      dragState.sourceType = 'bench';
      dragState.sourcePos = null;
      dragState.sourcePlayerIdx = idx;
      dragState.ghostShown = false;
      dragState.activeDot = item;
      item.classList.add('dragging');
    });

    bench.appendChild(item);
  });
}
function openPlayerParams(playerIdx) {
  const p = team1Data.players[playerIdx];
  document.getElementById('params-name').textContent = getPlayerName(p);
  const lnEl = document.getElementById('params-long-name');
  if (lnEl) lnEl.style.display = 'none';
  document.getElementById('params-pos').textContent = p.positions.join(' / ');

  const grid = document.getElementById('params-grid');
  grid.innerHTML = '';
  PARAM_NAMES.forEach((name, i) => {
    if(i === 12 || i === 28) return;
    const val = (p.params[i] !== undefined ? p.params[i] : 0);
    const color = val >= 85 ? '#B8001F' : val >= 75 ? '#003087' : val >= 60 ? '#2d7a3a' : '#aaa';
    const item = document.createElement('div');
    item.className = 'param-item';
    item.innerHTML = `
      <div class="param-label">${name}</div>
      <div class="param-bar-wrap">
        <div class="param-bar"><div class="param-bar-fill" style="width:${val}%;background:${color}"></div></div>
        <div class="param-value">${val}</div>
      </div>`;
    grid.appendChild(item);
  });
  document.getElementById('modal-params').classList.add('open');
}

// PC マウスD&D（documentレベルで一括管理）
document.addEventListener('mousemove', e => {
  if (dragState.sourceType === null) return;
  if (!dragState.ghostShown && (Math.abs(e.movementX) > 3 || Math.abs(e.movementY) > 3)) {
    dragState.dragging = true;
    const name = dragState.sourceType === 'bench'
      ? (team1Data.players[dragState.sourcePlayerIdx] ? team1Data.players[dragState.sourcePlayerIdx].name : '?')
      : (team1Data.players[team1State.lineup[dragState.sourcePos]] ? team1Data.players[team1State.lineup[dragState.sourcePos]].name : '?');
    showGhost(name, e.clientX, e.clientY);
    dragState.ghostShown = true;
  }
  if (dragState.ghostShown) {
    moveGhost(e.clientX, e.clientY);
    highlightDropTarget(e.clientX, e.clientY);
  }
});

document.addEventListener('mouseup', e => {
  if (dragState.sourceType === null) return;
  if (dragState.dragging) {
    applyDrop(e.clientX, e.clientY);
  }
  if (dragState.activeDot) dragState.activeDot.classList.remove('dragging');
  hideGhost();
  clearHighlight();
  setTimeout(() => {
    dragState.dragging = false;
    dragState.sourceType = null;
    dragState.activeDot = null;
  }, 50);
});

function applyDrop(x, y) {
  const targetPos = getDropTargetPos(x, y);
  if (targetPos === null) return;

  const targetPlayerIdx = team1State.lineup[targetPos];

  if (dragState.sourceType === 'bench') {
    // ベンチ→スタメン（交代）
    // ハーフタイムモード中は人数制限チェック
    if (_htMode) {
      const totalSubs = subsCount + htSubsCount;
      if (totalSubs >= 5) {
        alert('交代は最大5人までです（W杯ルール）');
        return;
      }
      // 退く選手を交代済みセットに追加（再出場不可）
      _subbedOff.add(targetPlayerIdx);
      htSubsCount++;
      _updateHtSubsLabel();
    }
    // 交代ログに記録
    const _outP = team1Data.players[targetPlayerIdx];
    const _inP  = team1Data.players[dragState.sourcePlayerIdx];
    if (_outP && _inP) _pendingSubLog.push({ out: _outP.name, outEn: _outP.en_name, in: _inP.name, inEn: _inP.en_name });
    team1State.lineup[targetPos] = dragState.sourcePlayerIdx;
  } else if (dragState.sourceType === 'starter') {
    // スタメン→スタメン（ポジション入れ替え、交代消費なし）
    team1State.lineup[targetPos] = dragState.sourcePlayerIdx;
    team1State.lineup[dragState.sourcePos] = targetPlayerIdx;
  }

  renderFormation();
  renderBench();
  updateSettingBtnValues();
}

function showGhost(name, x, y) {
  const g = document.getElementById('drag-ghost');
  g.textContent = name;
  g.style.display = 'block';
  moveGhost(x, y);
}

function moveGhost(x, y) {
  const g = document.getElementById('drag-ghost');
  g.style.left = x + 'px';
  g.style.top = (y - 44) + 'px';
}

function hideGhost() {
  document.getElementById('drag-ghost').style.display = 'none';
}

function getDropTargetPos(x, y) {
  const dots = document.querySelectorAll('#formation-display .player-dot');
  for (const dot of dots) {
    const rect = dot.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (Math.hypot(x - cx, y - cy) < 38) {
      const pos = parseInt(dot.dataset.pos);
      // スタメン→スタメンで同じポジションへは無効
      if (dragState.sourceType === 'starter' && pos === dragState.sourcePos) return null;
      return pos;
    }
  }
  return null;
}

function highlightDropTarget(x, y) {
  clearHighlight();
  const pos = getDropTargetPos(x, y);
  if (pos !== null) {
    var _doel = document.querySelector('#formation-display .player-dot[data-pos="'+pos+'"]'); if(_doel) _doel.classList.add('drag-over');
  }
}

function clearHighlight() {
  document.querySelectorAll('.player-dot.drag-over').forEach(d => d.classList.remove('drag-over'));
}

function openPlayerSelect(pos) {
  editingPosition = pos;
  const sys = system_data[team1State.systemIdx];
  document.getElementById('modal-pos-name').textContent = sys.positions[pos] + t('posSelect');

  const list = document.getElementById('player-select-list');
  list.innerHTML = '';

  team1Data.players.forEach((p, i) => {
    const inUse = team1State.lineup.indexOf(i) >= 0 && team1State.lineup.indexOf(i) !== pos;
    const item = document.createElement('div');
    item.className = 'player-select-item' + (team1State.lineup[pos] === i ? ' current' : '');
    item.style.opacity = inUse ? '0.4' : '1';
    item.innerHTML = `<div class="psi-num">${i}</div><div class="psi-name">${getPlayerName(p)}</div><div class="psi-pos">${p.positions.join('/')}</div>`;
    if (!inUse) {
      item.onclick = () => {
        team1State.lineup[pos] = i;
        if (team1State.keyplayer === pos) renderKeyplayer();
        renderFormation();
        renderBench();
        closeModal('modal-player');
      };
    }
    list.appendChild(item);
  });
  document.getElementById('modal-player').classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// ============================================================
// GAME ENGINE
// ============================================================

function startGame() {
  // 延長戦は _runWCETPhase() で処理するため setting 画面からは実行しない
  if (wcPhase === 'et_first' || wcPhase === 'et_second') return;

  // Setup opponent state
  const t2sys = system_data.findIndex(s => s.name === team2Data.default_system);
  team2State = {
    systemIdx: t2sys >= 0 ? t2sys : 0,
    tactics: team2Data.default_tactics,
    keyplayer: team2Data.default_keyplayer,
    marked_player: team2Data.default_marked_player !== undefined ? team2Data.default_marked_player : -1,
    lineup: [...team2Data.default_lineup.slice(0, 11)]
  };

  // Reset game
  chanceResults = [];
  currentChanceIdx = 0;
  currentSceneIdx = 0;
  currentEventDiv = null;
  halfTimeShown = false;
  halfTimeScore = { t1: 0, t2: 0 };
  subsCount = 0;
  subsUsed = 0;
  htSubsCount = 0;
  _htMode = false;
  _subbedOff = new Set();
  _pendingSubLog = [];

  // Build team objects
  const t1 = buildTeam(team1Data, team1State);
  const t2 = buildTeam(team2Data, team2State);

  gameState = { team1: t1, team2: t2 };
  // 相手がマークする日本の最前線選手を自動設定
  // CF/WG/OMF/SMF の中から攻撃能力上位2名をピックし、ランダムで1名を選ぶ
  coachMarkTarget = -1;
  const _frontTypes = ['CF','WG','OMF','SMF'];
  const _frontCandidates = [];
  for (let _pos = 1; _pos < 11; _pos++) {
    if (_frontTypes.includes(t1.getPositionType(_pos))) {
      const _p = t1.players[t1.lineup[_pos]];
      const _ofRating = (PLAYER_EXTRA[_p.name] && PLAYER_EXTRA[_p.name].of)
        ? PLAYER_EXTRA[_p.name].of
        : (_p.params[11] + _p.params[12] + _p.params[13] + _p.params[17]) / 4;
      _frontCandidates.push({ pos: _pos, rating: _ofRating });
    }
  }
  _frontCandidates.sort(function(a, b) { return b.rating - a.rating; });
  const _top2front = _frontCandidates.slice(0, 2);
  if (_top2front.length > 0) {
    coachMarkTarget = _top2front[Math.floor(Math.random() * _top2front.length)].pos;
  } else {
    coachMarkTarget = 10;
  }
  t1.score = 0; t2.score = 0;
  t1.chanceCounter = 0; t2.chanceCounter = 0;
  t1.shootCounter = 0; t2.shootCounter = 0;
  t1.gkSaveCounter = 0; t2.gkSaveCounter = 0;

  // Reset player states
  [t1, t2].forEach(t => {
    t.players.forEach(p => {
      p.chance_counter = 0;
      p.fatigue = 0;
    });
  });

  // Pre-simulate chances（延長戦はシーン数を削減）
  if (wcPhase === 'et_first') {
    for (let i = 0; i < 3; i++) chanceResults.push(simulateChance(gameState, i));
  } else if (wcPhase === 'et_second') {
    for (let i = 0; i < 3; i++) chanceResults.push(simulateChance(gameState, i));
    if (Math.random() < 0.5) chanceResults.push(simulateChance(gameState, 3));
  } else {
    // 通常: 前半8 + 後半8 + ロスタイム最大1
    for (let i = 0; i < 16; i++) chanceResults.push(simulateChance(gameState, i));
    if (Math.random() < 0.5) chanceResults.push(simulateChance(gameState, 16));
  }

  // Update UI
  document.getElementById('score-flag1').textContent = team1Data.flag;
  document.getElementById('score-flag2').textContent = team2Data.flag;
  document.getElementById('score-name1').textContent = getTeamName(team1Data);
  document.getElementById('score-name2').textContent = getTeamName(team2Data);
  document.getElementById('score1').textContent = '0';
  document.getElementById('score2').textContent = '0';
  document.getElementById('log-area').innerHTML = '';
  _pendingCoachCardEl = null; // コーチカード保留をリセット
  // 案A: ライブフィールドをリセット
  const _lfw = document.getElementById('live-field-wrap');
  if (_lfw) { _lfw.style.display = 'none'; _lfw.innerHTML = ''; }
  document.getElementById('chance-count').textContent = '0';
  document.getElementById('chance-total').textContent = chanceResults.length;
  document.getElementById('next-btn').disabled = false;

  showScreen('game');
}

function buildTeam(data, state) {
  const sys = system_data[state.systemIdx];
  return {
    name: data.name,
    team_color: data.team_color,
    flag: data.flag,
    players: data.players.map(p => ({...p, params:[...p.params]})),
    lineup: [...state.lineup],
    system: state.systemIdx,
    tactics: state.tactics,
    keyplayer: state.keyplayer,
    marked_player: state.marked_player !== undefined ? state.marked_player : -1,
    score: 0,
    chanceCounter: 0,
    shootCounter: 0,
    gkSaveCounter: 0,
    getPlayer: function(n) { return this.players[n]; },
    getPlayerAtPos: function(pos) { return this.players[this.lineup[pos]]; },
    getSystem: function() { return system_data[this.system]; },
    getPositionName: function(pos) { return system_data[this.system].positions[pos]; },
    getPositionType: function(pos) {
      let res = this.getPositionName(pos);
      if (res[0] === '右' || res[0] === '左') return res.substring(1);
      return res;
    }
  };
}

function getActionParam(team, pos, action) {
  const p = team.players[team.lineup[pos]];
  const params = p.params;
  // Apply condition factor
  let f = 1.0;
  const postype = team.getPositionType(pos);
  const positions = p.positions;
  // 得意ポジション以外に配置された場合 -5%（左右含めて判定）
  const fieldPosName = team.getPositionName(pos); // 例:「右SMF」
  if (!positions.includes(fieldPosName) && !positions.includes(postype)) f -= 0.05;

  const adjusted = params.map(v => v * Math.max(f, 0.01));

  // Tactics
  if (team.tactics === TACTICS_PRESS) {
    // 守備補正なし（カウンター発動率のみで差別化）
  } else if (team.tactics === TACTICS_COUNTER) {
    if (['SMF','CMF','DMF','SW'].includes(postype) || postype.endsWith('B')) {
      for (let i = 20; i <= 29; i++) adjusted[i] *= 1.05;
    }
  } else if (team.tactics === TACTICS_CATENACCIO) {
    if (['SMF','CMF','DMF','SW'].includes(postype) || postype.endsWith('B') || postype === 'CB') {
      for (let i = 20; i <= 26; i++) adjusted[i] *= 1.10;
    }
  }

  const a = adjusted;
  switch (action) {
    case 'ショートパス': return a[SHORTPASS];
    case '対ショートパス': return (a[RESPONSE]+a[PASS_CUT]+a[TACKLE])/3;
    case 'ロングパス': return a[LONGPASS];
    case '対ロングパス': return (a[RESPONSE]+a[PASS_CUT])/2;
    case 'ドリブル突破': return (a[ACCELERATION]+a[AGILITY]+a[DRIBBLE_ACCURACY]+a[DRIBBLE_SPEED])/4;
    case '対ドリブル突破': return (a[RESPONSE]+a[TACKLE]+a[MAN_MARKING])/3;
    case '飛び出し': return (a[ACCELERATION]+a[RESPONSE]+a[AGILITY]+a[POSITIONING]+a[OFFENSIVE])/5;
    case '対飛び出し': return (a[RESPONSE]+a[ACCELERATION]+a[AGILITY]+a[COVERING]+a[CHASING])/5;
    case 'ポストプレー': return (a[POWER]+a[RESPONSE]+a[BALL_TECH])/3;
    case '対ポストプレー': return (a[POWER]+a[RESPONSE]+a[TACKLE]+a[MAN_MARKING])/4;
    case 'クロス': return (a[LONGPASS]+a[CURVE])/2;
    case '対クロス': return (a[ACCELERATION]+a[RESPONSE]+a[PASS_CUT]+a[TACKLE]+a[MAN_MARKING])/5;
    case 'ミドルシュート': return (a[SHOOT_ACCURACY]+a[SHOOT_TECH]+a[POWER])/3;
    case '対ミドルシュート':
      if (pos === 0) return (a[RESPONSE]+a[JUMP]+a[POSITIONING]+a[SAVING])/4;
      return (a[RESPONSE]+a[POSITIONING]+a[COVERING])/3;
    case '中央からシュート': return (a[SHOOT_ACCURACY]+a[SHOOT_TECH]+a[MENTALITY])/3;
    case 'サイドからシュート': return (a[SHOOT_ACCURACY]+a[SHOOT_TECH]+a[MENTALITY])/3*0.95;
    case '対中央からシュート':
    case '対サイドからシュート': return (a[RESPONSE]+a[JUMP]+a[POSITIONING]+a[MENTALITY]+a[SAVING])/5;
    case 'ボレーシュート': return (a[SHOOT_ACCURACY]+a[SHOOT_TECH]+a[BALL_TECH]+a[POSITIONING])/4*1.1;
    case '対ボレーシュート':
      if (pos === 0) return (a[RESPONSE]+a[JUMP]+a[POSITIONING]+a[SAVING])/4;
      return (a[RESPONSE]+a[MAN_MARKING]+a[POSITIONING])/3;
    case 'ヘディングシュート': return (a[JUMP]+a[HEADING]+a[POSITIONING])/3*1.1;
    case '対ヘディングシュート':
      if (pos === 0) return (a[RESPONSE]+a[JUMP]+a[POSITIONING]+a[SAVING])/4;
      return (a[RESPONSE]+a[JUMP]+a[MAN_MARKING]+a[HEADING]+a[POSITIONING])/5;
    case 'フリーキック': return a[FREEKICK_ACCURACY];
    case '対フリーキック': return (a[RESPONSE]+a[JUMP]+a[SAVING]+a[POSITIONING]+a[MENTALITY])/5;
  }
  return 50;
}

function getTeamTotalParam(team) {
  let total = 0;
  for (let pos = 0; pos < 11; pos++) {
    const p = team.players[team.lineup[pos]];
    p.params.forEach(v => total += v);
  }
  return total;
}

function selectOffencePosition(team, area, exclude) {
  const positions = system_data[team.system].positions;
  const offences = area_data[area].offences;
  const a = [];
  let sum = 0;
  for (let i = offences.length - 1; i >= 0; i--) {
    const j = positions.indexOf(offences[i][0]);
    if (j >= 0) {
      if (exclude !== undefined && j === exclude) continue; // 除外ポジション
      let rate = offences[i][1];
      if (j === team.keyplayer) rate *= 2.5;
      sum += rate;
      a.push([j, sum]);
    }
  }
  if (a.length === 0) {
    // GKを除くフィールド選手からランダム選択
    for (let i = 1; i < positions.length; i++) {
      if (exclude === undefined || i !== exclude) return i;
    }
    return 1;
  }
  const r = Math.random();
  for (let i = 0; i < a.length; i++) {
    if (r < a[i][1] / sum) return a[i][0];
  }
  return a[a.length - 1][0];
}

function selectDefencePosition(offTeam, defTeam, area, ofsPos, omit) {
  const a = area_data[area].matchup[offTeam.getPositionName(ofsPos)];
  if (!a) return 0;
  const positions = system_data[defTeam.system].positions;
  const p0=[],p1=[],p2=[],p3=[],p4=[];

  [p0,p1,p2,p3,p4].forEach((arr,i) => {
    (a[i]||[]).forEach(name => {
      const idx = positions.indexOf(name);
      if (idx >= 0 && idx !== omit) arr.push(idx);
    });
  });

  // matchupに該当ポジションがない場合はGKを除くフィールド選手からランダム選択
  const fallbackPos = [];
  for (let i = 1; i < positions.length; i++) { // GK(0)を除く
    if (i !== omit) fallbackPos.push(i);
  }
  const fallback = fallbackPos.length > 0 ? fallbackPos[Math.floor(Math.random()*fallbackPos.length)] : 1;

  if (!p0.length && !p1.length && !p2.length && !p3.length && !p4.length) return fallback;

  for (let tries = 0; tries < 100; tries++) {
    const r = Math.random();
    if (p0.length > 0 && r < 0.45) return p0[Math.floor(Math.random()*p0.length)];
    if (p1.length > 0 && r < 0.80) return p1[Math.floor(Math.random()*p1.length)];
    if (p2.length > 0) return p2[Math.floor(Math.random()*p2.length)];
    if (p3.length > 0) return p3[Math.floor(Math.random()*p3.length)];
    if (p4.length > 0) return p4[Math.floor(Math.random()*p4.length)];
  }
  return fallback;
}

function selectAction(offTeam, area, pos) {
  const areaData = area_data[area];
  const a = [...areaData.actions];
  const areaType = area.substring(0, 2);

  const p = [];
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.max(getActionParam(offTeam, pos, a[i]) - 60, 0);
    p.push(sum);
  }
  if (sum === 0) return a[a.length - 1];

  const r = Math.random();
  for (let i = 0; i < a.length; i++) {
    if (r < p[i] / sum) return a[i];
  }
  return a[a.length - 1];
}

// エリア名のL/Rを反転する（team2攻撃時に使用）
function flipAreaSide(area) {
  if (area.endsWith('_L')) return area.slice(0, -1) + 'R';
  if (area.endsWith('_R')) return area.slice(0, -1) + 'L';
  return area;
}

function selectArea(defTeam) {
  const areas = ['MF_M','MF_L','MF_R','DF_M','DF_L','DF_R'];
  let n = 6;
  if (defTeam.tactics === TACTICS_COUNTER || defTeam.tactics === TACTICS_CATENACCIO) n = 3;
  return areas[Math.floor(Math.random() * n)];
}

function selectNextArea(lastScene) {
  let pos = lastScene.area.substring(0, 2);
  let side = lastScene.area.substring(3);

  if (lastScene.result === 'カウンター') {
    if (pos === 'DF') pos = 'FW';
    else if (pos === 'FW') pos = 'DF';
    if (side === 'R') side = 'L';
    else if (side === 'L') side = 'R';
  }

  if (pos === 'FW') {
    // FW_Mは直接シュート（CR_Mは存在しないので'SHOOT_M'として扱う）
    // FW_R/LはCRエリア（クロス候補判定）へ
    if (side === 'M') return 'SHOOT_M';
    pos = 'CR';
    // sideはそのまま（L→CR_L、R→CR_R）
  } else {
    if (pos === 'DF') {
      if (lastScene.result !== 'カウンター' && lastScene.action === 'ロングパス') pos = 'FW';
      else pos = 'MF';
    } else {
      pos = 'FW';
    }
    const r = Math.random();
    if (side === 'M') {
      if (r < 0.3) side = 'L';
      else if (r < 0.6) side = 'R';
    } else {
      if (r < 0.4) side = 'M';
    }
  }
  return pos + '_' + side;
}

function testCounter(defTeam, area, offTeam) {
  const pos = area.substring(0, 2);
  const side = area.substring(3);
  let f = 0.05;
  if (defTeam.tactics === TACTICS_PRESS && (pos === 'FW' || pos === 'MF')) f = 0.2;
  else if (defTeam.tactics === TACTICS_COUNTER && (pos === 'DF' || pos === 'MF')) f = 0.2;
  else if (offTeam && offTeam.tactics === TACTICS_POSSESSION) f = 0.1;
  // 前線中央(FW_M)での守備勝利は戦術に関係なく40%
  if (pos === 'FW' && side === 'M') f = 0.4;
  return Math.random() < f;
}

function selectFKKicker(team) {
  let best = [0, getActionParam(team, 0, 'フリーキック')];
  let second = [1, getActionParam(team, 1, 'フリーキック')];
  for (let i = 2; i < 11; i++) {
    const n = getActionParam(team, i, 'フリーキック');
    if (n >= best[1]) { second = [...best]; best = [i, n]; }
    else if (n >= second[1]) second = [i, n];
  }
  return (Math.random() < 0.7 ? best : second)[0];
}

function calcTime(chanceNo) {
  const r = Math.random();
  // 延長戦：wcPhase に応じて延長前半/後半の実際の時間帯を返す
  if (wcPhase === 'et_first') {
    if (chanceNo === 0) return `${t('etFirst')} ${Math.floor(r*5)+91}${t('minUnit')}`;
    if (chanceNo === 1) return `${t('etFirst')} ${Math.floor(r*5)+96}${t('minUnit')}`;
    if (chanceNo === 2) return `${t('etFirst')} ${Math.floor(r*4)+101}${t('minUnit')}`;
    return `${t('etFirst')} 105+${t('minUnit')}`;
  }
  if (wcPhase === 'et_second') {
    if (chanceNo === 0) return `${t('etSecond')} ${Math.floor(r*5)+106}${t('minUnit')}`;
    if (chanceNo === 1) return `${t('etSecond')} ${Math.floor(r*5)+111}${t('minUnit')}`;
    if (chanceNo === 2) return `${t('etSecond')} ${Math.floor(r*4)+116}${t('minUnit')}`;
    return `${t('etSecond')} 120+${t('minUnit')}`;
  }
  // 通常90分 (前半8シーン: 0-7, 後半8シーン: 8-15, オプション: 16)
  if (chanceNo <= 6) return `${t('halfFirst')} ${Math.floor(r*6) + chanceNo*6 + 1}${t('minUnit')}`;
  if (chanceNo === 7) return `${t('halfFirst')} 45+${Math.floor(r*3)+1}${t('minUnit')}`;
  if (chanceNo <= 14) return `${t('halfSecond')} ${Math.floor(r*6) + (chanceNo-8)*6 + 46}${t('minUnit')}`;
  if (chanceNo === 15) return `${t('halfSecond')} 90+${Math.floor(r*3)+1}${t('minUnit')}`;
  return t('overtimeLoss');
}

function simulateChance(gs, chanceNo) {
  const {team1, team2} = gs;
  const time = calcTime(chanceNo);

  let t1point = getTeamTotalParam(team1);
  let t2point = getTeamTotalParam(team2);

  // ホームアドバンテージ（メキシコ戦）
  if (isWCR16Mode && wcR16Opponent === TEAM_DATA.mexico2026) {
    t2point *= 1.08;
  }

  if (team1.tactics === TACTICS_POSSESSION) t1point *= 1.30;
  else if (team1.tactics === TACTICS_PRESS) t1point *= 0.90;
  else if (team1.tactics === TACTICS_COUNTER) t1point *= 0.85;
  else if (team1.tactics === TACTICS_CATENACCIO) t1point *= 0.70;
  if (team2.tactics === TACTICS_POSSESSION) t2point *= 1.30;
  else if (team2.tactics === TACTICS_PRESS) t2point *= 0.90;
  else if (team2.tactics === TACTICS_COUNTER) t2point *= 0.85;
  else if (team2.tactics === TACTICS_CATENACCIO) t2point *= 0.70;

  // まるごとシミュレート専用: 開催国/過去優勝国のチーム力ブースト（他モードでは未設定=1.0）
  t1point *= (window._wcsimMul1 || 1);
  t2point *= (window._wcsimMul2 || 1);

  let offence = Math.random() < t1point / (t1point + t2point) ? team1 : team2;
  let defence = offence === team1 ? team2 : team1;

  const scenes = [];
  let inCounter = false;
  let fwChanceCounted = false;

  // Scene 1
  // team2攻撃時はエリアのL/Rを反転（team2の左右はteam1基準と逆）
  let needFlip = (offence === team2);
  let rawArea = selectArea(defence);  // flip前の生エリア（selectNextArea用）
  let area = needFlip ? flipAreaSide(rawArea) : rawArea;
  let ofsPos = selectOffencePosition(offence, area);
  let ofsPlayer = offence.players[offence.lineup[ofsPos]];
  ofsPlayer.chance_counter++;
  ofsPlayer.fatigue++;

  let dfsPos = selectDefencePosition(offence, defence, area, ofsPos, -1);
  let dfsPlayer = defence.players[defence.lineup[dfsPos]];
  dfsPlayer.chance_counter++;
  dfsPlayer.fatigue++;

  let action = selectAction(offence, area, ofsPos);
  let ofsPoint = getActionParam(offence, ofsPos, action);
  let dfsPoint = getActionParam(defence, dfsPos, '対'+action);

  if (defence === team1 && team2.marked_player >= 0 && ofsPos === team2.marked_player) ofsPoint *= 0.85;
  if (defence === team1 && team1.marked_player >= 0 && offence.lineup[ofsPos] === team1.marked_player) ofsPoint *= 0.85;

  let result = (function(o,d){var p=o*o/(o*o+d*d);return Math.random()<p?'成功':'失敗'})(ofsPoint,dfsPoint);
  let scene = { offence, defence, area, rawArea, ofsPos, dfsPos, action, scenario: action, result, ofsPoint: Math.round(ofsPoint), dfsPoint: Math.round(dfsPoint), dfsAction: '対'+action };
  scenes.push(scene);

  if (result === '失敗' && !inCounter && testCounter(defence, area, offence)) {
    inCounter = true;
    [offence, defence] = [defence, offence];
    needFlip = !needFlip;
    ofsPos = dfsPos;
    ofsPlayer = dfsPlayer;
    scene.result = 'カウンター';
    fwChanceCounted = false; // カウンター後の攻撃チャンスをリセット
  }

  // Subsequent scenes
  // カウンター直後フラグ（奪取選手を最初のシーンで固定するため）
  let isCounterFirstScene = (scene.result === 'カウンター');
  // CB/GK/SBがカウンター奪取した場合は次シーンで固定しない（すぐMFへ展開する想定）
  const _counterPosType0 = scene.result === 'カウンター' ? offence.getPositionType(ofsPos) : null;
  const _isDeepDefender0 = _counterPosType0 && ['GK','CB','SB'].includes(_counterPosType0);
  let useCounterPlayer = (scene.result === 'カウンター') && !_isDeepDefender0;
  // カウンター時の奪取選手のofsPos（whileに入る前にdfsPos→ofsPosに設定済み）
  let counterOfsPos = ofsPos;

  while (scene.result === '成功' || scene.result === 'カウンター') {
    // selectNextAreaにはflip前のrawAreaを渡す（side判定がズレないように）
    rawArea = selectNextArea({...scene, area: scene.rawArea});

    if (isCounterFirstScene) {
      // カウンター直後のエリア計算
      // 奪取エリアを反転した上で次エリアへ進める
      // DF_*で奪取 → 反転でFW_* → すでに前線なのでCR/SHOOT_Mに直行
      // MF_*で奪取 → 反転でMF_* → FW_*へ1段前進
      // FW_*で奪取 → 反転でDF_* → MF_*へ1段前進
      const _prevZone = scene.area.substring(0, 2);
      const _prevSide = scene.area.substring(3);
      const _nextSide = _prevSide === 'L' ? 'R' : _prevSide === 'R' ? 'L' : 'M';

      if (_prevZone === 'DF') {
        // 相手陣地（DF付近）で奪取 → 反転でFW → CR/SHOOT_Mに直行
        area = _prevSide === 'M' ? 'SHOOT_M' : 'CR_' + _nextSide;
      } else {
        // MF/FWで奪取 → 1段前進（MF→FW、FW→MF）
        const _nextZone = _prevZone === 'MF' ? 'FW' : 'MF';
        area = _nextZone + '_' + _nextSide;
      }
      rawArea = needFlip ? flipAreaSide(area) : area;
      isCounterFirstScene = false;
    } else {
      area = needFlip ? flipAreaSide(rawArea) : rawArea;
    }
    if (area.substring(0, 2) === 'CR' || area === 'SHOOT_M') break;

    // カウンター直後の1シーンは奪取選手を固定、以降は通常抽選
    if (useCounterPlayer) {
      ofsPos = counterOfsPos;
      useCounterPlayer = false;
    } else {
      ofsPos = selectOffencePosition(offence, area);
    }
    if (scene.action === 'ロングパス') {
      let tries = 0;
      while (ofsPos === scene.ofsPos && tries++ < 10)
        ofsPos = selectOffencePosition(offence, area);
      if (ofsPos === scene.ofsPos) {
        for (let _i = 1; _i < 11; _i++) { if (_i !== scene.ofsPos) { ofsPos = _i; break; } }
      }
    }
    ofsPlayer = offence.players[offence.lineup[ofsPos]];
    ofsPlayer.chance_counter++;
    ofsPlayer.fatigue++;

    dfsPos = selectDefencePosition(offence, defence, area, ofsPos,
      scene.result === '成功' ? scene.dfsPos : scene.result === 'カウンター' ? scene.ofsPos : -1);
    dfsPlayer = defence.players[defence.lineup[dfsPos]];
    dfsPlayer.chance_counter++;
    dfsPlayer.fatigue++;

    action = selectAction(offence, area, ofsPos);

    // ドリブル突破でFW_Mに侵入した場合のみ、その選手がミドルシュートを打つ
    if (action === 'ミドルシュート' && scenes.length > 0) {
      const prevScene = scenes[scenes.length - 1];
      if (prevScene.action === 'ドリブル突破') {
        ofsPos = prevScene.ofsPos;
        ofsPlayer = offence.players[offence.lineup[ofsPos]];
      }
    }

    // ミドルシュートはFW/WG/OMF/CMF/DMF系のみ許可
    // それ以外(SB/CB/GK/SMF等)が選ばれた場合は別アクションに変更
    if (action === 'ミドルシュート') {
      const _allowedMid = ['CF','FW','WG','OMF','CMF','DMF'];
      const _postype = offence.getPositionType(ofsPos);
      if (!_allowedMid.includes(_postype)) {
        // ミドルシュートを除いたアクションから再選択
        const _altActions = area_data[area].actions.filter(a => a !== 'ミドルシュート');
        action = _altActions.length > 0 ? _altActions[Math.floor(Math.random() * _altActions.length)] : 'ショートパス';
      }
    }

    ofsPoint = getActionParam(offence, ofsPos, action);
    dfsPoint = getActionParam(defence, dfsPos, '対'+action);
    if (defence === team1 && team2.marked_player >= 0 && ofsPos === team2.marked_player) ofsPoint *= 0.85;
    if (defence === team1 && team1.marked_player >= 0 && offence.lineup[ofsPos] === team1.marked_player) ofsPoint *= 0.85;
    result = (function(o,d){var p=o*o/(o*o+d*d);return Math.random()<p?'成功':'失敗'})(ofsPoint,dfsPoint);

    // scenario はアクション名をそのまま使うが、'クロス'は CRエリアのクロスシーン専用識別子と
    // 衝突するため、FWエリアでクロスを選んだ場合は区別できる名前にする
    const scenarioName = action === 'クロス' ? 'サイドクロス' : action;
    scene = { offence, defence, area, rawArea, ofsPos, dfsPos, action, scenario: scenarioName, result, ofsPoint: Math.round(ofsPoint), dfsPoint: Math.round(dfsPoint), dfsAction: '対'+action };
    scenes.push(scene);

    // ミドルシュートが選ばれたらwhileを抜けて後処理へ
    if (action === 'ミドルシュート') {
      break;
    }

    if (area.substring(0, 2) === 'FW' && !fwChanceCounted) {
      offence.chanceCounter++;
      fwChanceCounted = true;
    }
    if (result === '成功' && area.substring(0, 2) === 'FW') {
      const fp = (100 - defence.players[defence.lineup[dfsPos]].params[FAIR_PLAY]) / 100;
      if (Math.random() < fp) {
        area = 'CR_' + area.substring(area.length-1);
        scene.result = 'ファール';
        break;
      }
    } else if (result === '失敗' && !inCounter && testCounter(defence, area, offence)) {
      inCounter = true;
      [offence, defence] = [defence, offence];
      needFlip = !needFlip;
      ofsPos = dfsPos;
      ofsPlayer = dfsPlayer;
      scene.result = 'カウンター';
      isCounterFirstScene = true;  // 次シーンでエリア修正ロジックを動かす
      fwChanceCounted = false;     // カウンター後の攻撃チャンスをリセット
      // CB/GK/SBが奪取した場合は次シーンで固定しない
      const _counterPosTypeW = offence.getPositionType(ofsPos);
      const _isDeepDefenderW = ['GK','CB','SB'].includes(_counterPosTypeW);
      useCounterPlayer = !_isDeepDefenderW;
      counterOfsPos = ofsPos;      // 奪取選手を更新
    }
  }

  // Cross / Shoot
  let goalScored = null;
  let finalArea = area;

  // ===== ミドルシュート処理 =====
  // whileループ内でaction='ミドルシュート'が選ばれてbreakした場合
  // 最後のsceneのofsPos（FW_Mで実際に選ばれた選手）をそのまま使う
  const lastScene = scenes[scenes.length - 1];
  if (lastScene && lastScene.action === 'ミドルシュート') {
    offence.chanceCounter++;
    offence.shootCounter++;
    const midOfsPos = lastScene.ofsPos;
    const midDfsPos = lastScene.dfsPos;
    // ブロック判定
    const blockOfsPoint = getActionParam(offence, midOfsPos, 'ミドルシュート');
    const blockDfsPoint = getActionParam(defence, midDfsPos, '対ミドルシュート');
    if (blockOfsPoint <= blockDfsPoint) {
      // ブロックされた → lastSceneを更新
      lastScene.result = 'ブロック';
      lastScene.scenario = 'ミドルシュート';
      scenes[scenes.length - 1] = lastScene;
    } else {
      // ブロック突破 → lastSceneを削除してGK対決シーンのみ残す
      scenes.pop();
      const midOfsPoint = blockOfsPoint * 0.82;
      const midDfsPoint = getActionParam(defence, 0, '対ミドルシュート');
      let midResult;
      if (Math.random() * 100 > midOfsPoint) {
        midResult = '枠を外した！';
      } else if (Math.random() < (midOfsPoint * midOfsPoint) / (midOfsPoint * midOfsPoint + midDfsPoint * midDfsPoint)) {
        midResult = 'ゴール！！';
        offence.score++;
        goalScored = offence;
      } else {
        midResult = 'GK防いだ！';
        defence.gkSaveCounter++;
      }
      const midScene = {
        offence, defence, area, rawArea,
        ofsPos: midOfsPos, dfsPos: midDfsPos,
        action: 'ミドルシュート', scenario: 'ミドルシュート',
        result: midResult,
        ofsPoint: Math.round(midOfsPoint), dfsPoint: Math.round(midDfsPoint),
        dfsAction: '対ミドルシュート'
      };
      scenes.push(midScene);
    }
    finalArea = area;
  } else if (area === 'SHOOT_M') {
    // 仕様：FW_M成功 → 直接「中央からシュート」
    offence.chanceCounter++;
    offence.shootCounter++;
    const shootArea = scene.area; // FW_M
    const shootOfsPos = ofsPos;
    ofsPoint = getActionParam(offence, shootOfsPos, '中央からシュート');
    dfsPos = 0; // GK
    dfsPoint = getActionParam(defence, 0, '対中央からシュート');
    if (defence === team1 && team2.marked_player >= 0 && shootOfsPos === team2.marked_player) ofsPoint *= 0.85;
    if (defence === team1 && team1.marked_player >= 0 && offence.lineup[shootOfsPos] === team1.marked_player) ofsPoint *= 0.85;

    let shootResult;
    if (Math.random() * 100 > ofsPoint) {
      shootResult = '枠を外した！';
    } else if (Math.random() < (ofsPoint * ofsPoint) / (ofsPoint * ofsPoint + dfsPoint * dfsPoint)) {
      shootResult = 'ゴール！！';
      offence.score++;
      goalScored = offence;
    } else {
      shootResult = 'GK防いだ！';
      defence.gkSaveCounter++;
    }
    scene = { offence, defence, area: shootArea, crossPos: shootOfsPos, ofsPos: shootOfsPos, dfsPos: 0, action: '中央からシュート', scenario: 'シュート', result: shootResult, ofsPoint: Math.round(ofsPoint), dfsPoint: Math.round(dfsPoint), dfsAction: '対中央からシュート' };
    scenes.push(scene);

  } else if (area.substring(0, 2) === 'CR') {
    let crossPos, crossPlayer, shootAction;

    // カウンター状態でCRエリアに入った場合はファール扱いではなく通常クロスとして処理
    const entryResult = scene.result === 'カウンター' ? '成功' : scene.result;

    if (entryResult === 'ファール') {
      if (area.substring(area.length-1) === 'M') {
        ofsPos = selectFKKicker(offence);
        ofsPlayer = offence.players[offence.lineup[ofsPos]];
        action = 'フリーキック';
        crossPos = ofsPos;
        crossPlayer = ofsPlayer;
        shootAction = 'フリーキック';
      } else {
        crossPos = selectFKKicker(offence);
        crossPlayer = offence.players[offence.lineup[crossPos]];
        ofsPos = crossPos;
        let _spTries = 0;
        while (ofsPos === crossPos && _spTries++ < 10) ofsPos = selectOffencePosition(offence, area);
        if (ofsPos === crossPos) {
          for (let _i = 1; _i < 11; _i++) { if (_i !== crossPos) { ofsPos = _i; break; } }
        }
        ofsPlayer = offence.players[offence.lineup[ofsPos]];
        // セットプレーもクロスエリアのアクション（ボレー/ヘディング）から選択
        const spActions = area_data[area] ? area_data[area].actions : ['ボレーシュート','ヘディングシュート'];
        action = spActions[Math.floor(Math.random() * spActions.length)];
        ofsPoint = getActionParam(offence, ofsPos, action);
        dfsPos = selectDefencePosition(offence, defence, area, ofsPos,
          scene.result === 'カウンター' ? scene.ofsPos : scene.dfsPos);
        dfsPlayer = defence.players[defence.lineup[dfsPos]];
        ofsPoint = getActionParam(offence, ofsPos, action);
        dfsPoint = getActionParam(defence, dfsPos, '対'+action);
        if (defence === team1 && team2.marked_player >= 0 && ofsPos === team2.marked_player) ofsPoint *= 0.85;
        if (defence === team1 && team1.marked_player >= 0 && offence.lineup[ofsPos] === team1.marked_player) ofsPoint *= 0.85;
        result = (function(o,d){var p=o*o/(o*o+d*d);return Math.random()<p?'成功':'失敗'})(ofsPoint,dfsPoint);
        scene = { offence, defence, area, crossPos, ofsPos, dfsPos, action, scenario: 'セットプレー', result, ofsPoint: Math.round(ofsPoint), dfsPoint: Math.round(dfsPoint), dfsAction: '対'+action };
        scenes.push(scene);
        shootAction = action;
      }
    } else {
      if (area.substring(area.length-1) === 'M') {
        action = '中央からシュート';
        crossPos = ofsPos;
        crossPlayer = ofsPlayer;
        shootAction = '中央からシュート';
      } else {
        crossPos = ofsPos;
        crossPlayer = ofsPlayer;
        // 25%の確率でサイドから切れ込みシュート（同一選手）。
        // ただし「クロス」アクション成功からの継続は、必ず別選手へのクロスにする
        // （＝同一選手の切れ込みを禁止）。クロス能力で抜けて自分でシュート、という
        // 矛盾（絵=クロス／文=切れ込み）を防ぐため。非クロス系とカウンター直行は従来どおり。
        const allowCutIn = !(scene.scenario === 'サイドクロス' && scene.result === '成功');
        if (allowCutIn && Math.random() < 0.25) {
          action = 'サイドからシュート';
          shootAction = 'サイドからシュート';
        } else {
          // crossPos（クロスした選手）を除外して受け手を抽選
          let newOfsPos = selectOffencePosition(offence, area, crossPos);
          // フォールバック（全員がcrossPosだった場合）
          if (newOfsPos === crossPos || newOfsPos === undefined) {
            for (let _i = 1; _i < 11; _i++) {
              if (_i !== crossPos) { newOfsPos = _i; break; }
            }
          }
          if (newOfsPos === crossPos) {
            action = 'サイドからシュート';
            shootAction = 'サイドからシュート';
          } else {
            ofsPos = newOfsPos;
            ofsPlayer = offence.players[offence.lineup[ofsPos]];
            // クロスエリアのアクション（ボレー/ヘディング）から選択
            const crActions = area_data[area] ? area_data[area].actions : ['ボレーシュート','ヘディングシュート'];
            action = crActions[Math.floor(Math.random() * crActions.length)];
            ofsPoint = getActionParam(offence, ofsPos, action);
            dfsPos = selectDefencePosition(offence, defence, area, ofsPos,
              (entryResult === 'カウンター' || scene.result === 'カウンター') ? scene.ofsPos : scene.dfsPos);
            dfsPlayer = defence.players[defence.lineup[dfsPos]];
            dfsPoint = getActionParam(defence, dfsPos, '対'+action);
            if (defence === team1 && team2.marked_player >= 0 && ofsPos === team2.marked_player) ofsPoint *= 0.85;
            if (defence === team1 && team1.marked_player >= 0 && offence.lineup[ofsPos] === team1.marked_player) ofsPoint *= 0.85;
            result = (function(o,d){var p=o*o/(o*o+d*d);return Math.random()<p?'成功':'失敗'})(ofsPoint,dfsPoint);
            scene = { offence, defence, area, crossPos, ofsPos, dfsPos, action, scenario: 'クロス', result, ofsPoint: Math.round(ofsPoint), dfsPoint: Math.round(dfsPoint), dfsAction: '対'+action };
            scenes.push(scene);
            shootAction = action;
          }
        }
      }
    }

    // Shoot scene
    if (scene.result !== '失敗') {
      if (!fwChanceCounted) { offence.chanceCounter++; fwChanceCounted = true; } // FW未経由（カウンター直行等）でもチャンス計上
      offence.shootCounter++;
      dfsPos = 0; // GK
      dfsPlayer = defence.players[defence.lineup[0]];
      ofsPoint = getActionParam(offence, ofsPos, shootAction);
      dfsPoint = getActionParam(defence, 0, '対'+shootAction);
      if (defence === team1 && team2.marked_player >= 0 && ofsPos === team2.marked_player) ofsPoint *= 0.85;
      if (defence === team1 && team1.marked_player >= 0 && offence.lineup[ofsPos] === team1.marked_player) ofsPoint *= 0.85;

      let shootResult;
      if (Math.random() * 100 > ofsPoint) {
        shootResult = '枠を外した！';
      } else if (Math.random() < (ofsPoint * ofsPoint) / (ofsPoint * ofsPoint + dfsPoint * dfsPoint)) {
        shootResult = 'ゴール！！';
        offence.score++;
        goalScored = offence;
      } else {
        shootResult = 'GK防いだ！';
        defence.gkSaveCounter++;
      }

      scene = { offence, defence, area, crossPos: scene.crossPos||ofsPos, ofsPos, dfsPos:0, action: shootAction, scenario: 'シュート', result: shootResult, ofsPoint: Math.round(ofsPoint), dfsPoint: Math.round(dfsPoint), dfsAction: '対'+shootAction };
      scenes.push(scene);
    }
  }

  // Convert scenes to text
  const textScenes = [];
  for (let i = 0; i < scenes.length; i++) {
    textScenes.push(sceneToText(scenes, i, team1, team2));
  }

  return { time, scenes, textScenes, goalScored, t1score: team1.score, t2score: team2.score };
}

function sceneToText(scenes, sceneNo, team1, team2) {
  const scene = scenes[sceneNo];
  // result が カウンター の場合はキー生成上は 失敗 として扱う（元APKの挙動に合わせる）
  const resultForKey = scene.result === 'カウンター' ? 'カウンター' : scene.result;
  let key = scene.scenario + '|' + resultForKey;

  if (['ショートパス','ロングパス','ドリブル突破','飛び出し','ポストプレー','サイドクロス'].includes(scene.scenario)) {
    if ((scene.result === '成功') && sceneNo + 1 < scenes.length) {
      const ns = scenes[sceneNo + 1];
      const nsScenario = ns.scenario;
      key += '|' + nsScenario;
      // クロス・シュート・セットプレーへ続く場合は 同/別 を付けない
      if (!['クロス','シュート','セットプレー','ミドルシュート'].includes(nsScenario)) {
        key += (scene.ofsPos === ns.ofsPos ? '|同' : '|別');
      }
    }
    // 成功以外（失敗・カウンター・ファール）はそのまま
  } else if (['クロス','シュート','セットプレー'].includes(scene.scenario)) {
    key += '|' + scene.action;
  } else if (scene.scenario === 'ミドルシュート') {
    key += '|ミドルシュート';
  }

  let s = getScenarioData()[key];
  if (Array.isArray(s)) s = s[Math.floor(Math.random() * s.length)];

  // フォールバック: キーが見つからない場合
  if (!s) {
    const scenario = scene.scenario;
    const res = scene.result;

    // パス/ドリブル系が成功して次がクロス/シュート/セットプレーへ続く場合
    // → 「XXX|成功|クロス」や「XXX|成功|シュート」が未定義なら汎用文を生成
    if (['ショートパス','ロングパス','ドリブル突破','飛び出し','ポストプレー','サイドクロス'].includes(scenario) && res === '成功') {
      const nextScenario = sceneNo + 1 < scenes.length ? scenes[sceneNo+1].scenario : '';
      if (['クロス','シュート','セットプレー'].includes(nextScenario)) {
        // ショートパスの同等キーで代替
        const altKey = 'ショートパス|成功|' + nextScenario;
        s = getScenarioData()[altKey];
      }
      // まだない場合はシナリオ別の汎用文
      if (!s) {
        if (window.LANG === 'en') {
          if (scenario === 'ロングパス') s = '【攻撃選手】 plays a long ball! 【守備選手】 can\'t stop it.';
          else if (scenario === '飛び出し') s = '【対象エリア】, 【攻撃選手】 makes a brilliant run past 【守備選手】!';
          else s = '【攻撃選手】 gets past 【守備選手】 and breaks through 【対象エリア】!';
        } else {
          if (scenario === 'ロングパス') s = '【対象エリア】の【攻撃選手】がロングパス！  【守備選手】はこれを止められず、ボールが前線へ！';
          else if (scenario === '飛び出し') s = '【対象エリア】、パスに反応した【攻撃選手】が絶妙な飛び出しで【守備選手】を振り切る！';
          else s = '【攻撃選手】が【守備選手】をかわし【対象エリア】を突破！';
        }
      }
    }

    // カウンター系のフォールバック
    if (!s && res === 'カウンター') {
      const counterKey = scenario + '|カウンター';
      s = getScenarioData()[counterKey];
      if (!s) s = window.LANG === 'en' ? '【対象エリア】, 【守備選手】 wins the ball and launches a counter-attack!' : '【対象エリア】、【守備選手】がボールを奪いカウンター発動！';
    }

    // それでも見つからない場合は汎用
    if (!s) s = window.LANG === 'en' ? '【攻撃選手】 and 【守備選手】 battle for the ball. (' + key + ')' : '【攻撃選手】が【守備選手】との攻防を繰り広げた。（' + key + '）';
  }

  const _areaNameForText = window.LANG === 'en'
    ? ({
        'DF_L':'DF Left','DF_M':'DF Center','DF_R':'DF Right',
        'MF_L':'MF Left','MF_M':'MF Center','MF_R':'MF Right',
        'FW_L':'FW Left','FW_M':'FW Center','FW_R':'FW Right',
        'CR_L':'Cross Left','CR_R':'Cross Right','SHOOT_M':'Shooting Area'
      }[scene.area] || scene.area)
    : (area_data[scene.area] ? area_data[scene.area].name : scene.area);
  s = s.replace(/【対象エリア】/g, _areaNameForText);
  s = s.replace(/【攻撃選手】/g, coloredName(scene.offence, scene.ofsPos));
  s = s.replace(/【守備選手】/g, coloredName(scene.defence, scene.dfsPos));
  s = s.replace(/【シュート選手】/g, coloredName(scene.offence, scene.ofsPos));
  s = s.replace(/【GK選手】/g, coloredName(scene.defence, 0));
  if (scene.crossPos !== undefined) {
    s = s.replace(/【クロス選手】/g, coloredName(scene.offence, scene.crossPos));
  }
  if (sceneNo + 1 < scenes.length) {
    s = s.replace(/【次の攻撃選手】/g, coloredName(scene.offence, scenes[sceneNo+1].ofsPos));
  }
  return s;
}

function coloredName(team, pos) {
  const p = team.players[team.lineup[pos]];
  return `<span style="color:${team.team_color};font-weight:bold">${p ? getPlayerName(p) : '?'}</span>`;
}

// ============================================================
// GAME UI
// ============================================================

// 現在表示中のチャンス内のシーンインデックス
let currentSceneIdx = 0;
let _shootSubStep = 0;   // シュート系シーンの3分割の現在ビート（0=シュート/1=GKダイブ/2=結果）。0でシーン境界。
let currentEventDiv = null;
let _pendingCoachCardEl = null; // 次の「次へ」で表示するコーチカードを一時退避

// ============================================================
// FIELD GRAPHIC
// ============================================================

const AREA_COORDS_H = {
  'DF_M':   { x: 15, y: 50 },
  'DF_L':   { x: 15, y: 20 },
  'DF_R':   { x: 15, y: 80 },
  'MF_M':   { x: 50, y: 50 },
  'MF_L':   { x: 50, y: 25 },
  'MF_R':   { x: 50, y: 75 },
  'FW_M':   { x: 78, y: 50 },
  'FW_L':   { x: 78, y: 20 },
  'FW_R':   { x: 78, y: 80 },
  'CR_L':   { x: 88, y: 50 },
  'CR_R':   { x: 88, y: 50 },
  'CR_M':   { x: 88, y: 50 },
  'SHOOT_M':{ x: 88, y: 50 },
};

function renderSceneField(sc, prevSc) {
  // ============================================================
  // 案A: フォーカスモードフィールド（全幅・ゾーンカラー・軌跡）
  // ============================================================
  const W = 390, H = 195;
  const isTeam1Offence = sc.offence === gameState.team1;
  const ofColor = sc.offence.team_color || '#003087';
  const dfColor = sc.defence.team_color || '#CC6600';
  const ofP = sc.offence.players[sc.offence.lineup[sc.ofsPos]];
  const dfP = sc.defence.players[sc.defence.lineup[sc.dfsPos]];
  const ofName = ofP ? getPlayerName(ofP) : '?';
  const dfName = dfP ? getPlayerName(dfP) : '?';

  const flip = !isTeam1Offence;
  const toX = (px) => ((flip ? (100 - px) : px) / 100) * W;
  const toY = (py) => (py / 100) * H;  // Y軸はフリップしない（横向きフィールド）

  const raw = AREA_COORDS_H[sc.area] || { x: 50, y: 50 };
  const cx = toX(raw.x), cy = toY(raw.y);

  // 前シーン座標（ボール軌跡用）
  const prevRaw = prevSc ? (AREA_COORDS_H[prevSc.area] || null) : null;
  const isCounterTransition = prevSc && (prevSc.offence !== sc.offence);
  const prevFlip = isCounterTransition ? !flip : flip;
  const prevToX = (px) => ((prevFlip ? (100 - px) : px) / 100) * W;
  const prevToY = (py) => (py / 100) * H;
  const pcx = prevRaw ? prevToX(prevRaw.x) : null;
  const pcy = prevRaw ? prevToY(prevRaw.y) : null;

  const uid = `fs${currentChanceIdx}_${currentSceneIdx}`;

  // ゾーン境界（team1基準で固定: 左=team1守備、右=team1攻撃）
  const zoneLeft  = Math.round(W * 0.28);  // 109px
  const zoneRight = Math.round(W * 0.72);  // 281px

  // ゴールポスト
  const goalH = 36, goalW = 10;
  const goalY = H / 2 - goalH / 2;

  // 結果バッジテキスト
  const _isEn = window.LANG === 'en';
  const resultColor = sc.result === 'ゴール！！' ? '#FFD700'
    : sc.result === '成功'       ? '#44DD66'
    : sc.result === 'カウンター' ? '#FF8C00'
    : sc.result === 'ファール'   ? '#FFD700'
    : '#FF6666';
  const resultText = sc.result === 'ゴール！！' ? '⚽ GOAL!!'
    : sc.result === '成功'       ? (_isEn ? '✅ Success'    : '✅ 成功')
    : sc.result === 'カウンター' ? (_isEn ? '↩️ Counter'    : '↩️ カウンター')
    : sc.result === 'ファール'   ? (_isEn ? '🟨 Foul'       : '🟨 ファール')
    : sc.result === 'GK防いだ！' ? (_isEn ? '🧤 Saved'      : '🧤 セーブ')
    : sc.result === '枠を外した！'? (_isEn ? '💨 Off Target' : '💨 枠外')
    : sc.result === 'ブロック'   ? (_isEn ? '🛡️ Blocked'    : '🛡️ ブロック')
    :                               (_isEn ? '❌ Failed'     : '❌ 失敗');
  const AREA_NAME_EN = {
    'DF_L':'DF Left','DF_M':'DF Center','DF_R':'DF Right',
    'MF_L':'MF Left','MF_M':'MF Center','MF_R':'MF Right',
    'FW_L':'FW Left','FW_M':'FW Center','FW_R':'FW Right',
    'CR_L':'Cross Left','CR_R':'Cross Right','SHOOT_M':'Shot'
  };
  const _areaName = window.LANG === 'en'
    ? (AREA_NAME_EN[sc.area] || sc.area)
    : (area_data[sc.area] ? area_data[sc.area].name : sc.area);

  // 攻撃チームのラベル（左右）
  const atkLabel = _isEn ? (sc.offence.name + ' →') : ('⬅ ' + sc.offence.name);
  const t1Label  = _isEn ? (gameState.team1.name + ' →') : (gameState.team1.name + ' →');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.cssText = 'display:block;width:100%';

  // ────── 1. 背景グラデーション ──────
  svg.innerHTML = `
    <defs>
      <linearGradient id="bg${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#1a5c1a"/>
        <stop offset="50%"  stop-color="#236b23"/>
        <stop offset="100%" stop-color="#1a5c1a"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg${uid})"/>

    <!-- ゾーンオーバーレイ（team1基準固定） -->
    <rect x="0"          y="0" width="${zoneLeft}"       height="${H}" fill="rgba(0,48,135,0.18)"/>
    <rect x="${zoneRight}" y="0" width="${W-zoneRight}"  height="${H}" fill="rgba(188,0,45,0.14)"/>

    <!-- ゾーン区切り線 -->
    <line x1="${zoneLeft}"  y1="0" x2="${zoneLeft}"  y2="${H}" stroke="rgba(255,255,255,0.12)" stroke-width="1" stroke-dasharray="4 4"/>
    <line x1="${zoneRight}" y1="0" x2="${zoneRight}" y2="${H}" stroke="rgba(255,255,255,0.12)" stroke-width="1" stroke-dasharray="4 4"/>

    <!-- ピッチライン -->
    <rect x="8" y="6" width="${W-16}" height="${H-12}" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.2"/>
    <line x1="${W/2}" y1="6" x2="${W/2}" y2="${H-6}" stroke="rgba(255,255,255,0.4)" stroke-width="0.9"/>
    <circle cx="${W/2}" cy="${H/2}" r="32" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.9"/>
    <circle cx="${W/2}" cy="${H/2}" r="2"  fill="rgba(255,255,255,0.55)"/>

    <!-- ゴールエリア（左） -->
    <rect x="8"  y="${H/2-32}" width="36" height="64" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="0.8"/>
    <rect x="8"  y="${H/2-16}" width="16" height="32" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.35)" stroke-width="0.8"/>
    <!-- ゴールポスト（左） -->
    <rect x="${8-goalW}" y="${goalY}" width="${goalW}" height="${goalH}" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.5)" stroke-width="0.8"/>

    <!-- ゴールエリア（右） -->
    <rect x="${W-44}" y="${H/2-32}" width="36" height="64" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="0.8"/>
    <rect x="${W-24}" y="${H/2-16}" width="16" height="32" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.35)" stroke-width="0.8"/>
    <!-- ゴールポスト（右） -->
    <rect x="${W-8}" y="${goalY}" width="${goalW}" height="${goalH}" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.5)" stroke-width="0.8"/>

    <!-- ゾーンラベル -->
    <text x="${zoneLeft/2}"           y="${H-6}" text-anchor="middle" font-size="8" fill="rgba(120,170,255,0.7)" font-family="sans-serif" font-weight="bold">${_isEn ? 'DEF' : '自陣'}</text>
    <text x="${(zoneLeft+zoneRight)/2}" y="${H-6}" text-anchor="middle" font-size="8" fill="rgba(255,220,100,0.55)" font-family="sans-serif" font-weight="bold">${_isEn ? 'MID' : '中盤'}</text>
    <text x="${(zoneRight+W)/2}"      y="${H-6}" text-anchor="middle" font-size="8" fill="rgba(255,120,100,0.7)"  font-family="sans-serif" font-weight="bold">${_isEn ? 'ATK' : '敵陣'}</text>
  `;

  // ────── 簡略表示: 軌跡・選手名・結果バッジは省略し、マッチアップが起きているエリアだけを示す ──────
  // エリアハイライト（リング＋中心ドット）
  const _isGoal = sc.result === 'ゴール！！';
  const hl = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
  hl.setAttribute('cx', cx); hl.setAttribute('cy', cy);
  hl.setAttribute('rx', '34'); hl.setAttribute('ry', '30');
  hl.setAttribute('fill', _isGoal ? 'rgba(255,215,0,0.22)' : 'rgba(255,235,120,0.16)');
  hl.setAttribute('stroke', _isGoal ? 'rgba(255,215,0,0.9)' : 'rgba(255,235,120,0.7)');
  hl.setAttribute('stroke-width', '2');
  svg.appendChild(hl);
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', '4');
  dot.setAttribute('fill', _isGoal ? '#ffd700' : '#ffe14a');
  svg.appendChild(dot);

  // ────── 選手バッジ・ゴールフラッシュ・結果バッジは簡略化のため省略（エリア名のみ下に表示）──────

  const albl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  albl.setAttribute('x', W - 10); albl.setAttribute('y', H - 9);
  albl.setAttribute('text-anchor', 'end'); albl.setAttribute('font-size', '10');
  albl.setAttribute('font-weight', 'bold'); albl.setAttribute('font-family', 'sans-serif');
  albl.setAttribute('fill', 'rgba(255,255,255,0.78)');
  albl.setAttribute('paint-order', 'stroke'); albl.setAttribute('stroke', 'rgba(0,0,0,0.55)'); albl.setAttribute('stroke-width', '2.5');
  albl.textContent = _areaName;
  svg.appendChild(albl);

  return svg;
}

// ============================================================
// ハーフタイムモーダル
// ============================================================
// ============================================================
// 交代ログ挿入
// ============================================================
function _insertSubLog(timeLabel) {
  if (!_pendingSubLog.length) return;
  const logArea = document.getElementById('log-area');
  if (!logArea) { _pendingSubLog = []; return; }
  const isEn = window.LANG === 'en';
  const div = document.createElement('div');
  div.className = 'log-event normal';
  div.style.cssText = 'background:#f0f8f2;border-left:3px solid #2d7a3a;padding:8px 12px;margin-bottom:8px;border-radius:4px';
  const timeDiv = document.createElement('div');
  timeDiv.className = 'log-time';
  timeDiv.textContent = timeLabel;
  div.appendChild(timeDiv);
  const textDiv = document.createElement('div');
  textDiv.className = 'log-text';
  textDiv.style.color = '#2d7a3a';
  textDiv.innerHTML = _pendingSubLog.map(function(s) {
    const outDisp = (isEn && s.outEn) ? s.outEn : s.out;
    const inDisp  = (isEn && s.inEn)  ? s.inEn  : s.in;
    return '🔄 ' + outDisp + ' → ' + inDisp;
  }).join('<br>');
  div.appendChild(textDiv);
  logArea.appendChild(div);
  logArea.scrollTop = logArea.scrollHeight;
  _pendingSubLog = [];
}

// ============================================================
// コーチ情報カード
// ============================================================
function _buildCoachCard(label, body) {
  const div = document.createElement('div');
  div.className = 'coach-card';
  div.innerHTML = '<div class="coach-card-icon">💬</div><div><div class="coach-card-label">' + label + '</div><div class="coach-card-body">' + body + '</div></div>';
  return div;
}

function _maybeInsertCoachCard() {
  if (wcPhase === 'et_first' || wcPhase === 'et_second') return;
  const isEn = window.LANG === 'en';

  // 前半序盤（チャンス1完了後 = currentChanceIdx===2）: 相手キープレイヤー
  if (currentChanceIdx === 2 && gameState && gameState.team2) {
    const kp = gameState.team2.players[gameState.team2.lineup[gameState.team2.keyplayer]];
    if (kp) {
      const name = isEn ? (kp.en_name || kp.name) : kp.name;
      const msg = isEn
        ? 'The opponent is building their attack around <b>' + name + '</b>.'
        : '相手は <b>' + name + '</b> 選手にボールを集めているようです。';
      // 直接挿入せず保留変数に退避 → 次の「次へ」で表示
      _pendingCoachCardEl = _buildCoachCard(isEn ? "Coach's Note" : 'コーチからの指摘', msg);
    }
  }

  // 前半中盤（チャンス3完了後 = currentChanceIdx===4）: 相手がマークするteam1選手
  if (currentChanceIdx === 4 && coachMarkTarget >= 0 && gameState && gameState.team1) {
    const jp = gameState.team1.players[gameState.team1.lineup[coachMarkTarget]];
    if (jp) {
      const name = isEn ? (jp.en_name || jp.name) : jp.name;
      const msg = isEn
        ? 'The opponent is closely marking <b>' + name + '</b>. Watch out for tight coverage.'
        : gameState.team1.name + 'の <b>' + name + '</b> 選手へのマークがキツイですね。';
      // 直接挿入せず保留変数に退避 → 次の「次へ」で表示
      _pendingCoachCardEl = _buildCoachCard(isEn ? "Coach's Note" : 'コーチからの指摘', msg);
    }
  }
}

function _runDuelSimBothSides(n) {
  // 攻守両面のデュエル＋エリア別勝率を n 回シミュレーションで集計（ハーフタイム・試合終了共通）
  const stats1 = {}, stats2 = {};
  const areaAtk = {}, areaDef = {}; // team1 のエリア別攻撃/防守傾向
  const _aFlip = {'DF':'FW','FW':'DF','MF':'MF','CR':'CR','SHOOT':'CR'};
  for (let i = 0; i < n; i++) {
    const _bldSt = function(data, overrideLineup) {
      const si = system_data.findIndex(function(s) { return s.name === data.default_system; });
      const ln = (overrideLineup && overrideLineup.length >= 11) ? overrideLineup : data.default_lineup;
      return { systemIdx: si >= 0 ? si : 0, tactics: data.default_tactics,
               keyplayer: data.default_keyplayer,
               marked_player: data.default_marked_player !== undefined ? data.default_marked_player : -1,
               lineup: [...ln.slice(0, 11)] };
    };
    const bt1 = buildTeam(team1Data, _bldSt(team1Data, team1State && team1State.lineup));
    const bt2 = buildTeam(team2Data, _bldSt(team2Data, team2State && team2State.lineup));
    [bt1, bt2].forEach(function(t) {
      t.score = 0; t.chanceCounter = 0; t.shootCounter = 0; t.gkSaveCounter = 0;
      t.players.forEach(function(p) { p.chance_counter = 0; p.fatigue = 0; });
    });
    const bgs = { team1: bt1, team2: bt2 };
    const bRes = [];
    for (let j = 0; j < 16; j++) bRes.push(simulateChance(bgs, j));
    if (Math.random() < 0.5) bRes.push(simulateChance(bgs, 16));
    bRes.forEach(function(res) {
      if (!res || !res.scenes) return;
      res.scenes.forEach(function(sc) {
        const isShoot  = ['ゴール！！','GK防いだ！','枠を外した！'].includes(sc.result);
        const isNormal = ['成功','失敗','ファール'].includes(sc.result);
        if (!isNormal && !isShoot) return;
        const win = isShoot ? sc.result === 'ゴール！！' : sc.result === '成功' || sc.result === 'ファール';
        const ofsP = sc.offence.players[sc.offence.lineup[sc.ofsPos]];
        const dfsP = sc.defence.players[sc.defence.lineup[sc.dfsPos]];
        // デュエル集計（通常シーンのみ）
        if (isNormal) {
          if (sc.offence === bt1 && ofsP) {
            if (!stats1[ofsP.name]) stats1[ofsP.name] = { win: 0, lose: 0, enName: ofsP.en_name };
            win ? stats1[ofsP.name].win++ : stats1[ofsP.name].lose++;
          }
          if (sc.defence === bt1 && dfsP) {
            if (!stats1[dfsP.name]) stats1[dfsP.name] = { win: 0, lose: 0, enName: dfsP.en_name };
            win ? stats1[dfsP.name].lose++ : stats1[dfsP.name].win++;
          }
          if (sc.offence === bt2 && ofsP) {
            if (!stats2[ofsP.name]) stats2[ofsP.name] = { win: 0, lose: 0, enName: ofsP.en_name };
            win ? stats2[ofsP.name].win++ : stats2[ofsP.name].lose++;
          }
          if (sc.defence === bt2 && dfsP) {
            if (!stats2[dfsP.name]) stats2[dfsP.name] = { win: 0, lose: 0, enName: dfsP.en_name };
            win ? stats2[dfsP.name].lose++ : stats2[dfsP.name].win++;
          }
        }
        // エリア別集計（通常＋シュートシーン）
        if (sc.offence === bt1) {
          const ak = (['FW_L','CR_L'].includes(sc.area)) ? 'GOAL_L'
                   : (['FW_M','CR_M','SHOOT_M'].includes(sc.area)) ? 'GOAL_M'
                   : (['FW_R','CR_R'].includes(sc.area)) ? 'GOAL_R' : sc.area;
          if (!areaAtk[ak]) areaAtk[ak] = { win: 0, lose: 0 };
          win ? areaAtk[ak].win++ : areaAtk[ak].lose++;
        }
        if (sc.defence === bt1) {
          const rw = sc.area === 'SHOOT_M' ? 'CR_M' : sc.area;
          const p2 = rw.substring(0, rw.indexOf('_'));
          const s2 = rw.substring(rw.indexOf('_')+1);
          const fa = (_aFlip[p2]||p2) + '_' + (s2==='L'?'R':s2==='R'?'L':s2);
          const dk = (['FW_L','CR_L'].includes(fa)) ? 'GOAL_L'
                   : (['FW_M','CR_M','SHOOT_M','CR_CENTER'].includes(fa)) ? 'GOAL_M'
                   : (['FW_R','CR_R'].includes(fa)) ? 'GOAL_R' : fa;
          if (!areaDef[dk]) areaDef[dk] = { win: 0, lose: 0 };
          win ? areaDef[dk].lose++ : areaDef[dk].win++;
        }
      });
    });
  }
  return { stats1: stats1, stats2: stats2, areaAtk: areaAtk, areaDef: areaDef };
}

function _showHalfTimeModal() {
  const s1 = halfTimeScore.t1, s2 = halfTimeScore.t2;
  document.getElementById('ht-score').textContent =
    `${team1Data.flag} ${getTeamName(team1Data)}  ${s1} - ${s2}  ${getTeamName(team2Data)} ${team2Data.flag}`;

  // 戦術ボタン描画
  _buildHtTactics();

  // デュエル傾向（50回シミュレーション・攻守両面）
  const htAdvEl = document.getElementById('ht-duel-advice');
  if (htAdvEl) {
    const isEn = window.LANG === 'en';
    htAdvEl.innerHTML = '<div style="color:#888;font-size:12px;padding:4px 0">⚙️ ' + (isEn ? 'Analysing...' : '分析中...') + '</div>';
    setTimeout(function() {
      const simData = _runDuelSimBothSides(50);
      const stats1  = simData.stats1;

      const entries = [];
      if (gameState && gameState.team1) {
        for (let _p = 1; _p < 11; _p++) {
          const pl = gameState.team1.players[gameState.team1.lineup[_p]];
          if (!pl) continue;
          const st = stats1[pl.name];
          if (!st) continue;
          const total = st.win + st.lose;
          const rate  = total > 0 ? Math.round(st.win / total * 100) : 0;
          entries.push({ name: pl.name, enName: pl.en_name, rate: rate });
        }
      }
      entries.sort(function(a, b) { return a.rate - b.rate; });

      if (!entries.length) { htAdvEl.innerHTML = ''; return; }

      const worst     = entries[0];
      const worstName = isEn ? (worst.enName || worst.name) : worst.name;

      const rows = entries.map(function(e) {
        const dispName = isEn ? (e.enName || e.name) : e.name;
        const barColor = e.rate >= 60 ? '#2d7a3a' : e.rate >= 40 ? '#e07a00' : '#B8001F';
        return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0">'
          + '<div style="width:5em;font-size:11px;font-weight:700;overflow:hidden;white-space:nowrap">' + dispName + '</div>'
          + '<div style="flex:1;background:#eee;border-radius:4px;height:7px;overflow:hidden"><div style="width:' + e.rate + '%;background:' + barColor + ';height:100%;border-radius:4px"></div></div>'
          + '<div style="width:3em;text-align:right;font-size:11px;font-weight:700;color:' + barColor + '">' + e.rate + '%</div>'
          + '</div>';
      }).join('');

      const advice = isEn
        ? '<b>' + worstName + '</b> is struggling in duels. Consider your options.'
        : '<b>' + worstName + '</b> 選手が苦戦しています。対策を検討しましょう。';

      htAdvEl.innerHTML =
        '<div style="margin-bottom:6px;font-size:12px;font-weight:700;color:#1a3a6b">📊 '
        + (isEn ? 'Duel Situation' : 'デュエル状況') + '</div>'
        + rows
        + '<div style="margin-top:10px;padding:10px 12px;background:linear-gradient(135deg,#0a2a5c,#0d4a28);border-left:4px solid #f39c12;border-radius:8px;color:white;font-size:12px;line-height:1.6">'
        + '🎙️ ' + advice + '</div>';
    }, 80);
  }

  document.getElementById('halftime-modal').style.display = 'flex';
  document.getElementById('next-btn').disabled = true;
  document.getElementById('all-btn').disabled = true;
}

function _buildHtTactics() {
  const list = document.getElementById('ht-tactics-list');
  if (!list) return; // モーダルから戦術セクションを削除した場合は無視
  list.innerHTML = '';
  const names = t('tacticsNames');
  names.forEach((name, i) => {
    const selected = team1State.tactics === i;
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.style.cssText = `padding:7px 11px;border-radius:8px;border:2px solid ${selected ? '#1a3a6b' : '#ddd'};background:${selected ? '#1a3a6b' : 'white'};color:${selected ? 'white' : '#333'};font-size:12px;font-weight:700;font-family:inherit;cursor:pointer`;
    btn.onclick = () => {
      team1State.tactics = i;
      _buildHtTactics();
    };
    list.appendChild(btn);
  });
}

// ハーフタイムから既存システム選択画面へ
function htOpenFormation() {
  document.getElementById('halftime-modal').style.display = 'none';
  renderFormationGrid(htCloseFormation);
  showScreen('formation');
  // 戻るボタンもハーフタイムへ
  const backBtn = document.querySelector('#screen-formation .back-btn');
  if (backBtn) backBtn.onclick = htCloseFormation;
}

function htCloseFormation() {
  const backBtn = document.querySelector('#screen-formation .back-btn');
  if (backBtn) backBtn.onclick = closeFormationSelect;
  updateSettingBtnValues();
  renderFormation();
  renderBench();
  showScreen('game');
  document.getElementById('halftime-modal').style.display = 'flex';
  _buildHtTactics();
}

// ハーフタイムから既存設定画面（フォーメーション＋控え）へ
function htOpenLineup() {
  document.getElementById('halftime-modal').style.display = 'none';
  _htMode = true;
  htSubsCount = 0;
  updateSettingBtnValues();
  renderFormation();
  renderBench();
  // 設定画面のキックオフボタンを非表示、戻るボタンをモーダルに戻るよう差し替え
  document.getElementById('btn-kickoff-top').style.display = 'none';
  document.getElementById('btn-kickoff-bottom').closest('div').style.display = 'none';
  const _htBackBtn = document.createElement('button');
  _htBackBtn.className = 'back-btn';
  _htBackBtn.id = 'ht-lineup-back-btn';
  _htBackBtn.textContent = window.LANG === 'en' ? '← Half Time' : '← ハーフタイムへ';
  _htBackBtn.onclick = htCloseLineup;
  const header = document.querySelector('#screen-setting .screen-header');
  header.dataset.htMode = '1';
  // 元の「戻る」ボタンを非表示（ハーフタイム中は対戦相手変更を防ぐ）
  const _origBack = header.querySelector('.back-btn:not(#ht-lineup-back-btn)');
  if (_origBack) _origBack.style.display = 'none';
  header.insertBefore(_htBackBtn, header.firstChild);
  // 交代人数ラベルを追加
  const subLabel = document.createElement('div');
  subLabel.id = 'ht-subs-label';
  subLabel.style.cssText = 'font-size:12px;color:#888;text-align:center;padding:4px 0 8px';
  const benchEl = document.getElementById('bench-list');
  benchEl.parentNode.insertBefore(subLabel, benchEl);
  _updateHtSubsLabel();
  showScreen('setting');
}

function htCloseLineup() {
  _htMode = false;
  subsCount += htSubsCount;
  htSubsCount = 0;
  // 追加した要素を削除
  const header = document.querySelector('#screen-setting .screen-header');
  if (header.dataset.htMode) {
    const addedBack = document.getElementById('ht-lineup-back-btn');
    if (addedBack) header.removeChild(addedBack);
    // 元の「戻る」ボタンを復元
    const origBack = header.querySelector('.back-btn');
    if (origBack) origBack.style.display = '';
    delete header.dataset.htMode;
  }
  const subLabel = document.getElementById('ht-subs-label');
  if (subLabel) subLabel.parentNode.removeChild(subLabel);
  document.getElementById('btn-kickoff-top').style.display = '';
  document.getElementById('btn-kickoff-bottom').closest('div').style.display = '';
  showScreen('game');
  document.getElementById('halftime-modal').style.display = 'flex';
  _buildHtTactics();
}

function _updateSubBtn() {
  const btn = document.getElementById('sub-btn');
  if (!btn) return;
  const isET = wcPhase === 'et_first' || wcPhase === 'et_second';
  const afterKickoff = isET ? currentChanceIdx > 0 : currentChanceIdx >= 6;
  const canSub = subsCount < 5 && subsUsed < 3 && afterKickoff && currentChanceIdx < chanceResults.length;
  btn.style.display = canSub ? 'block' : 'none';
  btn.textContent = `${t('wcSub')}（${t('wcSubRemain')}${5 - subsCount}${t('wcSubPeople')}${3 - subsUsed}${t('wcSubTimes')}`;
  // スクロールは nextChance() の double rAF が担うため、ここでは不要
}

function openSecondHalfSub() {
  if (subsCount >= 5 || subsUsed >= 3) return;
  _htMode = true;
  htSubsCount = 0;
  updateSettingBtnValues();
  renderFormation();
  renderBench();
  document.getElementById('btn-kickoff-top').style.display = 'none';
  document.getElementById('btn-kickoff-bottom').closest('div').style.display = 'none';
  // 静的な「← 戻る」ボタンを非表示
  const header = document.querySelector('#screen-setting .screen-header');
  const staticBackBtn = header ? header.querySelector('.back-btn') : null;
  if (staticBackBtn) staticBackBtn.style.display = 'none';
  // 「← 試合へ戻る」ボタン追加
  if (!document.getElementById('ht-lineup-back-btn')) {
    const backBtn = document.createElement('button');
    backBtn.className = 'back-btn';
    backBtn.id = 'ht-lineup-back-btn';
    backBtn.textContent = t('wcBackToMatch');
    backBtn.onclick = closeSecondHalfSub;
    header.dataset.htMode = '1';
    header.insertBefore(backBtn, header.firstChild);
  }
  // 交代枠ラベル追加
  if (!document.getElementById('ht-subs-label')) {
    const subLabel = document.createElement('div');
    subLabel.id = 'ht-subs-label';
    subLabel.style.cssText = 'font-size:12px;color:#888;text-align:center;padding:4px 0 8px';
    const benchEl = document.getElementById('bench-list');
    benchEl.parentNode.insertBefore(subLabel, benchEl);
  }
  _updateHtSubsLabel();
  document.getElementById('sub-btn').style.display = 'none';
  document.getElementById('next-btn').disabled = true;
  document.getElementById('all-btn').disabled = true;
  showScreen('setting');
}

function closeSecondHalfSub() {
  _htMode = false;
  // 交代が発生した場合のみ回数消費
  if (htSubsCount > 0) subsUsed++;
  subsCount += htSubsCount;
  htSubsCount = 0;
  // 追加要素を削除
  const header = document.querySelector('#screen-setting .screen-header');
  if (header && header.dataset.htMode) {
    const backBtn = document.getElementById('ht-lineup-back-btn');
    if (backBtn) header.removeChild(backBtn);
    delete header.dataset.htMode;
  }
  // 静的な「← 戻る」ボタンを再表示
  const staticBackBtn = header ? header.querySelector('.back-btn:not(#ht-lineup-back-btn)') : null;
  if (staticBackBtn) staticBackBtn.style.display = '';
  const subLabel = document.getElementById('ht-subs-label');
  if (subLabel) subLabel.parentNode.removeChild(subLabel);
  document.getElementById('btn-kickoff-top').style.display = '';
  document.getElementById('btn-kickoff-bottom').closest('div').style.display = '';
  document.getElementById('next-btn').disabled = false;
  document.getElementById('all-btn').disabled = false;
  // 延長戦開始前の交代（ET開始を確定）
  if (_wcETSubPending) {
    _wcETSubPending = false;
    gameState.team1.lineup = [...team1State.lineup];
    _runWCETPhase();
    return;
  }
  // 延長戦進行中の交代（残りチャンスを新lineupで再シミュレート）
  if (wcPhase === 'et_first' || wcPhase === 'et_second') {
    _recalcETFromCurrent();
    showScreen('game');
    _updateSubBtn();
    return;
  }
  // 後半再計算（交代反映）
  _recalcSecondHalf();
  const _subTime = (currentChanceIdx > 0 && chanceResults[currentChanceIdx - 1])
    ? chanceResults[currentChanceIdx - 1].time : '';
  showScreen('game');
  _insertSubLog(_subTime);
  _updateSubBtn();
}

function _updateHtSubsLabel() {
  const label = document.getElementById('ht-subs-label');
  if (!label) return;
  const total = subsCount + htSubsCount;
  const remaining = 5 - total;
  label.textContent = window.LANG === 'en'
    ? `Substitutions: ${total}/5 (${remaining} left)`
    : `交代枠: ${total}/5人（残り${remaining}人）`;
  label.style.color = remaining === 0 ? '#cc0000' : '#888';
}

function closeHalfTimeModal() {
  document.getElementById('halftime-modal').style.display = 'none';
  _recalcSecondHalf();
  _insertSubLog('HT');
  document.getElementById('next-btn').disabled = false;
  document.getElementById('all-btn').disabled = false;
}

function _recalcSecondHalf() {
  // 後半開始スコアの基準点：
  //   ・chanceNo 0-6 = 前半通常 (1-43分)、chanceNo 7 = 前半ロスタイム (45+X分)
  //   ・ハーフタイムは currentChanceIdx===6 で発火するが、
  //     chanceResults[6] と chanceResults[7]（ロスタイム）はシミュレーション済みで firstPart に含まれる
  //   → baseIdx は必ず 7（前半ロスタイム終了時点）以上を使い、ロスタイムゴールを引き継ぐ
  const baseIdx = Math.max(7, currentChanceIdx - 1);
  const baseRes = chanceResults[baseIdx];
  const baseScore = baseRes
    ? { t1: baseRes.t1score, t2: baseRes.t2score }
    : halfTimeScore;

  const t1 = buildTeam(team1Data, team1State);
  const t2 = buildTeam(team2Data, team2State);
  t1.score = baseScore.t1;
  t2.score = baseScore.t2;
  // chanceCounter等はゼロリセット（再計算のため）
  t1.chanceCounter = 0; t2.chanceCounter = 0;
  t1.shootCounter = 0;  t2.shootCounter = 0;
  t1.gkSaveCounter = 0; t2.gkSaveCounter = 0;
  t1.players.forEach(p => { p.chance_counter = 0; p.fatigue = 0; });
  t2.players.forEach(p => { p.chance_counter = 0; p.fatigue = 0; });
  gameState = { team1: t1, team2: t2 };

  // 現在地点から後半終了まで再計算
  const startIdx = Math.max(8, currentChanceIdx);
  const firstPart = chanceResults.slice(0, startIdx);
  const newSecond = [];
  for (let i = startIdx; i < 16; i++) {
    newSecond.push(simulateChance(gameState, i));
  }
  if (newSecond.length === 8 && Math.random() < 0.5) {
    newSecond.push(simulateChance(gameState, 16));
  }
  chanceResults = [...firstPart, ...newSecond];
  document.getElementById('chance-total').textContent = chanceResults.length;
}

// シュート系シーンを「シュート → GKダイブ → 結果」に分割（表示層のみ・エンジン不変）。
//   ・GKが抜かれるゴール/枠外 … 中間に「GKダイブ」を挟む。ゴールはゲームの定型文（例:GKが取れない）、
//     枠外は定型文にGK文が無いので「手を伸ばすが届かない」を補う（GKは届かず＝必ずセーブしない）。
//   ・セーブ/ブロック … 結果シーン自体がGK・守備の防ぐ動作なので中間は挟まない（2場面／ヘディング等は1場面）。
//   ・ヘディング/ボレー … シュート動作は直前のクロス/セットプレー場面。この結果シーンの先頭はGKの反応なので
//     先頭ビートを「GKダイブ」として扱う（クロス→GKダイブ→結果 の3場面に）。
//   ・ミドル/FK … 構造が異なるため2場面（シュート→結果）。分割不能は null（従来1シーン）。
function _shootSplit(sc, textHtml) {
  if (!sc) return null;
  // セットプレー（サイドFK）: 「蹴り出し(クロスを上げる)」→「競り合い(ヘディング/ボレー)」の2ビートに分割。
  //   定型文も2文（…ボールをあげる／…シュート）なので parts と一致する。
  if (sc.scenario === 'セットプレー') {
    const spParts = String(textHtml || '').split(/(?:　| {2,})/).map(s => s.trim()).filter(Boolean);
    if (spParts.length >= 2) return { parts: [spParts[0], spParts[1]], steps: ['fkdeliver', 'spcontest'] };
    return null;
  }
  // クロス（オープンプレー・CRエリア）: 「中央へクロス(蹴り出し)」→「競り合い(ヘディング/ボレー)」の2ビートに分割。
  //   定型文も2文（…中央へクロス／…シュート）なので parts と一致する。FKの蹴りカット(fkdeliver)を流用し、
  //   クロス選手の蹴り出し → 受け手の競り合い、という流れをセットプレーと同じ仕組みで見せる。
  if (sc.scenario === 'クロス') {
    const crParts = String(textHtml || '').split(/(?:　| {2,})/).map(s => s.trim()).filter(Boolean);
    if (crParts.length >= 2) return { parts: [crParts[0], crParts[1]], steps: ['fkdeliver', 'spcontest'] };
    return null;
  }
  const isShoot = (sc.scenario === 'シュート' || sc.scenario === 'ミドルシュート');
  const isShootResult = (sc.result === 'ゴール！！' || sc.result === '枠を外した！' || sc.result === 'GK防いだ！' || sc.result === 'ブロック');
  if (!isShoot || !isShootResult) return null;
  const parts = String(textHtml || '').split(/(?:　| {2,})/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  // 枠外用「GKダイブ（届かない）」の補完文（ゲームに無い）。GKは届かず＝必ずセーブしない。
  const gkName = (typeof coloredName === 'function') ? coloredName(sc.defence, 0) : '';
  const gkReach = (typeof window !== 'undefined' && window.LANG === 'en')
    ? (gkName ? (gkName + ' stretches a hand but can\'t reach it!') : "The keeper stretches but can't reach it!")
    : (gkName ? (gkName + 'が手を伸ばすが届かない！') : 'GKが手を伸ばすが届かない！');

  const act = sc.action;
  // フリーキック（中央の直接FK）: GK を必ず見せる。ゴール=蹴り→GKダイブ(届かない)→ゴール／セーブ=蹴り→GKセーブ／枠外=蹴り→枠外。
  //   FKの定型文は1文のことが多いので、'shot'ビートは補完文(fkShot)・'result'ビートは結果文(last)を使い、結果のネタバレを避ける。
  if (act === 'フリーキック') {
    const fkShot = (typeof window !== 'undefined' && window.LANG === 'en') ? 'A free kick from a dangerous position!' : '絶好の位置でのフリーキック！';
    if (sc.result === 'ゴール！！') return { parts: [fkShot, gkReach, last], steps: ['shot', 'gk', 'result'] };
    return { parts: [fkShot, last], steps: ['shot', 'result'] };   // 枠外=蹴り→枠外 / セーブ=蹴り→GKセーブ
  }
  const isHeaderVolley = (act === 'ヘディングシュート' || act === 'ボレーシュート');
  const isGroundShot = (act === '中央からシュート' || act === 'サイドからシュート');

  // セーブ／ブロック: 結果シーン＝GK・守備の動作。中間は挟まない。
  if (sc.result === 'GK防いだ！' || sc.result === 'ブロック') {
    if (isHeaderVolley) return null;                 // ヘディング/ボレーのセーブ等は結果シーン1場面
    // ミドルのブロックは分割しない＝「ブロック(相手あり)」の1場面のみ。
    //   分割すると 'shot' ビートがフリーのミドルを再生し、ブロックと二重に見えるため。
    if (sc.action === 'ミドルシュート' && sc.result === 'ブロック') return null;
    if (parts.length < 2) return null;
    return { parts: [parts[0], last], steps: ['shot', 'result'] };
  }

  // ミドルシュート（ゴール／枠外）: 定型文の中間が「ブロック届かない／GKセーブも届かない」で乱れるため、
  //   その中間は使わず、GKダイブ(補完文)を挟んで シュート→GKダイブ→結果 の3場面にする。
  if (sc.action === 'ミドルシュート') {
    return { parts: [parts[0], gkReach, last], steps: ['shot', 'gk', 'result'] };
  }

  // ここから ゴール／枠を外した！（GKは抜かれる）
  if (isHeaderVolley) {
    // 先頭=GKの反応（シュート動作はクロス場面で表示済み）。枠外はGK文が無いので補う。
    if (sc.result === '枠を外した！') return { parts: [gkReach, last], steps: ['gk', 'result'] };
    if (parts.length < 2) return null;
    return { parts: [parts[0], last], steps: ['gk', 'result'] };   // ゴール: [GKが届かない][ゴール]
  }
  if (isGroundShot) {
    const shotText = parts[0];
    if (sc.result === '枠を外した！') return { parts: [shotText, gkReach, last], steps: ['shot', 'gk', 'result'] };  // 枠外: シュート→GKダイブ(補)→枠外
    if (parts.length >= 3) return { parts: [parts[0], parts[1], last], steps: ['shot', 'gk', 'result'] };          // ゴール: [シュート][GKが取れない][ゴール](元の文)
    return { parts: [shotText, gkReach, last], steps: ['shot', 'gk', 'result'] };                                  // 念のため(2ビートのゴール)
  }
  // ミドル／FK 等: 2場面（シュート→結果）。
  if (parts.length < 2) return null;
  return { parts: [parts[0], last], steps: ['shot', 'result'] };
}

function nextChance() {
  // 保留中のコーチカードがあれば、まずそれだけ表示して終了
  // （テキスト最終シーンとコーチカードの間に「次へ」を挟む）
  if (_pendingCoachCardEl) {
    const logArea = document.getElementById('log-area');
    logArea.appendChild(_pendingCoachCardEl);
    logArea.scrollTop = logArea.scrollHeight;
    _pendingCoachCardEl = null;
    return;
  }

  if (currentChanceIdx >= chanceResults.length) {
    showResult();
    return;
  }

  const res = chanceResults[currentChanceIdx];
  const logArea = document.getElementById('log-area');

  if (currentSceneIdx === 0 && _shootSubStep === 0) {
    // チャンス開始：交代ボタンを非表示
    document.getElementById('sub-btn').style.display = 'none';
    // チャンス開始：eventDivとフィールドを生成
    const isGoal = res.scenes.some(s => s.result === 'ゴール！！');
    currentEventDiv = document.createElement('div');
    currentEventDiv.className = 'log-event ' + (isGoal ? 'goal' : res.scenes.some(s => s.result === 'カウンター') ? 'counter' : 'normal');

    const timeDiv = document.createElement('div');
    timeDiv.className = 'log-time';
    timeDiv.textContent = res.time;
    currentEventDiv.appendChild(timeDiv);

    // テキスト用コンテナ
    const textDiv = document.createElement('div');
    textDiv.className = 'log-text';
    textDiv.id = 'log-text-' + currentChanceIdx;
    currentEventDiv.appendChild(textDiv);

    logArea.appendChild(currentEventDiv);

    // スコアはゴールのないチャンスのみ開始時に更新する。
    // ゴールがあるチャンスはゴールシーン表示タイミングで更新（下記）。
    if (!res.scenes.some(s => s.result === 'ゴール！！')) {
      document.getElementById('score1').textContent = res.t1score;
      document.getElementById('score2').textContent = res.t2score;
    }
    document.getElementById('game-time-display').textContent = res.time;
    const offTeam = res.scenes[0] ? res.scenes[0].offence : null;
    document.getElementById('chance-team-label').textContent = offTeam ? `${t('attackLabel')} ${getTeamName(offTeam)}` : '';
  }

  // 案A: ライブフィールドを上部パネルに更新（ログには差し込まない）
  const textDiv = document.getElementById('log-text-' + currentChanceIdx);
  const sc = res.scenes[currentSceneIdx];
  const prevSc = currentSceneIdx > 0 ? res.scenes[currentSceneIdx - 1] : null;

  // シュート系シーンは「シュート→GKダイブ→ゴール/枠外」のビートに分割し、1クリック1ビートで見せる。
  const _split = _shootSplit(sc, res.textScenes[currentSceneIdx]);
  const _beat = _split ? _shootSubStep : 0;
  const _isLastBeat = !_split || (_beat >= _split.parts.length - 1);

  // per-scene アート（js/cutscene.js）。分割時は段階別 renderShootStep、通常は renderSceneArt。無ければ従来SVG。
  let _sceneArt = null;
  if (_split && typeof renderShootStep === 'function') {
    _sceneArt = renderShootStep(sc, _split.steps[_beat]);
  } else if (!_split && typeof renderSceneArt === 'function') {
    const _nextSc = res.scenes[currentSceneIdx + 1] || null;   // ワンツー判定用（次エリアの攻撃選手＝同一なら give-and-go）
    _sceneArt = renderSceneArt(sc, _nextSc);
  }
  const liveFieldWrap = document.getElementById('live-field-wrap');
  const miniFieldWrap = document.getElementById('mini-field-wrap');
  if (liveFieldWrap) {
    liveFieldWrap.style.display = '';
    liveFieldWrap.innerHTML = '';
    // カットインがあればそれを大きく表示し、簡易フィールド図は下に小さく添える。
    // カットインが無いアクションは簡易フィールド図を上で大きく表示（mini は出さない）。
    liveFieldWrap.appendChild(_sceneArt || renderSceneField(sc, prevSc));
  }
  if (miniFieldWrap) {
    if (_sceneArt) {
      miniFieldWrap.style.display = '';
      miniFieldWrap.innerHTML = '';
      miniFieldWrap.appendChild(renderSceneField(sc, prevSc));
    } else {
      miniFieldWrap.style.display = 'none';
      miniFieldWrap.innerHTML = '';
    }
  }

  // テキストを追加（分割時はビート単位、通常は全文）
  const line = document.createElement('div');
  line.style.cssText = 'margin-bottom:8px';
  line.innerHTML = _split ? _split.parts[_beat] : res.textScenes[currentSceneIdx];
  textDiv.appendChild(line);

  // ゴール時のスコア更新＆GOAL演出は「結果ビート」で（分割しない場合は従来どおり最終表示時）
  if (sc && sc.result === 'ゴール！！' && _isLastBeat) {
    // ゴールシーンが画面に出たタイミングでスコアを更新する
    document.getElementById('score1').textContent = res.t1score;
    document.getElementById('score2').textContent = res.t2score;
    // 方式C: カットシーン takeover（js/cutscene.js, エンジン無改変）。未ロード/無効なら従来のGOAL演出へフォールバック。
    const _csShown = (typeof showGoalCutscene === 'function') && showGoalCutscene(sc, res);
    if (!_csShown) {
      const anim = document.getElementById('goal-anim');
      anim.style.display = 'block';
      setTimeout(() => anim.style.display = 'none', 1600);
    }
  }

  // double rAF: _updateSubBtn等によるレイアウト変化が終わってからスクロール
  requestAnimationFrame(() => requestAnimationFrame(() => {
    logArea.scrollTop = logArea.scrollHeight;
  }));

  // 分割中でまだビートが残るなら、シーンを進めずに同じシーンに留まる（次クリックで次ビート）
  if (_split && !_isLastBeat) {
    _shootSubStep++;
    return;
  }
  _shootSubStep = 0;
  currentSceneIdx++;

  if (currentSceneIdx >= res.textScenes.length) {
    currentChanceIdx++;
    currentSceneIdx = 0;
    currentEventDiv = null;
    document.getElementById('chance-count').textContent = currentChanceIdx;
    _maybeInsertCoachCard();
    // ハーフタイム（currentChanceIdx===8 = chanceNo7完了後に発火）
    // chanceNo 0-6: 前半通常、chanceNo 7: 前半ロスタイム(45+X分)、chanceNo 8-: 後半
    if (currentChanceIdx === 8 && !halfTimeShown) {
      halfTimeShown = true;
      const htRes = chanceResults[7] || chanceResults[6]; // chanceNo7(ロスタイム)の最終スコア
      halfTimeScore = { t1: htRes.t1score, t2: htRes.t2score };
      // 次のシーンボタンをハーフタイムモーダル表示に差し替え
      const nextBtn = document.getElementById('next-btn');
      nextBtn.textContent = window.LANG === 'en' ? '⏸ Half Time' : '⏸ ハーフタイム';
      nextBtn.onclick = () => {
        nextBtn.textContent = t('btnNextScene');
        nextBtn.onclick = nextChance;
        _showHalfTimeModal();
      };
      return;
    }
    // 後半・延長戦中：チャンス完了時のみ交代ボタンを表示
    const _isET = wcPhase === 'et_first' || wcPhase === 'et_second';
    if ((_isET ? currentChanceIdx > 0 : currentChanceIdx > 8) && currentChanceIdx < chanceResults.length) {
      _updateSubBtn();
    }
    if (currentChanceIdx >= chanceResults.length) {
      document.getElementById('next-btn').textContent = t('btnNextArrow');
      document.getElementById('all-btn').textContent = t('btnSeeResult');
    }
  }
}


function allChances() {
  if (currentChanceIdx >= chanceResults.length) {
    showResult();
    return;
  }
  _pendingCoachCardEl = null; // スキップ時はコーチカード保留をクリア
  // 延長中に「結果を見る」が押された場合、ET全体をスキップして最終結果へ
  if (wcPhase === 'et_first' || wcPhase === 'et_second') _wcSkipToEnd = true;
  halfTimeShown = true; // スキップ時はモーダルを出さない
  while (currentChanceIdx < chanceResults.length) {
    nextChance();
  }
  setTimeout(showResult, 300);
}


// ============================================================
// エリア別フィールドSVG生成（共通）
// ============================================================
function buildFieldSVG(dataMap, W, H) {
  const AREA_SVG = {
    'DF_L':{x:15,y:20},'DF_M':{x:15,y:50},'DF_R':{x:15,y:80},
    'MF_L':{x:50,y:22},'MF_M':{x:50,y:50},'MF_R':{x:50,y:78},
    'GOAL_L':{x:84,y:22},'GOAL_M':{x:87,y:50},'GOAL_R':{x:84,y:78}
  };
  const px = function(xp) { return xp/100*W; };
  const py = function(yp) { return yp/100*H; };

  let svg = '<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" style="display:block;margin:0 auto;border-radius:8px;overflow:hidden">'
    + '<rect width="'+W+'" height="'+H+'" fill="#2d7a3a"/>';
  for (var i=0;i<8;i++) {
    if (i%2===0) svg += '<rect x="'+(i*W/8).toFixed(0)+'" y="0" width="'+(W/8).toFixed(0)+'" height="'+H+'" fill="rgba(0,0,0,0.07)"/>';
  }
  svg += '<rect x="4" y="4" width="'+(W-8)+'" height="'+(H-8)+'" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>'
    + '<line x1="'+W/2+'" y1="4" x2="'+W/2+'" y2="'+(H-4)+'" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>'
    + '<circle cx="'+W/2+'" cy="'+H/2+'" r="24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>'
    + '<rect x="4" y="'+(H*0.25)+'" width="'+(W*0.14)+'" height="'+(H*0.5)+'" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>'
    + '<rect x="'+(W-4-W*0.14)+'" y="'+(H*0.25)+'" width="'+(W*0.14)+'" height="'+(H*0.5)+'" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>'
    + '<rect x="0" y="'+(H*0.38)+'" width="8" height="'+(H*0.24)+'" fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>'
    + '<rect x="'+(W-8)+'" y="'+(H*0.38)+'" width="8" height="'+(H*0.24)+'" fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>';

  Object.entries(AREA_SVG).forEach(function(entry) {
    var area = entry[0], pos = entry[1];
    var d = dataMap[area];
    var total = d ? d.win+d.lose : 0;
    var rate = total > 0 ? Math.round(d.win/total*100) : null;
    var cx = px(pos.x), cy = py(pos.y), r = 19;
    var bg = rate===null ? 'rgba(0,0,0,0.3)' : rate>=60 ? '#1a6bb5' : rate>=40 ? '#e8a020' : '#c0392b';
    var rStr = rate!==null ? rate+'%' : '-';
    var tStr = total>0 ? d.win+'/'+total : '';
    svg += '<circle cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="'+r+'" fill="'+bg+'" fill-opacity="0.88" stroke="white" stroke-width="1.2"/>';
    svg += '<text x="'+cx.toFixed(1)+'" y="'+(cy-3).toFixed(1)+'" text-anchor="middle" font-size="10" font-weight="700" fill="white">'+rStr+'</text>';
    svg += '<text x="'+cx.toFixed(1)+'" y="'+(cy+8).toFixed(1)+'" text-anchor="middle" font-size="7" fill="rgba(255,255,255,0.85)">'+tStr+'</text>';
  });
  var isEn = window.LANG === 'en';
  svg += '<text x="8" y="12" text-anchor="start" font-size="8" font-weight="700" fill="rgba(255,255,255,0.8)">'+(isEn?'Def':'守備')+'</text>';
  svg += '<text x="8" y="22" text-anchor="start" font-size="8" fill="rgba(255,255,255,0.65)">'+(isEn?'Line':'ライン')+'</text>';
  svg += '<text x="'+(W-8)+'" y="12" text-anchor="end" font-size="8" font-weight="700" fill="rgba(255,255,255,0.8)">'+(isEn?'Att':'前線')+'</text>';
  svg += '<text x="'+(W-8)+'" y="22" text-anchor="end" font-size="8" fill="rgba(255,255,255,0.65)">'+(isEn?'Line':'ライン')+'</text>';
  svg += '<text x="'+W/2+'" y="'+(H-4)+'" text-anchor="middle" font-size="8" fill="rgba(255,255,255,0.5)">'+(isEn?'← Own Half   Opp Half →':'← 自陣　　　相手陣 →')+'</text>';
  svg += '</svg>';
  return svg;
}

function buildFieldWithTabs(atkMap, defMap, W, H, containerId) {
  var atkSvg = buildFieldSVG(atkMap, W, H);
  var defSvg = buildFieldSVG(defMap, W, H);
  var legend = '<div style="display:flex;gap:10px;justify-content:center;margin-top:8px;font-size:10px">'
    + '<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#1a6bb5;margin-right:2px;vertical-align:middle"></span>60%+</span>'
    + '<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#e8a020;margin-right:2px;vertical-align:middle"></span>40-60%</span>'
    + '<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#c0392b;margin-right:2px;vertical-align:middle"></span>40%-</span>'
    + '</div>';
  var tabStyle = 'padding:6px 20px;font-size:12px;font-weight:700;border:none;border-radius:6px 6px 0 0;cursor:pointer;';
  var cid = containerId;
  var html = '<div style="display:flex;gap:4px;margin-bottom:0">'
    + '<button id="'+cid+'-tab-atk" style="'+tabStyle+'background:#1a3a6b;color:white" onclick="switchFieldTab(this)">'+(window.LANG==='en'?'Attack':'攻撃')+'</button>'
    + '<button id="'+cid+'-tab-def" style="'+tabStyle+'background:#eee;color:#555" onclick="switchFieldTab(this)">'+(window.LANG==='en'?'Defence':'守備')+'</button>'
    + '</div>'
    + '<div id="'+cid+'-panel-atk">' + atkSvg + legend + '</div>'
    + '<div id="'+cid+'-panel-def" style="display:none">' + defSvg + legend + '</div>';
  document.getElementById(containerId).innerHTML = html;
}

function switchFieldTab(btn) {
  var id = btn.id; // e.g. "multi-field-tabs-tab-atk"
  var isAtk = id.endsWith('-tab-atk');
  var containerId = id.replace(/-tab-(atk|def)$/, '');
  document.getElementById(containerId+'-panel-atk').style.display = isAtk ? '' : 'none';
  document.getElementById(containerId+'-panel-def').style.display = isAtk ? 'none' : '';
  document.getElementById(containerId+'-tab-atk').style.background = isAtk ? '#1a3a6b' : '#eee';
  document.getElementById(containerId+'-tab-atk').style.color = isAtk ? 'white' : '#555';
  document.getElementById(containerId+'-tab-def').style.background = isAtk ? '#eee' : '#c0392b';
  document.getElementById(containerId+'-tab-def').style.color = isAtk ? '#555' : 'white';
}


// ============================================================
// 選手計算値（Excel数式準拠）
// ============================================================
function calcPlayerStats(params, positions) {
  const avg = (idxs) => {
    const vals = idxs.filter(i => i < params.length).map(i => params[i]);
    return vals.length ? Math.round(vals.reduce((s,v) => s+v, 0) / vals.length) : 0;
  };
  const isGK = positions && positions.includes('GK');
  const of_ = avg([7,8,9,10,11,13,17]);
  const df_ = isGK ? avg([23,24]) : avg([18,19,20,21,22]); // GK:セービング・ハイボール、FP:パスカット〜チェイシング
  const tq_ = avg([13,14,15,16]);
  const pw_ = avg([0,1,5,25]);
  const sp_ = avg([2,3,4,6]);
  const mt_ = avg([26,27]);
  const total_ = Math.round([of_,df_,pw_,sp_,mt_].reduce((s,v)=>s+v,0) / 5);
  return { of: of_, df: df_, tq: tq_, pw: pw_, sp: sp_, mt: mt_, total: total_ };
}

// ============================================================
// 選手詳細画面
// ============================================================
function buildRadarChart(stats) {
  var CX=120,CY=108,R=62,MIN=40,MAX=100;
  function ax(i){return (Math.PI/180)*(-90+i*60);}
  function px(r,i){return (CX+r*Math.cos(ax(i))).toFixed(1);}
  function py(r,i){return (CY+r*Math.sin(ax(i))).toFixed(1);}
  function pts(r){var s='';for(var i=0;i<6;i++)s+=(i?'  ':'')+px(r,i)+','+py(r,i);return s;}

  var grid='';
  var gv=[40,55,70,85,100];
  for(var g=0;g<gv.length;g++){var gr=R*(gv[g]-MIN)/(MAX-MIN);grid+='<polygon points="'+pts(gr)+'" fill="none" stroke="#ccc" stroke-width="0.8"/>';}

  var axes='';
  for(var i=0;i<6;i++){axes+='<line x1="'+CX+'" y1="'+CY+'" x2="'+px(R,i)+'" y2="'+py(R,i)+'" stroke="#ccc" stroke-width="0.8"/>';}

  var dp='';
  for(var i=0;i<6;i++){var r=R*Math.max(0,(stats[i].val-MIN))/(MAX-MIN);dp+=(i?'  ':'')+px(r,i)+','+py(r,i);}
  var data='<polygon points="'+dp+'" fill="#003087" fill-opacity="0.2" stroke="#003087" stroke-width="2"/>';

  var dots='';
  for(var i=0;i<6;i++){var r=R*Math.max(0,(stats[i].val-MIN))/(MAX-MIN);dots+='<circle cx="'+px(r,i)+'" cy="'+py(r,i)+'" r="3" fill="#003087"/>';}

  var offY=[[-14,-1,'middle'],[-4,9,'start'],[-4,9,'start'],[14,27,'middle'],[-4,9,'end'],[-4,9,'end']];
  var LR=R+20;
  var labels='';
  for(var i=0;i<6;i++){
    var lx=parseFloat(px(LR,i)),ly=parseFloat(py(LR,i));
    var dy1=offY[i][0],dy2=offY[i][1],anc=offY[i][2];
    var v=stats[i].val;
    var c=v>=80?'#c0392b':v>=70?'#1a6bb5':'#2d7a3a';
    labels+='<text x="'+lx.toFixed(1)+'" y="'+(ly+dy1).toFixed(1)+'" text-anchor="'+anc+'" font-size="10" font-family="sans-serif" fill="#555">'+stats[i].label+'</text>';
    labels+='<text x="'+lx.toFixed(1)+'" y="'+(ly+dy2).toFixed(1)+'" text-anchor="'+anc+'" font-size="12" font-weight="700" font-family="sans-serif" fill="'+c+'">'+v+'</text>';
  }
  var total = 0;
  for(var i=0;i<6;i++) total += stats[i].val;
  var overall = Math.round(total/6);

  var center = '<text x="'+CX+'" y="'+(CY-8)+'" text-anchor="middle" font-size="11" font-family="sans-serif" fill="#888">総合</text>'
    + '<text x="'+CX+'" y="'+(CY+16)+'" text-anchor="middle" font-size="28" font-weight="700" font-family="sans-serif" fill="#003087">'+overall+'</text>';

  return '<svg width="240" height="216" viewBox="0 0 240 216" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:0 auto">'+grid+axes+data+dots+center+labels+'</svg>';
}

function buildPositionMap(positions) {
  // 3列 × 5行のグリッド（左列=左サイド、中央=センター、右列=右サイド）
  // 適性判定
  function has(id) { return positions.includes(id); }
  function hasSide(type) {
    return has('左'+type) || has('右'+type) || has(type);
  }
  function hasLeft(type)  { return has('左'+type) || has(type); }
  function hasRight(type) { return has('右'+type) || has(type); }

  // 色: 第1適正=黄、第2以降=オレンジ、なし=グレー暗
  const C_ON  = '#e07a00';
  const C_OFF = '#555';
  const T_ON  = '#fff';
  const T_OFF = '#999';

  function cellColor(ids) {
    return ids.some(id => positions.includes(id)) ? C_ON : C_OFF;
  }
  function textColor(fill) { return fill === C_ON ? T_ON : T_OFF; }

  // セル定義: { label, fill, textFill, x, y, w, h }
  const CW = 52, CH = 40, GAP = 0;
  // 列x: 左=0, 中=52, 右=104
  // 行y: CF=0, CF+OMF分割なのでCFは20高、OMFも20高
  //   row0(CF): y=0  h=28 → 中央のみ
  //   row1(OMF):y=28 h=28 → 中央のみ
  //   WGは row0+row1にまたがる: y=0 h=56
  //   row2(CMF):y=56 h=28
  //   row3(DMF):y=84 h=28
  //   SMFはrow2+row3にまたがる: y=56 h=56
  //   row4(CB): y=112 h=36
  //   SBはrow4と同じ: y=112 h=36
  //   row5(GK): y=148 h=36 → 中央のみ

  const W = 3*CW, H = 184;

  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block">`;

  // 枠線（全体）
  svg += `<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#ccc" stroke-width="1"/>`;

  // --- 左WG (x=0, y=0, w=52, h=56) ---
  const wgL = cellColor(['左WG', 'WG']);
  svg += `<rect x="0" y="0" width="52" height="56" fill="${wgL}" stroke="#ccc" stroke-width="0.5"/>`;
  svg += `<text x="26" y="31" text-anchor="middle" font-size="12" font-weight="700" font-family="sans-serif" fill="${textColor(wgL)}">WG</text>`;

  // --- CF (x=52, y=0, w=52, h=28) ---
  const cf = cellColor(['CF', '右CF', '左CF']);
  svg += `<rect x="52" y="0" width="52" height="28" fill="${cf}" stroke="#ccc" stroke-width="0.5"/>`;
  svg += `<text x="78" y="18" text-anchor="middle" font-size="12" font-weight="700" font-family="sans-serif" fill="${textColor(cf)}">CF</text>`;

  // --- OMF (x=52, y=28, w=52, h=28) ---
  const omf = cellColor(['OMF', '右OMF', '左OMF']);
  svg += `<rect x="52" y="28" width="52" height="28" fill="${omf}" stroke="#ccc" stroke-width="0.5"/>`;
  svg += `<text x="78" y="46" text-anchor="middle" font-size="12" font-weight="700" font-family="sans-serif" fill="${textColor(omf)}">OMF</text>`;

  // --- 右WG (x=104, y=0, w=52, h=56) ---
  const wgR = cellColor(['右WG', 'WG']);
  svg += `<rect x="104" y="0" width="52" height="56" fill="${wgR}" stroke="#ccc" stroke-width="0.5"/>`;
  svg += `<text x="130" y="31" text-anchor="middle" font-size="12" font-weight="700" font-family="sans-serif" fill="${textColor(wgR)}">WG</text>`;

  // --- 左SMF (x=0, y=56, w=52, h=56) ---
  const smfL = cellColor(['左SMF', 'SMF']);
  svg += `<rect x="0" y="56" width="52" height="56" fill="${smfL}" stroke="#ccc" stroke-width="0.5"/>`;
  svg += `<text x="26" y="87" text-anchor="middle" font-size="12" font-weight="700" font-family="sans-serif" fill="${textColor(smfL)}">SMF</text>`;

  // --- CMF (x=52, y=56, w=52, h=28) ---
  const cmf = cellColor(['CMF', '右CMF', '左CMF']);
  svg += `<rect x="52" y="56" width="52" height="28" fill="${cmf}" stroke="#ccc" stroke-width="0.5"/>`;
  svg += `<text x="78" y="74" text-anchor="middle" font-size="12" font-weight="700" font-family="sans-serif" fill="${textColor(cmf)}">CMF</text>`;

  // --- DMF (x=52, y=84, w=52, h=28) ---
  const dmf = cellColor(['DMF', '右DMF', '左DMF']);
  svg += `<rect x="52" y="84" width="52" height="28" fill="${dmf}" stroke="#ccc" stroke-width="0.5"/>`;
  svg += `<text x="78" y="102" text-anchor="middle" font-size="12" font-weight="700" font-family="sans-serif" fill="${textColor(dmf)}">DMF</text>`;

  // --- 右SMF (x=104, y=56, w=52, h=56) ---
  const smfR = cellColor(['右SMF', 'SMF']);
  svg += `<rect x="104" y="56" width="52" height="56" fill="${smfR}" stroke="#ccc" stroke-width="0.5"/>`;
  svg += `<text x="130" y="87" text-anchor="middle" font-size="12" font-weight="700" font-family="sans-serif" fill="${textColor(smfR)}">SMF</text>`;

  // --- 左SB (x=0, y=112, w=52, h=36) ---
  const sbL = cellColor(['左SB', 'SB']);
  svg += `<rect x="0" y="112" width="52" height="36" fill="${sbL}" stroke="#ccc" stroke-width="0.5"/>`;
  svg += `<text x="26" y="134" text-anchor="middle" font-size="12" font-weight="700" font-family="sans-serif" fill="${textColor(sbL)}">SB</text>`;

  // --- CB (x=52, y=112, w=52, h=36) ---
  const cb = cellColor(['CB', '右CB', '左CB']);
  svg += `<rect x="52" y="112" width="52" height="36" fill="${cb}" stroke="#ccc" stroke-width="0.5"/>`;
  svg += `<text x="78" y="134" text-anchor="middle" font-size="12" font-weight="700" font-family="sans-serif" fill="${textColor(cb)}">CB</text>`;

  // --- 右SB (x=104, y=112, w=52, h=36) ---
  const sbR = cellColor(['右SB', 'SB']);
  svg += `<rect x="104" y="112" width="52" height="36" fill="${sbR}" stroke="#ccc" stroke-width="0.5"/>`;
  svg += `<text x="130" y="134" text-anchor="middle" font-size="12" font-weight="700" font-family="sans-serif" fill="${textColor(sbR)}">SB</text>`;

  // --- GK (x=52, y=148, w=52, h=36) ---
  const gk = cellColor(['GK']);
  svg += `<rect x="52" y="148" width="52" height="36" fill="${gk}" stroke="#ccc" stroke-width="0.5"/>`;
  svg += `<text x="78" y="170" text-anchor="middle" font-size="12" font-weight="700" font-family="sans-serif" fill="${textColor(gk)}">GK</text>`;

  svg += `</svg>`;
  return svg;
}

function showPlayerDetail(teamKey, playerIdx) {
  const activeScreen = document.querySelector('.screen.active');
  _playerDetailOrigin = activeScreen ? activeScreen.id.replace('screen-', '') : 'title';

  const teamData = TEAM_DATA[teamKey];
  const player = teamData.players[playerIdx];
  const ex = PLAYER_EXTRA[player.name] || {};
  const params = player.params;
  const _isEn = window.LANG === 'en';

  const paramNames = _isEn
    ? ["Power","Stamina","Top Speed","Acceleration","Reaction","Jump","Agility","Dribble Acc.","Dribble Spd.","Short Pass","Long Pass","Shot Acc.","Shot Power","Shot Tech.","FK Acc.","Curve","Ball Tech.","Offensive","Intercept","Tackle","Man Mark","Covering","Chasing","Saving","High Ball","Heading","Positioning","Mentality","Fair Play"]
    : ["パワー","スタミナ","トップスピード","加速力","レスポンス","ジャンプ","敏捷性","ドリブル精度","ドリブルスピード","ショートパス精度","ロングパス精度","シュート精度","シュート力","シュートテクニック","フリーキック精度","カーブ","ボールテクニック","攻撃性","パスカット","タックル","マンマーク","カバーリング","チェイシング","セービング","ハイボール処理","ヘディング","ポジショニング","精神安定度","フェアプレー"];

  function pColor(v) {
    return v >= 85 ? '#c0392b' : v >= 75 ? '#1a6bb5' : v >= 65 ? '#2d7a3a' : v >= 50 ? '#555' : '#aaa';
  }

  // プロフィールブロック
  const posStr = player.positions.join('／');
  const heightStr = ex.height ? ex.height + 'cm' : '-';
  const weightStr = ex.weight ? ex.weight + 'kg' : '-';
  const profile = (_isEn && ex.profile_en) ? ex.profile_en : (ex.profile || '');
  const posLarge = ex.posLarge || '';

  // 能力値6項目
  // PLAYER_EXTRAがない場合（2026選手等）はparams計算値を使用
  const calc = calcPlayerStats(params, player.positions);
  const stats = [
    {label:_isEn?'Attack':'攻撃力',    val: ex.of || calc.of},
    {label:_isEn?'Defense':'守備力',   val: ex.df || calc.df},
    {label:_isEn?'Technique':'テクニック', val: ex.tq || calc.tq},
    {label:_isEn?'Power':'パワー',     val: ex.pw || calc.pw},
    {label:_isEn?'Speed':'スピード',   val: ex.sp || calc.sp},
    {label:_isEn?'Mental':'メンタル',  val: ex.mt || calc.mt},
  ];
  const statsHtml = buildRadarChart(stats);

  // ステータス詳細テーブル（2列）
  const paramEntries = paramNames.map((name, i) => ({name, idx: i})).filter(e => e.idx !== 28);
  const half = Math.ceil(paramEntries.length / 2);
  let tableRows = '';
  for (let i = 0; i < half; i++) {
    const le = paramEntries[i];
    const re = paramEntries[half + i];
    const lv = params[le.idx] || 0;
    const rv = re ? (params[re.idx] !== undefined ? params[re.idx] : null) : null;
    const lc = pColor(lv);
    const rc = rv !== null ? pColor(rv) : '#aaa';
    tableRows += '<tr style="border-bottom:1px solid #e8e8e8">'
      + '<td style="background:#fffde8;padding:6px 8px;font-size:11px;color:#555;text-align:center">' + le.name + '</td>'
      + '<td style="padding:6px 10px;font-size:12px;font-weight:700;text-align:center;color:' + lc + '">' + lv + '</td>'
      + '<td style="background:#fffde8;padding:6px 8px;font-size:11px;color:#555;text-align:center">' + (re ? re.name : '') + '</td>'
      + '<td style="padding:6px 10px;font-size:12px;font-weight:700;text-align:center;color:' + rc + '">' + (rv !== null ? rv : '') + '</td>'
      + '</tr>';
  }

  const html = ''
    // プロフィールカード
    + '<div style="margin:12px;border:2px solid #ccc;border-radius:4px;overflow:hidden">'
    + '<div style="display:flex">'
    + '<div style="width:120px;min-height:120px;background:#c8d8e8;display:flex;align-items:center;justify-content:center;flex-shrink:0;border-right:1px solid #ccc">'
    + '<span style="font-size:40px">👤</span>'
    + '</div>'
    + '<div style="padding:12px;font-size:13px;line-height:2">'
    + '<div><b>' + (_isEn && player.en_name ? player.en_name : (ex.longName || player.long_name)) + '</b></div>'
    + '<div>' + (_isEn ? 'Height: ' : '身長：') + heightStr + (_isEn ? '  Weight: ' : '　体重：') + weightStr + '</div>'
    + '</div>'
    + '</div>'
    + (profile ? '<div style="padding:10px 12px;font-size:12px;line-height:1.7;border-top:1px solid #ccc;background:#fafafa">' + profile + '</div>' : '')
    + '<div style="padding:10px 12px;font-size:12px;border-top:1px solid #ccc">'
    + '<div style="color:#555;margin-bottom:6px">' + (_isEn ? '◇ Positions' : '◇得意ポジション') + '</div>'
    + buildPositionMap(player.positions)
    + '</div>'
    + '<div style="padding:10px 12px;font-size:12px;border-top:1px solid #ccc">'
    + '<div style="color:#555;margin-bottom:6px">' + (_isEn ? '◇ Attributes' : '◇能力') + '</div>'
    + statsHtml
    + '</div>'
    + '</div>'
    // ステータス詳細テーブル
    + '<div style="text-align:center;font-size:14px;font-weight:700;margin:16px 0 8px">' + (_isEn ? '◆ Parameter Detail ◆' : '◆ステータス詳細◆') + '</div>'
    + '<div style="margin:0 12px;border:2px solid #ccc;border-radius:4px;overflow:hidden">'
    + '<table style="width:100%;border-collapse:collapse">'
    + tableRows
    + '</table>'
    + '</div>';

  document.getElementById('player-detail-body').innerHTML = html;
  document.getElementById('player-detail-body').scrollTop = 0;
  const backBtn = document.getElementById('player-detail-back-btn');
  if (backBtn) backBtn.onclick = function() { showScreen(_playerDetailOrigin); };
  showScreen('player-detail');
}

// ============================================================
// デュエル詳細分析モーダル
// ============================================================
function showDuelDetail(el) {
  const playerName = el.dataset.name;
  const teamName = el.dataset.team;
  const duelData = { win: parseInt(el.dataset.win), lose: parseInt(el.dataset.lose) };
  const scenesAll = _duelScenesCache;
  {
  // この選手が関わった全シーンを抽出
  const myScenes = scenesAll.filter(sc => {
    const isNormal = ['成功','失敗','ファール'].includes(sc.result);
    if (!isNormal) return false;
    const ofsName = (sc.offence.players[sc.offence.lineup[sc.ofsPos]] ? sc.offence.players[sc.offence.lineup[sc.ofsPos]].name : undefined);
    const dfsName = (sc.defence.players[sc.defence.lineup[sc.dfsPos]] ? sc.defence.players[sc.defence.lineup[sc.dfsPos]].name : undefined);
    return (sc.offence.name === teamName && ofsName === playerName) ||
           (sc.defence.name === teamName && dfsName === playerName);
  });

  // アクション×攻守別に集計
  const breakdown = {};
  myScenes.forEach(sc => {
    const isOfs = sc.offence.name === teamName &&
      (sc.offence.players[sc.offence.lineup[sc.ofsPos]] ? sc.offence.players[sc.offence.lineup[sc.ofsPos]].name : undefined) === playerName;
    const win = sc.result === '成功' || sc.result === 'ファール';
    const playerWin = isOfs ? win : !win;
    const role = isOfs ? 'atk' : 'def';
    const key = sc.action + '_' + role;
    if (!breakdown[key]) breakdown[key] = { action: sc.action, role: role, win: 0, lose: 0, ofsPoint: 0, dfsPoint: 0, count: 0 };
    playerWin ? breakdown[key].win++ : breakdown[key].lose++;
    breakdown[key].ofsPoint += sc.ofsPoint;
    breakdown[key].dfsPoint += sc.dfsPoint;
    breakdown[key].count++;
  });

  // 対戦相手集計
  const opponents = {};
  myScenes.forEach(sc => {
    const isOfs = sc.offence.name === teamName &&
      (sc.offence.players[sc.offence.lineup[sc.ofsPos]] ? sc.offence.players[sc.offence.lineup[sc.ofsPos]].name : undefined) === playerName;
    const oppName = isOfs
      ? (sc.defence.players[sc.defence.lineup[sc.dfsPos]] ? sc.defence.players[sc.defence.lineup[sc.dfsPos]].name : undefined)
      : (sc.offence.players[sc.offence.lineup[sc.ofsPos]] ? sc.offence.players[sc.offence.lineup[sc.ofsPos]].name : undefined);
    const win = sc.result === '成功' || sc.result === 'ファール';
    const playerWin = isOfs ? win : !win;
    if (!opponents[oppName]) opponents[oppName] = { win: 0, lose: 0 };
    playerWin ? opponents[oppName].win++ : opponents[oppName].lose++;
  });

  const total = duelData.win + duelData.lose;
  const rate = total > 0 ? Math.round(duelData.win / total * 100) : 0;
  const rateColor = rate >= 60 ? '#1a6bb5' : rate >= 40 ? '#e8a020' : '#c0392b';

  // アクション別テーブル（攻撃→守備、それぞれ成功率降順）
  const actionRows = Object.values(breakdown)
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'atk' ? -1 : 1;
      const ra = a.win / (a.win + a.lose);
      const rb = b.win / (b.win + b.lose);
      return rb - ra;
    })
    .map(d => {
      const t = d.win + d.lose;
      const r = Math.round(d.win / t * 100);
      const avgOfs = Math.round(d.ofsPoint / d.count);
      const avgDfs = Math.round(d.dfsPoint / d.count);
      const rc = r >= 60 ? '#1a6bb5' : r >= 40 ? '#e8a020' : '#c0392b';
      const badge = d.role === 'atk'
        ? '<span style="font-size:9px;background:#e8f0ff;color:#1a3a6b;border-radius:3px;padding:1px 4px;margin-right:4px">攻</span>'
        : '<span style="font-size:9px;background:#fff0e8;color:#c0392b;border-radius:3px;padding:1px 4px;margin-right:4px">守</span>';
      return '<tr style="border-bottom:1px solid #f0f0f0">'
        + '<td style="padding:6px 8px;font-size:11px">' + badge + d.action + '</td>'
        + '<td style="padding:6px 8px;font-size:11px;text-align:center;font-weight:700;color:' + rc + '">' + r + '%</td>'
        + '<td style="padding:6px 8px;font-size:10px;color:#888;text-align:center">' + d.win + '/' + t + '</td>'
        + '<td style="padding:6px 8px;font-size:10px;color:#555;text-align:center">' + avgOfs + ' vs ' + avgDfs + '</td>'
        + '</tr>';
    }).join('');

  // 対戦相手ランキング
  const oppRows = Object.entries(opponents)
    .sort((a, b) => (b[1].win + b[1].lose) - (a[1].win + a[1].lose))
    .slice(0, 5)
    .map(([name, d]) => {
      const t = d.win + d.lose;
      const r = Math.round(d.win / t * 100);
      const rc = r >= 60 ? '#1a6bb5' : r >= 40 ? '#e8a020' : '#c0392b';
      return '<div style="display:flex;align-items:center;padding:4px 0;gap:8px;border-bottom:1px solid #f5f5f5">'
        + '<div style="width:6em;font-size:11px;font-weight:700;overflow:hidden;white-space:nowrap">' + name + '</div>'
        + '<div style="flex:1;background:#eee;border-radius:3px;height:6px;overflow:hidden"><div style="width:' + r + '%;background:' + rc + ';height:100%;border-radius:3px"></div></div>'
        + '<div style="width:3em;text-align:right;font-size:11px;font-weight:700;color:' + rc + '">' + r + '%</div>'
        + '<div style="width:4em;text-align:right;font-size:10px;color:#aaa">' + d.win + '/' + t + '</div>'
        + '</div>';
    }).join('');

  const html = '<div style="font-size:18px;font-weight:900;margin-bottom:2px">' + playerName + '</div>'
    + '<div style="font-size:12px;color:#888;margin-bottom:12px">' + teamName + '</div>'
    + '<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;padding:12px;background:#f5f7fa;border-radius:10px">'
    + '<div style="text-align:center"><div style="font-size:36px;font-weight:900;color:' + rateColor + '">' + rate + '%</div><div style="font-size:10px;color:#888">デュエル勝率</div></div>'
    + '<div style="text-align:center"><div style="font-size:20px;font-weight:700">' + duelData.win + '</div><div style="font-size:10px;color:#888">勝</div></div>'
    + '<div style="text-align:center"><div style="font-size:20px;font-weight:700">' + duelData.lose + '</div><div style="font-size:10px;color:#888">敗</div></div>'
    + '<div style="text-align:center"><div style="font-size:20px;font-weight:700">' + total + '</div><div style="font-size:10px;color:#888">計</div></div>'
    + '</div>'
    + '<div style="font-size:12px;font-weight:700;color:#1a3a6b;margin-bottom:6px">アクション別勝率</div>'
    + '<table style="width:100%;border-collapse:collapse;margin-bottom:16px">'
    + '<tr style="background:#1a3a6b;color:white"><th style="padding:6px 8px;font-size:10px;text-align:left">アクション</th><th style="padding:6px 8px;font-size:10px">勝率</th><th style="padding:6px 8px;font-size:10px">勝/計</th><th style="padding:6px 8px;font-size:10px">攻/守pt</th></tr>'
    + actionRows
    + '</table>'
    + '<div style="font-size:12px;font-weight:700;color:#1a3a6b;margin-bottom:6px">主な対戦相手（上位5名）</div>'
    + oppRows;

  document.getElementById('duel-detail-content').innerHTML = html;
  document.getElementById('modal-duel-detail').classList.add('open');
  }
}

