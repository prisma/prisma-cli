/**
 * `init` writes the committed compute config the service group reads.
 * It touches no management API on this path — `--no-link` skips the
 * one step that would — but it ships in the binary, so it gets the same
 * real happy path as everything else, in a throwaway working directory.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { describeCommand, session } from "./suite";

interface InitResult {
  readonly configPath: string;
  readonly format: string;
  readonly app: { readonly name: string; readonly framework: string } | null;
  readonly link: { readonly status: string };
}

describeCommand("init", () => {
  it("writes the compute config it reports, byte-for-byte readable", async () => {
    const cli = await session();
    const workdir = await cli.workdir();

    const run = await cli.run(
      [
        "init",
        "--framework",
        "hono",
        "--name",
        "e2e-init",
        "--no-link",
        "--no-install",
      ],
      { cwd: workdir },
    );

    expect(run.exitCode).toBe(0);
    const result = run.envelope.result as InitResult;
    expect(result.app).toMatchObject({ name: "e2e-init", framework: "hono" });
    expect(result.format).toBe("typescript");
    expect(result.configPath.endsWith("prisma.compute.ts")).toBe(true);
    expect(result.link.status).toBe("skipped");

    const written = readFileSync(
      path.join(workdir, "prisma.compute.ts"),
      "utf8",
    );
    expect(written).toContain('name: "e2e-init"');
    expect(written).toContain('framework: "hono"');
  });
});
