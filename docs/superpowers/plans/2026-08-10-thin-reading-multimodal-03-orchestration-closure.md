# Thin Reading Multimodal Phase 3 Orchestration Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing authenticated, durable, evidence-authoritative visualization request path from the thin-reading desktop controller through Liteasy API governance and publication.

**Architecture:** A subject-bound account API persists requests and returns immediately. A leased API worker reloads the current saved thin-reading artifact, derives trusted evidence and intent, reserves each output independently, invokes an allowlisted structured provider adapter, compiles and validates the untrusted proposal, publishes atomically, and exposes only strict artifacts through polling. Desktop composition uses a typed client; confidential internal routes remain inaccessible to desktop identities.

**Tech Stack:** Node.js 20, PostgreSQL 16, Node test runner, JSON Schema 2020-12, Ajv 8, React 18, TypeScript 5.8, Zod 4, Vitest, Playwright.

## Global Constraints

- Preserve `layout -> controllers -> features -> shared types / clients`; feature code must not import layout or `AppShell`.
- Derive `subjectId` only from a verified `liteasy-desktop` token; never accept it in public request bodies.
- Desktop sends only artifact/node/request identity and requested count. Server reloads artifact revision, accepted intent, evidence, sources, request origin, and capability.
- `/v1/internal/visualization/generate` and `/submit` remain confidential-service routes.
- One automatic request produces at most one artifact; one explicit request produces at most two.
- Every output owns a distinct reservation, invocation, validation, publication, and settlement.
- Unknown fields, stale revisions, unknown adapters/compilers, unbound evidence, revoked source access, and late cancelled results fail closed.
- No generated modality enters account capability until server compiler plus desktop Skill, Kernel, Validator, Renderer, accessibility projection, fixture, and gate all exist.
- Preserve current uncommitted thin-reading/association/export changes and stage only task-owned files.

---

### Task 1: Canonical Artifact Schema And Strict API Validation

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationArtifact.schema.ts`
- Create: `products/liteasy/apps/desktop/scripts/write-visualization-artifact-schema.ts`
- Create: `products/liteasy/packages/shared/visualizationArtifact.v1.schema.json`
- Modify: `products/liteasy/apps/desktop/package.json`
- Modify: `products/liteasy/services/api/package.json`
- Modify: `products/liteasy/services/api/package-lock.json`
- Modify: `products/liteasy/services/api/src/visualizationArtifactValidator.mjs`
- Test: `products/liteasy/apps/desktop/src/tests/visualizationArtifactSchema.test.ts`
- Test: `products/liteasy/services/api/src/visualizationArtifactValidator.test.mjs`
- Create: `products/liteasy/services/api/src/visualizationArtifactSchemaConformance.test.mjs`

**Interfaces:**
- Consumes: existing Zod `VisualizationArtifactV1` rules and fixtures.
- Produces: `visualizationArtifactSchema`, committed JSON Schema, `validateVisualizationArtifact()` with structural and cross-field hard gates.

- [x] **Step 1: Add failing cross-runtime conformance cases**

Add API cases that currently pass the shallow envelope but must fail:

```js
test("rejects a structurally invalid artifact before publication", async () => {
  const result = await validateVisualizationArtifact({
    artifact: { ...validArtifact, spec: { modality: "semantic_graph", payload: { nodes: "not-an-array" } } },
    modality: "semantic_graph",
    phase: "publication"
  });
  assert.equal(result.outcome, "fail");
  assert.equal(result.reasonCode, "artifact_schema_invalid");
});

