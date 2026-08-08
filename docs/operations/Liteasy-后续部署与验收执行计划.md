# Liteasy 后续部署与验收执行计划

版本：2026-08-07  
适用设计：`docs/design/Liteasy-文件系统与存储边界设计.md`  
目标形态：Linux 服务端、Windows 桌面客户端、Intuecho Web、Liteasy 管理后台

## 1. 结论与执行边界

当前阶段应完成的是可迁移代码、基础设施定义、严格配置、迁移、自动化门禁和操作手册；不应把本机开发数据直接搬到未来服务器，也不应把本机容器测试写成生产验收。

未来部署采用“从版本化构建产物和数据库迁移重新建立环境”的方式。以下内容原则上不迁移：

- `dev-cloud` SQLite、Intuecho 开发 SQLite、本机测试 PostgreSQL；
- 本机测试账号、Keycloak bootstrap 管理员和任何开发 token；
- `deployment/local/.env`、`.env.local`、模型 API key 和本机自签名证书；
- 用户 Windows 本地文献库、临时 PDF、推荐/检索/解析缓存；
- 本机 Docker volume、临时对象和测试证据包。

以下内容进入未来部署：

- 已审核 Git commit、锁定依赖和构建产物；
- Liteasy 与 Intuecho 各自的只增数据库迁移；
- 经环境参数化的服务、IdP client、CORS、调度和告警定义；
- 不含 secret 的配置模板、恢复手册、证据 manifest schema；
- 业务签署的 RPO、RTO、审计保留期和账号删除保留期。

## 2. 总体状态

| 工作项 | 当前状态 | 完成环境 |
| --- | --- | --- |
| 双 PostgreSQL、独立角色/卷定义 | 本机运行态、TLS、权限和迁移已验证 | staging 重建并复验 |
| Keycloak 三个用户 audience 和服务 client | 本机 discovery/JWKS/token/introspection/revocation 已验证 | staging 用正式域名、TLS 和 secret 重建复验 |
| Keycloak 账号生命周期管理适配器 | 本机真实 caller token 授权和 Admin API 边界已验证 | staging 真实账号生命周期 E2E |
| Liteasy/Intuecho 迁移与静态预检 | 现在已完成 | 本机；staging 重跑 |
| Windows 文件系统与 UI 完整验收 | 脚本已具备，未实机签署 | Windows 11/目标 Windows 版本 |
| MFA、Credential Manager、三端真实 SSO | 协议已完成，未真实联调 | Windows + staging IdP |
| 模型、扫描器、学术上游 | 连接器和失败关闭已完成，未接正式服务 | staging |
| 正式 PostgreSQL/S3/调度 | 代码边界已完成，未采购和部署 | staging、production |
| PITR、数据库/S3 一致恢复、故障注入 | 手册和门禁已完成，未取真实数据 | staging、production 隔离恢复区 |
| 发布 manifest 和业务签署 | 校验器已完成，正式证据未形成 | 发布候选环境 |

## 3. 阶段 0：本机可重复基础设施

状态：本机开发基础设施已闭环。三套 PostgreSQL、Keycloak 和 identity-management 均已达到 healthy；两个产品库的 TLS、角色、迁移，OIDC 服务 token/introspection，以及真实 caller token 的 adapter 授权均已验证。该状态不是 staging 或 production 部署完成。

### 3.1 前置条件和输入

- Node.js 20+、Docker Engine、Docker Compose v2。
- 当前 Linux 用户具有 Docker socket 权限。
- `.env` 所配置的 Liteasy/Intuecho PostgreSQL、Keycloak 和 identity-management 宿主端口未被占用；默认分别为 `55432`、`55433`、`18081`、`9090`。
- 负责人：开发负责人；不需要业务负责人审批。

### 3.2 执行

```bash
node deployment/local/foundation.mjs prepare
node deployment/local/foundation.mjs start
node deployment/local/foundation.mjs migrate
node deployment/local/foundation.mjs verify
node deployment/local/foundation.mjs status
node deployment/local/foundation.mjs stop
```

然后分别执行正式适配器集成测试，测试库必须为 `_test`，不得指向产品库：

