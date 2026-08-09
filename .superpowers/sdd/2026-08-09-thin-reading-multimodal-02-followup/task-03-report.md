# Task 3 Report

Status: complete

- Provider generation uses the durable invocation returned by repository start for gateway requests and every provider-cost ledger row; provider request IDs are reconciled from validated provider cost metadata rather than being substituted with the local idempotency key.
- Invocation completion atomically stores response metadata and the provider request ID while it is still started; replays return the completed row without replacing its state or accounting data.
- Provider errors retain validated cost metadata with the durable invocation ID. Adapter response limits are accepted only when positive and can only lower the operation hard cap.
- Regression coverage verifies success and cancellation accounting with a `{ subjectId: "user-1" }` fixture, completion replay, error-cost normalization, and existing content-length/stream response caps.

Verification:

- `node --test src/visualizationProviderGateway.test.mjs src/visualizationService.test.mjs src/visualizationRepository.test.mjs`
- `npm test` (249 passed, 0 failed)
- `git diff --check`

Concerns: the existing migration requires a non-null `provider_request_id`, so an invocation starts with its durable ID as the temporary database value and replaces it with the provider's distinct request ID when validated provider metadata arrives. No temporary dependency links were present.

## Fix Round 1

- `startProviderInvocation()` now marks conflict rows as replays. Generation short-circuits with a stable `visualization_invocation_replayed` conflict before gateway I/O, so a completed, failed, or cancelled invocation cannot trigger a second provider call.
- `finalizeProviderInvocation()` updates the started invocation and appends its validated provider cost under one PostgreSQL transaction. A provider-request-ID uniqueness failure rolls back both operations; service accounting never falls back to a standalone cost write after that failure.
- The temporary start-time `provider_request_id` remains an internal schema compatibility value and is not surfaced as provider metadata; no migration was needed for this round.

Verification:

- Focused gateway, service, and repository tests passed.
- `npm test` in `products/liteasy/services/api` passed: 252 tests, 0 failures.
- `git diff --check` passed.

## Fix Round 2

- The service now checks caller cancellation immediately after receiving provider data and before any successful finalization. A provider result that races with cancellation is finalized once as `cancelled`, with its validated provider cost atomically linked to the durable invocation, before user reservation rollback.
- Added a race regression where the gateway aborts just before returning its cost-bearing result; it asserts one cancelled finalization, one durable cost row, no succeeded finalization, and one rollback.

Verification:

- `npm test` in `products/liteasy/services/api` passed: 253 tests, 0 failures.
