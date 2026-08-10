# Literature Identity Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** 修复 HelioX 文献身份识别，并建立共享身份规范/provider 能力、隔离身份确认/外部检索/推荐策略的最小实现。

**Architecture:** 本轮不新增跨产品运行时公共 npm 包。以明确的身份/provider 规范和跨实现 conformance fixtures 作为共享底座，Desktop、Liteasy API、Intuecho 保持本地实现和独立数据库/凭据边界。身份确认只接受稳定标识精确唯一或完整题录唯一匹配；外部检索和推荐继续使用各自的证据、召回和排序策略，不能直接合并身份。

**Tech Stack:** TypeScript/Vitest (Desktop), Node.js ESM/node:test (Liteasy API, Intuecho), Zod contracts, JSON conformance fixtures, SHA-256.

## Global Constraints

- 保留当前 `main` 工作区已有未提交修改；不 reset、checkout、覆盖无关文件，不提交或暂存。
- Liteasy、Intuecho 数据库、服务边界、服务端密钥必须独立。
- PDF 第一页正文和 `contentHash` 不得进入文献身份请求；`contentHash` 只用于本地文件去重。
- Provider API key 只能由对应服务端环境读取，不进入 Desktop、浏览器、响应、日志或测试快照。
- PMLR 没有可靠官方机器目录时只产生结构化提示并保留人工确认，不伪造自动 provider 成功。
- 所有变更文件运行 `git diff --check`。

### Task 1: Shared Identity Contract And Fixtures

**Files:**
- Create: `docs/engineering/literature-identity-and-provider-contract.md`
- Create: `development/test-data/literature-identity/conformance.json`
- Create: `products/liteasy/apps/desktop/src/tests/literatureIdentityConformance.test.ts`
- Create: `products/intuecho/services/api/src/literatureIdentityConformance.test.mjs`
- Modify: `products/liteasy/apps/desktop/src/app/features/paper-identity/literature.types.ts`
- Modify: `products/intuecho/packages/contracts/src/index.js`
- Modify: corresponding type declarations in `products/intuecho/packages/contracts/src/index.d.ts`

**Interfaces:**
- Identifier kinds include DOI, arXiv, Semantic Scholar, OpenAlex, `title_authors_year_hash`, and a non-confirming PMLR hint shape.
- Provider capability vocabulary is the six named capabilities: `resolveIdentity`, `search`, `fetchRelations`, `locateFullText`, `generateCandidates`, `refetchForConfirmation`.
- New title/author/year fingerprints are `sha256:<64 lowercase hex>`; legacy eight-character FNV values remain accepted as read-only aliases.
- Fixtures contain equivalent identifier spellings, author order variants, legacy records, HelioX metadata, PMLR hints, and negative partial/fuzzy cases.

- [ ] **Step 1: Write fixture cases and contract text**
- [ ] **Step 2: Add conformance tests that initially expose desktop/server drift**
- [ ] **Step 3: Run Desktop and Intuecho focused conformance tests and record failures**
- [ ] **Step 4: Update local types/schemas without importing either product into the other**
- [ ] **Step 5: Re-run conformance tests after later implementation tasks**

### Task 2: Desktop HelioX Extraction And Privacy Boundary

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/paper-identity/literatureRecord.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/paper-identity/paperIdentity.ts`
- Modify: Desktop literature request/controller client files discovered by tests
- Test: `products/liteasy/apps/desktop/src/tests/literatureRecord.test.ts`
- Test: affected identity/request tests under `products/liteasy/apps/desktop/src/tests/`

**Interfaces:**
- Export a deterministic author parser that handles comma, semicolon, `and`, Chinese semicolon, Chinese enumeration comma, and line breaks.
- Preserve `Family, Given` pairs while treating a clear comma-only list such as HelioX as seven authors.
- Parse `PMLR <volume>, <year>` into a bounded hint; do not invent a PMLR paper identifier.
- Build a structured request containing title/authors/year/identifiers/hints only.

- [ ] **Step 1: Add failing HelioX test with all seven names and PMLR text**
- [ ] **Step 2: Add failing tests for `Family, Given; Family, Given` and multilingual delimiters**
- [ ] **Step 3: Add failing request assertion that first-page body and `contentHash` are absent**
- [ ] **Step 4: Implement parsing, PMLR hint extraction, and request boundary filtering**
- [ ] **Step 5: Add manual-confirmation prefill from extracted metadata**
- [ ] **Step 6: Run focused Desktop tests**

### Task 3: Canonical Identity And Legacy Compatibility

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/paper-identity/paperIdentity.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/paper-identity/literatureRecord.ts`
- Modify: `products/liteasy/services/api/src/literatureMetadata.mjs`
- Modify: `products/intuecho/services/api/src/literatureIdentity.mjs`
- Modify: persistence/repository modules that resolve literature identifiers
- Test: Desktop identity tests
- Test: `products/liteasy/services/api/src/literatureMetadata.test.mjs`
- Test: `products/intuecho/services/api/src/literatureIdentity.test.mjs` and repository compatibility tests

