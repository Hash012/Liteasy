# LiteasyClaw Runtime Context Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an expandable runtime context panel to the right assistant and use the same context to guard mind map artifact commands.

**Architecture:** Introduce a lightweight `AgentRuntimeContextView` built from existing AssistantPane inputs. Render it with a focused `AssistantContextPanel` component, pass it into `runAgentRuntime`, and use it for selected/locked/imported readiness checks before artifact execution.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing LiteasyClaw desktop feature modules.

---

## File Responsibilities

- `LiteasyClaw/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`: add `RuntimeContextIssue` and `AgentRuntimeContextView`.
- `LiteasyClaw/desktop/src/app/features/agent-runtime/contextView.ts`: build context summaries and readiness issues from AssistantPane-friendly inputs.
- `LiteasyClaw/desktop/src/tests/agentRuntimeContextView.test.ts`: verify ready, empty, unlocked, partially imported, and unknown workspace contexts.
- `LiteasyClaw/desktop/src/app/features/assistant/AssistantContextPanel.tsx`: render collapsed summary and expanded grouped context details.
- `LiteasyClaw/desktop/src/tests/AssistantContextPanel.test.tsx`: verify collapsed and expanded panel behavior.
- `LiteasyClaw/desktop/src/app/features/agent-runtime/runtimeOrchestrator.ts`: use `contextView` to guard artifact commands before handler execution.
- `LiteasyClaw/desktop/src/tests/agentRuntimeOrchestrator.test.ts`: extend mind map context readiness coverage.
- `LiteasyClaw/desktop/src/app/features/assistant/AssistantPane.tsx`: build context view, render the panel, and pass context to runtime.
- `LiteasyClaw/desktop/src/tests/AssistantPane.test.tsx`: verify context panel rendering and context-aware mind map command behavior.
- `LiteasyClaw/desktop/src/app/styles/app.css`: add compact context panel styles.

## Task 1: Add Runtime Context View Model

**Files:**
- Modify: `LiteasyClaw/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`
- Create: `LiteasyClaw/desktop/src/app/features/agent-runtime/contextView.ts`
- Test: `LiteasyClaw/desktop/src/tests/agentRuntimeContextView.test.ts`

- [ ] **Step 1: Write the failing context-view test**

Create `LiteasyClaw/desktop/src/tests/agentRuntimeContextView.test.ts`:

```ts
import { buildAgentRuntimeContextView, formatAgentRuntimeContextSummary } from "../app/features/agent-runtime/contextView";

test("builds a ready runtime context summary", () => {
  const context = buildAgentRuntimeContextView({
    importedCount: 2,
    organizationName: "Liteasy AI Reading Lab",
    profileEnabled: false,
    profileUnlocked: true,
    selectedCount: 2,
    selectionLocked: true,
    workspace: {
      rootPath: "/tmp/LiteasyLibrary",
      type: "local_library"
    }
  });

  expect(context).toEqual({
    cloud: {
      connected: true,
      organizationName: "Liteasy AI Reading Lab"
    },
    profile: {
      enabled: false,
      requiresConfirmation: true
    },
    selection: {
      importedCount: 2,
      issues: [],
      locked: true,
      ready: true,
      selectedCount: 2
    },
    workspace: {
      rootPath: "/tmp/LiteasyLibrary",
      type: "local_library"
    }
  });
  expect(formatAgentRuntimeContextSummary(context)).toBe("上下文 · 选中 2 篇 · 已锁定 · 已导入 2/2 · 云账号已连接 · 画像关闭");
});

test("marks empty, unlocked, and partially imported selections as not ready", () => {
  const context = buildAgentRuntimeContextView({
    importedCount: 1,
    profileEnabled: true,
    profileUnlocked: false,
    selectedCount: 3,
    selectionLocked: false
  });

  expect(context.selection).toEqual({
    importedCount: 1,
    issues: ["selection_unlocked", "documents_not_imported"],
    locked: false,
    ready: false,
    selectedCount: 3
  });
  expect(context.workspace).toEqual({
    type: "unknown"
  });
  expect(context.cloud).toEqual({
    connected: false
  });
  expect(formatAgentRuntimeContextSummary(context)).toBe("上下文 · 选中 3 篇 · 未锁定 · 已导入 1/3 · 云账号未连接 · 画像开启");
});

test("marks no selected papers and unknown workspace as issues", () => {
  const context = buildAgentRuntimeContextView({
    importedCount: 0,
    profileEnabled: false,
    profileUnlocked: false,
    selectedCount: 0,
    selectionLocked: false
  });

  expect(context.selection.issues).toEqual(["selection_empty", "selection_unlocked"]);
  expect(context.selection.ready).toBe(false);
  expect(context.workspace).toEqual({
    type: "unknown"
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd LiteasyClaw/desktop && npm test -- src/tests/agentRuntimeContextView.test.ts
```

