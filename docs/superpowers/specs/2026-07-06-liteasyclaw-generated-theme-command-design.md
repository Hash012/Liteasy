# LiteasyClaw Generated Theme Command Design

Date: 2026-07-06

## Goal

LiteasyClaw command mode should let users describe a desired visual mood in natural language and have AI generate a matching theme, including colors and button styling. The result must not be limited to a small preset list. Different user wording and different model interpretation should be able to produce distinct, personalized visual states.

The feature must still follow the intent-native generative UI architecture in `docs/superpowers/specs/2026-07-05-liteasyclaw-intent-native-generative-ui-architecture-rendered.html`: the model plans structured actions, deterministic code validates and executes them, and UI feedback is generated through the workbench overlay / UI DSL path.

## Scope

In scope:

- Add a model-assisted generated theme action.
- Let command mode understand free-form theme requests such as "调成雨夜实验室，按钮利落一点".
- Let the model choose visual layers when the user names them, such as global workbench, reader, panels, buttons, or floating controls.
- Apply generated colors and button style through CSS custom properties after validation.
- Keep `theme.reset` and existing preset behavior compatible.
- Support generated theme actions inside multi-action command plans.

Out of scope:

- Arbitrary CSS injection.
- Model-generated selectors, class names, URLs, scripts, fonts, layout mutations, or DOM edits.
- Theme commands opening/closing panes, moving tabs, splitting layout, or changing artifact history.
- Persisting generated themes across app restarts unless explicitly added in a later feature.

## User Semantics

Default behavior:

- If the user asks for a general visual mood, apply generated color and button tokens across the workbench.
- If the user asks only about buttons, only button tokens should change.
- If the user names a layer, the model may set the generated theme scope to that layer.
- If the user asks to reset, use `theme.reset`.

Examples:

- "界面换成冷静的科研夜读风格" -> generated global theme.
- "按钮做得更硬朗，像实验仪器" -> generated button scope.
- "阅读区调成护眼纸感，其他地方别动" -> generated reader scope.
- "把组织面板放到底栏，然后界面调成清爽的晨间研究室" -> ordered actions: `dock.move_item`, then `theme.apply_generated`.

## Action Contract

Add a new low-risk reversible action:

```ts
actionId: "theme.apply_generated"
input: {
  name: string;
  intent: string;
  scope: Array<"global" | "reader" | "panels" | "tabs" | "buttons" | "floating_controls">;
  palette: {
    paper0: string;
    paper1: string;
    paper2: string;
    ink1: string;
    ink2: string;
    line1: string;
    line2: string;
    accent1: string;
    accent2: string;
    accent3: string;
  };
  surfaces?: {
    surface1Alpha?: number;
    surface2Alpha?: number;
    blur?: number;
  };
  buttons: {
    radius: number;
    borderWidth: number;
    shadow: "none" | "subtle" | "raised" | "crisp";
    fill: "flat" | "soft" | "solid" | "glass";
    weight: "quiet" | "balanced" | "strong";
    hoverLift: number;
  };
  density?: "compact" | "comfortable" | "spacious";
  rationale?: string;
}
```

Validation rules:

- Colors must be CSS-safe hex values in `#RRGGBB` format.
- Alpha values must be bounded numeric values.
- Radius, border width, blur, and hover lift must be bounded numeric values.
- Enum fields must match the schema exactly.
- Strings are labels or explanations only; they must never become CSS, selectors, URLs, or class names.
- Generated palette must pass minimum contrast checks for core surfaces and ink.
- Invalid generated themes fail before execution and produce a recoverable command error.

## Runtime State

Replace the current two-value runtime theme state with a typed state:

```ts
type RuntimeTheme =
  | { kind: "default" }
  | { kind: "preset"; preset: "playful" }
  | { kind: "generated"; theme: GeneratedTheme };
```

`theme.apply_preset` maps to `{ kind: "preset", preset: "playful" }` or default for backwards compatibility.

`theme.apply_generated` maps to `{ kind: "generated", theme }`.

`theme.reset` maps to `{ kind: "default" }`.

## Rendering Model

Generated themes are rendered by setting CSS custom properties on the `.app-frame` root. The app should not inject raw CSS.

Core variables:

- `--paper-0`, `--paper-1`, `--paper-2`
- `--ink-1`, `--ink-2`
- `--line-1`, `--line-2`
- `--accent-1`, `--accent-2`, `--accent-3`
- `--surface-1`, `--surface-2`
- `--button-radius`, `--button-border-width`, `--button-shadow`, `--button-hover-transform`

Layer scope is represented by safe data attributes or CSS variable groups controlled by React state. It must not alter pane collapse state, dock item placement, tab count, or generated artifact lifecycle.

## Planner Behavior

The model semantic planner remains the source of semantic generalization. It should receive the registered `theme.apply_generated` action schema and be explicitly instructed:

- Theme requests that use descriptive moods should prefer `theme.apply_generated`.
- Do not invent CSS or arbitrary style fields.
- Decompose compound commands into ordered actions.
- Keep the existing rule that bottom pane cannot be opened by itself; moving a specific tab to bottom remains `dock.move_item`.
- If the user only asks for a default reset, use `theme.reset`.

The deterministic fallback planner can continue to match legacy preset phrases such as "卡通风格" to `theme.apply_preset`, but free-form generated themes require the model planner path.

## Execution and Feedback

The action registry executes generated themes through a new `applyGeneratedTheme` handler on `ActionContext`.

On success:

- Apply validated runtime theme state.
- Generate a workbench overlay explaining the interpreted theme, selected scope, and visible changes.
- Record the action in the execution journal like other UI actions.

On failure:

- Do not partially apply the theme.
- Return a recoverable message that the generated theme failed validation.
- Allow the planner retry path to ask the model for a corrected JSON payload.

## Architecture Conformance

This design does not require a paradigm change to the existing architecture graph. It extends the existing action registry and semantic planner:

- Capability / Action Registry owns the generated theme action contract.
- Semantic Planner uses the LLM API to interpret open-ended visual commands.
- Structured Output Adapter and plan validator enforce schema shape.
- Deterministic runtime validation enforces CSS safety and contrast.
- Action Executor applies only validated tokens.
- UI DSL Generator / Workbench Overlay provides user-visible feedback.

The model still does not own execution, selectors, or rendering authority.

## Testing

Add focused tests before implementation:

- Action registry lists and validates `theme.apply_generated`.
- Generated theme execution calls the generated theme handler with validated input.
- Invalid colors, out-of-range numbers, arbitrary CSS strings, or unknown enum values are rejected.
- Model semantic planner can normalize a free-form theme command into `theme.apply_generated`.
- Multi-action plans can include generated theme actions in order.
- `AppShell` applies generated CSS variables and resets them with `theme.reset`.
- Existing preset tests still pass.
- Build and full test suite pass after implementation.

## Acceptance Criteria

- A command like "把界面调成冷静的赛博实验室，按钮锐利一点" uses the model planner and applies a generated theme, not a fixed preset.
- A command like "阅读区调成护眼纸感，其他区域保持原样" scopes visual changes to the reader.
- A command like "按钮做得像精密仪器一样硬朗" changes button styling without changing layout.
- Compound commands execute in order when they include generated theme actions.
- No generated theme can inject raw CSS, scripts, selectors, URLs, or layout mutations.
- Reset returns to the default theme.
