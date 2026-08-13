"""Bounded generation metadata adjacent to atomically published bundles."""

from __future__ import annotations

import os
import stat
import tempfile
import unicodedata
from dataclasses import asdict, dataclass
from pathlib import Path

from .schema import canonical_json, loads_strict
from .validation import read_bounded_regular

MAX_RECORD_BYTES = 64 * 1024
MAX_USER_PROMPT_CHARS = 8_000
ECMASCRIPT_TRIM_CHARS = (
    "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)


@dataclass(frozen=True, slots=True)
class GenerationRecord:
    schemaVersion: int
    project: str
    sourceRevision: str | None
    sourceDirty: bool
    strategy: str
    basedOnSourceRevision: str | None
    prompt: str


def normalize_user_prompt(value: str) -> str:
    prompt = value.strip(ECMASCRIPT_TRIM_CHARS)
    if "\x00" in prompt:
        raise ValueError("Preview prompt contains a null byte")
    if any(unicodedata.category(character) == "Cs" for character in prompt):
        raise ValueError("Preview prompt contains a lone surrogate")
    utf16_units = len(prompt.encode("utf-16-le", errors="surrogatepass")) // 2
    if utf16_units > MAX_USER_PROMPT_CHARS:
        raise ValueError(
            f"Preview prompt exceeds {MAX_USER_PROMPT_CHARS} characters"
        )
    return prompt


def _record(value: object, expected_project: str) -> GenerationRecord:
    if not isinstance(value, dict) or set(value) != {
        "schemaVersion",
        "project",
        "sourceRevision",
        "sourceDirty",
        "strategy",
        "basedOnSourceRevision",
        "prompt",
    }:
        raise ValueError("generation record has an unsupported shape")
    revision = value["sourceRevision"]
    based_on = value["basedOnSourceRevision"]
    if (
        not isinstance(value["schemaVersion"], int)
        or isinstance(value["schemaVersion"], bool)
        or value["schemaVersion"] != 1
        or value["project"] != expected_project
        or not isinstance(value["sourceDirty"], bool)
        or not isinstance(value["strategy"], str)
        or value["strategy"] not in {"fresh", "update"}
        or not isinstance(value["prompt"], str)
        or (revision is not None and not _revision(revision))
        or (based_on is not None and not _revision(based_on))
    ):
        raise ValueError("generation record is invalid")
    return GenerationRecord(
        schemaVersion=1,
        project=expected_project,
        sourceRevision=revision,
        sourceDirty=value["sourceDirty"],
        strategy=value["strategy"],
        basedOnSourceRevision=based_on,
        prompt=normalize_user_prompt(value["prompt"]),
    )


def _revision(value: object) -> bool:
    return isinstance(value, str) and len(value) in {40, 64} and all(
        character in "0123456789abcdef" for character in value
    )


def read_record(path: Path, expected_project: str) -> GenerationRecord | None:
    try:
        raw = read_bounded_regular(path, MAX_RECORD_BYTES)
    except FileNotFoundError:
        return None
    if len(raw) > MAX_RECORD_BYTES:
        raise ValueError("generation record exceeds its byte limit")
    try:
        value = loads_strict(raw)
    except ValueError as error:
        raise ValueError("generation record is not valid UTF-8 JSON") from error
    return _record(value, expected_project)


def write_record(path: Path, record: GenerationRecord) -> None:
    """Atomically replace one record; a crash can only leave the older record."""
    record = _record(asdict(record), record.project)
    parent = path.parent
    parent.mkdir(parents=True, exist_ok=True)
    metadata = parent.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise RuntimeError(f"generation record parent is not a real directory: {parent}")
    raw = canonical_json(asdict(record))
    if len(raw) > MAX_RECORD_BYTES:
        raise ValueError("generation record exceeds its byte limit")
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


__all__ = [
    "GenerationRecord",
    "MAX_RECORD_BYTES",
    "MAX_USER_PROMPT_CHARS",
    "normalize_user_prompt",
    "read_record",
    "write_record",
]
