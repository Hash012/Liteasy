# Intuecho Literature Resolution Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authenticated Intuecho literature resolver, provenance-aware persistence, and idempotent desktop annotation create/update/retract API used by both products.

**Architecture:** Intuecho owns provider credentials and resolution policy. A focused resolver normalizes internal and external records, repositories persist confirmed records in independent SQLite/PostgreSQL stores, and routes expose resolve/confirm plus desktop publication operations. Existing annotation targets remain readable through a legacy adapter, but every newly confirmed record uses the canonical contract.

**Tech Stack:** Node.js 20+, Fastify 5, Zod 3, better-sqlite3, PostgreSQL 16/pg, Node test runner

## Global Constraints

- Do not share Liteasy and Intuecho database connections, credentials, or migration roles.
- Never upload PDF bytes or full text to Intuecho; resolver requests contain only bounded bibliographic hints.
- Runtime provider failures return honest availability states; no fixture or demo paper may be returned as business data.
- `manual` means the fallback form supplied the record; a DOI typed into search that a provider verifies remains `public_registry`.
- Title similarity alone may rank candidates but may not merge records or produce `exact`.
- Preserve old `inferred` and `metadata` rows without relabeling them as verified.
- Use immutable migrations; do not edit `001` through `010`.
- TypeScript/JavaScript uses two spaces, double quotes, semicolons where the local file uses them.

---

## File Map

- `products/intuecho/packages/contracts/src/index.js`: canonical schemas, legacy input adapter schemas, resolve/confirm inputs, and desktop publication operations.
- `products/intuecho/services/api/src/literatureIdentity.mjs`: identifier normalization, title/author/year fingerprinting, conflict detection, and record merge policy.
- `products/intuecho/services/api/src/literatureProviders.mjs`: bounded OpenAlex/Crossref/arXiv/Semantic Scholar transports and response projection.
- `products/intuecho/services/api/src/literatureResolver.mjs`: internal-first orchestration and `exact | ambiguous | not_found | unavailable` decisions.
- `products/intuecho/services/api/src/literatureRateLimiter.mjs`: bounded per-user resolve/confirm admission with an injectable clock.
- `products/intuecho/services/api/src/literatureRoutes.mjs`: authenticated resolve and confirm routes shared by Web and desktop audiences.
- `products/intuecho/services/api/migrations/011_literature_resolution_provenance.sql`: provenance, OpenAlex identity support, versions, and append-only protection.
- `products/intuecho/services/api/src/annotationCommunitySqlite.mjs`: development literature persistence and desktop publication operations.
- `products/intuecho/services/api/src/postgresAnnotationCommunityRepository.mjs`: production literature persistence and desktop publication operations.
- `products/intuecho/services/api/src/server.mjs`: development dependency construction and desktop audience routing.
- `products/intuecho/services/api/src/productionConfig.mjs`: server-owned provider configuration and validation.
- `products/intuecho/services/api/src/productionRuntime.mjs`: production resolver construction.
- `products/intuecho/services/api/src/productionApp.mjs`: route registration and stable error projection.

### Task 1: Canonical Literature Contracts

**Files:**
- Modify: `products/intuecho/packages/contracts/src/index.js`
- Create: `products/intuecho/packages/contracts/src/index.d.ts`
- Modify: `products/intuecho/packages/contracts/package.json`
- Create: `products/intuecho/services/api/src/literatureContracts.test.mjs`

**Interfaces:**
- Produces: `literatureIdentifierKindSchema`, `literatureSourceSchema`, `literatureIdentifierSchema`, `literatureCandidateSchema`, `manualLiteratureInputSchema`, `literatureRecordSchema`, `literatureResolveInputSchema`, `literatureConfirmInputSchema`, `desktopAnnotationPublicationBatchSchema`.
- Produces matching exported TypeScript types in `index.d.ts`; Intuecho Web imports these rather than redefining the canonical record.
- Produces `ConfirmedLiteratureReference = { literatureId: string }`; new `annotationTargetSchema` inputs use this reference and cannot submit replacement metadata.
- Compatibility: `annotationTargetSchema` continues to accept legacy `{ identity, metadata }` references during rollout; repositories normalize them without assigning `public_registry`.

- [ ] **Step 1: Write failing contract tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  literatureConfirmInputSchema,
  literatureRecordSchema,
  literatureResolveInputSchema
} from "@intuecho/contracts";

