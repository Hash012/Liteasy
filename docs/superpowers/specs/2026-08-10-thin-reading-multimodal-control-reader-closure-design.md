# Thin Reading Multimodal Phase 2/3 Closure Design

**Status:** Approved for implementation on 2026-08-10

**Scope:** Close the remaining control-plane verification gap and add the missing authenticated orchestration boundary between the thin-reading desktop controller and the visualization service. This design refines, but does not replace, `2026-08-08-thin-reading-multimodal-visualization-design.md`.

## 1. Completion Boundary

Phase 2 is complete only when migrations `020` through `022` and the quota, publication, cancellation, and provider-cost transactions pass against real PostgreSQL, all package tests/builds pass, and an independent final review has no open Critical or Important finding.

Phase 3 is complete only when an authenticated desktop user can start, observe, cancel, and recover a visualization request through a public account API without receiving service credentials or supplying authoritative document/evidence data. A request may still be omitted because no later-phase modality is registered. Real provider smoke remains a Phase 6 release gate.

## 2. Decisions

- Liteasy API owns user-facing visualization orchestration because it already owns identity verification, entitlements, quota reservations, provider routes, publication, and `agent_artifacts`.
- Existing `/v1/internal/visualization/generate` and `/submit` routes remain confidential service routes. The desktop never calls them.
- The desktop sends only `artifactId`, `nodeId`, `requestId`, and requested artifact count. The server loads the current artifact and derives the accepted intent, evidence, paper identity, request origin, and allowed modalities.
- Generation is an asynchronous persisted request. Start returns quickly; polling and cancellation use the same subject-bound request record.
- One request may produce at most one automatic artifact or two explicitly requested artifacts. Every artifact receives its own reservation, provider invocation, validation, publication, and settlement.
- Unknown provider adapters, unregistered modality compilers, stale artifact revisions, missing evidence, revoked access, and cancellation all fail closed.

## 3. Phase 2 Closure

Add a PostgreSQL integration harness that applies the immutable migration set to an isolated database and exercises the real repository rather than SQL-string mocks. It must cover:

- migration ordering and constraints for `020`, `021`, and `022`;
- concurrent reservation limits and daily/monthly windows in the policy timezone;
- equal-unit settlement, rollback, expiry, and idempotent replay;
- route/cost-policy revision pinning;
- atomic artifact publication plus settlement;
- provider invocation and provider-cost reconciliation, including late cancellation;
- transaction rollback on provider-request collisions and stale governance revisions.

The harness must use an explicit test database URL, create a unique schema/database namespace, and remove only that namespace. Absence of PostgreSQL is an explicit skipped integration gate, never a passing production-readiness claim.

After the integration run, perform one independent review of Plan 2 plus its follow-up. Any Critical or Important finding is fixed test-first before the ledger is marked complete.

## 4. Public Account API

All routes require a valid `liteasy-desktop` access token and derive `subjectId` exclusively from it.

### Start

`POST /v1/account/visualization/requests`

Request:

```json
{
  "artifactId": "artifact-1",
  "nodeId": "node-1",
  "requestId": "client-generated-idempotency-key",
  "requestedArtifactCount": 1
}
```

Response: `202` with `{ requestId, status, retryAfterMs }`, or `200` with the existing subject-bound terminal result on replay. Unknown fields are rejected.

### Status

`GET /v1/account/visualization/requests/:requestId`

Returns a bounded projection containing status, a stable omission/failure code, and at most two strictly validated published `VisualizationArtifactV1` objects on success. It never returns provider prompts, raw provider output, credentials, cost details, or another subject's request.

### Cancel

`POST /v1/account/visualization/requests/:requestId/cancel`

The body is exactly `{ "idempotencyKey": "cancel-idempotency-key" }`. It atomically records cancellation intent, aborts an in-process call when present, and guarantees that a late result cannot publish. Replays return the same terminal cancellation result.

## 5. Persistence And State Machine

Add `visualization_generation_requests` with a subject-bound primary identity and these logical fields: request ID, artifact ID and revision, node ID, intent hash, requested count, state, cancellation timestamp, terminal reason, result artifact IDs, attempt/lease metadata, trace ID, and timestamps.

Allowed transitions are:

```text
queued -> running -> succeeded
queued -> cancelled
running -> cancel_requested -> cancelled
queued|running -> omitted|failed
running -> queued only through an expired worker lease
```