```bash
cd products/liteasy/services/api
LITEASY_TEST_DATABASE_URL='postgresql://liteasy_app:<secret>@127.0.0.1:55432/liteasy_test' \
LITEASY_TEST_MIGRATION_DATABASE_URL='postgresql://liteasy_migrator:<secret>@127.0.0.1:55432/liteasy_test' \
npm run test:postgres:integration

cd ../../../intuecho
INTUECHO_TEST_DATABASE_URL='postgresql://intuecho_app:<secret>@127.0.0.1:55433/intuecho_test' \
INTUECHO_TEST_MIGRATION_DATABASE_URL='postgresql://intuecho_migrator:<secret>@127.0.0.1:55433/intuecho_test' \
npm run test:postgres:integration --workspace=@intuecho/api
```

### 3.3 通过标准和证据

- 静态校验输出 `clients: 9`、`productUsers: 0`、`compose: true`。
- 两个产品数据库运行在不同容器、端口和 volume；在线角色不能执行 DDL。
- Liteasy `001–019`、Intuecho `001–009` 迁移 checksum 全部匹配。
- OIDC discovery issuer 与 `.env` 的 `KEYCLOAK_ISSUER` 一致；JWKS 含签名键，token/introspection/revocation endpoint 与 discovery 一致；三个 public client 强制 PKCE S256。
- `liteasy-account-lifecycle` token 的 client ID、`liteasy-identity-management` audience 和 `accounts:write sessions:revoke` scope 均通过独立 `liteasy-identity-introspection` client 验证。
- `intuecho-organization-service` token 的 client ID、`liteasy-internal` audience 和 `organization:authorize` scope 均通过 `intuecho-api` 验证。
- 管理适配器 `/readyz` 验证 Keycloak Admin API；运行态探针另以真实 lifecycle Bearer token 进入受保护路由，并以不存在 subject 的稳定 `404` 证明授权链通过且没有修改产品账号。
- 保存命令日志、`docker compose ps`、迁移 JSON、集成测试 TAP 输出和当前 Git SHA。

2026-08-08 本机最新运行态结果：五个基础设施服务此前均已重启恢复到 healthy；静态门禁为 9 个 client、0 个产品用户；OIDC discovery/JWKS/token/introspection/revocation 和 identity-management 真实 caller 授权通过。Liteasy 产品库为 `19` 份迁移、Intuecho 产品库为 `9` 份迁移，两条在线连接均为 `tls: true`、`schemaCreate: false`；本轮应用 Intuecho `008–009` 后，两库幂等复跑均为 `applied: []`。identity-management 测试 `7/7`、Intuecho API 测试 `51/51` 通过；隔离 PostgreSQL 集成覆盖组织 owner/admin 治理、编辑历史清理和公开历史去身份化，最终为 `verified:true`、`annotation_audit:4`、`migrations:0`。旧项目容器未被停止或修改。这组数据只属于 Linux 本机开发基础设施证据，不替代 staging 的受信 TLS、MFA、PITR、静态加密、网络策略或生产 SLA 证据。

### 3.4 失败处理

- 配置或迁移失败时先保留容器日志，不修改已应用 SQL。
- 迁移 runner 可在修复连接或权限后重复执行；checksum 不一致必须停止并查明版本来源。
- 运行态失败先执行 `foundation.mjs status` 并读取目标服务日志；修复后依次重跑 `start`、`migrate`、`verify`。
- 只有明确要丢弃全部本地基础设施状态时才执行 `docker compose ... down --volumes`。
- 本地自签名 TLS、bootstrap 管理员和生成 secret 不得复用到 staging。

## 4. 阶段 1：Windows 桌面实机开发验收

状态：待 Windows。

### 4.1 需要用户提供

- 一台或多台 Windows 11 实机；如业务仍支持 Windows 10，另提供受支持版本和补丁号。
- NTFS 本地磁盘；如支持企业网络盘，另提供 SMB/OneDrive 场景，不与 NTFS 结果混写。
- 两个通过真实 IdP 注册的测试账号 A/B，不使用生产人员账号。
- 可创建 junction、锁文件和大量监听事件的非生产测试目录。
- Windows 验收负责人和最终签字人。

