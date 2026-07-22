from __future__ import annotations

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
    generate_project,
    plan_generation,
)
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
