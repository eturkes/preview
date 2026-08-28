import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import { loadsStrict } from "../src/json.ts"
import type { PreviewModel } from "../src/model.ts"
import { compiledFiles } from "../src/render.ts"
import { validateStructure } from "../src/schema.ts"

const root = resolve(import.meta.dir, "..")
const check = process.argv.includes("--check")

for (const project of ["lean-cds", "in-progress"]) {
  const directory = join(root, "previews", project)
  const raw = await readFile(join(directory, "preview.json"))
  const model = loadsStrict(raw) as PreviewModel
  const issues = validateStructure(model, project)
  if (issues.length) throw new Error(`${project}/preview.json fails schema validation`)
  for (const [name, expected] of Object.entries(compiledFiles(model, join(root, "templates")))) {
    const path = join(directory, name)
    if (check) {
      const actual = await readFile(path)
      if (!Buffer.from(expected).equals(actual)) throw new Error(`Stale compiler canary: ${path}`)
    } else {
      await writeFile(path, expected)
    }
  }
}
