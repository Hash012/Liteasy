# Artifact Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated artifact library where users can reopen account-saved artifacts and manage device-local export history backed by native Save As, open, and reveal actions.

**Architecture:** Keep account artifacts in the existing artifact workflow controller and expose an explicit catalog load state plus retry action. Add a device-scoped Tauri export repository behind a typed frontend client/controller, then compose both data sources in a new `ArtifactLibraryPane`; the pane opens saved content in the existing center artifact surface and never duplicates artifact bodies.

**Tech Stack:** React 18, TypeScript 5, Fluent UI React Components/Icons, Vitest/Testing Library, Tauri 2, Rust/Serde, `rfd` native dialogs.

## Global Constraints

- Preserve the repository dependency direction `layout -> controllers -> features -> shared types / clients`; feature modules must not import `layout` or `AppShell`.
- Use two-space TypeScript indentation, double quotes, semicolons, PascalCase components, and Fluent UI components/icons.
- Preserve the existing `FluentProvider`, Activity Bar, Dock tokens, 4-8px radii, light borders, and restrained shadows.
- Every icon-only action must have an accessible name and Fluent Tooltip; file state must be expressed in text, not color alone.
- Keep the existing account artifact API contract unchanged and do not describe development readiness as production validation.
- Device export records are not account-scoped and must never contain access tokens, paper bodies, or full artifact documents.
- Removing an export record must never delete the exported file.
- Desktop export must use native Save As and must not silently fall back to an untracked WebView download.
- Preserve unrelated uncommitted thin-reading and visualization changes already present in the workspace.

---

## File Map

**Create**

- `products/liteasy/apps/desktop/src-tauri/src/artifact_export.rs` - native export file writing, history persistence, path validation, open, and reveal commands.
- `products/liteasy/apps/desktop/src/app/features/artifacts/artifactExport.types.ts` - export record, payload, and result contracts.
- `products/liteasy/apps/desktop/src/app/features/artifacts/artifactExportClient.ts` - Tauri IPC transport plus browser download/history fallback.
- `products/liteasy/apps/desktop/src/app/controllers/useArtifactExportController.ts` - export history state and cross-feature orchestration.
- `products/liteasy/apps/desktop/src/app/features/artifacts/ArtifactLibraryPane.tsx` - saved/exported tabs and row actions.
- `products/liteasy/apps/desktop/src/app/features/artifacts/artifactLibrary.css` - compact responsive pane styling.
- `products/liteasy/apps/desktop/src/tests/artifactExportClient.test.ts` - frontend transport and browser fallback tests.
- `products/liteasy/apps/desktop/src/tests/useArtifactExportController.test.ts` - controller state transition tests.
- `products/liteasy/apps/desktop/src/tests/ArtifactLibraryPane.test.tsx` - pane states, search, and actions.
- `products/liteasy/apps/desktop/src/tests/fixtures/artifactExportBrowserFixture.tsx` - deterministic browser export surface used only in Vite development mode.
- `products/liteasy/apps/desktop/src/tests/fixtures/artifactLibraryBrowserFixture.tsx` - deterministic artifact-library visual fixture used only in Vite development mode.
- `products/liteasy/apps/desktop/src/tests/browser/artifactLibrary.browser.spec.ts` - desktop/narrow visual and interaction coverage.

**Modify**

