# Plan 02 Final Review Fix Report

## Residual Findings Closed

- Recreated the `visualization_usage_ledger` event-type whitelist while allowing
  zero-delta settlements.
- Claimed provider probe idempotency before provider I/O; concurrent callers
  wait for the persisted replay and the audit result includes stored route
  identity and revision.
- Aligned desktop preference mutation parsing with the bare multimodal
  capability response.
- Versioned cost policies by provider, selected them only after locking the
  provider route, and pinned the selected revision on reservations and ledger
  events.
- Made an empty entitlement modality allowlist fail closed for reservations,
  cache reuse, and enabled entitlement writes.
- Limited adapter response overrides to lower an operation's hard response cap.
- Retained validated provider costs on normalized errors and consistently linked
  provider-cost records to the durable invocation identifier.

## RED/GREEN Evidence

RED: `node --test src/visualizationFinalReviewMigration.test.mjs` initially
failed because migration 021 removed the event-type whitelist. The desktop
preference contract test initially failed because the client required an
unrelated `developerDiagnostics` wrapper.

GREEN:

- `cd products/liteasy/services/api && npm test` (235 passing)
- `cd products/liteasy/apps/desktop && npm test` (passing; existing PDF/React
  warnings only)
- `cd products/liteasy/apps/desktop && npm run build` (passing)
- `cd products/liteasy/apps/admin && node node_modules/vitest/vitest.mjs run`
  (17 passing)
- `cd products/liteasy/apps/admin && node node_modules/typescript/bin/tsc -b &&
  node node_modules/vite/bin/vite.js build && node scripts/verify-production-assets.mjs`
  (passing)

`npm test` and `npm run build` in the admin package could not resolve their
local command shims because `.bin` links were absent after `npm ci`; the same
lockfile-installed executables were invoked directly above.
