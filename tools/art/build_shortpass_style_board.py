#!/usr/bin/env python3
"""Derive a pose-neutral style board from the user-approved full-body design."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


# Exact source-image crops. They preserve pixels and deliberately break the
# full-body flying-kick silhouette so it cannot compete with the pose input.
CROPS = (
    ("head", (665, 105, 955, 395)),
    ("jersey", (495, 285, 1015, 610)),
    ("shorts", (575, 565, 930, 900)),
    ("sock_boot_a", (55, 670, 515, 920)),
    ("sock_boot_b", (300, 875, 690, 1245)),
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    source = Image.open(args.source).convert("RGB")
    board = Image.new("RGB", (1280, 960), "#ffffff")
    placements = ((30, 30), (350, 30), (350, 390), (30, 700), (760, 560))
    for (_, box), (x, y) in zip(CROPS, placements):
        crop = source.crop(box)
        board.paste(crop, (x, y))
    # Separators make the absence of a single connected body silhouette clear.
    draw = ImageDraw.Draw(board)
    draw.line((330, 0, 330, 960), fill="#e8edf2", width=4)
    draw.line((730, 360, 730, 960), fill="#e8edf2", width=4)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    board.save(args.output)
    print(args.output)


if __name__ == "__main__":
    main()