test("rejects modality and hard-gate inconsistencies", async () => {
  const result = await validateVisualizationArtifact({
    artifact: { ...validArtifact, modality: "circuit" },
    modality: "circuit",
    phase: "publication"
  });
  assert.equal(result.outcome, "fail");
});
```

Run:

```bash
cd products/liteasy/services/api
node --test src/visualizationArtifactValidator.test.mjs src/visualizationArtifactSchemaConformance.test.mjs
```

Expected: FAIL because schema conformance test/module and strict validation do not exist.

- [x] **Step 2: Export the desktop schema and generate shared JSON**

Export `visualizationArtifactSchema` instead of keeping `artifactSchema` private. The TypeScript generator runs through the already-installed `vite-node`, imports `z` and the schema, and calls:

```js
const schema = z.toJSONSchema(visualizationArtifactSchema, {
  target: "draft-2020-12",
  unrepresentable: "any"
});
```

It writes stable two-space JSON with `$id: "liteasy.visualization/v1"` to the shared path. Add `"schema:visualization": "vite-node scripts/write-visualization-artifact-schema.ts"` to desktop scripts and run it before `tsc` in `build`, so schema drift fails before bundling.

- [x] **Step 3: Implement strict API validation**

Add `ajv` version `^8.17.1`. Import `Ajv2020` from `ajv/dist/2020.js` and compile the shared schema once at module load with `new Ajv2020({ allErrors: false, strict: true })`. After structural validation, enforce rules not representable by JSON Schema refinements:

```js
if (artifact.modality !== input.modality || artifact.spec?.modality !== artifact.modality) {
  return fail("artifact_modality_invalid");
}
if (artifact.validation?.outcome === "fail" ||
    !artifact.validation?.checks?.some((check) => check.gate === "hard") ||
    artifact.validation.checks.some((check) => check.gate === "hard" && check.outcome !== "pass")) {
  return fail("artifact_hard_gate_invalid");
}
```

Retain provider-result validation as a separate bounded contract; never treat provider text as a published artifact.

- [x] **Step 4: Add byte-level schema conformance**

The desktop test regenerates JSON in memory and equals the committed file. API tests load the same file and accept the checked-in valid fixture while rejecting all malicious variants. Run:

```bash
cd products/liteasy/apps/desktop
npm test -- src/tests/visualizationArtifactSchema.test.ts
npm run schema:visualization
cd ../../../services/api
node --test src/visualizationArtifactValidator.test.mjs src/visualizationArtifactSchemaConformance.test.mjs
```

Expected: PASS; `git diff --check` is clean and a second schema generation produces no diff.

- [x] **Step 5: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/features/visualization/visualizationArtifact.schema.ts products/liteasy/apps/desktop/scripts/write-visualization-artifact-schema.ts products/liteasy/apps/desktop/package.json products/liteasy/apps/desktop/src/tests/visualizationArtifactSchema.test.ts products/liteasy/packages/shared/visualizationArtifact.v1.schema.json products/liteasy/services/api/package.json products/liteasy/services/api/package-lock.json products/liteasy/services/api/src/visualizationArtifactValidator.mjs products/liteasy/services/api/src/visualizationArtifactValidator.test.mjs products/liteasy/services/api/src/visualizationArtifactSchemaConformance.test.mjs
git commit -m "feat: share strict visualization artifact schema"
```

### Task 2: Durable Generation Request State Machine

**Files:**
- Create: `products/liteasy/services/api/migrations/023_visualization_generation_requests.sql`
- Create: `products/liteasy/services/api/src/visualizationGenerationRepository.mjs`
- Create: `products/liteasy/services/api/src/visualizationGenerationRepository.test.mjs`
- Modify: `products/liteasy/services/api/src/migrations.test.mjs`
- Modify: `products/liteasy/services/api/src/visualizationMigration.test.mjs`
- Modify: `products/liteasy/services/api/scripts/verify-postgres-integration.mjs`
- Modify: `products/liteasy/services/api/src/accountLifecycleRepository.mjs`
- Test: `products/liteasy/services/api/src/accountLifecycleService.test.mjs`

**Interfaces:**
- Produces: `PostgresVisualizationGenerationRepository.create()`, `get()`, `claimNext()`, `requestCancel()`, `markSucceeded()`, `markTerminal()`, `requeueExpired()`.
- States: `queued | running | cancel_requested | succeeded | cancelled | omitted | failed`.

- [x] **Step 1: Write failing state and replay tests**

```js
test("creates and replays one subject-bound request", async () => {
  const first = await repository.create("user-1", requestInput);
  const replay = await repository.create("user-1", requestInput);
  assert.deepEqual(replay, first);
  await assert.rejects(
    () => repository.create("user-1", { ...requestInput, nodeId: "other" }),
    /visualization_request_id_reused/
  );
});

test("a cancellation wins before a late success", async () => {
  await repository.requestCancel("user-1", "request-1", "cancel-key-0001");
  await assert.rejects(
    () => repository.markSucceeded("user-1", "request-1", ["artifact-1"]),
    /visualization_request_cancelled/
  );
});
```

Run and confirm missing module failure.

- [x] **Step 2: Add migration 023**

