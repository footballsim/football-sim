/**
 * archetype.js — MTG1 #4「選手アーカタイプ自動判定＋生え抜き」（Round1 案A＋案C・data-steward 実装分）。
 *
 * 目的: 名前ハッシュではなく「29パラメータそのもの」からポジション群（GK/DF/MF/FW）別の
 *   リーグ平均・分散に対する z-score でアーカタイプを決定論的に判定する。
 *   → regen 選手（players.js に存在しない新規生成選手）でも同じ関数で自動分類できる。
 *
 * 因果の一本線:
 *   TEAM_DATA 全選手（起動時に一度だけ・決定論）
 *     → ポジション群別の平均/分散をキャッシュ
 *     → 個々の選手の29paramをz-score化 → アーカタイプ定義（idx組の平均z）を総当たりで採点
 *     → 最高得点が閾値未満なら「バランサー」（各群のフォールバック）へ収束。
 *
 * ガードレール:
 *   1. ★ Math.random / rng() は一切使わない（完全に params+positions のみに依存する純関数）。
 *   2. archetypeOf() 自体はキルスイッチの影響を受けない「常に計算できる純関数」
 *      （後段が UI 外の判定・集計に使っても良いように）。
 *      表示 API（archetypeBadgeHTML / tenureBadge）だけがキルスイッチで無効化される。
 *   3. キルスイッチ: window.MTG1_ARCH === false で表示 API を無効化（既定は有効）。
 *   4. 平均・分散は TEAM_DATA から算出するのみ（TEAM_DATA 自体は一切書き換えない・読み取り専用）。
 *
 * ロード順: players.js（TEAM_DATA・POWER..FAIR_PLAY 定数）→ archetype.js。
 *   ES module ではなく <script> 運用（_league_dev.html 登録済み）。
 *   Node（tools/lib/load-engine.js）でもロード可能な形（typeof ガードで player.js 未ロード時も落ちない）。
 */

/* ── 0. パラメータ idx 定数（players.js の POWER..FAIR_PLAY を優先。無ければ CLAUDE.md 準拠の数値） ── */
const ARCH_IDX = (typeof POWER !== 'undefined') ? {
  POWER: POWER, STAMINA: STAMINA, TOP_SPEED: TOP_SPEED, ACCELERATION: ACCELERATION,
  RESPONSE: RESPONSE, JUMP: JUMP, AGILITY: AGILITY,
  DRIBBLE_ACCURACY: DRIBBLE_ACCURACY, DRIBBLE_SPEED: DRIBBLE_SPEED,
  SHORTPASS: SHORTPASS, LONGPASS: LONGPASS,
  SHOOT_ACCURACY: SHOOT_ACCURACY, SHOOT_MAKING: SHOOT_MAKING, SHOOT_TECH: SHOOT_TECH,
  FREEKICK_ACCURACY: FREEKICK_ACCURACY, CURVE: CURVE, BALL_TECH: BALL_TECH, OFFENSIVE: OFFENSIVE,
  PASS_CUT: PASS_CUT, TACKLE: TACKLE, MAN_MARKING: MAN_MARKING, COVERING: COVERING,
  CHASING: CHASING, SAVING: SAVING, HIGHBALL: HIGHBALL,
  HEADING: HEADING, POSITIONING: POSITIONING, MENTALITY: MENTALITY, FAIR_PLAY: FAIR_PLAY,
} : {
  POWER: 0, STAMINA: 1, TOP_SPEED: 2, ACCELERATION: 3, RESPONSE: 4, JUMP: 5, AGILITY: 6,
  DRIBBLE_ACCURACY: 7, DRIBBLE_SPEED: 8, SHORTPASS: 9, LONGPASS: 10,
  SHOOT_ACCURACY: 11, SHOOT_MAKING: 12, SHOOT_TECH: 13,
  FREEKICK_ACCURACY: 14, CURVE: 15, BALL_TECH: 16, OFFENSIVE: 17,
  PASS_CUT: 18, TACKLE: 19, MAN_MARKING: 20, COVERING: 21, CHASING: 22, SAVING: 23, HIGHBALL: 24,
  HEADING: 25, POSITIONING: 26, MENTALITY: 27, FAIR_PLAY: 28,
};
// GK は idx4=REF(反応→RESPONSE)/idx5=SPD(→JUMP)/idx10=KIC(→LONGPASS)/idx23=DIV(→SAVING)/
//   idx24=HAN(→HIGHBALL)/idx26=POS(→POSITIONING) の6値だけが意味を持つ（CLAUDE.md 準拠）。
//   ARCH_IDX の定数名はフィールド選手側の名称のままだが、GK ルールでは上記の読み替えで使う。

