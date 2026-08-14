import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, join, relative } from "node:path"

import { prepareArtifactGit, snapshotArtifacts } from "./artifact-git.ts"
import { discover, representable, requireProject } from "./discovery.ts"
import { readBoundedRegular } from "./files.ts"
import { canonicalJson, loadsStrict, MAX_JSON_BYTES } from "./json.ts"
import type { PreviewModel } from "./model.ts"
import { ProjectPaths, requireArtifactSeparation, resolveArtifactRoot } from "./paths.ts"
import { prepareStage, ProjectLock, publish, requireAtomicExchangeSupport } from "./publication.ts"
import { readRecord } from "./records.ts"
import { validateBundle } from "./validation.ts"

export const PLUGIN_DIRECTORY = "in-progress-plugin"
export const PLUGIN_FILES = new Set(["in-progress.plugin.json", "index.html", "preview-index.json"])
export const PLUGIN_MANIFEST = {
  apiVersion: "1.0",
  assets: [],
  capabilities: [],
  description: "Evidence-backed bilingual project dashboards",
  entry: "index.html",
  icon: "sparkles",
  id: "preview",
  name: "Preview",
  version: "0.2.0",
}

const pluginPlaceholders = [
  "DASHBOARD_DATA",
  "INLINE_STYLES",
  "PREVIEW_RUNTIME",
  "PLUGIN_RUNTIME",
] as const
const MAX_PLUGIN_PROJECTS = 1_000

export class PluginBuildError extends Error {}

export type PluginBuildResult = {
  output: string
  projects: readonly string[]
  skipped: readonly string[]
}

type Dashboard = { body: string; className: string; title: string }

function publishedProjects(
  previewHome: string,
  currentProjects: readonly string[],
): { projects: string[]; skipped: string[] } {
  let entries: string[]
  try {
    entries = readdirSync(previewHome).sort()
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { projects: [], skipped: [] }
    }
    throw error
  }
  const published: string[] = []
  for (const name of entries) {
    if (name.startsWith(".")) continue
    if (!representable(name)) {
      throw new PluginBuildError(
        `published preview has an invalid project name: ${JSON.stringify(name)}`,
      )
    }
    const metadata = lstatSync(join(previewHome, name))
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new PluginBuildError(
        `published preview is not a real directory: ${JSON.stringify(name)}`,
      )
    }
    published.push(name)
  }
  const current = new Set(currentProjects)
  return {
    projects: published.filter((name) => current.has(name)),
    skipped: published.filter((name) => !current.has(name)),
  }
}

function documentTitle(model: PreviewModel): string {
  const names = model.dashboard.project.name
  return names.ja === names.en ? names.ja : `${names.ja} / ${names.en}`
}

function dashboardBody(index: string, project: string): string {
  const opening = "<body>"
  const closing = "</body>"
  if (index.split(opening).length !== 2 || index.split(closing).length !== 2) {
    throw new PluginBuildError(`previews/${project}/index.html has an unsupported body shape`)
  }
  const [before, remainder] = index.split(opening)
  const [body, after] = remainder!.split(closing)
  if (
    !before!.toLowerCase().startsWith("<!doctype html>") ||
    after!.trim().toLowerCase() !== "</html>"
  ) {
    throw new PluginBuildError(`previews/${project}/index.html is not one complete HTML document`)
  }
  const footerOpen = '<footer class="evidence-ledger__links">'
  if (body!.split(footerOpen).length !== 2) {
    throw new PluginBuildError(`previews/${project}/index.html has an unsupported sidecar footer`)
  }
  const [prefix, footerAndSuffix] = body!.split(footerOpen)
  const [footer, suffix] = footerAndSuffix!.split("</footer>")
  for (const target of ['href="provenance.json"', 'href="gaps.md"']) {
    if (footer!.split(target).length !== 2) {
      throw new PluginBuildError(
        `previews/${project}/index.html sidecar footer is missing ${target}`,
      )
    }
  }
  const stripped = `${prefix}${suffix}`
  if (stripped.includes('href="provenance.json"') || stripped.includes('href="gaps.md"')) {
    throw new PluginBuildError(
      `previews/${project}/index.html has sidecar links outside its footer`,
    )
  }
  return stripped
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

function scriptJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")
}

function inlineSafe(value: string, terminator: string, source: string): string {
  if (value.toLowerCase().includes(terminator.toLowerCase())) {
    throw new PluginBuildError(`${source} contains unsafe inline terminator ${terminator}`)
  }
  return value
}

function renderEntry(root: string, dashboards: Readonly<Record<string, Dashboard>>): Uint8Array {
  const templates = join(root, "templates")
  let shell = readFileSync(join(templates, "plugin.html"), "utf8")
  for (const name of pluginPlaceholders) {
    const marker = `{{${name}}}`
    if (shell.split(marker).length !== 2) {
      throw new PluginBuildError(`plugin template marker ${marker} must occur exactly once`)
    }
  }
  const styles = ["styles.css", "theme.css"]
    .map((name) => readFileSync(join(templates, name), "utf8").trimEnd())
    .join("\n")
  const previewRuntime = readFileSync(join(templates, "app.js"), "utf8").trimEnd()
  const protocolRuntime = readFileSync(
    join(root, "vendor/in-progress-protocol/dist/browser.iife.js"),
    "utf8",
  ).trimEnd()
  const pluginRuntime = `${protocolRuntime}\n${readFileSync(join(templates, "plugin-runtime.js"), "utf8").trimEnd()}`
  const replacements: Record<(typeof pluginPlaceholders)[number], string> = {
    DASHBOARD_DATA: scriptJson(dashboards),
    INLINE_STYLES: inlineSafe(styles, "</style", "trusted styles"),
    PLUGIN_RUNTIME: inlineSafe(pluginRuntime, "</script", "plugin runtime"),
    PREVIEW_RUNTIME: inlineSafe(previewRuntime, "</script", "preview runtime"),
  }
  for (const name of pluginPlaceholders) shell = shell.replace(`{{${name}}}`, replacements[name])
  return Buffer.from(shell, "utf8")
}

