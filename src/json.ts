import {
  getNodeValue,
  parseTree,
  printParseErrorCode,
  type Node,
  type ParseError,
} from "jsonc-parser"

export const MAX_JSON_BYTES = 512 * 1024
export const MAX_DEPTH = 16
export const MAX_NODES = 12_000
export const MAX_STRING_CHARS = 180_000

export class ContractJsonError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function decode(raw: string | Uint8Array): string {
  if (typeof raw === "string") {
    if (/\p{Cs}/u.test(raw)) {
      throw new ContractJsonError("json.surrogate", "JSON contains a lone surrogate")
    }
    if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BYTES) {
      throw new ContractJsonError("json.size", `JSON exceeds ${MAX_JSON_BYTES} bytes`)
    }
    return raw
  }
  if (raw.byteLength > MAX_JSON_BYTES) {
    throw new ContractJsonError("json.size", `JSON exceeds ${MAX_JSON_BYTES} bytes`)
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw)
  } catch (error) {
    throw new ContractJsonError("json.utf8", `JSON is not UTF-8: ${String(error)}`)
  }
}

function inspectTree(node: Node, source: string, depth = 0): { chars: number; nodes: number } {
  if (depth > MAX_DEPTH) {
    throw new ContractJsonError("json.depth", `JSON nesting exceeds ${MAX_DEPTH}`)
  }
  let chars = typeof node.value === "string" ? node.value.length : 0
  let nodes = 1
  if (typeof node.value === "string" && /\p{Cs}/u.test(node.value)) {
    throw new ContractJsonError("json.surrogate", "JSON strings cannot contain lone surrogates")
  }
  if (node.type === "number") {
    const lexical = source.slice(node.offset, node.offset + node.length)
    const value = Number(lexical)
    if (!Number.isFinite(value)) {
      throw new ContractJsonError("json.nonfinite", `non-finite JSON number: ${lexical}`)
    }
    if (!/[.eE]/.test(lexical) && lexical.replace(/^-/, "").length > 128) {
      throw new ContractJsonError("json.integer-range", "JSON integer exceeds 128 digits")
    }
  }
  if (node.type === "object") {
    const keys = new Set<string>()
    for (const property of node.children ?? []) {
      const keyNode = property.children?.[0]
      const valueNode = property.children?.[1]
      const key = keyNode?.value
      if (typeof key === "string") {
        if (keys.has(key)) {
          throw new ContractJsonError(
            "json.duplicate-key",
            `duplicate JSON object key: ${JSON.stringify(key)}`,
          )
        }
        keys.add(key)
        chars += key.length
        if (/\p{Cs}/u.test(key)) {
          throw new ContractJsonError(
            "json.surrogate",
            "JSON object keys cannot contain lone surrogates",
          )
        }
      }
      if (valueNode) {
        const measured = inspectTree(valueNode, source, depth + 1)
        chars += measured.chars
        nodes += measured.nodes
      }
    }
  } else {
    for (const child of node.children ?? []) {
      const measured = inspectTree(child, source, depth + 1)
      chars += measured.chars
      nodes += measured.nodes
    }
  }
  return { chars, nodes }
}

export function loadsStrict(raw: string | Uint8Array): unknown {
  const source = decode(raw)
  const errors: ParseError[] = []
  const tree = parseTree(source, errors, { allowTrailingComma: false, disallowComments: true })
  if (!tree || errors.length > 0) {
    const detail = errors[0] ? printParseErrorCode(errors[0].error) : "empty input"
    throw new ContractJsonError("json.syntax", `invalid JSON: ${detail}`)
  }
  const { chars, nodes } = inspectTree(tree, source)
  if (nodes > MAX_NODES) {
    throw new ContractJsonError(
      "json.nodes",
      `JSON contains ${nodes} nodes; maximum is ${MAX_NODES}`,
    )
  }
  if (chars > MAX_STRING_CHARS) {
    throw new ContractJsonError(
      "json.string-budget",
      `JSON contains ${chars} string characters; maximum is ${MAX_STRING_CHARS}`,
    )
  }
  return getNodeValue(tree) as unknown
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, sorted(child)]),
    )
  }
  return value
}

export function canonicalJson(value: unknown): Uint8Array {
  const encoded = JSON.stringify(sorted(value), null, 2)
  if (encoded === undefined) {
    throw new ContractJsonError("json.value", "value is not canonical JSON")
  }
  return Buffer.from(`${encoded}\n`, "utf8")
}