Expected: FAIL because `contextView` does not exist.

- [ ] **Step 3: Extend runtime context types**

Modify `LiteasyClaw/desktop/src/app/features/agent-runtime/agentRuntime.types.ts` by adding these types after `AgentRuntimeExecutionContext`:

```ts
export type RuntimeContextIssue =
  | "selection_empty"
  | "selection_unlocked"
  | "documents_not_imported"
  | "workspace_unknown";

export type AgentRuntimeContextView = {
  cloud: {
    connected: boolean;
    organizationName?: string;
  };
  profile: {
    enabled: boolean;
    requiresConfirmation: boolean;
  };
  selection: {
    importedCount: number;
    issues: RuntimeContextIssue[];
    locked: boolean;
    ready: boolean;
    selectedCount: number;
  };
  workspace: {
    rootPath?: string;
    type: WorkspaceSource["type"] | "unknown";
  };
};
```

- [ ] **Step 4: Add the context-view builder**

Create `LiteasyClaw/desktop/src/app/features/agent-runtime/contextView.ts`:

```ts
import type { AgentRuntimeContextView, RuntimeContextIssue } from "./agentRuntime.types";
import type { WorkspaceSource } from "../workspace/workspace.types";

export type AgentRuntimeContextViewInput = {
  importedCount: number;
  organizationName?: string;
  profileEnabled: boolean;
  profileUnlocked: boolean;
  selectedCount: number;
  selectionLocked: boolean;
  workspace?: Partial<WorkspaceSource>;
};

function getSelectionIssues(input: AgentRuntimeContextViewInput): RuntimeContextIssue[] {
  const issues: RuntimeContextIssue[] = [];

  if (input.selectedCount === 0) {
    issues.push("selection_empty");
  }

  if (!input.selectionLocked) {
    issues.push("selection_unlocked");
  }

  if (input.selectedCount > 0 && input.importedCount < input.selectedCount) {
    issues.push("documents_not_imported");
  }

  return issues;
}

export function buildAgentRuntimeContextView(input: AgentRuntimeContextViewInput): AgentRuntimeContextView {
  const issues = getSelectionIssues(input);
  const workspaceType = input.workspace?.type ?? "unknown";

  return {
    cloud: {
      connected: input.profileUnlocked,
      ...(input.organizationName ? { organizationName: input.organizationName } : {})
    },
    profile: {
      enabled: input.profileEnabled,
      requiresConfirmation: true
    },
    selection: {
      importedCount: input.importedCount,
      issues,
      locked: input.selectionLocked,
      ready: issues.length === 0,
      selectedCount: input.selectedCount
    },
    workspace: {
      ...(input.workspace?.rootPath ? { rootPath: input.workspace.rootPath } : {}),
      type: workspaceType
    }
  };
}

export function formatAgentRuntimeContextSummary(context: AgentRuntimeContextView) {
  const lockLabel = context.selection.locked ? "已锁定" : "未锁定";
  const cloudLabel = context.cloud.connected ? "云账号已连接" : "云账号未连接";
  const profileLabel = context.profile.enabled ? "画像开启" : "画像关闭";

  return [
    "上下文",
    `选中 ${context.selection.selectedCount} 篇`,
    lockLabel,
    `已导入 ${context.selection.importedCount}/${context.selection.selectedCount}`,
    cloudLabel,
    profileLabel
  ].join(" · ");
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
cd LiteasyClaw/desktop && npm test -- src/tests/agentRuntimeContextView.test.ts
```

