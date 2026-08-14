import { lstatSync, readdirSync, realpathSync, statSync, type Stats } from "node:fs"
import { isAbsolute, relative, resolve, sep } from "node:path"

import { finding, Report, type Finding } from "./diagnostics.ts"
import { readBoundedRegular } from "./files.ts"
import { canonicalJson, ContractJsonError, loadsStrict, MAX_JSON_BYTES } from "./json.ts"
import type { PreviewModel } from "./model.ts"
import { compiledFiles } from "./render.ts"
import { parseSource, validateStructure } from "./schema.ts"

export const BUNDLE_FILES = new Set([
  "app.js",
  "gaps.md",
  "index.html",
  "preview.json",
  "provenance.json",
  "styles.css",
  "theme.css",
])
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024
export const MAX_SOURCE_TOTAL_BYTES = 32 * 1024 * 1024

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
]

function within(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
}

function lfLines(source: string): string[] {
  if (source === "") return []
  const parts = source.split("\n")
  const finalLf = parts.at(-1) === ""
  if (finalLf) parts.pop()
  return parts.map((part, index) => (index < parts.length - 1 || finalLf ? `${part}\n` : part))
}

function secretFindings(value: unknown, path = "$", rows: Finding[] = []): Finding[] {
  if (typeof value === "string") {
    if (secretPatterns.some((pattern) => pattern.test(value))) {
      rows.push(
        finding(
          "secret.detected",
          path,
          "high-confidence secret pattern detected (this narrow scan is not exhaustive)",
        ),
      )
    }
  } else if (Array.isArray(value)) {
    value.forEach((child, index) => secretFindings(child, `${path}.${index}`, rows))
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) secretFindings(child, `${path}.${key}`, rows)
  }
  return rows
}

type SourceCache =
  | { code: string; message: string; status: "error" }
  | { lines: string[]; status: "ok" }

