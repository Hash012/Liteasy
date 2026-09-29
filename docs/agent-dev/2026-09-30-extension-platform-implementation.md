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
