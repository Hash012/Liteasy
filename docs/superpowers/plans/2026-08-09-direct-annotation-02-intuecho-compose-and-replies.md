# Intuecho Literature Compose and Reply Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw literature identity fields with search/confirm UX and make reply-derived annotations explicit, linked, and lifecycle-consistent.

**Architecture:** The Web app consumes the Phase 1 resolver through a focused target editor. Replies are canonical content records; an optional derived annotation is a projection linked by `sourceReplyId`, created only through `publishAsAnnotation`. Repository transactions enforce visibility, body synchronization, retraction, deletion, and moderation rules.

**Tech Stack:** React 18, TypeScript 5.7, Fluent UI 9, Vitest, Testing Library, Fastify, SQLite, PostgreSQL

## Global Constraints

- Phase 1 must be complete before this plan starts.
- Use `@fluentui/react-components` and `@fluentui/react-icons`; do not add another icon library.
- Default replies remain thread-only and need no literature target.
- A derived annotation is created only when `publishAsAnnotation` is true and at least one target exists.
- Derived visibility inherits the parent and can never be broader.
- Reply body is the single source of truth; a derived annotation body is not independently editable.
- User retraction of the derived annotation keeps the reply; deleting the reply retracts the derived annotation.
- Content moderation of a derived annotation hides the linked reply and writes append-only audit data.
- Do not expose raw identity fields until resolver status is `not_found` and the user chooses manual entry.

---

## File Map

- `products/intuecho/packages/contracts/src/index.js`: explicit reply publication and publication-update schemas.
- `products/intuecho/services/api/migrations/015_reply_projection_lifecycle.sql`: linked moderation and reply projection state.
- `products/intuecho/services/api/src/annotationCommunitySqlite.mjs`: development reply canonicalization and projection transactions.
- `products/intuecho/services/api/src/postgresAnnotationCommunityRepository.mjs`: production reply canonicalization and projection transactions.
- `products/intuecho/services/api/src/annotationCommunityRoutes.mjs`: reply delete and publication update routes.
- `products/intuecho/apps/web/src/LiteratureTargetEditor.tsx`: search, candidates, selected records, and manual fallback.
- `products/intuecho/apps/web/src/ReplyPublicationFields.tsx`: inherited targets and explicit independent-publication toggle.
- `products/intuecho/apps/web/src/AnnotationComposer.tsx`: extracted create/edit/reply form orchestration.
- `products/intuecho/apps/web/src/AnnotationApp.tsx`: page composition only; no embedded target-editor implementation.
- `products/intuecho/apps/web/src/communityApi.ts`: resolver and reply lifecycle client methods.
- `products/intuecho/apps/web/src/community.types.ts`: canonical literature and reply projection types.
- `products/intuecho/apps/web/src/annotation-app.css`: compact search result, target, and reply status styling.

### Task 1: Explicit Reply Projection Contract and Migration

**Files:**
- Modify: `products/intuecho/packages/contracts/src/index.js`
- Create: `products/intuecho/services/api/migrations/015_reply_projection_lifecycle.sql`
- Modify: `products/intuecho/services/api/src/migrations.test.mjs`
- Modify: `products/intuecho/services/api/src/literatureContracts.test.mjs`

**Interfaces:**
- Produces: `createReplySchema` with `publishAsAnnotation`, `updateReplySchema`, `updateReplyPublicationSchema`.
- Database adds reply moderation fields and an optional linked reply ID to annotation moderation audit.
- Consumes canonical `annotationTargetSchema` from Phase 1.

- [ ] **Step 1: Write failing schema and migration tests**

```js
test("creates a pure reply without literature targets", () => {
  assert.equal(createReplySchema.safeParse({
    body: "Thread-only response",
    publishAsAnnotation: false,
    tags: [],
    targets: []
  }).success, true);
});

test("requires targets only for an independent annotation", () => {
  assert.equal(createReplySchema.safeParse({
    body: "Independent response",
    publishAsAnnotation: true,
    tags: [],
    targets: []
  }).success, false);
});
```

Run migration `015` in the migration harness and inspect the resulting schema rather than matching SQL source text. Assert `moderated_at` and `linked_reply_id` exist, existing rows remain active, and the linked audit relation plus append-only behavior work through real inserts and rejected update/delete attempts.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `cd products/intuecho && node --test services/api/src/literatureContracts.test.mjs services/api/src/migrations.test.mjs`