- `products/liteasy/apps/desktop/src-tauri/Cargo.toml` - add `base64` and `rfd`.
- `products/liteasy/apps/desktop/src-tauri/Cargo.lock` - lock the new Rust dependencies.
- `products/liteasy/apps/desktop/src-tauri/src/main.rs` - register export commands.
- `products/liteasy/apps/desktop/src/app/controllers/useArtifactWorkflowController.ts` - catalog load state and retry.
- `products/liteasy/apps/desktop/src/app/features/artifacts/artifact.types.ts` - shared catalog load-state contract.
- `products/liteasy/apps/desktop/src/app/features/artifacts/artifactDocumentExport.ts` - separate content creation from output transport.
- `products/liteasy/apps/desktop/src/app/features/artifacts/ArtifactExportMenu.tsx` - call injected export action and report cancelled/saved outcomes.
- `products/liteasy/apps/desktop/src/app/features/artifacts/ArtifactTabs.tsx` - forward export action.
- `products/liteasy/apps/desktop/src/app/layout/useLeftRailNavigation.ts` - add the `artifact-library` view.
- `products/liteasy/apps/desktop/src/app/layout/ActivityBar.tsx` - add the Fluent artifact-library icon.
- `products/liteasy/apps/desktop/src/app/features/dock/dock.types.ts` - add the distinct left-rail Dock ID.
- `products/liteasy/apps/desktop/src/app/features/dock/dockRegistry.ts` - register its allowed regions and title.
- `products/liteasy/apps/desktop/src/app/layout/LeftPane.tsx` - compose `ArtifactLibraryPane`.
- `products/liteasy/apps/desktop/src/app/layout/AppShell.tsx` - create controllers and connect open/export actions.
- `products/liteasy/apps/desktop/src/App.tsx` - expose test fixtures only when `import.meta.env.DEV` and an explicit query flag are both present.
- `products/liteasy/apps/desktop/src/tests/useArtifactWorkflowController.test.ts`
- `products/liteasy/apps/desktop/src/tests/artifactDocumentExport.test.ts`
- `products/liteasy/apps/desktop/src/tests/ActivityBar.test.tsx`
- `products/liteasy/apps/desktop/src/tests/useLeftRailNavigation.test.ts`
- `products/liteasy/apps/desktop/src/tests/dockLayout.test.ts`
- `products/liteasy/apps/desktop/src/tests/LeftPane.test.tsx`
- `products/liteasy/apps/desktop/src/tests/ArtifactTabs.test.tsx`
- `products/liteasy/apps/desktop/src/tests/AppShell.test.tsx`
- `products/liteasy/apps/desktop/src/tests/layoutStyleContract.test.ts`
- `products/liteasy/apps/desktop/src/tests/browser/artifactExport.browser.spec.ts`

---

### Task 1: Expose Account Artifact Catalog State and Retry

**Files:**

- Modify: `products/liteasy/apps/desktop/src/app/controllers/useArtifactWorkflowController.ts:78-103,131-273,275-316`
- Modify: `products/liteasy/apps/desktop/src/app/features/artifacts/artifact.types.ts`
- Test: `products/liteasy/apps/desktop/src/tests/useArtifactWorkflowController.test.ts`

**Interfaces:**

- Produces in `artifact.types.ts`: `ArtifactCatalogLoadState = { status: "idle" | "loading" | "ready" | "error"; message?: string }`
- Produces: `model.artifactCatalogLoadState`
- Produces: `actions.reloadArtifactCatalog(): Promise<void>`
- Preserves: existing artifact task recovery, local fallback repository, and account-scope clearing.

- [ ] **Step 1: Write a failing test for a successful account catalog load**

Add a test that renders the controller with `artifactResultScopeKey: "endpoint:user-1"`, holds `client.list()` pending, asserts `loading`, resolves one persisted artifact, and then asserts `ready` plus the restored catalog entry.

```ts
expect(result.current.model.artifactCatalogLoadState).toEqual({ status: "loading" });
resolveList([persisted]);
await act(async () => Promise.resolve());
expect(result.current.model.artifactCatalogLoadState).toEqual({ status: "ready" });
expect(result.current.model.artifactCatalog).toEqual([
  expect.objectContaining({ artifactId: persisted.artifactId })
]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- src/tests/useArtifactWorkflowController.test.ts
```

Expected: FAIL because `artifactCatalogLoadState` does not exist.

- [ ] **Step 3: Write a failing error-and-retry test**

Make `client.list()` reject once and resolve on its second call. Assert an `error` state with a user-facing message, call `reloadArtifactCatalog()`, then assert `ready` and two calls to `list()`.

```ts
expect(result.current.model.artifactCatalogLoadState).toEqual({
  message: "network unavailable",
  status: "error"
});
await act(async () => result.current.actions.reloadArtifactCatalog());
expect(client.list).toHaveBeenCalledTimes(2);
expect(result.current.model.artifactCatalogLoadState.status).toBe("ready");
```

- [ ] **Step 4: Implement the minimal catalog loader**

Add the shared type to `artifact.types.ts`, import it into the controller, and add a request counter that prevents a late response from an old account overwriting the current account:

```ts
export type ArtifactCatalogLoadState = {
  message?: string;
  status: "error" | "idle" | "loading" | "ready";
};

const [artifactCatalogLoadState, setArtifactCatalogLoadState] =
  useState<ArtifactCatalogLoadState>({ status: "idle" });
const catalogRequestRef = useRef(0);

async function reloadArtifactCatalog() {
  const requestId = ++catalogRequestRef.current;
  setArtifactCatalogLoadState({ status: "loading" });
  artifactStore.clearAccountArtifacts();
  artifactActions.syncArtifacts();
  try {
    const results = artifactResultScopeKey
      ? await artifactResultClientRef.current.list()
      : await localRepositoryRef.current?.list() ?? [];
    if (requestId !== catalogRequestRef.current) return;
    results.forEach((result) => {
      if (artifactResultScopeKey) artifactActions.restoreArtifactResult(result);
      else artifactStore.upsertCatalogEntry(result);
    });
    artifactActions.syncArtifacts();
    setArtifactCatalogLoadState({ status: "ready" });
  } catch (error) {
    if (requestId !== catalogRequestRef.current) return;
    const message = error instanceof Error ? error.message : String(error);
    setArtifactCatalogLoadState({ message, status: "error" });
    onAnalysisHint(`同步 Agent 产物服务失败：${message}`);
  }
}
```

Keep interrupted-task restoration in the account-scope effect, but do not repeat it when the user merely retries the catalog request.

- [ ] **Step 5: Run the controller tests and verify GREEN**

Run:

```bash
npm test -- src/tests/useArtifactWorkflowController.test.ts
```

Expected: PASS with no warnings.

- [ ] **Step 6: Commit Task 1**

```bash
git add products/liteasy/apps/desktop/src/app/controllers/useArtifactWorkflowController.ts products/liteasy/apps/desktop/src/app/features/artifacts/artifact.types.ts products/liteasy/apps/desktop/src/tests/useArtifactWorkflowController.test.ts
git commit -m "feat: expose artifact catalog load state"
```

---

### Task 2: Add the Native Export History Repository

**Files:**

- Create: `products/liteasy/apps/desktop/src-tauri/src/artifact_export.rs`
- Modify: `products/liteasy/apps/desktop/src-tauri/Cargo.toml`
- Modify: `products/liteasy/apps/desktop/src-tauri/src/main.rs`

**Interfaces:**

- Consumes IPC input `ArtifactExportInput { artifactId, title, fileName, format, contentEncoding, content }`.
- Produces commands:
  - `export_artifact_document(input) -> { status: "cancelled" } | { status: "saved", record }`
  - `list_artifact_exports() -> ArtifactExportRecord[]`
  - `open_artifact_export(record_id) -> ArtifactExportRecord`
  - `reveal_artifact_export(record_id) -> ArtifactExportRecord`
  - `remove_artifact_export(record_id) -> ()`
- Guarantees open/reveal look up paths by record ID; frontend callers never supply arbitrary paths.

- [ ] **Step 1: Add Rust tests for versioned persistence and sorting**

In `artifact_export.rs`, define pure path-based helpers and tests before commands:

```rust
#[test]
fn saves_and_lists_newest_exports_first() {
    let root = temporary_directory("sorted");
    save_snapshot_at(&root, &snapshot(vec![record("older", 1), record("newer", 2)]))
        .expect("save snapshot");
    let records = list_records_at(&root).expect("list records");
    assert_eq!(records[0].id, "newer");
    assert_eq!(records[1].id, "older");
}
```

Add tests for:

- `status` changes from `available` to `missing` when the file is removed;
- removing a record leaves the exported file intact;
- a malformed snapshot is renamed to a `.corrupt-*` sibling and returns a recoverable error;
- a record ID that is absent cannot open/reveal an arbitrary caller path.

- [ ] **Step 2: Run the Rust test and verify RED**

Run:

```bash
cd products/liteasy/apps/desktop/src-tauri
cargo test artifact_export
```

Expected: FAIL because the module/helpers do not exist.

- [ ] **Step 3: Add exact Rust data contracts and atomic repository helpers**

Use Serde camelCase at IPC boundaries and a fixed snapshot version:

```rust
const EXPORT_HISTORY_VERSION: &str = "liteasy.artifact-export-history/v1";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactExportRecord {
    artifact_id: String,
    exported_at: String,
    file_name: String,
    format: ArtifactExportFormat,
    id: String,
    location: String,
    path: PathBuf,
    status: ArtifactExportStatus,
    title: String,
}

#[derive(Deserialize, Serialize)]
struct ArtifactExportSnapshot {
    records: Vec<ArtifactExportRecord>,
    version: String,
}
```

Store `artifact-exports/history.v1.json` under `app.path().app_data_dir()`. Write with `create_new`, `sync_all`, and rename, using the existing `artifact_catalog_state.rs` approach. Limit history to 2 MiB and cap text fields before persistence.

- [ ] **Step 4: Implement native Save As and content decoding**

Add dependencies:

```toml
base64 = "0.22"
rfd = "0.15"
```

