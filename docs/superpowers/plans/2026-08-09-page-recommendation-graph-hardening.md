# Page Recommendation Graph Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining DOI identity defect, select the 24 visible papers by anchor coverage and value, guarantee hard-zero final geometry, and verify the maximum-density graph in a real browser.

**Architecture:** The formal connector consumes normalized aliases from the service boundary. Page projection owns the one shared 24-paper selection used by rendering and retrieval. The existing deterministic layout and constrained search remain unchanged internally; a wrapper permits the exact baseline only when it is hard-safe and otherwise uses a coverage/degraded result. A focused exact-path module is shared by geometry and SVG rendering.

**Tech Stack:** React 18, TypeScript 5.8, Fluent UI 2, d3-force 3, Vitest, Testing Library, Playwright, Node.js 20 test runner.

## Global Constraints

- Preserve dependency direction `layout -> controllers -> features -> shared types / clients`.
- Do not modify anchor scoring weights `0.35 / 0.25 / 0.20 / 0.20`.
- Keep verified-only `direct_citation`, `co_cited`, and `bibliographic_coupling` paper edges.
- Keep the formal service independent from `development/dev-cloud/`.
- Keep 24 as the shared visible/request paper limit.
- Preserve the current deterministic layout implementation and its acceptance thresholds.
- Never return a final rendered graph with overflow, overlap, anchor obstruction, same-side, or primary-edge-crossing violations.
- Preserve all unrelated workspace edits and stage only files named in each task.
- Use two-space indentation, double quotes, semicolons, Fluent UI components, and Fluent icons.

---

### Task 1: Make DOI Aliases Authoritative For Formal Relation Connectors

**Files:**
- Modify: `products/liteasy/services/api/src/externalRetrievalConnectors.mjs:309-325`
- Modify: `products/liteasy/services/api/src/externalRetrievalConnectors.test.mjs`
- Modify: `.superpowers/sdd/2026-08-08-page-recommendation-graph/final-review-fix-report.md`

**Interfaces:**
- Consumes: normalized relation papers shaped as `{ aliases: string[], doi?: string, id, provider, sourceId }`.
- Produces: Semantic Scholar candidates using a graph ID when present, otherwise a stable DOI from `paper.doi` or `paper.aliases`.

- [ ] **Step 1: Add the canonical-DOI-only regression test**

Add a focused connector test whose paper has no `doi` property:

```js
test("Semantic Scholar relations resolve a DOI present only in canonical aliases", async () => {
  const calls = [];
  const connectors = createExternalRetrievalConnectors(config, {
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse({
        externalIds: { DOI: "10.1000/CANONICAL-ONLY" },
        paperId: "S-CANONICAL",
        references: []
      });
    }
  });

  const result = await connectors.relations({
    baseUrl: retrievalConnectorEndpoints.semantic_scholar,
    connectorType: "semantic_scholar"
  }, { papers: [{
    aliases: ["crossref:10.1000/canonical-only", "doi:10.1000/canonical-only"],
    id: "paper-canonical",
    provider: "crossref",
    sourceId: "10.1000/canonical-only"
  }] });

  assert.match(calls[0], /paper\/DOI%3A10\.1000%2Fcanonical-only/u);
  assert.equal(result[0].id, "semantic_scholar:S-CANONICAL");
});
```

- [ ] **Step 2: Run RED**

Run: `cd products/liteasy/services/api && node --test src/externalRetrievalConnectors.test.mjs`

Expected: FAIL because `calls[0]` is absent and the connector returns no records.

- [ ] **Step 3: Read DOI candidates from the normalized alias contract**

Replace the Semantic Scholar DOI fallback with:

```js
const doi = [paper.doi, ...(paper.aliases ?? [])]
  .map((value) => doiKey(value))
  .filter(Boolean)
  .sort()[0];
return doi ? [`DOI:${doi}`] : [];
```

Keep graph-ID precedence, fixed endpoint validation, abort propagation, headers, and response normalization unchanged.

- [ ] **Step 4: Run GREEN and the service contract suite**

Run: `cd products/liteasy/services/api && node --test src/externalRetrievalConnectors.test.mjs src/externalKnowledgeService.test.mjs`

Expected: all connector and service tests pass, including the canonical-only case.

