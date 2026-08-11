# S2b2 — Domain extraction, bucket group (slice contract)

One PR into `main`, branch `s2b2-domain-extraction`, after S2b merged (#133). **Scope is the six `bucket` commands only.** The other four groups follow in later slices, and the operator reassesses after this one lands.

## The decision this slice implements

Command handlers parse input and present output. Use cases hold business logic with their external services injected. Adapters implement the ports. Operator ruling, 2026-08-11.

This slice proves that shape on one group before four more are committed to it.

## Why bucket first

Its provider is already a port. `BucketProvider` (`lib/bucket/provider.ts:29-50`) is six async methods over plain record types with no engine and no shell types in the signatures. Four of the six commands — `delete`, `key list`, `key create`, `key delete` — reach nothing but that provider.

The other two are not clean, deliberately: `bucket list` and `bucket create` resolve a project through `v8/bucket/context.ts`, which calls `resolvePinnedProject` in `v8/project/context.ts` — the file holding the legacy-context adapter and its throwing proxy. So the slice covers the trivial case and one instance of the shared project-resolution problem, without the six ports and interactive picker that make `project` hard.

## What the investigation established

Recorded in `../assets/s2/logic-map-resources.md`, with the other groups in the sibling files.

- Almost no business logic is in the bucket handlers. It is in `lib/bucket/provider.ts` and, for two commands, `lib/project/resolution.ts`.
- The bucket handlers import nothing from `controllers/`.
- No bucket command calls `ctx.report`, so no output port is needed.
- `bucket delete` takes a typed confirmation. Its token is the bucket id the handler already holds, so no lookup precedes it.

## Where things live

```text
src/use-cases/<area>/    use cases, and the port interfaces they own
src/adapters/<area>/     implementations of those ports
src/v8/<group>/          handlers: parse arguments, call a use case, present the result
```

`use-cases/` is the existing directory. Its five current files are fixture-era and are **not** a starting point — see R-Y-6. `adapters/` is the existing directory holding `git.ts` and `local-state.ts`.

## Mapping rules

R-Y-1 **A use case never learns how the CLI talks to anyone.** No engine types, no shell types, no prompts, no terminal, no `process.env`, no rendering. Everything external arrives as an injected port. A use case may take an `AbortSignal` as a parameter — that is a parameter, not a service.

R-Y-2 **Prompting stays in the handler.** Consent is input gathered before an operation, not part of one. `bucket delete`'s use case exposes `deleteBucket(bucketId)` and does not mention consent. This matters beyond tidiness: the engine deliberately makes consent undefaultable — `--yes` will not satisfy it — and a consent port would mean every test supplying a fake that always grants, reintroducing exactly the defaulting the engine prevents.

R-Y-3 **Ports are owned by the use cases, not by their implementations.** The `BucketProvider` interface moves to `use-cases/bucket/`; `createManagementBucketProvider` moves to `adapters/bucket/`. The interface is already the right shape and its method signatures do not change in this slice.

R-Y-4 **Project resolution is shared, and this slice does not own it.** `bucket list` and `bucket create` need it. Introduce the smallest ports that serve them — listing a workspace's projects, and reading the `.prisma/local.json` binding — and implement them over the existing functions. Do not restructure `lib/project/resolution.ts`, and do not delete the legacy-context adapter; `project` still needs it and owns that work.

R-Y-5 **Absence is returned as `null`, never as a word.** A use case returning `"unknown"` or `"unscoped"` corrupts the machine-readable output, because the handler cannot tell it from a real value. Reader placeholders are the handler's job. This is the rule the stdout work in S2b arrived at, applied at the new boundary.

R-Y-6 **No behaviour changes.** Every one of the 60 bucket-related assertions in `tests/v8-bucket.test.ts` passes unmodified, and so does the golden-rendering entry for `bucket key create`. A test that needs editing means the extraction changed behaviour, which is a defect. The published `--json` contract is now declared explicitly on every command, so it is checkable rather than implied.

R-Y-7 **The legacy shell keeps working.** It still serves `app`, `service`, `build`, `agent`, `feedback` and `init` until S2d. Nothing in `commands/`, `controllers/` or `presenters/` is deleted here. Where the shell calls something this slice moves, it calls it at its new home.

R-Y-8 **Do not touch the existing `use-cases/*.ts` files.** They are fixture-era, only reachable through `--fixture`, and two of them encode behaviour that contradicts what ships. They are deleted when their groups are extracted, not now, and nothing here builds on them.

## Out of scope

The other four groups. Deleting `controllers/`, `presenters/`, `commands/`, `output/` or the fixture machinery — all S2d. Reorganising `types/` — S2d. The `v8/` directory name. Narrowing `Presentations.json` from `unknown` to the command's result type.

## Acceptance

- [ ] The six bucket handlers contain argument parsing and presentation, and no API calls, no resolution logic and no error mapping of their own.
- [ ] No file under `src/v8/bucket/**` imports from `src/shell/`, `src/controllers/`, `src/presenters/` or `src/lib/`.
- [ ] Each port is declared where its use case lives and implemented under `adapters/`; no port signature mentions an engine or shell type.
- [ ] `tests/v8-bucket.test.ts` and the golden-rendering entry pass **unmodified**.
- [ ] The legacy shell's own tests pass unmodified.
- [ ] Root verification green, judged by each command's own exit code.
- [ ] A written answer to the reassessment question: what this cost, what resisted, and what it implies for the four remaining groups.
