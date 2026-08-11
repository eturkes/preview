from __future__ import annotations

import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from preview_tool.cli import main
from preview_tool.publication import ProjectLock


class CliTests(unittest.TestCase):
    def workspace(self, parent: Path) -> Path:
        root = parent / "preview"
        root.mkdir()
        templates = root / "templates"
        templates.mkdir()
        (templates / "dashboard-prompt.md").write_text("# Contract\n", encoding="utf-8")
        (templates / "author-output.schema.json").write_text("{}\n", encoding="utf-8")
        (parent / "alpha").mkdir()
        (parent / "研究").mkdir()
        return root

    def invoke(self, root: Path, argv: list[str]) -> tuple[int, str, str]:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = main(argv, root=root)
        return code, stdout.getvalue(), stderr.getvalue()

    def test_list_mutation_status_and_stale_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root = self.workspace(parent)
            code, stdout, stderr = self.invoke(root, ["list"])
            self.assertEqual((code, stdout, stderr), (0, "alpha\n研究\n", ""))
            self.assertEqual(self.invoke(root, ["enable", "alpha"]), (0, "enabled alpha\n", ""))
            code, stdout, _ = self.invoke(root, ["status"])
            self.assertEqual(code, 0)
            self.assertEqual(stdout, "[x] alpha\n[ ] 研究\n")
            (parent / "alpha").rmdir()
            self.assertEqual(self.invoke(root, ["disable", "alpha"]), (0, "disabled alpha\n", ""))

    def test_unknown_name_fails_without_state_write(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self.workspace(Path(temporary))
            code, _, stderr = self.invoke(root, ["enable", "ghost"])
            self.assertEqual(code, 1)
            self.assertIn("unknown project", stderr)
            self.assertFalse((root / "enabled.txt").exists())

    def test_dry_run_exposes_exact_read_only_structured_invocation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self.workspace(Path(temporary))
            code, stdout, stderr = self.invoke(root, ["generate", "--dry-run", "alpha"])
            self.assertEqual((code, stderr), (0, ""))
            self.assertIn("codex exec --sandbox read-only --ephemeral", stdout)
            self.assertIn("--output-schema", stdout)
            self.assertIn("previews/.partial/alpha/preview.json", stdout)
            self.assertIn("--- prompt (stdin) ---\n# Contract", stdout)

    def test_empty_enabled_batch_is_successful(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self.workspace(Path(temporary))
            self.assertEqual(
                self.invoke(root, ["generate"]),
                (0, "summary: 0 passed, 0 failed\n", ""),
            )

    def test_validate_fails_closed_while_project_lock_is_owned(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self.workspace(Path(temporary))
            lock = root / "previews" / ".locks" / "alpha.lock"
            with ProjectLock(lock):
                code, stdout, stderr = self.invoke(root, ["validate", "alpha"])
            self.assertEqual(code, 1)
            self.assertEqual(stdout, "")
            self.assertIn("another preview operation owns this project", stderr)

    def test_compile_fails_closed_while_project_lock_is_owned(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self.workspace(Path(temporary))
            lock = root / "previews" / ".locks" / "alpha.lock"
            with ProjectLock(lock):
                code, stdout, stderr = self.invoke(root, ["compile", "alpha"])
            self.assertEqual(code, 1)
            self.assertEqual(stdout, "")
            self.assertIn("another preview operation owns this project", stderr)


if __name__ == "__main__":
    unittest.main()
