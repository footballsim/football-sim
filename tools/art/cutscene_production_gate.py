#!/usr/bin/env python3
"""Fail-closed Phase 1 authority verification gate for cutscene production."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


REPO = Path(__file__).resolve().parents[2]
MANIFEST_NAME = "design/CUTSCENE_PRODUCTION_MANIFEST.json"
CERTIFICATION_LEVELS = ("Frame", "Sequence", "Pose class", "Action family", "Lane", "System")
BENCHMARK_ARTIFACT_KEYS = {
    "F2": ("adopted_png", "pose", "pose_rig"),
    "F3": ("adopted_png", "pose", "pose_rig"),
    "F4": ("pose", "pose_rig", "semantic_surface", "review", "overlay", "exact_control"),
}
CANONICAL_FIXED_PATHS = {
    "CUTSCENE_HANDOFF.md",
    "design/CUTSCENE_PRODUCTION_SYSTEM.md",
    "design/SHORTPASS_APPROVAL.json",
    MANIFEST_NAME,
}
CHARACTER_FIELDS = ("bodyPreset", "kitTemplate", "headSet", "skinTone", "hairStyle", "expression", "goalkeeper", "gloves")
EXPECTED_CHARACTER = {
    "bodyPreset": "outfield_male_v1", "kitTemplate": "standard_outfield_v1", "headSet": "01_spiky_twoblock",
    "skinTone": "skin_03", "hairStyle": "spiky_twoblock", "expression": "focused", "goalkeeper": False, "gloves": False,
}
EXPECTED_COORDINATE_CONTRACT = {
    "source": "source rig", "pose_render": "pose render", "logical_height_px": 190,
    "review_scale": "nearest", "runtime": "runtime",
    "interpolation": "no interpolation before pose render; nearest-neighbor only after logical sprite export",
}
EXPECTED_AUTHORITY_POLICY = {
    "canonical_root": "repository root", "tracked_required": True,
    "ignored_authority_forbidden": True, "candidate_adoption_requires_user_gate": True,
    "f5_f6_progression": "forbidden", "f4_body_adoption": "forbidden",
}
EXPECTED_PROHIBITED_PROGRESS = ["F5", "F6", "adopted-F4-body", "runtime-integration", "build", "push", "deploy"]
EXPECTED_CERTIFICATION = {level: "not-certified" for level in CERTIFICATION_LEVELS}
EXPECTED_CHARACTER_AUTHORITY_KEYS = {"bodyCanon", "headCanon", "f3VisionCalibration", "viewClass", "depthClass", "visibility", "sideIdentity"}
EXPECTED_CHARACTER_AUTHORITY_SCALARS = {"viewClass": "PROFILE_R", "depthClass": "CROSSED", "visibility": "per-frame visible-limb contract"}
EXPECTED_CHARACTER_AUTHORITY_SIDES = {"supportLeg": "left", "kickingLeg": "right", "leftArm": "omit when fully occluded", "rightArm": "orange authority where visible"}
EXPECTED_ARTIFACTS = {
    "bodyCanon": {"path": "design/reference/player_body_canon_measurement.png", "sha256": "d584fc6213ac02b5ebf9012f9045ccc2a3d4b42e7f70d7e42b6f2a32eb1437b2", "dimensions": [1192, 740], "mode": "RGB"},
    "headCanon": {"path": "design/shortpass-approval/profile-right-approved.png", "sha256": "15d5da45303b454c2e8bcfbc03317d019f128ba671818f1e9bec9bf845bb39af", "dimensions": [271, 356], "mode": "RGB"},
    "f3VisionCalibration": {"path": "design/shortpass-approval/f3-vision-calibration.json", "sha256": "0428ebe7c439f706cccc8b62bfa146934a41839c39b1cefe46cc224eb2379ad2"},
    "F2.adopted_png": {"path": "img/cutscenes/manga_shortpass6/frame_02.png", "sha256": "b88e22e17b0d1bacd65268122ce68313e41c8e999d3bb464dbbf6224e7811b0e", "dimensions": [1442, 1870], "mode": "RGBA"},
    "F2.pose": {"path": "design/shortpass-approval/pose-approved-f02.png", "sha256": "9a513e4a6e13e7afc9b809a3fb80d3518b1da5a0e262a053638db9d2ac4e73dc", "dimensions": [640, 360], "mode": "RGB"},
    "F2.pose_rig": {"path": "design/shortpass-approval/pose-rig-derived-f02.png", "sha256": "898677a96b712b4f8956cf92f4432a812cb59f8045e8d6265228ec4b4a53367a", "dimensions": [768, 1024], "mode": "RGB"},
    "F3.adopted_png": {"path": "img/cutscenes/manga_shortpass6/frame_03.png", "sha256": "df54ea8579474747ca0357521868e0a38aa951fefa337f437ff435177d7d6bfa", "dimensions": [1474, 1682], "mode": "RGBA"},
    "F3.pose": {"path": "design/shortpass-approval/pose-approved-f03.png", "sha256": "ac32d57c20de6d6568a4f5dba3e9dc96ac2af369a8388b572fe8111e3017bba3", "dimensions": [640, 360], "mode": "RGB"},
    "F3.pose_rig": {"path": "design/shortpass-approval/pose-rig-derived-f03.png", "sha256": "3f08968c9270f2268f6a30ed0c219894a0bc8a28bcebad444db04c3dfedb9a57", "dimensions": [768, 1024], "mode": "RGB"},
    "F4.pose": {"path": "design/shortpass-approval/pose-approved-f04.png", "sha256": "ef6c5507b3b1151545bee5b274c1a1a1ab94b19fd5968633fa5b6de675d3ff6d", "dimensions": [640, 360], "mode": "RGB"},
    "F4.pose_rig": {"path": "design/shortpass-approval/pose-rig-derived-f04.png", "sha256": "df76a8d5b045a38041d430c05fa3657a7c5d0e7892a14fb2f39b5704c878cac8", "dimensions": [768, 1024], "mode": "RGB"},
    "F4.semantic_surface": {"path": "design/cutscene-production/shortpass/f4/semantic-trace.png", "sha256": "d30a64e8032f2b941ab5d0efdd13abec80e5557ecb2cbfbecd067fb3642df0e7", "dimensions": [640, 360], "mode": "RGB"},
    "F4.review": {"path": "design/cutscene-production/shortpass/f4/review.png", "sha256": "6925bb9316b385997e69a7d664e1170420dad71fb2396ee4e8bf4c61c7eec6e9", "dimensions": [1600, 1348], "mode": "RGB"},
    "F4.overlay": {"path": "design/cutscene-production/shortpass/f4/overlay.png", "sha256": "7970afef912e41c241ace254068c910b51bbf8a88e506eca8de9def656121e55", "dimensions": [640, 360], "mode": "RGB"},
    "F4.exact_control": {"path": "design/cutscene-production/shortpass/f4/exact-control.png", "sha256": "526e0c7416f52ade7d883c252b365f1eb7e4ef97721af682cf7b60d58759da2e", "dimensions": [1113, 1414], "mode": "RGB"},
}
EXPECTED_FRAME_CONTRACTS = {
    "F2": {"status": "user-adopted", "adoption": "adopted", "actionFamily": "GROUND_KICK", "viewClass": "PROFILE_R", "depthClass": "PLANAR", "view": {"class": "PROFILE_R", "direction": "right"}, "depth": "PLANAR", "visibility": {"leftArm": "visible", "rightArm": "visible", "leftLeg": "visible", "rightLeg": "visible"}, "sideIdentity": {"supportLeg": "left", "kickingLeg": "right", "leftArm": "left", "rightArm": "right"}},
    "F3": {"status": "user-adopted", "adoption": "adopted", "actionFamily": "GROUND_KICK", "viewClass": "PROFILE_R", "depthClass": "PLANAR", "view": {"class": "PROFILE_R", "direction": "right"}, "depth": "PLANAR", "visibility": {"leftArm": "visible", "rightArm": "visible", "leftLeg": "visible", "rightLeg": "visible"}, "sideIdentity": {"supportLeg": "left", "kickingLeg": "right", "leftArm": "left", "rightArm": "right"}},
    "F4": {"status": "trace-only", "adoption": "not-adopted", "actionFamily": "GROUND_KICK", "viewClass": "PROFILE_R", "depthClass": "CROSSED", "view": {"class": "PROFILE_R", "direction": "right"}, "depth": "CROSSED", "visibility": {"leftArm": "occluded", "rightArm": "visible", "leftLeg": "visible", "rightLeg": "visible"}, "sideIdentity": {"supportLeg": "left", "kickingLeg": "right", "leftArm": "occluded", "rightArm": "right"}},
}
CONTRACT_KEYS = ("status", "adoption", "actionFamily", "viewClass", "depthClass", "view", "depth", "visibility", "sideIdentity", "character")
TOP_LEVEL_KEYS = {"schema", "schema_version", "manifest_version", "authority_pack_version", "status", "calibration_status", "styleProfile", "coordinate_contract", "authority_policy", "character", "benchmarks", "certification", "prohibited_progression", "authority_paths"}
GENERATION_PHASE = "phase1-authority-verification-only"


class GateFailure(Exception):
    pass


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def png_info(path: Path) -> tuple[list[int], str] | None:
    """Return PNG dimensions and a stable color mode without requiring Pillow."""
    with path.open("rb") as stream:
        header = stream.read(26)
    if len(header) < 26 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        return None
    width, height, _depth, color_type = struct.unpack(">IIBB", header[16:26])
    modes = {0: "L", 2: "RGB", 3: "P", 4: "LA", 6: "RGBA"}
    return [width, height], modes.get(color_type, "unknown")


def fail(message: str) -> None:
    raise GateFailure(message)


def load_manifest(root: Path, path: Path) -> dict[str, Any]:
    if not path.is_file():
        fail(f"missing manifest: {path}")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"invalid manifest: {path}: {exc}")
    if not isinstance(manifest, dict):
        fail("manifest root must be an object")
    if "thresholds" in manifest:
        fail("Phase 1 manifest must not contain evaluation thresholds")
    evaluation = manifest.get("evaluation")
    if evaluation is not None and (not isinstance(evaluation, dict) or "thresholds" in evaluation):
        fail("Phase 1 manifest must not contain evaluation thresholds; evaluation must be an object without thresholds")
    if set(manifest) != TOP_LEVEL_KEYS:
        fail("manifest top-level keys do not match the canonical schema")
    for key in ("schema", "schema_version", "manifest_version", "authority_pack_version", "status", "benchmarks", "authority_paths"):
        if key not in manifest:
            fail(f"manifest missing required key: {key}")
    if manifest["schema"] != "cutscene-production-manifest" or type(manifest["schema_version"]) is not int or manifest["schema_version"] != 1:
        fail("unsupported manifest schema")
    if manifest["manifest_version"] != "phase1-v1":
        fail("manifest_version must be phase1-v1")
    if manifest["authority_pack_version"] != "shortpass-authority-v1":
        fail("authority_pack_version must be shortpass-authority-v1")
    if manifest["status"] != "phase1-authority-verification-only":
        fail(f"manifest status is not fail-closed Phase 1: {manifest['status']}")
    if manifest["styleProfile"] != "MANGA_190_V1":
        fail("manifest styleProfile must be MANGA_190_V1")
    coordinate = manifest.get("coordinate_contract")
    if (coordinate != EXPECTED_COORDINATE_CONTRACT or
            type(coordinate.get("logical_height_px")) is not int):
        fail("coordinate_contract does not match MANGA_190_V1 authority contract")
    if manifest.get("calibration_status") != "not-calibrated":
        fail("candidate evaluator calibration status must remain not-calibrated in Phase 1")
    policy = manifest.get("authority_policy", {})
    if (policy != EXPECTED_AUTHORITY_POLICY or
            any(type(policy[key]) is not bool for key in ("tracked_required", "ignored_authority_forbidden", "candidate_adoption_requires_user_gate"))):
        fail("authority_policy does not match the canonical fail-closed policy")
    prohibited = manifest.get("prohibited_progression")
    if (not isinstance(prohibited, list) or prohibited != EXPECTED_PROHIBITED_PROGRESS or
            len(prohibited) != len(set(prohibited))):
        fail("prohibited_progression must exactly forbid F5/F6 and integration actions")
    benchmarks = manifest.get("benchmarks")
    if not isinstance(benchmarks, dict) or set(benchmarks) != {"F2", "F3", "F4"}:
        fail("benchmarks must contain exactly F2, F3, and F4")
    certification = manifest.get("certification", {})
    if certification != EXPECTED_CERTIFICATION:
        fail("Frame/Sequence/Pose class/Action family/Lane/System must remain not-certified")
    return manifest


def rel_path(root: Path, value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        resolved = path.resolve()
    else:
        resolved = (root / path).resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError:
        fail(f"path escapes artifact root: {value}")
    return resolved


def verify_approval_lock(root: Path) -> None:
    path = root / "design" / "SHORTPASS_APPROVAL.json"
    try:
        approval = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"missing or invalid approval ledger: {path}")
    gate = approval.get("generation_gate") if isinstance(approval, dict) else None
    if (not isinstance(gate, dict) or type(gate.get("enabled")) is not bool or gate.get("enabled") is not False or
            not isinstance(gate.get("phase"), str) or gate.get("phase") != GENERATION_PHASE):
        fail("approval generation gate must be disabled for Phase 1 authority verification")
    for key in ("candidate_evaluator_lock", "candidate_lock"):
        if key in gate and (not isinstance(gate[key], dict) or gate[key].get("locked") is not True):
            fail(f"approval {key} must remain locked")


def verify_artifact(root: Path, label: str, entry: dict[str, Any], expected_dimensions: list[int] | None = None, png_required: bool = True) -> None:
    if not isinstance(entry, dict) or not isinstance(entry.get("path"), str) or not isinstance(entry.get("sha256"), str):
        fail(f"{label}: malformed artifact entry")
    expected_keys = {"path", "sha256", "dimensions", "mode"} if png_required else {"path", "sha256"}
    if set(entry) != expected_keys or not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]):
        fail(f"{label}: artifact schema or SHA-256 format mismatch")
    dimensions = entry.get("dimensions")
    if png_required and (not isinstance(dimensions, list) or len(dimensions) != 2 or
                         any(type(value) is not int for value in dimensions) or not isinstance(entry.get("mode"), str)):
        fail(f"{label}: invalid PNG dimensions or mode")
    path = rel_path(root, entry["path"])
    if not path.is_file():
        fail(f"{label}: missing {path}")
    actual = digest(path)
    if actual != entry["sha256"]:
        fail(f"{label}: SHA-256 mismatch; expected {entry['sha256']}, actual {actual}")
    info = png_info(path)
    if png_required and info is None:
        fail(f"{label}: expected PNG authority")
    if not png_required:
        print(f"PASS {label}: {entry['path']}")
        return
    declared_dimensions = entry.get("dimensions")
    if expected_dimensions is not None and declared_dimensions != expected_dimensions:
        fail(f"{label}: dimensions mismatch in manifest")
    if info[0] != declared_dimensions:
        fail(f"{label}: actual dimensions {info[0]} do not match manifest {declared_dimensions}")
    if entry.get("mode") and info[1] != entry["mode"]:
        fail(f"{label}: actual mode {info[1]} does not match manifest {entry['mode']}")
    print(f"PASS {label}: {entry['path']}")


def git_tracked(root: Path, relative: str) -> bool:
    result = subprocess.run(
        ["git", "-C", str(root), "ls-files", "--error-unmatch", "--", relative],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


def verify_tracked_authority(root: Path, manifest: dict[str, Any], skip: bool) -> None:
    listed = manifest.get("authority_paths")
    if not isinstance(listed, list) or any(not isinstance(path, str) for path in listed):
        fail("authority_paths must be a list of strings")
    normalized = [Path(path).as_posix() for path in listed]
    if any(original != canonical for original, canonical in zip(listed, normalized)):
        fail("authority_paths contains a non-normalized path")
    if len(normalized) != len(set(normalized)):
        fail("authority_paths contains duplicate paths")
    if any(Path(path).is_absolute() or path == "." or ".." in Path(path).parts for path in normalized):
        fail("authority_paths contains a non-normalized path")
    if any(path.startswith("tools/proto/") for path in normalized):
        fail("authority_paths cannot reference tools/proto")
    required = set(CANONICAL_FIXED_PATHS)
    for frame, keys in BENCHMARK_ARTIFACT_KEYS.items():
        entry = manifest.get("benchmarks", {}).get(frame)
        if not isinstance(entry, dict):
            fail(f"missing benchmark for tracked authority: {frame}")
        for key in keys:
            artifact = entry.get(key)
            if not isinstance(artifact, dict) or not isinstance(artifact.get("path"), str):
                fail(f"missing canonical authority path: {frame}.{key}")
            required.add(artifact["path"])
    required.update({
        manifest["character"]["bodyCanon"]["path"],
        manifest["character"]["headCanon"]["path"],
        manifest["character"]["f3VisionCalibration"]["path"],
    })
    if set(normalized) != required:
        fail(f"authority_paths must exactly match canonical set; missing={sorted(required - set(normalized))}, extra={sorted(set(normalized) - required)}")
    if skip:
        fixture = root / ".cutscene-gate-test-fixture"
        temp_root = Path(tempfile.gettempdir()).resolve()
        try:
            is_temp_root = root.is_relative_to(temp_root)
        except AttributeError:
            is_temp_root = str(root).startswith(str(temp_root) + os.sep)
        if (root == REPO or not is_temp_root or not (root / ".git").is_dir() or
                not fixture.is_file() or os.environ.get("CUTSCENE_GATE_TEST_FIXTURE") != "1"):
            fail("--skip-git-tracked-check is allowed only for explicit non-production git fixtures")
        print("INFO tracked-authority check skipped explicitly for test fixture")
        return
    for relative in sorted(required):
        if not git_tracked(root, relative):
            fail(f"authority is not git-tracked: {relative}")
    print(f"PASS tracked authority: {len(required)} canonical paths")


def verify_frame_contract(frame: str, entry: dict[str, Any]) -> None:
    expected = EXPECTED_FRAME_CONTRACTS[frame]
    for key in CONTRACT_KEYS:
        if key not in entry:
            fail(f"{frame} benchmark missing required contract key: {key}")
    if any(key not in CONTRACT_KEYS and key not in BENCHMARK_ARTIFACT_KEYS[frame] for key in entry):
        fail(f"{frame} benchmark contains an unexpected contract field")
    if any(entry.get(key) != value for key, value in expected.items()):
        fail(f"{frame} frame contract does not match the canonical contract")
    character = entry["character"]
    if not isinstance(character, dict) or set(character) != set(CHARACTER_FIELDS):
        fail(f"{frame}.character must define exactly {CHARACTER_FIELDS}")
    for key in CHARACTER_FIELDS:
        if not isinstance(character[key], (str, bool)):
            fail(f"{frame}.character.{key} has invalid type")
    if not all(isinstance(character[key], str) for key in CHARACTER_FIELDS[:6]):
        fail(f"{frame}.character identity fields must be strings")
    if not all(isinstance(character[key], bool) for key in CHARACTER_FIELDS[6:]):
        fail(f"{frame}.character goalkeeper/gloves must be booleans")
    if character != EXPECTED_CHARACTER:
        fail(f"{frame}.character does not match the canonical character contract")


def verify_canon_authority(root: Path, manifest: dict[str, Any]) -> None:
    character = manifest.get("character")
    if not isinstance(character, dict) or set(character) != EXPECTED_CHARACTER_AUTHORITY_KEYS:
        fail("manifest character authority is missing")
    if any(character.get(key) != value for key, value in EXPECTED_CHARACTER_AUTHORITY_SCALARS.items()):
        fail("top-level character authority does not match the canonical contract")
    sides = character.get("sideIdentity")
    if not isinstance(sides, dict) or sides != EXPECTED_CHARACTER_AUTHORITY_SIDES:
        fail("top-level character sideIdentity does not match the canonical contract")
    for key, png in (("bodyCanon", True), ("headCanon", True), ("f3VisionCalibration", False)):
        entry = character.get(key)
        if not isinstance(entry, dict):
            fail(f"character.{key} must be an artifact object")
        expected = EXPECTED_ARTIFACTS[key]
        if entry != expected:
            fail(f"character {key}: artifact does not match independent trust anchor")
        verify_artifact(root, f"character {key}", entry, entry.get("dimensions"), png_required=png)


def benchmark_entry(manifest: dict[str, Any], frame: str) -> dict[str, Any]:
    entry = manifest.get("benchmarks", {}).get(frame)
    if not isinstance(entry, dict):
        fail(f"missing benchmark {frame}")
    if frame in ("F2", "F3") and entry.get("status") != "user-adopted":
        fail(f"{frame} must be user-adopted")
    if frame == "F4" and (entry.get("status") != "trace-only" or entry.get("adoption") != "not-adopted"):
        fail("F4 must remain trace-only/not-adopted")
    verify_frame_contract(frame, entry)
    return entry


def verify_benchmark_authority(root: Path, manifest: dict[str, Any], frame: str) -> None:
    entry = benchmark_entry(manifest, frame)
    if frame in ("F2", "F3"):
        adopted = entry.get("adopted_png")
        if not adopted:
            fail(f"{frame} missing adopted PNG")
        if adopted != EXPECTED_ARTIFACTS[f"{frame}.adopted_png"]:
            fail(f"{frame} adopted PNG: artifact does not match independent trust anchor")
        verify_artifact(root, f"{frame} adopted PNG", adopted, adopted.get("dimensions"))
    for label in ("pose", "pose_rig"):
        artifact = entry.get(label, {})
        if artifact != EXPECTED_ARTIFACTS[f"{frame}.{label}"]:
            fail(f"{frame} {label}: artifact does not match independent trust anchor")
        verify_artifact(root, f"{frame} {label}", artifact, artifact.get("dimensions"))
    if frame == "F4":
        for label in ("semantic_surface", "review", "overlay", "exact_control"):
            artifact = entry.get(label, {})
            if artifact != EXPECTED_ARTIFACTS[f"F4.{label}"]:
                fail(f"F4 {label}: artifact does not match independent trust anchor")
            verify_artifact(root, f"F4 {label}", artifact, artifact.get("dimensions"))
        print("PASS F4 semantic surface, review, overlay, exact control authority")
    print(f"PASS authority-pack verification: {frame} (no candidate supplied)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-root", type=Path, default=REPO)
    parser.add_argument("--mode", choices=("verify-manifest", "benchmark"), required=True)
    parser.add_argument("--frame", choices=("F2", "F3", "F4"))
    parser.add_argument("--candidate", type=Path)
    parser.add_argument("--masks-dir", type=Path)
    parser.add_argument("--metrics-json", type=Path)
    parser.add_argument("--skip-git-tracked-check", action="store_true", help="test fixture only")
    args = parser.parse_args(argv)
    if args.candidate or args.masks_dir or args.metrics_json:
        print("FAIL candidate certification locked until Phase 2 calibrated evaluator; Phase 1 accepts no candidate inputs", file=sys.stderr)
        return 1
    root = args.artifact_root.resolve()
    manifest_path = (root / MANIFEST_NAME).resolve()
    try:
        manifest = load_manifest(root, manifest_path)
        verify_approval_lock(root)
        verify_canon_authority(root, manifest)
        verify_tracked_authority(root, manifest, args.skip_git_tracked_check)
        if args.mode == "verify-manifest":
            if args.frame:
                fail("verify-manifest accepts no frame")
            for frame in ("F2", "F3", "F4"):
                verify_benchmark_authority(root, manifest, frame)
        else:
            if not args.frame:
                fail("benchmark requires --frame F2|F3|F4")
            verify_benchmark_authority(root, manifest, args.frame)
            print("PASS authority-pack verification (Phase 1 has no candidate evaluator)")
        print("PASS cutscene production gate")
        return 0
    except GateFailure as exc:
        print(f"FAIL {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
