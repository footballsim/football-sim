/* =========================================================================
 * js/names.js — 表示名インダイレクション層（FN-00）
 * -------------------------------------------------------------------------
 * 目的（DECISIONS 2026-07-30 / BACKLOG FN-00）:
 *   実在選手・実在クラブのデータで **バランス調整を最後まで** 続けながら、
 *   公開時には表示名だけを架空名に差し替えられるようにする。
 *
 * 方式 = 「内部IDは据え置き・表示名だけ差し替え」:
 *   - 選手の内部ID  = 起動時の `long_name || name`（＝ league.js `_playerKey` と同一の文字列）
 *   - クラブの内部ID = `TEAM_DATA` のキー（元から名前ではないので安全）
 *   内部IDは **絶対に変えない**。v4 セーブの `squads[クラブ][選手キー]`（成長 delta /
 *   怪我・停止の残り週 / 出場・得点）は選手キーで引くため、ここが動くと保存データが
 *   エラーも出さずに全損する（＝静かなデータ消失）。
 *
 * 差し替えは `TEAM_DATA` の表示用フィールド name / en_name だけを切り替える。
 *   → `long_name` は起動中も常に内部IDのまま。フルネーム表示だけは
 *     NAMES.displayName(..., {full:true})（players.js の getPlayerDisplayName）で解決する。
 *   → 短縮名を直接読む既存画面との互換性を保ちつつ、セーブキーそのものは物理的に不変になる。
 *   → 逆に「名前から実データを引いている箇所」だけが要注意なので、そこは
 *     NAMES.playerId() / NAMES.extraKey() を通す（呼び出し側は typeof ガード付き）。
 *
 * 切替:
 *   window.FICTION_NAMES = true/false（スクリプトで明示）
 *   ?names=fiction / ?names=real（URL）
 *   localStorage 'fs_fiction_names'（'1'/'0'）
 *   NAMES.toggle()（デバッグ用・localStorage に保存してリロード）
 *   既定は **実名（OFF）**＝開発中のバランス調整は実データのまま。
 *
 * FN-01で、リーグ8クラブには公開用の固有名・色・抽象crestと地域別の架空人名を実装済み。
 * リーグ外のチームは汎用生成をフォールバックとして維持する。どちらも内部IDは変えない。
 * ========================================================================= */