/* ── 1. ルール表（15〜20種・ポジション群ごとに4種＋フォールバック=バランサー） ──────────
 * score = 対象idxのz-scoreの平均。全ルールの中で最高スコアのものを採用し、
 * 閾値 ARCH_THRESHOLD 未満なら各群のバランサーへフォールバック（=全員が必ず1種を持つ）。
 */
const ARCHETYPE_RULES = {
  GK: [
    { id: 'gk_guardian',  idx: [ARCH_IDX.SAVING, ARCH_IDX.RESPONSE] },       // DIV+REF＝反射で止める守護神
    { id: 'gk_sweeper',   idx: [ARCH_IDX.JUMP, ARCH_IDX.POSITIONING] },      // SPD+POS＝前に出て潰すスイーパー
    { id: 'gk_playmaker', idx: [ARCH_IDX.LONGPASS] },                       // KIC＝配球の起点
    { id: 'gk_commander', idx: [ARCH_IDX.HIGHBALL, ARCH_IDX.POSITIONING] }, // HAN+POS＝ハイボールを支配
  ],
  DF: [
    { id: 'df_wall',     idx: [ARCH_IDX.TACKLE, ARCH_IDX.MAN_MARKING, ARCH_IDX.COVERING] }, // 鉄壁
    { id: 'df_aerial',   idx: [ARCH_IDX.HEADING, ARCH_IDX.JUMP] },                          // 空中戦の鬼
    { id: 'df_libero',   idx: [ARCH_IDX.SHORTPASS, ARCH_IDX.LONGPASS, ARCH_IDX.BALL_TECH] },// ビルドアップの核
    { id: 'df_enforcer', idx: [ARCH_IDX.MENTALITY, ARCH_IDX.POWER] },                       // 闘将
  ],
  MF: [
    { id: 'mf_conductor', idx: [ARCH_IDX.SHORTPASS, ARCH_IDX.LONGPASS, ARCH_IDX.BALL_TECH] }, // 司令塔
    { id: 'mf_engine',    idx: [ARCH_IDX.STAMINA, ARCH_IDX.COVERING, ARCH_IDX.CHASING] },      // 運動量モンスター
    { id: 'mf_dribbler',  idx: [ARCH_IDX.AGILITY, ARCH_IDX.DRIBBLE_ACCURACY, ARCH_IDX.DRIBBLE_SPEED] }, // ドリブラー
    { id: 'mf_destroyer', idx: [ARCH_IDX.PASS_CUT, ARCH_IDX.TACKLE] },                         // アンカー
  ],
  FW: [
    { id: 'fw_finisher',  idx: [ARCH_IDX.SHOOT_ACCURACY, ARCH_IDX.SHOOT_MAKING, ARCH_IDX.SHOOT_TECH] }, // エースストライカー
    { id: 'fw_dribbler',  idx: [ARCH_IDX.AGILITY, ARCH_IDX.DRIBBLE_ACCURACY, ARCH_IDX.DRIBBLE_SPEED] }, // 独走のドリブラー
    { id: 'fw_aerial',    idx: [ARCH_IDX.HEADING, ARCH_IDX.JUMP] },                                     // 空中戦のターゲット
    { id: 'fw_speedster', idx: [ARCH_IDX.TOP_SPEED, ARCH_IDX.ACCELERATION] },                           // スピードスター
  ],
};
// フォールバック（各群1種・スコアが閾値未満の選手はここへ収束＝全員が必ず1種を持つ）
const ARCHETYPE_BALANCER = { GK: 'gk_balancer', DF: 'df_balancer', MF: 'mf_balancer', FW: 'fw_balancer' };
// 採用スコア閾値（z-score平均）。tools/mtg1-archetype-test.js の分布検証で妥当性を確認済み。
const ARCH_THRESHOLD = 0.30;
// 標準偏差フロア（ほぼ一定の項目でz-scoreが暴れるのを防ぐ）
const ARCH_STD_FLOOR = 3;

