import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { basename, join } from "node:path"

import { canonicalJson } from "./json.ts"
import type {
  Gap,
  ItemStatus,
  Localized,
  PreviewComponent,
  PreviewItem,
  PreviewModel,
  Provenance,
  ProvenanceStatus,
} from "./model.ts"

export class RenderError extends Error {}

const placeholders = [
  "THEME_CLASS",
  "DOCUMENT_TITLE",
  "STYLE_HASH",
  "THEME_HASH",
  "SCRIPT_HASH",
  "BODY_CONTENT",
  "PREVIEW_DATA",
] as const

const itemStatusLabels: Record<ItemStatus, Localized> = {
  blocked: { en: "Blocked", ja: "停止中" },
  current: { en: "Current", ja: "現在" },
  done: { en: "Done", ja: "完了" },
  gap: { en: "Gap", ja: "要確認" },
  neutral: { en: "Info", ja: "情報" },
  planned: { en: "Planned", ja: "計画" },
}

const provenanceStatusLabels: Record<ProvenanceStatus, Localized> = {
  gap: { en: "Evidence gap", ja: "根拠未確認" },
  inferred: { en: "Inferred", ja: "根拠から推論" },
  verified: { en: "Source matched", ja: "出典一致" },
}

const provenanceStatusDescriptions: Record<ProvenanceStatus, Localized> = {
  gap: {
    en: "This claim has no source citation. Review the global open questions below for checked scope and next actions.",
    ja: "この主張には出典がありません。下の未解決事項で確認範囲と次の対応を確認してください。",
  },
  inferred: {
    en: "The author marked this entry as an interpretation of the cited text. The source may not state the same conclusion directly.",
    ja: "引用箇所に基づく解釈として作成者が明示した項目です。出典が同じ結論を直接述べているとは限りません。",
  },
  verified: {
    en: "The quoted text was found in the declared source range. This does not independently establish truth or freshness.",
    ja: "引用文字列が指定された出典範囲で見つかりました。内容の真実性や現在性を独立して保証するものではありません。",
  },
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;")
}

function localized(value: Localized, tag = "span", css = "", id = ""): string {
  const classAttribute = css ? ` class="${escapeHtml(css)}"` : ""
  const idAttribute = id ? ` id="${escapeHtml(id)}"` : ""
  return `<${tag}${idAttribute}${classAttribute} data-i18n><span lang="ja">${escapeHtml(value.ja)}</span><span lang="en">${escapeHtml(value.en)}</span></${tag}>`
}

function claimBadge(claimId: string, evidence: ReadonlyMap<string, Provenance>): string {
  const row = evidence.get(claimId)
  if (!row) return ""
  const label = {
    en: `Review evidence: ${row.claim.en} — Status:`,
    ja: `根拠を確認：${row.claim.ja} — 状態：`,
  }
  return `<button class="claim-status" type="button" data-evidence-status="${escapeHtml(row.status)}" data-evidence-open="${escapeHtml(claimId)}" aria-haspopup="dialog" aria-controls="preview-evidence-drawer">${localized(label, "span", "sr-only")}${localized(provenanceStatusLabels[row.status])}<span class="claim-status__mark" aria-hidden="true">↗</span></button>`
}

function evidenceLauncher(total: number, css = ""): string {
  const classes = `button evidence-launcher${css ? ` ${css}` : ""}`
  const label =
    css === "evidence-launcher--header"
      ? { en: "Evidence", ja: "根拠" }
      : { en: "Review evidence", ja: "根拠を確認" }
  return `<button class="${escapeHtml(classes)}" type="button" data-evidence-launch aria-haspopup="dialog" aria-controls="preview-evidence-drawer"><span class="evidence-launcher__mark" aria-hidden="true"></span>${localized(label)}<span class="evidence-launcher__count">${total}</span></button>`
}

function statusCounts(rows: readonly Provenance[]): Record<ProvenanceStatus, number> {
  return {
    gap: rows.filter((row) => row.status === "gap").length,
    inferred: rows.filter((row) => row.status === "inferred").length,
    verified: rows.filter((row) => row.status === "verified").length,
  }
}

