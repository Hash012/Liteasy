# Liteasy 开发接手指南

> 适用对象：主要通过 Codex 迭代 Liteasy、但需要掌握产品全局和开发起点的维护者。本文是导航，不替代 `AGENTS.md`、模块设计、测试证据或目标环境验收记录。

## 1. 先理解产品主线

Liteasy 是桌面优先的科研阅读与学习 Agent 工作台，不是通用聊天壳。核心价值由两部分共同构成：

1. **证据约束**：论文解释、数值、图表和外部关系能够回到明确来源，AI 不能用流畅措辞替代证据。
2. **面向认知负荷与注意连续性的阅读设计**：“薄读”先建立全局框架，再以有界、语义完整的单元承载深入阅读，由用户的问题和好奇心连接相邻理解阶段。

首要用户闭环是：

```text
打开本地文献库并保持真实目录层级
→ 选择、锁定和导入文献
→ 生成“薄读”正文、证据与认知入口
→ 主动下钻、查看原文、相关推荐和可视化
→ 同步非敏感批注、保存产物并能恢复失败任务
```

下一阶段开发应优先让这条真实链路稳定、可解释、可恢复，不要先增加新的装饰性页面或孤立模态。

## 2. 仓库地图与边界

| 位置 | 责任 | 开发时必须记住 |
| --- | --- | --- |
| `products/liteasy/apps/desktop/` | Tauri + React 桌面客户端 | 主产品入口；保持 `layout -> controllers -> features -> shared types / clients` |
| `products/liteasy/services/api/` | PostgreSQL/S3 正式 Liteasy API | 不依赖 `development/`，不与 IntuEcho 共用数据库或凭据 |
| `products/intuecho/` | 社区 Web、独立 API 与契约 | 承担社区内容和文献身份相关协作，不替论文事实作证 |
| `platform/identity-service/` | 账号生命周期与 Keycloak 适配 | 只处理身份边界，不承载产品业务数据 |
| `development/dev-cloud/` | 本地真实联调 API | 仅用于开发；不得在 staging/production 运行，不返回 mock 业务结果 |
| `deployment/` | 基础设施、迁移与部署验证 | 部署是独立工作流；仓库代码存在不等于目标环境已验收 |
| `docs/` | 当前设计、工程、QA 和运维依据 | `archive/` 只用于追溯历史，不作为当前实现依据 |

桌面端常用入口：

- 文献树和文件系统：`features/library/`、`features/workspace/`、`useLibraryResourceTransferController.ts`。
- “薄读”生成、证据、下钻和社区：`features/thin-reading/`、`useArtifactWorkflowController.ts`。
- 多模态产物与恢复：`features/visualization/`、`features/artifacts/`、`useThinReadingVisualizationController.ts`。
- Agent 与问答：`features/agent-core/`、`features/agent-runtime/`、`features/assistant/`。
- 测试：`products/liteasy/apps/desktop/src/tests/`；不要把大量领域断言继续堆入 `AppShell.test.tsx`。

## 3. 当前基线和默认开发起点

当前协作分支是 `server-staging-sync-20260812`。每次工作都以远程分支和干净工作树为起点，不依赖旧构建目录、旧安装包或另一个会话的口头结论。

分支已经覆盖桌面 `0.1.13` 相关的本地文献目录层级、Windows 快捷方式、动态 renderer 冷加载和生成瞬时失败恢复等修复，但“代码已合并”“安装包已构建”“controlled staging 已验证”“生产可发布”是四种不同状态。实际状态必须查看最新构建证据和目标环境交接记录。

建议开发顺序：

### P0：关闭真实科研阅读闭环

优先用公开、非敏感 PDF 验证并修复：目录定位与导入、薄读生成、证据定位、下钻、相关推荐、可视化、IntuEcho 批注、重试和重启恢复。失败必须显示具体原因和可执行恢复入口，不能把失败误报为“已简化”“无结果”或成功状态。

### P0：建立评测与发布可信链

固定跨学科公开论文金集，记录正文成功率、证据覆盖、数值保真、图表语义、renderer 成功率、重试恢复率、延迟和成本。没有明确样本、分母和失败分类时，不宣称“接近 100%”。发布侧继续补齐 Authenticode、Windows 安装/升级/卸载、目标环境密钥、备份恢复、监控告警和可回滚证据。

### P1：长期记忆治理与规模基线

记忆应先完成本地持久化、命名空间隔离、写入过滤、用户预览/删除/导出、命中解释和污染评测，再考虑向量化或跨设备同步。随后测量大文献库、真实并发和多模态任务下的容量与成本。

