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
