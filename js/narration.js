// ============================================================
// 10試合シミュレーション
// ============================================================
function runMultiGame(GAMES) {
  GAMES = GAMES || 10;
  const t2sys = system_data.findIndex(s => s.name === team2Data.default_system);
  const t2StateBase = {
    systemIdx: t2sys >= 0 ? t2sys : 0,
    tactics: team2Data.default_tactics,
    keyplayer: team2Data.default_keyplayer,
    marked_player: team2Data.default_marked_player !== undefined ? team2Data.default_marked_player : -1,
    lineup: [...team2Data.default_lineup.slice(0, 11)]
  };

  let t1wins = 0, t2wins = 0, draws = 0;
  const scores = [];
  const areaWin = {};  // 日本攻撃時の勝率
  const areaDef = {};  // ベルギー攻撃時の日本守備勝率
  const playerDuel = {};
  const allGoalPatterns = {};
  const goalScorers = {};
  const gkSave = {};   // GKセーブ率
  const scenesAllMulti = [];

  for (let g = 0; g < GAMES; g++) {
    const t1 = buildTeam(team1Data, team1State);
    const t2 = buildTeam(team2Data, t2StateBase);
    [t1, t2].forEach(t => {
      t.score = 0; t.chanceCounter = 0; t.shootCounter = 0; t.gkSaveCounter = 0;
      t.players.forEach(p => { p.chance_counter = 0; p.fatigue = 0; });
    });
    const gs = { team1: t1, team2: t2 };
    const results = [];
    for (let i = 0; i < 16; i++) {
      results.push(simulateChance(gs, i));
    }
    // ロスタイムは50%で発生
    if (Math.random() < 0.5) {
      results.push(simulateChance(gs, 16));
    }

    const t1s = t1.score, t2s = t2.score;
    // ポゼッション集計用
    let _t1atk = 0, _t2atk = 0;
    results.forEach(function(res){ res.scenes.forEach(function(s){ if(s.offence===t1) _t1atk++; else _t2atk++; }); });
    // チャンス数（攻撃側チーム別）
    let _t1chance = 0, _t2chance = 0;
    results.forEach(function(res){ if(res.scenes[0] && res.scenes[0].offence===t1) _t1chance++; else _t2chance++; });
    scores.push({ t1: t1s, t2: t2s, t1shoot: t1.shootCounter, t2shoot: t2.shootCounter, t1save: t1.gkSaveCounter, t2save: t2.gkSaveCounter, t1atk: _t1atk, t2atk: _t2atk, chances: results.length, t1chance: _t1chance, t2chance: _t2chance });
    if (t1s > t2s) t1wins++;
    else if (t2s > t1s) t2wins++;
    else draws++;

    results.forEach(res => {
      res.scenes.forEach(sc => {
        const isShoot = ['ゴール！！','GK防いだ！','枠を外した！'].includes(sc.result);
        const isNormal = ['成功','失敗','ファール'].includes(sc.result);
        if (!isNormal && !isShoot) return;

        // シュートシーンの勝敗（攻撃側視点）
        const win = isShoot
          ? sc.result === 'ゴール！！'
          : sc.result === '成功' || sc.result === 'ファール';

        // エリア別勝率（シュートも含む）
        if (sc.offence.name === team1Data.name) {
          const atkArea = (['FW_L','CR_L'].includes(sc.area)) ? 'GOAL_L'
                        : (['FW_M','CR_M','SHOOT_M'].includes(sc.area)) ? 'GOAL_M'
                        : (['FW_R','CR_R'].includes(sc.area)) ? 'GOAL_R'
                        : sc.area;
          if (!areaWin[atkArea]) areaWin[atkArea] = { win: 0, lose: 0 };
          win ? areaWin[atkArea].win++ : areaWin[atkArea].lose++;
        }
        if (sc.defence.name === team1Data.name) {
          const aFlip = {'DF':'FW','FW':'DF','MF':'MF','CR':'CR','SHOOT':'CR'};
          const rawArea = sc.area === 'SHOOT_M' ? 'CR_M' : sc.area;
          const pos2 = rawArea.substring(0,rawArea.indexOf('_'));
          const side2 = rawArea.substring(rawArea.indexOf('_')+1);
          const flippedPos = aFlip[pos2] || pos2;
          const flippedSide = side2==='L'?'R':side2==='R'?'L':side2;
          const flipArea = flippedPos + '_' + flippedSide;
          const defKey = (['FW_L','CR_L'].includes(flipArea)) ? 'GOAL_L'
                       : (['FW_M','CR_M','SHOOT_M','CR_CENTER'].includes(flipArea)) ? 'GOAL_M'
                       : (['FW_R','CR_R'].includes(flipArea)) ? 'GOAL_R'
                       : flipArea;
          if (!areaDef[defKey]) areaDef[defKey] = { win: 0, lose: 0 };
          win ? areaDef[defKey].lose++ : areaDef[defKey].win++;
        }

        // デュエル勝率（GKはGKセーブ率として別集計、通常デュエルから除外）
        if (isNormal) {
          scenesAllMulti.push(sc);
          const ofsP = sc.offence.players[sc.offence.lineup[sc.ofsPos]];
          const ofsName = ofsP ? ofsP.name : undefined;
          const ofsKey = sc.offence.name + '_' + ofsName;
          if (!playerDuel[ofsKey]) playerDuel[ofsKey] = { name: ofsName, en_name: ofsP ? ofsP.en_name : undefined, team: sc.offence.name, color: sc.offence.team_color, win: 0, lose: 0 };
          win ? playerDuel[ofsKey].win++ : playerDuel[ofsKey].lose++;
          const dfsP = sc.defence.players[sc.defence.lineup[sc.dfsPos]];
          const dfsName = dfsP ? dfsP.name : undefined;
          const dfsKey = sc.defence.name + '_' + dfsName;
          if (!playerDuel[dfsKey]) playerDuel[dfsKey] = { name: dfsName, en_name: dfsP ? dfsP.en_name : undefined, team: sc.defence.name, color: sc.defence.team_color, win: 0, lose: 0 };
          win ? playerDuel[dfsKey].lose++ : playerDuel[dfsKey].win++;
        }
        if (isShoot) {
          const gkP = sc.defence.players[sc.defence.lineup[0]];
          const gkName = gkP ? gkP.name : undefined;
          const gkKey = sc.defence.name + '_GK';
          if (!gkSave[gkKey]) gkSave[gkKey] = { name: gkName, en_name: gkP ? gkP.en_name : undefined, team: sc.defence.name, color: sc.defence.team_color, save: 0, goal: 0 };
          sc.result === 'GK防いだ！' ? gkSave[gkKey].save++ : gkSave[gkKey].goal++;
          // ゴールパターン集計
          if (sc.result === 'ゴール！！') {
            const gk = sc.offence.name + ' / ' + sc.action;
            if (!allGoalPatterns[gk]) allGoalPatterns[gk] = 0;
            allGoalPatterns[gk]++;
            // 得点者集計
            const scorerP = sc.offence.players[sc.offence.lineup[sc.ofsPos]];
            if (scorerP) {
              const sk = sc.offence.name + '_' + scorerP.name;
              if (!goalScorers[sk]) goalScorers[sk] = { name: scorerP.name, en_name: scorerP.en_name, team: sc.offence.name, color: sc.offence.team_color, goals: 0, assists: 0 };
              goalScorers[sk].goals++;
            }
            // アシスト集計（クロス・セットプレーでcrossPos !== ofsPos の場合）
            if (sc.crossPos !== undefined && sc.crossPos !== sc.ofsPos) {
              const assistP = sc.offence.players[sc.offence.lineup[sc.crossPos]];
              if (assistP) {
                const ak = sc.offence.name + '_' + assistP.name;
                if (!goalScorers[ak]) goalScorers[ak] = { name: assistP.name, en_name: assistP.en_name, team: sc.offence.name, color: sc.offence.team_color, goals: 0, assists: 0 };
                goalScorers[ak].assists++;
              }
            }
          }
        }
      });
    });
  }

  const el = document.getElementById('multigame-content');
  const avgT1 = (scores.reduce((s,r) => s+r.t1, 0)/GAMES).toFixed(1);
  const avgT2 = (scores.reduce((s,r) => s+r.t2, 0)/GAMES).toFixed(1);

  let html = `<div style="background:white;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <div style="display:flex;justify-content:space-around;text-align:center;margin-bottom:12px">
      <div><div style="font-size:32px;font-weight:700;color:${team1Data.team_color}">${t1wins}</div><div style="font-size:11px;color:#888">${team1Data.flag} ${t('winLabel')}</div></div>
      <div><div style="font-size:32px;font-weight:700;color:#aaa">${draws}</div><div style="font-size:11px;color:#888">${t('drawLabel')}</div></div>
      <div><div style="font-size:32px;font-weight:700;color:${team2Data.team_color}">${t2wins}</div><div style="font-size:11px;color:#888">${team2Data.flag} ${t('winLabel')}</div></div>
    </div>
    <div style="text-align:center;font-size:14px;color:#555;margin-bottom:10px">${t('avgScore')}  <b style="color:${team1Data.team_color}">${avgT1}</b> vs <b style="color:${team2Data.team_color}">${avgT2}</b></div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center">
      ${scores.map(s => { const col = s.t1>s.t2 ? team1Data.team_color : s.t2>s.t1 ? team2Data.team_color : '#999'; return '<span style="font-size:12px;padding:2px 8px;border-radius:12px;background:'+col+';color:white;font-weight:700">'+s.t1+'-'+s.t2+'</span>'; }).join('')}
    </div>
  </div>`;

  // CR_MとSHOOT_Mを統合して表示（中央シュートエリア）
  const AREA_SVG = {
    'DF_L':{x:15,y:20},'DF_M':{x:15,y:50},'DF_R':{x:15,y:80},
    'MF_L':{x:50,y:22},'MF_M':{x:50,y:50},'MF_R':{x:50,y:78},
    'GOAL_L':{x:84,y:22},'GOAL_M':{x:87,y:50},'GOAL_R':{x:84,y:78}
  };
  const W2=340,H2=180;
  const px2=xp=>xp/100*W2, py2=yp=>yp/100*H2;
  let svg=`<svg width="${W2}" height="${H2}" viewBox="0 0 ${W2} ${H2}" style="display:block;margin:0 auto;border-radius:8px;overflow:hidden">
  <rect width="${W2}" height="${H2}" fill="#2d7a3a"/>`;
  for(let i=0;i<8;i++){if(i%2===0)svg+=`<rect x="${(i*W2/8).toFixed(0)}" y="0" width="${(W2/8).toFixed(0)}" height="${H2}" fill="rgba(0,0,0,0.07)"/>`;}
  svg+=`<rect x="4" y="4" width="${W2-8}" height="${H2-8}" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>
  <line x1="${W2/2}" y1="4" x2="${W2/2}" y2="${H2-4}" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>
  <circle cx="${W2/2}" cy="${H2/2}" r="24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>
  <rect x="4" y="${H2*0.25}" width="${W2*0.14}" height="${H2*0.5}" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>
  <rect x="${W2-4-W2*0.14}" y="${H2*0.25}" width="${W2*0.14}" height="${H2*0.5}" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>
  <rect x="0" y="${H2*0.38}" width="8" height="${H2*0.24}" fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>
  <rect x="${W2-8}" y="${H2*0.38}" width="8" height="${H2*0.24}" fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>`;
  Object.entries(AREA_SVG).forEach(([area,pos])=>{
    // CR_CENTERはCR_MとSHOOT_Mのデータを合算
    const d=areaWin[area], total=d?d.win+d.lose:0, rate=total>0?Math.round(d.win/total*100):null;
    const dd=areaDef[area], dtotal=dd?dd.win+dd.lose:0, drate=dtotal>0?Math.round(dd.win/dtotal*100):null;
    const cx=px2(pos.x),cy=py2(pos.y),r=20;
    const bg=rate===null?'rgba(0,0,0,0.35)':rate>=60?'#1a6bb5':rate>=40?'#e8a020':'#c0392b';
    const atkStr = rate !== null ? rate + '%' : '-';
    const defStr = drate !== null ? drate + '%' : '-';
    svg += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r + '" fill="' + bg + '" fill-opacity="0.88" stroke="white" stroke-width="1.2"/>';
    svg += '<text x="' + cx.toFixed(1) + '" y="' + (cy-5).toFixed(1) + '" text-anchor="middle" font-size="9" font-weight="700" fill="white">' + atkStr + '</text>';
    svg += '<line x1="' + (cx-10).toFixed(1) + '" y1="' + cy.toFixed(1) + '" x2="' + (cx+10).toFixed(1) + '" y2="' + cy.toFixed(1) + '" stroke="rgba(255,255,255,0.4)" stroke-width="0.7"/>';
    svg += '<text x="' + cx.toFixed(1) + '" y="' + (cy+8).toFixed(1) + '" text-anchor="middle" font-size="9" fill="rgba(255,220,220,0.95)">' + defStr + '</text>';
  });
  svg+=`<text x="${W2/2}" y="${H2-6}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.6)">${window.LANG==='en'?'← Own Half     Opp Half →':'← 自陣          相手陣 →'}</text></svg>`;

  html += '<div style="display:flex;gap:8px;margin-bottom:12px">'
    + '<button onclick="shareToX(\'multi\')" style="flex:1;padding:10px;border:none;border-radius:10px;background:#000;color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">𝕏 ' + t('shareX') + '</button>'
    + '<button onclick="shareToReddit(\'multi\')" style="flex:1;padding:10px;border:none;border-radius:10px;background:#ff4500;color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Reddit</button>'
    + '<button onclick="generateShareImage(\'multi\')" style="flex:1;padding:10px;border:none;border-radius:10px;background:linear-gradient(135deg,#1a3a6b,#0050cc);color:white;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">' + t('shareImg') + '</button>'
    + '</div>';
  html+=`<div style="background:white;border-radius:12px;padding:12px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <div style="font-size:12px;font-weight:700;color:#1a3a6b;margin-bottom:8px">📊 ${window.LANG==='en'?'Japan Win Rate by Area ('+GAMES+' matches)':'エリア別 日本の勝率（'+GAMES+'試合合計）'}</div>
    <div id="multi-field-tabs"></div>
  </div>`;

  const makeTeamDuel=(teamName,teamData)=>{
    const list=Object.values(playerDuel).filter(d=>d.team===teamName).sort((a,b)=>(b.win+b.lose)-(a.win+a.lose));
    if(!list.length)return'';
    const rows=list.map(d=>{
      const total=d.win+d.lose,rate=total>0?Math.round(d.win/total*100):0;
      const bc=rate>=60?'#1a6bb5':rate>=40?'#2d7a3a':'#c0392b';
      return '<div style="display:flex;align-items:center;padding:5px 10px;border-bottom:1px solid #f0f0f0;gap:8px">'
        +'<div style="width:5em;font-size:12px;font-weight:700;overflow:hidden;white-space:nowrap;cursor:pointer;text-decoration:underline;color:#1a3a6b" onclick="showDuelDetail(this)"'
        +' data-name="'+d.name+'" data-team="'+teamName+'" data-win="'+d.win+'" data-lose="'+d.lose+'">'
        +(window.LANG==='en'&&d.en_name?d.en_name:d.name)+'</div>'
        +'<div style="flex:1;background:#eee;border-radius:4px;height:7px;overflow:hidden"><div style="width:'+rate+'%;background:'+bc+';height:100%;border-radius:4px"></div></div>'
        +'<div style="width:3em;text-align:right;font-size:12px;font-weight:700;color:'+bc+'">'+rate+'%</div>'
        +'<div style="width:5em;text-align:right;font-size:10px;color:#aaa">'+d.win+(window.LANG==='en'?'W ':' 勝')+d.lose+(window.LANG==='en'?'L':' 敗')+'</div>'
        +'</div>';
    }).join('');
    return '<div style="margin-bottom:8px"><div style="background:'+teamData.team_color+';color:white;font-size:12px;font-weight:700;padding:5px 10px;border-radius:8px 8px 0 0">'+teamData.flag+' '+getTeamName(teamData)+'</div>'+rows+'</div>';
  };

  // GKセーブ率HTML
  const gkHtml = Object.values(gkSave).map(gk => {
    const total = gk.save + gk.goal;
    const rate = total > 0 ? Math.round(gk.save / total * 100) : 0;
    const bc = rate >= 70 ? '#1a6bb5' : rate >= 50 ? '#2d7a3a' : '#c0392b';
    return '<div style="display:flex;align-items:center;padding:6px 12px;border-bottom:1px solid #f0f0f0;gap:8px">'
      + '<div style="width:5em;font-size:12px;font-weight:700">' + (window.LANG==='en'&&gk.en_name?gk.en_name:gk.name) + '</div>'
      + '<div style="flex:1;background:#eee;border-radius:4px;height:7px;overflow:hidden"><div style="width:' + rate + '%;background:' + bc + ';height:100%;border-radius:4px"></div></div>'
      + '<div style="width:3em;text-align:right;font-size:12px;font-weight:700;color:' + bc + '">' + rate + '%</div>'
      + '<div style="width:6em;text-align:right;font-size:10px;color:#aaa">' + gk.save + 'S/' + total + 'SH</div>'
      + '</div>';
  }).join('');

  html+=`<div style="background:white;border-radius:12px;padding:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <div style="font-size:12px;font-weight:700;color:#1a3a6b;margin-bottom:8px">⚔️ ${window.LANG==='en'?'Duel Win Rate ('+GAMES+' matches)':'デュエル勝率（'+GAMES+'試合合計）'}</div>
    ${makeTeamDuel(team1Data.name,team1Data)}
    ${makeTeamDuel(team2Data.name,team2Data)}
  </div>`;

  html+=`<div style="background:white;border-radius:12px;padding:12px;margin-top:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <div style="font-size:12px;font-weight:700;color:#1a3a6b;margin-bottom:8px">🧤 ${window.LANG==='en'?'GK Save Rate ('+GAMES+' matches)':'GKセーブ率（'+GAMES+'試合合計）'}</div>
    ${gkHtml}
  </div>`;

  _duelScenesCache = scenesAllMulti;

  // ===== 追加スタッツ（10試合集計）=====

  // ① ポゼッション（10試合平均）
  var _t1atkTotal = scores.reduce(function(s,r){return s+r.t1atk;},0);
  var _t2atkTotal = scores.reduce(function(s,r){return s+r.t2atk;},0);
  var _possTotal = _t1atkTotal + _t2atkTotal || 1;
  var _t1poss = Math.round(_t1atkTotal / _possTotal * 100);
  var _t2poss = 100 - _t1poss;

  // ② 選手別関与シーン数（全試合合算）
  var _mvpCounter = {};
  scenesAllMulti.forEach(function(s){
    var p = s.offence.players[s.offence.lineup[s.ofsPos]];
    if (!p) return;
    var tname = s.offence.name;
    var k = tname + '_' + p.name;
    if (!_mvpCounter[k]) _mvpCounter[k] = { name: p.long_name||p.name, en_name: p.en_name, team: tname, color: s.offence.team_color, count: 0, dispName: window.LANG==='en'&&p.en_name?p.en_name:(p.long_name||p.name) };
    _mvpCounter[k].count++;
  });
  var _t1mvps = Object.values(_mvpCounter).filter(function(v){return v.team===team1Data.name;}).sort(function(a,b){return b.count-a.count;}).slice(0,5);
  var _t2mvps = Object.values(_mvpCounter).filter(function(v){return v.team===team2Data.name;}).sort(function(a,b){return b.count-a.count;}).slice(0,5);

  // ③ 攻撃パターン別ゴール（全試合合算）
  var _patterns = allGoalPatterns;

  var _hl = []; // ハイライト削除

  // シュート数合計
  var _t1shootTotal = scores.reduce(function(s,r){return s+r.t1shoot;},0);
  var _t2shootTotal = scores.reduce(function(s,r){return s+r.t2shoot;},0);
  var _t1saveTotal  = scores.reduce(function(s,r){return s+r.t1save;},0);
  var _t2saveTotal  = scores.reduce(function(s,r){return s+r.t2save;},0);

  // ===== HTML追加 =====
  var mgColor = function(teamName) { return teamName === team1Data.name ? team1Data.team_color : team2Data.team_color; };
  var mgTeamDisplay = function(teamName) {
    if (window.LANG === 'en') {
      return teamName === team1Data.name ? (team1Data.en_name||team1Data.name) : (team2Data.en_name||team2Data.name);
    }
    return teamName;
  };

  // 得点者・アシスト ランキング（上位3名）
  (function() {
    var isEn = window.LANG === 'en';
    var t1scorers = Object.values(goalScorers)
      .filter(function(v){return v.team===team1Data.name;})
      .sort(function(a,b){return (b.goals*10+b.assists)-(a.goals*10+a.assists);})
      .slice(0,3);
    var t2scorers = Object.values(goalScorers)
      .filter(function(v){return v.team===team2Data.name;})
      .sort(function(a,b){return (b.goals*10+b.assists)-(a.goals*10+a.assists);})
      .slice(0,3);

    function renderScorers(list, tdata) {
      if (!list.length) return '<div style="font-size:11px;color:#aaa;padding:6px 0">' + (isEn?'No goals':'得点なし') + '</div>';
      return list.map(function(v, i) {
        var medal = i===0?'🥇':i===1?'🥈':'🥉';
        var dispName = (isEn && v.en_name) ? v.en_name : v.name;
        return '<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid #f5f5f5">'
          + '<span style="font-size:13px">' + medal + '</span>'
          + '<span style="font-size:12px;font-weight:700;color:' + tdata.team_color + ';flex:1">' + dispName + '</span>'
          + '<span style="font-size:13px;font-weight:700;color:' + tdata.team_color + '">' + v.goals + (isEn?'G':'点') + '</span>'
          + (v.assists > 0 ? '<span style="font-size:11px;color:#888;margin-left:4px">' + v.assists + 'A</span>' : '')
          + '</div>';
      }).join('');
    }

    var title = isEn ? '⚽ Top Scorers ('+GAMES+' Matches)' : '⚽ 得点者ランキング（'+GAMES+'試合合算）';
    var aNote = isEn ? ' <span style="font-size:10px;color:#aaa">* A = cross/set-piece assists</span>'
                     : ' <span style="font-size:10px;color:#aaa">※Aはクロス・セットプレーのアシスト</span>';

    html += '<div style="background:white;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">'
      + '<div style="font-size:12px;font-weight:700;color:#555;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #e8eef5">' + title + aNote + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + '<div><div style="background:' + team1Data.team_color + ';color:white;font-size:11px;font-weight:700;padding:4px 8px;border-radius:6px 6px 0 0">' + team1Data.flag + ' ' + getTeamName(team1Data) + '</div>'
      + renderScorers(t1scorers, team1Data) + '</div>'
      + '<div><div style="background:' + team2Data.team_color + ';color:white;font-size:11px;font-weight:700;padding:4px 8px;border-radius:6px 6px 0 0">' + team2Data.flag + ' ' + getTeamName(team2Data) + '</div>'
      + renderScorers(t2scorers, team2Data) + '</div>'
      + '</div></div>';
  })();

  // ポゼッション
  html += '<div style="background:white;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">'
    + '<div style="font-size:12px;font-weight:700;color:#555;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #e8eef5">📊 ' + (window.LANG==='en'?'Possession ('+GAMES+'-Match Avg)':'ポゼッション（'+GAMES+'試合平均）') + '</div>'
    + '<div style="display:flex;align-items:center;gap:8px;padding:4px 0">'
    + '<div style="font-size:13px;font-weight:700;color:' + team1Data.team_color + ';width:36px;text-align:right">' + _t1poss + '%</div>'
    + '<div style="flex:1;height:14px;border-radius:7px;overflow:hidden;background:#eee;display:flex">'
    + '<div style="width:' + _t1poss + '%;background:' + team1Data.team_color + '"></div>'
    + '<div style="width:' + _t2poss + '%;background:' + team2Data.team_color + '"></div>'
    + '</div>'
    + '<div style="font-size:13px;font-weight:700;color:' + team2Data.team_color + ';width:36px">' + _t2poss + '%</div>'
    + '</div>'
    + '<div style="display:flex;justify-content:space-between;font-size:10px;color:#888;margin-top:4px">'
    + '<span>' + team1Data.flag + ' ' + getTeamName(team1Data) + '</span>'
    + '<span>' + (window.LANG==='en' ? 'Shots: '+_t1shootTotal+' / '+_t2shootTotal : 'シュート '+_t1shootTotal+'本 / '+_t2shootTotal+'本') + '</span>'
    + '<span>' + team2Data.flag + ' ' + getTeamName(team2Data) + '</span>'
    + '</div>'
    + '</div>';

  // チャンス・シュート・セーブ（1試合平均）
  var _t1chanceTotal = scores.reduce(function(s,r){return s+(r.t1chance||0);},0);
  var _t2chanceTotal = scores.reduce(function(s,r){return s+(r.t2chance||0);},0);
  var _statsRows = [
    { label: window.LANG==='en'?'Chances':'チャンス数', t1: (_t1chanceTotal/GAMES).toFixed(1), t2: (_t2chanceTotal/GAMES).toFixed(1) },
    { label: window.LANG==='en'?'Shots':'シュート',   t1: (_t1shootTotal/GAMES).toFixed(1),  t2: (_t2shootTotal/GAMES).toFixed(1) },
    { label: window.LANG==='en'?'GK Saves':'GKセーブ',  t1: (_t1saveTotal/GAMES).toFixed(1),   t2: (_t2saveTotal/GAMES).toFixed(1) },
  ];
  var _statsGridHtml = '<div class="stats-grid">';
  _statsRows.forEach(function(row) {
    _statsGridHtml += '<div style="padding:12px 16px;text-align:center;font-size:16px;font-weight:700;border-top:1px solid rgba(0,0,0,0.08)">' + row.t1 + '</div>'
      + '<div style="padding:12px 8px;text-align:center;font-size:11px;color:var(--text-dim);display:flex;align-items:center;justify-content:center;border-top:1px solid rgba(0,0,0,0.08)">' + row.label + '</div>'
      + '<div style="padding:12px 16px;text-align:center;font-size:16px;font-weight:700;border-top:1px solid rgba(0,0,0,0.08)">' + row.t2 + '</div>';
  });
  _statsGridHtml += '</div>';
  html += '<div style="background:white;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">'
    + '<div style="font-size:12px;font-weight:700;color:#555;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #e8eef5">📈 ' + (window.LANG==='en'?'Chances / Shots / Saves (Per Match, '+GAMES+' total)':'チャンス・シュート・セーブ（1試合平均・'+GAMES+'試合）') + '</div>'
    + '<div style="display:flex;justify-content:space-between;font-size:10px;color:#888;margin-bottom:6px">'
    + '<span>' + team1Data.flag + ' ' + getTeamName(team1Data) + '</span>'
    + '<span>' + team2Data.flag + ' ' + getTeamName(team2Data) + '</span>'
    + '</div>'
    + _statsGridHtml
    + '</div>';

  // 選手別関与シーン数
  var _mvpHtml = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  [['t1', _t1mvps, team1Data], ['t2', _t2mvps, team2Data]].forEach(function(arr){
    var key=arr[0], list=arr[1], tdata=arr[2];
    var maxC = list.length ? list[0].count : 1;
    _mvpHtml += '<div>';
    list.forEach(function(v, i){
      var pct = Math.round(v.count/maxC*100);
      var medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':'　';
      _mvpHtml += '<div style="margin-bottom:6px">'
        + '<div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;margin-bottom:2px">'
        + '<span>' + medal + ' <span style="color:' + tdata.team_color + '">' + (window.LANG==='en'&&v.en_name?v.en_name:(v.dispName||v.name)) + '</span></span>'
        + '<span style="color:#888">' + v.count + (window.LANG==='en'?'x':'回') + '</span></div>'
        + '<div style="height:6px;background:#eee;border-radius:3px;overflow:hidden">'
        + '<div style="width:' + pct + '%;height:100%;background:' + tdata.team_color + ';border-radius:3px"></div>'
        + '</div></div>';
    });
    _mvpHtml += '</div>';
  });
  _mvpHtml += '</div>';
  html += '<div style="background:white;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">'
    + '<div style="font-size:12px;font-weight:700;color:#555;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #e8eef5">🏃 ' + (window.LANG==='en'?'Player Scene Involvement ('+GAMES+' Matches)':'選手別関与シーン数（'+GAMES+'試合合算）') + '</div>'
    + _mvpHtml + '</div>';

  // 攻撃パターン別ゴール
  var _patList = Object.entries(_patterns).sort(function(a,b){return b[1]-a[1];});
  var _patHtml = _patList.length ? _patList.map(function(e){
    var rawTeamName = e[0].split(' / ')[0];
    var dispTeamName = mgTeamDisplay(rawTeamName);
    return '<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px">'
      + '<span style="color:' + mgColor(rawTeamName) + ';font-weight:700;min-width:50px">' + dispTeamName + '</span>'
      + '<span style="flex:1">' + getActionLabel(e[0].split(' / ')[1]) + '</span>'
      + '<span style="font-weight:700">⚽×' + e[1] + '</span></div>';
  }).join('') : '<span style="font-size:11px;color:#888">' + (window.LANG==='en'?'No goals':'得点なし') + '</span>';
  html += '<div style="background:white;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">'
    + '<div style="font-size:12px;font-weight:700;color:#555;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #e8eef5">⚽ ' + (window.LANG==='en'?'Goals by Attack Pattern ('+GAMES+' Matches)':'攻撃パターン別ゴール（'+GAMES+'試合合算）') + '</div>'
    + _patHtml + '</div>';




  // AI総括ボタン
  html += '<div style="background:white;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">'
    + '<div style="font-size:12px;font-weight:700;color:#555;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #e8eef5;display:flex;align-items:center;justify-content:space-between">'
    + '<span>' + (window.LANG==='en' ? '🤖 AI Summary ('+GAMES+' Matches)' : '🤖 AI総括（'+GAMES+'試合）') + '</span>'
    + '<button id="multi-summary-btn" onclick="generateMultiSummary(' + t1wins + ',' + t2wins + ',' + draws + ',' + _t1poss + ',' + _t1shootTotal + ',' + _t2shootTotal + ',' + GAMES + ')" '
    + 'style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid #ccc;background:#f5f5f5;color:#333;cursor:pointer;font-family:inherit;font-weight:700">' + t('multiAiBtn') + '</button>'
    + '</div>'
    + '<div id="multi-summary-content" style="font-size:13px;line-height:1.8;color:#555">'
    + '<span style="font-size:12px;color:#aaa">' + (window.LANG==='en' ? 'Press "✨ Generate" for an AI summary of '+GAMES+' matches.' : '「✨ 生成」ボタンを押すと、AIが'+GAMES+'試合を総括します') + '</span>'
    + '</div></div>';

  // MVP情報をグローバルに保存（AI総括用）
  window._multiMvps = _t1mvps.concat(_t2mvps);
  window._multiPatterns = _patList;
  window._t1saveTotal = _t1saveTotal;
  window._t2saveTotal = _t2saveTotal;
  window._multiGAMES = GAMES;
  window._multiT1wins = t1wins;
  window._multiT2wins = t2wins;
  window._multiPoss1  = _t1poss;
  window._multiGoalScorers = goalScorers;

  // Patreonバナーを最下部に追加
  // html += getPatreonBannerHtml(window.LANG === 'en'); // [PATREON] 一時非表示

  // 📸 シェアボタンを追加


  _duelScenesCache = scenesAllMulti;
  el.innerHTML = html;
  buildFieldWithTabs(areaWin, areaDef, 340, 180, 'multi-field-tabs');
  // 結果画面タイトルを試合数に応じて更新
  var multiTitle = document.getElementById('screen-multi-title');
  if (multiTitle) {
    if (window.LANG === 'en') {
      multiTitle.textContent = GAMES + '-Match Simulation';
    } else {
      multiTitle.textContent = GAMES + '試合シミュレーション';
    }
  }
  showScreen('multigame');
  // 結果画面のトップにスクロール
  var multiEl = document.getElementById('screen-multigame');
  if (multiEl) multiEl.scrollTop = 0;
  window.scrollTo(0, 0);
}

