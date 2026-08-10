# Liteasy Direct PDF Annotation Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist confirmed literature at paper scope and replace PDF forum handoff/sync commands with direct, optional, accurately tracked annotation publication.

**Architecture:** Liteasy keeps canonical literature metadata in its own local/cloud storage and adapts it to PaperIdentity. A controller owns cross-feature literature resolution and publication orchestration, while PdfReader remains responsible for selection and annotation presentation. Publication state separates desired visibility from confirmed remote state and uses Phase 1 idempotent operations.

**Tech Stack:** React 18, TypeScript 5.8, Fluent UI 9, Vitest/Testing Library, Tauri 2/Rust, Node.js services, SQLite/PostgreSQL

## Global Constraints

- Phases 1 and 2 must be complete before this plan starts.
- Preserve dependency direction `layout -> controllers -> features -> shared types / clients`.
- `AppShell` composes the controller; it must not retain literature hashing, sync loops, or forum handoff orchestration.
- New annotations default private; document-level auto-public remains available but defaults false.
- Remove “发到论坛” and “立即同步” from the PDF annotation workflow.
- Persist confirmed literature before sending an Intuecho publication operation.
- Tauri paper metadata is authoritative; a host write failure may not be hidden by localStorage fallback.
- PDF identity extraction stays local and sends only bounded bibliographic hints.
- A failed retract must say that the forum copy remains public.
- Use Fluent components/icons and accessible names; no emoji or additional icon library.

---

## File Map

- `products/liteasy/apps/desktop/src/app/features/paper-identity/literature.types.ts`: canonical Liteasy literature types matching Intuecho field names.
- `products/liteasy/apps/desktop/src/app/features/paper-identity/literatureRecord.ts`: validation, v1 snapshot normalization, PaperIdentity adaptation, and PDF hint collection.
- `products/liteasy/apps/desktop/src/app/features/paper-identity/literatureMetadataRepository.ts`: local authoritative load/save using the paper artifact store.
- `products/liteasy/apps/desktop/src-tauri/src/user_paper_store.rs`: allow atomic `bibliographic-identity.v1.json` snapshots.
- `products/liteasy/apps/desktop/src/app/features/forum/forumClient.ts`: resolve, confirm, and publication operation clients.
- `products/liteasy/apps/desktop/src/app/controllers/usePdfAnnotationPublicationController.ts`: cross-feature state machine and deferred candidate/manual confirmation.
- `products/liteasy/apps/desktop/src/app/features/forum/LiteratureResolutionDialog.tsx`: candidate selection and manual fallback UI.
- `products/liteasy/apps/desktop/src/app/features/pdf/pdfAnnotationStorage.ts`: version 2 desired/remote publication state and v1 migration.
- `products/liteasy/apps/desktop/src/app/features/pdf/PdfReader.tsx`: direct annotation view, per-item public toggle, and accurate status.
- `products/liteasy/services/api/src/libraryRepository.mjs` and `development/dev-cloud/db/libraryStorageRepository.mjs`: Liteasy-owned cloud literature metadata persistence.

### Task 1: Liteasy Literature Domain and Local Authoritative Storage

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/paper-identity/literature.types.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/paper-identity/literatureRecord.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/paper-identity/literatureMetadataRepository.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/paper-identity/paperIdentity.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/library/userPaperArtifactClient.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/workspace/workspace.types.ts`
- Modify: `products/liteasy/apps/desktop/src-tauri/src/user_paper_store.rs`
- Modify: `products/liteasy/apps/desktop/src-tauri/src/local_library.rs`
- Create: `products/liteasy/apps/desktop/src/tests/literatureRecord.test.ts`
- Create: `products/liteasy/apps/desktop/src/tests/literatureMetadataRepository.test.ts`

**Interfaces:**
- Produces `LiteratureRecord`, `LiteratureIdentifier`, `LiteratureResolveInput`, `LiteratureResolveResult`, `LiteratureConfirmInput`.
- Produces `normalizeLiteratureSnapshot(value)`, `paperIdentityFromLiterature(paper, literature)`, `createPdfLiteratureHints(paper, { embeddedMetadata, firstPageText })`.
- Repository methods: `load(paperId)` and `save(paperId, literature)`.
- Adds `Paper.literature?: LiteratureRecord` and user paper artifact kind `bibliographic-identity`.
- Adds optional `Paper.libraryReference?: { documentId; revision; scopeId; scopeType }` so the publication controller can select Liteasy local or cloud persistence without guessing from a path.

- [ ] **Step 1: Write failing domain and repository tests**

```ts
test("preserves manual provenance while adapting a primary PaperIdentity", () => {
  const literature = fixtureLiterature({
    identifiers: [{ kind: "doi", source: "manual", value: "10.1000/manual" }],
    provenance: { mode: "manual" }
  });
  const identity = paperIdentityFromLiterature({ id: "paper-1", title: "Paper" }, literature);
  expect(identity.primary).toMatchObject({ kind: "doi", source: "manual", value: "10.1000/manual" });
});

