import { readFileSync } from "node:fs"

import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js"

import type { ComponentKind, Localized, PreviewComponent, PreviewModel, ViewKind } from "./model.ts"

export type SchemaIssue = { code: string; message: string; path: string }

const sourcePattern = /^(?<path>[^:\r\n]+):L?(?<first>[1-9][0-9]*)-L?(?<last>[1-9][0-9]*)$/
const markupPattern = /<[^>\r\n]{1,200}>/
const urlPattern = /(?:[a-z][a-z0-9+.-]*:\/\/|(?:mailto|tel|data|javascript):|www\.)/i
const bidiControls = new Set([
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
])
const shellAnchors = new Set([
  "app-shell",
  "project-header",
  "view-nav",
  "project-status",
  "language-switcher",
  "tour-start",
])

const schema = JSON.parse(
  readFileSync(new URL("../templates/author-output.schema.json", import.meta.url), "utf8"),
) as object
const ajv = new Ajv2020({ allErrors: true, strict: true })
const validateAuthorOutput = ajv.compile(schema)

function pointerPath(pointer: string): string {
  if (!pointer) return "$"
  return `$${pointer.replaceAll("~1", "/").replaceAll("~0", "~").replaceAll("/", ".")}`
}

function ajvIssue(error: ErrorObject): SchemaIssue {
  let path = pointerPath(error.instancePath)
  if (error.keyword === "required" && typeof error.params.missingProperty === "string") {
    path += `.${error.params.missingProperty}`
  }
  return {
    code: `schema.${error.keyword}`,
    message: error.message ?? "schema validation failed",
    path,
  }
}

class SemanticChecker {
  readonly issues: SchemaIssue[] = []
  readonly uiIds = new Map<string, string>()
  readonly claimRefs = new Map<string, string>()
  readonly codeClaims = new Map<string, { path: string; text: string }>()

  constructor(readonly expectedSlug?: string) {}

  add(code: string, path: string, message: string): void {
    this.issues.push({ code, message, path })
  }