function showResult() {
  // 延長前半終了時は結果画面を経由せず延長後半へ直接遷移
  if ((isWCR32Mode || isWCR16Mode || isWCQFMode || isWCSFMode || isWCFMode) && wcPhase === 'et_first') {
    wcMatchLog = wcMatchLog.concat(chanceResults); // 90min + ET1 を結合（wcMatchLogには90minが既に入っている）
    wcETScore.t1 += gameState.team1.score;
    wcETScore.t2 += gameState.team2.score;
    wcCumulativeStats.chances1 += gameState.team1.chanceCounter;
    wcCumulativeStats.shots1   += gameState.team1.shootCounter;
    wcCumulativeStats.saves1   += gameState.team1.gkSaveCounter;
    wcCumulativeStats.chances2 += gameState.team2.chanceCounter;
    wcCumulativeStats.shots2   += gameState.team2.shootCounter;
    wcCumulativeStats.saves2   += gameState.team2.gkSaveCounter;
    wcPhase = 'et_second';
    _runWCETPhase();
    return;
  }
  _wcSkipToEnd = false; // ET2結果表示に到達したのでフラグをリセット

  document.getElementById('sub-btn').style.display = 'none';
  const lastRes = chanceResults[chanceResults.length - 1];
  const t1score = lastRes.t1score;
  const t2score = lastRes.t2score;

  document.getElementById('result-name1').textContent = getTeamName(team1Data);
  document.getElementById('result-name2').textContent = getTeamName(team2Data);
  // エリア別ヘッダーをチーム1の実名で上書き（"日本"固定を解消）
  const _areaHdr = document.getElementById('header-area-win');
  if (_areaHdr) _areaHdr.textContent = window.LANG === 'en'
    ? '[' + getTeamName(team1Data) + ' Tendency by Area]'
    : '【エリア別 ' + getTeamName(team1Data) + 'の傾向】';
  document.getElementById('result-score1').textContent = t1score;
  document.getElementById('result-score1').style.color = team1Data.team_color;
  document.getElementById('result-score2').textContent = t2score;
  document.getElementById('result-score2').style.color = team2Data.team_color;

  const winner = document.getElementById('result-winner');
  if (t1score > t2score) {
    winner.textContent = `${team1Data.flag} ${getTeamName(team1Data)}${t('win')}`;
    winner.style.color = team1Data.team_color;
  } else if (t2score > t1score) {
    winner.textContent = `${team2Data.flag} ${getTeamName(team2Data)}${t('win')}`;
    winner.style.color = team2Data.team_color;
  } else {
    winner.textContent = t('draw');
    winner.style.color = '#aaa';
  }

  // GA4 カスタムイベント: 試合結果
  if (typeof gtag === 'function') {
    var _matchType = isWCFMode ? 'wc_final' : isWCSFMode ? 'wc_sf' : isWCQFMode ? 'wc_qf' : isWCR16Mode ? 'wc_r16' : isWCR32Mode ? 'wc_r32' : 'normal';
    var _result = t1score > t2score ? 'team1_win' : t2score > t1score ? 'team2_win' : 'draw';
    gtag('event', 'match_complete', {
      team1: team1Data.en_name || team1Data.name,
      team2: team2Data.en_name || team2Data.name,
      score: t1score + '-' + t2score,
      result: _result,
      match_type: _matchType
    });
  }
  // Firebase: WC試合結果書き込み
  // KOモード：引き分けはET/PKに続くため書き込まない（重複防止）
  // PK決着は _finishPK() 内で書き込む
  {
    const _isWCKO = isWCR32Mode || isWCR16Mode || isWCQFMode || isWCSFMode || isWCFMode;
    const _isWCGrp = isWorldCupMode && !_isWCKO;
    if (_isWCGrp) {
      const _wcRes = t1score > t2score ? 'win' : t2score > t1score ? 'loss' : 'draw';
      writeWCMatchResult('wc_group', _wcRes, team2Data.en_name || team2Data.name, 'regular');
    } else if (_isWCKO && t1score !== t2score) {
      // 引き分えでない場合のみ書き込む（90分決着 or 延長決着）
      const _wcMT = isWCFMode ? 'wc_final' : isWCSFMode ? 'wc_sf' : isWCQFMode ? 'wc_qf' : isWCR16Mode ? 'wc_r16' : isWCR32Mode ? 'wc_r32' : 'wc_group';
      const _wcRes = t1score > t2score ? 'win' : 'loss';
      const _rType = wcPhase === 'et_second' ? 'et' : 'regular';
      writeWCMatchResult(_wcMT, _wcRes, team2Data.en_name || team2Data.name, _rType);
    }
    // 引き分え（ET/PKへ）は ET後半 or _finishPK() で書き込む
  }

  // 延長終了時は 90分+ET1+ET2 を結合したソースを使う（ゴールスコアラー・デュエル・ログ・各スタッツ共通）
  const _isKOET2 = (isWCR32Mode || isWCR16Mode || isWCQFMode || isWCSFMode || isWCFMode) && wcPhase === 'et_second';
  const _logSrc = _isKOET2 ? wcMatchLog.concat(chanceResults) : chanceResults;

  // Stats（_logSrcから全チャンス集計 ← _recalcSecondHalfのカウンターリセット問題を回避）
  let _statT1chance=0,_statT2chance=0,_statT1shoot=0,_statT2shoot=0,_statT1gkSave=0,_statT2gkSave=0;
  _logSrc.forEach(function(res) {
    if (!res || !res.scenes) return;
    var _ch1=false, _ch2=false;
    res.scenes.forEach(function(sc) {
      const isShoot = ['ゴール！！','GK防いだ！','枠を外した！'].includes(sc.result);
      if (!isShoot && !['成功','失敗','ファール'].includes(sc.result)) return;
      // チャンス：1チャンスにつき1カウント（FW到達 or シュートシーンを起点に）
      if (isShoot || (sc.area && sc.area.substring(0,2)==='FW')) {
        if (sc.offence.name === team1Data.name && !_ch1) { _statT1chance++; _ch1=true; }
        if (sc.offence.name === team2Data.name && !_ch2) { _statT2chance++; _ch2=true; }
      }
      // シュート（ゴール/GK防/枠外）
      if (isShoot) {
        if (sc.offence.name === team1Data.name) _statT1shoot++;
        if (sc.offence.name === team2Data.name) _statT2shoot++;
      }
      // GKセーブ
      if (sc.result === 'GK防いだ！') {
        if (sc.defence.name === team1Data.name) _statT1gkSave++;
        if (sc.defence.name === team2Data.name) _statT2gkSave++;
      }
    });
  });
  const statsGrid = document.getElementById('stats-grid');
  const stats = [
    [_statT1chance, window.LANG==='en'?'Chances':'チャンス', _statT2chance],
    [_statT1shoot, window.LANG==='en'?'Shots':'シュート', _statT2shoot],
    [_statT1gkSave, window.LANG==='en'?'GK Saves':'GKセーブ', _statT2gkSave],
  ];

  statsGrid.innerHTML = '';
  stats.forEach(([l, label, r]) => {
    statsGrid.innerHTML += `
      <div style="padding:12px 16px;text-align:center;font-size:16px;font-weight:700;border-top:1px solid rgba(0,0,0,0.08)">${l}</div>
      <div style="padding:12px 8px;text-align:center;font-size:11px;color:var(--text-dim);display:flex;align-items:center;justify-content:center;border-top:1px solid rgba(0,0,0,0.08)">${label}</div>
      <div style="padding:12px 16px;text-align:center;font-size:16px;font-weight:700;border-top:1px solid rgba(0,0,0,0.08)">${r}</div>
    `;
  });

  // ゴールスコアラー（延長時は90分+ET全ゴールを表示）
  const scorersEl = document.getElementById('result-scorers');
  const goals = _logSrc.flatMap(res =>
    res.scenes
      .filter(s => s.result === 'ゴール！！')
      .map(s => ({ time: res.time, team: s.offence, pos: s.ofsPos }))
  );
  if (goals.length === 0) {
    scorersEl.innerHTML = '';
  } else {
    const byTeam = { [team1Data.name]: [], [team2Data.name]: [] };
    goals.forEach(({ time, team, pos }) => {
      const p = team.players[team.lineup[pos]];
      const name = p ? getPlayerName(p) : '?';
      const tname = team.name;
      if (byTeam[tname]) byTeam[tname].push(`${time}  ${name}`);
    });
    scorersEl.innerHTML = Object.entries(byTeam).map(([tname, list]) => {
      if (!list.length) return '';
      const tdata = tname === team1Data.name ? team1Data : team2Data;
      return list.map(g => `<div style="text-align:${tname === team1Data.name ? 'left' : 'right'};color:${tdata.team_color}">${g}</div>`).join('');
    }).join('');
  }

  // エリア別勝率は非同期で計算（ローディング表示を先出し）
  document.getElementById('area-win-content').innerHTML =
    '<div style="color:#888;font-size:12px;padding:8px 0">⚙️ ' + (window.LANG==='en' ? 'Calculating...' : '計算中...') + '</div>';


  // GKセーブ率・デュエル勝率は実データから集計
  const gkSave1 = {};
  const scenesAll1 = [];
  const _actualDuels1 = {}, _actualDuels2 = {};
  _logSrc.forEach(res => {
    if (!res || !res.scenes) return;
    res.scenes.forEach(sc => {
      const isShoot = ['ゴール！！','GK防いだ！','枠を外した！'].includes(sc.result);
      const isNormal = ['成功','失敗','ファール'].includes(sc.result);
      if (isNormal) {
        scenesAll1.push(sc);
        // デュエル集計（攻撃側）
        const _win = sc.result === '成功' || sc.result === 'ファール';
        const _ofsP = sc.offence.players[sc.offence.lineup[sc.ofsPos]];
        const _dfsP = sc.defence.players[sc.defence.lineup[sc.dfsPos]];
        const _ofsTgt = sc.offence.name === team1Data.name ? _actualDuels1 : sc.offence.name === team2Data.name ? _actualDuels2 : null;
        const _dfsTgt = sc.defence.name === team1Data.name ? _actualDuels1 : sc.defence.name === team2Data.name ? _actualDuels2 : null;
        if (_ofsP && _ofsTgt) {
          if (!_ofsTgt[_ofsP.name]) _ofsTgt[_ofsP.name] = { win: 0, lose: 0, enName: _ofsP.en_name };
          _win ? _ofsTgt[_ofsP.name].win++ : _ofsTgt[_ofsP.name].lose++;
        }
        if (_dfsP && _dfsTgt) {
          if (!_dfsTgt[_dfsP.name]) _dfsTgt[_dfsP.name] = { win: 0, lose: 0, enName: _dfsP.en_name };
          _win ? _dfsTgt[_dfsP.name].lose++ : _dfsTgt[_dfsP.name].win++;
        }
      }
      if (isShoot) {
        const gkP = sc.defence.players[sc.defence.lineup[0]];
        const gkName = gkP ? gkP.name : undefined;
        const gkKey = sc.defence.name + '_GK';
        if (!gkSave1[gkKey]) gkSave1[gkKey] = { name: gkName, enName: gkP ? gkP.en_name : undefined, team: sc.defence.name, color: sc.defence.team_color, save: 0, goal: 0 };
        sc.result === 'GK防いだ！' ? gkSave1[gkKey].save++ : gkSave1[gkKey].goal++;
      }
    });
  });
  _duelScenesCache = scenesAll1;

  // デュエルシーン未登場でも出場した全選手を0/0で補完
  if (gameState && gameState.team1) {
    for (let _pp = 1; _pp < 11; _pp++) {
      const _p = gameState.team1.players[gameState.team1.lineup[_pp]];
      if (_p && !_actualDuels1[_p.name]) _actualDuels1[_p.name] = { win: 0, lose: 0, enName: _p.en_name };
    }
  }
  if (typeof _subbedOff !== 'undefined') {
    _subbedOff.forEach(function(idx) {
      const _p = team1Data && team1Data.players[idx];
      if (_p && !_actualDuels1[_p.name]) _actualDuels1[_p.name] = { win: 0, lose: 0, enName: _p.en_name };
    });
  }
  if (gameState && gameState.team2) {
    for (let _pp = 1; _pp < 11; _pp++) {
      const _p = gameState.team2.players[gameState.team2.lineup[_pp]];
      if (_p && !_actualDuels2[_p.name]) _actualDuels2[_p.name] = { win: 0, lose: 0, enName: _p.en_name };
    }
  }

  // 試合終了時点のピッチ上の選手名セット（交代退場者の識別用）
  const _onPitch1 = new Set(), _onPitch2 = new Set();
  if (gameState) {
    for (let _pp = 1; _pp < 11; _pp++) {
      const _p1 = gameState.team1 && gameState.team1.players[gameState.team1.lineup[_pp]]; if (_p1) _onPitch1.add(_p1.name);
      const _p2 = gameState.team2 && gameState.team2.players[gameState.team2.lineup[_pp]]; if (_p2) _onPitch2.add(_p2.name);
    }
  }

  function _renderActualDuelTable(actualStats, onPitch, teamData) {
    const entries = Object.entries(actualStats).sort((a, b) => (b[1].win + b[1].lose) - (a[1].win + a[1].lose));
    if (!entries.length) return '';
    const isEn = window.LANG === 'en';
    const rows = entries.map(([name, st]) => {
      const total = st.win + st.lose;
      const rate = total > 0 ? Math.round(st.win / total * 100) : 0;
      const isOn = onPitch.has(name);
      const barColor = isOn ? (rate >= 60 ? '#003087' : rate >= 40 ? '#2d7a3a' : '#B8001F') : '#bbb';
      const dispName = (isEn && st.enName) ? st.enName : name;
      const subBadge = isOn ? '' : '<span style="font-size:9px;color:#bbb;margin-left:2px">↩</span>';
      return '<div style="display:flex;align-items:center;padding:6px 12px;border-bottom:1px solid #f0f0f0;gap:8px;opacity:' + (isOn ? '1' : '0.55') + '">'
        + '<div style="width:5em;font-size:12px;font-weight:700;overflow:hidden;white-space:nowrap">' + dispName + subBadge + '</div>'
        + '<div style="flex:1;background:#eee;border-radius:4px;height:8px;overflow:hidden"><div style="width:' + rate + '%;background:' + barColor + ';height:100%;border-radius:4px"></div></div>'
        + '<div style="width:3em;text-align:right;font-size:12px;font-weight:700;color:' + barColor + '">' + rate + '%</div>'
        + '<div style="width:5em;text-align:right;font-size:10px;color:#aaa">' + st.win + (isEn ? 'W ' : '勝') + st.lose + (isEn ? 'L' : '敗') + '</div>'
        + '</div>';
    }).join('');
    return '<div style="margin-bottom:16px">'
      + '<div style="background:' + teamData.team_color + ';color:white;font-size:12px;font-weight:700;padding:6px 12px;border-radius:8px 8px 0 0">' + teamData.flag + ' ' + getTeamName(teamData) + '</div>'
      + rows + '</div>';
  }

  const gkHtml1 = Object.values(gkSave1).map(gk => {
    const total = gk.save + gk.goal;
    const rate = total > 0 ? Math.round(gk.save / total * 100) : 0;
    const bc = rate >= 70 ? '#1a6bb5' : rate >= 50 ? '#2d7a3a' : '#c0392b';
    const dispName = (window.LANG === 'en' && gk.enName) ? gk.enName : gk.name;
    return '<div style="display:flex;align-items:center;padding:5px 10px;border-bottom:1px solid #f0f0f0;gap:8px">'
      + '<div style="width:5em;font-size:12px;font-weight:700">' + dispName + '</div>'
      + '<div style="flex:1;background:#eee;border-radius:4px;height:7px;overflow:hidden"><div style="width:' + rate + '%;background:' + bc + ';height:100%;border-radius:4px"></div></div>'
      + '<div style="width:3em;text-align:right;font-size:12px;font-weight:700;color:' + bc + '">' + rate + '%</div>'
      + '<div style="width:6em;text-align:right;font-size:10px;color:#aaa">' + gk.save + 'S/' + total + 'SH</div>'
      + '</div>';
  }).join('');

  // デュエル勝率（実データ）を即時描画
  const duelEl = document.getElementById('duel-stats-content');
  duelEl.innerHTML = _renderActualDuelTable(_actualDuels1, _onPitch1, team1Data)
    + _renderActualDuelTable(_actualDuels2, _onPitch2, team2Data)
    + '<div style="margin-top:12px"><div style="background:#555;color:white;font-size:12px;font-weight:700;padding:5px 10px;border-radius:8px 8px 0 0">🧤 ' + (window.LANG==='en'?'GK Save Rate':'GKセーブ率') + '</div>' + gkHtml1 + '</div>';

  // エリア別勝率（50回シミュレーション）を非同期計算
  setTimeout(function() {
    const _sd = _runDuelSimBothSides(50);
    buildFieldWithTabs(_sd.areaAtk, _sd.areaDef, 320, 170, 'area-win-content');
  }, 50);

  // 試合詳細ログ（延長後半時は90分+ET1+ET2を結合して表示）
  const logContent = document.getElementById('result-log-content');
  logContent.innerHTML = '';
  _logSrc.forEach(res => {
    const div = document.createElement('div');
    div.className = 'result-log-chance';
    const isGoal = res.scenes.some(s => s.result === 'ゴール！！');
    const timeDiv = document.createElement('div');
    timeDiv.className = 'result-log-time';
    timeDiv.textContent = res.time;
    const textDiv = document.createElement('div');
    textDiv.className = 'result-log-text';
    if (isGoal) textDiv.style.borderLeft = `3px solid var(--gold)`;
    textDiv.style.paddingLeft = isGoal ? '10px' : '0';
    textDiv.innerHTML = res.textScenes.join('<br>');
    div.appendChild(timeDiv);
    div.appendChild(textDiv);
    logContent.appendChild(div);
  });

  // ===== 追加スタッツ集計 =====

  // ① ポゼッション率
  (function() {
    let t1atk = 0, t2atk = 0;
    _logSrc.forEach(res => {
      res.scenes.forEach(s => {
        if (s.offence === gameState.team1) t1atk++;
        else t2atk++;
      });
    });
    const total = t1atk + t2atk || 1;
    const t1pct = Math.round(t1atk / total * 100);
    const t2pct = 100 - t1pct;
    const el = document.getElementById('possession-content');
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0">
        <div style="font-size:13px;font-weight:700;color:${team1Data.team_color};width:36px;text-align:right">${t1pct}%</div>
        <div style="flex:1;height:14px;border-radius:7px;overflow:hidden;background:rgba(0,0,0,0.08);display:flex">
          <div style="width:${t1pct}%;background:${team1Data.team_color};transition:width 0.5s"></div>
          <div style="width:${t2pct}%;background:${team2Data.team_color};transition:width 0.5s"></div>
        </div>
        <div style="font-size:13px;font-weight:700;color:${team2Data.team_color};width:36px">${t2pct}%</div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-dim);margin-top:2px">
        <span>${team1Data.flag} ${getTeamName(team1Data)}</span>
        <span>${team2Data.flag} ${getTeamName(team2Data)}</span>
      </div>`;
  })();

  // ② 選手別出場シーン数（上位5名ずつ）
  (function() {
    const counter = {};
    _logSrc.forEach(res => {
      res.scenes.forEach(s => {
        const teamKey = s.offence === gameState.team1 ? 't1' : 't2';
        const p = s.offence.players[s.offence.lineup[s.ofsPos]];
        if (p) {
          const key = teamKey + '_' + p.name;
          if (!counter[key]) counter[key] = { name: p.name, enName: p.en_name, team: s.offence, count: 0 };
          counter[key].count++;
        }
      });
    });
    const t1list = Object.values(counter).filter(v => v.team === gameState.team1).sort((a,b) => b.count - a.count).slice(0,5);
    const t2list = Object.values(counter).filter(v => v.team === gameState.team2).sort((a,b) => b.count - a.count).slice(0,5);
    const el = document.getElementById('mvp-content');
    const maxCount = Math.max(...[...t1list,...t2list].map(v=>v.count), 1);
    let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
    [['t1', t1list, team1Data], ['t2', t2list, team2Data]].forEach(([key, list, tdata]) => {
      html += `<div>`;
      list.forEach((v, i) => {
        const pct = Math.round(v.count / maxCount * 100);
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '　';
        const dispName = (window.LANG === 'en' && v.enName) ? v.enName : v.name;
        html += `<div style="margin-bottom:6px">
          <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;margin-bottom:2px">
            <span>${medal} <span style="color:${tdata.team_color}">${dispName}</span></span>
            <span style="color:var(--text-dim)">${v.count}${window.LANG==='en'?'x':'回'}</span>
          </div>
          <div style="height:6px;background:rgba(0,0,0,0.06);border-radius:3px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${tdata.team_color};border-radius:3px"></div>
          </div>
        </div>`;
      });
      html += '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  })();

  // ③ 攻撃パターン別ゴール
  (function() {
    const patterns = {};
    chanceResults.forEach(res => {
      res.scenes.forEach(s => {
        if (s.result === 'ゴール！！') {
          const teamName = s.offence === gameState.team1 ? getTeamName(team1Data) : getTeamName(team2Data);
          const tcolor = s.offence === gameState.team1 ? team1Data.team_color : team2Data.team_color;
          const pat = s.action || s.scenario || (window.LANG==='en'?'Unknown':'不明');
          const k = teamName + '|' + pat;
          if (!patterns[k]) patterns[k] = { label: pat, teamName, tcolor, count: 0 };
          patterns[k].count++;
        }
      });
    });
    const list = Object.values(patterns).sort((a,b) => b.count - a.count);
    const el = document.getElementById('goal-pattern-content');
    if (list.length === 0) {
      el.innerHTML = `<div style="font-size:11px;color:var(--text-dim);padding:4px 0">${window.LANG==='en'?'No goals':'得点なし'}</div>`;
      return;
    }
    el.innerHTML = list.map(v =>
      `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px">
        <span style="color:${v.tcolor};font-weight:700;min-width:60px">${v.teamName}</span>
        <span style="flex:1">${v.label}</span>
        <span style="font-weight:700">⚽×${v.count}</span>
      </div>`
    ).join('');
  })();

  showScreen('result');

  // 結果画像をセット
  const _lastR = chanceResults[chanceResults.length - 1];
  if (_lastR) setResultImage(_lastR.t1score, _lastR.t2score);

  const normalVisible = !isWorldCupMode;
  document.getElementById('btn-retry').style.display = normalVisible ? '' : 'none';
  document.getElementById('btn-home').style.display  = normalVisible ? '' : 'none';
  // シングルマッチ時はWCボタンを必ず非表示（前回WC試合の状態が残らないよう）
  if (normalVisible) {
    const _wcBackBtn = document.getElementById('wc-result-back-btn');
    if (_wcBackBtn) _wcBackBtn.style.display = 'none';
  }

  if (isWCR32Mode || isWCR16Mode || isWCQFMode || isWCSFMode || isWCFMode) {
    if (wcPhase === 'et_first' || wcPhase === 'et_second') {
      updateWCETAfterResult();
    } else {
      if (isWCFMode) updateWCFAfterResult();
      else if (isWCSFMode) updateWCSFAfterResult();
      else if (isWCQFMode) updateWCQFAfterResult();
      else if (isWCR16Mode) updateWCR16AfterResult();
      else updateWCR32AfterResult();
    }
  } else if (isWorldCupMode) {
    updateWCAfterResult();
  }
}

// ============================================================
// W杯グループステージ ロジック
// ============================================================

function startWCMatch(idx) {
  isWorldCupMode = true;
  const keys = ['2026vsオランダ', '2026vsチュニジア', '2026vsスウェーデン'];
  selectMatch(keys[idx]);
  _settingBackScreen = 'worldcup';
}

// サイレントシミュレーション（UIなしで1試合演算）
function simulateSilent(t1data, t2data) {
  const buildState = (data) => {
    const sysIdx = system_data.findIndex(s => s.name === data.default_system);
    return {
      systemIdx: sysIdx >= 0 ? sysIdx : 0,
      tactics: data.default_tactics,
      keyplayer: data.default_keyplayer,
      marked_player: data.default_marked_player !== undefined ? data.default_marked_player : -1,
      lineup: [...data.default_lineup.slice(0, 11)]
    };
  };
  const t1 = buildTeam(t1data, buildState(t1data));
  const t2 = buildTeam(t2data, buildState(t2data));
  [t1, t2].forEach(t => {
    t.score = 0; t.chanceCounter = 0; t.shootCounter = 0; t.gkSaveCounter = 0;
    t.players.forEach(p => { p.chance_counter = 0; p.fatigue = 0; });
  });
  const gs = { team1: t1, team2: t2 };
  const silentResults = [];
  for (let i = 0; i < 16; i++) silentResults.push(simulateChance(gs, i));
  if (Math.random() < 0.5) silentResults.push(simulateChance(gs, 16));

  // 詳細データ集計（t1・t2視点）
  const silentGoalScorers = [];
  const silentPlayerStats = {};
  const silentT2PlayerStats = {};
  const silentAreaAtk = {};
  const silentAreaDef = {};

  silentResults.forEach(res => {
    res.scenes.forEach(sc => {
      const isGoal  = sc.result === 'ゴール！！';
      const isNormal = ['成功','失敗','ファール'].includes(sc.result);
      const isShoot  = ['ゴール！！','GK防いだ！','枠を外した！'].includes(sc.result);
      if (!isNormal && !isShoot) return;

      // t1攻撃シーン
      if (sc.offence === t1) {
        const p = sc.offence.players[sc.offence.lineup[sc.ofsPos]];
        if (p) {
          if (!silentPlayerStats[p.name]) silentPlayerStats[p.name] = {goals:0, duels:0, duelWins:0, enName:p.en_name};
          silentPlayerStats[p.name].duels++;
          if (isGoal || sc.result === '成功' || sc.result === 'ファール') silentPlayerStats[p.name].duelWins++;
          if (isGoal) { silentPlayerStats[p.name].goals++; silentGoalScorers.push({time: res.time, name: p.name, teamName: t1data.name, teamFlag: t1data.flag}); }
        }
        const win = isShoot ? isGoal : sc.result === '成功' || sc.result === 'ファール';
        const atkArea = (['FW_L','CR_L'].includes(sc.area)) ? 'GOAL_L'
                      : (['FW_M','CR_M','SHOOT_M'].includes(sc.area)) ? 'GOAL_M'
                      : (['FW_R','CR_R'].includes(sc.area)) ? 'GOAL_R' : sc.area;
        if (!silentAreaAtk[atkArea]) silentAreaAtk[atkArea] = {win:0, lose:0};
        win ? silentAreaAtk[atkArea].win++ : silentAreaAtk[atkArea].lose++;
      }
      // t2攻撃シーン
      if (sc.offence === t2) {
        const p2 = sc.offence.players[sc.offence.lineup[sc.ofsPos]];
        if (p2) {
          if (!silentT2PlayerStats[p2.name]) silentT2PlayerStats[p2.name] = {goals:0, duels:0, duelWins:0, enName:p2.en_name};
          silentT2PlayerStats[p2.name].duels++;
          if (isGoal || sc.result === '成功' || sc.result === 'ファール') silentT2PlayerStats[p2.name].duelWins++;
          if (isGoal) { silentT2PlayerStats[p2.name].goals++; silentGoalScorers.push({time: res.time, name: p2.name, teamName: t2data.name, teamFlag: t2data.flag}); }
        }
      }
      // t1守備シーン
      if (sc.defence === t1) {
        const win = isShoot ? isGoal : sc.result === '成功' || sc.result === 'ファール';
        const aFlip = {'DF':'FW','FW':'DF','MF':'MF','CR':'CR','SHOOT':'CR'};
        const rawArea2 = sc.area === 'SHOOT_M' ? 'CR_M' : sc.area;
        const pos2 = rawArea2.substring(0, rawArea2.indexOf('_'));
        const side2 = rawArea2.substring(rawArea2.indexOf('_')+1);
        const flipArea = (aFlip[pos2]||pos2) + '_' + (side2==='L'?'R':side2==='R'?'L':side2);
        const defKey = (['FW_L','CR_L'].includes(flipArea)) ? 'GOAL_L'
                     : (['FW_M','CR_M','SHOOT_M','CR_CENTER'].includes(flipArea)) ? 'GOAL_M'
                     : (['FW_R','CR_R'].includes(flipArea)) ? 'GOAL_R' : flipArea;
        if (!silentAreaDef[defKey]) silentAreaDef[defKey] = {win:0, lose:0};
        win ? silentAreaDef[defKey].lose++ : silentAreaDef[defKey].win++;
      }
    });
  });

  return {
    t1score: t1.score, t2score: t2.score, t1data, t2data,
    totalStats: {
      t1: { chances: t1.chanceCounter, shots: t1.shootCounter, gkSaves: t2.gkSaveCounter },
      t2: { chances: t2.chanceCounter, shots: t2.shootCounter, gkSaves: t1.gkSaveCounter }
    },
    goalScorers: silentGoalScorers,
    playerStats: silentPlayerStats,
    t2playerStats: silentT2PlayerStats,
    t1areaAtk: silentAreaAtk,
    t1areaDef: silentAreaDef
  };
}

function applyWCResult(name, gf, ga) {
  const s = wcStandings[name];
  if (!s) return;
  s.p++;
  s.gf += gf;
  s.ga += ga;
  s.gd = s.gf - s.ga;
  if (gf > ga)       { s.w++; s.pts += 3; }
  else if (gf === ga) { s.d++; s.pts += 1; }
  else                { s.l++; }
}

// 第N節の自動演算カード定義（日本戦インデックスに対応）
const WC_AUTO_MATCHES = [
  [TEAM_DATA.tunisia2026,   TEAM_DATA.sweden2026],      // 第1節後：チュニジア vs スウェーデン
  [TEAM_DATA.netherlands2026, TEAM_DATA.sweden2026],    // 第2節後：オランダ vs スウェーデン
  [TEAM_DATA.netherlands2026, TEAM_DATA.tunisia2026],   // 第3節後：オランダ vs チュニジア
];

function updateWCAfterResult() {
  const t1 = parseInt(document.getElementById('result-score1').textContent);
  const t2 = parseInt(document.getElementById('result-score2').textContent);
  const name1 = team1Data.name;
  const name2 = team2Data.name;

  // 日本戦スコアを保存
  wcMatchScores.push({
    matchNum: wcMatchIndex + 1,
    t1flag: team1Data.flag, t1name: name1, s1: t1,
    t2flag: team2Data.flag, t2name: name2, s2: t2
  });

  // 合計スタッツ蓄積
  if (gameState && gameState.team1) {
    wcTotalStats.chances    += gameState.team1.chanceCounter  || 0;
    wcTotalStats.shots      += gameState.team1.shootCounter   || 0;
    wcTotalStats.gkSaves    += gameState.team2.gkSaveCounter  || 0;
    wcTotalStats.oppChances += gameState.team2.chanceCounter  || 0;
    wcTotalStats.oppShots   += gameState.team2.shootCounter   || 0;
    wcTotalStats.oppGkSaves += gameState.team1.gkSaveCounter  || 0;
  }

  // 日本選手スタッツ・得点者・エリアマップ蓄積
  const matchNum = wcMatchIndex + 1;
  chanceResults.forEach(res => {
    res.scenes.forEach(sc => {
      const isGoal   = sc.result === 'ゴール！！';
      const isNormal = ['成功','失敗','ファール'].includes(sc.result);
      const isShoot  = ['ゴール！！','GK防いだ！','枠を外した！'].includes(sc.result);
      if (!isNormal && !isShoot) return;

      // 日本攻撃シーン
      if (sc.offence.name === name1) {
        const p = sc.offence.players[sc.offence.lineup[sc.ofsPos]];
        if (p) {
          if (!wcPlayerStats[p.name]) wcPlayerStats[p.name] = {goals:0, assists:0, duels:0, duelWins:0, enName:p.en_name};
          wcPlayerStats[p.name].duels++;
          if (isGoal || sc.result === '成功' || sc.result === 'ファール') wcPlayerStats[p.name].duelWins++;
          if (isGoal) {
            wcPlayerStats[p.name].goals++;
            wcGoalScorers.push({time: res.time, name: p.name, matchNum});
            // アシスト集計（クロス・セットプレー）
            if (sc.crossPos !== undefined && sc.crossPos !== sc.ofsPos) {
              const ap = sc.offence.players[sc.offence.lineup[sc.crossPos]];
              if (ap) {
                if (!wcPlayerStats[ap.name]) wcPlayerStats[ap.name] = {goals:0, assists:0, duels:0, duelWins:0, enName:ap.en_name};
                wcPlayerStats[ap.name].assists++;
              }
            }
          }
        }
        // エリア攻撃マップ
        const win = isShoot ? isGoal : sc.result === '成功' || sc.result === 'ファール';
        const atkArea = (['FW_L','CR_L'].includes(sc.area)) ? 'GOAL_L'
                      : (['FW_M','CR_M','SHOOT_M'].includes(sc.area)) ? 'GOAL_M'
                      : (['FW_R','CR_R'].includes(sc.area)) ? 'GOAL_R' : sc.area;
        if (!wcAreaAtk[atkArea]) wcAreaAtk[atkArea] = {win:0, lose:0};
        win ? wcAreaAtk[atkArea].win++ : wcAreaAtk[atkArea].lose++;
      }

      // 対戦相手攻撃シーン（デュエル集計）
      if (sc.offence.name === name2) {
        const p = sc.offence.players[sc.offence.lineup[sc.ofsPos]];
        if (p) {
          if (!wcOppPlayerStats[p.name]) wcOppPlayerStats[p.name] = {goals:0, duels:0, duelWins:0, enName:p.en_name, teamName: name2, teamFlag: team2Data.flag};
          wcOppPlayerStats[p.name].duels++;
          if (isGoal || sc.result === '成功' || sc.result === 'ファール') wcOppPlayerStats[p.name].duelWins++;
          if (isGoal) wcOppPlayerStats[p.name].goals++;
        }
      }

      // 日本守備シーン（エリア守備マップ）
      if (sc.defence.name === name1) {
        const win = isShoot ? isGoal : sc.result === '成功' || sc.result === 'ファール';
        const aFlip = {'DF':'FW','FW':'DF','MF':'MF','CR':'CR','SHOOT':'CR'};
        const rawArea = sc.area === 'SHOOT_M' ? 'CR_M' : sc.area;
        const pos2 = rawArea.substring(0, rawArea.indexOf('_'));
        const side2 = rawArea.substring(rawArea.indexOf('_')+1);
        const flipArea = (aFlip[pos2]||pos2) + '_' + (side2==='L'?'R':side2==='R'?'L':side2);
        const defKey = (['FW_L','CR_L'].includes(flipArea)) ? 'GOAL_L'
                     : (['FW_M','CR_M','SHOOT_M','CR_CENTER'].includes(flipArea)) ? 'GOAL_M'
                     : (['FW_R','CR_R'].includes(flipArea)) ? 'GOAL_R' : flipArea;
        if (!wcAreaDef[defKey]) wcAreaDef[defKey] = {win:0, lose:0};
        win ? wcAreaDef[defKey].lose++ : wcAreaDef[defKey].win++;
      }
    });
  });

  applyWCResult(name1, t1, t2);
  applyWCResult(name2, t2, t1);

  // 自動演算（同節の他試合）
  const autoMatch = WC_AUTO_MATCHES[wcMatchIndex];
  const auto = simulateSilent(autoMatch[0], autoMatch[1]);
  applyWCResult(auto.t1data.name, auto.t1score, auto.t2score);
  applyWCResult(auto.t2data.name, auto.t2score, auto.t1score);

  // 自動演算スコアを保存＆表示エリアに追記（詳細データも蓄積）
  wcAutoScores.push({
    t1flag: auto.t1data.flag, t1name: auto.t1data.name, t1score: auto.t1score,
    t2flag: auto.t2data.flag, t2name: auto.t2data.name, t2score: auto.t2score,
    totalStats: auto.totalStats,
    goalScorers: auto.goalScorers,
    playerStats: auto.playerStats,
    t2playerStats: auto.t2playerStats,
    t1areaAtk: auto.t1areaAtk,
    t1areaDef: auto.t1areaDef
  });
  const el = document.getElementById('wc-auto-results');
  if (el) {
    const line = `${auto.t1data.flag} ${getTeamName(auto.t1data)} ${auto.t1score}–${auto.t2score} ${getTeamName(auto.t2data)} ${auto.t2data.flag} ${t('wcAutoSimulated')}`;
    el.innerHTML += (el.innerHTML ? '<br>' : '') + line;
    el.style.display = '';
  }

  wcMatchIndex++;
  renderWCTable();
  // グループ戦では延長/PKボタンを必ず非表示
  const _wcGrpEtBtn = document.getElementById('wc-et-btn');
  if (_wcGrpEtBtn) _wcGrpEtBtn.style.display = 'none';
  const _backBtn = document.getElementById('wc-result-back-btn');
  if (_backBtn) {
    _backBtn.textContent = window.LANG === 'en' ? '🏆 Back to Group' : '🏆 グループへ';
    _backBtn.style.background = 'linear-gradient(135deg,#003087,#0050cc)';
    _backBtn.style.color = '#ffffff';
    _backBtn.onclick = () => backToWCScreen();
    _backBtn.style.display = '';
  }
}

function backToWCScreen() {
  document.getElementById('wc-result-back-btn').style.display = 'none';

  // 終了済み試合のスコアを記録
  const s1 = parseInt(document.getElementById('result-score1').textContent);
  const s2 = parseInt(document.getElementById('result-score2').textContent);
  const el = document.getElementById('wc-done-matches');
  if (el) {
    const row = document.createElement('div');
    row.style.cssText = 'padding:8px 14px;background:rgba(0,0,0,0.45);color:#ffffff;font-size:13px;font-weight:700;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1)';
    const doneMatchLbl = window.LANG === 'en' ? `Match ${wcMatchIndex}` : `第${wcMatchIndex}戦`;
    row.innerHTML = `<span>🏁 ${doneMatchLbl}</span><span>${team1Data.flag} ${getTeamName(team1Data)} ${s1}–${s2} ${team2Data.flag} ${getTeamName(team2Data)}</span>`;
    el.appendChild(row);
    el.style.display = '';
  }

  updateWCNextBtn();
  showScreen('worldcup');
}

function updateWCNextBtn() {
  const btn = document.getElementById('wc-btn-next');
  if (!btn) return;
  const labels = [t('wcNextNed'), t('wcNextTun'), t('wcNextSwe')];
  if (wcMatchIndex < 3) {
    btn.textContent = labels[wcMatchIndex];
    btn.onclick = () => onWCNextBtn();
    btn.style.background = '';
    btn.style.color = '#ffffff';
  } else {
    btn.textContent = t('wcBtnFinal');
    btn.onclick = () => showWCResult();
    btn.style.background = 'linear-gradient(135deg,#b8860b,#ffd700)';
    btn.style.color = '#1a1a1a';
  }
}

function onWCNextBtn() {
  if (wcMatchIndex < 3) startWCMatch(wcMatchIndex);
}

function showWCResult() {
  // 全WCチーム選手の name→en_name マップ
  const wcPlayerEnNames = {};
  [
    TEAM_DATA.japan2026vsNetherlands, TEAM_DATA.japan2026vsTunisia, TEAM_DATA.japan2026vsSweden,
    TEAM_DATA.netherlands2026, TEAM_DATA.tunisia2026, TEAM_DATA.sweden2026
  ].forEach(td => {
    if (td && td.players) td.players.forEach(p => { if (p.en_name) wcPlayerEnNames[p.name] = p.en_name; });
  });
  const getWCPlayerName = (name) => window.LANG === 'en' ? (wcPlayerEnNames[name] || name) : name;

  const names = ['日本','オランダ','チュニジア','スウェーデン'];
  const sorted = names.slice().sort((a,b) => {
    const sa=wcStandings[a], sb=wcStandings[b];
    if (sb.pts!==sa.pts) return sb.pts-sa.pts;
    if (sb.gd !==sa.gd)  return sb.gd -sa.gd;
    return sb.gf-sa.gf;
  });
  const japanRank = sorted.indexOf('日本') + 1;
  wcGroupRank = japanRank;
  const advanced  = japanRank <= 2;
  const rankLabel = t('wcRankLabels')[japanRank-1];
  const medals    = ['🥇','🥈','🥉','4️⃣'];

  let html = '';

  // 突破/敗退
  html += `<div style="text-align:center;padding:20px 0 16px">
    <div style="font-size:26px;font-weight:700;color:#fff">${advanced ? t('wcAdvanced') : t('wcEliminated')}</div>
    <div style="font-size:15px;color:${advanced?'#ffd700':'rgba(255,255,255,0.6)'};margin-top:4px">${rankLabel}${advanced ? t('wcRankAdvanced') : t('wcRankEliminated')}</div>
  </div>`;

  // 最終順位表
  html += `<div style="background:rgba(0,0,0,0.45);border-radius:12px;padding:8px 4px;margin-bottom:16px">
    <div style="text-align:center;font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:2px;padding:4px 0 8px">${t('wcFinalStandings')}</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;color:#fff">
      <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.5)">
        <th style="padding:4px 6px">#</th><th style="text-align:left;padding:4px 4px">${t('wcColTeam')}</th>
        <th style="padding:4px 5px">${t('wcColPts2')}</th><th style="padding:4px 5px">${t('wcColW2')}</th><th style="padding:4px 5px">${t('wcColD2')}</th>
        <th style="padding:4px 5px">${t('wcColL2')}</th><th style="padding:4px 5px">${t('wcColGF')}</th><th style="padding:4px 5px">${t('wcColGA')}</th><th style="padding:4px 5px">${t('wcColGD')}</th>
      </tr></thead><tbody>`;
  sorted.forEach((name,i) => {
    const s=wcStandings[name];
    const bg = name==='日本' ? 'background:rgba(255,255,255,0.12)' : '';
    html += `<tr style="${bg}">
      <td style="text-align:center;padding:7px 6px">${medals[i]}</td>
      <td style="padding:7px 4px">${s.flag} ${getWCTeamName(name)}</td>
      <td style="text-align:center;padding:7px 5px;color:#ffd700;font-weight:700">${s.pts}</td>
      <td style="text-align:center;padding:7px 5px">${s.w}</td><td style="text-align:center;padding:7px 5px">${s.d}</td>
      <td style="text-align:center;padding:7px 5px">${s.l}</td><td style="text-align:center;padding:7px 5px">${s.gf}</td>
      <td style="text-align:center;padding:7px 5px">${s.ga}</td><td style="text-align:center;padding:7px 5px">${s.gd}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;

  // 日本戦スコア
  if (wcMatchScores.length > 0) {
    html += `<div style="background:rgba(0,0,0,0.35);border-radius:10px;overflow:hidden;margin-bottom:12px">
      <div style="padding:8px 12px;font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1px;border-bottom:1px solid rgba(255,255,255,0.08)">${t('wcJapanResults')}</div>`;
    wcMatchScores.forEach(m => {
      const matchLbl = window.LANG === 'en' ? `Match ${m.matchNum}` : `第${m.matchNum}戦`;
      html += `<div style="padding:8px 14px;color:#fff;font-size:13px;font-weight:700;display:flex;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.07)">
        <span>${matchLbl}</span><span>${m.t1flag} ${getWCTeamName(m.t1name)} ${m.s1}–${m.s2} ${m.t2flag} ${getWCTeamName(m.t2name)}</span></div>`;
    });
    html += `</div>`;
  }

  // 自動演算スコア
  if (wcAutoScores.length > 0) {
    html += `<div style="background:rgba(0,0,0,0.25);border-radius:10px;overflow:hidden;margin-bottom:16px">
      <div style="padding:8px 12px;font-size:11px;color:rgba(255,255,255,0.45);letter-spacing:1px;border-bottom:1px solid rgba(255,255,255,0.07)">${t('wcAutoResults')}</div>`;
    wcAutoScores.forEach((m,i) => {
      const roundLbl = window.LANG === 'en' ? `Round ${i+1}` : `第${i+1}節`;
      html += `<div style="padding:7px 14px;color:rgba(255,255,255,0.7);font-size:12px;display:flex;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.05)">
        <span>${roundLbl}</span><span>${m.t1flag} ${getWCTeamName(m.t1name)} ${m.t1score}–${m.t2score} ${m.t2flag} ${getWCTeamName(m.t2name)}</span></div>`;
    });
    html += `</div>`;
  }

  // 全チームプレイヤースタッツ集計（MVP・デュエルランキング用）
  const allPlayerStats = {};
  const _addToStats = (name, st, teamName, teamFlag) => {
    if (!allPlayerStats[name]) allPlayerStats[name] = {goals:0, duels:0, duelWins:0, teamName, teamFlag};
    allPlayerStats[name].goals    += st.goals    || 0;
    allPlayerStats[name].duels    += st.duels    || 0;
    allPlayerStats[name].duelWins += st.duelWins || 0;
  };
  Object.entries(wcPlayerStats).forEach(([n,st]) => _addToStats(n, st, '日本', '🇯🇵'));
  Object.entries(wcOppPlayerStats).forEach(([n,st]) => _addToStats(n, st, st.teamName, st.teamFlag));
  wcAutoScores.forEach(m => {
    if (m.playerStats)   Object.entries(m.playerStats).forEach(([n,st])   => _addToStats(n, st, m.t1name, m.t1flag));
    if (m.t2playerStats) Object.entries(m.t2playerStats).forEach(([n,st]) => _addToStats(n, st, m.t2name, m.t2flag));
  });

  // MVP（全チーム対象）
  const _allEntries = Object.entries(allPlayerStats);
  if (_allEntries.length > 0) {
    const [mvpName, mvpSt] = _allEntries.sort((a,b) =>
      (b[1].goals*3 + b[1].duelWins) - (a[1].goals*3 + a[1].duelWins)
    )[0];
    const mvpStatsText = window.LANG === 'en'
      ? `${mvpSt.goals} ${t('wcMvpStats')}${mvpSt.duelWins}${t('wcMvpStatsSuffix')}`
      : `${mvpSt.goals}${t('wcMvpStats')}${mvpSt.duelWins}${t('wcMvpStatsSuffix')}`;
    html += `<div style="background:rgba(184,134,11,0.3);border:1px solid rgba(255,215,0,0.4);border-radius:10px;padding:14px;margin-bottom:8px;text-align:center">
      <div style="font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1px;margin-bottom:6px">${t('wcMvpLabel')}</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.6);margin-bottom:4px">${mvpSt.teamFlag} ${getWCTeamName(mvpSt.teamName)}</div>
      <div style="font-size:22px;font-weight:700;color:#ffd700">${getWCPlayerName(mvpName)}</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:4px">${mvpStatsText}</div>
    </div>`;
  }

  // グループ全得点者一覧
  const allScorers = [];
  wcGoalScorers.forEach(g => {
    allScorers.push({time: g.time, name: g.name, teamFlag: '🇯🇵', teamName: '日本'});
  });
  wcAutoScores.forEach((m, i) => {
    if (m.goalScorers) {
      m.goalScorers.forEach(g => {
        allScorers.push({time: g.time, name: g.name, teamFlag: g.teamFlag || m.t1flag, teamName: g.teamName || m.t1name});
      });
    }
  });
  // 日本戦での相手得点を追加（wcOppPlayerStats から）
  Object.entries(wcOppPlayerStats).forEach(([name, st]) => {
    for (let i = 0; i < st.goals; i++) {
      allScorers.push({time: '-', name: name, teamFlag: st.teamFlag, teamName: st.teamName});
    }
  });
  // 得点者を選手単位に集約
  const scorerMap = {};
  allScorers.forEach(g => {
    const key = g.name;
    if (!scorerMap[key]) scorerMap[key] = {name: g.name, teamFlag: g.teamFlag, goals: 0};
    scorerMap[key].goals++;
  });
  const scorerList = Object.values(scorerMap).sort((a,b) => b.goals - a.goals);
  if (scorerList.length > 0) {
    html += `<div style="background:rgba(0,0,0,0.35);border-radius:10px;overflow:hidden;margin-bottom:12px">
      <div style="padding:8px 12px;font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1px;border-bottom:1px solid rgba(255,255,255,0.08)">${t('wcAllScorers')}</div>`;
    scorerList.forEach(g => {
      html += `<div style="padding:7px 14px;color:#fff;font-size:13px;display:flex;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.06)">
        <span>${getWCPlayerName(g.name)} ${g.teamFlag}</span><span style="color:rgba(255,255,255,0.7);font-size:13px;font-weight:700">${g.goals} ${t('wcGoalUnit')}</span></div>`;
    });
    html += `</div>`;
  } else {
    html += `<div style="background:rgba(0,0,0,0.2);border-radius:10px;padding:10px 14px;margin-bottom:12px;color:rgba(255,255,255,0.45);font-size:13px;text-align:center">${t('wcNoGoal')}</div>`;
  }

  // デュエル勝率ランキング（全チーム・上位5名、3回未満除外）
  const duelRanking = Object.entries(allPlayerStats)
    .filter(([,st]) => st.duels >= 3)
    .map(([name, st]) => [name, st, st.duels > 0 ? st.duelWins / st.duels : 0])
    .sort((a,b) => b[2] - a[2])
    .slice(0, 5);
  if (duelRanking.length > 0) {
    html += `<div style="background:rgba(0,0,0,0.35);border-radius:10px;overflow:hidden;margin-bottom:16px">
      <div style="padding:8px 12px;font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1px;border-bottom:1px solid rgba(255,255,255,0.08)">${t('wcDuelRanking')}</div>`;
    duelRanking.forEach(([name, st, rate]) => {
      const pct = Math.round(rate * 100);
      const rateLabel = window.LANG === 'en' ? `${pct}% Win Rate` : `${t('wcDuelRateLabel')}${pct}%`;
      html += `<div style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06)">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="color:#fff;font-size:13px;font-weight:700">${getWCPlayerName(name)} <span style="font-size:11px;color:rgba(255,255,255,0.45);font-weight:400">${st.teamFlag} ${getWCTeamName(st.teamName)}</span></span>
          <span style="color:rgba(255,255,255,0.7);font-size:13px;font-weight:700">${rateLabel}</span>
        </div>
        <div style="background:rgba(255,255,255,0.15);border-radius:4px;height:6px">
          <div style="width:${pct}%;height:100%;background:#4a9eff;border-radius:4px"></div>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  // AI総括
  html += `<div style="background:rgba(0,0,0,0.35);border-radius:10px;overflow:hidden;margin-bottom:16px">
    <div style="padding:8px 12px;font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between">
      <span>${t('wcAiSummary')}</span>
      <button id="wc-summary-btn" onclick="generateWCSummary()" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.1);color:#fff;cursor:pointer;font-family:inherit;font-weight:700">${t('wcAiGenBtn')}</button>
    </div>
    <div id="wc-summary-content" style="padding:12px;font-size:13px;line-height:1.9;color:rgba(255,255,255,0.85)">
      <span style="color:rgba(255,255,255,0.35);font-size:12px">${t('wcAiPlaceholder')}</span>
    </div>
  </div>`;

  document.getElementById('wc-result-content').innerHTML = html;

  const tourBtn = document.getElementById('wc-btn-tournament');
  if (tourBtn) {
    tourBtn.style.display = advanced ? '' : 'none';
    tourBtn.onclick = () => showWCR32(japanRank);
  }

  const replayBtn = document.getElementById('wc-btn-replay');
  if (replayBtn) replayBtn.style.display = advanced ? 'none' : '';

  showScreen('worldcup-result');
}

// ===== W杯グループステージ AI総括 =====
function generateWCSummary() {
  var btn = document.getElementById('wc-summary-btn');
  var el  = document.getElementById('wc-summary-content');
  btn.disabled = true;
  btn.textContent = t('wcGenerating');
  btn.style.opacity = '0.6';
  el.innerHTML = '<span style="color:rgba(255,255,255,0.4);font-size:12px">' + t('wcGenerating') + '</span>';

  // 最終順位テキスト
  var names = ['日本','オランダ','チュニジア','スウェーデン'];
  var sorted = names.slice().sort(function(a,b) {
    var sa = wcStandings[a], sb = wcStandings[b];
    if (sb.pts !== sa.pts) return sb.pts - sa.pts;
    if (sb.gd  !== sa.gd)  return sb.gd  - sa.gd;
    return sb.gf - sa.gf;
  });
  var standingsText = sorted.map(function(n, i) {
    var s = wcStandings[n];
    return (i+1) + '位 ' + n + '(' + s.pts + 'pt ' + s.w + '勝' + s.d + '分' + s.l + '敗 ' + s.gf + '得' + s.ga + '失)';
  }).join(' / ');

  // 日本戦スコア
  var japanScoresText = wcMatchScores.map(function(m) {
    return m.t1name + ' ' + m.s1 + '-' + m.s2 + ' ' + m.t2name;
  }).join(' / ');

  // 自動演算スコア
  var autoScoresText = wcAutoScores.map(function(m) {
    return m.t1name + ' ' + m.t1score + '-' + m.t2score + ' ' + m.t2name;
  }).join(' / ');

  // 日本結果
  var japanRank = sorted.indexOf('日本') + 1;
  var japanResult = japanRank <= 2 ? japanRank + '位通過' : japanRank + '位（敗退）';

  // MVP再計算（全チーム）
  var apStats = {};
  var _addP = function(n, st, tName) {
    if (!apStats[n]) apStats[n] = {goals:0, duelWins:0, teamName:tName};
    apStats[n].goals    += st.goals    || 0;
    apStats[n].duelWins += st.duelWins || 0;
  };
  Object.entries(wcPlayerStats).forEach(function(kv) { _addP(kv[0], kv[1], '日本'); });
  wcAutoScores.forEach(function(m) {
    if (m.playerStats) Object.entries(m.playerStats).forEach(function(kv) { _addP(kv[0], kv[1], m.t1name); });
  });
  var mvpEntry = Object.entries(apStats).sort(function(a,b) {
    return (b[1].goals*3 + b[1].duelWins) - (a[1].goals*3 + a[1].duelWins);
  })[0];
  var mvpText = mvpEntry ? mvpEntry[0] + '(' + mvpEntry[1].teamName + ' ' + mvpEntry[1].goals + 'ゴール/デュエル勝利' + mvpEntry[1].duelWins + '回)' : '-';

  // 全得点者テキスト
  var scorerLines = [];
  wcGoalScorers.forEach(function(g) { scorerLines.push('🇯🇵' + g.name + '(' + g.time + ')'); });
  wcAutoScores.forEach(function(m) {
    if (m.goalScorers) m.goalScorers.forEach(function(g) {
      scorerLines.push((g.teamFlag||'') + g.name + '(' + g.time + ')');
    });
  });
  var allScorersText = scorerLines.join(', ') || 'なし';

  var matchData = {
    isWorldCup:  true,
    standings:   standingsText,
    japanResult: japanResult,
    japanScores: japanScoresText,
    autoScores:  autoScoresText,
    allScorers:  allScorersText,
    mvp:         mvpText,
    // 既存Workerフィールドへのフォールバック
    team1:   '日本',
    team2:   'グループC',
    score1:  wcStandings['日本'] ? wcStandings['日本'].gf : 0,
    score2:  wcStandings['日本'] ? wcStandings['日本'].ga : 0,
    goals:   allScorersText,
    mvp1:    mvpEntry ? mvpEntry[0] : '-',
    mvp2:    '-',
    topPattern: '',
  };

  var WORKER_URL = 'https://footballsimulator.m-iwasaki18.workers.dev';

  fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchData: matchData, lang: window.LANG }),
  }).then(function(res) {
    if (res.status === 429) {
      el.innerHTML = '<span style="color:#e67e00;font-size:12px;line-height:1.7">' + t('wcRateLimitMsg') + '</span>';
      btn.textContent = t('wcRateLimit429');
      btn.disabled = true;
      btn.style.opacity = '0.6';
      return;
    }
    if (!res.ok) {
      return res.text().then(function(body) { throw new Error('HTTP ' + res.status + ': ' + body); });
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var fullText = '';
    el.innerHTML = '<div style="line-height:1.9;font-size:13px;color:rgba(255,255,255,0.85)"></div>';
    var textEl = el.querySelector('div');

    function read() {
      reader.read().then(function(chunk) {
        if (chunk.done) {
          btn.textContent = t('wcGenerated');
          btn.disabled = true;
          btn.style.opacity = '0.6';
          return;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop();
        lines.forEach(function(line) {
          if (!line.startsWith('data: ')) return;
          var data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            var json = JSON.parse(data);
            if (json.type === 'content_block_delta' && json.delta && json.delta.text) {
              fullText += json.delta.text;
              textEl.innerHTML = fullText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
            }
          } catch(e) {}
        });
        read();
      }).catch(function(err) {
        el.innerHTML = '<span style="color:#ff6b6b;font-size:11px">' + t('wcStreamErrorPrefix') + err.message + '</span>';
        btn.textContent = t('wcRetry');
        btn.disabled = false;
        btn.style.opacity = '1';
      });
    }
    read();
  }).catch(function(err) {
    if (err.message && err.message.indexOf('429') !== -1) {
      el.innerHTML = '<span style="color:#e67e00;font-size:12px;line-height:1.7">' + t('wcRateLimitMsg') + '</span>';
      btn.textContent = t('wcRateLimit429');
      btn.disabled = true;
      btn.style.opacity = '0.6';
    } else {
      el.innerHTML = '<span style="color:#ff6b6b;font-size:11px">' + t('wcConnErrorPrefix') + err.message + '</span>';
      btn.textContent = t('wcRetry');
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  });
}

function debugForceDrawPK() {
  wcForceDrawPK = true;
  const btn = document.getElementById('debug-forcedraw-btn');
  if (btn) { btn.style.background = '#ffcccc'; btn.textContent = '🔧 延長PK強制 ✅ セット済み'; }
}

function debugShowR16(opponent) {
  wcR16Opponent = opponent;
  isWorldCupMode = true;
  showWCR16();
}
function debugShowQF(opponent) {
  wcQFOpponent = opponent;
  isWorldCupMode = true;
  showWCQF();
}
function debugShowSF(opponent) {
  wcSFOpponent = opponent;
  isWorldCupMode = true;
  showWCSF();
}
function debugShowF(opponent) {
  wcFOpponent = opponent;
  isWorldCupMode = true;
  showWCF();
}

function showWCR32(japanRank) {
  const opponent = japanRank === 1 ? TEAM_DATA.morocco2026 : TEAM_DATA.brazil2026;
  wcR32Opponent = opponent;
  const oppName = window.LANG === 'en' ? opponent.en_name : opponent.name;
  const japanName = window.LANG === 'en' ? 'Japan' : '日本';
  document.getElementById('wc-r32-content').innerHTML = `
    <div style="text-align:center;padding:24px 0 20px">
      <div style="font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:3px;margin-bottom:20px">ROUND OF 32</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:24px">
        <div style="text-align:center">
          <div style="font-size:52px">🇯🇵</div>
          <div style="font-size:17px;font-weight:700;color:#fff;margin-top:8px">${japanName}</div>
        </div>
        <div style="font-size:22px;color:rgba(255,255,255,0.4);font-weight:700">vs</div>
        <div style="text-align:center">
          <div style="font-size:52px">${opponent.flag}</div>
          <div style="font-size:17px;font-weight:700;color:#fff;margin-top:8px">${oppName}</div>
        </div>
      </div>
    </div>`;
  showScreen('worldcup-r32');
}

function startWCR32Match() {
  if (!wcR32Opponent) return;
  isWorldCupMode = true;
  isWCR32Mode = true;
  wcPhase = 'r32';
  const key = wcR32Opponent === TEAM_DATA.morocco2026 ? '2026r32vsモロッコ' : '2026r32vsブラジル';
  selectMatch(key);
  _settingBackScreen = 'worldcup-r32';
}

function showWCR16() {
  if (!wcR16Opponent) return;
  const opponent = wcR16Opponent;
  const oppName = window.LANG === 'en' ? opponent.en_name : opponent.name;
  const japanName = window.LANG === 'en' ? 'Japan' : '日本';
  document.getElementById('wc-r16-content').innerHTML = `
    <div style="text-align:center;padding:24px 0 20px">
      <div style="font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:3px;margin-bottom:20px">ROUND OF 16</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:24px">
        <div style="text-align:center">
          <div style="font-size:52px">🇯🇵</div>
          <div style="font-size:17px;font-weight:700;color:#fff;margin-top:8px">${japanName}</div>
        </div>
        <div style="font-size:22px;color:rgba(255,255,255,0.4);font-weight:700">vs</div>
        <div style="text-align:center">
          <div style="font-size:52px">${opponent.flag}</div>
          <div style="font-size:17px;font-weight:700;color:#fff;margin-top:8px">${oppName}</div>
        </div>
      </div>
      ${wcR16Opponent === TEAM_DATA.mexico2026 ? `
      <div style="margin-top:16px;background:rgba(0,0,0,0.25);border-radius:8px;padding:10px 14px">
        <div style="font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:1px;margin-bottom:4px">HOME ADVANTAGE</div>
        <div style="font-size:13px;color:#ffd700;font-weight:700">${t('wcHomeAdvTitle')}</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:2px">${t('wcHomeAdvDesc')}</div>
      </div>` : ''}
    </div>`;
  showScreen('worldcup-r16');
}

function startWCR16Match() {
  if (!wcR16Opponent) return;
  isWorldCupMode = true;
  isWCR16Mode = true;
  wcPhase = 'r16';
  const key = wcR16Opponent === TEAM_DATA.mexico2026 ? '2026r16vsメキシコ' : '2026r16vsノルウェー';
  selectMatch(key);
  _settingBackScreen = 'worldcup-r16';
}

function updateWCR16AfterResult() {
  let t1base = parseInt(document.getElementById('result-score1').textContent);
  let t2base = parseInt(document.getElementById('result-score2').textContent);
  const isDraw = t1base === t2base;
  if (isDraw) {
    wcCumulativeStats = {
      chances1: gameState.team1.chanceCounter, shots1: gameState.team1.shootCounter, saves1: gameState.team1.gkSaveCounter,
      chances2: gameState.team2.chanceCounter, shots2: gameState.team2.shootCounter, saves2: gameState.team2.gkSaveCounter
    };
    const etBtn = document.getElementById('wc-et-btn');
    if (etBtn) etBtn.style.display = '';
    if (etBtn && (!etBtn.textContent || etBtn.textContent === t('wcPKBtn'))) etBtn.textContent = t('wcETBtn');
    document.getElementById('btn-retry').style.display = 'none';
    document.getElementById('wc-result-back-btn').style.display = 'none';
  } else {
    _recordKOResult('wc_r16', 'regular');
    const japanWon = t1base > t2base;
    const btn = document.getElementById('wc-result-back-btn');
    if (btn) {
      btn.style.display = '';
      const _etBtn = document.getElementById('wc-et-btn');
      if (_etBtn) _etBtn.style.display = 'none';
      if (japanWon) {
        btn.textContent = t('wcToQF');
        btn.style.background = 'linear-gradient(135deg,#b8860b,#ffd700)';
        btn.style.color = '#1a1a1a';
        btn.onclick = () => {
          wcQFOpponent = wcR16Opponent === TEAM_DATA.mexico2026 ? TEAM_DATA.france2026 : TEAM_DATA.england2026;
          isWCR16Mode = false; wcPhase = '';
          showWCQF();
        };
      } else {
        btn.textContent = t('wcDefeated');
        btn.style.background = 'rgba(180,0,0,0.5)';
        btn.style.color = '#fff';
        btn.onclick = () => showWCEliminated('wc_r16');
      }
    }
    isWCR16Mode = false;
    wcPhase = '';
  }
  const retryBtn = document.getElementById('btn-retry');
  if (retryBtn) {
    retryBtn.style.display = (isDraw || t1base > t2base) ? 'none' : '';
    retryBtn.onclick = () => resetWCMode();
  }
}

function showWCQF() {
  if (!wcQFOpponent) return;
  const opponent = wcQFOpponent;
  const oppName = window.LANG === 'en' ? opponent.en_name : opponent.name;
  const japanName = window.LANG === 'en' ? 'Japan' : '日本';
  document.getElementById('wc-qf-content').innerHTML = `
    <div style="text-align:center;padding:24px 0 20px">
      <div style="font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:3px;margin-bottom:20px">QUARTER FINAL</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:24px">
        <div style="text-align:center">
          <div style="font-size:52px">🇯🇵</div>
          <div style="font-size:17px;font-weight:700;color:#fff;margin-top:8px">${japanName}</div>
        </div>
        <div style="font-size:22px;color:rgba(255,255,255,0.4);font-weight:700">vs</div>
        <div style="text-align:center">
          <div style="font-size:52px">${opponent.flag}</div>
          <div style="font-size:17px;font-weight:700;color:#fff;margin-top:8px">${oppName}</div>
        </div>
      </div>
    </div>`;
  showScreen('worldcup-qf');
}

function startWCQFMatch() {
  if (!wcQFOpponent) return;
  isWorldCupMode = true;
  isWCQFMode = true;
  wcPhase = 'qf';
  const key = wcQFOpponent === TEAM_DATA.france2026 ? '2026qfvsフランス' : '2026qfvsイングランド';
  selectMatch(key);
  _settingBackScreen = 'worldcup-qf';
}

function updateWCQFAfterResult() {
  let t1base = parseInt(document.getElementById('result-score1').textContent);
  let t2base = parseInt(document.getElementById('result-score2').textContent);
  const isDraw = t1base === t2base;
  if (isDraw) {
    wcCumulativeStats = {
      chances1: gameState.team1.chanceCounter, shots1: gameState.team1.shootCounter, saves1: gameState.team1.gkSaveCounter,
      chances2: gameState.team2.chanceCounter, shots2: gameState.team2.shootCounter, saves2: gameState.team2.gkSaveCounter
    };
    const etBtn = document.getElementById('wc-et-btn');
    if (etBtn) etBtn.style.display = '';
    if (etBtn && (!etBtn.textContent || etBtn.textContent === t('wcPKBtn'))) etBtn.textContent = t('wcETBtn');
    document.getElementById('btn-retry').style.display = 'none';
    document.getElementById('wc-result-back-btn').style.display = 'none';
  } else {
    _recordKOResult('wc_qf', 'regular');
    const japanWon = t1base > t2base;
    const btn = document.getElementById('wc-result-back-btn');
    if (btn) {
      btn.style.display = '';
      const _etBtn = document.getElementById('wc-et-btn');
      if (_etBtn) _etBtn.style.display = 'none';
      if (japanWon) {
        btn.textContent = t('wcToSF');
        btn.style.background = 'linear-gradient(135deg,#b8860b,#ffd700)';
        btn.style.color = '#1a1a1a';
        btn.onclick = () => {
            wcSFOpponent = wcQFOpponent === TEAM_DATA.france2026 ? TEAM_DATA.spain2026 : TEAM_DATA.argentina2026;
            isWCQFMode = false; wcPhase = '';
            showWCSF();
          };
      } else {
        btn.textContent = t('wcDefeated');
        btn.style.background = 'rgba(180,0,0,0.5)';
        btn.style.color = '#fff';
        btn.onclick = () => showWCEliminated('wc_qf');
      }
    }
    isWCQFMode = false;
    wcPhase = '';
  }
  const retryBtn = document.getElementById('btn-retry');
  if (retryBtn) {
    retryBtn.style.display = (isDraw || t1base > t2base) ? 'none' : '';
    retryBtn.onclick = () => resetWCMode();
  }
}

function showWCSF() {
  if (!wcSFOpponent) return;
  const opponent = wcSFOpponent;
  const oppName = window.LANG === 'en' ? opponent.en_name : opponent.name;
  const japanName = window.LANG === 'en' ? 'Japan' : '日本';
  document.getElementById('wc-sf-content').innerHTML = `
    <div style="text-align:center;padding:24px 0 20px">
      <div style="font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:3px;margin-bottom:20px">SEMI FINAL</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:24px">
        <div style="text-align:center">
          <div style="font-size:52px">🇯🇵</div>
          <div style="font-size:17px;font-weight:700;color:#fff;margin-top:8px">${japanName}</div>
        </div>
        <div style="font-size:22px;color:rgba(255,255,255,0.4);font-weight:700">vs</div>
        <div style="text-align:center">
          <div style="font-size:52px">${opponent.flag}</div>
          <div style="font-size:17px;font-weight:700;color:#fff;margin-top:8px">${oppName}</div>
        </div>
      </div>
    </div>`;
  showScreen('worldcup-sf');
}

function startWCSFMatch() {
  if (!wcSFOpponent) return;
  isWorldCupMode = true;
  isWCSFMode = true;
  wcPhase = 'sf';
  const key = wcSFOpponent === TEAM_DATA.spain2026 ? '2026sfvsスペイン' : '2026sfvsアルゼンチン';
  selectMatch(key);
  _settingBackScreen = 'worldcup-sf';
}

function updateWCSFAfterResult() {
  let t1base = parseInt(document.getElementById('result-score1').textContent);
  let t2base = parseInt(document.getElementById('result-score2').textContent);
  const isDraw = t1base === t2base;
  if (isDraw) {
    wcCumulativeStats = {
      chances1: gameState.team1.chanceCounter, shots1: gameState.team1.shootCounter, saves1: gameState.team1.gkSaveCounter,
      chances2: gameState.team2.chanceCounter, shots2: gameState.team2.shootCounter, saves2: gameState.team2.gkSaveCounter
    };
    const etBtn = document.getElementById('wc-et-btn');
    if (etBtn) etBtn.style.display = '';
    if (etBtn && (!etBtn.textContent || etBtn.textContent === t('wcPKBtn'))) etBtn.textContent = t('wcETBtn');
    document.getElementById('btn-retry').style.display = 'none';
    document.getElementById('wc-result-back-btn').style.display = 'none';
  } else {
    _recordKOResult('wc_sf', 'regular');
    const japanWon = t1base > t2base;
    const btn = document.getElementById('wc-result-back-btn');
    if (btn) {
      btn.style.display = '';
      const _etBtn = document.getElementById('wc-et-btn');
      if (_etBtn) _etBtn.style.display = 'none';
      if (japanWon) {
        btn.textContent = t('wcToF');
        btn.style.background = 'linear-gradient(135deg,#b8860b,#ffd700)';
        btn.style.color = '#1a1a1a';
        btn.onclick = () => {
          wcFOpponent = wcSFOpponent === TEAM_DATA.spain2026 ? TEAM_DATA.argentina2026 : TEAM_DATA.france2026;
          isWCSFMode = false; wcPhase = '';
          showWCF();
        };
        document.getElementById('btn-retry').style.display = 'none';
      } else {
        btn.textContent = t('wcDefeated');
        btn.style.background = 'rgba(180,0,0,0.5)';
        btn.style.color = '#fff';
        btn.onclick = () => showWCEliminated('wc_sf');
      }
    }
    isWCSFMode = false;
    wcPhase = '';
  }
  const retryBtn = document.getElementById('btn-retry');
  if (retryBtn) {
    retryBtn.style.display = (isDraw || t1base > t2base) ? 'none' : '';
    retryBtn.onclick = () => resetWCMode();
  }
}

function showWCF() {
  if (!wcFOpponent) return;
  const opponent = wcFOpponent;
  const oppName = window.LANG === 'en' ? opponent.en_name : opponent.name;
  const japanName = window.LANG === 'en' ? 'Japan' : '日本';
  document.getElementById('wc-f-content').innerHTML = `
    <div style="text-align:center;padding:24px 0 20px">
      <div style="font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:3px;margin-bottom:20px">FINAL</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:24px">
        <div style="text-align:center">
          <div style="font-size:52px">🇯🇵</div>
          <div style="font-size:17px;font-weight:700;color:#fff;margin-top:8px">${japanName}</div>
        </div>
        <div style="font-size:22px;color:rgba(255,255,255,0.4);font-weight:700">vs</div>
        <div style="text-align:center">
          <div style="font-size:52px">${opponent.flag}</div>
          <div style="font-size:17px;font-weight:700;color:#fff;margin-top:8px">${oppName}</div>
        </div>
      </div>
    </div>`;
  showScreen('worldcup-f');
}

function startWCFMatch() {
  if (!wcFOpponent) return;
  isWorldCupMode = true;
  isWCFMode = true;
  wcPhase = 'f';
  const key = wcFOpponent === TEAM_DATA.argentina2026 ? '2026fvsアルゼンチン' : '2026fvsフランス';
  selectMatch(key);
  _settingBackScreen = 'worldcup-f';
}

function updateWCFAfterResult() {
  let t1base = parseInt(document.getElementById('result-score1').textContent);
  let t2base = parseInt(document.getElementById('result-score2').textContent);
  const isDraw = t1base === t2base;
  if (isDraw) {
    wcCumulativeStats = {
      chances1: gameState.team1.chanceCounter, shots1: gameState.team1.shootCounter, saves1: gameState.team1.gkSaveCounter,
      chances2: gameState.team2.chanceCounter, shots2: gameState.team2.shootCounter, saves2: gameState.team2.gkSaveCounter
    };
    const etBtn = document.getElementById('wc-et-btn');
    if (etBtn) etBtn.style.display = '';
    if (etBtn && (!etBtn.textContent || etBtn.textContent === t('wcPKBtn'))) etBtn.textContent = t('wcETBtn');
    document.getElementById('btn-retry').style.display = 'none';
    document.getElementById('wc-result-back-btn').style.display = 'none';
  } else {
    _recordKOResult('wc_final', 'regular');
    const japanWon = t1base > t2base;
    const btn = document.getElementById('wc-result-back-btn');
    if (btn) {
      btn.style.display = '';
      const _etBtn = document.getElementById('wc-et-btn');
      if (_etBtn) _etBtn.style.display = 'none';
      if (japanWon) {
        btn.textContent = t('wcChampionBtn');
        btn.style.background = 'linear-gradient(135deg,#b8860b,#ffd700)';
        btn.style.color = '#1a1a1a';
        btn.onclick = () => showWCChampion();
        document.getElementById('btn-retry').style.display = 'none';
      } else {
        btn.textContent = t('wcDefeated');
        btn.style.background = 'rgba(180,0,0,0.5)';
        btn.style.color = '#fff';
        btn.onclick = () => showWCEliminated('wc_final');
      }
    }
    isWCFMode = false;
    wcPhase = '';
  }
  const retryBtn = document.getElementById('btn-retry');
  if (retryBtn) {
    retryBtn.style.display = (isDraw || t1base > t2base) ? 'none' : '';
    retryBtn.onclick = () => resetWCMode();
  }
}

function startWCExtraTime() {
  // 90分スコア・ログを保存（延長結果画面で全区間合算表示するため）
  wcETScore = { t1: gameState.team1.score, t2: gameState.team2.score };
  wcMatchLog = chanceResults.slice(); // 90分ログを保存
  wcPhase = 'et_first';
  isWorldCupMode = true;
  if (!isWCR16Mode && !isWCQFMode && !isWCSFMode && !isWCFMode) isWCR32Mode = true;
  const etBtn = document.getElementById('wc-et-btn');
  if (etBtn) etBtn.style.display = 'none';
  if (subsCount < 5 && subsUsed < 3) {
    _wcETSubPending = true;
    openSecondHalfSub();
  } else {
    _runWCETPhase();
  }
}


function _recalcETFromCurrent() {
  // 交代後のlineupを反映
  gameState.team1.lineup = [...team1State.lineup];
  // 現在地点のスコアを復元
  const baseScore = currentChanceIdx > 0
    ? { t1: chanceResults[currentChanceIdx - 1].t1score, t2: chanceResults[currentChanceIdx - 1].t2score }
    : { t1: 0, t2: 0 };
  gameState.team1.score = baseScore.t1;
  gameState.team2.score = baseScore.t2;
  // カウンターリセット（再シミュレートのため）
  gameState.team1.chanceCounter = 0; gameState.team2.chanceCounter = 0;
  gameState.team1.shootCounter = 0;  gameState.team2.shootCounter = 0;
  gameState.team1.gkSaveCounter = 0; gameState.team2.gkSaveCounter = 0;
  // 表示済みチャンスはそのまま保持し、残りを再計算
  const total = chanceResults.length;
  const firstPart = chanceResults.slice(0, currentChanceIdx);
  const newPart = [];
  for (let i = currentChanceIdx; i < total; i++) {
    newPart.push(simulateChance(gameState, i));
  }
  chanceResults = [...firstPart, ...newPart];
  document.getElementById('chance-total').textContent = chanceResults.length;
}

function _runWCETPhase() {
  // スコア・カウンターのみリセット（lineup・players・fatigue は保持）
  const t1 = gameState.team1, t2 = gameState.team2;
  t1.score = 0; t2.score = 0;
  t1.chanceCounter = 0; t2.chanceCounter = 0;
  t1.shootCounter = 0;  t2.shootCounter = 0;
  t1.gkSaveCounter = 0; t2.gkSaveCounter = 0;

  chanceResults = [];
  currentChanceIdx = 0;
  currentSceneIdx = 0;
  currentEventDiv = null;
  halfTimeShown = false;

  if (wcPhase === 'et_first') {
    for (let i = 0; i < 3; i++) chanceResults.push(simulateChance(gameState, i));
  } else {
    for (let i = 0; i < 3; i++) chanceResults.push(simulateChance(gameState, i));
    if (Math.random() < 0.5) chanceResults.push(simulateChance(gameState, 3));
  }

  document.getElementById('score-flag1').textContent = team1Data.flag;
  document.getElementById('score-flag2').textContent = team2Data.flag;
  document.getElementById('score-name1').textContent = getTeamName(team1Data);
  document.getElementById('score-name2').textContent = getTeamName(team2Data);
  document.getElementById('score1').textContent = '0';
  document.getElementById('score2').textContent = '0';
  document.getElementById('log-area').innerHTML = '';
  document.getElementById('chance-count').textContent = '0';
  document.getElementById('chance-total').textContent = chanceResults.length;
  document.getElementById('next-btn').disabled = false;
  document.getElementById('sub-btn').style.display = 'none';

  // 「結果を見る」でスキップ中：ET2も即完走して結果画面へ
  if (_wcSkipToEnd && wcPhase === 'et_second') {
    halfTimeShown = true;
    while (currentChanceIdx < chanceResults.length) nextChance();
    showResult();
    return;
  }

  showScreen('game');
}

function _renderWCCumulativeStats() {
  const c = wcCumulativeStats;
  const statsGrid = document.getElementById('stats-grid');
  if (!statsGrid) return;
  const rows = [
    [c.chances1, window.LANG==='en'?'Chances':'チャンス', c.chances2],
    [c.shots1,   window.LANG==='en'?'Shots':'シュート',   c.shots2],
    [c.saves1,   window.LANG==='en'?'GK Saves':'GKセーブ', c.saves2],
  ];
  statsGrid.innerHTML = '';
  rows.forEach(([l, label, r]) => {
    statsGrid.innerHTML += `<div style="padding:12px 16px;text-align:center;font-size:16px;font-weight:700;border-top:1px solid rgba(0,0,0,0.08)">${l}</div><div style="padding:12px 8px;text-align:center;font-size:11px;color:var(--text-dim);display:flex;align-items:center;justify-content:center;border-top:1px solid rgba(0,0,0,0.08)">${label}</div><div style="padding:12px 16px;text-align:center;font-size:16px;font-weight:700;border-top:1px solid rgba(0,0,0,0.08)">${r}</div>`;
  });
}

function onWCEtBtnClick() {
  if (wcPhase === 'pk') { startWCPK(); } else { startWCExtraTime(); }
}

function startWCPK() {
  const firstTeam = Math.random() < 0.5 ? 1 : 2;
  // GK(lineup[0])を除いたキッカーリスト（SHOOT_ACCURACY=params[11]の高い順）
  const t1Kickers = gameState.team1.lineup.slice(1, 11)
    .map(idx => gameState.team1.players[idx]).filter(Boolean)
    .sort((a, b) => (b.params[11] || 0) - (a.params[11] || 0));
  const t2Kickers = gameState.team2.lineup.slice(1, 11)
    .map(idx => gameState.team2.players[idx]).filter(Boolean)
    .sort((a, b) => (b.params[11] || 0) - (a.params[11] || 0));

  pkState = {
    firstTeam,
    t1Kickers, t2Kickers,
    t1KickCount: 0, t2KickCount: 0,
    t1Kicks: [], t2Kicks: [],
    t1Goals: 0, t2Goals: 0,
    isSD: false, sdRound: 0,
    phase: 'kick', done: false,
  };

  document.getElementById('pk-name1').textContent = getTeamName(team1Data);
  document.getElementById('pk-name2').textContent = getTeamName(team2Data);
  wcPhase = 'pk';
  document.getElementById('pk-title-label').textContent = t('wcPK');
  document.getElementById('pk-kick-btn').textContent = t('wcPKKickBtn');
  document.getElementById('pk-next-btn').textContent = t('wcPKNext');
  // 前のPK戦で上書きされたonclickをリセット
  document.getElementById('pk-next-btn').onclick = stepWCPK_next;
  // 前のPK戦の結果画像をリセット
  const _pkImgWrap = document.getElementById('pk-result-img-wrap');
  if (_pkImgWrap) _pkImgWrap.style.display = 'none';
  const _pkImg = document.getElementById('pk-result-img');
  if (_pkImg) _pkImg.src = '';
  showScreen('worldcup-pk');
  _renderPKState();
}

function _currentPKTeam() {
  const st = pkState;
  if (st.firstTeam === 1) {
    return st.t1KickCount <= st.t2KickCount ? 1 : 2;
  } else {
    return st.t2KickCount <= st.t1KickCount ? 2 : 1;
  }
}

function _renderPKState() {
  const st = pkState;
  document.getElementById('pk-score1').textContent = st.t1Goals;
  document.getElementById('pk-score2').textContent = st.t2Goals;
  document.getElementById('pk-kicks1').textContent = st.t1Kicks.map(g => g ? '⚽' : '❌').join('');
  document.getElementById('pk-kicks2').textContent = st.t2Kicks.map(g => g ? '⚽' : '❌').join('');

  const isSD = st.isSD;
  const curTeam = _currentPKTeam();
  const kickNum = curTeam === 1 ? st.t1KickCount + 1 : st.t2KickCount + 1;
  document.getElementById('pk-round-label').textContent =
    isSD ? `${t('wcPKSuddenDeath')} ${st.sdRound + 1}` : `${t('wcPKRound')}${kickNum}${t('wcPKKick')}`;

  const isJapan = curTeam === 1;
  const kickers = isJapan ? st.t1Kickers : st.t2Kickers;
  const kIdx = isJapan ? st.t1KickCount : st.t2KickCount;
  const kicker = kickers[kIdx % kickers.length];
  const tData = isJapan ? team1Data : team2Data;

  document.getElementById('pk-team-label').textContent =
    `${tData.flag || ''} ${getTeamName(tData)} ${t('wcPKKickOf')}`;
  document.getElementById('pk-player-flag').textContent = tData.flag || '🏳️';
  document.getElementById('pk-player-name').textContent = kicker ? getPlayerName(kicker) : '選手';
  document.getElementById('pk-player-pos').textContent =
    kicker && kicker.positions ? kicker.positions[0] : '';

  document.getElementById('pk-kicker-box').style.display = '';
  document.getElementById('pk-result-display').style.display = 'none';
  document.getElementById('pk-kick-btn').style.display = '';
  document.getElementById('pk-next-btn').style.display = 'none';
}

function stepWCPK_kick() {
  const st = pkState;
  if (!st || st.done || st.phase !== 'kick') return;

  const curTeam = _currentPKTeam();
  const scored = Math.random() < 0.75;

  if (curTeam === 1) {
    st.t1Kicks.push(scored); if (scored) st.t1Goals++;
    st.t1KickCount++;
  } else {
    st.t2Kicks.push(scored); if (scored) st.t2Goals++;
    st.t2KickCount++;
  }

  document.getElementById('pk-score1').textContent = st.t1Goals;
  document.getElementById('pk-score2').textContent = st.t2Goals;
  document.getElementById('pk-kicks1').textContent = st.t1Kicks.map(g => g ? '⚽' : '❌').join('');
  document.getElementById('pk-kicks2').textContent = st.t2Kicks.map(g => g ? '⚽' : '❌').join('');

  const rEmoji = document.getElementById('pk-result-emoji');
  const rText  = document.getElementById('pk-result-text');
  if (scored) {
    rEmoji.textContent = '⚽'; rText.textContent = 'ゴール！'; rText.style.color = '#4ade80';
  } else {
    rEmoji.textContent = '❌'; rText.textContent = 'セーブ！'; rText.style.color = '#f87171';
  }

  document.getElementById('pk-kicker-box').style.display = 'none';
  document.getElementById('pk-result-display').style.display = '';
  document.getElementById('pk-kick-btn').style.display = 'none';
  document.getElementById('pk-next-btn').style.display = '';
  st.phase = 'result';
}

function _checkPKEarlyFinish() {
  const st = pkState;
  if (st.isSD) {
    return st.t1KickCount === st.t2KickCount && st.t1Goals !== st.t2Goals;
  }
  const rem1 = Math.max(0, 5 - st.t1KickCount);
  const rem2 = Math.max(0, 5 - st.t2KickCount);
  if (st.t1Goals > st.t2Goals + rem2) return true;
  if (st.t2Goals > st.t1Goals + rem1) return true;
  if (st.t1KickCount >= 5 && st.t2KickCount >= 5) return true;
  return false;
}

function _finishPK() {
  const st = pkState;
  st.done = true;
  const japanWon = st.t1Goals > st.t2Goals;
  const _pkStageKey = isWCFMode ? 'wc_final' : isWCSFMode ? 'wc_sf' : isWCQFMode ? 'wc_qf' : isWCR16Mode ? 'wc_r16' : 'wc_r32';
  _recordKOResult(_pkStageKey, 'pk', st.t1Goals, st.t2Goals);

  // Firebase: PK決着の試合結果を書き込む
  {
    const _wcMT = _pkStageKey;
    const _wcRes = japanWon ? 'win' : 'loss';
    writeWCMatchResult(_wcMT, _wcRes, team2Data.en_name || team2Data.name, 'pk');
  }

  document.getElementById('pk-kicker-box').style.display = 'none';
  document.getElementById('pk-kick-btn').style.display = 'none';

  document.getElementById('pk-result-emoji').style.display = 'none';
  const rText  = document.getElementById('pk-result-text');
  if (japanWon) {
    rText.textContent = t('wcPKWin'); rText.style.color = '#ffd700';
  } else {
    rText.textContent = t('wcPKLose'); rText.style.color = '#f87171';
  }
  const pkImg = document.getElementById('pk-result-img');
  const pkImgWrap = document.getElementById('pk-result-img-wrap');
  if (pkImg && pkImgWrap) {
    pkImg.src = japanWon ? IMG_WIN : IMG_LOSE;
    pkImgWrap.style.display = '';
  }
  document.getElementById('pk-result-display').style.display = '';

  const nextBtn = document.getElementById('pk-next-btn');
  if (nextBtn) {
    const _pkNextText = isWCFMode ? t('wcChampionBtn')
      : isWCSFMode ? t('wcToF')
      : isWCQFMode ? t('wcToSF')
      : isWCR16Mode ? t('wcToQF')
      : t('wcPKNextRound');
    nextBtn.textContent = japanWon ? _pkNextText : t('wcPKEliminated');
    nextBtn.style.background = japanWon
      ? 'linear-gradient(135deg,#b8860b,#ffd700)' : 'rgba(180,0,0,0.5)';
    nextBtn.style.color = japanWon ? '#1a1a1a' : '#fff';
    nextBtn.onclick = () => {
      wcPhase = '';
      if (isWCR16Mode) {
        isWCR16Mode = false;
        if (japanWon) {
          wcQFOpponent = wcR16Opponent === TEAM_DATA.mexico2026 ? TEAM_DATA.france2026 : TEAM_DATA.england2026;
          showWCQF();
        } else {
          showWCEliminated('wc_r16');
        }
      } else if (isWCQFMode) {
        isWCQFMode = false;
        if (japanWon) {
          wcSFOpponent = wcQFOpponent === TEAM_DATA.france2026 ? TEAM_DATA.spain2026 : TEAM_DATA.argentina2026;
          showWCSF();
        } else { showWCEliminated('wc_qf'); }
      } else if (isWCSFMode) {
        isWCSFMode = false;
        if (japanWon) {
          wcFOpponent = wcSFOpponent === TEAM_DATA.spain2026 ? TEAM_DATA.argentina2026 : TEAM_DATA.france2026;
          showWCF();
        } else { showWCEliminated('wc_sf'); }
      } else if (isWCFMode) {
        isWCFMode = false;
        japanWon ? showWCChampion() : showWCEliminated('wc_final');
      } else {
        isWCR32Mode = false;
        if (japanWon) {
          wcR16Opponent = wcR32Opponent === TEAM_DATA.morocco2026 ? TEAM_DATA.mexico2026 : TEAM_DATA.norway2026;
          showWCR16();
        } else {
          showWCEliminated('wc_r32');
        }
      }
    };
    nextBtn.style.display = '';
  }
}

function stepWCPK_next() {
  const st = pkState;
  if (!st || st.phase !== 'result') return;
  st.phase = 'kick';

  if (_checkPKEarlyFinish()) {
    // 5本終了で引き分け → サドンデスへ
    if (!st.isSD && st.t1KickCount >= 5 && st.t2KickCount >= 5 && st.t1Goals === st.t2Goals) {
      st.isSD = true; st.sdRound = 0;
      _renderPKState();
    } else {
      _finishPK();
    }
    return;
  }

  // SDで片方のみキック済み（もう片方がまだ） → 継続
  if (st.isSD && st.t1KickCount !== st.t2KickCount) {
    _renderPKState();
    return;
  }
  // SDで両方キック済み → sdRoundを進める
  if (st.isSD && st.t1KickCount === st.t2KickCount) {
    st.sdRound++;
  }

  _renderPKState();
}

function updateWCETAfterResult() {
  const phaseT1 = gameState.team1.score;
  const phaseT2 = gameState.team2.score;

  // 現フェーズのスタッツを累積に加算
  wcCumulativeStats.chances1 += gameState.team1.chanceCounter;
  wcCumulativeStats.shots1   += gameState.team1.shootCounter;
  wcCumulativeStats.saves1   += gameState.team1.gkSaveCounter;
  wcCumulativeStats.chances2 += gameState.team2.chanceCounter;
  wcCumulativeStats.shots2   += gameState.team2.shootCounter;
  wcCumulativeStats.saves2   += gameState.team2.gkSaveCounter;
  _renderWCCumulativeStats();

  if (wcPhase === 'et_second') {
    wcETScore.t1 += phaseT1;
    wcETScore.t2 += phaseT2;
    document.getElementById('result-score1').textContent = wcETScore.t1;
    document.getElementById('result-score2').textContent = wcETScore.t2;
    // winner表示を累積スコアで更新
    const winner = document.getElementById('result-winner');
    if (wcETScore.t1 > wcETScore.t2) {
      winner.textContent = `${team1Data.flag} ${getTeamName(team1Data)}${t('win')}`;
      winner.style.color = team1Data.team_color;
    } else if (wcETScore.t2 > wcETScore.t1) {
      winner.textContent = `${team2Data.flag} ${getTeamName(team2Data)}${t('win')}`;
      winner.style.color = team2Data.team_color;
    } else {
      winner.textContent = t('draw');
      winner.style.color = '#aaa';
    }
    document.getElementById('btn-retry').style.display = 'none';
    const btn = document.getElementById('wc-result-back-btn');
    const etBtn = document.getElementById('wc-et-btn');
    const _etSK = isWCFMode ? 'wc_final' : isWCSFMode ? 'wc_sf' : isWCQFMode ? 'wc_qf' : isWCR16Mode ? 'wc_r16' : 'wc_r32';
    if (wcETScore.t1 > wcETScore.t2) {
      _recordKOResult(_etSK, 'et');
      if (btn) {
        btn.style.display = '';
        btn.textContent = isWCFMode ? t('wcChampionBtn') : isWCSFMode ? t('wcToF') : isWCQFMode ? t('wcToSF') : isWCR16Mode ? t('wcToQF') : t('wcToR16');
        btn.style.background = 'linear-gradient(135deg,#b8860b,#ffd700)';
        btn.style.color = '#1a1a1a';
        btn.onclick = () => {
          if (isWCQFMode) {
            isWCQFMode = false; wcPhase = '';
            wcSFOpponent = wcQFOpponent === TEAM_DATA.france2026 ? TEAM_DATA.spain2026 : TEAM_DATA.argentina2026;
            showWCSF();
          } else if (isWCSFMode) {
            isWCSFMode = false; wcPhase = '';
            wcFOpponent = wcSFOpponent === TEAM_DATA.spain2026 ? TEAM_DATA.argentina2026 : TEAM_DATA.france2026;
            showWCF();
          } else if (isWCR16Mode) {
            wcQFOpponent = wcR16Opponent === TEAM_DATA.mexico2026 ? TEAM_DATA.france2026 : TEAM_DATA.england2026;
            isWCR16Mode = false; wcPhase = '';
            showWCQF();
          } else {
            wcR16Opponent = wcR32Opponent === TEAM_DATA.morocco2026 ? TEAM_DATA.mexico2026 : TEAM_DATA.norway2026;
            isWCR32Mode = false; wcPhase = '';
            showWCR16();
          }
        };
      }
    } else if (wcETScore.t2 > wcETScore.t1) {
      _recordKOResult(_etSK, 'et');
      const _etElimStage = _etSK;
      if (btn) {
        btn.style.display = '';
        btn.textContent = t('wcDefeated');
        btn.style.background = 'rgba(180,0,0,0.5)';
        btn.style.color = '#fff';
        btn.onclick = () => showWCEliminated(_etElimStage);
      }
      isWCR32Mode = false; isWCR16Mode = false; isWCQFMode = false; isWCSFMode = false; isWCFMode = false; wcPhase = '';
    } else {
      // PK戦へ
      if (etBtn) {
        etBtn.textContent = t('wcPKBtn');
        etBtn.style.display = '';
      }
      wcPhase = 'pk';
    }
  }
}

function updateWCR32AfterResult() {
  let t1base = parseInt(document.getElementById('result-score1').textContent);
  let t2base = parseInt(document.getElementById('result-score2').textContent);
  if (wcForceDrawPK) {
    t1base = 0; t2base = 0;
    document.getElementById('result-score1').textContent = 0;
    document.getElementById('result-score2').textContent = 0;
    wcForceDrawPK = false;
    const dbgBtn = document.getElementById('debug-forcedraw-btn');
    if (dbgBtn) { dbgBtn.style.background = '#f0f0f0'; dbgBtn.textContent = '🔧 延長PK強制（次のR32試合のみ）'; }
  }

  const isDraw = t1base === t2base;

  if (isDraw) {
    // 90分スタッツを累積に保存
    wcCumulativeStats = {
      chances1: gameState.team1.chanceCounter, shots1: gameState.team1.shootCounter, saves1: gameState.team1.gkSaveCounter,
      chances2: gameState.team2.chanceCounter, shots2: gameState.team2.shootCounter, saves2: gameState.team2.gkSaveCounter
    };
    // 引き分け → 延長戦へボタンを表示
    const etBtn = document.getElementById('wc-et-btn');
    if (etBtn) etBtn.style.display = '';
    if (etBtn && (!etBtn.textContent || etBtn.textContent === t('wcPKBtn'))) etBtn.textContent = t('wcETBtn');
    document.getElementById('btn-retry').style.display = 'none';
    document.getElementById('wc-result-back-btn').style.display = 'none';
  } else {
    _recordKOResult('wc_r32', 'regular');
    const japanWon = t1base > t2base;
    const btn = document.getElementById('wc-result-back-btn');
    if (btn) {
      btn.style.display = '';
      const _etBtn = document.getElementById('wc-et-btn');
      if (_etBtn) _etBtn.style.display = 'none';
      if (japanWon) {
        btn.textContent = t('wcToR16');
        btn.style.background = 'linear-gradient(135deg,#b8860b,#ffd700)';
        btn.style.color = '#1a1a1a';
        btn.onclick = () => {
          wcR16Opponent = wcR32Opponent === TEAM_DATA.morocco2026 ? TEAM_DATA.mexico2026 : TEAM_DATA.norway2026;
          showWCR16();
        };
      } else {
        btn.textContent = t('wcDefeated');
        btn.style.background = 'rgba(180,0,0,0.5)';
        btn.style.color = '#fff';
        btn.onclick = () => showWCEliminated('wc_r32');
      }
    }
    isWCR32Mode = false;
    wcPhase = '';
  }

  const retryBtn = document.getElementById('btn-retry');
  if (retryBtn) {
    retryBtn.style.display = (isDraw || t1base > t2base) ? 'none' : '';
    retryBtn.onclick = () => resetWCMode();
  }
}

function resetWCMode() {
  wcR32Opponent = null;
  isWCR32Mode = false;
  wcR16Opponent = null;
  isWCR16Mode = false;
  wcQFOpponent = null;
  isWCQFMode = false;
  wcSFOpponent = null;
  isWCSFMode = false;
  wcFOpponent = null;
  isWCFMode = false;
  wcPhase = '';
  _wcSkipToEnd = false;
  wcETScore = {t1: 0, t2: 0};
  wcMatchLog = [];
  wcCumulativeStats = {chances1:0,shots1:0,saves1:0,chances2:0,shots2:0,saves2:0};
  wcMatchIndex  = 0;
  wcMatchScores = [];
  wcAutoScores  = [];
  wcPlayerStats    = {};
  wcOppPlayerStats = {};
  wcTotalStats  = {chances:0, shots:0, gkSaves:0, oppChances:0, oppShots:0, oppGkSaves:0};
  wcGoalScorers = [];
  wcKnockoutResults = [];
  wcGroupRank   = 0;
  wcAreaAtk     = {};
  wcAreaDef     = {};
  wcStandings = {
    '日本':        {flag:'🇯🇵', p:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0},
    'オランダ':    {flag:'🇳🇱', p:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0},
    'チュニジア':  {flag:'🇹🇳', p:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0},
    'スウェーデン':{flag:'🇸🇪', p:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0}
  };
  const doneEl = document.getElementById('wc-done-matches');
  if (doneEl) { doneEl.innerHTML=''; doneEl.style.display='none'; }
  const autoEl = document.getElementById('wc-auto-results');
  if (autoEl) { autoEl.innerHTML=''; autoEl.style.display='none'; }
  const etPkEl = document.getElementById('wc-et-pk-result');
  if (etPkEl) { etPkEl.innerHTML=''; etPkEl.style.display='none'; }
  // ET/PKボタンをリセット（前のトーナメント試合の状態が残らないよう）
  const _etBtn = document.getElementById('wc-et-btn');
  if (_etBtn) { _etBtn.style.display = 'none'; _etBtn.textContent = t('wcETBtn'); }
  // PKステートをリセット
  pkState = null;
  renderWCTable();
  updateWCNextBtn();
  showScreen('worldcup');
}

function wcGoToTitle() {
  // WCモードの状態をリセットしてからタイトルへ戻る
  // resetWCMode()がshowScreen('worldcup')を呼ぶが、直後にtitleで上書き
  resetWCMode();
  showScreen('title');
}

function renderWCTable() {
  const names = ['日本', 'オランダ', 'チュニジア', 'スウェーデン'];
  const sorted = names.slice().sort((a, b) => {
    const sa = wcStandings[a], sb = wcStandings[b];
    if (sb.pts !== sa.pts) return sb.pts - sa.pts;
    if (sb.gd  !== sa.gd)  return sb.gd  - sa.gd;
    return sb.gf - sa.gf;
  });
  const tbody = document.getElementById('wc-group-table');
  if (!tbody) return;
  tbody.innerHTML = sorted.map(name => {
    const s = wcStandings[name];
    const td = (v, ex) => `<td style="text-align:center;padding:7px 8px${ex||''}">${v}</td>`;
    return `<tr>
      <td style="padding:7px 4px">${s.flag} ${getWCTeamName(name)}</td>
      ${td(s.p)}${td(s.w)}${td(s.d)}${td(s.l)}${td(s.gf)}${td(s.ga)}${td(s.gd)}
      ${td(s.pts, ';color:#ffd700;font-weight:700')}
    </tr>`;
  }).join('');
}


function retryGame() {
  _resetSummary();
  // シングルマッチ時は設定画面を正しく再初期化（チームデータ・フォーメーションを維持）
  if (!isWorldCupMode) initSettingScreen();
  showScreen('setting');
}

function _resetSummary() {
  var el = document.getElementById('summary-content');
  var btn = document.getElementById('summary-btn');
  if (el) el.innerHTML = '<span style="color:var(--text-dim);font-size:12px">' + t('summaryPlaceholder') + '</span>';
  if (btn) { btn.disabled = false; btn.textContent = t('btnGenerate'); btn.style.opacity = '1'; }
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('open');
  });
});

function showJsonModal(jsonStr) {
  var existing = document.getElementById('jsonExportModal');
  if (existing) existing.remove();
  var modal = document.createElement('div');
  modal.id = 'jsonExportModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;flex-direction:column;padding:16px;box-sizing:border-box';
  modal.innerHTML =
    '<div style="background:#1a3a5c;border-radius:12px;flex:1;display:flex;flex-direction:column;overflow:hidden;max-height:100%">' +
    '<div style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.2);display:flex;align-items:center;gap:10px">' +
    '<span style="color:#f0c040;font-weight:700;font-size:14px;flex:1">💾 JSON保存データ</span>' +
    '<button onclick="var t=document.getElementById(\'jsonText\');t.select();document.execCommand(\'copy\');this.textContent=\'✅ コピー済\'" ' +
    'style="background:#27ae60;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">📋 全コピー</button>' +
    '<button onclick="document.getElementById(\'jsonExportModal\').remove()" ' +
    'style="background:#666;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">✕ 閉じる</button>' +
    '</div>' +
    '<p style="color:rgba(255,255,255,0.6);font-size:11px;padding:8px 16px;margin:0">このJSONをコピーしてClaudeに渡すと、HTMLへ反映します</p>' +
    '<textarea id="jsonText" readonly style="flex:1;background:#0d2035;color:#7fdbff;font-size:11px;padding:12px;border:none;resize:none;font-family:monospace;outline:none">' +
    jsonStr.replace(/</g,'&lt;').replace(/>/g,'&gt;') +
    '</textarea>' +
    '</div>';
  document.body.appendChild(modal);
  // 全選択
  setTimeout(function(){
    var ta = document.getElementById('jsonText');
    if (ta) { ta.focus(); ta.select(); }
  }, 100);
}




function pColor(v) {
  return v >= 85 ? '#ff6b6b' : v >= 80 ? '#74b9ff' : v >= 70 ? '#55efc4' : '#aaa';
}

function calcOverallLive(params, positions) {
  function avg(idxs) {
    var s=0,c=0;
    for(var i=0;i<idxs.length;i++){if(idxs[i]<params.length){s+=params[idxs[i]];c++;}}
    return c?s/c:0;
  }
  var isGK = positions && positions.some(function(p){return p==='GK';});
  var sv = [
    avg([7,8,9,10,11,13,17]),
    isGK ? avg([23,24]) : avg([18,19,20,21,22]),
    avg([13,14,15,16]),
    avg([0,1,5,25]),
    avg([2,3,4,6]),
    avg([26,27])
  ];
  var total=0; for(var i=0;i<sv.length;i++) total+=sv[i];
  return Math.round(total/6);
}

function onParamInput(inp) {
  var v = Math.min(99, Math.max(40, parseInt(inp.value)||40));
  var teamKey = inp.dataset.teamKey;
  var pIdx = parseInt(inp.dataset.playerIdx);
  var paramIdx = parseInt(inp.dataset.paramIdx);
  // TEAM_DATAを即時更新
  TEAM_DATA[teamKey].players[pIdx].params[paramIdx] = v;
  inp.dataset.val = v;
  // 総合値をリアルタイム更新
  var ovEl = document.getElementById('overall-' + teamKey + '-' + pIdx);
  if (ovEl) {
    var params = TEAM_DATA[teamKey].players[pIdx].params;
    var positions = TEAM_DATA[teamKey].players[pIdx].positions;
    ovEl.textContent = calcOverallLive(params, positions);
  }
}

function saveParamsJSON() {
  // 編集中のinput値をすべてTEAM_DATAに反映してから保存
  document.querySelectorAll('input[data-param-cell]').forEach(function(inp) {
    var v = Math.min(99, Math.max(40, parseInt(inp.value) || 40));
    var teamKey = inp.dataset.teamKey;
    var pIdx = parseInt(inp.dataset.playerIdx);
    var paramIdx = parseInt(inp.dataset.paramIdx);
    if (TEAM_DATA[teamKey] && TEAM_DATA[teamKey].players[pIdx]) {
      TEAM_DATA[teamKey].players[pIdx].params[paramIdx] = v;
    }
  });

  var out = {};
  var keys = ['japan2026','japan2026vsEngland','england2026','scotland2026','japan2026vsNetherlands','netherlands2026','japan2026vsTunisia','tunisia2026','japan2026vsSweden','sweden2026'];
  keys.forEach(function(k) {
    out[k] = TEAM_DATA[k].players.map(function(p) {
      return {name: p.name, long_name: p.long_name, positions: p.positions, params: p.params.slice()};
    });
  });

  var jsonStr = JSON.stringify(out, null, 2);
  var blob = new Blob([jsonStr], {type:'application/json'});

  // モバイル対応: URL.createObjectURL + 強制クリック
  try {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'JapanNT_params.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    // モバイルでもモーダル表示（コピー用）
    showJsonModal(jsonStr);
  } catch(e) {
    showJsonModal(jsonStr);
  }
}

// ===== 画像・シェア機能 =====
// タイトル画像セット


function setResultImage(team1Score, team2Score) {
  const img = document.getElementById('result-img');
  const wrap = document.getElementById('result-img-wrap');
  if (!img) return;
  if (team1Data.en_name !== 'Japan') {
    img.src = '';
    if (wrap) wrap.style.display = 'none';
    return;
  }
  if (team1Score > team2Score) {
    img.src = IMG_WIN;
    img.alt = t('imgAltWin');
    if (wrap) wrap.style.display = '';
  } else if (team1Score < team2Score) {
    img.src = IMG_LOSE;
    img.alt = t('imgAltLose');
    if (wrap) wrap.style.display = '';
  } else {
    img.src = '';
    if (wrap) wrap.style.display = 'none';
  }
}

function shareToX(mode) {
  var isEn = window.LANG === 'en';
  var siteUrl = 'https://footballsim.github.io/football-sim/';
  var tags = isEn ? '#FootballSimulationLab #Soccer #FootballSim' : '#FootballSimulationLab #サッカー #日本代表';
  var text;

  if (!mode || mode === 'single') {
    var score1 = document.getElementById('result-score1').textContent;
    var score2 = document.getElementById('result-score2').textContent;
    var name1  = document.getElementById('result-name1').textContent;
    var name2  = document.getElementById('result-name2').textContent;
    var winner = document.getElementById('result-winner').textContent;
    var emoji  = winner.includes('勝利')||winner.includes('Win') ? '🎉' : winner.includes('敗')||winner.includes('Defeat') ? '😭' : '🤝';
    text = emoji + ' ' + name1 + ' ' + score1 + '-' + score2 + ' ' + name2 + '\n' + winner + '\n\n' + siteUrl + '\n' + tags;
  } else {
    var GAMES = window._multiGAMES || 10;
    var t1wins = window._multiT1wins || 0;
    var t2wins = window._multiT2wins || 0;
    var draws  = GAMES - t1wins - t2wins;
    var n1 = getTeamName(team1Data), n2 = getTeamName(team2Data);
    text = '⚽ ' + n1 + ' vs ' + n2 + ' (' + GAMES + (isEn?' matches':'試合') + ')\n'
      + n1 + ' ' + t1wins + (isEn?'W':'勝') + ' / ' + draws + (isEn?'D':'分') + ' / ' + n2 + ' ' + t2wins + (isEn?'W':'勝') + '\n\n'
      + siteUrl + '\n' + tags;
  }

  window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text), '_blank');
}

function shareToReddit(mode) {
  var isEn = window.LANG === 'en';
  var siteUrl = 'https://footballsim.github.io/football-sim/';
  var title, text;

  if (!mode || mode === 'single') {
    var score1 = document.getElementById('result-score1').textContent;
    var score2 = document.getElementById('result-score2').textContent;
    var name1  = document.getElementById('result-name1').textContent;
    var name2  = document.getElementById('result-name2').textContent;
    var poss1el = null;
    try {
      var t1a=0,t2a=0;
      if(chanceResults){chanceResults.forEach(function(r){r.scenes.forEach(function(s){if(s.offence===gameState.team1)t1a++;else t2a++;});});}
      var p1=Math.round(t1a/(t1a+t2a||1)*100);
      title = (isEn
        ? name1+' '+score1+'-'+score2+' '+name2+' | Possession: '+p1+'% vs '+(100-p1)+'% | Football Simulation Lab'
        : name1+' '+score1+'-'+score2+' '+name2+' | ポゼッション: '+p1+'% vs '+(100-p1)+'% | Football Simulation Lab');
    } catch(e) {
      title = name1 + ' ' + score1 + '-' + score2 + ' ' + name2 + (isEn ? ' — Match Simulation Result' : ' シミュレーション結果');
    }
  } else {
    var GAMES = window._multiGAMES || 10;
    var t1wins = window._multiT1wins || 0;
    var t2wins = window._multiT2wins || 0;
    var draws  = GAMES - t1wins - t2wins;
    var n1 = getTeamName(team1Data), n2 = getTeamName(team2Data);
    var mp1 = window._multiPoss1 || 50;
    title = (isEn
      ? n1+' '+t1wins+'W-'+draws+'D-'+t2wins+'W over '+GAMES+' matches | Possession: '+mp1+'% vs '+(100-mp1)+'% | Football Simulation Lab'
      : n1+' '+t1wins+'勝-'+draws+'分-'+t2wins+'勝（'+GAMES+'試合）| ポゼッション: '+mp1+'% vs '+(100-mp1)+'% | Football Simulation Lab');
  }

  var redditUrl = 'https://www.reddit.com/submit?url=' + encodeURIComponent(siteUrl) + '&title=' + encodeURIComponent(title);
  window.open(redditUrl, '_blank');
}

// ===== AI試合総括（ルールベース）=====
function generateSummary() {
  var btn = document.getElementById('summary-btn');
  var el  = document.getElementById('summary-content');
  btn.disabled = true;
  btn.textContent = t('generatingLabel');
  el.innerHTML = '<span style="color:var(--text-dim);font-size:12px">✨ ' + (window.LANG==='en' ? 'Generating...' : '生成中...') + '</span>';

  // ===== 試合データを集計してWorkerに送る =====
  var t1 = gameState.team1, t2 = gameState.team2;
  var lastRes = chanceResults[chanceResults.length - 1];
  var t1score = lastRes.t1score, t2score = lastRes.t2score;

  var t1atk = 0, t2atk = 0;
  chanceResults.forEach(function(res){ res.scenes.forEach(function(s){ if(s.offence===t1) t1atk++; else t2atk++; }); });
  var t1poss = Math.round(t1atk/(t1atk+t2atk||1)*100);

  var goals = [];
  chanceResults.forEach(function(res){
    res.scenes.forEach(function(s){
      if(s.result==='ゴール！！'){
        var p = s.offence.players[s.offence.lineup[s.ofsPos]];
        var pname = p ? (window.LANG==='en' && p.en_name ? p.en_name : p.long_name||p.name) : '?';
        var tname = window.LANG==='en' ? (s.offence===t1?getTeamName(team1Data):getTeamName(team2Data)) : (s.offence===t1?team1Data.name:team2Data.name);
        goals.push(res.time + ': ' + tname + ' - ' + pname);
      }
    });
  });

  var counter = {};
  chanceResults.forEach(function(res){ res.scenes.forEach(function(s){
    var p = s.offence.players[s.offence.lineup[s.ofsPos]]; if(!p) return;
    var k = (s.offence===t1?'t1':'t2')+'_'+p.name;
    if(!counter[k]) counter[k]={name: window.LANG==='en'&&p.en_name?p.en_name:(p.long_name||p.name), team:s.offence===t1?'t1':'t2', count:0};
    counter[k].count++;
  });});
  var allMvp = Object.values(counter).sort(function(a,b){return b.count-a.count;});
  var t1mvp = allMvp.filter(function(v){return v.team==='t1';}).slice(0,2).map(function(v){return v.name+'('+v.count+')';}).join(', ');
  var t2mvp = allMvp.filter(function(v){return v.team==='t2';}).slice(0,2).map(function(v){return v.name+'('+v.count+')';}).join(', ');

  var patterns = {};
  chanceResults.forEach(function(res){ res.scenes.forEach(function(s){
    if(s.result==='ゴール！！'){ patterns[s.action]=(patterns[s.action]||0)+1; }
  });});
  var topPat = Object.keys(patterns).sort(function(a,b){return patterns[b]-patterns[a];})[0];
  var topPatLabel = topPat ? (getActionLabel(topPat) + '(' + patterns[topPat] + ')') : '';

  // GK名取得
  var t1gkP = t1.players[t1.lineup[0]];
  var t2gkP = t2.players[t2.lineup[0]];
  var t1gkName = t1gkP ? (window.LANG==='en' && t1gkP.en_name ? t1gkP.en_name : t1gkP.name) : '-';
  var t2gkName = t2gkP ? (window.LANG==='en' && t2gkP.en_name ? t2gkP.en_name : t2gkP.name) : '-';

  var matchData = {
    team1:   getTeamName(team1Data),
    team2:   getTeamName(team2Data),
    score1:  t1score,
    score2:  t2score,
    poss1:   t1poss,
    poss2:   100 - t1poss,
    shots1:  t1.shootCounter,
    shots2:  t2.shootCounter,
    saves1:  t1.gkSaveCounter,
    saves2:  t2.gkSaveCounter,
    gk1:     t1gkName,
    gk2:     t2gkName,
    goals:   goals.join(' / ') || (window.LANG==='en' ? 'None' : 'なし'),
    mvp1:    t1mvp,
    mvp2:    t2mvp,
    topPattern: topPatLabel,
  };

  // ===== Worker にストリーミングリクエスト =====
  var WORKER_URL = 'https://footballsimulator.m-iwasaki18.workers.dev';

  fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchData: matchData, lang: window.LANG || 'ja' }),
  }).then(function(res) {
    if (res.status === 429) {
      var msg = window.LANG === 'en' ? '⏳ You have reached the AI summary limit (3/hour). We limit usage to keep AI running. Try again in 1 hour, or support us on Patreon!' : '⏳ AI総括の生成上限（1時間あたり3回）に達しました。生成AIコスト維持のため制限を設けています。1時間後にお試しいただくか、Patreonでのサポートをご検討ください！';
      el.innerHTML = '<span style="color:#e67e00;font-size:12px;line-height:1.7">' + msg + '</span>';
      btn.textContent = window.LANG === 'en' ? '⏳ Limit reached' : '⏳ 上限に達しました';
      btn.disabled = true;
      btn.style.opacity = '0.6';
      return;
    }
    if (!res.ok) {
      return res.text().then(function(body) {
        throw new Error('HTTP ' + res.status + ': ' + body);
      });
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var fullText = '';
    el.innerHTML = '<div style="line-height:1.9;font-size:13px"></div>';
    var textEl = el.querySelector('div');

    function read() {
      reader.read().then(function(chunk) {
        if (chunk.done) {
          btn.textContent = window.LANG === 'en' ? '✅ Generated' : '✅ 生成済み';
          btn.disabled = true;
          btn.style.opacity = '0.6';
          return;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop();
        lines.forEach(function(line) {
          if (!line.startsWith('data: ')) return;
          var data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            var json = JSON.parse(data);
            if (json.type === 'content_block_delta' && json.delta && json.delta.text) {
              fullText += json.delta.text;
              textEl.textContent = fullText;
            }
          } catch(e) {}
        });
        read();
      }).catch(function(err) {
        el.innerHTML = '<span style="color:red;font-size:11px">Stream error: ' + err.message + '</span>';
        btn.textContent = window.LANG === 'en' ? '🔄 Retry' : '🔄 再試行';
        btn.disabled = false;
        btn.style.opacity = '1';
      });
    }
    read();

  }).catch(function(err) {
    if (err.message && err.message.indexOf('429') !== -1) {
      var msg = window.LANG === 'en' ? '⏳ You have reached the AI summary limit (3/hour). We limit usage to keep AI running. Try again in 1 hour, or support us on Patreon!' : '⏳ AI総括の生成上限（1時間あたり3回）に達しました。生成AIコスト維持のため制限を設けています。1時間後にお試しいただくか、Patreonでのサポートをご検討ください！';
      el.innerHTML = '<span style="color:#e67e00;font-size:12px;line-height:1.7">' + msg + '</span>';
      btn.textContent = window.LANG === 'en' ? '⏳ Limit reached' : '⏳ 上限に達しました';
      btn.disabled = true;
      btn.style.opacity = '0.6';
    } else {
      el.innerHTML = '<span style="color:red;font-size:11px">接続エラー: ' + err.message + '</span>';
      btn.textContent = window.LANG === 'en' ? '🔄 Retry' : '🔄 再試行';
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  });
}

// ===== AI総括（10試合モード・ルールベース）=====
function generateMultiSummary(t1wins, t2wins, draws, t1poss, t1shoot, t2shoot, GAMES) {
  var btn = document.getElementById('multi-summary-btn');
  var el  = document.getElementById('multi-summary-content');
  btn.disabled = true;
  btn.textContent = t('generatingLabel');
  el.innerHTML = '<span style="color:var(--text-dim);font-size:12px">✨ ' + (window.LANG==='en' ? 'Generating...' : '生成中...') + '</span>';

  GAMES = GAMES || 10;
  var isEn = window.LANG === 'en';
  var t1n  = getTeamName(team1Data);
  var t2n  = getTeamName(team2Data);
  var t2poss = 100 - t1poss;
  var avgT1shoot = (t1shoot / GAMES).toFixed(1);
  var avgT2shoot = (t2shoot / GAMES).toFixed(1);

  // MVP上位2名
  var mvps = window._multiMvps || [];
  var t1top = mvps.filter(function(v){return v.team===team1Data.name;}).slice(0,2)
              .map(function(v){return (isEn&&v.en_name?v.en_name:v.name)+'('+v.count+')';}).join(', ');
  var t2top = mvps.filter(function(v){return v.team===team2Data.name;}).slice(0,2)
              .map(function(v){return (isEn&&v.en_name?v.en_name:v.name)+'('+v.count+')';}).join(', ');

  // 攻撃パターン
  var patterns = window._multiPatterns || [];
  var topPat = patterns.length ? getActionLabel(patterns[0][0].split(' / ')[1]||patterns[0][0]) + '(' + patterns[0][1] + ')' : '';

  // GK名取得（team1Data/team2Data から取得 ─ gameState は simulateSilent では更新されないため使用不可）
  var t1gkP = team1Data && team1Data.players ? team1Data.players[team1Data.default_lineup[0]] : null;
  var t2gkP = team2Data && team2Data.players ? team2Data.players[team2Data.default_lineup[0]] : null;
  var t1gkName = t1gkP ? (isEn && t1gkP.en_name ? t1gkP.en_name : t1gkP.name) : '-';
  var t2gkName = t2gkP ? (isEn && t2gkP.en_name ? t2gkP.en_name : t2gkP.name) : '-';

  var matchData = {
    team1:      t1n,
    team2:      t2n,
    score1:     t1wins,
    score2:     t2wins,
    draws:      draws,
    games:      GAMES,
    poss1:      t1poss,
    poss2:      t2poss,
    shots1:     parseFloat(avgT1shoot),
    shots2:     parseFloat(avgT2shoot),
    saves1:     ((window._t1saveTotal||0)/GAMES).toFixed(1),
    saves2:     ((window._t2saveTotal||0)/GAMES).toFixed(1),
    gk1:        t1gkName,
    gk2:        t2gkName,
    goals:      t1wins + 'W-' + draws + 'D-' + t2wins + 'L',
    mvp1:       t1top,
    mvp2:       t2top,
    topPattern: topPat,
    isMulti:    true,
  };

  var WORKER_URL = 'https://footballsimulator.m-iwasaki18.workers.dev';

  fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchData: matchData, lang: window.LANG || 'ja' }),
  }).then(function(res) {
    if (res.status === 429) {
      var msg = window.LANG === 'en' ? '⏳ You have reached the AI summary limit (3/hour). We limit usage to keep AI running. Try again in 1 hour, or support us on Patreon!' : '⏳ AI総括の生成上限（1時間あたり3回）に達しました。生成AIコスト維持のため制限を設けています。1時間後にお試しいただくか、Patreonでのサポートをご検討ください！';
      el.innerHTML = '<span style="color:#e67e00;font-size:12px;line-height:1.7">' + msg + '</span>';
      btn.textContent = window.LANG === 'en' ? '⏳ Limit reached' : '⏳ 上限に達しました';
      btn.disabled = true;
      btn.style.opacity = '0.6';
      return;
    }
    if (!res.ok) {
      return res.text().then(function(body) {
        throw new Error('HTTP ' + res.status + ': ' + body);
      });
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var fullText = '';
    el.innerHTML = '<div style="line-height:1.9;font-size:13px"></div>';
    var textEl = el.querySelector('div');

    function read() {
      reader.read().then(function(chunk) {
        if (chunk.done) {
          btn.textContent = window.LANG === 'en' ? '✅ Generated' : '✅ 生成済み';
          btn.disabled = true;
          btn.style.opacity = '0.6';
          return;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop();
        lines.forEach(function(line) {
          if (!line.startsWith('data: ')) return;
          var data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            var json = JSON.parse(data);
            if (json.type === 'content_block_delta' && json.delta && json.delta.text) {
              fullText += json.delta.text;
              textEl.textContent = fullText;
            }
          } catch(e) {}
        });
        read();
      }).catch(function(err) {
        el.innerHTML = '<span style="color:red;font-size:11px">Stream error: ' + err.message + '</span>';
        btn.textContent = window.LANG === 'en' ? '🔄 Retry' : '🔄 再試行';
        btn.disabled = false;
        btn.style.opacity = '1';
      });
    }
    read();

  }).catch(function(err) {
    if (err.message && err.message.indexOf('429') !== -1) {
      var msg = window.LANG === 'en' ? '⏳ You have reached the AI summary limit (3/hour). We limit usage to keep AI running. Try again in 1 hour, or support us on Patreon!' : '⏳ AI総括の生成上限（1時間あたり3回）に達しました。生成AIコスト維持のため制限を設けています。1時間後にお試しいただくか、Patreonでのサポートをご検討ください！';
      el.innerHTML = '<span style="color:#e67e00;font-size:12px;line-height:1.7">' + msg + '</span>';
      btn.textContent = window.LANG === 'en' ? '⏳ Limit reached' : '⏳ 上限に達しました';
      btn.disabled = true;
      btn.style.opacity = '0.6';
    } else {
      el.innerHTML = '<span style="color:red;font-size:11px">接続エラー: ' + err.message + '</span>';
      btn.textContent = window.LANG === 'en' ? '🔄 Retry' : '🔄 再試行';
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  });
}


// ページ初期ロード時に言語を適用
document.addEventListener('DOMContentLoaded', function() {
  // 言語ボタンの初期スタイルをLANGに合わせて設定
  var btnJa = document.getElementById('lang-btn-ja');
  var btnEn = document.getElementById('lang-btn-en');
  var activeStyle  = 'padding:6px 18px;border-radius:20px;border:2px solid #fff;background:#fff;color:var(--japan-blue);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit';
  var inactiveStyle = 'padding:6px 18px;border-radius:20px;border:2px solid rgba(255,255,255,0.5);background:transparent;color:rgba(255,255,255,0.7);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit';
  if (btnJa && btnEn) {
    btnJa.style.cssText = window.LANG === 'ja' ? activeStyle : inactiveStyle;
    btnEn.style.cssText = window.LANG === 'en' ? activeStyle : inactiveStyle;
  }
  applyLang();
});

// ===== 画像シェア機能 =====
function generateShareImage(mode) {
  var isEn = window.LANG === 'en';
  var S = 1080; // canvas size
  var canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  var ctx = canvas.getContext('2d');

  // collect data
  var d = {};
  if (mode === 'single') {
    var t1 = gameState.team1, t2 = gameState.team2;
    var t1atk = 0, t2atk = 0;
    chanceResults.forEach(function(res){ res.scenes.forEach(function(s){ if(s.offence===t1) t1atk++; else t2atk++; }); });
    var poss1 = Math.round(t1atk/(t1atk+t2atk||1)*100);
    d = {
      mode: 'single',
      name1: getTeamName(team1Data), name2: getTeamName(team2Data),
      flag1: team1Data.flag, flag2: team2Data.flag,
      color1: team1Data.team_color, color2: team2Data.team_color,
      score1: parseInt(document.getElementById('result-score1').textContent),
      score2: parseInt(document.getElementById('result-score2').textContent),
      winner: document.getElementById('result-winner').textContent,
      poss1: poss1, poss2: 100 - poss1,
    };
  } else {
    d = {
      mode: 'multi',
      games: window._multiGAMES || 10,
      name1: getTeamName(team1Data), name2: getTeamName(team2Data),
      flag1: team1Data.flag, flag2: team2Data.flag,
      color1: team1Data.team_color, color2: team2Data.team_color,
      t1wins: window._multiT1wins || 0,
      t2wins: window._multiT2wins || 0,
      poss1: window._multiPoss1 || 50,
      poss2: 100 - (window._multiPoss1 || 50),
    };
    d.draws = d.games - d.t1wins - d.t2wins;
  }

  drawShareCanvas(ctx, d, isEn, S);

  var shareText = (d.mode === 'single')
    ? (isEn ? d.name1+' '+d.score1+'-'+d.score2+' '+d.name2 : d.name1+' '+d.score1+'-'+d.score2+' '+d.name2)
    : (isEn ? d.name1+' '+d.t1wins+'W vs '+d.name2+' '+d.t2wins+'W ('+d.games+' matches)' : d.name1+' '+d.t1wins+'勝 vs '+d.name2+' '+d.t2wins+'勝（'+d.games+'試合）');
  var shareUrl = 'https://footballsim.github.io/football-sim/';

  canvas.toBlob(function(blob) {
    var file = new File([blob], 'football-sim-result.png', { type: 'image/png' });

    // スマホ判定（タッチデバイス）
    var isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);

    // Web Share API（スマホのみ）
    if (isMobile && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({
        files: [file],
        title: 'Football Simulation Lab',
        text: shareText + '\n' + shareUrl,
      }).catch(function(err) {
        if (err.name !== 'AbortError') {
          // 共有キャンセル以外のエラーはダウンロードにフォールバック
          _downloadCanvas(canvas);
        }
      });
    } else {
      // Web Share API非対応（PC等）→ ダウンロード
      _downloadCanvas(canvas);
    }
  }, 'image/png');
}

function _downloadCanvas(canvas) {
  var link = document.createElement('a');
  link.download = 'football-sim-result.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function drawShareCanvas(ctx, d, isEn, S) {
  var BG      = '#0d1b3e';
  var GOLD    = '#f0c040';
  var CYAN    = '#7ec8f0';
  var DIMWHITE= 'rgba(255,255,255,0.3)';
  var SUBTEXT = '#8899aa';

  // helpers
  function hex2rgb(hex) {
    var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return {r:r,g:g,b:b};
  }
  function colorAlpha(hex, a) {
    var c = hex2rgb(hex); return 'rgba('+c.r+','+c.g+','+c.b+','+a+')';
  }
  function roundRect(ctx, x, y, w, h, r, fill) {
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
  }
  function textCenter(ctx, txt, x, y, font, color, maxW) {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'center';
    if (maxW) ctx.fillText(txt, x, y, maxW); else ctx.fillText(txt, x, y);
  }
  function textLeft(ctx, txt, x, y, font, color, maxW) {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'left';
    if (maxW) ctx.fillText(txt, x, y, maxW); else ctx.fillText(txt, x, y);
  }

  // BG
  ctx.fillStyle = BG; ctx.fillRect(0, 0, S, S);

  // decorative circles
  ctx.beginPath(); ctx.arc(-80, -80, 380, 0, Math.PI*2);
  ctx.fillStyle = colorAlpha(d.color1, 0.10); ctx.fill();
  ctx.beginPath(); ctx.arc(S+80, S+80, 380, 0, Math.PI*2);
  ctx.fillStyle = colorAlpha(d.color2, 0.10); ctx.fill();

  // INSIGHT logic (shared)
  function buildInsightLines(d, isEn) {
    var n1 = d.name1, n2 = d.name2;
    var p1 = d.poss1, p2 = d.poss2;
    var lines = [];
    if (d.mode === 'single') {
      var s1 = d.score1, s2 = d.score2;
      var winner = s1>s2?n1:s2>s1?n2:null, loser = s1>s2?n2:s2>s1?n1:null;
      var posLead = p1>=p2?n1:n2, posTrail = p1>=p2?n2:n1;
      if (!winner) {
        if (isEn) {
          lines = [n1+' '+s1+'-'+s2+' '+n2+'. A draw.',
                   'Possession: '+n1+' '+p1+'% — '+n2+' '+p2+'%.',
                   Math.abs(p1-p2)<=5 ? 'Balanced from start to finish.' : posLead+' had the ball. Neither had the edge.',
                   Math.abs(p1-p2)<=5 ? 'Could either team have taken it?' : 'Does possession really matter here?'];
        } else {
          lines = [n1+' '+s1+'-'+s2+' '+n2+'。引き分けに終わった。',
                   'ポゼッション：'+n1+' '+p1+'% — '+n2+' '+p2+'%。',
                   Math.abs(p1-p2)<=5 ? '終始均衡した展開となった。' : posLead+'がボールを握ったが、決着はつかなかった。',
                   Math.abs(p1-p2)<=5 ? 'どちらが勝ってもおかしくなかった。' : 'このレベルでポゼッションは意味を持つのか？'];
        }
      } else if (posLead !== winner) {
        if (isEn) {
          lines = [winner+' won '+s1+'-'+s2+'.',
                   posLead+' had '+Math.max(p1,p2)+'% possession.',
                   loser+' had the ball. '+winner+' had the goals.',
                   'Is this a blueprint for beating '+posLead+'?'];
        } else {
          lines = [winner+'が'+s1+'-'+s2+'で勝利。',
                   posLead+'がポゼッション'+Math.max(p1,p2)+'%を記録。',
                   loser+'がボールを保持し、'+winner+'がゴールを奪った。',
                   posLead+'攻略のヒントがここにある？'];
        }
      } else {
        if (isEn) {
          lines = [winner+' won '+s1+'-'+s2+'.',
                   winner+' controlled both ball and result.',
                   'Possession '+Math.max(p1,p2)+'% — and it showed.',
                   'Can '+loser+' find a different approach?'];
        } else {
          lines = [winner+'が'+s1+'-'+s2+'で勝利。',
                   winner+'がボールも結果も制した。',
                   'ポゼッション'+Math.max(p1,p2)+'%——それが結果に直結した。',
                   loser+'は別のアプローチを見つけられるか？'];
        }
      }
    } else {
      var t1w=d.t1wins, t2w=d.t2wins, dr=d.draws, gm=d.games;
      var fav=t1w>t2w?n1:t2w>t1w?n2:null, favL=t1w>t2w?n2:t2w>t1w?n1:null;
      var favW=Math.max(t1w,t2w), favR=Math.round(favW/gm*100);
      var rDiff=Math.abs(Math.round(t1w/gm*100)-Math.round(t2w/gm*100));
      var pLead=p1>=p2?n1:n2, pTrail=p1>=p2?n2:n1;
      if (isEn) {
        lines.push(n1+' '+t1w+'W — Draw '+dr+' — '+n2+' '+t2w+'W.');
        lines.push('Avg possession: '+n1+' '+p1+'% vs '+n2+' '+p2+'%.');
        if (rDiff<10) { lines.push('Impossible to call. Either team can win.'); lines.push('Who takes the edge in the next series?'); }
        else if (fav && pLead!==fav) { lines.push(pTrail+' wins more with less of the ball.'); lines.push('Is efficiency '+fav+'\'s secret weapon?'); }
        else if (fav && favW>=gm*0.6) { lines.push(fav+' wins '+favR+'% of the time. Dominant.'); lines.push('Can '+favL+' ever close this gap?'); }
        else if (fav) { lines.push(fav+' has the edge - but it\'s not settled.'); lines.push('What gives '+fav+' the advantage?'); }
        else { lines.push('Perfectly balanced over '+gm+' simulations.'); lines.push('Which team has the higher ceiling?'); }
      } else {
        lines.push(n1+' '+t1w+'勝 — 引き分け '+dr+' — '+n2+' '+t2w+'勝。');
        lines.push('平均ポゼッション：'+n1+' '+p1+'% vs '+n2+' '+p2+'%。');
        if (rDiff<10) { lines.push('勝敗を予測するのは不可能に近い。'); lines.push('次のシリーズで優位に立つのはどちらか？'); }
        else if (fav && pLead!==fav) { lines.push(pTrail+'はボールを持たずして勝ちを積み重ねた。'); lines.push(fav+'の効率的なサッカーが武器となっているのか？'); }
        else if (fav && favW>=gm*0.6) { lines.push(fav+'が'+favR+'%の確率で勝利。圧倒的だ。'); lines.push(favL+'はこの差を埋められるのか？'); }
        else if (fav) { lines.push(fav+'が優位に立つが、まだ決着はついていない。'); lines.push(fav+'のアドバンテージの源泉はどこにある？'); }
        else { lines.push(gm+'試合を通じて完璧な均衡が保たれた。'); lines.push('より高いポテンシャルを持つのはどちらか？'); }
      }
    }
    return lines;
  }

  var insightLines = buildInsightLines(d, isEn);
  var cx = S/2;

  if (d.mode === 'single') {
    var s1=d.score1, s2=d.score2;
    var t1Win=s1>s2, t2Win=s2>s1;
    var n1Col = t1Win ? CYAN : 'rgba(122,180,220,0.5)';
    var n2Col = t2Win ? '#ff5555' : colorAlpha(d.color2, 0.6);

    // ① タグ
    roundRect(ctx, cx-150, 60, 300, 40, 20, 'rgba(255,255,255,0.10)');
    textCenter(ctx, 'MATCH SIMULATION', cx, 87, '700 22px Arial', '#aabbcc');

    // ② チーム名（左右に分けて上部に配置）
    ctx.font = t1Win?'700 48px Arial':'700 36px Arial';
    ctx.fillStyle = n1Col; ctx.textAlign = 'right';
    ctx.fillText(d.flag1+' '+d.name1, cx-60, 185, 400);
    ctx.font = t2Win?'700 48px Arial':'700 36px Arial';
    ctx.fillStyle = n2Col; ctx.textAlign = 'left';
    ctx.fillText(d.flag2+' '+d.name2, cx+60, 185, 400);

    // ③ スコア
    ctx.font = '900 180px Arial'; ctx.fillStyle = 'white'; ctx.textAlign = 'center';
    ctx.fillText(s1+'-'+s2, cx, 370);

    // ④ 結果バッジ
    roundRect(ctx, cx-220, 390, 440, 56, 28, 'rgba(255,255,255,0.10)');
    textCenter(ctx, d.winner, cx, 426, '700 28px Arial', 'white');

    // ⑤ ポゼッション（ラベル上・数字バー外側）
    var barW=760, barX=(S-barW)/2, barY=495, barH=14;
    textCenter(ctx, isEn?'Possession':'ポゼッション', cx, 472, '400 22px Arial', SUBTEXT);
    textCenter(ctx, d.poss1+'%', barX-44, barY+12, '700 28px Arial', CYAN);
    textCenter(ctx, d.poss2+'%', barX+barW+44, barY+12, '700 28px Arial', d.color2);
    roundRect(ctx, barX, barY, barW, barH, 7, d.color2);
    roundRect(ctx, barX, barY, barW*d.poss1/100, barH, 7, CYAN);

    // ⑥ INSIGHTボックス
    roundRect(ctx, 60, 548, S-120, 404, 16, 'rgba(255,255,255,0.07)');
    textCenter(ctx, 'INSIGHT', cx, 590, '700 24px Arial', GOLD);
    ctx.font = '400 28px Arial'; ctx.fillStyle = '#ddeeff'; ctx.textAlign = 'left';
    insightLines.forEach(function(line, i) { ctx.fillText(line, 90, 638+i*56, S-180); });

  } else {
    // MULTI
    var t1w=d.t1wins, t2w=d.t2wins, gm=d.games;
    var t1R=Math.round(t1w/gm*100), t2R=Math.round(t2w/gm*100);
    var t1Win=t1w>t2w, t2Win=t2w>t1w;
    var c1=CYAN, c2=t2Win?'#ff5555':colorAlpha(d.color2,0.7);
    var n1Col=t1Win?CYAN:'rgba(122,180,220,0.5)';
    var n2Col=t2Win?'#ff5555':colorAlpha(d.color2,0.6);

    // ① タグ
    ctx.font = '700 20px Arial';
    var tagTxt = gm+'-MATCH SIMULATION';
    var tagW = ctx.measureText(tagTxt).width + 60;
    roundRect(ctx, cx-tagW/2, 50, tagW, 38, 19, 'rgba(255,255,255,0.10)');
    textCenter(ctx, tagTxt, cx, 76, '700 20px Arial', '#aabbcc');

    // ② チーム名（左右）
    ctx.font = t1Win?'700 42px Arial':'700 32px Arial';
    ctx.fillStyle=n1Col; ctx.textAlign='right';
    ctx.fillText(d.flag1+' '+d.name1, cx-50, 160, 420);
    ctx.font='700 28px Arial'; ctx.fillStyle='#555'; ctx.textAlign='center';
    ctx.fillText('vs', cx, 160);
    ctx.font = t2Win?'700 42px Arial':'700 32px Arial';
    ctx.fillStyle=n2Col; ctx.textAlign='left';
    ctx.fillText(d.flag2+' '+d.name2, cx+50, 160, 420);

    // ③ 勝利数
    ctx.font=t1Win?'900 140px Arial':'900 100px Arial';
    ctx.fillStyle=c1; ctx.textAlign='center';
    ctx.fillText(t1w, cx-240, 340);
    ctx.font=t2Win?'900 140px Arial':'900 100px Arial';
    ctx.fillStyle=c2; ctx.textAlign='center';
    ctx.fillText(t2w, cx+240, 340);
    textCenter(ctx, 'W ('+t1R+'%)', cx-240, 386, '400 26px Arial', SUBTEXT);
    textCenter(ctx, 'W ('+t2R+'%)', cx+240, 386, '400 26px Arial', SUBTEXT);

    // ④ ポゼッション（ラベル上・数字外側）
    var barW=740, barX=(S-barW)/2, barY=432, barH=12;
    textCenter(ctx, isEn?'Possession':'ポゼッション', cx, 416, '400 22px Arial', SUBTEXT);
    textCenter(ctx, d.poss1+'%', barX-44, barY+10, '700 26px Arial', CYAN);
    textCenter(ctx, d.poss2+'%', barX+barW+44, barY+10, '700 26px Arial', d.color2);
    roundRect(ctx, barX, barY, barW, barH, 6, d.color2);
    roundRect(ctx, barX, barY, barW*d.poss1/100, barH, 6, CYAN);

    // ⑤ INSIGHTボックス
    roundRect(ctx, 60, 482, S-120, 470, 16, 'rgba(255,255,255,0.07)');
    textCenter(ctx, 'INSIGHT', cx, 524, '700 24px Arial', GOLD);
    ctx.font='400 26px Arial'; ctx.fillStyle='#ddeeff'; ctx.textAlign='left';
    insightLines.forEach(function(line, i) { ctx.fillText(line, 90, 572+i*54, S-180); });
  }

  // watermark
  textCenter(ctx, 'Football Simulation Lab', S-180, S-28, '400 22px Arial', DIMWHITE);
}


function getPatreonBannerHtml(isEn) {
  var ja = '<div style="margin:16px 0;padding:16px;background:#fff8f0;border:1px solid #f96854;border-radius:12px;text-align:center">'
    + '<div style="font-size:13px;color:#555;line-height:1.8;margin-bottom:10px">'
    + '日本代表の試合、いかがでしたか？<br>'
    + 'W杯シミュレーターを開発中です。応援いただけると嬉しいです！'
    + '</div>'
    + '<a href="https://www.patreon.com/cw/FootballSimulationLab" target="_blank" rel="noopener" style="display:inline-block;background:#f96854;color:white;font-weight:700;font-size:14px;padding:10px 28px;border-radius:24px;text-decoration:none">→ Support on Patreon</a>'
    + '</div>';
  var en = '<div style="margin:16px 0;padding:16px;background:#fff8f0;border:1px solid #f96854;border-radius:12px;text-align:center">'
    + '<div style="font-size:13px;color:#555;line-height:1.8;margin-bottom:10px">'
    + 'How was the match?<br>'
    + "We're working on a full W-Cup simulator — your support makes it happen!"
    + '</div>'
    + '<a href="https://www.patreon.com/cw/FootballSimulationLab" target="_blank" rel="noopener" style="display:inline-block;background:#f96854;color:white;font-weight:700;font-size:14px;padding:10px 28px;border-radius:24px;text-decoration:none">→ Support on Patreon</a>'
    + '</div>';
  return isEn ? en : ja;
}

