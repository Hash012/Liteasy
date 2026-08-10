# Thin Reading AI Interpretation Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four explicit thin-reading support modes and generate a visibly disclosed AI interpretation when, and only when, a required beyond-paper request has no remaining trustworthy external source.

**Architecture:** Keep paper-closure position separate from evidence provenance. The projection layer owns persisted support-mode inference and legacy compatibility; the thin-reading Agent owns mode-specific output validation; assistant generation owns the external-acquisition result and the only authorization path into AI interpretation; the reader only renders persisted state. An AI-interpretation node carries no paper or external references, records a sanitized retrieval audit, and passes a dedicated provenance-isolation review before persistence.

**Tech Stack:** React 18, TypeScript 5.8, Fluent UI 2, Zod 4, Vitest 3, Testing Library, Playwright, Vite.

## Global Constraints

- Follow the approved design in `docs/superpowers/specs/2026-08-09-thin-reading-ai-interpretation-fallback-design.md`.
- Preserve dependency direction `layout -> controllers -> features -> shared types / clients`; `ThinReadingTab` renders state and never authorizes fallback.
- Permit `ai_interpretation` only when `requiresThinReadingExternalKnowledge(context)` is true, no trustworthy source remains, and acquisition returns a recognized unavailable reason.
- Never convert cancellation, model gateway errors, schema errors, ordinary paper-evidence failures, or unknown programming errors into AI interpretation.
- `ai_interpretation` must contain no paper evidence IDs, external source IDs, source markers, source figures, source anchors, Mermaid, or interactive demo.
- The model cannot declare or trigger `ai_interpretation`; orchestration passes the authorization and the parser validates the returned empty-source contract.
- Keep the fixed Chinese disclosure exactly as approved: `本段必须超出论文范围，但外部检索未获得可信来源。以下正文没有论文内或外部文献依据，仅代表 AI 的独立理解，请勿视为论文结论或事实依据。`
- Use Fluent UI components and `@fluentui/react-icons`; do not add another icon library, gradients, emoji, or nested cards.
- Use two-space TypeScript indentation, double quotes, semicolons, and existing local naming patterns.
- Work in the current workspace because the target files already contain user-owned uncommitted changes required by this feature. Read each live file before editing, preserve overlapping work, and never reset or replace whole files.
- Do not stage or commit overlapping dirty files unless the user separately authorizes a commit. At task boundaries, use scoped diffs and passing tests as checkpoints.

---

## File Map

- `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReading.types.ts`: persisted support-mode and sanitized external-fallback audit contracts.
- `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingProjection.ts`: legacy inference, consistency checks, root/child persistence, and immutable projection.
- `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingAgent.ts`: support-policy prompt, sentence-mode construction, AI interpretation parser rules, and interpretation review schema/prompt/parser.
- `products/liteasy/apps/desktop/src/app/features/assistant/generateAssistantAnswer.ts`: discriminated external-acquisition result, prompt sanitization, authorization, initial fallback, source-verification fallback, and audit assembly.
- `products/liteasy/apps/desktop/src/app/features/thin-reading/ThinReadingTab.tsx`: four provenance labels, AI disclosure, support-mode classes, and source-free selection projection.
- `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReading.css`: four mode backgrounds and responsive disclosure styling.
- `products/liteasy/apps/desktop/src/tests/thinReadingProjection.test.ts`: state inference, persistence, invalid-combination, and legacy tests.
- `products/liteasy/apps/desktop/src/tests/thinReadingAgent.test.ts`: parser, prompt, deterministic isolation, and semantic review contract tests.
- `products/liteasy/apps/desktop/src/tests/generateAssistantAnswer.test.ts`: end-to-end acquisition and fallback regressions.
- `products/liteasy/apps/desktop/src/tests/thinReadingTab.test.tsx`: labels, disclosure, markers, classes, and selection behavior.
- `products/liteasy/apps/desktop/src/tests/fixtures/thinReadingSupportModeBrowserFixture.tsx`: deterministic AI-interpretation reader fixture.
- `products/liteasy/apps/desktop/src/tests/browser/thinReading.browser.spec.ts`: desktop/mobile visual and overlap assertions.

---

### Task 1: Persist And Resolve Four Support Modes

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReading.types.ts:213-370`
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingProjection.ts:39-445`
- Test: `products/liteasy/apps/desktop/src/tests/thinReadingProjection.test.ts`

**Interfaces:**
- Consumes: existing `ThinReadingNodeSeed.evidence`, `ThinReadingSummarySentence.evidenceIds`, and `externalKnowledge`.
- Produces: `ThinReadingSupportMode`, `ThinReadingExternalFallbackAudit`, `resolveThinReadingSentenceSupportMode()`, and `resolveThinReadingSupportMode()` for Agent and UI tasks.

- [ ] **Step 1: Add failing projection tests for the four modes and legacy empty data**

Import `resolveThinReadingSupportMode` and add focused cases:

```ts
test("resolves four support modes without treating a legacy empty node as AI interpretation", () => {
  expect(resolveThinReadingSupportMode({
    evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] }
  })).toBe("paper");
  expect(resolveThinReadingSupportMode({
    evidence: { externalKnowledge: ["openalex:W1"], paperEvidence: ["evidence-1"] }
  })).toBe("paper_and_external");
  expect(resolveThinReadingSupportMode({
    evidence: { externalKnowledge: ["openalex:W1"], paperEvidence: [] }
  })).toBe("external_only");
  expect(resolveThinReadingSupportMode({
    evidence: { externalKnowledge: [], paperEvidence: [] }
  })).toBe("paper");
  expect(resolveThinReadingSupportMode({
    evidence: {
      externalKnowledge: [],
      generationAudit: {
        externalFallback: {
          attemptedRoutes: ["support", "challenge", "context"],
          carriedSourceCount: 0,
          completedRoutes: [],
          reason: "all_routes_failed",
          trustedSourceCount: 0
        },
        model: { id: "test-model", provider: "test" },
        qualityGate: { attempts: 1, repaired: false, repairReasons: [] },
        version: "liteasy.thin-reading-agent/v2"
      },
      paperEvidence: []
    },
    supportMode: "ai_interpretation"
  })).toBe("ai_interpretation");
});

test("persists explicit support modes on root and child nodes", () => {
  const root = createThinReadingDocument({
    artifactId: "artifact-support-mode",
    papers: [{ id: "paper-1", title: "Paper" }],
    rootSeed: seed({ supportMode: "paper" }),
    targetLanguage: "zh-CN"
  });
  const child = advanceThinReadingDocument(root, {
    parentNodeId: root.rootNodeId,
    seed: seed({
      evidence: { externalKnowledge: ["openalex:W1"], paperEvidence: [] },
      supportMode: "external_only",
      withinPaperClosure: false
    }),
    source: { kind: "omitted_section", label: "后续", sectionKey: "follow_up" },
    title: "后续"
  });

  expect(root.nodes[root.rootNodeId].supportMode).toBe("paper");
  expect(child.nodes[child.activeNodeId].supportMode).toBe("external_only");
});
```

Add invalid declaration tests asserting that `supportMode: "ai_interpretation"` with any paper/external ID throws `薄读支持模式与正文来源不一致`, and that creating an AI-interpretation node without `generationAudit.externalFallback` throws `AI 理解节点缺少外部检索兜底审计`.

- [ ] **Step 2: Run RED for the projection contract**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingProjection.test.ts`

Expected: FAIL because `resolveThinReadingSupportMode` and `supportMode` do not exist.

- [ ] **Step 3: Add the support and audit contracts**

Add these public types without making legacy fields compile-time required:

```ts
export type ThinReadingSupportMode =
  | "paper"
  | "paper_and_external"
  | "external_only"
  | "ai_interpretation";

export type ThinReadingExternalFallbackReason =
  | "all_routes_failed"
  | "no_trusted_sources"
  | "verification_exhausted";

export type ThinReadingExternalFallbackAudit = {
  attemptedRoutes: readonly ("challenge" | "context" | "support")[];
  carriedSourceCount: number;
  completedRoutes: readonly ("challenge" | "context" | "support")[];
  reason: ThinReadingExternalFallbackReason;
  trustedSourceCount: 0;
};
```

Add `supportMode?: ThinReadingSupportMode` to `ThinReadingSummarySentence`, `ThinReadingNodeSeed`, and `ThinReadingNode`. Add `externalFallback?: ThinReadingExternalFallbackAudit` to `ThinReadingGenerationAudit`. Keep these properties optional only for persisted legacy compatibility; all new Agent output will populate them.

- [ ] **Step 4: Implement inference, consistency, and persistence**

Add deterministic helpers to `thinReadingProjection.ts`:

```ts
export function resolveThinReadingSentenceSupportMode(
  sentence: Pick<ThinReadingSummarySentence, "evidenceIds" | "externalKnowledge" | "supportMode">
): ThinReadingSupportMode {
  if (sentence.evidenceIds.length > 0 && sentence.externalKnowledge.length > 0) {
    return "paper_and_external";
  }
  if (sentence.evidenceIds.length > 0) return "paper";
  if (sentence.externalKnowledge.length > 0) return "external_only";
  return sentence.supportMode === "ai_interpretation" ? "ai_interpretation" : "paper";
}

