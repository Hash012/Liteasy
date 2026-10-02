# C01 follow-up — Preserve distinct import sources

Date: 2026-10-03 (Asia/Shanghai). Source commit: `678b3dc8dc763c2eb1c5ac4096975dc12869a65e`, based on `3be817ed`.

This bounded follow-up fixes the content-only deduplication gap identified in [the first C01 report](C01-resource-capabilities.md). It is not full C01 acceptance or a cross-platform migration result.

## Reproduced problem and delivered behavior

The previous reading repository used `reading:<SHA-256>` for the catalog entry and `reading-file:<SHA-256>` for the source object. Different file names, source paths or bibliography with identical bytes therefore returned the first entry. The regression-first run produced **5 failures and 11 passes**, recorded in `/tmp/liteasy-c01-sources-red.log`; three older assertions explicitly depended on merging renamed copies. Those assertions now check the new behavior while retaining same-source duplicate coverage and old-reference resolution.

New imports use the existing account-scoped object store, with no new database or shared schema:

| Part | Identity / behavior |
| --- | --- |
| Immutable bytes | Existing `asset/<SHA-256>` remains shared and verified on read. |
| Catalog entry | Independent `reading:<UUID>`, reserved once and retained through reimport. |
| Source document | Existing object repository allocates a separate object and pinned revision per logical entry. |
| Import lookup | `reading-library/import/<fingerprint>` binds a source hint, parsed bibliography and content hash to the entry ID and object key. It is an idempotency lookup, not the public resource identity. |
| Provenance | Additive `importSource: {kind, location}` distinguishes a provided path, a browser relative path and a filename-only hint. Spelling and case are preserved. |
| Existing catalog location | Folder membership is still separate metadata; moving or renaming library folders does not change ID, object ref, source hint or byte hash. |

`importFile(name, bytes, document, {source?})` accepts an optional provenance hint. The real `useReadingLibraryController` passes `File.webkitRelativePath` when available and otherwise the filename. Known path hints also reach `ReadingCatalogEntry.identity.sourcePath`; they confer no permission to access the filesystem. No arbitrary path reads were added.

The same source hint, parsed bibliography and content hash reuse one entry even under concurrent import. Different names, exact path strings (including case differences), or bibliography can share bytes while retaining distinct IDs, source objects and editable metadata. Parsed bibliography includes format, title, authors, language, publication, publication date and identifier. Later user edits remain separate metadata and do not change the import lookup.

Removing a library row still preserves source objects, immutable assets, metadata and its import mapping. Reimporting the same source restores its ID/ref. Importing a renamed copy does **not** infer a physical rename from matching bytes; it creates a separate entry and keeps previous references readable. Changed bytes retain the existing behavior of creating a new entry, preserving the old source revision. This slice does not add an in-place source revision migration.

## Legacy compatibility and recovery boundaries

- Existing `reading:<hash>` rows remain readable. A matching legacy filename, parsed bibliography and hash with only a filename hint can be adopted without rewriting the legacy row, ID, pinned ref or metadata. A supplied path is not assumed to match a legacy entry whose path was never recorded.
- Once adopted, the mapping preserves reimport-after-removal behavior. If an old row was already removed **before** this change, its path/name provenance may be unavailable; this slice does not guess that a new source is that historical item. Old object references remain readable.
- Import first reserves the mapping, then persists the existing immutable asset/object pipeline and finally publishes the catalog row. Failure injection at all four stages verifies that retries do not expose partial catalog entries. Concurrent same-source imports converge; concurrent different-source imports keep two objects and one byte asset.
- Interrupted imports can leave small unused mapping/object records, matching the existing preservation policy. No garbage collection of historical references was introduced.
- No AppShell, Tauri command, shared schema, lockfile, service, deployment or original-file-open grant changes. Rollback can revert code without deleting data. Older code accepts string IDs/additive entry fields but applies its old content-only import rules; mixed-version importing can produce extra entries or old-style merges. No downgrade/native migration acceptance is claimed.

