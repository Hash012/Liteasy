# Semantic Graph Skill

Produce only a `semantic_graph` typed spec matching `liteasy.visualization/v1`.

- Use `subtype` for `flowchart`, `mindmap`, `causal_graph`, or `timeline`.
- Bind every factual node and edge to at least one claim in `claims`.
- Use `kind: "layout"` only for non-factual organization edges.
- Do not emit SVG, HTML, scripts, stylesheets, external URLs, or renderer instructions.
- Prefer `source_figure` fallback when evidence is insufficient.
