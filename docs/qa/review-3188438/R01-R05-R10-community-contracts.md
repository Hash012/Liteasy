# R01–R05 / R10 社区后端契约与验证记录

记录日期：2026-10-03。审查基线为 `3188438c95dfc7f73b5ccf20a05ef69391e646cf`；本记录对应 `feat/review-community-api` 的后端实现，最后一项功能/测试提交为 `481bc06fc540b33d4fa5fb6f63b9fdfb8c677967`。范围是 Intuecho API、contracts，以及补充的 RV22 离组例外验证。Web 的持久草稿、确认界面、浏览器跨窗口行为及 Desktop 原生运行由相应客户端记录另行证明。

本轮使用 Linux x86_64、实际 Node.js 22.13.1、真实 SQLite 和隔离的 loopback PostgreSQL 16。测试数据库使用既有 `*_test` guards，应用与迁移角色分开。没有连接生产，没有发送真实帖子、邀请、通知，没有真实 IdP/S3/scanner 或原生三平台验收；这些层不能从本记录升级为 passed。以下只摘录合成结果，不复制数据库连接信息、凭据、dump 或环境私密日志。

**实现、迁移与兼容**

| 切片 | 实现及契约入口 | 行为与兼容边界 |
| --- | --- | --- |
| R01 | `products/intuecho/services/api/src/annotationCommunitySqlite.mjs`、`postgresAnnotationCommunityRepository.mjs`、`scopedPlatformTags.mjs`；迁移 `028_scope_derived_tags.sql` | 候选资格在取样上限前约束：组织限相同 organization ID，private/mutual 限相同可见范围与作者，排除撤回内容及回复投影样本。没有显式语料授权，因此 public 输出不使用用户帖子学习平台标签。新推断记录 `classifierVersion=local-semantic-scope-v2` 与 `sourceScope`。未知/不匹配的历史平台来源不进入正文读取和搜索；存储中的标签、用户标签、申诉与审计不被批量删除。 |
| R02 | `products/intuecho/packages/contracts/src/communityCommands.js`、`communityCommands.d.ts`、`index.js`、`index.d.ts`；API 的 `communityCommands.mjs`、`annotationCommunityRoutes.mjs`；迁移 `029_community_command_receipts.sql` | 创建请求的稳定身份是 verified actor + operationType + operationId；正文/事件/回执同事务。同 key 异摘要返回 409；相同正文的新 UUID 表示新意图。回执不存正文快照。HTTP 内容编辑缺 `expectedRevision` 返回 428，陈旧版本返回 409；内部旧 repository 调用省略该字段仍兼容，不等于具备版本保护。 |
| R04 | `collaborationMetadata.mjs`、两种 annotation repository；迁移 `030_structured_collaboration.sql` | 在现有 annotation/reply 上保存 schemaVersion 1 metadata，不新增 Post 数据域。reading_pack 必须属于组织；question/host_summary/dissent/reflection 必须回复指定 reading_pack，host_summary 只允许包作者。标签、标题和语言不是类型依据，旧内容保持 `collaboration:null`，不改原 body。 |
| R05 | `communitySourceRevision`、`#validateSources`、`#assertSourceRevisions`；`annotationCommunityRoutes.mjs`、`server.mjs`、`productionApp.mjs` | sourceRefs 按实际可见性、当前 revision 和输出 scope 校验；PG 在提交时锁定源，SQLite 在写事务内复核版本/撤回状态。历史读取先检查当前访问权；历史 annotation 的受众与当前受众不同则拒绝，private→public 不会暴露旧私密正文。Desktop 使用独立 audience 的只读别名。 |
| R10 | `communityPagination.mjs`、两种 annotation repository；迁移 `031_community_read_indexes.sql` | latest 游标按时间与 ID 排序，精确文献过滤在分页前执行；PG 游标保留微秒。最新页批量读取 targets/evidence/literature/tags/ratings/saves，末尾复核内容状态，只在当前请求内使用聚合结果。标识符查找使用规范化 kind/value 精确 SQL。关注流先过滤互关资格，组织流重新询问当前权限，不把旧组织列表当授权。 |
| 账号生命周期 | `accountLifecycleRepository.mjs` | 新 command receipts 随既有账号删除事务清理；既有删除栅栏仍拒绝已注销主体重建内容。没有修改公开正文去标识或保留政策。 |