- [ ] **Step 5: Record the closed finding and commit only Task 1**

Update the ignored SDD report to state that the canonical-only reproduction now issues a Semantic Scholar request. Then run:

```bash
git add products/liteasy/services/api/src/externalRetrievalConnectors.mjs \
  products/liteasy/services/api/src/externalRetrievalConnectors.test.mjs
git commit -m "fix: resolve canonical DOI relation queries"
```

### Task 2: Select 24 Papers By Anchor Coverage And Value

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/associations/associationGraphProjection.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/associations/AssociationGraphLayer.tsx`
- Modify: `products/liteasy/apps/desktop/src/tests/associationGraphProjection.test.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/associationGraphLayer.test.tsx`
- Modify: `products/liteasy/apps/desktop/src/tests/useThinReadingPaperRelations.test.ts`

**Interfaces:**
- Produces: `AssociationPageGraphProjection.hiddenPaperCount: number`.
- Produces: deterministic `selectAssociationPaperNodes(allNodes, anchors, maximum)` behavior internal to projection.
- Consumes: complete alias-unioned components, anchor quality, ownership evidence, confidence, and relevance.

- [ ] **Step 1: Replace the lexicographic-cap expectation with a failing coverage/value test**

Extend the dense 31-component projection fixture so late lexical IDs include higher relevance. Assert:

```ts
expect(graph.paperNodes).toHaveLength(24);
expect(graph.hiddenPaperCount).toBe(7);
for (const anchor of input.anchors) {
  expect(graph.paperNodes.some((paper) => paper.anchorIds.includes(anchor.anchorId))).toBe(true);
}
expect(graph.paperNodes.map((paper) => paper.paperKey)).toContain("openalex:W031");
```

Name the production behavior that makes this pass: coverage-phase selection plus value-phase fill. Current lexicographic `.slice(0, 24)` must fail the final two assertions.

- [ ] **Step 2: Run RED**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/associationGraphProjection.test.ts`

Expected: FAIL because one dense-page anchor has no selected paper, `W031` is hidden, and `hiddenPaperCount` is absent.

- [ ] **Step 3: Build every projected node before selection**

Keep each node's internal primary `OwnershipCandidate` while constructing all components. Add deterministic helpers equivalent to:

```ts
const orderedAnchors = anchors.map((anchor, index) => ({ ...anchor, index }))
  .sort((left, right) => (right.quality?.score ?? 0) - (left.quality?.score ?? 0) ||
    left.index - right.index || left.anchorId.localeCompare(right.anchorId));

const selectedKeys = new Set<string>();
for (const anchor of orderedAnchors) {
  if (allNodes.some((paper) => selectedKeys.has(paper.paperKey) &&
      paper.anchorIds.includes(anchor.anchorId))) continue;
  const best = allNodes.filter((paper) => !selectedKeys.has(paper.paperKey) &&
      paper.anchorIds.includes(anchor.anchorId)).sort(compareProjectedPaperValue)[0];
  if (best) selectedKeys.add(best.paperKey);
}
for (const paper of [...allNodes].sort(compareProjectedPaperValue)) {
  if (selectedKeys.size >= maximumAssociationPageGraphPapers) break;
  selectedKeys.add(paper.paperKey);
}
```

Return selected nodes in stable `paperKey` order. `compareProjectedPaperValue` delegates to `compareOwnership(primary)` and then `paperKey`.

- [ ] **Step 4: Expose hidden count and retain selected-endpoint filtering**

Set `hiddenPaperCount = allNodes.length - paperNodes.length`, include it in the projection return value, and add `data-hidden-papers={projection.hiddenPaperCount}` to the graph region. Do not add explanatory developer copy.

- [ ] **Step 5: Update request/render equivalence expectations and run GREEN**

The hook test must derive its expected keys from the projection and assert exact equality with the request. Run:

```bash
cd products/liteasy/apps/desktop
npm test -- --run src/tests/associationGraphProjection.test.ts \
  src/tests/associationGraphLayer.test.tsx \
  src/tests/useThinReadingPaperRelations.test.ts
```

Expected: all three files pass; every retained anchor has coverage and hidden endpoints remain filtered.

- [ ] **Step 6: Commit only Task 2**

