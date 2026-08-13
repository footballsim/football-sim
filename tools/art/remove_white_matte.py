#!/usr/bin/env python3
"""Remove a border-connected white matte from pixel-art cutscene assets."""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def border_pixels(rgb: np.ndarray) -> np.ndarray:
    return np.concatenate((rgb[0], rgb[-1], rgb[1:-1, 0], rgb[1:-1, -1]), axis=0)


def remove_white_matte(
    source: Path, output: Path, edge_contract: int, edge_clean_layers: int
) -> None:
    rgb = np.asarray(Image.open(source).convert("RGB"), dtype=np.uint8)
    border = border_pixels(rgb)
    neutral = border[(border.min(axis=1) > 200) & (np.ptp(border, axis=1) < 20)]
    sample = neutral if len(neutral) else border
    bg = np.median(sample, axis=0).astype(np.float32)

    channel_min = rgb.min(axis=2)
    channel_range = np.ptp(rgb, axis=2)
    removable = ((channel_min > 190) & (channel_range < 34)).astype(np.uint8)
    _, labels = cv2.connectedComponents(removable, connectivity=8)
    border_labels = np.unique(
        np.concatenate((labels[0], labels[-1], labels[1:-1, 0], labels[1:-1, -1]))
    )
    exterior = np.isin(labels, border_labels[border_labels != 0])

    # Peel disconnected white/grey dots only while they touch the exterior.
    # Skin, kit colours and dark ink stop the peel and keep their original RGB.
    peelable = (channel_min > 112) & (channel_range < 48)
    kernel = np.ones((3, 3), dtype=np.uint8)
    for _ in range(edge_clean_layers):
        touching = cv2.dilate(exterior.astype(np.uint8), kernel, iterations=1).astype(bool)
        added = touching & peelable & ~exterior
        if not np.any(added):
            break
        exterior |= added

    alpha = np.where(exterior, 0, 255).astype(np.uint8)
    if edge_contract > 0:
        alpha = cv2.erode(alpha, kernel, iterations=edge_contract)

    output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.dstack((rgb, alpha))).save(output, optimize=True)
    print(
        f"{source.name} -> {output.name} "
        f"bg=#{int(bg[0]):02x}{int(bg[1]):02x}{int(bg[2]):02x} "
        f"visible={int(np.count_nonzero(alpha))}"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--edge-contract", type=int, default=0)
    parser.add_argument("--edge-clean-layers", type=int, default=8)
    args = parser.parse_args()
    remove_white_matte(
        args.input,
        args.output,
        max(0, args.edge_contract),
        max(0, args.edge_clean_layers),
    )


if __name__ == "__main__":
    main()
