/**
 * events.js — 試合エンジンの「型付きイベント列」seam（P1 / BACKLOG T-01〜T-03）。
 *
 * 目的:
 *   描画・AI・統計が購読する単一の構造化ストリームを提供する。エンジン本体
 *   （simulateChance / デュエル解決 / select*Position / selectAction）には一切
 *   手を入れず、その「出力（chanceResults / simulateChance の戻り値）を読み取って」
 *   Event[] へ正規化する純関数だけを置く層。
 *
 * 重要（ガードレール）:
 *   - これは購読層であって判定層ではない。simulateChance を呼ぶことも、その出力を
 *     書き換えることもしない。matchToEvents は与えられた結果を読むだけ。
 *   - card / injury / sub は語彙として定義するが、現エンジンは未発生のため emit しない
 *     （Sprint 2 で実装）。今 emit するのは現出力から導出できるものだけ:
 *     kickoff / chance / duel / shot / goal / save / foul / HT / FT。
 *
 * ロード順: players.js → simulate.js → events.js（simulate.js の後・narration.js より前）。
 *   ES module ではなくグローバル <script> 運用なので、ここで定義する関数・定数は
 *   グローバルスコープに公開される。
 */

/* ── T-01 イベント型の語彙 ──────────────────────────────────────────
 * 全イベントは少なくとも { t, chance, minute, team } を持つ。
 *   t      … 下記 EVENT_TYPES のいずれか
 *   chance … チャンス番号（chanceResults の index）。kickoff/HT/FT は null。
 *   minute … 試合の分（number）。確定できない場合は null。
 *   team   … 'home' | 'away' | null（home=gs.team1, away=gs.team2）
 */
const EVENT_TYPES = Object.freeze({
  KICKOFF: 'kickoff', // 試合開始
  CHANCE:  'chance',  // 1 チャンスの開始（区切り）
  DUEL:    'duel',    // 攻守の 1 対 1 解決（成功/失敗/カウンター/ブロック）
  SHOT:    'shot',    // シュート試行
  GOAL:    'goal',    // 得点
  SAVE:    'save',    // GK セーブ
  FOUL:    'foul',    // ファウル（→ セットプレー）
  CARD:    'card',    // カード（※現エンジン未発生・emit しない）
  INJURY:  'injury',  // 負傷（※現エンジン未発生・emit しない）
  SUB:     'sub',     // 交代（※ライブ交代は別機構。matchToEvents では emit しない）
  HT:      'ht',      // ハーフタイム
  FT:      'ft',      // 試合終了
});

// scene.result の値（現エンジンの語彙）。emit 側の分類で使用。
const _RESULT = Object.freeze({
  SUCCESS:   '成功',
  FAIL:      '失敗',
  COUNTER:   'カウンター',
  FOUL:      'ファール',
  GOAL:      'ゴール！！',
  SAVE:      'GK防いだ！',
  OFF_TARGET:'枠を外した！',
  BLOCK:     'ブロック',
});

/**
 * 局所化された time 文字列（例 "前半 23分" / "1st 23min" / "後半 90+分"）から
 * 試合分を取り出す。最初に現れる整数を採用（"45+" → 45, "90+" → 90 等）。
 * 数字が無い文字列（後半ロスタイム等）は null。
 * @param {string} time
 * @returns {number|null}
 */
