/**
 * D1: the engine's own package-manager detection and the single table
 * that spells every command line it will run. Detection runs against
 * real temporary directories, one case per precedence step, so a
 * behavior change in package-manager-detector is caught here.
 */
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  installCommand,
  type PackageManagerCommand,
  type PackageManagerId,
  resolvePackageManager,
  runCommand,
} from "../src/package-manager";

const CHILD_PROCESS_IMPORT = /["'](?:node:)?child_process["']/;

function invokedBy(manager: string): Record<string, string> {
  return {
    npm_config_user_agent: `${manager}/9.7.0 npm/? node/v24.0.0 darwin arm64`,
  };
}

describe("resolvePackageManager", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "engine-pm-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("the caller's override beats the host and the project", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "");

    expect(
      await resolvePackageManager({
        cwd: dir,
        env: {},
        override: "bun",
        host: "yarn",
      }),
    ).toBe("bun");
  });

  test("the host's choice beats the project", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "");

    expect(
      await resolvePackageManager({ cwd: dir, env: {}, host: "yarn" }),
    ).toBe("yarn");
  });

  test("a lockfile in cwd names the manager", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "");

    expect(await resolvePackageManager({ cwd: dir, env: {} })).toBe("pnpm");
  });

  test("a lockfile in an ancestor directory names the manager", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "");
    const child = join(dir, "packages", "app");
    await mkdir(child, { recursive: true });

    expect(
      await resolvePackageManager({ cwd: child, env: invokedBy("yarn") }),
    ).toBe("pnpm");
  });

  test("a packageManager field beats a lockfile in the same directory", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ packageManager: "bun@1.2.0" }),
    );

    expect(await resolvePackageManager({ cwd: dir, env: {} })).toBe("bun");
  });

  // The detector walks parents with no project boundary, so a temp
  // directory answers for whatever lockfile sits above it on the
  // machine running this. The filesystem root has no parent to walk and
  // the walk stops one level below it, so it holds nothing at all.
  test("the invoking manager's user agent is used when the directory has no project", async () => {
    expect(
      await resolvePackageManager({
        cwd: parse(dir).root,
        env: invokedBy("pnpm"),
      }),
    ).toBe("pnpm");
  });

  test("an unrecognized user agent is ignored", async () => {
    expect(
      await resolvePackageManager({
        cwd: parse(dir).root,
        env: invokedBy("vlt"),
      }),
    ).toBe("npm");
  });

  test("npm is the answer when nothing matches", async () => {
    expect(await resolvePackageManager({ cwd: parse(dir).root, env: {} })).toBe(
      "npm",
    );
  });
});

const PACKAGES = ["prisma@latest", "@prisma/client"];

interface SpellingCase extends PackageManagerCommand {
  readonly manager: PackageManagerId;
}

