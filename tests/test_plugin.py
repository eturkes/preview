from __future__ import annotations

import contextlib
import io
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from test_contract import valid_data

from preview_tool.cli import main
from preview_tool.plugin import (
    PLUGIN_FILES,
    PLUGIN_MANIFEST,
    PLUGIN_PLACEHOLDERS,
    PluginBuildError,
    build_plugin,
)
from preview_tool.publication import ProjectBusyError, ProjectLock
from preview_tool.records import GenerationRecord, write_record
from preview_tool.render import compiled_files
from preview_tool.schema import canonical_json
from preview_tool.validation import validate_bundle


class PluginBuildTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.parent = Path(self.temporary.name)
        self.root = self.parent / "preview"
        self.root.mkdir()
        source_templates = Path(__file__).resolve().parents[1] / "templates"
        shutil.copytree(source_templates, self.root / "templates")
        (self.root / "previews").mkdir()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def publish(
        self,
        project: str,
        data: dict[str, object] | None = None,
        artifact_root: Path | None = None,
    ) -> tuple[Path, Path]:
        source = self.parent / project
        source.mkdir()
        (source / "source.txt").write_text(
            "Status evidence\nOverview evidence\nDemo evidence\nState evidence\n",
            encoding="utf-8",
        )
        model = data or valid_data(project)
        preview_home = (artifact_root or self.root) / "previews"
        live = preview_home / project
        live.mkdir(parents=True)
        (live / "preview.json").write_bytes(canonical_json(model))
        for name, content in compiled_files(model, self.root / "templates").items():
            (live / name).write_bytes(content)
        return source, live

    def output_bytes(self, output: Path | None = None) -> dict[str, bytes]:
        output = output or self.root / "dist" / "in-progress-plugin"
        return {
            entry.relative_to(output).as_posix(): entry.read_bytes()
            for entry in sorted(output.rglob("*"))
            if entry.is_file()
        }

    def test_builds_deterministic_self_contained_project_switching_plugin(self) -> None:
        sources = {"alpha": self.publish("alpha"), "in-progress": self.publish("in-progress")}
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = main(["plugin-build"], root=self.root)
        self.assertEqual(code, 0)
        self.assertEqual(
            stdout.getvalue(),
            "built dist/in-progress-plugin with 2 dashboards\n",
        )

        first = self.output_bytes()
        result = build_plugin(self.root)
        second = self.output_bytes()
        self.assertEqual(result.projects, ("alpha", "in-progress"))
        self.assertEqual(result.skipped, ())
        self.assertEqual(first, second)
        self.assertEqual(set(first), PLUGIN_FILES)
        self.assertEqual(json.loads(first["in-progress.plugin.json"]), PLUGIN_MANIFEST)
        self.assertEqual(
            json.loads(first["preview-index.json"]),
            {
                "generations": [],
                "projects": ["alpha", "in-progress"],
                "schemaVersion": 1,
            },
        )

        index = first["index.html"].decode("utf-8")
        self.assertNotIn("{{", index)
        self.assertNotIn('<script src=', index)
        self.assertNotIn('<link rel="stylesheet"', index)
        self.assertIn('message.type !== "in-progress:init"', index)
        self.assertIn('message.context.apiVersion !== apiVersion', index)
        self.assertIn('kind: "ready", nonce: message.nonce', index)
        self.assertIn("Object.prototype.hasOwnProperty.call(dashboards, projectId)", index)
        self.assertIn("No published dashboard matches the selected project.", index)
        self.assertIn("\\u003cdiv class=", index)
        self.assertIn("/* Canonical preview runtime.", index)
        self.assertIn("@media (prefers-color-scheme: dark)", index)
        self.assertIn(":root:not([data-preview-theme-mode])", index)
        self.assertIn(':root[data-preview-theme-mode="dark"]', index)
        self.assertIn(':root[data-preview-theme-mode="light"]', index)
        marker = 'id="preview-plugin-data" type="application/json">'
        embedded = json.loads(index.split(marker, 1)[1].split("</script>", 1)[0])
        self.assertEqual(tuple(embedded), ("alpha", "in-progress"))
        self.assertEqual(embedded["in-progress"]["title"], "日-sample / EN-sample")
        for dashboard in embedded.values():
            self.assertNotIn('href="provenance.json"', dashboard["body"])
            self.assertNotIn('href="gaps.md"', dashboard["body"])
            self.assertNotIn('<a href="', dashboard["body"])
            self.assertIn('<a class="skip-link"', dashboard["body"])
            self.assertIn("data-tour-layer", dashboard["body"])
            self.assertIn('id="preview-tour"', dashboard["body"])
            self.assertIn("data-preview-announcer", dashboard["body"])
            self.assertIn("data-evidence-detail=", dashboard["body"])
            self.assertIn("data-gap-ledger", dashboard["body"])
            tour = json.loads(
                dashboard["body"].split('id="preview-tour" type="application/json">', 1)[1]
                .split("</script>", 1)[0]
            )
            self.assertGreater(len(tour["steps"]), 0)

        for project, (source, live) in sources.items():
            report = validate_bundle(
                live,
                expected_slug=project,
                source_base=source,
                artifact_home=self.root / "previews",
                template_dir=self.root / "templates",
            )
            self.assertTrue(report.ok, report.format())

    def test_dashboard_placeholder_text_is_not_reprocessed(self) -> None:
        markers = " ".join("{{" + name + "}}" for name in sorted(PLUGIN_PLACEHOLDERS))
        data = valid_data("markers")
        data["dashboard"]["project"]["summary"] = {  # type: ignore[index]
            "ja": "日 " + markers,
            "en": "EN " + markers,
        }
        self.publish("markers", data)

        result = build_plugin(self.root)
        index = (result.output / "index.html").read_text(encoding="utf-8")
        marker = 'id="preview-plugin-data" type="application/json">'
        embedded = json.loads(index.split(marker, 1)[1].split("</script>", 1)[0])
        body = embedded["markers"]["body"]
        for name in PLUGIN_PLACEHOLDERS:
            self.assertIn("{{" + name + "}}", body)

    def test_invalid_bundle_preserves_prior_plugin(self) -> None:
        _, live = self.publish("alpha")
        build_plugin(self.root)
        before = self.output_bytes()
        (live / "styles.css").write_text("tampered\n", encoding="utf-8")

        with self.assertRaisesRegex(PluginBuildError, "invalid previews/alpha"):
            build_plugin(self.root)
        self.assertEqual(self.output_bytes(), before)

    def test_invalid_bundle_recovers_interrupted_prior_plugin(self) -> None:
        _, live = self.publish("alpha")
        result = build_plugin(self.root)
        before = self.output_bytes()
        backup = self.root / "dist" / ".in-progress-plugin.previous"
        result.output.replace(backup)
        (live / "styles.css").write_text("tampered\n", encoding="utf-8")

        with self.assertRaisesRegex(PluginBuildError, "invalid previews/alpha"):
            build_plugin(self.root)
        self.assertEqual(self.output_bytes(), before)
        self.assertFalse(backup.exists())

    def test_concurrent_publish_gap_preserves_prior_plugin(self) -> None:
        _, live = self.publish("alpha")
        build_plugin(self.root)
        before = self.output_bytes()
        lock = self.root / "previews" / ".locks" / "alpha.lock"
        backup = self.root / "previews" / ".previous" / "alpha"
        backup.parent.mkdir(parents=True)

        with ProjectLock(lock):
            live.replace(backup)
            try:
                with self.assertRaises(ProjectBusyError):
                    build_plugin(self.root)
                self.assertEqual(self.output_bytes(), before)
            finally:
                backup.replace(live)

    def test_empty_publish_set_builds_clear_unavailable_plugin(self) -> None:
        result = build_plugin(self.root)
        self.assertEqual(result.projects, ())
        self.assertEqual(result.skipped, ())
        index = (result.output / "index.html").read_text(encoding="utf-8")
        self.assertIn("No preview available", index)
        self.assertIn('id="preview-plugin-data" type="application/json">{}</script>', index)

    def test_stale_publish_is_reported_and_excluded(self) -> None:
        _, live = self.publish("stale")
        shutil.rmtree(self.parent / "stale")
        result = build_plugin(self.root)
        self.assertEqual(result.projects, ())
        self.assertEqual(result.skipped, ("stale",))
        self.assertTrue(live.is_dir())
        data = json.loads(
            (result.output / "in-progress.plugin.json").read_text(encoding="utf-8")
        )
        self.assertEqual(data, PLUGIN_MANIFEST)

    def test_plugin_build_accepts_explicit_non_sibling_sources(self) -> None:
        source, _ = self.publish("nested")
        source_home = self.parent / "nested-layout"
        source_home.mkdir()
        mapped_source = source_home / "repository"
        source.rename(mapped_source)

        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = main(
                ["plugin-build", "--source", "nested", str(mapped_source)],
                root=self.root,
            )

        self.assertEqual(code, 0)
        self.assertEqual(stdout.getvalue(), "built dist/in-progress-plugin with 1 dashboard\n")
        index = self.output_bytes()["index.html"].decode("utf-8")
        marker = 'id="preview-plugin-data" type="application/json">'
        embedded = json.loads(index.split(marker, 1)[1].split("</script>", 1)[0])
        self.assertEqual(tuple(embedded), ("nested",))

    def test_external_artifact_root_owns_plugin_input_output_and_index(self) -> None:
        artifacts = self.parent / "host-state"
        source, _ = self.publish("alpha", artifact_root=artifacts)

        result = build_plugin(
            self.root,
            {"alpha": source},
            artifact_root=artifacts,
        )

        self.assertEqual(result.output, artifacts / "in-progress-plugin")
        self.assertFalse((self.root / "dist/in-progress-plugin").exists())
        files = self.output_bytes(result.output)
        self.assertEqual(set(files), PLUGIN_FILES)
        self.assertEqual(
            files["preview-index.json"],
            canonical_json(
                {"schemaVersion": 1, "projects": ["alpha"], "generations": []}
            ),
        )

        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = main(
                [
                    "plugin-build",
                    "--artifact-root",
                    str(artifacts),
                    "--source",
                    "alpha",
                    str(source),
                ],
                root=self.root,
            )
        self.assertEqual(code, 0)
        self.assertEqual(
            stdout.getvalue(),
            f"built {artifacts / 'in-progress-plugin'} with 1 dashboard\n",
        )

    def test_generation_record_is_atomically_packaged_with_the_dashboard(self) -> None:
        artifacts = self.parent / "host-state"
        source, _ = self.publish("alpha", artifact_root=artifacts)
        record_path = artifacts / "previews/.records/alpha.json"
        write_record(
            record_path,
            GenerationRecord(
                schemaVersion=1,
                project="alpha",
                sourceRevision="a" * 40,
                sourceDirty=False,
                strategy="update",
                basedOnSourceRevision="9" * 40,
                prompt="Prioritize release readiness.",
            ),
        )
        result = build_plugin(
            self.root,
            {"alpha": source},
            artifact_root=artifacts,
        )
        packaged = result.output / "preview-index.json"
        before = packaged.read_bytes()
        self.assertEqual(json.loads(before)["generations"][0]["sourceRevision"], "a" * 40)

        record_path.write_text("{}\n", encoding="utf-8")
        with self.assertRaisesRegex(PluginBuildError, "invalid generation record"):
            build_plugin(
                self.root,
                {"alpha": source},
                artifact_root=artifacts,
            )
        self.assertEqual(packaged.read_bytes(), before)

    def test_external_artifacts_receive_local_only_git_snapshots(self) -> None:
        artifacts = self.parent / "host-state"
        source, _ = self.publish("alpha", artifact_root=artifacts)

        first = build_plugin(
            self.root,
            {"alpha": source},
            artifact_root=artifacts,
            git_track=True,
        )
        first_revision = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=artifacts,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        second = build_plugin(
            self.root,
            {"alpha": source},
            artifact_root=artifacts,
            git_track=True,
        )
        second_revision = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=artifacts,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()

        self.assertEqual(first.output, second.output)
        self.assertEqual(first_revision, second_revision)
        self.assertTrue((artifacts / ".git").is_dir())
        self.assertEqual(
            subprocess.run(
                ["git", "remote"],
                cwd=artifacts,
                check=True,
                capture_output=True,
                text=True,
            ).stdout,
            "",
        )
        self.assertEqual(
            subprocess.run(
                ["git", "status", "--short"],
                cwd=artifacts,
                check=True,
                capture_output=True,
                text=True,
            ).stdout,
            "",
        )
        self.assertIn(
            "/previews/.partial/",
            (artifacts / ".gitignore").read_text(encoding="utf-8"),
        )
        self.assertIn(
            "/previews/.records/.*",
            (artifacts / ".gitignore").read_text(encoding="utf-8"),
        )

        subprocess.run(
            ["git", "remote", "add", "origin", "https://example.invalid/preview.git"],
            cwd=artifacts,
            check=True,
        )
        before = self.output_bytes(first.output)
        with self.assertRaisesRegex(RuntimeError, "must not configure a remote"):
            build_plugin(
                self.root,
                {"alpha": source},
                artifact_root=artifacts,
                git_track=True,
            )
        self.assertEqual(self.output_bytes(first.output), before)

    def test_artifact_snapshot_rejects_a_non_main_branch_before_publication(self) -> None:
        artifacts = self.parent / "host-state"
        source, _ = self.publish("alpha", artifact_root=artifacts)
        result = build_plugin(
            self.root,
            {"alpha": source},
            artifact_root=artifacts,
            git_track=True,
        )
        before = self.output_bytes(result.output)
        subprocess.run(["git", "branch", "-m", "other"], cwd=artifacts, check=True)

        with self.assertRaisesRegex(RuntimeError, "branch main"):
            build_plugin(
                self.root,
                {"alpha": source},
                artifact_root=artifacts,
                git_track=True,
            )
        self.assertEqual(self.output_bytes(result.output), before)

    def test_overlapping_artifact_root_is_rejected_before_plugin_state_write(self) -> None:
        source, _ = self.publish("alpha")
        artifacts = source / ".generated"

        with self.assertRaisesRegex(PluginBuildError, "artifact root must be outside the source"):
            build_plugin(
                self.root,
                {"alpha": source},
                artifact_root=artifacts,
            )

        self.assertFalse(artifacts.exists())

    def test_atomic_publication_support_is_required_before_plugin_state_write(self) -> None:
        source, _ = self.publish("alpha")
        with (
            mock.patch(
                "preview_tool.plugin.require_atomic_exchange_support",
                side_effect=RuntimeError("unsupported output filesystem"),
            ),
            self.assertRaisesRegex(RuntimeError, "unsupported output filesystem"),
        ):
            build_plugin(self.root, {"alpha": source})

        self.assertFalse((self.root / "dist/in-progress-plugin").exists())

    def test_artifact_root_containing_source_is_rejected_before_plugin_state_write(self) -> None:
        source, _ = self.publish("alpha")

        with self.assertRaisesRegex(PluginBuildError, "artifact root must be outside the source"):
            build_plugin(
                self.root,
                {"alpha": source},
                artifact_root=self.parent,
            )

        self.assertFalse((self.parent / "in-progress-plugin").exists())

    def test_named_dry_run_accepts_explicit_non_sibling_source(self) -> None:
        source, _ = self.publish("nested")
        source_home = self.parent / "nested-layout"
        source_home.mkdir()
        mapped_source = source_home / "repository"
        source.rename(mapped_source)

        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = main(
                ["generate", "nested", "--source", str(mapped_source), "--dry-run"],
                root=self.root,
            )

        self.assertEqual(code, 0)
        self.assertIn(f"source:    {mapped_source}\n", stdout.getvalue())

    def test_validate_accepts_explicit_non_sibling_source(self) -> None:
        source, _ = self.publish("nested")
        source_home = self.parent / "nested-layout"
        source_home.mkdir()
        mapped_source = source_home / "repository"
        source.rename(mapped_source)

        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = main(
                ["validate", "nested", "--source", str(mapped_source)],
                root=self.root,
            )

        self.assertEqual(code, 0)
        self.assertEqual(stdout.getvalue(), "valid previews/nested\n")


if __name__ == "__main__":
    unittest.main()
