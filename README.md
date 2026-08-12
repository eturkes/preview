# preview

`preview` turns projects beside this checkout into work-in-progress, interactive
Japanese/English dashboard UIs with guided tours. It explains a project through
a concrete example while showing its evidence-backed present state. The
checkout is both the program home and the long-lived preview home.

```text
~/Projects/
├── preview/            # this checkout
├── lean-cds/           # discoverable source project
└── another-project/    # discoverable source project
```

Direct sibling directories and directory symlinks are discoverable. Projects
start disabled: `enabled.txt` is an ignored, persistent local selection, and a
named generation may target any current sibling without enabling it first.

## Design

The trust boundary is deliberate:

1. Codex or a deliberate direct review supplies an untrusted, strict JSON model:
   project copy, views, components, tour, provenance, and gaps.
2. Stdlib Python validates and canonicalizes that model, verifies its evidence
   references, and compiles it with repository-owned templates.
3. Only a validator-clean stage replaces the published bundle.

Codex never authors executable HTML, CSS, or JavaScript. Keeping model output
declarative makes the interaction, accessibility, CSP, themes, and tour behavior
one reviewable trusted runtime rather than project-specific generated code. It
reduces the attack and review surface; it does not make model claims true or
the output safe without human review.

Every user-visible localized field has independent nonempty `ja` and `en`
values, Japanese is the initial locale, and the runtime switches the whole
dashboard. This is a real bilingual information model rather than translated
navigation around single-language content. Structural validation cannot judge
translation fluency or semantic parity. Every dashboard includes:

- an **example** to make the project's core transformation demonstrable rather
  than merely described;
- a **state** view to separate implemented, active, planned, blocked, and
  uncertain work; and
- a **tour** to connect motivation, interface orientation, example, demo reveal,
  and current state into one short narrative.

The demo is a deterministic reveal of pre-authored, source-grounded content. It
does not call the source project or pretend to be a live backend.

## Requirements and install

