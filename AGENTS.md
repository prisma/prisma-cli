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
