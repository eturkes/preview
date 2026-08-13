from __future__ import annotations

import json
import os
import signal
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
    _preflight_codex,
    _repair_feedback,
    _run_codex,
    _run_preflight_command,
    codex_argv,
    codex_environment,
    compile_project,
    generate_project,
    plan_generation,
)
from preview_tool.render import compiled_files
from preview_tool.records import normalize_user_prompt, read_record
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

    def test_user_prompt_normalization_matches_browser_contract(self) -> None:
        self.assertEqual(normalize_user_prompt("\ufeff direction \ufeff"), "direction")
        self.assertEqual(
            normalize_user_prompt(" " + ("x" * 8_000) + " "),
            "x" * 8_000,
        )
        with self.assertRaisesRegex(ValueError, "exceeds 8000"):
            normalize_user_prompt("😀" * 4_001)

    def test_valid_structured_output_compiles_and_publishes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, source = self.workspace(Path(temporary))

            def fake_codex(plan, prompt):
                self.assertIn("Project slug: `sample`", prompt)
                plan.output_file.write_bytes(canonical_json(valid_data()))
                return subprocess.CompletedProcess([], 0, "", "")

            with (
                mock.patch("preview_tool.generation._preflight_codex"),
                mock.patch("preview_tool.generation._run_codex", side_effect=fake_codex) as run,
            ):
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

    def test_incremental_prompt_and_explicit_fresh_strategy_are_recorded(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, _ = self.workspace(Path(temporary))
            prompts: list[str] = []

            def fake_codex(plan, prompt):
                prompts.append(prompt)
                plan.output_file.write_bytes(canonical_json(valid_data()))
                return subprocess.CompletedProcess([], 0, "", "")

            with (
                mock.patch("preview_tool.generation._preflight_codex"),
                mock.patch("preview_tool.generation._run_codex", side_effect=fake_codex),
            ):
                first = generate_project(root, "sample")
                updated = generate_project(
                    root,
                    "sample",
                    user_prompt="Lead with the parser migration.",
                )
                fresh = generate_project(
                    root,
                    "sample",
                    from_scratch=True,
                    user_prompt="Use a compact release-readiness layout.",
                )

            self.assertTrue(first.ok, first.message)
            self.assertTrue(updated.ok, updated.message)
            self.assertTrue(fresh.ok, fresh.message)
            self.assertIn("Initial generation", prompts[0])
            self.assertIn("Incremental update", prompts[1])
            self.assertIn(str(root / "previews/sample/preview.json"), prompts[1])
            self.assertIn("Lead with the parser migration.", prompts[1])
            self.assertIn("Fresh regeneration", prompts[2])
            self.assertNotIn("Prior validated Preview model", prompts[2])
            record = read_record(root / "previews/.records/sample.json", "sample")
            self.assertIsNotNone(record)
            assert record is not None
            self.assertEqual(record.strategy, "fresh")
            self.assertEqual(record.prompt, "Use a compact release-readiness layout.")

    def test_expected_revision_requires_the_same_clean_commit_before_spending(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, source = self.workspace(Path(temporary))
            subprocess.run(["git", "init", "-q"], cwd=source, check=True)
            subprocess.run(["git", "add", "source.txt"], cwd=source, check=True)
            subprocess.run(
                [
                    "git",
                    "-c",
                    "user.name=Fixture",
                    "-c",
                    "user.email=fixture@localhost",
                    "commit",
                    "-qm",
                    "fixture",
                ],
                cwd=source,
                check=True,
            )
            revision = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=source,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()

            def fake_codex(plan, prompt):
                plan.output_file.write_bytes(canonical_json(valid_data()))
                return subprocess.CompletedProcess([], 0, "", "")

            with (
                mock.patch("preview_tool.generation._preflight_codex") as preflight,
                mock.patch("preview_tool.generation._run_codex", side_effect=fake_codex),
            ):
                outcome = generate_project(root, "sample", expected_revision=revision)
                (source / "dirty.txt").write_text("dirty\n", encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "expected clean Git revision"):
                    generate_project(root, "sample", expected_revision=revision)

            self.assertTrue(outcome.ok, outcome.message)
            self.assertEqual(preflight.call_count, 1)
            record = read_record(root / "previews/.records/sample.json", "sample")
            self.assertIsNotNone(record)
            assert record is not None
            self.assertEqual(record.sourceRevision, revision)
            self.assertFalse(record.sourceDirty)

    def test_atomic_publication_support_is_required_before_codex_preflight(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, _ = self.workspace(Path(temporary))
            with (
                mock.patch(
                    "preview_tool.generation.require_atomic_exchange_support",
                    side_effect=RuntimeError("unsupported output filesystem"),
                ),
                mock.patch("preview_tool.generation._preflight_codex") as preflight,
                mock.patch("preview_tool.generation._run_codex") as codex,
                self.assertRaisesRegex(RuntimeError, "unsupported output filesystem"),
            ):
                generate_project(root, "sample", codex_executable=Path(sys.executable))

            preflight.assert_not_called()
            codex.assert_not_called()

    def test_generation_accepts_explicit_non_sibling_source(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root, source = self.workspace(parent)
            nested = parent / "nested"
            nested.mkdir()
            mapped_source = nested / "source"
            source.rename(mapped_source)

            def fake_codex(plan, prompt):
                self.assertEqual(plan.paths.source, mapped_source)
                self.assertIn(f"Source root: `{mapped_source}`", prompt)
                plan.output_file.write_bytes(canonical_json(valid_data()))
                return subprocess.CompletedProcess([], 0, "", "")

            with (
                mock.patch("preview_tool.generation._preflight_codex"),
                mock.patch("preview_tool.generation._run_codex", side_effect=fake_codex),
            ):
                outcome = generate_project(root, "sample", mapped_source)

            self.assertTrue(outcome.ok, outcome.message)
            report = validate_bundle(
                root / "previews/sample",
                "sample",
                mapped_source,
                root / "previews",
                root / "templates",
            )
            self.assertTrue(report.ok, report.format())

    def test_external_artifact_root_owns_generation_state_and_publish(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root, source = self.workspace(parent)
            artifacts = parent / "host-state" / "preview"

            def fake_codex(plan, prompt):
                self.assertEqual(plan.paths.preview_home, artifacts / "previews")
                self.assertEqual(plan.output_file, artifacts / "previews/.partial/sample/preview.json")
                plan.output_file.write_bytes(canonical_json(valid_data()))
                return subprocess.CompletedProcess([], 0, "", "")

            with (
                mock.patch("preview_tool.generation._preflight_codex"),
                mock.patch("preview_tool.generation._run_codex", side_effect=fake_codex),
            ):
                outcome = generate_project(root, "sample", artifact_root=artifacts)

            self.assertTrue(outcome.ok, outcome.message)
            live = artifacts / "previews/sample"
            self.assertTrue((live / "index.html").is_file())
            self.assertFalse((root / "previews/sample").exists())
            self.assertFalse((artifacts / "previews/.partial/sample").exists())
            report = validate_bundle(
                live,
                "sample",
                source,
                artifacts / "previews",
                root / "templates",
            )
            self.assertTrue(report.ok, report.format())

    def test_external_artifact_root_must_stay_outside_source(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, source = self.workspace(Path(temporary))
            with self.assertRaisesRegex(ValueError, "artifact root must be outside the source"):
                plan_generation(root, "sample", artifact_root=source / ".generated")

    def test_external_artifact_root_cannot_contain_source(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root, _ = self.workspace(parent)
            with self.assertRaisesRegex(ValueError, "artifact root must be outside the source"):
                plan_generation(root, "sample", artifact_root=parent)

    def test_external_artifact_root_rejects_dangling_symlink_ancestor(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root, _ = self.workspace(parent)
            dangling = parent / "dangling"
            dangling.symlink_to(parent / "missing", target_is_directory=True)

            with self.assertRaisesRegex(ValueError, "unresolved symlink"):
                plan_generation(root, "sample", artifact_root=dangling / "artifacts")

    def test_codex_command_pins_subscription_model_effort_and_absolute_executable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root, _ = self.workspace(parent)
            artifacts = parent / "artifacts"
            plan = plan_generation(
                root,
                "sample",
                artifact_root=artifacts,
                codex_executable=Path(sys.executable),
            )

            argv = codex_argv(plan)

            self.assertEqual(
                argv[:5],
                ["timeout", "--kill-after=30", "1800", str(Path(sys.executable).resolve()), "exec"],
            )
            self.assertIn("--model", argv)
            self.assertEqual(argv[argv.index("--model") + 1], "gpt-5.6-sol")
            self.assertIn('model_reasoning_effort="max"', argv)
            self.assertIn('forced_login_method="chatgpt"', argv)
            self.assertIn('model_provider="openai"', argv)
            self.assertIn(
                'openai_base_url="https://chatgpt.com/backend-api/codex"',
                argv,
            )
            self.assertIn("--ignore-user-config", argv)
            project_trust = next(value for value in argv if value.startswith("projects."))
            self.assertEqual(
                project_trust,
                f'projects.{json.dumps(str(plan.paths.source))}.trust_level="untrusted"',
            )
            for feature in (
                "hooks",
                "apps",
                "plugins",
                "remote_plugin",
                "browser_use",
                "browser_use_external",
                "browser_use_full_cdp_access",
                "computer_use",
                "image_generation",
                "in_app_browser",
                "multi_agent",
                "goals",
                "skill_mcp_dependency_install",
                "skill_search",
                "tool_call_mcp_elicitation",
                "tool_suggest",
                "workspace_dependencies",
            ):
                self.assertIn(f"features.{feature}=false", argv)
            self.assertIn('web_search="disabled"', argv)
            self.assertIn("project_doc_max_bytes=0", argv)
            self.assertIn("mcp_servers={}", argv)
            self.assertIn("skills.include_instructions=false", argv)
            self.assertNotIn("features.shell_tool=false", argv)
            self.assertIn("--sandbox", argv)
            self.assertEqual(argv[argv.index("--sandbox") + 1], "read-only")
            self.assertIn("--ephemeral", argv)
            self.assertEqual(plan.output_file, artifacts / "previews/.partial/sample/preview.json")

    def test_codex_environment_drops_api_auth_overrides(self) -> None:
        with mock.patch.dict(
            os.environ,
            {
                "OPENAI_API_KEY": "openai-secret",
                "CODEX_API_KEY": "codex-secret",
                "CODEX_ACCESS_TOKEN": "access-secret",
                "PREVIEW_SAFE_SENTINEL": "preserved",
            },
            clear=False,
        ):
            environment = codex_environment()

        self.assertNotIn("OPENAI_API_KEY", environment)
        self.assertNotIn("CODEX_API_KEY", environment)
        self.assertNotIn("CODEX_ACCESS_TOKEN", environment)
        self.assertEqual(environment["PREVIEW_SAFE_SENTINEL"], "preserved")

    def test_subscription_preflight_requires_chatgpt_auth_and_reachability(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, _ = self.workspace(Path(temporary))
            plan = plan_generation(root, "sample", codex_executable=Path(sys.executable))
            doctor = {
                "checks": {
                    "auth.credentials": {
                        "status": "ok",
                        "details": {
                            "stored auth mode": "chatgpt",
                            "stored ChatGPT tokens": "true",
                        },
                    },
                    "network.provider_reachability": {
                        "status": "ok",
                        "details": {"reachability mode": "ChatGPT auth"},
                    },
                    "network.websocket_reachability": {
                        "status": "ok",
                        "details": {
                            "auth mode": "chatgpt",
                            "model provider": "openai",
                            "endpoint": "wss://chatgpt.com/backend-api/<redacted>",
                            "handshake result": "HTTP 101 Switching Protocols",
                        },
                    },
                }
            }
            success = [
                subprocess.CompletedProcess([], 0, "", "Logged in using ChatGPT\n"),
                # Doctor can report unrelated terminal warnings through its overall rc.
                subprocess.CompletedProcess([], 1, json.dumps(doctor), ""),
            ]

            with mock.patch("preview_tool.generation._run_preflight_command", side_effect=success) as run:
                _preflight_codex(plan)

            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args_list[0].args[1][-2:], ["login", "status"])
            self.assertEqual(run.call_args_list[1].args[1][-2:], ["doctor", "--json"])
            for call in run.call_args_list:
                self.assertIn('model_provider="openai"', call.args[1])
                self.assertIn(
                    'openai_base_url="https://chatgpt.com/backend-api/codex"',
                    call.args[1],
                )
                self.assertIn(
                    f'projects.{json.dumps(str(plan.paths.source))}.trust_level="untrusted"',
                    call.args[1],
                )
                self.assertIn("features.hooks=false", call.args[1])
                self.assertIn("features.plugins=false", call.args[1])
                self.assertIn('web_search="disabled"', call.args[1])
                self.assertIn("project_doc_max_bytes=0", call.args[1])
                self.assertIn("mcp_servers={}", call.args[1])
                self.assertIn("skills.include_instructions=false", call.args[1])

            bad_login = subprocess.CompletedProcess([], 0, "", "Logged in using an API key\n")
            with (
                mock.patch("preview_tool.generation._run_preflight_command", return_value=bad_login),
                self.assertRaisesRegex(RuntimeError, "ChatGPT subscription login"),
            ):
                _preflight_codex(plan)

            noisy_login = subprocess.CompletedProcess(
                [], 0, "Logged in using ChatGPT\n", "unexpected warning\n"
            )
            with (
                mock.patch(
                    "preview_tool.generation._run_preflight_command",
                    return_value=noisy_login,
                ),
                self.assertRaisesRegex(RuntimeError, "ChatGPT subscription login"),
            ):
                _preflight_codex(plan)

            doctor["checks"]["network.websocket_reachability"]["status"] = "fail"
            failed_checks = [
                subprocess.CompletedProcess([], 0, "", "Logged in using ChatGPT\n"),
                subprocess.CompletedProcess([], 0, json.dumps(doctor), ""),
            ]
            with (
                mock.patch(
                    "preview_tool.generation._run_preflight_command", side_effect=failed_checks
                ),
                self.assertRaisesRegex(RuntimeError, "WebSocket"),
            ):
                _preflight_codex(plan)

    def test_project_trust_override_toml_quotes_source_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root, source = self.workspace(parent)
            quoted = parent / 'source.with.dot and "quote"'
            source.rename(quoted)
            plan = plan_generation(
                root,
                "sample",
                quoted,
                codex_executable=Path(sys.executable),
            )

            argv = codex_argv(plan)

            self.assertIn(
                f'projects.{json.dumps(str(quoted))}.trust_level="untrusted"',
                argv,
            )

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

    def test_compile_accepts_explicit_non_sibling_source(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root, source = self.workspace(parent)
            live = root / "previews" / "sample"
            live.mkdir()
            (live / "preview.json").write_bytes(canonical_json(valid_data()))
            nested = parent / "nested"
            nested.mkdir()
            mapped_source = nested / "source"
            source.rename(mapped_source)

            outcome = compile_project(root, "sample", source=mapped_source)

            self.assertTrue(outcome.ok, outcome.message)
            report = validate_bundle(
                live,
                "sample",
                mapped_source,
                root / "previews",
                root / "templates",
            )
            self.assertTrue(report.ok, report.format())

    def test_explicit_source_rejects_reserved_names_before_publication(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root, source = self.workspace(parent)
            sentinel = root / "previews" / "sentinel"
            sentinel.write_text("preserved\n", encoding="utf-8")

            for project in (".", "..", ".partial", ".previous", ".locks"):
                with self.subTest(project=project), self.assertRaisesRegex(
                    ValueError,
                    "invalid project name",
                ):
                    compile_project(root, project, source=source)

            self.assertEqual(sentinel.read_text(encoding="utf-8"), "preserved\n")

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

            with (
                mock.patch("preview_tool.generation._preflight_codex"),
                mock.patch("preview_tool.generation._run_codex", side_effect=fake_codex) as run,
            ):
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

    def test_preflight_diagnostics_are_drained_into_bounded_tails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, _ = self.workspace(Path(temporary))
            plan = plan_generation(root, "sample")
            script = (
                "import sys; "
                f"sys.stdout.buffer.write(b'a'*{DIAGNOSTIC_MAX_BYTES * 4}); "
                f"sys.stderr.buffer.write(b'b'*{DIAGNOSTIC_MAX_BYTES * 5})"
            )
            completed = _run_preflight_command(plan, [sys.executable, "-c", script])
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(len(completed.stdout), DIAGNOSTIC_MAX_BYTES)
        self.assertEqual(len(completed.stderr), DIAGNOSTIC_MAX_BYTES)
        self.assertEqual(set(completed.stdout), {"a"})
        self.assertEqual(set(completed.stderr), {"b"})

    def test_codex_process_receives_sanitized_environment(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, _ = self.workspace(Path(temporary))
            plan = plan_generation(root, "sample")
            script = (
                "import os,sys; sys.stdin.buffer.read(); "
                "sys.stdout.write(','.join(sorted(name for name in os.environ "
                "if name in {'OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN'})))"
            )
            with (
                mock.patch.dict(
                    os.environ,
                    {
                        "OPENAI_API_KEY": "one",
                        "CODEX_API_KEY": "two",
                        "CODEX_ACCESS_TOKEN": "three",
                    },
                ),
                mock.patch(
                    "preview_tool.generation.codex_argv",
                    return_value=[sys.executable, "-c", script],
                ),
            ):
                completed = _run_codex(plan, "prompt")
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout, "")

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

    def test_codex_run_unwinds_and_kills_process_group_on_cancellation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, _ = self.workspace(Path(temporary))
            plan = plan_generation(root, "sample")
            process = mock.Mock()
            process.pid = 42000
            process.stdout = mock.Mock()
            process.stderr = mock.Mock()
            process.stdin = mock.Mock()
            process.poll.return_value = None
            process.wait.side_effect = [KeyboardInterrupt, subprocess.TimeoutExpired([], 1), 0]
            process.stdout.read.return_value = b""
            process.stderr.read.return_value = b""

            with (
                mock.patch(
                    "preview_tool.generation.codex_argv",
                    return_value=[sys.executable, "-c", "pass"],
                ),
                mock.patch("preview_tool.generation.subprocess.Popen", return_value=process),
                mock.patch("preview_tool.generation.os.killpg") as killpg,
                self.assertRaises(KeyboardInterrupt),
            ):
                _run_codex(plan, "prompt")

            self.assertIn(mock.call(process.pid, signal.SIGTERM), killpg.call_args_list)
            self.assertIn(mock.call(process.pid, signal.SIGKILL), killpg.call_args_list)

    def test_cli_sigterm_unwinds_and_reaps_isolated_codex_process(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root, _ = self.workspace(parent)
            artifacts = parent / "host-state"
            ready = parent / "codex-ready"
            sentinel = parent / "orphan-survived"
            doctor = {
                "checks": {
                    "auth.credentials": {
                        "status": "ok",
                        "details": {
                            "stored auth mode": "chatgpt",
                            "stored ChatGPT tokens": "true",
                        },
                    },
                    "network.provider_reachability": {
                        "status": "ok",
                        "details": {"reachability mode": "ChatGPT auth"},
                    },
                    "network.websocket_reachability": {
                        "status": "ok",
                        "details": {
                            "auth mode": "chatgpt",
                            "endpoint": "wss://chatgpt.com/backend-api/codex/responses",
                            "handshake result": "HTTP 101 Switching Protocols",
                            "model provider": "openai",
                        },
                    },
                }
            }
            fake_codex = parent / "fake-codex"
            fake_codex.write_text(
                "#!/usr/bin/python3\n"
                "import json, os, signal, sys, time\n"
                "from pathlib import Path\n"
                f"doctor = {doctor!r}\n"
                f"ready = Path({str(ready)!r})\n"
                f"sentinel = Path({str(sentinel)!r})\n"
                "args = sys.argv[1:]\n"
                "required = {'forced_login_method=\"chatgpt\"', "
                "'model_provider=\"openai\"', "
                "'openai_base_url=\"https://chatgpt.com/backend-api/codex\"'}\n"
                "if not required.issubset(args): raise SystemExit(91)\n"
                "if {'OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN'} & os.environ.keys(): "
                "raise SystemExit(92)\n"
                "if 'login' in args:\n"
                "    print('Logged in using ChatGPT')\n"
                "elif 'doctor' in args:\n"
                "    print(json.dumps(doctor))\n"
                "    raise SystemExit(1)\n"
                "elif 'exec' in args:\n"
                "    signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
                "    ready.write_text(str(os.getpid()))\n"
                "    time.sleep(20)\n"
                "    sentinel.write_text('survived')\n"
                "else:\n"
                "    raise SystemExit(93)\n",
                encoding="utf-8",
            )
            fake_codex.chmod(0o755)
            launcher = Path(__file__).resolve().parents[1] / "bin/preview"
            outer = subprocess.Popen(
                [
                    str(launcher),
                    "generate",
                    "sample",
                    "--source",
                    str(parent / "sample"),
                    "--artifact-root",
                    str(artifacts),
                    "--codex-executable",
                    str(fake_codex),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=root,
            )
            try:
                deadline = time.monotonic() + 5
                while not ready.exists() and outer.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(ready.exists(), "fake Codex did not start")
                codex_pid = int(ready.read_text(encoding="utf-8"))

                outer.terminate()
                stdout, stderr = outer.communicate(timeout=8)
                deadline = time.monotonic() + 1
                while time.monotonic() < deadline:
                    try:
                        os.kill(codex_pid, 0)
                    except ProcessLookupError:
                        break
                    time.sleep(0.01)
                else:
                    self.fail("isolated Codex process survived Preview CLI cancellation")
            finally:
                if outer.poll() is None:
                    outer.kill()
                    outer.wait()

            self.assertEqual(outer.returncode, 128 + signal.SIGTERM)
            self.assertEqual(stdout, "")
            self.assertIn("preview: operation cancelled", stderr)
            self.assertFalse(sentinel.exists())

    def test_codex_run_kills_descendant_that_closes_pipes_and_ignores_term(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root, _ = self.workspace(parent)
            plan = plan_generation(root, "sample")
            sentinel = parent / "orphan-survived"
            descendant = (
                "import os,signal,time; "
                "signal.signal(signal.SIGTERM,signal.SIG_IGN); "
                "os.close(0); os.close(1); os.close(2); "
                "time.sleep(1); "
                f"open({str(sentinel)!r},'w').write('survived')"
            )
            script = (
                "import subprocess,sys,time; sys.stdin.buffer.read(); "
                f"subprocess.Popen([sys.executable,'-c',{descendant!r}]); "
                "time.sleep(.3)"
            )
            with mock.patch(
                "preview_tool.generation.codex_argv",
                return_value=[sys.executable, "-c", script],
            ):
                completed = _run_codex(plan, "prompt")
            time.sleep(1.1)

            self.assertEqual(completed.returncode, 0)
            self.assertFalse(sentinel.exists())


if __name__ == "__main__":
    unittest.main()
