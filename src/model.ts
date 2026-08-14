export type Localized = { en: string; ja: string }
export type Theme = "ember" | "forest" | "graphite" | "indigo" | "plum"
export type Font = "editorial" | "humanist" | "technical"
export type Tone = "accent" | "critical" | "info" | "neutral" | "positive" | "warning"
export type ItemStatus = "blocked" | "current" | "done" | "gap" | "neutral" | "planned"
export type ProvenanceStatus = "gap" | "inferred" | "verified"
export type ViewKind = "example" | "overview" | "state"
export type ComponentKind =
  | "code"
  | "comparison"
  | "demo"
  | "evidence"
  | "facts"
  | "metrics"
  | "roadmap"
  | "steps"

export type PreviewItem = {
  claim_id: string
  detail: Localized
  id: string
  label: Localized
  magnitude: number
  status: ItemStatus
  value: Localized
}

export type PreviewComponent = {
  body: Localized
  code: { claim_id: string; language: string; text: string }
  demo: {
    button: Localized
    result_body: Localized
    result_title: Localized
    running: Localized
  }
  id: string
  items: PreviewItem[]
  kind: ComponentKind
  title: Localized
  tone: Tone
}

export type PreviewView = {
  components: PreviewComponent[]
  id: string
  kind: ViewKind
  label: Localized
  summary: Localized
  title: Localized
}

export type TourStep = {
  body: Localized
  id: string
  reveal: string
  target: string
  title: Localized
  view: string
}

export type Provenance = {
  claim: Localized
  id: string
  quote: string
  src: string
  status: ProvenanceStatus
}

export type Gap = { action: Localized; checked: Localized; topic: Localized }

export type PreviewModel = {
  dashboard: {
    project: {
      eyebrow: Localized
      font: Font
      name: Localized
      slug: string
      status: { claim_id: string; label: Localized; tone: Exclude<Tone, "accent"> }
      summary: Localized
      tagline: Localized
      theme: Theme
    }
    schema_version: 1
    tour: {
      controls: { back: Localized; close: Localized; done: Localized; next: Localized }
      steps: TourStep[]
    }
    views: PreviewView[]
  }
  gaps: Gap[]
  provenance: Provenance[]
}

export type GenerationRecord = {
  basedOnSourceRevision: string | null
  project: string
  prompt: string
  schemaVersion: 1
  sourceDirty: boolean
  sourceRevision: string | null
  strategy: "fresh" | "update"
}
