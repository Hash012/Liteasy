# LiteasyClaw Intent Native Generative UI Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the controlled GenUI contract beyond Phase 1: capability cards, strict DSL/UX validation, execution journal, evidence UI for qa/explain, center artifact DSL rendering, runtime progress events, and boundary/red-team tests.

**Architecture:** Keep `agent-runtime` deterministic and UI-free, keep `generative-ui` as the DSL projection/rendering boundary, and keep state mutation behind registered actions. DSL documents remain projections; journal entries carry trace facts across input, plan, policy, DSL, and dynamic action clicks.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing `actionRegistry`, `agent-runtime`, `assistant`, and `artifacts` modules.

---

### Task 1: Capability Metadata Contract

**Files:**
- Modify: `LiteasyClaw/desktop/src/app/features/skills/actionRegistry.ts`
- Test: `LiteasyClaw/desktop/src/tests/capabilityContract.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
test("all registered actions expose complete capability metadata", () => {
  for (const capability of getRegisteredActionMetadata()) {
    expect(capability.family).toMatch(/^(layout|theme|panel|artifact|selection|workspace|recommendation|collection|profile|organization|plugin|settings|cloud)$/);
    expect(capability.inputSchema.type).toBe("object");
    expect(capability.outputSchema.type).toBe("object");
    expect(typeof capability.reversible).toBe("boolean");
    expect(typeof capability.estimatedLatencyMs).toBe("number");
    expect(capability.estimatedCost).toMatch(/^(none|local_compute|cloud_tokens|paid_resource)$/);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- capabilityContract.test.ts`
Expected: FAIL because metadata lacks the new fields.

- [ ] **Step 3: Implement metadata**

Add `CapabilityMetadata`, lightweight JSON-schema types, family/cost/reversibility/progress fields, and keep `RegisteredActionMetadata` as an alias if existing imports need it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- capabilityContract.test.ts`
Expected: PASS.

### Task 2: Strict Component Props and UX Validator

**Files:**
- Modify: `LiteasyClaw/desktop/src/app/features/generative-ui/componentRegistry.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/generative-ui/uiDslValidator.ts`
- Create: `LiteasyClaw/desktop/src/app/features/generative-ui/uxValidator.ts`
- Test: `LiteasyClaw/desktop/src/tests/uiDslValidator.test.ts`
- Test: `LiteasyClaw/desktop/src/tests/uxValidator.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
test("rejects invalid component props", () => {
  const result = validateUIDslDocument(withNode("StatusBanner", { tone: "loud", text: 42 }));
  expect(result.valid).toBe(false);
});

