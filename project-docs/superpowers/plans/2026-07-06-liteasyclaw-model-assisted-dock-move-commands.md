# LiteasyClaw Model-Assisted Dock Move Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add model-assisted command support for moving explicit dock tabs to left, right, or bottom regions without introducing a standalone empty bottom-pane action.

**Architecture:** Extend `ActionRegistry` with `dock.move_item`, teach the semantic planners to output the registered action, validate it through the existing plan validator, and execute it through AppShell's dock layout owner. The model remains the primary free-language interpreter; deterministic matching is the safe fallback.

**Tech Stack:** React, TypeScript, Vitest, existing LiteasyClaw agent-runtime/action-registry/Dock layout modules.

---

### Task 1: Add Dock Move Action Contract

**Files:**
- Modify: `LiteasyClaw/desktop/src/app/features/skills/actionRegistry.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`
- Test: `LiteasyClaw/desktop/src/tests/actionRegistry.test.ts`

- [ ] **Step 1: Write failing tests**

Add assertions that `dock.move_item` is registered with low risk, accepts `assistant/library/organization/profile/settings`, and executes through `context.moveDockItem`.

- [ ] **Step 2: Run tests**

Run: `npm test -- --run src/tests/actionRegistry.test.ts`

- [ ] **Step 3: Implement action contract**

Add `moveDockItem?: (input: { itemId: "assistant" | "library" | "organization" | "profile" | "settings"; targetRegion: "bottom" | "left" | "right" }) => string` to `ActionContext`, add the action union case, metadata, and `executeAction` branch.

- [ ] **Step 4: Verify**

Run: `npm test -- --run src/tests/actionRegistry.test.ts`

### Task 2: Add Semantic Planning Coverage

**Files:**
- Modify: `LiteasyClaw/desktop/src/app/features/skills/actionRegistry.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/agent-runtime/semanticActionMatcher.ts`
- Modify: `LiteasyClaw/desktop/src/app/features/agent-runtime/modelSemanticPlanner.ts`
- Test: `LiteasyClaw/desktop/src/tests/agentRuntimeSemanticPlanner.test.ts`
- Test: `LiteasyClaw/desktop/src/tests/modelSemanticPlanner.test.ts`

- [ ] **Step 1: Write failing tests**

Add deterministic tests for "把 AI 助手放到下栏", "文献库挪到右侧", and clarification for "打开下栏". Add model planner tests proving free wording can become `dock.move_item`.

- [ ] **Step 2: Run tests**

Run: `npm test -- --run src/tests/agentRuntimeSemanticPlanner.test.ts src/tests/modelSemanticPlanner.test.ts`

- [ ] **Step 3: Implement planner metadata and prompt constraints**

Add semantic frames for each dock item and target region. Update command verb/concept aliases for "挪到/移到/放到/停靠到". Update the model prompt with the rule: bottom requires explicit dock item.

- [ ] **Step 4: Verify**

Run: `npm test -- --run src/tests/agentRuntimeSemanticPlanner.test.ts src/tests/modelSemanticPlanner.test.ts`

### Task 3: Execute Dock Move in AppShell

**Files:**
- Modify: `LiteasyClaw/desktop/src/app/layout/AppShell.tsx`
- Test: `LiteasyClaw/desktop/src/tests/AppShell.test.tsx`

- [ ] **Step 1: Write failing test**

Add an AppShell command-mode test where "把 AI 助手放到下栏" moves the assistant tab to bottom and makes bottom visible. Add a test that "打开下栏" asks for clarification and does not render bottom.

- [ ] **Step 2: Run test**

Run: `npm test -- --run src/tests/AppShell.test.tsx`

- [ ] **Step 3: Implement handler**

Pass `moveDockItem` into runtime context. The handler calls `dock.moveItem(itemId, targetRegion)` and opens the target pane if target is not main. Do not create or open an empty bottom pane.

- [ ] **Step 4: Verify**

Run: `npm test -- --run src/tests/AppShell.test.tsx`

### Task 4: Full Verification

**Files:**
- No new production files.

- [ ] **Step 1: Run full tests**

Run: `npm test`

- [ ] **Step 2: Run build**

Run: `npm run build`
