# 用户画像与文献推荐：开发测试方案（文件级）

> 制定时间：2026-08-03
> 配套总纲：`docs/saas/2026-08-03-用户画像与文献推荐-开发计划与数据模型.md`
> 工作流：**逐模块开发 → 模块测试通过 → `./start.sh` 启动服务人工 check → 确认后再开发下一模块。**
> 代码风格：dev-cloud 用原生 `node:http` + `better-sqlite3` + `node:test` + `node:assert/strict`；桌面端用 Vitest + Testing Library。命名两空格、双引号、分号；`.mjs`/`.ts` 一律 ESM。

本方案只展开 **P0**（身份锚点 + 画像采集管线 + 推荐去 fixture）为可实施、可测试的模块。P1/P2 见总纲。

---

## P0 模块拆分与人工 check 点

| 模块 | 内容 | 人工 check 方式 |
|---|---|---|
| M1 身份层 ✅ | `works`/`work_identifiers`/`citation_edges` 迁移 + `workRepository` + 身份解析 + `POST /v1/works/resolve` | `curl` 同一论文二次解析返回同一 `workId`；版本关系落 `relation` |
| M2 概念目录 ✅ | `concepts` 迁移 + 从 `disciplineCatalog.json` 播种 + `conceptRepository` + `GET /v1/concepts` | `curl` 列出学科目录；按 code 查询 |
| M3 Tag 中枢 + 论文自动索引 | `tags`/`paper_tags` 迁移 + 关键词抽取（复用 term 抽取逻辑）+ `tagRepository` + 论文打标端点 + `GET /v1/tags`、`GET /v1/tags/:id/works` | 给定论文标题→自动抽出 tag；按 tag 反查论文 |
| M4 用户画像=阅读 tag | 把 `personalization_terms` 收敛为「用户 tag 权重」并关联 `tags`；`paper_opened` 落论文 tag 到用户画像；`GET /v1/profile/get` 暴露 top tag 用于页面展示 | 阅读若干论文后画像 top tag 变化；缓存失效 |
| M5 Tag 驱动推荐 + 去复用 | 以用户 top tag / 当前论文 tag 为检索重心调 OpenAlex/Crossref/arXiv；`recommendationMode` 默认非 demo；候选携带 surfacing tag 溯源 | 推荐结果带 `workId` 与 surfacing tag；二次命中身份缓存 |
| M6 候选池/反馈迁 SQLite + 溯源 | `recommendation_candidates`/`recommendation_feedback` 迁 SQLite（保留 JSON 导出兜底）；候选携带 surfacing tag；`demo-reset` 兼容 | 推荐→反馈→候选状态迁移可查；`demo-reset` 清空 |
| M7 桌面端接入 | 画像页展示 tag；推荐展示 tag 溯源；薄读外部知识客户端先查 `works` | App 内画像/推荐/薄读运行正常 |

> **设计中枢（tag-centric）**：tag = keyword 是推荐检索重心与画像展示单元。
> - 推荐侧：用户 top tag（或当前论文 tag）作为 keyword 检索 OpenAlex/Crossref/arXiv，融合排序后返回，候选携带「哪个 tag 召出它」的溯源。
> - 画像侧：历史阅读记录总结为 tag 权重（复用并泛化 `personalization_terms` 机制），既驱动推荐又在画像页展示。
> - `tags`（规范化、跨用户共享）与 `concepts`（学科目录、curated）正交：tag 是行为/文本抽取的自由 keyword，后续可对齐到 concept 但不强绑。

每模块完成后：`npm test`（受影响包）→ `./start.sh` → 人工 check → 用户确认 → 下一模块。

---

## M1 身份层（当前模块）

### 目标
把临时拼装的论文身份解析沉淀为规范化 `Work` + `WorkIdentifier`，作为画像/推荐/薄读共用的身份锚点。幂等：同一论文多次解析返回同一 `work_id`。

