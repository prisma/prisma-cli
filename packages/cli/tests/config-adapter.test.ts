import { describe, expect, it } from "vitest";

import { assertLinkedProjectIdWritable, readLinkedProjectId, writeLinkedProjectId } from "../src/adapters/config";
import { createTempCwd, readPrismaConfig } from "./helpers";

describe("config adapter", () => {
  it("writes a plain-object prisma.config.ts when creating project config", async () => {
    const cwd = await createTempCwd();

    await writeLinkedProjectId(cwd, "proj_123");

    await expect(readPrismaConfig(cwd)).resolves.toContain(`export default {\n  project: "proj_123",\n};`);
    await expect(readLinkedProjectId(cwd)).resolves.toBe("proj_123");
  });

  it("preflights writable config for a missing prisma.config.ts", async () => {
    const cwd = await createTempCwd();

    await expect(assertLinkedProjectIdWritable(cwd)).resolves.toBeUndefined();
  });
});