Create `visualization_generation_requests` with `(subject_id, request_id)` primary key; artifact ID/revision, node ID, 64-character request/intent hashes, requested count `1..2`, state check, cancellation idempotency key/hash and timestamp, terminal reason, JSON result artifact ID array, lease owner/expiry, attempts `0..3`, trace ID, and timestamps. Add a partial claim index on `(state, lease_expires_at, created_at)` for `queued/running/cancel_requested`.

Create `visualization_artifact_sources` keyed by `(subject_id, artifact_id, document_id)` with source identity hash and `is_primary`; require exactly one primary in repository logic while allowing multiple authorized evidence documents.

Advance the PostgreSQL integration script's exact immutable migration list and final count from `022`/`22` to `023`/`23`; the Phase 3 final gate must still begin from a reset schema and apply every migration.

- [x] **Step 3: Implement locked transitions**

Every mutation uses `withPostgresTransaction()` and `SELECT ... FOR UPDATE`. `create()` stores a canonical request hash and replays only an exact match. `requestCancel()` stores the cancellation hash, returns the same projection for an exact replay, and rejects reuse of the same key with different cancellation data. `claimNext()` uses `FOR UPDATE SKIP LOCKED`, sets a 30-second lease, increments attempts, and never claims `cancel_requested`. Terminal methods reject terminal-state changes. `requeueExpired()` changes only expired `running` rows with no terminal provider invocation; expired rows with a terminal invocation are atomically marked `failed/provider_result_recovery_required`, preventing a duplicate provider call.

Public projection is exactly:

```js
{
  resultArtifactIds: row.state === "succeeded" ? row.result_artifact_ids : [],
  reasonCode: row.terminal_reason ?? undefined,
  requestId: row.request_id,
  retryAfterMs: ["queued", "running", "cancel_requested"].includes(row.state) ? 500 : undefined,
  status: row.state
}
```

- [x] **Step 4: Extend account deletion**

Delete generation requests and mutable artifact-source rows before deleting visualization artifacts. Preserve append-only usage, provider-cost, and audit ledgers under the existing retention policy. Add `deletedVisualizationGenerationRequests` and `deletedVisualizationArtifactSources` to the account lifecycle result and assert their exact counts in repository/service tests.

- [x] **Step 5: Verify and commit**

```bash
cd products/liteasy/services/api
node --test src/migrations.test.mjs src/visualizationMigration.test.mjs src/visualizationGenerationRepository.test.mjs src/accountLifecycleService.test.mjs
git add migrations/023_visualization_generation_requests.sql scripts/verify-postgres-integration.mjs src/visualizationGenerationRepository.mjs src/visualizationGenerationRepository.test.mjs src/migrations.test.mjs src/visualizationMigration.test.mjs src/accountLifecycleRepository.mjs src/accountLifecycleService.test.mjs
git commit -m "feat: persist visualization generation requests"
```

### Task 3: Authoritative Thin-Reading Source Resolution

**Files:**
- Modify: `products/liteasy/services/api/src/agentArtifactRepository.mjs`
- Test: `products/liteasy/services/api/src/agentArtifactRepository.test.mjs`
- Create: `products/liteasy/services/api/src/thinReadingVisualizationSource.mjs`
- Create: `products/liteasy/services/api/src/thinReadingVisualizationSource.test.mjs`
- Modify: `products/liteasy/services/api/src/visualizationRepository.mjs`
- Modify: `products/liteasy/services/api/src/visualizationService.mjs`
- Test: `products/liteasy/services/api/src/visualizationRepository.test.mjs`
- Test: `products/liteasy/services/api/src/visualizationService.test.mjs`

**Interfaces:**
- Produces: `PostgresAgentArtifactRepository.get(subjectId, artifactId)` and `resolveThinReadingVisualizationSource({ artifactId, nodeId, subjectId })`.
- Source result: `{ artifactRevision, documents, evidence, intent, intentHash, locale, nodeId }`.

- [x] **Step 1: Write failing subject/revision/evidence tests**

Cover: cross-subject artifact lookup returns not found; v1 document rejected; missing/omitted intent rejected; requested node mismatch rejected; intent evidence absent from node spans/external sources rejected; expired external grant rejected; source hash mismatch rejected; stale artifact revision detected before publication.

Run:

```bash
node --test src/agentArtifactRepository.test.mjs src/thinReadingVisualizationSource.test.mjs
```