export function resolveThinReadingSupportMode(input: {
  evidence: Pick<ThinReadingNodeEvidence,
    "externalKnowledge" | "generationAudit" | "paperEvidence" | "summarySentences">;
  supportMode?: ThinReadingSupportMode;
}): ThinReadingSupportMode {
  const hasPaper = input.evidence.paperEvidence.length > 0 ||
    Boolean(input.evidence.summarySentences?.some((sentence) => sentence.evidenceIds.length > 0));
  const hasExternal = input.evidence.externalKnowledge.length > 0 ||
    Boolean(input.evidence.summarySentences?.some((sentence) => sentence.externalKnowledge.length > 0));
  const inferred = hasPaper && hasExternal
    ? "paper_and_external"
    : hasExternal
      ? "external_only"
      : "paper";
  if (input.supportMode === "ai_interpretation") {
    if (hasPaper || hasExternal) {
      throw new Error("薄读支持模式与正文来源不一致：AI 理解不能携带论文或外部引用。");
    }
    if (!input.evidence.generationAudit?.externalFallback) {
      throw new Error("AI 理解节点缺少外部检索兜底审计。");
    }
    return "ai_interpretation";
  }
  if (input.supportMode && input.supportMode !== inferred) {
    throw new Error("薄读支持模式与正文来源不一致。");
  }
  return input.supportMode ?? inferred;
}
```

Use `resolveThinReadingSupportMode()` when constructing both root and child nodes. Preserve `supportMode` in `freezeNode`; preserve sentence-level mode through the existing spread in `freezeSummarySentence`.

- [ ] **Step 5: Run GREEN and inspect the scoped diff**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingProjection.test.ts`

Expected: all projection tests pass, including legacy empty evidence resolving to `paper`.

Run: `git diff -- products/liteasy/apps/desktop/src/app/features/thin-reading/thinReading.types.ts products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingProjection.ts products/liteasy/apps/desktop/src/tests/thinReadingProjection.test.ts`

Expected: only support-mode/audit additions plus pre-existing user edits; do not stage the files.

---

### Task 2: Enforce The AI Interpretation Output Contract In The Agent

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingAgent.ts:540-1730,1981-2125`
- Test: `products/liteasy/apps/desktop/src/tests/thinReadingAgent.test.ts`

**Interfaces:**
- Consumes: `ThinReadingSupportMode` and validated paper/external allowlists.
- Produces: `buildThinReadingAgentPrompt({ supportMode })` and `parseThinReadingModelSeed(..., { supportMode })` with orchestration-owned AI authorization.

- [ ] **Step 1: Add failing tests for explicit authorization and normal-mode rejection**

Add a reusable source-free output and these cases:

```ts
const aiInterpretationOutput = JSON.stringify({
  anchors: [],
  claims: [],
  externalKnowledge: [],
  interactiveDemo: null,
  mermaid: "",
  omittedSections: [],
  paperEvidence: [],
  paperType: "experimental",
  recommendations: [],
  recommendedFigures: [],
  summary: "一种可能的理解是，系统会在保留细粒度交互的同时尝试压缩计算路径。",
  summarySentences: [{
    evidenceIds: [],
    externalKnowledge: [],
    status: "unsupported",
    text: "一种可能的理解是，系统会在保留细粒度交互的同时尝试压缩计算路径。"
  }],
  withinPaperClosure: false
});

test("accepts source-free prose only with orchestration-owned AI interpretation authorization", () => {
  const seed = parseThinReadingModelSeed(aiInterpretationOutput, {
    requireExplicitTraceability: true,
    supportMode: "ai_interpretation",
    targetLanguage: "zh-CN"
  });

  expect(seed.supportMode).toBe("ai_interpretation");
  expect(seed.evidence.summarySentences?.[0]).toMatchObject({
    evidenceIds: [],
    externalKnowledge: [],
    status: "unsupported",
    supportMode: "ai_interpretation"
  });
});

test("continues to reject source-free prose without AI interpretation authorization", () => {
  expect(() => parseThinReadingModelSeed(aiInterpretationOutput, {
    requireExplicitTraceability: true
  })).toThrow("缺少论文内证据或外部知识来源标记");
});
```

Add rejection tests for an authorized AI output containing an evidence ID, external source ID, URL, citation marker, non-empty anchor, recommended figure, Mermaid, or interactive demo. Each case must assert the specific AI-interpretation isolation error, not a generic schema failure.

- [ ] **Step 2: Run RED for Agent parsing**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingAgent.test.ts`

Expected: FAIL because `supportMode` is not an accepted parse option and empty evidence still fails unconditionally.

- [ ] **Step 3: Add mode-aware sentence construction and traceability**

Add `supportMode?: ThinReadingSupportMode` to `ParseThinReadingModelSeedOptions` and to `buildThinReadingAgentPrompt` input. Extend `buildSummarySentences` with the same option. For each normalized sentence, set:

```ts
supportMode: input.supportMode === "ai_interpretation"
  ? "ai_interpretation"
  : evidenceIds.length > 0 && externalKnowledge.length > 0
    ? "paper_and_external"
    : evidenceIds.length > 0
      ? "paper"
      : "external_only"
```

Change the top-level empty-source and `assertExplicitTraceability` guards so they allow empty IDs only when `options.supportMode === "ai_interpretation"`. In that branch require `withinPaperClosure === false`, every sentence status to normalize to `unsupported`, all claims to have empty evidence IDs, and every sentence to have empty paper/external IDs. Compute normal node modes from the validated top-level/sentence IDs; never read a mode from model JSON.

