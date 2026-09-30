# Liteasy Android implementation

The reviewed plan is implemented on `mobile`, with one commit per checkpoint. App root: `products/liteasy/apps/mobile`. Existing unrelated workspace changes are excluded from commits.

## Architecture

- Tauri 2 library host with an Android entry point; React/TypeScript and Fluent 2 UI.
- Kotlin owns Android intents, URI grants, background scheduling, notifications and system authentication integration.
- `layout -> controllers -> features -> shared domain/platform clients`. Desktop layout is not a mobile dependency.
- Pure reusable domain code goes into named packages under `products/liteasy/packages`; existing `shared` remains versioned contracts/static data.
- Local capture, file access, PDF reading and annotation work offline. Import acknowledgements require durable storage. The source URI alone is not a saved attachment.
- WebDAV carries portable files and annotation data; device commands use a separately authenticated service. Remote command execution is scoped to a paired device and its declared capabilities.
- A task is accepted only after its inputs are identified, and executed only after required attachments are available. Retries reuse an operation ID; unknown completion is surfaced rather than silently repeating side effects.
- Raw PDF coordinates remain authoritative for ink. Reflowed reading links back to the source; it does not reinterpret geometric annotations.
- Local account data is isolated. Login does not silently claim or upload guest materials. API and WebDAV credentials never enter shared snapshots.

## Checkpoints

| # | Commit subject | Acceptance |
| --- | --- | --- |
| 1 | feat: bootstrap Liteasy mobile Android app | Frontend tests/build, locked native checks, Android build, CI lint/tests; record native runtime evidence separately |
| 2 | refactor: share literature and annotation core | Legacy fixtures and affected desktop tests/build/contracts |
| 3 | feat: add offline mobile library | Restart durability, deduplication, interrupted imports, trash/restore |
| 4 | feat: receive Android shares into Liteasy | Cold/warm intents, multiple items, URI lifetime, retry, native persistence |
| 5 | feat: add mobile PDF reading | Text/scanned/long PDFs, zoom/search/outline/position and bounded page rendering |
| 6 | feat: add mobile PDF annotations and ink | Desktop-compatible data, gestures, undo/redo, coordinate stability and durable saves |
| 7 | feat: sync mobile library through WebDAV | Two-way file transport, hash validation, retries, deletions and offline pinning |
| 8 | feat: merge annotations across devices | Independent edits, same-record conflicts, tombstones, document versions and safe compatibility |
| 9 | feat: add mobile account authentication | Browser OAuth, secure session lifecycle, guest migration and account isolation |
| 10 | feat: add device pairing and remote task service | Authorization, presence, durable leasing/cancellation/receipts and retry handling |
| 11 | feat: execute mobile requests on desktop | Real desktop operations and mobile result delivery with attachment readiness |
| 12 | feat: refine mobile and tablet reading workflows | Responsive layout, navigation/back, accessibility, reflow and source jumps |
| 13 | test: validate Android workflows and package APK | End-to-end capture/read/sync/task flow, upgrade and installable artifact |

## Validation policy

Each checkpoint records actual checks and evidence; a build is not a device UX acceptance. Desktop edits follow root AGENTS.md, including affected tests, smoke, build and contracts on a clean commit/worktree. CI edits use existing workflow lint and Node tests. Dependency installs use `npm ci`; intentional lock generation precedes installation. Cargo checks use `--locked`.

Android SDK, NDK, JDK and Node are installed outside the repository. SDK paths, signing keys, APKs, caches and runtime databases are not committed. Debug-signed builds support development installation; public distribution signing and store deployment require separate credentials and deployment evidence.

## Evidence log

Implementation in progress. Completed commits and validation outcomes are appended as checkpoints finish.

### 1. Android project baseline

- Mobile shell smoke passed; TypeScript and production frontend build passed.
- Linux Rust check passed with `--locked --all-targets --no-default-features`.
- ARM64 and x86_64 debug APK builds passed with locked Cargo dependencies. The checked-in Gradle wrapper has a pinned distribution checksum; Android platform 36, Build Tools 35.0.0, NDK 27.2.12479018, minimum API 26, Java 17.
- Local Node 22.23.2 / Rust 1.98.0; CI reads the desktop Node version and uses the repository's Windows-workflow Rust version, 1.98.1. No Windows build result is implied.
- Workflow lint and 76 existing CI-script tests passed. Production npm dependency audit reports no known advisories. Mobile PDF.js uses 6.3.289; desktop dependencies are unchanged.
- Runtime acceptance remains open: the host cannot access KVM. The software Android 35 emulator booted but repeatedly hit system watchdog timeouts before app installation. The emulator ignored the attempted `ro.hw_timeout_multiplier` override; installation is being retried after increasing its watchdog timeout. This cannot provide representative device performance evidence.

### 2. Shared reading core

