#!/usr/bin/env python3
"""Fail closed unless short-pass artifacts match the explicit approval ledger."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
PRODUCTION_MANIFEST = "design/CUTSCENE_PRODUCTION_MANIFEST.json"
GENERATION_PHASE = "phase1-authority-verification-only"


def digest(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def verify_file(artifact_root: Path, label: str, entry: dict) -> None:
    raw_path = entry.get("path") if isinstance(entry, dict) else None
    if not isinstance(raw_path, str) or Path(raw_path).is_absolute():
        raise SystemExit(f"FAIL {label}: absolute or invalid artifact path")
    path = (artifact_root / raw_path).resolve()
    try:
        path.relative_to(artifact_root.resolve())
    except ValueError as exc:
        raise SystemExit(f"FAIL {label}: artifact path escapes artifact root: {raw_path}") from exc
    if not path.is_file():
        raise SystemExit(f"FAIL {label}: missing {path}")
    actual = digest(path)
    if actual != entry["sha256"]:
        raise SystemExit(
            f"FAIL {label}: sha256 mismatch\n"
            f"expected {entry['sha256']}\nactual   {actual}\npath     {path}"
        )
    print(f"PASS {label}: {entry['sha256']}  {path}")


def verify_phase1_manifest(artifact_root: Path) -> None:
    path = artifact_root.resolve() / PRODUCTION_MANIFEST
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"FAIL generation gate: Phase 1 manifest missing or invalid: {path}") from exc
    if not isinstance(manifest, dict):
        raise SystemExit("FAIL generation gate: Phase 1 manifest is not an object")
    if manifest.get("status") != "phase1-authority-verification-only":
        raise SystemExit("FAIL generation gate: manifest status does not permit generation")
    if manifest.get("calibration_status") != "not-calibrated":
        raise SystemExit("FAIL generation gate: manifest calibration status is not fail-closed")
    approval_path = artifact_root.resolve() / "design/SHORTPASS_APPROVAL.json"
    try:
        approval = json.loads(approval_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"FAIL generation gate: approval ledger missing or invalid: {approval_path}") from exc
    generation_gate = approval.get("generation_gate") if isinstance(approval, dict) else None
    if (not isinstance(generation_gate, dict) or type(generation_gate.get("enabled")) is not bool or
            generation_gate.get("enabled") is not False or generation_gate.get("phase") != GENERATION_PHASE):
        raise SystemExit("FAIL generation gate: approval generation gate is not fail-closed for Phase 1")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-root", type=Path, default=REPO)
    parser.add_argument("--mode", choices=("build-composite", "generation"), required=True)
    parser.add_argument("--frame", choices=("F1", "F2", "F3", "F4", "F5", "F6"))
    parser.add_argument("--backend", choices=("hard-pose-control", "cross-recipe-imagegen"))
    parser.add_argument("--input", action="append", default=[])
    args = parser.parse_args()
    if args.mode == "generation":
        verify_phase1_manifest(args.artifact_root)
        raise SystemExit(
            "FAIL generation gate: Phase 1 is authority verification only; "
            "candidate certification locked until Phase 2 calibrated evaluator"
        )
    registry_path = args.artifact_root.resolve() / "design" / "SHORTPASS_APPROVAL.json"
    try:
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"FAIL build-composite: approval ledger missing or invalid: {registry_path}") from exc
    for component in ("legs", "arms"):
        entry = registry["components"][component]
        if entry["status"] != "user-approved":
            raise SystemExit(f"FAIL {component}: status is {entry['status']}")
        verify_file(args.artifact_root, f"{component} artifact", entry["artifact"])
        verify_file(args.artifact_root, f"{component} ledger", entry["ledger"])
    if args.frame:
        raise SystemExit("FAIL build-composite mode does not accept --frame")
    if args.backend:
        raise SystemExit("FAIL build-composite mode does not accept --backend")
    if args.input:
        raise SystemExit("FAIL build-composite mode does not accept generation inputs")
    print("PASS component approvals; composite build allowed; generation remains disabled")


if __name__ == "__main__":
    main()
