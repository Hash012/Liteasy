# Root fix 2026-10-15 delivery

Baseline: `0bbc0b69920c96bea0491c13cafecbe1b38eba28` (desktop 0.1.56).
Input: `Liteasy_Root_Fix_20261015.zip`, SHA256 `e7c0d375ff166f191b3abd82440f2dc1e0e05a77cb0edb7f94d69a26f62b864c`.
Isolated branch: `codex/root-fix-20261015`. Existing changes in the user's main workspace are preserved.

## Baseline and scope

Pack validation: 38 hashes, 4 supplied screenshots, 27 source locations, 64 acceptance cases and 7 work packages verified. The pack's reference tests are not product acceptance tests. Local environment: Linux, Node 22.23.2. No access to the affected Windows user's library or display settings; original-library and physical DPI checks remain NOT_RUN until separately evidenced.

| Findings | Reproduction / regression boundary | Baseline evidence |
| --- | --- | --- |
| F01 | workspace board → reference service → preview | Board read returns JSON Canvas; preview reconstructs markdown |
| F02–F03 | Notes controller with shared objects / placements | Automatic rows flatten boards and members; single-title membership map |
| F04 | native annotation loader → notes presentation | Title copied from markdown first line |
| F05–F06 | actual useObjectWorkbenchController composition | Missing native annotation registration; zero/ambiguous routes conflated |
| F07 | Notes toolbar / shared primitives | Mixed input and option-picker density |
| F08 | inventory projection | Asset counts are distinct from processing readiness |
| F09 | workspace drop → import scheduling | Import eagerly queues full extraction |
| F10 | reader raster / text / optional glyph stages | Native text does not require heavy extraction; optional geometry can delay text |
| F11 | library associated items | Three extraction views occupy default list |
| F12–F14 | recommendation disclosure / refresh | Repeated title, explanation is not curation, migration provenance per card |
| F15–F16 | coordinator CAS / ranking / UI | Feedback lifetime tied to feed, imprecise undo and inconsistent ranking |
| F17 | research enhancer evidence stat | Replaces revision while retaining previously captured text |

## Stages

0. Add privacy-preserving route diagnostics and production composition characterization.
1. Typed presentation in the existing registry, native annotation routing, preserved content bindings.
2. Board-centric Notes projection, AST-derived titles, shared toolbar density.
3. Lazy PDF processing, independent reader stages, immutable extraction references.
4. Durable idempotent feedback and unified ranking projection.
5. Explicit bounded AI curation with frozen and validated evidence.
6. Cross-surface verification and delivery evidence.

Each stage is a separate reversible commit. No migration deletes original objects, placements, edges, annotations, or old extraction anchors. Validation, remaining limitations, and rollback evidence are recorded below as work completes; pending stages are not claimed as delivered.
