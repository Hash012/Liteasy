# LiteasyClaw Runtime Context Panel Design

## Goal

Phase C adds context transparency to the AI-native runtime.

The right assistant should show what the runtime is using before it executes a command. Users should be able to see selected document state, workspace source, cloud/account availability, organization context, and profile state without reading hidden logs or trusting free-form assistant text.

The approved UI direction is an expandable context panel:

- collapsed by default as a compact summary;
- expandable into grouped runtime context details;
- placed inside `AssistantPane` below the current mode label and above the message list.

## Scope

This phase implements the first complete context panel slice for the desktop assistant.

In scope:

- lightweight runtime context view model;
- context panel component;
- collapsed and expanded panel states;
- context-aware mind map command guard;
- tests for view-model building, panel rendering, runtime guard behavior, and AssistantPane integration.

Out of scope:

- full audit timeline;
- new center-pane artifact rendering;
- broad AppShell/workspace refactor;
- organization governance detail rendering inside the assistant;
- confirmation-card UI with accept/cancel actions.

## User Experience

The panel has two states.

Collapsed summary:

```text
上下文 · 选中 3 篇 · 已锁定 · 已导入 2/3 · 云账号已连接 · 画像关闭
```

Expanded details:

- `Selection`: selected count, lock state, imported count, readiness issues.
- `Workspace`: source type and root path.
- `Cloud`: account connection and organization name when available.
- `Profile`: profile sampling state and whether profile commands require confirmation.

The panel should be compact and operational. It should not include instructional copy or marketing-style explanation.

## Runtime Context View Model

Add a lightweight view model rather than passing raw stores into UI components:

```ts
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
    type: "local_library" | "organization_shared" | "unknown";
  };
};
```

Recommended issue ids:

```ts
type RuntimeContextIssue =
  | "selection_empty"
  | "selection_unlocked"
  | "documents_not_imported"
  | "workspace_unknown";
```

## Data Flow

`AssistantPane` should build the first context view from existing props:

- `selectedSetStatus.selectedCount`
- `selectedSetStatus.selectionLocked`
- `selectedSetStatus.importedCount`
- `selectedPapers`
- `profileUnlocked`
- `settingsStore.getState()["profile.enabled"]`

For workspace and organization, this phase can accept optional props with minimal values:

```ts
runtimeWorkspace?: {
  rootPath?: string;
  type?: "local_library" | "organization_shared";
};
runtimeOrganizationName?: string;
```

If those props are not supplied, the view model should use `workspace.type: "unknown"` and omit the root path. This keeps the panel useful now without forcing broad AppShell wiring in the same slice.

## Runtime Guard Behavior

Mind map artifact requests must use context readiness.

When the user asks for a mind map:

- if `selectedCount === 0`, emit a clarification request asking the user to select papers;
- if `locked === false`, emit a clarification request asking the user to lock the selected set;
- if `importedCount < selectedCount`, emit a clarification request asking the user to import the selected set;
- if selection is ready and an artifact handler exists, emit `artifact_request` and the existing assistant reply;
- if selection is ready but no artifact handler exists, emit a runtime error explaining that artifact execution is not registered.

This makes the runtime's context decision explicit and testable.

## Component Design

Create:

```text
products/liteasy/apps/desktop/src/app/features/assistant/AssistantContextPanel.tsx
```

The component receives:

```ts
type AssistantContextPanelProps = {
  context: AgentRuntimeContextView;
};
```

It owns only local expanded/collapsed UI state. It should not mutate settings, workspace, selection, or runtime state.

Recommended labels:

- collapsed button label: `运行时上下文`
- expanded section headings: `Selection`, `Workspace`, `Cloud`, `Profile`
- missing context status text should be concise, such as `需锁定`, `需导入`, `未选择`

## Styling

Add styles to `products/liteasy/apps/desktop/src/app/styles/app.css`.

Style constraints:

- radius no more than 8px;
- compact type scale matching assistant messages;
- no nested cards;
- no decorative gradients or large visual blocks;
- content must fit narrow right pane widths.

## Testing

Required tests:

- `agentRuntimeContextView.test.ts`: builds ready and missing-context view models.
- `AssistantContextPanel.test.tsx`: renders collapsed summary and expanded groups.
- `agentRuntimeOrchestrator.test.ts`: mind map command blocks empty, unlocked, and partially imported selection.
- `AssistantPane.test.tsx`: renders the context panel and routes mind map commands through context readiness.

## Acceptance Criteria

This phase is complete when:

1. The assistant displays a collapsed context summary by default.
2. Users can expand the panel to inspect selection, workspace, cloud, and profile context.
3. Runtime mind map requests use selected/locked/imported readiness instead of only checking handler availability.
4. Existing command mode behavior from Phase A-B remains intact.
5. Focused tests, full desktop tests, and production build pass.