describe("installCommand", () => {
  test.each<SpellingCase>([
    {
      manager: "npm",
      file: "npm",
      args: ["add", "prisma@latest", "@prisma/client"],
      line: "npm add prisma@latest @prisma/client",
    },
    {
      manager: "pnpm",
      file: "pnpm",
      args: ["add", "prisma@latest", "@prisma/client"],
      line: "pnpm add prisma@latest @prisma/client",
    },
    {
      manager: "yarn",
      file: "yarn",
      args: ["add", "prisma@latest", "@prisma/client"],
      line: "yarn add prisma@latest @prisma/client",
    },
    {
      manager: "bun",
      file: "bun",
      args: ["add", "prisma@latest", "@prisma/client"],
      line: "bun add prisma@latest @prisma/client",
    },
    {
      manager: "deno",
      file: "deno",
      args: ["add", "npm:prisma@latest", "npm:@prisma/client"],
      line: "deno add npm:prisma@latest npm:@prisma/client",
    },
  ])("$manager adds dependencies", ({ manager, ...expected }) => {
    expect(installCommand(manager, { packages: PACKAGES })).toEqual(expected);
  });

  test.each<SpellingCase>([
    {
      manager: "npm",
      file: "npm",
      args: ["add", "-D", "prisma@latest", "@prisma/client"],
      line: "npm add -D prisma@latest @prisma/client",
    },
    {
      manager: "pnpm",
      file: "pnpm",
      args: ["add", "-D", "prisma@latest", "@prisma/client"],
      line: "pnpm add -D prisma@latest @prisma/client",
    },
    {
      manager: "yarn",
      file: "yarn",
      args: ["add", "-D", "prisma@latest", "@prisma/client"],
      line: "yarn add -D prisma@latest @prisma/client",
    },
    {
      manager: "bun",
      file: "bun",
      args: ["add", "-D", "prisma@latest", "@prisma/client"],
      line: "bun add -D prisma@latest @prisma/client",
    },
    {
      manager: "deno",
      file: "deno",
      args: ["add", "--dev", "npm:prisma@latest", "npm:@prisma/client"],
      line: "deno add --dev npm:prisma@latest npm:@prisma/client",
    },
  ])("$manager adds dev dependencies", ({ manager, ...expected }) => {
    expect(installCommand(manager, { packages: PACKAGES, dev: true })).toEqual(
      expected,
    );
  });
});

describe("runCommand", () => {
  test.each<SpellingCase>([
    {
      manager: "npm",
      file: "npx",
      args: ["skills@latest", "add", "-y"],
      line: "npx skills@latest add -y",
    },
    {
      manager: "pnpm",
      file: "pnpm",
      args: ["dlx", "skills@latest", "add", "-y"],
      line: "pnpm dlx skills@latest add -y",
    },
    {
      manager: "yarn",
      file: "yarn",
      args: ["dlx", "skills@latest", "add", "-y"],
      line: "yarn dlx skills@latest add -y",
    },
    {
      manager: "bun",
      file: "bunx",
      args: ["skills@latest", "add", "-y"],
      line: "bunx skills@latest add -y",
    },
    {
      manager: "deno",
      file: "deno",
      args: ["run", "-A", "npm:skills@latest", "add", "-y"],
      line: "deno run -A npm:skills@latest add -y",
    },
  ])("$manager runs a package once", ({ manager, ...expected }) => {
    expect(
      runCommand(manager, { package: "skills@latest", args: ["add", "-y"] }),
    ).toEqual(expected);
  });

  test("omitted args spell the bare runner invocation", () => {
    expect(runCommand("pnpm", { package: "skills" })).toEqual({
      file: "pnpm",
      args: ["dlx", "skills"],
      line: "pnpm dlx skills",
    });
  });
});

describe("the line a user is told to run by hand", () => {
  test("an argument a shell would have re-read is quoted", () => {
    expect(
      installCommand("npm", {
        packages: ["prisma@>=1 <2", "file:../pkg;rm -rf /", "$HOME/pkg.tgz"],
      }),
    ).toEqual<PackageManagerCommand>({
      file: "npm",
      args: ["add", "prisma@>=1 <2", "file:../pkg;rm -rf /", "$HOME/pkg.tgz"],
      line: "npm add 'prisma@>=1 <2' 'file:../pkg;rm -rf /' '$HOME/pkg.tgz'",
    });
  });

  test("a single quote in an argument leaves the quoting and re-enters it", () => {
    expect(runCommand("bun", { package: "it's", args: [""] }).line).toBe(
      "bunx 'it'\\''s' ''",
    );
  });
});

test("no engine source can spawn: child_process is absent from its imports", async () => {
  const src = fileURLToPath(new URL("../src", import.meta.url));
  const entries = await readdir(src, { recursive: true });
  const sources = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".ts"))
      .map(async (entry) => ({
        entry,
        text: await readFile(join(src, entry), "utf8"),
      })),
  );

  expect(
    sources
      .filter(({ text }) => CHILD_PROCESS_IMPORT.test(text))
      .map(({ entry }) => entry),
  ).toEqual([]);
});
