from __future__ import annotations

import contextlib
import io
import sys
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
            parent = Path(temporary)
            root = self.workspace(parent)
            artifacts = parent / "host-state"
            code, stdout, stderr = self.invoke(
                root,
                [
                    "generate",
                    "--dry-run",
                    "--artifact-root",
                    str(artifacts),
                    "--codex-executable",
                    sys.executable,
                    "alpha",
                ],
            )
            self.assertEqual((code, stderr), (0, ""))
            self.assertIn(f"{Path(sys.executable).resolve()} exec", stdout)
            self.assertIn("--model gpt-5.6-sol", stdout)
            self.assertIn("model_reasoning_effort=\"max\"", stdout)
            self.assertIn("forced_login_method=\"chatgpt\"", stdout)
            self.assertIn("model_provider=\"openai\"", stdout)
            self.assertIn(
                "openai_base_url=\"https://chatgpt.com/backend-api/codex\"",
                stdout,
            )
            self.assertIn("--ignore-user-config", stdout)
            self.assertIn("trust_level=\"untrusted\"", stdout)
            self.assertIn("features.hooks=false", stdout)
            self.assertIn("features.plugins=false", stdout)
            self.assertIn("features.browser_use=false", stdout)
            self.assertIn("web_search=\"disabled\"", stdout)
            self.assertIn("project_doc_max_bytes=0", stdout)
            self.assertIn("mcp_servers={}", stdout)
            self.assertIn("skills.include_instructions=false", stdout)
            self.assertIn("--sandbox read-only --ephemeral", stdout)
            self.assertIn("--output-schema", stdout)
            self.assertIn(str(artifacts / "previews/.partial/alpha/preview.json"), stdout)
            self.assertIn("--- prompt (stdin) ---\n# Contract", stdout)

    def test_external_artifact_root_is_shared_by_validate_compile_and_serve_locks(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root = self.workspace(parent)
            artifacts = parent / "host-state"
            lock = artifacts / "previews/.locks/alpha.lock"
            for command in ("validate", "compile", "serve"):
                with self.subTest(command=command), ProjectLock(lock):
                    code, stdout, stderr = self.invoke(
                        root,
                        [command, "alpha", "--artifact-root", str(artifacts)],
                    )
                self.assertEqual(code, 1)
                self.assertEqual(stdout, "")
                self.assertIn("another preview operation owns this project", stderr)

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

    def test_checkout_launcher_disables_bytecode_writes(self) -> None:
        launcher = Path(__file__).resolve().parents[1] / "bin/preview"
        self.assertIn("exec python3 -I -B -c", launcher.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
