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
    "verified": {"ja": "出典一致", "en": "Source matched"},
    "inferred": {"ja": "根拠から推論", "en": "Inferred"},
    "gap": {"ja": "根拠未確認", "en": "Evidence gap"},
}
PROVENANCE_STATUS_DESCRIPTIONS = {
    "verified": {
        "ja": "引用文字列が指定された出典範囲で見つかりました。内容の真実性や現在性を独立して保証するものではありません。",
        "en": "The quoted text was found in the declared source range. This does not independently establish truth or freshness.",
    },
    "inferred": {
        "ja": "引用箇所に基づく解釈として作成者が明示した項目です。出典が同じ結論を直接述べているとは限りません。",
        "en": "The author marked this entry as an interpretation of the cited text. The source may not state the same conclusion directly.",
    },
    "gap": {
        "ja": "この主張には出典がありません。下の未解決事項で確認範囲と次の対応を確認してください。",
        "en": "This claim has no source citation. Review the global open questions below for checked scope and next actions.",
    },
}


class RenderError(ValueError):
    pass


def _e(value: object) -> str:
    return html.escape(str(value), quote=True)


def _loc(
    value: Mapping[str, str], tag: str = "span", css: str = "", element_id: str = ""
) -> str:
    class_attr = f' class="{_e(css)}"' if css else ""
    id_attr = f' id="{_e(element_id)}"' if element_id else ""
    return (
        f"<{tag}{id_attr}{class_attr} data-i18n>"
        f'<span lang="ja">{_e(value["ja"])}</span>'
        f'<span lang="en">{_e(value["en"])}</span>'
        f"</{tag}>"
    )


def _claim_badge(claim_id: str, evidence: Mapping[str, Mapping[str, Any]]) -> str:
    if not claim_id or claim_id not in evidence:
        return ""
    row = evidence[claim_id]
    status = row["status"]
    accessible_label = {
        "ja": f'根拠を確認：{row["claim"]["ja"]} — 状態：',
        "en": f'Review evidence: {row["claim"]["en"]} — Status:',
    }
    return (
        f'<button class="claim-status" type="button" data-evidence-status="{_e(status)}" '
        f'data-evidence-open="{_e(claim_id)}" aria-haspopup="dialog" '
        'aria-controls="preview-evidence-drawer">'
        + _loc(accessible_label, css="sr-only")
        + _loc(PROVENANCE_STATUS_LABELS[status])
        + '<span class="claim-status__mark" aria-hidden="true">↗</span></button>'
    )


def _evidence_launcher(total: int, css: str = "") -> str:
    classes = "button evidence-launcher" + (f" {css}" if css else "")
    label = (
        {"ja": "根拠", "en": "Evidence"}
        if css == "evidence-launcher--header"
        else {"ja": "根拠を確認", "en": "Review evidence"}
    )
    return (
        f'<button class="{_e(classes)}" type="button" data-evidence-launch '
        'aria-haspopup="dialog" aria-controls="preview-evidence-drawer">'
        '<span class="evidence-launcher__mark" aria-hidden="true"></span>'
        + _loc(label)
        + f'<span class="evidence-launcher__count">{total}</span></button>'
    )


def _evidence_overview(provenance: Sequence[Mapping[str, Any]]) -> str:
    counts = {
        status: sum(row["status"] == status for row in provenance)
        for status in ("verified", "inferred", "gap")
    }
    return (
        '<section class="evidence-overview">'
        '<div class="evidence-overview__heading">'
        + _loc({"ja": "根拠台帳", "en": "Evidence ledger"}, "h2")
        + f'<span aria-hidden="true">{len(provenance):02d}</span></div>'
        '<div class="evidence-overview__counts">'
        + "".join(
            f'<span data-provenance-status="{status}"><strong>{counts[status]}</strong>'
            + _loc(PROVENANCE_STATUS_LABELS[status])
            + "</span>"
            for status in ("verified", "inferred", "gap")
        )
        + "</div>"
        + _evidence_launcher(len(provenance), "evidence-launcher--sidebar")
        + "</section>"
    )


def _evidence_detail(row: Mapping[str, Any], *, active: bool) -> str:
    status = row["status"]
    hidden = "" if active else " hidden"
    if status == "gap":
        citation = (
            '<div class="evidence-detail__missing">'
            + _loc(
                {
                    "ja": "この項目には出典範囲と一致した抜粋がありません。",
                    "en": "No source range or matched excerpt is attached to this entry.",
                },
                "p",
            )
            + "</div>"
        )
    else:
        citation = (
            '<div class="evidence-citation">'
            + _loc({"ja": "出典範囲", "en": "Source range"}, "p", "evidence-field-label")
            + f'<code class="evidence-citation__source">{_e(row["src"])}</code>'
            + _loc(
                {"ja": "一致した抜粋", "en": "Matched excerpt"},
                "p",
                "evidence-field-label",
            )
            + f'<blockquote class="evidence-citation__quote">{_e(row["quote"])}</blockquote>'
            + "</div>"
        )
    claim_heading_id = f'preview-evidence-claim-{row["id"]}'
    return (
        f'<article class="evidence-detail" id="preview-evidence-{_e(row["id"])}" tabindex="0" '
        f'aria-labelledby="{_e(claim_heading_id)}" '
        f'data-evidence-detail="{_e(row["id"])}" data-provenance-status="{_e(status)}"{hidden}>'
        '<header class="evidence-detail__meta">'
        f'<span class="evidence-kind" data-provenance-status="{_e(status)}">'
        + _loc(PROVENANCE_STATUS_LABELS[status])
        + f'</span><code>#{_e(row["id"])}</code></header>'
        + _loc(row["claim"], "h3", "evidence-detail__claim", claim_heading_id)
        + _loc(PROVENANCE_STATUS_DESCRIPTIONS[status], "p", "evidence-detail__meaning")
        + citation
        + "</article>"
    )


