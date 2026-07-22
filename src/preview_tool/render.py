"""Deterministic compiler from validated preview data to the trusted UI bundle."""

from __future__ import annotations

import base64
import hashlib
import html
import json
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from .schema import canonical_json

PLACEHOLDERS = (
    "THEME_CLASS",
    "DOCUMENT_TITLE",
    "STYLE_HASH",
    "THEME_HASH",
    "SCRIPT_HASH",
    "BODY_CONTENT",
    "PREVIEW_DATA",
)

ITEM_STATUS_LABELS = {
    "neutral": {"ja": "情報", "en": "Info"},
    "current": {"ja": "現在", "en": "Current"},
    "planned": {"ja": "計画", "en": "Planned"},
    "done": {"ja": "完了", "en": "Done"},
    "blocked": {"ja": "停止中", "en": "Blocked"},
    "gap": {"ja": "要確認", "en": "Gap"},
}
PROVENANCE_STATUS_LABELS = {
    "verified": {"ja": "根拠確認済み", "en": "Verified"},
    "inferred": {"ja": "推論", "en": "Inferred"},
    "gap": {"ja": "根拠未確認", "en": "Evidence gap"},
}


class RenderError(ValueError):
    pass


def _e(value: object) -> str:
    return html.escape(str(value), quote=True)


def _loc(value: Mapping[str, str], tag: str = "span", css: str = "") -> str:
    class_attr = f' class="{_e(css)}"' if css else ""
    return (
        f"<{tag}{class_attr} data-i18n>"
        f'<span lang="ja">{_e(value["ja"])}</span>'
        f'<span lang="en">{_e(value["en"])}</span>'
        f"</{tag}>"
    )


def _claim_badge(claim_id: str, statuses: Mapping[str, str]) -> str:
    if not claim_id or claim_id not in statuses:
        return ""
    status = statuses[claim_id]
    return (
        f'<span class="claim-status" data-evidence-status="{_e(status)}">'
        + _loc(PROVENANCE_STATUS_LABELS[status])
        + "</span>"
    )


def _item(item: Mapping[str, Any], statuses: Mapping[str, str], *, metric: bool = False) -> str:
    claim = f' data-claim-id="{_e(item["claim_id"])}"' if item["claim_id"] else ""
    classes = "metric" if metric else "item"
    progress = (
        f'<progress max="100" value="{int(item["magnitude"])}">{int(item["magnitude"])}%</progress>'
        if metric and int(item["magnitude"]) > 0
        else ""
    )
    label_class = "metric-label" if metric else "item__label"
    value_class = "metric-value" if metric else "item__value"
    detail_class = "metric-note" if metric else "item__detail"
    status = (
        '<div class="item__meta">'
        + _loc(ITEM_STATUS_LABELS[item["status"]], "span", "item__status")
        + _claim_badge(item["claim_id"], statuses)
        + "</div>"
    )
    return (
        f'<div class="{classes}" data-item="{_e(item["id"])}" '
        f'data-status="{_e(item["status"])}"{claim}>'
        + _loc(item["label"], "p", label_class)
        + status
        + _loc(item["value"], "p", value_class)
        + progress
        + _loc(item["detail"], "p", detail_class)
        + "</div>"
    )


def _items(component: Mapping[str, Any], statuses: Mapping[str, str]) -> str:
    kind = component["kind"]
    rows: Sequence[Mapping[str, Any]] = component["items"]
    if kind == "metrics":
        return (
            '<div class="metrics">'
            + "".join(_item(row, statuses, metric=True) for row in rows)
            + "</div>"
        )
    wrapper = {
        "facts": "facts",
        "steps": "steps",
        "comparison": "split-grid comparison",
        "evidence": "evidence-list",
        "roadmap": "roadmap",
    }.get(kind, "facts")
    return f'<div class="{wrapper}">' + "".join(_item(row, statuses) for row in rows) + "</div>"