Expected: FAIL because `get()` and resolver do not exist.

- [x] **Step 2: Add strict artifact lookup**

`get()` executes:

```sql
SELECT body, revision FROM agent_artifacts
 WHERE subject_id = $1 AND artifact_id = $2
```

It returns `{ artifact: artifact(row.body), revision: Number(row.revision) }` or throws `agent_artifact_not_found` with status 404.

- [x] **Step 3: Resolve bounded authoritative evidence**

Require `artifactType === "thin_reading"`, document version `liteasy.thin-reading/v2`, exact artifact/node IDs, accepted intent, `1..256` evidence IDs, and requested count compatible with `intent.requestedBy`.

Paper evidence comes only from `paperEvidenceSpans` entries whose IDs are requested. Resolve each `paperId` to an accessible `library_entries` row and current `storage_object_references.content_hash`. External full-text evidence requires a matching unexpired `external_retrieval_pdf_grants` row for subject/grant/source; metadata evidence requires a current subject-owned `external_retrieval_cache` record. Return only ID, quote/abstract, page, paper/source ID, and source identity hash; cap total UTF-8 evidence bytes at 128 KiB.

Compute `intentHash` from canonical JSON containing artifact revision, node ID, normalized intent, evidence IDs and source identity hashes.

- [x] **Step 4: Publish multiple authorized sources atomically**

Change `VisualizationService.submit()` to accept `documents: [{ documentId, sourceIdentityHash, isPrimary }]`. Authorize every unique document before repository publication. `publish()` locks/rechecks all sources, writes the primary `document_id` to the existing artifact row, inserts all rows into `visualization_artifact_sources`, and only then settles the reservation. Retain read-only compatibility for internal callers that still supply one `document` by normalizing it to a one-element array.

- [x] **Step 5: Verify and commit**

```bash
node --test src/agentArtifactRepository.test.mjs src/thinReadingVisualizationSource.test.mjs src/visualizationRepository.test.mjs src/visualizationService.test.mjs
git add src/agentArtifactRepository.mjs src/agentArtifactRepository.test.mjs src/thinReadingVisualizationSource.mjs src/thinReadingVisualizationSource.test.mjs src/visualizationRepository.mjs src/visualizationRepository.test.mjs src/visualizationService.mjs src/visualizationService.test.mjs
git commit -m "feat: resolve authoritative visualization evidence"
```

### Task 4: Structured Provider Adapter And Artifact Compiler Boundary

**Files:**
- Create: `products/liteasy/packages/shared/visualizationBuiltins.v1.json`
- Create: `products/liteasy/services/api/src/visualizationStructuredProviderAdapter.mjs`
- Test: `products/liteasy/services/api/src/visualizationStructuredProviderAdapter.test.mjs`
- Create: `products/liteasy/services/api/src/visualizationArtifactCompiler.mjs`
- Test: `products/liteasy/services/api/src/visualizationArtifactCompiler.test.mjs`
- Modify: `products/liteasy/services/api/src/runtime.mjs`
- Test: `products/liteasy/services/api/src/runtime.test.mjs`
- Modify: `products/liteasy/apps/desktop/src/app/features/skills/builtinSkillRegistry.ts`
- Test: `products/liteasy/apps/desktop/src/tests/builtinSkillRegistry.test.ts`

**Interfaces:**
- Produces: `openAiCompatibleVisualizationAdapter`, `VisualizationArtifactCompilerRegistry`, and shared availability metadata.
- Compiler signature: `compile({ evidence, locale, modality, nodeId, proposal, reservation, source }) -> VisualizationArtifactV1`.

- [x] **Step 1: Write failing adapter and compiler tests**

Adapter tests assert exact endpoint/model/schema body, use only gateway-supplied `request()`, reject non-2xx/invalid JSON/missing output text, and normalize provider request/cost metadata. Compiler tests reject unknown compiler, unknown proposal fields, unbound claim IDs, server-version overrides, missing hard validators, and mismatched node/modality.

- [x] **Step 2: Implement the allowlisted OpenAI-compatible adapter**

`generateStructured()` sends:

```js
await request(route.endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    input: payload.prompt,
    model: route.model,
    text: { format: { name: payload.schemaName, schema: payload.schema, strict: true, type: "json_schema" } }
  })
});
```

