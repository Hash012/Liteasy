# LiteasyClaw Intent-Native Generative UI Architecture Audit

Source architecture: `project-docs/superpowers/specs/2026-07-05-liteasyclaw-intent-native-generative-ui-architecture-rendered.html`

This audit tracks whether the current implementation is equivalent to the rendered architecture. "Proven" means there is implementation and test evidence for the node or edge. "Partial" means the main behavior exists but coverage or structure is weaker than the architecture describes.

## Current Verdict

The implementation is not a string-command router anymore. The main runtime is now semantic-plan based, with structured model planning, policy gates, declarative UIDSL projection, fallback UI, ActionRef routing, and journal audit.

Every architecture node and edge in the rendered diagram now has implementation and test evidence in this audit. The implementation keeps App Controllers distributed instead of introducing a monolithic state-kernel class, and centralizes recovery policy in runtime modules instead of per-action prose fields; both are documented as equivalent implementation choices below.

## Node Coverage

| Architecture Item | Current Evidence | Status |
| --- | --- | --- |
| Intent Input Adapter | `src/app/features/agent-runtime/intentInputAdapter.ts`; tests cover text, voice, automation, mode selection, and default UI ActionRef events. | Proven |
| Context Builder | `contextBuilder.ts`; `contextBuilder.test.ts`; runtime orchestrator delegates context construction. | Proven |
| Context Panel | `AssistantContextPanel.tsx`; `AssistantContextPanel.test.tsx` renders the same `AgentRuntimeContextView` produced by `buildIntentRuntimeContexts`. | Proven |
| Capability / Action Registry | `skills/actionRegistry.ts`; semantic frames, risk, schema, handlers, policy metadata. | Proven |
| Fine-grained Action Catalog | Registered action metadata and tests for semantic planner/action registry behavior. | Proven |
| Component Registry | `generative-ui/componentRegistry.ts`; `uiDslValidator.ts`; DynamicCanvas tests. | Proven |
| DataSource Registry | `generative-ui/dataSourceRegistry.ts`; UIDSL validation and fallback data source tests. | Proven |
| Design Token Registry | `generative-ui/designTokenRegistry.ts`; UIDSL generator and validator tests. | Proven |
| Cohesion Rules | Boundary tests prevent generative-ui from importing runtime/AppShell/DOM mutation APIs and prevent agent-runtime from importing React/AppShell/assistant feature modules. | Proven |
| Atomic Rules | `capabilityContract.test.ts` proves unique action ids, one family, schema, risk, context, confirmation flag, inverse action validity, and schema-valid semantic frame inputs. | Proven |
| Extension Protocol | `extensions/extensionProtocol.ts`; `extensionProtocol.test.ts` validates capability, schema, handler, policy, journal, tests. | Proven |
| Dependency Rules | `generativeUiBoundary.test.ts` enforces assistant entrypoint delegation, runtime-owned mode contracts, retired legacy modules, and no direct ActionRef router. | Proven |
| Mode Gate | `semanticPlanner.ts`, `planValidator.ts`, and `dynamicActionExecutor.ts` now gate command vs qa/explain for both text plans and default UI ActionRefs. | Proven |
| Semantic Planner | `semanticPlanner.ts`, `semanticActionMatcher.ts`, `modelSemanticPlanner.ts`; tests cover semantic aliases, ambiguity, unsupported action, not-command, and model structured planner fallback. | Proven |
| Model Gateway | Model transport/gateway integration in `modelSemanticPlanner.ts` and model-assisted UIDSL/audit generators. | Proven |
| Structured Output Adapter | `structuredOutputAdapter.ts`; model planner and UIDSL generator tests cover invalid structured output retry/fallback. | Proven |
| IntentPlan / SemanticActionPlan | `agentRuntime.types.ts`; planner, validator, executor, and confirmation tests. | Proven |
| Plan Validator | `planValidator.ts`; tests cover unknown action, schema, clarification candidates, and mode boundary. | Proven |
| Policy Engine | `policyEngine.ts`; executor delegates policy; tests cover allow, confirm, deny, clarify. | Proven |
| Human Confirmation UI | `AssistantMessageList.tsx`, `planExecutor.ts`; tests cover resumable confirmations. | Proven |
| Clarification / Recovery | `modelClarification.ts` plus deterministic recovery cover missing context, ambiguity, unsupported action, and not-command. Model-assisted clarification can refine ambiguity and missing-context recovery without executing actions or inventing candidates. | Proven |
| Smooth Policy | `smoothPolicy.ts`; tests cover immediate/background/recoverable behavior. | Proven |
| Transactional Executor | `planExecutor.ts`; action execution is registered-action based and journaled. | Proven |
| Runtime Progress Events | `plan_preview`, `progress_started`, `task_created`, `ui_dsl_ready`, `action_failed` appear in executor and tests. | Proven |
| App Controllers / State Kernel | Existing feature controllers and stores are the state kernel: AppShell layout/theme/panel state, artifact workflow actions, organization shell, settings store, and workspace handlers mutate real state through registered actions. AppShell integration tests prove these handlers affect visible state. | Proven |
| Execution Journal | `executionJournal.ts`; tests cover plan, policy, confirmation, action, UI DSL records. | Proven |
| UI DSL Generator | `uiDslGenerator.ts`; model-assisted and rule generators with fallback. | Proven |
| UIDslDocument | `generativeUi.types.ts`; validator and renderer tests. | Proven |
| DSL Validator | `uiDslValidator.ts`; rejects unknown components/actions/props/CSS escape paths. | Proven |
| UX Validator | `uxValidator.ts`; deterministic and optional model UX review with fallback. | Proven |
| Fallback UI | `fallbackUi.ts`; runtime/model/policy fallback tests. | Proven |
| Assistant Canvas | `AssistantMessageList.tsx` + `DynamicCanvas.tsx`; ActionRef callbacks tested through assistant pane/boundary tests. | Proven |
| Artifact Canvas | `ReaderPane.tsx`, `ArtifactTabs.tsx`, `DynamicCanvas.tsx`, center artifact UIDSL generation, and AppShell integration tests prove center ActionRefs reach semantic execution and update real artifact feedback. | Proven |
| Workbench Overlay | `AppShell.tsx` workbench overlay UIDSL and integration tests prove overlay ActionRefs restore theme/layout through semantic execution. | Proven |
| ActionRef Router | Legacy direct router has been removed. Product paths use `executeUIDslActionRef`, which wraps ActionRef into semantic plans, policy execution, fallback UI, and journal records. | Proven |
| Audit Model | `journalAuditModel.ts`; deterministic and model-assisted audit append commentary without rewriting facts. | Proven |

