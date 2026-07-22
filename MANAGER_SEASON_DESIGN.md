# MANAGER_SEASON_DESIGN — 監督キャリア＋シーズンサイクル 統合データ設計書（MG-01 / MG-02 / SN-01）

作成: 2026-07-14 ／ 対応タスク: [BACKLOG.md](BACKLOG.md) MG-01・MG-02・SN-01（監督キャリア トラック／シーズンサイクル トラック）／ 方針: [GAME_PLAN.md](GAME_PLAN.md)「監督キャリア層」・[SCOPE.md](SCOPE.md) 1章/4章。
前提設計書: [MENTAL_DESIGN.md](MENTAL_DESIGN.md)（PSトラック＝param係数 seam の前例）。本書は同じ粒度・作法を踏襲する。

**因果の一本線**: 監督パラメータ（persistent・行動と試合で成長）→ ①試合内効果は getActionParam の係数 seam に相乗り（デュエル式不可侵）／②試合外効果はメタ層（信頼度・人気・解任・オファー）で状態遷移を駆動 → シーズン境界で選手が加齢・成長し、監督キャリアが周回する。
**成長=persistent なデータ変化（selectしない・数字だけ増やさない＝1param 1効果で配線）／セーブ改定=1回だけ（v3→v4 で全部入り）**。

---

## 0. ガードレール（実装で崩さない・MENTAL_DESIGN.md 0章と同型）

1. **デュエル式 `ofs²/(ofs²+dfs²)`・チャンス数/カウント不可侵**。試合内効果は (a) `getActionParam()` の係数 `f`（[js/simulate.js:2096-2112](js/simulate.js) の係数チェーン。mental/fatigue/injury と同列に `f *=` を **1本だけ**足す）と (b) 既存 result-hook のみ。監督補正・対策補正・成長は**この1系統に集約**し、フックを二重に作らない（下記6章）。
2. **Math.random / rng() を新規消費しない**。監督パラメータ割当・選手の成長/加齢・信頼度変動はすべて**決定論**（試合結果と行動履歴とシード可能な `mulberry32`＝[js/rng.js](js/rng.js) の派生のみ）で計算する。seed 完全再現（T-06）と events-reproduce（T-03）を壊さない。
3. **係数は小さく・上限/減衰付き**。監督の試合内合成係数は **[0.90, 1.10] にclamp**（mental と合わせて過度に増幅しないよう、監督分は単独 **±5%** から開始）。成長は param 0-100 レンジで**上限＋逓減曲線**。
4. **セーブ改定は1回だけ（絶対制約）**。年齢/選手成長/信頼度/怪我・出場停止の持ち越し/シーズン引き継ぎ/アーカイブ/監督キャリアを**同時に**スキーマ化する。⚠️ **現行 league.js は既に `version: 3`**（[js/league.js:100-113](js/league.js)・シーズン周回＋history は c040a97 で出荷済）。よって本統合改定は **v3→v4**（BACKLOG の「v2→v3」表記は着手前の想定＝実コードに追随して v4 とする。§7・報告参照）。以後の継ぎ足し改定は β ユーザーのセーブを壊すため禁止。
5. **キルスイッチ**: `window.MANAGER_ENABLED === false` で監督の試合内係数を無効化（`MENTAL_ENABLED` と同作法）。メタ層（信頼/人気/加齢）は league.js 内で完結し、公開 docs には LAB_ONLY で非同梱＝挙動不変。
6. **lab 限定・公開凍結の徹底**: 新規ロジックは `js/league.js`（LAB_ONLY_JS）内 or 新規 LAB_ONLY モジュールに置く。simulate.js に足すのは `typeof managerParamFactor === 'function'` ガードの薄い1行のみ（未同梱時 no-op＝公開 football-sim.com は完全挙動不変）。
7. バランスに意図的に触れるため **KPI計測 → 人間承認 → 再ベースライン**（マルチシーズン headless 周回 sim＝SN-10）。承認前に本番 build/push しない。

---

## 1. 監督（Manager）データモデル

### 1.1 パラメータ体系（5種・0-100・初期値は監督作成時に決定論割当）

