import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"

import { readBoundedRegular } from "./files.ts"
import { canonicalJson, loadsStrict } from "./json.ts"
import type { GenerationRecord } from "./model.ts"

export const MAX_RECORD_BYTES = 64 * 1024
export const MAX_USER_PROMPT_CHARS = 8_000

export function normalizeUserPrompt(value: string): string {
  const prompt = value.trim()
  if (prompt.includes("\0")) throw new Error("Preview prompt contains a null byte")
  if (/\p{Cs}/u.test(prompt)) throw new Error("Preview prompt contains a lone surrogate")
  if (prompt.length > MAX_USER_PROMPT_CHARS) {
    throw new Error(`Preview prompt exceeds ${MAX_USER_PROMPT_CHARS} characters`)
  }
  return prompt
}

function revision(value: unknown): value is string {
  return typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)
}

export function parseRecord(value: unknown, expectedProject: string): GenerationRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("generation record has an unsupported shape")
  }
  const row = value as Record<string, unknown>
  const keys = [
    "basedOnSourceRevision",
    "project",
    "prompt",
    "schemaVersion",
    "sourceDirty",
    "sourceRevision",
    "strategy",
  ]
  if (Object.keys(row).sort().join("\0") !== keys.join("\0")) {
    throw new Error("generation record has an unsupported shape")
  }
  if (
    row.schemaVersion !== 1 ||
    row.project !== expectedProject ||
    typeof row.sourceDirty !== "boolean" ||
    (row.strategy !== "fresh" && row.strategy !== "update") ||
    typeof row.prompt !== "string" ||
    (row.sourceRevision !== null && !revision(row.sourceRevision)) ||
    (row.basedOnSourceRevision !== null && !revision(row.basedOnSourceRevision))
  ) {
    throw new Error("generation record is invalid")
  }
  return {
    basedOnSourceRevision: row.basedOnSourceRevision,
    project: expectedProject,
    prompt: normalizeUserPrompt(row.prompt),
    schemaVersion: 1,
    sourceDirty: row.sourceDirty,
    sourceRevision: row.sourceRevision,
    strategy: row.strategy,
  }
}

export function readRecord(path: string, expectedProject: string): GenerationRecord | undefined {
  if (!existsSync(path)) return undefined
  const raw = readBoundedRegular(path, MAX_RECORD_BYTES)
  if (raw.byteLength > MAX_RECORD_BYTES) {
    throw new Error("generation record exceeds its byte limit")
  }
  try {
    return parseRecord(loadsStrict(raw), expectedProject)
  } catch (error) {
    throw new Error("generation record is not valid UTF-8 JSON", { cause: error })
  }
}

export function writeRecord(path: string, value: GenerationRecord): void {
  const record = parseRecord(value, value.project)
  const parent = dirname(path)
  mkdirSync(parent, { recursive: true })
  const metadata = lstatSync(parent)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`generation record parent is not a real directory: ${parent}`)
  }
  const raw = canonicalJson(record)
  if (raw.byteLength > MAX_RECORD_BYTES) {
    throw new Error("generation record exceeds its byte limit")
  }
  const temporary = join(parent, `.${path.split("/").at(-1)}.${randomUUID()}`)
  const descriptor = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600,
  )
  try {
    writeFileSync(descriptor, raw)
    fsyncSync(descriptor)
    closeSync(descriptor)
    renameSync(temporary, path)
  } catch (error) {
    try {
      closeSync(descriptor)
    } catch {
      // The descriptor was already closed.
    }
    throw error
  } finally {
    try {
      unlinkSync(temporary)
    } catch {
      // Rename or an earlier cleanup removed the temporary file.
    }
  }
}
