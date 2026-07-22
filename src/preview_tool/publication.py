"""Per-project locking and restart-recoverable directory publication."""

from __future__ import annotations

import fcntl
import os
import shutil
import stat
from pathlib import Path
from types import TracebackType
from typing import TextIO


class ProjectBusyError(RuntimeError):
    pass


def _ensure_real_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    metadata = path.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise RuntimeError(f"reserved path is not a real directory: {path}")


def remove_leaf(path: Path) -> None:
    """Remove exactly one known leaf without following a leaf symlink."""
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return
    if stat.S_ISDIR(metadata.st_mode) and not stat.S_ISLNK(metadata.st_mode):
        shutil.rmtree(path)
    else:
        path.unlink()


class ProjectLock:
    """Nonblocking advisory lock retained by an open descriptor."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._handle: TextIO | None = None

    def __enter__(self) -> ProjectLock:
        _ensure_real_directory(self.path.parent)
        try:
            metadata = self.path.lstat()
        except FileNotFoundError:
            metadata = None
        if metadata is not None and not stat.S_ISREG(metadata.st_mode):
            raise RuntimeError(f"lock path is not a regular file: {self.path}")
        handle = self.path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            handle.close()
            raise ProjectBusyError("another preview operation owns this project") from error
        self._handle = handle
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        if self._handle is not None:
            self._handle.close()
            self._handle = None


def prepare_stage(stage: Path, backup: Path, live: Path) -> None:
    """Recover an interrupted publication, then create one empty real stage."""
    for reserved in (stage.parent, backup.parent):
        _ensure_real_directory(reserved)
    if not live.exists() and backup.exists():
        os.replace(backup, live)
    elif live.exists() and backup.exists():
        remove_leaf(backup)
    remove_leaf(stage)
    stage.mkdir(mode=0o755)


def publish(stage: Path, backup: Path, live: Path) -> None:
    """Replace live with stage, restoring live if promotion raises."""
    if not stage.is_dir() or stage.is_symlink():
        raise RuntimeError(f"publication stage is not a real directory: {stage}")
    remove_leaf(backup)
    moved_live = False
    try:
        if live.exists() or live.is_symlink():
            os.replace(live, backup)
            moved_live = True
        os.replace(stage, live)
    except BaseException:
        if moved_live and not live.exists() and backup.exists():
            os.replace(backup, live)
        raise
    remove_leaf(backup)