### 4.2 执行矩阵

1. 安装签名或候选 Tauri 包，记录安装包 SHA-256、应用版本、WebView2 和 Windows build。
2. A 账号选择本地库，导入 PDF、新建子文件夹并退出；B 账号登录后必须仍使用同一 Windows 用户的本地库。
3. 退出账号后验证本地文献仍可访问，云收藏、组织和个性化内容不泄漏。
4. 在文件资源管理器执行外部新建、修改、重命名、移动、删除，验证 UI 自动刷新。
5. 执行监听溢出脚本，验证全量重扫恢复且无重复或丢失节点。
6. 创建指向库外的 junction，验证拒绝越界；创建锁文件后验证失败可解释且释放锁后可重试。
7. 制造仅大小写不同的名称冲突，验证按 Windows 文件系统规则拒绝或明确处理。
8. 在本地、个人云收藏、检索/推荐缓存、组织存储四区域执行允许和禁止的真实拖拽复制矩阵。
9. 在窄视口、缩放和多级树展开状态下重启应用，验证无重叠、无横向异常且展开状态保持。

仓库入口：

```powershell
node products/liteasy/apps/desktop/scripts/windows-tauri-login-check.mjs
node products/liteasy/apps/desktop/scripts/windows-tauri-filesystem-acceptance.mjs
node products/liteasy/apps/desktop/scripts/windows-tauri-watcher-overflow-acceptance.mjs
node products/liteasy/apps/desktop/scripts/windows-tauri-library-ui-acceptance.mjs
```

### 4.3 通过标准和证据

- 发布门禁的 10 个 Windows case 全部为 `passed`，不得用 Linux 浏览器测试替代。
- 保存 PowerShell/Tauri 日志、每个 case 前后截图或录屏、测试目录清单、失败重试记录和安装包哈希。
- junction 必须拒绝逃逸；锁释放后可恢复；监听溢出后树与磁盘全量清单一致。
- A/B 切换不得复制或改属本地库；云端数据必须继续按 subject 隔离。

失败时保留测试目录和日志，按 case 重跑；不得通过删除冲突文件来把失败改记为通过。

## 5. 阶段 2：Linux staging 部署

状态：待 staging。

### 5.1 需要用户提供

- Linux 发行版、CPU/内存/磁盘、容器编排方式和至少两个故障域。
- staging 域名：Liteasy API、Intuecho Web/API、管理后台、IdP、管理适配器、扫描器。
- DNS 和 TLS 证书管理方式；负载均衡器或反向代理选择。
- secret manager、日志平台、监控告警平台和负责人名单。
- 精确的桌面 Tauri origin、Intuecho Web origin、管理后台 origin。

### 5.2 部署步骤

1. 固定构建 Git SHA、Node/Rust 版本、依赖锁和容器镜像 digest。
2. 创建 Liteasy PostgreSQL、Intuecho PostgreSQL 和 IdP 数据库；使用不同实例或至少不同故障/权限边界。
3. 为每个产品创建 online、migrator、backup 角色；online 账号不持有 DDL。
4. 从 secret manager 注入连接串、OIDC client secret、S3 凭据、扫描 secret 和上游 key。
5. 先运行迁移任务，再启动服务；`/readyz` 未通过时不得加入负载均衡。
6. 设置精确 CORS：Liteasy 只接受已批准 Tauri/管理 origin，Intuecho 只接受已批准论坛 Web origin；禁止 `*`。
7. 配置仅内部可访问的账号生命周期适配器和 Intuecho/Liteasy 服务调用地址。
8. 启用结构化日志、trace ID、指标、告警和时间同步。

### 5.3 通过标准、证据和回滚

- 外部入口仅 HTTPS；数据库连接 `verify-full`；内部管理端点不暴露公网。
- readiness 同时验证迁移、数据库、S3、IdP、扫描器所需依赖，不等同于业务 E2E。
- 保存镜像 digest、渲染后去密配置、证书链、网络策略、迁移日志、CORS 正反例和 readiness 日志。
- 应用回滚到兼容旧 schema 的上一镜像；迁移回滚必须使用事先审核的新补偿迁移或已演练的恢复点，不修改既有 migration。

