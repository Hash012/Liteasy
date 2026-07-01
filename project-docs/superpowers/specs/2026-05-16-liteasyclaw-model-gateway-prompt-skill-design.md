# LiteasyClaw Model Gateway, Prompt Engineering, and Internal Skill Lifecycle Design

## 1. Purpose

This document defines the first formal design for three closely related LiteasyClaw foundations:

- model access and provider routing
- prompt engineering structure and versioning
- internal skill packaging, validation, and release lifecycle

The goal is not to build a public plugin ecosystem. The goal is to formalize a stable internal architecture that supports LiteasyClaw's future SaaS workflow runtime without breaking the current safety boundary:

- desktop remains the user entry point
- cloud workflow owns orchestration
- local desktop actions remain explicitly controlled
- skills are published only by the internal development team

## 2. Decisions Locked For This Design

The user-approved decisions for this design are:

1. first-version skills are published only by the internal development team
2. skill runtime is hybrid:
   - cloud workflow performs routing, context assembly, prompt rendering, model calls, and audit
   - desktop exposes only controlled local actions and local capability bridges
3. first-version model integration uses an OpenAI-compatible gateway strategy
4. Git repository files are the single source of truth for prompts, skill definitions, schemas, and evaluations

These decisions intentionally avoid:

- customer-uploaded skills
- prompt editing from an admin web UI
- direct desktop-to-model-vendor coupling
- arbitrary local code execution from skill definitions

## 3. Current State

The current repository already contains the earliest seams of the target architecture:

- `LiteasyClaw/services/dev-cloud/providers/openaiResponses.mjs`
  - a minimal OpenAI Responses API provider
- `LiteasyClaw/desktop/src/app/features/models/modelGateway.ts`
  - policy-aware model access gating
- `LiteasyClaw/desktop/src/app/features/assistant/generateAssistantAnswer.ts`
  - current prompt assembly and answer generation path
- `LiteasyClaw/desktop/src/app/features/skills/skillRegistry.ts`
  - local skill-to-action routing seam
- `LiteasyClaw/desktop/src/app/features/skills/actionRegistry.ts`
  - controlled action execution seam

However, the current state is still prototype-level:

- prompt construction is still mostly inline application logic
- skill definitions are still hardcoded TypeScript unions and conditionals
- model access is not yet a formal cloud-owned gateway layer
- local desktop action boundaries exist, but the full cloud workflow contract does not
- there is no structured skill package, validation flow, or release contract

## 4. Goal

This milestone must establish the first durable architecture for LiteasyClaw's AI runtime with these guarantees:

1. all model access is centralized behind a cloud-owned model gateway
2. prompts are treated as versioned assets, not scattered string literals
3. skills are packaged and released as structured internal artifacts
4. cloud workflow owns orchestration; desktop owns only controlled local execution surfaces
5. skill definitions cannot directly execute arbitrary code or arbitrary local operations
6. all skill and prompt changes are reviewable, testable, and reversible through Git

## 5. Scope

### In scope

- first formal model gateway contract
- first formal prompt asset structure
- first formal internal skill package layout
- skill manifest schema
- workflow-runtime / skill-registry / action-registry boundary definitions
- validation and release flow for internal skills
- environment-level skill enablement model

### Out of scope

- public marketplace
- customer or organization uploaded skills
- runtime prompt editing from admin UI
- arbitrary third-party code plugins
- multi-vendor deep abstraction for Anthropic/Gemini-native APIs in the first pass
- full production billing, rate enforcement, or operator RBAC implementation

## 6. Architecture Overview

LiteasyClaw should evolve toward four explicit layers.

### 6.1 Desktop entry layer

Responsibilities:

- three-pane user interface
- workspace and selection-set interaction
- local file and local capability bridge
- receiving workflow results and rendering them
- executing controlled local actions after explicit validation

Non-responsibilities:

- no direct vendor-specific model API integration
- no hardcoded business orchestration logic as the long-term architecture
- no arbitrary skill execution

### 6.2 Cloud workflow runtime

Responsibilities:

- intent routing
- skill selection
- context assembly
- prompt rendering
- model gateway calls
- audit pass coordination
- long-task orchestration
- structured result assembly
- action request generation

This is the real LiteasyClaw agent runtime.

### 6.3 Model gateway

Responsibilities:

- provider selection
- model allowlist enforcement
- environment-specific credentials
- retry/timeout policy
- request normalization
- trace capture
- cost and token accounting hooks

All model traffic must flow through the model gateway.

### 6.4 Skill and action control plane

Responsibilities:

- skill package loading
- manifest validation
- environment release manifest loading
- action policy checking
- version tracking
- evaluation gating before release

This layer formalizes the existing `skill registry -> action registry` prototype seam into a durable platform boundary.