```bash
git add products/liteasy/apps/desktop/src/app/features/associations/associationGraphProjection.ts \
  products/liteasy/apps/desktop/src/app/features/associations/AssociationGraphLayer.tsx \
  products/liteasy/apps/desktop/src/tests/associationGraphProjection.test.ts \
  products/liteasy/apps/desktop/src/tests/associationGraphLayer.test.tsx \
  products/liteasy/apps/desktop/src/tests/useThinReadingPaperRelations.test.ts
git commit -m "fix: prioritize page graph paper coverage"
```

### Task 3: Share Exact Geometry And Guarantee A Hard-safe Final Graph

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/associations/associationExactPath.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/associations/associationGraphGeometry.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/associations/associationGraphLayout.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/associations/AssociationGraphLayer.tsx`
- Create: `products/liteasy/apps/desktop/src/tests/associationExactPath.test.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/associationGraphGeometry.test.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/associationGraphLayout.test.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/associationGraphLayer.test.tsx`

**Interfaces:**
- Produces: `createAssociationExactPath(start, end, controlRatio): { d, segments }`.
- Extends: `ConstrainedPageGraph.layoutSource` with `"degraded"`.
- Guarantees: the returned `quality` has zero hard violations for every input.

- [ ] **Step 1: Add failing exact-path ownership tests**

Create a test importing the not-yet-created module:

```ts
test("returns one collinear exact segment and its matching quadratic SVG path", () => {
  expect(createAssociationExactPath(
    { left: 10, top: 20 },
    { left: 110, top: 70 },
    0.52
  )).toEqual({
    d: "M 10 20 Q 62 46 110 70",
    segments: [{ start: { left: 10, top: 20 }, end: { left: 110, top: 70 } }]
  });
});
```

- [ ] **Step 2: Add failing final-hard-safety tests**

Replace the impossible-canvas baseline expectation with:

```ts
expect(graph.layoutSource).toBe("degraded");
expect(graph.nodes).toEqual([]);
expect(graph.hiddenCountByAnchor).toEqual({ a1: 1 });
expect(graph.quality).toMatchObject({
  anchorObstructions: 0,
  nodeOverlaps: 0,
  overflowCount: 0,
  primaryEdgeCrossings: 0,
  sameSideViolations: 0
});
```

Add a second fixture where the full graph is hard-unsafe but one highest-relevance paper per anchor is feasible. Assert a nonempty `degraded` result, one node per represented anchor, and zero hard violations.

- [ ] **Step 3: Run RED**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- --run src/tests/associationExactPath.test.ts \
  src/tests/associationGraphLayout.test.ts
```

Expected: FAIL because the module and `degraded` return path do not exist.

- [ ] **Step 4: Implement the shared exact path**

The new module defines structural point/segment types and returns a collinear quadratic path with exact endpoints. Import it in `AssociationGraphLayer` for primary, secondary, and paper exact paths. Import it in `associationGraphGeometry` and append its `segments` to crossing evaluation instead of independently constructing endpoint segments.

- [ ] **Step 5: Isolate the unchanged full layout attempt**

Rename the current exported implementation body to an internal `layoutConstrainedAssociationPageGraphAttempt(input)`. Keep side variants, force ticks, search budgets, comparison ordering, and `candidateIsAccepted` byte-for-byte equivalent. Add:

```ts
function hardViolationCount(quality: AssociationLayoutQuality) {
  return quality.overflowCount + quality.nodeOverlaps + quality.anchorObstructions +
    quality.sameSideViolations + quality.primaryEdgeCrossings;
}
```

- [ ] **Step 6: Add deterministic coverage and anchor-only degradation**

The public `layoutConstrainedAssociationPageGraph` runs the full attempt first. Return it when `hardViolationCount(full.quality) === 0`. Otherwise:

1. sort each anchor's primary sources by relevance, confidence, and stable ID;
2. keep one source per anchor;
3. filter `paperEdges`, `paperKeyBySource`, and `multiAnchorPaperKeys` to those keys;
4. run the unchanged attempt once on that coverage input;
5. return a hard-safe coverage result with `layoutSource: "degraded"` and combined hidden counts;
6. if coverage is still unsafe, return an empty node/edge graph, evaluate its zero quality, preserve diagnostics, and count every input source as hidden.

