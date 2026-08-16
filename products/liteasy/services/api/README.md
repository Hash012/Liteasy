# Liteasy 正式云服务

本包是 PostgreSQL 与私有 S3 API 对象存储的正式服务边界，不复用 `dev-cloud` 的 SQLite 或本地对象目录。当前已实现基础设施配置、数据库迁移、OIDC/JWKS 与 token introspection、S3 安全 readiness、流式 PDF 安全扫描、PostgreSQL/S3 文献树、组织存储策略与成员治理、团队批注、Crossref 推荐、个性化隐私、部署密钥型 OpenAI/DeepSeek 模型代理、服务端 Crossref/OpenAlex/Semantic Scholar 检索、受控外部 PDF 获取、公开模型与检索控制面、平台角色、用户/组织配额、受控支持访问及账号生命周期 API；独立管理前端位于 `products/liteasy/apps/admin`。托管密钥服务和目标环境证据仍未闭合，不能作为完整 Liteasy API 上线。

## 强制边界

- `NODE_ENV` 只能是 `production`、`staging` 或显式测试环境。
- 数据库必须使用 PostgreSQL URL 和 TLS；正式环境拒绝回环数据库。
- 自定义 S3 endpoint 在正式环境必须使用 HTTPS。
- PDF 扫描端点和部署 secret 为强制配置；正式环境只接受 HTTPS，扫描服务不可用时上传失败关闭。
- 启动前检查 bucket 的四项公共访问阻断、服务端加密、版本化或对象锁。
- PostgreSQL 必须为 15 或更高版本的可写主库。
- SQL 迁移使用独立、部署期 migrator 账号和 advisory lock；在线应用账号不需要 DDL 权限。已执行迁移的 SHA-256 变化会阻止启动。
- 只有数据库迁移和对象存储检查全部成功后才监听端口。
- 启动时读取 OIDC discovery 与 JWKS；每个业务请求同时校验 JWT 和 RFC 7662 活跃状态。
- 用户作用域由签名 token 的 `sub` 派生；组织成员和上传/导出策略由 PostgreSQL 最终授权。
- Intuecho 只能使用专用 `liteasy-internal` client-credentials token 调用组织授权端点；Cloud 同时校验配置的 client ID 和 `organization:authorize` scope，不能转交或伪装用户 Web/桌面 token。
- 模型路由只接受 `liteasy-desktop` token；上游模型和密钥由部署配置固定，客户端不能覆盖。

数据库、身份、模型和对象存储凭据通过部署密钥或 SDK credential provider chain 注入，不写入普通 PostgreSQL 配置、仓库或 readiness 响应。配置项见 `.env.example`。

## 运行与验证

本服务不能使用 dev-cloud 的 SQLite 配置直接启动。先按 `.env.example` 提供 PostgreSQL、私有 S3、PDF 扫描器和 OIDC 配置，再执行：

```bash
cd products/liteasy/services/api
npm install
npm test
npm run migrate
npm run bootstrap:admin
npm run maintain:storage
npm start
```

只需要桌面本地联调时应运行 `development/dev-cloud`，不要为方便而放宽本服务的 production/staging readiness。

## 开发测试账号

API 不创建普通用户，也不保存 IdP 密码；测试账号必须先在当前环境的统一 IdP 注册，建议使用每人独立的 `qa.<姓名或工号>@liteasy.local`。普通桌面请求需要该账号的 `liteasy-desktop` token。管理员不是固定邮箱：先取得已存在用户的 IdP subject，再按下文一次性 `npm run bootstrap:admin` 流程授予平台角色，并使用 `liteasy-admin` token 与新鲜 MFA 验证。数据库账号、S3 凭据和 confidential client 都是机器凭据，不是开发测试人员账号。

PostgreSQL schema 的反例验证脚本位于 `scripts/verify-filesystem-invariants.sql`，覆盖跨作用域父节点、目录环、跨作用域文献目录、仅元数据对象引用和合法 PDF 引用事务。

当前正式业务路由：

