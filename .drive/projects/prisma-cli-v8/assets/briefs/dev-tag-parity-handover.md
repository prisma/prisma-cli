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

Publish a dev build of the release commit too. A release commit is a build of `main`, so it gets a dev version like any other build of `main`: after the release publish succeeds, publish the same tree again as `<version>-dev.<run>` under the `dev` tag.

**Do not try to move the tag with `npm dist-tag add`.** If you publish over npm OIDC trusted publishing, that will not work: npm's documentation states that OIDC authentication supports `npm publish` and `npm stage publish` only, and that other commands still require traditional authentication. A dist-tag change is one of those. Reaching for a long-lived npm token to work around it would give up the property that makes trusted publishing worth having — that no credential exists which could publish out-of-band if leaked. Publishing a second version needs no new credential, because it goes through the same `npm publish` path that already works.

The version this produces sorts above the release under semver (`8.0.0-rc.4-dev.55` > `8.0.0-rc.4`), which is correct: it is a later build of the same code.

The cost is one extra published version per release. That is the price of the `dev` tag meaning what it says.

## How to know it worked

After the next release, for every published package:

```bash
npm view <package> dist-tags
```

`dev` and the release tag should name the same version, and `dev` should never name an older one. Worth asserting in the workflow rather than checking by eye.
