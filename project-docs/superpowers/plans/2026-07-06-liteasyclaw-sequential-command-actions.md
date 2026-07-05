# LiteasyClaw Sequential Command Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support one user command producing and executing multiple ordered UI/business actions, such as moving the organization panel to the bottom and then opening the organization shared library.

**Architecture:** Keep the existing `SemanticActionPlan.actions[]` contract and make it explicit that the array is an ordered action sequence. The model semantic planner remains the primary semantic parser, while the existing policy engine, validator, and executor continue to validate and execute registered actions in order.

**Tech Stack:** React, TypeScript, Vitest, LiteasyClaw agent runtime, model semantic planner, registered action registry, Mermaid architecture HTML.

---

### Task 1: Lock The Model Planner Contract

**Files:**
- Modify: `LiteasyClaw/desktop/src/tests/modelSemanticPlanner.test.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/agent-runtime/modelSemanticPlanner.ts`

- [ ] **Step 1: Write the failing test**

Add a test that stubs the model planner response with two registered actions and asserts the planner preserves order and prompt guidance mentions ordered multi-action commands.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/tests/modelSemanticPlanner.test.ts`

Expected: FAIL because the prompt does not yet explicitly require ordered decomposition for compound commands.

- [ ] **Step 3: Update the planner prompt**

Add concise prompt rules that say compound commands must be decomposed into multiple registered `actions[]` in the same order as the user requested, without inventing macro actions.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run src/tests/modelSemanticPlanner.test.ts`

Expected: PASS.

### Task 2: Verify End-To-End Sequential Execution

**Files:**
- Modify: `LiteasyClaw/desktop/src/tests/AppShell.test.tsx`
- Modify only if needed: `LiteasyClaw/desktop/src/app/layout/AppShell.tsx`

- [ ] **Step 1: Write the failing test**

Add an AppShell test for `把组织面板打开到下栏后打开组织文库` using a stubbed model response with `dock.move_item` followed by `organization.open_shared_library`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/tests/AppShell.test.tsx`

Expected: FAIL if AppShell cannot route the model planner or if sequential action execution does not produce both UI outcomes.

- [ ] **Step 3: Implement the smallest required runtime connection**

If AppShell cannot use a stubbed model transport, add a narrow optional `modelTransport` prop and pass it to `AssistantSidebar`/`AssistantPane`. Do not introduce a new workflow DSL.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run src/tests/AppShell.test.tsx`

Expected: PASS, with the organization tab in the bottom Dock region and the organization shared library opened.

### Task 3: Backup And Update The Architecture Diagram

**Files:**
- Create: `project-docs/superpowers/specs/2026-07-05-liteasyclaw-intent-native-generative-ui-architecture-rendered.backup-2026-07-06-before-sequential-actions.html`
- Modify: `project-docs/superpowers/specs/2026-07-05-liteasyclaw-intent-native-generative-ui-architecture-rendered.html`

- [ ] **Step 1: Backup the current rendered architecture HTML**

Run: `cp project-docs/superpowers/specs/2026-07-05-liteasyclaw-intent-native-generative-ui-architecture-rendered.html project-docs/superpowers/specs/2026-07-05-liteasyclaw-intent-native-generative-ui-architecture-rendered.backup-2026-07-06-before-sequential-actions.html`

- [ ] **Step 2: Update the Mermaid source inside the HTML**

Change the `IntentPlan` node to describe `ordered actions[]` and change the executor node to describe sequential execution.

- [ ] **Step 3: Inspect the updated HTML text**

Run: `rg -n "ordered actions|顺序|Sequential|PlanExecutor|IntentPlan" project-docs/superpowers/specs/2026-07-05-liteasyclaw-intent-native-generative-ui-architecture-rendered.html`

Expected: The architecture text explicitly documents ordered action sequences.

### Task 4: Final Verification

**Files:**
- All touched runtime, tests, and docs.

- [ ] **Step 1: Run targeted tests**

Run: `npm test -- --run src/tests/modelSemanticPlanner.test.ts src/tests/AppShell.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS.