| param | id | 範囲 | 双方向? | **配線先（1param=1効果・数字だけ増やさない）** | 効果の実装場所 |
|---|---|---|---|---|---|
| 戦術眼 | `tactical` | 0-100 | 一方向（成長のみ） | **ビデオ学習の対策係数量**（該当マッチアップへの in-match buff の大きさ）＋**戦術勉強の習得進捗速度** | ①getActionParam seam（対策 buff）②MG-04 習得ゲージ |
| 分析力 | `analysis` | 0-100 | 一方向 | **コーチ助言の精度・回数**（HT/停止点で出る「不利マッチアップ」情報の的中率と本数）＝情報の質のみ。采配は常にユーザー | MG-06 助言生成（in-match 効果なし＝情報） |
| モチベーター | `motivator` | 0-100 | 一方向 | **「喝」(PS-06)の効果量**＝team.morale 加算量の倍率＋**キックオフ時 team.morale 初期ブースト** | mental.js の morale 層（PS-06 連動・getActionParam 経由で間接） |
| フィジカル管理 | `conditioning` | 0-100 | 一方向 | **休養アクションの疲労回復効率**＋**シーズン跨ぎの疲労持ち越し軽減**（試合内 fatigue 式は不変・回復側のみ） | MG-10 休養／SN-07 引き継ぎ時の `_pitchChances` 相当リセット幅 |
| 人気 | `popularity` | 0-100 | **双方向** | **解任圧力の閾値**（低い＝解任されやすい）＋**移籍オファーの発生/消滅**（高い＝ビッグクラブ、低い＝オファー消滅） | メタ層のみ（SN-04/SN-05・**param係数には一切触れない**） |

- **人気だけがメタ層専用**（試合内 param には配線しない）＝勝率を人気で操作しない。残り4つのうち in-match 係数に触るのは `tactical` の対策 buff と `motivator` の morale ブーストのみ。`analysis` は情報、`conditioning` は疲労回復（試合間）。**「1param 1効果で縦貫通してから増やす」**（MG-01→MG-07 の順で配線）。
- **初期値割当（決定論・rng不使用）**: 監督は1人（ユーザー本人）。初期値は全 param 一律 `MANAGER_TUNING.START`（既定 20）＝「新米監督」からのスタート。難易度は作らない（SCOPE 2章）ので個体差なし。将来 AI 監督（Sprint 3）へ流用する際は名前ハッシュ（mental.js `mentalHash` 流用）で割当＝rng不使用。

### 1.2 成長式（試合・行動で上昇・逓減＋上限）

決定論。**新規 rng を消費しない**（試合結果と行動選択は既に確定した入力）。上限付き逓減で「後半ほど伸びにくい」。

```
gain(param, base) = base × (1 - param/CAP)          // CAP=100・0に近いほど大きく伸び、100付近で頭打ち
param = clamp(param + gain, 0, CAP)
```

| 上昇トリガー | 対象 param | base（`MANAGER_TUNING` で定数化） |
|---|---|---|
| 試合を1つ指揮（結果不問） | 全 param 微増 | +0.4 |
| 勝利 | tactical / motivator | +1.0 |
| 目標超過（上位フィニッシュ等・SN-02） | tactical | +2.0 |
| ビデオ学習アクション実行（MG-03） | tactical | +1.5 |
| 戦術勉強アクション実行（MG-03） | tactical | +1.0（＋習得ゲージ加算） |
| 休養アクション（MG-10） | conditioning | +1.2 |
| メディア対応アクション（MG-10・★C） | popularity | +（下記 1.3 の一方向加算） |
| 選手面談（MG-12・★C） | motivator | +0.8 |

- 目安: 14節×複数シーズンで各 param が 20→70 台へ緩やかに到達（SN-10 headless 周回で曲線を検証・[0.90,1.10] 内に効果が収まるよう `MANAGER_TUNING` を調整）。
- **成長は「監督オブジェクトの param 変化」＝persistent データ**（後述 §2 の `manager.params`）。**getActionParam の runtime 係数とは別物**（成長で base が上がり、その base が対策 buff の大きさを決める＝§6）。

### 1.3 人気の双方向変動式（結果／内容で上下）

唯一の双方向 param。試合ごとに `_onMatchFinish`（[js/league.js:472](js/league.js)）で決定論更新。

```
Δpopularity =
    +BASE_WIN    if 勝利   (例 +2.0)
    -BASE_LOSS   if 敗北   (例 -2.0)
     0           if 引分け（僅少 -0.2 の「退屈」ペナルティは任意）
  + GD_COEF × goalDiff                    // 大勝で加点・大敗で減点（内容）
  + RIVAL_BONUS if 宿敵戦(_isRival) の勝利   // 因縁の相手に勝つと跳ねる
  + STREAK_COEF × currentStreak            // 連勝ボーナス（_state から算出・決定論）
popularity = clamp(popularity + Δ, 0, 100)
```