### 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `development/dev-cloud/db/migrations/003_works_and_identity.sql` | 🆕 | `works`、`work_identifiers`、`citation_edges` 三表 |
| `development/dev-cloud/db/workRepository.mjs` | 🆕 | SQLite 仓库：`resolveWork`、`getWork`、`listIdentifiers`、`addCitationEdge` |
| `development/dev-cloud/payloads/identityResolutionPayloads.mjs` | 🆕 | 请求校验 + 公共快照构建（`buildWorkResolutionPayload`） |
| `development/dev-cloud/db/workRepository.test.mjs` | 🆕 | 仓库单测：幂等、多标识合并、版本关系、引用边 |
| `development/dev-cloud/payloads/identityResolutionPayloads.test.mjs` | 🆕 | 校验/快照单测 |
| `development/dev-cloud/server.test.mjs` | ✏️ | 新增 `POST /v1/works/resolve` 端点集成测试 |
| `development/dev-cloud/requestHandler.mjs` | ✏️ | 注册端点 + `availableEndpoints` + 注入 `workRepository` |

### 数据模型（迁移 003）

```sql
CREATE TABLE works (
  id TEXT PRIMARY KEY,                 -- 内部稳定 id（随机）
  title TEXT,
  year INTEGER,
  type TEXT,                           -- journal_article/preprint/conference/...
  canonical_provider TEXT,             -- openalex/crossref/arxiv/local
  canonical_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX works_canonical_idx ON works(canonical_provider, canonical_id);

CREATE TABLE work_identifiers (
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  identifier_kind TEXT NOT NULL       -- doi/arxiv/semantic_scholar/openalex/crossref/local/title_authors_year_hash
    CHECK (identifier_kind IN ('doi','arxiv','semantic_scholar','openalex','crossref','local','title_authors_year_hash')),
  identifier_value TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'same_as'  -- same_as/is_version_of/has_version/is_preprint_of
    CHECK (relation IN ('same_as','is_version_of','has_version','is_preprint_of')),
  source_provider TEXT,
  verified BOOLEAN NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (identifier_kind, identifier_value)
);
CREATE INDEX work_identifiers_work_idx ON work_identifiers(work_id);
```

`citation_edges` 表一并建出（前瞻），M1 仅提供 `addCitationEdge` 写入与查询，不接入推荐链：

```sql
CREATE TABLE citation_edges (
  source_work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  target_work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL
    CHECK (relation_type IN ('cites','cited_by','related','is_version_of')),
  source_provider TEXT NOT NULL,       -- 仅 openalex 可为 cites/cited_by/related
  verified BOOLEAN NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 1,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (source_work_id, target_work_id, relation_type)
);
CREATE INDEX citation_edges_target_idx ON citation_edges(target_work_id, relation_type);
```

### `workRepository` API

```js
createWorkRepository(database) -> {
  resolveWork(identityInputs, meta?) -> { workId, work, identifiers, created },
    // identityInputs: [{ kind, value, source?, relation? }]
    // 任一标识命中已有 work → 复用，并把缺失标识补入该 work；否则新建。
  getWork(workId) -> { work, identifiers } | null
  listIdentifiers(workId) -> Identifier[]
  addCitationEdge({ sourceWorkId, targetWorkId, relationType, sourceProvider, verified }) -> edge
  listCitations(workId, direction) -> edges[]
}
```

不变量：
- `resolveWork` 在一个事务内完成「查找→合并/新建」，幂等。
- 同一 `(kind,value)` 唯一；一个 work 可多标识。
- 跨版本关系显式 `relation`，不用 DOI 当主键硬并。

### 端点 `POST /v1/works/resolve`

请求：
```json
{ "sessionId": "ltsy_...", "identities": [{"kind":"doi","value":"10.x/y"}, {"kind":"arxiv","value":"2401.12345","relation":"is_preprint_of"}], "title":"...", "year":2024, "type":"journal_article" }
```
响应：
```json
{ "workId":"w_...", "work":{...}, "identifiers":[...], "created": false, "personalizationVersion": 0 }
```
- 走 `authorizeAccountScopedBody`（与其它 scoped 端点一致），sessionId 命名空间化。
- 校验：`identities` 非空、`kind` 合法、`value` 非空且长度上限；非法返回 400 `invalid_work_identity`。

### 测试矩阵（M1）

