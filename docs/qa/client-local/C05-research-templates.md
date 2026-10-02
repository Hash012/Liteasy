# C05 offline research templates

Implementation: `7bf3daaa`, on C01 `a58502ca`. This is a deterministic source-and-note workflow slice. It does not establish model quality, full C05 acceptance or native platform acceptance.

## Reachable behavior

In **Extensions**, add/update **论文比较板** to package version `1.5.0` and enable it using the existing extension controls. Five **整理** commands are available in the package and its library context menu:

1. 先直觉后定义
2. 证据审计
3. 方法、假设与指标比较
4. 理论推导核对
5. 跨版本书籍摘录

Each command opens the existing resource-selection dialog. The user supplies a question and optional initial comment. The workflow reads at most eight selected resources, up to 4,000 characters each, and creates a new editable note. It never executes a model operation or writes over an existing note. These reading styles are available to everyone, without identity or expertise gates.

The worksheet separates author/source checking, model inference (not generated), and user comments. Actual excerpts appear with provenance; user notes and derived artifacts are explicitly not presented as author statements. Empty or metadata-only reads leave evidence gaps. Comparison cells remain unfilled for manual checking; the formatter does not infer methods, agreement, mastery or research conclusions from selected text. Status checkboxes allow pending checks, insufficient evidence, disagreement and a user-recorded check scope.

The existing operation catalog/runtime is reused: `core.comparison` recognizes a versioned offline request, while its prior four-section model-response path remains unchanged. No new executable operation, parallel workflow engine or generated shared schema is introduced. Existing package fixtures still exercise the model-based comparison with explicit test responses; the five new template fixtures have no model responses or model calls.

## Source and regeneration semantics

- Actual workspace asset reads now expose optional `evidence` metadata: `kind` is `source`, `user`, `derived` or `metadata`; `coverage` is `partial` or `unknown`. A non-truncated buffer never proves complete document coverage. The C01 saved-source body capability gate distinguishes real imported text from unsupported-format placeholders.
- Object source links are pinned to the immutable revision actually read, preserving an existing selector. A mismatching path/read revision is rejected. If a Paper content hash changes during its read, the request fails instead of associating replacement text with the old version.
- A recorded source `page:N` selector supplies a PDF physical page. Unrecorded original page labels, electronic-book chapter locations and precise paragraph positions remain unknown. The formatter never derives page numbers from source prose or model text.
- Sources that cannot be pinned by existing locators retain their revision text and a clearly labeled current-resource link. This is a fallback, not a claim that the current target still contains the recorded bytes. The saved excerpt remains readable offline.
- **重新调用（新运行）** uses the existing runner's `parentRunId` and creates a separate note. **查看上次运行** navigates to the parent record. A regression changes the source's current revision after the first run and verifies that a repeated pinned selection still reads the old source snapshot. User changes to the first note survive.
- **导出阅读模板快照** downloads the immutable generated Markdown from the run record. It includes source title, revision, type, location/coverage limits, raw resource locator and recorded excerpt. Later note edits are exported through the existing note editor's export path; snapshot export deliberately describes its recorded version. Existing BibTeX/RIS paths are unchanged.

An unavailable or failed resource read stops the workflow through its existing error path before the new note is saved. It does not fabricate an empty successful source. A successful metadata-only read can produce a worksheet with an explicit evidence gap.

## Verification

Environment: Ubuntu 24.04.3 / WSL2, Linux x86_64, kernel `6.18.33.2-microsoft-standard-WSL2`; Node 22.13.1 instead of `.nvmrc` 22.23.2. This slice uses no Rust changes. Tests use synthetic object documents and text, fake IndexedDB, jsdom and explicit injected UI ports. The storage/repository/workflow implementations execute in tests, but this is not real Tauri transport or native filesystem acceptance.

| Check | Result | Evidence |
| --- | --- | --- |
| Three new package/formatter/runner regressions before implementation | Expected failures: templates absent; offline request unsupported | `/tmp/liteasy-c05-red.log` |
| Paper revision-change regression before its guard | Expected failure: replacement text returned successfully | `/tmp/liteasy-c05-revision-red.log` |
| Final affected tests: templates, UI snapshot export/history, durable workflows, package trials/integration, Agent assets | 47 tests in 7 files passed | `/tmp/liteasy-c05-final-green.log` |
| Five package template trials | Passed inside affected suite, alongside three existing model-response fixtures | `extensionStudio.test.ts` and `extensionIntegration.test.tsx`; fixture transport is synthetic |
| `npm run ci:smoke` | 9 tests passed | `/tmp/liteasy-c05-smoke.log` |
| Final `npm run build` | Passed, 157 production assets verified; existing chunk-size warning | `/tmp/liteasy-c05-build-final.log` |
| `npm run ci:contracts` on clean `7bf3daaa` | Passed; schemas and locks unchanged | `/tmp/liteasy-c05-contracts.log` |
| New export/history UI case in isolation | Passed without console errors | `/tmp/liteasy-c05-view-isolated.log` |
| Extension integration in isolation | 8 tests passed; emits jsdom/Tabster `NodeFilter is not defined` teardown stderr warning | `/tmp/liteasy-c05-extension-isolated.log`; the combined test log records the same warning |
| Live model quality, real academic coverage evaluation, browser/WebView, native Windows/macOS and installer | Not run | No claim of model reasoning quality or platform acceptance |

The UI export test captures a browser Blob and verifies its exact Markdown bytes and download filename; it mocks the actual download click. The source revision/physical-page fixtures are synthetic records, not real PDF rendering or OS navigation. `/tmp` logs are local ephemeral evidence. No private files, production services, paid models or remote model requests were used.

## Limits, compatibility and rollback

This slice provides source-preserving worksheets and manual checking, not automatic scholarly comparisons or derivation verification. Human evaluation of academic quality and source coverage remains pending. Fine-grained author claims/model inferences and structured verification statuses are editable Markdown here; a dedicated claim schema, visual diff editor and automatically checked conflict resolution are not implemented.

Electronic-book chapter/CFI capture, original page-label capture and native source jump/reconnection acceptance remain pending. A revision-pinned object link is verified through repository reads; it does not prove native viewer paragraph navigation after a file replacement. C01's legacy import hash deduplication/source-provenance limits also remain.

The package moves from `1.4.0` to `1.5.0`; users update through the existing explicit package install controls. Package versions remain immutable and old versions are retained. Existing notes, object schemas, workflow receipt/snapshot formats, shared generated contracts and dependencies are unchanged. Optional read evidence metadata is compatible with existing readers.

To roll back runtime code, switch the package to its previous version and revert `7bf3daaa`. Saved Markdown notes and exports remain readable. Older runtimes cannot execute/recompute the new offline request variant, so do not claim rollback restores that execution feature; historical notes and recorded snapshots need no deletion. No rollback should overwrite user edits or source files.