(function (global) {
  'use strict';

  var LS_KEY = 'fs_fiction_names';

  /* 内部ID → 原本（実名）／架空名。REV は「いま表示している名前 → 内部ID」の逆引き。
   * 逆引きを持つ理由: 選手オブジェクトは各所で clone される（simulate.js の allPlayers・
   * league.js の overlay squad 等）ため、隠しフィールドを生やす方式だと clone で落ちる。
   * 名前そのものから引ければ clone でも確実に内部IDへ戻れる。 */
  var REAL = { players: {}, clubs: {}, teamPlayers: {} };
  var FICT = { players: {}, clubs: {} };
  var REV = { players: {}, clubs: {} };
  var PLAYER_IDS = [];
  var CLUB_IDS = [];
  var PLAYER_CLUB = {};
  var captured = false;
  var applied = false;

  /* ── 決定論ハッシュ（FNV-1a 32bit）。ポートレートと同系＝同じIDなら常に同じ名前 ── */
  function _hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }
  function _pick(arr, h) { return arr[(h >>> 0) % arr.length]; }   // ★ XOR は符号付きになるので必ず >>>0

  /* ── リーグ外チーム用の汎用生成器 ──────────────────────────────────────
   * 日英で同じ音になる CV 音節表。ja=カタカナ / en=ローマ字。 */
  var SYL = [
    { ja: 'カ', en: 'ka' }, { ja: 'キ', en: 'ki' }, { ja: 'ク', en: 'ku' }, { ja: 'ケ', en: 'ke' }, { ja: 'コ', en: 'ko' },
    { ja: 'サ', en: 'sa' }, { ja: 'シ', en: 'shi' }, { ja: 'ス', en: 'su' }, { ja: 'セ', en: 'se' }, { ja: 'ソ', en: 'so' },
    { ja: 'タ', en: 'ta' }, { ja: 'テ', en: 'te' }, { ja: 'ト', en: 'to' },
    { ja: 'ナ', en: 'na' }, { ja: 'ニ', en: 'ni' }, { ja: 'ネ', en: 'ne' }, { ja: 'ノ', en: 'no' },
    { ja: 'ハ', en: 'ha' }, { ja: 'ヒ', en: 'hi' }, { ja: 'ヘ', en: 'he' }, { ja: 'ホ', en: 'ho' },
    { ja: 'マ', en: 'ma' }, { ja: 'ミ', en: 'mi' }, { ja: 'ム', en: 'mu' }, { ja: 'メ', en: 'me' }, { ja: 'モ', en: 'mo' },
    { ja: 'ラ', en: 'ra' }, { ja: 'リ', en: 'ri' }, { ja: 'ル', en: 'ru' }, { ja: 'レ', en: 're' }, { ja: 'ロ', en: 'ro' },
    { ja: 'ガ', en: 'ga' }, { ja: 'ギ', en: 'gi' }, { ja: 'ゲ', en: 'ge' }, { ja: 'ゴ', en: 'go' },
    { ja: 'ザ', en: 'za' }, { ja: 'ジ', en: 'ji' }, { ja: 'ゼ', en: 'ze' }, { ja: 'ゾ', en: 'zo' },
    { ja: 'ダ', en: 'da' }, { ja: 'デ', en: 'de' }, { ja: 'ド', en: 'do' },
    { ja: 'バ', en: 'ba' }, { ja: 'ビ', en: 'bi' }, { ja: 'ブ', en: 'bu' }, { ja: 'ベ', en: 'be' }, { ja: 'ボ', en: 'bo' },
    { ja: 'パ', en: 'pa' }, { ja: 'ピ', en: 'pi' }, { ja: 'プ', en: 'pu' }, { ja: 'ペ', en: 'pe' }, { ja: 'ポ', en: 'po' },
    { ja: 'ヴァ', en: 'va' }, { ja: 'ヴィ', en: 'vi' }, { ja: 'ヴェ', en: 've' }, { ja: 'ファ', en: 'fa' }, { ja: 'フィ', en: 'fi' },
    { ja: 'ヤ', en: 'ya' }, { ja: 'ユ', en: 'yu' }, { ja: 'ヨ', en: 'yo' }, { ja: 'ワ', en: 'wa' }
  ];
  var TAIL = [{ ja: 'ン', en: 'n' }, { ja: 'ス', en: 's' }, { ja: 'ル', en: 'l' }, { ja: '', en: '' }, { ja: '', en: '' }];
  var CLUB_SUFFIX = [
    { ja: 'FC', en: 'FC' }, { ja: 'ユナイテッド', en: 'United' }, { ja: 'シティ', en: 'City' },
    { ja: 'アスレチック', en: 'Athletic' }, { ja: 'ローヴァーズ', en: 'Rovers' }, { ja: 'SC', en: 'SC' },
    { ja: 'レアル', en: 'Real' }, { ja: 'スポルティング', en: 'Sporting' }
  ];

  /* FN-01: リーグ8クラブの公開用アイデンティティ。
   * TEAM_DATA key はセーブ/対戦の内部IDなので変えず、表示用メタデータだけを差し替える。 */
  var FICTION_CLUBS = {
    england2026:     { name: 'ノースブリッジ・ローヴァーズ', en_name: 'Northbridge Rovers', team_color: '#5B2C83', flag: '◆' },
    netherlands2026: { name: 'ハーフェンスタットFC',          en_name: 'Havenstad FC',         team_color: '#0F766E', flag: '◈' },
    spain2026:       { name: 'バルドーロCF',                  en_name: 'Valdoro CF',           team_color: '#D97706', flag: '▲' },
    france2026:      { name: 'モンクレール・ユニオン',        en_name: 'Montclair Union',      team_color: '#1D4ED8', flag: '✦' },
    argentina2026:   { name: 'プエルト・アスール・アトレティコ', en_name: 'Puerto Azul Atletico', team_color: '#0E7490', flag: '◉' },
    italy2026:       { name: 'バルドンブラ・カルチョ',        en_name: 'Valdombra Calcio',     team_color: '#991B1B', flag: '⬟' },
    brazil2026:      { name: 'セーハ・ヴェルデEC',            en_name: 'Serra Verde EC',       team_color: '#15803D', flag: '❖' },
    belgium2026:     { name: 'リヴモンSC',                    en_name: 'Rivemont SC',          team_color: '#334155', flag: '⬢' }
  };

  /* リーグで使う8地域の架空人名プール。実在選手の綴りを転用せず、地域ごとの
   * 音と姓の構造だけを参照した創作名を組み合わせる。各配列要素=[ja,en]。 */
  var FICTION_NAME_POOLS = {
    england2026: {
      given: [['エイデン','Aiden'],['カラム','Callum'],['エリス','Ellis'],['フィンリー','Finley'],['ジュード','Jude'],['マイルズ','Miles'],['ローワン','Rowan'],['テオ','Theo']],
      family: [['アシュコム','Ashcombe'],['ベルグレイヴ','Bellgrave'],['クロウミア','Crowmere'],['ダンリー','Dunleigh'],['エヴァーコット','Evercott'],['フェンウィック','Fenwicke'],['グレイフォード','Grayford'],['ハートウェル','Hartwell']]
    },
    netherlands2026: {
      given: [['ブラム','Bram'],['ダーン','Daan'],['イェルーン','Jeroen'],['コーエン','Koen'],['ラース','Lars'],['メース','Mees'],['ニーク','Niek'],['セム','Sem']],
      family: [['ファン・アールデン','van Aerden'],['デ・クレルスト','de Klerst'],['ボスメーレン','Bosmeeren'],['ダールフェイク','Daalwijk'],['ヘルデリンク','Gelderink'],['ホーフェレン','Hoeveren'],['メールダム','Meerdam'],['フェルハウト','Verhout']]
    },
    spain2026: {
      given: [['アドリアン','Adrian'],['ブルーノ','Bruno'],['ダリオ','Dario'],['イケル','Iker'],['ハビ','Javi'],['マルコス','Marcos'],['ニコ','Nico'],['ラウール','Raul']],
      family: [['アルバレナ','Alvarena'],['センドラレス','Cendrales'],['ドルバード','Dorvado'],['エステロン','Estelon'],['フェランサ','Ferranza'],['ガルベラ','Galvera'],['ルセロス','Luceros'],['バルデサ','Valdesa']]
    },
    france2026: {
      given: [['アドリアン','Adrien'],['バスティアン','Bastien'],['クレマン','Clement'],['エリアス','Elias'],['ジュリアン','Julien'],['ロイク','Loic'],['マティス','Mathis'],['レミ','Remy']],
      family: [['アルヴェル','Arvelle'],['ベルクール','Belcourt'],['シャルニエ','Charnier'],['デルモン','Delmont'],['エヴラール','Evrardel'],['フォレストン','Foreston'],['ラクロワン','Lacroine'],['モンヴェル','Montvert']]
    },
    argentina2026: {
      given: [['アグスティン','Agustin'],['バウティスタ','Bautista'],['ファクンド','Facundo'],['ガエル','Gael'],['ホアキン','Joaquin'],['マテオ','Mateo'],['ナウエル','Nahuel'],['ティアゴ','Tiago']],
      family: [['アルカサール','Alcazarro'],['ベルモンテス','Belmontes'],['コルベラ','Corvera'],['デルソラル','Del Solar'],['エスピナル','Espinaldo'],['フェルベラ','Fervera'],['リオベラ','Riovera'],['サルディアス','Saldias']]
    },
    italy2026: {
      given: [['アレッシオ','Alessio'],['ダヴィデ','Davide'],['エリア','Elia'],['ガブリエレ','Gabriele'],['ロレンツォ','Lorenzo'],['マッテオ','Matteo'],['ニコロ','Nicolo'],['トンマーゾ','Tommaso']],
      family: [['ベッラフォルテ','Bellaforte'],['カザルヴィ','Casalvi'],['ドレッティ','Doretti'],['フェランツィオ','Feranzio'],['ガルディエリ','Galdieri'],['ルチェッラ','Lucerra'],['モンタヴィーニ','Montavini'],['ヴァレッシ','Valessi']]
    },
    brazil2026: {
      given: [['アンドレ','Andre'],['カイオ','Caio'],['ダニーロ','Danilo'],['エンゾ','Enzo'],['イーゴル','Igor'],['ルアン','Luan'],['マテウス','Matheus'],['ヴィトル','Vitor']],
      family: [['アルヴェイロ','Alveiro'],['カステローザ','Castelosa'],['ドウラヴァス','Douravas'],['フェレイラウ','Ferreirao'],['ルスカルド','Luzcardo'],['モンテヴァウ','Monteval'],['リベイラル','Ribeiral'],['セラヴィオ','Serravio']]
    },
    belgium2026: {
      given: [['アルノー','Arnaud'],['バス','Bas'],['セドリック','Cedric'],['ドリース','Dries'],['エミール','Emiel'],['ロイク','Loic'],['マティアス','Mathias'],['ティボー','Thibaut']],
      family: [['ファン・アルデン','Van Alden'],['デ・ブレーク','De Bleeck'],['クラースモン','Claesmont'],['デルヴィーヌ','Delvigne'],['ヘルマンデル','Germandel'],['メルテヴェル','Mertvelde'],['ヴァンデルーン','Vandeloon'],['ヴェルカン','Verkanne']]
    }
  };

  function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* 音節を n 個つないだ語を作る。salt で系列をずらす（姓と名で別系列にするため） */
  function _word(id, salt, n) {
    var h = _hash(salt + '|' + id);
    var ja = '', en = '';
    for (var i = 0; i < n; i++) {
      h = _hash(i + '/' + h + '|' + id);        // 音節ごとに引き直す（先頭が固定にならないように）
      var s = _pick(SYL, h);
      ja += s.ja; en += s.en;
    }
    h = _hash('tail|' + h);
    var t = _pick(TAIL, h);
    ja += t.ja; en += t.en;
    return { ja: ja, en: _cap(en) };
  }

  function _genPlayerName(id, seq) {
    var salt = 'fnplayer' + (seq ? '#' + seq : '');
    var pool = FICTION_NAME_POOLS[PLAYER_CLUB[id]];
    if (pool) {
      /* seq は全組合せを順番に探索する。一意化時に別hashへ飛ばすだけだと、
       * 同じ数組を循環して50回で衝突が残ることがある。 */
      var combo = (_hash('locale-name|' + id) + (seq || 0)) % (pool.family.length * pool.given.length);
      var pf = pool.family[combo % pool.family.length];
      var pg = pool.given[Math.floor(combo / pool.family.length) % pool.given.length];
      return {
        name: pf[0],
        en_name: pf[1],
        long_name: pg[0] + '・' + pf[0],
        en_long_name: pg[1] + ' ' + pf[1]
      };
    }
    var fam = _word(id, salt + '/family', 2 + (_hash(salt + id) % 2));   // 姓は2〜3音節
    var giv = _word(id, salt + '/given', 2);                             // 名は2音節
    return {
      name: fam.ja,                              // 短縮表示＝姓（実データの p.name と同じ役割）
      en_name: fam.en,
      long_name: giv.ja + '・' + fam.ja,          // フルネーム＝内部IDと同じ「役割」の表示名
      en_long_name: giv.en + ' ' + fam.en
    };
  }

  function _genClubName(id, seq) {
    var salt = 'fnclub' + (seq ? '#' + seq : '');
    var w = _word(id, salt + '/city', 2 + (_hash(salt + id) % 2));
    var sfx = _pick(CLUB_SUFFIX, _hash(salt + '/sfx|' + id));
    return { name: w.ja + sfx.ja, en_name: w.en + ' ' + sfx.en };
  }

  /* TEAM_DATA / PLAYER_EXTRA は players.js の **トップレベル const**＝window のプロパティでは
   * ない（クラシックスクリプト間で共有される字句スコープに載る）。必ず素の識別子で参照する。 */
  function _teamData() { return (typeof TEAM_DATA !== 'undefined') ? TEAM_DATA : null; }

  /* ── 原本の採取（TEAM_DATA を触る前に1回だけ） ───────────────────────── */
  function capture() {
    if (captured) return;
    var TD = _teamData();
    if (!TD) return;                       // players.js より前に読まれた＝何もしない
    for (var key in TD) {
      if (!Object.prototype.hasOwnProperty.call(TD, key)) continue;
      var td = TD[key];
      if (!td) continue;
      REAL.clubs[key] = { name: td.name, en_name: td.en_name, team_color: td.team_color, flag: td.flag };
      CLUB_IDS.push(key);
      var ps = td.players || [];
      REAL.teamPlayers[key] = [];
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        if (!p) { REAL.teamPlayers[key].push(null); continue; }
        REAL.teamPlayers[key].push({ name: p.name, en_name: p.en_name });
        var id = p.long_name || p.name || '';
        if (!id || REAL.players[id]) continue;   // 同一IDは同一人物扱い（既存の _playerKey と同じ粒度）
        REAL.players[id] = { name: p.name, en_name: p.en_name, long_name: p.long_name };
        PLAYER_CLUB[id] = key;
        PLAYER_IDS.push(id);
      }
    }
    captured = true;
  }

  /* ── 架空名テーブルの生成（重複したら seq を上げて引き直す＝決定論のまま一意化） ── */
  function _buildFiction() {
    var usedP = {}, usedC = {}, i, seq, n;
    for (i = 0; i < PLAYER_IDS.length; i++) {
      var pid = PLAYER_IDS[i];
      seq = 0; n = _genPlayerName(pid, 0);
      while (usedP[n.long_name] && seq < 50) { seq++; n = _genPlayerName(pid, seq); }
      usedP[n.long_name] = true;
      FICT.players[pid] = n;
    }
    for (i = 0; i < CLUB_IDS.length; i++) {
      var cid = CLUB_IDS[i];
      seq = 0; var c = FICTION_CLUBS[cid] || _genClubName(cid, 0);
      while (usedC[c.name] && seq < 50) { seq++; c = _genClubName(cid, seq); }
      usedC[c.name] = true;
      FICT.clubs[cid] = c;
    }
    _buildReverse();
  }

  function _buildReverse() {
    REV.players = {}; REV.clubs = {};
    var i, id, f;
    for (i = 0; i < PLAYER_IDS.length; i++) {
      id = PLAYER_IDS[i]; f = FICT.players[id];
      if (!f) continue;
      REV.players[f.long_name] = id;                                   // フル名（＝表示 long_name）
      if (!REV.players[f.name]) REV.players[f.name] = id;              // 短縮名（衝突時は先勝ち）
      if (f.en_long_name && !REV.players[f.en_long_name]) REV.players[f.en_long_name] = id;
      if (f.en_name && !REV.players[f.en_name]) REV.players[f.en_name] = id;
    }
    /* ★ **実名側も逆引きに載せる**。セーブやレポートには「記録した時点の表示名」が
     *   短縮名で焼き付いている（MOM・得点者など）。実名モードで記録 → 架空モードで開く、
     *   の順で読むと、内部ID（＝long_name）では引けず実名がそのまま画面に残る＝リーク。
     *   実名の短縮名/en名からも内部IDへ戻せるようにして、その一群をまとめて塞ぐ。
     *   ※ 架空名の登録を先に済ませてあるので、衝突時は架空側が優先（先勝ち）。 */
    for (i = 0; i < PLAYER_IDS.length; i++) {
      id = PLAYER_IDS[i];
      var rp = REAL.players[id];
      if (!rp) continue;
      if (rp.name && !REV.players[rp.name]) REV.players[rp.name] = id;
      if (rp.en_name && !REV.players[rp.en_name]) REV.players[rp.en_name] = id;
    }
    for (i = 0; i < CLUB_IDS.length; i++) {
      id = CLUB_IDS[i]; f = FICT.clubs[id];
      if (!f) continue;
      if (!REV.clubs[f.name]) REV.clubs[f.name] = id;
      if (f.en_name && !REV.clubs[f.en_name]) REV.clubs[f.en_name] = id;
    }
    for (i = 0; i < CLUB_IDS.length; i++) {
      id = CLUB_IDS[i];
      var rc = REAL.clubs[id];
      if (!rc) continue;
      if (rc.name && !REV.clubs[rc.name]) REV.clubs[rc.name] = id;
      if (rc.en_name && !REV.clubs[rc.en_name]) REV.clubs[rc.en_name] = id;
    }
  }

  /* ── 適用 / 復帰（表示用フィールドだけを書き換える） ─────────────────── */
  function _write(fiction) {
    var TD = _teamData();
    if (!TD) return;
    for (var key in TD) {
      if (!Object.prototype.hasOwnProperty.call(TD, key)) continue;
      var td = TD[key];
      if (!td) continue;
      var cd = fiction ? FICT.clubs[key] : REAL.clubs[key];
      if (cd) {
        td.name = cd.name;
        td.en_name = cd.en_name;
        if (Object.prototype.hasOwnProperty.call(cd, 'team_color')) td.team_color = cd.team_color;
        if (Object.prototype.hasOwnProperty.call(cd, 'flag')) td.flag = cd.flag;
      }
      var ps = td.players || [];
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        if (!p) continue;
        /* 現在の表示名から内部IDへ戻す（片道にならないよう常に逆引き経由） */
        var id = playerId(p);
        /* 実データには同じlong_nameを共有しつつ短縮名だけ異なる行がある。
         * OFF復帰時はチーム内indexの原本を優先し、表示メタデータを完全に戻す。 */
        var src = fiction ? FICT.players[id] : ((REAL.teamPlayers[key] && REAL.teamPlayers[key][i]) || REAL.players[id]);
        if (!src) continue;
        p.name = src.name;
        p.en_name = fiction ? (src.en_name || src.name) : src.en_name;
        /* ★ long_name はセーブキーそのもの。表示モードに関係なく絶対に変更しない。
         * 架空フルネームは NAMES.displayName(p, {full:true}) で読む。 */
      }
    }
  }

  /* ── 内部IDの解決（clone された選手オブジェクトでも効く） ──────────────── */
  function playerId(p) {
    if (!p) return '';
    var k = (typeof p === 'string') ? p : (p.long_name || p.name || '');
    if (!k) return '';
    if (REAL.players[k]) return k;              // 既に内部ID（＝実名 long_name）
    return REV.players[k] || k;                 // 架空表示名 → 内部ID
  }
  function clubId(c) {
    if (!c) return '';
    if (typeof c === 'string') return REAL.clubs[c] ? c : (REV.clubs[c] || c);
    if (c._srcKey && REAL.clubs[c._srcKey]) return c._srcKey;
    var n = c.name || '';
    return REV.clubs[n] || n;
  }

  /* PLAYER_EXTRA（身長/体重/プロフィール/OFレーティング）は **実データの短縮名** がキー。
   * 架空化しても実データを引き続けるため、必ずここを通す。 */
  function extraKey(p) {
    var id = playerId(p);
    var r = REAL.players[id];
    return r ? (r.name || id) : ((p && p.name) || id);
  }

  /* 内部ID → **実データ**の名前一式（架空化ONでも実名を返す）。
   * 名前ハッシュでゲーム値を決めている箇所（mental.js の性格など）は必ずこれを使う＝
   * 表示名を架空化してもゲーム挙動が1ビットも変わらない。 */
  function realOf(p) {
    var id = playerId(p);
    return REAL.players[id] || null;
  }

  /* 内部ID → いま表示すべき名前一式 */
  function display(id) {
    var key = playerId(id);
    var src = (applied ? FICT.players[key] : REAL.players[key]) || REAL.players[key];
    return src || null;
  }
  /* 内部ID（セーブに保存された選手キー）→ 表示名。言語も見る。
   * ★ 保存データは内部IDで持つのが正。表示の直前にここで解決する。 */
  function displayName(id, opts) {
    var d = display(id);
    if (!d) return (typeof id === 'string') ? id : '';
    var en = (global.LANG === 'en');
    if (opts && opts.full) {
      if (en) return d.en_long_name || d.en_name || d.long_name || d.name;
      return d.long_name || d.name;
    }
    return (en && d.en_name) ? d.en_name : d.name;
  }
  function clubName(id) {
    var key = clubId(id);
    var src = (applied ? FICT.clubs[key] : REAL.clubs[key]);
    if (!src) return (typeof id === 'string') ? id : '';
    return (global.LANG === 'en' && src.en_name) ? src.en_name : src.name;
  }

  /* ── FN-02 の先取り: 実名残留チェック用のプリミティブ ─────────────────── */
  function realNames() {
    var out = [], id, r;
    for (id in REAL.players) {
      if (!Object.prototype.hasOwnProperty.call(REAL.players, id)) continue;
      r = REAL.players[id];
      if (r.long_name && r.long_name.length >= 3) out.push(r.long_name);
      if (r.en_name && r.en_name.length >= 4) out.push(r.en_name);
      /* ★ 短縮名も見る。MOM・得点者はこちらで記録されるので、長い名前だけ見ていると
       *   「ケイン」のような残留を取り逃す（2026-07-30 に RW-01 の検証で実際に発生）。
       *   ⚠️ 2文字の姓（久保・本田など）は誤検出が多くなるので対象外＝そこは
       *   逆引き（REV に実名を載せる）で塞ぐ。 */
      if (r.name && r.name.length >= 3) out.push(r.name);
    }
    for (id in REAL.clubs) {
      if (!Object.prototype.hasOwnProperty.call(REAL.clubs, id)) continue;
      r = REAL.clubs[id];
      if (r.name && r.name.length >= 3) out.push(r.name);
      if (r.en_name && r.en_name.length >= 4) out.push(r.en_name);
    }
    return out;
  }
  /* 文字列に実名が残っていないかを見る。戻り = 見つかった実名の配列（空なら合格） */
  function auditText(text) {
    if (!text) return [];
    var names = realNames(), hit = [], seen = {};
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (seen[n]) continue;
      if (text.indexOf(n) >= 0) { seen[n] = true; hit.push(n); }
    }
    return hit;
  }

  /* ── フラグ ─────────────────────────────────────────────────────────── */
  function _initialFlag() {
    if (typeof global.FICTION_NAMES === 'boolean') return global.FICTION_NAMES;
    try {
      var q = (global.location && global.location.search) || '';
      var m = /[?&]names=(fiction|real)/.exec(q);
      if (m) return m[1] === 'fiction';
      var ls = global.localStorage && global.localStorage.getItem(LS_KEY);
      if (ls === '1') return true;
      if (ls === '0') return false;
    } catch (e) { /* localStorage 不可でも動く */ }
    return false;     // 既定＝実名（バランス調整を実データで続ける・DECISIONS 2026-07-30）
  }

  /* 切替。既定では localStorage に保存してリロード（＝既に描画済みの clone を残さない）。
   * setFiction(on, { persist:false, reload:false }) でその場だけ切り替えることもできる。 */
  function setFiction(on, opts) {
    opts = opts || {};
    on = !!on;
    capture();
    if (!Object.keys(FICT.players).length) _buildFiction();
    if (opts.persist !== false) {
      try { global.localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch (e) {}
    }
    if (on !== applied) { _write(on); applied = on; global.FICTION_NAMES = on; }
    if (opts.reload !== false && global.location && global.location.reload) global.location.reload();
    return applied;
  }
  function toggle() { return setFiction(!applied); }

  /* FN-01 が本番の生成名を流し込む口。
   *   map = { players: { '<内部ID>': {name,en_name,long_name,en_long_name} }, clubs: { '<TEAM_DATAキー>': {name,en_name} } }
   * 未指定のIDはプレースホルダのまま残る（部分差し替え可）。 */
  function registerNames(map) {
    capture();
    if (!Object.keys(FICT.players).length) _buildFiction();
    var was = applied;
    if (was) { _write(false); applied = false; }     // 一度実名へ戻してから差し替える
    if (map && map.players) for (var pid in map.players) {
      if (REAL.players[pid]) FICT.players[pid] = map.players[pid];
    }
    if (map && map.clubs) for (var cid in map.clubs) {
      if (REAL.clubs[cid]) FICT.clubs[cid] = map.clubs[cid];
    }
    _buildReverse();
    if (was) { _write(true); applied = true; }
    return true;
  }

  var NAMES = {
    playerId: playerId,
    clubId: clubId,
    extraKey: extraKey,
    realOf: realOf,
    display: display,
    displayName: displayName,
    clubName: clubName,
    isFiction: function () { return applied; },
    setFiction: setFiction,
    toggle: toggle,
    registerNames: registerNames,
    realNames: realNames,
    auditText: auditText,
    _tables: function () { return { REAL: REAL, FICT: FICT }; }
  };
  global.NAMES = NAMES;

  /* 起動時: 原本を採取 → 架空テーブル生成 → フラグに従って適用。
   * ★ players.js の後・アプリのどのコードより前に読むこと（build.js の lab 注入で先頭）。 */
  capture();
  _buildFiction();
  if (_initialFlag()) { _write(true); applied = true; }
  global.FICTION_NAMES = applied;

})(typeof window !== 'undefined' ? window : this);
