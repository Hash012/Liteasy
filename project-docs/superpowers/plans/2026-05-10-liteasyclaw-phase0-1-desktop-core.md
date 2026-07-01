# LiteasyClaw Phase 0-1 Desktop Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable LiteasyClaw slice for individual researchers: a desktop workbench that supports workspace management, selected-document-set ingest, modality-button-driven analysis, AI conversation, source-grounded answers, skill-driven software control, and one or two asynchronous learning artifacts.

**Architecture:** The first slice centers on a Tauri desktop shell with a React UI, a Rust-backed local capability layer, a local SQLite-based workspace/document store, and a thin cloud integration seam. The plan intentionally prioritizes the end-to-end user loop over platform completeness and leaves organization, advanced governance, and heavy multimodal generation to follow-up plans.

**Tech Stack:** Tauri 2, React, TypeScript, Rust, SQLite, local file storage, optional mock cloud API, test fixture PDFs

---

### Task 1: Repository bootstrap and developer run path

**Files:**
- Create: `LiteasyClaw/desktop/README.md`
- Create: `LiteasyClaw/desktop/package.json`
- Create: `LiteasyClaw/desktop/src/main.tsx`
- Create: `LiteasyClaw/desktop/src/App.tsx`
- Create: `LiteasyClaw/desktop/src/app/layout/AppShell.tsx`
- Create: `LiteasyClaw/desktop/src/app/styles/app.css`
- Create: `LiteasyClaw/desktop/src-tauri/Cargo.toml`
- Create: `LiteasyClaw/desktop/src-tauri/src/main.rs`
- Create: `project-docs/qa/environment-startup-guide.md`

- [ ] **Step 1: Scaffold the desktop app skeleton**

Create a Tauri + React workspace under `LiteasyClaw/desktop/` with a minimal renderable shell.

```tsx
// LiteasyClaw/desktop/src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./app/styles/app.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

```tsx
// LiteasyClaw/desktop/src/App.tsx
import { AppShell } from "./app/layout/AppShell";

export default function App() {
  return <AppShell />;
}
```

- [ ] **Step 2: Build a visible three-column shell**

Create a non-empty desktop shell with left, center, and right panes labeled for:

- library
- reader
- assistant

```tsx
// LiteasyClaw/desktop/src/app/layout/AppShell.tsx
export function AppShell() {
  return (
    <div className="app-shell">
      <aside className="pane left">Library</aside>
      <main className="pane center">Reader</main>
      <section className="pane right">Assistant</section>
    </div>
  );
}
```

- [ ] **Step 3: Write the non-developer startup guide**

Create `project-docs/qa/environment-startup-guide.md` with:

- what to install
- how to run the desktop app
- what screen should appear
- what to do if startup fails

Run: `test -f project-docs/qa/environment-startup-guide.md && echo PASS`
Expected: `PASS`

- [ ] **Step 4: Verify the shell renders**

Run: `cd LiteasyClaw/desktop && npm install && npm run tauri dev`
Expected: a desktop window opens showing three visible panes

- [ ] **Step 5: Commit the bootstrap**

```bash
git add LiteasyClaw/desktop project-docs/qa/environment-startup-guide.md
git commit -m "feat: scaffold LiteasyClaw desktop shell"
```

### Task 2: Workspace and local library model

**Files:**
- Create: `LiteasyClaw/desktop/src/app/features/workspace/workspace.types.ts`
- Create: `LiteasyClaw/desktop/src/app/features/workspace/workspace.store.ts`
- Create: `LiteasyClaw/desktop/src/app/features/library/LibraryPane.tsx`
- Create: `LiteasyClaw/desktop/src/app/features/library/library.css`
- Create: `LiteasyClaw/desktop/src/tests/workspace.store.test.ts`

- [ ] **Step 1: Write the failing workspace state test**

```ts
// LiteasyClaw/desktop/src/tests/workspace.store.test.ts
import { createWorkspaceStore } from "../app/features/workspace/workspace.store";

