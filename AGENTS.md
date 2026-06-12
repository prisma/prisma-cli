# AGENTS.md

## Purpose

Use this file for repo-wide instructions. Use package-local `AGENTS.md` files for package-specific rules.

## Development Setup

1. Run `pnpm install`.
2. Use `pnpm --filter <package> <script>` for package-local checks.
3. Run root scripts only when they match the changed surface.
4. Keep generated artifacts out of commits unless the task requires them.

## Package Manager

- Use `pnpm` for commands run inside this repo.
- Use `npm` or multiple package-manager examples in user-facing content.

## Pre-Commit Verification

- `pnpm --recursive exec tsc --noEmit`
- `pnpm lint`
- Package-specific tests for changed packages
  - `pnpm --filter @prisma/cli test`
  - `pnpm --filter @prisma/compute test`
- If verification fails because work is intentionally incomplete, include the failing command and reason in the commit message.