迁移只追加 028–031，没有修改历史 SQL。SQLite 初始化器对现有库增量补列/索引；PG 按原迁移器与 checksum/readiness 门禁执行。030 的缺失 metadata 使用 SQL NULL，不能误写为违反约束的 JSON null。历史版本的 collaboration 在插入版本记录时保存，没有通过改写旧版本绕过 append-only 规则。

服务先升级到支持新契约，再部署发送新字段的客户端。旧读取保留原字段，新增字段可被旧客户端忽略。旧 POST 不带 `command` 仍被接受，但**没有幂等重试保证**；不能把它们算入 RV04/RV06 的保证范围。旧 HTTP PUT 不带版本被明确拒绝，不允许静默覆盖。回复升格支持 `expectedRevision`、`expectedParent`、`expectedAuthorProfileRevision`；Web 新调用须发送这些字段。正文编辑与新回复也复核作者资料版本。投影返回实际 `originalReply.revision`，不能用投影自身 revision 代替回复 revision。

**可调用契约**

```ts
command: {
  protocolVersion: 1;
  operationId: string; // UUID，第一次发送前固定
  bodyDigest: string;  // 64 位小写十六进制 SHA-256
}
```

摘要输入是共享 `communityCommandPayload(operationType, targetId, input)` 返回的 UTF-8 字符串。该 helper 先按 schema 处理 trim/default，再递归稳定排序；不包含 command 自身。类型为 `create_annotation` 或 `create_reply`；前者 targetId 为 null，后者是父 annotation ID。客户端保存冻结请求后再发送，未知结果不能自动换 UUID 重发。

| 路由 | 返回/约束 |
| --- | --- |
| `POST /v1/annotations`、`POST /v1/annotations/:id/replies` | 原响应形状保留，新增可选 command；重试同 key 复用已提交资源，不重复创建通知。 |
| `GET /v1/community-commands/:operationType/:operationId` | actor 由已验证身份决定。返回 `not_found` 或 `committed` + receipt；当前内容不可读时 `available:false`，没有 result/body。另一个主体不能读取原主体回执。读取不写库。 |
| `PUT /v1/annotations/:id`、`PUT /v1/replies/:id` | HTTP 必须有 expectedRevision；陈旧返回 `ANNOTATION_REVISION_CONFLICT` / `REPLY_REVISION_CONFLICT`。不自动重试覆盖。 |
| `GET /v1/organizations/:id/reading-sources?query=...` | 当前组织权限通过后返回 `{sources: LiteratureRecord[]}`；来源为已有已确认公开登记文献，不依赖组织先有 annotation。空查询返回空列表；已有 resolver 可继续确认来源。没有把本地无 DOI 章节伪装为 confirmed literature，也没有跨库读取组织资产。 |
| `GET /v1/community-sources/:sourceNamespace/:sourceId/revisions/:revision` | Web audience。返回引用 revision、currentRevision、historical，以及获准读取的 body 或 literature；annotation/reply 还返回当前 visibility、organizationId。撤回、删除、失权或历史受众不匹配会拒绝。 |
| `GET /v1/integrations/desktop/community-sources/:sourceNamespace/:sourceId/revisions/:revision` | 独立 `liteasy-desktop` audience；Web token 被拒绝，Desktop token 也不能借 Web 别名读。共用相同权限与版本检查，不写回执或自动复制正文。 |
| `GET /v1/plaza/page?limit=30&cursor=...&literatureId=...` | `{annotations,nextCursor}`；支持 latest 与可选精确文献筛选。游标只定位，不授予访问权。 |