test("requires a stable manual identity or title-author-year", () => {
  const base = { authors: [], identifiers: [], title: "Unindexed Work" };
  assert.equal(literatureConfirmInputSchema.safeParse({ mode: "manual", record: base }).success, false);
  assert.equal(literatureConfirmInputSchema.safeParse({
    mode: "manual",
    record: { ...base, authors: ["Ada Lovelace"], year: 1843 }
  }).success, true);
});

test("accepts OpenAlex and preserves manual provenance", () => {
  const parsed = literatureRecordSchema.parse({
    authors: ["A. Author"],
    identifiers: [{ kind: "openalex_id", source: "manual", value: "W123" }],
    literatureId: "literature_1",
    provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "manual" },
    title: "A Paper"
  });
  assert.equal(parsed.identifiers[0].source, "manual");
});

test("bounds PDF hints without accepting PDF content", () => {
  assert.equal(literatureResolveInputSchema.safeParse({
    hints: { identifiers: [{ kind: "doi", value: "10.1000/test" }], title: "A Paper" },
    purpose: "liteasy_pdf_annotation",
    query: "10.1000/test"
  }).success, true);
  assert.equal(literatureResolveInputSchema.safeParse({ pdfBytes: "base64" }).success, false);
});
```

- [ ] **Step 2: Run the tests and verify missing exports fail**

Run: `cd products/intuecho && node --test services/api/src/literatureContracts.test.mjs`

Expected: FAIL because the new schemas are not exported.

- [ ] **Step 3: Add canonical and compatibility schemas**

```js
export const literatureIdentifierKindSchema = z.enum([
  "doi", "arxiv_id", "semantic_scholar_id", "openalex_id", "title_authors_year_hash"
]);
export const literatureSourceSchema = z.enum(["public_registry", "manual", "inferred"]);
export const literatureIdentifierSchema = z.object({
  kind: literatureIdentifierKindSchema,
  source: literatureSourceSchema,
  value: z.string().trim().min(1).max(1000)
});
export const literatureRecordSchema = z.object({
  authors: z.array(z.string().trim().min(1).max(300)).max(200),
  documentType: z.string().trim().min(1).max(100).optional(),
  identifiers: z.array(literatureIdentifierSchema).min(1).max(20),
  literatureId: z.string().trim().min(1).max(200),
  provenance: z.object({
    confirmedAt: z.string().datetime(),
    mode: z.enum(["public_registry", "manual"]),
    provider: z.enum(["intuecho", "openalex", "crossref", "arxiv", "semantic_scholar"]).optional()
  }),
  title: z.string().trim().min(1).max(1000),
  year: z.number().int().min(1000).max(9999).optional()
});
```

Add `literatureCandidateSchema` for unconfirmed display metadata plus a server-verifiable `candidateKey`. Add `manualLiteratureInputSchema` without `literatureId`, `confirmedAt`, or provider; its identifiers must have source `manual`, and it requires title plus either a DOI/arXiv/Semantic Scholar/OpenAlex identifier or at least one author and year. Confirmation generates the title-author-year fingerprint when the second rule is used.

Add `literatureResolveInputSchema` with required `purpose: "forum_compose" | "liteasy_pdf_annotation"`, optional candidate `limit` bounded to 1-10, optional `query`, and bounded `hints`; a `superRefine` requires at least a query or one usable hint. Add `literatureConfirmInputSchema` as this exact discriminated union:

```ts
type LiteratureConfirmInput =
  | { candidateKey: string; mode: "candidate" }
  | { mode: "manual"; record: ManualLiteratureInput };