test("writes bibliographic metadata through the Tauri truth store", async () => {
  await repository.save("paper-1", fixtureLiterature());
  expect(saveArtifact).toHaveBeenCalledWith(expect.objectContaining({
    artifactKind: "bibliographic-identity",
    paperId: "paper-1",
    snapshot: expect.objectContaining({ version: 1 })
  }));
});
```

Add Rust assertions that `artifact_kind_is_allowed("bibliographic-identity")` is true, path traversal remains false, and a complete local-library backup contains the saved `bibliographic-identity.v1.json` with byte-identical provenance.

- [ ] **Step 2: Run focused TypeScript and Rust tests to verify failure**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/literatureRecord.test.ts src/tests/literatureMetadataRepository.test.ts`

Run: `cd products/liteasy/apps/desktop/src-tauri && cargo test user_paper_store`

Run: `cd products/liteasy/apps/desktop/src-tauri && cargo test exports_a_complete_byte_verified_library_backup_without_changing_the_source`

Expected: FAIL because the types, repository, and artifact kind are absent.

- [ ] **Step 3: Implement the versioned paper-level record**

```ts
export type LiteratureRecord = {
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

export type LiteratureSnapshot = {
  literature: LiteratureRecord;
  version: 1;
};
```

Extend `PaperIdentitySource` with `public_registry` and `manual`; preserve `metadata`, `inferred`, and `local` for old inputs. `resolvePaperIdentity` prefers `paper.literature` through `paperIdentityFromLiterature`, then falls back to old flat fields. The repository throws on malformed snapshots or failed Tauri writes; it does not store authoritative data in localStorage.

- [ ] **Step 4: Run domain, repository, PaperIdentity, and Rust tests**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/literatureRecord.test.ts src/tests/literatureMetadataRepository.test.ts src/tests/paperIdentity.test.ts`

Run: `cd products/liteasy/apps/desktop/src-tauri && cargo test user_paper_store`

Run: `cd products/liteasy/apps/desktop/src-tauri && cargo test exports_a_complete_byte_verified_library_backup_without_changing_the_source`

Expected: PASS.

- [ ] **Step 5: Commit local literature storage**

```bash
git add products/liteasy/apps/desktop/src/app/features/paper-identity/literature.types.ts products/liteasy/apps/desktop/src/app/features/paper-identity/literatureRecord.ts products/liteasy/apps/desktop/src/app/features/paper-identity/literatureMetadataRepository.ts products/liteasy/apps/desktop/src/app/features/paper-identity/paperIdentity.ts products/liteasy/apps/desktop/src/app/features/library/userPaperArtifactClient.ts products/liteasy/apps/desktop/src/app/features/workspace/workspace.types.ts products/liteasy/apps/desktop/src-tauri/src/user_paper_store.rs products/liteasy/apps/desktop/src-tauri/src/local_library.rs products/liteasy/apps/desktop/src/tests/literatureRecord.test.ts products/liteasy/apps/desktop/src/tests/literatureMetadataRepository.test.ts
git commit -m "feat: persist paper literature identity"
```

### Task 2: Liteasy Cloud and Development Metadata Persistence

**Files:**
- Create: `products/liteasy/services/api/src/literatureMetadata.mjs`
- Create: `products/liteasy/services/api/src/literatureMetadata.test.mjs`
- Modify: `products/liteasy/services/api/src/libraryRepository.mjs`
- Create: `products/liteasy/services/api/src/libraryRepository.test.mjs`
- Modify: `products/liteasy/services/api/src/server.test.mjs`
- Create: `development/dev-cloud/db/migrations/020_library_document_metadata.sql`
- Modify: `development/dev-cloud/db/libraryStorageRepository.mjs`
- Modify: `development/dev-cloud/db/libraryStorageRepository.test.mjs`
- Modify: `development/dev-cloud/requestHandler.mjs`
- Modify: `development/dev-cloud/server.test.mjs`
- Modify: `products/liteasy/apps/desktop/src/app/features/library/cloudLibraryStorageClient.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/library/cachedReaderPapers.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/cloudLibraryStorageClient.test.ts`

**Interfaces:**
- Produces `normalizeLiteratureMetadata(value)` in the Liteasy API boundary.
- Extends `POST /v1/library/documents/update` with optional `literature`.
- Cloud client method: `updateLiterature(scope, documentId, expectedRevision, literature)`.
- Reader-paper projection preserves the cloud `libraryReference`; user-cloud entries update their Liteasy record, while organization entries without manage permission retain the confirmed record in the user's local paper metadata instead of bypassing organization policy.

- [ ] **Step 1: Write failing service, development, and client tests**

Assert formal PostgreSQL updates `library_entries.metadata.literature`, development SQLite updates `library_documents.metadata_json.literature`, metadata-only entries use the same key, and invalid/manual-provenance payloads fail without changing revision.

```js
const updated = await repository.updateEntry(scope, {
  actorId: "user-1",
  documentId: "document-1",
  expectedRevision: 1,
  idempotencyKey: "literature-1",
  literature: manualLiterature
});
assert.equal(updated.document.metadata.literature.provenance.mode, "manual");
```

- [ ] **Step 2: Run affected service and client tests to verify failure**

Run: `cd products/liteasy/services/api && node --test src/literatureMetadata.test.mjs src/libraryRepository.test.mjs src/server.test.mjs`

Run: `cd development/dev-cloud && node --test db/libraryStorageRepository.test.mjs server.test.mjs`

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/cloudLibraryStorageClient.test.ts`

