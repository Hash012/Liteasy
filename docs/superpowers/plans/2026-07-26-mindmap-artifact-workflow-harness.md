# Mindmap Artifact Workflow Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first controlled Artifact Workflow Harness for `mindmap` artifacts, with structured sources, deterministic verification, repair-ready failure reports, and a hard persistence gate.

**Architecture:** Keep one Liteasy main Agent and the existing `AgentPublicApi` run/event lifecycle. Move only the `mindmap` artifact branch into a focused harness under `features/artifact-workflow/`, while `generateAssistantAnswer` still owns normal QA/explain and non-mindmap artifact generation. The first version uses deterministic source cataloging and verification, a pluggable external knowledge provider interface, and stores verified mindmap metadata beside the existing `AnalysisRun/Evidence/Claim` payload.

**Tech Stack:** React + TypeScript, Vitest, existing `agent-api`, `paper-analysis`, `artifacts`, `models`, `generative-ui`, and no new runtime dependencies.

---

## File Structure

- Create `products/liteasy/apps/desktop/src/app/features/artifact-workflow/mindmapArtifact.types.ts`
  - Owns `MindmapArtifact`, `MindmapNode`, source catalog, workflow plan, verification report, and workflow result types.
- Create `products/liteasy/apps/desktop/src/app/features/artifact-workflow/mindmapArtifactVerifier.ts`
  - Owns deterministic validation: structure, source refs, paper coverage, external authority, and critical fact gates.
- Create `products/liteasy/apps/desktop/src/app/features/artifact-workflow/externalKnowledgeProvider.ts`
  - Owns the pluggable external knowledge provider contract and first deterministic provider.
- Create `products/liteasy/apps/desktop/src/app/features/artifact-workflow/mindmapWorkflowHarness.ts`
  - Owns source catalog construction, mindmap draft synthesis, verification, and repair-ready result shape.
- Modify `products/liteasy/apps/desktop/src/app/features/assistant/generateAssistantAnswer.ts`
  - For `artifactType === "mindmap"`, call the harness after model answer generation and include `artifactWorkflow` metadata.
- Modify `products/liteasy/apps/desktop/src/app/controllers/agent/createDesktopAgentService.ts`
  - Preserve `artifactWorkflow` metadata in `assistant.message`.
- Modify `products/liteasy/apps/desktop/src/app/features/artifacts/artifact.types.ts`
  - Add optional `mindmapArtifact` and `verification` fields to `ArtifactTab` and `AgentArtifactResult`.
- Modify `products/liteasy/apps/desktop/src/app/features/artifacts/useArtifactActions.ts`
  - Enforce the mindmap verification gate before saving; include metadata when persisting verified mindmaps.
- Modify `products/liteasy/apps/desktop/src/app/features/artifacts/ArtifactTabs.tsx`
  - Show source layer badges and verification summary for verified mindmaps.
- Modify focused tests under `products/liteasy/apps/desktop/src/tests/`.

## Task 1: Mindmap Artifact Types

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/artifact-workflow/mindmapArtifact.types.ts`
- Test: `products/liteasy/apps/desktop/src/tests/mindmapArtifactVerifier.test.ts`

- [ ] **Step 1: Write the failing type-level behavior test**

Add this test scaffold to `products/liteasy/apps/desktop/src/tests/mindmapArtifactVerifier.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { verifyMindmapArtifact } from "../app/features/artifact-workflow/mindmapArtifactVerifier";
import type { MindmapArtifact } from "../app/features/artifact-workflow/mindmapArtifact.types";