Accept `contentEncoding` as `utf8` or `base64`, decode before opening the dialog, and use `rfd::FileDialog` with the exact requested extension. Return `cancelled` without side effects when the dialog returns `None`. After a successful `fs::write`, append a record with an ID derived from nanosecond time plus the current process ID.

```rust
let selected = FileDialog::new()
    .add_filter(input.format.label(), &[input.format.extension()])
    .set_file_name(&input.file_name)
    .save_file();
let Some(path) = selected else {
    return Ok(ArtifactExportOutcome::Cancelled { status: "cancelled".into() });
};
```

If file writing succeeds but history persistence fails, return an error containing the saved absolute path and the phrase `文件已保存，但未写入导出历史`.

- [ ] **Step 5: Implement checked open, reveal, and record removal commands**

Resolve every action by `record_id` from the repository, check `path.is_file()`, and mark missing records before returning an error. Use OS-specific `std::process::Command` calls:

- Windows open: `explorer <path>`; reveal: `explorer /select,<path>`.
- macOS open: `open <path>`; reveal: `open -R <path>`.
- Linux open: `xdg-open <path>`; reveal: `xdg-open <parent>`.

Do not expose any command that deletes the file.

- [ ] **Step 6: Register commands and verify GREEN**

Add `mod artifact_export;` and register all five commands in `main.rs`, then run:

```bash
cargo fmt --check
cargo test artifact_export
```

Expected: PASS; removing a history entry leaves its fixture file present.

- [ ] **Step 7: Commit Task 2**

```bash
git add products/liteasy/apps/desktop/src-tauri/Cargo.toml products/liteasy/apps/desktop/src-tauri/Cargo.lock products/liteasy/apps/desktop/src-tauri/src/artifact_export.rs products/liteasy/apps/desktop/src-tauri/src/main.rs
git commit -m "feat: persist desktop artifact exports"
```

---

### Task 3: Add the Typed Export Client and Controller

**Files:**

- Create: `products/liteasy/apps/desktop/src/app/features/artifacts/artifactExport.types.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/artifacts/artifactExportClient.ts`
- Create: `products/liteasy/apps/desktop/src/app/controllers/useArtifactExportController.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/artifacts/artifactDocumentExport.ts:1-3,212-223,399-411`
- Test: `products/liteasy/apps/desktop/src/tests/artifactDocumentExport.test.ts`
- Create: `products/liteasy/apps/desktop/src/tests/artifactExportClient.test.ts`
- Create: `products/liteasy/apps/desktop/src/tests/useArtifactExportController.test.ts`

**Interfaces:**

- Produces discriminated `ArtifactExportRecord` exactly matching the approved design.
- Produces `createArtifactExportPayload(tab, format)` with a safe filename and UTF-8/base64 content.
- Produces `ArtifactExportClient` methods `export`, `list`, `open`, `reveal`, and `remove`.
- Produces controller model `{ error, records, status }` and actions `{ exportArtifact, openExport, refresh, removeExport, revealExport }`.

- [ ] **Step 1: Write failing payload tests**

Extend `artifactDocumentExport.test.ts`:

```ts
test("creates a native payload without triggering a browser download", () => {
  const payload = createArtifactExportPayload(createTab("thin_reading"), "markdown");
  expect(payload).toEqual(expect.objectContaining({
    contentEncoding: "utf8",
    fileName: "thin_reading 导出样例.md",
    format: "markdown"
  }));
  expect(payload.content).toContain("Agent 分析");
});
```

Add a PDF assertion that `contentEncoding` is `base64` and decoded bytes start with `%PDF-1.7`.

- [ ] **Step 2: Run payload tests and verify RED**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- src/tests/artifactDocumentExport.test.ts
```

Expected: FAIL because `createArtifactExportPayload` is not exported.

- [ ] **Step 3: Separate content creation from browser download**

Replace direct transport in `exportArtifactDocument` with:

```ts
export type ArtifactExportPayload = {
  artifactId: string;
  content: string;
  contentEncoding: "base64" | "utf8";
  fileName: string;
  format: ArtifactDocumentFormat;
  title: string;
};

export function createArtifactExportPayload(
  tab: ArtifactTab,
  format: ArtifactDocumentFormat
): ArtifactExportPayload;

