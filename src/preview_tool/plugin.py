"""Deterministic in-progress plugin packaging for validated published previews."""

from __future__ import annotations

import json
import stat
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import __version__
from .discovery import discover, representable, require_project
from .paths import ProjectPaths
from .publication import ProjectLock, prepare_stage, publish
from .schema import MAX_JSON_BYTES, canonical_json, loads_strict
from .validation import read_bounded_regular, validate_bundle

PLUGIN_DIRECTORY = "in-progress-plugin"
PLUGIN_FILES = frozenset({"in-progress.plugin.json", "index.html"})
PLUGIN_MANIFEST = {
    "apiVersion": "1.0",
    "id": "preview",
    "name": "Preview",
    "version": __version__,
    "description": "Evidence-backed bilingual project dashboards",
    "entry": "index.html",
    "assets": [],
    "icon": "sparkles",
    "capabilities": [],
}
PLUGIN_PLACEHOLDERS = (
    "DASHBOARD_DATA",
    "INLINE_STYLES",
    "PREVIEW_RUNTIME",
    "PLUGIN_RUNTIME",
)


class PluginBuildError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class PluginBuildResult:
    output: Path
    projects: tuple[str, ...]
    skipped: tuple[str, ...]


def _published_projects(root: Path) -> tuple[tuple[str, ...], tuple[str, ...]]:
    preview_home = root / "previews"
    try:
        entries = sorted(preview_home.iterdir(), key=lambda entry: entry.name)
    except FileNotFoundError:
        return (), ()
    published: list[str] = []
    for entry in entries:
        if entry.name.startswith("."):
            continue
        if not representable(entry.name):
            raise PluginBuildError(f"published preview has an invalid project name: {entry.name!r}")
        metadata = entry.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
            raise PluginBuildError(f"published preview is not a real directory: {entry.name!r}")
        published.append(entry.name)
    current = set(discover(root))
    projects = tuple(project for project in published if project in current)
    skipped = tuple(project for project in published if project not in current)
    return projects, skipped


def _body(index: str, project: str) -> str:
    opening = "<body>"
    closing = "</body>"
    if index.count(opening) != 1 or index.count(closing) != 1:
        raise PluginBuildError(f"previews/{project}/index.html has an unsupported body shape")
    before, remainder = index.split(opening, 1)
    body, after = remainder.split(closing, 1)
    if not before.lower().startswith("<!doctype html>") or after.strip().lower() != "</html>":
        raise PluginBuildError(f"previews/{project}/index.html is not one complete HTML document")
    return body


def _document_title(project: dict[str, Any]) -> str:
    names = project["name"]
    return names["ja"] if names["ja"] == names["en"] else f"{names['ja']} / {names['en']}"


def _script_json(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return (
        encoded.replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def _inline_safe(value: str, closing_tag: str, source: str) -> str:
    if closing_tag.casefold() in value.casefold():
        raise PluginBuildError(f"{source} contains unsafe inline terminator {closing_tag}")
    return value


def _render_entry(root: Path, dashboards: dict[str, dict[str, str]]) -> bytes:
    templates = root / "templates"
    shell = (templates / "plugin.html").read_text(encoding="utf-8")
    for name in PLUGIN_PLACEHOLDERS:
        marker = "{{" + name + "}}"
        if shell.count(marker) != 1:
            raise PluginBuildError(f"plugin template marker {marker} must occur exactly once")

    styles = "\n".join(
        (
            (templates / "styles.css").read_text(encoding="utf-8").rstrip(),
            (templates / "theme.css").read_text(encoding="utf-8").rstrip(),
        )
    )
    preview_runtime = (templates / "app.js").read_text(encoding="utf-8").rstrip()
    plugin_runtime = (templates / "plugin-runtime.js").read_text(encoding="utf-8").rstrip()
    replacements = {
        "DASHBOARD_DATA": _script_json(dashboards),
        "INLINE_STYLES": _inline_safe(styles, "</style", "trusted styles"),
        "PREVIEW_RUNTIME": _inline_safe(preview_runtime, "</script", "preview runtime"),
        "PLUGIN_RUNTIME": _inline_safe(plugin_runtime, "</script", "plugin runtime"),
    }
    for name, value in replacements.items():
        shell = shell.replace("{{" + name + "}}", value)
    return shell.encode("utf-8")


def _validated_dashboards(root: Path, projects: tuple[str, ...]) -> dict[str, dict[str, str]]:
    dashboards: dict[str, dict[str, str]] = {}
    for project in projects:
        source = require_project(root, project)
        paths = ProjectPaths(root=root, project=project)
        report = validate_bundle(
            paths.live,
            expected_slug=project,
            source_base=source,
            artifact_home=paths.preview_home,
            template_dir=paths.templates,
        )
        if not report.ok:
            raise PluginBuildError(f"invalid previews/{project}: {report.format()}")
        raw = read_bounded_regular(paths.live / "preview.json", MAX_JSON_BYTES)
        data = loads_strict(raw)
        if not isinstance(data, dict):
            raise AssertionError("validated preview model lost its object shape")
        dashboard = data["dashboard"]
        if not isinstance(dashboard, dict) or not isinstance(dashboard.get("project"), dict):
            raise AssertionError("validated preview dashboard lost its object shape")
        metadata = dashboard["project"]
        index = (paths.live / "index.html").read_text(encoding="utf-8")
        dashboards[project] = {
            "body": _body(index, project),
            "className": f"theme-{metadata['theme']} font-{metadata['font']}",
            "title": _document_title(metadata),
        }
    return dashboards


def build_plugin(root: Path) -> PluginBuildResult:
    """Validate current-source publishes and atomically emit one aggregate static plugin."""
    resolved_root = root.resolve(strict=True)
    lock = resolved_root / "previews" / ".locks" / ".plugin-build.lock"
    with ProjectLock(lock):
        projects, skipped = _published_projects(resolved_root)
        with ExitStack() as project_locks:
            for project in projects:
                paths = ProjectPaths(root=resolved_root, project=project)
                project_locks.enter_context(ProjectLock(paths.lock))
            dashboards = _validated_dashboards(resolved_root, projects)
            files = {
                "in-progress.plugin.json": canonical_json(PLUGIN_MANIFEST),
                "index.html": _render_entry(resolved_root, dashboards),
            }

        output_home = resolved_root / "dist"
        output = output_home / PLUGIN_DIRECTORY
        stage = output_home / f".{PLUGIN_DIRECTORY}.partial"
        backup = output_home / f".{PLUGIN_DIRECTORY}.previous"
        prepare_stage(stage, backup, output)
        for name in sorted(PLUGIN_FILES):
            (stage / name).write_bytes(files[name])
        publish(stage, backup, output)
    return PluginBuildResult(output=output, projects=projects, skipped=skipped)


__all__ = [
    "PLUGIN_DIRECTORY",
    "PLUGIN_FILES",
    "PLUGIN_MANIFEST",
    "PluginBuildError",
    "PluginBuildResult",
    "build_plugin",
]