- `POST /v1/library/tree`
- `POST /v1/library/folders/create`
- `POST /v1/library/folders/update`
- `POST /v1/library/folders/trash`
- `POST /v1/library/folders/restore`
- `POST /v1/library/folders/purge`
- `POST /v1/library/entries/metadata`
- `POST /v1/library/entries/attach-pdf`
- `POST /v1/library/entries/copy`
- `POST /v1/library/entries/purge`
- `POST /v1/library/documents/upload`
- `POST /v1/library/documents/update`
- `POST /v1/library/documents/trash`
- `POST /v1/library/documents/restore`
- `POST /v1/library/documents/authorize`
- `POST /v1/library/documents/download`
- `POST /v1/library/documents/export`
- `POST /v1/library/trash/empty`
- `POST /v1/org/storage-policy`
- `POST /v1/org/storage-policy/update`
- `POST /v1/org/list`
- `POST /v1/org/summary`
- `POST /v1/org/invitations/list`
- `POST /v1/org/create`
- `POST /v1/org/invite`
- `POST /v1/org/join`
- `POST /v1/org/leave`
- `POST /v1/org/invitations/revoke`
- `POST /v1/org/members/role`
- `POST /v1/org/members/status`
- `POST /v1/org/owner/transfer`
- `POST /v1/org/annotations/list`
- `POST /v1/org/annotations/create`
- `POST /v1/org/annotations/update`
- `POST /v1/org/annotations/delete`
- `POST /v1/internal/intuecho/organizations/access`
- `POST /v1/internal/intuecho/organizations/invitations`
- `GET /v1/agent-artifacts`
- `POST /v1/agent-artifacts`
- `PATCH /v1/agent-artifacts/:artifactId`
- `DELETE /v1/agent-artifacts/:artifactId`
- `POST /v1/profile/get`
- `POST /v1/profile/save`
- `POST /v1/profile/clear`
- `POST /v1/personalization/settings`
- `POST /v1/personalization/settings/update`
- `POST /v1/personalization/signal`
- `POST /v1/documents/metadata-sync`
- `POST /v1/recommendations`
- `POST /v1/recommendations/feedback`
- `POST /v1/recommendation-cache/get`
- `POST /v1/recommendation-cache/put`
- `POST /v1/recommendation-cache/clear`
- `POST /v1/research/external-knowledge`
- `POST /v1/research/external-pdf`
- `GET /v1/model-policy`
- `POST /v1/model/generate`
- `POST /v1/model/generate-stream`
- `GET /v1/admin/me`
- `GET /v1/admin/governance`
- `GET /v1/admin/model-policy`
- `POST /v1/admin/model-policy/set`
- `GET /v1/admin/retrieval-sources`
- `POST /v1/admin/retrieval-sources/save`
- `POST /v1/admin/retrieval-sources/remove`
- `POST /v1/admin/quotas/get`
- `POST /v1/admin/quotas/set`
- `POST /v1/admin/organizations/status`
- `POST /v1/admin/roles/grant`
- `POST /v1/admin/roles/revoke`
- `POST /v1/admin/support-access/grant`
- `POST /v1/admin/support-access/revoke`
- `POST /v1/admin/support/documents/download`
- `POST /v1/admin/audit/list`
- `POST /v1/admin/accounts/status`

文献、组织、推荐和个性化路由只接受 `liteasy-desktop` Bearer token；管理路由只接受 `liteasy-admin` audience。平台角色由 PostgreSQL 授权而非信任 token 自报角色，高风险写操作和支持正文访问同时要求 `amr=mfa` 与五分钟内的 `auth_time`。支持授权最长 60 分钟，必须说明原因并精确绑定一个作用域中的一篇活动 PDF；平台管理员没有授权时不能读取正文。

Intuecho 的组织可见性和组织邀请使用独立内部边界。服务 token 必须是配置的 `LITEASY_IDP_INTUECHO_SERVICE_CLIENT_ID`，audience 为 `liteasy-internal`，scope 精确包含 `organization:authorize`；随后仍由本仓库实时读取组织状态、负责人、成员状态和角色。邀请者权限、目标成员冲突、事务锁、幂等结果、组织修订号和审计均由 Liteasy 决定，Intuecho 不能通过结构化消息字段自行授予组织权限。

写操作要求幂等键和预期修订号或等价的受控授权标识，业务写入、幂等结果和审计事件位于同一数据库事务。审计表由数据库触发器禁止更新和删除。PDF 先流式写入私有暂存对象，服务端计算 SHA-256、大小和文件头，再从 S3 暂存对象流式发送给 `LITEASY_PDF_SCANNER_URL`；扫描请求使用部署 Bearer secret，并携带内容长度和 SHA-256。扫描响应必须是最多 16 KiB 的严格 JSON：`clean`、`contentHash`、`scanner`、`version` 四个字段缺一不可，且返回哈希必须与暂存哈希一致。只有 `clean: true` 才会进入数据库 prepare；拒绝返回稳定 422，超时、不可用、非法响应或哈希不一致返回稳定 503，且请求产生的暂存对象会被删除。

扫描时间、引擎、版本和哈希同时持久化到对象与发布工作流。S3 发布和数据库完成都会再次要求有效扫描证明；恢复任务会先补扫并持久化证明，再发布对象。迁移不会为历史对象伪造扫描结果：未验证旧对象不可列出、复制或下载，并阻止服务 readiness。部署升级时反复运行 `npm run maintain:storage`，它每次最多流式补扫 100 个旧对象；输出中的 `pdfSecurity.remaining` 必须为 `0`，之后服务才可启动。

