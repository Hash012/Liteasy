# LiteasyClaw Intent Native Generative UI Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first controlled GenUI loop so LiteasyClaw can render validated UI DSL in the assistant, route dynamic buttons through registered actions, and keep the current empty assistant page as the default UI before the user sends an instruction.

**Architecture:** Add a focused `features/generative-ui` module for DSL types, registries, validation, rule generation, rendering, and action routing. `agent-runtime` may emit `ui_dsl_ready` events, while `assistant` renders validated DSL documents without importing AppShell internals or executing handlers directly.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing `actionRegistry` and `agent-runtime` modules.

---

### Task 1: GenUI Contract and Validator

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/generative-ui/generativeUi.types.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/generative-ui/componentRegistry.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/generative-ui/dataSourceRegistry.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/generative-ui/designTokenRegistry.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/generative-ui/uiDslValidator.ts`
- Test: `products/liteasy/apps/desktop/src/tests/uiDslValidator.test.ts`

- [ ] **Step 1: Write failing validator tests**

```ts
test("accepts registered components, data sources, actions, and tokens", () => {
  const result = validateUIDslDocument(createValidDocument());
  expect(result.valid).toBe(true);
});

test("rejects unknown components and arbitrary style props", () => {
  const result = validateUIDslDocument({
    ...createValidDocument(),
    root: { id: "bad", component: "MagicPanel", props: { style: "color:red" } }
  });
  expect(result.valid).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- uiDslValidator.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal contract and validator**

Define `UIDslDocument`, `UIDslNode`, `UIDslActionRef`, registered component cards, data source cards, token presets, and `validateUIDslDocument(document)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- uiDslValidator.test.ts`
Expected: PASS.

### Task 2: Dynamic Canvas and ActionRef Router

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/generative-ui/actionRefRouter.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/generative-ui/DynamicCanvas.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/DynamicCanvas.test.tsx`

- [ ] **Step 1: Write failing canvas tests**

```tsx
test("renders fallback for invalid DSL", () => {
  render(<DynamicCanvas document={invalidDocument} onAction={vi.fn()} />);
  expect(screen.getByText("动态界面暂时不可用")).toBeInTheDocument();
});

test("routes ActionBar clicks as action refs", async () => {
  render(<DynamicCanvas document={validActionDocument} onAction={onAction} />);
  await user.click(screen.getByRole("button", { name: "恢复默认" }));
  expect(onAction).toHaveBeenCalledWith(validActionDocument.actions[0]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- DynamicCanvas.test.tsx`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement renderer and router**

Render `Stack`, `Panel`, `StatusBanner`, `EvidenceCard`, `CitationList`, `ArtifactLauncher`, and `ActionBar`. `ActionBar` only calls `onAction(actionRef)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- DynamicCanvas.test.tsx`
Expected: PASS.

### Task 3: Runtime UI Projection Events

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/generative-ui/uiDslGenerator.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/agent-runtime/planExecutor.ts`
- Test: `products/liteasy/apps/desktop/src/tests/generativeUiRuntime.test.ts`

- [ ] **Step 1: Write failing runtime tests**

```ts
test("generates ui_dsl_ready for low-risk theme commands", async () => {
  const result = await executeSemanticPlan(themePlan, context);
  expect(result.events.some((event) => event.type === "ui_dsl_ready")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- generativeUiRuntime.test.ts`
Expected: FAIL because `ui_dsl_ready` is not emitted.

- [ ] **Step 3: Add `ui_dsl_ready` event and rule generator**

Generate stable DSL for `theme.apply_preset`, `layout.split_two`, `artifact.generate`, clarification, and runtime error/fallback cases.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- generativeUiRuntime.test.ts`
Expected: PASS.

### Task 4: Assistant Integration and Default UI

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/assistant/assistant.types.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/assistant/assistant.store.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/assistant/AssistantPane.tsx`
- Modify: `products/liteasy/apps/desktop/src/app/features/assistant/AssistantMessageList.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/AssistantPane.test.tsx`

- [ ] **Step 1: Write failing assistant integration tests**

```tsx
test("keeps launcher UI as the default before the first instruction", () => {
  render(<AssistantPane onGenerateArtifact={() => "unused"} selectedSetStatus={readyStatus} />);
  expect(screen.getByLabelText("AI助手初始模式入口")).toBeInTheDocument();
});

test("renders command result DSL after a theme command", async () => {
  render(<AssistantPane onGenerateArtifact={() => "unused"} selectedSetStatus={readyStatus} />);
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "让 UI 变成卡通风格");
  await user.click(screen.getByRole("button", { name: "发送" }));
  expect(screen.getByLabelText("动态界面：已应用卡通风格。")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- AssistantPane.test.tsx`
Expected: FAIL on the new dynamic UI assertion.

- [ ] **Step 3: Store and render DSL messages**

Attach `uiDsl` to assistant messages when runtime emits `ui_dsl_ready`; pass action refs through `ActionRefRouter -> executeAction`, then append result UI.

- [ ] **Step 4: Run targeted and full desktop checks**

Run: `npm test -- AssistantPane.test.tsx uiDslValidator.test.ts DynamicCanvas.test.tsx generativeUiRuntime.test.ts`
Expected: PASS.

Run: `npm run build`
Expected: PASS.
