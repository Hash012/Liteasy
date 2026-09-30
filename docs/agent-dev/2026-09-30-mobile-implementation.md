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