插件市场和正式 MCP 生命周期属于 P2；动作、权限、审计和记忆治理未稳定前不要提前扩张生态。

## 4. 开始一次迭代

建议开发者先读：

1. `AGENTS.md`：代码、UI、测试和提交规则。
2. 本文：当前主线和优先级。
3. `docs/项目上下文与设计总览.md`：产品概念与模块边界。
4. `docs/technical-reports/liteasy-technical-report-2026-08.pdf`：完整架构与“薄读”设计。
5. 与任务直接相关的 feature README、设计文档和测试。
6. 只有涉及部署或发布时，才继续读 `direction/`、`deployment/` 和最新 `docs/operations/*handoff*`。

开始前执行：

```bash
git fetch --prune origin
git status --short
git rev-parse HEAD
git rev-parse origin/server-staging-sync-20260812
```

存在不认识的改动时停止，不得用 `reset`、`clean` 或覆盖来换取干净状态。需要更新时只做可解释的 fast-forward 或在新目录重新 clone。

验证应与风险相称：先跑受影响测试；桌面代码改动再跑 `npm run build`。只有共享契约、发布门禁或大范围重构才需要扩大测试，不要为小改动机械运行全仓库测试。

## 5. 给 Codex 的前提提示词

每个新任务可先发送下面这段，再补充具体目标：

```text
你正在维护 Hash012/Liteasy，目标分支为 server-staging-sync-20260812。

开始前完整读取仓库根目录 AGENTS.md、DEVELOPER_HANDOFF.md，以及本任务直接涉及目录的 README、设计文档和现有测试。先执行 git status --short、git fetch --prune origin，并核对本地 HEAD 与远程分支。遇到未知改动立即停止汇报，不得 reset、clean、覆盖或删除用户改动。

产品主线是：真实文献目录与导入 → “薄读”全局框架和语义完整阅读单元 → 可追溯证据 → 主动下钻 → 相关推荐/可视化 → IntuEcho 批注与可恢复产物。Liteasy 的差异化同时包括证据约束，以及面向认知负荷调节与注意连续性的阅读设计。

保持桌面依赖方向 layout -> controllers -> features -> shared types / clients；AppShell 只做组合。优先复用既有 feature、controller、Fluent 2 组件和契约。不得引入 mock 业务结果，不得把本地 readiness、测试通过或代码存在描述成 staging/production 已验收。

先检查真实用户路径和现有实现，再说明根因、涉及边界和最小验收标准；随后在授权范围内完成实现、聚焦测试、必要构建和自审。测试规模与风险相称，不做无关全量测试，也不得降低断言或通过重复运行选择偶然成功结果。

不得提交密钥、token、cookie、用户文献内容或本机绝对隐私路径。未经明确授权，不得部署、上传制品、创建或移动 tag、触发 GitHub Actions、发布网站或改变外部数据。提交或推送也必须符合本次授权范围。

最终报告必须说明：用户可见结果、修改文件、验证命令与统计、未验证项、最终 Git 状态、提交 SHA，以及仍需服务器或人工完成的工作。若服务器工作不可在本机完成，给出一段边界清楚、可直接交给服务器 Codex 的中文提示词。
```

然后追加任务信息：

```text
本次目标：<一个可观察的用户结果>
复现步骤或当前证据：<日志、截图描述、失败状态；不要包含凭据或隐私内容>
验收标准：<正常路径、失败路径、恢复路径>
允许的外部操作：<无 / fetch / push / staging 只读检查 / 其他明确范围>
禁止事项：<例如不部署、不上传、不改数据>
测试预算：<聚焦测试 / 桌面 build / 发布全量门禁>
```

默认不应只要求“把错误都修好”。把任务约束为一个用户闭环、一个可重复失败或一组同源失败，Codex 才能给出可审查、可回归的结果。

## 6. 完成一次迭代的标准

- 用户正常路径、失败提示和恢复入口都符合验收标准。
- 状态、权限、来源和本地/云端/组织数据边界没有被绕过。
- 测试覆盖真实回归点，构建或契约检查与改动风险相称。
- 没有秘密、测试生成物、旧安装包或无关格式化进入提交。
- 文档只在契约、运行方式或已验证状态确实变化时更新。
- 提交聚焦，远程 SHA 可核对；服务器、签名、账号交互等外部工作明确交接。

需要深入时，从 `docs/项目上下文与设计总览.md`、`docs/engineering/module-boundaries.md`、`docs/engineering/薄读-技术架构与商业化演进.md` 和最新 `docs/operations/` 交接记录继续阅读。
