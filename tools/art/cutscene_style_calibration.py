#!/usr/bin/env python3
"""Deterministic Phase 2A style-fact extraction from adopted F2/F3 sprites.

This tool measures accepted raster finish only.  It does not certify a candidate,
unlock image generation, infer anatomical left/right identity, or claim that CT4D
can reproduce the accepted finish.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import shutil
import stat
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, List, Mapping, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image


REPO = Path(__file__).resolve().parents[2]
OUTPUT_REL = Path("design/cutscene-production/calibration/manga190")
REGISTRY_NAME = "calibration.json"
LOGICAL_BODY_HEIGHT = 190
MASK_NAMES = (
    "shirt",
    "shorts",
    "socks",
    "accent",
    "skin",
    "dark_fixed",
    "silhouette",
    "background",
)
MATERIAL_NAMES = MASK_NAMES[:6]
SOURCE_SPECS = {
    "F2": {
        "path": "img/cutscenes/manga_shortpass6/frame_02.png",
        "sha256": "b88e22e17b0d1bacd65268122ce68313e41c8e999d3bb464dbbf6224e7811b0e",
        "dimensions": [1442, 1870],
        "mode": "RGBA",
    },
    "F3": {
        "path": "img/cutscenes/manga_shortpass6/frame_03.png",
        "sha256": "df54ea8579474747ca0357521868e0a38aa951fefa337f437ff435177d7d6bfa",
        "dimensions": [1474, 1682],
        "mode": "RGBA",
    },
}
HSV_RULES = {
    "silhouette_seed": {"saturation_gt": 0.12, "value_lt": 0.72, "combine": "or"},
    "dark_fixed": {"value_lt": 0.32},
    "skin": {"hue_deg_gte": 8.0, "hue_deg_lt": 60.0, "value_gte": 0.32},
    "shorts": {"hue_deg_gte": 70.0, "hue_deg_lt": 155.0, "value_gte": 0.32},
    "accent": {"hue_deg_gte": 155.0, "hue_deg_lt": 215.0, "value_gte": 0.32},
    "shirt": {"hue_deg_gte": 215.0, "hue_deg_lt": 270.0, "value_gte": 0.32},
    "socks": {
        "hue_deg_gte_or_lte": [285.0, 3.0],
        "value_gte": 0.32,
        "saturation_gt": 0.12,
    },
}
MIN_DIRECT_SEED_COVERAGE = 0.95
MAX_CROSS_FRAME_AREA_RATIO_DELTA = 0.04
MIN_SOURCE_MATERIAL_PIXELS = 32
MANIFEST_REL = Path("design/CUTSCENE_PRODUCTION_MANIFEST.json")
LOCKED_MANIFEST_STATE = {
    "status": "phase1-authority-verification-only",
    "calibration_status": "not-calibrated",
}
INDEPENDENT_REVIEW_STATUS = "passed"


class CalibrationFailure(Exception):
    pass


def fail(message: str) -> None:
    raise CalibrationFailure(message)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def stable_json_bytes(value: Mapping[str, Any]) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def stable_png_bytes(array: np.ndarray, mode: str) -> bytes:
    stream = io.BytesIO()
    image = Image.fromarray(array)
    if image.mode != mode:
        fail("array mode {} does not match requested PNG mode {}".format(image.mode, mode))
    image.save(
        stream,
        format="PNG",
        optimize=False,
        compress_level=9,
    )
    return stream.getvalue()


def round_float(value: float) -> float:
    if not math.isfinite(value):
        fail("non-finite measured value")
    return round(float(value), 8)


def lexical_under_root(root: Path, relative: Path, label: str) -> Path:
    if relative.is_absolute() or relative == Path(".") or ".." in relative.parts:
        fail("{} path is not a normalized repository-relative path: {}".format(label, relative))
    candidate = Path(os.path.abspath(str(root / relative)))
    try:
        candidate.relative_to(root)
    except ValueError:
        fail("{} path escapes artifact root: {}".format(label, relative))
    return candidate


def reject_symlink_components(
    root: Path,
    path: Path,
    label: str,
    allow_missing_tail: bool = False,
) -> None:
    try:
        relative = path.relative_to(root)
    except ValueError:
        fail("{} path escapes artifact root: {}".format(label, path))
    current = root
    for part in relative.parts:
        current = current / part
        if not os.path.lexists(str(current)):
            if allow_missing_tail:
                return
            fail("{} path is missing: {}".format(label, current))
        try:
            mode = os.lstat(str(current)).st_mode
        except OSError as exc:
            fail("cannot inspect {} path {}: {}".format(label, current, exc))
        if stat.S_ISLNK(mode):
            fail("{} path contains symlink: {}".format(label, current))


def secure_existing_file(root: Path, relative: Path, label: str) -> Path:
    path = lexical_under_root(root, relative, label)
    reject_symlink_components(root, path, label)
    try:
        mode = os.lstat(str(path)).st_mode
    except OSError as exc:
        fail("cannot inspect {} file {}: {}".format(label, path, exc))
    if not stat.S_ISREG(mode):
        fail("{} is not a regular file: {}".format(label, path))
    try:
        resolved = path.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError):
        fail("{} resolved path escapes artifact root: {}".format(label, path))
    return path


def secure_mkdirs(root: Path, relative: Path, label: str) -> Path:
    destination = lexical_under_root(root, relative, label)
    current = root
    for part in relative.parts:
        current = current / part
        if os.path.lexists(str(current)):
            reject_symlink_components(root, current, label)
            try:
                mode = os.lstat(str(current)).st_mode
            except OSError as exc:
                fail("cannot inspect {} directory {}: {}".format(label, current, exc))
            if not stat.S_ISDIR(mode):
                fail("{} component is not a directory: {}".format(label, current))
        else:
            try:
                os.mkdir(str(current))
            except OSError as exc:
                fail("cannot create {} directory {}: {}".format(label, current, exc))
            reject_symlink_components(root, current, label)
    return destination


def scan_tree_no_symlinks(root: Path, tree: Path, label: str) -> List[Path]:
    reject_symlink_components(root, tree, label)
    try:
        tree_mode = os.lstat(str(tree)).st_mode
    except OSError as exc:
        fail("cannot inspect {} tree {}: {}".format(label, tree, exc))
    if not stat.S_ISDIR(tree_mode):
        fail("{} is not a directory: {}".format(label, tree))
    files: List[Path] = []
    pending = [tree]
    while pending:
        directory = pending.pop()
        try:
            entries = list(os.scandir(str(directory)))
        except OSError as exc:
            fail("cannot scan {} tree {}: {}".format(label, directory, exc))
        for entry in entries:
            path = Path(entry.path)
            if entry.is_symlink():
                fail("{} tree contains symlink: {}".format(label, path))
            if entry.is_dir(follow_symlinks=False):
                pending.append(path)
            elif entry.is_file(follow_symlinks=False):
                files.append(path)
            else:
                fail("{} tree contains unsupported filesystem entry: {}".format(label, path))
    return files


def remove_created_tree(root: Path, tree: Path, label: str) -> str:
    """Best-effort removal for one exact task-created path; never glob siblings."""
    if not os.path.lexists(str(tree)):
        return ""
    try:
        files = scan_tree_no_symlinks(root, tree, label)
    except CalibrationFailure as exc:
        return str(exc)
    errors: List[str] = []
    try:
        shutil.rmtree(str(tree))
    except OSError as exc:
        errors.append("shutil.rmtree: {}".format(exc))
    if not os.path.lexists(str(tree)):
        return ""

    # A second, symlink-safe cleanup path handles transient or mocked rmtree
    # failures without widening deletion to unrelated temp-like siblings.
    try:
        for file_path in sorted(files, key=lambda value: len(value.parts), reverse=True):
            if os.path.lexists(str(file_path)):
                mode = os.lstat(str(file_path)).st_mode
                if stat.S_ISLNK(mode) or not stat.S_ISREG(mode):
                    raise OSError("unsafe cleanup entry: {}".format(file_path))
                os.unlink(str(file_path))
        directories = [
            Path(directory)
            for directory, _dirs, _files in os.walk(str(tree), topdown=False, followlinks=False)
        ]
        for directory in directories:
            reject_symlink_components(root, directory, label)
            if directory != tree:
                os.rmdir(str(directory))
        os.rmdir(str(tree))
    except (OSError, CalibrationFailure) as exc:
        errors.append("manual cleanup: {}".format(exc))
    if os.path.lexists(str(tree)):
        return "; ".join(errors) or "cleanup path still exists"
    return ""


def fail_after_cleanup(
    root: Path,
    created_paths: Sequence[Tuple[Path, str]],
    message: str,
) -> None:
    cleanup_errors = []
    for path, label in created_paths:
        error = remove_created_tree(root, path, label)
        if error:
            cleanup_errors.append("{} retained at {}: {}".format(label, path, error))
    if cleanup_errors:
        fail("{}; cleanup incomplete: {}".format(message, " | ".join(cleanup_errors)))
    fail(message)


def output_suffix(relative: str) -> Path:
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts:
        fail("output path is not normalized: {}".format(relative))
    try:
        suffix = path.relative_to(OUTPUT_REL)
    except ValueError:
        fail("output path is outside canonical calibration directory: {}".format(relative))
    if suffix == Path("."):
        fail("output path must identify a file")
    return suffix


def write_bytes(path: Path, data: bytes) -> None:
    """Single injectable write seam used by atomic-failure tests."""
    path.write_bytes(data)


def relative_output_path(frame: str, suffix: str) -> str:
    return (OUTPUT_REL / frame.lower() / suffix).as_posix()


def ensure_locked_manifest(root: Path) -> None:
    path = secure_existing_file(root, MANIFEST_REL, "production manifest")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail("missing or invalid production manifest: {}".format(exc))
    for key, expected in LOCKED_MANIFEST_STATE.items():
        if manifest.get(key) != expected:
            fail("production manifest must keep {}={}".format(key, expected))
    if "thresholds" in manifest:
        fail("production manifest must not contain candidate thresholds during Phase 2A")


def load_sources(root: Path) -> Tuple[Dict[str, np.ndarray], Dict[str, Dict[str, Any]]]:
    images: Dict[str, np.ndarray] = {}
    metadata: Dict[str, Dict[str, Any]] = {}
    for frame, spec in SOURCE_SPECS.items():
        path = secure_existing_file(root, Path(spec["path"]), "{} source".format(frame))
        actual_sha = sha256_file(path)
        if actual_sha != spec["sha256"]:
            fail("{} source SHA-256 mismatch".format(frame))
        with Image.open(path) as image:
            actual_mode = image.mode
            actual_dimensions = list(image.size)
            rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)
        if actual_mode != spec["mode"] or actual_dimensions != spec["dimensions"]:
            fail("{} source mode or dimensions mismatch".format(frame))
        images[frame] = rgba
        metadata[frame] = dict(spec)
    return images, metadata


def rgb_to_hsv_lab(rgb: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    rgb_float = rgb.astype(np.float32) / 255.0
    hsv = cv2.cvtColor(rgb_float, cv2.COLOR_RGB2HSV)
    lab = cv2.cvtColor(rgb_float, cv2.COLOR_RGB2LAB)
    return hsv, lab


def external_background(seed_foreground: np.ndarray, opaque: np.ndarray) -> np.ndarray:
    candidate = ((~opaque) | (opaque & ~seed_foreground)).astype(np.uint8)
    _count, labels = cv2.connectedComponents(candidate, connectivity=4)
    border_labels = np.unique(
        np.concatenate((labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]))
    )
    return np.isin(labels, border_labels) & (candidate > 0)


def direct_seed_masks(rgba: np.ndarray) -> Dict[str, Any]:
    rgb = rgba[:, :, :3]
    opaque = rgba[:, :, 3] > 0
    hsv, lab = rgb_to_hsv_lab(rgb)
    hue, saturation, value = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    foreground_seed = opaque & ((saturation > 0.12) | (value < 0.72))
    background = external_background(foreground_seed, opaque)
    silhouette = opaque & ~background

    masks = {
        "dark_fixed": silhouette & (value < 0.32),
        "skin": silhouette & (value >= 0.32) & (hue >= 8.0) & (hue < 60.0),
        "shorts": silhouette & (value >= 0.32) & (hue >= 70.0) & (hue < 155.0),
        "accent": silhouette & (value >= 0.32) & (hue >= 155.0) & (hue < 215.0),
        "shirt": silhouette & (value >= 0.32) & (hue >= 215.0) & (hue < 270.0),
        "socks": silhouette
        & (value >= 0.32)
        & (saturation > 0.12)
        & ((hue >= 285.0) | (hue <= 3.0)),
    }
    assigned = np.zeros(silhouette.shape, dtype=bool)
    for name in MATERIAL_NAMES:
        masks[name] &= ~assigned
        assigned |= masks[name]
    return {
        "rgb": rgb,
        "hsv": hsv,
        "lab": lab,
        "silhouette": silhouette,
        "background": background,
        "seed_masks": masks,
        "direct_assigned": assigned,
    }


def palette_anchors(seed_data: Mapping[str, Mapping[str, Any]]) -> Dict[str, np.ndarray]:
    anchors: Dict[str, np.ndarray] = {}
    for material in MATERIAL_NAMES:
        samples: List[np.ndarray] = []
        for frame in sorted(seed_data):
            frame_data = seed_data[frame]
            mask = frame_data["seed_masks"][material]
            pixels = frame_data["lab"][mask]
            if len(pixels):
                samples.append(pixels)
        if not samples:
            fail("no direct seed pixels for material {}".format(material))
        anchors[material] = np.median(np.concatenate(samples, axis=0), axis=0).astype(np.float32)
    return anchors


def assign_materials(frame_data: Mapping[str, Any], anchors: Mapping[str, np.ndarray]) -> Dict[str, np.ndarray]:
    masks = {name: np.array(frame_data["seed_masks"][name], copy=True) for name in MATERIAL_NAMES}
    residual = frame_data["silhouette"] & ~frame_data["direct_assigned"]
    if residual.any():
        lab_pixels = frame_data["lab"][residual]
        anchor_matrix = np.stack([anchors[name] for name in MATERIAL_NAMES], axis=0)
        distances = np.sum((lab_pixels[:, None, :] - anchor_matrix[None, :, :]) ** 2, axis=2)
        choices = np.argmin(distances, axis=1)
        ys, xs = np.nonzero(residual)
        for index, material in enumerate(MATERIAL_NAMES):
            chosen = choices == index
            masks[material][ys[chosen], xs[chosen]] = True
    masks["silhouette"] = np.array(frame_data["silhouette"], copy=True)
    masks["background"] = ~masks["silhouette"]
    validate_partition(masks, source_space=True)
    return masks


def validate_partition(masks: Mapping[str, np.ndarray], source_space: bool) -> None:
    if set(masks) != set(MASK_NAMES):
        fail("mask set must contain exactly {}".format(", ".join(MASK_NAMES)))
    shape = masks["silhouette"].shape
    if any(mask.dtype != np.bool_ or mask.shape != shape for mask in masks.values()):
        fail("all masks must be same-size boolean arrays")
    stack = np.stack([masks[name] for name in MATERIAL_NAMES], axis=0)
    overlap = np.sum(stack.astype(np.uint8), axis=0)
    if np.any(overlap > 1):
        fail("material masks overlap")
    union = np.any(stack, axis=0)
    if not np.array_equal(union, masks["silhouette"]):
        fail("material union does not equal silhouette")
    if np.any(masks["silhouette"] & masks["background"]):
        fail("silhouette and background overlap")
    if not np.all(masks["silhouette"] | masks["background"]):
        fail("silhouette and background do not cover the image")
    minimum = MIN_SOURCE_MATERIAL_PIXELS if source_space else 1
    for name in MATERIAL_NAMES:
        if int(masks[name].sum()) < minimum:
            fail("{} mask is empty or too small".format(name))


def logical_resize(array: np.ndarray, width: int, height: int) -> np.ndarray:
    source_height, source_width = array.shape[:2]
    y_index = np.floor((np.arange(height) + 0.5) * source_height / height).astype(np.int64)
    x_index = np.floor((np.arange(width) + 0.5) * source_width / width).astype(np.int64)
    y_index = np.clip(y_index, 0, source_height - 1)
    x_index = np.clip(x_index, 0, source_width - 1)
    return array[y_index[:, None], x_index[None, :]]


def bbox_xyxy(mask: np.ndarray) -> List[int]:
    ys, xs = np.nonzero(mask)
    if not len(xs):
        fail("silhouette is empty")
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


def top_palette(rgb: np.ndarray, mask: np.ndarray, limit: int = 8) -> List[Dict[str, Any]]:
    pixels = rgb[mask]
    packed = (
        (pixels[:, 0].astype(np.uint32) << 16)
        | (pixels[:, 1].astype(np.uint32) << 8)
        | pixels[:, 2].astype(np.uint32)
    )
    colors, counts = np.unique(packed, return_counts=True)
    order = np.lexsort((colors, -counts))[:limit]
    denominator = max(int(mask.sum()), 1)
    result = []
    for index in order:
        color = int(colors[index])
        count = int(counts[index])
        result.append(
            {
                "rgb": [(color >> 16) & 255, (color >> 8) & 255, color & 255],
                "pixels": count,
                "ratio": round_float(count / denominator),
            }
        )
    return result


def unique_rgb_count(rgb: np.ndarray, mask: np.ndarray) -> int:
    pixels = rgb[mask]
    packed = (
        (pixels[:, 0].astype(np.uint32) << 16)
        | (pixels[:, 1].astype(np.uint32) << 8)
        | pixels[:, 2].astype(np.uint32)
    )
    return int(len(np.unique(packed)))


def unique_rgba_count(rgba: np.ndarray) -> int:
    pixels = rgba.reshape(-1, 4).astype(np.uint32)
    packed = (
        (pixels[:, 0].astype(np.uint64) << 24)
        | (pixels[:, 1].astype(np.uint64) << 16)
        | (pixels[:, 2].astype(np.uint64) << 8)
        | pixels[:, 3].astype(np.uint64)
    )
    return int(len(np.unique(packed)))


def median_color(rgb: np.ndarray, lab: np.ndarray, mask: np.ndarray) -> Dict[str, List[float]]:
    rgb_median = np.median(rgb[mask], axis=0)
    lab_median = np.median(lab[mask], axis=0)
    return {
        "rgb": [int(round(value)) for value in rgb_median],
        "lab": [round_float(value) for value in lab_median],
    }


def ratio(mask: np.ndarray, denominator: int) -> float:
    return round_float(int(mask.sum()) / max(denominator, 1))


def purity_metrics(rgb: np.ndarray, background: np.ndarray) -> Dict[str, Any]:
    pure = np.all(rgb == 255, axis=2)
    near = np.all(rgb >= 250, axis=2)
    total = rgb.shape[0] * rgb.shape[1]
    background_pixels = int(background.sum())
    background_median = np.median(rgb[background], axis=0)
    return {
        "definition": {
            "pure_white": "R=G=B=255",
            "near_white_250": "R>=250 and G>=250 and B>=250",
        },
        "all_pixels": {
            "pure_white_ratio": ratio(pure, total),
            "near_white_250_ratio": ratio(near, total),
        },
        "border_connected_background": {
            "pixels": background_pixels,
            "pure_white_ratio": ratio(pure & background, background_pixels),
            "near_white_250_ratio": ratio(near & background, background_pixels),
            "rgb_median": [int(round(value)) for value in background_median],
            "top_exact_rgb": top_palette(rgb, background),
        },
        "adoption_policy": "measured-not-a-fail-condition",
    }


def edge_metrics(lab: np.ndarray, silhouette: np.ndarray) -> Dict[str, Any]:
    pairs: List[np.ndarray] = []
    right_cross = silhouette[:, :-1] != silhouette[:, 1:]
    if right_cross.any():
        pairs.append(np.linalg.norm(lab[:, :-1][right_cross] - lab[:, 1:][right_cross], axis=1))
    down_cross = silhouette[:-1, :] != silhouette[1:, :]
    if down_cross.any():
        pairs.append(np.linalg.norm(lab[:-1, :][down_cross] - lab[1:, :][down_cross], axis=1))
    if not pairs:
        fail("no silhouette boundary crossings")
    delta = np.concatenate(pairs).astype(np.float64)
    return {
        "method": "CIE-Lab deltaE76 across horizontal/vertical silhouette boundary crossings",
        "crossing_count": int(len(delta)),
        "deltaE76_p10": round_float(np.percentile(delta, 10)),
        "deltaE76_median": round_float(np.median(delta)),
        "deltaE76_p90": round_float(np.percentile(delta, 90)),
        "hard_crossing_ratio_deltaE_gte_40": round_float(np.mean(delta >= 40.0)),
        "soft_crossing_ratio_deltaE_lt_15": round_float(np.mean(delta < 15.0)),
        "interpretation": "proxy-only; not an anatomical or candidate acceptance metric",
    }


def build_products(
    images: Mapping[str, np.ndarray],
    source_metadata: Mapping[str, Mapping[str, Any]],
) -> Tuple[Dict[str, Any], Dict[str, bytes]]:
    if set(images) != {"F2", "F3"} or set(source_metadata) != {"F2", "F3"}:
        fail("Phase 2A requires exactly adopted F2 and F3")
    seeded = {frame: direct_seed_masks(images[frame]) for frame in ("F2", "F3")}
    anchors = palette_anchors(seeded)
    files: Dict[str, bytes] = {}
    frames: Dict[str, Any] = {}
    area_ratios: Dict[str, Dict[str, float]] = {}

    for frame in ("F2", "F3"):
        frame_data = seeded[frame]
        masks = assign_materials(frame_data, anchors)
        silhouette_pixels = int(masks["silhouette"].sum())
        direct_coverage = ratio(frame_data["direct_assigned"], silhouette_pixels)
        if direct_coverage < MIN_DIRECT_SEED_COVERAGE:
            fail("{} direct HSV seed coverage below Phase 2A extraction invariant".format(frame))

        bbox = bbox_xyxy(masks["silhouette"])
        x0, y0, x1, y1 = bbox
        crop_width, crop_height = x1 - x0, y1 - y0
        logical_width = max(1, int(round(crop_width * LOGICAL_BODY_HEIGHT / crop_height)))
        logical_height = LOGICAL_BODY_HEIGHT

        logical_masks: Dict[str, np.ndarray] = {}
        for name in MASK_NAMES:
            crop = masks[name][y0:y1, x0:x1]
            logical_masks[name] = logical_resize(crop, logical_width, logical_height).astype(bool)
        validate_partition(logical_masks, source_space=False)

        rgb_crop = frame_data["rgb"][y0:y1, x0:x1]
        logical_rgb = logical_resize(rgb_crop, logical_width, logical_height).astype(np.uint8)
        logical_rgba = np.dstack(
            (logical_rgb, logical_masks["silhouette"].astype(np.uint8) * 255)
        )

        preview_path = relative_output_path(frame, "preview.png")
        preview_bytes = stable_png_bytes(logical_rgba, "RGBA")
        files[preview_path] = preview_bytes
        output_masks: Dict[str, Any] = {}
        for name in MASK_NAMES:
            relative = relative_output_path(frame, "masks/{}.png".format(name))
            data = stable_png_bytes(logical_masks[name].astype(np.uint8) * 255, "L")
            files[relative] = data
            output_masks[name] = {
                "path": relative,
                "sha256": sha256_bytes(data),
                "dimensions": [logical_width, logical_height],
                "mode": "L",
            }

        source_area = {
            name: ratio(masks[name], silhouette_pixels) for name in MATERIAL_NAMES
        }
        logical_silhouette_pixels = int(logical_masks["silhouette"].sum())
        logical_area = {
            name: ratio(logical_masks[name], logical_silhouette_pixels) for name in MATERIAL_NAMES
        }
        area_ratios[frame] = source_area
        colors = {
            name: {
                "median": median_color(frame_data["rgb"], frame_data["lab"], masks[name]),
                "top_exact_rgb": top_palette(frame_data["rgb"], masks[name]),
            }
            for name in MATERIAL_NAMES
        }
        scale_x = logical_width / crop_width
        scale_y = logical_height / crop_height
        frames[frame] = {
            "source": dict(source_metadata[frame]),
            "normalization": {
                "source_body_bbox_xyxy_exclusive": bbox,
                "source_body_bbox_dimensions": [crop_width, crop_height],
                "logical_dimensions": [logical_width, logical_height],
                "logical_body_height_px": LOGICAL_BODY_HEIGHT,
                "resampling": "nearest-neighbor pixel-center floor only",
                "source_edge_to_logical_edge_affine_2x3": [
                    round_float(scale_x),
                    0.0,
                    round_float(-x0 * scale_x),
                    0.0,
                    round_float(scale_y),
                    round_float(-y0 * scale_y),
                ],
                "logical_pixel_to_source_index": "floor((logical_index + 0.5) * source_extent / logical_extent) + crop_origin",
            },
            "outputs": {
                "preview": {
                    "path": preview_path,
                    "sha256": sha256_bytes(preview_bytes),
                    "dimensions": [logical_width, logical_height],
                    "mode": "RGBA",
                },
                "masks": output_masks,
            },
            "metrics": {
                "source_dimensions": list(frame_data["rgb"].shape[1::-1]),
                "source_silhouette_pixels": silhouette_pixels,
                "direct_hsv_seed_coverage_ratio": direct_coverage,
                "residual_lab_assignment_ratio": round_float(1.0 - direct_coverage),
                "material_area_ratio_of_source_silhouette": source_area,
                "material_area_ratio_of_logical_silhouette": logical_area,
                "material_color_facts": colors,
                "background_purity": purity_metrics(frame_data["rgb"], masks["background"]),
                "edge_hardness_antialias_proxy": edge_metrics(frame_data["lab"], masks["silhouette"]),
                "source_unique_rgb_in_silhouette": unique_rgb_count(
                    frame_data["rgb"], masks["silhouette"]
                ),
                "logical_unique_rgba_in_preview": unique_rgba_count(logical_rgba),
                "head_body_ratio": {
                    "status": "unavailable",
                    "reason": "color-only material segmentation cannot isolate hair-crown-to-chin reliably",
                },
            },
        }

    deltas = {
        name: round_float(abs(area_ratios["F2"][name] - area_ratios["F3"][name]))
        for name in MATERIAL_NAMES
    }
    if max(deltas.values()) > MAX_CROSS_FRAME_AREA_RATIO_DELTA:
        fail("F2/F3 material area ratios are not stable enough for Phase 2A extraction")

    anchor_facts = {
        name: [round_float(value) for value in anchors[name]] for name in MATERIAL_NAMES
    }
    registry: Dict[str, Any] = {
        "schema": "cutscene-style-calibration",
        "schema_version": 1,
        "calibration_version": "manga190-phase2a-v1",
        "style_profile": "MANGA_190_V1",
        "status": {
            "phase": "phase2a-deterministic-style-extraction",
            "extraction_verification": "passed",
            "independent_review": INDEPENDENT_REVIEW_STATUS,
            "calibration_status": "not-calibrated",
            "candidate_gate": "locked",
            "ct4d_final_art_reproduction": "not-established",
        },
        "scope": {
            "facts_only": True,
            "anatomical_left_right_inference": "forbidden",
            "candidate_evaluation": "forbidden",
            "image_generation": "forbidden",
        },
        "method": {
            "algorithm": "manga190-hsv-lab-material-partition-v1",
            "color_spaces": ["sRGB uint8", "OpenCV HSV float H=degrees S/V=0..1", "OpenCV CIE-Lab float"],
            "hsv_rules": HSV_RULES,
            "silhouette": "complement of border-connected low-saturation/high-value background; retains enclosed white details",
            "residual_assignment": "nearest global F2+F3 direct-seed median in CIE-Lab",
            "global_lab_palette_anchors": anchor_facts,
            "logical_normalization": {
                "body_height_px": LOGICAL_BODY_HEIGHT,
                "resampling": "nearest-neighbor pixel-center floor only",
                "quantization": "none",
            },
            "extraction_invariants": {
                "minimum_direct_seed_coverage_ratio": MIN_DIRECT_SEED_COVERAGE,
                "maximum_f2_f3_material_area_ratio_delta": MAX_CROSS_FRAME_AREA_RATIO_DELTA,
                "minimum_source_pixels_per_material": MIN_SOURCE_MATERIAL_PIXELS,
                "candidate_acceptance_thresholds": "none",
            },
        },
        "frames": frames,
        "cross_frame_measurements": {
            "material_area_ratio_absolute_delta": deltas,
            "maximum_observed_delta": round_float(max(deltas.values())),
            "interpretation": "extraction consistency only; not a candidate acceptance threshold",
        },
        "caveats": [
            "Color masks are material classes, not anatomical left/right or limb-instance masks.",
            "Low-saturation enclosed details are assigned by nearest Lab palette anchor and may combine shoe marks, eye whites, or kit trim.",
            "Pure-white and near-white background ratios are reported separately and do not invalidate adopted F2/F3.",
            "Head/body ratio is unavailable until a geometry or approved head-boundary source is provided.",
            "Accepted 2D finish measurements do not establish that CT4D can reproduce final kick art.",
        ],
    }
    return registry, files


def expected_products(root: Path) -> Tuple[Dict[str, Any], Dict[str, bytes]]:
    ensure_locked_manifest(root)
    images, metadata = load_sources(root)
    return build_products(images, metadata)


def output_dir(root: Path) -> Path:
    return lexical_under_root(root, OUTPUT_REL, "calibration output")


def verify_output_tree(
    root: Path,
    tree: Path,
    expected_registry: Mapping[str, Any],
    expected_files: Mapping[str, bytes],
    label: str,
) -> None:
    files_in_tree = scan_tree_no_symlinks(root, tree, label)
    registry_path = tree / REGISTRY_NAME
    reject_symlink_components(root, registry_path, "{} registry".format(label))
    try:
        registry_mode = os.lstat(str(registry_path)).st_mode
    except OSError:
        fail("missing calibration registry: {}".format(registry_path))
    if not stat.S_ISREG(registry_mode):
        fail("calibration registry is not a regular file: {}".format(registry_path))

    actual_registry_bytes = registry_path.read_bytes()
    expected_registry_bytes = stable_json_bytes(expected_registry)
    if actual_registry_bytes != expected_registry_bytes:
        fail("calibration registry is stale, non-deterministic, or tampered")
    try:
        actual_registry = json.loads(actual_registry_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail("invalid calibration registry: {}".format(exc))
    if actual_registry.get("status", {}).get("calibration_status") != "not-calibrated":
        fail("Phase 2A calibration status must remain not-calibrated")
    if actual_registry.get("status", {}).get("candidate_gate") != "locked":
        fail("Phase 2A candidate gate must remain locked")

    expected_paths = {output_suffix(relative).as_posix() for relative in expected_files}
    expected_paths.add(REGISTRY_NAME)
    actual_paths = {path.relative_to(tree).as_posix() for path in files_in_tree}
    if actual_paths != expected_paths:
        fail(
            "calibration output file set mismatch; missing={}, extra={}".format(
                sorted(expected_paths - actual_paths), sorted(actual_paths - expected_paths)
            )
        )

    # Validate the stored raster contract itself before comparing deterministic bytes,
    # so malformed dimensions and overlapping masks fail for their semantic reason.
    for frame in ("F2", "F3"):
        outputs = actual_registry["frames"][frame]["outputs"]
        preview_entry = outputs["preview"]
        preview_path = tree / output_suffix(preview_entry["path"])
        reject_symlink_components(root, preview_path, "{} preview".format(frame))
        with Image.open(preview_path) as preview:
            if list(preview.size) != preview_entry["dimensions"] or preview.mode != "RGBA":
                fail("{} preview dimensions or mode mismatch".format(frame))
        stored_masks: Dict[str, np.ndarray] = {}
        if set(outputs["masks"]) != set(MASK_NAMES):
            fail("{} registry mask set is incomplete".format(frame))
        for name in MASK_NAMES:
            entry = outputs["masks"][name]
            path = tree / output_suffix(entry["path"])
            reject_symlink_components(root, path, "{} {} mask".format(frame, name))
            with Image.open(path) as image:
                if list(image.size) != entry["dimensions"] or image.mode != "L":
                    fail("{} {} mask dimensions or mode mismatch".format(frame, name))
                array = np.asarray(image, dtype=np.uint8)
            if not np.all((array == 0) | (array == 255)):
                fail("{} {} mask is not binary".format(frame, name))
            stored_masks[name] = array == 255
        validate_partition(stored_masks, source_space=False)

    for relative, expected in sorted(expected_files.items()):
        path = tree / output_suffix(relative)
        reject_symlink_components(root, path, "calibration output")
        try:
            mode = os.lstat(str(path)).st_mode
        except OSError:
            fail("missing calibration output: {}".format(relative))
        if not stat.S_ISREG(mode):
            fail("calibration output is not a regular file: {}".format(relative))
        actual = path.read_bytes()
        if actual != expected:
            fail("calibration output byte mismatch: {}".format(relative))
        with Image.open(path) as image:
            declared = None
            for frame in ("F2", "F3"):
                outputs = actual_registry["frames"][frame]["outputs"]
                candidates = [outputs["preview"]] + list(outputs["masks"].values())
                for entry in candidates:
                    if entry["path"] == relative:
                        declared = entry
                        break
                if declared:
                    break
            if declared is None:
                fail("output is not SHA-bound in calibration registry: {}".format(relative))
            if sha256_bytes(actual) != declared["sha256"]:
                fail("registry SHA-256 mismatch: {}".format(relative))
            if list(image.size) != declared["dimensions"] or image.mode != declared["mode"]:
                fail("output dimensions or mode mismatch: {}".format(relative))


def atomic_install(root: Path, staging: Path, destination: Path) -> None:
    parent = destination.parent
    reject_symlink_components(root, parent, "calibration parent")
    if os.path.lexists(str(destination)):
        scan_tree_no_symlinks(root, destination, "existing calibration output")
    backup = parent / ".manga190.backup-{}".format(uuid.uuid4().hex)
    if os.path.lexists(str(backup)):
        fail("refusing existing calibration backup path: {}".format(backup))
    moved_previous = False
    try:
        if os.path.lexists(str(destination)):
            os.replace(str(destination), str(backup))
            moved_previous = True
    except OSError as exc:
        fail_after_cleanup(
            root,
            ((staging, "calibration staging"),),
            "atomic calibration first rename failed; canonical output unchanged: {}".format(exc),
        )

    try:
        os.replace(str(staging), str(destination))
    except OSError as exc:
        if moved_previous:
            try:
                os.replace(str(backup), str(destination))
            except OSError as rollback_exc:
                staging_cleanup = remove_created_tree(root, staging, "calibration staging")
                suffix = ""
                if staging_cleanup:
                    suffix = "; staging cleanup incomplete at {}: {}".format(staging, staging_cleanup)
                fail(
                    "atomic calibration second rename failed and rollback could not restore canonical; "
                    "recover previous canonical from backup at {}; install={}, rollback={}{}".format(
                        backup, exc, rollback_exc, suffix
                    )
                )
            fail_after_cleanup(
                root,
                ((staging, "calibration staging"),),
                "atomic calibration second rename failed; previous canonical restored: {}".format(exc),
            )
        fail_after_cleanup(
            root,
            ((staging, "calibration staging"),),
            "atomic calibration fresh install rename failed; canonical output remains absent: {}".format(exc),
        )

    if moved_previous:
        cleanup_error = remove_created_tree(root, backup, "calibration backup")
        if cleanup_error:
            fail(
                "new calibration is installed and verified, but exact backup cleanup failed at {}: {}".format(
                    backup, cleanup_error
                )
            )


def extract(root: Path) -> None:
    registry, files = expected_products(root)
    parent = secure_mkdirs(root, OUTPUT_REL.parent, "calibration parent")
    destination = output_dir(root)
    reject_symlink_components(root, destination, "calibration output", allow_missing_tail=True)
    if os.path.lexists(str(destination)):
        scan_tree_no_symlinks(root, destination, "existing calibration output")

    try:
        staging = Path(tempfile.mkdtemp(prefix=".manga190.tmp-", dir=str(parent)))
    except OSError as exc:
        fail("cannot create calibration staging directory: {}".format(exc))
    reject_symlink_components(root, staging, "calibration staging")

    try:
        for relative, data in sorted(files.items()):
            suffix = output_suffix(relative)
            path = staging / suffix
            path.parent.mkdir(parents=True, exist_ok=True)
            reject_symlink_components(root, path.parent, "calibration staging parent")
            write_bytes(path, data)
        write_bytes(staging / REGISTRY_NAME, stable_json_bytes(registry))
        verify_output_tree(root, staging, registry, files, "calibration staging")
    except CalibrationFailure as exc:
        fail_after_cleanup(
            root,
            ((staging, "calibration staging"),),
            "calibration staging verification failed; canonical output unchanged: {}".format(exc),
        )
    except Exception as exc:
        fail_after_cleanup(
            root,
            ((staging, "calibration staging"),),
            "calibration staging write failed; canonical output unchanged: {}".format(exc),
        )
    atomic_install(root, staging, destination)


def verify(root: Path) -> None:
    expected_registry, expected_files = expected_products(root)
    destination = output_dir(root)
    reject_symlink_components(root, destination, "calibration output")
    verify_output_tree(root, destination, expected_registry, expected_files, "calibration output")


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("extract", "verify"))
    parser.add_argument("--artifact-root", type=Path, default=REPO)
    return parser.parse_args(argv)


def main(argv: Sequence[str] = ()) -> int:
    args = parse_args(argv or sys.argv[1:])
    root = args.artifact_root.resolve()
    try:
        if args.mode == "extract":
            extract(root)
            print("PASS deterministic F2/F3 Phase 2A extraction and verification")
        else:
            verify(root)
            print("PASS deterministic F2/F3 Phase 2A verification")
        print("LOCKED calibration_status=not-calibrated candidate_gate=locked")
        return 0
    except CalibrationFailure as exc:
        print("FAIL {}".format(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