Expected: FAIL because `publishAsAnnotation` and migration `015` are absent.

- [ ] **Step 3: Add explicit schemas and immutable migration**

```js
export const createReplySchema = z.object({
  body: z.string().trim().min(1).max(8000),
  publishAsAnnotation: z.boolean().default(false),
  tags: annotationTagsSchema,
  targets: z.array(annotationTargetSchema).max(100).default([])
}).superRefine((value, context) => {
  if (value.publishAsAnnotation && value.targets.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["targets"], message: "独立批注必须关联文献。" });
  }
  if (!value.publishAsAnnotation && value.targets.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["targets"], message: "普通回复不保存独立批注目标。" });
  }
});

export const updateReplyPublicationSchema = z.discriminatedUnion("published", [
  z.object({ published: z.literal(false) }),
  z.object({
    published: z.literal(true),
    tags: annotationTagsSchema,
    targets: z.array(annotationTargetSchema).min(1).max(100)
  })
]);
```

Migration `015` adds `moderated_at`, `moderation_reason`, and `moderated_by` to `annotation_replies`; adds `linked_reply_id` to `annotation_moderation_audit`; and updates the audit reference trigger to accept the linked reply while remaining append-only. Existing rows remain active.

- [ ] **Step 4: Run schema and migration tests**

Run: `cd products/intuecho && node --test services/api/src/literatureContracts.test.mjs services/api/src/migrations.test.mjs`

Expected: PASS and migration count is 15.

- [ ] **Step 5: Commit contract and migration**

```bash
git add products/intuecho/packages/contracts/src/index.js products/intuecho/services/api/migrations/015_reply_projection_lifecycle.sql products/intuecho/services/api/src/migrations.test.mjs products/intuecho/services/api/src/literatureContracts.test.mjs
git commit -m "feat: define reply projection lifecycle"
```

### Task 2: Transactional Reply and Derived Annotation Behavior

**Files:**
- Modify: `products/intuecho/services/api/src/annotationCommunitySqlite.mjs`
- Modify: `products/intuecho/services/api/src/postgresAnnotationCommunityRepository.mjs`
- Modify: `products/intuecho/services/api/src/annotationCommunityRoutes.mjs`
- Modify: `products/intuecho/services/api/src/server.test.mjs`
- Modify: `products/intuecho/services/api/scripts/verify-postgres-integration.mjs`

**Interfaces:**
- Repository methods: `createReply(parentId, author, input)`, `updateReply(replyId, author, input)`, `updateReplyPublication(replyId, author, input)`, `deleteReply(replyId, author)`.
- Routes: `PUT /v1/replies/:replyId/publication`, `DELETE /v1/replies/:replyId`.
- Reply projection: `{ derivedAnnotationId, derivedAnnotationState: "none" | "published" | "withdrawn", ... }`.

- [ ] **Step 1: Add failing lifecycle tests**

Cover all approved rules in both route-level SQLite tests and PostgreSQL integration:

```js
const pure = await repository.createReply(parent.id, author, {
  body: "Only in the thread", publishAsAnnotation: false, tags: [], targets: []
});
assert.equal(pure.annotation, null);

const projected = await repository.createReply(parent.id, author, {
  body: "Also an annotation", publishAsAnnotation: true, tags: ["evidence"], targets: parent.targets
});
assert.equal(projected.annotation.visibility, parent.visibility);
assert.equal(projected.annotation.shareToPlaza, parent.visibility === "public");
```

Also assert: body edits update both rows including author snapshot and revision; direct derived-body updates return `DERIVED_BODY_READ_ONLY`; retracting the projection keeps the reply; deleting the reply retracts the projection; parent deletion leaves the projection with `originalReply.status = "parent_deleted"`; moderation withdraw/restore hides/restores the linked reply. Exercise public, organization, mutual-follower, and private parents to prove the projection never broadens visibility and only public projections enter the plaza. Rate, save, and reply to a projection and assert those counters do not change the source reply or parent thread statistics.

- [ ] **Step 2: Run repository tests and verify current implicit behavior fails**

Run: `cd products/intuecho && node --test services/api/src/server.test.mjs`

