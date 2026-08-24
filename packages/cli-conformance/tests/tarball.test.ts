/**
 * Check 3. Every slow operation — packing, installing, starting a bin —
 * arrives through the TarballIo seam, so these tests are plain values
 * and the suite never touches pnpm, npm or the network.
 */
import { describe, expect, test } from "vitest";
import type { PackageManifest } from "../src/checks/import-purity";
import {
  checkTarball,
  type TarballInput,
  type TarballIo,
} from "../src/checks/tarball";

const SHELL_MANIFEST: PackageManifest & { bin?: Record<string, string> } = {
  bin: { "prisma-cli": "./dist/cli.js" },
  dependencies: {
    "@prisma/cli-engine": "8.0.0-rc.1",
    "@prisma/composer": "0.6.0-dev.16",
    colorette: "^2.0.20",
  },
  devDependencies: { "@repo/tsconfig": "8.0.0-rc.1" },
};

const ENGINE_MANIFEST: PackageManifest = {
  dependencies: { "@stricli/core": "1.3.0", colorette: "^2.0.20" },
};

function fakeIo(overrides: Partial<TarballIo> = {}): TarballIo {
  return {
    pack: (pkgDir) => Promise.resolve({ tarball: `${pkgDir}.tgz` }),
    readPackedManifest: (tarball) =>
      Promise.resolve(
        tarball.includes("cli-engine") ? ENGINE_MANIFEST : SHELL_MANIFEST,
      ),
    readPackedFiles: (tarball) =>
      Promise.resolve(
        new Map(
          tarball.includes("cli-engine")
            ? [
                [
                  "dist/index.js",
                  'import "@stricli/core";\nimport "colorette";\n',
                ],
              ]
            : [
                [
                  "dist/cli.js",
                  'import "colorette";\nimport "@prisma/cli-engine";\n',
                ],
                ["dist/v8/cli.js", 'import "@prisma/composer/family";\n'],
              ],
        ),
      ),
    installSandbox: () => Promise.resolve({ ok: true as const }),
    readInstalledManifest: (_sandbox, name) =>
      Promise.resolve(
        name === "@prisma/composer"
          ? {
              version: "0.6.0-dev.16",
              dependencies: { "@prisma/cli-engine": "0.0.9" },
            }
          : undefined,
      ),
    listInstalledCopies: (_sandbox, name) =>
      Promise.resolve(
        name === "@prisma/cli-engine"
          ? [
              {
                version: "8.0.0-rc.1",
                path: "node_modules/@prisma/cli-engine",
              },
              {
                version: "0.0.9",
                path: "node_modules/@prisma/composer/node_modules/@prisma/cli-engine",
              },
            ]
          : [],
      ),
    startBin: () =>
      Promise.resolve({
        exitCode: 0,
        stdout: "8.0.0-rc.1",
        stderr: "",
        timedOut: false,
      }),
    ...overrides,
  };
}

function input(overrides: Partial<TarballInput> = {}): TarballInput {
  return {
    packages: [
      { name: "@prisma/cli", dir: "packages/cli" },
      { name: "@prisma/cli-engine", dir: "packages/cli-engine" },
    ],
    shellPackage: "@prisma/cli",
    enginePackage: "@prisma/cli-engine",
    familyPackages: ["@prisma/composer"],
    exceptions: [],
    sandboxDir: "sandbox",
    // Check 4 has its own suite; the fixtures here carry dev pins, so
    // these tests declare the channel that tolerates them.
    channel: "dev",
    ...overrides,
  };
}

const kinds = (findings: readonly { kind: string }[]): string[] =>
  [...new Set(findings.map((f) => f.kind))].sort();