Expected: PASS for 3 tests.

- [ ] **Step 6: Commit**

Run:

```bash
git add LiteasyClaw/desktop/src/app/features/agent-runtime/agentRuntime.types.ts LiteasyClaw/desktop/src/app/features/agent-runtime/contextView.ts LiteasyClaw/desktop/src/tests/agentRuntimeContextView.test.ts
git commit -m "feat: add runtime context view model"
```

## Task 2: Add Assistant Context Panel UI

**Files:**
- Create: `LiteasyClaw/desktop/src/app/features/assistant/AssistantContextPanel.tsx`
- Modify: `LiteasyClaw/desktop/src/app/styles/app.css`
- Test: `LiteasyClaw/desktop/src/tests/AssistantContextPanel.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `LiteasyClaw/desktop/src/tests/AssistantContextPanel.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantContextPanel } from "../app/features/assistant/AssistantContextPanel";
import type { AgentRuntimeContextView } from "../app/features/agent-runtime/agentRuntime.types";

function createContext(overrides: Partial<AgentRuntimeContextView> = {}): AgentRuntimeContextView {
  return {
    cloud: {
      connected: true,
      organizationName: "Liteasy AI Reading Lab"
    },
    profile: {
      enabled: false,
      requiresConfirmation: true
    },
    selection: {
      importedCount: 2,
      issues: ["documents_not_imported"],
      locked: true,
      ready: false,
      selectedCount: 3
    },
    workspace: {
      rootPath: "/tmp/LiteasyLibrary",
      type: "local_library"
    },
    ...overrides
  };
}

test("renders a collapsed runtime context summary by default", () => {
  render(<AssistantContextPanel context={createContext()} />);

  expect(screen.getByRole("button", { name: /运行时上下文/ })).toBeInTheDocument();
  expect(screen.getByText("上下文 · 选中 3 篇 · 已锁定 · 已导入 2/3 · 云账号已连接 · 画像关闭")).toBeInTheDocument();
  expect(screen.queryByText("Selection")).not.toBeInTheDocument();
});