Expected: FAIL because targets still implicitly create a derived annotation and lifecycle routes are missing.

- [ ] **Step 3: Implement canonical reply transactions**

Use `input.publishAsAnnotation` as the only creation condition:

```js
const derivedAnnotationId = input.publishAsAnnotation ? `annotation_${randomUUID()}` : null;
const derivedVisibility = parent.visibility;
const shareToPlaza = derivedVisibility === "public";
```

Within the same transaction, create the reply first, create the projection when requested, replace its targets/tags, then link `derived_annotation_id`. `updateReply` snapshots both records before changing their shared body. `updateReplyPublication` can create a missing projection, restore a withdrawn projection, or withdraw the projection without deleting the reply. `deleteReply` marks the reply deleted and withdraws its projection.

In `updateAnnotation`, reject `body` changes when `source_reply_id` is present. In platform moderation, lock the source reply and set/clear moderation fields in the same transaction as the annotation and append `linked_reply_id` to the audit row.

- [ ] **Step 4: Run API and PostgreSQL verification**

Run: `cd products/intuecho && npm test`

Run: `cd products/intuecho/services/api && npm run test:postgres:integration`

Expected: PASS with identical SQLite and PostgreSQL behavior.

- [ ] **Step 5: Commit repository lifecycle**

```bash
git add products/intuecho/services/api/src/annotationCommunitySqlite.mjs products/intuecho/services/api/src/postgresAnnotationCommunityRepository.mjs products/intuecho/services/api/src/annotationCommunityRoutes.mjs products/intuecho/services/api/src/server.test.mjs products/intuecho/services/api/scripts/verify-postgres-integration.mjs
git commit -m "feat: link replies to derived annotations"
```

### Task 3: Web Test Harness and Typed Clients

**Files:**
- Modify: `products/intuecho/apps/web/package.json`
- Modify: `products/intuecho/package.json`
- Modify: `products/intuecho/package-lock.json`
- Create: `products/intuecho/apps/web/vitest.config.ts`
- Create: `products/intuecho/apps/web/src/testSetup.ts`
- Modify: `products/intuecho/apps/web/src/community.types.ts`
- Modify: `products/intuecho/apps/web/src/communityApi.ts`
- Create: `products/intuecho/apps/web/src/communityApi.test.ts`

**Interfaces:**
- Client methods: `resolveLiterature(input)`, `confirmLiterature(input)`, `updateReplyPublication(replyId, input)`, `deleteReply(replyId)`.
- Canonical types `LiteratureRecord`, `LiteratureCandidate`, `LiteratureResolveResult`, and `LiteratureConfirmInput` are imported from `@intuecho/contracts`; `community.types.ts` keeps only Web-specific projections.

- [ ] **Step 1: Add the failing API client test**

```ts
test("resolves and confirms literature through authenticated endpoints", async () => {
  fetchMock
    .mockResolvedValueOnce(ok({ status: "ambiguous", candidates: [candidate] }))
    .mockResolvedValueOnce(ok({ literature: confirmed }));
  await communityApi.resolveLiterature({ purpose: "forum_compose", query: "A Paper" });
  await communityApi.confirmLiterature({ candidateKey: candidate.candidateKey, mode: "candidate" });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    expect.stringContaining("/v1/literature:resolve"),
    expect.stringContaining("/v1/literature:confirm")
  ]);
});
```

- [ ] **Step 2: Install the declared test dependencies and verify the test fails**

Add `@intuecho/contracts` as a Web dependency; add `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, and `@testing-library/jest-dom` as Web dev dependencies; add Web script `"test": "vitest run"`. Change the Intuecho root `test` script to run API tests followed by Web tests.

Run: `cd products/intuecho && npm install`

Run: `cd products/intuecho && npm run test --workspace=@intuecho/web`

Expected: FAIL because client methods are missing.

- [ ] **Step 3: Add typed clients and test setup**

```ts
resolveLiterature: (body: LiteratureResolveInput) =>
  request<LiteratureResolveResult>("/v1/literature:resolve", {
    body: JSON.stringify(body), method: "POST"
  }, true),
confirmLiterature: (body: LiteratureConfirmInput) =>
  request<{ literature: LiteratureRecord }>("/v1/literature:confirm", {
    body: JSON.stringify(body), method: "POST"
  }, true),