Parse `output_text` or Responses API `output[].content[].text` without logging response content. Emit a gateway `cost` only when the provider response includes an explicit finite nonnegative amount, a three-letter currency, a stable `response.id`, and nonnegative integer usage units; otherwise omit cost rather than fabricating a zero price. Tests cover both explicit-cost normalization and the standard usage-without-price case. `probe()` sends a content-free schema request and returns declared capabilities. Runtime registers only keys `openai` and `openai-compatible`; arbitrary provider IDs remain unavailable.

- [x] **Step 3: Implement the compiler registry**

The registry is constructor-injected and immutable after runtime startup. A compiler receives an untrusted proposal containing only modality spec, evidence bindings, semantic objects, interaction and accessibility. It validates proposal shape, rejects all claim/evidence IDs outside `source.evidence`, overwrites artifact/node/modality/implementation/usage/timestamps with server values, runs registered hard validators, computes hashes, and calls `validateVisualizationArtifact()` before returning.

The production catalog initially advertises only existing `source_figure` reading support and no generated modality. Tests inject a `semantic_graph` compiler/catalog entry through the same constructor; Plans 4-6 add production entries only with their complete chains.

- [x] **Step 4: Verify shared catalog consumption**

Desktop built-in registry reads the shared catalog and asserts every enabled desktop entry has its local manifest. API runtime asserts every generated server entry has a compiler. Neither consumer enables a modality from the union type alone.

- [x] **Step 5: Verify and commit**

```bash
cd products/liteasy/services/api
node --test src/visualizationStructuredProviderAdapter.test.mjs src/visualizationArtifactCompiler.test.mjs src/runtime.test.mjs
cd ../../apps/desktop
npm test -- src/tests/builtinSkillRegistry.test.ts
git add ../../packages/shared/visualizationBuiltins.v1.json ../../services/api/src/visualizationStructuredProviderAdapter.mjs ../../services/api/src/visualizationStructuredProviderAdapter.test.mjs ../../services/api/src/visualizationArtifactCompiler.mjs ../../services/api/src/visualizationArtifactCompiler.test.mjs ../../services/api/src/runtime.mjs ../../services/api/src/runtime.test.mjs src/app/features/skills/builtinSkillRegistry.ts src/tests/builtinSkillRegistry.test.ts
git commit -m "feat: compile trusted visualization artifacts"
```

### Task 5: Leased Visualization Orchestrator

**Files:**
- Create: `products/liteasy/services/api/src/visualizationOrchestrationService.mjs`
- Create: `products/liteasy/services/api/src/visualizationOrchestrationService.test.mjs`
- Create: `products/liteasy/services/api/src/visualizationOrchestrationWorker.mjs`
- Create: `products/liteasy/services/api/src/visualizationOrchestrationWorker.test.mjs`
- Modify: `products/liteasy/services/api/src/runtime.mjs`
- Test: `products/liteasy/services/api/src/runtime.test.mjs`

**Interfaces:**
- Produces: `start(subjectId, input, traceId)`, `status(subjectId, requestId)`, `cancel(subjectId, requestId, input, traceId)`, `drainOne()`, `recover()`.
- Consumes: generation repository, source resolver, account capability, `VisualizationService`, compiler registry.

- [x] **Step 1: Write failing orchestration lifecycle tests**

Cover exact replay, unauthorized/preference-off/quota/modality omission with zero provider calls, one vs two artifact limits, per-artifact reservation, compiler rejection rollback, cancellation before provider, cancellation during provider, cancellation after provider before publication, stale artifact revision, partial two-artifact failure, and expired-lease recovery without duplicate invocation.

- [x] **Step 2: Implement start/status/cancel**

Strict start input fields are `artifactId`, `nodeId`, `requestId`, `requestedArtifactCount`. Resolve source before queueing; derive `requestedBy` and ensure count equals `1` for automatic or `1..2` for explicit. Intersect intent candidates with account capability and compiler catalog. If empty, persist terminal `omitted/modality_unavailable`; otherwise create `queued` and schedule a non-blocking drain.

Cancellation updates the database first, then aborts the matching in-memory controller. Status reloads published artifact bodies by subject and stored result IDs and validates them strictly before returning. Persist only this public reason-code set: `capability_unauthorized`, `preference_disabled`, `modality_unavailable`, `quota_exhausted`, `stale_artifact`, `evidence_invalid`, `source_access_revoked`, `cancelled`, `provider_unavailable`, `validation_failed`, `partial_generation_failed`, `provider_result_recovery_required`, and `internal_failure`; map all private dependency errors at the orchestration boundary.

