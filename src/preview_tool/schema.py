"""Strict JSON parsing plus the declarative preview contract.

The JSON Schema is the model-facing constraint.  This module deliberately repeats
its small vocabulary: publication must not depend on a third-party validator and
semantic references cannot be expressed usefully in JSON Schema.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

MAX_JSON_BYTES = 512 * 1024
MAX_DEPTH = 16
MAX_NODES = 12_000
MAX_STRING_CHARS = 180_000

ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SOURCE_RE = re.compile(r"^(?P<path>[^:\r\n]+):L?(?P<first>[1-9][0-9]*)-L?(?P<last>[1-9][0-9]*)$")
MARKUP_RE = re.compile(r"<[^>\r\n]{1,200}>")
URL_RE = re.compile(
    r"(?:[a-z][a-z0-9+.-]*://|(?:mailto|tel|data|javascript):|www\.)", re.IGNORECASE
)

THEMES = frozenset({"indigo", "ember", "forest", "plum", "graphite"})
FONTS = frozenset({"humanist", "editorial", "technical"})
VIEW_KINDS = frozenset({"overview", "example", "state"})
COMPONENT_KINDS = frozenset(
    {"metrics", "facts", "steps", "comparison", "code", "evidence", "demo", "roadmap"}
)
TONES = frozenset({"neutral", "info", "accent", "positive", "warning", "critical"})
PROJECT_TONES = TONES - {"accent"}
ITEM_STATUSES = frozenset({"neutral", "current", "planned", "done", "blocked", "gap"})
PROVENANCE_STATUSES = frozenset({"verified", "inferred", "gap"})
SHELL_ANCHORS = frozenset(
    {"app-shell", "project-header", "view-nav", "project-status", "language-switcher", "tour-start"}
)


class ContractJSONError(ValueError):
    """JSON cannot be admitted to the author contract."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class DuplicateKeyError(ContractJSONError):
    pass


@dataclass(frozen=True, slots=True)
class SchemaIssue:
    code: str
    path: str
    message: str


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateKeyError("json.duplicate-key", f"duplicate JSON object key: {key!r}")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ContractJSONError("json.nonfinite", f"non-finite JSON number: {value}")


def _parse_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ContractJSONError("json.nonfinite", f"non-finite JSON number: {value}")
    return parsed


def _parse_int(value: str) -> int:
    digits = value.removeprefix("-")
    if len(digits) > 128:
        raise ContractJSONError("json.integer-range", "JSON integer exceeds 128 digits")
    return int(value)


def _measure(value: Any, depth: int = 0) -> tuple[int, int]:
    if depth > MAX_DEPTH:
        raise ContractJSONError("json.depth", f"JSON nesting exceeds {MAX_DEPTH}")
    if isinstance(value, str):
        if any(unicodedata.category(char) == "Cs" for char in value):
            raise ContractJSONError("json.surrogate", "JSON strings cannot contain lone surrogates")
        return 1, len(value)
    if isinstance(value, dict):
        nodes, chars = 1, sum(len(key) for key in value)
        for key, child in value.items():
            if any(unicodedata.category(char) == "Cs" for char in key):
                raise ContractJSONError(
                    "json.surrogate", "JSON object keys cannot contain lone surrogates"
                )
            child_nodes, child_chars = _measure(child, depth + 1)
            nodes += child_nodes
            chars += child_chars
        return nodes, chars
    if isinstance(value, list):
        nodes, chars = 1, 0
        for child in value:
            child_nodes, child_chars = _measure(child, depth + 1)
            nodes += child_nodes
            chars += child_chars
        return nodes, chars
    return 1, 0