updateReplyPublication: (id: string, body: ReplyPublicationInput) =>
  request(`/v1/replies/${encodeURIComponent(id)}/publication`, {
    body: JSON.stringify(body), method: "PUT"
  }, true)
```

Configure jsdom, `testSetup.ts`, and fetch/session cleanup after each test. Keep public error messages from the API; do not expose endpoints in UI error strings.

- [ ] **Step 4: Run Web API tests and TypeScript build**

Run: `cd products/intuecho && npm run test --workspace=@intuecho/web`

Run: `cd products/intuecho && npm run build --workspace=@intuecho/web`

Expected: PASS.

- [ ] **Step 5: Commit Web test foundation and clients**

```bash
git add products/intuecho/apps/web/package.json products/intuecho/package.json products/intuecho/package-lock.json products/intuecho/apps/web/vitest.config.ts products/intuecho/apps/web/src/testSetup.ts products/intuecho/apps/web/src/community.types.ts products/intuecho/apps/web/src/communityApi.ts products/intuecho/apps/web/src/communityApi.test.ts
git commit -m "test: add intuecho web component harness"
```

### Task 4: Search-First Literature Target Editor

**Files:**
- Create: `products/intuecho/apps/web/src/LiteratureTargetEditor.tsx`
- Create: `products/intuecho/apps/web/src/LiteratureTargetEditor.test.tsx`
- Modify: `products/intuecho/apps/web/src/AnnotationApp.tsx`
- Modify: `products/intuecho/apps/web/src/annotation-app.css`

**Interfaces:**
- Component props: `{ onChange(targets: AnnotationTarget[]): void; required: boolean; targets: AnnotationTarget[] }`.
- Uses `communityApi.resolveLiterature` and `communityApi.confirmLiterature`.
- Emits write targets whose literature reference is exactly `{ literatureId }`; canonical display metadata remains client state or an API-hydrated read model, and manual source remains `manual` on that server record.

- [ ] **Step 1: Write failing interaction tests**

Test title, DOI, arXiv, Semantic Scholar, and OpenAlex input; loading; exact auto-confirm; ambiguous selection; unavailable retry; not-found manual fallback; manual minimum rules; selected-target removal; multiple selected literature records; and source-passage page/excerpt fields.

```tsx
await user.type(screen.getByRole("combobox", { name: "检索关联文献" }), "10.1000/test");
await user.click(screen.getByRole("button", { name: "检索" }));
expect(await screen.findByText("A Reliable Paper")).toBeVisible();
expect(screen.queryByLabelText("身份类型")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the component test and verify the component is absent**

Run: `cd products/intuecho && npm run test --workspace=@intuecho/web -- LiteratureTargetEditor.test.tsx`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Build the compact resolver-driven editor**

Use Fluent `Input`, `Button`, `Spinner`, `RadioGroup` or list buttons, `Textarea`, and icons. Debounce only after three characters for title search; exact identifier submission may run immediately. Render raw identifier fields only inside the manual fallback section after `not_found`.

```tsx
<Input
  aria-label="检索关联文献"
  contentBefore={<Search20Regular />}
  onChange={(_, data) => setQuery(data.value)}
  value={query}
/>
```

An `unavailable` response shows retry and does not offer manual fallback as if no record existed. Confirmation replaces the candidate with the server-returned canonical record. Use stable dimensions so loading and result rows do not shift the drawer width.

- [ ] **Step 4: Run editor tests and Web build**

Run: `cd products/intuecho && npm run test --workspace=@intuecho/web -- LiteratureTargetEditor.test.tsx`

Run: `cd products/intuecho && npm run build --workspace=@intuecho/web`

Expected: PASS; no raw identity fields appear before manual fallback.

- [ ] **Step 5: Commit target editor**

```bash
git add products/intuecho/apps/web/src/LiteratureTargetEditor.tsx products/intuecho/apps/web/src/LiteratureTargetEditor.test.tsx products/intuecho/apps/web/src/AnnotationApp.tsx products/intuecho/apps/web/src/annotation-app.css
git commit -m "feat: search literature when composing annotations"
```

### Task 5: Reply Publication UX and Canonical Editing

**Files:**
- Create: `products/intuecho/apps/web/src/ReplyPublicationFields.tsx`
- Create: `products/intuecho/apps/web/src/AnnotationComposer.tsx`
- Create: `products/intuecho/apps/web/src/AnnotationComposer.test.tsx`
- Modify: `products/intuecho/apps/web/src/AnnotationApp.tsx`
- Modify: `products/intuecho/apps/web/src/annotation-app.css`
- Modify: `products/intuecho/scripts/development-desktop-forum-e2e.mjs`

**Interfaces:**
- `AnnotationComposer` consumes existing `ComposerState` and callbacks.
- Reply submission sends `{ body, publishAsAnnotation, tags, targets }`.
- Reply cards expose projection state and open the canonical reply editor for body changes.

- [ ] **Step 1: Write failing composer and reply-card tests**

```tsx
render(<AnnotationComposer context={{ replyTo: publicParent }} onClose={vi.fn()} onSaved={onSaved} />);
expect(screen.getByRole("checkbox", { name: "同时发布为独立批注" })).not.toBeChecked();
expect(screen.queryByText("关联文献")).not.toBeInTheDocument();
await user.click(screen.getByRole("checkbox", { name: "同时发布为独立批注" }));
expect(screen.getByText(publicParent.targets[0].literature.title)).toBeVisible();
```

Assert public parent submission publishes to plaza, organization/mutual-follower/private parent submission keeps the inherited scope, target clearing disables only independent publication, editing a derived annotation redirects to reply editing, and retracting the projection retains the reply card. Simulate a retraction failure and assert the reply still reports the independent annotation as published with “撤回失败，独立批注仍公开”. Assert the parent thread renders the reply once with one projection link, while the derived card has independent rating/save/reply controls.

- [ ] **Step 2: Run composer tests and verify current monolith fails expectations**

Run: `cd products/intuecho && npm run test --workspace=@intuecho/web -- AnnotationComposer.test.tsx`

Expected: FAIL because current reply defaults to plaza publication and always renders the old target form.

- [ ] **Step 3: Extract composer and implement explicit reply publication**

Initialize reply state as:

```ts
const [publishAsAnnotation, setPublishAsAnnotation] = useState(false);
const [targets, setTargets] = useState<AnnotationTarget[]>([]);
function enableReplyPublication() {
  setPublishAsAnnotation(true);
  setTargets(parent?.targets.map(cloneTarget) ?? []);
}
```

When the checkbox is disabled, clear publication targets and submit a pure reply. Keep visibility inherited and non-editable. Provide projection commands on the reply card: view, stop independent publication, and restore independent publication. Keep the last confirmed projection state when a command fails and show the remote-truth failure copy. Body edits always call `updateReply`, never `updateAnnotation` for a source-reply annotation.

Add context copy on derived cards (“回复了某条批注”) and keep only one reply rendering in the parent thread. Show `originalReply.status = "parent_deleted"` as the fixed deleted-context message.

- [ ] **Step 4: Run Web tests, full Intuecho tests, build, and E2E**

Run: `cd products/intuecho && npm run test --workspace=@intuecho/web`

Run: `cd products/intuecho && npm test`

Run: `cd products/intuecho && npm run build`

Run: `cd products/intuecho && node scripts/development-desktop-forum-e2e.mjs`

Expected: PASS; E2E proves pure reply, derived reply with inherited literature, edit synchronization, projection retraction, and parent deletion placeholder.

- [ ] **Step 5: Commit reply UX**

```bash
git add products/intuecho/apps/web/src/ReplyPublicationFields.tsx products/intuecho/apps/web/src/AnnotationComposer.tsx products/intuecho/apps/web/src/AnnotationComposer.test.tsx products/intuecho/apps/web/src/AnnotationApp.tsx products/intuecho/apps/web/src/annotation-app.css products/intuecho/scripts/development-desktop-forum-e2e.mjs
git commit -m "feat: publish replies as linked annotations"
```

## Phase 2 Completion Gate

- New annotations use search/confirm and expose manual fields only after a real not-found result.
- Pure replies create no annotation and need no target.
- `publishAsAnnotation` inherits targets and never broadens visibility.
- Reply body changes update the projection; direct derived-body edits are rejected.
- Projection retraction keeps the reply; reply deletion retracts the projection; moderation hides both surfaces.
- Web component tests, API tests, production build, PostgreSQL integration, and forum E2E pass.