Runtime: Linux, Python 3.11+, GNU `timeout`, and an authenticated
[`codex`](https://github.com/openai/codex) CLI. Serving needs no Python package
dependencies. Development additionally uses `just`, Node.js 20.10+, ShellCheck,
Git, and curl; the optional browser probe uses ChromiumFish plus GNU `timeout`,
and its interaction run enables Node's built-in `WebSocket` client.

```sh
just install
export PATH="$HOME/.local/bin:$PATH" # if it is not already present
preview --version
```

`just install` creates a checkout-bound symlink at `~/.local/bin/preview`.
Override it with `PREVIEW_INSTALL_BIN=/absolute/bin just install`. Re-running is
safe for this checkout; the installer refuses to replace a regular file or a
foreign symlink. Keep the checkout at its installed path. With no `just`, run
`sh tools/install.sh` directly.

## Use

> [!WARNING]
> `generate` spends Codex tokens. Each project gets at most two 30-minute Codex
> attempts: invalid output or a failed Codex process triggers one complete
> retry with repair feedback. A batch can therefore spend two invocations per
> enabled project. No model or reasoning effort is pinned; active Codex
> configuration controls quality, cost, and latency. Inspect the exact command
> and complete stdin prompt with `--dry-run` first.

### First success

From this checkout, with a direct sibling source project named `PROJECT`:

```sh
preview list
preview generate --dry-run PROJECT  # review the exact command and prompt
preview generate PROJECT
preview serve PROJECT --open        # validate, then open the loopback review UI
preview plugin-build                # validate current publishes, then build one in-progress plugin
```

Generation prints the host-read and disclosure warning before spending tokens.
Stop the review server before regenerating the same project.

### Command reference

```sh
preview list
preview status
preview enable lean-cds
preview disable lean-cds
preview toggle lean-cds

preview generate --dry-run lean-cds  # exact named plan; no Codex
preview generate lean-cds            # one current sibling
preview generate --dry-run           # plans for the enabled set; no Codex
preview generate                     # enabled set, sequentially

preview compile lean-cds              # recompile the published model; no Codex
preview compile lean-cds --model /path/to/preview.json  # validate + atomically publish a model
preview validate lean-cds
preview serve lean-cds --port 4173
preview serve lean-cds --port 0      # kernel-selected loopback port
preview serve lean-cds --open
preview plugin-build                 # dist/in-progress-plugin
```

This repository tracks [`previews/lean-cds/`](previews/lean-cds/) as a generated
compiler canary and [`previews/in-progress/`](previews/in-progress/) as the
source-cited dashboard selected by the in-progress plugin for project ID
`in-progress`. Run `preview compile NAME` after the compiler, trusted templates,
or other deterministic renderer inputs change. For any model edit, keep the
candidate outside the reserved `previews/` tree and run
`preview compile NAME --model FILE`. The command accepts one bounded regular
non-symlink JSON file, validates its
schema and current-source citations, compiles an empty stage, validates the
closed bundle, and atomically publishes it without invoking Codex. A failure
before promotion preserves the prior live bundle. Backup-cleanup failure after
promotion leaves recoverable `.previous` residue and still reports success; the
next locked operation removes that residue.

| Command | Effect |
| --- | --- |
| `list` | List representable direct sibling projects. |
| `status` | Show enabled/disabled siblings and stale enabled names. |
| `enable NAME` | Enable a current sibling. |
| `disable NAME` | Disable a current or stale enabled name. |
| `toggle NAME` | Flip a current sibling, or clear a stale enabled name. |
| `generate [NAME] [--source PATH] [--dry-run]` | Generate one project or the enabled set. Explicit source requires `NAME` and supports non-sibling checkouts. |
| `compile NAME [--model FILE] [--source PATH]` | Validate, compile, and atomically publish a declarative model without Codex. Explicit source supports non-sibling checkouts. |
| `validate NAME [--source PATH]` | Revalidate one published bundle against its current or explicit source. |
| `serve NAME [--source PATH] [--port N] [--open]` | Validate, then serve one bundle on loopback. |
| `plugin-build [--source NAME PATH]...` | Validate current-source publishes and build one static in-progress plugin. Explicit mappings support non-sibling checkouts. |

### in-progress plugin

`preview plugin-build` validates every non-hidden published bundle that still
has a current source against that source and the trusted templates, then
atomically replaces `dist/in-progress-plugin/`. With no `--source`, current
sources are direct siblings. One or more explicit `--source NAME PATH` mappings
replace sibling discovery for nested/submodule layouts. Stale publishes without
a mapped/current source are excluded with a warning; any included validation
failure preserves the prior plugin. The aggregate build locks every current
project before discovering publishes, so a concurrent generation/compile rename
gap fails closed instead of silently omitting a dashboard. The output has two
files: a strict `in-progress.plugin.json` manifest and one self-contained `index.html`; it
performs no Codex call and requests no host capabilities.

Configure that output directory in in-progress and restart its host. The plugin
accepts the API 1.0 `MessageChannel` handshake, matches the selected in-progress
`project.id` to an exact Preview project slug, and initializes only that
dashboard. A selected project without a packaged publish gets a visible
bilingual unavailable state. All trusted CSS and JavaScript are inline so the
dashboard works in in-progress's opaque-origin iframe without weakening the
canonical bundle CSP or file contract.

The plugin consumes the validated host `theme.mode` and a narrow allowlist of
hex color and plain font-name tokens. Explicit host light/dark mode overrides
only the packaged frame; standalone bundles retain their OS
`prefers-color-scheme` behavior. The aggregate omits standalone links to raw
`provenance.json` and `gaps.md` sidecars because those files are not packaged or
public; the complete evidence inspector and gap ledger remain in the entry.

The plugin is a derived aggregate snapshot. Re-run `plugin-build` after any
publish changes. Canonical `previews/<project>/` directories remain unchanged
and independently validator-clean.

An empty enabled set succeeds. Batch generation continues after failures and
exits nonzero if any target failed. Named generation failures use stderr;
validation findings are printed before a nonzero exit. Final invalid output
remains staged for inspection; an existing published bundle is preserved.

### Exact Codex boundary

For each attempt, the harness runs from the sibling source root and sends the
authoring contract plus runtime assignment on stdin. The effective invocation
is:

```text
timeout --kill-after=30 1800 codex exec \
  --sandbox read-only --ephemeral --skip-git-repo-check \
  --output-schema <preview>/templates/author-output.schema.json \
  --output-last-message <preview>/previews/.partial/NAME/preview.json \
  --color never -C <sibling-source> -
```

`--sandbox read-only` prevents Codex tools from modifying the source;
`--ephemeral` avoids retaining a Codex session; the output schema constrains the
last message; and the host Codex CLI writes that last message into the harness's
stage. The prompt also directs read-only inspection and filesystem silence.

This is a write boundary, **not a source-only read boundary**. Codex and its tool
calls can read any host-readable path, and content can reach the model provider
before final-output validation. The secret scan cannot undo such upstream
disclosure. Generate only from a trusted checkout, treat repository instructions
as a prompt-injection surface, and review host privacy/authorization first. The
CLI repeats this warning before every token-spending batch or named generation.

## State, publication, and evidence

```text
enabled.txt                            ignored local selection
previews/<project>/                    published, reviewable bundle
  index.html
  styles.css
  theme.css
  app.js
  preview.json                         canonical declarative model
  provenance.json
  gaps.md
previews/.partial/<project>/           ignored generation/failure stage
previews/.previous/<project>/          ignored crash-recovery backup
previews/.locks/<project>.lock         ignored advisory project lock
dist/in-progress-plugin/               ignored derived aggregate plugin
  in-progress.plugin.json
  index.html
```

Publication promotes complete directories with a live-to-backup, stage-to-live
rename sequence and rollback. A per-project nonblocking advisory lock coordinates
participating generation, validation, and serving processes; a subsequent attempt
recovers an interrupted transition. Uncoordinated filesystem readers can observe
the brief rename gap, and the lock is not confinement against hostile actors.

`serve` holds that project lock for the review server's lifetime, so concurrent
generation or compilation of the same project fails closed instead of mixing
files from two bundle generations. Stop the server before republishing that
project.

Every nonempty claim reference - project status, code excerpt, or factual item -
must have exactly one used provenance row. `verified` and `inferred` rows cite a
source-relative inclusive line range (`path/to/file:L1-L3`) and a verbatim
substring that the validator finds in that final slice. Code text must exactly
equal its verified provenance quote. `gap` claims have no citation; structured
`gaps.md` records what was checked and the smallest useful human follow-up. Paths
must resolve inside the source tree and away from the artifact home. Repeated
citations decode each source once; unique cited source content is capped at 32
MiB per validation.

The dashboard visibly separates workflow state (`Current`, `Planned`, `Done`,
`Blocked`, `Gap`) from evidence confidence (`Source matched`, `Inferred`,
`Evidence gap`) for every claim-bearing node. Activating an evidence badge opens
the in-page evidence inspector with the localized claim and status, plus any
source range and matched quote. The separate gap ledger shows every recorded
unresolved topic, what was checked, and the smallest useful follow-up.
`provenance.json` and `gaps.md` remain the raw review sidecars.

`Source matched` means only that the validator found the quoted text in the
declared final source range. It is not independent proof of truth, context,
sufficiency, freshness, or translation parity.

Those are structural and literal-occurrence guarantees only. Validation cannot
prove truth, sufficiency, context, attribution, translation quality, or absence
of cherry-picking. The authoring prompt prohibits secrets, PHI, identifiers,
unsafe excerpts, markup, and URLs, but there is no complete deterministic
sensitive-data detector. Review every published or retained staged byte before
committing, sharing, or serving it.

> [!CAUTION]
> `serve` is a loopback-only review server with an explicit file allowlist and
> defensive response headers. It is not hardened production hosting. `--open`
> delegates to the local browser configuration; use only with reviewed bundles.

### Reviewer checklist

- Switch between JA and EN; check meaning, specificity, and safe terminology.
- Open each evidence badge; compare the claim and status with any source range
  and matched quote.
- Review every gap's checked evidence and follow-up; accept or resolve it explicitly.
- Run `preview validate PROJECT [--source PATH]` against the intended source checkout.
- Inspect published and retained staged bytes for secrets, identifiers, unsafe
  excerpts, and claims that exceed their evidence before sharing or committing.

## Development

```sh
just test           # stdlib compile + Python suite + plugin handshake unit probe
just ci             # test + Node syntax + ShellCheck + git diff checks; no Codex
just browser-probe  # validate + curl a fixture; optional Chromium interaction probe
PREVIEW_PROBE_CHROMIUM=1 just browser-probe
```

The browser probe defaults to the tracked `testdata/valid` model and
`testdata/source`; override both paths with a complete validator-clean bundle
and its source tree. The opt-in interaction run requires populated `verified`,
`inferred`, and `gap` claims and accepts an explicit browser path through
`PREVIEW_PROBE_CHROMIUM_BIN`. The probe exercises
deterministic validation, loopback serving, headers, and DOM retrieval; the
Chromium run also exercises evidence deep links, filters, modal focus/close
behavior, and tour exclusivity. It never invokes Codex and deliberately avoids
screenshot/pixel assertions. If Chromium stalls in the known software-GL
initialization path, the curl DOM/header probe remains valid evidence but
JavaScript execution is unconfirmed; the opt-in Chromium probe exits nonzero
rather than claiming success.

GitHub CI runs `just ci` plus the tracked browser fixture without Codex
credentials or generation. Local and CI gates may create ignored Python
bytecode and browser scratch under `.install/`; handled exits clean the scratch.
The gates do not format sources.

Licensed under [Apache-2.0 WITH LLVM-exception](LICENSE).