export function downloadArtifactPayload(payload: ArtifactExportPayload): void;
```

Encode PDF bytes in bounded chunks so large documents do not overflow the call stack. Keep the existing content-generation functions unchanged.

- [ ] **Step 4: Write failing Tauri and browser client tests**

Inject an `invoke` transport and browser downloader/storage so tests do not depend on global Tauri state:

```ts
const client = createArtifactExportClient({ invoke });
await client.export(payload);
expect(invoke).toHaveBeenCalledWith("export_artifact_document", { input: payload });
```

Browser tests must assert:

- a download is triggered;
- a `location: "browser"`, `status: "browser_managed"` record is written without `path`;
- `open` and `reveal` reject with `该导出由浏览器管理`;
- removing a browser record changes history only.

- [ ] **Step 5: Implement client contracts and browser fallback**

Use the approved discriminated union:

```ts
export type ArtifactExportRecord = {
  artifactId: string;
  exportedAt: string;
  fileName: string;
  format: ArtifactDocumentFormat;
  id: string;
  title: string;
} & (
  | { location: "desktop"; path: string; status: "available" | "missing" }
  | { location: "browser"; status: "browser_managed" }
);
```

Detect Tauri using `window.__TAURI_INTERNALS__?.invoke`. Persist browser-only records under `liteasy.artifact-export-history.browser.v1`; validate parsed records and cap the list at 200 entries.

- [ ] **Step 6: Write failing controller state tests**

Cover initial loading, successful export insertion, cancelled export, missing-file error refresh, and record removal:

```ts
await act(async () => {
  const result = await hook.result.current.actions.exportArtifact(tab, "markdown");
  expect(result.status).toBe("saved");
});
expect(hook.result.current.model.records[0].fileName).toBe("薄读.md");
```

- [ ] **Step 7: Implement `useArtifactExportController` and verify GREEN**

The controller owns asynchronous state and always refreshes after saved/open/reveal failures that may change availability. Cancellation leaves records and error unchanged.

Run:

```bash
npm test -- src/tests/artifactDocumentExport.test.ts src/tests/artifactExportClient.test.ts src/tests/useArtifactExportController.test.ts
```

Expected: PASS with no unhandled promise warnings.

- [ ] **Step 8: Commit Task 3**

```bash
git add products/liteasy/apps/desktop/src/app/features/artifacts/artifactExport.types.ts products/liteasy/apps/desktop/src/app/features/artifacts/artifactExportClient.ts products/liteasy/apps/desktop/src/app/features/artifacts/artifactDocumentExport.ts products/liteasy/apps/desktop/src/app/controllers/useArtifactExportController.ts products/liteasy/apps/desktop/src/tests/artifactDocumentExport.test.ts products/liteasy/apps/desktop/src/tests/artifactExportClient.test.ts products/liteasy/apps/desktop/src/tests/useArtifactExportController.test.ts
git commit -m "feat: orchestrate artifact export history"
```

---

### Task 4: Build the Artifact Library Pane

**Files:**

- Create: `products/liteasy/apps/desktop/src/app/features/artifacts/ArtifactLibraryPane.tsx`
- Create: `products/liteasy/apps/desktop/src/app/features/artifacts/artifactLibrary.css`
- Create: `products/liteasy/apps/desktop/src/tests/ArtifactLibraryPane.test.tsx`

**Interfaces:**

- Consumes: `ArtifactTab[]`, `ArtifactCatalogLoadState`, `ArtifactExportRecord[]`, account availability, and callback actions.
- Produces: a compact left-rail surface with accessible `已保存` and `已导出` tabs.
- Does not import controllers, layout modules, or `AppShell`.

- [ ] **Step 1: Write failing saved-list state tests**

Test these states separately:

- unauthenticated shows `登录后查看账号中保存的产物` and no artifact rows;
- loading renders an accessible progress indicator;
- error renders the exact message and a `重试` button;
- ready empty renders `暂无已保存产物`;
- ready list filters by artifact title, type label, and source-paper title.

```ts
await user.type(screen.getByRole("searchbox", { name: "搜索产物" }), "Attention");
expect(screen.getByRole("button", { name: /打开产物：薄读/ })).toBeInTheDocument();
expect(screen.queryByText("Other Paper Map")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run component tests and verify RED**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- src/tests/ArtifactLibraryPane.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement saved artifacts with Fluent controls**

Use `TabList`, `Tab`, `Input`, `Menu`, `MenuItem`, `Button`, `Tooltip`, and Fluent icons. Rows are unframed list items, not nested cards. Clicking the main row calls `onOpenArtifact(id)`.

Use a Fluent dialog with an input for rename and a Fluent confirmation dialog for delete. Do not use native `prompt` or `confirm`.

- [ ] **Step 4: Write failing exported-list action tests**

Assert available desktop records expose icon buttons named:

- `打开文件：<fileName>`
- `在文件夹中显示：<fileName>`
- `移除导出记录：<fileName>`

Assert missing records show `文件不可用` and disable open/reveal. Assert browser records show `由浏览器管理` and omit path-based actions.

- [ ] **Step 5: Implement exported rows and responsive CSS**

Use stable list tracks and overflow-safe text:

```css
.artifact-library-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  min-width: 0;
}

.artifact-library-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Keep radii at 8px or less, avoid page-section cards, and use neutral surfaces with distinct status text.

- [ ] **Step 6: Verify component tests and accessibility**

Run:

```bash
npm test -- src/tests/ArtifactLibraryPane.test.tsx
```

Expected: PASS; every icon-only action is discoverable by accessible name and Tooltip.

- [ ] **Step 7: Commit Task 4**

```bash
git add products/liteasy/apps/desktop/src/app/features/artifacts/ArtifactLibraryPane.tsx products/liteasy/apps/desktop/src/app/features/artifacts/artifactLibrary.css products/liteasy/apps/desktop/src/tests/ArtifactLibraryPane.test.tsx
git commit -m "feat: add artifact library pane"
```

---

### Task 5: Connect Navigation, Docking, Saved Actions, and Export Actions

**Files:**

- Modify: `products/liteasy/apps/desktop/src/app/layout/useLeftRailNavigation.ts`
- Modify: `products/liteasy/apps/desktop/src/app/layout/ActivityBar.tsx`
- Modify: `products/liteasy/apps/desktop/src/app/features/dock/dock.types.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/dock/dockRegistry.ts`
- Modify: `products/liteasy/apps/desktop/src/app/layout/LeftPane.tsx`
- Modify: `products/liteasy/apps/desktop/src/app/layout/AppShell.tsx`
- Modify: `products/liteasy/apps/desktop/src/app/features/artifacts/ArtifactExportMenu.tsx`
- Modify: `products/liteasy/apps/desktop/src/app/features/artifacts/ArtifactTabs.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/ActivityBar.test.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/useLeftRailNavigation.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/dockLayout.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/LeftPane.test.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/ArtifactTabs.test.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/AppShell.test.tsx`

**Interfaces:**

- Produces distinct navigation/Dock ID `artifact-library`; existing center Dock ID `artifacts` remains unchanged.
- `ArtifactTabs` consumes `onExportArtifact(tab, format)` and passes it to `ArtifactExportMenu`.
- `LeftPane` consumes saved/exported models and callbacks without constructing controllers.

- [ ] **Step 1: Write failing navigation and Dock tests**

Extend existing tests to assert:

```ts
expect(screen.getByRole("button", { name: "产物库" })).toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "产物库" }));
expect(onSelectView).toHaveBeenCalledWith("artifact-library");
```

Add `openArtifactLibrary()` coverage to `useLeftRailNavigation.test.ts`, and assert `openDockItem(layout, "artifact-library")` opens in `left`. Keep the separate `artifacts` center item behavior unchanged.

- [ ] **Step 2: Run navigation tests and verify RED**

Run:

```bash
npm test -- src/tests/ActivityBar.test.tsx src/tests/useLeftRailNavigation.test.ts src/tests/dockLayout.test.ts
```

Expected: FAIL because `artifact-library` is not a valid view/Dock item.

- [ ] **Step 3: Add the left-rail entry**

Update the unions and registry:

```ts
export type LeftRailView =
  | "artifact-library"
  | "library"
  | "organization"
  | "profile"
  | "settings";
