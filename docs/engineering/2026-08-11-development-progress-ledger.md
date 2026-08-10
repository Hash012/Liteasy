# 2026-08-11 主线开发进展总账

本页汇总当前 `main` 的有效开发成果、设计真源和未完成边界。它用于避免重复合并历史分支或把本地门禁误写成生产验收。

## 分支整合结论

- `main` 与 `feat/thin-reading-multimodal-sdd` 在本轮收敛前指向同一主线基点；薄读、多模态、文献身份和 artifact library 成果已经进入该历史。
- `T_IM`、`User-portrait`、`recommendation-system`、`feature/pdf`、`feat/ai-runtime-phase-ab-spec` 和 `T_IM-feature-and-docs-improvements` 的远端提交均已被主线包含，不应再次机械合并。
- `Marks-development-report` 是无共同祖先的早期 mock 原型，不属于当前产品架构；整支合并会重新引入旧目录和旧语义。
- 本地 `integrate/user-portrait`、`keep-*` 和 stash 是历史保留点或运行缓存，不作为待合并功能来源，也不在本轮清理。
- 未跟踪的 `products/liteasy/apps/desktop/src-tauri/薄读.html`、`薄读.md`、`薄读.pdf` 是用户导出物，不纳入提交。

## 已进入主线的产品能力

| 领域 | 当前有效实现 | 状态边界 |
| --- | --- | --- |
| Desktop 基线 | Tauri + React、Fluent 2 壳层、PDF 阅读、工作区、artifact library、薄读、页级关联图、直接批注发布 | 本地/构建门禁不等于跨平台安装验收 |
| 薄读与证据 | 证据受限生成、句级复核、节点深挖、外部来源约束、artifact 导出和恢复 | 真实模型/provider 质量仍依赖部署配置 |
| 多模态 Phase 1 | v1 schema、catalog、validator/renderer registry、workflow harness、`source_figure` | 仅 `source_figure` 生产启用 |
| 多模态 Phase 2 | entitlement、偏好、配额、provider route/cost、审计、管理端 | 已完成本地 PostgreSQL/API/Admin/Desktop 门禁；不是生产部署验收 |
| 多模态 Phase 3 | durable request orchestration、租约恢复、取消、服务端 compiler boundary、Desktop 恢复 | 实现和本地门禁完成；独立 closure review 未完成 |
| 多模态 Phase 4-6 | 规格与计划 | 生成式静态、交互、过程、raster modality 尚未实现或启用 |
| 文献身份 | Intuecho 权威 resolver、分级 provider 确认、confirmed-only 正式记录、全局 identifier/claim 约束、版本关系骨架 | 真实 provider、目标 PostgreSQL 和生产部署待验；关系可信写入编排未接通 |
| Liteasy 云文献 | 独立用户/组织库、`literatureId + revision` 服务端核验、只读投影 | 不共享 Intuecho 数据库或凭据；已有投影可离线读 |
| 社区同步 | confirmed `literatureId` 门槛、批注/回复发布与恢复、删除真相和幂等 | 未确认或 legacy 身份不能公开同步 |
| `development/dev-cloud` | `works`、标签、索引、推荐开发链路 | 保留使用，但不是正式文献身份真源 |

## 文献身份最新规则

1. `literatureId` 标识来源确认后的具体版本；用户文件由独立 `documentId` 管理。
2. 正式新记录只能是 `confirmed`；解析歧义不创建公共记录，旧 manual/metadata 保持 `legacy_unverified`。
3. Crossref/arXiv 可精确回查确认；OpenAlex/Semantic Scholar 必须显式选择后服务端重抓，或以独立聚合证据复用同一完整版本。
4. `(identifier_kind, normalized_value)` 和 `(provider, provider_record_id)` 分别全局唯一；标识所有权与来源证据不混存。
5. 题录 SHA-256 只作候选、兼容别名或 PostgreSQL 事务锁键，不是正式身份依据。
6. 预印本与正式发表版不合并；只有带证据的关系连接它们，且不迁移批注、页码、指标或全文权限。
7. Liteasy API 不信任 Desktop 快照，必须向 Intuecho 核验 `literatureId + revision` 后保存投影。

## 本轮一致性收敛

- 修复 OpenAlex/Semantic Scholar 契约漂移，并让两个独立聚合来源确认同一版本时复用 `literatureId`，版本类型冲突时保持分离。
- Resolver 对聚合来源保持显式选择和服务端重抓，不把检索阶段的双源结果冒充已持久化证据。
- Liteasy metadata-only 创建拒绝夹带 `metadata.literature`；确认投影只走核验更新链路。
- Desktop Agent 上下文保留合法 `public_registry` 身份。
- Intuecho 版本历史使用系统主体 `literature_resolver`，不保存 Liteasy 请求者 ID。
- 新增不可变迁移 `017_constrain_legacy_aggregate_confirmation.sql`，将只有旧迁移标记的单聚合来源记录降为 `legacy_unverified`；SQLite 同构。
- 服务端重新抓取会更新同一 claim 的 evidence/observed time；版本关系 repository 拒绝空 evidence。

## 尚未完成

- 真实 Crossref/arXiv/OpenAlex/Semantic Scholar 环境的受控 smoke、目标 PostgreSQL 迁移执行和生产部署验收。
- provider 明示版本关系或审核确认流程，以及该流程到 `literature_relations` 的可信写入编排。
- 多模态 Phase 3 独立 closure review；Phase 4-6 的 renderer、validator、视觉回归、benchmark 和真实 provider release gate。
- 生产运行观察、备份恢复演练、S3/网络/密钥配置和跨平台 Desktop 手工验收。

所有“通过”结论必须附本次实际命令结果；历史测试计数只能作为基线，不能替代修改后的最终门禁。