Expected: FAIL because document literature metadata is ignored.

- [ ] **Step 3: Add validated metadata updates without cross-product dependencies**

Liteasy validates the same field names and source enum locally; it does not import Intuecho repository or credentials. Formal PostgreSQL uses `jsonb_set(metadata, '{literature}', $value, true)`. Development migration `020` adds valid `metadata_json` to PDF documents and development repository updates it in the same revision transaction.

```js
const literature = Object.hasOwn(input, "literature")
  ? normalizeLiteratureMetadata(input.literature)
  : current.metadata?.literature;
const metadata = { ...(current.metadata ?? {}), ...(literature ? { literature } : {}) };
```

Organization writes continue through existing `manage` authorization; Intuecho never calls this route. `cachedReaderPapers` carries an explicit library reference from `openDocument`, allowing the controller to select cloud persistence only when authorized. Audit metadata records document ID and operation only, not full author lists or provider payloads.

- [ ] **Step 4: Run service, development, and client tests**

Run: `cd products/liteasy/services/api && npm test`

Run: `cd development/dev-cloud && npm test`

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/cloudLibraryStorageClient.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Liteasy cloud persistence**

```bash
git add products/liteasy/services/api/src/literatureMetadata.mjs products/liteasy/services/api/src/literatureMetadata.test.mjs products/liteasy/services/api/src/libraryRepository.mjs products/liteasy/services/api/src/libraryRepository.test.mjs products/liteasy/services/api/src/server.test.mjs development/dev-cloud/db/migrations/020_library_document_metadata.sql development/dev-cloud/db/libraryStorageRepository.mjs development/dev-cloud/db/libraryStorageRepository.test.mjs development/dev-cloud/requestHandler.mjs development/dev-cloud/server.test.mjs products/liteasy/apps/desktop/src/app/features/library/cloudLibraryStorageClient.ts products/liteasy/apps/desktop/src/app/features/library/cachedReaderPapers.ts products/liteasy/apps/desktop/src/tests/cloudLibraryStorageClient.test.ts
git commit -m "feat: persist cloud literature metadata"
```

