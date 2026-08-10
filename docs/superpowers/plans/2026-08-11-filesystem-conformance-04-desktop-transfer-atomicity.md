# Desktop Transfer Atomicity Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cloud-folder copies to the local library compensate every resource created by the failed operation and keep folder drag payloads complete while search filtering is active.

**Architecture:** Extend the Tauri metadata mutation boundary so callers know whether an add created a new logical entry and receive the exact trash identifier when removing it. Mutation results contain only identifiers produced by the committed operation, avoiding a post-commit snapshot scan that could fail after the caller's compensation data already exists; existing callers explicitly refresh the library afterward. The transfer controller records only metadata entries created by its current folder copy and compensates them alongside the physical root directory. Search-filtered explorer nodes retain a reference to their unfiltered source node, so drag payloads stay complete without duplicating every descendant subtree on each ancestor.

**Tech Stack:** Rust 2021, Tauri 2, React 18, TypeScript 5, Vitest, Testing Library.

## Global Constraints

- The confirmed source of truth is `docs/design/Liteasy-文件系统与存储边界设计.md`, especially sections 5.2, 5.3, 6, 9.2, 10.2, and 17.1.
- Local metadata-only entries remain in the global virtual group `仅元数据`; copying a physical folder must not pretend they live below that directory.
- Compensation may remove only resources proven to have been created by the failed operation; pre-existing metadata entries must remain untouched.
- Cross-area folder drag always represents the complete source subtree, regardless of search text, expansion state, or which descendants are currently rendered.
- Preserve the dependency direction `layout -> controllers -> features -> shared types / clients`; `AppShell` remains composition-only.

---

### Task 1: Exact Local Metadata Mutation Results

**Files:**
- Modify: `products/liteasy/apps/desktop/src-tauri/src/local_library.rs`
- Modify: `products/liteasy/apps/desktop/src/app/features/library/libraryFileSystemClient.ts`
- Test: `products/liteasy/apps/desktop/src-tauri/src/local_library.rs`

**Interfaces:**
- Produces: `AddMetadataOnlyLibraryEntryResult { created: boolean; documentId: string }`.
- Produces: `TrashLocalMetadataEntryResult { trashId: string }`.
- Preserves: deterministic metadata identity and duplicate insertion as a no-op.

- [x] **Step 1: Write a failing Rust mutation-result test**

Add a root-level helper test that inserts the same DOI-backed metadata record twice and asserts the first result is `(document_id, true)`, the second is `(document_id, false)`, and only one metadata file/index entry exists. Add a trash helper assertion that the returned `trash_id` resolves to a metadata-entry manifest for the same document.

```rust
let first = add_metadata_only_entry_at_root(&root, "Paper", Some("10.1000/test"), None, None).unwrap();
let second = add_metadata_only_entry_at_root(&root, "Paper", Some("10.1000/test"), None, None).unwrap();
assert!(first.created);
assert!(!second.created);
assert_eq!(first.document_id, second.document_id);

let trash_id = trash_metadata_entry_at_root(&root, &first.document_id).unwrap();
let manifest = read_trash_manifest(&trash_directory(&root).join(trash_id).join("manifest.json")).unwrap();
assert_eq!(manifest.document_id.as_deref(), Some(first.document_id.as_str()));
```

- [x] **Step 2: Run the focused Rust test and verify RED**

Run: `cargo test metadata_mutations_report_exact_created_and_trashed_resources`

Expected: FAIL because the root helpers and result contract do not exist.

- [x] **Step 3: Implement the exact mutation contracts**

Extract the existing add and metadata-trash mutations into root-level helpers. Return the deterministic document ID plus `created`, and return the exact generated `trashId` from trash. Keep Tauri commands responsible for resolving the active root, serializing the index transaction, and attaching the resulting `LocalLibrarySnapshot`.

Update the TypeScript client signatures:

```ts
export type AddMetadataOnlyLibraryEntryResult = {
  created: boolean;
  documentId: string;
};

export type TrashLocalMetadataEntryResult = {
  trashId: string;
};
```

- [x] **Step 4: Run the focused Rust test and TypeScript typecheck path**

Run: `cargo test metadata_mutations_report_exact_created_and_trashed_resources`

Run: `npx tsc --noEmit`

Expected: PASS.