  string(value: string, path: string, minimum: number, maximum: number, multiline = false): void {
    if (value.length < minimum || value.length > maximum || (minimum > 0 && value.trim() === "")) {
      this.add("schema.length", path, `must contain ${minimum}..${maximum} useful characters`)
    }
    for (const character of value) {
      const point = character.codePointAt(0)!
      if (bidiControls.has(point)) {
        this.add(
          "text.bidi",
          path,
          `contains bidi control U+${point.toString(16).padStart(4, "0").toUpperCase()}`,
        )
        break
      }
      const allowedSpace = multiline && ["\t", "\n", "\r"].includes(character)
      if (
        (!allowedSpace && /\p{Cc}/u.test(character)) ||
        /[\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(character)
      ) {
        this.add(
          "text.control",
          path,
          `contains forbidden U+${point.toString(16).padStart(4, "0").toUpperCase()}`,
        )
        break
      }
    }
  }

  localized(value: Localized, path: string, maximum: number, empty = false): void {
    for (const locale of ["ja", "en"] as const) {
      const text = value[locale]
      const localePath = `${path}.${locale}`
      this.string(text, localePath, empty ? 0 : 1, maximum)
      if (text && markupPattern.test(text)) {
        this.add("text.markup", localePath, "localized text must not contain HTML-like tags")
      }
      if (text && urlPattern.test(text)) {
        this.add("text.url", localePath, "localized text must not contain URLs")
      }
    }
  }

  uniqueUiId(value: string, path: string): void {
    const prior = this.uiIds.get(value)
    if (prior) this.add("id.duplicate", path, `duplicates ${prior}`)
    else this.uiIds.set(value, path)
  }

  claimRef(value: string, path: string): void {
    if (!value) return
    const prior = this.claimRefs.get(value)
    if (prior) this.add("claim.duplicate-reference", path, `also referenced at ${prior}`)
    else this.claimRefs.set(value, path)
  }

  run(data: PreviewModel): SchemaIssue[] {
    const project = data.dashboard.project
    if (this.expectedSlug !== undefined && project.slug !== this.expectedSlug) {
      this.add(
        "slug.mismatch",
        "$.dashboard.project.slug",
        `expected ${JSON.stringify(this.expectedSlug)}`,
      )
    }
    this.string(project.slug, "$.dashboard.project.slug", 1, 128)
    this.localized(project.name, "$.dashboard.project.name", 120)
    this.localized(project.eyebrow, "$.dashboard.project.eyebrow", 80)
    this.localized(project.tagline, "$.dashboard.project.tagline", 240)
    this.localized(project.summary, "$.dashboard.project.summary", 1200)
    this.localized(project.status.label, "$.dashboard.project.status.label", 80)
    this.claimRef(project.status.claim_id, "$.dashboard.project.status.claim_id")

    const viewKinds = new Set<ViewKind>()
    const viewIds = new Map<string, ViewKind>()
    const components = new Map<string, { kind: ComponentKind; view: string }>()
    for (const [viewIndex, view] of data.dashboard.views.entries()) {
      const path = `$.dashboard.views.${viewIndex}`
      this.uniqueUiId(view.id, `${path}.id`)
      viewIds.set(view.id, view.kind)
      viewKinds.add(view.kind)
      this.localized(view.label, `${path}.label`, 80)
      this.localized(view.title, `${path}.title`, 160)
      this.localized(view.summary, `${path}.summary`, 800)
      for (const [componentIndex, component] of view.components.entries()) {
        const componentPath = `${path}.components.${componentIndex}`
        this.component(component, componentPath)
        components.set(component.id, { kind: component.kind, view: view.id })
      }
    }
    const missingKinds = (["overview", "example", "state"] as const).filter(
      (kind) => !viewKinds.has(kind),
    )
    if (missingKinds.length > 0) {
      this.add("view.kind.missing", "$.dashboard.views", `must include: ${missingKinds.join(", ")}`)
    }
    const exampleDemo = [...components.values()].some(
      (component) => component.kind === "demo" && viewIds.get(component.view) === "example",
    )
    if (!exampleDemo) {
      this.add(
        "demo.example.missing",
        "$.dashboard.views",
        "at least one demo component must belong to an example view",
      )
    }
    this.tour(data, viewIds, components)
    this.provenance(data)
    for (const [index, gap] of data.gaps.entries()) {
      this.localized(gap.topic, `$.gaps.${index}.topic`, 800)
      this.localized(gap.checked, `$.gaps.${index}.checked`, 800)
      this.localized(gap.action, `$.gaps.${index}.action`, 800)
    }
    if (data.provenance.some((row) => row.status === "gap") && data.gaps.length === 0) {
      this.add("gap.parity", "$.gaps", "a provenance gap requires at least one structured gap row")
    }
    return this.issues
  }

  component(component: PreviewComponent, path: string): void {
    this.uniqueUiId(component.id, `${path}.id`)
    if (shellAnchors.has(component.id)) {
      this.add(
        "id.reserved",
        `${path}.id`,
        "component ID collides with a trusted shell tour anchor",
      )
    }
    this.localized(component.title, `${path}.title`, 160)
    this.localized(component.body, `${path}.body`, 1200)
    for (const [index, item] of component.items.entries()) {
      const itemPath = `${path}.items.${index}`
      this.uniqueUiId(item.id, `${itemPath}.id`)
      this.localized(item.label, `${itemPath}.label`, 120)
      this.localized(item.value, `${itemPath}.value`, 200)
      this.localized(item.detail, `${itemPath}.detail`, 800)
      this.claimRef(item.claim_id, `${itemPath}.claim_id`)
      if (item.status !== "neutral" && !item.claim_id) {
        this.add(
          "item.claim-required",
          `${itemPath}.claim_id`,
          "non-neutral item status requires a provenance claim",
        )
      }
      if (item.magnitude > 0 && !item.claim_id) {
        this.add(
          "item.magnitude-claim",
          `${itemPath}.claim_id`,
          "nonzero visual magnitude requires a provenance claim",
        )
      }
    }
    this.string(component.code.language, `${path}.code.language`, 0, 32)
    this.string(component.code.text, `${path}.code.text`, 0, 2400, true)
    this.claimRef(component.code.claim_id, `${path}.code.claim_id`)
    if (component.code.claim_id && component.code.text) {
      this.codeClaims.set(component.code.claim_id, {
        path: `${path}.code.text`,
        text: component.code.text,
      })
    }
    for (const [key, maximum] of [
      ["button", 120],
      ["running", 200],
      ["result_title", 160],
      ["result_body", 1200],
    ] as const) {
      this.localized(component.demo[key], `${path}.demo.${key}`, maximum, component.kind !== "demo")
    }
    const demoEmpty = Object.values(component.demo).every(
      (value) => value.ja === "" && value.en === "",
    )
    const codeEmpty =
      component.code.language === "" && component.code.text === "" && component.code.claim_id === ""
    if (
      (component.kind === "code" &&
        (component.items.length !== 0 ||
          !component.code.language ||
          !component.code.text ||
          !component.code.claim_id ||
          !demoEmpty)) ||
      (component.kind === "demo" && (component.items.length === 0 || !codeEmpty || demoEmpty)) ||
      (!new Set(["code", "demo"]).has(component.kind) &&
        (component.items.length === 0 || !codeEmpty || !demoEmpty))
    ) {
      this.add("component.shape", path, `${component.kind} has an invalid content shape`)
    }
  }

  tour(
    data: PreviewModel,
    viewIds: ReadonlyMap<string, ViewKind>,
    components: ReadonlyMap<string, { kind: ComponentKind; view: string }>,
  ): void {
    const tour = data.dashboard.tour
    for (const key of ["next", "back", "done", "close"] as const) {
      this.localized(tour.controls[key], `$.dashboard.tour.controls.${key}`, 40)
    }
    let detached = false
    let anchored = false
    let revealed = false
    let revealedExample = false
    let visitedState = false
    const earlierTargets = new Set<string>()
    for (const [index, step] of tour.steps.entries()) {
      const path = `$.dashboard.tour.steps.${index}`
      this.uniqueUiId(step.id, `${path}.id`)
      this.localized(step.title, `${path}.title`, 160)
      this.localized(step.body, `${path}.body`, 800)
      detached ||= step.target === ""
      anchored ||= step.target !== ""
      revealed ||= step.reveal !== ""
      if (step.view && !viewIds.has(step.view)) {
        this.add("tour.view", `${path}.view`, "does not reference an existing view")
      }
      const component = components.get(step.target)
      if (step.target && !shellAnchors.has(step.target) && !component) {
        this.add("tour.target", `${path}.target`, "is not a shell anchor or component ID")
      }
      if (component) {
        if (step.view !== component.view) {
          this.add(
            "tour.target-view",
            path,
            `target belongs to view ${JSON.stringify(component.view)}`,
          )
        } else if (viewIds.get(component.view) === "state") visitedState = true
      }
      const reveal = components.get(step.reveal)
      if (step.reveal && reveal?.kind !== "demo") {
        this.add("tour.reveal", `${path}.reveal`, "does not reference a demo component")
      }
      if (reveal?.kind === "demo") {
        if (step.view !== reveal.view) {
          this.add(
            "tour.reveal-view",
            path,
            `revealed demo belongs to view ${JSON.stringify(reveal.view)}`,
          )
        } else if (viewIds.get(reveal.view) === "example") revealedExample = true
      }
      if (step.reveal && !earlierTargets.has(`${step.reveal}\0${step.view}`)) {
        this.add(
          "tour.reveal-order",
          `${path}.reveal`,
          "demo result requires an earlier step targeting that demo in the same view",
        )
      }
      if (step.target) earlierTargets.add(`${step.target}\0${step.view}`)
      if (index === 0 && (step.target || step.view || step.reveal)) {
        this.add(
          "tour.first-step",
          path,
          "first step must be detached with empty target/view/reveal",
        )
      }
    }
    if (!detached || !anchored || !revealed) {
      this.add(
        "tour.coverage",
        "$.dashboard.tour.steps",
        "requires detached, anchored, and demo-result steps",
      )
    }
    if (!revealedExample) {
      this.add(
        "tour.demo-example.missing",
        "$.dashboard.tour.steps",
        "at least one revealed demo must belong to an example view",
      )
    }
    if (!visitedState) {
      this.add(
        "tour.state.missing",
        "$.dashboard.tour.steps",
        "at least one tour step must target a component in a state view",
      )
    }
  }

  provenance(data: PreviewModel): void {
    const declared = new Map<string, string>()
    for (const [index, row] of data.provenance.entries()) {
      const path = `$.provenance.${index}`
      const prior = declared.get(row.id)
      if (prior) this.add("provenance.duplicate", `${path}.id`, `duplicates ${prior}`)
      else declared.set(row.id, `${path}.id`)
      this.localized(row.claim, `${path}.claim`, 1200)
      this.string(row.src, `${path}.src`, 0, 512)
      this.string(row.quote, `${path}.quote`, 0, 2400, true)
      if (row.status === "gap" && (row.src !== "" || row.quote !== "")) {
        this.add("provenance.gap-shape", path, "gap source and quote must both be empty")
      } else if (
        (row.status === "verified" || row.status === "inferred") &&
        (!row.src || !sourcePattern.test(row.src) || !row.quote)
      ) {
        this.add(
          "provenance.citation-shape",
          path,
          "verified/inferred requires path:L-L source and nonempty quote",
        )
      }
      const code = this.codeClaims.get(row.id)
      if (code && row.status !== "verified") {
        this.add(
          "code.provenance-status",
          `${path}.status`,
          "code excerpts require verified provenance",
        )
      }
      if (code && code.text !== row.quote) {
        this.add(
          "code.quote-mismatch",
          code.path,
          "code text must exactly equal its provenance quote",
        )
      }
    }
    const missing = [...this.claimRefs.keys()].filter((id) => !declared.has(id)).sort()
    const unused = [...declared.keys()].filter((id) => !this.claimRefs.has(id)).sort()
    if (missing.length > 0 || unused.length > 0) {
      const parts = [
        ...(missing.length > 0 ? [`missing rows: ${missing.join(", ")}`] : []),
        ...(unused.length > 0 ? [`unreferenced rows: ${unused.join(", ")}`] : []),
      ]
      this.add("claim.parity", "$.provenance", parts.join("; "))
    }
  }
}

export function validateStructure(value: unknown, expectedSlug?: string): SchemaIssue[] {
  if (!validateAuthorOutput(value)) return (validateAuthorOutput.errors ?? []).map(ajvIssue)
  return new SemanticChecker(expectedSlug).run(value as PreviewModel)
}

export function parseSource(
  value: string,
): [path: string, first: number, last: number] | undefined {
  const match = sourcePattern.exec(value)
  if (!match?.groups) return undefined
  const firstText = match.groups.first!
  const lastText = match.groups.last!
  if (firstText.length > 18 || lastText.length > 18) return undefined
  const first = Number(firstText)
  const last = Number(lastText)
  if (last < first || last - first > 400) return undefined
  return [match.groups.path!, first, last]
}
