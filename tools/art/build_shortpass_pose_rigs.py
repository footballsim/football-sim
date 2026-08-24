#!/usr/bin/env python3
"""Build high-contrast pose-only rigs from immutable approved joint ledgers."""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw


REPO = Path(__file__).resolve().parents[2]
APPROVAL = REPO / "design" / "SHORTPASS_APPROVAL.json"
OUT_DIR = REPO / "design" / "shortpass-approval"
KEY_INDICES = (18, 48, 78, 108, 138, 174)
COLORS = {
    "body": "#56616d",
    "outline": "#111820",
    "support": "#32f06b",
    "kicking": "#ff38c9",
    "left": "#13c4ff",
    "right": "#ff9f1c",
}


def point(entry: dict) -> tuple[float, float]:
    return float(entry["x"]), float(entry["y"])


def load_frames(path: Path) -> dict[int, dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {frame["index"]: frame for frame in payload["frames"]}


def transform_factory(points: list[tuple[float, float]]):
    min_x = min(x for x, _ in points) - 30
    max_x = max(x for x, _ in points) + 30
    min_y = min(y for _, y in points) - 70
    max_y = max(y for _, y in points) + 35
    scale = min(680 / (max_x - min_x), 900 / (max_y - min_y))
    offset_x = (768 - (max_x - min_x) * scale) / 2 - min_x * scale
    offset_y = (1024 - (max_y - min_y) * scale) / 2 - min_y * scale

    def transform(value: tuple[float, float]) -> tuple[int, int]:
        return round(value[0] * scale + offset_x), round(value[1] * scale + offset_y)

    return transform, scale


def draw_chain(
    draw: ImageDraw.ImageDraw,
    transform,
    chain: list[tuple[float, float]],
    color: str,
    scale: float,
) -> None:
    xy = [transform(value) for value in chain]
    outline_width = max(18, round(17 * scale))
    inner_width = max(12, round(12 * scale))
    radius = max(8, round(8 * scale))
    draw.line(xy, fill=COLORS["outline"], width=outline_width, joint="curve")
    draw.line(xy, fill=color, width=inner_width, joint="curve")
    for x, y in xy:
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color, outline=COLORS["outline"], width=max(3, round(2 * scale)))


def main() -> None:
    registry = json.loads(APPROVAL.read_text(encoding="utf-8"))
    legs_entry = registry["components"]["legs"]["ledger"]
    arms_entry = registry["components"]["arms"]["ledger"]
    legs = load_frames(REPO / legs_entry["path"])
    arms = load_frames(REPO / arms_entry["path"])
    visibility = registry["components"]["arms"]["visibility"]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for slot, index in enumerate(KEY_INDICES, start=1):
        leg = legs[index]
        arm = arms[index]["final"]
        support = [point(leg["support"][joint]) for joint in ("hip", "knee", "ankle")]
        kicking = [point(leg["kicking"][joint]) for joint in ("hip", "knee", "ankle")]
        left = [point(arm["left"][joint]) for joint in ("shoulder", "elbow", "wrist")]
        right = [point(arm["right"][joint]) for joint in ("shoulder", "elbow", "wrist")]
        all_points = support + kicking + left + right
        transform, scale = transform_factory(all_points)
        image = Image.new("RGB", (768, 1024), "#ffffff")
        draw = ImageDraw.Draw(image)

        # Limbs are below the torso; approved temporal identities have fixed colors.
        draw_chain(draw, transform, support, COLORS["support"], scale)
        draw_chain(draw, transform, kicking, COLORS["kicking"], scale)
        frame_visibility = visibility[slot - 1]
        if frame_visibility["left"]:
            draw_chain(draw, transform, left, COLORS["left"], scale)
        if frame_visibility["right"]:
            draw_chain(draw, transform, right, COLORS["right"], scale)

        shoulder_left, shoulder_right = left[0], right[0]
        hip_support, hip_kicking = support[0], kicking[0]
        shoulder_screen_left, shoulder_screen_right = sorted((shoulder_left, shoulder_right))
        hip_screen_left, hip_screen_right = sorted((hip_support, hip_kicking))
        torso = [
            transform(shoulder_screen_left),
            transform(shoulder_screen_right),
            transform(hip_screen_right),
            transform(hip_screen_left),
        ]
        draw.polygon(torso, fill=COLORS["body"], outline=COLORS["outline"])
        draw.line(torso + [torso[0]], fill=COLORS["outline"], width=max(4, round(3 * scale)), joint="curve")

        shoulder_mid = ((shoulder_left[0] + shoulder_right[0]) / 2, (shoulder_left[1] + shoulder_right[1]) / 2)
        hip_mid = ((hip_support[0] + hip_kicking[0]) / 2, (hip_support[1] + hip_kicking[1]) / 2)
        axis = (shoulder_mid[0] - hip_mid[0], shoulder_mid[1] - hip_mid[1])
        length = max(1.0, math.hypot(*axis))
        up = (axis[0] / length, axis[1] / length)
        head_center = (shoulder_mid[0] + up[0] * 32, shoulder_mid[1] + up[1] * 32)
        hx, hy = transform(head_center)
        radius = max(22, round(15 * scale))
        draw.line(
            (transform(shoulder_mid), (hx, hy)),
            fill=COLORS["outline"],
            width=max(12, round(9 * scale)),
        )
        draw.ellipse((hx - radius, hy - radius, hx + radius, hy + radius), fill=COLORS["body"], outline=COLORS["outline"], width=max(4, round(3 * scale)))
        # Nose marker establishes screen-right orientation without supplying a character design.
        draw.polygon(
            ((hx + radius - 2, hy - 5), (hx + radius + round(8 * scale), hy + 2), (hx + radius - 2, hy + 7)),
            fill=COLORS["body"],
            outline=COLORS["outline"],
        )
        output = OUT_DIR / f"pose-rig-derived-f{slot:02d}.png"
        image.save(output)
        print(output)


if __name__ == "__main__":
    main()
