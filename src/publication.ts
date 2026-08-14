import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { once } from "node:events"
import { randomUUID } from "node:crypto"

export class ProjectBusyError extends Error {}

export function ensureRealDirectory(path: string): void {
  mkdirSync(path, { recursive: true })
  const metadata = lstatSync(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`reserved path is not a real directory: ${path}`)
  }
}

export function removeLeaf(path: string): void {
  if (!existsSync(path)) return
  rmSync(path, { force: true, recursive: true })
}

export function renameExchange(left: string, right: string): void {
  const result = spawnSync(
    "mv",
    ["--exchange", "--no-copy", "--no-target-directory", "--", left, right],
    {
      encoding: "utf8",
    },
  )
  if (result.error || result.signal || result.status !== 0) {
    const detail =
      result.error?.message ?? (result.stderr.trim() || `exit ${String(result.status)}`)
    throw new Error(`atomic directory exchange failed: ${detail}`)
  }
}

export function requireAtomicExchangeSupport(directory: string): void {
  ensureRealDirectory(directory)
  const probe = join(directory, `.preview-exchange-probe-${randomUUID()}`)
  try {
    const left = join(probe, "left")
    const right = join(probe, "right")
    mkdirSync(left, { recursive: true })
    mkdirSync(right)
    writeFileSync(join(left, "marker"), "left", "utf8")
    writeFileSync(join(right, "marker"), "right", "utf8")
    renameExchange(left, right)
    if (
      readFileSync(join(left, "marker"), "utf8") !== "right" ||
      readFileSync(join(right, "marker"), "utf8") !== "left"
    ) {
      throw new Error("atomic directory exchange did not exchange output entries")
    }
  } finally {
    removeLeaf(probe)
  }
}

export class ProjectLock {
  #child: ChildProcessWithoutNullStreams | undefined

  private constructor(readonly path: string) {}

  static async acquire(path: string): Promise<ProjectLock> {
    ensureRealDirectory(dirname(path))
    if (existsSync(path)) {
      const metadata = lstatSync(path)
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error(`lock path is not a regular file: ${path}`)
      }
    }
    const lock = new ProjectLock(path)
    const child = spawn(
      "flock",
      ["--exclusive", "--nonblock", "--", path, "sh", "-c", 'printf "ready\\n"; read -r _'],
      { stdio: ["pipe", "pipe", "pipe"] },
    )
    lock.#child = child
    const acquired = new Promise<boolean>((resolve, reject) => {
      child.stdout.once("data", (chunk) => resolve(String(chunk).startsWith("ready\n")))
      child.once("error", reject)
      child.once("exit", (code) => {
        if (code === 1) resolve(false)
        else if (code !== 0) reject(new Error(`flock helper exited with code ${String(code)}`))
      })
    })
    if (!(await acquired)) {
      lock.#child = undefined
      throw new ProjectBusyError("another preview operation owns this project")
    }
    return lock
  }

  async release(): Promise<void> {
    const child = this.#child
    if (!child) return
    this.#child = undefined
    child.stdin.end("\n")
    if (child.exitCode === null) await once(child, "exit")
  }
}

export async function withProjectLock<T>(path: string, action: () => Promise<T> | T): Promise<T> {
  const lock = await ProjectLock.acquire(path)
  try {
    return await action()
  } finally {
    await lock.release()
  }
}

export function prepareStage(stage: string, backup: string, live: string): void {
  ensureRealDirectory(dirname(stage))
  ensureRealDirectory(dirname(backup))
  if (!existsSync(live) && existsSync(backup)) renameSync(backup, live)
  else if (existsSync(live) && existsSync(backup)) removeLeaf(backup)
  removeLeaf(stage)
  mkdirSync(stage, { mode: 0o755 })
}

export function publish(stage: string, backup: string, live: string): void {
  const metadata = lstatSync(stage)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`publication stage is not a real directory: ${stage}`)
  }
  removeLeaf(backup)
  if (!existsSync(live)) {
    renameSync(stage, live)
    return
  }
  renameExchange(stage, live)
  try {
    renameSync(stage, backup)
  } catch {
    return
  }
  try {
    removeLeaf(backup)
  } catch {
    // Promotion succeeded. The next locked prepare recovers this backup.
  }
}
