# LiteasyClaw AI-Native Interaction Runtime Design

## 1. Goal

LiteasyClaw's next product priority is AI-native interaction.

This means the right assistant must stop being only a chat surface. It should become the user's entry point into a controlled agent runtime that can understand goals, inspect current context, choose skills, request confirmation, call safe actions, create tasks, and return results into the workbench.

The near-term goal is:

> Let users collaborate with LiteasyClaw through natural language while every state-changing behavior still goes through explicit `skill -> action -> policy -> execution` boundaries.

Multimodal output remains important, but in this milestone it is treated as a capability invoked by the agent runtime, not as the main development axis.

## 2. Current Baseline

The current product already has valuable AI-native foundations:

- a desktop workbench with left / center / right panes
- selected-document-set semantics
- import and analysis entry points
- a right assistant with three user-facing modes
- basic command routing
- `skillRegistry` and `actionRegistry` modules
- resource class and action policy modules
- assistant answer generation, source positioning, model chain, and audit display
- artifact tabs and basic multimodal entry points

The main gap is that many decisions still live in UI components, local rule handlers, or demo-specific flows. The assistant can answer and trigger some commands, but it is not yet a formal runtime that owns intent, planning, skill execution, task lifecycle, and result routing.

## 3. Product Principles

### 3.1 Assistant Is A Control Surface, Not The Product Boundary

The right assistant is the user's natural-language entry point. It should not own business logic directly.

It sends structured requests into the agent runtime and renders:

- what the system understood
- what context is being used
- what skill or task will run
- whether confirmation is required
- what happened after execution

### 3.2 Natural Language Cannot Directly Mutate State

User text can select a skill or ask for clarification, but it cannot directly change settings, files, organization state, workspace state, or cloud data.

All mutations must pass through:

`natural language -> intent -> skill -> action request -> policy check -> execution -> structured result`

### 3.3 Context Must Be Visible

AI-native interaction needs trust. The user should see the important context the runtime is using:

- current workspace
- selected document set
- lock and import status
- whether cloud account is connected
- network recommendation status
- profile sampling status
- current organization workspace, if any

This should be shown as compact context chips or an expandable context panel, not as long explanatory copy.

### 3.4 Multimodal Output Is A Runtime Capability

Tree expansion, mind maps, PPT, charts, and other modalities should be modeled as artifact-producing skills.

For this milestone, implement one representative path end to end:

`natural language request -> multimodal skill -> import check -> task request -> artifact tab`

The first recommended path is:

> "用思维导图解释当前选中文献集"

## 4. Target User Experience

### 4.1 Normal Assistant Flow

1. User types a natural-language goal in the right assistant.
2. Runtime identifies intent and required context.
3. If context is missing, the assistant asks a short clarification.
4. If the request changes state or starts a costly task, the assistant shows a confirmation card.
5. Runtime executes a registered skill.
6. Skill emits one or more structured outputs:
   - assistant reply
   - action request
   - task request
   - artifact request
   - clarification request
7. UI routes the output to the right surface:
   - right pane for text and status
   - left pane for workspace, recommendation, collection, or organization state
   - center pane for artifacts and source-grounded views

### 4.2 Example: Setting Control

User:

> 关闭联网推荐

Runtime output:

```json
{
  "intent": "settings.update",
  "skillId": "settings.adjust",
  "action": {
    "actionId": "settings.update",
    "target": "recommendations.network.enabled",
    "value": false
  },
  "riskLevel": "low",
  "requiresConfirmation": false
}
```

The assistant displays a concise execution result:

> 已关闭联网推荐。关联推荐将只使用当前可用缓存和本地上下文。

### 4.3 Example: Multimodal Artifact

User:

> 用思维导图解释这几篇论文的关系

Runtime checks:

- selected document set exists
- selection is locked
- documents are imported, or import can be started
- mind map skill is registered

If not imported, the assistant shows:

> 需要先导入当前选中文献集。我会解析、切块并建立索引，然后生成思维导图。

After confirmation or automatic low-risk import, runtime creates a task:

```json
{
  "taskType": "artifact.generate",
  "artifactType": "mindmap",
  "source": {
    "type": "selected_document_set"
  }
}
```

When complete, the center pane opens a new artifact tab.

## 5. Architecture

### 5.1 Runtime Boundary

Add a formal assistant runtime boundary in the desktop feature layer first. It can later move behind a cloud workflow service without changing UI semantics.

Recommended module:

```text
LiteasyClaw/desktop/src/app/features/agent-runtime/
```

Core files:

- `agentRuntime.types.ts`
- `intentRouter.ts`
- `contextBuilder.ts`
- `skillExecutor.ts`
- `runtimeResultRouter.ts`
- `confirmationPolicy.ts`

### 5.2 Runtime Input

The runtime input should be explicit:

```ts
type AgentRuntimeInput = {
  message: string;
  mode: "explain" | "command" | "qa";
  context: AgentContext;
};
```

`AgentContext` should include:

- active workspace metadata
- selected paper ids
- selection lock state
- import state
- active account session
- active organization summary
- settings snapshot
- profile status
- recent assistant history

### 5.3 Runtime Output

The runtime should return a discriminated union:

```ts
type AgentRuntimeEvent =
  | { type: "assistant_reply"; message: string; citations?: Citation[] }
  | { type: "clarification_request"; question: string; missing: string[] }
  | { type: "confirmation_request"; summary: string; action: ActionRequest }
  | { type: "action_request"; action: ActionRequest }
  | { type: "task_request"; task: TaskRequest }
  | { type: "artifact_request"; artifact: ArtifactRequest }
  | { type: "runtime_error"; message: string; recovery?: string };
```

The assistant UI should render these events. It should not infer hidden behavior from free-form text.

### 5.4 Skill Registry

The existing skill registry should evolve from a list of labels into executable skill definitions:

```ts
type SkillDefinition = {
  id: string;
  title: string;
  description: string;
  acceptedIntents: string[];
  requiredContext: AgentContextRequirement[];
  riskLevel: "low" | "medium" | "high";
  run(input: SkillInput): Promise<AgentRuntimeEvent[]>;
};
```

Initial required skills:

- `settings.adjust`
- `workspace.open_shared_library`
- `recommendations.refresh`
- `papers.import_selected_set`
- `qa.answer_with_sources`
- `artifact.generate_mindmap`

### 5.5 Action Registry

Actions remain narrower than skills. They mutate state or trigger concrete software behavior.

Initial action groups:

- `settings.update`
- `workspace.switch_source`
- `workspace.return_local`
- `recommendations.clear_cache`
- `recommendations.refresh`
- `import.start_selected_set`
- `artifact.open_tab`
- `profile.toggle_sampling`

Each action must define:

- schema
- resource class
- risk level
- confirmation requirement
- executor
- structured success / failure result

### 5.6 Task Lifecycle

AI-native interaction should support work that takes time.

Introduce a simple task lifecycle before building a full cloud queue:

```ts
type RuntimeTaskStatus =
  | "queued"
  | "running"
  | "waiting_for_confirmation"
  | "waiting_for_context"
  | "failed"
  | "completed";
```

Tasks should be visible in the assistant as compact status cards and linked to resulting center-pane artifacts.

## 6. UI Changes

### 6.1 Right Pane

The assistant should render more than chat bubbles:

- context chips above or near the composer
- execution cards for skills and actions
- confirmation cards for medium/high risk actions
- task cards for long-running work
- concise error recovery prompts

Avoid long instructional text. Use compact status labels and tooltips.

### 6.2 Center Pane

The center pane should become the primary result surface for artifacts:

- source-grounded answer views
- mind map artifact tab
- tree expansion node tab
- future PPT / chart / flow tabs

For this milestone, only one artifact path needs to be runtime-driven.

### 6.3 Left Pane

The left pane should expose enough state for the runtime to feel grounded:

- selected set and lock state
- import status per selected item
- current workspace source
- recommendation state

## 7. Accuracy Requirements

AI-native interaction is not useful if the agent acts on the wrong context.

Minimum requirements:

- every QA answer using papers must cite source snippets or locations
- every multimodal artifact must retain source references in its metadata
- every state-changing action must be auditable as a structured event
- if selected documents are missing or not imported, runtime must say that before answering as if it had context
- model output should not be allowed to invent available actions

## 8. Performance Requirements

The runtime should feel responsive even when the underlying task is slow.

Minimum requirements:

- intent routing and context validation should return quickly
- long-running work should become a task, not block the assistant
- assistant should show task progress states
- repeated context building should use local store snapshots instead of repeated network calls where possible
- multimodal generation should open a pending artifact tab or task card before final content is ready

## 9. Implementation Phasing

### Phase A: Runtime Skeleton

- add runtime input/output types
- add context builder
- add intent router for current command examples
- route assistant messages through runtime
- keep current UI behavior passing

### Phase B: Safe Actions

- turn existing command handlers into registered actions
- enforce action policy and confirmation
- render action results as structured assistant events

### Phase C: Context Transparency

- add context chips/panel
- show selected set, lock, import, workspace, cloud, and profile state
- add missing-context clarification flows

### Phase D: One Multimodal Runtime Path

- add `artifact.generate_mindmap` skill
- create runtime task
- open center-pane artifact tab from runtime output
- attach selected-document-set metadata and source references

### Phase E: Cloud Workflow Preparation

- design server-side endpoint shape for future runtime execution
- keep desktop runtime as local-first fallback
- do not migrate everything to cloud until the local runtime semantics are stable

## 10. Non-Goals

This milestone does not:

- build the full formal SaaS backend
- implement all multimodal formats
- implement voice input
- implement production PDF parsing if that would block runtime design
- build a public plugin marketplace
- replace the existing three-pane workbench

## 11. Acceptance Criteria

The milestone is successful when:

1. A user can issue at least three natural-language commands and see structured runtime execution, not ad hoc text handling.
2. The assistant can explain what context it is using.
3. State-changing actions pass through registered action schemas and policy checks.
4. Missing context produces a clarification request instead of a misleading answer.
5. One multimodal artifact path is initiated through the runtime and opens in the center pane.
6. Tests cover runtime routing, context validation, action policy, confirmation behavior, and the representative artifact path.

## 12. Recommended Next Plan

Create an implementation plan for:

```text
LiteasyClaw AI-Native Interaction Runtime Phase A-B
```

The first implementation plan should cover only:

- runtime type definitions
- context builder
- intent router
- migration of existing command routing into runtime events
- two safe actions
- one confirmation-required action
- focused tests

Do not start with multimodal generation. Add the multimodal path only after the runtime can safely understand and execute ordinary commands.