**Interfaces:**
- Stable identifier normalization is identical across implementations.
- Bibliographic comparison is exact on normalized title/year and complete author set, with order tolerance only.
- Existing `literatureId` and old hash aliases are never rewritten in place.
- A unique full-metadata match may attach the canonical alias to the existing record; multiple or conflicting matches remain ambiguous/conflicted.

- [ ] **Step 1: Add failing normalization and SHA-256 fixture tests**
- [ ] **Step 2: Add failing old-FNV read/alias and no-silent-rewrite tests**
- [ ] **Step 3: Implement canonical normalization and versioned fingerprinting**
- [ ] **Step 4: Implement compatibility lookup and alias attachment in both persistence adapters**
- [ ] **Step 5: Verify existing DOI/arXiv/OpenAlex/Semantic Scholar behavior**

### Task 4: Strict Identity Resolver And Provider Capabilities

**Files:**
- Modify: `products/intuecho/services/api/src/literatureProviders.mjs`
- Modify: `products/intuecho/services/api/src/literatureResolver.mjs`
- Modify: `products/intuecho/services/api/src/productionApp.mjs` only where capability routing is required
- Test: `products/intuecho/services/api/src/literatureProviders.test.mjs`
- Test: `products/intuecho/services/api/src/literatureResolver.test.mjs`
- Test: relevant production route tests

**Interfaces:**
- Provider instances expose a capability set; missing capabilities are not called.
- Identity purpose uses only strict identity/refetch capabilities.
- Broad external search can return candidates, but candidate admission rejects irrelevant records for identity confirmation.
- Candidate confirmation always refetches and validates provider, candidate key, identifiers, and record contract.
- Timeout and provider failures are isolated with stable unavailable-provider reporting.

- [ ] **Step 1: Add failing tests for unique exact match, ambiguous exact matches, partial authors, same-title different-paper, spoofed candidates, timeout, and partial provider failure**
- [ ] **Step 2: Add failing capability-selection tests**
- [ ] **Step 3: Implement strict admission gate and capability routing**
- [ ] **Step 4: Preserve forum compose and external retrieval behavior outside identity policy**
- [ ] **Step 5: Run Intuecho focused literature tests**

### Task 5: PMLR Safe Adapter Boundary

**Files:**
- Modify: `products/intuecho/packages/contracts/src/index.js`
- Modify: `products/intuecho/packages/contracts/src/index.d.ts`
- Modify: `products/intuecho/services/api/src/literatureProviders.mjs` or a focused PMLR adapter module
- Test: PMLR contract/provider tests
- Test: Desktop PMLR hint tests

**Interfaces:**
- PMLR hint is structured and bounded (`volume`, `year`, optional future paper key).
- Without a reliable official machine-readable source, PMLR has no automatic identity capability and cannot return a successful provider candidate.
- A future official adapter can implement `resolveIdentity`, `search`, and `refetchForConfirmation` without changing persistence policy.

- [ ] **Step 1: Add failing safe-degradation and hint parsing tests**
- [ ] **Step 2: Implement the non-provider hint projection**
- [ ] **Step 3: Verify no PMLR success or persistent fake identifier is emitted**

### Task 6: Intuecho Development Provider Configuration

**Files:**
- Modify: `products/intuecho/services/api/src/server.mjs`
- Modify: `products/intuecho/services/api/src/productionConfig.mjs` only if shared env parsing needs alignment
- Modify: `products/intuecho/services/api/.env.example`
- Test: `products/intuecho/services/api/src/server.test.mjs`
- Test: provider/config tests

**Interfaces:**
- Development API constructs providers from server-only `INTUECHO_*` environment values rather than `{}`.
- Crossref/arXiv defaults remain active when optional keys are absent.
- OpenAlex and Semantic Scholar are enabled only when their server keys are present.
- Keys never appear in responses, errors, logs, or snapshots.

- [ ] **Step 1: Add failing dev-entry tests proving configured keys enable providers**
- [ ] **Step 2: Add failing tests proving default Crossref/arXiv behavior remains**
- [ ] **Step 3: Implement environment loading/config projection**
- [ ] **Step 4: Run Intuecho API tests and build check**

### Task 7: Verification And Documentation

**Files:**
- Modify: `docs/engineering/literature-identity-and-provider-contract.md` with final evidence/limits
- All changed files: `git diff --check`

- [ ] **Step 1: Run affected Desktop tests and `npm run build`**
- [ ] **Step 2: Run `products/intuecho` tests and build**
- [ ] **Step 3: Run relevant Liteasy API and `development/dev-cloud` tests**
- [ ] **Step 4: Run full suites where feasible**
- [ ] **Step 5: Inspect final diff and verify unrelated worktree changes remain untouched**
