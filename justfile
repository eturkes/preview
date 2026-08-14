# Preview quality gates — Bun/TypeScript + trusted vanilla browser runtime.
# SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception

# List recipes.
default:
    @just --list

test:
    pnpm test
    pnpm runtime:check

# Deterministic, token-free gate. This never invokes Codex.
ci:
    pnpm check
    pnpm exec oxlint --deny-warnings -A no-unused-vars templates/app.js templates/plugin-runtime.js
    shellcheck bin/preview tools/*.sh
    git diff --check
    git diff --cached --check

# Install the checkout-bound launcher symlink.
install:
    sh tools/install.sh

# Validate and retrieve a fixture through the loopback server.
browser-probe:
    sh tools/browser_probe.sh
