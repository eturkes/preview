"""Command-line interface."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .discovery import discover, representable, require_project
from .generation import compile_project, dry_run, generate_batch, generate_project
from .paths import (
    ProjectPaths,
    repo_root,
    require_artifact_separation,
    resolve_artifact_root,
)
from .plugin import build_plugin
from .publication import ProjectLock
from .records import MAX_USER_PROMPT_CHARS, normalize_user_prompt
from .server import serve
from .state import Action, apply_action, format_status, read_state
from .validation import Report, escape_controls, validate_bundle

HOST_READ_WARNING = (
    "preview: warning: Codex can read any host-readable path; generate only from a "
    "trusted source checkout"
)


def _artifact_argument(command: argparse.ArgumentParser) -> None:
    command.add_argument(
        "--artifact-root",
        type=Path,
        help="store generated previews and aggregate plugin under this host-owned directory",
    )


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(
        prog="preview",
        description="Generate and review bilingual project dashboard previews.",
    )
    command.add_argument("--version", action="version", version=f"preview {__version__}")
    subcommands = command.add_subparsers(dest="command", required=True)
    subcommands.add_parser("list", help="list discoverable sibling projects")
    subcommands.add_parser("status", help="show local enablement state")
    for action in Action:
        mutation = subcommands.add_parser(action.value, help=f"{action.value} one project")
        mutation.add_argument("name")
    generate = subcommands.add_parser("generate", help="generate one or all enabled previews")
    generate.add_argument("name", nargs="?")
    generate.add_argument(
        "--dry-run",
        action="store_true",
        help="print the exact Codex invocation and prompt without spending tokens",
    )
    generate.add_argument(
        "--source",
        type=Path,
        help="generate the named project from this explicit trusted source checkout",
    )
    _artifact_argument(generate)
    generate.add_argument(
        "--codex-executable",
        type=Path,
        help="use this exact Codex executable (resolved to an absolute path)",
    )
    generate.add_argument(
        "--from-scratch",
        action="store_true",
        help="regenerate without supplying the prior validated Preview as context",
    )
    generate.add_argument(
        "--prompt-stdin",
        action="store_true",
        help="read one bounded Preview-specific prompt from standard input",
    )
    generate.add_argument(
        "--expected-revision",
        help="require one exact clean Git commit before authoring and publication",
    )
    compile_command = subcommands.add_parser(
        "compile",
        help="validate and atomically recompile one published model without Codex",
    )
    compile_command.add_argument("name")
    compile_command.add_argument(
        "--model",
        type=Path,
        help="compile this regular JSON file instead of the published preview.json",
    )
    compile_command.add_argument(
        "--source",
        type=Path,
        help="validate against this explicit trusted source checkout",
    )
    _artifact_argument(compile_command)
    validate = subcommands.add_parser("validate", help="validate one published preview")
    validate.add_argument("name")
    validate.add_argument(
        "--source",
        type=Path,
        help="validate against this explicit trusted source checkout",
    )
    _artifact_argument(validate)
    server = subcommands.add_parser("serve", help="serve one validated preview on loopback")
    server.add_argument("name")
    server.add_argument(
        "--source",
        type=Path,
        help="validate against this explicit trusted source checkout",
    )
    _artifact_argument(server)
    server.add_argument("--port", type=int, default=4173)
    server.add_argument("--open", action="store_true", dest="open_browser")
    plugin_build = subcommands.add_parser(
        "plugin-build",
        help="validate current-source publishes and build one in-progress static plugin",
    )
    plugin_build.add_argument(
        "--source",
        action="append",
        default=[],
        nargs=2,
        metavar=("NAME", "PATH"),
        help="include NAME using an explicit trusted source checkout; repeatable",
    )
    _artifact_argument(plugin_build)
    plugin_build.add_argument(
        "--git-track",
        action="store_true",
        help="commit validated external artifacts to their local-only Git repository",
    )
    return command


def _prompt_from_stdin(enabled: bool) -> str:
    if not enabled:
        return ""
    raw = sys.stdin.buffer.read(MAX_USER_PROMPT_CHARS * 4 + 1)
    if len(raw) > MAX_USER_PROMPT_CHARS * 4:
        raise ValueError("Preview prompt exceeds its byte limit")
    try:
        return normalize_user_prompt(raw.decode("utf-8"))
    except UnicodeDecodeError as error:
        raise ValueError("Preview prompt is not valid UTF-8") from error


def _report_text(report: Report) -> str:
    return report.format()


def _project_paths(
    root: Path,
    name: str,
    source: Path | None = None,
    *,
    artifact_root: Path | None = None,
) -> ProjectPaths:
    if not representable(name):
        raise ValueError(f"invalid project name {name!r}")
    if source is None:
        resolved_source = require_project(root, name)
    else:
        resolved_source = source.resolve(strict=True)
        if not resolved_source.is_dir():
            raise ValueError(f"source is not a directory: {resolved_source}")
    resolved_artifacts = resolve_artifact_root(artifact_root)
    paths = ProjectPaths(
        root=root,
        project=name,
        source_override=resolved_source,
        artifact_root=resolved_artifacts,
    )
    if resolved_artifacts is not None:
        require_artifact_separation(resolved_artifacts, resolved_source)
    return paths


def _validate_paths(paths: ProjectPaths) -> Report:
    if not paths.live.is_dir() or paths.live.is_symlink():
        raise ValueError(f"no published preview for {paths.project!r}")
    return validate_bundle(
        paths.live,
        expected_slug=paths.project,
        source_base=paths.source,
        artifact_home=paths.preview_home,
        template_dir=paths.templates,
    )


def _validate(
    root: Path,
    name: str,
    source: Path | None = None,
    *,
    artifact_root: Path | None = None,
) -> tuple[Report, ProjectPaths]:
    paths = _project_paths(
        root,
        name,
        source,
        artifact_root=artifact_root,
    )
    return _validate_paths(paths), paths


def _plugin_sources(values: list[list[str]]) -> dict[str, Path] | None:
    if not values:
        return None
    sources: dict[str, Path] = {}
    for name, raw_path in values:
        if not representable(name):
            raise ValueError(f"invalid project name {name!r}")
        if name in sources:
            raise ValueError(f"duplicate plugin source {name!r}")
        sources[name] = Path(raw_path)
    return sources


def main(argv: list[str] | None = None, *, root: Path | None = None) -> int:
    args = parser().parse_args(argv)
    actual_root = (root or repo_root()).resolve(strict=True)
    projects = discover(actual_root)
    state_path = actual_root / "enabled.txt"
    try:
        if args.command == "list":
            if projects:
                print("\n".join(projects))
            return 0
        if args.command == "status":
            text = format_status(projects, read_state(state_path))
            if text:
                print(text)
            return 0
        if args.command in {action.value for action in Action}:
            enabled = apply_action(state_path, projects, args.name, Action(args.command))
            print(f"{'enabled' if enabled else 'disabled'} {args.name}")
            return 0
        if args.command == "generate":
            user_prompt = _prompt_from_stdin(args.prompt_stdin)
            if args.name is not None:
                if args.dry_run:
                    print(
                        dry_run(
                            actual_root,
                            args.name,
                            args.source,
                            artifact_root=args.artifact_root,
                            codex_executable=args.codex_executable,
                            from_scratch=args.from_scratch,
                            user_prompt=user_prompt,
                            expected_revision=args.expected_revision,
                        ),
                        end="",
                    )
                    return 0
                print(HOST_READ_WARNING, file=sys.stderr)
                outcome = generate_project(
                    actual_root,
                    args.name,
                    args.source,
                    artifact_root=args.artifact_root,
                    codex_executable=args.codex_executable,
                    from_scratch=args.from_scratch,
                    user_prompt=user_prompt,
                    expected_revision=args.expected_revision,
                )
                stream = sys.stdout if outcome.ok else sys.stderr
                print(outcome.message, file=stream)
                return int(not outcome.ok)
            if args.source is not None:
                raise ValueError("--source requires a named project")
            if args.expected_revision is not None:
                raise ValueError("--expected-revision requires a named project")
            enabled = read_state(state_path)
            targets = sorted(enabled)
            if args.dry_run:
                if not targets:
                    print("summary: 0 plans")
                    return 0
                failures = 0
                for index, name in enumerate(targets):
                    if index:
                        print("\n---\n")
                    if name not in projects:
                        print(f"[FAILED] {name}: enabled project is missing")
                        failures += 1
                    else:
                        print(
                            dry_run(
                                actual_root,
                                name,
                                artifact_root=args.artifact_root,
                                codex_executable=args.codex_executable,
                                from_scratch=args.from_scratch,
                                user_prompt=user_prompt,
                            ),
                            end="",
                        )
                print(f"summary: {len(targets) - failures} plans, {failures} failed")
                return int(failures > 0)
            current = [name for name in targets if name in projects]
            missing = [name for name in targets if name not in projects]
            if current:
                print(HOST_READ_WARNING, file=sys.stderr)
            text, code = generate_batch(
                actual_root,
                current,
                artifact_root=args.artifact_root,
                codex_executable=args.codex_executable,
                from_scratch=args.from_scratch,
                user_prompt=user_prompt,
            )
            if missing:
                prefix = "".join(
                    f"[FAILED] {name}\nenabled project is missing\n" for name in missing
                )
                text = prefix + text
                code = 1
            print(text, end="")
            return code
        if args.command == "compile":
            outcome = compile_project(
                actual_root,
                args.name,
                args.model,
                args.source,
                artifact_root=args.artifact_root,
            )
            stream = sys.stdout if outcome.ok else sys.stderr
            print(outcome.message, file=stream)
            return int(not outcome.ok)
        if args.command == "validate":
            paths = _project_paths(
                actual_root,
                args.name,
                args.source,
                artifact_root=args.artifact_root,
            )
            with ProjectLock(paths.lock):
                report = _validate_paths(paths)
                text = _report_text(report)
                if text:
                    print(text)
                if report.ok:
                    print(f"valid previews/{args.name}")
                return int(not report.ok)
        if args.command == "serve":
            paths = _project_paths(
                actual_root,
                args.name,
                args.source,
                artifact_root=args.artifact_root,
            )
            with ProjectLock(paths.lock):
                report = _validate_paths(paths)
                if not report.ok:
                    print(_report_text(report), file=sys.stderr)
                    return 1
                serve(paths.live, args.port, open_browser=args.open_browser)
            return 0
        if args.command == "plugin-build":
            result = build_plugin(
                actual_root,
                _plugin_sources(args.source),
                artifact_root=args.artifact_root,
                git_track=args.git_track,
            )
            count = len(result.projects)
            noun = "dashboard" if count == 1 else "dashboards"
            try:
                location = result.output.relative_to(actual_root)
            except ValueError:
                location = result.output
            print(f"built {location} with {count} {noun}")
            if result.skipped:
                names = ", ".join(result.skipped)
                print(
                    f"preview: skipped published previews without a current source: {names}",
                    file=sys.stderr,
                )
            return 0
    except (OSError, RuntimeError, ValueError) as error:
        print(f"preview: {escape_controls(error)}", file=sys.stderr)
        return 1
    return 0