test("rejects high-risk primary buttons and deep right-rail cards", () => {
  const result = validateUIDslUx(documentWithHighRiskPrimaryAction());
  expect(result.valid).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- uiDslValidator.test.ts uxValidator.test.ts`
Expected: FAIL because schemas and UX validator are missing.

- [ ] **Step 3: Implement schemas and UX rules**

Add per-component prop schemas for `Stack`, `Panel`, `StatusBanner`, `EvidenceCard`, `CitationList`, `ArtifactLauncher`, `ComparisonTable`, and `ActionBar`. Add UX rules for action labels, high-risk primary style, assistant card depth, modal stacking, long text strategy, and citation consistency fallback.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- uiDslValidator.test.ts uxValidator.test.ts`
Expected: PASS.

### Task 3: Execution Journal and Runtime Events

**Files:**
- Create: `LiteasyClaw/desktop/src/app/features/generative-ui/executionJournal.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/agent-runtime/planExecutor.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/generative-ui/actionRefRouter.ts`
- Test: `LiteasyClaw/desktop/src/tests/executionJournal.test.ts`
- Test: `LiteasyClaw/desktop/src/tests/generativeUiRuntime.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
test("records input, plan, policy, ui dsl, and action result by trace id", () => {
  const journal = createExecutionJournal();
  journal.record({ type: "plan", traceId: "trace-1", planId: "plan-1" });
  expect(journal.getTrace("trace-1")).toHaveLength(1);
});

test("runtime emits progress_started, task_created, and action_failed events", async () => {
  const result = await executeSemanticPlan(artifactPlan, readyContext);
  expect(result.events.map((event) => event.type)).toContain("progress_started");
  expect(result.events.map((event) => event.type)).toContain("task_created");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- executionJournal.test.ts generativeUiRuntime.test.ts`
Expected: FAIL because journal and event variants are incomplete.

- [ ] **Step 3: Implement journal and event expansion**

Add in-memory journal helpers, propagate trace IDs from plan ID to DSL/action routing, emit `progress_started`, `task_created`, and `action_failed` where runtime currently emits only reply/error events.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- executionJournal.test.ts generativeUiRuntime.test.ts`
Expected: PASS.

### Task 4: Evidence UI for QA and Explain

**Files:**
- Modify: `LiteasyClaw/desktop/src/app/features/generative-ui/uiDslGenerator.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/assistant/generateAssistantAnswer.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/assistant/AssistantPane.tsx`
- Test: `LiteasyClaw/desktop/src/tests/generateAssistantAnswer.test.ts`
- Test: `LiteasyClaw/desktop/src/tests/AssistantPane.test.tsx`

- [ ] **Step 1: Write failing tests**

```ts
test("qa answers include evidence ui dsl without state-changing actions", async () => {
  const answer = await generateAssistantAnswer(validInput);
  expect(answer.uiDsl?.root.component).toBe("Stack");
  expect(answer.uiDsl?.actions).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- generateAssistantAnswer.test.ts AssistantPane.test.tsx`
Expected: FAIL because qa/explain answers do not attach DSL.

- [ ] **Step 3: Implement evidence DSL generation**

Generate `EvidenceCard + CitationList + StatusBanner` DSL for grounded answers. Attach it to assistant messages in qa/explain without creating any state-changing actions.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- generateAssistantAnswer.test.ts AssistantPane.test.tsx`
Expected: PASS.

### Task 5: Center Artifact DSL Rendering

**Files:**
- Modify: `LiteasyClaw/desktop/src/app/features/artifacts/artifact.types.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/artifacts/ArtifactTabs.tsx`
- Test: `LiteasyClaw/desktop/src/tests/ArtifactTabs.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
test("renders center artifact ui dsl when a tab provides one", () => {
  render(<ArtifactTabs tabs={[tabWithUiDsl]} tasks={[]} selectedCount={2} selectionLocked canStartAnalysis analysisHint="" onStartAnalysis={vi.fn()} />);
  expect(screen.getByText("方法对比")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ArtifactTabs.test.tsx`
Expected: FAIL because tabs cannot carry or render DSL.

- [ ] **Step 3: Add DSL support**

Add optional `uiDsl?: UIDslDocument` to artifact tabs and render it through `DynamicCanvas` in the card body with inert action handling for center artifacts.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ArtifactTabs.test.tsx`
Expected: PASS.

### Task 6: Golden, Boundary, and Red-Team Tests

**Files:**
- Test: `LiteasyClaw/desktop/src/tests/generativeUiGolden.test.ts`
- Test: `LiteasyClaw/desktop/src/tests/generativeUiBoundary.test.ts`
- Test: `LiteasyClaw/desktop/src/tests/promptInjectionGenerativeUi.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
test("generates stable dsl for ten golden intents", () => {
  expect(goldenDocuments.map((document) => document.root.component)).toEqual(["Stack", "Stack", "Stack", "Stack", "Stack", "Stack", "Stack", "Stack", "Stack", "Stack"]);
});

test("generative ui modules do not import AppShell or DOM mutation APIs", () => {
  expect(readSource("generative-ui")).not.toMatch(/AppShell|document\.querySelector|eval\(/);
});

test("rejects prompt-injected function bodies and unknown actions", () => {
  expect(validateUIDslDocument(injectedDocument).valid).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- generativeUiGolden.test.ts generativeUiBoundary.test.ts promptInjectionGenerativeUi.test.ts`
Expected: FAIL until generator coverage and validator hardening are complete.

- [ ] **Step 3: Implement missing deterministic coverage**

Expand rule generator to stable DSL for ten intents and tighten validation for function-body-like props, unknown action references, direct DOM/CSS injection, and forbidden imports.

- [ ] **Step 4: Run test suite and build**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: PASS.