```

Add `desktopAnnotationPublicationBatchSchema` with `upsert` and `retract` operations keyed by `queueKey`, `annotationId`, `revision`, and `updatedAt`. An upsert carries `literatureId`, body, and source-passage fields; it does not accept canonical literature metadata. A retract carries the existing remote annotation ID and no visibility claim.

Declare the same shapes in `index.d.ts` and add `"types": "./src/index.d.ts"` to the contracts package. Type declarations contain no second set of validation rules; Zod schemas remain runtime truth.

- [ ] **Step 4: Run the focused contracts test**

Run: `cd products/intuecho && node --test services/api/src/literatureContracts.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add products/intuecho/packages/contracts/src/index.js products/intuecho/packages/contracts/src/index.d.ts products/intuecho/packages/contracts/package.json products/intuecho/services/api/src/literatureContracts.test.mjs
git commit -m "feat: define literature resolution contracts"
```

### Task 2: Identity Normalization and Merge Policy

**Files:**
- Create: `products/intuecho/services/api/src/literatureIdentity.mjs`
- Create: `products/intuecho/services/api/src/literatureIdentity.test.mjs`

**Interfaces:**
- Produces: `normalizeLiteratureIdentifier(kind, value)`, `titleAuthorsYearFingerprint(input)`, `canonicalLiteratureKey(record)`, `mergeLiteratureRecords(records)`, `LiteratureIdentityConflictError`.
- Consumes: identifier kind strings from Task 1.

- [ ] **Step 1: Write failing normalization and conflict tests**

```js
test("normalizes DOI, arXiv, Semantic Scholar and OpenAlex identifiers", () => {
  assert.equal(normalizeLiteratureIdentifier("doi", "https://doi.org/10.1000/ABC."), "10.1000/abc");
  assert.equal(normalizeLiteratureIdentifier("arxiv_id", "arXiv:2401.01234v2"), "2401.01234");
  assert.equal(normalizeLiteratureIdentifier("semantic_scholar_id", "CorpusID: 123"), "corpus:123");
  assert.equal(normalizeLiteratureIdentifier("openalex_id", "https://openalex.org/W123"), "W123");
});

test("rejects records whose identifiers resolve to different literature ids", () => {
  assert.throws(() => mergeLiteratureRecords([
    fixture({ literatureId: "literature_a", identifiers: [doi("10.1000/a")] }),
    fixture({ literatureId: "literature_b", identifiers: [doi("10.1000/a")] })
  ]), LiteratureIdentityConflictError);
});
```

- [ ] **Step 2: Run the tests and verify the module is absent**

Run: `cd products/intuecho && node --test services/api/src/literatureIdentity.test.mjs`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement deterministic normalization**

```js
export function canonicalLiteratureKey(record) {
  for (const kind of ["doi", "arxiv_id", "semantic_scholar_id", "openalex_id", "title_authors_year_hash"]) {
    const identifier = record.identifiers.find((item) => item.kind === kind);
    if (identifier) return `${kind}:${normalizeLiteratureIdentifier(kind, identifier.value)}`;
  }
  throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_REQUIRED");
}

export function mergeLiteratureRecords(records) {
  const owners = new Map();
  for (const record of records) {
    for (const identifier of record.identifiers) {
      const key = `${identifier.kind}:${normalizeLiteratureIdentifier(identifier.kind, identifier.value)}`;
      const owner = owners.get(key);
      if (owner && owner !== record.literatureId) throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_CONFLICT");
      owners.set(key, record.literatureId);
    }
  }
  return Object.freeze(records.map((record) => Object.freeze(record)));
}
```

Implement fingerprinting from normalized title, normalized ordered authors, and year. Do not use title-only hashes. Keep provenance values unchanged during normalization.

- [ ] **Step 4: Run identity tests**

Run: `cd products/intuecho && node --test services/api/src/literatureIdentity.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit identity policy**

```bash
git add products/intuecho/services/api/src/literatureIdentity.mjs products/intuecho/services/api/src/literatureIdentity.test.mjs
git commit -m "feat: normalize literature identities"
```

### Task 3: Provenance-Aware Persistence

**Files:**
- Create: `products/intuecho/services/api/migrations/011_literature_resolution_provenance.sql`
- Modify: `products/intuecho/services/api/src/migrations.test.mjs`
- Modify: `products/intuecho/services/api/src/annotationCommunitySqlite.mjs`
- Modify: `products/intuecho/services/api/src/postgresAnnotationCommunityRepository.mjs`
- Modify: `products/intuecho/services/api/src/server.test.mjs`
- Modify: `products/intuecho/services/api/scripts/verify-postgres-integration.mjs`

**Interfaces:**
- Produces on both repositories: `findLiteratureById(literatureId)`, `findLiteratureByIdentifiers(identifiers)`, `searchStoredLiterature(query, limit)`, `confirmLiterature(owner, confirmation)`, `confirmRefetchedLiterature(owner, verifiedCandidate)`.
- Returns: canonical `LiteratureRecord` with stable `literatureId` and `provenance.confirmedAt`.
- Consumes: normalizers and conflict error from Task 2.

