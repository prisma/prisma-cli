---
name: prisma-agent-enrollment
metadata:
  library: "prisma"
  library_version: "8.0.0-rc.19"
  version: 2026.9.30
description: >-
  Connect an AI agent to Prisma through the Prisma MCP server. Use for agent
  enrollment, workspace access, approval requests, or any Prisma Platform
  operation performed by an enrolled agent.
---

# Connect to Prisma

Use the Prisma MCP connection for cloud operations. The MCP client owns OAuth
sign-in and credential storage. Do not request a person's API token, read the
CLI's human credentials, put credentials in chat, or call the Management API
directly to bypass this connection's policy.

## Install and sign in

1. If the Prisma MCP connection is missing, run `prisma agent install` in the
   project. Use `--client codex`, `--client claude`, or `--client cursor` to
   configure only that client. Restart the client if it does not reload MCP
   configuration automatically.
2. Connect to `https://mcp.prisma.io/mcp` through the client's OAuth sign-in.
   Present the sign-in link when the client asks. The person signs in and
   authorizes the connection; the client stores and refreshes its credential.
3. Call `get_agent_connection`. This confirms the enrolled agent identity,
   allowed workspace IDs, and permission policy. Reconnecting the same OAuth
   client reuses the agent. Do not create another identity to escape a pause
   or a revoked connection.
4. Start with the default workspace. Use a different `workspaceId` on tools
   only when it appears in the connection's allowed workspace list. The sponsor
   changes this list in Console under Settings → Agents → Permissions.

Discover the available MCP tools and use them for projects, branches,
databases, compute apps and deployments, buckets, queries, and schema changes.
Do not assume a tool exists: inspect its schema before calling it. If an
operation is unavailable, explain the missing capability instead of switching
silently to a person's CLI session or direct API requests. Local code editing,
builds, and tests do not need cloud credentials.

## Wait for approval

A tool can return `approval_required` with `approvalId`, `approveUrl`, and
`expiresAt`. Show the approval link and one sentence explaining the action.
Keep working on independent tasks while the decision is pending.

When the harness supports MCP Events and the server advertises `events`, use
its native event subscription to `prisma.approval.resolved`, filtered by
`approvalId`. The harness supplies the verified HTTPS callback and signing
secret. Let the harness verify signatures and manage refresh and unsubscribe.
Do not invent a callback URL, create a public receiver, or assume that ordinary
MCP support includes Events support. After subscribing, read
`get_agent_approval` once so a decision made before subscription is not missed.

If Events is unavailable, call `get_agent_approval` every five seconds until
`approved`, `approved_window`, `denied`, or `expired`. Stop at the returned
expiry time. Never ask the person to type "done" to signal a decision.

After approval, retry the original tool with the exact same arguments and
`approvalId`. An approval cannot authorize changed arguments. A one-hour grant
can cover other actions of the same kind in its workspace, project, and branch
role; retry blocked actions through MCP so the server decides which are covered.
After denial, stop that action. After expiry, read the status again before any
retry; a late approval may still be valid. Do not repeatedly create new requests
without telling the person why the old request expired.

Use `reason` for a short explanation on sensitive operations. Never include
secrets or connection strings in it. Pause and revocation take effect on the
next request. Membership removal also removes access, even if the workspace
still appears in an older tool response.

## GitHub deployment

Deploy from the linked repository's GitHub Actions workflow. The workflow uses
`prisma/cloud-deploy-action@v1` with `id-token: write` and GitHub OIDC. Do not
store a Prisma service token in the repository. Inspect MCP tool descriptions
for the connection and deployment steps available on this server.

The legacy device enrollment flow remains available for clients that explicitly
support it. Use its agent credential through MCP; do not borrow a human CLI
session. A device client must store its credential securely and respect its
returned polling interval and expiry.
