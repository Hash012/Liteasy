# Thin Reading Modal Design

## Summary

Add a new "薄读" modality to LiteasyClaw. It appears from the existing floating "模态" launcher and opens as a first-class center artifact tab. The first implementation focuses on the thin-reading tab itself: a polished, full-page reading surface with one central explanation paragraph, omitted-section tokens, recursive deep-reading navigation, and an Intuecho recommendation margin. Existing workbench layout, PDF reader, dock behavior, side panels, and artifact history mechanics stay in place except for necessary visual integration.

The approved visual baseline is the full-page v6 direction from the brainstorming companion: no nested mockup frame, no separate card inside the page, and no isolated annotation panel.

## Goals

- Add "薄读" as a selectable modality in `FloatingModalityButton`.
- Generate/open a thin-reading artifact tab in the center artifact system.
- Render a dedicated `ThinReadingTab` page instead of the generic artifact card layout.
- Present the initial page as a whole-paper overview: one high-signal paragraph, visually centered.
- Use system target language for generated prose. Default is Chinese. Key academic terms remain in original form, optionally with a Chinese meaning in parentheses.
- Provide omitted-section tokens below the paragraph. These tokens represent paper sections not covered by the current thin-reading page, not finer entries for covered content.
- Support text-selection driven "深入" for content already covered in the paragraph.
- Support recursive pages inside the same tab: parent navigation, generated-child navigation, and branch selection when multiple child pages exist.
- Keep Intuecho recommendations visually integrated as page-margin intuition notes and synchronized with the current page scope.

## Non-Goals

- Do not implement the full Intuecho community service.
- Do not implement public annotation upload in this change.
- Do not redesign the whole workbench, PDF reader, dock framework, left rail, or right assistant panel.
- Do not create a marketing or onboarding page.
- Do not expose unexplained model metrics such as "local closure 0.18". Closure state only appears when the reader reaches the paper-boundary depth.

## User Experience

### Entry

The floating modality launcher gains a "薄读" option. Selecting it uses the same preconditions as other literature modalities: a selected and locked document set is required, and missing imports are queued before generation. Once ready, the result opens as a center artifact tab titled "薄读".

### Initial Page

The first page is the whole-paper overview. It contains:

- A top bar with title, source paper title, target language chip, and left/right depth navigation.
- A breadcrumb row such as `总述 · 第 0 层`.
- A single central paragraph in a formal Chinese reading font. The paragraph should avoid template phrases such as "这篇论文真正留下的是". It should directly state the paper's core retained insight.
- Key terms rendered in original language, for example `ColBERT`, `MaxSim`, `late interaction`, `dense retrieval`.
- Omitted-section tokens below the paragraph, separated by natural vertical whitespace rather than a divider line. The spacing should be dynamic, using a responsive margin range so tokens sit beneath the paragraph rather than pinned to the bottom edge.
- An Intuecho margin integrated into the same full-page surface, not a separate panel card.

### Omitted-Section Tokens

The token row only shows sections the current page did not cover. Examples: `实验`, `消融`, `数据集`, `局限`, `索引代价`.

Clicking a token generates or opens a child thin-reading page for that section. Tokens are not used for content already present in the current paragraph.

### Text Selection

When the user selects words or sentences inside the main paragraph, a small floating affordance appears near the selection:

- Optional prompt input.
- "深入" action.

Submitting it generates or opens a child page for the selected range. The mapping between generated text and source paper text is represented in data, even if the first UI only uses it to scope generation and recommendations.

### Depth Navigation

Every thin-reading page belongs to a node in a tree:

- The initial overview is the root.
- Token-driven pages and selection-driven pages are children of the current page.
- A child page replaces the current page inside the same tab; no new tab is created.

The top-right left arrow returns to the parent page. On the root page it is disabled or hidden.

The right arrow navigates to already generated child pages:

- If there is one child, click enters it directly.
- If there are multiple children, hover, focus, or click opens a compact branch menu.
- The branch menu lists child title, source type (`正文选区` or `遗漏板块`), recommendation count, and generated time or current marker.

When the active page changes, the main paragraph, omitted-section tokens, breadcrumb, closure state, and Intuecho recommendation scope update together.

### Closure Boundary

As depth increases, the system may reach a page where further explanation mainly depends on knowledge outside the target paper. At that point the page background or a subtle state band changes to indicate "paper boundary reached". This state is qualitative and should not expose raw unexplained numeric scores.