```

Use a Fluent document-folder/library icon in `ActivityBar`, title `产物库`, preferred region `left`, and `sideToolRegions` as allowed regions.

- [ ] **Step 4: Write failing `LeftPane` composition tests**

Render `leftRailView="artifact-library"` with one saved and one exported record. Assert the pane header, tabs, and rows appear and that callbacks are forwarded.

- [ ] **Step 5: Compose `ArtifactLibraryPane` in `LeftPane`**

Add explicit props for account availability, catalog/load state, export controller model, and actions. Insert the artifact-library branch before organization/profile/settings/library rendering. Keep `LeftPane` as composition only.

- [ ] **Step 6: Write failing export menu outcome tests**

Inject `onExportArtifact` into `ArtifactTabs` and assert:

- `cancelled` leaves the live message empty;
- desktop `saved` shows `已导出到 <path>`;
- browser `saved` shows `文档已导出，由浏览器下载设置管理。`;
- rejected exports show the provided error.

- [ ] **Step 7: Wire the export controller through `ArtifactTabs`**

Change `ArtifactExportMenu` to call the injected callback:

```ts
type ArtifactExportMenuProps = {
  onExport: (
    tab: ArtifactTab,
    format: ArtifactDocumentFormat
  ) => Promise<ArtifactExportOutcome>;
  tab: ArtifactTab;
};
```

Do not import a controller from the feature component. Preserve the menu format choices and icons.

- [ ] **Step 8: Compose both controllers in `AppShell`**

Create the export client once with `useRef`, call `useArtifactExportController`, and pass its model/actions to `LeftPane` and `ArtifactTabs`.

For saved artifacts:

```ts
onOpenArtifact={(artifactId) => {
  artifactWorkflow.actions.openArtifact(artifactId);
  activateArtifactSurface(artifactId);
}}
```

Forward rename/delete/retry. When deleting an open artifact, reuse `selectFallbackArtifact` after the controller succeeds. Account switching must affect only the workflow catalog; export records remain device-scoped.

- [ ] **Step 9: Run integration-focused tests and verify GREEN**

Run:

```bash
npm test -- src/tests/ActivityBar.test.tsx src/tests/useLeftRailNavigation.test.ts src/tests/dockLayout.test.ts src/tests/LeftPane.test.tsx src/tests/ArtifactTabs.test.tsx src/tests/AppShell.test.tsx
```

Expected: PASS with no accessible-name collisions between `artifact-library` and center `artifacts`.

- [ ] **Step 10: Commit Task 5**

```bash
git add products/liteasy/apps/desktop/src/app/layout/useLeftRailNavigation.ts products/liteasy/apps/desktop/src/app/layout/ActivityBar.tsx products/liteasy/apps/desktop/src/app/features/dock/dock.types.ts products/liteasy/apps/desktop/src/app/features/dock/dockRegistry.ts products/liteasy/apps/desktop/src/app/layout/LeftPane.tsx products/liteasy/apps/desktop/src/app/layout/AppShell.tsx products/liteasy/apps/desktop/src/app/features/artifacts/ArtifactExportMenu.tsx products/liteasy/apps/desktop/src/app/features/artifacts/ArtifactTabs.tsx products/liteasy/apps/desktop/src/tests/ActivityBar.test.tsx products/liteasy/apps/desktop/src/tests/useLeftRailNavigation.test.ts products/liteasy/apps/desktop/src/tests/dockLayout.test.ts products/liteasy/apps/desktop/src/tests/LeftPane.test.tsx products/liteasy/apps/desktop/src/tests/ArtifactTabs.test.tsx products/liteasy/apps/desktop/src/tests/AppShell.test.tsx
git commit -m "feat: connect the artifact library"
```

---

### Task 6: Browser Regression, Full Verification, and Visual Inspection

**Files:**

- Modify: `products/liteasy/apps/desktop/src/App.tsx`
- Create: `products/liteasy/apps/desktop/src/tests/fixtures/artifactExportBrowserFixture.tsx`
- Create: `products/liteasy/apps/desktop/src/tests/fixtures/artifactLibraryBrowserFixture.tsx`
- Modify: `products/liteasy/apps/desktop/src/tests/browser/artifactExport.browser.spec.ts`
- Create: `products/liteasy/apps/desktop/src/tests/browser/artifactLibrary.browser.spec.ts`
- Test: `products/liteasy/apps/desktop/src/tests/layoutStyleContract.test.ts`

**Interfaces:**

- Confirms browser fallback still downloads valid Markdown/HTML/PDF.
- Confirms the independent artifact library remains readable at desktop and narrow widths.

- [ ] **Step 1: Run the existing browser export test and verify the fixture failure**

Run:

```bash
cd products/liteasy/apps/desktop
npx playwright test src/tests/browser/artifactExport.browser.spec.ts
```

Expected: FAIL because `/?artifact-export-fixture` currently renders `AppShell` instead of the export fixture, so `导出为文档` is unavailable.

- [ ] **Step 2: Add development-only fixture routing**

In `App.tsx`, use `React.lazy` and `Suspense` to load test fixtures only when both `import.meta.env.DEV` and an exact query flag match:

```tsx
const ArtifactExportBrowserFixture = lazy(() =>
  import("./tests/fixtures/artifactExportBrowserFixture")
);
const ArtifactLibraryBrowserFixture = lazy(() =>
  import("./tests/fixtures/artifactLibraryBrowserFixture")
);