## 7. Runtime Flow

The first formal runtime flow should be:

1. user acts in the desktop client
2. desktop sends a structured workflow request to cloud runtime
3. cloud runtime chooses a skill
4. cloud runtime assembles context and renders prompts
5. cloud runtime calls the model gateway
6. cloud runtime optionally calls a second audit model or audit path
7. cloud runtime decides whether a controlled action is required
8. cloud runtime emits an action request to the desktop
9. desktop validates the requested action against its local action registry
10. desktop executes the action if allowed
11. desktop returns action result payload
12. cloud runtime completes the workflow and returns structured output
13. desktop renders response, artifacts, citations, and task state

This preserves the critical safety rule:

- the model does not directly change local or platform state
- only registered actions may do so

## 8. Model Gateway Design

### 8.1 First-version provider strategy

The first version should standardize on an OpenAI-compatible gateway model.

This means LiteasyClaw can support providers that expose compatible request/response semantics by varying:

- `base_url`
- API key secret reference
- provider label
- model allowlist
- timeout and retry policy

This design keeps the first implementation small and avoids premature vendor-branching in the workflow layer.

### 8.2 Gateway contract

The first formal gateway surface should expose these normalized operations:

- `generate`
- `audit`
- `embed`

Future operations may expand to:

- `rerank`
- `ocr`
- `tts`
- `asr`
- `image_generate`
- `video_generate`

The workflow runtime must depend on these normalized operations, not on vendor-specific SDK contracts.

### 8.3 Provider configuration model

Each provider entry should support:

- `provider_id`
- `display_name`
- `protocol`
- `base_url`
- `api_key_secret_ref`
- `allowed_models`
- `capabilities`
- `default_timeout_ms`
- `retry_policy`
- `rate_limit_policy`
- `status`

Example logical config:

```yaml
provider_id: openai-prod
display_name: OpenAI Production
protocol: openai_compatible
base_url: https://api.openai.com/v1
api_key_secret_ref: secrets/openai/prod
allowed_models:
  - gpt-5-mini
  - gpt-5
capabilities:
  - generate
  - audit
  - embed
default_timeout_ms: 30000
retry_policy:
  max_attempts: 2
  backoff_ms: 800
rate_limit_policy:
  requests_per_minute: 120
status: active
```

### 8.4 Model policy boundary

Environment-level policy should be able to decide:

- which providers are available
- which models are available
- which models are allowed for which skill groups
- whether a model may be used for generation, audit, or embedding

This policy should remain outside individual skill code so environments can differ without rewriting skill assets.

## 9. Prompt Engineering Design

### 9.1 Prompt assets are versioned repository assets

Prompts must not live as scattered TypeScript strings across application logic.

They should be repository-managed assets with review history, diffs, and rollback.

Every prompt change must therefore be:

- code reviewed
- version controlled
- tied to an evaluation pass

### 9.2 Prompt layering

The first formal prompt system should be layered as:

1. global system layer
2. mode layer
3. skill layer
4. output contract layer
5. context pack layer

This should produce a final rendered prompt bundle rather than one giant unstructured string.

### 9.3 Global system layer

This layer defines LiteasyClaw-wide invariants, such as:

- do not fabricate citations
- do not claim unsupported certainty
- local or platform state must only change through registered actions
- source-grounded answers must remain traceable
- output must conform to the declared schema or retry path

### 9.4 Mode layer

This layer specializes by user-facing interaction mode:

- `explain`
- `command`
- `qa`

It contains only mode-specific behavior, not skill-specific task rules.

### 9.5 Skill layer

This layer defines the actual task-specific behavior, such as:

- explain an academic term for the user
- generate a mind map from selected papers
- suggest related literature

This layer should be the primary place for task semantics.

### 9.6 Output contract layer

This layer defines:

- expected structure
- required fields
- formatting rules
- citation requirements
- failure fallback behavior

It should be paired with JSON Schema validation where applicable.

### 9.7 Context pack layer

This layer is not handwritten instruction text alone. It is rendered structured context.

It may include:

- selected paper list
- imported chunks
- profile summary
- workspace summary
- organization context
- model policy hints

Context assembly should happen in workflow runtime, not inside random UI components.

### 9.8 Prompt assembly rule

The first standard assembly order should be:

`global system + mode prompt + skill prompt + output contract + context pack`

This order must remain consistent so prompt behavior is debuggable across skills.

### 9.9 Prompt engineering rules

The first formal rules should be:

- every skill must declare its prompt files explicitly
- every prompt-changing PR must run evaluation cases
- every question-answering skill must define whether citations are required
- every action-producing skill must define whether it may request actions and which ones
- prompt templates must not encode environment secrets
- prompt templates must not silently depend on undocumented UI state

