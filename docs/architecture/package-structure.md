# Package Structure

The repository is a pnpm workspace. The root owns shared scripts, docs, release preparation, and the conformance checks.

| Directory | Package | Published | What it is |
| --- | --- | --- | --- |
| `packages/cli-engine` | `@prisma/cli-engine` | yes, on its own version line | The execution engine: argv to exit code, needs checks, credentials, rendering, errors |
| `packages/cli` | `@prisma/cli` | yes, `prisma-cli` binary | The CLI shell: mounts every command family and assembles the engine's runtime |
| `packages/prisma` | `prisma` | yes, `prisma` binary | A wrapper that publishes the same shell under the unscoped name |
| `packages/compute` | `@prisma/compute` | yes, on its own version line and workflow | Runtime utilities for applications deployed to Prisma Compute; pending extraction to another repository |
| `packages/cli-telemetry` | `@repo/cli-telemetry` | no | The telemetry sender, bundled into both bins |
| `packages/cli-conformance` | `@repo/cli-conformance` | no | The conformance checks the publish workflow runs on the built output and packed tarballs |
| `packages/tsconfig` | `@repo/tsconfig` | no | The shared TypeScript base config |

[Versioning](../oss/versioning.md) explains which packages version in lockstep and which do not.

## The engine

`@prisma/cli-engine` is one library package. Product CLI packages (`@prisma/composer-cli`, `@prisma/orm-toolchain`) build their command families against it and declare it as an exact peer, so one install holds one engine ([ADR 0004](adrs/0004-engine-version-pinning.md)). It has three entry points:

- `@prisma/cli-engine`: command definitions, flag and positional builders, the context and runtime types, the credential manager contract, and `createCli`.
- `@prisma/cli-engine/protocol`: the shapes that cross package and process boundaries, for consumers that need them without the engine's runtime. It is a small runtime module, not types only: it exports `CliStructuredError`, `STRUCTURED_ERROR`, and the result constructors `ok`, `notOk`, and `okVoid`, alongside the `Diagnostic`, `NextAction`, `CliErrorEnvelope`, `Ok`, `NotOk`, and `Result` types. Products import `ok`, `notOk`, and `CliStructuredError` from it.
- `@prisma/cli-engine/testing`: the in-process test harness, the in-memory credential manager, and the JWT minter that seeds it.

Authentication (token storage, refresh, the login flow) lives in this repository's CLI package (`packages/cli/src/auth`), separate from any Prisma Cloud product code. The engine defines the `CredentialManager` contract and consumes it; the CLI supplies the implementation. See [Credentials and sessions](credential-manager.md).

## The two bins

`@prisma/cli` and `prisma` ship the same shell. `packages/prisma/src/bin.ts` imports `@prisma/cli/src/bin`, and its build bundles `@prisma/cli`, `@repo/cli-telemetry`, and `@prisma/credentials-store` into `dist/prisma.js`, so a command cannot behave differently depending on which package a user installed. The wrapper also exports `prisma/config`, which re-exports `definePrismaConfig` from the engine so a user's `prisma.config.ts` never depends on `@prisma/cli-engine` directly, and it ships the `prisma-platform-core-concepts` agent skill in its `skills/` directory, staged from the repository root `skills/` tree at `prepack` by `scripts/stage-skills.mjs`.

The wrapper's `package.json` carries its own copy of the runtime dependencies, including the product version pins on `@prisma/composer-cli` and `@prisma/orm-toolchain` and the `workspace:` pin on the engine. A user's `npm install prisma` resolves from the wrapper's copy, so the two manifests must declare the same dependencies at the same versions. Three checks keep them equal to `packages/cli`'s: `packages/cli/tests/manifest-pins.test.ts` asserts the wrapper's `dependencies` deep-equal the shell's; the conformance tarball check (`packages/cli-conformance/src/checks/tarball.ts`) fails on any dependency two packed manifests pin differently and on any engine pin that differs from the engine version packed beside it, then installs each packed bin into its own sandbox and starts it; and `scripts/update-product-versions.mjs` and `scripts/bump-cli-engine-version.ts` rewrite both manifests in one step so a pin cannot move in one without the other.

## Agent skills

A skill's content only ever comes from the packages named in `packages/cli/src/lib/skills/allowlist.ts`; `prisma skills sync` never scans `node_modules`. Skills travel inside the tarball of the package they describe, so an installed skill matches the installed package version by construction.

When a skill's content has to differ per database, split it into separately named skills, one per ORM facade package. Never add a carrier package that ships skills on another package's behalf: a transitive carrier package cannot be resolved from the project root under pnpm, and a direct-dependency skills package would break the guarantee that installed skills match the installed package versions. Every ORM facade ships an identical `prisma-8` skill and a version conflict between facades resolves to the highest version, which is only safe while the content is identical and the versions move together. The allowlist grows by one deliberate line per facade either way.

## CLI Source Layout

`packages/cli/src/`:

- `bin.ts`: process entrypoint for the `prisma-cli` binary; the `prisma` bin imports it.
- `main.ts`: builds the CLI, runs the cached update notice, hands the engine a runtime, and after the command runs reports out-of-date agent skills.
- `cli.ts`: mounts every command and command family, including composer's and the ORM toolchain's.
- `runtime.ts`: assembles the engine `Runtime` from `process`: streams, the credential manager, the API client config, the spawn and package-manager adapters, and the telemetry sender.
- `cli-name.ts`, `cli-command.ts`, `command-arguments.ts`, `shell-command.ts`: the CLI's user-facing name and how it renders commands for a user to paste.
- `commands/<group>/*`: one file per command: flags, help, handler.
- `controllers/*` and `presenters/*`: the operation layer the handlers call, and the serializers they reuse.
- `auth/*`: sessions, credentials, token storage, and the login flow.
- `adapters/*`: local state and git.
- `lib/*`: feature-specific helpers and client code, including the skills allowlist and sync.
- `output/*`: shared presentation patterns.
- `types/*`: shared CLI data shapes.
- `spawn.ts`, `package-manager-runner.ts`: the `node:child_process` adapters the engine's spawn and package-operation seams are wired to.
- `skills-check.ts`, `update-check.ts`, `state-dir.ts`: the post-command skills staleness notice, the update notice, and local state directory resolution.

## Layering Rules

- Product behavior starts in `docs/product`, then code follows.
- Command modules may parse inputs and register help, but should not own resource resolution or side effects.
- The operation layer should not write directly to terminal streams.
- Presenters should not perform filesystem, network, or state mutations.
- Adapter and client modules should keep external boundaries behind small, testable interfaces.
- Output flows through the engine: handlers describe presentation blocks, so human, JSON, and markdown behavior stay consistent.

## Tests

Unit tests live in `packages/cli/tests`; end-to-end tests against the real management API live in `packages/cli/e2e`.

- Use in-process CLI tests for command behavior, output, prompts, and errors.
- Use operation-layer tests when a behavior can be exercised without going through the engine.
- Use package metadata and tarball-content checks for publishing changes.
- Add subprocess or package smoke tests when changing packaging, entrypoints, or binary behavior.
- Every mounted command needs a happy-path end-to-end test declared with `describeCommand`; `packages/cli/tests/e2e-coverage.test.ts` fails the build for a command without one. The repository `AGENTS.md` states the rule.

See [testing patterns](../reference/testing-patterns.md) for more detail.
