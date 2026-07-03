# MENTAL_DESIGN — 個性・メンタル・スキル層 設計書（PS-01）

作成: 2026-07-03 ／ 対応タスク: [BACKLOG.md](BACKLOG.md) PS-01〜04 ／ 方針: [GAME_PLAN.md](GAME_PLAN.md)「個性・メンタル・スキル層」

**因果の一本線**: 性格（静的データ・決定論割当）→ 試合中の心理状態の動き方（morale/frustration）→ 閾値/トリガーでイベント・スキル発動 → param係数補正＋演出。
**性格=状態の動き方（受動）／スキル=トリガー発動（能動・演出付き）**。

## 0. ガードレール（実装で崩さない）

1. **デュエル式 `ofs²/(ofs²+dfs²)`・チャンス数/カウント不可侵**。効果は (a) `getActionParam()` の係数 `f`（戦術補正と同型・[simulate.js:2043-2103](js/simulate.js)）と (b) result-hook（ファール率 `fp` への乗算・[simulate.js:2489](js/simulate.js)）のみ。
2. **Math.random 禁止**。個性割当は名前ハッシュ（FNV-1a・決定論）。状態更新は試合の流れから決定論的に計算（rngを新規消費しない＝seed再現・イベント再現(T-03)を壊さない）。
3. **係数は小さく・上限/減衰付き**。合成係数は **[0.90, 1.10] にclamp**（±10%以内から開始）。
4. **イベントは js/events.js の語彙拡張で発火**（事後変換アダプタ方式に合わせ、エンジンは chance 結果に `mentalEvents` を**追記**するだけ。既存フィールドは不変）。
5. **キルスイッチ**: `window.MENTAL_ENABLED === false` で全効果を無効化（SCENE_ART_ENABLED と同じ作法）。既定は有効。
6. バランスへ意図的に触るため **KPI計測 → 人間承認 → 再ベースライン**（エンジン精度トラックと同運用）。承認前に本番 build/push しない。

## 1. 心理状態モデル（ランタイム・試合ごとにリセット）

| 状態 | 保持場所 | 範囲 | 初期値 |
|---|---|---|---|
| 選手 `morale` | player オブジェクト（fatigue と同様） | -1.0 〜 +1.0 | 0 |
| 選手 `frustration` | player オブジェクト | 0 〜 1.0 | 0 |
| チーム `morale` | team 状態オブジェクト（team1/team2） | -1.0 〜 +1.0 | 0 |

リセットは既存の fatigue/chance_counter リセット地点（simulate.js 1969/3145/3500・match.js `_resetTeam`）に相乗り。

### 変化ドライバ（全て決定論・チャンス処理内で更新）

| ドライバ | 対象 | 変化（基準値・定数化） |
|---|---|---|
| 得点 | 得点チーム morale | +0.20 ／ 得点者本人 morale +0.40 |
| 失点 | 失点チーム morale | -0.25 ／ ピッチ上全員 frustration +0.10×P |
| デュエル勝利 | 当該選手 morale | +0.10×P |
| デュエル敗北 | 当該選手 morale -0.10×P ／ frustration | +0.15×P |
| ファール被害 | 倒された攻撃選手 frustration | +0.20×P |
| 劣勢継続 | 2点差以上ビハインドのチーム morale | -0.02/チャンス |
| 減衰 | 毎チャンス末尾・全対象 | morale ×0.90・frustration ×0.85（0方向へ） |

P = 性格による増幅率（下記）。定数は全て `js/mental.js` 冒頭に `MENTAL_TUNING` としてまとめ、調整可能にする。

## 2. 性格（受動・初期語彙3種＋ふつう）

名前ハッシュ（FNV-1a of `name + '|' + en_name`）% 10 で決定論割当:

| hash%10 | 性格 | id | 効果（状態の動き方） |
|---|---|---|---|
| 0-1 (20%) | 怒りやすい | `hot_headed` | frustration 蓄積 ×2.0・減衰 ×0.5（減衰は ×0.925 相当） |
| 2-3 (20%) | 調子に乗りやすい | `streaky` | morale 変化 ×2.0（**上げも下げも**＝両刃。本チューニングは PS-08） |
| 4-5 (20%) | 冷静 | `cool` | frustration 蓄積 ×0.5・morale 変化 ×0.5 |
| 6-9 (40%) | ふつう | `normal` | ×1.0 |

- 割当は buildTeam/リセット時に遅延計算して player にキャッシュ（players.js のデータ本体は書き換えない＝800人手作業ゼロ・P3リーグの選手も自動）。
- **明示上書き**: `js/mental.js` の `MENTAL_OVERRIDES`（選手名→{personality, skills}）。主力/キャプテンのみ data-steward が随時整備（初期は空でよい）。