Do not relax baseline stress/crossing acceptance. A hard-safe exact baseline is still returned unchanged by the internal attempt.

- [ ] **Step 7: Run GREEN and affected geometry/renderer tests**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- --run src/tests/associationExactPath.test.ts \
  src/tests/associationGraphGeometry.test.ts \
  src/tests/associationGraphLayout.test.ts \
  src/tests/associationGraphLayer.test.tsx
```

Expected: all files pass and every public layout return has zero hard violations.

- [ ] **Step 8: Commit only Task 3**

```bash
git add products/liteasy/apps/desktop/src/app/features/associations/associationExactPath.ts \
  products/liteasy/apps/desktop/src/app/features/associations/associationGraphGeometry.ts \
  products/liteasy/apps/desktop/src/app/features/associations/associationGraphLayout.ts \
  products/liteasy/apps/desktop/src/app/features/associations/AssociationGraphLayer.tsx \
  products/liteasy/apps/desktop/src/tests/associationExactPath.test.ts \
  products/liteasy/apps/desktop/src/tests/associationGraphGeometry.test.ts \
  products/liteasy/apps/desktop/src/tests/associationGraphLayout.test.ts \
  products/liteasy/apps/desktop/src/tests/associationGraphLayer.test.tsx
git commit -m "fix: guarantee hard-safe page graph geometry"
```

### Task 4: Verify Maximum-density Browser Geometry And Latency

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/associations/AssociationGraphLayer.tsx`
- Modify: `products/liteasy/apps/desktop/src/tests/fixtures/thinReadingFixtures.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/fixtures/pageRecommendationGraphBrowserFixture.tsx`
- Modify: `products/liteasy/apps/desktop/src/tests/browser/thinReading.browser.spec.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/layoutStyleContract.test.ts`

**Interfaces:**
- Produces: `createThinReadingMaximumDensityAnchorGraphFixture()` with eight anchors, 32 source records, 31 alias-unioned components, and 24 selected components.
- Produces: `mountPageRecommendationGraphFixture(container, "standard" | "maximum")`.
- Consumes: final layout diagnostics and real SVG hit paths.

- [ ] **Step 1: Add the maximum-density document fixture**

Create four summary sentences with two stable anchor tokens each. Give every anchor four source
records with descending confidence/relevance and a mix of author citation, citation graph,
registry, and semantic retrieval bases. Make one Crossref record a DOI alias of one OpenAlex record,
leaving 31 components before the selector retains 24. Add verified direct-citation/coupling edges
between different primary owners.

- [ ] **Step 2: Parameterize the browser mount helper**

Make the fixture component select the standard or maximum document from an explicit argument. Keep the standard fixture unchanged for screenshot compatibility.

- [ ] **Step 3: Add failing maximum-density browser tests**

For desktop `1440x900`, narrow `760x900`, and mobile `390x844`:

```ts
const recommendations = page.getByRole("button", { name: "相关推荐" });
await recommendations.click();
const startedAt = await page.evaluate(() => performance.now());
await recommendations.click();
await expect(page.getByRole("region", { exact: true, name: "页级关联图" })).toBeVisible();
const elapsed = await page.evaluate((start) => performance.now() - start, startedAt);
expect(elapsed).toBeLessThan(1_500);
await expect(graph.locator(".association-node")).toHaveCount(24);
expect(await graphGeometry(page)).toMatchObject({
  anchorObstructions: 0,
  layoutPrimaryCrossings: 0,
  layoutSameSideViolations: 0,
  nodeOverlaps: 0,
  outsideGraph: 0,
  primaryCrossings: 0,
  sameSideViolations: 0,
  textOverflow: 0
});
```

Also assert `data-initial-candidates <= 35000`, `data-repair-candidates <= 5000`, `data-repair-nodes <= 48`, 24 selected papers, and a nonzero hidden count when the alias-unioned candidate pool exceeds 24.

Add `data-initial-candidates={graph.searchDiagnostics.initialSlotCandidateEvaluations}` to the
graph region; the other repair/side diagnostics remain unchanged.

- [ ] **Step 4: Run RED against the local fixture server**

Run:

```bash
cd products/liteasy/apps/desktop
PLAYWRIGHT_BASE_URL=http://127.0.0.1:1428 \
  npx playwright test src/tests/browser/thinReading.browser.spec.ts \
  --grep "maximum-density page recommendation graph"
```