- 「結果（勝敗）」＋「内容（得点差・宿敵・連勝）」の両面。SCOPE 4章 MG-05／1章「移籍オファー（人気連動）」に対応。
- 可視化はリーグハブの週報／新聞見出し風（RW-01 SNSフィードと共用・「今日の一話」と好相性）。
- 人気の**実効果**（解任圧力・オファー）は SN-04/SN-05 で state 遷移に配線（下記3章）。

---

## 2. 統合セーブスキーマ v4（Manager/Club/Season/Player/Archive・改定は1回のみ）

現行 `_state`（[js/league.js:96-113](js/league.js)）を**上位互換で拡張**。`LS_KEY='fs_league_v1'`（文字列キーは不変）／`version` フィールドを `3 → 4` に上げる。**追加は全て任意フィールドで、欠落時はデフォルト補完**（既存 β セーブを壊さない）。

```jsonc
{
  "version": 4,                    // ← v3 から一度だけ上げる（以後の継ぎ足し禁止）

  /* ── 既存 v3 フィールド（不変・そのまま持ち越し） ── */
  "season": 1, "history": [ /* seasonSummary[] */ ],
  "myClub": "england2026", "rival": "netherlands2026",
  "clubs": [...], "fixtures": [[...]], "standings": {...},
  "round": 0, "lastPlayedDate": null, "lastResult": {...}, "finished": false,

  /* ── ① Manager（新規・MG-02） ── */
  "manager": {
    "name": null,                  // ユーザー名（未設定=既定）
    "age": null,                   // ⚠️ 年齢概念の採否で有無が決まる（§5・null=年齢なし運用）
    "params": { "tactical":20, "analysis":20, "motivator":20, "conditioning":20, "popularity":20 },
    "learnedTactics": ["POSSESSION","CATENACCIO"],  // MG-04 習得済（初期2種）
    "tacticProgress": { "PRESS":0, "COUNTER":0 },    // 習得ゲージ 0-100
    "coaches": { "analysis":1, "physical":0, "mental":0, "scout":0 },  // レベル 0=未雇用（入替はローンチ後）
    "clubTrust": 50,               // 現クラブからの信頼度 0-100（SN-02・解任判定材料）
    "seasonGoal": { "type":"table_pos", "target":3 },  // 開幕時クラブ提示（SN-02）
    "tenure": { "clubId":"england2026", "sinceSeason":1 }  // 在任履歴（移籍で更新・SN-04/05）
  },

  /* ── ② Season（当季のメタ・新規） ── */
  "seasonMeta": {
    "actionsLog": [ /* { round, action:'video_study'|'tactic_study'|'rest'|..., target? } */ ],
    "pendingAction": null          // 次節前に選んだ1アクション（MG-03・1日1アクション）
  },

  /* ── ③ Player 持ち越し層（新規・クラブ×選手の delta オーバーレイ） ──
   * ⚠️ 重要: クラブは live TEAM_DATA を参照するだけで squad を保存していない
   *   (_clubData=TEAM_DATA[id]・[js/league.js:51])。TEAM_DATA は single/WC と共有の
   *   不変ソースなので直接書き換え禁止。→ 「差分オーバーレイ」を持ち、team-build 時に適用する。
   * キー = クラブID → 選手識別子(long_name 推奨・PT/PS と同じ決定論キー) → 持ち越しデータ。 */
  "squads": {
    "england2026": {
      "<player-long-name>": {
        "age": 27,                 // §4/§5（年齢なし運用時は省略可）
        "growth": { "11": +2, "1": -1 },  // param idx → 累積 delta（疎・0は持たない＝軽量）
        "trust": 50,               // 監督との信頼度 0-100（MG-12・起用/面談で上下）
        "injuryOut": 0,            // 怪我による欠場残り試合数（SN-01 持ち越し・discipline 連携）
        "suspendOut": 0,           // 出場停止残り試合数（レッド/イエロー累積）
        "apps": 0, "goals": 0, "assists": 0  // シーズン統計（RW-02・成長入力・加齢の出場時間）
      }
    }
  },

  /* ── ④ Archive（既存 history を拡張・RW-02/SN-03） ── */
  "history": [ /* seasonSummary に selectShare 用の総評/統計スナップショットを付加 */ ]
}
```

### 2.1 v2→v3→v4 マイグレーション方針（[js/league.js:151-169](js/league.js) `_load` を拡張）

