from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "tools/art/cutscene_style_calibration.py"
SPEC = importlib.util.spec_from_file_location("cutscene_style_calibration", TOOL)
assert SPEC and SPEC.loader
CAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CAL)


class CutsceneStyleCalibrationTest(unittest.TestCase):
    def synthetic_image(self) -> np.ndarray:
        rgba = np.full((120, 100, 4), 255, dtype=np.uint8)
        colors = {
            "shirt": (15, 55, 220, 255),
            "shorts": (20, 150, 55, 255),
            "socks": (220, 20, 155, 255),
            "accent": (20, 185, 220, 255),
            "skin": (230, 130, 50, 255),
            "dark_fixed": (20, 20, 20, 255),
        }
        for index, name in enumerate(CAL.MATERIAL_NAMES):
            y0 = 8 + index * 17
            rgba[y0 : y0 + 12, 20:80] = colors[name]
        # Enclosed low-saturation detail: silhouette filling must retain it.
        rgba[8 + 5 * 17 + 3 : 8 + 5 * 17 + 8, 42:48, :3] = 255
        return rgba

    def synthetic_metadata(self) -> dict:
        return {
            frame: {
                "path": "synthetic/{}.png".format(frame.lower()),
                "sha256": frame.lower().ljust(64, "0"),
                "dimensions": [100, 120],
                "mode": "RGBA",
            }
            for frame in ("F2", "F3")
        }

    def make_real_fixture(self) -> tempfile.TemporaryDirectory:
        temporary = tempfile.TemporaryDirectory(prefix="cutscene-style-calibration-")
        root = Path(temporary.name)
        for relative in (
            "design/CUTSCENE_PRODUCTION_MANIFEST.json",
            CAL.SOURCE_SPECS["F2"]["path"],
            CAL.SOURCE_SPECS["F3"]["path"],
        ):
            source = ROOT / relative
            destination = root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
        return temporary

    def run_tool(self, root: Path, mode: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(TOOL), mode, "--artifact-root", str(root)],
            text=True,
            capture_output=True,
            check=False,
        )

    def snapshot_destination(self, root: Path) -> dict:
        destination = root / CAL.OUTPUT_REL
        return {
            path.relative_to(destination).as_posix(): path.read_bytes()
            for path in destination.rglob("*")
            if path.is_file() and not path.is_symlink()
        }

    def create_unrelated_temp_like_dirs(self, root: Path) -> dict:
        parent = root / CAL.OUTPUT_REL.parent
        parent.mkdir(parents=True, exist_ok=True)
        markers = {}
        for name in (".manga190.tmp-unrelated", ".manga190.backup-unrelated"):
            path = parent / name
            path.mkdir()
            marker = path / "marker.bin"
            marker.write_bytes(name.encode("utf-8"))
            markers[path] = marker.read_bytes()
        return markers

    def assert_only_unrelated_temp_like_dirs(self, root: Path, markers: dict) -> None:
        parent = root / CAL.OUTPUT_REL.parent
        actual = {
            path
            for path in parent.iterdir()
            if path.name.startswith(".manga190.tmp-") or path.name.startswith(".manga190.backup-")
        }
        self.assertEqual(actual, set(markers))
        for path, expected in markers.items():
            self.assertEqual((path / "marker.bin").read_bytes(), expected)

    def test_synthetic_partition_is_complete_disjoint_and_deterministic(self) -> None:
        image = self.synthetic_image()
        images = {"F2": image, "F3": image.copy()}
        registry_a, files_a = CAL.build_products(images, self.synthetic_metadata())
        registry_b, files_b = CAL.build_products(images, self.synthetic_metadata())
        self.assertEqual(CAL.stable_json_bytes(registry_a), CAL.stable_json_bytes(registry_b))
        self.assertEqual(files_a, files_b)
        self.assertEqual(registry_a["status"]["calibration_status"], "not-calibrated")
        self.assertEqual(registry_a["status"]["candidate_gate"], "locked")
        self.assertEqual(registry_a["status"]["independent_review"], "passed")
        self.assertEqual(registry_a["frames"]["F2"]["normalization"]["logical_dimensions"][1], 190)
        for material in CAL.MATERIAL_NAMES:
            self.assertGreater(
                registry_a["frames"]["F2"]["metrics"]["material_area_ratio_of_source_silhouette"][material],
                0,
            )

        logical_masks = {}
        for name in CAL.MASK_NAMES:
            data = files_a[CAL.relative_output_path("F2", "masks/{}.png".format(name))]
            with Image.open(__import__("io").BytesIO(data)) as image_file:
                logical_masks[name] = np.asarray(image_file, dtype=np.uint8) > 0
        CAL.validate_partition(logical_masks, source_space=False)

    def test_real_adopted_measurements_are_extracted_from_pixels(self) -> None:
        registry, files = CAL.expected_products(ROOT)
        self.assertEqual(set(registry["frames"]), {"F2", "F3"})
        self.assertEqual(len(files), 18)
        for frame in ("F2", "F3"):
            metrics = registry["frames"][frame]["metrics"]
            self.assertGreater(metrics["direct_hsv_seed_coverage_ratio"], 0.99)
            self.assertEqual(metrics["head_body_ratio"]["status"], "unavailable")
            purity = metrics["background_purity"]
            self.assertIn("pure_white_ratio", purity["all_pixels"])
            self.assertIn("near_white_250_ratio", purity["all_pixels"])
            self.assertEqual(purity["adoption_policy"], "measured-not-a-fail-condition")
            self.assertEqual(
                purity["border_connected_background"]["rgb_median"],
                [253, 253, 253],
            )
            self.assertEqual(registry["frames"][frame]["normalization"]["logical_dimensions"][1], 190)
        self.assertLess(
            registry["cross_frame_measurements"]["maximum_observed_delta"],
            CAL.MAX_CROSS_FRAME_AREA_RATIO_DELTA,
        )

    def test_cli_rerun_is_byte_identical_and_verify_passes(self) -> None:
        fixture = self.make_real_fixture()
        self.addCleanup(fixture.cleanup)
        root = Path(fixture.name)
        first = self.run_tool(root, "extract")
        self.assertEqual(first.returncode, 0, first.stderr)
        snapshot = self.snapshot_destination(root)
        second = self.run_tool(root, "extract")
        self.assertEqual(second.returncode, 0, second.stderr)
        rerun = self.snapshot_destination(root)
        self.assertEqual(snapshot, rerun)
        parent = root / CAL.OUTPUT_REL.parent
        leftovers = [
            path.name
            for path in parent.iterdir()
            if path.name.startswith(".manga190.tmp-") or path.name.startswith(".manga190.backup-")
        ]
        self.assertEqual(leftovers, [])
        verified = self.run_tool(root, "verify")
        self.assertEqual(verified.returncode, 0, verified.stderr)

    def test_nested_output_symlink_is_rejected_without_modifying_external_target(self) -> None:
        fixture = self.make_real_fixture()
        self.addCleanup(fixture.cleanup)
        root = Path(fixture.name)
        extracted = self.run_tool(root, "extract")
        self.assertEqual(extracted.returncode, 0, extracted.stderr)

        external = root.parent / "{}-external-target.bin".format(root.name)
        external.write_bytes(b"outside-must-not-change")
        self.addCleanup(lambda: external.unlink() if external.exists() else None)
        mask = root / CAL.relative_output_path("F2", "masks/shirt.png")
        mask.unlink()
        os.symlink(str(external), str(mask))
        before = external.read_bytes()

        result = self.run_tool(root, "extract")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("contains symlink", result.stderr)
        self.assertEqual(external.read_bytes(), before)

    def test_input_symlink_escape_is_rejected(self) -> None:
        fixture = self.make_real_fixture()
        self.addCleanup(fixture.cleanup)
        root = Path(fixture.name)
        source = root / CAL.SOURCE_SPECS["F2"]["path"]
        external = root.parent / "{}-external-source.png".format(root.name)
        shutil.copy2(ROOT / CAL.SOURCE_SPECS["F2"]["path"], external)
        self.addCleanup(lambda: external.unlink() if external.exists() else None)
        source.unlink()
        os.symlink(str(external), str(source))

        result = self.run_tool(root, "extract")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("contains symlink", result.stderr)

    def test_injected_write_failure_preserves_previous_destination_byte_for_byte(self) -> None:
        fixture = self.make_real_fixture()
        self.addCleanup(fixture.cleanup)
        root = Path(fixture.name).resolve()
        extracted = self.run_tool(root, "extract")
        self.assertEqual(extracted.returncode, 0, extracted.stderr)
        before = self.snapshot_destination(root)
        unrelated = self.create_unrelated_temp_like_dirs(root)
        original_write = CAL.write_bytes
        calls = {"count": 0}

        def fail_after_three(path: Path, data: bytes) -> None:
            calls["count"] += 1
            if calls["count"] == 4:
                raise OSError("injected write failure")
            original_write(path, data)

        with mock.patch.object(CAL, "write_bytes", side_effect=fail_after_three):
            with self.assertRaises(CAL.CalibrationFailure) as caught:
                CAL.extract(root)
        self.assertIn("injected write failure", str(caught.exception))
        self.assertEqual(self.snapshot_destination(root), before)
        self.assert_only_unrelated_temp_like_dirs(root, unrelated)
        verified = self.run_tool(root, "verify")
        self.assertEqual(verified.returncode, 0, verified.stderr)

    def test_staging_verification_failure_cleans_exact_created_staging(self) -> None:
        fixture = self.make_real_fixture()
        self.addCleanup(fixture.cleanup)
        root = Path(fixture.name).resolve()
        self.assertEqual(self.run_tool(root, "extract").returncode, 0)
        before = self.snapshot_destination(root)
        unrelated = self.create_unrelated_temp_like_dirs(root)
        original_verify = CAL.verify_output_tree

        def fail_staging(*args, **kwargs):
            label = args[4]
            if label == "calibration staging":
                raise CAL.CalibrationFailure("injected staging verification failure")
            return original_verify(*args, **kwargs)

        with mock.patch.object(CAL, "verify_output_tree", side_effect=fail_staging):
            with self.assertRaises(CAL.CalibrationFailure) as caught:
                CAL.extract(root)
        self.assertIn("injected staging verification failure", str(caught.exception))
        self.assertEqual(self.snapshot_destination(root), before)
        self.assert_only_unrelated_temp_like_dirs(root, unrelated)
        self.assertEqual(self.run_tool(root, "verify").returncode, 0)

    def test_first_rename_failure_preserves_canonical_and_cleans_staging(self) -> None:
        fixture = self.make_real_fixture()
        self.addCleanup(fixture.cleanup)
        root = Path(fixture.name).resolve()
        self.assertEqual(self.run_tool(root, "extract").returncode, 0)
        destination = root / CAL.OUTPUT_REL
        before = self.snapshot_destination(root)
        unrelated = self.create_unrelated_temp_like_dirs(root)
        original_replace = CAL.os.replace

        def fail_first(source, target):
            if Path(source) == destination:
                raise OSError("injected first rename failure")
            return original_replace(source, target)

        with mock.patch.object(CAL.os, "replace", side_effect=fail_first):
            with self.assertRaises(CAL.CalibrationFailure) as caught:
                CAL.extract(root)
        self.assertIn("first rename failure", str(caught.exception))
        self.assertEqual(self.snapshot_destination(root), before)
        self.assert_only_unrelated_temp_like_dirs(root, unrelated)
        self.assertEqual(self.run_tool(root, "verify").returncode, 0)

    def test_second_rename_failure_rolls_back_and_cleans_exact_artifacts(self) -> None:
        fixture = self.make_real_fixture()
        self.addCleanup(fixture.cleanup)
        root = Path(fixture.name).resolve()
        self.assertEqual(self.run_tool(root, "extract").returncode, 0)
        before = self.snapshot_destination(root)
        unrelated = self.create_unrelated_temp_like_dirs(root)
        original_replace = CAL.os.replace
        calls = {"count": 0}

        def fail_second(source, target):
            calls["count"] += 1
            if calls["count"] == 2:
                raise OSError("injected second rename failure")
            return original_replace(source, target)

        with mock.patch.object(CAL.os, "replace", side_effect=fail_second):
            with self.assertRaises(CAL.CalibrationFailure) as caught:
                CAL.extract(root)
        self.assertIn("previous canonical restored", str(caught.exception))
        self.assertEqual(self.snapshot_destination(root), before)
        self.assert_only_unrelated_temp_like_dirs(root, unrelated)
        self.assertEqual(self.run_tool(root, "verify").returncode, 0)

    def test_rollback_failure_retains_only_backup_and_reports_recovery_path(self) -> None:
        fixture = self.make_real_fixture()
        self.addCleanup(fixture.cleanup)
        root = Path(fixture.name).resolve()
        self.assertEqual(self.run_tool(root, "extract").returncode, 0)
        before = self.snapshot_destination(root)
        unrelated = self.create_unrelated_temp_like_dirs(root)
        original_replace = CAL.os.replace
        calls = {"count": 0}

        def fail_install_and_rollback(source, target):
            calls["count"] += 1
            if calls["count"] in (2, 3):
                raise OSError("injected rename failure {}".format(calls["count"]))
            return original_replace(source, target)

        with mock.patch.object(CAL.os, "replace", side_effect=fail_install_and_rollback):
            with self.assertRaises(CAL.CalibrationFailure) as caught:
                CAL.extract(root)
        message = str(caught.exception)
        self.assertIn("recover previous canonical from backup at", message)
        parent = root / CAL.OUTPUT_REL.parent
        backups = [
            path
            for path in parent.iterdir()
            if path.name.startswith(".manga190.backup-") and path not in unrelated
        ]
        staging = [
            path
            for path in parent.iterdir()
            if path.name.startswith(".manga190.tmp-") and path not in unrelated
        ]
        self.assertEqual(len(backups), 1)
        self.assertEqual(staging, [])
        self.assertFalse((root / CAL.OUTPUT_REL).exists())
        self.assertIn(str(backups[0]), message)
        self.assertEqual(
            {
                path.relative_to(backups[0]).as_posix(): path.read_bytes()
                for path in backups[0].rglob("*")
                if path.is_file()
            },
            before,
        )

        # Exercise the documented recovery path, then prove the restored canonical.
        original_replace(str(backups[0]), str(root / CAL.OUTPUT_REL))
        self.assertEqual(self.snapshot_destination(root), before)
        self.assert_only_unrelated_temp_like_dirs(root, unrelated)
        self.assertEqual(self.run_tool(root, "verify").returncode, 0)

    def test_backup_cleanup_failure_uses_safe_fallback_and_leaves_no_task_artifact(self) -> None:
        fixture = self.make_real_fixture()
        self.addCleanup(fixture.cleanup)
        root = Path(fixture.name).resolve()
        self.assertEqual(self.run_tool(root, "extract").returncode, 0)
        before = self.snapshot_destination(root)
        unrelated = self.create_unrelated_temp_like_dirs(root)

        with mock.patch.object(CAL.shutil, "rmtree", side_effect=OSError("injected cleanup failure")):
            CAL.extract(root)
        self.assertEqual(self.snapshot_destination(root), before)
        self.assert_only_unrelated_temp_like_dirs(root, unrelated)
        self.assertEqual(self.run_tool(root, "verify").returncode, 0)

    def test_fresh_install_rename_failure_leaves_no_canonical_partial(self) -> None:
        fixture = self.make_real_fixture()
        self.addCleanup(fixture.cleanup)
        root = Path(fixture.name).resolve()
        unrelated = self.create_unrelated_temp_like_dirs(root)
        with mock.patch.object(CAL.os, "replace", side_effect=OSError("injected fresh rename failure")):
            with self.assertRaises(CAL.CalibrationFailure) as caught:
                CAL.extract(root)
        self.assertIn("fresh install rename failed", str(caught.exception))
        self.assertFalse((root / CAL.OUTPUT_REL).exists())
        self.assert_only_unrelated_temp_like_dirs(root, unrelated)

    def test_parent_and_destination_symlinks_are_rejected(self) -> None:
        # Parent component symlink.
        parent_fixture = self.make_real_fixture()
        self.addCleanup(parent_fixture.cleanup)
        parent_root = Path(parent_fixture.name)
        external_parent = parent_root.parent / "{}-external-parent".format(parent_root.name)
        external_parent.mkdir()
        (external_parent / "sentinel").write_bytes(b"parent-safe")
        self.addCleanup(lambda: shutil.rmtree(external_parent) if external_parent.exists() else None)
        cutscene_parent = parent_root / "design/cutscene-production"
        os.symlink(str(external_parent), str(cutscene_parent))
        result = self.run_tool(parent_root, "extract")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("contains symlink", result.stderr)
        self.assertEqual((external_parent / "sentinel").read_bytes(), b"parent-safe")

        # Destination symlink.
        destination_fixture = self.make_real_fixture()
        self.addCleanup(destination_fixture.cleanup)
        destination_root = Path(destination_fixture.name)
        external_destination = destination_root.parent / "{}-external-destination".format(destination_root.name)
        external_destination.mkdir()
        (external_destination / "sentinel").write_bytes(b"destination-safe")
        self.addCleanup(lambda: shutil.rmtree(external_destination) if external_destination.exists() else None)
        calibration_parent = destination_root / CAL.OUTPUT_REL.parent
        calibration_parent.mkdir(parents=True)
        os.symlink(str(external_destination), str(destination_root / CAL.OUTPUT_REL))
        result = self.run_tool(destination_root, "extract")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("contains symlink", result.stderr)
        self.assertEqual((external_destination / "sentinel").read_bytes(), b"destination-safe")

    def test_verify_rejects_tamper_overlap_missing_part_wrong_dimensions_and_source_mismatch(self) -> None:
        fixture = self.make_real_fixture()
        self.addCleanup(fixture.cleanup)
        root = Path(fixture.name)
        extracted = self.run_tool(root, "extract")
        self.assertEqual(extracted.returncode, 0, extracted.stderr)

        mask = root / CAL.relative_output_path("F2", "masks/shirt.png")
        original_mask = mask.read_bytes()
        silhouette = root / CAL.relative_output_path("F2", "masks/silhouette.png")

        # Overlap: replacing shirt with the full silhouette overlaps every other material.
        mask.write_bytes(silhouette.read_bytes())
        result = self.run_tool(root, "verify")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("material masks overlap", result.stderr)
        mask.write_bytes(original_mask)

        mask.unlink()
        result = self.run_tool(root, "verify")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue("file set mismatch" in result.stderr or "missing calibration output" in result.stderr)
        mask.write_bytes(original_mask)

        wrong = np.zeros((1, 1), dtype=np.uint8)
        mask.write_bytes(CAL.stable_png_bytes(wrong, "L"))
        result = self.run_tool(root, "verify")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("dimensions or mode mismatch", result.stderr)
        mask.write_bytes(original_mask)

        source = root / CAL.SOURCE_SPECS["F2"]["path"]
        source.write_bytes(source.read_bytes() + b"tamper")
        result = self.run_tool(root, "verify")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("source SHA-256 mismatch", result.stderr)

    def test_locked_manifest_state_is_required(self) -> None:
        fixture = self.make_real_fixture()
        self.addCleanup(fixture.cleanup)
        root = Path(fixture.name)
        path = root / CAL.MANIFEST_REL
        manifest = json.loads(path.read_text(encoding="utf-8"))
        manifest["calibration_status"] = "calibrated"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        result = self.run_tool(root, "extract")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must keep calibration_status=not-calibrated", result.stderr)


if __name__ == "__main__":
    unittest.main()