账号启用、禁用和删除只通过 `POST /v1/admin/accounts/status` 执行。路由要求 `liteasy-admin` token、数据库中的 `platform_admin`、五分钟内的新鲜 MFA、8–1000 字符的原因和稳定幂等键；当前管理员不能禁用或删除自己。删除流程具有 PostgreSQL 持久阶段账本：先要求 IdP 禁用账号并明确确认 `liteasy-desktop`、`intuecho-web`、`liteasy-admin` 三个 audience 的活动会话全部吊销，再清理 Liteasy 个人收藏/正文引用、画像、推荐、成员关系、邀请和本人团队批注，然后调用 Intuecho 清理私人状态并去身份化公开作者，最后才要求 IdP 删除主体。账号仍是未转移组织的负责人时，流程在禁用前以冲突拒绝。

配额读取通过 `POST /v1/admin/quotas/get` 执行，设置通过 `POST /v1/admin/quotas/set` 执行。设置要求新鲜 MFA、原因、幂等键和 `expectedRevision`，与更新者、已用字节和追加写审计事件在同一 PostgreSQL 事务中返回。组织目标必须是真实 active 组织，已删除的用户不能重新配置配额。

桌面模型策略通过 `GET /v1/model-policy` 读取，只返回 Liteasy 代理端点、默认 provider、策略版本和修订号，不返回上游地址、实际部署模型或凭据。`POST /v1/model/generate` 与流式路由先校验 `liteasy-desktop` Bearer token，再校验严格字段、240,000 字符输入上限、结构化输出和当前策略；DeepSeek 的实际上游模型固定为管理员保存的部署配置，已发布客户端携带的兼容模型标签不会覆盖该选择。文本生成使用 DeepSeek Chat Completions，管理员可在部署白名单 `LITEASY_TEXT_PROVIDER_EGRESS_HOSTNAMES` 范围内设置 HTTPS API 地址和模型；默认白名单为 `api.deepseek.com`，当前桌面默认标签为 `deepseek-v4-flash`。流式输出转换为桌面消费的 NDJSON。上游错误正文既不回传也不记录，带 traceId 的服务日志只记录主体、provider、状态类别、错误正文大小、输入/输出长度和耗时，不记录 prompt 或文献正文；未配置或不可用时返回稳定 503，不生成假回答。

正式 AI 调用分为三条独立边界：薄读、AI 助手、翻译、Agent 和结构化可视化使用 DeepSeek `deepseek-chat`；生成图片继续使用现有 OpenAI-compatible 图片路由的 `gpt-image-2`；MinerU 提取不变，其中图片理解继续使用现有视觉路由的 `gpt-5.6-sol`。DeepSeek 文本 Key、视觉/图片 Key 和 MinerU Token 不得相互复用。平台管理员通过管理端“模型服务”写入加密配置时，DeepSeek 三项必填；视觉三项和 MinerU Token 留空表示保留当前加密值。旧的单供应商加密记录可读取并迁移，但服务不会把旧视觉 Key 注入 DeepSeek secret 引用。

外部文献检索通过 `POST /v1/research/external-knowledge` 执行，只接受 `liteasy-desktop` Bearer token。管理员只能启用固定协议的 `crossref`、`openalex` 和 `semantic_scholar` connector；每类 connector 的官方 HTTPS API 地址由服务端白名单固定，不提供任意 JSON 抓取器。Crossref/OpenAlex 使用 `LITEASY_RETRIEVAL_CONTACT_EMAIL`，Semantic Scholar 可通过部署 secret 注入可选 API key；请求超时和 PDF 大小上限分别由 `LITEASY_RETRIEVAL_TIMEOUT_MS`、`LITEASY_RETRIEVAL_MAX_PDF_BYTES` 限制。

检索结果按 `subject_id + 请求指纹` 缓存一小时，来源 revision 或固定端点变化会自然失效，不能跨用户命中。每个 subject 最多保留 100 个结果集；命中会更新淘汰访问时间但不延长 TTL，写入超额时在 subject 级事务锁内删除最久未访问项，不会挤占其他用户容量。含 PDF 候选时服务端签发绑定当前 subject 和 source 的 15 分钟 `fullTextGrantId`；缓存命中也会重新签发，不缓存授权。`POST /v1/research/external-pdf` 只接受 grant 和 source ID，不接受客户端 URL。下载器逐跳要求 HTTPS，重新解析并固定公网 DNS，拒绝 loopback、私有、链路本地和保留地址，限制重定向、超时和字节数，并同时校验 MIME、`%PDF-` 文件头和 SHA-256，从而不形成通用 URL 抓取器。

