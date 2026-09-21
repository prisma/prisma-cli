/**
 * The operation-context adapter. `commands/project/context.ts` hands the
 * controllers an object carrying the three fields their `CommandContext`
 * declares. The adapter refuses a read it
 * cannot serve and names the field, so a controller edit that starts
 * reading a fourth fails where the mistake is rather than as
 * `Cannot read properties of undefined` somewhere downstream — worst
 * case inside `project transfer`, after the project has already moved.
 *
 * These cases drive every operation the CLI passes the adapter to, so the
 * refusal is proven not to reject anything today's code reads.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CommandContext, ManagementApiClient } from "@prisma/cli-engine";
import { describe, expect, it } from "vitest";
import { operationContext } from "../src/commands/project/context";
import { resolveEnvWriteInput } from "../src/controllers/app-env";
import { runEnvAddFile } from "../src/controllers/app-env-file";
import {
  cleanupLocalPinForProject,
  rewriteOrClearLocalPinForProject,
} from "../src/controllers/project";
import { resolveProjectTarget } from "../src/lib/project/resolution";

type ProjectCommandContext = CommandContext<undefined, never>;

const WORKSPACE = { id: "ws_1", name: "Acme Inc" };

const PROJECTS = [
  { id: "proj_1", name: "Billing", slug: null, workspace: WORKSPACE },
];

function stubContext(cwd: string): ProjectCommandContext {
  return {
    cwd,
    env: { HOME: "/home/test" },
    signal: new AbortController().signal,
  } as unknown as ProjectCommandContext;
}

async function pinnedCwd() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "operation-context-"));
  await mkdir(path.join(cwd, ".prisma"), { recursive: true });
  await writeFile(
    path.join(cwd, ".prisma", "local.json"),
    `${JSON.stringify({ workspaceId: "ws_1", projectId: "proj_1" }, null, 2)}\n`,
    "utf8",
  );
  return cwd;
}

describe("the operation-context adapter", () => {
  it("serves the three fields it declares", () => {
    const context = operationContext(stubContext("/somewhere"));

    expect(context.runtime.cwd).toBe("/somewhere");
    expect(context.runtime.env).toEqual({ HOME: "/home/test" });
    expect(context.runtime.signal.aborted).toBe(false);
  });

  it("refuses a runtime field it cannot serve, and names it", () => {
    const context = operationContext(stubContext("/somewhere"));

    expect(
      () => (context.runtime as unknown as { stdout: unknown }).stdout,
    ).toThrow(
      "the operation-context adapter provides only runtime.cwd, runtime.env and runtime.signal; runtime.stdout was read",
    );
  });

  it("refuses a top-level field it cannot serve, and names it", () => {
    const context = operationContext(stubContext("/somewhere"));

    expect(() => (context as unknown as { ui: unknown }).ui).toThrow(
      "the operation-context adapter provides only runtime.cwd, runtime.env and runtime.signal; ui was read",
    );
  });

  it("lets the language probe it without throwing", async () => {
    const context = operationContext(stubContext("/somewhere"));

    // Symbols and `then` are how the runtime inspects an object, not how
    // a controller reads a field. Awaiting the adapter reads `then`;
    // throwing there would be the very failure the trap exists to remove.
    expect(
      (context as unknown as Record<symbol, unknown>)[Symbol.toStringTag],
    ).toBeUndefined();
    expect((context as unknown as { then?: unknown }).then).toBeUndefined();
    await expect(Promise.resolve(context)).resolves.toBe(context);
  });

  it("carries resolveProjectTarget", async () => {
    const context = operationContext(stubContext(await pinnedCwd()));

    const target = await resolveProjectTarget({
      context,
      workspace: WORKSPACE,
      listProjects: async () => PROJECTS,
    });

    expect(target.isErr()).toBe(false);
    expect(target.isErr() ? null : target.value.project.id).toBe("proj_1");
  });

  it("carries cleanupLocalPinForProject", async () => {
    const context = operationContext(stubContext(await pinnedCwd()));
    const warnings: string[] = [];

    const cleared = await cleanupLocalPinForProject(context, "proj_1", {
      onError: (message) => warnings.push(message),
    });

    expect(cleared).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("carries rewriteOrClearLocalPinForProject", async () => {
    const context = operationContext(stubContext(await pinnedCwd()));
    const warnings: string[] = [];

    const action = await rewriteOrClearLocalPinForProject(
      context,
      "proj_1",
      "ws_2",
      { onError: (message) => warnings.push(message) },
    );

    expect(action).toBe("rewritten");
    expect(warnings).toEqual([]);
  });

  it("carries resolveEnvWriteInput, for both a single assignment and a file", async () => {
    const cwd = await pinnedCwd();
    await writeFile(path.join(cwd, ".env"), "STRIPE_KEY=sk_test\n", "utf8");
    const context = operationContext(stubContext(cwd));

    expect(
      await resolveEnvWriteInput(
        context,
        { kind: "single", rawAssignment: "STRIPE_KEY=sk_test" },
        "add",
      ),
    ).toEqual({ kind: "single", key: "STRIPE_KEY", value: "sk_test" });

    expect(
      await resolveEnvWriteInput(
        context,
        { kind: "file", filePath: ".env" },
        "add",
      ),
    ).toMatchObject({
      kind: "file",
      filePath: ".env",
      assignments: [{ key: "STRIPE_KEY", value: "sk_test" }],
    });
  });

  it("carries runEnvAddFile", async () => {
    const context = operationContext(stubContext(await pinnedCwd()));
    const created = {
      id: "env_1",
      key: "STRIPE_KEY",
      value: "sk_test",
      class: "production",
      branchId: null,
    };
    const client = {
      GET: async () => ({
        data: { data: [], pagination: { hasMore: false, nextCursor: null } },
      }),
      POST: async () => ({ data: { data: created } }),
    } as unknown as ManagementApiClient;

    const written = await runEnvAddFile(
      context,
      client,
      "proj_1",
      {
        scope: { kind: "role", role: "production" },
        descriptor: { kind: "role", role: "production" },
        apiTarget: { class: "production", branchId: null },
      },
      ".env",
      [{ key: "STRIPE_KEY", value: "sk_test" }],
      {
        workspace: WORKSPACE,
        project: PROJECTS[0],
        resolution: { projectSource: "local-pin" },
      },
    );

    expect(written.result.variables).toMatchObject([{ key: "STRIPE_KEY" }]);
  });
});