- [x] **Step 3: Implement one leased worker operation**

For each requested output:

```js
const generation = await visualizationService.generate(subjectId, {
  providerRequest: {
    dataClass: "paper",
    input: source.providerInput,
    operation: "structured_generation",
    payload: compilerRegistry.providerPayload(modality, source)
  },
  reservation: {
    idempotencyKey: `${requestId}:artifact:${index}`,
    modality,
    requestedBy: source.intent.requestedBy === "automatic" ? "automatic" : "explicit_user_request"
  }
}, { signal, traceId });
const artifact = await compilerRegistry.compile({
  modality,
  nodeId: source.nodeId,
  proposal: generation.result.text,
  reservation: generation.reservation,
  source
});
await visualizationService.submit(subjectId, {
  artifact,
  documents: source.documents,
  modality,
  reservationId: generation.reservation.reservationId,
  routeId: generation.reservation.routeId,
  routeRevision: generation.reservation.routeRevision
}, { signal, traceId });
```

Recheck request state and current source revision before every provider call and publication. On cancellation, roll back any unsubmitted reservation and never delete already committed artifacts. If output 1 succeeds and output 2 fails, return the first artifact with terminal `succeeded` plus `partial_generation_failed`; never fabricate the second.

- [x] **Step 4: Implement recovery and shutdown**

`recover()` calls the repository recovery transition: it requeues expired leases whose invocations have no terminal result, fails expired rows that already have a terminal invocation with `provider_result_recovery_required`, and then drains bounded work. Runtime exposes `close()` that aborts controllers and waits for active drains. A polling timer is optional only while queued work exists and is always unref'd/cleared in tests and shutdown.

- [x] **Step 5: Verify and commit**

```bash
node --test src/visualizationOrchestrationService.test.mjs src/visualizationOrchestrationWorker.test.mjs src/runtime.test.mjs
git add src/visualizationOrchestrationService.mjs src/visualizationOrchestrationService.test.mjs src/visualizationOrchestrationWorker.mjs src/visualizationOrchestrationWorker.test.mjs src/runtime.mjs src/runtime.test.mjs
git commit -m "feat: orchestrate durable visualization requests"
```

### Task 6: Authenticated Public Routes

**Files:**
- Modify: `products/liteasy/services/api/src/visualizationRoutes.mjs`
- Test: `products/liteasy/services/api/src/visualizationRoutes.test.mjs`
- Modify: `products/liteasy/services/api/src/server.test.mjs`

**Interfaces:**
- Produces: start, status, and cancel account routes from the approved closure design.
- Consumes: `runtime.visualizationOrchestrationService` and desktop identity verification.

- [x] **Step 1: Write failing authorization and contract tests**

Assert inactive/wrong-audience tokens fail, body `subjectId` and unknown fields fail, subject A cannot query/cancel subject B, start returns 202 for active and 200 for terminal replay, status returns strict artifacts only, cancel requires exact `{ idempotencyKey }`, and disconnect aborts only the route wait rather than bypassing durable cancellation.

- [x] **Step 2: Implement route parsing**

Handle:

```text
POST /v1/account/visualization/requests
GET  /v1/account/visualization/requests/:requestId
POST /v1/account/visualization/requests/:requestId/cancel
```

Use `desktopIdentity()` before reading request data. Limit start/cancel bodies to 16 KiB. Validate request/artifact/node identifiers and idempotency keys against the existing bounded identifier policy. Return only `VisualizationServiceError` public codes; other errors map to the generic server failure response.

- [x] **Step 3: Preserve internal service routes**

Keep `/v1/internal/visualization/generate|submit` and their confidential client/scope checks unchanged. Add a regression proving a desktop token cannot use them and a service token cannot impersonate an account request without a desktop subject.

- [x] **Step 4: Verify and commit**

```bash
node --test src/visualizationRoutes.test.mjs src/server.test.mjs
git add src/visualizationRoutes.mjs src/visualizationRoutes.test.mjs src/server.test.mjs
git commit -m "feat: expose account visualization requests"
```

