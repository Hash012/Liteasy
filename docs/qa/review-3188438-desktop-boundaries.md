# R05 / R06 / R07 / R12 Desktop boundary verification

## Scope and candidate

- Review baseline: `3188438c95dfc7f73b5ccf20a05ef69391e646cf`.
- Desktop implementation commits, in order: `269c02fa`, `0195733d`, `6a81e61c`.
- Final Desktop code candidate: `6a81e61c`. Root integration candidate is tracked separately; these results do not replace its final SHA checks.
- Worktree: `Liteasy-review-desktop-boundaries`, branch `feat/review-desktop-boundaries`.
- Environment: Linux x86_64; Node `v22.13.1` through `/home/tjm/.cache/ms-playwright-go/1.50.1` in `PATH`; npm `9.2.0`; Vitest `3.2.4`; JSDOM and fake-indexeddb.
- Dependencies installed independently with `npm ci --ignore-scripts`; no dependency symlink, lockfile change, version change, Rust change, or shared schema change.
- Fixtures are synthetic notes, papers, organization IDs, accounts and transports checked into `src/tests`. No real credentials, production accounts, paid model/search calls, or deployment were used.

All source paths below are relative to `products/liteasy/apps/desktop/`.

## R05: pinned community sources and explicit personal note return

Implementation:

- `src/app/features/forum/communitySourceReference.ts` validates `liteasy://community-sources/{namespace}/{id}?revision=N`, including optional passage/page/anchor locator. Endpoint overrides, duplicate revisions, unsupported namespaces and malformed locators are rejected.
- `src/app/features/forum/forumClient.ts` reads the exact revision through the Desktop-audience endpoint `/v1/integrations/desktop/community-sources/:namespace/:id/revisions/:revision`. The returned identity/version must match. Current actor and endpoint are checked before accepting the response. This depends on Intuecho API commit `220f8d99`; it does not reuse Web credentials.
- `src/app/controllers/useCommunitySourceController.tsx` handles in-app and native deep links, labels historical/current revisions, and offers an explicit personal-reflection form. The saved note contains only the user's reflection, pinned source link and source metadata. It never copies the displayed community body. Confirmed literature metadata remains usable as a normal personal reference.
- A save rechecks current source access. Account changes, closing the dialog and opening another source invalidate pending reads before creation. Rapid repeated saves cannot create duplicate notes. Retry retains the reflection and reuses the same creation operation ID; access loss hides the cached community body while keeping the user's reflection available.
- Organization note returns include portable `sourceNamespace/sourceId/revision/organizationId/sourcePolicy` frontmatter and repository provenance. The mounted-file adapter recognizes the same metadata exported by Web. This is restrictive provenance, not an access grant.

Evidence:

| Scenario | Regression and result |
| --- | --- |
| Namespace, exact revision, page/anchor, endpoint injection | `communitySourceReference.test.ts`: 3 passed; exact authenticated Desktop URL asserted. |
| Read response arrives after actor switch | Client test rejects; controller test hides the late preview. |
| Personal note return | `useCommunitySourceController.test.tsx`: final 8 passed; real object repository contains reflection and revision link, excludes synthetic source body, and blocks external model access for organization provenance. |
| Source access revoked before save | Permission recheck fails; no note is created, remote body disappears, reflection remains and a later explicit retry rechecks permission. |
| Close / switch account / select another source during save | Deferred-response tests create no late note and do not close the next dialog. |
| Repeated save or local storage failure | One in-flight save; storage-failure retry retains text and uses the same operation ID. |
| Existing reference/source snapshot paths | `resourceReferences.test.tsx` 12 passed and `resourceReferenceContext.test.tsx` 4 passed. Source snapshots now retain restrictive provenance. |

A Web → native operating-system deep-link round trip against a real IdP/API is **not_run**. DOM/client tests and API-agent HTTP tests are distinct evidence layers.

## R06: spaces and operation projections

Implementation:

- `src/app/features/spaces/SpaceOperationsPanel.tsx` is a Fluent panel on the personal center's “空间与操作” tab. It shows the actual current account/workspace, local/personal-cloud/organization/public distinctions, and entry points to the existing workspaces.
- `src/app/controllers/useSpaceOperationsController.ts` projects existing PDF publication records, thin-reading publication records and current transfer receipts. It does not add an authoritative operation database, auto-submit, retry a publication or upload a local file.
- `src/app/controllers/useLibraryResourceTransferController.ts` reports the real existing transfer lifecycle. Running uploads are explicitly not assumed readable. Cancellation does not claim remote deletion; ambiguous results require inspecting the existing target. Permission, identity, quota, version and source failures provide recovery instructions.
- Notifications use organization ID plus notification ID; read status explicitly does not imply invitation/authorization/task completion.
- `src/app/layout/FileStatusBar.tsx` labels sync as the current file's state. Membership in an organization no longer labels a local workspace as organization space. Guest reading does not fetch social records or require login.