/* ── 2. フレーバー辞書（(a)バッジ短文 (b)スカウトレポート1行×2 (c)実況/見出し差し込み語×2） ── */
const ARCHETYPE_FLAVOR = {
  gk_guardian: {
    ja: { badge: '守護神', scout: ['反射神経だけでゴールを消し去るタイプ。', '至近距離のシュートほど輝く反応速度を持つ。'],
          callouts: ['神がかった反応', 'ゴールを消す反射神経'] },
    en: { badge: 'The Guardian', scout: ['A keeper who erases shots on pure reflex.', 'Gets sharper the closer the shot comes from.'],
          callouts: ['a reflex save for the ages', 'lightning-quick hands'] },
  },
  gk_sweeper: {
    ja: { badge: 'スイーパーキーパー', scout: ['ラインを飛び出して危険の芽を摘むタイプ。', '広い守備範囲でDF裏のスペースを埋める。'],
          callouts: ['ライン管理の名手', '飛び出しの判断力'] },
    en: { badge: 'Sweeper-Keeper', scout: ['Rushes off his line to snuff out danger early.', 'Covers the space behind a high defensive line.'],
          callouts: ['a fearless sweep-up', 'commands the space behind'] },
  },
  gk_playmaker: {
    ja: { badge: '配球の起点', scout: ['GKからのフィードでビルドアップを組み立てるタイプ。', 'キック精度でカウンターの初手を作る。'],
          callouts: ['正確なフィード', 'GK起点のビルドアップ'] },
    en: { badge: 'Deep-Lying Keeper', scout: ['Starts attacks himself with pinpoint distribution.', 'A kick that launches counters in one pass.'],
          callouts: ['pinpoint distribution', 'starts the play himself'] },
  },
  gk_commander: {
    ja: { badge: 'エリアの支配者', scout: ['クロス対応とポジショニングでゴール前を支配するタイプ。', '高さと状況判断でセットプレーの脅威を消す。'],
          callouts: ['ゴール前の絶対的な支配力', 'crossを完璧に処理'] },
    en: { badge: 'Box Commander', scout: ['Dominates crosses with commanding positioning.', 'Reads set pieces to shut down the danger early.'],
          callouts: ['claims everything in the box', 'total command of his area'] },
  },
  gk_balancer: {
    ja: { badge: '堅実なGK', scout: ['特化した武器はないが穴のない安定感が持ち味。', 'どんな状況でも一定水準の仕事をこなすタイプ。'],
          callouts: ['安定感のある守り', '堅実な仕事ぶり'] },
    en: { badge: 'Steady Keeper', scout: ['No single standout trait, but rarely makes a mistake.', 'Delivers a consistent level in any situation.'],
          callouts: ['reliable between the sticks', 'a steady last line'] },
  },

  df_wall: {
    ja: { badge: '鉄壁', scout: ['体を張った守備で単純に崩されないタイプ。', 'マンマークとカバーリングの両方に長ける。'],
          callouts: ['鉄壁の守備', '崩れない最終ライン'] },
    en: { badge: 'The Wall', scout: ['A defender who simply refuses to be beaten.', 'Excels at both man-marking and covering.'],
          callouts: ['an immovable wall', 'refuses to be broken down'] },
  },
  df_aerial: {
    ja: { badge: '空中戦の鬼', scout: ['セットプレーでの制空権を握るタイプ。', 'ジャンプ力とヘディングで簡単には競り負けない。'],
          callouts: ['圧倒的な制空権', '競り合いで負けない'] },
    en: { badge: 'Aerial Titan', scout: ['Dominates the air on every set piece.', 'Wins duels in the box through sheer leap and timing.'],
          callouts: ['owns the air', 'wins every header'] },
  },
  df_libero: {
    ja: { badge: 'ビルドアップの核', scout: ['最終ラインからパスでゲームを組み立てるタイプ。', '正確なロングフィードで一気に局面を変える。'],
          callouts: ['最終ラインからの配球', '正確なロングフィード'] },
    en: { badge: 'Ball-Playing Defender', scout: ['Builds play from the back with composed passing.', 'A raking long ball that shifts the game in one kick.'],
          callouts: ['starts the build-up himself', 'a raking long pass'] },
  },
  df_enforcer: {
    ja: { badge: '闘将', scout: ['気迫と統率力で最終ラインを引き締めるタイプ。', 'フィジカルの強さで攻撃陣を威圧する。'],
          callouts: ['守備陣を鼓舞する闘志', '威圧的なフィジカル'] },
    en: { badge: 'The Marshal', scout: ['Marshals the back line through sheer force of will.', 'Uses raw physicality to intimidate attackers.'],
          callouts: ['a fire that lifts the defense', 'imposing physical presence'] },
  },
  df_balancer: {
    ja: { badge: '堅実なDF', scout: ['派手さはないが崩れないバランス型のDF。', '基本に忠実な対応で試合を落ち着かせる。'],
          callouts: ['堅実な守備対応', 'バランスの取れた守り'] },
    en: { badge: 'Reliable Defender', scout: ['No flash, just a defender who rarely breaks down.', 'Sticks to the basics and settles the game down.'],
          callouts: ['a reliable presence at the back', 'calm and dependable defending'] },
  },

  mf_conductor: {
    ja: { badge: '司令塔', scout: ['正確なパスでチームのリズムを作るタイプ。', '短短長を織り交ぜて攻撃をデザインする。'],
          callouts: ['チームを操る司令塔', '正確無比なパス回し'] },
    en: { badge: 'The Conductor', scout: ['Dictates the team’s rhythm with precise passing.', 'Mixes short and long balls to design every attack.'],
          callouts: ['orchestrates the whole team', 'a metronome in midfield'] },
  },
  mf_engine: {
    ja: { badge: '運動量モンスター', scout: ['最後まで運動量が落ちないタイプ。', 'ピッチを縦横無尽にカバーする献身性が持ち味。'],
          callouts: ['尽きない運動量', 'ピッチを走り回る献身性'] },
    en: { badge: 'Box-to-Box Engine', scout: ['Runs at the same intensity from first minute to last.', 'Covers every blade of grass with tireless effort.'],
          callouts: ['a tireless engine', 'covers every blade of grass'] },
  },
  mf_dribbler: {
    ja: { badge: 'ドリブラー', scout: ['敏捷性を活かして相手を置き去りにするタイプ。', '狭いスペースでも仕掛けを止めない。'],
          callouts: ['相手を置き去りにする仕掛け', '狭いスペースでの技術'] },
    en: { badge: 'The Dribbler', scout: ['Uses sharp agility to leave defenders behind.', 'Never stops driving forward even in tight spaces.'],
          callouts: ['leaves defenders in the dust', 'brilliant in tight spaces'] },
  },
  mf_destroyer: {
    ja: { badge: 'アンカー', scout: ['インターセプトとタックルで攻撃の芽を摘むタイプ。', '中盤のバランスを守る破壊者。'],
          callouts: ['芽を摘む読みの鋭さ', '中盤を壊す破壊力'] },
    en: { badge: 'The Destroyer', scout: ['Snuffs out attacks with interceptions and tackles.', 'A destroyer who protects the midfield balance.'],
          callouts: ['reads and destroys the attack', 'a wrecking ball in midfield'] },
  },
  mf_balancer: {
    ja: { badge: '万能MF', scout: ['特定の色はないがどこでも及第点をこなすタイプ。', '攻守のバランスを取る便利屋的存在。'],
          callouts: ['どこでもこなす万能性', 'バランスの取れたプレー'] },
    en: { badge: 'Utility Midfielder', scout: ['No single strength, but solid everywhere on the pitch.', 'A jack-of-all-trades who balances attack and defense.'],
          callouts: ['does a bit of everything', 'balances both ends of the pitch'] },
  },

  fw_finisher: {
    ja: { badge: 'エースストライカー', scout: ['決定力に絶対の自信を持つストライカー。', 'ゴール前での冷静さが最大の武器。'],
          callouts: ['決定力の塊', 'ゴールへの嗅覚'] },
    en: { badge: 'The Finisher', scout: ['A striker with total belief in his finishing.', 'Ice-cold composure the moment the chance arrives.'],
          callouts: ['a clinical finisher', 'a nose for goal'] },
  },
  fw_dribbler: {
    ja: { badge: '独走のドリブラー', scout: ['一人で局面を打開できる仕掛けの鋭さを持つ。', 'スピードと技術で守備陣を切り裂くタイプ。'],
          callouts: ['一人でこじ開ける突破力', '守備陣を切り裂く仕掛け'] },
    en: { badge: 'Dribbling Wizard', scout: ['Can break down a defense single-handedly.', 'Slices through back lines with pace and skill.'],
          callouts: ['tears the defense open alone', 'a wizard with the ball at his feet'] },
  },
  fw_aerial: {
    ja: { badge: '空中戦のターゲット', scout: ['クロスへの飛び込みで得点を量産するタイプ。', '高さを活かしたポストプレーでも起点になる。'],
          callouts: ['クロスに飛び込む高さ', '空中戦での存在感'] },
    en: { badge: 'Aerial Target', scout: ['Piles up goals attacking crosses in the air.', 'Also holds the ball up thanks to his aerial presence.'],
          callouts: ['rises above everyone for crosses', 'a genuine aerial threat'] },
  },
  fw_speedster: {
    ja: { badge: 'スピードスター', scout: ['スピード一つで裏のスペースを切り裂くタイプ。', '加速力で守備ラインの背後を取り続ける。'],
          callouts: ['裏を取り続ける快足', '圧倒的なスピード'] },
    en: { badge: 'Speed Demon', scout: ['Tears in behind the defense with raw pace alone.', 'Keeps beating the last line with explosive acceleration.'],
          callouts: ['blistering pace in behind', 'simply too fast to catch'] },
  },
  fw_balancer: {
    ja: { badge: '万能アタッカー', scout: ['突出した武器はないがどこでも仕事をするタイプ。', '状況に応じて役割を変えられる柔軟性が持ち味。'],
          callouts: ['どんな形でも仕事をする', '柔軟に立ち回る攻撃力'] },
    en: { badge: 'All-Around Forward', scout: ['No standout trait, but gets the job done anywhere up front.', 'Flexible enough to shift roles as the game demands.'],
          callouts: ['finds a way to contribute', 'adapts to whatever the game needs'] },
  },
};