- [ ] **Step 1: Add failing migration and repository tests**

Run migration `011` against controlled databases and inspect the resulting schema rather than matching SQL source text. Assert the migrated schema contains `record_source`, `literature_record_versions`, OpenAlex/manual-compatible constraints, and an append-only versions trigger; exercise the trigger by attempting an update/delete and expecting rejection. Add API repository tests that confirm a manual record, read it back by DOI, reuse the same literature ID under concurrent confirmation, preserve the pre-correction manual version, and prove a conflicting DOI returns `LITERATURE_IDENTITY_CONFLICT` without changing either record.

```js
const confirmed = await repository.confirmLiterature(user, {
  mode: "manual",
  record: {
    authors: ["Ada Lovelace"],
    identifiers: [{ kind: "doi", source: "manual", value: "10.1000/manual" }],
    title: "Manual Record"
  }
});
assert.equal(confirmed.provenance.mode, "manual");
assert.equal((await repository.findLiteratureByIdentifiers(confirmed.identifiers)).literatureId, confirmed.literatureId);
```

- [ ] **Step 2: Run migration and server tests to verify failure**

Run: `cd products/intuecho && node --test services/api/src/migrations.test.mjs services/api/src/server.test.mjs`

Expected: FAIL because migration `011` and repository methods do not exist.

- [ ] **Step 3: Add immutable PostgreSQL migration and SQLite schema upgrade**

The PostgreSQL migration must:

```sql
ALTER TABLE literature_records
  ADD COLUMN record_source text NOT NULL DEFAULT 'legacy_metadata'
    CHECK (record_source IN ('legacy_metadata', 'public_registry', 'manual')),
  ADD COLUMN source_provider text,
  ADD COLUMN confirmed_at timestamptz,
  ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);

CREATE TABLE literature_record_versions (
  id text PRIMARY KEY,
  literature_id text NOT NULL REFERENCES literature_records(id) ON DELETE CASCADE,
  revision bigint NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  changed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(literature_id, revision)
);
```

Replace the identity kind/source check constraints so they include `openalex_id`, `public_registry`, and `manual` while retaining `inferred` and `metadata`. Add an append-only trigger for versions. Mirror fields and version rows in SQLite `*_v2` tables with guarded `ALTER TABLE` upgrades.

Implement repository confirmation in a transaction: lock all matching identities, reject matches to multiple literature IDs, snapshot before explicit correction, upsert missing identities, and never rewrite a manual source to `public_registry` without a candidate confirmation.

- [ ] **Step 4: Run migration, SQLite, and PostgreSQL integration tests**

Run: `cd products/intuecho && npm test`

Run: `cd products/intuecho/services/api && npm run test:postgres:integration`

Expected: both PASS; integration reports 11 migrations.

- [ ] **Step 5: Commit persistence**

```bash
git add products/intuecho/services/api/migrations/011_literature_resolution_provenance.sql products/intuecho/services/api/src/migrations.test.mjs products/intuecho/services/api/src/annotationCommunitySqlite.mjs products/intuecho/services/api/src/postgresAnnotationCommunityRepository.mjs products/intuecho/services/api/src/server.test.mjs products/intuecho/services/api/scripts/verify-postgres-integration.mjs
git commit -m "feat: persist literature provenance"
```

### Task 4: Provider Clients and Resolver Decisions

**Files:**
- Create: `products/intuecho/services/api/src/literatureProviders.mjs`
- Create: `products/intuecho/services/api/src/literatureProviders.test.mjs`
- Create: `products/intuecho/services/api/src/literatureResolver.mjs`
- Create: `products/intuecho/services/api/src/literatureResolver.test.mjs`

**Interfaces:**
- Produces: `createLiteratureProviders(config, { fetchImpl })`, `createLiteratureResolver({ providers, repository })`.
- Resolver methods: `resolve(owner, input)` and `confirm(owner, input)`.
- Repository confirmation boundary from Task 3: `confirmLiterature(owner, manualInput)` accepts manual input only; `confirmRefetchedLiterature(owner, verifiedCandidate)` is internal and accepts a provider record only after resolver re-fetch and exact candidate-key binding.
- Internal candidate confirmation uses `findLiteratureById(literatureId)` for `intuecho:<literatureId>` keys; it may not fall back to a title search.
- Resolve result: `{ status: "exact", candidate, unavailableProviders } | { status: "ambiguous", candidates, unavailableProviders } | { status: "not_found", candidates: [], unavailableProviders } | { status: "unavailable", retryable: true, unavailableProviders }`; provider names are the only availability detail exposed.

