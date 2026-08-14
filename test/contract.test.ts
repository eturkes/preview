import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { compileProject } from "../src/generation.ts"
import { loadsStrict } from "../src/json.ts"
import type { PreviewModel } from "../src/model.ts"
import { buildPlugin, PLUGIN_FILES } from "../src/plugin.ts"
import { compiledFiles } from "../src/render.ts"
import { validateStructure } from "../src/schema.ts"
import { validateBundle, validateModel } from "../src/validation.ts"

const root = resolve(import.meta.dir, "..")
const fixtureModel = join(root, "testdata/valid/preview.json")
const fixtureSource = join(root, "testdata/source")
const temporaryDirectories: string[] = []

function temporary(): string {
  const path = mkdtempSync(join(tmpdir(), "preview-contract-test-"))
  temporaryDirectories.push(path)
  return path
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe("declarative contract", () => {
  test("accepts the fixture and verifies every source citation", () => {
    const raw = readFileSync(fixtureModel)
    expect(validateStructure(loadsStrict(raw), "sample")).toEqual([])
    expect(validateModel(raw, "sample", fixtureSource, join(root, "previews")).ok).toBeTrue()
  })

  test("reproduces both tracked compiler canaries byte-for-byte", () => {
    for (const project of ["lean-cds", "in-progress"]) {
      const directory = join(root, "previews", project)
      const model = loadsStrict(readFileSync(join(directory, "preview.json"))) as PreviewModel
      for (const [name, expected] of Object.entries(
        compiledFiles(model, join(root, "templates")),
      )) {
        expect(
          Buffer.from(expected).equals(readFileSync(join(directory, name))),
          `${project}/${name}`,
        ).toBeTrue()
      }
    }
  })

  test("escapes model text and inline JSON terminators", () => {
    const model = loadsStrict(readFileSync(fixtureModel)) as PreviewModel
    model.dashboard.project.tagline.en = '</script><img src=x onerror="alert(1)">'
    const html = new TextDecoder().decode(
      compiledFiles(model, join(root, "templates"))["index.html"],
    )
    expect(html).not.toContain('<img src=x onerror="alert(1)">')
    expect(html).toContain("&lt;/script&gt;&lt;img")
  })
})

describe("publication and aggregate plugin", () => {
  test("compiles an external model and packages the canonical protocol plugin", async () => {
    const artifacts = temporary()
    const compiled = await compileProject(root, "sample", {
      artifactRoot: artifacts,
      modelPath: fixtureModel,
      source: fixtureSource,
    })
    expect(compiled.ok).toBeTrue()
    const report = validateBundle(
      join(artifacts, "previews/sample"),
      "sample",
      fixtureSource,
      join(artifacts, "previews"),
      join(root, "templates"),
    )
    expect(report.ok, report.format()).toBeTrue()

    const plugin = await buildPlugin(root, new Map([["sample", fixtureSource]]), {
      artifactRoot: artifacts,
      gitTrack: true,
    })
    expect(plugin.projects).toEqual(["sample"])
    expect(new Set(Array.from(new Bun.Glob("*").scanSync(plugin.output)).sort())).toEqual(
      PLUGIN_FILES,
    )
    const html = readFileSync(join(plugin.output, "index.html"), "utf8")
    expect(html).toContain("InProgressProtocol")
    expect(html).toContain("connectInProgress")
    expect(html).not.toContain('href="provenance.json"')

    const revisionCount = () =>
      spawnSync("git", ["rev-list", "--count", "HEAD"], {
        cwd: artifacts,
        encoding: "utf8",
      }).stdout.trim()
    expect(revisionCount()).toBe("1")
    expect(spawnSync("git", ["remote"], { cwd: artifacts, encoding: "utf8" }).stdout.trim()).toBe(
      "",
    )
    await buildPlugin(root, new Map([["sample", fixtureSource]]), {
      artifactRoot: artifacts,
      gitTrack: true,
    })
    expect(revisionCount()).toBe("1")
  })
})