/* ── 3. 内部ヘルパー ─────────────────────────────────────────────── */

// キルスイッチ（mental.js の _mentalEnabled と同じ作法）。既定=有効。
// ★ archetypeOf() 自体はこれの影響を受けない（純関数として常に計算可能）。
//   表示 API（archetypeBadgeHTML / tenureBadge）だけがこれで無効化される。
function _archEnabled() {
  return !(typeof window !== 'undefined' && window && window.MTG1_ARCH === false);
}

// TM position コード → ポジション群（GK/DF/MF/FW）。左右接頭辞は無視。
function _archGroupOf(pos) {
  if (!pos) return 'MF';
  const base = String(pos).replace(/^[左右]/, '');
  if (base === 'GK') return 'GK';
  if (base === 'CB' || base === 'SB') return 'DF';
  if (base === 'DMF' || base === 'CMF' || base === 'OMF' || base === 'SMF') return 'MF';
  if (base === 'CF' || base === 'WG') return 'FW';
  return 'MF';
}

// TEAM_DATA 全選手からポジション群別の平均・分散を1回だけ算出（決定論・Math.random不使用）。
function _archComputeStats() {
  if (typeof TEAM_DATA === 'undefined' || !TEAM_DATA) return null;
  const groups = { GK: [], DF: [], MF: [], FW: [] };
  for (const key in TEAM_DATA) {
    const team = TEAM_DATA[key];
    if (!team || !Array.isArray(team.players)) continue;
    for (let i = 0; i < team.players.length; i++) {
      const p = team.players[i];
      if (!p || !Array.isArray(p.params) || p.params.length < 29) continue;
      const grp = _archGroupOf(p.positions && p.positions[0]);
      groups[grp].push(p.params);
    }
  }
  const stats = {};
  for (const g in groups) {
    const arr = groups[g];
    const n = arr.length;
    const mean = new Array(29).fill(50);
    const std = new Array(29).fill(10);
    if (n > 0) {
      for (let idx = 0; idx < 29; idx++) {
        let sum = 0;
        for (let j = 0; j < n; j++) sum += arr[j][idx];
        mean[idx] = sum / n;
      }
      for (let idx = 0; idx < 29; idx++) {
        let sq = 0;
        for (let j = 0; j < n; j++) { const d = arr[j][idx] - mean[idx]; sq += d * d; }
        std[idx] = Math.sqrt(sq / n);
      }
    }
    stats[g] = { mean, std, n };
  }
  return stats;
}

