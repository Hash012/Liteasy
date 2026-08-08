# LiteasyClaw Command Semantic Action Runtime Design

## Goal

Command mode must become LiteasyClaw's semantic action runtime.

It is not a fixed list of command aliases, and it is not limited to mind map generation. Users should be able to describe an intended outcome in natural language, and the AI brain should understand the instruction, inspect current runtime context, produce an executable action plan, and run the closest safe software actions available.

Examples:

- "把当前选中文献生成对比表" should route to a compatible artifact generation action.
- "让 UI 变成卡通风格" should route to a theme or style action when that capability is registered.
- "把窗口切分成两个" should route to layout actions when the requested layout is supported.
- "ABC" should be interpreted against current context where possible, or produce a concise clarification when it is ambiguous.

The runtime should prefer meaningful execution over rigid phrase matching, but it must still preserve explicit safety boundaries: natural language can plan actions, not directly mutate application state.

## Current Baseline

The Phase A-B runtime introduced:

- `intentRouter.ts` for command routing;
- `confirmationPolicy.ts` for confirmation decisions;
- `skillExecutor.ts` for skill execution;
- `runtimeOrchestrator.ts` for command-mode runtime events;
- `actionRegistry.ts` for controlled actions;
- Context Panel support for selected set, workspace, cloud, organization, and profile state.

The current implementation is intentionally narrow. `intentRouter.ts` still relies on phrase checks and a small set of hard-coded routes. `actionRegistry.ts` covers only a few action families: settings, selected-set import, organization shared-library open, and artifact analysis through one handler. This is useful as a safe skeleton, but it does not yet satisfy the product meaning of command mode.

## Product Definition

Command mode means:

> The user tells LiteasyClaw what they want the software to do. The AI brain translates that semantic intent into a structured, policy-checked action plan and executes registered capabilities across UI, layout, artifacts, settings, workspace, and document context.

Command mode should be able to operate the whole workbench, not only the right assistant.

In scope for the V2 design:

- semantic interpretation of free-form user commands;
- action-plan output instead of one-step direct routing;
- registry-based execution across multiple capability families;
- full compatible artifact generation, not just mind maps;
- UI operation actions such as pane layout, navigation, theme/style, and panel visibility;
- clarification and recovery when intent is unclear or unsupported;
- confirmation and safety policy before state-changing or high-cost operations;
- testable runtime outputs.

Out of scope for the first V2 implementation slice:

- arbitrary code execution;
- unrestricted CSS generation applied directly to the app;
- destructive file operations without explicit confirmation;
- cloud multi-agent autonomy without local runtime policy gates;
- fully general visual design synthesis beyond registered theme/style tokens.

## Mode Boundaries

LiteasyClaw's three assistant modes should be described this way:

- `command`: operates the software through semantic actions.
- `qa`: answers questions grounded in selected/imported documents with citations and audit.
- `explain`: explains terms, concepts, methods, metrics, or entities grounded in selected/imported documents.

Only command mode should mutate UI state, start artifact tasks, change settings, open panels, or alter layout/theme. QA and explain modes can recommend actions in text, but they should not execute actions.

## Runtime Flow

The V2 command flow is:

```text
user text
  -> semantic interpreter
  -> action planner
  -> context validator
  -> confirmation policy
  -> action executor
  -> runtime events
  -> UI result routing
```

### 1. Semantic Interpreter

The interpreter reads the message and current context, then returns a structured intent candidate.

It should not only search fixed phrases. It should classify the user's desired outcome into an intent family, such as:

- `artifact.generate`
- `layout.change`
- `theme.apply`
- `panel.open`
- `settings.update`
- `selection.import`
- `workspace.navigate`
- `organization.open_shared_library`
- `unknown`

The interpreter may be implemented in phases:

1. deterministic semantic heuristics for common commands;
2. model-backed planner behind the same interface;
3. policy-constrained cloud planning when account and organization policy allow it.

### 2. Action Planner

The planner converts the interpreted intent into a structured plan.

Recommended type shape:

```ts
export type SemanticActionPlan = {
  planId: string;
  intentId: string;
  confidence: "high" | "medium" | "low";
  summary: string;
  requiredContext: string[];
  actions: RuntimeActionInvocation[];
  riskLevel: "low" | "medium" | "high";
  requiresConfirmation: boolean;
  clarification?: {
    question: string;
    missing: string[];
  };
  unsupportedReason?: string;
};
```