def _gap_ledger(gaps: Sequence[Mapping[str, Any]]) -> str:
    if gaps:
        entries = []
        for index, row in enumerate(gaps, 1):
            entries.append(
                f'<li class="gap-entry" data-gap-entry><span class="gap-entry__index" '
                f'aria-hidden="true">{index:02d}</span>'
                + _loc(row["topic"], "h4")
                + '<dl><div><dt>'
                + _loc({"ja": "確認済み", "en": "Checked"})
                + "</dt><dd>"
                + _loc(row["checked"])
                + "</dd></div><div><dt>"
                + _loc({"ja": "次の対応", "en": "Next action"})
                + "</dt><dd>"
                + _loc(row["action"])
                + "</dd></div></dl></li>"
            )
        body = '<ol class="gap-list">' + "".join(entries) + "</ol>"
    else:
        body = (
            '<div class="gap-ledger__empty">'
            + _loc(
                {
                    "ja": "構造化された未解決事項はありません。根拠台帳の内容は引き続き人がレビューしてください。",
                    "en": "No structured open questions are recorded. The evidence ledger still requires human review.",
                },
                "p",
            )
            + "</div>"
        )
    return (
        '<section class="gap-ledger" data-gap-ledger>'
        '<header><div>'
        + _loc({"ja": "未解決事項", "en": "Open questions"}, "h3")
        + _loc(
            {
                "ja": "未解決事項は台帳全体に対する記録です。個別の主張との一対一対応は示しません。",
                "en": "Open questions apply to the ledger as a whole; they are not mapped one-to-one to individual claims.",
            },
            "p",
        )
        + f'</div><span class="gap-ledger__count">{len(gaps):02d}</span></header>'
        + body
        + "</section>"
    )


def _evidence_drawer(data: Mapping[str, Any]) -> str:
    provenance: Sequence[Mapping[str, Any]] = data["provenance"]
    gaps: Sequence[Mapping[str, Any]] = data["gaps"]
    counts = {
        status: sum(row["status"] == status for row in provenance)
        for status in ("verified", "inferred", "gap")
    }
    rows = []
    details = []
    for index, row in enumerate(provenance):
        status = row["status"]
        selected = index == 0
        rows.append(
            f'<button class="evidence-row" type="button" data-evidence-select="{_e(row["id"])}" '
            f'data-provenance-status="{_e(status)}" aria-controls="preview-evidence-{_e(row["id"])}" '
            f'aria-pressed="{str(selected).lower()}">'
            f'<span class="evidence-row__status" aria-hidden="true"></span>'
            '<span class="evidence-row__copy">'
            + _loc(row["claim"], "span", "evidence-row__claim")
            + '<span class="evidence-row__meta">'
            + _loc(PROVENANCE_STATUS_LABELS[status], "span", "evidence-row__kind")
            + f'<code>#{_e(row["id"])}</code></span></span></button>'
        )
        details.append(_evidence_detail(row, active=selected))
    empty = "" if rows else (
        '<div class="evidence-ledger__empty">'
        + _loc(
            {"ja": "根拠行はありません。", "en": "No evidence entries are available."}, "p"
        )
        + "</div>"
    )
    filters = [("all", {"ja": "すべて", "en": "All"}, len(provenance))] + [
        (status, PROVENANCE_STATUS_LABELS[status], counts[status])
        for status in ("verified", "inferred", "gap")
    ]
    return (
        '<div class="evidence-layer" data-evidence-layer hidden>'
        '<div class="evidence-scrim" data-evidence-dismiss aria-hidden="true"></div>'
        '<aside class="evidence-drawer" id="preview-evidence-drawer" data-evidence-drawer '
        'role="dialog" aria-modal="true" '
        'aria-labelledby="preview-evidence-title" tabindex="-1">'
        '<header class="evidence-drawer__header"><div>'
        + _loc({"ja": "根拠レビュー", "en": "Evidence review"}, "p", "eyebrow")
        + _loc(
            {"ja": "根拠をたどる", "en": "Trace the evidence"},
            "h2",
            element_id="preview-evidence-title",
        )
        + _loc(
            {
                "ja": "各主張と状態、存在する場合は出典範囲と一致した抜粋を同じ画面で確認できます。出典一致は真実性や現在性の保証ではありません。",
                "en": "Inspect each claim and status, plus its source range and matched excerpt when present. A source match is not a guarantee of truth or freshness.",
            },
            "p",
            "evidence-drawer__intro",
        )
        + '</div><button class="icon-button evidence-close" type="button" data-evidence-close '
        'aria-labelledby="preview-evidence-close-label"><span aria-hidden="true">×</span>'
        '<span class="sr-only" id="preview-evidence-close-label" data-i18n>'
        '<span lang="ja">根拠レビューを閉じる</span><span lang="en">Close evidence review</span>'
        "</span></button></header>"
        '<div class="evidence-drawer__body"><div class="evidence-ledger">'
        '<div class="evidence-filters" role="group" '
        'aria-labelledby="preview-evidence-filters-label">'
        + _loc(
            {"ja": "根拠フィルター", "en": "Evidence filters"},
            "span",
            "sr-only",
            "preview-evidence-filters-label",
        )
        + "".join(
            f'<button type="button" data-evidence-filter="{status}" '
            f'aria-pressed="{str(status == "all").lower()}">'
            + _loc(label)
            + f"<strong>{count}</strong></button>"
            for status, label, count in filters
        )
        + '</div><div class="evidence-rows" data-evidence-rows>'
        + "".join(rows)
        + empty
        + '<p class="evidence-filter-empty" data-evidence-filter-empty hidden data-i18n>'
        '<span lang="ja">この種類の根拠はありません。</span>'
        '<span lang="en">No evidence entries match this filter.</span></p></div>'
        '<footer class="evidence-ledger__links">'
        + _loc({"ja": "機械可読データ", "en": "Machine-readable data"}, "p")
        + '<a href="provenance.json">provenance.json</a><a href="gaps.md">gaps.md</a>'
        + "</footer></div>"
        '<div class="evidence-review">'
        + "".join(details)
        + _gap_ledger(gaps)
        + "</div></div></aside></div>"
    )