function validArtifact(): MindmapArtifact {
  return {
    artifactId: "artifact-mindmap-1",
    createdAt: "2026-07-26T00:00:00.000Z",
    root: {
      children: [
        {
          children: [{
            children: [],
            confidence: "high",
            id: "node-claim-1",
            label: "MaxSim 聚合 token 相似度",
            nodeType: "paper_claim",
            sourceRefs: ["paper:evidence-1"]
          }],
          confidence: "high",
          id: "node-paper-1",
          label: "ColBERT",
          nodeType: "paper_claim",
          sourceRefs: ["paper:evidence-1"]
        }
      ],
      confidence: "high",
      id: "root",
      label: "ColBERT 思维导图",
      nodeType: "topic",
      sourceRefs: []
    },
    runId: "run-1",
    sources: {
      externalReferences: [],
      inferences: [],
      selectedPapers: [{
        evidenceId: "evidence-1",
        paperId: "paper-1",
        paperTitle: "ColBERT",
        refId: "paper:evidence-1",
        snippet: "ColBERT uses MaxSim to aggregate token-level similarities."
      }]
    },
    title: "ColBERT 思维导图",
    verification: {
      checkedAt: "2026-07-26T00:00:00.000Z",
      errors: [],
      repairable: false,
      status: "pass",
      warnings: []
    },
    version: "liteasy.mindmap-artifact/v1"
  };
}

