# 仓库结构与能力审计

审计日期：2026-08-08。本文记录目录重组后的当前证据，区分“仓库实现通过验证”“仅本地可运行”和“生产环境已完成”。后续发布不得用单元测试或本地基础设施替代目标环境证据。

## 结构结论

| 边界 | 当前目录 | 结论 |
| --- | --- | --- |
| Liteasy 软件 | `products/liteasy/` | 桌面端、管理端、正式 API、共享数据和品牌资产已归入同一产品域。 |
| 桌面打包分发 | `products/liteasy/apps/desktop/src-tauri/`、`.github/workflows/windows-installer.yml` | NSIS 配置与 Windows CI artifact 流程独立于服务器部署；生成安装包不进入源码。 |
| Intuecho 论坛 | `products/intuecho/` | Web、独立 API 和共享契约已形成独立产品闭包。 |
| Marketing | `products/marketing/` | 与 Liteasy、Intuecho 并列；静态站可独立发布。 |
| 公共后端 | `platform/identity-service/` | 只处理账号生命周期和 Keycloak 管理适配，不拥有产品业务数据。 |
| 开发测试 | `development/` | dev-cloud、smoke、工具和稳定测试数据已与产品代码隔离。 |
| 服务器部署 | `deployment/` | 当前只有本地基础设施；没有 staging/production 定义。 |
| 文档与历史 | `docs/`、`archive/` | 当前材料与历史快照分离；过时的数据模型 HTML 和 Phase 1–4 demo QA 已归档。 |

目录使用小写 `kebab-case`，React 组件和 TypeScript/JavaScript 文件继续遵循各语言既有命名。每个产品、应用、服务、契约和共享数据边界均有 README；运行生成物、密钥和本地数据库不属于产品源码。

## 已验证能力

本轮重组后已经取得以下仓库内证据：

| 主体 | 已通过的验证 | 能说明什么 |
| --- | --- | --- |
| Liteasy Desktop | 全量 Vitest、迁移路径聚焦回归、生产前端构建；Tauri/Rust 54 项测试 | 桌面前端和原生宿主的仓库实现未因移动损坏。 |
| Liteasy dev-cloud | 281 项 Node 测试 | 真实注册、会话、SQLite 持久化和本地业务契约可用于开发。 |
| Liteasy 正式 API | 153 项 Node 测试 | PostgreSQL/S3、身份、存储和业务适配器的仓库契约通过；不等于目标环境上线。 |
| Liteasy Admin | 8 项测试和生产构建 | 管理端代码与静态构建完整。 |
| Intuecho | API 51 项测试、Web 生产构建、API 语法检查 | 论坛 Web/API 仓库链路完整；正式环境仍待部署。 |
| Identity service | 7 项测试 | 公共账号生命周期适配器的仓库契约通过。 |
| 本地部署基础 | 静态门禁、配置测试和既有本机 PostgreSQL/Keycloak 验证 | `deployment/local` 可重建本地基础设施，不是生产编排。 |
| 资产与仓库 | 生产资产检查、仓库脚本测试、README/Markdown 链接检查、旧路径扫描、`git diff --check` | 生产构建未携带测试资产，当前文档入口和迁移后的路径一致。 |

所有依赖真实模型、外部检索、扫描器、IdP、托管数据库或对象存储的能力，都必须在配置真实凭据和隔离测试环境后另行验收。

## 未完成能力

以下是当前确定存在的缺口，不应描述为已完成：

| 优先级 | 缺口 | 影响 |
| --- | --- | --- |
| P0 | 没有 staging/production 部署目录、正式服务镜像编排或发布 manifest；`deployment/local` 只包含 PostgreSQL、Keycloak 和 identity service 的开发基础 | 无法仅凭当前仓库执行完整服务器上线、扩缩容或回滚。 |
| P0 | 尚无目标环境的可信 HTTPS、`verify-full`、secret manager、KMS/静态加密、网络策略、监控告警、备份/PITR 和恢复演练证据 | Liteasy API、Intuecho API/Web 和管理端均不能标记 production ready。 |
| P0 | 正式 IdP、真实 MFA/首次改密、三个 audience 的吊销链路、Windows Credential Manager OAuth 和 staging CORS 尚未闭环 | 登录、治理和账号删除只有仓库/本机契约证据。 |
| P0 | 模型、Crossref/OpenAlex/Semantic Scholar、PDF 扫描器和 S3 的真实上游、限流、故障、轮换和告警未在 staging 验证 | 外部依赖能力不能承诺生产可用性。 |
| P1 | Windows NSIS 配置和 CI artifact 工作流存在，但尚无代码签名、正式 Release 发布、自动更新链路；本次 Linux 会话也无法执行 Windows 安装和实机 E2E | 可构建配置不等于可安全分发安装包证据。迁移后的工作流路径已修正，仍需在 GitHub Actions 或 Windows runner 执行并补齐发布链。 |
| P1 | Marketing 体验申请只在部署方提供 `window.LITEASY_WAITLIST_URL` 时提交；仓库没有申请接收后端 | 默认静态部署会显示“入口尚未配置”，不会收集申请。 |
| P1 | 浏览器 Playwright、真实跨域、桌面到论坛的 live E2E 和真实外部网络测试未在本轮目录重组后重跑 | 单元/构建验证不能覆盖浏览器策略、网络和第三方变化。 |
| P1 | RPO、RTO、审计保留期和账号删除保留期尚未由业务负责人签署 | 不能声明正式 SLA 或完成发布审批。 |

旧交接和阶段文档中的建议项属于产品路线，不自动视为当前版本缺陷。是否纳入发布范围应先写入新的验收标准，再补实现和测试。

## 安全与交付备注

重组时发现并移除了一个包含疑似非占位凭据的已跟踪 OpenAlex 示例文件。若该值曾经有效，必须在供应商侧轮换；从工作树删除不能清除 Git 历史。

旧的本地 `docs/test-api.md` 已被 Git 忽略且未跟踪；启动和 live-eval 脚本不再依赖它，统一从 `development/dev-cloud/.env.local` 加载密钥。该本地文件未被删除，以免破坏用户数据，但不属于项目文档或交付物。

文件系统移动已经完成，但当前执行环境不能写 `.git` 索引。提交前需要由具备 Git 索引权限的环境执行 `git add -A`，再复核 rename 检测、删除清单和最终 diff；不要把本地 `.env`、SQLite、对象目录、构建缓存或测试运行结果加入提交。

生产门禁和证据格式继续以 [部署与验收执行计划](../operations/Liteasy-后续部署与验收执行计划.md) 与 [存储备份与恢复运行手册](../operations/Liteasy-存储备份与恢复运行手册.md) 为准。