Evidence:

| Scenario | Regression and result |
| --- | --- |
| Guest can open local reading without social fetch | `SpaceOperationsPanel.test.tsx`: 2 passed. |
| Published / unknown / pending retract / retracted and public-but-not-plaza | `spaceOperations.test.ts`: 2 passed. |
| A → B switch and old transfer callback | `useSpaceOperationsController.test.ts`: 1 passed; old rows/callbacks stay hidden. |
| Actual transfer paths still work | `useLibraryResourceTransferController.test.ts`: 36 passed. |
| Notification read vs completion, real recovery callback | Panel test checks labels and calls the original destination action. |
| Composition and current-file labels | `AppShell.test.tsx` 10 passed, `LeftPane.test.tsx` 28 passed, `workspaceShell.test.tsx` 8 passed. |

Transfer rows are bounded, in-memory projections for the current window/session. Existing publication records can be refreshed from their domain storage. This panel is not a durable replacement for domain receipts, an upload scanner UI, or evidence of actual S3/scanner behavior. Native simultaneous-window and production upload-fault exercises are **not_run**.

## R07: authority-derived exception wording

`OrganizationAccessDetails.tsx` shows the owner-export exception only when both the authoritative exception and `export_original` permission are present. Its text limits the exception to original-file export, and explicitly grants neither public publication nor external AI use. Duplicate organization names are disambiguated with IDs without inventing roles or policies.

`OrganizationPresentation.test.tsx` has 3 passing tests, including duplicate-name selection and the narrow exception. `organizationAccessPresentation.test.tsx` has 6 passing tests. The former exact-text assertion was updated to assert the complete, more restrictive wording. Liteasy authority/service and real PostgreSQL policy tests belong to the root integration evidence, not this Desktop evidence.

## R12: actual tools, provenance and approvals

Actual tool inventory and boundaries:

| Entry | Implemented behavior |
| --- | --- |
| Agent API / CLI / Agent MCP | Session, turn, confirmation, run-read and cancellation operations exist. `networkMode: local-only` / CLI `--local-only` is enforced in the Desktop service before model/context work, and semantic execution allows only local layout/pane/panel/dock/theme actions. |
| Cloud upload/sync and document bulk/delete/overwrite capability placeholders | Discovery returns an explicit unavailable reason. They are excluded from the executable model catalog; no fake upload/share/invitation tool was added. |
| Local asset MCP | Existing search/stat/read/image/create/write and paper import tools remain. All external asset reads now pass through the same source policy as built-in AI; ordinary local notes/files remain readable and editable. Native MCP opt-in is revoked on account **or session generation** change. |
| Extension studio MCP / manager tools | Existing block read/update, workflow requests/runs/replay, board templates and draft authoring tools remain. Selected paths, run source grants and draft source paths are checked before returning source-bearing material to external callers. A workflow request still opens the existing host approval dialog. It is not a successful execution receipt. |
| Publication / invitation / secret retrieval | No such standalone action is exposed by the current Agent asset/manager catalog. A synthetic source-body injection requesting these actions does not create new tools or permission. Real publication/invitation UIs retain their separate authority paths. |

The locally hosted **asset MCP** is not advertised as an offline mode: its existing explicit paper-import tool can access public network resources when enabled. The `local-only` contract and no-network regression cover **Agent turns through CLI and Agent MCP**. This distinction must not be collapsed into a claim that all localhost MCP operations are offline.

Provenance implementation:

- `objects/objectSourceLineage.ts` and compact repository indexes retain source refs, derived-from refs and paper anchors through notes/copies/restoration; missing/unverifiable lineage fails closed only at the external-service boundary. Native reading remains available.
- Existing source metadata is stored atomically in the existing object repository alongside source creation. It is not a new permission authority or policy database.
- Workflow create/write/board composition attach the host-resolved selected source refs to derived outputs. External model nodes check selected sources and derived output paths.
- Mounted note writes cannot remove/change the original source identity/revision or downgrade unresolved metadata. Malformed community-source frontmatter is unavailable rather than ordinary local content. Ordinary independent Markdown files still support revision-checked MCP writes.
- Source-bound board/run drafts retain source paths. Old drafts lacking provenance remain locally accessible; sending them to external models requires rebuilding after source review. This conservative compatibility behavior does not block ordinary local files.

Approvals and logs:

- Agent confirmations retain an immutable action/payload, owning Agent session, five-minute expiry and actor/environment binding. AppShell supplies the existing publication actor binding (endpoint/issuer/subject/scope/generation); the Desktop service also binds the current cloud proxy endpoint. Exact action inputs, not just action names, must match approval.
- Workflow grants retain extension owner/digest, account scope, selected paths, output kinds and model connection, with a thirty-minute expiry and login-session generation. Expired or prior-session grants require a new explicit binding. This does not authorize a new D01–D08 policy.
- Generic runtime input journal records no longer include raw user message bodies. Scoped conversation history remains an intentional application record; this change does not claim a repository-wide logging audit.

Failure reproduction and regression:

| Reproduced failure / checked boundary | Result |
| --- | --- |
| Copied derived note lost organization source outside its project | Red: source references were absent. Green: `assetSourceReferences.test.ts` retains transitive lineage, fails external use after source loss, and allows native reads/local standalone notes. |
| `local-only` turn still called model | Red: two model calls. Green: `workspaceAgentSafety.test.ts` has 13 passing tests, including actual CLI + Agent MCP adapters reaching the Desktop service with zero model/read/write calls. |
| Unimplemented cloud capabilities lacked a reason | Red: capability fields absent. Green: explicit unavailable result and filtered executable catalog. |
| Raw asset MCP returned organization-derived body | Red: no tool error. Green: `localAssetMcp.test.ts` final 11 passed, including read/stat/image restrictions and ordinary local Markdown writes. |
| Raw mounted-file write removed organization frontmatter | Red: write resolved with unrestricted revision v2. Green: removal, changed organization and changed source revision are rejected before disk write; malformed metadata stays blocked. |
| Workflow output / replay / structured block / draft escape | `assetSourceReferences.test.ts` 4 passed; `extensionStudio.test.ts` 4 passed; direct local replay remains usable, external MCP receives no synthetic private body. |
| Old-session/expired approval and wrong Agent session | `agentApplicationService.test.ts` 9 passed; existing cross-session ownership assertion retained. |
| Same-subject issuer/forum/cloud endpoint change without generation change | `createDesktopAgentService.test.ts` 10 passed, including three new endpoint/issuer negative cases. |
| Workflow grant expiry/session invalidation | `durableWorkflows.test.ts` 11 passed. |
| Native MCP bridge current generation and revocation | `useLocalAssetMcp.test.ts` 4 passed with mocked Tauri transport. No real native client was launched. |
| Existing resource workflows | `agentAssetService.test.ts` 16, `paperProjects.test.ts` 8, `paperProjectsController.test.tsx` 6, `agentRuntimePlanExecutor.test.ts` 16 and `agentApiAdapters.test.ts` 5 passed. |

## Commands and evidence limits

Commands ran from `products/liteasy/apps/desktop` with the Node path above:

- `npx vitest run <the named src/tests suites>`: passing results in the tables are cumulative targeted regression evidence. The root performs the single final-SHA full Desktop run; this document does not claim that a full suite was run here.
- Final affected suites: `npx vitest run src/tests/localAssetMcp.test.ts src/tests/useCommunitySourceController.test.tsx` → **19 passed**, exit 0; final file contents match `6a81e61c`.
- `npm run ci:smoke` → **9 passed**, exit 0 on final code.
- `npm run build` → exit 0 on final code; 158 production files verified. Existing Vite dynamic-import/chunk-size warnings remain. Final build log was local `/tmp/liteasy-desktop-boundaries-build.log`, not a tracked production artifact.
- `npm run ci:contracts` → exit 0 on clean `0195733d`, before the final narrow five-file fix. Final-SHA contracts are delegated to the root integration run, per coordination; do not relabel the earlier result as testing `6a81e61c` or root HEAD.
- `git diff --check` → exit 0 before commits. Locks/generated shared schemas did not drift.

**not_run:** Windows/macOS native host execution, Installer CI, actual external MCP client/STDIO egress capture, native system deep-link delivery, real multi-window session switches, real IdP revocation, real browser→Desktop handoff against deployed APIs, production S3/scanner fault injection, live paid model behavior and production rollout. No production acceptance or deployment approval is implied.

## Compatibility and rollback

No new schema version, migration, dependency, role, invitation policy, public-sharing policy or payment policy is introduced. Existing object schema data stays readable; new provenance lives in existing repository metadata and source refs. Existing legacy indexes fall back to their stored object when reconstructing lineage. Old confirmations/grants without trustworthy expiry/session data are intentionally not silently reapproved.

A rollback that restores the old external read/write paths can reintroduce the reproduced provenance bypass. Prefer a forward correction or disable the affected external tool entry while keeping local reading available. Preserve object revisions, source metadata, source refs, drafts and operation receipts; do not delete them to recover compatibility. Existing committed local writes remain writes even when their later UI refresh or account callback is cancelled. The new space view only projects state and can be removed without rewriting the underlying upload/publication/notification records.
