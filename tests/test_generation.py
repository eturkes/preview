from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from test_contract import valid_data

from preview_tool.generation import (
    DIAGNOSTIC_MAX_BYTES,
    REPAIR_MAX_FINDINGS,
    _repair_feedback,
    _run_codex,
    compile_project,
    generate_project,
    plan_generation,
)
from preview_tool.render import compiled_files
from preview_tool.schema import canonical_json
from preview_tool.validation import Finding, Report, validate_bundle


class GenerationTests(unittest.TestCase):
    def workspace(self, parent: Path) -> tuple[Path, Path]:
        root = parent / "preview"
        source = parent / "sample"
        root.mkdir()
        source.mkdir()
        (source / "source.txt").write_text(
            "Status evidence\nOverview evidence\nDemo evidence\nState evidence\n",
            encoding="utf-8",
        )
        template_source = Path(__file__).resolve().parents[1] / "templates"
        shutil.copytree(template_source, root / "templates")
        (root / "previews").mkdir()
        return root, source

    def test_valid_structured_output_compiles_and_publishes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, source = self.workspace(Path(temporary))

            def fake_codex(plan, prompt):
                self.assertIn("Project slug: `sample`", prompt)
                plan.output_file.write_bytes(canonical_json(valid_data()))
                return subprocess.CompletedProcess([], 0, "", "")

            with mock.patch("preview_tool.generation._run_codex", side_effect=fake_codex) as run:
                outcome = generate_project(root, "sample")
            self.assertTrue(outcome.ok, outcome.message)
            self.assertEqual(run.call_count, 1)
            live = root / "previews" / "sample"
            self.assertTrue((live / "index.html").is_file())
            self.assertFalse((root / "previews" / ".partial" / "sample").exists())
            report = validate_bundle(
                live,
                "sample",
                source,
                root / "previews",
                root / "templates",
            )
            self.assertTrue(report.ok, report.format())

    def test_compile_canonicalizes_repairs_and_is_deterministic_without_codex(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root, source = self.workspace(parent)
            live = root / "previews" / "sample"
            live.mkdir()
            data = valid_data()
            raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            (live / "preview.json").write_bytes(raw)
            (live / "stale").write_text("replaced", encoding="utf-8")
            model = parent / "model.json"
            model.write_bytes(raw)

            first_outcome = compile_project(root, "sample", model)
            self.assertTrue(first_outcome.ok, first_outcome.message)
            self.assertEqual((live / "preview.json").read_bytes(), canonical_json(data))
            self.assertFalse((live / "stale").exists())
            first = {entry.name: entry.read_bytes() for entry in sorted(live.iterdir())}
            self.assertEqual(
                set(first),
                {"preview.json", *compiled_files(data, root / "templates")},
            )
            report = validate_bundle(live, "sample", source, root / "previews", root / "templates")
            self.assertTrue(report.ok, report.format())

            second_outcome = compile_project(root, "sample")
            second = {entry.name: entry.read_bytes() for entry in sorted(live.iterdir())}
            self.assertTrue(second_outcome.ok, second_outcome.message)
            self.assertEqual(first, second)

    def test_compile_invalid_or_symlinked_input_preserves_valid_live(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root, _ = self.workspace(parent)
            live = root / "previews" / "sample"
            live.mkdir()
            data = valid_data()
            (live / "preview.json").write_bytes(canonical_json(data))
            for name, content in compiled_files(data, root / "templates").items():
                (live / name).write_bytes(content)
            before = {entry.name: entry.read_bytes() for entry in sorted(live.iterdir())}

            invalid = parent / "invalid.json"
            invalid.write_bytes(b"{}\n")
            outcome = compile_project(root, "sample", invalid)
            after = {entry.name: entry.read_bytes() for entry in sorted(live.iterdir())}
            self.assertFalse(outcome.ok)
            self.assertIn("no live bundle replaced for sample", outcome.message)
            self.assertEqual(before, after)

            target = parent / "target.json"
            target.write_bytes(canonical_json(valid_data()))
            symlink = parent / "model.json"
            symlink.symlink_to(target.name)
            with self.assertRaisesRegex(ValueError, "cannot read model safely"):
                compile_project(root, "sample", symlink)
            fifo = parent / "model.fifo"
            os.mkfifo(fifo)
            started = time.monotonic()
            with self.assertRaisesRegex(ValueError, "cannot read model safely"):
                compile_project(root, "sample", fifo)
            self.assertLess(time.monotonic() - started, 1)
            with self.assertRaisesRegex(ValueError, "outside the reserved previews directory"):
                compile_project(root, "sample", live / "preview.json")
            self.assertEqual(
                before,
                {entry.name: entry.read_bytes() for entry in sorted(live.iterdir())},
            )

    def test_compile_external_model_can_create_first_publish(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root, source = self.workspace(parent)
            model = parent / "model.json"
            model.write_bytes(canonical_json(valid_data()))

            outcome = compile_project(root, "sample", model)
            live = root / "previews" / "sample"
            self.assertTrue(outcome.ok, outcome.message)
            report = validate_bundle(live, "sample", source, root / "previews", root / "templates")
            self.assertTrue(report.ok, report.format())

    def test_compile_rejects_symlinked_live_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root, _ = self.workspace(parent)
            target = parent / "target"
            target.mkdir()
            live = root / "previews" / "sample"
            live.symlink_to(target, target_is_directory=True)
            model = parent / "model.json"
            model.write_bytes(canonical_json(valid_data()))

            with self.assertRaisesRegex(ValueError, "not a real directory"):
                compile_project(root, "sample", model)
            self.assertTrue(live.is_symlink())

    def test_invalid_output_retries_and_preserves_live(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, _ = self.workspace(Path(temporary))
            live = root / "previews" / "sample"
            live.mkdir()
            (live / "sentinel").write_text("old", encoding="utf-8")

            def fake_codex(plan, prompt):
                plan.output_file.write_bytes(b"{}\n")
                return subprocess.CompletedProcess([], 0, "", "")

            with mock.patch("preview_tool.generation._run_codex", side_effect=fake_codex) as run:
                outcome = generate_project(root, "sample")
            self.assertFalse(outcome.ok)
            self.assertEqual(run.call_count, 2)
            self.assertEqual((live / "sentinel").read_text(encoding="utf-8"), "old")
            retained = root / "previews" / ".partial" / "sample" / "preview.json"
            self.assertEqual(retained.read_bytes(), b"{}\n")
            second_prompt = run.call_args_list[1].args[1]
            self.assertIn("Repair feedback", second_prompt)
            self.assertIn("schema.keys", second_prompt)

    def test_repair_feedback_is_bounded_and_reports_omissions(self) -> None:
        report = Report(
            tuple(
                Finding("error", "schema.test", f"$.{index}", "invalid")
                for index in range(REPAIR_MAX_FINDINGS + 20)
            )
        )
        feedback = _repair_feedback(report)
        self.assertLessEqual(feedback.count("[ERROR]"), REPAIR_MAX_FINDINGS)
        self.assertIn("20 additional findings omitted", feedback)
        hostile = _repair_feedback(
            Report((Finding("error", "schema.test", "$", "bad\x1b]8;;link\x07"),))
        )
        self.assertNotIn("\x1b", hostile)
        self.assertNotIn("\x07", hostile)
        self.assertIn("\\u001b", hostile)

    def test_codex_diagnostics_are_drained_into_bounded_tails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, _ = self.workspace(Path(temporary))
            plan = plan_generation(root, "sample")
            script = (
                "import sys; sys.stdin.buffer.read(); "
                f"sys.stdout.buffer.write(b'a'*{DIAGNOSTIC_MAX_BYTES + 1000}); "
                f"sys.stderr.buffer.write(b'b'*{DIAGNOSTIC_MAX_BYTES + 2000})"
            )
            with mock.patch(
                "preview_tool.generation.codex_argv",
                return_value=[sys.executable, "-c", script],
            ):
                completed = _run_codex(plan, "prompt")
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(len(completed.stdout), DIAGNOSTIC_MAX_BYTES)
        self.assertEqual(len(completed.stderr), DIAGNOSTIC_MAX_BYTES)
        self.assertEqual(set(completed.stdout), {"a"})
        self.assertEqual(set(completed.stderr), {"b"})

    def test_codex_drain_does_not_wait_for_inherited_descendant_pipes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, _ = self.workspace(Path(temporary))
            plan = plan_generation(root, "sample")
            script = (
                "import subprocess,sys; sys.stdin.buffer.read(); "
                "subprocess.Popen([sys.executable,'-c','import time; time.sleep(20)'])"
            )
            started = time.monotonic()
            with mock.patch(
                "preview_tool.generation.codex_argv",
                return_value=[sys.executable, "-c", script],
            ):
                completed = _run_codex(plan, "prompt")
            elapsed = time.monotonic() - started
        self.assertEqual(completed.returncode, 0)
        self.assertLess(elapsed, 5)


if __name__ == "__main__":
    unittest.main()