現行 `_load` は `version !== 2 && version !== 3` を破棄し、v2→v3 を補完している。ここに **v3→v4 の一段を継ぎ足す**（既存の v2→v3 分岐は残す）。全て**欠落フィールドの補完のみ**で、進行中データは保持：

```
if version === 2 → (既存) version=3, season/history 補完
if version <= 3  →  version=4
                    manager       = manager || _defaultManager()      // params 全20・learnedTactics 初期2種
                    seasonMeta    = seasonMeta || { actionsLog:[], pendingAction:null }
                    squads        = squads || {}                        // 空=全選手 base のまま（delta なし）
                    各 club/player は「参照時に lazy 生成」（下記）で埋める
_save()  // 移行後に一度だけ保存
```

- **lazy 生成の原則**（mental.js の性格遅延キャッシュと同型）: `squads[club][player]` は**初回アクセス時に既定値で生成**する。全 800 選手を移行時に展開しない＝localStorage 肥大化を避ける（history 50 件上限[js/league.js:194](js/league.js) と同じ配慮）。`growth` は疎（0 の param は持たない）。
- 受入: 既存 kantoku-lab の v3 セーブをロード→ `manager`/`squads` が既定で生えて**進行中のリーグがそのまま続く**ことを実機確認（SN-10 で headless 検証）。

### 2.2 オーバーレイの適用点（growth を base param へ焼き込む）

`playToday`（[js/league.js:453-454](js/league.js)）と AIvsAI（[js/league.js:497](js/league.js)）で `_clubData(id)` が返す TEAM_DATA を**そのまま渡さず、オーバーレイ適用済みの clone を渡す**新関数 `_overlaySquad(clubId)` を噛ませる：

```
_overlaySquad(clubId):
  td   = deep-clone(TEAM_DATA[clubId])        // ★ TEAM_DATA 本体は不変（single/WC 保護）
  for p in td.players:
    ov = squads[clubId][p.long_name]
    if ov.growth: for idx,delta in ov.growth: p.params[idx] = clamp(p.params[idx]+delta, 1, 99)
    if ov.injuryOut>0 || ov.suspendOut>0: mark p._unavailable=true  // lineup 生成時に除外＝詰み防止(§3.3)
  return td
```

- growth は**runtime 係数ではなく base param の書き換え**（persistent な成長）＝getActionParam の係数チェーンとは独立（§6 で明確化）。
- clone コストは1試合1回×8クラブのみ＝無視できる。既存の「TEAM_DATA を clone して名前差し替え」の設計思想（[js/league.js:6-9](js/league.js)）の延長。

---

## 3. シーズンサイクルの状態遷移（開幕→14節→終了→分岐→次季）

### 3.1 状態機械

```
        ┌──────────────────────────────────────────────────────────────┐
        ▼                                                              │
 [SEASON_START] ──開幕時クラブが目標提示(SN-02)──▶ [IN_SEASON]           │
   goal/clubTrust 初期化                          │  round 0..13         │
   seasonGoal 決定                                │  各節: 行動フェーズ(MG-03)│
                                                  │        →試合→結果反映   │
                                                  ▼                      │
                                          round>=14? ──no──┘             │
                                                  │yes                   │
                                                  ▼                      │
                                          [SEASON_END]                   │
                                     達成判定(実績 vs seasonGoal)         │
                                   ┌──────────┴──────────┐               │
                                 達成                    未達            │
                                   ▼                      ▼              │
                          [CEREMONY/REVIEW]      解任判定(§3.2)          │
                        優勝=セレモニー(SN-03)   ┌────┴────┐             │
                        非優勝=振り返り+総評     解任      残留           │
                                   │            ▼          │             │
                                   │      [SACKED]         │             │
                                   │   他クラブオファー抽選 │             │
                                   ▼      (人気連動 SN-04)  ▼             │
                          [CONTRACT_BRANCH] ◀───────────────┘             │
                        再契約 or 移籍オファー受諾(SN-04)                  │
                                   ▼                                     │
                          [TRANSFER_WINDOW] 補強/放出(SN-06)              │
                                   ▼                                     │
                          [NEXT_SEASON] 引き継ぎ(SN-07)──────────────────┘
                        season++・fixtures 再生成・選手加齢/成長適用(§4)
```

- 現行 `_startNextSeason`（[js/league.js:190-215](js/league.js)）が既に「アーカイブ→同クラブ次季」を実装済。**v4 ではこの関数を `[CONTRACT_BRANCH]→[TRANSFER_WINDOW]→[NEXT_SEASON]` に分解**し、間に選手加齢/成長・補強放出・監督移籍を挟む。
- `_state.finished`（[js/league.js:518](js/league.js)）が `[SEASON_END]` トリガー。ここから先を新規実装。

