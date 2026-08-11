"""Model and closed-bundle validation with source-bound citation checks."""

from __future__ import annotations

import os
import re
import stat
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from .render import RenderError, compiled_files
from .schema import (
    MAX_JSON_BYTES,
    ContractJSONError,
    canonical_json,
    loads_strict,
    parse_source,
    validate_structure,
)

BUNDLE_FILES = frozenset(
    {
        "preview.json",
        "index.html",
        "styles.css",
        "theme.css",
        "app.js",
        "provenance.json",
        "gaps.md",
    }
)
MAX_SOURCE_BYTES = 8 * 1024 * 1024
MAX_SOURCE_TOTAL_BYTES = 32 * 1024 * 1024
SECRET_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,255}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{32,}\b"),
)


@dataclass(frozen=True, slots=True)
class Finding:
    severity: str
    code: str
    path: str
    message: str


@dataclass(frozen=True, slots=True)
class Report:
    findings: tuple[Finding, ...] = ()

    @property
    def ok(self) -> bool:
        return not any(finding.severity == "error" for finding in self.findings)

    def format(self) -> str:
        return "\n".join(format_finding(finding) for finding in self.findings)


def escape_controls(value: object) -> str:
    """Keep diagnostics one-line and inert while preserving readable Unicode."""
    escaped: list[str] = []
    for char in str(value):
        if unicodedata.category(char) in {"Cc", "Cf", "Cs", "Zl", "Zp"}:
            escaped.append(f"\\u{ord(char):04x}")
        else:
            escaped.append(char)
    return "".join(escaped)


def format_finding(finding: Finding) -> str:
    return (
        f"[{escape_controls(finding.severity).upper()}] "
        f"{escape_controls(finding.code)} {escape_controls(finding.path)}: "
        f"{escape_controls(finding.message)}"
    )


def _finding(code: str, path: str, message: str) -> Finding:
    return Finding("error", code, path, message)


def read_bounded_regular(path: Path, maximum: int) -> bytes:
    """Read at most one byte beyond a limit without following the final path."""
    descriptor = os.open(
        path,
        os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK,
    )
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError(f"not a regular file: {path}")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            return stream.read(maximum + 1)
    finally:
        os.close(descriptor)


def _inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _lf_lines(source: str) -> list[str]:
    """Split only on LF while retaining exact decoded line terminators."""
    if source == "":
        return []
    parts = source.split("\n")
    final_lf = parts[-1] == ""
    if final_lf:
        parts.pop()
    return [
        part + "\n" if index < len(parts) - 1 or final_lf else part
        for index, part in enumerate(parts)
    ]


