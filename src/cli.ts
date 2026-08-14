import { parseArgs } from "node:util"
import { lstatSync, realpathSync, statSync } from "node:fs"
import { join } from "node:path"

import { escapeControls, Report } from "./diagnostics.ts"
import { discover, representable, requireProject } from "./discovery.ts"
import { compileProject, dryRun, generateBatch, generateProject } from "./generation.ts"
import { describeOutput, buildPlugin } from "./plugin.ts"
import { ProjectPaths, repoRoot, requireArtifactSeparation, resolveArtifactRoot } from "./paths.ts"
import { ProjectLock } from "./publication.ts"
import { MAX_USER_PROMPT_CHARS, normalizeUserPrompt } from "./records.ts"
import { servePreview } from "./server.ts"
import { applyAction, formatStatus, readState, type StateAction } from "./state.ts"
import { validateBundle } from "./validation.ts"

export const VERSION = "0.2.0"
export const HOST_READ_WARNING =
  "preview: warning: Codex can read any host-readable path; generate only from a trusted source checkout"

const usage = `preview ${VERSION}

Generate and review bilingual project dashboard previews.

Commands:
  list | status
  enable NAME | disable NAME | toggle NAME
  generate [NAME] [--dry-run] [--source PATH] [--artifact-root PATH]
  compile NAME [--model PATH] [--source PATH] [--artifact-root PATH]
  validate NAME [--source PATH] [--artifact-root PATH]
  serve NAME [--source PATH] [--artifact-root PATH] [--port N] [--open]
  plugin-build [--source NAME PATH]... [--artifact-root PATH] [--git-track]
`

export type CliIo = {
  signal?: AbortSignal
  stderr?: { write(value: string): unknown }
  stdin?: Uint8Array
  stdout?: { write(value: string): unknown }
}

function write(stream: { write(value: string): unknown }, value: string): void {
  stream.write(value.endsWith("\n") ? value : `${value}\n`)
}

function commonOptions() {
  return {
    "artifact-root": { type: "string" as const },
    source: { type: "string" as const },
  }
}

function exactPositionals(positionals: readonly string[], count: number, command: string): void {
  if (positionals.length !== count)
    throw new Error(`${command} expects ${count} positional argument${count === 1 ? "" : "s"}`)
}

async function promptFromInput(enabled: boolean, provided?: Uint8Array): Promise<string> {
  if (!enabled) return ""
  const raw = provided ?? new Uint8Array(await Bun.stdin.arrayBuffer())
  if (raw.byteLength > MAX_USER_PROMPT_CHARS * 4)
    throw new Error("Preview prompt exceeds its byte limit")
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw)
  } catch {
    throw new Error("Preview prompt is not valid UTF-8")
  }
  return normalizeUserPrompt(text)
}

function projectPaths(
  root: string,
  name: string,
  options: { artifactRoot?: string; source?: string },
): ProjectPaths {
  if (!representable(name)) throw new Error(`invalid project name ${JSON.stringify(name)}`)
  const source = options.source ? realpathSync(options.source) : requireProject(root, name)
  if (!statSync(source).isDirectory()) throw new Error(`source is not a directory: ${source}`)
  const artifacts = resolveArtifactRoot(options.artifactRoot)
  if (artifacts) requireArtifactSeparation(artifacts, source)
  return new ProjectPaths(root, name, source, artifacts)
}

function validatePaths(paths: ProjectPaths): Report {
  const metadata = lstatSync(paths.live)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`no published preview for ${JSON.stringify(paths.project)}`)
  }
  return validateBundle(paths.live, paths.project, paths.source, paths.previewHome, paths.templates)
}

