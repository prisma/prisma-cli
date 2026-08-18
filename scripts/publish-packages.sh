#!/usr/bin/env bash

# Usage: publish-packages.sh <dist-tag> <package>...
#
# `pnpm publish` for each package, treating an already-published version
# as done: a re-run of a partially failed workflow run must reach the
# later steps. Every other failure fails the run.

set -euo pipefail

tag="$1"
shift

for pkg in "$@"; do
  if out=$(pnpm --filter "$pkg" publish --tag "$tag" --access public --no-git-checks 2>&1); then
    printf '%s\n' "$out"
  else
    printf '%s\n' "$out"
    if grep -qiE 'E409|EPUBLISHCONFLICT|cannot publish over|previously published' <<<"$out"; then
      echo "$pkg: this version is already on the registry — continuing."
    else
      exit 1
    fi
  fi
done