Collaboration 形状为 `{schemaVersion:1, kind, parentPackId?, sourceRefs, discussionDueAt?}`。sourceRefs 包含 `{sourceNamespace,sourceId,revision,locator?}`；namespace 限 `intuecho.annotation`、`intuecho.reply`、`intuecho.literature`。locator 支持 whole_document/source_passage、可选 page/anchorHash；discussionDueAt 使用 ISO 日期时间。来源 revision 已变化时提交返回 `SOURCE_REVISION_CONFLICT`，而不是信任客户端预检。组织输出不接受另一组织或 private 来源。历史读取不豁免当前撤权，也不构成组织导出许可。

**复现与验证入口**

相对于 `products/intuecho/services/api/`：

| 入口 | 实际覆盖 |
| --- | --- |
| `src/scopeDerivedTags.test.mjs`、`scripts/verify-scope-derived-tags.mjs` | 真实 SQLite 首个红测为 private marker 进入 public 标签；修复后覆盖 private/org/mutual 隔离、同 scope 正向推断、源撤回。后续旧无来源标签公开读取/搜索也先红后绿；旧记录保留。共享 scenario 进入真实 PG 总脚本。 |
| `src/communityCommands.test.mjs`、`src/communityCommandRoutes.test.mjs`、`scripts/verify-community-commands.mjs` | 同意图一次创建、不同摘要冲突、新意图允许相同正文、actor 隔离、旧版本拒绝、事务失败回滚、资料版本检查、账号删除回执清理及不复活。HTTP 测试在真实 SQLite 提交后故意丢弃返回结果再 lookup；这是响应丢失模拟，不是真实 TCP 故障注入。PG 用并发请求验证唯一内容/回执。 |
| `src/structuredCollaboration.test.mjs`、`scripts/verify-structured-collaboration.mjs` | 零批注组织材料入口，类型独立于标签，旧类型保守处理，host 权限，引用版本冲突，历史/当前区分，撤权、public reply nullable scope、private→public 历史隔离。 |
| 同脚本 `verifySourceCommitRaces` | 真实 PG 事务先锁源；通过 pg_stat_activity 确认另一个提交的 FOR SHARE 正在等写锁，再提交源修订或删除。摘要事务分别拒绝，未落下摘要行。parent-before-reply 锁顺序与回复编辑/升格保持一致；不声称消除所有多对象死锁可能。 |
| `src/desktopPublicationRecoveryHttp.test.mjs` | development/production 两入口、真实 SQLite、合成 verifier：Desktop/Web audience 互拒、无 token 401、历史读取不写库、撤回后 404。不是实际 IdP 或原生客户端运行。 |
| `src/communityReadScaling.test.mjs`、`scripts/verify-community-read-scaling.mjs`、`scripts/benchmark-community-reads.mjs` | SQLite 复现 120 条不可见互关候选使合法公开条目饥饿、旧组织列表导致撤权后派生读取；分页无重无漏和撤回检查。PG 测实际查询数、query plan、p95、微秒游标、组织撤权。 |
| `src/departedOrganizationRights.test.mjs`、`scripts/verify-departed-organization-rights.mjs` | SQLite/PG 共用五身份、六类读取矩阵及离组后的写/删除例外，见下表。 |
| `scripts/verify-postgres-integration.mjs` | 原迁移、治理、删除、并发覆盖保留，接入上述 PG scenarios。脚本会重置经过 guards 的隔离测试 schema，只能在可丢弃测试库运行。 |

独立性能和 RV22 脚本要求测试库已完成迁移，沿用 `INTUECHO_TEST_DATABASE_URL` / `INTUECHO_TEST_MIGRATION_DATABASE_URL` 的 loopback、`*_test` 校验；它们不重置 schema，写入合成 fixture。此处不提供连接值。实际运行由本地私有 runner 注入这两个变量，再执行表中 Node 命令。

下表明确区分运行时 HEAD 与未提交的被测差异。测试先运行、随后才提交；“代码归入提交”不是“当时已在干净提交上运行”。这些历史结果不能直接标成集成人后来 cherry-pick SHA 的验证，更不能把行数相加。

