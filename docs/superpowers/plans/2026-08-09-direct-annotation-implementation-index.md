# Direct Annotation and Literature Resolution Implementation Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the approved direct PDF annotation, literature resolution, and reply projection design through three independently reviewable phases.

**Architecture:** Intuecho first establishes the canonical literature and publication boundaries. Intuecho Web then adopts search-first composition and explicit reply projections. Liteasy finally persists paper-level literature and replaces forum handoff controls with direct publication against those stable APIs.

**Tech Stack:** React, TypeScript, Fluent UI, Node.js, Fastify, Zod, SQLite, PostgreSQL, Tauri/Rust, Vitest, Testing Library, Playwright

## Global Constraints

- Execute phases in order; later plans consume exact interfaces produced by earlier plans.
- Keep Liteasy and Intuecho data stores, credentials, migrations, and service roles independent.
- Preserve all unrelated user work in the current dirty worktree.
- Use test-driven steps and the focused commit listed at the end of each task.
- Do not claim public provider or production readiness from fixtures, unit tests, or local PostgreSQL.
- Do not upload PDF bytes/full text to Intuecho or expose provider keys in Web/Desktop assets.

---

## Plan Order

### Phase 1: Intuecho Literature Foundation

Plan: `docs/superpowers/plans/2026-08-09-direct-annotation-01-intuecho-literature-foundation.md`

Deliverables:

- canonical provenance-aware literature contracts;
- DOI/arXiv/Semantic Scholar/OpenAlex normalization and conflict policy;
- migration `011` and matching SQLite/PostgreSQL persistence;
- internal-first public literature resolver;
- authenticated resolve/confirm routes for Web and desktop audiences;
- idempotent desktop annotation create/update/retract operations.

Exit gate: Intuecho API tests, Web build compatibility, and PostgreSQL integration pass with 11 migrations.

### Phase 2: Intuecho Compose and Reply Projections

Plan: `docs/superpowers/plans/2026-08-09-direct-annotation-02-intuecho-compose-and-replies.md`

Consumes:

- `LiteratureRecord`, `LiteratureResolveResult`, and resolver routes from Phase 1;
- confirmed `literatureId` lookup and canonical target persistence;
- publication and source-reply repository behavior.

Deliverables:

- migration `012` for linked moderation and projection state;
- explicit `publishAsAnnotation` contract;
- reply-canonical body editing, derived retraction/deletion/moderation lifecycle;
- Web component test harness;
- search-first target editor and manual fallback;
- reply composer with inherited targets and visibility constraints.

Exit gate: Web component tests, Intuecho API tests/build, PostgreSQL integration, and forum E2E pass with 12 migrations.

### Phase 3: Liteasy Direct PDF Publication

Plan: `docs/superpowers/plans/2026-08-09-direct-annotation-03-liteasy-pdf-publication.md`

Consumes:

- resolver and confirm routes from Phase 1;
- canonical `literatureId` and provenance values;
- idempotent desktop publication upsert/retract operations;
- reply behavior only for cross-product E2E verification.

Deliverables:

- paper-level local/cloud literature metadata with `manual` preservation;
- version 2 PDF annotation publication state and v1 migration;
- cross-feature publication controller and candidate/manual dialog;
- removal of PDF “发到论坛” and “立即同步” commands;
- accurate create/update/retract status and restart recovery;
- desktop browser acceptance and cross-product E2E.

Exit gate: Desktop, Rust, Liteasy services, development cloud, Intuecho, PostgreSQL integration, Playwright, and cross-product E2E all pass.

## Cross-Phase Contract Lock

The following names must remain identical across plans:

