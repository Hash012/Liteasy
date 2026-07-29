# Thin Reading Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class "薄读" modality with a dedicated full-page tab, recursive depth navigation, omitted-section tokens, and Intuecho margin recommendations.

**Architecture:** Thin reading is a local artifact flow that lives inside the existing center-artifact system. The tab renders as a full-page reading surface, but the generated document is stored in the normal artifact catalog so it can persist through the current local repository path. Remote artifact saving stays untouched for other modalities; thin reading branches early into a local projection/generation path and updates the catalog in place.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing artifact/workbench layout, existing settings store, Fluent UI icons, existing `app.css` plus a thin-reading feature stylesheet.

---

## File Map

- Create: `LiteasyClaw/desktop/src/app/features/thin-reading/thinReading.types.ts`
- Create: `LiteasyClaw/desktop/src/app/features/thin-reading/thinReadingProjection.ts`
- Create: `LiteasyClaw/desktop/src/app/features/thin-reading/thinReadingFixtures.ts`
- Create: `LiteasyClaw/desktop/src/app/features/thin-reading/thinReading.css`
- Create: `LiteasyClaw/desktop/src/app/features/thin-reading/ThinReadingTab.tsx`
- Modify: `LiteasyClaw/desktop/src/app/features/artifacts/artifact.types.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/artifacts/useArtifactActions.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/artifacts/ArtifactTabs.tsx`
- Modify: `LiteasyClaw/desktop/src/app/features/artifacts/FloatingModalityButton.tsx`
- Modify: `LiteasyClaw/desktop/src/app/layout/ReaderPane.tsx`
- Modify: `LiteasyClaw/desktop/src/app/layout/AppShell.tsx`
- Modify: `LiteasyClaw/desktop/src/app/controllers/useArtifactWorkflowController.ts`
- Test: `LiteasyClaw/desktop/src/tests/thinReadingProjection.test.ts`
- Test: `LiteasyClaw/desktop/src/tests/thinReadingTab.test.tsx`
- Test: `LiteasyClaw/desktop/src/tests/useArtifactActions.test.ts`
- Test: `LiteasyClaw/desktop/src/tests/ArtifactTabs.test.tsx`
- Test: `LiteasyClaw/desktop/src/tests/assistantTaskContext.test.tsx`
- Test: `LiteasyClaw/desktop/src/tests/AppShell.test.tsx`

### Task 1: Thin-reading data model and pure projection helpers

**Files:**
- Create `LiteasyClaw/desktop/src/app/features/thin-reading/thinReading.types.ts`
- Create `LiteasyClaw/desktop/src/app/features/thin-reading/thinReadingProjection.ts`
- Create `LiteasyClaw/desktop/src/app/features/thin-reading/thinReadingFixtures.ts`
- Modify `LiteasyClaw/desktop/src/app/features/artifacts/artifact.types.ts`
- Test `LiteasyClaw/desktop/src/tests/thinReadingProjection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import {
  advanceThinReadingDocument,
  createThinReadingDocument,
  listThinReadingBranchOptions
} from "../app/features/thin-reading/thinReadingProjection";

describe("thinReadingProjection", () => {
  test("creates a root thin-reading document with omitted-section tokens", () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-1",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      targetLanguage: "zh-CN"
    });

    expect(document.activeNodeId).toBe(document.rootNodeId);
    expect(document.nodes[document.rootNodeId].omittedSections.map((token) => token.label)).toEqual([
      "实验",
      "消融",
      "数据集",
      "局限",
      "索引代价"
    ]);
  });

  test("adds a branch node for omitted-section navigation", () => {
    const document = createThinReadingDocument({
      artifactId: "artifact-thin-1",
      papers: [{ id: "paper-1", title: "ColBERT" }],
      targetLanguage: "zh-CN"
    });
    const next = advanceThinReadingDocument(document, {
      parentNodeId: document.rootNodeId,
      source: { kind: "omitted_section", label: "实验", sectionKey: "experiment" },
      summary: "实验部分聚焦 ColBERT 的检索效果与索引成本。",
      title: "实验"
    });

    expect(listThinReadingBranchOptions(next, document.rootNodeId)).toEqual([
      expect.objectContaining({
        sourceLabel: "遗漏板块",
        title: "实验"
      })
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd LiteasyClaw/desktop && npm test -- src/tests/thinReadingProjection.test.ts`
Expected: FAIL with missing-module or missing-symbol errors until the thin-reading feature files exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export type ThinReadingNodeSource =
  | { kind: "root_overview" }
  | { kind: "omitted_section"; label: string; sectionKey: string }
  | { kind: "selected_text"; excerpt: string; prompt?: string };

export function createThinReadingDocument(input: CreateThinReadingDocumentInput): ThinReadingDocument {
  // build root node, default omitted-section tokens, and the first recommendation scope
}