### 3.2 解任の判定条件（決定論・目標未達＋成績）

```
sacked = (未達) AND (clubTrust < TRUST_SACK_THRESHOLD)
clubTrust の季中更新（_onMatchFinish で）:
  Δtrust = +TW×(勝) −TL×(負) + goalProgress(順位が目標に近いほど+)
seasonGoal 未達の度合い（目標順位 − 実順位）が大きいほど clubTrust を押し下げる
TRUST_SACK_THRESHOLD は popularity で緩和（人気監督は猶予）:
  effThreshold = TRUST_SACK_THRESHOLD − POP_GRACE×(popularity/100)
```

- **ゲームオーバーにしない**（SCOPE 1章）。`sacked=true` でも [SACKED]→他クラブオファーで**必ず継続**。オファーが人気低で全消滅した場合の詰み回避＝**最低1件は下位クラブから保証**（救済）。

### 3.3 「他クラブへ移籍して継続」の遷移（SN-04/SN-05）

```
[SACKED] or 自発移籍:
  offers = クラブ群から抽選（決定論・人気で門戸が変わる）
    popularity 高 → 上位クラブ(強い squad)が候補
    popularity 低 → 下位クラブのみ（オファー消滅は救済で最低1件残す）
  ユーザーが1つ選択 → manager.tenure = { clubId:new, sinceSeason:next }
  myClub 切替 → rival 再計算(_computeRival)・squads[newClub] を lazy 生成
  クラブ信頼度 clubTrust を新任クラブの初期値(50)へリセット
```

- 同クラブ残留（再契約）は現行 `_startNextSeason` の myClub 維持パス。移籍は myClub を差し替えるだけ＝既存周回インフラを再利用。
- **詰み防止（怪我/停止の持ち越し × 移籍）**: 移籍先 squad の `injuryOut/suspendOut` で欠場者多数でも、`_overlaySquad` が**先発 11 人を確保できない場合は残り試合数を強制的に 0 clamp**（最低出場人数保証・SCOPE 3章「詰み防止」）。

---

## 4. 選手の年齢・成長・衰えモデル（決定論・マルチシーズン中立）

**⚠️ 本章は §5 で「年齢概念を採用する」とユーザーが決めた場合のみ有効**。年齢なし運用なら選手 param は季を跨いで不変（`squads.growth` 空）。

### 4.1 決定論の成長／衰え（シーズン境界で1回適用・rng不使用）

シーズン引き継ぎ（[NEXT_SEASON]）で各選手に1回だけ適用。入力は「年齢」「今季出場時間(apps)」のみ＝決定論：

```
ageFactor(age):
   age < PEAK(27) :  +GROW × (PEAK-age)/PEAK          // 若手ほど伸びる
   age = PEAK      :  0
   age > PEAK      :  −DECL × (age-PEAK)/DECL_SPAN     // ベテランほど衰える
playFactor(apps) = apps / SEASON_MATCHES              // 出場が多いほど成長入力大（0..1）

Δparam(idx) = round( ageFactor(age) × playFactor × PARAM_WEIGHT[idx] )
  ・PARAM_WEIGHT: 伸び/衰えの param 差（例 スピード idx2/3 は加齢で先に落ち、
    メンタリティ idx27・ポジショニング idx26 は歳でも落ちにくい＝実サッカー準拠）
squads[club][player].growth[idx] += Δparam(idx)   // 疎に累積
age += 1
```

- **完全決定論**（rng 不使用）＝ seed 再現を壊さない。出場時間は試合結果から確定した `apps` を使う。

### 4.2 能力インフレ/デフレを防ぐ設計（SN-10 で検証）

- **母集団中立**: `GROW` と `DECL` を「若手の伸び総量 ≒ ベテランの衰え総量」になるよう `SEASON_TUNING` で調整（headless 周回で全リーグ param 総和が季を跨いでほぼ一定＝±数%に収まることを SN-10 で数値実証）。
- **上限/下限 clamp**（`_overlaySquad` で param を [1,99]）＝突き抜け防止。
- 引退/新戦力の regen（若手補充）は**年齢モデル「フル」採用時のみ**（§5 Option D）。それ以外は総量が自然に均衡するので regen 不要。

---

## 5. ⚠️ 年齢概念の要否 — ユーザー判断用の選択肢（あなたは決めない）