describe("checkTarball", () => {
  /**
   * The live defect. With no exception recorded, the shell pinning the
   * engine at 8.0.0-rc.1 while composer pins 0.0.9 is reported — from
   * the manifests AND from the two copies in the install tree.
   */
  test("reports the shell-versus-family engine pin mismatch, both ways", async () => {
    const findings = await checkTarball(input(), fakeIo());
    const pins = findings.filter((f) => f.kind === "engine-pin-mismatch");
    expect(pins.length).toBeGreaterThanOrEqual(2);
    const summaries = pins.map((f) => f.summary).join("\n");
    expect(summaries).toContain("8.0.0-rc.1");
    expect(summaries).toContain("0.0.9");
    expect(pins.some((f) => f.subject === "@prisma/composer")).toBe(true);
    expect(pins.every((f) => f.suppressedBy === undefined)).toBe(true);
  });

  test("an exception keyed on the observed triple suppresses the finding but keeps it visible", async () => {
    const findings = await checkTarball(
      input({
        exceptions: [
          {
            familyPackage: "@prisma/composer",
            familyPin: "0.0.9",
            shellPin: "8.0.0-rc.1",
            reason: "composer cannot pin an unpublished engine",
            removeWhen: "composer republishes against the tandem release",
          },
        ],
      }),
      fakeIo(),
    );
    const pins = findings.filter((f) => f.kind === "engine-pin-mismatch");
    expect(pins.length).toBeGreaterThanOrEqual(1);
    expect(pins.every((f) => f.suppressedBy !== undefined)).toBe(true);
  });

  test("the exception does not cover the same family arriving at a third version", async () => {
    const findings = await checkTarball(
      input({
        exceptions: [
          {
            familyPackage: "@prisma/composer",
            familyPin: "0.0.7",
            shellPin: "8.0.0-rc.1",
            reason: "stale exception",
            removeWhen: "never matches",
          },
        ],
      }),
      fakeIo(),
    );
    const pins = findings.filter((f) => f.kind === "engine-pin-mismatch");
    expect(pins.some((f) => f.suppressedBy === undefined)).toBe(true);
  });

  test("equal pins and a single installed copy report nothing", async () => {
    const io = fakeIo({
      readInstalledManifest: (_s, name) =>
        Promise.resolve(
          name === "@prisma/composer"
            ? {
                version: "0.6.0-dev.16",
                dependencies: { "@prisma/cli-engine": "8.0.0-rc.1" },
              }
            : undefined,
        ),
      listInstalledCopies: (_s, name) =>
        Promise.resolve(
          name === "@prisma/cli-engine"
            ? [
                {
                  version: "8.0.0-rc.1",
                  path: "node_modules/@prisma/cli-engine",
                },
              ]
            : [],
        ),
    });
    const findings = await checkTarball(input(), io);
    expect(findings.filter((f) => f.kind === "engine-pin-mismatch")).toEqual(
      [],
    );
  });

  test("a family that is not installed at the declared version is a finding", async () => {
    const io = fakeIo({
      readInstalledManifest: (_s, name) =>
        Promise.resolve(
          name === "@prisma/composer"
            ? {
                version: "0.6.0-dev.15",
                dependencies: { "@prisma/cli-engine": "0.0.9" },
              }
            : undefined,
        ),
    });
    const findings = await checkTarball(input(), io);
    expect(
      findings.some(
        (f) =>
          f.kind === "engine-pin-mismatch" &&
          f.summary.includes("0.6.0-dev.15") &&
          f.summary.includes("0.6.0-dev.16"),
      ),
    ).toBe(true);
  });

  test("a non-exact engine pin in the packed shell manifest is a finding", async () => {
    const io = fakeIo({
      readPackedManifest: (tarball) =>
        Promise.resolve(
          tarball.includes("cli-engine")
            ? ENGINE_MANIFEST
            : {
                ...SHELL_MANIFEST,
                dependencies: {
                  ...SHELL_MANIFEST.dependencies,
                  "@prisma/cli-engine": "workspace:8.0.0-rc.1",
                },
              },
        ),
    });
    const findings = await checkTarball(input(), io);
    expect(
      findings.some(
        (f) =>
          f.kind === "engine-pin-mismatch" && f.summary.includes("workspace:"),
      ),
    ).toBe(true);
  });

  /**
   * How `prisma@8.0.0-rc.4` shipped crashing: the engine packed at
   * 0.2.0 while a sibling package still pinned 0.1.1, so the publish
   * resolved a registry engine missing the exports it was built
   * against. Every packed sibling must pin the engine version packed
   * beside it.
   */
  test("a packed sibling pinning a different engine version than the packed engine is a finding", async () => {
    const io = fakeIo({
      readPackedManifest: (tarball) => {
        if (tarball.includes("cli-engine")) {
          return Promise.resolve({ ...ENGINE_MANIFEST, version: "0.2.0" });
        }
        if (tarball.includes("prisma-wrapper")) {
          return Promise.resolve({
            dependencies: { "@prisma/cli-engine": "0.1.1" },
          });
        }
        return Promise.resolve({
          ...SHELL_MANIFEST,
          dependencies: {
            ...SHELL_MANIFEST.dependencies,
            "@prisma/cli-engine": "0.2.0",
          },
        });
      },
      readPackedFiles: () => Promise.resolve(new Map()),
    });
    const findings = await checkTarball(
      input({
        packages: [
          { name: "@prisma/cli", dir: "packages/cli" },
          { name: "prisma", dir: "packages/prisma-wrapper" },
          { name: "@prisma/cli-engine", dir: "packages/cli-engine" },
        ],
      }),
      io,
    );
    const stale = findings.filter(
      (f) => f.kind === "engine-pin-mismatch" && f.subject === "prisma",
    );
    expect(stale).toHaveLength(1);
    expect(stale[0]?.summary).toContain("0.1.1");
    expect(stale[0]?.summary).toContain("0.2.0");
    expect(stale[0]?.suppressedBy).toBeUndefined();
    // The shell, pinning the packed engine's exact version, is clean.
    expect(
      findings.some(
        (f) => f.kind === "engine-pin-mismatch" && f.subject === "@prisma/cli",
      ),
    ).toBe(false);
  });

  test("3a: the packed output's imports are held to the packed manifest", async () => {
    const io = fakeIo({
      readPackedFiles: (tarball) =>
        Promise.resolve(
          new Map(
            tarball.includes("cli-engine")
              ? [
                  [
                    "dist/index.js",
                    'import "@stricli/core";\nimport "colorette";\n',
                  ],
                ]
              : [
                  [
                    "dist/cli.js",
                    'import "left-pad";\nimport "@prisma/cli-engine";\nimport "@prisma/composer";\nimport "colorette";\n',
                  ],
                ],
          ),
        ),
    });
    const findings = await checkTarball(input(), io);
    const undeclared = findings.filter((f) => f.kind === "undeclared-import");
    expect(undeclared).toHaveLength(1);
    expect(undeclared[0]?.summary).toContain("left-pad");
  });

  test("3a: a package's allowedUnimported excuses a dependency reached without a static import", async () => {
    // The engine declares colorette but its packed files never import
    // it — the import.meta.resolve shape.
    const io = fakeIo({
      readPackedFiles: (tarball) =>
        Promise.resolve(
          new Map(
            tarball.includes("cli-engine")
              ? [["dist/index.js", 'import "@stricli/core";\n']]
              : [
                  [
                    "dist/cli.js",
                    'import "colorette";\nimport "@prisma/cli-engine";\n',
                  ],
                  ["dist/v8/cli.js", 'import "@prisma/composer/family";\n'],
                ],
          ),
        ),
    });

    const bare = await checkTarball(input(), io);
    expect(
      bare.some(
        (f) =>
          f.kind === "unimported-dependency" &&
          f.subject === "@prisma/cli-engine" &&
          f.summary.includes("colorette"),
      ),
    ).toBe(true);

    const excused = await checkTarball(
      input({
        packages: [
          { name: "@prisma/cli", dir: "packages/cli" },
          {
            name: "@prisma/cli-engine",
            dir: "packages/cli-engine",
            allowedUnimported: ["colorette"],
          },
        ],
      }),
      io,
    );
    expect(excused.some((f) => f.kind === "unimported-dependency")).toBe(false);
  });

  test("a failed pack is its own finding and stops that package's checks", async () => {
    const io = fakeIo({
      pack: (pkgDir) =>
        Promise.resolve(
          pkgDir.includes("cli-engine")
            ? { failed: "prepack script exploded" }
            : { tarball: `${pkgDir}.tgz` },
        ),
    });
    const findings = await checkTarball(input(), io);
    const packs = findings.filter((f) => f.kind === "pack-failed");
    expect(packs).toHaveLength(1);
    expect(packs[0]?.subject).toBe("@prisma/cli-engine");
    expect(packs[0]?.detail).toContain("exploded");
  });

  test("a failed install is a finding carrying the installer's output, not a throw", async () => {
    const io = fakeIo({
      installSandbox: () =>
        Promise.resolve({
          ok: false as const,
          output: "ETIMEDOUT registry.npmjs.org",
        }),
    });
    const findings = await checkTarball(input(), io);
    const installs = findings.filter((f) => f.kind === "install-failed");
    expect(installs).toHaveLength(1);
    expect(installs[0]?.detail).toContain("ETIMEDOUT");
  });

  test("3b: every declared bin is started; a non-zero exit names the bin", async () => {
    const started: string[] = [];
    const io = fakeIo({
      startBin: ({ binName }) => {
        started.push(binName);
        return Promise.resolve({
          exitCode: binName === "prisma-cli" ? 3 : 0,
          stdout: "",
          stderr: "boom",
          timedOut: false,
        });
      },
    });
    const findings = await checkTarball(input(), io);
    expect(started).toEqual(["prisma-cli"]);
    const bins = findings.filter((f) => f.kind === "bin-failed");
    expect(bins).toHaveLength(1);
    expect(bins[0]?.summary).toContain("prisma-cli");
    expect(bins[0]?.detail).toContain("boom");
  });

  test("a bin that hangs until the timeout is a finding that says so", async () => {
    const io = fakeIo({
      startBin: () =>
        Promise.resolve({
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: true,
        }),
    });
    const findings = await checkTarball(input(), io);
    const bins = findings.filter((f) => f.kind === "bin-failed");
    expect(bins).toHaveLength(1);
    expect(bins[0]?.summary).toContain("timed out");
  });

  test("overrides are version-qualified and cover workspace siblings transitively", async () => {
    // The shell depends on the auth library, which depends on the
    // engine; the engine is NOT a direct dependency of the shell. A
    // non-recursive override map would miss it and the install would
    // fall back to the registry.
    let seen: Readonly<Record<string, string>> = {};
    const manifests: Record<string, PackageManifest & { version?: string }> = {
      "packages/cli.tgz": {
        bin: { "prisma-cli": "./dist/cli.js" },
        dependencies: { "@repo/auth": "8.0.0-rc.1" },
      } as PackageManifest,
      "packages/auth.tgz": {
        version: "8.0.0-rc.1",
        dependencies: { "@prisma/cli-engine": "8.0.0-rc.1" },
      },
      "packages/cli-engine.tgz": { version: "8.0.0-rc.1" },
    };
    const io = fakeIo({
      pack: (pkgDir) => Promise.resolve({ tarball: `/abs/${pkgDir}.tgz` }),
      readPackedManifest: (tarball) =>
        Promise.resolve(
          manifests[tarball.replace("/abs/", "")] ?? SHELL_MANIFEST,
        ),
      installSandbox: ({ overrides }) => {
        seen = overrides;
        return Promise.resolve({ ok: true as const });
      },
    });
    await checkTarball(
      input({
        packages: [
          { name: "@prisma/cli", dir: "packages/cli" },
          { name: "@repo/auth", dir: "packages/auth" },
          { name: "@prisma/cli-engine", dir: "packages/cli-engine" },
        ],
      }),
      io,
    );
    expect(seen).toEqual({
      "@repo/auth@8.0.0-rc.1": "file:/abs/packages/auth.tgz",
      "@prisma/cli-engine@8.0.0-rc.1": "file:/abs/packages/cli-engine.tgz",
    });
  });

  test("a string-shorthand bin is started under the unscoped package name", async () => {
    const started: { binName: string; relPath: string }[] = [];
    const io = fakeIo({
      readPackedManifest: (tarball) =>
        Promise.resolve(
          tarball.includes("cli-engine")
            ? ENGINE_MANIFEST
            : ({
                ...SHELL_MANIFEST,
                name: "@prisma/cli",
                bin: "./dist/cli.js",
              } as unknown as typeof SHELL_MANIFEST),
        ),
      startBin: ({ binName, relPath }) => {
        started.push({ binName, relPath });
        return Promise.resolve({
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
        });
      },
    });
    await checkTarball(input(), io);
    expect(started).toEqual([{ binName: "cli", relPath: "./dist/cli.js" }]);
  });

  test("no packages at all is a finding, not a pass", async () => {
    const findings = await checkTarball(input({ packages: [] }), fakeIo());
    expect(kinds(findings)).toEqual(["no-subjects"]);
  });

  /**
   * Check 4 measures the packed manifests, not the workspace ones: what
   * ships is what is measured. No exception covers it, so the release
   * fails.
   */
  test("on the release channel a dev build in a packed manifest fails, uncovered by any exception", async () => {
    const findings = await checkTarball(
      input({
        channel: "release",
        exceptions: [
          {
            familyPackage: "@prisma/composer",
            familyPin: "0.0.9",
            shellPin: "8.0.0-rc.1",
            reason: "covers the engine pin, and must not reach check 4",
            removeWhen: "the families publish against the shipped engine",
          },
        ],
      }),
      fakeIo(),
    );
    const dev = findings.filter((f) => f.kind === "dev-build-in-release");
    expect(dev).toHaveLength(1);
    expect(dev[0]?.subject).toBe("@prisma/composer");
    expect(dev[0]?.suppressedBy).toBeUndefined();
  });

  test("a family that declares the engine as a peer is measured, not skipped", async () => {
    const io = fakeIo({
      readInstalledManifest: (_s, name) =>
        Promise.resolve(
          name === "@prisma/composer"
            ? {
                version: "0.6.0-dev.16",
                peerDependencies: { "@prisma/cli-engine": "0.0.9" },
              }
            : undefined,
        ),
    });
    const findings = await checkTarball(input(), io);
    expect(
      findings.some(
        (f) =>
          f.kind === "engine-pin-mismatch" &&
          f.subject === "@prisma/composer" &&
          f.summary.includes("peers"),
      ),
    ).toBe(true);
  });

  test("a family whose engine peer equals the shell's pin reports nothing", async () => {
    const io = fakeIo({
      readInstalledManifest: (_s, name) =>
        Promise.resolve(
          name === "@prisma/composer"
            ? {
                version: "0.6.0-dev.16",
                peerDependencies: { "@prisma/cli-engine": "8.0.0-rc.1" },
              }
            : undefined,
        ),
      listInstalledCopies: (_s, name) =>
        Promise.resolve(
          name === "@prisma/cli-engine"
            ? [
                {
                  version: "8.0.0-rc.1",
                  path: "node_modules/@prisma/cli-engine",
                },
              ]
            : [],
        ),
    });
    const findings = await checkTarball(input(), io);
    expect(findings.filter((f) => f.kind === "engine-pin-mismatch")).toEqual(
      [],
    );
  });

  test("a family package missing from the shell's packed dependencies is a finding", async () => {
    const findings = await checkTarball(
      input({ familyPackages: ["@prisma/composer", "@prisma/orm"] }),
      fakeIo(),
    );
    expect(
      findings.some(
        (f) => f.kind === "no-subjects" && f.summary.includes("@prisma/orm"),
      ),
    ).toBe(true);
  });
});

