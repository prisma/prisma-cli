/**
 * A workspace reaches the CLI under two ids for the same workspace: a
 * credential's `workspace_id` claim carries the bare id, while the
 * management API and anything derived from it carry the same id behind
 * a `wksp_` prefix. Comparing the two forms directly silently matches
 * nothing, so every comparison between workspace ids of different
 * origin goes through here.
 */
const WORKSPACE_ID_PREFIX = "wksp_";

export function stripWorkspacePrefix(value: string): string {
  return value.startsWith(WORKSPACE_ID_PREFIX)
    ? value.slice(WORKSPACE_ID_PREFIX.length)
    : value;
}

export function sameWorkspaceId(left: string, right: string): boolean {
  return stripWorkspacePrefix(left) === stripWorkspacePrefix(right);
}
