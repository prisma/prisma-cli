#!/usr/bin/env bash

# One-shot registry maintenance for the latest-tag cutover
# (rollout-plan step 5). Everything here needs real npm auth, which the
# publish workflow's OIDC cannot provide: OIDC authenticates publishes,
# and these commands touch already-published versions.
#
# Usage:
#   export NPM_TOKEN=...   # an automation token, so no 2FA prompt
#   bash scripts/cutover-dist-tags.sh
#
# The token is read from the environment and never echoed.

set -euo pipefail

if [ -z "${NPM_TOKEN:-}" ]; then
  echo "NPM_TOKEN is not set. Export it first (an npm automation token)." >&2
  exit 1
fi

npmrc=$(mktemp)
trap 'rm -f "$npmrc"' EXIT
echo "//registry.npmjs.org/:_authToken=\${NPM_TOKEN}" > "$npmrc"

run() {
  echo "+ $*"
  NPM_CONFIG_USERCONFIG="$npmrc" "$@"
}

# The engine's tags went stale because publish-packages.sh tolerates an
# already-published version by skipping it, which also skips the tag
# move. Point latest at the newest published engine and drop its stale
# next tag: since the cutover, releases publish under latest only and
# next is retired (docs/oss/versioning.md).
run npm dist-tag add @prisma/cli-engine@0.2.3 latest
run npm dist-tag rm @prisma/cli-engine next

# next froze at the last pre-cutover RC on the CLI names. Remove it so
# prisma@next stops resolving an ever-older release; text that says
# prisma@next should move to plain prisma.
run npm dist-tag rm prisma next
run npm dist-tag rm @prisma/cli next

# Deprecations from the rollout plan, step 5:
#   prisma-next    — already deprecated (operator, 2026-08-24).
#   prisma-composer — left alone (operator ruling, 2026-08-25).
#   @prisma/cli    — undecided: this repo still publishes it as the
#                    scoped twin of the bare name. Uncomment to point
#                    installers at `prisma` instead:
# run npm deprecate @prisma/cli@"<8.0.0" "The unified Prisma CLI ships as 'prisma'. Install prisma instead."

echo "Done."