| 层/命令 | 运行时 HEAD 与代码归属 | 实际结果 |
| --- | --- | --- |
| `npm test --workspace=@intuecho/api`（Intuecho 根目录） | 当时 HEAD `dcdc3ad1` + Desktop audience alias 未提交差异；随后完整归入 `220f8d99725f2dddd572c6e3c37d48a0e0ea53be` | 294/294，exit 0，无 skipped/cancelled。 |
| `npm run check --workspace=@intuecho/api`、`npm test --workspace=@intuecho/contracts` | 与上行相同代码阶段 | 均 exit 0。API check 是已有入口的 Node 语法检查；contracts 是现有 TypeScript typecheck，不冒充 Web build。 |
| `node scripts/verify-postgres-integration.mjs` | 当时 HEAD `220f8d99` + receipt 清理差异；随后归入 `a2b78f52bb11e83fdc6e5e99ecc697d693967c32` | exit 0，31 migrations，R01/R02/R04/R05/R10、真实源锁竞态、receipt cleanup/no-resurrection 均通过。该次尚未包含后来增加的 RV22 矩阵。 |
| `node --test src/departedOrganizationRights.test.mjs` | 当时 HEAD `a2b78f52` + RV22 新 scenario；代码归入 `481bc06fc540b33d4fa5fb6f63b9fdfb8c677967` | 1/1，exit 0；一个测试执行完整矩阵，不把矩阵格数冒充 test runner 测试数。 |
| `node scripts/verify-departed-organization-rights.mjs` | 当时 HEAD `a2b78f52` + RV22 新 scenario；代码归入 `481bc06f`，随后只补充说明文档 | 真实 PG exit 0，30 个读取判定与写/删除断言通过。主 PG 脚本已接入该 scenario，但没有为这一纯测试增量重复全套。 |

历史日志只在本地临时证据目录保留：对应摘要标识分别为 `review-api-delivery-unit`、`review-api-delivery-pg`、`review-api-departure-sqlite`、`review-api-departure-pg`。本文件不依赖临时路径作为可移植测试定义；上面的受版本控制脚本才是复跑入口。最终候选 SHA 的集成证据应由集成人另外记录。

**R10 实测范围与局限**

下表仅取 `a2b78f52` 所含代码阶段那一次完整 PG 运行，fixture 为 `community-read-scale-v1`；不混入此前独立 benchmark 的更快/更慢数字。每组 15 次、每页 30 条，p95 按脚本排序后的 `ceil(n*0.95)` 位置取值；15 个样本的该值就是本组最大样本，不能当成稳定的生产尾延迟估计。

| 本组根批注 fixture 数 | 页查询次数 | 同版本 30 次 detail 读取查询次数 | latest 页 p95（ms） |
| ---: | ---: | ---: | ---: |
| 100 | 9 | 240 | 8.029 |
| 1,000 | 9 | 240 | 7.867 |
| 10,000 | 9 | 240 | 13.415 |

240 次是**同版本逐条 detail 读取的对照**，不是对旧提交完整 plaza 请求的实测基线。每组按独立文献筛选；数据库同时保留原集成 fixture 与先前规模组，因此本组行数不是数据库总行数。测试遍历各组全部页，验证微秒时间差下没有遗漏或重复，并检查撤回后不再返回。

该次查询计划在 1,000/10,000 组显示 `annotations_public_page_idx` 的 Index Only Scan；100 组允许优化器选择 scope index 加 sort。精确标识符查询命中 `literature_identifiers_exact_lookup_idx`；这里扩到 10,000 的是 annotation 数，不是 10,000 个不同文献标识符，不能据此推定大型标识符库容量。

以下保持未证明：真实网络/冷缓存/并发混合写负载、外部组织授权服务的尾延迟、复杂投影祖先链、语义搜索和推荐的全候选排序、非常稀疏的复合筛选、所有侧信道消除。旧语义/推荐入口已去掉造成永久饥饿的固定 500 候选截断，但仍保留全候选排序成本；following/org 等其他 feed 也不因最新页优化而自动获得相同 9-query 保证。没有引入跨请求正文缓存，没有承诺回收已导出或离线保存的副本。