function citationFindings(data: unknown, sourceBase: string, artifactHome: string): Finding[] {
  if (
    data === null ||
    typeof data !== "object" ||
    !Array.isArray((data as Record<string, unknown>).provenance)
  ) {
    return []
  }
  const findings: Finding[] = []
  let sourceRoot: string
  try {
    sourceRoot = realpathSync(sourceBase)
  } catch (error) {
    return [
      finding("citation.source-root", sourceBase, `cannot resolve source root: ${String(error)}`),
    ]
  }
  if (!statSync(sourceRoot).isDirectory()) {
    return [finding("citation.source-root", sourceBase, "source root is not a directory")]
  }
  const artifactRoot = resolve(artifactHome)
  const cache = new Map<string, SourceCache>()
  let loadedBytes = 0
  const provenance = (data as { provenance: unknown[] }).provenance
  for (const [index, value] of provenance.entries()) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue
    const row = value as Record<string, unknown>
    if (row.status !== "verified" && row.status !== "inferred") continue
    if (typeof row.src !== "string" || typeof row.quote !== "string") continue
    const path = `$.provenance.${index}`
    const parsed = parseSource(row.src)
    if (!parsed) {
      findings.push(
        finding(
          "citation.syntax",
          `${path}.src`,
          "expected relative path:L1-L2 with a bounded inclusive range",
        ),
      )
      continue
    }
    const [sourcePath, first, last] = parsed
    const parts = sourcePath.split("/")
    if (
      sourcePath.startsWith("/") ||
      sourcePath.includes("\\") ||
      parts.some((part) => part === "" || part === "." || part === "..")
    ) {
      findings.push(
        finding(
          "citation.traversal",
          `${path}.src`,
          "citation path must be a clean relative POSIX path",
        ),
      )
      continue
    }
    if (parts.includes(".git")) {
      findings.push(
        finding("citation.git-internal", `${path}.src`, "repository internals cannot be cited"),
      )
      continue
    }
    let resolved: string
    try {
      resolved = realpathSync(resolve(sourceRoot, ...parts))
    } catch (error) {
      findings.push(
        finding("citation.missing", `${path}.src`, `cannot resolve cited file: ${String(error)}`),
      )
      continue
    }
    if (!within(sourceRoot, resolved)) {
      findings.push(
        finding("citation.escape", `${path}.src`, "citation resolves outside the source root"),
      )
      continue
    }
    if (relative(sourceRoot, resolved).split(sep).includes(".git")) {
      findings.push(
        finding(
          "citation.git-internal",
          `${path}.src`,
          "citation resolves into repository internals",
        ),
      )
      continue
    }
    if (within(artifactRoot, resolved)) {
      findings.push(
        finding("citation.artifact", `${path}.src`, "citation resolves inside the artifact home"),
      )
      continue
    }

    let cached = cache.get(resolved)
    if (!cached) {
      let metadata: Stats
      try {
        metadata = statSync(resolved)
      } catch (error) {
        findings.push(
          finding("citation.missing", `${path}.src`, `cannot stat cited file: ${String(error)}`),
        )
        continue
      }
      if (!metadata.isFile()) {
        cached = {
          code: "citation.kind",
          message: "citation target must be a regular file",
          status: "error",
        }
      } else if (metadata.size > MAX_SOURCE_BYTES) {
        cached = {
          code: "citation.size",
          message: `citation target exceeds ${MAX_SOURCE_BYTES} bytes`,
          status: "error",
        }
      } else if (loadedBytes + metadata.size > MAX_SOURCE_TOTAL_BYTES) {
        cached = {
          code: "citation.total-size",
          message: `unique citation sources exceed ${MAX_SOURCE_TOTAL_BYTES} bytes`,
          status: "error",
        }
      } else {
        loadedBytes += metadata.size
        try {
          const payload = readBoundedRegular(resolved, MAX_SOURCE_BYTES)
          if (payload.byteLength > MAX_SOURCE_BYTES) {
            cached = {
              code: "citation.size",
              message: `citation target exceeds ${MAX_SOURCE_BYTES} bytes`,
              status: "error",
            }
          } else {
            const growth = Math.max(0, payload.byteLength - metadata.size)
            if (loadedBytes + growth > MAX_SOURCE_TOTAL_BYTES) {
              cached = {
                code: "citation.total-size",
                message: `unique citation sources exceed ${MAX_SOURCE_TOTAL_BYTES} bytes`,
                status: "error",
              }
            } else {
              loadedBytes += growth
              try {
                cached = {
                  lines: lfLines(new TextDecoder("utf-8", { fatal: true }).decode(payload)),
                  status: "ok",
                }
              } catch {
                cached = {
                  code: "citation.encoding",
                  message: "citation target is not UTF-8 text",
                  status: "error",
                }
              }
            }
          }
        } catch (error) {
          cached = {
            code: "citation.read",
            message: `cannot read cited file: ${String(error)}`,
            status: "error",
          }
        }
      }
      cache.set(resolved, cached)
    }
    if (cached.status === "error") {
      findings.push(finding(cached.code, `${path}.src`, cached.message))
      continue
    }
    if (first > cached.lines.length || last > cached.lines.length) {
      findings.push(
        finding(
          "citation.lines",
          `${path}.src`,
          `line range ${first}-${last} exceeds ${cached.lines.length} source lines`,
        ),
      )
      continue
    }
    const slice = cached.lines.slice(first - 1, last).join("")
    if (!row.quote.trim() || !slice.includes(row.quote)) {
      findings.push(
        finding(
          "citation.quote",
          `${path}.quote`,
          "quote is not a literal substring of the cited line slice",
        ),
      )
    }
  }
  return findings
}

export function validateModel(
  raw: string | Uint8Array,
  expectedSlug: string,
  sourceBase: string,
  artifactHome: string,
): Report {
  let data: unknown
  try {
    data = loadsStrict(raw)
  } catch (error) {
    if (error instanceof ContractJsonError)
      return new Report([finding(error.code, "$", error.message)])
    return new Report([finding("json.input", "$", String(error))])
  }
  const findings = [
    ...validateStructure(data, expectedSlug).map((row) => finding(row.code, row.path, row.message)),
    ...secretFindings(data),
    ...citationFindings(data, sourceBase, artifactHome),
  ]
  return new Report(findings)
}

