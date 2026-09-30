# Extension platform implementation

Source: [approved specification](../superpowers/specs/2026-09-29-liteasy-extension-platform-and-workflow-studio-spec.md).

Six sequential delivery commits; complete the affected checks before each commit, and run contracts against the resulting clean commit. Existing unrelated work stays outside these commits.

1. **Visual block foundation:** shared rich content, typography, persistent independent layout, media, drag/context and Canvas round trips.
2. **Derived types and extension packages:** bounded schemas, inheritance, composition templates, local installation, version ownership, activation and recovery.
3. **Workbench contributions:** extension views, settings/search, commands/menus, history and lifecycle integration.
4. **Durable execution:** shared resource operations, grants, workflows, run checkpoints, retries, cancellation, replay and recovery.
5. **Authoring and AI integration:** component/type/flow editor, previews, fixtures, immutable publishing, skills and local MCP development tools.
6. **Delivery:** synchronization, triggers, migrations, performance and isolation gates, integration regressions and Windows delivery validation.

Progress and evidence will be recorded below as work completes. Experimental code isolation is not enabled unless its Windows failure-isolation gate passes; declarative extensions remain available as specified.

## Step 1 — visual foundation

Implemented host-owned rich-content/failure boundary, inherited typography controls, independent versioned block presentation, layout locking and a layer list for obscured cards. Presentation changes preserve content revisions and round-trip through Canvas extension metadata. Added bounded image reads through existing directory grants (browser/native), including cancellation-safe URL disposal. Existing context transfer, source identity, editing and placement services are retained.

Validation: 63 affected frontend tests; 12 native note-file tests; CI smoke (8 tests); production frontend build; `cargo check --locked --all-targets --no-default-features`. Local Rust is 1.98.0; Windows CI pins 1.98.1, so this is not Windows installer evidence. Arbitrary derived types, authoring, durable runs, broader media/context integration and performance gates continue in subsequent steps.

## Step 2 — derived types and local packages

Implemented bounded JSON/schema evaluation, five inherited block families, typed composition trees, immutable content-verified v2 packages, explicit enable/disable/uninstall/rollback, and native/browser persistent installation records. Whiteboards now expose component creation, package import and an ordinary installable paper-comparison template. Structured fields are stored against content revisions with readable Markdown fallback; Canvas imports respect externally edited text instead of restoring stale structured values.

Validation: 67 affected frontend tests, followed by 19 targeted package/Canvas tests after the external-edit correction; CI smoke (8); production build. Current package execution is declarative. Host code remains disabled pending the specification's isolation gate. Workflow payload semantics, contributed views/settings and SDK authoring are addressed in the remaining steps.

## Step 3 — contributed workbench pages and settings

Added dynamic Dock identities, persistent declarative page instances, unavailable-extension placeholders, existing page history/switcher integration, and an extension manager in the activity rail. Dock persistence now writes a distinct v3 key while retaining older layout records. Extension settings use schema forms, searchable categories, global/profile/workspace inheritance, CAS saves, and preservation of unknown configuration versions. Registered library menu actions route through the same extension controller; configuration updates refresh contributed views.

Validation: 30 package/settings/layout tests and 38 workbench/history/library/AppShell integration tests; CI smoke (8); production build. Studio remains for step 5; no arbitrary-code runtime is enabled.

## Step 4 — persistent workflow execution

Added a bounded operation catalog backed by the existing asset service, scope/version-bound host grants, persistent operation intents/receipts, conditional undo, graph compilation, branch/join handling, bounded map execution, budgets, cancellation, single-step and manual-input checkpoints. Runs pin workflow definitions, package digests, configuration values and actual node snapshots. Recorded replay makes no external calls; uncertain interrupted writes require reconciliation. The ordinary paper-comparison package now reads actual selected resources, invokes the existing model connection, and saves a real associated note. The run viewer exposes partial failures and receipts; repeating model execution creates a new run.

