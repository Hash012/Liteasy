# Liteasy Dev Cloud

本服务是 Liteasy 本地开发环境中的真实云端实现，提供统一身份、收藏与组织目录树、对象存储、推荐、个性化和管理能力。它不提供演示账号、静态业务结果或 mock provider；依赖缺失时返回明确错误。

## 运行与验证

要求 Node.js 20+：

```bash
cd development/dev-cloud
npm install
npm start
```

默认监听 `http://127.0.0.1:8787`。开发环境的持久数据默认位于操作系统用户数据目录（Linux 通常为 `~/.local/share/liteasy/dev-cloud`），不会写入服务发布目录。也可显式设置数据目录、SQLite 文件、对象目录和审计归档目录，但它们仍只是开发适配器。

服务启动后可在另一个终端验证：

```bash
cd development/dev-cloud
npm test
node ../scripts/smoke-dev-cloud.mjs http://127.0.0.1:8787
```

`http://127.0.0.1:8787/healthz` 是健康检查，`http://127.0.0.1:8787/admin/` 是仅供本地使用的内嵌治理控制台。

`dev-cloud` 不是 staging 或生产服务。它的服务、管理员引导、存储维护和审计归档 CLI 在 `NODE_ENV=staging|production` 时会拒绝运行，不得通过配置本地路径将 SQLite 和本地对象目录冒充正式基础设施。正式部署必须提供真实事务数据库、私有 S3 API 对象存储及对应的恢复和密钥管理链路。

模型及外部服务密钥写入未提交的 `.env.local`。支持的关键配置包括：

- `OPENAI_API_KEY`、`OPENAI_BASE_URL`
- `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`
- `LITEASY_MODEL_PROVIDER`
- `LITEASY_RECOMMENDATION_EMBEDDING_*`
- `LITEASY_RECOMMENDATION_RERANKER_*`
- `LITEASY_DEV_CLOUD_DATABASE_PATH`
- `LITEASY_DEV_CLOUD_DATA_DIR`
- `LITEASY_LIBRARY_OBJECT_DIR`
- `LITEASY_AUDIT_ARCHIVE_DIR`
- `LITEASY_MINERU_CACHE_DIR`
- `INTUECHO_API_ENDPOINT`
- `LITEASY_MFA_MASTER_KEY`

未配置模型或外部检索服务时，相应接口返回不可用或保留可验证的确定性本地处理结果，不伪造远端成功。

## 开发测试账号

本服务不会注入固定演示账号。普通开发或测试人员启动 Desktop 或 Intuecho Web 后从注册界面创建个人账号，建议采用以下约定：

```text
昵称：测试人员自己的姓名或工号
邮箱：qa.<姓名或工号>@liteasy.local
密码：个人密码管理器生成的 12–128 位值
```

注册数据只存在本机开发数据库中。不要在仓库、README、截图、缺陷单或群聊中共享密码。一个账号可分别登录 Desktop 与 Intuecho，但每次登录必须声明对应的 `liteasy-desktop` 或 `intuecho-web` audience，会话 token 不能跨客户端复用。

开发管理员没有统一固定邮箱或密码。先复制 `.env.example` 为未提交的 `.env.local`，至少填写 `LITEASY_ADMIN_EMAIL`、`LITEASY_ADMIN_PASSWORD` 和长度不少于 32 字符的 `LITEASY_MFA_MASTER_KEY`，然后显式载入该文件并运行：

```bash
cd development/dev-cloud
set -a
. ./.env.local
set +a
npm run bootstrap:admin
```

命令输出的 `otpauthUrl`/`mfaSecret` 只用于该开发者本机的验证器，视同密码保管，不得提交或转发。随后用 `.env.local` 中配置的管理员邮箱、密码和当前 6 位动态验证码登录 `http://127.0.0.1:8787/admin/`。重复引导会轮换该账号的密码和 MFA 注册信息，因此共享数据库环境不要多人执行。

## 身份接口

注册和登录必须显式声明客户端受众：

```text
POST /v1/account/register
POST /v1/account/login
POST /v1/account/session
POST /v1/account/logout
```

受众包括 `liteasy-desktop`、`intuecho-web` 和 `liteasy-admin`。会话只能用于签发时的受众。管理员账号只通过上述受控脚本引导，不通过公开注册或源代码常量创建。管理员登录要求 MFA，权限与操作进入审计日志。

开发管理员具有 `platform_admin`；只有显式设置 `LITEASY_ADMIN_DEVELOPER_DIAGNOSTICS=true` 时才额外授予 `developer_diagnostics`，且两者都不得用于 staging 或生产。正式云服务仍必须实现一次性生产管理员引导、首次改密和真实 MFA 设备验证，不能复用本脚本宣称完成。开发链路中，禁用或删除账号会吊销三个 audience 的全部会话。删除账号还会清除其收藏、用户作用域 PDF 引用、画像、推荐数据和本地文献元数据清单；仍负责组织的账号必须先转移或删除组织。

## 存储

- 账号、会话、组织、成员、收藏、目录树、策略和个性化长期数据写入开发用 SQLite 事务数据库。该同步驱动与 SQL 方言不构成 PostgreSQL 生产适配器。
- PDF 正文先写入受限暂存目录，再原子提交到独立对象目录；逻辑条目使用 `scope_type + scope_id + folder_id` 表达归属。
- 文献上传校验大小、PDF 文件头、内容哈希、配额、作用域和乐观修订号。
- 删除进入默认 30 天回收站；永久清除逻辑引用后，无引用对象才可由垃圾回收移除。
- 推荐与检索缓存可丢弃，不作为长期业务真源。

开发环境的计划任务应定期执行存储维护，并对退出码 `2`（存在数据库引用但对象缺失）告警：

```bash
npm run maintain:storage
```

该命令清理过期回收站、过期暂存对象和无数据库记录的孤立对象，同时按引用表修复派生的引用计数。它不会静默删除存在合法引用但字节缺失的数据库记录。

审计归档使用只读数据库连接生成带 SHA-256 链的不可覆盖快照：

```bash
npm run archive:audit
npm run verify:audit
```

这些本地归档只用于开发验证。正式审计归档必须由生产适配器写入独立、不可覆盖的存储；详细备份、恢复和演练门禁见 `docs/operations/Liteasy-存储备份与恢复运行手册.md`。

桌面端联调时，将 `models.control_plane_endpoint` 和 `models.cloud_proxy_endpoint` 配置为 `http://127.0.0.1:8787`，并使用真实注册或登录流程获取 `liteasy-desktop` 会话。
