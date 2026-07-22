from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from preview_tool.discovery import discover, representable
from preview_tool.state import Action, apply_action, format_status, parse_state, read_state


class DiscoveryTests(unittest.TestCase):
    def test_direct_sibling_policy_and_order(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            root = parent / "preview"
            root.mkdir()
            (parent / "zeta").mkdir()
            (parent / "alpha").mkdir()
            (parent / ".hidden").mkdir()
            (parent / "plain.txt").write_text("x", encoding="utf-8")
            (parent / "alias").symlink_to(parent / "alpha", target_is_directory=True)
            (parent / "broken").symlink_to(parent / "absent", target_is_directory=True)
            self.assertEqual(discover(root), ["alias", "alpha", "zeta"])

    def test_representable_rejects_cli_and_invisible_edges(self) -> None:
        accepted = ["alpha", "two words", "研究"]
        rejected = [
            "",
            "-flag",
            " lead",
            "trail ",
            "line\nbreak",
            "a/b",
            "x\u202ey",
            "x\u2028y",
            "x\u2029y",
        ]
        self.assertTrue(all(representable(name) for name in accepted))
        self.assertTrue(all(not representable(name) for name in rejected))


class StateTests(unittest.TestCase):
    def test_state_roundtrip_and_stale_status(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "enabled.txt"
            self.assertEqual(read_state(path), set())
            self.assertTrue(apply_action(path, ["a", "b"], "b", Action.ENABLE))
            self.assertTrue(apply_action(path, ["a", "b"], "b", Action.ENABLE))
            self.assertEqual(path.read_text(encoding="utf-8"), "b\n")
            self.assertEqual(format_status(["a"], read_state(path)), "[ ] a\n[!] b (missing)")
            self.assertFalse(apply_action(path, ["a"], "b", Action.DISABLE))
            self.assertEqual(path.read_text(encoding="utf-8"), "")

    def test_unknown_enable_and_disable_fail(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "enabled.txt"
            for action in (Action.ENABLE, Action.DISABLE, Action.TOGGLE):
                with self.subTest(action=action), self.assertRaises(ValueError):
                    apply_action(path, ["known"], "ghost", action)

    def test_parser_drops_unrepresentable_lines(self) -> None:
        self.assertEqual(
            parse_state("ok\n-bad\ntrailing \njoined\u2028record\njoined\u2029record\n"),
            {"ok"},
        )


if __name__ == "__main__":
    unittest.main()