function evidenceOverview(rows: readonly Provenance[]): string {
  const counts = statusCounts(rows)
  const statuses: ProvenanceStatus[] = ["verified", "inferred", "gap"]
  return `<section class="evidence-overview"><div class="evidence-overview__heading">${localized({ en: "Evidence ledger", ja: "根拠台帳" }, "h2")}<span aria-hidden="true">${String(rows.length).padStart(2, "0")}</span></div><div class="evidence-overview__counts">${statuses.map((status) => `<span data-provenance-status="${status}"><strong>${counts[status]}</strong>${localized(provenanceStatusLabels[status])}</span>`).join("")}</div>${evidenceLauncher(rows.length, "evidence-launcher--sidebar")}</section>`
}

function evidenceDetail(row: Provenance, active: boolean): string {
  const citation =
    row.status === "gap"
      ? `<div class="evidence-detail__missing">${localized(
          {
            en: "No source range or matched excerpt is attached to this entry.",
            ja: "この項目には出典範囲と一致した抜粋がありません。",
          },
          "p",
        )}</div>`
      : `<div class="evidence-citation">${localized({ en: "Source range", ja: "出典範囲" }, "p", "evidence-field-label")}<code class="evidence-citation__source">${escapeHtml(row.src)}</code>${localized({ en: "Matched excerpt", ja: "一致した抜粋" }, "p", "evidence-field-label")}<blockquote class="evidence-citation__quote">${escapeHtml(row.quote)}</blockquote></div>`
  const headingId = `preview-evidence-claim-${row.id}`
  return `<article class="evidence-detail" id="preview-evidence-${escapeHtml(row.id)}" tabindex="0" aria-labelledby="${escapeHtml(headingId)}" data-evidence-detail="${escapeHtml(row.id)}" data-provenance-status="${escapeHtml(row.status)}"${active ? "" : " hidden"}><header class="evidence-detail__meta"><span class="evidence-kind" data-provenance-status="${escapeHtml(row.status)}">${localized(provenanceStatusLabels[row.status])}</span><code>#${escapeHtml(row.id)}</code></header>${localized(row.claim, "h3", "evidence-detail__claim", headingId)}${localized(provenanceStatusDescriptions[row.status], "p", "evidence-detail__meaning")}${citation}</article>`
}

