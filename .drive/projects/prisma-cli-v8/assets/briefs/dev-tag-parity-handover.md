# Handover brief — the `dev` dist-tag must never fall behind `latest`

For the agents working in `prisma/composer` and `prisma/prisma`. Small, self-contained, one step in each publish workflow.

## The defect

A release publish moves `latest` (or `next`) and leaves the `dev` tag where the last routine push to `main` put it. So immediately after a release, `dev` points at an **older** version than `latest`:

```
$ npm view @prisma/composer-cli dist-tags
{ latest: '0.7.0', dev: '0.6.0-dev.23' }     # dev is older than latest
```

That is wrong on its own terms: `dev` means "the newest build from `main`", and a release commit is a build of `main`. It stays wrong until someone happens to push another commit.

`prisma/prisma-cli` has the same defect in its own workflow (`dev` at `8.0.0-rc.2-dev.51` while `next` is at `8.0.0-rc.3`) and is fixing it the same way.

## Why it matters to us specifically

`prisma/prisma-cli` follows your `dev` tags to build the CLI's dev channel: a dev build of the CLI depends on your latest dev builds, and a release of the CLI depends on your releases (operator ruling 2026-08-17; `docs/oss/release-automation.md` in prisma-cli). We read the tag and trust it.

So while your `dev` tag lags, every dev build of the CLI **regresses** to an older version of your product than the released CLI carries. It does not fail any check — a dev build depending on dev builds is exactly what that channel is for — it just quietly tests older code than the release does, which is the opposite of what a dev channel is for.

We are deliberately not working around it in prisma-cli by comparing versions and picking the newer tag. The tag should be right.

## The fix

After a release publish succeeds, point `dev` at the released version:

```bash
npm dist-tag add "<package>@<version>" dev
```

For every package the release publishes, at the version each one actually shipped — packages excluded from your lockstep ship at their own version, so do not assume one version string covers them all.

Placement: after the publish step and after whatever creates the GitHub Release, keyed on the publish having succeeded. If the release publish did not happen, the tag must not move.

## Two things to check while implementing

1. **Whether your publish credentials can write a dist-tag.** If the workflow publishes over npm OIDC trusted publishing, the short-lived token is issued for publishing; confirm it also authorises `PUT /-/package/{pkg}/dist-tags/{tag}` before relying on it. If it does not, the alternative is a granular token with write access to those packages, and that is worth knowing rather than discovering during a release.
2. **Idempotence on a rerun.** `npm dist-tag add` on a tag that already points at that version is a no-op and should not fail the run. A rerun of a release publish is a normal event.

## How to know it worked

After the next release, for every published package:

```bash
npm view <package> dist-tags
```

`dev` and the release tag should name the same version, and `dev` should never name an older one. Worth asserting in the workflow rather than checking by eye.