export function advanceThinReadingDocument(
  document: ThinReadingDocument,
  input: AdvanceThinReadingDocumentInput
): ThinReadingDocument {
  // clone the document, append a child node, and move activeNodeId to the new child
}
```

The implementation should keep the document immutable, derive the root overview deterministically from the selected paper titles/chunks, and keep branch options and recommendation scopes in the same projection file. `artifact.types.ts` only needs an additional `thinReadingDocument?: ThinReadingDocument` field on `ArtifactTab` plus the new `"thin_reading"` union member.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd LiteasyClaw/desktop && npm test -- src/tests/thinReadingProjection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add LiteasyClaw/desktop/src/app/features/thin-reading \
  LiteasyClaw/desktop/src/app/features/artifacts/artifact.types.ts \
  LiteasyClaw/desktop/src/tests/thinReadingProjection.test.ts
git commit -m "feat: add thin reading document model"
```

### Task 2: Local thin-reading generation and artifact-action plumbing

**Files:**
- Modify `LiteasyClaw/desktop/src/app/features/artifacts/useArtifactActions.ts`
- Modify `LiteasyClaw/desktop/src/app/controllers/useArtifactWorkflowController.ts`
- Test `LiteasyClaw/desktop/src/tests/useArtifactActions.test.ts`
- Test `LiteasyClaw/desktop/src/tests/useArtifactWorkflowController.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("starts thin-reading analysis locally without calling the artifact result client", async () => {
  const artifactStore = createArtifactStore();
  const artifactResultClient = {
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    save: vi.fn()
  };
  const { result } = renderHook(() =>
    useArtifactActions({
      artifactStore,
      artifactResultClient,
      getAssistantLanguage: () => "zh-CN",
      getImportedChunksByPaperId: () => ({
        "paper-1": buildImportedChunksForPaper({
          id: "paper-1",
          sourcePath: "fixtures/demo-1.pdf",
          title: "ColBERT"
        })
      }),
      getSelectedDocumentSet: () => ({ documentIds: ["paper-1"], locked: true }),
      getSelectedPapers: () => [
        { id: "paper-1", sourcePath: "fixtures/demo-1.pdf", title: "ColBERT" }
      ],
      onAnalysisHint: vi.fn(),
      onArtifactCatalogChanged: vi.fn(),
      onArtifactTabsChanged: vi.fn(),
      onArtifactTasksChanged: vi.fn(),
      queueImportForPapers: vi.fn(() => "already_imported"),
      runAgentAnalysis: vi.fn(async () => {
        throw new Error("thin-reading should not call the agent backend");
      })
    })
  );

  act(() => {
    result.current.startAnalysis("thin_reading");
  });

  await waitFor(() => {
    expect(artifactStore.getCatalog()[0]).toEqual(
      expect.objectContaining({
        type: "thin_reading",
        thinReadingDocument: expect.objectContaining({
          activeNodeId: expect.any(String),
          targetLanguage: "zh-CN"
        })
      })
    );
  });

  expect(artifactResultClient.save).not.toHaveBeenCalled();
});
```

Add a second regression in `useArtifactWorkflowController.test.ts` that proves a restored thin-reading tab is still present after the controller hydrates the local catalog.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd LiteasyClaw/desktop && npm test -- src/tests/useArtifactActions.test.ts src/tests/useArtifactWorkflowController.test.ts`
Expected: FAIL because `thin_reading` is not yet handled and `getAssistantLanguage` is not yet threaded through.

- [ ] **Step 3: Write minimal implementation**

```ts
if (artifactType === "thin_reading") {
  const thinReadingDocument = createThinReadingDocument({
    artifactId,
    papers: selectedPapers.map((paper) => ({ id: paper.id, title: paper.title })),
    targetLanguage: getAssistantLanguage?.() ?? "zh-CN"
  });

  artifactStore.completeTask(taskId, {
    artifactId,
    papers: selectedPapers.map((paper) => ({ id: paper.id, title: paper.title })),
    thinReadingDocument,
    title: "薄读",
    type: "thin_reading"
  });
  syncArtifacts(taskId);
  onAnalysisHint("薄读已生成。");
  return;
}
```

Thread `getAssistantLanguage` through `useArtifactActions` and `useArtifactWorkflowController` so the thin-reading generator uses the existing `assistant.language` setting, which defaults to `zh-CN`. Add `updateThinReadingTab(artifactId, nextDocument)` to the workflow actions and use it to persist in-place navigation changes from the tab UI.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd LiteasyClaw/desktop && npm test -- src/tests/useArtifactActions.test.ts src/tests/useArtifactWorkflowController.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add LiteasyClaw/desktop/src/app/features/artifacts/useArtifactActions.ts \
  LiteasyClaw/desktop/src/app/controllers/useArtifactWorkflowController.ts \
  LiteasyClaw/desktop/src/tests/useArtifactActions.test.ts \
  LiteasyClaw/desktop/src/tests/useArtifactWorkflowController.test.ts
git commit -m "feat: wire thin reading generation into artifact workflow"
```

