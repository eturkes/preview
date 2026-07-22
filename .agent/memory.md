# Durable project memory

- Repository = checkout-bound program + preview home. Source projects = direct
  siblings; writes stay inside this checkout.
- Codex authors `preview.json` only under strict schema, from source-project cwd in
  a read-only ephemeral sandbox. Harness compiles trusted HTML/CSS/JS and promotes
  only validator-clean bundles.
- Canonical gate target: `just ci`; authenticated spend stays explicit.
- Local review server is loopback-only development infrastructure, never a
  production server.
- Tracked `previews/lean-cds/` = live end-to-end canary. Canonical deterministic
  smoke: `preview validate lean-cds`, then set `PREVIEW_PROBE_BUNDLE` and
  `PREVIEW_PROBE_SOURCE` for `tools/browser_probe.sh`.
- This container's Chromium software-GL path can stall before DOM output. Treat
  curl DOM/header checks as transport evidence and report JS execution as
  unconfirmed when the opt-in Chromium probe fails.