```ts
type LiteratureSource = "public_registry" | "manual" | "inferred";
type LiteratureIdentifierKind =
  | "doi"
  | "arxiv_id"
  | "semantic_scholar_id"
  | "openalex_id"
  | "title_authors_year_hash";

type LiteratureIdentifier = {
  kind: LiteratureIdentifierKind;
  source: LiteratureSource;
  value: string;
};

type LiteratureCandidate = {
  candidateKey: string;
  record: {
    authors: string[];
    documentType?: string;
    identifiers: LiteratureIdentifier[];
    title: string;
    year?: number;
  };
  provider: "intuecho" | "openalex" | "crossref" | "arxiv" | "semantic_scholar";
};

type ManualLiteratureInput = {
  authors: string[];
  documentType?: string;
  identifiers: Array<{
    kind: Exclude<LiteratureIdentifierKind, "title_authors_year_hash">;
    source: "manual";
    value: string;
  }>;
  title: string;
  year?: number;
};

type LiteratureConfirmInput =
  | { candidateKey: string; mode: "candidate" }
  | { mode: "manual"; record: ManualLiteratureInput };

type LiteratureResolveInput = {
  hints?: {
    authors?: string[];
    identifiers?: Array<{ kind: LiteratureIdentifierKind; value: string }>;
    title?: string;
    year?: number;
  };
  limit?: number;
  purpose: "forum_compose" | "liteasy_pdf_annotation";
  query?: string;
};

type LiteratureProviderAvailability = {
  unavailableProviders: Array<"openalex" | "crossref" | "arxiv" | "semantic_scholar">;
};

type LiteratureResolveResult =
  | ({ candidate: LiteratureCandidate; status: "exact" } & LiteratureProviderAvailability)
  | ({ candidates: LiteratureCandidate[]; status: "ambiguous" } & LiteratureProviderAvailability)
  | ({ candidates: []; status: "not_found" } & LiteratureProviderAvailability)
  | ({ retryable: true; status: "unavailable" } & LiteratureProviderAvailability);

type LiteratureRecord = {
  authors: string[];
  documentType?: string;
  identifiers: LiteratureIdentifier[];
  literatureId: string;
  provenance: {
    confirmedAt: string;
    mode: "public_registry" | "manual";
    provider?: "intuecho" | "openalex" | "crossref" | "arxiv" | "semantic_scholar";
  };
  title: string;
  year?: number;
};

type ConfirmedLiteratureReference = {
  literatureId: string;
};
```

`ManualLiteratureInput` deliberately omits `literatureId`, `confirmedAt`, and
provider provenance because those values are assigned by Intuecho after
validation. New annotation targets write only `ConfirmedLiteratureReference`;
server responses may hydrate the canonical `LiteratureRecord` for display, but
clients cannot overwrite a record by sending title, author, or source fields
beside an existing `literatureId`.

Routes:

- `POST /v1/literature:resolve`
- `POST /v1/literature:confirm`
- `POST /v1/pdf-annotations:sync` with explicit publication operations
- `PUT /v1/replies/:replyId/publication`
- `DELETE /v1/replies/:replyId`

Reply intent is `publishAsAnnotation`; `shareToPlaza` remains only an annotation feed projection and may not trigger derived creation.

## Review Checkpoints

- [ ] **Checkpoint 1: Review Phase 1 contract before Web or Desktop integration**

Confirm canonical records distinguish `manual`, verified public registry data, inferred hints, and storage-only legacy metadata. Confirm client input cannot forge `public_registry`.

- [ ] **Checkpoint 2: Review database isolation after migrations 011 and 012**

Confirm Intuecho migrations touch only the Intuecho database and Liteasy development migration `020` touches only Liteasy storage. Confirm no connection string or repository is reused across products.

- [ ] **Checkpoint 3: Review reply lifecycle before Web sign-off**

Confirm pure replies create no annotation; projected replies inherit targets and visibility; body edits remain canonical; retraction keeps the reply; deletion and moderation follow the approved linked behavior.

- [ ] **Checkpoint 4: Review remote-truth publication states before Desktop sign-off**

Confirm create failure means not published, update failure says the old version remains, and retract failure says the forum copy remains public. Confirm restart replay uses the original queue key and revision.

- [ ] **Checkpoint 5: Run complete verification**

```bash
cd products/intuecho && npm test && npm run build
cd products/intuecho/services/api && npm run test:postgres:integration
cd products/liteasy/services/api && npm test
cd development/dev-cloud && npm test
cd products/liteasy/apps/desktop && npm test && npm run build
cd products/liteasy/apps/desktop/src-tauri && cargo fmt --check && cargo test
cd products/intuecho && node scripts/development-desktop-forum-e2e.mjs
cd products/liteasy/apps/desktop && npx playwright test src/tests/browser/pdfAnnotationPublication.browser.spec.ts
```

Expected: every command passes. Any unavailable public provider is reported as a deployment-environment gap rather than replaced with a runtime fixture.

## Completion Criteria

- Liteasy users annotate PDF text directly and choose publication on the annotation itself.
- Paper identity resolves automatically when reliable, prompts for a candidate when ambiguous, and permits marked manual fallback only after not-found.
- Both products persist manual provenance at paper/literature and identifier level.
- Intuecho composing uses one literature search field instead of raw identity forms.
- Reply-derived annotations are explicit projections with one canonical body and approved lifecycle behavior.
- All migration, unit, component, integration, build, Rust, browser, and E2E gates pass without claiming production provider readiness.
