# Association Recommendation Marketing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a dynamic marketing section that presents Liteasy's association recommendation UI as a reversible path from concept anchors to related papers and back to reading.

**Architecture:** Insert one semantic section between Thin Reading multimodal presentation and Intuecho. Reuse the existing accessible tab controller pattern with a dedicated `associationData` map and one preview panel; each tab describes a UI state of the same recommendation experience.

**Tech Stack:** Static HTML, vanilla JavaScript, CSS, Node test runner, Playwright browser verification.

## Global Constraints

- Show user-visible interaction and outcomes only.
- Do not present association recommendation as a separate product from Thin Reading.
- Keep the path reversible: concept anchor, focused associations, paper card, and return state.
- Preserve Liteasy's existing visual language, keyboard behavior, responsive layout, and one conversion goal.

### Task 1: Add Failing Marketing Contract Tests

**Files:** `products/marketing/tests/marketingPage.test.mjs`, `products/marketing/tests/verifyMarketingBrowser.mjs`

- [ ] Assert the `associations` section marker and title.
- [ ] Assert four association UI states and `associationData` keys.
- [ ] Increase total tab count to include the four new tabs.
- [ ] Add browser assertions for association tab keyboard navigation.

### Task 2: Implement Section and Dynamic Association Preview

**Files:** `products/marketing/index.html`, `products/marketing/app.js`

- [ ] Insert the section after `results` and before `intuecho`.
- [ ] Add tabs `标出概念`, `聚焦关联`, `打开文献`, and `逐层返回`.
- [ ] Render a distinct UI preview for each state with concept anchors, muted context, linked paper nodes, reading card, and return controls.
- [ ] Keep every state framed as one association recommendation interaction.

### Task 3: Style and Verify

**Files:** `products/marketing/styles.css`

- [ ] Add stable desktop/mobile preview dimensions and interaction-state styles.
- [ ] Run marketing tests, syntax checks, diff checks, and browser verification.
- [ ] Scan public copy for retired module or development language.
- [ ] Commit only the focused marketing changes and plan.
