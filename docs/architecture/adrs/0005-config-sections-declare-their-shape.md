# ADR 0005 - Config sections declare their shape once, and the engine derives validation and path resolution from it

## Status

Accepted (operator, 2026-09-22).

## Decision

A command family declares the config section it accepts once, as a schema, and marks the fields that hold paths as `path`. The engine derives everything else from that declaration: structural validation, diagnostics that name the bad field and the file to fix, and the resolution of every `path` field against the config file that wrote it.

```ts
import { configSchema, defineConfigSection } from "@prisma/cli-engine";

export const ormConfigSection = defineConfigSection({
  name: "orm",
  schema: configSchema({
    "contract?": {
      source: { "inputs?": "path[]", load: "Function" },
      "output?": "path",
    },
    "migrations?": { dir: ["path", "=", () => "./migrations"] },
  }),
});
```

Given this file and this invocation:

```
exp/
  sub/
    prisma.config.ts   # orm: { contract: { source: { inputs: ['./contract.prisma'] } } }
    contract.prisma
```

```
cd exp && prisma contract emit --config ./sub/prisma.config.ts
```

the handler receives `contract.source.inputs` as `['/…/exp/sub/contract.prisma']`, `migrations.dir` as `/…/exp/sub/migrations`, and `baseDir` as `/…/exp/sub`, whatever directory the command ran from.

## Context

A relative path in a config file is relative to that file; there is no other reading an author could mean. But the engine handed a section over exactly as written and the command family did not know which file it came from, so families resolved against the working directory. The ORM's `contract emit --config ./sub/prisma.config.ts`, run from `exp`, looked for `./contract.prisma` in `exp` and failed; from `exp/sub` the same file worked.

Config discovery walks up to the repository root and merges files, most local value winning (`config-merge.ts`), and it records provenance: which file wrote each top-level key of the merged section. That is the information path resolution needs, per key, after the merge. What was missing was a way for the engine to know which fields are paths. A section was opaque to it.

Several designs were tried before this one, and each put the knowledge in the wrong place: telling the command which file was loaded (wrong under layering, where one section merges several files); asking authors to pass `import.meta` (a value the loader already has); a resolver function attached to each section and called per file (a protocol two parties must implement); publishing the file's directory to the file while it evaluates (ambient state, and it moved resolution into `defineConfig`, which the ORM's rules reserve for normalisation only). Declaring the shape removes the question: the family says which fields are paths, and the engine, which has the provenance, resolves them.

## How it works

- `configSchema` is arktype's `type` in a scope with one extra keyword, `path`: a string that validation resolves against the directory of the file that declared the value's top-level key, using the section's provenance. An absolute value passes through unchanged. Every other arktype feature (optional keys, defaults, unions, narrows for cross-field rules) is available as is.
- `defineConfigSection({ name, schema })` derives the section's validator. The engine runs it on the merged section value with its provenance, after discovery and merging, so defaults declared in the schema apply once to the merged value and never let one file's default shadow another file's authored value. A relative `path` default is declared as a thunk, `["path", "=", () => "./migrations"]`, which arktype evaluates and morphs when the default is applied, so it resolves against the nearest file like an authored value; a relative literal default would be stored unresolved, and is refused when the schema is defined.
- Each arktype error becomes a `CLI.CONFIG_FIELD_INVALID` diagnostic carrying `meta.section`, `meta.field`, and `where.path`, the file that declared the field's top-level key, so a chain of files still tells the user which one to fix.
- The validated value of a plain-object section carries `baseDir`, the directory of the nearest file declaring the section, for commands that need the project's location rather than one of its files. The key is reserved: a config file that writes it is refused.
- Resolving a path or applying a default transforms the value, and arktype clones what it is given before it transforms it, so a config file's own objects are never written to. Its built-in clone rebuilds every object it reaches, which would hand a command a lookalike of the codec table or the contract serializer the file built. The engine supplies a clone that rebuilds plain objects and arrays and nothing else, so a class instance, a `Map` or a function reaches the command exactly as the file constructed it.
- An absent section is validated as an empty object: a schema whose fields are all optional accepts it, and a required field is reported by name.
- `defineConfigSection({ name, validate })` remains for a section a schema cannot express; such a validator resolves its own path fields through `resolveSectionPath`.

The same declaration style is the contract for every product that mounts commands in the CLI: the ORM, Composer, and any future family declare their section with `configSchema` and get identical validation, diagnostics, and path semantics.

## Consequences

- A family with a schema writes no validation, resolution, or path-anchoring code. Its commands read absolute paths and `baseDir`.
- `@prisma/cli-engine` depends on arktype, which is what every product's schema is written in.
- A family whose section has `path` fields needs an engine that runs schemas. Under the exact peers of ADR 0004, a family release that adopts a schema moves its engine peer to the engine that ships this, and the engine ships first.
- Validation of one section is synchronous and self-contained; there is no ambient state to get wrong under concurrent loads.

## Alternatives considered

- **Command context carries the loaded file's path.** Fails as soon as one section merges several files: one path cannot anchor values from two directories.
- **Authors pass `import.meta` to the config helper.** Asks for a value the loader already knows, and because the helper runs before the outer call, still needs a deferred-resolution protocol.
- **A resolver function on the section, called by the loader per file.** Same result, through a protocol both the family and every loader must implement, plus per-layer resolution inside each loader.
- **A base directory published to the file while it evaluates.** Ambient state, needed an `AsyncLocalStorage` to survive concurrent loads, and moved resolution into the family's `defineConfig`, whose job is normalisation.
- **The engine resolves paths without a declaration.** It cannot: a section is opaque unless its owner declares which fields are paths. This ADR is that declaration.
