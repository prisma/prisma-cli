# S7 parity divergences — mounting the ORM family

**No user-visible divergence from any shipping CLI is introduced by
S7.** This file exists because S2 standing ruling 10 requires
divergences to be enumerated rather than discovered, and because a
slice that changes the command tree has to say so explicitly when the
answer is "none".

Why the answer is none: S7 mounts commands that no binary this repo
ships could reach before. `prisma migration list`, `prisma db verify`,
`prisma init` and the rest of the ORM family answer for the first time.
Adding an invocation that previously did not exist changes nothing a
user already relied on.

The divergences between the ORM commands as they run under this shell
and as they run under `prisma-next` — the engine's shared flags, json
framing, channel discipline, the `{bin}` substitution in help examples,
and everything else the port changed — belong to S5, which owns that
record and keeps it in prisma/prisma alongside the port. S7 mounts the
family; it does not change what the family does.

Nothing already shipped changes behaviour: the platform and composer
commands keep their paths, flags and output, no group brief was
reworded, and no existing invocation was retired or moved. The ORM
family's own redirect table (`migration apply`, `migration ref`, and
four retired `migration status` flags) arrives with the family, so it
describes invocations of `prisma-next` that were already retired there,
not invocations this shell used to answer.

## One operational fact, not a divergence

`@prisma/orm-toolchain`'s `./cli` entry statically imports `esbuild`
and `arktype` (and eight `@prisma/orm-framework` subpaths), so every
invocation of this bin now pays that import — including `prisma
--version`, which touches no ORM code. Composer's family avoids this by
keeping its heavy graph behind dynamic executor imports; the ORM family
does not do the same yet.

This costs startup time, not correctness, and no user-visible output
changes because of it. Fixing it means moving orm-toolchain's handler
imports behind dynamic imports, which is prisma/prisma's change to
make, not this repo's. Mirrored in
[`../../deferred.md`](../../deferred.md) under "Upstream, not ours to
land".
