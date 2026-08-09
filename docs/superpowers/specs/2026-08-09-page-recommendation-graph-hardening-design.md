# Page Recommendation Graph Hardening Design

## Context

The page recommendation graph shipped its approved interaction, auditable anchor ranking,
page-wide verified relations, constrained layout, and deterministic ink rendering. Final review
closed the rendered-path and visible/retrieved-set gaps, but exposed one remaining formal API DOI
fallback defect. A broader plan assessment also found that the 24-paper budget, final fallback
semantics, exact geometry ownership, and maximum-density evidence were underspecified.

This hardening pass closes those gaps without changing anchor scoring weights, relation truth
rules, visual semantics, or the existing deterministic layout algorithm.

## Goals

1. Make normalized DOI aliases authoritative for OpenAlex and Semantic Scholar relation queries.
2. Keep a shared 24-paper page budget while selecting papers by anchor coverage and reader value.
3. Ensure the final rendered graph, not only a candidate, has zero hard geometry violations.
4. Make layout evaluation and SVG rendering consume one exact edge-path description.
5. Exercise the maximum 24-paper density in a real browser with a bounded interaction latency.
6. Preserve unrelated concurrent work and keep the dev-cloud abort lifecycle as a separate Minor.

## Non-goals

- Do not change the anchor score weights `0.35 / 0.25 / 0.20 / 0.20`.
- Do not infer paper relations from semantic similarity.
- Do not increase the provider request limit above 24 in this pass.
- Do not redesign the H2 ink-and-wash palette or node cards.
- Do not change dev-cloud inbound disconnect propagation.
- Do not modify or stabilize `ArtifactLibraryPane` in this work.

## 1. Formal Relation Query Identity

`relationInput` remains the formal request validator and alias-union owner. Every retrieval paper
passed to a relation connector carries normalized aliases. Connector query construction treats
those aliases as authoritative and treats the legacy `paper.doi` field as an additional input.

For each paper, Semantic Scholar selects a normalized graph ID when present. Otherwise it selects
the first stable normalized DOI from `[paper.doi, ...paper.aliases]`. OpenAlex continues to query
both graph IDs and DOI aliases. A canonical-DOI-only Crossref paper therefore produces the same
provider query as a paper with an explicit `doi` field.

Contract tests cover these accepted shapes independently:

- DOI only in `canonicalPaperId` / normalized aliases;
- DOI only in the explicit `doi` field;
- OpenAlex graph ID plus DOI alias;
- Semantic Scholar graph ID plus DOI alias;
- an unmappable provider/source identity.

No connector may broaden accepted public request fields or emit an unverified relation.

## 2. Stable 24-paper Value Selection

Alias union always completes before applying the page budget. Projection first constructs every
deduplicated component and its stable primary owner. It then selects at most 24 components in two
deterministic phases:

1. Coverage phase: visit retained anchors by descending anchor-quality score, then document order.
   Select the best still-unselected component for each anchor. A shared component covers every
   anchor in its `anchorIds` set.
2. Fill phase: rank remaining components by primary evidence-basis rank, confidence, relevance,
   primary-anchor quality, and stable paper key. Append until the 24-paper budget is full.

The projection exposes `hiddenPaperCount`, equal to all alias-unioned components minus selected
components. Relation edges are filtered to the selected set. Rendering and relation retrieval keep
using the same projection, so every displayed paper is queried and no hidden paper consumes the
request budget.

The budget remains 24 because Semantic Scholar currently uses bounded per-paper graph requests.
Raising it to 32 requires separate provider-rate and interaction-latency evidence.

## 3. Final Geometry Guarantee

The current deterministic layout remains the baseline and the initial state for constrained
search. Candidate acceptance remains unchanged: all hard violations are zero, weighted crossings
are no worse than baseline, and weighted stress is no worse than baseline.

Final selection is strengthened:

1. Return the accepted full constrained candidate when one exists.
2. Return the exact full baseline only when its hard-violation count is zero.
3. Otherwise build a deterministic coverage input containing the highest-value primary paper for
   each anchor and run the same baseline/candidate pipeline once more.
4. Return an accepted coverage candidate, or its exact baseline when that baseline has zero hard
   violations.
5. If even the coverage graph is physically infeasible, return an anchor-only degraded graph with
   every paper counted as hidden.

`layoutSource` becomes `"baseline" | "constrained" | "degraded"`. Degradation never changes or
relaxes the existing search algorithm. It only controls which already-ranked papers are presented
when no legal full layout exists. The final `quality` must have zero overflow, overlap, anchor
obstruction, same-side, and primary-edge-crossing counts in every return path.

## 4. Shared Exact Edge Geometry

A focused association exact-path module owns the path description used by both geometry and SVG.
It returns the SVG `d` string and a deterministic polyline used for crossing evaluation. The
current primary and paper exact paths remain collinear quadratic paths, so hit geometry does not
visually change. Ink, echo, and wash perturbations continue to derive from the exact path and keep
its endpoints.

Future non-collinear routing must update this module's deterministic flattening; it cannot change
only the renderer and bypass the quality gate.

## 5. Browser Density And Performance Evidence

The browser fixture gains a maximum-density variant with eight anchors and 24 selected paper
components, including a shared paper and verified cross-anchor relations. Desktop, narrow, and
mobile assertions inspect the real SVG/DOM and require:

- final hard geometry `0/0/0/0/0`;
- all primary SVG hit paths have zero non-shared-endpoint crossings;
- every primary fan remains on one side;
- no node or expanded title leaves the graph surface;
- nonblank ink pixels and accessible relation labels;
- the second click exposes the graph within 1,500 ms in the local Playwright environment;
- deterministic search diagnostics remain within their existing fixed budgets.

The 1,500 ms threshold is intentionally generous enough for CI variance while still detecting a
blocked main thread or accidentally unbounded search.

## 6. Verification And Delivery

Each behavior follows red-green-refactor TDD. Verification runs, in order:

1. focused formal connector/service tests;
2. full formal API suite;
3. focused projection/layout/renderer/hook/component suites;
4. full desktop suite;
5. desktop build and production asset verification;
6. maximum-density Playwright checks on desktop, narrow, and mobile;
7. scoped code review with no unresolved Critical or Important findings.

Review severity, not the number of fix waves, controls completion. A remaining Important finding
blocks final completion and enters another narrowly scoped TDD correction.