「監督のみ年齢／選手もフル加齢／年齢なし」を、コスト・シーズン制への影響・詰みリスクで比較。**本設計は §2 のスキーマで A〜D いずれも後付けできる**（`age` は任意フィールド・欠落=年齢なし運用）ので、**採用を後から上げられる**＝いま「なし」で出して後で「あり」に昇格しても v4 スキーマのまま（＝改定1回ルールを守れる）。

| 案 | 内容 | 実装コスト | シーズン制への影響 | 詰みリスク | 周回の面白さ | 推奨度 |
|---|---|---|---|---|---|---|
| **A. 年齢なし** | 選手 param は季を跨いで不変。監督も年齢なし | 最小（§4 不要・`growth` 空） | 影響なし（純粋に順位周回） | なし | 低（squad が固定＝育成の動機が弱い） | β最速だが単調 |
| **B. 監督のみ年齢** | `manager.age` のみ。選手は不変 | 小（表示＋任意の引退演出） | 監督キャリアに「時間」の実感。選手は静的 | なし（選手は詰まない） | 中（監督の一代記になる） | **軽量な縦糸が欲しいなら推奨** |
| **C. 選手 soft 加齢（引退なし）** | §4 の成長/衰えを適用。ただし選手は消えない（超高齢でも在籍） | 中（§4＋SN-08＋overlay） | squad が毎季変化＝補強/起用の判断が生きる。育成の動機 | 低（衰えても人数は減らない＝最低出場保証で詰まない） | 高（若手が伸びる／主力が衰える物語） | **バランス良・本命候補** |
| **D. フル加齢＋引退＋regen** | Cに加え引退で選手が抜け、若手 regen で補充 | 大（引退判定・新選手生成 FN-01 名前生成連動・regen バランス） | Football Manager 的な世代交代。最も深い | **中〜高**（引退多発＋補強失敗で先発 11 未満＝救済設計が必須） | 最高（長期周回の目玉） | v1.0 では過大・**ローンチ後推奨** |

**エンジンからの推奨（判断はユーザー）**: β は **B もしくは C**。理由＝(1) スキーマ v4 は A〜D 全対応なので「B/C で出して D はローンチ後に昇格」でも改定1回ルールを守れる、(2) C は「選手の成長・衰え」（SCOPE ★C・SN-08）を最小コストで満たしつつ、最低出場保証があるため詰みリスクが低い、(3) D の regen/引退は FN-01 架空名生成・バランス検証（SN-10）まで巻き込む大型でβ期限（8月下旬）に対して重い。**「監督キャリアの時間軸」を最重視するなら B、「育成周回の手応え」を最重視するなら C**。

---

## 6. 既存 seam への相乗り点（フックを二重に作らない・具体案）

### 6.1 試合内効果は getActionParam の係数チェーンに1本だけ足す

現状の係数チェーン（[js/simulate.js:2107-2112](js/simulate.js)）:

```
f *= mentalParamFactor(team, p)     // PS-03
f *= fatigueParamFactor(team, p)    // DEV_NOTES①
f *= injuryParamFactor(team, p)     // Sprint 2b
```

ここに**監督分を1行だけ**追加（typeof ガード・未同梱時 no-op）:

```
if (typeof managerParamFactor === 'function') f *= managerParamFactor(team, p, action);
```

- `managerParamFactor(team, p, action)` は **league.js（or 新 LAB_ONLY モジュール manager.js）**で定義し、内部で**「監督係数」と「対策(ビデオ学習)係数」を合成して1つの係数を返す**＝フックは1本。
  - 監督係数: 自チーム（＝ human 側 team1）にのみ、`motivator` 由来の morale ブースト等（mental の morale と二重にならないよう、morale への加算は mental.js 経由・ここでは per-matchup の対策 buff に限定）。
  - 対策係数: `seasonMeta` の当節ビデオ学習ターゲット × 相手 `action`（マッチアップ）に一致したら `tactical` に比例した buff（**±5% clamp**）。
- **clamp は mental と同様に返す側で**（`[0.95,1.05]` から開始）。mental の `[0.90,1.10]` と乗算されるため、合成最大 `1.10×1.05` を SN-09 KPI で監視。
- **成長（persistent）はここに来ない**＝§2.2 の `_overlaySquad` で base param を書き換える方式。runtime 係数（監督/対策 buff・morale・疲労）と persistent 成長（base 改変）を**明確に層分離**する＝二重計上を防ぐ。

