from __future__ import annotations

import copy
import html
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from preview_tool.render import compiled_files
from preview_tool.schema import (
    ContractJSONError,
    DuplicateKeyError,
    canonical_json,
    loads_strict,
    validate_structure,
)
from preview_tool.validation import validate_bundle, validate_model


def loc(text: str) -> dict[str, str]:
    return {"ja": f"日-{text}", "en": f"EN-{text}"}


EMPTY = {"ja": "", "en": ""}


def item(name: str, claim: str) -> dict[str, object]:
    return {
        "id": f"{name}-item",
        "label": loc(f"{name} label"),
        "value": loc(f"{name} value"),
        "detail": loc(f"{name} detail"),
        "status": "current",
        "magnitude": 60,
        "claim_id": claim,
    }


def component(name: str, kind: str, claim: str) -> dict[str, object]:
    demo = (
        {
            "button": loc("run"),
            "running": loc("running"),
            "result_title": loc("result"),
            "result_body": loc("result body"),
        }
        if kind == "demo"
        else {key: dict(EMPTY) for key in ("button", "running", "result_title", "result_body")}
    )
    return {
        "id": f"{name}-card",
        "kind": kind,
        "title": loc(f"{name} title"),
        "body": loc(f"{name} body"),
        "tone": "neutral",
        "items": [item(name, claim)],
        "code": {"language": "", "text": "", "claim_id": ""},
        "demo": demo,
    }


def gap(name: str) -> dict[str, dict[str, str]]:
    return {key: loc(f"{name} {key}") for key in ("topic", "checked", "action")}


def valid_data(slug: str = "sample") -> dict[str, object]:
    controls = {key: loc(key) for key in ("next", "back", "done", "close")}
    targets = [
        ("intro-step", "", "", ""),
        ("header-step", "project-header", "", ""),
        ("overview-step", "overview-card", "overview", ""),
        ("demo-step", "demo-card", "example", ""),
        ("state-step", "state-card", "state", ""),
        ("result-step", "", "example", "demo-card"),
        ("status-step", "project-status", "", ""),
        ("nav-step", "view-nav", "", ""),
    ]
    steps = [
        {
            "id": ident,
            "title": loc(ident),
            "body": loc(f"{ident} body"),
            "target": target,
            "view": view,
            "reveal": reveal,
        }
        for ident, target, view, reveal in targets
    ]
    views = [
        {
            "id": "overview",
            "kind": "overview",
            "label": loc("overview"),
            "title": loc("overview title"),
            "summary": loc("overview summary"),
            "components": [component("overview", "facts", "overview-claim")],
        },
        {
            "id": "example",
            "kind": "example",
            "label": loc("example"),
            "title": loc("example title"),
            "summary": loc("example summary"),
            "components": [component("demo", "demo", "demo-claim")],
        },
        {
            "id": "state",
            "kind": "state",
            "label": loc("state"),
            "title": loc("state title"),
            "summary": loc("state summary"),
            "components": [component("state", "roadmap", "state-claim")],
        },
    ]
    claims = (
        ("status-claim", "Status evidence", 1),
        ("overview-claim", "Overview evidence", 2),
        ("demo-claim", "Demo evidence", 3),
        ("state-claim", "State evidence", 4),
    )
    return {
        "dashboard": {
            "schema_version": 1,
            "project": {
                "slug": slug,
                "name": loc("sample"),
                "eyebrow": loc("work in progress"),
                "tagline": loc("example dashboard"),
                "summary": loc("project summary"),
                "status": {"label": loc("active"), "tone": "positive", "claim_id": "status-claim"},
                "theme": "indigo",
                "font": "humanist",
            },
            "views": views,
            "tour": {"controls": controls, "steps": steps},
        },
        "provenance": [
            {
                "id": ident,
                "claim": loc(ident),
                "status": "verified",
                "src": f"source.txt:{line}-{line}",
                "quote": quote,
            }
            for ident, quote, line in claims
        ],
        "gaps": [],
    }