### Task 3: Publication State Version 2 and Forum Client

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/forum/forum.types.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/forum/forumClient.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/forumClient.test.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/pdf/pdfAnnotationStorage.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/pdf/pdfAnnotationIntuechoSync.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/pdfAnnotationStorage.test.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/thinReadingIntuechoSyncQueue.test.ts`
- Create: `products/liteasy/apps/desktop/src/tests/pdfAnnotationPublicationClient.test.ts`

**Interfaces:**
- Forum client methods: `resolveLiterature`, `confirmLiterature`, `applyAnnotationPublications`, `feed`.
- Replaces old annotation fields with `publication: PdfAnnotationPublication` while reading version 1 snapshots.
- Adds a monotonically increasing local `revision` to `PdfAnnotation`; the stable queue key is derived once from paper ID plus annotation ID and reused with that revision after restart.
- Produces `createUpsertOperation(annotation, literature)` and `createRetractOperation(annotation)`.

- [ ] **Step 1: Write failing v1 migration and publication client tests**

```ts
test("migrates a synced v1 annotation to confirmed published state", () => {
  const [annotation] = normalizePdfAnnotations([legacySynced], fallbackIdentity);
  expect(annotation.publication).toMatchObject({
    desiredVisibility: "public",
    remoteAnnotationId: "annotation-remote",
    state: "published"
  });
  expect(annotation.revision).toBe(1);
});

test("sends a retract operation without claiming success early", async () => {
  const result = await client.applyAnnotationPublications([retractOperation]);
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/v1/pdf-annotations:sync"), expect.anything());
  expect(result.results[0].state).toBe("retracted");
});
```

Also assert upsert body is `annotation.note.trim()` when present and otherwise the selected excerpt. Feed a response with a missing/mismatched queue key, annotation ID, or revision and assert the client returns a stable failed result while retaining the pending local operation.

- [ ] **Step 2: Run focused tests and verify old state cannot satisfy them**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/forumClient.test.ts src/tests/pdfAnnotationStorage.test.ts src/tests/pdfAnnotationPublicationClient.test.ts`

Expected: FAIL because publication state and new client methods are absent.

- [ ] **Step 3: Implement version 2 state and operation mapping**

```ts
export type PdfAnnotationPublication = {
  desiredVisibility: "private" | "public";
  lastError?: string;
  remoteAnnotationId?: string;
  remoteRevision?: number;
  state:
    | "not_published"
    | "resolving_identity"
    | "needs_identity_selection"
    | "needs_manual_identity"
    | "pending_create"
    | "published"
    | "pending_update"
    | "pending_retract"
    | "failed";
};
```

Store snapshot `{ annotations, autoPublic, version: 2 }`. Map v1 `private` to not-published, v1 pending/failed to public desired with failed/pending state, and v1 synced to published. Initialize migrated annotations at local revision 1, increment the revision for every body/target/publication-intent edit, and derive the same queue key from immutable paper and annotation IDs on every replay. A successful retract returns to `not_published` while preserving `remoteAnnotationId` and remote revision for audit and explicit republishing. Preserve old IDs. Remove `forumDraftId` from all new writes but continue to read it as a legacy failed/recovery clue.

Forum client authentication remains late-bound through `getSessionId`. Resolve/confirm and publication paths use JSON, stable public errors, and no direct provider calls.

- [ ] **Step 4: Run publication, storage, and existing queue tests**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/forumClient.test.ts src/tests/pdfAnnotationStorage.test.ts src/tests/pdfAnnotationPublicationClient.test.ts src/tests/thinReadingIntuechoSyncQueue.test.ts`

Expected: PASS; thin-reading compatibility remains unchanged.

- [ ] **Step 5: Commit publication state and client**

```bash
git add products/liteasy/apps/desktop/src/app/features/forum/forum.types.ts products/liteasy/apps/desktop/src/app/features/forum/forumClient.ts products/liteasy/apps/desktop/src/tests/forumClient.test.ts products/liteasy/apps/desktop/src/app/features/pdf/pdfAnnotationStorage.ts products/liteasy/apps/desktop/src/app/features/pdf/pdfAnnotationIntuechoSync.ts products/liteasy/apps/desktop/src/tests/pdfAnnotationStorage.test.ts products/liteasy/apps/desktop/src/tests/thinReadingIntuechoSyncQueue.test.ts products/liteasy/apps/desktop/src/tests/pdfAnnotationPublicationClient.test.ts
git commit -m "feat: track pdf annotation publication"
```

### Task 4: Cross-Feature Publication Controller and Resolution Dialog

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/controllers/usePdfAnnotationPublicationController.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/forum/LiteratureResolutionDialog.tsx`
- Modify: `products/liteasy/apps/desktop/src/app/layout/AppDialogs.tsx`
- Create: `products/liteasy/apps/desktop/src/tests/usePdfAnnotationPublicationController.test.tsx`
- Create: `products/liteasy/apps/desktop/src/tests/LiteratureResolutionDialog.test.tsx`

