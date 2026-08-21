# Brief: Management API — `app` → `service` endpoints (first step only)

For the control-plane repo (pdp-control-plane). Outcome of the CLI command review with product (2026-08-21): the CLI calls the resource a **service**, the API still calls it an **app**. This brief covers the first step only — add the new endpoints and mark the old ones deprecated. Go no further: no removals, no response-shape changes, no SDK or CLI cutover.

## Do

1. **Mount every `/v1/apps…` route a second time under `/v1/services…`**, served by the same handlers. Path parameters rename with the segment (`{appId}` → `{serviceId}`); everything else — request bodies, response bodies, auth, pagination, error codes — is byte-identical between the two paths. Known routes from the CLI's usage: `GET/POST /v1/apps`, `GET /v1/apps/{appId}`, `DELETE /v1/apps/{appId}`, `GET/POST /v1/apps/{appId}/domains`, and the deployment listing/creation routes nested under an app. Cover the full set in the router, not just these.
2. **Mark the `/v1/apps…` routes deprecated** in the OpenAPI document (`deprecated: true` on each operation, with a description pointing at the `/v1/services` twin) and emit a `Deprecation` response header on them. They keep working unchanged.
3. **Publish the OpenAPI change** so the generated SDK types gain the new paths. Do not remove or rename any existing type, and do not rename response fields (`appEndpointDomain`, `appId` in bodies, etc.) — field renames are a later step with their own compatibility plan.
4. Integration tests: one per new route proving the twin returns the same result as the old path for the same input, plus one proving the deprecation header is present on the old path and absent on the new.

## Do not

- Remove, redirect, or change behaviour of any `/v1/apps` route.
- Rename fields inside request or response bodies.
- Touch the CLI or the compute SDK's call sites; the CLI keeps using `/v1/apps` until a separate change moves it.
- Rename internal types, tables, or services — this is the public path surface only.

## Acceptance

- Every `/v1/apps…` operation has a `/v1/services…` twin with identical semantics, covered by a test.
- The old operations are marked deprecated in OpenAPI and answer with a `Deprecation` header.
- The regenerated SDK types include the new paths and still include the old ones.
