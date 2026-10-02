# C01 resource identity and reading capabilities

Implementation: `918603e1`, based on `0fba97be`. This is a bounded C01 adapter slice, not full C01 acceptance. No native or Windows acceptance is claimed.

## Existing contracts and integration

| Existing contract | Reuse in this slice |
| --- | --- |
| `ResourceRef` and resource-file provider registry | Retained; no new provider or parallel registry |
| `ResourceTarget`, `liteasyPath`, `ObjectRef` | Canonical scoped resource key and pinned locator; object revision and selector retained |
| `ReadingCatalogEntry`, reading-library repository and parser | Existing records/readers receive a capability adapter; no conversion of books to new Paper records |
| Workspace Agent asset adapters | Unsupported imported-file placeholders now return an unavailable error from explicit body reads |
| Existing immutable object/asset storage | Unchanged; imports, historical references, byte verification and removal/reimport behavior remain compatible |

`features/resource-filesystem/resourceIdentity.ts` exports `describeResourceIdentity(scopeId, target, {contentHash?, sourcePath?, revision?})`. Its result separates `key`, `locator`, `revision`, `selectorId`, `contentHash` and `sourcePath`. The key removes an object's pinned revision/selector; the locator retains the requested reference. Source locations are metadata, never read authority. Case is preserved. Existing content-addressed Paper IDs and external file path identities are explicitly labeled with `stability`; they are not relabeled as rename-stable logical IDs.

`useReadingLibraryController` supplies these identities on actual catalog entries and uses their locators for existing location/context consumers. Renaming a library folder changes organization metadata while preserving the catalog identity, object revision and byte hash. Existing distinct object IDs remain distinct even when their hashes match. This adapter does not allocate identities or change import deduplication.

`features/reading-library/readingResourceCapabilities.ts` exports:

- `readingResourceCapabilities(entry, {canExport?, bodyTextAvailable?})`: format plus `open/read/search/annotate/edit/export/aiExtract` operations. Each operation is available with an optional `body`, `metadata` or `text-layer` mode, or unavailable with a reason.
- `sourceDocumentBodyCapability(object)`: a pure gate for actual saved body text. It excludes unavailable sources, metadata-only Paper references, empty text and unsupported reading-file attachment MIME types. Full-text indexing must use this saved-body gate, not the filename or the human-readable placeholder stored for unsupported imports.

Reading details, catalog double-click/Enter and controller open actions consume the same availability decision. Unsupported file rows remain inspectable. The primary reading button is disabled with a visible reason; only the explicit export action downloads the original. The independent source-body gate is also enforced by the existing Agent asset reader. Title discovery remains metadata-only and does not load source bodies or attachments.

## Capability matrix for the reading-library adapter

These capabilities describe this adapter. They do not remove capabilities from the separate external Markdown editor or image attachment service. Parser support is not a promise that every encrypted, malformed or scanned file contains extractable text. AI extraction does not claim a configured model or send a model request.

| Format | Open/read | Search | Annotate | Edit original | Export original | AI text extraction |
| --- | --- | --- | --- | --- | --- | --- |
| PDF | Existing PDF reader | Available text layer; metadata otherwise | Existing PDF annotations | No | Only with an actual export adapter; current Paper catalog disables it | Requires caller-confirmed extracted text; scans may need OCR |
| EPUB, MOBI, FB2, HTML, Markdown, TXT | Existing document reader | Reader text; metadata remains available | No | No | Existing imported-file export | Supported parser text; saved-body gate checks actual availability |
| Office, CSV, JSON, images and other saved formats | Unavailable with reason | Metadata only | No | No | Explicit original export | Unavailable: body not extracted |
| Missing source | Unavailable with reason | Metadata only | No | No | Unavailable | Unavailable |

Bibliographic fields remain optional; the synthetic HTML guide and plain-text imports require no DOI, research project or discipline. Metadata editing remains available independently of original-file editing.

## Verification

Environment: Ubuntu 24.04.3 on WSL2/WSLg, Linux x86_64, kernel `6.18.33.2-microsoft-standard-WSL2`; Node 22.13.1 versus `.nvmrc` 22.23.2. Tests use Vitest/jsdom, fake IndexedDB, synthetic byte arrays and injected UI callbacks. No real Tauri transport, native file picker, OS file move or real original-file write was exercised. No network service, private data or paid model was used.

| Command / check | Result | Evidence |
| --- | --- | --- |
| `npm ci --no-audit --no-fund` | Passed | `/tmp/liteasy-c01-npm-ci.log` |
| New unsupported-file catalog test on baseline behavior | Expected failure: reading button absent, primary action mislabeled as export | `/tmp/liteasy-c01-catalog-red.log` |
| New controller and Agent source-read tests before their fixes | Expected failures: open attempted download (jsdom lacks `URL.createObjectURL`); Agent returned placeholder text | `/tmp/liteasy-c01-body-red.log` |
| Affected tests across identity/capabilities, catalog/controller, Agent, repository, parser/reader and paths | 95 tests in 9 files passed | `/tmp/liteasy-c01-focused-green.log` |
| `npm run ci:smoke` | 9 tests passed | `/tmp/liteasy-c01-smoke.log` |
| `npm run build` | Passed; 157 production assets verified; existing large-chunk warning | `/tmp/liteasy-c01-build.log` |
| `npm run ci:contracts` on clean `918603e1` | Passed: tracked resources, regenerated contracts, TypeScript and lock/shared cleanliness | `/tmp/liteasy-c01-contracts.log` |
| Real browser/WebView, native Windows/macOS, original file replacement/reconnect, installer/upgrade | Not run | These unit and build checks do not establish OS acceptance |

The exact affected command is recorded in `C01-verification.json`. `/tmp` logs are local, ephemeral evidence rather than release artifacts. Original-byte preservation is verified only for synthetic repository assets; real native original files were not exercised by this slice.

## Remaining C01 acceptance and compatibility

- Existing reading-library imports intentionally deduplicate by byte hash, including renamed reimports that restore historical references. This behavior remains compatible; distinct same-byte bibliographic source copies and their migration remain unresolved. The identity adapter itself never merges existing different object IDs by hash.
- External mount paths remain path identities. Actual OS rename/move tracking, source replacement detection and user-facing version/reconnect workflows are not added. Object-reference revision/selector separation is verified; that does not prove native paragraph reattachment after replacement.
- Cross-platform export/reimport preserving logical IDs, revisions and source provenance is not implemented or verified here. Ordinary file export preserves original bytes but does not package identity metadata.
- The operation matrix covers reading-library consumers. Other provider/editor capability registries remain in place; this is not a global type or persistence rewrite.
- Native Windows/macOS, true WebView rendering, file associations, performance measurements and release/installer gates remain unverified.

There are no persisted schema or dependency changes. Revert `918603e1` to roll back this slice; existing object/assets, references, annotations and source files need no migration or deletion. The next C01 work should define explicit duplicate-source provenance and transfer/reconnect behavior before changing legacy content-hash import identity.
