import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { request } from "node:http"

import { discover, representable } from "../src/discovery.ts"
import { ContractJsonError, canonicalJson, loadsStrict } from "../src/json.ts"
import {
  ProjectBusyError,
  ProjectLock,
  prepareStage,
  publish,
  requireAtomicExchangeSupport,
} from "../src/publication.ts"
import { normalizeUserPrompt, parseRecord, readRecord, writeRecord } from "../src/records.ts"
import { CSP, startPreviewServer } from "../src/server.ts"
import { applyAction, formatStatus, parseState, readState } from "../src/state.ts"

const temporaryDirectories: string[] = []

function temporary(): string {
  const path = mkdtempSync(join(tmpdir(), "preview-ts-test-"))
  temporaryDirectories.push(path)
  return path
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe("discovery and state", () => {
  test("discovers representable sibling directories and follows directory symlinks", () => {
    const parent = temporary()
    const root = join(parent, "preview")
    mkdirSync(root)
    mkdirSync(join(parent, "zeta"))
    mkdirSync(join(parent, "alpha"))
    mkdirSync(join(parent, ".hidden"))
    writeFileSync(join(parent, "plain.txt"), "x")
    symlinkSync(join(parent, "alpha"), join(parent, "alias"), "dir")
    symlinkSync(join(parent, "absent"), join(parent, "broken"), "dir")
    expect(discover(root)).toEqual(["alias", "alpha", "zeta"])
  })

  test("rejects invisible or path-sensitive names", () => {
    expect(["alpha", "two words", "研究"].every(representable)).toBeTrue()
    expect(
      [
        "",
        ".",
        "..",
        ".partial",
        "-flag",
        " lead",
        "trail ",
        "line\nbreak",
        "a/b",
        "x\u202ey",
      ].every((name) => !representable(name)),
    ).toBeTrue()
  })

  test("round-trips default-off state and reports stale selections", () => {
    const path = join(temporary(), "enabled.txt")
    expect(readState(path)).toEqual(new Set())
    expect(applyAction(path, ["a", "b"], "b", "enable")).toBeTrue()
    expect(applyAction(path, ["a", "b"], "b", "enable")).toBeTrue()
    expect(readFileSync(path, "utf8")).toBe("b\n")
    expect(formatStatus(["a"], readState(path))).toBe("[ ] a\n[!] b (missing)")
    expect(applyAction(path, ["a"], "b", "disable")).toBeFalse()
    expect(parseState("ok\n-bad\ntrailing \njoined\u2028record\n")).toEqual(new Set(["ok"]))
  })
})

describe("strict JSON and records", () => {
  test("rejects duplicate keys, non-finite numbers, deep data, and huge integers", () => {
    for (const source of [
      '{"a":1,"a":2}',
      "1e400",
      "[".repeat(18) + "0" + "]".repeat(18),
      "1".repeat(129),
    ]) {
      expect(() => loadsStrict(source)).toThrow(ContractJsonError)
    }
    expect(new TextDecoder().decode(canonicalJson({ z: 1, a: "界" }))).toBe(
      '{\n  "a": "界",\n  "z": 1\n}\n',
    )
  })

  test("normalizes prompts and atomically stores bounded records", () => {
    expect(normalizeUserPrompt("\u3000learn Bun\n")).toBe("learn Bun")
    expect(() => normalizeUserPrompt("a\0b")).toThrow("null byte")
    const path = join(temporary(), "previews/.records/sample.json")
    const record = parseRecord(
      {
        basedOnSourceRevision: null,
        project: "sample",
        prompt: "learn Bun",
        schemaVersion: 1,
        sourceDirty: false,
        sourceRevision: "a".repeat(40),
        strategy: "fresh",
      },
      "sample",
    )
    writeRecord(path, record)
    expect(readRecord(path, "sample")).toEqual(record)
  })
})

describe("publication", () => {
  test("probes and uses gap-free directory exchange", () => {
    const root = temporary()
    const output = join(root, "artifacts")
    requireAtomicExchangeSupport(output)
    expect(Array.from(new Bun.Glob("*").scanSync({ cwd: output, dot: true }))).toEqual([])

    const stage = join(root, ".partial/p")
    const backup = join(root, ".previous/p")
    const live = join(root, "p")
    mkdirSync(backup, { recursive: true })
    writeFileSync(join(backup, "old"), "old")
    prepareStage(stage, backup, live)
    writeFileSync(join(stage, "new"), "new")
    publish(stage, backup, live)
    expect(readFileSync(join(live, "new"), "utf8")).toBe("new")
  })

  test("holds a nonblocking per-project lock", async () => {
    const path = join(temporary(), ".locks/p.lock")
    const first = await ProjectLock.acquire(path)
    try {
      let blocked: unknown
      try {
        await ProjectLock.acquire(path)
      } catch (error) {
        blocked = error
      }
      expect(blocked).toBeInstanceOf(ProjectBusyError)
    } finally {
      await first.release()
    }
    const second = await ProjectLock.acquire(path)
    await second.release()
  })
})

describe("review server", () => {
  test("serves only the closed allowlist with hardening headers", async () => {
    const bundle = temporary()
    writeFileSync(join(bundle, "index.html"), "ok")
    const server = await startPreviewServer(bundle, 0)
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("test server has no port")
    const base = `http://127.0.0.1:${address.port}`
    try {
      const response = await fetch(`${base}/?lang=en`)
      expect(await response.text()).toBe("ok")
      expect(response.headers.get("content-security-policy")).toBe(CSP)
      expect(response.headers.get("cache-control")).toBe("no-store")
      for (const path of ["/.git/config", "/%2e%2e%2findex.html", "/missing"]) {
        const status = await new Promise<number | undefined>((resolve, reject) => {
          const call = request({ host: "127.0.0.1", path, port: address.port }, (rawResponse) => {
            rawResponse.resume()
            resolve(rawResponse.statusCode)
          })
          call.once("error", reject)
          call.end()
        })
        expect(status).toBe(404)
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
