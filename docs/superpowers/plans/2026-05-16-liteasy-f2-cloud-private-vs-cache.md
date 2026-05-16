# Liteasy F2 Cloud-Private Data and Recommendation Cache Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `收藏` and `关联推荐` into two explicit end-to-end cloud resource paths, with durable user-private collection data and separately persisted recommendation cache data.

**Architecture:** This milestone keeps the existing user-facing library entry names, but rewires the internals into two distinct modules: `collection` remains durable user cloud-private data, while `recommendation-cache` becomes a separate cloud cache path. On the dev-cloud side, add a small JSON-file-backed persistence layer with isolated repositories so collection, recommendation generation, and cache storage do not collapse back into one mixed module.

**Tech Stack:** React, TypeScript, Vitest, Node.js, existing `services/dev-cloud` route split, JSON file persistence under `services/dev-cloud/.liteasy-data`

---

## File Responsibilities

### Desktop

- `desktop/src/app/features/collection/useCollectionItems.ts`
  - cloud-only collection loading/saving state
- `desktop/src/app/features/collection/collectionClient.ts`
  - collection HTTP client only
- `desktop/src/app/features/collection/collectionRuntime.ts`
  - collection runtime wrapper only
- `desktop/src/app/features/collection/collectionStorage.ts`
  - removed from the main collection path
- `desktop/src/app/features/recommendations/recommendationClient.ts`
  - recommendation generation client only
- `desktop/src/app/features/recommendations/recommendationRuntime.ts`
  - recommendation generation runtime only
- `desktop/src/app/features/recommendations/recommendationCache.types.ts`
  - cache key / cache payload types
- `desktop/src/app/features/recommendations/recommendationCacheClient.ts`
  - recommendation-cache HTTP client only
- `desktop/src/app/features/recommendations/recommendationCacheRuntime.ts`
  - recommendation-cache runtime only
- `desktop/src/app/features/recommendations/useRecommendations.ts`
  - orchestrates cache get -> generate -> cache put -> clear
- `desktop/src/tests/useCollectionItems.test.ts`
  - collection cloud-only behavior
- `desktop/src/tests/recommendationClient.test.ts`
  - recommendation generation client
- `desktop/src/tests/recommendationCacheClient.test.ts`
  - recommendation-cache client
- `desktop/src/tests/useRecommendations.test.ts`
  - cache orchestration behavior
- `desktop/src/tests/AppShell.test.tsx`
  - end-to-end collection restore and recommendation-cache reuse

### Dev-cloud

- `services/dev-cloud/db/jsonFileStore.mjs`
  - generic JSON file persistence
- `services/dev-cloud/db/collectionRepository.mjs`
  - durable collection repository
- `services/dev-cloud/db/recommendationCacheRepository.mjs`
  - recommendation-cache repository
- `services/dev-cloud/payloads/collectionPayloads.mjs`
  - collection payload builders using collection repository
- `services/dev-cloud/payloads/recommendationPayloads.mjs`
  - recommendation generation payloads only
- `services/dev-cloud/payloads/recommendationCachePayloads.mjs`
  - recommendation-cache payload builders using cache repository
- `services/dev-cloud/requestHandler.mjs`
  - route wiring for collection and recommendation-cache endpoints
- `services/dev-cloud/server.test.mjs`
  - end-to-end route tests

### Docs

- `docs/qa/phase2-test-guide.md`
- `docs/qa/phase2-known-limitations.md`
- `docs/qa/final-demo-handoff.md`

## Task 1: Remove Local Collection Recovery from the Main Desktop Path

**Files:**
- Modify: `desktop/src/tests/useCollectionItems.test.ts`
- Modify: `desktop/src/app/features/collection/useCollectionItems.ts`
- Modify: `desktop/src/app/features/collection/collectionStorage.ts`

- [ ] **Step 1: Rewrite the failing collection tests so cloud is the only source of truth**

Replace the local-storage restore expectation with explicit cloud-only expectations:

```ts
test("does not restore collection items from local browser storage while logged out", () => {
  window.localStorage.setItem(
    "liteasy.collection.online.v1",
    JSON.stringify([
      {
        id: "paper-1",
        reason: "RAG baseline",
        savedAt: "2026-05-14T00:00:00.000Z",
        source: "semantic-scholar",
        title: "Retrieval-Augmented Generation"
      }
    ])
  );

  const { result } = renderHook(() => useCollectionItems());

  expect(result.current.collectionItems).toEqual([]);
  expect(result.current.message).toBe("登录后可用的云端收藏会显示在这里。");
});
```

Keep and update the cloud-session test so it still expects `list` and `save` transport calls and cloud-backed restored items.

- [ ] **Step 2: Run the collection hook test to verify it fails**

Run:

```bash
cd desktop && npm test -- src/tests/useCollectionItems.test.ts
```

Expected: FAIL because `useCollectionItems` still restores from local storage.

- [ ] **Step 3: Remove local collection restore from `useCollectionItems`**

Implementation requirements:

- initial `collectionItems` state becomes `[]`
- logged-out mode must not load from local storage
- logged-in mode must load from cloud only
- `collectRecommendation` must keep cloud save behavior when logged in
- `collectRecommendation` may keep temporary in-memory state when logged out, but must not persist through local browser storage

Use this shape:

```ts
const [collectionItems, setCollectionItems] = useState<CollectionItem[]>([]);
```

and remove `loadStoredCollectionItems()` / `storeCollectionItems()` from the main behavior path.

- [ ] **Step 4: Run the collection hook test to verify it passes**

Run:

```bash
cd desktop && npm test -- src/tests/useCollectionItems.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit the cloud-only collection behavior**

```bash
git add desktop/src/app/features/collection/useCollectionItems.ts desktop/src/app/features/collection/collectionStorage.ts desktop/src/tests/useCollectionItems.test.ts
git commit -m "feat: remove local collection recovery from desktop flow"
```

## Task 2: Introduce Recommendation Cache Client and Runtime Boundaries

**Files:**
- Create: `desktop/src/app/features/recommendations/recommendationCache.types.ts`
- Create: `desktop/src/app/features/recommendations/recommendationCacheClient.ts`
- Create: `desktop/src/app/features/recommendations/recommendationCacheRuntime.ts`
- Create: `desktop/src/tests/recommendationCacheClient.test.ts`
- Modify: `desktop/src/app/features/recommendations/recommendationRuntime.ts`
- Modify: `desktop/src/tests/recommendationClient.test.ts`

- [ ] **Step 1: Write the failing recommendation-cache client tests**

Create:

```ts
import { createRecommendationCacheClient } from "../app/features/recommendations/recommendationCacheClient";

test("posts a scoped cache lookup to the recommendation-cache get endpoint", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const client = createRecommendationCacheClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      requests.push({ body: request.body, url: request.url });
      return {
        json: async () => ({
          cacheHit: false,
          recommendations: []
        }),
        ok: true,
        status: 200
      };
    }
  });

  const result = await client.get({
    selectionKey: "demo-2",
    sessionId: "demo-session-1",
    sortMode: "relevance",
    workspaceKey: "local:/tmp/LiteasyLibrary"
  });

  expect(result.cacheHit).toBe(false);
  expect(requests[0].url).toBe(
    "https://liteasy.example.com/control-plane/v1/recommendation-cache/get"
  );
});
```

Add equivalent tests for `put` and `clear`.

- [ ] **Step 2: Run the recommendation-cache client tests to verify failure**

Run:

```bash
cd desktop && npm test -- src/tests/recommendationCacheClient.test.ts
```

Expected: FAIL because the cache client files do not exist yet.

- [ ] **Step 3: Add the recommendation-cache types, client, and runtime**

Define minimal types:

```ts
export type RecommendationCacheScope = {
  selectionKey: string;
  sessionId: string;
  sortMode: "relevance" | "retrieved_at";
  workspaceKey: string;
};

