from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from preview_tool.publication import (
    ProjectBusyError,
    ProjectLock,
    prepare_stage,
    publish,
    require_atomic_exchange_support,
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

    def test_update_uses_atomic_directory_exchange(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage, backup, live = self.paths(root)
            stage.mkdir(parents=True)
            live.mkdir()
            (stage / "new").write_text("new", encoding="utf-8")
            (live / "old").write_text("old", encoding="utf-8")
            from preview_tool import publication

            exchange = publication._rename_exchange

            def observed_exchange(left: Path, right: Path) -> None:
                self.assertTrue(right.is_dir())
                exchange(left, right)
                self.assertTrue(right.is_dir())

            with mock.patch(
                "preview_tool.publication._rename_exchange",
                side_effect=observed_exchange,
            ) as called:
                publish(stage, backup, live)

            called.assert_called_once_with(stage, live)
            self.assertEqual((live / "new").read_text(encoding="utf-8"), "new")
            self.assertFalse((live / "old").exists())

    def test_atomic_exchange_support_probe_exercises_and_cleans_output_filesystem(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "artifacts"

            require_atomic_exchange_support(output)

            self.assertEqual(tuple(output.iterdir()), ())

    def test_post_promotion_cleanup_failure_is_successful_and_recoverable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage, backup, live = self.paths(root)
            stage.mkdir(parents=True)
            backup.parent.mkdir(parents=True)
            (stage / "new").write_text("new", encoding="utf-8")
            live.mkdir()
            (live / "old").write_text("old", encoding="utf-8")

            with mock.patch(
                "preview_tool.publication.remove_leaf",
                side_effect=(None, OSError("injected cleanup failure")),
            ):
                publish(stage, backup, live)

            self.assertEqual((live / "new").read_text(encoding="utf-8"), "new")
            self.assertEqual((backup / "old").read_text(encoding="utf-8"), "old")
            prepare_stage(stage, backup, live)
            self.assertFalse(backup.exists())
            self.assertTrue(stage.is_dir())
            self.assertEqual((live / "new").read_text(encoding="utf-8"), "new")

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
