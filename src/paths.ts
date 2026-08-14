import { existsSync, lstatSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export function repoRoot(): string {
  return realpathSync(fileURLToPath(new URL("..", import.meta.url)))
}

function expandHome(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  return path
}

export function resolveArtifactRoot(value?: string): string | undefined {
  if (value === undefined) return undefined
  const expanded = resolve(expandHome(value))
  let existing = expanded
  while (!existsSync(existing)) {
    try {
      if (lstatSync(existing).isSymbolicLink()) {
        throw new Error(`artifact root crosses an unresolved symlink: ${existing}`)
      }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
    }
    const parent = dirname(existing)
    if (parent === existing) throw new Error(`cannot resolve artifact root: ${expanded}`)
    existing = parent
  }
  const resolved = resolve(realpathSync(existing), relative(existing, expanded))
  if (existsSync(resolved) && !statSync(resolved).isDirectory()) {
    throw new Error(`artifact root is not a directory: ${resolved}`)
  }
  return resolved
}

function within(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === "" || (!path.startsWith("..") && !isAbsolute(path))
}

export function requireArtifactSeparation(artifactRoot: string, source: string): void {
  const artifacts = resolve(artifactRoot)
  const resolvedSource = realpathSync(source)
  if (within(resolvedSource, artifacts) || within(artifacts, resolvedSource)) {
    throw new Error(
      `artifact root must be outside the source; artifact root ${artifacts} overlaps ${resolvedSource}`,
    )
  }
}

export class ProjectPaths {
  constructor(
    readonly root: string,
    readonly project: string,
    readonly sourceOverride?: string,
    readonly artifactRoot?: string,
  ) {}

  get source(): string {
    return this.sourceOverride ?? join(dirname(this.root), this.project)
  }

  get previewHome(): string {
    return join(this.artifactRoot ?? this.root, "previews")
  }

  get stage(): string {
    return join(this.previewHome, ".partial", this.project)
  }

  get backup(): string {
    return join(this.previewHome, ".previous", this.project)
  }

  get live(): string {
    return join(this.previewHome, this.project)
  }

  get lock(): string {
    return join(this.previewHome, ".locks", `${this.project}.lock`)
  }

  get record(): string {
    return join(this.previewHome, ".records", `${this.project}.json`)
  }

  get templates(): string {
    return join(this.root, "templates")
  }
}