export type RecommendationCacheLookupResult = {
  cacheHit: boolean;
  recommendations: RecommendationItem[];
};
```

Client responsibilities:

- `get(scope)`
- `put(scope, recommendations)`
- `clear(scope)`

Runtime responsibilities:

- short helper wrappers around the client
- no in-memory cache ownership

Also update `recommendationRuntime.ts` comments/behavior so it is clearly only the recommendation-generation path.

- [ ] **Step 4: Run the new cache client test and the existing recommendation client test**

Run:

```bash
cd desktop && npm test -- src/tests/recommendationCacheClient.test.ts src/tests/recommendationClient.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit the cache client/runtime boundary**

```bash
git add desktop/src/app/features/recommendations/recommendationCache.types.ts desktop/src/app/features/recommendations/recommendationCacheClient.ts desktop/src/app/features/recommendations/recommendationCacheRuntime.ts desktop/src/app/features/recommendations/recommendationRuntime.ts desktop/src/tests/recommendationCacheClient.test.ts desktop/src/tests/recommendationClient.test.ts
git commit -m "feat: add recommendation cache client and runtime boundaries"
```

## Task 3: Rebuild `useRecommendations` Around Cloud Cache Semantics

**Files:**
- Modify: `desktop/src/app/features/recommendations/useRecommendations.ts`
- Modify: `desktop/src/tests/useRecommendations.test.ts`

- [ ] **Step 1: Write failing cache orchestration tests**

Add tests that express the new contract:

```ts
test("loads cached recommendations before generating new ones", async () => {
  const cacheGet = vi.fn(async () => ({
    cacheHit: true,
    recommendations: [
      {
        discoveredAt: "2026-05-14T08:15:00Z",
        id: "rec-bert-1",
        relatedDocumentTitle: "BERT",
        relevanceBand: "high",
        relevanceScore: 0.92,
        reason: "cached",
        source: "Semantic Scholar",
        title: "RoBERTa"
      }
    ]
  }));
  const recommendationFetch = vi.fn();

  const { result } = renderHook(() =>
    useRecommendations({
      accountSession,
      controlPlaneEndpoint: "https://liteasy.example.com/control-plane",
      recommendationCacheDeps: {
        clear: vi.fn(),
        get: cacheGet,
        put: vi.fn()
      },
      recommendationGeneratorDeps: {
        fetch: recommendationFetch
      },
      recommendationsEnabled: true,
      recommendationSortMode: "relevance",
      selectedPapers,
      workspaceRevision: 0,
      workspaceSourceKey: "local:/tmp/LiteasyLibrary"
    })
  );

  await waitFor(() => {
    expect(result.current.recommendationStatus).toBe("ready");
  });

  expect(recommendationFetch).not.toHaveBeenCalled();
  expect(result.current.recommendationMessage).toBe("已显示当前选中文献集的缓存推荐。");
});
```

Add companion tests for:

- cache miss -> generate -> put
- clear cache does not affect collection-related messages

- [ ] **Step 2: Run the recommendation hook tests to verify they fail**

Run:

```bash
cd desktop && npm test -- src/tests/useRecommendations.test.ts
```

Expected: FAIL because the hook still uses a frontend-only `Map`.

- [ ] **Step 3: Replace the in-memory `Map` with cache runtime orchestration**

Implementation requirements:

- remove `useRef(new Map())` as the real cache source
- compute a stable scope key from:
  - `sessionId`
  - workspace key
  - sorted selected paper ids
  - sort mode
- on logged-in recommendation path:
  1. call cache get
  2. if hit, show cached message and return
  3. if miss, call generation runtime
  4. call cache put
- clear button must call cache clear, not just clear local state

Add a new input field to the hook:

```ts
workspaceSourceKey: string;
```

and pass it from the app shell later.

- [ ] **Step 4: Run the recommendation hook tests to verify green**

Run:

