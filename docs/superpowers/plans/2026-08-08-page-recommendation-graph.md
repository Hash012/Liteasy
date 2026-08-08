# Page Recommendation Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two thin-reading association controls with one three-stage “相关推荐” control, rank auditable anchors, retrieve verified relationships across every recommended paper on the page, and render them with a quality-gated constrained layout and deterministic ink-wash edges.

**Architecture:** `ThinReadingTab` owns only the three-stage UI and orchestration. Focused feature modules own anchor scoring, page-wide paper graph projection, verified relation retrieval, constrained layout quality comparison, and hand-drawn path generation; the current deterministic layout remains the baseline and fallback. Both local development and formal API boundaries expose the same batched paper-relation contract without sharing implementations or credentials.

**Tech Stack:** React 18, TypeScript 5.8, Fluent UI 2, d3-force 3, Vitest/Testing Library, Playwright, Node.js 20 test runner, local dev-cloud connectors, formal PostgreSQL/S3 API boundary.

## Global Constraints

- Preserve dependency direction `layout -> controllers -> features -> shared types / clients`; features must not import layout or `AppShell`.
- TypeScript uses two-space indentation, double quotes, and semicolons; React components use `PascalCase`, hooks use `useThing`, and other TypeScript functions use `camelCase`.
- Use `@fluentui/react-components` and `@fluentui/react-icons`; do not add emoji or another icon library.
- `development/dev-cloud/` requires Node.js 20+ and must not return mock business results or demo accounts.
- `products/liteasy/services/api/` must not depend on `development/`, and readiness must not be described as production acceptance.
- Paper-to-paper edges are emitted only for verified direct citation, co-citation, or bibliographic coupling; semantic similarity never becomes a factual paper edge.
- The current deterministic association layout remains the baseline and fallback. A candidate layout is adopted only when its measured quality is no worse and every candidate hard constraint passes.
- In the candidate layout, every primary paper for one anchor remains in one side sector, and resting primary anchor edges have zero crossings.
- The page-wide paper graph includes verified relationships between all displayed deduplicated papers, including papers owned by different anchors.
- Visible ink perturbation is deterministic by edge ID, keeps exact endpoints, does not alter hit geometry, and never continuously animates.
- Desktop changes require affected tests, full `npm test`, and `npm run build` before completion.

---

## File Map

- `thinReading.types.ts`: persisted anchor-quality and verified paper-edge contracts.
- `thinReadingProjection.ts`: immutable persistence/freezing for the new optional fields.
- `thinReadingAnchorQuality.ts`: pure auditable scoring, diversity selection, and reader-facing reason.
- `thinReadingPaperRelationsClient.ts`: strict desktop transport/parser for the batched endpoint.
- `useThinReadingPaperRelations.ts`: progressive fetch, one-shot persistence, partial-error state.
- `associationGraphProjection.ts`: page-wide deduplication, primary anchor ownership, paper-edge filtering.
- `associationGraphLayout.ts`: existing baseline plus candidate constrained layout and quality report.
- `associationGraphGeometry.ts`: segment crossing, side-sector, overlap, stress, and quality comparison helpers.
- `associationHandDrawnPath.ts`: exact path plus deterministic ink duplicate and wash paths.
- `AssociationGraphLayer.tsx`: render projected primary/secondary/paper edges and focus behavior.
- `ThinReadingTab.tsx`: three-stage state and relation-hook orchestration only.
- `paperRelationPayloads.mjs`: local development request validation and verified graph derivation.
- `externalRetrievalConnectors.mjs` / `externalKnowledgeService.mjs`: independent formal API relation connector/service.

---

### Task 1: Persist Anchor Quality And Page-Wide Paper Edges

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReading.types.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingProjection.ts`
- Test: `products/liteasy/apps/desktop/src/tests/thinReadingProjection.test.ts`

**Interfaces:**
- Produces: `ThinReadingAnchorQuality`, `ThinReadingRecommendationPaperEdge`, `ThinReadingAnchor.quality?`, and `ThinReadingNodeEvidence.recommendationPaperEdges?`.
- Consumes: existing `ThinReadingAnchor`, `ThinReadingNodeEvidence`, and immutable document projection.

- [ ] **Step 1: Write the failing persistence test**

```ts
test("freezes optional anchor quality and page-wide recommendation edges", () => {
  const quality = { citationProvenance: 1, evidenceAttention: 0.5, evidenceCoverage: 0.75, reason: "核心方法 · 3 条证据 · 原文有引用", score: 0.81 };
  const edge = { directed: true, evidenceRecordUrls: ["https://openalex.org/W2"], kind: "direct_citation" as const, provider: "openalex" as const, sourcePaperId: "openalex:W1", strength: 0.9, targetPaperId: "openalex:W2" };
  const document = createThinReadingDocument(fixtureWith({ quality, recommendationPaperEdges: [edge] }));
  const root = document.nodes[document.rootNodeId]!;
  expect(root.evidence.anchors?.[0]?.quality).toEqual(quality);
  expect(root.evidence.recommendationPaperEdges).toEqual([edge]);
  expect(Object.isFrozen(root.evidence.anchors?.[0]?.quality)).toBe(true);
  expect(Object.isFrozen(root.evidence.recommendationPaperEdges)).toBe(true);
});