管理员模型策略及检索源写入要求 `liteasy-admin`、数据库 `platform_admin`、新鲜 MFA、原因、幂等键和乐观修订号，并与审计事件处于同一事务。模型代理端点不得直接指向已知上游模型 API；检索源只接受不含查询参数、片段或凭据的公开 HTTPS 元数据，并拒绝 loopback、私有、链路本地及保留地址。任意层级的 `apiKey`、token、password、secret、credential 等字段都会被拒绝；普通控制面配置表不承担密钥存储职责。启动时可通过 `LITEASY_MODEL_*` 部署 secret 提供回退配置；管理端保存的正式 AI 凭据使用 `LITEASY_PLATFORM_CONFIG_ENCRYPTION_KEY` 加密后写入专用表，API 和状态响应只返回配置状态，不返回明文。

IdP 管理边界使用独立 confidential client，通过 `LITEASY_IDP_TOKEN_URL` 的 client credentials 获取仅含 `accounts:write sessions:revoke` 的管理 token，再调用 `LITEASY_IDP_MANAGEMENT_URL/v1/accounts/:subjectId/status`。该管理 client 必须不同于桌面 public client 和 token introspection client。IdP 响应必须返回匹配的 `subjectId`、`status`、`updatedAt`、`allSessionsRevoked: true` 及精确的三个 `revokedAudiences`；少报或多报 audience 都失败关闭。Intuecho 管理地址由 `LITEASY_INTUECHO_ADMIN_API_URL` 配置，Liteasy 只向该内部 HTTPS 边界转交当前已验证的管理员 Bearer token，不共享数据库会话或服务凭据。

删除中途失败时账号保持禁用，操作和删除任务保留最后完成阶段；管理员看到稳定的 `account_lifecycle_pending_retry`，必须使用原幂等键重试。组织负责人冲突、当前管理员自删和身份吊销未确认等禁用前错误保留各自稳定错误码。个人 PDF 引用被删除后，字节仍由既有对象引用垃圾回收处理；存在其他用户或组织引用时不得删除共享对象。安全审计、已撤销平台角色/支持授权以及删除 tombstone 按经批准的保留策略保存，不作为可恢复业务账号使用。

生产首个管理员只通过一次性命令建立，命令接收 IdP 中已经存在的 subject，不创建或保存密码：

```bash
LITEASY_BOOTSTRAP_ADMIN_SUBJECT='idp-subject' \
LITEASY_BOOTSTRAP_REASON='Initial production administrator approved by change record ...' \
LITEASY_BOOTSTRAP_CONFIRM='bootstrap-first-platform-admin' \
npm run bootstrap:admin
```

命令在事务内锁定引导过程；已有未撤销管理员时拒绝再次引导。角色先进入 `pending_activation`，该 subject 首次使用 `liteasy-admin` token 和新鲜 MFA 访问 `/v1/admin/me` 后才激活。密码首次修改策略仍必须由真实 IdP 强制执行，本服务不会假装能够验证 IdP 密码状态。

`npm run maintain:storage` 先分批补齐历史 PDF 安全扫描证明，再原子清理过期回收站、推荐候选、推荐缓存、外部检索缓存、PDF grants 和幂等记录，最后把无引用对象标为 `deleting`，删除 S3 字节后才删除数据库对象记录。过期记录按有界批次和 `SKIP LOCKED` 清理；扫描拒绝、扫描不可用、仍有待补扫对象或对象删除失败时命令以失败退出，部署方必须重试或人工处置并告警。

## 尚未完成

- 统一 IdP 的实际部署、正式 MFA 设备、首次改密策略，以及独立管理前端与 Liteasy/Intuecho 的 staging CORS 联调。
- Windows Credential Manager 上的桌面 OAuth 2.1 Authorization Code + PKCE 实机登录、恢复、轮换和撤销证据；开发账号的 opaque session 仍不能冒充正式 OIDC access token。
- 真实 IdP management API、staging 三 audience 全会话吊销、失败重试和最终删除证据；仓库内适配器及本机 PostgreSQL 测试不能替代这些证据。
- 固定检索连接器已有仓库实现，但 staging 的真实 Crossref/OpenAlex/Semantic Scholar 连通、上游限流/故障演练和可选 Semantic Scholar secret 轮换尚无证据；模型与检索密钥的托管 Secrets Manager/KMS 轮换、访问审计同样未验收。
- PDF 扫描协议、ClamAV 私有 HTTPS 部署、病毒库更新隔离、恶意样本拒绝和失败关闭已有仓库实现；目标 staging 仍须保留每次发布的 EICAR、超时/停机、部署网络、secret 轮换和告警证据。
- 在 staging 使用部署所有的 Crossref 联系邮箱完成真实外部连通、限流和故障演练。
- 正式审计独立归档目标和维护任务的部署调度、监控与告警。
- Intuecho 独立 PostgreSQL 目标环境部署、备份与恢复证据。
- 目标环境的 PITR、跨故障域复制、KMS、恢复演练和经批准 SLA。

这些项目完成并取得发布证据前，本包不得描述为生产就绪。
