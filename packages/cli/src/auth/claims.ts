/**
 * The credential's own claims. The implementation lives in the engine
 * so both credential managers read a token the same way; these are the
 * names the CLI already uses.
 */
export {
  claimedExpiresAt,
  claimedIdentity,
  claimedWorkspaceId,
  /** The workspace a service token names, whether through its
   *  `workspace_id` claim or its `workspace:`-prefixed subject. */
  credentialWorkspaceId as serviceTokenWorkspaceId,
} from "@prisma/cli-engine";
