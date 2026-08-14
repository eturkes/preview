import { main } from "./cli.ts"

const controller = new AbortController()
process.once("SIGTERM", () => controller.abort(new Error("operation cancelled")))
process.once("SIGINT", () => controller.abort(new Error("operation cancelled")))

process.exitCode = await main(process.argv.slice(2), undefined, { signal: controller.signal })