function validatedDashboards(
  root: string,
  projects: readonly string[],
  sources: ReadonlyMap<string, string>,
  artifactRoot?: string,
): Record<string, Dashboard> {
  const dashboards: Record<string, Dashboard> = {}
  for (const project of projects) {
    const paths = new ProjectPaths(root, project, undefined, artifactRoot)
    const report = validateBundle(
      paths.live,
      project,
      sources.get(project)!,
      paths.previewHome,
      paths.templates,
    )
    if (!report.ok) throw new PluginBuildError(`invalid previews/${project}: ${report.format()}`)
    const model = loadsStrict(
      readBoundedRegular(join(paths.live, "preview.json"), MAX_JSON_BYTES),
    ) as PreviewModel
    const index = readFileSync(join(paths.live, "index.html"), "utf8")
    dashboards[project] = {
      body: dashboardBody(index, project),
      className: `theme-${model.dashboard.project.theme} font-${model.dashboard.project.font}`,
      title: documentTitle(model),
    }
  }
  return dashboards
}

function generationRecords(
  root: string,
  projects: readonly string[],
  artifactRoot?: string,
): unknown[] {
  return projects.flatMap((project) => {
    try {
      const record = readRecord(
        new ProjectPaths(root, project, undefined, artifactRoot).record,
        project,
      )
      return record ? [record] : []
    } catch (error) {
      throw new PluginBuildError(`invalid generation record for ${project}: ${String(error)}`)
    }
  })
}

function resolveSources(root: string, sources?: ReadonlyMap<string, string>): Map<string, string> {
  if (!sources)
    return new Map(discover(root).map((project) => [project, requireProject(root, project)]))
  const resolved = new Map<string, string>()
  for (const project of [...sources.keys()].sort()) {
    if (!representable(project)) {
      throw new PluginBuildError(
        `plugin source has an invalid project name: ${JSON.stringify(project)}`,
      )
    }
    const source = realpathSync(sources.get(project)!)
    if (!statSync(source).isDirectory())
      throw new PluginBuildError(`plugin source is not a directory: ${source}`)
    resolved.set(project, source)
  }
  return resolved
}

export async function buildPlugin(
  root: string,
  sources?: ReadonlyMap<string, string>,
  options: { artifactRoot?: string; gitTrack?: boolean } = {},
): Promise<PluginBuildResult> {
  const resolvedRoot = realpathSync(root)
  const artifactRoot = resolveArtifactRoot(options.artifactRoot)
  if (options.gitTrack && !artifactRoot) {
    throw new PluginBuildError("--git-track requires an external artifact root")
  }
  const previewHome = join(artifactRoot ?? resolvedRoot, "previews")
  const outputHome = artifactRoot ?? join(resolvedRoot, "dist")
  const output = join(outputHome, PLUGIN_DIRECTORY)
  const stage = join(outputHome, `.${PLUGIN_DIRECTORY}.partial`)
  const backup = join(outputHome, `.${PLUGIN_DIRECTORY}.previous`)
  const resolvedSources = resolveSources(resolvedRoot, sources)
  if (artifactRoot) {
    for (const source of resolvedSources.values()) requireArtifactSeparation(artifactRoot, source)
  }
  requireAtomicExchangeSupport(outputHome)

  const buildLock = await ProjectLock.acquire(join(previewHome, ".locks/.plugin-build.lock"))
  try {
    if (options.gitTrack) prepareArtifactGit(artifactRoot!)
    prepareStage(stage, backup, output)
    const projectLocks: ProjectLock[] = []
    try {
      for (const project of resolvedSources.keys()) {
        projectLocks.push(
          await ProjectLock.acquire(
            new ProjectPaths(resolvedRoot, project, undefined, artifactRoot).lock,
          ),
        )
      }
      const { projects, skipped } = publishedProjects(previewHome, [...resolvedSources.keys()])
      if (projects.length > MAX_PLUGIN_PROJECTS) {
        throw new PluginBuildError(`plugin project count exceeds ${MAX_PLUGIN_PROJECTS}`)
      }
      const dashboards = validatedDashboards(resolvedRoot, projects, resolvedSources, artifactRoot)
      const files: Record<string, Uint8Array> = {
        "in-progress.plugin.json": canonicalJson(PLUGIN_MANIFEST),
        "index.html": renderEntry(resolvedRoot, dashboards),
        "preview-index.json": canonicalJson({
          generations: generationRecords(resolvedRoot, projects, artifactRoot),
          projects,
          schemaVersion: 1,
        }),
      }
      mkdirSync(stage, { recursive: true })
      for (const name of [...PLUGIN_FILES].sort()) writeFileSync(join(stage, name), files[name]!)
      publish(stage, backup, output)
      if (options.gitTrack) snapshotArtifacts(artifactRoot!)
      return { output, projects, skipped }
    } finally {
      for (const lock of projectLocks.reverse()) await lock.release()
    }
  } finally {
    await buildLock.release()
  }
}

export function describeOutput(root: string, output: string): string {
  const location = relative(root, output)
  return location.startsWith("..") ? output : location || basename(output)
}
