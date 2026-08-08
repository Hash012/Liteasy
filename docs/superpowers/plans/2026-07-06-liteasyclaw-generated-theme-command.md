# Generated Theme Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build AI-assisted command-generated theme colors and button styles using structured generated theme tokens instead of fixed presets.

**Architecture:** Add `theme.apply_generated` to the existing Capability / Action Registry, let the model semantic planner produce schema-bound theme tokens, validate those tokens deterministically, and render them through CSS custom properties on `AppShell`. The model chooses intent and tokens, but local code owns validation, execution, and rendering.

**Tech Stack:** React, TypeScript, Vitest, existing LiteasyClaw agent runtime, action registry, CSS custom properties.

---

## File Structure

- Create `products/liteasy/apps/desktop/src/app/features/theme/generatedTheme.ts`: shared generated theme types, runtime validation, contrast helpers, CSS variable conversion.
- Modify `products/liteasy/apps/desktop/src/app/features/skills/actionRegistry.ts`: add generated theme schema, action union, metadata, execution handler, and semantic signals.
- Modify `products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`: add generated theme runtime action typing.
- Modify `products/liteasy/apps/desktop/src/app/features/agent-runtime/modelSemanticPlanner.ts`: prompt the model to use `theme.apply_generated` for free-form visual commands and keep schema safety.
- Modify `products/liteasy/apps/desktop/src/app/layout/AppShell.tsx`: replace two-state runtime theme with typed runtime theme and apply generated CSS variables.
- Modify `products/liteasy/apps/desktop/src/app/styles/app.css`: consume generated button and surface variables without disrupting existing layout.
- Test `products/liteasy/apps/desktop/src/tests/generatedTheme.test.ts`: generated theme validator and CSS variable conversion.
- Test `products/liteasy/apps/desktop/src/tests/actionRegistry.test.ts`: action metadata and execution.
- Test `products/liteasy/apps/desktop/src/tests/modelSemanticPlanner.test.ts`: model-generated theme plan normalization and validation.
- Test `products/liteasy/apps/desktop/src/tests/AppShell.test.tsx`: generated theme CSS variables and reset behavior.

## Task 1: Generated Theme Domain Module

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/theme/generatedTheme.ts`
- Test: `products/liteasy/apps/desktop/src/tests/generatedTheme.test.ts`

- [ ] **Step 1: Write failing validator tests**

```ts
import {
  createGeneratedThemeStyle,
  parseGeneratedThemeInput,
  type GeneratedThemeInput
} from "../app/features/theme/generatedTheme";

const validTheme: GeneratedThemeInput = {
  buttons: {
    borderWidth: 1,
    fill: "solid",
    hoverLift: 2,
    radius: 5,
    shadow: "crisp",
    weight: "strong"
  },
  density: "comfortable",
  intent: "冷静的赛博实验室",
  name: "冷静赛博实验室",
  palette: {
    accent1: "#1B66B3",
    accent2: "#2F8F61",
    accent3: "#B06B19",
    ink1: "#101820",
    ink2: "#526071",
    line1: "#C7D3DF",
    line2: "#AEBCCD",
    paper0: "#F8FBFC",
    paper1: "#EEF5F8",
    paper2: "#E2EDF3"
  },
  rationale: "更冷静，按钮更锐利。",
  scope: ["global", "buttons"],
  surfaces: {
    blur: 8,
    surface1Alpha: 0.92,
    surface2Alpha: 0.86
  }
};

test("accepts a bounded generated theme and creates CSS variables", () => {
  const parsed = parseGeneratedThemeInput(validTheme);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) {
    return;
  }

  expect(parsed.theme.scope).toEqual(["global", "buttons"]);
  expect(createGeneratedThemeStyle(parsed.theme)).toMatchObject({
    "--accent-1": "#1B66B3",
    "--button-border-width": "1px",
    "--button-hover-transform": "translateY(-2px)",
    "--button-radius": "5px"
  });
});

test("rejects arbitrary CSS strings and invalid color values", () => {
  const parsed = parseGeneratedThemeInput({
    ...validTheme,
    palette: {
      ...validTheme.palette,
      accent1: "url(javascript:alert(1))"
    }
  });

  expect(parsed).toMatchObject({
    ok: false
  });
});