### 6.2 morale（喝＝PS-06）は mental.js 層に合流

`motivator` による「喝」は **mental.js の team.morale 加算 API（`_mentalAddTeamMorale`）に監督係数を掛けて呼ぶ**だけ（PS-06 のタスク内で `managerMotivatorFactor()` を渡す）。getActionParam には既存の `mentalParamFactor` 経由で反映される＝新フック不要。

### 6.3 コーチ助言は「情報」＝param に触れない

MG-06 分析コーチは既存 HT デュエル分析（`_showHalfTimeModal`）とトースト前例を人格化するだけ。`analysis` は**表示する助言の精度/本数**を変えるのみで、係数チェーンには一切入らない（采配の主語はユーザー・GAME_PLAN「助言は情報」）。

### 6.4 怪我/停止の持ち越しは discipline.js のマーカーを読む

discipline.js は既に持ち越しを見越したマーカーを吐いている（[js/discipline.js:290-292](js/discipline.js)）:

```
ofsP._injured = true;                // 「持ち越しマーカー（SN-01・リーグが読む）」← コメント済
ofsP._injurySeverity = severity;     // 'minor' | 'severe'（持ち越しの重み付け）
```

- **試合終了時に league.js が読む**（`_onMatchFinish`）: 出場選手の `_injured`/`_sentOff`/`_yellowCards` 累積を集計し、`squads[club][player].injuryOut`（severity で 1〜数試合）・`suspendOut`（レッド=次節、イエロー累積=規定）へ書き込む。severity→試合数のマップは `SEASON_TUNING` で定数化。
- 次節 `_overlaySquad` が `injuryOut/suspendOut>0` の選手を lineup 生成から除外し、毎節末に残り試合数を −1（最低出場保証で clamp・§3.3）。

---

## 7. 段階実装順（SN-01 スキーマ → MG/SN タスクの積み上げ）

**クリティカル: SN-01（=MG-02 と同一タスク・スキーマ v4）が全ての土台。ここで年齢/成長/信頼/持ち越し/引き継ぎ/アーカイブ/監督を"全部入り"でスキーマ化する（以後の改定禁止）。**

| 順 | タスクID | 内容 | 依存 | 本設計の該当章 |
|---|---|---|---|---|
| 1 | **SN-01 / MG-02** | v3→v4 スキーマ＋`_load` 移行＋`_overlaySquad`＋`_defaultManager`（**1タスクで**） | — | §2・§2.1・§2.2 |
| 2 | **MG-01（本書）** | 監督パラメータ体系・成長式・人気式の確定（設計＝本書で完了） | — | §1 |
| 3 | **MG-03** | 行動フェーズ MVP（ビデオ学習/戦術勉強・1日1アクション・「今日の一話」に組込） | SN-01 | §1.2・§6.1 |
| 4 | **MG-05** | 人気システム（`_onMatchFinish` で双方向更新→ハブ可視化） | MG-01 | §1.3 |
| 5 | **SN-02** | シーズン目標＋クラブ信頼度（開幕提示・達成判定） | SN-01 | §3.1・§3.2 |
| 6 | **MG-04** | 戦術習得制（初期2種→勉強で解放・リーグ限定。新戦術追加は別タスク承認ゲート） | MG-03 | §2（learnedTactics） |
| 7 | **SN-03** | シーズン終了フロー（優勝セレモニー/振り返り＋総評） | SN-01,RW-02 | §3.1 |
| 8 | **SN-04 / SN-05** | 再契約/移籍分岐＋人気連動オファー＋解任→他クラブ継続 | SN-02 | §3.2・§3.3 |
| 9 | **SN-07** | 2季目以降の継続（引き継ぎ・日程再生成・宿敵/レポート再接続） | SN-03,SN-06 | §3.1・§4 |
| 10 | **SN-06** | 補強・放出イベント（squads へ選手 add/remove） | SN-04 | §2（squads） |
| 11 | **MG-06** | コーチ MVP（分析=試合中助言/フィジカル=試合間助言・情報のみ） | MG-03 | §6.3 |
| 12 | **MG-07 / PS-06** | 監督成長の効果配線（tactical→対策量・motivator→喝＝getActionParam/morale seam） | MG-06,PS-06 | §6.1・§6.2 |
| 13 | **SN-08 / MG-10** | 選手の年齢・成長・衰え（§5 で採用が決まった案に従い実装）＋休養/練習アクション | SN-07,MG-10 | §4・§5 |
| 14 | **SN-09** | チュートリアル加入演出（最初の数試合中に選手 1〜2 人 add） | SN-01 | §2（squads add） |
| 15 | **RW-02** | バックナンバー＋シーズン統計（squads の apps/goals/assists・archive） | SN-01 | §2④ |
| 16 | **MG-12** | 選手↔監督 信頼度＋面談（squads.trust） | MG-10,SN-01 | §2③ |
| 17 | **MG-08** | 成長の演出（試合後/アクション後リザルト・i18n ja/en） | MG-03 | §1.2 |
| 18 | **SN-10 / MG-09** | マルチシーズン headless 周回でインフレ/デフレ・解任頻度・オファー分布・係数 KPI 検証→人間承認→再ベースライン | SN-08 | §4.2・§6.1 |