let _archStatsCache = null;
// キャッシュ済みのリーグ統計を返す（初回のみ TEAM_DATA を走査。TEAM_DATA 未ロード時は中立値）。
function _archStats() {
  if (_archStatsCache) return _archStatsCache;
  const neutral = { mean: new Array(29).fill(50), std: new Array(29).fill(10), n: 0 };
  _archStatsCache = _archComputeStats() || { GK: neutral, DF: neutral, MF: neutral, FW: neutral };
  return _archStatsCache;
}

// テスト専用: リーグ統計キャッシュを破棄する（TEAM_DATA を差し替えて再計算させたい時用）。
function _archResetStatsCache() { _archStatsCache = null; }

function _archZ(stats, group, idx, value) {
  const g = stats[group] || stats.MF;
  const std = Math.max(g.std[idx] || 0, ARCH_STD_FLOOR);
  return ((value != null ? value : 50) - g.mean[idx]) / std;
}

function _archEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// アーカタイプid → バッジ配色（暗背景前提。既存CSS変数を優先しフォールバック値も併記）。
function _archGroupColor(id) {
  const prefix = String(id || '').split('_')[0];
  if (prefix === 'gk') return { bg: 'rgba(0,48,135,0.28)',  fg: '#dbe8ff', bd: 'var(--japan-blue, #003087)' };
  if (prefix === 'df') return { bg: 'rgba(58,158,74,0.26)', fg: '#dcfce1', bd: 'var(--green-light, #3a9e4a)' };
  if (prefix === 'mf') return { bg: 'rgba(184,134,11,0.26)', fg: '#ffe9b3', bd: 'var(--gold, #B8860B)' };
  if (prefix === 'fw') return { bg: 'rgba(188,0,45,0.26)',  fg: '#ffd7de', bd: 'var(--japan-red, #BC002D)' };
  return { bg: 'rgba(255,255,255,0.10)', fg: '#e5e7eb', bd: 'rgba(255,255,255,0.35)' };
}

