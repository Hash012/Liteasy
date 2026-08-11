# 本地生产链路一致性：文献身份与多模态设计

## 目标

让本地 Desktop 使用与上线后相同的 Liteasy API、Intuecho API、OIDC 服务身份、PostgreSQL、对象存储和多模态编排接口。当前机器同时承担服务端和客户端角色，但不再把 `development/dev-cloud` 作为生产控制面；`dev-cloud` 保留为开发适配器和独立测试目标。

## 约束

- 文献身份必须由 Intuecho 权威服务确认；Desktop 不得直接裁决或伪造文献身份。
- Liteasy 与 Intuecho 使用独立数据库、独立应用凭据和独立迁移角色。
- 文献内部调用使用独立 confidential client、`literature:verify` scope 和 `intuecho-internal` audience。
- 多模态只有在真实模型路由、额度策略、编排接口、对象存储和身份校验都 ready 时才报告可用。
- 缺少依赖时 fail closed，并返回稳定错误码及本地 readiness 诊断；不加入 mock、演示账号或固定业务结果。
- 所有本地 secret 由生成脚本写入被忽略的文件，绝不进入提交或 Desktop 配置。

## 架构与数据流

### 本地基础设施

`deployment/local` 增加文献投影服务专用 Keycloak client、`literature:verify` client scope、`intuecho-internal` audience mapper 和 generated secret。启动编排提供独立 Liteasy PostgreSQL、Intuecho PostgreSQL、Keycloak、对象存储和 PDF 安全扫描边界；每个产品 API 通过各自 `.env` 连接，不能共享数据库或在线角色。

### 正式 API

本地运行 `products/liteasy/services/api` 与 `products/intuecho/services/api` 的正式入口，使用 loopback 地址和测试环境允许的本地基础设施。Liteasy API 的 `IntuechoLiteratureClient` 以 client credentials 获取服务 token，调用 Intuecho `/v1/internal/literature:*`；Intuecho 使用 OIDC JWT/JWKS 校验 `intuecho-internal` audience、专用 client 和精确 scope。用户请求仍使用 `liteasy-desktop` token；用户会话与服务 token 不得混用。

### Desktop 端点

本地运行配置把 `models.control_plane_endpoint`、文献权威端点和多模态编排端点统一指向本地 Liteasy API；论坛请求指向本地 Intuecho API。只有显式的开发适配器模式才允许继续使用 dev-cloud，并且该模式必须返回“不提供正式多模态控制面”的诊断，而不是静默地把缺字段解释为普通网络故障。

## 配置与启动设计

新增一个不打印 secret 的本地运行入口，负责：读取 `deployment/local/.env`、派生两个 API 所需的本地 URL、验证 Keycloak/数据库/对象存储/扫描器 readiness、为 Liteasy 和 Intuecho 分别启动正式 API，并向 Desktop 注入本地端点。入口不创建账号、不写入产品数据库、不修改用户工作区；缺任一强制依赖时以可识别错误退出。

`development/dev-cloud` 仍支持独立启动，但不再被描述为与正式 API 等价。它保留自己的测试覆盖和开发专用 SQLite/本地对象适配器；文献权威配置缺失时继续 503，避免绕过正式服务身份。

## 错误与可观测性

- Liteasy API 的 readiness 同时报告 `identity`、`migrations`、`postgres`、`objectStorage`、`pdfSecurity`、`modelProxy` 和可视化路由状态；未 ready 不监听业务端口。
- Desktop 能区分“正式控制面未配置/未连接”“模型路由不可用”“额度或 entitlement 不允许”和“文献权威服务不可用”，但不展示 secret、内部 URL 或堆栈。
- 文献 `/resolve` 上游错误继续映射为稳定 503；候选为空与服务不可用保持不同状态。
- 多模态能力接口必须返回完整能力对象；缺字段视为契约错误并显示明确的本地启动指引，不伪造 `serviceAvailable: true`。

## 测试策略

1. 先为本地 Keycloak realm、生成 secret、URL 派生和启动前置条件增加失败测试。
2. 增加 Liteasy → Keycloak → Intuecho 的服务 token 合约测试，覆盖 audience、client、scope 错配和 token 过期。
3. 增加正式 Liteasy `/v1/account/capabilities`、多模态请求和文献 resolve 的本地 API 集成测试；确认缺模型/路由/额度时稳定 fail closed。
4. 增加 Desktop 本地端点注入测试，确保生产本地配置不再把控制面指向 dev-cloud，并保留显式 dev-cloud 模式的诊断行为。
5. 运行受影响服务测试、部署配置门禁、Desktop 测试和构建；若真实 Docker/上游依赖未启动，只报告 readiness 未通过，不宣称本地链路已验收。

## 非目标

- 不修改生产文献身份判定标准或迁移历史文献数据。
- 不把 dev-cloud 的 SQLite/本地对象实现搬入正式 API。
- 不在代码或测试中提交真实 OIDC、模型、S3 或扫描器密钥。
- 不通过跳过 OIDC、额度、路由或扫描器来让界面“看起来可用”。