**`workRepository.test.mjs`（`:memory:` 库）**
1. 首次解析一组标识 → `created=true`，返回 `workId`。
2. 同组标识二次解析 → `created=false`，`workId` 不变（幂等）。
3. 用其中一个标识 + 新增一个标识再解析 → 复用同一 `workId`，新标识补入 `work_identifiers`。
4. 两组完全不同标识 → 两个不同 `workId`。
5. `relation` 持久化（`is_preprint_of`）。
6. `addCitationEdge`：写入 `cites` 边；重复写幂等（PK 冲突 `DO NOTHING`）。
7. `listCitations` 双向正确。
8. 删除 work 级联清空 `work_identifiers`/`citation_edges`。

**`identityResolutionPayloads.test.mjs`**
- 合法请求 → `{ ok:true, value }`。
- `identities` 空 / `kind` 非法 / `value` 超长 → `{ ok:false, error }`。
- 公共快照不含敏感字段。

**`server.test.mjs`（端点集成）**
- 未带 sessionId（demo）→ 200，`workId` 稳定。
- 二次解析同论文 → 同 `workId`、`created:false`。
- 非法 `kind` → 400 `invalid_work_identity`。
- `GET /v1/works/resolve` → 405（方法不允许）。
- 根 `/` 的 `endpoints` 含新端点。

### 人工 check（M1，`./start.sh` 后）

```bash
# 1) 二次解析同论文应返回同一 workId、第二次 created:false
curl -s -X POST http://127.0.0.1:8787/v1/works/resolve \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"demo-session-1","identities":[{"kind":"doi","value":"10.1145/3459615"},{"kind":"arxiv","value":"2106.04561","relation":"is_preprint_of"}],"title":"ColBERT","year":2021,"type":"conference"}' | jq .

# 2) 非法 kind 应 400
curl -s -X POST http://127.0.0.1:8787/v1/works/resolve \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"demo-session-1","identities":[{"kind":"bad","value":"x"}]}' | jq .

# 3) 服务索引应含 POST /v1/works/resolve
curl -s http://127.0.0.1:8787/ | jq '.endpoints' | grep works
```

---

## M3–M7 测试方案（tag-centric，后续模块展开时补充同等粒度）

- **M3 Tag 中枢 + 论文自动索引**：迁移 005 `tags`/`paper_tags`；`tagRepository`（`extractTags` 复用 latin/中文 bigram 抽取、`indexWork`、`listTags`、`listWorksForTag`）；端点 `POST /v1/works/:workId/index`（给 title/abstract 自动打标）、`GET /v1/tags`、`GET /v1/tags/:id`、`GET /v1/tags/:id/works`。测试：抽取去重、`indexWork` 幂等、按 tag 反查论文、`occurrence_count` 递增、删 work 级联清 `paper_tags`。
- **M4 用户画像=阅读 tag**：泛化 `personalization_terms` 为用户 tag 权重（可选 `tag_id` FK 对齐 `tags`）；`recordSignal` 的 `paper_opened`/`recommendation_saved` 在落 term 的同时，若论文已打标则把其 tag 权重并入用户画像；`GET /v1/profile/get` 暴露 `tags: [{label, weight, source, evidenceCount}]` top N 供页面展示。测试：阅读已打标论文→用户 top tag 权重上升；画像快照含 tags；缓存失效。
- **M5 Tag 驱动推荐 + 去复用**：`buildLiveRecommendationPayload` 以用户 top tag / 当前论文 tag 作为 keyword 调外部检索；候选携带 `surfacingTags`（哪个 tag 召出它）；`recommendationMode` 默认非 demo。测试：推荐查询来自用户 top tag；候选带 surfacing tag；fixture 仅 demo。
- **M6 候选池/反馈迁 SQLite + 溯源**：迁移 006；新 `recommendationCandidateRepository`(SQLite) 与 `recommendationFeedbackRepository`(SQLite)，保留 JSON 导出供 `demo-reset`；候选携带 `surfacingTags`。测试覆盖原 JSON 仓库全部用例 + TTL + 上限 + 状态迁移 + tag 溯源。
- **M7 桌面端接入**：画像页展示 tag；推荐展示 tag 溯源；`recommendationClient`/`thinReadingExternalKnowledgeClient` 先查 `works`；Vitest + Playwright。

---

## 全量回归

每模块后：
```bash
cd development/dev-cloud && npm test          # node --test
cd products/liteasy/apps/desktop && npm run build && npm test    # 提交前
```
