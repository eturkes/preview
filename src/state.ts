import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"

import { representable } from "./discovery.ts"

export type StateAction = "disable" | "enable" | "toggle"

export function parseState(text: string): Set<string> {
  return new Set(text.split("\n").filter((line) => line.length > 0 && representable(line)))
}

export function serializeState(enabled: ReadonlySet<string>): string {
  return [...enabled]
    .sort()
    .map((name) => `${name}\n`)
    .join("")
}

export function readState(path: string): Set<string> {
  return existsSync(path) ? parseState(readFileSync(path, "utf8")) : new Set()
}

export function writeState(path: string, enabled: ReadonlySet<string>): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  const descriptor = openSync(temporary, "w", 0o600)
  try {
    writeFileSync(descriptor, serializeState(enabled), "utf8")
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  renameSync(temporary, path)
}

export function applyAction(
  path: string,
  projects: readonly string[],
  name: string,
  action: StateAction,
): boolean {
  const enabled = readState(path)
  const current = projects.includes(name)
  const present = enabled.has(name)
  const wanted = action === "enable" || (action === "toggle" && !present)
  if ((wanted && !current) || (!wanted && !current && !present)) {
    throw new Error(`unknown project ${JSON.stringify(name)}`)
  }
  if (wanted) enabled.add(name)
  else enabled.delete(name)
  if (wanted !== present) writeState(path, enabled)
  return wanted
}

export function formatStatus(projects: readonly string[], enabled: ReadonlySet<string>): string {
  const lines = projects.map((name) => `[${enabled.has(name) ? "x" : " "}] ${name}`)
  const current = new Set(projects)
  lines.push(
    ...[...enabled]
      .filter((name) => !current.has(name))
      .sort()
      .map((name) => `[!] ${name} (missing)`),
  )
  return lines.join("\n")
}
