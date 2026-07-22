from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from preview_tool.publication import (
    ProjectBusyError,
    ProjectLock,
    prepare_stage,
    publish,
)


class PublicationTests(unittest.TestCase):
    def paths(self, root: Path) -> tuple[Path, Path, Path]:
        return root / ".partial" / "p", root / ".previous" / "p", root / "p"

    def test_prepare_recovers_backup_and_publish_replaces_live(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage, backup, live = self.paths(root)
            backup.mkdir(parents=True)
            (backup / "old").write_text("old", encoding="utf-8")
            prepare_stage(stage, backup, live)
            self.assertEqual((live / "old").read_text(encoding="utf-8"), "old")
            (stage / "new").write_text("new", encoding="utf-8")
            publish(stage, backup, live)
            self.assertFalse((live / "old").exists())
            self.assertEqual((live / "new").read_text(encoding="utf-8"), "new")
            self.assertFalse(backup.exists())

    def test_stage_symlink_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage, backup, live = self.paths(root)
            stage.parent.mkdir(parents=True)
            target = root / "target"
            target.mkdir()
            stage.symlink_to(target, target_is_directory=True)
            with self.assertRaises(RuntimeError):
                publish(stage, backup, live)

    def test_project_lock_is_nonblocking(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            lock = Path(temporary) / ".locks" / "p.lock"
            with (
                ProjectLock(lock),
                self.assertRaises(ProjectBusyError),
                ProjectLock(lock),
            ):
                self.fail("second lock unexpectedly acquired")
            with ProjectLock(lock):
                pass


if __name__ == "__main__":
    unittest.main()