function gapLedger(gaps: readonly Gap[]): string {
  const body =
    gaps.length === 0
      ? `<div class="gap-ledger__empty">${localized(
          {
            en: "No structured open questions are recorded. The evidence ledger still requires human review.",
            ja: "構造化された未解決事項はありません。根拠台帳の内容は引き続き人がレビューしてください。",
          },
          "p",
        )}</div>`
      : `<ol class="gap-list">${gaps
          .map(
            (row, index) =>
              `<li class="gap-entry" data-gap-entry><span class="gap-entry__index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>${localized(row.topic, "h4")}<dl><div><dt>${localized({ en: "Checked", ja: "確認済み" })}</dt><dd>${localized(row.checked)}</dd></div><div><dt>${localized({ en: "Next action", ja: "次の対応" })}</dt><dd>${localized(row.action)}</dd></div></dl></li>`,
          )
          .join("")}</ol>`
  return `<section class="gap-ledger" data-gap-ledger><header><div>${localized({ en: "Open questions", ja: "未解決事項" }, "h3")}${localized(
    {
      en: "Open questions apply to the ledger as a whole; they are not mapped one-to-one to individual claims.",
      ja: "未解決事項は台帳全体に対する記録です。個別の主張との一対一対応は示しません。",
    },
    "p",
  )}</div><span class="gap-ledger__count">${String(gaps.length).padStart(2, "0")}</span></header>${body}</section>`
}

function evidenceDrawer(data: PreviewModel): string {
  const counts = statusCounts(data.provenance)
  const rows = data.provenance
    .map(
      (row, index) =>
        `<button class="evidence-row" type="button" data-evidence-select="${escapeHtml(row.id)}" data-provenance-status="${escapeHtml(row.status)}" aria-controls="preview-evidence-${escapeHtml(row.id)}" aria-pressed="${index === 0}"><span class="evidence-row__status" aria-hidden="true"></span><span class="evidence-row__copy">${localized(row.claim, "span", "evidence-row__claim")}<span class="evidence-row__meta">${localized(provenanceStatusLabels[row.status], "span", "evidence-row__kind")}<code>#${escapeHtml(row.id)}</code></span></span></button>`,
    )
    .join("")
  const details = data.provenance.map((row, index) => evidenceDetail(row, index === 0)).join("")
  const empty = rows
    ? ""
    : `<div class="evidence-ledger__empty">${localized({ en: "No evidence entries are available.", ja: "根拠行はありません。" }, "p")}</div>`
  const filters: ReadonlyArray<[string, Localized, number]> = [
    ["all", { en: "All", ja: "すべて" }, data.provenance.length],
    ["verified", provenanceStatusLabels.verified, counts.verified],
    ["inferred", provenanceStatusLabels.inferred, counts.inferred],
    ["gap", provenanceStatusLabels.gap, counts.gap],
  ]
  return `<div class="evidence-layer" data-evidence-layer hidden><div class="evidence-scrim" data-evidence-dismiss aria-hidden="true"></div><aside class="evidence-drawer" id="preview-evidence-drawer" data-evidence-drawer role="dialog" aria-modal="true" aria-labelledby="preview-evidence-title" tabindex="-1"><header class="evidence-drawer__header"><div>${localized({ en: "Evidence review", ja: "根拠レビュー" }, "p", "eyebrow")}${localized({ en: "Trace the evidence", ja: "根拠をたどる" }, "h2", "", "preview-evidence-title")}${localized(
    {
      en: "Inspect each claim and status, plus its source range and matched excerpt when present. A source match is not a guarantee of truth or freshness.",
      ja: "各主張と状態、存在する場合は出典範囲と一致した抜粋を同じ画面で確認できます。出典一致は真実性や現在性の保証ではありません。",
    },
    "p",
    "evidence-drawer__intro",
  )}</div><button class="icon-button evidence-close" type="button" data-evidence-close aria-labelledby="preview-evidence-close-label"><span aria-hidden="true">×</span><span class="sr-only" id="preview-evidence-close-label" data-i18n><span lang="ja">根拠レビューを閉じる</span><span lang="en">Close evidence review</span></span></button></header><div class="evidence-drawer__body"><div class="evidence-ledger"><div class="evidence-filters" role="group" aria-labelledby="preview-evidence-filters-label">${localized({ en: "Evidence filters", ja: "根拠フィルター" }, "span", "sr-only", "preview-evidence-filters-label")}${filters.map(([status, label, count]) => `<button type="button" data-evidence-filter="${status}" aria-pressed="${status === "all"}">${localized(label)}<strong>${count}</strong></button>`).join("")}</div><div class="evidence-rows" data-evidence-rows>${rows}${empty}<p class="evidence-filter-empty" data-evidence-filter-empty hidden data-i18n><span lang="ja">この種類の根拠はありません。</span><span lang="en">No evidence entries match this filter.</span></p></div><footer class="evidence-ledger__links">${localized({ en: "Machine-readable data", ja: "機械可読データ" }, "p")}<a href="provenance.json">provenance.json</a><a href="gaps.md">gaps.md</a></footer></div><div class="evidence-review">${details}${gapLedger(data.gaps)}</div></div></aside></div>`
}

function item(row: PreviewItem, evidence: ReadonlyMap<string, Provenance>, metric = false): string {
  const claim = row.claim_id ? ` data-claim-id="${escapeHtml(row.claim_id)}"` : ""
  const classes = metric ? "metric" : "item"
  const progress =
    metric && row.magnitude > 0
      ? `<progress max="100" value="${row.magnitude}">${row.magnitude}%</progress>`
      : ""
  const status = `<div class="item__meta">${localized(itemStatusLabels[row.status], "span", "item__status")}${claimBadge(row.claim_id, evidence)}</div>`
  return `<div class="${classes}" data-item="${escapeHtml(row.id)}" data-status="${escapeHtml(row.status)}"${claim}>${localized(row.label, "p", metric ? "metric-label" : "item__label")}${status}${localized(row.value, "p", metric ? "metric-value" : "item__value")}${progress}${localized(row.detail, "p", metric ? "metric-note" : "item__detail")}</div>`
}