Validation: 21 package/workbench/AppShell tests plus 6 focused durable-operation/recovery/branch/map tests; CI smoke (8); production build. Token budgets are explicitly estimated. External writes cannot be claimed atomic with the run store and are kept in reconciliation when the outcome cannot be established.

## Step 5 — Studio, authoring tools and shared SDK

Added the optional central Workflow Studio with inherited type/settings forms, draggable composition/flow graphs, keyboard-accessible step lists, source editing, theme/narrow previews, actual isolated fixture execution, file differences and immutable publication with a dependency lock/report. Draft CAS protects concurrent edits; AI cannot weaken existing fixture files. Users can extract a successful run or a chosen whiteboard into a reusable draft. Enabled skills are discoverable by summary and loaded on demand. In-app Agent and local MCP project the same authoring and structured-block service; structured updates preserve board geometry. Added transport-neutral SDK and UI-kit guidance.

Validation: 28 Studio/package/Agent/AppShell tests; 10 local MCP/lifecycle tests in the preceding targeted pass; actual three-case fixture suite executed through the production runner and isolated object repository; CI smoke (8); production build. Code execution remains gated; Studio publishes declarative packages only.

## Step 6 — delivery and integration

Completed separate WebDAV categories for extension packages, configuration, methods, run indexes and content snapshots. Grants, local mount bindings and automatic triggers stay device-local; synchronized packages arrive disabled. Configuration migration previews incompatible fields and atomically preserves the previous value. Packages may vendor exact hash-verified dependencies and contribute bounded declarative subflows without gaining their dependency's permissions.

Added application/startup/resource triggers with durable deduplication, self-change suppression, bounded catch-up and explicit failure suspension; fixed-condition pure-node recomputation; global/per-owner operation quotas; and typed node bindings in Studio. The comparison workflow validates real evidence and saves both a related note and a four-column board. Personal template namespaces run through the same runner and real account-backed isolated trial storage.

Whiteboards now virtualize placements, budget decoded images, cancel queued media reads, preserve relative mounted attachments, export a Canvas/attachment ZIP, and provide alignment, distribution, grouping and geometry-only undo. Shared UI primitives expose real Markdown editing, host visualization rendering and metadata selection. Editor drafts survive reopening, are scoped to the source path/account, and remain available on external revision conflicts. The Agent must discover and read a structured block before updating it. The SDK includes real resource and structured-block clients, alongside Studio and run tools. Agent/MCP workflow requests open the same host parameter/grant dialog; inspection, pause/resume/cancel and signal propagation use the persistent runner.

Validation records: production build for 0.1.25, CI smoke (8), native object storage (6), native WebDAV (25), native note files (12), and locked all-target Rust check. Browser integration exercises offline Studio creation, actual fixture trial, publication, enablement, opening the contributed page, persistent four-card board creation and reopening. Full frontend regression: 450 files / 3,079 tests passed, with four pre-existing skipped tests. The final shared workflow entry additions also passed 35 integration tests and seven Agent intent/safety tests; the transport SDK type check passed. Windows CI remains a post-commit delivery gate; earlier full regression caught and corrected a modal accessibility assertion and draft retention. No test was removed or skipped to pass.

Scope/verification boundaries: arbitrary extension JavaScript and custom WebView runtimes remain disabled under spec §11.1; no claim of independent Windows process/OOM isolation is made. Existing v1 extension/UI/workflow validators and business runtimes remain compatible through explicit adapters; persistent v2 methods use the new runner. The public component/operation catalog is authoritative: proposed names in the design document are not aliases for arbitrary executable code. Windows response-time and memory benchmarks remain hardware measurements, separate from the installer build and browser regressions.

Usage and executable contracts: [local extension guide](extension-platform-guide.md), [UI kit](../../products/liteasy/packages/ui-kit/README.md), [transport SDK](../../products/liteasy/packages/extension-sdk/src/index.ts).
