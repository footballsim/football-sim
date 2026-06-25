'use strict';
/**
 * prompts.js — カットシーン画像生成のプロンプト組み立て。
 * CUTSCENE_ART_GUIDE.md の §3/§5/§6 を実行可能にしたもの。gen.js から使う。
 * 「もっと粗いドット」要望に合わせ STYLE で chunky/coarse/limited palette を強調。
 */

const STYLE = [
  '16-bit retro pixel art, SNES / PC-Engine sports-anime style',
  'coarse chunky visible pixels, low-resolution sprite look, limited ~32 color palette, bold dark outlines',
  'dramatic dynamic action, cinematic low camera angle',
  'floodlit stadium at dusk, blurred abstract bokeh crowd, rim light on the athlete',
  'flat cel shading, no anti-aliasing'
].join(', ');

const FRAME = 'portrait 3:4, subject centered with empty headroom at top and clear floor space at bottom for a UI bar';

const NEGATIVE = 'anonymous generic face, no real player likeness, no club crest, no brand or sponsor logo, ' +
  'no readable text, no watermark, no extra limbs, no deformed hands, not photorealistic, no 3d render, no smooth gradients';

// moment id → 英語 SUBJECT（ガイド §6）
const MOMENTS = {
  goal_bicycle:      'a spectacular overhead bicycle kick in mid-air, ball blasting off the boot with motion lines',
  goal_volley:       'a full-stretch side volley, body horizontal, striking the ball hard',
  goal_header:       'a powerful leaping header, neck snapping forward, airborne above defenders',
  goal_long_range:   'a thunderous long-range strike, full follow-through, ball trailing motion lines',
  goal_solo_run:     'sprinting at speed with the ball, slotting it past a diving keeper silhouette',
  goal_free_kick:    'curling a free kick over a generic wall of blurred player silhouettes',
  goal_penalty:      'a calm side-foot penalty, keeper diving the wrong way',
  goal_tap_in:       'a sliding close-range finish, arms out, ball crossing the line',
  save_dive:         'a goalkeeper at full stretch, fingertips pushing the ball wide, body airborne',
  tackle_slide:      'a defender sliding in for a strong tackle, grass and turf spraying',
  duel_aerial:       'two footballers in different solid kit colors leaping together for a header',
  red_card:          'a generic referee holding a red card high, a player turning away in frustration',
  injury_down:       'a footballer down on the turf holding his leg, dramatic concern',
  celebration_slide: 'a knee-slide goal celebration, arms wide, crowd erupting behind',
  chance_miss:       'a striker with hands on his head after missing, anguish, ball rolling wide'
};

const KITS = { red:'RED', blue:'BLUE', white:'WHITE', yellow:'YELLOW', green:'GREEN', dark:'dark navy' };

function buildPrompt(momentId, kit, extra) {
  const subject = MOMENTS[momentId];
  if (!subject) throw new Error('unknown moment: ' + momentId + ' (valid: ' + Object.keys(MOMENTS).join(', ') + ')');
  const kitWord = KITS[kit] || kit || 'RED';
  const kitClause = momentId === 'save_dive'
    ? 'wearing a plain solid ' + kitWord + ' goalkeeper kit, generic fictional, no logo, no number'
    : 'wearing a plain solid ' + kitWord + ' jersey and white shorts, generic fictional kit, no logo, no number';
  return [STYLE, subject, kitClause, FRAME, (extra || ''), NEGATIVE].filter(Boolean).join('. ');
}

module.exports = { STYLE, FRAME, NEGATIVE, MOMENTS, KITS, buildPrompt };