def write_templates(root: Path) -> None:
    template = "|".join(
        "{{" + key + "}}"
        for key in (
            "THEME_CLASS",
            "DOCUMENT_TITLE",
            "STYLE_HASH",
            "THEME_HASH",
            "SCRIPT_HASH",
            "BODY_CONTENT",
            "PREVIEW_DATA",
        )
    )
    (root / "index.html").write_text(template, encoding="utf-8")
    (root / "styles.css").write_bytes(b"styles\n")
    (root / "theme.css").write_bytes(b"theme\n")
    (root / "app.js").write_bytes(b"app\n")


class ContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        self.artifacts = self.root / "artifacts"
        self.templates = self.root / "templates"
        self.source.mkdir()
        self.artifacts.mkdir()
        self.templates.mkdir()
        (self.source / "source.txt").write_text(
            "Status evidence\nOverview evidence\nDemo evidence\nState evidence\n", encoding="utf-8"
        )
        write_templates(self.templates)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def report(self, data: object, slug: str = "sample"):
        return validate_model(canonical_json(data), slug, self.source, self.artifacts)

    def codes(self, data: object) -> set[str]:
        return {finding.code for finding in self.report(data).findings}

    def test_valid_model_and_unicode_slug(self) -> None:
        self.assertTrue(self.report(valid_data()).ok)
        self.assertTrue(self.report(valid_data("研究 preview"), "研究 preview").ok)

    def test_duplicate_key_rejected(self) -> None:
        with self.assertRaises(DuplicateKeyError):
            loads_strict('{"dashboard":{},"dashboard":{},"provenance":[],"gaps":[]}')

    def test_nonfinite_and_pathological_integers_are_rejected(self) -> None:
        with self.assertRaises(ContractJSONError) as nonfinite:
            loads_strict('{"value":1e400}')
        self.assertEqual(nonfinite.exception.code, "json.nonfinite")
        with self.assertRaises(ContractJSONError) as huge_integer:
            loads_strict('{"value":' + ("9" * 5000) + "}")
        self.assertEqual(huge_integer.exception.code, "json.integer-range")
        with self.assertRaises(ContractJSONError) as surrogate:
            loads_strict('{"value":"\\ud800"}')
        self.assertEqual(surrogate.exception.code, "json.surrogate")
        with self.assertRaises(ContractJSONError) as actual_surrogate:
            loads_strict('{"value":"' + "\ud800" + '"}')
        self.assertEqual(actual_surrogate.exception.code, "json.surrogate")

    def test_model_schema_types_every_enum_and_const(self) -> None:
        schema_path = (
            Path(__file__).resolve().parents[1] / "templates" / "author-output.schema.json"
        )
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        missing: list[str] = []

        def visit(value: object, path: str = "$") -> None:
            if isinstance(value, dict):
                if ("enum" in value or "const" in value) and "type" not in value:
                    missing.append(path)
                for key, child in value.items():
                    visit(child, f"{path}.{key}")
            elif isinstance(value, list):
                for index, child in enumerate(value):
                    visit(child, f"{path}.{index}")

        visit(schema)
        self.assertEqual(missing, [])

    def test_locale_id_tour_and_claim_failures(self) -> None:
        data = valid_data()
        del data["dashboard"]["project"]["name"]["en"]  # type: ignore[index]
        self.assertIn("schema.keys", self.codes(data))
        data = valid_data()
        data["dashboard"]["views"][0]["id"] = "Bad ID"  # type: ignore[index]
        self.assertIn("id.format", self.codes(data))
        data = valid_data()
        data["dashboard"]["views"][0]["components"][0]["id"] = "project-status"  # type: ignore[index]
        self.assertIn("id.reserved", self.codes(data))
        data = valid_data()
        data["dashboard"]["tour"]["steps"][5]["reveal"] = "missing-demo"  # type: ignore[index]
        self.assertIn("tour.reveal", self.codes(data))
        data = valid_data()
        data["dashboard"]["views"][0]["kind"] = "example"  # type: ignore[index]
        data["dashboard"]["views"][1]["kind"] = "overview"  # type: ignore[index]
        self.assertIn("demo.example.missing", self.codes(data))
        self.assertIn("tour.demo-example.missing", self.codes(data))
        data = valid_data()
        state_step = data["dashboard"]["tour"]["steps"][4]  # type: ignore[index]
        state_step.update({"target": "project-status", "view": ""})
        self.assertIn("tour.state.missing", self.codes(data))
        data = valid_data()
        data["provenance"].pop()  # type: ignore[union-attr]
        self.assertIn("claim.parity", self.codes(data))
        data = valid_data()
        data["provenance"][0]["status"] = []  # type: ignore[index]
        report = self.report(data)
        self.assertFalse(report.ok)
        self.assertIn("schema.type", {finding.code for finding in report.findings})

    def test_stateful_items_and_code_excerpts_require_exact_evidence(self) -> None:
        data = valid_data()
        data["dashboard"]["views"][0]["components"][0]["items"][0]["claim_id"] = ""  # type: ignore[index]
        self.assertIn("item.claim-required", self.codes(data))
        item = data["dashboard"]["views"][0]["components"][0]["items"][0]  # type: ignore[index]
        item.update({"status": "neutral", "magnitude": 100})
        self.assertIn("item.magnitude-claim", self.codes(data))

        data = valid_data()
        card = data["dashboard"]["views"][0]["components"][0]  # type: ignore[index]
        card.update(
            {
                "kind": "code",
                "items": [],
                "code": {
                    "language": "sh",
                    "text": "sudo exfiltrate-secrets",
                    "claim_id": "overview-claim",
                },
            }
        )
        self.assertIn("code.quote-mismatch", self.codes(data))
        card["code"]["text"] = "Overview evidence"
        report = self.report(data)
        self.assertTrue(report.ok, report.format())

    def test_traversal_symlink_and_quote_failures(self) -> None:
        data = valid_data()
        data["provenance"][0]["src"] = "../outside.txt:1-1"  # type: ignore[index]
        self.assertIn("citation.traversal", self.codes(data))
        data = valid_data()
        data["provenance"][0]["quote"] = "fabricated"  # type: ignore[index]
        self.assertIn("citation.quote", self.codes(data))
        outside = self.root / "outside.txt"
        outside.write_text("Status evidence\n", encoding="utf-8")
        (self.source / "escape.txt").symlink_to(outside)
        data = valid_data()
        data["provenance"][0]["src"] = "escape.txt:1-1"  # type: ignore[index]
        self.assertIn("citation.escape", self.codes(data))

    def test_git_large_source_and_secret_are_blocked(self) -> None:
        git_dir = self.source / ".git"
        git_dir.mkdir()
        (git_dir / "meta").write_text("Status evidence\n", encoding="utf-8")
        data = valid_data()
        data["provenance"][0]["src"] = ".git/meta:1-1"  # type: ignore[index]
        self.assertIn("citation.git-internal", self.codes(data))
        (self.source / "git-alias").symlink_to(git_dir, target_is_directory=True)
        data = valid_data()
        data["provenance"][0]["src"] = "git-alias/meta:L1-L1"  # type: ignore[index]
        self.assertIn("citation.git-internal", self.codes(data))
        large = self.source / "large.txt"
        with large.open("wb") as stream:
            stream.truncate(8 * 1024 * 1024 + 1)
        data = valid_data()
        data["provenance"][0]["src"] = "large.txt:1-1"  # type: ignore[index]
        self.assertIn("citation.size", self.codes(data))
        data = valid_data()
        data["dashboard"]["project"]["summary"]["en"] = "token AKIA1234567890ABCDEF"  # type: ignore[index]
        self.assertIn("secret.detected", self.codes(data))

    def test_repeated_citations_read_each_source_once(self) -> None:
        from preview_tool import validation as validation_module

        original = validation_module.read_bounded_regular
        source_reads = 0

        def tracked(path: Path, maximum: int) -> bytes:
            nonlocal source_reads
            if path == self.source / "source.txt":
                source_reads += 1
            return original(path, maximum)

        with mock.patch("preview_tool.validation.read_bounded_regular", tracked):
            report = self.report(valid_data())
        self.assertTrue(report.ok, report.format())
        self.assertEqual(source_reads, 1)

    def test_invalid_sources_consume_the_aggregate_read_budget(self) -> None:
        from preview_tool import validation as validation_module

        data = valid_data()
        for index, row in enumerate(data["provenance"]):
            filename = f"binary-{index}.txt"
            (self.source / filename).write_bytes(b"\xff\n")
            row["src"] = f"{filename}:1-1"
        original = validation_module.read_bounded_regular
        source_reads = 0

        def tracked(path: Path, maximum: int) -> bytes:
            nonlocal source_reads
            if path.parent == self.source:
                source_reads += 1
            return original(path, maximum)

        with (
            mock.patch("preview_tool.validation.MAX_SOURCE_TOTAL_BYTES", 3),
            mock.patch("preview_tool.validation.read_bounded_regular", tracked),
        ):
            report = self.report(data)
        self.assertIn("citation.total-size", {finding.code for finding in report.findings})
        self.assertEqual(source_reads, 1)

    def test_citation_path_and_line_edge_cases_become_findings(self) -> None:
        data = valid_data()
        data["provenance"][0]["src"] = "nul\0name:1-1"  # type: ignore[index]
        report = self.report(data)
        self.assertFalse(report.ok)
        self.assertIn("citation.missing", {finding.code for finding in report.findings})

        (self.source / "crlf.txt").write_bytes(b"first\r\nsecond\n")
        data = valid_data()
        data["provenance"][0].update(  # type: ignore[index]
            {"src": "crlf.txt:1-1", "quote": "first\n"}
        )
        self.assertIn("citation.quote", self.codes(data))

        (self.source / "separator.txt").write_text("first\u2028second\n", encoding="utf-8")
        data = valid_data()
        data["provenance"][0].update(  # type: ignore[index]
            {"src": "separator.txt:2-2", "quote": "second"}
        )
        self.assertIn("citation.lines", self.codes(data))

        data = valid_data()
        data["provenance"][0]["src"] = "source.txt:L" + ("9" * 5000) + "-L1"  # type: ignore[index]
        report = self.report(data)
        self.assertFalse(report.ok)
        self.assertIn("citation.syntax", {finding.code for finding in report.findings})

    def test_report_escapes_terminal_controls_from_unknown_keys(self) -> None:
        data = valid_data()
        data["dashboard"]["project"]["bad\x1b]8;;https://evil\x07key"] = "x"  # type: ignore[index]
        formatted = self.report(data).format()
        self.assertNotIn("\x1b", formatted)
        self.assertNotIn("\x07", formatted)
        self.assertIn("\\u001b", formatted)

    def test_render_escapes_html_and_inline_script_terminator(self) -> None:
        data = valid_data()
        data["dashboard"]["project"]["name"]["ja"] = '<b title="x">bad</b>'  # type: ignore[index]
        data["dashboard"]["tour"]["steps"][0]["body"]["en"] = "</script><img>"  # type: ignore[index]
        outputs = compiled_files(data, self.templates)
        page = outputs["index.html"].decode()
        self.assertIn("&lt;b title=&quot;x&quot;&gt;", page)
        self.assertNotIn("</script><img>", page)
        self.assertIn(r"\u003c/script\u003e\u003cimg\u003e", page)

    def test_render_is_deterministic(self) -> None:
        data = valid_data()
        data["provenance"][1].update({"status": "gap", "src": "", "quote": ""})  # type: ignore[index]
        data["gaps"] = [gap("deterministic")]
        self.assertEqual(
            compiled_files(data, self.templates),
            compiled_files(copy.deepcopy(data), self.templates),
        )

    def test_render_does_not_reprocess_placeholder_text(self) -> None:
        data = valid_data()
        data["dashboard"]["project"]["summary"]["en"] = "literal {{PREVIEW_DATA}} token"  # type: ignore[index]
        page = compiled_files(data, self.templates)["index.html"].decode("utf-8")
        self.assertIn("literal {{PREVIEW_DATA}} token", page)
        self.assertEqual(page.count('"version":1'), 1)

    def test_every_claim_renders_its_evidence_status(self) -> None:
        data = valid_data()
        outputs = compiled_files(data, self.templates)
        page = outputs["index.html"].decode("utf-8")
        self.assertEqual(page.count('data-evidence-status="verified"'), 4)
        data["provenance"][1].update({"status": "gap", "src": "", "quote": ""})  # type: ignore[index]
        data["gaps"] = [
            {
                "topic": loc("evidence"),
                "checked": loc("source"),
                "action": loc("confirm"),
            }
        ]
        report = self.report(data)
        self.assertTrue(report.ok, report.format())
        page = compiled_files(data, self.templates)["index.html"].decode("utf-8")
        self.assertIn('data-status="current"', page)
        self.assertIn('data-evidence-status="gap"', page)

    def test_evidence_inspector_has_one_trigger_select_and_detail_per_claim(self) -> None:
        data = valid_data()
        data["provenance"][1]["status"] = "inferred"  # type: ignore[index]
        data["provenance"][2].update({"status": "gap", "src": "", "quote": ""})  # type: ignore[index]
        page = compiled_files(data, self.templates)["index.html"].decode("utf-8")
        provenance = data["provenance"]

        self.assertEqual(page.count("data-evidence-open="), len(provenance))
        self.assertEqual(page.count("data-evidence-select="), len(provenance))
        self.assertEqual(page.count("data-evidence-detail="), len(provenance))
        self.assertEqual(page.count('id="preview-evidence-drawer"'), 1)
        self.assertEqual(page.count('id="preview-evidence-title"'), 1)
        self.assertIn('aria-labelledby="preview-evidence-title"', page)
        status_labels = {
            "verified": ("Source matched", "出典一致"),
            "inferred": ("Inferred", "根拠から推論"),
            "gap": ("Evidence gap", "根拠未確認"),
        }
        for row in provenance:
            claim_id = row["id"]
            trigger = f'data-evidence-open="{claim_id}"'
            self.assertEqual(page.count(trigger), 1)
            trigger_offset = page.index(trigger)
            trigger_start = page.rfind("<", 0, trigger_offset)
            self.assertTrue(page.startswith("<button", trigger_start))
            trigger_markup = page[trigger_start : page.index("</button>", trigger_offset)]
            self.assertEqual(page.count(f'data-evidence-select="{claim_id}"'), 1)
            self.assertEqual(page.count(f'data-evidence-detail="{claim_id}"'), 1)
            detail_offset = page.index(f'data-evidence-detail="{claim_id}"')
            detail_start = page.rfind("<article", 0, detail_offset)
            detail_open = page[detail_start : page.index(">", detail_offset)]
            self.assertIn('tabindex="0"', detail_open)
            self.assertEqual(page.count(f'id="preview-evidence-claim-{claim_id}"'), 1)
            self.assertIn(f'aria-labelledby="preview-evidence-claim-{claim_id}"', page)
            row_offset = page.index(f'data-evidence-select="{claim_id}"')
            row_start = page.rfind("<button", 0, row_offset)
            row_markup = page[row_start : page.index("</button>", row_offset)]
            for label in status_labels[row["status"]]:
                self.assertIn(label, row_markup)
            self.assertIn(
                html.escape(f'Review evidence: {row["claim"]["en"]} — Status:', quote=True),
                trigger_markup,
            )
            self.assertIn(
                html.escape(f'根拠を確認：{row["claim"]["ja"]} — 状態：', quote=True),
                trigger_markup,
            )

    def test_evidence_inspector_escapes_localized_claim_source_and_quote(self) -> None:
        data = valid_data()
        row = data["provenance"][0]  # type: ignore[index]
        row["claim"] = {
            "ja": '主張 <確認> & "引用"',
            "en": 'Claim <checked> & "quoted"',
        }
        row["src"] = 'src/<module>&"name".py:L1-L2'
        row["quote"] = '<tag attr="value">& exact evidence</tag>'

        page = compiled_files(data, self.templates)["index.html"].decode("utf-8")
        for value in (*row["claim"].values(), row["src"], row["quote"]):
            self.assertIn(html.escape(value, quote=True), page)
            self.assertNotIn(value, page)

    def test_evidence_inspector_renders_structured_gap_entries(self) -> None:
        data = valid_data()
        data["provenance"][1].update({"status": "gap", "src": "", "quote": ""})  # type: ignore[index]
        data["gaps"] = [gap("first"), gap("second")]

        page = compiled_files(data, self.templates)["index.html"].decode("utf-8")
        self.assertEqual(page.count("data-gap-entry"), 2)
        for row in data["gaps"]:
            self.assertEqual(set(row), {"topic", "checked", "action"})
            for field in ("topic", "checked", "action"):
                for value in row[field].values():
                    self.assertIn(html.escape(value, quote=True), page)

    def test_evidence_inspector_renders_empty_gap_ledger_state(self) -> None:
        page = compiled_files(valid_data(), self.templates)["index.html"].decode("utf-8")
        self.assertNotIn("data-gap-entry", page)
        self.assertIn("No structured open questions are recorded.", page)
        self.assertIn("構造化された未解決事項はありません。", page)

    def test_closed_bundle_and_exact_derived_bytes(self) -> None:
        data = valid_data()
        bundle = self.artifacts / "sample"
        bundle.mkdir()
        (bundle / "preview.json").write_bytes(canonical_json(data))
        for name, content in compiled_files(data, self.templates).items():
            (bundle / name).write_bytes(content)
        report = validate_bundle(bundle, "sample", self.source, self.artifacts, self.templates)
        self.assertTrue(report.ok, report.format())
        (bundle / "styles.css").write_bytes(b"tampered")
        report = validate_bundle(bundle, "sample", self.source, self.artifacts, self.templates)
        self.assertIn("bundle.derived-mismatch", {finding.code for finding in report.findings})
        (bundle / "extra").mkdir()
        report = validate_bundle(bundle, "sample", self.source, self.artifacts, self.templates)
        self.assertIn("bundle.entries", {finding.code for finding in report.findings})
        self.assertIn("bundle.entry-kind", {finding.code for finding in report.findings})

    def test_tracked_canary_matches_canonical_compiler(self) -> None:
        repository = Path(__file__).resolve().parents[1]
        bundle = repository / "previews" / "lean-cds"
        data = loads_strict((bundle / "preview.json").read_bytes())
        self.assertEqual(validate_structure(data, "lean-cds"), [])
        for name, content in compiled_files(data, repository / "templates").items():
            with self.subTest(name=name):
                self.assertEqual((bundle / name).read_bytes(), content)

    def test_tracked_browser_model_is_validator_clean(self) -> None:
        repository = Path(__file__).resolve().parents[1]
        model_dir = repository / "testdata" / "valid"
        source = repository / "testdata" / "source"
        raw = (model_dir / "preview.json").read_bytes()
        data = loads_strict(raw)

        self.assertEqual(canonical_json(data), raw)
        self.assertEqual(validate_structure(data, "sample"), [])
        self.assertGreaterEqual(len(data["provenance"]), 2)
        self.assertEqual(
            {row["status"] for row in data["provenance"]},
            {"verified", "inferred", "gap"},
        )
        report = validate_model(raw, "sample", source, repository / "previews")
        self.assertTrue(report.ok, report.format())

    def test_malformed_bundle_surrogate_is_reported_without_crashing(self) -> None:
        bundle = self.artifacts / "sample"
        bundle.mkdir()
        (bundle / "preview.json").write_bytes(b'{"extra":"\\ud800"}\n')
        report = validate_bundle(bundle, "sample", self.source, self.artifacts, self.templates)
        self.assertFalse(report.ok)
        self.assertIn("json.surrogate", {finding.code for finding in report.findings})


if __name__ == "__main__":
    unittest.main()