describe("mindmapArtifactVerifier", () => {
  test("passes a sourced mindmap that covers every selected paper", () => {
    const report = verifyMindmapArtifact(validArtifact(), {
      selectedPaperIds: ["paper-1"]
    });

    expect(report.status).toBe("pass");
    expect(report.errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/mindmapArtifactVerifier.test.ts
```

Expected: FAIL because `mindmapArtifactVerifier` and `mindmapArtifact.types` do not exist.

- [ ] **Step 3: Add type definitions**

Create `mindmapArtifact.types.ts` with:

```ts
export type MindmapAuthorityLevel = "high" | "medium" | "low";
export type MindmapConfidence = "high" | "medium" | "low";

export type MindmapSelectedPaperSource = {
  evidenceId: string;
  paperId: string;
  paperTitle: string;
  refId: string;
  snippet: string;
};

export type MindmapExternalReferenceSource = {
  authorityLevel: MindmapAuthorityLevel;
  reason: "background" | "concept_definition" | "method_lineage" | "missing_link";
  refId: string;
  sourceTitle: string;
  sourceUrl?: string;
  summary: string;
};

export type MindmapInferenceSource = {
  confidence: MindmapConfidence;
  rationale: string;
  refId: string;
};

export type MindmapSourceCatalog = {
  externalReferences: MindmapExternalReferenceSource[];
  inferences: MindmapInferenceSource[];
  selectedPapers: MindmapSelectedPaperSource[];
};

export type MindmapNodeType =
  | "comparison"
  | "concept"
  | "conflict"
  | "evidence"
  | "inference"
  | "method"
  | "open_question"
  | "paper_claim"
  | "topic";

export type MindmapNode = {
  children: MindmapNode[];
  confidence: MindmapConfidence;
  id: string;
  label: string;
  nodeType: MindmapNodeType;
  sourceRefs: string[];
  summary?: string;
};

export type MindmapVerificationIssue = {
  code:
    | "critical_fact_without_source"
    | "external_low_authority_main_claim"
    | "invalid_structure"
    | "missing_selected_paper_coverage"
    | "source_ref_not_found";
  message: string;
  nodeId?: string;
};

export type MindmapVerificationReport = {
  checkedAt: string;
  errors: MindmapVerificationIssue[];
  repairable: boolean;
  status: "fail" | "pass" | "review";
  warnings: MindmapVerificationIssue[];
};

export type MindmapArtifact = {
  artifactId: string;
  createdAt: string;
  root: MindmapNode;
  runId: string;
  sources: MindmapSourceCatalog;
  title: string;
  verification: MindmapVerificationReport;
  version: "liteasy.mindmap-artifact/v1";
};
```

- [ ] **Step 4: Add minimal verifier**

Create `mindmapArtifactVerifier.ts` with a recursive source-ref check and paper coverage gate.

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/mindmapArtifactVerifier.test.ts
```

Expected: PASS.

## Task 2: Deterministic Verification Gates

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/artifact-workflow/mindmapArtifactVerifier.ts`
- Test: `products/liteasy/apps/desktop/src/tests/mindmapArtifactVerifier.test.ts`

- [ ] **Step 1: Add failing verifier tests**

Add tests for:

```ts
test("fails when a critical paper claim has no source refs", () => {
  const artifact = validArtifact();
  artifact.root.children[0].children[0].sourceRefs = [];

  const report = verifyMindmapArtifact(artifact, { selectedPaperIds: ["paper-1"] });

  expect(report.status).toBe("fail");
  expect(report.repairable).toBe(true);
  expect(report.errors).toEqual([
    expect.objectContaining({ code: "critical_fact_without_source" })
  ]);
});

test("fails when a source ref does not exist in the catalog", () => {
  const artifact = validArtifact();
  artifact.root.children[0].children[0].sourceRefs = ["paper:missing"];

  const report = verifyMindmapArtifact(artifact, { selectedPaperIds: ["paper-1"] });

  expect(report.status).toBe("fail");
  expect(report.errors).toEqual([
    expect.objectContaining({ code: "source_ref_not_found" })
  ]);
});

test("fails when a selected paper is not covered by the mindmap", () => {
  const report = verifyMindmapArtifact(validArtifact(), {
    selectedPaperIds: ["paper-1", "paper-2"]
  });

  expect(report.status).toBe("fail");
  expect(report.errors).toEqual([
    expect.objectContaining({ code: "missing_selected_paper_coverage" })
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/mindmapArtifactVerifier.test.ts
```

Expected: FAIL on the newly added gates.

- [ ] **Step 3: Implement gates**

Implement:

- `collectSourceRefs(catalog)` from selected paper, external, and inference refs.
- `walkNodes(root)` recursion.
- Critical node types: `paper_claim`, `concept`, `method`, `evidence`, `comparison`, `conflict`.
- Coverage: each selected paper must have at least one node whose sourceRefs include a selected-paper ref for that `paperId`.
- Low authority external refs are errors only when used by `paper_claim`, `method`, `comparison`, or `conflict` nodes.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/mindmapArtifactVerifier.test.ts
```

Expected: PASS.

## Task 3: External Knowledge Provider Contract

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/artifact-workflow/externalKnowledgeProvider.ts`
- Test: `products/liteasy/apps/desktop/src/tests/externalKnowledgeProvider.test.ts`

- [ ] **Step 1: Write failing tests**

Create `externalKnowledgeProvider.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { createDeterministicExternalKnowledgeProvider } from "../app/features/artifact-workflow/externalKnowledgeProvider";

describe("externalKnowledgeProvider", () => {
  test("returns authoritative concept references for recognized evidence terms", async () => {
    const provider = createDeterministicExternalKnowledgeProvider();

    const references = await provider.lookup({
      question: "解释 ColBERT 的 Late Interaction",
      terms: ["late interaction", "MaxSim"],
      timeoutMs: 1000
    });

    expect(references).toEqual([
      expect.objectContaining({
        authorityLevel: "high",
        reason: "concept_definition",
        sourceTitle: expect.stringContaining("ColBERT")
      })
    ]);
  });

  test("returns no external references for unknown terms instead of inventing sources", async () => {
    const provider = createDeterministicExternalKnowledgeProvider();

    await expect(provider.lookup({
      question: "unknown",
      terms: ["unrecognized-private-term"],
      timeoutMs: 1000
    })).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/externalKnowledgeProvider.test.ts
```

Expected: FAIL because provider does not exist.

- [ ] **Step 3: Implement provider contract**

Create:

```ts
export type ExternalKnowledgeLookupInput = {
  question: string;
  terms: string[];
  timeoutMs: number;
};

export type ExternalKnowledgeProvider = {
  lookup: (input: ExternalKnowledgeLookupInput) => Promise<MindmapExternalReferenceSource[]>;
};
```

First deterministic provider:

- Recognizes `late interaction`, `MaxSim`, `self-attention`, `Transformer`, `vector database`, `filtered ANN`, `ACORN`.
- Returns fixed `sourceTitle`, `authorityLevel`, `reason`, `summary`, and stable `refId`.
- Returns `[]` for unknown terms.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/externalKnowledgeProvider.test.ts
```

Expected: PASS.

## Task 4: Mindmap Workflow Harness

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/artifact-workflow/mindmapWorkflowHarness.ts`
- Test: `products/liteasy/apps/desktop/src/tests/mindmapWorkflowHarness.test.ts`

- [ ] **Step 1: Write failing harness tests**

Create tests asserting:

- It builds a source catalog from `PreparedMultiPaperAnalysis.evidence`.
- It calls the external provider with evidence terms.
- It returns a verified `MindmapArtifact` with `verification.status === "pass"`.
- It returns `blocked` when verification fails.

Use `prepareMultiPaperAnalysis` with `buildImportedChunksForPaper()` fixtures to avoid hand-building large evidence objects.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/mindmapWorkflowHarness.test.ts
```

Expected: FAIL because harness does not exist.

- [ ] **Step 3: Implement harness**

Implement `runMindmapArtifactWorkflow(input)`:

```ts
type RunMindmapArtifactWorkflowInput = {
  artifactId: string;
  generatedAnswer: string;
  prepared: PreparedMultiPaperAnalysis;
  question: string;
  runId: string;
  selectedPapers: Paper[];
  externalKnowledgeProvider?: ExternalKnowledgeProvider;
  now?: () => Date;
};
```

Return:

```ts
type MindmapWorkflowResult =
  | { artifact: MindmapArtifact; status: "verified" }
  | { draft: MindmapArtifact; status: "blocked"; verification: MindmapVerificationReport };
```

Synthesis rule:

- Root node label uses question or `"文献思维导图"`.
- Each selected paper becomes a first-level node.
- Each paper evidence item becomes a child node with `sourceRefs: ["paper:<evidenceId>"]`.
- External references become concept nodes under a first-level `"外部补充知识"` branch.
- If a paper lacks evidence, add an `open_question` node and let verifier fail coverage.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/mindmapWorkflowHarness.test.ts
```

Expected: PASS.

## Task 5: Attach Harness Metadata to Mindmap Answers

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/assistant/generateAssistantAnswer.ts`
- Modify: `products/liteasy/apps/desktop/src/app/controllers/agent/createDesktopAgentService.ts`
- Test: `products/liteasy/apps/desktop/src/tests/generateAssistantAnswer.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/multiPaperAnalysisWorkflow.test.ts`

- [ ] **Step 1: Write failing answer metadata test**

Add a test where `generateAssistantAnswer({ artifactType: "mindmap" })` returns:

```ts
expect(result.artifactWorkflow).toEqual(expect.objectContaining({
  mindmap: expect.objectContaining({
    verification: expect.objectContaining({ status: "pass" })
  }),
  status: "verified"
}));
```

Also assert non-mindmap artifacts do not receive `mindmap` metadata.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/generateAssistantAnswer.test.ts src/tests/multiPaperAnalysisWorkflow.test.ts
```

Expected: FAIL because `artifactWorkflow` is not returned.

- [ ] **Step 3: Implement metadata return**

In `generateAssistantAnswer.ts`:

- Import `runMindmapArtifactWorkflow`.
- After `completeMultiPaperAnalysis`, if `artifactType === "mindmap"` and `analysis` exists, run the harness.
- Return `artifactWorkflow` on the result object.
- Keep existing `analysis`, `audit`, `citations`, `uiDsl`, and `content` behavior unchanged.

In `createDesktopAgentService.ts`, include:

```ts
metadata: JSON.parse(JSON.stringify({
  analysis: answer.analysis,
  artifactWorkflow: answer.artifactWorkflow,
  audit: answer.audit,
  executionTrace: answer.executionTrace
}))
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/generateAssistantAnswer.test.ts src/tests/multiPaperAnalysisWorkflow.test.ts
```

Expected: PASS.

## Task 6: Enforce Persistence Gate in Artifact Actions

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/artifacts/artifact.types.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/artifacts/useArtifactActions.ts`
- Test: `products/liteasy/apps/desktop/src/tests/useArtifactActions.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/useArtifactWorkflowController.test.ts`

- [ ] **Step 1: Write failing gate tests**

Add a test where a completed mindmap Agent run has `metadata.analysis` but `metadata.artifactWorkflow.status === "blocked"`:

```ts
expect(client.save).not.toHaveBeenCalled();
expect(result.current.model.artifactTasks[0]).toEqual(expect.objectContaining({
  status: "failed",
  stage: "failed"
}));
expect(onAnalysisHint).toHaveBeenLastCalledWith(expect.stringContaining("审计未通过"));
```

Add a pass-path test asserting saved document contains:

```ts
expect(client.save).toHaveBeenCalledWith(expect.objectContaining({
  mindmapArtifact: expect.objectContaining({
    verification: expect.objectContaining({ status: "pass" })
  }),
  verification: expect.objectContaining({ status: "pass" })
}));
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/useArtifactActions.test.ts src/tests/useArtifactWorkflowController.test.ts
```

Expected: FAIL because blocked mindmaps still save or metadata is ignored.

- [ ] **Step 3: Extend artifact types**

Add optional fields:

```ts
mindmapArtifact?: MindmapArtifact;
verification?: MindmapVerificationReport;
```

to `ArtifactTab` and `AgentArtifactResult`.

- [ ] **Step 4: Implement save gate**

In `useArtifactActions.ts`:

- Extract `const artifactWorkflow = metadata.artifactWorkflow`.
- If `artifactType === "mindmap"`:
  - Require `artifactWorkflow.status === "verified"`.
  - Require `artifactWorkflow.mindmap.verification.status === "pass"`.
  - Throw `思维导图审计未通过：${failureSummary}` otherwise, where `failureSummary` is the joined verifier error messages.
- Include `mindmapArtifact` and `verification` in the saved document and completed tab.

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/useArtifactActions.test.ts src/tests/useArtifactWorkflowController.test.ts
```

Expected: PASS.

## Task 7: UI Source Layer and Verification Summary

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/artifacts/ArtifactTabs.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/ArtifactTabs.test.tsx`

- [ ] **Step 1: Write failing UI test**

Add a mindmap tab with:

```ts
mindmapArtifact: {
  verification: {
    checkedAt: "2026-07-26T00:00:00.000Z",
    errors: [],
    repairable: false,
    status: "pass",
    warnings: []
  },
  sources: {
    selectedPapers: [{
      evidenceId: "evidence-1",
      paperId: "paper-1",
      paperTitle: "ColBERT",
      refId: "paper:evidence-1",
      snippet: "ColBERT uses MaxSim to aggregate token-level similarities."
    }],
    externalReferences: [{
      authorityLevel: "high",
      reason: "concept_definition",
      refId: "external:late-interaction",
      sourceTitle: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
      summary: "Late interaction preserves token-level matching signals before aggregation."
    }],
    inferences: []
  }
}
```

Assert the artifact tab renders:

- `审计通过`
- `论文证据`
- `外部补充`
- the external source title.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/ArtifactTabs.test.tsx
```

Expected: FAIL because UI does not render verification/source metadata.

- [ ] **Step 3: Implement compact rendering**

In `ArtifactTabs.tsx`, inside the non-skill artifact card:

- If `activeTab.verification`, render `审计通过` / `需复核` / `审计未通过`.
- If `activeTab.mindmapArtifact`, render counts:
  - `论文证据：N`
  - `外部补充：N`
  - `模型推断：N`
- Render external reference titles in a `<details>` block.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/ArtifactTabs.test.tsx
```

Expected: PASS.

## Task 8: Public Event Progress Labels

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/controllers/agent/runAgentArtifactAnalysis.ts`
- Test: `products/liteasy/apps/desktop/src/tests/runAgentArtifactAnalysis.test.ts`

- [ ] **Step 1: Write failing progress test**

Emit `progress.started` events with phases:

- `planning_artifact`
- `collecting_external_knowledge`
- `verifying_artifact`
- `repairing_artifact`

Assert they map to stable task stages:

- planning/external knowledge -> `retrieving_evidence`
- verifying/repairing -> `auditing_answer`

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/runAgentArtifactAnalysis.test.ts
```

Expected: FAIL because unknown phases currently map to `generating_answer`.

- [ ] **Step 3: Implement phase mapping**

Add a helper:

```ts
function mapArtifactProgressStage(phase: string): ArtifactTaskStage {
  if (phase === "planning_artifact" || phase === "collecting_external_knowledge") {
    return "retrieving_evidence";
  }
  if (phase === "verifying_artifact" || phase === "repairing_artifact") {
    return "auditing_answer";
  }
  if (
    phase === "retrieving_evidence" ||
    phase === "generating_answer" ||
    phase === "auditing_answer" ||
    phase === "structuring_artifact"
  ) {
    return phase;
  }
  return "generating_answer";
}
```

Use it in the `progress.started` event handler.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- src/tests/runAgentArtifactAnalysis.test.ts
```

Expected: PASS.

## Task 9: Integration and Regression Pass

**Files:**
- Modify focused tests only if behavior has intentionally changed.

- [ ] **Step 1: Run focused artifact workflow suite**

Run:

```bash
cd products/liteasy/apps/desktop && npm test -- \
  src/tests/mindmapArtifactVerifier.test.ts \
  src/tests/externalKnowledgeProvider.test.ts \
  src/tests/mindmapWorkflowHarness.test.ts \
  src/tests/generateAssistantAnswer.test.ts \
  src/tests/multiPaperAnalysisWorkflow.test.ts \
  src/tests/useArtifactActions.test.ts \
  src/tests/useArtifactWorkflowController.test.ts \
  src/tests/runAgentArtifactAnalysis.test.ts \
  src/tests/ArtifactTabs.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 2: Run full desktop tests**

Run:

```bash
cd products/liteasy/apps/desktop && npm test
```

Expected: all Vitest tests pass.

- [ ] **Step 3: Run production build**

Run:

```bash
cd products/liteasy/apps/desktop && npm run build
```

Expected: TypeScript and Vite production build pass.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add products/liteasy/apps/desktop/src/app/features/artifact-workflow \
  products/liteasy/apps/desktop/src/app/features/assistant/generateAssistantAnswer.ts \
  products/liteasy/apps/desktop/src/app/controllers/agent/createDesktopAgentService.ts \
  products/liteasy/apps/desktop/src/app/controllers/agent/runAgentArtifactAnalysis.ts \
  products/liteasy/apps/desktop/src/app/features/artifacts \
  products/liteasy/apps/desktop/src/tests
git commit -m "feat: add mindmap artifact workflow harness"
```

Expected: one implementation commit after tests and build pass.

## Self-Review

- Spec coverage: The plan implements the mindmap-only harness, source layering, external knowledge interface, deterministic verification, hard persistence gate, progress mapping, UI source display, and tests. It intentionally defers true web search and true Auditor Agent, matching the spec non-goals.
- Placeholder scan: No unresolved placeholder markers or open-ended implementation tasks remain.
- Type consistency: `MindmapArtifact`, `MindmapVerificationReport`, `artifactWorkflow`, `mindmapArtifact`, and `verification` names are used consistently across producer, metadata bridge, persistence, and UI tasks.
