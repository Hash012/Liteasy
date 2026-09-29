# Liteasy extension SDK v2

This transport-neutral client projects the same named tools used by local MCP and the in-app authoring assistant. It has no React, Tauri, filesystem, account token or database dependency. Configure local MCP in Liteasy settings to let an external AI discover `liteasy_extension_catalog` and these tools. No public website registration is required.

A draft is mutable and revision-checked. A published package is immutable, content-verified, and installed disabled. Local enabling and real workflow resource/model bindings remain host UI actions. Packages cannot self-issue grants. Paths identify resources, not authority.

The normative runtime schemas live in the desktop extension/workflow modules and are exposed by the catalog, together with registered operation input schemas. `liteasy_block_create` and `liteasy_block_update` use the same object repository as the UI and keep content revisions separate from board layout.

Typical flow:

1. Discover catalog and inherited block families; search skills by summary.
2. Create a draft from the paper-comparison scaffold, or provide declarative files.
3. Read and patch using `expectedRevision`; conflicts require a fresh read and merge.
4. Validate, preview in the workbench, and run isolated fixture cases. AI may add tests but cannot weaken existing fixture files.
5. Review file/permission changes; publish a new exact version and enable it in the extension manager.
6. Select resources and model connection for a real run. Inspect actual receipts; recorded replay does not rerun effects.

Supported package files are UTF-8 JSON/Markdown/text/SVG. This release does not execute arbitrary JavaScript, native commands, install scripts or plugin HTML. These require separate Windows process-isolation evidence before activation. Media should use existing resource references and the host image pipeline.

Fixtures use `liteasy.workflow-fixture/v1`, with `workflow`, `input`, `resources`, explicit `modelResponses`, `expectedStatus` and nonempty `assertions`. `fixture://id` resolves only to an isolated development copy. Execution runs through the production graph compiler, operation host, resource repository and run store; fixture results do not assert real-model quality.

Use native `liteasy://` links in Markdown: `[title](liteasy://objects/...?scope=...)`. Never expose internal evidence IDs as a substitute for readable links. Exported packages must not contain account credentials or private paper bodies unless the user deliberately includes them as fixtures.
