export type Finding = {
  code: string
  message: string
  path: string
  severity: "error"
}

export class Report {
  constructor(readonly findings: readonly Finding[] = []) {}

  get ok(): boolean {
    return this.findings.length === 0
  }

  format(): string {
    return this.findings.map(formatFinding).join("\n")
  }
}

export function finding(code: string, path: string, message: string): Finding {
  return { code, message, path, severity: "error" }
}

export function escapeControls(value: unknown): string {
  return String(value).replace(
    /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )
}

export function formatFinding(row: Finding): string {
  return `[${row.severity.toUpperCase()}] ${escapeControls(row.code)} ${escapeControls(row.path)}: ${escapeControls(row.message)}`
}
