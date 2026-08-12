/**
 * The sanctioned golden-rendering suite (S2 ruling: byte-exact pins
 * live here, one representative per rendering surface — card, table,
 * error, masked secret). Every other test asserts semantically
 * (envelope / presented / events / exit code); when the engine's
 * rendering style changes deliberately, THIS file is the one place the
 * new bytes get re-pinned. The S1 whoami byte pins in
 * whoami.test.ts remain the whoami-specific baseline.
 */
import {
  type Block,
  defineCommand,
  type ManagementApiClient,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import {
  createTestCli,
  mintTestJwt,
  type SessionRecord,
} from "@prisma/cli-engine/testing";
import { describe, expect, it } from "vitest";

import { authLogoutCommand } from "../src/commands/auth/logout";
import { authWorkspaceListCommand } from "../src/commands/auth/workspace-list";
import { authWorkspaceLogoutCommand } from "../src/commands/auth/workspace-logout";
import { bucketKeyCreateCommand } from "../src/commands/bucket/key-create";

function record(workspaceId: string, workspaceName: string): SessionRecord {
  return {
    workspaceId,
    workspaceName,
    credential: {
      token: mintTestJwt({ workspace_id: workspaceId }),
      refreshToken: `refresh_${workspaceId}`,
      expiresAt: undefined,
    },
  };
}

function makeCli(
  sessions: readonly SessionRecord[],
  current?: string,
  client?: ManagementApiClient,
) {
  return createTestCli({
    commands: {
      "auth logout": authLogoutCommand,
      "auth workspace list": authWorkspaceListCommand,
      "auth workspace logout": authWorkspaceLogoutCommand,
      "bucket key create": bucketKeyCreateCommand,
    },
    groups: {
      auth: { brief: "Manage local authentication for the CLI" },
      "auth workspace": { brief: "Manage local workspace sessions" },
      bucket: { brief: "Manage object-store buckets for a project" },
      "bucket key": { brief: "Manage access keys for an object-store bucket" },
    },
    sessions,
    selectedWorkspaceId: current,
    ...(client === undefined ? {} : { managementApi: { client } }),
    now: () => new Date(0),
  });
}

const CREATED_KEY = {
  id: "bkey_1",
  name: "ci-key",
  role: "read_write",
  valueHint: "AKIA…9Z",
  createdAt: "2026-06-03T00:00:00.000Z",
  secretAccessKey: "s3cr3t",
  accessKeyId: "AKIAEXAMPLE",
  endpoint: "https://s3.prisma.io",
  bucketName: "assets",
};

function bucketKeyClient(): ManagementApiClient {
  return {
    GET: async () => ({ data: { data: {} } }),
    POST: async () => ({ data: { data: CREATED_KEY } }),
    PATCH: async () => ({ data: { data: {} } }),
    DELETE: async () => ({ data: { data: {} } }),
  } as unknown as ManagementApiClient;
}

describe("golden rendering", () => {
  it("human card (representative: auth logout)", async () => {
    const result = await makeCli([record("ws_1", "Acme Inc")], "ws_1").run(
      ["auth", "logout"],
      { isTty: { stdout: true } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe(
      "ℹ Clearing your stored workspace sessions.\n" +
        "ended:  1\n" +
        "✔ Ended 1 workspace session.\n" +
        "→ Sign in: prisma-cli auth login\n",
    );
    expect(result.stdout).toBe("ended: 1\n");
  });

  it("table (representative: auth workspace list)", async () => {
    const result = await makeCli(
      [record("ws_1", "Acme Inc"), record("ws_2", "Globex")],
      "ws_1",
    ).run(["auth", "workspace", "list"], { isTty: { stdout: true } });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe(
      "ℹ Listing your workspace sessions on this machine.\n" +
        "name      id    status\n" +
        "Acme Inc  ws_1  current\n" +
        "Globex    ws_2\n",
    );
    expect(result.stdout).toBe("Acme Inc  ws_1  current\nGlobex  ws_2\n");
  });

  /**
   * What the mask is and is not: the card writes `********` to stderr
   * while stdout prints the same secret in the clear a line later,
   * because printing it is how the caller receives it. It is a
   * scroll-back and screen-share courtesy, not containment.
   */
  it("masked secret (representative: bucket key create)", async () => {
    const result = await makeCli(
      [record("ws_1", "Acme Inc")],
      "ws_1",
      bucketKeyClient(),
    ).run(["bucket", "key", "create", "bkt_1"], { isTty: { stdout: true } });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe(
      '✔ Created key "ci-key" for bucket "assets".\n' +
        "- The credentials below are shown once — copy them now.\n" +
        "- Set these environment variables to use this bucket:\n" +
        "S3_ENDPOINT:           https://s3.prisma.io\n" +
        "S3_ACCESS_KEY_ID:      ********\n" +
        "S3_SECRET_ACCESS_KEY:  ********\n" +
        "S3_BUCKET:             assets\n",
    );
    expect(result.stdout).toBe(
      "S3_ENDPOINT=https://s3.prisma.io\n" +
        "S3_ACCESS_KEY_ID=AKIAEXAMPLE\n" +
        "S3_SECRET_ACCESS_KEY=s3cr3t\n" +
        "S3_BUCKET=assets\n",
    );
  });

  it("error (representative: AUTH.WORKSPACE_AMBIGUOUS)", async () => {
    const result = await makeCli(
      [record("ws_1", "Acme Inc"), record("ws_9", "Acme Inc")],
      "ws_1",
    ).run(["auth", "workspace", "logout", "Acme Inc"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe(
      "✘ [AUTH.WORKSPACE_AMBIGUOUS] More than one workspace session is named 'Acme Inc'.\n" +
        "  why: Matching workspaces: ws_1, ws_9.\n" +
        "→ List your workspace sessions and pass a workspace id: prisma-cli auth workspace list\n",
    );
    expect(result.stdout).toBe("");
  });

  /**
   * Colour is a separate axis from alignment, so it gets its own pins.
   * The cases above run with a non-terminal stderr and stay plain; these
   * two are the same surfaces with a terminal stderr.
   */
  it("coloured card and mask (representative: bucket key create)", async () => {
    const result = await makeCli(
      [record("ws_1", "Acme Inc")],
      "ws_1",
      bucketKeyClient(),
    ).run(["bucket", "key", "create", "bkt_1"], {
      isTty: { stdout: true, stderr: true },
    });

    expect(result.stderr).toBe(
      '\u001b[92m\u2714\u001b[39m Created key "ci-key" for bucket "assets".\n' +
        "- The credentials below are shown once \u2014 copy them now.\n" +
        "- Set these environment variables to use this bucket:\n" +
        "\u001b[36mS3_ENDPOINT:         \u001b[39m  https://s3.prisma.io\n" +
        "\u001b[36mS3_ACCESS_KEY_ID:    \u001b[39m  ********\n" +
        "\u001b[36mS3_SECRET_ACCESS_KEY:\u001b[39m  ********\n" +
        "\u001b[36mS3_BUCKET:           \u001b[39m  assets\n",
    );
  });

  it("coloured table (representative: auth workspace list)", async () => {
    const result = await makeCli(
      [record("ws_1", "Acme Inc"), record("ws_2", "Globex")],
      "ws_1",
    ).run(["auth", "workspace", "list"], {
      isTty: { stdout: true, stderr: true },
    });

    expect(result.stderr).toBe(
      "\u001b[34m\u2139\u001b[39m Listing your workspace sessions on this machine.\n" +
        "\u001b[36mname    \u001b[39m  \u001b[36mid  \u001b[39m  \u001b[36mstatus\u001b[39m\n" +
        "Acme Inc  ws_1  current\n" +
        "Globex    ws_2\n",
    );
  });
});

/**
 * The card the `fields` block draws is the card the commander shell
 * drew — same padding, same accent on the key, same two-space gutter,
 * and the same dim rail when a command asks for one. The shell is gone,
 * so these are the bytes its renderers produced, captured from
 * `renderFieldRows` and `renderVerboseBlock` before they were deleted.
 */
describe("the restored card matches the shell it replaced", () => {
  const ROWS = [
    { key: "status", value: "signed in" },
    { key: "workspace", value: "Acme Inc" },
  ];

  const SHELL_FIELD_ROWS = [
    "\u001b[36mstatus:   \u001b[39m  signed in",
    "\u001b[36mworkspace:\u001b[39m  Acme Inc",
  ];

  const SHELL_VERBOSE_RAIL_ROWS = [
    "\u001b[2m\u2502\u001b[22m  \u001b[36mstatus:   \u001b[39m  signed in",
    "\u001b[2m\u2502\u001b[22m  \u001b[36mworkspace:\u001b[39m  Acme Inc",
  ];

  async function renderCard(rail: boolean): Promise<string[]> {
    const card: Block = {
      kind: "fields",
      rows: ROWS.map((row) => ({ label: row.key, value: row.value })),
      rail,
    };
    const show = defineCommand({
      help: { summary: "Draw the card" },
      handler: async (_args, ctx) =>
        ok(ctx.present({ data: null }, { human: () => [card] })),
    });
    const result = await createTestCli({ commands: { show } }).run(["show"], {
      isTty: { stdout: true, stderr: true },
    });
    return result.stderr.split("\n").slice(0, ROWS.length);
  }

  it("reproduces the shell's renderFieldRows bytes", async () => {
    expect(await renderCard(false)).toEqual(SHELL_FIELD_ROWS);
  });

  it("reproduces the rail rows the shell's renderVerboseBlock drew", async () => {
    expect(await renderCard(true)).toEqual(SHELL_VERBOSE_RAIL_ROWS);
  });
});