function extractPluginSources(arguments_: readonly string[]): {
  remaining: string[]
  sources?: Map<string, string>
} {
  const remaining: string[] = []
  const sources = new Map<string, string>()
  for (let index = 0; index < arguments_.length; index += 1) {
    const token = arguments_[index]!
    if (token !== "--source") {
      remaining.push(token)
      continue
    }
    const name = arguments_[index + 1]
    const path = arguments_[index + 2]
    if (!name || !path) throw new Error("--source expects NAME PATH")
    if (!representable(name)) throw new Error(`invalid project name ${JSON.stringify(name)}`)
    if (sources.has(name)) throw new Error(`duplicate plugin source ${JSON.stringify(name)}`)
    sources.set(name, path)
    index += 2
  }
  return { remaining, ...(sources.size > 0 ? { sources } : {}) }
}

export async function main(
  argv: readonly string[],
  rootOverride?: string,
  io: CliIo = {},
): Promise<number> {
  const stdout = io.stdout ?? process.stdout
  const stderr = io.stderr ?? process.stderr
  if (argv.length === 1 && argv[0] === "--version") {
    write(stdout, `preview ${VERSION}`)
    return 0
  }
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    write(stdout, usage)
    return argv.length === 0 ? 1 : 0
  }
  const root = realpathSync(rootOverride ?? repoRoot())
  const projects = discover(root)
  const statePath = join(root, "enabled.txt")
  const command = argv[0]!
  const commandArguments = argv.slice(1)
  try {
    if (command === "list") {
      exactPositionals(commandArguments, 0, command)
      if (projects.length > 0) write(stdout, projects.join("\n"))
      return 0
    }
    if (command === "status") {
      exactPositionals(commandArguments, 0, command)
      const status = formatStatus(projects, readState(statePath))
      if (status) write(stdout, status)
      return 0
    }
    if (["enable", "disable", "toggle"].includes(command)) {
      exactPositionals(commandArguments, 1, command)
      const name = commandArguments[0]!
      const enabled = applyAction(statePath, projects, name, command as StateAction)
      write(stdout, `${enabled ? "enabled" : "disabled"} ${name}`)
      return 0
    }
    if (command === "generate") {
      const parsed = parseArgs({
        allowPositionals: true,
        args: commandArguments,
        options: {
          ...commonOptions(),
          "codex-executable": { type: "string" },
          "dry-run": { type: "boolean" },
          "expected-revision": { type: "string" },
          "from-scratch": { type: "boolean" },
          "prompt-stdin": { type: "boolean" },
        },
        strict: true,
      })
      if (parsed.positionals.length > 1) throw new Error("generate accepts at most one project")
      const name = parsed.positionals[0]
      const userPrompt = await promptFromInput(parsed.values["prompt-stdin"] ?? false, io.stdin)
      const options = {
        ...(parsed.values["artifact-root"] ? { artifactRoot: parsed.values["artifact-root"] } : {}),
        ...(parsed.values["codex-executable"]
          ? { codexExecutable: parsed.values["codex-executable"] }
          : {}),
        ...(parsed.values["expected-revision"]
          ? { expectedRevision: parsed.values["expected-revision"] }
          : {}),
        fromScratch: parsed.values["from-scratch"] ?? false,
        ...(io.signal ? { signal: io.signal } : {}),
        ...(parsed.values.source ? { source: parsed.values.source } : {}),
        userPrompt,
      }
      if (name) {
        if (parsed.values["dry-run"]) {
          write(stdout, dryRun(root, name, options))
          return 0
        }
        write(stderr, HOST_READ_WARNING)
        const outcome = await generateProject(root, name, options)
        write(outcome.ok ? stdout : stderr, outcome.message)
        return outcome.ok ? 0 : 1
      }
      if (parsed.values.source) throw new Error("--source requires a named project")
      if (parsed.values["expected-revision"]) {
        throw new Error("--expected-revision requires a named project")
      }
      const targets = [...readState(statePath)].sort()
      if (parsed.values["dry-run"]) {
        if (targets.length === 0) {
          write(stdout, "summary: 0 plans")
          return 0
        }
        let failures = 0
        const blocks: string[] = []
        for (const target of targets) {
          if (!projects.includes(target)) {
            blocks.push(`[FAILED] ${target}: enabled project is missing\n`)
            failures += 1
          } else blocks.push(dryRun(root, target, options))
        }
        write(
          stdout,
          `${blocks.join("\n---\n\n")}summary: ${targets.length - failures} plans, ${failures} failed`,
        )
        return failures > 0 ? 1 : 0
      }
      const current = targets.filter((target) => projects.includes(target))
      const missing = targets.filter((target) => !projects.includes(target))
      if (current.length > 0) write(stderr, HOST_READ_WARNING)
      const result = await generateBatch(root, current, options)
      const prefix = missing
        .map((target) => `[FAILED] ${target}\nenabled project is missing\n`)
        .join("")
      stdout.write(`${prefix}${result.text}`)
      return missing.length > 0 ? 1 : result.code
    }
    if (command === "compile") {
      const parsed = parseArgs({
        allowPositionals: true,
        args: commandArguments,
        options: { ...commonOptions(), model: { type: "string" } },
        strict: true,
      })
      exactPositionals(parsed.positionals, 1, command)
      const outcome = await compileProject(root, parsed.positionals[0]!, {
        ...(parsed.values["artifact-root"] ? { artifactRoot: parsed.values["artifact-root"] } : {}),
        ...(parsed.values.model ? { modelPath: parsed.values.model } : {}),
        ...(parsed.values.source ? { source: parsed.values.source } : {}),
      })
      write(outcome.ok ? stdout : stderr, outcome.message)
      return outcome.ok ? 0 : 1
    }
    if (command === "validate" || command === "serve") {
      const parsed = parseArgs({
        allowPositionals: true,
        args: commandArguments,
        options: {
          ...commonOptions(),
          ...(command === "serve"
            ? { open: { type: "boolean" as const }, port: { type: "string" as const } }
            : {}),
        },
        strict: true,
      })
      exactPositionals(parsed.positionals, 1, command)
      const paths = projectPaths(root, parsed.positionals[0]!, {
        ...(parsed.values["artifact-root"] ? { artifactRoot: parsed.values["artifact-root"] } : {}),
        ...(parsed.values.source ? { source: parsed.values.source } : {}),
      })
      const lock = await ProjectLock.acquire(paths.lock)
      try {
        const report = validatePaths(paths)
        if (!report.ok) {
          write(command === "serve" ? stderr : stdout, report.format())
          return 1
        }
        if (command === "validate") {
          write(stdout, `valid previews/${paths.project}`)
          return 0
        }
        const port = Number(parsed.values.port ?? "4173")
        await servePreview(paths.live, port, {
          openBrowser: parsed.values.open === true,
          ...(io.signal ? { signal: io.signal } : {}),
        })
        return 0
      } finally {
        await lock.release()
      }
    }
    if (command === "plugin-build") {
      const extracted = extractPluginSources(commandArguments)
      const parsed = parseArgs({
        allowPositionals: true,
        args: extracted.remaining,
        options: {
          "artifact-root": { type: "string" },
          "git-track": { type: "boolean" },
        },
        strict: true,
      })
      exactPositionals(parsed.positionals, 0, command)
      const result = await buildPlugin(root, extracted.sources, {
        ...(parsed.values["artifact-root"] ? { artifactRoot: parsed.values["artifact-root"] } : {}),
        gitTrack: parsed.values["git-track"] ?? false,
      })
      const noun = result.projects.length === 1 ? "dashboard" : "dashboards"
      write(
        stdout,
        `built ${describeOutput(root, result.output)} with ${result.projects.length} ${noun}`,
      )
      if (result.skipped.length > 0) {
        write(
          stderr,
          `preview: skipped published previews without a current source: ${result.skipped.join(", ")}`,
        )
      }
      return 0
    }
    throw new Error(`unknown command ${JSON.stringify(command)}`)
  } catch (error) {
    if (io.signal?.aborted && error === io.signal.reason) {
      write(stderr, "preview: operation cancelled")
      return 143
    }
    write(stderr, `preview: ${escapeControls(error instanceof Error ? error.message : error)}`)
    return 1
  }
}