## 10. Skill Package Design

### 10.1 First-version skill packaging model

Each skill should be a repository-managed package, not a code snippet hidden inside application logic.

A skill package is a structured directory containing:

- manifest
- prompt files
- input schema
- output schema
- evaluation cases
- package-local documentation

### 10.2 Recommended repository layout

```text
skills/
  paper.explain_term/
    manifest.yaml
    README.md
    prompts/
      system.md
      skill.md
      output.md
      retry.md
    schemas/
      input.schema.json
      output.schema.json
    evals/
      basic-cases.json
      edge-cases.json
    changelog.md

packages/
  skill-sdk/
    manifest.schema.json
    validators/
    prompt-renderer/
    eval-runner/

LiteasyClaw/services/
  workflow-runtime/
  model-gateway/
  skill-registry/
```

The desktop application should keep only the local execution-side boundary and not become the source of truth for skill content.

## 11. Skill Manifest Design

### 11.1 Required manifest fields

The first formal manifest should include:

- `id`
- `version`
- `owner`
- `status`
- `runtime`
- `entry_modes`
- `routing_hints`
- `required_context`
- `allowed_models`
- `allowed_actions`
- `input_schema`
- `output_schema`
- `prompt_files`
- `guardrails`
- `eval_suite`
- `release`

### 11.2 Field meanings

#### id

Globally unique skill identifier, for example:

- `paper.explain_term`
- `artifact.generate_mindmap`

#### version

Semantic version for release tracking and rollback.

#### owner

The responsible internal team or maintainer.

#### status

Allowed values:

- `draft`
- `active`
- `deprecated`

#### runtime

For this design, this should be `cloud`.

This field remains explicit so future runtime expansion is possible without redefining the package format.

#### entry_modes

Which user-facing interaction modes can invoke the skill:

- `explain`
- `command`
- `qa`

#### routing_hints

Metadata to help intent routing without turning the manifest into a brittle rule engine.

This may contain:

- intent labels
- keyword hints
- prohibited contexts

#### required_context

Declares which context blocks must or may be provided, such as:

- `selected_set`
- `imported_chunks`
- `profile_summary`
- `workspace_summary`
- `organization_context`

#### allowed_models

Declares the allowed model ids or model groups for this skill.

#### allowed_actions

Declares which registered actions this skill may request.

This field is mandatory because action authority must never be inferred implicitly from prompt text.

#### input_schema and output_schema

Paths to JSON Schema definitions.

These schemas define both runtime validation and evaluation-case format.

#### prompt_files

Explicit file mapping for prompt layers used by this skill.

#### guardrails

Declares safety and runtime limits such as:

- citation required or not
- audit required or not
- max tool or action requests
- PII policy
- output token cap

#### eval_suite

List of evaluation case files that must pass before release.

#### release

Release metadata such as:

- build timestamp
- Git SHA
- artifact checksum

### 11.3 Example manifest

```yaml
id: paper.explain_term
version: 1.0.0
owner: ai-runtime
status: active
runtime: cloud

entry_modes:
  - explain

routing_hints:
  intents:
    - explain_term
  keywords:
    - 名词解释
    - 解释一下
    - 是什么意思

required_context:
  selected_set: optional
  imported_chunks: optional
  profile_summary: optional
  organization_context: none

allowed_models:
  - gpt-5-mini
  - deepseek-v4-chat

allowed_actions:
  - artifact.start_analysis

input_schema: schemas/input.schema.json
output_schema: schemas/output.schema.json

prompt_files:
  system: prompts/system.md
  skill: prompts/skill.md
  output: prompts/output.md
  retry: prompts/retry.md

guardrails:
  citation_required: true
  audit_required: true
  pii_policy: deny_external_personal_data
  max_tool_calls: 2
  max_output_tokens: 1600

eval_suite:
  - evals/basic-cases.json
  - evals/edge-cases.json

release:
  git_sha: 0000000
  built_at: 2026-05-16T00:00:00Z
  checksum: sha256:example
```

## 12. Action Boundary Design

### 12.1 Skill vs action

The system must explicitly separate:

- skill intent and orchestration authority
- action execution authority

A skill may decide that an action is needed.

A skill may not execute arbitrary effects directly.

### 12.2 Local desktop action registry

Desktop should own a local action registry that describes:

- action id
- required scope
- allowed caller categories
- input schema
- local permission preconditions
- execution handler

This extends the current prototype in `LiteasyClaw/desktop/src/app/features/skills/actionRegistry.ts` into a proper boundary.

### 12.3 First action categories

Reasonable first action groups are:

- workspace actions
- artifact actions
- settings actions
- organization workspace actions
- local resource read actions