## 3. スキル（能動・trigger→effect 定義形式）

```js
// js/mental.js — スキル定義形式（初期1種で縦貫通・PS-08で拡張）
const SKILL_DEFS = {
  captaincy: {
    name: 'キャプテンシー', en_name: 'Captaincy',
    trigger: 'team_concede',        // 自チーム失点時
    condition: 'on_pitch',          // 発動者がピッチ上
    effect: { type: 'team_morale_add', amount: +0.45 },  // 失点の-0.25を打ち消し+0.20へ
    maxPerMatch: 2,                 // 発動回数上限（前半/後半で1回ずつ相当）
    label: { ja: '｛選手｝がチームを鼓舞した！', en: '{player} rallies the team!' },
  },
};
```

- **キャプテンの決め方**: `TEAM_DATA.captain`（players配列のindex・任意）があればその選手。無ければ**決定論フォールバック＝スタメン中フィールドプレイヤーで params[MENTAL](精神力)最大の選手**（同値は lineup 順で先）。キャプテンは `captaincy` を保持。
- 効果はチーム morale への加算＝既存の減衰（×0.90/チャンス）で自然に数チャンスで消える＝「持続数チャンス・減衰」を別機構なしで満たす。
- 発動時は `mentalEvents` に記録（下記5）→ 将来 PS-05 でカットイン/トースト演出が購読。

## 4. 効果配線（2箇所のみ）

### (a) param 係数（morale → 攻守全般）
`getActionParam(team, pos, action)` 内・戦術補正と同列に:

```
mf = 1 + 0.06 × player.morale + 0.04 × team.morale   // 性格増幅は状態側で織込み済
f *= clamp(mf, 0.90, 1.10)
```

- 単一チョークポイントで攻守両側に効く。GK専用解決（PK等）は MVP では触らない。
- keyplayer 選抜率(×2.5)・marked_player(×0.85) とは独立に併存。

### (b) ファール率（frustration → ファール確率UP）
[simulate.js:2489](js/simulate.js) の `fp` 算出直後:

```
fp *= (1 + 0.5 × dfsPlayer.frustration)   // イライラした守備選手はファールしやすい
fp = min(fp, 0.95)
```

- ファール生成はこの1箇所のみ（検証済）＝最小侵襲。Sprint 2 のカード段階化がこの上に乗る。

## 5. イベント発火（events.js 語彙拡張）

- エンジンは chance 結果オブジェクトに `res.mentalEvents = [{ type, team: 1|2, player, skill?, detail? }]` を**追記**（既存フィールド不変＝events-reproduce 検証は無影響）。
- `js/events.js` に語彙追加: `EVENT_TYPES.MENTAL: 'mental'`（状態の大きな変化・将来用）／ `EVENT_TYPES.SKILL_ACTIVATE: 'skill_activate'`。`matchToEvents()` が `res.mentalEvents` を読んで Event 化。
- PS-04 のスコープは**エンジン＋イベント記録まで**。カットイン演出・トースト・実況文は PS-05。

## 6. ファイル構成・登録

- **新規 `js/mental.js`**: MENTAL_TUNING 定数／FNVハッシュ／性格割当（キャッシュ）／MENTAL_OVERRIDES／SKILL_DEFS／状態init・リセット／ドライバ更新API（`mentalOnDuel` `mentalOnGoal` `mentalOnFoul` `mentalOnChanceEnd`）／係数getter（`mentalParamFactor` `mentalFoulFactor`）。
- simulate.js には**薄いフック呼び出しのみ**（`typeof mentalXxx === 'function'` ガード・cutscene と同じ作法）。
- 登録: **`build.js` の `LAB_ONLY_JS`（league.js と同方式＝公開 docs/ はコードごと非同梱・dist-lab のみ同梱）**／root index.html には script タグを足さない（build が dist-lab index へ注入）／**`tools/lib/load-engine.js`（回帰ハーネスのheadlessロード）には登録**。（2026-07-03 ユーザー指示「実装は kantoku-lab のみ反映・本番凍結」による。公開版は simulate.js の typeof ガードで完全 no-op＝キルスイッチOFF状態とbit等価をQAで実証済み）

## 7. 検証・KPI（PS-04完了時に計測して人間承認へ）

- `node --check` 全編集ファイル＋`node tools/regression-harness.js check 1500`。
- 注目KPI: **ファール率（シーン結果率）・得点・勝敗分布・シュート/決定率**。意図的変更のため許容差超過は想定内→数値を添えてユーザー承認→承認後に baseline 再採取。
- 個性の分布確認: 全TEAM_DATA選手の性格分布が想定比率（20/20/20/40）に近いことをheadlessで確認。
- seed再現: 同一シードで `mentalEvents` 込みの完全再現（rng消費を増やしていないことの実証）。
