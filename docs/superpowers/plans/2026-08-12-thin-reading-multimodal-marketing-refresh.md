# Thin Reading Multimodal Marketing Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reframe the marketing page's dynamic results section as one Liteasy Thin Reading capability that showcases its evidence-bound multimodal generation and source-figure placement.

**Architecture:** Preserve the existing semantic section, left-side dynamic tabs, and single right-side preview panel. Replace the retired parallel product-result copy with six Thin Reading presentation modes backed by a single `resultData` map and the existing keyboard-accessible tab controller.

**Tech Stack:** Static HTML, vanilla JavaScript, CSS, Node test runner.

## Global Constraints

- Public copy must describe user-facing outcomes only.
- Do not present relationship graphs, comparison tables, reports, or documents as parallel top-level modules.
- Do not mention roadmap phases, providers, models, readiness, or implementation details.
- Multimodal examples must stay bounded by the current product capabilities: source figures, structural diagrams, scientific diagrams, math/geometry, process demonstrations, and evidence-bound illustrations.

### Task 1: Update Marketing Content Contract

**Files:**
- Modify: `products/marketing/index.html`
- Modify: `products/marketing/app.js`
- Test: `products/marketing/tests/marketingPage.test.mjs`

- [ ] Replace the results intro copy with Thin Reading's adaptive multimodal promise.
- [ ] Replace result tabs with `论文原图`, `结构表达`, `科学图解`, `数学与几何`, `过程演示`, and `视觉重绘`.
- [ ] Replace each result data entry and preview with copy that describes an internal Thin Reading presentation mode.
- [ ] Remove retired graph/table/document result labels and data keys.
- [ ] Update tests to assert the six approved modes and reject the retired parallel-module labels.

### Task 2: Tune Multimodal Previews and Responsive Styling

**Files:**
- Modify: `products/marketing/styles.css`

- [ ] Add stable preview styles for source-figure placement, structural nodes, scientific diagram labels, math/geometry controls, process timeline, and evidence-bound illustration.
- [ ] Remove or leave unused only styles that no longer serve the results section; do not alter unrelated page sections.
- [ ] Keep keyboard/mobile tab behavior and prevent horizontal overflow.

### Task 3: Verify and Commit

**Files:**
- Modify: `products/marketing/README.md` only if the public section description is stale.

- [ ] Run `npm test` in `products/marketing`.
- [ ] Run `node --check products/marketing/app.js`.
- [ ] Run `git diff --check -- products/marketing`.
- [ ] Review rendered copy for retired labels and development language.
- [ ] Commit the focused marketing update with an imperative `feat:` subject.