/* ── 4. 公開API ─────────────────────────────────────────────────── */

/**
 * アーカタイプ自動判定（純関数・決定論・Math.random不使用）。
 * 同じ params/positions を渡せば常に同じ結果を返す（regen選手にもそのまま使える）。
 * @param {number[]} playerParams 29要素の params 配列
 * @param {string[]} positions    player.positions（配列の先頭=メインポジションを使う）
 * @returns {{id:string, ja:string, en:string}}
 */
function archetypeOf(playerParams, positions) {
  const params = Array.isArray(playerParams) ? playerParams : [];
  const mainPos = (Array.isArray(positions) && positions.length) ? positions[0] : null;
  const group = _archGroupOf(mainPos);
  const stats = _archStats();
  const rules = ARCHETYPE_RULES[group] || ARCHETYPE_RULES.MF;

  let bestId = ARCHETYPE_BALANCER[group];
  let bestScore = -Infinity;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    let sum = 0;
    for (let j = 0; j < rule.idx.length; j++) {
      sum += _archZ(stats, group, rule.idx[j], params[rule.idx[j]]);
    }
    const score = sum / rule.idx.length;
    if (score > bestScore) { bestScore = score; bestId = rule.id; }
  }
  const id = (bestScore >= ARCH_THRESHOLD) ? bestId : ARCHETYPE_BALANCER[group];
  const flavor = ARCHETYPE_FLAVOR[id] || ARCHETYPE_FLAVOR[ARCHETYPE_BALANCER.MF];
  return { id, ja: flavor.ja.badge, en: flavor.en.badge };
}

