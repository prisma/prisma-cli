# Automatic Update Check Spec

## Problem

The Prisma CLI beta changes quickly. Users who keep an older installed version can miss bug fixes, command behavior updates, and deploy workflow improvements, then spend time debugging issues already fixed in newer releases.

Success means interactive CLI users learn about newer official releases without the original command failing, slowing materially, or polluting machine-readable output.

The case against this work is that automatic network checks can feel noisy, can make a CLI look less deterministic, and can create privacy or enterprise-policy concerns. This spec limits the behavior to occasional advisory checks that are skipped in automation and can be disabled by environment configuration.

## Stakeholders

**S1** Primary interactive CLI users need a low-friction reminder when their installed CLI is stale, plus one clear update command.

**S2** CI, scripts, agents, and other automation need stable stdout, concise stderr, no prompts, and no surprise network dependency.

**S3** Prisma CLI maintainers need users to converge on supported beta builds without turning update discovery into a command-specific concern.

**S4** Support and product teams need bug reports and feedback to come from reasonably current CLI builds where possible.

## Functional requirements

**FR1** The CLI checks for newer official `@prisma/cli` releases automatically during normal CLI use.

**FR2** The automatic check is advisory only: it must never update the CLI, mutate the user's project, mutate remote Prisma resources, or require confirmation.

**FR3** When a newer official release is known, the CLI prints one concise human-readable notification that includes the installed version, the latest version, and a best-effort update instruction.

**FR4** After printing an update notification, the CLI continues the originally requested command with the same behavior and exit code it would have had without the update notification.

**FR5** Update notifications are written to stderr only. They must never be written to stdout.

**FR6** The automatic check and notification are skipped when `CI` is set or the runtime otherwise identifies a CI environment.

**FR7** The automatic check and notification are skipped in `--json` mode.

**FR8** The automatic notification is skipped in `--quiet` mode.

**FR9** The automatic notification is skipped when stderr is not a TTY.

**FR10** The CLI checks the remote package source at most once every 24 hours per user and package identity.

**FR11** The 24-hour check interval is a fixed product constant, not a user-facing configuration setting.

**FR12** A failed update check does not print an error or warning, does not change the original command result, and does not alter the command exit code.

**FR13** The CLI remembers enough local update-check state to avoid repeated remote checks and repeated notifications inside the interval.

**FR14** When the 24-hour interval has elapsed, remote update discovery runs opportunistically in the background and does not block the originally requested command.

**FR15** Users can disable automatic update checks with `NO_UPDATE_NOTIFIER`.

**FR16** The latest version source is the npm `latest` dist-tag for `@prisma/cli`, matching the official beta package channel.

**FR17** The notification recommends an update instruction that matches the detected invocation or install context when the CLI can infer one confidently:

```text
Update available: prisma-cli <current> -> <latest>
Run <recommended-command> to update.
```

**FR18** When the CLI cannot confidently infer the invocation or install context, the notification links the user to the package installation docs instead of guessing a package-manager-specific command.

**FR19** Until a stable package-installation docs URL is defined, fallback notifications use `https://prisma.io/docs`. Implementation should leave a TODO next to this URL so it is replaced when the canonical CLI installation page exists.

**FR20** The update check does not run for unit tests by default.

**FR21** The richer `prisma-cli version` command remains the canonical way to inspect the installed CLI build and host environment; the update notification does not replace or change that command's structured result.

## Non-functional requirements

**NFR1** The original command must not wait on remote update discovery. Local update-check eligibility and cached-notification bookkeeping should be fast enough to be unnoticeable to interactive users.

**NFR2** The update check must be best-effort and network-failure tolerant. Offline users, blocked registries, DNS failures, and registry errors must be silent.

**NFR3** Machine-readable output remains stable. `--json` stdout schemas, `--version` stdout, and command result envelopes are unchanged.

**NFR4** The notification follows the CLI style guide: concise text, no emoji, no banner, no prompt, and no color-dependent meaning.

**NFR5** The local update-check state must not be written into the user's project directory, committed repo files, or `.prisma/local.json` project context.

**NFR6** The local update-check state must not store secrets, auth tokens, project identifiers, branch names, app names, command arguments, working-directory paths, or package-manager-specific install paths.

**NFR7** Concurrent CLI invocations must not corrupt the local update-check state or produce multiple notifications in normal terminal use.

**NFR8** The check should align with established Node CLI update-notifier conventions: interval-based checks, persisted local state, CI/test suppression, TTY-only notification, and env-var opt-out.

## Assumptions

**A1** Official update discovery should use `@prisma/cli` on npm, not GitHub releases, because ADR 0001 defines npm publishing and the `latest` dist-tag as the official beta release channel.

**A2** The first version does not add a global `--no-update-notifier` flag. `NO_UPDATE_NOTIFIER` is the only user-facing opt-out for this slice.

**A3** Installation context detection is best-effort. The CLI may infer package-manager and invocation hints from runtime signals such as npm user agent, executable path, package-manager environment variables, and the existing `version` command's invocation detection, but it must not claim certainty when those signals are ambiguous.

**A4** The notice should recommend a command only when it is likely to be correct for the current invocation. Examples include `npm install --save-dev @prisma/cli@latest` for local npm usage, `npm install --global @prisma/cli@latest` for confidently detected global npm usage, `pnpm add -D @prisma/cli@latest` for local pnpm usage, and `bun add -d @prisma/cli@latest` for local Bun usage.

**A5** Ephemeral invocations such as `npx`, `pnpx`, and `bunx` should not be told to update an installed package unless the CLI can identify an actual persistent install. They should receive a rerun or docs-oriented instruction instead.

**A6** The notice should be shown before the original command's human output only when stale-version information is already known locally. If the current invocation only discovers the new version in the background, the first notification can wait until a later invocation.

**A7** Development, test, and PR-preview package builds should not notify users to update unless they are installed as an official npm package with a version older than the `latest` dist-tag.

**A8** The standard convention research basis is the widely used Node `update-notifier` behavior: daily interval-based checks, async remote checks, persisted result, CI/test suppression, TTY-only notification, and `NO_UPDATE_NOTIFIER` opt-out.

## Downstream effects

**DE1** Packaging and publish-prep tests need coverage for any new bundled files or runtime dependencies introduced by the check.

**DE2** CLI entrypoint tests need to assert stream behavior: no stdout changes, no JSON-mode notification, no CI notification, and no quiet/non-TTY notification.

**DE3** Support docs may need to mention that users can run `prisma-cli version` and follow the package installation docs for the update command that matches their package manager and install mode.

**DE4** Enterprise users with restricted registry access may see silent skipped checks. That is acceptable; update discovery is advisory and must not become a hard dependency.

**DE5** If the CLI later exposes a stable `prisma` binary instead of `prisma-cli`, the notification copy and recommended command need to follow the then-current package docs.

## Out of scope

**OS1** Automatically installing or self-updating the CLI.

**OS2** Blocking commands when the installed CLI is stale.

**OS3** Checking for updates to Prisma ORM, app dependencies, agent skills, or project packages.

**OS4** Adding a new user-facing `update`, `upgrade`, or `doctor` command.

**OS5** Adding release notes, changelog rendering, or migration guidance to the notification.

**OS6** Telemetry or analytics for update-check impressions.

**OS7** Changing the semantics of `prisma-cli version` or `prisma-cli --version`.

## Open questions

None.
