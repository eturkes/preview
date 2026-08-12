"""Repository-root and project path derivation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


def repo_root() -> Path:
    """Return this checkout's resolved root, independent of the caller's cwd."""
    return Path(__file__).resolve().parents[2]


def resolve_artifact_root(value: Path | None) -> Path | None:
    """Resolve an optional host-owned artifact root without requiring it to exist."""
    if value is None:
        return None
    expanded = value.expanduser().absolute()
    resolved = expanded.resolve(strict=False)
    existing = expanded
    while not existing.exists():
        if existing.is_symlink():
            raise ValueError(f"artifact root crosses an unresolved symlink: {existing}")
        if existing.parent == existing:
            raise ValueError(f"cannot resolve artifact root: {expanded}")
        existing = existing.parent
    if resolved.exists() and not resolved.is_dir():
        raise ValueError(f"artifact root is not a directory: {resolved}")
    return resolved


def require_artifact_separation(artifact_root: Path, source: Path) -> None:
    """Reject generated/source directory overlap in either direction."""
    resolved_artifacts = artifact_root.resolve(strict=False)
    resolved_source = source.resolve(strict=True)
    if resolved_artifacts.is_relative_to(resolved_source) or resolved_source.is_relative_to(
        resolved_artifacts
    ):
        raise ValueError(
            "artifact root must be outside the source; "
            f"artifact root {resolved_artifacts} overlaps {resolved_source}"
        )


@dataclass(frozen=True)
class ProjectPaths:
    root: Path
    project: str
    source_override: Path | None = None
    artifact_root: Path | None = None

    @property
    def source(self) -> Path:
        return self.source_override or self.root.parent / self.project

    @property
    def preview_home(self) -> Path:
        return (self.artifact_root or self.root) / "previews"

    @property
    def stage(self) -> Path:
        return self.preview_home / ".partial" / self.project

    @property
    def backup(self) -> Path:
        return self.preview_home / ".previous" / self.project

    @property
    def live(self) -> Path:
        return self.preview_home / self.project

    @property
    def lock(self) -> Path:
        return self.preview_home / ".locks" / f"{self.project}.lock"

    @property
    def templates(self) -> Path:
        return self.root / "templates"