- [ ] **Step 4: Add deterministic AI interpretation isolation**

Add `assertAiInterpretationIsolation(parsed)` and call it immediately after schema parsing/normalization, before `assertVisualOutput`, evidence-reference checks, or evidence-span construction when authorization is active. It must reject:

```ts
const aiSourceUrlPattern = /\b(?:https?:\/\/|www\.|doi:|arxiv:|openalex:|crossref:)/iu;
const aiCitationPattern = /\[(?:\d+[\s,;\-]*)+\]|\b(?:19|20)\d{2}\s*[a-z]?\b/iu;
const aiAttributionPattern = /(?:论文|本文|研究|实验|文献|资料).{0,10}(?:表明|证明|显示|发现|报告|指出)|\b(?:paper|study|research|experiment).{0,12}(?:shows?|proves?|finds?|reports?|demonstrates?)/iu;
```

Also require empty `anchors`, `recommendedFigures`, `mermaid`, and `interactiveDemo`. Return the seed with `supportMode: "ai_interpretation"`, `paperEvidenceSpans: []`, `externalSources: []`, and sentence support modes set explicitly.

- [ ] **Step 5: Build a dedicated source-free prompt branch**

When `buildThinReadingAgentPrompt` receives `supportMode: "ai_interpretation"`, return a focused prompt that contains the user task and schema but does not include the evidence matrix, external source formatter, parent summary, parent claims, parent evidence spans, available figures, or private evidence briefs. Include these exact rules:

```text
本轮已由编排器授权为 AI 独立理解：论文内外均没有可用于支持正文的来源。
正文只能表达概念分析、推理、假设和可能性，不得声称论文、研究、实验或外部资料支持任何句子。
paperEvidence、externalKnowledge、claims、anchors、recommendedFigures 必须为空数组；mermaid 必须为空字符串；interactiveDemo 必须为 null。
summarySentences 必须完整覆盖 summary；每句 evidenceIds=[]、externalKnowledge=[]、status="unsupported"。
withinPaperClosure 必须为 false。只返回 JSON。
```

Keep the normal prompt byte-for-byte behavior outside this branch except where sentence `supportMode` is added locally after parsing.

- [ ] **Step 6: Run GREEN and normal-mode regressions**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingAgent.test.ts`

Expected: all Agent tests pass; existing source-free output still fails without authorization, and all normal evidence/source constraints remain intact.

Run the projection and Agent tests together: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingProjection.test.ts src/tests/thinReadingAgent.test.ts`

Expected: both files pass with no warnings.

---

### Task 3: Add A Dedicated AI Interpretation Review Contract

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingAgent.ts`
- Test: `products/liteasy/apps/desktop/src/tests/thinReadingAgent.test.ts`

**Interfaces:**
- Consumes: source-free `ThinReadingNodeSeed.evidence.summarySentences`.
- Produces: `ThinReadingAiInterpretationReview`, `thinReadingAiInterpretationReviewJsonSchema`, `buildThinReadingAiInterpretationReviewPrompt()`, and `parseThinReadingAiInterpretationReview()` for assistant orchestration.

- [ ] **Step 1: Add failing prompt and parser tests**

Extend imports and add:

```ts
test("reviews AI interpretation for disguised sourcing and empirical claims", () => {
  const prompt = buildThinReadingAiInterpretationReviewPrompt({
    sentences: [{
      evidenceIds: [],
      externalKnowledge: [],
      id: "sentence-ai-1",
      status: "unsupported",
      supportMode: "ai_interpretation",
      text: "一种可能的理解是，这个机制优先保留局部交互。"
    }]
  });
  expect(prompt).toContain("AI 独立理解质量审阅 Agent");
  expect(prompt).toContain("sentence-ai-1");
  expect(prompt).toContain("来源归因");
  expect(prompt).toContain("精确经验数据");

  expect(parseThinReadingAiInterpretationReview(JSON.stringify({
    reason: "句子保持为明确的不确定性推理，没有伪造来源。",
    unsafeSentenceIds: [],
    verdict: "pass"
  }), ["sentence-ai-1"])).toEqual({
    reason: "句子保持为明确的不确定性推理，没有伪造来源。",
    unsafeSentenceIds: [],
    verdict: "pass"
  });
});
```

Add a parser test rejecting `verdict: "fail"` with an unknown sentence ID and a test rejecting `verdict: "pass"` with non-empty `unsafeSentenceIds`.

- [ ] **Step 2: Run RED for the review API**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingAgent.test.ts`

Expected: FAIL because the review schema, builder, and parser are not exported.

- [ ] **Step 3: Implement the strict review schema and prompt**

Add:

```ts
export type ThinReadingAiInterpretationReview = {
  reason: string;
  unsafeSentenceIds: readonly string[];
  verdict: "fail" | "pass";
};
```