## 6. 阶段 3：真实 IdP、MFA 和账号删除联调

状态：本地 realm 与适配器已施工；真实安全策略和三端 E2E 待 staging。

### 6.1 IdP 配置

- 注册 `liteasy-desktop-public`、`intuecho-web`、`liteasy-admin-public` 三个 public PKCE client。
- access token 的 audience 分别且精确为 `liteasy-desktop`、`intuecho-web`、`liteasy-admin`。
- 分离 `liteasy-cloud`、`intuecho-api`、`liteasy-account-lifecycle`、`liteasy-identity-introspection`、`liteasy-keycloak-admin`、`intuecho-organization-service`。
- 管理适配器 caller 只含 `accounts:write sessions:revoke`；独立 introspection client 不启用 service account；Keycloak admin client 只含所需用户管理权限。
- 为管理员强制 WebAuthn 或 OTP；token 必须提供可验证的 MFA `amr`，并保留 `auth_time`。
- 配置密码、注册、邮箱验证、暴力破解、恢复、refresh token 轮换和注销策略。

### 6.2 E2E

1. Windows 桌面走系统浏览器 Authorization Code + PKCE，token 存入 Windows Credential Manager。
2. 同一 subject 打开 Intuecho 和管理后台，验证浏览器 SSO，但三个 access token 不可跨 audience 使用。
3. 重启桌面验证刷新；撤销 refresh/access token 后所有端失败关闭且可重新登录。
4. 管理高风险操作要求 MFA 且 `auth_time` 小于五分钟；过期后必须重新认证。
5. 禁用账号，确认所有在线/离线 session 被撤销，三个产品 audience 均不可继续访问。
6. 删除账号时在 Liteasy 清理、Intuecho 清理、IdP 最终删除各阶段注入一次失败；账号保持 disabled，使用原幂等键续跑。
7. 验证组织负责人未转移时在禁用前拒绝；完成转移后可继续。

### 6.3 证据和失败处理

- 保存去敏 discovery/JWKS、client 配置、token claim 样例、三 audience 负例、MFA 截图、Credential Manager 条目元数据和吊销时间线。
- 保存 `account_deletion_jobs`、Liteasy/Intuecho 审计、IdP 管理事件的相同 trace ID；不得保存 token、密码或 client secret。
- 任一服务清理失败都保持账号禁用，禁止手工跳阶段或重新启用；按原 operation key 续跑并告警。

## 7. 阶段 4：真实外部服务联调

状态：连接器、超时和失败关闭代码已完成；待 staging 凭据和出口。

### 7.1 需要用户提供

- OpenAI、DeepSeek 的组织/项目、允许模型、预算、key owner 和轮换周期。
- PDF 安全扫描产品、服务地址、恶意样本管理流程和病毒库更新 SLA。
- Crossref polite-pool 联系邮箱；OpenAlex 和 Semantic Scholar 使用政策及可选 key。
- 固定出口 IP、代理/DNS 策略、供应商 allowlist、限流和日志脱敏要求。

### 7.2 验收

- 模型：成功、401/403、429、5xx、连接超时、响应超时、流中断、key 轮换前后连续性。
- 扫描：干净 PDF、EICAR/供应商批准测试样本、非 PDF、超限、超时、错误 hash、病毒库更新失败；任何不确定结果不得发布对象。
- 学术服务：Crossref/OpenAlex/Semantic Scholar 成功、限流、重定向、DNS 变化、MIME/文件头不符、超大 PDF 和联系邮箱。
- 出口：客户端不得提交任意上游 URL；重定向每一跳重新执行目标校验；日志不得出现 API key 或文献私密正文。

保存供应商 request ID、时间线、去敏响应、出口日志、限流图、扫描规则/病毒库版本和轮换记录。失败时切回上一有效 secret；扫描服务不可用时保持上传暂存且失败关闭，不绕过扫描。

## 8. 阶段 5：正式 PostgreSQL、S3 和维护调度

状态：待正式基础设施。