def _item(
    item: Mapping[str, Any], evidence: Mapping[str, Mapping[str, Any]], *, metric: bool = False
) -> str:
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
        + _claim_badge(item["claim_id"], evidence)
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


def _items(component: Mapping[str, Any], evidence: Mapping[str, Mapping[str, Any]]) -> str:
    kind = component["kind"]
    rows: Sequence[Mapping[str, Any]] = component["items"]
    if kind == "metrics":
        return (
            '<div class="metrics">'
            + "".join(_item(row, evidence, metric=True) for row in rows)
            + "</div>"
        )
    wrapper = {
        "facts": "facts",
        "steps": "steps",
        "comparison": "split-grid comparison",
        "evidence": "evidence-list",
        "roadmap": "roadmap",
    }.get(kind, "facts")
    return f'<div class="{wrapper}">' + "".join(_item(row, evidence) for row in rows) + "</div>"


def _component(component: Mapping[str, Any], evidence: Mapping[str, Mapping[str, Any]]) -> str:
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
            + _claim_badge(code["claim_id"], evidence)
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
            + "".join(_item(row, evidence) for row in component["items"])
            + "</div></section></div>"
        )
    else:
        content = _items(component, evidence)
    return head + content + "</article>"


def _body(data: Mapping[str, Any]) -> str:
    dashboard = data["dashboard"]
    project = dashboard["project"]
    provenance: Sequence[Mapping[str, Any]] = data["provenance"]
    evidence = {row["id"]: row for row in provenance}
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
            f'<span class="view-index" aria-hidden="true">{index + 1:02d}</span>'
            + _loc(view["label"])
            + "</button>"
        )
        sections.append(
            f'<section class="view view--{_e(view["kind"])}" id="preview-view-{_e(view["id"])}" '
            f'data-view="{_e(view["id"])}" role="tabpanel" '
            f'aria-labelledby="preview-tab-{_e(view["id"])}" tabindex="0"{hidden}>'
            f'<header class="view-intro" data-view-index="{index + 1:02d}">'
            + _loc(view["title"], "h2")
            + _loc(view["summary"], "p")
            + '</header><div class="component-grid">'
            + "".join(_component(component, evidence) for component in view["components"])
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
        + _evidence_launcher(len(provenance), "evidence-launcher--header")
        + '<button class="button button--accent" type="button" data-tour-start '
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
        + _claim_badge(project["status"]["claim_id"], evidence)
        + "</div></section>"
        + _evidence_overview(provenance)
        + '<nav class="example-nav" data-tour="view-nav" role="tablist" '
        'aria-orientation="vertical" aria-label="Views / ビュー">'
        + "".join(nav)
        + '</nav></aside><main class="workspace" id="preview-main" tabindex="-1">'
        + "".join(sections)
        + "</main></div></div>"
        + _evidence_drawer(data)
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
    project_names = project["name"]
    document_title = (
        project_names["ja"]
        if project_names["ja"] == project_names["en"]
        else f"{project_names['ja']} / {project_names['en']}"
    )
    preview_data = {
        "version": 1,
        "controls": tour["controls"],
        "steps": tour["steps"],
    }
    replacements = {
        "THEME_CLASS": f"theme-{project['theme']} font-{project['font']}",
        "DOCUMENT_TITLE": _e(document_title),
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