The strict JSON schema and matching Zod schema must require all three fields, reject extras, and constrain the verdict enum. The prompt must ask only whether a sentence disguises unsupported content as sourced fact, invents precise empirical numbers/dates/named findings, or fails to mark a hypothetical example as hypothetical. It must explicitly allow cautious conceptual reasoning and uncertainty language.

`parseThinReadingAiInterpretationReview(output, allowedSentenceIds)` must normalize duplicate IDs, reject unknown IDs, require at least one unsafe ID for `fail`, and require none for `pass`.

- [ ] **Step 4: Run GREEN and inspect exported schema alignment**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingAgent.test.ts`

Expected: all Agent tests pass, including strict schema/parser consistency.

Run: `git diff --check -- products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingAgent.ts products/liteasy/apps/desktop/src/tests/thinReadingAgent.test.ts`

Expected: no whitespace errors; do not stage the overlapping files.

---

### Task 4: Convert Initial External Retrieval Failure Into Controlled AI Interpretation

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/assistant/generateAssistantAnswer.ts:200-245,1414-1770,2007-2175`
- Test: `products/liteasy/apps/desktop/src/tests/generateAssistantAnswer.test.ts:3028-3190`

**Interfaces:**
- Consumes: `ThinReadingExternalFallbackAudit`, Agent `supportMode`, and the AI interpretation review API.
- Produces: internal `ThinReadingExternalAcquisitionResult`, sanitized AI generation context, and a persisted `externalFallback` audit for initial acquisition failures.

- [ ] **Step 1: Rewrite the empty-source regression as RED**

Replace `stops beyond-paper generation when external retrieval returns no sources` with a model transport that returns an AI body for the generation prompt and a passing interpretation review for the review prompt. Assert:

```ts
expect(result.thinReading?.rootSeed).toMatchObject({
  supportMode: "ai_interpretation",
  withinPaperClosure: false,
  evidence: {
    externalKnowledge: [],
    externalSources: [],
    generationAudit: {
      externalFallback: {
        reason: "no_trusted_sources",
        trustedSourceCount: 0
      }
    },
    paperEvidence: [],
    summarySentences: [expect.objectContaining({
      evidenceIds: [],
      externalKnowledge: [],
      status: "unsupported",
      supportMode: "ai_interpretation"
    })]
  }
});
expect(generationPrompt).toContain("AI 独立理解");
expect(generationPrompt).not.toContain("ColBERT uses MaxSim.");
```

Add a second test where all three external transport calls reject and assert `reason: "all_routes_failed"`, `attemptedRoutes` contains `support`, `challenge`, and `context`, and generation still succeeds as AI interpretation.

- [ ] **Step 2: Run RED for initial acquisition**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/generateAssistantAnswer.test.ts -t "AI interpretation|external retrieval returns no sources|all three external"`

Expected: FAIL because empty retrieval throws before the model call.

- [ ] **Step 3: Introduce the discriminated acquisition result**

Inside `generateAssistantAnswer.ts`, define:

```ts
type ThinReadingExternalAcquisitionResult =
  | { kind: "sources"; sources: readonly ThinReadingExternalSource[] }
  | {
      audit: ThinReadingExternalFallbackAudit;
      kind: "unavailable";
      reason: ThinReadingExternalFallbackReason;
    };
```

Change `externalSourcesPromise` and `generateThinReadingWithQualityRepair` to consume this result. Return `sources` whenever prioritized carried/retrieved sources are non-empty. Return `unavailable/no_trusted_sources` when at least one route completes but prioritization is empty, and `unavailable/all_routes_failed` when all planned routes reject or client construction fails before dispatch. Continue propagating `AbortError` unchanged.

Inside `generateThinReadingWithQualityRepair`, replace the fixed normal-mode locals with state that Task 5 can transition exactly once:

```ts
let supportMode: "ai_interpretation" | undefined = acquisition.kind === "unavailable"
  ? "ai_interpretation"
  : undefined;
let externalFallbackAudit = acquisition.kind === "unavailable" ? acquisition.audit : undefined;
let generationPrepared = supportMode === "ai_interpretation"
  ? withoutThinReadingEvidence(plannedEvidence)
  : plannedEvidence;
let maximumAttempts = generationContext.source.kind === "root_overview" ? 3 : 2;
```

An undefined policy means the normal evidence-required path. The parser derives `paper`, `paper_and_external`, or `external_only` only after it has validated the model's actual references; no pre-generation estimate becomes persisted provenance.

- [ ] **Step 4: Sanitize the AI interpretation generation input**

Add focused helpers:

```ts
function withoutThinReadingEvidence(
  prepared: PreparedMultiPaperAnalysis
): PreparedMultiPaperAnalysis {
  return {
    ...prepared,
    citations: [],
    evidence: [],
    evidencePrompt: "",
    paperClaims: []
  };
}

