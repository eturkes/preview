import { createServer, type Server } from "node:http"
import { lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"
import { once } from "node:events"

export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

const allowedPaths: Readonly<Record<string, string>> = {
  "/": "index.html",
  "/app.js": "app.js",
  "/gaps.md": "gaps.md",
  "/index.html": "index.html",
  "/preview.json": "preview.json",
  "/provenance.json": "provenance.json",
  "/styles.css": "styles.css",
  "/theme.css": "theme.css",
}

const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
}

function contentType(filename: string): string {
  const extension = filename.slice(filename.lastIndexOf("."))
  return contentTypes[extension] ?? "application/octet-stream"
}

export async function startPreviewServer(bundle: string, port: number): Promise<Server> {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("port must be between 0 and 65535")
  }
  const root = resolve(bundle)
  const server = createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(404).end()
      return
    }
    let pathname: string
    try {
      pathname = decodeURIComponent((request.url ?? "").split("?", 1)[0]!)
    } catch {
      response.writeHead(404).end()
      return
    }
    const filename = allowedPaths[pathname]
    if (!filename) {
      response.writeHead(404).end()
      return
    }
    const candidate = join(root, filename)
    try {
      const metadata = lstatSync(candidate)
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("not a regular file")
      const data = readFileSync(candidate)
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": data.byteLength,
        "content-security-policy": CSP,
        "content-type": contentType(filename),
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
      })
      response.end(request.method === "HEAD" ? undefined : data)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject)
      resolvePromise()
    })
  })
  return server
}

export async function servePreview(
  bundle: string,
  port: number,
  options: { openBrowser?: boolean; signal?: AbortSignal } = {},
): Promise<void> {
  const server = await startPreviewServer(bundle, port)
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("review server has no TCP address")
  const url = `http://127.0.0.1:${address.port}/`
  console.log(`serving ${bundle} at ${url}`)
  if (options.openBrowser) {
    const opener = spawn("xdg-open", [url], { detached: true, stdio: "ignore" })
    opener.unref()
  }
  const abort = () => server.close()
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener("abort", abort, { once: true })
  try {
    await once(server, "close")
    if (options.signal?.aborted) throw options.signal.reason
  } finally {
    options.signal?.removeEventListener("abort", abort)
    server.close()
  }
}