- [ ] **Step 1: Write failing provider and decision tests**

Use injected transports to prove exact DOI lookup, bounded title search, provider timeouts, internal-store precedence, deduplication across Crossref/OpenAlex, partial failure with a non-sensitive `unavailableProviders` list, and the difference between `not_found` and all-providers-failed. Assert title similarity alone never merges a preprint with a publication; associate versions only when a provider returns a verifiable relationship.

```js
const result = await resolver.resolve(user, {
  purpose: "forum_compose",
  query: "10.1000/shared"
});
assert.equal(result.status, "exact");
assert.deepEqual(result.candidate.record.identifiers.map((item) => item.kind).sort(), ["doi", "openalex_id"]);

const unavailable = await failingResolver.resolve(user, {
  purpose: "forum_compose",
  query: "unreachable"
});
assert.deepEqual(unavailable, {
  retryable: true,
  status: "unavailable",
  unavailableProviders: ["openalex", "crossref", "arxiv", "semantic_scholar"]
});
```

- [ ] **Step 2: Run focused tests and verify modules are absent**

Run: `cd products/intuecho && node --test services/api/src/literatureProviders.test.mjs services/api/src/literatureResolver.test.mjs`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement bounded transports and orchestration**

Provider projection must return only normalized bibliographic fields and HTTPS record URLs. Use a three-second abort timeout per provider, at most ten returned candidates, and injected `fetchImpl`.

```js
export function createLiteratureResolver({ providers, repository }) {
  return {
    async resolve(owner, input) {
      const stored = await repository.searchStoredLiterature(input.query ?? input.hints?.title ?? "", 10);
      const external = await Promise.allSettled(providers.map((provider) => provider.search(input)));
      const candidates = rankAndDeduplicate([...stored, ...fulfilled(external)]).slice(0, 10);
      const unavailableProviders = rejectedProviderNames(external);
      if (hasExactStableIdentifier(input, candidates)) return { candidate: candidates[0], status: "exact", unavailableProviders };
      if (candidates.length) return { candidates, status: "ambiguous", unavailableProviders };
      return external.every((result) => result.status === "rejected")
        ? { retryable: true, status: "unavailable", unavailableProviders }
        : { candidates: [], status: "not_found", unavailableProviders };
    },
    async confirm(owner, input) {
      if (input.mode === "manual") {
        return repository.confirmLiterature(owner, input);
      }
      const verified = await refetchCandidate(input.candidateKey, providers, repository);
      return repository.confirmRefetchedLiterature(owner, verified);
    }
  };
}
```

Candidate keys bind provider and canonical source ID. Confirmation re-fetches that exact external record; `intuecho:<literatureId>` candidates reload the repository row. Never trust a client-provided `public_registry` record and do not keep an unbounded candidate cache.

- [ ] **Step 4: Run provider and resolver tests**

Run: `cd products/intuecho && node --test services/api/src/literatureProviders.test.mjs services/api/src/literatureResolver.test.mjs`

Expected: PASS without network access.

- [ ] **Step 5: Commit resolver**

```bash
git add products/intuecho/services/api/src/literatureProviders.mjs products/intuecho/services/api/src/literatureProviders.test.mjs products/intuecho/services/api/src/literatureResolver.mjs products/intuecho/services/api/src/literatureResolver.test.mjs
git commit -m "feat: resolve public literature"
```

### Task 5: Authenticated Routes and Production Wiring

**Files:**
- Create: `products/intuecho/services/api/src/literatureRoutes.mjs`
- Create: `products/intuecho/services/api/src/literatureRateLimiter.mjs`
- Create: `products/intuecho/services/api/src/literatureRateLimiter.test.mjs`
- Modify: `products/intuecho/services/api/src/server.mjs`
- Modify: `products/intuecho/services/api/src/productionConfig.mjs`
- Modify: `products/intuecho/services/api/src/productionConfig.test.mjs`
- Modify: `products/intuecho/services/api/src/productionRuntime.mjs`
- Modify: `products/intuecho/services/api/src/productionApp.mjs`
- Modify: `products/intuecho/services/api/src/server.test.mjs`
- Modify: `products/intuecho/services/api/src/productionApp.test.mjs`
- Modify: `products/intuecho/services/api/.env.example`

