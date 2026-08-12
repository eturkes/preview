"""Per-project locking and restart-recoverable directory publication."""

from __future__ import annotations

import ctypes
import fcntl
import os
import shutil
import stat
import tempfile
from pathlib import Path
from types import TracebackType
from typing import TextIO


class ProjectBusyError(RuntimeError):
    pass


_AT_FDCWD = -100
_RENAME_EXCHANGE = 2


def _rename_exchange(left: Path, right: Path) -> None:
    """Atomically exchange two Linux directory entries without a missing-live gap."""
    try:
        renameat2 = ctypes.CDLL(None, use_errno=True).renameat2
    except AttributeError as error:
        raise RuntimeError("atomic directory exchange requires Linux renameat2") from error
    renameat2.argtypes = (
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    )
    renameat2.restype = ctypes.c_int
    if renameat2(
        _AT_FDCWD,
        os.fsencode(left),
        _AT_FDCWD,
        os.fsencode(right),
        _RENAME_EXCHANGE,
    ):
        error_number = ctypes.get_errno()
        raise OSError(
            error_number,
            f"atomic directory exchange failed: {os.strerror(error_number)}",
            left,
            right,
        )


def require_atomic_exchange_support(directory: Path) -> None:
    """Fail before paid work unless this output filesystem supports gap-free updates."""
    _ensure_real_directory(directory)
    probe = Path(tempfile.mkdtemp(prefix=".preview-exchange-probe-", dir=directory))
    try:
        left = probe / "left"
        right = probe / "right"
        left.mkdir()
        right.mkdir()
        (left / "marker").write_text("left", encoding="utf-8")
        (right / "marker").write_text("right", encoding="utf-8")
        _rename_exchange(left, right)
        if (left / "marker").read_text(encoding="utf-8") != "right" or (
            right / "marker"
        ).read_text(encoding="utf-8") != "left":
            raise RuntimeError("atomic directory exchange did not exchange output entries")
    finally:
        remove_leaf(probe)


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
    """Replace live with stage; leave recoverable backup residue on cleanup failure."""
    if not stage.is_dir() or stage.is_symlink():
        raise RuntimeError(f"publication stage is not a real directory: {stage}")
    remove_leaf(backup)
    if not (live.exists() or live.is_symlink()):
        os.replace(stage, live)
        return
    _rename_exchange(stage, live)
    try:
        os.replace(stage, backup)
    except OSError:
        # Promotion already succeeded. prepare_stage() removes the old live
        # directory still occupying stage before the next publication.
        return
    try:
        remove_leaf(backup)
    except OSError:
        # Promotion already succeeded. prepare_stage() removes this stale backup
        # under the same project lock before the next publication attempt.
        pass