Terminal states are immutable. A worker claims requests with a bounded lease and rechecks cancellation, account capability, artifact revision, source access, route revision, and entitlement immediately before provider work and again before each publication.

Startup recovery requeues an expired `running` lease only when no provider invocation terminal record exists. Existing reservation and invocation idempotency keys prevent duplicate charging or provider calls.

## 6. Authoritative Input And Artifact Construction

The orchestration service loads the subject's current `agent_artifacts` row and requires a `liteasy.agent-artifact/v1` thin-reading artifact with a valid v2 document. It resolves the node and accepted `VisualizationIntentV1`, then verifies every intent evidence ID against that node's structured evidence. Paper evidence must resolve to a subject-authorized library document and current source hash; external evidence must resolve to persisted server-issued provenance or a still-valid subject-bound grant. Evidence without an authoritative source identity fails closed.

Provider input contains a bounded, instruction-delimited projection of only the selected evidence, intent, locale, and modality schema. It does not contain arbitrary client prompts, unrelated artifact content, secret references, or administrative configuration.

Provider output is an untrusted modality proposal. A registered server-side modality compiler:

1. parses the proposal against the modality schema;
2. binds every factual element to allowed evidence IDs;
3. supplies server-owned skill/kernel/renderer/validator versions;
4. constructs hashes and the `VisualizationArtifactV1` envelope;
5. runs the hard validator set before publication.

The canonical artifact JSON Schema and built-in modality catalog are versioned shared product data consumed by API and desktop conformance tests. A modality is not advertised unless both server compiler and desktop skill/kernel/validator/renderer chain are registered.

## 7. Provider Adapters

Runtime registers an allowlisted adapter registry instead of the current empty production map. Provider IDs select known adapter protocols; an arbitrary admin-entered provider ID cannot load code. Adapters receive only the normalized route, deployment-resolved secret, bounded request, timeout, and abort signal. The gateway continues to enforce HTTPS, DNS/peer pinning, redirects, response-size limits, circuit breaking, and provider-cost normalization.

Phase 3 requires the structured-generation adapter contract, fail-closed runtime registration, and at least one allowlisted production adapter compatible with the existing route endpoint/model/secret fields. Raster image adapters and real-provider release smoke remain Phase 6 work.

## 8. Desktop Integration

Add a visualization orchestration client beside `visualizationControlPlaneClient.ts`. It starts a request, polls with bounded backoff, and cancels with the same request ID. It parses every response strictly and forwards the existing `AbortSignal`.

`AppShell` supplies this client through `useArtifactWorkflowController`; the feature/controller dependency direction remains unchanged. The existing controller retains local stale-result guards and document save serialization. Server-published artifacts are parsed again by the desktop before being merged into the node.

Account logout, preference disable, node supersession, explicit cancel, and controller disposal all call the cancel route best-effort while immediately aborting local polling. Ready artifacts remain readable offline.

## 9. Error And Privacy Contract

Public responses use stable reason codes for unauthorized capability, preference disabled, modality unavailable, quota exhausted, stale artifact, evidence invalid, source access revoked, cancelled, provider unavailable, validation failed, and internal failure. Raw database/provider errors remain server-side.

Logs and audit events include request, reservation, invocation, route revision, artifact, subject, and trace identifiers, but exclude paper text, prompts, provider output, credentials, and secret references.

## 10. Verification And Release Gates

Required verification:

- PostgreSQL migration/repository integration tests for Phase 2;
- API route, authorization, state-machine, replay, cancellation, recovery, quota, and publication tests;
- shared-schema API/desktop conformance tests;
- desktop client and controller composition tests;
- Playwright start, ready, omitted, cancel, logout, and reload-recovery paths;
- API, admin, and desktop full tests; admin and desktop production builds;
- an independent final review with no open Critical or Important findings.

Tests may inject a deterministic provider adapter, but production code must use the same adapter, orchestration, validation, reservation, and publication boundaries. A mock-only path, direct internal-route call, or UI fixture is not release evidence.

## 11. Non-Goals

- Implementing the static, mathematical, process, or raster modality renderers from Plans 4-6.
- Claiming production readiness from repository tests or a local provider fixture.
- Exposing provider/model choices or development state in the reader UI.
- Creating demo accounts, mock business results, or a second public service boundary.
