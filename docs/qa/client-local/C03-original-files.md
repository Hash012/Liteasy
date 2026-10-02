# C03 original-location PDF and EPUB slice

Implementation: `1651c630` and close/reopen race fix `fb9abd2f`. Base: `8d31bf57`.
This is the frontend half of an integrated slice. Native grants and OS handoff are in C10; AppShell/action wiring belongs to the integrator. This report is not full C03 acceptance.

## Behavior and boundaries

- Native chooser and cold/hot OS requests use the same exact-file grant service. The frontend reads an opaque grant ID with its scope; it never sends an arbitrary original path to a read command. Binary IPC returns an ArrayBuffer.
- PDF opens in the existing PDF reader. SHA-256 uses the existing `paper-<hash>` identity scheme, while `sourcePath` remains the original canonical location. Reopening unchanged bytes at the same path keeps annotation identity. An explicit original open takes precedence over a same-content library/cache entry.
- EPUB uses the existing parser and document reader. Its content hash gives a stable reader ID for the existing EPUB position storage. It creates no reading-library object, source asset, or catalog entry, and its native handle is released after parsing.
- Opening calls no import, copy, rename, upload, metadata-entry, or model operation. Existing explicit import behavior is unchanged. Reference-only catalog membership is not added by this slice.
- Chooser cancellation does nothing. Busy state prevents duplicate dialogs; native batches read sequentially. Failed reads report errors, release handles, and continue to later files. Scope changes discard late results. Late listener registrations are unsubscribed after disposal.
- PDF handles are released on replacement, tab close, controller disposal, or scope switch. Closing during a delayed duplicate open prevents that open from resurrecting a released handle. Original bytes are not retained in controller state.
- Original PDF annotations use the existing user-paper artifact store. Its path validates the paper ID without requiring catalog membership; closing a reader does not call artifact deletion. No new database, schema, account, or service is introduced.

## Integration ports

Pass the existing object scope (`local` or `user:<verified subject>`) to `useExternalPaperController` as `scopeId`. Add `originalReaderPapers` to every `resolveReaderPaper` call using its optional `originalPapers` parameter. Include their IDs and the array itself in available-reader-ID reconciliation and its effect dependencies.

After creating the reading-library controller, compose:

```tsx
const originalFiles = useOriginalFileOpenController({
  scopeId: objectWorkbench.repository.scopeId,
  onOpenPdf: externalPapers.openOriginalPdfFile,
  onOpenEpub: readingLibrary.openOriginalFile,
  onError: setAnalysisHint
});
```

Use `originalFiles.openFile` for the existing action registry entry, with `available`, `busy`, and `disabledReason`. Call `externalPapers.closeOriginalPdfFile(paperId)` from individual PDF close and region close-all paths. Markdown continues to use the existing note-file chooser and editor.

Native commands are `choose_native_open_file`, `read_native_open_file`, `release_native_open_file`, and `drain_native_open_requests`, all with `scope`. Read/release additionally receive `id`. The wakeup event is `native-open-files-available`; the controller subscribes before initial drain. Descriptor fields are `id`, `path`, `fileName`, `format` (`pdf`/`epub`), `sizeBytes`, and `modifiedUnixMs`.

## Validation

Environment: Ubuntu 24.04 on WSL2/WSLg, Linux x86_64; Node 22.13.1, compared with repository `.nvmrc` 22.23.2. Rust is not exercised by this frontend-only worktree. The available Rust 1.98.0 differs from workflow 1.98.1. WSLg is not native Windows verification.

Dependencies installed with `npm ci --no-audit --no-fund`. Regression tests were added before implementation: the new entrypoints initially failed, and the same-path reload and close-during-digest tests each demonstrated their bug before the fix.

| Check | Result | Evidence / limitation |
| --- | --- | --- |
| Original service/controller, PDF identity, EPUB parser/repository, annotation storage/persistence | 82 passed before the final race fix; 15 affected controller cases passed after it, including the new case (83 distinct tests total) | `/tmp/liteasy-c03-files-focused.log`, `/tmp/liteasy-c03-files-close-focused.log`; injected native chooser/read/listener and storage doubles, synthetic bytes |
| `npm run ci:smoke` | 8 passed | `/tmp/liteasy-c03-files-smoke.log`; source casing and Tauri resources |
| `npm run build` after final code change | Passed | `/tmp/liteasy-c03-files-build-final.log`; existing chunk-size warning |
| `npm run ci:contracts` on clean `fb9abd2f` | Passed | `/tmp/liteasy-c03-files-contracts.log`; tracked resources, regenerated schema, TypeScript, locks/shared output unchanged |
| Actual native picker, binary IPC, OS events, original filesystem hashes | Not run in this worktree | Integrator validates the combined C03/C10 branch with synthetic native files |
| Browser interaction and native Windows/macOS | Not run | Unit hooks do not prove PDF rendering/search/annotation interaction, platform associations, or installer behavior |

Logs in `/tmp` are local, ephemeral evidence rather than release artifacts. No private files, remote model, service, or production environment was used.

## Remaining work and compatibility

Full C03 remains incomplete: PDF focused page currently resets to page 1, and exact-file grants are process-only. After restart the user must select the original again; PDF annotation identity remains stable, while automatic restoration of the original tab/grant is not implemented. EPUB uses its existing position mechanism, but its end-to-end restart behavior was not exercised here. Reference-only library membership and new explicit copy-import UX are also outside this slice.

No persisted format or data migration changes. Revert these frontend commits and remove integration wiring to roll back; existing annotations and EPUB reader position keys may remain and are harmless. No rollback operation should delete original files or saved annotations. The next bounded acceptance task is combined native chooser/OS opening with synthetic PDF search and saved annotation, followed by a dedicated PDF position restoration slice.