def _secret_findings(value: object, path: str = "$") -> Iterable[Finding]:
    if isinstance(value, str):
        if any(pattern.search(value) for pattern in SECRET_PATTERNS):
            yield _finding(
                "secret.detected",
                path,
                "high-confidence secret pattern detected (this narrow scan is not exhaustive)",
            )
    elif isinstance(value, dict):
        for key, child in value.items():
            yield from _secret_findings(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _secret_findings(child, f"{path}.{index}")


def _citation_findings(data: object, source_base: Path, artifact_home: Path) -> Iterable[Finding]:
    if not isinstance(data, dict) or not isinstance(data.get("provenance"), list):
        return
    try:
        source_root = Path(source_base).resolve(strict=True)
    except (OSError, ValueError, RuntimeError) as exc:
        yield _finding(
            "citation.source-root", str(source_base), f"cannot resolve source root: {exc}"
        )
        return
    if not source_root.is_dir():
        yield _finding("citation.source-root", str(source_base), "source root is not a directory")
        return
    try:
        artifact_root = Path(artifact_home).resolve(strict=False)
    except (OSError, ValueError, RuntimeError) as exc:
        yield _finding(
            "citation.artifact-root", str(artifact_home), f"cannot resolve artifact root: {exc}"
        )
        return
    source_cache: dict[Path, tuple[str, object]] = {}
    loaded_source_bytes = 0
    for index, row in enumerate(data["provenance"]):
        if not isinstance(row, dict):
            continue
        row_status = row.get("status")
        if not isinstance(row_status, str) or row_status not in {"verified", "inferred"}:
            continue
        row_path = f"$.provenance.{index}"
        src = row.get("src")
        quote = row.get("quote")
        if not isinstance(src, str) or not isinstance(quote, str):
            continue
        parsed = parse_source(src)
        if parsed is None:
            yield _finding(
                "citation.syntax",
                f"{row_path}.src",
                "expected relative path:L1-L2 with a bounded inclusive range",
            )
            continue
        relative, first, last = parsed
        posix = PurePosixPath(relative)
        if (
            posix.is_absolute()
            or "\\" in relative
            or not posix.parts
            or any(part in {"", ".", ".."} for part in posix.parts)
        ):
            yield _finding(
                "citation.traversal",
                f"{row_path}.src",
                "citation path must be a clean relative POSIX path",
            )
            continue
        if ".git" in posix.parts:
            yield _finding(
                "citation.git-internal", f"{row_path}.src", "repository internals cannot be cited"
            )
            continue
        candidate = source_root.joinpath(*posix.parts)
        try:
            resolved = candidate.resolve(strict=True)
        except (OSError, ValueError, RuntimeError) as exc:
            yield _finding(
                "citation.missing", f"{row_path}.src", f"cannot resolve cited file: {exc}"
            )
            continue
        if not _inside(resolved, source_root):
            yield _finding(
                "citation.escape", f"{row_path}.src", "citation resolves outside the source root"
            )
            continue
        resolved_relative = resolved.relative_to(source_root)
        if ".git" in resolved_relative.parts:
            yield _finding(
                "citation.git-internal",
                f"{row_path}.src",
                "citation resolves into repository internals",
            )
            continue
        if _inside(resolved, artifact_root):
            yield _finding(
                "citation.artifact", f"{row_path}.src", "citation resolves inside the artifact home"
            )
            continue
        cached = source_cache.get(resolved)
        if cached is not None:
            cache_status, cache_value = cached
            if cache_status == "error":
                code, message = cache_value  # type: ignore[misc]
                yield _finding(str(code), f"{row_path}.src", str(message))
                continue
            lines = cache_value  # type: ignore[assignment]
        else:
            try:
                metadata = resolved.stat()
            except (OSError, ValueError) as exc:
                yield _finding(
                    "citation.missing", f"{row_path}.src", f"cannot stat cited file: {exc}"
                )
                continue
            if not stat.S_ISREG(metadata.st_mode):
                message = "citation target must be a regular file"
                source_cache[resolved] = ("error", ("citation.kind", message))
                yield _finding("citation.kind", f"{row_path}.src", message)
                continue
            if metadata.st_size > MAX_SOURCE_BYTES:
                message = f"citation target exceeds {MAX_SOURCE_BYTES} bytes"
                source_cache[resolved] = ("error", ("citation.size", message))
                yield _finding("citation.size", f"{row_path}.src", message)
                continue
            if loaded_source_bytes + metadata.st_size > MAX_SOURCE_TOTAL_BYTES:
                message = f"unique citation sources exceed {MAX_SOURCE_TOTAL_BYTES} bytes"
                source_cache[resolved] = ("error", ("citation.total-size", message))
                yield _finding("citation.total-size", f"{row_path}.src", message)
                continue
            loaded_source_bytes += metadata.st_size
            try:
                payload = read_bounded_regular(resolved, MAX_SOURCE_BYTES)
            except (OSError, ValueError) as exc:
                message = f"cannot read cited file: {exc}"
                source_cache[resolved] = ("error", ("citation.read", message))
                yield _finding("citation.read", f"{row_path}.src", message)
                continue
            if len(payload) > MAX_SOURCE_BYTES:
                message = f"citation target exceeds {MAX_SOURCE_BYTES} bytes"
                source_cache[resolved] = ("error", ("citation.size", message))
                yield _finding("citation.size", f"{row_path}.src", message)
                continue
            growth = max(0, len(payload) - metadata.st_size)
            if loaded_source_bytes + growth > MAX_SOURCE_TOTAL_BYTES:
                message = f"unique citation sources exceed {MAX_SOURCE_TOTAL_BYTES} bytes"
                source_cache[resolved] = ("error", ("citation.total-size", message))
                yield _finding("citation.total-size", f"{row_path}.src", message)
                continue
            loaded_source_bytes += growth
            try:
                source = payload.decode("utf-8")
            except UnicodeError:
                message = "citation target is not UTF-8 text"
                source_cache[resolved] = ("error", ("citation.encoding", message))
                yield _finding("citation.encoding", f"{row_path}.src", message)
                continue
            lines = _lf_lines(source)
            source_cache[resolved] = ("ok", lines)
        if first > len(lines) or last > len(lines):
            yield _finding(
                "citation.lines",
                f"{row_path}.src",
                f"line range {first}-{last} exceeds {len(lines)} source lines",
            )
            continue
        source_slice = "".join(lines[first - 1 : last])
        if not quote.strip() or quote not in source_slice:
            yield _finding(
                "citation.quote",
                f"{row_path}.quote",
                "quote is not a literal substring of the cited line slice",
            )


def validate_model(
    raw: str | bytes,
    expected_slug: str,
    source_base: Path,
    artifact_home: Path,
) -> Report:
    findings: list[Finding] = []
    try:
        data = loads_strict(raw)
    except (ContractJSONError, TypeError) as exc:
        code = getattr(exc, "code", "json.input")
        return Report((_finding(code, "$", str(exc)),))
    findings.extend(
        Finding("error", issue.code, issue.path, issue.message)
        for issue in validate_structure(data, expected_slug)
    )
    findings.extend(_secret_findings(data))
    findings.extend(_citation_findings(data, source_base, artifact_home))
    return Report(tuple(findings))


def _entry_findings(bundle_dir: Path) -> tuple[list[Finding], set[str]]:
    findings: list[Finding] = []
    try:
        root_stat = bundle_dir.lstat()
    except OSError as exc:
        return [_finding("bundle.missing", str(bundle_dir), f"cannot inspect bundle: {exc}")], set()
    if stat.S_ISLNK(root_stat.st_mode) or not stat.S_ISDIR(root_stat.st_mode):
        return [
            _finding("bundle.root-kind", str(bundle_dir), "bundle root must be a real directory")
        ], set()
    try:
        entries = list(bundle_dir.iterdir())
    except OSError as exc:
        return [_finding("bundle.read", str(bundle_dir), f"cannot list bundle: {exc}")], set()
    names = {entry.name for entry in entries}
    if names != BUNDLE_FILES:
        missing = sorted(BUNDLE_FILES - names)
        extra = sorted(names - BUNDLE_FILES)
        parts = []
        if missing:
            parts.append("missing " + ", ".join(missing))
        if extra:
            parts.append("unexpected " + ", ".join(extra))
        findings.append(_finding("bundle.entries", str(bundle_dir), "; ".join(parts)))
    for entry in entries:
        try:
            mode = entry.lstat().st_mode
        except OSError as exc:
            findings.append(
                _finding("bundle.entry-kind", entry.name, f"cannot inspect entry: {exc}")
            )
            continue
        if stat.S_ISLNK(mode) or not stat.S_ISREG(mode):
            findings.append(
                _finding(
                    "bundle.entry-kind", entry.name, "entry must be a regular non-symlink file"
                )
            )
    return findings, names


def validate_bundle(
    bundle_dir: Path,
    expected_slug: str,
    source_base: Path,
    artifact_home: Path,
    template_dir: Path,
) -> Report:
    bundle_dir = Path(bundle_dir)
    findings, names = _entry_findings(bundle_dir)
    preview_path = bundle_dir / "preview.json"
    if "preview.json" not in names or preview_path.is_symlink() or not preview_path.is_file():
        return Report(tuple(findings))
    try:
        raw = read_bounded_regular(preview_path, MAX_JSON_BYTES)
    except (OSError, ValueError) as exc:
        findings.append(_finding("bundle.preview-read", "preview.json", str(exc)))
        return Report(tuple(findings))
    model = validate_model(raw, expected_slug, source_base, artifact_home)
    findings.extend(model.findings)
    if any(finding.severity == "error" for finding in model.findings):
        return Report(tuple(findings))
    try:
        data = loads_strict(raw)
    except (ContractJSONError, TypeError):
        return Report(tuple(findings))
    canonical = canonical_json(data)
    if raw != canonical:
        findings.append(
            _finding(
                "bundle.preview-canonical", "preview.json", "preview.json is not canonical JSON"
            )
        )
    try:
        expected = compiled_files(data, Path(template_dir))  # type: ignore[arg-type]
    except (RenderError, OSError, KeyError, TypeError, ValueError) as exc:
        findings.append(_finding("bundle.compile", str(template_dir), str(exc)))
        return Report(tuple(findings))
    for name, content in expected.items():
        path = bundle_dir / name
        if name not in names or path.is_symlink() or not path.is_file():
            continue
        try:
            actual = read_bounded_regular(path, len(content))
        except (OSError, ValueError) as exc:
            findings.append(_finding("bundle.derived-read", name, str(exc)))
            continue
        if actual != content:
            findings.append(
                _finding(
                    "bundle.derived-mismatch", name, "file differs from deterministic compilation"
                )
            )
    return Report(tuple(findings))


__all__ = [
    "BUNDLE_FILES",
    "Finding",
    "Report",
    "escape_controls",
    "format_finding",
    "read_bounded_regular",
    "validate_bundle",
    "validate_model",
]