### 8.1 需要用户提供

- 云厂商/机房、区域、故障域、预算、数据驻留和合规要求。
- PostgreSQL 托管产品或自管方案、S3 兼容服务、KMS/HSM 和备份服务。
- RPO/RTO 初步目标、容量预测、对象锁需求和运维值班人。

### 8.2 数据库

- Liteasy 与 Intuecho 使用独立数据库、凭据、连接池、备份和恢复证据。
- 强制 TLS `verify-full`、静态加密、最小权限、连接上限、慢查询和容量告警。
- migrator 只在发布任务中启用；online role 无 DDL；backup role 只读且访问受控。
- 在空库和生产规模副本上分别验证迁移时间、锁影响和回滚路径。

### 8.3 私有 S3

- 禁止 public ACL/policy，启用 KMS 静态加密和 TLS。
- 启用版本化或合规要求的对象锁；配置跨故障域复制并监控复制积压。
- 上传暂存、正式对象、审计归档和备份使用明确 prefix/bucket 及不同权限。
- 验证签名 URL 到期、跨用户/组织拒绝、对象 hash、缺失对象和旧版本恢复。

### 8.4 调度

- 生产调度器配置回收站清理、对象 GC、暂存清理、推荐/检索/解析缓存清理和审计归档。
- 每个任务使用分布式互斥或单实例调度、超时、重试上限、幂等键和告警。
- 首次以 dry-run/只读报告执行，经审批后开放删除；保存删除清单、计数、耗时和 trace ID。

## 9. 阶段 6：备份、灾难恢复和故障注入

状态：运行手册已完成；真实演练待基础设施。

1. PostgreSQL 开启连续归档/PITR，监控 WAL 中断并验证指定时间点恢复。
2. 在业务写入中记录数据库恢复点、对象版本清单和应用 Git SHA，形成一致性锚点。
3. 将备份副本放入与生产账号、区域和密钥隔离的恢复账户；生产管理员不能删除唯一副本。
4. 在隔离网络恢复 Liteasy DB、Intuecho DB 和目标 S3 版本，按运行手册执行对象维护和审计校验。
5. 注入数据库主节点故障、对象复制延迟、扫描器故障、IdP 故障、迁移中断和账号删除中断。
6. 记录实际数据截止点、丢失窗口、服务恢复时间、人工步骤、缺失对象和实际 RPO/RTO。

通过标准是：两套数据库各自 checksum 完整，数据库引用的正式对象存在且 hash 匹配，审计连续，账号删除任务可对账续跑，实际 RPO/RTO 不超过已签署目标。失败时保持恢复环境隔离和生产写入关闭，不能用空白缓存重建掩盖正式对象缺失。

## 10. 阶段 7：生产发布治理和 manifest

状态：验证器已完成；证据和签署待发布候选。

### 10.1 业务签署

业务、法务、安全和运维负责人必须明确签署：

- RPO 分钟数和 RTO 分钟数；
- 安全/业务审计保留天数；
- 账号删除任务、tombstone 和去身份化公开内容的保留天数；
- 支持授权最大时长和过期策略；
- Windows 支持版本、数据驻留和对象锁要求。

### 10.2 证据目录

证据目录至少包含 Windows、Liteasy PostgreSQL、Intuecho PostgreSQL、S3、IdP/MFA、恢复演练、服务级别审批七类普通文件。每个文件记录 SHA-256，并由以下命令验证：

```bash
node development/scripts/verify-filesystem-release-evidence.mjs /path/to/evidence/manifest.json
```

manifest 通过只说明证据包完整且未被替换；发布批准人仍须审阅证据内容。任何必填项为 `pending`、使用本机 SQLite/自签名证书替代，或 Windows 实机未执行时，都不得标记 production ready。

### 10.3 发布与回退

- 先部署兼容迁移和后台任务，再灰度 API，最后发布 Windows 客户端；记录每步开始/结束和负责人。
- 监控认证失败率、扫描积压、对象错误、数据库延迟、账号删除积压和论坛错误率。
- 应用可回退到兼容版本；数据回退使用已演练恢复点/补偿迁移；禁止重写已应用迁移。
- 发布失败时冻结新的 destructive job，保持账号删除中的账号 disabled，并按持久阶段续跑。