### Task 7: Desktop Orchestration Client And Production Composition

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationOrchestrationClient.ts`
- Test: `products/liteasy/apps/desktop/src/tests/visualizationOrchestrationClient.test.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/visualization/visualizationPendingRequestStore.ts`
- Test: `products/liteasy/apps/desktop/src/tests/visualizationPendingRequestStore.test.ts`
- Modify: `products/liteasy/apps/desktop/src/app/controllers/useThinReadingVisualizationController.ts`
- Modify: `products/liteasy/apps/desktop/src/app/controllers/useArtifactWorkflowController.ts`
- Modify: `products/liteasy/apps/desktop/src/app/controllers/useCloudAccountController.ts`
- Modify: `products/liteasy/apps/desktop/src/app/layout/AppShell.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/useThinReadingVisualizationController.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/useArtifactWorkflowController.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/useCloudAccountController.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/AppShell.test.tsx`

**Interfaces:**
- Produces: `VisualizationOrchestrationClient.startAndWait(request)`, `.resumeAndWait(request, signal)`, `.pending()`, and `.cancel(input)` satisfying existing controller callbacks and reload recovery.
- Consumes: account endpoint, access-token provider, `AbortSignal`, strict artifact parser.

- [ ] **Step 1: Write failing client tests**

Cover authenticated start, 202 polling at server-provided `retryAfterMs` clamped to `250..2000`, terminal success parsing, stable omitted/failure mapping, abort during wait, best-effort cancel, 401 fail-closed, malformed artifacts, and no request after capability denial. Store tests cover endpoint/subject isolation, strict parsing, exact replay coordinates, terminal cleanup, and stale-entry expiry.

- [ ] **Step 2: Implement the client**

```ts
export type VisualizationOrchestrationClient = {
  cancel(input: {
    artifactId: string;
    nodeId: string;
    reason: ThinReadingVisualizationCancellationReason;
    requestId: string;
  }): Promise<void>;
  startAndWait(
    request: ThinReadingVisualizationGenerationRequest
  ): Promise<readonly VisualizationArtifactV1[]>;
  pending(): readonly PendingVisualizationRequest[];
  resumeAndWait(
    request: PendingVisualizationRequest,
    signal: AbortSignal
  ): Promise<readonly VisualizationArtifactV1[]>;
};
```

`PendingVisualizationRequest` contains only `artifactId`, `nodeId`, `requestId`, `requestedArtifactCount`, and `createdAt`; the store key is scoped by normalized endpoint plus authenticated subject and entries expire after 24 hours. Persist the pending coordinates before POST so a crash after acceptance cannot lose the request; clear them only after a terminal response or an explicit cancel response. Start body contains only artifact/node/request IDs and requested count. Candidate modalities, evidence IDs, purpose, and request origin remain local guards but are not transmitted as authority. Poll with the access token and same AbortSignal; parse terminal artifacts through `parseVisualizationArtifact()`.

The cancel URL uses only `requestId`; its body has exactly one `idempotencyKey` field whose value is `${requestId}:cancel:${reason}`. It uses a separate one-second timeout signal because local polling is aborted first. Omitted responses throw a typed public-code error. Map `capability_unauthorized` to `capability_unavailable`, `quota_exhausted` to `quota_unavailable`, `stale_artifact` or `cancelled` to `stale_request`, `evidence_invalid` or `validation_failed` to `result_invalid`, and `provider_unavailable` to `service_unavailable`; preserve `preference_disabled` and `modality_unavailable`, and map `internal_failure` to `generation_failed`. Provider/internal details never enter the UI.

- [ ] **Step 3: Compose through controllers**

Create the subject-scoped client in `useCloudAccountController` beside capability/preference clients and expose stable generation, cancellation, pending-list, and resume callbacks. `AppShell` passes them to `useArtifactWorkflowController`; it contains no workflow logic.

Refactor the thin-reading visualization controller so new and resumed requests share the same stale-intent, strict-parse, serialized-save, and late-result path. After the artifact catalog reaches `ready`, `useArtifactWorkflowController` performs one recovery pass per account scope: for each pending request it reloads the v2 document/node, revalidates accepted intent and capability, and resumes polling with the original request ID. Missing/stale nodes are cancelled and removed instead of starting a replacement request.

Expose a workflow disposal action and invoke it before logout or account replacement clears the session/capability, ensuring active and recovered requests receive best-effort remote cancellation. Keep optional injection only for unit tests; production composition always supplies the real client callbacks when an authenticated cloud session exists.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- src/tests/visualizationOrchestrationClient.test.ts src/tests/visualizationPendingRequestStore.test.ts src/tests/useArtifactWorkflowController.test.ts src/tests/useCloudAccountController.test.ts src/tests/AppShell.test.tsx src/tests/useThinReadingVisualizationController.test.ts
npm run build
git add src/app/features/visualization/visualizationOrchestrationClient.ts src/app/features/visualization/visualizationPendingRequestStore.ts src/app/controllers/useThinReadingVisualizationController.ts src/app/controllers/useArtifactWorkflowController.ts src/app/controllers/useCloudAccountController.ts src/app/layout/AppShell.tsx src/tests/visualizationOrchestrationClient.test.ts src/tests/visualizationPendingRequestStore.test.ts src/tests/useThinReadingVisualizationController.test.ts src/tests/useArtifactWorkflowController.test.ts src/tests/useCloudAccountController.test.ts src/tests/AppShell.test.tsx
git commit -m "feat: connect thin reading visualization requests"
```