test("locks selected papers after workspace lock", () => {
  const store = createWorkspaceStore();

  store.addPaper({ id: "p1", title: "Paper 1" });
  store.addPaper({ id: "p2", title: "Paper 2" });
  store.toggleSelection("p1");
  store.lockSelection();
  store.toggleSelection("p2");

  expect(store.getState().selectedPaperIds).toEqual(["p1"]);
  expect(store.getState().selectionLocked).toBe(true);
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd LiteasyClaw/desktop && npm test -- workspace.store.test.ts`
Expected: FAIL because the store does not exist yet

- [ ] **Step 3: Implement the minimal workspace store**

```ts
// LiteasyClaw/desktop/src/app/features/workspace/workspace.store.ts
type Paper = { id: string; title: string };

type WorkspaceState = {
  papers: Paper[];
  selectedPaperIds: string[];
  selectionLocked: boolean;
};

export function createWorkspaceStore() {
  const state: WorkspaceState = {
    papers: [],
    selectedPaperIds: [],
    selectionLocked: false,
  };

  return {
    addPaper(paper: Paper) {
      state.papers.push(paper);
    },
    toggleSelection(id: string) {
      if (state.selectionLocked) return;
      state.selectedPaperIds = state.selectedPaperIds.includes(id)
        ? state.selectedPaperIds.filter((item) => item !== id)
        : [...state.selectedPaperIds, id];
    },
    lockSelection() {
      state.selectionLocked = true;
    },
    unlockSelection() {
      state.selectionLocked = false;
    },
    getState() {
      return state;
    },
  };
}
```

- [ ] **Step 4: Render the library pane using the workspace store**

Create a basic left-pane UI that shows:

- paper list
- selection checkboxes
- lock button

Run: `cd LiteasyClaw/desktop && npm test -- workspace.store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the workspace slice**

```bash
git add LiteasyClaw/desktop/src/app/features/workspace LiteasyClaw/desktop/src/app/features/library LiteasyClaw/desktop/src/tests/workspace.store.test.ts
git commit -m "feat: add workspace selection and lock flow"
```

### Task 3: Selected-document-set ingest and parse job state

**Files:**
- Create: `LiteasyClaw/desktop/src/app/features/import/import.types.ts`
- Create: `LiteasyClaw/desktop/src/app/features/import/import.store.ts`
- Create: `LiteasyClaw/desktop/src/app/features/import/ImportButton.tsx`
- Create: `LiteasyClaw/desktop/src/tests/import.store.test.ts`
- Create: `LiteasyClaw/desktop/src-tauri/src/import.rs`
- Modify: `LiteasyClaw/desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Write the failing import state test**

```ts
import { createImportStore } from "../app/features/import/import.store";

test("marks import status as parsed after successful parse job", async () => {
  const store = createImportStore();
  const jobId = store.startImport("fixtures/paper-a.pdf");

  store.markParsed(jobId, { paperId: "paper-a" });

  expect(store.getJob(jobId)?.status).toBe("parsed");
  expect(store.getJob(jobId)?.paperId).toBe("paper-a");
});
```

- [ ] **Step 2: Run the import test to confirm it fails**

Run: `cd LiteasyClaw/desktop && npm test -- import.store.test.ts`
Expected: FAIL because the import store does not exist yet

- [ ] **Step 3: Implement a minimal parse job store**

Implement import job states:

- queued
- parsing
- parsed
- failed

Run: `cd LiteasyClaw/desktop && npm test -- import.store.test.ts`
Expected: PASS

- [ ] **Step 4: Add a temporary mocked Tauri import command**

Expose a Rust command that accepts a local path and returns:

```json
{ "jobId": "job-1", "status": "queued" }
```

This command is a temporary seam so the UI can exercise import flow before full PDF parsing exists.

- [ ] **Step 5: Show ingest status on document items in the library pane**

Update the UI so a user can click an import button and see:

- import queued
- parsing
- parsed
- failed

The status should be shown on the corresponding document row, rather than in a separate standalone import-status module. The ingest target is the selected document set, not the whole workspace directory view.

- [ ] **Step 6: Commit the import flow**

```bash
git add LiteasyClaw/desktop/src/app/features/import LiteasyClaw/desktop/src/tests/import.store.test.ts LiteasyClaw/desktop/src-tauri/src
git commit -m "feat: add document import job flow"
```

### Task 4: Assistant console with mode switching and conversation history

**Files:**
- Create: `LiteasyClaw/desktop/src/app/features/assistant/assistant.types.ts`
- Create: `LiteasyClaw/desktop/src/app/features/assistant/assistant.store.ts`
- Create: `LiteasyClaw/desktop/src/app/features/assistant/AssistantPane.tsx`
- Create: `LiteasyClaw/desktop/src/app/features/assistant/ModeSwitch.tsx`
- Create: `LiteasyClaw/desktop/src/tests/assistant.store.test.ts`

- [ ] **Step 1: Write the failing assistant mode test**

```ts
import { createAssistantStore } from "../app/features/assistant/assistant.store";

test("defaults to command mode and can switch to qa mode", () => {
  const store = createAssistantStore();

  expect(store.getState().mode).toBe("command");
  store.setMode("qa");
  expect(store.getState().mode).toBe("qa");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd LiteasyClaw/desktop && npm test -- assistant.store.test.ts`
Expected: FAIL because the assistant store does not exist yet

- [ ] **Step 3: Implement a minimal assistant conversation store**

Implement:

- current mode
- conversation list
- message list
- pending status

Run: `cd LiteasyClaw/desktop && npm test -- assistant.store.test.ts`
Expected: PASS

- [ ] **Step 4: Render the assistant pane**

Add:

- mode buttons for explain / command / qa
- message history list
- input box
- send button

- [ ] **Step 5: Commit the assistant shell**

```bash
git add LiteasyClaw/desktop/src/app/features/assistant LiteasyClaw/desktop/src/tests/assistant.store.test.ts
git commit -m "feat: add assistant modes and conversation shell"
```

### Task 5: Source-grounded answer pipeline with mock retrieval

**Files:**
- Create: `LiteasyClaw/desktop/src/app/features/retrieval/retrieval.types.ts`
- Create: `LiteasyClaw/desktop/src/app/features/retrieval/mockRetriever.ts`
- Create: `LiteasyClaw/desktop/src/app/features/assistant/answerFormatter.ts`
- Create: `LiteasyClaw/desktop/src/tests/answerFormatter.test.ts`

- [ ] **Step 1: Write the failing source-grounded answer test**

```ts
import { formatAnswer } from "../app/features/assistant/answerFormatter";

test("formats answer text with citation references", () => {
  const result = formatAnswer({
    answer: "Transformer models rely on self-attention.",
    citations: [{ paperId: "p1", page: 3, snippet: "self-attention replaces recurrence" }],
    confidence: 0.84,
  });

  expect(result).toContain("p.3");
  expect(result).toContain("0.84");
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd LiteasyClaw/desktop && npm test -- answerFormatter.test.ts`
Expected: FAIL because the formatter does not exist yet

- [ ] **Step 3: Implement the answer formatter and mock retrieval seam**

The initial implementation may use fixture data rather than a live model, but it must produce a structured payload:

```ts
type AnswerPayload = {
  answer: string;
  citations: Array<{ paperId: string; page: number; snippet: string }>;
  confidence: number;
};
```

Run: `cd LiteasyClaw/desktop && npm test -- answerFormatter.test.ts`
Expected: PASS

- [ ] **Step 4: Wire the assistant pane to display citation and confidence metadata**

The user must be able to see:

- answer text
- citation page
- confidence value

- [ ] **Step 5: Commit the grounded answer slice**

```bash
git add LiteasyClaw/desktop/src/app/features/retrieval LiteasyClaw/desktop/src/app/features/assistant/answerFormatter.ts LiteasyClaw/desktop/src/tests/answerFormatter.test.ts
git commit -m "feat: display source-grounded answers"
```

### Task 6: Skill-driven software control

**Files:**
- Create or modify: `LiteasyClaw/desktop/src/app/features/settings/settings.types.ts`
- Create or modify: `LiteasyClaw/desktop/src/app/features/settings/settings.store.ts`
- Create: `LiteasyClaw/desktop/src/app/features/skills/skillRegistry.ts`
- Create: `LiteasyClaw/desktop/src/app/features/skills/actionRegistry.ts`
- Modify or replace: `LiteasyClaw/desktop/src/app/features/assistant/commandRouter.ts`
- Modify or replace: `LiteasyClaw/desktop/src/tests/commandRouter.test.ts`

- [ ] **Step 1: Write the failing command routing test**

```ts
import { routeCommand } from "../app/features/assistant/commandRouter";

test("maps closing network recommendation to a typed settings command", () => {
  const result = routeCommand("关闭联网推荐");

  expect(result).toEqual({
    intent: "update_setting",
    target: "network.recommendation.enabled",
    value: false,
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd LiteasyClaw/desktop && npm test -- commandRouter.test.ts`
Expected: FAIL because the command router does not exist yet

- [ ] **Step 3: Implement a skill registry and action registry**

Start with these keys:

- `network.recommendation.enabled`
- `profile.enabled`
- `assistant.default_output_mode`
- `assistant.language`

- [ ] **Step 4: Implement the intent router and settings action store**

The router may start rule-based. It does not need a live LLM in the first cut, but it must return structured skill invocations, ensure that only registered actions can mutate software state, and reject unknown targets.

Run: `cd LiteasyClaw/desktop && npm test -- commandRouter.test.ts`
Expected: PASS

- [ ] **Step 5: Show execution feedback in the assistant pane**

When a user sends a settings command, show:

- success result
- affected setting
- new value

- [ ] **Step 6: Commit skill-driven control**

```bash
git add LiteasyClaw/desktop/src/app/features/settings LiteasyClaw/desktop/src/app/features/assistant/commandRouter.ts LiteasyClaw/desktop/src/tests/commandRouter.test.ts
git commit -m "feat: add skill-driven software control"
```

### Task 7: One asynchronous learning artifact flow

**Files:**
- Create: `LiteasyClaw/desktop/src/app/features/artifacts/artifact.types.ts`
- Create: `LiteasyClaw/desktop/src/app/features/artifacts/artifact.store.ts`
- Create: `LiteasyClaw/desktop/src/app/features/artifacts/ArtifactTabs.tsx`
- Create: `LiteasyClaw/desktop/src/tests/artifact.store.test.ts`

- [ ] **Step 1: Write the failing artifact task test**

```ts
import { createArtifactStore } from "../app/features/artifacts/artifact.store";

test("completes a mind-map artifact task and opens a new tab", () => {
  const store = createArtifactStore();
  const taskId = store.createTask("mindmap");

  store.completeTask(taskId, {
    artifactId: "a1",
    title: "Transformer Mind Map",
    type: "mindmap",
  });

  expect(store.getTask(taskId)?.status).toBe("completed");
  expect(store.getOpenTabs()[0]?.artifactId).toBe("a1");
});
```

- [ ] **Step 2: Run the artifact test to confirm it fails**

Run: `cd LiteasyClaw/desktop && npm test -- artifact.store.test.ts`
Expected: FAIL because the artifact store does not exist yet

- [ ] **Step 3: Implement a minimal artifact task store**

Support:

- queued
- running
- completed
- failed

And create an open tab entry on completion.

Run: `cd LiteasyClaw/desktop && npm test -- artifact.store.test.ts`
Expected: PASS

- [ ] **Step 4: Add the first artifact flow with middle-pane modality buttons as the target entry**

The initial version may produce mock content, but it must:

- create a task
- update task status
- open a new center tab on completion

The product target is that fixed modality buttons in the middle pane are the main entry for analysis. Natural language in the assistant is a post-ingest branch trigger and may be used as a temporary prototype seam before the button flow is fully implemented.

- [ ] **Step 5: Commit the first async artifact flow**

```bash
git add LiteasyClaw/desktop/src/app/features/artifacts LiteasyClaw/desktop/src/tests/artifact.store.test.ts
git commit -m "feat: add asynchronous mind map artifact flow"
```

### Task 8: Phase 1 non-developer test guide

**Files:**
- Create: `project-docs/qa/phase1-test-guide.md`
- Modify: `project-docs/qa/environment-startup-guide.md`

- [ ] **Step 1: Write the phase test guide for non-developers**

The guide must include:

- required tools
- how to start the desktop app
- test account instructions
- sample PDF instructions
- exactly what to click
- what “good” looks like
- how to report a bug

- [ ] **Step 2: Add a manual walkthrough checklist**

Include the following checks:

- import one paper
- import several papers
- select and lock papers
- ask one explain question
- ask one qa question
- change one setting by chat
- generate one mind map
- verify citations are visible

- [ ] **Step 3: Verify the guide exists and is readable**

Run: `sed -n '1,220p' project-docs/qa/phase1-test-guide.md`
Expected: a plain-language test guide with step-by-step instructions

- [ ] **Step 4: Commit the QA guides**

```bash
git add project-docs/qa/environment-startup-guide.md project-docs/qa/phase1-test-guide.md
git commit -m "docs: add Phase 1 non-developer test guide"
```

### Task 9: Phase gate verification

**Files:**
- Modify: `project-docs/superpowers/plans/2026-05-10-liteasyclaw-phase0-1-desktop-core.md`

- [ ] **Step 1: Run the focused test suite**

Run: `cd LiteasyClaw/desktop && npm test -- workspace.store.test.ts import.store.test.ts assistant.store.test.ts answerFormatter.test.ts commandRouter.test.ts artifact.store.test.ts`
Expected: all listed tests PASS

- [ ] **Step 2: Run the desktop app for a manual walkthrough**

Run: `cd LiteasyClaw/desktop && npm run tauri dev`
Expected: the tester can complete the manual checklist from `project-docs/qa/phase1-test-guide.md`

- [ ] **Step 3: Record known limitations before moving to Phase 2**

Append a short block to the end of this plan:

```md
Known limitations before Phase 2:
- retrieval is fixture-backed or mocked
- cloud sync is not yet active
- organization flows are intentionally out of scope
```

- [ ] **Step 4: Commit the verified phase gate**

```bash
git add project-docs/superpowers/plans/2026-05-10-liteasyclaw-phase0-1-desktop-core.md
git commit -m "docs: mark LiteasyClaw Phase 0-1 verification gate"
```

---

## Current Gate Status (2026-05-13)

Phase 0-1 is functionally near the verification gate and should still be treated as the active implementation plan.

- Focused automated verification has passed in the current workspace.
- The desktop app can be started with `npm run tauri dev` in the current environment.
- The non-developer QA guide exists and has been updated to reflect the current mainline:
  selected document set import in the left pane, modality-button-driven analysis in the center pane, and post-import branch skills in the assistant pane.
- A full human visual/manual walkthrough still needs to be performed against `project-docs/qa/phase1-test-guide.md` on an interactive desktop session and recorded by the tester.

Known limitations before Phase 2:
- retrieval is fixture-backed or mocked
- import is still a mock parse/index flow, not real PDF ingestion
- center-pane artifacts are still mock/static outputs rather than generated end products
- cloud sync is not yet active
- organization flows are intentionally out of scope
