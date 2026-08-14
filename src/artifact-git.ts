import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"

export const GITIGNORE = `/previews/.locks/
/previews/.partial/
/previews/.previous/
/previews/.records/.*
/previews/.preview-exchange-probe-*/
/.preview-exchange-probe-*/
/.gitignore.*
/.in-progress-plugin.partial/
/.in-progress-plugin.previous/
`

const gitEnvironment = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  PAGER: "cat",
  PATH: "/usr/bin:/bin",
}

function git(root: string, arguments_: readonly string[], allowed = new Set([0])): string {
  const result = spawnSync(
    "git",
    [
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgSign=false",
      ...arguments_,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: gitEnvironment,
      input: "",
      timeout: 30_000,
    },
  )
  if (result.error || result.signal || !allowed.has(result.status ?? -1)) {
    const detail = (result.stderr || result.stdout || result.error?.message || "Git failed")
      .trim()
      .slice(-2_000)
    throw new Error(`artifact Git command failed: ${detail}`)
  }
  return result.stdout.trim()
}

function gitStatus(root: string, arguments_: readonly string[]): number {
  const result = spawnSync(
    "git",
    [
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgSign=false",
      ...arguments_,
    ],
    {
      cwd: root,
      env: gitEnvironment,
      input: "",
      timeout: 30_000,
    },
  )
  if (result.error || result.signal || result.status === null) {
    throw new Error("artifact Git status failed")
  }
  return result.status
}

function ensureGitignore(root: string): void {
  const path = join(root, ".gitignore")
  if (existsSync(path)) {
    const metadata = lstatSync(path)
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`artifact .gitignore is not a regular file: ${path}`)
    }
    if (readFileSync(path, "utf8") === GITIGNORE) return
  }
  const temporary = join(root, `.gitignore.${randomUUID()}`)
  const descriptor = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600,
  )
  try {
    writeFileSync(descriptor, GITIGNORE, "utf8")
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
      // Rename or earlier cleanup removed the temporary file.
    }
  }
}

export function prepareArtifactGit(root: string): string {
  const resolved = realpathSync(root)
  const metadata = lstatSync(resolved)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`artifact root is not a real directory: ${resolved}`)
  }
  const gitDirectory = join(resolved, ".git")
  if (!existsSync(gitDirectory)) git(resolved, ["init", "--initial-branch=main"])
  else {
    const gitMetadata = lstatSync(gitDirectory)
    if (!gitMetadata.isDirectory() || gitMetadata.isSymbolicLink()) {
      throw new Error(`artifact Git metadata is not a real directory: ${gitDirectory}`)
    }
  }
  if (realpathSync(git(resolved, ["rev-parse", "--show-toplevel"])) !== resolved) {
    throw new Error("artifact Git root does not match artifact root")
  }
  if (git(resolved, ["symbolic-ref", "--quiet", "--short", "HEAD"]) !== "main") {
    throw new Error("artifact Git repository must remain on branch main")
  }
  if (git(resolved, ["remote"]))
    throw new Error("artifact Git repository must not configure a remote")
  const staged = git(resolved, ["diff", "--cached", "--name-only", "-z"])
  if (
    staged
      .split("\0")
      .filter(Boolean)
      .some(
        (path) =>
          path !== ".gitignore" &&
          !path.startsWith("previews/") &&
          !path.startsWith("in-progress-plugin/"),
      )
  ) {
    throw new Error("artifact Git index contains changes outside Preview-owned paths")
  }
  ensureGitignore(resolved)
  return resolved
}

function verifySnapshot(root: string): void {
  if (git(root, ["remote"]))
    throw new Error("artifact Git repository gained a remote during snapshot")
  const dirty = git(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=normal",
    "--",
    ".gitignore",
    "previews",
    "in-progress-plugin",
  ])
  if (dirty) throw new Error("artifact files changed during the local Git snapshot")
}

export function snapshotArtifacts(root: string): string | undefined {
  const resolved = prepareArtifactGit(root)
  git(resolved, ["add", "--all", "--", ".gitignore", "previews", "in-progress-plugin"])
  git(resolved, ["diff", "--cached", "--check", "--no-ext-diff"])
  const status = gitStatus(resolved, ["diff", "--cached", "--quiet", "--no-ext-diff"])
  if (status === 0) {
    verifySnapshot(resolved)
    return undefined
  }
  if (status !== 1) throw new Error("artifact Git status failed")
  git(resolved, [
    "-c",
    "user.name=Preview",
    "-c",
    "user.email=preview@localhost",
    "commit",
    "-m",
    "preview: validated artifacts → local snapshot",
  ])
  const revision = git(resolved, ["rev-parse", "HEAD"])
  verifySnapshot(resolved)
  return revision
}
