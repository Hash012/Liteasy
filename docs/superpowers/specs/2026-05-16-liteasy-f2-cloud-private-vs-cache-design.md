# Liteasy F2 Cloud-Private Data and Recommendation Cache Separation Design

## 1. Purpose

This document defines the first formal `F2` milestone for Liteasy:

- keep the existing user-facing library entry names `收藏` and `关联推荐`
- formally separate them in product language, code boundaries, and dev-cloud persistence
- remove local collection recovery from the main product path
- introduce a simple persistent demo-cloud database using JSON files

This design builds on the current `F1` resource-boundary work and follows the SaaS roadmap rule:

- `收藏` is durable user cloud-private data
- `关联推荐` is cloud cache, not a long-term asset

## 2. Current State

Current repository behavior is still mixed:

- `desktop/src/app/features/collection/` already has a cloud collection client/runtime path, but `useCollectionItems` still loads and stores collection items through local browser storage.
- `desktop/src/app/features/recommendations/` still treats recommendation cache as a frontend-only in-memory `Map` inside `useRecommendations`.
- `services/dev-cloud/` already exposes:
  - `POST /v1/collection/list`
  - `POST /v1/collection/items`
  - `POST /v1/recommendations`
- the dev-cloud server does not yet persist collection and recommendation cache as separate cloud resource classes backed by a simple database boundary.

Because of that, the product language and the code language do not yet match:

- product language says `收藏` is cloud-private long-term data
- product language says recommendation results are cache
- code still lets collection recovery behave like local state
- code still keeps recommendation cache only in frontend memory

## 3. Goal

`F2` must deliver an end-to-end split between:

1. user cloud-private long-term favorites (`收藏`)
2. short-lived cloud recommendation cache (`关联推荐`)

The milestone is successful only if:

- desktop no longer restores collection items from local browser storage
- dev-cloud persists collection items separately from recommendation cache
- recommendation cache is read, written, and cleared through explicit cache endpoints
- clearing recommendation cache does not affect collection data
- dragging a recommendation into `收藏` upgrades that item into durable user cloud-private data

## 4. Scope

### In scope

- desktop collection path cleanup
- desktop recommendation-cache formalization
- dev-cloud JSON-file persistence layer
- separate repositories for collection and recommendation cache
- separate recommendation-cache endpoints
- tests and QA docs updated to match the new boundary

### Out of scope

- no collection removal UI
- no cache TTL or background cleanup policy
- no organization-level recommendation cache
- no production database
- no UI entry renaming
- no new billing or permission model

## 5. Product Boundary

### 5.1 收藏

User-facing label remains `收藏`.

Product meaning:

- durable user cloud-private data
- survives restarts because it is loaded from cloud-side storage
- not equivalent to local workspace papers
- not cleared when recommendation cache is cleared

Behavior:

- when logged in, collection is loaded from cloud
- when not logged in, collection stays visible but unavailable
- dragging a recommendation into `收藏` writes durable user cloud-private data
- local browser storage no longer acts as the source of truth

### 5.2 关联推荐

User-facing label remains `关联推荐`.

Product meaning:

- cloud cache
- derived, short-lived, replaceable
- not a durable user asset
- may be explicitly cleared without affecting collection

Behavior:

- recommendation display is scoped by current workspace, selected document set, and sort mode
- cache hit shows cached recommendations
- cache miss triggers recommendation generation and then cache write-back
- explicit clear removes only the current cache scope

### 5.3 我的文献库

No change in entry name or broad role.

Behavior clarification:

- dragging an item from `收藏` or `关联推荐` into `我的文献库` adds it to the current local workspace view
- this does not delete collection
- this does not clear recommendation cache

## 6. Architecture

## 6.1 Desktop Layers

### Collection module

`desktop/src/app/features/collection/` remains the user-cloud-private favorites domain.

Responsibilities:

- list collection from cloud
- save collection item to cloud
- expose loading/error/retry UI state

