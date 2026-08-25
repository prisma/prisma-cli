/**
 * readProjectSkillsConfig resolves the skills section over the
 * discovered config chain, so the out-of-handler callers (the
 * staleness check, the post-login tip) agree with the skills commands
 * on the governing config from any directory. Every fixture tree lives
 * in its own temp directory with its own .git marker, so a walk never
 * reaches this repository's checkout.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PRISMA_CONFIG_VERSION } from "@prisma/cli-engine";
import { describe, expect, it } from "vitest";

import { readProjectSkillsConfig } from "../src/commands/skills/config";
import { DEFAULT_AGENTS } from "../src/lib/skills/allowlist";
import { makeProjectRoot } from "./helpers/skills-fixture";

async function makeRepoRoot(): Promise<string> {
  const root = await makeProjectRoot("config-");
  await mkdir(path.join(root, ".git"), { recursive: true });
  return root;
}

/** The fixture files carry the version marker literally: a bare temp
 *  directory has no node_modules to resolve definePrismaConfig from. */
async function writeConfig(dir: string, body: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "prisma.config.ts"),
    `export default { $prismaConfig: ${PRISMA_CONFIG_VERSION}, ${body} };\n`,
    "utf8",
  );
}

describe("readProjectSkillsConfig over the config chain", () => {
  it("reads a root config's skills section from a subdirectory", async () => {
    const root = await makeRepoRoot();
    await writeConfig(root, `skills: { check: false }`);
    const sub = path.join(root, "packages", "db");
    await mkdir(sub, { recursive: true });

    expect(await readProjectSkillsConfig(sub)).toEqual({
      check: false,
      agents: DEFAULT_AGENTS,
      agentsConfigured: false,
    });
  });

  it("merges a subdirectory's override per key with the root", async () => {
    const root = await makeRepoRoot();
    await writeConfig(root, `skills: { check: false, agents: ["claude"] }`);
    const sub = path.join(root, "packages", "db");
    await writeConfig(sub, `skills: { agents: ["cursor"] }`);

    expect(await readProjectSkillsConfig(sub)).toEqual({
      check: false,
      agents: ["cursor"],
      agentsConfigured: true,
    });
  });

  it("reads a broken file anywhere on the chain as no config, even when the nearest file is fine", async () => {
    const root = await makeRepoRoot();
    await mkdir(path.join(root, "packages", "db"), { recursive: true });
    await writeFile(
      path.join(root, "prisma.config.ts"),
      'throw new Error("broken root config");\n',
      "utf8",
    );
    await writeConfig(
      path.join(root, "packages", "db"),
      `skills: { check: false }`,
    );

    expect(
      await readProjectSkillsConfig(path.join(root, "packages", "db")),
    ).toBeNull();
  });

  it("reads a tree with no config anywhere on the chain as no config", async () => {
    const root = await makeRepoRoot();
    const sub = path.join(root, "packages", "db");
    await mkdir(sub, { recursive: true });

    expect(await readProjectSkillsConfig(sub)).toBeNull();
  });

  it("reads a --config file as the chain's anchor, with the root still applying", async () => {
    const root = await makeRepoRoot();
    await writeConfig(root, `skills: { check: false }`);
    const sub = path.join(root, "packages", "db");
    await mkdir(sub, { recursive: true });
    await writeFile(
      path.join(sub, "elsewhere.config.ts"),
      `export default { $prismaConfig: ${PRISMA_CONFIG_VERSION}, skills: { agents: ["cursor"] } };\n`,
      "utf8",
    );

    expect(await readProjectSkillsConfig(sub, "elsewhere.config.ts")).toEqual({
      check: false,
      agents: ["cursor"],
      agentsConfigured: true,
    });
  });

  it("reads a section whose plain-object getter throws as no config", async () => {
    // The resolver's snapshot reads each key once and turns the throw
    // into a config error; it never reaches the validator.
    const root = await makeRepoRoot();
    await writeFile(
      path.join(root, "prisma.config.ts"),
      `export default { $prismaConfig: ${PRISMA_CONFIG_VERSION}, skills: { get check() { throw new Error("getter"); } } };\n`,
      "utf8",
    );

    expect(await readProjectSkillsConfig(root)).toBeNull();
  });

  it("reads a non-plain section value whose getter throws as no config", async () => {
    // A class instance is carried atomically past the resolver's
    // snapshot, so the validator's own guard is what catches this one.
    const root = await makeRepoRoot();
    await writeFile(
      path.join(root, "prisma.config.ts"),
      `export default { $prismaConfig: ${PRISMA_CONFIG_VERSION}, skills: new (class { get check() { throw new Error("getter"); } })() };\n`,
      "utf8",
    );

    expect(await readProjectSkillsConfig(root)).toBeNull();
  });

  it("reads an invalid merged section as no config", async () => {
    const root = await makeRepoRoot();
    await writeConfig(root, `skills: { check: "yes" }`);

    expect(await readProjectSkillsConfig(root)).toBeNull();
  });
});
