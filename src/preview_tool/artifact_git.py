"""Local-only Git history for host-owned Preview artifacts."""

from __future__ import annotations

import os
import stat
import subprocess
import tempfile
from pathlib import Path

GITIGNORE = """/previews/.locks/
/previews/.partial/
/previews/.previous/
/previews/.records/.*
/previews/.preview-exchange-probe-*/
/.preview-exchange-probe-*/
/.gitignore.*
/.in-progress-plugin.partial/
/.in-progress-plugin.previous/
"""
GIT_TIMEOUT_SECONDS = 30


def _environment() -> dict[str, str]:
    return {
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_NO_REPLACE_OBJECTS": "1",
        "GIT_OPTIONAL_LOCKS": "0",
        "GIT_PAGER": "cat",
        "GIT_TERMINAL_PROMPT": "0",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PAGER": "cat",
        "PATH": "/usr/bin:/bin",
    }


def _git(
    root: Path,
    arguments: list[str],
    *,
    allowed: frozenset[int] = frozenset({0}),
) -> str:
    completed = subprocess.run(
        [
            "git",
            "-c",
            "core.autocrlf=false",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgSign=false",
            *arguments,
        ],
        cwd=root,
        env=_environment(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=GIT_TIMEOUT_SECONDS,
        check=False,
    )
    if completed.returncode not in allowed:
        detail = (completed.stderr or completed.stdout).strip()[-2_000:]
        raise RuntimeError(f"artifact Git command failed: {detail}")
    return completed.stdout.strip()


def _ensure_gitignore(root: Path) -> None:
    path = root / ".gitignore"
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        metadata = None
    if metadata is not None and (
        not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode)
    ):
        raise RuntimeError(f"artifact .gitignore is not a regular file: {path}")
    if metadata is not None and path.read_text(encoding="utf-8") == GITIGNORE:
        return
    descriptor, temporary_name = tempfile.mkstemp(prefix=".gitignore.", dir=root)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(GITIGNORE)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def prepare_artifact_git(root: Path) -> Path:
    """Initialize and validate the exact local-only artifact repository."""
    resolved = root.resolve(strict=True)
    metadata = resolved.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise RuntimeError(f"artifact root is not a real directory: {resolved}")
    git_directory = resolved / ".git"
    try:
        git_metadata = git_directory.lstat()
    except FileNotFoundError:
        git_metadata = None
    if git_metadata is None:
        _git(resolved, ["init", "--initial-branch=main"])
    elif not stat.S_ISDIR(git_metadata.st_mode) or stat.S_ISLNK(git_metadata.st_mode):
        raise RuntimeError(f"artifact Git metadata is not a real directory: {git_directory}")

    repository_root = Path(_git(resolved, ["rev-parse", "--show-toplevel"])).resolve()
    if repository_root != resolved:
        raise RuntimeError(f"artifact Git root does not match artifact root: {repository_root}")
    if _git(resolved, ["symbolic-ref", "--quiet", "--short", "HEAD"]) != "main":
        raise RuntimeError("artifact Git repository must remain on branch main")
    if _git(resolved, ["remote"]):
        raise RuntimeError("artifact Git repository must not configure a remote")

    staged = _git(resolved, ["diff", "--cached", "--name-only", "-z"])
    if any(
        path != ".gitignore"
        and not path.startswith("previews/")
        and not path.startswith("in-progress-plugin/")
        for path in staged.split("\0")
        if path
    ):
        raise RuntimeError("artifact Git index contains changes outside Preview-owned paths")

    _ensure_gitignore(resolved)
    return resolved


def snapshot_artifacts(root: Path) -> str | None:
    """Stage bounded artifact paths and commit changed validated bytes."""
    resolved = prepare_artifact_git(root)
    paths = [".gitignore", "previews", "in-progress-plugin"]
    _git(resolved, ["add", "--all", "--", *paths])
    _git(resolved, ["diff", "--cached", "--check", "--no-ext-diff"])
    status = subprocess.run(
        [
            "git",
            "-c",
            "core.autocrlf=false",
            "diff",
            "--cached",
            "--quiet",
            "--no-ext-diff",
        ],
        cwd=resolved,
        env=_environment(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        timeout=GIT_TIMEOUT_SECONDS,
        check=False,
    )
    if status.returncode == 0:
        _git(resolved, ["rev-parse", "HEAD"])
        _verify_snapshot(resolved)
        return None
    if status.returncode != 1:
        detail = status.stderr.decode("utf-8", errors="replace").strip()[-2_000:]
        raise RuntimeError(f"artifact Git status failed: {detail}")
    _git(
        resolved,
        [
            "-c",
            "user.name=Preview",
            "-c",
            "user.email=preview@localhost",
            "commit",
            "-m",
            "preview: validated artifacts → local snapshot",
        ],
    )
    revision = _git(resolved, ["rev-parse", "HEAD"])
    _verify_snapshot(resolved)
    return revision


def _verify_snapshot(root: Path) -> None:
    if _git(root, ["remote"]):
        raise RuntimeError("artifact Git repository gained a remote during snapshot")
    dirty = _git(
        root,
        [
            "status",
            "--porcelain=v1",
            "--untracked-files=normal",
            "--",
            ".gitignore",
            "previews",
            "in-progress-plugin",
        ],
    )
    if dirty:
        raise RuntimeError("artifact files changed during the local Git snapshot")


__all__ = ["GITIGNORE", "prepare_artifact_git", "snapshot_artifacts"]
