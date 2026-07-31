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

1. Codex inspects one source checkout and returns an untrusted, strict JSON
   model: project copy, views, components, tour, provenance, and gaps.
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
dependencies. Development additionally uses `just`, Node.js, ShellCheck, Git,
and curl; the optional browser probe uses ChromiumFish plus GNU `timeout`.

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

preview validate lean-cds
preview serve lean-cds --port 4173
preview serve lean-cds --port 0      # kernel-selected loopback port
preview serve lean-cds --open
```

This repository tracks [`previews/lean-cds/`](previews/lean-cds/) as a generated
end-to-end canary and concrete example of the output contract. Regenerate it
only when an authenticated Codex run and evidence review are intentional.

| Command | Effect |
| --- | --- |
| `list` | List representable direct sibling projects. |
| `status` | Show enabled/disabled siblings and stale enabled names. |
| `enable NAME` | Enable a current sibling. |
| `disable NAME` | Disable a current or stale enabled name. |
| `toggle NAME` | Flip a current sibling, or clear a stale enabled name. |
| `generate [NAME] [--dry-run]` | Generate one project or the enabled set. |
| `validate NAME` | Revalidate one published bundle against its current sibling. |
| `serve NAME [--port N] [--open]` | Validate, then serve one bundle on loopback. |

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
```

Publication promotes complete directories with a live-to-backup, stage-to-live
rename sequence and rollback. A per-project nonblocking advisory lock coordinates
participating generation, validation, and serving processes; a subsequent attempt
recovers an interrupted transition. Uncoordinated filesystem readers can observe
the brief rename gap, and the lock is not confinement against hostile actors.

`serve` holds that project lock for the review server's lifetime, so a concurrent
generation of the same project fails closed instead of mixing files from two
bundle generations. Stop the server before regenerating that project.

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
`Blocked`, `Gap`) from evidence confidence (`Verified`, `Inferred`, `Evidence
gap`) for every claim-bearing node. The JSON sidecar remains the complete
machine-reviewable projection.

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

## Development

```sh
just test           # stdlib compile + unittest suite
just ci             # test + Node syntax + ShellCheck + git diff checks; no Codex
just browser-probe  # validate + curl a fixture; optional real Chromium DOM dump
PREVIEW_PROBE_CHROMIUM=1 just browser-probe
```

The browser probe uses `PREVIEW_PROBE_BUNDLE` and `PREVIEW_PROBE_SOURCE`, or
`testdata/valid` and `testdata/source` when present. With no default fixture it
prints a skip message. It exercises only deterministic validation, loopback
serving, headers, and DOM retrieval; it never invokes Codex and deliberately
avoids screenshot/pixel assertions.
If ChromiumFish stalls in the known software-GL initialization path, the curl
DOM/header probe remains valid evidence but JavaScript execution is unconfirmed;
the opt-in Chromium probe exits nonzero rather than claiming success.

GitHub CI runs `just ci` without Codex credentials or generation. Local and CI
gates may create ignored Python bytecode only; they do not format sources.

Licensed under [Apache-2.0 WITH LLVM-exception](LICENSE).
