#!/usr/bin/env python3
"""Fail closed unless short-pass artifacts match the explicit approval ledger."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
REGISTRY = REPO / "design" / "SHORTPASS_APPROVAL.json"


def digest(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def verify_file(artifact_root: Path, label: str, entry: dict) -> None:
    path = artifact_root / entry["path"]
    if not path.is_file():
        raise SystemExit(f"FAIL {label}: missing {path}")
    actual = digest(path)
    if actual != entry["sha256"]:
        raise SystemExit(
            f"FAIL {label}: sha256 mismatch\n"
            f"expected {entry['sha256']}\nactual   {actual}\npath     {path}"
        )
    print(f"PASS {label}: {entry['sha256']}  {path}")


def normalized_relative(artifact_root: Path, supplied: str) -> str:
    root = artifact_root.resolve()
    value = Path(supplied)
    absolute = value.resolve() if value.is_absolute() else (root / value).resolve()
    try:
        return absolute.relative_to(root).as_posix()
    except ValueError as exc:
        raise SystemExit(f"FAIL generation input is outside artifact root: {supplied}") from exc


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-root", type=Path, default=REPO)
    parser.add_argument("--mode", choices=("build-composite", "generation"), required=True)
    parser.add_argument("--input", action="append", default=[])
    args = parser.parse_args()
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    for component in ("legs", "arms"):
        entry = registry["components"][component]
        if entry["status"] != "user-approved":
            raise SystemExit(f"FAIL {component}: status is {entry['status']}")
        verify_file(args.artifact_root, f"{component} artifact", entry["artifact"])
        verify_file(args.artifact_root, f"{component} ledger", entry["ledger"])
    forbidden = {Path(path).as_posix() for path in registry["forbidden_inputs"]}
    normalized_inputs = {normalized_relative(args.artifact_root, supplied) for supplied in args.input}
    for relative in normalized_inputs:
        if relative in forbidden or any(relative.startswith(path + "/") for path in forbidden):
            raise SystemExit(f"FAIL forbidden generation input: {relative}")
    if args.mode == "generation":
        composite = registry["components"]["composite"]
        gate = registry["generation_gate"]
        if composite["status"] != "user-approved" or not gate["enabled"]:
            raise SystemExit(
                "FAIL generation gate: the merged leg/arm composite has not been user-approved"
            )
        verify_file(args.artifact_root, "composite artifact", composite["artifact"])
        if not normalized_inputs:
            raise SystemExit("FAIL generation gate: explicit --input paths are required")
        approved_composite = Path(composite["artifact"]["path"]).as_posix()
        if normalized_inputs != {approved_composite}:
            raise SystemExit(
                "FAIL generation gate: input set must equal the sole approved composite; "
                f"expected {approved_composite}, got {sorted(normalized_inputs)}"
            )
    else:
        if args.input:
            raise SystemExit("FAIL build-composite mode does not accept generation inputs")
        print("PASS component approvals; composite build allowed; generation remains disabled")


if __name__ == "__main__":
    main()