**RV22 既有离组例外矩阵**

fixture 为 `departed-organization-rights-v1`。先验证在组的 root author、reply author、member、admin 均能读取；outsider 从一开始不能读取。随后撤掉前四人的组织访问资格，保持组织内容和历史存在。表中“允许/拒绝”是同一行为 scenario 在真实 SQLite 与 PG 的观察；不是新授权政策。

| 离组后身份 | parent 当前正文 | parent 的 replies | parent 历史 | reply 历史 | reply projection 当前正文 | projection 历史 |
| --- | --- | --- | --- | --- | --- | --- |
| root author（parent 作者） | 允许 | 允许，含线程内回复 | 允许 | 允许 | 允许 | 允许 |
| reply author（非 parent 作者） | 拒绝 | 拒绝 | 拒绝 | 拒绝 | 允许本人投影 | 允许本人投影 |
| member | 拒绝 | 拒绝 | 拒绝 | 拒绝 | 拒绝 | 拒绝 |
| former admin | 拒绝 | 拒绝 | 拒绝 | 拒绝 | 拒绝 | 拒绝 |
| outsider | 拒绝 | 拒绝 | 拒绝 | 拒绝 | 拒绝 | 拒绝 |

| 离组后写/删除操作 | 观察结果 |
| --- | --- |
| root author 编辑本人 parent、新建回复 | `ORGANIZATION_ACCESS_DENIED`。读例外没有升级成组织写权。 |
| reply author 编辑本人 reply、重新升格发布投影 | `ORGANIZATION_ACCESS_DENIED`。 |
| former admin 治理原组织 parent | `ORGANIZATION_MODERATION_DENIED`。 |
| root author 删除他人拥有的 reply projection | `NOT_ANNOTATION_AUTHOR`，即使 root author 可以读取。 |
| outsider 删除 parent | `NOT_ANNOTATION_AUTHOR`。 |
| reply author 删除本人 reply；root author 删除本人 parent | 保留既有作者删除例外；删除后相关历史/当前读取拒绝。 |

这些细分由既有 root-author 与 projection-author 读取规则造成。没有把 reply-author 扩展成整个 parent/thread 的访问者，没有新增管理员离组特权，也没有改变 D02、组织外发或公开正文留存政策。

**回退与前向修复边界**

优先回退尚未启用的客户端入口或暂时关闭受影响写路由，保留兼容的新服务端、迁移和读取隔离；不要直接部署不了解回执、metadata 或 expectedRevision 的旧写服务。旧 PUT 放开版本条件会重新引入丢更新，旧 POST 重 mint ID 会重新引入重复内容。

保留 `community_command_receipts` 的 actor/type/operation 主键、摘要、资源映射和事务语义，不截断回执、不将未知结果改成未发布。账号删除只在既有删除事务和 fence 下按主体清理，不能用全表清理“修复幂等”。备份恢复需同时保留更晚的撤回/删除事实；不能用旧备份或旧操作恢复已撤回内容。

保留 collaboration/sourceRefs 和所有内容 revision/历史记录，不把类型倒推为中文标签，不删除 source revision、不把旧历史升级成当前正文。回退 UI 应忽略不认识的新字段，而不是保存一个缺 metadata 的替换对象。不能改旧迁移 checksum，也不能降库删除 028–031 的字段/表来配合旧程序。

历史平台标签保持读取/搜索隔离。获批的数据修复应先备份、对明确 scope 的候选做离线 dry-run 和差异审阅，再有选择地重算；保留用户标签、已申诉/已移除状态与 append-only 审计，不自动清空生产历史。031 的索引只改变执行成本；若确需调整，使用新的审查后前向迁移，保留正确的过滤、分页、权限复核与所有正文/回执/类型/版本数据。