### Task 2: Failed Folder-Copy Metadata Compensation

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/controllers/useLibraryResourceTransferController.ts`
- Test: `products/liteasy/apps/desktop/src/tests/useLibraryResourceTransferController.test.ts`

**Interfaces:**
- Consumes: `addMetadataOnlyLibraryEntry(...) -> AddMetadataOnlyLibraryEntryResult`.
- Consumes: `trashLocalMetadataEntry(documentId) -> TrashLocalMetadataEntryResult`.
- Produces: a failed cloud-folder-to-local copy removes the created physical root and every metadata entry whose add result reported `created: true`.

- [x] **Step 1: Write failing compensation tests**

Add one test where a new metadata child succeeds and a later PDF child fails. Assert the controller trashes and purges both the created physical root and the new metadata entry. Add a second test where the metadata add reports `created: false`; assert the pre-existing metadata document ID is never trashed.

```ts
expect(local.trashLocalMetadataEntry).toHaveBeenCalledWith("metadata-created");
expect(local.purgeLocalLibraryTrashItem).toHaveBeenCalledWith("trash-metadata-created");
expect(local.trashLocalMetadataEntry).not.toHaveBeenCalledWith("metadata-existing");
```

- [x] **Step 2: Run the focused controller tests and verify RED**

Run: `npm test -- --run src/tests/useLibraryResourceTransferController.test.ts`

Expected: FAIL because folder-copy cleanup only removes the physical directory.

- [x] **Step 3: Implement operation-scoped metadata compensation**

Track document IDs only when `addMetadataOnlyLibraryEntry` reports `created: true`. On failure, attempt every cleanup even if one fails: trash/purge the physical root when it exists, then trash/purge each newly created metadata entry in reverse creation order. If any cleanup fails, return the existing stable incomplete-cleanup error containing the original copy failure; otherwise rethrow the original failure.

- [x] **Step 4: Run the focused controller tests**

Run: `npm test -- --run src/tests/useLibraryResourceTransferController.test.ts`

Expected: PASS.

### Task 3: Search-Independent Folder Drag Payloads

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/library/LibraryPane.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/LeftPane.test.tsx`

**Interfaces:**
- Produces: each filtered `ExplorerFolder` carries `unfilteredFolder: ExplorerFolder`, referencing the sorted, complete source node.
- Preserves: `filterTree` may reduce `children` and `entries` for rendering, while `folderTransferSource` serializes `unfilteredFolder` when present.

- [x] **Step 1: Write a failing search-and-drag test**

Render a collection folder containing one matching and one nonmatching descendant, enter a search query that leaves the parent visible, drag the visible parent row, parse the custom MIME payload passed to `dataTransfer.setData`, and assert both descendants remain in `payload.tree.entries`.

```ts
await user.type(screen.getByRole("textbox", { name: "搜索文献资源" }), "Match");
fireEvent.dragStart(screen.getByRole("button", { name: "Reading" }).closest(".library-folder-row")!, {
  dataTransfer
});
expect(payload.tree.entries.map((entry) => entry.entry.documentId)).toEqual([
  "matching-document",
  "nonmatching-document"
]);
```

- [x] **Step 2: Run the focused UI test and verify RED**

Run: `npm test -- --run src/tests/LeftPane.test.tsx`

Expected: FAIL because the drag payload is serialized from the filtered explorer node.

- [x] **Step 3: Preserve the full transfer subtree before filtering**

When `filterTree` keeps a folder, attach the original unfiltered folder object to the filtered copy. Make `folderTransferSource` build its payload from that source object when present. Do not materialize a full transfer subtree on every ancestor, because deeply nested libraries would duplicate descendant data quadratically.

- [x] **Step 4: Run the focused UI test**

Run: `npm test -- --run src/tests/LeftPane.test.tsx`

Expected: PASS.

### Task 4: Desktop Regression Verification and Commit

**Files:**
- Review: all files changed by Tasks 1-3.

**Interfaces:**
- Consumes: the desktop Rust, Vitest, and production build commands.
- Produces: a focused commit on `fix/filesystem-conformance` with no changes in the user's active worktree.

- [x] **Step 1: Run the Rust suite**

Run: `cargo test`

Expected: all local-library tests pass.

- [x] **Step 2: Run the complete desktop test suite**

Run: `npm test`

Expected: all non-environmental tests pass with only documented skips.

- [x] **Step 3: Run the desktop production build**

Run: `npm run build`

Expected: TypeScript, Vite, schema generation, and production-asset verification pass.

- [x] **Step 4: Review and commit the focused diff**

Run: `git diff --check`

Run: `git status --short`

```bash
git add docs/superpowers/plans/2026-08-11-filesystem-conformance-04-desktop-transfer-atomicity.md products/liteasy/apps/desktop/src-tauri/src/local_library.rs products/liteasy/apps/desktop/src/app/controllers/useLibraryResourceTransferController.ts products/liteasy/apps/desktop/src/app/features/library/LibraryPane.tsx products/liteasy/apps/desktop/src/app/features/library/libraryFileSystemClient.ts products/liteasy/apps/desktop/src/tests/useLibraryResourceTransferController.test.ts products/liteasy/apps/desktop/src/tests/LeftPane.test.tsx
git commit -m "fix: preserve desktop folder transfer atomicity"
```

Expected: clean `fix/filesystem-conformance` branch after the commit.

## Verification Notes

- `cargo test`: 68 passed, 0 failed.
- `npm test -- --reporter=json --outputFile=/tmp/liteasy-filesystem-vitest-final.json`: 1,736 passed, 4 skipped, 0 failed across 379 reported suites.
- The first JSON-report run encountered one transient `listen EPERM` in `devScript.test.ts`; the focused test immediately passed 6/6 and the subsequent complete run passed with 0 failures.
- `npm run build`: TypeScript and Vite passed; production asset verification checked 129 files.