test("keeps legacy thin-reading artifacts valid without graph metadata", () => {
  const document = createThinReadingDocument(legacyFixtureWithoutGraphMetadata());
  const root = document.nodes[document.rootNodeId]!;
  expect(root.evidence.anchors?.[0]?.quality).toBeUndefined();
  expect(root.evidence.recommendationPaperEdges).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused test and confirm the type/field failure**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/thinReadingProjection.test.ts`

Expected: FAIL because `quality` and `recommendationPaperEdges` are not persisted contracts.

- [ ] **Step 3: Add exact optional contracts and freeze helpers**

```ts
export type ThinReadingAnchorQuality = {
  citationProvenance: number;
  evidenceAttention: number;
  evidenceCoverage: number;
  reason: string;
  score: number;
};

export type ThinReadingRecommendationPaperEdge = {
  directed: boolean;
  evidenceRecordUrls: readonly string[];
  kind: "bibliographic_coupling" | "co_cited" | "direct_citation";
  provider: "openalex" | "semantic_scholar";
  sourcePaperId: string;
  strength: number;
  targetPaperId: string;
};
```

Add `quality?: ThinReadingAnchorQuality` to `ThinReadingAnchor`, add `recommendationPaperEdges?: readonly ThinReadingRecommendationPaperEdge[]` to `ThinReadingNodeEvidence`, and freeze nested arrays/objects in `freezeAnchor` and `freezeEvidence`.

- [ ] **Step 4: Run projection tests**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/thinReadingProjection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the persisted contract**

```bash
git add products/liteasy/apps/desktop/src/app/features/thin-reading/thinReading.types.ts products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingProjection.ts products/liteasy/apps/desktop/src/tests/thinReadingProjection.test.ts
git commit -m "feat: persist page recommendation graph metadata"
```

### Task 2: Rank Anchors From Auditable Generation Evidence

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingAnchorQuality.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/assistant/generateAssistantAnswer.ts`
- Test: `products/liteasy/apps/desktop/src/tests/thinReadingAnchorQuality.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/generateAssistantAnswer.test.ts`

**Interfaces:**
- Consumes: `ThinReadingAnchor[]`, `ThinReadingSummarySentence[]`, `ThinReadingGenerationAudit | undefined`, and `ReadonlyMap<string, readonly ThinReadingAnchorReference[]>`.
- Produces: `rankThinReadingAnchors(input): ThinReadingAnchor[]`, each retained anchor carrying `quality` and preserving stable document order.

```ts
export type RankThinReadingAnchorsInput = {
  anchors: readonly ThinReadingAnchor[];
  audit?: ThinReadingGenerationAudit;
  referencesByAnchorId: ReadonlyMap<string, readonly ThinReadingAnchorReference[]>;
  summarySentences: readonly ThinReadingSummarySentence[];
};
```

- [ ] **Step 1: Write failing score and diversity tests**

```ts
test("citation evidence raises quality without excluding uncited core concepts", () => {
  const ranked = rankThinReadingAnchors(input({ citedAnchorId: "method", uncitedImportance: 1 }));
  expect(ranked.map((anchor) => anchor.id)).toEqual(["method", "uncited-core"]);
  expect(ranked[0]!.quality!.citationProvenance).toBe(1);
  expect(ranked[1]!.quality!.score).toBeGreaterThan(0.35);
});

test("keeps at most two anchors per sentence and is deterministic", () => {
  const first = rankThinReadingAnchors(denseSentenceInput());
  const second = rankThinReadingAnchors(denseSentenceInput());
  expect(first).toEqual(second);
  expect(first.filter((anchor) => anchor.summarySentenceId === "s1")).toHaveLength(2);
});
```

- [ ] **Step 2: Run the new test and confirm the missing-module failure**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/thinReadingAnchorQuality.test.ts`

Expected: FAIL because `rankThinReadingAnchors` does not exist.

- [ ] **Step 3: Implement normalized component scores and stable selection**

```ts
export function rankThinReadingAnchors(input: RankThinReadingAnchorsInput) {
  const attentionByEvidenceId = generationEvidenceAttention(input.audit);
  const scored = input.anchors.map((anchor) => scoreAnchor({
    anchor,
    attentionByEvidenceId,
    references: input.referencesByAnchorId.get(anchor.id) ?? [],
    sentence: input.summarySentences.find((item) => item.id === anchor.summarySentenceId)
  }));
  return selectDiverseAnchors(scored, { maximum: 8, maximumPerSentence: 2 })
    .sort(compareDocumentPosition);
}
```

Use the approved weights `0.35 / 0.25 / 0.20 / 0.20`, cap repeated evidence attention before normalization, and generate only reader-facing reasons such as `核心方法 · 3 条证据 · 原文有引用`.

- [ ] **Step 4: Apply ranking after local reference attribution and before per-anchor search**

In `attachThinReadingAnchorSources`, load the reference index, call `rankThinReadingAnchors`, use the ranked anchors for searches, and persist them in the returned seed. Do not expose tool-call counts in UI copy.

- [ ] **Step 5: Run anchor and generation tests**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/thinReadingAnchorQuality.test.ts src/tests/generateAssistantAnswer.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit anchor quality**

```bash
git add products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingAnchorQuality.ts products/liteasy/apps/desktop/src/app/features/assistant/generateAssistantAnswer.ts products/liteasy/apps/desktop/src/tests/thinReadingAnchorQuality.test.ts products/liteasy/apps/desktop/src/tests/generateAssistantAnswer.test.ts
git commit -m "feat: rank thin reading recommendation anchors"
```

### Task 3: Replace Two Controls With One Three-Stage Control

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/ThinReadingTab.tsx`
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReading.css`
- Test: `products/liteasy/apps/desktop/src/tests/thinReadingAssociationGraph.test.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/thinReadingTab.test.tsx`

**Interfaces:**
- Produces: local `RecommendationStage = "article" | "marks" | "graph"` state and `advanceRecommendationStage()`.
- Consumes: existing anchor measurement, `AssociationGraphLayer`, and `AssociationReadingOverlay`.

- [ ] **Step 1: Replace old expectations with a failing three-stage interaction test**

```ts
test("cycles one related-recommendations button through article, marks, graph, and article", () => {
  const { container } = renderArtifact();
  const button = screen.getByRole("button", { name: "相关推荐" });
  expect(container.querySelector(".thin-reading__anchor")).toHaveClass("is-hidden");
  fireEvent.click(button);
  expect(screen.getByText("概念标记")).toBeVisible();
  fireEvent.click(button);
  expect(screen.getByRole("region", { name: "页级关联图" })).toBeVisible();
  fireEvent.click(button);
  expect(container.querySelector(".association-layer")).toBeNull();
});
```

- [ ] **Step 2: Run component tests and confirm old two-button behavior fails**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/thinReadingAssociationGraph.test.tsx src/tests/thinReadingTab.test.tsx`

Expected: FAIL because both old controls still exist and marks start enabled.

- [ ] **Step 3: Implement the state machine and accessible Fluent control**

```ts
type RecommendationStage = "article" | "graph" | "marks";
const [recommendationStage, setRecommendationStage] = useState<RecommendationStage>("article");
const marksVisible = recommendationStage !== "article";
const associationGraphOpen = recommendationStage === "graph";
```

Render one `相关推荐` button with a Fluent recommendation/link icon, `aria-pressed={recommendationStage !== "article"}`, and a tooltip naming the next state. Preserve anchor-click direct focus. Change Escape behavior to `reading card -> graph -> marks -> article`, and reset to `article` when `activeNode.id` changes.

- [ ] **Step 4: Remove obsolete modebar styles and keep stable dimensions**

Keep the button height and mode-state region fixed so text changes cannot shift the article. The article mark remains in the DOM but is visually neutral in `article` state for stable measurement and tests.

- [ ] **Step 5: Run component tests**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/thinReadingAssociationGraph.test.tsx src/tests/thinReadingTab.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit three-stage interaction**

```bash
git add products/liteasy/apps/desktop/src/app/features/thin-reading/ThinReadingTab.tsx products/liteasy/apps/desktop/src/app/features/thin-reading/thinReading.css products/liteasy/apps/desktop/src/tests/thinReadingAssociationGraph.test.tsx products/liteasy/apps/desktop/src/tests/thinReadingTab.test.tsx
git commit -m "feat: unify related recommendation controls"
```

### Task 4: Add The Local Batched Verified Paper-Relation Endpoint

**Files:**
- Create: `development/dev-cloud/payloads/paperRelationPayloads.mjs`
- Create: `development/dev-cloud/payloads/paperRelationPayloads.test.mjs`
- Modify: `development/dev-cloud/requestHandler.mjs`
- Modify: `development/dev-cloud/server.test.mjs`

**Interfaces:**
- Consumes request: `{ artifactId: string; papers: Array<{ canonicalPaperId?: string; doi?: string; id: string; provider: string; sourceId: string }> }`, maximum 24 unique papers.
- Produces response: `{ edges: RecommendationPaperEdge[]; warnings: string[] }` through `POST /v1/research/paper-relations`.

- [ ] **Step 1: Write failing pure derivation tests**

```js
test("derives relations across papers owned by different anchors", async () => {
  const result = await buildPaperRelationPayload(input, {
    fetchGraphRecords: async () => [
      { id: "openalex:W1", referencedPaperIds: ["openalex:W2", "openalex:W9"] },
      { id: "openalex:W2", referencedPaperIds: ["openalex:W9"] }
    ]
  });
  assert.deepEqual(result.edges.map((edge) => edge.kind).sort(), ["bibliographic_coupling", "direct_citation"]);
  assert.equal(result.edges.every((edge) => edge.evidenceRecordUrls.length > 0), true);
});

test("never emits semantic similarity as a paper relation", async () => {
  const result = await buildPaperRelationPayload(input, { fetchGraphRecords: async () => semanticOnlyRecords });
  assert.deepEqual(result.edges, []);
});
```

- [ ] **Step 2: Run the new Node test and confirm the missing-module failure**

Run: `cd development/dev-cloud && node --test payloads/paperRelationPayloads.test.mjs`

Expected: FAIL because the payload module is absent.

- [ ] **Step 3: Implement strict validation and verified derivation**

Normalize identities, reject more than 24 unique papers, batch provider graph retrieval, then derive:

```js
const direct = left.referencedPaperIds.includes(right.id);
const sharedReferences = intersection(left.referencedPaperIds, right.referencedPaperIds);
```

Emit directed citation edges when one record explicitly references the other. Emit bibliographic coupling only when `sharedReferences.length > 0`, with `strength = shared / min(reference counts)`. Emit co-citation only when a provider response explicitly supplies a shared-citing-work count. Return partial warnings on provider failure; do not synthesize edges.

- [ ] **Step 4: Register the authenticated local route**

Add `POST /v1/research/paper-relations` to the request allowlist and route it through `buildPaperRelationPayload`. Reuse the same local identity/security boundary as external knowledge.

- [ ] **Step 5: Run local payload and server tests**

Run: `cd development/dev-cloud && node --test payloads/paperRelationPayloads.test.mjs server.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the local endpoint**

```bash
git add development/dev-cloud/payloads/paperRelationPayloads.mjs development/dev-cloud/payloads/paperRelationPayloads.test.mjs development/dev-cloud/requestHandler.mjs development/dev-cloud/server.test.mjs
git commit -m "feat: add local paper relation endpoint"
```

### Task 5: Add The Independent Formal API Paper-Relation Boundary

**Files:**
- Modify: `products/liteasy/services/api/src/externalRetrievalConnectors.mjs`
- Modify: `products/liteasy/services/api/src/externalKnowledgeService.mjs`
- Modify: `products/liteasy/services/api/src/server.mjs`
- Test: `products/liteasy/services/api/src/externalKnowledgeService.test.mjs`
- Test: `products/liteasy/services/api/src/server.test.mjs`

**Interfaces:**
- Consumes the same JSON request shape as Task 4, validated independently.
- Produces `ExternalKnowledgeService.relations(principal, body, signal)` and the same response contract; it does not import local dev-cloud code.

- [ ] **Step 1: Write failing service and route contract tests**

```js
test("relations keeps only verified edges whose endpoints are requested", async () => {
  const service = new ExternalKnowledgeService({ connectors, downloader, repository });
  const result = await service.relations({ subjectId: "user-1" }, relationRequest, new AbortController().signal);
  assert.deepEqual(result.edges.map(({ sourcePaperId, targetPaperId }) => [sourcePaperId, targetPaperId]), [["openalex:W1", "openalex:W2"]]);
});
```

Add a server assertion that authenticated `POST /v1/research/paper-relations` calls `externalKnowledgeService.relations` and unauthenticated access is rejected.

- [ ] **Step 2: Run formal API tests and confirm the missing-method failure**

Run: `cd products/liteasy/services/api && node --test src/externalKnowledgeService.test.mjs src/server.test.mjs`

Expected: FAIL because `relations` and its route do not exist.

- [ ] **Step 3: Add provider relation retrieval without sharing local code**

Extend `createExternalRetrievalConnectors` with `relations(source, input)`. OpenAlex records must request IDs and `referenced_works`; Semantic Scholar records must request paper IDs and references/citations fields. Return normalized graph records to the service, not final UI edges.

- [ ] **Step 4: Validate, derive, filter, and cache in `ExternalKnowledgeService.relations`**

Use exact-field validation, a 24-paper maximum, configured connector allowlists, `Promise.allSettled`, normalized strength `[0, 1]`, and endpoint membership filtering. Reuse the existing subject-scoped retrieval cache with a relation-specific cache-key prefix.

- [ ] **Step 5: Register the formal authenticated route and run tests**

Run: `cd products/liteasy/services/api && node --test src/externalKnowledgeService.test.mjs src/server.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the formal boundary**

```bash
git add products/liteasy/services/api/src/externalRetrievalConnectors.mjs products/liteasy/services/api/src/externalKnowledgeService.mjs products/liteasy/services/api/src/server.mjs products/liteasy/services/api/src/externalKnowledgeService.test.mjs products/liteasy/services/api/src/server.test.mjs
git commit -m "feat: add formal paper relation boundary"
```

### Task 6: Fetch And Persist Page Relations Progressively In Desktop

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingPaperRelationsClient.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/thin-reading/useThinReadingPaperRelations.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/ThinReadingTab.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/thinReadingPaperRelationsClient.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/useThinReadingPaperRelations.test.ts`

**Interfaces:**
- Produces: `createThinReadingPaperRelationsClient({ endpoint, transport })` and `useThinReadingPaperRelations({ artifactId, enabled, node, onPersist })`.
- Consumes: all page anchor sources, the endpoint from `ThinReadingTab`, and `onUpdateDocument` through a focused persistence callback.

```ts
type UseThinReadingPaperRelationsInput = {
  artifactId: string;
  enabled: boolean;
  endpoint: string;
  node: ThinReadingDocument["nodes"][string];
  onPersist: (edges: readonly ThinReadingRecommendationPaperEdge[]) => void;
  transport?: ThinReadingPaperRelationsTransport;
};
```

- [ ] **Step 1: Write failing strict parser tests**

```ts
test("accepts only verified page-member relation edges", async () => {
  const load = createThinReadingPaperRelationsClient({ endpoint, transport: response(edgePayload) });
  await expect(load({ artifactId: "artifact-1", papers })).resolves.toEqual({ edges: [verifiedEdge], warnings: [] });
});

test("rejects an edge with an unrequested endpoint", async () => {
  const load = createThinReadingPaperRelationsClient({ endpoint, transport: response(outsideEdgePayload) });
  await expect(load({ artifactId: "artifact-1", papers })).rejects.toThrow("推荐文献关系返回格式无效");
});
```

- [ ] **Step 2: Run client tests and confirm the missing-module failure**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/thinReadingPaperRelationsClient.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement strict request/response parsing**

POST to `/v1/research/paper-relations`, deduplicate request papers using the same paper key as the graph, cap at 24, validate HTTPS evidence URLs, provider allowlist, edge kind, direction, finite strength `[0, 1]`, and endpoint membership.

- [ ] **Step 4: Write and run a failing progressive-hook test**

Assert the hook does nothing before graph stage, returns existing persisted edges immediately, fetches once after enablement, persists only changed verified edges, and keeps existing edges plus a warning on partial failure.

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/useThinReadingPaperRelations.test.ts`

Expected: FAIL because the hook is absent.

- [ ] **Step 5: Implement one-shot progressive loading and focused persistence**

The hook key is `artifactId + node.id + sorted paper keys`. Abort on unmount/key change, do not clear persisted edges while loading, and call `onPersist(edges)` once only when normalized content changed. Integrate it into `ThinReadingTab` when `recommendationStage === "graph"`.

- [ ] **Step 6: Run desktop relation tests**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/thinReadingPaperRelationsClient.test.ts src/tests/useThinReadingPaperRelations.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit progressive desktop relations**

```bash
git add products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingPaperRelationsClient.ts products/liteasy/apps/desktop/src/app/features/thin-reading/useThinReadingPaperRelations.ts products/liteasy/apps/desktop/src/app/features/thin-reading/ThinReadingTab.tsx products/liteasy/apps/desktop/src/tests/thinReadingPaperRelationsClient.test.ts products/liteasy/apps/desktop/src/tests/useThinReadingPaperRelations.test.ts
git commit -m "feat: load page paper relations progressively"
```

### Task 7: Project One Page-Wide Graph And Stable Primary Ownership

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/associations/associationGraphProjection.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/associations/AssociationGraphLayer.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/associationGraphProjection.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/associationGraphLayer.test.tsx`

**Interfaces:**
- Produces: `projectAssociationPageGraph({ anchors, paperEdges, sourcesByAnchor }): AssociationPageGraphProjection` with deduplicated papers, `primaryAnchorId`, secondary anchor IDs, primary anchor edges, and filtered paper edges.
- Consumes: `pageGraphPaperKey`, anchor quality, source confidence/relevance, and persisted paper edges.

```ts
export type AssociationPageGraphProjection = {
  paperEdges: readonly {
    directed: boolean;
    kind: ThinReadingRecommendationPaperEdge["kind"];
    sourcePaperKey: string;
    strength: number;
    targetPaperKey: string;
  }[];
  paperNodes: readonly {
    anchorIds: readonly string[];
    paperKey: string;
    primaryAnchorId: string;
    secondaryAnchorIds: readonly string[];
    source: ThinReadingExternalSource;
  }[];
  primaryAnchorEdges: readonly { anchorId: string; paperKey: string }[];
};
```

- [ ] **Step 1: Write failing cross-anchor projection tests**

```ts
test("keeps verified relations across different anchor owners", () => {
  const graph = projectAssociationPageGraph(crossAnchorInput());
  expect(graph.paperNodes).toHaveLength(2);
  expect(graph.paperEdges).toEqual([expect.objectContaining({ sourcePaperKey: "openalex:W1", targetPaperKey: "openalex:W2" })]);
});

test("chooses one stable primary anchor and retains secondary membership", () => {
  const paper = projectAssociationPageGraph(sharedPaperInput()).paperNodes[0]!;
  expect(paper.primaryAnchorId).toBe("author-cited-anchor");
  expect(paper.secondaryAnchorIds).toEqual(["semantic-anchor"]);
});
```

- [ ] **Step 2: Run projection tests and confirm the missing-module failure**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/associationGraphProjection.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement deterministic page-wide projection**

Deduplicate by canonical ID, DOI, then source ID. Select primary ownership by confidence basis rank, confidence, relevance, anchor quality, then stable anchor ID. Filter paper edges to the deduplicated visible set and canonicalize undirected endpoint order.

- [ ] **Step 4: Render resting primary edges and focused secondary edges**

Pass the projection into layout/rendering. Resting state draws one primary anchor edge per paper. Focused paper or focused anchor adds verified secondary anchor edges in a separate class and accessible label without changing positions.

- [ ] **Step 5: Run projection and layer tests**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/associationGraphProjection.test.ts src/tests/associationGraphLayer.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit page-wide projection**

```bash
git add products/liteasy/apps/desktop/src/app/features/associations/associationGraphProjection.ts products/liteasy/apps/desktop/src/app/features/associations/AssociationGraphLayer.tsx products/liteasy/apps/desktop/src/tests/associationGraphProjection.test.ts products/liteasy/apps/desktop/src/tests/associationGraphLayer.test.tsx
git commit -m "feat: project page-wide recommendation graph"
```

### Task 8: Add Same-Side Constrained Layout With A Quality Gate

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/associations/associationGraphGeometry.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/associations/associationGraphLayout.ts`
- Test: `products/liteasy/apps/desktop/src/tests/associationGraphGeometry.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/associationGraphLayout.test.ts`

**Interfaces:**
- Produces: `layoutConstrainedAssociationPageGraph(input)`, `evaluateAssociationLayout(input, graph)`, and a `layoutSource: "baseline" | "constrained"` report.
- Consumes: Task 7 projection, fixed anchor rectangles, frame dimensions, and d3-force.

- [ ] **Step 1: Write failing geometry metric tests**

```ts
test("detects proper crossings but ignores shared endpoints", () => {
  expect(segmentsCross(a, b)).toBe(true);
  expect(segmentsCross(sharedEndpointA, sharedEndpointB)).toBe(false);
});

test("rejects papers placed on opposite sides of one anchor", () => {
  expect(evaluateSameSide(anchor, [leftPaper, rightPaper])).toEqual({ side: null, violations: 1 });
});
```

- [ ] **Step 2: Run geometry tests and confirm missing helpers**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/associationGraphGeometry.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement exact geometry and quality metrics**

Implement orientation-based segment crossing, rectangle overlap, frame overflow, anchor obstruction, same-side sector membership, weighted crossing count, and weighted stress. Treat primary anchor edges as higher crossing weight than paper edges.

- [ ] **Step 4: Write failing constrained-layout tests**

```ts
test("keeps every primary fan on one selected side with zero primary crossings", () => {
  const graph = layoutConstrainedAssociationPageGraph(densePageInput());
  expect(graph.quality.sameSideViolations).toBe(0);
  expect(graph.quality.primaryEdgeCrossings).toBe(0);
});

test("returns the baseline when the candidate quality is worse", () => {
  const graph = layoutAssociationPageGraph(inputWithForcedBadCandidate());
  expect(graph.layoutSource).toBe("baseline");
});
```

- [ ] **Step 5: Implement side assignment, constrained forces, and acceptance**

Use the current layout as initial positions. Evaluate left/right costs per anchor and dynamic-program adjacent anchors for a minimum total of expected crossings, congestion, and edge length. Constrain every primary paper to its owner’s `+/-55deg` side sector. Run bounded d3-force ticks with charge, collision, primary relevance springs, and global paper-relation springs; project nodes back into their legal sector after every tick. Apply deterministic crossing-reduction swaps inside each sector.

Accept only when overflow, overlap, obstruction, same-side violations, and primary crossings are all zero, weighted crossings do not exceed baseline, and weighted stress does not exceed baseline. Otherwise return the unchanged baseline result.

- [ ] **Step 6: Run geometry and layout tests**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/associationGraphGeometry.test.ts src/tests/associationGraphLayout.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit constrained layout**

```bash
git add products/liteasy/apps/desktop/src/app/features/associations/associationGraphGeometry.ts products/liteasy/apps/desktop/src/app/features/associations/associationGraphLayout.ts products/liteasy/apps/desktop/src/tests/associationGraphGeometry.test.ts products/liteasy/apps/desktop/src/tests/associationGraphLayout.test.ts
git commit -m "feat: constrain page recommendation layout"
```

### Task 9: Render Deterministic Ink-Wash Primary And Paper Edges

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/associations/associationHandDrawnPath.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/associations/AssociationGraphLayer.tsx`
- Modify: `products/liteasy/apps/desktop/src/app/features/associations/associationSourcePresentation.ts`
- Modify: `products/liteasy/apps/desktop/src/app/styles/app.css`
- Test: `products/liteasy/apps/desktop/src/tests/associationHandDrawnPath.test.ts`
- Test: `products/liteasy/apps/desktop/src/tests/associationGraphLayer.test.tsx`

**Interfaces:**
- Produces: `createAssociationInkPaths({ edgeId, exactPath }): { hitPath; inkPath; echoPath; washPath }` and relation presentation for all paper-edge kinds.
- Consumes: exact routed paths from Task 8 and focus/hover state from `AssociationGraphLayer`.

- [ ] **Step 1: Write failing deterministic path tests**

```ts
test("keeps endpoints exact while producing stable hand-drawn variants", () => {
  const first = createAssociationInkPaths(curveInput("edge-1"));
  const second = createAssociationInkPaths(curveInput("edge-1"));
  expect(first).toEqual(second);
  expect(pathEndpoints(first.inkPath)).toEqual(pathEndpoints(first.hitPath));
  expect(first.echoPath).not.toBe(first.inkPath);
});
```

- [ ] **Step 2: Run path tests and confirm the missing-module failure**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/associationHandDrawnPath.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement edge-ID seeded control-point perturbation**

Hash `edgeId` to bounded signed offsets. Keep start/end untouched, perturb only interior Bezier control points, generate a faint secondary stroke with a different deterministic offset, and use the exact path as a transparent wider hit path. Do not use `Math.random`, time, SVG turbulence animation, or a moving filter.

- [ ] **Step 4: Render semantic edge layers and dynamic legend**

Render in order: paper-edge wash/ink, primary-anchor wash/ink, focused secondary edges, transparent hit paths, nodes. Use relation classes for author citation, citation graph, semantic retrieval, direct citation, co-citation, and coupling. Direct citation has an accessible directional endpoint. The legend lists only kinds present in the current projection.

- [ ] **Step 5: Apply H2 ink-and-wash tokens**

Keep Fluent cards and text. Use low-saturation vermilion for direct citation, grey-violet for co-citation, moss dashed lines for coupling, deep green for author citation, indigo for citation graph, and graphite short dashes for semantic retrieval. Map distance to edge/border/wash opacity while keeping title contrast readable. Focus raises only the selected path’s saturation and width.

- [ ] **Step 6: Run renderer tests**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/associationHandDrawnPath.test.ts src/tests/associationGraphLayer.test.tsx src/tests/thinReadingAssociationGraph.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit ink-wash rendering**

```bash
git add products/liteasy/apps/desktop/src/app/features/associations/associationHandDrawnPath.ts products/liteasy/apps/desktop/src/app/features/associations/AssociationGraphLayer.tsx products/liteasy/apps/desktop/src/app/features/associations/associationSourcePresentation.ts products/liteasy/apps/desktop/src/app/styles/app.css products/liteasy/apps/desktop/src/tests/associationHandDrawnPath.test.ts products/liteasy/apps/desktop/src/tests/associationGraphLayer.test.tsx products/liteasy/apps/desktop/src/tests/thinReadingAssociationGraph.test.tsx
git commit -m "feat: render ink wash recommendation edges"
```

### Task 10: Browser Geometry, Accessibility, And Full Verification

**Files:**
- Modify: `products/liteasy/apps/desktop/src/tests/fixtures/thinReadingFixtures.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/browser/thinReading.browser.spec.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/layoutStyleContract.test.ts`

**Interfaces:**
- Consumes: completed three-stage UI, persisted cross-anchor paper edges, layout quality report, and ink-wash SVG layers.
- Produces: browser evidence that geometry, rendering, interaction, and accessibility requirements hold at real layout sizes.

- [ ] **Step 1: Extend the browser fixture with a verified cross-anchor paper relation**

Add one direct-citation edge between papers owned by different anchors, one coupling edge, one shared paper with a secondary anchor, anchor quality reasons, and enough papers to exercise adjacent side assignment.

- [ ] **Step 2: Write failing browser assertions**

```ts
await page.getByRole("button", { name: "相关推荐" }).click();
await expect(page.locator(".thin-reading__anchor").first()).toBeVisible();
await page.getByRole("button", { name: "相关推荐" }).click();
await expect(page.locator(".association-paper-edge")).toHaveCount(2);
expect(await primaryEdgeCrossingCount(page)).toBe(0);
expect(await sameSideViolationCount(page)).toBe(0);
expect(await nonTransparentInkPixelCount(page)).toBeGreaterThan(100);
```

Also assert keyboard focus, relation accessible labels, dynamic legend contents, paper-card return order, third-click reset, and desktop/narrow/mobile text containment.

- [ ] **Step 3: Run the focused Playwright test against the existing fixture server**

Run: `cd products/liteasy/apps/desktop && npx playwright test src/tests/browser/thinReading.browser.spec.ts --grep "page recommendation graph"`

Expected: FAIL until fixture wiring and final responsive adjustments are complete.

- [ ] **Step 4: Make only evidence-driven responsive and accessibility adjustments**

Adjust stable graph dimensions, side-sector bounds, legend wrapping, node title clamping, keyboard focus outline, and mobile fallback based on the failing assertions. Do not relax zero-overlap, zero-primary-crossing, same-side, or endpoint tests to make the run pass.

- [ ] **Step 5: Run all affected desktop tests**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/thinReadingProjection.test.ts src/tests/thinReadingAnchorQuality.test.ts src/tests/thinReadingAssociationGraph.test.tsx src/tests/thinReadingTab.test.tsx src/tests/thinReadingPaperRelationsClient.test.ts src/tests/useThinReadingPaperRelations.test.ts src/tests/associationGraphProjection.test.ts src/tests/associationGraphGeometry.test.ts src/tests/associationGraphLayout.test.ts src/tests/associationHandDrawnPath.test.ts src/tests/associationGraphLayer.test.tsx src/tests/layoutStyleContract.test.ts`

Expected: PASS.

- [ ] **Step 6: Run service suites**

Run: `cd development/dev-cloud && npm test`

Expected: PASS.

Run: `cd products/liteasy/services/api && npm test`

Expected: PASS.

- [ ] **Step 7: Run full desktop verification**

Run: `cd products/liteasy/apps/desktop && npm test`

Expected: PASS.

Run: `cd products/liteasy/apps/desktop && npm run build`

Expected: PASS.

Run: `cd products/liteasy/apps/desktop && npx playwright test src/tests/browser/thinReading.browser.spec.ts --grep "page recommendation graph"`

Expected: PASS with nonblank desktop, narrow, and mobile screenshots and zero geometry violations.

- [ ] **Step 8: Commit final browser coverage**

```bash
git add products/liteasy/apps/desktop/src/tests/fixtures/thinReadingFixtures.ts products/liteasy/apps/desktop/src/tests/browser/thinReading.browser.spec.ts products/liteasy/apps/desktop/src/tests/layoutStyleContract.test.ts
git commit -m "test: verify page recommendation graph"
```