### Task 3: Thin-reading full-page tab UI and styling

**Files:**
- Create `LiteasyClaw/desktop/src/app/features/thin-reading/ThinReadingTab.tsx`
- Create `LiteasyClaw/desktop/src/app/features/thin-reading/thinReading.css`
- Test `LiteasyClaw/desktop/src/tests/thinReadingTab.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ThinReadingTab } from "../app/features/thin-reading/ThinReadingTab";
import { createThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";

test("renders the thin-reading root page with tokens, margin notes, and a selection affordance", async () => {
  const user = userEvent.setup();
  const document = createThinReadingDocument({
    artifactId: "artifact-thin-1",
    papers: [{ id: "paper-1", title: "ColBERT" }],
    targetLanguage: "zh-CN"
  });
  const onUpdateDocument = vi.fn();

  render(
    <ThinReadingTab
      artifactId="artifact-thin-1"
      document={document}
      onUpdateDocument={onUpdateDocument}
      papers={[{ id: "paper-1", title: "ColBERT" }]}
    />
  );

  expect(screen.getByText("总述")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "实验" })).toBeInTheDocument();
  expect(screen.getByText("Intuecho")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "回到上一层：总述" })).toBeInTheDocument();

  await user.hover(screen.getByRole("button", { name: "查看已生成的下一层页面" }));
  expect(screen.getByRole("menu", { name: "已生成的下一层页面" })).toBeInTheDocument();
});
```

Add a second test that mocks `window.getSelection()` and verifies the "深入" popover appears after selecting text and calls `onUpdateDocument` with a child node whose source kind is `selected_text`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd LiteasyClaw/desktop && npm test -- src/tests/thinReadingTab.test.tsx`
Expected: FAIL because `ThinReadingTab` and `thinReading.css` do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```tsx
type ThinReadingTabProps = {
  artifactId: string;
  document: ThinReadingDocument;
  onUpdateDocument: (artifactId: string, nextDocument: ThinReadingDocument) => void;
  papers: Array<{ id: string; title: string }>;
};

export function ThinReadingTab({ artifactId, document, onUpdateDocument, papers }: ThinReadingTabProps) {
  // render the full-page tab, manage branch-menu open state, and show a floating
  // selection popover when the paragraph text is selected.
}
```

Import `./thinReading.css` from the component and keep the layout in one full-page surface: top bar, breadcrumb, central serif paragraph, omitted-section tokens beneath it, and the Intuecho margin on the right. The component should stay purely view-driven; it receives an updated document from the workflow action and emits a new document through `onUpdateDocument`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd LiteasyClaw/desktop && npm test -- src/tests/thinReadingTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add LiteasyClaw/desktop/src/app/features/thin-reading/ThinReadingTab.tsx \
  LiteasyClaw/desktop/src/app/features/thin-reading/thinReading.css \
  LiteasyClaw/desktop/src/tests/thinReadingTab.test.tsx
git commit -m "feat: add thin reading tab surface"
```

### Task 4: Wire the launcher, artifact tabs, and app shell

**Files:**
- Modify `LiteasyClaw/desktop/src/app/features/artifacts/FloatingModalityButton.tsx`
- Modify `LiteasyClaw/desktop/src/app/features/artifacts/ArtifactTabs.tsx`
- Modify `LiteasyClaw/desktop/src/app/layout/ReaderPane.tsx`
- Modify `LiteasyClaw/desktop/src/app/layout/AppShell.tsx`
- Test `LiteasyClaw/desktop/src/tests/assistantTaskContext.test.tsx`
- Test `LiteasyClaw/desktop/src/tests/ArtifactTabs.test.tsx`
- Test `LiteasyClaw/desktop/src/tests/AppShell.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
test("shows thin reading in the floating modality launcher and opens a full thin-reading tab", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByLabelText("Survey of Vector Database Management Systems"));
  await user.click(screen.getByRole("button", { name: "锁定选择" }));
  await sendAssistantCommand(user, "导入当前选中文献集");
  await waitFor(() => expect(screen.getByText("PDF 已就绪")).toBeInTheDocument(), { timeout: 2500 });

  await user.click(screen.getByRole("button", { name: "打开模态选择" }));
  await user.click(screen.getByRole("button", { name: "薄读" }));

  await waitFor(() => {
    expect(screen.getByRole("tab", { name: "薄读" })).toHaveAttribute("aria-selected", "true");
  });
  expect(screen.getByRole("button", { name: "回到上一层：总述" })).toBeInTheDocument();
  expect(screen.getByText("Intuecho")).toBeInTheDocument();
});
```