- Extracted literature identity/types, annotation validation/migration/publication types, ink geometry and guide metadata into `packages/reading-core`; desktop feature entry points preserve their public exports. Account lookup and persistence remain in desktop.
- 81 affected desktop tests passed across identity, persistence, publication, guide, drawing/annotation workbench and review behavior; 8 desktop smoke tests passed.
- Desktop production build passed (157 assets verified). `ci:contracts` passed in an isolated clean checkout of the refactor commit; dependency locks and generated schemas did not drift.

### 3. Offline mobile library

- Native SQLite metadata and private attachment storage support chunked imports, SHA-256 deduplication, classification, tags, notes, reading position and trash/restore. A file is fully copied and synced before its item is published; incomplete transfers never appear as saved items.
- Browser development uses IndexedDB with an atomic metadata/attachment transaction. Both repositories partition data by account scope and reject stale edits.
- Five mobile tests passed, covering the shell, reopen durability, concurrent deduplication, account isolation, trash/restore, stale edits and malformed imports. Android x86_64 debug APK and instrumentation APK builds passed. Locked Linux Rust all-target checks passed.
- Four Android instrumentation tests cover SQLite reopen/file integrity, duplicate import preservation, incomplete transfers and JSON value types. They compile successfully; device execution is pending the software emulator installation. Native runtime acceptance remains explicitly open.

### 4. Android share capture

- `ACTION_SEND` and `ACTION_SEND_MULTIPLE` enter the same durable inbox from cold or already-running activities. Content URIs are copied into private files while permission is available; atomic capture metadata survives a restart. Interrupted captures remain visible as errors. Each item can be reviewed with title/category/note and archived independently.
- The inbox is unassigned until the user confirms the destination library. Archival removes a capture only after its library transaction succeeds; retrying after a crash uses content deduplication. Limits are 16 attachments per share, 256 MiB per attachment and 512 MiB of pending attachments.
- Seven mobile tests and frontend production build passed. Android debug app and instrumentation APK builds passed. Three additional native tests cover source-file removal, multiple attachments, retry retention, text/links and unsupported URIs. Native runtime results will be appended once emulator installation completes.
- Fixed asynchronous library updates after component teardown, exposed by the expanded test run.

### 5. Mobile PDF reading

- Added a lazy-loaded PDF reader with page navigation, width-fit/zoom, outline navigation, cancellable full-document search (first 100 matches), password prompting and durable reading position. It renders only the visible page, with a 4-million-pixel canvas cap and cancellation-safe canvas ownership.
- PDF.js uses its legacy distribution for older Android WebViews. CMaps, fonts, image decoders and ICC resources ship locally with their licenses, so rendering does not need a CDN. PDF scripting/forms are not enabled.
- Seven mobile unit/integration tests passed. Two Chromium tests passed at a phone viewport with touch enabled: text/image rendering, outline/search, zoom, persisted page after reload, and page jumps in a 120-page PDF with one bounded canvas. Fixtures are original generated text/bitmap PDFs.
- Frontend production and Android x86_64 debug APK builds passed. Native emulator installation subsequently failed with a package-service broken pipe and the activity was unavailable, so the earlier install success did not establish runtime acceptance. A single-core software emulator retry is in progress; browser evidence is recorded separately from Android runtime evidence.

### 6. PDF annotations and ink

- Added text-selection highlights/underlines, placed notes/text boxes, pen/finger ink, erasing, a cross-page annotation list and durable undo/redo. Page percentages and the shared ink/annotation validators retain desktop-compatible geometry and version-2 records.
- Writes serialize before publishing saved state. Undo/redo advances record revisions. Unsupported/corrupt snapshots and mismatched document hashes stop editing without overwriting stored data. Account scopes also isolate annotation records.
- Eleven mobile tests passed; additional guard checks passed after tightening unsupported-version handling. Three browser flows passed; the annotation flow was then checked with trusted Chromium pen input, verifying highlight creation, handwriting, undo/redo, zoom-coordinate stability, notes, restart recovery and absence of page errors.
- Frontend production and Android x86_64 debug APK builds passed. A subsequent controller refinement queues rapid pen strokes while earlier writes are pending; its production frontend build passed. Step 5's locked Linux Rust check also passed. Native instrumentation remains pending the slow emulator package installation.

### 7. WebDAV file synchronization

