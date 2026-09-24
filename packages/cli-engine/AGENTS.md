# AGENTS.md — @prisma/cli-engine

## arktype

Config section schemas (`configSchema`, the `path` keyword, `validateSectionWithSchema` in `src/config-schema.ts`) are arktype. See ADR 0005 for the design.

### Read the arktype docs before building machinery

Before you write code that walks a schema, copies values around validation, or repairs arktype's output afterwards, read the arktype docs at https://arktype.io/docs, in particular Configuration, Morphs and Scopes. arktype has documented options for most problems that look like they need bespoke code. Never read arktype's compiled node tree (`schema.internal`, `.structure`, `.branches`, `.in`): it is not a public API.

This engine once shipped a copy-and-restore walk over that node tree, about 200 lines, to stop arktype rebuilding the objects a config file built. arktype's documented `clone` option replaced it with about twenty.

### What a transformation does to its input

- A morph is any transformation: `.pipe()`, `=>`, or a default value. When at least one morph applies anywhere in a value, arktype clones the whole input first and writes each result into the clone. Without morphs, validation returns the input itself.
- The default clone keeps prototypes but rebuilds every plain object and class instance. Identity is lost, private `#fields` are lost, and `===` checks against shared objects fail. Functions, `Map` and `Set` are kept as they are.
- The clone is the `clone` config option. `configScope` sets it to `copyPlainParts`, which copies only plain objects and arrays, so everything else a config file constructed reaches the command unchanged. Keep it: a family's config objects must not be rebuilt.
- `clone: false` writes into the caller's input and throws on frozen input. `structuredClone` throws on functions and drops prototypes. Neither is a substitute.

### Other behaviour the config schemas rely on

- A literal default runs its morph when the schema is defined; a thunk default runs it when the default is applied. A relative `path` default must be a thunk, `["path", "=", () => "./migrations"]`, so it resolves against the config file. `resolvePathValue` refuses a relative literal.
- In `.pipe((value, ctx) => ...)`, `ctx.path` is the key path of the value within the section. The `path` keyword uses its first key to find the config file that declared the value.
- A path given to `ctx.error` or `ctx.reject` inside a `.narrow()` is taken from the root, not from the narrowed value. Prepend `ctx.path` to report under the narrowed value, or better, declare the fields so arktype reports each one itself.
- Undeclared keys are kept by default, and missing keys are reported in alphabetical order.