function parseMinute(time) {
  if (typeof time !== 'string') return null;
  const m = time.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/**
 * チーム参照 → 'home' | 'away' | null。
 * home/away は gs.team1 / gs.team2（buildTeam が返すチームオブジェクト）の参照。
 */
function _sideOf(teamObj, home, away) {
  if (home && teamObj === home) return 'home';
  if (away && teamObj === away) return 'away';
  return null;
}

// シーンの攻撃側の「実行選手」（得点者・シュート者・パサー）を取り出す。
function _ofsPlayer(scene) {
  if (!scene || !scene.offence || !scene.offence.lineup || !scene.offence.players) return null;
  return scene.offence.players[scene.offence.lineup[scene.ofsPos]] || null;
}
// シーンの守備側の対面選手（GK / 寄せた DF）を取り出す。
function _dfsPlayer(scene) {
  if (!scene || !scene.defence || !scene.defence.lineup || !scene.defence.players) return null;
  return scene.defence.players[scene.defence.lineup[scene.dfsPos]] || null;
}
// 守備側 GK（lineup 位置 0）を取り出す。セーブの帰属に使う。
// 注: ミドルシュートのセーブは scene.dfsPos がブロックした守備選手のまま（≠0）だが、
//     セーブ判定自体は GK(position 0)で計算される（simulate.js）。そのため keeper は
//     常に position 0 から取る（中央/サイドは元々 dfsPos=0 なので結果不変）。
function _gkPlayer(scene) {
  if (!scene || !scene.defence || !scene.defence.lineup || !scene.defence.players) return null;
  return scene.defence.players[scene.defence.lineup[0]] || null;
}
// クロス/セットプレー由来の得点ならアシスト者（crossPos が ofsPos と別の時）。
function _assistPlayer(scene) {
  if (!scene || scene.crossPos === undefined || scene.crossPos === scene.ofsPos) return null;
  if (!scene.offence || !scene.offence.lineup || !scene.offence.players) return null;
  return scene.offence.players[scene.offence.lineup[scene.crossPos]] || null;
}

function _playerName(p) { return p ? (p.name || null) : null; }

/* ── T-02 正規化アダプタ（1 シーン → イベント群） ────────────────── */

/**
 * 1 シーンを 0 個以上の Event に正規化する（純関数・副作用なし）。
 *   - 全シーンは攻守の 1 解決なので、まず duel を 1 件 emit（result でカテゴリ分け）。
 *   - シュート系シーン（scenario が 'シュート'/'ミドルシュート'、または midshot ブロック）
 *     は加えて shot を emit。枠内のうちゴール=goal、セーブ=save を続けて emit。
 *   - ファウルは foul を emit。
 *
 * @param {object} scene  simulateChance が生成した scene
 * @param {object} meta   { chance, minute, home, away }
 * @returns {Array<object>} Event[]
 */
function sceneToEvents(scene, meta) {
  if (!scene) return [];
  const { chance, minute, home, away } = meta;
  const out = [];
  const offSide = _sideOf(scene.offence, home, away);
  const defSide = _sideOf(scene.defence, home, away);

  const base = { chance, minute };
  const ofsP = _ofsPlayer(scene);
  const dfsP = _dfsPlayer(scene);

  // PK は常にシュート（ゴール/セーブ/枠外）。CK は「合わせた」時だけシュート（クリア=失敗は duel）。
  const _shotResults = scene.result === _RESULT.GOAL || scene.result === _RESULT.SAVE ||
    scene.result === _RESULT.OFF_TARGET || scene.result === _RESULT.BLOCK;
  const isShotScene =
    scene.scenario === 'シュート' ||
    scene.scenario === 'ミドルシュート' ||
    scene.scenario === 'ペナルティキック' ||
    (scene.scenario === 'コーナーキック' && _shotResults);
  const isMidBlock = scene.scenario === 'ミドルシュート' && scene.result === _RESULT.BLOCK;

  // (a) duel — 攻守の解決。シュートシーンの最終解決（ゴール/セーブ/枠外）は
  //     shot/goal/save で表現するので duel からは除外する。ただし「ブロック」は
  //     接触の解決なので duel として残す（shot も別途 emit）。
  const emitDuelFor = !isShotScene || isMidBlock;
  if (emitDuelFor) {
    out.push({
      t: EVENT_TYPES.DUEL,
      ...base,
      team: offSide,                  // duel は攻撃側視点（offence が主体）
      area: scene.area,
      ofsPos: scene.ofsPos,
      dfsPos: scene.dfsPos,
      action: scene.action,
      scenario: scene.scenario,
      result: scene.result,           // 成功/失敗/カウンター/ブロック/ファール
      ofsTeam: offSide,
      dfsTeam: defSide,
      ofsPlayer: _playerName(ofsP),
      dfsPlayer: _playerName(dfsP),
    });
  }

  // (b) foul — ファウル（セットプレーへ移行する接触）。
  if (scene.result === _RESULT.FOUL) {
    out.push({
      t: EVENT_TYPES.FOUL,
      ...base,
      team: defSide,                  // ファウルを犯したのは守備側
      area: scene.area,
      byPlayer: _playerName(dfsP),    // 反則者（寄せた守備選手）
      againstTeam: offSide,
      againstPlayer: _playerName(ofsP),
    });
  }

  // (c) shot / goal / save — シュート系シーン。
  if (isShotScene) {
    const onTarget = scene.result === _RESULT.GOAL || scene.result === _RESULT.SAVE;
    const blocked = scene.result === _RESULT.BLOCK;
    out.push({
      t: EVENT_TYPES.SHOT,
      ...base,
      team: offSide,
      area: scene.area,
      ofsPos: scene.ofsPos,
      action: scene.action,           // 中央/サイドからシュート, ミドルシュート, ボレー…
      shooter: _playerName(ofsP),
      onTarget,
      blocked,
      result: scene.result,           // ゴール！！/GK防いだ！/枠を外した！/ブロック
    });

    if (scene.result === _RESULT.GOAL) {
      out.push({
        t: EVENT_TYPES.GOAL,
        ...base,
        team: offSide,
        scorer: _playerName(ofsP),
        assist: _playerName(_assistPlayer(scene)),
        scene,                        // 元 scene 参照（描画/実況が詳細を引ける）
      });
    } else if (scene.result === _RESULT.SAVE) {
      out.push({
        t: EVENT_TYPES.SAVE,
        ...base,
        team: defSide,                // セーブは守備側 GK
        keeper: _playerName(_gkPlayer(scene)), // 常に position 0（ミドルセーブの誤帰属を防ぐ）
        shooter: _playerName(ofsP),
        fromTeam: offSide,
      });
    }
    // 枠外（OFF_TARGET）/ ブロック（BLOCK）は shot のみで表現（goal/save は出さない）。
  }

  return out;
}

/* ── T-02 正規化アダプタ（試合全体 → Event[]） ──────────────────── */

/**
 * 試合結果を Event[] へ正規化する純関数。エンジンは呼ばない（読むだけ）。
 *
 * @param {Array<object>} chanceResults  simulateChance の戻り値の配列（startGame が事前計算するもの）
 * @param {object} [opts]
 *   @param {object} [opts.home]  home チームオブジェクト（= gs.team1）。team 解決に使う。
 *   @param {object} [opts.away]  away チームオブジェクト（= gs.team2）。
 *   @param {number} [opts.htChance]  ハーフタイム直前のチャンス index（既定 7 = 前半ロスタイム）。
 *   @param {boolean} [opts.kickoff=true]  先頭に kickoff、末尾に FT を付与するか。
 * @returns {Array<object>} 時系列の Event[]
 */
function matchToEvents(chanceResults, opts) {
  opts = opts || {};
  const home = opts.home || null;
  const away = opts.away || null;
  const htChance = (opts.htChance !== undefined) ? opts.htChance : 7;
  const withFrame = opts.kickoff !== false;

  const events = [];
  if (!Array.isArray(chanceResults)) return events;

  if (withFrame) {
    events.push({ t: EVENT_TYPES.KICKOFF, chance: null, minute: 0, team: null });
  }

  let htEmitted = false;
  let lastT1 = 0, lastT2 = 0;

  for (let ci = 0; ci < chanceResults.length; ci++) {
    const res = chanceResults[ci];
    if (!res) continue;
    const minute = parseMinute(res.time);

    // ハーフタイム: htChance を処理し終えた直後に 1 度だけ。
    if (withFrame && !htEmitted && ci > htChance) {
      events.push({ t: EVENT_TYPES.HT, chance: null, minute: 45, team: null,
                    homeScore: lastT1, awayScore: lastT2 });
      htEmitted = true;
    }

    // chance 区切り。
    events.push({
      t: EVENT_TYPES.CHANCE,
      chance: ci,
      minute,
      team: null,
      timeLabel: res.time,
      sceneCount: Array.isArray(res.scenes) ? res.scenes.length : 0,
    });

    // 各シーンを正規化。
    if (Array.isArray(res.scenes)) {
      for (const scene of res.scenes) {
        const evs = sceneToEvents(scene, { chance: ci, minute, home, away });
        for (const e of evs) events.push(e);
      }
    }

    if (typeof res.t1score === 'number') lastT1 = res.t1score;
    if (typeof res.t2score === 'number') lastT2 = res.t2score;
  }

  // 前半しか無い等で HT が出ていない場合でも、フレーム要求時は FT を出す。
  if (withFrame) {
    events.push({
      t: EVENT_TYPES.FT, chance: null, minute: null, team: null,
      homeScore: lastT1, awayScore: lastT2,
    });
  }

  return events;
}

/**
 * 補助: Event[] から home/away のゴール数を集計する（検証・統計用）。
 * @returns {{home:number, away:number}}
 */
function tallyGoals(events) {
  const acc = { home: 0, away: 0 };
  if (!Array.isArray(events)) return acc;
  for (const e of events) {
    if (e && e.t === EVENT_TYPES.GOAL) {
      if (e.team === 'home') acc.home++;
      else if (e.team === 'away') acc.away++;
    }
  }
  return acc;
}

// ブラウザ <script> 運用ではグローバルに公開済み（上の宣言がスクリプトスコープ）。
// Node（vm context / 連結ロード）でも参照できるよう、存在すれば module.exports にも載せる。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EVENT_TYPES, parseMinute, sceneToEvents, matchToEvents, tallyGoals };
}
