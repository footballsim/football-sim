# Short-pass character canon

The immutable image references and their hashes are recorded in
`design/SHORTPASS_APPROVAL.json`.

## Character rendering

- Body proportions are not inferred from the style board. They are locked by
  `design/PLAYER_BODY_CANON.md` and its measurement image. Reconstructed stature
  must be 5.40-5.80 head-heights around the 5.60H target; head width 0.97-1.07H;
  shoulder width 1.32-1.48H; normalized head-height drift across F1-F6 at most
  3% and normally within +/-2px. A frame outside any band is rejected before
  user presentation.
- Preserve `design/shortpass-approval/style-approved.png` as the immutable visual
  approval evidence. Do not pass its full-body silhouette to image generation.
- Use only `design/shortpass-approval/style-board-derived.png` as the generation
  style input. It is a deterministic, pixel-preserving component board derived
  from the approved design, with the source kick silhouette removed to prevent
  pose leakage.
- Japanese 16-bit/32-bit sports-game pixel illustration: visible square pixel
  clusters, stepped black contour, compact limited-color shading, and crisp
  sprite-like edges.
- Athletic but not bodybuilder-heavy. Keep the same facial proportions, body
  proportions, uniform cut, and color blocking as the reference.
- Blue short-sleeve jersey with cyan collar/cuff trim, green shorts with cyan
  trim, magenta socks with cyan bands, and black boots.
- Solid white background. No field, cast shadow, text, logo, watermark, smooth
  vector rendering, glossy modern anime rendering, painterly shading, or 3D.

## Hair — mandatory right-profile silhouette

- Preserve `design/shortpass-approval/profile-right-approved.png` only as the
  right-facing haircut and rear-head silhouette reference. Its face is not an
  approved identity reference.
- Top and fringe: dark brown/black, spiky, medium length.
- Side and rear: visibly close-cropped undercut (`刈上げ`). The short rear area
  must remain clearly distinct from the longer top.
- The rear skull must not drift into a rounded full-volume hairstyle, a mullet,
  a long nape, or hair of equal length from crown to nape.

## Reference roles

- Approved pose frame: generation evidence for facing direction, silhouette,
  and limb occlusion; the colored trace remains the approved visual evidence.
- Derived high-contrast pose rig: the generation geometry input. It is
  deterministically rendered from the approved leg and arm ledgers, omits
  occluded arms, and must not be treated as character design.
- Pose-neutral style board: character design, uniform, palette, pixel technique
  only. The original full-body style image is evidence, not a generation input.
- Right-profile reference: haircut and rear-head silhouette only; not face
  identity.
- Player-body canon measurement: body ratios only; never pose, clothing, face,
  or hairstyle.
- No previously generated short-pass image may be used as a reference.
- Soft image-reference pose conditioning is prohibited for production
  candidates. Trace-only v16, a rig-only trial, and four-reference hybrid v18
  all failed independent pose QA. Use an OpenPose/ControlNet-equivalent hard
  pose constraint so approved joint coordinates are constraints, not hints.
