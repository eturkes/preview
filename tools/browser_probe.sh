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

cd -- "$root"
slug=$(pnpm exec bun tools/model-slug.ts "$bundle/preview.json")
artifact_root=$scratch/artifacts
bin/preview compile "$slug" \
  --source "$source" \
  --artifact-root "$artifact_root" \
  --model "$bundle/preview.json" >/dev/null
compiled_bundle=$artifact_root/previews/$slug

if [ -f "$bundle/index.html" ]; then
  for name in app.js gaps.md index.html preview.json provenance.json styles.css theme.css; do
    if [ ! -f "$bundle/$name" ]; then
      echo "browser probe: bundle is incomplete: $bundle/$name" >&2
      exit 1
    fi
    cmp -- "$bundle/$name" "$compiled_bundle/$name"
  done
fi

log=$scratch/server.log
bin/preview serve "$slug" \
  --source "$source" \
  --artifact-root "$artifact_root" \
  --port 0 >"$log" 2>&1 &
server_pid=$!

attempt=0
while ! LC_ALL=C command grep -Eq 'http://127[.]0[.]0[.]1:[0-9]+/' "$log"; do
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

url=$(sed -n 's|.*\(http://127[.]0[.]0[.]1:[0-9][0-9]*/\).*|\1|p' "$log" | sed -n '1p')
case $url in
  http://127.0.0.1:[0-9]*) ;;
  *) echo "browser probe: invalid server URL: $url" >&2; exit 1 ;;
esac

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
  if ! timeout --kill-after=5 30 pnpm exec bun \
    "$root/tools/browser_runtime_probe.mjs" "$url" "$debug_port"; then
    command tail -n 30 "$scratch/chromium.log" >&2
    exit 1
  fi
  echo "browser probe: Chromium runtime OK"
fi