def loads_strict(raw: str | bytes) -> object:
    """Load bounded UTF-8 JSON, rejecting duplicate keys and non-finite numbers."""

    if isinstance(raw, bytes):
        if len(raw) > MAX_JSON_BYTES:
            raise ContractJSONError("json.size", f"JSON exceeds {MAX_JSON_BYTES} bytes")
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ContractJSONError("json.utf8", f"JSON is not UTF-8: {exc}") from exc
    elif isinstance(raw, str):
        text = raw
        try:
            encoded_size = len(text.encode("utf-8"))
        except UnicodeEncodeError as exc:
            raise ContractJSONError("json.surrogate", "JSON contains a lone surrogate") from exc
        if encoded_size > MAX_JSON_BYTES:
            raise ContractJSONError("json.size", f"JSON exceeds {MAX_JSON_BYTES} bytes")
    else:
        raise TypeError("raw JSON must be str or bytes")
    try:
        value = json.loads(
            text,
            object_pairs_hook=_pairs,
            parse_constant=_reject_constant,
            parse_float=_parse_float,
            parse_int=_parse_int,
        )
    except ContractJSONError:
        raise
    except (json.JSONDecodeError, RecursionError, ValueError) as exc:
        raise ContractJSONError("json.syntax", f"invalid JSON: {exc}") from exc
    nodes, chars = _measure(value)
    if nodes > MAX_NODES:
        raise ContractJSONError(
            "json.nodes", f"JSON contains {nodes} nodes; maximum is {MAX_NODES}"
        )
    if chars > MAX_STRING_CHARS:
        raise ContractJSONError(
            "json.string-budget",
            f"JSON contains {chars} string characters; maximum is {MAX_STRING_CHARS}",
        )
    return value


def canonical_json(data: object) -> bytes:
    """Return the repository's one canonical, human-diffable JSON encoding."""

    try:
        encoded = json.dumps(
            data,
            ensure_ascii=False,
            allow_nan=False,
            indent=2,
            sort_keys=True,
            separators=(",", ": "),
        )
        return (encoded + "\n").encode("utf-8")
    except (TypeError, ValueError, UnicodeError) as exc:
        raise ContractJSONError("json.value", f"value is not canonical JSON: {exc}") from exc


def _path(parent: str, key: str | int) -> str:
    return f"{parent}.{key}" if parent else str(key)


