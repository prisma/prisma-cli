import { createTestCli, defineCommand } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readAuthState } from "../src/lib/auth/auth-ops";
import type { AuthStateResult } from "../src/types/auth";
import { authWhoamiCommand } from "../src/v8/auth/whoami";

vi.mock("../src/lib/auth/auth-ops", () => ({
  readAuthState: vi.fn(),
}));

const SIGNED_OUT: AuthStateResult = {
  authenticated: false,
  provider: null,
  user: null,
  workspace: null,
  credential: null,
};

const SIGNED_IN: AuthStateResult = {
  authenticated: true,
  provider: "github",
  user: { id: "usr_456", email: "bob@example.com", name: "Bob Example" },
  workspace: { id: "ws_123", name: "Acme Inc" },
  credential: { type: "oauth", id: null, name: null },
};

const EPOCH = () => new Date(0);
const T0 = "1970-01-01T00:00:00.000Z";

const requiresCredentials = defineCommand({
  help: { summary: "Requires a signed-in session" },
  handler: async () => ({
    default: async (_args, ctx) =>
      ok(
        ctx.present(
          { data: null },
          { human: () => [{ kind: "summary", tone: "ok", text: "ran" }] },
        ),
      ),
  }),
  needs: { credentials: true },
});

function makeCli(options?: { credentials?: { token: string } }) {
  return createTestCli({
    commands: {
      "auth whoami": authWhoamiCommand,
      "auth locked": requiresCredentials,
    },
    groups: { auth: { brief: "Manage local authentication for the CLI" } },
    credentials: options?.credentials,
    now: EPOCH,
  });
}

beforeEach(() => {
  vi.mocked(readAuthState).mockReset();
});

describe("prisma-v8 auth whoami", () => {
  it("renders the signed-out human output and completes with exit 0", async () => {
    vi.mocked(readAuthState).mockResolvedValue(SIGNED_OUT);

    const result = await makeCli().run(["auth", "whoami"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "ℹ Showing the current authenticated identity.\n" +
        "status: signed out\n" +
        "→ Sign in: prisma-cli auth login\n",
    );
    expect(result.stderr).toBe("");
  });

  it("renders the signed-in human output", async () => {
    vi.mocked(readAuthState).mockResolvedValue(SIGNED_IN);

    const result = await makeCli().run(["auth", "whoami"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "ℹ Showing the current authenticated identity.\n" +
        "status: signed in\n" +
        "user: bob@example.com\n" +
        "provider: GitHub\n" +
        "workspace: Acme Inc\n",
    );
    expect(result.stderr).toBe("");
  });

  it("emits the json stream with a terminal completed envelope", async () => {
    vi.mocked(readAuthState).mockResolvedValue(SIGNED_OUT);

    const result = await makeCli().run(["auth", "whoami", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      `{"kind":"result","envelope":{"ok":true,"commandId":"auth.whoami",` +
        `"result":{"authenticated":false,"provider":null,"user":null,` +
        `"workspace":null,"credential":null},"exitCode":0,"diagnostics":[],` +
        `"nextActions":[{"kind":"run-command","label":"Sign in",` +
        `"command":"prisma-cli auth login"}]},"commandId":"auth.whoami",` +
        `"timestamp":"${T0}"}\n`,
    );
    expect(result.json).toHaveLength(1);
  });

  it("carries the signed-in auth state as the envelope result", async () => {
    vi.mocked(readAuthState).mockResolvedValue(SIGNED_IN);

    const result = await makeCli().run(["auth", "whoami", "--json"]);

    expect(result.exitCode).toBe(0);
    const frame = result.json[0];
    if (frame.kind !== "result") {
      throw new Error("expected a result frame");
    }
    expect(frame.envelope).toEqual({
      ok: true,
      commandId: "auth.whoami",
      result: SIGNED_IN,
      exitCode: 0,
      diagnostics: [],
      nextActions: [],
    });
  });

  it("writes only the machine-consumable data lines under --quiet", async () => {
    vi.mocked(readAuthState).mockResolvedValue(SIGNED_IN);

    const result = await makeCli().run(["auth", "whoami", "--quiet"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "status: signed in\n" +
        "user: bob@example.com\n" +
        "provider: GitHub\n" +
        "workspace: Acme Inc\n",
    );
    expect(result.stderr).toBe("");
  });

  it("errors with exit 2 when PRISMA_SERVICE_TOKEN is set but empty", async () => {
    vi.mocked(readAuthState).mockRejectedValue(
      new Error(
        "PRISMA_SERVICE_TOKEN is set but empty. Provide a valid token or unset the variable.",
      ),
    );

    const result = await makeCli().run(["auth", "whoami"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "✖ [AUTH.CONFIG_INVALID] Authentication configuration is invalid\n" +
        "  why: PRISMA_SERVICE_TOKEN is set but empty. Provide a valid token or unset the variable.\n" +
        "  fix: Provide a valid PRISMA_SERVICE_TOKEN value, or unset the variable to use local OAuth login.\n",
    );
  });

  it("emits the errored envelope on the json stream", async () => {
    vi.mocked(readAuthState).mockRejectedValue(
      new Error(
        "PRISMA_SERVICE_TOKEN is set but empty. Provide a valid token or unset the variable.",
      ),
    );

    const result = await makeCli().run(["auth", "whoami", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    const frame = result.json[0];
    if (frame.kind !== "result") {
      throw new Error("expected a result frame");
    }
    expect(frame.envelope).toEqual({
      ok: false,
      commandId: "auth.whoami",
      error: {
        code: "AUTH.CONFIG_INVALID",
        severity: "error",
        summary: "Authentication configuration is invalid",
        why: "PRISMA_SERVICE_TOKEN is set but empty. Provide a valid token or unset the variable.",
        fix: "Provide a valid PRISMA_SERVICE_TOKEN value, or unset the variable to use local OAuth login.",
      },
      diagnostics: [],
      nextActions: [],
    });
  });

  it("settles an unexpected operations failure as a bug with exit 1", async () => {
    vi.mocked(readAuthState).mockRejectedValue(new Error("disk on fire"));

    const result = await makeCli().run(["auth", "whoami"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("✖ [CLI.INTERNAL_ERROR] disk on fire\n");
  });
});

describe("needs.credentials early failure", () => {
  it("fails a credentials-needing command early with the engine's sign-in error", async () => {
    const result = await makeCli().run(["auth", "locked"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "✖ [CLI.CREDENTIALS_REQUIRED] You must be signed in to run this command.\n" +
        "  fix: Sign in, then run the command again.\n",
    );
  });

  it("runs the handler when credentials are present", async () => {
    const cli = makeCli({ credentials: { token: "tok_1" } });

    const result = await cli.run(["auth", "locked"], {
      isTty: { stdout: true },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("✔ ran\n");
    expect(result.stderr).toBe("");
  });

  it("whoami itself completes without credentials (no needs.credentials)", async () => {
    vi.mocked(readAuthState).mockResolvedValue(SIGNED_OUT);
    expect(authWhoamiCommand.needs).toBeUndefined();

    const result = await makeCli().run(["auth", "whoami", "--json"]);

    expect(result.exitCode).toBe(0);
  });
});