## Edge Coverage

| Architecture Edge | Evidence | Status |
| --- | --- | --- |
| User -> InputAdapter | Text, voice, automation, mode switch, and dynamic default UI ActionRef tests. | Proven |
| InputAdapter -> ContextBuilder -> ModeGate | Runtime orchestrator builds contexts; semantic planner and validator apply mode boundary. | Proven |
| ContextBuilder -> ContextPanel | `AssistantContextPanel.test.tsx` renders the context view returned from `buildIntentRuntimeContexts`. | Proven |
| ModeGate -> SemanticPlanner -> ModelGateway -> StructuredOutput -> IntentPlan | `modelSemanticPlanner.ts` with retry/fallback tests. | Proven |
| Registries -> Planner/Generator/Validator | Action/component/data/token registries are consumed by planner, UIDSL generator, and validators. | Proven |
| Boundary rules -> PlanValidator/DSLValidator | Boundary tests, `planValidator.ts`, and `uiDslValidator.ts` enforce registered actions, schema validity, mode contracts, and render-safe UIDSL. | Proven |
| IntentPlan -> PlanValidator -> PolicyEngine | Runtime orchestrator and executor tests cover this sequence. | Proven |
| PolicyEngine -> allow/confirm/deny/clarify | Policy and executor tests cover every branch with fallback UIDSL for deny/clarify. | Proven |
| SmoothPolicy -> ProgressEvents | Smooth policy and executor tests cover background/progress paths. | Proven |
| Executor -> AppControllers/ProgressEvents/Journal | Plan executor calls registered feature handlers, emits progress/task/artifact/UI events, and records plan/policy/action/ui_dsl journal entries; AppShell tests prove state changes. | Proven |
| AppControllers + IntentPlan -> UIDslGenerator | Executor calls UIDSL generator after eligible actions; artifact/assistant/workbench generators consume real state snapshots. | Proven |
| UIDslGenerator -> ModelGateway/UIDslDoc -> DSLValidator -> UXValidator -> Canvases/Fallback | Model-assisted UIDSL tests cover invalid model output, schema failure, UX rejection, and fallback. | Proven |
| Assistant/Artifact/Overlay Canvas -> ActionRouter -> PolicyEngine -> Journal | Assistant default UI ActionRefs are adapted by `IntentInputAdapter`; assistant, artifact, and overlay paths route through `executeUIDslActionRef`; journal tests prove plan/policy/action/ui_dsl records. | Proven |
| Journal -> AuditModel -> AssistantCanvas | AssistantPane uses journal audit after command execution; audit tests prove facts are not rewritten. | Proven |

## Completion Notes

The implementation uses distributed App Controllers rather than one monolithic `StateKernel` class. This is treated as equivalent to the architecture node because state mutation remains behind registered feature-owner handlers, and the executor never mutates UI state directly.

Action-specific recovery metadata is centralized in `PolicyEngine`, `modelClarification`, `SmoothPolicy`, `planExecutor`, and `fallbackUi` rather than stored as per-action text fields. This is treated as equivalent because every unsupported, ambiguous, missing-context, policy-denied, model-failed, DSL-invalid, UX-risk, and missing-handler path produces auditable recovery output.