Also add a component-level assertion in `assistantTaskContext.test.tsx` that `FloatingModalityButton` exposes a `"薄读"` option and calls `onStartAnalysis("thin_reading")`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd LiteasyClaw/desktop && npm test -- src/tests/assistantTaskContext.test.tsx src/tests/ArtifactTabs.test.tsx src/tests/AppShell.test.tsx`
Expected: FAIL because the new launcher option and thin-reading rendering path do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```tsx
// FloatingModalityButton.tsx
const modalityOptions = [
  { className: "tree", label: "树形展开", type: "tree" },
  { className: "mindmap", label: "思维导图", type: "mindmap" },
  { className: "layered-graph", label: "分层关系图", type: "layered_graph" },
  { className: "ppt", label: "PPT", type: "ppt" },
  { className: "comparison", label: "对比表", type: "comparison_table" },
  { className: "thin-reading", label: "薄读", type: "thin_reading" }
] as const;

// ArtifactTabs.tsx
if (activeTab?.type === "thin_reading") {
  return (
    <ThinReadingTab
      artifactId={activeTab.artifactId}
      document={activeTab.thinReadingDocument!}
      onUpdateDocument={onUpdateThinReadingTab}
      papers={activeTab.papers ?? []}
    />
  );
}
```

Pass `onUpdateThinReadingTab` through `ReaderPane.tsx` and `AppShell.tsx` just like the existing markdown update path. Keep all existing artifact and dock behavior intact.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd LiteasyClaw/desktop && npm test -- src/tests/assistantTaskContext.test.tsx src/tests/ArtifactTabs.test.tsx src/tests/AppShell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add LiteasyClaw/desktop/src/app/features/artifacts/FloatingModalityButton.tsx \
  LiteasyClaw/desktop/src/app/features/artifacts/ArtifactTabs.tsx \
  LiteasyClaw/desktop/src/app/layout/ReaderPane.tsx \
  LiteasyClaw/desktop/src/app/layout/AppShell.tsx \
  LiteasyClaw/desktop/src/tests/assistantTaskContext.test.tsx \
  LiteasyClaw/desktop/src/tests/ArtifactTabs.test.tsx \
  LiteasyClaw/desktop/src/tests/AppShell.test.tsx
git commit -m "feat: wire thin reading into the workbench"
```

### Task 5: Desktop verification and cleanup

**Files:**
- Modify any of the above thin-reading files only if a failing test exposes a mismatch.
- No new feature files should be added in this task.

- [ ] **Step 1: Run the focused suite**

Run:
`cd LiteasyClaw/desktop && npm test -- src/tests/thinReadingProjection.test.ts src/tests/thinReadingTab.test.tsx src/tests/useArtifactActions.test.ts src/tests/useArtifactWorkflowController.test.ts src/tests/assistantTaskContext.test.tsx src/tests/ArtifactTabs.test.tsx src/tests/AppShell.test.tsx`

Expected: all targeted tests pass with the new thin-reading behavior.

- [ ] **Step 2: Run the desktop build**

Run: `cd LiteasyClaw/desktop && npm run build`
Expected: TypeScript and Vite build both succeed.

- [ ] **Step 3: Fix only the failures reported by the suite or build**

Use the smallest possible edits. Do not expand scope into unrelated layout or settings refactors.

- [ ] **Step 4: Re-run the failing command(s)**

Run the exact command(s) that failed in Step 1 or Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add LiteasyClaw/desktop/src/app/features/thin-reading \
  LiteasyClaw/desktop/src/app/features/artifacts/artifact.types.ts \
  LiteasyClaw/desktop/src/app/features/artifacts/useArtifactActions.ts \
  LiteasyClaw/desktop/src/app/features/artifacts/ArtifactTabs.tsx \
  LiteasyClaw/desktop/src/app/features/artifacts/FloatingModalityButton.tsx \
  LiteasyClaw/desktop/src/app/layout/ReaderPane.tsx \
  LiteasyClaw/desktop/src/app/layout/AppShell.tsx \
  LiteasyClaw/desktop/src/tests/thinReadingProjection.test.ts \
  LiteasyClaw/desktop/src/tests/thinReadingTab.test.tsx \
  LiteasyClaw/desktop/src/tests/useArtifactActions.test.ts \
  LiteasyClaw/desktop/src/tests/useArtifactWorkflowController.test.ts \
  LiteasyClaw/desktop/src/tests/assistantTaskContext.test.tsx \
  LiteasyClaw/desktop/src/tests/ArtifactTabs.test.tsx \
  LiteasyClaw/desktop/src/tests/AppShell.test.tsx
git commit -m "feat: complete thin reading modal"
```