Expected: FAIL until the maximum fixture and assertions are wired.

- [ ] **Step 5: Verify the existing production surface without relaxing it**

Run: `cd products/liteasy/apps/desktop && npm test -- --run src/tests/layoutStyleContract.test.ts`

Expected: the existing stable graph dimensions and Fluent-compatible containment contract pass
unchanged. A browser geometry or latency failure is a blocker: use systematic debugging to locate
the production cause, add a failing focused test for that cause, and revise this written design
before changing a CSS dimension or any crossing, overlap, same-side, endpoint, search-budget, or
latency assertion.

- [ ] **Step 6: Run GREEN and commit Task 4**

Run the maximum-density browser grep at all three viewports, then:

```bash
git add products/liteasy/apps/desktop/src/tests/fixtures/thinReadingFixtures.ts \
  products/liteasy/apps/desktop/src/app/features/associations/AssociationGraphLayer.tsx \
  products/liteasy/apps/desktop/src/tests/fixtures/pageRecommendationGraphBrowserFixture.tsx \
  products/liteasy/apps/desktop/src/tests/browser/thinReading.browser.spec.ts \
  products/liteasy/apps/desktop/src/tests/layoutStyleContract.test.ts
git commit -m "test: cover maximum-density page graph"
```

### Task 5: Final Verification, Documentation, And Review

**Files:**
- Modify: `.superpowers/sdd/2026-08-08-page-recommendation-graph/progress.md`
- Modify: `.superpowers/sdd/2026-08-08-page-recommendation-graph/final-review-fix-report.md`

**Interfaces:**
- Consumes: committed Tasks 1-4 and fresh command output.
- Produces: an evidence-backed final status with no unresolved Critical/Important finding.

- [ ] **Step 1: Run full formal API verification**

Run: `cd products/liteasy/services/api && npm test`

Expected: every formal API test passes.

- [ ] **Step 2: Run all affected desktop suites**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- --run src/tests/associationExactPath.test.ts \
  src/tests/associationGraphGeometry.test.ts \
  src/tests/associationGraphLayout.test.ts \
  src/tests/associationHandDrawnPath.test.ts \
  src/tests/associationGraphProjection.test.ts \
  src/tests/associationGraphLayer.test.tsx \
  src/tests/thinReadingPaperRelationsClient.test.ts \
  src/tests/useThinReadingPaperRelations.test.ts \
  src/tests/thinReadingAssociationGraph.test.tsx \
  src/tests/thinReadingTab.test.tsx \
  src/tests/layoutStyleContract.test.ts
```

Expected: every affected test passes.

- [ ] **Step 3: Run the full desktop suite and build**

Run: `cd products/liteasy/apps/desktop && npm test`

Run: `cd products/liteasy/apps/desktop && npm run build`

Expected: full tests, TypeScript, Vite, and production asset verification pass. If the unrelated `ArtifactLibraryPane` timing test fails, rerun that file once in isolation and report both results without modifying it.

- [ ] **Step 4: Run all graph Playwright checks**

Run:

```bash
cd products/liteasy/apps/desktop
PLAYWRIGHT_BASE_URL=http://127.0.0.1:1428 \
  npx playwright test src/tests/browser/thinReading.browser.spec.ts \
  --grep "page recommendation graph"
```

Expected: standard and maximum-density desktop/narrow/mobile checks pass with nonblank ink and zero geometry violations.

- [ ] **Step 5: Review the complete hardening range**

Review from the design commit through Task 4 against:

- `docs/superpowers/specs/2026-08-09-page-recommendation-graph-hardening-design.md`;
- this plan;
- the original page recommendation graph design.

Any Critical or Important finding enters another narrowly scoped red-green fix. The number of prior fix waves is not an acceptance criterion.

- [ ] **Step 6: Update ignored evidence documents and check scope**

Record exact counts, warnings, browser viewport results, review verdict, and the separately deferred dev-cloud abort Minor. Run:

```bash
git diff --check
git status --short
git log --oneline --decorate -10
```

Expected: no whitespace errors; only known unrelated user files remain uncommitted; every graph hardening production/test file belongs to a focused commit.