function buildAiInterpretationContext(
  context: ThinReadingGenerationContext
): ThinReadingGenerationContext {
  return {
    ...context,
    ancestorSummaries: [],
    availableFigures: [],
    externalSources: [],
    parentClaims: [],
    parentEvidenceSpans: [],
    parentSummary: undefined,
    selectedExternalSources: [],
    source: context.source.kind === "selected_text"
      ? {
          ...context.source,
          evidenceIds: undefined,
          excerpt: "",
          externalSourceIds: undefined
        }
      : context.source
  };
}
```

When acquisition is unavailable, first assert `requiresThinReadingExternalKnowledge(context)` and no sources remain. Use the sanitized context/prepared values, pass `supportMode: "ai_interpretation"` to prompt and parser, skip evidence review and source recovery, run the AI interpretation review, and attach acquisition audit to `generationAudit.externalFallback`. Do not attach paper evidence planning/review fields to the AI node.

- [ ] **Step 5: Repair or fail unsafe AI interpretation output**

If `ThinReadingAiInterpretationReview.verdict === "fail"`, add a repair reason containing only the normalized sentence IDs and bounded review reason, then use the existing repair prompt mechanism with this instruction:

```text
该输出处于无文献依据的 AI 独立理解档。删除来源归因、引用、精确经验数据和命名研究发现；保留明确标记为可能性、假设或概念推理的内容。所有证据与来源字段必须保持为空。
```

Allow the existing normal attempt budget for initial AI fallback. If the repaired output still fails, throw the quality-gate error; do not persist it and do not weaken the review.

- [ ] **Step 6: Protect non-fallback cases**

Add or retain focused assertions that:

- a fulfilled route with at least one trusted source uses normal `external_only`/`paper_and_external` generation;
- a selected carried source survives an empty follow-up lookup;
- an aborted signal rejects and makes no AI generation call;
- missing local paper text still fails before external fallback;
- a model transport failure after fallback authorization still rejects.

Use the real `generateAssistantAnswer` boundary; mock only transport responses.

- [ ] **Step 7: Run GREEN for initial acquisition and regressions**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/generateAssistantAnswer.test.ts`

Expected: the full assistant-generation test file passes, including three-route empty/failure, carried-source reuse, cancellation, and model-failure protection.

---

### Task 5: Regenerate As AI Interpretation After Source Verification Is Exhausted

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/assistant/generateAssistantAnswer.ts:1680-1770`
- Test: `products/liteasy/apps/desktop/src/tests/generateAssistantAnswer.test.ts:2913-3027`

**Interfaces:**
- Consumes: a failed evidence review, failed source IDs, an empty/unavailable focused recovery, and Task 4 AI-mode helpers.
- Produces: a fresh `ai_interpretation` body with `verification_exhausted` audit instead of `buildExternalEvidenceBoundarySeed()`.

- [ ] **Step 1: Rewrite the closure-boundary regression as RED**

Rename the test to `regenerates unsupported required external claims as disclosed AI interpretation after recovery is exhausted`. Make `modelTransport` return, in order:

1. a source-linked external sentence;
2. an evidence review rejecting that sentence;
3. a source-free AI interpretation sentence when the prompt contains `AI 独立理解`;
4. a passing AI interpretation review.

Keep the fourth focused external request empty. Assert:

```ts
expect(externalRequests).toBe(4);
expect(result.thinReading?.rootSeed.supportMode).toBe("ai_interpretation");
expect(result.thinReading?.rootSeed.withinPaperClosure).toBe(false);
expect(result.thinReading?.rootSeed.closureState).toBe("outside_paper");
expect(result.thinReading?.rootSeed.summary).not.toContain("初始外部线索");
expect(result.thinReading?.rootSeed.evidence.externalKnowledge).toEqual([]);
expect(result.thinReading?.rootSeed.evidence.generationAudit?.externalFallback?.reason)
  .toBe("verification_exhausted");
```

- [ ] **Step 2: Run RED for verification exhaustion**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/generateAssistantAnswer.test.ts -t "regenerates unsupported required external claims"`

Expected: FAIL because the implementation returns the current near-boundary seed.

- [ ] **Step 3: Replace the boundary return with an explicit mode transition**

Remove the `buildExternalEvidenceBoundarySeed()` return from the required-external/no-replacement branch. After all failed source IDs are removed and recovery has no replacement:

```ts
supportMode = "ai_interpretation";
externalFallbackAudit = {
  attemptedRoutes: ["support"],
  carriedSourceCount: generationContext.externalSources?.length ?? 0,
  completedRoutes: recovery.status === "empty" ? ["support"] : [],
  reason: "verification_exhausted",
  trustedSourceCount: 0
};
generationContext = buildAiInterpretationContext(context);
generationPrepared = withoutThinReadingEvidence(plannedEvidence);
basePrompt = buildThinReadingAgentPrompt({
  context: generationContext,
  prepared: generationPrepared,
  supportMode
});
prompt = basePrompt;
```

Clear targeted evidence repair and source recovery state before continuing. Extend the loop budget to guarantee up to two fresh AI attempts after the mode transition:

```ts
maximumAttempts = Math.max(maximumAttempts, attempt + 2);
```

The new parse/review path must discard the rejected source-linked generation entirely and attach only the fallback audit and AI review result to the final quality history.

- [ ] **Step 4: Add the remaining-source protection case**

Add a test with two external sources where review rejects one sentence/source but another directly supported sentence/source remains. Assert the result keeps normal external support, retains the surviving source ID, and does not contain `generationAudit.externalFallback`.

- [ ] **Step 5: Run GREEN for source recovery and the full generation file**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/generateAssistantAnswer.test.ts`

Expected: all tests pass; required-source exhaustion produces AI interpretation, while successful replacement and surviving-source cases stay source-backed.

Run: `git diff --check -- products/liteasy/apps/desktop/src/app/features/assistant/generateAssistantAnswer.ts products/liteasy/apps/desktop/src/tests/generateAssistantAnswer.test.ts`

Expected: no whitespace errors; do not stage the overlapping files.

---

### Task 6: Render Four Labels And The Fixed AI Disclosure

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/ThinReadingTab.tsx:430-465,970-1000,1120-1250`
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReading.css:1-115,320-340`
- Test: `products/liteasy/apps/desktop/src/tests/thinReadingTab.test.tsx`
- Create: `products/liteasy/apps/desktop/src/tests/fixtures/thinReadingSupportModeBrowserFixture.tsx`
- Modify: `products/liteasy/apps/desktop/src/tests/browser/thinReading.browser.spec.ts`

**Interfaces:**
- Consumes: `resolveThinReadingSupportMode(activeNode)`, persisted sentence modes, and existing locale labels.
- Produces: support-mode label, root class, fixed AI disclosure, source-free selection metadata, and deterministic visual fixture.

- [ ] **Step 1: Add failing component tests for all labels and AI disclosure**

Create four documents from the existing fixture with matching evidence and `supportMode`. Assert labels `论文内支持`, `论文 + 外部支持`, `仅外部支持`, and `AI 独立理解` respectively.

For the AI document include a valid fallback audit and assert:

```ts
const { container } = renderTab(aiDocument);
expect(container.querySelector(".thin-reading.is-support-ai-interpretation")).not.toBeNull();
expect(screen.getByRole("note", { name: "无文献依据：AI 独立理解" })).toHaveTextContent(
  "本段必须超出论文范围，但外部检索未获得可信来源。以下正文没有论文内或外部文献依据，仅代表 AI 的独立理解，请勿视为论文结论或事实依据。"
);
expect(container.querySelector(".thin-reading__summary-marker")).toBeNull();
expect(screen.queryByRole("link", { name: /打开外部来源/ })).not.toBeInTheDocument();
```

Trigger the existing summary selection interaction and assert the generated selected-text source omits both `evidenceIds` and `externalSourceIds` for AI text.

- [ ] **Step 2: Run RED for the reader UI**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingTab.test.tsx`

Expected: FAIL because support labels, AI class, and fixed note do not exist.

- [ ] **Step 3: Add locale labels, icon, classes, and disclosure**

Import `WarningRegular` from `@fluentui/react-icons`. Resolve support mode once from `activeNode`. Add localized labels:

```ts
const supportModeLabels = locale === "zh"
  ? {
      ai_interpretation: "AI 独立理解",
      external_only: "仅外部支持",
      paper: "论文内支持",
      paper_and_external: "论文 + 外部支持"
    }
  : {
      ai_interpretation: "AI interpretation",
      external_only: "External sources only",
      paper: "Paper-supported",
      paper_and_external: "Paper + external sources"
    };
```

Add exactly one root support class and render the label in the article metadata area. Before `<h2>`, render this local-code note only for `ai_interpretation`:

```tsx
<section
  aria-label={labels.aiInterpretationTitle}
  className="thin-reading__ai-interpretation-notice"
  role="note"
>
  <WarningRegular aria-hidden="true" />
  <span>
    <strong>{labels.aiInterpretationTitle}</strong>
    <span>{labels.aiInterpretationDisclosure}</span>
  </span>
</section>
```

Do not derive this note from `summary`. Existing marker rendering remains data-driven; the validated AI sentence has empty arrays and therefore produces no marker.

- [ ] **Step 4: Add restrained support-mode styling**

Use these stable values after the existing closure classes so support mode wins:

```css
.thin-reading.is-support-paper-and-external { background: #f3f7f3; }
.thin-reading.is-support-external-only { background: #f7f1e8; }
.thin-reading.is-support-ai-interpretation {
  --thin-line: #e4cbc6;
  background: #fff3f1;
}
.thin-reading__support-mode {
  color: #526568;
  font-size: 11px;
  font-weight: 650;
}
.thin-reading__ai-interpretation-notice {
  align-items: start;
  border-left: 3px solid #b76055;
  color: #713c36;
  display: grid;
  gap: 10px;
  grid-template-columns: 20px minmax(0, 1fr);
  margin: 16px 0 22px;
  max-width: 42em;
  padding: 10px 0 10px 12px;
}
.thin-reading__ai-interpretation-notice > span { display: grid; gap: 3px; min-width: 0; }
.thin-reading__ai-interpretation-notice strong { font-size: 12px; }
.thin-reading__ai-interpretation-notice span span {
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.thin-reading.is-support-ai-interpretation .thin-reading__body {
  --association-scrim: rgba(255, 243, 241, .8);
}
```

