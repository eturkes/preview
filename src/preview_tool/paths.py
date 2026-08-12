"""Repository-root and project path derivation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


def repo_root() -> Path:
    """Return this checkout's resolved root, independent of the caller's cwd."""
    return Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class ProjectPaths:
    root: Path
    project: str
    source_override: Path | None = None

    @property
    def source(self) -> Path:
        return self.source_override or self.root.parent / self.project

    @property
    def preview_home(self) -> Path:
        return self.root / "previews"

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
