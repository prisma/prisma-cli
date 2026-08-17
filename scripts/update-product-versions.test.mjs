import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyUpdates,
  computeUpdates,
  isPackageAbsent,
  selectTag,
  tagsFor,
} from "./update-product-versions.mjs";

const CLI = "packages/cli/package.json";
const PRISMA = "packages/prisma/package.json";

describe("tagsFor", () => {
  it("reads each package's own release tags on the release channel", () => {
    assert.deepEqual(tagsFor({ release: ["latest"] }, "release"), ["latest"]);
    assert.deepEqual(tagsFor({ release: ["next", "latest"] }, "release"), [
      "next",
      "latest",
    ]);
  });

  it("reads the shared dev tag on the dev channel", () => {
    assert.deepEqual(tagsFor({ release: ["next", "latest"] }, "dev"), ["dev"]);
  });
});

describe("selectTag", () => {
  it("takes the first candidate the package publishes", () => {
    assert.deepEqual(
      selectTag({ next: "8.0.0-rc.2", latest: "8.0.0-rc.1" }, [
        "next",
        "latest",
      ]),
      { tag: "next", version: "8.0.0-rc.2" },
    );
  });

  /** The ORM today: the RC line is moving to `next`, which does not exist yet. */
  it("falls through to a later candidate when the preferred tag does not exist", () => {
    assert.deepEqual(
      selectTag({ latest: "8.0.0-rc.1", dev: "8.0.0-rc.1-dev.46" }, [
        "next",
        "latest",
      ]),
      { tag: "latest", version: "8.0.0-rc.1" },
    );
  });

  it("finds nothing when the package publishes none of them", () => {
    assert.equal(
      selectTag({ dev: "0.1.0-dev.1" }, ["next", "latest"]),
      undefined,
    );
  });
});

describe("isPackageAbsent", () => {
  it("reads npm's answer for a package that does not exist", () => {
    assert.equal(
      isPackageAbsent("npm error code E404\nnpm error 404 Not Found"),
      true,
    );
  });

  /**
   * The reason this is a function and not a bare `catch`: any of these
   * read as "not published" would leave a dev publish pinned to the
   * committed release versions while calling itself a dev build.
   */
  it("refuses to read any other failure as absence", () => {
    assert.equal(isPackageAbsent("npm error code ETIMEDOUT"), false);
    assert.equal(isPackageAbsent("npm error code E401 Unauthorized"), false);
    assert.equal(isPackageAbsent("npm error code EAI_AGAIN"), false);
    assert.equal(isPackageAbsent("execFileSync ENOENT npm"), false);
    assert.equal(isPackageAbsent(""), false);
  });
});

describe("computeUpdates", () => {
  it("moves a watched dependency whose registry version moved", () => {
    const updates = computeUpdates(
      [
        {
          path: CLI,
          manifest: {
            dependencies: {
              "@prisma/composer-cli": "0.6.0-dev.22",
              left: "1.0.0",
            },
          },
        },
      ],
      new Map([["@prisma/composer-cli", "0.7.0"]]),
    );
    assert.deepEqual(updates, [
      {
        path: CLI,
        field: "dependencies",
        name: "@prisma/composer-cli",
        from: "0.6.0-dev.22",
        to: "0.7.0",
      },
    ]);
  });

  /** Both manifests carry the same pins; missing one is how they drift. */
  it("updates every manifest that declares the package", () => {
    const updates = computeUpdates(
      [
        {
          path: CLI,
          manifest: { dependencies: { "@prisma/orm-toolchain": "8.0.0-rc.1" } },
        },
        {
          path: PRISMA,
          manifest: { dependencies: { "@prisma/orm-toolchain": "8.0.0-rc.1" } },
        },
      ],
      new Map([["@prisma/orm-toolchain", "8.0.0-rc.2"]]),
    );
    assert.deepEqual(
      updates.map((update) => update.path),
      [CLI, PRISMA],
    );
  });

  it("repairs a manifest that has already drifted from its sibling", () => {
    const updates = computeUpdates(
      [
        {
          path: CLI,
          manifest: { dependencies: { "@prisma/composer-cli": "0.7.0" } },
        },
        {
          path: PRISMA,
          manifest: {
            dependencies: { "@prisma/composer-cli": "0.6.0-dev.22" },
          },
        },
      ],
      new Map([["@prisma/composer-cli", "0.7.0"]]),
    );
    assert.deepEqual(updates, [
      {
        path: PRISMA,
        field: "dependencies",
        name: "@prisma/composer-cli",
        from: "0.6.0-dev.22",
        to: "0.7.0",
      },
    ]);
  });

  it("finds a watched package in devDependencies too — the library the fixture needs", () => {
    const updates = computeUpdates(
      [
        {
          path: CLI,
          manifest: {
            dependencies: { "@prisma/composer-cli": "0.7.0" },
            devDependencies: { "@prisma/composer": "0.6.0-dev.22" },
          },
        },
      ],
      new Map([
        ["@prisma/composer-cli", "0.7.0"],
        ["@prisma/composer", "0.7.0"],
      ]),
    );
    assert.deepEqual(updates, [
      {
        path: CLI,
        field: "devDependencies",
        name: "@prisma/composer",
        from: "0.6.0-dev.22",
        to: "0.7.0",
      },
    ]);
  });

  it("skips watched packages a manifest does not declare — candidates, not requirements", () => {
    const updates = computeUpdates(
      [{ path: CLI, manifest: { dependencies: { left: "1.0.0" } } }],
      new Map([["@prisma/composer-cli", "0.7.0"]]),
    );
    assert.deepEqual(updates, []);
  });

  it("skips a package the registry has never seen at its tag", () => {
    const updates = computeUpdates(
      [
        {
          path: CLI,
          manifest: {
            dependencies: { "@prisma/orm-toolchain": "8.0.0-rc.1-dev.40" },
          },
        },
      ],
      new Map([["@prisma/orm-toolchain", undefined]]),
    );
    assert.deepEqual(updates, []);
  });

  it("reports every moved package in one run", () => {
    const updates = computeUpdates(
      [
        {
          path: CLI,
          manifest: {
            dependencies: {
              "@prisma/composer-cli": "0.6.0",
              "@prisma/orm-toolchain": "8.0.0-rc.1",
            },
          },
        },
      ],
      new Map([
        ["@prisma/composer-cli", "0.7.0"],
        ["@prisma/orm-toolchain", "8.0.0-rc.2"],
      ]),
    );
    assert.equal(updates.length, 2);
  });
});

describe("applyUpdates", () => {
  it("writes each update into the manifest it names", () => {
    const manifests = [
      {
        path: CLI,
        manifest: {
          dependencies: { "@prisma/composer-cli": "0.6.0-dev.22" },
          devDependencies: { "@prisma/composer": "0.6.0-dev.22" },
        },
      },
      {
        path: PRISMA,
        manifest: {
          dependencies: { "@prisma/composer-cli": "0.6.0-dev.22" },
        },
      },
    ];
    applyUpdates(
      manifests,
      computeUpdates(
        manifests,
        new Map([
          ["@prisma/composer-cli", "0.7.0"],
          ["@prisma/composer", "0.7.0"],
        ]),
      ),
    );
    assert.deepEqual(manifests[0].manifest, {
      dependencies: { "@prisma/composer-cli": "0.7.0" },
      devDependencies: { "@prisma/composer": "0.7.0" },
    });
    assert.deepEqual(manifests[1].manifest, {
      dependencies: { "@prisma/composer-cli": "0.7.0" },
    });
  });
});
