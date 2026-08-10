import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type MutablePackageJson,
  participatesInLockstep,
  rewriteWorkspaceDeps,
} from "./set-version-utils.ts";

describe("participatesInLockstep", () => {
  it("true for a project-boundary manifest with workspace pins (not a workspace member)", () => {
    assert.equal(
      participatesInLockstep({
        name: "smoke-app",
        version: "8.0.0-rc.1",
        dependencies: { "@prisma/cli": "workspace:8.0.0-rc.1" },
      }),
      true,
    );
  });

  it("true when the only workspace pin is a devDependency", () => {
    assert.equal(
      participatesInLockstep({
        name: "x",
        devDependencies: { "@repo/tsconfig": "workspace:*" },
      }),
      true,
    );
  });

  it("false for a fixture manifest with only registry-style specs", () => {
    assert.equal(
      participatesInLockstep({
        name: "fixture-app",
        version: "8.0.0-rc.1",
        dependencies: { "@prisma/cli": "8.0.0-rc.1", lodash: "^4.17.21" },
      }),
      false,
    );
  });

  it("false for a manifest with no dependency fields", () => {
    assert.equal(
      participatesInLockstep({ name: "bare", version: "1.0.0" }),
      false,
    );
  });
});

describe("rewriteWorkspaceDeps", () => {
  it("leaves a package with no workspace deps unchanged", () => {
    const pkg: MutablePackageJson = {
      name: "a-no-workspace-deps",
      version: "0.7.0",
      dependencies: { lodash: "^4.17.21" },
      devDependencies: { vitest: "^4.0.0" },
    };
    const before = JSON.stringify(pkg);
    rewriteWorkspaceDeps(pkg, "0.8.0");
    assert.equal(JSON.stringify(pkg), before);
  });

  it("rewrites workspace:* and workspace:<old-version> in lockstep", () => {
    const pkg: MutablePackageJson = {
      name: "b-mixed-workspace-deps",
      version: "0.7.0",
      dependencies: {
        "@prisma/cli-engine": "workspace:*",
        "@repo/cli-telemetry": "workspace:0.6.0",
        arktype: "^2.1.29",
      },
      devDependencies: {
        "@repo/tsconfig": "workspace:*",
      },
    };
    rewriteWorkspaceDeps(pkg, "0.8.0");
    assert.deepEqual(pkg.dependencies, {
      "@prisma/cli-engine": "workspace:0.8.0",
      "@repo/cli-telemetry": "workspace:0.8.0",
      arktype: "^2.1.29",
    });
    assert.deepEqual(pkg.devDependencies, {
      "@repo/tsconfig": "workspace:0.8.0",
    });
  });

  it("is idempotent — re-running with the same version produces no further change", () => {
    const pkg: MutablePackageJson = {
      name: "c-already-pinned",
      version: "0.8.0",
      dependencies: {
        "@prisma/cli-engine": "workspace:0.8.0",
      },
      peerDependencies: {
        "@repo/cli-telemetry": "workspace:0.8.0",
      },
    };
    const before = JSON.stringify(pkg);
    rewriteWorkspaceDeps(pkg, "0.8.0");
    assert.equal(JSON.stringify(pkg), before);
    rewriteWorkspaceDeps(pkg, "0.8.0");
    assert.equal(JSON.stringify(pkg), before);
  });

  it("rewrites across every dep field (dependencies, peer, dev, optional)", () => {
    const pkg: MutablePackageJson = {
      name: "all-fields",
      version: "0.7.0",
      dependencies: { "@repo/a": "workspace:*" },
      peerDependencies: { "@repo/b": "workspace:*" },
      devDependencies: { "@repo/c": "workspace:*" },
      optionalDependencies: { "@repo/d": "workspace:*" },
    };
    rewriteWorkspaceDeps(pkg, "1.0.0");
    assert.equal(pkg.dependencies?.["@repo/a"], "workspace:1.0.0");
    assert.equal(pkg.peerDependencies?.["@repo/b"], "workspace:1.0.0");
    assert.equal(pkg.devDependencies?.["@repo/c"], "workspace:1.0.0");
    assert.equal(pkg.optionalDependencies?.["@repo/d"], "workspace:1.0.0");
  });

  it("does not rewrite a non-workspace spec (e.g. a published-version pin)", () => {
    const pkg: MutablePackageJson = {
      name: "consumer-with-published-pins",
      version: "0.7.0",
      dependencies: {
        "@prisma/cli-engine": "0.7.0",
        "@prisma/cli": "^0.7.0",
      },
    };
    rewriteWorkspaceDeps(pkg, "0.8.0");
    assert.equal(pkg.dependencies?.["@prisma/cli-engine"], "0.7.0");
    assert.equal(pkg.dependencies?.["@prisma/cli"], "^0.7.0");
  });

  it("rewrites every scope, because the lockstep spans published and private packages", () => {
    const pkg: MutablePackageJson = {
      name: "with-deps-across-scopes",
      version: "0.7.0",
      dependencies: {
        "@prisma/cli-engine": "workspace:*",
        "@repo/cli-telemetry": "workspace:*",
        "@repo/tsconfig": "workspace:*",
      },
    };
    rewriteWorkspaceDeps(pkg, "0.8.0");
    assert.deepEqual(pkg.dependencies, {
      "@prisma/cli-engine": "workspace:0.8.0",
      "@repo/cli-telemetry": "workspace:0.8.0",
      "@repo/tsconfig": "workspace:0.8.0",
    });
  });

  it("tolerates a package with missing dep-field objects", () => {
    const pkg: MutablePackageJson = { name: "sparse", version: "0.7.0" };
    rewriteWorkspaceDeps(pkg, "0.8.0");
    assert.equal(pkg.version, "0.7.0"); // version is the caller's job, not the helper's
    assert.equal(pkg.dependencies, undefined);
  });
});
