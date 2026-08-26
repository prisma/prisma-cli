import { readFile } from "node:fs/promises";
import path from "node:path";
import { definePrismaConfig as engineDefinePrismaConfig } from "@prisma/cli-engine";
import { describe, expect, it } from "vitest";
import { definePrismaConfig } from "../src/config";

describe("prisma/config", () => {
  it("re-exports the engine's definePrismaConfig", () => {
    expect(definePrismaConfig).toBe(engineDefinePrismaConfig);
  });

  it("attaches the $prismaConfig version marker", () => {
    const config = definePrismaConfig({ skills: { agents: ["claude"] } });
    expect(typeof config.$prismaConfig).toBe("number");
    expect(config.skills).toEqual({ agents: ["claude"] });
  });

  it("maps the ./config subpath onto the built entry", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(import.meta.dirname, "../package.json"), "utf8"),
    ) as {
      exports: Record<string, { types: string; import: string }>;
      files: string[];
    };
    expect(packageJson.exports["./config"]).toEqual({
      types: "./dist/config.d.ts",
      import: "./dist/config.js",
    });
    expect(packageJson.files).toContain("dist");
  });
});
