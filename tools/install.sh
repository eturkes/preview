#!/bin/sh
# Install one checkout-bound launcher symlink. No package environment is needed.
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
launcher="$root/bin/preview"
install_dir=${PREVIEW_INSTALL_BIN:-"$HOME/.local/bin"}

mkdir -p -- "$install_dir"
install_dir=$(CDPATH='' cd -- "$install_dir" && pwd -P)
destination="$install_dir/preview"

if [ -e "$destination" ] || [ -L "$destination" ]; then
  if [ ! -L "$destination" ]; then
    echo "preview install: refusing to replace non-symlink $destination" >&2
    exit 1
  fi
  current=$(readlink -f -- "$destination" || true)
  if [ "$current" != "$launcher" ]; then
    echo "preview install: refusing to replace foreign symlink $destination" >&2
    exit 1
  fi
  echo "installed $destination -> $launcher"
  exit 0
fi

temporary=$(mktemp "$install_dir/.preview-link.XXXXXX")
rm -f -- "$temporary"
trap 'rm -f -- "$temporary"' EXIT HUP INT TERM
ln -s -- "$launcher" "$temporary"
mv -T -- "$temporary" "$destination"
trap - EXIT HUP INT TERM
echo "installed $destination -> $launcher"
