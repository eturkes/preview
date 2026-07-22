#!/bin/sh
# Deterministic HTTP/DOM probe for an existing validator-clean fixture.
set -eu

script_dir=$(dirname -- "$0")
root=$(CDPATH='' cd -- "$script_dir/.." && pwd -P)
default_bundle=$root/testdata/valid
bundle_input=${PREVIEW_PROBE_BUNDLE:-$default_bundle}
source_input=${PREVIEW_PROBE_SOURCE:-$root/testdata/source}

if [ ! -f "$bundle_input/preview.json" ]; then
  if [ -z "${PREVIEW_PROBE_BUNDLE:-}" ] && [ -z "${PREVIEW_PROBE_SOURCE:-}" ]; then
    echo "browser probe: SKIP (no complete $default_bundle fixture; set PREVIEW_PROBE_BUNDLE and PREVIEW_PROBE_SOURCE)"
    exit 0
  fi
  echo "browser probe: bundle has no preview.json: $bundle_input" >&2
  exit 1
fi
if [ ! -d "$source_input" ]; then
  if [ -z "${PREVIEW_PROBE_BUNDLE:-}" ] && [ -z "${PREVIEW_PROBE_SOURCE:-}" ]; then
    echo "browser probe: SKIP (no default source fixture; set PREVIEW_PROBE_BUNDLE and PREVIEW_PROBE_SOURCE)"
    exit 0
  fi
  echo "browser probe: source is not a directory: $source_input" >&2
  exit 1
fi

bundle=$(readlink -f -- "$bundle_input")
source=$(readlink -f -- "$source_input")
mkdir -p -- "$root/.install"
scratch=$(mktemp -d "$root/.install/browser-probe.XXXXXX")
server_pid=

cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  case $scratch in
    "$root"/.install/browser-probe.*) rm -rf -- "$scratch" ;;
    *) echo "browser probe: refusing unexpected cleanup path: $scratch" >&2 ;;
  esac
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

ready=$scratch/port
log=$scratch/server.log
python3 -I -B - "$root" "$bundle" "$source" "$ready" >"$log" 2>&1 <<'PY' &
import sys
from http.server import ThreadingHTTPServer
from pathlib import Path

root, bundle, source, ready = map(Path, sys.argv[1:])
sys.path.insert(0, str(root / "src"))

from preview_tool.schema import loads_strict  # noqa: E402
from preview_tool.server import handler_for  # noqa: E402
from preview_tool.validation import validate_bundle  # noqa: E402

data = loads_strict((bundle / "preview.json").read_bytes())
try:
    slug = data["dashboard"]["project"]["slug"]
except (KeyError, TypeError):
    slug = bundle.name
if not isinstance(slug, str):
    slug = bundle.name
report = validate_bundle(
    bundle,
    expected_slug=slug,
    source_base=source,
    artifact_home=root / "previews",
    template_dir=root / "templates",
)
if not report.ok:
    print(report.format(), file=sys.stderr, flush=True)
    raise SystemExit(1)

server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(bundle))
ready.write_text(str(server.server_address[1]) + "\n", encoding="ascii")
server.serve_forever()
PY
server_pid=$!

attempt=0
while [ ! -s "$ready" ]; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    command cat "$log" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 100 ]; then
    echo "browser probe: server did not become ready" >&2
    command cat "$log" >&2
    exit 1
  fi
  sleep 0.05
done

port=$(tr -d '\r\n' <"$ready")
case $port in
  ''|*[!0-9]*) echo "browser probe: invalid server port: $port" >&2; exit 1 ;;
esac
url=http://127.0.0.1:$port/
headers=$scratch/headers
headers_lf=$scratch/headers.lf
dom=$scratch/dom.html
curl --proto '=http' --fail --silent --show-error --max-time 10 \
  --dump-header "$headers" --output "$dom" "$url"

test -s "$dom"
tr -d '\015' <"$headers" >"$headers_lf"
LC_ALL=C command grep -Eiq '^Content-Security-Policy:' "$headers_lf"
LC_ALL=C command grep -Eiq '^Cache-Control: no-store$' "$headers_lf"
LC_ALL=C command grep -Eiq '^X-Content-Type-Options: nosniff$' "$headers_lf"
LC_ALL=C command grep -Eiq '<html([ >])' "$dom"

missing_status=$(curl --proto '=http' --silent --output /dev/null --max-time 10 \
  --write-out '%{http_code}' "$url.git/config")
test "$missing_status" = 404
echo "browser probe: curl DOM, allowlist, and security headers OK"

if [ "${PREVIEW_PROBE_CHROMIUM:-0}" = 1 ]; then
  command -v chromiumfish >/dev/null 2>&1 || {
    echo "browser probe: PREVIEW_PROBE_CHROMIUM=1 requires chromiumfish" >&2
    exit 1
  }
  command -v timeout >/dev/null 2>&1 || {
    echo "browser probe: PREVIEW_PROBE_CHROMIUM=1 requires GNU timeout" >&2
    exit 1
  }
  chromium=$(chromiumfish path)
  chromium_dom=$scratch/chromium.html
  if ! timeout --kill-after=5 20 "$chromium" \
    --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
    --no-first-run --user-data-dir="$scratch/chromium-profile" \
    --dump-dom "$url" >"$chromium_dom" 2>"$scratch/chromium.log"; then
    command tail -n 30 "$scratch/chromium.log" >&2
    exit 1
  fi
  test -s "$chromium_dom"
  LC_ALL=C command grep -Eiq '<html([ >])' "$chromium_dom"
  LC_ALL=C command grep -Eiq 'data-preview-ready="true"' "$chromium_dom"
  echo "browser probe: ChromiumFish DOM OK"
fi