describe("sibling manifests and per-package sandboxes (the rc.8 class)", () => {
  const WRAPPER_MANIFEST: PackageManifest & { bin?: Record<string, string> } = {
    bin: { prisma: "./dist/prisma.js" },
    dependencies: {
      "@prisma/cli-engine": "8.0.0-rc.1",
      "@prisma/composer": "0.6.0-dev.16",
      colorette: "^2.0.20",
    },
  };

  function wrapperIo(
    wrapperManifest: PackageManifest,
    overrides: Partial<TarballIo> = {},
  ): TarballIo {
    return fakeIo({
      readPackedManifest: (tarball) =>
        Promise.resolve(
          tarball.includes("cli-engine")
            ? ENGINE_MANIFEST
            : tarball.includes("prisma-wrapper")
              ? wrapperManifest
              : SHELL_MANIFEST,
        ),
      readPackedFiles: (tarball) =>
        Promise.resolve(
          tarball.includes("prisma-wrapper")
            ? new Map([
                [
                  "dist/prisma.js",
                  'import "colorette";\nimport "@prisma/cli-engine";\nimport "@prisma/composer/family";\n',
                ],
              ])
            : new Map(),
        ),
      ...overrides,
    });
  }

  const wrapperInput = () =>
    input({
      packages: [
        { name: "@prisma/cli", dir: "packages/cli" },
        { name: "prisma", dir: "packages/prisma-wrapper" },
        { name: "@prisma/cli-engine", dir: "packages/cli-engine" },
      ],
    });

  test("a sibling pinning a shared dependency at another version is a finding", async () => {
    const findings = await checkTarball(
      wrapperInput(),
      wrapperIo({
        ...WRAPPER_MANIFEST,
        // The rc.8 defect verbatim: the wrapper's product pin lags the
        // shell's, and hoisting decides which one a user's bin runs.
        dependencies: {
          ...WRAPPER_MANIFEST.dependencies,
          "@prisma/composer": "0.5.0",
        },
      }),
    );
    const mismatch = findings.filter((f) => f.kind === "sibling-pin-mismatch");
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]?.subject).toBe("prisma");
    expect(mismatch[0]?.summary).toContain("@prisma/composer@0.5.0");
  });

  test("agreeing siblings raise no sibling finding", async () => {
    const findings = await checkTarball(
      wrapperInput(),
      wrapperIo(WRAPPER_MANIFEST),
    );
    expect(findings.filter((f) => f.kind === "sibling-pin-mismatch")).toEqual(
      [],
    );
  });

  test("every bin-bearing package installs and starts in its own sandbox", async () => {
    const started: string[] = [];
    const installed: string[] = [];
    await checkTarball(
      wrapperInput(),
      wrapperIo(WRAPPER_MANIFEST, {
        installSandbox: ({ sandboxDir }) => {
          installed.push(sandboxDir);
          return Promise.resolve({ ok: true as const });
        },
        startBin: ({ sandboxDir, binName }) => {
          started.push(`${sandboxDir}:${binName}`);
          return Promise.resolve({
            exitCode: 0,
            stdout: "",
            stderr: "",
            timedOut: false,
          });
        },
      }),
    );
    // Two sandboxes — the engine has no bin — and each bin starts in
    // its package's own sandbox, never the other's.
    expect(new Set(installed).size).toBe(2);
    expect(started.some((s) => s.endsWith("prisma-cli"))).toBe(true);
    expect(started.some((s) => s.endsWith(":prisma"))).toBe(true);
    const dirs = new Set(started.map((s) => s.split(":")[0]));
    expect(dirs.size).toBe(2);
  });

  test("a wrapper bin that fails in its own sandbox is a finding naming the wrapper", async () => {
    const findings = await checkTarball(
      wrapperInput(),
      wrapperIo(WRAPPER_MANIFEST, {
        startBin: ({ binName }) =>
          Promise.resolve(
            binName === "prisma"
              ? {
                  exitCode: 1,
                  stdout: "",
                  stderr:
                    "Cannot read properties of undefined (reading 'needs')",
                  timedOut: false,
                }
              : { exitCode: 0, stdout: "", stderr: "", timedOut: false },
          ),
      }),
    );
    const failed = findings.filter((f) => f.kind === "bin-failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.subject).toBe("prisma");
  });
});