**Interfaces:**
- Produces routes: `POST /v1/literature:resolve`, `POST /v1/literature:confirm`.
- Desktop and Web tokens use their existing audiences; both routes receive an authenticated user object.
- Consumes resolver from Task 4 and schemas from Task 1.
- Consumes `createLiteratureRateLimiter({ clock, limit: 30, windowMs: 60_000 })`; resolve and confirm use separate per-user buckets.

- [ ] **Step 1: Add failing route, audience, and config tests**

Test anonymous rejection, Web success, desktop success, invalid payload projection, provider-key redaction, 30 accepted calls followed by `LITERATURE_RATE_LIMITED`, window reset with an injected clock, and production config rules. Desktop classification must include both new paths.

```js
const response = await app.inject({
  headers: desktopHeader,
  method: "POST",
  payload: { purpose: "liteasy_pdf_annotation", query: "10.1000/reliable" },
  url: "/v1/literature:resolve"
});
assert.equal(response.statusCode, 200);
assert.equal(response.json().status, "exact");
```

- [ ] **Step 2: Run route and production tests to verify failure**

Run: `cd products/intuecho && node --test services/api/src/server.test.mjs services/api/src/productionApp.test.mjs services/api/src/productionConfig.test.mjs`

Expected: FAIL with route-not-found and missing configuration.

- [ ] **Step 3: Register routes and server-owned provider config**

`registerLiteratureRoutes` accepts `{ currentUser, rateLimiter, requireDesktopUser, requireUser, resolver }`, validates with Task 1 schemas, and selects the already-verified desktop or Web identity. The limiter removes expired buckets on access and never keys by display name. Add stable codes `INVALID_LITERATURE_QUERY`, `LITERATURE_IDENTITY_CONFLICT`, `LITERATURE_PROVIDER_UNAVAILABLE`, `LITERATURE_RATE_LIMITED`, and `INVALID_MANUAL_LITERATURE` to public error projection.

Construct providers with an explicitly injected server-side `fetchImpl`; `createLiteratureProviders` has no global-fetch fallback. Development and production wiring may use `globalThis.fetch` only at this server construction boundary, never from Web/Desktop clients or public configuration.

Production config exposes provider endpoints and optional keys only to the runtime object:

```js
literatureProviders: Object.freeze({
  arxivEndpoint: parseUrl(env.INTUECHO_ARXIV_ENDPOINT ?? "https://export.arxiv.org/api/query", "INTUECHO_ARXIV_ENDPOINT", environment),
  crossrefEndpoint: parseUrl(env.INTUECHO_CROSSREF_ENDPOINT ?? "https://api.crossref.org/works", "INTUECHO_CROSSREF_ENDPOINT", environment),
  openAlexApiKey: env.INTUECHO_OPENALEX_API_KEY?.trim() || null,
  openAlexEndpoint: parseUrl(env.INTUECHO_OPENALEX_ENDPOINT ?? "https://api.openalex.org/works", "INTUECHO_OPENALEX_ENDPOINT", environment),
  semanticScholarApiKey: env.INTUECHO_SEMANTIC_SCHOLAR_API_KEY?.trim() || null,
  semanticScholarEndpoint: parseUrl(env.INTUECHO_SEMANTIC_SCHOLAR_ENDPOINT ?? "https://api.semanticscholar.org/graph/v1/paper", "INTUECHO_SEMANTIC_SCHOLAR_ENDPOINT", environment)
})
```

Disable OpenAlex/Semantic Scholar providers when their required key is absent. Do not include keys in readiness or public Web config.

- [ ] **Step 4: Run route and production tests**