**Interfaces:**
- Controller action: `changePublication({ annotation, literatureHints?, operation, paper }): Promise<PdfAnnotationPublication>` where operation is `"publish" | "update" | "retract"` and optional `literatureHints` contains only bounded PDF metadata/first-page clues.
- Controller model: `{ literatureDialog: LiteratureDialogModel | null }`.
- Dialog actions: `selectCandidate(candidateKey)`, `submitManual(record: ManualLiteratureInput)`, `retryResolution()`, `cancelResolution()`.
- Controller dependency: `persistPaperLiterature(paper, literature)` chooses the local Tauri repository or the authorized Liteasy cloud client from `paper.libraryReference`.

- [ ] **Step 1: Write failing controller and dialog tests**

Cover stored literature reuse, bounded embedded-metadata/first-page hints, exact auto-confirm, ambiguous deferred selection, unavailable retry, not-found manual form, cancel, local-save-before-publish, Liteasy literature-write rejection stopping the remote call, offline/unauthenticated/rate-limit retry persistence, update, retract, publish-then-retract races, and writeback recovery.

```tsx
const promise = result.current.actions.changePublication({ annotation, operation: "publish", paper });
await waitFor(() => expect(result.current.model.literatureDialog?.kind).toBe("candidates"));
act(() => result.current.actions.selectCandidate("candidate:doi:10.1000/test"));
await expect(promise).resolves.toMatchObject({ state: "published" });
expect(saveLiterature.mock.invocationCallOrder[0]).toBeLessThan(applyPublications.mock.invocationCallOrder[0]);
```

- [ ] **Step 2: Run focused tests and verify missing controller/dialog**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/usePdfAnnotationPublicationController.test.tsx src/tests/LiteratureResolutionDialog.test.tsx`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement one active deferred resolution request**

The controller rejects overlapping resolution prompts with a stable busy result, loads paper-level metadata first, resolves only when needed, persists confirmation, updates the workspace paper, and only then applies one idempotent publication operation. The returned remote annotation ID/revision is written to the annotation publication state; a failed Liteasy literature write stops before the remote call. Per-annotation operations are serialized so a retract requested during an in-flight create reuses the same queue key, waits for the create result, and retracts that exact remote annotation without duplicate creation.

```ts
async function publish(input: ChangePublicationInput) {
  const literature = input.paper.literature ?? await metadataRepository.load(input.paper.id) ??
    await resolveAndConfirm(input.paper, input.literatureHints);
  await persistPaperLiterature(input.paper, literature);
  workspaceStore.updatePapers([{ ...input.paper, literature }]);
  return publicationClient.applyAnnotationPublications([
    createUpsertOperation(input.annotation, literature)
  ]);
}
```

`unavailable` shows retry and never opens manual entry. `not_found` opens manual entry. Manual form requires title plus external identifier or author/year and sends `mode: "manual"`; it never marks itself verified. Cancel resolves the pending call to private/not-published without an error banner.

- [ ] **Step 4: Run controller, dialog, and AppDialogs tests**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/usePdfAnnotationPublicationController.test.tsx src/tests/LiteratureResolutionDialog.test.tsx src/tests/AppDialogs.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit controller and dialog**

```bash
git add products/liteasy/apps/desktop/src/app/controllers/usePdfAnnotationPublicationController.ts products/liteasy/apps/desktop/src/app/features/forum/LiteratureResolutionDialog.tsx products/liteasy/apps/desktop/src/app/layout/AppDialogs.tsx products/liteasy/apps/desktop/src/tests/usePdfAnnotationPublicationController.test.tsx products/liteasy/apps/desktop/src/tests/LiteratureResolutionDialog.test.tsx
git commit -m "feat: orchestrate pdf annotation publication"
```

### Task 5: PdfReader Direct Annotation UX and App Wiring

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/pdf/PdfReader.tsx`
- Modify: `products/liteasy/apps/desktop/src/app/layout/ReaderPane.tsx`
- Modify: `products/liteasy/apps/desktop/src/app/layout/AppShell.tsx`
- Modify: `products/liteasy/apps/desktop/src/app/features/forum/useForumController.ts`
- Modify: `products/liteasy/apps/desktop/src/app/styles/app.css`
- Modify: `products/liteasy/apps/desktop/src/tests/AppShell.test.tsx`
- Modify: `products/liteasy/apps/desktop/src/tests/LibraryReaderIntegration.test.tsx`
- Create: `products/liteasy/apps/desktop/src/tests/PdfReaderPublication.test.tsx`
- Modify: `products/liteasy/apps/desktop/src/tests/layoutStyleContract.test.ts`

