# S2b2 dispatch plan — domain extraction

Contract: `../specs/s2b2-domain-extraction.md`. Branch `s2b2-domain-extraction` off `main` after S2b merges. Standing rules as in S2b's plan: explicit staging, the six-command verification before every commit judged by each command's own exit code, unpinned fact → STOP.

One difference from S2b worth stating up front: **the tests are the specification here.** S2b's implementer worked from design documents because the behaviour was being created. Here the behaviour exists and 1,007 tests assert it, so the instruction to every dispatch is that no test may be edited to accommodate a move. A test that needs changing means the move changed behaviour, which is a defect.

### D1 — the error base
R-X-1 alone. `CliError` and `usageError` to `src/errors.ts`, `shell/errors.ts` re-exporting, every `src/v8/**` import repointed. Smallest possible change, landed first, because it is what blocks S2d from deleting the shell and it touches the most files.

### D2 — providers
R-X-3. Four provider modules to `src/api/<area>/`. A move and an import repoint across both trees; no bodies change. Verifiable by the diff being imports and paths only.

### D3 — domain rules
R-X-2 and R-X-8. The twelve symbols to `src/domain/<area>/`, taking plain arguments rather than a shell `CommandContext`. This is where the legacy-context adapter and its proxy die, and it is the only dispatch that changes a function signature — so it is the one where the legacy shell's tests are the real check, since the shell calls the same functions.

### D4 — presentation
R-X-4. The eight serializers and five formatters reimplemented in `src/v8/<group>/presentation.ts`, v8's imports of `presenters/` dropped. The json envelope tests are the proof: they assert the result shape key for key and must pass untouched.

### D5 — closure
The boundary test that makes the first acceptance box enforceable rather than aspirational: nothing under `src/v8/**` imports from `shell/`, `controllers/` or `presenters/`. Review loop, PR.

Completeness: D1→error base; D2→providers; D3→domain rules and the adapter; D4→presentation; D5→the boundary test and closure. Every contract acceptance box maps to exactly one dispatch.

Ordering is deliberate: D1 and D2 are pure moves and prove the machinery, D3 is the only signature change and lands with the shell's tests as its check, D4 is additive to v8 and subtractive from its imports, and D5 makes the whole thing impossible to regress.