- Added Android WorkManager scheduling, network constraints, retries/cancellation, TLS-only WebDAV transport, conditional manifest publishing and SHA-256 validation. Uses the desktop `manifest.v1.json` / immutable `objects/{hash}` protocol and preserves unselected categories. Credentials use AES-GCM with an Android Keystore key and files excluded from backup.
- File and portable metadata changes use a persisted three-way baseline. Missing manifests/records stop synchronization; stale conflict choices cannot override changed versions. Deleted files remain recoverable locally. All downloaded files are kept for offline use; download caching resumes completed transfers after a worker interruption. Annotation sidecars are enabled by checkpoint 8 after its merge rules are in place.
- Applying a downloaded batch checks local versions under the library mutex, then commits metadata transactionally. Files currently open for reading, including remote rename targets, are deferred. SQLite version 2 permits distinct logical documents with identical bytes while retaining normal capture deduplication.
- Android Kotlin upgraded to 2.2.21 for the new native dependencies; WorkManager 2.11.2 and OkHttp 5.4.0 are pinned. Debug app/instrumentation builds and four JVM protocol tests passed. Mobile frontend tests/build passed, including scoped settings requests and password-field clearing.
- Device evidence is now available: four native library tests and three native share tests passed. Four initial native sync integration tests passed against an injected remote with real SQLite/Keystore, covering two-device transfer, metadata/deletion, preserved categories, failed publish/lost manifest, concurrent local editing and credential isolation. The expanded seven-case sync suite compiles; its device run remains pending a stalled emulator package installation. Four JVM protocol tests and debug app/test APK builds passed after the final changes.
- Fixed the empty-library first-sync case: create the remote manifest before recording a baseline, so a second sync does not mistake an uncreated manifest for lost remote data. Added a regression case for empty sync followed by a first PDF import.
- Emulator only: software rendering/one CPU; Google Play Services and Bluetooth were disabled after repeated system crashes. `ro.hw_timeout_multiplier=10` was set using the debuggable emulator and the Android framework restarted. UI acceptance is still open: the bundled WebView 124 renderer crashed during activity launch. Native data tests do not establish reader UI acceptance or production WebDAV-provider acceptance.

### 8. Cross-device annotation merging

- Added `packages/annotation-sync`, a pure Rust core used directly by desktop and through JNI by Android background workers. Native saves retain deletion tombstones and unknown snapshot extensions. Sync imports are validated separately from user edits so an imported stale record cannot masquerade as an undo.
- Merges use the common PDF fingerprint and document ID from both manifests. Independent entries merge automatically; concurrent changes retain deterministic, private conflict copies marked in both annotation lists. Delete/edit conflicts preserve the edit under a new ID while retaining the original deletion. Unsupported versions, mismatched PDFs and ambiguous extensions remain file conflicts.
- Enabled Android annotation sidecars using the desktop artifact paths. Source reads now check the expected fingerprint on every native chunk; an already-replaced PDF requires reopening instead of accepting old coordinates against new bytes.
- Six shared-core tests and 13 desktop WebDAV engine tests passed, including an actual two-library HTTP sync/convergence test. Desktop affected frontend tests passed after updating the expected document identity; eight smoke tests, production build (157 assets) and locked Rust all-target checks passed. Mobile's 12 frontend tests passed, followed by the affected source-version regression; Android app/test APK builds passed.
- Fifteen Android instrumentation tests passed on one matched app/test build: four library, three share and eight WebDAV/JNI tests. This includes checkpoint 7's empty-library regression. After adding the source-fingerprint guard, all 12 affected library/WebDAV tests passed again on Android. All three browser reading/annotation flows passed. `ci:contracts` passed in a clean checkout of the implementation commit, with no schema/lock drift.

### 9. Mobile account authentication

- Implemented system-browser OAuth code/PKCE S256 with encrypted, expiring, single-use callbacks, token refresh rotation, subject binding and logout/revocation. JavaScript receives public account status only. Login identity is verified through the business API's JWT/introspection boundary with a separate mobile audience/client ID. Account/issuer/API scopes isolate storage and background work.
- Login keeps the guest library separate. Explicit copy preserves guest originals and copies metadata/annotations transactionally; duplicates are skipped and publication receipts/sync credentials are excluded. Late responses from a previous library cannot repopulate the current account's UI.
- Added optional mobile identity endpoints/configuration, Keycloak public-client templates and reconciliation, and mobile-inclusive account-wide revocation. [Account setup](../../products/liteasy/apps/mobile/docs/accounts.md) documents deployment and HTTPS requirements. No live IdP or production API deployment is implied.
- Affected API checks passed (79 initially; 71 route/config/verifier tests after the final endpoint additions). Seven identity-management tests, 13 deployment configuration/template tests and shell syntax checks passed. Mobile's 12 existing tests passed; three final account/scope/shell tests and production frontend/Android builds passed.
- Nine final Android instrumentation tests passed: four existing library cases and five account cases covering PKCE/state/replay/process recreation, secret isolation, refresh rotation/revocation/subject mismatch, expiry/cancellation, and guest copy with annotation-publication isolation. HTTP identity responses are injected for these tests; real-provider login awaits a configured deployment/account.
- The local foundation verifier passed its realm assertions but could not run Docker Compose validation because Docker is not installed. Its command error reporting now identifies the missing executable instead of throwing an unrelated `trim` error. Android 36 UI validation is being retried with a SHA-1-verified official system image after Android 35's renderer crash.