function entryFindings(bundleDirectory: string): { findings: Finding[]; names: Set<string> } {
  let metadata: Stats
  try {
    metadata = lstatSync(bundleDirectory)
  } catch (error) {
    return {
      findings: [
        finding("bundle.missing", bundleDirectory, `cannot inspect bundle: ${String(error)}`),
      ],
      names: new Set(),
    }
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    return {
      findings: [
        finding("bundle.root-kind", bundleDirectory, "bundle root must be a real directory"),
      ],
      names: new Set(),
    }
  }
  const entries = readdirSync(bundleDirectory)
  const names = new Set(entries)
  const findings: Finding[] = []
  const missing = [...BUNDLE_FILES].filter((name) => !names.has(name)).sort()
  const extra = [...names].filter((name) => !BUNDLE_FILES.has(name)).sort()
  if (missing.length > 0 || extra.length > 0) {
    findings.push(
      finding(
        "bundle.entries",
        bundleDirectory,
        [
          ...(missing.length > 0 ? [`missing ${missing.join(", ")}`] : []),
          ...(extra.length > 0 ? [`unexpected ${extra.join(", ")}`] : []),
        ].join("; "),
      ),
    )
  }
  for (const name of entries) {
    try {
      const entry = lstatSync(resolve(bundleDirectory, name))
      if (!entry.isFile() || entry.isSymbolicLink()) {
        findings.push(
          finding("bundle.entry-kind", name, "entry must be a regular non-symlink file"),
        )
      }
    } catch (error) {
      findings.push(finding("bundle.entry-kind", name, `cannot inspect entry: ${String(error)}`))
    }
  }
  return { findings, names }
}

export function validateBundle(
  bundleDirectory: string,
  expectedSlug: string,
  sourceBase: string,
  artifactHome: string,
  templateDirectory: string,
): Report {
  const { findings, names } = entryFindings(bundleDirectory)
  const previewPath = resolve(bundleDirectory, "preview.json")
  if (!names.has("preview.json")) return new Report(findings)
  try {
    const entry = lstatSync(previewPath)
    if (!entry.isFile() || entry.isSymbolicLink()) return new Report(findings)
  } catch {
    return new Report(findings)
  }
  let raw: Uint8Array
  try {
    raw = readBoundedRegular(previewPath, MAX_JSON_BYTES)
  } catch (error) {
    findings.push(finding("bundle.preview-read", "preview.json", String(error)))
    return new Report(findings)
  }
  const modelReport = validateModel(raw, expectedSlug, sourceBase, artifactHome)
  findings.push(...modelReport.findings)
  if (!modelReport.ok) return new Report(findings)
  const data = loadsStrict(raw) as PreviewModel
  if (!Buffer.from(raw).equals(Buffer.from(canonicalJson(data)))) {
    findings.push(
      finding("bundle.preview-canonical", "preview.json", "preview.json is not canonical JSON"),
    )
  }
  let expected: Record<string, Uint8Array>
  try {
    expected = compiledFiles(data, templateDirectory)
  } catch (error) {
    findings.push(finding("bundle.compile", templateDirectory, String(error)))
    return new Report(findings)
  }
  for (const [name, content] of Object.entries(expected)) {
    if (!names.has(name)) continue
    const path = resolve(bundleDirectory, name)
    try {
      const actual = readBoundedRegular(path, content.byteLength)
      if (!Buffer.from(actual).equals(Buffer.from(content))) {
        findings.push(
          finding("bundle.derived-mismatch", name, "file differs from deterministic compilation"),
        )
      }
    } catch (error) {
      findings.push(finding("bundle.derived-read", name, String(error)))
    }
  }
  return new Report(findings)
}
