# 3188438 增量 Review 交付

任务包：`Liteasy-review-3188438-Codex-2026-10-03`。基线为 `3188438c95dfc7f73b5ccf20a05ef69391e646cf`，实施分支 `feat/review-3188438`。原 main 工作区的 `.gitignore` 与未跟踪文档修改保持不动。按任务包要求，本轮没有 push、合并 main、请求 Windows Installer、生产发布或调用付费模型。

本轮完成当前环境可实施的功能修复及验证工具；真实云链、原生平台和真人验收仍有明确缺口，**不构成生产/发布验收通过**。最终代码提交、树、工具链、命令、退出码及 RV01–RV36 状态集中在 [verification.json](verification.json) 和 [场景矩阵](SCENARIOS.md)。后续交付记录提交仅增加文档，不混算不同代码快照的测试。

## 实现范围

| 任务 | 本轮改动及交付位置 |
| --- | --- |
| R00 | [基线、authority/命令映射及 D01–D08 HOLD](R00-baseline-and-policy.md)。保持当前负责人、作者例外、公开内容和支付等既有政策。 |
| R01 | private/mutual/组织标签推断隔离；无明确许可时关闭 public corpus 推断，旧无 scope 标签保留审计但退出公开派生。[契约与迁移](R01-R05-R10-community-contracts.md) |
| R02 | stable operationId + payload digest + 同事务 receipt；实际 revision 防覆盖、当前权限读取回执、销号清理；新 operationId 可建立相同正文的新内容。 |
| R03 | actor/env/issuer 归属草稿、存储失败反馈、冻结预览、未知请求只读核实、冲突草稿与重新选择 base revision。[Web 记录](R03-R06-web-workflows.md) |
| R04 | typed collaboration metadata；零批注组织可从确认题录建立首个材料包，类型不再依赖标签或标题，旧歧义内容不自动升级。 |
| R05 | 提交时检查真实来源版本/当前权限；Web 历史定位；Desktop 独立 audience 深链、新建反思笔记、失败保留输入及重新鉴权。 |
| R06 | 空间和操作视图投影现有发布、转移、通知状态，不新增权限数据库；待核实/已读/已发布分别说明。 |
| R07 | [账户删除与组织交接/退出并发屏障](R07-organization-lifecycle.md)；五身份×六类资源的离组例外矩阵，保持已有作者删除/读取权利，不扩展未知政策。 |
| R08 | [独立签名 journal、高水位及恢复开放门禁](R08-recovery-gates.md)；真实 PG 事件前备份恢复；受保护的 S3/scanner 分阶段故障与 IdP refresh 脚本。后两类真实环境未运行。 |
| R09 | [受影响 CI 路径、服务/三客户端套件与脱敏工件](R09-ci-evidence.md)；required gate 不接受被选中套件跳过。 |
| R10 | 请求内批量读取、公平 cursor、当前权限复核、标识符索引与真实 query plan；[性能数据](evidence/performance.json)只代表合成根条目分页，未声称全候选语义排序或生产容量已优化。 |
| R11 | [经同意的离线试点记录/校验工具](R11-voluntary-pilot.md)，无真人则不填留存、付费、满意度或金额。 |
| R12 | [Desktop Agent/资源 MCP 边界](../review-3188438-desktop-boundaries.md)：组织来源沿派生保留、外部 Markdown 不可通过工具写入移除来源限制；CLI/Agent MCP local-only 提前阻断联网，批准绑定身份、环境、实际操作和期限；不可用社交能力给出原因。 |

## 验证与真实边界

`evidence/inputs.sha256` 是七份同代码提交记录去重后的输入清单，覆盖实际脚本、契约和 fixture。`verification.json` 保留每条命令、退出码和原本地白名单摘要的 digest。原始进程日志、数据库备份、凭据、环境配置和用户正文均不提交。数据库数据、攻击正文、组织成员和回执均为合成样本。

测试平台是 Linux x86_64、Node 22.13.1、PostgreSQL 16.15；`.nvmrc` 指定的 22.23.2 精确版本未在本机使用，不能表述为完全相同工具链。Desktop 的 DOM 测试不代表三平台实际 OAuth/keyring/handoff；Agent 传输 mock 不代表真实模型或外部 MCP 客户端。资产 MCP 原有显式论文导入能力仍可联网，不能把 Agent turn 的 `local-only` 保证扩大为所有 localhost MCP 工具永不联网。

真实 S3/scanner（RV23）、真实 IdP 多 audience refresh（RV25）、三平台原生恢复（RV27）、自愿用户与实际成本（RV31/RV32）为 `not_run`。真实服务配置和下一步执行入口见 R08；人工步骤由产品负责人组织，不能以合成角色补齐。演练签名只能校验独立生产者所提供日志的完整性，实际部署仍须验证事件生产者、可信公钥和最新高水位存储在备份之外。

## 最终候选执行结果

测试提交：`acdf679894ab8b60b0ab339cc937198a6f8b0586`。全部命令 exit 0；Desktop 全套结果为 `Test Files  521 passed | 2 skipped (523) / Tests  3579 passed | 4 skipped (3583)`。生产 build、ci:smoke、ci:contracts 与 check-clean 均通过。

其他同提交结果：identity 8 项；Liteasy API 498 通过/4 跳过（另行真实 PG 套件通过）；Intuecho API 298 项；Web 119 项；Admin 18 项；Mobile 19 项；CI 脚本 93 项；试点工具 2 项。上述各产品独立列示，不与历史运行求和。Liteasy/Intuecho PG 分别执行 28/31 个迁移，恢复演练 15 项通过。

## 兼容与回退

新增迁移只扩充 scope 索引、命令回执、结构化协作字段和查询索引；旧数据不根据标签猜测新权限。读取历史引用仍要求当前权限，回执未知不得作为“失败”自动重发。原有本地原件不会因云端撤回/切号删除。

优先前向修复。UI 回退不能删除已存在的 receipt、revision、协作 metadata 或 source-lineage；旧客户端若缺少 expectedRevision 应收到明确版本错误，不能重新允许静默覆盖。不要为了回滚清理业务数据，也不要降低生成文件、当前权限或恢复开放门禁。具体迁移和各入口回退注意见上表各项记录。