## 11. 信息提供检查点

无需现在提供生产 secret。进入相应阶段前，按以下检查点提供非敏感决策；secret 通过选定的 secret manager 注入，不通过聊天或 Git 传递。

| 检查点 | 需要提供的信息 |
| --- | --- |
| Windows 验收前 | Windows 支持版本、设备、验收人、A/B 测试账号创建方式 |
| staging 设计前 | Linux/云平台、域名、DNS/TLS、编排、三个精确 origin、日志监控平台 |
| IdP 联调前 | IdP 选择、MFA 方式、邮箱验证、账号恢复和密码策略负责人 |
| 外部服务前 | 供应商账号、允许模型、预算、扫描器、联系邮箱、出口和轮换策略 |
| 正式存储前 | PostgreSQL/S3/KMS 产品、区域/故障域、容量、对象锁/合规要求 |
| 灾备演练前 | 备份隔离账户、演练窗口、初步 RPO/RTO、故障批准人 |
| 发布前 | 四项保留/RPO/RTO 正式签署、发布批准人和证据目录位置 |

当上述信息尚未确定时，可以继续开发和运行本地契约测试，但不能自行猜测供应商、域名、保留期或业务 SLA。

## 12. Intuecho 论坛闭环增量（2026-08-08）

已完成的本机开发项：

- Intuecho `007–009` 前向迁移已应用；Liteasy/Intuecho 产品库迁移幂等复跑，在线角色 TLS 与无 DDL 权限保持不变。`008–009` 使编辑过的非公开内容可随账号删除清理、公开历史去身份化，同时保留不可变治理审计中的原批注 ID。
- annotation、独立 reply、带目标回复派生 annotation、1–5 星、机构名称快照、版本审计和删除占位已经在 SQLite/PostgreSQL 双适配器一致实现。
- Web 已提供星级、独立回复编辑、派生批注链接和 `/annotations/:id` 详情路由；桌面已在公开创建、编辑和切换公开时主动同步，并保留失败重试队列。
- 浏览器验收已证明桌面 handoff 到 Web 发布并回读；第二条验收已证明同步、推荐、纯回复、派生批注、改分、自评拒绝及父删除后的详情占位。
- 组织内容治理已通过 `organization-moderation` 路由实装；只有 Liteasy 实时确认的当前 owner/admin 可撤回或恢复，两个动作均写入追加写审计。
- Web “组织批注”通过 `liteasy-internal` 机器身份取得当前组织清单并分组展示；普通成员不读取撤回内容，owner/admin 可在带原因对话框中撤回或恢复。本机临时数据库浏览器验收已核对两条治理审计。

可重复命令：

```bash
node deployment/local/foundation.mjs migrate
node deployment/local/verify-postgres.mjs
node deployment/local/verify-intuecho-postgres-integration.mjs
cd products/intuecho && npm test && npm run build
cd products/liteasy/apps/desktop && npm test -- --run src/tests/thinReadingIntuechoSyncQueue.test.ts src/tests/thinReadingCommunityRecommendationClient.test.ts src/tests/thinReadingTab.test.tsx
cd products/liteasy/apps/desktop && npm run build
```

本机浏览器验收需要临时启动 `8787` 开发身份、`4040` Intuecho 开发 API 和 `5174` Web，再运行：

```bash
cd products/liteasy/apps/desktop
node scripts/intuecho-browser-e2e.mjs
node scripts/intuecho-annotation-closure-e2e.mjs
node scripts/intuecho-organization-web-e2e.mjs
```

尚未完成且不得误报为生产完成：Intuecho API/Web 容器镜像与 Linux 编排、正式 HTTPS 域名、托管 PostgreSQL `verify-full`、真实 Keycloak Web PKCE、MFA、Liteasy 正式组织权限 API、备份/PITR、监控告警和 SLA。当前 Compose 仍是基础设施层，本次 API/Web 验收使用本机开发进程与 `/tmp` SQLite；它验证业务闭环，不替代 staging/production 验收。