/**
 * 生え抜き判定（案C）。永続カウンタ自体の集計・セーブ配線は後段（#3/#5 リーグ機能）が行う。
 * ここでは「入力→判定」の純関数とドキュメンテーションのみを提供する。
 *
 * 期待する入力（後段がリーグ永続データから組み立てる想定）:
 *   clubTenureSeasons {number}  同一クラブでの在籍シーズン数（移籍のたびリセットされる想定）
 *   joinedAsYouth     {boolean} ユース／育成出身として加入したか（生え抜きの条件）
 *
 * 閾値: 5シーズン在籍で「クラブの顔」、7シーズン以上「生え抜き」なら「生え抜きの象徴」。
 * @returns {null|{id:string, ja:string, en:string, seasons:number}}
 */
const TENURE_THRESHOLDS = { CLUB_FACE_SEASONS: 5, HOMEGROWN_LEGEND_SEASONS: 7 };

function tenureBadge(info) {
  if (!_archEnabled()) return null;
  if (!info) return null;
  const seasons = Number(info.clubTenureSeasons) || 0;
  if (seasons < TENURE_THRESHOLDS.CLUB_FACE_SEASONS) return null;
  if (info.joinedAsYouth && seasons >= TENURE_THRESHOLDS.HOMEGROWN_LEGEND_SEASONS) {
    return { id: 'homegrown_legend', ja: '生え抜きの象徴', en: 'Homegrown Legend', seasons };
  }
  return { id: 'club_face', ja: 'クラブの顔', en: 'Club Face', seasons };
}

/**
 * 表示用バッジHTML（後段のUI配線が使う想定）。インラインstyleで完結する小さなピル型バッジ。
 * キルスイッチ（window.MTG1_ARCH === false）で無効化される（空文字を返す）。
 * @param {object} player {params, positions, clubTenureSeasons?, joinedAsYouth?}
 * @param {{lang?: 'ja'|'en'}} [opts]
 * @returns {string} HTML文字列（無効時・データ不足時は ''）
 */
function archetypeBadgeHTML(player, opts) {
  if (!_archEnabled()) return '';
  if (!player || !Array.isArray(player.params)) return '';
  const lang = (opts && opts.lang) || (typeof currentLang !== 'undefined' ? currentLang : 'ja');
  const a = archetypeOf(player.params, player.positions);
  const color = _archGroupColor(a.id);
  const pill = (text, c) =>
    '<span style="display:inline-block;padding:2px 7px;margin:0 4px 2px 0;border-radius:10px;' +
    'font-size:11px;font-weight:700;line-height:1.5;white-space:nowrap;' +
    'background:' + c.bg + ';color:' + c.fg + ';border:1px solid ' + c.bd + ';">' +
    _archEsc(text) + '</span>';

  let html = pill(lang === 'en' ? a.en : a.ja, color);
  const tb = tenureBadge(player);
  if (tb) {
    const tenureColor = { bg: 'rgba(184,134,11,0.22)', fg: '#f5deb3', bd: 'var(--gold, #B8860B)' };
    html += pill(lang === 'en' ? tb.en : tb.ja, tenureColor);
  }
  return html;
}

// Node（vm context / 連結ロード・tools/lib/load-engine.js 相当）でも参照できるよう module.exports にも載せる。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ARCH_IDX, ARCHETYPE_RULES, ARCHETYPE_BALANCER, ARCHETYPE_FLAVOR,
    ARCH_THRESHOLD, ARCH_STD_FLOOR, TENURE_THRESHOLDS,
    archetypeOf, tenureBadge, archetypeBadgeHTML,
    _archGroupOf, _archStats, _archResetStatsCache,
  };
}
