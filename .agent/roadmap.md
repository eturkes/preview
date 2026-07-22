# preview — roadmap

Goal: checkout-bound CLI + long-lived WIP dashboard home for sibling projects.
`codex exec` reads one source project → strict declarative JA/EN model → trusted
deterministic compiler → offline interactive dashboard + guided tour.

Stack: Python stdlib orchestration/validation/compiler + trusted vanilla HTML/CSS/JS
runtime. Codex receives a read-only sandbox and structured-output schema; generated
data contains no executable presentation code. Published `previews/<project>/` is
reviewable and tracked; enabled selection + partial/recovery/lock state are ignored.

## Milestone ledger

- **M1 foundation** — discovery, ignored enablement state, CLI, install surface.
  STATUS: COMPLETE.
- **M2 authoring contract** — schema, evidence model, prompt, structured Codex run,
  retry. STATUS: COMPLETE.
- **M3 dashboard runtime** — deterministic compiler, JA/EN interaction, examples,
  demo reveal, accessible tour, theme presets. STATUS: COMPLETE.
- **M4 closure** — publication recovery, validation, serving, tests, browser/live
  probes, docs, install + CI. STATUS: COMPLETE.

Initial system complete. Code, tests, generated Lean-CDS canary, and history hold
the as-built detail; add future work here only when it exceeds one session.