class _Checker:
    def __init__(self, expected_slug: str | None) -> None:
        self.expected_slug = expected_slug
        self.issues: list[SchemaIssue] = []
        self.ui_ids: dict[str, str] = {}
        self.claim_refs: dict[str, str] = {}
        self.code_claims: dict[str, tuple[str, str]] = {}

    def add(self, code: str, path: str, message: str) -> None:
        self.issues.append(SchemaIssue(code, path or "$", message))

    def obj(self, value: Any, path: str, keys: Iterable[str]) -> Mapping[str, Any] | None:
        if not isinstance(value, dict):
            self.add("schema.type", path, "must be an object")
            return None
        expected = set(keys)
        actual = set(value)
        if actual != expected:
            missing = sorted(expected - actual)
            extra = sorted(actual - expected)
            detail = []
            if missing:
                detail.append("missing " + ", ".join(missing))
            if extra:
                detail.append("unknown " + ", ".join(extra))
            self.add("schema.keys", path, "; ".join(detail))
        return value

    def array(
        self, value: Any, path: str, minimum: int = 0, maximum: int = 256
    ) -> Sequence[Any] | None:
        if not isinstance(value, list):
            self.add("schema.type", path, "must be an array")
            return None
        if not minimum <= len(value) <= maximum:
            self.add("schema.count", path, f"must contain {minimum}..{maximum} entries")
        return value

    def string(
        self,
        value: Any,
        path: str,
        *,
        minimum: int = 0,
        maximum: int = 2400,
        multiline: bool = False,
    ) -> str | None:
        if not isinstance(value, str):
            self.add("schema.type", path, "must be a string")
            return None
        if len(value) < minimum or len(value) > maximum or (minimum and not value.strip()):
            self.add("schema.length", path, f"must contain {minimum}..{maximum} useful characters")
        for char in value:
            point = ord(char)
            category = unicodedata.category(char)
            allowed_space = multiline and char in "\t\n\r"
            if point in {
                0x061C,
                0x200E,
                0x200F,
                0x202A,
                0x202B,
                0x202C,
                0x202D,
                0x202E,
                0x2066,
                0x2067,
                0x2068,
                0x2069,
            }:
                self.add("text.bidi", path, f"contains bidi control U+{point:04X}")
                break
            if (category == "Cc" and not allowed_space) or category in {
                "Cf",
                "Cs",
                "Zl",
                "Zp",
            }:
                self.add("text.control", path, f"contains forbidden U+{point:04X}")
                break
        return value

    def enum(self, value: Any, path: str, choices: frozenset[str]) -> str | None:
        checked = self.string(value, path, minimum=1, maximum=32)
        if checked is not None and checked not in choices:
            self.add("schema.enum", path, f"must be one of: {', '.join(sorted(choices))}")
        return checked

    def ident(self, value: Any, path: str, *, empty: bool = False) -> str | None:
        checked = self.string(value, path, minimum=0 if empty else 1, maximum=64)
        if checked is not None and checked == "" and empty:
            return checked
        if checked is not None and not ID_RE.fullmatch(checked):
            self.add("id.format", path, "must be lowercase ASCII kebab-case")
        return checked

    def unique_ui_id(self, value: Any, path: str) -> str | None:
        checked = self.ident(value, path)
        if checked:
            prior = self.ui_ids.get(checked)
            if prior is not None:
                self.add("id.duplicate", path, f"duplicates {prior}")
            else:
                self.ui_ids[checked] = path
        return checked

    def claim_ref(self, value: Any, path: str, *, empty: bool = True) -> str | None:
        claim_id = self.ident(value, path, empty=empty)
        if claim_id:
            prior = self.claim_refs.get(claim_id)
            if prior is not None:
                self.add("claim.duplicate-reference", path, f"also referenced at {prior}")
            else:
                self.claim_refs[claim_id] = path
        return claim_id

    def localized(self, value: Any, path: str, maximum: int, *, empty: bool = False) -> None:
        obj = self.obj(value, path, {"ja", "en"})
        if obj is None:
            return
        for locale in ("ja", "en"):
            locale_path = _path(path, locale)
            checked = self.string(
                obj.get(locale), locale_path, minimum=0 if empty else 1, maximum=maximum
            )
            if checked and MARKUP_RE.search(checked):
                self.add(
                    "text.markup", locale_path, "localized text must not contain HTML-like tags"
                )
            if checked and URL_RE.search(checked):
                self.add("text.url", locale_path, "localized text must not contain URLs")

    def run(self, data: Any) -> list[SchemaIssue]:
        root = self.obj(data, "$", {"dashboard", "provenance", "gaps"})
        if root is None:
            return self.issues
        self.dashboard(root.get("dashboard"), "$.dashboard")
        self.provenance(root.get("provenance"), "$.provenance")
        self.gaps(root.get("gaps"), "$.gaps", root.get("provenance"))
        return self.issues

    def dashboard(self, value: Any, path: str) -> None:
        obj = self.obj(value, path, {"schema_version", "project", "views", "tour"})
        if obj is None:
            return
        version = obj.get("schema_version")
        if type(version) is not int or version != 1:
            self.add("schema.version", _path(path, "schema_version"), "must equal integer 1")
        self.project(obj.get("project"), _path(path, "project"))
        views = self.array(obj.get("views"), _path(path, "views"), 3, 8)
        view_ids: dict[str, str] = {}
        view_kinds: dict[str, str] = {}
        components: dict[str, tuple[str, str]] = {}
        demos: dict[str, str] = {}
        kinds: set[str] = set()
        if views is not None:
            for index, view in enumerate(views):
                view_path = _path(_path(path, "views"), index)
                result = self.view(view, view_path)
                if result is None:
                    continue
                view_id, kind, component_rows = result
                if view_id:
                    view_ids[view_id] = view_path
                    if kind:
                        view_kinds[view_id] = kind
                if kind:
                    kinds.add(kind)
                for component_id, component_kind in component_rows:
                    if component_id:
                        components[component_id] = (view_id or "", component_kind or "")
                        if component_kind == "demo":
                            demos[component_id] = view_id or ""
        missing_kinds = VIEW_KINDS - kinds
        if missing_kinds:
            self.add(
                "view.kind.missing",
                _path(path, "views"),
                "must include: " + ", ".join(sorted(missing_kinds)),
            )
        if not any(view_kinds.get(owner) == "example" for owner in demos.values()):
            self.add(
                "demo.example.missing",
                _path(path, "views"),
                "at least one demo component must belong to an example view",
            )
        self.tour(
            obj.get("tour"),
            _path(path, "tour"),
            view_ids,
            view_kinds,
            components,
            demos,
        )

    def project(self, value: Any, path: str) -> None:
        keys = {"slug", "name", "eyebrow", "tagline", "summary", "status", "theme", "font"}
        obj = self.obj(value, path, keys)
        if obj is None:
            return
        slug = self.string(obj.get("slug"), _path(path, "slug"), minimum=1, maximum=128)
        if self.expected_slug is not None and slug is not None and slug != self.expected_slug:
            self.add("slug.mismatch", _path(path, "slug"), f"expected {self.expected_slug!r}")
        self.localized(obj.get("name"), _path(path, "name"), 120)
        self.localized(obj.get("eyebrow"), _path(path, "eyebrow"), 80)
        self.localized(obj.get("tagline"), _path(path, "tagline"), 240)
        self.localized(obj.get("summary"), _path(path, "summary"), 1200)
        status = self.obj(obj.get("status"), _path(path, "status"), {"label", "tone", "claim_id"})
        if status is not None:
            self.localized(status.get("label"), _path(_path(path, "status"), "label"), 80)
            self.enum(status.get("tone"), _path(_path(path, "status"), "tone"), PROJECT_TONES)
            self.claim_ref(
                status.get("claim_id"), _path(_path(path, "status"), "claim_id"), empty=False
            )
        self.enum(obj.get("theme"), _path(path, "theme"), THEMES)
        self.enum(obj.get("font"), _path(path, "font"), FONTS)

    def view(
        self, value: Any, path: str
    ) -> tuple[str | None, str | None, list[tuple[str | None, str | None]]] | None:
        obj = self.obj(value, path, {"id", "kind", "label", "title", "summary", "components"})
        if obj is None:
            return None
        view_id = self.unique_ui_id(obj.get("id"), _path(path, "id"))
        kind = self.enum(obj.get("kind"), _path(path, "kind"), VIEW_KINDS)
        self.localized(obj.get("label"), _path(path, "label"), 80)
        self.localized(obj.get("title"), _path(path, "title"), 160)
        self.localized(obj.get("summary"), _path(path, "summary"), 800)
        components = self.array(obj.get("components"), _path(path, "components"), 1, 12)
        rows: list[tuple[str | None, str | None]] = []
        if components is not None:
            for index, component in enumerate(components):
                rows.append(self.component(component, _path(_path(path, "components"), index)))
        return view_id, kind, rows

    def component(self, value: Any, path: str) -> tuple[str | None, str | None]:
        keys = {"id", "kind", "title", "body", "tone", "items", "code", "demo"}
        obj = self.obj(value, path, keys)
        if obj is None:
            return None, None
        component_id = self.unique_ui_id(obj.get("id"), _path(path, "id"))
        if component_id in SHELL_ANCHORS:
            self.add(
                "id.reserved",
                _path(path, "id"),
                "component ID collides with a trusted shell tour anchor",
            )
        kind = self.enum(obj.get("kind"), _path(path, "kind"), COMPONENT_KINDS)
        self.localized(obj.get("title"), _path(path, "title"), 160)
        self.localized(obj.get("body"), _path(path, "body"), 1200)
        self.enum(obj.get("tone"), _path(path, "tone"), TONES)
        items = self.array(obj.get("items"), _path(path, "items"), 0, 16)
        if items is not None:
            for index, item in enumerate(items):
                self.item(item, _path(_path(path, "items"), index))
        code = self.obj(obj.get("code"), _path(path, "code"), {"language", "text", "claim_id"})
        language: str | None = None
        code_text: str | None = None
        code_claim: str | None = None
        if code is not None:
            language = self.string(
                code.get("language"), _path(_path(path, "code"), "language"), maximum=32
            )
            code_text = self.string(
                code.get("text"), _path(_path(path, "code"), "text"), maximum=2400, multiline=True
            )
            code_claim = self.claim_ref(
                code.get("claim_id"), _path(_path(path, "code"), "claim_id"), empty=True
            )
            if code_claim and code_text:
                self.code_claims[code_claim] = (_path(_path(path, "code"), "text"), code_text)
        demo = self.obj(
            obj.get("demo"),
            _path(path, "demo"),
            {"button", "running", "result_title", "result_body"},
        )
        if demo is not None:
            for key, maximum in (
                ("button", 120),
                ("running", 200),
                ("result_title", 160),
                ("result_body", 1200),
            ):
                self.localized(
                    demo.get(key), _path(_path(path, "demo"), key), maximum, empty=kind != "demo"
                )
        item_count = len(items) if items is not None else -1
        if kind == "code":
            if (
                item_count != 0
                or not language
                or not code_text
                or not code_claim
                or not self._demo_empty(demo)
            ):
                self.add(
                    "component.shape",
                    path,
                    "code requires nonempty code and claim_id; items and demo must be empty",
                )
        elif kind == "demo":
            if (
                item_count < 1
                or language not in (None, "")
                or code_text not in (None, "")
                or code_claim not in (None, "")
                or self._demo_empty(demo)
            ):
                self.add(
                    "component.shape",
                    path,
                    "demo requires items and all demo strings; code must be empty",
                )
        elif kind in COMPONENT_KINDS and (
            item_count < 1
            or language not in (None, "")
            or code_text not in (None, "")
            or code_claim not in (None, "")
            or not self._demo_empty(demo)
        ):
            self.add("component.shape", path, f"{kind} requires items; code and demo must be empty")
        return component_id, kind

    @staticmethod
    def _demo_empty(demo: Mapping[str, Any] | None) -> bool:
        if demo is None:
            return False
        return all(
            isinstance(demo.get(key), dict)
            and demo[key].get("ja") == ""
            and demo[key].get("en") == ""
            for key in ("button", "running", "result_title", "result_body")
        )

    def item(self, value: Any, path: str) -> None:
        keys = {"id", "label", "value", "detail", "status", "magnitude", "claim_id"}
        obj = self.obj(value, path, keys)
        if obj is None:
            return
        self.unique_ui_id(obj.get("id"), _path(path, "id"))
        self.localized(obj.get("label"), _path(path, "label"), 120)
        self.localized(obj.get("value"), _path(path, "value"), 200)
        self.localized(obj.get("detail"), _path(path, "detail"), 800)
        status = self.enum(obj.get("status"), _path(path, "status"), ITEM_STATUSES)
        magnitude = obj.get("magnitude")
        if type(magnitude) is not int or not 0 <= magnitude <= 100:
            self.add(
                "item.magnitude", _path(path, "magnitude"), "must be an integer from 0 through 100"
            )
        claim_id = self.claim_ref(obj.get("claim_id"), _path(path, "claim_id"), empty=True)
        if status in ITEM_STATUSES - {"neutral"} and not claim_id:
            self.add(
                "item.claim-required",
                _path(path, "claim_id"),
                "non-neutral item status requires a provenance claim",
            )
        if type(magnitude) is int and magnitude > 0 and not claim_id:
            self.add(
                "item.magnitude-claim",
                _path(path, "claim_id"),
                "nonzero visual magnitude requires a provenance claim",
            )

    def tour(
        self,
        value: Any,
        path: str,
        view_ids: Mapping[str, str],
        view_kinds: Mapping[str, str],
        components: Mapping[str, tuple[str, str]],
        demos: Mapping[str, str],
    ) -> None:
        obj = self.obj(value, path, {"controls", "steps"})
        if obj is None:
            return
        controls = self.obj(
            obj.get("controls"), _path(path, "controls"), {"next", "back", "done", "close"}
        )
        if controls is not None:
            for key in ("next", "back", "done", "close"):
                self.localized(controls.get(key), _path(_path(path, "controls"), key), 40)
        steps = self.array(obj.get("steps"), _path(path, "steps"), 8, 24)
        detached = anchored = revealed = False
        revealed_example = False
        visited_state_component = False
        earlier_targets: set[tuple[str, str]] = set()
        if steps is not None:
            for index, step in enumerate(steps):
                step_path = _path(_path(path, "steps"), index)
                row = self.obj(step, step_path, {"id", "title", "body", "target", "view", "reveal"})
                if row is None:
                    continue
                self.unique_ui_id(row.get("id"), _path(step_path, "id"))
                self.localized(row.get("title"), _path(step_path, "title"), 160)
                self.localized(row.get("body"), _path(step_path, "body"), 800)
                target = self.ident(row.get("target"), _path(step_path, "target"), empty=True)
                view = self.ident(row.get("view"), _path(step_path, "view"), empty=True)
                reveal = self.ident(row.get("reveal"), _path(step_path, "reveal"), empty=True)
                detached = detached or target == ""
                anchored = anchored or bool(target)
                revealed = revealed or bool(reveal)
                if view and view not in view_ids:
                    self.add(
                        "tour.view", _path(step_path, "view"), "does not reference an existing view"
                    )
                if target and target not in SHELL_ANCHORS and target not in components:
                    self.add(
                        "tour.target",
                        _path(step_path, "target"),
                        "is not a shell anchor or component ID",
                    )
                if target in components:
                    owner = components[target][0]
                    if view != owner:
                        self.add("tour.target-view", step_path, f"target belongs to view {owner!r}")
                    elif view_kinds.get(owner) == "state":
                        visited_state_component = True
                if reveal and reveal not in demos:
                    self.add(
                        "tour.reveal",
                        _path(step_path, "reveal"),
                        "does not reference a demo component",
                    )
                if reveal in demos and view != demos[reveal]:
                    self.add(
                        "tour.reveal-view",
                        step_path,
                        f"revealed demo belongs to view {demos[reveal]!r}",
                    )
                elif reveal in demos and view_kinds.get(demos[reveal]) == "example":
                    revealed_example = True
                if reveal and (reveal, view or "") not in earlier_targets:
                    self.add(
                        "tour.reveal-order",
                        _path(step_path, "reveal"),
                        "demo result requires an earlier step targeting that demo in the same view",
                    )
                if target:
                    earlier_targets.add((target, view or ""))
                if index == 0 and (target != "" or view != "" or reveal != ""):
                    self.add(
                        "tour.first-step",
                        step_path,
                        "first step must be detached with empty target/view/reveal",
                    )
        if not detached or not anchored or not revealed:
            self.add(
                "tour.coverage",
                _path(path, "steps"),
                "requires detached, anchored, and demo-result steps",
            )
        if not revealed_example:
            self.add(
                "tour.demo-example.missing",
                _path(path, "steps"),
                "at least one revealed demo must belong to an example view",
            )
        if not visited_state_component:
            self.add(
                "tour.state.missing",
                _path(path, "steps"),
                "at least one tour step must target a component in a state view",
            )

    def provenance(self, value: Any, path: str) -> None:
        rows = self.array(value, path, 0, 256)
        provenance_ids: dict[str, str] = {}
        if rows is not None:
            for index, row_value in enumerate(rows):
                row_path = _path(path, index)
                row = self.obj(row_value, row_path, {"id", "claim", "status", "src", "quote"})
                if row is None:
                    continue
                claim_id = self.ident(row.get("id"), _path(row_path, "id"))
                if claim_id:
                    prior = provenance_ids.get(claim_id)
                    if prior is not None:
                        self.add(
                            "provenance.duplicate", _path(row_path, "id"), f"duplicates {prior}"
                        )
                    else:
                        provenance_ids[claim_id] = _path(row_path, "id")
                self.localized(row.get("claim"), _path(row_path, "claim"), 1200)
                status = self.enum(
                    row.get("status"), _path(row_path, "status"), PROVENANCE_STATUSES
                )
                src = self.string(row.get("src"), _path(row_path, "src"), maximum=512)
                quote = self.string(
                    row.get("quote"), _path(row_path, "quote"), maximum=2400, multiline=True
                )
                if status == "gap":
                    if src != "" or quote != "":
                        self.add(
                            "provenance.gap-shape",
                            row_path,
                            "gap source and quote must both be empty",
                        )
                elif status in {"verified", "inferred"} and (
                    not src or SOURCE_RE.fullmatch(src) is None or not quote
                ):
                    self.add(
                        "provenance.citation-shape",
                        row_path,
                        "verified/inferred requires path:L-L source and nonempty quote",
                    )
                code_claim = self.code_claims.get(claim_id or "")
                if code_claim is not None:
                    code_path, code_text = code_claim
                    if status != "verified":
                        self.add(
                            "code.provenance-status",
                            _path(row_path, "status"),
                            "code excerpts require verified provenance",
                        )
                    if quote != code_text:
                        self.add(
                            "code.quote-mismatch",
                            code_path,
                            "code text must exactly equal its provenance quote",
                        )
        referenced = set(self.claim_refs)
        declared = set(provenance_ids)
        if referenced != declared:
            missing = sorted(referenced - declared)
            unused = sorted(declared - referenced)
            parts = []
            if missing:
                parts.append("missing rows: " + ", ".join(missing))
            if unused:
                parts.append("unreferenced rows: " + ", ".join(unused))
            self.add("claim.parity", path, "; ".join(parts))

    def gaps(self, value: Any, path: str, provenance: Any) -> None:
        rows = self.array(value, path, 0, 64)
        if rows is not None:
            for index, row_value in enumerate(rows):
                row_path = _path(path, index)
                row = self.obj(row_value, row_path, {"topic", "checked", "action"})
                if row is None:
                    continue
                for key in ("topic", "checked", "action"):
                    self.localized(row.get(key), _path(row_path, key), 800)
        has_provenance_gap = isinstance(provenance, list) and any(
            isinstance(row, dict) and row.get("status") == "gap" for row in provenance
        )
        has_gap_rows = isinstance(rows, list) and bool(rows)
        if has_provenance_gap and not has_gap_rows:
            self.add(
                "gap.parity", path, "a provenance gap requires at least one structured gap row"
            )