**Interfaces:**
- Remove: `PdfForumSelection`, `onPostToForum`, `createDraftAndOpen` use from the PDF path.
- Add PdfReader prop: `onChangeAnnotationPublication(input): Promise<PdfAnnotationPublication>`.
- PdfReader obtains PDF embedded metadata and bounded first-page text locally, converts them with `createPdfLiteratureHints`, and passes only the resulting hints to the controller.
- AppShell composes `usePdfAnnotationPublicationController` and passes its dialog to `AppDialogs`.

- [ ] **Step 1: Write failing UI and wiring tests**

```tsx
expect(screen.queryByRole("button", { name: "发到论坛" })).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: "立即同步" })).not.toBeInTheDocument();
await user.click(screen.getByRole("checkbox", { name: /公开到论坛/ }));
expect(onChangeAnnotationPublication).toHaveBeenCalledWith(expect.objectContaining({ operation: "publish" }));
```

Add cases for highlight, underline, and note defaulting private; document auto-public default false; bounded hint collection without PDF bytes/full text; pending and published states; update failure showing the old forum copy; and retract failure text “论坛仍公开”.

- [ ] **Step 2: Run reader and AppShell tests to verify current buttons fail**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/PdfReaderPublication.test.tsx src/tests/AppShell.test.tsx src/tests/LibraryReaderIntegration.test.tsx src/tests/layoutStyleContract.test.ts`

Expected: FAIL because the handoff and immediate-sync controls still render.

- [ ] **Step 3: Replace commands with per-annotation publication state**

Remove `postSelectionToForum`, the selection-menu forum row, pending batch sync button, obsolete props, and `.add-to-forum` CSS. Keep highlight/underline/note and AI actions unchanged.

When the public toggle changes, optimistically persist only `desiredVisibility` and a pending state; replace it with the controller result when complete. On update failure keep `remoteAnnotationId` and show that the previous forum version remains. On retract failure keep remote-published status and show “撤回失败，论坛仍公开”.

When document auto-public is enabled, create and save the local annotation first, then invoke the same publish action used by the per-item toggle. Turning the toggle off before a remote create starts cancels the queued create and restores `not_published`; turning it off after the request starts waits for the create result and then submits a retract with the same queue key.

Saving a note on a published annotation calls operation `update`. Deleting a published local annotation first requests `retract`; if retract fails, keep the local record so the user can retry rather than losing the remote link.

Move old AppShell functions `postSelectionToForum`, `forumAnchorHash`, `forumAuthors`, and `syncAnnotationToForum` out. `useForumController` exposes only client calls used by the publication controller and feed.

- [ ] **Step 4: Run reader integration tests and production build**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/PdfReaderPublication.test.tsx src/tests/AppShell.test.tsx src/tests/LibraryReaderIntegration.test.tsx src/tests/layoutStyleContract.test.ts`

Run: `cd products/liteasy/apps/desktop && npm run build`

Expected: PASS; build assets contain no “发到论坛” or “立即同步” PDF command.

- [ ] **Step 5: Commit direct annotation UX**

```bash
git add products/liteasy/apps/desktop/src/app/features/pdf/PdfReader.tsx products/liteasy/apps/desktop/src/app/layout/ReaderPane.tsx products/liteasy/apps/desktop/src/app/layout/AppShell.tsx products/liteasy/apps/desktop/src/app/features/forum/useForumController.ts products/liteasy/apps/desktop/src/app/styles/app.css products/liteasy/apps/desktop/src/tests/AppShell.test.tsx products/liteasy/apps/desktop/src/tests/LibraryReaderIntegration.test.tsx products/liteasy/apps/desktop/src/tests/PdfReaderPublication.test.tsx products/liteasy/apps/desktop/src/tests/layoutStyleContract.test.ts
git commit -m "feat: publish pdf annotations directly"
```

