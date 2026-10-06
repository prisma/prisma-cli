import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  engineBumpVerdict,
  manifestChangeShips,
  publishedEngineCommit,
} from "./check-engine-version.mjs";

const NAMES_THE_STALE_VERSION = /0\.1\.1/;
const NAMES_THE_BUMP_COMMAND = /bump-cli-engine-version/;

describe("engineBumpVerdict", () => {
  it("passes when the change does not touch the engine", () => {
    const verdict = engineBumpVerdict({
      changedFiles: ["packages/cli/src/runtime.ts", "scripts/set-version.ts"],
      engineVersion: "0.1.1",
      versionOnRegistry: true,
    });
    assert.equal(verdict, null);
  });

  it("passes when the engine changed and its version is new to the registry", () => {
    const verdict = engineBumpVerdict({
      changedFiles: ["packages/cli-engine/src/commands.ts"],
      engineVersion: "0.2.0",
      versionOnRegistry: false,
    });
    assert.equal(verdict, null);
  });

  it("fails when the engine changed but its version already shipped", () => {
    const verdict = engineBumpVerdict({
      changedFiles: [
        "packages/cli-engine/src/exports/index.ts",
        "packages/cli/src/auth/refresh.ts",
      ],
      engineVersion: "0.1.1",
      versionOnRegistry: true,
    });
    assert.match(verdict, NAMES_THE_STALE_VERSION);
    assert.match(verdict, NAMES_THE_BUMP_COMMAND);
  });

  it("passes when the engine matches its already-published source", () => {
    assert.equal(
      engineBumpVerdict({
        changedFiles: ["packages/cli-engine/package.json"],
        engineVersion: "0.6.3",
        versionOnRegistry: true,
        publishedSourceMatches: true,
      }),
      null,
    );
  });

  it("does not mistake other packages' paths for the engine", () => {
    const verdict = engineBumpVerdict({
      changedFiles: ["packages/cli-engine-docs/readme.md"],
      engineVersion: "0.1.1",
      versionOnRegistry: true,
    });
    assert.equal(verdict, null);
  });
});

describe("publishedEngineCommit", () => {
  const commit = "b".repeat(40);
  const digest = "a".repeat(128);
  const integrity = `sha512-${Buffer.from(digest, "hex").toString("base64")}`;
  const statement = {
    subject: [
      {
        name: "pkg:npm/%40prisma/cli-engine@0.6.3",
        digest: { sha512: digest },
      },
    ],
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            repository: "https://github.com/prisma/prisma-cli",
            path: ".github/workflows/publish.yml",
          },
        },
        resolvedDependencies: [
          {
            uri: "git+https://github.com/prisma/prisma-cli@refs/heads/engine-fix",
            digest: { gitCommit: commit },
          },
        ],
      },
    },
  };
  function attestations(value) {
    return {
      attestations: [
        {
          predicateType: "https://slsa.dev/provenance/v1",
          bundle: {
            dsseEnvelope: {
              payload: Buffer.from(JSON.stringify(value)).toString("base64"),
            },
          },
        },
      ],
    };
  }

  it("reads the source of the published engine artifact", () => {
    assert.equal(
      publishedEngineCommit(attestations(statement), "0.6.3", integrity),
      commit,
    );
  });

  it("rejects another version or artifact digest", () => {
    assert.equal(
      publishedEngineCommit(attestations(statement), "0.6.2", integrity),
      undefined,
    );
    assert.equal(
      publishedEngineCommit(
        attestations(statement),
        "0.6.3",
        `sha512-${Buffer.alloc(64).toString("base64")}`,
      ),
      undefined,
    );
  });

  it("rejects an engine built by a different repository", () => {
    const other = structuredClone(statement);
    other.predicate.buildDefinition.externalParameters.workflow.repository =
      "https://github.com/other/repo";
    assert.equal(
      publishedEngineCommit(attestations(other), "0.6.3", integrity),
      undefined,
    );
  });

  it("does not trust a missing provenance statement", () => {
    assert.equal(
      publishedEngineCommit({ attestations: [] }, "0.6.3", integrity),
      undefined,
    );
  });
});

describe("manifestChangeShips", () => {
  const base = {
    name: "@prisma/cli-engine",
    version: "0.2.0",
    dependencies: { colorette: "^2.0.20" },
    devDependencies: { "@repo/tsconfig": "workspace:8.0.0-rc.4" },
  };

  it("a devDependencies-only change does not ship", () => {
    const head = {
      ...base,
      devDependencies: { "@repo/tsconfig": "workspace:8.0.0-rc.5" },
    };
    assert.equal(manifestChangeShips(base, head), false);
  });

  it("a version change ships", () => {
    assert.equal(
      manifestChangeShips(base, { ...base, version: "0.2.1" }),
      true,
    );
  });

  it("a dependencies change ships", () => {
    const head = { ...base, dependencies: { colorette: "^2.1.0" } };
    assert.equal(manifestChangeShips(base, head), true);
  });

  it("an added field ships", () => {
    assert.equal(
      manifestChangeShips(base, { ...base, sideEffects: false }),
      true,
    );
  });
});
