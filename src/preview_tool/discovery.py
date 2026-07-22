"""Direct-sibling project discovery and safe CLI-name policy."""

from __future__ import annotations

import unicodedata
from pathlib import Path


def representable(name: str) -> bool:
    """Whether a sibling name is stable in CLI args, paths, and line state."""
    if not name or name.startswith("-") or name[0].isspace() or name[-1].isspace():
        return False
    for char in name:
        codepoint = ord(char)
        if char == "/" or codepoint < 0x20 or 0x7F <= codepoint <= 0x9F:
            return False
        if unicodedata.category(char) in {"Cf", "Zl", "Zp"}:
            return False
    return True


def discover(root: Path) -> list[str]:
    """Return sorted direct sibling directories and directory symlinks."""
    resolved = root.resolve(strict=True)
    found: list[str] = []
    for entry in resolved.parent.iterdir():
        name = entry.name
        if name == resolved.name or name.startswith(".") or not representable(name):
            continue
        try:
            if entry.is_dir():
                found.append(name)
        except OSError:
            continue
    return sorted(found)


def require_project(root: Path, name: str) -> Path:
    """Resolve one current sibling without accepting a spelling/path escape."""
    if not representable(name) or name not in discover(root):
        raise ValueError(f"unknown project {name!r}")
    source = root.resolve(strict=True).parent / name
    return source.resolve(strict=True)