Run: `cd products/intuecho && node --test services/api/src/server.test.mjs services/api/src/productionApp.test.mjs services/api/src/productionConfig.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit API wiring**

```bash
git add products/intuecho/services/api/src/literatureRoutes.mjs products/intuecho/services/api/src/literatureRateLimiter.mjs products/intuecho/services/api/src/literatureRateLimiter.test.mjs products/intuecho/services/api/src/server.mjs products/intuecho/services/api/src/productionConfig.mjs products/intuecho/services/api/src/productionConfig.test.mjs products/intuecho/services/api/src/productionRuntime.mjs products/intuecho/services/api/src/productionApp.mjs products/intuecho/services/api/src/server.test.mjs products/intuecho/services/api/src/productionApp.test.mjs products/intuecho/services/api/.env.example
git commit -m "feat: expose literature resolution api"
```

### Task 6: Idempotent Desktop Publication Operations

**Files:**
- Modify: `products/intuecho/services/api/src/annotationCommunityRoutes.mjs`
- Modify: `products/intuecho/services/api/src/annotationCommunitySqlite.mjs`
- Modify: `products/intuecho/services/api/src/postgresAnnotationCommunityRepository.mjs`
- Modify: `products/intuecho/services/api/src/server.mjs`
- Modify: `products/intuecho/services/api/src/productionApp.mjs`
- Modify: `products/intuecho/services/api/src/server.test.mjs`
- Modify: `products/intuecho/services/api/src/productionApp.test.mjs`

**Interfaces:**
- Produces repository method: `applyDesktopAnnotationPublications(author, operations)`.
- `upsert` requires confirmed `literatureId`, source annotation revision, body, canonical source-passage fields, and queue key; it does not accept title, author, identifier-source, or provenance overrides.
- `retract` requires annotation ID, queue key, revision, and updated time.
- Result per operation: `{ annotationId, queueKey, remoteAnnotationId, remoteRevision, state: "published" | "retracted", syncedAt }` or a stable failure.

- [ ] **Step 1: Add failing create/update/retract and idempotency tests**

Cover initial create, same-key replay, newer revision update, stale revision rejection, retract, repeated retract, and cross-owner queue-key isolation.

```js
assert.equal(created.remoteAnnotationId, replayed.remoteAnnotationId);
assert.equal(updated.remoteRevision, created.remoteRevision + 1);
assert.equal(retracted.state, "retracted");
assert.equal((await repository.annotation(created.remoteAnnotationId, author)).visibility, "private");
```

- [ ] **Step 2: Run API tests and verify operation schema is not wired**

Run: `cd products/intuecho && node --test services/api/src/server.test.mjs services/api/src/productionApp.test.mjs`

Expected: FAIL because publication operations are not routed.

- [ ] **Step 3: Implement transactional operation application**

For `upsert`, load the confirmed literature record by ID, ignore client attempts to replace server metadata, create/update the same annotation, replace targets, and store owner/queue/source revision. For `retract`, change remote visibility to private and `share_to_plaza` to false while retaining the remote link. Guard stale writes using source revision and `updatedAt`.

Keep the existing `desktopCommunityAnnotationBatchSchema` route readable during rollout. Route new clients through `desktopAnnotationPublicationBatchSchema`; remove the compatibility route only in a future versioned API.

- [ ] **Step 4: Run full Intuecho verification**

Run: `cd products/intuecho && npm test`

Run: `cd products/intuecho && npm run build`

Run: `cd products/intuecho/services/api && npm run test:postgres:integration`

Expected: all PASS; no provider key appears in output or assets.

- [ ] **Step 5: Commit desktop publication support**

```bash
git add products/intuecho/services/api/src/annotationCommunityRoutes.mjs products/intuecho/services/api/src/annotationCommunitySqlite.mjs products/intuecho/services/api/src/postgresAnnotationCommunityRepository.mjs products/intuecho/services/api/src/server.mjs products/intuecho/services/api/src/productionApp.mjs products/intuecho/services/api/src/server.test.mjs products/intuecho/services/api/src/productionApp.test.mjs
git commit -m "feat: sync desktop annotation publication"
```

## Phase 1 Completion Gate

- `POST /v1/literature:resolve` distinguishes exact, ambiguous, not found, and unavailable.
- `POST /v1/literature:confirm` persists canonical records and manual provenance in both repositories.
- OpenAlex IDs and legacy source values coexist without false verification.
- Desktop upsert/update/retract is idempotent and never trusts client metadata over `literatureId`.
- `npm test`, `npm run build`, and PostgreSQL integration pass from `products/intuecho/`.
