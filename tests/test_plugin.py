from __future__ import annotations

import contextlib
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from test_contract import valid_data

from preview_tool.cli import main
from preview_tool.plugin import PLUGIN_FILES, PLUGIN_MANIFEST, PluginBuildError, build_plugin
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

    def publish(self, project: str) -> tuple[Path, Path]:
        source = self.parent / project
        source.mkdir()
        (source / "source.txt").write_text(
            "Status evidence\nOverview evidence\nDemo evidence\nState evidence\n",
            encoding="utf-8",
        )
        data = valid_data(project)
        live = self.root / "previews" / project
        live.mkdir()
        (live / "preview.json").write_bytes(canonical_json(data))
        for name, content in compiled_files(data, self.root / "templates").items():
            (live / name).write_bytes(content)
        return source, live

    def output_bytes(self) -> dict[str, bytes]:
        output = self.root / "dist" / "in-progress-plugin"
        return {entry.name: entry.read_bytes() for entry in sorted(output.iterdir())}

    def test_builds_deterministic_self_contained_project_switching_plugin(self) -> None:
        sources = {"alpha": self.publish("alpha"), "beta": self.publish("beta")}
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
        self.assertEqual(result.projects, ("alpha", "beta"))
        self.assertEqual(result.skipped, ())
        self.assertEqual(first, second)
        self.assertEqual(set(first), PLUGIN_FILES)
        self.assertEqual(json.loads(first["in-progress.plugin.json"]), PLUGIN_MANIFEST)

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

        for project, (source, live) in sources.items():
            report = validate_bundle(
                live,
                expected_slug=project,
                source_base=source,
                artifact_home=self.root / "previews",
                template_dir=self.root / "templates",
            )
            self.assertTrue(report.ok, report.format())

    def test_invalid_bundle_preserves_prior_plugin(self) -> None:
        _, live = self.publish("alpha")
        build_plugin(self.root)
        before = self.output_bytes()
        (live / "styles.css").write_text("tampered\n", encoding="utf-8")

        with self.assertRaisesRegex(PluginBuildError, "invalid previews/alpha"):
            build_plugin(self.root)
        self.assertEqual(self.output_bytes(), before)

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


if __name__ == "__main__":
    unittest.main()
