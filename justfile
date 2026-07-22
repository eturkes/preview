# preview quality gates — Python stdlib + trusted vanilla browser runtime.
# SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception

# List recipes.
default:
    @just --list

# Compile Python sources and run the stdlib suite.
test:
    python3 -m compileall -q src tests
    PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_*.py'

# Deterministic, token-free gate. This never invokes Codex.
ci: test
    node --check templates/app.js
    shellcheck bin/preview tools/*.sh
    git diff --check
    git diff --cached --check

# Install the checkout-bound launcher symlink.
install:
    sh tools/install.sh

# Validate and retrieve a fixture through the loopback server.
browser-probe:
    sh tools/browser_probe.sh