Example actions:

- `workspace.import_selected_set`
- `artifact.start_analysis`
- `settings.update`
- `organization.open_shared_library`
- `library.read_excerpt`
- `tab.open_artifact`

### 12.4 Dual validation rule

Actions should be validated twice:

1. cloud workflow checks whether the skill is allowed to request the action
2. desktop checks whether the action is locally valid and executable in the current context

This is necessary because cloud policy authority and local capability authority are different concerns.

## 13. Skill Registry Design

### 13.1 Registry responsibilities

The formal skill registry should be responsible for:

- loading skill packages from release artifacts
- validating manifests and schemas
- exposing searchable metadata for routing
- resolving active versions by environment
- surfacing release metadata to workflow runtime

### 13.2 Environment release manifest

The deployed environment should not implicitly load every skill in the repository.

Each environment should have a release manifest describing:

- enabled skill ids
- exact enabled versions
- provider policy overrides if any
- rollout or canary flags if introduced later

This allows clean rollback and reproducible deployments.

## 14. Validation and Evaluation

### 14.1 Validation requirements

Each skill package must pass validation before release:

- manifest schema validation
- prompt file existence check
- input/output schema existence check
- allowed-action references resolve
- allowed-model references resolve
- eval suite presence check

### 14.2 Evaluation requirements

Each skill package must include evaluation cases.

At minimum, evaluation should cover:

- happy path behavior
- citation behavior where applicable
- malformed or missing context handling
- refusal or safe-degradation behavior
- schema-conforming output behavior

### 14.3 Prompt change rule

If prompt files change, the eval suite must run again even if the surrounding code does not change.

This is a hard rule because prompt assets are production logic.

## 15. Release and Publishing Flow

### 15.1 First-version operating model

Because Git is the single source of truth, the first version should use a code-release flow rather than a web upload flow.

The intended developer lifecycle is:

1. create skill from template
2. edit prompt files, schemas, and manifest
3. run local validation
4. run local evaluation
5. open pull request
6. review and merge
7. CI packages the skill artifact
8. CI publishes to the skill registry artifact location
9. target environment release manifest enables the version

### 15.2 Install vs upload vs enable

These terms must be kept distinct.

#### install

For developers, install means:

- add the skill package into the repository
- register it for build and validation

#### upload

For deployment, upload means:

- CI publishes a built artifact to the registry or artifact store

#### enable

For an environment, enable means:

- the environment release manifest activates a specific skill version

This separation prevents confusion between source control, artifact publishing, and environment activation.

### 15.3 Recommended CLI surface

The first internal tooling should provide commands conceptually like:

```bash
pnpm liteasy skill create paper.explain_term
pnpm liteasy skill validate skills/paper.explain_term
pnpm liteasy skill eval skills/paper.explain_term
pnpm liteasy skill pack skills/paper.explain_term
pnpm liteasy skill publish skills/paper.explain_term --env staging
```

The exact packaging stack can vary, but the lifecycle stages should remain fixed.

## 16. Security and Governance Rules

The first formal governance rules for this system should be:

- no skill may directly execute arbitrary shell commands
- no skill may directly access arbitrary local files
- no skill may directly define arbitrary HTTP egress rules outside workflow-owned integrations
- no prompt asset may contain secrets
- all action authority must be declared, not inferred
- all environment enablement must be explicit
- audit-worthy workflows must declare `audit_required`

This keeps the system aligned with LiteasyClaw's long-term `skill registry / action registry / scope validation` architecture.

## 17. Migration Guidance From Current Prototype

The current repository should not attempt a big-bang rewrite.

Recommended migration order:

1. formalize the model gateway in cloud service code
2. extract current inline prompts into versioned prompt assets
3. convert hardcoded local skill definitions into manifest-backed internal skill packages
4. move orchestration logic from desktop answer-generation paths into cloud workflow runtime
5. keep desktop action execution as the trusted local effect boundary

This order preserves the current prototype while progressively removing architectural debt.

## 18. Acceptance Criteria

This design is considered successfully implemented when:

1. model calls no longer depend on scattered application-specific vendor logic
2. prompts are repository-managed assets with reviewable history
3. at least one internal skill is manifest-backed and released through the formal flow
4. environment enablement can pin a specific skill version
5. desktop executes only registered local actions
6. workflow runtime owns prompt assembly and model orchestration
7. prompt and skill changes can be validated and rolled back predictably

## 19. Non-Goals For This Milestone

This milestone does not attempt to deliver:

- public plugin ecosystem
- organization self-service skill publishing
- live prompt editing in admin
- arbitrary code plugins
- complete cross-vendor AI abstraction
- final production-grade billing and operations controls

Those may come later, but they must not distort the first formal architecture.