def validate_structure(data: object, expected_slug: str | None = None) -> list[SchemaIssue]:
    """Return all structural and cross-reference issues in stable traversal order."""

    try:
        nodes, chars = _measure(data)
    except ContractJSONError as exc:
        return [SchemaIssue(exc.code, "$", str(exc))]
    issues: list[SchemaIssue] = []
    if nodes > MAX_NODES:
        issues.append(
            SchemaIssue("json.nodes", "$", f"JSON contains {nodes} nodes; maximum is {MAX_NODES}")
        )
    if chars > MAX_STRING_CHARS:
        issues.append(
            SchemaIssue(
                "json.string-budget",
                "$",
                f"JSON contains {chars} string characters; maximum is {MAX_STRING_CHARS}",
            )
        )
    issues.extend(_Checker(expected_slug).run(data))
    return issues


def parse_source(value: str) -> tuple[str, int, int] | None:
    """Split a syntactically valid ``relative/path:L-L`` citation."""

    match = SOURCE_RE.fullmatch(value)
    if match is None:
        return None
    first_text, last_text = match["first"], match["last"]
    if len(first_text) > 18 or len(last_text) > 18:
        return None
    first, last = int(first_text), int(last_text)
    if last < first or last - first > 400:
        return None
    return match["path"], first, last


__all__ = [
    "ContractJSONError",
    "DuplicateKeyError",
    "SchemaIssue",
    "canonical_json",
    "loads_strict",
    "parse_source",
    "validate_structure",
]
