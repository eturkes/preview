import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, join } from "node:path"

const invisible = /[\p{Cf}\p{Zl}\p{Zp}]/u

export function representable(name: string): boolean {
  if (
    name.length === 0 ||
    name.startsWith(".") ||
    name.startsWith("-") ||
    /^\s/u.test(name) ||
    /\s$/u.test(name)
  ) {
    return false
  }
  for (const character of name) {
    const codepoint = character.codePointAt(0)!
    if (
      character === "/" ||
      codepoint < 0x20 ||
      (codepoint >= 0x7f && codepoint <= 0x9f) ||
      invisible.test(character)
    ) {
      return false
    }
  }
  return true
}

export function discover(root: string): string[] {
  const resolved = realpathSync(root)
  const ownName = basename(resolved)
  const parent = dirname(resolved)
  const found: string[] = []
  for (const name of readdirSync(parent)) {
    if (name === ownName || name.startsWith(".") || !representable(name)) continue
    const path = join(parent, name)
    try {
      lstatSync(path)
      if (statSync(path).isDirectory()) found.push(name)
    } catch {
      // Broken or inaccessible siblings are not discoverable.
    }
  }
  return found.sort()
}

export function requireProject(root: string, name: string): string {
  if (!representable(name) || !discover(root).includes(name)) {
    throw new Error(`unknown project ${JSON.stringify(name)}`)
  }
  return realpathSync(join(dirname(realpathSync(root)), name))
}
