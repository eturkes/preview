#!/bin/sh
# Token-free HTTP/runtime probe for a validator-clean fixture.
set -eu

script_dir=$(dirname -- "$0")
root=$(CDPATH='' cd -- "$script_dir/.." && pwd -P)
default_bundle=$root/testdata/valid
bundle_input=${PREVIEW_PROBE_BUNDLE:-$default_bundle}
source_input=${PREVIEW_PROBE_SOURCE:-$root/testdata/source}

if [ ! -f "$bundle_input/preview.json" ]; then
  echo "browser probe: bundle has no preview.json: $bundle_input" >&2
  exit 1
fi
if [ ! -d "$source_input" ]; then
  echo "browser probe: source is not a directory: $source_input" >&2
  exit 1
fi

bundle=$(readlink -f -- "$bundle_input")
source=$(readlink -f -- "$source_input")
mkdir -p -- "$root/.install"
scratch=$(mktemp -d "$root/.install/browser-probe.XXXXXX")
server_pid=
chromium_pid=

stop_process() {
  stop_pid=$1
  [ -n "$stop_pid" ] || return 0
  kill "$stop_pid" 2>/dev/null || true
  stop_attempt=0
  while kill -0 "$stop_pid" 2>/dev/null; do
    stop_attempt=$((stop_attempt + 1))
    if [ "$stop_attempt" -ge 20 ]; then
      kill -KILL "$stop_pid" 2>/dev/null || true
      break
    fi
    sleep 0.05
  done
  wait "$stop_pid" 2>/dev/null || true
}

cleanup() {
  stop_process "$chromium_pid"
  stop_process "$server_pid"
  case $scratch in
    "$root"/.install/browser-probe.*) rm -rf -- "$scratch" ;;
    *) echo "browser probe: refusing unexpected cleanup path: $scratch" >&2 ;;
  esac
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

default_bundle_resolved=$(readlink -f -- "$default_bundle")
if [ "$bundle" = "$default_bundle_resolved" ] && [ ! -f "$bundle/index.html" ]; then
  compiled_bundle=$scratch/bundle
  python3 -I -B - "$root" "$bundle" "$compiled_bundle" <<'PY'
import sys
from pathlib import Path

root, model_dir, target = map(Path, sys.argv[1:])
sys.path.insert(0, str(root / "src"))

from preview_tool.render import compiled_files  # noqa: E402
from preview_tool.schema import loads_strict, validate_structure  # noqa: E402

raw = (model_dir / "preview.json").read_bytes()
data = loads_strict(raw)
slug = data.get("dashboard", {}).get("project", {}).get("slug") if isinstance(data, dict) else None
issues = validate_structure(data, slug if isinstance(slug, str) else None)
if issues:
    for issue in issues:
        print(f"[{issue.code}] {issue.path}: {issue.message}", file=sys.stderr)
    raise SystemExit(1)
target.mkdir()
(target / "preview.json").write_bytes(raw)
for name, content in compiled_files(data, root / "templates").items():
    (target / name).write_bytes(content)
PY
  bundle=$compiled_bundle
fi
if [ "$bundle" != "$scratch/bundle" ]; then
  snapshot_bundle=$scratch/bundle
  python3 -I -B - "$root" "$bundle" "$source" "$snapshot_bundle" <<'PY'
import sys
from pathlib import Path

root, bundle, source, target = map(Path, sys.argv[1:])
sys.path.insert(0, str(root / "src"))

from preview_tool.render import compiled_files  # noqa: E402
from preview_tool.schema import MAX_JSON_BYTES, loads_strict  # noqa: E402
from preview_tool.validation import BUNDLE_FILES, read_bounded_regular, validate_bundle  # noqa: E402

raw = read_bounded_regular(bundle / "preview.json", MAX_JSON_BYTES)
data = loads_strict(raw)
slug = data.get("dashboard", {}).get("project", {}).get("slug") if isinstance(data, dict) else None
report = validate_bundle(
    bundle,
    expected_slug=slug if isinstance(slug, str) else bundle.name,
    source_base=source,
    artifact_home=root / "previews",
    template_dir=root / "templates",
)
if not report.ok:
    print(report.format(), file=sys.stderr)
    raise SystemExit(1)
expected = compiled_files(data, root / "templates")
limits = {"preview.json": MAX_JSON_BYTES, **{name: len(content) for name, content in expected.items()}}
target.mkdir()
for name in sorted(BUNDLE_FILES):
    payload = read_bounded_regular(bundle / name, limits[name])
    if len(payload) > limits[name]:
        raise ValueError(f"bundle entry grew during snapshot: {name}")
    (target / name).write_bytes(payload)
PY
  bundle=$snapshot_bundle
fi

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
  if [ "$attempt" -ge 200 ]; then
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
  if [ -n "${PREVIEW_PROBE_CHROMIUM_BIN:-}" ]; then
    chromium=$PREVIEW_PROBE_CHROMIUM_BIN
    [ -x "$chromium" ] || {
      echo "browser probe: PREVIEW_PROBE_CHROMIUM_BIN is not executable: $chromium" >&2
      exit 1
    }
  else
    command -v chromiumfish >/dev/null 2>&1 || {
      echo "browser probe: PREVIEW_PROBE_CHROMIUM=1 requires chromiumfish or PREVIEW_PROBE_CHROMIUM_BIN" >&2
      exit 1
    }
    chromium=$(chromiumfish path)
  fi
  command -v timeout >/dev/null 2>&1 || {
    echo "browser probe: PREVIEW_PROBE_CHROMIUM=1 requires GNU timeout" >&2
    exit 1
  }
  "$chromium" --version
  chromium_profile=$scratch/chromium-profile
  "$chromium" \
    --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
    --no-first-run --user-data-dir="$chromium_profile" \
    --remote-debugging-port=0 "$url" >"$scratch/chromium.stdout" 2>"$scratch/chromium.log" &
  chromium_pid=$!
  devtools_port=$chromium_profile/DevToolsActivePort
  attempt=0
  while [ ! -s "$devtools_port" ]; do
    if ! kill -0 "$chromium_pid" 2>/dev/null; then
      command tail -n 30 "$scratch/chromium.log" >&2
      exit 1
    fi
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 200 ]; then
      echo "browser probe: Chromium DevTools port did not become ready" >&2
      command tail -n 30 "$scratch/chromium.log" >&2
      exit 1
    fi
    sleep 0.05
  done
  debug_port=$(sed -n '1p' "$devtools_port")
  case $debug_port in
    ''|*[!0-9]*) echo "browser probe: invalid Chromium DevTools port: $debug_port" >&2; exit 1 ;;
  esac
  if ! timeout --kill-after=5 30 node --experimental-websocket \
    "$root/tools/browser_runtime_probe.mjs" "$url" "$debug_port"; then
    command tail -n 30 "$scratch/chromium.log" >&2
    exit 1
  fi
  echo "browser probe: Chromium runtime OK"
fi