### Task 8: PostgreSQL, Browser, Recovery, And Final Closure Gate

**Files:**
- Modify: `products/liteasy/services/api/src/visualizationPostgres.integration.test.mjs`
- Modify: `products/liteasy/apps/desktop/src/tests/browser/thinReading.browser.spec.ts`
- Create: `products/liteasy/apps/desktop/src/tests/fixtures/thinReadingVisualizationOrchestrationBrowserFixture.tsx`
- Modify: `.superpowers/sdd/2026-08-09-thin-reading-multimodal-03-reader-integration/progress.md`
- Modify: `docs/superpowers/plans/2026-08-09-thin-reading-multimodal-implementation-index.md`

**Interfaces:**
- Consumes: all Phase 3 closure tasks.
- Produces: real database, browser, build, and independent review evidence sufficient to remove the Phase 3 blocker.

- [ ] **Step 1: Add real PostgreSQL request-state coverage**

Extend the opt-in integration test to cover concurrent exact replay, subject isolation, `SKIP LOCKED` single claim, cancel-vs-success race, expired lease recovery, immutable terminal states, multi-source publication, and account deletion of mutable request/source rows. Run through `node deployment/local/verify-liteasy-postgres-integration.mjs` with zero skips.

- [ ] **Step 2: Add browser orchestration paths**

The browser fixture uses an HTTP route fixture at the public account API boundary, not a direct controller callback. Assert authorized start -> generating -> ready, unauthorized omission with zero POSTs, preference-off cancellation, explicit user cancel, logout cancellation, reload polling recovery, malformed terminal artifact rejection, and visuals/prose/source vertical ordering at desktop and mobile viewports.

- [ ] **Step 3: Run the full verification matrix**

```bash
node deployment/local/verify-liteasy-postgres-integration.mjs
cd products/liteasy/services/api && npm test
cd ../../apps/admin && npm test && npm run build
cd ../desktop && npm test && npm run build
PLAYWRIGHT_BASE_URL=http://127.0.0.1:1493 npx playwright test src/tests/browser/thinReading.browser.spec.ts
```

Expected: PostgreSQL integration has zero skips; all package tests/builds and browser tests PASS. Live provider smoke is explicitly not part of this phase.

- [ ] **Step 4: Request independent final review**

Use `superpowers:requesting-code-review` across the complete Phase 3 closure commit range. Review the closure design, public/internal trust boundaries, database races, evidence authority, provider egress, compiler hard gates, desktop cancellation, and tests. Fix every Critical/Important finding test-first and run one scoped re-review.

- [ ] **Step 5: Record closure without overstating release status**

Update the Phase 3 ledger with exact commands/results and the final review verdict. Mark Phase 3 complete in the implementation index, while keeping all generated modalities unavailable until Plans 4-6 satisfy their release gates and keeping real provider smoke assigned to Phase 6.

- [ ] **Step 6: Commit**

```bash
git add products/liteasy/services/api/src/visualizationPostgres.integration.test.mjs products/liteasy/apps/desktop/src/tests/browser/thinReading.browser.spec.ts products/liteasy/apps/desktop/src/tests/fixtures/thinReadingVisualizationOrchestrationBrowserFixture.tsx .superpowers/sdd/2026-08-09-thin-reading-multimodal-03-reader-integration/progress.md docs/superpowers/plans/2026-08-09-thin-reading-multimodal-implementation-index.md
git commit -m "test: close thin reading visualization orchestration"
```
