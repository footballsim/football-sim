from __future__ import annotations

import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
GATE = ROOT / "tools/art/cutscene_production_gate.py"
MANIFEST = ROOT / "design/CUTSCENE_PRODUCTION_MANIFEST.json"


class CutsceneProductionGateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(prefix="cutscene-gate-")
        self.root = Path(self.tmp.name)
        source = json.loads(MANIFEST.read_text(encoding="utf-8"))
        paths = set(source["authority_paths"])
        paths.add("design/CUTSCENE_PRODUCTION_MANIFEST.json")
        for relative in paths:
            src = ROOT / relative
            dst = self.root / relative
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
        (self.root / ".cutscene-gate-test-fixture").write_text("fixture\n", encoding="utf-8")
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(["git", "add", "--all"], cwd=self.root, check=True)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def manifest(self) -> dict:
        return json.loads((self.root / "design/CUTSCENE_PRODUCTION_MANIFEST.json").read_text(encoding="utf-8"))

    def save_manifest(self, data: dict) -> None:
        (self.root / "design/CUTSCENE_PRODUCTION_MANIFEST.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    def run_gate(self, *args: str, skip: bool = True) -> subprocess.CompletedProcess[str]:
        command = [sys.executable, str(GATE), "--artifact-root", str(self.root), *args]
        if skip:
            command.append("--skip-git-tracked-check")
        env = dict(os.environ)
        if skip:
            env["CUTSCENE_GATE_TEST_FIXTURE"] = "1"
        else:
            env.pop("CUTSCENE_GATE_TEST_FIXTURE", None)
        return subprocess.run(command, text=True, capture_output=True, check=False, env=env)

    def test_verify_manifest_and_all_authority_benchmarks(self) -> None:
        result = self.run_gate("--mode", "verify-manifest")
        self.assertEqual(result.returncode, 0, result.stderr)
        for frame in ("F2", "F3", "F4"):
            result = self.run_gate("--mode", "benchmark", "--frame", frame)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_normal_verify_passes_with_temp_git_tracked_authority(self) -> None:
        result = self.run_gate("--mode", "verify-manifest", skip=False)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_one_promoted_f4_authority_untracked_fails_closed(self) -> None:
        path = "design/cutscene-production/shortpass/f4/overlay.png"
        subprocess.run(["git", "rm", "--cached", "-q", "--", path], cwd=self.root, check=True)
        result = self.run_gate("--mode", "verify-manifest", skip=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(path, result.stderr)

    def test_authority_paths_missing_extra_duplicate_and_proto_fail_closed(self) -> None:
        cases = (
            (lambda paths: paths[:-1], "exactly match"),
            (lambda paths: paths + ["design/extra.png"], "exactly match"),
            (lambda paths: paths + [paths[0]], "duplicate"),
            (lambda paths: ["tools/proto/forbidden.png" if p == paths[0] else p for p in paths], "tools/proto"),
        )
        for mutate, expected in cases:
            with self.subTest(expected=expected):
                data = self.manifest()
                data["authority_paths"] = mutate(list(data["authority_paths"]))
                self.save_manifest(data)
                result = self.run_gate("--mode", "verify-manifest")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(expected, result.stderr)
                self.tmp.cleanup()
                self.setUp()

    def test_skip_is_rejected_for_production_root(self) -> None:
        result = subprocess.run(
            [sys.executable, str(GATE), "--artifact-root", str(ROOT), "--mode", "verify-manifest", "--skip-git-tracked-check"],
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("only for explicit non-production", result.stderr)

    def test_skip_is_rejected_even_with_fixture_env_in_current_fork(self) -> None:
        env = dict(os.environ, CUTSCENE_GATE_TEST_FIXTURE="1")
        result = subprocess.run(
            [sys.executable, str(GATE), "--artifact-root", str(ROOT), "--mode", "verify-manifest", "--skip-git-tracked-check"],
            text=True, capture_output=True, check=False, env=env,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("only for explicit non-production", result.stderr)

    def test_sha_tamper_fails_closed(self) -> None:
        path = self.root / "img/cutscenes/manga_shortpass6/frame_02.png"
        path.write_bytes(path.read_bytes() + b"tamper")
        result = self.run_gate("--mode", "benchmark", "--frame", "F2")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SHA-256 mismatch", result.stderr)

    def test_f4_adoption_fails_closed(self) -> None:
        data = self.manifest()
        data["benchmarks"]["F4"]["status"] = "user-adopted"
        data["benchmarks"]["F4"]["adoption"] = "adopted"
        self.save_manifest(data)
        result = self.run_gate("--mode", "benchmark", "--frame", "F4")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("trace-only/not-adopted", result.stderr)

    def test_missing_semantic_surface_fails_closed(self) -> None:
        data = self.manifest()
        data["benchmarks"]["F4"].pop("semantic_surface")
        self.save_manifest(data)
        result = self.run_gate("--mode", "benchmark", "--frame", "F4")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing canonical authority path", result.stderr)

    def test_f4_authority_does_not_reference_ignored_proto(self) -> None:
        data = self.manifest()
        f4 = data["benchmarks"]["F4"]
        for key in ("semantic_surface", "review", "overlay", "exact_control"):
            self.assertNotIn("tools/proto/", f4[key]["path"])
        for relative in data["authority_paths"]:
            self.assertNotIn("tools/proto/", relative)

    def test_f2_f3_png_swap_fails_closed(self) -> None:
        data = self.manifest()
        data["benchmarks"]["F2"]["adopted_png"]["path"] = data["benchmarks"]["F3"]["adopted_png"]["path"]
        self.save_manifest(data)
        result = self.run_gate("--mode", "benchmark", "--frame", "F2")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("authority_paths must exactly match", result.stderr)

    def test_canon_and_calibration_sha_tamper_fail_closed(self) -> None:
        for key in ("bodyCanon", "headCanon", "f3VisionCalibration"):
            with self.subTest(key=key):
                data = self.manifest()
                data["character"][key]["sha256"] = "0" * 64
                self.save_manifest(data)
                result = self.run_gate("--mode", "verify-manifest")
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue("SHA-256 mismatch" in result.stderr or "independent trust anchor" in result.stderr)
                self.tmp.cleanup()
                self.setUp()

    def test_character_contract_missing_field_fails_closed(self) -> None:
        data = self.manifest()
        del data["benchmarks"]["F4"]["character"]["hairStyle"]
        self.save_manifest(data)
        result = self.run_gate("--mode", "benchmark", "--frame", "F4")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exactly", result.stderr)

    def test_character_contract_value_and_view_depth_alias_fail_closed(self) -> None:
        for mutate, expected in (
            (lambda d: d["benchmarks"]["F4"]["character"].update(skinTone="skin_99"), "canonical character"),
            (lambda d: d["benchmarks"]["F4"].update(viewClass="PROFILE_L"), "frame contract"),
            (lambda d: d["benchmarks"]["F4"].update(depthClass="PLANAR"), "frame contract"),
        ):
            with self.subTest(expected=expected):
                data = self.manifest()
                mutate(data)
                self.save_manifest(data)
                result = self.run_gate("--mode", "benchmark", "--frame", "F4")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(expected, result.stderr)
                self.tmp.cleanup()
                self.setUp()

    def test_f5_unlock_fails_closed(self) -> None:
        data = self.manifest()
        data["prohibited_progression"].remove("F5")
        self.save_manifest(data)
        result = self.run_gate("--mode", "verify-manifest")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("F5/F6", result.stderr)

    def test_f5_f6_policy_contradiction_fails_closed(self) -> None:
        data = self.manifest()
        data["authority_policy"]["f5_f6_progression"] = "allowed"
        self.save_manifest(data)
        result = self.run_gate("--mode", "verify-manifest")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("authority_policy", result.stderr)

    def test_manifest_authority_contracts_are_exact(self) -> None:
        cases = (
            ("manifest_version", lambda d: d.update(manifest_version="old")),
            ("authority_pack_version", lambda d: d.update(authority_pack_version="old")),
            ("coordinate missing", lambda d: d["coordinate_contract"].pop("runtime")),
            ("coordinate extra", lambda d: d["coordinate_contract"].update(extra="x")),
            ("coordinate value", lambda d: d["coordinate_contract"].update(review_scale="linear")),
            ("coordinate type", lambda d: d["coordinate_contract"].update(logical_height_px="190")),
            ("benchmark missing", lambda d: d["benchmarks"].pop("F3")),
            ("benchmark extra", lambda d: d["benchmarks"].update(F5={})),
            ("prohibited missing", lambda d: d["prohibited_progression"].pop()),
            ("prohibited extra", lambda d: d["prohibited_progression"].append("F8")),
            ("prohibited duplicate", lambda d: d["prohibited_progression"].append("F5")),
            ("policy missing", lambda d: d["authority_policy"].pop("f4_body_adoption")),
            ("policy extra", lambda d: d["authority_policy"].update(extra=True)),
            ("policy value", lambda d: d["authority_policy"].update(tracked_required=False)),
        )
        for label, mutate in cases:
            with self.subTest(label=label):
                data = self.manifest()
                mutate(data)
                self.save_manifest(data)
                result = self.run_gate("--mode", "verify-manifest")
                self.assertNotEqual(result.returncode, 0)
                self.tmp.cleanup()
                self.setUp()

    def test_each_frame_contract_field_is_fail_closed(self) -> None:
        fields = ("status", "adoption", "actionFamily", "viewClass", "depthClass", "view", "depth", "visibility", "sideIdentity")
        for frame in ("F2", "F3", "F4"):
            for field in fields:
                with self.subTest(frame=frame, field=field):
                    data = self.manifest()
                    data["benchmarks"][frame][field] = {"tampered": True}
                    self.save_manifest(data)
                    result = self.run_gate("--mode", "benchmark", "--frame", frame)
                    self.assertNotEqual(result.returncode, 0)
                    self.tmp.cleanup()
                    self.setUp()

    def test_nested_frame_identity_and_visibility_mutations_fail_closed(self) -> None:
        cases = (
            ("F2", "visibility", "leftLeg", "occluded"),
            ("F2", "visibility", "rightLeg", "occluded"),
            ("F3", "visibility", "leftArm", "occluded"),
            ("F3", "sideIdentity", "leftArm", "right"),
            ("F3", "sideIdentity", "rightArm", "left"),
            ("F4", "sideIdentity", "supportLeg", "right"),
            ("F4", "sideIdentity", "kickingLeg", "left"),
            ("F4", "visibility", "leftArm", "visible"),
            ("F4", "sideIdentity", "unexpectedContractKey", "left"),
        )
        for frame, section, key, value in cases:
            with self.subTest(frame=frame, section=section, key=key):
                data = self.manifest()
                data["benchmarks"][frame][section][key] = value
                self.save_manifest(data)
                result = self.run_gate("--mode", "benchmark", "--frame", frame)
                self.assertNotEqual(result.returncode, 0)
                self.tmp.cleanup()
                self.setUp()

    def test_certification_extra_hierarchy_fails_closed(self) -> None:
        data = self.manifest()
        data["certification"]["Action variant"] = "not-certified"
        self.save_manifest(data)
        result = self.run_gate("--mode", "verify-manifest")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not-certified", result.stderr)

    def test_f2_f3_adoption_is_required(self) -> None:
        for frame in ("F2", "F3"):
            data = self.manifest()
            data["benchmarks"][frame].pop("adoption")
            self.save_manifest(data)
            result = self.run_gate("--mode", "benchmark", "--frame", frame)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("missing required contract key", result.stderr)
            self.tmp.cleanup()
            self.setUp()

    def test_certification_unlock_fails_closed(self) -> None:
        data = self.manifest()
        data["certification"]["Pose class"] = "certified"
        self.save_manifest(data)
        result = self.run_gate("--mode", "verify-manifest")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not-certified", result.stderr)

    def test_frame_certification_unlock_fails_closed(self) -> None:
        data = self.manifest()
        data["certification"]["Frame"] = "certified"
        self.save_manifest(data)
        result = self.run_gate("--mode", "verify-manifest")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Frame/Sequence", result.stderr)

    def test_candidate_option_without_metrics_is_rejected(self) -> None:
        result = self.run_gate("--mode", "benchmark", "--frame", "F4", "--candidate", "candidate.png")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("candidate certification locked", result.stderr)

    def test_old_generation_path_is_rejected(self) -> None:
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools/art/shortpass_approval_gate.py"), "--mode", "generation", "--frame", "F4", "--backend", "cross-recipe-imagegen"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Phase 1 is authority verification only", result.stderr)

    def test_old_candidate_gate_is_locked_by_phase1_manifest(self) -> None:
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools/art/shortpass_candidate_gate.py"), "--frame", "F4", "--candidate", "missing.png"],
            cwd=ROOT, text=True, capture_output=True, check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("candidate certification locked until Phase 2 calibrated evaluator", result.stderr)

    def test_old_candidate_gate_manifest_status_and_calibration_fail_closed(self) -> None:
        for key, value in (("status", "old"), ("calibration_status", "calibrated")):
            with self.subTest(key=key):
                data = self.manifest()
                data[key] = value
                self.save_manifest(data)
                result = subprocess.run(
                    [sys.executable, str(ROOT / "tools/art/shortpass_candidate_gate.py"), "--artifact-root", str(self.root), "--frame", "F4", "--candidate", "missing.png"],
                    cwd=ROOT, text=True, capture_output=True, check=False,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("production manifest is not fail-closed Phase 1", result.stderr)
                self.tmp.cleanup()
                self.setUp()

    def test_independent_trust_anchor_full_entry_swaps_fail_closed(self) -> None:
        cases = (
            ("F2", "adopted_png", "F3", "adopted_png"),
            ("F2", "pose", "F3", "pose"),
            ("F2", "pose_rig", "F3", "pose_rig"),
            ("F2", "pose", "F4", "pose"),
        )
        for left_frame, left_key, right_frame, right_key in cases:
            with self.subTest(left=left_frame + left_key, right=right_frame + right_key):
                data = self.manifest()
                left = copy.deepcopy(data["benchmarks"][left_frame][left_key])
                data["benchmarks"][left_frame][left_key] = copy.deepcopy(data["benchmarks"][right_frame][right_key])
                data["benchmarks"][right_frame][right_key] = left
                self.save_manifest(data)
                result = self.run_gate("--mode", "benchmark", "--frame", left_frame)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("independent trust anchor", result.stderr)
                self.tmp.cleanup()
                self.setUp()

    def test_independent_trust_anchor_body_head_full_swap_fails_closed(self) -> None:
        data = self.manifest()
        data["character"]["bodyCanon"], data["character"]["headCanon"] = (
            copy.deepcopy(data["character"]["headCanon"]), copy.deepcopy(data["character"]["bodyCanon"])
        )
        self.save_manifest(data)
        result = self.run_gate("--mode", "verify-manifest")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("independent trust anchor", result.stderr)

    def test_top_level_character_contract_is_exact(self) -> None:
        cases = (
            ("extra", lambda d: d["character"].update(extra=True)),
            ("missing", lambda d: d["character"].pop("visibility")),
            ("scalar", lambda d: d["character"].update(viewClass="PROFILE_L")),
            ("side extra", lambda d: d["character"]["sideIdentity"].update(extra="x")),
            ("side missing", lambda d: d["character"]["sideIdentity"].pop("supportLeg")),
            ("side value", lambda d: d["character"]["sideIdentity"].update(kickingLeg="left")),
        )
        for label, mutate in cases:
            with self.subTest(label=label):
                data = self.manifest()
                mutate(data)
                self.save_manifest(data)
                result = self.run_gate("--mode", "verify-manifest")
                self.assertNotEqual(result.returncode, 0)
                self.tmp.cleanup()
                self.setUp()

    def test_strict_manifest_types_and_artifact_shapes_fail_closed(self) -> None:
        cases = (
            ("top missing", lambda d: d.pop("styleProfile")), ("top extra", lambda d: d.update(extra=True)),
            ("schema bool", lambda d: d.update(schema_version=True)), ("schema float", lambda d: d.update(schema_version=1.0)),
            ("height bool", lambda d: d["coordinate_contract"].update(logical_height_px=True)), ("height float", lambda d: d["coordinate_contract"].update(logical_height_px=190.0)),
            ("tracked int", lambda d: d["authority_policy"].update(tracked_required=1)), ("ignored int", lambda d: d["authority_policy"].update(ignored_authority_forbidden=0)), ("user gate int", lambda d: d["authority_policy"].update(candidate_adoption_requires_user_gate=1)),
            ("PNG extra", lambda d: d["benchmarks"]["F2"]["pose"].update(extra=True)), ("PNG no sha", lambda d: d["benchmarks"]["F2"]["pose"].pop("sha256")), ("PNG no dims", lambda d: d["benchmarks"]["F2"]["pose"].pop("dimensions")), ("PNG no mode", lambda d: d["benchmarks"]["F2"]["pose"].pop("mode")),
            ("JSON extra", lambda d: d["character"]["f3VisionCalibration"].update(extra=True)), ("JSON no sha", lambda d: d["character"]["f3VisionCalibration"].pop("sha256")),
            ("uppercase sha", lambda d: d["benchmarks"]["F2"]["pose"].update(sha256=d["benchmarks"]["F2"]["pose"]["sha256"].upper())), ("short sha", lambda d: d["benchmarks"]["F2"]["pose"].update(sha256="0")),
            ("dims bool", lambda d: d["benchmarks"]["F2"]["pose"].update(dimensions=[True, 360])), ("dims float", lambda d: d["benchmarks"]["F2"]["pose"].update(dimensions=[640, 360.0])), ("dims short", lambda d: d["benchmarks"]["F2"]["pose"].update(dimensions=[640])), ("dims long", lambda d: d["benchmarks"]["F2"]["pose"].update(dimensions=[640, 360, 1])),
            ("mode value", lambda d: d["benchmarks"]["F2"]["pose"].update(mode="RGBA")), ("mode type", lambda d: d["benchmarks"]["F2"]["pose"].update(mode=1)),
        )
        for label, mutate in cases:
            with self.subTest(label=label):
                data = self.manifest()
                mutate(data)
                self.save_manifest(data)
                result = self.run_gate("--mode", "verify-manifest")
                self.assertNotEqual(result.returncode, 0)
                self.tmp.cleanup()
                self.setUp()

    def test_generation_approval_settings_are_fail_closed(self) -> None:
        cases = (
            ("enabled true", lambda d: d["generation_gate"].update(enabled=True)),
            ("enabled int", lambda d: d["generation_gate"].update(enabled=0)),
            ("enabled missing", lambda d: d["generation_gate"].pop("enabled")),
            ("phase other", lambda d: d["generation_gate"].update(phase="other")),
            ("phase missing", lambda d: d["generation_gate"].pop("phase")),
        )
        for label, mutate in cases:
            with self.subTest(label=label):
                data = json.loads((self.root / "design/SHORTPASS_APPROVAL.json").read_text(encoding="utf-8"))
                mutate(data)
                (self.root / "design/SHORTPASS_APPROVAL.json").write_text(json.dumps(data), encoding="utf-8")
                result = subprocess.run(
                    [sys.executable, str(ROOT / "tools/art/shortpass_approval_gate.py"), "--artifact-root", str(self.root), "--mode", "generation"],
                    cwd=ROOT, text=True, capture_output=True, check=False,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("approval generation gate is not fail-closed", result.stderr)
                self.tmp.cleanup()
                self.setUp()

    def test_production_gate_approval_lock_is_fail_closed(self) -> None:
        for label, mutate in (
            ("enabled", lambda d: d["generation_gate"].update(enabled=True)),
            ("phase", lambda d: d["generation_gate"].update(phase="other")),
        ):
            with self.subTest(label=label):
                data = json.loads((self.root / "design/SHORTPASS_APPROVAL.json").read_text(encoding="utf-8"))
                mutate(data)
                (self.root / "design/SHORTPASS_APPROVAL.json").write_text(json.dumps(data), encoding="utf-8")
                result = self.run_gate("--mode", "verify-manifest")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("approval generation gate", result.stderr)
                self.tmp.cleanup()
                self.setUp()

    def test_build_composite_reads_artifact_root_approval_ledger(self) -> None:
        data = json.loads((self.root / "design/SHORTPASS_APPROVAL.json").read_text(encoding="utf-8"))
        data["components"]["legs"]["status"] = "revoked"
        (self.root / "design/SHORTPASS_APPROVAL.json").write_text(json.dumps(data), encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools/art/shortpass_approval_gate.py"), "--artifact-root", str(self.root), "--mode", "build-composite"],
            cwd=ROOT, text=True, capture_output=True, check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("status is revoked", result.stderr)

    def test_phase1_candidate_inputs_are_always_rejected(self) -> None:
        for option, value in (("--candidate", "candidate.txt"), ("--masks-dir", "masks"), ("--metrics-json", "metrics.json")):
            with self.subTest(option=option):
                result = self.run_gate("--mode", "benchmark", "--frame", "F4", option, value)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("candidate certification locked", result.stderr)

    def test_non_png_candidate_and_nan_metrics_use_same_fixed_rejection(self) -> None:
        candidate = self.root / "candidate.txt"
        candidate.write_text("not-an-image", encoding="utf-8")
        metrics = self.root / "metrics.json"
        metrics.write_text('{"jointError": NaN}', encoding="utf-8")
        for option, value in (("--candidate", str(candidate)), ("--metrics-json", str(metrics))):
            with self.subTest(option=option):
                result = self.run_gate("--mode", "benchmark", "--frame", "F4", option, value)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("candidate certification locked until Phase 2 calibrated evaluator; Phase 1 accepts no candidate inputs", result.stderr)

    def test_manifest_alternate_path_is_not_a_supported_cli(self) -> None:
        result = self.run_gate("--mode", "verify-manifest", "--manifest", "elsewhere.json")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unrecognized arguments", result.stderr)

    def test_phase1_manifest_has_no_evaluation_thresholds(self) -> None:
        data = self.manifest()
        self.assertEqual(data["calibration_status"], "not-calibrated")
        self.assertNotIn("thresholds", data)
        self.assertNotIn("thresholds", data.get("evaluation", {}))

    def test_injected_manifest_thresholds_fail_closed(self) -> None:
        for location in ("top-level", "evaluation"):
            with self.subTest(location=location):
                data = self.manifest()
                if location == "top-level":
                    data["thresholds"] = {"jointError": 1}
                else:
                    data["evaluation"] = {"thresholds": {"jointError": 1}}
                self.save_manifest(data)
                result = self.run_gate("--mode", "verify-manifest")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("must not contain evaluation thresholds", result.stderr)
                self.tmp.cleanup()
                self.setUp()

    def test_fixture_skip_requires_sentinel(self) -> None:
        sentinel = self.root / ".cutscene-gate-test-fixture"
        sentinel.unlink()
        result = self.run_gate("--mode", "verify-manifest")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("only for explicit non-production", result.stderr)

    def test_generation_manifest_status_is_fail_closed(self) -> None:
        manifest = self.root / "design/CUTSCENE_PRODUCTION_MANIFEST.json"
        data = self.manifest()
        data["status"] = "unknown"
        self.save_manifest(data)
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools/art/shortpass_approval_gate.py"), "--artifact-root", str(self.root), "--mode", "generation"],
            cwd=ROOT, text=True, capture_output=True, check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("manifest status does not permit generation", result.stderr)


if __name__ == "__main__":
    unittest.main()