def _component(component: Mapping[str, Any], statuses: Mapping[str, str]) -> str:
    kind = component["kind"]
    head = (
        f'<article class="panel component--{_e(kind)}" data-component="{_e(component["id"])}" '
        f'data-tour="{_e(component["id"])}" data-tone="{_e(component["tone"])}">'
        + _loc(component["title"], "h3", "panel__title")
        + _loc(component["body"], "p", "panel__body")
    )
    if kind == "code":
        code = component["code"]
        content = (
            f'<div class="code-panel" data-claim-id="{_e(code["claim_id"])}">'
            '<div class="code-panel__meta">'
            f'<p class="code-panel__language">{_e(code["language"])}</p>'
            + _claim_badge(code["claim_id"], statuses)
            + "</div>"
            f"<pre><code>{_e(code['text'])}</code></pre></div>"
        )
    elif kind == "demo":
        demo = component["demo"]
        content = (
            '<div class="demo">'
            f'<button class="button button--accent demo-button" type="button" '
            f'data-demo-trigger="{_e(component["id"])}" '
            f'aria-controls="preview-demo-{_e(component["id"])}" '
            'aria-expanded="false">'
            + _loc(demo["button"])
            + "</button>"
            + '<p class="demo__running" data-demo-running role="status" hidden>'
            + _loc(demo["running"])
            + "</p>"
            + f'<section class="demo-result" id="preview-demo-{_e(component["id"])}" '
            f'data-demo-result="{_e(component["id"])}" aria-live="polite" hidden>'
            + _loc(demo["result_title"], "h4", "demo-result__title")
            + _loc(demo["result_body"], "p", "demo-result__body")
            + '<div class="facts demo-result__facts">'
            + "".join(_item(row, statuses) for row in component["items"])
            + "</div></section></div>"
        )
    else:
        content = _items(component, statuses)
    return head + content + "</article>"


def _body(data: Mapping[str, Any]) -> str:
    dashboard = data["dashboard"]
    project = dashboard["project"]
    statuses = {row["id"]: row["status"] for row in data["provenance"]}
    nav = []
    sections = []
    for index, view in enumerate(dashboard["views"]):
        selected = "true" if index == 0 else "false"
        hidden = "" if index == 0 else " hidden"
        tab_index = "0" if index == 0 else "-1"
        nav.append(
            f'<button class="view-link" id="preview-tab-{_e(view["id"])}" type="button" role="tab" '
            f'data-view-target="{_e(view["id"])}" aria-controls="preview-view-{_e(view["id"])}" '
            f'aria-selected="{selected}" tabindex="{tab_index}">'
            + _loc(view["label"])
            + "</button>"
        )
        sections.append(
            f'<section class="view view--{_e(view["kind"])}" id="preview-view-{_e(view["id"])}" '
            f'data-view="{_e(view["id"])}" role="tabpanel" '
            f'aria-labelledby="preview-tab-{_e(view["id"])}" tabindex="0"{hidden}>'
            '<header class="view-intro">'
            + _loc(view["title"], "h2")
            + _loc(view["summary"], "p")
            + '</header><div class="component-grid">'
            + "".join(_component(component, statuses) for component in view["components"])
            + "</div></section>"
        )
    return (
        f'<div class="app-shell" data-preview-project="{_e(project["slug"])}" '
        'data-tour="app-shell">'
        '<div class="dashboard"><header class="project-header" data-tour="project-header">'
        '<div class="brand">'
        + _loc(project["eyebrow"], "p", "eyebrow")
        + _loc(project["name"], "h1")
        + _loc(project["tagline"], "p", "tagline")
        + '</div><div class="header-actions">'
        '<div class="locale-switcher" data-tour="language-switcher" role="group" '
        'aria-label="Language / 言語">'
        '<button type="button" data-locale-target="ja" lang="ja" '
        'aria-pressed="true">日本語</button>'
        '<button type="button" data-locale-target="en" lang="en" '
        'aria-pressed="false">English</button></div>'
        '<button class="button button--accent" type="button" data-tour-start '
        'data-tour="tour-start" data-i18n>'
        '<span lang="ja">ツアーを開始</span><span lang="en">Start tour</span>'
        "</button></div></header>"
        '<aside class="sidebar">'
        '<section class="project-card">'
        + _loc(project["summary"], "p")
        + '<div class="project-status-row" data-tour="project-status">'
        f'<div class="status-badge" data-tone="{_e(project["status"]["tone"])}" '
        f'data-claim-id="{_e(project["status"]["claim_id"])}">'
        + _loc(project["status"]["label"])
        + "</div>"
        + _claim_badge(project["status"]["claim_id"], statuses)
        + '</div></section><nav class="example-nav" data-tour="view-nav" role="tablist" '
        'aria-orientation="vertical" aria-label="Views / ビュー">'
        + "".join(nav)
        + '</nav></aside><main class="workspace" id="preview-main" tabindex="-1">'
        + "".join(sections)
        + "</main></div></div>"
    )


