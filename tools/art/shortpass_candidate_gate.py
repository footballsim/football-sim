#!/usr/bin/env python3
"""Fail closed on anatomical identity, per-joint pose geometry, and gaze."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
VISION_SOURCE = ROOT / "tools" / "art" / "shortpass_vision_pose.m"
VISION_BINARY = Path("/tmp/football-sim-shortpass-vision-pose")
LEGS_LEDGER = ROOT / "design" / "shortpass-approval" / "legs-approved-ledger.json"
ARMS_LEDGER = ROOT / "design" / "shortpass-approval" / "arms-approved-ledger.json"
APPROVAL_REGISTRY = ROOT / "design" / "SHORTPASS_APPROVAL.json"
F3_CALIBRATION = (
    ROOT / "design" / "shortpass-approval" / "f3-vision-calibration.json"
)
PRODUCTION_MANIFEST = ROOT / "design" / "CUTSCENE_PRODUCTION_MANIFEST.json"
PHASE1_STATUS = "phase1-authority-verification-only"
PHASE1_LOCK_MESSAGE = "FAIL candidate certification locked until Phase 2 calibrated evaluator"

MAX_JOINT_DISTANCE = 0.14
MAX_COMPONENT_ERROR = 0.12
MAX_SEGMENT_ANGLE_DEGREES = 10.0
MAX_SEGMENT_LENGTH_DRIFT = 0.15
MAX_TORSO_ANGLE_DEGREES = 8.0
FRAME_TIMES = {
    "F1": 17.0,
    "F2": 18.0,
    "F3": 19.0,
    "F4": 20.0,
    "F5": 21.0,
    "F6": 22.2,
}


def compile_vision() -> None:
    cache = Path("/tmp/football-sim-shortpass-clang-cache")
    cache.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "clang",
            f"-fmodules-cache-path={cache}",
            "-fobjc-arc",
            "-framework",
            "Foundation",
            "-framework",
            "Vision",
            str(VISION_SOURCE),
            "-o",
            str(VISION_BINARY),
        ],
        check=True,
    )


def vision_pose(candidate: Path, evidence: Path | None) -> dict:
    if evidence:
        return json.loads(evidence.read_text(encoding="utf-8"))
    compile_vision()
    result = subprocess.run(
        [str(VISION_BINARY), str(candidate.resolve())],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def point(pose: dict, name: str) -> tuple[float, float]:
    item = pose[name]
    return float(item["x"]), float(item["y"])


def pose_in_pixels(pose: dict, candidate: Path) -> dict:
    with Image.open(candidate) as image:
        width, height = image.size
    scaled = {}
    for name, item in pose.items():
        if not isinstance(item, dict) or "x" not in item or "y" not in item:
            continue
        scaled[name] = {
            **item,
            "x": float(item["x"]) * width,
            "y": float(item["y"]) * height,
        }
    return scaled


def digest(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def approved_frame(
    frame_name: str,
) -> tuple[
    dict[str, tuple[float, float]],
    dict[str, tuple[float, float]],
    dict[str, bool],
]:
    registry = json.loads(APPROVAL_REGISTRY.read_text(encoding="utf-8"))
    for component, path in (("legs", LEGS_LEDGER), ("arms", ARMS_LEDGER)):
        expected = registry["components"][component]["ledger"]["sha256"]
        actual = digest(path)
        if actual != expected:
            raise SystemExit(
                f"FAIL {component} ledger SHA mismatch: expected {expected}, got {actual}"
            )
    legs = json.loads(LEGS_LEDGER.read_text(encoding="utf-8"))
    arms = json.loads(ARMS_LEDGER.read_text(encoding="utf-8"))
    frame_time = FRAME_TIMES[frame_name]
    leg_frame = next(frame for frame in legs["frames"] if frame["time"] == frame_time)
    arm_frame = next(frame for frame in arms["frames"] if frame["time"] == frame_time)
    leg_points = {}
    for role in ("support", "kicking"):
        side = leg_frame[f"{role}_model_side"]
        for joint in ("hip", "knee", "ankle"):
            item = leg_frame[role][joint]
            leg_points[f"{side}_{joint}"] = (float(item["x"]), float(item["y"]))
    arm_points = {}
    for side in ("left", "right"):
        for joint in ("shoulder", "elbow", "wrist"):
            item = arm_frame["final"][side][joint]
            arm_points[f"{side}_{joint}"] = (float(item["x"]), float(item["y"]))
    visibility_entry = next(
        entry
        for entry in registry["components"]["arms"]["visibility"]
        if entry["frame"] == frame_name
    )
    visibility = {side: bool(visibility_entry[side]) for side in ("left", "right")}
    return leg_points, arm_points, visibility


def torso_scale(pose: dict, right_shoulder_side: str = "right") -> float:
    right_shoulder = point(pose, f"{right_shoulder_side}_shoulder")
    hips = [point(pose, f"{side}_hip") for side in ("left", "right")]
    hip_center = tuple(sum(p[i] for p in hips) / 2 for i in (0, 1))
    scale = math.dist(right_shoulder, hip_center)
    if scale <= 0:
        raise SystemExit("FAIL invalid torso scale")
    return scale


def subtract(a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float]:
    return a[0] - b[0], a[1] - b[1]


def vector_angle_degrees(a: tuple[float, float], b: tuple[float, float]) -> float:
    a_length = math.hypot(*a)
    b_length = math.hypot(*b)
    if a_length <= 0 or b_length <= 0:
        return 180.0
    cosine = (a[0] * b[0] + a[1] * b[1]) / (a_length * b_length)
    return math.degrees(math.acos(max(-1.0, min(1.0, cosine))))


def segment_transform(
    source: tuple[float, float],
    destination: tuple[float, float],
) -> tuple[float, float]:
    denominator = source[0] ** 2 + source[1] ** 2
    if denominator <= 0:
        raise SystemExit("FAIL invalid zero-length calibration segment")
    real = (destination[0] * source[0] + destination[1] * source[1]) / denominator
    imaginary = (
        destination[1] * source[0] - destination[0] * source[1]
    ) / denominator
    return real, imaginary


def apply_segment_transform(
    vector: tuple[float, float],
    transform: tuple[float, float],
) -> tuple[float, float]:
    real, imaginary = transform
    return (
        real * vector[0] - imaginary * vector[1],
        imaginary * vector[0] + real * vector[1],
    )


def normalized_geometry(
    pose: dict,
    legs: dict[str, tuple[float, float]],
    arms: dict[str, tuple[float, float]],
    arm_source_side: dict[str, str] | None = None,
) -> tuple[dict, dict]:
    arm_source_side = arm_source_side or {"left": "left", "right": "right"}
    observed_torso = torso_scale(pose, arm_source_side["right"])
    target_hip_center = tuple(
        (legs["left_hip"][axis] + legs["right_hip"][axis]) / 2 for axis in (0, 1)
    )
    target_torso = math.dist(arms["right_shoulder"], target_hip_center)

    target: dict[str, tuple[float, float]] = {}
    observed: dict[str, tuple[float, float]] = {}
    for side in ("left", "right"):
        target_hip = legs[f"{side}_hip"]
        observed_hip = point(pose, f"{side}_hip")
        target[f"{side}_hip"] = (0.0, 0.0)
        observed[f"{side}_hip"] = (0.0, 0.0)
        for joint in ("knee", "ankle"):
            name = f"{side}_{joint}"
            target[name] = tuple(
                (legs[name][axis] - target_hip[axis]) / target_torso
                for axis in (0, 1)
            )
            joint_point = point(pose, name)
            observed[name] = tuple(
                (joint_point[axis] - observed_hip[axis]) / observed_torso
                for axis in (0, 1)
            )

    for side in ("left", "right"):
        target_shoulder = arms[f"{side}_shoulder"]
        source_side = arm_source_side[side]
        observed_shoulder = point(pose, f"{source_side}_shoulder")
        target[f"{side}_shoulder"] = (0.0, 0.0)
        observed[f"{side}_shoulder"] = (0.0, 0.0)
        for joint in ("elbow", "wrist"):
            name = f"{side}_{joint}"
            target[name] = tuple(
                (arms[name][axis] - target_shoulder[axis]) / target_torso
                for axis in (0, 1)
            )
            joint_point = point(pose, f"{source_side}_{joint}")
            observed[name] = tuple(
                (joint_point[axis] - observed_shoulder[axis]) / observed_torso
                for axis in (0, 1)
            )

    target["torso"] = tuple(
        (target_hip_center[axis] - target_shoulder[axis]) / target_torso
        for axis in (0, 1)
    )
    observed_hip_center = tuple(
        sum(point(pose, f"{side}_hip")[axis] for side in ("left", "right")) / 2
        for axis in (0, 1)
    )
    observed["torso"] = tuple(
        (observed_hip_center[axis] - observed_shoulder[axis]) / observed_torso
        for axis in (0, 1)
    )
    return target, observed


def calibrated_target(raw_target: dict) -> tuple[dict, dict]:
    registry = json.loads(APPROVAL_REGISTRY.read_text(encoding="utf-8"))
    adopted = registry["generation_gate"]["cross_recipe_candidate_2026_08_25"][
        "adopted_frame_2026_08_25"
    ]
    calibration_entry = adopted["vision_calibration"]
    if digest(F3_CALIBRATION) != calibration_entry["sha256"]:
        raise SystemExit("FAIL F3 Vision calibration SHA mismatch")
    calibration = json.loads(F3_CALIBRATION.read_text(encoding="utf-8"))
    source_entry = calibration["source_image"]
    if source_entry["sha256"] != adopted["artifact"]["sha256"]:
        raise SystemExit("FAIL F3 Vision calibration points to a non-adopted source")
    source_path = ROOT / source_entry["path"]
    if digest(source_path) != source_entry["sha256"]:
        raise SystemExit("FAIL adopted F3 source SHA mismatch during calibration")

    f3_pose = pose_in_pixels(calibration["vision_pose"], source_path)
    f3_legs, f3_arms, _ = approved_frame("F3")
    f3_raw, f3_observed = normalized_geometry(f3_pose, f3_legs, f3_arms)

    calibrated = {
        f"{side}_{anchor}": (0.0, 0.0)
        for side in ("left", "right")
        for anchor in ("hip", "shoulder")
    }
    transforms = {}
    for side in ("left", "right"):
        raw_thigh = raw_target[f"{side}_knee"]
        f3_raw_thigh = f3_raw[f"{side}_knee"]
        f3_observed_thigh = f3_observed[f"{side}_knee"]
        thigh_transform = segment_transform(f3_raw_thigh, f3_observed_thigh)
        calibrated[f"{side}_knee"] = apply_segment_transform(
            raw_thigh, thigh_transform
        )
        transforms[f"{side}_thigh"] = thigh_transform

        raw_shin = subtract(
            raw_target[f"{side}_ankle"], raw_target[f"{side}_knee"]
        )
        f3_raw_shin = subtract(
            f3_raw[f"{side}_ankle"], f3_raw[f"{side}_knee"]
        )
        f3_observed_shin = subtract(
            f3_observed[f"{side}_ankle"], f3_observed[f"{side}_knee"]
        )
        shin_transform = segment_transform(f3_raw_shin, f3_observed_shin)
        calibrated[f"{side}_ankle"] = tuple(
            calibrated[f"{side}_knee"][axis]
            + apply_segment_transform(raw_shin, shin_transform)[axis]
            for axis in (0, 1)
        )
        transforms[f"{side}_shin"] = shin_transform

        raw_upper_arm = raw_target[f"{side}_elbow"]
        f3_raw_upper_arm = f3_raw[f"{side}_elbow"]
        f3_observed_upper_arm = f3_observed[f"{side}_elbow"]
        upper_arm_transform = segment_transform(
            f3_raw_upper_arm, f3_observed_upper_arm
        )
        calibrated[f"{side}_elbow"] = apply_segment_transform(
            raw_upper_arm, upper_arm_transform
        )
        transforms[f"{side}_upper_arm"] = upper_arm_transform

        raw_forearm = subtract(
            raw_target[f"{side}_wrist"], raw_target[f"{side}_elbow"]
        )
        f3_raw_forearm = subtract(
            f3_raw[f"{side}_wrist"], f3_raw[f"{side}_elbow"]
        )
        f3_observed_forearm = subtract(
            f3_observed[f"{side}_wrist"], f3_observed[f"{side}_elbow"]
        )
        forearm_transform = segment_transform(f3_raw_forearm, f3_observed_forearm)
        calibrated[f"{side}_wrist"] = tuple(
            calibrated[f"{side}_elbow"][axis]
            + apply_segment_transform(raw_forearm, forearm_transform)[axis]
            for axis in (0, 1)
        )
        transforms[f"{side}_forearm"] = forearm_transform

    torso_transform = segment_transform(f3_raw["torso"], f3_observed["torso"])
    calibrated["torso"] = apply_segment_transform(
        raw_target["torso"], torso_transform
    )
    transforms["torso"] = torso_transform
    return calibrated, transforms


def arm_error(target: dict, observed: dict, visible_sides: list[str]) -> float:
    squared = []
    for side in visible_sides:
        for joint in ("elbow", "wrist"):
            name = f"{side}_{joint}"
            squared.extend(
                (observed[name][axis] - target[name][axis]) ** 2 for axis in (0, 1)
            )
    return math.sqrt(sum(squared) / len(squared))


def leg_error(target: dict, observed: dict) -> float:
    squared = []
    for side in ("left", "right"):
        for joint in ("knee", "ankle"):
            name = f"{side}_{joint}"
            squared.extend(
                (observed[name][axis] - target[name][axis]) ** 2 for axis in (0, 1)
            )
    return math.sqrt(sum(squared) / len(squared))


def pose_failures(
    target: dict,
    observed: dict,
    visible_sides: list[str],
) -> tuple[list[str], dict, dict]:
    failures: list[str] = []
    joint_errors = {}
    checked_joints = [
        "left_knee",
        "left_ankle",
        "right_knee",
        "right_ankle",
    ]
    checked_joints.extend(
        f"{side}_{joint}"
        for side in visible_sides
        for joint in ("elbow", "wrist")
    )
    for name in checked_joints:
        delta = subtract(observed[name], target[name])
        distance = math.hypot(*delta)
        joint_errors[name] = {
            "target": target[name],
            "observed": observed[name],
            "delta": delta,
            "distance": round(distance, 4),
        }
        if abs(delta[0]) > MAX_COMPONENT_ERROR or abs(delta[1]) > MAX_COMPONENT_ERROR:
            failures.append(
                f"{name} component error exceeds {MAX_COMPONENT_ERROR:.2f}: "
                f"dx={delta[0]:+.4f} dy={delta[1]:+.4f}"
            )
        if distance > MAX_JOINT_DISTANCE:
            failures.append(
                f"{name} normalized distance exceeds {MAX_JOINT_DISTANCE:.2f}: "
                f"{distance:.4f}"
            )

    segments = {
        "left_thigh": ("left_hip", "left_knee"),
        "left_shin": ("left_knee", "left_ankle"),
        "right_thigh": ("right_hip", "right_knee"),
        "right_shin": ("right_knee", "right_ankle"),
    }
    for side in visible_sides:
        segments[f"{side}_upper_arm"] = (f"{side}_shoulder", f"{side}_elbow")
        segments[f"{side}_forearm"] = (f"{side}_elbow", f"{side}_wrist")
    segment_errors = {}
    for name, (start, end) in segments.items():
        target_vector = subtract(target[end], target[start])
        observed_vector = subtract(observed[end], observed[start])
        angle = vector_angle_degrees(target_vector, observed_vector)
        target_length = math.hypot(*target_vector)
        observed_length = math.hypot(*observed_vector)
        length_drift = abs(observed_length / target_length - 1.0)
        segment_errors[name] = {
            "target_vector": target_vector,
            "observed_vector": observed_vector,
            "angle_error_degrees": round(angle, 2),
            "length_drift": round(length_drift, 4),
        }
        if angle > MAX_SEGMENT_ANGLE_DEGREES:
            failures.append(
                f"{name} angle error exceeds {MAX_SEGMENT_ANGLE_DEGREES:.1f} degrees: "
                f"{angle:.2f}"
            )
        if length_drift > MAX_SEGMENT_LENGTH_DRIFT:
            failures.append(
                f"{name} length drift exceeds {MAX_SEGMENT_LENGTH_DRIFT:.0%}: "
                f"{length_drift:.1%}"
            )

    for name, metrics in segment_errors.items():
        target_vector = metrics["target_vector"]
        observed_vector = metrics["observed_vector"]
        if abs(target_vector[0]) > 0.08 and target_vector[0] * observed_vector[0] <= 0:
            failures.append(
                f"{name} horizontal direction is wrong: target dx={target_vector[0]:+.4f}, "
                f"observed dx={observed_vector[0]:+.4f}"
            )

    torso_angle = vector_angle_degrees(target["torso"], observed["torso"])
    segment_errors["torso"] = {
        "target_vector": target["torso"],
        "observed_vector": observed["torso"],
        "angle_error_degrees": round(torso_angle, 2),
    }
    if torso_angle > MAX_TORSO_ANGLE_DEGREES:
        failures.append(
            f"torso angle error exceeds {MAX_TORSO_ANGLE_DEGREES:.1f} degrees: "
            f"{torso_angle:.2f}"
        )
    return failures, joint_errors, segment_errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-root", type=Path, default=ROOT)
    parser.add_argument("--frame", choices=tuple(FRAME_TIMES), required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--vision-evidence", type=Path)
    parser.add_argument("--gaze-evidence", type=Path)
    args = parser.parse_args()

    manifest_path = args.artifact_root.resolve() / "design" / "CUTSCENE_PRODUCTION_MANIFEST.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"FAIL candidate gate: production manifest missing or invalid: {manifest_path}") from exc
    if (not isinstance(manifest, dict) or manifest.get("status") != PHASE1_STATUS or
            manifest.get("calibration_status") != "not-calibrated"):
        raise SystemExit("FAIL candidate gate: production manifest is not fail-closed Phase 1")
    raise SystemExit(PHASE1_LOCK_MESSAGE)

    pose = vision_pose(args.candidate, args.vision_evidence)
    pixel_pose = pose_in_pixels(pose, args.candidate)
    legs, arms, visibility = approved_frame(args.frame)
    visible_sides = [side for side in ("left", "right") if visibility[side]]
    failures = []
    for joint in ("knee", "ankle"):
        right_x = float(pose[f"right_{joint}"]["x"])
        left_x = float(pose[f"left_{joint}"]["x"])
        target_delta = legs[f"right_{joint}"][0] - legs[f"left_{joint}"][0]
        observed_delta = right_x - left_x
        if target_delta * observed_delta <= 0 or abs(observed_delta) < 0.03:
            failures.append(
                f"anatomical {joint} ordering differs from approved {args.frame}; "
                f"target right-left={target_delta:+.3f}px, "
                f"observed right-left={observed_delta:+.4f}"
            )

    identity_arm_map = {"left": "left", "right": "right"}
    raw_target, identity_observed = normalized_geometry(
        pixel_pose, legs, arms, identity_arm_map
    )
    target, calibration_transforms = calibrated_target(raw_target)
    arm_map = identity_arm_map
    observed = identity_observed
    arm_assignment_scores = {
        "identity": arm_error(target, identity_observed, visible_sides)
    }
    # Vision can flip both arm labels together in a side-on pose even when the
    # rendered chains are spatially correct. When both arms are visible, bind
    # complete shoulder-elbow-wrist chains to the approved trace by minimum
    # geometric error. Never swap individual joints.
    if set(visible_sides) == {"left", "right"}:
        swapped_arm_map = {"left": "right", "right": "left"}
        _, swapped_observed = normalized_geometry(
            pixel_pose, legs, arms, swapped_arm_map
        )
        swapped_score = arm_error(target, swapped_observed, visible_sides)
        arm_assignment_scores["swapped"] = swapped_score
        if swapped_score < arm_assignment_scores["identity"]:
            arm_map = swapped_arm_map
            observed = swapped_observed

    for side in ("left", "right"):
        source_side = arm_map[side]
        wrist_confidence = float(pixel_pose[f"{source_side}_wrist"]["confidence"])
        if visibility[side] and wrist_confidence < 0.35:
            failures.append(
                f"visible {side} wrist confidence too low: {wrist_confidence:.4f}"
            )
        if not visibility[side] and wrist_confidence > 0.35:
            failures.append(
                f"hidden {side} wrist was detected: {wrist_confidence:.4f}"
            )

    geometry_failures, joint_errors, segment_errors = pose_failures(
        target, observed, visible_sides
    )
    failures.extend(geometry_failures)

    rms = arm_error(target, observed, visible_sides)
    if rms > 0.18:
        failures.append(f"visible-arm normalized RMS too large: {rms:.4f}")

    leg_rms = leg_error(target, observed)
    if leg_rms > 0.25:
        failures.append(f"hip-knee-ankle normalized RMS too large: {leg_rms:.4f}")

    if not args.gaze_evidence:
        failures.append("missing independent eye-ROI gaze evidence")
    else:
        gaze = json.loads(args.gaze_evidence.read_text(encoding="utf-8"))
        gaze_candidate = gaze.get("final_candidate", {})
        if not (
            gaze.get("status") == "pass"
            and gaze.get("iris_direction") == "down"
            and gaze.get("head_pitch_is_not_proxy") is True
            and gaze.get("sclera") == "natural"
            and gaze_candidate.get("sha256") == digest(args.candidate)
        ):
            failures.append("eye-ROI gaze evidence does not prove a natural downward iris")

    report = {
        "frame": args.frame,
        "candidate": str(args.candidate),
        "vision_pose": pose,
        "approved_trace_normalized": raw_target,
        "calibrated_target_normalized": target,
        "f3_segment_calibration": calibration_transforms,
        "leg_identity": {
            joint: {
                "right_x": pose[f"right_{joint}"]["x"],
                "left_x": pose[f"left_{joint}"]["x"],
            }
            for joint in ("knee", "ankle")
        },
        "arm_visibility": visibility,
        "vision_arm_assignment": {
            "approved_side_to_vision_side": arm_map,
            "normalized_rms_scores": {
                name: round(score, 4)
                for name, score in arm_assignment_scores.items()
            },
        },
        "arms_normalized": {
            f"{side}_{joint}": observed[f"{side}_{joint}"]
            for side in visible_sides
            for joint in ("elbow", "wrist")
        },
        "visible_arm_rms": round(rms, 4),
        "legs_normalized": {
            f"{side}_{joint}": observed[f"{side}_{joint}"]
            for side in ("left", "right")
            for joint in ("knee", "ankle")
        },
        "leg_rms": round(leg_rms, 4),
        "per_joint_errors": joint_errors,
        "per_segment_errors": segment_errors,
        "thresholds": {
            "max_joint_distance": MAX_JOINT_DISTANCE,
            "max_component_error": MAX_COMPONENT_ERROR,
            "max_segment_angle_degrees": MAX_SEGMENT_ANGLE_DEGREES,
            "max_segment_length_drift": MAX_SEGMENT_LENGTH_DRIFT,
            "max_torso_angle_degrees": MAX_TORSO_ANGLE_DEGREES,
        },
        "failures": failures,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