Do not add cards, gradients, oversized type, or animation.

- [ ] **Step 5: Run GREEN for component behavior**

Run: `cd products/liteasy/apps/desktop && npm test -- src/tests/thinReadingTab.test.tsx`

Expected: all reader tests pass, all four labels are visible, AI note copy is exact, and no source marker is rendered for AI text.

- [ ] **Step 6: Add a deterministic browser fixture and RED visual checks**

Create `thinReadingSupportModeBrowserFixture.tsx` using the same `FluentProvider`, `createRoot`, and mount shape as `pageRecommendationGraphBrowserFixture.tsx`. Build one `ai_interpretation` document with empty source arrays, an explicit fallback audit, one unsupported AI sentence, and no anchors/figures.

In `thinReading.browser.spec.ts`, dynamically mount it into `#thin-reading-support-mode-fixture`. Add desktop and mobile tests that assert the note and summary are visible, the root computed background is `rgb(255, 243, 241)`, document width does not overflow, and note/heading/summary rectangles do not overlap.

Run: `cd products/liteasy/apps/desktop && npx playwright test src/tests/browser/thinReading.browser.spec.ts -g "AI interpretation support mode"`

Expected: FAIL before the fixture/styling is complete or because snapshots do not exist.

- [ ] **Step 7: Capture and verify desktop/mobile screenshots**

After the fixture and CSS are green, run:

`cd products/liteasy/apps/desktop && npx playwright test src/tests/browser/thinReading.browser.spec.ts -g "AI interpretation support mode" --update-snapshots`

Then rerun without updating:

`cd products/liteasy/apps/desktop && npx playwright test src/tests/browser/thinReading.browser.spec.ts -g "AI interpretation support mode"`

Expected: desktop and 390px mobile screenshots pass, the page is nonblank, background is visibly distinct, and no text overlaps or horizontal overflow occur.

---

### Task 7: Run Cross-Layer Verification And Final Review

**Files:**
- Verify all files listed in the File Map.
- Verify generated Playwright snapshots under `products/liteasy/apps/desktop/src/tests/browser/thinReading.browser.spec.ts-snapshots/`.

**Interfaces:**
- Consumes: completed support model, Agent gates, acquisition paths, UI, and fixtures.
- Produces: evidence that the approved behavior works without weakening existing thin-reading boundaries.

- [ ] **Step 1: Run all focused thin-reading suites together**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- \
  src/tests/thinReadingProjection.test.ts \
  src/tests/thinReadingAgent.test.ts \
  src/tests/generateAssistantAnswer.test.ts \
  src/tests/thinReadingTab.test.tsx
```

Expected: all focused tests pass with no unhandled rejections or React warnings.

- [ ] **Step 2: Run the complete browser spec**

Run: `cd products/liteasy/apps/desktop && npx playwright test src/tests/browser/thinReading.browser.spec.ts`

Expected: all existing thin-reading browser scenarios and the new desktop/mobile AI support-mode screenshots pass.

- [ ] **Step 3: Run the complete desktop test suite**

Run: `cd products/liteasy/apps/desktop && npm test`

Expected: the full Vitest suite passes. Investigate any failure before continuing; do not dismiss failures as unrelated without reproducing them against the pre-task state.

- [ ] **Step 4: Run the production build and asset gate**

Run: `cd products/liteasy/apps/desktop && npm run build`

Expected: TypeScript, Vite production build, and `verify-production-assets.mjs` all pass. Browser-only fixtures must not enter production assets.

- [ ] **Step 5: Perform the spec and security review**

Inspect the final diff and explicitly confirm:

- only the assistant orchestration can authorize `ai_interpretation`;
- empty evidence without authorization still fails;
- cancellation and non-retrieval errors still fail/cancel;
- source-linked rejected prose is discarded before AI regeneration;
- fallback audit contains no stack, credential, endpoint secret, or raw configuration;
- AI text cannot produce evidence/external IDs through selection;
- exact Chinese disclosure appears in local UI code;
- fourth-mode background wins over `near_boundary` and `is-external`;
- no existing paper/external marker behavior regressed.

Run: `git diff --check`

Expected: no whitespace errors in tracked changes. Also run `git status --short` and identify every pre-existing user-owned change separately from files touched by this feature.

- [ ] **Step 6: Record the completion checkpoint without staging user work**

Do not commit in the current dirty workspace unless the user explicitly authorizes it. Report the exact tests/build/browser commands run, their results, the files changed for this feature, and any remaining test-environment limitation.