def _inline_json(value: object) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")
    )
    return (
        encoded.replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def _digest(content: bytes) -> str:
    return base64.b64encode(hashlib.sha256(content).digest()).decode("ascii")


def _markdown_text(value: str) -> str:
    return re.sub(r"([\\`*_{}\[\]<>#+.!|\-])", r"\\\1", value)


def _gaps(rows: Sequence[Mapping[str, Mapping[str, str]]]) -> bytes:
    lines = ["# Gaps / ギャップ", ""]
    if not rows:
        lines.extend(["No gaps.", "", "ギャップはありません。", ""])
    else:
        labels = (
            ("topic", "Topic / トピック"),
            ("checked", "Checked / 確認済み"),
            ("action", "Action / 対応"),
        )
        for number, row in enumerate(rows, 1):
            lines.extend([f"## Gap {number} / ギャップ {number}", ""])
            for key, label in labels:
                lines.extend(
                    [
                        f"- {label}",
                        f"  - JA: {_markdown_text(row[key]['ja'])}",
                        f"  - EN: {_markdown_text(row[key]['en'])}",
                    ]
                )
            lines.append("")
    return "\n".join(lines).encode("utf-8")


def _template(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise RenderError(f"cannot read template {path.name}: {exc}") from exc


def compiled_files(data: Mapping[str, Any], template_dir: Path) -> dict[str, bytes]:
    """Compile all files derived from ``preview.json``; never writes to disk."""

    template_dir = Path(template_dir)
    template = _template(template_dir / "index.html")
    try:
        styles = (template_dir / "styles.css").read_bytes()
        theme = (template_dir / "theme.css").read_bytes()
        app = (template_dir / "app.js").read_bytes()
    except OSError as exc:
        raise RenderError(f"cannot read canonical runtime: {exc}") from exc
    for name in PLACEHOLDERS:
        marker = "{{" + name + "}}"
        if template.count(marker) != 1:
            raise RenderError(f"template placeholder {marker} must occur exactly once")
    project = data["dashboard"]["project"]
    tour = data["dashboard"]["tour"]
    preview_data = {
        "version": 1,
        "controls": tour["controls"],
        "steps": tour["steps"],
    }
    replacements = {
        "THEME_CLASS": f"theme-{project['theme']} font-{project['font']}",
        "DOCUMENT_TITLE": _e(f"{project['name']['ja']} / {project['name']['en']}"),
        "STYLE_HASH": _digest(styles),
        "THEME_HASH": _digest(theme),
        "SCRIPT_HASH": _digest(app),
        "BODY_CONTENT": _body(data),
        "PREVIEW_DATA": _inline_json(preview_data),
    }
    placeholder_pattern = re.compile(
        r"\{\{(" + "|".join(re.escape(name) for name in PLACEHOLDERS) + r")\}\}"
    )
    template = placeholder_pattern.sub(lambda match: replacements[match.group(1)], template)
    return {
        "index.html": template.encode("utf-8"),
        "styles.css": styles,
        "theme.css": theme,
        "app.js": app,
        "provenance.json": canonical_json(data["provenance"]),
        "gaps.md": _gaps(data["gaps"]),
    }


__all__ = ["RenderError", "compiled_files"]
