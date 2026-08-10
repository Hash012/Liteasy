# Thin-Reading Anchor Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `ThinReadingAnchor.label`, keep exact anchor prose visible through local association-graph windows, and preserve retrieval and historical-artifact compatibility.

**Architecture:** Migrate graph consumers to exact `anchor.text`, then retire `label` at the model and document boundaries. Replace the solid graph veil plus label chip with one SVG mask whose measured anchor rectangles are translucent windows; pass all measured rectangles into the pure layout so paper nodes avoid wrapped source text.

**Tech Stack:** React 18, TypeScript 5.8, Zod 4, Vitest, Testing Library, Playwright, CSS, SVG masks.

## Global Constraints

- Follow desktop dependency direction: `layout -> controllers -> features -> shared types / clients`.
- Preserve the existing `FluentProvider`, Fluent dependencies, activity bar, and layout tokens.
- Use two-space indentation, double quotes, and semicolons in TypeScript.
- Do not remove unrelated `label` fields such as omitted-section labels, paper-type labels, or action labels.
- Do not change `searchQuery`, external retrieval requests, citation attribution, source ranking, or paper-relation behavior.
- Preserve all pre-existing uncommitted changes. At plan creation, `thinReadingAgent.ts`, `thinReading.types.ts`, `thinReadingProjection.ts`, `generateAssistantAnswer.ts`, and related tests already contain user work for a separate quality-gate feature.
- Before every edit to an already dirty file, inspect `git diff -- <path>` and merge with the existing content; never replace the whole file.
- Before every commit, inspect `git diff --cached`. If a task cannot be staged without including pre-existing user changes, leave it uncommitted and report that constraint instead of committing unrelated work.
- Source design: `docs/superpowers/specs/2026-08-09-thin-reading-anchor-text-design.md`.

## File Map

- `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReading.types.ts`: remove `ThinReadingAnchor.label`.
- `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingAgent.ts`: remove label from current model schemas/prompts, strip the legacy field narrowly, and generate range-based IDs.
- `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingProjection.ts`: explicitly project known anchor fields so legacy labels disappear.
- `products/liteasy/apps/desktop/src/app/features/thin-reading/ThinReadingTab.tsx`: pass `text` to the graph and use it in focused state copy.
- `products/liteasy/apps/desktop/src/app/features/associations/AssociationGraphLayer.tsx`: replace label chips and the solid scrim with text-backed transparent targets and masked anchor windows.
- `products/liteasy/apps/desktop/src/app/features/associations/associationGraphLayout.ts`: accept all measured anchor rectangles and avoid each one.
- `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReading.css`: remove double dimming when the graph is open.
- `products/liteasy/apps/desktop/src/app/styles/app.css`: style the SVG scrim, anchor windows, and invisible interactive targets.
- `products/liteasy/apps/desktop/src/tests/fixtures/thinReadingFixtures.ts`: produce label-free anchors.
- `products/liteasy/apps/desktop/src/tests/thinReadingAgent.test.ts`: cover current and legacy model contracts and stable identity.
- `products/liteasy/apps/desktop/src/tests/thinReadingProjection.test.ts`: cover legacy-field removal during projection.
- `products/liteasy/apps/desktop/src/tests/thinReadingAssociationGraph.test.tsx`: cover exact text usage, no chip, mask windows, focus, and keyboard interaction.
- `products/liteasy/apps/desktop/src/tests/associationGraphLayout.test.ts`: cover wrapped-text obstacles.
- `products/liteasy/apps/desktop/src/tests/browser/thinReading.browser.spec.ts`: cover real layout at desktop and narrow viewports.
- Other `ThinReadingAnchor` fixtures found by `rg`: mechanically remove only the anchor-level `label` property.

---