export default function App() {
  const fixture = import.meta.env.DEV ? window.location.search : "";
  if (fixture === "?artifact-export-fixture") {
    return <Suspense fallback={null}><ArtifactExportBrowserFixture /></Suspense>;
  }
  if (fixture === "?artifact-library-fixture") {
    return <Suspense fallback={null}><ArtifactLibraryBrowserFixture /></Suspense>;
  }
  return <AppShell />;
}
```

The export fixture renders one stable `ArtifactTab` and injects the browser export client. The library fixture renders one saved thin-reading row, one available desktop export, one missing desktop export, and one browser-managed export. Neither fixture may import dev-cloud or provide mock API results to `products/*/services`.

- [ ] **Step 3: Extend the browser export assertions and verify GREEN**

Assert the browser success message after every download:

```ts
await expect(page.getByText("文档已导出，由浏览器下载设置管理。")).toBeVisible();
```

Keep the existing filename and file-content assertions for all three formats.

Run:

```bash
npx playwright test src/tests/browser/artifactExport.browser.spec.ts
```

Expected: PASS; all three downloads are valid and each success message states that the browser manages the file.

- [ ] **Step 4: Add and run artifact-library browser coverage**

Create `artifactLibrary.browser.spec.ts` with exact viewports:

```ts
for (const viewport of [
  { height: 920, name: "desktop", width: 1440 },
  { height: 844, name: "narrow", width: 390 }
]) {
  test(`artifact library remains usable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?artifact-library-fixture");
    await expect(page.getByRole("tab", { name: "已保存" })).toBeVisible();
    await page.getByRole("tab", { name: "已导出" }).click();
    await expect(page.getByText("文件不可用")).toBeVisible();
    await page.screenshot({
      fullPage: true,
      path: `test-results/artifact-library-${viewport.name}.png`
    });
  });
}
```

Run:

```bash
npx playwright test src/tests/browser/artifactLibrary.browser.spec.ts
```

Expected: PASS at both viewports without horizontal page overflow.

- [ ] **Step 5: Run focused and full desktop verification**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- src/tests/artifactDocumentExport.test.ts src/tests/artifactExportClient.test.ts src/tests/useArtifactExportController.test.ts src/tests/ArtifactLibraryPane.test.tsx src/tests/useArtifactWorkflowController.test.ts src/tests/ActivityBar.test.tsx src/tests/useLeftRailNavigation.test.ts src/tests/dockLayout.test.ts src/tests/LeftPane.test.tsx src/tests/ArtifactTabs.test.tsx src/tests/AppShell.test.tsx src/tests/layoutStyleContract.test.ts
npm test
npm run build
cd src-tauri
cargo fmt --check
cargo test
```

Expected: all commands exit 0 with no new warnings.

- [ ] **Step 6: Run the desktop application and manually verify native file behavior**

Run:

```bash
cd products/liteasy/apps/desktop
npm run tauri dev
```

Verify:

1. “产物库” opens from the Activity Bar.
2. A saved thin-reading artifact reopens in the center after its tab is closed.
3. Export Save As cancellation creates no file and no record.
4. Markdown, HTML, and PDF export to the selected directory and appear immediately.
5. Open and reveal operate on the recorded file.
6. Removing a record leaves the file present.
7. Deleting the file externally changes the row to “文件不可用”.

- [ ] **Step 7: Inspect desktop and narrow screenshots**

Inspect `test-results/artifact-library-desktop.png` at `1440x920` and `test-results/artifact-library-narrow.png` at `390x844`. Check:

- no overlapping text or controls;
- paths truncate without expanding the rail;
- menu buttons remain stable when status text changes;
- tabs, search, and row actions have accessible names;
- the palette remains neutral and consistent with the Fluent 2 baseline.

- [ ] **Step 8: Review the final diff and commit verification adjustments**

Run:

```bash
git diff --check
git status --short
```

Confirm only planned files plus pre-existing user changes are present, then commit only Task 6 files:

```bash
git add products/liteasy/apps/desktop/src/App.tsx products/liteasy/apps/desktop/src/tests/fixtures/artifactExportBrowserFixture.tsx products/liteasy/apps/desktop/src/tests/fixtures/artifactLibraryBrowserFixture.tsx products/liteasy/apps/desktop/src/tests/browser/artifactExport.browser.spec.ts products/liteasy/apps/desktop/src/tests/browser/artifactLibrary.browser.spec.ts products/liteasy/apps/desktop/src/tests/layoutStyleContract.test.ts
git commit -m "test: verify artifact library workflows"
```

Do not stage the pre-existing thin-reading changes or exported `薄读.*` files.