test("expands grouped context details", async () => {
  const user = userEvent.setup();

  render(<AssistantContextPanel context={createContext()} />);

  await user.click(screen.getByRole("button", { name: /运行时上下文/ }));

  const panel = screen.getByLabelText("运行时上下文详情");
  expect(within(panel).getByText("Selection")).toBeInTheDocument();
  expect(within(panel).getByText("3 篇 · 已锁定 · 已导入 2/3")).toBeInTheDocument();
  expect(within(panel).getByText("需导入")).toBeInTheDocument();
  expect(within(panel).getByText("Workspace")).toBeInTheDocument();
  expect(within(panel).getByText("本地文献库 · /tmp/LiteasyLibrary")).toBeInTheDocument();
  expect(within(panel).getByText("Cloud")).toBeInTheDocument();
  expect(within(panel).getByText("已连接 · Liteasy AI Reading Lab")).toBeInTheDocument();
  expect(within(panel).getByText("Profile")).toBeInTheDocument();
  expect(within(panel).getByText("画像关闭 · 命令需确认")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the component test to verify it fails**

Run:

```bash
cd LiteasyClaw/desktop && npm test -- src/tests/AssistantContextPanel.test.tsx
```

Expected: FAIL because `AssistantContextPanel` does not exist.

- [ ] **Step 3: Add the context panel component**

Create `LiteasyClaw/desktop/src/app/features/assistant/AssistantContextPanel.tsx`:

```tsx
import { useState } from "react";
import { formatAgentRuntimeContextSummary } from "../agent-runtime/contextView";
import type { AgentRuntimeContextView, RuntimeContextIssue } from "../agent-runtime/agentRuntime.types";

type AssistantContextPanelProps = {
  context: AgentRuntimeContextView;
};

function getWorkspaceLabel(context: AgentRuntimeContextView) {
  const typeLabel =
    context.workspace.type === "organization_shared"
      ? "组织共享文献库"
      : context.workspace.type === "local_library"
        ? "本地文献库"
        : "未知工作区";

  return context.workspace.rootPath ? `${typeLabel} · ${context.workspace.rootPath}` : typeLabel;
}

function getCloudLabel(context: AgentRuntimeContextView) {
  if (!context.cloud.connected) {
    return "未连接";
  }

  return context.cloud.organizationName ? `已连接 · ${context.cloud.organizationName}` : "已连接";
}

function getProfileLabel(context: AgentRuntimeContextView) {
  const enabledLabel = context.profile.enabled ? "画像开启" : "画像关闭";
  const confirmationLabel = context.profile.requiresConfirmation ? "命令需确认" : "命令可直接执行";

  return `${enabledLabel} · ${confirmationLabel}`;
}

function getIssueLabel(issue: RuntimeContextIssue) {
  const labels: Record<RuntimeContextIssue, string> = {
    documents_not_imported: "需导入",
    selection_empty: "未选择",
    selection_unlocked: "需锁定",
    workspace_unknown: "工作区未知"
  };

  return labels[issue];
}

export function AssistantContextPanel({ context }: AssistantContextPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = formatAgentRuntimeContextSummary(context);

  return (
    <section className="assistant-context-panel" aria-label="运行时上下文">
      <button
        aria-expanded={expanded}
        className="assistant-context-toggle"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span>运行时上下文</span>
        <span className="assistant-context-summary">{summary}</span>
      </button>

      {expanded ? (
        <div aria-label="运行时上下文详情" className="assistant-context-details">
          <div className="assistant-context-group">
            <div className="assistant-context-heading">Selection</div>
            <div>{`${context.selection.selectedCount} 篇 · ${context.selection.locked ? "已锁定" : "未锁定"} · 已导入 ${context.selection.importedCount}/${context.selection.selectedCount}`}</div>
            {context.selection.issues.length > 0 ? (
              <div className="assistant-context-issues">
                {context.selection.issues.map((issue) => (
                  <span key={issue}>{getIssueLabel(issue)}</span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="assistant-context-group">
            <div className="assistant-context-heading">Workspace</div>
            <div>{getWorkspaceLabel(context)}</div>
          </div>
          <div className="assistant-context-group">
            <div className="assistant-context-heading">Cloud</div>
            <div>{getCloudLabel(context)}</div>
          </div>
          <div className="assistant-context-group">
            <div className="assistant-context-heading">Profile</div>
            <div>{getProfileLabel(context)}</div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Add compact panel styles**

Append these styles near the existing assistant styles in `LiteasyClaw/desktop/src/app/styles/app.css`:

```css
.assistant-context-panel {
  border: 1px solid var(--line-1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.86);
  color: var(--ink-2);
  overflow: hidden;
}

.assistant-context-toggle {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  padding: 9px 10px;
  text-align: left;
}

.assistant-context-summary {
  color: #60778d;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-context-details {
  display: grid;
  gap: 8px;
  border-top: 1px solid var(--line-1);
  padding: 10px;
  font-size: 12px;
}

.assistant-context-group {
  display: grid;
  gap: 3px;
}

.assistant-context-heading {
  color: var(--accent-1);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
}

.assistant-context-issues {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.assistant-context-issues span {
  border: 1px solid #efd7a2;
  border-radius: 999px;
  background: #fff7df;
  color: #80662c;
  padding: 2px 7px;
}
```

- [ ] **Step 5: Run the component test to verify it passes**

Run:

```bash
cd LiteasyClaw/desktop && npm test -- src/tests/AssistantContextPanel.test.tsx
```

Expected: PASS for 2 tests.

- [ ] **Step 6: Commit**

Run:

```bash
git add LiteasyClaw/desktop/src/app/features/assistant/AssistantContextPanel.tsx LiteasyClaw/desktop/src/app/styles/app.css LiteasyClaw/desktop/src/tests/AssistantContextPanel.test.tsx
git commit -m "feat: add assistant runtime context panel"
```

## Task 3: Guard Artifact Commands With Context Readiness

**Files:**
- Modify: `LiteasyClaw/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/agent-runtime/runtimeOrchestrator.ts`
- Modify: `LiteasyClaw/desktop/src/tests/agentRuntimeOrchestrator.test.ts`

- [ ] **Step 1: Write the failing runtime guard tests**

Append these tests to `LiteasyClaw/desktop/src/tests/agentRuntimeOrchestrator.test.ts`:

```ts
test("asks the user to lock the selected set before generating a mind map", async () => {
  await expect(
    runAgentRuntime(
      {
        message: "生成思维导图",
        mode: "command"
      },
      {
        contextView: {
          cloud: { connected: true },
          profile: { enabled: false, requiresConfirmation: true },
          selection: {
            importedCount: 1,
            issues: ["selection_unlocked"],
            locked: false,
            ready: false,
            selectedCount: 1
          },
          workspace: { type: "local_library" }
        },
        startArtifactAnalysis: () => "should not run"
      }
    )
  ).resolves.toEqual({
    events: [
      {
        missing: ["selected_document_set"],
        question: "请先锁定当前选中文献集，再生成思维导图。",
        type: "clarification_request"
      }
    ],
    settingsChanged: false
  });
});

test("asks the user to import selected papers before generating a mind map", async () => {
  await expect(
    runAgentRuntime(
      {
        message: "生成思维导图",
        mode: "command"
      },
      {
        contextView: {
          cloud: { connected: true },
          profile: { enabled: false, requiresConfirmation: true },
          selection: {
            importedCount: 1,
            issues: ["documents_not_imported"],
            locked: true,
            ready: false,
            selectedCount: 2
          },
          workspace: { type: "local_library" }
        },
        startArtifactAnalysis: () => "should not run"
      }
    )
  ).resolves.toEqual({
    events: [
      {
        missing: ["ingested_documents"],
        question: "请先导入当前选中文献集，再生成思维导图。",
        type: "clarification_request"
      }
    ],
    settingsChanged: false
  });
});

test("runs a mind map artifact request when context is ready", async () => {
  const result = await runAgentRuntime(
    {
      message: "生成思维导图",
      mode: "command"
    },
    {
      contextView: {
        cloud: { connected: true },
        profile: { enabled: false, requiresConfirmation: true },
        selection: {
          importedCount: 2,
          issues: [],
          locked: true,
          ready: true,
          selectedCount: 2
        },
        workspace: { type: "local_library" }
      },
      startArtifactAnalysis: () => "已开始思维导图分析。"
    }
  );

  expect(result).toEqual({
    events: [
      {
        artifact: {
          artifactType: "mindmap",
          payload: {
            source: "selected_document_set"
          }
        },
        type: "artifact_request"
      },
      {
        message: "已开始思维导图分析。",
        type: "assistant_reply"
      }
    ],
    settingsChanged: false
  });
});
```

- [ ] **Step 2: Run the orchestrator test to verify it fails**

Run:

```bash
cd LiteasyClaw/desktop && npm test -- src/tests/agentRuntimeOrchestrator.test.ts
```

Expected: FAIL because `AgentRuntimeExecutionContext` does not accept `contextView` and artifact commands do not use readiness issues.

- [ ] **Step 3: Add contextView to runtime execution context**

Modify `AgentRuntimeExecutionContext` in `LiteasyClaw/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`:

```ts
export type AgentRuntimeExecutionContext = ActionContext & {
  contextView?: AgentRuntimeContextView;
  profileUnlocked?: boolean;
};
```

- [ ] **Step 4: Implement context-aware artifact guard**

Modify `LiteasyClaw/desktop/src/app/features/agent-runtime/runtimeOrchestrator.ts`.

Add this helper above `runAgentRuntime`:

```ts
function getArtifactClarification(context: AgentRuntimeExecutionContext) {
  const selection = context.contextView?.selection;

  if (!selection || selection.issues.includes("selection_empty")) {
    return {
      missing: ["selected_document_set"],
      question: "请先勾选要分析的文献，再生成思维导图。",
      type: "clarification_request" as const
    };
  }

  if (selection.issues.includes("selection_unlocked")) {
    return {
      missing: ["selected_document_set"],
      question: "请先锁定当前选中文献集，再生成思维导图。",
      type: "clarification_request" as const
    };
  }

  if (selection.issues.includes("documents_not_imported")) {
    return {
      missing: ["ingested_documents"],
      question: "请先导入当前选中文献集，再生成思维导图。",
      type: "clarification_request" as const
    };
  }

  return null;
}
```

Then replace the artifact branch's first handler check with:

```ts
    const clarification = getArtifactClarification(context);
    if (clarification) {
      return {
        events: [clarification],
        settingsChanged: false
      };
    }

    const startArtifactAnalysis = context.startArtifactAnalysis;
    if (!startArtifactAnalysis) {
      return {
        events: [
          {
            message: "思维导图产物执行能力尚未注册。",
            recovery: "请检查 artifact action 是否已连接。",
            type: "runtime_error"
          }
        ],
        settingsChanged: false
      };
    }
```

- [ ] **Step 5: Update the existing missing-context expectation**

In `agentRuntimeOrchestrator.test.ts`, update the existing no-context mind map test expected question from:

```ts
"请先勾选并锁定要分析的文献，再生成思维导图。"
```

to:

```ts
"请先勾选要分析的文献，再生成思维导图。"
```

- [ ] **Step 6: Run the orchestrator test to verify it passes**

Run:

```bash
cd LiteasyClaw/desktop && npm test -- src/tests/agentRuntimeOrchestrator.test.ts
```

Expected: PASS for all orchestrator tests.

- [ ] **Step 7: Commit**

Run:

```bash
git add LiteasyClaw/desktop/src/app/features/agent-runtime/agentRuntime.types.ts LiteasyClaw/desktop/src/app/features/agent-runtime/runtimeOrchestrator.ts LiteasyClaw/desktop/src/tests/agentRuntimeOrchestrator.test.ts
git commit -m "feat: guard artifact commands with runtime context"
```

## Task 4: Integrate Context Panel Into AssistantPane

**Files:**
- Modify: `LiteasyClaw/desktop/src/app/features/assistant/AssistantPane.tsx`
- Modify: `LiteasyClaw/desktop/src/tests/AssistantPane.test.tsx`

- [ ] **Step 1: Write the failing AssistantPane integration tests**

Append these tests to `LiteasyClaw/desktop/src/tests/AssistantPane.test.tsx`:

```tsx
test("renders the expandable runtime context panel inside the assistant", async () => {
  const user = userEvent.setup();

  render(
    <AssistantPane
      onGenerateArtifact={() => "unused"}
      profileUnlocked={true}
      runtimeOrganizationName="Liteasy AI Reading Lab"
      runtimeWorkspace={{
        rootPath: "/tmp/LiteasyLibrary",
        type: "local_library"
      }}
      selectedSetStatus={{
        importedCount: 1,
        selectedCount: 2,
        selectionLocked: true
      }}
    />
  );

  expect(screen.getByText("上下文 · 选中 2 篇 · 已锁定 · 已导入 1/2 · 云账号已连接 · 画像关闭")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /运行时上下文/ }));

  expect(screen.getByText("Selection")).toBeInTheDocument();
  expect(screen.getByText("需导入")).toBeInTheDocument();
  expect(screen.getByText("本地文献库 · /tmp/LiteasyLibrary")).toBeInTheDocument();
  expect(screen.getByText("已连接 · Liteasy AI Reading Lab")).toBeInTheDocument();
});

test("uses runtime context readiness before starting a mind map from the assistant", async () => {
  const user = userEvent.setup();
  const onGenerateArtifact = vi.fn(() => "已开始思维导图分析。");

  render(
    <AssistantPane
      onGenerateArtifact={onGenerateArtifact}
      selectedSetStatus={{
        importedCount: 1,
        selectedCount: 2,
        selectionLocked: true
      }}
    />
  );

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "生成思维导图");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("请先导入当前选中文献集，再生成思维导图。")).toBeInTheDocument();
  expect(onGenerateArtifact).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the AssistantPane test to verify it fails**

Run:

```bash
cd LiteasyClaw/desktop && npm test -- src/tests/AssistantPane.test.tsx
```

Expected: FAIL because `AssistantPane` does not render context panel and does not pass context readiness to runtime.

- [ ] **Step 3: Add AssistantPane props and imports**

Modify `LiteasyClaw/desktop/src/app/features/assistant/AssistantPane.tsx`.

Add imports:

```ts
import { buildAgentRuntimeContextView } from "../agent-runtime/contextView";
import { AssistantContextPanel } from "./AssistantContextPanel";
import type { WorkspaceSource } from "../workspace/workspace.types";
```

Change existing workspace import to include `WorkspaceSource`:

```ts
import type { Paper, WorkspaceSource } from "../workspace/workspace.types";
```

Add props:

```ts
  runtimeOrganizationName?: string;
  runtimeWorkspace?: Partial<WorkspaceSource>;
```

- [ ] **Step 4: Build and render the context view**

Inside `AssistantPane`, after state declarations and before helper functions, add:

```ts
  const runtimeContext = buildAgentRuntimeContextView({
    importedCount: selectedSetStatus.importedCount,
    organizationName: runtimeOrganizationName,
    profileEnabled: Boolean(settingsStoreRef.current.getState()["profile.enabled"]),
    profileUnlocked,
    selectedCount: selectedSetStatus.selectedCount,
    selectionLocked: selectedSetStatus.selectionLocked,
    workspace: runtimeWorkspace
  });
```

In the JSX, add the panel below the mode label:

```tsx
      <AssistantContextPanel context={runtimeContext} />
```

- [ ] **Step 5: Pass context into runtime**

In the `runAgentRuntime` context object, add:

```ts
            contextView: runtimeContext,
```

- [ ] **Step 6: Run the AssistantPane test to verify it passes**

Run:

```bash
cd LiteasyClaw/desktop && npm test -- src/tests/AssistantPane.test.tsx
```

Expected: PASS for all AssistantPane tests.

- [ ] **Step 7: Run focused Context Panel tests**

Run:

```bash
cd LiteasyClaw/desktop && npm test -- src/tests/agentRuntimeContextView.test.ts src/tests/AssistantContextPanel.test.tsx src/tests/agentRuntimeOrchestrator.test.ts src/tests/AssistantPane.test.tsx
```

Expected: PASS for all listed tests.

- [ ] **Step 8: Commit**

Run:

```bash
git add LiteasyClaw/desktop/src/app/features/assistant/AssistantPane.tsx LiteasyClaw/desktop/src/tests/AssistantPane.test.tsx
git commit -m "feat: show runtime context in assistant"
```

## Final Verification

- [ ] **Step 1: Run the full desktop test suite**

Run:

```bash
cd LiteasyClaw/desktop && npm test
```

Expected: PASS for the full Vitest suite. If the sandbox blocks localhost binding in `devScript.test.ts`, rerun the same command with elevated permissions and record that the elevated run passes.

- [ ] **Step 2: Run the production build**

Run:

```bash
cd LiteasyClaw/desktop && npm run build
```

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status --short
```

Expected: only pre-existing unrelated working-tree changes remain, or no changes if those have been handled separately.

## Self-Review

- Spec coverage: Tasks cover view model, panel UI, runtime artifact readiness guard, AssistantPane integration, focused tests, full tests, and build.
- Placeholder scan: This plan intentionally contains no placeholder markers or vague test/code steps.
- Type consistency: `AgentRuntimeContextView`, `RuntimeContextIssue`, `contextView`, and `runtimeWorkspace` are named consistently across tasks.