### Task 1: Retire The Anchor Label Contract

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReading.types.ts:253-265`
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingAgent.ts:80-145, 940-955, 1540-1589, 1592-1617, 2008-2067`
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReadingProjection.ts:138-145`
- Modify: `products/liteasy/apps/desktop/src/tests/thinReadingAgent.test.ts`
- Modify: `products/liteasy/apps/desktop/src/tests/thinReadingProjection.test.ts`

**Interfaces:**
- Produces: `ThinReadingAnchor` without `label`.
- Produces: current model anchor shape `{ summarySentenceIndex, text, kind, importance, searchQuery }`.
- Produces: legacy normalization that removes only `anchors[].label` before strict Zod validation.
- Produces: an anchor ID derived only from `sentence.id`, `start`, and `end`.

- [ ] **Step 1: Add failing current-contract and legacy-compatibility tests**

Add a test in `thinReadingAgent.test.ts` whose anchor has no label:

```ts
test("builds label-free anchors from exact summary text", () => {
  const summary = "系统通过不同表示子空间并行建模关系。";
  const seed = parseThinReadingModelSeed(JSON.stringify({
    anchors: [{
      importance: 0.9,
      kind: "mechanism",
      searchQuery: "multi-head attention representation subspaces",
      summarySentenceIndex: 0,
      text: "不同表示子空间"
    }],
    claims: [],
    externalKnowledge: [],
    omittedSections: [],
    paperEvidence: ["evidence-survey-taxonomy"],
    paperType: "systems",
    summary,
    summarySentences: [{
      evidenceIds: ["evidence-survey-taxonomy"],
      externalKnowledge: [],
      status: "grounded",
      text: summary
    }],
    withinPaperClosure: true
  }), { analysis: prepared, targetLanguage: "zh-CN" });

  expect(seed.evidence.anchors?.[0]).toEqual(expect.objectContaining({
    text: "不同表示子空间"
  }));
  expect(seed.evidence.anchors?.[0]).not.toHaveProperty("label");
});
```

Add a second test that parses the same anchor with `label: "多头注意力"`, expects successful
parsing with no `label`, and expects its `id` to equal the label-free anchor ID. Add an unrelated
`unexpected: true` property and expect strict parsing to fail, proving the adapter is narrow.

- [ ] **Step 2: Run the focused parser tests and verify RED**

Run:

```bash
cd products/liteasy/apps/desktop
npx vitest run src/tests/thinReadingAgent.test.ts
```

Expected: the no-label case fails because `label` is required, and the legacy-discard assertion fails because current anchors retain it.

- [ ] **Step 3: Remove label from the current model contract and add the narrow legacy adapter**

Change both Zod and provider JSON schemas so the anchor properties and required fields omit `label`. Before `thinReadingModelOutputSchema.safeParse(raw)`, normalize only the retired property:

```ts
function stripLegacyThinReadingAnchorLabels(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.anchors)) return value;
  return {
    ...record,
    anchors: record.anchors.map((anchor) => {
      if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) return anchor;
      const { label: _legacyLabel, ...current } = anchor as Record<string, unknown>;
      return current;
    })
  };
}
```

Apply it after the existing retired-`recommendations` normalization and before `safeParse`. Do not strip any other property.

- [ ] **Step 4: Remove label from the domain type, builder, ID, repair prompt, and output example**

Remove `label` from `ThinReadingAnchor`. Build IDs from sentence and range only:

```ts
id: `thin-reading-anchor-${stableHash(`${sentence.id}\u0000${start}\u0000${end}`)}`,
```

Delete the anchor-label instruction and remove the field from the JSON example. Preserve every unrelated quality-gate change already present in `thinReadingAgent.ts`.

- [ ] **Step 5: Make projection discard legacy labels and add a failing/passing projection assertion**

In `thinReadingProjection.test.ts`, construct a legacy anchor through an `unknown` cast, project it with the existing document factory/update path, and assert:

```ts
expect(projectedAnchor).not.toHaveProperty("label");
expect(projectedAnchor).toEqual(expect.objectContaining({
  id: legacyAnchor.id,
  externalSourceIds: legacyAnchor.externalSourceIds,
  text: legacyAnchor.text
}));
```

Update `freezeAnchor` to copy the known `ThinReadingAnchor` fields explicitly rather than spreading the source object.

- [ ] **Step 6: Update direct anchor fixtures until the TypeScript contract is coherent**

Run:

```bash
rg -n "label:" products/liteasy/apps/desktop/src/tests products/liteasy/apps/desktop/src/app | rg "anchor|ThinReadingAnchor|definition"
```

Remove only properties that initialize `ThinReadingAnchor.label`. Keep helper-local names such as `anchorLabel` when they generate source titles, and keep omitted-section labels.

- [ ] **Step 7: Run focused tests and TypeScript build verification**

Run:

```bash
cd products/liteasy/apps/desktop
npx vitest run src/tests/thinReadingAgent.test.ts src/tests/thinReadingProjection.test.ts
npx tsc --noEmit
```

Expected: focused tests pass and TypeScript reports no remaining `ThinReadingAnchor.label` consumers.

- [ ] **Step 8: Commit the contract migration if it can be isolated**

Inspect staged content before committing:

```bash
git diff --cached
git commit -m "refactor: remove thin-reading anchor labels"
```

Do not commit if the staged patch includes the pre-existing quality-gate work; record the reason and continue with an unstaged working diff.

---

### Task 2: Render Exact Text Through Local Graph Windows

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/ThinReadingTab.tsx:909-969, 1160-1184, 1468-1491`
- Modify: `products/liteasy/apps/desktop/src/app/features/associations/AssociationGraphLayer.tsx:45-70, 162-315, 358-390, 532-576`
- Modify: `products/liteasy/apps/desktop/src/app/features/thin-reading/thinReading.css:60-70`
- Modify: `products/liteasy/apps/desktop/src/app/styles/app.css:3300-3325, 3417-3488`
- Test: `products/liteasy/apps/desktop/src/tests/thinReadingAssociationGraph.test.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/browser/thinReading.browser.spec.ts:470-690`

