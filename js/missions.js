/* ===========================================================================
 * missions.js — 監督ミッション（デイリー／ウィークリー／累計）
 *
 * 1日1試合を前提に、デイリーは「その日の1試合」または「試合前の準備1回」
 * だけで完結する。週次・累計は確定した試合結果から決定論で積み上げる。
 * 保存は manager.missions の任意フィールドのみ。旧セーブは自動補完する。
 * ========================================================================== */
(function (global) {
  'use strict';

  var H = null;
  var MEMO = { daily: null, weekly: null, career: null, seenRound: null };
  var DAILY = [
    { id: 'daily_points', ja: '勝点を1以上取る', en: 'Earn at least one point', kind: 'result', target: 1 },
    { id: 'daily_score', ja: '1点以上決める', en: 'Score at least one goal', kind: 'goals', target: 1 },
    { id: 'daily_clean', ja: '失点を0に抑える', en: 'Keep a clean sheet', kind: 'clean', target: 1 },
    { id: 'daily_prepare', ja: '試合前の準備を1回選ぶ', en: 'Choose one pre-match preparation', kind: 'prepare', target: 1 }
  ];
  var WEEKLY = [
    { id: 'weekly_matches', ja: '3試合を指揮する', en: 'Manage three matches', kind: 'matches', target: 3 },
    { id: 'weekly_points', ja: '勝点5を獲得する', en: 'Earn five points', kind: 'points', target: 5 },
    { id: 'weekly_goals', ja: '5ゴール決める', en: 'Score five goals', kind: 'goals', target: 5 },
    { id: 'weekly_clean', ja: '2試合を完封する', en: 'Keep two clean sheets', kind: 'clean', target: 2 },
    { id: 'weekly_prepare', ja: '準備を3回選ぶ', en: 'Choose three preparations', kind: 'prepare', target: 3 }
  ];
  var CAREER = [
    { id: 'career_matches', ja: '通算10試合を指揮', en: 'Manage 10 career matches', kind: 'matches', target: 10 },
    { id: 'career_wins', ja: '通算5勝を達成', en: 'Win five career matches', kind: 'wins', target: 5 },
    { id: 'career_goals', ja: '通算20ゴールを達成', en: 'Score 20 career goals', kind: 'goals', target: 20 },
    { id: 'career_clean', ja: '通算5完封を達成', en: 'Keep five career clean sheets', kind: 'clean', target: 5 }
  ];

  function t(ja, en) { return global && global.LANG === 'en' ? en : ja; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function today() { return H && H.today ? H.today() : new Date().toISOString().slice(0, 10); }
  function weekKey(ds) {
    var d = new Date(String(ds || today()) + 'T12:00:00');
    var day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d.toISOString().slice(0, 10);
  }
  function state() { try { return H && H.state ? H.state() : null; } catch (e) { return null; } }
  function save() { try { if (H && H.save) H.save(); } catch (e) {} }
  function store() {
    var s = state(), m = s && s.manager;
    if (!m) return MEMO;
    if (!m.missions) m.missions = {};
    if (!m.missions.career) m.missions.career = { matches: 0, wins: 0, goals: 0, clean: 0, prepare: 0 };
    return m.missions;
  }
  function hash(s) { var n = 0, i; for (i = 0; i < s.length; i++) n = ((n << 5) - n + s.charCodeAt(i)) | 0; return Math.abs(n); }
  function find(defs, id) { for (var i = 0; i < defs.length; i++) if (defs[i].id === id) return defs[i]; return defs[0]; }
  function mission(def, value, done) { return { id: def.id, value: value || 0, target: def.target, done: !!done }; }
  function ensure() {
    var m = store(), d = today(), w = weekKey(d), changed = false;
    if (!m.daily || m.daily.day !== d) {
      var di = hash(d + ':' + ((state() && state().round) || 0)) % DAILY.length;
      m.daily = { day: d, mission: mission(DAILY[di], 0, false) }; changed = true;
    }
    if (!m.weekly || m.weekly.week !== w) {
      var wi = hash(w + ':' + ((state() && state().season) || 1)) % WEEKLY.length;
      m.weekly = { week: w, mission: mission(WEEKLY[wi], 0, false), matches: [], prepareRounds: [], prepare: 0 }; changed = true;
    }
    if (!m.career) { m.career = { matches: 0, wins: 0, goals: 0, clean: 0, prepare: 0 }; changed = true; }
    if (!m.weekly.prepareRounds) m.weekly.prepareRounds = [];
    if (changed) save();
    return m;
  }
  function valueFor(kind, summary) {
    if (kind === 'result') return summary.res === 'W' ? 3 : summary.res === 'D' ? 1 : 0;
    if (kind === 'goals') return summary.ms || 0;
    if (kind === 'clean') return summary.os === 0 ? 1 : 0;
    if (kind === 'wins') return summary.res === 'W' ? 1 : 0;
    if (kind === 'matches') return 1;
    if (kind === 'points') return summary.res === 'W' ? 3 : summary.res === 'D' ? 1 : 0;
    return 0;
  }
  function progressFromState() {
    var s = state(), m = ensure();
    if (!s || !s.lastResult || !s.lastResult.mine) return m;
    var lr = s.lastResult, round = lr.round;
    if (m.seenRound === round) return m;
    m.seenRound = round;
    var x = lr.mine, summary = { res: x.res, ms: x.ms, os: x.os };
    var d = find(DAILY, m.daily.mission.id);
    if (d.kind !== 'prepare') { m.daily.mission.value = Math.min(d.target, valueFor(d.kind, summary)); m.daily.mission.done = m.daily.mission.value >= d.target; }
    var w = find(WEEKLY, m.weekly.mission.id);
    if (m.weekly.matches.indexOf(round) < 0) {
      m.weekly.matches.push(round);
      m.weekly.mission.value = Math.min(w.target, (m.weekly.mission.value || 0) + valueFor(w.kind, summary));
      if (w.kind === 'matches') m.weekly.mission.value = Math.min(w.target, m.weekly.matches.length);
      m.weekly.mission.done = m.weekly.mission.value >= w.target;
      m.career.matches += 1;
      m.career.wins += x.res === 'W' ? 1 : 0;
      m.career.goals += x.ms || 0;
      m.career.clean += x.os === 0 ? 1 : 0;
    }
    save();
    return m;
  }
  function onPrepare(round) {
    var m = ensure(), d = find(DAILY, m.daily.mission.id), w = find(WEEKLY, m.weekly.mission.id);
    m.career.prepare += 1; m.weekly.prepare += 1;
    if (d.kind === 'prepare') { m.daily.mission.value = 1; m.daily.mission.done = true; }
    if (w.kind === 'prepare' && m.weekly.prepareRounds.indexOf(round) < 0) {
      m.weekly.prepareRounds.push(round);
      m.weekly.mission.value = Math.min(w.target, m.weekly.prepareRounds.length);
      m.weekly.mission.done = m.weekly.mission.value >= w.target;
    }
    save();
  }
  function attach(host) { H = host || null; return API; }
  function summary() { var m = progressFromState(); return { daily: m.daily, weekly: m.weekly, career: m.career, dailyDef: find(DAILY, m.daily.mission.id), weeklyDef: find(WEEKLY, m.weekly.mission.id) }; }
  function row(label, def, item) { return '<div class="lg-mission-row"><span class="lg-mission-kind">' + label + '</span><span class="lg-mission-name">' + esc(t(def.ja, def.en)) + '</span><b>' + item.value + '/' + item.target + (item.done ? ' ✓' : '') + '</b></div>'; }
  function hubRow() { var x = summary(); return '<div class="lg-missions-mini" role="button" tabindex="0" onclick="managerMissionsOpen()"><div class="lg-missions-mini-head"><span>🎯 ' + t('監督ミッション', 'Manager missions') + '</span><i>' + t('詳細 ▶', 'Details ▶') + '</i></div>' + row(t('今日', 'Today'), x.dailyDef, x.daily.mission) + row(t('今週', 'This week'), x.weeklyDef, x.weekly.mission) + '</div>'; }
  function open() {
    var x = summary(), c = document.createElement('div'); c.id = 'lg-missions-overlay'; c.className = 'lg-sh-ovl';
    c.innerHTML = '<div class="lg-sh-ovl-panel lg-missions-panel"><div class="lg-sh-ovl-head"><span>🎯 ' + t('監督ミッション', 'Manager missions') + '</span><button type="button" class="lg-se-ovl-x" onclick="managerMissionsClose()">✕</button></div><div class="lg-sh-ovl-body">' + row(t('デイリー', 'Daily'), x.dailyDef, x.daily.mission) + row(t('ウィークリー', 'Weekly'), x.weeklyDef, x.weekly.mission) + '<div class="lg-mission-section">' + t('累計ミッション', 'Career missions') + '</div>' + CAREER.map(function (d) { var v = x.career[d.kind] || 0; return '<div class="lg-mission-row"><span class="lg-mission-kind">' + t('累計', 'Career') + '</span><span class="lg-mission-name">' + esc(t(d.ja, d.en)) + '</span><b>' + Math.min(v, d.target) + '/' + d.target + (v >= d.target ? ' ✓' : '') + '</b></div>'; }).join('') + '</div><button type="button" class="lg-sh-ovl-ok" onclick="managerMissionsClose()">' + t('監督室へ戻る', 'Back to office') + '</button></div>';
    document.body.appendChild(c);
  }
  function close() { var e = document.getElementById('lg-missions-overlay'); if (e) e.remove(); }
  var API = { attach: attach, ensure: ensure, summary: summary, onPrepare: onPrepare, hubRow: hubRow, open: open, close: close, daily: DAILY, weekly: WEEKLY, career: CAREER };
  global.ManagerMissions = API;
  global.managerMissionsOpen = open;
  global.managerMissionsClose = close;
  global.managerMissionsHubRow = hubRow;
  if (global._leagueMissionHost) attach(global._leagueMissionHost);
})(window);
