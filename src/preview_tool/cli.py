"""Command-line interface."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .discovery import discover, representable, require_project
from .generation import dry_run, generate_batch, generate_project
from .paths import ProjectPaths, repo_root
from .publication import ProjectLock
from .server import serve
from .state import Action, apply_action, format_status, read_state
from .validation import Report, escape_controls, validate_bundle

HOST_READ_WARNING = (
    "preview: warning: Codex can read any host-readable path; generate only from a "
    "trusted source checkout"
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
    validate = subcommands.add_parser("validate", help="validate one published preview")
    validate.add_argument("name")
    server = subcommands.add_parser("serve", help="serve one validated preview on loopback")
    server.add_argument("name")
    server.add_argument("--port", type=int, default=4173)
    server.add_argument("--open", action="store_true", dest="open_browser")
    return command


def _report_text(report: Report) -> str:
    return report.format()


def _validate(root: Path, name: str) -> tuple[Report, ProjectPaths]:
    if not representable(name):
        raise ValueError(f"invalid project name {name!r}")
    source = require_project(root, name)
    paths = ProjectPaths(root=root, project=name)
    if not paths.live.is_dir() or paths.live.is_symlink():
        raise ValueError(f"no published preview for {name!r}")
    report = validate_bundle(
        paths.live,
        expected_slug=name,
        source_base=source,
        artifact_home=paths.preview_home,
        template_dir=paths.templates,
    )
    return report, paths


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
            if args.name is not None:
                require_project(actual_root, args.name)
                if args.dry_run:
                    print(dry_run(actual_root, args.name), end="")
                    return 0
                print(HOST_READ_WARNING, file=sys.stderr)
                outcome = generate_project(actual_root, args.name)
                stream = sys.stdout if outcome.ok else sys.stderr
                print(outcome.message, file=stream)
                return int(not outcome.ok)
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
                        print(dry_run(actual_root, name), end="")
                print(f"summary: {len(targets) - failures} plans, {failures} failed")
                return int(failures > 0)
            current = [name for name in targets if name in projects]
            missing = [name for name in targets if name not in projects]
            if current:
                print(HOST_READ_WARNING, file=sys.stderr)
            text, code = generate_batch(actual_root, current)
            if missing:
                prefix = "".join(
                    f"[FAILED] {name}\nenabled project is missing\n" for name in missing
                )
                text = prefix + text
                code = 1
            print(text, end="")
            return code
        if args.command == "validate":
            if not representable(args.name):
                raise ValueError(f"invalid project name {args.name!r}")
            paths = ProjectPaths(root=actual_root, project=args.name)
            with ProjectLock(paths.lock):
                report, _ = _validate(actual_root, args.name)
                text = _report_text(report)
                if text:
                    print(text)
                if report.ok:
                    print(f"valid previews/{args.name}")
                return int(not report.ok)
        if args.command == "serve":
            if not representable(args.name):
                raise ValueError(f"invalid project name {args.name!r}")
            paths = ProjectPaths(root=actual_root, project=args.name)
            with ProjectLock(paths.lock):
                report, paths = _validate(actual_root, args.name)
                if not report.ok:
                    print(_report_text(report), file=sys.stderr)
                    return 1
                serve(paths.live, args.port, open_browser=args.open_browser)
            return 0
    except (OSError, RuntimeError, ValueError) as error:
        print(f"preview: {escape_controls(error)}", file=sys.stderr)
        return 1
    return 0