## Verification

All data is synthetic. Unit tests use fake IndexedDB and, where relevant, stub reader/file callbacks. Source-path tests store strings as metadata; they do not open those paths. The browser case uses real Chromium, AppShell, parser and IndexedDB, with synthetic `File` payloads supplied by Playwright. It bypasses the OS chooser and does not exercise Tauri IPC or native file I/O.

| Check | Result |
| --- | --- |
| Focused tests | **92 passed / 11 files**: repository, folder controller, identity/capability adapters, bibliography, Agent assets, context drop, local MCP assets, project catalog, original EPUB controller and global search. |
| Browser | **1 passed**: same-byte `copy-a.md` and `copy-b.md` coexist, each can be searched by filename and read, same-source reimport reports one duplicate, reload retains both. |
| Smoke | **9 passed**: module casing and Tauri resource configuration. |
| Production build | Passed; **157 assets verified**. Existing chunk-size warning remains. |
| Clean source contracts | Passed on `678b3dc8`; no generated schema or lockfile drift. |
| Documentation | `git diff --check`; machine-readable JSON parsed before commit. |

The first browser run reached both readers and failed only because the assertion searched inside the local-library subsection while the import message is rendered in its parent. The locator was corrected to the actual visible message and the case passed. No production code was changed to satisfy that assertion.

The passing focused run emits existing `act(...)` warnings from `assistantProjectCatalog.test.tsx` and `libraryAssetContextDrop.test.tsx`. Their checks pass, and those files were not modified. These warnings are disclosed rather than described as a warning-free suite.

Commands in `products/liteasy/apps/desktop`, with cached Node on PATH:

```sh
npm ci --no-audit --no-fund
npm test -- src/tests/readingLibraryRepository.test.ts src/tests/useReadingLibraryFolders.test.ts src/tests/readingResourceCapabilities.test.ts src/tests/resourceIdentity.test.ts src/tests/bibliographicMetadata.test.tsx src/tests/agentAssetService.test.ts src/tests/libraryAssetContextDrop.test.tsx src/tests/localAssetMcp.test.ts src/tests/assistantProjectCatalog.test.tsx src/tests/originalReadingController.test.tsx src/tests/globalSearch.test.ts
npm run ci:smoke
npm run build
# A separate terminal ran npx vite --host 127.0.0.1 --port 1434 --strictPort
NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost PLAYWRIGHT_BASE_URL=http://127.0.0.1:1434 npx playwright test src/tests/browser/readingImportIdentity.browser.spec.ts --workers=1
# After committing the source on a clean worktree:
npm run ci:contracts
```

Evidence logs: `/tmp/liteasy-c01-sources-{red,focused,smoke,build,browser,contracts}.log`. Temporary Vite port 1434 was stopped. Machine-readable results are in [C01-import-source-verification.json](C01-import-source-verification.json).

Environment: Ubuntu 24.04.3 LTS, x86_64, WSL2 kernel `6.18.33.2-microsoft-standard-WSL2`; Chromium `151.0.7922.34`. Node `22.13.1` differs from `.nvmrc` `22.23.2`; Rust `1.98.0` differs from Windows workflow `1.98.1`. No Rust code changed or Rust tests ran. This is not native Windows, macOS or installer acceptance.

## Remaining limits

Browser file selection often omits absolute paths. Two same-name, same-bibliography, same-byte inputs without a reliable path hint remain indistinguishable and can reuse an entry. The implementation does not claim to distinguish those hidden sources. Different spelling may represent the same physical file; no case folding, symlink resolution or path normalization is used to infer identity.

External rename/move reconciliation, cross-device import/export identity round trips, missing-source reconnect, same-source revision migration and explicit duplicate-copy decisions for otherwise indistinguishable inputs remain unimplemented. The separate PDF library and original-location PDF/EPUB identities are unchanged. C01 remains partial; `release_ready` is false.