**Interfaces:**
- Consumes: label-free `ThinReadingAnchor` from Task 1.
- Produces: `PageGraphAnchorView` with `text: string` and `rects: readonly AnchorRect[]`.
- Produces: `.association-anchor__target` for interaction and `.association-anchor__window` for every measured source-text rectangle.
- Produces: an SVG `.association-layer__scrim` with mask windows matching those rectangles.

- [ ] **Step 1: Write failing component tests for exact text and label-free presentation**

Update the graph-cycle test to assert:

```ts
expect(container.querySelectorAll(".association-anchor__chip")).toHaveLength(0);
expect(container.querySelectorAll(".association-anchor__target")).toHaveLength(5);
expect(container.querySelectorAll(".association-anchor__window")).toHaveLength(5);
expect(container.querySelector(".association-layer__scrim mask")).not.toBeNull();
```

Use a fixture anchor whose exact `text` is longer than its retired legacy label and assert that state copy and accessible names contain the exact text:

```ts
expect(screen.getByText("正在聚焦「不同表示子空间中并行建模」及其关联文献")).toBeVisible();
expect(screen.getByRole("button", {
  name: "锚点：不同表示子空间中并行建模，已聚焦，再次点击取消"
})).toBeVisible();
```

In the browser test, replace the first chip assertion with the desired target/window contract and
add the article-opacity assertion:

```ts
await expect(graph.locator(".association-anchor__chip")).toHaveCount(0);
await expect(graph.locator(".association-anchor__target")).toHaveCount(5);
await expect(graph.locator(".association-layer__scrim-window")).toHaveCount(5);
expect(await page.locator(".thin-reading__article").evaluate((element) =>
  getComputedStyle(element).opacity
)).toBe("1");
```

Repeat target/window visibility assertions in the existing narrow-viewport branch.

- [ ] **Step 2: Run the component and browser tests and verify RED**

Run:

```bash
cd products/liteasy/apps/desktop
npx vitest run src/tests/thinReadingAssociationGraph.test.tsx
npx playwright test src/tests/browser/thinReading.browser.spec.ts
```

Expected: both fail because chips still render, the graph view still expects `label`, no masked
scrim/windows exist, and the article is opacity-dimmed.

- [ ] **Step 3: Route exact text through ThinReadingTab and AssociationGraphLayer**

Change graph views to:

```ts
{ anchorId: anchor.id, kind: anchor.kind, quality: anchor.quality, rects, text: anchor.text }
```

Use `activeAnchor.text` in the focused state message. Rename `PageGraphAnchorView.label` to `text`, and use `text` in edge accessible names and anchor accessible names.

- [ ] **Step 4: Replace the solid div scrim with a measured SVG mask**

Use React `useId()` to avoid duplicate SVG IDs. The structure should be equivalent to:

```tsx
<svg
  className="association-layer__scrim"
  data-association-blank="true"
  height={documentHeight}
  viewBox={`0 0 ${Math.max(1, frameWidth)} ${Math.max(1, documentHeight)}`}
  width={frameWidth}
>
  <defs>
    <mask id={scrimMaskId}>
      <rect className="association-layer__scrim-base" height="100%" width="100%" />
      {anchors.flatMap((anchor) => anchor.rects.map((rect, index) => (
        <rect
          className="association-layer__scrim-window"
          height={rect.height}
          key={`${anchor.anchorId}:${index}`}
          rx="3"
          width={rect.width}
          x={rect.left}
          y={rect.top}
        />
      )))}
    </mask>
  </defs>
  <rect className="association-layer__scrim-fill" height="100%" mask={`url(#${scrimMaskId})`} width="100%" />
</svg>
```

Keep blank-area click-to-close behavior on the scrim SVG. Ensure nodes, edges, and anchor targets remain above it.

- [ ] **Step 5: Replace label chips with local windows and transparent targets**

Render one `.association-anchor__window` per rectangle. Render one empty button on the first rectangle with the exact-text `aria-label`, `aria-pressed`, and existing focus callback. Do not render `anchor.text` inside the graph overlay; the characters must come from the underlying article.

- [ ] **Step 6: Remove double dimming and style local reveal states**

Remove the `.is-graph-dimmed > article/intuecho { opacity: .3 }` rule. Let the single masked scrim dim the page. Style mask base as opaque, mask windows as partially transparent, and focused/non-focused window outlines without rounded text pills. Keep `letter-spacing: 0` and stable dimensions derived from measured rects.

- [ ] **Step 7: Run the component and browser tests and verify GREEN**

Run:

```bash
cd products/liteasy/apps/desktop
npx vitest run src/tests/thinReadingAssociationGraph.test.tsx
npx playwright test src/tests/browser/thinReading.browser.spec.ts
```

Expected: PASS with no chip, exact-text accessible names, masked windows, mouse focus, Space/Enter
activation, Escape behavior, and narrow-viewport visibility intact.

- [ ] **Step 8: Commit the presentation change if it can be isolated**

```bash
git diff --cached
git commit -m "feat: reveal source text in association graphs"
```

Do not include unrelated pre-existing changes.

---

### Task 3: Make Layout Avoid Every Wrapped Text Rectangle

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/associations/associationGraphLayout.ts:42-60, 208-260, 262-430`
- Modify: `products/liteasy/apps/desktop/src/app/features/associations/AssociationGraphLayer.tsx:188-203`
- Modify: `products/liteasy/apps/desktop/src/tests/associationGraphLayout.test.ts`

**Interfaces:**
- Produces: `PageGraphAnchorInput = { anchorId: string; rects: readonly AnchorRect[] }`.
- Keeps: anchor centre derived from `rects[0]` for edge and fan placement.
- Keeps: every rectangle as a layout obstacle.

- [ ] **Step 1: Write a failing wrapped-anchor obstacle test**

Replace the label-width test with:

```ts
test("never parks a node on any wrapped source-text rectangle", () => {
  const anchor = {
    anchorId: "a1",
    rects: [
      { height: 18, left: 300, top: 400, width: 140 },
      { height: 18, left: 300, top: 426, width: 96 }
    ]
  };
  const graph = layoutAssociationPageGraph(input({
    anchors: [anchor],
    sourcesByAnchor: {
      a1: Array.from({ length: 8 }, (_, index) => source(`W${index}`, 1 - index / 10))
    }
  }));

  for (const node of graph.nodes) {
    for (const rect of anchor.rects) {
      expect(nodeDoesNotOverlapRect(node, rect)).toBe(true);
    }
  }
});
```

Use the test's existing node-size constants and overlap calculation; extract `nodeDoesNotOverlapRect` only inside the test file.

In the browser test, add the same behavior-level assertion before changing layout production code:
for each original `.thin-reading__anchor` client rectangle, assert that no `.association-node`
bounding box overlaps it at desktop and narrow viewports.

- [ ] **Step 2: Run the layout test and verify RED**

Run:

```bash
cd products/liteasy/apps/desktop
npx vitest run src/tests/associationGraphLayout.test.ts
npx playwright test src/tests/browser/thinReading.browser.spec.ts
```

Expected: compile/failure because `PageGraphAnchorInput` still requires `rect` and ignores wrapped
rectangles; the browser assertion exposes any real wrapped-text obstruction.

- [ ] **Step 3: Replace `rect`/`labelWidth` with `rects` in the pure layout API**

Add a helper that fails closed for empty rectangles and use the first rectangle for the centre:

```ts
function primaryAnchorRect(anchor: PageGraphAnchorInput): AnchorRect {
  return anchor.rects[0] ?? { height: 0, left: 0, top: 0, width: 0 };
}
```

Change `anchorObstacles` to map every rectangle:

```ts
function anchorObstacles(anchor: PageGraphAnchorInput): OccupiedBox[] {
  return anchor.rects.map((rect) => ({
    halfHeight: Math.max(rect.height, 22) / 2,
    halfWidth: rect.width / 2,
    left: rect.left + rect.width / 2,
    top: rect.top + rect.height / 2
  }));
}
```

Update all internal `.rect` reads through `primaryAnchorRect`, and pass `rects: anchor.rects` from `AssociationGraphLayer`.

- [ ] **Step 4: Update layout fixtures and run GREEN**

Mechanically change layout-test anchors from `rect: value` to `rects: [value]`; do not alter expected geometry values unless the wrapped-obstacle behavior requires it.

Run:

```bash
cd products/liteasy/apps/desktop
npx vitest run src/tests/associationGraphLayout.test.ts src/tests/thinReadingAssociationGraph.test.tsx
npx playwright test src/tests/browser/thinReading.browser.spec.ts
```

Expected: PASS, including the unit and browser wrapped-text obstacle assertions.

- [ ] **Step 5: Commit the layout contract if it can be isolated**

```bash
git diff --cached
git commit -m "refactor: measure wrapped association anchors"
```

Do not include unrelated pre-existing changes.

---

### Task 4: Browser Verification And Regression Gate

**Files:**
- Modify only when a failing browser assertion identifies a real issue: `products/liteasy/apps/desktop/src/app/styles/app.css`
- Modify only when a failing browser assertion identifies a real issue: `products/liteasy/apps/desktop/src/app/features/associations/AssociationGraphLayer.tsx`
- Modify only if required by compile failures: other label-free `ThinReadingAnchor` fixtures reported by `npx tsc --noEmit`.

**Interfaces:**
- Consumes: `.association-anchor__target`, `.association-anchor__window`, and masked `.association-layer__scrim` from Task 2.
- Verifies: exact source text remains the only visible anchor wording and layout does not cover it.

- [ ] **Step 1: Re-read the browser assertions written before Task 2**

Confirm the focused browser scenario still asserts no label chips, exact-text targets, mask windows,
article opacity `1`, wrapped-anchor/node non-overlap, and narrow-viewport visibility. Do not edit the
test to accommodate implementation output; a remaining failure is evidence for Step 3.

- [ ] **Step 2: Run the focused browser test and inspect the remaining failures**

Run:

```bash
cd products/liteasy/apps/desktop
npx playwright test src/tests/browser/thinReading.browser.spec.ts
```

Expected: the DOM-contract assertions now pass. Any remaining failure must identify a concrete
geometry, visibility, focus, or narrow-viewport defect. If the test passes, no browser-only production
change is needed.

- [ ] **Step 3: Make only browser-evidenced CSS or geometry corrections**

Adjust only the measured issue reported by Playwright, such as scrim mask opacity, z-index, pointer events, or narrow-viewport target bounds. Do not change retrieval, ranking, or document data.

- [ ] **Step 4: Run the browser test to GREEN**

Run:

```bash
cd products/liteasy/apps/desktop
npx playwright test src/tests/browser/thinReading.browser.spec.ts
```

Expected: PASS at the test's desktop and narrow viewport scenarios, with zero anchor/node overlaps.

- [ ] **Step 5: Run the complete affected unit-test set**

Run:

```bash
cd products/liteasy/apps/desktop
npx vitest run \
  src/tests/thinReadingAgent.test.ts \
  src/tests/thinReadingProjection.test.ts \
  src/tests/thinReadingAnchorReferences.test.ts \
  src/tests/thinReadingAnchorQuality.test.ts \
  src/tests/thinReadingAssociationGraph.test.tsx \
  src/tests/associationGraphLayout.test.ts \
  src/tests/generateAssistantAnswer.test.ts
```

Expected: all selected tests pass with no unhandled warnings.

- [ ] **Step 6: Run the full desktop regression suite and build**

Run:

```bash
cd products/liteasy/apps/desktop
npm test
npm run build
```

Expected: both commands exit `0`. Distinguish any pre-existing failure from a regression by rerunning its focused test and comparing against the pre-task worktree evidence.

- [ ] **Step 7: Inspect the final diff against the approved spec**

Run:

```bash
git diff --check
git diff -- products/liteasy/apps/desktop/src/app/features/thin-reading products/liteasy/apps/desktop/src/app/features/associations products/liteasy/apps/desktop/src/tests
```

Confirm every acceptance criterion in the design spec has direct test or browser evidence, and confirm no unrelated `label` field was removed.

- [ ] **Step 8: Commit the verified feature if all task hunks can be isolated**

```bash
git diff --cached
git commit -m "feat: keep source text visible in association graphs"
```

If pre-existing user changes overlap the same hunks and cannot be separated safely, do not create a mixed commit; report the verified working-tree result instead.