`actions` should support multi-step execution. For example:

```text
"把这三篇论文做成对比表，再打开右侧总结"
```

can produce:

1. validate selected document set;
2. generate `comparison_table` artifact;
3. open artifact tab;
4. switch/right pane assistant summary mode if registered.

### 3. Context Validator

The validator checks whether required context is present before execution.

Examples:

- artifact generation from selected documents requires selected count > 0, selection locked, and imported documents ready;
- organization actions require cloud account and organization summary;
- theme/layout changes require no document context;
- destructive or costly operations require confirmation even if context is complete.

The validator should derive safety-critical decisions from actual context fields, not from caller-provided display labels.

### 4. Confirmation Policy

Confirmation should be based on risk and reversibility.

Low-risk actions can execute immediately:

- open/close panel;
- switch active pane;
- split layout into supported ratios;
- generate a non-destructive preview artifact;
- apply a reversible local theme token.

Medium-risk actions require concise confirmation when cost or scope is significant:

- start long-running artifact generation;
- import large selected sets;
- enable personalization/profile sampling;
- switch organization workspace.

High-risk actions require explicit confirmation and should include recovery text:

- delete local collections;
- overwrite saved workspace state;
- upload or synchronize user data;
- apply broad settings changes that affect privacy or billing.

## Capability Families

The action registry should evolve from a small fixed registry into typed capability families.

### Artifact Actions

Command mode must support all compatible modalities through one artifact interface.

Current `ArtifactType` includes:

```ts
type ArtifactType = "mindmap" | "tree" | "ppt";
```

V2 should keep `mindmap`, `tree`, and `ppt`, and allow extension to modalities such as:

- `comparison_table`
- `timeline`
- `concept_cards`
- `evidence_matrix`
- `graph`
- `summary_board`

The planner should map natural language to registered artifact types. If a requested modality is not registered, it should return a clear unsupported response and suggest available modalities.

### Layout Actions

Layout actions operate workbench structure.

Initial layout action ids:

- `layout.split_two`
- `layout.set_ratio`
- `layout.reset`
- `pane.toggle_left`
- `pane.toggle_right`
- `pane.toggle_bottom`
- `pane.focus`

Example:

```text
"把窗口切分成两个"
```

If the current workbench only supports left/center/right plus bottom artifact area, the runtime should choose the closest registered layout, such as a two-column reading layout with one side collapsed, or ask whether the user means "左右两栏" or "上下两栏".

### Theme And Style Actions

Theme/style actions should be semantic but constrained.

Initial action ids:

- `theme.apply_preset`
- `theme.adjust_density`
- `theme.adjust_tone`
- `theme.reset`

The runtime must not inject arbitrary generated CSS directly. Instead, it maps style language to registered tokens or presets.

Example:

```text
"让 UI 变成卡通风格"
```

can map to:

```json
{
  "actionId": "theme.apply_preset",
  "input": {
    "preset": "playful",
    "tone": "cartoon"
  }
}
```

If the preset is not available, the runtime should respond:

```text
我理解你想把界面调整为更卡通、轻松的视觉风格。当前还没有注册“卡通风格”主题能力，可以先切换到更高对比、更圆润、更轻量的预设，或保持当前主题。
```

### Panel And Navigation Actions

Initial action ids:

- `panel.open`
- `panel.close`
- `panel.toggle`
- `navigation.go_to`
- `assistant.mode_switch`

Examples:

- "打开设置"
- "回到文献库"
- "隐藏右栏"
- "切到问答模式"

### Workspace And Selection Actions

Initial action ids:

- `selection.lock`
- `selection.unlock`
- `selection.import`
- `workspace.open_local_library`
- `workspace.open_organization_shared_library`

These actions should continue to use current selection and workspace context from the Context Panel view model and the deeper runtime context.

### Settings Actions

Existing settings actions should remain registry-controlled.

Examples:

- network recommendation on/off;
- recommendation sort mode;
- profile enabled/disabled;
- model endpoint/provider settings, if policy allows.

## Unknown And Ambiguous Instructions

The runtime should not collapse unknown input into "当前命令还没有注册到安全能力表中" for every case.

It should distinguish:

- not understood: the semantic intent is unclear;
- understood but unsupported: the intent is clear but no registered capability exists;
- understood but missing context: more information or current state is required;
- understood but unsafe: confirmation or policy prevents execution.

Recommended event:

```ts
export type RuntimeClarification = {
  type: "clarification_request";
  question: string;
  missing: string[];
  understoodAs?: string;
  examples?: string[];
};
```

For input such as `ABC`, the runtime should answer based on context:

- If `ABC` matches a visible paper/title/entity/context item, ask whether to act on that item.
- If it has no context match, ask a short clarification.
- If it resembles a known command abbreviation, propose the likely action and request confirmation when needed.

## Runtime Events

Existing event types can remain, but V2 should add plan visibility.

Recommended addition:

```ts
export type AgentRuntimeEvent =
  | { type: "plan_preview"; plan: SemanticActionPlan }
  | { type: "assistant_reply"; message: string }
  | { type: "clarification_request"; question: string; missing: string[] }
  | { type: "confirmation_request"; summary: string; action: ActionRequest }
  | { type: "action_request"; action: ActionRequest }
  | { type: "task_request"; task: TaskRequest }
  | { type: "artifact_request"; artifact: ArtifactRequest }
  | { type: "runtime_error"; message: string; recovery?: string };
```

The assistant can render the plan preview compactly:

```text
我将执行：切换布局 -> 打开文献对比视图 -> 生成对比表
```

## UI Requirements

Command mode UI should make the runtime feel powerful but controlled.

Required surfaces:

- Context Panel remains visible as the runtime's current state.
- Assistant message history shows what the system understood.
- Confirmation UI is required for medium/high-risk actions.
- Runtime result messages should name the action actually executed.
- Unsupported requests should include alternatives.

The UI should avoid visible instructional copy that explains the product. It should communicate through state, concise status, and direct results.

## Testing Requirements

V2 implementation should be test-driven.

Required focused tests:

- semantic planner maps free-form artifact requests to registered artifact types;
- planner maps UI/layout instructions to layout actions;
- planner maps theme/style language to theme actions;
- unknown input returns clarification, not a generic registry error;
- unsupported but understood modality returns available alternatives;
- action plans are blocked when required context is missing;
- low-risk UI actions execute without confirmation;
- medium/high-risk actions produce confirmation requests;
- command mode remains separate from QA and explain modes.

Regression tests:

- existing Phase A-B settings commands still work;
- existing Context Panel readiness guard still blocks artifact generation when selected documents are missing, unlocked, or not imported;
- full desktop test suite and production build pass.

## Acceptance Criteria

Command Semantic Action Runtime V2 is complete when:

1. Command mode is documented and implemented as semantic action planning, not only fixed phrase routing.
2. The runtime can produce multi-step action plans.
3. Artifact generation supports all registered compatible modalities through a common registry interface.
4. UI layout, pane, navigation, and theme/style actions are represented as registered capabilities.
5. Unknown or ambiguous commands produce useful clarification instead of a generic unsupported error.
6. Unsupported but understood commands explain what is missing and suggest available alternatives.
7. Confirmation policy is applied by risk level and action family.
8. QA and explain modes continue to answer document-grounded questions without executing UI actions.
9. Focused tests, full desktop tests, and production build pass.

## Implementation Slices

Recommended order:

1. Add semantic plan types and a deterministic planner interface.
2. Replace direct phrase routing with planner-backed command orchestration while preserving current commands.
3. Introduce action capability families for artifact, layout, panel/navigation, theme/style, workspace/selection, and settings.
4. Add clarification and unsupported-intent events.
5. Wire low-risk layout/panel actions into AppShell state.
6. Add theme/style presets as constrained tokens.
7. Generalize artifact generation across all registered modalities.
8. Add model-backed semantic planning behind the same interface after deterministic behavior is covered by tests.

## Open Product Decisions

These decisions should be made before implementation planning:

1. Which artifact modalities are considered "compatible" in the next implementation slice beyond `mindmap`, `tree`, and `ppt`?
2. Should style/theme actions persist across sessions immediately, or first apply only as reversible session state?
3. Should layout commands support arbitrary ratios, or only named presets such as reading, comparison, focus, and two-column?
4. Should a model-backed planner be introduced in the first V2 slice, or should the first slice use deterministic planning with the same interfaces?
