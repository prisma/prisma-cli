#!/bin/zsh
set -u
ROOT=$(git rev-parse --show-toplevel)
GALLERY_DIR=${GALLERY_DIR:-$ROOT/wip/gallery}
SHOTS=$GALLERY_DIR/shots
mkdir -p "$SHOTS"
NODE=$(command -v node)
CLI=($NODE $ROOT/node_modules/tsx/dist/cli.mjs $ROOT/packages/cli/src/bin.ts)

shot() {
  local name=$1; shift
  local dir=$1; shift
  echo "== $name"
  (cd "$dir" && script -q "$SHOTS/$name.ansi" "${CLI[@]}" "$@" >/dev/null 2>&1)
}

shot root-help          "$ROOT" --help
shot version            "$ROOT" --version
shot auth-help          "$ROOT" auth --help
shot auth-whoami        "$ROOT" auth whoami
shot project-help       "$ROOT" project --help
shot project-link-help  "$ROOT" project link --help
shot migration-help     "$ROOT" migration --help
shot db-help            "$ROOT" db --help
shot feedback-help      "$ROOT" feedback --help
shot project-list       "$ROOT" project list
shot project-show       "$ROOT" project show --project prisma-next-dev
shot project-link       "$ROOT/wip/gallery/linked-demo" project show
shot postgres-list      "$ROOT/wip/gallery/linked-demo" postgres list
shot postgres-show      "$ROOT/wip/gallery/linked-demo" postgres show Development
shot bucket-list        "$ROOT/wip/gallery/linked-demo" bucket list
shot service-list       "$ROOT/wip/gallery/linked-demo" service list
shot branch-list        "$ROOT" branch list --project prisma-next-dev
shot agent-status       "$ROOT/wip/gallery/linked-demo" agent status
shot telemetry-status   "$ROOT" telemetry status
shot contract-emit      "$ROOT/wip/gallery/orm-demo" contract emit
shot db-init            "$ROOT/wip/gallery/orm-demo" db init --yes
shot db-verify          "$ROOT/wip/gallery/orm-demo" db verify
shot migration-status   "$ROOT/wip/gallery/orm-demo" migration status
shot migration-graph    "$ROOT/wip/gallery/orm-demo" migration graph
shot migration-log      "$ROOT/wip/gallery/orm-demo" migration log
shot err-unknown        "$ROOT" porject lst
shot err-missing-arg    "$ROOT" feedback --no-interactive
shot err-setup-required "$ROOT" postgres list
echo done