- **段階原則（PS と同じ）**: SN-01 でスキーマを固め、MG-03（行動）→MG-05（人気）→SN-02（目標/信頼）→SN-03/04/05（境界・分岐・解任）で**周回の骨格を先に縦貫通**。年齢/成長（SN-08）は骨格が回ってから §5 の採用案に応じて乗せる。効果配線（MG-07）は「1param 1効果」で1本ずつ。

---

## 8. i18n・ファイル構成・検証

- **テキストは日英両方**（`i18n`/`t()`＝players.js、または league.js の `_t(ja,en)` パターン[js/league.js:28](js/league.js)）。監督 param 名・アクション名・目標文・解任/オファー/セレモニー文言・総評テンプレを ja/en 対で追加（片方だけ禁止）。
- **ファイル**: メタ層ロジックは `js/league.js`（LAB_ONLY_JS）へ集約。試合内係数だけは新規 `managerParamFactor` を league.js（or 新 LAB_ONLY `js/manager.js`）に置き、simulate.js には typeof ガードの1行のみ（§6.1）。**公開 docs は非同梱＝挙動不変**。`tools/lib/load-engine.js`（回帰ハーネス headless ロード）に新モジュールを登録。
- **検証**: `node --check` 全編集ファイル＋`node tools/regression-harness.js check 1500`（試合内係数を足した段階で PASS＝公開挙動不変を実証）。マルチシーズンは **headless 周回 sim（SN-10）**で param 総和中立・解任頻度・オファー分布・[0.90,1.10]×[0.95,1.05] 合成係数の分布を数値化→人間承認→再ベースライン。
- **seed 再現**: 監督/成長/加齢/信頼が **rng を新規消費しない**ことを、既存 seed 再現テスト（同一シード同一介入列で完全一致）で実証。

---

## 付録: 本設計が触る既存コードの地図（file:line）

| 対象 | 場所 | 本設計での役割 |
|---|---|---|
| getActionParam 係数チェーン | [js/simulate.js:2107-2112](js/simulate.js) | ここに `managerParamFactor` を1行追加（§6.1） |
| 既存 result-hook（ファール率） | js/simulate.js:2489（MENTAL_DESIGN 参照） | 監督は触らない（morale 経由のみ） |
| league セーブ read/write | `_save` [js/league.js:150](js/league.js) / `_load` [js/league.js:151-169](js/league.js) | v3→v4 移行を追記（§2.1） |
| `_state` 生成（スキーマ本体） | [js/league.js:96-113](js/league.js)・[js/league.js:200-213](js/league.js) | manager/seasonMeta/squads を追加（§2） |
| クラブ→squad 解決 | `_clubData` [js/league.js:51](js/league.js)・playToday [js/league.js:453](js/league.js)・AIvsAI [js/league.js:497](js/league.js) | `_overlaySquad` を噛ませる（§2.2） |
| 試合終了フック | `_onMatchFinish` [js/league.js:472-520](js/league.js) | 人気/信頼更新・怪我/停止の持ち越し集計（§1.3・§6.4） |
| 次季開始 | `_startNextSeason` [js/league.js:190-215](js/league.js) | 境界フロー（分岐/補強/加齢）に分解（§3.1） |
| 怪我/停止マーカー | [js/discipline.js:290-292](js/discipline.js)・reset [js/discipline.js:181-196](js/discipline.js) | league が読んで injuryOut/suspendOut へ（§6.4） |
| 決定論ハッシュ（AI監督/名前用） | `mentalHash` [js/mental.js:93](js/mental.js) | AI 監督 param 割当に流用（rng不使用・将来） |
| morale 加算 API（喝連携） | `_mentalAddTeamMorale` [js/mental.js:136](js/mental.js) | motivator×喝 を合流（§6.2・PS-06） |
