"""Ignored, default-off project selection state."""

from __future__ import annotations

import os
from enum import StrEnum
from pathlib import Path

from .discovery import representable


class Action(StrEnum):
    ENABLE = "enable"
    DISABLE = "disable"
    TOGGLE = "toggle"


def parse_state(text: str) -> set[str]:
    return {line for line in text.split("\n") if line and representable(line)}


def serialize_state(enabled: set[str]) -> str:
    return "".join(f"{name}\n" for name in sorted(enabled))


def read_state(path: Path) -> set[str]:
    try:
        return parse_state(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return set()


def write_state(path: Path, enabled: set[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(serialize_state(enabled))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def apply_action(
    path: Path,
    projects: list[str],
    name: str,
    action: Action,
) -> bool:
    """Apply an action and return the resulting enabled state."""
    enabled = read_state(path)
    current = name in projects
    present = name in enabled
    wanted = {Action.ENABLE: True, Action.DISABLE: False, Action.TOGGLE: not present}[action]
    if wanted and not current:
        raise ValueError(f"unknown project {name!r}")
    if not wanted and not (current or present):
        raise ValueError(f"unknown project {name!r}")
    before = set(enabled)
    if wanted:
        enabled.add(name)
    else:
        enabled.discard(name)
    if enabled != before:
        write_state(path, enabled)
    return wanted


def format_status(projects: list[str], enabled: set[str]) -> str:
    lines = [f"[{'x' if name in enabled else ' '}] {name}" for name in projects]
    current = set(projects)
    lines.extend(f"[!] {name} (missing)" for name in sorted(enabled - current))
    return "\n".join(lines)
