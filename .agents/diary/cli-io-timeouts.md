[Out-of-scope decision] Excluded a global public `--timeout` flag from the first slice because request, inactivity, and total wait deadlines mean different things across commands. The spec keeps public configuration narrow until usage shows which budgets users need to tune.

[Out-of-scope decision] Excluded automatic retry policy changes because bounded waiting and retry behavior should be designed separately. Mixing them in this spec would obscure the core product contract: stalled I/O must fail clearly and predictably.

[Out-of-scope decision] Excluded broad local filesystem and credentials-store timeout policy from the first implementation plan. Those boundaries remain cancellation-aware, but the timeout work should focus on Prisma-controlled API, SDK, callback, polling, and stream boundaries to avoid false negatives and unnecessary complexity.