### Task 6: Hydration, Restart Recovery, and Cross-Product Verification

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/controllers/useWorkspaceSelectionController.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/useWorkspaceSelectionController.test.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/pdfAnnotationStorage.test.ts`
- Modify: `products/intuecho/scripts/development-desktop-forum-e2e.mjs`
- Create: `products/liteasy/apps/desktop/src/tests/browser/pdfAnnotationPublication.browser.spec.ts`
- Create: `products/liteasy/apps/desktop/src/tests/fixtures/pdfAnnotationPublicationBrowserFixture.tsx`

**Interfaces:**
- Workspace hydration loads paper literature snapshots after opening the local library and merges only matching paper IDs.
- Restart recovery resumes pending create/update/retract operations with their original queue keys and revisions.

- [ ] **Step 1: Write failing hydration and recovery tests**

```ts
expect(workspaceStore.getState().papers[0].literature?.literatureId).toBe("literature_1");
expect(recovered.publication.state).toBe("pending_retract");
expect(createRetractOperation(recovered).queueKey).toBe(originalQueueKey);
```

Browser acceptance covers annotation creation, candidate selection, manual fallback source display, successful public status, edit update, and retract-failure copy at desktop and narrow viewport.

- [ ] **Step 2: Run focused recovery and browser tests to verify failure**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/useWorkspaceSelectionController.test.ts src/tests/pdfAnnotationStorage.test.ts`

Run: `cd products/liteasy/apps/desktop && npx playwright test src/tests/browser/pdfAnnotationPublication.browser.spec.ts`

Expected: FAIL because hydration and browser fixture are absent.

- [ ] **Step 3: Implement bounded hydration and restart replay**

Hydrate literature with `Promise.allSettled` after the local snapshot opens; ignore missing snapshots, surface corrupt snapshots as recoverable status, and do not block the whole library. Before replay, reload the annotation snapshot and literature record, then apply only operations still pending for the same local revision. Isolate a corrupt queue item, keep its local annotation, expose a recoverable error, and continue replaying valid items instead of dropping the queue.

Update the cross-product E2E to assert Intuecho persisted `manual` on both the literature record and identifier, then post a second annotation without another identity prompt.

- [ ] **Step 4: Run all affected verification gates**

Run: `cd products/intuecho && npm test && npm run build`

Run: `cd products/liteasy/services/api && npm test`

Run: `cd development/dev-cloud && npm test`

Run: `cd products/liteasy/apps/desktop && npm test && npm run build`

Run: `cd products/liteasy/apps/desktop/src-tauri && cargo fmt --check && cargo test`

Run: `cd products/intuecho/services/api && npm run test:postgres:integration`

Run: `cd products/intuecho && node scripts/development-desktop-forum-e2e.mjs`

Run: `cd products/liteasy/apps/desktop && npx playwright test src/tests/browser/pdfAnnotationPublication.browser.spec.ts`

Expected: all PASS. Provider live checks remain a deployment/staging gate and are not replaced by fixtures.

- [ ] **Step 5: Commit hydration and acceptance coverage**

```bash
git add products/liteasy/apps/desktop/src/app/controllers/useWorkspaceSelectionController.ts products/liteasy/apps/desktop/src/tests/useWorkspaceSelectionController.test.ts products/liteasy/apps/desktop/src/tests/pdfAnnotationStorage.test.ts products/intuecho/scripts/development-desktop-forum-e2e.mjs products/liteasy/apps/desktop/src/tests/browser/pdfAnnotationPublication.browser.spec.ts products/liteasy/apps/desktop/src/tests/fixtures/pdfAnnotationPublicationBrowserFixture.tsx
git commit -m "test: verify direct annotation publication"
```

## Phase 3 Completion Gate

- Confirmed and manual literature records survive restart at paper scope and keep provenance.
- Liteasy cloud/development metadata stores the same canonical record without Intuecho database access.
- PDF selection has no forum handoff; publication is a per-annotation visibility choice.
- Create/update/retract states report remote truth and recover idempotently after restart.
- A second annotation reuses confirmed paper metadata without another identity form.
- Desktop, Liteasy services, Intuecho, Rust, PostgreSQL integration, browser acceptance, and cross-product E2E pass.