```bash
cd desktop && npm test -- src/tests/useRecommendations.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit the cloud-cache recommendation flow**

```bash
git add desktop/src/app/features/recommendations/useRecommendations.ts desktop/src/tests/useRecommendations.test.ts
git commit -m "feat: route recommendations through cloud cache semantics"
```

## Task 4: Add a Simple JSON Database and Repositories in Dev-Cloud

**Files:**
- Create: `services/dev-cloud/db/jsonFileStore.mjs`
- Create: `services/dev-cloud/db/collectionRepository.mjs`
- Create: `services/dev-cloud/db/recommendationCacheRepository.mjs`
- Modify: `services/dev-cloud/payloads/collectionPayloads.mjs`
- Create: `services/dev-cloud/payloads/recommendationCachePayloads.mjs`
- Modify: `services/dev-cloud/payloads/recommendationPayloads.mjs`
- Modify: `services/dev-cloud/requestHandler.mjs`
- Modify: `services/dev-cloud/server.test.mjs`

- [ ] **Step 1: Write failing server tests for recommendation-cache endpoints**

Add tests like:

```js
test("stores and reads recommendation cache separately from collection data", async () => {
  const handler = createDevCloudRequestHandler();

  const putResponse = await invokeHandler({
    body: JSON.stringify({
      recommendations: [
        {
          discoveredAt: "2026-05-14T08:15:00Z",
          id: "rec-bert-1",
          relatedDocumentTitle: "BERT",
          relevanceBand: "high",
          relevanceScore: 0.92,
          reason: "cached",
          source: "Semantic Scholar",
          title: "RoBERTa"
        }
      ],
      selectionKey: "demo-2",
      sessionId: "demo-session-1",
      sortMode: "relevance",
      workspaceKey: "local:/tmp/LiteasyLibrary"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/recommendation-cache/put"
  });

  assert.equal(putResponse.statusCode, 200);

  const getResponse = await invokeHandler({
    body: JSON.stringify({
      selectionKey: "demo-2",
      sessionId: "demo-session-1",
      sortMode: "relevance",
      workspaceKey: "local:/tmp/LiteasyLibrary"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/recommendation-cache/get"
  });

  assert.equal(getResponse.json.cacheHit, true);
  assert.equal(getResponse.json.recommendations.length, 1);
});
```

Add a second test verifying `collection/list` still returns collection and is unaffected by `recommendation-cache/clear`.

- [ ] **Step 2: Run the server tests to verify failure**

Run:

```bash
node --test services/dev-cloud/server.test.mjs
```

Expected: FAIL because cache endpoints and repositories do not exist yet.

- [ ] **Step 3: Add the JSON store and two repositories**

Implementation requirements:

- `jsonFileStore.mjs`
  - data dir defaults to `services/dev-cloud/.liteasy-data`
  - override via `LITEASY_DEV_CLOUD_DATA_DIR`
  - one file reader/writer utility
- `collectionRepository.mjs`
  - list by `sessionId`
  - save/upsert by `sessionId`
- `recommendationCacheRepository.mjs`
  - get by full scope key
  - put by full scope key
  - clear by full scope key

Payload rules:

- `collectionPayloads.mjs` may depend on collection repository only
- `recommendationCachePayloads.mjs` may depend on recommendation cache repository only
- `recommendationPayloads.mjs` must remain generation-only

- [ ] **Step 4: Wire the new endpoints into `requestHandler.mjs`**

Add:

- `POST /v1/recommendation-cache/get`
- `POST /v1/recommendation-cache/put`
- `POST /v1/recommendation-cache/clear`

Keep:

- `POST /v1/recommendations` as generation-only
- existing collection endpoints intact

- [ ] **Step 5: Re-run the server tests**

Run:

```bash
node --test services/dev-cloud/server.test.mjs services/dev-cloud/providers/openaiResponses.test.mjs
```

Expected: PASS

- [ ] **Step 6: Commit the dev-cloud persistence split**

```bash
git add services/dev-cloud/db services/dev-cloud/payloads services/dev-cloud/requestHandler.mjs services/dev-cloud/server.test.mjs
git commit -m "feat: add dev-cloud collection and recommendation cache persistence"
```

## Task 5: Connect AppShell to the New Collection and Cache Semantics

**Files:**
- Modify: `desktop/src/app/layout/AppShell.tsx`
- Modify: `desktop/src/tests/AppShell.test.tsx`
- Modify: `desktop/src/tests/LeftPane.test.tsx`

- [ ] **Step 1: Write failing AppShell expectations for cloud-only collection restore**

Update the collection restore integration test so it no longer depends on local browser restoration semantics. Instead, the second render must get restored items through the mocked cloud collection list path.

Add or update a cache-reuse test so it expects:

- cache get on second equivalent selection
- no second recommendation generation request
- clearing recommendation cache leaves collection intact

- [ ] **Step 2: Run the focused AppShell tests to verify failure**

Run:

```bash
cd desktop && npm test -- src/tests/AppShell.test.tsx -t "drags a recommendation into local collection and restores it on next render|reuses cached recommendations until a collected paper is added to the library"
```

Expected: FAIL because current restore/cache behavior still reflects the old boundary.

- [ ] **Step 3: Pass workspace source key into `useRecommendations` and keep collection cloud-only**

Implementation requirements:

- pass a stable workspace source key from `AppShell`
- use local-library root path or organization shared workspace key
- ensure rerender/restart collection restoration comes from cloud mocks
- ensure recommendation-cache clear only affects recommendation items

- [ ] **Step 4: Run the focused AppShell tests**

Run:

```bash
cd desktop && npm test -- src/tests/AppShell.test.tsx -t "drags a recommendation into local collection and restores it on next render|reuses cached recommendations until a collected paper is added to the library"
```

Expected: PASS

- [ ] **Step 5: Commit the integration-layer changes**

```bash
git add desktop/src/app/layout/AppShell.tsx desktop/src/tests/AppShell.test.tsx desktop/src/tests/LeftPane.test.tsx
git commit -m "feat: connect desktop collection and recommendation cache boundaries"
```

## Task 6: Update QA and Product-Facing Docs

**Files:**
- Modify: `docs/qa/phase2-test-guide.md`
- Modify: `docs/qa/phase2-known-limitations.md`
- Modify: `docs/qa/final-demo-handoff.md`

- [ ] **Step 1: Update the docs to match F2 semantics**

Required wording changes:

- remove claims that collection is restored from local state
- clarify that `收藏` is user cloud-private long-term data
- clarify that `关联推荐` is cache
- clarify that clearing recommendation cache does not affect collection

- [ ] **Step 2: Verify the docs mention the new boundary**

Run:

```bash
rg -n "云端收藏|推荐缓存|清理缓存|不影响收藏|本地恢复" docs/qa/phase2-test-guide.md docs/qa/phase2-known-limitations.md docs/qa/final-demo-handoff.md
```

Expected: matches for the new cloud-private and cache wording, and removal or replacement of the old local-restore framing.

- [ ] **Step 3: Commit the docs**

```bash
git add docs/qa/phase2-test-guide.md docs/qa/phase2-known-limitations.md docs/qa/final-demo-handoff.md
git commit -m "docs: align Liteasy QA docs with cloud collection and cache split"
```

## Final Verification

- [ ] **Step 1: Run desktop tests**

```bash
cd desktop && npm test
```

Expected: PASS

- [ ] **Step 2: Run desktop build**

```bash
cd desktop && npm run build
```

Expected: PASS

- [ ] **Step 3: Run dev-cloud tests**

```bash
node --test services/dev-cloud/server.test.mjs services/dev-cloud/providers/openaiResponses.test.mjs
```

Expected: PASS

- [ ] **Step 4: Verify the implementation matches the spec boundary**

Manual checklist:

- `collection` modules do not own recommendation-cache logic
- recommendation cache is not stored only in frontend memory
- no local browser storage restore remains in the main collection path
- dev-cloud persistence is split into `jsonFileStore`, `collectionRepository`, and `recommendationCacheRepository`
- clearing recommendation cache does not clear collection
