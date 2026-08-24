#!/usr/bin/env python3
"""Build a candidate union of the separately approved short-pass legs and arms."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from shortpass_approval_gate import REGISTRY, digest, verify_file


REPO = Path(__file__).resolve().parents[2]
BLACK, WHITE = "#071018", "#ffffff"


def font(size: int):
    return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", size)


FRAME_X = (16, 672)
FRAME_Y = (68, 444, 820)


def crop_frame(sheet: Image.Image, slot: int) -> Image.Image:
    index = slot - 1
    x = FRAME_X[index % 2]
    y = FRAME_Y[index // 2]
    return sheet.crop((x, y, x + 640, y + 360)).convert("RGB")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    legs = registry["components"]["legs"]
    arms = registry["components"]["arms"]
    for label, entry in (("legs artifact", legs["artifact"]), ("legs ledger", legs["ledger"]),
                         ("arms artifact", arms["artifact"]), ("arms ledger", arms["ledger"])):
        verify_file(args.artifact_root, label, entry)

    leg_data = json.loads((args.artifact_root / legs["ledger"]["path"]).read_text(encoding="utf-8"))
    arm_data = json.loads((args.artifact_root / arms["ledger"]["path"]).read_text(encoding="utf-8"))
    leg_sheet = Image.open(args.artifact_root / legs["artifact"]["path"]).convert("RGB")
    arm_sheet = Image.open(args.artifact_root / arms["artifact"]["path"]).convert("RGB")
    times = registry["keyframe_times_seconds"]
    args.out.mkdir(parents=True, exist_ok=True)
    rendered = []
    frame_manifest = []
    for slot, time in enumerate(times, 1):
        leg = min(leg_data["frames"], key=lambda row: abs(row["time"] - time))
        arm = min(arm_data["frames"], key=lambda row: abs(row["time"] - time))
        if leg["index"] != arm["index"] or abs(leg["time"] - time) > 0.001:
            raise SystemExit(f"F{slot}: approved ledgers resolve different source frames")
        source = crop_frame(leg_sheet, slot)
        arm_frame = crop_frame(arm_sheet, slot)
        source_pixels = source.load()
        arm_pixels = arm_frame.load()
        leg_colors = {legs["support_color"].lower(), legs["kicking_color"].lower()}
        arm_colors = {arms["left_color"].lower(), arms["right_color"].lower()}
        copied = {"left": 0, "right": 0}
        for y in range(source.height):
            for x in range(source.width):
                arm_hex = "#%02x%02x%02x" % arm_pixels[x, y]
                if arm_hex not in arm_colors:
                    continue
                leg_hex = "#%02x%02x%02x" % source_pixels[x, y]
                if leg_hex in leg_colors:
                    continue
                source_pixels[x, y] = arm_pixels[x, y]
                copied["left" if arm_hex == arms["left_color"].lower() else "right"] += 1
        target = args.out / f"composite_candidate_f{slot:02d}.png"
        source.save(target, quality=96)
        rendered.append(target)
        frame_manifest.append({
            "frame": f"F{slot}", "time": time, "source_index": leg["index"],
            "arm_color_pixels_copied": copied,
            "z_order": "approved leg pixels over approved arm pixels",
        })

    sheet = Image.new("RGB", (1312, 1164), BLACK)
    draw = ImageDraw.Draw(sheet)
    draw.text((16, 14), "MERGE CANDIDATE — approved legs + approved arms only", font=font(21), fill=WHITE)
    for index, path in enumerate(rendered):
        x = 16 + (index % 2) * 656
        y = 68 + (index // 2) * 376
        sheet.paste(Image.open(path), (x, y))
        draw.rectangle((x, y, x + 640, y + 360), outline="#6e8296", width=2)
    sheet_path = args.out / "shortpass_approved_components_merge_candidate.png"
    sheet.save(sheet_path, quality=96)
    manifest = {
        "status": "pending-user-approval",
        "generation_allowed": False,
        "registry": "design/SHORTPASS_APPROVAL.json",
        "input_hashes": {
            "legs_artifact": legs["artifact"]["sha256"], "legs_ledger": legs["ledger"]["sha256"],
            "arms_artifact": arms["artifact"]["sha256"], "arms_ledger": arms["ledger"]["sha256"],
        },
        "frames": frame_manifest,
        "sheet": str(sheet_path),
        "sheet_sha256": digest(sheet_path),
    }
    (args.out / "composite_candidate_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"CANDIDATE {manifest['sheet_sha256']}  {sheet_path}")


if __name__ == "__main__":
    main()
