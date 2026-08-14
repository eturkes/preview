import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { main } from "../src/cli.ts"
import { codexEnvironment, dryRun, generateProject } from "../src/generation.ts"
import { readRecord } from "../src/records.ts"

const checkout = resolve(import.meta.dir, "..")
const fixtureModel = join(checkout, "testdata/valid/preview.json")
const fixtureSource = join(checkout, "testdata/source")
const temporaryDirectories: string[] = []

function temporary(): string {
  const path = mkdtempSync(join(tmpdir(), "preview-generation-test-"))
  temporaryDirectories.push(path)
  return path
}

afterEach(() => {
  delete process.env.FAKE_PREVIEW_MODEL
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { force: true, recursive: true })
})

function fakeCodex(directory: string): string {
  const path = join(directory, "codex")
  writeFileSync(
    path,
    `#!/bin/sh
set -eu
case " $* " in
  *" login status "*)
    printf '%s\n' 'Logged in using ChatGPT'
    ;;
  *" doctor --json "*)
    printf '%s\n' '{"checks":{"auth.credentials":{"status":"ok","details":{"stored auth mode":"chatgpt","stored ChatGPT tokens":"true"}},"network.provider_reachability":{"status":"ok","details":{"reachability mode":"chatgpt"}},"network.websocket_reachability":{"status":"ok","details":{"auth mode":"chatgpt","model provider":"openai","endpoint":"wss://chatgpt.com/backend-api/codex","handshake result":"101 Switching Protocols"}}}}'
    ;;
  *" exec "*)
    output=''
    while [ "$#" -gt 0 ]; do
      if [ "$1" = '--output-last-message' ]; then output=$2; break; fi
      shift
    done
    test -n "$output"
    cp -- "$FAKE_PREVIEW_MODEL" "$output"
    ;;
  *)
    printf '%s\n' 'unsupported fake Codex command' >&2
    exit 64
    ;;
esac
`,
    "utf8",
  )
  chmodSync(path, 0o755)
  return path
}

function capture() {
  let stdout = ""
  let stderr = ""
  return {
    io: {
      stderr: {
        write(value: string) {
          stderr += value
        },
      },
      stdout: {
        write(value: string) {
          stdout += value
        },
      },
    },
    output: () => ({ stderr, stdout }),
  }
}

describe("Codex generation", () => {
  test("dry-run exposes the exact isolated subscription invocation", () => {
    const executable = fakeCodex(temporary())
    const artifacts = join(temporary(), "artifacts")
    const output = dryRun(checkout, "sample", {
      artifactRoot: artifacts,
      codexExecutable: executable,
      fromScratch: true,
      source: fixtureSource,
      userPrompt: "Prioritize the operator workflow.",
    })
    expect(output).toContain(`${executable} exec --ignore-user-config`)
    expect(output).toContain("--model gpt-5.6-sol")
    expect(output).toContain('model_reasoning_effort="max"')
    expect(output).toContain('forced_login_method="chatgpt"')
    expect(output).toContain('model_provider="openai"')
    expect(output).toContain("features.plugins=false")
    expect(output).toContain('web_search="disabled"')
    expect(output).toContain("--sandbox read-only --ephemeral")
    expect(output).toContain(join(artifacts, "previews/.partial/sample/preview.json"))
    expect(output).toContain("<preview_direction>\nPrioritize the operator workflow.")
  })

  test("preflights, compiles, publishes, and records a valid model", async () => {
    const directory = temporary()
    const artifacts = join(directory, "artifacts")
    const executable = fakeCodex(directory)
    process.env.FAKE_PREVIEW_MODEL = fixtureModel
    const outcome = await generateProject(checkout, "sample", {
      artifactRoot: artifacts,
      codexExecutable: executable,
      fromScratch: true,
      source: fixtureSource,
      userPrompt: "Learn the new stack.",
    })
    expect(outcome.ok, outcome.message).toBeTrue()
    expect(readFileSync(join(artifacts, "previews/sample/index.html"), "utf8")).toContain(
      'data-preview-project="sample"',
    )
    expect(readRecord(join(artifacts, "previews/.records/sample.json"), "sample")?.prompt).toBe(
      "Learn the new stack.",
    )
  })

  test("removes API credential overrides from every Codex child", () => {
    process.env.OPENAI_API_KEY = "secret"
    process.env.CODEX_API_KEY = "secret"
    process.env.CODEX_ACCESS_TOKEN = "secret"
    const environment = codexEnvironment()
    expect(environment.OPENAI_API_KEY).toBeUndefined()
    expect(environment.CODEX_API_KEY).toBeUndefined()
    expect(environment.CODEX_ACCESS_TOKEN).toBeUndefined()
    delete process.env.OPENAI_API_KEY
    delete process.env.CODEX_API_KEY
    delete process.env.CODEX_ACCESS_TOKEN
  })
})

describe("CLI", () => {
  test("lists and mutates default-off sibling state", async () => {
    const parent = temporary()
    const root = join(parent, "preview")
    mkdirSync(root)
    mkdirSync(join(parent, "alpha"))
    mkdirSync(join(parent, "研究"))
    const first = capture()
    expect(await main(["list"], root, first.io)).toBe(0)
    expect(first.output()).toEqual({ stderr: "", stdout: "alpha\n研究\n" })
    const enabled = capture()
    expect(await main(["enable", "alpha"], root, enabled.io)).toBe(0)
    expect(enabled.output().stdout).toBe("enabled alpha\n")
    const status = capture()
    expect(await main(["status"], root, status.io)).toBe(0)
    expect(status.output().stdout).toBe("[x] alpha\n[ ] 研究\n")
  })

  test("compiles through the public command without invoking Codex", async () => {
    const artifacts = temporary()
    const output = capture()
    const code = await main(
      [
        "compile",
        "sample",
        "--model",
        fixtureModel,
        "--source",
        fixtureSource,
        "--artifact-root",
        artifacts,
      ],
      checkout,
      output.io,
    )
    expect(code).toBe(0)
    expect(output.output()).toEqual({ stderr: "", stdout: "compiled previews/sample\n" })
  })
})