test("rejects unreadable generated palettes", () => {
  const parsed = parseGeneratedThemeInput({
    ...validTheme,
    palette: {
      ...validTheme.palette,
      ink1: "#F8FBFC"
    }
  });

  expect(parsed).toMatchObject({
    ok: false
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- --run src/tests/generatedTheme.test.ts`

Expected: FAIL because `generatedTheme.ts` does not exist.

- [ ] **Step 3: Implement generated theme parsing and CSS variables**

Create `GeneratedThemeInput`, `GeneratedTheme`, `parseGeneratedThemeInput`, `createGeneratedThemeStyle`, strict hex validation, enum validation, numeric bounds, and WCAG-style contrast checks.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- --run src/tests/generatedTheme.test.ts`

Expected: PASS.

## Task 2: Register and Execute Generated Theme Action

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/skills/actionRegistry.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts`
- Test: `products/liteasy/apps/desktop/src/tests/actionRegistry.test.ts`

- [ ] **Step 1: Write failing action registry tests**

```ts
test("registers generated theme metadata for model-assisted theme planning", () => {
  const metadata = getRegisteredActionMetadata();
  const action = metadata.find((item) => item.actionId === "theme.apply_generated");

  expect(action).toMatchObject({
    family: "theme",
    inverseActionId: "theme.reset",
    requiresConfirmation: false,
    riskLevel: "low"
  });
  expect(action?.inputSchema.properties?.palette.type).toBe("object");
  expect(action?.inputSchema.properties?.buttons.type).toBe("object");
});

test("executes a generated theme through the generated theme handler", async () => {
  const applyGeneratedTheme = vi.fn(() => "已根据命令生成冷静赛博实验室主题。");

  const result = await executeAction(
    {
      actionId: "theme.apply_generated",
      input: {
        buttons: {
          borderWidth: 1,
          fill: "solid",
          hoverLift: 2,
          radius: 5,
          shadow: "crisp",
          weight: "strong"
        },
        intent: "冷静的赛博实验室",
        name: "冷静赛博实验室",
        palette: {
          accent1: "#1B66B3",
          accent2: "#2F8F61",
          accent3: "#B06B19",
          ink1: "#101820",
          ink2: "#526071",
          line1: "#C7D3DF",
          line2: "#AEBCCD",
          paper0: "#F8FBFC",
          paper1: "#EEF5F8",
          paper2: "#E2EDF3"
        },
        scope: ["global", "buttons"]
      }
    },
    {
      applyGeneratedTheme
    }
  );

  expect(applyGeneratedTheme).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "冷静赛博实验室",
      scope: ["global", "buttons"]
    })
  );
  expect(result.message).toBe("已根据命令生成冷静赛博实验室主题。");
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- --run src/tests/actionRegistry.test.ts`

Expected: FAIL because `theme.apply_generated` is not registered.

- [ ] **Step 3: Add action types, schema, metadata, and executor branch**

Import generated theme types, add `applyGeneratedTheme` to `ActionContext`, add `theme.apply_generated` to action unions, define schema with required theme tokens, and execute through the new handler.

- [ ] **Step 4: Run action registry tests**

Run: `npm test -- --run src/tests/actionRegistry.test.ts`

Expected: PASS.

## Task 3: Model Planner Generated Theme Semantics

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/agent-runtime/modelSemanticPlanner.ts`
- Test: `products/liteasy/apps/desktop/src/tests/modelSemanticPlanner.test.ts`

- [ ] **Step 1: Write failing model planner tests**

Add a mocked model transport response that returns `theme.apply_generated` for "把界面调成冷静的赛博实验室，按钮锐利一点", then assert the planner emits the generated theme action with scope and button tokens.

- [ ] **Step 2: Run failing planner test**

Run: `npm test -- --run src/tests/modelSemanticPlanner.test.ts`

Expected: FAIL until runtime action typings and planner prompt support generated theme payloads.

- [ ] **Step 3: Update runtime action types and planner prompt**

Add `theme.apply_generated` to runtime action unions and update the model planner prompt with explicit safety and schema guidance for generated theme commands.

- [ ] **Step 4: Run planner tests**

Run: `npm test -- --run src/tests/modelSemanticPlanner.test.ts`

Expected: PASS.

## Task 4: AppShell Runtime Rendering

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/layout/AppShell.tsx`
- Modify: `products/liteasy/apps/desktop/src/app/styles/app.css`
- Test: `products/liteasy/apps/desktop/src/tests/AppShell.test.tsx`

- [ ] **Step 1: Write failing AppShell tests**

Add a command-mode test where the mocked planner returns `theme.apply_generated`; assert `.app-frame` receives generated CSS variables. Add a reset command assertion that generated variables are removed.

- [ ] **Step 2: Run failing AppShell tests**

Run: `npm test -- --run src/tests/AppShell.test.tsx`

Expected: FAIL because AppShell only supports `default | playful`.

- [ ] **Step 3: Implement typed runtime theme state**

Replace the two-value runtime theme state with `RuntimeTheme`, parse generated theme input in `applyGeneratedTheme`, set CSS variable style on `.app-frame`, and keep preset compatibility.

- [ ] **Step 4: Add CSS variable consumers**

Update button and pane styles to consume generated button CSS variables while preserving the existing default and playful theme behavior.

- [ ] **Step 5: Run AppShell tests**

Run: `npm test -- --run src/tests/AppShell.test.tsx`

Expected: PASS.

## Task 5: Integration Verification

**Files:**
- Modify if needed: tests touched by type/schema changes.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- --run \
  src/tests/generatedTheme.test.ts \
  src/tests/actionRegistry.test.ts \
  src/tests/modelSemanticPlanner.test.ts \
  src/tests/AppShell.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add products/liteasy/apps/desktop/src/app/features/theme/generatedTheme.ts \
  products/liteasy/apps/desktop/src/app/features/skills/actionRegistry.ts \
  products/liteasy/apps/desktop/src/app/features/agent-runtime/agentRuntime.types.ts \
  products/liteasy/apps/desktop/src/app/features/agent-runtime/modelSemanticPlanner.ts \
  products/liteasy/apps/desktop/src/app/layout/AppShell.tsx \
  products/liteasy/apps/desktop/src/app/styles/app.css \
  products/liteasy/apps/desktop/src/tests/generatedTheme.test.ts \
  products/liteasy/apps/desktop/src/tests/actionRegistry.test.ts \
  products/liteasy/apps/desktop/src/tests/modelSemanticPlanner.test.ts \
  products/liteasy/apps/desktop/src/tests/AppShell.test.tsx \
  docs/superpowers/plans/2026-07-06-liteasyclaw-generated-theme-command.md
git commit -m "feat: generate command themes"
```

Expected: implementation commit includes only generated theme command changes and this plan.

## Self-Review

- Spec coverage: the plan implements structured AI-generated theme action, layer scope, validation, rendering, planner behavior, overlay-compatible execution, reset, and multi-action compatibility through existing ordered action flow.
- Placeholder scan: no `TBD`, `TODO`, or undefined future work remains.
- Type consistency: `theme.apply_generated`, `GeneratedThemeInput`, `GeneratedTheme`, `applyGeneratedTheme`, and generated CSS variables are named consistently across tasks.
