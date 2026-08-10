# Thin-Reading Anchor Text Design

## Summary

Thin-reading association graphs currently replace each marked source phrase with a model-generated
`label` chip. This creates a visible wording change at the moment the reader opens the graph, even
though the underlying article has not changed. Remove `label` from the thin-reading anchor contract
and keep the exact source `text` visible in place through a translucent, locally measured highlight.

This change applies only to `ThinReadingAnchor.label`. Labels used by omitted sections, navigation,
paper types, recommendations, and unrelated features remain unchanged.

## Goals

- Preserve the exact marked prose when the association graph opens.
- Remove `label` from newly generated, parsed, projected, and persisted thin-reading anchors.
- Use `text` for visible state copy, accessible names, edge descriptions, and hover descriptions.
- Make anchor identity independent of a generated display name.
- Keep existing source retrieval, ranking, citation attribution, paper relations, and graph nodes
  unchanged.
- Continue reading historical artifacts that contain an anchor `label`, while discarding that field
  at the model-output and document-projection boundaries.

## Non-Goals

- Removing `label` fields from omitted sections or other product concepts.
- Changing how `searchQuery` retrieves related literature.
- Changing document relevance, confidence, relation types, or graph-node ranking.
- Rewriting historical artifacts in bulk.
- Adding a second generated name to replace `label`.

## Data Contract

`ThinReadingAnchor` will retain:

- `id`
- `summarySentenceId`
- `start` and `end`
- exact `text`
- `kind`
- `importance`
- `searchQuery`
- evidence, source, and optional quality fields

It will no longer contain `label`.

The model Zod schema, provider JSON Schema, repair instructions, and output example will no longer
request or accept `label` as part of the current anchor contract. Before strict validation, a narrow
legacy adapter will remove `label` only from objects inside `anchors`; it will not make the schema
generally permissive. The document projection boundary will likewise copy known anchor fields
explicitly so a legacy runtime object cannot carry `label` into a newly projected document.

New anchor IDs will be derived from `summarySentenceId`, `start`, and `end`. A label-only change can
therefore no longer create a new identity. Existing persisted IDs remain authoritative when an old
document is loaded; no bulk ID migration is required.

## Graph Presentation

Opening the association graph will no longer render an `association-anchor__chip`. Every measured
rectangle returned for the original marked phrase will instead receive a translucent anchor overlay.
This includes wrapped phrases, so the highlight follows the actual local line boxes rather than a
synthetic label width.

The underlying article remains in place. The current combination of article opacity and a solid
scrim will be replaced by one graph scrim so the prose is not dimmed twice. The scrim will use the
measured anchor rectangles as translucent windows: the surrounding article recedes, while the exact
characters beneath each anchor remain legible. This must not duplicate the text in the overlay.

The scrim will be rendered as a masked SVG or an equivalent structured mask, because the number,
position, and wrapping of anchor rectangles are dynamic. Its blank area retains the current
click-to-close behavior. Each anchor will use a transparent interactive target on its first measured
rectangle and non-interactive continuation marks for additional rectangles. Focus, click, and
keyboard activation retain their current behavior.

Focused anchors use a stronger border/background treatment. Non-focused anchors dim when another
anchor is selected. No visible concept name is introduced by the graph layer.

The graph layout will stop accepting or estimating `labelWidth`. Anchor obstacles will be based on
the measured source-text rectangles. Paper nodes must continue to avoid those occupied rectangles.

## Text Usage

All thin-reading association-graph consumers that currently read `anchor.label` will read
`anchor.text` instead, including:

- the focused-concept state message;
- accessible anchor names;
- concept-to-paper edge descriptions;
- hover or focus descriptions;
- test selectors and fixture-derived text.

`searchQuery` remains the only anchor-authored query sent to external literature retrieval. Removing
`label` must not change retrieval requests.

## Compatibility And Error Handling

Historical model output containing `anchors[].label` is accepted only through the targeted legacy
adapter and produces anchors without that field. Unknown properties other than the retired anchor
label remain validation errors.

Historical documents with existing anchor IDs keep those IDs and associated `externalSourceIds`.
When such documents pass through projection, the obsolete label is omitted. Invalid anchor ranges,
missing sentence references, and duplicate ranges retain their current rejection or drop behavior.

## Testing

Development follows test-driven development.

1. Model-contract tests first demonstrate that output without anchor labels parses and projects, and
   that a legacy label is discarded rather than persisted.
2. Identity tests demonstrate that a new anchor ID depends on sentence and range, not a generated
   label.
3. component tests demonstrate that the graph contains no label chip, exposes `text` through its
   accessible name, and preserves anchor focus behavior.
4. Layout tests demonstrate that paper nodes avoid the measured source-text obstacle without a
   `labelWidth` input.
5. Browser tests demonstrate that wrapped source text remains visible through local translucent
   highlights at desktop and narrow viewports, with no node/text overlap.
6. The affected desktop test suite and production build run before completion is claimed.

## Acceptance Criteria

- New thin-reading anchors contain no `label` field.
- Opening the relationship graph never replaces marked prose with another phrase.
- The original anchor text remains readable in its original position and wrapping.
- Mouse and keyboard users can still focus and toggle anchors.
- Accessible names and relation descriptions use exact anchor `text`.
- Related-paper retrieval and persisted source associations continue to work.
- Existing artifacts containing anchor labels still open, and later projections omit the retired
  field.
