import { readBoundedRegular } from "../src/files.ts"
import { loadsStrict, MAX_JSON_BYTES } from "../src/json.ts"
import { representable } from "../src/discovery.ts"

const path = process.argv[2]
if (!path) throw new Error("usage: model-slug MODEL")

const model = loadsStrict(readBoundedRegular(path, MAX_JSON_BYTES))
if (model === null || typeof model !== "object" || Array.isArray(model)) {
  throw new Error("preview model must be an object")
}
const dashboard = (model as Record<string, unknown>).dashboard
if (dashboard === null || typeof dashboard !== "object" || Array.isArray(dashboard)) {
  throw new Error("preview model dashboard must be an object")
}
const project = (dashboard as Record<string, unknown>).project
if (project === null || typeof project !== "object" || Array.isArray(project)) {
  throw new Error("preview model project must be an object")
}
const slug = (project as Record<string, unknown>).slug
if (typeof slug !== "string" || !representable(slug)) {
  throw new Error("preview model has an invalid project slug")
}
process.stdout.write(`${slug}\n`)
