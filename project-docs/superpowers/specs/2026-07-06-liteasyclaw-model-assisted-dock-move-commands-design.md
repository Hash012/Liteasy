# LiteasyClaw Model-Assisted Dock Move Commands Design

## Goal

Improve command-mode UI layout control while preserving the intent-native architecture in `2026-07-05-liteasyclaw-intent-native-generative-ui-architecture-rendered.html`.

## Scope

This iteration only covers UI and layout actions. It adds a registered dock move action so commands can move an explicit tab to a region, for example "把 AI 助手放到下栏" or "把文献库移到右侧".

There is no standalone "open bottom pane" action. A bottom region becomes visible only when a command identifies a concrete dock item to move there. Commands such as "打开下栏" must ask for clarification because the target tab is missing.

## Architecture

The model-assisted semantic planner remains the primary command-mode interpretation path. It receives runtime context and registered action metadata, then returns a structured `SemanticActionPlan`. The runtime still validates the plan before execution and only dispatches registered actions.

The deterministic planner remains a safety fallback and common-phrase accelerator. It must not bypass policy or invent actions. The execution owner for dock moves is AppShell/Dock layout state; the model never mutates React state directly.

## Action Contract

Add `dock.move_item` with input:

```json
{
  "itemId": "assistant | library | organization | profile | settings",
  "targetRegion": "bottom | left | right"
}
```

`reader` is excluded because it belongs to the main content region. Static `artifacts` is excluded because generated multimodal artifacts are dynamic center tabs, not default dock items.

## Semantics

The planner should map free language into object plus target:

- "把 AI 助手放到下栏" -> `dock.move_item`, `{ "itemId": "assistant", "targetRegion": "bottom" }`
- "文献库挪到右侧" -> `dock.move_item`, `{ "itemId": "library", "targetRegion": "right" }`
- "设置放到左边" -> `dock.move_item`, `{ "itemId": "settings", "targetRegion": "left" }`

If either object or target is missing, return a clarification request. In particular, "打开下栏" is missing the dock item and should ask which tab to move to the bottom.

## Tests

Coverage must include:

- deterministic planner recognizes common dock move phrases
- model planner can return and normalize `dock.move_item`
- invalid model actions or invalid dock move inputs are rejected by validation
- AppShell executes `dock.move_item` through dock layout owner
- "打开下栏" produces clarification instead of empty bottom pane