function items(component: PreviewComponent, evidence: ReadonlyMap<string, Provenance>): string {
  if (component.kind === "metrics") {
    return `<div class="metrics">${component.items.map((row) => item(row, evidence, true)).join("")}</div>`
  }
  const wrappers: Partial<Record<PreviewComponent["kind"], string>> = {
    comparison: "split-grid comparison",
    evidence: "evidence-list",
    facts: "facts",
    roadmap: "roadmap",
    steps: "steps",
  }
  const wrapper = wrappers[component.kind] ?? "facts"
  return `<div class="${wrapper}">${component.items.map((row) => item(row, evidence)).join("")}</div>`
}

function component(row: PreviewComponent, evidence: ReadonlyMap<string, Provenance>): string {
  const head = `<article class="panel component--${escapeHtml(row.kind)}" data-component="${escapeHtml(row.id)}" data-tour="${escapeHtml(row.id)}" data-tone="${escapeHtml(row.tone)}">${localized(row.title, "h3", "panel__title")}${localized(row.body, "p", "panel__body")}`
  let content: string
  if (row.kind === "code") {
    content = `<div class="code-panel" data-claim-id="${escapeHtml(row.code.claim_id)}"><div class="code-panel__meta"><p class="code-panel__language">${escapeHtml(row.code.language)}</p>${claimBadge(row.code.claim_id, evidence)}</div><pre><code>${escapeHtml(row.code.text)}</code></pre></div>`
  } else if (row.kind === "demo") {
    content = `<div class="demo"><button class="button button--accent demo-button" type="button" data-demo-trigger="${escapeHtml(row.id)}" aria-controls="preview-demo-${escapeHtml(row.id)}" aria-expanded="false">${localized(row.demo.button)}</button><p class="demo__running" data-demo-running role="status" hidden>${localized(row.demo.running)}</p><section class="demo-result" id="preview-demo-${escapeHtml(row.id)}" data-demo-result="${escapeHtml(row.id)}" aria-live="polite" hidden>${localized(row.demo.result_title, "h4", "demo-result__title")}${localized(row.demo.result_body, "p", "demo-result__body")}<div class="facts demo-result__facts">${row.items.map((entry) => item(entry, evidence)).join("")}</div></section></div>`
  } else content = items(row, evidence)
  return `${head}${content}</article>`
}

function body(data: PreviewModel): string {
  const project = data.dashboard.project
  const evidence = new Map(data.provenance.map((row) => [row.id, row]))
  const nav: string[] = []
  const sections: string[] = []
  for (const [index, view] of data.dashboard.views.entries()) {
    const selected = index === 0
    nav.push(
      `<button class="view-link" id="preview-tab-${escapeHtml(view.id)}" type="button" role="tab" data-view-target="${escapeHtml(view.id)}" aria-controls="preview-view-${escapeHtml(view.id)}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}"><span class="view-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>${localized(view.label)}</button>`,
    )
    sections.push(
      `<section class="view view--${escapeHtml(view.kind)}" id="preview-view-${escapeHtml(view.id)}" data-view="${escapeHtml(view.id)}" role="tabpanel" aria-labelledby="preview-tab-${escapeHtml(view.id)}" tabindex="0"${selected ? "" : " hidden"}><header class="view-intro" data-view-index="${String(index + 1).padStart(2, "0")}">${localized(view.title, "h2")}${localized(view.summary, "p")}</header><div class="component-grid">${view.components.map((row) => component(row, evidence)).join("")}</div></section>`,
    )
  }
  return `<div class="app-shell" data-preview-project="${escapeHtml(project.slug)}" data-tour="app-shell"><div class="dashboard"><header class="project-header" data-tour="project-header"><div class="brand">${localized(project.eyebrow, "p", "eyebrow")}${localized(project.name, "h1")}${localized(project.tagline, "p", "tagline")}</div><div class="header-actions"><div class="locale-switcher" data-tour="language-switcher" role="group" aria-label="Language / 言語"><button type="button" data-locale-target="ja" lang="ja" aria-pressed="true">日本語</button><button type="button" data-locale-target="en" lang="en" aria-pressed="false">English</button></div>${evidenceLauncher(data.provenance.length, "evidence-launcher--header")}<button class="button button--accent" type="button" data-tour-start data-tour="tour-start" data-i18n><span lang="ja">ツアーを開始</span><span lang="en">Start tour</span></button></div></header><aside class="sidebar"><section class="project-card">${localized(project.summary, "p")}<div class="project-status-row" data-tour="project-status"><div class="status-badge" data-tone="${escapeHtml(project.status.tone)}" data-claim-id="${escapeHtml(project.status.claim_id)}">${localized(project.status.label)}</div>${claimBadge(project.status.claim_id, evidence)}</div></section>${evidenceOverview(data.provenance)}<nav class="example-nav" data-tour="view-nav" role="tablist" aria-orientation="vertical" aria-label="Views / ビュー">${nav.join("")}</nav></aside><main class="workspace" id="preview-main" tabindex="-1">${sections.join("")}</main></div></div>${evidenceDrawer(data)}`
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, sortValue(child)]),
    )
  }
  return value
}

function inlineJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")
}

function digest(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("base64")
}

function markdownText(value: string): string {
  return value.replace(/[\\`*_{}[\]<>#+.!|-]/g, "\\$&")
}

function gapsMarkdown(rows: readonly Gap[]): Uint8Array {
  const lines = ["# Gaps / ギャップ", ""]
  if (rows.length === 0) lines.push("No gaps.", "", "ギャップはありません。", "")
  else {
    const labels: ReadonlyArray<[keyof Gap, string]> = [
      ["topic", "Topic / トピック"],
      ["checked", "Checked / 確認済み"],
      ["action", "Action / 対応"],
    ]
    for (const [index, row] of rows.entries()) {
      lines.push(`## Gap ${index + 1} / ギャップ ${index + 1}`, "")
      for (const [key, label] of labels) {
        lines.push(
          `- ${label}`,
          `  - JA: ${markdownText(row[key].ja)}`,
          `  - EN: ${markdownText(row[key].en)}`,
        )
      }
      lines.push("")
    }
  }
  return Buffer.from(lines.join("\n"), "utf8")
}

function template(path: string): string {
  try {
    return readFileSync(path, "utf8")
  } catch (error) {
    throw new RenderError(`cannot read template ${basename(path)}: ${String(error)}`)
  }
}

export function compiledFiles(
  data: PreviewModel,
  templateDirectory: string,
): Record<string, Uint8Array> {
  let document = template(join(templateDirectory, "index.html"))
  let styles: Uint8Array
  let theme: Uint8Array
  let app: Uint8Array
  try {
    styles = readFileSync(join(templateDirectory, "styles.css"))
    theme = readFileSync(join(templateDirectory, "theme.css"))
    app = readFileSync(join(templateDirectory, "app.js"))
  } catch (error) {
    throw new RenderError(`cannot read canonical runtime: ${String(error)}`)
  }
  for (const name of placeholders) {
    const marker = `{{${name}}}`
    if (document.split(marker).length !== 2) {
      throw new RenderError(`template placeholder ${marker} must occur exactly once`)
    }
  }
  const project = data.dashboard.project
  const title =
    project.name.ja === project.name.en
      ? project.name.ja
      : `${project.name.ja} / ${project.name.en}`
  const replacements: Record<(typeof placeholders)[number], string> = {
    BODY_CONTENT: body(data),
    DOCUMENT_TITLE: escapeHtml(title),
    PREVIEW_DATA: inlineJson({
      controls: data.dashboard.tour.controls,
      steps: data.dashboard.tour.steps,
      version: 1,
    }),
    SCRIPT_HASH: digest(app),
    STYLE_HASH: digest(styles),
    THEME_CLASS: `theme-${project.theme} font-${project.font}`,
    THEME_HASH: digest(theme),
  }
  for (const name of placeholders) document = document.replace(`{{${name}}}`, replacements[name])
  return {
    "app.js": app,
    "gaps.md": gapsMarkdown(data.gaps),
    "index.html": Buffer.from(document, "utf8"),
    "provenance.json": canonicalJson(data.provenance),
    "styles.css": styles,
    "theme.css": theme,
  }
}