### Intuecho Margin

The recommendation area is a page-margin layer in the same visual surface:

- It uses a compact `Intuecho` heading and an intuition-like mark, currently `∿`.
- Recommendations show compatibility, author or relationship context, and short note text.
- It can collapse into the intuition mark along the right edge.
- For root overview, recommendations scope to the whole paper.
- For selection- or token-driven pages, recommendations scope to the selected text, mapped passage, or omitted section.

Until the community backend exists, the UI receives deterministic local demo recommendations through an adapter-shaped interface.

## Data Model

Add a thin-reading artifact type and a dedicated document payload.

```ts
// Extend the existing ArtifactType union with:
// "thin_reading"

type ThinReadingDocument = {
  artifactId: string;
  paperIds: string[];
  title: string;
  targetLanguage: string;
  activeNodeId: string;
  nodes: Record<string, ThinReadingNode>;
  rootNodeId: string;
  version: "liteasy.thin-reading/v1";
};

type ThinReadingNode = {
  childIds: string[];
  createdAt: string;
  depth: number;
  id: string;
  omittedSections: ThinReadingSectionToken[];
  parentId?: string;
  recommendationScope: ThinReadingRecommendationScope;
  source: ThinReadingNodeSource;
  summary: string;
  title: string;
  withinPaperClosure: boolean;
};
```

`ThinReadingNodeSource` distinguishes root overview, omitted-section token, and selected-text generation. `ThinReadingRecommendationScope` records whole-paper scope, section scope, or selected passage mapping. The exact source text mapping can start as lightweight IDs and excerpts; the shape must allow future precise sentence or paragraph alignment.

## Architecture

Add a feature folder under `LiteasyClaw/desktop/src/app/features/thin-reading/`.

Primary units:

- `ThinReadingTab.tsx`: renders the full-page UI.
- `thinReading.types.ts`: document, node, token, and recommendation types.
- `thinReadingFixtures.ts`: deterministic initial/demo document and recommendations.
- `thinReadingProjection.ts`: helper functions for parent/child navigation, node creation, and active scope projection.

Integrate with existing artifacts:

- Add `"thin_reading"` to `ArtifactType`.
- Add "薄读" to `FloatingModalityButton`.
- Let `ArtifactTabs` detect `activeTab.type === "thin_reading"` and render `ThinReadingTab` directly instead of the generic artifact card.
- Keep existing artifact store, dock dynamic tabs, activation, close, and catalog behavior.

Controller integration can initially create a deterministic thin-reading artifact from imported selected papers, using existing artifact workflow hooks. If full model generation is not ready in this iteration, the public UI and state shape should still match the future generated form.

## Visual Rules

- The thin-reading tab occupies the whole tab content area. Do not nest it inside a decorative preview frame.
- Avoid cards inside cards. The main content and Intuecho margin share one full-page surface.
- Use restrained modern colors: warm paper surface, muted workbench background, blue/green accents, small bronze/rose variation for tokens.
- Body paragraph uses a formal Chinese serif stack. Key English academic terms use the existing sans-serif stack.
- Omitted-section tokens use pill controls, but the text is only section names or concise noun phrases.
- Controls must remain responsive and not overlap text on narrow widths. On narrow layouts, the Intuecho margin can collapse.

## Error And Empty States

- No locked selection: reuse the existing modality disabled state and hint.
- Import pending: reuse current artifact task progress messaging.
- Thin-reading generation failure: reuse artifact task failure diagnostics.
- No Intuecho backend: show deterministic local recommendations and make the adapter boundary explicit in code.
- No child pages: right arrow is disabled or inactive.
- Root page: left arrow is disabled or hidden.

## Testing

Add focused tests:

- Floating modality launcher renders and invokes `"thin_reading"`.
- Artifact type supports thin-reading task and tab creation.
- `ArtifactTabs` renders `ThinReadingTab` without generic artifact card chrome for thin-reading tabs.
- Thin-reading root page renders summary, omitted-section tokens, and Intuecho margin.
- Omitted-section token creates or opens a child node.
- Text-selection deep action creates or opens a child node with selection source.
- Left arrow returns to parent.
- Right arrow opens direct child when one exists and shows branch menu when multiple children exist.
- Recommendation scope changes when active node changes.

Run affected Vitest tests and `npm run build` for desktop changes.
