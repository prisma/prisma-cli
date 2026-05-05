# Common Tasks

Use this playbook when making common changes to the CLI.

## Add Or Change A Command

1. Update the source-of-truth product docs first:
   - [command spec](../product/command-spec.md)
   - [command principles](../product/command-principles.md)
   - [resource model](../product/resource-model.md), when resources or resolution rules change
2. Add or update the command grammar in `packages/cli/src/commands`.
3. Put command orchestration in `packages/cli/src/controllers`.
4. Put product rules and resource resolution in `packages/cli/src/use-cases`.
5. Add presenter changes when output shape changes.
6. Add tests for human output, `--json`, non-interactive behavior, and errors.

## Change Output

1. Check [output conventions](../product/output-conventions.md).
2. Keep machine-readable data on stdout.
3. Keep human status, prompts, and decoration on stderr.
4. Update presenters and output tests together.
5. Include `--json` coverage for automation-relevant behavior.

## Add Or Change An Error

1. Update [error conventions](../product/error-conventions.md).
2. Use a stable machine-readable code.
3. Include a summary, why, fix, and next steps when applicable.
4. Assert both human and JSON error shapes in tests.

## Change Resource Resolution

1. Update [resource model](../product/resource-model.md).
2. Update [command spec](../product/command-spec.md).
3. Keep `local` local-only.
4. Keep `production` protected and durable.
5. Preserve `workspace -> project -> branch -> { app, database }`.

## Update Publish Preparation

1. Update `packages/cli/package.json` and `packages/cli/README.md` if package
   metadata or package-facing docs change.
2. Update `scripts/prepare-cli-publish.mjs` when staged package contents change.
3. Update `packages/cli/tests/publish-prep.test.ts`.
4. Run `pnpm build:cli` and `pnpm prepare:cli-publish`.
5. Do not publish from a local checkout unless the release owner explicitly asks
   for that.

## Record An Architecture Decision

Add a short ADR under `docs/architecture/adrs` when a decision affects public
contributors, command shape, package identity, output contracts, error
contracts, or release preparation.