Non-responsibilities:

- no local persistence as the source of truth
- no recommendation cache ownership

### Recommendation module

`desktop/src/app/features/recommendations/` becomes the recommendation generation plus recommendation-cache orchestration domain.

Responsibilities:

- compute the cache scope key
- query cloud recommendation cache
- generate recommendations on cache miss
- write generated recommendations back to cache
- clear recommendation cache for the current scope

Non-responsibilities:

- no collection persistence
- no local in-memory cache as the real cache boundary

### Library UI

`desktop/src/app/features/library/LibraryPane.tsx` keeps the current user-facing section names and drag behavior.

The UI still presents:

- `我的文献库`
- `收藏`
- `关联推荐`

But the data sources become explicit:

- `收藏` uses collection domain state
- `关联推荐` uses recommendation-cache backed state

## 6.2 Dev-Cloud Layers

`services/dev-cloud/` must separate:

- HTTP routing
- payload building
- persistence adapters
- resource repositories

New persistence split:

- `services/dev-cloud/db/jsonFileStore.mjs`
- `services/dev-cloud/db/collectionRepository.mjs`
- `services/dev-cloud/db/recommendationCacheRepository.mjs`

Existing route/payload split stays aligned with the D2 structure.

## 7. Simple Database Design

## 7.1 Storage Strategy

Use a simple JSON-file-backed demo database.

Default directory:

- `services/dev-cloud/.liteasy-data/`

Override via environment:

- `LITEASY_DEV_CLOUD_DATA_DIR`

The persistence layer must create the directory on first run.

## 7.2 Files

- `collections.json`
- `recommendation-cache.json`

These files are deliberately separated so favorites and cache do not collapse back into one generic blob.

## 7.3 Store Layer

`jsonFileStore.mjs` responsibilities:

- ensure data directory exists
- read JSON file
- initialize empty file state if missing
- perform full-file write-back
- keep serialization details out of repositories

It must not know collection semantics or recommendation-cache semantics.

## 7.4 Repository Layer

### collectionRepository.mjs

Responsibilities:

- list collection by `sessionId`
- save or upsert a collection item by `sessionId`
- preserve ordering with most-recently-saved item first

### recommendationCacheRepository.mjs

Responsibilities:

- get cached recommendations by cache key
- put cached recommendations by cache key
- clear cached recommendations by cache key

The repository owns cache indexing, not the route layer.

## 8. Data Model

## 8.1 Collection

Collection item shape stays close to the current client contract:

- `id`
- `title`
- `source`
- `reason`
- `savedAt`

Persistence grouping:

- top level by `sessionId`

Conceptually:

```json
{
  "demo-session-1": [
    {
      "id": "rec-bert-1",
      "title": "RoBERTa: A Robustly Optimized BERT Pretraining Approach",
      "source": "Semantic Scholar",
      "reason": "同样关注大规模预训练语言模型的迁移能力。",
      "savedAt": "2026-05-14T10:30:00.000Z"
    }
  ]
}
```

## 8.2 Recommendation Cache

Cache entry shape:

- `sessionId`
- `workspaceKey`
- `selectionKey`
- `sortMode`
- `recommendations`
- `cachedAt`

### Cache key components

At minimum:

- `sessionId`
- current workspace root or equivalent workspace source key
- sorted selected document ids
- recommendation sort mode

This avoids mixing:

- different users
- different workspaces
- different selected sets
- different sort orders

## 9. API Design

## 9.1 Keep Existing Collection Endpoints

Keep:

- `POST /v1/collection/list`
- `POST /v1/collection/items`

Their meaning becomes stricter:

- collection only
- no local fallback semantics

## 9.2 Narrow Existing Recommendation Endpoint

Keep:

- `POST /v1/recommendations`

But redefine its responsibility:

- generate recommendation results
- do not implicitly stand in for the cache layer

## 9.3 Add Recommendation Cache Endpoints

Add:

- `POST /v1/recommendation-cache/get`
- `POST /v1/recommendation-cache/put`
- `POST /v1/recommendation-cache/clear`

### get

Input:

- `sessionId`
- `workspaceKey`
- `selectionKey`
- `sortMode`

Output:

- cache hit flag
- cached recommendation items

### put

Input:

- `sessionId`
- `workspaceKey`
- `selectionKey`
- `sortMode`
- `recommendations`

Output:

- stored cache metadata

### clear

Input:

- `sessionId`
- `workspaceKey`
- `selectionKey`
- `sortMode`

Output:

- cleared status

## 10. Desktop Data Flow

## 10.1 Collection

### Logged in

1. `useCollectionItems` loads collection from cloud
2. response populates `收藏`
3. dragging recommendation into `收藏` saves to cloud
4. refresh/restart reloads from cloud

### Logged out

1. no cloud list request
2. no local collection restore
3. `收藏` remains visible but unavailable

## 10.2 Recommendation Cache

When recommendation preconditions are met:

1. build current cache scope key
2. call `recommendation-cache/get`
3. if hit:
   - show cached items
   - message indicates cached recommendations are shown
4. if miss:
   - call `/v1/recommendations`
   - show generated items
   - call `recommendation-cache/put`

When user clicks clear:

1. call `recommendation-cache/clear`
2. clear only current recommendation scope
3. do not touch collection

## 11. Error Handling

## 11.1 Collection Failures

Collection is long-term user data, so failure is a hard failure.

Rules:

- do not silently fall back to local browser storage
- surface error state and retry affordance
- preserve empty/unavailable distinction clearly

## 11.2 Recommendation Cache Failures

Cache failures are soft failures.

Rules:

- cache get failure should not prevent recommendation generation
- cache put failure should not block recommendation display
- cache clear failure should surface a clear error message but not affect collection

## 11.3 Recommendation Generation Failures

Recommendation generation failure is the real recommendation failure state.

Rules:

- empty collection is unrelated
- collection must remain intact
- clear cache must remain independent

## 12. Testing Strategy

## 12.1 Collection Tests

Update tests so that:

- local collection restore is removed from expected behavior
- logged-out state does not restore old browser-stored collection
- logged-in state loads only from cloud
- saving a recommendation into collection persists through cloud mock state across rerender/restart

## 12.2 Recommendation Cache Tests

Add tests for:

- cache get before generation
- generation on cache miss
- cache write after generation
- cache reuse under same workspace + selected set + sort mode
- cache invalidation on scope change
- cache clear without affecting collection

## 12.3 AppShell Tests

Keep the current user-visible chain intact:

- drag recommendation into collection
- rerender / restart and restore collection from cloud-side mock state
- recommendation cache reuse on repeated selection
- clearing cache does not clear collection

## 12.4 Dev-Cloud Tests

Add tests for:

- collection repository persistence
- recommendation cache repository persistence
- new recommendation-cache endpoints
- separation guarantee: clearing cache leaves collection intact

## 13. Documentation Updates

Update QA and product-facing docs so they no longer claim:

- collection is locally restored
- recommendation cache is only a frontend cache

Update wording to reflect:

- `收藏` is cloud-private long-term data
- `关联推荐` is cache
- clearing recommendation cache does not affect collection

## 14. Implementation Boundaries

This milestone must stay modular.

Required separation:

- collection code must not own recommendation cache logic
- recommendation cache code must not own collection persistence
- route handlers must not own JSON-file persistence details
- repositories must not own HTTP formatting
- JSON file store must not own domain rules

If a file starts combining:

- endpoint routing
- persistence
- collection semantics
- cache semantics

then the design is being violated.

## 15. Recommended Execution Order

1. add JSON store and repositories in `services/dev-cloud/db/`
2. add recommendation-cache endpoints and tests
3. remove local collection restore from desktop collection path
4. add recommendation-cache client/runtime path on desktop
5. update AppShell and integration tests
6. update QA docs
