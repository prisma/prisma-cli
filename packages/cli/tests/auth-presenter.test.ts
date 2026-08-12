/**
 * Direct coverage for `renderAuthSuccess`.
 *
 * It used to be reached only through fixture-mode runs of `auth login`
 * and `auth whoami`, so retiring that mode took its coverage with it.
 * The rendering is real behaviour and users see it, so it is tested
 * here on its own rather than through whichever command happens to
 * call it.
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { renderAuthSuccess } from "../src/presenters/auth";
import { getCommandDescriptor } from "../src/shell/command-meta";
import type { AuthStateResult } from "../src/types/auth";
import { createTempCwd, createTestCommandContext } from "./helpers";

async function render(
  command: "auth.login" | "auth.logout" | "auth.whoami",
  result: AuthStateResult,
): Promise<string> {
  const cwd = await createTempCwd();
  const { context } = await createTestCommandContext({
    cwd,
    stateDir: path.join(cwd, ".state"),
  });
  return renderAuthSuccess(
    context,
    getCommandDescriptor(command),
    command,
    result,
  ).join("\n");
}

const SIGNED_OUT: AuthStateResult = {
  authenticated: false,
  provider: null,
  user: null,
  workspace: null,
  credential: null,
};

describe("renderAuthSuccess", () => {
  it("shows provider, user and workspace after a login", async () => {
    const output = await render("auth.login", {
      authenticated: true,
      provider: "github",
      user: { email: "dev@example.com" },
      workspace: { id: "ws_1", name: "Acme Inc" },
      credential: null,
    });

    expect(output).toContain("GitHub");
    expect(output).toContain("dev@example.com");
    expect(output).toContain("Acme Inc");
  });

  it("omits the rows it has no values for", async () => {
    const output = await render("auth.login", {
      ...SIGNED_OUT,
      authenticated: true,
    });

    // No provider, user or workspace: those rows must be absent rather
    // than rendered empty.
    expect(output).not.toContain("provider");
    expect(output).not.toContain("user");
    expect(output).not.toContain("workspace");
  });

  it("names a service token when there is no user email", async () => {
    const named = await render("auth.whoami", {
      authenticated: true,
      provider: null,
      user: null,
      workspace: { id: "ws_1", name: "Acme Inc" },
      credential: { type: "service_token", id: "tok_1", name: "ci" },
    });
    expect(named).toContain("<service token: ci>");

    const anonymous = await render("auth.whoami", {
      authenticated: true,
      provider: null,
      user: null,
      workspace: null,
      credential: { type: "service_token", id: "tok_1", name: null },
    });
    expect(anonymous).toContain("<service token>");
  });

  it("reports signed out without identity rows", async () => {
    const output = await render("auth.whoami", SIGNED_OUT);

    expect(output).toContain("signed out");
    expect(output).not.toContain("signed in");
  });

  it("reports the cleared session on logout", async () => {
    const output = await render("auth.logout", SIGNED_OUT);

    expect(output).toContain("local CLI state");
  });
});
